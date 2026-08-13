import { assertEquals, assertNotEquals } from "@std/assert";
import {
  directionalThreadGraphNode,
  projectEssentialThreadGraph,
  threadGraphImpactContext,
  threadGraphNodeImpactState,
} from "./src/thread/thread-graph-interaction-model.ts";
import {
  layoutThreadGraph,
  threadGraphRefKey,
} from "./src/thread/thread-graph-layout-model.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

Deno.test("thread graph cycles share one causal layer without hiding the cycle", () => {
  const nodes = [node("A"), node("B"), node("C")];
  const layout = layoutThreadGraph(nodes, [
    edge("A-B", nodes[0]!.ref, nodes[1]!.ref),
    edge("B-A", nodes[1]!.ref, nodes[0]!.ref),
    edge("B-C", nodes[1]!.ref, nodes[2]!.ref),
  ]);

  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  assertEquals(byId.get("A")?.cyclic, true);
  assertEquals(byId.get("B")?.cyclic, true);
  assertEquals(byId.get("C")?.cyclic, false);
  assertEquals(byId.get("A")?.layer, byId.get("B")?.layer);
  assertEquals(byId.get("C")?.layer, (byId.get("B")?.layer ?? -1) + 1);
});

Deno.test("thread graph layout keeps disconnected evidence in separate wrapped frames", () => {
  const layout = layoutThreadGraph([node("A"), node("B")], [], {
    maxComponentRowWidth: 300,
  });

  assertEquals(layout.components.length, 2);
  assertEquals(layout.components[0]?.x, layout.components[1]?.x);
  assertEquals(
    (layout.components[1]?.y ?? 0) > (layout.components[0]?.y ?? 0),
    true,
  );
  assertNotEquals(
    layout.nodes[0]?.component,
    layout.nodes[1]?.component,
  );
});

Deno.test("thread graph layout routes parallel edges separately and reports absent endpoints", () => {
  const a = node("A");
  const b = node("B");
  const missing = ref("missing");
  const layout = layoutThreadGraph([a, b], [
    edge("parallel-1", a.ref, b.ref),
    edge("parallel-2", a.ref, b.ref),
    edge("z-missing", a.ref, missing),
    edge("a-missing", missing, b.ref),
  ]);

  assertEquals(layout.edges.length, 2);
  assertNotEquals(layout.edges[0]?.path, layout.edges[1]?.path);
  assertEquals(layout.unresolvedEdgeIds, ["a-missing", "z-missing"]);
});

Deno.test("essential thread projection hides dead-end support but preserves explicit focus", () => {
  const requirement = node("requirement", "requirement");
  const observation = node("observation", "observation");
  const mesh = node("mesh", "artifact", "mesh");
  const edges = [
    edge("result", requirement.ref, observation.ref),
    edge("mesh-input", requirement.ref, mesh.ref),
  ];

  const compact = projectEssentialThreadGraph(
    [requirement, observation, mesh],
    edges,
    false,
    undefined,
    undefined,
  );
  const focused = projectEssentialThreadGraph(
    [requirement, observation, mesh],
    edges,
    false,
    mesh.ref,
    undefined,
  );

  assertEquals(compact.nodes.map((item) => item.id), [
    "requirement",
    "observation",
  ]);
  assertEquals(compact.hiddenNodeCount, 1);
  assertEquals(focused.nodes.map((item) => item.id), [
    "requirement",
    "observation",
    "mesh",
  ]);
  assertEquals(focused.edges.map((item) => item.id), ["result", "mesh-input"]);
});

Deno.test("essential thread projection preserves a focused requirement identity", () => {
  const requirement = node("requirement", "requirement");
  const observation = node("observation", "observation");
  const mesh = node("mesh", "artifact", "mesh");
  const projection = projectEssentialThreadGraph(
    [requirement, observation, mesh],
    [
      edge("result", requirement.ref, observation.ref),
      edge("mesh-input", requirement.ref, mesh.ref),
    ],
    false,
    requirement.ref,
    undefined,
  );

  const focused = projection.nodes.find((item) => item.id === requirement.id);
  assertEquals(focused, requirement);
  assertEquals(focused?.entityKind, "requirement");
  assertEquals(focused?.ref.kind, "requirement");
});

Deno.test("essential edge selection never rewrites its endpoint kinds", () => {
  const requirement = node("requirement", "requirement");
  const observation = node("observation", "observation");
  const mesh = node("mesh", "artifact", "mesh");
  const result = edge("result", requirement.ref, observation.ref);
  const projection = projectEssentialThreadGraph(
    [requirement, observation, mesh],
    [result, edge("mesh-input", requirement.ref, mesh.ref)],
    false,
    undefined,
    { kind: "edge", id: result.id },
  );

  assertEquals(
    projection.nodes.map((item) => [
      item.entityKind,
      item.ref.kind,
    ]),
    [
      ["requirement", "requirement"],
      ["observation", "observation"],
    ],
  );
  assertEquals(projection.edges.map((item) => item.id), ["result"]);
});

Deno.test("thread graph impact distinguishes upstream downstream and cyclic peers", () => {
  const a = node("A");
  const b = node("B");
  const c = node("C");
  const chain = layoutThreadGraph([a, b, c], [
    edge("A-B", a.ref, b.ref),
    edge("B-C", b.ref, c.ref),
  ]);
  const chainImpact = threadGraphImpactContext(
    chain.nodes,
    chain.edges,
    b.ref,
  );

  assertEquals(
    threadGraphNodeImpactState(
      threadGraphRefKey(a.ref),
      chainImpact,
      b.ref,
    ),
    "upstream",
  );
  assertEquals(
    threadGraphNodeImpactState(
      threadGraphRefKey(b.ref),
      chainImpact,
      b.ref,
    ),
    "focus",
  );
  assertEquals(
    threadGraphNodeImpactState(
      threadGraphRefKey(c.ref),
      chainImpact,
      b.ref,
    ),
    "downstream",
  );

  const cycle = layoutThreadGraph([a, b], [
    edge("A-B", a.ref, b.ref),
    edge("B-A", b.ref, a.ref),
  ]);
  const cycleImpact = threadGraphImpactContext(
    cycle.nodes,
    cycle.edges,
    a.ref,
  );
  assertEquals(
    threadGraphNodeImpactState(
      threadGraphRefKey(b.ref),
      cycleImpact,
      a.ref,
    ),
    "related",
  );
});

Deno.test("thread graph keyboard navigation follows deterministic visual geometry", () => {
  const a = node("A");
  const b = node("B");
  const c = node("C");
  const layout = layoutThreadGraph([a, b, c], [
    edge("A-B", a.ref, b.ref),
    edge("B-C", b.ref, c.ref),
  ]);
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  const current = byId.get("B")!;

  assertEquals(
    directionalThreadGraphNode(layout.nodes, current, "left")?.node.id,
    "A",
  );
  assertEquals(
    directionalThreadGraphNode(layout.nodes, current, "right")?.node.id,
    "C",
  );
  assertEquals(
    directionalThreadGraphNode(layout.nodes, current, "first")?.node.id,
    "A",
  );
  assertEquals(
    directionalThreadGraphNode(layout.nodes, current, "last")?.node.id,
    "C",
  );
});

function ref(
  id: string,
  kind: ThreadGraphRef["kind"] = "artifact",
): ThreadGraphRef {
  return { kind, id };
}

function node(
  id: string,
  kind: ThreadGraphRef["kind"] = "artifact",
  artifactKind = "step",
): ThreadGraphNode {
  return {
    id,
    ref: ref(id, kind),
    entityKind: kind,
    artifactKind: kind === "artifact" ? artifactKind : undefined,
    label: id,
    system: "test",
    freshness: "fresh",
    summary: `Node ${id}`,
  };
}

function edge(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation: "input_to",
    rationale: id,
    origin: "structure",
  };
}
