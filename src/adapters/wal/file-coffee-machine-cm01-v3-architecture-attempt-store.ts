import { deterministicJson } from "../../domain/deterministic-json.ts";

export type CoffeeMachineCm01V3ArchitectureWriteAttempt = {
  readonly schemaVersion: "coffee-machine-cm01-v3-architecture-write-attempt/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly result?: Readonly<Record<string, string>>;
};

/** A dispatched marker is fail-closed: no automatic replay can insert twice. */
export class CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The CM-01 SysON insertion outcome is unknown and will not be retried automatically.",
    );
    this.name = "CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError";
  }
}

export class FileCoffeeMachineCm01V3ArchitectureAttemptStore {
  constructor(
    private readonly directory =
      "state/local/coffee-machine-cm01-v3-architecture-attempts",
  ) {}

  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly dispatchedAt: string;
  }): Promise<
    { readonly action: "dispatch" } | {
      readonly action: "completed";
      readonly result: Readonly<Record<string, string>>;
    }
  > {
    const fresh: CoffeeMachineCm01V3ArchitectureWriteAttempt = {
      schemaVersion: "coffee-machine-cm01-v3-architecture-write-attempt/1.0",
      projectId: nonEmpty(input.projectId, "projectId"),
      runId: nonEmpty(input.runId, "runId"),
      status: "dispatched",
      dispatchedAt: timestamp(input.dispatchedAt),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNewDurably(
        this.pathFor(fresh.projectId, fresh.runId),
        `${deterministicJson(fresh)}\n`,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.required(input.projectId, input.runId);
    if (existing.status !== "completed" || !existing.result) {
      throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
    }
    return { action: "completed", result: structuredClone(existing.result) };
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly result: Readonly<Record<string, string>>;
  }): Promise<void> {
    const existing = await this.required(input.projectId, input.runId);
    const result = normalizedResult(input.result);
    const completed: CoffeeMachineCm01V3ArchitectureWriteAttempt = {
      ...existing,
      status: "completed",
      result,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "CM-01 insertion acknowledgement conflicts with the existing attempt.",
        );
      }
      return;
    }
    await replaceDurably(
      this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(completed)}\n`,
    );
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<CoffeeMachineCm01V3ArchitectureWriteAttempt | undefined> {
    try {
      return await parse(
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
  ): Promise<CoffeeMachineCm01V3ArchitectureWriteAttempt> {
    try {
      const existing = await this.read(projectId, runId);
      if (!existing) throw new Error("CM-01 insertion marker is missing.");
      return existing;
    } catch {
      throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
    }
  }

  private pathFor(projectId: string, runId: string): string {
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([
        nonEmpty(projectId, "projectId"),
        nonEmpty(runId, "runId"),
      ]))
    }.json`;
  }
}

async function writeNewDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await file.write(new TextEncoder().encode(text));
    await file.syncData();
  } finally {
    file.close();
  }
}

async function replaceDurably(path: string, text: string): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeNewDurably(temporary, text);
  await Deno.rename(temporary, path);
}

function parse(
  text: string,
  projectId: string,
  runId: string,
): CoffeeMachineCm01V3ArchitectureWriteAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("CM-01 insertion marker is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CM-01 insertion marker is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    record.schemaVersion !== "coffee-machine-cm01-v3-architecture-write-attempt/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string" ||
    Number.isNaN(Date.parse(record.dispatchedAt))
  ) {
    throw new Error("CM-01 insertion marker does not match its identity.");
  }
  const expectedKeys = record.status === "completed"
    ? ["dispatchedAt", "projectId", "result", "runId", "schemaVersion", "status"]
    : ["dispatchedAt", "projectId", "runId", "schemaVersion", "status"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("CM-01 insertion marker has an unsupported shape.");
  }
  if (
    record.status === "completed" &&
    (!record.result || typeof record.result !== "object" ||
      Array.isArray(record.result))
  ) {
    throw new Error("Completed CM-01 insertion marker has no result.");
  }
  return {
    schemaVersion: "coffee-machine-cm01-v3-architecture-write-attempt/1.0",
    projectId,
    runId,
    status: record.status,
    dispatchedAt: record.dispatchedAt,
    ...(record.status === "completed"
      ? { result: normalizedResult(record.result as Record<string, unknown>) }
      : {}),
  };
}

function normalizedResult(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 || keys[0] !== "inserted" || keys[1] !== "parentId" ||
    keys[2] !== "textSha256" ||
    value.inserted !== "true" || typeof value.parentId !== "string" ||
    !value.parentId ||
    typeof value.textSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.textSha256)
  ) {
    throw new Error("CM-01 insertion acknowledgement is invalid.");
  }
  return { inserted: "true", parentId: value.parentId, textSha256: value.textSha256 };
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty.`);
  return value;
}

function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError("dispatchedAt must be an ISO timestamp.");
  }
  return value;
}
