import { assertEquals, assertThrows } from "@std/assert";
import {
  BuyProposalError,
  encodeBuyCaptureDecisionParameters,
  encodeBuySealDecisionParameters,
  parseBuyCaptureDecisionParameters,
  parseBuySealDecisionParameters,
} from "./buy-proposal.ts";
import { BUY_DECIMAL_SCHEMA } from "./buy-decimal.ts";
import { BUY_DOCUMENTARY_ESTIMATE_SCHEMA } from "./buy-documentary-estimate.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_RESOURCE,
  BUY_FIXTURE_SITE,
  BUY_FIXTURE_STEP,
  buyConfigurationFixture,
  buyPricingContext,
} from "./buy-fixtures.ts";

Deno.test("capture decision parameters round-trip", () => {
  const configuration = buyConfigurationFixture();
  const encoded = encodeBuyCaptureDecisionParameters({
    configurationDigest: "1".repeat(64),
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: configuration.projectId,
    subjectId: configuration.subjectId,
    configurationRevision: configuration.configurationRevision,
    basisSnapshotId: configuration.basis.snapshotId,
    basisRevision: configuration.basis.revision,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "IP-BRACKET-001" }],
    pricing: buyPricingContext(),
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: "erpnext_buy_capture",
  });
  const parsed = parseBuyCaptureDecisionParameters(encoded);
  assertEquals(parsed.geometry.stepFingerprint, BUY_FIXTURE_STEP);
  assertEquals(parsed.geometry.parentFingerprint, BUY_FIXTURE_PARENT);
  assertEquals(parsed.documents[0]?.name, "IP-BRACKET-001");
  assertEquals(parsed.providerTool, "erpnext_buy_capture");
});

Deno.test("capture rounding scale accepts the domain 0..12 range before dispatch", () => {
  const configuration = buyConfigurationFixture();
  const encodedZero = encodeBuyCaptureDecisionParameters({
    configurationDigest: "1".repeat(64),
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: configuration.projectId,
    subjectId: configuration.subjectId,
    configurationRevision: configuration.configurationRevision,
    basisSnapshotId: configuration.basis.snapshotId,
    basisRevision: configuration.basis.revision,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "IP-BRACKET-001" }],
    pricing: {
      ...buyPricingContext(),
      rounding: { schemaVersion: BUY_DECIMAL_SCHEMA, scale: 0, mode: "half-up" },
    },
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: "erpnext_buy_capture",
  });
  assertEquals(
    parseBuyCaptureDecisionParameters(encodedZero).pricing.rounding.scale,
    0,
  );

  const encodedTwelve = encodeBuyCaptureDecisionParameters({
    configurationDigest: "1".repeat(64),
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: configuration.projectId,
    subjectId: configuration.subjectId,
    configurationRevision: configuration.configurationRevision,
    basisSnapshotId: configuration.basis.snapshotId,
    basisRevision: configuration.basis.revision,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "IP-BRACKET-001" }],
    pricing: {
      ...buyPricingContext(),
      rounding: { schemaVersion: BUY_DECIMAL_SCHEMA, scale: 12, mode: "half-up" },
    },
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: "erpnext_buy_capture",
  });
  assertEquals(
    parseBuyCaptureDecisionParameters(encodedTwelve).pricing.rounding.scale,
    12,
  );

  const encodedThirteen = encodeBuyCaptureDecisionParameters({
    configurationDigest: "1".repeat(64),
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: configuration.projectId,
    subjectId: configuration.subjectId,
    configurationRevision: configuration.configurationRevision,
    basisSnapshotId: configuration.basis.snapshotId,
    basisRevision: configuration.basis.revision,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "IP-BRACKET-001" }],
    pricing: {
      ...buyPricingContext(),
      rounding: { schemaVersion: BUY_DECIMAL_SCHEMA, scale: 13, mode: "half-up" },
    },
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: "erpnext_buy_capture",
  });
  assertThrows(
    () => parseBuyCaptureDecisionParameters(encodedThirteen),
    BuyProposalError,
    "0..12",
  );
});

Deno.test("capture decision parameters round-trip an optional estimate source", () => {
  const configuration = buyConfigurationFixture();
  const base = {
    configurationDigest: "1".repeat(64),
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: configuration.projectId,
    subjectId: configuration.subjectId,
    configurationRevision: configuration.configurationRevision,
    basisSnapshotId: configuration.basis.snapshotId,
    basisRevision: configuration.basis.revision,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "IP-BRACKET-001" }],
    pricing: buyPricingContext(),
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: "erpnext_buy_capture",
  } as const;
  const bare = parseBuyCaptureDecisionParameters(
    encodeBuyCaptureDecisionParameters(base),
  );
  assertEquals(bare.estimate, undefined);

  const estimate = {
    resourceUri: `casys://agent-resource-capture/sha256/${"5".repeat(64)}`,
    resourceDigest: "5".repeat(64),
    schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
  } as const;
  const parsed = parseBuyCaptureDecisionParameters(
    encodeBuyCaptureDecisionParameters({ ...base, estimate }),
  );
  assertEquals(parsed.estimate, estimate);
});

Deno.test("a partial estimate trio is refused", () => {
  const configuration = buyConfigurationFixture();
  const encoded = encodeBuyCaptureDecisionParameters({
    configurationDigest: "1".repeat(64),
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    estimate: {
      resourceUri: `casys://agent-resource-capture/sha256/${"5".repeat(64)}`,
      resourceDigest: "5".repeat(64),
      schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    },
    schemaVersion: configuration.schemaVersion,
    projectId: configuration.projectId,
    subjectId: configuration.subjectId,
    configurationRevision: configuration.configurationRevision,
    basisSnapshotId: configuration.basis.snapshotId,
    basisRevision: configuration.basis.revision,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "IP-BRACKET-001" }],
    pricing: buyPricingContext(),
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: "erpnext_buy_capture",
  });
  assertThrows(
    () =>
      parseBuyCaptureDecisionParameters(
        encoded.filter((item) => item.key !== "buy.capture.estimate.resource.digest"),
      ),
    BuyProposalError,
    "buy.capture.estimate.resource.digest",
  );
});

Deno.test("seal decision parameters round-trip", () => {
  const encoded = encodeBuySealDecisionParameters({
    candidateDigest: "2".repeat(64),
    bundleDigest: "3".repeat(64),
    configurationDigest: "1".repeat(64),
    stepFingerprint: BUY_FIXTURE_STEP,
    coverageStatus: "partial",
    sourceCaptureCount: 1,
    sourceCaptureDigests: ["4".repeat(64)],
  });
  const parsed = parseBuySealDecisionParameters(encoded);
  assertEquals(parsed.coverageStatus, "partial");
  assertEquals(parsed.sourceCaptureDigests[0], "4".repeat(64));
});
