import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

/** Minimal read boundary needed to resolve project evidence by exact snapshot ID. */
export interface ExactThreadSnapshotReader {
  get(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

/**
 * Resolve from ordered stores. The active store goes first; a versioned
 * baseline may satisfy only the same exact ID, never a latest/nearest alias.
 */
export class OrderedExactThreadSnapshotReader implements ExactThreadSnapshotReader {
  constructor(private readonly readers: readonly ExactThreadSnapshotReader[]) {
    if (readers.length === 0) {
      throw new TypeError("At least one exact ThreadSnapshot reader is required.");
    }
  }

  async get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    exactSnapshotId(snapshotId);
    for (const reader of this.readers) {
      const candidate = await reader.get(snapshotId);
      if (!candidate) continue;
      const snapshot = validateThreadSnapshot(candidate);
      if (snapshot.id !== snapshotId) {
        throw new Error(
          `Exact ThreadSnapshot reader returned ${snapshot.id} for requested ID ${snapshotId}.`,
        );
      }
      return snapshot;
    }
    return undefined;
  }
}

export interface ExactThreadSnapshotFileEntry {
  name: string;
  isFile: boolean;
}

export interface ExactThreadSnapshotFileIo {
  readDir(path: string): AsyncIterable<ExactThreadSnapshotFileEntry>;
  readTextFile(path: string): Promise<string>;
}

const DENO_FILE_IO: ExactThreadSnapshotFileIo = {
  readDir: async function* (path) {
    for await (const entry of Deno.readDir(path)) {
      yield { name: entry.name, isFile: entry.isFile };
    }
  },
  readTextFile: (path) => Deno.readTextFile(path),
};

/**
 * Read-only catalog for checked-in observed baseline captures.
 *
 * Filenames are presentation only. Resolution always validates file content
 * and compares the requested canonical ID exactly.
 */
export class FileExactThreadSnapshotDirectory implements ExactThreadSnapshotReader {
  constructor(
    private readonly directory: string,
    private readonly io: ExactThreadSnapshotFileIo = DENO_FILE_IO,
  ) {}

  async get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    exactSnapshotId(snapshotId);
    let entries: ExactThreadSnapshotFileEntry[] = [];
    try {
      for await (const entry of this.io.readDir(this.directory)) {
        entries.push(entry);
      }
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    entries = entries.filter((entry) => entry.isFile && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name));

    let resolved: ThreadSnapshot | undefined;
    for (const entry of entries) {
      const snapshot = validateThreadSnapshot(
        JSON.parse(
          await this.io.readTextFile(joinPath(this.directory, entry.name)),
        ),
      );
      if (snapshot.id !== snapshotId) continue;
      if (resolved) {
        throw new Error(
          `Exact ThreadSnapshot ID ${snapshotId} is declared by more than one baseline file.`,
        );
      }
      resolved = snapshot;
    }
    return resolved;
  }
}

function exactSnapshotId(snapshotId: string): void {
  if (!snapshotId.trim() || snapshotId.toLowerCase() === "latest") {
    throw new TypeError("An exact non-empty ThreadSnapshot ID is required.");
  }
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}
