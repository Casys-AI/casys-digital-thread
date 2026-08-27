/**
 * Closed documentary capture for `verify.seal-cross-domain-impact-manifest@2`.
 *
 * This is a seal of recrossed identities, not a cross-domain evaluation. It
 * carries neither branch outcomes nor gate-claim transitions and cannot turn a
 * declared independence assertion into a pass/fail verdict.
 */

import { exactRecord, literalValue, safeId } from "../kernel/case-validation.ts";
import {
  type CrossDomainImpactManifestSealAdmission,
  encodeCrossDomainImpactManifestSealAdmission,
  parseCrossDomainImpactManifestSealParameters,
  VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
} from "./cross-domain-impact-manifest-proposal.ts";

export const CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA =
  "cross-domain-impact-manifest-seal-capture/2.0" as const;
export const CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_URI_PREFIX =
  "casys://cross-domain-impact-manifest-seal-capture/sha256/" as const;

export interface CrossDomainImpactManifestSealCapture {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA;
  readonly kind: "cross-domain-impact-manifest-seal";
  readonly operation: typeof VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: CrossDomainImpactManifestSealAdmission;
}

export function crossDomainImpactManifestSealCaptureUri(
  digest: string,
): string {
  return `${CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_URI_PREFIX}${digest}`;
}

export function validateCrossDomainImpactManifestSealCapture(
  value: unknown,
): CrossDomainImpactManifestSealCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "admission",
  ], "$impactManifestSealCapture");
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
    "$impactManifestSealCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "cross-domain-impact-manifest-seal",
    "$impactManifestSealCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$impactManifestSealCapture.operation",
  );
  literalValue(
    operation.id,
    VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
    "$impactManifestSealCapture.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
    "$impactManifestSealCapture.operation.version",
  );
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError("$impactManifestSealCapture.sealedAt must be ISO-8601.");
  }
  const admission = parseCrossDomainImpactManifestSealParameters(
    encodeCrossDomainImpactManifestSealAdmission(root.admission),
  );
  return {
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
    kind: "cross-domain-impact-manifest-seal",
    operation: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$impactManifestSealCapture.trustedRunId"),
    decisionId: safeId(root.decisionId, "$impactManifestSealCapture.decisionId"),
    sealedAt: root.sealedAt,
    admission,
  };
}
