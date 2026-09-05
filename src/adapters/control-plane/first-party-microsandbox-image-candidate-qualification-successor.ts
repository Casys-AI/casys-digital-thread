/**
 * Maintainer-only successor authority for one first-party candidate
 * qualification retry after a proven pre-worker infrastructure failure.
 *
 * This is not a provider, image, digest, tool, or args selector. It never
 * rewrites predecessor WAL/CAS/events, never advances a catalogue pin, and
 * never claims promotion. CalculiX already owns a same-run generation 0→1
 * cycle and does not use this record. This path sequences a new run identity
 * at IsolatedCodeRunner producerGeneration 0 as ordinal 1.
 */

import type {
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  type IsolatedCodeExecutionReceipt,
  validateIsolatedCodeExecutionDestruction,
} from "../../domain/compile/isolation/isolated-code-execution.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
} from "./first-party-microsandbox-image-candidate-import-record.ts";

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA =
  "first-party-microsandbox-image-candidate-qualification-successor/1.0" as const;

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON =
  "infrastructure-failure" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;
const RUN_CLOSED_FENCE_SCHEMA = "isolated-output-run-closed-fence/1.0" as const;

export type CandidateQualificationPredecessorDestruction = Extract<
  IsolatedCodeExecutionReceipt["destruction"],
  { readonly status: "proven" }
>;

export interface FirstPartyMicrosandboxImageCandidateQualificationPredecessorAttempt {
  readonly id: string;
  readonly runId: string;
  readonly ordinal: 0;
  readonly producerGeneration: 0;
  readonly publication: "not-published";
  readonly destruction: CandidateQualificationPredecessorDestruction;
}

export interface FirstPartyMicrosandboxImageCandidateQualificationSuccessorAttempt {
  readonly id: string;
  readonly runId: string;
  readonly ordinal: 1;
  readonly producerGeneration: 0;
}

export interface FirstPartyMicrosandboxImageCandidateQualificationSuccessor {
  readonly schemaVersion:
    typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA;
  readonly kind: "candidate-qualification-successor";
  readonly reason:
    typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON;
  readonly physicalImageId: string;
  readonly importRecord: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA;
  };
  readonly predecessor: {
    readonly fingerprint: ContentFingerprint;
    readonly ordinal: 0;
    readonly attempts:
      readonly FirstPartyMicrosandboxImageCandidateQualificationPredecessorAttempt[];
  };
  readonly successor: {
    readonly ordinal: 1;
    readonly attempts:
      readonly FirstPartyMicrosandboxImageCandidateQualificationSuccessorAttempt[];
  };
  readonly eligibleForPromotion: false;
}

export function firstPartyMicrosandboxImageCandidateQualificationSuccessorPath(
  stateRoot: string,
): string {
  return `${
    nonEmptyText(stateRoot, "$candidateQualificationSuccessor.stateRoot")
  }/successor.json`;
}

export function firstPartyMicrosandboxImageCandidateQualificationSuccessorRoot(
  stateRoot: string,
): string {
  return `${
    nonEmptyText(stateRoot, "$candidateQualificationSuccessor.stateRoot")
  }/successor`;
}

export async function buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
  input: {
    readonly physicalImageId: string;
    readonly importRecordFingerprint: string;
    readonly predecessorAttempts: readonly {
      readonly id: string;
      readonly runId: string;
      readonly destruction: CandidateQualificationPredecessorDestruction;
    }[];
  },
): Promise<FirstPartyMicrosandboxImageCandidateQualificationSuccessor> {
  if (input.predecessorAttempts.length === 0) {
    throw new TypeError(
      "$candidateQualificationSuccessor.predecessorAttempts must not be empty.",
    );
  }
  const predecessorAttempts = input.predecessorAttempts.map((attempt) => {
    const runId = safeId(
      attempt.runId,
      "$candidateQualificationSuccessor.predecessor.runId",
    );
    return Object.freeze({
      id: safeId(attempt.id, "$candidateQualificationSuccessor.predecessor.id"),
      runId,
      ordinal: 0 as const,
      producerGeneration: 0 as const,
      publication: "not-published" as const,
      destruction: parseProvenDestruction(
        attempt.destruction,
        runId,
        "$candidateQualificationSuccessor.predecessor.destruction",
      ),
    });
  });
  assertUniqueAttemptIds(predecessorAttempts);
  const importRecordFingerprint = requiredSha256(
    input.importRecordFingerprint,
    "candidate qualification successor import-record fingerprint",
  );
  const physicalImageId = safeId(
    input.physicalImageId,
    "$candidateQualificationSuccessor.physicalImageId",
  );
  const predecessorFingerprint = await sha256Fingerprint({
    schemaVersion:
      "first-party-microsandbox-image-candidate-qualification-predecessor/1.0",
    physicalImageId,
    importRecordFingerprint,
    ordinal: 0,
    attempts: predecessorAttempts,
  });
  const successorAttempts = await Promise.all(
    predecessorAttempts.map(async (attempt) =>
      Object.freeze({
        id: attempt.id,
        runId: await deriveSuccessorRunId({
          physicalImageId,
          importRecordFingerprint,
          attemptId: attempt.id,
          predecessorRunId: attempt.runId,
        }),
        ordinal: 1 as const,
        producerGeneration: 0 as const,
      })
    ),
  );
  return await parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor({
    schemaVersion:
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA,
    kind: "candidate-qualification-successor",
    reason: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON,
    physicalImageId,
    importRecord: {
      fingerprint: importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    },
    predecessor: {
      fingerprint: predecessorFingerprint,
      ordinal: 0,
      attempts: predecessorAttempts,
    },
    successor: {
      ordinal: 1,
      attempts: successorAttempts,
    },
    eligibleForPromotion: false,
  });
}

export async function parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
  value: unknown,
): Promise<FirstPartyMicrosandboxImageCandidateQualificationSuccessor> {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "reason",
    "physicalImageId",
    "importRecord",
    "predecessor",
    "successor",
    "eligibleForPromotion",
  ], "$candidateQualificationSuccessor");
  literalValue(
    root.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA,
    "$candidateQualificationSuccessor.schemaVersion",
  );
  literalValue(
    root.kind,
    "candidate-qualification-successor",
    "$candidateQualificationSuccessor.kind",
  );
  literalValue(
    root.reason,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON,
    "$candidateQualificationSuccessor.reason",
  );
  literalValue(
    root.eligibleForPromotion,
    false,
    "$candidateQualificationSuccessor.eligibleForPromotion",
  );
  const importRecord = exactRecord(root.importRecord, [
    "fingerprint",
    "schemaVersion",
  ], "$candidateQualificationSuccessor.importRecord");
  literalValue(
    importRecord.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    "$candidateQualificationSuccessor.importRecord.schemaVersion",
  );
  const predecessor = exactRecord(root.predecessor, [
    "fingerprint",
    "ordinal",
    "attempts",
  ], "$candidateQualificationSuccessor.predecessor");
  literalValue(
    predecessor.ordinal,
    0,
    "$candidateQualificationSuccessor.predecessor.ordinal",
  );
  const successor = exactRecord(root.successor, [
    "ordinal",
    "attempts",
  ], "$candidateQualificationSuccessor.successor");
  literalValue(
    successor.ordinal,
    1,
    "$candidateQualificationSuccessor.successor.ordinal",
  );
  const predecessorAttempts = parsePredecessorAttempts(
    predecessor.attempts,
    "$candidateQualificationSuccessor.predecessor.attempts",
  );
  const successorAttempts = parseSuccessorAttempts(
    successor.attempts,
    "$candidateQualificationSuccessor.successor.attempts",
  );
  if (predecessorAttempts.length !== successorAttempts.length) {
    throw new TypeError(
      "Candidate qualification successor attempts must pair 1:1 with the predecessor.",
    );
  }
  for (const [index, attempt] of predecessorAttempts.entries()) {
    const next = successorAttempts[index]!;
    if (attempt.id !== next.id) {
      throw new TypeError(
        "Candidate qualification successor attempt ids must retain the predecessor order.",
      );
    }
    if (attempt.runId === next.runId) {
      throw new TypeError(
        "Candidate qualification successor run identity must differ from its predecessor.",
      );
    }
  }
  const rebuilt = await rebuildSuccessor({
    physicalImageId: safeId(
      root.physicalImageId,
      "$candidateQualificationSuccessor.physicalImageId",
    ),
    importRecordFingerprint: requiredSha256(
      importRecord.fingerprint,
      "candidate qualification successor import-record fingerprint",
    ),
    predecessorFingerprint: contentFingerprint(
      predecessor.fingerprint,
      "candidate qualification successor predecessor fingerprint",
    ),
    predecessorAttempts,
    successorAttempts,
  });
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "Candidate qualification successor is not the exact rebuilt first-party successor record.",
    );
  }
  return rebuilt;
}

export async function persistFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
  stateRoot: string,
  record: FirstPartyMicrosandboxImageCandidateQualificationSuccessor,
): Promise<FirstPartyMicrosandboxImageCandidateQualificationSuccessor> {
  const parsed = await parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
    JSON.parse(deterministicJson(record)),
  );
  const path = firstPartyMicrosandboxImageCandidateQualificationSuccessorPath(
    stateRoot,
  );
  const text = `${deterministicJson(parsed)}\n`;
  try {
    const existing = await Deno.readTextFile(path);
    throw new Error(
      existing === text
        ? "Candidate qualification successor already consumed this predecessor."
        : "A different candidate qualification successor already occupies this import-record identity.",
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(stateRoot, { recursive: true });
  try {
    await Deno.writeTextFile(path, text, { createNew: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new Error(
        "Candidate qualification successor already consumed this predecessor.",
      );
    }
    throw error;
  }
  if (await Deno.readTextFile(path) !== text) {
    throw new Error("The candidate qualification successor failed durable reread.");
  }
  return parsed;
}

export async function readFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
  stateRoot: string,
): Promise<FirstPartyMicrosandboxImageCandidateQualificationSuccessor | undefined> {
  const path = firstPartyMicrosandboxImageCandidateQualificationSuccessorPath(
    stateRoot,
  );
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  const parsed = await parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
    JSON.parse(text),
  );
  if (`${deterministicJson(parsed)}\n` !== text) {
    throw new Error("The candidate qualification successor is not canonical.");
  }
  return parsed;
}

export async function assertNoCandidateQualificationRecord(
  stateRoot: string,
): Promise<void> {
  try {
    await Deno.stat(`${stateRoot}/qualification.json`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(
    "Candidate qualification successor refuses an already-successful qualification record.",
  );
}

export async function assertNoCandidateQualificationSuccessor(
  stateRoot: string,
): Promise<void> {
  const existing = await readFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
    stateRoot,
  );
  if (existing !== undefined) {
    throw new Error(
      "Candidate qualification successor already consumed this predecessor.",
    );
  }
}

export function requireSuccessorAttempt(
  successor: FirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  id: string,
): FirstPartyMicrosandboxImageCandidateQualificationSuccessorAttempt {
  const attempt = successor.successor.attempts.find((entry) => entry.id === id);
  if (attempt === undefined) {
    throw new Error(
      `Candidate qualification successor is missing attempt ${id}.`,
    );
  }
  return attempt;
}

export async function proveCandidateQualificationPredecessorUnpublishedAndDestroyed(
  ports: {
    readonly publications: IsolatedOutputPublicationReader;
    readonly recovery: IsolatedCodeRunRecovery;
  },
  runId: string,
): Promise<CandidateQualificationPredecessorDestruction> {
  const acceptedRunId = safeId(
    runId,
    "$candidateQualificationSuccessor.predecessor.runId",
  );
  let resolution;
  try {
    resolution = await ports.publications.resolvePublicationByRunId(
      acceptedRunId,
      0,
    );
  } catch {
    throw new Error(
      "Candidate qualification successor publication could not be resolved safely; unknown, divergent, or refused outcomes stay fail-closed.",
    );
  }
  if (resolution.status === "outcome-unknown") {
    throw new Error(
      "Candidate qualification successor requires proven not-published; publication outcome is unknown.",
    );
  }
  if (resolution.status === "published") {
    throw new Error(
      "Candidate qualification successor refuses an already-published predecessor.",
    );
  }
  if (resolution.status !== "not-published") {
    throw new Error(
      "Candidate qualification successor requires proven not-published.",
    );
  }
  let observed;
  try {
    observed = await ports.recovery.destroyByRunId(acceptedRunId, 0);
  } catch {
    throw new Error(
      "Candidate qualification successor requires proven run-scoped sandbox destruction.",
    );
  }
  const destruction = validateIsolatedCodeExecutionDestruction(
    observed,
    acceptedRunId,
  );
  if (destruction.status !== "proven" || destruction.runId !== acceptedRunId) {
    throw new Error(
      "Candidate qualification successor requires proven run-scoped sandbox destruction.",
    );
  }
  return destruction;
}

export async function readCandidateQualificationPredecessorRunFence(
  outputCasDirectory: string,
  runId: string,
): Promise<string> {
  const acceptedRunId = safeId(
    runId,
    "$candidateQualificationSuccessor.predecessor.runId",
  );
  const runKey = (await sha256Fingerprint({
    schemaVersion: "isolated-output-run-key/1.0",
    runId: acceptedRunId,
  })).digest;
  const path = `${
    nonEmptyText(outputCasDirectory, "$candidateQualificationSuccessor.outputCas")
  }/run-fences/${runKey}-0.json`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "Candidate qualification successor requires an existing producerGeneration-0 predecessor.",
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "Candidate qualification predecessor fence is divergent.",
    );
  }
  const fence = exactRecord(parsed, [
    "schemaVersion",
    "runId",
    "runKey",
    "producerGeneration",
  ], "$candidateQualificationPredecessorFence");
  literalValue(
    fence.schemaVersion,
    RUN_CLOSED_FENCE_SCHEMA,
    "$candidateQualificationPredecessorFence.schemaVersion",
  );
  literalValue(
    fence.runId,
    acceptedRunId,
    "$candidateQualificationPredecessorFence.runId",
  );
  literalValue(
    fence.runKey,
    runKey,
    "$candidateQualificationPredecessorFence.runKey",
  );
  literalValue(
    fence.producerGeneration,
    0,
    "$candidateQualificationPredecessorFence.producerGeneration",
  );
  if (
    deterministicJson(fence) !== text && `${deterministicJson(fence)}\n` !== text
  ) {
    throw new Error("Candidate qualification predecessor fence is not canonical.");
  }
  return text;
}

async function rebuildSuccessor(input: {
  readonly physicalImageId: string;
  readonly importRecordFingerprint: string;
  readonly predecessorFingerprint: ContentFingerprint;
  readonly predecessorAttempts:
    readonly FirstPartyMicrosandboxImageCandidateQualificationPredecessorAttempt[];
  readonly successorAttempts:
    readonly FirstPartyMicrosandboxImageCandidateQualificationSuccessorAttempt[];
}): Promise<FirstPartyMicrosandboxImageCandidateQualificationSuccessor> {
  const expected = await sha256Fingerprint({
    schemaVersion:
      "first-party-microsandbox-image-candidate-qualification-predecessor/1.0",
    physicalImageId: input.physicalImageId,
    importRecordFingerprint: input.importRecordFingerprint,
    ordinal: 0,
    attempts: input.predecessorAttempts,
  });
  if (!fingerprintsEqual(expected, input.predecessorFingerprint)) {
    throw new TypeError(
      "Candidate qualification successor predecessor fingerprint is not the rebuilt predecessor set.",
    );
  }
  for (const [index, attempt] of input.predecessorAttempts.entries()) {
    const expectedRunId = await deriveSuccessorRunId({
      physicalImageId: input.physicalImageId,
      importRecordFingerprint: input.importRecordFingerprint,
      attemptId: attempt.id,
      predecessorRunId: attempt.runId,
    });
    if (input.successorAttempts[index]!.runId !== expectedRunId) {
      throw new TypeError(
        "Candidate qualification successor run identity is not server-derived from the predecessor.",
      );
    }
  }
  return Object.freeze({
    schemaVersion:
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA,
    kind: "candidate-qualification-successor" as const,
    reason: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON,
    physicalImageId: input.physicalImageId,
    importRecord: Object.freeze({
      fingerprint: input.importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    }),
    predecessor: Object.freeze({
      fingerprint: input.predecessorFingerprint,
      ordinal: 0 as const,
      attempts: Object.freeze([...input.predecessorAttempts]),
    }),
    successor: Object.freeze({
      ordinal: 1 as const,
      attempts: Object.freeze([...input.successorAttempts]),
    }),
    eligibleForPromotion: false as const,
  });
}

async function deriveSuccessorRunId(input: {
  readonly physicalImageId: string;
  readonly importRecordFingerprint: string;
  readonly attemptId: string;
  readonly predecessorRunId: string;
}): Promise<string> {
  const digest = (await sha256Fingerprint({
    schemaVersion:
      "first-party-microsandbox-image-candidate-qualification-successor-run/1.0",
    reason: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON,
    physicalImageId: input.physicalImageId,
    importRecordFingerprint: input.importRecordFingerprint,
    attemptId: input.attemptId,
    predecessorRunId: input.predecessorRunId,
    predecessorOrdinal: 0,
    successorOrdinal: 1,
    producerGeneration: 0,
  })).digest;
  return safeId(
    `${input.attemptId}-candidate-qualification-successor-${digest}`,
    "$candidateQualificationSuccessor.successor.runId",
  );
}

function parsePredecessorAttempts(
  value: unknown,
  path: string,
): readonly FirstPartyMicrosandboxImageCandidateQualificationPredecessorAttempt[] {
  const attempts = nonEmptyArray(value, path).map((entry, index) => {
    const attempt = exactRecord(entry, [
      "id",
      "runId",
      "ordinal",
      "producerGeneration",
      "publication",
      "destruction",
    ], `${path}[${index}]`);
    literalValue(attempt.ordinal, 0, `${path}[${index}].ordinal`);
    literalValue(
      attempt.producerGeneration,
      0,
      `${path}[${index}].producerGeneration`,
    );
    literalValue(
      attempt.publication,
      "not-published",
      `${path}[${index}].publication`,
    );
    const runId = safeId(attempt.runId, `${path}[${index}].runId`);
    return Object.freeze({
      id: safeId(attempt.id, `${path}[${index}].id`),
      runId,
      ordinal: 0 as const,
      producerGeneration: 0 as const,
      publication: "not-published" as const,
      destruction: parseProvenDestruction(
        attempt.destruction,
        runId,
        `${path}[${index}].destruction`,
      ),
    });
  });
  assertUniqueAttemptIds(attempts);
  return Object.freeze(attempts);
}

function parseSuccessorAttempts(
  value: unknown,
  path: string,
): readonly FirstPartyMicrosandboxImageCandidateQualificationSuccessorAttempt[] {
  const attempts = nonEmptyArray(value, path).map((entry, index) => {
    const attempt = exactRecord(entry, [
      "id",
      "runId",
      "ordinal",
      "producerGeneration",
    ], `${path}[${index}]`);
    literalValue(attempt.ordinal, 1, `${path}[${index}].ordinal`);
    literalValue(
      attempt.producerGeneration,
      0,
      `${path}[${index}].producerGeneration`,
    );
    return Object.freeze({
      id: safeId(attempt.id, `${path}[${index}].id`),
      runId: safeId(attempt.runId, `${path}[${index}].runId`),
      ordinal: 1 as const,
      producerGeneration: 0 as const,
    });
  });
  assertUniqueAttemptIds(attempts);
  return Object.freeze(attempts);
}

function parseProvenDestruction(
  value: unknown,
  expectedRunId: string,
  path: string,
): CandidateQualificationPredecessorDestruction {
  const destruction = validateIsolatedCodeExecutionDestruction(
    value,
    expectedRunId,
  );
  if (destruction.status !== "proven" || destruction.runId !== expectedRunId) {
    throw new TypeError(
      `${path} must be proven destruction bound to the predecessor runId.`,
    );
  }
  return destruction;
}

function assertUniqueAttemptIds(
  attempts: readonly { readonly id: string }[],
): void {
  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (seen.has(attempt.id)) {
      throw new TypeError(
        "Candidate qualification successor attempt ids must be unique.",
      );
    }
    seen.add(attempt.id);
  }
}

function requiredSha256(value: unknown, label: string): string {
  const digest = nonEmptyText(value, label);
  if (!SHA256.test(digest)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
  return digest;
}

function contentFingerprint(value: unknown, label: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], label);
  literalValue(root.algorithm, "sha256", `${label}.algorithm`);
  const digest = nonEmptyText(root.digest, `${label}.digest`);
  if (!SHA256_DIGEST.test(digest)) {
    throw new TypeError(`${label} digest must be an exact lowercase sha256 digest.`);
  }
  return Object.freeze({ algorithm: "sha256" as const, digest });
}
