/**
 * Bounded agent-facing review of one CAD placement capture.
 *
 * Only a fully resolved recross returns the opaque locator. The review
 * grants none and is not a module export, MRTR or verdict.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import type { ProductStructureElementRef } from "../../architecture/product-structure-ref.ts";
import type { CadPlacementCoverageGap } from "./cad-placement-coverage.ts";
import {
  type CadPlacementAnalysisCaptureLocator,
  validateCadPlacementAnalysisCaptureLocator,
} from "./cad-placement-analysis-capture.ts";

export const CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA =
  "cad-placement-capture-review/1.0" as const;

export type CadPlacementCaptureReview =
  | {
    readonly schemaVersion: typeof CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA;
    readonly status: "resolved";
    readonly reference: CadPlacementAnalysisCaptureLocator;
    readonly owner: ProductStructureElementRef;
    readonly usageCount: number;
    readonly grants: "none";
  }
  | {
    readonly schemaVersion: typeof CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA;
    readonly status: "unresolved";
    readonly gaps: readonly CadPlacementCoverageGap[];
    readonly grants: "none";
  };

export function assembleResolvedCadPlacementCaptureReview(input: {
  readonly reference: unknown;
  readonly owner: ProductStructureElementRef;
  readonly usageCount: number;
}): CadPlacementCaptureReview {
  if (!Number.isSafeInteger(input.usageCount) || input.usageCount < 1) {
    throw new TypeError("$review.usageCount must be a positive integer.");
  }
  if (input.owner.elementKind !== "PartDefinition") {
    throw new TypeError("$review.owner must be a PartDefinition element.");
  }
  return deepFreeze({
    schemaVersion: CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA,
    status: "resolved",
    reference: validateCadPlacementAnalysisCaptureLocator(
      input.reference,
      "$review.reference",
    ),
    owner: {
      elementKind: "PartDefinition",
      elementId: input.owner.elementId,
    },
    usageCount: input.usageCount,
    grants: "none",
  });
}

export function assembleUnresolvedCadPlacementCaptureReview(
  gaps: readonly CadPlacementCoverageGap[],
): CadPlacementCaptureReview {
  if (gaps.length === 0) {
    throw new TypeError("$review.gaps must name at least one unresolved mapping.");
  }
  return deepFreeze({
    schemaVersion: CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA,
    status: "unresolved",
    gaps,
    grants: "none",
  });
}

export function captureReviewContent(review: CadPlacementCaptureReview): string {
  literalValue(
    review.schemaVersion,
    CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA,
    "$review.schemaVersion",
  );
  literalValue(review.grants, "none", "$review.grants");
  if (review.status === "resolved") {
    exactRecord(
      review,
      ["schemaVersion", "status", "reference", "owner", "usageCount", "grants"],
      "$review",
    );
    validateCadPlacementAnalysisCaptureLocator(review.reference, "$review.reference");
    return (
      `CAD immediate placement was captured for owner ${review.owner.elementId} ` +
      `covering ${review.usageCount} exact PartUsage identities and reread from ` +
      `draft CAS. Pass result.reference verbatim. grants is none: this review ` +
      `authorizes neither module export, MRTR, provider, runtime nor a verdict. ` +
      `This creates no EngineeringProject or Thread state.`
    );
  }
  exactRecord(
    review,
    ["schemaVersion", "status", "gaps", "grants"],
    "$review",
  );
  return (
    `CAD immediate placement stayed unresolved. Missing or extra mappings were ` +
    `not filled from array order or labels. grants is none. Pass no locator. ` +
    `This creates no EngineeringProject or Thread state.`
  );
}
