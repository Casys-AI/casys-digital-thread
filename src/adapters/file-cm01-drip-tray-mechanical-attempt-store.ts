import { deterministicJson } from "../domain/deterministic-json.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

export const CM01_DRIP_TRAY_MECHANICAL_ATTEMPT_SCHEMA =
  "cm01-v3-drip-tray-mechanical-attempt/1.0" as const;

type Attempt =
  | {
    readonly projectId: string;
    readonly runId: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly projectId: string;
    readonly runId: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly captureFingerprint: ContentFingerprint;
  };

export class Cm01DripTrayMechanicalOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The CM-01 drip-tray mechanical outcome is unknown. It will not be retried automatically because build123d or CalculiX may already have run.",
    );
    this.name = "Cm01DripTrayMechanicalOutcomeUnknownError";
  }
}

/** Write-ahead boundary around the two non-idempotent local provider calls. */
export class FileCm01DripTrayMechanicalAttemptStore {
  constructor(
    private readonly directory = "state/local/cm01-drip-tray-mechanical-attempts",
  ) {}

  async begin(
    input: { projectId: string; runId: string; dispatchedAt: string },
  ): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly captureFingerprint: ContentFingerprint }
  > {
    const fresh = {
      schemaVersion: CM01_DRIP_TRAY_MECHANICAL_ATTEMPT_SCHEMA,
      projectId: identity(input.projectId),
      runId: identity(input.runId),
      status: "dispatched" as const,
      dispatchedAt: timestamp(input.dispatchedAt),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      const file = await Deno.open(this.pathFor(fresh.projectId, fresh.runId), {
        createNew: true,
        write: true,
      });
      try {
        await file.write(new TextEncoder().encode(`${deterministicJson(fresh)}\n`));
        await file.syncData();
      } finally {
        file.close();
      }
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.required(fresh.projectId, fresh.runId);
    if (existing.status !== "completed") {
      throw new Cm01DripTrayMechanicalOutcomeUnknownError();
    }
    return { action: "completed", captureFingerprint: existing.captureFingerprint };
  }

  async complete(
    input: {
      projectId: string;
      runId: string;
      completedAt: string;
      captureFingerprint: ContentFingerprint;
    },
  ): Promise<void> {
    const existing = await this.required(input.projectId, input.runId);
    const completed = {
      schemaVersion: CM01_DRIP_TRAY_MECHANICAL_ATTEMPT_SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      status: "completed" as const,
      dispatchedAt: existing.dispatchedAt,
      completedAt: timestamp(input.completedAt),
      captureFingerprint: fingerprint(input.captureFingerprint),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed CM-01 mechanical attempt conflicts with its capture.",
        );
      }
      return;
    }
    const path = this.pathFor(existing.projectId, existing.runId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const file = await Deno.open(temporary, { createNew: true, write: true });
    try {
      await file.write(new TextEncoder().encode(`${deterministicJson(completed)}\n`));
      await file.syncData();
    } finally {
      file.close();
    }
    await Deno.rename(temporary, path);
  }

  /**
   * Read the durable capture reference without opening a new provider attempt.
   * Identity recovery uses this path specifically so a missing historical
   * record cannot accidentally become a new dispatch marker.
   */
  async completedCapture(
    input: { projectId: string; runId: string },
  ): Promise<ContentFingerprint | undefined> {
    const existing = await this.readExisting(input.projectId, input.runId);
    return existing?.status === "completed" ? existing.captureFingerprint : undefined;
  }

  private async required(
    projectId: string,
    runId: string,
  ): Promise<Attempt> {
    const existing = await this.readExisting(projectId, runId);
    if (!existing) throw new Cm01DripTrayMechanicalOutcomeUnknownError();
    return existing;
  }

  private async readExisting(
    projectId: string,
    runId: string,
  ): Promise<Attempt | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.pathFor(projectId, runId));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw new Cm01DripTrayMechanicalOutcomeUnknownError();
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Cm01DripTrayMechanicalOutcomeUnknownError();
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Cm01DripTrayMechanicalOutcomeUnknownError();
    }
    const record = value as Record<string, unknown>;
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
      record.schemaVersion !== CM01_DRIP_TRAY_MECHANICAL_ATTEMPT_SCHEMA ||
      record.projectId !== identity(projectId) || record.runId !== identity(runId) ||
      (record.status !== "dispatched" && record.status !== "completed")
    ) throw new Cm01DripTrayMechanicalOutcomeUnknownError();
    const base = {
      projectId: identity(projectId),
      runId: identity(runId),
      status: record.status,
      dispatchedAt: timestamp(record.dispatchedAt),
    } as const;
    if (record.status === "dispatched") {
      return { ...base, status: "dispatched" };
    }
    timestamp(record.completedAt);
    return {
      ...base,
      status: "completed",
      captureFingerprint: fingerprint(record.captureFingerprint),
    };
  }

  private pathFor(projectId: string, runId: string) {
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([identity(projectId), identity(runId)]))
    }.json`;
  }
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError("CM-01 mechanical identity is invalid.");
  }
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError("CM-01 mechanical timestamp is invalid.");
  }
  return value;
}
function fingerprint(value: unknown): ContentFingerprint {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (value as Record<string, unknown>).digest !== "string" ||
    !/^[a-f0-9]{64}$/.test((value as Record<string, unknown>).digest as string)
  ) throw new TypeError("CM-01 mechanical capture fingerprint is invalid.");
  return {
    algorithm: "sha256",
    digest: (value as Record<string, unknown>).digest as string,
  };
}
