import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";

export const CM01_SEMANTIC_CAD_ATTEMPT_SCHEMA =
  "cm01-semantic-cad-attempt/1.0" as const;

export interface Cm01SemanticCadAttempt {
  readonly schemaVersion: typeof CM01_SEMANTIC_CAD_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly completedAt?: string;
  readonly captureFingerprint?: ContentFingerprint;
}

/** A dispatched export could have reached build123d: never automatically replay it. */
export class Cm01SemanticCadOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The CM-01 CAD export outcome is unknown. It will not be retried automatically.",
    );
    this.name = "Cm01SemanticCadOutcomeUnknownError";
  }
}

export class FileCm01SemanticCadAttemptStore {
  constructor(private readonly directory = "state/local/cm01-semantic-cad-attempts") {}

  async begin(
    input: { projectId: string; runId: string; dispatchedAt: string },
  ): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly captureFingerprint: ContentFingerprint }
  > {
    const fresh: Cm01SemanticCadAttempt = {
      schemaVersion: CM01_SEMANTIC_CAD_ATTEMPT_SCHEMA,
      projectId: identity(input.projectId, "projectId"),
      runId: identity(input.runId, "runId"),
      status: "dispatched",
      dispatchedAt: timestamp(input.dispatchedAt),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await Deno.writeTextFile(
        this.pathFor(fresh.projectId, fresh.runId),
        `${deterministicJson(fresh)}\n`,
        { createNew: true },
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.required(fresh.projectId, fresh.runId);
    if (existing.status !== "completed" || !existing.captureFingerprint) {
      throw new Cm01SemanticCadOutcomeUnknownError();
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
    const existing = await this.required(input.projectId, input.runId);
    const completed: Cm01SemanticCadAttempt = {
      schemaVersion: CM01_SEMANTIC_CAD_ATTEMPT_SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: timestamp(input.completedAt),
      captureFingerprint: fingerprint(input.captureFingerprint),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed CM-01 CAD attempt conflicts with its recorded capture.",
        );
      }
      return;
    }
    const path = this.pathFor(existing.projectId, existing.runId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(temporary, `${deterministicJson(completed)}\n`, {
      createNew: true,
    });
    await Deno.rename(temporary, path);
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<Cm01SemanticCadAttempt | undefined> {
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
  ): Promise<Cm01SemanticCadAttempt> {
    try {
      const existing = await this.read(projectId, runId);
      if (!existing) throw new Error("missing");
      return existing;
    } catch {
      throw new Cm01SemanticCadOutcomeUnknownError();
    }
  }

  private pathFor(projectId: string, runId: string): string {
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([
        identity(projectId, "projectId"),
        identity(runId, "runId"),
      ]))
    }.json`;
  }
}

function parse(text: string, projectId: string, runId: string): Cm01SemanticCadAttempt {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("CM-01 CAD attempt is not JSON.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("CM-01 CAD attempt is invalid.");
  }
  const record = raw as Record<string, unknown>;
  const expected = record.status === "completed"
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
  if (
    deterministicJson(Object.keys(record).sort()) !== deterministicJson(expected) ||
    record.schemaVersion !== CM01_SEMANTIC_CAD_ATTEMPT_SCHEMA ||
    record.projectId !== identity(projectId, "projectId") ||
    record.runId !== identity(runId, "runId") ||
    (record.status !== "dispatched" && record.status !== "completed")
  ) throw new Error("CM-01 CAD attempt has an unsupported contract.");
  const base = {
    schemaVersion: CM01_SEMANTIC_CAD_ATTEMPT_SCHEMA,
    projectId,
    runId,
    status: record.status,
    dispatchedAt: timestamp(record.dispatchedAt),
  } as const;
  if (record.status === "dispatched") return base;
  return {
    ...base,
    status: "completed",
    completedAt: timestamp(record.completedAt),
    captureFingerprint: fingerprint(record.captureFingerprint),
  };
}

function fingerprint(value: unknown): ContentFingerprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("CM-01 CAD capture fingerprint is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new Error("CM-01 CAD capture fingerprint is invalid.");
  }
  return { algorithm: "sha256", digest: record.digest };
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("CM-01 CAD timestamp is invalid.");
  }
  return value;
}
