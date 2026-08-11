/** Durable three-state WAL for one non-idempotent Prusa observation. */
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";

export const PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA =
  "print-estimate-run-attempt/1.1" as const;
const LEGACY_SCHEMA = "print-estimate-run-attempt/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
type Basis = {
  readonly projectId: string;
  readonly runId: string;
  readonly caseDigest: string;
  readonly dispatchedAt: string;
};
type Current =
  & Basis
  & ({
    readonly schemaVersion: typeof PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA;
    readonly status: "dispatched";
  } | {
    readonly schemaVersion: typeof PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA;
    readonly status: "capture-recorded";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  } | {
    readonly schemaVersion: typeof PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA;
    readonly status: "completed";
    readonly recordedAt: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  });
type Legacy = Basis & {
  readonly schemaVersion: typeof LEGACY_SCHEMA;
  readonly status: "dispatched" | "completed";
  readonly completedAt?: string;
  readonly captureFingerprint?: ContentFingerprint;
};
type Stored = Current | Legacy;

export interface BeginPrintEstimateRunAttempt extends Basis {}
export interface RecordPrintEstimateCaptureAttempt
  extends BeginPrintEstimateRunAttempt {
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
}
export interface CompletePrintEstimateRunAttempt extends BeginPrintEstimateRunAttempt {
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}
export type BeginPrintEstimateRunAttemptResult = { readonly action: "dispatch" } | {
  readonly action: "capture-recorded";
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
} | {
  readonly action: "completed";
  readonly recordedAt?: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText?: string;
};

/** A prior provider occurrence is never a permit to invoke it again. */
export class PrintEstimateRunOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The print-estimate provider outcome is unknown and will not be retried automatically.",
    );
    this.name = "PrintEstimateRunOutcomeUnknownError";
  }
}
export class PrintEstimateRunIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal print-estimate WAL transition: ${from} -> ${to}.`);
    this.name = "PrintEstimateRunIllegalTransitionError";
  }
}

export class FileCm01DripTrayPrintEstimateAttemptStore {
  constructor(
    private readonly directory = "state/local/cm01-drip-tray-print-estimate-attempts",
  ) {}
  async begin(
    input: BeginPrintEstimateRunAttempt,
  ): Promise<BeginPrintEstimateRunAttemptResult> {
    validateBasis(input);
    const fresh: Current = {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
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
    let existing: Stored | undefined;
    try {
      existing = await this.readExisting(
        input.projectId,
        input.runId,
        input.caseDigest,
      );
    } catch {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
    if (!existing) throw new PrintEstimateRunOutcomeUnknownError();
    assertBasis(existing, input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      if (existing.status === "dispatched" || !existing.captureFingerprint) {
        throw new PrintEstimateRunOutcomeUnknownError();
      }
      return { action: "completed", captureFingerprint: existing.captureFingerprint };
    }
    if (existing.status === "dispatched") {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
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
  async recordCapture(input: RecordPrintEstimateCaptureAttempt): Promise<void> {
    validateBasis(input);
    timestamp(input.recordedAt, "recordedAt");
    const fingerprint = normalize(input.captureFingerprint);
    await assertCaptureIntegrity(input.canonicalCaptureText, fingerprint);
    const existing = await this.required(input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new PrintEstimateRunIllegalTransitionError("completed", "capture-recorded");
    }
    const next: Current = {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
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
          "Print-estimate capture-recorded WAL conflicts with exact capture.",
        );
      }
      return;
    }
    await replace(
      this.pathFor(input.projectId, input.runId, input.caseDigest),
      `${deterministicJson(next)}\n`,
    );
  }
  async complete(input: CompletePrintEstimateRunAttempt): Promise<void> {
    validateBasis(input);
    timestamp(input.completedAt, "completedAt");
    const existing = await this.required(input);
    if (existing.schemaVersion === LEGACY_SCHEMA) {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new PrintEstimateRunIllegalTransitionError("dispatched", "completed");
    }
    const fingerprint = normalize(input.captureFingerprint);
    if (
      deterministicJson(existing.captureFingerprint) !== deterministicJson(fingerprint)
    ) throw new Error("Print-estimate completion conflicts with recorded capture.");
    const next: Current = {
      ...existing,
      status: "completed",
      completedAt: input.completedAt,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new Error("Completed print-estimate WAL conflicts with existing record.");
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
  ): Promise<Stored | undefined> {
    validateIdentity(projectId, runId, caseDigest);
    return await this.readExisting(projectId, runId, caseDigest);
  }
  pathFor(projectId: string, runId: string, caseDigest: string): string {
    validateIdentity(projectId, runId, caseDigest);
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([projectId, runId, caseDigest]))
    }.json`;
  }
  private async required(input: BeginPrintEstimateRunAttempt): Promise<Stored> {
    try {
      const stored = await this.readExisting(
        input.projectId,
        input.runId,
        input.caseDigest,
      );
      if (!stored) throw new Error("missing");
      assertBasis(stored, input);
      return stored;
    } catch {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
  }
  private async readExisting(
    projectId: string,
    runId: string,
    caseDigest: string,
  ): Promise<Stored | undefined> {
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
async function parse(
  text: string,
  expected: Pick<Basis, "projectId" | "runId" | "caseDigest">,
): Promise<Stored> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Print-estimate WAL is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Print-estimate WAL must be object.");
  }
  const r = value as Record<string, unknown>;
  if (
    r.projectId !== expected.projectId || r.runId !== expected.runId ||
    r.caseDigest !== expected.caseDigest || typeof r.dispatchedAt !== "string"
  ) throw new Error("Print-estimate WAL has foreign identity.");
  timestamp(r.dispatchedAt, "dispatchedAt");
  const basis: Basis = { ...expected, dispatchedAt: r.dispatchedAt };
  if (r.schemaVersion === LEGACY_SCHEMA) {
    if (r.status !== "dispatched" && r.status !== "completed") {
      throw new Error("Legacy print-estimate WAL status invalid.");
    }
    if (
      r.status === "completed" &&
      (!isFingerprint(r.captureFingerprint) || typeof r.completedAt !== "string")
    ) throw new Error("Legacy print-estimate completion invalid.");
    return {
      schemaVersion: LEGACY_SCHEMA,
      ...basis,
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
    r.schemaVersion !== PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA ||
    !["dispatched", "capture-recorded", "completed"].includes(String(r.status))
  ) throw new Error("Print-estimate WAL schema/status invalid.");
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
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      ...basis,
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
  ) throw new Error("Print-estimate capture-recorded WAL invalid.");
  timestamp(r.recordedAt, "recordedAt");
  const captureFingerprint = normalize(r.captureFingerprint);
  await assertCaptureIntegrity(r.canonicalCaptureText, captureFingerprint);
  if (r.status === "completed") {
    if (typeof r.completedAt !== "string") {
      throw new Error("Completed print-estimate WAL missing completedAt.");
    }
    timestamp(r.completedAt, "completedAt");
    return {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      ...basis,
      status: "completed",
      recordedAt: r.recordedAt,
      completedAt: r.completedAt,
      captureFingerprint,
      canonicalCaptureText: r.canonicalCaptureText,
    };
  }
  return {
    schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
    ...basis,
    status: "capture-recorded",
    recordedAt: r.recordedAt,
    captureFingerprint,
    canonicalCaptureText: r.canonicalCaptureText,
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
function assertBasis(existing: Basis, input: BeginPrintEstimateRunAttempt): void {
  if (existing.dispatchedAt !== input.dispatchedAt) {
    throw new PrintEstimateRunOutcomeUnknownError();
  }
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (deterministicJson(Object.keys(value).sort()) !== deterministicJson(expected)) {
    throw new Error("Print-estimate WAL has unsupported fields.");
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
function validateBasis(input: BeginPrintEstimateRunAttempt): void {
  validateIdentity(input.projectId, input.runId, input.caseDigest);
  timestamp(input.dispatchedAt, "dispatchedAt");
}
function validateIdentity(projectId: string, runId: string, caseDigest: string): void {
  if (!projectId.trim() || !runId.trim() || !SHA256_HEX.test(caseDigest)) {
    throw new TypeError("Print-estimate WAL identity is invalid.");
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
    if (count <= 0) throw new Error("Print-estimate WAL write made no progress.");
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
