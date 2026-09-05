/**
 * Append-only WAL for ngspice-worker candidate qualification.
 *
 * This is not the product admitted-SPICE execution attempt store. Phases are
 * separate create-new files. Identity, including startedAt, is reused; a later
 * phase never invents a new timestamp.
 */

import { sha256Hex } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { writeNewAttemptFileDurably } from "../../../shared/wal/durable-attempt-file-writes.ts";

export const NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA =
  "ngspice-worker-candidate-attempt/1.0" as const;

export interface NgspiceWorkerCandidateAttemptIdentity {
  readonly importRecordFingerprint: string;
  readonly candidateReference: string;
  readonly microsandboxManifestDigest: string;
  readonly observedHostFingerprint: ContentFingerprint;
  readonly profileFingerprint: ContentFingerprint;
  readonly executionRunId: string;
  readonly sourceSha256: string;
  readonly startedAt: string;
}

export interface NgspiceWorkerCandidateOutputEvidence {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface NgspiceWorkerCandidateAttestation {
  readonly receiptFingerprint: ContentFingerprint;
  readonly outputs: readonly NgspiceWorkerCandidateOutputEvidence[];
  readonly destruction: "proven";
  readonly attestedAt: string;
}

export type NgspiceWorkerCandidateAttempt =
  | {
    readonly schemaVersion: typeof NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA;
    readonly phase: "prepared";
    readonly identity: NgspiceWorkerCandidateAttemptIdentity;
  }
  | {
    readonly schemaVersion: typeof NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA;
    readonly phase: "dispatching";
    readonly identity: NgspiceWorkerCandidateAttemptIdentity;
    readonly dispatch: {
      readonly dispatchedAt: string;
      readonly producerGeneration: 0;
    };
  }
  | {
    readonly schemaVersion: typeof NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA;
    readonly phase: "attested";
    readonly identity: NgspiceWorkerCandidateAttemptIdentity;
    readonly dispatch: {
      readonly dispatchedAt: string;
      readonly producerGeneration: 0;
    };
    readonly attestation: NgspiceWorkerCandidateAttestation;
  };

const NO_PROGRESS = "ngspice-worker candidate WAL made no durable write progress.";
const PHASE_FILES = {
  prepared: "prepared.json",
  dispatching: "dispatching.json",
  attested: "attested.json",
} as const;

export class FileNgspiceWorkerCandidateAttemptStore {
  readonly #directory: string;
  readonly #durabilitySyncBoundary: string;

  constructor(directory: string, durabilitySyncBoundary: string) {
    this.#directory = nonEmptyText(directory, "$ngspiceCandidateAttempt.directory");
    this.#durabilitySyncBoundary = nonEmptyText(
      durabilitySyncBoundary,
      "$ngspiceCandidateAttempt.durabilitySyncBoundary",
    );
  }

  async read(): Promise<NgspiceWorkerCandidateAttempt | undefined> {
    const attested = await this.#readPhase("attested");
    if (attested) return attested;
    const dispatching = await this.#readPhase("dispatching");
    if (dispatching) return dispatching;
    return await this.#readPhase("prepared");
  }

  async prepare(
    identity: NgspiceWorkerCandidateAttemptIdentity,
  ): Promise<Extract<NgspiceWorkerCandidateAttempt, { phase: "prepared" }>> {
    const parsed = parseNgspiceWorkerCandidateAttempt({
      schemaVersion: NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
      phase: "prepared",
      identity,
    });
    if (parsed.phase !== "prepared") {
      throw new Error("ngspice-worker candidate prepare did not stay prepared.");
    }
    return await this.#writePhase("prepared", parsed);
  }

  async markDispatching(
    identity: NgspiceWorkerCandidateAttemptIdentity,
  ): Promise<Extract<NgspiceWorkerCandidateAttempt, { phase: "dispatching" }>> {
    const prepared = await this.#requirePhase("prepared");
    assertSameIdentity(prepared.identity, identity);
    const parsed = parseNgspiceWorkerCandidateAttempt({
      schemaVersion: NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
      phase: "dispatching",
      identity: prepared.identity,
      dispatch: {
        dispatchedAt: prepared.identity.startedAt,
        producerGeneration: 0,
      },
    });
    if (parsed.phase !== "dispatching") {
      throw new Error("ngspice-worker candidate dispatch did not stay dispatching.");
    }
    return await this.#writePhase("dispatching", parsed);
  }

  async attest(
    identity: NgspiceWorkerCandidateAttemptIdentity,
    attestation: NgspiceWorkerCandidateAttestation,
  ): Promise<Extract<NgspiceWorkerCandidateAttempt, { phase: "attested" }>> {
    const dispatching = await this.#requirePhase("dispatching");
    assertSameIdentity(dispatching.identity, identity);
    if (attestation.attestedAt !== dispatching.identity.startedAt) {
      throw new Error(
        "ngspice-worker candidate attestation must reuse the first-run timestamp.",
      );
    }
    const parsed = parseNgspiceWorkerCandidateAttempt({
      schemaVersion: NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
      phase: "attested",
      identity: dispatching.identity,
      dispatch: dispatching.dispatch,
      attestation,
    });
    if (parsed.phase !== "attested") {
      throw new Error("ngspice-worker candidate attest did not stay attested.");
    }
    return await this.#writePhase("attested", parsed);
  }

  async #requirePhase<Phase extends NgspiceWorkerCandidateAttempt["phase"]>(
    phase: Phase,
  ): Promise<Extract<NgspiceWorkerCandidateAttempt, { phase: Phase }>> {
    const attempt = await this.#readPhase(phase);
    if (!attempt || attempt.phase !== phase) {
      throw new Error(
        `ngspice-worker candidate WAL requires an existing ${phase} record.`,
      );
    }
    return attempt as Extract<NgspiceWorkerCandidateAttempt, { phase: Phase }>;
  }

  async #readPhase(
    phase: NgspiceWorkerCandidateAttempt["phase"],
  ): Promise<NgspiceWorkerCandidateAttempt | undefined> {
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
      throw new Error("The ngspice-worker candidate WAL is not JSON.");
    }
    const attempt = parseNgspiceWorkerCandidateAttempt(parsed);
    if (attempt.phase !== phase) {
      throw new Error("The ngspice-worker candidate WAL phase file is mislabelled.");
    }
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw new Error("The ngspice-worker candidate WAL is not canonical.");
    }
    return attempt;
  }

  async #writePhase<Phase extends NgspiceWorkerCandidateAttempt["phase"]>(
    phase: Phase,
    attempt: Extract<NgspiceWorkerCandidateAttempt, { phase: Phase }>,
  ): Promise<Extract<NgspiceWorkerCandidateAttempt, { phase: Phase }>> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const path = `${this.#directory}/${PHASE_FILES[phase]}`;
    const text = `${deterministicJson(attempt)}\n`;
    try {
      const existing = await Deno.readTextFile(path);
      if (existing === text) return attempt;
      throw new Error(
        "A different ngspice-worker candidate WAL already occupies this phase.",
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
      throw new Error("The ngspice-worker candidate WAL failed durable reread.");
    }
    return attempt;
  }
}

export function parseNgspiceWorkerCandidateAttempt(
  value: unknown,
): NgspiceWorkerCandidateAttempt {
  const root = exactRecord(
    value,
    rootKeys(value),
    "$ngspiceCandidateAttempt",
  );
  literalValue(
    root.schemaVersion,
    NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
    "$ngspiceCandidateAttempt.schemaVersion",
  );
  const identity = parseIdentity(root.identity);
  if (root.phase === "prepared") {
    return Object.freeze({
      schemaVersion: NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
      phase: "prepared",
      identity,
    });
  }
  const dispatch = parseDispatch(root.dispatch, identity.startedAt);
  if (root.phase === "dispatching") {
    return Object.freeze({
      schemaVersion: NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
      phase: "dispatching",
      identity,
      dispatch,
    });
  }
  if (root.phase !== "attested") {
    throw new TypeError("ngspice-worker candidate WAL phase is not registered.");
  }
  return Object.freeze({
    schemaVersion: NGSPICE_WORKER_CANDIDATE_ATTEMPT_SCHEMA,
    phase: "attested",
    identity,
    dispatch,
    attestation: parseAttestation(root.attestation, identity.startedAt),
  });
}

function rootKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("ngspice-worker candidate WAL must be a JSON object.");
  }
  const phase = (value as { phase?: unknown }).phase;
  if (phase === "prepared") return ["schemaVersion", "phase", "identity"];
  if (phase === "dispatching") {
    return ["schemaVersion", "phase", "identity", "dispatch"];
  }
  if (phase === "attested") {
    return ["schemaVersion", "phase", "identity", "dispatch", "attestation"];
  }
  throw new TypeError("ngspice-worker candidate WAL phase is not registered.");
}

function parseIdentity(
  value: unknown,
): NgspiceWorkerCandidateAttemptIdentity {
  const root = exactRecord(value, [
    "importRecordFingerprint",
    "candidateReference",
    "microsandboxManifestDigest",
    "observedHostFingerprint",
    "profileFingerprint",
    "executionRunId",
    "sourceSha256",
    "startedAt",
  ], "$ngspiceCandidateAttempt.identity");
  const startedAt = nonEmptyText(
    root.startedAt,
    "$ngspiceCandidateAttempt.identity.startedAt",
  );
  if (Number.isNaN(Date.parse(startedAt))) {
    throw new TypeError(
      "ngspice-worker candidate startedAt must be an exact timestamp.",
    );
  }
  return Object.freeze({
    importRecordFingerprint: sha256Digest(
      root.importRecordFingerprint,
      "$ngspiceCandidateAttempt.identity.importRecordFingerprint",
    ),
    candidateReference: nonEmptyText(
      root.candidateReference,
      "$ngspiceCandidateAttempt.identity.candidateReference",
    ),
    microsandboxManifestDigest: sha256Digest(
      root.microsandboxManifestDigest,
      "$ngspiceCandidateAttempt.identity.microsandboxManifestDigest",
    ),
    observedHostFingerprint: contentFingerprint(
      root.observedHostFingerprint,
      "$ngspiceCandidateAttempt.identity.observedHostFingerprint",
    ),
    profileFingerprint: contentFingerprint(
      root.profileFingerprint,
      "$ngspiceCandidateAttempt.identity.profileFingerprint",
    ),
    executionRunId: safeId(
      root.executionRunId,
      "$ngspiceCandidateAttempt.identity.executionRunId",
    ),
    sourceSha256: sha256Hex(
      root.sourceSha256,
      "$ngspiceCandidateAttempt.identity.sourceSha256",
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
    "$ngspiceCandidateAttempt.dispatch",
  );
  literalValue(
    root.producerGeneration,
    0,
    "$ngspiceCandidateAttempt.dispatch.producerGeneration",
  );
  const dispatchedAt = nonEmptyText(
    root.dispatchedAt,
    "$ngspiceCandidateAttempt.dispatch.dispatchedAt",
  );
  if (dispatchedAt !== startedAt) {
    throw new TypeError(
      "ngspice-worker candidate dispatch must reuse the first-run timestamp.",
    );
  }
  return Object.freeze({ dispatchedAt, producerGeneration: 0 as const });
}

function parseAttestation(
  value: unknown,
  startedAt: string,
): NgspiceWorkerCandidateAttestation {
  const root = exactRecord(value, [
    "receiptFingerprint",
    "outputs",
    "destruction",
    "attestedAt",
  ], "$ngspiceCandidateAttempt.attestation");
  literalValue(
    root.destruction,
    "proven",
    "$ngspiceCandidateAttempt.attestation.destruction",
  );
  const attestedAt = nonEmptyText(
    root.attestedAt,
    "$ngspiceCandidateAttempt.attestation.attestedAt",
  );
  if (attestedAt !== startedAt) {
    throw new TypeError(
      "ngspice-worker candidate attestation must reuse the first-run timestamp.",
    );
  }
  if (!Array.isArray(root.outputs) || root.outputs.length === 0) {
    throw new TypeError(
      "ngspice-worker candidate attestation outputs must be a non-empty array.",
    );
  }
  return Object.freeze({
    receiptFingerprint: contentFingerprint(
      root.receiptFingerprint,
      "$ngspiceCandidateAttempt.attestation.receiptFingerprint",
    ),
    outputs: Object.freeze(root.outputs.map((item, index) => {
      const output = exactRecord(
        item,
        ["role", "byteCount", "sha256"],
        `$ngspiceCandidateAttempt.attestation.outputs[${index}]`,
      );
      return Object.freeze({
        role: nonEmptyText(
          output.role,
          `$ngspiceCandidateAttempt.attestation.outputs[${index}].role`,
        ),
        byteCount: positiveInteger(
          output.byteCount,
          `$ngspiceCandidateAttempt.attestation.outputs[${index}].byteCount`,
        ),
        sha256: sha256Hex(
          output.sha256,
          `$ngspiceCandidateAttempt.attestation.outputs[${index}].sha256`,
        ),
      });
    })),
    destruction: "proven" as const,
    attestedAt,
  });
}

function assertSameIdentity(
  left: NgspiceWorkerCandidateAttemptIdentity,
  right: NgspiceWorkerCandidateAttemptIdentity,
): void {
  if (deterministicJson(left) !== deterministicJson(right)) {
    throw new Error(
      "ngspice-worker candidate WAL identity diverged from the bound import.",
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
