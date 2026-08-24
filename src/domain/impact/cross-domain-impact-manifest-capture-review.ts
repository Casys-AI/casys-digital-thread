/**
 * Agent-facing review of one draft cross-domain impact-manifest capture.
 *
 * The CAS locator stays the opaque `{ fingerprint }` replay object. The
 * review grants no seal, MRTR, Thread write, evaluation, or provider
 * authority. A human-shaped assertion in the captured JSON is not proof.
 */

import { deepFreeze, exactRecord, literalValue } from "../kernel/case-validation.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { CrossDomainImpactManifest } from "./cross-domain-impact-manifest.ts";

export const CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_REVIEW_SCHEMA =
  "cross-domain-impact-manifest-capture-review/2.0" as const;

export interface CrossDomainImpactManifestCaptureReference {
  readonly fingerprint: ContentFingerprint;
}

export interface CrossDomainImpactManifestCaptureSummary {
  readonly id: string;
  readonly revision: number;
  readonly basis: {
    readonly projectId: string;
    readonly subjectId: string;
    readonly snapshotId: string;
    readonly revision: number;
  };
  readonly changeKinds: readonly string[];
}

export interface CrossDomainImpactManifestCaptureReview {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_REVIEW_SCHEMA;
  readonly status: "captured";
  readonly reference: CrossDomainImpactManifestCaptureReference;
  readonly summary: CrossDomainImpactManifestCaptureSummary;
  readonly grants: "none";
}

export function assembleCrossDomainImpactManifestCaptureReview(input: {
  readonly reference: CrossDomainImpactManifestCaptureReference;
  readonly manifest: CrossDomainImpactManifest;
}): CrossDomainImpactManifestCaptureReview {
  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_REVIEW_SCHEMA,
    status: "captured",
    reference: { fingerprint: input.reference.fingerprint },
    summary: {
      id: input.manifest.id,
      revision: input.manifest.revision,
      basis: {
        projectId: input.manifest.basis.projectId,
        subjectId: input.manifest.basis.subjectId,
        snapshotId: input.manifest.basis.snapshotId,
        revision: input.manifest.basis.revision,
      },
      changeKinds: input.manifest.changeKinds,
    },
    grants: "none",
  });
}

export function captureReviewContent(
  review: CrossDomainImpactManifestCaptureReview,
): string {
  literalValue(
    review.schemaVersion,
    CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_REVIEW_SCHEMA,
    "$review.schemaVersion",
  );
  exactRecord(
    review,
    ["schemaVersion", "status", "reference", "summary", "grants"],
    "$review",
  );
  literalValue(review.status, "captured", "$review.status");
  literalValue(review.grants, "none", "$review.grants");
  exactRecord(review.reference, ["fingerprint"], "$review.reference");
  exactRecord(
    review.summary,
    ["id", "revision", "basis", "changeKinds"],
    "$review.summary",
  );
  return (
    `Cross-domain impact manifest ${review.summary.id} revision ` +
    `${review.summary.revision} was captured as a closed canonical draft ` +
    `and reread from draft CAS. Pass result.reference verbatim as ` +
    `manifestRef to project_cross_domain_impact_manifest_seal_review. ` +
    `grants is none: this review authorizes neither MRTR, Thread write, ` +
    `evaluation, gate-claim transition, provider, solver, tool, nor ` +
    `runtime. A caller-authored human-shaped assertion in draft JSON is ` +
    `not proof until verify.seal-cross-domain-impact-manifest@2 after ` +
    `signed MRTR. This creates no EngineeringProject or Thread state.`
  );
}
