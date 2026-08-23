import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import { validateEngineeringProjectExtension } from "../../../domain/project/engineering-project-extension.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";

/** Read-only boundary used by the Workbench BFF. */
export interface EngineeringProjectStore {
  get(): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface EngineeringProjectFileIo {
  readTextFile(path: string): Promise<string>;
}

const DENO_FILE_IO: EngineeringProjectFileIo = {
  readTextFile: (path) => Deno.readTextFile(path),
};

/**
 * Loads one declarative EngineeringProjectSnapshot from disk.
 *
 * The adapter deliberately exposes no write or execution operation. Every
 * read crosses the domain validator so edits to the project manifest cannot
 * silently reach the browser with an invalid contract.
 */
export class FileEngineeringProjectStore implements EngineeringProjectStore {
  constructor(
    private readonly path: string,
    private readonly io: EngineeringProjectFileIo = DENO_FILE_IO,
  ) {}

  async get(): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const value = JSON.parse(await this.io.readTextFile(this.path));
      return structuredClone(validateEngineeringProjectSnapshot(value));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

export interface EngineeringProjectRevisionFileEntry {
  readonly name: string;
  readonly isFile: boolean;
}

export interface EngineeringProjectRevisionFileIo {
  mkdir(path: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFileCreateNew(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readDir(path: string): AsyncIterable<EngineeringProjectRevisionFileEntry>;
}

const DENO_REVISION_FILE_IO: EngineeringProjectRevisionFileIo = {
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
 * Immutable active project store. Each revision owns one deterministic JSON
 * file, and createNew on the numeric revision path is the cross-process CAS.
 */
export class FileEngineeringProjectRevisionStore
  implements EngineeringProjectRevisionStore {
  constructor(
    private readonly directory = "state/local/engineering-projects",
    private readonly io: EngineeringProjectRevisionFileIo = DENO_REVISION_FILE_IO,
  ) {}

  async get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    validateProjectId(projectId);
    let entries: EngineeringProjectRevisionFileEntry[] = [];
    try {
      for await (const entry of this.io.readDir(this.projectDirectory(projectId))) {
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
      throw new EngineeringProjectStoreConflictError(
        `Engineering project ${projectId} revision ${highestClaim} is claimed but not durably published.`,
      );
    }
    entries = entries.filter((entry) =>
      entry.isFile && /^\d{10}\.json$/.test(entry.name)
    ).sort((left, right) => right.name.localeCompare(left.name));
    const highest = entries[0];
    if (!highest) return undefined;
    // The highest claimed revision is authoritative. Corruption or permission
    // errors fail closed instead of presenting an older revision as current.
    return await this.readRevision(projectId, Number(highest.name.slice(0, 10)));
  }

  async getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    validateProjectId(projectId);
    validateRevision(revision);
    return await this.readRevision(projectId, revision);
  }

  async createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    const validated = validateEngineeringProjectSnapshot(snapshot);
    if (validated.revision !== 1 || validated.previous) {
      throw new EngineeringProjectStoreConflictError(
        "An initial EngineeringProjectSnapshot must be revision 1 without previous.",
      );
    }
    await this.writeExclusive(validated);
    return structuredClone(validated);
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    validateRevision(expectedRevision);
    const validated = validateEngineeringProjectSnapshot(snapshot);
    const current = await this.get(validated.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError(
        `Engineering project ${validated.project.id} expected revision ${expectedRevision}, current revision is ${
          current?.revision ?? "absent"
        }.`,
      );
    }
    if (
      validated.revision !== expectedRevision + 1 ||
      validated.previous?.revision !== current.revision ||
      validated.previous.snapshotId !== current.id
    ) {
      throw new EngineeringProjectStoreConflictError(
        "Engineering project commit does not extend the exact current revision.",
      );
    }
    validateEngineeringProjectExtension(current, validated);
    await this.writeExclusive(validated);
    return structuredClone(validated);
  }

  async contentFingerprint(
    projectId: string,
    revision: number,
  ): Promise<ContentFingerprint | undefined> {
    const snapshot = await this.getRevision(projectId, revision);
    return snapshot ? await sha256Fingerprint(snapshot) : undefined;
  }

  private async readRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const snapshot = validateEngineeringProjectSnapshot(
        JSON.parse(await this.io.readTextFile(this.revisionPath(projectId, revision))),
      );
      if (snapshot.project.id !== projectId || snapshot.revision !== revision) {
        throw new Error(
          `Engineering project revision path ${projectId}@${revision} contains ${snapshot.project.id}@${snapshot.revision}.`,
        );
      }
      return structuredClone(snapshot);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async writeExclusive(snapshot: EngineeringProjectSnapshot): Promise<void> {
    validateProjectId(snapshot.project.id);
    const projectDirectory = this.projectDirectory(snapshot.project.id);
    await this.io.mkdir(projectDirectory);
    const claimPath = this.claimPath(snapshot.project.id, snapshot.revision);
    try {
      await this.io.writeTextFileCreateNew(
        claimPath,
        `${snapshot.id}\n`,
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.waitUntilPublished(snapshot.project.id, snapshot.revision);
      throw new EngineeringProjectStoreConflictError(
        `Engineering project ${snapshot.project.id} revision ${snapshot.revision} is already claimed by another process.`,
      );
    }
    const revisionPath = this.revisionPath(snapshot.project.id, snapshot.revision);
    const pendingPath = `${revisionPath}.pending-${crypto.randomUUID()}`;
    await this.io.writeTextFileCreateNew(
      pendingPath,
      `${deterministicJson(snapshot)}\n`,
    );
    await this.io.rename(pendingPath, revisionPath);
  }

  private projectDirectory(projectId: string): string {
    return joinPath(this.directory, encodeURIComponent(projectId));
  }

  private revisionPath(projectId: string, revision: number): string {
    return joinPath(
      this.projectDirectory(projectId),
      `${String(revision).padStart(10, "0")}.json`,
    );
  }

  private claimPath(projectId: string, revision: number): string {
    return joinPath(
      this.projectDirectory(projectId),
      `${String(revision).padStart(10, "0")}.claim`,
    );
  }

  private async waitUntilPublished(
    projectId: string,
    revision: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await this.readRevision(projectId, revision)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
  }
}

function highestRevision(
  entries: readonly EngineeringProjectRevisionFileEntry[],
  extension: "json" | "claim",
): number | undefined {
  const revisions = entries.filter((entry) => entry.name.endsWith(`.${extension}`))
    .map((entry) => Number(entry.name.slice(0, 10)));
  return revisions.length > 0 ? Math.max(...revisions) : undefined;
}

function validateProjectId(projectId: string): void {
  if (!projectId.trim()) throw new TypeError("Engineering project id cannot be empty.");
  if (!/^[A-Za-z0-9]/.test(projectId)) {
    throw new TypeError(
      "Engineering project id must begin with an ASCII alphanumeric character.",
    );
  }
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("Engineering project id cannot use a latest alias.");
  }
}

function validateRevision(revision: number): void {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new TypeError("Engineering project revision must be a positive integer.");
  }
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error &&
      (error.name === "AlreadyExists" || /already exists/i.test(error.message)));
}
