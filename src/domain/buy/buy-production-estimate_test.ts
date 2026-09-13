import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { validateBuyConfiguration } from "./buy-configuration.ts";
import type { BuyDocumentaryEstimate } from "./buy-documentary-estimate.ts";
import { validateBuyDocumentaryEstimateEnvelope } from "./buy-documentary-estimate.ts";
import {
  assertBuyProductionEstimateLineage,
  computeBuyProductionEstimateCandidate,
  validateBuyProductionEstimateBundle,
} from "./buy-production-estimate.ts";
import {
  BUY_FIXTURE_AS_OF,
  buyConfigurationDigest,
  buyConfigurationFixture,
  buyDocumentaryEstimateEnvelopeFixture,
  buyDocumentaryEstimateFixture,
  buyEstimateSourceRef,
  buyPricingContext,
} from "./buy-fixtures.ts";

async function realDigest(): Promise<string> {
  return await buyConfigurationDigest(buyConfigurationFixture());
}

async function estimateEnvelope(estimate: BuyDocumentaryEstimate) {
  return await buyDocumentaryEstimateEnvelopeFixture(estimate);
}

async function annex(
  overrides: Partial<BuyDocumentaryEstimate> = {},
  configurationDigest?: string,
) {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const digest = configurationDigest ?? await realDigest();
  const envelope = await estimateEnvelope(
    buyDocumentaryEstimateFixture(digest, overrides),
  );
  return await computeBuyProductionEstimateCandidate({
    configuration,
    configurationDigest: digest,
    estimate: envelope,
    pricingContext: buyPricingContext(),
  });
}

Deno.test("sourced terms sum into an exact per-unit cost with retained refs", async () => {
  const bundle = await annex();
  const line = bundle.lines[0]!;
  // Independent: 2 x 10.50 = 21.00 material, 3 x 45.00 = 135.00 labour.
  assertEquals(line.terms[0]?.termAmount, "21.00");
  assertEquals(line.terms[1]?.termAmount, "135.00");
  assertEquals(line.unitCost, "156.00");
  assertEquals(line.quantityBasis, "per-configuration-unit");
  assertEquals(line.provisional, false);
  assertEquals(line.gaps, []);
  assertEquals(bundle.estimateRef.configurationDigest, await realDigest());
  validateBuyProductionEstimateBundle(bundle);
});

Deno.test("assumed operands price the line but stay provisional", async () => {
  const base = buyDocumentaryEstimateFixture(await realDigest());
  const bundle = await annex({
    lines: [{
      ...base.lines[0]!,
      terms: [{
        ...base.lines[0]!.terms[0]!,
        rate: {
          operand: "assumed",
          decimal: "10.50",
          perUom: "kg",
          currency: "EUR",
          justification: {
            statement: "Synthetic catalogue extrapolation.",
            source: buyEstimateSourceRef(),
          },
        },
      }],
    }],
  });
  const line = bundle.lines[0]!;
  assertEquals(line.unitCost, "21.00");
  assertEquals(line.provisional, true);
  assertEquals(line.terms[0]?.provisional, true);
  validateBuyProductionEstimateBundle(bundle);
});

Deno.test("unknown terms keep facts but leave no complete unit cost", async () => {
  const base = buyDocumentaryEstimateFixture(await realDigest());
  const bundle = await annex({
    lines: [{
      ...base.lines[0]!,
      terms: [
        base.lines[0]!.terms[0]!,
        {
          id: "energy.furnace",
          nature: "other",
          consumption: { operand: "unknown" },
          rate: {
            operand: "sourced",
            decimal: "0.30",
            perUom: "kWh",
            currency: "EUR",
            source: buyEstimateSourceRef(),
          },
        },
      ],
    }],
  });
  const line = bundle.lines[0]!;
  assertEquals(line.terms[0]?.termAmount, "21.00");
  assertEquals(line.terms[1]?.termAmount, undefined);
  assertEquals(line.unitCost, undefined);
  assertEquals(
    line.gaps.some((gap) => gap.code === "unpriced-component"),
    true,
  );
});

Deno.test("consumption/rate UOM mismatch is unresolved without conversion", async () => {
  const base = buyDocumentaryEstimateFixture(await realDigest());
  const mismatched = await annex({
    lines: [{
      ...base.lines[0]!,
      terms: [{
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
          perUom: "g",
          currency: "EUR",
          source: buyEstimateSourceRef(),
        },
      }],
    }],
  });
  assertEquals(
    mismatched.lines[0]?.terms[0]?.gaps.some(
      (gap) => gap.code === "uom-unresolved",
    ),
    true,
  );
  assertEquals(mismatched.lines[0]?.unitCost, undefined);
});

Deno.test("product UOM and currency mismatch block the line without invention", async () => {
  const uom = await annex({
    lines: [{
      ...buyDocumentaryEstimateFixture(await realDigest()).lines[0]!,
      productUom: "Kg",
    }],
  });
  assertEquals(
    uom.lines[0]?.gaps.some((gap) => gap.code === "uom-unresolved"),
    true,
  );
  assertEquals(uom.lines[0]?.unitCost, undefined);
  const usdBase = buyDocumentaryEstimateFixture(await realDigest());
  const fx = await annex({
    currency: "USD",
    lines: [{
      ...usdBase.lines[0]!,
      terms: [{
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
          currency: "USD",
          source: buyEstimateSourceRef(),
        },
      }],
    }],
  });
  assertEquals(
    fx.lines[0]?.gaps.some((gap) => gap.code === "currency-unresolved"),
    true,
  );
  assertEquals(fx.lines[0]?.unitCost, undefined);
});

Deno.test("mutating the configuration invalidates the supplied digest", async () => {
  const staleDigest = await realDigest();
  const mutated = validateBuyConfiguration(
    buyConfigurationFixture({
      lines: [{
        ...buyConfigurationFixture().lines[0]!,
        quantity: "5",
      }],
    }),
  );
  const envelope = await estimateEnvelope(
    buyDocumentaryEstimateFixture(staleDigest),
  );
  await assertRejects(
    () =>
      computeBuyProductionEstimateCandidate({
        configuration: mutated,
        configurationDigest: staleDigest,
        estimate: envelope,
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "not the SHA-256 of the validated configuration",
  );
});

Deno.test("estimate basis drift against the verified digest is a gap, not a price", async () => {
  const digest = await realDigest();
  const cases: Array<
    { readonly name: string; readonly overrides: Partial<BuyDocumentaryEstimate> }
  > = [
    {
      name: "digest",
      overrides: { configurationDigest: "2".repeat(64) },
    },
    {
      name: "step",
      overrides: {
        geometry: {
          ...buyDocumentaryEstimateFixture(digest).geometry,
          stepFingerprint: "3".repeat(64),
        },
      },
    },
    {
      name: "parent",
      overrides: {
        geometry: {
          ...buyDocumentaryEstimateFixture(digest).geometry,
          parentFingerprint: "4".repeat(64),
        },
      },
    },
    {
      name: "basis",
      overrides: {
        basis: {
          snapshotId: "snapshot.buy.r2",
          revision: 2,
          subjectId: "project:reviewed-project-v1",
        },
      },
    },
  ];
  for (const item of cases) {
    const bundle = await annex(item.overrides);
    assertEquals(
      bundle.lines[0]?.gaps.some((gap) => gap.code === "estimate-basis-mismatch"),
      true,
      item.name,
    );
    assertEquals(bundle.lines[0]?.unitCost, undefined, item.name);
  }
});

Deno.test("stale, mismatched, or early asOf keeps old validity and never invents", async () => {
  const expired = await annex({
    sourceValidity: { from: "2026-01-01", to: "2026-01-15" },
  });
  assertEquals(
    expired.lines[0]?.gaps.some((gap) => gap.code === "estimate-expired"),
    true,
  );
  assertEquals(expired.lines[0]?.unitCost, undefined);
  assertEquals(expired.sourceValidity.to, "2026-01-15");
  const mismatched = await annex({ asOf: "2026-04-01T00:00:00.000Z" });
  assertEquals(
    mismatched.lines[0]?.gaps.some(
      (gap) => gap.code === "estimate-as-of-ambiguous",
    ),
    true,
  );
  assertEquals(mismatched.lines[0]?.unitCost, undefined);
  const early = await annex({
    sourceValidity: { from: "2026-06-01", to: "2026-12-31" },
  });
  assertEquals(
    early.lines[0]?.gaps.some((gap) => gap.code === "estimate-as-of-ambiguous"),
    true,
  );
  assertEquals(early.lines[0]?.unitCost, "156.00");
  assertEquals(BUY_FIXTURE_AS_OF, "2026-03-01T00:00:00.000Z");
});

Deno.test("unknown configuration lines are refused, lineage recrosses retained bytes", async () => {
  const digest = await realDigest();
  const base = buyDocumentaryEstimateFixture(digest);
  const envelope = await estimateEnvelope({
    ...base,
    lines: [{ ...base.lines[0]!, configurationLineId: "line.unknown" }],
  });
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  await assertRejects(
    () =>
      computeBuyProductionEstimateCandidate({
        configuration,
        configurationDigest: digest,
        estimate: envelope,
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "unknown configuration line",
  );
  const good = await estimateEnvelope(buyDocumentaryEstimateFixture(digest));
  const context = {
    configuration,
    configurationDigest: digest,
    pricingContext: buyPricingContext(),
  };
  const bundle = await computeBuyProductionEstimateCandidate({
    ...context,
    estimate: good,
  });
  await assertBuyProductionEstimateLineage(bundle, good, context);
  const swapped = await estimateEnvelope(
    buyDocumentaryEstimateFixture(digest, { estimateId: "estimate.synthetic.swapped" }),
  );
  await assertRejects(
    () => assertBuyProductionEstimateLineage(bundle, swapped, context),
    TypeError,
  );
});

Deno.test("annex lineage recrosses the complete derived annex, not just line ids", async () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const digest = await realDigest();
  const good = await estimateEnvelope(buyDocumentaryEstimateFixture(digest));
  const context = {
    configuration,
    configurationDigest: digest,
    pricingContext: buyPricingContext(),
  };
  const bundle = await computeBuyProductionEstimateCandidate({
    ...context,
    estimate: good,
  });
  await assertBuyProductionEstimateLineage(bundle, good, context);
  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.lines[0].terms[0].termAmount = "22.00";
  tampered.lines[0].unitCost = "157.00";
  validateBuyProductionEstimateBundle(tampered);
  await assertRejects(
    () => assertBuyProductionEstimateLineage(tampered, good, context),
    TypeError,
    "does not match the annex recomputed",
  );
  const otherContext = {
    ...context,
    pricingContext: { ...buyPricingContext(), asOf: "2026-04-01T00:00:00.000Z" },
  };
  await assertRejects(
    () => assertBuyProductionEstimateLineage(bundle, good, otherContext),
    TypeError,
    "does not match the annex recomputed",
  );
});

Deno.test("calculator refuses an envelope fingerprint unrelated to the estimate bytes", async () => {
  const digest = await realDigest();
  const good = await estimateEnvelope(buyDocumentaryEstimateFixture(digest));
  const forged = {
    ...JSON.parse(JSON.stringify(good)),
    capture: {
      ...good.capture,
      uri: `casys://agent-resource-capture/sha256/${"ff".repeat(32)}`,
      fingerprint: { algorithm: "sha256", digest: "ff".repeat(32) },
    },
    fingerprint: `sha256:${"ff".repeat(32)}`,
  };
  validateBuyDocumentaryEstimateEnvelope(forged);
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  await assertRejects(
    () =>
      computeBuyProductionEstimateCandidate({
        configuration,
        configurationDigest: digest,
        estimate: forged,
        pricingContext: buyPricingContext(),
      }),
    TypeError,
    "does not match SHA-256 of canonicalText",
  );
});

Deno.test("annex parser refuses empty terms and invented unit costs", async () => {
  const bundle = await annex();
  const empty = JSON.parse(JSON.stringify(bundle));
  empty.lines[0].terms = [];
  empty.lines[0].unitCost = undefined;
  assertThrows(
    () => validateBuyProductionEstimateBundle(empty),
    TypeError,
    "at least one term",
  );
  const base = buyDocumentaryEstimateFixture(await realDigest());
  const unknown = await annex({
    lines: [{
      ...base.lines[0]!,
      terms: [
        base.lines[0]!.terms[0]!,
        {
          id: "energy.furnace",
          nature: "other",
          consumption: { operand: "unknown" },
          rate: {
            operand: "sourced",
            decimal: "0.30",
            perUom: "kWh",
            currency: "EUR",
            source: buyEstimateSourceRef(),
          },
        },
      ],
    }],
  });
  assertEquals(unknown.lines[0]?.unitCost, undefined);
  const invented = JSON.parse(JSON.stringify(unknown));
  invented.lines[0].unitCost = "1.00";
  assertThrows(
    () => validateBuyProductionEstimateBundle(invented),
    TypeError,
    "no complete unit cost",
  );
  const wrongSum = JSON.parse(JSON.stringify(bundle));
  wrongSum.lines[0].unitCost = "999.99";
  assertThrows(
    () => validateBuyProductionEstimateBundle(wrongSum),
    TypeError,
    "sum of priced term amounts",
  );
});

Deno.test("rejected paths keep provisional origin from assumed operands", async () => {
  const base = buyDocumentaryEstimateFixture(await realDigest());
  const expired = await annex({
    sourceValidity: { from: "2026-01-01", to: "2026-01-15" },
    lines: [{
      ...base.lines[0]!,
      terms: [{
        ...base.lines[0]!.terms[0]!,
        rate: {
          operand: "assumed",
          decimal: "10.50",
          perUom: "kg",
          currency: "EUR",
          justification: {
            statement: "Synthetic catalogue extrapolation.",
            source: buyEstimateSourceRef(),
          },
        },
      }],
    }],
  });
  const line = expired.lines[0]!;
  assertEquals(line.unitCost, undefined);
  assertEquals(
    line.gaps.some((gap) => gap.code === "estimate-expired"),
    true,
  );
  assertEquals(line.terms[0]?.provisional, true);
  assertEquals(line.provisional, true);
  validateBuyProductionEstimateBundle(expired);
});
