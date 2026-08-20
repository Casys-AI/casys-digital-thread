import { applyEssentialFilter } from "../thread/essential-graph-filter.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { resolveThreadPhases } from "./overview-thread-phase-model.ts";
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

/**
 * Une colonne du fil : une étape déclarée du projet, celle-là même que le
 * bandeau de gates affiche au-dessus.
 */
export interface OverviewPhaseColumn {
  readonly id: string;
  readonly title: string;
  readonly systems: readonly string[];
}

export interface OverviewThreadHeroView {
  readonly lanes: readonly OverviewPhaseColumn[];
  readonly nodes: readonly OverviewHeroNode[];
  readonly edges: readonly OverviewHeroEdge[];
}

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
  project: EngineeringProjectSnapshot,
): OverviewThreadHeroView {
  const essential = applyEssentialFilter(
    thread.graph.nodes,
    thread.graph.edges,
  );

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

  const phases = resolveThreadPhases(project, thread);

  // Seules les étapes qui portent un enregistrement deviennent des colonnes :
  // une colonne vide occuperait la largeur sans rien apprendre. L'ordre reste
  // celui que le projet déclare.
  // Repli : sans provenance d'étape exploitable, le fil retombe sur les
  // disciplines plutôt que de se vider. Un projet dont les runs ne citent
  // aucun work item garderait sinon une page blanche là où il a travaillé.
  const hasPhaseProvenance = essential.nodes.some((node) =>
    phases.phaseIdByRefKey.has(refKey(node.ref))
  );
  const columnOf = (node: ThreadGraphNode): string | undefined =>
    hasPhaseProvenance
      ? phases.phaseIdByRefKey.get(refKey(node.ref))
      : (node.entityKind === "observation"
        ? measurementLaneFor(node, producersByRefKey) ?? overviewLaneFor(node)
        : overviewLaneFor(node));

  const placeable = essential.nodes.filter((node) =>
    columnOf(node) !== undefined
  );
  const usedColumnIds = new Set(placeable.map((node) => columnOf(node)!));
  const declaredColumns = hasPhaseProvenance
    ? phases.orderedPhases
    : OVERVIEW_LANES.map((lane) => ({ id: lane.id, name: lane.title }));
  const columns = declaredColumns.filter((column) =>
    usedColumnIds.has(column.id)
  );
  const columnIndex = new Map(
    columns.map((column, index) => [column.id, index]),
  );
  const columnWidth = columns.length === 0
    ? OVERVIEW_HERO_WIDTH
    : OVERVIEW_HERO_WIDTH / columns.length;

  const placed: OverviewHeroNode[] = [];
  const counts = new Map<string, number>();
  for (const node of placeable) {
    const columnId = columnOf(node)!;
    const index = counts.get(columnId) ?? 0;
    if (index >= MAX_PER_LANE) continue;
    counts.set(columnId, index + 1);
    // La couleur continue de dire la DISCIPLINE : la colonne dit l'étape, le
    // liseré dit la nature. Deux informations, pas une.
    const lane = node.entityKind === "observation"
      ? measurementLaneFor(node, producersByRefKey) ?? overviewLaneFor(node)
      : overviewLaneFor(node);
    const discipline = OVERVIEW_LANES.find((item) => item.id === lane);
    placed.push({
      key: refKey(node.ref),
      node,
      lane: lane ?? "system-model",
      x: columnWidth * (columnIndex.get(columnId) ?? 0) + columnWidth / 2,
      y: NODE_TOP + index * NODE_GAP,
      color: discipline?.color ?? "#71717a",
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
    lanes: columns.map((phase) => ({
      id: phase.id,
      title: phase.name,
      systems: uniqueSystems(
        placed
          .filter((item) => phases.phaseIdByRefKey.get(item.key) === phase.id)
          .map((item) => item.node.system),
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
