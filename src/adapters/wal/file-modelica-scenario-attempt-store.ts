/**
 * Immutable, run-scoped write-ahead journal for `simulate.run-modelica-scenario@1`.
 *
 * A run dispatches exactly one modelica_simulate call. The three-state machine
 * enforces the provider acknowledgement sequence before any CAS object is
 * committed:
 *
 *   dispatched — a simulate request was sent; the provider run-id is not yet
 *     recorded. If the process crashes here the outcome is unknown — the run
 *     cannot be retried without operator review, because the provider may
 *     already hold a persisted run.
 *
 *   provider-run-known — a run-id was returned by the provider and durably
 *     stored along with the canonical simulate envelope. Recovery resumes
 *     exclusively from modelica_run_get(providerRunId); re-simulating is
 *     forbidden regardless of what the current plan says.
 *
 *   completed — both CAS objects (provider run record and execution receipt)
 *     are fingerprinted and stored. The canonical simulate envelope is carried
 *     forward for audit continuity.
 *
 * The quarantine sentinel pattern mirrors the requirements WAL (D6): any run
 * that acknowledged a provider dispatch but failed structural verification is
 * quarantined by runId. A quarantined run cannot dispatch again regardless of
 * the current plan — the provider state may be partial and must be inspected
 * before a new run is queued.
 */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  replaceAttemptFileDurably,
  syncAttemptDirectoryChain,
  writeNewAttemptFileDurably,
} from "./durable-attempt-file-writes.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const NO_WRITE_PROGRESS = "Modelica scenario attempt journal made no write progress.";

export type ModelicaScenarioAttempt =
  | {
    readonly schemaVersion: "modelica-scenario-attempt/1.0";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: "modelica-scenario-attempt/1.0";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "provider-run-known";
    readonly dispatchedAt: string;
    readonly providerRunId: string;
    readonly canonicalSimulateEnvelope: Record<string, unknown>;
  }
  | {
    readonly schemaVersion: "modelica-scenario-attempt/1.0";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly providerRunId: string;
    readonly canonicalSimulateEnvelope: Record<string, unknown>;
    readonly providerRunRecordFp: string;
    readonly receiptFp: string;
  };

export type ModelicaScenarioRunQuarantine = {
  readonly schemaVersion: "modelica-scenario-run-quarantine/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly reason: "structural_failure_post_acknowledgement";
  readonly quarantinedAt: string;
};

export class ModelicaScenarioOutcomeUnknownError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The Modelica scenario simulation outcome is unknown and will not be retried " +
        "automatically. The provider may already hold a persisted run.",
      options,
    );
    this.name = "ModelicaScenarioOutcomeUnknownError";
  }
}

export class ModelicaScenarioIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(
      `Illegal Modelica scenario WAL transition: cannot advance from "${from}" to "${to}".`,
    );
    this.name = "ModelicaScenarioIllegalTransitionError";
  }
}

export class ModelicaScenarioRunQuarantinedError extends Error {
  constructor() {
    super(
      "This Modelica scenario run is quarantined: a prior attempt acknowledged a " +
        "provider dispatch but structural verification failed. An operator must inspect " +
        "the provider state before queuing a new run.",
    );
    this.name = "ModelicaScenarioRunQuarantinedError";
  }
}

export class FileModelicaScenarioAttemptStore {
  constructor(
    private readonly directory = "state/local/modelica-scenario-attempts",
  ) {}

  /**
   * Atomically reserve the sole provider dispatch allowed for this run.
   *
   * Returns `{ action: "dispatch" }` for a new run, `{ action:
   * "provider-run-known", ... }` when a provider run-id was already durably
   * recorded (recovery: call modelica_run_get only, never re-simulate), or `{
   * action: "completed", ... }` when the run already finished (recovery:
   * re-attach without re-running). A `dispatched` existing record always
   * throws OutcomeUnknown — the outcome of that prior dispatch is not yet
   * known and must not be retried automatically.
   */
  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "provider-run-known";
      readonly providerRunId: string;
      readonly canonicalSimulateEnvelope: Record<string, unknown>;
    }
    | {
      readonly action: "completed";
      readonly providerRunId: string;
      readonly providerRunRecordFp: string;
      readonly receiptFp: string;
      readonly canonicalSimulateEnvelope: Record<string, unknown>;
    }
  > {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    hex64(input.planDigest, "planDigest");
    timestamp(input.dispatchedAt, "dispatchedAt");

    await Deno.mkdir(this.directory, { recursive: true });

    // Quarantine is keyed only by run identity: it must win before reading or
    // creating an attempt record, including after a crash left no WAL entry.
    if (await this.isQuarantined(input.projectId, input.runId)) {
      throw new ModelicaScenarioRunQuarantinedError();
    }

    let current: ModelicaScenarioAttempt | undefined;
    try {
      current = await this.readRun(input.projectId, input.runId);
    } catch {
      throw new ModelicaScenarioOutcomeUnknownError();
    }
    if (current) return actionFor(current, input.planDigest);

    const fresh: Extract<ModelicaScenarioAttempt, { status: "dispatched" }> = {
      schemaVersion: "modelica-scenario-attempt/1.0",
      projectId: input.projectId,
      runId: input.runId,
      planDigest: input.planDigest,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
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
    // Race: another concurrent begin just won the link — read and apply.
    const existing = await this.requiredRun(fresh.projectId, fresh.runId);
    await syncAttemptDirectoryChain(this.directory);
    return actionFor(existing, fresh.planDigest);
  }

  /**
   * Durably record the provider run-id and the normalized simulate response,
   * advancing the WAL from `dispatched` to `provider-run-known`.
   *
   * Idempotent when the same providerRunId and canonicalSimulateEnvelope are
   * presented for a record already in `provider-run-known`. Any planDigest
   * mismatch on the existing record throws OutcomeUnknown; an attempt to
   * overwrite a `completed` record throws IllegalTransitionError.
   */
  async recordProviderRun(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly providerRunId: string;
    readonly canonicalSimulateEnvelope: Record<string, unknown>;
  }): Promise<void> {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    hex64(input.planDigest, "planDigest");
    nonEmpty(input.providerRunId, "providerRunId");
    requirePlainObject(input.canonicalSimulateEnvelope, "canonicalSimulateEnvelope");

    const existing = await this.requiredRun(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new ModelicaScenarioOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new ModelicaScenarioIllegalTransitionError(
        "completed",
        "provider-run-known",
      );
    }
    const next: Extract<ModelicaScenarioAttempt, { status: "provider-run-known" }> = {
      schemaVersion: "modelica-scenario-attempt/1.0",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      status: "provider-run-known",
      dispatchedAt: existing.dispatchedAt,
      providerRunId: input.providerRunId,
      canonicalSimulateEnvelope: input.canonicalSimulateEnvelope,
    };
    if (existing.status === "provider-run-known") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new ModelicaScenarioOutcomeUnknownError();
      }
      await syncAttemptDirectoryChain(this.directory);
      return;
    }
    // existing.status === "dispatched" — durable rename advance.
    await replaceAttemptFileDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      NO_WRITE_PROGRESS,
    );
  }

  /**
   * Durably record both CAS fingerprints, advancing the WAL from
   * `provider-run-known` to `completed`. The canonicalSimulateEnvelope
   * recorded at `provider-run-known` is carried forward into the completed
   * record so the two CAS objects remain jointly auditable.
   *
   * Idempotent when the same fingerprints are presented for an already
   * `completed` record. A `dispatched` source status throws
   * IllegalTransitionError — the provider run-id must be recorded first.
   * A planDigest mismatch always throws OutcomeUnknown.
   */
  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly providerRunRecordFp: string;
    readonly receiptFp: string;
  }): Promise<void> {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    hex64(input.planDigest, "planDigest");
    hex64(input.providerRunRecordFp, "providerRunRecordFp");
    hex64(input.receiptFp, "receiptFp");

    const existing = await this.requiredRun(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new ModelicaScenarioOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new ModelicaScenarioIllegalTransitionError("dispatched", "completed");
    }
    const next: Extract<ModelicaScenarioAttempt, { status: "completed" }> = {
      schemaVersion: "modelica-scenario-attempt/1.0",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      providerRunId: existing.providerRunId,
      canonicalSimulateEnvelope: existing.canonicalSimulateEnvelope,
      providerRunRecordFp: input.providerRunRecordFp,
      receiptFp: input.receiptFp,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new Error(
          "Completed Modelica scenario attempt conflicts with the existing record.",
        );
      }
      await syncAttemptDirectoryChain(this.directory);
      return;
    }
    // existing.status === "provider-run-known" — durable rename advance.
    await replaceAttemptFileDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      NO_WRITE_PROGRESS,
    );
  }

  /** Return the WAL record for this run, or undefined if none exists yet. */
  async readRun(
    projectId: string,
    runId: string,
  ): Promise<ModelicaScenarioAttempt | undefined> {
    nonEmpty(projectId, "projectId");
    nonEmpty(runId, "runId");
    return this.readPath(await this.pathFor(projectId, runId), projectId, runId);
  }

  /** Mark a run as quarantined after structural failure post-acknowledgement. */
  async quarantine(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly quarantinedAt: string;
  }): Promise<void> {
    const record: ModelicaScenarioRunQuarantine = {
      schemaVersion: "modelica-scenario-run-quarantine/1.0",
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
  ): Promise<ModelicaScenarioAttempt> {
    try {
      const existing = await this.readRun(projectId, runId);
      if (!existing) throw new Error("Modelica scenario attempt marker is missing.");
      return existing;
    } catch {
      throw new ModelicaScenarioOutcomeUnknownError();
    }
  }

  private async requiredQuarantine(
    projectId: string,
    runId: string,
  ): Promise<ModelicaScenarioRunQuarantine> {
    const value = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    if (!value) throw new ModelicaScenarioOutcomeUnknownError();
    return value;
  }

  private async readPath(
    path: string,
    projectId: string,
    runId: string,
  ): Promise<ModelicaScenarioAttempt | undefined> {
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
  ): Promise<ModelicaScenarioRunQuarantine | undefined> {
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

/**
 * Resolve the action implied by an existing WAL record for the given
 * planDigest. A `dispatched` record always throws — the provider call
 * outcome is still unknown. Any planDigest mismatch on an existing record
 * also throws — the executor must reconcile from the known state, not open
 * a divergent plan branch.
 */
function actionFor(
  attempt: ModelicaScenarioAttempt,
  expectedPlanDigest: string,
):
  | {
    readonly action: "provider-run-known";
    readonly providerRunId: string;
    readonly canonicalSimulateEnvelope: Record<string, unknown>;
  }
  | {
    readonly action: "completed";
    readonly providerRunId: string;
    readonly providerRunRecordFp: string;
    readonly receiptFp: string;
    readonly canonicalSimulateEnvelope: Record<string, unknown>;
  } {
  if (attempt.planDigest !== expectedPlanDigest || attempt.status === "dispatched") {
    throw new ModelicaScenarioOutcomeUnknownError();
  }
  if (attempt.status === "provider-run-known") {
    return {
      action: "provider-run-known",
      providerRunId: attempt.providerRunId,
      canonicalSimulateEnvelope: attempt.canonicalSimulateEnvelope,
    };
  }
  return {
    action: "completed",
    providerRunId: attempt.providerRunId,
    providerRunRecordFp: attempt.providerRunRecordFp,
    receiptFp: attempt.receiptFp,
    canonicalSimulateEnvelope: attempt.canonicalSimulateEnvelope,
  };
}

function parseAttempt(
  text: string,
  projectId: string,
  runId: string,
): ModelicaScenarioAttempt {
  const record = parseObject(text, "Modelica scenario attempt");
  const keys = Object.keys(record).sort();

  if (
    record.schemaVersion !== "modelica-scenario-attempt/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    (record.status !== "dispatched" && record.status !== "provider-run-known" &&
      record.status !== "completed") ||
    typeof record.planDigest !== "string" || !SHA256_HEX.test(record.planDigest) ||
    typeof record.dispatchedAt !== "string"
  ) {
    throw new Error("Modelica scenario attempt does not match its identity.");
  }
  timestamp(record.dispatchedAt as string, "dispatchedAt");

  let expectedKeys: string[];
  if (record.status === "dispatched") {
    expectedKeys = [
      "dispatchedAt",
      "planDigest",
      "projectId",
      "runId",
      "schemaVersion",
      "status",
    ];
  } else if (record.status === "provider-run-known") {
    expectedKeys = [
      "canonicalSimulateEnvelope",
      "dispatchedAt",
      "planDigest",
      "projectId",
      "providerRunId",
      "runId",
      "schemaVersion",
      "status",
    ];
  } else {
    expectedKeys = [
      "canonicalSimulateEnvelope",
      "dispatchedAt",
      "planDigest",
      "projectId",
      "providerRunId",
      "providerRunRecordFp",
      "receiptFp",
      "runId",
      "schemaVersion",
      "status",
    ];
  }

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Modelica scenario attempt has an unsupported shape.");
  }

  if (record.status === "dispatched") {
    return {
      schemaVersion: "modelica-scenario-attempt/1.0",
      projectId,
      runId,
      planDigest: record.planDigest as string,
      status: "dispatched",
      dispatchedAt: record.dispatchedAt as string,
    };
  }

  if (
    typeof record.providerRunId !== "string" || !record.providerRunId.trim()
  ) {
    throw new Error("Modelica scenario attempt has an invalid providerRunId.");
  }
  const envelope = requirePlainObject(
    record.canonicalSimulateEnvelope,
    "canonicalSimulateEnvelope",
  );

  if (record.status === "provider-run-known") {
    return {
      schemaVersion: "modelica-scenario-attempt/1.0",
      projectId,
      runId,
      planDigest: record.planDigest as string,
      status: "provider-run-known",
      dispatchedAt: record.dispatchedAt as string,
      providerRunId: record.providerRunId as string,
      canonicalSimulateEnvelope: envelope,
    };
  }

  // completed
  if (
    typeof record.providerRunRecordFp !== "string" ||
    !SHA256_HEX.test(record.providerRunRecordFp) ||
    typeof record.receiptFp !== "string" ||
    !SHA256_HEX.test(record.receiptFp)
  ) {
    throw new Error("Completed Modelica scenario attempt has invalid fingerprints.");
  }
  return {
    schemaVersion: "modelica-scenario-attempt/1.0",
    projectId,
    runId,
    planDigest: record.planDigest as string,
    status: "completed",
    dispatchedAt: record.dispatchedAt as string,
    providerRunId: record.providerRunId as string,
    canonicalSimulateEnvelope: envelope,
    providerRunRecordFp: record.providerRunRecordFp as string,
    receiptFp: record.receiptFp as string,
  };
}

function parseQuarantine(
  text: string,
  projectId: string,
  runId: string,
): ModelicaScenarioRunQuarantine {
  const record = parseObject(text, "Modelica scenario quarantine marker");
  const keys = Object.keys(record).sort();
  const expected = ["projectId", "quarantinedAt", "reason", "runId", "schemaVersion"];
  if (
    record.schemaVersion !== "modelica-scenario-run-quarantine/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    record.reason !== "structural_failure_post_acknowledgement" ||
    typeof record.quarantinedAt !== "string" ||
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error("Modelica scenario quarantine marker does not match its identity.");
  }
  timestamp(record.quarantinedAt as string, "quarantinedAt");
  return {
    schemaVersion: "modelica-scenario-run-quarantine/1.0",
    projectId,
    runId,
    reason: "structural_failure_post_acknowledgement",
    quarantinedAt: record.quarantinedAt as string,
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
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
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

function hex64(value: string, label: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new TypeError(`${label} must be a 64-character lowercase hex string.`);
  }
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}
