/**
 * Sigma.js exploration renderer for the Evidence graph.
 *
 * Navigation contract (4b, full canvas only):
 *   - clic noeud     → inspect the recorded item (no local expansion)
 *   - double-clic    → local neighbourhood around that item
 *   - clic fond      → full map + inspector closed
 *   - compact feed   → single click stays in Activity; double-clic recenters
 *
 * Ce composant est mince : toute la logique métier vit dans
 * evidence-exploration-model.ts et evidence-canvas-model.ts.
 */

import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import {
  buildEvidenceMinimapView,
  buildExplorationModel,
  buildExplorationRelationRecords,
  DISPLAY_KIND_LABELS,
  type DisplayKind,
  displayKindOf,
  type EvidenceMinimapView,
  evidenceSystemFamily,
  type ExplorationLegendItem,
  isDisplayKindVisible,
  readCssTokens,
  type SigmaEdgeAttrs,
  type SigmaNodeAttrs,
} from "./evidence-exploration-model.ts";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import { Button } from "../ui/button.tsx";
import type { ThreadGraphRef } from "./types.ts";
import type { ThreadGraphSelection } from "./graph.tsx";
import { isUiOnlyPresentationEdge } from "../cad/cad-presentation-projection.ts";

/** Returns the most frequently occurring color in the map, or the fallback. */
function dominantColor(
  colorFrequencies: Map<string, number> | undefined,
  fallback: string,
): string {
  if (!colorFrequencies || colorFrequencies.size === 0) return fallback;
  let best = fallback;
  let bestCount = 0;
  for (const [color, count] of colorFrequencies) {
    if (count > bestCount) {
      bestCount = count;
      best = color;
    }
  }
  return best;
}

const legendRowClass =
  "flex items-center justify-between gap-2 rounded-sm px-1 py-[3px] text-[11.5px] leading-tight";
const legendCountClass =
  "font-mono text-[10px] text-muted-foreground tabular-nums";
const legendTitleClass =
  "mb-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

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
   * Full-map projection used only to draw the local-view minimap. Positions
   * come from the same dagre layout as the recorded graph — never a sketch.
   */
  fullMapProjection?: EvidenceCanvasProjection;
  /** Double-click on the full canvas enters the local neighbourhood. */
  onEnterLocalView?: (ref: ThreadGraphRef) => void;
  /**
   * Visible neighbour depth in the LOCAL view (Obsidian-style). The layout is
   * computed once at the projection's max depth; this value only drives sigma
   * node/edge reducers, so changing it makes nodes appear or disappear in
   * place — no re-layout, no camera reset. Ignored on the full map.
   */
  displayDepth?: number;
  /**
   * Type visibility filter for the LOCAL view. A node is hidden when its
   * DisplayKind maps to false in this record. Pure in-place sigma reducer:
   * toggling shows or hides nodes without re-layout or camera reset.
   *
   * In full-map (exploration kind-projection) mode, the filtering is already
   * done at the projection level — this prop is not needed there and should
   * be omitted.
   */
  visibleKinds?: Record<DisplayKind, boolean>;
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
  visibleKinds,
  selection,
  focus: _focus,
  onSelectionChange,
  fullMapProjection,
  onEnterLocalView,
  compact = false,
}: EvidenceExplorationProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttrs, SigmaEdgeAttrs>>();
  // Bumped when Sigma actually mounts (after the stage has a non-zero box).
  // The selection reducers depend on this so they re-bind on a delayed mount.
  const [sigmaEpoch, setSigmaEpoch] = useState(0);
  // Keep a stable ref to the callback to avoid re-creating sigma on each render.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onEnterLocalViewRef = useRef(onEnterLocalView);
  onEnterLocalViewRef.current = onEnterLocalView;

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

  // Mount sigma only once the stage has a real box. A 0×0 container throws
  // ("Container has no height") and that uncaught effect error unmounts the
  // whole cockpit — Overview included.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let sigma: Sigma<SigmaNodeAttrs, SigmaEdgeAttrs> | undefined;
    let cancelled = false;

    const bindEvents = (
      instance: Sigma<SigmaNodeAttrs, SigmaEdgeAttrs>,
    ) => {
      instance.on("clickNode", ({ node: nodeKey }) => {
        const attrs = explorationModel.graph.getNodeAttributes(nodeKey);
        if (!attrs) return;
        onSelectionChangeRef.current?.({
          kind: "node",
          ref: attrs.node.ref,
        });
      });

      if (!compact) {
        instance.on("clickEdge", ({ edge: edgeKey }) => {
          const attrs = explorationModel.graph.getEdgeAttributes(edgeKey);
          if (!attrs || isUiOnlyPresentationEdge(attrs.edge)) return;
          onSelectionChangeRef.current?.({
            kind: "edge",
            id: attrs.edgeId,
            occurrence: { key: attrs.occurrenceKey, edge: attrs.edge },
          });
        });
      }

      const ignoreStageUntil = performance.now() + 400;
      instance.on("clickStage", () => {
        if (performance.now() < ignoreStageUntil) return;
        onSelectionChangeRef.current?.(undefined);
      });

      instance.on("doubleClickNode", ({ node: nodeKey, event }) => {
        event.preventSigmaDefault();
        const attrs = explorationModel.graph.getNodeAttributes(nodeKey);
        if (!compact && attrs && onEnterLocalViewRef.current) {
          onEnterLocalViewRef.current(attrs.node.ref);
          return;
        }
        const nodePosition = instance.getNodeDisplayData(nodeKey);
        if (!nodePosition) return;
        instance.getCamera().animate(
          { x: nodePosition.x, y: nodePosition.y, ratio: 0.4 },
          { duration: 300 },
        );
      });
    };

    const tryMount = () => {
      if (cancelled || sigma) return;
      if (container.clientHeight < 1 || container.clientWidth < 1) return;
      try {
        sigma = new Sigma(
          explorationModel.graph,
          container,
          {
            renderLabels: true,
            labelFont: "Inter, -apple-system, Segoe UI, Helvetica, sans-serif",
            labelSize: 11,
            labelColor: { attribute: "color" },
            defaultNodeColor: explorationModel.tokens.muted,
            defaultEdgeColor: explorationModel.tokens.lineStrong,
            defaultEdgeType: "arrow",
            enableEdgeEvents: !compact,
            minCameraRatio: 0.3,
            maxCameraRatio: 6,
            labelRenderedSizeThreshold: compact ? 0 : 10,
            labelGridCellSize: compact ? 10 : 100,
            labelDensity: compact ? 1 : 0.07,
            stagePadding: 30,
          },
        );
      } catch {
        // Layout still unresolved (or Sigma rejected a degenerate box). Wait
        // for the next resize instead of throwing through React.
        return;
      }
      sigmaRef.current = sigma;
      bindEvents(sigma);
      setSigmaEpoch((epoch) => epoch + 1);
    };

    tryMount();
    const observer = new ResizeObserver(() => {
      if (!sigma) {
        tryMount();
        return;
      }
      sigma.refresh();
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      sigma?.kill();
      sigmaRef.current = undefined;
    };
  }, [explorationModel, compact]);

  // Highlight selected node/edge + apply the visible-depth and type display
  // filters. Both are pure sigma reducers on the SAME mounted instance:
  // selection, depth, and type changes repaint in place — no re-layout, no
  // camera reset.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const selectedKey = selection?.kind === "node"
      ? `${selection.ref.kind}:${selection.ref.id}`
      : undefined;
    const selectedEdgeOccurrenceKey = selection?.kind === "edge"
      ? selection.occurrence?.key
      : undefined;
    const depths = projection.isFiltered
      ? projection.localDepthByRefKey
      : undefined;
    const hiddenAtDepth = (key: string, attrs: SigmaNodeAttrs): boolean => {
      if (depths && displayDepth !== undefined) {
        if ((depths.get(key) ?? 0) > displayDepth) return true;
      }
      if (visibleKinds !== undefined) {
        if (!isDisplayKindVisible(visibleKinds, attrs.node)) return true;
      }
      return false;
    };

    sigma.setSetting("nodeReducer", (node, data) => {
      if (hiddenAtDepth(node, data as SigmaNodeAttrs)) {
        return { ...data, hidden: true };
      }
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
    sigma.setSetting("edgeReducer", (_edge, data) => {
      const attrs = data as SigmaEdgeAttrs;
      const selected = selectedEdgeOccurrenceKey !== undefined &&
        attrs.memberOccurrenceKeys.includes(selectedEdgeOccurrenceKey);
      const memberDisclosure = attrs.memberEdges.length > 1
        ? `Shared route with ${attrs.memberEdges.length} recorded assertions; inspect each assertion in the accessible evidence table.`
        : undefined;
      return selected
        ? {
          ...data,
          highlighted: true,
          color: explorationModel.tokens.blue,
          size: (data.size ?? 1.5) * 1.8,
          label: memberDisclosure ?? data.label,
        }
        : {
          ...data,
          highlighted: false,
          label: memberDisclosure ?? data.label,
        };
    });
    sigma.refresh();
  }, [
    selection,
    explorationModel,
    displayDepth,
    visibleKinds,
    projection,
    sigmaEpoch,
  ]);

  // Truthful legend counters: when the visible-depth or type filter hides nodes,
  // the TYPES, OUTILS and COMPOSANTES counts must reflect what is on screen,
  // not the computed max-depth neighbourhood.
  const { legend, systemLegend, kindLegend } = useMemo(() => {
    const depths = projection.isFiltered
      ? projection.localDepthByRefKey
      : undefined;
    const filtersActive = (depths && displayDepth !== undefined) ||
      visibleKinds !== undefined;
    const isVisible = (key: string, attrs: SigmaNodeAttrs): boolean => {
      if (depths && displayDepth !== undefined) {
        if ((depths.get(key) ?? 0) > displayDepth) return false;
      }
      if (visibleKinds !== undefined) {
        if (!isDisplayKindVisible(visibleKinds, attrs.node)) return false;
      }
      return true;
    };
    if (!filtersActive) {
      // Compute kindLegend from all visible nodes in the full projection.
      const kindCounts = new Map<DisplayKind, number>();
      const kindColors = new Map<DisplayKind, Map<string, number>>();
      explorationModel.graph.forEachNode((_key, attrs) => {
        const dk = displayKindOf(attrs.node);
        kindCounts.set(dk, (kindCounts.get(dk) ?? 0) + 1);
        const cMap = kindColors.get(dk) ?? new Map<string, number>();
        cMap.set(attrs.color, (cMap.get(attrs.color) ?? 0) + 1);
        kindColors.set(dk, cMap);
      });
      const kl = ([...kindCounts.entries()] as [DisplayKind, number][])
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => ({
          kind,
          label: DISPLAY_KIND_LABELS[kind],
          count,
          color: dominantColor(
            kindColors.get(kind),
            explorationModel.tokens.muted,
          ),
        }));
      return {
        legend: explorationModel.legend,
        systemLegend: explorationModel.systemLegend,
        kindLegend: kl,
      };
    }
    const systemCounts = new Map<string, number>();
    const visibleSystemsByFamily = new Map<string, Set<string>>();
    const componentCounts = new Map<number, number>();
    const kindCounts = new Map<DisplayKind, number>();
    const kindColors = new Map<DisplayKind, Map<string, number>>();
    explorationModel.graph.forEachNode((key, attrs) => {
      if (!isVisible(key, attrs)) return;
      const system = evidenceSystemFamily(attrs.node.system);
      systemCounts.set(system, (systemCounts.get(system) ?? 0) + 1);
      const visibleSystems = visibleSystemsByFamily.get(system) ?? new Set();
      visibleSystems.add(attrs.node.system);
      visibleSystemsByFamily.set(system, visibleSystems);
      if (attrs.componentId !== undefined) {
        componentCounts.set(
          attrs.componentId,
          (componentCounts.get(attrs.componentId) ?? 0) + 1,
        );
      }
      const dk = displayKindOf(attrs.node);
      kindCounts.set(dk, (kindCounts.get(dk) ?? 0) + 1);
      const cMap = kindColors.get(dk) ?? new Map<string, number>();
      cMap.set(attrs.color, (cMap.get(attrs.color) ?? 0) + 1);
      kindColors.set(dk, cMap);
    });
    const kl = ([...kindCounts.entries()] as [DisplayKind, number][])
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => ({
        kind,
        label: DISPLAY_KIND_LABELS[kind],
        count,
        color: dominantColor(
          kindColors.get(kind),
          explorationModel.tokens.muted,
        ),
      }));
    return {
      systemLegend: explorationModel.systemLegend
        .map((item) => ({
          ...item,
          systems: [...(visibleSystemsByFamily.get(item.system) ?? [])].sort(),
          count: systemCounts.get(item.system) ?? 0,
        }))
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
      kindLegend: kl,
    };
  }, [explorationModel, displayDepth, visibleKinds, projection]);

  // Sigma's canvas itself is pointer-oriented. The full Exploration view has
  // an equivalent, keyboard-reachable record list below: every visible node
  // and relation can be selected with a native button. Do not expose this in
  // compact Activity previews because they intentionally cannot inspect edges.
  const navigation = useMemo(() => {
    const visibleNodeKeys = new Set<string>();
    const nodes: Array<{ key: string; label: string; ref: ThreadGraphRef }> =
      [];
    const depths = projection.isFiltered
      ? projection.localDepthByRefKey
      : undefined;
    explorationModel.graph.forEachNode((key, attrs) => {
      if (
        depths && displayDepth !== undefined &&
        (depths.get(key) ?? 0) > displayDepth
      ) return;
      if (
        visibleKinds !== undefined &&
        !isDisplayKindVisible(visibleKinds, attrs.node)
      ) return;
      visibleNodeKeys.add(key);
      nodes.push({ key, label: attrs.label, ref: attrs.node.ref });
    });
    const nodeLabelByKey = new Map(nodes.map((node) => [node.key, node.label]));
    // Build navigation from the COMPLETE projection, not Sigma's drawing
    // quotient. A shared canvas route therefore still yields two exact rows
    // and two independent inspector selections.
    const edges = buildExplorationRelationRecords(
      projection.edges,
      visibleNodeKeys,
      nodeLabelByKey,
    );
    return { nodes, edges };
  }, [explorationModel, displayDepth, visibleKinds, projection]);

  const minimap = useMemo(() => {
    if (compact || !fullMapProjection || !projection.isFiltered) {
      return undefined;
    }
    const fullMapModel = buildExplorationModel(
      evidenceModel,
      fullMapProjection,
      explorationModel.tokens,
    );
    const localRefKeys = new Set(
      projection.nodes.map((node) => `${node.ref.kind}:${node.ref.id}`),
    );
    return buildEvidenceMinimapView(fullMapModel, localRefKeys);
  }, [
    compact,
    evidenceModel,
    explorationModel.tokens,
    fullMapProjection,
    projection,
  ]);

  return (
    <div className="evidence-exploration relative flex min-h-[540px] overflow-hidden rounded-lg border border-border bg-card max-[720px]:flex-col">
      {!compact && (
        <aside
          className="flex w-[208px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-muted/30 px-2.5 py-3 text-[11.5px] max-[720px]:w-full max-[720px]:flex-none max-[720px]:flex-row max-[720px]:flex-wrap max-[720px]:border-r-0 max-[720px]:border-b"
          aria-label="Evidence legend"
        >
          {systemLegend.length > 0 && (
            <div className="flex min-w-[10rem] flex-col">
              <p className={legendTitleClass}>Tools</p>
              {systemLegend.map((item) => (
                <span
                  key={item.system}
                  className={legendRowClass}
                  aria-label={`${item.label} — ${item.count} visible items — recorded as ${
                    item.systems.join(", ")
                  }`}
                  title={`Recorded systems: ${item.systems.join(", ")}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-[7px] shrink-0 rounded-[2px]"
                      style={{ background: item.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className={legendCountClass}>{item.count}</span>
                </span>
              ))}
            </div>
          )}
          {kindLegend.length > 0 && (
            <div className="flex min-w-[10rem] flex-col">
              <p className={legendTitleClass}>Types</p>
              {kindLegend.map((item) => (
                <span
                  key={item.kind}
                  className={legendRowClass}
                  aria-label={`${item.label} — ${item.count} visible items`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-[7px] shrink-0 rounded-[2px]"
                      style={{ background: item.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className={legendCountClass}>{item.count}</span>
                </span>
              ))}
            </div>
          )}
          {legend.length > 0 && (
            <div className="flex min-w-[10rem] flex-col">
              <p className={legendTitleClass}>Components</p>
              {legend.map((item) => (
                <LegendChip
                  key={item.componentIds[0]}
                  item={item}
                  sigma={sigmaRef}
                  graph={explorationModel.graph}
                />
              ))}
            </div>
          )}
          <ExplorationKeyboardNavigation
            nodes={navigation.nodes}
            edges={navigation.edges}
            onSelectionChange={onSelectionChange}
          />
        </aside>
      )}
      <div className="evidence-exploration-stage-wrap">
        {!compact && (
          <div className="absolute inset-x-0 top-0 z-[1] flex items-center justify-between border-b border-border bg-card px-3 py-2">
            <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-muted-foreground">
              EVIDENCE GRAPH · DAGRE LR
            </span>
            <span className="font-mono text-[9.5px] text-muted-foreground/70">
              origins left · verdicts right
            </span>
          </div>
        )}
        <div
          className="evidence-exploration-stage"
          ref={containerRef}
          aria-label={compact
            ? "Evidence preview graph — select a node with the pointer; inspect relations in Evidence"
            : "Evidence exploration graph — sigma renderer"}
          role={compact ? undefined : "application"}
          tabIndex={compact ? undefined : 0}
          onKeyDown={(event) => {
            // Sigma owns its canvas; provide a predictable keyboard escape
            // route back to the surrounding inspection controls.
            if (!compact && event.key === "Escape") {
              onSelectionChange?.(undefined);
            }
          }}
        />
        {minimap && (
          <EvidenceMinimap
            view={minimap}
            onOpenFullMap={() => onSelectionChange?.(undefined)}
          />
        )}
        {!compact && (
          <div className="absolute inset-x-0 bottom-0 z-[1] flex items-center justify-between border-t border-border bg-card px-3 py-1.5">
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {navigation.nodes.length} nodes shown
              {projection.isFiltered && displayDepth !== undefined &&
                ` · depth ${displayDepth}`}
            </span>
            {projection.isFiltered && (
              <button
                type="button"
                className="font-mono text-[10px] font-medium text-brand hover:underline"
                onClick={() => onSelectionChange?.(undefined)}
              >
                Full map →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceMinimap({
  view,
  onOpenFullMap,
}: {
  view: EvidenceMinimapView;
  onOpenFullMap: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="evidence-minimap absolute top-2.5 right-2.5 z-[2] w-[132px] cursor-pointer overflow-hidden rounded-md border border-border bg-card/90 p-0 text-left shadow-sm hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      aria-label={`Full map · ${view.nodeCount} items · ${view.edgeCount} relations. Select to leave the local view.`}
      onClick={onOpenFullMap}
    >
      <span className="flex items-center justify-between px-[7px] pb-0.5 pt-[3px] font-mono text-[7.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <span>Full map</span>
        <span>
          {view.nodeCount} n · {view.edgeCount} e
        </span>
      </span>
      <svg
        viewBox={`0 0 ${view.width} ${view.height}`}
        className="block w-full"
        aria-hidden="true"
      >
        {view.localBounds && (
          <rect
            x={view.localBounds.x}
            y={view.localBounds.y}
            width={view.localBounds.width}
            height={view.localBounds.height}
            fill="color-mix(in oklab, var(--color-brand) 8%, transparent)"
            stroke="var(--color-brand)"
            strokeWidth="1"
            strokeDasharray="3 2"
            rx="2"
          />
        )}
        {view.nodes.map((node) => (
          <circle
            key={node.key}
            cx={node.x}
            cy={node.y}
            r="2"
            fill={node.color}
          />
        ))}
      </svg>
    </button>
  );
}

function ExplorationKeyboardNavigation({
  nodes,
  edges,
  onSelectionChange,
}: {
  nodes: readonly { key: string; label: string; ref: ThreadGraphRef }[];
  edges: readonly {
    key: string;
    occurrenceKey: string;
    label: string;
    accessibleLabel: string;
    edgeId: string;
    edge: SigmaEdgeAttrs["edge"];
    visualRouteLabel?: string;
  }[];
  onSelectionChange: EvidenceExplorationProps["onSelectionChange"];
}): JSX.Element {
  return (
    <details className="mt-1 w-full max-[720px]:basis-full">
      <summary className="cursor-pointer font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Accessible evidence table ({nodes.length} items · {edges.length}{" "}
        relations)
      </summary>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Use Tab to reach a record, then press Enter to inspect it. A shared
        canvas route is listed here once per exact recorded assertion.
      </p>
      <div className="mt-1.5 max-h-[420px] overflow-x-auto overflow-y-auto rounded-md border border-border">
        <table className="w-full text-[11.5px]">
          <caption className="sr-only">
            Visible evidence items and relations
          </caption>
          <thead className="font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-1.5 text-left">
                Type
              </th>
              <th scope="col" className="px-2 py-1.5 text-left">
                Record
              </th>
              <th scope="col" className="px-2 py-1.5 text-left">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr
                key={node.key}
                className="border-b border-border last:border-0"
              >
                <td className="px-2 py-1.5">Item</td>
                <td className="px-2 py-1.5">{node.label}</td>
                <td className="px-2 py-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Inspect fact: ${node.label}`}
                    onClick={() =>
                      onSelectionChange?.({ kind: "node", ref: node.ref })}
                  >
                    Inspect
                  </Button>
                </td>
              </tr>
            ))}
            {edges.map((edge) => (
              <tr
                key={edge.key}
                className="border-b border-border last:border-0"
              >
                <td className="px-2 py-1.5">Relation</td>
                <td className="px-2 py-1.5">
                  <span aria-hidden="true">{edge.label}</span>
                  {edge.visualRouteLabel && (
                    <span aria-hidden="true">
                      {` · ${edge.visualRouteLabel}`}
                    </span>
                  )}
                  <span className="sr-only">{edge.accessibleLabel}</span>
                </td>
                <td className="px-2 py-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Inspect relation: ${edge.accessibleLabel}`}
                    onClick={() =>
                      onSelectionChange?.({
                        kind: "edge",
                        id: edge.edgeId,
                        occurrence: {
                          key: edge.occurrenceKey,
                          edge: edge.edge,
                        },
                      })}
                  >
                    Inspect
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
      className={`${legendRowClass} w-full text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
      onClick={handleClick}
      title={`Focus the camera on component "${item.name}"`}
      aria-label={`${item.name} — ${item.visibleNodeCount} facts`}
    >
      {
        /* No color dot: node colors encode the producing TOOL (see the Tools
          key above); painting component chips with a second palette made the
          two mappings contradict each other on screen. */
      }
      <span className="truncate">{item.name}</span>
      <span className={legendCountClass}>{item.visibleNodeCount}</span>
    </button>
  );
}
