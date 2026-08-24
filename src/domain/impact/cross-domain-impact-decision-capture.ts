/**
 * Canonical, provider-free record of one human cross-domain impact decision.
 *
 * The capture documents the exact recross and applied work-item/gate-claim
 * transitions. It is not a rerun grant, mechanical FEA inspection, or
 * provider dispatch.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../kernel/case-validation.ts";
import { fingerprintsEqual } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import { crossDomainImpactEvaluationCaptureUri } from "./cross-domain-impact-evaluation-capture.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
  CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  type CrossDomainImpactDecisionAdmission,
  DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  validateCrossDomainImpactDecisionAdmission,
} from "./cross-domain-impact-decision-proposal.ts";

export const CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_SCHEMA =
  "cross-domain-impact-decision-capture/2.0" as const;
export const CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_URI_PREFIX =
  "casys://cross-domain-impact-decision-capture/sha256/" as const;

export interface CrossDomainImpactDecisionCapture {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_SCHEMA;
  readonly kind: "cross-domain-impact-decision";
  readonly operation: typeof DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: CrossDomainImpactDecisionAdmission;
  readonly evaluationCapture: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
  readonly limits: typeof CROSS_DOMAIN_IMPACT_DECISION_LIMITS;
}

const ROOT_KEYS = [
  "schemaVersion",
  "kind",
  "operation",
  "trustedRunId",
  "decisionId",
  "sealedAt",
  "admission",
  "evaluationCapture",
  "limits",
] as const;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function crossDomainImpactDecisionCaptureUri(digest: string): string {
  return `${CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_URI_PREFIX}${digest}`;
}

export function validateCrossDomainImpactDecisionCapture(
  value: unknown,
): CrossDomainImpactDecisionCapture {
  const root = exactRecord(value, ROOT_KEYS, "$impactDecisionCapture");
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_SCHEMA,
    "$impactDecisionCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "cross-domain-impact-decision",
    "$impactDecisionCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$impactDecisionCapture.operation",
  );
  literalValue(
    operation.id,
    DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
    "$impactDecisionCapture.operation.id",
  );
  literalValue(
    operation.version,
    DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
    "$impactDecisionCapture.operation.version",
  );
  const sealedAt = parseIsoDateTime(root.sealedAt, "$impactDecisionCapture.sealedAt");
  const admission = validateCrossDomainImpactDecisionAdmission(root.admission);
  literalValue(
    admission.schemaVersion,
    CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
    "$impactDecisionCapture.admission.schemaVersion",
  );
  const evaluationCapture = exactRecord(
    root.evaluationCapture,
    ["id", "fingerprint", "uri"],
    "$impactDecisionCapture.evaluationCapture",
  );
  const fingerprint = parseFingerprint(
    evaluationCapture.fingerprint,
    "$impactDecisionCapture.evaluationCapture.fingerprint",
  );
  const captureId = safeId(
    evaluationCapture.id,
    "$impactDecisionCapture.evaluationCapture.id",
  );
  if (
    captureId !== admission.evaluation.capture.id ||
    !fingerprintsEqual(fingerprint, admission.evaluation.capture.fingerprint)
  ) {
    throw new TypeError(
      "$impactDecisionCapture.evaluationCapture must equal admission.evaluation.capture.",
    );
  }
  const expectedUri = crossDomainImpactEvaluationCaptureUri(fingerprint.digest);
  if (evaluationCapture.uri !== expectedUri) {
    throw new TypeError(
      "$impactDecisionCapture.evaluationCapture.uri must be the server-issued CAS URI.",
    );
  }
  const limits = exactRecord(
    root.limits,
    ["providerCalls", "solverCalls", "reruns", "newWorkItems"],
    "$impactDecisionCapture.limits",
  );
  literalValue(
    limits.providerCalls,
    "none",
    "$impactDecisionCapture.limits.providerCalls",
  );
  literalValue(limits.solverCalls, "none", "$impactDecisionCapture.limits.solverCalls");
  literalValue(limits.reruns, "none", "$impactDecisionCapture.limits.reruns");
  literalValue(
    limits.newWorkItems,
    "none",
    "$impactDecisionCapture.limits.newWorkItems",
  );
  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_SCHEMA,
    kind: "cross-domain-impact-decision",
    operation: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$impactDecisionCapture.trustedRunId"),
    decisionId: safeId(root.decisionId, "$impactDecisionCapture.decisionId"),
    sealedAt,
    admission,
    evaluationCapture: {
      id: captureId,
      fingerprint,
      uri: expectedUri,
    },
    limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof input.digest === "string" ? input.digest : "";
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}

function parseIsoDateTime(value: unknown, path: string): string {
  if (
    typeof value !== "string" || !ISO_DATE_TIME.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp.`);
  }
  return value;
}
