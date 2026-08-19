import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  FileSysonModelSeedAttemptStore,
  SysonModelSeedWriteOutcomeUnknownError,
} from "./file-syson-model-seed-attempt-store.ts";

const identity = {
  projectId: "drone-project",
  runId: "run:seed-syson",
  step: "project-create" as const,
  dispatchedAt: "2026-08-02T08:00:00.000Z",
};

Deno.test("SysON seed write journal refuses an unknown provider outcome instead of replaying it", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-attempt-" });
  try {
    const store = new FileSysonModelSeedAttemptStore(directory);
    assertEquals(await store.begin(identity), { action: "dispatch" });
    assertEquals(
      (await store.read(identity.projectId, identity.runId, identity.step))?.status,
      "dispatched",
    );
    await assertRejects(
      () => store.begin(identity),
      SysonModelSeedWriteOutcomeUnknownError,
      "will not be retried automatically",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON seed write journal resumes only an exact recorded normalized result", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-attempt-" });
  try {
    const store = new FileSysonModelSeedAttemptStore(directory);
    await store.begin(identity);
    const completion = {
      ...identity,
      completedAt: "2026-08-02T08:00:01.000Z",
      result: { projectId: "syson-project-1", editingContextId: "editing-context-1" },
    };
    await store.complete(completion);
    await store.complete(completion);
    assertEquals(await store.begin(identity), {
      action: "completed",
      result: completion.result,
    });
    await assertRejects(
      () =>
        store.complete({
          ...completion,
          result: {
            projectId: "syson-project-2",
            editingContextId: "editing-context-1",
          },
        }),
      Error,
      "conflicts with its recorded result",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON seed write journal treats an unreadable existing marker as an unknown outcome", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-attempt-" });
  try {
    const store = new FileSysonModelSeedAttemptStore(directory);
    await Deno.writeTextFile(
      store.pathFor(identity.projectId, identity.runId, identity.step),
      "{",
      { createNew: true },
    );

    await assertRejects(
      () => store.begin(identity),
      SysonModelSeedWriteOutcomeUnknownError,
      "will not be retried automatically",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON seed write journal fsyncs the complete dispatched record before it permits dispatch", async () => {
  const fileSystem = new RecordingAttemptFileSystem(3);
  const directory = "state/local/syson-model-seed-attempts";
  const store = new FileSysonModelSeedAttemptStore(directory, fileSystem);

  assertEquals(await store.begin(identity), { action: "dispatch" });

  const path = store.pathFor(identity.projectId, identity.runId, identity.step);
  const fileSync = fileSystem.operations.indexOf(`sync:${path}`);
  const directorySync = fileSystem.operations.lastIndexOf(
    `sync-directory:${directory}`,
  );
  const localSync = fileSystem.operations.lastIndexOf("sync-directory:state/local");
  const stateSync = fileSystem.operations.lastIndexOf("sync-directory:state");
  const close = fileSystem.operations.indexOf(`close:${path}`);
  assert(fileSystem.writeCalls > 1, "the test double must exercise partial writes");
  assert(fileSync >= 0, "the dispatched record must sync its bytes");
  assert(close > fileSync, "the dispatched record must close after fsync");
  assert(
    directorySync > close,
    "the parent directory must sync after the new dispatched record is durable",
  );
  assert(
    localSync > directorySync,
    "recursive creation must durably link the attempt directory into state/local",
  );
  assert(
    stateSync > localSync,
    "recursive creation must durably link state/local into the state anchor",
  );
  assertEquals(
    fileSystem.operations.includes("sync-directory:."),
    false,
    "the durability boundary must stop at the repository-owned state anchor",
  );
  assertEquals(
    JSON.parse(new TextDecoder().decode(fileSystem.files.get(path)!)).status,
    "dispatched",
  );
});

Deno.test("SysON seed write journal stops an absolute directory sync chain at its state component", async () => {
  const fileSystem = new RecordingAttemptFileSystem(1024);
  const directory = "/workspace/casys/state/local/syson-model-seed-attempts";
  const store = new FileSysonModelSeedAttemptStore(directory, fileSystem);

  assertEquals(await store.begin(identity), { action: "dispatch" });

  assertEquals(
    fileSystem.operations.filter((operation) =>
      operation.startsWith("sync-directory:")
    ),
    [
      `sync-directory:${directory}`,
      "sync-directory:/workspace/casys/state/local",
      "sync-directory:/workspace/casys/state",
    ],
  );
  assertEquals(
    fileSystem.operations.includes("sync-directory:/workspace/casys"),
    false,
  );
  assertEquals(fileSystem.operations.includes("sync-directory:/"), false);
});

Deno.test("SysON seed write journal atomically replaces a dispatched record with its completed result", async () => {
  const fileSystem = new RecordingAttemptFileSystem(5);
  const store = new FileSysonModelSeedAttemptStore("attempts", fileSystem);
  const path = store.pathFor(identity.projectId, identity.runId, identity.step);
  await store.begin(identity);
  const beforeCompletion = fileSystem.operations.length;

  await store.complete({
    ...identity,
    completedAt: "2026-08-02T08:00:01.000Z",
    result: { projectId: "syson-project-1" },
  });

  const operations = fileSystem.operations.slice(beforeCompletion);
  const renameIndex = operations.findIndex((operation) =>
    operation.startsWith("rename:")
  );
  const temporaryPath = operations[renameIndex]!.split(":").slice(1, -1).join(":");
  const temporarySync = operations.indexOf(`sync:${temporaryPath}`);
  const directorySync = operations.lastIndexOf("sync-directory:attempts");
  assert(renameIndex >= 0, "completion must atomically rename a prepared record");
  assert(temporarySync >= 0, "completion bytes must sync before rename");
  assert(renameIndex > temporarySync, "rename must follow the temporary-file fsync");
  assert(
    directorySync > renameIndex,
    "the parent directory must sync after the completed record is renamed",
  );
  assertEquals(
    JSON.parse(new TextDecoder().decode(fileSystem.files.get(path)!)).status,
    "completed",
  );
  assertEquals(fileSystem.files.has(temporaryPath), false);
});

class RecordingAttemptFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly operations: string[] = [];
  writeCalls = 0;

  constructor(private readonly maximumWriteSize: number) {}

  mkdir(path: string): Promise<void> {
    this.operations.push(`mkdir:${path}`);
    return Promise.resolve();
  }

  open(
    path: string,
    options: Deno.OpenOptions,
  ): Promise<{
    write(data: Uint8Array): Promise<number>;
    syncData(): Promise<void>;
    sync(): Promise<void>;
    close(): void;
  }> {
    if (options.read === true && options.write !== true) {
      this.operations.push(`open-directory:${path}`);
      return Promise.resolve({
        write: () => Promise.reject(new Error("directory is not writable")),
        syncData: () => {
          this.operations.push(`sync:${path}`);
          return Promise.resolve();
        },
        sync: () => {
          this.operations.push(`sync-directory:${path}`);
          return Promise.resolve();
        },
        close: () => this.operations.push(`close:${path}`),
      });
    }
    if (options.createNew === true && this.files.has(path)) {
      throw new Deno.errors.AlreadyExists(path);
    }
    this.operations.push(`open:${path}`);
    let pending = options.truncate === true
      ? new Uint8Array()
      : this.files.get(path) ?? new Uint8Array();
    if (options.createNew === true) this.files.set(path, new Uint8Array());
    return Promise.resolve({
      write: (data) => {
        const count = Math.min(data.byteLength, this.maximumWriteSize);
        pending = appendBytes(pending, data.subarray(0, count));
        this.writeCalls++;
        this.operations.push(`write:${path}:${count}`);
        return Promise.resolve(count);
      },
      syncData: () => {
        this.files.set(path, pending.slice());
        this.operations.push(`sync:${path}`);
        return Promise.resolve();
      },
      sync: () => {
        this.operations.push(`sync-directory:${path}`);
        return Promise.resolve();
      },
      close: () => this.operations.push(`close:${path}`),
    });
  }

  readTextFile(path: string): Promise<string> {
    const bytes = this.files.get(path);
    if (!bytes) return Promise.reject(new Deno.errors.NotFound(path));
    return Promise.resolve(new TextDecoder().decode(bytes));
  }

  rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) return Promise.reject(new Deno.errors.NotFound(from));
    this.files.set(to, bytes);
    this.files.delete(from);
    this.operations.push(`rename:${from}:${to}`);
    return Promise.resolve();
  }
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}
