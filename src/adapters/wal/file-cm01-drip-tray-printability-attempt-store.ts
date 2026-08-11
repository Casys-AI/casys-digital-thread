/** Durable three-state WAL for the non-idempotent DFM observation occurrence. */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";

export const PRINTABILITY_RUN_ATTEMPT_SCHEMA = "printability-run-attempt/1.1" as const;
const LEGACY_SCHEMA = "printability-run-attempt/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type PrintabilityRunAttempt = CurrentAttempt;
type CurrentAttempt = Dispatched | Recorded | Completed;
type Dispatched = Basis & {
  readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
  readonly status: "dispatched";
};
type Recorded = Basis & {
  readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
  readonly status: "capture-recorded";
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
};
type Completed = Basis & {
  readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
  readonly status: "completed";
  readonly recordedAt: string;
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
};
type Basis = {
  readonly projectId: string;
  readonly runId: string;
  readonly caseDigest: string;
  readonly dispatchedAt: string;
};
type LegacyAttempt = Basis & {
  readonly schemaVersion: typeof LEGACY_SCHEMA;
  readonly status: "dispatched" | "completed";
  readonly completedAt?: string;
  readonly captureFingerprint?: ContentFingerprint;
};
type ReadAttempt = CurrentAttempt | LegacyAttempt;

export interface BeginPrintabilityRunAttempt extends Basis {}
export interface RecordPrintabilityCaptureAttempt extends BeginPrintabilityRunAttempt {
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
}
export interface CompletePrintabilityRunAttempt extends BeginPrintabilityRunAttempt {
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}
export type BeginPrintabilityRunAttemptResult =
  | { readonly action: "dispatch" }
  | {
    readonly action: "capture-recorded";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }
  | {
    readonly action: "completed";
    readonly recordedAt?: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText?: string;
  };

export class PrintabilityRunOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The printability provider outcome is unknown and will not be retried automatically.",
    );
    this.name = "PrintabilityRunOutcomeUnknownError";
  }
}
export class PrintabilityRunIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal printability WAL transition: ${from} -> ${to}.`);
    this.name = "PrintabilityRunIllegalTransitionError";
  }
}

export class FileCm01DripTrayPrintabilityAttemptStore {
  constructor(
    private readonly directory = "state/local/cm01-drip-tray-printability-attempts",
  ) {}

  async begin(
    input: BeginPrintabilityRunAttempt,
  ): Promise<BeginPrintabilityRunAttemptResult> {
    validateBasis(input);
    const fresh: Dispatched = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      ...input,
      status: "dispatched",
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNew(
        this.pathFor(input.projectId, input.runId, input.caseDigest),
        `${deterministicJson(fresh)}\n`,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    let existing: ReadAttempt | undefined;
    try {
      existing = await this.readExisting(
        input.projectId,
        input.runId,
        input.caseDigest,
      );
    } catch {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    if (!existing) throw new PrintabilityRunOutcomeUnknownError();
    assertBasis(existing, input);
    return actionFor(existing);
  }

  async recordCapture(input: RecordPrintabilityCaptureAttempt): Promise<void> {
    validateBasis(input);
    timestamp(input.recordedAt, "recordedAt");
    const fingerprint = normalize(input.captureFingerprint);
    await assertCaptureIntegrity(input.canonicalCaptureText, fingerprint);
    const existing = await this.required(input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new PrintabilityRunIllegalTransitionError("completed", "capture-recorded");
    }
    const next: Recorded = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      caseDigest: existing.caseDigest,
      dispatchedAt: existing.dispatchedAt,
      status: "capture-recorded",
      recordedAt: input.recordedAt,
      captureFingerprint: fingerprint,
      canonicalCaptureText: input.canonicalCaptureText,
    };
    if (existing.status === "capture-recorded") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new Error(
          "Printability capture-recorded WAL conflicts with exact capture.",
        );
      }
      return;
    }
    await replace(
      this.pathFor(input.projectId, input.runId, input.caseDigest),
      `${deterministicJson(next)}\n`,
    );
  }

  async complete(input: CompletePrintabilityRunAttempt): Promise<void> {
    validateBasis(input);
    timestamp(input.completedAt, "completedAt");
    const existing = await this.required(input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new PrintabilityRunIllegalTransitionError("dispatched", "completed");
    }
    const fingerprint = normalize(input.captureFingerprint);
    if (
      deterministicJson(existing.captureFingerprint) !== deterministicJson(fingerprint)
    ) throw new Error("Printability completion conflicts with recorded capture.");
    const next: Completed = {
      ...existing,
      status: "completed",
      completedAt: input.completedAt,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new Error("Completed printability WAL conflicts with existing record.");
      }
      return;
    }
    await replace(
      this.pathFor(input.projectId, input.runId, input.caseDigest),
      `${deterministicJson(next)}\n`,
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
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([projectId, runId, caseDigest]))
    }.json`;
  }
  private async required(input: BeginPrintabilityRunAttempt): Promise<ReadAttempt> {
    try {
      const value = await this.readExisting(
        input.projectId,
        input.runId,
        input.caseDigest,
      );
      if (!value) throw new Error("missing");
      assertBasis(value, input);
      return value;
    } catch {
      throw new PrintabilityRunOutcomeUnknownError();
    }
  }
  private async readExisting(
    projectId: string,
    runId: string,
    caseDigest: string,
  ): Promise<ReadAttempt | undefined> {
    try {
      return await parse(
        await Deno.readTextFile(this.pathFor(projectId, runId, caseDigest)),
        { projectId, runId, caseDigest },
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}

function actionFor(existing: ReadAttempt): BeginPrintabilityRunAttemptResult {
  if (existing.schemaVersion === LEGACY_SCHEMA) {
    if (existing.status === "dispatched" || !existing.captureFingerprint) {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    return { action: "completed", captureFingerprint: existing.captureFingerprint };
  }
  if (existing.status === "dispatched") throw new PrintabilityRunOutcomeUnknownError();
  return existing.status === "capture-recorded"
    ? {
      action: "capture-recorded",
      recordedAt: existing.recordedAt,
      captureFingerprint: existing.captureFingerprint,
      canonicalCaptureText: existing.canonicalCaptureText,
    }
    : {
      action: "completed",
      recordedAt: existing.recordedAt,
      captureFingerprint: existing.captureFingerprint,
      canonicalCaptureText: existing.canonicalCaptureText,
    };
}
async function parse(
  text: string,
  expected: Pick<Basis, "projectId" | "runId" | "caseDigest">,
): Promise<ReadAttempt> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Printability WAL is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Printability WAL must be object.");
  }
  const r = value as Record<string, unknown>;
  if (
    r.projectId !== expected.projectId || r.runId !== expected.runId ||
    r.caseDigest !== expected.caseDigest || typeof r.dispatchedAt !== "string"
  ) throw new Error("Printability WAL has foreign identity.");
  timestamp(r.dispatchedAt, "dispatchedAt");
  if (r.schemaVersion === LEGACY_SCHEMA) {
    if (r.status !== "dispatched" && r.status !== "completed") {
      throw new Error("Legacy printability WAL status invalid.");
    }
    if (
      r.status === "completed" &&
      (!isFingerprint(r.captureFingerprint) || typeof r.completedAt !== "string")
    ) throw new Error("Legacy printability completion invalid.");
    return {
      schemaVersion: LEGACY_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      caseDigest: expected.caseDigest,
      dispatchedAt: r.dispatchedAt,
      status: r.status,
      ...(r.status === "completed"
        ? {
          completedAt: r.completedAt as string,
          captureFingerprint: normalize(r.captureFingerprint as ContentFingerprint),
        }
        : {}),
    };
  }
  if (
    r.schemaVersion !== PRINTABILITY_RUN_ATTEMPT_SCHEMA ||
    (r.status !== "dispatched" && r.status !== "capture-recorded" &&
      r.status !== "completed")
  ) throw new Error("Printability WAL schema/status invalid.");
  const common: Basis = {
    projectId: expected.projectId,
    runId: expected.runId,
    caseDigest: expected.caseDigest,
    dispatchedAt: r.dispatchedAt,
  };
  if (r.status === "dispatched") {
    exactKeys(r, [
      "caseDigest",
      "dispatchedAt",
      "projectId",
      "runId",
      "schemaVersion",
      "status",
    ]);
    return {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      ...common,
      status: "dispatched",
    };
  }
  exactKeys(
    r,
    r.status === "completed"
      ? [
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
      ]
      : [
        "canonicalCaptureText",
        "captureFingerprint",
        "caseDigest",
        "dispatchedAt",
        "projectId",
        "recordedAt",
        "runId",
        "schemaVersion",
        "status",
      ],
  );
  if (
    !isFingerprint(r.captureFingerprint) ||
    typeof r.canonicalCaptureText !== "string" || typeof r.recordedAt !== "string"
  ) throw new Error("Printability capture-recorded WAL invalid.");
  timestamp(r.recordedAt, "recordedAt");
  const captureFingerprint = normalize(r.captureFingerprint);
  const canonicalCaptureText = r.canonicalCaptureText;
  await assertCaptureIntegrity(canonicalCaptureText, captureFingerprint);
  if (r.status === "completed") {
    if (typeof r.completedAt !== "string") {
      throw new Error("Completed printability WAL missing completedAt.");
    }
    timestamp(r.completedAt, "completedAt");
    return {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      ...common,
      status: "completed",
      recordedAt: r.recordedAt,
      completedAt: r.completedAt,
      captureFingerprint,
      canonicalCaptureText,
    };
  }
  return {
    schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
    ...common,
    status: "capture-recorded",
    recordedAt: r.recordedAt,
    captureFingerprint,
    canonicalCaptureText,
  };
}
async function assertCaptureIntegrity(
  text: string,
  fingerprint: ContentFingerprint,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("WAL capture text is not JSON.");
  }
  if (deterministicJson(value) !== text) {
    throw new Error("WAL capture text is not canonical JSON.");
  }
  if (
    deterministicJson(await sha256Fingerprint(value)) !== deterministicJson(fingerprint)
  ) throw new Error("WAL capture text fingerprint is not exact.");
}
function assertBasis(existing: Basis, input: BeginPrintabilityRunAttempt): void {
  if (existing.dispatchedAt !== input.dispatchedAt) {
    throw new PrintabilityRunOutcomeUnknownError();
  }
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new Error("Printability WAL has unsupported fields.");
  }
}
function isFingerprint(value: unknown): value is ContentFingerprint {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).algorithm === "sha256" &&
    typeof (value as Record<string, unknown>).digest === "string" &&
    SHA256_HEX.test((value as Record<string, unknown>).digest as string);
}
function normalize(value: ContentFingerprint): ContentFingerprint {
  if (!isFingerprint(value)) throw new TypeError("captureFingerprint must be sha256.");
  return { algorithm: "sha256", digest: value.digest };
}
function validateBasis(input: BeginPrintabilityRunAttempt): void {
  validateIdentity(input.projectId, input.runId, input.caseDigest);
  timestamp(input.dispatchedAt, "dispatchedAt");
}
function validateIdentity(projectId: string, runId: string, caseDigest: string): void {
  if (!projectId.trim() || !runId.trim() || !SHA256_HEX.test(caseDigest)) {
    throw new TypeError("Printability WAL identity is invalid.");
  }
}
function timestamp(value: string, label: string): void {
  if (
    typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) throw new TypeError(`${label} must be canonical ISO timestamp.`);
}
async function writeNew(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await writeAll(file, new TextEncoder().encode(text));
    await file.syncData();
  } finally {
    file.close();
  }
  await syncDirectory(directoryOf(path));
}
async function replace(path: string, text: string): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeNew(temporary, text);
    await Deno.rename(temporary, path);
    await syncDirectory(directoryOf(path));
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

/** Write every byte: Deno.File.write is permitted to make partial progress. */
export async function writeAll(
  file: Pick<Deno.FsFile, "write">,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const count = await file.write(bytes.subarray(offset));
    if (count <= 0) throw new Error("Printability WAL write made no progress.");
    offset += count;
  }
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : index === 0 ? "/" : path.slice(0, index);
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await Deno.open(path, { read: true });
  try {
    await directory.sync();
  } finally {
    directory.close();
  }
}
