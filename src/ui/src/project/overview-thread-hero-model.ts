import { applyEssentialFilter } from "../thread/essential-graph-filter.ts";
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

export const OVERVIEW_HERO_WIDTH = 1230;
export const OVERVIEW_HERO_HEIGHT = 300;

interface OverviewHeroPlacement {
  readonly key: string;
  readonly lane: OverviewLaneId;
  readonly x: number;
  readonly y: number;
}

export interface OverviewRecordedHeroNode extends OverviewHeroPlacement {
  readonly kind: "recorded";
  readonly node: ThreadGraphNode;
  readonly color: string;
  readonly emphasis: boolean;
}

export interface OverviewActivityHeroNode extends OverviewHeroPlacement {
  readonly kind: "activity";
  readonly activity: ProjectPathActivityView;
}

export type OverviewHeroNode =
  | OverviewRecordedHeroNode
  | OverviewActivityHeroNode;

export interface OverviewHeroEdge {
  readonly key: string;
  readonly d: string;
  readonly emphasis: boolean;
}

export interface OverviewLaneColumn {
  readonly lane: OverviewLane;
  readonly systems: readonly string[];
}

export interface OverviewThreadHeroView {
  readonly lanes: readonly OverviewLaneColumn[];
  readonly nodes: readonly OverviewHeroNode[];
  readonly edges: readonly OverviewHeroEdge[];
  readonly height: number;
}

interface OverviewAssemblyIntegrityPromotion {
  readonly recordId: string;
  readonly lane: "physics" | "verdicts";
  readonly summary: string;
}

const COLUMN_WIDTH = OVERVIEW_HERO_WIDTH / OVERVIEW_LANES.length;
const TRACKS_PER_LANE = 2;
const NODE_TOP = 56;
const NODE_GAP = 60;
const NODE_BOTTOM = 44;

/**
 * Essential recorded nodes, wrapped in the same five lanes as the Project
 * Path. Non-completed project activities append as Overview-only markers in
 * their projected lane. Every semantic point is retained; the two-track
 * layout grows only as high as its busiest lane instead of silently
 * truncating after four nodes.
 */
export function buildOverviewThreadHero(
  thread: ThreadWorkbenchSnapshot,
  activities: readonly ProjectPathActivityView[] = [],
): OverviewThreadHeroView {
  const essential = applyEssentialFilter(
    thread.graph.nodes,
    thread.graph.edges,
  );
  const placed: OverviewHeroNode[] = [];
  const assemblyIntegrityPromotions = new Map(
    overviewAssemblyIntegrityPromotions(thread).map((promotion) => [
      refKey({ kind: "artifact", id: promotion.recordId }),
      promotion,
    ]),
  );
  const counts: Record<OverviewLaneId, number> = {
    requirements: 0,
    "system-model": 0,
    geometry: 0,
    physics: 0,
    verdicts: 0,
  };

  const visibleNodes = [...essential.nodes];
  for (const node of thread.graph.nodes) {
    const key = refKey(node.ref);
    if (
      assemblyIntegrityPromotions.has(key) &&
      !visibleNodes.some((candidate) => refKey(candidate.ref) === key)
    ) {
      visibleNodes.push(node);
    }
  }

  for (const node of visibleNodes) {
    const promotion = assemblyIntegrityPromotions.get(refKey(node.ref));
    const lane = promotion?.lane ?? overviewLaneFor(node);
    if (!lane) continue;
    const index = counts[lane];
    counts[lane] = index + 1;
    const column = OVERVIEW_LANES.find((item) => item.id === lane)!;
    placed.push({
      kind: "recorded",
      key: refKey(node.ref),
      node: promotion ? { ...node, summary: promotion.summary } : node,
      lane,
      x: wrappedNodeX(lane, index),
      y: NODE_TOP + Math.floor(index / TRACKS_PER_LANE) * NODE_GAP,
      color: column.color,
      emphasis: node.freshness === "failed" || node.freshness === "stale",
    });
  }

  for (const activity of activities) {
    if (activity.status === "completed") continue;
    const lane = activity.lane;
    const index = counts[lane];
    counts[lane] = index + 1;
    placed.push({
      kind: "activity",
      key: `project-activity:${activity.id}`,
      activity,
      lane,
      x: wrappedNodeX(lane, index),
      y: NODE_TOP + Math.floor(index / TRACKS_PER_LANE) * NODE_GAP,
    });
  }

  const rowCount = Math.max(
    1,
    ...Object.values(counts).map((count) => Math.ceil(count / TRACKS_PER_LANE)),
  );
  const height = Math.max(
    OVERVIEW_HERO_HEIGHT,
    NODE_TOP + (rowCount - 1) * NODE_GAP + NODE_BOTTOM,
  );

  const recorded = placed.filter(isRecordedOverviewHeroNode);
  const byKey = new Map(recorded.map((item) => [item.key, item]));
  const condensed = condenseEdgesThroughHiddenNodes(
    new Set(recorded.map((item) => item.key)),
    thread.graph.edges,
  );
  const edges: OverviewHeroEdge[] = [];
  for (const edge of condensed) {
    const from = byKey.get(refKey(edge.from));
    const to = byKey.get(refKey(edge.to));
    if (!from || !to) continue;
    const midX = (from.x + to.x) / 2;
    edges.push({
      key: edge.key,
      d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`,
      emphasis: from.emphasis || to.emphasis,
    });
  }

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
    height,
  };
}

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
  if (node.entityKind === "requirement") return "requirements";
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

function wrappedNodeX(lane: OverviewLaneId, index: number): number {
  const laneIndex = OVERVIEW_LANES.findIndex((item) => item.id === lane);
  const track = index % TRACKS_PER_LANE;
  return laneIndex * COLUMN_WIDTH +
    COLUMN_WIDTH * (track === 0 ? 0.27 : 0.73);
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
