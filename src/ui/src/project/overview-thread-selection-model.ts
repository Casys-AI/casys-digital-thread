import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../thread/types.ts";

export interface OverviewThreadSelectionConnection {
  /** Graph-local occurrence, not a new domain identity. Duplicate ids survive. */
  readonly occurrence: number;
  readonly direction: "incoming" | "outgoing";
  readonly edge: ThreadGraphEdge;
  readonly peer: ThreadGraphNode;
}

/** Direct, literal graph occurrences only; never reinterpret a condensed cable. */
export function overviewThreadSelectionConnections(
  graph: ThreadGraph,
  selectedKey: string,
): readonly OverviewThreadSelectionConnection[] {
  const nodes = new Map(graph.nodes.map((node) => [
    `${node.ref.kind}:${node.ref.id}`,
    node,
  ]));
  if (!nodes.has(selectedKey)) return [];
  return graph.edges.flatMap((edge, occurrence) => {
    const from = `${edge.from.kind}:${edge.from.id}`;
    const to = `${edge.to.kind}:${edge.to.id}`;
    if (from !== selectedKey && to !== selectedKey) return [];
    const direction = from === selectedKey ? "outgoing" : "incoming";
    const peer = nodes.get(direction === "outgoing" ? to : from);
    return peer ? [{ occurrence, direction, edge, peer }] : [];
  });
}
