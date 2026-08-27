/**
 * Agent-facing review of one captured mechanical proof-case source.
 *
 * The CAS locator is only the server-computed fingerprint. The review grants
 * no MRTR, Thread, provider, or project authority.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import type { MechanicalProofCaseSource } from "./mechanical-proof-case-source.ts";

export const FEA_PROOF_CASE_SOURCE_CAPTURE_REVIEW_SCHEMA =
  "fea-proof-case-source-capture-review/1.0" as const;

const SHA256 = /^[a-f0-9]{64}$/;

export interface FeaProofCaseSourceCaptureReference {
  readonly fingerprint: string;
}

export interface FeaProofCaseSourceCaptureReview {
  readonly schemaVersion: typeof FEA_PROOF_CASE_SOURCE_CAPTURE_REVIEW_SCHEMA;
  readonly status: "captured";
  readonly reference: FeaProofCaseSourceCaptureReference;
  readonly id: string;
  readonly revision: number;
  readonly project: MechanicalProofCaseSource["project"];
  readonly target: MechanicalProofCaseSource["target"];
  readonly metrics:
    readonly MechanicalProofCaseSource["requirements"][number]["metric"][];
  readonly grants: "none";
}

export function validateFeaProofCaseSourceCaptureReference(
  value: unknown,
  path = "$feaProofCaseSourceRef",
): FeaProofCaseSourceCaptureReference {
  const input = exactRecord(value, ["fingerprint"], path);
  if (typeof input.fingerprint !== "string" || !SHA256.test(input.fingerprint)) {
    throw new TypeError(
      `${path}.fingerprint must be a lowercase SHA-256 digest.`,
    );
  }
  return deepFreeze({ fingerprint: input.fingerprint });
}

export function assembleFeaProofCaseSourceCaptureReview(input: {
  readonly fingerprint: string;
  readonly source: MechanicalProofCaseSource;
}): FeaProofCaseSourceCaptureReview {
  const reference = validateFeaProofCaseSourceCaptureReference({
    fingerprint: input.fingerprint,
  });
  return deepFreeze({
    schemaVersion: FEA_PROOF_CASE_SOURCE_CAPTURE_REVIEW_SCHEMA,
    status: "captured",
    reference,
    id: input.source.id,
    revision: input.source.revision,
    project: input.source.project,
    target: input.source.target,
    metrics: input.source.requirements.map((item) => item.metric),
    grants: "none",
  });
}

export function captureReviewContent(
  review: FeaProofCaseSourceCaptureReview,
): string {
  literalValue(
    review.schemaVersion,
    FEA_PROOF_CASE_SOURCE_CAPTURE_REVIEW_SCHEMA,
    "$review.schemaVersion",
  );
  exactRecord(
    review,
    [
      "schemaVersion",
      "status",
      "reference",
      "id",
      "revision",
      "project",
      "target",
      "metrics",
      "grants",
    ],
    "$review",
  );
  return (
    `Mechanical proof-case source ${review.id} revision ${review.revision} ` +
    `for project ${review.project.id} was captured as canonical JSON and ` +
    `reread from draft CAS. Pass result.reference verbatim to ` +
    `project_fea_proof_seal_review. grants is none: this review authorizes ` +
    `neither seal nor run, and it does not choose a provider, tool, runtime, ` +
    `or solver deck. This creates no EngineeringProject or Thread state.`
  );
}
