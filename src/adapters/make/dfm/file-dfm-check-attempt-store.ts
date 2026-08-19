/**
 * Durable three-state WAL for industrialize.run-dfm-checks@1.
 *
 * dispatched → capture-recorded → completed
 *
 * A dispatched record without capture is terminal: the measured DFM calls may already
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

export const DFM_CHECK_RUN_ATTEMPT_SCHEMA = "dfm-check-run-attempt/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const NO_WRITE_PROGRESS = "DFM check attempt journal made no write progress.";

export type DfmCheckRunAttempt =
  | {
    readonly schemaVersion: typeof DFM_CHECK_RUN_ATTEMPT_SCHEMA;
    readonly status: "dispatched";
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof DFM_CHECK_RUN_ATTEMPT_SCHEMA;
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
    readonly schemaVersion: typeof DFM_CHECK_RUN_ATTEMPT_SCHEMA;
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

export class DfmCheckRunOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The DFM check provider outcome is unknown and will not be retried automatically.",
    );
    this.name = "DfmCheckRunOutcomeUnknownError";
  }
}

export class DfmCheckRunIllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal DFM check WAL transition: ${from} -> ${to}.`);
    this.name = "DfmCheckRunIllegalTransitionError";
  }
}

export class FileDfmCheckAttemptStore {
  constructor(
    private readonly directory = "state/local/dfm-check-attempts",
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
    let current: DfmCheckRunAttempt | undefined;
    try {
      current = await this.read(input.projectId, input.runId);
    } catch {
      throw new DfmCheckRunOutcomeUnknownError();
    }
    if (current) return actionFor(current, input.planDigest);
    const fresh: Extract<DfmCheckRunAttempt, { status: "dispatched" }> = {
      schemaVersion: DFM_CHECK_RUN_ATTEMPT_SCHEMA,
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
      throw new DfmCheckRunOutcomeUnknownError();
    }
    if (existing.status === "completed") {
      throw new DfmCheckRunIllegalTransitionError("completed", "capture-recorded");
    }
    const next: Extract<DfmCheckRunAttempt, { status: "capture-recorded" }> = {
      schemaVersion: DFM_CHECK_RUN_ATTEMPT_SCHEMA,
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
        throw new DfmCheckRunOutcomeUnknownError();
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
      throw new DfmCheckRunOutcomeUnknownError();
    }
    if (existing.status === "dispatched") {
      throw new DfmCheckRunIllegalTransitionError("dispatched", "completed");
    }
    const next: Extract<DfmCheckRunAttempt, { status: "completed" }> = {
      schemaVersion: DFM_CHECK_RUN_ATTEMPT_SCHEMA,
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
        throw new DfmCheckRunOutcomeUnknownError();
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
  ): Promise<DfmCheckRunAttempt | undefined> {
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
  ): Promise<DfmCheckRunAttempt> {
    try {
      const existing = await this.read(projectId, runId);
      if (!existing) throw new Error("missing");
      return existing;
    } catch {
      throw new DfmCheckRunOutcomeUnknownError();
    }
  }

  #path(projectId: string, runId: string): string {
    return `${this.directory}/${projectId}__${runId}.json`;
  }
}

function actionFor(
  current: DfmCheckRunAttempt,
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
    throw new DfmCheckRunOutcomeUnknownError();
  }
  if (current.status === "dispatched") {
    throw new DfmCheckRunOutcomeUnknownError();
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

function parseAttempt(value: unknown): DfmCheckRunAttempt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("DFM check attempt must be an object.");
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
    ], "$dfmCheckAttempt");
    literalValue(
      root.schemaVersion,
      DFM_CHECK_RUN_ATTEMPT_SCHEMA,
      "$dfmCheckAttempt.schemaVersion",
    );
    return {
      schemaVersion: DFM_CHECK_RUN_ATTEMPT_SCHEMA,
      status: "dispatched",
      projectId: nonEmptyText(root.projectId, "$dfmCheckAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$dfmCheckAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$dfmCheckAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$dfmCheckAttempt.dispatchedAt",
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
    ], "$dfmCheckAttempt");
    literalValue(
      root.schemaVersion,
      DFM_CHECK_RUN_ATTEMPT_SCHEMA,
      "$dfmCheckAttempt.schemaVersion",
    );
    return {
      schemaVersion: DFM_CHECK_RUN_ATTEMPT_SCHEMA,
      status: "capture-recorded",
      projectId: nonEmptyText(root.projectId, "$dfmCheckAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$dfmCheckAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$dfmCheckAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$dfmCheckAttempt.dispatchedAt",
      ),
      recordedAt: nonEmptyText(root.recordedAt, "$dfmCheckAttempt.recordedAt"),
      captureFingerprint: parseCaptureFingerprint(
        root.captureFingerprint,
        "$dfmCheckAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$dfmCheckAttempt.canonicalCaptureText",
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
    ], "$dfmCheckAttempt");
    literalValue(
      root.schemaVersion,
      DFM_CHECK_RUN_ATTEMPT_SCHEMA,
      "$dfmCheckAttempt.schemaVersion",
    );
    return {
      schemaVersion: DFM_CHECK_RUN_ATTEMPT_SCHEMA,
      status: "completed",
      projectId: nonEmptyText(root.projectId, "$dfmCheckAttempt.projectId"),
      runId: nonEmptyText(root.runId, "$dfmCheckAttempt.runId"),
      planDigest: hexDigest(root.planDigest, "$dfmCheckAttempt.planDigest"),
      dispatchedAt: nonEmptyText(
        root.dispatchedAt,
        "$dfmCheckAttempt.dispatchedAt",
      ),
      recordedAt: nonEmptyText(root.recordedAt, "$dfmCheckAttempt.recordedAt"),
      completedAt: nonEmptyText(root.completedAt, "$dfmCheckAttempt.completedAt"),
      captureFingerprint: parseCaptureFingerprint(
        root.captureFingerprint,
        "$dfmCheckAttempt.captureFingerprint",
      ),
      canonicalCaptureText: nonEmptyText(
        root.canonicalCaptureText,
        "$dfmCheckAttempt.canonicalCaptureText",
      ),
    };
  }
  throw new TypeError("DFM check attempt status is unsupported.");
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
