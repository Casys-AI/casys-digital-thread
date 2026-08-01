import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../src/domain/engineering-project.ts";
import type { EngineeringProjectStore } from "../src/adapters/engineering-project-store.ts";
import { materializeAttestedMechanicalRun } from "../src/testing/attested-mechanical-run-fixture.ts";
import { createNativeWorkbenchHandler } from "./serve-native-workbench.ts";
import { FileLiveThreadUpdateStore } from "../src/adapters/live-thread-update-store.ts";

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
  assertEquals(body.schemaVersion, "engineering-workbench/0.1");
  assertEquals(body.project.project.subjectId, snapshot.subject.id);
  assertEquals(body.thread.source, "observed");
  assertEquals(body.thread.requirements, []);
  assertEquals(store.latestCalls, 1);
  assertEquals(store.saveCalls, 0);
  assertEquals(projectStore.getCalls, 1);

  const page = await handler(new Request("http://localhost/"));
  assertStringIncludes(await page.text(), "Workbench");
  const rejected = await handler(
    new Request("http://localhost/api/thread/workbench", {
      method: "POST",
    }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
});

Deno.test("native Workbench handler reports a missing persisted subject", async () => {
  const handler = createNativeWorkbenchHandler({
    store: new ReadOnlyStore(undefined),
    projectStore: new ReadOnlyProjectStore(projectSnapshot()),
    subjectId: "missing",
    html: "unused",
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error, "thread_snapshot_not_found");
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
  assertStringIncludes(event, "event: thread-snapshot");
  assertStringIncludes(event, '"schemaVersion":"engineering-workbench/0.1"');
  assertStringIncludes(event, '"schemaVersion":"thread-workbench/0.1"');
  assertStringIncludes(event, `"subjectId":"${snapshot.subject.id}"`);
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
  assertStringIncludes(event, '"schemaVersion":"engineering-workbench/0.1"');
  assertStringIncludes(event, '"revision":2');
  assertStringIncludes(event, `"id":"${snapshot.id}"`);
  await reader.cancel();
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

class ReadOnlyProjectStore implements EngineeringProjectStore {
  getCalls = 0;
  constructor(
    private project: EngineeringProjectSnapshot | undefined,
  ) {}
  get(): Promise<EngineeringProjectSnapshot | undefined> {
    this.getCalls++;
    return Promise.resolve(this.project);
  }
  replace(project: EngineeringProjectSnapshot | undefined): void {
    this.project = project;
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
