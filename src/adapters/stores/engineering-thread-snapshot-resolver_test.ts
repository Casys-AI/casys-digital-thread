import { assertEquals, assertRejects } from "@std/assert";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import {
  type ExactThreadSnapshotFileEntry,
  type ExactThreadSnapshotFileIo,
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./engineering-thread-snapshot-resolver.ts";

const BASELINE_DIRECTORY = "config/projects/baselines";
const BASELINE_ID =
  "coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension";

Deno.test("checked-in engineering baseline resolves by its canonical ID, not filename", async () => {
  const reader = new FileExactThreadSnapshotDirectory(BASELINE_DIRECTORY);

  const snapshot = await reader.get(BASELINE_ID);

  assertEquals(snapshot?.id, BASELINE_ID);
  assertEquals(snapshot?.revision, 5);
  assertEquals(snapshot?.subject.id, "coffee-machine-cm01");
  assertEquals(await reader.get("another-snapshot-id"), undefined);
});

Deno.test("ordered exact resolver gives the active store priority for the same ID", async () => {
  const baseline = await baselineSnapshot();
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
  const baseline = await baselineSnapshot();
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

async function baselineSnapshot(): Promise<ThreadSnapshot> {
  const snapshot = await new FileExactThreadSnapshotDirectory(BASELINE_DIRECTORY).get(
    BASELINE_ID,
  );
  if (!snapshot) throw new Error("Test baseline is missing.");
  return snapshot;
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
