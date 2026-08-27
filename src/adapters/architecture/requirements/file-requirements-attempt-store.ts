/**
 * Immutable, run-scoped write-ahead journal for `model.write-requirements@1`.
 *
 * A run is allowed to dispatch exactly one SysON insertion. The plan digest is
 * evidence of what was dispatched — it is never a secondary idempotency key.
 * After a crash the server must not open another insertion attempt for the same
 * run without operator review.
 *
 * The quarantine sentinel is planDigest-agnostic (D6 quarantine pattern): any
 * run that acknowledged a SysON insertion but failed structural verification is
 * quarantined by runId. A quarantined run cannot dispatch again regardless of
 * the current enrichment plan — the model may be partially inserted and must be
 * inspected before a new run is queued.
 *
 * Structure mirrors FileArchitectureAttemptStore — same durability tier,
 * same runId-keyed files, same quarantine sentinel schema. New schema version
 * strings distinguish the two stores from accidental cross-reads.
 */

import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  replaceAttemptFileDurably,
  syncAttemptDirectoryChain,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

const NO_WRITE_PROGRESS = "Requirements write-attempt journal made no write progress.";

export type RequirementsWriteAttempt = {
  readonly schemaVersion: "requirements-write-attempt/1.1";
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly result?: {
    readonly inserted: "true";
    readonly requirementsElementId: string;
  };
};

export class RequirementsWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The SysON requirements insertion outcome is unknown and will not be retried automatically.",
    );
    this.name = "RequirementsWriteOutcomeUnknownError";
  }
}

export type RequirementsRunQuarantine = {
  readonly schemaVersion: "requirements-run-quarantine/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly reason: "structural_failure_post_acknowledgement";
  readonly quarantinedAt: string;
};

export class RequirementsRunQuarantinedError extends Error {
  constructor() {
    super(
      "This requirements run is quarantined: a prior attempt acknowledged a SysON " +
        "insertion but structural verification failed. The SysON model may be partially " +
        "inserted. An operator must inspect and manually correct SysON before queuing " +
        "a new requirements run.",
    );
    this.name = "RequirementsRunQuarantinedError";
  }
}

export class FileRequirementsAttemptStore {
  constructor(
    private readonly directory = "state/local/requirements-write-attempts",
  ) {}

  /**
   * Atomically reserve the sole provider dispatch allowed for this run.
   *
   * Returns `{ action: "dispatch" }` when the run may proceed, or
   * `{ action: "completed" }` when a prior completed record was found (recovery
   * path — re-read the model and publish without inserting again).
   */
  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly requirementsElementId: string }
  > {
    const fresh = buildAttempt(input);
    await Deno.mkdir(this.directory, { recursive: true });

    let current: RequirementsWriteAttempt | undefined;
    try {
      current = await this.readRun(fresh.projectId, fresh.runId);
    } catch {
      throw new RequirementsWriteOutcomeUnknownError();
    }
    if (current) return actionFor(current, fresh.planDigest);

    const path = await this.pathFor(fresh.projectId, fresh.runId);
    try {
      await writeNewAttemptFileDurably(
        path,
        `${deterministicJson(fresh)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.requiredRun(fresh.projectId, fresh.runId);
    await syncAttemptDirectoryChain(this.directory);
    return actionFor(existing, fresh.planDigest);
  }

  /**
   * Mark the immutable run record completed only after the inserted element's
   * identity, target typing, and constraints have all been proved by readback.
   */
  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly requirementsElementId: string;
  }): Promise<void> {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    nonEmpty(input.planDigest, "planDigest");
    nonEmpty(input.requirementsElementId, "requirementsElementId");
    const existing = await this.requiredRun(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new RequirementsWriteOutcomeUnknownError();
    }
    const completed: RequirementsWriteAttempt = {
      ...existing,
      status: "completed",
      result: {
        inserted: "true",
        requirementsElementId: input.requirementsElementId,
      },
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Requirements insertion acknowledgement conflicts with the existing attempt.",
        );
      }
      await syncAttemptDirectoryChain(this.directory);
      return;
    }
    await replaceAttemptFileDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(completed)}\n`,
      this.directory,
      NO_WRITE_PROGRESS,
    );
  }

  /** Return the immutable run record for this runId. */
  async readRun(
    projectId: string,
    runId: string,
  ): Promise<RequirementsWriteAttempt | undefined> {
    nonEmpty(projectId, "projectId");
    nonEmpty(runId, "runId");
    return this.readPath(await this.pathFor(projectId, runId), projectId, runId);
  }

  async quarantine(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly quarantinedAt: string;
  }): Promise<void> {
    const record: RequirementsRunQuarantine = {
      schemaVersion: "requirements-run-quarantine/1.0",
      projectId: nonEmpty(input.projectId, "projectId"),
      runId: nonEmpty(input.runId, "runId"),
      reason: "structural_failure_post_acknowledgement",
      quarantinedAt: timestamp(input.quarantinedAt, "quarantinedAt"),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.quarantinePath(record.projectId, record.runId);
    try {
      await writeNewAttemptFileDurably(
        path,
        `${deterministicJson(record)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      await this.requiredQuarantine(record.projectId, record.runId);
      await syncAttemptDirectoryChain(this.directory);
    }
  }

  async isQuarantined(projectId: string, runId: string): Promise<boolean> {
    const current = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    return current !== undefined;
  }

  private async requiredRun(
    projectId: string,
    runId: string,
  ): Promise<RequirementsWriteAttempt> {
    try {
      const existing = await this.readRun(projectId, runId);
      if (!existing) throw new Error("Requirements insertion marker is missing.");
      return existing;
    } catch {
      throw new RequirementsWriteOutcomeUnknownError();
    }
  }

  private async requiredQuarantine(
    projectId: string,
    runId: string,
  ): Promise<RequirementsRunQuarantine> {
    const value = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    if (!value) throw new RequirementsWriteOutcomeUnknownError();
    return value;
  }

  private async readPath(
    path: string,
    projectId: string,
    runId: string,
  ): Promise<RequirementsWriteAttempt | undefined> {
    try {
      return parseAttempt(await Deno.readTextFile(path), projectId, runId);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async readQuarantinePath(
    path: string,
    projectId: string,
    runId: string,
  ): Promise<RequirementsRunQuarantine | undefined> {
    try {
      return parseQuarantine(await Deno.readTextFile(path), projectId, runId);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async pathFor(projectId: string, runId: string): Promise<string> {
    return `${root(this.directory)}/run-${await sha256Hex(
      JSON.stringify([projectId, runId]),
    )}.json`;
  }

  private async quarantinePath(projectId: string, runId: string): Promise<string> {
    return `${root(this.directory)}/quarantine-${await sha256Hex(
      JSON.stringify([projectId, runId]),
    )}.json`;
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

function buildAttempt(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly dispatchedAt: string;
}): RequirementsWriteAttempt {
  return {
    schemaVersion: "requirements-write-attempt/1.1",
    projectId: nonEmpty(input.projectId, "projectId"),
    runId: nonEmpty(input.runId, "runId"),
    planDigest: nonEmpty(input.planDigest, "planDigest"),
    status: "dispatched",
    dispatchedAt: timestamp(input.dispatchedAt, "dispatchedAt"),
  };
}

function actionFor(
  attempt: RequirementsWriteAttempt,
  expectedPlanDigest: string,
): { readonly action: "completed"; readonly requirementsElementId: string } {
  if (
    attempt.planDigest !== expectedPlanDigest || attempt.status !== "completed" ||
    !attempt.result
  ) {
    throw new RequirementsWriteOutcomeUnknownError();
  }
  return {
    action: "completed",
    requirementsElementId: attempt.result.requirementsElementId,
  };
}

function parseAttempt(
  text: string,
  projectId: string,
  runId: string,
): RequirementsWriteAttempt {
  const record = parseObject(text, "Requirements insertion marker");
  const keys = Object.keys(record).sort();
  if (
    record.schemaVersion !== "requirements-write-attempt/1.1" ||
    record.projectId !== projectId || record.runId !== runId ||
    (typeof record.planDigest !== "string" || !record.planDigest.trim()) ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string"
  ) throw new Error("Requirements insertion marker does not match its identity.");
  timestamp(record.dispatchedAt, "dispatchedAt");
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
    throw new Error("Requirements insertion marker has an unsupported shape.");
  }
  if (
    record.status === "completed" &&
    (!record.result || typeof record.result !== "object" ||
      Array.isArray(record.result) ||
      (record.result as Record<string, unknown>).inserted !== "true" ||
      typeof (record.result as Record<string, unknown>).requirementsElementId !==
        "string" ||
      !((record.result as Record<string, unknown>).requirementsElementId as string)
        .trim() ||
      Object.keys(record.result as Record<string, unknown>).length !== 2)
  ) throw new Error("Completed requirements insertion marker has an invalid result.");
  return {
    schemaVersion: "requirements-write-attempt/1.1",
    projectId,
    runId,
    planDigest: record.planDigest,
    status: record.status,
    dispatchedAt: record.dispatchedAt,
    ...(record.status === "completed"
      ? {
        result: {
          inserted: "true" as const,
          requirementsElementId: (record.result as Record<string, unknown>)
            .requirementsElementId as string,
        },
      }
      : {}),
  };
}

function parseQuarantine(
  text: string,
  projectId: string,
  runId: string,
): RequirementsRunQuarantine {
  const record = parseObject(text, "Requirements quarantine marker");
  const keys = Object.keys(record).sort();
  const expected = ["projectId", "quarantinedAt", "reason", "runId", "schemaVersion"];
  if (
    record.schemaVersion !== "requirements-run-quarantine/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    record.reason !== "structural_failure_post_acknowledgement" ||
    typeof record.quarantinedAt !== "string" || keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) throw new Error("Requirements quarantine marker does not match its identity.");
  timestamp(record.quarantinedAt, "quarantinedAt");
  return {
    schemaVersion: "requirements-run-quarantine/1.0",
    projectId,
    runId,
    reason: "structural_failure_post_acknowledgement",
    quarantinedAt: record.quarantinedAt,
  };
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function root(directory: string): string {
  return directory.replace(/\/$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be non-empty.`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}
