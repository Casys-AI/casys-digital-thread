import { assertEquals, assertNotEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../../../testing/workbench/generic-thread-workbench-fixture.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../../presentation/workbench/thread/graph.ts";
import {
  FileLiveThreadUpdateStore,
  LiveThreadUpdateStore,
  overlayLiveThreadUpdates,
  redactLiveThreadGraphPatch,
} from "./live-thread-update-store.ts";

Deno.test("file live journal is shared across processes and reconcile tombstones a run", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-live-thread-" });
  try {
    const writer = new FileLiveThreadUpdateStore(directory);
    const reader = new FileLiveThreadUpdateStore(directory);
    const canonical = structuredClone(GENERIC_THREAD_FIXTURE);
    await writer.append({
      subjectId: canonical.subject.id,
      runId: "run-cross-process",
      operationId: "syson-read",
      baseRevision: 5,
      state: "fresh",
      recordedAt: "2026-08-01T10:00:00.000Z",
      graph: { nodes: [artifactNode("sysml-live-partial", "fresh")], edges: [] },
    });

    const active = overlayLiveThreadUpdates(
      canonical,
      5,
      await reader.list(canonical.subject.id),
    );
    assertEquals(active.live.active.length, 1);
    assertEquals(
      active.graph.nodes.some((node) => node.ref.id === "sysml-live-partial"),
      true,
    );

    await writer.reconcileRun(
      canonical.subject.id,
      "run-cross-process",
      "2026-08-01T10:00:01.000Z",
    );
    const reconciled = overlayLiveThreadUpdates(
      canonical,
      5,
      await reader.list(canonical.subject.id),
    );
    assertEquals(reconciled.live.active, []);
    assertEquals(
      reconciled.graph.nodes.some((node) => node.ref.id === "sysml-live-partial"),
      false,
    );
    assertEquals(reconciled.id, canonical.id);
    assertEquals((await reader.list(canonical.subject.id)).length, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file live journal serializes concurrent agent writers", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-live-writers-" });
  try {
    const first = new FileLiveThreadUpdateStore(directory);
    const second = new FileLiveThreadUpdateStore(directory);
    const input = {
      subjectId: "generic-product",
      runId: "parallel-run",
      baseRevision: 5,
      state: "running" as const,
      recordedAt: "2026-08-01T10:00:00.000Z",
      graph: { nodes: [artifactNode("parallel-a", "running")], edges: [] },
    };
    await Promise.all([
      first.append({ ...input, operationId: "agent-a" }),
      second.append({
        ...input,
        operationId: "agent-b",
        graph: { nodes: [artifactNode("parallel-b", "running")], edges: [] },
      }),
    ]);

    const journal = await first.list(input.subjectId);
    assertEquals(journal.map((update) => update.sequence), [1, 2]);
    assertEquals(new Set(journal.map((update) => update.operationId)).size, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file live journal atomically records one idempotent lifecycle milestone and reconciliation", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-live-once-" });
  try {
    const first = new FileLiveThreadUpdateStore(directory);
    const second = new FileLiveThreadUpdateStore(directory);
    const input = {
      subjectId: "generic-product",
      runId: "same-command-run",
      operationId: "baseline.from-approved-brief",
      baseRevision: 0,
      state: "running" as const,
      recordedAt: "2026-08-01T10:00:00.000Z",
      graph: { nodes: [artifactNode("documentary-baseline", "running")], edges: [] },
    };

    const [firstMilestone, secondMilestone] = await Promise.all([
      first.appendOnce(input),
      second.appendOnce({
        ...input,
        recordedAt: "2026-08-01T10:00:01.000Z",
        graph: {
          nodes: [artifactNode("documentary-baseline-retry", "running")],
          edges: [],
        },
      }),
    ]);
    assertEquals(firstMilestone.sequence, secondMilestone.sequence);

    const [firstReconciliation, secondReconciliation] = await Promise.all([
      first.reconcileRunOnce(
        input.subjectId,
        input.runId,
        "2026-08-01T10:00:02.000Z",
      ),
      second.reconcileRunOnce(
        input.subjectId,
        input.runId,
        "2026-08-01T10:00:03.000Z",
      ),
    ]);
    assertEquals(firstReconciliation.sequence, secondReconciliation.sequence);

    const journal = await first.list(input.subjectId);
    assertEquals(journal.map((update) => update.state), ["running", "reconciled"]);
    assertEquals(journal.map((update) => update.sequence), [1, 2]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("regular append remains append-only for matching lifecycle identities", async () => {
  const store = new LiveThreadUpdateStore();
  const input = {
    subjectId: "generic-product",
    runId: "append-only-run",
    operationId: "agent-progress",
    baseRevision: 5,
    state: "running" as const,
    recordedAt: "2026-08-01T10:00:00.000Z",
    graph: { nodes: [artifactNode("append-only", "running")], edges: [] },
  };

  await Promise.all([store.append(input), store.append(input)]);
  const journal = await store.list(input.subjectId);
  assertEquals(journal.map((update) => update.sequence), [1, 2]);
  assertEquals(journal.map((update) => update.state), ["running", "running"]);
});

Deno.test("live thread journal is append-only and collapses one operation identity in place", async () => {
  const store = new LiveThreadUpdateStore();
  const canonical = structuredClone(GENERIC_THREAD_FIXTURE);
  const node = artifactNode("cad-live", "running");

  const started = await store.append({
    subjectId: canonical.subject.id,
    runId: "run-1",
    operationId: "build123d-export",
    baseRevision: 5,
    state: "running",
    recordedAt: "2026-08-01T10:00:00.000Z",
    graph: { nodes: [node], edges: [] },
  });
  await store.append({
    subjectId: canonical.subject.id,
    runId: "run-1",
    operationId: "build123d-export",
    baseRevision: 5,
    state: "fresh",
    recordedAt: "2026-08-01T10:00:01.000Z",
    graph: {
      nodes: [{ ...node, summary: "STEP and GLB exported" }],
      edges: [],
    },
  });

  const journal = await store.list(canonical.subject.id);
  assertEquals(journal.length, 2);
  assertEquals(journal[0].sequence, started.sequence);
  assertEquals(journal[0].graph.nodes[0].freshness, "running");
  assertEquals(journal[1].graph.nodes[0].freshness, "fresh");
  assertEquals(await store.version(canonical.subject.id), journal[1].sequence);

  const projected = overlayLiveThreadUpdates(
    canonical,
    5,
    journal,
    await store.version(canonical.subject.id),
  );
  assertEquals(
    projected.graph.nodes.filter((item) => item.ref.id === "cad-live").length,
    1,
  );
  assertEquals(
    projected.graph.nodes.find((item) => item.ref.id === "cad-live")?.freshness,
    "fresh",
  );
  assertEquals(projected.live.active.length, 1);
  assertEquals(projected.live.active[0].state, "fresh");
});

Deno.test("a newer canonical snapshot reconciles a matching provisional identity", async () => {
  const store = new LiveThreadUpdateStore();
  const canonical = structuredClone(GENERIC_THREAD_FIXTURE);
  const provisional = artifactNode("cad-live", "running");
  await store.append({
    subjectId: canonical.subject.id,
    runId: "run-2",
    operationId: "build123d-export",
    baseRevision: 5,
    state: "fresh",
    recordedAt: "2026-08-01T10:00:00.000Z",
    graph: { nodes: [provisional], edges: [] },
  });
  canonical.graph.nodes.push({
    ...provisional,
    freshness: "fresh",
    summary: "Canonical STEP export",
    recordedAt: "2026-08-01T10:00:02.000Z",
  });

  const projected = overlayLiveThreadUpdates(
    canonical,
    6,
    await store.list(canonical.subject.id),
  );
  const matches = projected.graph.nodes.filter((node) => node.ref.id === "cad-live");
  assertEquals(matches.length, 1);
  assertEquals(matches[0].summary, "Canonical STEP export");
  assertEquals(projected.live.active, []);
  assertEquals((await store.list(canonical.subject.id)).length, 1);
});

Deno.test("same-base live nodes override canonical freshness until publication", async () => {
  const store = new LiveThreadUpdateStore();
  const canonical = structuredClone(GENERIC_THREAD_FIXTURE);
  const target = canonical.graph.nodes.find((node) => node.entityKind === "artifact")!;
  await store.append({
    subjectId: canonical.subject.id,
    runId: "run-3",
    operationId: "rerun-existing-artifact",
    baseRevision: 5,
    state: "running",
    recordedAt: "2026-08-01T10:00:00.000Z",
    graph: {
      nodes: [{ ...target, summary: "Recomputing exact artifact" }],
      edges: [],
    },
  });

  const projected = overlayLiveThreadUpdates(
    canonical,
    5,
    await store.list(canonical.subject.id),
  );
  const matches = projected.graph.nodes.filter((node) => node.id === target.id);
  assertEquals(matches.length, 1);
  assertEquals(matches[0].freshness, "running");
  assertEquals(matches[0].summary, "Recomputing exact artifact");
});

Deno.test("live graph redaction removes secrets and scripts without changing identities", () => {
  const secret = "secret-value-123";
  const script = "from build123d import Box\nresult = Box(1, 2, 3)";
  const node = artifactNode("cad-live", "running");
  node.summary = `token=${secret}; script=${script}`;
  const edge = edgeFromCanonical(node);
  edge.rationale = `Bearer ${secret}`;

  const redacted = redactLiveThreadGraphPatch(
    { nodes: [node], edges: [edge] },
    [{ token: secret, script }],
  );
  assertEquals(redacted.nodes[0].id, node.id);
  assertNotEquals(redacted.nodes[0].summary.includes(secret), true);
  assertNotEquals(redacted.nodes[0].summary.includes("from build123d"), true);
  assertEquals(redacted.edges[0].rationale, "Bearer [REDACTED]");
});

function artifactNode(
  id: string,
  freshness: ThreadGraphNode["freshness"],
): ThreadGraphNode {
  return {
    id: `graph:artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    artifactKind: "cad-model",
    label: "GenericAssembly CAD assembly",
    system: "mcp-build123d",
    freshness,
    summary: "CAD assembly export",
    recordedAt: "2026-08-01T10:00:00.000Z",
    selection: { kind: "artifact", id },
  };
}

function edgeFromCanonical(node: ThreadGraphNode): ThreadGraphEdge {
  const canonical = GENERIC_THREAD_FIXTURE.graph.nodes[0];
  return {
    id: `live-edge:${canonical.id}:${node.id}`,
    from: canonical.ref,
    to: node.ref,
    relation: "derived_from",
    rationale: "Live CAD derives from the canonical system model.",
    origin: "provenance",
  };
}
