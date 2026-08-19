/**
 * Durable recovery state for `simulate.run-modelica-scenario@2`.
 *
 * The intent marker is persisted before submit.  Once `dispatched` is
 * durable, recovery is read-only (`request_get`) because a transport failure
 * can hide a provider-accepted request.  After `resources-captured`, recovery
 * uses only local CAS and this journal.
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
} from "../../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import {
  canonicalResourceUri,
  compareAsciiCodeUnits,
  fingerprintResourceBytes,
  sha256Hex,
} from "../../../../domain/analysis/provider-resource-reader.ts";

export const MODELICA_RECORDED_SCENARIO_ATTEMPT_SCHEMA =
  "modelica-recorded-scenario-attempt/2.0" as const;

export interface ModelicaRecordedCasReference {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface ModelicaRecordedProviderResource {
  readonly role: string;
  readonly uri: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface ModelicaRecordedEvidence {
  readonly runId: string;
  readonly status: "succeeded" | "failed" | "timed_out";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resolvedParameters: Readonly<
    Record<string, { readonly value: number; readonly unit: string }>
  >;
  readonly metrics: Readonly<
    Record<string, { readonly value: number; readonly unit: string }>
  >;
  readonly warnings: readonly string[];
}

interface BaseAttempt {
  readonly schemaVersion: typeof MODELICA_RECORDED_SCENARIO_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  /** Full-byte ROP2 fingerprint, not a caller-selected plan label. */
  readonly planSha256: string;
  readonly requestId: string;
  readonly manifestSha256: string;
  readonly preparedAt: string;
}

export type ModelicaRecordedScenarioAttempt =
  | (BaseAttempt & { readonly status: "pre-dispatch" })
  | (BaseAttempt & { readonly status: "dispatched"; readonly dispatchedAt: string })
  | (BaseAttempt & {
    readonly status: "provider-run-known";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
  })
  | (BaseAttempt & {
    readonly status: "resources-captured";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly ModelicaRecordedProviderResource[];
    readonly captureManifest: ModelicaRecordedCasReference;
    readonly evidence: ModelicaRecordedEvidence;
  })
  | (BaseAttempt & {
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly requestSha256: string;
    readonly providerRunId: string;
    readonly resources: readonly ModelicaRecordedProviderResource[];
    readonly captureManifest: ModelicaRecordedCasReference;
    readonly evidence: ModelicaRecordedEvidence;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  });

export class ModelicaRecordedScenarioOutcomeUnknownError extends Error {
  constructor(
    message =
      "The recorded Modelica request may have reached the provider; recovery is request_get only.",
  ) {
    super(message);
    this.name = "ModelicaRecordedScenarioOutcomeUnknownError";
  }
}

export class ModelicaRecordedScenarioAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaRecordedScenarioAttemptIntegrityError";
  }
}

/** One OS-locked, immutable-identity journal file per project/run pair. */
export class FileModelicaRecordedScenarioAttemptStore {
  constructor(
    private readonly directory = "state/local/modelica-recorded-scenario-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<ModelicaRecordedScenarioAttempt | undefined> {
    const path = await this.pathFor(projectId, runId);
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ModelicaRecordedScenarioAttemptIntegrityError(
        "Recorded Modelica journal is not JSON.",
      );
    }
    const attempt = validateModelicaRecordedScenarioAttempt(value, projectId, runId);
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw new ModelicaRecordedScenarioAttemptIntegrityError(
        "Recorded Modelica journal is not canonical.",
      );
    }
    return attempt;
  }

  async begin(
    input: Omit<BaseAttempt, "schemaVersion" | "status">,
  ): Promise<ModelicaRecordedScenarioAttempt> {
    const fresh = validateModelicaRecordedScenarioAttempt(
      {
        schemaVersion: MODELICA_RECORDED_SCENARIO_ATTEMPT_SCHEMA,
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
          throw new ModelicaRecordedScenarioAttemptIntegrityError(
            "Recorded Modelica journal conflicts with a different sealed request.",
          );
        }
        return existing;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  async markDispatched(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly dispatchedAt: string;
    },
  ): Promise<ModelicaRecordedScenarioAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      const dispatchedAt = iso(input.dispatchedAt, "$dispatchedAt");
      if (current.status !== "pre-dispatch") {
        if (current.status === "dispatched" && current.dispatchedAt === dispatchedAt) {
          return current;
        }
        return current;
      }
      return { ...current, status: "dispatched" as const, dispatchedAt };
    });
  }

  async recordProviderRun(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly requestSha256: string;
    readonly manifestSha256: string;
    readonly providerRunId: string;
  }): Promise<ModelicaRecordedScenarioAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (current.status === "pre-dispatch") {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Provider run cannot be known before durable dispatch intent.",
        );
      }
      const requestSha256 = sha256Hex(input.requestSha256, "$requestSha256");
      const manifestSha256 = sha256Hex(input.manifestSha256, "$manifestSha256");
      const providerRunId = safeId(input.providerRunId, "$providerRunId");
      if (current.manifestSha256 !== manifestSha256) {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Provider run binds a different qualified manifest.",
        );
      }
      if (current.status === "dispatched") {
        return {
          ...current,
          status: "provider-run-known" as const,
          requestSha256,
          providerRunId,
        };
      }
      if (
        current.requestSha256 !== requestSha256 ||
        current.providerRunId !== providerRunId
      ) {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Provider run recovery conflicts with durable request identity.",
        );
      }
      return current;
    });
  }

  async recordResourcesCaptured(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly resources: readonly ModelicaRecordedProviderResource[];
    readonly captureManifest: ModelicaRecordedCasReference;
    readonly evidence: ModelicaRecordedEvidence;
  }): Promise<ModelicaRecordedScenarioAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (current.status === "pre-dispatch" || current.status === "dispatched") {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Provider resources cannot be captured before a durable provider run identity.",
        );
      }
      const resources = validateResources(input.resources, "$resources");
      const captureManifest = validateCas(input.captureManifest, "$captureManifest");
      const evidence = validateEvidence(input.evidence, "$evidence");
      if (evidence.runId !== current.providerRunId) {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Captured Modelica observations name a different provider run.",
        );
      }
      if (current.status === "provider-run-known") {
        return {
          ...current,
          status: "resources-captured" as const,
          resources,
          captureManifest,
          evidence,
        };
      }
      if (
        deterministicJson({
          resources: current.resources,
          captureManifest: current.captureManifest,
          evidence: current.evidence,
        }) !==
          deterministicJson({ resources, captureManifest, evidence })
      ) {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Captured Modelica resources conflict with the durable capture.",
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
  }): Promise<ModelicaRecordedScenarioAttempt> {
    return await this.#transition(input.projectId, input.runId, (current) => {
      if (current.status !== "resources-captured" && current.status !== "completed") {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Recorded Modelica run cannot complete before its CAS capture is durable.",
        );
      }
      const snapshot = snapshotRef(input.snapshot, "$snapshot");
      if (current.status === "completed") {
        if (deterministicJson(current.snapshot) !== deterministicJson(snapshot)) {
          throw new ModelicaRecordedScenarioAttemptIntegrityError(
            "Recorded Modelica completion names a different snapshot.",
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
    const digest = await fingerprintResourceBytes(new TextEncoder().encode(
      deterministicJson([projectId, runId]),
    ));
    return `${this.directory.replace(/\/+$/, "")}/${digest}.json`;
  }

  async #transition(
    projectId: string,
    runId: string,
    transition: (
      current: ModelicaRecordedScenarioAttempt,
    ) => ModelicaRecordedScenarioAttempt,
  ): Promise<ModelicaRecordedScenarioAttempt> {
    return await this.#withLock(projectId, runId, async () => {
      const current = await this.read(projectId, runId);
      if (!current) {
        throw new ModelicaRecordedScenarioAttemptIntegrityError(
          "Recorded Modelica journal is missing.",
        );
      }
      const next = validateModelicaRecordedScenarioAttempt(
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

  async #writeNew(attempt: ModelicaRecordedScenarioAttempt): Promise<void> {
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

  async #replace(attempt: ModelicaRecordedScenarioAttempt): Promise<void> {
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

  async #assertReread(expected: ModelicaRecordedScenarioAttempt): Promise<void> {
    const reread = await this.read(expected.projectId, expected.runId);
    if (!reread || deterministicJson(reread) !== deterministicJson(expected)) {
      throw new ModelicaRecordedScenarioAttemptIntegrityError(
        "Recorded Modelica journal was not durably reread.",
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

export function validateModelicaRecordedScenarioAttempt(
  value: unknown,
  projectId?: string,
  runId?: string,
): ModelicaRecordedScenarioAttempt {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "runId",
    "planSha256",
    "requestId",
    "manifestSha256",
    "preparedAt",
    "status",
    ...fieldsForStatus(value),
  ], "$attempt");
  literalValue(
    root.schemaVersion,
    MODELICA_RECORDED_SCENARIO_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const base: BaseAttempt = {
    schemaVersion: MODELICA_RECORDED_SCENARIO_ATTEMPT_SCHEMA,
    projectId: safeId(root.projectId, "$attempt.projectId"),
    runId: safeId(root.runId, "$attempt.runId"),
    planSha256: sha256Hex(root.planSha256, "$attempt.planSha256"),
    requestId: safeId(root.requestId, "$attempt.requestId"),
    manifestSha256: sha256Hex(root.manifestSha256, "$attempt.manifestSha256"),
    preparedAt: iso(root.preparedAt, "$attempt.preparedAt"),
  };
  if (
    (projectId !== undefined && base.projectId !== projectId) ||
    (runId !== undefined && base.runId !== runId)
  ) {
    throw new ModelicaRecordedScenarioAttemptIntegrityError(
      "Recorded Modelica journal has a foreign project or run identity.",
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
    providerRunId: safeId(root.providerRunId, "$attempt.providerRunId"),
  };
  if (root.status === "provider-run-known") {
    return deepFreeze({ ...known, status: "provider-run-known" as const });
  }
  const captured = {
    ...known,
    resources: validateResources(root.resources, "$attempt.resources"),
    captureManifest: validateCas(root.captureManifest, "$attempt.captureManifest"),
    evidence: validateEvidence(root.evidence, "$attempt.evidence"),
  };
  if (captured.evidence.runId !== known.providerRunId) {
    throw new ModelicaRecordedScenarioAttemptIntegrityError(
      "Recorded evidence run does not match the provider run.",
    );
  }
  if (root.status === "resources-captured") {
    return deepFreeze({ ...captured, status: "resources-captured" as const });
  }
  if (root.status === "completed") {
    return deepFreeze({
      ...captured,
      status: "completed" as const,
      snapshot: snapshotRef(root.snapshot, "$attempt.snapshot"),
    });
  }
  throw new ModelicaRecordedScenarioAttemptIntegrityError(
    "Recorded Modelica journal has an unsupported status.",
  );
}

function fieldsForStatus(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const status = (value as Record<string, unknown>).status;
  if (status === "pre-dispatch") return [];
  if (status === "dispatched") return ["dispatchedAt"];
  if (status === "provider-run-known") {
    return ["dispatchedAt", "requestSha256", "providerRunId"];
  }
  if (status === "resources-captured") {
    return [
      "dispatchedAt",
      "requestSha256",
      "providerRunId",
      "resources",
      "captureManifest",
      "evidence",
    ];
  }
  if (status === "completed") {
    return [
      "dispatchedAt",
      "requestSha256",
      "providerRunId",
      "resources",
      "captureManifest",
      "evidence",
      "snapshot",
    ];
  }
  return [];
}

function identity(
  value: ModelicaRecordedScenarioAttempt,
): Pick<
  BaseAttempt,
  "projectId" | "runId" | "planSha256" | "requestId" | "manifestSha256"
> {
  return {
    projectId: value.projectId,
    runId: value.runId,
    planSha256: value.planSha256,
    requestId: value.requestId,
    manifestSha256: value.manifestSha256,
  };
}

function validateResources(
  value: unknown,
  path: string,
): readonly ModelicaRecordedProviderResource[] {
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
  if (resources.length === 0) {
    throw new ModelicaRecordedScenarioAttemptIntegrityError(
      `${path} must not be empty.`,
    );
  }
  rejectDuplicates(resources.map((resource) => resource.role), `${path} roles`);
  rejectDuplicates(resources.map((resource) => resource.uri), `${path} URIs`);
  resources.sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  return deepFreeze(resources);
}

function validateCas(value: unknown, path: string): ModelicaRecordedCasReference {
  const entry = exactRecord(value, ["uri", "byteCount", "sha256"], path);
  const sha256 = sha256Hex(entry.sha256, `${path}.sha256`);
  const uri = canonicalResourceUri(entry.uri, `${path}.uri`);
  if (!uri.endsWith(`/sha256/${sha256}`)) {
    throw new ModelicaRecordedScenarioAttemptIntegrityError(
      `${path}.uri must end in its exact sha256.`,
    );
  }
  return deepFreeze({
    uri,
    byteCount: nonNegative(entry.byteCount, `${path}.byteCount`),
    sha256,
  });
}

function validateEvidence(value: unknown, path: string): ModelicaRecordedEvidence {
  const root = exactRecord(value, [
    "runId",
    "status",
    "startedAt",
    "completedAt",
    "resolvedParameters",
    "metrics",
    "warnings",
  ], path);
  if (
    root.status !== "succeeded" && root.status !== "failed" &&
    root.status !== "timed_out"
  ) throw new TypeError(`${path}.status is unsupported.`);
  const startedAt = iso(root.startedAt, `${path}.startedAt`);
  const completedAt = iso(root.completedAt, `${path}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new TypeError(`${path}.completedAt precedes startedAt.`);
  }
  return deepFreeze({
    runId: safeId(root.runId, `${path}.runId`),
    status: root.status,
    startedAt,
    completedAt,
    resolvedParameters: quantities(
      root.resolvedParameters,
      `${path}.resolvedParameters`,
    ),
    metrics: quantities(root.metrics, `${path}.metrics`),
    warnings: arrayOf(root.warnings, `${path}.warnings`).map((warning, index) =>
      nonEmptyText(warning, `${path}.warnings[${index}]`)
    ),
  });
}

function quantities(
  value: unknown,
  path: string,
): Readonly<Record<string, { readonly value: number; readonly unit: string }>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const output: Record<string, { readonly value: number; readonly unit: string }> = {};
  for (const key of Object.keys(value).sort(compareAsciiCodeUnits)) {
    const entry = exactRecord((value as Record<string, unknown>)[key], [
      "value",
      "unit",
    ], `${path}.${key}`);
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
      throw new TypeError(`${path}.${key}.value must be finite.`);
    }
    output[safeId(key, `${path} key`)] = {
      value: entry.value,
      unit: nonEmptyText(entry.unit, `${path}.${key}.unit`),
    };
  }
  return deepFreeze(output);
}

function snapshotRef(value: unknown, path: string) {
  const root = exactRecord(value, ["snapshotId", "revision", "subjectId"], path);
  return deepFreeze({
    snapshotId: safeId(root.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
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
      throw new ModelicaRecordedScenarioAttemptIntegrityError(
        "Recorded Modelica journal made no write progress.",
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
