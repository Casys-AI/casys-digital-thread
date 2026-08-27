/** Durable product WAL surrounding one local CalculiX execution and SysON oracle. */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  fingerprintResourceBytes,
  sha256Hex,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const CALCULIX_ISOLATED_PRODUCT_ATTEMPT_SCHEMA =
  "calculix-isolated-product-attempt/1.0" as const;

export interface CalculixIsolatedProductCasReference {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

interface BaseAttempt {
  readonly schemaVersion: typeof CALCULIX_ISOLATED_PRODUCT_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly planSha256: string;
  readonly executionRunId: string;
  readonly bundleSha256: string;
  readonly profileSha256: string;
  readonly preparedAt: string;
}

export type CalculixIsolatedProductAttempt =
  | (BaseAttempt & { readonly status: "prepared" })
  | (BaseAttempt & {
    readonly status: "evidence-captured";
    readonly evidenceSha256: string;
  })
  | (BaseAttempt & {
    readonly status: "evaluation-dispatched";
    readonly evidenceSha256: string;
    readonly evaluationDispatchedAt: string;
  })
  | (BaseAttempt & {
    readonly status: "evaluation-captured";
    readonly evidenceSha256: string;
    readonly evaluationDispatchedAt: string;
    readonly evaluationCapture: CalculixIsolatedProductCasReference;
  })
  | (BaseAttempt & {
    readonly status: "completed";
    readonly evidenceSha256: string;
    readonly evaluationDispatchedAt: string;
    readonly evaluationCapture: CalculixIsolatedProductCasReference;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  });

export class CalculixIsolatedProductAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculixIsolatedProductAttemptIntegrityError";
  }
}

export class FileCalculixIsolatedProductAttemptStore {
  readonly #directory: string;
  readonly #syncBoundary?: string;

  constructor(
    directory = "state/local/calculix-isolated-product-attempts",
    syncBoundary?: string,
  ) {
    this.#directory = boundedDirectory(directory);
    this.#syncBoundary = syncBoundary === undefined
      ? undefined
      : boundedSyncBoundary(this.#directory, syncBoundary);
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<CalculixIsolatedProductAttempt | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(await this.pathFor(projectId, runId));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw integrity("The local CalculiX product WAL is not JSON.");
    }
    const attempt = validateCalculixIsolatedProductAttempt(parsed, projectId, runId);
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw integrity("The local CalculiX product WAL is not canonical.");
    }
    return attempt;
  }

  async begin(
    input: Omit<BaseAttempt, "schemaVersion">,
  ): Promise<CalculixIsolatedProductAttempt> {
    const fresh = validateCalculixIsolatedProductAttempt({
      schemaVersion: CALCULIX_ISOLATED_PRODUCT_ATTEMPT_SCHEMA,
      ...input,
      status: "prepared",
    });
    return await this.#withLock(input.projectId, input.runId, async () => {
      const current = await this.read(input.projectId, input.runId);
      if (current) {
        if (
          deterministicJson(identity(current)) !== deterministicJson(identity(fresh))
        ) {
          throw integrity("The local CalculiX product WAL binds another execution.");
        }
        return current;
      }
      await this.#write(fresh, true);
      return fresh;
    });
  }

  recordEvidence(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly evidenceSha256: string;
  }): Promise<CalculixIsolatedProductAttempt> {
    return this.#transition(input.projectId, input.runId, (current) => {
      const evidenceSha256 = sha256Hex(input.evidenceSha256, "$evidenceSha256");
      if (current.status === "prepared") {
        return { ...current, status: "evidence-captured" as const, evidenceSha256 };
      }
      if (current.evidenceSha256 !== evidenceSha256) {
        throw integrity("The local CalculiX evidence conflicts with the durable WAL.");
      }
      return current;
    });
  }

  markEvaluationDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly evaluationDispatchedAt: string;
  }): Promise<CalculixIsolatedProductAttempt> {
    return this.#transition(input.projectId, input.runId, (current) => {
      const evaluationDispatchedAt = iso(
        input.evaluationDispatchedAt,
        "$evaluationDispatchedAt",
      );
      if (current.status === "evidence-captured") {
        return {
          ...current,
          status: "evaluation-dispatched" as const,
          evaluationDispatchedAt,
        };
      }
      if (
        "evaluationDispatchedAt" in current &&
        current.evaluationDispatchedAt !== evaluationDispatchedAt
      ) {
        throw integrity("The SysON dispatch timestamp conflicts with the WAL.");
      }
      if ("evaluationDispatchedAt" in current) return current;
      throw integrity(
        "SysON dispatch cannot precede durable local CalculiX evidence.",
      );
    });
  }

  recordEvaluation(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly evaluationCapture: CalculixIsolatedProductCasReference;
  }): Promise<CalculixIsolatedProductAttempt> {
    return this.#transition(input.projectId, input.runId, (current) => {
      if (
        current.status !== "evaluation-dispatched" &&
        current.status !== "evaluation-captured" && current.status !== "completed"
      ) throw integrity("SysON capture cannot precede its durable dispatch intent.");
      const evaluationCapture = casRef(input.evaluationCapture, "$evaluationCapture");
      if (current.status === "evaluation-dispatched") {
        return {
          ...current,
          status: "evaluation-captured" as const,
          evaluationCapture,
        };
      }
      if (
        deterministicJson(current.evaluationCapture) !==
          deterministicJson(evaluationCapture)
      ) {
        throw integrity("The SysON capture conflicts with the durable WAL.");
      }
      return current;
    });
  }

  complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  }): Promise<CalculixIsolatedProductAttempt> {
    return this.#transition(input.projectId, input.runId, (current) => {
      if (current.status !== "evaluation-captured" && current.status !== "completed") {
        throw integrity("Local CalculiX cannot complete before the SysON capture.");
      }
      const snapshot = snapshotRef(input.snapshot);
      if (current.status === "completed") {
        if (deterministicJson(current.snapshot) !== deterministicJson(snapshot)) {
          throw integrity("Local CalculiX completion names another snapshot.");
        }
        return current;
      }
      return { ...current, status: "completed" as const, snapshot };
    });
  }

  async pathFor(projectId: string, runId: string): Promise<string> {
    safeId(projectId, "$projectId");
    safeId(runId, "$runId");
    const digest = await fingerprintResourceBytes(
      new TextEncoder().encode(deterministicJson([projectId, runId])),
    );
    return `${this.#directory}/${digest}.json`;
  }

  async #transition(
    projectId: string,
    runId: string,
    fn: (current: CalculixIsolatedProductAttempt) => CalculixIsolatedProductAttempt,
  ): Promise<CalculixIsolatedProductAttempt> {
    return await this.#withLock(projectId, runId, async () => {
      const current = await this.read(projectId, runId);
      if (!current) throw integrity("The local CalculiX product WAL is missing.");
      const next = validateCalculixIsolatedProductAttempt(
        fn(current),
        projectId,
        runId,
      );
      if (deterministicJson(next) !== deterministicJson(current)) {
        await this.#write(next, false);
      }
      return next;
    });
  }

  async #write(
    attempt: CalculixIsolatedProductAttempt,
    create: boolean,
  ): Promise<void> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const path = await this.pathFor(attempt.projectId, attempt.runId);
    const args = [
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      "The local CalculiX WAL write made no progress.",
      undefined,
      this.#syncBoundary,
    ] as const;
    if (create) await writeNewAttemptFileDurably(...args);
    else await replaceAttemptFileDurably(...args);
    const reopened = await this.read(attempt.projectId, attempt.runId);
    if (!reopened || deterministicJson(reopened) !== deterministicJson(attempt)) {
      throw integrity("The local CalculiX product WAL failed durable reread.");
    }
  }

  async #withLock<T>(
    projectId: string,
    runId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const file = await Deno.open(`${await this.pathFor(projectId, runId)}.lock`, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    try {
      await file.lock(true);
      return await fn();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }
}

export function validateCalculixIsolatedProductAttempt(
  value: unknown,
  expectedProjectId?: string,
  expectedRunId?: string,
): CalculixIsolatedProductAttempt {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "runId",
    "planSha256",
    "executionRunId",
    "bundleSha256",
    "profileSha256",
    "preparedAt",
    "status",
    ...statusFields(value),
  ], "$attempt");
  literalValue(
    root.schemaVersion,
    CALCULIX_ISOLATED_PRODUCT_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const base: BaseAttempt = {
    schemaVersion: CALCULIX_ISOLATED_PRODUCT_ATTEMPT_SCHEMA,
    projectId: safeId(root.projectId, "$attempt.projectId"),
    runId: safeId(root.runId, "$attempt.runId"),
    planSha256: sha256Hex(root.planSha256, "$attempt.planSha256"),
    executionRunId: safeId(root.executionRunId, "$attempt.executionRunId"),
    bundleSha256: sha256Hex(root.bundleSha256, "$attempt.bundleSha256"),
    profileSha256: sha256Hex(root.profileSha256, "$attempt.profileSha256"),
    preparedAt: iso(root.preparedAt, "$attempt.preparedAt"),
  };
  if (
    (expectedProjectId !== undefined && base.projectId !== expectedProjectId) ||
    (expectedRunId !== undefined && base.runId !== expectedRunId)
  ) throw integrity("The local CalculiX product WAL has a foreign identity.");
  if (root.status === "prepared") return deepFreeze({ ...base, status: "prepared" });
  const evidenceSha256 = sha256Hex(root.evidenceSha256, "$attempt.evidenceSha256");
  if (root.status === "evidence-captured") {
    return deepFreeze({ ...base, status: "evidence-captured", evidenceSha256 });
  }
  const evaluationDispatchedAt = iso(
    root.evaluationDispatchedAt,
    "$attempt.evaluationDispatchedAt",
  );
  if (root.status === "evaluation-dispatched") {
    return deepFreeze({
      ...base,
      status: "evaluation-dispatched",
      evidenceSha256,
      evaluationDispatchedAt,
    });
  }
  const evaluationCapture = casRef(
    root.evaluationCapture,
    "$attempt.evaluationCapture",
  );
  if (root.status === "evaluation-captured") {
    return deepFreeze({
      ...base,
      status: "evaluation-captured",
      evidenceSha256,
      evaluationDispatchedAt,
      evaluationCapture,
    });
  }
  if (root.status === "completed") {
    return deepFreeze({
      ...base,
      status: "completed",
      evidenceSha256,
      evaluationDispatchedAt,
      evaluationCapture,
      snapshot: snapshotRef(root.snapshot),
    });
  }
  throw integrity("The local CalculiX product WAL status is unsupported.");
}

function statusFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const status = (value as Record<string, unknown>).status;
  if (status === "prepared") return [];
  if (status === "evidence-captured") return ["evidenceSha256"];
  if (status === "evaluation-dispatched") {
    return ["evidenceSha256", "evaluationDispatchedAt"];
  }
  if (status === "evaluation-captured") {
    return ["evidenceSha256", "evaluationDispatchedAt", "evaluationCapture"];
  }
  if (status === "completed") {
    return [
      "evidenceSha256",
      "evaluationDispatchedAt",
      "evaluationCapture",
      "snapshot",
    ];
  }
  return [];
}

function identity(value: CalculixIsolatedProductAttempt) {
  return {
    projectId: value.projectId,
    runId: value.runId,
    planSha256: value.planSha256,
    executionRunId: value.executionRunId,
    bundleSha256: value.bundleSha256,
    profileSha256: value.profileSha256,
  };
}

function snapshotRef(value: unknown) {
  const root = exactRecord(value, ["snapshotId", "revision", "subjectId"], "$snapshot");
  return deepFreeze({
    snapshotId: safeId(root.snapshotId, "$snapshot.snapshotId"),
    revision: positiveInteger(root.revision, "$snapshot.revision"),
    subjectId: safeId(root.subjectId, "$snapshot.subjectId"),
  });
}

function casRef(value: unknown, path: string): CalculixIsolatedProductCasReference {
  const root = exactRecord(value, ["uri", "byteCount", "sha256"], path);
  const sha256 = sha256Hex(root.sha256, `${path}.sha256`);
  if (
    typeof root.uri !== "string" || !root.uri.endsWith(`/sha256/${sha256}`) ||
    !Number.isSafeInteger(root.byteCount) || (root.byteCount as number) < 0
  ) throw integrity(`${path} is not an exact CAS reference.`);
  return deepFreeze({ uri: root.uri, byteCount: root.byteCount as number, sha256 });
}

function iso(value: unknown, path: string): string {
  let canonical: string | undefined;
  try {
    canonical = typeof value === "string" ? new Date(value).toISOString() : undefined;
  } catch {
    canonical = undefined;
  }
  if (typeof value !== "string" || canonical !== value) {
    throw integrity(`${path} must be canonical ISO-8601.`);
  }
  return value;
}

function boundedDirectory(value: string): string {
  if (
    !value || value !== value.trim() || value === "/" || value.includes("\0")
  ) {
    throw new TypeError("Local CalculiX WAL directory must be bounded.");
  }
  return value.replace(/\/+$/, "");
}

function boundedSyncBoundary(directory: string, value: string): string {
  const boundary = boundedDirectory(value);
  if (directory !== boundary && !directory.startsWith(`${boundary}/`)) {
    throw new TypeError(
      "Local CalculiX WAL sync boundary must contain the attempt directory.",
    );
  }
  return boundary;
}

function integrity(message: string): CalculixIsolatedProductAttemptIntegrityError {
  return new CalculixIsolatedProductAttemptIntegrityError(message);
}
