/**
 * Parse already-read sealed static-proof bytes for isolated `@3`.
 *
 * CAS reads and hashes stay in the adapter. This module only validates the
 * canonical `fea-proof-case-capture/1.0` envelope, the seal operation, the
 * MechanicalProofCase digest, and the exact geometry/STEP/requirements
 * identities already written into that document.
 */

import { canonicalProofText } from "../seal-case/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../seal-case/mechanical-proof-case.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const SEALED_STATIC_PROOF_CAPTURE_SCHEMA = "fea-proof-case-capture/1.0" as const;

export interface SealedStaticProofArtifactIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface SealedStaticProofStepIdentity
  extends SealedStaticProofArtifactIdentity {
  readonly bytes: number;
}

export interface SealedStaticProofCapture {
  readonly case: MechanicalProofCase;
  readonly trustedRunId: string;
  readonly geometry: SealedStaticProofArtifactIdentity;
  readonly requirements: SealedStaticProofArtifactIdentity;
  readonly step: SealedStaticProofStepIdentity;
}

export async function parseSealedStaticProofCapture(
  bytes: Uint8Array,
): Promise<SealedStaticProofCapture> {
  const text = decodeUtf8(bytes, "FEA proof capture");
  let root: Record<string, unknown>;
  try {
    root = exactObject(JSON.parse(text), [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "proofDigest",
      "canonicalProofText",
      "geometryArtifact",
      "stepArtifact",
      "requirementsArtifact",
      "requirementsElementId",
      "seedIdentity",
      "sealedAt",
    ], "FEA proof capture");
  } catch (cause) {
    throw new TypeError(
      `The FEA proof capture is not exact JSON: ${describe(cause)}.`,
    );
  }
  if (
    deterministicJson(root) !== text ||
    root.schemaVersion !== SEALED_STATIC_PROOF_CAPTURE_SCHEMA
  ) {
    throw new TypeError(
      "The FEA proof capture is not a canonical supported seal.",
    );
  }
  const operation = exactObject(root.operation, ["id", "version"], "proof operation");
  if (operation.id !== "verify.seal-proof-case" || operation.version !== "1") {
    throw new TypeError(
      "The FEA proof capture was not produced by the proof-seal operation.",
    );
  }
  const proofText = textValue(root.canonicalProofText, "canonicalProofText");
  let proofCase: MechanicalProofCase;
  try {
    proofCase = validateMechanicalProofCase(JSON.parse(proofText));
  } catch (cause) {
    throw new TypeError(`The FEA proof case is invalid: ${describe(cause)}.`);
  }
  const proofDigest = (await sha256Fingerprint(proofCase)).digest;
  if (
    canonicalProofText(proofCase) !== proofText ||
    textValue(root.proofDigest, "proofDigest") !== proofDigest
  ) {
    throw new TypeError(
      "The FEA proof capture does not bind canonical proof bytes.",
    );
  }
  const seed = exactObject(
    root.seedIdentity,
    ["editingContextId", "elementId"],
    "seedIdentity",
  );
  textValue(seed.editingContextId, "seedIdentity.editingContextId");
  textValue(seed.elementId, "seedIdentity.elementId");
  textValue(root.requirementsElementId, "requirementsElementId");
  const sealedAt = textValue(root.sealedAt, "sealedAt");
  if (new Date(sealedAt).toISOString() !== sealedAt) {
    throw new TypeError(
      "The FEA proof capture has no canonical seal timestamp.",
    );
  }
  return {
    case: proofCase,
    trustedRunId: textValue(root.trustedRunId, "trustedRunId"),
    geometry: captureArtifact(root.geometryArtifact, "geometryArtifact"),
    requirements: captureArtifact(
      root.requirementsArtifact,
      "requirementsArtifact",
    ),
    step: captureStepArtifact(root.stepArtifact),
  };
}

function captureArtifact(
  value: unknown,
  label: string,
): SealedStaticProofArtifactIdentity {
  const record = exactObject(value, ["id", "fingerprint", "producerRunId"], label);
  return {
    id: textValue(record.id, `${label}.id`),
    fingerprint: fingerprintValue(record.fingerprint, `${label}.fingerprint`),
    producerRunId: textValue(record.producerRunId, `${label}.producerRunId`),
  };
}

function captureStepArtifact(value: unknown): SealedStaticProofStepIdentity {
  const record = exactObject(
    value,
    ["id", "fingerprint", "producerRunId", "bytes"],
    "stepArtifact",
  );
  if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 1) {
    throw new TypeError("stepArtifact.bytes must be a positive integer.");
  }
  return {
    id: textValue(record.id, "stepArtifact.id"),
    fingerprint: fingerprintValue(record.fingerprint, "stepArtifact.fingerprint"),
    producerRunId: textValue(record.producerRunId, "stepArtifact.producerRunId"),
    bytes: Number(record.bytes),
  };
}

function fingerprintValue(value: unknown, label: string): ContentFingerprint {
  const record = exactObject(value, ["algorithm", "digest"], label);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new TypeError(`${label} is not a SHA-256 fingerprint.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${label} has unexpected fields.`);
  }
  return record;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be non-empty text.`);
  }
  return value;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not exact UTF-8.`);
  }
}

function describe(cause: unknown): string {
  const text = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : String(cause);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}
