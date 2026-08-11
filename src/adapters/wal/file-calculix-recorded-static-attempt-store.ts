/**
 * Durable, run-scoped recovery journal for `verify.run-fea-static-proof@2`.
 *
 * The durable `dispatched` transition is written before the only solve call.
 * Consequently an existing non-completed journal is recovered exclusively by
 * `calculix_run_get` for the recorded request id: it can never authorize a
 * second `calculix_solve_static_recorded` call.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalResourceUri,
  fingerprintResourceBytes,
  sha256Hex,
} from "../../domain/analysis/provider-resource-reader.ts";

export const CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA =
  "calculix-recorded-static-attempt/1.0" as const;

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_RUN_ID =
  /^r-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROFILE = [
  ["input.step", "model/step"],
  ["request.json", "application/json"],
  ["mesh.geo", "text/plain"],
  ["mesh.inp", "text/plain"],
  ["gmsh.log", "text/plain"],
  ["job.inp", "text/plain"],
  ["ccx.log", "text/plain"],
  ["job.dat", "text/plain"],
  ["result.json", "application/json"],
] as const;

export interface CalculixRecordedStaticResource {
  readonly role: string;
  readonly uri: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface CalculixRecordedStaticCasReference {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

interface BaseAttempt {
  readonly schemaVersion: typeof CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  /** Full-byte resolved-operation-plan/2.0 fingerprint. */
  readonly planSha256: string;
  readonly requestId: string;
  readonly preparedAt: string;
}

export type CalculixRecordedStaticAttempt =
  | (BaseAttempt & { readonly status: "pre-dispatch" })
  | (BaseAttempt & { readonly status: "dispatched"; readonly dispatchedAt: string })
  | (BaseAttempt & {
    readonly status: "provider-run-known";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly CalculixRecordedStaticResource[];
  })
  | (BaseAttempt & {
    readonly status: "resources-captured";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly CalculixRecordedStaticResource[];
    readonly captureManifest: CalculixRecordedStaticCasReference;
  })
  | (BaseAttempt & {
    readonly status: "evaluation-dispatched";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly CalculixRecordedStaticResource[];
    readonly captureManifest: CalculixRecordedStaticCasReference;
    /** Durable before the only SysON evaluation call; retry is never safe. */
    readonly evaluationDispatchedAt: string;
  })
  | (BaseAttempt & {
    readonly status: "evaluation-captured";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly CalculixRecordedStaticResource[];
    readonly captureManifest: CalculixRecordedStaticCasReference;
    readonly evaluationDispatchedAt: string;
    readonly evaluationCapture: CalculixRecordedStaticCasReference;
  })
  | (BaseAttempt & {
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly CalculixRecordedStaticResource[];
    readonly captureManifest: CalculixRecordedStaticCasReference;
    readonly evaluationDispatchedAt: string;
    readonly evaluationCapture: CalculixRecordedStaticCasReference;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  });

export class CalculixRecordedStaticOutcomeUnknownError extends Error {
  constructor(
    message = "Recorded CalculiX outcome is unknown; recovery is run_get only.",
  ) {
    super(message);
    this.name = "CalculixRecordedStaticOutcomeUnknownError";
  }
}

export class CalculixRecordedStaticAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculixRecordedStaticAttemptIntegrityError";
  }
}

/** One advisory OS lock and one canonical journal per project/run pair. */
export class FileCalculixRecordedStaticAttemptStore {
  constructor(
    private readonly directory = "state/local/calculix-recorded-static-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<CalculixRecordedStaticAttempt | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(await this.pathFor(projectId, runId));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new CalculixRecordedStaticAttemptIntegrityError(
        "Recorded CalculiX journal is not JSON.",
      );
    }
    const attempt = validateCalculixRecordedStaticAttempt(value, projectId, runId);
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw new CalculixRecordedStaticAttemptIntegrityError(
        "Recorded CalculiX journal is not canonical.",
      );
    }
    return attempt;
  }

  async begin(
    input: Omit<BaseAttempt, "schemaVersion" | "status">,
  ): Promise<CalculixRecordedStaticAttempt> {
    const fresh = validateCalculixRecordedStaticAttempt(
      {
        schemaVersion: CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA,
        ...input,
        status: "pre-dispatch",
      },
      input.projectId,
      input.runId,
    );
    return await this.#withLock(input.projectId, input.runId, async () => {
      const existing = await this.read(input.projectId, input.runId);
      if (existing) {
        if (
          deterministicJson(identity(existing)) !== deterministicJson(identity(fresh))
        ) {
          throw new CalculixRecordedStaticAttemptIntegrityError(
            "Recorded CalculiX journal conflicts with a different sealed request.",
          );
        }
        return existing;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  async markDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly dispatchedAt: string;
  }): Promise<CalculixRecordedStaticAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      const dispatchedAt = iso(input.dispatchedAt, "$dispatchedAt");
      if (current.status === "pre-dispatch") {
        return { ...current, status: "dispatched" as const, dispatchedAt };
      }
      if (current.status === "dispatched" && current.dispatchedAt !== dispatchedAt) {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Recorded CalculiX dispatch timestamp conflicts with the durable request.",
        );
      }
      return current;
    });
  }

  async recordProviderRun(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly CalculixRecordedStaticResource[];
  }): Promise<CalculixRecordedStaticAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (current.status === "pre-dispatch") {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Provider completion cannot precede durable dispatch intent.",
        );
      }
      const known = {
        requestSha256: sha256Hex(input.requestSha256, "$requestSha256"),
        providerRunId: providerRunId(input.providerRunId, "$providerRunId"),
        resources: validateResources(input.resources, "$resources"),
      };
      if (current.status === "dispatched") {
        return { ...current, status: "provider-run-known" as const, ...known };
      }
      if (
        deterministicJson({
          requestSha256: current.requestSha256,
          providerRunId: current.providerRunId,
          resources: current.resources,
        }) !== deterministicJson(known)
      ) {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Provider run recovery conflicts with durable CalculiX completion evidence.",
        );
      }
      return current;
    });
  }

  async recordResourcesCaptured(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly captureManifest: CalculixRecordedStaticCasReference;
  }): Promise<CalculixRecordedStaticAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (current.status === "pre-dispatch" || current.status === "dispatched") {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Provider resources cannot be captured before durable provider completion.",
        );
      }
      const captureManifest = validateCas(input.captureManifest, "$captureManifest");
      if (current.status === "provider-run-known") {
        return { ...current, status: "resources-captured" as const, captureManifest };
      }
      if (
        deterministicJson(current.captureManifest) !==
          deterministicJson(captureManifest)
      ) {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Captured CalculiX manifest conflicts with the durable capture.",
        );
      }
      return current;
    });
  }

  async markEvaluationDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly evaluationDispatchedAt: string;
  }): Promise<CalculixRecordedStaticAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      const evaluationDispatchedAt = iso(
        input.evaluationDispatchedAt,
        "$evaluationDispatchedAt",
      );
      if (current.status === "resources-captured") {
        return {
          ...current,
          status: "evaluation-dispatched" as const,
          evaluationDispatchedAt,
        };
      }
      if (
        current.status === "evaluation-dispatched" &&
        current.evaluationDispatchedAt !== evaluationDispatchedAt
      ) {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Recorded SysON evaluation timestamp conflicts with the durable call intent.",
        );
      }
      return current;
    });
  }

  async recordEvaluationCaptured(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly evaluationCapture: CalculixRecordedStaticCasReference;
  }): Promise<CalculixRecordedStaticAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (
        current.status !== "evaluation-dispatched" &&
        current.status !== "evaluation-captured" && current.status !== "completed"
      ) {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "SysON evaluation cannot be captured before durable evaluation dispatch intent.",
        );
      }
      const evaluationCapture = validateCas(
        input.evaluationCapture,
        "$evaluationCapture",
      );
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
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Captured SysON evaluation conflicts with the durable evaluation capture.",
        );
      }
      return current;
    });
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  }): Promise<CalculixRecordedStaticAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (current.status !== "evaluation-captured" && current.status !== "completed") {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Recorded CalculiX run cannot complete before its CAS and SysON evaluation captures are durable.",
        );
      }
      const snapshot = snapshotRef(input.snapshot, "$snapshot");
      if (current.status === "completed") {
        if (deterministicJson(current.snapshot) !== deterministicJson(snapshot)) {
          throw new CalculixRecordedStaticAttemptIntegrityError(
            "Recorded CalculiX completion names a different ThreadSnapshot.",
          );
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
    return `${this.directory.replace(/\/+$/, "")}/${digest}.json`;
  }

  async #transition(
    projectId: string,
    runId: string,
    transition: (
      current: CalculixRecordedStaticAttempt,
    ) => CalculixRecordedStaticAttempt,
  ): Promise<CalculixRecordedStaticAttempt> {
    return await this.#withLock(projectId, runId, async () => {
      const current = await this.read(projectId, runId);
      if (!current) {
        throw new CalculixRecordedStaticAttemptIntegrityError(
          "Recorded CalculiX journal is missing.",
        );
      }
      const next = validateCalculixRecordedStaticAttempt(
        transition(current),
        projectId,
        runId,
      );
      if (deterministicJson(next) !== deterministicJson(current)) {
        await this.#replace(next);
      }
      return next;
    });
  }

  async #writeNew(attempt: CalculixRecordedStaticAttempt): Promise<void> {
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.pathFor(attempt.projectId, attempt.runId);
    const file = await Deno.open(path, { createNew: true, write: true });
    try {
      await writeAll(file, `${deterministicJson(attempt)}\n`);
      await file.syncData();
    } finally {
      file.close();
    }
    await syncDirectory(this.directory);
    await this.#assertReread(attempt);
  }

  async #replace(attempt: CalculixRecordedStaticAttempt): Promise<void> {
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.pathFor(attempt.projectId, attempt.runId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      const file = await Deno.open(temporary, { createNew: true, write: true });
      try {
        await writeAll(file, `${deterministicJson(attempt)}\n`);
        await file.syncData();
      } finally {
        file.close();
      }
      await Deno.rename(temporary, path);
      await syncDirectory(this.directory);
    } finally {
      await Deno.remove(temporary).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
    await this.#assertReread(attempt);
  }

  async #assertReread(expected: CalculixRecordedStaticAttempt): Promise<void> {
    const reread = await this.read(expected.projectId, expected.runId);
    if (!reread || deterministicJson(reread) !== deterministicJson(expected)) {
      throw new CalculixRecordedStaticAttemptIntegrityError(
        "Recorded CalculiX journal was not durably reread.",
      );
    }
  }

  async #withLock<T>(
    projectId: string,
    runId: string,
    body: () => Promise<T>,
  ): Promise<T> {
    const lockPath = `${await this.pathFor(projectId, runId)}.lock`;
    await Deno.mkdir(this.directory, { recursive: true });
    const file = await Deno.open(lockPath, { create: true, read: true, write: true });
    try {
      await file.lock(true);
      return await body();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }
}

export function validateCalculixRecordedStaticAttempt(
  value: unknown,
  projectId?: string,
  runId?: string,
): CalculixRecordedStaticAttempt {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "runId",
    "planSha256",
    "requestId",
    "preparedAt",
    "status",
    ...fieldsForStatus(value),
  ], "$attempt");
  literalValue(
    root.schemaVersion,
    CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const base: BaseAttempt = {
    schemaVersion: CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA,
    projectId: safeId(root.projectId, "$attempt.projectId"),
    runId: safeId(root.runId, "$attempt.runId"),
    planSha256: sha256Hex(root.planSha256, "$attempt.planSha256"),
    requestId: requestId(root.requestId, "$attempt.requestId"),
    preparedAt: iso(root.preparedAt, "$attempt.preparedAt"),
  };
  if (
    (projectId !== undefined && base.projectId !== projectId) ||
    (runId !== undefined && base.runId !== runId)
  ) {
    throw new CalculixRecordedStaticAttemptIntegrityError(
      "Recorded CalculiX journal has a foreign project or run identity.",
    );
  }
  if (root.status === "pre-dispatch") {
    return deepFreeze({ ...base, status: "pre-dispatch" as const });
  }
  const dispatchedAt = iso(root.dispatchedAt, "$attempt.dispatchedAt");
  if (root.status === "dispatched") {
    return deepFreeze({ ...base, status: "dispatched" as const, dispatchedAt });
  }
  const known = {
    ...base,
    dispatchedAt,
    requestSha256: sha256Hex(root.requestSha256, "$attempt.requestSha256"),
    providerRunId: providerRunId(root.providerRunId, "$attempt.providerRunId"),
    resources: validateResources(root.resources, "$attempt.resources"),
  };
  if (root.status === "provider-run-known") {
    return deepFreeze({ ...known, status: "provider-run-known" as const });
  }
  const captured = {
    ...known,
    captureManifest: validateCas(root.captureManifest, "$attempt.captureManifest"),
  };
  if (root.status === "resources-captured") {
    return deepFreeze({ ...captured, status: "resources-captured" as const });
  }
  const evaluationDispatchedAt = iso(
    root.evaluationDispatchedAt,
    "$attempt.evaluationDispatchedAt",
  );
  if (root.status === "evaluation-dispatched") {
    return deepFreeze({
      ...captured,
      status: "evaluation-dispatched" as const,
      evaluationDispatchedAt,
    });
  }
  const evaluationCapture = validateCas(
    root.evaluationCapture,
    "$attempt.evaluationCapture",
  );
  if (root.status === "evaluation-captured") {
    return deepFreeze({
      ...captured,
      status: "evaluation-captured" as const,
      evaluationDispatchedAt,
      evaluationCapture,
    });
  }
  if (root.status === "completed") {
    return deepFreeze({
      ...captured,
      status: "completed" as const,
      evaluationDispatchedAt,
      evaluationCapture,
      snapshot: snapshotRef(root.snapshot, "$attempt.snapshot"),
    });
  }
  throw new CalculixRecordedStaticAttemptIntegrityError(
    "Recorded CalculiX journal has an unsupported status.",
  );
}

function fieldsForStatus(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const status = (value as Record<string, unknown>).status;
  if (status === "pre-dispatch") return [];
  if (status === "dispatched") return ["dispatchedAt"];
  if (status === "provider-run-known") {
    return ["dispatchedAt", "requestSha256", "providerRunId", "resources"];
  }
  if (status === "resources-captured") {
    return [
      "dispatchedAt",
      "requestSha256",
      "providerRunId",
      "resources",
      "captureManifest",
    ];
  }
  if (status === "evaluation-dispatched") {
    return [
      "dispatchedAt",
      "requestSha256",
      "providerRunId",
      "resources",
      "captureManifest",
      "evaluationDispatchedAt",
    ];
  }
  if (status === "evaluation-captured") {
    return [
      "dispatchedAt",
      "requestSha256",
      "providerRunId",
      "resources",
      "captureManifest",
      "evaluationDispatchedAt",
      "evaluationCapture",
    ];
  }
  if (status === "completed") {
    return [
      "dispatchedAt",
      "requestSha256",
      "providerRunId",
      "resources",
      "captureManifest",
      "evaluationDispatchedAt",
      "evaluationCapture",
      "snapshot",
    ];
  }
  return [];
}

function identity(
  value: CalculixRecordedStaticAttempt,
): Pick<BaseAttempt, "projectId" | "runId" | "planSha256" | "requestId"> {
  return {
    projectId: value.projectId,
    runId: value.runId,
    planSha256: value.planSha256,
    requestId: value.requestId,
  };
}

function validateResources(
  value: unknown,
  path: string,
): readonly CalculixRecordedStaticResource[] {
  const resources = arrayOf(value, path).map((item, index) => {
    const entry = exactRecord(
      item,
      ["role", "uri", "mediaType", "byteCount", "sha256"],
      `${path}[${index}]`,
    );
    return deepFreeze({
      role: safeId(entry.role, `${path}[${index}].role`),
      uri: canonicalResourceUri(entry.uri, `${path}[${index}].uri`),
      mediaType: nonEmptyText(entry.mediaType, `${path}[${index}].mediaType`),
      byteCount: nonNegative(entry.byteCount, `${path}[${index}].byteCount`),
      sha256: sha256Hex(entry.sha256, `${path}[${index}].sha256`),
    });
  });
  if (resources.length !== PROFILE.length) {
    throw new CalculixRecordedStaticAttemptIntegrityError(
      `${path} must contain exactly nine resources.`,
    );
  }
  for (let index = 0; index < PROFILE.length; index += 1) {
    const [role, mediaType] = PROFILE[index]!;
    const resource = resources[index]!;
    if (resource.role !== role || resource.mediaType !== mediaType) {
      throw new CalculixRecordedStaticAttemptIntegrityError(
        `${path} does not match the recorded CalculiX resource profile.`,
      );
    }
  }
  rejectDuplicates(resources.map((resource) => resource.role), `${path} roles`);
  rejectDuplicates(resources.map((resource) => resource.uri), `${path} URIs`);
  return deepFreeze(resources);
}

function validateCas(value: unknown, path: string): CalculixRecordedStaticCasReference {
  const entry = exactRecord(value, ["uri", "byteCount", "sha256"], path);
  const sha256 = sha256Hex(entry.sha256, `${path}.sha256`);
  const uri = canonicalResourceUri(entry.uri, `${path}.uri`);
  if (!uri.endsWith(`/sha256/${sha256}`)) {
    throw new CalculixRecordedStaticAttemptIntegrityError(
      `${path}.uri must end in its exact sha256.`,
    );
  }
  return deepFreeze({
    uri,
    byteCount: nonNegative(entry.byteCount, `${path}.byteCount`),
    sha256,
  });
}

function snapshotRef(value: unknown, path: string) {
  const root = exactRecord(value, ["snapshotId", "revision", "subjectId"], path);
  return deepFreeze({
    snapshotId: safeId(root.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
}

function requestId(value: unknown, path: string): string {
  const id = nonEmptyText(value, path);
  if (!REQUEST_ID.test(id)) {
    throw new TypeError(`${path} is not a provider-safe request id.`);
  }
  return id;
}

function providerRunId(value: unknown, path: string): string {
  const id = nonEmptyText(value, path);
  if (!PROVIDER_RUN_ID.test(id)) {
    throw new TypeError(`${path} is not a recorded CalculiX run id.`);
  }
  return id;
}

function nonNegative(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function iso(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  try {
    if (new Date(text).toISOString() !== text) throw new Error();
  } catch {
    throw new TypeError(`${path} must be canonical ISO-8601 UTC.`);
  }
  return text;
}

async function writeAll(file: Deno.FsFile, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let written = 0;
  while (written < bytes.byteLength) {
    const count = await file.write(bytes.subarray(written));
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new CalculixRecordedStaticAttemptIntegrityError(
        "Recorded CalculiX journal made no write progress.",
      );
    }
    written += count;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await Deno.open(directory, { read: true });
  try {
    await handle.sync();
  } finally {
    handle.close();
  }
}
