import { deterministicJson, sha256Fingerprint } from "../domain/deterministic-json.ts";
import type {
  ProjectDiscoveryRevisionStore,
} from "../domain/project-discovery-command-service.ts";
import { ProjectDiscoveryStoreConflictError } from "../domain/project-discovery-command-service.ts";
import type { ProjectDiscoverySnapshot } from "../domain/project-discovery.ts";
import { validateProjectDiscoverySnapshot } from "../domain/project-discovery-validation.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

export interface ProjectDiscoveryRevisionFileEntry {
  readonly name: string;
  readonly isFile: boolean;
}

export interface ProjectDiscoveryRevisionFileIo {
  mkdir(path: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFileCreateNew(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readDir(path: string): AsyncIterable<ProjectDiscoveryRevisionFileEntry>;
}

const DENO_FILE_IO: ProjectDiscoveryRevisionFileIo = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFileCreateNew: (path, contents) =>
    Deno.writeTextFile(path, contents, { createNew: true }),
  rename: (from, to) => Deno.rename(from, to),
  readDir: async function* (path) {
    for await (const entry of Deno.readDir(path)) {
      yield { name: entry.name, isFile: entry.isFile };
    }
  },
};

/**
 * Immutable on-disk discovery store. Numeric revision claims provide a
 * cross-process compare-and-swap boundary; no current.json alias is trusted.
 */
export class FileProjectDiscoveryRevisionStore
  implements ProjectDiscoveryRevisionStore {
  constructor(
    private readonly directory = "state/local/project-discoveries",
    private readonly io: ProjectDiscoveryRevisionFileIo = DENO_FILE_IO,
  ) {}

  async get(discoveryId: string): Promise<ProjectDiscoverySnapshot | undefined> {
    validateDiscoveryId(discoveryId);
    let entries: ProjectDiscoveryRevisionFileEntry[] = [];
    try {
      for await (const entry of this.io.readDir(this.discoveryDirectory(discoveryId))) {
        entries.push(entry);
      }
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    const revisionEntries = entries.filter((entry) =>
      entry.isFile && /^\d{10}\.(?:json|claim)$/.test(entry.name)
    );
    const highestClaim = highestRevision(revisionEntries, "claim");
    const highestJson = highestRevision(revisionEntries, "json");
    if (highestClaim !== undefined && highestClaim > (highestJson ?? 0)) {
      // Never guess whether an interrupted writer had durable authority. An
      // unpublished claim requires explicit operator recovery; silently
      // deleting or reusing it could fork one immutable revision.
      throw new ProjectDiscoveryStoreConflictError(
        `Project discovery ${discoveryId} revision ${highestClaim} is claimed but not durably published.`,
      );
    }
    entries = revisionEntries.filter((entry) => entry.name.endsWith(".json"))
      .sort((left, right) => right.name.localeCompare(left.name));
    const highest = entries[0];
    if (!highest) return undefined;
    return await this.readRevision(discoveryId, Number(highest.name.slice(0, 10)));
  }

  async getRevision(
    discoveryId: string,
    revision: number,
  ): Promise<ProjectDiscoverySnapshot | undefined> {
    validateDiscoveryId(discoveryId);
    validateRevision(revision);
    return await this.readRevision(discoveryId, revision);
  }

  async createInitial(
    snapshot: ProjectDiscoverySnapshot,
  ): Promise<ProjectDiscoverySnapshot> {
    const validated = validateProjectDiscoverySnapshot(snapshot);
    if (validated.revision !== 1 || validated.previous) {
      throw new ProjectDiscoveryStoreConflictError(
        "An initial ProjectDiscoverySnapshot must be revision 1 without previous.",
      );
    }
    await this.writeExclusive(validated);
    return structuredClone(validated);
  }

  async commit(
    snapshot: ProjectDiscoverySnapshot,
    expectedRevision: number,
  ): Promise<ProjectDiscoverySnapshot> {
    validateRevision(expectedRevision);
    const validated = validateProjectDiscoverySnapshot(snapshot);
    const current = await this.get(validated.discoveryId);
    if (!current || current.revision !== expectedRevision) {
      throw new ProjectDiscoveryStoreConflictError(
        `Project discovery ${validated.discoveryId} expected revision ${expectedRevision}, current revision is ${
          current?.revision ?? "absent"
        }.`,
      );
    }
    if (
      validated.revision !== expectedRevision + 1 ||
      validated.previous?.revision !== current.revision ||
      validated.previous.snapshotId !== current.id
    ) {
      throw new ProjectDiscoveryStoreConflictError(
        "Project discovery commit does not extend the exact current revision.",
      );
    }
    await this.writeExclusive(validated);
    return structuredClone(validated);
  }

  async contentFingerprint(
    discoveryId: string,
    revision: number,
  ): Promise<ContentFingerprint | undefined> {
    const snapshot = await this.getRevision(discoveryId, revision);
    return snapshot ? await sha256Fingerprint(snapshot) : undefined;
  }

  private async readRevision(
    discoveryId: string,
    revision: number,
  ): Promise<ProjectDiscoverySnapshot | undefined> {
    try {
      const snapshot = validateProjectDiscoverySnapshot(
        JSON.parse(
          await this.io.readTextFile(this.revisionPath(discoveryId, revision)),
        ),
      );
      if (
        snapshot.discoveryId !== discoveryId || snapshot.revision !== revision
      ) {
        throw new Error(
          `Project discovery path ${discoveryId}@${revision} contains ${snapshot.discoveryId}@${snapshot.revision}.`,
        );
      }
      return structuredClone(snapshot);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async writeExclusive(snapshot: ProjectDiscoverySnapshot): Promise<void> {
    validateDiscoveryId(snapshot.discoveryId);
    const directory = this.discoveryDirectory(snapshot.discoveryId);
    await this.io.mkdir(directory);
    const claimPath = this.claimPath(snapshot.discoveryId, snapshot.revision);
    try {
      await this.io.writeTextFileCreateNew(claimPath, `${snapshot.id}\n`);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.waitUntilPublished(snapshot.discoveryId, snapshot.revision);
      throw new ProjectDiscoveryStoreConflictError(
        `Project discovery ${snapshot.discoveryId} revision ${snapshot.revision} is already claimed by another process.`,
      );
    }
    const revisionPath = this.revisionPath(
      snapshot.discoveryId,
      snapshot.revision,
    );
    const pendingPath = `${revisionPath}.pending-${crypto.randomUUID()}`;
    await this.io.writeTextFileCreateNew(
      pendingPath,
      `${deterministicJson(snapshot)}\n`,
    );
    await this.io.rename(pendingPath, revisionPath);
  }

  private discoveryDirectory(discoveryId: string): string {
    return joinPath(this.directory, encodeURIComponent(discoveryId));
  }

  private revisionPath(discoveryId: string, revision: number): string {
    return joinPath(
      this.discoveryDirectory(discoveryId),
      `${String(revision).padStart(10, "0")}.json`,
    );
  }

  private claimPath(discoveryId: string, revision: number): string {
    return joinPath(
      this.discoveryDirectory(discoveryId),
      `${String(revision).padStart(10, "0")}.claim`,
    );
  }

  private async waitUntilPublished(
    discoveryId: string,
    revision: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await this.readRevision(discoveryId, revision)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
  }
}

function highestRevision(
  entries: readonly ProjectDiscoveryRevisionFileEntry[],
  extension: "json" | "claim",
): number | undefined {
  const revisions = entries.filter((entry) => entry.name.endsWith(`.${extension}`))
    .map((entry) => Number(entry.name.slice(0, 10)));
  return revisions.length > 0 ? Math.max(...revisions) : undefined;
}

function validateDiscoveryId(discoveryId: string): void {
  if (!discoveryId.trim()) {
    throw new TypeError("Project discovery id cannot be empty.");
  }
  if (!/^[A-Za-z0-9]/.test(discoveryId)) {
    throw new TypeError(
      "Project discovery id must begin with an ASCII alphanumeric character.",
    );
  }
  if (discoveryId.toLowerCase() === "latest") {
    throw new TypeError("Project discovery id cannot use a latest alias.");
  }
}

function validateRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError("Project discovery revision must be a positive safe integer.");
  }
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
    (error instanceof Error &&
      (error.name === "AlreadyExists" || /already exists/i.test(error.message)));
}
