import { assertEquals } from "@std/assert";
import { deterministicJson, sha256Hex } from "../kernel/deterministic-json.ts";
import { computeBuyCostCandidate, validateBuyCostBundle } from "./buy-cost-bundle.ts";
import { BUY_SOURCE_CAPTURE_SCHEMA } from "./buy-source-capture.ts";
import {
  BUY_FIXTURE_AS_OF,
  BUY_FIXTURE_SITE,
  buyCaptureBodyFixture,
  buyConfigurationFixture,
  buyPricedSelection,
  buyPricingContext,
} from "./buy-fixtures.ts";
import { validateBuyConfiguration } from "./buy-configuration.ts";

async function captureEnvelope(body = buyCaptureBodyFixture()) {
  const canonicalText = deterministicJson(body);
  const digest = await sha256Hex(new TextEncoder().encode(canonicalText));
  return {
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    capture: body,
    canonicalText,
    fingerprint: `sha256:${digest}`,
    byteCount: new TextEncoder().encode(canonicalText).byteLength,
  };
}

Deno.test("covered subtotal uses independent fixture arithmetic, not a free unpriced line", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const envelope = await captureEnvelope();
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint)],
  });
  // Independent: 4 × 1.25 = 5.00. Not computed by calling multiplyBuyDecimals.
  assertEquals(bundle.totals[0]?.kind, "covered-subtotal");
  assertEquals(bundle.totals[0]?.amount, "5.00");
  assertEquals(bundle.coverage.status, "complete");
  assertEquals(bundle.totals.some((total) => total.kind === "total-complete"), true);
  validateBuyCostBundle(bundle);
});

Deno.test("missing tax/transport required dimensions cannot default to zero", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const envelope = await captureEnvelope();
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext([
      "unit-price",
      "quantity",
      "uom",
      "currency",
      "tax",
      "transport",
    ]),
    selections: [buyPricedSelection(envelope.fingerprint)],
  });
  assertEquals(bundle.coverage.status, "partial");
  assertEquals(bundle.totals.some((total) => total.kind === "total-complete"), false);
  assertEquals(
    bundle.lines[0]?.gaps.some((gap) => gap.code === "dimension-unknown"),
    true,
  );
  assertEquals(bundle.lines[0]?.amount, "5.00");
  assertEquals(bundle.coverage.excludedLineIds, []);
  assertEquals(bundle.coverage.unknownDimensions.includes("tax"), true);
  assertEquals(bundle.coverage.unknownDimensions.includes("transport"), true);
});

Deno.test("unknown UOM or FX is a gap", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const body = buyCaptureBodyFixture({
    documents: [{
      ...buyCaptureBodyFixture().documents[0]!,
      fields: {
        ...buyCaptureBodyFixture().documents[0]!.fields,
        uom: "Kg",
        currency: "USD",
      },
    }],
  });
  const envelope = await captureEnvelope(body);
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint)],
  });
  assertEquals(
    bundle.lines[0]?.gaps.some((gap) => gap.code === "uom-unresolved"),
    true,
  );
  assertEquals(bundle.lines[0]?.gaps.some((gap) => gap.code === "fx-unresolved"), true);
  assertEquals(bundle.coverage.status !== "complete", true);
});

Deno.test("expired price keeps old validity and does not become current", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const body = buyCaptureBodyFixture({
    documents: [{
      ...buyCaptureBodyFixture().documents[0]!,
      fields: {
        ...buyCaptureBodyFixture().documents[0]!.fields,
        valid_upto: "2026-01-15",
      },
    }],
  });
  const envelope = await captureEnvelope(body);
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint)],
  });
  assertEquals(bundle.lines[0]?.gaps.some((gap) => gap.code === "price-expired"), true);
  assertEquals(bundle.lines[0]?.sourceValidity?.to, "2026-01-15");
  assertEquals(bundle.lines[0]?.asOf, BUY_FIXTURE_AS_OF);
  assertEquals(bundle.lines[0]?.amount, undefined);
});

Deno.test("unpriced components are excluded, not counted as free", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const envelope = await captureEnvelope();
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [],
  });
  assertEquals(
    bundle.lines[0]?.gaps.some((gap) => gap.code === "unpriced-component"),
    true,
  );
  assertEquals(bundle.coverage.excludedLineIds, ["line.fastener"]);
  assertEquals(bundle.totals[0]?.amount, "0.00");
  assertEquals(bundle.coverage.status, "unresolved");
});

Deno.test("sourceInstance spoof and modified mismatch become gaps", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const envelope = await captureEnvelope();
  const spoof = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: `sha256:${"0".repeat(64)}`,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint, {
      sourceInstance: envelope.capture.sourceInstance,
    })],
  });
  assertEquals(
    spoof.gaps.some((gap) => gap.code === "source-instance-mismatch"),
    true,
  );
  const modified = computeBuyCostCandidate({
    configuration,
    configurationDigest: "1".repeat(64),
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint, {
      modified: "2020-01-01 00:00:00",
    })],
  });
  assertEquals(
    modified.lines[0]?.gaps.some((gap) => gap.code === "modified-mismatch"),
    true,
  );
});
