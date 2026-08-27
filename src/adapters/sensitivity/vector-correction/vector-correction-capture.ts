/**
 * Documentary capture for design.apply-vector-correction@1.
 *
 * `grants: none` is an exactRecord field. This document is not a CAD
 * admission, SysON write, or provider mandate.
 */

import { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION } from "../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import {
  validateVectorCorrectionDecisionParameters,
  type VectorCorrectionDecisionParameters,
} from "../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const CORRECTION_PROPOSAL_CAPTURE_SCHEMA =
  "correction-proposal-capture/1.0" as const;
export const CORRECTION_PROPOSAL_CAPTURE_URI_PREFIX =
  "casys://correction-proposal-capture/sha256/" as const;
export const CORRECTION_PROPOSAL_CAPTURE_GRANTS = "none" as const;

export interface VectorCorrectionCapture {
  readonly schemaVersion: typeof CORRECTION_PROPOSAL_CAPTURE_SCHEMA;
  readonly kind: "correction-proposal";
  readonly grants: typeof CORRECTION_PROPOSAL_CAPTURE_GRANTS;
  readonly operation: typeof DESIGN_APPLY_VECTOR_CORRECTION_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly proposal: VectorCorrectionDecisionParameters;
  readonly studyCapture: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
  readonly evaluation: { readonly id: string };
}

export function validateVectorCorrectionCapture(
  value: unknown,
): VectorCorrectionCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "grants",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "proposal",
    "studyCapture",
    "evaluation",
  ], "$vectorCorrectionCapture");
  literalValue(
    root.schemaVersion,
    CORRECTION_PROPOSAL_CAPTURE_SCHEMA,
    "$vectorCorrectionCapture.schemaVersion",
  );
  literalValue(root.kind, "correction-proposal", "$vectorCorrectionCapture.kind");
  literalValue(
    root.grants,
    CORRECTION_PROPOSAL_CAPTURE_GRANTS,
    "$vectorCorrectionCapture.grants",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$vectorCorrectionCapture.operation",
  );
  literalValue(
    operation.id,
    DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id,
    "$vectorCorrectionCapture.operation.id",
  );
  literalValue(
    operation.version,
    DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version,
    "$vectorCorrectionCapture.operation.version",
  );
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError("$vectorCorrectionCapture.sealedAt must be ISO-8601.");
  }
  const proposal = validateVectorCorrectionDecisionParameters(
    root.proposal,
    "$vectorCorrectionCapture.proposal",
  );
  const studyCapture = exactRecord(
    root.studyCapture,
    ["id", "fingerprint", "uri"],
    "$vectorCorrectionCapture.studyCapture",
  );
  const evaluation = exactRecord(
    root.evaluation,
    ["id"],
    "$vectorCorrectionCapture.evaluation",
  );
  const studyId = safeId(studyCapture.id, "$vectorCorrectionCapture.studyCapture.id");
  const studyFingerprint = parseFingerprint(
    studyCapture.fingerprint,
    "$vectorCorrectionCapture.studyCapture.fingerprint",
  );
  if (studyId !== proposal.studyCapture.artifactId) {
    throw new TypeError(
      "$vectorCorrectionCapture.studyCapture.id does not match the signed proposal.",
    );
  }
  if (
    deterministicJson(studyFingerprint) !==
      deterministicJson(proposal.studyCapture.fingerprint)
  ) {
    throw new TypeError(
      "$vectorCorrectionCapture.studyCapture.fingerprint does not match the signed proposal.",
    );
  }
  const acceptedUris = [
    `casys://sensitivity-study-capture/sha256/${studyFingerprint.digest}`,
    `casys://sensitivity-study-reuse-result/sha256/${studyFingerprint.digest}`,
  ];
  const studyUri = nonEmptyText(
    studyCapture.uri,
    "$vectorCorrectionCapture.studyCapture.uri",
  );
  if (!acceptedUris.includes(studyUri)) {
    throw new TypeError(
      "$vectorCorrectionCapture.studyCapture.uri must be the study-capture CAS URI.",
    );
  }
  const evaluationId = safeId(
    evaluation.id,
    "$vectorCorrectionCapture.evaluation.id",
  );
  if (evaluationId !== proposal.evaluationId) {
    throw new TypeError(
      "$vectorCorrectionCapture.evaluation.id does not match the signed proposal.",
    );
  }
  return {
    schemaVersion: CORRECTION_PROPOSAL_CAPTURE_SCHEMA,
    kind: "correction-proposal",
    grants: CORRECTION_PROPOSAL_CAPTURE_GRANTS,
    operation: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$vectorCorrectionCapture.trustedRunId"),
    decisionId: safeId(root.decisionId, "$vectorCorrectionCapture.decisionId"),
    sealedAt: root.sealedAt,
    proposal,
    studyCapture: {
      id: studyId,
      fingerprint: studyFingerprint,
      uri: studyUri,
    },
    evaluation: { id: evaluationId },
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be canonical lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}
