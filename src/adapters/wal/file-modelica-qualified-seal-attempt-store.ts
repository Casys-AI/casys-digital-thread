/**
 * Offline-resumable journal for `simulate.seal-simulation-case@2`.
 *
 * The seal reads provider state but never writes it.  A collection record is
 * therefore created before the project run is claimed; after the claim every
 * recovery route reads this journal and local CAS only.  This deliberately
 * prevents a changed/offline provider from changing an already-started seal.
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

export const MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA =
  "modelica-qualified-seal-attempt/1.0" as const;

export interface ModelicaQualifiedSealCasReference {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface ModelicaQualifiedSealSourceReference {
  readonly role: "model" | "scenario" | "parameter_schema";
  readonly mediaType: string;
  readonly resourceUri: string;
  readonly cas: ModelicaQualifiedSealCasReference;
}

export interface ModelicaQualifiedSealCollection {
  readonly caseDigest: string;
  readonly simulationCase: ModelicaQualifiedSealCasReference;
  readonly manifest: ModelicaQualifiedSealCasReference;
  readonly sourceCapture: ModelicaQualifiedSealCasReference;
  readonly sources: readonly ModelicaQualifiedSealSourceReference[];
}

export interface ModelicaQualifiedSealPrepared extends ModelicaQualifiedSealCollection {
  readonly capturedAt: string;
  readonly sealBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly mrtr: {
    readonly decisionId: string;
    readonly inputFingerprint: string;
    readonly approvalId: string;
    readonly approvalFingerprint: string;
    readonly workItemId: string;
  };
  readonly authority: ModelicaQualifiedSealCasReference;
}

export type ModelicaQualifiedSealAttempt =
  | {
    readonly schemaVersion: typeof MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly status: "collected";
    readonly collection: ModelicaQualifiedSealCollection;
  }
  | {
    readonly schemaVersion: typeof MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly status: "prepared";
    readonly prepared: ModelicaQualifiedSealPrepared;
  }
  | {
    readonly schemaVersion: typeof MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly status: "snapshot-persisted" | "attached";
    readonly prepared: ModelicaQualifiedSealPrepared;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  };

/** A mismatched or malformed journal is never eligible for a fresh provider read. */
export class ModelicaQualifiedSealAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaQualifiedSealAttemptIntegrityError";
  }
}

export class FileModelicaQualifiedSealAttemptStore {
  constructor(
    private readonly directory = "state/local/modelica-qualified-seal-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<ModelicaQualifiedSealAttempt | undefined> {
    const path = await this.pathFor(projectId, runId);
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ModelicaQualifiedSealAttemptIntegrityError(
        "Modelica qualified seal journal is not JSON.",
      );
    }
    const attempt = validateModelicaQualifiedSealAttempt(parsed, projectId, runId);
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw new ModelicaQualifiedSealAttemptIntegrityError(
        "Modelica qualified seal journal is not canonical.",
      );
    }
    return attempt;
  }

  async recordCollected(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly collection: ModelicaQualifiedSealCollection;
  }): Promise<ModelicaQualifiedSealAttempt> {
    const fresh = validateModelicaQualifiedSealAttempt(
      {
        schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
        projectId: input.projectId,
        runId: input.runId,
        status: "collected",
        collection: input.collection,
      },
      input.projectId,
      input.runId,
    );
    if (fresh.status !== "collected") {
      throw new ModelicaQualifiedSealAttemptIntegrityError(
        "Modelica qualified seal collection did not produce a collected journal state.",
      );
    }
    return await this.#withLock(input.projectId, input.runId, async () => {
      const existing = await this.read(input.projectId, input.runId);
      if (existing) {
        if (
          deterministicJson(collectionOf(existing)) !==
            deterministicJson(fresh.collection)
        ) {
          throw new ModelicaQualifiedSealAttemptIntegrityError(
            "Modelica qualified seal collection conflicts with the existing run journal.",
          );
        }
        return existing;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  async prepare(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly prepared: ModelicaQualifiedSealPrepared;
  }): Promise<ModelicaQualifiedSealAttempt> {
    return await this.#withLock(input.projectId, input.runId, async () => {
      const existing = await this.#required(input.projectId, input.runId);
      const prepared = validatePrepared(input.prepared, "$prepared");
      if (
        deterministicJson(collectionOf(existing)) !==
          deterministicJson(collectionOfPrepared(prepared))
      ) {
        throw new ModelicaQualifiedSealAttemptIntegrityError(
          "Prepared Modelica qualified seal does not preserve its pre-claim collection.",
        );
      }
      const next = validateModelicaQualifiedSealAttempt(
        {
          schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
          projectId: input.projectId,
          runId: input.runId,
          status: "prepared",
          prepared,
        },
        input.projectId,
        input.runId,
      );
      if (existing.status !== "collected") {
        if (deterministicJson(existing) !== deterministicJson(next)) {
          throw new ModelicaQualifiedSealAttemptIntegrityError(
            "Prepared Modelica qualified seal conflicts with the existing run journal.",
          );
        }
        return existing;
      }
      await this.#replace(next);
      return next;
    });
  }

  async markSnapshotPersisted(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  }): Promise<ModelicaQualifiedSealAttempt> {
    return await this.#withLock(input.projectId, input.runId, async () => {
      const existing = await this.#required(input.projectId, input.runId);
      if (existing.status === "collected") {
        throw new ModelicaQualifiedSealAttemptIntegrityError(
          "Modelica qualified seal cannot persist a snapshot before preparation.",
        );
      }
      const snapshot = validateSnapshotRef(input.snapshot, "$snapshot");
      const next = validateModelicaQualifiedSealAttempt(
        {
          schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
          projectId: input.projectId,
          runId: input.runId,
          status: "snapshot-persisted",
          prepared: existing.prepared,
          snapshot,
        },
        input.projectId,
        input.runId,
      );
      if (existing.status !== "prepared") {
        if (deterministicJson(existing.snapshot) !== deterministicJson(snapshot)) {
          throw new ModelicaQualifiedSealAttemptIntegrityError(
            "Modelica qualified seal snapshot conflicts with the existing run journal.",
          );
        }
        return existing;
      }
      await this.#replace(next);
      return next;
    });
  }

  async markAttached(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  }): Promise<ModelicaQualifiedSealAttempt> {
    return await this.#withLock(input.projectId, input.runId, async () => {
      const existing = await this.#required(input.projectId, input.runId);
      if (existing.status === "collected" || existing.status === "prepared") {
        throw new ModelicaQualifiedSealAttemptIntegrityError(
          "Modelica qualified seal cannot attach before snapshot persistence.",
        );
      }
      const snapshot = validateSnapshotRef(input.snapshot, "$snapshot");
      const next = validateModelicaQualifiedSealAttempt(
        {
          schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
          projectId: input.projectId,
          runId: input.runId,
          status: "attached",
          prepared: existing.prepared,
          snapshot,
        },
        input.projectId,
        input.runId,
      );
      if (existing.status === "attached") {
        if (deterministicJson(existing) !== deterministicJson(next)) {
          throw new ModelicaQualifiedSealAttemptIntegrityError(
            "Modelica qualified seal attachment conflicts with the existing run journal.",
          );
        }
        return existing;
      }
      if (deterministicJson(existing.snapshot) !== deterministicJson(snapshot)) {
        throw new ModelicaQualifiedSealAttemptIntegrityError(
          "Modelica qualified seal attachment names a different snapshot.",
        );
      }
      await this.#replace(next);
      return next;
    });
  }

  async pathFor(projectId: string, runId: string): Promise<string> {
    safeId(projectId, "$projectId");
    safeId(runId, "$runId");
    const key = await fingerprintResourceBytes(
      new TextEncoder().encode(deterministicJson([projectId, runId])),
    );
    return `${this.directory.replace(/\/+$/, "")}/${key}.json`;
  }

  async #required(
    projectId: string,
    runId: string,
  ): Promise<ModelicaQualifiedSealAttempt> {
    const existing = await this.read(projectId, runId);
    if (!existing) {
      throw new ModelicaQualifiedSealAttemptIntegrityError(
        "Modelica qualified seal journal is missing.",
      );
    }
    return existing;
  }

  async #replace(attempt: ModelicaQualifiedSealAttempt): Promise<void> {
    const path = await this.pathFor(attempt.projectId, attempt.runId);
    await Deno.mkdir(this.directory, { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const bytes = new TextEncoder().encode(`${deterministicJson(attempt)}\n`);
    const file = await Deno.open(temporary, { createNew: true, write: true });
    try {
      let written = 0;
      while (written < bytes.byteLength) {
        const count = await file.write(bytes.subarray(written));
        if (!Number.isSafeInteger(count) || count < 1) {
          throw new ModelicaQualifiedSealAttemptIntegrityError(
            "Modelica qualified seal journal made no write progress.",
          );
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
    await Deno.rename(temporary, path);
    const directory = await Deno.open(this.directory, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    const reread = await this.read(attempt.projectId, attempt.runId);
    if (!reread || deterministicJson(reread) !== deterministicJson(attempt)) {
      throw new ModelicaQualifiedSealAttemptIntegrityError(
        "Modelica qualified seal journal was not durably reread.",
      );
    }
  }

  async #writeNew(attempt: ModelicaQualifiedSealAttempt): Promise<void> {
    const path = await this.pathFor(attempt.projectId, attempt.runId);
    await Deno.mkdir(this.directory, { recursive: true });
    const bytes = new TextEncoder().encode(`${deterministicJson(attempt)}\n`);
    const file = await Deno.open(path, { createNew: true, write: true });
    try {
      let written = 0;
      while (written < bytes.byteLength) {
        const count = await file.write(bytes.subarray(written));
        if (!Number.isSafeInteger(count) || count < 1) {
          throw new ModelicaQualifiedSealAttemptIntegrityError(
            "Modelica qualified seal journal made no write progress.",
          );
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
    const directory = await Deno.open(this.directory, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    const reread = await this.read(attempt.projectId, attempt.runId);
    if (!reread || deterministicJson(reread) !== deterministicJson(attempt)) {
      throw new ModelicaQualifiedSealAttemptIntegrityError(
        "Modelica qualified seal journal was not durably reread.",
      );
    }
  }

  async #withLock<T>(
    projectId: string,
    runId: string,
    body: () => Promise<T>,
  ): Promise<T> {
    const path = `${await this.pathFor(projectId, runId)}.lock`;
    await Deno.mkdir(this.directory, { recursive: true });
    const file = await Deno.open(path, { create: true, read: true, write: true });
    try {
      // Advisory OS lock is released by the kernel on process crash, unlike a
      // createNew sentinel which would leave an otherwise recoverable run
      // permanently blocked.
      await file.lock(true);
      return await body();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }
}

export function validateModelicaQualifiedSealAttempt(
  value: unknown,
  projectId?: string,
  runId?: string,
): ModelicaQualifiedSealAttempt {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "runId",
    "status",
    ...fieldsForStatus(value),
  ], "$attempt");
  literalValue(
    root.schemaVersion,
    MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const validatedProjectId = safeId(root.projectId, "$attempt.projectId");
  const validatedRunId = safeId(root.runId, "$attempt.runId");
  if (
    (projectId !== undefined && projectId !== validatedProjectId) ||
    (runId !== undefined && runId !== validatedRunId)
  ) {
    throw new ModelicaQualifiedSealAttemptIntegrityError(
      "Modelica qualified seal journal has foreign project or run identity.",
    );
  }
  if (root.status === "collected") {
    return deepFreeze({
      schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
      projectId: validatedProjectId,
      runId: validatedRunId,
      status: "collected" as const,
      collection: validateCollection(root.collection, "$attempt.collection"),
    });
  }
  if (root.status === "prepared") {
    return deepFreeze({
      schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
      projectId: validatedProjectId,
      runId: validatedRunId,
      status: "prepared" as const,
      prepared: validatePrepared(root.prepared, "$attempt.prepared"),
    });
  }
  if (root.status === "snapshot-persisted" || root.status === "attached") {
    return deepFreeze({
      schemaVersion: MODELICA_QUALIFIED_SEAL_ATTEMPT_SCHEMA,
      projectId: validatedProjectId,
      runId: validatedRunId,
      status: root.status,
      prepared: validatePrepared(root.prepared, "$attempt.prepared"),
      snapshot: validateSnapshotRef(root.snapshot, "$attempt.snapshot"),
    });
  }
  throw new ModelicaQualifiedSealAttemptIntegrityError(
    "Modelica qualified seal journal has an invalid status.",
  );
}

function fieldsForStatus(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const status = (value as Record<string, unknown>).status;
  if (status === "collected") return ["collection"];
  if (status === "prepared") return ["prepared"];
  if (status === "snapshot-persisted" || status === "attached") {
    return ["prepared", "snapshot"];
  }
  return [];
}

function validateCollection(
  value: unknown,
  path: string,
): ModelicaQualifiedSealCollection {
  const root = exactRecord(value, [
    "caseDigest",
    "simulationCase",
    "manifest",
    "sourceCapture",
    "sources",
  ], path);
  const sources = arrayOf(root.sources, `${path}.sources`).map((source, index) =>
    validateSource(source, `${path}.sources[${index}]`)
  );
  if (
    sources.length < 2 || !sources.some((source) => source.role === "model") ||
    !sources.some((source) => source.role === "scenario")
  ) {
    throw new ModelicaQualifiedSealAttemptIntegrityError(
      `${path}.sources must contain model and scenario.`,
    );
  }
  rejectDuplicates(sources.map((source) => source.role), `${path}.sources roles`);
  sources.sort((left, right) =>
    left.role < right.role ? -1 : left.role > right.role ? 1 : 0
  );
  return deepFreeze({
    caseDigest: sha256Hex(root.caseDigest, `${path}.caseDigest`),
    simulationCase: validateCas(root.simulationCase, `${path}.simulationCase`),
    manifest: validateCas(root.manifest, `${path}.manifest`),
    sourceCapture: validateCas(root.sourceCapture, `${path}.sourceCapture`),
    sources,
  });
}

function validatePrepared(value: unknown, path: string): ModelicaQualifiedSealPrepared {
  const root = exactRecord(value, [
    "caseDigest",
    "simulationCase",
    "manifest",
    "sourceCapture",
    "sources",
    "capturedAt",
    "sealBasis",
    "mrtr",
    "authority",
  ], path);
  const collection = validateCollection({
    caseDigest: root.caseDigest,
    simulationCase: root.simulationCase,
    manifest: root.manifest,
    sourceCapture: root.sourceCapture,
    sources: root.sources,
  }, path);
  const basis = validateSnapshotRef(root.sealBasis, `${path}.sealBasis`);
  const mrtr = exactRecord(root.mrtr, [
    "decisionId",
    "inputFingerprint",
    "approvalId",
    "approvalFingerprint",
    "workItemId",
  ], `${path}.mrtr`);
  return deepFreeze({
    ...collection,
    capturedAt: iso(root.capturedAt, `${path}.capturedAt`),
    sealBasis: basis,
    mrtr: {
      decisionId: safeId(mrtr.decisionId, `${path}.mrtr.decisionId`),
      inputFingerprint: sha256Hex(
        mrtr.inputFingerprint,
        `${path}.mrtr.inputFingerprint`,
      ),
      approvalId: safeId(mrtr.approvalId, `${path}.mrtr.approvalId`),
      approvalFingerprint: sha256Hex(
        mrtr.approvalFingerprint,
        `${path}.mrtr.approvalFingerprint`,
      ),
      workItemId: safeId(mrtr.workItemId, `${path}.mrtr.workItemId`),
    },
    authority: validateCas(root.authority, `${path}.authority`),
  });
}

function validateSource(
  value: unknown,
  path: string,
): ModelicaQualifiedSealSourceReference {
  const root = exactRecord(value, ["role", "mediaType", "resourceUri", "cas"], path);
  if (
    root.role !== "model" && root.role !== "scenario" &&
    root.role !== "parameter_schema"
  ) {
    throw new TypeError(`${path}.role is invalid.`);
  }
  const mediaType = nonEmptyText(root.mediaType, `${path}.mediaType`);
  const expectedMediaType = root.role === "model"
    ? "text/x-modelica"
    : "application/json";
  if (mediaType !== expectedMediaType) {
    throw new TypeError(`${path}.mediaType is not permitted for ${root.role}.`);
  }
  const cas = validateCas(root.cas, `${path}.cas`);
  if (!cas.uri.endsWith(`/sha256/${cas.sha256}`)) {
    throw new TypeError(`${path}.cas.uri must end in its exact sha256.`);
  }
  return deepFreeze({
    role: root.role,
    mediaType,
    resourceUri: canonicalResourceUri(root.resourceUri, `${path}.resourceUri`),
    cas,
  });
}

function validateCas(value: unknown, path: string): ModelicaQualifiedSealCasReference {
  const root = exactRecord(value, ["uri", "byteCount", "sha256"], path);
  const sha256 = sha256Hex(root.sha256, `${path}.sha256`);
  const uri = canonicalResourceUri(root.uri, `${path}.uri`);
  if (!uri.endsWith(`/sha256/${sha256}`)) {
    throw new TypeError(`${path}.uri must end in its exact sha256.`);
  }
  return deepFreeze({
    uri,
    byteCount: nonNegative(root.byteCount, `${path}.byteCount`),
    sha256,
  });
}

function validateSnapshotRef(
  value: unknown,
  path: string,
): {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
} {
  const root = exactRecord(value, ["snapshotId", "revision", "subjectId"], path);
  return deepFreeze({
    snapshotId: safeId(root.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
}

function collectionOf(
  attempt: ModelicaQualifiedSealAttempt,
): ModelicaQualifiedSealCollection {
  return attempt.status === "collected"
    ? attempt.collection
    : collectionOfPrepared(attempt.prepared);
}

function collectionOfPrepared(
  prepared: ModelicaQualifiedSealPrepared,
): ModelicaQualifiedSealCollection {
  const {
    capturedAt: _capturedAt,
    sealBasis: _sealBasis,
    mrtr: _mrtr,
    authority: _authority,
    ...collection
  } = prepared;
  return collection;
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
    if (new Date(text).toISOString() !== text) {
      throw new TypeError(`${path} must be canonical ISO-8601 UTC.`);
    }
  } catch {
    throw new TypeError(`${path} must be canonical ISO-8601 UTC.`);
  }
  return text;
}
