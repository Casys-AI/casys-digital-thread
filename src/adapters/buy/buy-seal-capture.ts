/**
 * CAS envelope for `buy.seal-configuration-cost@1`.
 *
 * The sealed bundle bytes are the candidate bundle bytes. No ERP refresh.
 */

import {
  BUY_SEAL_CONFIGURATION_COST_OPERATION,
} from "../../domain/buy/buy-operations.ts";
import {
  type BuyConfiguration,
  validateBuyConfiguration,
} from "../../domain/buy/buy-configuration.ts";
import {
  BUY_COVERAGE_STATUSES,
  type BuyCostBundle,
  type BuyCoverageStatus,
  validateBuyCostBundle,
} from "../../domain/buy/buy-cost-bundle.ts";
import {
  type BuySourceCaptureEnvelope,
  validateBuySourceCaptureEnvelope,
} from "../../domain/buy/buy-source-capture.ts";
import {
  arrayOf,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const BUY_SEAL_CAPTURE_SCHEMA =
  "buy-configuration-cost-seal-capture/1.0" as const;
export const BUY_SEAL_CAPTURE_URI_PREFIX =
  "casys://buy-configuration-cost-seal-capture/sha256/" as const;

export const BUY_REVIEW_STATUSES = [
  "complete",
  "partial",
  "documentary",
] as const;
export type BuyReviewStatus = typeof BUY_REVIEW_STATUSES[number];

export interface BuySealCapture {
  readonly schemaVersion: typeof BUY_SEAL_CAPTURE_SCHEMA;
  readonly kind: "buy.configuration-cost-sealed";
  readonly operation: typeof BUY_SEAL_CONFIGURATION_COST_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly candidateDigest: string;
  readonly bundleDigest: string;
  readonly configurationDigest: string;
  readonly configuration: BuyConfiguration;
  readonly bundle: BuyCostBundle;
  readonly sourceCaptures: readonly BuySourceCaptureEnvelope[];
  readonly coverageStatus: BuyCoverageStatus;
  readonly reviewStatus: BuyReviewStatus;
  readonly sealedAt: string;
}

export async function validateBuySealCapture(
  value: unknown,
): Promise<BuySealCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "candidateDigest",
    "bundleDigest",
    "configurationDigest",
    "configuration",
    "bundle",
    "sourceCaptures",
    "coverageStatus",
    "reviewStatus",
    "sealedAt",
  ], "$buySealCapture");
  literalValue(
    root.schemaVersion,
    BUY_SEAL_CAPTURE_SCHEMA,
    "$buySealCapture.schemaVersion",
  );
  literalValue(root.kind, "buy.configuration-cost-sealed", "$buySealCapture.kind");
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$buySealCapture.operation",
  );
  literalValue(
    operation.id,
    BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
    "$buySealCapture.operation.id",
  );
  literalValue(
    operation.version,
    BUY_SEAL_CONFIGURATION_COST_OPERATION.version,
    "$buySealCapture.operation.version",
  );
  const configuration = validateBuyConfiguration(root.configuration);
  const bundle = validateBuyCostBundle(root.bundle);
  const bundleDigest = nonEmptyText(root.bundleDigest, "$buySealCapture.bundleDigest");
  if (bundleDigest !== (await sha256Fingerprint(bundle)).digest) {
    throw new TypeError("$buySealCapture.bundleDigest does not match.");
  }
  const coverageStatus = oneOf(
    root.coverageStatus,
    BUY_COVERAGE_STATUSES,
    "$buySealCapture.coverageStatus",
  );
  if (coverageStatus !== bundle.coverage.status) {
    throw new TypeError("$buySealCapture.coverageStatus does not match the bundle.");
  }
  return {
    schemaVersion: BUY_SEAL_CAPTURE_SCHEMA,
    kind: "buy.configuration-cost-sealed",
    operation: BUY_SEAL_CONFIGURATION_COST_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$buySealCapture.trustedRunId"),
    decisionId: safeId(root.decisionId, "$buySealCapture.decisionId"),
    candidateDigest: sha256(root.candidateDigest, "$buySealCapture.candidateDigest"),
    bundleDigest,
    configurationDigest: sha256(
      root.configurationDigest,
      "$buySealCapture.configurationDigest",
    ),
    configuration,
    bundle,
    sourceCaptures: arrayOf(root.sourceCaptures, "$buySealCapture.sourceCaptures")
      .map((item) => validateBuySourceCaptureEnvelope(item)),
    coverageStatus,
    reviewStatus: oneOf(
      root.reviewStatus,
      BUY_REVIEW_STATUSES,
      "$buySealCapture.reviewStatus",
    ),
    sealedAt: nonEmptyText(root.sealedAt, "$buySealCapture.sealedAt"),
  };
}

export async function fingerprintBuySealCapture(
  capture: BuySealCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function canonicalBuySealCaptureText(capture: BuySealCapture): string {
  return deterministicJson(capture);
}

function sha256(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex SHA-256 digest.`);
  }
  return text;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
