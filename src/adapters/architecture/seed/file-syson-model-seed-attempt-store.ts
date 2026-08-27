import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  AttemptFileSystem,
  DENO_FILE_SYSTEM,
} from "../../shared/wal/file-attempt-store.ts";

export const SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA =
  "syson-model-seed-write-attempt/1.0" as const;

/** The two provider mutations in the deliberately minimal SysON seed. */
export type SysonModelSeedWriteStep = "project-create" | "model-create";

export interface SysonModelSeedWriteAttempt {
  readonly schemaVersion: typeof SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly step: SysonModelSeedWriteStep;
  /**
   * `dispatched` means the provider may have accepted a mutation but no
   * normalized response was durably recorded. It is intentionally terminal
   * for automatic recovery: a retry could duplicate a SysON project/model.
   */
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly completedAt?: string;
  /** Narrow, normalized identity fields only; never raw provider output. */
  readonly result?: Readonly<Record<string, string>>;
}

export interface BeginSysonModelSeedWrite {
  readonly projectId: string;
  readonly runId: string;
  readonly step: SysonModelSeedWriteStep;
  readonly dispatchedAt: string;
}

export interface CompleteSysonModelSeedWrite extends BeginSysonModelSeedWrite {
  readonly completedAt: string;
  readonly result: Readonly<Record<string, string>>;
}

/**
 * Raised instead of replaying a potentially durable SysON mutation. The
 * operator must inspect the provider before any future, separately reviewed
 * recovery path. This store deliberately offers no automatic clear/retry
 * method. Recovery is a project-level human reconciliation; the Workbench
 * remains read-only.
 */
export class SysonModelSeedWriteOutcomeUnknownError extends Error {
  readonly step: SysonModelSeedWriteStep;

  constructor(step: SysonModelSeedWriteStep) {
    super(
      `The SysON ${step} outcome is unknown. It will not be retried automatically because it may already have created provider state.`,
    );
    this.name = "SysonModelSeedWriteOutcomeUnknownError";
    this.step = step;
  }
}

/**
 * Durable write-ahead journal for non-idempotent SysON mutations.
 *
 * The project-run lease serializes normal writers. This store additionally
 * makes a process interruption safe: it writes `dispatched` before the remote
 * call and refuses a future automatic replay until the exact normalized result
 * was recorded. An unknown result requires external provider inspection; the
 * paired agent may append the human reconciliation flow afterwards. This
 * journal is recovery control state, not thread evidence.
 */
export class FileSysonModelSeedAttemptStore {
  constructor(
    private readonly directory = "state/local/syson-model-seed-attempts",
    private readonly fileSystem: AttemptFileSystem = DENO_FILE_SYSTEM,
  ) {}

  async begin(
    input: BeginSysonModelSeedWrite,
  ): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "completed";
      readonly result: Readonly<Record<string, string>>;
    }
  > {
    validateBegin(input);
    const path = this.pathFor(input.projectId, input.runId, input.step);
    await this.fileSystem.mkdir(this.directory);
    const fresh: SysonModelSeedWriteAttempt = {
      schemaVersion: SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      step: input.step,
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
        throw new Error(`Completed SysON ${input.step} attempt has no result.`);
      }
      return { action: "completed", result: structuredClone(existing.result) };
    }
    throw new SysonModelSeedWriteOutcomeUnknownError(input.step);
  }

  async complete(input: CompleteSysonModelSeedWrite): Promise<void> {
    validateComplete(input);
    const existing = await this.readExact(input);
    const completed: SysonModelSeedWriteAttempt = {
      schemaVersion: SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      step: input.step,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: input.completedAt,
      result: normalizedResult(input.result),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          `Completed SysON ${input.step} attempt conflicts with its recorded result.`,
        );
      }
      return;
    }
    await this.replaceDurably(
      this.pathFor(input.projectId, input.runId, input.step),
      `${deterministicJson(completed)}\n`,
    );
  }

  async read(
    projectId: string,
    runId: string,
    step: SysonModelSeedWriteStep,
  ): Promise<SysonModelSeedWriteAttempt | undefined> {
    validateIdentity(projectId, runId, step);
    try {
      return await parseAttempt(
        await this.fileSystem.readTextFile(this.pathFor(projectId, runId, step)),
        { projectId, runId, step },
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  pathFor(
    projectId: string,
    runId: string,
    step: SysonModelSeedWriteStep,
  ): string {
    validateIdentity(projectId, runId, step);
    const key = encodeURIComponent(JSON.stringify([projectId, runId, step]));
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async readExact(
    input: Pick<BeginSysonModelSeedWrite, "projectId" | "runId" | "step">,
  ): Promise<SysonModelSeedWriteAttempt> {
    const attempt = await this.read(input.projectId, input.runId, input.step);
    if (!attempt) {
      throw new Error(`SysON ${input.step} attempt was not durably recorded.`);
    }
    return attempt;
  }

  private async readExistingOutcomeOrFailClosed(
    input: Pick<BeginSysonModelSeedWrite, "projectId" | "runId" | "step">,
  ): Promise<SysonModelSeedWriteAttempt> {
    try {
      return await this.readExact(input);
    } catch {
      // An existing but unreadable marker may be the only evidence that a
      // provider write was dispatched. Never turn that ambiguity into a new
      // automatic attempt.
      throw new SysonModelSeedWriteOutcomeUnknownError(input.step);
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
          throw new Error("SysON write-attempt journal made no write progress.");
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
      const directory = await this.fileSystem.open(directoryPath, { read: true });
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

function validateBegin(input: BeginSysonModelSeedWrite): void {
  validateIdentity(input.projectId, input.runId, input.step);
  isoDateTime(input.dispatchedAt, "dispatchedAt");
}

function validateComplete(input: CompleteSysonModelSeedWrite): void {
  validateBegin(input);
  isoDateTime(input.completedAt, "completedAt");
  normalizedResult(input.result);
}

function validateIdentity(
  projectId: string,
  runId: string,
  step: SysonModelSeedWriteStep,
): void {
  nonEmpty(projectId, "projectId");
  nonEmpty(runId, "runId");
  if (step !== "project-create" && step !== "model-create") {
    throw new TypeError("step must be project-create or model-create");
  }
}

function normalizedResult(
  result: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(result);
  if (entries.length === 0) {
    throw new TypeError("A normalized SysON result must contain at least one field.");
  }
  for (const [key, value] of entries) {
    nonEmpty(key, "result key");
    nonEmpty(value, `result.${key}`);
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]));
}

function parseAttempt(
  text: string,
  expected: Pick<BeginSysonModelSeedWrite, "projectId" | "runId" | "step">,
): SysonModelSeedWriteAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`SysON ${expected.step} attempt is not valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SysON ${expected.step} attempt must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA ||
    record.projectId !== expected.projectId || record.runId !== expected.runId ||
    record.step !== expected.step ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string"
  ) {
    throw new Error(`SysON ${expected.step} attempt has an invalid identity or state.`);
  }
  isoDateTime(record.dispatchedAt, "dispatchedAt");
  if (record.status === "dispatched") {
    if (record.completedAt !== undefined || record.result !== undefined) {
      throw new Error(`Dispatched SysON ${expected.step} attempt carries a result.`);
    }
    return {
      schemaVersion: SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      step: expected.step,
      status: "dispatched",
      dispatchedAt: record.dispatchedAt,
    };
  }
  if (typeof record.completedAt !== "string" || !isStringRecord(record.result)) {
    throw new Error(`Completed SysON ${expected.step} attempt is incomplete.`);
  }
  isoDateTime(record.completedAt, "completedAt");
  return {
    schemaVersion: SYSON_MODEL_SEED_WRITE_ATTEMPT_SCHEMA,
    projectId: expected.projectId,
    runId: expected.runId,
    step: expected.step,
    status: "completed",
    dispatchedAt: record.dispatchedAt,
    completedAt: record.completedAt,
    result: normalizedResult(record.result),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) =>
      typeof entry === "string"
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
