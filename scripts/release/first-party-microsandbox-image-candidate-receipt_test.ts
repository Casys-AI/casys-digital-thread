import { assertEquals, assertThrows } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyMicrosandboxImageDistributionMatrix } from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateReceipt,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  renderFirstPartyMicrosandboxImageCandidateReceiptText,
} from "./first-party-microsandbox-image-candidate-receipt.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"d".repeat(64)}`;
const MATRIX_FINGERPRINT = `sha256:${"c".repeat(64)}`;

Deno.test("candidate receipt preserves exact build facts while keeping promotion unresolved", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: MATRIX_FINGERPRINT,
    physicalImageId: "modelica-microsandbox-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-42-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: {
      "containerimage.digest": OCI_INDEX_DIGEST,
      nested: { platform: "linux/arm64" },
    },
  });

  assertEquals(
    receipt.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  );
  assertEquals(
    receipt.candidate.oci.indexReference,
    "ghcr.io/casys-ai/casys-digital-thread-modelica-microsandbox-worker@" +
      OCI_INDEX_DIGEST,
  );
  assertEquals(
    receipt.candidate.oci.platformManifestReference,
    "ghcr.io/casys-ai/casys-digital-thread-modelica-microsandbox-worker@" +
      PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(
    receipt.candidate.locatorReference,
    "ghcr.io/casys-ai/casys-digital-thread-modelica-microsandbox-worker:" +
      `git-${GIT_SHA}-run-42-1`,
  );
  assertEquals(receipt.candidate.logicalTargets.length, 2);
  assertEquals(receipt.inputMatrix.images.length, 5);
  assertEquals(receipt.inputMatrix.contract.logicalTargetCount, 6);
  assertEquals(receipt.artifactCompliance, {
    licence: "unresolved",
    anonymousPull: "not-run",
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    sbom: "requested",
    provenance: "requested",
  });
  const text = renderFirstPartyMicrosandboxImageCandidateReceiptText(receipt);
  assertEquals(
    text.includes(`oci.indexReference=${receipt.candidate.oci.indexReference}`),
    true,
  );
  assertEquals(text.includes("eligibleForPromotion=false"), true);
  assertEquals(text.includes("licence=unresolved"), true);
});

Deno.test("candidate receipt rejects incomplete matrix and mutable locator facts", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const input = {
    matrix,
    matrixFingerprint: MATRIX_FINGERPRINT,
    physicalImageId: "ngspice-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-42-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: {},
  };
  assertThrows(
    () =>
      buildFirstPartyMicrosandboxImageCandidateReceipt({
        ...input,
        matrix: { ...matrix, images: matrix.images.slice(1) },
      }),
    TypeError,
    "exactly 5 physical images",
  );
  assertThrows(
    () =>
      buildFirstPartyMicrosandboxImageCandidateReceipt({
        ...input,
        locatorTag: "latest",
      }),
    TypeError,
    "locator tag",
  );
  assertThrows(
    () =>
      buildFirstPartyMicrosandboxImageCandidateReceipt({
        ...input,
        buildMetadata: { "containerimage.digest": PLATFORM_MANIFEST_DIGEST },
      }),
    TypeError,
    "containerimage.digest must exactly match",
  );
});
