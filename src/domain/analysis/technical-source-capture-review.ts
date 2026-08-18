/**
 * Agent-facing review of one technical-source capture.
 *
 * The CAS locator (`reference`) stays the opaque replay object. `parser` is
 * the closed-subset analysis policy. `levers` is the behave-CAD handle
 * diagnosis. Those three facts must not share a status field.
 */

import { deepFreeze, exactRecord, literalValue } from "../kernel/case-validation.ts";
import {
  type CadLeverCaptureDiagnosis,
  diagnoseAnalysisReachableCadLevers,
} from "./named-cad-levers.ts";
import type { SourceAnalysisBundle } from "./source-analysis.ts";

export const TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA =
  "technical-source-capture-review/1.0" as const;

export interface TechnicalSourceCaptureReview {
  readonly schemaVersion: typeof TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA;
  readonly reference: Readonly<Record<string, unknown>>;
  readonly parser: {
    readonly status: "passed" | "rejected";
    readonly profile: string;
  };
  readonly levers: CadLeverCaptureDiagnosis;
}

export function assembleTechnicalSourceCaptureReview(
  reference: unknown,
  sourceText: string,
  analysis: SourceAnalysisBundle,
): TechnicalSourceCaptureReview {
  const locator = exactRecord(
    reference,
    ["schemaVersion", "kind", "profile", "source", "analysis"],
    "$technicalSourceCaptureReview.reference",
  );
  const policy = exactRecord(
    exactRecord(locator.analysis, [
      "analyzer",
      "policy",
      "sha256",
      "byteCount",
      "casUri",
    ], "$technicalSourceCaptureReview.reference.analysis").policy,
    ["profile", "status"],
    "$technicalSourceCaptureReview.reference.analysis.policy",
  );
  const status = policy.status;
  if (status !== "passed" && status !== "rejected") {
    throw new TypeError(
      "$technicalSourceCaptureReview.parser.status must be passed or rejected.",
    );
  }
  return deepFreeze({
    schemaVersion: TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA,
    reference: structuredClone(locator) as Readonly<Record<string, unknown>>,
    parser: {
      status,
      profile: String(policy.profile),
    },
    levers: diagnoseAnalysisReachableCadLevers(sourceText, analysis),
  });
}

export function captureReviewContent(review: TechnicalSourceCaptureReview): string {
  literalValue(
    review.schemaVersion,
    TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA,
    "$review.schemaVersion",
  );
  const leverText = review.levers.status === "ok"
    ? `CAD levers: ok (${review.levers.levers.length} reachable named literal(s)). ` +
      `Binding through parameterizes is compile, not this review.`
    : review.levers.status === "unresolved"
    ? `CAD levers: unresolved (${review.levers.code}). A constructor photo is not admission-ready.`
    : "CAD levers: not-applicable for this source role.";
  return (
    `Technical source was captured as exact UTF-8 bytes and analysed under ` +
    `parser status ${review.parser.status}. ${leverText} ` +
    `Pass result.reference verbatim to project_technical_compilation_preview. ` +
    `parser.status is the closed-subset parser, not admission. ` +
    `levers.status is the capture-time handle, not a SysML bind. ` +
    `This creates no EngineeringProject or Thread state, no MRTR decision, ` +
    `and no execution authority.`
  );
}
