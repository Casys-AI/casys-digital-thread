/**
 * Synthetic labelled Buy fixtures. Commercial amounts are test inputs only.
 */

import { DESIGN_WRITE_GEOMETRY_TOOL } from "../cad/canonical/canonical-write-geometry-step.ts";
import { deterministicJson, sha256Hex } from "../kernel/deterministic-json.ts";
import {
  BUY_CONFIGURATION_SCHEMA,
  type BuyConfiguration,
  validateBuyConfiguration,
} from "./buy-configuration.ts";
import { type BuyCostSelection, type BuyPricingContext } from "./buy-cost-bundle.ts";
import { BUY_DECIMAL_SCHEMA } from "./buy-decimal.ts";
import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import {
  BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
  type BuyDocumentaryEstimate,
  type BuyDocumentaryEstimateEnvelope,
  type BuyEstimateSourceRef,
  validateBuyDocumentaryEstimateEnvelope,
} from "./buy-documentary-estimate.ts";
import {
  BUY_SOURCE_CAPTURE_SCHEMA,
  BUY_SOURCE_INSTANCE_KIND,
  type BuySourceCaptureBody,
} from "./buy-source-capture.ts";

export const BUY_FIXTURE_SITE =
  "sha256:d13ef23b272020d7984b1010e4f26c1770332f8c805abd60dc0f5dcc771c360d";
export const BUY_FIXTURE_STEP =
  "2572f73de4a8607fbd963642778019cfa742d6e06d9dd01a37294c0d3e7d8b5f";
export const BUY_FIXTURE_PARENT =
  "b59023102670e06b4e33e534d05008c0fe2440ae91dafbaa9c256c92a4ebe3e8";
export const BUY_FIXTURE_DOC =
  "sha256:885917c65832a21abef5d1e4f52cd779952b334f885429dc1c779708018099f4";
export const BUY_FIXTURE_RESOURCE =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const BUY_FIXTURE_CAPTURE =
  "sha256:aa33230c6af6abc929f1687ce6ffc00ccf920510e58efa3c53ec71f4dbbe9d5a";

export const BUY_FIXTURE_AS_OF = "2026-03-01T00:00:00.000Z";
export const BUY_FIXTURE_CAPTURED_AT = "2026-09-12T10:00:00.000Z";
export const BUY_FIXTURE_MODIFIED = "2026-09-01 08:00:00.000000";

export function buyPricingContext(
  required: BuyPricingContext["requiredDimensions"] = [
    "unit-price",
    "quantity",
    "uom",
    "currency",
  ],
): BuyPricingContext {
  return {
    currency: "EUR",
    asOf: BUY_FIXTURE_AS_OF,
    requiredDimensions: required,
    rounding: { schemaVersion: BUY_DECIMAL_SCHEMA, scale: 2, mode: "half-up" },
  };
}

export function buyConfigurationFixture(
  overrides: Partial<BuyConfiguration> = {},
): BuyConfiguration {
  return {
    schemaVersion: BUY_CONFIGURATION_SCHEMA,
    projectId: "reviewed-project-v1",
    subjectId: "project:reviewed-project-v1",
    configurationRevision: 1,
    basis: {
      snapshotId: "snapshot.buy.r1",
      revision: 1,
      subjectId: "project:reviewed-project-v1",
    },
    geometry: {
      parentOperation: DESIGN_WRITE_GEOMETRY_TOOL,
      parentArtifactId: `geometry-${BUY_FIXTURE_PARENT}`,
      parentFingerprint: BUY_FIXTURE_PARENT,
      stepArtifactId: `cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
      stepFingerprint: BUY_FIXTURE_STEP,
      stepUri:
        `thread-artifact://reviewed-project-v1/cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
      mediaType: "model/step",
    },
    lines: [{
      id: "line.fastener",
      partDefinition: { elementId: "pd.fastener" },
      occurrences: [{ elementId: "occ.fastener.1", quantity: "4", uom: "Nos" }],
      quantity: "4",
      uom: "Nos",
      sourcing: "buy",
      item: {
        doctype: "Item",
        name: "ITEM-SYNTHETIC-FASTENER",
        authority: "source-attested",
      },
      sources: [{
        kind: "agent-resource",
        uri: `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
        fingerprint: BUY_FIXTURE_RESOURCE,
      }],
      gaps: [],
    }],
    sources: [{
      kind: "agent-resource",
      uri: `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
      fingerprint: BUY_FIXTURE_RESOURCE,
    }],
    gaps: [],
    ...overrides,
  };
}

export function buyCaptureBodyFixture(
  overrides: Partial<BuySourceCaptureBody> = {},
): BuySourceCaptureBody {
  return {
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    sourceInstance: { kind: BUY_SOURCE_INSTANCE_KIND, siteId: BUY_FIXTURE_SITE },
    capturedAt: BUY_FIXTURE_CAPTURED_AT,
    documents: [{
      doctype: "Item Price",
      name: "ITEM-PRICE-SYNTHETIC-001",
      modified: BUY_FIXTURE_MODIFIED,
      sourceCategory: "catalogue-price",
      fingerprint: BUY_FIXTURE_DOC,
      fields: {
        item_code: "ITEM-SYNTHETIC-FASTENER",
        item_name: "Synthetic fastener",
        uom: "Nos",
        currency: "EUR",
        price_list_rate: "1.25",
        price_list: "SYNTHETIC-BUYING",
        valid_from: "2026-01-01",
        valid_upto: "2026-12-31",
      },
    }],
    consistency: { kind: "repeated-read", reads: 2, consistent: true },
    ...overrides,
  };
}

export const BUY_FIXTURE_ESTIMATE_OBSERVED_AT = "2026-02-10T09:00:00.000Z";
export const BUY_FIXTURE_EVIDENCE_DIGEST =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

/** Actual SHA-256 of the validated configuration canonical bytes. */
export async function buyConfigurationDigest(
  configuration: BuyConfiguration,
): Promise<string> {
  const validated = validateBuyConfiguration(configuration);
  return await sha256Hex(new TextEncoder().encode(deterministicJson(validated)));
}

/**
 * Explicitly synthetic evidence reference: well-formed but not captured.
 * Operational paths receive genuine store references only.
 */
export function buySyntheticEvidenceReference(
  digest = BUY_FIXTURE_EVIDENCE_DIGEST,
): AgentResourceReference {
  return {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${digest}`,
    name: "synthetic-evidence.txt",
    mimeType: "text/plain",
    representation: "text",
    byteCount: 32,
    fingerprint: { algorithm: "sha256", digest },
  };
}

export function buyEstimateSourceRef(
  overrides: {
    readonly reference?: AgentResourceReference;
    readonly anchor?: string;
    readonly observedAt?: string;
  } = {},
): BuyEstimateSourceRef {
  return {
    reference: overrides.reference ?? buySyntheticEvidenceReference(),
    anchor: overrides.anchor ?? "synthetic page 2, line 7",
    observedAt: overrides.observedAt ?? BUY_FIXTURE_ESTIMATE_OBSERVED_AT,
  };
}

/**
 * Pure-domain fixture envelope with an explicitly synthetic external
 * locator bound to the canonical bytes. Operational paths build the
 * envelope from an exact store reopen instead.
 */
export async function buyDocumentaryEstimateEnvelopeFixture(
  estimate: BuyDocumentaryEstimate,
): Promise<BuyDocumentaryEstimateEnvelope> {
  const canonicalText = deterministicJson(estimate);
  const bytes = new TextEncoder().encode(canonicalText);
  const digest = await sha256Hex(bytes);
  return validateBuyDocumentaryEstimateEnvelope({
    schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    estimate,
    capture: {
      schemaVersion: "agent-resource-capture/1.0",
      uri: `casys://agent-resource-capture/sha256/${digest}`,
      name: "synthetic-estimate-input.json",
      mimeType: "application/json",
      representation: "text",
      byteCount: bytes.byteLength,
      fingerprint: { algorithm: "sha256", digest },
    },
    canonicalText,
    fingerprint: `sha256:${digest}`,
    byteCount: bytes.byteLength,
  });
}

export function buyDocumentaryEstimateFixture(
  configurationDigest: string,
  overrides: Partial<BuyDocumentaryEstimate> = {},
): BuyDocumentaryEstimate {
  return {
    schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    estimateId: "estimate.synthetic.machining",
    projectId: "reviewed-project-v1",
    subjectId: "project:reviewed-project-v1",
    configurationDigest,
    basis: {
      snapshotId: "snapshot.buy.r1",
      revision: 1,
      subjectId: "project:reviewed-project-v1",
    },
    geometry: {
      parentArtifactId: `geometry-${BUY_FIXTURE_PARENT}`,
      parentFingerprint: BUY_FIXTURE_PARENT,
      stepArtifactId: `cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
      stepFingerprint: BUY_FIXTURE_STEP,
      stepUri:
        `thread-artifact://reviewed-project-v1/cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
    },
    asOf: BUY_FIXTURE_AS_OF,
    sourceValidity: { from: "2026-01-01", to: "2026-12-31" },
    currency: "EUR",
    lines: [{
      configurationLineId: "line.fastener",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [
        {
          id: "material.bar",
          nature: "material",
          consumption: {
            operand: "sourced",
            decimal: "2",
            uom: "kg",
            source: buyEstimateSourceRef(),
          },
          rate: {
            operand: "sourced",
            decimal: "10.50",
            perUom: "kg",
            currency: "EUR",
            source: buyEstimateSourceRef({ anchor: "synthetic page 2, line 9" }),
          },
        },
        {
          id: "labour.turning",
          nature: "labour",
          consumption: {
            operand: "sourced",
            decimal: "3",
            uom: "h",
            source: buyEstimateSourceRef({ anchor: "synthetic page 3, line 1" }),
          },
          rate: {
            operand: "sourced",
            decimal: "45.00",
            perUom: "h",
            currency: "EUR",
            source: buyEstimateSourceRef({ anchor: "synthetic page 3, line 4" }),
          },
        },
      ],
    }],
    assumptions: ["Synthetic stock size covers the part envelope."],
    ...overrides,
  };
}

export function buyTwoLineConfigurationFixture(): BuyConfiguration {
  const base = buyConfigurationFixture();
  return {
    ...base,
    lines: [
      ...base.lines,
      {
        id: "line.bracket",
        partDefinition: { elementId: "pd.bracket" },
        occurrences: [{ elementId: "occ.bracket.1", quantity: "2", uom: "Nos" }],
        quantity: "2",
        uom: "Nos",
        sourcing: "buy",
        item: {
          doctype: "Item",
          name: "ITEM-SYNTHETIC-BRACKET",
          authority: "source-attested",
        },
        sources: [...base.sources],
        gaps: [],
      },
    ],
  };
}

export function buyPricedSelection(
  captureFingerprint = BUY_FIXTURE_CAPTURE,
  overrides: {
    readonly sourceInstance?: BuySourceCaptureBody["sourceInstance"];
    readonly modified?: string;
  } = {},
): BuyCostSelection {
  return {
    configurationLineId: "line.fastener",
    costClass: "catalogue",
    citation: {
      kind: "erp-attested",
      sourceInstance: overrides.sourceInstance ?? {
        kind: BUY_SOURCE_INSTANCE_KIND,
        siteId: BUY_FIXTURE_SITE,
      },
      captureFingerprint,
      document: { doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-001" },
      modified: overrides.modified ?? BUY_FIXTURE_MODIFIED,
      documentFingerprint: BUY_FIXTURE_DOC,
    },
  };
}
