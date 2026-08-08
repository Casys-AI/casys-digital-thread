import type {
  ThreadAction,
  ThreadArtifact,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadObservation,
  ThreadRef,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export type WorkbenchToolId =
  | "syson"
  | "build123d"
  | "calculix"
  | "modelica"
  | "erpnext"
  | "digital-thread"
  | "other";

export interface WorkbenchToolIdentity {
  id: WorkbenchToolId;
  label: string;
  role: string;
  fullViewLabel?: string;
}

export interface ToolInspectorTarget {
  /** Exact graph entity selected in the primary Workbench surface. */
  node?: ThreadGraphNode;
  /** Optional richer browser record for the same entity. */
  record?: ThreadRef;
}

export type ToolInspectorGraphSelection =
  | { kind: "node"; ref: ThreadGraphRef }
  | {
    kind: "edge";
    id: string;
    occurrence?: { readonly key: string; readonly edge: ThreadGraphEdge };
  };

export interface InspectorContext {
  owner: WorkbenchToolIdentity;
  target?: ThreadGraphRef | ThreadRef;
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
  connection: "thread" | "connected" | "independent";
}

export const TOOL_FACETS: readonly WorkbenchToolIdentity[] = [
  {
    id: "syson",
    label: "SysON",
    role: "System model, requirements and model-owned verdicts",
    fullViewLabel: "Open system model",
  },
  {
    id: "build123d",
    label: "build123d",
    role: "Parametric geometry, measurements and CAD exports",
    fullViewLabel: "Open geometry view",
  },
  {
    id: "calculix",
    label: "CalculiX",
    role: "Structural solve, mesh evidence and field results",
    fullViewLabel: "Open structural view",
  },
  {
    id: "modelica",
    label: "Modelica",
    role: "Dynamic multiphysics scenarios and time-series evidence",
    fullViewLabel: "Open simulation view",
  },
  {
    id: "erpnext",
    label: "ERPNext",
    role: "Item, BOM and inventory context",
    fullViewLabel: "Open enterprise view",
  },
] as const;

export const THREAD_OWNER: WorkbenchToolIdentity = {
  id: "digital-thread",
  label: "Digital thread",
  role: "Change propagation and linked evidence across the engineering subject",
};

/** Prevents a graph-only selection from inheriting an unrelated old record. */
export function resolveToolInspectorTarget(
  snapshot: ThreadWorkbenchSnapshot,
  graphSelection: ToolInspectorGraphSelection | undefined,
  fallbackRecord: ThreadRef | undefined,
): ToolInspectorTarget {
  if (graphSelection?.kind === "node") {
    const node = snapshot.graph.nodes.find((candidate) =>
      sameGraphRef(candidate.ref, graphSelection.ref)
    );
    return { node, record: node?.selection };
  }
  if (graphSelection?.kind === "edge") return {};
  return { record: fallbackRecord };
}

/**
 * Resolves the exact selected relation for the drawer. Renderers that support
 * parallel edges carry the occurrence itself; legacy callers fall back to the
 * historic id lookup for compatibility.
 */
export function resolveSelectedGraphEdge(
  graph: ThreadGraph,
  selection: ToolInspectorGraphSelection | undefined,
): ThreadGraphEdge | undefined {
  if (selection?.kind !== "edge") return undefined;
  return selection.occurrence?.edge ??
    graph.edges.find((edge) => edge.id === selection.id);
}

/**
 * Resolves one graph selection to its owning tool and already-loaded evidence.
 *
 * Graph-only entities such as consumptions, evaluations and actions are kept as
 * first-class targets. Their direct recorded neighbours provide context; no
 * browser-side tool call or inferred causal link is introduced.
 */
export function resolveToolInspectorContext(
  snapshot: ThreadWorkbenchSnapshot,
  target: ToolInspectorTarget,
): InspectorContext {
  const owner = ownerForTarget(snapshot, target);
  const artifactIds = new Set<string>();
  const observationIds = new Set<string>();
  const requirementIds = new Set<string>();
  const violationIds = new Set<string>();
  const actionIds = new Set<string>();
  const targetRef = target.node?.ref ?? target.record;

  if (targetRef) addRef(targetRef);
  if (target.node) {
    for (const edge of snapshot.graph.edges) {
      if (sameGraphRef(edge.from, target.node.ref)) addRef(edge.to);
      if (sameGraphRef(edge.to, target.node.ref)) addRef(edge.from);
    }
  }

  if (targetRef?.kind === "change") {
    snapshot.artifacts.forEach((item) => artifactIds.add(item.id));
    snapshot.observations.forEach((item) => observationIds.add(item.id));
    snapshot.requirements.forEach((item) => requirementIds.add(item.id));
    snapshot.violations.forEach((item) => violationIds.add(item.id));
  }

  for (const action of snapshot.actions) {
    if (!actionIds.has(action.id)) continue;
    addRecordId(snapshot, action.targetId);
  }
  for (const violation of snapshot.violations) {
    if (!violationIds.has(violation.id)) continue;
    requirementIds.add(violation.requirementId);
    if (violation.observationId) observationIds.add(violation.observationId);
    violation.evidence.forEach((id) => artifactIds.add(id));
    violation.proposedActionIds.forEach((id) => actionIds.add(id));
  }
  for (const requirement of snapshot.requirements) {
    if (!requirementIds.has(requirement.id)) continue;
    requirement.observationIds.forEach((id) => observationIds.add(id));
    requirement.violationIds.forEach((id) => violationIds.add(id));
  }
  for (const observation of snapshot.observations) {
    if (!observationIds.has(observation.id)) continue;
    if (observation.sourceArtifactId) {
      artifactIds.add(observation.sourceArtifactId);
    }
    observation.requirementIds.forEach((id) => requirementIds.add(id));
  }

  const selectedArtifactId = targetRef?.kind === "artifact"
    ? targetRef.id
    : undefined;
  const selectedArtifact = snapshot.artifacts.find((item) =>
    item.id === selectedArtifactId
  );
  if (selectedArtifact) {
    selectedArtifact.dependsOn.forEach((id) => artifactIds.add(id));
    snapshot.artifacts
      .filter((item) => item.dependsOn.includes(selectedArtifact.id))
      .forEach((item) => artifactIds.add(item.id));
  }

  for (const observation of snapshot.observations) {
    if (artifactIds.has(observation.sourceArtifactId)) {
      observationIds.add(observation.id);
    }
  }
  for (const requirement of snapshot.requirements) {
    if (requirement.observationIds.some((id) => observationIds.has(id))) {
      requirementIds.add(requirement.id);
    }
  }
  for (const violation of snapshot.violations) {
    if (
      requirementIds.has(violation.requirementId) ||
      observationIds.has(violation.observationId)
    ) {
      violationIds.add(violation.id);
      violation.proposedActionIds.forEach((id) => actionIds.add(id));
    }
  }

  const artifacts = snapshot.artifacts.filter((item) =>
    artifactIds.has(item.id)
  );
  const observations = snapshot.observations.filter((item) =>
    observationIds.has(item.id)
  );
  const requirements = snapshot.requirements.filter((item) =>
    requirementIds.has(item.id)
  );
  const violations = snapshot.violations.filter((item) =>
    violationIds.has(item.id)
  );
  const relatedIds = new Set([
    ...(targetRef ? [targetRef.id] : []),
    ...artifacts.map((item) => item.id),
    ...observations.map((item) => item.id),
    ...requirements.map((item) => item.id),
    ...violations.map((item) => item.id),
  ]);
  const proposedActionIds = new Set([
    ...actionIds,
    ...violations.flatMap((violation) => violation.proposedActionIds),
  ]);
  const actions = snapshot.actions.filter((action) =>
    proposedActionIds.has(action.id) || relatedIds.has(action.targetId)
  );

  return {
    owner,
    target: targetRef,
    artifacts,
    observations,
    requirements,
    violations,
    actions,
    connection: owner.id === "digital-thread"
      ? "thread"
      : providerIsCrossLinked(snapshot, owner.id)
      ? "connected"
      : "independent",
  };

  function addRef(ref: ThreadGraphRef | ThreadRef): void {
    switch (ref.kind) {
      case "artifact":
        artifactIds.add(ref.id);
        break;
      case "observation":
        observationIds.add(ref.id);
        break;
      case "requirement":
        requirementIds.add(ref.id);
        break;
      case "violation":
        violationIds.add(ref.id);
        break;
      case "action":
        actionIds.add(ref.id);
        break;
      case "change":
      case "consumption":
      case "evaluation":
        break;
    }
  }

  function addRecordId(
    current: ThreadWorkbenchSnapshot,
    id: string,
  ): void {
    if (current.artifacts.some((item) => item.id === id)) artifactIds.add(id);
    if (current.observations.some((item) => item.id === id)) {
      observationIds.add(id);
    }
    if (current.requirements.some((item) => item.id === id)) {
      requirementIds.add(id);
    }
    if (current.violations.some((item) => item.id === id)) {
      violationIds.add(id);
    }
  }
}

/**
 * Returns the last graph node whose recorded selection matches the given
 * ThreadRef, or undefined when no node in the current graph represents it.
 *
 * This is the resolution path for inspector list clicks: records listed
 * in the inspector panels (artifacts, observations, requirements, violations)
 * may not have a corresponding node in the current graph projection — they
 * can be historical, folded, or from a different surface. When the ref is
 * absent the caller is expected to treat the result as a no-op on the graph
 * focus, leaving only the record selection updated.
 */
export function graphNodeForSelection(
  snapshot: ThreadWorkbenchSnapshot,
  selection: ThreadRef,
): ThreadGraphNode | undefined {
  return snapshot.graph.nodes.findLast(
    (node) => node.selection && sameRef(node.selection, selection),
  );
}

export function toolIdentity(system: string): WorkbenchToolIdentity {
  const id = toolId(system);
  if (id === "digital-thread") return THREAD_OWNER;
  const known = TOOL_FACETS.find((tool) => tool.id === id);
  return known ?? {
    id: "other",
    label: system,
    role: "Additional evidence provider",
  };
}

export function toolId(system: string): WorkbenchToolId {
  const normalized = system.toLowerCase();
  if (normalized.includes("syson")) return "syson";
  if (normalized.includes("build123d")) return "build123d";
  if (normalized.includes("calculix")) return "calculix";
  if (normalized.includes("modelica")) return "modelica";
  if (normalized.includes("erpnext")) return "erpnext";
  if (normalized.includes("digital-thread")) return "digital-thread";
  return "other";
}

function ownerForTarget(
  snapshot: ThreadWorkbenchSnapshot,
  target: ToolInspectorTarget,
): WorkbenchToolIdentity {
  if (target.node) return toolIdentity(target.node.system);
  const selection = target.record;
  if (!selection || selection.kind === "change") return THREAD_OWNER;
  const graphNode = snapshot.graph.nodes.find((node) =>
    node.selection && sameRef(node.selection, selection)
  );
  if (graphNode) return toolIdentity(graphNode.system);
  const stage = snapshot.flow.find((item) =>
    sameRef(item.selection, selection)
  );
  if (stage) return toolIdentity(stage.system);
  if (selection.kind === "artifact") {
    const artifact = snapshot.artifacts.find((item) =>
      item.id === selection.id
    );
    if (artifact) return toolIdentity(artifact.system);
  }
  if (selection.kind === "observation") {
    const observation = snapshot.observations.find((item) =>
      item.id === selection.id
    );
    const artifact = snapshot.artifacts.find((item) =>
      item.id === observation?.sourceArtifactId
    );
    if (artifact) return toolIdentity(artifact.system);
  }
  return toolIdentity("other");
}

function providerIsCrossLinked(
  snapshot: ThreadWorkbenchSnapshot,
  provider: WorkbenchToolId,
): boolean {
  const nodes = new Map(
    snapshot.graph.nodes.map((node) => [graphRefKey(node.ref), node] as const),
  );
  return snapshot.graph.edges.some((edge) => {
    const source = nodes.get(graphRefKey(edge.from));
    const target = nodes.get(graphRefKey(edge.to));
    if (!source || !target) return false;
    const sourceProvider = toolId(source.system);
    const targetProvider = toolId(target.system);
    return sourceProvider !== targetProvider &&
      (sourceProvider === provider || targetProvider === provider);
  });
}

function sameRef(left: ThreadRef, right: ThreadRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameGraphRef(left: ThreadGraphRef, right: ThreadGraphRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
