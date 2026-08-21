/**
 * Agent-facing review of one LED-driver human-source capture.
 *
 * The CAS locator stays the opaque replay object. Declared unknowns remain
 * `unresolved`. The review grants no seal, run, ngspice or Thread authority.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import type { LedDriverSourceUnknown } from "./led-driver-human-source.ts";
import {
  type LedDriverSourceCaptureDocument,
  validateLedDriverSourceCaptureDocument,
} from "./led-driver-source-capture.ts";

export const LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA =
  "led-driver-source-capture-review/1.0" as const;

export type LedDriverSourceCaptureReviewStatus = "captured" | "unresolved";

export type LedDriverSourceUnknownsStatus = "unresolved" | "none";

export interface LedDriverSourceCaptureReview {
  readonly schemaVersion: typeof LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA;
  readonly status: LedDriverSourceCaptureReviewStatus;
  readonly reference: LedDriverSourceCaptureDocument;
  readonly circuit: LedDriverSourceCaptureDocument["circuit"];
  readonly testCondition: LedDriverSourceCaptureDocument["testCondition"];
  readonly unknowns: {
    readonly status: LedDriverSourceUnknownsStatus;
    readonly items: readonly LedDriverSourceUnknown[];
  };
  readonly grants: "none";
}

export function assembleLedDriverSourceCaptureReview(
  reference: unknown,
): LedDriverSourceCaptureReview {
  const document = validateLedDriverSourceCaptureDocument(
    reference,
    "$ledDriverSourceCaptureReview.reference",
  );
  const items = document.unknowns;
  const unknownsStatus: LedDriverSourceUnknownsStatus = items.length === 0
    ? "none"
    : "unresolved";
  return deepFreeze({
    schemaVersion: LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA,
    status: unknownsStatus === "none" ? "captured" : "unresolved",
    reference: document,
    circuit: document.circuit,
    testCondition: document.testCondition,
    unknowns: { status: unknownsStatus, items },
    grants: "none",
  });
}

export function captureReviewContent(
  review: LedDriverSourceCaptureReview,
): string {
  literalValue(
    review.schemaVersion,
    LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA,
    "$review.schemaVersion",
  );
  exactRecord(
    review,
    [
      "schemaVersion",
      "status",
      "reference",
      "circuit",
      "testCondition",
      "unknowns",
      "grants",
    ],
    "$review",
  );
  const unknownText = review.unknowns.status === "unresolved"
    ? `Unknowns stay unresolved (${review.unknowns.items.length} named gap(s)).`
    : "No named unknowns were declared.";
  return (
    `LED-driver human source ${review.reference.identity.id} revision ` +
    `${review.reference.identity.revision} was captured as exact UTF-8 ` +
    `bytes and reread from draft CAS. Circuit ${review.circuit.id} and ` +
    `test condition ${review.testCondition.id} are recorded. ${unknownText} ` +
    `Pass result.reference verbatim to project_led_driver_source_review. ` +
    `grants is none: this review authorizes neither seal nor run, and it ` +
    `does not choose D1, a provider, a tool or ngspice arguments. ` +
    `This creates no EngineeringProject or Thread state, no MRTR decision, ` +
    `and no execution authority.`
  );
}
