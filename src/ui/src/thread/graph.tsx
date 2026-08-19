import type { JSX } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  canvasComponentRowWidth,
  graphViewport,
  type GraphViewportPoint,
} from "./graph-viewport.ts";
import {
  directionalThreadGraphNode,
  positionedEdgeCenter,
  positionedEdgeOccurrenceKey,
  projectEssentialThreadGraph,
  threadGraphEdgeImpactState,
  threadGraphImpactContext,
  threadGraphNodeImpactState,
  type ThreadGraphSelection,
  threadGraphSelectionMatchesEdge,
} from "./thread-graph-interaction-model.ts";
import {
  DEFAULT_THREAD_GRAPH_COMPONENT_ROW_WIDTH,
  layoutThreadGraph as layoutThreadGraphModel,
  type PositionedThreadGraphEdge,
  type PositionedThreadGraphNode,
  THREAD_GRAPH_COMPONENT_PADDING_X,
  THREAD_GRAPH_NODE_HEIGHT,
  THREAD_GRAPH_NODE_WIDTH,
  type ThreadGraphComponentLayout,
  type ThreadGraphLayout,
  type ThreadGraphLayoutOptions,
  threadGraphRefKey,
} from "./thread-graph-layout-model.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
} from "./types.ts";
import { displayedGraphEdgeOccurrenceKey } from "./graph-selection-model.ts";
import { isUiOnlyPresentationEdge } from "../cad/cad-presentation-projection.ts";

export type { ThreadGraphSelection };

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
   * When omitted the canvas falls back to "Linked evidence" (single component)
   * or "EVIDENCE COMPONENT NN" (multiple components).
   *
   * Pass `makeEvidenceComponentLabeler(model, ...)` from evidence-canvas-model
   * to get named frames derived from the full-graph component detection.
   */
  componentLabeler?: (nodes: ThreadGraphNode[], index: number) => string;
}

export type {
  PositionedThreadGraphEdge,
  PositionedThreadGraphNode,
  ThreadGraphComponentLayout,
  ThreadGraphLayout,
  ThreadGraphLayoutOptions,
};

export const layoutThreadGraph = layoutThreadGraphModel;

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
      projectEssentialThreadGraph(
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
          : DEFAULT_THREAD_GRAPH_COMPONENT_ROW_WIDTH,
        maxRowsPerLayer: presentation === "context"
          ? 2
          : presentation === "canvas"
          ? 6
          : undefined,
      }),
    [projection, presentation, frameAspectRatio],
  );
  const impact = useMemo(
    () => threadGraphImpactContext(layout.nodes, layout.edges, focusedRef),
    [layout, focusedRef],
  );
  const selectedNodeRef = selection?.kind === "node"
    ? selection.ref
    : focusedRef;
  const selectedNodeKey = selection?.kind === "node"
    ? threadGraphRefKey(selection.ref)
    : undefined;
  const selectedNodeVisible = selectedNodeKey
    ? layout.nodes.some((item) =>
      threadGraphRefKey(item.node.ref) === selectedNodeKey
    )
    : false;
  const selectedEdgeId = selection?.kind === "edge" ? selection.id : undefined;
  const selectedEdgeVisible = selectedEdgeId
    ? layout.edges.some((item) =>
      threadGraphSelectionMatchesEdge(selection, item.edge)
    )
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
      <div className="thread-graph-empty" role="status">
        {emptyLabel}
      </div>
    );
  }

  const selectNode = (item: PositionedThreadGraphNode) => {
    const next: ThreadGraphSelection = { kind: "node", ref: item.node.ref };
    setKeyboardNode(threadGraphRefKey(item.node.ref));
    if (presentation === "canvas") {
      setCameraCenter(undefined);
      setCameraTarget(item.node.ref);
    }
    onSelectionChange?.(next);
    if (item.node.selection) onInspect?.(item.node.selection, item.node);
  };
  const selectEdge = (item: PositionedThreadGraphEdge) => {
    if (isUiOnlyPresentationEdge(item.edge)) return;
    const keyboardOccurrenceKey = positionedEdgeOccurrenceKey(
      item,
      layout.edges,
    );
    const selectionOccurrenceKey = displayedGraphEdgeOccurrenceKey(item.edge);
    setKeyboardEdge(keyboardOccurrenceKey);
    if (presentation === "canvas") {
      setCameraTarget(undefined);
      setCameraCenter(positionedEdgeCenter(item));
    }
    onSelectionChange?.({
      kind: "edge",
      id: item.edge.id,
      occurrence: { key: selectionOccurrenceKey, edge: item.edge },
    });
  };
  const moveNodeFocus = (
    item: PositionedThreadGraphNode,
    direction: "left" | "right" | "up" | "down" | "first" | "last",
  ) => {
    const target = directionalThreadGraphNode(layout.nodes, item, direction);
    if (!target) return;
    const key = threadGraphRefKey(target.node.ref);
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
    const selectableEdges = layout.edges.filter((candidate) =>
      !isUiOnlyPresentationEdge(candidate.edge)
    );
    const currentIndex = selectableEdges.indexOf(item);
    const targetIndex = direction === "first"
      ? 0
      : direction === "last"
      ? selectableEdges.length - 1
      : direction === "previous"
      ? Math.max(0, currentIndex - 1)
      : Math.min(selectableEdges.length - 1, currentIndex + 1);
    const target = selectableEdges[targetIndex];
    if (!target) return;
    const targetKey = positionedEdgeOccurrenceKey(target, layout.edges);
    setKeyboardEdge(targetKey);
    if (presentation === "canvas") {
      setCameraTarget(undefined);
      setCameraCenter(positionedEdgeCenter(target));
    }
    edgeElements.current.get(targetKey)?.focus();
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
      className="thread-graph"
      data-focused={focusedRef ? "true" : "false"}
      data-components={layout.components.length}
      data-density={showingSupporting ? "complete" : "essential"}
      data-animate={animate ? "true" : "false"}
      data-presentation={presentation}
      data-panning={panning ? "true" : "false"}
    >
      {presentation === "canvas" && (
        <div className="thread-graph-controls" aria-label="Graph view controls">
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
          <div className="thread-graph-density">
            <span>
              {showingSupporting
                ? `All ${nodes.length} evidence nodes are visible.`
                : `${projection.hiddenNodeCount} supporting node${
                  projection.hiddenNodeCount === 1 ? " is" : "s are"
                } condensed from the essential thread.`}
            </span>
            <button
              type="button"
              className="thread-graph-density-toggle"
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
      <div className="thread-graph-viewport" ref={viewportElement}>
        <svg
          className="thread-graph-canvas"
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
          onClick={(event) => {
            // Background click (not on a node or edge) clears the selection so
            // the canvas returns from the bounded-neighbourhood "vue locale" to
            // the full visible graph.  Node/edge clicks are handled by their own
            // onClick and stop propagation implicitly via the closest() guard.
            if (presentation !== "canvas") return;
            const target = event.target as Element;
            if (target.closest(".thread-graph-node, .thread-graph-edge")) {
              return;
            }
            onSelectionChange?.(undefined);
          }}
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
              className="thread-graph-arrow"
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
              ? `Evidence component ${
                String(component.id + 1).padStart(2, "0")
              }`
              : "Linked evidence";
            return (
              <g
                key={component.id}
                className="thread-graph-component"
                data-disconnected={layout.components.length > 1
                  ? "true"
                  : "false"}
              >
                <rect
                  className="thread-graph-component-boundary"
                  x={component.x}
                  y={component.y}
                  width={component.width}
                  height={component.height}
                  rx="12"
                />
                <text
                  className="thread-graph-component-label"
                  x={component.x + THREAD_GRAPH_COMPONENT_PADDING_X}
                  y={component.y + 21}
                >
                  {label}
                </text>
              </g>
            );
          })}

          <g className="thread-graph-edges" aria-label="Explicit relations">
            {layout.edges.map((item, index) => {
              const occurrenceKey = positionedEdgeOccurrenceKey(
                item,
                layout.edges,
              );
              const selectable = !isUiOnlyPresentationEdge(item.edge);
              const selected = selection?.kind === "edge" &&
                threadGraphSelectionMatchesEdge(selection, item.edge);
              const state = threadGraphEdgeImpactState(
                item,
                impact,
                focusedRef,
              );
              const isKeyboardEdge = selectable && (keyboardEdge
                ? keyboardEdge === occurrenceKey
                : selectedEdgeVisible
                ? selected
                : layout.edges.findIndex((candidate) =>
                  !isUiOnlyPresentationEdge(candidate.edge)
                ) === index);
              const attestation = item.edge.attestation?.status ?? "none";
              return (
                <g
                  key={occurrenceKey}
                  ref={(element) => {
                    if (element && selectable) {
                      edgeElements.current.set(occurrenceKey, element);
                    } else {
                      edgeElements.current.delete(occurrenceKey);
                    }
                  }}
                  className="thread-graph-edge"
                  role={selectable ? "button" : undefined}
                  tabIndex={selectable ? (isKeyboardEdge ? 0 : -1) : undefined}
                  aria-label={`${
                    relationLabel(item.edge.relation)
                  }: ${item.source.node.label} to ${item.target.node.label}. ${item.edge.rationale}${
                    attestationDescription(attestation)
                  }`}
                  aria-pressed={selectable ? selected : undefined}
                  data-relation={item.edge.relation}
                  data-origin={item.edge.origin}
                  data-attestation={attestation}
                  data-impact={state}
                  data-selected={selected ? "true" : "false"}
                  style={animate
                    ? { animationDelay: `${Math.min(index * 55, 440)}ms` }
                    : undefined}
                  onClick={selectable ? () => selectEdge(item) : undefined}
                  onFocus={selectable
                    ? () => setKeyboardEdge(occurrenceKey)
                    : undefined}
                  onKeyDown={selectable
                    ? (event) => {
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
                    }
                    : undefined}
                >
                  <title>
                    {`${item.edge.rationale}${
                      attestationDescription(attestation)
                    }`}
                  </title>
                  <path
                    className="thread-graph-edge-line"
                    d={item.path}
                    marker-end={`url(#${markerPrefix}-arrow)`}
                  />
                  <path className="thread-graph-edge-hit" d={item.path} />
                  <text
                    className="thread-graph-edge-label"
                    x={item.labelX}
                    y={item.labelY}
                    textAnchor="middle"
                  >
                    {relationLabel(item.edge.relation)}
                  </text>
                </g>
              );
            })}
          </g>

          <g className="thread-graph-nodes" aria-label="Evidence nodes">
            {layout.nodes.map((item, index) => {
              const key = threadGraphRefKey(item.node.ref);
              const selected = selection?.kind === "node" &&
                threadGraphRefKey(selection.ref) === key;
              const state = threadGraphNodeImpactState(key, impact, focusedRef);
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
                  className="thread-graph-node"
                  transform={`translate(${item.x} ${item.y})`}
                  role="button"
                  tabIndex={isKeyboardNode ? 0 : -1}
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
                    className="thread-graph-node-body"
                    width={THREAD_GRAPH_NODE_WIDTH}
                    height={THREAD_GRAPH_NODE_HEIGHT}
                    rx="10"
                  />
                  <circle
                    className="thread-graph-node-state"
                    cx="14"
                    cy="16"
                    r="4"
                  />
                  <text className="thread-graph-node-system" x="25" y="20">
                    {truncate(item.node.system.toUpperCase(), 27)}
                  </text>
                  <text className="thread-graph-node-label" x="14" y="46">
                    {truncate(item.node.label, 31)}
                  </text>
                  <text className="thread-graph-node-summary" x="14" y="66">
                    {truncate(item.node.summary, 38)}
                  </text>
                  <text
                    className="thread-graph-node-kind"
                    x={THREAD_GRAPH_NODE_WIDTH - 12}
                    y="20"
                    textAnchor="end"
                  >
                    {item.node.evaluationFamily === "study-base"
                      ? "study-base"
                      : item.node.ref.kind}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {layout.components.length > 1 && (
        <figcaption className="thread-graph-caption">
          Separate frames are intentional: no canonical relation currently
          connects these evidence components.
        </figcaption>
      )}
      {layout.unresolvedEdgeIds.length > 0 && (
        <p className="thread-graph-notice" role="status">
          {layout.unresolvedEdgeIds.length}{" "}
          relation{layout.unresolvedEdgeIds.length === 1 ? "" : "s"}{" "}
          not drawn because an endpoint is absent from this snapshot.
        </p>
      )}
    </figure>
  );
}

function relationLabel(relation: ThreadGraphEdge["relation"]): string {
  return relation.replaceAll("_", " ").replaceAll("-", " ");
}

function attestationDescription(
  status: "verified" | "mismatch" | "none",
): string {
  if (status === "verified") return " Fingerprints verified.";
  if (status === "mismatch") return " Fingerprint mismatch detected.";
  return "";
}

function normaliseZoom(value: number): number {
  return Math.min(4.5, Math.max(1, value));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
