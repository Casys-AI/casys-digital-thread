/**
 * Durable three-state WAL for the CM-01 two-solve sensitivity study.
 *
 *   dispatched -> capture-recorded -> completed
 *
 * A pre-existing dispatched record is terminal outcome-unknown: CalculiX may
 * already have returned observations and remeshing means a second solve is not
 * the same evidentiary occurrence. Once the exact canonical capture is
 * recorded, recovery is CAS-only and provider re-dispatch is forbidden.
 */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";

export const SENSITIVITY_RUN_ATTEMPT_SCHEMA = "sensitivity-run-attempt/1.1" as const;
const LEGACY_SCHEMA = "sensitivity-run-attempt/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type SensitivityRunAttempt =
  | {
    readonly schemaVersion: typeof SENSITIVITY_RUN_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof SENSITIVITY_RUN_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "capture-recorded";
    readonly dispatchedAt: string;
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }
  | {
    readonly schemaVersion: typeof SENSITIVITY_RUN_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly recordedAt: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  };

type LegacySensitivityRunAttempt =
  | {
    readonly schemaVersion: typeof LEGACY_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof LEGACY_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
  };

type ReadAttempt = SensitivityRunAttempt | LegacySensitivityRunAttempt;

export interface BeginSensitivityRunAttempt {
  readonly projectId: string;
  readonly runId: string;
  readonly caseDigest: string;
  readonly dispatchedAt: string;
}

export interface RecordSensitivityCaptureAttempt extends BeginSensitivityRunAttempt {
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
}

export interface CompleteSensitivityRunAttempt extends BeginSensitivityRunAttempt {
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}

export type BeginSensitivityRunAttemptResult =
  | { readonly action: "dispatch" }
  | {
    readonly action: "capture-recorded";
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }
  | {
    readonly action: "completed";
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText?: string;
  };

export class SensitivityRunOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The sensitivity provider outcome is unknown and will not be retried automatically.",
    );
    this.name = "SensitivityRunOutcomeUnknownError";
  }
}

export class SensitivityRunIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal sensitivity WAL transition: ${from} -> ${to}.`);
    this.name = "SensitivityRunIllegalTransitionError";
  }
}

export class FileSensitivityRunAttemptStore {
  constructor(
    private readonly directory = "state/local/sensitivity-run-attempts",
  ) {}

  async begin(
    input: BeginSensitivityRunAttempt,
  ): Promise<BeginSensitivityRunAttemptResult> {
    const fresh = dispatchedRecord(input);
    await Deno.mkdir(this.directory, { recursive: true });

    let current: ReadAttempt | undefined;
    try {
      current = await this.readExisting(
        fresh.projectId,
        fresh.runId,
        fresh.caseDigest,
      );
    } catch {
      throw new SensitivityRunOutcomeUnknownError();
    }
    if (current) {
      assertAttemptBasis(current, fresh);
      return actionFor(current);
    }

    const path = this.pathFor(fresh.projectId, fresh.runId, fresh.caseDigest);
    try {
      await writeNewDurably(
        path,
        `${deterministicJson(fresh)}\n`,
        this.directory,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const raced = await this.requiredExisting(
      fresh.projectId,
      fresh.runId,
      fresh.caseDigest,
    );
    await syncDirectoryChain(this.directory);
    assertAttemptBasis(raced, fresh);
    return actionFor(raced);
  }

  /** Advance dispatched -> capture-recorded with the exact CAS bytes. */
  async recordCapture(input: RecordSensitivityCaptureAttempt): Promise<void> {
    validateBegin(input);
    timestamp(input.recordedAt, "recordedAt");
    const fingerprint = normalizedFingerprint(input.captureFingerprint);
    nonEmpty(input.canonicalCaptureText, "canonicalCaptureText");
    await assertCaptureIntegrity(input.canonicalCaptureText, fingerprint);

    const existing = await this.requiredExisting(
      input.projectId,
      input.runId,
      input.caseDigest,
    );
    assertAttemptBasis(existing, input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      throw new SensitivityRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new SensitivityRunIllegalTransitionError("completed", "capture-recorded");
    }
    const recorded: Extract<SensitivityRunAttempt, { status: "capture-recorded" }> = {
      schemaVersion: SENSITIVITY_RUN_ATTEMPT_SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      caseDigest: existing.caseDigest,
      status: "capture-recorded",
      dispatchedAt: existing.dispatchedAt,
      recordedAt: input.recordedAt,
      captureFingerprint: fingerprint,
      canonicalCaptureText: input.canonicalCaptureText,
    };
    if (existing.status === "capture-recorded") {
      if (deterministicJson(existing) !== deterministicJson(recorded)) {
        throw new Error(
          "Sensitivity capture-recorded WAL entry conflicts with its exact capture.",
        );
      }
      await syncDirectoryChain(this.directory);
      return;
    }
    await replaceDurably(
      this.pathFor(existing.projectId, existing.runId, existing.caseDigest),
      `${deterministicJson(recorded)}\n`,
      this.directory,
    );
  }

  /** Advance capture-recorded -> completed without dropping capture bytes. */
  async complete(input: CompleteSensitivityRunAttempt): Promise<void> {
    validateComplete(input);
    const existing = await this.requiredExisting(
      input.projectId,
      input.runId,
      input.caseDigest,
    );
    assertAttemptBasis(existing, input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      throw new SensitivityRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new SensitivityRunIllegalTransitionError("dispatched", "completed");
    }
    const fingerprint = normalizedFingerprint(input.captureFingerprint);
    if (
      deterministicJson(existing.captureFingerprint) !==
        deterministicJson(fingerprint)
    ) {
      throw new Error(
        "Completed sensitivity attempt conflicts with its capture-recorded fingerprint.",
      );
    }
    const completed: Extract<SensitivityRunAttempt, { status: "completed" }> = {
      schemaVersion: SENSITIVITY_RUN_ATTEMPT_SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      caseDigest: existing.caseDigest,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      recordedAt: existing.recordedAt,
      completedAt: input.completedAt,
      captureFingerprint: existing.captureFingerprint,
      canonicalCaptureText: existing.canonicalCaptureText,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed sensitivity attempt conflicts with its existing record.",
        );
      }
      await syncDirectoryChain(this.directory);
      return;
    }
    await replaceDurably(
      this.pathFor(existing.projectId, existing.runId, existing.caseDigest),
      `${deterministicJson(completed)}\n`,
      this.directory,
    );
  }

  async readRun(
    projectId: string,
    runId: string,
    caseDigest: string,
  ): Promise<ReadAttempt | undefined> {
    validateIdentity(projectId, runId, caseDigest);
    return await this.readExisting(projectId, runId, caseDigest);
  }

  pathFor(projectId: string, runId: string, caseDigest: string): string {
    validateIdentity(projectId, runId, caseDigest);
    const key = encodeURIComponent(JSON.stringify([projectId, runId, caseDigest]));
    return `${root(this.directory)}/${key}.json`;
  }

  private async requiredExisting(
    projectId: string,
    runId: string,
    caseDigest: string,
  ): Promise<ReadAttempt> {
    try {
      const existing = await this.readExisting(projectId, runId, caseDigest);
      if (!existing) throw new Error("Sensitivity WAL marker is missing.");
      return existing;
    } catch (error) {
      if (error instanceof SensitivityRunOutcomeUnknownError) throw error;
      throw new SensitivityRunOutcomeUnknownError();
    }
  }

  private async readExisting(
    projectId: string,
    runId: string,
    caseDigest: string,
  ): Promise<ReadAttempt | undefined> {
    try {
      const text = await Deno.readTextFile(
        this.pathFor(projectId, runId, caseDigest),
      );
      const attempt = parseAttempt(text, { projectId, runId, caseDigest });
      if (
        attempt.schemaVersion === SENSITIVITY_RUN_ATTEMPT_SCHEMA &&
        attempt.status !== "dispatched"
      ) {
        await assertCaptureIntegrity(
          attempt.canonicalCaptureText,
          attempt.captureFingerprint,
        );
      }
      return attempt;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}

function dispatchedRecord(
  input: BeginSensitivityRunAttempt,
): Extract<SensitivityRunAttempt, { status: "dispatched" }> {
  validateBegin(input);
  return {
    schemaVersion: SENSITIVITY_RUN_ATTEMPT_SCHEMA,
    projectId: input.projectId,
    runId: input.runId,
    caseDigest: input.caseDigest,
    status: "dispatched",
    dispatchedAt: input.dispatchedAt,
  };
}

function actionFor(attempt: ReadAttempt): BeginSensitivityRunAttemptResult {
  if (attempt.status === "dispatched") {
    throw new SensitivityRunOutcomeUnknownError();
  }
  if (attempt.schemaVersion === LEGACY_SCHEMA) {
    return {
      action: "completed",
      captureFingerprint: attempt.captureFingerprint,
    };
  }
  if (attempt.status === "capture-recorded") {
    return {
      action: "capture-recorded",
      captureFingerprint: attempt.captureFingerprint,
      canonicalCaptureText: attempt.canonicalCaptureText,
    };
  }
  return {
    action: "completed",
    captureFingerprint: attempt.captureFingerprint,
    canonicalCaptureText: attempt.canonicalCaptureText,
  };
}

function parseAttempt(
  text: string,
  expected: { projectId: string; runId: string; caseDigest: string },
): ReadAttempt {
  const record = parseObject(text, "Sensitivity run attempt");
  if (
    record.projectId !== expected.projectId || record.runId !== expected.runId ||
    record.caseDigest !== expected.caseDigest ||
    (record.schemaVersion !== SENSITIVITY_RUN_ATTEMPT_SCHEMA &&
      record.schemaVersion !== LEGACY_SCHEMA) ||
    typeof record.dispatchedAt !== "string"
  ) {
    throw new Error("Sensitivity run attempt does not match its exact identity.");
  }
  timestamp(record.dispatchedAt, "dispatchedAt");

  if (record.schemaVersion === LEGACY_SCHEMA) {
    if (record.status === "dispatched") {
      exactKeys(record, [
        "caseDigest",
        "dispatchedAt",
        "projectId",
        "runId",
        "schemaVersion",
        "status",
      ]);
      return {
        schemaVersion: LEGACY_SCHEMA,
        projectId: expected.projectId,
        runId: expected.runId,
        caseDigest: expected.caseDigest,
        status: "dispatched",
        dispatchedAt: record.dispatchedAt,
      };
    }
    if (record.status !== "completed") {
      throw new Error("Legacy sensitivity attempt has an unsupported status.");
    }
    exactKeys(record, [
      "captureFingerprint",
      "caseDigest",
      "completedAt",
      "dispatchedAt",
      "projectId",
      "runId",
      "schemaVersion",
      "status",
    ]);
    const completedAt = timestamp(record.completedAt, "completedAt");
    return {
      schemaVersion: LEGACY_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      caseDigest: expected.caseDigest,
      status: "completed",
      dispatchedAt: record.dispatchedAt,
      completedAt,
      captureFingerprint: parseFingerprint(record.captureFingerprint),
    };
  }

  if (record.status === "dispatched") {
    exactKeys(record, [
      "caseDigest",
      "dispatchedAt",
      "projectId",
      "runId",
      "schemaVersion",
      "status",
    ]);
    return {
      schemaVersion: SENSITIVITY_RUN_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      caseDigest: expected.caseDigest,
      status: "dispatched",
      dispatchedAt: record.dispatchedAt,
    };
  }
  if (record.status !== "capture-recorded" && record.status !== "completed") {
    throw new Error("Sensitivity run attempt has an unsupported status.");
  }
  exactKeys(
    record,
    record.status === "capture-recorded"
      ? [
        "canonicalCaptureText",
        "captureFingerprint",
        "caseDigest",
        "dispatchedAt",
        "projectId",
        "recordedAt",
        "runId",
        "schemaVersion",
        "status",
      ]
      : [
        "canonicalCaptureText",
        "captureFingerprint",
        "caseDigest",
        "completedAt",
        "dispatchedAt",
        "projectId",
        "recordedAt",
        "runId",
        "schemaVersion",
        "status",
      ],
  );
  const recordedAt = timestamp(record.recordedAt, "recordedAt");
  const captureFingerprint = parseFingerprint(record.captureFingerprint);
  const canonicalCaptureText = nonEmpty(
    record.canonicalCaptureText,
    "canonicalCaptureText",
  );
  if (record.status === "capture-recorded") {
    return {
      schemaVersion: SENSITIVITY_RUN_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      caseDigest: expected.caseDigest,
      status: "capture-recorded",
      dispatchedAt: record.dispatchedAt,
      recordedAt,
      captureFingerprint,
      canonicalCaptureText,
    };
  }
  const completedAt = timestamp(record.completedAt, "completedAt");
  return {
    schemaVersion: SENSITIVITY_RUN_ATTEMPT_SCHEMA,
    projectId: expected.projectId,
    runId: expected.runId,
    caseDigest: expected.caseDigest,
    status: "completed",
    dispatchedAt: record.dispatchedAt,
    recordedAt,
    completedAt,
    captureFingerprint,
    canonicalCaptureText,
  };
}

function assertAttemptBasis(
  attempt: ReadAttempt,
  input: BeginSensitivityRunAttempt,
): void {
  if (attempt.dispatchedAt !== input.dispatchedAt) {
    throw new SensitivityRunOutcomeUnknownError();
  }
}

async function assertCaptureIntegrity(
  canonicalCaptureText: string,
  fingerprint: ContentFingerprint,
): Promise<void> {
  if (await sha256Hex(canonicalCaptureText) !== fingerprint.digest) {
    throw new Error(
      "Sensitivity canonical capture text does not match its fingerprint.",
    );
  }
  const parsed = parseObject(canonicalCaptureText, "Sensitivity canonical capture");
  if (deterministicJson(parsed) !== canonicalCaptureText) {
    throw new Error("Sensitivity capture text is not canonical deterministic JSON.");
  }
}

function validateBegin(input: BeginSensitivityRunAttempt): void {
  validateIdentity(input.projectId, input.runId, input.caseDigest);
  timestamp(input.dispatchedAt, "dispatchedAt");
}

function validateComplete(input: CompleteSensitivityRunAttempt): void {
  validateBegin(input);
  timestamp(input.completedAt, "completedAt");
  normalizedFingerprint(input.captureFingerprint);
}

function validateIdentity(projectId: string, runId: string, caseDigest: string): void {
  nonEmpty(projectId, "projectId");
  nonEmpty(runId, "runId");
  if (!SHA256_HEX.test(caseDigest)) {
    throw new TypeError(
      "caseDigest must be a 64-character lowercase hexadecimal SHA-256 digest.",
    );
  }
}

function parseFingerprint(value: unknown): ContentFingerprint {
  const record = typeof value === "object" && value !== null &&
      !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!record) throw new TypeError("captureFingerprint must be an object.");
  exactKeys(record, ["algorithm", "digest"]);
  return normalizedFingerprint(record as unknown as ContentFingerprint);
}

function normalizedFingerprint(value: ContentFingerprint): ContentFingerprint {
  if (value.algorithm !== "sha256" || !SHA256_HEX.test(value.digest)) {
    throw new TypeError(
      "captureFingerprint must be a sha256 ContentFingerprint with a 64-char hex digest.",
    );
  }
  return { algorithm: "sha256", digest: value.digest };
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error("Sensitivity run attempt has an unsupported exact shape.");
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const text = nonEmpty(value, label);
  if (Number.isNaN(Date.parse(text)) || new Date(text).toISOString() !== text) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  return text;
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

async function writeTemporaryDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    const bytes = new TextEncoder().encode(text);
    let written = 0;
    while (written < bytes.length) {
      const count = await file.write(bytes.subarray(written));
      if (count <= 0) throw new Error("Sensitivity WAL write made no progress.");
      written += count;
    }
    await file.syncData();
  } finally {
    file.close();
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
