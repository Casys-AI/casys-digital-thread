import { assertEquals, assertExists, assertRejects } from "@std/assert";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  CoffeeMachineCm01V3ErpNextBomRunExecutor,
} from "./coffee-machine-cm01-v3-erpnext-bom-run-executor.ts";
import type { Cm01ErpNextBomCapture } from "../../captures/cm01-erpnext-bom-capture.ts";
import {
  CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../captures/file-capture-store.ts";
import { FileCm01ErpNextBomRunCaptureStore } from "../../captures/file-cm01-erpnext-bom-run-capture-store.ts";

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

Deno.test("CM-01 V3 ERP BOM executor captures a read-only evidence descendant and replays safely", async () => {
  const directory = await Deno.makeTempDir({ prefix: "cm01-erp-bom-executor-" });
  try {
    const fixture = await fixtureFor(directory);
    const capture = new FakeCapture();
    const executor = executorFor(fixture, capture);
    const completed = await executor.execute(AGENT, command());
    assertEquals(completed.agentRuns[0]?.status, "completed");
    assertEquals(capture.calls, 1);
    const result = completed.agentRuns[0]?.resultSnapshot;
    assertExists(result);
    const snapshot = await fixture.snapshots.get(result.snapshotId);
    assertExists(snapshot);
    assertEquals(
      snapshot.artifacts.filter((artifact) =>
        artifact.kind === "bom" &&
        artifact.uri?.startsWith("casys://cm01-erpnext-bom-capture/")
      ).map((
        artifact,
      ) => ({
        kind: artifact.kind,
        serverId: artifact.producer.serverId,
        tool: artifact.producer.tool,
        uri: artifact.uri,
      })),
      [{
        kind: "bom",
        serverId: "erpnext",
        tool: "erpnext_bom_get",
        uri: `casys://cm01-erpnext-bom-capture/sha256/${
          (await fixture.captureFingerprint()).digest
        }`,
      }],
    );
    assertEquals(snapshot.requirements.length, 0);
    assertEquals(snapshot.evaluations.length, 0);
    assertEquals(
      snapshot.observations.filter((item) =>
        item.source.artifactIds.includes(`erpnext-bom-${"a".repeat(12)}`)
      ).map((item) => item.metric).sort(),
      [
        "bom_component_count",
        "bom_quantity_per_finished_good",
      ],
    );
    const replay = await executor.execute(AGENT, command());
    assertEquals(replay.revision, completed.revision);
    assertEquals(capture.calls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 ERP BOM executor resumes from immutable capture after a snapshot write failure", async () => {
  const directory = await Deno.makeTempDir({ prefix: "cm01-erp-bom-executor-" });
  try {
    const fixture = await fixtureFor(directory);
    const capture = new FakeCapture();
    const executor = executorFor(
      fixture,
      capture,
      new FailOnceSnapshots(fixture.snapshots),
    );
    await assertRejects(
      () => executor.execute(AGENT, command()),
      Error,
      "snapshot write interrupted",
    );
    assertEquals(capture.calls, 1);
    assertEquals(
      (await fixture.projects.get("coffee-machine-cm01-v3"))?.agentRuns[0]?.status,
      "running",
    );
    const resumed = await executor.execute(AGENT, command());
    assertEquals(resumed.agentRuns[0]?.status, "completed");
    assertEquals(capture.calls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 ERP BOM executor rejects a human before project or ERPNext access", async () => {
  const executor = new CoffeeMachineCm01V3ErpNextBomRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
    capture: { capture: () => Promise.reject(new Error("must not call")) },
    captures: {} as never,
    runCaptures: {} as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute(HUMAN, command()),
    Error,
    "Only an authenticated agent",
  );
});

function executorFor(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  capture: FakeCapture,
  snapshots: ThreadSnapshotStore = fixture.snapshots,
) {
  return new CoffeeMachineCm01V3ErpNextBomRunExecutor({
    projects: fixture.projects as never,
    commands: fixture.commands as never,
    snapshots,
    capture,
    captures: new FileCaptureStore({
      ...CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
      directory: `${fixture.directory}/captures`,
    }),
    runCaptures: new FileCm01ErpNextBomRunCaptureStore(
      `${fixture.directory}/run-captures`,
    ),
    lease: { withLease: (_projectId, _runId, operation) => operation() },
    now: () => "2026-08-03T15:00:00.000Z",
  });
}

async function fixtureFor(directory: string) {
  const source = JSON.parse(
    await Deno.readTextFile(
      "config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
    ),
  ) as ThreadSnapshot;
  const base = structuredClone(source);
  base.id = "project:coffee-machine-cm01-v3:r1:approved-brief";
  base.subject.id = "project:coffee-machine-cm01-v3";
  base.subject.name = "CM-01 coffee machine";
  base.revision = 1;
  delete base.previous;
  const snapshots = new MemorySnapshots([base]);
  const current = project(base);
  const projects = {
    get: (id: string) =>
      Promise.resolve(id === current.project.id ? structuredClone(current) : undefined),
  };
  const commands = {
    claimRun: (_origin: unknown, input: { commandId: string }) => {
      const run = current.agentRuns[0] as unknown as Record<string, unknown>;
      run.status = "running";
      run.claimedBy = { origin: "agent", id: "agent:engineering" };
      run.startedAt = "2026-08-03T14:00:00.000Z";
      receipt(current, input.commandId);
      return Promise.resolve(structuredClone(current));
    },
    publishRun: (_origin: unknown, input: { commandId: string }) => {
      (current.agentRuns[0] as unknown as Record<string, unknown>).status =
        "publishing";
      receipt(current, input.commandId);
      return Promise.resolve(structuredClone(current));
    },
    completeRun: (
      _origin: unknown,
      input: { commandId: string; resultSnapshot: EngineeringThreadSnapshotRef },
    ) => {
      const run = current.agentRuns[0] as unknown as Record<string, unknown>;
      run.status = "completed";
      run.resultSnapshot = input.resultSnapshot;
      receipt(current, input.commandId);
      return Promise.resolve(structuredClone(current));
    },
    failRun: () => Promise.resolve(structuredClone(current)),
  };
  const captureFingerprint = async () => {
    const capture = await new FakeCapture().capture();
    const { sha256Fingerprint } = await import(
      "../../../domain/kernel/deterministic-json.ts"
    );
    return await sha256Fingerprint(capture);
  };
  return { directory, projects, commands, snapshots, captureFingerprint };
}

function project(base: ThreadSnapshot): EngineeringProjectSnapshot {
  return {
    schemaVersion: "3.0",
    id: "project:coffee-machine-cm01-v3:r1",
    revision: 1,
    project: {
      id: "coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      subjectId: base.subject.id,
      objective: { title: "CM-01", statement: "Observe the reviewed ERP BOM." },
    },
    workItems: [{
      id: "observe-cm01-bom",
      phaseId: "supply",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "industrialize.observe-coffee-machine-cm01-bom",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    agentRuns: [{
      id: "run:cm01-erp-bom",
      workItemId: "observe-cm01-bom",
      status: "queued",
      basis: {
        kind: "thread-snapshot",
        snapshotId: base.id,
        revision: base.revision,
        subjectId: base.subject.id,
      },
      queuedAt: "2026-08-03T13:00:00.000Z",
      queuedBy: { origin: "agent", id: "agent:engineering" },
    }],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot;
}

function receipt(project: EngineeringProjectSnapshot, commandId: string) {
  (project.commandReceipts as unknown as { commandId: string }[]).push({ commandId });
}

function command() {
  return {
    commandId: "agent-run-cm01-erp-bom",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: 1,
    issuedAt: "2026-08-03T14:00:00.000Z",
    runId: "run:cm01-erp-bom",
  };
}

class MemorySnapshots implements ThreadSnapshotStore {
  #items = new Map<string, ThreadSnapshot>();
  constructor(items: readonly ThreadSnapshot[]) {
    for (const item of items) this.#items.set(item.id, structuredClone(item));
  }
  get(id: string) {
    return Promise.resolve(structuredClone(this.#items.get(id)));
  }
  latest(subjectId: string) {
    return Promise.resolve(
      [...this.#items.values()].filter((item) => item.subject.id === subjectId).at(-1),
    );
  }
  save(snapshot: ThreadSnapshot) {
    this.#items.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }
}

class FailOnceSnapshots implements ThreadSnapshotStore {
  #fail = true;
  constructor(private readonly delegate: ThreadSnapshotStore) {}
  get(id: string) {
    return this.delegate.get(id);
  }
  latest(subjectId: string) {
    return this.delegate.latest(subjectId);
  }
  save(snapshot: ThreadSnapshot) {
    if (this.#fail) {
      this.#fail = false;
      return Promise.reject(new Error("snapshot write interrupted"));
    }
    return this.delegate.save(snapshot);
  }
}

class FakeCapture {
  calls = 0;
  capture(): Promise<Cm01ErpNextBomCapture> {
    this.calls++;
    return Promise.resolve({
      schemaVersion: "cm01-erpnext-bom-capture/1.0",
      kind: "cm01-erpnext-bom-capture",
      capturedAt: "2026-08-03T14:05:00.000Z",
      artifact: {
        role: "erp-bom",
        kind: "bom",
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        producer: { serverId: "erpnext", tool: "erpnext_bom_get" },
        identity: {
          bomName: "BOM-CASYS-CM01-001",
          itemCode: "CASYS-CM01",
          itemName: "Coffee machine",
        },
        quantity: { value: 1, unit: "Nos" },
        componentCount: 3,
      },
    });
  }
}
