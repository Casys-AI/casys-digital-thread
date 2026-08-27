import { cn } from "../lib/utils.ts";
import { CARD_SURFACE, PAGE_EYEBROW } from "../ui/cockpit.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { EmptyNotice, Notice } from "../ui/notice.tsx";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { buildActivityReviewRecords } from "../project/review-decision-model.ts";
import {
  type AgentNowPresentation,
  agentPreparationDecisions,
  agentRunSummary,
  buildAgentNowPresentation,
  buildCurrentProjectWork,
  pendingHumanConfirmationDecisions,
} from "../project/model.ts";
import {
  ProjectCockpitHeader,
  ProjectNavigation,
  type ProjectWorkspaceView,
} from "../project/navigation.tsx";
import {
  DEFAULT_PRODUCT_FACET,
  parseProjectLocationHash,
  parseProjectViewHash,
  productFacetHash,
  productFacetLabel,
  type ProductWorkspaceFacet,
  projectDeepLinkDomId,
  projectDeepLinkHash,
  type ProjectDeepLinkTarget,
  projectViewHash,
  shouldScrollProjectDeepLink,
} from "../project/navigation-model.ts";
import { DocumentaryBaselineWorkbench } from "../project/documentary-baseline-workbench.tsx";
import { ProductRequirementsMatrix } from "../project/product-requirements-matrix.tsx";
import { productSourcingCoverage } from "../project/product-requirements-model.ts";
import { ProductSourcingLane } from "../project/product-sourcing.tsx";
import { ProjectOverview } from "../project/overview.tsx";
import { PlanningWorkbench } from "../project/planning-workbench.tsx";
import { ProjectOperations, ProjectWorkRibbon } from "../project/work.tsx";
import {
  type CockpitFleetClient,
  type ThreadStreamStatus,
  type ThreadWorkbenchClient,
} from "./client.ts";
import type { CockpitFleetProjection } from "../../../presentation/workbench/fleet/projection.ts";
import { activityFeedNodes, type FeedScope } from "./feed-model.ts";
import { shouldAcceptWorkbenchUpdate } from "./live-update.ts";
import { ThreadFeed } from "./feed.tsx";
import { type ThreadGraphSelection } from "./graph.tsx";
import {
  buildEvidenceCanvasProjection,
  buildExplorationKindProjection,
  isFoldedEvidenceNode,
  linkedEvidenceDetail,
  paintedDossierMetric,
} from "./evidence-canvas-model.ts";
import {
  DISPLAY_KIND_LABELS,
  type DisplayKind,
  displayKindOf,
} from "./evidence-exploration-model.ts";
import {
  buildEvidenceGraphModel,
  type EvidenceGraphModel,
  graphWithoutAnalysisOverlay,
} from "./evidence-graph-model.ts";
import { EvidenceExploration } from "./evidence-exploration.tsx";
import {
  filterGraphByVerificationCase,
  reconcileVerificationCaseContext,
  UNAVAILABLE_VERIFICATION_CASE_CATALOG,
  type VerificationCaseFilter,
} from "./verification-case-model.ts";
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

type PresentationTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

interface FactItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

interface MetricTileItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  tone?: PresentationTone;
}

const TONE_BADGE_VARIANT: Record<
  PresentationTone,
  NonNullable<BadgeProps["variant"]>
> = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
};

export interface ThreadWorkbenchProps {
  client: ThreadWorkbenchClient;
  /** Declared fleet topology; absent when the BFF has no manifest. */
  fleetClient?: CockpitFleetClient;
  /** Validated read-only projection focus for sibling Desktop capabilities. */
  onProjectFocus?: (projectId: string | undefined) => void;
}

export function ThreadWorkbench({
  client,
  fleetClient,
  onProjectFocus,
}: ThreadWorkbenchProps): JSX.Element {
  const [workbench, setWorkbench] = useState<EngineeringWorkbenchSnapshot>();
  const [fleet, setFleet] = useState<CockpitFleetProjection>();
  const [selection, setSelection] = useState<ThreadRef>();
  const [graphSelection, setGraphSelection] = useState<ThreadGraphSelection>();
  const [lineageFocus, setLineageFocus] = useState<ThreadGraphRef>();
  const [presentedVersionRef, setPresentedVersionRef] = useState<
    ThreadGraphRef
  >();
  const ignoreStageResetUntilRef = useRef(0);
  const [activeView, setActiveView] = useState<ProjectWorkspaceView>(() =>
    parseProjectViewHash(globalThis.location?.hash ?? "")
  );
  const [activeProductFacet, setActiveProductFacet] = useState<
    ProductWorkspaceFacet
  >(() =>
    parseProjectLocationHash(globalThis.location?.hash ?? "").productFacet ??
      DEFAULT_PRODUCT_FACET
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
  useEffect(() => {
    onProjectFocus?.(workbench?.project.project.id);
    return () => onProjectFocus?.(undefined);
  }, [onProjectFocus, workbench?.project.project.id]);
  // Evidence is one Graphology + dagre + Sigma canvas. The SVG Map layout
  // is not a second organisation of the same dossier.
  // Profondeur du voisinage en vue locale (façon Obsidian). Décision
  // opérateur 2026-08-08 : défaut 1 — les voisins immédiats seulement.
  const [localDepth, setLocalDepth] = useState<1 | 2 | 3>(1);
  const [verificationCaseFilter, setVerificationCaseFilter] = useState<
    VerificationCaseFilter
  >({ kind: "all" });
  // Panneau burger des réglages du graphe (fermé par défaut).
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
    "study-base-evaluation": true,
    "violation": true,
    "change": false,
    "consumption": false,
    "action": true,
    "analysis": true,
    "sysml-element": true,
    "cad-lever": true,
    "cad-unnamed-literal": true,
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
    "study-base-evaluation": true,
    "violation": true,
    "change": true,
    "consumption": true,
    "action": true,
    "analysis": true,
    "sysml-element": true,
    "cad-lever": true,
    "cad-unnamed-literal": true,
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
      if (location.view === "product") {
        setActiveProductFacet(
          location.productFacet ?? DEFAULT_PRODUCT_FACET,
        );
      }
    };
    globalThis.addEventListener("popstate", syncFromHash);
    globalThis.addEventListener("hashchange", syncFromHash);
    return () => {
      globalThis.removeEventListener("popstate", syncFromHash);
      globalThis.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  // Declared fleet topology is static workspace config: one read at mount,
  // no polling. Absence keeps `fleet` undefined and Operations degrades to
  // thread-observed systems.
  useEffect(() => {
    if (!fleetClient) return;
    const controller = new AbortController();
    fleetClient.load(controller.signal).then((projection) => {
      if (projection) setFleet(projection);
    });
    return () => controller.abort();
  }, [fleetClient]);

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

  const activityReviewRecords = workbench
    ? buildActivityReviewRecords(
      workbench.project,
      workbench.surface === "evidence" ? workbench.thread : undefined,
    )
    : [];

  // Keep one versioned object graph for the Evidence renderers and their
  // selection state. The Evidence-only removal of closed actions happens
  // before version folding, so the graph passed to sigma and the graph that
  // resolves highlighted edge occurrences are the same objects.
  const presentedMemberRef = presentedVersionRef;

  const evidenceRawGraphMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    const thread = workbench.thread;
    const closedIds = new Set(
      buildCurrentProjectWork(workbench.project).closedActionTargetIds,
    );
    return graphWithoutAnalysisOverlay(
      graphWithoutClosedActions(thread.graph, thread.actions, closedIds),
    );
  }, [workbench]);

  const versionedProvenanceMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") {
      return undefined;
    }
    if (!evidenceRawGraphMemo) return undefined;
    return buildVersionedProvenanceProjection(
      evidenceRawGraphMemo,
      workbench.thread.evidenceFamilyGraph,
      { presentedMemberRef },
    );
  }, [workbench, evidenceRawGraphMemo, presentedMemberRef]);

  const verificationRawGraphMemo = useMemo(() => {
    if (!evidenceRawGraphMemo) return undefined;
    return filterGraphByVerificationCase(
      evidenceRawGraphMemo,
      verificationCaseFilter,
    );
  }, [evidenceRawGraphMemo, verificationCaseFilter]);

  const verificationVersionedProvenanceMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!verificationRawGraphMemo) return undefined;
    return buildVersionedProvenanceProjection(
      verificationRawGraphMemo,
      workbench.thread.evidenceFamilyGraph,
      { presentedMemberRef },
    );
  }, [workbench, verificationRawGraphMemo, presentedMemberRef]);

  // Memoize evidenceModel on the workbench + presented version so sigma is
  // not killed on highlight/depth changes. Presenting a family member is a
  // real topology change and must rebuild.
  const evidenceModel = useMemo((): EvidenceGraphModel => {
    if (!workbench || workbench.surface !== "evidence") {
      return null as unknown as EvidenceGraphModel;
    }
    if (!evidenceRawGraphMemo) return null as unknown as EvidenceGraphModel;
    const thread = workbench.thread;
    return buildEvidenceGraphModel(
      evidenceRawGraphMemo,
      thread.evidenceFamilyGraph,
      {
        isAnalyzeInstrumentNode: isFoldedEvidenceNode,
        intentionallyIsolatedSystems: [
          "openmodelica",
          "mcp-modelica",
          "modelica",
        ],
        versionedProjection: versionedProvenanceMemo!,
      },
    );
  }, [workbench, evidenceRawGraphMemo, versionedProvenanceMemo]);

  const verificationEvidenceModelMemo = useMemo((): EvidenceGraphModel => {
    if (
      !workbench || workbench.surface !== "evidence" ||
      !verificationRawGraphMemo || !verificationVersionedProvenanceMemo
    ) {
      return null as unknown as EvidenceGraphModel;
    }
    return buildEvidenceGraphModel(
      verificationRawGraphMemo,
      workbench.thread.evidenceFamilyGraph,
      {
        isAnalyzeInstrumentNode: isFoldedEvidenceNode,
        intentionallyIsolatedSystems: [
          "openmodelica",
          "mcp-modelica",
          "modelica",
        ],
        versionedProjection: verificationVersionedProvenanceMemo,
      },
    );
  }, [
    workbench,
    verificationRawGraphMemo,
    verificationVersionedProvenanceMemo,
  ]);

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
  const fullMapCanvasMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!versionedProvenanceMemo || !evidenceModel) return undefined;
    return buildEvidenceCanvasProjection(
      evidenceModel,
      versionedProvenanceMemo.collapsedVersionCount,
      undefined,
      versionedProvenanceMemo.visibleRefByMemberRef,
    );
  }, [workbench, versionedProvenanceMemo, evidenceModel]);

  const evidenceCanvasMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!versionedProvenanceMemo || !evidenceModel || !fullMapCanvasMemo) {
      return undefined;
    }
    const focus = presentedMemberRef ?? lineageFocus;
    if (!focus) return fullMapCanvasMemo;
    return buildEvidenceCanvasProjection(
      evidenceModel,
      versionedProvenanceMemo.collapsedVersionCount,
      focus,
      versionedProvenanceMemo.visibleRefByMemberRef,
    );
  }, [
    workbench,
    versionedProvenanceMemo,
    evidenceModel,
    fullMapCanvasMemo,
    lineageFocus,
    presentedMemberRef,
  ]);

  // Kind-filtered projection for the full Evidence canvas. This projection
  // replaces the essential-filter projection when there is no focus. Changing
  // explorationMapKinds triggers a dagre remount — the re-layout on the
  // visible set is intentional (no gaps).
  const explorationKindProjectionMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!evidenceModel) return undefined;
    return buildExplorationKindProjection(
      evidenceModel,
      explorationMapKinds,
      versionedProvenanceMemo?.collapsedVersionCount ?? 0,
    );
  }, [evidenceModel, explorationMapKinds, versionedProvenanceMemo]);

  const verificationFullMapCanvasMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (
      !verificationVersionedProvenanceMemo || !verificationEvidenceModelMemo
    ) {
      return undefined;
    }
    return buildEvidenceCanvasProjection(
      verificationEvidenceModelMemo,
      verificationVersionedProvenanceMemo.collapsedVersionCount,
      undefined,
      verificationVersionedProvenanceMemo.visibleRefByMemberRef,
    );
  }, [
    workbench,
    verificationVersionedProvenanceMemo,
    verificationEvidenceModelMemo,
  ]);

  const verificationEvidenceCanvasMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (
      !verificationVersionedProvenanceMemo ||
      !verificationEvidenceModelMemo ||
      !verificationFullMapCanvasMemo
    ) return undefined;
    const focus = presentedMemberRef ?? lineageFocus;
    if (!focus) return verificationFullMapCanvasMemo;
    return buildEvidenceCanvasProjection(
      verificationEvidenceModelMemo,
      verificationVersionedProvenanceMemo.collapsedVersionCount,
      focus,
      verificationVersionedProvenanceMemo.visibleRefByMemberRef,
    );
  }, [
    workbench,
    verificationVersionedProvenanceMemo,
    verificationEvidenceModelMemo,
    verificationFullMapCanvasMemo,
    lineageFocus,
    presentedMemberRef,
  ]);

  const verificationKindProjectionMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!verificationEvidenceModelMemo) return undefined;
    return buildExplorationKindProjection(
      verificationEvidenceModelMemo,
      explorationMapKinds,
      verificationVersionedProvenanceMemo?.collapsedVersionCount ?? 0,
    );
  }, [
    workbench,
    verificationEvidenceModelMemo,
    explorationMapKinds,
    verificationVersionedProvenanceMemo,
  ]);

  // The renderer re-creates synthetic stub objects for each projection. Keep
  // one current occurrence index for the active canvas so a controlled keyed
  // selection can remap to that exact object, or be cleared after SSE if its
  // occurrence disappeared. Raw ids are intentionally absent from this path.
  const graphSelectionIndexMemo = useMemo(() => {
    if (!versionedProvenanceMemo || !evidenceCanvasMemo) return undefined;
    const activeProjection = !evidenceCanvasMemo.isFiltered
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
  ]);

  const verificationGraphSelectionIndexMemo = useMemo(() => {
    if (
      !verificationVersionedProvenanceMemo ||
      !verificationEvidenceCanvasMemo
    ) return undefined;
    const activeProjection = !verificationEvidenceCanvasMemo.isFiltered
      ? (verificationKindProjectionMemo ?? verificationEvidenceCanvasMemo)
      : verificationEvidenceCanvasMemo;
    return buildVersionedGraphSelectionIndex(
      verificationVersionedProvenanceMemo,
      activeProjection.edges.filter((edge) => edge.id.startsWith("stub:")),
    );
  }, [
    verificationVersionedProvenanceMemo,
    verificationEvidenceCanvasMemo,
    verificationKindProjectionMemo,
  ]);

  // An occurrence key is an exact selection contract. When a live snapshot
  // changes duplicate cardinality or removes a stub, do not let an inspector
  // retain a previous object or degrade to edge.id: close it deterministically.
  useEffect(() => {
    if (graphSelection?.kind !== "edge" || !graphSelection.occurrence) return;
    const activeVersionedProvenance = activeView === "verification"
      ? verificationVersionedProvenanceMemo
      : versionedProvenanceMemo;
    const activeSelectionIndex = activeView === "verification"
      ? verificationGraphSelectionIndexMemo
      : graphSelectionIndexMemo;
    if (!activeVersionedProvenance || !activeSelectionIndex) return;
    if (
      isStaleAmbiguousVersionedEdgeSelection(
        activeVersionedProvenance,
        graphSelection,
        activeSelectionIndex,
      )
    ) {
      setGraphSelection(undefined);
      setInspectorOpen(false);
    }
  }, [
    activeView,
    graphSelection,
    graphSelectionIndexMemo,
    verificationGraphSelectionIndexMemo,
    versionedProvenanceMemo,
    verificationVersionedProvenanceMemo,
  ]);

  useEffect(() => {
    if (
      !workbench || workbench.surface !== "evidence" ||
      !evidenceRawGraphMemo
    ) return;
    const transientRefs: ThreadGraphRef[] = [];
    if (graphSelection?.kind === "node") {
      transientRefs.push(graphSelection.ref);
    } else if (graphSelection?.kind === "edge" && graphSelection.occurrence) {
      transientRefs.push(
        graphSelection.occurrence.edge.from,
        graphSelection.occurrence.edge.to,
      );
    }
    if (lineageFocus) transientRefs.push(lineageFocus);
    if (presentedVersionRef) transientRefs.push(presentedVersionRef);
    if (inspectorOpen && graphSelection === undefined && selection) {
      const selectedNode = graphNodeForSelection(workbench.thread, selection);
      if (selectedNode) transientRefs.push(selectedNode.ref);
    }
    const reconciliation = reconcileVerificationCaseContext(
      workbench.thread.engineeringCases ??
        UNAVAILABLE_VERIFICATION_CASE_CATALOG,
      evidenceRawGraphMemo,
      verificationCaseFilter,
      transientRefs,
    );
    if (!reconciliation.resetTransientState) return;
    setPresentedVersionRef(undefined);
    setLineageFocus(undefined);
    setGraphSelection(undefined);
    setInspectorOpen(false);
  }, [
    evidenceRawGraphMemo,
    graphSelection,
    inspectorOpen,
    lineageFocus,
    presentedVersionRef,
    selection,
    verificationCaseFilter,
    workbench,
  ]);

  const pushWorkspaceHash = (hash: string) => {
    if (globalThis.location && globalThis.history) {
      if (globalThis.location.hash !== hash) {
        globalThis.history.pushState(null, "", hash);
      }
    }
  };

  const changeProductFacet = (facet: ProductWorkspaceFacet) => {
    lastScrolledDeepLinkRef.current = undefined;
    setActiveView("product");
    setActiveProductFacet(facet);
    setActiveDeepLink(undefined);
    setInspectorOpen(false);
    pushWorkspaceHash(productFacetHash(facet));
  };

  const changeView = (next: ProjectWorkspaceView) => {
    lastScrolledDeepLinkRef.current = undefined;
    if (next === "verification" && activeView !== "verification") {
      // Entering Verification from another surface is an explicit new scope.
      // Never carry a previous case/version restriction into that navigation.
      setVerificationCaseFilter({ kind: "all" });
      setPresentedVersionRef(undefined);
    }
    setActiveView(next);
    setActiveDeepLink(undefined);
    // A selected record can belong to another tool surface. Keep the main
    // workspace calm when changing context; explicit inspection reopens this.
    setInspectorOpen(false);
    // Le fragment suit l'espace ouvert : recharger, revenir en arriere ou
    // partager le lien ramene au meme endroit du cockpit.
    pushWorkspaceHash(
      next === "product"
        ? productFacetHash(activeProductFacet)
        : projectViewHash(next),
    );
  };

  /**
   * Inspecter est une destination, pas un panneau qui se déplie n'importe où.
   * L'inspecteur vit dans Verification : toute demande d'inspection, d'où
   * qu'elle vienne, y conduit. `changeView` referme le tiroir au passage,
   * la réouverture qui suit est donc volontaire et non un reste d'état.
   */
  const openInspector = () => {
    if (activeView !== "verification") changeView("verification");
    setDrawerMode("tool");
    setInspectorOpen(true);
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
    setVerificationCaseFilter({ kind: "all" });
    setLineageFocus(ref);
    setGraphSelection({ kind: "node", ref });
    changeView("verification");
  };

  if (error) {
    return (
      <Notice title="Engineering project unavailable" tone="danger">
        {error}
      </Notice>
    );
  }
  if (!workbench || (workbench.surface === "evidence" && !selection)) {
    return (
      <div
        className="flex min-h-80 items-center justify-center gap-3 text-sm text-muted-foreground"
        aria-busy="true"
      >
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
          aria-hidden="true"
        />
        <div>
          <strong className="block font-medium text-foreground">
            Reading project intent and linked evidence
          </strong>
          <span>No engineering tool is being executed.</span>
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
  const agentNow = buildAgentNowPresentation(project);
  const agentHeader = compactAgentHeader(agentNow, project);
  // versionedProvenance and evidenceCanvas are memoized above (guarded
  // useMemo, same pattern as evidenceModel): a stable projection identity is
  // what keeps the sigma instance alive across renders — the visible-depth
  // control and selection highlights must never remount the canvas.
  // We know they are defined here because the planning/documentary early
  // returns have already fired.
  const versionedProvenance = activeView === "verification"
    ? verificationVersionedProvenanceMemo!
    : versionedProvenanceMemo!;
  const evidenceCanvas = activeView === "verification"
    ? verificationEvidenceCanvasMemo!
    : evidenceCanvasMemo!;
  const fullMapCanvas = activeView === "verification"
    ? verificationFullMapCanvasMemo!
    : fullMapCanvasMemo!;
  const graphSelectionIndex = activeView === "verification"
    ? verificationGraphSelectionIndexMemo!
    : graphSelectionIndexMemo!;
  const displayedEvidenceModel = activeView === "verification"
    ? verificationEvidenceModelMemo
    : evidenceModel;
  const displayedKindProjection = activeView === "verification"
    ? verificationKindProjectionMemo
    : explorationKindProjectionMemo;

  // Visible-depth display filter (local view only). The neighbourhood is
  // computed at max depth; here we derive what the chosen depth actually
  // shows for the Evidence banner.
  const depthKey = (ref: ThreadGraphRef) => `${ref.kind}:${ref.id}`;
  const withinLocalDepth = (ref: ThreadGraphRef): boolean => {
    if (!evidenceCanvas.isFiltered) return true;
    const depths = evidenceCanvas.localDepthByRefKey;
    if (depths && (depths.get(depthKey(ref)) ?? 0) > localDepth) return false;
    return true;
  };
  const explorationLocalVisibleCount = evidenceCanvas.isFiltered
    ? evidenceCanvas.nodes.filter((n) =>
      withinLocalDepth(n.ref) && explorationLocalKinds[displayKindOf(n)]
    ).length
    : 0;

  // Compute which DisplayKinds are present in the model (post-fold) so the
  // burger menu only shows toggles for types that actually exist in the data.
  const presentKinds = new Set<DisplayKind>(
    displayedEvidenceModel.nodes.map((n) => displayKindOf(n)),
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
    setVerificationCaseFilter({ kind: "all" });
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
    options: {
      pauseLive?: boolean;
      inspect?: boolean;
      focusLineage?: boolean;
    } = {},
  ) => {
    if (options.pauseLive) {
      setFollowLive(false);
    }
    if (options.focusLineage !== false) {
      setLineageFocus(node.ref);
    }
    setGraphSelection({ kind: "node", ref: node.ref });
    if (options.inspect !== false) {
      openInspector();
    }
    if (node.selection) {
      setSelection(node.selection);
    }
  };

  const selectActivityNode = (
    node: ThreadGraphNode,
    origin: "feed" | "lineage",
  ) => {
    if (
      origin === "feed" && lineageFocus?.kind === node.ref.kind &&
      lineageFocus.id === node.ref.id
    ) {
      setLineageFocus(undefined);
      setGraphSelection(undefined);
      return;
    }
    selectGraphNode(node, {
      pauseLive: true,
      inspect: false,
    });
  };

  const selectPresentedVersion = (node: ThreadGraphNode) => {
    ignoreStageResetUntilRef.current = performance.now() + 1_500;
    setPresentedVersionRef(node.ref);
    selectGraphNode(node);
  };

  const selectVerificationGraphItem = (
    next: ThreadGraphSelection | undefined,
  ) => {
    if (next?.kind === "node") {
      const node = graphNodeByRef(snapshot, next.ref);
      if (node) {
        if (
          !presentedVersionRef ||
          versionedRefKey(node.ref) !== versionedRefKey(presentedVersionRef)
        ) {
          if (performance.now() >= ignoreStageResetUntilRef.current) {
            setPresentedVersionRef(undefined);
          }
        }
        selectGraphNode(node, { focusLineage: false });
      }
      return;
    }
    setGraphSelection(next);
    if (next === undefined) {
      // Sigma remounts under the version-history click and fires clickStage.
      // That is not a user background reset.
      if (performance.now() < ignoreStageResetUntilRef.current) return;
      setPresentedVersionRef(undefined);
      setLineageFocus(undefined);
      setInspectorOpen(false);
    }
    if (next?.kind === "edge") {
      openInspector();
    }
  };

  const changeVerificationCaseFilter = (next: VerificationCaseFilter) => {
    setVerificationCaseFilter(next);
    setPresentedVersionRef(undefined);
    setLineageFocus(undefined);
    setGraphSelection(undefined);
    setInspectorOpen(false);
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
    openInspector();
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
    changeProductFacet("structure");
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
    inspectorOpen ? selection : undefined,
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
      className="thread-tool-drawer flex min-h-0 flex-col"
      aria-label="Evidence inspector"
    >
      <header className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className={PAGE_EYEBROW}>
            Inspector
          </p>
          <Badge variant="secondary" className="font-mono text-[9px]">
            Read only
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs font-medium text-foreground">
          {selectedEdge
            ? "Recorded relation"
            : selectedGraphNode?.label ?? "No record selected"}
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
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
              <Tabs
                value={drawerMode}
                onValueChange={(mode) =>
                  setDrawerMode(mode as "tool" | "record")}
              >
                <TabsList aria-label="Inspector mode" className="w-full">
                  <TabsTrigger value="tool" className="flex-1">
                    Tool context
                  </TabsTrigger>
                  <TabsTrigger
                    value="record"
                    className="flex-1"
                    disabled={!inspectorRecord}
                  >
                    Exact record
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {selectedVersionFamily && (
                <EvidenceVersionHistory
                  family={selectedVersionFamily}
                  selectedRef={presentedVersionRef ?? selectedGraphNode?.ref}
                  onSelectVersion={selectPresentedVersion}
                />
              )}
              {drawerMode === "tool"
                ? (
                  <ToolInspectorPanel
                    snapshot={snapshot}
                    node={selectedGraphNode}
                    selection={inspectorRecord}
                    onSelect={selectThreadElement}
                    onSelectGraphNode={selectGraphNode}
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
                  <EmptyNotice>
                    This graph entity has no richer record projection. Use the
                    tool context to inspect its recorded neighbours.
                  </EmptyNotice>
                )}
            </>
          )}
      </div>
    </aside>
  );

  return (
    <div className="thread-workbench cockpit-surface">
      <ProjectCockpitHeader
        projectId={project.project.id}
        revision={project.revision}
        projectName={project.project.name}
        context={snapshot.subject.label}
        streamState={followLive ? streamStatus : "history"}
        streamLabel={streamStatusLabel(streamStatus, followLive)}
        statusLabel={agentHeader.label}
        statusValue={
          <span title={agentHeader.value}>
            {agentHeader.value}
          </span>
        }
        metaLabel="Projection"
        metaValue={
          <time dateTime={snapshot.generatedAt} title={snapshot.generatedAt}>
            {formatTime(snapshot.generatedAt)}
          </time>
        }
        badge={
          <Badge
            variant={snapshot.source === "fixture" ? "warning" : "success"}
          >
            {snapshot.sourceLabel}
          </Badge>
        }
      />

      <ProjectNavigation
        activeView={activeView}
        onChange={changeView}
        activeProductFacet={activeProductFacet}
        onProductFacetChange={changeProductFacet}
        sourcingBadge={productSourcingCoverage(snapshot).badge}
      />

      {workbench.alignment.status === "thread-ahead" && (
        <Notice tone="warning">
          <strong className="block font-medium">
            Project intent needs reconciliation
          </strong>
          <span>
            The technical thread is at revision{" "}
            {workbench.alignment.currentThreadRevision}, while project decisions
            remain anchored to revision{" "}
            {workbench.alignment.projectThreadRevision}.
          </span>
        </Notice>
      )}

      {workbench.unresolvedEvidenceReferences.length > 0 && (
        <Notice tone="warning">
          <strong className="block font-medium">
            {workbench.unresolvedEvidenceReferences.length} evidence{" "}
            {workbench.unresolvedEvidenceReferences.length === 1
              ? "reference does"
              : "references do"} not resolve in this thread revision
          </strong>
          <span>
            These project records cite thread entities or snapshots that the
            exact revision cannot resolve (usually residues of abandoned work).
            The rest of this page resolved.{" "}
            {workbench.unresolvedEvidenceReferences
              .map((issue) => issue.path)
              .join(", ")}
          </span>
        </Notice>
      )}

      {activeView === "overview"
        ? (
          <ProjectOverview
            project={project}
            thread={snapshot}
            phaseLanes={workbench.projectPath.phaseLanes}
            activities={workbench.projectPath.activities}
            caseActivityJoins={workbench.caseActivityJoins}
            onNavigate={changeView}
            onOpenProductFacet={changeProductFacet}
            onOpenActivity={openDecisionActivity}
            onOpenDeepLink={openProjectDeepLink}
            onOpenEvidence={openPublishedEvidence}
          />
        )
        : (
          <main
            className={`thread-flow-section project-workspace-page is-${activeView}`}
            id="project-workspace-panel"
            tabIndex={-1}
            aria-labelledby="thread-flow-title"
          >
            <div className="mb-3 flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
              <div className="min-w-0">
                <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[.1em] text-brand">
                  {workspaceEyebrow(activeView, activeProductFacet)}
                </p>
                <h3
                  id="thread-flow-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  {activeView === "verification"
                    ? presentedMemberRef
                      ? "Selected version path"
                      : evidenceCanvas.isFiltered
                      ? `Local view · depth ${localDepth}`
                      : "Full evidence map"
                    : activeView === "operations"
                    // Ce qu'on vient lire ici, c'est « combien de surfaces,
                    // dans quel état » — pas le mot « flotte ».
                    ? operationsHeadline(project)
                    : workspaceTitle(activeView, activeProductFacet)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {workspaceDescription(activeView, activeProductFacet)}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-3">
                {activeView === "verification" && (
                  <p className="font-mono text-[9.5px] font-medium uppercase tracking-[.08em] text-muted-foreground max-lg:hidden">
                    double-click node → local view · click background → full map
                  </p>
                )}
              </div>
            </div>
            {activeView === "work" && (
              <div className="mb-3">
                <ProjectWorkRibbon project={project} />
              </div>
            )}
            {activeView === "verification" && (
              <MetricTiles
                items={summaryMetrics(
                  snapshot,
                  paintedDossierMetric(displayedEvidenceModel, fullMapCanvas),
                )}
              />
            )}
            <div
              className={`thread-graph-workspace ${
                activeView === "verification" ? "is-verification" : "is-wide"
              }`}
            >
              <div
                className={`thread-graph-stage thread-graph-stage-${activeView}`}
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
                      threadIdentity={{
                        id: snapshot.id,
                        revision: snapshot.change.revision,
                      }}
                      evidenceModel={evidenceModel}
                      filterComponentId={feedFilterComponentId}
                      anchorage={partAnchorage}
                      components={snapshot.components}
                      familyGraph={snapshot.evidenceFamilyGraph}
                      reviewRecords={activityReviewRecords}
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
                      onSelectNode={selectActivityNode}
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
                        openInspector();
                      }}
                      onInspect={(next, node) => {
                        setSelection(next);
                        setLineageFocus(node.ref);
                        setGraphSelection({ kind: "node", ref: node.ref });
                        openInspector();
                      }}
                      onOpenEvidenceAnchored={openEvidenceAnchored}
                      onOpenReviewEvidence={openPublishedEvidence}
                    />
                  )
                  : activeView === "verification"
                  ? (
                    <section
                      className="thread-versioned-provenance"
                      aria-labelledby="thread-versioned-provenance-title"
                    >
                      <div className="flex items-start justify-between gap-4 px-5 py-4">
                        <div className="min-w-0 space-y-1">
                          <h4
                            id="thread-versioned-provenance-title"
                            className="text-base font-semibold"
                          >
                            {presentedMemberRef
                              ? "Selected version path"
                              : "Evidence map"}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {presentedMemberRef
                              ? `Depth ${localDepth}; the alternate version stays hidden.`
                              : evidenceCanvas.isFiltered
                              ? "Local view. Select the background for the full map."
                              : "Select a record to inspect. Double-click for the local neighbourhood."}
                          </p>
                        </div>
                        <p className="shrink-0 font-mono text-xs text-muted-foreground">
                          {evidenceCanvas.isFiltered
                            ? `${explorationLocalVisibleCount} items shown · local view · depth ${localDepth}`
                            : (() => {
                              const kp = displayedKindProjection ??
                                evidenceCanvas;
                              const parts: string[] = [
                                `${kp.displayedCount} items shown`,
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
                            })()}
                        </p>
                      </div>
                      <div className="evidence-graph-menu">
                        <DropdownMenu align="end">
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="absolute right-3 top-10 size-7"
                              aria-label="Graph settings"
                            >
                              ☰
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Show</DropdownMenuLabel>
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
                                    <DropdownMenuCheckboxItem
                                      key={kind}
                                      value={kind}
                                      checked={currentKinds[kind]}
                                      onCheckedChange={(checked) =>
                                        setCurrentKinds((prev) => ({
                                          ...prev,
                                          [kind]: checked === true,
                                        }))}
                                    >
                                      {DISPLAY_KIND_LABELS[kind]}
                                    </DropdownMenuCheckboxItem>
                                  );
                                },
                              )}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <EvidenceExploration
                        key={`${
                          verificationCaseFilter.kind === "case"
                            ? verificationCaseFilter.caseKey
                            : "all-cases"
                        }:${
                          presentedMemberRef
                            ? `version:${versionedRefKey(presentedMemberRef)}`
                            : "live-map"
                        }`}
                        evidenceModel={displayedEvidenceModel}
                        projection={presentedMemberRef ||
                            evidenceCanvas.isFiltered
                          ? evidenceCanvas
                          : (displayedKindProjection ?? evidenceCanvas)}
                        displayDepth={presentedMemberRef ||
                            evidenceCanvas.isFiltered
                          ? localDepth
                          : undefined}
                        neighborDepth={localDepth}
                        onNeighborDepthChange={setLocalDepth}
                        visibleKinds={presentedMemberRef ||
                            evidenceCanvas.isFiltered
                          ? explorationLocalKinds
                          : undefined}
                        selection={visibleGraphSelection(
                          versionedProvenance,
                          graphSelection,
                          graphSelectionIndex,
                        )}
                        focus={visibleGraphRef(
                          versionedProvenance,
                          presentedMemberRef ?? lineageFocus,
                        )}
                        onSelectionChange={selectVerificationGraphItem}
                        verificationCases={snapshot.engineeringCases ??
                          UNAVAILABLE_VERIFICATION_CASE_CATALOG}
                        verificationCaseNodes={evidenceRawGraphMemo!.nodes}
                        verificationCaseFilter={verificationCaseFilter}
                        onVerificationCaseFilterChange={changeVerificationCaseFilter}
                        fullMapProjection={displayedKindProjection ??
                          fullMapCanvas}
                        onEnterLocalView={(ref) => {
                          const node = graphNodeByRef(snapshot, ref);
                          if (node) selectGraphNode(node);
                        }}
                      />
                    </section>
                  )
                  : activeView === "product"
                  ? activeProductFacet === "requirements"
                    ? (
                      <ProductRequirementsMatrix
                        thread={snapshot}
                        onOpenVerification={() => changeView("verification")}
                      />
                    )
                    : activeProductFacet === "sourcing"
                    ? <ProductSourcingLane thread={snapshot} />
                    : (
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
                        onOpenSourcing={() => changeProductFacet("sourcing")}
                      />
                    )
                  : (
                    <ProjectOperations
                      project={project}
                      thread={snapshot}
                      fleet={fleet}
                      onOpenWork={() => changeView("work")}
                    />
                  )}
              </div>
              {activeView === "verification" && inspector}
            </div>
          </main>
        )}
    </div>
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
  productFacet: ProductWorkspaceFacet = DEFAULT_PRODUCT_FACET,
): string {
  if (view === "work") return "Work · recorded activity";
  if (view === "product") {
    return `Product · ${productFacetLabel(productFacet).toLowerCase()}`;
  }
  if (view === "verification") return "Verification · evidence exploration";
  return "Operations · recorded execution";
}

/** Recorded run and human-attention state; never provider liveness. */
function operationsHeadline(
  project: EngineeringProjectSnapshot,
): string {
  const running =
    project.agentRuns.filter((run) => run.status === "running").length;
  const queued = project.agentRuns.filter((run) => run.status === "queued")
    .length;
  const confirmations = pendingHumanConfirmationDecisions(project).length;
  const preparations = agentPreparationDecisions(project).length;
  return `${running} running · ${queued} queued · ${confirmations} human confirmation${
    confirmations === 1 ? "" : "s"
  } · ${preparations} agent proposal${
    preparations === 1 ? "" : "s"
  } in preparation`;
}

function workspaceTitle(
  view: Exclude<ProjectWorkspaceView, "overview">,
  productFacet: ProductWorkspaceFacet = DEFAULT_PRODUCT_FACET,
): string {
  if (view === "work") return "Recorded activity";
  if (view === "product") {
    if (productFacet === "requirements") {
      return "What the current revision must hold";
    }
    if (productFacet === "sourcing") return "To Buy stays a reserved lane";
    return "Product structure";
  }
  if (view === "verification") return "Evidence map";
  return "Engineering fleet";
}

function workspaceDescription(
  view: Exclude<ProjectWorkspaceView, "overview">,
  productFacet: ProductWorkspaceFacet = DEFAULT_PRODUCT_FACET,
): string {
  if (view === "work") {
    return "Recorded results and review requests, in order.";
  }
  if (view === "product") {
    if (productFacet === "requirements") {
      return "Requirement expressions and the last recorded verdict.";
    }
    if (productFacet === "sourcing") {
      return "ERP coverage stays GAP until sourcing records exist.";
    }
    return "Components matched across system, CAD and ERP records.";
  }
  if (view === "verification") {
    return "Recorded support and impact for each result.";
  }
  return "Read-only projection of recorded runs, agent preparation, human confirmations, closeouts and contributing systems.";
}

function FactList(
  { items }: { items: readonly FactItem[] },
): JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <div key={item.id} className="contents">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetricTiles(
  { items }: { items: readonly MetricTileItem[] },
): JSX.Element {
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((metric) => (
        <article
          key={metric.id}
          className={cn("p-3", CARD_SURFACE)}
          data-metric={metric.id}
          data-tone={metric.tone ?? "neutral"}
        >
          <p className="text-xs text-muted-foreground">{metric.label}</p>
          <p>
            <strong className="text-xl font-semibold tabular-nums">
              {metric.value}
            </strong>
            {metric.unit && (
              <span className="ml-1 font-mono text-xs text-muted-foreground">
                {metric.unit}
              </span>
            )}
          </p>
          {metric.detail && (
            <p className="text-xs text-muted-foreground">{metric.detail}</p>
          )}
        </article>
      ))}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="font-mono text-xs text-muted-foreground">{children}</code>
  );
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
  const facts: FactItem[] = [
    { id: "origin", label: "Evidence class", value: edge.origin },
    {
      id: "relation",
      label: "Relation",
      value: <Mono>{edge.relation}</Mono>,
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
        value: <Mono>{edge.attestation.producerFingerprint}</Mono>,
      },
      {
        id: "consumer-hash",
        label: "Consumed hash",
        value: <Mono>{edge.attestation.consumedFingerprint}</Mono>,
      },
    );
  }
  if (edge.analysis) {
    facts.push(
      {
        id: "assertion-id",
        label: "Assertion",
        value: <Mono>{edge.analysis.assertionId}</Mono>,
      },
      {
        id: "epistemic-basis",
        label: "Knowledge basis",
        value: edge.analysis.epistemicBasis,
      },
      {
        id: "asserted-by",
        label: "Asserted by",
        value:
          `${edge.analysis.assertedBy.kind} · ${edge.analysis.assertedBy.id}${
            edge.analysis.assertedBy.version
              ? ` @ ${edge.analysis.assertedBy.version}`
              : ""
          }`,
      },
      {
        id: "analysis-scope",
        label: "Validity scope",
        value: edge.analysis.scope.kind,
      },
      {
        id: "analysis-evidence",
        label: "Exact evidence",
        value: edge.analysis.evidence.map((item) => item.id).join(", "),
      },
    );
    if (edge.analysis.measurement) {
      const measurement = edge.analysis.measurement;
      facts.push({
        id: "analysis-derivative",
        label: "Local derivative",
        value: `${measurement.derivative.value} ${measurement.derivative.unit}`,
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Selected handoff
          </p>
          <CardTitle className="text-base">
            {relationTitle(edge.relation)}
          </CardTitle>
        </div>
        <Badge variant={TONE_BADGE_VARIANT[tone]}>{edge.origin}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{edge.rationale}</p>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <GraphEndpoint
            label="Source / upstream"
            node={source}
            onSelect={onSelectGraphNode}
          />
          <span aria-hidden="true" className="text-muted-foreground">→</span>
          <GraphEndpoint
            label="Result / downstream"
            node={target}
            onSelect={onSelectGraphNode}
          />
        </div>
        <FactList items={facts} />
        {history && history.members.length > 1 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Recorded handoffs ({history.members.length})
            </summary>
            <ul className="mt-2 divide-y divide-border">
              {history.members.map((member, index) => (
                <li key={member.id} className="space-y-0.5 py-2">
                  <strong className="text-sm">
                    {member.id === history.representative.id
                      ? "Current handoff"
                      : `Earlier handoff ${index + 1}`}
                  </strong>
                  <Mono>{relationLabel(member.relation)}</Mono>
                  <p className="text-sm text-muted-foreground">
                    {member.rationale}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
        {edge.attestation && (
          <Notice
            title={edge.attestation.status === "verified"
              ? "Exact consumed bytes verified"
              : "Producer / consumer bytes differ"}
            tone={edge.attestation.status === "verified" ? "success" : "danger"}
          >
            {edge.attestation.status === "verified"
              ? "This handoff is backed by matching producer and consumer fingerprints."
              : "This dependency cannot support a current verdict until the consumer is rerun with the recorded producer bytes."}
          </Notice>
        )}
        {!edge.attestation && edge.analysis
          ? (
            <Notice title="Qualified analysis assertion" tone="info">
              This semantic relation is backed by the exact evidence listed
              above and is classified as{" "}
              {edge.analysis.epistemicBasis}. It does not grant execution
              authority.
            </Notice>
          )
          : !edge.attestation && (
            <Notice title="Recorded semantic relation" tone="info">
              This edge comes from an explicit canonical relation. It is not a
              byte-level consumption attestation.
            </Notice>
          )}
      </CardContent>
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
      <div
        className="min-w-0 rounded-lg bg-muted/50 p-3"
        data-missing="true"
      >
        <p className="text-xs text-muted-foreground">{label}</p>
        <strong className="block text-sm">Endpoint unavailable</strong>
      </div>
    );
  }
  return (
    <button
      className="min-w-0 rounded-lg bg-muted/50 p-3 text-left"
      type="button"
      onClick={() => onSelect(node)}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <strong className="block text-sm">{node.label}</strong>
      <span className="font-mono text-xs text-muted-foreground">
        {node.system} · {node.entityKind}
      </span>
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
      : <EmptyNotice>Artifact not present in this snapshot.</EmptyNotice>;
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
      : <EmptyNotice>Observation not present in this snapshot.</EmptyNotice>;
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
      : <EmptyNotice>Requirement not present in this snapshot.</EmptyNotice>;
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
    : <EmptyNotice>Violation not present in this snapshot.</EmptyNotice>;
}

function InspectorShell({ eyebrow, title, tone, children }: {
  eyebrow: string;
  title: string;
  tone: PresentationTone;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {eyebrow}
          </p>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <Badge variant={TONE_BADGE_VARIANT[tone]}>{eyebrow}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ChangeInspector(
  { snapshot }: { snapshot: ThreadWorkbenchSnapshot },
): JSX.Element {
  const change = snapshot.change;
  const state = changeState(snapshot);
  const facts: FactItem[] = [
    { id: "author", label: "Changed by", value: change.author },
    {
      id: "revision",
      label: "Revision",
      value: <Mono>{change.revision}</Mono>,
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
    <InspectorShell eyebrow="Revision" title={change.id} tone="info">
      <p className="text-sm text-muted-foreground">{change.summary}</p>
      <FactList items={facts} />
      <Notice title={state.title} tone={state.tone}>
        {state.message}
      </Notice>
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
      <FactList items={artifactFacts(artifact)} />
      {artifact.freshness === "stale" && (
        <Notice title="Evidence invalidated" tone="warning">
          This result predates a dependency. It remains available for provenance
          but cannot support a current verdict.
        </Notice>
      )}
      {artifact.attestation && (
        <Notice
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
        </Notice>
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
      eyebrow="Observation"
      title={observation.label}
      tone={freshnessTone(observation.freshness)}
    >
      <div className="flex items-end justify-between gap-3">
        <strong className="text-xl font-semibold tabular-nums">
          {observation.display}
        </strong>
        <Freshness freshness={observation.freshness} />
      </div>
      <FactList
        items={[
          {
            id: "id",
            label: "Stable id",
            value: <Mono>{observation.id}</Mono>,
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
        <div
          role="group"
          aria-label="Observation provenance"
          className="flex flex-wrap items-center gap-2"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelect({ kind: "artifact", id: artifact.id })}
          >
            Trace source artifact →
          </Button>
        </div>
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
      <div className="rounded-lg bg-muted/50 p-4 font-mono text-sm">
        {requirement.expression}
      </div>
      <p className="text-sm text-muted-foreground">{requirement.rationale}</p>
      <FactList
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
      <div className="flex items-baseline justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-destructive">
        <span className="text-xs font-medium">Blocking</span>
        <strong className="text-xl font-semibold tabular-nums">
          {violation.margin}
        </strong>
      </div>
      <p className="text-sm text-muted-foreground">{violation.message}</p>
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
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">
          Proposed next actions
        </p>
        <p className="text-xs text-muted-foreground">discuss with the agent</p>
      </div>
      <div className="divide-y divide-border">
        {actions.map((action, index) => (
          <article
            key={action.id}
            className="flex items-start gap-3 py-2"
            data-readiness={action.readiness}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {pad(index + 1)}
            </span>
            <div className="min-w-0 flex-1">
              <strong className="text-sm">{action.label}</strong>
              <p className="text-xs text-muted-foreground">
                {action.description}
              </p>
            </div>
            <Badge
              variant={action.readiness === "blocked" ? "warning" : "secondary"}
            >
              {action.readiness === "blocked" ? "Blocked" : action.readiness}
            </Badge>
          </article>
        ))}
      </div>
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
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="divide-y divide-border">
        {refs.map((ref) => (
          <button
            type="button"
            key={`${ref.kind}:${ref.id}`}
            className="flex w-full items-center gap-3 py-2 text-left"
            onClick={() => onSelect(ref)}
          >
            <Mono>{ref.id}</Mono>
            <span className="min-w-0 flex-1 truncate text-sm">
              {refLabel(snapshot, ref)}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Freshness({ freshness }: { freshness: ThreadFreshness }): JSX.Element {
  return (
    <Badge
      variant={TONE_BADGE_VARIANT[freshnessTone(freshness)]}
      data-state={freshness}
    >
      {freshness}
    </Badge>
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

function summaryMetrics(
  snapshot: ThreadWorkbenchSnapshot,
  painted: ReturnType<typeof paintedDossierMetric>,
): MetricTileItem[] {
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
  return [
    {
      id: "impact",
      label: "Linked evidence",
      value: painted.itemCount,
      unit: "items",
      detail: linkedEvidenceDetail(painted.componentCount),
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
  return relation.replaceAll("_", " ").replaceAll("-", " ");
}

function artifactFacts(artifact: ThreadArtifact): FactItem[] {
  const facts: FactItem[] = [
    {
      id: "revision",
      label: "Revision",
      value: <Mono>{artifact.revision}</Mono>,
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
      value: <Mono>{artifact.fingerprint ?? "not recorded"}</Mono>,
    },
    {
      id: "uri",
      label: "Artifact URI",
      value: <Mono>{artifact.uri ?? "not persisted"}</Mono>,
    },
  ];
  if (artifact.attestation) {
    facts.push(
      {
        id: "producer-hash",
        label: "Producer hash",
        value: <Mono>{artifact.attestation.producerFingerprint}</Mono>,
      },
      {
        id: "consumer-hash",
        label: "Consumed hash",
        value: <Mono>{artifact.attestation.consumedFingerprint}</Mono>,
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

function compactAgentHeader(
  presentation: AgentNowPresentation,
  project: EngineeringProjectSnapshot,
): { label: "Agent now" | "Last agent run"; value: string } {
  if (presentation.kind === "active-run") {
    const work = project.workItems.find((item) =>
      item.id === presentation.run.workItemId
    );
    return {
      label: "Agent now",
      value: work?.title ?? agentRunSummary(project, presentation.run),
    };
  }
  if (presentation.kind === "current-work") {
    return { label: "Agent now", value: presentation.work.title };
  }
  if (presentation.kind === "last-settled-run") {
    return {
      label: "Last agent run",
      value: agentRunSummary(project, presentation.run),
    };
  }
  return { label: "Agent now", value: "No recorded activity" };
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
