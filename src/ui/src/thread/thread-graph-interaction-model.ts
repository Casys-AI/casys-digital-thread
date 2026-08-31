import { graphEdgeSelectionMatches } from "./graph-selection-model.ts";
import {
  compareThreadGraphNodes,
  type PositionedThreadGraphEdge,
  type PositionedThreadGraphNode,
  THREAD_GRAPH_NODE_HEIGHT,
  THREAD_GRAPH_NODE_WIDTH,
  threadGraphRefKey,
} from "./thread-graph-layout-model.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";
import {
  structuredOccurrenceKey,
  versionedEdgeOccurrenceKey,
} from "./versioned-provenance-model.ts";

export type ThreadGraphSelection =
  | { kind: "node"; ref: ThreadGraphRef }
  | {
    kind: "edge";
    /** Domain id retained for version history and human-facing records. */
    id: string;
    /** Exact renderer occurrence, distinct even when domain ids collide. */
    occurrence?: { readonly key: string; readonly edge: ThreadGraphEdge };
  };

export interface CompleteThreadGraphProjection {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
}

/**
 * Preserve the complete recorded graph for layout and interaction.
 *
 * Focus and selection affect emphasis only; they never classify away a
 * recorded node or relation.
 */
export function projectCompleteThreadGraph(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
): CompleteThreadGraphProjection {
  return { nodes, edges };
}

export function threadGraphSelectionMatchesEdge(
  selection: ThreadGraphSelection | undefined,
  edge: ThreadGraphEdge,
): boolean {
  if (selection?.kind !== "edge") return false;
  return graphEdgeSelectionMatches(selection, edge);
}

export function positionedEdgeOccurrenceKey(
  item: PositionedThreadGraphEdge,
  edges: readonly PositionedThreadGraphEdge[],
): string {
  const baseKey = versionedEdgeOccurrenceKey(item.edge);
  const sameBaseBefore = edges.slice(0, edges.indexOf(item)).filter(
    (candidate) => versionedEdgeOccurrenceKey(candidate.edge) === baseKey,
  ).length;
  return sameBaseBefore === 0
    ? baseKey
    : structuredOccurrenceKey("svg-edge-occurrence", [
      baseKey,
      sameBaseBefore,
    ]);
}

export interface ThreadGraphImpactContext {
  focusKey?: string;
  upstream: Set<string>;
  downstream: Set<string>;
}

export type ThreadGraphNodeImpactState =
  | "none"
  | "focus"
  | "upstream"
  | "downstream"
  | "related"
  | "unrelated";

export type ThreadGraphEdgeImpactState = Exclude<
  ThreadGraphNodeImpactState,
  "focus"
>;

export function threadGraphImpactContext(
  nodes: PositionedThreadGraphNode[],
  edges: PositionedThreadGraphEdge[],
  focus?: ThreadGraphRef,
): ThreadGraphImpactContext {
  if (!focus) return { upstream: new Set(), downstream: new Set() };
  const focusKey = threadGraphRefKey(focus);
  if (!nodes.some((item) => threadGraphRefKey(item.node.ref) === focusKey)) {
    return { focusKey, upstream: new Set(), downstream: new Set() };
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const item of edges) {
    addMapValue(
      outgoing,
      threadGraphRefKey(item.edge.from),
      threadGraphRefKey(item.edge.to),
    );
    addMapValue(
      incoming,
      threadGraphRefKey(item.edge.to),
      threadGraphRefKey(item.edge.from),
    );
  }
  return {
    focusKey,
    upstream: reachable(focusKey, incoming),
    downstream: reachable(focusKey, outgoing),
  };
}

export function threadGraphNodeImpactState(
  key: string,
  impact: ThreadGraphImpactContext,
  focus?: ThreadGraphRef,
): ThreadGraphNodeImpactState {
  if (!focus) return "none";
  if (key === impact.focusKey) return "focus";
  const upstream = impact.upstream.has(key);
  const downstream = impact.downstream.has(key);
  if (upstream && downstream) return "related";
  if (upstream) return "upstream";
  if (downstream) return "downstream";
  return "unrelated";
}

export function threadGraphEdgeImpactState(
  item: PositionedThreadGraphEdge,
  impact: ThreadGraphImpactContext,
  focus?: ThreadGraphRef,
): ThreadGraphEdgeImpactState {
  if (!focus) return "none";
  const source = threadGraphRefKey(item.edge.from);
  const target = threadGraphRefKey(item.edge.to);
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

export interface ThreadGraphPoint {
  x: number;
  y: number;
}

export function positionedEdgeCenter(
  item: PositionedThreadGraphEdge,
): ThreadGraphPoint {
  return {
    x: (item.source.x + item.target.x + THREAD_GRAPH_NODE_WIDTH) / 2,
    y: (item.source.y + item.target.y + THREAD_GRAPH_NODE_HEIGHT) / 2,
  };
}

export type ThreadGraphNavigationDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "first"
  | "last";

export function directionalThreadGraphNode(
  nodes: PositionedThreadGraphNode[],
  current: PositionedThreadGraphNode,
  direction: ThreadGraphNavigationDirection,
): PositionedThreadGraphNode | undefined {
  const ordered = [...nodes].sort((left, right) =>
    left.y - right.y || left.x - right.x ||
    compareThreadGraphNodes(left.node, right.node)
  );
  if (direction === "first") return ordered[0];
  if (direction === "last") return ordered.at(-1);

  const centerX = current.x + (THREAD_GRAPH_NODE_WIDTH / 2);
  const centerY = current.y + (THREAD_GRAPH_NODE_HEIGHT / 2);
  const candidates = nodes.filter((candidate) => {
    const x = candidate.x + (THREAD_GRAPH_NODE_WIDTH / 2);
    const y = candidate.y + (THREAD_GRAPH_NODE_HEIGHT / 2);
    if (direction === "left") return x < centerX;
    if (direction === "right") return x > centerX;
    if (direction === "up") return y < centerY;
    return y > centerY;
  });
  return candidates.sort((left, right) => {
    const leftScore = directionalDistance(current, left, direction);
    const rightScore = directionalDistance(current, right, direction);
    return leftScore - rightScore ||
      compareThreadGraphNodes(left.node, right.node);
  })[0];
}

function directionalDistance(
  from: PositionedThreadGraphNode,
  to: PositionedThreadGraphNode,
  direction: Exclude<ThreadGraphNavigationDirection, "first" | "last">,
): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return direction === "left" || direction === "right"
    ? (dx * 4) + dy
    : (dy * 4) + dx;
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
