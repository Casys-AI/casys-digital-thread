import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";

export interface InspectionDroneV4ArchitectureAttempt {
  readonly schemaVersion: "inspection-drone-v4-architecture-write-attempt/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly result?: {
    readonly parentId: string;
    readonly textSha256: string;
  };
}

/** A dispatched insert is deliberately non-retryable without human review. */
export class InspectionDroneV4ArchitectureWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The inspection-drone architecture insertion outcome is unknown and will not be retried automatically.",
    );
    this.name = "InspectionDroneV4ArchitectureWriteOutcomeUnknownError";
  }
}

/** Durable per-run WAL for the one non-idempotent SysON insertion. */
export class FileInspectionDroneV4ArchitectureAttemptStore {
  constructor(
    private readonly directory =
      "state/local/inspection-drone-v4-architecture-attempts",
  ) {}

  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "completed";
      readonly result: NonNullable<InspectionDroneV4ArchitectureAttempt["result"]>;
    }
  > {
    const fresh: InspectionDroneV4ArchitectureAttempt = {
      schemaVersion: "inspection-drone-v4-architecture-write-attempt/1.0",
      projectId: required(input.projectId, "projectId"),
      runId: required(input.runId, "runId"),
      status: "dispatched",
      dispatchedAt: timestamp(input.dispatchedAt),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNew(
        this.pathFor(fresh.projectId, fresh.runId),
        `${deterministicJson(fresh)}\n`,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.required(fresh.projectId, fresh.runId);
    if (existing.status !== "completed" || !existing.result) {
      throw new InspectionDroneV4ArchitectureWriteOutcomeUnknownError();
    }
    return { action: "completed", result: structuredClone(existing.result) };
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly result: NonNullable<InspectionDroneV4ArchitectureAttempt["result"]>;
  }): Promise<void> {
    const existing = await this.required(input.projectId, input.runId);
    const result = normalizedResult(input.result);
    const completed: InspectionDroneV4ArchitectureAttempt = {
      ...existing,
      status: "completed",
      result,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Inspection-drone architecture acknowledgement conflicts with the durable attempt.",
        );
      }
      return;
    }
    const path = this.pathFor(existing.projectId, existing.runId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeNew(temporary, `${deterministicJson(completed)}\n`);
    await Deno.rename(temporary, path);
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<InspectionDroneV4ArchitectureAttempt | undefined> {
    try {
      return parse(
        await Deno.readTextFile(this.pathFor(projectId, runId)),
        projectId,
        runId,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async required(
    projectId: string,
    runId: string,
  ): Promise<InspectionDroneV4ArchitectureAttempt> {
    try {
      const value = await this.read(projectId, runId);
      if (!value) throw new Error("missing attempt");
      return value;
    } catch {
      throw new InspectionDroneV4ArchitectureWriteOutcomeUnknownError();
    }
  }

  private pathFor(projectId: string, runId: string): string {
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(
        JSON.stringify([required(projectId, "projectId"), required(runId, "runId")]),
      )
    }.json`;
  }
}

async function writeNew(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await file.write(new TextEncoder().encode(text));
    await file.syncData();
  } finally {
    file.close();
  }
}

function parse(
  text: string,
  projectId: string,
  runId: string,
): InspectionDroneV4ArchitectureAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Inspection-drone architecture attempt is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Inspection-drone architecture attempt is invalid.");
  }
  const record = value as Record<string, unknown>;
  const completed = record.status === "completed";
  const expected = completed
    ? ["dispatchedAt", "projectId", "result", "runId", "schemaVersion", "status"]
    : ["dispatchedAt", "projectId", "runId", "schemaVersion", "status"];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    record.schemaVersion !== "inspection-drone-v4-architecture-write-attempt/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string" ||
    Number.isNaN(Date.parse(record.dispatchedAt))
  ) {
    throw new Error(
      "Inspection-drone architecture attempt does not match its identity.",
    );
  }
  return {
    schemaVersion: "inspection-drone-v4-architecture-write-attempt/1.0",
    projectId,
    runId,
    status: record.status,
    dispatchedAt: record.dispatchedAt,
    ...(completed ? { result: normalizedResult(record.result) } : {}),
  };
}

function normalizedResult(
  value: unknown,
): NonNullable<InspectionDroneV4ArchitectureAttempt["result"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Inspection-drone architecture attempt result is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 || keys[0] !== "parentId" || keys[1] !== "textSha256" ||
    typeof record.parentId !== "string" || !record.parentId ||
    typeof record.textSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.textSha256)
  ) {
    throw new Error("Inspection-drone architecture acknowledgement is invalid.");
  }
  return { parentId: record.parentId, textSha256: record.textSha256 };
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty.`);
  return value;
}

function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError("dispatchedAt must be an ISO timestamp.");
  }
  return value;
}
