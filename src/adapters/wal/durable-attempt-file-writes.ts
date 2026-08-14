import type { DurableAttemptFile } from "./file-attempt-store.ts";

/**
 * Filesystem operations used by the WAL publication primitives.
 *
 * The interface stays injectable so tests can force partial writes and
 * publication failures that are difficult to reproduce with a real disk.
 */
export interface DurableAttemptWriteFileSystem {
  open(path: string, options: Deno.OpenOptions): Promise<DurableAttemptFile>;
  link(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const DENO_DURABLE_ATTEMPT_WRITE_FILE_SYSTEM: DurableAttemptWriteFileSystem = {
  open: (path, options) => Deno.open(path, options),
  link: (from, to) => Deno.link(from, to),
  rename: (from, to) => Deno.rename(from, to),
  remove: (path) => Deno.remove(path),
};

/**
 * Publish a complete, synced inode without ever exposing a partial final file.
 * `link` intentionally preserves create-new semantics for concurrent writers.
 */
export async function writeNewAttemptFileDurably(
  path: string,
  text: string,
  directory: string,
  noProgressMessage: string,
  fileSystem: DurableAttemptWriteFileSystem = DENO_DURABLE_ATTEMPT_WRITE_FILE_SYSTEM,
  syncBoundary?: string,
): Promise<void> {
  const temporary = temporaryPath(directory);
  try {
    await writeTemporaryDurably(temporary, text, noProgressMessage, fileSystem);
    await fileSystem.link(temporary, path);
    await syncAttemptDirectoryChain(directory, fileSystem, syncBoundary);
  } finally {
    await removeTemporaryIfPresent(temporary, fileSystem);
  }
}

/** Replace an existing WAL record through a complete, synced temporary inode. */
export async function replaceAttemptFileDurably(
  path: string,
  text: string,
  directory: string,
  noProgressMessage: string,
  fileSystem: DurableAttemptWriteFileSystem = DENO_DURABLE_ATTEMPT_WRITE_FILE_SYSTEM,
  syncBoundary?: string,
): Promise<void> {
  const temporary = temporaryPath(directory);
  try {
    await writeTemporaryDurably(temporary, text, noProgressMessage, fileSystem);
    await fileSystem.rename(temporary, path);
    await syncAttemptDirectoryChain(directory, fileSystem, syncBoundary);
  } finally {
    await removeTemporaryIfPresent(temporary, fileSystem);
  }
}

/**
 * Persist each newly created directory entry through the repository-owned
 * `state` boundary. This is intentionally a chain, not just the WAL leaf.
 */
export async function syncAttemptDirectoryChain(
  path: string,
  fileSystem: DurableAttemptWriteFileSystem = DENO_DURABLE_ATTEMPT_WRITE_FILE_SYSTEM,
  syncBoundary?: string,
): Promise<void> {
  let current = withoutTrailingSlash(path) || ".";
  const boundary = syncBoundary === undefined
    ? undefined
    : withoutTrailingSlash(syncBoundary) || ".";
  if (boundary !== undefined && !containsPath(boundary, current)) {
    throw new TypeError("WAL sync boundary must contain the attempt directory.");
  }
  while (current !== "/") {
    const directory = await fileSystem.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (
      current === boundary || current === "state" ||
      current.endsWith("/state") || current === "."
    ) return;
    const slash = current.lastIndexOf("/");
    current = slash < 0 ? "." : slash === 0 ? "/" : current.slice(0, slash);
  }
}

function containsPath(boundary: string, path: string): boolean {
  return path === boundary || path.startsWith(`${boundary}/`);
}

async function writeTemporaryDurably(
  path: string,
  text: string,
  noProgressMessage: string,
  fileSystem: DurableAttemptWriteFileSystem,
): Promise<void> {
  const file = await fileSystem.open(path, { createNew: true, write: true });
  try {
    const bytes = new TextEncoder().encode(text);
    let written = 0;
    while (written < bytes.length) {
      const count = await file.write(bytes.subarray(written));
      if (count <= 0) throw new Error(noProgressMessage);
      written += count;
    }
    await file.syncData();
  } finally {
    file.close();
  }
}

async function removeTemporaryIfPresent(
  path: string,
  fileSystem: DurableAttemptWriteFileSystem,
): Promise<void> {
  await fileSystem.remove(path).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
}

function temporaryPath(directory: string): string {
  // Identity-derived final names can be close to NAME_MAX. Keep the private
  // basename short and in the same directory so link/rename stays atomic.
  return `${withoutTrailingSlash(directory)}/.${crypto.randomUUID()}.tmp`;
}

function withoutTrailingSlash(path: string): string {
  return path.replace(/\/$/, "");
}
