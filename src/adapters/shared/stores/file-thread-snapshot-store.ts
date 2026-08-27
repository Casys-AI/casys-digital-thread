import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

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
    if (cached) return cached;
    try {
      const snapshot = validateThreadSnapshot(
        JSON.parse(await this.io.readTextFile(path)),
      );
      this.#snapshotByFileName.set(name, snapshot);
      return snapshot;
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

  /** Bypass the in-memory convenience cache at a durability readback boundary. */
  async getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    try {
      return await this.readSnapshotFileFresh(
        `${encodeURIComponent(snapshotId)}.json`,
      );
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async save(snapshot: ThreadSnapshot): Promise<void> {
    const validated = validateThreadSnapshot(snapshot);
    await this.io.mkdir(this.directory);
    const existing = await this.get(validated.id);
    if (existing) {
      if (canonicalJson(existing) === canonicalJson(validated)) {
        await this.syncDirectoryIfDurableIo();
        return;
      }
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
      await this.writeNewDurably(
        this.pathFor(validated.id),
        `${JSON.stringify(validated, null, 2)}\n`,
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;

      // Another store instance may have won the createNew race after both
      // writers observed the id as absent. Bypass this instance's cache: the
      // file on disk is the authoritative value for the idempotency check.
      const written = await this.readSnapshotFileFresh(fileName);
      if (canonicalJson(written) === canonicalJson(validated)) {
        await this.syncDirectoryIfDurableIo();
        return;
      }
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
    if (cached) return cached;
    return await this.readSnapshotFileFresh(name);
  }

  private async readSnapshotFileFresh(name: string): Promise<ThreadSnapshot> {
    const snapshot = validateThreadSnapshot(
      JSON.parse(await this.io.readTextFile(joinPath(this.directory, name))),
    );
    this.#snapshotByFileName.set(name, snapshot);
    return snapshot;
  }

  private async claimRevision(snapshot: ThreadSnapshot): Promise<void> {
    const claimPath = this.revisionClaimPathFor(snapshot.subject.id, snapshot.revision);
    try {
      await this.writeNewDurably(claimPath, snapshot.id);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const claimedBy = (await this.io.readTextFile(claimPath)).trim();
    if (claimedBy === snapshot.id) {
      await this.syncDirectoryIfDurableIo();
      return;
    }
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

  private async writeNewDurably(path: string, text: string): Promise<void> {
    if (this.io !== DENO_FILE_IO) return await this.io.writeTextFile(path, text);
    // Keep the temporary basename independent from a potentially long,
    // content-addressed snapshot id: appending a UUID to `path` can exceed
    // NAME_MAX before the atomic link is attempted.
    const parent = path.slice(0, path.lastIndexOf("/"));
    const temporary = `${parent}/.${crypto.randomUUID()}.tmp`;
    try {
      const file = await Deno.open(temporary, { createNew: true, write: true });
      try {
        const bytes = new TextEncoder().encode(text);
        let written = 0;
        while (written < bytes.length) {
          const count = await file.write(bytes.subarray(written));
          if (count <= 0) throw new Error("ThreadSnapshot write made no progress.");
          written += count;
        }
        await file.syncData();
      } finally {
        file.close();
      }
      await Deno.link(temporary, path);
      await syncDirectoryChain(this.directory);
    } finally {
      await Deno.remove(temporary).catch((error) => {
        if (!isNotFound(error)) throw error;
      });
    }
  }

  private async syncDirectoryIfDurableIo(): Promise<void> {
    if (this.io === DENO_FILE_IO) await syncDirectoryChain(this.directory);
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

async function syncDirectoryChain(path: string): Promise<void> {
  let current = path.replace(/\/+$/, "") || ".";
  while (current !== "/") {
    const directory = await Deno.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (current === "state" || current.endsWith("/state")) return;
    // A relative custom root (for example `inspection-snapshots`) has `.` as
    // its parent. Sync it once: that is the directory entry which records the
    // root's creation. Only then stop, so the loop cannot spin on `.`.
    if (current === ".") return;
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
  }
}
