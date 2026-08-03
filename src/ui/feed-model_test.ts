import { assertEquals } from "@std/assert";
import {
  activityFeedNodes,
  isActivityEntryExpanded,
  traceThreadLineage,
} from "./src/thread/feed-model.ts";
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
  ]);
});

Deno.test("activity feed promotes only a change whose target explicitly supersedes evidence", () => {
  const correction = node("correction", "change", "2026-08-01T08:04:00.000Z");
  const record = node(
    "correction-record",
    "artifact",
    "2026-08-01T08:04:01.000Z",
    "document",
  );
  const historic = node(
    "proof-r28",
    "artifact",
    "2026-08-01T08:00:00.000Z",
    "solver-result",
  );
  const automaticCapture = node(
    "capture",
    "change",
    "2026-08-01T08:05:00.000Z",
  );
  const capturedArtifact = node(
    "capture-record",
    "artifact",
    "2026-08-01T08:05:01.000Z",
  );
  const edges: ThreadGraphEdge[] = [
    {
      id: "recorded-correction",
      from: correction.ref,
      to: record.ref,
      relation: "changes",
      rationale: "The correction is recorded.",
      origin: "provenance",
    },
    {
      id: "supersedes-proof",
      from: historic.ref,
      to: record.ref,
      relation: "supersedes",
      rationale: "The correction replaces the historic basis.",
      origin: "provenance",
    },
    {
      id: "automatic-capture",
      from: automaticCapture.ref,
      to: capturedArtifact.ref,
      relation: "changes",
      rationale: "A snapshot extension introduced a support artifact.",
      origin: "provenance",
    },
  ];

  assertEquals(
    activityFeedNodes(
      [correction, record, historic, automaticCapture, capturedArtifact],
      edges,
    ).map((item) => item.ref.id),
    ["correction", "proof-r28"],
  );
});

Deno.test("activity feed promotes server-declared live milestones, not generic support", () => {
  const nodes = [
    {
      ...node(
        "run-7:projector-milestone",
        "artifact",
        "2026-08-01T08:03:00.000Z",
        "other",
        "any-server-owned-projector",
      ),
      activityRole: "milestone" as const,
    },
    node(
      "run-7:provider-support",
      "artifact",
      "2026-08-01T08:02:00.000Z",
      "other",
      "any-server-owned-projector",
    ),
  ];

  assertEquals(activityFeedNodes(nodes).map((item) => item.ref.id), [
    "run-7:projector-milestone",
  ]);
});

Deno.test("activity feed is collapsed until the reviewer explicitly selects an event", () => {
  const correction = node("correction", "change");

  assertEquals(isActivityEntryExpanded(undefined, correction), false);
  assertEquals(isActivityEntryExpanded(correction.ref, correction), true);
  assertEquals(
    isActivityEntryExpanded({ kind: "artifact", id: "different" }, correction),
    false,
  );
});

function node(
  id: string,
  kind: ThreadGraphRef["kind"] = "artifact",
  recordedAt = "2026-08-01T08:00:00.000Z",
  artifactKind?: string,
  system = "test",
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(artifactKind ? { artifactKind } : {}),
    label: id,
    system,
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
