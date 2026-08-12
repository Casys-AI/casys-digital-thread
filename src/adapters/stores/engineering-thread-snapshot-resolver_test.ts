import { assertEquals, assertRejects } from "@std/assert";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type ExactThreadSnapshotFileEntry,
  type ExactThreadSnapshotFileIo,
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./engineering-thread-snapshot-resolver.ts";

const BASELINE_ID = "generic-bracket:r1:baseline";

Deno.test("engineering snapshot directory resolves by canonical ID, not filename", async () => {
  const directory = await Deno.makeTempDir({ prefix: "exact-thread-snapshot-" });
  try {
    await Deno.writeTextFile(
      `${directory}/presentation-name.json`,
      `${JSON.stringify(baselineSnapshot())}\n`,
    );
    const reader = new FileExactThreadSnapshotDirectory(directory);

    const snapshot = await reader.get(BASELINE_ID);

    assertEquals(snapshot?.id, BASELINE_ID);
    assertEquals(snapshot?.revision, 1);
    assertEquals(snapshot?.subject.id, "generic-bracket");
    assertEquals(await reader.get("another-snapshot-id"), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ordered exact resolver gives the active store priority for the same ID", async () => {
  const baseline = baselineSnapshot();
  const active = structuredClone(baseline);
  active.subject.name = "Active store copy";
  const reader = new OrderedExactThreadSnapshotReader([
    new MemoryExactReader(new Map([[BASELINE_ID, active]])),
    new MemoryExactReader(new Map([[BASELINE_ID, baseline]])),
  ]);

  const resolved = await reader.get(BASELINE_ID);

  assertEquals(resolved?.subject.name, "Active store copy");
});

Deno.test("ordered exact resolver never accepts another snapshot as fallback", async () => {
  const baseline = baselineSnapshot();
  const reader = new OrderedExactThreadSnapshotReader([
    new MemoryExactReader(new Map([[baseline.id, baseline]]), true),
  ]);

  await assertRejects(
    () => reader.get("missing-exact-id"),
    Error,
    "returned",
  );
});

Deno.test("baseline directory fails closed on invalid snapshot JSON", async () => {
  const reader = new FileExactThreadSnapshotDirectory(
    "baselines",
    new MemoryFileIo({ "broken.json": '{"schemaVersion":"invalid"}' }),
  );

  await assertRejects(
    () => reader.get(BASELINE_ID),
    Error,
    "Invalid ThreadSnapshot",
  );
});

Deno.test("baseline directory treats an absent directory as no exact capture", async () => {
  const reader = new FileExactThreadSnapshotDirectory(
    "missing",
    new MissingDirectoryIo(),
  );

  assertEquals(await reader.get(BASELINE_ID), undefined);
});

function baselineSnapshot(): ThreadSnapshot {
  const at = "2026-08-01T03:03:48.000Z";
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: BASELINE_ID,
    revision: 1,
    generatedAt: at,
    subject: {
      id: "generic-bracket",
      name: "Generic bracket",
      kind: "part",
      version: "1",
      modelArtifactId: "generic-bracket-step",
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "generic-baseline",
      name: "Capture the generic bracket baseline",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "capture-generic-step",
        kind: "created",
        target: { kind: "artifact", id: "generic-bracket-step" },
        summary: "Capture the exact generic STEP artifact.",
        afterFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      }],
    },
    artifacts: [{
      id: "generic-bracket-step",
      name: "Generic bracket STEP",
      kind: "step",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      producer: { serverId: "build123d", tool: "export", runId: "generic-cad" },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "generic-baseline-created-step",
      relation: "changes",
      from: { kind: "change", id: "capture-generic-step" },
      to: { kind: "artifact", id: "generic-bracket-step" },
      rationale: "The baseline change created the exact STEP artifact.",
    }],
    proposedActions: [],
  });
}

class MemoryExactReader implements ExactThreadSnapshotReader {
  constructor(
    private readonly snapshots: ReadonlyMap<string, ThreadSnapshot>,
    private readonly returnFirstForEveryId = false,
  ) {}

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(
      this.returnFirstForEveryId
        ? this.snapshots.values().next().value
        : this.snapshots.get(snapshotId),
    );
  }
}

class MemoryFileIo implements ExactThreadSnapshotFileIo {
  constructor(private readonly files: Readonly<Record<string, string>>) {}

  async *readDir(): AsyncIterable<ExactThreadSnapshotFileEntry> {
    for (const name of Object.keys(this.files)) yield { name, isFile: true };
  }

  readTextFile(path: string): Promise<string> {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const value = this.files[name];
    if (value === undefined) throw new Deno.errors.NotFound(name);
    return Promise.resolve(value);
  }
}

class MissingDirectoryIo implements ExactThreadSnapshotFileIo {
  readDir(): AsyncIterable<ExactThreadSnapshotFileEntry> {
    throw new Deno.errors.NotFound("missing");
  }

  readTextFile(): Promise<string> {
    throw new Error("readTextFile must not be called for an absent directory.");
  }
}
