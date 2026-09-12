/**
 * CAS envelope for `buy.capture-configuration-cost@1`.
 *
 * The published candidate is documentary. It is not approved spend and not a
 * current cost claim. Seal reopens these exact bytes.
 */

import { assertBuySourceLineage } from "./buy-source-lineage.ts";
import { BUY_CAPTURE_CONFIGURATION_COST_OPERATION } from "./buy-operations.ts";
import {
  BUY_CONFIGURATION_SCHEMA,
  type BuyConfiguration,
  validateBuyConfiguration,
} from "./buy-configuration.ts";
import {
  BUY_COST_BUNDLE_SCHEMA,
  type BuyCostBundle,
  validateBuyCostBundle,
} from "./buy-cost-bundle.ts";
import {
  type BuySourceCaptureEnvelope,
  validateBuySourceCaptureEnvelope,
} from "./buy-source-capture.ts";
import {
  arrayOf,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const BUY_CANDIDATE_CAPTURE_SCHEMA =
  "buy-configuration-cost-candidate-capture/1.0" as const;
export const BUY_CANDIDATE_CAPTURE_URI_PREFIX =
  "casys://buy-configuration-cost-candidate-capture/sha256/" as const;

export interface BuyCandidateCapture {
  readonly schemaVersion: typeof BUY_CANDIDATE_CAPTURE_SCHEMA;
  readonly kind: "buy.configuration-cost-candidate";
  readonly operation: typeof BUY_CAPTURE_CONFIGURATION_COST_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly configurationDigest: string;
  readonly bundleDigest: string;
  readonly configuration: BuyConfiguration;
  readonly bundle: BuyCostBundle;
  readonly sourceCaptures: readonly BuySourceCaptureEnvelope[];
  readonly capturedAt: string;
}

export async function validateBuyCandidateCapture(
  value: unknown,
): Promise<BuyCandidateCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "configurationDigest",
    "bundleDigest",
    "configuration",
    "bundle",
    "sourceCaptures",
    "capturedAt",
  ], "$buyCandidateCapture");
  literalValue(
    root.schemaVersion,
    BUY_CANDIDATE_CAPTURE_SCHEMA,
    "$buyCandidateCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "buy.configuration-cost-candidate",
    "$buyCandidateCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$buyCandidateCapture.operation",
  );
  literalValue(
    operation.id,
    BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
    "$buyCandidateCapture.operation.id",
  );
  literalValue(
    operation.version,
    BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version,
    "$buyCandidateCapture.operation.version",
  );
  const configuration = validateBuyConfiguration(root.configuration);
  if (configuration.schemaVersion !== BUY_CONFIGURATION_SCHEMA) {
    throw new TypeError(
      "$buyCandidateCapture.configuration schema is divergent.",
    );
  }
  const bundle = validateBuyCostBundle(root.bundle);
  if (bundle.schemaVersion !== BUY_COST_BUNDLE_SCHEMA) {
    throw new TypeError("$buyCandidateCapture.bundle schema is divergent.");
  }
  const configurationDigest = nonEmptyText(
    root.configurationDigest,
    "$buyCandidateCapture.configurationDigest",
  );
  const bundleDigest = nonEmptyText(
    root.bundleDigest,
    "$buyCandidateCapture.bundleDigest",
  );
  if (configurationDigest !== (await sha256Fingerprint(configuration)).digest) {
    throw new TypeError(
      "$buyCandidateCapture.configurationDigest does not match.",
    );
  }
  if (bundleDigest !== (await sha256Fingerprint(bundle)).digest) {
    throw new TypeError("$buyCandidateCapture.bundleDigest does not match.");
  }
  if (bundle.configurationRef.digest !== configurationDigest) {
    throw new TypeError(
      "Candidate bundle configurationRef does not match the configuration.",
    );
  }
  const sourceCaptures = arrayOf(
    root.sourceCaptures,
    "$buyCandidateCapture.sourceCaptures",
  )
    .map((item) => validateBuySourceCaptureEnvelope(item));
  await assertBuySourceLineage(bundle, sourceCaptures);
  return {
    schemaVersion: BUY_CANDIDATE_CAPTURE_SCHEMA,
    kind: "buy.configuration-cost-candidate",
    operation: BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$buyCandidateCapture.trustedRunId",
    ),
    decisionId: safeId(root.decisionId, "$buyCandidateCapture.decisionId"),
    configurationDigest,
    bundleDigest,
    configuration,
    bundle,
    sourceCaptures,
    capturedAt: nonEmptyText(
      root.capturedAt,
      "$buyCandidateCapture.capturedAt",
    ),
  };
}

export async function fingerprintBuyCandidateCapture(
  capture: BuyCandidateCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function canonicalBuyCandidateCaptureText(
  capture: BuyCandidateCapture,
): string {
  return deterministicJson(capture);
}
