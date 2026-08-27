import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

export const THREAD_GRAPH_NODE_WIDTH = 216;
export const THREAD_GRAPH_NODE_HEIGHT = 82;
const COLUMN_GAP = 112;
const ROW_GAP = 28;
const COMPONENT_GAP = 52;
const COMPONENT_HEADER = 34;
export const THREAD_GRAPH_COMPONENT_PADDING_X = 24;
const COMPONENT_PADDING_BOTTOM = 24;
const VIEWBOX_PADDING = 12;
/** Prevents independent evidence islands from producing an endless page. */
export const DEFAULT_THREAD_GRAPH_COMPONENT_ROW_WIDTH = 1320;

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
 * Deterministic layout of the canonical thread graph.
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

  const orderedNodes = [...nodes].sort(compareThreadGraphNodes);
  const nodeByRef = new Map<string, ThreadGraphNode>();
  for (const node of orderedNodes) {
    if (!nodeByRef.has(threadGraphRefKey(node.ref))) {
      nodeByRef.set(threadGraphRefKey(node.ref), node);
    }
  }

  const resolvedEdges = edges.filter((edge) =>
    nodeByRef.has(threadGraphRefKey(edge.from)) &&
    nodeByRef.has(threadGraphRefKey(edge.to))
  ).sort(compareThreadGraphEdges);
  const unresolvedEdgeIds = edges
    .filter((edge) =>
      !nodeByRef.has(threadGraphRefKey(edge.from)) ||
      !nodeByRef.has(threadGraphRefKey(edge.to))
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
    for (const bucket of nodesByLayer.values()) {
      bucket.sort(compareThreadGraphNodes);
    }

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
    const componentWidth = (THREAD_GRAPH_COMPONENT_PADDING_X * 2) +
      (visualColumnCount * THREAD_GRAPH_NODE_WIDTH) +
      ((visualColumnCount - 1) * COLUMN_GAP);
    const componentHeight = COMPONENT_HEADER + COMPONENT_PADDING_BOTTOM +
      (maxRows * THREAD_GRAPH_NODE_HEIGHT) + ((maxRows - 1) * ROW_GAP);

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
    DEFAULT_THREAD_GRAPH_COMPONENT_ROW_WIDTH;

  pendingComponents.forEach((pending) => {
    if (
      nextX > VIEWBOX_PADDING &&
      nextX + pending.componentWidth + VIEWBOX_PADDING > maxComponentRowWidth
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
          x: componentX + THREAD_GRAPH_COMPONENT_PADDING_X +
            (visualColumn * (THREAD_GRAPH_NODE_WIDTH + COLUMN_GAP)),
          y: componentY + COMPONENT_HEADER +
            (visualRow * (THREAD_GRAPH_NODE_HEIGHT + ROW_GAP)),
          component: pending.componentIndex,
          layer,
          cyclic: cyclicRefs.has(threadGraphRefKey(node.ref)),
        });
      });
    }

    rowHeight = Math.max(rowHeight, pending.componentHeight);
    widestRight = Math.max(widestRight, componentX + pending.componentWidth);
    nextX += pending.componentWidth + COMPONENT_GAP;
  });

  const positionedByRef = new Map(
    positioned.map((item) => [threadGraphRefKey(item.node.ref), item] as const),
  );
  const routeCounts = new Map<string, number>();
  for (const edge of resolvedEdges) {
    const route = `${threadGraphRefKey(edge.from)}->${
      threadGraphRefKey(edge.to)
    }`;
    routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
  }
  const routeIndexes = new Map<string, number>();
  const positionedEdges = resolvedEdges.flatMap((edge) => {
    const source = positionedByRef.get(threadGraphRefKey(edge.from));
    const target = positionedByRef.get(threadGraphRefKey(edge.to));
    if (!source || !target) return [];
    const route = `${threadGraphRefKey(edge.from)}->${
      threadGraphRefKey(edge.to)
    }`;
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
    const fromKey = threadGraphRefKey(edge.from);
    const toKey = threadGraphRefKey(edge.to);
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

  for (const node of [...nodes].sort(compareThreadGraphNodes)) {
    const key = threadGraphRefKey(node.ref);
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
  const unseen = new Set(nodes.map((node) => threadGraphRefKey(node.ref)));
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
    nodes.map((node) => [threadGraphRefKey(node.ref), new Set<string>()]),
  );
  for (const edge of edges) {
    const from = threadGraphRefKey(edge.from);
    const to = threadGraphRefKey(edge.to);
    values.get(from)?.add(to);
    if (undirected) values.get(to)?.add(from);
  }
  return new Map(
    [...values].map(([key, targets]) => [key, [...targets].sort()]),
  );
}

function hasSelfLoop(
  key: string,
  adjacency: Map<string, string[]>,
): boolean {
  return adjacency.get(key)?.includes(key) ?? false;
}

function edgeGeometry(
  source: PositionedThreadGraphNode,
  target: PositionedThreadGraphNode,
  parallelOffset = 0,
): { path: string; labelX: number; labelY: number } {
  if (
    threadGraphRefKey(source.node.ref) === threadGraphRefKey(target.node.ref)
  ) {
    const edgeX = source.x + THREAD_GRAPH_NODE_WIDTH;
    const upperY = source.y + 25;
    const lowerY = source.y + THREAD_GRAPH_NODE_HEIGHT - 20;
    const loopX = edgeX + 48 + parallelOffset;
    return {
      path:
        `M ${edgeX} ${upperY} C ${loopX} ${upperY}, ${loopX} ${lowerY}, ${edgeX} ${lowerY}`,
      labelX: loopX,
      labelY: source.y + (THREAD_GRAPH_NODE_HEIGHT / 2) - 5,
    };
  }

  if (source.x === target.x) {
    const downward = source.y < target.y;
    const startX = downward ? source.x + THREAD_GRAPH_NODE_WIDTH : source.x;
    const startY = source.y + (THREAD_GRAPH_NODE_HEIGHT / 2);
    const endX = downward ? target.x + THREAD_GRAPH_NODE_WIDTH : target.x;
    const endY = target.y + (THREAD_GRAPH_NODE_HEIGHT / 2);
    const outsideX = (downward ? startX + 38 : startX - 38) + parallelOffset;
    return {
      path:
        `M ${startX} ${startY} C ${outsideX} ${startY}, ${outsideX} ${endY}, ${endX} ${endY}`,
      labelX: outsideX,
      labelY: ((startY + endY) / 2) - 5,
    };
  }

  const forward = source.x < target.x;
  const startX = forward ? source.x + THREAD_GRAPH_NODE_WIDTH : source.x;
  const endX = forward ? target.x : target.x + THREAD_GRAPH_NODE_WIDTH;
  const startY = source.y + (THREAD_GRAPH_NODE_HEIGHT / 2);
  const endY = target.y + (THREAD_GRAPH_NODE_HEIGHT / 2);
  const middleX = (startX + endX) / 2;
  return {
    path: `M ${startX} ${startY} C ${middleX} ${
      startY + parallelOffset
    }, ${middleX} ${endY + parallelOffset}, ${endX} ${endY}`,
    labelX: middleX,
    labelY: ((startY + endY) / 2) + parallelOffset - 7,
  };
}

export function threadGraphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function compareThreadGraphNodes(
  left: ThreadGraphNode,
  right: ThreadGraphNode,
): number {
  return left.system.localeCompare(right.system) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id);
}

function compareThreadGraphEdges(
  left: ThreadGraphEdge,
  right: ThreadGraphEdge,
): number {
  return threadGraphRefKey(left.from).localeCompare(
    threadGraphRefKey(right.from),
  ) ||
    threadGraphRefKey(left.to).localeCompare(threadGraphRefKey(right.to)) ||
    left.relation.localeCompare(right.relation) ||
    left.id.localeCompare(right.id);
}
