import type {
  ThreadAction,
  ThreadArtifact,
  ThreadChange,
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

export interface RecordInspectorTarget {
  /** Exact graph entity selected in the primary Workbench surface. */
  node?: ThreadGraphNode;
  /** Optional richer browser record for the same recorded selection. */
  record?: ThreadRef;
}

export type RecordInspectorGraphSelection =
  | { kind: "node"; ref: ThreadGraphRef }
  | {
    kind: "edge";
    id: string;
    occurrence?: { readonly key: string; readonly edge: ThreadGraphEdge };
  };

export type InspectableRecord =
  | ThreadChange
  | ThreadArtifact
  | ThreadObservation
  | ThreadRequirement
  | ThreadViolation
  | ThreadAction;

export interface InspectorRecord {
  ref: ThreadGraphRef;
  value: InspectableRecord;
}

export interface InspectorRelation {
  edge: ThreadGraphEdge;
  direction: "incoming" | "outgoing";
  peerRef: ThreadGraphRef;
  peerNode?: ThreadGraphNode;
}

/**
 * Read-only context for one exact graph identity.
 *
 * The context deliberately does not classify the record by producer, provider,
 * or engineering domain. It exposes only fields and relations already present
 * in the loaded Workbench snapshot.
 */
export interface RecordInspectorContext {
  target?: ThreadGraphRef;
  node?: ThreadGraphNode;
  record?: InspectorRecord;
  relations: InspectorRelation[];
  relatedRecords: InspectorRecord[];
}

/** Prevents a graph-only selection from inheriting an unrelated old record. */
export function resolveRecordInspectorTarget(
  snapshot: ThreadWorkbenchSnapshot,
  graphSelection: RecordInspectorGraphSelection | undefined,
  fallbackRecord: ThreadRef | undefined,
): RecordInspectorTarget {
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
 * historic id lookup only when it identifies one relation unambiguously.
 */
export function resolveSelectedGraphEdge(
  graph: ThreadGraph,
  selection: RecordInspectorGraphSelection | undefined,
): ThreadGraphEdge | undefined {
  if (selection?.kind !== "edge") return undefined;
  if (selection.occurrence?.edge) return selection.occurrence.edge;
  const matches = graph.edges.filter((edge) => edge.id === selection.id);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolves one selection to its exact record and incident recorded relations.
 * No browser-side operation, provider inference, graph traversal, or metric is
 * introduced here.
 */
export function resolveRecordInspectorContext(
  snapshot: ThreadWorkbenchSnapshot,
  target: RecordInspectorTarget,
): RecordInspectorContext {
  const targetRef = target.node?.ref ?? target.record;
  if (!targetRef) {
    return {
      relations: [],
      relatedRecords: [],
    };
  }
  const selectedRef: ThreadGraphRef = targetRef;

  const record = exactRecord(snapshot, selectedRef);
  const relations = incidentRelations(snapshot, selectedRef);
  const relatedByRef = new Map<string, InspectorRecord>();

  addRelated(target.node?.selection);
  if (target.record && !sameGraphRef(target.record, selectedRef)) {
    addRelated(target.record);
  }
  for (const relation of relations) {
    addRelated(relation.peerRef);
    addRelated(relation.peerNode?.selection);
  }
  if (record) relatedByRef.delete(graphRefKey(record.ref));

  return {
    target: selectedRef,
    node: target.node,
    record,
    relations,
    relatedRecords: [...relatedByRef.values()],
  };

  function addRelated(ref: ThreadGraphRef | ThreadRef | undefined): void {
    if (!ref || sameGraphRef(ref, selectedRef)) return;
    const candidate = exactRecord(snapshot, ref);
    if (!candidate) return;
    const key = graphRefKey(candidate.ref);
    if (!relatedByRef.has(key)) relatedByRef.set(key, candidate);
  }
}

/**
 * Returns the graph node whose exact ref represents a record, falling back to
 * the last explicit selection alias only when there is no exact graph node.
 */
export function graphNodeForSelection(
  snapshot: ThreadWorkbenchSnapshot,
  selection: ThreadRef,
): ThreadGraphNode | undefined {
  const exact = snapshot.graph.nodes.find((node) =>
    node.ref.kind === selection.kind && node.ref.id === selection.id
  );
  if (exact) return exact;
  return snapshot.graph.nodes.findLast(
    (node) => node.selection && sameGraphRef(node.selection, selection),
  );
}

function incidentRelations(
  snapshot: ThreadWorkbenchSnapshot,
  target: ThreadGraphRef,
): InspectorRelation[] {
  const nodesByRef = new Map(
    snapshot.graph.nodes.map((node) => [graphRefKey(node.ref), node] as const),
  );
  const relations: InspectorRelation[] = [];
  for (const edge of snapshot.graph.edges) {
    if (sameGraphRef(edge.from, target)) {
      relations.push({
        edge,
        direction: "outgoing",
        peerRef: edge.to,
        peerNode: nodesByRef.get(graphRefKey(edge.to)),
      });
    }
    if (sameGraphRef(edge.to, target)) {
      relations.push({
        edge,
        direction: "incoming",
        peerRef: edge.from,
        peerNode: nodesByRef.get(graphRefKey(edge.from)),
      });
    }
  }
  return relations;
}

function exactRecord(
  snapshot: ThreadWorkbenchSnapshot,
  ref: ThreadGraphRef | ThreadRef,
): InspectorRecord | undefined {
  switch (ref.kind) {
    case "change":
      return snapshot.change.id === ref.id
        ? { ref: { kind: "change", id: ref.id }, value: snapshot.change }
        : undefined;
    case "artifact": {
      const value = snapshot.artifacts.find((item) => item.id === ref.id);
      return value
        ? { ref: { kind: "artifact", id: ref.id }, value }
        : undefined;
    }
    case "observation": {
      const value = snapshot.observations.find((item) => item.id === ref.id);
      return value
        ? { ref: { kind: "observation", id: ref.id }, value }
        : undefined;
    }
    case "requirement": {
      const value = snapshot.requirements.find((item) => item.id === ref.id);
      return value
        ? { ref: { kind: "requirement", id: ref.id }, value }
        : undefined;
    }
    case "violation": {
      const value = snapshot.violations.find((item) => item.id === ref.id);
      return value
        ? { ref: { kind: "violation", id: ref.id }, value }
        : undefined;
    }
    case "action": {
      const value = snapshot.actions.find((item) => item.id === ref.id);
      return value ? { ref: { kind: "action", id: ref.id }, value } : undefined;
    }
    case "consumption":
    case "evaluation":
    case "analysis-node":
    case "part-definition":
    case "part-usage":
    case "attribute-usage":
      return undefined;
  }
}

function sameGraphRef(
  left: ThreadGraphRef | ThreadRef,
  right: ThreadGraphRef | ThreadRef,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function graphRefKey(ref: ThreadGraphRef | ThreadRef): string {
  return `${ref.kind}:${ref.id}`;
}
