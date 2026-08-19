/**
 * Fail-closed parser for the sealed `fea-proof-case-capture/1.0` document.
 *
 * This is the Thread artifact produced by `verify.seal-proof-case@1`. A later
 * isolated `@3` run binds that document plus the exact STEP named inside it.
 * The parser is the only authority on the envelope shape: the plan resolver
 * and the isolated-run review must not invent a second reading.
 */

import {
  exactRecord,
  nonEmptyText,
  positiveInteger,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  canonicalProofText,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "./fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "./mechanical-proof-case.ts";

export const FEA_PROOF_CASE_CAPTURE_SCHEMA = "fea-proof-case-capture/1.0" as const;

export interface FeaProofCaseCaptureArtifactRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface FeaProofCaseCaptureStepRef extends FeaProofCaseCaptureArtifactRef {
  readonly bytes: number;
}

export interface FeaProofCaseCapture {
  readonly schemaVersion: typeof FEA_PROOF_CASE_CAPTURE_SCHEMA;
  readonly trustedRunId: string;
  readonly sealedAt: string;
  readonly proofDigest: string;
  readonly proofCase: MechanicalProofCase;
  readonly geometryArtifact: FeaProofCaseCaptureArtifactRef;
  readonly requirementsArtifact: FeaProofCaseCaptureArtifactRef;
  readonly stepArtifact: FeaProofCaseCaptureStepRef;
  readonly requirementsElementId: string;
  readonly seedIdentity: {
    readonly editingContextId: string;
    readonly elementId: string;
  };
}

const SHA256 = /^[a-f0-9]{64}$/;

export async function parseFeaProofCaseCapture(
  text: string,
): Promise<FeaProofCaseCapture> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("FEA proof capture is not valid JSON.");
  }
  const record = exactRecord(
    parsed,
    [
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
    ],
    "FEA proof capture",
  );
  if (deterministicJson(record) !== text) {
    throw new TypeError("FEA proof capture is not canonical JSON.");
  }
  if (record.schemaVersion !== FEA_PROOF_CASE_CAPTURE_SCHEMA) {
    throw new TypeError("FEA proof capture schemaVersion is unsupported.");
  }
  const operation = exactRecord(
    record.operation,
    ["id", "version"],
    "FEA proof capture.operation",
  );
  if (
    operation.id !== VERIFY_SEAL_PROOF_CASE_OPERATION.id ||
    operation.version !== VERIFY_SEAL_PROOF_CASE_OPERATION.version
  ) {
    throw new TypeError(
      "FEA proof capture was not produced by verify.seal-proof-case@1.",
    );
  }
  const proofText = nonEmptyText(
    record.canonicalProofText,
    "FEA proof capture.canonicalProofText",
  );
  let proofJson: unknown;
  try {
    proofJson = JSON.parse(proofText);
  } catch {
    throw new TypeError("FEA proof capture canonicalProofText is not valid JSON.");
  }
  const proofCase = validateMechanicalProofCase(proofJson);
  const proofDigest = (await sha256Fingerprint(proofCase)).digest;
  const declaredDigest = digestValue(
    record.proofDigest,
    "FEA proof capture.proofDigest",
  );
  if (canonicalProofText(proofCase) !== proofText || declaredDigest !== proofDigest) {
    throw new TypeError(
      "FEA proof capture does not bind canonical proof case bytes.",
    );
  }
  const sealedAt = nonEmptyText(record.sealedAt, "FEA proof capture.sealedAt");
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError("FEA proof capture sealedAt must be ISO-8601.");
  }
  const seed = exactRecord(
    record.seedIdentity,
    ["editingContextId", "elementId"],
    "FEA proof capture.seedIdentity",
  );
  return {
    schemaVersion: FEA_PROOF_CASE_CAPTURE_SCHEMA,
    trustedRunId: nonEmptyText(record.trustedRunId, "FEA proof capture.trustedRunId"),
    sealedAt,
    proofDigest,
    proofCase,
    geometryArtifact: artifactRef(
      record.geometryArtifact,
      "FEA proof capture.geometryArtifact",
    ),
    requirementsArtifact: artifactRef(
      record.requirementsArtifact,
      "FEA proof capture.requirementsArtifact",
    ),
    stepArtifact: stepRef(record.stepArtifact, "FEA proof capture.stepArtifact"),
    requirementsElementId: nonEmptyText(
      record.requirementsElementId,
      "FEA proof capture.requirementsElementId",
    ),
    seedIdentity: {
      editingContextId: nonEmptyText(
        seed.editingContextId,
        "FEA proof capture.seedIdentity.editingContextId",
      ),
      elementId: nonEmptyText(
        seed.elementId,
        "FEA proof capture.seedIdentity.elementId",
      ),
    },
  };
}

function artifactRef(
  value: unknown,
  path: string,
): FeaProofCaseCaptureArtifactRef {
  const record = exactRecord(value, ["id", "fingerprint", "producerRunId"], path);
  return {
    id: nonEmptyText(record.id, `${path}.id`),
    fingerprint: fingerprintValue(record.fingerprint, `${path}.fingerprint`),
    producerRunId: nonEmptyText(record.producerRunId, `${path}.producerRunId`),
  };
}

function stepRef(value: unknown, path: string): FeaProofCaseCaptureStepRef {
  const record = exactRecord(
    value,
    ["id", "fingerprint", "producerRunId", "bytes"],
    path,
  );
  return {
    id: nonEmptyText(record.id, `${path}.id`),
    fingerprint: fingerprintValue(record.fingerprint, `${path}.fingerprint`),
    producerRunId: nonEmptyText(record.producerRunId, `${path}.producerRunId`),
    bytes: positiveInteger(record.bytes, `${path}.bytes`),
  };
}

function fingerprintValue(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  if (record.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must be sha256.`);
  }
  return { algorithm: "sha256", digest: digestValue(record.digest, `${path}.digest`) };
}

function digestValue(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256.test(digest)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 hex digest.`);
  }
  return digest;
}
