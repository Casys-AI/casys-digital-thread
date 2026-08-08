import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type {
  PartAnchorageResolution,
  PartTarget,
} from "./part-anchorage-model.ts";
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
export function activityFeedNodes(
  nodes: ThreadGraphNode[],
  edges: readonly ThreadGraphEdge[] = [],
): ThreadGraphNode[] {
  const primary = nodes.filter((node) =>
    node.entityKind === "observation" ||
    node.entityKind === "requirement" ||
    node.entityKind === "evaluation" ||
    node.entityKind === "violation" ||
    node.entityKind === "action" ||
    // The BFF assigns this presentation-only role to bounded live milestones.
    // Untagged support nodes, including generic `other` artifacts, stay in
    // lineage rather than becoming feed noise.
    node.activityRole === "milestone" ||
    (node.entityKind === "artifact" && isPrimaryArtifact(node.artifactKind))
  );
  return [...primary, ...recordedCorrectionNodes(nodes, edges)]
    .filter(uniqueNode)
    .sort(compareActivityNodes);
}

/**
 * The Activity surface is chronological by default. A lineage expands only
 * when another workspace or an explicit feed action selected this exact fact.
 */
export function isActivityEntryExpanded(
  focus: ThreadGraphRef | undefined,
  node: ThreadGraphNode,
): boolean {
  return focus !== undefined && refKey(focus) === refKey(node.ref);
}

/**
 * Only a change whose recorded target is itself an explicit `supersedes`
 * successor is a correction event. Snapshot-extension creation records remain
 * provenance support, even when they happen to be the newest graph changes.
 * The browser contract has no typed change-intent field yet, so the canonical
 * provenance rationale is the explicit distinction between those records.
 */
function recordedCorrectionNodes(
  nodes: readonly ThreadGraphNode[],
  edges: readonly ThreadGraphEdge[],
): ThreadGraphNode[] {
  const nodeByRef = new Map(nodes.map((node) => [refKey(node.ref), node]));
  const correctionTargets = new Set(
    edges.filter((edge) => edge.relation === "supersedes").map((edge) =>
      refKey(edge.to)
    ),
  );
  return edges.flatMap((edge) => {
    if (
      edge.relation !== "changes" || !correctionTargets.has(refKey(edge.to)) ||
      edge.rationale ===
        "This snapshot extension introduced the captured artifact."
    ) {
      return [];
    }
    const change = nodeByRef.get(refKey(edge.from));
    return change?.entityKind === "change" ? [change] : [];
  });
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
  return `${ref.kind}\0${ref.id}`;
}

// ---------------------------------------------------------------------------
// Compact lineage counters — feed card vignette (sigma, depth 2)
// ---------------------------------------------------------------------------

export interface CompactLineageCounters {
  /** Total nodes in the bounded neighbourhood (including the focus node). */
  total: number;
  /**
   * Upstream nodes within depth 2 (incoming direction), excluding the focus.
   * Matches what the compact vignette renders to the left of the focus node.
   */
  upstream: number;
  /**
   * Downstream nodes within depth 2 (outgoing direction), excluding the focus.
   * Matches what the compact vignette renders to the right of the focus node.
   */
  downstream: number;
}

/**
 * Computes the truthful counters for the feed lineage bandeau.
 *
 * The header says what the sigma vignette actually renders:
 *   « N faits · profondeur 2 · X amont / Y aval »
 *
 * Both upstream and downstream exclude the focus node itself to avoid
 * double-counting (the focus appears once, in the centre of the dagre LR
 * layout). Nodes reachable from both directions (cycles) are counted in the
 * total but may appear in both the upstream and downstream counts — that is
 * intentional: the vignette shows them, so they are counted.
 */
export function compactLineageCounters(
  evidenceModel: EvidenceGraphModel,
  focusRef: ThreadGraphRef,
): CompactLineageCounters {
  const all = evidenceModel.boundedNeighborhood(focusRef, 2);
  const up = evidenceModel.boundedNeighborhood(focusRef, 2, "upstream");
  const down = evidenceModel.boundedNeighborhood(focusRef, 2, "downstream");
  return {
    total: all.nodes.length,
    upstream: Math.max(0, up.nodes.length - 1),
    downstream: Math.max(0, down.nodes.length - 1),
  };
}

// ---------------------------------------------------------------------------
// Feed component attribution — event counts per part
// ---------------------------------------------------------------------------

/**
 * Filter ids deliberately outside the component catalog. They make a missing
 * or conflicting anchor reviewable instead of silently assigning it to the
 * whole assembly.
 */
export const AMBIGUOUS_FEED_SCOPE = "__feed-anchorage:ambiguous";
export const ORPHAN_FEED_SCOPE = "__feed-anchorage:orphan";

export type FeedScope =
  | PartTarget
  | typeof AMBIGUOUS_FEED_SCOPE
  | typeof ORPHAN_FEED_SCOPE;

/** Return the complete anchorage outcome of a primary feed event. */
export function feedScopeForNode(
  node: ThreadGraphNode,
  anchorage: PartAnchorageResolution,
): FeedScope {
  // Part anchorage deliberately uses this kind:id key format (rather than the
  // null-byte lineage key) so it can be shared by every workbench surface.
  const key = `${node.ref.kind}:${node.ref.id}`;
  const anchor = anchorage.anchors.get(key);
  if (anchor) return anchor.target;
  if (anchorage.ambiguousByRef.has(key)) return AMBIGUOUS_FEED_SCOPE;
  // Unknown keys, as well as explicit orphan keys, are an orphan outcome. A
  // partial snapshot must never acquire an invented assembly provenance.
  return ORPHAN_FEED_SCOPE;
}

/** Apply an explicit component or non-anchored feed filter. */
export function filterFeedNodesByScope(
  feedNodes: readonly ThreadGraphNode[],
  anchorage: PartAnchorageResolution,
  scope: FeedScope | undefined,
): ThreadGraphNode[] {
  if (scope === undefined) return [...feedNodes];
  return feedNodes.filter((node) =>
    feedScopeForNode(node, anchorage) === scope
  );
}

/**
 * Computes the number of activity feed events attributed to each component.
 *
 * Attribution mirrors the feed filter in feed.tsx: a unique primary ref uses
 * its component target; conflicting and absent anchors remain distinct,
 * reviewable scopes. They are never folded into the assembly count.
 *
 * An event with multiple roles always takes the anchor of its own ref (the
 * primary fact ref), not its lineage neighbours.
 *
 * Returns a Map<FeedScope, count> where only scopes with at least one event
 * appear. "assembly" is a valid unique target; ambiguous and orphan scopes
 * use the exported sentinel ids.
 */
export function buildFeedComponentCounts(
  feedNodes: ThreadGraphNode[],
  anchorage: PartAnchorageResolution,
): Map<FeedScope, number> {
  const counts = new Map<FeedScope, number>();
  for (const node of feedNodes) {
    const scope = feedScopeForNode(node, anchorage);
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  return counts;
}
