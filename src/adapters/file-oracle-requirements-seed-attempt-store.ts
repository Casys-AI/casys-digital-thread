import { deterministicJson } from "../domain/deterministic-json.ts";

export const ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA =
  "oracle-requirements-seed-write-attempt/1.0" as const;

/**
 * Narrow, normalized identity fields from a successful syson_element_insert_sysml
 * call for the oracle requirements element.
 *
 * All four fields are mandatory: a result without an elementId cannot be used to
 * verify the insertion, and an editingContextId is required to re-extract via
 * syson_constraint_extract.
 */
export interface OracleRequirementsSeedResult {
  readonly elementId: string;
  readonly parentId: string;
  /** SHA-256 hex digest of the SysML text that was inserted. */
  readonly textSha256: string;
  readonly editingContextId: string;
}

export interface OracleRequirementsSeedWriteAttempt {
  readonly schemaVersion: typeof ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  /**
   * SHA-256 hex digest of fingerprintOracleRequirements — ties this attempt to
   * the exact reviewed threshold set, not only to the run. A threshold change
   * produces a new key and therefore a new attempt record.
   */
  readonly requirementsDigest: string;
  /**
   * `dispatched` means the provider may have accepted a mutation but no
   * normalized response was durably recorded. It is intentionally terminal for
   * automatic recovery: a retry could duplicate the SysON requirements element.
   */
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly completedAt?: string;
  /** Narrow, normalized identity fields only; never raw provider output. */
  readonly result?: OracleRequirementsSeedResult;
}

export interface BeginOracleRequirementsSeedWrite {
  readonly projectId: string;
  readonly runId: string;
  readonly requirementsDigest: string;
  readonly dispatchedAt: string;
}

export interface CompleteOracleRequirementsSeedWrite
  extends BeginOracleRequirementsSeedWrite {
  readonly completedAt: string;
  readonly result: OracleRequirementsSeedResult;
}

/**
 * Raised instead of replaying a potentially durable SysON mutation. The
 * operator must verify via syson_element_children on the architecturePackage
 * whether the element was already created before any separately reviewed
 * recovery path. This store deliberately offers no automatic clear/retry method,
 * and the current Workbench exposes no in-cockpit recovery action.
 */
export class OracleRequirementsSeedWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The oracle requirements element insertion outcome is unknown. It will not " +
        "be retried automatically because it may already have created provider state. " +
        "Verify via syson_element_children on the architecturePackage before any " +
        "recovery attempt.",
    );
    this.name = "OracleRequirementsSeedWriteOutcomeUnknownError";
  }
}

interface DurableAttemptFile {
  write(data: Uint8Array): Promise<number>;
  syncData(): Promise<void>;
  sync(): Promise<void>;
  close(): void;
}

interface OracleRequirementsSeedAttemptFileSystem {
  mkdir(path: string): Promise<void>;
  open(path: string, options: Deno.OpenOptions): Promise<DurableAttemptFile>;
  readTextFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
}

const DENO_FILE_SYSTEM: OracleRequirementsSeedAttemptFileSystem = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  open: (path, options) => Deno.open(path, options),
  readTextFile: (path) => Deno.readTextFile(path),
  rename: (from, to) => Deno.rename(from, to),
};

/**
 * Durable write-ahead journal for the non-idempotent syson_element_insert_sysml
 * call that seeds the oracle requirements element into the architecture package.
 *
 * The file key encodes [projectId, runId, requirementsDigest], so each unique
 * reviewed threshold set gets its own attempt record. A process interruption is
 * safe: the journal writes `dispatched` before the remote call and refuses
 * automatic replay until the exact normalized result is recorded. An unknown
 * result requires external provider inspection via syson_element_children; this
 * store offers no in-process recovery. This journal is recovery control state,
 * not thread evidence.
 */
export class FileOracleRequirementsSeedAttemptStore {
  constructor(
    private readonly directory = "state/local/oracle-requirements-seed-attempts",
    private readonly fileSystem: OracleRequirementsSeedAttemptFileSystem =
      DENO_FILE_SYSTEM,
  ) {}

  async begin(
    input: BeginOracleRequirementsSeedWrite,
  ): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "completed";
      readonly result: OracleRequirementsSeedResult;
    }
  > {
    validateBegin(input);
    const path = this.pathFor(
      input.projectId,
      input.runId,
      input.requirementsDigest,
    );
    await this.fileSystem.mkdir(this.directory);
    const fresh: OracleRequirementsSeedWriteAttempt = {
      schemaVersion: ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      requirementsDigest: input.requirementsDigest,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
    try {
      await this.writeNewDurably(path, `${deterministicJson(fresh)}\n`);
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }

    const existing = await this.readExistingOutcomeOrFailClosed(input);
    if (existing.status === "completed") {
      if (!existing.result) {
        throw new Error(
          "Completed oracle requirements seed attempt has no result.",
        );
      }
      return {
        action: "completed",
        result: structuredClone(existing.result),
      };
    }
    throw new OracleRequirementsSeedWriteOutcomeUnknownError();
  }

  async complete(input: CompleteOracleRequirementsSeedWrite): Promise<void> {
    validateComplete(input);
    const existing = await this.readExact(input);
    const completed: OracleRequirementsSeedWriteAttempt = {
      schemaVersion: ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      requirementsDigest: input.requirementsDigest,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: input.completedAt,
      result: normalizedResult(input.result),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed oracle requirements seed attempt conflicts with its recorded result.",
        );
      }
      return;
    }
    await this.replaceDurably(
      this.pathFor(
        input.projectId,
        input.runId,
        input.requirementsDigest,
      ),
      `${deterministicJson(completed)}\n`,
    );
  }

  async read(
    projectId: string,
    runId: string,
    requirementsDigest: string,
  ): Promise<OracleRequirementsSeedWriteAttempt | undefined> {
    validateIdentity(projectId, runId, requirementsDigest);
    try {
      return await parseAttempt(
        await this.fileSystem.readTextFile(
          this.pathFor(projectId, runId, requirementsDigest),
        ),
        { projectId, runId, requirementsDigest },
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  pathFor(
    projectId: string,
    runId: string,
    requirementsDigest: string,
  ): string {
    validateIdentity(projectId, runId, requirementsDigest);
    const key = encodeURIComponent(
      JSON.stringify([projectId, runId, requirementsDigest]),
    );
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async readExact(
    input: Pick<
      BeginOracleRequirementsSeedWrite,
      "projectId" | "runId" | "requirementsDigest"
    >,
  ): Promise<OracleRequirementsSeedWriteAttempt> {
    const attempt = await this.read(
      input.projectId,
      input.runId,
      input.requirementsDigest,
    );
    if (!attempt) {
      throw new Error(
        "Oracle requirements seed attempt was not durably recorded.",
      );
    }
    return attempt;
  }

  private async readExistingOutcomeOrFailClosed(
    input: Pick<
      BeginOracleRequirementsSeedWrite,
      "projectId" | "runId" | "requirementsDigest"
    >,
  ): Promise<OracleRequirementsSeedWriteAttempt> {
    try {
      return await this.readExact(input);
    } catch {
      // An existing but unreadable marker may be the only evidence that a
      // provider write was dispatched. Never turn that ambiguity into a new
      // automatic attempt.
      throw new OracleRequirementsSeedWriteOutcomeUnknownError();
    }
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
            "Oracle requirements seed write-attempt journal made no write progress.",
          );
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
  }

  /**
   * The attempt directory can be created recursively immediately before the
   * first dispatched marker. Sync every directory entry through `state`, so a
   * power loss cannot erase a newly created ancestor and make a provider write
   * look safe to replay.
   */
  private async syncDirectoryChain(): Promise<void> {
    for (const directoryPath of directoryChain(this.directory)) {
      const directory = await this.fileSystem.open(directoryPath, {
        read: true,
      });
      try {
        await directory.sync();
      } finally {
        directory.close();
      }
    }
  }
}

function directoryChain(path: string): string[] {
  const result: string[] = [];
  let current = path.replace(/\/+$/, "") || ".";
  while (current !== "/" && !result.includes(current)) {
    result.push(current);
    // `state` is the repository-owned durable storage root. Syncing its parent
    // would broaden the process read scope beyond the journal's storage tree.
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

function validateBegin(input: BeginOracleRequirementsSeedWrite): void {
  validateIdentity(input.projectId, input.runId, input.requirementsDigest);
  isoDateTime(input.dispatchedAt, "dispatchedAt");
}

function validateComplete(input: CompleteOracleRequirementsSeedWrite): void {
  validateBegin(input);
  isoDateTime(input.completedAt, "completedAt");
  normalizedResult(input.result);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function validateIdentity(
  projectId: string,
  runId: string,
  requirementsDigest: string,
): void {
  nonEmpty(projectId, "projectId");
  nonEmpty(runId, "runId");
  if (!SHA256_HEX.test(requirementsDigest)) {
    throw new TypeError(
      "requirementsDigest must be a 64-character lowercase hexadecimal SHA-256 digest.",
    );
  }
}

function normalizedResult(
  result: OracleRequirementsSeedResult,
): OracleRequirementsSeedResult {
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
    BeginOracleRequirementsSeedWrite,
    "projectId" | "runId" | "requirementsDigest"
  >,
): OracleRequirementsSeedWriteAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Oracle requirements seed attempt is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Oracle requirements seed attempt must be an object.");
  }
  const rec = value as Record<string, unknown>;
  if (
    rec.schemaVersion !== ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA ||
    rec.projectId !== expected.projectId ||
    rec.runId !== expected.runId ||
    rec.requirementsDigest !== expected.requirementsDigest ||
    (rec.status !== "dispatched" && rec.status !== "completed") ||
    typeof rec.dispatchedAt !== "string"
  ) {
    throw new Error(
      "Oracle requirements seed attempt has an invalid identity or state.",
    );
  }
  isoDateTime(rec.dispatchedAt, "dispatchedAt");
  if (rec.status === "dispatched") {
    if (rec.completedAt !== undefined || rec.result !== undefined) {
      throw new Error(
        "Dispatched oracle requirements seed attempt carries a result.",
      );
    }
    return {
      schemaVersion: ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      requirementsDigest: expected.requirementsDigest,
      status: "dispatched",
      dispatchedAt: rec.dispatchedAt,
    };
  }
  if (typeof rec.completedAt !== "string" || !isSeedResultRecord(rec.result)) {
    throw new Error("Completed oracle requirements seed attempt is incomplete.");
  }
  isoDateTime(rec.completedAt, "completedAt");
  return {
    schemaVersion: ORACLE_REQUIREMENTS_SEED_WRITE_ATTEMPT_SCHEMA,
    projectId: expected.projectId,
    runId: expected.runId,
    requirementsDigest: expected.requirementsDigest,
    status: "completed",
    dispatchedAt: rec.dispatchedAt,
    completedAt: rec.completedAt,
    result: normalizedResult(rec.result),
  };
}

function isSeedResultRecord(
  value: unknown,
): value is OracleRequirementsSeedResult {
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
