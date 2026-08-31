import { applyEssentialFilter } from "../thread/essential-graph-filter.ts";
import type {
  ThreadArtifact,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import { OVERVIEW_LANES, type OverviewLane } from "./overview-lanes.ts";
import { condenseEdgesThroughHiddenNodes } from "./overview-condensed-edges.ts";
import { redundantTypedUsageKeys } from "./overview-typed-facets.ts";
import type { ProjectPathActivityView } from "./model.ts";

export type OverviewLaneId = EngineeringPathLaneId;
export { OVERVIEW_LANES } from "./overview-lanes.ts";

export const OVERVIEW_SEMANTIC_GROUP_KEYS = {
  canonicalGeometry: "family:canonical-geometry",
  assemblyIntegrity: "family:assembly-integrity",
  prescribedKinematics: "family:prescribed-kinematics",
} as const;

const OVERVIEW_GROUP_BY_EXACT_PRODUCER = new Map<string, string>([
  ["design.write-geometry@1", OVERVIEW_SEMANTIC_GROUP_KEYS.canonicalGeometry],
  [
    "geometry.module.immediate-compound@1.0",
    OVERVIEW_SEMANTIC_GROUP_KEYS.canonicalGeometry,
  ],
  [
    "verify.observe-assembly-integrity@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "verify.evaluate-assembly-integrity@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "decide.accept-assembly-integrity-evaluation@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "decide.reject-assembly-integrity-evaluation@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "verify.seal-prescribed-kinematics-case@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics,
  ],
  [
    "verify.run-prescribed-kinematics@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics,
  ],
  [
    "verify.seal-prescribed-kinematics-method@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics,
  ],
  [
    "verify.evaluate-prescribed-kinematics@1",
    OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics,
  ],
]);

interface OverviewHeroIdentity {
  readonly key: string;
  readonly lane: OverviewLaneId;
  readonly groupKey: string;
  readonly label: string;
}

export interface OverviewRecordedHeroNode extends OverviewHeroIdentity {
  readonly kind: "recorded";
  readonly node: ThreadGraphNode;
  readonly color: string;
  readonly emphasis: boolean;
  /**
   * The leaf that declares it contained, when exactly one does and both sit in
   * the same hull. Containment is the only relation that makes a folder tree:
   * a leaf pulled in by several relations is listed flat rather than filed
   * under an arbitrary one of them.
   */
  readonly parentKey?: string;
}

export interface OverviewActivityHeroNode extends OverviewHeroIdentity {
  readonly kind: "activity";
  readonly activity: ProjectPathActivityView;
}

export type OverviewHeroNode =
  | OverviewRecordedHeroNode
  | OverviewActivityHeroNode;

export interface OverviewHeroEdge {
  readonly key: string;
  readonly fromKey: string;
  readonly toKey: string;
  /**
   * `project-dependency` is a presentation join from exact project work-item
   * references. It is deliberately not a recorded Thread graph edge.
   */
  readonly kind: "thread-path" | "project-dependency";
  readonly emphasis: boolean;
  readonly pathCount: number;
  readonly pathKeys: readonly string[];
}

export interface OverviewLaneColumn {
  readonly lane: OverviewLane;
  readonly systems: readonly string[];
}

export interface OverviewThreadHeroView {
  readonly lanes: readonly OverviewLaneColumn[];
  readonly nodes: readonly OverviewHeroNode[];
  readonly edges: readonly OverviewHeroEdge[];
  readonly projectedPathCount: number;
}

interface OverviewAssemblyIntegrityPromotion {
  readonly recordId: string;
  readonly lane: "physics" | "verdicts";
  readonly summary: string;
}

/**
 * Essential recorded nodes, wrapped in the same five lanes as the Project
 * Path. Non-completed project activities append as Overview-only leaves in
 * their projected lane. This function owns projection and identity only;
 * deterministic D3 geometry is calculated by the dedicated layout module.
 */
export function buildOverviewThreadHero(
  thread: ThreadWorkbenchSnapshot,
  activities: readonly ProjectPathActivityView[] = [],
): OverviewThreadHeroView {
  const essential = applyEssentialFilter(
    thread.graph.nodes,
    thread.graph.edges,
  );
  const artifactsById = new Map(
    thread.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const placed: OverviewHeroNode[] = [];
  const assemblyIntegrityPromotions = new Map(
    overviewAssemblyIntegrityPromotions(thread).map((promotion) => [
      refKey({ kind: "artifact", id: promotion.recordId }),
      promotion,
    ]),
  );
  const activityEvidenceLanes = new Map<string, OverviewLaneId>();
  const conflictingActivityEvidenceKeys = new Set<string>();
  for (const activity of activities) {
    for (const ref of activity.evidenceRefs) {
      if (!isAddressableInThread(ref, thread)) continue;
      const key = refKey(ref);
      if (conflictingActivityEvidenceKeys.has(key)) continue;
      const existingLane = activityEvidenceLanes.get(key);
      if (existingLane !== undefined && existingLane !== activity.lane) {
        activityEvidenceLanes.delete(key);
        conflictingActivityEvidenceKeys.add(key);
      } else if (existingLane === undefined) {
        activityEvidenceLanes.set(key, activity.lane);
      }
    }
  }
  // A part usage and its sole definition are one object: keep the definition,
  // which is the facet the attributes and containment relations already name.
  // The usage's own relations are re-routed by the hidden-node condensation.
  const redundantUsages = redundantTypedUsageKeys(
    essential.nodes,
    thread.graph.edges,
  );
  const visibleNodes = essential.nodes.filter((node) =>
    !redundantUsages.has(refKey(node.ref))
  );
  for (const node of thread.graph.nodes) {
    const key = refKey(node.ref);
    if (
      (assemblyIntegrityPromotions.has(key) ||
        activityEvidenceLanes.has(key)) &&
      !visibleNodes.some((candidate) => refKey(candidate.ref) === key)
    ) {
      visibleNodes.push(node);
    }
  }

  for (const node of visibleNodes) {
    const promotion = assemblyIntegrityPromotions.get(refKey(node.ref));
    const lane = promotion?.lane ??
      activityEvidenceLanes.get(refKey(node.ref)) ?? overviewLaneFor(node);
    if (!lane) continue;
    const column = OVERVIEW_LANES.find((item) => item.id === lane)!;
    placed.push({
      kind: "recorded",
      key: refKey(node.ref),
      groupKey: overviewGroupKeyFor(
        node,
        node.ref.kind === "artifact"
          ? artifactsById.get(node.ref.id)
          : undefined,
      ),
      label: node.label,
      node: promotion ? { ...node, summary: promotion.summary } : node,
      lane,
      color: column.color,
      emphasis: node.freshness === "failed" || node.freshness === "stale",
    });
  }

  for (const activity of activities) {
    if (activity.status === "completed") continue;
    const lane = activity.lane;
    placed.push({
      kind: "activity",
      key: `project-activity:${activity.id}`,
      groupKey: "project-activity",
      label: activity.title,
      activity,
      lane,
    });
  }

  const containment = hullContainmentParents(
    placed.filter(isRecordedOverviewHeroNode),
    thread.graph.edges,
    redundantUsages,
  );
  // Containment is part of what a leaf is on the board, so it travels with
  // the placed node rather than staying in a side table.
  const filed: OverviewHeroNode[] = placed.map((item) => {
    if (item.kind !== "recorded") return item;
    const parentKey = containment.get(item.key);
    return parentKey ? { ...item, parentKey } : item;
  });
  const recorded = filed.filter(isRecordedOverviewHeroNode);
  const byKey = new Map(recorded.map((item) => [item.key, item]));
  const condensed = condenseEdgesThroughHiddenNodes(
    new Set(recorded.map((item) => item.key)),
    absorbedEdges(thread.graph.edges, redundantUsages),
  );
  const edgeBundles = new Map<
    string,
    {
      readonly from: OverviewRecordedHeroNode;
      readonly to: OverviewRecordedHeroNode;
      readonly pathKeys: string[];
      emphasis: boolean;
    }
  >();
  for (const edge of condensed) {
    const from = byKey.get(refKey(edge.from));
    const to = byKey.get(refKey(edge.to));
    if (!from || !to) continue;
    const bundleKey = `${from.key}>${to.key}`;
    const existing = edgeBundles.get(bundleKey);
    if (existing) {
      existing.pathKeys.push(edge.key);
      existing.emphasis ||= from.emphasis || to.emphasis;
      continue;
    }
    edgeBundles.set(bundleKey, {
      from,
      to,
      pathKeys: [edge.key],
      emphasis: from.emphasis || to.emphasis,
    });
  }
  const edges: OverviewHeroEdge[] = [...edgeBundles.entries()]
    .map(([key, bundle]) => ({
      key,
      fromKey: bundle.from.key,
      toKey: bundle.to.key,
      kind: "thread-path",
      emphasis: bundle.emphasis,
      pathCount: bundle.pathKeys.length,
      pathKeys: [...bundle.pathKeys].sort(),
    }));
  for (const activity of activities) {
    if (activity.status === "completed") continue;
    const activityKey = `project-activity:${activity.id}`;
    const dependencyPathsByNode = new Map<string, string[]>();
    for (const ref of activity.dependencyEvidenceRefs) {
      if (!isAddressableInThread(ref, thread)) continue;
      const dependencyKey = refKey(ref);
      if (!byKey.has(dependencyKey)) continue;
      const pathKey = `project-dependency:${
        exactEvidenceRefKey(ref)
      }>${activityKey}`;
      const paths = dependencyPathsByNode.get(dependencyKey);
      if (paths) paths.push(pathKey);
      else dependencyPathsByNode.set(dependencyKey, [pathKey]);
    }
    for (const [dependencyKey, pathKeys] of dependencyPathsByNode) {
      edges.push({
        key: `${dependencyKey}>${activityKey}#project-dependency`,
        fromKey: dependencyKey,
        toKey: activityKey,
        kind: "project-dependency",
        emphasis: activity.status === "blocked",
        pathCount: pathKeys.length,
        pathKeys: pathKeys.toSorted(),
      });
    }
  }
  edges.sort((left, right) => left.key.localeCompare(right.key));

  return {
    lanes: OVERVIEW_LANES.map((lane) => ({
      lane,
      systems: uniqueSystems(
        recorded.filter((item) => item.lane === lane.id).map((item) =>
          item.node.system
        ),
      ),
    })),
    nodes: filed,
    edges,
    projectedPathCount: condensed.length,
  };
}

/**
 * Overview exposes one cable per visible endpoint pair. Multiple projected
 * paths may travel through different hidden records between the same
 * endpoints; those paths remain counted in `pathKeys` instead of being drawn
 * repeatedly on top of one another. The D3 layout supplies the actual bundled
 * geometry. These are projection paths, not a claim that Overview preserves
 * every underlying edge occurrence or relation.
 */

/**
 * The dedicated assembly-integrity index supplies the semantic level that its
 * supporting graph artifacts deliberately do not carry. Overview promotes the
 * exact recorded L3/L4 artifact nodes into their lanes; L5 remains a human gate
 * closeout and is intentionally not projected as a verdict.
 */
function overviewAssemblyIntegrityPromotions(
  thread: ThreadWorkbenchSnapshot,
): readonly OverviewAssemblyIntegrityPromotion[] {
  const chains = thread.assemblyIntegrity?.chains ?? [];
  const observationChain = chains.find((chain) => chain.status === "current") ??
    chains[0];
  const evaluationChain =
    chains.find((chain) =>
      chain.status === "current" && chain.evaluation !== undefined
    ) ?? chains.find((chain) => chain.evaluation !== undefined);
  const promotions: OverviewAssemblyIntegrityPromotion[] = [];
  if (observationChain) {
    promotions.push({
      recordId: observationChain.observation.record.id,
      lane: "physics",
      summary: `Recorded L3 observation · ${observationChain.status}`,
    });
  }
  if (evaluationChain?.evaluation) {
    promotions.push({
      recordId: evaluationChain.evaluation.record.id,
      lane: "verdicts",
      summary:
        `Recorded L4 ${evaluationChain.evaluation.aggregateVerdict} · ${evaluationChain.status}`,
    });
  }
  return promotions;
}

export function isRecordedOverviewHeroNode(
  item: OverviewHeroNode,
): item is OverviewRecordedHeroNode {
  return item.kind === "recorded";
}

export function overviewLaneFor(
  node: ThreadGraphNode,
): OverviewLaneId | undefined {
  if (
    node.entityKind === "analysis-node" && node.system === "brief" &&
    node.analysis?.semanticRef.domain === "brief" &&
    node.analysis.semanticRef.kind === "brief-item"
  ) {
    return "requirements";
  }
  if (node.entityKind === "requirement") return "requirements";
  if (
    node.entityKind === "part-definition" ||
    node.entityKind === "part-usage" ||
    node.entityKind === "attribute-usage"
  ) {
    return "system-model";
  }
  if (node.entityKind === "observation") return "physics";
  if (node.entityKind === "evaluation" || node.entityKind === "violation") {
    return "verdicts";
  }
  if (node.entityKind !== "artifact") return undefined;
  const artifactKind = node.artifactKind?.toLowerCase() ?? "";
  if (artifactKind === "sysml-model" || artifactKind.includes("sysml")) {
    return "system-model";
  }
  if (/cad|step|geometry|glb/.test(artifactKind)) {
    return "geometry";
  }
  return undefined;
}

/**
 * Hull identity describes the recorded engineering family, not the recorder.
 * Exact producer metadata is used when available; labels are deliberately
 * ignored so copy changes cannot regroup or move a persisted hull.
 */
export function overviewGroupKeyFor(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
): string {
  if (artifact?.id === node.ref.id && artifact.producedBy) {
    const semanticGroup = OVERVIEW_GROUP_BY_EXACT_PRODUCER.get(
      artifact.producedBy,
    );
    if (semanticGroup) return semanticGroup;
  }
  return node.system || "unassigned";
}

export function overviewGroupCaption(
  groupKey: string,
  lane?: OverviewLaneId,
): string {
  const normalized = groupKey.trim();
  if (
    !normalized || normalized === "__ungrouped__" ||
    normalized === "unassigned"
  ) {
    return "Recorded items";
  }
  if (normalized === "project-activity") return "Current activity";
  if (normalized === OVERVIEW_SEMANTIC_GROUP_KEYS.canonicalGeometry) {
    return "Canonical geometry";
  }
  if (normalized === OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity) {
    return lane === "verdicts"
      ? "Assembly integrity verdict"
      : "Assembly integrity";
  }
  if (normalized === OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics) {
    return lane === "verdicts"
      ? "Prescribed kinematics verdict"
      : "Prescribed kinematics";
  }
  if (normalized.toLowerCase() === "syson") return "SysON model";
  const leaf = normalized.split(/[/:]/).filter(Boolean).at(-1) ?? normalized;
  return leaf.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueSystems(values: readonly string[]): readonly string[] {
  const systems: string[] = [];
  for (const value of values) {
    if (value && !systems.includes(value)) systems.push(value);
  }
  return systems;
}

/**
 * Relations that state a leaf's place under another one, and so can file a
 * hull as a folder. Each is a declaration by the record itself — an assembly
 * holding a part, a brief item depending on another, an artifact derived from
 * its source. Everything else (uses, input_to, traces_to) is traffic between
 * peers and never nests them.
 */
const HULL_PARENT_RELATIONS = new Set([
  "contains",
  "declared-dependency",
  "derived_from",
]);

/**
 * Declared parent of each leaf, within its own hull.
 *
 * Only relations that nest count, and only inside one hull: a folder states
 * what holds what. A leaf claimed by two parents has no single place in a
 * tree, so it gets none and stays flat — the hull reports what it records
 * rather than picking a side.
 */
/**
 * Rewrite both ends of every edge onto the leaf that absorbed them.
 *
 * A usage folded into its definition keeps its relations: they are the same
 * facts, stated about the facet that remains. Rewriting them here — rather
 * than trusting the hidden-node walk, which only follows edges *out of*
 * visible nodes — is what stops an edge leaving an absorbed usage from
 * disappearing. An edge that becomes a self-loop said nothing but the
 * absorption itself, and is dropped.
 */
function absorbedEdges(
  edges: readonly ThreadGraphEdge[],
  absorbed: ReadonlyMap<string, string>,
): readonly ThreadGraphEdge[] {
  if (absorbed.size === 0) return edges;
  const moved = (ref: ThreadGraphRef): ThreadGraphRef => {
    const target = absorbed.get(refKey(ref));
    if (!target) return ref;
    const [kind, ...rest] = target.split(":");
    return { kind: kind as ThreadGraphRef["kind"], id: rest.join(":") };
  };
  return edges.flatMap((edge) => {
    const from = moved(edge.from);
    const to = moved(edge.to);
    if (refKey(from) === refKey(to)) return [];
    return [{ ...edge, from, to }];
  });
}

function hullContainmentParents(
  nodes: readonly OverviewRecordedHeroNode[],
  edges: readonly ThreadGraphEdge[],
  absorbed: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const hullOf = new Map(
    nodes.map((node) => [node.key, `${node.lane}/${node.groupKey}`]),
  );
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if (!HULL_PARENT_RELATIONS.has(edge.relation)) continue;
    // A usage folded into its definition carries its containment over: the
    // part is still held by the assembly, it is simply named by its type now.
    const from = absorbed.get(refKey(edge.from)) ?? refKey(edge.from);
    const to = absorbed.get(refKey(edge.to)) ?? refKey(edge.to);
    const hull = hullOf.get(from);
    if (!hull || hull !== hullOf.get(to) || from === to) continue;
    parents.set(to, [...(parents.get(to) ?? []), from]);
  }
  const single = new Map<string, string>();
  for (const [child, own] of parents) {
    const distinct = [...new Set(own)];
    if (distinct.length === 1) single.set(child, distinct[0]!);
  }
  // A cycle is not a tree either. Every leaf on the loop is disqualified, not
  // just the one whose walk happened to find it: leaving the rest filed would
  // state a nesting that only holds because the others were removed.
  const cyclic = new Set<string>();
  for (const [child] of single) {
    const path: string[] = [child];
    const seen = new Set<string>([child]);
    let cursor = single.get(child);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        for (const key of path.slice(path.indexOf(cursor))) cyclic.add(key);
        cyclic.add(cursor);
        break;
      }
      seen.add(cursor);
      path.push(cursor);
      cursor = single.get(cursor);
    }
  }
  for (const key of cyclic) single.delete(key);
  return single;
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

function exactEvidenceRefKey(
  ref: ProjectPathActivityView["dependencyEvidenceRefs"][number],
): string {
  return `${ref.snapshotId}@${ref.snapshotRevision}:${ref.kind}:${ref.id}`;
}

function isAddressableInThread(
  ref: ProjectPathActivityView["evidenceRefs"][number],
  thread: ThreadWorkbenchSnapshot,
): boolean {
  return ref.snapshotId === thread.id &&
    ref.snapshotRevision <= thread.evidenceFamilyGraph.asOf.revision;
}
