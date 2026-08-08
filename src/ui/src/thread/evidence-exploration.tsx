/** @jsxImportSource preact */

/**
 * Sigma.js exploration renderer for the Evidence graph.
 *
 * Navigation contract (non-negotiable, identical to the SVG canvas):
 *   - clic noeud  → selectVerificationGraphItem({kind:"node", ref})
 *   - clic fond   → selectVerificationGraphItem(undefined) + inspector fermé
 *   - double-clic → recentrage caméra seulement (pas d'expansion)
 *
 * Ce composant est mince : toute la logique métier vit dans
 * evidence-exploration-model.ts et evidence-canvas-model.ts.
 */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import Sigma from "sigma";
import {
  buildExplorationModel,
  type ExplorationLegendItem,
  readCssTokens,
  type SigmaEdgeAttrs,
  type SigmaNodeAttrs,
} from "./evidence-exploration-model.ts";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import type { ThreadGraphRef } from "./types.ts";
import type { ThreadGraphSelection } from "./graph.tsx";

export interface EvidenceExplorationProps {
  evidenceModel: EvidenceGraphModel;
  projection: EvidenceCanvasProjection;
  /** Controlled selection — sigma reflects the state owned by workbench. */
  selection?: ThreadGraphSelection;
  /** Inspector focus ref (same semantics as ThreadGraph.focus). */
  focus?: ThreadGraphRef;
  /** Fires on clickNode or clickStage (undefined = background click). */
  onSelectionChange?: (selection: ThreadGraphSelection | undefined) => void;
  /**
   * Visible neighbour depth in the LOCAL view (Obsidian-style). The layout is
   * computed once at the projection's max depth; this value only drives sigma
   * node/edge reducers, so changing it makes nodes appear or disappear in
   * place — no re-layout, no camera reset. Ignored on the full map.
   */
  displayDepth?: number;
  /**
   * Compact mode — intended for the feed card vignette (FeedLineageGraph).
   *
   * When true:
   *   - Labels are always rendered regardless of node size
   *     (labelRenderedSizeThreshold: 0 instead of 10). The bounded
   *     neighbourhood at depth 2 is small enough that all labels fit.
   *   - The "COMPOSANTES" legend aside is hidden — a single-component
   *     local view carries no useful component information.
   *
   * The layout pipeline (dagre LR) is identical in both modes: causal
   * origins land on the left, observations/verdicts on the right.
   */
  compact?: boolean;
}

export function EvidenceExploration({
  evidenceModel,
  projection,
  displayDepth,
  selection,
  focus: _focus,
  onSelectionChange,
  compact = false,
}: EvidenceExplorationProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttrs, SigmaEdgeAttrs>>();
  // Keep a stable ref to the callback to avoid re-creating sigma on each render.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // Build the exploration model once per projection change.
  // Tokens are read inside useMemo so they match the current theme.
  // compact is stable for a given component instance (feed vignette vs full
  // canvas), so including it in deps is correct even though it never changes.
  const explorationModel = useMemo(() => {
    // document.documentElement satisfies CssTokenSource (has nodeType).
    const root = typeof document !== "undefined"
      ? (document.documentElement as { nodeType: number })
      : null;
    const tokens = readCssTokens(root);
    return buildExplorationModel(evidenceModel, projection, tokens, compact);
  }, [evidenceModel, projection, compact]);

  // Mount sigma, bind events, clean up on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sigma = new Sigma(
      explorationModel.graph,
      container,
      {
        renderLabels: true,
        labelFont: "Avenir Next, Avenir, Segoe UI, Helvetica, sans-serif",
        labelSize: 11,
        labelColor: { attribute: "color" },
        defaultNodeColor: explorationModel.tokens.muted,
        defaultEdgeColor: explorationModel.tokens.lineStrong,
        // Reduce edge arrow to keep the atelier aesthetic compact.
        defaultEdgeType: "arrow",
        minCameraRatio: 0.3,
        maxCameraRatio: 6,
        // compact=true (feed vignette): always show labels.
        //   labelRenderedSizeThreshold:0 — every node passes the size gate.
        //   labelGridCellSize:10 — fine-grain grid so sigma renders a label per
        //     10×10 px cell; at compact dagre spacing (nodesep=20, ranksep=50)
        //     the bounded depth-2 view fits in ~300 px and each cell holds at
        //     most one node → all labels visible without collision culling.
        //   labelDensity:1 — disable the random density thinning sigma applies
        //     on top of the grid (default 0.07 shows ~7% of eligible labels).
        // compact=false (full-map): labels appear only for nodes ≥10 rendered
        //   pixels; density and grid defaults keep the full canvas legible at
        //   the overview zoom level.
        labelRenderedSizeThreshold: compact ? 0 : 10,
        labelGridCellSize: compact ? 10 : 100,
        labelDensity: compact ? 1 : 0.07,
      },
    );
    sigmaRef.current = sigma;

    // clickNode → selectVerificationGraphItem
    sigma.on("clickNode", ({ node: nodeKey }) => {
      const attrs = explorationModel.graph.getNodeAttributes(nodeKey);
      if (!attrs) return;
      onSelectionChangeRef.current?.({
        kind: "node",
        ref: attrs.node.ref,
      });
    });

    // clickStage (background) → reset selection
    sigma.on("clickStage", () => {
      onSelectionChangeRef.current?.(undefined);
    });

    // doubleClickNode → recentre camera, no expansion
    sigma.on("doubleClickNode", ({ node: nodeKey, event }) => {
      event.preventSigmaDefault();
      const nodePosition = sigma.getNodeDisplayData(nodeKey);
      if (!nodePosition) return;
      sigma.getCamera().animate(
        { x: nodePosition.x, y: nodePosition.y, ratio: 0.4 },
        { duration: 300 },
      );
    });

    return () => {
      sigma.kill();
      sigmaRef.current = undefined;
    };
  }, [explorationModel, compact]);

  // Highlight selected node + apply the visible-depth display filter.
  // Both are pure sigma reducers on the SAME mounted instance: selection and
  // depth changes repaint in place, never re-layout or reset the camera.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const selectedKey = selection?.kind === "node"
      ? `${selection.ref.kind}:${selection.ref.id}`
      : undefined;
    const depths = projection.isFiltered
      ? projection.localDepthByRefKey
      : undefined;
    const hiddenAtDepth = (key: string): boolean => {
      if (!depths || displayDepth === undefined) return false;
      return (depths.get(key) ?? 0) > displayDepth;
    };

    sigma.setSetting("nodeReducer", (node, data) => {
      if (hiddenAtDepth(node)) return { ...data, hidden: true };
      if (!selectedKey) return data;
      if (node === selectedKey) {
        return {
          ...data,
          highlighted: true,
          // The node KEEPS its tool color: selection is shown by the size
          // bump and the highlight ring, never by repainting — a red FEA
          // fact must stay red when selected.
          size: (data.size ?? 8) * 1.4,
        };
      }
      return { ...data, highlighted: false };
    });
    sigma.refresh();
  }, [selection, explorationModel, displayDepth, projection]);

  // Truthful legend counters: when the visible-depth filter hides nodes, the
  // OUTILS and COMPOSANTES counts must reflect what is actually on screen,
  // not the computed max-depth neighbourhood.
  const { legend, systemLegend } = useMemo(() => {
    const depths = projection.isFiltered
      ? projection.localDepthByRefKey
      : undefined;
    if (!depths || displayDepth === undefined) {
      return {
        legend: explorationModel.legend,
        systemLegend: explorationModel.systemLegend,
      };
    }
    const systemCounts = new Map<string, number>();
    const componentCounts = new Map<number, number>();
    explorationModel.graph.forEachNode((key, attrs) => {
      if ((depths.get(key) ?? 0) > displayDepth) return;
      const system = attrs.node.system;
      systemCounts.set(system, (systemCounts.get(system) ?? 0) + 1);
      if (attrs.componentId !== undefined) {
        componentCounts.set(
          attrs.componentId,
          (componentCounts.get(attrs.componentId) ?? 0) + 1,
        );
      }
    });
    return {
      systemLegend: explorationModel.systemLegend
        .map((item) => ({ ...item, count: systemCounts.get(item.system) ?? 0 }))
        .filter((item) => item.count > 0),
      legend: explorationModel.legend
        .map((item) => ({
          ...item,
          visibleNodeCount: item.componentIds.reduce(
            (acc, id) => acc + (componentCounts.get(id) ?? 0),
            0,
          ),
        }))
        .filter((item) => item.visibleNodeCount > 0),
    };
  }, [explorationModel, displayDepth, projection]);

  return (
    <div class="evidence-exploration">
      <div
        class="evidence-exploration-stage"
        ref={containerRef}
        aria-label="Evidence exploration graph — sigma renderer"
      />
      {!compact && (
        <aside
          class="evidence-exploration-legend"
          aria-label="Evidence legend"
        >
          {systemLegend.length > 0 && (
            <>
              <p class="evidence-exploration-legend-title">OUTILS</p>
              {systemLegend.map((item) => (
                <span
                  key={item.system}
                  class="evidence-exploration-legend-chip"
                  aria-label={`${item.label} — ${item.count} faits`}
                >
                  <span
                    class="evidence-exploration-legend-chip-dot"
                    style={{ background: item.color }}
                    aria-hidden="true"
                  />
                  <span class="evidence-exploration-legend-chip-name">
                    {item.label}
                  </span>
                  <span class="evidence-exploration-legend-chip-count">
                    {item.count}
                  </span>
                </span>
              ))}
            </>
          )}
          {legend.length > 0 && (
            <>
              <p class="evidence-exploration-legend-title">COMPOSANTES</p>
              {legend.map((item) => (
                <LegendChip
                  key={item.componentIds[0]}
                  item={item}
                  sigma={sigmaRef}
                  graph={explorationModel.graph}
                />
              ))}
            </>
          )}
        </aside>
      )}
    </div>
  );
}

function LegendChip({
  item,
  sigma: sigmaRef,
  graph,
}: {
  item: ExplorationLegendItem;
  sigma: { current: Sigma<SigmaNodeAttrs, SigmaEdgeAttrs> | undefined };
  graph: ReturnType<
    typeof buildExplorationModel
  >["graph"];
}): JSX.Element {
  const handleClick = () => {
    const s = sigmaRef.current;
    if (!s) return;
    // Collect x/y of all nodes belonging to ANY component in this legend entry.
    // componentIds may cover multiple raw components merged under the same name.
    const componentIdSet = new Set(item.componentIds);
    const positions: { x: number; y: number }[] = [];
    graph.forEachNode((_key, attrs) => {
      if (
        attrs.componentId !== undefined && componentIdSet.has(attrs.componentId)
      ) {
        const disp = s.getNodeDisplayData(_key);
        if (disp) positions.push({ x: disp.x, y: disp.y });
      }
    });
    if (positions.length === 0) return;
    const cx = positions.reduce((acc, p) => acc + p.x, 0) / positions.length;
    const cy = positions.reduce((acc, p) => acc + p.y, 0) / positions.length;
    s.getCamera().animate({ x: cx, y: cy, ratio: 0.6 }, { duration: 400 });
  };

  return (
    <button
      type="button"
      class="evidence-exploration-legend-chip"
      onClick={handleClick}
      title={`Focaliser la caméra sur la composante "${item.name}"`}
      aria-label={`${item.name} — ${item.visibleNodeCount} faits`}
    >
      {
        /* No color dot: node colors encode the producing TOOL (see the OUTILS
          key above); painting component chips with a second palette made the
          two mappings contradict each other on screen. */
      }
      <span class="evidence-exploration-legend-chip-name">{item.name}</span>
      <span class="evidence-exploration-legend-chip-count">
        {item.visibleNodeCount}
      </span>
    </button>
  );
}
