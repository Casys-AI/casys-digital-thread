import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { deterministicJson, sha256Hex } from "../kernel/deterministic-json.ts";
import { validateBuyConfiguration } from "./buy-configuration.ts";
import { computeBuyCostCandidate, validateBuyCostBundle } from "./buy-cost-bundle.ts";
import {
  assertBuyCostBundleV2Lineage,
  computeBuyCostCandidateV2,
  validateBuyCostBundleV2,
} from "./buy-cost-bundle-v2.ts";
import type { BuyDocumentaryEstimate } from "./buy-documentary-estimate.ts";
import {
  type BuyProductionEstimateBundle,
  computeBuyProductionEstimateCandidate,
  validateBuyProductionEstimateBundle,
} from "./buy-production-estimate.ts";
import {
  BUY_FIXTURE_SITE,
  buyCaptureBodyFixture,
  buyConfigurationDigest,
  buyConfigurationFixture,
  buyDocumentaryEstimateEnvelopeFixture,
  buyDocumentaryEstimateFixture,
  buyEstimateSourceRef,
  buyPricedSelection,
  buyPricingContext,
  buyTwoLineConfigurationFixture,
} from "./buy-fixtures.ts";

async function erpEnvelope(body = buyCaptureBodyFixture()) {
  const canonicalText = deterministicJson(body);
  const digest = await sha256Hex(new TextEncoder().encode(canonicalText));
  return {
    schemaVersion: body.schemaVersion,
    capture: body,
    canonicalText,
    fingerprint: `sha256:${digest}`,
    byteCount: new TextEncoder().encode(canonicalText).byteLength,
  };
}

async function annexFor(
  configurationDigest: string,
  overrides: Partial<BuyDocumentaryEstimate>,
): Promise<BuyProductionEstimateBundle> {
  const estimate = buyDocumentaryEstimateFixture(configurationDigest, overrides);
  const envelope = await buyDocumentaryEstimateEnvelopeFixture(estimate);
  const configuration = validateBuyConfiguration(buyTwoLineConfigurationFixture());
  const bundle = await computeBuyProductionEstimateCandidate({
    configuration,
    configurationDigest,
    estimate: envelope,
    pricingContext: buyPricingContext(),
  });
  return validateBuyProductionEstimateBundle(bundle);
}

function bracketLine(termRate: {
  readonly operand: "sourced" | "assumed";
  readonly decimal: string;
}): BuyDocumentaryEstimate["lines"][number] {
  const source = buyEstimateSourceRef({ anchor: "synthetic bracket sheet" });
  return {
    configurationLineId: "line.bracket",
    quantityBasis: "per-configuration-unit",
    productUom: "Nos",
    terms: [{
      id: "material.bracket",
      nature: "material",
      consumption: { operand: "sourced", decimal: "1", uom: "kg", source },
      rate: termRate.operand === "sourced"
        ? {
          operand: "sourced",
          decimal: termRate.decimal,
          perUom: "kg",
          currency: "EUR",
          source,
        }
        : {
          operand: "assumed",
          decimal: termRate.decimal,
          perUom: "kg",
          currency: "EUR",
          justification: {
            statement: "Synthetic assumed bracket rate.",
            source,
          },
        },
    }],
  };
}

async function twoLineBase() {
  const configuration = validateBuyConfiguration(buyTwoLineConfigurationFixture());
  const digest = await buyConfigurationDigest(buyTwoLineConfigurationFixture());
  const envelope = await erpEnvelope();
  const base = computeBuyCostCandidate({
    configuration,
    configurationDigest: digest,
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [buyPricedSelection(envelope.fingerprint)],
  });
  return { configuration, digest, base: validateBuyCostBundle(base) };
}

Deno.test("mixed catalogue and estimate lines compose through the shared aggregator", async () => {
  const { configuration, digest, base } = await twoLineBase();
  assertEquals(base.lines[0]?.amount, "5.00");
  assertEquals(base.lines[1]?.amount, undefined);
  const annex = await annexFor(digest, {
    estimateId: "estimate.synthetic.bracket",
    lines: [bracketLine({ operand: "assumed", decimal: "50.00" })],
  });
  assertEquals(annex.lines[0]?.unitCost, "50.00");
  const v2 = await computeBuyCostCandidateV2({
    configuration,
    configurationDigest: digest,
    baseBundle: base,
    estimates: [annex],
    pricingContext: buyPricingContext(),
  });
  const fastener = v2.lines[0]!;
  const bracket = v2.lines[1]!;
  assertEquals(fastener.costClass, "catalogue");
  assertEquals(fastener.citation?.kind, "erp-attested");
  assertEquals(fastener.provisional, false);
  assertEquals(fastener.amount, "5.00");
  assertEquals(bracket.costClass, "estimate");
  assertEquals(bracket.citation?.kind, "external-documentary");
  const citation = bracket.citation;
  if (citation?.kind !== "external-documentary") {
    throw new Error("expected an external-documentary citation");
  }
  assertEquals(citation.resourceUri, annex.estimateSource.inputCaptureUri);
  assertEquals(citation.fingerprint, annex.estimateSource.inputFingerprint);
  assertEquals(
    bracket.annexRef?.inputFingerprint,
    annex.estimateSource.inputFingerprint,
  );
  assertEquals(bracket.annexRef?.annexFingerprint === citation.fingerprint, false);
  assertEquals(bracket.provisional, true);
  assertEquals(bracket.unitPrice, "50.00");
  // Independent: bracket 1 x 50.00 = 50.00 per unit, x2 units = 100.00;
  // covered subtotal 5.00 + 100.00 = 105.00 via the shared aggregator.
  assertEquals(bracket.amount, "100.00");
  assertEquals(v2.totals[0]?.kind, "covered-subtotal");
  assertEquals(v2.totals[0]?.amount, "105.00");
  assertEquals(v2.coverage.status, "complete");
  assertEquals(v2.totals.some((total) => total.kind === "total-complete"), true);
  assertEquals(v2.estimateProvenance[0]?.provisionalLineIds, ["line.bracket"]);
  validateBuyCostBundleV2(v2);
  await assertBuyCostBundleV2Lineage(v2, {
    baseBundle: base,
    annexes: [annex],
    configuration,
  });
});

Deno.test("usable ERP price plus usable estimate for one line is refused", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const annex = await annexFor(digest, {
    estimateId: "estimate.synthetic.fastener",
    lines: [{
      configurationLineId: "line.fastener",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [{
        id: "material.bar",
        nature: "material",
        consumption: {
          operand: "sourced",
          decimal: "1",
          uom: "kg",
          source: buyEstimateSourceRef(),
        },
        rate: {
          operand: "sourced",
          decimal: "9.00",
          perUom: "kg",
          currency: "EUR",
          source: buyEstimateSourceRef(),
        },
      }],
    }],
  });
  assertEquals(annex.lines[0]?.unitCost, "9.00");
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: base,
        estimates: [annex],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "never silently replace",
  );
});

Deno.test("unknown annex lines and duplicate annex coverage are refused", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const annex = await annexFor(digest, {
    lines: [bracketLine({ operand: "sourced", decimal: "50.00" })],
  });
  const unknown = validateBuyProductionEstimateBundle({
    ...JSON.parse(JSON.stringify(annex)),
    lines: [{
      ...annex.lines[0],
      configurationLineId: "line.unknown",
    }],
  });
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: base,
        estimates: [unknown],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "unknown configuration line",
  );
  const other = await annexFor(digest, {
    estimateId: "estimate.synthetic.bracket.second",
    lines: [bracketLine({ operand: "sourced", decimal: "51.00" })],
  });
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: base,
        estimates: [annex, other],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "must not contain duplicates",
  );
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: base,
        estimates: [annex, annex],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "must not contain duplicates",
  );
});

Deno.test("lines with unknown terms stay out of the covered subtotal with facts kept", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const source = buyEstimateSourceRef();
  const annex = await annexFor(digest, {
    lines: [{
      configurationLineId: "line.bracket",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [
        {
          id: "material.bracket",
          nature: "material",
          consumption: { operand: "sourced", decimal: "1", uom: "kg", source },
          rate: {
            operand: "sourced",
            decimal: "50.00",
            perUom: "kg",
            currency: "EUR",
            source,
          },
        },
        {
          id: "energy.unknown",
          nature: "other",
          consumption: { operand: "unknown" },
          rate: {
            operand: "sourced",
            decimal: "0.30",
            perUom: "kWh",
            currency: "EUR",
            source,
          },
        },
      ],
    }],
  });
  assertEquals(annex.lines[0]?.unitCost, undefined);
  assertEquals(annex.lines[0]?.terms[0]?.termAmount, "50.00");
  const v2 = await computeBuyCostCandidateV2({
    configuration,
    configurationDigest: digest,
    baseBundle: base,
    estimates: [annex],
    pricingContext: buyPricingContext(),
  });
  assertEquals(v2.lines[1]?.amount, undefined);
  assertEquals(v2.coverage.excludedLineIds, ["line.bracket"]);
  assertEquals(v2.totals[0]?.amount, "5.00");
  assertEquals(v2.coverage.status, "partial");
  assertEquals(v2.estimateProvenance[0]?.configurationLineIds, ["line.bracket"]);
  validateBuyCostBundleV2(v2);
  await assertBuyCostBundleV2Lineage(v2, {
    baseBundle: base,
    annexes: [annex],
    configuration,
  });
});

Deno.test("base, pricing, and digest preservation are exact", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const annex = await annexFor(digest, {
    lines: [bracketLine({ operand: "sourced", decimal: "50.00" })],
  });
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: "0".repeat(64),
        baseBundle: base,
        estimates: [annex],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "not the SHA-256",
  );
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: base,
        estimates: [annex],
        pricingContext: buyPricingContext([
          "unit-price",
          "quantity",
          "uom",
          "currency",
          "tax",
        ]),
      }),
    TypeError,
    "must equal the base bundle pricingContext exactly",
  );
  const singleLineBase = computeBuyCostCandidate({
    configuration: validateBuyConfiguration(buyConfigurationFixture()),
    configurationDigest: await buyConfigurationDigest(buyConfigurationFixture()),
    captures: [await erpEnvelope()],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: [],
  });
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: singleLineBase,
        estimates: [annex],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "does not match the validated configuration",
  );
});

Deno.test("v1 readers refuse v2 and v1 fixture output is unchanged", async () => {
  const { base } = await twoLineBase();
  const v2 = await computeBuyCostCandidateV2({
    configuration: validateBuyConfiguration(buyTwoLineConfigurationFixture()),
    configurationDigest: await buyConfigurationDigest(buyTwoLineConfigurationFixture()),
    baseBundle: base,
    estimates: [],
    pricingContext: buyPricingContext(),
  });
  assertThrows(
    () => validateBuyCostBundle(v2),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () => validateBuyCostBundleV2({ ...v2, inventedField: true }),
    TypeError,
    "unsupported field",
  );
  assertEquals(base.lines[0]?.amount, "5.00");
  assertEquals(base.totals[0]?.amount, "5.00");
  validateBuyCostBundle(base);
  validateBuyCostBundleV2(v2);
});

Deno.test("v2 lineage detects swapped annexes and edited preserved lines", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const annex = await annexFor(digest, {
    lines: [bracketLine({ operand: "sourced", decimal: "50.00" })],
  });
  const v2 = await computeBuyCostCandidateV2({
    configuration,
    configurationDigest: digest,
    baseBundle: base,
    estimates: [annex],
    pricingContext: buyPricingContext(),
  });
  await assertBuyCostBundleV2Lineage(v2, {
    baseBundle: base,
    annexes: [annex],
    configuration,
  });
  const swapped = await annexFor(digest, {
    estimateId: "estimate.synthetic.swapped",
    lines: [bracketLine({ operand: "sourced", decimal: "50.00" })],
  });
  await assertRejects(
    () =>
      assertBuyCostBundleV2Lineage(v2, {
        baseBundle: base,
        annexes: [swapped],
        configuration,
      }),
    TypeError,
  );
  const edited = validateBuyCostBundleV2({
    ...JSON.parse(JSON.stringify(v2)),
    lines: v2.lines.map((line) => line.annexRef ? line : { ...line, amount: "6.00" }),
  });
  await assertRejects(
    () =>
      assertBuyCostBundleV2Lineage(edited, {
        baseBundle: base,
        annexes: [annex],
        configuration,
      }),
    TypeError,
    "does not match the base bundle",
  );
});

Deno.test("v2 lineage recrosses estimate-backed amounts, price, dimensions, gaps, and refs", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const annex = await annexFor(digest, {
    lines: [bracketLine({ operand: "sourced", decimal: "50.00" })],
  });
  const v2 = await computeBuyCostCandidateV2({
    configuration,
    configurationDigest: digest,
    baseBundle: base,
    estimates: [annex],
    pricingContext: buyPricingContext(),
  });
  const retained = { baseBundle: base, annexes: [annex], configuration };
  await assertBuyCostBundleV2Lineage(v2, retained);
  const tampered = (edit: (line: Record<string, unknown>) => void) =>
    validateBuyCostBundleV2({
      ...JSON.parse(JSON.stringify(v2)),
      lines: v2.lines.map((line) => {
        if (!line.annexRef) return line;
        const clone = JSON.parse(JSON.stringify(line));
        edit(clone);
        return clone;
      }),
    });
  for (
    const [name, edit] of [
      ["amount", (line: Record<string, unknown>) => {
        line["amount"] = "101.00";
      }],
      ["unitPrice", (line: Record<string, unknown>) => {
        line["unitPrice"] = "51.00";
      }],
      ["provisional", (line: Record<string, unknown>) => {
        line["provisional"] = !line["provisional"];
      }],
      ["dimensions", (line: Record<string, unknown>) => {
        line["dimensions"] = {
          ...(line["dimensions"] as Record<string, unknown>),
          tax: "established",
        };
      }],
      ["gaps", (line: Record<string, unknown>) => {
        line["gaps"] = [{
          code: "dimension-unknown",
          message: "forged gap",
          lineId: "line.bracket",
        }];
      }],
    ] as const
  ) {
    await assertRejects(
      () => assertBuyCostBundleV2Lineage(tampered(edit), retained),
      TypeError,
      "does not match its retained annex",
      `edited ${name} must be rejected`,
    );
  }
  const noRef = tampered((line) => {
    delete line["annexRef"];
  });
  await assertRejects(
    () => assertBuyCostBundleV2Lineage(noRef, retained),
    TypeError,
    "does not match the base bundle",
  );
  const badRef = validateBuyCostBundleV2({
    ...JSON.parse(JSON.stringify(v2)),
    configurationRef: { digest: "ff".repeat(32) },
  });
  await assertRejects(
    () => assertBuyCostBundleV2Lineage(badRef, retained),
    TypeError,
    "configuration",
  );
});

Deno.test("annex STEP basis must match the configuration at composition and lineage", async () => {
  const { configuration, digest, base } = await twoLineBase();
  const annex = await annexFor(digest, {
    lines: [bracketLine({ operand: "sourced", decimal: "50.00" })],
  });
  const forged = validateBuyProductionEstimateBundle({
    ...JSON.parse(JSON.stringify(annex)),
    estimateRef: {
      ...annex.estimateRef,
      stepFingerprint: "ee".repeat(32),
    },
  });
  await assertRejects(
    () =>
      computeBuyCostCandidateV2({
        configuration,
        configurationDigest: digest,
        baseBundle: base,
        estimates: [forged],
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "STEP fingerprint",
  );
  const v2 = await computeBuyCostCandidateV2({
    configuration,
    configurationDigest: digest,
    baseBundle: base,
    estimates: [annex],
    pricingContext: buyPricingContext(),
  });
  await assertRejects(
    () =>
      assertBuyCostBundleV2Lineage(v2, {
        baseBundle: base,
        annexes: [forged],
        configuration,
      }),
    TypeError,
    "STEP fingerprint",
  );
});
