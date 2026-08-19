import { assert, assertEquals, assertRejects } from "@std/assert";
import type { DurableAttemptFile } from "./file-attempt-store.ts";
import {
  type DurableAttemptWriteFileSystem,
  replaceAttemptFileDurably,
  syncAttemptDirectoryChain,
  writeNewAttemptFileDurably,
} from "./durable-attempt-file-writes.ts";

Deno.test("durable new-attempt publication writes every byte before linking", async () => {
  const fileSystem = new RecordingFileSystem(2);

  await writeNewAttemptFileDurably(
    "state/local/wal/run.json",
    "complete\n",
    "state/local/wal",
    "no progress",
    fileSystem,
  );

  assertEquals(fileSystem.text("state/local/wal/run.json"), "complete\n");
  assert(fileSystem.writeCalls > 1);
  assertEquals(fileSystem.temporaryPaths().length, 0);
  assertEquals(fileSystem.syncedDirectories, [
    "state/local/wal",
    "state/local",
    "state",
  ]);
  const linkIndex = fileSystem.operations.findIndex((value) =>
    value.startsWith("link:")
  );
  const dataSyncIndex = fileSystem.operations.findIndex((value) =>
    value.startsWith("sync-data:")
  );
  assert(dataSyncIndex >= 0 && linkIndex > dataSyncIndex);
});

Deno.test("durable replacement renames a complete inode and removes no final file", async () => {
  const fileSystem = new RecordingFileSystem(3);
  fileSystem.seed("state/local/wal/run.json", "old\n");

  await replaceAttemptFileDurably(
    "state/local/wal/run.json",
    "replacement\n",
    "state/local/wal",
    "no progress",
    fileSystem,
  );

  assertEquals(fileSystem.text("state/local/wal/run.json"), "replacement\n");
  assertEquals(fileSystem.temporaryPaths().length, 0);
  assert(fileSystem.operations.some((value) => value.startsWith("rename:")));
});

Deno.test("durable new-attempt publication preserves the concurrent winner", async () => {
  const fileSystem = new RecordingFileSystem(4);
  fileSystem.seed("state/local/wal/run.json", "winner\n");

  await assertRejects(
    () =>
      writeNewAttemptFileDurably(
        "state/local/wal/run.json",
        "loser\n",
        "state/local/wal",
        "no progress",
        fileSystem,
      ),
    Deno.errors.AlreadyExists,
  );

  assertEquals(fileSystem.text("state/local/wal/run.json"), "winner\n");
  assertEquals(fileSystem.temporaryPaths().length, 0);
});

Deno.test("durable attempt publication fails closed and cleans its temporary file on zero progress", async () => {
  const fileSystem = new RecordingFileSystem(0);

  await assertRejects(
    () =>
      writeNewAttemptFileDurably(
        "state/local/wal/run.json",
        "record\n",
        "state/local/wal",
        "WAL made no write progress.",
        fileSystem,
      ),
    Error,
    "WAL made no write progress.",
  );

  assertEquals(fileSystem.files.has("state/local/wal/run.json"), false);
  assertEquals(fileSystem.temporaryPaths().length, 0);
});

Deno.test("directory syncing stops at the repository-owned state boundary", async () => {
  const fileSystem = new RecordingFileSystem(4);

  await syncAttemptDirectoryChain("sandbox/state/local/wal", fileSystem);

  assertEquals(fileSystem.syncedDirectories, [
    "sandbox/state/local/wal",
    "sandbox/state/local",
    "sandbox/state",
  ]);
});

Deno.test("directory syncing stops at an explicit absolute temporary boundary", async () => {
  const fileSystem = new RecordingFileSystem(4);

  await syncAttemptDirectoryChain(
    "/private/tmp/casys-run/attempts",
    fileSystem,
    "/private/tmp/casys-run",
  );

  assertEquals(fileSystem.syncedDirectories, [
    "/private/tmp/casys-run/attempts",
    "/private/tmp/casys-run",
  ]);
});

Deno.test("directory syncing rejects a boundary outside the attempt directory", async () => {
  const fileSystem = new RecordingFileSystem(4);

  await assertRejects(
    () =>
      syncAttemptDirectoryChain(
        "/private/tmp/casys-run/attempts",
        fileSystem,
        "/private/tmp/foreign-run",
      ),
    TypeError,
    "must contain",
  );
  assertEquals(fileSystem.syncedDirectories, []);
});

class RecordingFileSystem implements DurableAttemptWriteFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly operations: string[] = [];
  readonly syncedDirectories: string[] = [];
  writeCalls = 0;

  constructor(private readonly maximumWriteSize: number) {}

  seed(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }

  text(path: string): string | undefined {
    const bytes = this.files.get(path);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  }

  temporaryPaths(): string[] {
    return [...this.files.keys()].filter((path) => path.endsWith(".tmp"));
  }

  open(path: string, options: Deno.OpenOptions): Promise<DurableAttemptFile> {
    if (options.read === true && options.write !== true) {
      this.operations.push(`open-directory:${path}`);
      return Promise.resolve({
        write: () => Promise.reject(new Error("directory is not writable")),
        syncData: () => Promise.reject(new Error("directory has no data sync")),
        sync: () => {
          this.syncedDirectories.push(path);
          this.operations.push(`sync-directory:${path}`);
          return Promise.resolve();
        },
        close: () => this.operations.push(`close:${path}`),
      });
    }
    if (options.createNew === true && this.files.has(path)) {
      return Promise.reject(new Deno.errors.AlreadyExists(path));
    }
    this.operations.push(`open:${path}`);
    let pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
    this.files.set(path, pending);
    return Promise.resolve({
      write: (data) => {
        const count = Math.min(data.byteLength, this.maximumWriteSize);
        pending = appendBytes(pending, data.subarray(0, count));
        this.files.set(path, pending);
        this.writeCalls++;
        this.operations.push(`write:${path}:${count}`);
        return Promise.resolve(count);
      },
      syncData: () => {
        this.operations.push(`sync-data:${path}`);
        return Promise.resolve();
      },
      sync: () => Promise.reject(new Error("file is not a directory")),
      close: () => this.operations.push(`close:${path}`),
    });
  }

  link(from: string, to: string): Promise<void> {
    if (this.files.has(to)) return Promise.reject(new Deno.errors.AlreadyExists(to));
    const bytes = this.files.get(from);
    if (!bytes) return Promise.reject(new Deno.errors.NotFound(from));
    this.files.set(to, bytes.slice());
    this.operations.push(`link:${from}:${to}`);
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) return Promise.reject(new Deno.errors.NotFound(from));
    this.files.set(to, bytes);
    this.files.delete(from);
    this.operations.push(`rename:${from}:${to}`);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    if (!this.files.delete(path)) return Promise.reject(new Deno.errors.NotFound(path));
    this.operations.push(`remove:${path}`);
    return Promise.resolve();
  }
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}
