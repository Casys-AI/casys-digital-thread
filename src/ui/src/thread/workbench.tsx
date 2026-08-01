/** @jsxImportSource preact */

import { useEffect, useRef, useState } from "preact/hooks";
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
import {
  createProjectCommandRequest,
  type ProjectOperatorCommand,
} from "../project/command-contract.ts";
import {
  DecisionCenter,
  type ProjectCommandFeedback,
} from "../project/control-center.tsx";
import {
  buildProjectBrief,
  projectStatusLabel,
  projectStatusTone,
} from "../project/model.ts";
import {
  ProjectNavigation,
  projectViewLabel,
  type ProjectWorkspaceView,
} from "../project/navigation.tsx";
import { ProjectOverview } from "../project/overview.tsx";
import { ProjectOperations, ProjectWorkRibbon } from "../project/work.tsx";
import {
  ProjectCommandConflictError,
  type ThreadStreamStatus,
  type ThreadWorkbenchClient,
} from "./client.ts";
import { activityFeedNodes } from "./feed-model.ts";
import {
  nextLiveFocusNode,
  shouldAcceptWorkbenchUpdate,
} from "./live-update.ts";
import { ThreadFeed } from "./feed.tsx";
import { ThreadGraph, type ThreadGraphSelection } from "./graph.tsx";
import { ComponentWorkspace } from "./component-workspace.tsx";
import {
  ToolInspectorPanel,
  type WorkbenchToolIdentity,
} from "./tool-inspectors.tsx";
import { resolveToolInspectorTarget } from "./tool-inspector-model.ts";
import type {
  EngineeringWorkbenchSnapshot,
  ThreadAction,
  ThreadArtifact,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentProvider,
  ThreadFlowStage,
  ThreadFreshness,
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
}

interface PreparedAction {
  id: string;
  label: string;
  requiresConfirmation: boolean;
}

export function ThreadWorkbench({
  client,
}: ThreadWorkbenchProps): JSX.Element {
  const [workbench, setWorkbench] = useState<EngineeringWorkbenchSnapshot>();
  const [selection, setSelection] = useState<ThreadRef>();
  const [graphSelection, setGraphSelection] = useState<ThreadGraphSelection>();
  const [lineageFocus, setLineageFocus] = useState<ThreadGraphRef>();
  const [activeView, setActiveView] = useState<ProjectWorkspaceView>(
    "overview",
  );
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
  const [prepared, setPrepared] = useState<PreparedAction>();
  const [operatorId, setOperatorId] = useState("");
  const [commandFeedback, setCommandFeedback] = useState<
    ProjectCommandFeedback
  >(
    { state: "idle" },
  );
  const [error, setError] = useState<string>();
  const snapshotRef = useRef<EngineeringWorkbenchSnapshot>();
  const followLiveRef = useRef(followLive);
  followLiveRef.current = followLive;

  useEffect(() => {
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    setError(undefined);
    client.load(controller.signal).then((next) => {
      snapshotRef.current = next;
      setWorkbench(next);
      const thread = next.thread;
      setSelectedComponentId(thread.components.components[0]?.id);
      const liveNode = activityFeedNodes(thread.graph.nodes)[0];
      const initialSelection: ThreadRef = liveNode?.selection ??
        (thread.violations[0]
          ? { kind: "violation", id: thread.violations[0].id }
          : { kind: "change", id: thread.change.id });
      setSelection(initialSelection);
      const initialNode = liveNode ??
        graphNodeForSelection(thread, initialSelection);
      setLineageFocus(initialNode?.ref);
      setGraphSelection(
        initialNode ? { kind: "node", ref: initialNode.ref } : undefined,
      );
      if (client.subscribe) {
        unsubscribe = client.subscribe((incoming) => {
          const previous = snapshotRef.current;
          if (previous && !shouldAcceptWorkbenchUpdate(previous, incoming)) {
            return;
          }
          snapshotRef.current = incoming;
          setWorkbench(incoming);
          if (!followLiveRef.current) return;
          const liveNode = nextLiveFocusNode(previous?.thread, incoming.thread);
          if (!liveNode) return;
          setLineageFocus(liveNode.ref);
          setGraphSelection({ kind: "node", ref: liveNode.ref });
          if (liveNode.selection) setSelection(liveNode.selection);
          setDrawerMode("tool");
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

  if (error) {
    return (
      <StateMessage title="Engineering project unavailable" tone="danger">
        {error}
      </StateMessage>
    );
  }
  if (!workbench || !selection) {
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

  const snapshot = workbench.thread;
  const project = workbench.project;
  const projectBrief = buildProjectBrief(project);
  const commandCapability = workbench.capabilities?.operatorCommands;

  const executeProjectCommand = async (
    commandKey: string,
    command: ProjectOperatorCommand,
  ) => {
    const current = snapshotRef.current;
    const capability = current?.capabilities?.operatorCommands;
    const actorId = operatorId.trim();
    if (!current || !capability?.enabled || !client.command || !actorId) {
      setCommandFeedback({
        state: "error",
        commandKey,
        message:
          "This project is read-only or the local operator identity is missing.",
      });
      return;
    }
    setCommandFeedback({
      state: "submitting",
      commandKey,
      message: "Applying the explicit operator command…",
    });
    const request = createProjectCommandRequest({
      command,
      commandId: createCommandId(),
      projectId: current.project.project.id,
      expectedRevision: current.project.revision,
      issuedAt: new Date().toISOString(),
      actorId,
    });
    try {
      const next = await client.command(request);
      const latest = snapshotRef.current;
      if (!latest || next.project.revision >= latest.project.revision) {
        snapshotRef.current = next;
        setWorkbench(next);
      }
      setCommandFeedback({
        state: "success",
        commandKey,
        message:
          `Command recorded at project revision ${next.project.revision}.`,
      });
    } catch (reason: unknown) {
      if (reason instanceof ProjectCommandConflictError) {
        try {
          const refreshed = await client.load();
          const latest = snapshotRef.current;
          if (
            !latest || refreshed.project.revision >= latest.project.revision
          ) {
            snapshotRef.current = refreshed;
            setWorkbench(refreshed);
          }
          setCommandFeedback({
            state: "conflict",
            commandKey,
            message: `Project revision changed${
              reason.actualRevision !== undefined
                ? ` to ${reason.actualRevision}`
                : ""
            }. The latest state was loaded; review it before trying again.`,
          });
        } catch {
          setCommandFeedback({
            state: "error",
            commandKey,
            message:
              "The command conflicted with a newer revision, and the refresh failed.",
          });
        }
        return;
      }
      setCommandFeedback({
        state: "error",
        commandKey,
        message: reason instanceof Error
          ? reason.message
          : "The operator command could not be applied.",
      });
    }
  };

  const prepareAction = (action: ThreadAction) => {
    setPrepared({
      id: action.id,
      label: action.label,
      requiresConfirmation: action.requiresConfirmation,
    });
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
      followLiveRef.current = false;
      setFollowLive(false);
    }
    setLineageFocus(node.ref);
    setGraphSelection({ kind: "node", ref: node.ref });
    if (options.inspect !== false) setDrawerMode("tool");
    if (node.selection) {
      setSelection(node.selection);
    }
  };

  const changeFollowLive = (next: boolean) => {
    followLiveRef.current = next;
    setFollowLive(next);
    if (!next) return;
    const liveNode = activityFeedNodes(snapshot.graph.nodes)[0];
    if (liveNode) selectGraphNode(liveNode, { inspect: false });
  };

  const selectComponent = (component: ThreadComponent) => {
    setSelectedComponentId(component.id);
    const binding = component.bindings.find((item) =>
      item.provider === activeComponentProvider && item.status === "verified"
    );
    if (binding?.selection) selectThreadElement(binding.selection);
  };

  const inspectComponentBinding = (binding: ThreadComponentBinding) => {
    if (!binding.selection) return;
    selectThreadElement(binding.selection);
    setDrawerMode("tool");
  };

  const changeComponentProvider = (provider: ThreadComponentProvider) => {
    setActiveComponentProvider(provider);
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
    setActiveView("product");
  };

  const selectedEdge = graphSelection?.kind === "edge"
    ? snapshot.graph.edges.find((edge) => edge.id === graphSelection.id)
    : undefined;
  const inspectorTarget = resolveToolInspectorTarget(
    snapshot,
    graphSelection,
    selection,
  );
  const selectedGraphNode = inspectorTarget.node;
  const inspectorRecord = inspectorTarget.record;

  const inspector = (
    <aside
      class="thread-tool-drawer"
      aria-label="Active engineering tool workspace"
    >
      {selectedEdge
        ? (
          <GraphEdgeInspector
            snapshot={snapshot}
            edge={selectedEdge}
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
            {drawerMode === "tool"
              ? (
                <ToolInspectorPanel
                  snapshot={snapshot}
                  node={selectedGraphNode}
                  selection={inspectorRecord}
                  onSelect={selectThreadElement}
                  onPrepareAction={prepareAction}
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
                  onPrepare={prepareAction}
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
              <small>EVIDENCE CHANNEL</small>
              <strong>{streamStatusLabel(streamStatus, followLive)}</strong>
            </div>
          </div>
          <div class="thread-session-change">
            <small>NOW</small>
            <strong>
              {projectBrief.activeRuns[0]?.summary ??
                projectBrief.currentWork[0]?.title ?? "No active work recorded"}
            </strong>
          </div>
          <dl class="thread-session-facts">
            <div>
              <dt>Project</dt>
              <dd data-project-tone={projectStatusTone(projectBrief.status)}>
                {projectStatusLabel(projectBrief.status)}
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
        onChange={setActiveView}
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
            onNavigate={setActiveView}
            capability={commandCapability}
            actorId={operatorId}
            onActorIdChange={setOperatorId}
            feedback={commandFeedback}
            onCommand={executeProjectCommand}
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
              </div>
            </div>
            <div class="thread-workspace-meta">
              <p class="thread-flow-explanation">
                {workspaceDescription(activeView)}
              </p>
              <div
                class="thread-operator-contract"
                aria-label="Operator controls"
              >
                <span data-state={followLive ? "live" : "history"}>
                  <i aria-hidden="true" />
                  {followLive ? "Following activity" : "Reviewing history"}
                </span>
                <span>
                  <b>CONTROL</b> executions require operator confirmation
                </span>
              </div>
            </div>
            {activeView === "work" && (
              <>
                <ProjectWorkRibbon project={project} />
                <details class="project-work-decision-drawer">
                  <summary>
                    <span>DECISION CENTER</span>
                    <strong>
                      {project.decisions.filter((decision) =>
                        decision.status === "approved"
                      ).length}/{project.decisions.length} approved
                    </strong>
                    <small>Review inputs and release work</small>
                  </summary>
                  <DecisionCenter
                    project={project}
                    capability={commandCapability}
                    actorId={operatorId}
                    onActorIdChange={setOperatorId}
                    feedback={commandFeedback}
                    onCommand={executeProjectCommand}
                  />
                </details>
              </>
            )}
            {activeView === "verification" && (
              <>
                <MetricGrid
                  className="thread-metrics project-verification-metrics"
                  items={summaryMetrics(snapshot)}
                />
                <div class="thread-graph-legend" aria-label="Graph legend">
                  <span data-tone="source">upstream evidence</span>
                  <span data-tone="focus">selected fact</span>
                  <span data-tone="impact">downstream impact</span>
                  <span data-tone="attested">hash-attested handoff</span>
                </div>
              </>
            )}
            <div class="thread-graph-workspace">
              <div class="thread-graph-stage">
                {activeView === "work"
                  ? (
                    <ThreadFeed
                      nodes={snapshot.graph.nodes}
                      edges={snapshot.graph.edges}
                      focus={lineageFocus}
                      selection={graphSelection}
                      followLive={followLive}
                      streamStatus={streamStatus}
                      onFollowLiveChange={changeFollowLive}
                      onSelectNode={(node) =>
                        selectGraphNode(node, { pauseLive: true })}
                      onSelectEdge={(edge) => {
                        setGraphSelection({ kind: "edge", id: edge.id });
                        setDrawerMode("tool");
                      }}
                      onInspect={(next, node) => {
                        setSelection(next);
                        setLineageFocus(node.ref);
                        setDrawerMode("tool");
                      }}
                    />
                  )
                  : activeView === "verification"
                  ? (
                    <ThreadGraph
                      nodes={snapshot.graph.nodes}
                      edges={snapshot.graph.edges}
                      selection={graphSelection}
                      focus={lineageFocus}
                      onSelectionChange={(next) => {
                        if (next?.kind === "node") {
                          const node = graphNodeByRef(snapshot, next.ref);
                          if (node) selectGraphNode(node);
                          return;
                        }
                        setGraphSelection(next);
                        if (next?.kind === "edge") setDrawerMode("tool");
                      }}
                      onInspect={(next, node) => {
                        setSelection(next);
                        setLineageFocus(node.ref);
                        setDrawerMode("tool");
                      }}
                    />
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
                    />
                  )
                  : (
                    <ProjectOperations
                      project={project}
                      thread={snapshot}
                      capability={commandCapability}
                      actorId={operatorId}
                      onActorIdChange={setOperatorId}
                      feedback={commandFeedback}
                      onCommand={executeProjectCommand}
                    />
                  )}
              </div>
              {inspector}
            </div>
          </section>
        )}

      {prepared && (
        <div class="thread-action-notice" role="status">
          <span aria-hidden="true">↳</span>
          <div>
            <strong>{prepared.label}</strong>
            <small>
              {prepared.requiresConfirmation
                ? "Prepared only — operator confirmation is required before execution."
                : "Inspection prepared — no solver or engineering tool was executed."}
            </small>
          </div>
          <button
            type="button"
            onClick={() => setPrepared(undefined)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function createCommandId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function workspaceEyebrow(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") return "HUMAN + AGENT WORKSPACE";
  if (view === "product") return "PRODUCT DEFINITION";
  if (view === "verification") return "TRACEABLE VERIFICATION";
  return "EXECUTION CONTROL";
}

function workspaceTitle(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") return "Live engineering activity";
  if (view === "product") return "Product structure across tools";
  if (view === "verification") return "Evidence, impact and verdicts";
  return "Runs, work plan and tool surfaces";
}

function workspaceDescription(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") {
    return "Validated results appear as the agent works. The feed exposes actions and outcomes, never private chain-of-thought.";
  }
  if (view === "product") {
    return "Select one physical component, then move across its exact SysON, build123d and ERPNext identities without leaving the project.";
  }
  if (view === "verification") {
    return "Follow recorded evidence from source to consequence. Shared subject identity is visible, but only explicit relations are treated as causal.";
  }
  return "Review declared work, agent run states and the engineering tools which contributed evidence to this project.";
}

function GraphEdgeInspector({ snapshot, edge, onSelectGraphNode }: {
  snapshot: ThreadWorkbenchSnapshot;
  edge: ThreadGraphEdge;
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

function SelectionInspector({ snapshot, selection, onSelect, onPrepare }: {
  snapshot: ThreadWorkbenchSnapshot;
  selection: ThreadRef;
  onSelect: (selection: ThreadRef) => void;
  onPrepare: (action: ThreadAction) => void;
}): JSX.Element {
  if (selection.kind === "change") {
    return <ChangeInspector snapshot={snapshot} onPrepare={onPrepare} />;
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
        onPrepare={onPrepare}
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
  { snapshot, onPrepare }: {
    snapshot: ThreadWorkbenchSnapshot;
    onPrepare: (action: ThreadAction) => void;
  },
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
      <ActionList actions={snapshot.actions} onPrepare={onPrepare} />
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

function ViolationInspector({ snapshot, violation, onSelect, onPrepare }: {
  snapshot: ThreadWorkbenchSnapshot;
  violation: ThreadViolation;
  onSelect: (selection: ThreadRef) => void;
  onPrepare: (action: ThreadAction) => void;
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
      <ActionList actions={actions} onPrepare={onPrepare} />
    </InspectorShell>
  );
}

function ActionList({ actions, onPrepare }: {
  actions: ThreadAction[];
  onPrepare: (action: ThreadAction) => void;
}): JSX.Element | null {
  if (!actions.length) return null;
  return (
    <div class="thread-actions">
      <div class="thread-relation-title">
        <span>Proposed next actions</span>
        <small>prepare, never auto-run</small>
      </div>
      {actions.map((action, index) => (
        <button
          type="button"
          key={action.id}
          disabled={action.readiness === "blocked"}
          onClick={() => onPrepare(action)}
        >
          <span>{pad(index + 1)}</span>
          <div>
            <strong>{action.label}</strong>
            <small>{action.description}</small>
          </div>
          <b>
            {action.readiness === "blocked"
              ? "Blocked"
              : action.kind === "inspect"
              ? "Open"
              : "Prepare"}
          </b>
        </button>
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

function summaryMetrics(snapshot: ThreadWorkbenchSnapshot): MetricItem[] {
  const fresh =
    snapshot.artifacts.filter((item) => item.freshness === "fresh").length;
  const stale =
    snapshot.artifacts.filter((item) => item.freshness === "stale").length;
  const passed =
    snapshot.requirements.filter((item) => item.status === "pass").length;
  const failed =
    snapshot.requirements.filter((item) => item.status === "fail").length;
  const noCriterion = snapshot.requirements.length === 0;
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
      value: fresh,
      unit: `fresh · ${stale} stale`,
      detail: `${snapshot.artifacts.length} persisted artifacts`,
      tone: stale ? "warning" : "success",
    },
    {
      id: "requirements",
      label: "Requirements",
      value: noCriterion ? 0 : `${passed}/${snapshot.requirements.length}`,
      unit: noCriterion ? "modelled" : "passing",
      detail: noCriterion
        ? "No model-owned criterion"
        : `${failed} failed · ${
          snapshot.requirements.length - passed - failed
        } unresolved`,
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

function graphNodeForSelection(
  snapshot: ThreadWorkbenchSnapshot,
  selection: ThreadRef,
): ThreadGraphNode | undefined {
  return snapshot.graph.nodes.findLast((node) =>
    node.selection && sameRef(node.selection, selection)
  );
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

function sameRef(left: ThreadRef, right: ThreadRef): boolean {
  return left.kind === right.kind && left.id === right.id;
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
