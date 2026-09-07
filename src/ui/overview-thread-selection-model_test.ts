import { assertEquals, assertStrictEquals } from "@std/assert";
import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "./src/thread/types.ts";
import { overviewThreadSelectionConnections } from "./src/project/overview-thread-selection-model.ts";

function node(
  kind: ThreadGraphNode["ref"]["kind"],
  id: string,
): ThreadGraphNode {
  return {
    id: `${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    label: id,
    system: "thread",
    freshness: "fresh",
    summary: "Recorded",
  };
}

Deno.test("selection follows exact direct graph occurrences, not ids or inferred paths", () => {
  const source = node("artifact", "same");
  const selected = node("part-definition", "same");
  const result = node("observation", "result");
  const last = node("evaluation", "last");
  const edge = (
    from: ThreadGraphNode,
    to: ThreadGraphNode,
  ): ThreadGraphEdge => ({
    id: "duplicate",
    from: from.ref,
    to: to.ref,
    relation: "uses",
    origin: "provenance",
    rationale: "Exact rationale",
  });
  const graph: ThreadGraph = {
    nodes: [source, selected, result, last],
    edges: [
      edge(source, selected),
      edge(selected, result),
      edge(selected, result),
      edge(result, last),
    ],
  };
  const connections = overviewThreadSelectionConnections(
    graph,
    "part-definition:same",
  );
  assertEquals(
    connections.map((
      { occurrence, direction, peer },
    ) => [occurrence, direction, peer.ref.id]),
    [[0, "incoming", "same"], [1, "outgoing", "result"], [
      2,
      "outgoing",
      "result",
    ]],
  );
  assertStrictEquals(connections[1]!.edge, graph.edges[1]);
  assertEquals(connections.some(({ peer }) => peer === last), false);
  assertEquals(
    overviewThreadSelectionConnections(graph, "artifact:missing"),
    [],
  );
});

Deno.test("selection preserves analysis qualification without promoting a verdict", () => {
  const source = node("artifact", "source");
  const result = node("observation", "result");
  const edge: ThreadGraphEdge = {
    id: "assertion",
    from: source.ref,
    to: result.ref,
    relation: "declared-dependency",
    origin: "analysis",
    rationale: "Declared only",
    analysis: {
      assertionId: "assertion",
      epistemicBasis: "declared",
      assertedBy: { kind: "agent", id: "test" },
      evidence: [],
      scope: { kind: "basis", basisFingerprint: "exact" },
    },
  };
  const graph: ThreadGraph = { nodes: [source, result], edges: [edge] };
  const [connection] = overviewThreadSelectionConnections(
    graph,
    "artifact:source",
  );
  assertStrictEquals(connection!.edge, edge);
  assertEquals(connection!.edge.analysis?.epistemicBasis, "declared");
  assertEquals(connection!.peer.freshness, "fresh");
  assertEquals("verdict" in connection!, false);
});

Deno.test("selection presentation never turns missing endpoints into invented records", () => {
  const source = node("artifact", "source");
  const graph: ThreadGraph = {
    nodes: [source],
    edges: [{
      id: "dangling",
      from: source.ref,
      to: { kind: "artifact", id: "missing" },
      relation: "uses",
      origin: "provenance",
      rationale: "Missing",
    }],
  };
  assertEquals(
    overviewThreadSelectionConnections(graph, "artifact:source"),
    [],
  );
});
