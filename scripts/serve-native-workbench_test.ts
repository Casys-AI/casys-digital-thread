import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../src/domain/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../src/domain/engineering-project-command-service.ts";
import { EngineeringProjectCommandService } from "../src/domain/engineering-project-command-service.ts";
import { validateEngineeringProjectSnapshot } from "../src/domain/engineering-project-validation.ts";
import { validateThreadSnapshot } from "../src/domain/thread-snapshot-validation.ts";
import { INSPECTION_DRONE_ARCHITECTURE_OPERATION } from "../src/domain/inspection-drone-architecture.ts";
import { materializeAttestedMechanicalRun } from "../src/testing/attested-mechanical-run-fixture.ts";
import {
  createNativeWorkbenchHandler,
  NATIVE_WORKBENCH_LEGACY_PROJECT_ID,
  resolveNativeWorkbenchProjectId,
  resolveNativeWorkbenchSubjectId,
} from "./serve-native-workbench.ts";
import {
  FileLiveThreadUpdateStore,
  LiveThreadUpdateStore,
} from "../src/adapters/live-thread-update-store.ts";
import { HttpThreadWorkbenchClient } from "../src/ui/src/thread/client.ts";

Deno.test("native Workbench resolves a project-only V2 launch from the persisted project subject", async () => {
  const projectId = "drone-documentary-fixture-project";
  const project = documentaryProjectSnapshot(
    documentaryThreadSnapshot(`project:${projectId}`),
  );
  const projectStore = new ReadOnlyProjectStore(project);

  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, undefined),
    NATIVE_WORKBENCH_LEGACY_PROJECT_ID,
  );
  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, "operator-selected-subject"),
    "operator-selected-subject",
  );
  assertEquals(
    resolveNativeWorkbenchProjectId(projectId, "operator-selected-subject"),
    projectId,
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId(projectId, undefined, projectStore),
    `project:${projectId}`,
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId(
      projectId,
      "operator-selected-subject",
      projectStore,
    ),
    "operator-selected-subject",
  );
});

Deno.test("native Workbench handler serves the persisted projection without executing tools", async () => {
  const snapshot = await materializeAttestedMechanicalRun(capture());
  const store = new ReadOnlyStore(snapshot);
  const projectStore = new ReadOnlyProjectStore(projectSnapshot(snapshot));
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore,
    subjectId: snapshot.subject.id,
    html: "<!doctype html><title>Workbench</title>",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("X-Casys-Data-Source"),
    "canonical-thread-snapshot",
  );
  const body = await response.json();
  assertEquals(body.schemaVersion, "engineering-workbench/0.2");
  assertEquals(body.project.project.subjectId, snapshot.subject.id);
  assertEquals(body.thread.source, "observed");
  assertEquals(body.thread.requirements, []);
  assertEquals(body.capabilities.operatorCommands.enabled, false);
  assertEquals(body.capabilities.operatorCommands.intents, []);
  assertEquals(store.latestCalls, 1);
  assertEquals(store.saveCalls, 0);
  assertEquals(projectStore.getCalls, 1);

  const page = await handler(new Request("http://localhost/"));
  assertStringIncludes(await page.text(), "Workbench");
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "frame-ancestors 'none'",
  );
  assertEquals(page.headers.get("X-Frame-Options"), "DENY");
  const rejected = await handler(
    new Request("http://localhost/api/thread/workbench", {
      method: "POST",
    }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
});

Deno.test("native Workbench serves a planning-only project without borrowing the current thread", async () => {
  const active = await materializeAttestedMechanicalRun(capture());
  const store = new ReadOnlyStore(active);
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: new ReadOnlyProjectStore(
      planningProjectSnapshot(active.subject.id),
    ),
    subjectId: active.subject.id,
    html: "unused",
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("X-Casys-Data-Source"), "engineering-project-plan");
  assertEquals(body.surface, "planning");
  assertEquals(body.project.threadSnapshots, []);
  assertEquals(body.planning.technicalBaseline.status, "not-created");
  assertEquals("thread" in body, false);
  assertEquals(body.capabilities.operatorCommands.enabled, false);
  assertEquals(body.capabilities.operatorCommands.intents, []);
  assertEquals(store.latestCalls, 0);
});

Deno.test("native Workbench serves a V2 documentary baseline without exposing an evidence graph or provider detail", async () => {
  const thread = documentaryThreadSnapshot("drone-documentary-fixture");
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(thread),
    projectStore: new ReadOnlyProjectStore(documentaryProjectSnapshot(thread)),
    subjectId: thread.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();
  const payload = JSON.stringify(body).toLowerCase();

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("X-Casys-Data-Source"),
    "engineering-project-documentary-baseline",
  );
  assertEquals(body.surface, "documentary");
  assertEquals(body.documentary.status, "recorded");
  assertEquals(body.documentary.record.origin, "approved-discovery");
  assertEquals(body.documentary.record.snapshotId, thread.id);
  assertEquals(body.documentary.record.snapshotRevision, 1);
  assertEquals(body.documentary.technicalEvidence.status, "not-recorded");
  assertEquals("thread" in body, false);
  assertEquals("alignment" in body, false);
  for (
    const forbidden of [
      "provider",
      "build123d",
      "calculix",
      "syson",
      "mcp://",
    ]
  ) {
    assertEquals(
      payload.includes(forbidden),
      false,
      `${forbidden} must not cross the documentary HTTP boundary`,
    );
  }
});

Deno.test("native Workbench V2 documentary BFF round-trips through the browser HTTP client", async () => {
  const projectId = "drone-documentary-fixture-project";
  const thread = documentaryThreadSnapshot(`project:${projectId}`);
  const project = documentaryProjectSnapshot(thread);
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(thread),
    projectStore: new ReadOnlyProjectStore(project),
    projectId: project.project.id,
    subjectId: thread.subject.id,
    html: "unused",
  });
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handler);

  try {
    const address = server.addr as Deno.NetAddr;
    const client = new HttpThreadWorkbenchClient(
      `http://127.0.0.1:${address.port}/api/thread/workbench`,
    );
    const workbench = await client.load();

    assertEquals(client.source, "http");
    assertEquals(workbench.surface, "documentary");
    if (workbench.surface !== "documentary") {
      throw new Error("Expected the V2 project to render as documentary provenance.");
    }
    assertEquals(workbench.project.schemaVersion, "2.0");
    assertEquals(
      workbench.project.plan?.basis.kind,
      "approved-discovery",
    );
    assertEquals(
      workbench.project.discoveryHandoff?.approvedBy.origin,
      "human",
    );
    assertEquals(workbench.documentary.record.snapshotId, thread.id);
    assertEquals(workbench.documentary.technicalEvidence.status, "not-recorded");
  } finally {
    await server.shutdown();
  }
});

Deno.test("native Workbench holds an unpublished SysON seed r2 behind documentary r1", async () => {
  const r1 = documentaryThreadSnapshot("drone-documentary-fixture");
  const unpublishedR2 = unpublishedSeedThreadSnapshot(r1);
  const project = documentaryProjectWithPublishingSeed(r1);
  const liveUpdates = new LiveThreadUpdateStore();
  await liveUpdates.append({
    subjectId: r1.subject.id,
    runId: "run-seed-syson",
    operationId: "architecture.seed-syson-model:syson_element_get",
    baseRevision: 1,
    state: "fresh",
    recordedAt: "2026-08-02T12:11:30.000Z",
    graph: {
      nodes: [{
        id: "private-provider-result",
        ref: { kind: "artifact", id: "private-provider-result" },
        entityKind: "artifact",
        label: "provider raw result must not cross",
        system: "private",
        freshness: "fresh",
        summary: "private",
      }],
      edges: [],
    },
  });
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(unpublishedR2, [r1, unpublishedR2]),
    projectStore: new ReadOnlyProjectStore(project),
    subjectId: r1.subject.id,
    html: "unused",
    liveUpdates,
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();
  const payload = JSON.stringify(body);

  assertEquals(response.status, 200);
  assertEquals(body.surface, "documentary");
  assertEquals(body.documentary.record.snapshotId, r1.id);
  assertEquals(body.documentary.technicalStart.state, "publishing");
  assertEquals("thread" in body, false);
  assertEquals(payload.includes(unpublishedR2.id), false);
  assertEquals(payload.includes("provider raw result must not cross"), false);
});

Deno.test("native Workbench holds an unattached inspection-drone architecture r3 behind r2 while preserving its live feed", async () => {
  const r1 = documentaryThreadSnapshot("drone-architecture-fixture");
  const r2 = unpublishedSeedThreadSnapshot(r1);
  const unpublishedR3 = unpublishedInspectionDroneArchitectureThreadSnapshot(r2);
  const project = projectWithPublishingInspectionDroneArchitecture(r2);
  const liveUpdates = new LiveThreadUpdateStore();
  await liveUpdates.append({
    subjectId: r2.subject.id,
    runId: "run-author-inspection-drone",
    operationId: `${INSPECTION_DRONE_ARCHITECTURE_OPERATION.id}:syson_element_children`,
    baseRevision: r2.revision,
    state: "fresh",
    recordedAt: "2026-08-03T12:11:30.000Z",
    graph: {
      nodes: [{
        id: "run-author-inspection-drone:root-preflight",
        ref: {
          kind: "artifact",
          id: "run-author-inspection-drone:root-preflight",
        },
        entityKind: "artifact",
        artifactKind: "other",
        label: "Root package preflight",
        system: "SysON",
        freshness: "fresh",
        summary:
          "The bounded architecture run confirmed its target before its one guarded insertion.",
      }],
      edges: [],
    },
  });
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(unpublishedR3, [r1, r2, unpublishedR3]),
    projectStore: new ReadOnlyProjectStore(project),
    subjectId: r2.subject.id,
    html: "unused",
    liveUpdates,
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();
  const payload = JSON.stringify(body);

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.thread.id, r2.id);
  assertEquals(body.thread.live.active, [{
    runId: "run-author-inspection-drone",
    operationId: `${INSPECTION_DRONE_ARCHITECTURE_OPERATION.id}:syson_element_children`,
    state: "fresh",
    recordedAt: "2026-08-03T12:11:30.000Z",
    baseRevision: r2.revision,
    sequence: 1,
  }]);
  assertEquals(
    body.thread.graph.nodes.some((node: { id: string }) =>
      node.id === "run-author-inspection-drone:root-preflight"
    ),
    true,
  );
  assertEquals(payload.includes(unpublishedR3.id), false);
});

Deno.test("native Workbench V2 planning BFF round-trips through the browser HTTP client", async () => {
  const projectId = "drone-documentary-fixture-project";
  const subjectId = `project:${projectId}`;
  const project = v2PlanningProjectSnapshot(subjectId);
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(undefined),
    projectStore: new ReadOnlyProjectStore(project),
    projectId: project.project.id,
    subjectId,
    html: "unused",
  });
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handler);

  try {
    const address = server.addr as Deno.NetAddr;
    const client = new HttpThreadWorkbenchClient(
      `http://127.0.0.1:${address.port}/api/thread/workbench`,
    );
    const workbench = await client.load();

    assertEquals(client.source, "http");
    assertEquals(workbench.surface, "planning");
    if (workbench.surface !== "planning") {
      throw new Error("Expected the V2 project to render as planning intent.");
    }
    assertEquals(workbench.project.schemaVersion, "2.0");
    assertEquals(workbench.project.threadSnapshots, []);
    assertEquals(
      workbench.project.plan?.basis.kind,
      "approved-discovery",
    );
    assertEquals(
      workbench.project.discoveryHandoff?.approvedBy.origin,
      "human",
    );
    assertEquals(workbench.planning.technicalBaseline.status, "not-created");
  } finally {
    await server.shutdown();
  }
});

Deno.test("native Workbench projects only filtered baseline activity before evidence exists", async () => {
  const active = await materializeAttestedMechanicalRun(capture());
  const liveUpdates = new LiveThreadUpdateStore();
  await liveUpdates.append({
    subjectId: active.subject.id,
    runId: "run-first-baseline",
    operationId: "never-sent-to-browser",
    baseRevision: 0,
    state: "running",
    recordedAt: "2026-08-01T12:01:00.000Z",
    graph: {
      nodes: [{
        id: "graph:provider-secret",
        ref: { kind: "artifact", id: "provider-secret" },
        entityKind: "artifact",
        label: "provider structured output",
        system: "provider-private",
        freshness: "running",
        summary: "raw provider data",
      }],
      edges: [],
    },
  });
  await liveUpdates.append({
    subjectId: active.subject.id,
    runId: "other-run",
    operationId: "not-the-baseline",
    baseRevision: 0,
    state: "failed",
    recordedAt: "2026-08-01T12:02:00.000Z",
    graph: { nodes: [], edges: [] },
  });
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(active),
    projectStore: new ReadOnlyProjectStore(
      planningProjectWithBaselineRun(active.subject.id),
    ),
    subjectId: active.subject.id,
    html: "unused",
    liveUpdates,
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();
  const payload = JSON.stringify(body);

  assertEquals(body.surface, "planning");
  assertEquals(body.planning.technicalBaseline.status, "running");
  assertEquals(body.planning.baselineRun.status, "running");
  assertEquals(body.planning.activity, {
    version: 2,
    milestones: [{
      sequence: 1,
      state: "running",
      recordedAt: "2026-08-01T12:01:00.000Z",
    }],
  });
  assertEquals(payload.includes("provider structured output"), false);
  assertEquals(payload.includes("provider-secret"), false);
  assertEquals(payload.includes("raw provider data"), false);
  assertEquals(payload.includes("provider raw summary that must not be shown"), false);
  assertEquals(payload.includes("not-the-baseline"), false);
  assertEquals("thread" in body, false);
});

Deno.test("native Workbench loads the declared exact baseline when active state is empty", async () => {
  const baseline = await materializeAttestedMechanicalRun(capture());
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(undefined),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(baseline)),
    projectSnapshots: new VersionedReadOnlyStore(baseline, [baseline]),
    subjectId: baseline.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.thread.id, baseline.id);
  assertEquals(body.alignment, {
    status: "aligned",
    projectThreadRevision: baseline.revision,
    currentThreadRevision: baseline.revision,
  });
});

Deno.test("native Workbench selects a newer declared exact baseline over stale active state", async () => {
  const active = await materializeAttestedMechanicalRun(capture());
  const declared: ThreadSnapshot = {
    ...structuredClone(active),
    id: `${active.id}:declared-next`,
    revision: active.revision + 1,
    previous: { snapshotId: active.id, revision: active.revision },
  };
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(active, [active]),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(declared)),
    projectSnapshots: new VersionedReadOnlyStore(declared, [declared]),
    subjectId: declared.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.thread.id, declared.id);
  assertEquals(body.alignment.currentThreadRevision, declared.revision);
  assertEquals(body.alignment.status, "aligned");
});

Deno.test("native Workbench fails closed on divergent ids at one thread revision", async () => {
  const active = await materializeAttestedMechanicalRun(capture());
  const declared: ThreadSnapshot = {
    ...structuredClone(active),
    id: `${active.id}:divergent`,
  };
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(active, [active]),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(declared)),
    projectSnapshots: new VersionedReadOnlyStore(declared, [declared]),
    subjectId: declared.subject.id,
    html: "unused",
  });

  await assertRejects(
    () => handler(new Request("http://localhost/api/thread/workbench")),
    Error,
    `Ambiguous ThreadSnapshot revision ${active.revision}`,
  );
});

Deno.test("native Workbench does not promote a newer parallel active branch", async () => {
  const declared = await materializeAttestedMechanicalRun(capture());
  const parallelBase: ThreadSnapshot = {
    ...structuredClone(declared),
    id: `${declared.id}:parallel-base`,
  };
  const parallelHead: ThreadSnapshot = {
    ...structuredClone(parallelBase),
    id: `${declared.id}:parallel-head`,
    revision: declared.revision + 1,
    previous: {
      snapshotId: parallelBase.id,
      revision: parallelBase.revision,
    },
  };
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(parallelHead, [parallelBase, parallelHead]),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(declared)),
    projectSnapshots: new VersionedReadOnlyStore(declared, [declared]),
    subjectId: declared.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.thread.id, declared.id);
  assertEquals(body.alignment, {
    status: "aligned",
    projectThreadRevision: declared.revision,
    currentThreadRevision: declared.revision,
  });
});

Deno.test("native Workbench handler reports a missing engineering project", async () => {
  const snapshot = await materializeAttestedMechanicalRun(capture());
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(snapshot),
    projectStore: new ReadOnlyProjectStore(undefined),
    subjectId: snapshot.subject.id,
    html: "unused",
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error, "engineering_project_not_found");
});

Deno.test("native Workbench serves a newer thread and makes project alignment lag explicit", async () => {
  const declared = await materializeAttestedMechanicalRun(capture());
  const current: ThreadSnapshot = {
    ...structuredClone(declared),
    id: `${declared.id}:next`,
    revision: declared.revision + 1,
    previous: { snapshotId: declared.id, revision: declared.revision },
  };
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(current, [declared, current]),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(declared)),
    subjectId: current.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.project.threadSnapshots[0].snapshotId, declared.id);
  assertEquals(body.thread.id, current.id);
  assertEquals(body.alignment, {
    status: "thread-ahead",
    projectThreadRevision: declared.revision,
    currentThreadRevision: current.revision,
  });
});

Deno.test("native Workbench resolves an exact project baseline when active state has advanced", async () => {
  const declared = await materializeAttestedMechanicalRun(capture());
  const current: ThreadSnapshot = {
    ...structuredClone(declared),
    id: `${declared.id}:next`,
    revision: declared.revision + 1,
    previous: { snapshotId: declared.id, revision: declared.revision },
  };
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(current, [current]),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(declared)),
    projectSnapshots: new VersionedReadOnlyStore(declared, [declared]),
    subjectId: current.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.thread.id, current.id);
  assertEquals(body.project.threadSnapshots[0].snapshotId, declared.id);
  assertEquals(body.alignment.status, "thread-ahead");
});

Deno.test("native Workbench never substitutes latest for a missing exact project reference", async () => {
  const declared = await materializeAttestedMechanicalRun(capture());
  const current: ThreadSnapshot = {
    ...structuredClone(declared),
    id: `${declared.id}:next`,
    revision: declared.revision + 1,
    previous: { snapshotId: declared.id, revision: declared.revision },
  };
  const handler = createNativeWorkbenchHandler({
    store: new VersionedReadOnlyStore(current, [current]),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(declared)),
    subjectId: current.subject.id,
    html: "unused",
  });

  await assertRejects(
    () => handler(new Request("http://localhost/api/thread/workbench")),
    Error,
    "does not resolve to a supplied exact ThreadSnapshot revision",
  );
});

Deno.test("native Workbench serves only explicitly loaded STL presentation assets", async () => {
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(undefined),
    projectStore: new ReadOnlyProjectStore(projectSnapshot()),
    subjectId: "subject",
    html: "unused",
    assetReader: (filename) =>
      Promise.resolve(
        filename === "support.stl" ? new Uint8Array([1, 2, 3]) : undefined,
      ),
  });
  const asset = await handler(
    new Request("http://localhost/api/thread/assets/support.stl"),
  );
  assertEquals(asset.status, 200);
  assertEquals(asset.headers.get("Content-Type"), "model/stl");
  assertEquals(
    new Uint8Array(await asset.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );

  const traversal = await handler(
    new Request("http://localhost/api/thread/assets/%2e%2e%2fsecret.stl"),
  );
  assertEquals(traversal.status, 400);
  const rejectedType = await handler(
    new Request("http://localhost/api/thread/assets/support.step"),
  );
  assertEquals(rejectedType.status, 400);
});

Deno.test("native Workbench streams persisted snapshot revisions as SSE", async () => {
  const snapshot = await materializeAttestedMechanicalRun(capture());
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(snapshot),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(snapshot)),
    subjectId: snapshot.subject.id,
    html: "unused",
    pollIntervalMs: 5,
  });
  const controller = new AbortController();
  const response = await handler(
    new Request("http://localhost/api/thread/workbench/events", {
      signal: controller.signal,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  const event = new TextDecoder().decode(first.value);
  controller.abort();
  await reader.cancel();

  assertStringIncludes(event, `id: 1:${snapshot.revision}:0`);
  assertStringIncludes(event, "event: workbench-snapshot");
  assertStringIncludes(event, '"schemaVersion":"engineering-workbench/0.2"');
  assertStringIncludes(event, '"schemaVersion":"thread-workbench/0.1"');
  assertStringIncludes(event, `"subjectId":"${snapshot.subject.id}"`);
});

Deno.test("native Workbench SSE publishes a complete planning replacement before a technical baseline exists", async () => {
  const active = await materializeAttestedMechanicalRun(capture());
  const store = new ReadOnlyStore(active);
  const projectStore = new ReadOnlyProjectStore(
    planningProjectSnapshot(active.subject.id),
  );
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore,
    subjectId: active.subject.id,
    html: "unused",
    pollIntervalMs: 5,
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  const reader = response.body!.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);

  assertStringIncludes(initial, "id: planning:1:0");
  assertStringIncludes(initial, "event: workbench-snapshot");
  assertStringIncludes(initial, '"surface":"planning"');
  assertStringIncludes(initial, '"status":"not-created"');
  assertEquals(initial.includes('"thread"'), false);
  assertEquals(store.latestCalls, 0);

  projectStore.replace(planningProjectSnapshot(active.subject.id, 2));
  const replacement = new TextDecoder().decode((await reader.read()).value);
  assertStringIncludes(replacement, "id: planning:2:0");
  assertStringIncludes(replacement, '"revision":2');
  assertStringIncludes(replacement, '"surface":"planning"');
  await reader.cancel();
});

Deno.test("native Workbench SSE refreshes planning activity without a project revision", async () => {
  const active = await materializeAttestedMechanicalRun(capture());
  const liveUpdates = new LiveThreadUpdateStore();
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(active),
    projectStore: new ReadOnlyProjectStore(
      planningProjectWithBaselineRun(active.subject.id),
    ),
    subjectId: active.subject.id,
    html: "unused",
    liveUpdates,
    pollIntervalMs: 5,
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  const reader = response.body!.getReader();

  const initial = new TextDecoder().decode((await reader.read()).value);
  assertStringIncludes(initial, "id: planning:1:0");
  assertStringIncludes(initial, '"milestones":[]');

  await liveUpdates.append({
    subjectId: active.subject.id,
    runId: "run-first-baseline",
    operationId: "hidden-operation",
    baseRevision: 0,
    state: "running",
    recordedAt: "2026-08-01T12:01:00.000Z",
    graph: {
      nodes: [{
        id: "provider-node",
        ref: { kind: "artifact", id: "private" },
        entityKind: "artifact",
        label: "must not cross planning boundary",
        system: "private",
        freshness: "running",
        summary: "private",
      }],
      edges: [],
    },
  });
  const update = new TextDecoder().decode((await reader.read()).value);
  assertStringIncludes(update, "id: planning:1:1");
  assertStringIncludes(update, '"sequence":1');
  assertEquals(update.includes("must not cross planning boundary"), false);
  assertEquals(update.includes("hidden-operation"), false);
  await reader.cancel();
});

Deno.test("native Workbench SSE starts from the declared baseline without active state", async () => {
  const baseline = await materializeAttestedMechanicalRun(capture());
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(undefined),
    projectStore: new ReadOnlyProjectStore(projectSnapshot(baseline)),
    projectSnapshots: new VersionedReadOnlyStore(baseline, [baseline]),
    subjectId: baseline.subject.id,
    html: "unused",
    pollIntervalMs: 5,
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  const reader = response.body!.getReader();
  const event = new TextDecoder().decode((await reader.read()).value);

  assertStringIncludes(event, `id: 1:${baseline.revision}:0`);
  assertStringIncludes(event, `"id":"${baseline.id}"`);
  assertStringIncludes(event, '"status":"aligned"');
  await reader.cancel();
});

Deno.test("native Workbench SSE observes a cross-process live update without a new snapshot revision", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-workbench-live-" });
  const controller = new AbortController();
  try {
    const snapshot = await materializeAttestedMechanicalRun(capture());
    const writer = new FileLiveThreadUpdateStore(directory);
    const readerStore = new FileLiveThreadUpdateStore(directory);
    const handler = createNativeWorkbenchHandler({
      store: new ReadOnlyStore(snapshot),
      projectStore: new ReadOnlyProjectStore(projectSnapshot(snapshot)),
      subjectId: snapshot.subject.id,
      html: "unused",
      liveUpdates: readerStore,
      pollIntervalMs: 5,
    });
    const response = await handler(
      new Request("http://localhost/api/thread/workbench/events", {
        headers: { "Last-Event-ID": `1:${snapshot.revision}:0` },
        signal: controller.signal,
      }),
    );
    const responseReader = response.body!.getReader();

    await writer.append({
      subjectId: snapshot.subject.id,
      runId: "live-run-1",
      operationId: "build123d-export",
      baseRevision: snapshot.revision,
      state: "running",
      recordedAt: "2026-08-01T10:00:00.000Z",
      graph: { nodes: [liveCadNode("running")], edges: [] },
    });
    const started = new TextDecoder().decode((await responseReader.read()).value);
    assertStringIncludes(started, `id: 1:${snapshot.revision}:1`);
    assertStringIncludes(started, '"id":"graph:artifact:coffee-machine-cad-live"');
    assertStringIncludes(started, '"freshness":"running"');

    // Deno.serve's legacy lifecycle aborts request.signal after returning a
    // successful streaming response. The SSE body must remain driven by its
    // own cancellation lifecycle so later persisted updates still arrive.
    controller.abort();

    await writer.append({
      subjectId: snapshot.subject.id,
      runId: "live-run-1",
      operationId: "build123d-export",
      baseRevision: snapshot.revision,
      state: "fresh",
      recordedAt: "2026-08-01T10:00:01.000Z",
      graph: {
        nodes: [{ ...liveCadNode("fresh"), summary: "STEP and GLB exported" }],
        edges: [],
      },
    });
    const completed = new TextDecoder().decode((await responseReader.read()).value);
    assertStringIncludes(completed, `id: 1:${snapshot.revision}:2`);
    assertStringIncludes(completed, '"freshness":"fresh"');
    assertEquals(
      completed.match(/graph:artifact:coffee-machine-cad-live/g)?.length,
      1,
    );

    controller.abort();
    await responseReader.cancel();
  } finally {
    controller.abort();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench SSE emits a complete replacement when only the project revision changes", async () => {
  const snapshot = await materializeAttestedMechanicalRun(capture());
  const projectStore = new ReadOnlyProjectStore(projectSnapshot(snapshot));
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(snapshot),
    projectStore,
    subjectId: snapshot.subject.id,
    html: "unused",
    pollIntervalMs: 5,
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench/events", {
      headers: { "Last-Event-ID": `1:${snapshot.revision}:0` },
    }),
  );
  const reader = response.body!.getReader();

  projectStore.replace(projectSnapshot(snapshot, 2));
  const event = new TextDecoder().decode((await reader.read()).value);

  assertStringIncludes(event, `id: 2:${snapshot.revision}:0`);
  assertStringIncludes(event, '"schemaVersion":"engineering-workbench/0.2"');
  assertStringIncludes(event, '"revision":2');
  assertStringIncludes(event, `"id":"${snapshot.id}"`);
  await reader.cancel();
});

Deno.test("native Workbench applies explicit same-origin operator commands with CAS, replay, and SSE", async () => {
  const project = validateEngineeringProjectSnapshot(
    JSON.parse(
      await Deno.readTextFile(
        "config/projects/coffee-machine-cm01.project.json",
      ),
    ),
  );
  const thread = validateThreadSnapshot(
    JSON.parse(
      await Deno.readTextFile(
        "config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
      ),
    ),
  );
  const projectStore = new ReadOnlyProjectStore(project);
  const commands = new EngineeringProjectCommandService(
    projectStore,
    undefined,
    () => "2026-08-01T14:00:00.000Z",
  );
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(thread),
    projectStore,
    projectCommands: commands,
    projectSnapshots: new VersionedReadOnlyStore(thread, [thread]),
    subjectId: project.project.id,
    html: "unused",
    pollIntervalMs: 5,
  });
  const command = {
    schemaVersion: "engineering-project-command/1.0",
    commandId: "operator-proposal-1",
    projectId: project.project.id,
    expectedRevision: 1,
    issuedAt: "2026-08-01T21:59:58+08:00",
    actor: { id: "engineer-erwan" },
    command: {
      type: "decision.propose",
      decisionId: "review-mechanical-proof-case",
      proposal: {
        summary: "Use the reviewed aluminium material card.",
        parameters: [{
          key: "youngs-modulus",
          label: "Young's modulus",
          value: 69,
          unit: "GPa",
        }],
      },
    },
  };

  const applied = await handler(operatorRequest(command));
  assertEquals(applied.status, 200);
  const composite = await applied.json();
  assertEquals(composite.schemaVersion, "engineering-workbench/0.2");
  assertEquals(composite.project.revision, 2);
  assertEquals(
    composite.project.commandReceipts[0].issuedAt,
    "2026-08-01T13:59:58.000Z",
  );
  assertEquals(composite.capabilities.operatorCommands.expectedRevision, 2);
  assertEquals(composite.capabilities.operatorCommands.enabled, true);
  assertEquals(
    composite.project.decisions.find((item: { id: string }) =>
      item.id === "review-mechanical-proof-case"
    ).proposal.parameters[0],
    {
      key: "youngs-modulus",
      label: "Young's modulus",
      value: 69,
      unit: "GPa",
    },
  );

  const replay = await handler(operatorRequest(command));
  assertEquals(replay.status, 200);
  assertEquals((await replay.json()).project.revision, 2);

  const conflict = await handler(operatorRequest({
    ...command,
    commandId: "stale-proposal-2",
  }));
  assertEquals(conflict.status, 409);
  assertEquals(await conflict.json(), {
    error: "stale_revision",
    message:
      "Engineering project coffee-machine-cm01 expected revision 1, current revision is 2.",
    expectedRevision: 1,
    actualRevision: 2,
  });

  const commandIdConflict = await handler(operatorRequest({
    ...command,
    command: {
      ...command.command,
      proposal: {
        ...command.command.proposal,
        summary: "A different retry payload.",
      },
    },
  }));
  assertEquals(commandIdConflict.status, 409);
  assertEquals((await commandIdConflict.json()).error, "command_id_conflict");

  const missingOrigin = await handler(operatorRequest(command, {
    Origin: null,
  }));
  assertEquals(missingOrigin.status, 403);
  const reboundHost = await handler(operatorRequest(command, {
    Origin: "http://evil.example:5173",
  }, "http://evil.example:5173/api/project/commands"));
  assertEquals(reboundHost.status, 403);
  assertEquals((await reboundHost.json()).error, "loopback_host_required");
  const missingIntent = await handler(operatorRequest(command, {
    "X-Casys-Operator-Intent": null,
  }));
  assertEquals(missingIntent.status, 403);
  const wrongContentType = await handler(operatorRequest(command, {
    "Content-Type": "text/plain",
  }));
  assertEquals(wrongContentType.status, 415);

  let current = composite;
  const materialFingerprint = current.project.decisions.find(
    (item: { id: string }) => item.id === "review-mechanical-proof-case",
  ).inputFingerprint;
  current = await applyHumanCommand(
    "reject-material-1",
    2,
    {
      type: "decision.reject",
      decisionId: "review-mechanical-proof-case",
      rationale: "The material card needs a named source before approval.",
      inputFingerprint: materialFingerprint,
    },
  );
  assertEquals(
    current.project.decisions.find((item: { id: string }) =>
      item.id === "review-mechanical-proof-case"
    ).status,
    "rejected",
  );

  current = await proposeAndApprove(
    "review-mechanical-proof-case",
    current.project.revision,
  );
  assertEquals(current.project.revision, 5);

  current = await applyHumanCommand(
    "queue-mechanical-verification-1",
    current.project.revision,
    {
      type: "agent-run.queue",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue mechanical verification with all reviewed inputs.",
    },
  );
  assertEquals(current.project.revision, 6);
  assertEquals(current.project.agentRuns.at(-1), {
    id: "run:queue-mechanical-verification-1",
    workItemId: "verify-current-mechanical-design",
    status: "queued",
    summary: "Queue mechanical verification with all reviewed inputs.",
    queuedAt: "2026-08-01T14:00:00.000Z",
    baseSnapshot: project.threadSnapshots[0],
    inputFingerprint: current.project.agentRuns.at(-1).inputFingerprint,
    evidenceRefs: [],
    statusHistory: [{
      commandId: "queue-mechanical-verification-1",
      status: "queued",
      at: "2026-08-01T14:00:00.000Z",
      actor: { id: "engineer-erwan", origin: "human" },
      summary: "Queue mechanical verification with all reviewed inputs.",
    }],
  });
  assertEquals(
    current.project.blockers.every((item: { status: string }) =>
      item.status === "resolved"
    ),
    true,
  );

  const events = await handler(
    new Request("http://localhost/api/thread/workbench/events", {
      headers: { "Last-Event-ID": `1:${thread.revision}:0` },
    }),
  );
  const reader = events.body!.getReader();
  const event = new TextDecoder().decode((await reader.read()).value);
  assertStringIncludes(event, `id: 6:${thread.revision}:0`);
  assertStringIncludes(event, '"commandId":"queue-mechanical-verification-1"');
  await reader.cancel();

  async function proposeAndApprove(
    decisionId: string,
    expectedRevision: number,
  ) {
    const proposed = await applyHumanCommand(
      `propose-${decisionId}-${expectedRevision}`,
      expectedRevision,
      {
        type: "decision.propose",
        decisionId,
        proposal: {
          summary: `Reviewed proposal for ${decisionId}.`,
          parameters: [{
            key: "reviewed-value",
            label: "Reviewed value",
            value: "Defined in the controlled input record",
          }],
        },
      },
    );
    const fingerprint = proposed.project.decisions.find(
      (item: { id: string }) => item.id === decisionId,
    ).inputFingerprint;
    return await applyHumanCommand(
      `approve-${decisionId}-${proposed.project.revision}`,
      proposed.project.revision,
      {
        type: "decision.approve",
        decisionId,
        rationale: "Reviewed against the displayed exact input fingerprint.",
        inputFingerprint: fingerprint,
      },
    );
  }

  async function applyHumanCommand(
    commandId: string,
    expectedRevision: number,
    humanCommand: Record<string, unknown>,
  ) {
    const response = await handler(operatorRequest({
      schemaVersion: "engineering-project-command/1.0",
      commandId,
      projectId: project.project.id,
      expectedRevision,
      issuedAt: "2026-08-01T13:59:58.000Z",
      actor: { id: "engineer-erwan" },
      command: humanCommand,
    }));
    assertEquals(response.status, 200);
    return await response.json();
  }
});

class ReadOnlyStore implements ThreadSnapshotStore {
  latestCalls = 0;
  saveCalls = 0;
  constructor(private readonly snapshot: ThreadSnapshot | undefined) {}
  get(): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.snapshot);
  }
  latest(): Promise<ThreadSnapshot | undefined> {
    this.latestCalls++;
    return Promise.resolve(this.snapshot);
  }
  save(): Promise<void> {
    this.saveCalls++;
    return Promise.resolve();
  }
}

class VersionedReadOnlyStore implements ThreadSnapshotStore {
  readonly #snapshots: Map<string, ThreadSnapshot>;

  constructor(
    private readonly head: ThreadSnapshot,
    snapshots: readonly ThreadSnapshot[],
  ) {
    this.#snapshots = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  }

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.#snapshots.get(snapshotId));
  }

  latest(): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.head);
  }

  save(): Promise<void> {
    throw new Error("Read-only test store cannot save.");
  }
}

class ReadOnlyProjectStore implements EngineeringProjectRevisionStore {
  getCalls = 0;
  private readonly revisions = new Map<number, EngineeringProjectSnapshot>();
  constructor(
    private project: EngineeringProjectSnapshot | undefined,
  ) {
    if (project) this.revisions.set(project.revision, project);
  }
  get(_projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    this.getCalls++;
    return Promise.resolve(this.project);
  }
  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(this.revisions.get(revision));
  }
  createInitial(
    project: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.project) throw new Error("Project already exists.");
    this.replace(project);
    return Promise.resolve(project);
  }
  commit(
    project: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.project?.revision !== expectedRevision) {
      throw new Error("Project revision conflict.");
    }
    this.replace(project);
    return Promise.resolve(project);
  }
  replace(project: EngineeringProjectSnapshot | undefined): void {
    this.project = project;
    if (project) this.revisions.set(project.revision, project);
  }
}

function projectSnapshot(
  thread?: ThreadSnapshot,
  revision = 1,
): EngineeringProjectSnapshot {
  const subjectId = thread?.subject.id ?? "missing";
  return {
    schemaVersion: "1.0",
    id: `engineering-project-fixture-r${revision}`,
    revision,
    ...(revision > 1
      ? {
        previous: {
          snapshotId: `engineering-project-fixture-r${revision - 1}`,
          revision: revision - 1,
        },
      }
      : {}),
    generatedAt: "2026-08-01T03:03:48.000Z",
    project: {
      id: "engineering-project-fixture",
      name: "Engineering project fixture",
      subjectId,
      objective: {
        title: "Verify a fixture",
        statement: "Exercise the read-only Workbench composition boundary.",
      },
    },
    threadSnapshots: thread
      ? [{
        snapshotId: thread.id,
        revision: thread.revision,
        subjectId,
      }]
      : [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    ...(revision > 1
      ? {
        commandReceipts: Array.from({ length: revision - 1 }, (_, index) => {
          const resultingRevision = index + 2;
          return {
            commandId: `fixture-command-r${resultingRevision}`,
            type: "agent-run.queue" as const,
            actor: { id: "fixture", origin: "human" as const },
            issuedAt: "2026-08-01T03:03:48.000Z",
            appliedAt: "2026-08-01T03:03:48.000Z",
            requestFingerprint: {
              algorithm: "sha256" as const,
              digest: String(resultingRevision).padStart(64, "0"),
            },
            resultingSnapshot: {
              snapshotId: `engineering-project-fixture-r${resultingRevision}`,
              revision: resultingRevision,
            },
          };
        }),
      }
      : {}),
  };
}

function planningProjectSnapshot(
  subjectId: string,
  revision = 1,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
    id: `engineering-project-planning-r${revision}`,
    revision,
    ...(revision > 1
      ? {
        previous: {
          snapshotId: `engineering-project-planning-r${revision - 1}`,
          revision: revision - 1,
        },
      }
      : {}),
    generatedAt: "2026-08-01T03:03:48.000Z",
    project: {
      id: "engineering-project-planning",
      name: "Discovery planning fixture",
      subjectId,
      objective: {
        title: "Build a reviewable first engineering path",
        statement:
          "Keep the discovery intent durable before any technical evidence exists.",
      },
    },
    discoveryHandoff: {
      discoveryId: "drone-concept",
      snapshotId: "discovery-snapshot-r3",
      revision: 3,
      briefId: "brief-drone-concept",
      approvedBriefFingerprint: {
        algorithm: "sha256",
        digest: "d".repeat(64),
      },
      approvedAt: "2026-08-01T03:00:00.000Z",
      approvedBy: { id: "engineer-erwan", origin: "human" },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis: {
        kind: "approved-discovery",
        discoveryId: "drone-concept",
        snapshotId: "discovery-snapshot-r3",
        revision: 3,
        briefId: "brief-drone-concept",
        approvedBriefFingerprint: {
          algorithm: "sha256",
          digest: "d".repeat(64),
        },
      },
      publishedAt: "2026-08-01T03:03:48.000Z",
      publishedBy: { id: "engineering-agent", origin: "agent" },
    },
    threadSnapshots: [],
    phases: [{
      id: "define",
      name: "Define",
      order: 1,
      description: "Turn approved discovery into an explicit first system scope.",
      workItemIds: ["work-define"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-define",
      phaseId: "define",
      title: "Prepare the first system definition",
      description: "Publish the bounded definition the human will review.",
      kind: "define",
      operation: {
        id: "intake.idea-or-spec",
        version: "1",
        bindings: [{ name: "brief", source: { kind: "approved-discovery" } }],
      },
      status: "planned",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

/**
 * A real V2 project after its agent-published plan, before its first
 * documentary baseline. It deliberately has no ThreadSnapshot to prove the
 * browser accepts planning intent without borrowing technical evidence.
 */
function v2PlanningProjectSnapshot(
  subjectId: string,
): EngineeringProjectSnapshot {
  const documentaryProject = documentaryProjectSnapshot(
    documentaryThreadSnapshot(subjectId),
  );
  return validateEngineeringProjectSnapshot({
    ...structuredClone(documentaryProject),
    threadSnapshots: [],
    phases: documentaryProject.phases.map((phase) => ({
      ...phase,
      evidenceRefs: [],
    })),
    workItems: documentaryProject.workItems.map((item) => ({
      ...item,
      status: "ready",
      evidenceRefs: [],
    })),
  });
}

function planningProjectWithBaselineRun(
  subjectId: string,
): EngineeringProjectSnapshot {
  const project = planningProjectSnapshot(subjectId);
  return {
    ...project,
    workItems: project.workItems.map((item) => ({
      ...item,
      status: item.id === "work-define" ? "in-progress" : item.status,
    })),
    agentRuns: [{
      id: "run-first-baseline",
      workItemId: "work-define",
      status: "running",
      summary: "provider raw summary that must not be shown",
      queuedAt: "2026-08-01T12:00:00.000Z",
      startedAt: "2026-08-01T12:00:30.000Z",
      evidenceRefs: [],
      statusHistory: [{
        commandId: "queue-first-baseline",
        status: "queued",
        at: "2026-08-01T12:00:00.000Z",
        actor: { id: "operator", origin: "human" },
        summary: "provider raw summary that must not be shown",
      }, {
        commandId: "claim-first-baseline",
        status: "running",
        at: "2026-08-01T12:00:30.000Z",
        actor: { id: "agent", origin: "agent" },
        summary: "provider raw summary that must not be shown",
      }],
    }],
  };
}

/**
 * The root V2 record is structurally valid but deliberately contains only a
 * documentary capture. It must not borrow an observed CAD/SysML/solver graph
 * merely so this HTTP test can exercise the normal handler path.
 */
function documentaryProjectSnapshot(
  thread: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const fingerprint = {
    algorithm: "sha256" as const,
    digest: "d".repeat(64),
  };
  const projectId = "drone-documentary-fixture-project";
  const initialSnapshotId = `${projectId}:r1:created-from-discovery`;
  const currentSnapshotId = `${projectId}:r2:reviewed-plan`;
  const artifactId = thread.artifacts[0]!.id;
  const evidenceRef = {
    snapshotId: thread.id,
    snapshotRevision: thread.revision,
    kind: "artifact" as const,
    id: artifactId,
  };
  const basis = {
    kind: "approved-discovery" as const,
    discoveryId: "drone-documentary-discovery",
    snapshotId: "drone-documentary-discovery:r3:approved",
    revision: 3,
    briefId: "drone-documentary-brief-v1",
    approvedBriefFingerprint: fingerprint,
  };
  return validateEngineeringProjectSnapshot({
    schemaVersion: "2.0",
    id: currentSnapshotId,
    revision: 2,
    previous: { snapshotId: initialSnapshotId, revision: 1 },
    generatedAt: "2026-08-02T12:05:00.000Z",
    project: {
      id: projectId,
      name: "Reviewable drone documentary fixture",
      subjectId: thread.subject.id,
      objective: {
        title: "Record a reviewable project basis",
        statement:
          "Keep the human-approved discovery and project path durable before technical work starts.",
      },
    },
    discoveryHandoff: {
      discoveryId: basis.discoveryId,
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      briefId: basis.briefId,
      approvedBriefFingerprint: basis.approvedBriefFingerprint,
      approvedAt: "2026-08-02T12:00:00.000Z",
      approvedBy: { id: "human:reviewer", origin: "human" },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis,
      publishedAt: "2026-08-02T12:02:00.000Z",
      publishedBy: { id: "agent:planner", origin: "agent" },
    },
    threadSnapshots: [{
      snapshotId: thread.id,
      revision: thread.revision,
      subjectId: thread.subject.id,
    }],
    phases: [{
      id: "baseline",
      name: "Documentary baseline",
      order: 1,
      description: "Record the reviewed starting point without technical claims.",
      workItemIds: ["record-approved-discovery"],
      requiredDecisionIds: [],
      evidenceRefs: [evidenceRef],
    }],
    workItems: [{
      id: "record-approved-discovery",
      phaseId: "baseline",
      title: "Record the approved discovery",
      description:
        "Create the durable documentary pre-technical baseline from the approved discovery.",
      kind: "define",
      operation: {
        id: "baseline.from-approved-discovery",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [evidenceRef],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [
      projectReceipt(
        "fixture-create-from-discovery",
        "project.create-from-discovery",
        { id: "human:reviewer", origin: "human" },
        "2026-08-02T12:00:30.000Z",
        "2026-08-02T12:01:00.000Z",
        initialSnapshotId,
        1,
      ),
      projectReceipt(
        "fixture-publish-plan",
        "project.plan-publish",
        { id: "agent:planner", origin: "agent" },
        "2026-08-02T12:01:30.000Z",
        "2026-08-02T12:02:00.000Z",
        currentSnapshotId,
        2,
      ),
    ],
  });
}

/** A seed that has read r2 but has not yet attached it to the project. */
function documentaryProjectWithPublishingSeed(
  thread: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const baseline = documentaryProjectSnapshot(thread);
  return validateEngineeringProjectSnapshot({
    ...structuredClone(baseline),
    id: `${baseline.project.id}:r3:seed-publishing`,
    revision: 3,
    previous: { snapshotId: baseline.id, revision: baseline.revision },
    generatedAt: "2026-08-02T12:11:00.000Z",
    phases: [
      ...baseline.phases,
      {
        id: "architecture",
        name: "System model",
        order: 2,
        description: "Create the first empty editable model container.",
        workItemIds: ["seed-syson-model"],
        requiredDecisionIds: [],
        evidenceRefs: [],
      },
    ],
    workItems: [
      ...baseline.workItems,
      {
        id: "seed-syson-model",
        phaseId: "architecture",
        title: "Create the first editable system model",
        description: "Create and read back only an empty SysON model container.",
        kind: "architect",
        status: "in-progress",
        owner: "agent",
        dependsOnWorkItemIds: ["record-approved-discovery"],
        evidenceRefs: [],
        decisionIds: [],
        blockerIds: [],
        operation: {
          id: "architecture.seed-syson-model",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" },
          }],
        },
      },
    ],
    agentRuns: [{
      id: "run-seed-syson",
      workItemId: "seed-syson-model",
      status: "publishing",
      summary: "Safe fixture summary.",
      queuedAt: "2026-08-02T12:10:00.000Z",
      startedAt: "2026-08-02T12:10:10.000Z",
      claimedAt: "2026-08-02T12:10:10.000Z",
      claimedBy: { id: "agent:fixture", origin: "agent" },
      basis: {
        kind: "thread-snapshot",
        snapshotId: thread.id,
        revision: thread.revision,
        subjectId: thread.subject.id,
      },
      inputFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      evidenceRefs: [],
      statusHistory: [{
        commandId: "fixture-queue-seed",
        status: "queued",
        at: "2026-08-02T12:10:00.000Z",
        actor: { id: "human:fixture", origin: "human" },
        summary: "Queued.",
      }, {
        commandId: "fixture-claim-seed",
        status: "running",
        at: "2026-08-02T12:10:10.000Z",
        actor: { id: "agent:fixture", origin: "agent" },
        summary: "Running.",
      }, {
        commandId: "fixture-publish-seed",
        status: "publishing",
        at: "2026-08-02T12:11:00.000Z",
        actor: { id: "agent:fixture", origin: "agent" },
        summary: "Persisting r2.",
      }],
    }],
    commandReceipts: [
      ...(baseline.commandReceipts ?? []),
      projectReceipt(
        "fixture-publish-seed",
        "agent-run.publish",
        { id: "agent:fixture", origin: "agent" },
        "2026-08-02T12:10:59.000Z",
        "2026-08-02T12:11:00.000Z",
        `${baseline.project.id}:r3:seed-publishing`,
        3,
      ),
    ],
  });
}

function unpublishedSeedThreadSnapshot(r1: ThreadSnapshot): ThreadSnapshot {
  return validateThreadSnapshot({
    ...structuredClone(r1),
    id: `${r1.id}:unattached-r2`,
    revision: 2,
    generatedAt: "2026-08-02T12:11:20.000Z",
    previous: { snapshotId: r1.id, revision: r1.revision },
  });
}

function unpublishedInspectionDroneArchitectureThreadSnapshot(
  r2: ThreadSnapshot,
): ThreadSnapshot {
  return validateThreadSnapshot({
    ...structuredClone(r2),
    id: `${r2.id}:unattached-r3`,
    revision: 3,
    generatedAt: "2026-08-03T12:11:20.000Z",
    previous: { snapshotId: r2.id, revision: r2.revision },
  });
}

function projectWithPublishingInspectionDroneArchitecture(
  r2: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const base = projectSnapshot(r2);
  return validateEngineeringProjectSnapshot({
    ...structuredClone(base),
    generatedAt: "2026-08-03T12:12:00.000Z",
    phases: [{
      id: "architecture",
      name: "System architecture",
      order: 1,
      description:
        "Author one bounded high-level inspection-drone architecture after the SysON model container exists.",
      workItemIds: ["author-inspection-drone"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "author-inspection-drone",
      phaseId: "architecture",
      title: "Author the bounded inspection-drone architecture",
      description:
        "Insert and read back the reviewed high-level SysML architecture exactly once.",
      kind: "architect",
      status: "in-progress",
      owner: "agent",
      operation: {
        id: INSPECTION_DRONE_ARCHITECTURE_OPERATION.id,
        version: INSPECTION_DRONE_ARCHITECTURE_OPERATION.version,
        bindings: [],
      },
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run-author-inspection-drone",
      workItemId: "author-inspection-drone",
      status: "publishing",
      summary: "Persist the bounded architecture read-back before project attachment.",
      queuedAt: "2026-08-03T12:10:00.000Z",
      startedAt: "2026-08-03T12:10:10.000Z",
      claimedAt: "2026-08-03T12:10:10.000Z",
      claimedBy: { id: "agent:fixture", origin: "agent" },
      baseSnapshot: {
        snapshotId: r2.id,
        revision: r2.revision,
        subjectId: r2.subject.id,
      },
      inputFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      evidenceRefs: [],
      statusHistory: [{
        commandId: "fixture-queue-inspection-drone",
        status: "queued",
        at: "2026-08-03T12:10:00.000Z",
        actor: { id: "human:fixture", origin: "human" },
        summary: "Queued.",
      }, {
        commandId: "fixture-claim-inspection-drone",
        status: "running",
        at: "2026-08-03T12:10:10.000Z",
        actor: { id: "agent:fixture", origin: "agent" },
        summary: "Running.",
      }, {
        commandId: "fixture-publish-inspection-drone",
        status: "publishing",
        at: "2026-08-03T12:11:00.000Z",
        actor: { id: "agent:fixture", origin: "agent" },
        summary: "Persisting guarded result.",
      }],
    }],
  });
}

function documentaryThreadSnapshot(subjectId: string): ThreadSnapshot {
  const digest = "d".repeat(64);
  const fingerprint = { algorithm: "sha256", digest };
  const artifactId = "approved-discovery-document-fixture";
  const changeId = "approved-discovery-documentary-change-fixture";
  const capturedAt = "2026-08-02T12:04:00.000Z";
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${subjectId}:r1:approved-discovery-documentary-baseline`,
    revision: 1,
    generatedAt: capturedAt,
    subject: {
      id: subjectId,
      name: "Drone documentary fixture",
      kind: "system",
      version: digest,
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "approved-discovery-documentary-baseline-fixture",
      name: "Record approved discovery documentary baseline",
      status: "applied",
      createdAt: capturedAt,
      appliedAt: capturedAt,
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary:
          "Recorded the approved discovery as a documentary pre-technical baseline.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Approved discovery documentary baseline (pre-technical)",
      kind: "document",
      version: digest,
      fingerprint,
      uri: `casys://approved-discovery-capture/sha256/${digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "casys-digital-thread",
        tool: "baseline_from_approved_discovery",
        runId: "run:documentary-fixture",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: capturedAt,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "approved-discovery-documentary-provenance-fixture",
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale:
        "The immutable documentary record preserves the reviewed starting point.",
    }],
    proposedActions: [],
  });
}

function projectReceipt(
  commandId: string,
  type:
    | "project.create-from-discovery"
    | "project.plan-publish"
    | "agent-run.publish",
  actor: { id: string; origin: "human" | "agent" },
  issuedAt: string,
  appliedAt: string,
  snapshotId: string,
  revision: number,
) {
  return {
    commandId,
    type,
    actor,
    issuedAt,
    appliedAt,
    requestFingerprint: {
      algorithm: "sha256" as const,
      digest: "a".repeat(64),
    },
    resultingSnapshot: { snapshotId, revision },
  };
}

function capture() {
  const sha = "b".repeat(64);
  return {
    schemaVersion: "attested-mechanical-run/1.0",
    capturedAt: "2026-08-01T03:03:48.000Z",
    source: "observed-local-uncommitted",
    subject: "CoffeeMachine support bracket",
    providers: {
      build123d: {
        endpoint: "http://127.0.0.1:3014/mcp",
        sourceRevision: "e".repeat(40),
        dirty: true,
        containerId: "build-container",
      },
      calculix: {
        endpoint: "http://127.0.0.1:3015/mcp",
        sourceRevision: "f".repeat(40),
        dirty: true,
        containerId: "fea-container",
      },
    },
    cad: {
      tool: "build123d_export",
      artifact: {
        format: "step",
        path: "/exports/bracket.step",
        bytes: 1,
        sha256: sha,
      },
      metrics: {
        volume_mm3: 1,
        area_mm2: 1,
        density_kg_m3: 2700,
        mass_kg: 0.05,
      },
    },
    fea: {
      tool: "calculix_solve_static",
      expectedStepSha256: sha,
      inputArtifact: {
        path: "/tmp/input.step",
        sourcePath: "/exports/bracket.step",
        sha256: sha,
        bytes: 1,
      },
      metrics: {
        maxDisplacement: { value: 0.04, unit: "mm", nodeId: 1 },
        maxVonMises: { value: 26.29, unit: "MPa", elementId: 1 },
      },
    },
    artifactAttestation: {
      status: "verified",
      producerSha256: sha,
      consumerSha256: sha,
      equal: true,
    },
    negativeControl: {
      expectedSha256: "0".repeat(64),
      status: "rejected-before-solve",
      message: "STEP SHA-256 mismatch",
    },
    limitations: ["No model-owned mechanical criterion."],
  };
}

function liveCadNode(freshness: "running" | "fresh") {
  return {
    id: "graph:artifact:coffee-machine-cad-live",
    ref: { kind: "artifact" as const, id: "coffee-machine-cad-live" },
    entityKind: "artifact" as const,
    artifactKind: "cad-model",
    label: "CoffeeMachine CAD assembly",
    system: "mcp-build123d",
    freshness,
    summary: "Building from observed SysML dimensions",
    recordedAt: "2026-08-01T10:00:00.000Z",
    selection: { kind: "artifact" as const, id: "coffee-machine-cad-live" },
  };
}

function operatorRequest(
  body: unknown,
  overrides: Record<string, string | null> = {},
  url = "http://localhost/api/project/commands",
): Request {
  const headers = new Headers({
    Origin: "http://localhost",
    "Content-Type": "application/json",
    "X-Casys-Operator-Intent": "explicit",
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
