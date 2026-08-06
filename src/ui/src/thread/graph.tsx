/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import {
  canvasComponentRowWidth,
  graphViewport,
  type GraphViewportPoint,
} from "./graph-viewport.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
} from "./types.ts";

const NODE_WIDTH = 216;
const NODE_HEIGHT = 82;
const COLUMN_GAP = 112;
const ROW_GAP = 28;
const COMPONENT_GAP = 52;
const COMPONENT_HEADER = 34;
const COMPONENT_PADDING_X = 24;
const COMPONENT_PADDING_BOTTOM = 24;
const VIEWBOX_PADDING = 12;
/** Prevents independent evidence islands from producing an endless page. */
const MAX_COMPONENT_ROW_WIDTH = 1320;

export type ThreadGraphSelection =
  | { kind: "node"; ref: ThreadGraphRef }
  | { kind: "edge"; id: string };

export interface ThreadGraphProps {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  /** Controlled graph selection. Node selections use canonical graph refs. */
  selection?: ThreadGraphSelection;
  /** Optional impact origin. Defaults to the selected node. */
  focus?: ThreadGraphRef;
  ariaLabel?: string;
  emptyLabel?: string;
  /** Controlled density. Omit it to let the graph own its compact/all toggle. */
  showSupporting?: boolean;
  /** Hides the density explanation in compact embedded graph projections. */
  showDensityControl?: boolean;
  /**
   * Embedded graphs tell the story of one feed event. Canvas graphs are a
   * dedicated inspection surface with explicit fit and zoom controls.
   */
  presentation?: "embedded" | "context" | "canvas";
  /** A focused canvas may start one readable step closer than the overview. */
  initialZoom?: number;
  /** Staggers node and edge entry when a live lineage first appears. */
  animate?: boolean;
  onSelectionChange?: (selection: ThreadGraphSelection | undefined) => void;
  onShowSupportingChange?: (showSupporting: boolean) => void;
  /** Opens the existing Workbench inspector when a node exposes a UI ref. */
  onInspect?: (selection: ThreadRef, node: ThreadGraphNode) => void;
  /**
   * Optional component frame title resolver. Called with all visible nodes
   * inside each layout component and the component index.
   *
   * When omitted the canvas falls back to "LINKED EVIDENCE" (single component)
   * or "EVIDENCE COMPONENT NN" (multiple components).
   *
   * Pass `makeEvidenceComponentLabeler(model, ...)` from evidence-canvas-model
   * to get named frames derived from the full-graph component detection.
   */
  componentLabeler?: (nodes: ThreadGraphNode[], index: number) => string;
}

export interface PositionedThreadGraphNode {
  node: ThreadGraphNode;
  x: number;
  y: number;
  component: number;
  layer: number;
  cyclic: boolean;
}

export interface PositionedThreadGraphEdge {
  edge: ThreadGraphEdge;
  source: PositionedThreadGraphNode;
  target: PositionedThreadGraphNode;
  path: string;
  labelX: number;
  labelY: number;
}

export interface ThreadGraphComponentLayout {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeCount: number;
}

export interface ThreadGraphLayout {
  width: number;
  height: number;
  nodes: PositionedThreadGraphNode[];
  edges: PositionedThreadGraphEdge[];
  components: ThreadGraphComponentLayout[];
  unresolvedEdgeIds: string[];
}

export interface ThreadGraphLayoutOptions {
  maxComponentRowWidth?: number;
  /** Wraps crowded causal layers into visual columns without changing layer. */
  maxRowsPerLayer?: number;
}

/**
 * Native, deterministic projection of the canonical thread graph.
 *
 * Weakly disconnected components receive separate frames. Strongly connected
 * nodes share a layer instead of being presented as a false causal sequence.
 */
export function layoutThreadGraph(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
  options: ThreadGraphLayoutOptions = {},
): ThreadGraphLayout {
  if (nodes.length === 0) {
    return {
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
      components: [],
      unresolvedEdgeIds: edges.map((edge) => edge.id).sort(),
    };
  }

  const orderedNodes = [...nodes].sort(compareGraphNodes);
  const nodeByRef = new Map<string, ThreadGraphNode>();
  for (const node of orderedNodes) {
    if (!nodeByRef.has(refKey(node.ref))) nodeByRef.set(refKey(node.ref), node);
  }

  const resolvedEdges = edges.filter((edge) =>
    nodeByRef.has(refKey(edge.from)) && nodeByRef.has(refKey(edge.to))
  ).sort(compareGraphEdges);
  const unresolvedEdgeIds = edges
    .filter((edge) =>
      !nodeByRef.has(refKey(edge.from)) || !nodeByRef.has(refKey(edge.to))
    )
    .map((edge) => edge.id)
    .sort();

  const adjacency = makeAdjacency(orderedNodes, resolvedEdges, false);
  const undirected = makeAdjacency(orderedNodes, resolvedEdges, true);
  const components = weakComponents(orderedNodes, undirected);
  const stronglyConnected = strongComponents(orderedNodes, adjacency);
  const strongComponentByRef = new Map<string, number>();
  stronglyConnected.forEach((component, componentIndex) => {
    for (const key of component) strongComponentByRef.set(key, componentIndex);
  });
  const cyclicRefs = new Set(
    stronglyConnected
      .filter((component) =>
        component.length > 1 || hasSelfLoop(component[0] ?? "", adjacency)
      )
      .flat(),
  );

  const positioned: PositionedThreadGraphNode[] = [];
  const componentLayouts: ThreadGraphComponentLayout[] = [];
  const pendingComponents = components.map((componentRefs, componentIndex) => {
    const componentSet = new Set(componentRefs);
    const layerByRef = componentLayers(
      componentRefs,
      componentSet,
      resolvedEdges,
      stronglyConnected,
      strongComponentByRef,
    );
    const nodesByLayer = new Map<number, ThreadGraphNode[]>();
    for (const key of componentRefs) {
      const node = nodeByRef.get(key);
      if (!node) continue;
      const layer = layerByRef.get(key) ?? 0;
      const bucket = nodesByLayer.get(layer) ?? [];
      bucket.push(node);
      nodesByLayer.set(layer, bucket);
    }
    for (const bucket of nodesByLayer.values()) bucket.sort(compareGraphNodes);

    const maxLayer = Math.max(0, ...nodesByLayer.keys());
    const nativeMaxRows = Math.max(
      1,
      ...[...nodesByLayer.values()].map((list) => list.length),
    );
    const rowsPerVisualColumn = Math.max(
      1,
      Math.min(
        nativeMaxRows,
        Math.floor(options.maxRowsPerLayer ?? nativeMaxRows),
      ),
    );
    const visualColumnByLayer = new Map<number, number>();
    let visualColumnCount = 0;
    for (let layer = 0; layer <= maxLayer; layer += 1) {
      visualColumnByLayer.set(layer, visualColumnCount);
      const nodeCount = nodesByLayer.get(layer)?.length ?? 0;
      visualColumnCount += Math.max(
        1,
        Math.ceil(nodeCount / rowsPerVisualColumn),
      );
    }
    const maxRows = Math.max(
      1,
      ...[...nodesByLayer.values()].map((list) =>
        Math.min(list.length, rowsPerVisualColumn)
      ),
    );
    const componentWidth = (COMPONENT_PADDING_X * 2) +
      (visualColumnCount * NODE_WIDTH) +
      ((visualColumnCount - 1) * COLUMN_GAP);
    const componentHeight = COMPONENT_HEADER + COMPONENT_PADDING_BOTTOM +
      (maxRows * NODE_HEIGHT) + ((maxRows - 1) * ROW_GAP);

    return {
      componentIndex,
      componentRefs,
      nodesByLayer,
      componentWidth,
      componentHeight,
      rowsPerVisualColumn,
      visualColumnByLayer,
    };
  });

  let nextX = VIEWBOX_PADDING;
  let nextY = VIEWBOX_PADDING;
  let rowHeight = 0;
  let widestRight = VIEWBOX_PADDING;
  const maxComponentRowWidth = options.maxComponentRowWidth ??
    MAX_COMPONENT_ROW_WIDTH;

  pendingComponents.forEach((pending) => {
    if (
      nextX > VIEWBOX_PADDING &&
      nextX + pending.componentWidth + VIEWBOX_PADDING >
        maxComponentRowWidth
    ) {
      nextX = VIEWBOX_PADDING;
      nextY += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }

    const componentX = nextX;
    const componentY = nextY;
    componentLayouts.push({
      id: pending.componentIndex,
      x: componentX,
      y: componentY,
      width: pending.componentWidth,
      height: pending.componentHeight,
      nodeCount: pending.componentRefs.length,
    });

    for (
      const [layer, layerNodes] of [...pending.nodesByLayer.entries()].sort(
        ([left], [right]) => left - right,
      )
    ) {
      layerNodes.forEach((node, row) => {
        const visualColumn = (pending.visualColumnByLayer.get(layer) ?? layer) +
          Math.floor(row / pending.rowsPerVisualColumn);
        const visualRow = row % pending.rowsPerVisualColumn;
        positioned.push({
          node,
          x: componentX + COMPONENT_PADDING_X +
            (visualColumn * (NODE_WIDTH + COLUMN_GAP)),
          y: componentY + COMPONENT_HEADER +
            (visualRow * (NODE_HEIGHT + ROW_GAP)),
          component: pending.componentIndex,
          layer,
          cyclic: cyclicRefs.has(refKey(node.ref)),
        });
      });
    }

    rowHeight = Math.max(rowHeight, pending.componentHeight);
    widestRight = Math.max(widestRight, componentX + pending.componentWidth);
    nextX += pending.componentWidth + COMPONENT_GAP;
  });

  const positionedByRef = new Map(
    positioned.map((item) => [refKey(item.node.ref), item] as const),
  );
  const routeCounts = new Map<string, number>();
  for (const edge of resolvedEdges) {
    const route = `${refKey(edge.from)}->${refKey(edge.to)}`;
    routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
  }
  const routeIndexes = new Map<string, number>();
  const positionedEdges = resolvedEdges.flatMap((edge) => {
    const source = positionedByRef.get(refKey(edge.from));
    const target = positionedByRef.get(refKey(edge.to));
    if (!source || !target) return [];
    const route = `${refKey(edge.from)}->${refKey(edge.to)}`;
    const routeIndex = routeIndexes.get(route) ?? 0;
    routeIndexes.set(route, routeIndex + 1);
    const routeCount = routeCounts.get(route) ?? 1;
    const parallelOffset = (routeIndex - ((routeCount - 1) / 2)) * 16;
    const geometry = edgeGeometry(source, target, parallelOffset);
    return [{ edge, source, target, ...geometry }];
  });

  return {
    width: widestRight + VIEWBOX_PADDING,
    height: nextY + rowHeight + VIEWBOX_PADDING,
    nodes: positioned,
    edges: positionedEdges,
    components: componentLayouts,
    unresolvedEdgeIds,
  };
}

export function ThreadGraph({
  nodes,
  edges,
  selection,
  focus,
  ariaLabel = "Engineering traceability graph",
  emptyLabel = "No linked engineering evidence is available.",
  showSupporting,
  showDensityControl = true,
  presentation = "embedded",
  initialZoom = 1,
  animate = false,
  onSelectionChange,
  onShowSupportingChange,
  onInspect,
  componentLabeler,
}: ThreadGraphProps): JSX.Element {
  const markerPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const nodeElements = useRef(new Map<string, SVGGElement>());
  const edgeElements = useRef(new Map<string, SVGGElement>());
  const viewportElement = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    center: GraphViewportPoint;
    scaleX: number;
    scaleY: number;
  }>();
  const [keyboardNode, setKeyboardNode] = useState<string>();
  const [keyboardEdge, setKeyboardEdge] = useState<string>();
  const [locallyShowingSupporting, setLocallyShowingSupporting] = useState(
    false,
  );
  const [zoom, setZoom] = useState(() => normaliseZoom(initialZoom));
  const [cameraTarget, setCameraTarget] = useState<ThreadGraphRef>();
  const [cameraCenter, setCameraCenter] = useState<GraphViewportPoint>();
  const [frameAspectRatio, setFrameAspectRatio] = useState(16 / 9);
  const [panning, setPanning] = useState(false);
  const focusedRef = focus ??
    (selection?.kind === "node" ? selection.ref : undefined);
  const showingSupporting = showSupporting ?? locallyShowingSupporting;
  const projection = useMemo(
    () =>
      essentialGraphProjection(
        nodes,
        edges,
        showingSupporting,
        focusedRef,
        selection,
      ),
    [nodes, edges, showingSupporting, focusedRef, selection],
  );
  const layout = useMemo(
    () =>
      layoutThreadGraph(projection.nodes, projection.edges, {
        maxComponentRowWidth: presentation === "canvas"
          ? canvasComponentRowWidth(frameAspectRatio)
          : MAX_COMPONENT_ROW_WIDTH,
        maxRowsPerLayer: presentation === "context"
          ? 2
          : presentation === "canvas"
          ? 6
          : undefined,
      }),
    [projection, presentation, frameAspectRatio],
  );
  const impact = useMemo(
    () => impactContext(layout.nodes, layout.edges, focusedRef),
    [layout, focusedRef],
  );
  const selectedNodeRef = selection?.kind === "node"
    ? selection.ref
    : focusedRef;
  const selectedNodeKey = selection?.kind === "node"
    ? refKey(selection.ref)
    : undefined;
  const selectedNodeVisible = selectedNodeKey
    ? layout.nodes.some((item) => refKey(item.node.ref) === selectedNodeKey)
    : false;
  const selectedEdgeId = selection?.kind === "edge" ? selection.id : undefined;
  const selectedEdgeVisible = selectedEdgeId
    ? layout.edges.some((item) => item.edge.id === selectedEdgeId)
    : false;
  const viewport = useMemo(
    () =>
      graphViewport(
        layout,
        zoom,
        cameraTarget ??
          (presentation === "canvas" ? selectedNodeRef : undefined),
        presentation === "canvas"
          ? { aspectRatio: frameAspectRatio, center: cameraCenter }
          : undefined,
      ),
    [
      layout,
      zoom,
      cameraTarget,
      presentation,
      selectedNodeRef,
      frameAspectRatio,
      cameraCenter,
    ],
  );

  useEffect(() => {
    setZoom(normaliseZoom(initialZoom));
    setCameraTarget(undefined);
    setCameraCenter(undefined);
  }, [layout.width, layout.height, showingSupporting, initialZoom]);

  useEffect(() => {
    const element = viewportElement.current;
    if (presentation !== "canvas" || !element) return;
    const updateRatio = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setFrameAspectRatio(bounds.width / bounds.height);
    };
    updateRatio();
    if (typeof ResizeObserver === "undefined") {
      globalThis.addEventListener("resize", updateRatio);
      return () => globalThis.removeEventListener("resize", updateRatio);
    }
    const observer = new ResizeObserver(updateRatio);
    observer.observe(element);
    return () => observer.disconnect();
  }, [presentation]);

  if (layout.nodes.length === 0) {
    return (
      <div class="thread-graph-empty" role="status">
        {emptyLabel}
      </div>
    );
  }

  const selectNode = (item: PositionedThreadGraphNode) => {
    const next: ThreadGraphSelection = { kind: "node", ref: item.node.ref };
    setKeyboardNode(refKey(item.node.ref));
    if (presentation === "canvas") {
      setCameraCenter(undefined);
      setCameraTarget(item.node.ref);
    }
    onSelectionChange?.(next);
    if (item.node.selection) onInspect?.(item.node.selection, item.node);
  };
  const selectEdge = (item: PositionedThreadGraphEdge) => {
    setKeyboardEdge(item.edge.id);
    if (presentation === "canvas") {
      setCameraTarget(undefined);
      setCameraCenter(edgeCenter(item));
    }
    onSelectionChange?.({ kind: "edge", id: item.edge.id });
  };
  const moveNodeFocus = (
    item: PositionedThreadGraphNode,
    direction: "left" | "right" | "up" | "down" | "first" | "last",
  ) => {
    const target = directionalNode(layout.nodes, item, direction);
    if (!target) return;
    const key = refKey(target.node.ref);
    setKeyboardNode(key);
    if (presentation === "canvas") {
      setCameraCenter(undefined);
      setCameraTarget(target.node.ref);
    }
    nodeElements.current.get(key)?.focus();
  };
  const moveEdgeFocus = (
    item: PositionedThreadGraphEdge,
    direction: "previous" | "next" | "first" | "last",
  ) => {
    const currentIndex = layout.edges.findIndex((candidate) =>
      candidate.edge.id === item.edge.id
    );
    const targetIndex = direction === "first"
      ? 0
      : direction === "last"
      ? layout.edges.length - 1
      : direction === "previous"
      ? Math.max(0, currentIndex - 1)
      : Math.min(layout.edges.length - 1, currentIndex + 1);
    const target = layout.edges[targetIndex];
    if (!target) return;
    setKeyboardEdge(target.edge.id);
    if (presentation === "canvas") {
      setCameraTarget(undefined);
      setCameraCenter(edgeCenter(target));
    }
    edgeElements.current.get(target.edge.id)?.focus();
  };
  const changeZoom = (direction: "in" | "out") => {
    setZoom((current) => {
      const levels = [1, 1.5, 2.25, 3.25, 4.5];
      const currentIndex = levels.findIndex((level) => level >= current);
      const index = currentIndex === -1 ? levels.length - 1 : currentIndex;
      const nextIndex = direction === "in"
        ? Math.min(levels.length - 1, index + 1)
        : Math.max(0, index - 1);
      return levels[nextIndex] ?? 1;
    });
  };
  const fitGraph = () => {
    setZoom(1);
    setCameraTarget(undefined);
    setCameraCenter(undefined);
  };
  const centreSelection = () => {
    if (selectedNodeRef) {
      setCameraCenter(undefined);
      setCameraTarget(selectedNodeRef);
    }
  };
  const finishPanning = () => {
    dragState.current = undefined;
    setPanning(false);
  };

  return (
    <figure
      class="thread-graph"
      data-focused={focusedRef ? "true" : "false"}
      data-components={layout.components.length}
      data-density={showingSupporting ? "complete" : "essential"}
      data-animate={animate ? "true" : "false"}
      data-presentation={presentation}
      data-panning={panning ? "true" : "false"}
    >
      {presentation === "canvas" && (
        <div class="thread-graph-controls" aria-label="Graph view controls">
          <span aria-live="polite">
            {Math.round(viewport.zoom * 100)}% · {layout.nodes.length}{" "}
            recorded facts
          </span>
          <div role="group" aria-label="Zoom graph">
            <button
              type="button"
              onClick={() =>
                changeZoom("out")}
              disabled={viewport.zoom <= 1}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button type="button" onClick={fitGraph}>
              Fit overview
            </button>
            <button
              type="button"
              onClick={centreSelection}
              disabled={!selectedNodeRef}
            >
              Centre selection
            </button>
            <button
              type="button"
              onClick={() =>
                changeZoom("in")}
              disabled={viewport.zoom >= 4.5}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      )}
      {showDensityControl && (projection.hiddenNodeCount > 0 ||
        (showingSupporting && projection.supportingCount > 0)) &&
        (
          <div class="thread-graph-density">
            <span>
              {showingSupporting
                ? `All ${nodes.length} evidence nodes are visible.`
                : `${projection.hiddenNodeCount} supporting node${
                  projection.hiddenNodeCount === 1 ? " is" : "s are"
                } condensed from the essential thread.`}
            </span>
            <button
              type="button"
              class="thread-graph-density-toggle"
              aria-pressed={showingSupporting}
              onClick={() => {
                const next = !showingSupporting;
                if (showSupporting === undefined) {
                  setLocallyShowingSupporting(next);
                }
                onShowSupportingChange?.(next);
              }}
            >
              {showingSupporting
                ? "Show essential thread"
                : "Show all evidence"}
            </button>
          </div>
        )}
      <div class="thread-graph-viewport" ref={viewportElement}>
        <svg
          class="thread-graph-canvas"
          viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={ariaLabel}
          onPointerDown={(event) => {
            if (presentation !== "canvas" || event.button !== 0) return;
            const target = event.target as Element;
            if (target.closest(".thread-graph-node, .thread-graph-edge")) {
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragState.current = {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              center: {
                x: viewport.x + (viewport.width / 2),
                y: viewport.y + (viewport.height / 2),
              },
              scaleX: viewport.width / bounds.width,
              scaleY: viewport.height / bounds.height,
            };
            setPanning(true);
          }}
          onPointerMove={(event) => {
            const drag = dragState.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            setCameraTarget(undefined);
            setCameraCenter({
              x: drag.center.x -
                ((event.clientX - drag.clientX) * drag.scaleX),
              y: drag.center.y -
                ((event.clientY - drag.clientY) * drag.scaleY),
            });
          }}
          onPointerUp={(event) => {
            if (dragState.current?.pointerId !== event.pointerId) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            finishPanning();
          }}
          onPointerCancel={finishPanning}
          onLostPointerCapture={finishPanning}
        >
          <desc>
            {`${layout.nodes.length} evidence nodes and ${layout.edges.length} explicit relations in ${layout.components.length} connected component${
              layout.components.length === 1 ? "" : "s"
            }. ${
              presentation === "canvas" ? "Drag empty canvas space to pan." : ""
            }`}
          </desc>
          <defs>
            <marker
              id={`${markerPrefix}-arrow`}
              class="thread-graph-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path fill="context-stroke" d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>

          {layout.components.map((component) => {
            const componentNodes = layout.nodes
              .filter((item) => item.component === component.id)
              .map((item) => item.node);
            const label = componentLabeler
              ? componentLabeler(componentNodes, component.id)
              : layout.components.length > 1
              ? `EVIDENCE COMPONENT ${
                String(component.id + 1).padStart(2, "0")
              }`
              : "LINKED EVIDENCE";
            return (
              <g
                key={component.id}
                class="thread-graph-component"
                data-disconnected={layout.components.length > 1
                  ? "true"
                  : "false"}
              >
                <rect
                  class="thread-graph-component-boundary"
                  x={component.x}
                  y={component.y}
                  width={component.width}
                  height={component.height}
                  rx="12"
                />
                <text
                  class="thread-graph-component-label"
                  x={component.x + COMPONENT_PADDING_X}
                  y={component.y + 21}
                >
                  {label}
                </text>
              </g>
            );
          })}

          <g class="thread-graph-edges" aria-label="Explicit relations">
            {layout.edges.map((item, index) => {
              const selected = selection?.kind === "edge" &&
                selection.id === item.edge.id;
              const state = edgeImpactState(item, impact, focusedRef);
              const isKeyboardEdge = keyboardEdge
                ? keyboardEdge === item.edge.id
                : selectedEdgeVisible
                ? selected
                : index === 0;
              const attestation = item.edge.attestation?.status ?? "none";
              return (
                <g
                  key={item.edge.id}
                  ref={(element) => {
                    if (element) {
                      edgeElements.current.set(item.edge.id, element);
                    } else {
                      edgeElements.current.delete(item.edge.id);
                    }
                  }}
                  class="thread-graph-edge"
                  role="button"
                  tabindex={isKeyboardEdge ? 0 : -1}
                  aria-label={`${
                    relationLabel(item.edge.relation)
                  }: ${item.source.node.label} to ${item.target.node.label}. ${item.edge.rationale}${
                    attestationDescription(attestation)
                  }`}
                  aria-pressed={selected}
                  data-relation={item.edge.relation}
                  data-origin={item.edge.origin}
                  data-attestation={attestation}
                  data-impact={state}
                  data-selected={selected ? "true" : "false"}
                  style={animate
                    ? { animationDelay: `${Math.min(index * 55, 440)}ms` }
                    : undefined}
                  onClick={() => selectEdge(item)}
                  onFocus={() => setKeyboardEdge(item.edge.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectEdge(item);
                    } else if (
                      event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ) {
                      event.preventDefault();
                      moveEdgeFocus(item, "previous");
                    } else if (
                      event.key === "ArrowRight" || event.key === "ArrowDown"
                    ) {
                      event.preventDefault();
                      moveEdgeFocus(item, "next");
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveEdgeFocus(item, "first");
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveEdgeFocus(item, "last");
                    } else if (event.key === "Escape") {
                      onSelectionChange?.(undefined);
                    }
                  }}
                >
                  <title>
                    {`${item.edge.rationale}${
                      attestationDescription(attestation)
                    }`}
                  </title>
                  <path
                    class="thread-graph-edge-line"
                    d={item.path}
                    marker-end={`url(#${markerPrefix}-arrow)`}
                  />
                  <path class="thread-graph-edge-hit" d={item.path} />
                  <text
                    class="thread-graph-edge-label"
                    x={item.labelX}
                    y={item.labelY}
                    text-anchor="middle"
                  >
                    {relationLabel(item.edge.relation)}
                  </text>
                </g>
              );
            })}
          </g>

          <g class="thread-graph-nodes" aria-label="Evidence nodes">
            {layout.nodes.map((item, index) => {
              const key = refKey(item.node.ref);
              const selected = selection?.kind === "node" &&
                refKey(selection.ref) === key;
              const state = nodeImpactState(key, impact, focusedRef);
              const isKeyboardNode = keyboardNode
                ? keyboardNode === key
                : selectedNodeVisible
                ? selected
                : index === 0;
              return (
                <g
                  key={item.node.id}
                  ref={(element) => {
                    if (element) nodeElements.current.set(key, element);
                    else nodeElements.current.delete(key);
                  }}
                  class="thread-graph-node"
                  transform={`translate(${item.x} ${item.y})`}
                  role="button"
                  tabindex={isKeyboardNode ? 0 : -1}
                  aria-label={`${item.node.system}, ${item.node.label}. ${item.node.summary}`}
                  aria-pressed={selected}
                  data-kind={item.node.ref.kind}
                  data-system={item.node.system}
                  data-freshness={item.node.freshness}
                  data-cyclic={item.cyclic ? "true" : "false"}
                  data-impact={state}
                  data-selected={selected ? "true" : "false"}
                  data-inspectable={item.node.selection ? "true" : "false"}
                  style={animate
                    ? {
                      animationDelay: `${Math.min((index + 1) * 70, 560)}ms`,
                    }
                    : undefined}
                  onClick={() => selectNode(item)}
                  onFocus={() => setKeyboardNode(key)}
                  onKeyDown={(event) => {
                    switch (event.key) {
                      case "Enter":
                      case " ":
                        event.preventDefault();
                        selectNode(item);
                        break;
                      case "ArrowLeft":
                        event.preventDefault();
                        moveNodeFocus(item, "left");
                        break;
                      case "ArrowRight":
                        event.preventDefault();
                        moveNodeFocus(item, "right");
                        break;
                      case "ArrowUp":
                        event.preventDefault();
                        moveNodeFocus(item, "up");
                        break;
                      case "ArrowDown":
                        event.preventDefault();
                        moveNodeFocus(item, "down");
                        break;
                      case "Home":
                        event.preventDefault();
                        moveNodeFocus(item, "first");
                        break;
                      case "End":
                        event.preventDefault();
                        moveNodeFocus(item, "last");
                        break;
                      case "Escape":
                        onSelectionChange?.(undefined);
                        break;
                    }
                  }}
                >
                  <title>{item.node.summary}</title>
                  <rect
                    class="thread-graph-node-body"
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx="10"
                  />
                  <circle
                    class="thread-graph-node-state"
                    cx="14"
                    cy="16"
                    r="4"
                  />
                  <text class="thread-graph-node-system" x="25" y="20">
                    {truncate(item.node.system.toUpperCase(), 27)}
                  </text>
                  <text class="thread-graph-node-label" x="14" y="46">
                    {truncate(item.node.label, 31)}
                  </text>
                  <text class="thread-graph-node-summary" x="14" y="66">
                    {truncate(item.node.summary, 38)}
                  </text>
                  <text
                    class="thread-graph-node-kind"
                    x={NODE_WIDTH - 12}
                    y="20"
                    text-anchor="end"
                  >
                    {item.node.ref.kind}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {layout.components.length > 1 && (
        <figcaption class="thread-graph-caption">
          Separate frames are intentional: no canonical relation currently
          connects these evidence components.
        </figcaption>
      )}
      {layout.unresolvedEdgeIds.length > 0 && (
        <p class="thread-graph-notice" role="status">
          {layout.unresolvedEdgeIds.length}{" "}
          relation{layout.unresolvedEdgeIds.length === 1 ? "" : "s"}{" "}
          not drawn because an endpoint is absent from this snapshot.
        </p>
      )}
    </figure>
  );
}

interface EssentialGraphProjection {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  supportingCount: number;
  hiddenNodeCount: number;
}

const SUPPORTING_ARTIFACT_KINDS = new Set([
  "script",
  "mesh",
  "solver-input",
  "evidence",
  "document",
  "other",
]);

/**
 * Keeps the essential reading compact without replacing the canonical graph.
 * Supporting nodes which connect two essential entities stay visible so the
 * condensed view never invents a direct edge or breaks an existing path.
 */
function essentialGraphProjection(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
  showSupporting: boolean,
  focus: ThreadGraphRef | undefined,
  selection: ThreadGraphSelection | undefined,
): EssentialGraphProjection {
  const supportingCount = nodes.filter(isSupportingNode).length;
  if (showSupporting || supportingCount === 0) {
    return {
      nodes,
      edges,
      supportingCount,
      hiddenNodeCount: 0,
    };
  }

  const nodeByKey = new Map(nodes.map((node) => [refKey(node.ref), node]));
  const visible = new Set(
    nodes.filter((node) => !isSupportingNode(node)).map((node) =>
      refKey(node.ref)
    ),
  );
  if (focus) visible.add(refKey(focus));
  if (selection?.kind === "node") visible.add(refKey(selection.ref));
  if (selection?.kind === "edge") {
    const selectedEdge = edges.find((edge) => edge.id === selection.id);
    if (selectedEdge) {
      visible.add(refKey(selectedEdge.from));
      visible.add(refKey(selectedEdge.to));
    }
  }

  const adjacency = makeAdjacency(nodes, edges, true);
  const essentialKeys = [...visible].filter((key) => nodeByKey.has(key)).sort();
  for (let left = 0; left < essentialKeys.length; left += 1) {
    for (let right = left + 1; right < essentialKeys.length; right += 1) {
      const from = essentialKeys[left];
      const to = essentialKeys[right];
      if (!from || !to) continue;
      for (const key of shortestPath(from, to, adjacency)) visible.add(key);
    }
  }

  const projectedNodes = nodes.filter((node) => visible.has(refKey(node.ref)));
  const projectedEdges = edges.filter((edge) =>
    visible.has(refKey(edge.from)) && visible.has(refKey(edge.to))
  );
  return {
    nodes: projectedNodes,
    edges: projectedEdges,
    supportingCount,
    hiddenNodeCount: nodes.length - projectedNodes.length,
  };
}

function isSupportingNode(node: ThreadGraphNode): boolean {
  return node.entityKind === "consumption" || node.entityKind === "change" ||
    (node.entityKind === "artifact" &&
      !!node.artifactKind && SUPPORTING_ARTIFACT_KINDS.has(node.artifactKind));
}

function shortestPath(
  from: string,
  to: string,
  adjacency: Map<string, string[]>,
): string[] {
  if (from === to) return [from];
  const queue = [from];
  const previous = new Map<string, string | undefined>([[from, undefined]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let cursor = current;
        while (cursor !== from) {
          path.push(cursor);
          const predecessor = previous.get(cursor);
          if (!predecessor) break;
          cursor = predecessor;
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

interface ImpactContext {
  focusKey?: string;
  upstream: Set<string>;
  downstream: Set<string>;
}

function impactContext(
  nodes: PositionedThreadGraphNode[],
  edges: PositionedThreadGraphEdge[],
  focus?: ThreadGraphRef,
): ImpactContext {
  if (!focus) return { upstream: new Set(), downstream: new Set() };
  const focusKey = refKey(focus);
  if (!nodes.some((item) => refKey(item.node.ref) === focusKey)) {
    return { focusKey, upstream: new Set(), downstream: new Set() };
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const item of edges) {
    addMapValue(outgoing, refKey(item.edge.from), refKey(item.edge.to));
    addMapValue(incoming, refKey(item.edge.to), refKey(item.edge.from));
  }
  return {
    focusKey,
    upstream: reachable(focusKey, incoming),
    downstream: reachable(focusKey, outgoing),
  };
}

function nodeImpactState(
  key: string,
  impact: ImpactContext,
  focus?: ThreadGraphRef,
): "none" | "focus" | "upstream" | "downstream" | "related" | "unrelated" {
  if (!focus) return "none";
  if (key === impact.focusKey) return "focus";
  const upstream = impact.upstream.has(key);
  const downstream = impact.downstream.has(key);
  if (upstream && downstream) return "related";
  if (upstream) return "upstream";
  if (downstream) return "downstream";
  return "unrelated";
}

function edgeImpactState(
  item: PositionedThreadGraphEdge,
  impact: ImpactContext,
  focus?: ThreadGraphRef,
): "none" | "upstream" | "downstream" | "related" | "unrelated" {
  if (!focus) return "none";
  const source = refKey(item.edge.from);
  const target = refKey(item.edge.to);
  const upstream = impact.upstream.has(source) &&
    (impact.upstream.has(target) || target === impact.focusKey);
  const downstream =
    (impact.downstream.has(source) || source === impact.focusKey) &&
    impact.downstream.has(target);
  if (upstream && downstream) return "related";
  if (upstream) return "upstream";
  if (downstream) return "downstream";
  return "unrelated";
}

function edgeCenter(item: PositionedThreadGraphEdge): GraphViewportPoint {
  return {
    x: (item.source.x + item.target.x + NODE_WIDTH) / 2,
    y: (item.source.y + item.target.y + NODE_HEIGHT) / 2,
  };
}

function directionalNode(
  nodes: PositionedThreadGraphNode[],
  current: PositionedThreadGraphNode,
  direction: "left" | "right" | "up" | "down" | "first" | "last",
): PositionedThreadGraphNode | undefined {
  const ordered = [...nodes].sort((left, right) =>
    left.y - right.y || left.x - right.x ||
    compareGraphNodes(left.node, right.node)
  );
  if (direction === "first") return ordered[0];
  if (direction === "last") return ordered.at(-1);

  const centerX = current.x + (NODE_WIDTH / 2);
  const centerY = current.y + (NODE_HEIGHT / 2);
  const candidates = nodes.filter((candidate) => {
    const x = candidate.x + (NODE_WIDTH / 2);
    const y = candidate.y + (NODE_HEIGHT / 2);
    if (direction === "left") return x < centerX;
    if (direction === "right") return x > centerX;
    if (direction === "up") return y < centerY;
    return y > centerY;
  });
  return candidates.sort((left, right) => {
    const leftScore = directionalDistance(current, left, direction);
    const rightScore = directionalDistance(current, right, direction);
    return leftScore - rightScore || compareGraphNodes(left.node, right.node);
  })[0];
}

function directionalDistance(
  from: PositionedThreadGraphNode,
  to: PositionedThreadGraphNode,
  direction: "left" | "right" | "up" | "down",
): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return direction === "left" || direction === "right"
    ? (dx * 4) + dy
    : (dy * 4) + dx;
}

function componentLayers(
  componentRefs: string[],
  componentSet: Set<string>,
  edges: ThreadGraphEdge[],
  strongComponents: string[][],
  strongComponentByRef: Map<string, number>,
): Map<string, number> {
  const strongIds = new Set(
    componentRefs.flatMap((key) => {
      const id = strongComponentByRef.get(key);
      return id === undefined ? [] : [id];
    }),
  );
  const outgoing = new Map<number, Set<number>>();
  const indegree = new Map([...strongIds].map((id) => [id, 0]));

  for (const edge of edges) {
    const fromKey = refKey(edge.from);
    const toKey = refKey(edge.to);
    if (!componentSet.has(fromKey) || !componentSet.has(toKey)) continue;
    const from = strongComponentByRef.get(fromKey);
    const to = strongComponentByRef.get(toKey);
    if (from === undefined || to === undefined || from === to) continue;
    const targets = outgoing.get(from) ?? new Set<number>();
    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
    outgoing.set(from, targets);
  }

  const layerByStrong = new Map<number, number>();
  const queue = [...strongIds]
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((left, right) =>
      strongComponentLabel(strongComponents, left).localeCompare(
        strongComponentLabel(strongComponents, right),
      )
    );
  for (const id of queue) layerByStrong.set(id, 0);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (
      const target of [...(outgoing.get(current) ?? [])].sort((a, b) => a - b)
    ) {
      layerByStrong.set(
        target,
        Math.max(
          layerByStrong.get(target) ?? 0,
          (layerByStrong.get(current) ?? 0) + 1,
        ),
      );
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }

  return new Map(componentRefs.map((key) => {
    const strongId = strongComponentByRef.get(key);
    return [
      key,
      strongId === undefined ? 0 : (layerByStrong.get(strongId) ?? 0),
    ];
  }));
}

function strongComponentLabel(components: string[][], id: number): string {
  return components[id]?.[0] ?? String(id);
}

function strongComponents(
  nodes: ThreadGraphNode[],
  adjacency: Map<string, string[]>,
): string[][] {
  let index = 0;
  const indexByRef = new Map<string, number>();
  const lowByRef = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const result: string[][] = [];

  const visit = (key: string) => {
    indexByRef.set(key, index);
    lowByRef.set(key, index);
    index += 1;
    stack.push(key);
    stacked.add(key);

    for (const target of adjacency.get(key) ?? []) {
      if (!indexByRef.has(target)) {
        visit(target);
        lowByRef.set(
          key,
          Math.min(lowByRef.get(key) ?? 0, lowByRef.get(target) ?? 0),
        );
      } else if (stacked.has(target)) {
        lowByRef.set(
          key,
          Math.min(lowByRef.get(key) ?? 0, indexByRef.get(target) ?? 0),
        );
      }
    }
    if (lowByRef.get(key) !== indexByRef.get(key)) return;

    const component: string[] = [];
    let target: string | undefined;
    do {
      target = stack.pop();
      if (target) {
        stacked.delete(target);
        component.push(target);
      }
    } while (target !== key);
    result.push(component.sort());
  };

  for (const node of [...nodes].sort(compareGraphNodes)) {
    const key = refKey(node.ref);
    if (!indexByRef.has(key)) visit(key);
  }
  return result.sort((left, right) =>
    (left[0] ?? "").localeCompare(right[0] ?? "")
  );
}

function weakComponents(
  nodes: ThreadGraphNode[],
  adjacency: Map<string, string[]>,
): string[][] {
  const unseen = new Set(nodes.map((node) => refKey(node.ref)));
  const result: string[][] = [];
  while (unseen.size > 0) {
    const root = [...unseen].sort()[0];
    if (!root) break;
    const component: string[] = [];
    const queue = [root];
    unseen.delete(root);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);
      for (const target of adjacency.get(current) ?? []) {
        if (!unseen.has(target)) continue;
        unseen.delete(target);
        queue.push(target);
      }
    }
    result.push(component.sort());
  }
  return result.sort((left, right) =>
    (left[0] ?? "").localeCompare(right[0] ?? "")
  );
}

function makeAdjacency(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
  undirected: boolean,
): Map<string, string[]> {
  const values = new Map<string, Set<string>>(
    nodes.map((node) => [refKey(node.ref), new Set<string>()]),
  );
  for (const edge of edges) {
    const from = refKey(edge.from);
    const to = refKey(edge.to);
    values.get(from)?.add(to);
    if (undirected) values.get(to)?.add(from);
  }
  return new Map(
    [...values].map(([key, targets]) => [key, [...targets].sort()]),
  );
}

function hasSelfLoop(key: string, adjacency: Map<string, string[]>): boolean {
  return adjacency.get(key)?.includes(key) ?? false;
}

function edgeGeometry(
  source: PositionedThreadGraphNode,
  target: PositionedThreadGraphNode,
  parallelOffset = 0,
): { path: string; labelX: number; labelY: number } {
  if (refKey(source.node.ref) === refKey(target.node.ref)) {
    const edgeX = source.x + NODE_WIDTH;
    const upperY = source.y + 25;
    const lowerY = source.y + NODE_HEIGHT - 20;
    const loopX = edgeX + 48 + parallelOffset;
    return {
      path:
        `M ${edgeX} ${upperY} C ${loopX} ${upperY}, ${loopX} ${lowerY}, ${edgeX} ${lowerY}`,
      labelX: loopX,
      labelY: source.y + (NODE_HEIGHT / 2) - 5,
    };
  }

  if (source.x === target.x) {
    const downward = source.y < target.y;
    const startX = downward ? source.x + NODE_WIDTH : source.x;
    const startY = source.y + (NODE_HEIGHT / 2);
    const endX = downward ? target.x + NODE_WIDTH : target.x;
    const endY = target.y + (NODE_HEIGHT / 2);
    const outsideX = (downward ? startX + 38 : startX - 38) + parallelOffset;
    return {
      path:
        `M ${startX} ${startY} C ${outsideX} ${startY}, ${outsideX} ${endY}, ${endX} ${endY}`,
      labelX: outsideX,
      labelY: ((startY + endY) / 2) - 5,
    };
  }

  const forward = source.x < target.x;
  const startX = forward ? source.x + NODE_WIDTH : source.x;
  const endX = forward ? target.x : target.x + NODE_WIDTH;
  const startY = source.y + (NODE_HEIGHT / 2);
  const endY = target.y + (NODE_HEIGHT / 2);
  const middleX = (startX + endX) / 2;
  return {
    path: `M ${startX} ${startY} C ${middleX} ${
      startY + parallelOffset
    }, ${middleX} ${endY + parallelOffset}, ${endX} ${endY}`,
    labelX: middleX,
    labelY: ((startY + endY) / 2) + parallelOffset - 7,
  };
}

function reachable(
  root: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...(adjacency.get(root) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return seen;
}

function addMapValue(
  map: Map<string, string[]>,
  key: string,
  value: string,
): void {
  const current = map.get(key) ?? [];
  if (!current.includes(value)) current.push(value);
  map.set(key, current);
}

function relationLabel(relation: ThreadGraphEdge["relation"]): string {
  return relation.replaceAll("_", " ");
}

function attestationDescription(
  status: "verified" | "mismatch" | "none",
): string {
  if (status === "verified") return " Fingerprints verified.";
  if (status === "mismatch") return " Fingerprint mismatch detected.";
  return "";
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

function normaliseZoom(value: number): number {
  return Math.min(4.5, Math.max(1, value));
}

function compareGraphNodes(
  left: ThreadGraphNode,
  right: ThreadGraphNode,
): number {
  return left.system.localeCompare(right.system) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id);
}

function compareGraphEdges(
  left: ThreadGraphEdge,
  right: ThreadGraphEdge,
): number {
  return refKey(left.from).localeCompare(refKey(right.from)) ||
    refKey(left.to).localeCompare(refKey(right.to)) ||
    left.relation.localeCompare(right.relation) ||
    left.id.localeCompare(right.id);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
