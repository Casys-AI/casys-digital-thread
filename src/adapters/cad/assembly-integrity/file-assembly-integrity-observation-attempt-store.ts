/**
 * Durable dispatch journal for `verify.observe-assembly-integrity@1`.
 *
 * dispatched -> capture-recorded -> completed
 *
 * A provider call is never retried automatically once `dispatched` is durable.
 * The caller must surface the outcome as unknown until an explicit recovery
 * path exists; a fresh call could duplicate an externally observed request.
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

export const ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA =
  "assembly-integrity-observation-attempt/1.0" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const NO_WRITE_PROGRESS =
  "Assembly-integrity observation attempt journal made no write progress.";

export type AssemblyIntegrityObservationAttempt =
  | {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA;
    readonly status: "dispatched";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA;
    readonly status: "capture-recorded";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }
  | {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA;
    readonly status: "completed";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
    readonly recordedAt: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  };

export class AssemblyIntegrityObservationRunOutcomeUnknownError extends Error {
  constructor(
    message =
      "The assembly-integrity provider outcome is unknown and will not be retried automatically.",
  ) {
    super(message);
    this.name = "AssemblyIntegrityObservationRunOutcomeUnknownError";
  }
}

export class AssemblyIntegrityObservationAttemptIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal assembly-integrity observation WAL transition: ${from} -> ${to}.`);
    this.name = "AssemblyIntegrityObservationAttemptIllegalTransitionError";
  }
}

export class FileAssemblyIntegrityObservationAttemptStore {
  constructor(
    private readonly directory = "state/local/assembly-integrity-observation-attempts",
  ) {}

  async begin(input: AttemptBasis): Promise<AttemptBeginResult> {
    const basis = validateBasis(input);
    await Deno.mkdir(this.directory, { recursive: true });
    let current: AssemblyIntegrityObservationAttempt | undefined;
    try {
      current = await this.read(basis.projectId, basis.runId);
    } catch {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
    }
    if (current) return actionFor(current, basis.planDigest);

    const fresh: Extract<AssemblyIntegrityObservationAttempt, {
      status: "dispatched";
    }> = {
      schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      status: "dispatched",
      ...basis,
    };
    try {
      await writeNewAttemptFileDurably(
        this.#path(basis.projectId, basis.runId),
        `${deterministicJson(fresh)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    return actionFor(
      await this.required(basis.projectId, basis.runId),
      basis.planDigest,
    );
  }

  async recordCapture(input: AttemptCaptureRecord): Promise<void> {
    const identity = validateIdentity(input);
    validateFingerprint(input.captureFingerprint, "captureFingerprint");
    const existing = await this.required(identity.projectId, identity.runId);
    if (existing.planDigest !== identity.planDigest) {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new AssemblyIntegrityObservationAttemptIllegalTransitionError(
        "completed",
        "capture-recorded",
      );
    }
    const next: Extract<AssemblyIntegrityObservationAttempt, {
      status: "capture-recorded";
    }> = {
      schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      status: "capture-recorded",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      dispatchedAt: existing.dispatchedAt,
      recordedAt: nonEmptyText(input.recordedAt, "$attempt.recordedAt"),
      captureFingerprint: input.captureFingerprint,
      canonicalCaptureText: nonEmptyText(
        input.canonicalCaptureText,
        "$attempt.canonicalCaptureText",
      ),
    };
    if (existing.status === "capture-recorded") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
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

  async complete(input: AttemptCompletion): Promise<void> {
    const identity = validateIdentity(input);
    validateFingerprint(input.captureFingerprint, "captureFingerprint");
    const existing = await this.required(identity.projectId, identity.runId);
    if (existing.planDigest !== identity.planDigest) {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new AssemblyIntegrityObservationAttemptIllegalTransitionError(
        "dispatched",
        "completed",
      );
    }
    const next: Extract<AssemblyIntegrityObservationAttempt, {
      status: "completed";
    }> = {
      schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      status: "completed",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      dispatchedAt: existing.dispatchedAt,
      recordedAt: existing.recordedAt,
      completedAt: nonEmptyText(input.completedAt, "$attempt.completedAt"),
      captureFingerprint: input.captureFingerprint,
      canonicalCaptureText: existing.canonicalCaptureText,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
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

  async inspect(input: AttemptIdentity): Promise<AttemptInspectResult> {
    const identity = validateIdentity(input);
    let current: AssemblyIntegrityObservationAttempt | undefined;
    try {
      current = await this.read(identity.projectId, identity.runId);
    } catch {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
    }
    if (!current) return { action: "absent" };
    if (current.planDigest !== identity.planDigest) {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
    }
    if (current.status === "dispatched") return { action: "dispatched" };
    return {
      action: current.status,
      recordedAt: current.recordedAt,
      captureFingerprint: current.captureFingerprint,
      canonicalCaptureText: current.canonicalCaptureText,
    };
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<AssemblyIntegrityObservationAttempt | undefined> {
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
  ): Promise<AssemblyIntegrityObservationAttempt> {
    const key = validateKey(projectId, runId);
    try {
      const current = await this.read(key.projectId, key.runId);
      if (!current) throw new Error("missing attempt");
      return current;
    } catch {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
    }
  }

  #path(projectId: string, runId: string): string {
    return `${this.directory}/${projectId}__${runId}.json`;
  }
}

interface AttemptBasis {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly dispatchedAt: string;
}

interface AttemptIdentity {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
}

interface AttemptCaptureRecord extends AttemptIdentity {
  readonly recordedAt: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly canonicalCaptureText: string;
}

interface AttemptCompletion extends AttemptIdentity {
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}

type AttemptBeginResult =
  | { readonly action: "dispatch" }
  | {
    readonly action: "capture-recorded" | "completed";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  };

type AttemptInspectResult =
  | { readonly action: "absent" }
  | { readonly action: "dispatched" }
  | {
    readonly action: "capture-recorded" | "completed";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  };

function actionFor(
  current: AssemblyIntegrityObservationAttempt,
  planDigest: string,
): AttemptBeginResult {
  if (current.planDigest !== planDigest || current.status === "dispatched") {
    throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
  }
  return {
    action: current.status,
    recordedAt: current.recordedAt,
    captureFingerprint: current.captureFingerprint,
    canonicalCaptureText: current.canonicalCaptureText,
  };
}

function parseAttempt(value: unknown): AssemblyIntegrityObservationAttempt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("assembly-integrity observation attempt must be an object.");
  }
  const status = (value as { status?: unknown }).status;
  if (status === "dispatched") {
    const root = exactRecord(value, [
      "schemaVersion",
      "status",
      "projectId",
      "runId",
      "planDigest",
      "dispatchedAt",
    ], "$assemblyIntegrityObservationAttempt");
    literalValue(
      root.schemaVersion,
      ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      "$assemblyIntegrityObservationAttempt.schemaVersion",
    );
    return {
      schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      status: "dispatched",
      ...parseBasisRecord(root),
    };
  }
  if (status === "capture-recorded" || status === "completed") {
    const root = exactRecord(value, [
      "schemaVersion",
      "status",
      "projectId",
      "runId",
      "planDigest",
      "dispatchedAt",
      "recordedAt",
      "captureFingerprint",
      "canonicalCaptureText",
      ...(status === "completed" ? ["completedAt"] : []),
    ], "$assemblyIntegrityObservationAttempt");
    literalValue(
      root.schemaVersion,
      ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      "$assemblyIntegrityObservationAttempt.schemaVersion",
    );
    const common = {
      ...parseBasisRecord(root),
      recordedAt: nonEmptyText(
        root.recordedAt,
        "$assemblyIntegrityObservationAttempt.recordedAt",
      ),
      captureFingerprint: parseFingerprint(
        root.captureFingerprint,
        "$assemblyIntegrityObservationAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$assemblyIntegrityObservationAttempt.canonicalCaptureText",
      ),
    };
    if (status === "capture-recorded") {
      return {
        schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
        status,
        ...common,
      };
    }
    return {
      schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_SCHEMA,
      status,
      ...common,
      completedAt: nonEmptyText(
        root.completedAt,
        "$assemblyIntegrityObservationAttempt.completedAt",
      ),
    };
  }
  throw new TypeError(
    "assembly-integrity observation attempt has an unsupported status.",
  );
}

function parseBasisRecord(value: Record<string, unknown>): AttemptBasis {
  return {
    projectId: safeId(
      value.projectId,
      "$assemblyIntegrityObservationAttempt.projectId",
    ),
    runId: safeId(value.runId, "$assemblyIntegrityObservationAttempt.runId"),
    planDigest: hex64(
      value.planDigest,
      "$assemblyIntegrityObservationAttempt.planDigest",
    ),
    dispatchedAt: nonEmptyText(
      value.dispatchedAt,
      "$assemblyIntegrityObservationAttempt.dispatchedAt",
    ),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: hex64(root.digest, `${path}.digest`) };
}

function validateBasis(value: AttemptBasis): AttemptBasis {
  return {
    ...validateIdentity(value),
    dispatchedAt: nonEmptyText(value.dispatchedAt, "$attempt.dispatchedAt"),
  };
}

function validateIdentity(value: AttemptIdentity): AttemptIdentity {
  return {
    ...validateKey(value.projectId, value.runId),
    planDigest: hex64(value.planDigest, "$attempt.planDigest"),
  };
}

function validateKey(
  projectId: unknown,
  runId: unknown,
): Pick<AttemptIdentity, "projectId" | "runId"> {
  return {
    projectId: safeId(projectId, "$attempt.projectId"),
    runId: safeId(runId, "$attempt.runId"),
  };
}

function validateFingerprint(value: ContentFingerprint, path: string): void {
  if (value.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must equal sha256.`);
  }
  hex64(value.digest, `${path}.digest`);
}

function hex64(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
