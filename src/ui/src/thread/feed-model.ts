import {
  boundedLineageNeighborhood,
  type EvidenceGraphModel,
  type EvidenceGraphNeighborhood,
} from "./evidence-graph-model.ts";
import type { ProjectReviewRecord } from "../project/review-decision-model.ts";
import { applyEssentialFilter } from "./essential-graph-filter.ts";
import {
  compactSysmlPartPairs,
  graphRefKey,
} from "../architecture/sysml-composite-projection.ts";
import type {
  PartAnchorageResolution,
  PartTarget,
} from "./part-anchorage-model.ts";
import type {
  ThreadComponentCatalog,
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
    (node.entityKind === "artifact" && isPrimaryArtifact(node))
  );
  return [...primary, ...recordedCorrectionNodes(nodes, edges)]
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
  includeStandaloneReviews = true,
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
  const reviewEntries: ActivityTimelineEntry[] = includeStandaloneReviews
    ? visibleReviews.flatMap(
      (review) => {
        const key = reviewEventKey(review);
        return attachedReviewKeys.has(key) ? [] : [{
          kind: "review" as const,
          key,
          recordedAt: review.recordedAt!,
          review,
        }];
      },
    )
    : [];
  return [...threadEntries, ...reviewEntries].sort((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt) ||
    activityTimelinePriority(left) - activityTimelinePriority(right) ||
    left.key.localeCompare(right.key)
  );
}

function reviewEventKey(review: ProjectReviewRecord): string {
  const identity = review.decision?.id ??
    (review.preview.kind === "brief" ? review.preview.brief.id : review.id);
  return `review:${identity}`;
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

/** Server-fixed id prefix of `model.seal-architecture-sysml@1` documents. */
export const ARCHITECTURE_SYSML_SEAL_ARTIFACT_ID_PREFIX =
  "architecture-sysml-seal-";

/** Server-fixed id prefix of `industrialize.run-dfm-checks@1` captures. */
export const DFM_CHECK_ARTIFACT_ID_PREFIX = "dfm-check-";

/** Server-fixed id prefix of `verify.evaluate-sensitivity-base@1` captures. */
export const SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX =
  "sensitivity-base-evaluation-";

export function isArchitectureSysmlSealArtifactId(id: string): boolean {
  return id.startsWith(ARCHITECTURE_SYSML_SEAL_ARTIFACT_ID_PREFIX);
}

export function isMeasuredDfmArtifactId(id: string): boolean {
  return id.startsWith(DFM_CHECK_ARTIFACT_ID_PREFIX);
}

export function isSensitivityBaseEvaluationArtifactId(id: string): boolean {
  return id.startsWith(SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX);
}

/**
 * Activity eyebrow for a feed card. The sealed architecture SysML document
 * keeps `kind: "document"` and surfaces the contract label `documentary`.
 */
export function activityKindLabel(node: ThreadGraphNode): string {
  if (node.entityKind === "artifact" && node.artifactKind) {
    if (
      node.artifactKind === "document" &&
      isArchitectureSysmlSealArtifactId(node.ref.id)
    ) {
      return "document · documentary";
    }
    if (isMeasuredDfmArtifactId(node.ref.id)) {
      return "measured DFM";
    }
    if (isSensitivityBaseEvaluationArtifactId(node.ref.id)) {
      return "study-base evaluation";
    }
    return node.artifactKind;
  }
  if (
    node.entityKind === "evaluation" && node.evaluationFamily === "study-base"
  ) {
    return "study-base evaluation";
  }
  return node.entityKind;
}

function isPrimaryArtifact(node: ThreadGraphNode): boolean {
  const kind = node.artifactKind;
  return kind === "sysml-model" || kind === "cad-model" || kind === "step" ||
    kind === "solver-result" || kind === "bom" ||
    (kind === "document" && isArchitectureSysmlSealArtifactId(node.ref.id)) ||
    isMeasuredDfmArtifactId(node.ref.id) ||
    isSensitivityBaseEvaluationArtifactId(node.ref.id);
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

export interface CompactLineageProjection extends EvidenceGraphNeighborhood {
  /** Supporting facts folded by the shared essential display mask. */
  readonly hiddenSupportingCount: number;
  /** Exact identity aliases used only to keep directional counters truthful. */
  readonly compositeRefByMemberRefKey: ReadonlyMap<string, ThreadGraphRef>;
}

/**
 * Builds the one Activity lineage projection consumed by both the vignette and
 * its counters: directional depth-two context first, then the same essential
 * display mask as Evidence.
 */
export function compactLineageProjection(
  evidenceModel: EvidenceGraphModel,
  focusRef: ThreadGraphRef,
): CompactLineageProjection {
  const neighborhood = boundedLineageNeighborhood(evidenceModel, focusRef, 2);
  const filtered = applyEssentialFilter(
    neighborhood.nodes,
    neighborhood.edges,
  );
  const compacted = compactSysmlPartPairs(
    evidenceModel,
    filtered,
    focusRef,
  );
  return {
    nodes: compacted.nodes,
    edges: compacted.edges,
    hiddenSupportingCount: filtered.hiddenCount,
    compositeRefByMemberRefKey: compacted.compositeRefByMemberRefKey,
  };
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
  const visible = new Set(all.nodes.map((node) => graphRefKey(node.ref)));
  const up = evidenceModel.boundedNeighborhood(focusRef, 2, "upstream");
  const down = evidenceModel.boundedNeighborhood(focusRef, 2, "downstream");
  const focusKey = renderedKey(focusRef);
  return {
    total: all.nodes.length,
    upstream: renderedDirectionalKeys(up.nodes).size,
    downstream: renderedDirectionalKeys(down.nodes).size,
  };

  function renderedKey(ref: ThreadGraphRef): string {
    return graphRefKey(
      all.compositeRefByMemberRefKey.get(graphRefKey(ref)) ?? ref,
    );
  }

  function renderedDirectionalKeys(
    nodes: readonly ThreadGraphNode[],
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const node of nodes) {
      const key = renderedKey(node.ref);
      if (key !== focusKey && visible.has(key)) keys.add(key);
    }
    return keys;
  }
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

/**
 * Build the list of component and explicit non-anchored filter options.
 *
 * Assembly is present only for a real unique assembly anchor. Ambiguous and
 * orphan evidence remain visible in their own audit scopes.
 */
export function buildFilterOptions(
  components: ThreadComponentCatalog,
  counts?: ReadonlyMap<FeedScope, number>,
): { id: FeedScope; label: string }[] {
  const result: { id: FeedScope; label: string }[] = [];
  const assembly = components.components.find((component) =>
    component.kind === "assembly"
  );
  if (assembly) {
    const count = counts?.get("assembly") ?? 0;
    if (!counts || count > 0) {
      const suffix = counts ? ` · ${count}` : "";
      result.push({
        id: "assembly",
        label: `${assembly.label} (assemblage)${suffix}`,
      });
    }
  }
  for (
    const part of components.components
      .filter((component) => component.kind !== "assembly")
      .sort((left, right) => left.label.localeCompare(right.label))
  ) {
    const count = counts?.get(part.id) ?? 0;
    if (counts && count === 0) continue;
    const suffix = counts ? ` · ${count}` : "";
    result.push({ id: part.id, label: `${part.label}${suffix}` });
  }
  const ambiguous = counts?.get(AMBIGUOUS_FEED_SCOPE) ?? 0;
  if (!counts || ambiguous > 0) {
    result.push({
      id: AMBIGUOUS_FEED_SCOPE,
      label: `À rattacher — ambigu${counts ? ` · ${ambiguous}` : ""}`,
    });
  }
  const orphan = counts?.get(ORPHAN_FEED_SCOPE) ?? 0;
  if (!counts || orphan > 0) {
    result.push({
      id: ORPHAN_FEED_SCOPE,
      label: `Non rattachés${counts ? ` · ${orphan}` : ""}`,
    });
  }
  return result;
}
