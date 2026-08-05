/**
 * Write-ahead journal for the non-idempotent syson_element_insert_sysml call
 * that seeds the sensitivity-relations PartDef into the architecture package.
 *
 * A `dispatched` status means the provider may have accepted a mutation but no
 * normalised response was durably recorded. Like the oracle-requirements WAL,
 * this status is TERMINAL for automatic recovery: a retry could duplicate the
 * SysON element. The operator must verify via syson_element_children on the
 * architecturePackage before any separately reviewed recovery path.
 *
 * The file key encodes [projectId, runId, relationsDigest], so each unique
 * reviewed declaration gets its own attempt record.
 */

import { deterministicJson } from "../domain/deterministic-json.ts";
import type { ContentFingerprint as _ContentFingerprint } from "../domain/thread-snapshot.ts";

export const SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA =
  "sensitivity-relations-write-attempt/1.0" as const;

export interface SensitivityRelationsInsertResult {
  readonly elementId: string;
  readonly parentId: string;
  /** SHA-256 hex digest of the SysML text that was inserted. */
  readonly textSha256: string;
  readonly editingContextId: string;
}

type SensitivityRelationsAttempt =
  | {
    readonly schemaVersion: typeof SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly relationsDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly relationsDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly completedAt: string;
    readonly result: SensitivityRelationsInsertResult;
  };

export interface BeginSensitivityRelationsWrite {
  readonly projectId: string;
  readonly runId: string;
  readonly relationsDigest: string;
  readonly dispatchedAt: string;
}

export interface CompleteSensitivityRelationsWrite
  extends BeginSensitivityRelationsWrite {
  readonly completedAt: string;
  readonly result: SensitivityRelationsInsertResult;
}

/**
 * Raised when a sensitivity-relations insertion outcome is unknown. The
 * operator must verify via syson_element_children before any recovery attempt.
 */
export class SensitivityRelationsWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The sensitivity-relations element insertion outcome is unknown. It will not " +
        "be retried automatically because it may already have created provider state. " +
        "Verify via syson_element_children on the architecturePackage before any " +
        "recovery attempt.",
    );
    this.name = "SensitivityRelationsWriteOutcomeUnknownError";
  }
}

interface DurableAttemptFile {
  write(data: Uint8Array): Promise<number>;
  syncData(): Promise<void>;
  sync(): Promise<void>;
  close(): void;
}

interface AttemptFileSystem {
  mkdir(path: string): Promise<void>;
  open(path: string, options: Deno.OpenOptions): Promise<DurableAttemptFile>;
  readTextFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
}

const DENO_FILE_SYSTEM: AttemptFileSystem = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  open: (path, options) => Deno.open(path, options),
  readTextFile: (path) => Deno.readTextFile(path),
  rename: (from, to) => Deno.rename(from, to),
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class FileSensitivityRelationsAttemptStore {
  constructor(
    private readonly directory = "state/local/sensitivity-relations-attempts",
    private readonly fileSystem: AttemptFileSystem = DENO_FILE_SYSTEM,
  ) {}

  async begin(
    input: BeginSensitivityRelationsWrite,
  ): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "completed";
      readonly result: SensitivityRelationsInsertResult;
    }
  > {
    validateBegin(input);
    const path = this.pathFor(input.projectId, input.runId, input.relationsDigest);
    await this.fileSystem.mkdir(this.directory);
    const fresh: SensitivityRelationsAttempt = {
      schemaVersion: SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      relationsDigest: input.relationsDigest,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
    try {
      await this.writeNewDurably(path, `${deterministicJson(fresh)}\n`);
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    return await this.readExistingOrFailClosed(input);
  }

  async complete(input: CompleteSensitivityRelationsWrite): Promise<void> {
    validateComplete(input);
    const existing = await this.readExact(input);
    const completed: SensitivityRelationsAttempt = {
      schemaVersion: SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      relationsDigest: input.relationsDigest,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: input.completedAt,
      result: normalizeResult(input.result),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed sensitivity-relations attempt conflicts with its recorded result.",
        );
      }
      return;
    }
    await this.replaceDurably(
      this.pathFor(input.projectId, input.runId, input.relationsDigest),
      `${deterministicJson(completed)}\n`,
    );
  }

  async read(
    projectId: string,
    runId: string,
    relationsDigest: string,
  ): Promise<SensitivityRelationsAttempt | undefined> {
    validateIdentity(projectId, runId, relationsDigest);
    try {
      const text = await this.fileSystem.readTextFile(
        this.pathFor(projectId, runId, relationsDigest),
      );
      return parseAttempt(text, { projectId, runId, relationsDigest });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  pathFor(projectId: string, runId: string, relationsDigest: string): string {
    validateIdentity(projectId, runId, relationsDigest);
    const key = encodeURIComponent(
      JSON.stringify([projectId, runId, relationsDigest]),
    );
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async readExact(
    input: Pick<
      BeginSensitivityRelationsWrite,
      "projectId" | "runId" | "relationsDigest"
    >,
  ): Promise<SensitivityRelationsAttempt> {
    const attempt = await this.read(
      input.projectId,
      input.runId,
      input.relationsDigest,
    );
    if (!attempt) {
      throw new Error("Sensitivity-relations attempt was not durably recorded.");
    }
    return attempt;
  }

  private async readExistingOrFailClosed(
    input: Pick<
      BeginSensitivityRelationsWrite,
      "projectId" | "runId" | "relationsDigest"
    >,
  ): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "completed";
      readonly result: SensitivityRelationsInsertResult;
    }
  > {
    let existing: SensitivityRelationsAttempt;
    try {
      existing = await this.readExact(input);
    } catch {
      throw new SensitivityRelationsWriteOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      return { action: "completed", result: structuredClone(existing.result) };
    }
    throw new SensitivityRelationsWriteOutcomeUnknownError();
  }

  private async writeNewDurably(path: string, text: string): Promise<void> {
    await this.writeDurably(path, text, { createNew: true, write: true });
    await this.syncDirectoryChain();
  }

  private async replaceDurably(path: string, text: string): Promise<void> {
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
    await this.writeDurably(temporaryPath, text, { createNew: true, write: true });
    await this.fileSystem.rename(temporaryPath, path);
    await this.syncDirectoryChain();
  }

  private async writeDurably(
    path: string,
    text: string,
    options: Deno.OpenOptions,
  ): Promise<void> {
    const file = await this.fileSystem.open(path, options);
    try {
      const bytes = new TextEncoder().encode(text);
      let written = 0;
      while (written < bytes.length) {
        const count = await file.write(bytes.subarray(written));
        if (count <= 0) {
          throw new Error(
            "Sensitivity-relations write-attempt journal made no write progress.",
          );
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
  }

  private async syncDirectoryChain(): Promise<void> {
    for (const directoryPath of directoryChain(this.directory)) {
      const directory = await this.fileSystem.open(directoryPath, { read: true });
      try {
        await directory.sync();
      } finally {
        directory.close();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function directoryChain(path: string): string[] {
  const result: string[] = [];
  let current = path.replace(/\/+$/, "") || ".";
  while (current !== "/" && !result.includes(current)) {
    result.push(current);
    if (isStateDirectory(current)) break;
    const parent = parentDirectory(current);
    if (parent === current || parent === "/") break;
    current = parent;
  }
  return result;
}

function isStateDirectory(path: string): boolean {
  return path === "state" || path.endsWith("/state");
}

function parentDirectory(path: string): string {
  if (path === "." || path === "/") return path;
  const slash = path.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return path.slice(0, slash);
}

function validateBegin(input: BeginSensitivityRelationsWrite): void {
  validateIdentity(input.projectId, input.runId, input.relationsDigest);
  isoDateTime(input.dispatchedAt, "dispatchedAt");
}

function validateComplete(input: CompleteSensitivityRelationsWrite): void {
  validateBegin(input);
  isoDateTime(input.completedAt, "completedAt");
  normalizeResult(input.result);
}

function validateIdentity(
  projectId: string,
  runId: string,
  relationsDigest: string,
): void {
  nonEmpty(projectId, "projectId");
  nonEmpty(runId, "runId");
  if (!SHA256_HEX.test(relationsDigest)) {
    throw new TypeError(
      "relationsDigest must be a 64-character lowercase hexadecimal SHA-256 digest.",
    );
  }
}

function normalizeResult(
  result: SensitivityRelationsInsertResult,
): SensitivityRelationsInsertResult {
  nonEmpty(result.elementId, "result.elementId");
  nonEmpty(result.parentId, "result.parentId");
  if (!SHA256_HEX.test(result.textSha256)) {
    throw new TypeError(
      "result.textSha256 must be a 64-character lowercase hexadecimal SHA-256 digest.",
    );
  }
  nonEmpty(result.editingContextId, "result.editingContextId");
  return {
    elementId: result.elementId.trim(),
    parentId: result.parentId.trim(),
    textSha256: result.textSha256,
    editingContextId: result.editingContextId.trim(),
  };
}

function parseAttempt(
  text: string,
  expected: Pick<
    BeginSensitivityRelationsWrite,
    "projectId" | "runId" | "relationsDigest"
  >,
): SensitivityRelationsAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Sensitivity-relations attempt is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sensitivity-relations attempt must be an object.");
  }
  const rec = value as Record<string, unknown>;
  if (
    rec.schemaVersion !== SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA ||
    rec.projectId !== expected.projectId ||
    rec.runId !== expected.runId ||
    rec.relationsDigest !== expected.relationsDigest ||
    (rec.status !== "dispatched" && rec.status !== "completed") ||
    typeof rec.dispatchedAt !== "string"
  ) {
    throw new Error(
      "Sensitivity-relations attempt has an invalid identity or state.",
    );
  }
  isoDateTime(rec.dispatchedAt as string, "dispatchedAt");
  if (rec.status === "dispatched") {
    return {
      schemaVersion: SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      relationsDigest: expected.relationsDigest,
      status: "dispatched",
      dispatchedAt: rec.dispatchedAt as string,
    };
  }
  if (
    typeof rec.completedAt !== "string" || !isResultRecord(rec.result)
  ) {
    throw new Error("Completed sensitivity-relations attempt is incomplete.");
  }
  isoDateTime(rec.completedAt, "completedAt");
  return {
    schemaVersion: SENSITIVITY_RELATIONS_ATTEMPT_SCHEMA,
    projectId: expected.projectId,
    runId: expected.runId,
    relationsDigest: expected.relationsDigest,
    status: "completed",
    dispatchedAt: rec.dispatchedAt as string,
    completedAt: rec.completedAt,
    result: normalizeResult(rec.result),
  };
}

function isResultRecord(value: unknown): value is SensitivityRelationsInsertResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.elementId === "string" &&
    typeof r.parentId === "string" &&
    typeof r.textSha256 === "string" &&
    typeof r.editingContextId === "string"
  );
}

function nonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function isoDateTime(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
}
