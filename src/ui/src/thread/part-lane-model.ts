/**
 * Part-lane layout model — "Par pièce" view of the Evidence graph.
 *
 * Produces a deterministic grid layout where:
 *   - Each ROW corresponds to one product component (assembly first, then
 *     parts sorted by evidence density descending, then label).
 *   - Each COLUMN corresponds to a station in the engineering gate vocabulary.
 *   - Each CELL stacks the facts (graph nodes) anchored to that (row, column)
 *     pair in a stable, deterministic order.
 *
 * Two public functions are exposed:
 *
 *   buildStationAssignment(graph)
 *     Maps every graph node to a station using the SAME server-fixed prefixes
 *     as part-anchorage-model.ts (imported via `anchorFamilyByPrefix`).
 *     A node without a matching rule gets station "uncategorized" — it is
 *     counted and visible, never silently dropped.
 *
 *   buildPartLaneLayout(evidenceModel, projection, anchorage, stations, components)
 *     Computes positions, row metadata, collapsed flags, and edge set.
 *     Output is deterministic: equal inputs always produce equal outputs.
 *
 * Station vocabulary (ordered left → right):
 *   requirements | model | geometry | verification | observations |
 *   industrialization | uncategorized
 *
 * Collapse threshold (documented here, tested):
 *   A part row is collapsed when factCount <= 2 AND proofCount === 0.
 *   The assembly row is never collapsed regardless of density.
 *   "Proof" = node with entityKind "evaluation" or "violation".
 *
 * Station assignment rules (structural, no label/summary matching):
 *
 *   Entity-kind shortcuts (applied first):
 *     requirement                               → requirements
 *     evaluation | violation                    → verification (subcategory mechanical)
 *     observation                               → observations
 *
 *   Server-fixed prefix families (via anchorFamilyByPrefix from part-anchorage-model):
 *     architecture | oracle-requirements |
 *       sensitivity-edges | sensitivity-relations → model
 *     cad                                       → geometry
 *     mechanical | sensitivity-study |
 *       drip-tray-correction | run-queue-mechanical → verification (subcategory mechanical)
 *     printability                              → observations
 *     erpnext-bom | print-estimate              → industrialization
 *
 *   Nature-based fallbacks (artifact nodes only):
 *     system mcp-modelica | openmodelica | modelica → verification (subcategory thermal)
 *     artifactKind "bom"                         → industrialization
 *     artifactKind "sysml-model"                 → model
 *     kind "document" + system "casys-digital-thread" → model
 *
 *   Change / action / consumption nodes not matched by prefix:
 *     → uncategorized (counted, visible, never dropped)
 */

import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import {
  type AnchorFamily,
  anchorFamilyByPrefix,
  type PartAnchor,
} from "./part-anchorage-model.ts";
import type {
  ThreadComponentCatalog,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One of the fixed station columns in the "Par pièce" layout.
 *
 * The "uncategorized" station collects nodes that do not match any
 * classification rule.  It is always present in the column list and in the
 * counters, so no fact is silently dropped.
 */
export type Station =
  | "requirements"
  | "model"
  | "geometry"
  | "verification"
  | "observations"
  | "industrialization"
  | "uncategorized";

/**
 * Refinement for the "verification" station only.
 * Distinguishes mechanical (CAD/FEA) verification from thermal (Modelica).
 */
export type VerificationSubcategory = "mechanical" | "thermal";

/** Station assignment for one graph node. */
export interface StationAssignment {
  readonly station: Station;
  /**
   * Only set when station === "verification".
   * Distinguishes mechanical (FEA, height-correction, sensitivity study, R3
   * identity repair) from thermal (Modelica simulation).
   */
  readonly subcategory?: VerificationSubcategory;
}

/** A row in the part-lane layout (one product component). */
export interface PartLaneRow {
  /** "assembly" or a catalog component id (e.g., "cm01-v3:drip-tray"). */
  readonly componentId: string;
  /** Human-readable label from the catalog, or componentId if not found. */
  readonly label: string;
  /** Total facts (visible nodes) anchored to this row. */
  readonly factCount: number;
  /**
   * Proof count: visible evaluation or violation nodes anchored to this row.
   * Used for both the collapse threshold and the legend counter.
   */
  readonly proofCount: number;
  /**
   * True when factCount <= COLLAPSED_FACT_THRESHOLD && proofCount === 0
   * AND componentId !== "assembly".
   *
   * A collapsed row is still rendered with its summary instead of individual
   * cells.  Its facts are counted in PartLaneCounters.
   */
  readonly collapsed: boolean;
  /**
   * Human-readable collapse reason shown in the row summary.
   * Only set when collapsed === true.
   */
  readonly collapseReason?: string;
}

/**
 * The position of one fact node inside the lane grid.
 *
 * `stackIndex` is 0-based within the (componentId, station) cell, ordered
 * deterministically by nodeKey (lexicographic).  Multiple facts share a cell
 * when they are anchored to the same row and station.
 */
export interface PartLaneFact {
  readonly nodeKey: string; // `${kind}:${id}`
  readonly componentId: string;
  readonly station: Station;
  readonly stackIndex: number;
}

/** One edge in the part-lane layout.  Includes cross-row edges. */
export interface PartLaneEdge {
  readonly id: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly relation: string;
  /** True when the source and target facts belong to different rows. */
  readonly crossesRows: boolean;
}

/** Counters aggregated over the complete lane layout. */
export interface PartLaneCounters {
  /** Total visible fact nodes placed in the layout. */
  readonly totalFacts: number;
  /** Total proof (evaluation + violation) nodes across all rows. */
  readonly totalProofs: number;
  /** Visible nodes that did not match any station rule. */
  readonly uncategorizedCount: number;
  /** Per-row counters keyed by componentId. */
  readonly perRow: ReadonlyMap<string, { facts: number; proofs: number }>;
}

/** Complete "Par pièce" layout ready for the renderer. */
export interface PartLaneLayout {
  /** Ordered station columns (left → right). */
  readonly columns: readonly Station[];
  /**
   * Rows ordered by evidence density: assembly first, then parts by
   * factCount descending, then by label ascending for equal counts.
   */
  readonly rows: readonly PartLaneRow[];
  /**
   * Placed fact nodes, keyed by nodeKey.
   * Every visible node from the projection appears here exactly once.
   */
  readonly facts: ReadonlyMap<string, PartLaneFact>;
  /** Edges to render (includes cross-row edges). */
  readonly edges: readonly PartLaneEdge[];
  /** Aggregate counters. */
  readonly counters: PartLaneCounters;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Ordered list of station columns displayed left to right.
 * "uncategorized" is last so that well-classified facts dominate the viewport.
 */
export const STATION_COLUMNS: readonly Station[] = [
  "requirements",
  "model",
  "geometry",
  "verification",
  "observations",
  "industrialization",
  "uncategorized",
];

/**
 * A part row is collapsed when its fact count is at or below this threshold
 * AND it has zero proof nodes (evaluation or violation).
 *
 * The assembly row is never collapsed.
 */
export const COLLAPSED_FACT_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Station assignment — server-fixed prefix family → station mapping
// ---------------------------------------------------------------------------

/**
 * Maps each AnchorFamily (from part-anchorage-model) to a Station.
 * The mapping is the canonical truth; the inline comment traces to the design
 * spec ("mechanical-* => Verification", "cad-{digest}-{...} => Geometrie", etc.).
 */
const FAMILY_STATION: Readonly<Record<AnchorFamily, Station>> = {
  // Architecture / model artifacts
  "architecture": "model",
  "oracle-requirements": "model",
  "sensitivity-edges": "model",
  "sensitivity-relations": "model",
  // CAD and mesh geometry
  "cad": "geometry",
  // Mechanical verification (FEA, height-correction, run-queue)
  "mechanical": "verification",
  "sensitivity-study": "verification",
  "drip-tray-correction": "verification",
  "run-queue-mechanical": "verification",
  // DFM and manufacturing observations / costs
  "printability": "observations",
  "erpnext-bom": "industrialization",
  "print-estimate": "industrialization",
};

/**
 * Verification sub-category for prefix families that map to "verification".
 * Families not listed here have no sub-category (thermal is assigned via
 * nature criterion, not prefix family).
 */
const FAMILY_SUBCATEGORY: Partial<
  Readonly<Record<AnchorFamily, VerificationSubcategory>>
> = {
  "mechanical": "mechanical",
  "sensitivity-study": "mechanical",
  "drip-tray-correction": "mechanical",
  "run-queue-mechanical": "mechanical",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function refKey(node: ThreadGraphNode): string {
  return `${node.ref.kind}:${node.ref.id}`;
}

/**
 * Nature-based station fallback for artifact nodes not matched by any
 * server-fixed prefix.  Mirrors the nature criterion (c) in
 * part-anchorage-model.ts so the two classifiers remain consistent.
 */
function stationByNature(node: ThreadGraphNode): StationAssignment | null {
  if (node.entityKind !== "artifact") return null;
  const s = node.system;
  const k = node.artifactKind;
  // Thermal simulation results.
  if (s === "mcp-modelica" || s === "openmodelica" || s === "modelica") {
    return { station: "verification", subcategory: "thermal" };
  }
  // Bill of materials.
  if (k === "bom") return { station: "industrialization" };
  // SysML architecture or model-seed artifacts (not caught by prefix).
  if (k === "sysml-model") return { station: "model" };
  // Project brief or documentary artifact.
  if (k === "document" && s === "casys-digital-thread") {
    return { station: "model" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: buildStationAssignment
// ---------------------------------------------------------------------------

/**
 * Assign a station to every graph node using structural criteria only.
 *
 * Rules are applied in priority order:
 *   1. Entity-kind shortcuts: requirement → requirements;
 *      evaluation|violation → verification (mechanical);
 *      observation → observations.
 *   2. Server-fixed prefix family (via anchorFamilyByPrefix from
 *      part-anchorage-model — no prefix duplication).
 *   3. Nature-based fallback for artifact nodes.
 *   4. Uncategorized (count, never drop).
 *
 * Returns a Map<nodeKey, StationAssignment> for all nodes in `graph`.
 * The result is deterministic: same input → same output.
 */
export function buildStationAssignment(
  graph: ThreadGraph,
): Map<string, StationAssignment> {
  const result = new Map<string, StationAssignment>();

  for (const node of graph.nodes) {
    const key = refKey(node);

    // ── Rule 1: entity-kind shortcuts ────────────────────────────────────────
    if (node.entityKind === "requirement") {
      result.set(key, { station: "requirements" });
      continue;
    }
    if (node.entityKind === "evaluation" || node.entityKind === "violation") {
      result.set(key, {
        station: "verification",
        subcategory: "mechanical",
      });
      continue;
    }
    if (node.entityKind === "observation") {
      result.set(key, { station: "observations" });
      continue;
    }

    // ── Rule 2: server-fixed prefix family ───────────────────────────────────
    const family = anchorFamilyByPrefix(node.ref.id);
    if (family !== null) {
      const station = FAMILY_STATION[family];
      const subcategory = FAMILY_SUBCATEGORY[family];
      result.set(key, subcategory ? { station, subcategory } : { station });
      continue;
    }

    // ── Rule 3: nature-based artifact fallback ────────────────────────────────
    const natureAssignment = stationByNature(node);
    if (natureAssignment !== null) {
      result.set(key, natureAssignment);
      continue;
    }

    // ── Rule 4: uncategorized ─────────────────────────────────────────────────
    result.set(key, { station: "uncategorized" });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public: buildPartLaneLayout
// ---------------------------------------------------------------------------

/**
 * Build the complete "Par pièce" layout from pre-computed anchorage and
 * station assignments.
 *
 * Inputs:
 * @param evidenceModel  Full evidence graph model (used for edge set).
 * @param projection     Filtered/visible nodes and edges from the canvas.
 * @param anchorage      nodeKey → PartAnchor (from buildPartAnchorage).
 * @param stations       nodeKey → StationAssignment (from buildStationAssignment).
 * @param components     Component catalog (for row labels).
 *
 * The layout is deterministic: equal inputs always produce equal outputs.
 * Edges from `projection` are used; stubs carried in the projection are
 * already included.
 */
export function buildPartLaneLayout(
  _evidenceModel: EvidenceGraphModel,
  projection: EvidenceCanvasProjection,
  anchorage: ReadonlyMap<string, PartAnchor>,
  stations: ReadonlyMap<string, StationAssignment>,
  components: ThreadComponentCatalog,
): PartLaneLayout {
  // ── Build a label lookup from the catalog ──────────────────────────────────
  const labelByComponentId = new Map<string, string>();
  for (const component of components.components) {
    const key = component.kind === "assembly" ? "assembly" : component.id;
    labelByComponentId.set(key, component.label);
  }

  // ── Distribute visible nodes into (componentId, station) cells ────────────
  //
  // For each visible node:
  //   - resolve its row (componentId) from the anchorage; if not anchored,
  //     fall back to "assembly" (the whole-project row catches unanchored nodes).
  //   - resolve its station from the assignment; defaults to "uncategorized".
  //
  // Cells: Map<componentId, Map<station, nodeKey[]>>
  const cells = new Map<string, Map<Station, string[]>>();
  // Also track which componentIds appear (needed for rows with 0 nodes too).
  const seenComponentIds = new Set<string>();

  // Seed assembly as always present.
  seenComponentIds.add("assembly");

  // Seed all catalog part IDs.
  for (const component of components.components) {
    if (component.kind === "assembly") continue;
    seenComponentIds.add(component.id);
  }

  const nodeByKey = new Map<string, ThreadGraphNode>();
  for (const node of projection.nodes) {
    nodeByKey.set(refKey(node), node);
  }

  for (const node of projection.nodes) {
    const key = refKey(node);
    const anchor = anchorage.get(key);
    const componentId = anchor
      ? anchor.target === "assembly" ? "assembly" : anchor.target
      : "assembly"; // unanchored → whole-project row

    const stationAssignment = stations.get(key);
    const station: Station = stationAssignment?.station ?? "uncategorized";

    seenComponentIds.add(componentId);

    let byStation = cells.get(componentId);
    if (!byStation) {
      byStation = new Map();
      cells.set(componentId, byStation);
    }
    let stack = byStation.get(station);
    if (!stack) {
      stack = [];
      byStation.set(station, stack);
    }
    stack.push(key);
  }

  // Sort each cell stack deterministically (lexicographic by nodeKey).
  for (const byStation of cells.values()) {
    for (const [station, stack] of byStation) {
      byStation.set(station, [...stack].sort());
    }
  }

  // ── Compute per-row metrics ────────────────────────────────────────────────
  function factCountForComponent(componentId: string): number {
    const byStation = cells.get(componentId);
    if (!byStation) return 0;
    let count = 0;
    for (const stack of byStation.values()) count += stack.length;
    return count;
  }

  function proofCountForComponent(componentId: string): number {
    let count = 0;
    const byStation = cells.get(componentId);
    if (!byStation) return 0;
    for (const node of projection.nodes) {
      const key = refKey(node);
      const anchor = anchorage.get(key);
      const nodeComponentId = anchor
        ? anchor.target === "assembly" ? "assembly" : anchor.target
        : "assembly";
      if (
        nodeComponentId === componentId &&
        (node.entityKind === "evaluation" || node.entityKind === "violation")
      ) {
        count++;
      }
    }
    return count;
  }

  // ── Build rows ────────────────────────────────────────────────────────────
  const rowsUnsorted: PartLaneRow[] = [];
  for (const componentId of seenComponentIds) {
    const factCount = factCountForComponent(componentId);
    const proofCount = proofCountForComponent(componentId);
    const isAssembly = componentId === "assembly";
    const collapsed = !isAssembly &&
      factCount <= COLLAPSED_FACT_THRESHOLD &&
      proofCount === 0;
    const label = labelByComponentId.get(componentId) ?? componentId;
    rowsUnsorted.push({
      componentId,
      label,
      factCount,
      proofCount,
      collapsed,
      collapseReason: collapsed
        ? `${factCount} fait${
          factCount !== 1 ? "s" : ""
        }, aucune preuve technique`
        : undefined,
    });
  }

  // Sort: assembly first, then by factCount desc, then label asc.
  const rows: PartLaneRow[] = rowsUnsorted.sort((a, b) => {
    if (a.componentId === "assembly") return -1;
    if (b.componentId === "assembly") return 1;
    if (b.factCount !== a.factCount) return b.factCount - a.factCount;
    return a.label.localeCompare(b.label);
  });

  // ── Build fact positions ──────────────────────────────────────────────────
  const rowIndexByComponentId = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    rowIndexByComponentId.set(rows[i]!.componentId, i);
  }

  const facts = new Map<string, PartLaneFact>();
  for (const [componentId, byStation] of cells) {
    for (const [station, stack] of byStation) {
      // stack is already sorted deterministically above.
      stack.forEach((nodeKey, stackIndex) => {
        facts.set(nodeKey, { nodeKey, componentId, station, stackIndex });
      });
    }
  }

  // ── Build edges ───────────────────────────────────────────────────────────
  const edges: PartLaneEdge[] = (projection.edges as ThreadGraphEdge[]).flatMap(
    (edge) => {
      const fromKey = `${edge.from.kind}:${edge.from.id}`;
      const toKey = `${edge.to.kind}:${edge.to.id}`;
      const fromFact = facts.get(fromKey);
      const toFact = facts.get(toKey);
      if (!fromFact || !toFact) return [];
      const crossesRows = fromFact.componentId !== toFact.componentId;
      return [{
        id: edge.id,
        fromKey,
        toKey,
        relation: edge.relation,
        crossesRows,
      }];
    },
  );

  // ── Build counters ────────────────────────────────────────────────────────
  const perRow = new Map<string, { facts: number; proofs: number }>();
  for (const row of rows) {
    perRow.set(row.componentId, {
      facts: row.factCount,
      proofs: row.proofCount,
    });
  }

  let uncategorizedCount = 0;
  for (const fact of facts.values()) {
    if (fact.station === "uncategorized") uncategorizedCount++;
  }

  const totalFacts = facts.size;
  let totalProofs = 0;
  for (const { proofs } of perRow.values()) totalProofs += proofs;

  const counters: PartLaneCounters = {
    totalFacts,
    totalProofs,
    uncategorizedCount,
    perRow,
  };

  return {
    columns: STATION_COLUMNS,
    rows,
    facts,
    edges,
    counters,
  };
}
