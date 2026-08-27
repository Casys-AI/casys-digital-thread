/**
 * Composite WAL for analyze.run-fea-sensitivity@1.
 *
 * CAD slots: idle → dispatched → published, or dispatched →
 * output-validation-rejected. Solve slots: idle → dispatched →
 * solver-recorded (3-state CalculiX @1 analog). A dispatched solve without
 * solver-recorded is terminal: never re-dispatch.
 */

import {
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../../domain/kernel/case-validation.ts";
import { validateIsolatedCodeOutputValidationRejection } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const FEA_SENSITIVITY_ATTEMPT_SCHEMA = "fea-sensitivity-attempt/1.0" as const;

export class FeaSensitivityOutcomeUnknownError extends Error {
  constructor(detail: string) {
    super(
      `The FEA sensitivity outcome is unknown and will not be retried automatically: ${detail}`,
    );
    this.name = "FeaSensitivityOutcomeUnknownError";
  }
}

export class FeaSensitivityIllegalTransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`Illegal FEA sensitivity WAL transition: ${from} → ${to}.`);
    this.name = "FeaSensitivityIllegalTransitionError";
  }
}

export type SensitivityCadSlot =
  | { readonly status: "idle" }
  | {
    readonly status: "dispatched";
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
  }
  | {
    readonly status: "published";
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
    readonly stepSha256: string;
    readonly stepBytes: number;
  }
  | {
    readonly status: "output-validation-rejected";
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
    readonly observation: {
      readonly role: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
    readonly destruction: {
      readonly status: "proven";
      readonly runId: string;
      readonly proofFingerprint: ContentFingerprint;
    };
  };

export type SensitivitySolveSlot =
  | { readonly status: "idle" }
  | {
    readonly status: "dispatched";
    readonly dispatchedAt: string;
    readonly stepSha256: string;
  }
  | {
    readonly status: "solver-recorded";
    readonly dispatchedAt: string;
    readonly stepSha256: string;
    readonly captureFp: string;
    readonly canonicalSolverCaptureText: string;
  };

export type SensitivityPhase = "base" | "stepped";

export interface FeaSensitivityAttempt {
  readonly schemaVersion: typeof FEA_SENSITIVITY_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly cad: {
    readonly base: SensitivityCadSlot;
    readonly stepped: SensitivityCadSlot;
  };
  readonly solves: {
    readonly base: SensitivitySolveSlot;
    readonly stepped: SensitivitySolveSlot;
  };
  readonly status: "in-progress" | "completed";
  readonly snapshot?: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
}

export class FileFeaSensitivityAttemptStore {
  constructor(
    private readonly directory = "state/local/fea-sensitivity-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<FeaSensitivityAttempt | undefined> {
    try {
      const text = await Deno.readTextFile(this.#path(projectId, runId));
      return parseAttempt(JSON.parse(text));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async prepare(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
  }): Promise<FeaSensitivityAttempt> {
    const existing = await this.read(input.projectId, input.runId);
    if (existing) {
      if (existing.planDigest !== input.planDigest) {
        throw new FeaSensitivityOutcomeUnknownError("planDigest mismatch");
      }
      return existing;
    }
    const attempt: FeaSensitivityAttempt = {
      schemaVersion: FEA_SENSITIVITY_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      planDigest: input.planDigest,
      cad: { base: { status: "idle" }, stepped: { status: "idle" } },
      solves: { base: { status: "idle" }, stepped: { status: "idle" } },
      status: "in-progress",
    };
    await Deno.mkdir(this.directory, { recursive: true });
    await writeNewAttemptFileDurably(
      this.#path(input.projectId, input.runId),
      `${deterministicJson(attempt)}\n`,
      this.directory,
      "FEA sensitivity WAL write made no progress.",
    );
    return attempt;
  }

  async markCadDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.cad[input.phase];
    if (slot.status === "published") return current;
    if (slot.status === "output-validation-rejected") {
      throw new FeaSensitivityIllegalTransitionError(
        slot.status,
        "dispatched",
      );
    }
    if (slot.status === "dispatched") {
      throw new FeaSensitivityOutcomeUnknownError(
        `cad.${input.phase} is dispatched without a published STEP`,
      );
    }
    return await this.#replace(current, {
      ...current,
      cad: {
        ...current.cad,
        [input.phase]: {
          status: "dispatched",
          executionRunId: input.executionRunId,
          dispatchedAt: input.dispatchedAt,
          sourceSha256: input.sourceSha256,
        },
      },
    });
  }

  async markCadPublished(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly stepSha256: string;
    readonly stepBytes: number;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.cad[input.phase];
    if (slot.status === "published") return current;
    if (slot.status !== "dispatched") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "published");
    }
    return await this.#replace(current, {
      ...current,
      cad: {
        ...current.cad,
        [input.phase]: {
          ...slot,
          status: "published",
          stepSha256: input.stepSha256,
          stepBytes: input.stepBytes,
        },
      },
    });
  }

  async markCadOutputValidationRejected(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly observation: {
      readonly role: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
    readonly destruction: {
      readonly status: "proven";
      readonly runId: string;
      readonly proofFingerprint: ContentFingerprint;
    };
    readonly registeredRoles: readonly string[];
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.cad[input.phase];
    const observation = validateIsolatedCodeOutputValidationRejection(
      input.observation,
    );
    if (!input.registeredRoles.includes(observation.role)) {
      throw new FeaSensitivityIllegalTransitionError(
        observation.role,
        "registered-output-role",
      );
    }
    if (slot.status === "idle" || slot.status === "published") {
      throw new FeaSensitivityIllegalTransitionError(
        slot.status,
        "output-validation-rejected",
      );
    }
    const destruction = validateProvenDestruction(
      input.destruction,
      slot.executionRunId,
    );
    const next: SensitivityCadSlot = {
      status: "output-validation-rejected",
      executionRunId: slot.executionRunId,
      dispatchedAt: slot.dispatchedAt,
      sourceSha256: slot.sourceSha256,
      observation,
      destruction,
    };
    if (slot.status === "output-validation-rejected") {
      if (deterministicJson(slot) === deterministicJson(next)) return current;
      throw new FeaSensitivityIllegalTransitionError(
        slot.status,
        "output-validation-rejected",
      );
    }
    return await this.#replace(current, {
      ...current,
      cad: {
        ...current.cad,
        [input.phase]: next,
      },
    });
  }

  async markSolveDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly dispatchedAt: string;
    readonly stepSha256: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    if (slot.status === "solver-recorded") return current;
    if (slot.status === "dispatched") {
      throw new FeaSensitivityOutcomeUnknownError(
        `solve.${input.phase} is dispatched without a recorded capture`,
      );
    }
    return await this.#replace(current, {
      ...current,
      solves: {
        ...current.solves,
        [input.phase]: {
          status: "dispatched",
          dispatchedAt: input.dispatchedAt,
          stepSha256: input.stepSha256,
        },
      },
    });
  }

  /**
   * A synchronous solver failure is a KNOWN outcome: the provider answered
   * with an error, no capture will ever arrive. Return the slot to idle so a
   * later resume may re-dispatch, instead of leaving a dispatched slot that
   * dead-ends every retry as unknown-outcome.
   */
  async markSolveFailed(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    if (slot.status === "idle") return current;
    if (slot.status !== "dispatched") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "idle");
    }
    return await this.#replace(current, {
      ...current,
      solves: {
        ...current.solves,
        [input.phase]: { status: "idle" },
      },
    });
  }

  async markSolveRecorded(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly captureFp: string;
    readonly canonicalSolverCaptureText: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    if (slot.status === "solver-recorded") return current;
    if (slot.status !== "dispatched") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "solver-recorded");
    }
    return await this.#replace(current, {
      ...current,
      solves: {
        ...current.solves,
        [input.phase]: {
          ...slot,
          status: "solver-recorded",
          captureFp: input.captureFp,
          canonicalSolverCaptureText: input.canonicalSolverCaptureText,
        },
      },
    });
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: FeaSensitivityAttempt["snapshot"];
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    if (current.status === "completed") return current;
    if (
      current.solves.base.status !== "solver-recorded" ||
      current.solves.stepped.status !== "solver-recorded"
    ) {
      throw new FeaSensitivityIllegalTransitionError(
        "in-progress",
        "completed",
      );
    }
    return await this.#replace(current, {
      ...current,
      status: "completed",
      snapshot: input.snapshot,
    });
  }

  async #required(projectId: string, runId: string): Promise<FeaSensitivityAttempt> {
    const attempt = await this.read(projectId, runId);
    if (!attempt) {
      throw new FeaSensitivityIllegalTransitionError("absent", "update");
    }
    return attempt;
  }

  async #replace(
    current: FeaSensitivityAttempt,
    next: FeaSensitivityAttempt,
  ): Promise<FeaSensitivityAttempt> {
    await replaceAttemptFileDurably(
      this.#path(current.projectId, current.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      "FEA sensitivity WAL write made no progress.",
    );
    return next;
  }

  #path(projectId: string, runId: string): string {
    const safe = `${projectId}__${runId}`.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    return `${this.directory.replace(/\/$/, "")}/${safe}.json`;
  }
}

function parseAttempt(value: unknown): FeaSensitivityAttempt {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "runId",
    "planDigest",
    "cad",
    "solves",
    "status",
    ...(value && typeof value === "object" && "snapshot" in value
      ? ["snapshot"] as const
      : []),
  ], "$feaSensitivityAttempt");
  literalValue(
    root.schemaVersion,
    FEA_SENSITIVITY_ATTEMPT_SCHEMA,
    "$feaSensitivityAttempt.schemaVersion",
  );
  const status = root.status;
  if (status !== "in-progress" && status !== "completed") {
    throw new TypeError("$feaSensitivityAttempt.status is not a known state.");
  }
  return {
    schemaVersion: FEA_SENSITIVITY_ATTEMPT_SCHEMA,
    projectId: nonEmptyText(root.projectId, "$feaSensitivityAttempt.projectId"),
    runId: nonEmptyText(root.runId, "$feaSensitivityAttempt.runId"),
    planDigest: nonEmptyText(root.planDigest, "$feaSensitivityAttempt.planDigest"),
    cad: parseCadPair(root.cad),
    solves: parseSolvePair(root.solves),
    status,
    ...(root.snapshot === undefined ? {} : {
      snapshot: parseSnapshot(root.snapshot),
    }),
  };
}

function parseCadPair(value: unknown): FeaSensitivityAttempt["cad"] {
  const pair = exactRecord(value, ["base", "stepped"], "$feaSensitivityAttempt.cad");
  return {
    base: parseCadSlot(pair.base, "base"),
    stepped: parseCadSlot(pair.stepped, "stepped"),
  };
}

function parseSolvePair(value: unknown): FeaSensitivityAttempt["solves"] {
  const pair = exactRecord(value, ["base", "stepped"], "$feaSensitivityAttempt.solves");
  return {
    base: parseSolveSlot(pair.base, "base"),
    stepped: parseSolveSlot(pair.stepped, "stepped"),
  };
}

function parseCadSlot(value: unknown, phase: string): SensitivityCadSlot {
  const path = `$feaSensitivityAttempt.cad.${phase}`;
  if (!value || typeof value !== "object") {
    throw new TypeError(`${path} must be an object.`);
  }
  const status = (value as { status?: unknown }).status;
  if (status === "idle") {
    exactRecord(value, ["status"], path);
    return { status: "idle" };
  }
  if (status === "dispatched") {
    const slot = exactRecord(value, [
      "status",
      "executionRunId",
      "dispatchedAt",
      "sourceSha256",
    ], path);
    return {
      status: "dispatched",
      executionRunId: nonEmptyText(slot.executionRunId, `${path}.executionRunId`),
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      sourceSha256: sha256Hex(slot.sourceSha256, `${path}.sourceSha256`),
    };
  }
  if (status === "published") {
    const slot = exactRecord(value, [
      "status",
      "executionRunId",
      "dispatchedAt",
      "sourceSha256",
      "stepSha256",
      "stepBytes",
    ], path);
    return {
      status: "published",
      executionRunId: nonEmptyText(slot.executionRunId, `${path}.executionRunId`),
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      sourceSha256: sha256Hex(slot.sourceSha256, `${path}.sourceSha256`),
      stepSha256: sha256Hex(slot.stepSha256, `${path}.stepSha256`),
      stepBytes: positiveByteCount(slot.stepBytes, `${path}.stepBytes`),
    };
  }
  if (status === "output-validation-rejected") {
    const slot = exactRecord(value, [
      "status",
      "executionRunId",
      "dispatchedAt",
      "sourceSha256",
      "observation",
      "destruction",
    ], path);
    const observation = validateIsolatedCodeOutputValidationRejection(
      slot.observation,
      `${path}.observation`,
    );
    const destruction = validateProvenDestruction(
      slot.destruction,
      nonEmptyText(slot.executionRunId, `${path}.executionRunId`),
    );
    return {
      status: "output-validation-rejected",
      executionRunId: destruction.runId,
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      sourceSha256: sha256Hex(slot.sourceSha256, `${path}.sourceSha256`),
      observation,
      destruction,
    };
  }
  throw new TypeError(`${path}.status is unknown.`);
}

function validateProvenDestruction(
  value: unknown,
  expectedRunId: string,
): {
  readonly status: "proven";
  readonly runId: string;
  readonly proofFingerprint: ContentFingerprint;
} {
  const root = exactRecord(
    value,
    ["status", "runId", "proofFingerprint"],
    "$destruction",
  );
  literalValue(root.status, "proven", "$destruction.status");
  const runId = nonEmptyText(root.runId, "$destruction.runId");
  if (runId !== expectedRunId) {
    throw new TypeError("$destruction.runId must match the CAD execution run.");
  }
  const fingerprint = exactRecord(
    root.proofFingerprint,
    ["algorithm", "digest"],
    "$destruction.proofFingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$destruction.proofFingerprint.algorithm",
  );
  return {
    status: "proven",
    runId,
    proofFingerprint: {
      algorithm: "sha256",
      digest: sha256Hex(
        fingerprint.digest,
        "$destruction.proofFingerprint.digest",
      ),
    },
  };
}

function parseSolveSlot(value: unknown, phase: string): SensitivitySolveSlot {
  const path = `$feaSensitivityAttempt.solves.${phase}`;
  if (!value || typeof value !== "object") {
    throw new TypeError(`${path} must be an object.`);
  }
  const status = (value as { status?: unknown }).status;
  if (status === "idle") {
    exactRecord(value, ["status"], path);
    return { status: "idle" };
  }
  if (status === "dispatched") {
    const slot = exactRecord(value, [
      "status",
      "dispatchedAt",
      "stepSha256",
    ], path);
    return {
      status: "dispatched",
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      stepSha256: sha256Hex(slot.stepSha256, `${path}.stepSha256`),
    };
  }
  if (status === "solver-recorded") {
    const slot = exactRecord(value, [
      "status",
      "dispatchedAt",
      "stepSha256",
      "captureFp",
      "canonicalSolverCaptureText",
    ], path);
    return {
      status: "solver-recorded",
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      stepSha256: sha256Hex(slot.stepSha256, `${path}.stepSha256`),
      captureFp: sha256Hex(slot.captureFp, `${path}.captureFp`),
      canonicalSolverCaptureText: nonEmptyText(
        slot.canonicalSolverCaptureText,
        `${path}.canonicalSolverCaptureText`,
      ),
    };
  }
  throw new TypeError(`${path}.status is unknown.`);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex string.`);
  }
  return digest;
}

function positiveByteCount(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}

function parseSnapshot(value: unknown): NonNullable<FeaSensitivityAttempt["snapshot"]> {
  const snapshot = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    "$feaSensitivityAttempt.snapshot",
  );
  if (
    typeof snapshot.revision !== "number" || !Number.isSafeInteger(snapshot.revision)
  ) {
    throw new TypeError("$feaSensitivityAttempt.snapshot.revision must be an integer.");
  }
  return {
    snapshotId: nonEmptyText(
      snapshot.snapshotId,
      "$feaSensitivityAttempt.snapshot.snapshotId",
    ),
    revision: snapshot.revision,
    subjectId: nonEmptyText(
      snapshot.subjectId,
      "$feaSensitivityAttempt.snapshot.subjectId",
    ),
  };
}
