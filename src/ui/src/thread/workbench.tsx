/** @jsxImportSource preact */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  type KeyValueItem,
  KeyValueList,
  MetricGrid,
  type MetricItem,
  type PresentationTone,
  StateMessage,
  Toolbar,
} from "../mcp-view-primitives.ts";
import type {
  ProjectReviewIntent,
  ProjectReviewIntentAction,
} from "../../../domain/project/project-review-intent.ts";
import {
  buildActivityReviewRecords,
  type ProjectReviewRecord,
} from "../project/review-decision-model.ts";
import {
  type ProjectReviewIntentClient,
  ReviewIntentConflictError,
  ReviewIntentStaleError,
} from "../project/review-intent-client.ts";
import {
  buildReviewIntent,
  indexReviewIntentRecords,
  reattachReviewIntent,
  reviewIntentScopeKey,
  reviewIntentStateFromRecord,
  type ReviewIntentTransmissionState,
  shouldPollReviewIntentReceipts,
} from "../project/review-intent-model.ts";
import {
  agentRunRecordedAt,
  agentRunSummary,
  buildAgentNowPresentation,
  buildCurrentProjectWork,
  buildProjectPath,
  projectPathStatusLabel,
  projectStatusTone,
} from "../project/model.ts";
import {
  ProjectNavigation,
  projectViewLabel,
  type ProjectWorkspaceView,
} from "../project/navigation.tsx";
import {
  parseProjectLocationHash,
  parseProjectViewHash,
  projectDeepLinkDomId,
  projectDeepLinkHash,
  type ProjectDeepLinkTarget,
  projectViewHash,
  shouldScrollProjectDeepLink,
} from "../project/navigation-model.ts";
import { DocumentaryBaselineWorkbench } from "../project/documentary-baseline-workbench.tsx";
import { ProjectOverview } from "../project/overview.tsx";
import { PlanningWorkbench } from "../project/planning-workbench.tsx";
import { ProjectOperations, ProjectWorkRibbon } from "../project/work.tsx";
import {
  type ThreadStreamStatus,
  type ThreadWorkbenchClient,
} from "./client.ts";
import { activityFeedNodes, type FeedScope } from "./feed-model.ts";
import { shouldAcceptWorkbenchUpdate } from "./live-update.ts";
import { ThreadFeed } from "./feed.tsx";
import { ThreadGraph, type ThreadGraphSelection } from "./graph.tsx";
import {
  buildEvidenceCanvasProjection,
  buildExplorationKindProjection,
  isAnalyzeInstrumentNode,
  makeEvidenceComponentLabeler,
} from "./evidence-canvas-model.ts";
import {
  DISPLAY_KIND_LABELS,
  type DisplayKind,
  displayKindOf,
} from "./evidence-exploration-model.ts";
import {
  buildEvidenceGraphModel,
  type EvidenceGraphModel,
} from "./evidence-graph-model.ts";
import { EvidenceExploration } from "./evidence-exploration.tsx";
import {
  buildPartAnchorageResolution,
  type PartAnchorageResolution,
} from "./part-anchorage-model.ts";
import { ComponentWorkspace } from "./component-workspace.tsx";
import {
  ToolInspectorPanel,
  type WorkbenchToolIdentity,
} from "./tool-inspectors.tsx";
import {
  graphNodeForSelection,
  resolveToolInspectorTarget,
} from "./tool-inspector-model.ts";
import { EvidenceVersionHistory } from "./version-history.tsx";
import {
  buildVersionedGraphSelectionIndex,
  buildVersionedProvenanceProjection,
  currentArtifacts,
  currentRequirements,
  edgeForVersionedGraphSelection,
  isStaleAmbiguousVersionedEdgeSelection,
  versionedEdgeGroupForSelection,
  versionedEdgeOccurrenceKey,
  type VersionedProvenanceEdgeGroup,
  versionedRefKey,
  visibleGraphRef,
  visibleGraphSelection,
} from "./versioned-provenance-model.ts";

const EMPTY_PART_ANCHORAGE: PartAnchorageResolution = {
  anchors: new Map(),
  ambiguousByRef: new Map(),
  orphanRefKeys: new Set(),
};
import type {
  EngineeringWorkbenchSnapshot,
  ThreadAction,
  ThreadArtifact,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentProvider,
  ThreadFlowStage,
  ThreadFreshness,
  ThreadGraph as ThreadGraphData,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadObservation,
  ThreadRef,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export interface ThreadWorkbenchProps {
  client: ThreadWorkbenchClient;
  reviewIntentClient?: ProjectReviewIntentClient;
}

export function ThreadWorkbench({
  client,
  reviewIntentClient,
}: ThreadWorkbenchProps): JSX.Element {
  const [workbench, setWorkbench] = useState<EngineeringWorkbenchSnapshot>();
  const [selection, setSelection] = useState<ThreadRef>();
  const [graphSelection, setGraphSelection] = useState<ThreadGraphSelection>();
  const [lineageFocus, setLineageFocus] = useState<ThreadGraphRef>();
  const [activeView, setActiveView] = useState<ProjectWorkspaceView>(() =>
    parseProjectViewHash(globalThis.location?.hash ?? "")
  );
  const [activeDeepLink, setActiveDeepLink] = useState<
    ProjectDeepLinkTarget | undefined
  >(() => parseProjectLocationHash(globalThis.location?.hash ?? "").target);
  const [activeComponentProvider, setActiveComponentProvider] = useState<
    ThreadComponentProvider
  >("syson");
  const [selectedComponentId, setSelectedComponentId] = useState<string>();
  const [followLive, setFollowLive] = useState(true);
  const [streamStatus, setStreamStatus] = useState<
    ThreadStreamStatus | "snapshot"
  >(
    client.subscribe ? "connecting" : "snapshot",
  );
  const [drawerMode, setDrawerMode] = useState<"tool" | "record">("tool");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [reviewIntentStates, setReviewIntentStates] = useState<
    ReadonlyMap<string, ReviewIntentTransmissionState>
  >(new Map());
  // Mode "Exploration" (sigma) par défaut sur la surface Evidence ; la Carte
  // SVG reste disponible. Le mode "Par pièce" a été retiré (décision opérateur
  // 2026-08-07) : la lecture par pièce vit dans le filtre du feed Activity.
  const [evidenceMode, setEvidenceMode] = useState<
    "carte" | "exploration"
  >("exploration");
  // Profondeur du voisinage en vue locale (façon Obsidian). Décision
  // opérateur 2026-08-08 : défaut 1 — les voisins immédiats seulement.
  const [localDepth, setLocalDepth] = useState<1 | 2 | 3>(1);
  // Panneau burger des réglages du graphe (fermé par défaut).
  const [graphMenuOpen, setGraphMenuOpen] = useState(false);
  // Type visibility for the full-map Exploration view (kind-projection, dagre
  // remounts on change). Defaults: artifact/observation/requirement/evaluation/
  // violation/action visible; change/consumption/supporting-artifact hidden.
  const [explorationMapKinds, setExplorationMapKinds] = useState<
    Record<DisplayKind, boolean>
  >({
    "artifact": true,
    "supporting-artifact": false,
    "observation": true,
    "requirement": true,
    "evaluation": true,
    "violation": true,
    "change": false,
    "consumption": false,
    "action": true,
  });
  // Type visibility for the local Exploration view (in-place sigma reducer,
  // no re-layout). Defaults: all kinds visible.
  const [explorationLocalKinds, setExplorationLocalKinds] = useState<
    Record<DisplayKind, boolean>
  >({
    "artifact": true,
    "supporting-artifact": true,
    "observation": true,
    "requirement": true,
    "evaluation": true,
    "violation": true,
    "change": true,
    "consumption": true,
    "action": true,
  });
  // Feed component filter: a catalog component, an explicit non-anchored
  // scope, or undefined ("Tout le projet").
  const [feedFilterComponentId, setFeedFilterComponentId] = useState<
    FeedScope | undefined
  >(undefined);
  const snapshotRef = useRef<EngineeringWorkbenchSnapshot>();
  const lastScrolledDeepLinkRef = useRef<string>();

  // Retour arriere et avance du navigateur : le fragment fait autorite sur
  // l'espace affiche, sinon les fleches de l'historique laissent l'URL et le
  // cockpit desynchronises.
  useEffect(() => {
    const syncFromHash = () => {
      const location = parseProjectLocationHash(
        globalThis.location?.hash ?? "",
      );
      if (location.target) lastScrolledDeepLinkRef.current = undefined;
      setActiveView(location.view);
      setActiveDeepLink(location.target);
    };
    globalThis.addEventListener("popstate", syncFromHash);
    globalThis.addEventListener("hashchange", syncFromHash);
    return () => {
      globalThis.removeEventListener("popstate", syncFromHash);
      globalThis.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  useEffect(() => {
    if (
      !activeDeepLink ||
      !shouldScrollProjectDeepLink(
        lastScrolledDeepLinkRef.current,
        activeDeepLink,
      )
    ) return;
    const scrollKey = projectDeepLinkHash(activeDeepLink);
    const frame = requestAnimationFrame(() => {
      const target = globalThis.document?.getElementById(
        projectDeepLinkDomId(activeDeepLink),
      );
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      lastScrolledDeepLinkRef.current = scrollKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeDeepLink, activeView, workbench]);

  useEffect(() => {
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    setError(undefined);
    client.load(controller.signal).then((next) => {
      snapshotRef.current = next;
      setWorkbench(next);
      if (next.surface !== "evidence") {
        setSelectedComponentId(undefined);
        setSelection(undefined);
        setLineageFocus(undefined);
        setGraphSelection(undefined);
        setInspectorOpen(false);
      } else {
        const thread = next.thread;
        setSelectedComponentId(thread.components.components[0]?.id);
        const liveNode =
          activityFeedNodes(thread.graph.nodes, thread.graph.edges)[0];
        const initialSelection: ThreadRef = liveNode?.selection ??
          (thread.violations[0]
            ? { kind: "violation", id: thread.violations[0].id }
            : { kind: "change", id: thread.change.id });
        setSelection(initialSelection);
        // The feed is a chronological journal on entry. Selection supplies
        // a harmless inspector default only; it must not expand a 30-edge
        // lineage before the reviewer explicitly selects an event.
        setLineageFocus(undefined);
        setGraphSelection(undefined);
      }
      if (client.subscribe) {
        unsubscribe = client.subscribe((incoming) => {
          const previous = snapshotRef.current;
          if (
            previous && !shouldAcceptWorkbenchUpdate(previous, incoming) &&
            !shouldAcceptPlanningActivityUpdate(previous, incoming)
          ) {
            return;
          }
          snapshotRef.current = incoming;
          setWorkbench(incoming);
          if (incoming.surface !== "evidence") {
            setSelectedComponentId(undefined);
            setSelection(undefined);
            setLineageFocus(undefined);
            setGraphSelection(undefined);
            setInspectorOpen(false);
            return;
          }
          if (previous?.surface !== "evidence") {
            const thread = incoming.thread;
            setSelectedComponentId(thread.components.components[0]?.id);
            const liveNode =
              activityFeedNodes(thread.graph.nodes, thread.graph.edges)[0];
            const initialSelection: ThreadRef = liveNode?.selection ??
              (thread.violations[0]
                ? { kind: "violation", id: thread.violations[0].id }
                : { kind: "change", id: thread.change.id });
            setSelection(initialSelection);
            setLineageFocus(undefined);
            setGraphSelection(undefined);
            return;
          }
          // Following live activity appends/reorders feed entries. It never
          // hijacks the reader's viewport by expanding a new lineage.
        }, setStreamStatus);
      } else {
        setStreamStatus("snapshot");
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "The linked engineering snapshot could not be loaded.",
      );
    });
    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [client]);

  const reviewIntentProjectId = workbench?.project.project.id;
  const reviewIntentProjectRevision = workbench?.project.revision;

  // Restore delivery receipts independently from canonical decision state.
  // Exact decision+fingerprint matching prevents a predecessor's Sent badge
  // from appearing on a changed proposal after reload.
  useEffect(() => {
    if (!reviewIntentClient || !reviewIntentProjectId) return;
    const controller = new AbortController();
    reviewIntentClient.list(controller.signal).then((response) => {
      if (
        controller.signal.aborted ||
        response.projectId !== reviewIntentProjectId
      ) return;
      const restored = indexReviewIntentRecords(response.intents);
      setReviewIntentStates((current) =>
        mergeReviewIntentTransmission(current, restored)
      );
    }).catch(() => {
      // The project and its canonical statuses remain usable if the intent
      // outbox cannot be read. A later explicit send reports its own error.
    });
    return () => controller.abort();
  }, [
    reviewIntentClient,
    reviewIntentProjectId,
    reviewIntentProjectRevision,
  ]);

  const hasQueuedReviewIntent = shouldPollReviewIntentReceipts(
    reviewIntentStates,
    workbench?.project.decisions ?? [],
  );
  useEffect(() => {
    if (
      !reviewIntentClient || !reviewIntentProjectId ||
      !hasQueuedReviewIntent
    ) return;
    const controller = new AbortController();
    const refreshReceipts = () => {
      reviewIntentClient.list(controller.signal).then((response) => {
        if (
          controller.signal.aborted ||
          response.projectId !== reviewIntentProjectId
        ) return;
        setReviewIntentStates((current) =>
          mergeReviewIntentTransmission(
            current,
            indexReviewIntentRecords(response.intents),
          )
        );
      }).catch(() => undefined);
    };
    const interval = globalThis.setInterval(refreshReceipts, 2_000);
    refreshReceipts();
    return () => {
      controller.abort();
      globalThis.clearInterval(interval);
    };
  }, [reviewIntentClient, reviewIntentProjectId, hasQueuedReviewIntent]);

  // Keep one versioned object graph for the Evidence renderers and their
  // selection state. The Evidence-only removal of closed actions happens
  // before version folding, so the graph passed to sigma and the graph that
  // resolves highlighted edge occurrences are the same objects.
  const versionedProvenanceMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") {
      return undefined;
    }
    const thread = workbench.thread;
    const closedIds = new Set(
      buildCurrentProjectWork(workbench.project).closedActionTargetIds,
    );
    return buildVersionedProvenanceProjection(
      graphWithoutClosedActions(
        thread.graph,
        thread.actions,
        closedIds,
      ),
      thread.evidenceFamilyGraph,
    );
  }, [workbench]);

  // Memoize evidenceModel on the workbench reference so sigma is NOT killed on
  // every non-data state change (followLive, graphSelection, inspectorOpen, …).
  // workbench is stable between SSE events — it changes only when
  // setWorkbench(incoming) fires. The guards below (planning, documentary,
  // !workbench) prevent the null sentinel from ever being consumed.
  const evidenceModel = useMemo((): EvidenceGraphModel => {
    if (!workbench || workbench.surface !== "evidence") {
      return null as unknown as EvidenceGraphModel;
    }
    const thread = workbench.thread;
    const closedIds = new Set(
      buildCurrentProjectWork(workbench.project).closedActionTargetIds,
    );
    const rawGraph = graphWithoutClosedActions(
      thread.graph,
      thread.actions,
      closedIds,
    );
    return buildEvidenceGraphModel(rawGraph, thread.evidenceFamilyGraph, {
      isAnalyzeInstrumentNode,
      intentionallyIsolatedSystems: ["openmodelica", "mcp-modelica"],
      versionedProjection: versionedProvenanceMemo!,
    });
  }, [workbench, versionedProvenanceMemo]);

  // ---------------------------------------------------------------------------
  // Part anchorage — memoized on snapshot (same cost centre as evidenceModel).
  // Built lazily only when the evidence surface is active; the planning/
  // documentary early-returns above fire before it is consumed.
  //
  // Uses the FULL graph (before closed-action filter) so the Activity feed
  // part filter stays consistent with the Product workspace anchor.
  // ---------------------------------------------------------------------------

  const partAnchorage = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") {
      return EMPTY_PART_ANCHORAGE;
    }
    const thread = workbench.thread;
    return buildPartAnchorageResolution(thread.graph, thread.components);
  }, [workbench]);

  // The projection identity must be stable across non-data renders (depth
  // control, selection highlight): rebuilding it per render remounted sigma
  // on every click — the "everything refreshes" defect. localDepth is NOT a
  // dependency: the local neighbourhood is computed at max depth and the
  // visible depth filters display only.
  const evidenceCanvasMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!versionedProvenanceMemo || !evidenceModel) return undefined;
    return buildEvidenceCanvasProjection(
      evidenceModel,
      versionedProvenanceMemo.collapsedVersionCount,
      lineageFocus,
      versionedProvenanceMemo.visibleRefByMemberRef,
    );
  }, [workbench, versionedProvenanceMemo, evidenceModel, lineageFocus]);

  // Kind-filtered projection for the full-map Exploration view. This projection
  // replaces the essential-filter projection when evidenceMode==="exploration"
  // and there is no focus. Changing explorationMapKinds triggers a dagre
  // remount — the re-layout on the visible set is intentional (no gaps).
  const explorationKindProjectionMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!evidenceModel) return undefined;
    return buildExplorationKindProjection(
      evidenceModel,
      explorationMapKinds,
      versionedProvenanceMemo?.collapsedVersionCount ?? 0,
    );
  }, [evidenceModel, explorationMapKinds, versionedProvenanceMemo]);

  // The renderer re-creates synthetic stub objects for each projection. Keep
  // one current occurrence index for the active canvas so a controlled keyed
  // selection can remap to that exact object, or be cleared after SSE if its
  // occurrence disappeared. Raw ids are intentionally absent from this path.
  const graphSelectionIndexMemo = useMemo(() => {
    if (!versionedProvenanceMemo || !evidenceCanvasMemo) return undefined;
    const activeProjection = evidenceMode === "exploration" &&
        !evidenceCanvasMemo.isFiltered
      ? (explorationKindProjectionMemo ?? evidenceCanvasMemo)
      : evidenceCanvasMemo;
    return buildVersionedGraphSelectionIndex(
      versionedProvenanceMemo,
      activeProjection.edges.filter((edge) => edge.id.startsWith("stub:")),
    );
  }, [
    versionedProvenanceMemo,
    evidenceCanvasMemo,
    explorationKindProjectionMemo,
    evidenceMode,
  ]);

  // An occurrence key is an exact selection contract. When a live snapshot
  // changes duplicate cardinality or removes a stub, do not let an inspector
  // retain a previous object or degrade to edge.id: close it deterministically.
  useEffect(() => {
    if (graphSelection?.kind !== "edge" || !graphSelection.occurrence) return;
    if (!graphSelectionIndexMemo) return;
    if (
      isStaleAmbiguousVersionedEdgeSelection(
        versionedProvenanceMemo!,
        graphSelection,
        graphSelectionIndexMemo,
      )
    ) {
      setGraphSelection(undefined);
      setInspectorOpen(false);
    }
  }, [graphSelection, graphSelectionIndexMemo, versionedProvenanceMemo]);

  const changeView = (next: ProjectWorkspaceView) => {
    lastScrolledDeepLinkRef.current = undefined;
    setActiveView(next);
    setActiveDeepLink(undefined);
    // A selected record can belong to another tool surface. Keep the main
    // workspace calm when changing context; explicit inspection reopens this.
    setInspectorOpen(false);
    // Le fragment suit l'espace ouvert : recharger, revenir en arriere ou
    // partager le lien ramene au meme endroit du cockpit.
    if (globalThis.location && globalThis.history) {
      const hash = projectViewHash(next);
      if (globalThis.location.hash !== hash) {
        globalThis.history.pushState(null, "", hash);
      }
    }
  };

  const openProjectDeepLink = (target: ProjectDeepLinkTarget) => {
    lastScrolledDeepLinkRef.current = undefined;
    const location = parseProjectLocationHash(projectDeepLinkHash(target));
    setActiveView(location.view);
    setActiveDeepLink(target);
    if (target.startsWith("review/")) setFeedFilterComponentId(undefined);
    setInspectorOpen(false);
    if (globalThis.location && globalThis.history) {
      const hash = projectDeepLinkHash(target);
      if (globalThis.location.hash !== hash) {
        globalThis.history.pushState(null, "", hash);
      }
    }
  };

  /**
   * Opens the evidence canvas anchored on the given node ref.
   *
   * Used by:
   *   - The "Open evidence canvas" button in the feed card lineage header
   *     (anchored on the card's own fact — ensures the canvas opens on the
   *     correct node even if lineageFocus drifted due to vignette interactions).
   *   - Node clicks inside the feed vignette (anchored on the clicked node).
   *
   * Flow: setLineageFocus → setGraphSelection → changeView("verification").
   * The evidence canvas then shows the bounded neighbourhood (depth 3) around
   * the anchored ref via buildEvidenceCanvasProjection.
   */
  const openEvidenceAnchored = (ref: ThreadGraphRef) => {
    setLineageFocus(ref);
    setGraphSelection({ kind: "node", ref });
    changeView("verification");
  };

  if (error) {
    return (
      <StateMessage title="Engineering project unavailable" tone="danger">
        {error}
      </StateMessage>
    );
  }
  if (!workbench || (workbench.surface === "evidence" && !selection)) {
    return (
      <div class="thread-loading" aria-busy="true">
        <span class="thread-loading-mark" aria-hidden="true" />
        <div>
          <strong>Reading project intent and linked evidence</strong>
          <small>No engineering tool is being executed.</small>
        </div>
      </div>
    );
  }

  if (workbench.surface === "planning") {
    return (
      <PlanningWorkbench
        workbench={workbench}
        streamStatus={streamStatus}
      />
    );
  }

  if (workbench.surface === "documentary") {
    return (
      <DocumentaryBaselineWorkbench
        workbench={workbench}
        streamStatus={streamStatus}
        activeView={activeView}
        onChangeView={changeView}
      />
    );
  }

  const snapshot = workbench.thread;
  const project = workbench.project;
  const activityReviewRecords = buildActivityReviewRecords(project, snapshot);

  const setReviewIntentState = (
    scope: string,
    state: ReviewIntentTransmissionState,
  ) => {
    setReviewIntentStates((current) => {
      const next = new Map(current);
      next.set(scope, state);
      return next;
    });
  };

  const reconcileReviewIntentConflict = async (
    scope: string,
    intent: ProjectReviewIntent,
    conflict: ReviewIntentConflictError,
  ): Promise<void> => {
    if (!reviewIntentClient) return;
    try {
      const response = await reviewIntentClient.list();
      if (response.projectId === intent.projectId) {
        const exact = reattachReviewIntent(
          response.intents,
          intent.decisionId,
          intent.inputFingerprint,
        );
        if (exact.kind !== "idle") {
          setReviewIntentState(scope, exact);
          return;
        }
      }
    } catch {
      // The conflict below remains truthful even when reconciliation cannot
      // read the outbox. Never convert this failure into a project verdict.
    }
    setReviewIntentState(scope, {
      kind: "error",
      message: conflict.code === "review_intent_stale_revision"
        ? "Project context advanced without changing this proposal. Refresh the exact preview before sending again."
        : "The outbox could not reconcile this send. Refresh the exact preview before trying again.",
    });
  };

  const transmitReviewIntent = async (
    scope: string,
    intent: ProjectReviewIntent,
  ): Promise<void> => {
    if (!reviewIntentClient) return;
    setReviewIntentState(scope, { kind: "sending", intent });
    try {
      const record = await reviewIntentClient.submit(intent);
      setReviewIntentState(scope, reviewIntentStateFromRecord(record));
    } catch (reason) {
      if (reason instanceof ReviewIntentStaleError) {
        setReviewIntentState(scope, {
          kind: "stale",
          message: reason.message,
          currentRevision: reason.currentRevision,
        });
        return;
      }
      if (reason instanceof ReviewIntentConflictError) {
        await reconcileReviewIntentConflict(scope, intent, reason);
        return;
      }
      setReviewIntentState(scope, {
        kind: "error",
        message: reason instanceof Error
          ? reason.message
          : "The review intent could not be sent.",
        retryIntent: intent,
      });
    }
  };

  const submitReviewIntent = async (
    record: ProjectReviewRecord,
    action: ProjectReviewIntentAction,
    comment?: string,
  ): Promise<void> => {
    const decision = record.decision;
    if (
      !reviewIntentClient || decision?.status !== "proposed" ||
      !decision.inputFingerprint
    ) return;
    const intent = buildReviewIntent({
      intentId: `review-${globalThis.crypto.randomUUID()}`,
      projectId: project.project.id,
      expectedRevision: project.revision,
      decisionId: decision.id,
      inputFingerprint: decision.inputFingerprint,
      action,
      comment,
      submittedAt: new Date().toISOString(),
    });
    await transmitReviewIntent(
      reviewIntentScopeKey(decision.id, decision.inputFingerprint),
      intent,
    );
  };

  const retryReviewIntent = async (
    record: ProjectReviewRecord,
  ): Promise<void> => {
    const decision = record.decision;
    if (!decision?.inputFingerprint) return;
    const scope = reviewIntentScopeKey(decision.id, decision.inputFingerprint);
    const state = reviewIntentStates.get(scope);
    if (state?.kind !== "error" || !state.retryIntent) return;
    // Retry is byte-for-byte idempotent: same intentId, timestamp, revision,
    // fingerprint, action and comment.
    await transmitReviewIntent(scope, state.retryIntent);
  };

  const refreshReviewIntentContext = async (): Promise<void> => {
    try {
      const next = await client.load();
      snapshotRef.current = next;
      setWorkbench(next);
      if (!reviewIntentClient) return;
      const response = await reviewIntentClient.list();
      if (response.projectId === next.project.project.id) {
        setReviewIntentStates(indexReviewIntentRecords(response.intents));
      }
    } catch {
      setReviewIntentStates((current) =>
        new Map([...current].map(([key, state]) => [
          key,
          state.kind === "stale" ||
            (state.kind === "error" && !state.retryIntent)
            ? {
              ...state,
              message:
                "Refresh failed. The current project record is still shown; try again.",
            }
            : state,
        ]))
      );
    }
  };
  const agentNow = buildAgentNowPresentation(project);
  const projectPath = buildProjectPath(project, snapshot);
  // versionedProvenance and evidenceCanvas are memoized above (guarded
  // useMemo, same pattern as evidenceModel): a stable projection identity is
  // what keeps the sigma instance alive across renders — the visible-depth
  // control and selection highlights must never remount the canvas.
  // We know they are defined here because the planning/documentary early
  // returns have already fired.
  const versionedProvenance = versionedProvenanceMemo!;
  const evidenceCanvas = evidenceCanvasMemo!;
  const graphSelectionIndex = graphSelectionIndexMemo!;

  // Visible-depth display filter (local view only). The neighbourhood is
  // computed at max depth; here we derive what the chosen depth actually
  // shows — used for the Carte SVG filtered node set. Type filters from
  // explorationLocalKinds are NOT applied here (Carte is type-agnostic).
  const depthKey = (ref: ThreadGraphRef) => `${ref.kind}:${ref.id}`;
  const withinLocalDepth = (ref: ThreadGraphRef): boolean => {
    if (!evidenceCanvas.isFiltered) return true;
    const depths = evidenceCanvas.localDepthByRefKey;
    if (depths && (depths.get(depthKey(ref)) ?? 0) > localDepth) return false;
    return true;
  };
  // Banner count for the local view in Exploration mode: accounts for depth
  // AND type visibility (explorationLocalKinds). Not used for Carte.
  const explorationLocalVisibleCount = evidenceCanvas.isFiltered
    ? evidenceCanvas.nodes.filter((n) => {
      if (!withinLocalDepth(n.ref)) return false;
      if (evidenceMode === "exploration") {
        return explorationLocalKinds[displayKindOf(n)];
      }
      return true;
    }).length
    : 0;
  // Banner count for the local view in Carte mode (depth only, no types).
  const carteLocalVisibleCount =
    evidenceCanvas.nodes.filter((n) => withinLocalDepth(n.ref)).length;
  const carteNodes = evidenceCanvas.nodes.filter((n) =>
    withinLocalDepth(n.ref)
  );
  const carteEdges = evidenceCanvas.edges.filter(
    (e) => withinLocalDepth(e.from) && withinLocalDepth(e.to),
  );
  const evidenceComponentLabeler = makeEvidenceComponentLabeler(
    evidenceModel,
    evidenceModel.components.length <= 1,
  );

  // Compute which DisplayKinds are present in the model (post-fold) so the
  // burger menu only shows toggles for types that actually exist in the data.
  const presentKinds = new Set<DisplayKind>(
    evidenceModel.nodes.map((n) => displayKindOf(n)),
  );

  const currentDecisionEvidence = (decisionId?: string) => {
    const decision = decisionId
      ? project.decisions.find((candidate) => candidate.id === decisionId)
      : undefined;
    if (!decision) return undefined;
    return decision.inputEvidenceRefs.find((reference) =>
      reference.snapshotId === snapshot.id &&
      reference.snapshotRevision === workbench.alignment.currentThreadRevision
    );
  };

  const focusDecisionEvidence = (decisionId?: string) => {
    const reference = currentDecisionEvidence(decisionId);
    if (!reference) return;
    const node = snapshot.graph.nodes.find((candidate) =>
      candidate.ref.kind === reference.kind &&
      candidate.ref.id === reference.id
    );
    if (!node) return;
    setLineageFocus(node.ref);
    setGraphSelection({ kind: "node", ref: node.ref });
    if (node.selection) setSelection(node.selection);
  };

  const openDecisionActivity = (decisionId?: string) => {
    focusDecisionEvidence(decisionId);
    changeView("work");
  };

  const openPublishedEvidence = (reference: ThreadGraphRef) => {
    const node = snapshot.graph.nodes.find((candidate) =>
      candidate.ref.kind === reference.kind && candidate.ref.id === reference.id
    );
    if (!node) return;
    setLineageFocus(node.ref);
    setGraphSelection({ kind: "node", ref: node.ref });
    if (node.selection) setSelection(node.selection);
    changeView("verification");
  };

  const selectThreadElement = (next: ThreadRef) => {
    setSelection(next);
    const graphNode = graphNodeForSelection(snapshot, next);
    if (graphNode) {
      setLineageFocus(graphNode.ref);
      setGraphSelection({ kind: "node", ref: graphNode.ref });
    }
  };

  const selectGraphNode = (
    node: ThreadGraphNode,
    options: { pauseLive?: boolean; inspect?: boolean } = {},
  ) => {
    if (options.pauseLive) {
      setFollowLive(false);
    }
    setLineageFocus(node.ref);
    setGraphSelection({ kind: "node", ref: node.ref });
    if (options.inspect !== false) {
      setDrawerMode("tool");
      setInspectorOpen(true);
    }
    if (node.selection) {
      setSelection(node.selection);
    }
  };

  const selectVerificationGraphItem = (
    next: ThreadGraphSelection | undefined,
  ) => {
    if (next?.kind === "node") {
      const node = graphNodeByRef(snapshot, next.ref);
      if (node) selectGraphNode(node);
      return;
    }
    setGraphSelection(next);
    if (next === undefined) {
      // Background click deselects: clear the bounded-neighbourhood focus so
      // the canvas returns from "vue locale" to the full visible graph, and
      // close the inspector panel (whose selection was the source of the focus).
      setLineageFocus(undefined);
      setInspectorOpen(false);
    }
    if (next?.kind === "edge") {
      setDrawerMode("tool");
      setInspectorOpen(true);
    }
  };

  const inspectVerificationGraphItem = (
    next: ThreadRef,
    node: ThreadGraphNode,
  ) => {
    setSelection(next);
    setLineageFocus(node.ref);
    setDrawerMode("tool");
    setInspectorOpen(true);
  };

  const changeFollowLive = (next: boolean) => {
    setFollowLive(next);
  };

  const selectComponent = (component: ThreadComponent) => {
    setSelectedComponentId(component.id);
    // Mirror the component selection to the feed filter so the Activity view
    // pre-filters to this component when the reviewer navigates there.
    setFeedFilterComponentId(component.id);
    setInspectorOpen(false);
    const binding = component.bindings.find((item) =>
      item.provider === activeComponentProvider && item.status === "verified"
    );
    if (binding?.selection) selectThreadElement(binding.selection);
  };

  const inspectComponentBinding = (binding: ThreadComponentBinding) => {
    if (!binding.selection) return;
    selectThreadElement(binding.selection);
    setDrawerMode("tool");
    setInspectorOpen(true);
  };

  const changeComponentProvider = (provider: ThreadComponentProvider) => {
    setActiveComponentProvider(provider);
    setInspectorOpen(false);
    const component = snapshot.components.components.find((candidate) =>
      candidate.id === selectedComponentId
    );
    const binding = component?.bindings.find((candidate) =>
      candidate.provider === provider && candidate.status === "verified"
    );
    if (binding?.selection) {
      selectThreadElement(binding.selection);
      setDrawerMode("tool");
    }
  };

  const openToolView = (
    tool: WorkbenchToolIdentity,
    nextSelection: ThreadRef,
  ) => {
    if (
      tool.id !== "syson" && tool.id !== "build123d" &&
      tool.id !== "erpnext"
    ) return;
    setActiveComponentProvider(tool.id);
    const component =
      snapshot.components.components.find((candidate) =>
        candidate.bindings.some((binding) =>
          binding.provider === tool.id &&
          binding.selection?.kind === nextSelection.kind &&
          binding.selection.id === nextSelection.id
        )
      ) ?? snapshot.components.components.find((candidate) =>
        candidate.bindings.some((binding) =>
          binding.provider === tool.id
        )
      );
    if (component) setSelectedComponentId(component.id);
    changeView("product");
  };

  const selectedEdge = graphSelection?.kind === "edge"
    ? edgeForVersionedGraphSelection(
      versionedProvenance,
      graphSelection,
      graphSelectionIndex,
    )
    : undefined;
  const selectedEdgeGroup = graphSelection?.kind === "edge"
    ? versionedEdgeGroupForSelection(
      versionedProvenance,
      graphSelection,
      graphSelectionIndex,
    )
    : undefined;
  const inspectorTarget = resolveToolInspectorTarget(
    snapshot,
    graphSelection,
    selection,
  );
  const selectedGraphNode = inspectorTarget.node;
  const inspectorRecord = inspectorTarget.record;
  const selectedVersionFamily = graphSelection?.kind === "node"
    ? versionedProvenance.familyByMemberRef.get(
      versionedRefKey(graphSelection.ref),
    )
    : undefined;

  const inspector = (
    <aside
      id="thread-tool-inspector"
      class="thread-tool-drawer"
      aria-label="Active engineering tool workspace"
    >
      {selectedEdge
        ? (
          <GraphEdgeInspector
            snapshot={snapshot}
            edge={selectedEdge}
            history={selectedEdgeGroup}
            onSelectGraphNode={selectGraphNode}
          />
        )
        : (
          <>
            <div
              class="thread-drawer-tabs"
              role="tablist"
              aria-label="Inspector mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={drawerMode === "tool"}
                onClick={() => setDrawerMode("tool")}
              >
                Tool context
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerMode === "record"}
                disabled={!inspectorRecord}
                onClick={() => setDrawerMode("record")}
              >
                Exact record
              </button>
            </div>
            {selectedVersionFamily && (
              <EvidenceVersionHistory
                family={selectedVersionFamily}
                selectedRef={selectedGraphNode?.ref}
                onSelectVersion={selectGraphNode}
              />
            )}
            {drawerMode === "tool"
              ? (
                <ToolInspectorPanel
                  snapshot={snapshot}
                  node={selectedGraphNode}
                  selection={inspectorRecord}
                  onSelect={selectThreadElement}
                  onOpenToolView={openToolView}
                  availableFullViews={["syson", "build123d", "erpnext"]}
                />
              )
              : inspectorRecord
              ? (
                <SelectionInspector
                  snapshot={snapshot}
                  selection={inspectorRecord}
                  onSelect={selectThreadElement}
                />
              )
              : (
                <EmptyState>
                  This graph entity has no richer record projection. Use the
                  tool context to inspect its recorded neighbours.
                </EmptyState>
              )}
          </>
        )}
    </aside>
  );

  return (
    <div class="thread-workbench mcp-view-surface">
      <header class="thread-cockpit-header">
        <div class="thread-cockpit-identity">
          <div class="thread-kicker">
            <span class="thread-coordinate">
              ENGINEERING PROJECT COCKPIT
            </span>
            <Badge tone={snapshot.source === "fixture" ? "warning" : "success"}>
              {snapshot.sourceLabel}
            </Badge>
          </div>
          <div class="thread-subject-heading">
            <span class="thread-subject-mark" aria-hidden="true">DT</span>
            <div>
              <p class="thread-program">
                PROJECT {project.project.id} · REVISION {project.revision}
              </p>
              <h2>{project.project.name}</h2>
              <span class="thread-subject-context">
                Technical subject · {snapshot.subject.label}
              </span>
            </div>
          </div>
        </div>
        <div class="thread-session-panel">
          <div
            class="thread-session-state"
            data-state={followLive ? streamStatus : "history"}
            aria-live="polite"
          >
            <i aria-hidden="true" />
            <div>
              <small>LIVE PROJECT FEED</small>
              <strong>{streamStatusLabel(streamStatus, followLive)}</strong>
            </div>
          </div>
          <div class="thread-session-change">
            <AgentNowSession project={project} presentation={agentNow} />
          </div>
          <dl class="thread-session-facts">
            <div>
              <dt>Project</dt>
              <dd data-project-tone={projectStatusTone(projectPath.status)}>
                {projectPathStatusLabel(projectPath)}
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTime(project.generatedAt)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <ProjectNavigation
        activeView={activeView}
        onChange={changeView}
      />

      {workbench.alignment.status === "thread-ahead" && (
        <div class="project-alignment-notice" role="status">
          <span aria-hidden="true">!</span>
          <div>
            <strong>Project intent needs reconciliation</strong>
            <small>
              The technical thread is at revision{" "}
              {workbench.alignment.currentThreadRevision}, while project
              decisions remain anchored to revision{" "}
              {workbench.alignment.projectThreadRevision}.
            </small>
          </div>
        </div>
      )}

      {activeView === "overview"
        ? (
          <ProjectOverview
            project={project}
            thread={snapshot}
            onNavigate={changeView}
            onOpenActivity={openDecisionActivity}
            onOpenDeepLink={openProjectDeepLink}
            onOpenEvidence={openPublishedEvidence}
          />
        )
        : (
          <section
            class={`thread-flow-section project-workspace-page is-${activeView}`}
            id="project-workspace-panel"
            aria-labelledby="thread-flow-title"
          >
            <div class="thread-section-heading">
              <div>
                <p>{workspaceEyebrow(activeView)}</p>
                <h3 id="thread-flow-title">{workspaceTitle(activeView)}</h3>
              </div>
              <div class="thread-workspace-heading-tools">
                <span>
                  {projectViewLabel(activeView)} ·{" "}
                  {formatTime(snapshot.generatedAt)}
                </span>
                {activeView !== "verification" && (
                  <button
                    type="button"
                    class="thread-inspector-toggle"
                    aria-expanded={inspectorOpen}
                    aria-controls="thread-tool-inspector"
                    onClick={() => setInspectorOpen((open) => !open)}
                  >
                    {inspectorOpen ? "Close details" : "Inspect selection"}
                  </button>
                )}
                {activeView === "verification" && inspectorOpen && (
                  <button
                    type="button"
                    class="thread-inspector-toggle"
                    aria-expanded="true"
                    aria-controls="thread-tool-inspector"
                    onClick={() => setInspectorOpen(false)}
                  >
                    Close details
                  </button>
                )}
              </div>
            </div>
            <div class="thread-workspace-meta">
              <p class="thread-flow-explanation">
                {workspaceDescription(activeView)}
              </p>
              <div
                class="thread-operator-contract"
                aria-label="Cockpit mode"
              >
                <span data-state={followLive ? "live" : "history"}>
                  <i aria-hidden="true" />
                  {followLive ? "Following activity" : "Reviewing history"}
                </span>
                <span>
                  <b>YOUR ROLE</b>{" "}
                  inspect the shared record and discuss intent with the agent
                </span>
              </div>
            </div>
            {activeView === "work" && (
              <details
                class="project-activity-brief"
                open={project.decisions.some((decision) =>
                  decision.status === "proposed"
                )}
              >
                <summary>
                  <span>PROJECT PULSE</span>
                  <strong>
                    {project.decisions.some((decision) =>
                        decision.status === "proposed"
                      )
                      ? "A recorded recommendation is ready to discuss"
                      : "Decision status, current work and blockers"}
                  </strong>
                  <small>Open when you need the project context</small>
                </summary>
                <div>
                  <ProjectWorkRibbon project={project} />
                </div>
              </details>
            )}
            {activeView === "verification" && (
              <MetricGrid
                className="thread-metrics project-verification-metrics"
                items={summaryMetrics(snapshot)}
              />
            )}
            <div
              class={`thread-graph-workspace ${
                inspectorOpen ? "has-inspector" : "is-wide"
              }`}
            >
              <div
                class={`thread-graph-stage thread-graph-stage-${activeView}`}
              >
                {activeView === "work"
                  ? (
                    <ThreadFeed
                      nodes={snapshot.graph.nodes}
                      edges={snapshot.graph.edges}
                      focus={lineageFocus}
                      selection={graphSelection}
                      followLive={followLive}
                      streamStatus={streamStatus}
                      evidenceModel={evidenceModel}
                      filterComponentId={feedFilterComponentId}
                      anchorage={partAnchorage}
                      components={snapshot.components}
                      reviewRecords={activityReviewRecords}
                      reviewIntentStates={reviewIntentStates}
                      onSubmitReviewIntent={reviewIntentClient
                        ? submitReviewIntent
                        : undefined}
                      onRetryReviewIntent={reviewIntentClient
                        ? retryReviewIntent
                        : undefined}
                      onRefreshReviewIntents={reviewIntentClient
                        ? refreshReviewIntentContext
                        : undefined}
                      onFilterChange={(id) => {
                        setFeedFilterComponentId(id);
                        // Only catalog components can be selected by the
                        // Product workspace. Ambiguous/orphan feed scopes are
                        // audit buckets, not invented component identities.
                        if (
                          id !== undefined &&
                          (id === "assembly" ||
                            snapshot.components.components.some((component) =>
                              component.id === id
                            ))
                        ) {
                          setSelectedComponentId(id);
                        }
                      }}
                      onFollowLiveChange={changeFollowLive}
                      onSelectNode={(node) =>
                        selectGraphNode(node, { pauseLive: true })}
                      onSelectEdge={(edge) => {
                        setGraphSelection({
                          kind: "edge",
                          id: edge.id,
                          occurrence: {
                            key: versionedProvenance.memberOccurrenceKeyByEdge
                              .get(edge) ?? versionedEdgeOccurrenceKey(edge),
                            edge,
                          },
                        });
                        setDrawerMode("tool");
                        setInspectorOpen(true);
                      }}
                      onInspect={(next, node) => {
                        setSelection(next);
                        setLineageFocus(node.ref);
                        setDrawerMode("tool");
                        setInspectorOpen(true);
                      }}
                      onOpenEvidenceAnchored={openEvidenceAnchored}
                      onOpenReviewEvidence={openPublishedEvidence}
                    />
                  )
                  : activeView === "verification"
                  ? (
                    <section
                      class="thread-versioned-provenance"
                      aria-labelledby="thread-versioned-provenance-title"
                    >
                      <header>
                        <div>
                          <p>CURRENT EVIDENCE MAP</p>
                          <h4 id="thread-versioned-provenance-title">
                            Trace the evidence behind the current design
                          </h4>
                          <span>
                            {evidenceCanvas.isFiltered
                              ? "Local view — select the canvas background to return to the full map."
                              : "Select a result, requirement or component to see what supports it and what it affects. Previous versions stay inside the selected node."}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "var(--space-12)",
                            alignItems: "center",
                          }}
                        >
                          <span>
                            {evidenceCanvas.isFiltered
                              ? `${
                                evidenceMode === "exploration"
                                  ? explorationLocalVisibleCount
                                  : carteLocalVisibleCount
                              } facts shown · local view · depth ${localDepth}`
                              : evidenceMode === "exploration"
                              ? (() => {
                                const kp = explorationKindProjectionMemo ??
                                  evidenceCanvas;
                                const parts: string[] = [
                                  `${kp.displayedCount} facts shown`,
                                ];
                                const totalFolded = kp.foldedInstrumentCount +
                                  versionedProvenance.collapsedVersionCount;
                                if (totalFolded > 0) {
                                  parts.push(`${totalFolded} folded`);
                                }
                                if (kp.supportingNodeCount > 0) {
                                  parts.push(
                                    `${kp.supportingNodeCount} hidden by type`,
                                  );
                                }
                                return parts.join(" · ");
                              })()
                              : (() => {
                                // Carte mode full map — essential-filter
                                // projection, unchanged.
                                const essentialCount =
                                  evidenceCanvas.displayedCount;
                                const totalFolded =
                                  evidenceCanvas.foldedInstrumentCount +
                                  versionedProvenance.collapsedVersionCount;
                                const parts: string[] = [
                                  `${essentialCount} facts shown`,
                                ];
                                if (totalFolded > 0) {
                                  parts.push(`${totalFolded} folded`);
                                }
                                if (evidenceCanvas.supportingNodeCount > 0) {
                                  parts.push(
                                    `${evidenceCanvas.supportingNodeCount} outside the current view`,
                                  );
                                }
                                return parts.join(" · ");
                              })()}
                          </span>
                          <div
                            class="evidence-graph-mode-toggle"
                            role="group"
                            aria-label="Graph rendering mode"
                          >
                            <button
                              type="button"
                              aria-pressed={evidenceMode === "exploration"}
                              onClick={() => setEvidenceMode("exploration")}
                            >
                              Exploration
                            </button>
                            <button
                              type="button"
                              aria-pressed={evidenceMode === "carte"}
                              onClick={() => setEvidenceMode("carte")}
                            >
                              Map
                            </button>
                          </div>
                        </div>
                      </header>
                      {evidenceMode === "exploration" && (
                        <div class="evidence-graph-menu">
                          <button
                            type="button"
                            class="evidence-graph-menu-toggle"
                            aria-expanded={graphMenuOpen}
                            aria-label="Graph settings"
                            title="Graph settings"
                            onClick={() => setGraphMenuOpen(!graphMenuOpen)}
                          >
                            ☰
                          </button>
                          {graphMenuOpen && (
                            <div class="evidence-graph-menu-panel">
                              {evidenceCanvas.isFiltered && (
                                <>
                                  <p class="evidence-graph-menu-label">
                                    NEIGHBOR DEPTH
                                  </p>
                                  <div
                                    class="evidence-graph-mode-toggle"
                                    role="group"
                                    aria-label="Local neighborhood depth"
                                  >
                                    {([1, 2, 3] as const).map((depth) => (
                                      <button
                                        key={depth}
                                        type="button"
                                        aria-pressed={localDepth === depth}
                                        title={`Show neighbors up to depth ${depth}`}
                                        onClick={() => setLocalDepth(depth)}
                                      >
                                        {depth}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                              <p class="evidence-graph-menu-label">
                                SHOW
                              </p>
                              {(Object.keys(
                                DISPLAY_KIND_LABELS,
                              ) as DisplayKind[]).map(
                                (kind) => {
                                  if (!presentKinds.has(kind)) return null;
                                  const currentKinds = evidenceCanvas.isFiltered
                                    ? explorationLocalKinds
                                    : explorationMapKinds;
                                  const setCurrentKinds = evidenceCanvas
                                      .isFiltered
                                    ? setExplorationLocalKinds
                                    : setExplorationMapKinds;
                                  return (
                                    <label
                                      key={kind}
                                      class="evidence-graph-menu-check"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={currentKinds[kind]}
                                        onChange={(event) =>
                                          setCurrentKinds((prev) => ({
                                            ...prev,
                                            [kind]:
                                              (event.target as HTMLInputElement)
                                                .checked,
                                          }))}
                                      />
                                      {DISPLAY_KIND_LABELS[kind]}
                                    </label>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {evidenceMode === "carte" && (
                        <>
                          <div
                            class="thread-graph-legend"
                            aria-label="Graph legend"
                          >
                            <span data-tone="source">upstream evidence</span>
                            <span data-tone="focus">selected fact</span>
                            <span data-tone="impact">downstream impact</span>
                            <span data-tone="attested">
                              verified fingerprint
                            </span>
                            <span data-tone="mismatch">
                              fingerprint mismatch
                            </span>
                          </div>
                          <ThreadGraph
                            nodes={carteNodes as ThreadGraphNode[]}
                            edges={carteEdges as ThreadGraphEdge[]}
                            selection={visibleGraphSelection(
                              versionedProvenance,
                              graphSelection,
                              graphSelectionIndex,
                            )}
                            focus={visibleGraphRef(
                              versionedProvenance,
                              lineageFocus,
                            )}
                            presentation="canvas"
                            initialZoom={2.25}
                            showSupporting
                            showDensityControl={false}
                            onSelectionChange={selectVerificationGraphItem}
                            onInspect={inspectVerificationGraphItem}
                            componentLabeler={evidenceComponentLabeler}
                          />
                        </>
                      )}
                      {evidenceMode === "exploration" && (
                        <EvidenceExploration
                          evidenceModel={evidenceModel}
                          projection={evidenceCanvas.isFiltered
                            ? evidenceCanvas
                            : (explorationKindProjectionMemo ?? evidenceCanvas)}
                          displayDepth={evidenceCanvas.isFiltered
                            ? localDepth
                            : undefined}
                          visibleKinds={evidenceCanvas.isFiltered
                            ? explorationLocalKinds
                            : undefined}
                          selection={visibleGraphSelection(
                            versionedProvenance,
                            graphSelection,
                            graphSelectionIndex,
                          )}
                          focus={visibleGraphRef(
                            versionedProvenance,
                            lineageFocus,
                          )}
                          onSelectionChange={selectVerificationGraphItem}
                        />
                      )}
                    </section>
                  )
                  : activeView === "product"
                  ? (
                    <ComponentWorkspace
                      snapshot={snapshot}
                      activeProvider={activeComponentProvider}
                      selectedComponentId={selectedComponentId}
                      onProviderChange={changeComponentProvider}
                      onComponentSelect={selectComponent}
                      onBindingSelect={inspectComponentBinding}
                      onRevisionOpen={(node) => {
                        selectGraphNode(node, { inspect: false });
                        changeView("work");
                      }}
                    />
                  )
                  : (
                    <ProjectOperations
                      project={project}
                      thread={snapshot}
                    />
                  )}
              </div>
              {inspectorOpen && inspector}
            </div>
          </section>
        )}
    </div>
  );
}

function AgentNowSession({
  project,
  presentation,
}: {
  project: EngineeringWorkbenchSnapshot["project"];
  presentation: ReturnType<typeof buildAgentNowPresentation>;
}): JSX.Element {
  if (presentation.kind === "active-run") {
    return (
      <>
        <small>AGENT NOW</small>
        <strong>{agentRunSummary(project, presentation.run)}</strong>
      </>
    );
  }
  if (presentation.kind === "current-work") {
    return (
      <>
        <small>AGENT NOW</small>
        <strong>{presentation.work.title}</strong>
      </>
    );
  }
  if (presentation.kind === "last-settled-run") {
    return (
      <>
        <small>LAST AGENT RUN</small>
        <strong>
          {presentation.run.status.replaceAll("-", " ")} · {formatTime(
            agentRunRecordedAt(presentation.run),
          )}
        </strong>
      </>
    );
  }
  return (
    <>
      <small>AGENT NOW</small>
      <strong>No active work recorded</strong>
    </>
  );
}

/**
 * Planning receives status-only live milestones without a project revision.
 * The generic evidence comparator intentionally rejects equal-revision
 * planning snapshots, so keep this narrow exception at the composition edge.
 */
function shouldAcceptPlanningActivityUpdate(
  current: EngineeringWorkbenchSnapshot,
  incoming: EngineeringWorkbenchSnapshot,
): boolean {
  return current.surface === "planning" && incoming.surface === "planning" &&
    incoming.planning.activity.version > current.planning.activity.version;
}

function workspaceEyebrow(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") return "AGENT ACTIVITY · SHARED RECORD";
  if (view === "product") return "PRODUCT EXPLORER";
  if (view === "verification") return "EVIDENCE & IMPACT";
  return "EXECUTION HISTORY";
}

function workspaceTitle(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") return "Follow the work as it happens";
  if (view === "product") return "Explore one product across its tools";
  if (view === "verification") return "Understand evidence and impact";
  return "Review execution history and the work plan";
}

function workspaceDescription(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") {
    return "Validated results appear here as the agent works. The feed explains what changed and what it affects; it never exposes private reasoning.";
  }
  if (view === "product") {
    return "Choose a component to see its matching system, CAD and ERP records without leaving the project.";
  }
  if (view === "verification") {
    return "Follow a recorded result back to its sources and forward to its consequences. Only recorded links are treated as cause and effect.";
  }
  return "See what the agent ran, what is planned next, and which tools contributed evidence to this project.";
}

function GraphEdgeInspector({ snapshot, edge, history, onSelectGraphNode }: {
  snapshot: ThreadWorkbenchSnapshot;
  edge: ThreadGraphEdge;
  history?: VersionedProvenanceEdgeGroup;
  onSelectGraphNode: (node: ThreadGraphNode) => void;
}): JSX.Element {
  const source = graphNodeByRef(snapshot, edge.from);
  const target = graphNodeByRef(snapshot, edge.to);
  const tone: PresentationTone = edge.attestation?.status === "mismatch"
    ? "danger"
    : edge.attestation?.status === "verified"
    ? "success"
    : "info";
  const facts: KeyValueItem[] = [
    { id: "origin", label: "Evidence class", value: edge.origin },
    {
      id: "relation",
      label: "Relation",
      value: <code>{edge.relation}</code>,
    },
  ];
  if (edge.attestation) {
    facts.push(
      {
        id: "verified",
        label: "Checked",
        value: formatDateTime(edge.attestation.checkedAt),
      },
      {
        id: "producer-hash",
        label: "Producer hash",
        value: <code>{edge.attestation.producerFingerprint}</code>,
      },
      {
        id: "consumer-hash",
        label: "Consumed hash",
        value: <code>{edge.attestation.consumedFingerprint}</code>,
      },
    );
  }

  return (
    <Card
      className="thread-card thread-edge-inspector"
      eyebrow="SELECTED HANDOFF"
      title={relationTitle(edge.relation)}
      actions={<Badge tone={tone}>{edge.origin}</Badge>}
    >
      <p class="thread-inspector-lead">{edge.rationale}</p>
      <div class="thread-edge-route">
        <GraphEndpoint
          label="SOURCE / UPSTREAM"
          node={source}
          onSelect={onSelectGraphNode}
        />
        <span aria-hidden="true">→</span>
        <GraphEndpoint
          label="RESULT / DOWNSTREAM"
          node={target}
          onSelect={onSelectGraphNode}
        />
      </div>
      <KeyValueList items={facts} />
      {history && history.members.length > 1 && (
        <details class="thread-version-relations thread-edge-history">
          <summary>Recorded handoffs ({history.members.length})</summary>
          <ul>
            {history.members.map((member, index) => (
              <li key={member.id}>
                <strong>
                  {member.id === history.representative.id
                    ? "CURRENT HANDOFF"
                    : `EARLIER HANDOFF ${index + 1}`}
                </strong>
                <code>{relationLabel(member.relation)}</code>
                <span>{member.rationale}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {edge.attestation && (
        <StateMessage
          title={edge.attestation.status === "verified"
            ? "Exact consumed bytes verified"
            : "Producer / consumer bytes differ"}
          tone={edge.attestation.status === "verified" ? "success" : "danger"}
        >
          {edge.attestation.status === "verified"
            ? "This handoff is backed by matching producer and consumer fingerprints."
            : "This dependency cannot support a current verdict until the consumer is rerun with the recorded producer bytes."}
        </StateMessage>
      )}
      {!edge.attestation && (
        <StateMessage title="Recorded semantic relation" tone="info">
          This edge comes from an explicit canonical relation. It is not a
          byte-level consumption attestation.
        </StateMessage>
      )}
    </Card>
  );
}

function GraphEndpoint({ label, node, onSelect }: {
  label: string;
  node?: ThreadGraphNode;
  onSelect: (node: ThreadGraphNode) => void;
}): JSX.Element {
  if (!node) {
    return (
      <div class="thread-edge-endpoint" data-missing="true">
        <small>{label}</small>
        <strong>Endpoint unavailable</strong>
      </div>
    );
  }
  return (
    <button
      class="thread-edge-endpoint"
      type="button"
      onClick={() => onSelect(node)}
    >
      <small>{label}</small>
      <strong>{node.label}</strong>
      <span>{node.system} · {node.entityKind}</span>
    </button>
  );
}

function SelectionInspector({ snapshot, selection, onSelect }: {
  snapshot: ThreadWorkbenchSnapshot;
  selection: ThreadRef;
  onSelect: (selection: ThreadRef) => void;
}): JSX.Element {
  if (selection.kind === "change") {
    return <ChangeInspector snapshot={snapshot} />;
  }
  if (selection.kind === "artifact") {
    const artifact = snapshot.artifacts.find((item) =>
      item.id === selection.id
    );
    return artifact
      ? (
        <ArtifactInspector
          snapshot={snapshot}
          artifact={artifact}
          onSelect={onSelect}
        />
      )
      : <EmptyState>Artifact not present in this snapshot.</EmptyState>;
  }
  if (selection.kind === "observation") {
    const observation = snapshot.observations.find((item) =>
      item.id === selection.id
    );
    return observation
      ? (
        <ObservationInspector
          snapshot={snapshot}
          observation={observation}
          onSelect={onSelect}
        />
      )
      : <EmptyState>Observation not present in this snapshot.</EmptyState>;
  }
  if (selection.kind === "requirement") {
    const requirement = snapshot.requirements.find((item) =>
      item.id === selection.id
    );
    return requirement
      ? (
        <RequirementInspector
          snapshot={snapshot}
          requirement={requirement}
          onSelect={onSelect}
        />
      )
      : <EmptyState>Requirement not present in this snapshot.</EmptyState>;
  }
  const violation = snapshot.violations.find((item) =>
    item.id === selection.id
  );
  return violation
    ? (
      <ViolationInspector
        snapshot={snapshot}
        violation={violation}
        onSelect={onSelect}
      />
    )
    : <EmptyState>Violation not present in this snapshot.</EmptyState>;
}

function InspectorShell({ eyebrow, title, tone, children }: {
  eyebrow: string;
  title: string;
  tone: PresentationTone;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <Card
      className="thread-card thread-inspector-card"
      eyebrow={eyebrow}
      title={title}
      actions={<Badge tone={tone}>{eyebrow}</Badge>}
    >
      {children}
    </Card>
  );
}

function ChangeInspector(
  { snapshot }: { snapshot: ThreadWorkbenchSnapshot },
): JSX.Element {
  const change = snapshot.change;
  const state = changeState(snapshot);
  const facts: KeyValueItem[] = [
    { id: "author", label: "Changed by", value: change.author },
    {
      id: "revision",
      label: "Revision",
      value: <code>{change.revision}</code>,
    },
    {
      id: "time",
      label: "Changed",
      value: formatDateTime(change.changedAt),
    },
  ];
  if (change.files.length) {
    facts.push({
      id: "files",
      label: "Touched",
      value: change.files.join(" · "),
    });
  }
  return (
    <InspectorShell eyebrow="REVISION" title={change.id} tone="info">
      <p class="thread-inspector-lead">{change.summary}</p>
      <KeyValueList items={facts} />
      <StateMessage title={state.title} tone={state.tone}>
        {state.message}
      </StateMessage>
      <ActionList actions={snapshot.actions} />
    </InspectorShell>
  );
}

function ArtifactInspector({ snapshot, artifact, onSelect }: {
  snapshot: ThreadWorkbenchSnapshot;
  artifact: ThreadArtifact;
  onSelect: (selection: ThreadRef) => void;
}): JSX.Element {
  const downstream = snapshot.artifacts.filter((item) =>
    item.dependsOn.includes(artifact.id)
  );
  return (
    <InspectorShell
      eyebrow={artifact.kind}
      title={artifact.label}
      tone={freshnessTone(artifact.freshness)}
    >
      <KeyValueList items={artifactFacts(artifact)} />
      {artifact.freshness === "stale" && (
        <StateMessage title="Evidence invalidated" tone="warning">
          This result predates a dependency. It remains available for provenance
          but cannot support a current verdict.
        </StateMessage>
      )}
      {artifact.attestation && (
        <StateMessage
          title={artifact.attestation.status === "verified"
            ? "Producer / consumer hash verified"
            : "Producer / consumer hash mismatch"}
          tone={artifact.attestation.status === "verified"
            ? "success"
            : "danger"}
        >
          {artifact.attestation.status === "verified"
            ? "The consumer used the exact fingerprint emitted by its upstream producer."
            : "This result consumed a different upstream fingerprint and cannot support the current verdict."}
        </StateMessage>
      )}
      <RelationLinks
        title="Depends on"
        refs={artifact.dependsOn.map((id) => ({
          kind: "artifact" as const,
          id,
        }))}
        snapshot={snapshot}
        onSelect={onSelect}
      />
      <RelationLinks
        title="Invalidates / feeds"
        refs={downstream.map((item) => ({
          kind: "artifact" as const,
          id: item.id,
        }))}
        snapshot={snapshot}
        onSelect={onSelect}
      />
    </InspectorShell>
  );
}

function ObservationInspector({ snapshot, observation, onSelect }: {
  snapshot: ThreadWorkbenchSnapshot;
  observation: ThreadObservation;
  onSelect: (selection: ThreadRef) => void;
}): JSX.Element {
  const artifact = snapshot.artifacts.find((item) =>
    item.id === observation.sourceArtifactId
  );
  return (
    <InspectorShell
      eyebrow="OBSERVATION"
      title={observation.label}
      tone={freshnessTone(observation.freshness)}
    >
      <div class="thread-inspector-value">
        <strong>{observation.display}</strong>
        <Freshness freshness={observation.freshness} />
      </div>
      <KeyValueList
        items={[
          {
            id: "id",
            label: "Stable id",
            value: <code>{observation.id}</code>,
          },
          {
            id: "source",
            label: "Source",
            value: artifact?.label ?? observation.sourceArtifactId,
          },
          {
            id: "measured",
            label: "Measured",
            value: formatDateTime(observation.measuredAt),
          },
        ]}
      />
      <RelationLinks
        title="Evaluates"
        refs={observation.requirementIds.map((id) => ({
          kind: "requirement" as const,
          id,
        }))}
        snapshot={snapshot}
        onSelect={onSelect}
      />
      {artifact && (
        <Toolbar label="Observation provenance">
          <Button
            onClick={() => onSelect({ kind: "artifact", id: artifact.id })}
          >
            Trace source artifact →
          </Button>
        </Toolbar>
      )}
    </InspectorShell>
  );
}

function RequirementInspector({ snapshot, requirement, onSelect }: {
  snapshot: ThreadWorkbenchSnapshot;
  requirement: ThreadRequirement;
  onSelect: (selection: ThreadRef) => void;
}): JSX.Element {
  return (
    <InspectorShell
      eyebrow={requirement.id}
      title={requirement.label}
      tone={verdictTone(requirement.status)}
    >
      <div class="thread-expression">{requirement.expression}</div>
      <p class="thread-inspector-lead">{requirement.rationale}</p>
      <KeyValueList
        items={[
          { id: "source", label: "Authority", value: requirement.source },
          { id: "status", label: "Verdict", value: requirement.status },
        ]}
      />
      <RelationLinks
        title="Computed from"
        refs={requirement.observationIds.map((id) => ({
          kind: "observation" as const,
          id,
        }))}
        snapshot={snapshot}
        onSelect={onSelect}
      />
      <RelationLinks
        title="Named violations"
        refs={requirement.violationIds.map((id) => ({
          kind: "violation" as const,
          id,
        }))}
        snapshot={snapshot}
        onSelect={onSelect}
      />
    </InspectorShell>
  );
}

function ViolationInspector({ snapshot, violation, onSelect }: {
  snapshot: ThreadWorkbenchSnapshot;
  violation: ThreadViolation;
  onSelect: (selection: ThreadRef) => void;
}): JSX.Element {
  const actions = snapshot.actions.filter((action) =>
    violation.proposedActionIds.includes(action.id)
  );
  return (
    <InspectorShell eyebrow={violation.id} title={violation.name} tone="danger">
      <div class="thread-violation-banner">
        <span>BLOCKING</span>
        <strong>{violation.margin}</strong>
      </div>
      <p class="thread-inspector-lead">{violation.message}</p>
      <RelationLinks
        title="Failed requirement"
        refs={[{ kind: "requirement", id: violation.requirementId }]}
        snapshot={snapshot}
        onSelect={onSelect}
      />
      <RelationLinks
        title="Computed evidence"
        refs={[{ kind: "observation", id: violation.observationId }]}
        snapshot={snapshot}
        onSelect={onSelect}
      />
      <ActionList actions={actions} />
    </InspectorShell>
  );
}

function ActionList({ actions }: {
  actions: ThreadAction[];
}): JSX.Element | null {
  if (!actions.length) return null;
  return (
    <div class="thread-actions">
      <div class="thread-relation-title">
        <span>Proposed next actions</span>
        <small>discuss with the agent</small>
      </div>
      {actions.map((action, index) => (
        <article key={action.id} data-readiness={action.readiness}>
          <span>{pad(index + 1)}</span>
          <div>
            <strong>{action.label}</strong>
            <small>{action.description}</small>
          </div>
          <b>
            {action.readiness === "blocked" ? "Blocked" : action.readiness}
          </b>
        </article>
      ))}
    </div>
  );
}

function RelationLinks({ title, refs, snapshot, onSelect }: {
  title: string;
  refs: ThreadRef[];
  snapshot: ThreadWorkbenchSnapshot;
  onSelect: (selection: ThreadRef) => void;
}): JSX.Element | null {
  if (!refs.length) return null;
  return (
    <div class="thread-relations">
      <div class="thread-relation-title">
        <span>{title}</span>
      </div>
      {refs.map((ref) => (
        <button
          type="button"
          key={`${ref.kind}:${ref.id}`}
          onClick={() => onSelect(ref)}
        >
          <code>{ref.id}</code>
          <span>{refLabel(snapshot, ref)}</span>
          <b aria-hidden="true">↗</b>
        </button>
      ))}
    </div>
  );
}

function Freshness({ freshness }: { freshness: ThreadFreshness }): JSX.Element {
  return (
    <span class="thread-freshness" data-state={freshness}>
      <i aria-hidden="true" />
      {freshness}
    </span>
  );
}

/**
 * A completed replacement closes only the exact action target declared by the
 * project lifecycle projection. The raw action and every attempt stay in the
 * Activity feed and inspector; this calm canvas simply does not offer an
 * already-closed obligation as if it were current work.
 */
function graphWithoutClosedActions(
  graph: ThreadGraphData,
  actions: readonly ThreadAction[],
  closedActionTargetIds: ReadonlySet<string>,
): ThreadGraphData {
  if (closedActionTargetIds.size === 0) return graph;
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const nodes = graph.nodes.filter((node) => {
    if (node.entityKind !== "action") return true;
    const action = actionById.get(node.ref.id);
    return !action || !closedActionTargetIds.has(`artifact:${action.targetId}`);
  });
  const visible = new Set(nodes.map((node) => versionedRefKey(node.ref)));
  return {
    nodes,
    edges: graph.edges.filter((edge) =>
      visible.has(versionedRefKey(edge.from)) &&
      visible.has(versionedRefKey(edge.to))
    ),
  };
}

function summaryMetrics(snapshot: ThreadWorkbenchSnapshot): MetricItem[] {
  const artifacts = currentArtifacts(
    snapshot.artifacts,
    snapshot.evidenceFamilyGraph,
  );
  const historicalArtifactCount = snapshot.artifacts.length - artifacts.length;
  const fresh = artifacts.filter((item) => item.freshness === "fresh").length;
  const stale = artifacts.filter((item) => item.freshness === "stale").length;
  const requirements = currentRequirements(
    snapshot.requirements,
    snapshot.evidenceFamilyGraph,
  );
  const historicalRequirementCount = snapshot.requirements.length -
    requirements.length;
  const passed = requirements.filter((item) => item.status === "pass").length;
  const failed = requirements.filter((item) => item.status === "fail").length;
  const noCriterion = requirements.length === 0;
  const linkedEntities =
    snapshot.flow.filter((stage) => stage.selection.kind !== "change").length;
  const branchCount =
    evidenceBranches(snapshot.flow).filter((branch) => branch.id !== "thread")
      .length;
  return [
    {
      id: "impact",
      label: "Linked evidence",
      value: linkedEntities,
      unit: "entities",
      detail: `across ${branchCount} independent domain branches`,
      tone: "info",
    },
    {
      id: "evidence",
      label: "Evidence currency",
      value: artifacts.length,
      unit: `current${
        historicalArtifactCount > 0
          ? ` · ${historicalArtifactCount} historical`
          : ""
      }`,
      detail: stale > 0
        ? `${fresh} fresh · ${stale} current stale`
        : `${fresh} current fresh`,
      tone: stale ? "warning" : "success",
    },
    {
      id: "requirements",
      label: "Requirements",
      value: noCriterion ? 0 : `${passed}/${requirements.length}`,
      unit: noCriterion ? "modelled" : "passing",
      detail: noCriterion
        ? "No model-owned criterion"
        : `${failed} failed · ${
          requirements.length - passed - failed
        } unresolved` +
          (historicalRequirementCount > 0
            ? ` · ${historicalRequirementCount} prior version${
              historicalRequirementCount === 1 ? "" : "s"
            } in history`
            : ""),
      tone: noCriterion ? "warning" : failed ? "danger" : "success",
    },
    {
      id: "violations",
      label: "Named violations",
      value: snapshot.violations.length,
      unit: "open",
      detail: snapshot.violations[0]?.id ??
        (noCriterion ? "verdict unavailable" : "no active violation"),
      tone: snapshot.violations.length
        ? "danger"
        : noCriterion
        ? "warning"
        : "success",
    },
  ];
}

function changeState(snapshot: ThreadWorkbenchSnapshot): {
  title: string;
  message: string;
  tone: PresentationTone;
} {
  if (snapshot.requirements.length === 0) {
    return {
      title: "Verification criterion missing",
      message:
        "The engineering evidence is linked to this declared subject and the CAD to FEA input is hash-attested, but no model-owned mechanical criterion is available. The observed values cannot be called compliant or non-compliant yet.",
      tone: "warning",
    };
  }
  if (snapshot.change.status === "evaluated") {
    return {
      title: "Impact evaluation is current",
      message:
        "Every modelled requirement in this snapshot has a current evaluation. Review named violations before closing the change.",
      tone: snapshot.violations.length ? "danger" : "success",
    };
  }
  if (snapshot.change.status === "partially_evaluated") {
    return {
      title: "Impact evaluation is partial",
      message:
        "Some modelled requirements still lack current evidence. Recompute only the explicitly selected stale branch.",
      tone: "warning",
    };
  }
  return {
    title: "Impact evaluation pending",
    message:
      "The snapshot contains modelled requirements but no current evaluation for this change.",
    tone: "warning",
  };
}

interface EvidenceBranch {
  id: "thread" | "system" | "mechanical" | "thermal" | "enterprise" | "other";
  label: string;
  systems: string[];
  stages: ThreadFlowStage[];
}

function evidenceBranches(stages: ThreadFlowStage[]): EvidenceBranch[] {
  const branches = new Map<EvidenceBranch["id"], EvidenceBranch>();
  for (const stage of stages) {
    const definition = branchDefinition(stage.system);
    const existing = branches.get(definition.id);
    if (existing) {
      existing.stages.push(stage);
      if (!existing.systems.includes(stage.system)) {
        existing.systems.push(stage.system);
      }
      continue;
    }
    branches.set(definition.id, {
      ...definition,
      systems: [stage.system],
      stages: [stage],
    });
  }
  const order: EvidenceBranch["id"][] = [
    "thread",
    "system",
    "mechanical",
    "thermal",
    "enterprise",
    "other",
  ];
  return order.flatMap((id) => {
    const branch = branches.get(id);
    return branch ? [branch] : [];
  });
}

function branchDefinition(
  system: string,
): Pick<EvidenceBranch, "id" | "label"> {
  const normalized = system.toLowerCase();
  if (normalized.includes("digital-thread")) {
    return { id: "thread", label: "Thread revision" };
  }
  if (normalized.includes("syson")) {
    return { id: "system", label: "System model" };
  }
  if (normalized.includes("build123d") || normalized.includes("calculix")) {
    return { id: "mechanical", label: "Mechanical evidence" };
  }
  if (normalized.includes("modelica")) {
    return { id: "thermal", label: "Thermal evidence" };
  }
  if (normalized.includes("erpnext")) {
    return { id: "enterprise", label: "Enterprise evidence" };
  }
  return { id: "other", label: "Other evidence" };
}

function graphNodeByRef(
  snapshot: ThreadWorkbenchSnapshot,
  reference: ThreadGraphRef,
): ThreadGraphNode | undefined {
  return snapshot.graph.nodes.find((node) =>
    node.ref.kind === reference.kind && node.ref.id === reference.id
  );
}

function relationTitle(relation: ThreadGraphEdge["relation"]): string {
  return relation
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function relationLabel(relation: ThreadGraphEdge["relation"]): string {
  return relation.replaceAll("_", " ");
}

function artifactFacts(artifact: ThreadArtifact): KeyValueItem[] {
  const facts: KeyValueItem[] = [
    {
      id: "revision",
      label: "Revision",
      value: <code>{artifact.revision}</code>,
    },
    {
      id: "system",
      label: "Produced by",
      value: artifact.producedBy ?? artifact.system,
    },
    {
      id: "time",
      label: "Produced",
      value: formatDateTime(artifact.producedAt),
    },
    {
      id: "fingerprint",
      label: "Fingerprint",
      value: <code>{artifact.fingerprint ?? "not recorded"}</code>,
    },
    {
      id: "uri",
      label: "Artifact URI",
      value: <code>{artifact.uri ?? "not persisted"}</code>,
    },
  ];
  if (artifact.attestation) {
    facts.push(
      {
        id: "producer-hash",
        label: "Producer hash",
        value: <code>{artifact.attestation.producerFingerprint}</code>,
      },
      {
        id: "consumer-hash",
        label: "Consumed hash",
        value: <code>{artifact.attestation.consumedFingerprint}</code>,
      },
    );
  }
  return facts;
}

function refLabel(snapshot: ThreadWorkbenchSnapshot, ref: ThreadRef): string {
  if (ref.kind === "change") return snapshot.change.title;
  if (ref.kind === "artifact") {
    return snapshot.artifacts.find((item) => item.id === ref.id)?.label ??
      ref.id;
  }
  if (ref.kind === "observation") {
    return snapshot.observations.find((item) => item.id === ref.id)?.label ??
      ref.id;
  }
  if (ref.kind === "requirement") {
    return snapshot.requirements.find((item) => item.id === ref.id)?.label ??
      ref.id;
  }
  return snapshot.violations.find((item) => item.id === ref.id)?.name ?? ref.id;
}

function freshnessTone(freshness: ThreadFreshness): PresentationTone {
  if (freshness === "fresh") return "success";
  if (freshness === "stale" || freshness === "running") return "warning";
  return "danger";
}

function verdictTone(status: ThreadRequirement["status"]): PresentationTone {
  if (status === "pass") return "success";
  if (status === "fail") return "danger";
  return "warning";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function streamStatusLabel(
  status: ThreadStreamStatus | "snapshot",
  followLive: boolean,
): string {
  if (!followLive) return "History under review";
  if (status === "live") return "Validated activity live";
  if (status === "connecting") return "Connecting activity stream";
  if (status === "reconnecting") return "Reconnecting activity stream";
  return "Persisted snapshot";
}

function mergeReviewIntentTransmission(
  current: ReadonlyMap<string, ReviewIntentTransmissionState>,
  restored: ReadonlyMap<string, ReviewIntentTransmissionState>,
): ReadonlyMap<string, ReviewIntentTransmissionState> {
  const next = new Map(restored);
  for (const [key, state] of current) {
    // Preserve an in-flight or locally reported state until the outbox can
    // observe it. When GET contains the exact scope, its queued/ack receipt is
    // authoritative and replaces the local transport state.
    if (!next.has(key) && state.kind !== "idle") next.set(key, state);
  }
  return next;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
