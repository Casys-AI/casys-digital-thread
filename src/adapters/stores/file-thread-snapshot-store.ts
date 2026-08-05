import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";

export interface ThreadSnapshotFileEntry {
  name: string;
  isFile: boolean;
}

export interface ThreadSnapshotFileIo {
  mkdir(path: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  readDir(path: string): AsyncIterable<ThreadSnapshotFileEntry>;
}

const DENO_FILE_IO: ThreadSnapshotFileIo = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, contents) =>
    Deno.writeTextFile(path, contents, { createNew: true }),
  readDir: async function* (path) {
    for await (const entry of Deno.readDir(path)) {
      yield { name: entry.name, isFile: entry.isFile };
    }
  },
};

/**
 * Small immutable local store for canonical ThreadSnapshots.
 *
 * A snapshot id owns exactly one JSON document. Saving the same document is
 * idempotent; attempting to reuse the id for different content is rejected.
 */
export class FileThreadSnapshotStore implements ThreadSnapshotStore {
  readonly #snapshotByFileName = new Map<string, ThreadSnapshot>();

  constructor(
    private readonly directory: string,
    private readonly io: ThreadSnapshotFileIo = DENO_FILE_IO,
  ) {}

  async get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    const path = this.pathFor(snapshotId);
    const name = path.slice(path.lastIndexOf("/") + 1);
    const cached = this.#snapshotByFileName.get(name);
    if (cached) return structuredClone(cached);
    try {
      const snapshot = validateThreadSnapshot(
        JSON.parse(await this.io.readTextFile(path)),
      );
      this.#snapshotByFileName.set(name, snapshot);
      return structuredClone(snapshot);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    let entries: ThreadSnapshotFileEntry[];
    try {
      entries = [];
      for await (const entry of this.io.readDir(this.directory)) entries.push(entry);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }

    const snapshots: ThreadSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const value = await this.readSnapshotFile(entry.name);
      if (value.subject.id === subjectId) snapshots.push(value);
    }

    return snapshots.sort(compareNewestFirst)[0];
  }

  async save(snapshot: ThreadSnapshot): Promise<void> {
    const validated = validateThreadSnapshot(snapshot);
    await this.io.mkdir(this.directory);
    const existing = await this.get(validated.id);
    if (existing) {
      if (canonicalJson(existing) === canonicalJson(validated)) return;
      throw new Error(
        `ThreadSnapshot ${validated.id} already exists with different content.`,
      );
    }
    const sameRevision = await this.findSubjectRevision(
      validated.subject.id,
      validated.revision,
    );
    if (sameRevision) {
      throw new Error(
        `ThreadSnapshot subject ${validated.subject.id} revision ${validated.revision} already belongs to ${sameRevision.id}.`,
      );
    }
    await this.claimRevision(validated);
    const fileName = `${encodeURIComponent(validated.id)}.json`;
    try {
      await this.io.writeTextFile(
        this.pathFor(validated.id),
        `${JSON.stringify(validated, null, 2)}\n`,
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;

      // Another store instance may have won the createNew race after both
      // writers observed the id as absent. Bypass this instance's cache: the
      // file on disk is the authoritative value for the idempotency check.
      const written = await this.readSnapshotFileFresh(fileName);
      if (canonicalJson(written) === canonicalJson(validated)) return;
      throw new Error(
        `ThreadSnapshot ${validated.id} already exists with different content.`,
      );
    }
    this.#snapshotByFileName.set(
      fileName,
      validated,
    );
  }

  pathFor(snapshotId: string): string {
    if (!snapshotId.trim()) throw new Error("ThreadSnapshot id cannot be empty.");
    return joinPath(this.directory, `${encodeURIComponent(snapshotId)}.json`);
  }

  private async findSubjectRevision(
    subjectId: string,
    revision: number,
  ): Promise<ThreadSnapshot | undefined> {
    let entries: ThreadSnapshotFileEntry[];
    try {
      entries = [];
      for await (const entry of this.io.readDir(this.directory)) entries.push(entry);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const value = await this.readSnapshotFile(entry.name);
      if (value.subject.id === subjectId && value.revision === revision) return value;
    }
    return undefined;
  }

  private async readSnapshotFile(name: string): Promise<ThreadSnapshot> {
    const cached = this.#snapshotByFileName.get(name);
    if (cached) return structuredClone(cached);
    return await this.readSnapshotFileFresh(name);
  }

  private async readSnapshotFileFresh(name: string): Promise<ThreadSnapshot> {
    const snapshot = validateThreadSnapshot(
      JSON.parse(await this.io.readTextFile(joinPath(this.directory, name))),
    );
    this.#snapshotByFileName.set(name, snapshot);
    return structuredClone(snapshot);
  }

  private async claimRevision(snapshot: ThreadSnapshot): Promise<void> {
    const claimPath = this.revisionClaimPathFor(snapshot.subject.id, snapshot.revision);
    try {
      await this.io.writeTextFile(claimPath, snapshot.id);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const claimedBy = (await this.io.readTextFile(claimPath)).trim();
    if (claimedBy === snapshot.id) return;
    throw new Error(
      `ThreadSnapshot subject ${snapshot.subject.id} revision ${snapshot.revision} is already claimed by ${claimedBy}.`,
    );
  }

  private revisionClaimPathFor(subjectId: string, revision: number): string {
    return joinPath(
      this.directory,
      `.revision-${encodeURIComponent(subjectId)}-r${revision}.claim`,
    );
  }
}

function compareNewestFirst(left: ThreadSnapshot, right: ThreadSnapshot): number {
  return right.revision - left.revision ||
    right.generatedAt.localeCompare(left.generatedAt) ||
    right.id.localeCompare(left.id);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}
