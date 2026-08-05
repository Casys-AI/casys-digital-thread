import { assertEquals, assertRejects } from "@std/assert";
import {
  FileSensitivityRelationsAttemptStore,
  SensitivityRelationsWriteOutcomeUnknownError,
} from "./file-sensitivity-relations-attempt-store.ts";

// ---------------------------------------------------------------------------
// In-memory file system for tests (no disk I/O)
// ---------------------------------------------------------------------------

interface InMemoryFile {
  write(data: Uint8Array): Promise<number>;
  syncData(): Promise<void>;
  sync(): Promise<void>;
  close(): void;
}

function makeInMemoryFileSystem(): {
  files: Map<string, string>;
  fileSystem: {
    mkdir(path: string): Promise<void>;
    open(
      path: string,
      options: { createNew?: boolean; write?: boolean; read?: boolean },
    ): Promise<InMemoryFile>;
    readTextFile(path: string): Promise<string>;
    rename(from: string, to: string): Promise<void>;
  };
} {
  const files = new Map<string, string>();
  const chunks = new Map<string, Uint8Array[]>();

  const fileSystem = {
    mkdir(_path: string): Promise<void> {
      return Promise.resolve();
    },

    open(
      path: string,
      options: { createNew?: boolean; write?: boolean; read?: boolean },
    ): Promise<InMemoryFile> {
      if (options.createNew && files.has(path)) {
        return Promise.reject(new Deno.errors.AlreadyExists(`${path} already exists`));
      }
      const buf: Uint8Array[] = [];
      chunks.set(path, buf);
      const file: InMemoryFile = {
        write(data: Uint8Array): Promise<number> {
          if (options.read) return Promise.resolve(0); // sync-only open for directories
          buf.push(data);
          return Promise.resolve(data.length);
        },
        syncData(): Promise<void> {
          const all = new Uint8Array(buf.reduce((n, b) => n + b.length, 0));
          let offset = 0;
          for (const b of buf) {
            all.set(b, offset);
            offset += b.length;
          }
          files.set(path, new TextDecoder().decode(all));
          return Promise.resolve();
        },
        sync(): Promise<void> {
          return Promise.resolve();
        },
        close() {},
      };
      return Promise.resolve(file);
    },

    readTextFile(path: string): Promise<string> {
      const text = files.get(path);
      if (text === undefined) {
        return Promise.reject(new Deno.errors.NotFound(`${path} not found`));
      }
      return Promise.resolve(text);
    },

    rename(from: string, to: string): Promise<void> {
      const text = files.get(from);
      if (text === undefined) {
        return Promise.reject(new Deno.errors.NotFound(`${from} not found`));
      }
      files.set(to, text);
      files.delete(from);
      return Promise.resolve();
    },
  };

  return { files, fileSystem };
}

const DIGEST = "a".repeat(64);
const PROJECT_ID = "coffee-machine-cm01-v3";
const RUN_ID = "run-2026-08-05-sensitivity-relations";
const DISPATCHED_AT = "2026-08-05T09:00:00.000Z";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "FileSensitivityRelationsAttemptStore.begin returns dispatch on first call",
  async () => {
    const { fileSystem } = makeInMemoryFileSystem();
    const store = new FileSensitivityRelationsAttemptStore("state/test", fileSystem);
    const result = await store.begin({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      relationsDigest: DIGEST,
      dispatchedAt: DISPATCHED_AT,
    });
    assertEquals(result.action, "dispatch");
  },
);

Deno.test(
  "FileSensitivityRelationsAttemptStore.begin raises OutcomeUnknown on second call before complete",
  async () => {
    const { fileSystem } = makeInMemoryFileSystem();
    const store = new FileSensitivityRelationsAttemptStore("state/test", fileSystem);
    await store.begin({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      relationsDigest: DIGEST,
      dispatchedAt: DISPATCHED_AT,
    });
    await assertRejects(
      () =>
        store.begin({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          relationsDigest: DIGEST,
          dispatchedAt: DISPATCHED_AT,
        }),
      SensitivityRelationsWriteOutcomeUnknownError,
    );
  },
);

Deno.test(
  "FileSensitivityRelationsAttemptStore: begin → complete → begin returns completed result",
  async () => {
    const { fileSystem } = makeInMemoryFileSystem();
    const store = new FileSensitivityRelationsAttemptStore("state/test", fileSystem);
    await store.begin({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      relationsDigest: DIGEST,
      dispatchedAt: DISPATCHED_AT,
    });
    const elementId = "elem-abc-123";
    await store.complete({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      relationsDigest: DIGEST,
      dispatchedAt: DISPATCHED_AT,
      completedAt: "2026-08-05T09:01:00.000Z",
      result: {
        elementId,
        parentId: "parent-xyz",
        textSha256: "b".repeat(64),
        editingContextId: "ctx-def-456",
      },
    });
    const result = await store.begin({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      relationsDigest: DIGEST,
      dispatchedAt: DISPATCHED_AT,
    });
    assertEquals(result.action, "completed");
    if (result.action === "completed") {
      assertEquals(result.result.elementId, elementId);
    }
  },
);

Deno.test(
  "FileSensitivityRelationsAttemptStore.read returns undefined for unknown key",
  async () => {
    const { fileSystem } = makeInMemoryFileSystem();
    const store = new FileSensitivityRelationsAttemptStore("state/test", fileSystem);
    const result = await store.read(PROJECT_ID, RUN_ID, DIGEST);
    assertEquals(result, undefined);
  },
);
