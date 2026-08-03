import { deterministicJson } from "../domain/deterministic-json.ts";

/** Durable state format for r3's sole non-idempotent SysON mutation. */
export const INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA =
  "inspection-drone-architecture-write-attempt/1.0" as const;

/** The r3 architecture slice has exactly one provider write. */
export type InspectionDroneArchitectureWriteStep = "architecture-insert";

export interface InspectionDroneArchitectureWriteAttempt {
  readonly schemaVersion: typeof INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly step: InspectionDroneArchitectureWriteStep;
  /**
   * `dispatched` means SysON may have accepted the insertion but no normalized
   * response was durably recorded. It is terminal for automatic recovery: a
   * replay could insert a second architecture package.
   */
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly completedAt?: string;
  /** Narrow normalized acknowledgement fields only; never raw provider output. */
  readonly result?: Readonly<Record<string, string>>;
}

export interface BeginInspectionDroneArchitectureWrite {
  readonly projectId: string;
  readonly runId: string;
  readonly step: InspectionDroneArchitectureWriteStep;
  readonly dispatchedAt: string;
}

export interface CompleteInspectionDroneArchitectureWrite
  extends BeginInspectionDroneArchitectureWrite {
  readonly completedAt: string;
  readonly result: Readonly<Record<string, string>>;
}

/**
 * Raised instead of replaying an insertion that could already have changed
 * SysON. An operator must inspect the provider before any separately reviewed
 * recovery path; this store deliberately offers no automatic clear or retry.
 */
export class InspectionDroneArchitectureWriteOutcomeUnknownError extends Error {
  constructor(step: InspectionDroneArchitectureWriteStep) {
    super(
      `The inspection-drone architecture ${step} outcome is unknown. It will not be retried automatically because it may already have created provider state.`,
    );
    this.name = "InspectionDroneArchitectureWriteOutcomeUnknownError";
  }
}

interface DurableAttemptFile {
  write(data: Uint8Array): Promise<number>;
  syncData(): Promise<void>;
  sync(): Promise<void>;
  close(): void;
}

interface InspectionDroneArchitectureAttemptFileSystem {
  mkdir(path: string): Promise<void>;
  open(
    path: string,
    options: Deno.OpenOptions,
  ): Promise<DurableAttemptFile>;
  readTextFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
}

const DENO_FILE_SYSTEM: InspectionDroneArchitectureAttemptFileSystem = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  open: (path, options) => Deno.open(path, options),
  readTextFile: (path) => Deno.readTextFile(path),
  rename: (from, to) => Deno.rename(from, to),
};

/**
 * Durable write-ahead journal for r3's one non-idempotent architecture insert.
 *
 * The project-run lease serializes normal writers. This journal also survives a
 * process interruption: it records `dispatched` before the remote call and
 * refuses future automatic replay until the exact normalized acknowledgement
 * has been recorded. It is recovery-control state, not thread evidence.
 */
export class FileInspectionDroneArchitectureAttemptStore {
  constructor(
    private readonly directory = "state/local/inspection-drone-architecture-attempts",
    private readonly fileSystem: InspectionDroneArchitectureAttemptFileSystem =
      DENO_FILE_SYSTEM,
  ) {}

  async begin(
    input: BeginInspectionDroneArchitectureWrite,
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
    const fresh: InspectionDroneArchitectureWriteAttempt = {
      schemaVersion: INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA,
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
        throw new Error(
          `Completed inspection-drone architecture ${input.step} attempt has no result.`,
        );
      }
      return { action: "completed", result: structuredClone(existing.result) };
    }
    throw new InspectionDroneArchitectureWriteOutcomeUnknownError(input.step);
  }

  async complete(
    input: CompleteInspectionDroneArchitectureWrite,
  ): Promise<void> {
    validateComplete(input);
    const existing = await this.readExact(input);
    const completed: InspectionDroneArchitectureWriteAttempt = {
      schemaVersion: INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA,
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
          `Completed inspection-drone architecture ${input.step} attempt conflicts with its recorded result.`,
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
    step: InspectionDroneArchitectureWriteStep,
  ): Promise<InspectionDroneArchitectureWriteAttempt | undefined> {
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
    step: InspectionDroneArchitectureWriteStep,
  ): string {
    validateIdentity(projectId, runId, step);
    const key = encodeURIComponent(JSON.stringify([projectId, runId, step]));
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async readExact(
    input: Pick<
      BeginInspectionDroneArchitectureWrite,
      "projectId" | "runId" | "step"
    >,
  ): Promise<InspectionDroneArchitectureWriteAttempt> {
    const attempt = await this.read(input.projectId, input.runId, input.step);
    if (!attempt) {
      throw new Error(
        `Inspection-drone architecture ${input.step} attempt was not durably recorded.`,
      );
    }
    return attempt;
  }

  private async readExistingOutcomeOrFailClosed(
    input: Pick<
      BeginInspectionDroneArchitectureWrite,
      "projectId" | "runId" | "step"
    >,
  ): Promise<InspectionDroneArchitectureWriteAttempt> {
    try {
      return await this.readExact(input);
    } catch {
      // An existing unreadable marker may be the only evidence an insertion
      // was dispatched. Never turn that ambiguity into another insertion.
      throw new InspectionDroneArchitectureWriteOutcomeUnknownError(input.step);
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
            "Inspection-drone architecture write-attempt journal made no write progress.",
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
   * A new attempt directory is itself a filesystem mutation. Syncing only the
   * child directory would not necessarily make its entry durable in a newly
   * created parent after power loss, which could erase the sole `dispatched`
   * marker and make a second insert look safe. Sync the directory and every
   * ancestor through the repository-owned `state` storage root.
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
    // `state` is the repository-owned durable storage root. It exists before
    // any run (and is within the server's narrow read permission), so syncing
    // its parent would only broaden the process read scope to the workspace.
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

function validateBegin(input: BeginInspectionDroneArchitectureWrite): void {
  validateIdentity(input.projectId, input.runId, input.step);
  isoDateTime(input.dispatchedAt, "dispatchedAt");
}

function validateComplete(
  input: CompleteInspectionDroneArchitectureWrite,
): void {
  validateBegin(input);
  isoDateTime(input.completedAt, "completedAt");
  normalizedResult(input.result);
}

function validateIdentity(
  projectId: string,
  runId: string,
  step: InspectionDroneArchitectureWriteStep,
): void {
  nonEmpty(projectId, "projectId");
  nonEmpty(runId, "runId");
  if (step !== "architecture-insert") {
    throw new TypeError("step must be architecture-insert");
  }
}

function normalizedResult(
  result: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(result);
  if (entries.length === 0) {
    throw new TypeError(
      "A normalized inspection-drone architecture result must contain at least one field.",
    );
  }
  for (const [key, value] of entries) {
    nonEmpty(key, "result key");
    nonEmpty(value, `result.${key}`);
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]));
}

function parseAttempt(
  text: string,
  expected: Pick<
    BeginInspectionDroneArchitectureWrite,
    "projectId" | "runId" | "step"
  >,
): InspectionDroneArchitectureWriteAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      `Inspection-drone architecture ${expected.step} attempt is not valid JSON.`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Inspection-drone architecture ${expected.step} attempt must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA ||
    record.projectId !== expected.projectId || record.runId !== expected.runId ||
    record.step !== expected.step ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string"
  ) {
    throw new Error(
      `Inspection-drone architecture ${expected.step} attempt has an invalid identity or state.`,
    );
  }
  isoDateTime(record.dispatchedAt, "dispatchedAt");
  if (record.status === "dispatched") {
    if (record.completedAt !== undefined || record.result !== undefined) {
      throw new Error(
        `Dispatched inspection-drone architecture ${expected.step} attempt carries a result.`,
      );
    }
    return {
      schemaVersion: INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      step: expected.step,
      status: "dispatched",
      dispatchedAt: record.dispatchedAt,
    };
  }
  if (typeof record.completedAt !== "string" || !isStringRecord(record.result)) {
    throw new Error(
      `Completed inspection-drone architecture ${expected.step} attempt is incomplete.`,
    );
  }
  isoDateTime(record.completedAt, "completedAt");
  return {
    schemaVersion: INSPECTION_DRONE_ARCHITECTURE_WRITE_ATTEMPT_SCHEMA,
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
