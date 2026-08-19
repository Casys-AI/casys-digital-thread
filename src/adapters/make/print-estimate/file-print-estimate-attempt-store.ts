/**
 * Durable three-state WAL for industrialize.observe-print-estimate@1.
 *
 * dispatched → capture-recorded → completed
 *
 * A dispatched record without capture is terminal: the slicer call may already
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

export const PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA =
  "print-estimate-run-attempt/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const NO_WRITE_PROGRESS = "Print-estimate attempt journal made no write progress.";

export type PrintEstimateRunAttempt =
  | {
    readonly schemaVersion: typeof PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA;
    readonly status: "dispatched";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA;
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
    readonly schemaVersion: typeof PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA;
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

export class FilePrintEstimateAttemptStore {
  constructor(
    private readonly directory = "state/local/print-estimate-attempts",
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
    let current: PrintEstimateRunAttempt | undefined;
    try {
      current = await this.read(input.projectId, input.runId);
    } catch {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
    if (current) return actionFor(current, input.planDigest);
    const fresh: Extract<PrintEstimateRunAttempt, { status: "dispatched" }> = {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
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
    return actionFor(
      await this.required(input.projectId, input.runId),
      input.planDigest,
    );
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
      throw new PrintEstimateRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new PrintEstimateRunIllegalTransitionError("completed", "capture-recorded");
    }
    const next: Extract<PrintEstimateRunAttempt, { status: "capture-recorded" }> = {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
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
        throw new PrintEstimateRunOutcomeUnknownError();
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
      throw new PrintEstimateRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new PrintEstimateRunIllegalTransitionError("dispatched", "completed");
    }
    const next: Extract<PrintEstimateRunAttempt, { status: "completed" }> = {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
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
        throw new PrintEstimateRunOutcomeUnknownError();
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
  ): Promise<PrintEstimateRunAttempt | undefined> {
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
  ): Promise<PrintEstimateRunAttempt> {
    try {
      const existing = await this.read(projectId, runId);
      if (!existing) throw new Error("missing");
      return existing;
    } catch {
      throw new PrintEstimateRunOutcomeUnknownError();
    }
  }

  #path(projectId: string, runId: string): string {
    return `${this.directory}/${projectId}__${runId}.json`;
  }
}

function actionFor(
  current: PrintEstimateRunAttempt,
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
    throw new PrintEstimateRunOutcomeUnknownError();
  }
  if (current.status === "dispatched") {
    throw new PrintEstimateRunOutcomeUnknownError();
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

function parseAttempt(value: unknown): PrintEstimateRunAttempt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("print-estimate attempt must be an object.");
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
    ], "$printEstimateAttempt");
    literalValue(
      root.schemaVersion,
      PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      "$printEstimateAttempt.schemaVersion",
    );
    return {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      status: "dispatched",
      projectId: nonEmptyText(root.projectId, "$printEstimateAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$printEstimateAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$printEstimateAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$printEstimateAttempt.dispatchedAt",
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
    ], "$printEstimateAttempt");
    literalValue(
      root.schemaVersion,
      PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      "$printEstimateAttempt.schemaVersion",
    );
    return {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      status: "capture-recorded",
      projectId: nonEmptyText(root.projectId, "$printEstimateAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$printEstimateAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$printEstimateAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$printEstimateAttempt.dispatchedAt",
      ),
      recordedAt: nonEmptyText(root.recordedAt, "$printEstimateAttempt.recordedAt"),
      captureFingerprint: parseCaptureFingerprint(
        root.captureFingerprint,
        "$printEstimateAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$printEstimateAttempt.canonicalCaptureText",
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
    ], "$printEstimateAttempt");
    literalValue(
      root.schemaVersion,
      PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      "$printEstimateAttempt.schemaVersion",
    );
    return {
      schemaVersion: PRINT_ESTIMATE_RUN_ATTEMPT_SCHEMA,
      status: "completed",
      projectId: nonEmptyText(root.projectId, "$printEstimateAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$printEstimateAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$printEstimateAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$printEstimateAttempt.dispatchedAt",
      ),
      recordedAt: nonEmptyText(root.recordedAt, "$printEstimateAttempt.recordedAt"),
      completedAt: nonEmptyText(root.completedAt, "$printEstimateAttempt.completedAt"),
      captureFingerprint: parseCaptureFingerprint(
        root.captureFingerprint,
        "$printEstimateAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$printEstimateAttempt.canonicalCaptureText",
      ),
    };
  }
  throw new TypeError("print-estimate attempt status is unsupported.");
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
}): void {
  if (input.projectId.trim().length === 0) {
    throw new TypeError("projectId must be non-empty.");
  }
  if (input.runId.trim().length === 0) throw new TypeError("runId must be non-empty.");
  hex64(input.planDigest, "planDigest");
}

function hex64(value: string, path: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex SHA-256 digest.`);
  }
}
