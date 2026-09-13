import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Hex } from "../kernel/deterministic-json.ts";
import { validateBuyConfiguration } from "./buy-configuration.ts";
import {
  assertBuyDocumentaryEstimateFingerprint,
  type BuyDocumentaryEstimate,
  validateBuyDocumentaryEstimate,
  validateBuyDocumentaryEstimateEnvelope,
} from "./buy-documentary-estimate.ts";
import {
  BUY_FIXTURE_AS_OF,
  buyConfigurationDigest,
  buyConfigurationFixture,
  buyDocumentaryEstimateEnvelopeFixture,
  buyDocumentaryEstimateFixture,
  buyEstimateSourceRef,
  buySyntheticEvidenceReference,
} from "./buy-fixtures.ts";

async function validEstimate(
  overrides: Partial<BuyDocumentaryEstimate> = {},
): Promise<BuyDocumentaryEstimate> {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  return validateBuyDocumentaryEstimate(
    buyDocumentaryEstimateFixture(digest, overrides),
  );
}

Deno.test("valid documentary estimate envelope verifies its SHA-256 preimage", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const envelope = await buyDocumentaryEstimateEnvelopeFixture(
    buyDocumentaryEstimateFixture(digest),
  );
  await assertBuyDocumentaryEstimateFingerprint(envelope, sha256Hex);
  assertEquals(envelope.estimate.asOf, BUY_FIXTURE_AS_OF);
  assertEquals(
    envelope.capture.uri,
    `casys://agent-resource-capture/sha256/${
      envelope.fingerprint.slice("sha256:".length)
    }`,
  );
});

Deno.test("authored payload cannot smuggle its own capture locator", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate({
        ...buyDocumentaryEstimateFixture(digest),
        resourceUri: "casys://agent-resource-capture/sha256/" + "e".repeat(64),
      }),
    TypeError,
    "unsupported field",
  );
});

Deno.test("imaginary, prosaic, noncanonical, or reversed dates are refused", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const cases: Array<{ readonly name: string; readonly build: () => unknown }> = [
    {
      name: "feb30",
      build: () =>
        buyDocumentaryEstimateFixture(digest, {
          sourceValidity: { from: "2026-01-01", to: "2026-02-30" },
        }),
    },
    {
      name: "prose",
      build: () =>
        buyDocumentaryEstimateFixture(digest, {
          sourceValidity: { from: "tomorrow", to: "2026-12-31" },
        }),
    },
    {
      name: "noncanonical-date",
      build: () =>
        buyDocumentaryEstimateFixture(digest, {
          sourceValidity: { from: "2026-1-1", to: "2026-12-31" },
        }),
    },
    {
      name: "reversed-range",
      build: () =>
        buyDocumentaryEstimateFixture(digest, {
          sourceValidity: { from: "2026-12-31", to: "2026-01-01" },
        }),
    },
    {
      name: "noncanonical-timestamp",
      build: () =>
        buyDocumentaryEstimateFixture(digest, { asOf: "2026-03-01 00:00:00" }),
    },
    {
      name: "timestamp-without-millis",
      build: () =>
        buyDocumentaryEstimateFixture(digest, { asOf: "2026-03-01T00:00:00Z" }),
    },
    {
      name: "rolled-over-timestamp",
      build: () =>
        buyDocumentaryEstimateFixture(digest, {
          asOf: "2026-02-30T00:00:00.000Z",
        }),
    },
    {
      name: "month-13",
      build: () =>
        buyDocumentaryEstimateFixture(digest, {
          sourceValidity: { from: "2026-13-01", to: "2026-12-31" },
        }),
    },
  ];
  for (const item of cases) {
    assertThrows(
      () => validateBuyDocumentaryEstimate(item.build()),
      TypeError,
      undefined,
      item.name,
    );
  }
  await validEstimate();
});

Deno.test("foreign evidence URLs and locator digest mismatch are refused", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const withReference = (
    reference: ReturnType<typeof buySyntheticEvidenceReference>,
  ) =>
    buyDocumentaryEstimateFixture(digest, {
      lines: [{
        configurationLineId: "line.fastener",
        quantityBasis: "per-configuration-unit",
        productUom: "Nos",
        terms: [{
          id: "material.bar",
          nature: "material",
          consumption: {
            operand: "sourced",
            decimal: "2",
            uom: "kg",
            source: {
              reference,
              anchor: "synthetic page 2, line 7",
              observedAt: "2026-02-10T09:00:00.000Z",
            },
          },
          rate: {
            operand: "sourced",
            decimal: "10.50",
            perUom: "kg",
            currency: "EUR",
            source: buyEstimateSourceRef(),
          },
        }],
      }],
    });
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate(
        withReference({
          ...buySyntheticEvidenceReference(),
          uri: "https://vendor.example/sheet.pdf",
        }),
      ),
    TypeError,
    "must be casys://agent-resource-capture/sha256/<digest>",
  );
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate(
        withReference({
          ...buySyntheticEvidenceReference(),
          uri: `casys://agent-resource-capture/sha256/${"d".repeat(64)}`,
        }),
      ),
    TypeError,
    "uri digest does not match fingerprint.digest",
  );
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate(
        withReference({
          ...buySyntheticEvidenceReference(),
          uri: "thread-artifact://reviewed-project-v1/some-doc",
        }),
      ),
    TypeError,
    "must be casys://agent-resource-capture/sha256/<digest>",
  );
});

Deno.test("duplicate lines and terms are refused", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const base = buyDocumentaryEstimateFixture(digest);
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate({
        ...base,
        lines: [base.lines[0], base.lines[0]],
      }),
    TypeError,
    "must not contain duplicates",
  );
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate({
        ...base,
        lines: [{
          ...base.lines[0]!,
          terms: [base.lines[0]!.terms[0], base.lines[0]!.terms[0]],
        }],
      }),
    TypeError,
    "must not contain duplicates",
  );
});

Deno.test("unknown operands cannot smuggle a decimal and rates keep estimate currency", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const base = buyDocumentaryEstimateFixture(digest);
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate({
        ...base,
        lines: [{
          ...base.lines[0]!,
          terms: [{
            id: "material.bar",
            nature: "material",
            consumption: { operand: "unknown", decimal: "2" },
            rate: base.lines[0]!.terms[0]!.rate,
          }],
        }],
      }),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () =>
      validateBuyDocumentaryEstimate({
        ...base,
        lines: [{
          ...base.lines[0]!,
          terms: [{
            ...base.lines[0]!.terms[0]!,
            rate: {
              operand: "sourced",
              decimal: "10.50",
              perUom: "kg",
              currency: "USD",
              source: buyEstimateSourceRef(),
            },
          }],
        }],
      }),
    TypeError,
    "must equal the estimate currency",
  );
});

Deno.test("closed parser bounds counts and text length", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const base = buyDocumentaryEstimateFixture(digest);
  const manyLines = Array.from({ length: 513 }, (_, i) => ({
    ...base.lines[0]!,
    configurationLineId: `line.synthetic.${i}`,
  }));
  assertThrows(
    () => validateBuyDocumentaryEstimate({ ...base, lines: manyLines }),
    TypeError,
    "at most 512 entries",
  );
  assertThrows(
    () => validateBuyDocumentaryEstimate({ ...base, assumptions: ["x".repeat(2001)] }),
    TypeError,
    "at most 2000 characters",
  );
  assertThrows(
    () => validateBuyDocumentaryEstimate({ ...base, inventedField: true }),
    TypeError,
    "unsupported field",
  );
});

Deno.test("tampered or non-canonical estimate bytes fail closed on reopen", async () => {
  const digest = await buyConfigurationDigest(buyConfigurationFixture());
  const estimate = buyDocumentaryEstimateFixture(digest);
  const envelope = await buyDocumentaryEstimateEnvelopeFixture(estimate);
  assertThrows(
    () =>
      validateBuyDocumentaryEstimateEnvelope({
        ...envelope,
        estimate: { ...estimate, estimateId: "estimate.synthetic.tampered" },
      }),
    TypeError,
    "does not match the estimate payload",
  );
  assertThrows(
    () =>
      validateBuyDocumentaryEstimateEnvelope({
        ...envelope,
        byteCount: envelope.byteCount + 1,
      }),
    TypeError,
    "byteCount mismatch",
  );
  const pretty = JSON.stringify(JSON.parse(envelope.canonicalText), null, 2);
  assertEquals(pretty === envelope.canonicalText, false);
  const prettyBytes = new TextEncoder().encode(pretty);
  const prettyDigest = await sha256Hex(prettyBytes);
  assertThrows(
    () =>
      validateBuyDocumentaryEstimateEnvelope({
        ...envelope,
        capture: {
          ...envelope.capture,
          uri: `casys://agent-resource-capture/sha256/${prettyDigest}`,
          byteCount: prettyBytes.byteLength,
          fingerprint: { algorithm: "sha256", digest: prettyDigest },
        },
        canonicalText: pretty,
        fingerprint: `sha256:${prettyDigest}`,
        byteCount: prettyBytes.byteLength,
      }),
    TypeError,
    "not the exact canonical bytes",
  );
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  assertEquals(configuration.lines[0]?.quantity, "4");
  await assertRejects(
    () =>
      assertBuyDocumentaryEstimateFingerprint(
        {
          ...envelope,
          fingerprint: `sha256:${"f".repeat(64)}`,
        },
        sha256Hex,
      ),
    TypeError,
    "does not match SHA-256",
  );
});
