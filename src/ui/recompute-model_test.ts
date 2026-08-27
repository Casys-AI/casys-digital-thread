import { assertEquals } from "@std/assert";
import {
  buildRecomputeHistory,
  presentRecomputeTransition,
  recomputeGroupsForFocus,
  recomputeTransitionsForFocus,
} from "./src/thread/recompute-model.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

Deno.test("revision trail renders only an explicit historic evidence successor", () => {
  const changed = node("change-wall", "change", "fresh", "09:00");
  const historic = node("thermal-r17", "artifact", "stale", "09:01");
  const current = node("thermal-r18", "artifact", "fresh", "09:02");

  const history = buildRecomputeHistory({
    nodes: [changed, historic, current],
    edges: [
      edge("change", changed.ref, current.ref, "changes"),
      edge("supersedes", historic.ref, current.ref, "supersedes"),
    ],
  });

  assertEquals(history.transitions.length, 1);
  assertEquals(history.transitions[0]?.historical.ref, historic.ref);
  assertEquals(history.transitions[0]?.successor.ref, current.ref);
  assertEquals(history.transitions[0]?.state, "current");
  assertEquals(history.transitions[0]?.changes.map((item) => item.ref.id), [
    "change-wall",
  ]);
  assertEquals(history.awaitingSuccessor, []);
});

Deno.test("stale evidence without a supersedes relation stays visibly awaiting replacement", () => {
  const stale = node("thermal-r17", "artifact", "stale", "09:01");
  const unrelatedFresh = node("cad-r18", "artifact", "fresh", "09:02");

  const history = buildRecomputeHistory({
    nodes: [stale, unrelatedFresh],
    edges: [edge("input", stale.ref, unrelatedFresh.ref, "input_to")],
  });

  assertEquals(history.transitions, []);
  assertEquals(history.awaitingSuccessor.map((item) => item.ref.id), [
    "thermal-r17",
  ]);
});

Deno.test("revision trail distinguishes a running successor from current evidence", () => {
  const historic = node("fea-r17", "artifact", "stale", "09:01");
  const running = node("fea-r18", "artifact", "running", "09:02");

  const history = buildRecomputeHistory({
    nodes: [historic, running],
    edges: [edge("supersedes", historic.ref, running.ref, "supersedes")],
  });

  assertEquals(history.transitions[0]?.state, "recomputing");
});

Deno.test("revision trail presentation tells a human review story without raw identifiers", () => {
  const correction = {
    ...node("change-drip-tray", "change", "fresh", "09:00"),
    label: "Raise the DripTray from 28 mm to 30 mm",
  };
  const historic = {
    ...node("proof-r28", "artifact", "stale", "09:01"),
    label: "28 mm DripTray static proof",
    artifactKind: "solver-result" as const,
  };
  const successor = {
    ...node("proof-r30", "artifact", "fresh", "09:02"),
    label: "30 mm DripTray static proof",
    artifactKind: "solver-result" as const,
  };
  const transition = buildRecomputeHistory({
    nodes: [correction, historic, successor],
    edges: [
      edge("changed", correction.ref, successor.ref, "changes"),
      {
        ...edge("superseded", historic.ref, successor.ref, "supersedes"),
        rationale: "The revised support geometry needs a new isolated static proof.",
      },
      edge("supports-evaluation", successor.ref, {
        kind: "evaluation",
        id: "proof-r30-evaluation",
      }, "evidences"),
    ],
  }).transitions[0];
  if (!transition) throw new Error("Expected one revision transition.");

  assertEquals(presentRecomputeTransition(transition), {
    status: { label: "Published", tone: "published" },
    title: "Raise the DripTray from 28 mm to 30 mm",
    affectedElement: "28 mm DripTray static proof",
    changeSummary: "The revised support geometry needs a new isolated static proof.",
    evidence: {
      count: 2,
      types: ["solver result"],
      label: "2 evidence records · solver result",
    },
    result: "30 mm DripTray static proof is published as the current successor.",
  });
});

Deno.test("r10 correction records stay nested as one change and do not claim proof delivery", () => {
  const correction = {
    ...node("change-drip-tray", "change", "stale", "09:00"),
    label: "Record DripTray height correction from 28 mm to 30 mm",
  };
  const record = {
    ...node("correction-record", "artifact", "fresh", "09:01"),
    label: "DripTray height correction (28 mm to 30 mm)",
    artifactKind: "document" as const,
  };
  const historicPlan = {
    ...node("plan-r28", "artifact", "stale", "09:02"),
    label: "28 mm CAD plan",
    artifactKind: "document" as const,
  };
  const historicSolve = {
    ...node("solve-r28", "artifact", "stale", "09:03"),
    label: "28 mm static result",
    artifactKind: "solver-result" as const,
  };
  const currentSolve = {
    ...node("solve-r30", "artifact", "fresh", "09:04"),
    label: "30 mm static result",
    artifactKind: "solver-result" as const,
  };
  const history = buildRecomputeHistory({
    nodes: [correction, record, historicPlan, historicSolve, currentSolve],
    edges: [
      edge("recorded", correction.ref, record.ref, "changes"),
      {
        ...edge("invalidates-plan", historicPlan.ref, record.ref, "supersedes"),
        rationale: "The correction does not claim replacement evidence yet.",
      },
      edge("derived-solve", record.ref, currentSolve.ref, "derived_from"),
      edge("replaces-solve", historicSolve.ref, currentSolve.ref, "supersedes"),
      edge("supports-evaluation", currentSolve.ref, {
        kind: "evaluation",
        id: "solve-r30-evaluation",
      }, "evidences"),
    ],
  });

  assertEquals(history.groups.length, 1);
  assertEquals(history.groups[0]?.transitions.length, 2);
  assertEquals(history.groups[0]?.status, {
    label: "Published",
    tone: "published",
  });
  assertEquals(recomputeGroupsForFocus(history, correction.ref).length, 1);
  const recordTransition = history.transitions.find((transition) =>
    transition.successor.ref.id === record.ref.id
  );
  if (!recordTransition) {
    throw new Error("Expected recorded correction transition.");
  }
  assertEquals(presentRecomputeTransition(recordTransition).status, {
    label: "Recorded change",
    tone: "recorded",
  });
  assertEquals(
    presentRecomputeTransition(recordTransition).result,
    "The correction is recorded; a replacement proof has not yet been published.",
  );
});

Deno.test("revision trail presentation reports running and failed successors without claiming delivery", () => {
  const historic = node("proof-r28", "artifact", "stale", "09:01");
  const running = node("proof-r30", "artifact", "running", "09:02");
  const failed = node("proof-r31", "artifact", "failed", "09:03");

  const runningTransition = buildRecomputeHistory({
    nodes: [historic, running],
    edges: [edge("running", historic.ref, running.ref, "supersedes")],
  }).transitions[0];
  const failedTransition = buildRecomputeHistory({
    nodes: [historic, failed],
    edges: [edge("failed", historic.ref, failed.ref, "supersedes")],
  }).transitions[0];
  if (!runningTransition || !failedTransition) {
    throw new Error("Expected presentation transitions.");
  }

  assertEquals(presentRecomputeTransition(runningTransition).status, {
    label: "Running",
    tone: "running",
  });
  assertEquals(presentRecomputeTransition(failedTransition).status, {
    label: "Failed",
    tone: "failed",
  });
});

Deno.test("revision trail names only independent fresh artifact branches as unaffected", () => {
  const historic = node("drip-tray-r28", "artifact", "stale", "09:01");
  const current = node("drip-tray-r30", "artifact", "fresh", "09:02");
  const thermal = {
    ...node("thermal-r4", "artifact", "fresh", "09:03"),
    system: "Modelica",
  };
  const bom = {
    ...node("bom-r2", "artifact", "fresh", "09:04"),
    system: "ERPNext",
  };
  const staleUnrelated = {
    ...node("bom-r1", "artifact", "stale", "09:00"),
    system: "ERPNext",
  };

  const history = buildRecomputeHistory({
    nodes: [historic, current, thermal, bom, staleUnrelated],
    edges: [edge("supersedes", historic.ref, current.ref, "supersedes")],
  });

  assertEquals(history.transitions[0]?.unaffectedSystems, [
    { system: "ERPNext", evidenceCount: 1 },
    { system: "Modelica", evidenceCount: 1 },
  ]);
});

Deno.test("revision trail keeps declared older snapshots but excludes the current exact ref", () => {
  const history = buildRecomputeHistory({
    nodes: [],
    edges: [],
    currentSnapshot: {
      snapshotId: "thread-generic-r3",
      revision: 3,
      subjectId: "GEN-01",
    },
    snapshotHistory: [
      { snapshotId: "thread-generic-r1", revision: 1, subjectId: "GEN-01" },
      { snapshotId: "thread-generic-r2", revision: 2, subjectId: "GEN-01" },
      { snapshotId: "thread-generic-r3", revision: 3, subjectId: "GEN-01" },
      { snapshotId: "thread-generic-r2", revision: 2, subjectId: "GEN-01" },
    ],
  });

  assertEquals(history.historicalSnapshots, [
    { snapshotId: "thread-generic-r2", revision: 2, subjectId: "GEN-01" },
    { snapshotId: "thread-generic-r1", revision: 1, subjectId: "GEN-01" },
  ]);
});

Deno.test("revision trail focus does not pull an unrelated correction into review", () => {
  const historic = node("thermal-r17", "artifact", "stale", "09:01");
  const current = node("thermal-r18", "artifact", "fresh", "09:02");
  const unrelated = node("cad-r18", "artifact", "fresh", "09:03");
  const history = buildRecomputeHistory({
    nodes: [historic, current, unrelated],
    edges: [edge("supersedes", historic.ref, current.ref, "supersedes")],
  });

  assertEquals(
    recomputeTransitionsForFocus(history, historic.ref).map((item) => item.id),
    ["supersedes"],
  );
  assertEquals(recomputeTransitionsForFocus(history, unrelated.ref), []);
});

Deno.test("labelled Cockpit fixture shows the DripTray correction without claiming thermal or BOM causality", () => {
  const history = buildRecomputeHistory({
    nodes: GENERIC_THREAD_FIXTURE.graph.nodes,
    edges: GENERIC_THREAD_FIXTURE.graph.edges,
  });
  const correction = history.transitions.find((transition) =>
    transition.changes.some((change) =>
      change.label === "Correction DripTray 28 → 30 mm"
    )
  );

  assertEquals(correction?.historical.freshness, "stale");
  assertEquals(correction?.state, "current");
  assertEquals(
    correction?.unaffectedSystems.some((item) => item.system === "Modelica"),
    true,
  );
  assertEquals(
    correction?.unaffectedSystems.some((item) => item.system === "ERPNext"),
    true,
  );
});

function node(
  id: string,
  kind: ThreadGraphRef["kind"],
  freshness: ThreadGraphNode["freshness"],
  minute: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(kind === "artifact" ? { artifactKind: "solver-result" } : {}),
    label: id,
    system: "test",
    freshness,
    summary: id,
    recordedAt: `2026-08-03T${minute}:00.000Z`,
  };
}

function edge(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: ThreadGraphEdge["relation"],
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation,
    rationale: id,
    origin: relation === "input_to" ? "structure" : "provenance",
  };
}
