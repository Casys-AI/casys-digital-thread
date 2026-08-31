import type {
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import { OVERVIEW_LANES, type OverviewLane } from "./overview-lanes.ts";
import { condenseEdgesThroughHiddenNodes } from "./overview-condensed-edges.ts";
import type { ProjectPathActivityView } from "./model.ts";

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
 * Recorded nodes, wrapped in the same five lanes as the Project
 * Path. Non-completed project activities append as Overview-only leaves in
 * their projected lane. This function owns projection and identity only;
 * deterministic D3 geometry is calculated by the dedicated layout module.
 */
export function buildOverviewThreadHero(
  thread: ThreadWorkbenchSnapshot,
  activities: readonly ProjectPathActivityView[] = [],
): OverviewThreadHeroView {
  const placed: OverviewHeroNode[] = [];
  for (const node of thread.graph.nodes) {
    const lane = overviewLaneFor(node);
    if (!lane) continue;
    const column = OVERVIEW_LANES.find((item) => item.id === lane)!;
    placed.push({
      kind: "recorded",
      key: refKey(node.ref),
      groupKey: node.system || "unassigned",
      label: node.label,
      node,
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

  const recorded = placed.filter(isRecordedOverviewHeroNode);
  const byKey = new Map(recorded.map((item) => [item.key, item]));
  const condensed = condenseEdgesThroughHiddenNodes(
    new Set(recorded.map((item) => item.key)),
    thread.graph.edges,
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
  const edges = [...edgeBundles.entries()]
    .map(([key, bundle]) => ({
      key,
      fromKey: bundle.from.key,
      toKey: bundle.to.key,
      emphasis: bundle.emphasis,
      pathCount: bundle.pathKeys.length,
      pathKeys: [...bundle.pathKeys].sort(),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  return {
    lanes: OVERVIEW_LANES.map((lane) => ({
      lane,
      systems: uniqueSystems(
        recorded.filter((item) => item.lane === lane.id).map((item) =>
          item.node.system
        ),
      ),
    })),
    nodes: placed,
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

export function isRecordedOverviewHeroNode(
  item: OverviewHeroNode,
): item is OverviewRecordedHeroNode {
  return item.kind === "recorded";
}

export function overviewLaneFor(
  node: ThreadGraphNode,
): OverviewLaneId | undefined {
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

function uniqueSystems(values: readonly string[]): readonly string[] {
  const systems: string[] = [];
  for (const value of values) {
    if (value && !systems.includes(value)) systems.push(value);
  }
  return systems;
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
