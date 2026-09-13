/**
 * Synthetic labelled Buy fixtures. Commercial amounts are test inputs only.
 */

import { DESIGN_WRITE_GEOMETRY_TOOL } from "../cad/canonical/canonical-write-geometry-step.ts";
import {
  BUY_CONFIGURATION_SCHEMA,
  type BuyConfiguration,
} from "./buy-configuration.ts";
import { type BuyCostSelection, type BuyPricingContext } from "./buy-cost-bundle.ts";
import { BUY_DECIMAL_SCHEMA } from "./buy-decimal.ts";
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
