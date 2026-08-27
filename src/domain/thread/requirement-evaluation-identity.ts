/**
 * Evidence-versioned Thread RequirementEvaluation identity.
 *
 * One evaluation of one exact Thread requirement is identified by that
 * requirement id and the ContentFingerprint of the evaluation evidence.
 * A new evidence fingerprint is a distinct evaluation. Domain code does not
 * name adapter artifacts, providers, run ids, latest, or timestamps.
 */

import { deepFreeze, nonEmptyText } from "../kernel/case-validation.ts";
import { requireSha256Fingerprint } from "../kernel/content-fingerprint.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export interface RequirementEvaluationIdentity {
  readonly id: string;
  readonly requirementId: string;
  readonly evidenceFingerprint: ContentFingerprint;
}

export function requirementEvaluationIdentity(input: {
  readonly requirementId: string;
  readonly evidenceFingerprint: ContentFingerprint;
}): RequirementEvaluationIdentity {
  const requirementId = nonEmptyText(input.requirementId, "requirementId");
  const evidenceFingerprint = requireSha256Fingerprint(
    input.evidenceFingerprint,
    "evidenceFingerprint",
  );
  return deepFreeze({
    requirementId,
    evidenceFingerprint,
    id: `${requirementId}-evaluation-${evidenceFingerprint.digest}`,
  });
}
