import {
  boundedLineageNeighborhood,
  type EvidenceGraphModel,
  type EvidenceGraphNeighborhood,
} from "./evidence-graph-model.ts";
import type { ProjectReviewRecord } from "../project/review-decision-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadFreshness,
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

export type ActivityTimelineEntry =
  | {
    readonly kind: "thread";
    readonly key: string;
    readonly recordedAt: string;
    readonly node: ThreadGraphNode;
    /** Exact human review whose published result is this same thread fact. */
    readonly review?: ProjectReviewRecord;
  }
  | {
    readonly kind: "review";
    readonly key: string;
    readonly recordedAt: string;
    readonly review: ProjectReviewRecord;
  };

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

/**
 * Activity currency for one feed fact. Family `historicalRefs` are retained
 * history; they must not keep the current `fresh` chip even when the sealed
 * capture itself is still a fresh artifact.
 */
export type ActivityCurrency = ThreadFreshness | "historical";

export function activityCurrency(
  node: ThreadGraphNode,
  familyGraph: ThreadEvidenceFamilyGraph | undefined,
): ActivityCurrency {
  if (!familyGraph) return node.freshness;
  const key = refKey(node.ref);
  const historical = familyGraph.families.some((family) =>
    family.status === "current" &&
    family.currentRefs.length === 1 &&
    family.historicalRefs.some((reference) => refKey(reference) === key)
  );
  return historical ? "historical" : node.freshness;
}

/**
 * Selects generic recorded activity without interpreting ids, systems or
 * domain payloads. Undated records stay in lineage unless the server marks
 * them as an explicit milestone.
 */
export function activityFeedNodes(
  nodes: ThreadGraphNode[],
): ThreadGraphNode[] {
  return nodes.filter((node) =>
    node.recordedAt !== undefined || node.activityRole === "milestone"
  )
    .filter(uniqueNode)
    .sort(compareActivityNodes);
}

/**
 * Merge review decisions and technical facts into one chronological Activity
 * stream. Review records without a durable timestamp or visible human state
 * stay out of the feed; published artifacts remain their own thread events.
 */
export function buildActivityTimeline(
  nodes: readonly ThreadGraphNode[],
  reviews: readonly ProjectReviewRecord[],
): ActivityTimelineEntry[] {
  const visibleReviews = reviews.filter((review) =>
    review.recordedAt && review.state !== "unavailable"
  );
  const reviewsByResult = new Map<string, ProjectReviewRecord[]>();
  for (const review of visibleReviews) {
    if (review.state !== "published" || !review.resultEvidence) continue;
    appendReview(
      reviewsByResult,
      refKey(review.resultEvidence),
      review,
    );
  }
  const attachedReviewKeys = new Set<string>();
  const threadEntries: ActivityTimelineEntry[] = nodes.map((node) => {
    const candidates = reviewsByResult.get(refKey(node.ref)) ?? [];
    const review = candidates.length === 1 ? candidates[0] : undefined;
    if (review) attachedReviewKeys.add(reviewEventKey(review));
    return {
      kind: "thread" as const,
      key: `thread:${refKey(node.ref)}`,
      recordedAt: node.recordedAt ?? "",
      node,
      review,
    };
  });
  const reviewEntries: ActivityTimelineEntry[] = visibleReviews.flatMap(
    (review) => {
      const key = reviewEventKey(review);
      return attachedReviewKeys.has(key) ? [] : [{
        kind: "review" as const,
        key,
        recordedAt: review.recordedAt!,
        review,
      }];
    },
  );
  return [...threadEntries, ...reviewEntries].sort((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt) ||
    activityTimelinePriority(left) - activityTimelinePriority(right) ||
    left.key.localeCompare(right.key)
  );
}

function reviewEventKey(review: ProjectReviewRecord): string {
  return `review:${review.recordId}`;
}

function appendReview(
  map: Map<string, ProjectReviewRecord[]>,
  key: string,
  review: ProjectReviewRecord,
): void {
  const existing = map.get(key) ?? [];
  map.set(key, [...existing, review]);
}

function activityTimelinePriority(entry: ActivityTimelineEntry): number {
  return entry.kind === "review" ? 0 : 1;
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

/** Literal recorded kind used by the generic Activity eyebrow. */
export function activityKindLabel(node: ThreadGraphNode): string {
  return node.artifactKind ?? node.entityKind;
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
  return node.activityRole === "milestone" ? 0 : 1;
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

export type CompactLineageProjection = EvidenceGraphNeighborhood;

/**
 * Builds the one Activity lineage projection consumed by both the vignette and
 * its counters: the exact directional depth-two recorded context.
 */
export function compactLineageProjection(
  evidenceModel: EvidenceGraphModel,
  focusRef: ThreadGraphRef,
): CompactLineageProjection {
  const neighborhood = boundedLineageNeighborhood(evidenceModel, focusRef, 2);
  return { nodes: neighborhood.nodes, edges: neighborhood.edges };
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
  const all = compactLineageProjection(evidenceModel, focusRef);
  const visible = new Set(all.nodes.map((node) => refKey(node.ref)));
  const up = evidenceModel.boundedNeighborhood(focusRef, 2, "upstream");
  const down = evidenceModel.boundedNeighborhood(focusRef, 2, "downstream");
  const focusKey = refKey(focusRef);
  return {
    total: all.nodes.length,
    upstream: renderedDirectionalKeys(up.nodes).size,
    downstream: renderedDirectionalKeys(down.nodes).size,
  };

  function renderedDirectionalKeys(
    nodes: readonly ThreadGraphNode[],
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const node of nodes) {
      const key = refKey(node.ref);
      if (key !== focusKey && visible.has(key)) keys.add(key);
    }
    return keys;
  }
}
