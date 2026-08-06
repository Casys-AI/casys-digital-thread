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
  readCssTokens,
  type ExplorationLegendItem,
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
}

export function EvidenceExploration({
  evidenceModel,
  projection,
  selection,
  focus: _focus,
  onSelectionChange,
}: EvidenceExplorationProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttrs, SigmaEdgeAttrs>>();
  // Keep a stable ref to the callback to avoid re-creating sigma on each render.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // Build the exploration model once per projection change.
  // Tokens are read inside useMemo so they match the current theme.
  const explorationModel = useMemo(() => {
    // document.documentElement satisfies CssTokenSource (has nodeType).
    const root = typeof document !== "undefined"
      ? (document.documentElement as { nodeType: number })
      : null;
    const tokens = readCssTokens(root);
    return buildExplorationModel(evidenceModel, projection, tokens);
  }, [evidenceModel, projection]);

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
        // Hide labels until the node occupies at least 10 rendered pixels.
        // At the default zoom (full ~60-node map), most nodes are below this
        // threshold, so the overview is clean. Labels appear as the user zooms in.
        labelRenderedSizeThreshold: 10,
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
  }, [explorationModel]);

  // Highlight selected node in sigma whenever selection changes.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const selectedKey = selection?.kind === "node"
      ? `${selection.ref.kind}:${selection.ref.id}`
      : undefined;

    // Re-render with updated highlighted state.
    sigma.setSetting("nodeReducer", (node, data) => {
      if (!selectedKey) return data;
      if (node === selectedKey) {
        return {
          ...data,
          highlighted: true,
          size: (data.size ?? 8) * 1.4,
          color: explorationModel.tokens.green,
        };
      }
      return { ...data, highlighted: false };
    });
    sigma.refresh();
  }, [selection, explorationModel]);

  const legend = explorationModel.legend;

  return (
    <div class="evidence-exploration">
      <div
        class="evidence-exploration-stage"
        ref={containerRef}
        aria-label="Evidence exploration graph — sigma renderer"
      />
      {legend.length > 0 && (
        <aside
          class="evidence-exploration-legend"
          aria-label="Evidence components"
        >
          <p class="evidence-exploration-legend-title">COMPOSANTES</p>
          {legend.map((item) => (
            <LegendChip
              key={item.componentIds[0]}
              item={item}
              sigma={sigmaRef}
              graph={explorationModel.graph}
            />
          ))}
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
      if (attrs.componentId !== undefined && componentIdSet.has(attrs.componentId)) {
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
      <span
        class="evidence-exploration-legend-chip-dot"
        style={{ background: item.color }}
        aria-hidden="true"
      />
      <span class="evidence-exploration-legend-chip-name">{item.name}</span>
      <span class="evidence-exploration-legend-chip-count">
        {item.visibleNodeCount}
      </span>
    </button>
  );
}
