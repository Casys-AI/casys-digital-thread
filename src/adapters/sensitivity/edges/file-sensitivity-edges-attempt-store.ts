/**
 * Two-state WAL for model.write-sensitivity-edges@1.
 * dispatched → completed. A dispatched entry never authorizes a second insert:
 * resuming the same plan returns "verify", which re-extracts and requires the
 * inserted attributes to be observable before publishing.
 */

import {
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const SENSITIVITY_EDGES_ATTEMPT_SCHEMA =
  "sensitivity-edges-attempt/1.0" as const;

export class SensitivityEdgesOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The sensitivity-edges SysON write outcome is unknown and will not be retried automatically.",
    );
    this.name = "SensitivityEdgesOutcomeUnknownError";
  }
}

export type SensitivityEdgesAttempt =
  | {
    readonly schemaVersion: typeof SENSITIVITY_EDGES_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof SENSITIVITY_EDGES_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly snapshotId: string;
  };

export class FileSensitivityEdgesAttemptStore {
  constructor(
    private readonly directory = "state/local/sensitivity-edges-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<SensitivityEdgesAttempt | undefined> {
    try {
      return parseSensitivityEdgesAttempt(
        JSON.parse(await Deno.readTextFile(this.#path(projectId, runId))),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }): Promise<"dispatch" | "verify" | "completed"> {
    const existing = await this.read(input.projectId, input.runId);
    if (existing) {
      if (existing.planDigest !== input.planDigest) {
        throw new SensitivityEdgesOutcomeUnknownError();
      }
      if (existing.status === "completed") return "completed";
      // Same plan, insert dispatched once, outcome not yet published: the
      // caller must verify the model observably carries the plan instead of
      // re-inserting a duplicate.
      return "verify";
    }
    const attempt: SensitivityEdgesAttempt = {
      schemaVersion: SENSITIVITY_EDGES_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      planDigest: input.planDigest,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
    await Deno.mkdir(this.directory, { recursive: true });
    await writeNewAttemptFileDurably(
      this.#path(input.projectId, input.runId),
      `${deterministicJson(attempt)}\n`,
      this.directory,
      "Sensitivity-edges WAL write made no progress.",
    );
    return "dispatch";
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshotId: string;
  }): Promise<void> {
    const current = await this.read(input.projectId, input.runId);
    if (!current || current.status !== "dispatched") {
      if (current?.status === "completed") return;
      throw new SensitivityEdgesOutcomeUnknownError();
    }
    const next: SensitivityEdgesAttempt = {
      ...current,
      status: "completed",
      snapshotId: input.snapshotId,
    };
    await replaceAttemptFileDurably(
      this.#path(input.projectId, input.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      "Sensitivity-edges WAL write made no progress.",
    );
  }

  #path(projectId: string, runId: string): string {
    const safe = `${projectId}__${runId}`.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    return `${this.directory.replace(/\/$/, "")}/${safe}.json`;
  }
}

function parseSensitivityEdgesAttempt(value: unknown): SensitivityEdgesAttempt {
  if (!value || typeof value !== "object") {
    throw new TypeError("$sensitivityEdgesAttempt must be an object.");
  }
  const status = (value as { status?: unknown }).status;
  if (status === "dispatched") {
    const root = exactRecord(value, [
      "schemaVersion",
      "projectId",
      "runId",
      "planDigest",
      "status",
      "dispatchedAt",
    ], "$sensitivityEdgesAttempt");
    literalValue(
      root.schemaVersion,
      SENSITIVITY_EDGES_ATTEMPT_SCHEMA,
      "$sensitivityEdgesAttempt.schemaVersion",
    );
    return {
      schemaVersion: SENSITIVITY_EDGES_ATTEMPT_SCHEMA,
      projectId: nonEmptyText(root.projectId, "$sensitivityEdgesAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$sensitivityEdgesAttempt.runId"),
      planDigest: nonEmptyText(root.planDigest, "$sensitivityEdgesAttempt.planDigest"),
      status: "dispatched",
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$sensitivityEdgesAttempt.dispatchedAt",
      ),
    };
  }
  if (status === "completed") {
    const root = exactRecord(value, [
      "schemaVersion",
      "projectId",
      "runId",
      "planDigest",
      "status",
      "dispatchedAt",
      "snapshotId",
    ], "$sensitivityEdgesAttempt");
    literalValue(
      root.schemaVersion,
      SENSITIVITY_EDGES_ATTEMPT_SCHEMA,
      "$sensitivityEdgesAttempt.schemaVersion",
    );
    return {
      schemaVersion: SENSITIVITY_EDGES_ATTEMPT_SCHEMA,
      projectId: nonEmptyText(root.projectId, "$sensitivityEdgesAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$sensitivityEdgesAttempt.runId"),
      planDigest: nonEmptyText(root.planDigest, "$sensitivityEdgesAttempt.planDigest"),
      status: "completed",
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$sensitivityEdgesAttempt.dispatchedAt",
      ),
      snapshotId: nonEmptyText(
        root.snapshotId,
        "$sensitivityEdgesAttempt.snapshotId",
      ),
    };
  }
  throw new TypeError("$sensitivityEdgesAttempt.status is unknown.");
}
