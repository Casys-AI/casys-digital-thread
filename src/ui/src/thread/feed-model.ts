import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

export interface ThreadLineageStep {
  node: ThreadGraphNode;
  /** Distance from the selected fact in the recorded graph. */
  depth: number;
}

export interface ThreadLineage {
  focus?: ThreadGraphNode;
  /** Farthest source first, so the evidence reads toward the selected fact. */
  upstream: ThreadLineageStep[];
  /** Nearest consequence first, so impact reads away from the selected fact. */
  downstream: ThreadLineageStep[];
  /** Nodes participating in a feedback cycle through the selected fact. */
  feedback: ThreadLineageStep[];
  /** Every edge whose endpoints are part of this complete lineage. */
  edges: ThreadGraphEdge[];
}

/**
 * Returns every recorded ancestor and descendant of a selected fact.
 *
 * This is deliberately a graph traversal, not a shortest-path projection: a
 * branch must not disappear just because another source reaches the focus in
 * fewer hops.
 */
export function traceThreadLineage(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
  focus: ThreadGraphRef | undefined,
): ThreadLineage {
  const nodeByKey = new Map(nodes.map((node) => [refKey(node.ref), node]));
  const focusKey = focus ? refKey(focus) : undefined;
  const focusNode = focusKey ? nodeByKey.get(focusKey) : undefined;
  if (!focusKey || !focusNode) {
    return { upstream: [], downstream: [], feedback: [], edges: [] };
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const from = refKey(edge.from);
    const to = refKey(edge.to);
    if (!nodeByKey.has(from) || !nodeByKey.has(to)) continue;
    append(outgoing, from, to);
    append(incoming, to, from);
  }

  const upstreamDistance = distancesFrom(focusKey, incoming);
  const downstreamDistance = distancesFrom(focusKey, outgoing);
  upstreamDistance.delete(focusKey);
  downstreamDistance.delete(focusKey);

  const feedbackKeys = new Set(
    [...upstreamDistance.keys()].filter((key) => downstreamDistance.has(key)),
  );
  for (const key of feedbackKeys) {
    upstreamDistance.delete(key);
    downstreamDistance.delete(key);
  }

  const upstream = steps(upstreamDistance, nodeByKey, "upstream");
  const downstream = steps(downstreamDistance, nodeByKey, "downstream");
  const feedback = [...feedbackKeys].flatMap((key) => {
    const node = nodeByKey.get(key);
    if (!node) return [];
    return [{
      node,
      depth: Math.min(
        distancesFrom(focusKey, incoming).get(key) ?? Number.MAX_SAFE_INTEGER,
        distancesFrom(focusKey, outgoing).get(key) ?? Number.MAX_SAFE_INTEGER,
      ),
    }];
  }).sort(compareSteps);

  const lineageKeys = new Set([
    focusKey,
    ...upstream.map((step) => refKey(step.node.ref)),
    ...downstream.map((step) => refKey(step.node.ref)),
    ...feedback.map((step) => refKey(step.node.ref)),
  ]);
  const lineageEdges = edges.filter((edge) =>
    lineageKeys.has(refKey(edge.from)) && lineageKeys.has(refKey(edge.to))
  );

  return {
    focus: focusNode,
    upstream,
    downstream,
    feedback,
    edges: lineageEdges,
  };
}

/** Selects meaningful activity cards; supporting records stay in lineage. */
export function activityFeedNodes(nodes: ThreadGraphNode[]): ThreadGraphNode[] {
  const latestChange = nodes.findLast((node) => node.entityKind === "change");
  const primary = nodes.filter((node) =>
    node.entityKind === "observation" ||
    node.entityKind === "requirement" ||
    node.entityKind === "evaluation" ||
    node.entityKind === "violation" ||
    node.entityKind === "action" ||
    (node.entityKind === "artifact" && isPrimaryArtifact(node.artifactKind))
  );
  return [...primary, ...(latestChange ? [latestChange] : [])]
    .filter(uniqueNode)
    .sort(compareActivityNodes);
}

function isPrimaryArtifact(kind: string | undefined): boolean {
  return kind === "sysml-model" || kind === "cad-model" || kind === "step" ||
    kind === "solver-result" || kind === "bom";
}

function steps(
  distance: Map<string, number>,
  nodeByKey: Map<string, ThreadGraphNode>,
  direction: "upstream" | "downstream",
): ThreadLineageStep[] {
  return [...distance].flatMap(([key, depth]) => {
    const node = nodeByKey.get(key);
    return node ? [{ node, depth }] : [];
  }).sort((left, right) =>
    direction === "upstream"
      ? right.depth - left.depth || compareSteps(left, right)
      : left.depth - right.depth || compareSteps(left, right)
  );
}

function distancesFrom(
  origin: string,
  adjacency: Map<string, string[]>,
): Map<string, number> {
  const distances = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const nextDepth = (distances.get(current) ?? 0) + 1;
    for (const next of adjacency.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, nextDepth);
      queue.push(next);
    }
  }
  return distances;
}

function compareActivityNodes(
  left: ThreadGraphNode,
  right: ThreadGraphNode,
): number {
  return (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") ||
    activityPriority(left) - activityPriority(right) ||
    left.label.localeCompare(right.label) ||
    refKey(left.ref).localeCompare(refKey(right.ref));
}

function activityPriority(node: ThreadGraphNode): number {
  switch (node.entityKind) {
    case "violation":
      return 0;
    case "evaluation":
      return 1;
    case "observation":
      return 2;
    case "requirement":
      return 3;
    case "action":
      return 4;
    case "artifact":
      return 5;
    case "change":
      return 6;
    default:
      return 7;
  }
}

function compareSteps(
  left: ThreadLineageStep,
  right: ThreadLineageStep,
): number {
  return left.node.label.localeCompare(right.node.label) ||
    refKey(left.node.ref).localeCompare(refKey(right.node.ref));
}

function uniqueNode(
  node: ThreadGraphNode,
  index: number,
  nodes: ThreadGraphNode[],
): boolean {
  const key = refKey(node.ref);
  return nodes.findIndex((candidate) => refKey(candidate.ref) === key) ===
    index;
}

function append(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}

export function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}\u0000${ref.id}`;
}
