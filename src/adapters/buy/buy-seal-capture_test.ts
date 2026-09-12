import { assertEquals, assertRejects } from "@std/assert";
import { validateBuyConfiguration } from "../../domain/buy/buy-configuration.ts";
import { computeBuyCostCandidate } from "../../domain/buy/buy-cost-bundle.ts";
import { selectBuyCostLines } from "../../domain/buy/buy-cost-selection.ts";
import {
  BUY_FIXTURE_SITE,
  buyConfigurationFixture,
  buyPricingContext,
} from "../../domain/buy/buy-fixtures.ts";
import { BUY_SEAL_CONFIGURATION_COST_OPERATION } from "../../domain/buy/buy-operations.ts";
import { validateBuySourceCaptureEnvelope } from "../../domain/buy/buy-source-capture.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { BUY_SEAL_CAPTURE_SCHEMA, validateBuySealCapture } from "./buy-seal-capture.ts";

const AT = "2026-08-15T00:00:00.000Z";

Deno.test("validateBuySealCapture accepts matching configuration and bundle digests", async () => {
  const capture = await validSealCapture();
  const validated = await validateBuySealCapture(capture);
  assertEquals(validated.configurationDigest, capture.configurationDigest);
  assertEquals(
    validated.bundle.configurationRef.digest,
    capture.configurationDigest,
  );
});

Deno.test(
  "validateBuySealCapture refuses a configurationDigest that does not rehash",
  async () => {
    const capture = await validSealCapture();
    await assertRejects(
      () =>
        validateBuySealCapture({
          ...capture,
          configurationDigest: "0".repeat(64),
        }),
      TypeError,
      "configurationDigest",
    );
  },
);

Deno.test(
  "validateBuySealCapture refuses a bundle configurationRef that does not match the configuration",
  async () => {
    const capture = await validSealCapture();
    const forgedBundle = {
      ...capture.bundle,
      configurationRef: { digest: "0".repeat(64) },
    };
    const bundleDigest = (await sha256Fingerprint(forgedBundle)).digest;
    await assertRejects(
      () =>
        validateBuySealCapture({
          ...capture,
          bundle: forgedBundle,
          bundleDigest,
        }),
      TypeError,
      "configurationRef",
    );
  },
);

async function validSealCapture() {
  const wrapperText = await Deno.readTextFile(
    new URL("./fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  const envelope = validateBuySourceCaptureEnvelope(
    JSON.parse(wrapperText.endsWith("\n") ? wrapperText.slice(0, -1) : wrapperText),
  );
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const configurationDigest = (await sha256Fingerprint(configuration)).digest;
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest,
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: selectBuyCostLines(configuration, [envelope]),
  });
  const bundleDigest = (await sha256Fingerprint(bundle)).digest;
  return {
    schemaVersion: BUY_SEAL_CAPTURE_SCHEMA,
    kind: "buy.configuration-cost-sealed" as const,
    operation: BUY_SEAL_CONFIGURATION_COST_OPERATION,
    trustedRunId: "run.buy-seal",
    decisionId: "decision.buy-seal",
    candidateDigest: "2".repeat(64),
    bundleDigest,
    configurationDigest,
    configuration,
    bundle,
    sourceCaptures: [envelope],
    coverageStatus: bundle.coverage.status,
    reviewStatus: bundle.coverage.status === "complete"
      ? "complete" as const
      : bundle.coverage.status === "partial"
      ? "partial" as const
      : "documentary" as const,
    sealedAt: AT,
  };
}
