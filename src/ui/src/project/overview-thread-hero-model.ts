import { applyEssentialFilter } from "../thread/essential-graph-filter.ts";
import type {
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";

export type OverviewLaneId =
  | "requirements"
  | "system-model"
  | "geometry"
  | "physics"
  | "verdicts";

export interface OverviewLane {
  readonly id: OverviewLaneId;
  readonly title: string;
  readonly color: string;
}

/**
 * Voies d'affichage — composition seule, pas une seconde provenance.
 *
 * Le modèle système vient en premier parce que c'est lui qui DÉCLARE les
 * exigences : les placer avant lui obligeait quatorze arêtes à remonter le
 * fil, contre dix dans cet ordre (mesuré sur le graphe enregistré).
 */
export const OVERVIEW_LANES: readonly OverviewLane[] = [
  { id: "system-model", title: "System model", color: "#2563eb" },
  { id: "requirements", title: "Requirements", color: "#7c3aed" },
  { id: "geometry", title: "Geometry", color: "#0e7490" },
  { id: "physics", title: "Physics", color: "#a16207" },
  { id: "verdicts", title: "Verdicts", color: "#15803d" },
];

export const OVERVIEW_HERO_WIDTH = 1230;
export const OVERVIEW_HERO_HEIGHT = 300;

export interface OverviewHeroNode {
  readonly key: string;
  readonly node: ThreadGraphNode;
  readonly lane: OverviewLaneId;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly emphasis: boolean;
}

export interface OverviewHeroEdge {
  readonly key: string;
  readonly d: string;
  /** Clés des nœuds placés que cette arête relie, telles quelles. */
  readonly source: string;
  readonly target: string;
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
}

const COLUMN_WIDTH = OVERVIEW_HERO_WIDTH / OVERVIEW_LANES.length;
const MAX_PER_LANE = 4;
const NODE_TOP = 56;
// L'écart vertical laisse passer les liens entre deux cartes de 46 px de haut.
const NODE_GAP = 72;

/**
 * 2a hero: essential recorded nodes, stacked in the five mockup lanes.
 * Never invents a node, an edge, or a second organisation of the dossier.
 */
export function buildOverviewThreadHero(
  thread: ThreadWorkbenchSnapshot,
): OverviewThreadHeroView {
  const essential = applyEssentialFilter(
    thread.graph.nodes,
    thread.graph.edges,
  );
  const placed: OverviewHeroNode[] = [];
  const counts: Record<OverviewLaneId, number> = {
    requirements: 0,
    "system-model": 0,
    geometry: 0,
    physics: 0,
    verdicts: 0,
  };

  // Producteurs déclarés de chaque nœud, lus sur le graphe COMPLET : le
  // filtre essentiel écarte les artefacts de solveur, donc l'arête qui dit
  // d'où vient une mesure n'existe plus dans `essential`.
  const nodeByRefKey = new Map(
    thread.graph.nodes.map((item) => [refKey(item.ref), item]),
  );
  const producersByRefKey = new Map<string, ThreadGraphNode[]>();
  for (const edge of thread.graph.edges) {
    const producer = nodeByRefKey.get(refKey(edge.from));
    if (!producer) continue;
    const target = refKey(edge.to);
    const producers = producersByRefKey.get(target) ?? [];
    producers.push(producer);
    producersByRefKey.set(target, producers);
  }

  for (const node of essential.nodes) {
    const lane = node.entityKind === "observation"
      ? measurementLaneFor(node, producersByRefKey) ?? overviewLaneFor(node)
      : overviewLaneFor(node);
    if (!lane) continue;
    const index = counts[lane];
    if (index >= MAX_PER_LANE) continue;
    counts[lane] = index + 1;
    const column = OVERVIEW_LANES.find((item) => item.id === lane)!;
    placed.push({
      key: refKey(node.ref),
      node,
      lane,
      x: columnCenter(lane),
      y: NODE_TOP + index * NODE_GAP,
      color: column.color,
      emphasis: node.freshness === "failed" || node.freshness === "stale",
    });
  }

  const byKey = new Map(placed.map((item) => [item.key, item]));
  const edges: OverviewHeroEdge[] = [];
  for (const edge of essential.edges) {
    const from = byKey.get(refKey(edge.from));
    const to = byKey.get(refKey(edge.to));
    if (!from || !to) continue;
    const midX = (from.x + to.x) / 2;
    edges.push({
      key: edge.id,
      d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`,
      source: from.key,
      target: to.key,
      emphasis: from.emphasis || to.emphasis,
    });
  }

  return {
    lanes: OVERVIEW_LANES.map((lane) => ({
      lane,
      systems: uniqueSystems(
        placed.filter((item) => item.lane === lane.id).map((item) =>
          item.node.system
        ),
      ),
    })),
    nodes: placed,
    edges,
  };
}

/**
 * Voie d'une mesure, lue sur ses producteurs enregistrés.
 *
 * Une observation n'est pas un jugement : elle appartient à la discipline qui
 * l'a produite. `maxDisplacement measured by local CalculiX` déclare pourtant
 * `digital-thread` comme système, donc seule l'arête vers son `solver-result`
 * dit d'où elle vient. On lit le graphe, jamais le libellé.
 */
function measurementLaneFor(
  node: ThreadGraphNode,
  producersByRefKey: ReadonlyMap<string, readonly ThreadGraphNode[]>,
): OverviewLaneId | undefined {
  for (const producer of producersByRefKey.get(refKey(node.ref)) ?? []) {
    const lane = overviewLaneFor(producer);
    if (lane === "physics" || lane === "geometry") return lane;
  }
  return undefined;
}

export function overviewLaneFor(
  node: ThreadGraphNode,
): OverviewLaneId | undefined {
  if (node.entityKind === "requirement") return "requirements";
  if (
    node.entityKind === "observation" ||
    node.entityKind === "evaluation" ||
    node.entityKind === "violation"
  ) {
    return "verdicts";
  }
  if (
    node.entityKind === "part-definition" ||
    node.entityKind === "part-usage" ||
    node.entityKind === "attribute-usage"
  ) {
    return "system-model";
  }
  if (node.entityKind !== "artifact") return undefined;

  const haystack = `${node.system} ${node.artifactKind ?? ""}`.toLowerCase();
  // `solver-input` / `solver-result` sont des genres d'artefact ENREGISTRÉS :
  // les omettre laissait la voie physique vide alors qu'un solveur avait
  // tourné, parce que ces artefacts déclarent `digital-thread` comme système.
  if (
    /calculix|gmsh|fea|modelica|thermal|ccx|frd|mesh|solver/.test(haystack)
  ) {
    return "physics";
  }
  if (
    /build123d|cad|step|geometry|glb/.test(haystack)
  ) {
    return "geometry";
  }
  return "system-model";
}

function columnCenter(lane: OverviewLaneId): number {
  const index = OVERVIEW_LANES.findIndex((item) => item.id === lane);
  return COLUMN_WIDTH * index + COLUMN_WIDTH / 2;
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
