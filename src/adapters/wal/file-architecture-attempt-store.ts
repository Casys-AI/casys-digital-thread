/**
 * Write-ahead journal for the generic `model.write-architecture@1` operation.
 *
 * Key: (projectId, runId, planDigest) — the planDigest ensures that a changed
 * proposal creates a new WAL entry, while the same plan cannot be re-inserted
 * once dispatched (fail-closed against double-write).
 *
 * A `dispatched` marker that has not been `completed` means the SysON insertion
 * outcome is unknown. No automatic retry must proceed from this state — the
 * operator must inspect SysON before any recovery path.
 */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";

export type ArchitectureWriteAttempt = {
  readonly schemaVersion: "architecture-write-attempt/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly result?: { readonly inserted: "true" };
};

/** Raised when a dispatched WAL entry has not been completed. */
export class ArchitectureWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The SysON architecture insertion outcome is unknown and will not be retried automatically.",
    );
    this.name = "ArchitectureWriteOutcomeUnknownError";
  }
}

/**
 * Persisted record of a run-level quarantine.
 *
 * Written when a structural verification failure occurs after the SysON
 * insertion was acknowledged. Keyed by (projectId, runId) — coarser than the
 * planDigest-level attempt, and consulted before any preflight dispatch so that
 * a changed enrichment plan (different planDigest) cannot slip past the WAL
 * guard and trigger a second insertion.
 */
export type ArchitectureRunQuarantine = {
  readonly schemaVersion: "architecture-run-quarantine/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly reason: "structural_failure_post_acknowledgement";
  readonly quarantinedAt: string;
};

/**
 * Raised when the executor discovers a quarantine sentinel for this runId.
 *
 * A quarantined run cannot be retried — the operator must inspect SysON
 * manually and queue a new run after any corrective steps.
 */
export class ArchitectureRunQuarantinedError extends Error {
  constructor() {
    super(
      "This architecture run is quarantined: a prior attempt acknowledged a SysON " +
        "insertion but structural verification failed. The SysON model may be partially " +
        "inserted. An operator must inspect and manually correct SysON before queuing " +
        "a new architecture run.",
    );
    this.name = "ArchitectureRunQuarantinedError";
  }
}

export class FileArchitectureAttemptStore {
  constructor(
    private readonly directory = "state/local/architecture-write-attempts",
  ) {}

  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed" }
  > {
    const fresh: ArchitectureWriteAttempt = {
      schemaVersion: "architecture-write-attempt/1.0",
      projectId: nonEmpty(input.projectId, "projectId"),
      runId: nonEmpty(input.runId, "runId"),
      planDigest: nonEmpty(input.planDigest, "planDigest"),
      status: "dispatched",
      dispatchedAt: timestamp(input.dispatchedAt),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNewDurably(
        this.pathFor(fresh.projectId, fresh.runId, fresh.planDigest),
        `${deterministicJson(fresh)}\n`,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.required(
      input.projectId,
      input.runId,
      input.planDigest,
    );
    if (existing.status !== "completed" || !existing.result) {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
    return { action: "completed" };
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
  }): Promise<void> {
    const existing = await this.required(
      input.projectId,
      input.runId,
      input.planDigest,
    );
    const completed: ArchitectureWriteAttempt = {
      ...existing,
      status: "completed",
      result: { inserted: "true" },
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Architecture insertion acknowledgement conflicts with the existing attempt.",
        );
      }
      return;
    }
    await replaceDurably(
      this.pathFor(existing.projectId, existing.runId, existing.planDigest),
      `${deterministicJson(completed)}\n`,
    );
  }

  /**
   * Write a run-level quarantine sentinel for (projectId, runId).
   *
   * Idempotent: if the sentinel already exists the call succeeds silently.
   * Called after a structural verification failure post-acknowledgement so that
   * any later dispatch attempt — even under a different planDigest — is blocked.
   */
  async quarantine(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly quarantinedAt: string;
  }): Promise<void> {
    const record: ArchitectureRunQuarantine = {
      schemaVersion: "architecture-run-quarantine/1.0",
      projectId: nonEmpty(input.projectId, "projectId"),
      runId: nonEmpty(input.runId, "runId"),
      reason: "structural_failure_post_acknowledgement",
      quarantinedAt: timestamp(input.quarantinedAt),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNewDurably(
        this.quarantinePath(record.projectId, record.runId),
        `${deterministicJson(record)}\n`,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      // Already quarantined — idempotent.
    }
  }

  /**
   * Return true when a quarantine sentinel exists for (projectId, runId).
   *
   * Throws on unexpected I/O errors so that a broken filesystem is not
   * silently treated as "not quarantined".
   */
  async isQuarantined(projectId: string, runId: string): Promise<boolean> {
    try {
      await Deno.stat(this.quarantinePath(projectId, runId));
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }

  async read(
    projectId: string,
    runId: string,
    planDigest: string,
  ): Promise<ArchitectureWriteAttempt | undefined> {
    try {
      return await parse(
        await Deno.readTextFile(
          this.pathFor(projectId, runId, planDigest),
        ),
        projectId,
        runId,
        planDigest,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async required(
    projectId: string,
    runId: string,
    planDigest: string,
  ): Promise<ArchitectureWriteAttempt> {
    try {
      const existing = await this.read(projectId, runId, planDigest);
      if (!existing) throw new Error("Architecture insertion marker is missing.");
      return existing;
    } catch {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
  }

  private pathFor(projectId: string, runId: string, planDigest: string): string {
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(
        JSON.stringify([
          nonEmpty(projectId, "projectId"),
          nonEmpty(runId, "runId"),
          nonEmpty(planDigest, "planDigest"),
        ]),
      )
    }.json`;
  }

  /**
   * Path for the run-level quarantine sentinel.
   *
   * Uses a distinct filename prefix ("quarantine-") to avoid any collision with
   * the planDigest-level attempt paths, and is keyed only by (projectId, runId)
   * so it is found regardless of which planDigest the new preflight would produce.
   */
  private quarantinePath(projectId: string, runId: string): string {
    return `${this.directory.replace(/\/$/, "")}/quarantine-${
      encodeURIComponent(
        JSON.stringify([
          nonEmpty(projectId, "projectId"),
          nonEmpty(runId, "runId"),
        ]),
      )
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
  planDigest: string,
): ArchitectureWriteAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Architecture insertion marker is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Architecture insertion marker is not an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    record.schemaVersion !== "architecture-write-attempt/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    record.planDigest !== planDigest ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string" ||
    Number.isNaN(Date.parse(record.dispatchedAt))
  ) {
    throw new Error("Architecture insertion marker does not match its identity.");
  }
  const expectedKeys = record.status === "completed"
    ? [
      "dispatchedAt",
      "planDigest",
      "projectId",
      "result",
      "runId",
      "schemaVersion",
      "status",
    ]
    : ["dispatchedAt", "planDigest", "projectId", "runId", "schemaVersion", "status"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Architecture insertion marker has an unsupported shape.");
  }
  if (
    record.status === "completed" &&
    (!record.result || typeof record.result !== "object" ||
      Array.isArray(record.result) ||
      (record.result as Record<string, unknown>).inserted !== "true")
  ) {
    throw new Error("Completed architecture insertion marker has an invalid result.");
  }
  return {
    schemaVersion: "architecture-write-attempt/1.0",
    projectId,
    runId,
    planDigest,
    status: record.status,
    dispatchedAt: record.dispatchedAt,
    ...(record.status === "completed" ? { result: { inserted: "true" } } : {}),
  };
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
