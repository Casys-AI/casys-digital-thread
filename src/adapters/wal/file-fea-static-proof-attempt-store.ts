/**
 * Immutable, run-scoped write-ahead journal for `verify.run-fea-static-proof@1`.
 *
 * Three-state machine guards the single non-idempotent CalculiX dispatch:
 *   dispatched → solver-recorded → completed
 *
 * Unlike the two-state requirements WAL, the intermediate solver-recorded
 * state embeds canonicalSolverCaptureText — the exact serialised capture
 * envelope FileCaptureStore writes — so the executor can resume from the
 * oracle step after a crash without re-calling CalculiX.
 *
 * planDigest mismatch on any existing record is terminal: the server never
 * adopts a foreign plan silently. A dispatched-but-not-recorded entry is
 * equally terminal — CalculiX may already have run and its side-effects
 * are unknown.
 *
 * Durability tier matches FileRequirementsAttemptStore: link-then-sync
 * for new files (O_CREAT|O_EXCL race-free), rename-then-sync for updates.
 */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";

const SCHEMA = "fea-static-proof-attempt/1.0" as const;
const QUARANTINE_SCHEMA = "fea-static-proof-run-quarantine/1.0" as const;

/**
 * Durable shape of one FEA static-proof WAL entry.
 * canonicalSolverCaptureText is the exact JSON envelope FileCaptureStore
 * persists; it is embedded here so the executor can rematérialise the CAS
 * entry from WAL alone after a crash at solver-recorded without a CalculiX
 * re-dispatch.
 */
export type FeaStaticProofAttempt =
  | {
    readonly schemaVersion: typeof SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "solver-recorded";
    readonly dispatchedAt: string;
    readonly solverCaptureFp: string;
    readonly canonicalSolverCaptureText: string;
  }
  | {
    readonly schemaVersion: typeof SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly solverCaptureFp: string;
    readonly canonicalSolverCaptureText: string;
    readonly verdictCaptureFp: string;
  };

export type FeaStaticProofRunQuarantine = {
  readonly schemaVersion: typeof QUARANTINE_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly reason: "structural_failure_post_acknowledgement";
  readonly quarantinedAt: string;
};

/**
 * Raised whenever the WAL cannot determine whether CalculiX has already
 * run for this plan. The executor must not dispatch again automatically;
 * an operator must review before re-queuing.
 */
export class FeaStaticProofOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The FEA static-proof outcome is unknown and will not be retried automatically.",
    );
    this.name = "FeaStaticProofOutcomeUnknownError";
  }
}

/**
 * Raised when a state transition is called out of order — complete before
 * solver-recorded, or recordSolver after completed. The machine is strict:
 * dispatched → solver-recorded → completed only.
 */
export class FeaStaticProofIllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  constructor(from: string, to: string) {
    super(`Illegal FEA static-proof WAL transition: ${from} → ${to}.`);
    this.name = "FeaStaticProofIllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Raised when a quarantined run attempts to begin again. Quarantine means a
 * prior attempt acknowledged a solver capture but structural verification
 * failed; an operator must inspect before re-queuing.
 */
export class FeaStaticProofRunQuarantinedError extends Error {
  constructor() {
    super(
      "This FEA static-proof run is quarantined: a prior attempt recorded a solver " +
        "capture but structural verification failed. An operator must review " +
        "the attempt before queuing a new run.",
    );
    this.name = "FeaStaticProofRunQuarantinedError";
  }
}

type BeginResult =
  | { readonly action: "dispatch" }
  | {
    readonly action: "solver-recorded";
    readonly solverCaptureFp: string;
    readonly canonicalSolverCaptureText: string;
  }
  | {
    readonly action: "completed";
    readonly solverCaptureFp: string;
    readonly verdictCaptureFp: string;
    readonly canonicalSolverCaptureText: string;
  };

export class FileFeaStaticProofAttemptStore {
  constructor(
    private readonly directory = "state/local/fea-static-proof-attempts",
  ) {}

  /**
   * Atomically reserve the sole CalculiX dispatch allowed for this run.
   *
   * Returns { action: "dispatch" } when the run may proceed. If a durable
   * record already exists, returns the recovery payload matching the WAL
   * state so the executor can resume without re-dispatching. A dispatched-
   * but-not-recorded entry is terminal: CalculiX outcome is unknown.
   */
  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }): Promise<BeginResult> {
    const fresh = buildDispatched(input);
    await Deno.mkdir(this.directory, { recursive: true });

    // Quarantine check must precede the attempt read — a quarantined run must
    // not receive a new dispatch even if no WAL entry exists (crash before WAL
    // begin but after provider acknowledgement).
    if (await this.isQuarantined(fresh.projectId, fresh.runId)) {
      throw new FeaStaticProofRunQuarantinedError();
    }

    let current: FeaStaticProofAttempt | undefined;
    try {
      current = await this.readRun(fresh.projectId, fresh.runId);
    } catch {
      throw new FeaStaticProofOutcomeUnknownError();
    }
    if (current) return actionFor(current, fresh.planDigest);

    const path = await this.pathFor(fresh.projectId, fresh.runId);
    try {
      await writeNewDurably(path, `${deterministicJson(fresh)}\n`, this.directory);
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.requiredRun(fresh.projectId, fresh.runId);
    await syncDirectoryChain(this.directory);
    return actionFor(existing, fresh.planDigest);
  }

  /**
   * Record the solver's canonical capture, advancing dispatched →
   * solver-recorded. Idempotent when the identical capture text is
   * presented; a conflicting text is a terminal integrity violation.
   */
  async recordSolver(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly solverCaptureFp: string;
    readonly canonicalSolverCaptureText: string;
  }): Promise<void> {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    nonEmpty(input.planDigest, "planDigest");
    assertSha256Digest(input.solverCaptureFp, "solverCaptureFp");
    nonEmpty(input.canonicalSolverCaptureText, "canonicalSolverCaptureText");

    const existing = await this.requiredRun(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new FeaStaticProofOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new FeaStaticProofIllegalTransitionError("completed", "solver-recorded");
    }
    const recorded: FeaStaticProofAttempt = {
      schemaVersion: SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      status: "solver-recorded",
      dispatchedAt: existing.dispatchedAt,
      solverCaptureFp: input.solverCaptureFp,
      canonicalSolverCaptureText: input.canonicalSolverCaptureText,
    };
    if (existing.status === "solver-recorded") {
      if (deterministicJson(existing) !== deterministicJson(recorded)) {
        throw new Error(
          "FEA static-proof canonical solver text conflicts with the existing record.",
        );
      }
      await syncDirectoryChain(this.directory);
      return;
    }
    await replaceDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(recorded)}\n`,
      this.directory,
    );
  }

  /**
   * Advance solver-recorded → completed, conserving canonicalSolverCaptureText.
   * Completing from dispatched (no solver record yet) is an illegal transition:
   * the executor must call recordSolver before complete.
   */
  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly verdictCaptureFp: string;
  }): Promise<void> {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    nonEmpty(input.planDigest, "planDigest");
    assertSha256Digest(input.verdictCaptureFp, "verdictCaptureFp");

    const existing = await this.requiredRun(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new FeaStaticProofOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new FeaStaticProofIllegalTransitionError("dispatched", "completed");
    }
    const completed: FeaStaticProofAttempt = {
      schemaVersion: SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      solverCaptureFp: existing.solverCaptureFp,
      canonicalSolverCaptureText: existing.canonicalSolverCaptureText,
      verdictCaptureFp: input.verdictCaptureFp,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "FEA static-proof verdict capture fingerprint conflicts with the existing record.",
        );
      }
      await syncDirectoryChain(this.directory);
      return;
    }
    await replaceDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(completed)}\n`,
      this.directory,
    );
  }

  /** Return the durable attempt record for this run without modifying state. */
  async readRun(
    projectId: string,
    runId: string,
  ): Promise<FeaStaticProofAttempt | undefined> {
    nonEmpty(projectId, "projectId");
    nonEmpty(runId, "runId");
    return this.readPath(await this.pathFor(projectId, runId), projectId, runId);
  }

  async quarantine(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly quarantinedAt: string;
  }): Promise<void> {
    const record: FeaStaticProofRunQuarantine = {
      schemaVersion: QUARANTINE_SCHEMA,
      projectId: nonEmpty(input.projectId, "projectId"),
      runId: nonEmpty(input.runId, "runId"),
      reason: "structural_failure_post_acknowledgement",
      quarantinedAt: timestamp(input.quarantinedAt, "quarantinedAt"),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.quarantinePath(record.projectId, record.runId);
    try {
      await writeNewDurably(path, `${deterministicJson(record)}\n`, this.directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      await this.requiredQuarantine(record.projectId, record.runId);
      await syncDirectoryChain(this.directory);
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
  ): Promise<FeaStaticProofAttempt> {
    try {
      const existing = await this.readRun(projectId, runId);
      if (!existing) throw new Error("FEA static-proof attempt marker is missing.");
      return existing;
    } catch {
      throw new FeaStaticProofOutcomeUnknownError();
    }
  }

  private async requiredQuarantine(
    projectId: string,
    runId: string,
  ): Promise<FeaStaticProofRunQuarantine> {
    const value = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    if (!value) throw new FeaStaticProofOutcomeUnknownError();
    return value;
  }

  private async readPath(
    path: string,
    projectId: string,
    runId: string,
  ): Promise<FeaStaticProofAttempt | undefined> {
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
  ): Promise<FeaStaticProofRunQuarantine | undefined> {
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

function buildDispatched(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly dispatchedAt: string;
}): Extract<FeaStaticProofAttempt, { status: "dispatched" }> {
  return {
    schemaVersion: SCHEMA,
    projectId: nonEmpty(input.projectId, "projectId"),
    runId: nonEmpty(input.runId, "runId"),
    planDigest: nonEmpty(input.planDigest, "planDigest"),
    status: "dispatched",
    dispatchedAt: timestamp(input.dispatchedAt, "dispatchedAt"),
  };
}

function actionFor(
  attempt: FeaStaticProofAttempt,
  expectedPlanDigest: string,
): BeginResult {
  if (attempt.planDigest !== expectedPlanDigest) {
    throw new FeaStaticProofOutcomeUnknownError();
  }
  if (attempt.status === "dispatched") {
    throw new FeaStaticProofOutcomeUnknownError();
  }
  if (attempt.status === "solver-recorded") {
    return {
      action: "solver-recorded",
      solverCaptureFp: attempt.solverCaptureFp,
      canonicalSolverCaptureText: attempt.canonicalSolverCaptureText,
    };
  }
  return {
    action: "completed",
    solverCaptureFp: attempt.solverCaptureFp,
    verdictCaptureFp: attempt.verdictCaptureFp,
    canonicalSolverCaptureText: attempt.canonicalSolverCaptureText,
  };
}

async function writeNewDurably(
  path: string,
  text: string,
  directory: string,
): Promise<void> {
  const temporary = `${root(directory)}/.${crypto.randomUUID()}.tmp`;
  try {
    await writeTemporaryDurably(temporary, text);
    await Deno.link(temporary, path);
    await syncDirectoryChain(directory);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

async function writeTemporaryDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await writeAll(file, text);
    await file.syncData();
  } finally {
    file.close();
  }
}

async function replaceDurably(
  path: string,
  text: string,
  directory: string,
): Promise<void> {
  const temporary = `${root(directory)}/.${crypto.randomUUID()}.tmp`;
  try {
    await writeTemporaryDurably(temporary, text);
    await Deno.rename(temporary, path);
    await syncDirectoryChain(directory);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

async function writeAll(file: Deno.FsFile, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let written = 0;
  while (written < bytes.length) {
    const count = await file.write(bytes.subarray(written));
    if (count <= 0) {
      throw new Error("FEA static-proof WAL write made no progress.");
    }
    written += count;
  }
}

async function syncDirectoryChain(path: string): Promise<void> {
  let current = root(path) || ".";
  while (current !== "/") {
    const directory = await Deno.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (current === "state" || current.endsWith("/state") || current === ".") return;
    const slash = current.lastIndexOf("/");
    current = slash < 0 ? "." : slash === 0 ? "/" : current.slice(0, slash);
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function parseAttempt(
  text: string,
  projectId: string,
  runId: string,
): FeaStaticProofAttempt {
  const record = parseObject(text, "FEA static-proof attempt");
  const keys = Object.keys(record).sort();
  if (
    record.schemaVersion !== SCHEMA ||
    record.projectId !== projectId ||
    record.runId !== runId ||
    typeof record.planDigest !== "string" || !record.planDigest.trim() ||
    (record.status !== "dispatched" && record.status !== "solver-recorded" &&
      record.status !== "completed") ||
    typeof record.dispatchedAt !== "string"
  ) {
    throw new Error("FEA static-proof attempt does not match its identity.");
  }
  timestamp(record.dispatchedAt as string, "dispatchedAt");

  const expectedKeys: readonly string[] = record.status === "dispatched"
    ? ["dispatchedAt", "planDigest", "projectId", "runId", "schemaVersion", "status"]
    : record.status === "solver-recorded"
    ? [
      "canonicalSolverCaptureText",
      "dispatchedAt",
      "planDigest",
      "projectId",
      "runId",
      "schemaVersion",
      "solverCaptureFp",
      "status",
    ]
    : [
      "canonicalSolverCaptureText",
      "dispatchedAt",
      "planDigest",
      "projectId",
      "runId",
      "schemaVersion",
      "solverCaptureFp",
      "status",
      "verdictCaptureFp",
    ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("FEA static-proof attempt has an unsupported shape.");
  }

  if (record.status === "dispatched") {
    return {
      schemaVersion: SCHEMA,
      projectId,
      runId,
      planDigest: record.planDigest as string,
      status: "dispatched",
      dispatchedAt: record.dispatchedAt as string,
    };
  }

  if (
    typeof record.solverCaptureFp !== "string" ||
    !SHA256_HEX_RE.test(record.solverCaptureFp as string) ||
    typeof record.canonicalSolverCaptureText !== "string" ||
    !(record.canonicalSolverCaptureText as string).trim()
  ) {
    throw new Error("FEA static-proof attempt has invalid solver fields.");
  }

  if (record.status === "solver-recorded") {
    return {
      schemaVersion: SCHEMA,
      projectId,
      runId,
      planDigest: record.planDigest as string,
      status: "solver-recorded",
      dispatchedAt: record.dispatchedAt as string,
      solverCaptureFp: record.solverCaptureFp as string,
      canonicalSolverCaptureText: record.canonicalSolverCaptureText as string,
    };
  }

  if (
    typeof record.verdictCaptureFp !== "string" ||
    !SHA256_HEX_RE.test(record.verdictCaptureFp as string)
  ) {
    throw new Error("FEA static-proof attempt has an invalid verdict fingerprint.");
  }

  return {
    schemaVersion: SCHEMA,
    projectId,
    runId,
    planDigest: record.planDigest as string,
    status: "completed",
    dispatchedAt: record.dispatchedAt as string,
    solverCaptureFp: record.solverCaptureFp as string,
    canonicalSolverCaptureText: record.canonicalSolverCaptureText as string,
    verdictCaptureFp: record.verdictCaptureFp as string,
  };
}

function parseQuarantine(
  text: string,
  projectId: string,
  runId: string,
): FeaStaticProofRunQuarantine {
  const record = parseObject(text, "FEA static-proof quarantine marker");
  const keys = Object.keys(record).sort();
  const expected = ["projectId", "quarantinedAt", "reason", "runId", "schemaVersion"];
  if (
    record.schemaVersion !== QUARANTINE_SCHEMA ||
    record.projectId !== projectId || record.runId !== runId ||
    record.reason !== "structural_failure_post_acknowledgement" ||
    typeof record.quarantinedAt !== "string" || keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "FEA static-proof quarantine marker does not match its identity.",
    );
  }
  timestamp(record.quarantinedAt as string, "quarantinedAt");
  return {
    schemaVersion: QUARANTINE_SCHEMA,
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
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
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

function assertSha256Digest(value: string, label: string): string {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    throw new TypeError(
      `${label} must be a 64-character lowercase hexadecimal SHA-256 digest.`,
    );
  }
  return value;
}
