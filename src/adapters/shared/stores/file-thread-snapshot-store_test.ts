import { assertEquals, assertRejects } from "@std/assert";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import {
  FileThreadSnapshotStore,
  type ThreadSnapshotFileEntry,
  type ThreadSnapshotFileIo,
} from "./file-thread-snapshot-store.ts";

Deno.test("FileThreadSnapshotStore saves immutably and reads the latest subject revision", async () => {
  const io = new MemoryFileIo();
  const store = new FileThreadSnapshotStore("snapshots", io);
  const revisionOne = validSnapshot();
  const revisionTwo: ThreadSnapshot = {
    ...structuredClone(revisionOne),
    id: "snapshot-r8",
    revision: 8,
    previous: { snapshotId: revisionOne.id, revision: revisionOne.revision },
    generatedAt: "2026-08-01T04:00:00.000Z",
  };

  await store.save(revisionOne);
  await store.save(revisionOne);
  await store.save(revisionTwo);

  assertEquals((await store.get(revisionOne.id))?.id, revisionOne.id);
  assertEquals((await store.latest(revisionOne.subject.id))?.id, revisionTwo.id);
  assertEquals(await store.latest("unknown-subject"), undefined);

  await assertRejects(
    () =>
      store.save({
        ...structuredClone(revisionOne),
        generatedAt: revisionTwo.generatedAt,
      }),
    Error,
    "already exists with different content",
  );

  await assertRejects(
    () =>
      store.save({
        ...structuredClone(revisionTwo),
        id: "another-snapshot-r8",
      }),
    Error,
    "revision 8 already belongs to snapshot-r8",
  );
});

Deno.test("FileThreadSnapshotStore claims one subject revision before writing a new head", async () => {
  const io = new MemoryFileIo();
  const store = new FileThreadSnapshotStore("snapshots", io);
  const base = validSnapshot();
  const firstHead: ThreadSnapshot = {
    ...structuredClone(base),
    id: "snapshot-r8-first",
    revision: 8,
    previous: { snapshotId: base.id, revision: base.revision },
  };
  const competingHead: ThreadSnapshot = {
    ...structuredClone(firstHead),
    id: "snapshot-r8-competing",
  };

  await store.save(base);
  const results = await Promise.allSettled([
    store.save(firstHead),
    store.save(competingHead),
  ]);

  assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
  assertEquals(results.filter((result) => result.status === "rejected").length, 1);
  assertEquals((await store.latest(base.subject.id))?.revision, 8);
});

Deno.test("concurrent store instances idempotently save the same snapshot", async () => {
  const io = new BarrierMemoryFileIo();
  const firstStore = new FileThreadSnapshotStore("snapshots", io);
  const secondStore = new FileThreadSnapshotStore("snapshots", io);
  const snapshot = validSnapshot();

  const results = await Promise.allSettled([
    firstStore.save(structuredClone(snapshot)),
    secondStore.save(structuredClone(snapshot)),
  ]);

  assertEquals(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  assertEquals(await firstStore.get(snapshot.id), snapshot);
  assertEquals(await secondStore.get(snapshot.id), snapshot);
});

Deno.test("production snapshot stores confirm an identical concurrent durable final", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-thread-snapshot-" });
  try {
    const firstStore = new FileThreadSnapshotStore(directory);
    const secondStore = new FileThreadSnapshotStore(directory);
    const snapshot = validSnapshot();
    const results = await Promise.allSettled([
      firstStore.save(structuredClone(snapshot)),
      secondStore.save(structuredClone(snapshot)),
    ]);
    assertEquals(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assertEquals(await secondStore.getFresh(snapshot.id), snapshot);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("production snapshot store persists a custom relative root", async () => {
  const directory = `casys-relative-snapshots-${crypto.randomUUID()}`;
  try {
    const store = new FileThreadSnapshotStore(directory);
    const snapshot = validSnapshot();
    await store.save(snapshot);
    assertEquals(await store.getFresh(snapshot.id), snapshot);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("concurrent store instances reject different content for the same snapshot id", async () => {
  const io = new BarrierMemoryFileIo();
  const firstStore = new FileThreadSnapshotStore("snapshots", io);
  const secondStore = new FileThreadSnapshotStore("snapshots", io);
  const first = validSnapshot();
  const competing: ThreadSnapshot = {
    ...structuredClone(first),
    generatedAt: "2026-08-01T04:00:00.000Z",
  };

  const results = await Promise.allSettled([
    firstStore.save(first),
    secondStore.save(competing),
  ]);

  assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assertEquals(rejected?.status, "rejected");
  if (rejected?.status === "rejected") {
    assertEquals(
      rejected.reason.message,
      `ThreadSnapshot ${first.id} already exists with different content.`,
    );
  }
});

Deno.test("FileThreadSnapshotStore rejects invalid JSON at its read boundary", async () => {
  const io = new MemoryFileIo();
  const store = new FileThreadSnapshotStore("snapshots", io);
  await io.mkdir("snapshots");
  await io.writeTextFile(store.pathFor("broken"), '{"schemaVersion":"1.0"}');

  await assertRejects(() => store.get("broken"), Error, "Invalid ThreadSnapshot");
});

Deno.test("immutable snapshots are not reread while polling latest", async () => {
  const io = new MemoryFileIo();
  const store = new FileThreadSnapshotStore("snapshots", io);
  await store.save(validSnapshot());
  io.readCalls = 0;

  await store.latest("coffee-machine-support-bracket");
  await store.latest("coffee-machine-support-bracket");

  assertEquals(io.readCalls, 0);
});

Deno.test("every snapshot read is deeply frozen and cached reads cannot be poisoned", async () => {
  const io = new MemoryFileIo();
  const store = new FileThreadSnapshotStore("snapshots", io);
  const snapshot = validSnapshot();
  await store.save(snapshot);

  const first = await store.get(snapshot.id);
  if (!first) throw new Error("Saved snapshot was not readable.");
  assertSnapshotDeeplyFrozen(first);
  assertEquals(Reflect.set(first.subject, "name", "Poisoned cache"), false);
  assertEquals(
    Reflect.set(first.artifacts[0].fingerprint, "digest", "0".repeat(64)),
    false,
  );
  assertEquals(
    Reflect.set(first.artifacts, 0, { ...first.artifacts[0], name: "Poisoned" }),
    false,
  );

  const cached = await store.get(snapshot.id);
  if (!cached) throw new Error("Cached snapshot was not readable.");
  assertSnapshotDeeplyFrozen(cached);
  assertEquals(cached.subject.name, snapshot.subject.name);
  assertEquals(cached.artifacts[0].fingerprint.digest, "b".repeat(64));

  const latest = await store.latest(snapshot.subject.id);
  if (!latest) throw new Error("Latest snapshot was not readable.");
  assertSnapshotDeeplyFrozen(latest);

  const fresh = await store.getFresh(snapshot.id);
  if (!fresh) throw new Error("Fresh snapshot was not readable.");
  assertSnapshotDeeplyFrozen(fresh);
  assertEquals(fresh.subject.name, snapshot.subject.name);
});

class MemoryFileIo implements ThreadSnapshotFileIo {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readCalls = 0;

  mkdir(path: string): Promise<void> {
    this.directories.add(path);
    return Promise.resolve();
  }

  readTextFile(path: string): Promise<string> {
    this.readCalls++;
    const value = this.files.get(path);
    if (value === undefined) return Promise.reject(notFound());
    return Promise.resolve(value);
  }

  writeTextFile(path: string, contents: string): Promise<void> {
    if (this.files.has(path)) {
      return Promise.reject(new Error(`File already exists: ${path}`));
    }
    this.files.set(path, contents);
    return Promise.resolve();
  }

  async *readDir(path: string): AsyncIterable<ThreadSnapshotFileEntry> {
    if (!this.directories.has(path)) throw notFound();
    const prefix = `${path}/`;
    for (const name of this.files.keys()) {
      if (name.startsWith(prefix) && !name.slice(prefix.length).includes("/")) {
        yield { name: name.slice(prefix.length), isFile: true };
      }
    }
  }
}

class BarrierMemoryFileIo extends MemoryFileIo {
  #snapshotWriterCount = 0;
  #releaseSnapshotWriters!: () => void;
  readonly #snapshotWritersReady = new Promise<void>((resolve) => {
    this.#releaseSnapshotWriters = resolve;
  });

  override async writeTextFile(path: string, contents: string): Promise<void> {
    if (path.endsWith(".json")) {
      this.#snapshotWriterCount++;
      if (this.#snapshotWriterCount === 2) this.#releaseSnapshotWriters();
      await this.#snapshotWritersReady;
    }
    await super.writeTextFile(path, contents);
  }
}

function notFound(): Error {
  const error = new Error("Not found");
  error.name = "NotFound";
  return error;
}

function assertSnapshotDeeplyFrozen(snapshot: ThreadSnapshot): void {
  assertEquals(Object.isFrozen(snapshot), true);
  assertEquals(Object.isFrozen(snapshot.subject), true);
  assertEquals(Object.isFrozen(snapshot.artifacts), true);
  assertEquals(Object.isFrozen(snapshot.artifacts[0]), true);
  assertEquals(Object.isFrozen(snapshot.artifacts[0].fingerprint), true);
  assertEquals(Object.isFrozen(snapshot.artifacts[0].freshness), true);
  assertEquals(
    Object.isFrozen(snapshot.artifacts[0].freshness.invalidatedByChangeIds),
    true,
  );
}

function validSnapshot(): ThreadSnapshot {
  const at = "2026-08-01T03:03:48.000Z";
  return {
    schemaVersion: "1.0",
    id: "snapshot-r7",
    revision: 7,
    generatedAt: at,
    subject: {
      id: "coffee-machine-support-bracket",
      name: "CoffeeMachine support bracket",
      kind: "part",
      version: "b29f52b39a39",
      modelArtifactId: "step-bracket",
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "capture-r7",
      name: "Capture attested mechanical evidence",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "capture-step-r7",
        kind: "created",
        target: { kind: "artifact", id: "step-bracket" },
        summary: "Recorded the content-addressed STEP artifact.",
        afterFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      }],
    },
    artifacts: [{
      id: "step-bracket",
      name: "Support bracket STEP",
      kind: "step",
      version: "b29f52b39a39",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producer: { serverId: "build123d", tool: "export", runId: "run-cad" },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "capture-created-step",
      relation: "changes",
      from: { kind: "change", id: "capture-step-r7" },
      to: { kind: "artifact", id: "step-bracket" },
      rationale: "The capture introduced this exact artifact version.",
    }],
    proposedActions: [],
  };
}
