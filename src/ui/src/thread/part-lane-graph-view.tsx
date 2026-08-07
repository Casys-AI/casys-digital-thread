/** @jsxImportSource preact */

/**
 * "Par pièce" corridor view — sigma renderer with horizontal lane separators.
 *
 * Replaces the PartLaneView HTML table. Renders the same sigma/dagre graph as
 * the Exploration mode (same nodes, edges, causal left→right flow), but with
 * nodes constrained to horizontal part lanes:
 *   - Assembly lane at the top, visually distinct (amber border).
 *   - Part lanes sorted by evidence density (highest first).
 *   - Empty/collapsed lanes as thin bands with a short summary.
 *
 * Lane separators are drawn on a background canvas using the visual language of
 * the Carte canvas frames (dashed rect + uppercase label — see
 * 12-calm-cockpit.css `.thread-graph-component-boundary`). The bg canvas sits
 * behind sigma's transparent canvas stack and is redrawn on every sigma
 * `beforeRender` event to stay synchronised with pan/zoom.
 *
 * Navigation contract (identical to EvidenceExploration and Carte):
 *   - Click node  → onSelectionChange({kind:"node", ref}) + inspector opens.
 *   - Click stage → onSelectionChange(undefined) — clears focus, returns to
 *                   full-map projection.
 *   - Double-click → camera re-centres on node (no expansion).
 *
 * The "INDEX DES PIÈCES" aside and the Activity feed filter are unchanged from
 * the previous PartLaneView; this component wires them to the same callbacks.
 */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import Sigma from "sigma";
import {
  buildPartLaneGraphModel,
  type PartLaneGraphModel,
} from "./part-lane-graph-model.ts";
import {
  readCssTokens,
  type SigmaEdgeAttrs,
  type SigmaNodeAttrs,
} from "./evidence-exploration-model.ts";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import type { PartAnchor } from "./part-anchorage-model.ts";
import type { PartLaneCounters, PartLaneRow } from "./part-lane-model.ts";
import type { ThreadGraphSelection } from "./graph.tsx";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PartLaneGraphViewProps {
  evidenceModel: EvidenceGraphModel;
  projection: EvidenceCanvasProjection;
  /** Anchorage map (nodeKey → PartAnchor) for lane assignment. */
  anchorage: ReadonlyMap<string, PartAnchor>;
  /** Ordered lane rows (assembly first) for lane ordering + collapse status. */
  rows: readonly PartLaneRow[];
  /** Aggregate counters used by the INDEX DES PIÈCES aside. */
  counters: PartLaneCounters;
  /** Controlled selection shared with the rest of the workbench. */
  selection?: ThreadGraphSelection;
  /** Global selected component id (shared with Product workspace). */
  selectedComponentId?: string;
  /** Fires on clickNode or clickStage. */
  onSelectionChange?: (sel: ThreadGraphSelection | undefined) => void;
  /** Fires when the user clicks a lane chip in the index. */
  onComponentFocus?: (componentId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PartLaneGraphView({
  evidenceModel,
  projection,
  anchorage,
  rows,
  counters,
  selection,
  selectedComponentId,
  onSelectionChange,
  onComponentFocus,
}: PartLaneGraphViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttrs, SigmaEdgeAttrs>>();
  // Keep a stable ref to callbacks to avoid sigma remount on each render.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // Build the corridor model once per projection change (same trigger as
  // EvidenceExploration). Tokens are read from CSS at call time.
  const model = useMemo((): PartLaneGraphModel => {
    const root = typeof document !== "undefined"
      ? document.documentElement
      : null;
    const tokens = readCssTokens(
      root as { nodeType: number } | null,
    );
    return buildPartLaneGraphModel(
      evidenceModel,
      projection,
      anchorage,
      rows,
      tokens,
    );
  }, [evidenceModel, projection, anchorage, rows]);

  // Keep a stable ref for use inside the beforeRender callback (avoids
  // registering a new listener on every model change).
  const modelRef = useRef(model);
  modelRef.current = model;

  // ── Mount sigma, bind draw loop and interaction events ───────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Draw lane bands on the background canvas using sigma's coordinate system.
    // Fires on every `beforeRender` so bands stay aligned during pan/zoom.
    const drawLaneBands = (): void => {
      const sigma = sigmaRef.current;
      const bgCanvas = bgCanvasRef.current;
      const currentModel = modelRef.current;
      if (!sigma || !bgCanvas || !currentModel) return;

      const dim = sigma.getDimensions();
      const w = dim.width;
      const h = dim.height;

      // Resize canvas to match sigma's viewport (clears content as a side-effect).
      if (bgCanvas.width !== w || bgCanvas.height !== h) {
        bgCanvas.width = w;
        bgCanvas.height = h;
        bgCanvas.style.width = `${w}px`;
        bgCanvas.style.height = `${h}px`;
      }

      const ctx = bgCanvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      for (const lane of currentModel.lanes) {
        // Convert graph y coordinates to viewport (CSS pixel) coordinates.
        // We pass x=0 as a neutral reference; only the y component matters here.
        const topVP = sigma.graphToViewport({ x: 0, y: lane.yMin });
        const botVP = sigma.graphToViewport({ x: 0, y: lane.yMax });
        const yTop = Math.min(topVP.y, botVP.y);
        const laneH = Math.abs(botVP.y - topVP.y);
        if (laneH < 1) continue; // lane off-screen — skip drawing

        const isAssembly = lane.componentId === "assembly";

        // ── Background fill (very subtle) ─────────────────────────────────
        ctx.fillStyle = isAssembly
          ? "rgba(163, 91, 39, 0.04)"
          : "rgba(186, 196, 187, 0.06)";
        ctx.fillRect(0, yTop, w, laneH);

        // ── Dashed border (Carte frame visual language) ───────────────────
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = isAssembly ? "rgba(163, 91, 39, 0.45)" : "#bac4bb";
        ctx.strokeRect(0.5, yTop + 0.5, w - 1, laneH - 1);
        ctx.restore();

        // ── Lane label (same font / letter-spacing as Carte component label) ─
        //
        // Collapsed bands are only ~10-14 CSS pixels tall at full-graph zoom:
        // a fixed yTop+14 offset would land OUTSIDE the band and the label
        // would silently vanish. Centre the label vertically in thin bands;
        // keep the top-anchored position for expanded lanes.
        const labelY = lane.collapsed ? yTop + laneH / 2 + 3 : yTop + 14;
        if (laneH >= 8) {
          ctx.save();
          ctx.font = "bold 9px Avenir Next, Avenir, Segoe UI, monospace";
          // CSS letterSpacing property is only available via canvas in modern browsers.
          // Fallback: manually space chars. Use the property if available.
          try {
            // deno-lint-ignore no-explicit-any
            (ctx as any).letterSpacing = "1.2px";
          } catch (_) { /* ignore */ }
          ctx.fillStyle = isAssembly ? "rgba(163, 91, 39, 0.85)" : "#5e7169";
          ctx.fillText(lane.label.toUpperCase(), 10, labelY);
          ctx.restore();
        }

        // ── Collapsed lane summary text (same centred line as the label) ───
        if (lane.collapsed && laneH >= 8) {
          const reason = `${lane.factCount} fait${
            lane.factCount !== 1 ? "s" : ""
          }, aucune preuve technique`;
          ctx.save();
          ctx.font = "italic 10px Avenir Next, Avenir, Segoe UI, sans-serif";
          ctx.fillStyle = "#8a9c94";
          // Place after the label text (approximate width).
          const labelWidth = lane.label.toUpperCase().length * 7 + 18;
          ctx.fillText(reason, labelWidth, labelY + 1);
          ctx.restore();
        }
      }
    };

    const sigma = new Sigma<SigmaNodeAttrs, SigmaEdgeAttrs>(
      model.graph,
      container,
      {
        renderLabels: true,
        labelFont: "Avenir Next, Avenir, Segoe UI, Helvetica, sans-serif",
        labelSize: 11,
        labelColor: { attribute: "color" },
        defaultNodeColor: model.tokens.muted,
        defaultEdgeColor: model.tokens.lineStrong,
        defaultEdgeType: "arrow",
        // Allow zooming out enough to see all lanes at once.
        minCameraRatio: 0.05,
        maxCameraRatio: 8,
        // Show labels when nodes are ≥ 6 rendered pixels.
        // The corridor layout spreads nodes vertically; at full-graph zoom most
        // nodes are small. The density settings keep the label count readable.
        labelRenderedSizeThreshold: 6,
        labelGridCellSize: 80,
        labelDensity: 0.1,
      },
    );
    sigmaRef.current = sigma;

    // The default camera frames the NODE extent only — lanes without any node
    // (the thin collapsed bands) would fall outside the initial view. Frame the
    // camera on the union of all lane bands instead, so every corridor row is
    // visible on open.
    if (model.lanes.length > 0) {
      let xMin = Infinity;
      let xMax = -Infinity;
      model.graph.forEachNode((key: string) => {
        const x = model.graph.getNodeAttribute(key, "x") as number ?? 0;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
      });
      if (!Number.isFinite(xMin)) {
        xMin = 0;
        xMax = 1;
      }
      const yMin = Math.min(...model.lanes.map((lane) => lane.yMin));
      const yMax = Math.max(...model.lanes.map((lane) => lane.yMax));
      sigma.setCustomBBox({ x: [xMin, xMax], y: [yMin, yMax] });
    }

    // Draw lane bands BEFORE sigma renders so bands appear behind nodes.
    sigma.on("beforeRender", drawLaneBands);

    // ── Interaction: click node → inspector ─────────────────────────────────
    sigma.on("clickNode", ({ node: nodeKey }: { node: string }) => {
      const attrs = model.graph.getNodeAttributes(nodeKey);
      if (!attrs) return;
      onSelectionChangeRef.current?.({ kind: "node", ref: attrs.node.ref });
    });

    // ── Interaction: click stage → reset selection ──────────────────────────
    sigma.on("clickStage", () => {
      onSelectionChangeRef.current?.(undefined);
    });

    // ── Interaction: double-click → re-centre camera (no expansion) ─────────
    sigma.on(
      "doubleClickNode",
      (
        { node: nodeKey, event }: {
          node: string;
          event: { preventSigmaDefault: () => void };
        },
      ) => {
        event.preventSigmaDefault();
        const nodePos = sigma.getNodeDisplayData(nodeKey);
        if (!nodePos) return;
        sigma.getCamera().animate(
          { x: nodePos.x, y: nodePos.y, ratio: 0.4 },
          { duration: 300 },
        );
      },
    );

    return () => {
      sigma.kill();
      sigmaRef.current = undefined;
    };
  }, [model]);

  // ── Highlight selected node ──────────────────────────────────────────────
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const selectedKey = selection?.kind === "node"
      ? `${selection.ref.kind}:${selection.ref.id}`
      : undefined;

    sigma.setSetting("nodeReducer", (node, data) => {
      if (!selectedKey) return data;
      if (node === selectedKey) {
        return {
          ...data,
          highlighted: true,
          size: (data.size ?? 8) * 1.4,
          color: model.tokens.green,
        };
      }
      return { ...data, highlighted: false };
    });
    sigma.refresh();
  }, [selection, model]);

  // ── Build INDEX DES PIÈCES data ──────────────────────────────────────────
  const selectedNodeKey = selection?.kind === "node"
    ? `${selection.ref.kind}:${selection.ref.id}`
    : undefined;
  void selectedNodeKey; // used only via sigma nodeReducer above

  return (
    <div class="part-lane-view">
      {/* ── Sigma corridor stage ──────────────────────────────────────────── */}
      <div class="part-lane-graph-area">
        {/* Background canvas for lane bands (z-index 0, behind sigma) */}
        <canvas
          class="part-lane-graph-bg"
          ref={bgCanvasRef}
          aria-hidden="true"
        />
        {/* Sigma mounts here (z-index 1, transparent canvas layers) */}
        <div
          class="part-lane-graph-stage"
          ref={containerRef}
          aria-label="Evidence par pièce — vue en couloirs sigma"
        />
      </div>

      {/* ── INDEX DES PIÈCES ────────────────────────────────────────────────── */}
      <aside class="part-lane-index" aria-label="Index des pièces">
        <p class="part-lane-index-title">INDEX DES PIÈCES</p>
        {rows.map((row) => {
          const isFocused = selectedComponentId !== undefined
            ? selectedComponentId === row.componentId
            : row.componentId === "assembly";
          const counts = counters.perRow.get(row.componentId);
          return (
            <button
              key={row.componentId}
              type="button"
              class="part-lane-index-chip"
              aria-pressed={isFocused}
              aria-label={`${row.label} — ${counts?.facts ?? 0} faits${
                (counts?.proofs ?? 0) > 0
                  ? `, ${counts!.proofs} vérifications`
                  : ""
              }`}
              onClick={() => onComponentFocus?.(row.componentId)}
            >
              <span
                class="part-lane-index-chip-dot"
                data-assembly={row.componentId === "assembly"
                  ? "true"
                  : undefined}
                aria-hidden="true"
              />
              <span class="part-lane-index-chip-name">{row.label}</span>
              <span class="part-lane-index-chip-count">
                {counts?.facts ?? 0}
                {(counts?.proofs ?? 0) > 0 && (
                  <span class="part-lane-index-chip-proofs">
                    &nbsp;·&nbsp;{counts!.proofs}v
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <div class="part-lane-index-totals">
          <span>{counters.totalFacts} faits</span>
          {counters.totalProofs > 0 && (
            <span>{counters.totalProofs} vérif.</span>
          )}
          {counters.uncategorizedCount > 0 && (
            <span class="part-lane-index-uncat">
              {counters.uncategorizedCount} non classés
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}
