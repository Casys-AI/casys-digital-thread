import { assertEquals } from "@std/assert";
import { activityFeedNodes, traceThreadLineage } from "./src/thread/feed-model.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

Deno.test("lineage keeps every upstream branch and downstream impact", () => {
  const nodes = ["cad", "scenario", "solve", "stress", "requirement", "action"]
    .map((id) => node(id));
  const edges = [
    edge("cad", "solve"),
    edge("scenario", "solve"),
    edge("solve", "stress"),
    edge("stress", "requirement"),
    edge("requirement", "action"),
  ];

  const lineage = traceThreadLineage(nodes, edges, ref("stress"));

  assertEquals(lineage.upstream.map((step) => step.node.ref.id), [
    "cad",
    "scenario",
    "solve",
  ]);
  assertEquals(lineage.downstream.map((step) => step.node.ref.id), [
    "requirement",
    "action",
  ]);
  assertEquals(lineage.edges.length, 5);
});

Deno.test("feedback nodes are not duplicated across both lineage directions", () => {
  const nodes = ["a", "b", "c"].map((id) => node(id));
  const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];

  const lineage = traceThreadLineage(nodes, edges, ref("b"));

  assertEquals(lineage.upstream, []);
  assertEquals(lineage.downstream, []);
  assertEquals(lineage.feedback.map((step) => step.node.ref.id), ["a", "c"]);
  assertEquals(lineage.edges.length, 3);
});

Deno.test("activity feed hides support plumbing but keeps meaningful outputs", () => {
  const nodes = [
    node("change", "change", "2026-08-01T08:00:00.000Z"),
    node("attestation", "consumption", "2026-08-01T08:01:00.000Z"),
    node("raw-evidence", "artifact", "2026-08-01T08:02:00.000Z", "evidence"),
    node("step", "artifact", "2026-08-01T08:03:00.000Z", "step"),
    node("stress", "observation", "2026-08-01T08:04:00.000Z"),
  ];

  assertEquals(activityFeedNodes(nodes).map((item) => item.ref.id), [
    "stress",
    "step",
    "change",
  ]);
});

function node(
  id: string,
  kind: ThreadGraphRef["kind"] = "artifact",
  recordedAt = "2026-08-01T08:00:00.000Z",
  artifactKind?: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(artifactKind ? { artifactKind } : {}),
    label: id,
    system: "test",
    freshness: "fresh",
    summary: id,
    recordedAt,
  };
}

function ref(id: string): ThreadGraphRef {
  return { kind: "artifact", id };
}

function edge(from: string, to: string): ThreadGraphEdge {
  return {
    id: `${from}-${to}`,
    from: ref(from),
    to: ref(to),
    relation: "derived_from",
    rationale: `${to} derives from ${from}`,
    origin: "provenance",
  };
}
