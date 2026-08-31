/**
 * Durable local journal for `verify.evaluate-assembly-integrity@1`.
 *
 * started -> capture-recorded -> completed
 *
 * Unlike the L3 provider adapter, this L4 method has no external effect.  A
 * durable `started` record can therefore be deterministically recrossed on a
 * retry; once a capture is recorded, recovery must reuse its exact canonical
 * bytes rather than silently replace them.
 */

import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA =
  "assembly-integrity-evaluation-attempt/1.0" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const NO_WRITE_PROGRESS =
  "Assembly-integrity evaluation attempt journal made no write progress.";

export type AssemblyIntegrityEvaluationAttempt =
  | {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA;
    readonly status: "started";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly startedAt: string;
  }
  | {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA;
    readonly status: "capture-recorded";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly startedAt: string;
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }
  | {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA;
    readonly status: "completed";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly startedAt: string;
    readonly recordedAt: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  };

export class AssemblyIntegrityEvaluationAttemptConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyIntegrityEvaluationAttemptConflictError";
  }
}

export class AssemblyIntegrityEvaluationAttemptIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal assembly-integrity evaluation WAL transition: ${from} -> ${to}.`);
    this.name = "AssemblyIntegrityEvaluationAttemptIllegalTransitionError";
  }
}

export type AssemblyIntegrityEvaluationAttemptBeginResult =
  | { readonly action: "evaluate" }
  | {
    readonly action: "capture-recorded" | "completed";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  };

export class FileAssemblyIntegrityEvaluationAttemptStore {
  constructor(
    private readonly directory = "state/local/assembly-integrity-evaluation-attempts",
  ) {}

  async begin(input: AssemblyIntegrityEvaluationAttemptBasis): Promise<
    AssemblyIntegrityEvaluationAttemptBeginResult
  > {
    const basis = validateBasis(input);
    await Deno.mkdir(this.directory, { recursive: true });
    let existing: AssemblyIntegrityEvaluationAttempt | undefined;
    try {
      existing = await this.read(basis.projectId, basis.runId);
    } catch {
      throw new AssemblyIntegrityEvaluationAttemptConflictError(
        "The existing L4 attempt journal is unreadable; its exact state cannot be inferred.",
      );
    }
    if (existing) return actionFor(existing, basis.planDigest);
    const fresh: Extract<AssemblyIntegrityEvaluationAttempt, { status: "started" }> = {
      schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
      status: "started",
      ...basis,
    };
    try {
      await writeNewAttemptFileDurably(
        this.#path(basis.projectId, basis.runId),
        `${deterministicJson(fresh)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
      return { action: "evaluate" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    return actionFor(
      await this.required(basis.projectId, basis.runId),
      basis.planDigest,
    );
  }

  async recordCapture(
    input: AssemblyIntegrityEvaluationAttemptCaptureRecord,
  ): Promise<void> {
    const identity = validateIdentity(input);
    const captureFingerprint = validateFingerprint(
      input.captureFingerprint,
      "$assemblyIntegrityEvaluationAttempt.captureFingerprint",
    );
    const canonicalCaptureText = nonEmptyText(
      input.canonicalCaptureText,
      "$assemblyIntegrityEvaluationAttempt.canonicalCaptureText",
    );
    const existing = await this.required(identity.projectId, identity.runId);
    assertPlan(existing, identity.planDigest);
    if (existing.status === "completed") {
      throw new AssemblyIntegrityEvaluationAttemptIllegalTransitionError(
        "completed",
        "capture-recorded",
      );
    }
    const next: Extract<AssemblyIntegrityEvaluationAttempt, {
      status: "capture-recorded";
    }> = {
      schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
      status: "capture-recorded",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      startedAt: existing.startedAt,
      recordedAt: isoInstant(
        input.recordedAt,
        "$assemblyIntegrityEvaluationAttempt.recordedAt",
      ),
      captureFingerprint,
      canonicalCaptureText,
    };
    if (existing.status === "capture-recorded") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new AssemblyIntegrityEvaluationAttemptConflictError(
          "The L4 attempt already records a different canonical capture.",
        );
      }
      return;
    }
    await replaceAttemptFileDurably(
      this.#path(existing.projectId, existing.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      NO_WRITE_PROGRESS,
    );
  }

  async complete(input: AssemblyIntegrityEvaluationAttemptCompletion): Promise<void> {
    const identity = validateIdentity(input);
    const captureFingerprint = validateFingerprint(
      input.captureFingerprint,
      "$assemblyIntegrityEvaluationAttempt.captureFingerprint",
    );
    const existing = await this.required(identity.projectId, identity.runId);
    assertPlan(existing, identity.planDigest);
    if (existing.status === "started") {
      throw new AssemblyIntegrityEvaluationAttemptIllegalTransitionError(
        "started",
        "completed",
      );
    }
    const next: Extract<AssemblyIntegrityEvaluationAttempt, { status: "completed" }> = {
      schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
      status: "completed",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      startedAt: existing.startedAt,
      recordedAt: existing.recordedAt,
      completedAt: isoInstant(
        input.completedAt,
        "$assemblyIntegrityEvaluationAttempt.completedAt",
      ),
      captureFingerprint,
      canonicalCaptureText: existing.canonicalCaptureText,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new AssemblyIntegrityEvaluationAttemptConflictError(
          "The completed L4 attempt does not match this exact capture identity.",
        );
      }
      return;
    }
    await replaceAttemptFileDurably(
      this.#path(existing.projectId, existing.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      NO_WRITE_PROGRESS,
    );
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<AssemblyIntegrityEvaluationAttempt | undefined> {
    const key = validateKey(projectId, runId);
    try {
      return parseAttempt(
        JSON.parse(await Deno.readTextFile(this.#path(key.projectId, key.runId))),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async required(
    projectId: string,
    runId: string,
  ): Promise<AssemblyIntegrityEvaluationAttempt> {
    try {
      const attempt = await this.read(projectId, runId);
      if (!attempt) throw new Error("missing L4 attempt");
      return attempt;
    } catch {
      throw new AssemblyIntegrityEvaluationAttemptConflictError(
        "The L4 attempt journal is missing or unreadable.",
      );
    }
  }

  #path(projectId: string, runId: string): string {
    return `${this.directory}/${projectId}__${runId}.json`;
  }
}

export interface AssemblyIntegrityEvaluationAttemptBasis {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly startedAt: string;
}

export interface AssemblyIntegrityEvaluationAttemptCaptureRecord extends
  Pick<
    AssemblyIntegrityEvaluationAttemptBasis,
    "projectId" | "runId" | "planDigest"
  > {
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
}

export interface AssemblyIntegrityEvaluationAttemptCompletion extends
  Pick<
    AssemblyIntegrityEvaluationAttemptBasis,
    "projectId" | "runId" | "planDigest"
  > {
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}

function actionFor(
  existing: AssemblyIntegrityEvaluationAttempt,
  planDigest: string,
): AssemblyIntegrityEvaluationAttemptBeginResult {
  assertPlan(existing, planDigest);
  if (existing.status === "started") return { action: "evaluate" };
  return {
    action: existing.status,
    recordedAt: existing.recordedAt,
    captureFingerprint: existing.captureFingerprint,
    canonicalCaptureText: existing.canonicalCaptureText,
  };
}

function assertPlan(
  attempt: AssemblyIntegrityEvaluationAttempt,
  planDigest: string,
): void {
  if (
    attempt.planDigest !==
      hex64(planDigest, "$assemblyIntegrityEvaluationAttempt.planDigest")
  ) {
    throw new AssemblyIntegrityEvaluationAttemptConflictError(
      "The L4 attempt journal belongs to a different sealed plan.",
    );
  }
}

function parseAttempt(value: unknown): AssemblyIntegrityEvaluationAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Assembly-integrity evaluation attempt must be an object.");
  }
  const status = (value as { readonly status?: unknown }).status;
  if (status === "started") {
    const root = exactRecord(value, [
      "schemaVersion",
      "status",
      "projectId",
      "runId",
      "planDigest",
      "startedAt",
    ], "$assemblyIntegrityEvaluationAttempt");
    literalValue(
      root.schemaVersion,
      ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
      "$assemblyIntegrityEvaluationAttempt.schemaVersion",
    );
    return {
      schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
      status: "started",
      ...parseBasis(root),
    };
  }
  if (status !== "capture-recorded" && status !== "completed") {
    throw new TypeError(
      "Assembly-integrity evaluation attempt has an unsupported status.",
    );
  }
  const root = exactRecord(value, [
    "schemaVersion",
    "status",
    "projectId",
    "runId",
    "planDigest",
    "startedAt",
    "recordedAt",
    "captureFingerprint",
    "canonicalCaptureText",
    ...(status === "completed" ? ["completedAt"] : []),
  ], "$assemblyIntegrityEvaluationAttempt");
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
    "$assemblyIntegrityEvaluationAttempt.schemaVersion",
  );
  const common = {
    ...parseBasis(root),
    recordedAt: isoInstant(
      root.recordedAt,
      "$assemblyIntegrityEvaluationAttempt.recordedAt",
    ),
    captureFingerprint: parseFingerprint(
      root.captureFingerprint,
      "$assemblyIntegrityEvaluationAttempt.captureFingerprint",
    ),
    canonicalCaptureText: nonEmptyText(
      root.canonicalCaptureText,
      "$assemblyIntegrityEvaluationAttempt.canonicalCaptureText",
    ),
  };
  if (status === "capture-recorded") {
    return {
      schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
      status,
      ...common,
    };
  }
  return {
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_SCHEMA,
    status,
    ...common,
    completedAt: isoInstant(
      root.completedAt,
      "$assemblyIntegrityEvaluationAttempt.completedAt",
    ),
  };
}

function parseBasis(
  value: Record<string, unknown>,
): AssemblyIntegrityEvaluationAttemptBasis {
  return {
    projectId: safeId(value.projectId, "$assemblyIntegrityEvaluationAttempt.projectId"),
    runId: safeId(value.runId, "$assemblyIntegrityEvaluationAttempt.runId"),
    planDigest: hex64(
      value.planDigest,
      "$assemblyIntegrityEvaluationAttempt.planDigest",
    ),
    startedAt: isoInstant(
      value.startedAt,
      "$assemblyIntegrityEvaluationAttempt.startedAt",
    ),
  };
}

function validateBasis(
  value: AssemblyIntegrityEvaluationAttemptBasis,
): AssemblyIntegrityEvaluationAttemptBasis {
  return {
    ...validateIdentity(value),
    startedAt: isoInstant(
      value.startedAt,
      "$assemblyIntegrityEvaluationAttempt.startedAt",
    ),
  };
}

function validateIdentity(value: {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
}): Pick<
  AssemblyIntegrityEvaluationAttemptBasis,
  "projectId" | "runId" | "planDigest"
> {
  return {
    ...validateKey(value.projectId, value.runId),
    planDigest: hex64(
      value.planDigest,
      "$assemblyIntegrityEvaluationAttempt.planDigest",
    ),
  };
}

function validateKey(
  projectId: unknown,
  runId: unknown,
): Pick<AssemblyIntegrityEvaluationAttemptBasis, "projectId" | "runId"> {
  return {
    projectId: safeId(projectId, "$assemblyIntegrityEvaluationAttempt.projectId"),
    runId: safeId(runId, "$assemblyIntegrityEvaluationAttempt.runId"),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: hex64(root.digest, `${path}.digest`) };
}

function validateFingerprint(
  value: ContentFingerprint,
  path: string,
): ContentFingerprint {
  if (value.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must equal sha256.`);
  }
  return { algorithm: "sha256", digest: hex64(value.digest, `${path}.digest`) };
}

function isoInstant(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result
  ) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 instant.`);
  }
  return result;
}

function hex64(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
