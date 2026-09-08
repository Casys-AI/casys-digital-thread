import type {
  EngineeringWorkbenchRequirementsBriefTrace,
  ThreadArtifact,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadObservation,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import { OVERVIEW_LANES, type OverviewLane } from "./overview-lanes.ts";
import { condenseEdgesThroughHiddenNodes } from "./overview-condensed-edges.ts";
import { redundantTypedUsageKeys } from "./overview-typed-facets.ts";
import type { ProjectPathActivityView } from "./model.ts";
import {
  buildOverviewBriefCorrespondences,
  isRequirementsBriefClaimArtifact,
  type OverviewBriefSourceHeroNode,
} from "./overview-thread-brief-correspondence.ts";
import {
  isOverviewBriefRecord,
  isOverviewRequirementsCapture,
  overviewDisambiguatedRecordLabel,
  overviewDomainGroupCaption,
  overviewDomainGroupColor,
  overviewDomainGroupKeyFor,
  overviewRecordProvenanceQualifier,
} from "./overview/hulls/domain-groups.ts";
export type {
  OverviewBriefSourceHeroNode,
  OverviewBriefTrace,
} from "./overview-thread-brief-correspondence.ts";
export {
  OVERVIEW_DOMAIN_GROUP_KEYS,
  OVERVIEW_SEMANTIC_GROUP_KEYS,
} from "./overview/hulls/domain-groups.ts";

export type OverviewLaneId = EngineeringPathLaneId;
export { OVERVIEW_LANES } from "./overview-lanes.ts";

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
  /**
   * Exact requirements-capture identity for viewer aliases.
   * Display group and labels never authorize this.
   */
  readonly isRequirementsCapture?: boolean;
  /**
   * Restrained overlay from an exact active/blocked Project activity.
   * Planned/completed never set this. Missing or conflicting relations omit it.
   */
  readonly activityStatus?: "active" | "blocked";
}

export interface OverviewActivityHeroNode extends OverviewHeroIdentity {
  readonly kind: "activity";
  readonly activity: ProjectPathActivityView;
}

export type OverviewHeroNode =
  | OverviewRecordedHeroNode
  | OverviewActivityHeroNode
  | OverviewBriefSourceHeroNode;

export interface OverviewHeroEdge {
  readonly key: string;
  readonly fromKey: string;
  readonly toKey: string;
  /** Dependency and brief-correspondence joins are not recorded Thread edges. */
  readonly kind: "thread-path" | "project-dependency" | "brief-correspondence";
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
 * operations and typed kinds form domain hulls; recorded structure supplies
 * their optional folder tree. Geometry remains the layout module's
 * responsibility.
 */
export function buildOverviewThreadHero(
  thread: ThreadWorkbenchSnapshot,
  activities: readonly ProjectPathActivityView[] = [],
  requirementsBriefTraces:
    readonly EngineeringWorkbenchRequirementsBriefTrace[] = [],
): OverviewThreadHeroView {
  const artifactsById = new Map(
    thread.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const observationsById = new Map(
    thread.observations.map((observation) => [observation.id, observation]),
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
    !redundantUsages.has(refKey(node.ref)) &&
    !(node.ref.kind === "artifact" &&
      isRequirementsBriefClaimArtifact(artifactsById.get(node.ref.id)))
  );

  const placed: OverviewHeroNode[] = [];
  const provenanceByKey = new Map<string, string>();
  for (const node of visibleNodes) {
    const key = refKey(node.ref);
    const artifact = node.ref.kind === "artifact"
      ? artifactsById.get(node.ref.id)
      : undefined;
    const observation = node.ref.kind === "observation"
      ? observationsById.get(node.ref.id)
      : undefined;
    const sourceArtifact = observation
      ? artifactsById.get(observation.sourceArtifactId)
      : uniqueEvidencingArtifact(node, thread.graph.edges, artifactsById);
    // Typed SysML/requirements keep their structural lane. Activity evidence
    // only places records that otherwise have no typed lane.
    const lane = overviewLaneFor(node, artifact) ??
      activityEvidenceLanes.get(key);
    if (!lane) continue;
    const column = OVERVIEW_LANES.find((item) => item.id === lane)!;
    const groupKey = overviewGroupKeyFor(node, artifact, {
      observation,
      sourceArtifact,
    });
    const qualifier = overviewRecordProvenanceQualifier({
      artifact,
      sourceArtifact,
      engineeringCaseRefs: node.engineeringCaseRefs,
    });
    if (qualifier) provenanceByKey.set(key, qualifier);
    placed.push({
      kind: "recorded",
      key,
      groupKey,
      label: node.label,
      node,
      lane,
      color: overviewDomainGroupColor(groupKey, column.color),
      emphasis: node.freshness === "failed" || node.freshness === "stale",
      ...(isOverviewRequirementsCapture(node, artifact)
        ? { isRequirementsCapture: true }
        : {}),
    });
  }
  disambiguateDuplicateRecordLabels(placed, provenanceByKey);
  overlayExactActivityStatus(
    placed,
    activities,
    thread,
  );

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
  const briefCorrespondences = buildOverviewBriefCorrespondences(
    thread,
    requirementsBriefTraces,
    new Set(recorded.map((item) => item.key)),
  );
  filed.push(...briefCorrespondences.nodes);
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
  edges.push(...briefCorrespondences.edges);
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
    projectedPathCount: condensed.length + briefCorrespondences.edges.length,
  };
}

export function isRecordedOverviewHeroNode(
  item: OverviewHeroNode,
): item is OverviewRecordedHeroNode {
  return item.kind === "recorded";
}

export function overviewLaneFor(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
): OverviewLaneId | undefined {
  if (isOverviewBriefRecord(node, artifact)) return "requirements";
  if (
    node.entityKind === "part-definition" ||
    node.entityKind === "part-usage" ||
    node.entityKind === "attribute-usage" ||
    node.entityKind === "requirement"
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

/** Exact operations and typed kinds decide domain hull membership. */
export function overviewGroupKeyFor(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
  observationContext?: {
    readonly observation?: ThreadObservation;
    readonly sourceArtifact?: ThreadArtifact;
  },
): string {
  return overviewDomainGroupKeyFor({
    node,
    artifact,
    observation: observationContext?.observation,
    sourceArtifact: observationContext?.sourceArtifact,
  });
}

/** Presentation-only caption for a recorded group identity. */
export function overviewGroupCaption(
  groupKey: string,
  lane?: OverviewLaneId,
): string {
  return overviewDomainGroupCaption(groupKey, lane);
}

/**
 * Planned/completed stay off the engineering board. Active/blocked overlay the
 * unique exact evidence hull; missing or split relations omit fail-closed.
 */
function overlayExactActivityStatus(
  placed: OverviewHeroNode[],
  activities: readonly ProjectPathActivityView[],
  thread: ThreadWorkbenchSnapshot,
): void {
  const recorded = placed.filter(isRecordedOverviewHeroNode);
  const byKey = new Map(recorded.map((item) => [item.key, item]));
  const statusesByHull = new Map<string, Set<"active" | "blocked">>();
  for (const activity of activities) {
    if (activity.status !== "active" && activity.status !== "blocked") {
      continue;
    }
    const hulls = new Set<string>();
    for (const ref of activity.evidenceRefs) {
      if (!isAddressableInThread(ref, thread)) continue;
      const node = byKey.get(refKey(ref));
      if (!node) continue;
      hulls.add(`${node.lane}/${node.groupKey}`);
    }
    if (hulls.size !== 1) continue;
    const hull = [...hulls][0]!;
    const bucket = statusesByHull.get(hull) ?? new Set();
    bucket.add(activity.status);
    statusesByHull.set(hull, bucket);
  }
  const overlay = new Map<string, "active" | "blocked">();
  for (const [hull, statuses] of statusesByHull) {
    if (statuses.size === 1) overlay.set(hull, [...statuses][0]!);
  }
  if (overlay.size === 0) return;
  for (let index = 0; index < placed.length; index++) {
    const item = placed[index]!;
    if (item.kind !== "recorded") continue;
    const status = overlay.get(`${item.lane}/${item.groupKey}`);
    if (status) placed[index] = { ...item, activityStatus: status };
  }
}

function uniqueEvidencingArtifact(
  node: ThreadGraphNode,
  edges: readonly ThreadGraphEdge[],
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
): ThreadArtifact | undefined {
  if (node.entityKind !== "evaluation" && node.entityKind !== "violation") {
    return undefined;
  }
  const artifactIds: string[] = [];
  for (const edge of edges) {
    if (edge.relation !== "evidences") continue;
    if (edge.to.kind !== node.ref.kind || edge.to.id !== node.ref.id) continue;
    if (edge.from.kind !== "artifact") continue;
    artifactIds.push(edge.from.id);
  }
  if (artifactIds.length !== 1) return undefined;
  return artifactsById.get(artifactIds[0]!);
}

function disambiguateDuplicateRecordLabels(
  placed: OverviewHeroNode[],
  provenanceByKey: ReadonlyMap<string, string>,
): void {
  const collisions = new Map<string, string[]>();
  for (const item of placed) {
    if (item.kind !== "recorded") continue;
    const collisionKey = `${item.lane}/${item.groupKey}\0${item.label}`;
    const keys = collisions.get(collisionKey);
    if (keys) keys.push(item.key);
    else collisions.set(collisionKey, [item.key]);
  }
  const uniqueQualifierByKey = new Map<string, boolean>();
  for (const keys of collisions.values()) {
    if (keys.length < 2) continue;
    const qualifierCounts = new Map<string, number>();
    for (const key of keys) {
      const qualifier = provenanceByKey.get(key);
      if (!qualifier) continue;
      qualifierCounts.set(
        qualifier,
        (qualifierCounts.get(qualifier) ?? 0) + 1,
      );
    }
    for (const key of keys) {
      const qualifier = provenanceByKey.get(key);
      uniqueQualifierByKey.set(
        key,
        qualifier !== undefined && qualifierCounts.get(qualifier) === 1,
      );
    }
  }
  for (let index = 0; index < placed.length; index++) {
    const item = placed[index]!;
    if (item.kind !== "recorded") continue;
    const collisionKey = `${item.lane}/${item.groupKey}\0${item.label}`;
    const collisionCount = collisions.get(collisionKey)?.length ?? 1;
    const nextLabel = overviewDisambiguatedRecordLabel(
      item.label,
      provenanceByKey.get(item.key),
      collisionCount,
      uniqueQualifierByKey.get(item.key) === true,
    );
    if (nextLabel !== item.label) {
      placed[index] = { ...item, label: nextLabel };
    }
  }
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
