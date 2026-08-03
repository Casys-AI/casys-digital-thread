import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";
import { refKey } from "./feed-model.ts";

/** A declared immutable ThreadSnapshot reference, never a `latest` alias. */
export interface ThreadSnapshotReference {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId?: string;
}

export type RecomputeTransitionState =
  | "current"
  | "recomputing"
  | "stale"
  | "failed";

/**
 * One explicit old-evidence -> successor relation already present in the
 * graph. The model deliberately does not turn an arbitrary stale node into a
 * supersession: that would invent historical causality in the browser.
 */
export interface RecomputeTransition {
  readonly id: string;
  readonly historical: ThreadGraphNode;
  readonly successor: ThreadGraphNode;
  readonly relation: ThreadGraphEdge;
  /** Explicit current-change nodes attached to either end of this transition. */
  readonly changes: readonly ThreadGraphNode[];
  /**
   * Current evidence branches outside the correction's recorded component.
   * This says only that no dependency is recorded in this graph, never that a
   * physical system is generally unaffected.
   */
  readonly unaffectedSystems: readonly RecomputeUnaffectedSystem[];
  readonly state: RecomputeTransitionState;
  /** A fresh document/geometry is current, but only explicit evidence is published. */
  readonly publishedEvidence: boolean;
}

export interface RecomputeUnaffectedSystem {
  readonly system: string;
  readonly evidenceCount: number;
}

/** Human-readable, browser-only framing of an already recorded replacement. */
export interface RecomputeTransitionPresentation {
  readonly status: {
    readonly label:
      | "Published"
      | "Recorded change"
      | "Running"
      | "Failed"
      | "Awaiting evidence";
    readonly tone: "published" | "recorded" | "running" | "failed" | "awaiting";
  };
  readonly title: string;
  readonly affectedElement: string;
  readonly changeSummary: string;
  readonly evidence: {
    readonly count: 2;
    readonly types: readonly string[];
    readonly label: string;
  };
  readonly result: string;
}

/** One compact feed event for all explicit replacements belonging to a change. */
export interface RecomputeCorrectionGroup {
  readonly id: string;
  readonly title: string;
  readonly change?: ThreadGraphNode;
  readonly transitions: readonly RecomputeTransition[];
  readonly status: RecomputeTransitionPresentation["status"];
  readonly summary: string;
}

export interface RecomputeHistory {
  /** Earlier immutable snapshots declared by the project, if any. */
  readonly historicalSnapshots: readonly ThreadSnapshotReference[];
  /** Direct `supersedes` relations rendered as an evidence revision trail. */
  readonly transitions: readonly RecomputeTransition[];
  /** Related revisions are one feed event, never a second audit dashboard. */
  readonly groups: readonly RecomputeCorrectionGroup[];
  /** Stale facts without a recorded successor remain visibly unresolved. */
  readonly awaitingSuccessor: readonly ThreadGraphNode[];
}

export interface RecomputeHistoryInput {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
  readonly snapshotHistory?: readonly ThreadSnapshotReference[];
  readonly currentSnapshot?: ThreadSnapshotReference;
}

/**
 * Extracts only explicit correction facts from the browser-safe graph.
 *
 * The graph projector normalizes a `supersedes` provenance link to the visual
 * direction historic record -> current successor. Freshness describes the
 * successor state; it is not used to invent a missing successor.
 */
export function buildRecomputeHistory(
  input: RecomputeHistoryInput,
): RecomputeHistory {
  const nodeByRef = new Map(
    input.nodes.map((node) => [refKey(node.ref), node]),
  );
  const adjacency = undirectedAdjacency(input.edges, nodeByRef);
  const changeEdges = input.edges.filter((edge) => edge.relation === "changes");
  const correctionRoots = collectCorrectionRoots(
    changeEdges,
    new Set(
      input.edges.filter((edge) => edge.relation === "supersedes").map((edge) =>
        refKey(edge.to)
      ),
    ),
    nodeByRef,
  );
  const transitions = input.edges
    .filter((edge) => edge.relation === "supersedes")
    .flatMap((relation) => {
      const historical = nodeByRef.get(refKey(relation.from));
      const successor = nodeByRef.get(refKey(relation.to));
      if (!historical || !successor) return [];
      return [
        {
          id: relation.id,
          historical,
          successor,
          relation,
          changes: directChanges(changeEdges, nodeByRef, historical, successor),
          unaffectedSystems: unaffectedSystems(
            input.nodes,
            adjacency,
            historical,
            successor,
          ),
          state: successorState(successor),
          publishedEvidence: isPublishedEvidence(successor, input.edges),
        } satisfies RecomputeTransition,
      ];
    })
    .sort(compareTransition);
  const historicalKeys = new Set(
    transitions.map((transition) => refKey(transition.historical.ref)),
  );
  const awaitingSuccessor = input.nodes
    .filter((node) => node.freshness === "stale")
    .filter((node) => !historicalKeys.has(refKey(node.ref)))
    .sort(compareNodeRecency);

  return {
    historicalSnapshots: historicalSnapshotReferences(
      input.snapshotHistory ?? [],
      input.currentSnapshot,
    ),
    transitions,
    groups: groupTransitions(transitions, correctionRoots, input.edges),
    awaitingSuccessor,
  };
}

function collectCorrectionRoots(
  edges: readonly ThreadGraphEdge[],
  supersededSuccessors: ReadonlySet<string>,
  nodeByRef: ReadonlyMap<string, ThreadGraphNode>,
): ReadonlyMap<string, { record: ThreadGraphNode; change: ThreadGraphNode }> {
  const roots = new Map<
    string,
    { record: ThreadGraphNode; change: ThreadGraphNode }
  >();
  for (const edge of edges) {
    const change = nodeByRef.get(refKey(edge.from));
    const record = nodeByRef.get(refKey(edge.to));
    if (
      change?.entityKind !== "change" || !record ||
      !supersededSuccessors.has(refKey(record.ref))
    ) continue;
    roots.set(refKey(record.ref), { record, change });
  }
  return roots;
}

function groupTransitions(
  transitions: readonly RecomputeTransition[],
  roots: ReadonlyMap<
    string,
    { record: ThreadGraphNode; change: ThreadGraphNode }
  >,
  edges: readonly ThreadGraphEdge[],
): readonly RecomputeCorrectionGroup[] {
  const grouped = new Map<string, {
    change?: ThreadGraphNode;
    transitions: RecomputeTransition[];
  }>();
  for (const transition of transitions) {
    const root = correctionRootFor(transition.successor.ref, roots, edges);
    const id = root
      ? `change:${refKey(root.record.ref)}`
      : `revision:${transition.id}`;
    const group = grouped.get(id) ?? { change: root?.change, transitions: [] };
    group.transitions.push(transition);
    grouped.set(id, group);
  }
  return [...grouped]
    .map(([id, group]) => {
      const status = groupStatus(group.transitions);
      return {
        id,
        change: group.change,
        transitions: group.transitions.toSorted(compareTransition),
        title: group.change?.label ?? group.transitions[0]?.historical.label ??
          "Recorded revision",
        status,
        summary: groupSummary(group.transitions, status),
      } satisfies RecomputeCorrectionGroup;
    })
    .toSorted((left, right) =>
      compareTransition(left.transitions[0]!, right.transitions[0]!) ||
      left.id.localeCompare(right.id)
    );
}

function correctionRootFor(
  target: ThreadGraphRef,
  roots: ReadonlyMap<
    string,
    { record: ThreadGraphNode; change: ThreadGraphNode }
  >,
  edges: readonly ThreadGraphEdge[],
): { record: ThreadGraphNode; change: ThreadGraphNode } | undefined {
  const connectors = edges.filter((edge) =>
    edge.relation === "derived_from" || edge.relation === "input_to" ||
    edge.relation === "uses"
  );
  for (const [key, root] of roots) {
    if (
      key === refKey(target) || reaches(root.record.ref, target, connectors)
    ) {
      return root;
    }
  }
  return undefined;
}

function reaches(
  start: ThreadGraphRef,
  target: ThreadGraphRef,
  edges: readonly ThreadGraphEdge[],
): boolean {
  const wanted = refKey(target);
  const seen = new Set([refKey(start)]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (refKey(edge.from) !== refKey(current)) continue;
      const next = refKey(edge.to);
      if (next === wanted) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(edge.to);
    }
  }
  return false;
}

function undirectedAdjacency(
  edges: readonly ThreadGraphEdge[],
  nodeByRef: ReadonlyMap<string, ThreadGraphNode>,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = refKey(edge.from);
    const to = refKey(edge.to);
    if (!nodeByRef.has(from) || !nodeByRef.has(to)) continue;
    append(adjacency, from, to);
    append(adjacency, to, from);
  }
  return adjacency;
}

function unaffectedSystems(
  nodes: readonly ThreadGraphNode[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  historical: ThreadGraphNode,
  successor: ThreadGraphNode,
): RecomputeUnaffectedSystem[] {
  const correctionComponent = reachable(
    [refKey(historical.ref), refKey(successor.ref)],
    adjacency,
  );
  const artifactsBySystem = new Map<string, ThreadGraphNode[]>();
  for (const node of nodes) {
    if (node.entityKind !== "artifact") continue;
    const records = artifactsBySystem.get(node.system) ?? [];
    records.push(node);
    artifactsBySystem.set(node.system, records);
  }
  return [...artifactsBySystem]
    .flatMap(([system, artifacts]) => {
      const currentIndependent = artifacts.filter((artifact) =>
        artifact.freshness === "fresh" &&
        !correctionComponent.has(refKey(artifact.ref))
      );
      return currentIndependent.length === 0
        ? []
        : [{ system, evidenceCount: currentIndependent.length }];
    })
    .sort((left, right) => left.system.localeCompare(right.system));
}

function reachable(
  origins: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const visited = new Set(origins);
  const queue = [...origins];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function append(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

/** Returns only revision trails that explicitly contain the selected fact. */
export function recomputeTransitionsForFocus(
  history: RecomputeHistory,
  focus: ThreadGraphRef | undefined,
): RecomputeTransition[] {
  if (!focus) return [];
  const key = refKey(focus);
  return history.transitions.filter((transition) =>
    refKey(transition.historical.ref) === key ||
    refKey(transition.successor.ref) === key ||
    transition.changes.some((change) => refKey(change.ref) === key)
  );
}

/** Returns correction clusters only when their recorded change/lineage is open. */
export function recomputeGroupsForFocus(
  history: RecomputeHistory,
  focus: ThreadGraphRef | undefined,
): RecomputeCorrectionGroup[] {
  if (!focus) return [];
  const key = refKey(focus);
  return history.groups.filter((group) =>
    (group.change && refKey(group.change.ref) === key) ||
    group.transitions.some(
      (transition) =>
        refKey(transition.historical.ref) === key ||
        refKey(transition.successor.ref) === key,
    )
  );
}

/**
 * Turns a narrow, explicit supersession relation into a reviewable story.
 * This is presentation only: identifiers, hashes and raw relations remain
 * available to the UI separately under technical provenance.
 */
export function presentRecomputeTransition(
  transition: RecomputeTransition,
): RecomputeTransitionPresentation {
  const status = presentationStatus(transition);
  const types = distinct([
    evidenceType(transition.historical),
    evidenceType(transition.successor),
  ]);
  const change = transition.changes[0]?.label;
  return {
    status,
    title: change ?? `${transition.successor.label} replaces an earlier record`,
    affectedElement: transition.historical.label,
    changeSummary: transition.relation.rationale ||
      `${transition.successor.label} explicitly supersedes ${transition.historical.label}.`,
    evidence: {
      count: 2,
      types,
      label: `2 evidence records · ${types.join(" + ")}`,
    },
    result: presentationResult(transition, status),
  };
}

function directChanges(
  edges: readonly ThreadGraphEdge[],
  nodeByRef: ReadonlyMap<string, ThreadGraphNode>,
  historical: ThreadGraphNode,
  successor: ThreadGraphNode,
): ThreadGraphNode[] {
  const related = new Set([
    refKey(historical.ref),
    refKey(successor.ref),
  ]);
  const changes = edges.flatMap((edge) => {
    const from = nodeByRef.get(refKey(edge.from));
    const to = nodeByRef.get(refKey(edge.to));
    if (from?.entityKind === "change" && related.has(refKey(edge.to))) {
      return [from];
    }
    if (to?.entityKind === "change" && related.has(refKey(edge.from))) {
      return [to];
    }
    return [];
  });
  return changes
    .filter((node, index) =>
      changes.findIndex((candidate) =>
        refKey(candidate.ref) === refKey(node.ref)
      ) ===
        index
    )
    .sort(compareNodeRecency);
}

function successorState(node: ThreadGraphNode): RecomputeTransitionState {
  if (node.freshness === "fresh") return "current";
  if (node.freshness === "running") return "recomputing";
  if (node.freshness === "failed") return "failed";
  return "stale";
}

function presentationStatus(
  transition: RecomputeTransition,
): RecomputeTransitionPresentation["status"] {
  if (transition.state === "recomputing") {
    return { label: "Running", tone: "running" };
  }
  if (transition.state === "failed") return { label: "Failed", tone: "failed" };
  if (transition.publishedEvidence) {
    return { label: "Published", tone: "published" };
  }
  if (transition.state === "current") {
    return { label: "Recorded change", tone: "recorded" };
  }
  return { label: "Awaiting evidence", tone: "awaiting" };
}

function presentationResult(
  transition: RecomputeTransition,
  status: RecomputeTransitionPresentation["status"],
): string {
  if (status.tone === "published") {
    return `${transition.successor.label} is published as the current successor.`;
  }
  if (status.tone === "recorded") {
    return "The correction is recorded; a replacement proof has not yet been published.";
  }
  if (status.tone === "running") {
    return `${transition.successor.label} is still running; no current replacement is claimed.`;
  }
  if (status.tone === "failed") {
    return `${transition.successor.label} failed; the historical record remains retained.`;
  }
  return `${transition.successor.label} is also stale; a current replacement is still missing.`;
}

function isPublishedEvidence(
  successor: ThreadGraphNode,
  edges: readonly ThreadGraphEdge[],
): boolean {
  if (successor.freshness !== "fresh") return false;
  if (successor.entityKind !== "artifact") return false;
  if (
    successor.artifactKind !== "solver-result" &&
    successor.artifactKind !== "evidence"
  ) {
    return false;
  }
  return edges.some((edge) =>
    edge.relation === "evidences" && refKey(edge.from) === refKey(successor.ref)
  );
}

function groupStatus(
  transitions: readonly RecomputeTransition[],
): RecomputeTransitionPresentation["status"] {
  const stories = transitions.map(presentRecomputeTransition);
  return stories.find((story) => story.status.tone === "failed")?.status ??
    stories.find((story) => story.status.tone === "running")?.status ??
    stories.find((story) => story.status.tone === "published")?.status ??
    stories.find((story) => story.status.tone === "recorded")?.status ??
    { label: "Awaiting evidence", tone: "awaiting" };
}

function groupSummary(
  transitions: readonly RecomputeTransition[],
  status: RecomputeTransitionPresentation["status"],
): string {
  const published =
    transitions.filter((transition) => transition.publishedEvidence).length;
  if (status.tone === "failed") {
    return "A replacement operation failed; the historical evidence remains retained.";
  }
  if (status.tone === "running") {
    return "Replacement evidence is being recomputed from this recorded correction.";
  }
  if (published > 0) {
    return `${published} replacement evidence record${
      published === 1 ? " is" : "s are"
    } published; related records remain traceable below.`;
  }
  return "The correction is recorded; replacement evidence has not yet been published.";
}

function evidenceType(node: ThreadGraphNode): string {
  if (node.entityKind !== "artifact" || !node.artifactKind) {
    return "evidence record";
  }
  return node.artifactKind.replaceAll("-", " ");
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function historicalSnapshotReferences(
  references: readonly ThreadSnapshotReference[],
  current: ThreadSnapshotReference | undefined,
): ThreadSnapshotReference[] {
  const seen = new Set<string>();
  return references
    .filter((reference) =>
      !current || reference.snapshotId !== current.snapshotId ||
      reference.revision !== current.revision
    )
    .filter((reference) => {
      const key = `${reference.snapshotId}\u0000${reference.revision}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .toSorted((left, right) =>
      right.revision - left.revision ||
      left.snapshotId.localeCompare(right.snapshotId)
    );
}

function compareTransition(
  left: RecomputeTransition,
  right: RecomputeTransition,
): number {
  return compareNodeRecency(left.successor, right.successor) ||
    left.id.localeCompare(right.id);
}

function compareNodeRecency(
  left: ThreadGraphNode,
  right: ThreadGraphNode,
): number {
  return (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") ||
    left.label.localeCompare(right.label) ||
    refKey(left.ref).localeCompare(refKey(right.ref));
}
