/**
 * Durable three-state WAL for industrialize.observe-printability@1.
 *
 * dispatched → capture-recorded → completed
 *
 * A dispatched record without capture is terminal: the DFM calls may already
 * have run and must not be retried automatically.
 */

import {
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const PRINTABILITY_RUN_ATTEMPT_SCHEMA = "printability-run-attempt/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const NO_WRITE_PROGRESS = "Printability attempt journal made no write progress.";

export type PrintabilityRunAttempt =
  | {
    readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
    readonly status: "dispatched";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
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
    readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
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

export class FilePrintabilityAttemptStore {
  constructor(
    private readonly directory = "state/local/printability-attempts",
  ) {}

  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "capture-recorded";
      readonly recordedAt: string;
      readonly captureFingerprint: ContentFingerprint;
      readonly canonicalCaptureText: string;
    }
    | {
      readonly action: "completed";
      readonly recordedAt: string;
      readonly captureFingerprint: ContentFingerprint;
      readonly canonicalCaptureText: string;
    }
  > {
    validateBasis(input);
    await Deno.mkdir(this.directory, { recursive: true });
    let current: PrintabilityRunAttempt | undefined;
    try {
      current = await this.read(input.projectId, input.runId);
    } catch {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    if (current) return actionFor(current, input.planDigest);
    const fresh: Extract<PrintabilityRunAttempt, { status: "dispatched" }> = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      status: "dispatched",
      ...input,
    };
    try {
      await writeNewAttemptFileDurably(
        this.#path(input.projectId, input.runId),
        `${deterministicJson(fresh)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.required(input.projectId, input.runId);
    return actionFor(existing, input.planDigest);
  }

  async recordCapture(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }): Promise<void> {
    validateBasis(input);
    hex64(input.captureFingerprint.digest, "captureFingerprint.digest");
    const existing = await this.required(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new PrintabilityRunIllegalTransitionError("completed", "capture-recorded");
    }
    const next: Extract<PrintabilityRunAttempt, { status: "capture-recorded" }> = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      status: "capture-recorded",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      dispatchedAt: existing.dispatchedAt,
      recordedAt: input.recordedAt,
      captureFingerprint: input.captureFingerprint,
      canonicalCaptureText: input.canonicalCaptureText,
    };
    if (existing.status === "capture-recorded") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new PrintabilityRunOutcomeUnknownError();
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

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
  }): Promise<void> {
    validateBasis(input);
    hex64(input.captureFingerprint.digest, "captureFingerprint.digest");
    const existing = await this.required(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new PrintabilityRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new PrintabilityRunIllegalTransitionError("dispatched", "completed");
    }
    const next: Extract<PrintabilityRunAttempt, { status: "completed" }> = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      status: "completed",
      projectId: existing.projectId,
      runId: existing.runId,
      planDigest: existing.planDigest,
      dispatchedAt: existing.dispatchedAt,
      recordedAt: existing.recordedAt,
      completedAt: input.completedAt,
      captureFingerprint: input.captureFingerprint,
      canonicalCaptureText: existing.canonicalCaptureText,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(next)) {
        throw new PrintabilityRunOutcomeUnknownError();
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
  ): Promise<PrintabilityRunAttempt | undefined> {
    try {
      const text = await Deno.readTextFile(this.#path(projectId, runId));
      return parseAttempt(JSON.parse(text));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async required(
    projectId: string,
    runId: string,
  ): Promise<PrintabilityRunAttempt> {
    try {
      const existing = await this.read(projectId, runId);
      if (!existing) throw new Error("missing");
      return existing;
    } catch {
      throw new PrintabilityRunOutcomeUnknownError();
    }
  }

  #path(projectId: string, runId: string): string {
    return `${this.directory}/${projectId}__${runId}.json`;
  }
}

function actionFor(
  current: PrintabilityRunAttempt,
  planDigest: string,
):
  | { readonly action: "dispatch" }
  | {
    readonly action: "capture-recorded";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  }
  | {
    readonly action: "completed";
    readonly recordedAt: string;
    readonly captureFingerprint: ContentFingerprint;
    readonly canonicalCaptureText: string;
  } {
  if (current.planDigest !== planDigest) {
    throw new PrintabilityRunOutcomeUnknownError();
  }
  if (current.status === "dispatched") {
    throw new PrintabilityRunOutcomeUnknownError();
  }
  if (current.status === "capture-recorded") {
    return {
      action: "capture-recorded",
      recordedAt: current.recordedAt,
      captureFingerprint: current.captureFingerprint,
      canonicalCaptureText: current.canonicalCaptureText,
    };
  }
  return {
    action: "completed",
    recordedAt: current.recordedAt,
    captureFingerprint: current.captureFingerprint,
    canonicalCaptureText: current.canonicalCaptureText,
  };
}

function parseAttempt(value: unknown): PrintabilityRunAttempt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("printability attempt must be an object.");
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
    ], "$printabilityAttempt");
    literalValue(
      root.schemaVersion,
      PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      "$printabilityAttempt.schemaVersion",
    );
    return {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      status: "dispatched",
      projectId: nonEmptyText(root.projectId, "$printabilityAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$printabilityAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$printabilityAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$printabilityAttempt.dispatchedAt",
      ),
    };
  }
  if (status === "capture-recorded") {
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
    ], "$printabilityAttempt");
    literalValue(
      root.schemaVersion,
      PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      "$printabilityAttempt.schemaVersion",
    );
    return {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      status: "capture-recorded",
      projectId: nonEmptyText(root.projectId, "$printabilityAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$printabilityAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$printabilityAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$printabilityAttempt.dispatchedAt",
      ),
      recordedAt: nonEmptyText(root.recordedAt, "$printabilityAttempt.recordedAt"),
      captureFingerprint: parseCaptureFingerprint(
        root.captureFingerprint,
        "$printabilityAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$printabilityAttempt.canonicalCaptureText",
      ),
    };
  }
  if (status === "completed") {
    const root = exactRecord(value, [
      "schemaVersion",
      "status",
      "projectId",
      "runId",
      "planDigest",
      "dispatchedAt",
      "recordedAt",
      "completedAt",
      "captureFingerprint",
      "canonicalCaptureText",
    ], "$printabilityAttempt");
    literalValue(
      root.schemaVersion,
      PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      "$printabilityAttempt.schemaVersion",
    );
    return {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      status: "completed",
      projectId: nonEmptyText(root.projectId, "$printabilityAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$printabilityAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$printabilityAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$printabilityAttempt.dispatchedAt",
      ),
      recordedAt: nonEmptyText(root.recordedAt, "$printabilityAttempt.recordedAt"),
      completedAt: nonEmptyText(root.completedAt, "$printabilityAttempt.completedAt"),
      captureFingerprint: parseCaptureFingerprint(
        root.captureFingerprint,
        "$printabilityAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$printabilityAttempt.canonicalCaptureText",
      ),
    };
  }
  throw new TypeError("printability attempt status is unsupported.");
}

function parseCaptureFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint {
  const rec = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(rec.algorithm, "sha256", `${path}.algorithm`);
  return {
    algorithm: "sha256",
    digest: hexDigest(rec.digest, `${path}.digest`),
  };
}

function hexDigest(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  hex64(text, path);
  return text;
}

function validateBasis(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly dispatchedAt?: string;
}): void {
  nonEmpty(input.projectId, "projectId");
  nonEmpty(input.runId, "runId");
  hex64(input.planDigest, "planDigest");
}

function nonEmpty(value: string, path: string): void {
  if (value.trim().length === 0) throw new TypeError(`${path} must be non-empty.`);
}

function hex64(value: string, path: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex SHA-256 digest.`);
  }
}
