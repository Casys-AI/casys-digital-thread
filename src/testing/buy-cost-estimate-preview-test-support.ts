/**
 * Genuine Buy estimate preview fixtures computed through the real domain
 * calculators. Test-only; production wiring stays server-owned.
 */

import { computeBuyCostCandidateV2 } from "../domain/buy/buy-cost-bundle-v2.ts";
import { computeBuyCostCandidate } from "../domain/buy/buy-cost-bundle.ts";
import { computeBuyProductionEstimateCandidate } from "../domain/buy/buy-production-estimate.ts";
import type { BuyDocumentaryEstimate } from "../domain/buy/buy-documentary-estimate.ts";
import {
  BUY_FIXTURE_AS_OF,
  BUY_FIXTURE_SITE,
  buyCaptureBodyFixture,
  buyConfigurationDigest,
  buyDocumentaryEstimateEnvelopeFixture,
  buyDocumentaryEstimateFixture,
  buyEstimateSourceRef,
  buyPricedSelection,
  buyPricingContext,
  buyTwoLineConfigurationFixture,
} from "../domain/buy/buy-fixtures.ts";
import { BUY_SOURCE_CAPTURE_SCHEMA } from "../domain/buy/buy-source-capture.ts";
import { validateBuyConfiguration } from "../domain/buy/buy-configuration.ts";
import { validateBuySourceCaptureEnvelope } from "../domain/buy/buy-source-capture.ts";
import { deterministicJson, sha256Hex } from "../domain/kernel/deterministic-json.ts";

export const PREVIEW_TEST_PROJECT_ID = "reviewed-project-v1";
export const PREVIEW_TEST_BASIS = {
  kind: "thread-snapshot",
  snapshotId: "snapshot.buy.r2",
  revision: 2,
  subjectId: "project:reviewed-project-v1",
} as const;
export const PREVIEW_TEST_CANDIDATE_DIGEST = "ab".repeat(32);

export async function genuinePreviewResult(
  estimateOverrides: Partial<BuyDocumentaryEstimate> = {},
  lineTerms: BuyDocumentaryEstimate["lines"][number]["terms"] = [{
    id: "material.bracket",
    nature: "material",
    consumption: {
      operand: "sourced",
      decimal: "1",
      uom: "kg",
      source: buyEstimateSourceRef(),
    },
    rate: {
      operand: "sourced",
      decimal: "50.00",
      perUom: "kg",
      currency: "EUR",
      source: buyEstimateSourceRef(),
    },
  }],
) {
  const rawConfiguration = buyTwoLineConfigurationFixture();
  const configuration = validateBuyConfiguration(rawConfiguration);
  const digest = await buyConfigurationDigest(rawConfiguration);
  const body = buyCaptureBodyFixture();
  const canonicalText = deterministicJson(body);
  const captureDigest = await sha256Hex(new TextEncoder().encode(canonicalText));
  const envelope = validateBuySourceCaptureEnvelope({
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    capture: body,
    canonicalText,
    fingerprint: `sha256:${captureDigest}`,
    byteCount: new TextEncoder().encode(canonicalText).byteLength,
  });
  const base = computeBuyCostCandidate({
    configuration,
    configurationDigest: digest,
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint)],
  });
  const estimate = buyDocumentaryEstimateFixture(digest, {
    ...estimateOverrides,
    estimateId: "estimate.synthetic.bracket",
    lines: [{
      configurationLineId: "line.bracket",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: lineTerms,
    }],
  });
  const estimateEnvelope = await buyDocumentaryEstimateEnvelopeFixture(estimate);
  const annex = await computeBuyProductionEstimateCandidate({
    configuration,
    configurationDigest: digest,
    estimate: estimateEnvelope,
    pricingContext: buyPricingContext(),
  });
  const bundle = await computeBuyCostCandidateV2({
    configuration,
    configurationDigest: digest,
    baseBundle: base,
    estimates: [annex],
    pricingContext: buyPricingContext(),
  });
  const evidenceRef = buyEstimateSourceRef().reference;
  return {
    inputRefs: [estimateEnvelope.capture],
    result: {
      status: "preview",
      projectId: PREVIEW_TEST_PROJECT_ID,
      basis: { ...PREVIEW_TEST_BASIS },
      candidate: {
        artifactId: `buy-cost-candidate-${PREVIEW_TEST_CANDIDATE_DIGEST}`,
        digest: PREVIEW_TEST_CANDIDATE_DIGEST,
      },
      configurationDigest: digest,
      pricing: { currency: "EUR", asOf: BUY_FIXTURE_AS_OF },
      estimates: [{
        captureUri: annex.estimateSource.inputCaptureUri,
        digest: annex.estimateSource.inputFingerprint.replace(/^sha256:/, ""),
        estimateId: "estimate.synthetic.bracket",
        lineIds: ["line.bracket"],
        provisionalLineIds: [] as string[],
      }],
      evidence: [{
        uri: evidenceRef.uri,
        digest: evidenceRef.fingerprint.digest,
        byteCount: evidenceRef.byteCount,
        mimeType: evidenceRef.mimeType,
        anchors: ["synthetic page 2, line 7"],
        observedAts: ["2026-02-10T09:00:00.000Z"],
      }],
      annexes: [annex],
      bundle,
      nature: "documentary",
      provisional: false,
      authority: {
        registeredSeal: "no registered seal executed",
        spendingApproval: "none",
        qualification: "none",
      },
      limits: {
        maxEstimates: 8,
        maxBytesPerSource: 262144,
        acceptedMimeTypes: ["application/json", "text/plain"],
      },
    },
  };
}
