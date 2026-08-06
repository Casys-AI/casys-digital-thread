import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";

export const CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA =
  "cm01-nominal-modelica-attempt/1.0" as const;

export interface Cm01NominalModelicaAttempt {
  readonly schemaVersion: typeof CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  /** The provider might have run after this marker exists; never replay it. */
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly completedAt?: string;
  readonly captureFingerprint?: ContentFingerprint;
}

export class Cm01NominalModelicaOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The CM-01 nominal Modelica simulation outcome is unknown. It will not be retried automatically because the provider may already have created a persisted run.",
    );
    this.name = "Cm01NominalModelicaOutcomeUnknownError";
  }
}

/** Durable write-ahead record for the one non-idempotent Modelica simulation. */
export class FileCm01NominalModelicaAttemptStore {
  constructor(
    private readonly directory = "state/local/cm01-nominal-modelica-attempts",
  ) {}

  async begin(input: {
    projectId: string;
    runId: string;
    dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly captureFingerprint: ContentFingerprint }
  > {
    validateIdentity(input.projectId, input.runId);
    isoDate(input.dispatchedAt, "dispatchedAt");
    const fresh: Cm01NominalModelicaAttempt = {
      schemaVersion: CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
    const path = this.pathFor(input.projectId, input.runId);
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNewDurably(path, `${deterministicJson(fresh)}\n`);
      await syncDirectoryChain(this.directory);
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    let existing: Cm01NominalModelicaAttempt;
    try {
      existing = await this.required(input.projectId, input.runId);
    } catch {
      throw new Cm01NominalModelicaOutcomeUnknownError();
    }
    if (existing.status !== "completed" || !existing.captureFingerprint) {
      throw new Cm01NominalModelicaOutcomeUnknownError();
    }
    return {
      action: "completed",
      captureFingerprint: structuredClone(existing.captureFingerprint),
    };
  }

  async complete(input: {
    projectId: string;
    runId: string;
    completedAt: string;
    captureFingerprint: ContentFingerprint;
  }): Promise<void> {
    validateIdentity(input.projectId, input.runId);
    isoDate(input.completedAt, "completedAt");
    fingerprint(input.captureFingerprint);
    const existing = await this.required(input.projectId, input.runId);
    const completed: Cm01NominalModelicaAttempt = {
      schemaVersion: CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: input.completedAt,
      captureFingerprint: structuredClone(input.captureFingerprint),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed CM-01 Modelica attempt conflicts with its recorded capture.",
        );
      }
      return;
    }
    await replaceDurably(
      this.pathFor(input.projectId, input.runId),
      `${deterministicJson(completed)}\n`,
    );
    await syncDirectoryChain(this.directory);
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<Cm01NominalModelicaAttempt | undefined> {
    validateIdentity(projectId, runId);
    try {
      return parseAttempt(
        await Deno.readTextFile(this.pathFor(projectId, runId)),
        projectId,
        runId,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  pathFor(projectId: string, runId: string): string {
    validateIdentity(projectId, runId);
    const key = encodeURIComponent(JSON.stringify([projectId, runId]));
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async required(
    projectId: string,
    runId: string,
  ): Promise<Cm01NominalModelicaAttempt> {
    const attempt = await this.read(projectId, runId);
    if (!attempt) throw new Error("CM-01 Modelica attempt was not durably recorded.");
    return attempt;
  }
}

async function writeNewDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await writeAll(file, new TextEncoder().encode(text));
    await file.syncData();
  } finally {
    file.close();
  }
}

async function replaceDurably(path: string, text: string): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await Deno.open(temporary, { createNew: true, write: true });
  try {
    await writeAll(file, new TextEncoder().encode(text));
    await file.syncData();
  } finally {
    file.close();
  }
  await Deno.rename(temporary, path);
}

async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    const count = await file.write(bytes.subarray(written));
    if (count <= 0) throw new Error("CM-01 Modelica attempt made no write progress.");
    written += count;
  }
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
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
    if (current === ".") return;
  }
}

function parseAttempt(
  text: string,
  projectId: string,
  runId: string,
): Cm01NominalModelicaAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("CM-01 Modelica attempt is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("CM-01 Modelica attempt must be an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowed = record.status === "completed"
    ? [
      "captureFingerprint",
      "completedAt",
      "dispatchedAt",
      "projectId",
      "runId",
      "schemaVersion",
      "status",
    ]
    : ["dispatchedAt", "projectId", "runId", "schemaVersion", "status"];
  if (deterministicJson(keys) !== deterministicJson(allowed)) {
    throw new Error("CM-01 Modelica attempt has unsupported or missing fields.");
  }
  if (
    record.schemaVersion !== CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA ||
    record.projectId !== projectId || record.runId !== runId ||
    (record.status !== "dispatched" && record.status !== "completed")
  ) throw new Error("CM-01 Modelica attempt identity is invalid.");
  isoDate(record.dispatchedAt, "dispatchedAt");
  if (record.status === "dispatched") {
    return {
      schemaVersion: CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA,
      projectId,
      runId,
      status: "dispatched",
      dispatchedAt: record.dispatchedAt as string,
    };
  }
  isoDate(record.completedAt, "completedAt");
  return {
    schemaVersion: CM01_NOMINAL_MODELICA_ATTEMPT_SCHEMA,
    projectId,
    runId,
    status: "completed",
    dispatchedAt: record.dispatchedAt as string,
    completedAt: record.completedAt as string,
    captureFingerprint: fingerprint(record.captureFingerprint),
  };
}

function validateIdentity(projectId: string, runId: string): void {
  if (!projectId.trim() || !runId.trim()) {
    throw new TypeError("projectId and runId must be non-empty.");
  }
}

function isoDate(value: unknown, label: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be ISO-8601.`);
  }
}

function fingerprint(value: unknown): ContentFingerprint {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (value as Record<string, unknown>).digest !== "string" ||
    !/^[a-f0-9]{64}$/.test((value as Record<string, unknown>).digest as string)
  ) throw new TypeError("captureFingerprint must be a lowercase SHA-256 fingerprint.");
  return { algorithm: "sha256", digest: (value as Record<string, string>).digest };
}
