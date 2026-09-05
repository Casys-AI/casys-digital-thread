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
  /** The unique recorded parent inside this hull, when one exists. */
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
  /** Project dependencies are presentation joins, never recorded Thread edges. */
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

/**
 * Project recorded facts and open activities into the whiteboard. Exact
 * producer identities form semantic hulls; recorded structure supplies their
 * optional folder tree. Geometry remains the layout module's responsibility.
 */
export function buildOverviewThreadHero(
  thread: ThreadWorkbenchSnapshot,
  activities: readonly ProjectPathActivityView[] = [],
): OverviewThreadHeroView {
  const artifactsById = new Map(
    thread.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const activityEvidenceLanes = overviewActivityEvidenceLanes(
    activities,
    thread,
  );
  const redundantUsages = redundantTypedUsageKeys(
    thread.graph.nodes,
    thread.graph.edges,
  );
  const visibleNodes = thread.graph.nodes.filter((node) =>
    !redundantUsages.has(refKey(node.ref))
  );

  const placed: OverviewHeroNode[] = [];
  for (const node of visibleNodes) {
    const key = refKey(node.ref);
    const lane = activityEvidenceLanes.get(key) ?? overviewLaneFor(node);
    if (!lane) continue;
    const column = OVERVIEW_LANES.find((item) => item.id === lane)!;
    placed.push({
      kind: "recorded",
      key,
      groupKey: overviewGroupKeyFor(
        node,
        node.ref.kind === "artifact"
          ? artifactsById.get(node.ref.id)
          : undefined,
      ),
      label: node.label,
      node,
      lane,
      color: column.color,
      emphasis: node.freshness === "failed" || node.freshness === "stale",
    });
  }

  for (const activity of activities) {
    if (activity.status === "completed") continue;
    placed.push({
      kind: "activity",
      key: `project-activity:${activity.id}`,
      groupKey: "project-activity",
      label: activity.title,
      activity,
      lane: activity.lane,
    });
  }

  const containment = hullContainmentParents(
    placed.filter(isRecordedOverviewHeroNode),
    thread.graph.edges,
    redundantUsages,
  );
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

  const edges: OverviewHeroEdge[] = [...edgeBundles.entries()].map(
    ([key, bundle]) => ({
      key,
      fromKey: bundle.from.key,
      toKey: bundle.to.key,
      kind: "thread-path",
      emphasis: bundle.emphasis,
      pathCount: bundle.pathKeys.length,
      pathKeys: [...bundle.pathKeys].sort(),
    }),
  );
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
  if (/cad|step|geometry|glb/.test(artifactKind)) return "geometry";
  if (artifactKind === "solver-result") return "physics";
  return undefined;
}

/** Exact recorded producer identity decides semantic hull membership. */
export function overviewGroupKeyFor(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
): string {
  if (artifact?.id === node.ref.id) {
    const operation = artifact.producer?.tool ?? artifact.producedBy;
    const semanticGroup = operation
      ? OVERVIEW_GROUP_BY_EXACT_PRODUCER.get(operation)
      : undefined;
    if (semanticGroup) return semanticGroup;
  }
  return node.system || "unassigned";
}

/** Presentation-only caption for a recorded group identity. */
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
  if (
    normalized === OVERVIEW_SEMANTIC_GROUP_KEYS.canonicalGeometry ||
    normalized === "canonical-geometry"
  ) {
    return "Canonical geometry";
  }
  if (
    normalized === OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity ||
    normalized === "assembly-integrity"
  ) {
    return lane === "verdicts"
      ? "Assembly integrity verdict"
      : "Assembly integrity";
  }
  if (
    normalized === OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics ||
    normalized === "prescribed-kinematics"
  ) {
    return lane === "verdicts"
      ? "Prescribed kinematics verdict"
      : "Prescribed kinematics";
  }
  if (normalized.toLowerCase() === "syson") return "SysON model";
  const leaf = normalized.split(/[/:]/).filter(Boolean).at(-1) ?? normalized;
  return leaf.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function overviewActivityEvidenceLanes(
  activities: readonly ProjectPathActivityView[],
  thread: ThreadWorkbenchSnapshot,
): ReadonlyMap<string, OverviewLaneId> {
  const lanes = new Map<string, OverviewLaneId>();
  const conflicting = new Set<string>();
  for (const activity of activities) {
    for (const ref of activity.evidenceRefs) {
      if (!isAddressableInThread(ref, thread)) continue;
      const key = refKey(ref);
      if (conflicting.has(key)) continue;
      const existing = lanes.get(key);
      if (existing !== undefined && existing !== activity.lane) {
        lanes.delete(key);
        conflicting.add(key);
      } else if (existing === undefined) {
        lanes.set(key, activity.lane);
      }
    }
  }
  return lanes;
}

function uniqueSystems(values: readonly string[]): readonly string[] {
  const systems: string[] = [];
  for (const value of values) {
    if (value && !systems.includes(value)) systems.push(value);
  }
  return systems;
}

const HULL_PARENT_RELATIONS = new Set([
  "contains",
  "declared-dependency",
  "derived_from",
]);

/** Move relations from a collapsed usage to the definition that absorbed it. */
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

/** File a leaf only when one acyclic parent claims it inside the same hull. */
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

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
