/**
 * "Par pièce" corridor model — sigma/dagre layered view of the Evidence graph.
 *
 * Strategy:
 *   1. Run `buildExplorationModel` to obtain dagre x positions (causal left→right
 *      flow). These x values are NEVER modified: the corridors view preserves
 *      the same causal ordering as the Exploration mode.
 *   2. Group visible nodes by part lane using the anchorage map
 *      (buildPartAnchorage). Unanchored nodes fall into the "assembly" lane.
 *   3. For each lane (in `PartLaneLayout.rows` order — assembly first, then
 *      parts by evidence density):
 *      - Non-collapsed lane: sort nodes by (dagre_y ASC, nodeKey) to preserve
 *        the relative vertical ordering from the full layout; assign y = laneTop
 *        + LANE_PADDING_TOP + i × LANE_NODE_SPACING. This guarantees no overlap
 *        within the lane.
 *      - Collapsed lane (factCount ≤ COLLAPSED_FACT_THRESHOLD, proofCount = 0):
 *        all nodes go to the centre of a thin COLLAPSED_LANE_HEIGHT band.
 *   4. Emit `LaneMeta` for each row with the final [yMin, yMax] range in graph
 *      coordinates. The renderer uses `sigma.graphToViewport` to draw lane
 *      separators synchronised with the camera.
 *
 * All logic is pure (no I/O, no Preact). Tests live in part-lane-graph-model_test.ts.
 */

import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import type { PartAnchor } from "./part-anchorage-model.ts";
import type { PartLaneRow } from "./part-lane-model.ts";
import {
  buildExplorationModel,
  type CssTokens,
  type SigmaEdgeAttrs,
  type SigmaNodeAttrs,
} from "./evidence-exploration-model.ts";
import type { DirectedGraph } from "graphology";

// ---------------------------------------------------------------------------
// Layout constants (graph coordinate units — sigma normalises to viewport)
// ---------------------------------------------------------------------------

/** Vertical space above the first node in a lane, reserving room for the label. */
export const LANE_PADDING_TOP = 44;
/** Vertical breathing room below the last node in a lane. */
export const LANE_PADDING_BOTTOM = 20;
/** Vertical distance between node centres within a non-collapsed lane. */
export const LANE_NODE_SPACING = 80;
/** Gap between adjacent lane bands. */
export const LANE_GAP = 24;
/**
 * Height of a collapsed (thin) lane band.
 *
 * Sized relative to the EXPANDED lanes, not to the viewport: a populated lane
 * spans ~2000 graph units (one LANE_NODE_SPACING slot per node), so at
 * full-graph zoom the camera scale is ~0.1 px/unit. 140 units keeps the band
 * "thin" next to populated lanes while still rendering ≥ 10 CSS pixels — the
 * minimum for the in-band label to stay readable without zooming.
 */
export const COLLAPSED_LANE_HEIGHT = 140;
/** Top margin before the first lane. */
export const LANE_MARGIN_TOP = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Metadata for one part lane as rendered in the corridor view.
 *
 * `yMin` and `yMax` are in graph coordinates; the renderer converts them to
 * viewport coordinates using `sigma.graphToViewport` on each camera update.
 */
export interface LaneMeta {
  /** "assembly" or a catalog component id (e.g. "cm01-v3:drip-tray"). */
  readonly componentId: string;
  /** Human-readable label from the catalog. */
  readonly label: string;
  /** y coordinate (graph space) of the lane's top edge. */
  readonly yMin: number;
  /** y coordinate (graph space) of the lane's bottom edge. */
  readonly yMax: number;
  /** True when the lane is rendered as a thin collapsed band. */
  readonly collapsed: boolean;
  /** Total fact (visible node) count in this lane. */
  readonly factCount: number;
  /** Proof (evaluation + violation) count in this lane. */
  readonly proofCount: number;
}

/** Complete model consumed directly by the PartLaneGraphView component. */
export interface PartLaneGraphModel {
  /**
   * DirectedGraph with visual attributes (color, size, label) AND lane-aware
   * y positions. x positions come from dagre — unchanged from Exploration.
   */
  readonly graph: DirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>;
  /** Lane metadata ordered assembly-first. */
  readonly lanes: readonly LaneMeta[];
  /** CSS tokens used for node/edge colours. */
  readonly tokens: CssTokens;
  /** Count of supporting nodes hidden by the essential filter (same as Exploration). */
  readonly hiddenSupportingCount: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the PartLaneGraphModel from pre-computed components.
 *
 * @param evidenceModel  Full evidence model (component detection for legend).
 * @param projection     Canvas projection already filtered by the essential mask
 *                       (same projection consumed by EvidenceExploration).
 * @param anchorage      nodeKey → PartAnchor from buildPartAnchorage. Nodes
 *                       absent from this map fall into the "assembly" lane.
 * @param rows           Ordered row metadata from PartLaneLayout.rows (determines
 *                       lane order and collapse status).
 * @param tokens         CSS colour tokens resolved at call time.
 *
 * Determinism contract: same inputs always produce the same graph positions
 * and the same lane boundaries.
 */
export function buildPartLaneGraphModel(
  evidenceModel: EvidenceGraphModel,
  projection: EvidenceCanvasProjection,
  anchorage: ReadonlyMap<string, PartAnchor>,
  rows: readonly PartLaneRow[],
  tokens: CssTokens,
): PartLaneGraphModel {
  // ── 1. Get dagre x positions ──────────────────────────────────────────────
  //
  // buildExplorationModel produces a fresh DirectedGraph with positions set by
  // dagre (rankdir: LR — causal origins on the left). We KEEP the x values and
  // OVERRIDE the y values below.
  const exploration = buildExplorationModel(evidenceModel, projection, tokens);
  const graph = exploration.graph;

  // ── 2. Map each graph node to its lane ────────────────────────────────────
  //
  // A node's lane is the componentId given by the anchorage map. Unanchored
  // nodes fall into "assembly" (the whole-project catch-all row).
  const laneByNode = new Map<string, string>();
  graph.forEachNode((key: string) => {
    const anchor = anchorage.get(key);
    const cid = anchor
      ? (anchor.target === "assembly" ? "assembly" : anchor.target)
      : "assembly";
    laneByNode.set(key, cid);
  });

  // Collect node keys per lane, seeded from the rows list.
  const nodesByLane = new Map<string, string[]>();
  for (const row of rows) {
    nodesByLane.set(row.componentId, []);
  }
  laneByNode.forEach((cid, key) => {
    const list = nodesByLane.get(cid);
    if (list) {
      list.push(key);
    } else {
      // Lane not in rows (catalog component not listed) — fall through to assembly.
      const assemblyList = nodesByLane.get("assembly");
      if (assemblyList) assemblyList.push(key);
    }
  });

  // ── 3. Assign y positions lane by lane ───────────────────────────────────

  let currentY = LANE_MARGIN_TOP;
  const lanes: LaneMeta[] = [];

  for (const row of rows) {
    const cid = row.componentId;
    const laneNodes = (nodesByLane.get(cid) ?? []).slice(); // stable copy
    const laneTop = currentY;

    if (row.collapsed) {
      // ── Collapsed band: thin height, nodes centred ──────────────────────
      const laneBottom = laneTop + COLLAPSED_LANE_HEIGHT;

      // Place nodes at the centre of the band, spread horizontally by their
      // existing dagre x (x is unchanged). Sort by nodeKey for determinism.
      laneNodes.sort((a, b) => a.localeCompare(b));
      laneNodes.forEach((key) => {
        graph.setNodeAttribute(key, "y", laneTop + COLLAPSED_LANE_HEIGHT / 2);
        // Make collapsed nodes small so they don't dominate thin bands.
        const currentSize = graph.getNodeAttribute(key, "size") as number;
        graph.setNodeAttribute(key, "size", Math.min(currentSize, 4));
      });

      lanes.push({
        componentId: cid,
        label: row.label,
        yMin: laneTop,
        yMax: laneBottom,
        collapsed: true,
        factCount: row.factCount,
        proofCount: row.proofCount,
      });

      currentY = laneBottom + LANE_GAP;
    } else {
      // ── Non-collapsed lane: stack nodes vertically ────────────────────────
      //
      // Sort by (dagre_y ASC, nodeKey) — this preserves the relative vertical
      // ordering that dagre produced within this lane's nodes, and is fully
      // deterministic on ties.
      laneNodes.sort((a, b) => {
        const ya = graph.getNodeAttribute(a, "y") as number ?? 0;
        const yb = graph.getNodeAttribute(b, "y") as number ?? 0;
        return ya - yb || a.localeCompare(b);
      });

      const nodeCount = laneNodes.length;
      // Height = label space + one slot per node + bottom padding.
      // An empty non-collapsed lane (assembly with 0 nodes is never collapsed)
      // gets one full slot so the band is still visible.
      const laneContentHeight = Math.max(1, nodeCount) * LANE_NODE_SPACING;
      const laneBottom = laneTop + LANE_PADDING_TOP + laneContentHeight +
        LANE_PADDING_BOTTOM;

      laneNodes.forEach((key, i) => {
        // Node centre: laneTop + header + slot centre.
        const newY = laneTop +
          LANE_PADDING_TOP +
          i * LANE_NODE_SPACING +
          LANE_NODE_SPACING / 2;
        graph.setNodeAttribute(key, "y", newY);
      });

      lanes.push({
        componentId: cid,
        label: row.label,
        yMin: laneTop,
        yMax: laneBottom,
        collapsed: false,
        factCount: row.factCount,
        proofCount: row.proofCount,
      });

      currentY = laneBottom + LANE_GAP;
    }
  }

  // ── 4. Flip the vertical axis for sigma ──────────────────────────────────
  //
  // The layout above is computed top-down (assembly first, y increasing
  // downward like a document). Sigma renders with the WebGL convention where
  // GREATER y is HIGHER on screen — without this flip the first lane
  // (assembly, the superior level) ends up at the BOTTOM. Negating every y
  // keeps relative spacing intact and puts the first lane on top.
  graph.forEachNode((key: string) => {
    const y = graph.getNodeAttribute(key, "y") as number ?? 0;
    graph.setNodeAttribute(key, "y", -y);
  });
  const flippedLanes = lanes.map((lane) => ({
    ...lane,
    yMin: -lane.yMax,
    yMax: -lane.yMin,
  }));

  return {
    graph,
    lanes: flippedLanes,
    tokens,
    hiddenSupportingCount: exploration.hiddenSupportingCount,
  };
}
