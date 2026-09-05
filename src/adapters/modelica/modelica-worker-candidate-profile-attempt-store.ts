/**
 * Append-only per-profile WAL for Modelica worker candidate qualification.
 *
 * This is not the product qualified-kit or admitted execution attempt store.
 * Phases are separate create-new files. Identity, including startedAt, is
 * reused; a later phase never invents a new timestamp.
 */

import { sha256Hex } from "../../domain/compile/source/provider-resource-reader.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { writeNewAttemptFileDurably } from "../shared/wal/durable-attempt-file-writes.ts";

export const MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA =
  "modelica-worker-candidate-profile-attempt/1.0" as const;

export type ModelicaWorkerCandidateProfileProofId =
  | "openmodelica-qualified-kit"
  | "openmodelica-admitted-modelica";

export interface ModelicaWorkerCandidateProfileAttemptIdentity {
  readonly profileId: ModelicaWorkerCandidateProfileProofId;
  readonly importRecordFingerprint: string;
  readonly candidateReference: string;
  readonly microsandboxManifestDigest: string;
  readonly observedHostFingerprint: ContentFingerprint;
  readonly profileFingerprint: ContentFingerprint;
  readonly executionRunId: string;
  readonly sourceSha256: string;
  readonly startedAt: string;
}

export interface ModelicaWorkerCandidateProfileOutputEvidence {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface ModelicaWorkerCandidateProfileAttestation {
  readonly receiptFingerprint: ContentFingerprint;
  readonly outputs: readonly ModelicaWorkerCandidateProfileOutputEvidence[];
  readonly destruction: "proven";
  readonly attestedAt: string;
}

export type ModelicaWorkerCandidateProfileAttempt =
  | {
    readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA;
    readonly phase: "prepared";
    readonly identity: ModelicaWorkerCandidateProfileAttemptIdentity;
  }
  | {
    readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA;
    readonly phase: "dispatching";
    readonly identity: ModelicaWorkerCandidateProfileAttemptIdentity;
    readonly dispatch: {
      readonly dispatchedAt: string;
      readonly producerGeneration: 0;
    };
  }
  | {
    readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA;
    readonly phase: "attested";
    readonly identity: ModelicaWorkerCandidateProfileAttemptIdentity;
    readonly dispatch: {
      readonly dispatchedAt: string;
      readonly producerGeneration: 0;
    };
    readonly attestation: ModelicaWorkerCandidateProfileAttestation;
  };

const NO_PROGRESS = "Modelica candidate profile WAL made no durable write progress.";
const PHASE_FILES = {
  prepared: "prepared.json",
  dispatching: "dispatching.json",
  attested: "attested.json",
} as const;

export class FileModelicaWorkerCandidateProfileAttemptStore {
  readonly #directory: string;
  readonly #durabilitySyncBoundary: string;

  constructor(directory: string, durabilitySyncBoundary: string) {
    this.#directory = nonEmptyText(directory, "$candidateProfileAttempt.directory");
    this.#durabilitySyncBoundary = nonEmptyText(
      durabilitySyncBoundary,
      "$candidateProfileAttempt.durabilitySyncBoundary",
    );
  }

  async read(): Promise<ModelicaWorkerCandidateProfileAttempt | undefined> {
    const attested = await this.#readPhase("attested");
    if (attested) return attested;
    const dispatching = await this.#readPhase("dispatching");
    if (dispatching) return dispatching;
    return await this.#readPhase("prepared");
  }

  async prepare(
    identity: ModelicaWorkerCandidateProfileAttemptIdentity,
  ): Promise<Extract<ModelicaWorkerCandidateProfileAttempt, { phase: "prepared" }>> {
    const parsed = parseAttempt({
      schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
      phase: "prepared",
      identity,
    });
    if (parsed.phase !== "prepared") {
      throw new Error("Modelica candidate profile prepare did not stay prepared.");
    }
    return await this.#writePhase("prepared", parsed);
  }

  async markDispatching(
    identity: ModelicaWorkerCandidateProfileAttemptIdentity,
  ): Promise<Extract<ModelicaWorkerCandidateProfileAttempt, { phase: "dispatching" }>> {
    const prepared = await this.#requirePhase("prepared");
    assertSameIdentity(prepared.identity, identity);
    const parsed = parseAttempt({
      schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
      phase: "dispatching",
      identity: prepared.identity,
      dispatch: {
        dispatchedAt: prepared.identity.startedAt,
        producerGeneration: 0,
      },
    });
    if (parsed.phase !== "dispatching") {
      throw new Error("Modelica candidate profile dispatch did not stay dispatching.");
    }
    return await this.#writePhase("dispatching", parsed);
  }

  async attest(
    identity: ModelicaWorkerCandidateProfileAttemptIdentity,
    attestation: ModelicaWorkerCandidateProfileAttestation,
  ): Promise<Extract<ModelicaWorkerCandidateProfileAttempt, { phase: "attested" }>> {
    const dispatching = await this.#requirePhase("dispatching");
    assertSameIdentity(dispatching.identity, identity);
    if (attestation.attestedAt !== dispatching.identity.startedAt) {
      throw new Error(
        "Modelica candidate profile attestation must reuse the first-run timestamp.",
      );
    }
    const parsed = parseAttempt({
      schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
      phase: "attested",
      identity: dispatching.identity,
      dispatch: dispatching.dispatch,
      attestation,
    });
    if (parsed.phase !== "attested") {
      throw new Error("Modelica candidate profile attest did not stay attested.");
    }
    return await this.#writePhase("attested", parsed);
  }

  async #requirePhase<Phase extends ModelicaWorkerCandidateProfileAttempt["phase"]>(
    phase: Phase,
  ): Promise<Extract<ModelicaWorkerCandidateProfileAttempt, { phase: Phase }>> {
    const attempt = await this.#readPhase(phase);
    if (!attempt || attempt.phase !== phase) {
      throw new Error(
        `Modelica candidate profile WAL requires an existing ${phase} record.`,
      );
    }
    return attempt as Extract<ModelicaWorkerCandidateProfileAttempt, { phase: Phase }>;
  }

  async #readPhase(
    phase: ModelicaWorkerCandidateProfileAttempt["phase"],
  ): Promise<ModelicaWorkerCandidateProfileAttempt | undefined> {
    const path = `${this.#directory}/${PHASE_FILES[phase]}`;
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
      throw new Error("The Modelica candidate profile WAL is not JSON.");
    }
    const attempt = parseAttempt(parsed);
    if (attempt.phase !== phase) {
      throw new Error("The Modelica candidate profile WAL phase file is mislabelled.");
    }
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw new Error("The Modelica candidate profile WAL is not canonical.");
    }
    return attempt;
  }

  async #writePhase<Phase extends ModelicaWorkerCandidateProfileAttempt["phase"]>(
    phase: Phase,
    attempt: Extract<ModelicaWorkerCandidateProfileAttempt, { phase: Phase }>,
  ): Promise<Extract<ModelicaWorkerCandidateProfileAttempt, { phase: Phase }>> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const path = `${this.#directory}/${PHASE_FILES[phase]}`;
    const text = `${deterministicJson(attempt)}\n`;
    try {
      const existing = await Deno.readTextFile(path);
      if (existing === text) return attempt;
      throw new Error(
        "A different Modelica candidate profile WAL already occupies this phase.",
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await writeNewAttemptFileDurably(
      path,
      text,
      this.#directory,
      NO_PROGRESS,
      undefined,
      this.#durabilitySyncBoundary,
    );
    if (await Deno.readTextFile(path) !== text) {
      throw new Error("The Modelica candidate profile WAL failed durable reread.");
    }
    return attempt;
  }
}

export function parseAttempt(
  value: unknown,
): ModelicaWorkerCandidateProfileAttempt {
  const root = exactRecord(
    value,
    rootKeys(value),
    "$modelicaCandidateProfileAttempt",
  );
  literalValue(
    root.schemaVersion,
    MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
    "$modelicaCandidateProfileAttempt.schemaVersion",
  );
  const identity = parseIdentity(root.identity);
  if (root.phase === "prepared") {
    return Object.freeze({
      schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
      phase: "prepared",
      identity,
    });
  }
  const dispatch = parseDispatch(root.dispatch, identity.startedAt);
  if (root.phase === "dispatching") {
    return Object.freeze({
      schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
      phase: "dispatching",
      identity,
      dispatch,
    });
  }
  if (root.phase !== "attested") {
    throw new TypeError("Modelica candidate profile WAL phase is not registered.");
  }
  return Object.freeze({
    schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_ATTEMPT_SCHEMA,
    phase: "attested",
    identity,
    dispatch,
    attestation: parseAttestation(root.attestation, identity.startedAt),
  });
}

function rootKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Modelica candidate profile WAL must be a JSON object.");
  }
  const phase = (value as { phase?: unknown }).phase;
  if (phase === "prepared") return ["schemaVersion", "phase", "identity"];
  if (phase === "dispatching") {
    return ["schemaVersion", "phase", "identity", "dispatch"];
  }
  if (phase === "attested") {
    return ["schemaVersion", "phase", "identity", "dispatch", "attestation"];
  }
  throw new TypeError("Modelica candidate profile WAL phase is not registered.");
}

function parseIdentity(
  value: unknown,
): ModelicaWorkerCandidateProfileAttemptIdentity {
  const root = exactRecord(value, [
    "profileId",
    "importRecordFingerprint",
    "candidateReference",
    "microsandboxManifestDigest",
    "observedHostFingerprint",
    "profileFingerprint",
    "executionRunId",
    "sourceSha256",
    "startedAt",
  ], "$modelicaCandidateProfileAttempt.identity");
  const profileId = parseProfileId(root.profileId);
  const startedAt = nonEmptyText(
    root.startedAt,
    "$modelicaCandidateProfileAttempt.identity.startedAt",
  );
  if (Number.isNaN(Date.parse(startedAt))) {
    throw new TypeError(
      "Modelica candidate profile startedAt must be an exact timestamp.",
    );
  }
  return Object.freeze({
    profileId,
    importRecordFingerprint: sha256Digest(
      root.importRecordFingerprint,
      "$modelicaCandidateProfileAttempt.identity.importRecordFingerprint",
    ),
    candidateReference: nonEmptyText(
      root.candidateReference,
      "$modelicaCandidateProfileAttempt.identity.candidateReference",
    ),
    microsandboxManifestDigest: sha256Digest(
      root.microsandboxManifestDigest,
      "$modelicaCandidateProfileAttempt.identity.microsandboxManifestDigest",
    ),
    observedHostFingerprint: contentFingerprint(
      root.observedHostFingerprint,
      "$modelicaCandidateProfileAttempt.identity.observedHostFingerprint",
    ),
    profileFingerprint: contentFingerprint(
      root.profileFingerprint,
      "$modelicaCandidateProfileAttempt.identity.profileFingerprint",
    ),
    executionRunId: safeId(
      root.executionRunId,
      "$modelicaCandidateProfileAttempt.identity.executionRunId",
    ),
    sourceSha256: sha256Hex(
      root.sourceSha256,
      "$modelicaCandidateProfileAttempt.identity.sourceSha256",
    ),
    startedAt,
  });
}

function parseDispatch(
  value: unknown,
  startedAt: string,
): { readonly dispatchedAt: string; readonly producerGeneration: 0 } {
  const root = exactRecord(
    value,
    ["dispatchedAt", "producerGeneration"],
    "$modelicaCandidateProfileAttempt.dispatch",
  );
  literalValue(
    root.producerGeneration,
    0,
    "$modelicaCandidateProfileAttempt.dispatch.producerGeneration",
  );
  const dispatchedAt = nonEmptyText(
    root.dispatchedAt,
    "$modelicaCandidateProfileAttempt.dispatch.dispatchedAt",
  );
  if (dispatchedAt !== startedAt) {
    throw new TypeError(
      "Modelica candidate profile dispatch must reuse the first-run timestamp.",
    );
  }
  return Object.freeze({ dispatchedAt, producerGeneration: 0 as const });
}

function parseAttestation(
  value: unknown,
  startedAt: string,
): ModelicaWorkerCandidateProfileAttestation {
  const root = exactRecord(value, [
    "receiptFingerprint",
    "outputs",
    "destruction",
    "attestedAt",
  ], "$modelicaCandidateProfileAttempt.attestation");
  literalValue(
    root.destruction,
    "proven",
    "$modelicaCandidateProfileAttempt.attestation.destruction",
  );
  const attestedAt = nonEmptyText(
    root.attestedAt,
    "$modelicaCandidateProfileAttempt.attestation.attestedAt",
  );
  if (attestedAt !== startedAt) {
    throw new TypeError(
      "Modelica candidate profile attestation must reuse the first-run timestamp.",
    );
  }
  if (!Array.isArray(root.outputs) || root.outputs.length === 0) {
    throw new TypeError(
      "Modelica candidate profile attestation outputs must be a non-empty array.",
    );
  }
  return Object.freeze({
    receiptFingerprint: contentFingerprint(
      root.receiptFingerprint,
      "$modelicaCandidateProfileAttempt.attestation.receiptFingerprint",
    ),
    outputs: Object.freeze(root.outputs.map((item, index) => {
      const output = exactRecord(
        item,
        ["role", "byteCount", "sha256"],
        `$modelicaCandidateProfileAttempt.attestation.outputs[${index}]`,
      );
      return Object.freeze({
        role: nonEmptyText(
          output.role,
          `$modelicaCandidateProfileAttempt.attestation.outputs[${index}].role`,
        ),
        byteCount: positiveInteger(
          output.byteCount,
          `$modelicaCandidateProfileAttempt.attestation.outputs[${index}].byteCount`,
        ),
        sha256: sha256Hex(
          output.sha256,
          `$modelicaCandidateProfileAttempt.attestation.outputs[${index}].sha256`,
        ),
      });
    })),
    destruction: "proven" as const,
    attestedAt,
  });
}

export function parseProfileId(value: unknown): ModelicaWorkerCandidateProfileProofId {
  if (
    value === "openmodelica-qualified-kit" || value === "openmodelica-admitted-modelica"
  ) {
    return value;
  }
  throw new TypeError("Modelica candidate profile proof id is not server-owned.");
}

function assertSameIdentity(
  left: ModelicaWorkerCandidateProfileAttemptIdentity,
  right: ModelicaWorkerCandidateProfileAttemptIdentity,
): void {
  if (deterministicJson(left) !== deterministicJson(right)) {
    throw new Error(
      "Modelica candidate profile WAL identity diverged from the bound import.",
    );
  }
}

function sha256Digest(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError(`${path} must be an exact lowercase sha256 digest.`);
  }
  return digest;
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return Object.freeze({
    algorithm: "sha256" as const,
    digest: sha256Hex(root.digest, `${path}.digest`),
  });
}
