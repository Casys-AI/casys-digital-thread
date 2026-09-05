import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import {
  createBuild123dExecutionServerOptionsForBoundCandidateImport,
  createLocalBuild123dExecutionServerOptions,
  LOCAL_BUILD123D_EXECUTION_LIMITS,
} from "./first-party-build123d-execution.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("active Build123d policy builder stays digest-pinned and shared", async () => {
  const first = await createLocalBuild123dExecutionServerOptions();
  const second = await createLocalBuild123dExecutionServerOptions();
  assertEquals(first, second);
  assertEquals(first.profile.imageReference, LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE);
  assertEquals(first.profile.policy.id, "build123d-microsandbox-deny-all-v1");
  assertEquals(first.profile.limits, LOCAL_BUILD123D_EXECUTION_LIMITS);
  assertEquals(first.runtime, {});
});

Deno.test("Build123d candidate options bind the import-record candidate reference", async () => {
  const { build123d, geometry } = await records();
  const options = await createBuild123dExecutionServerOptionsForBoundCandidateImport(
    build123d,
  );
  assertEquals(
    options.profile.imageReference,
    build123d.candidate.microsandbox.candidateReference,
  );
  assertEquals(options.profile.limits, LOCAL_BUILD123D_EXECUTION_LIMITS);
  assertEquals(options.runtime, {});
  assertEquals(
    options.profile.imageReference === LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
    false,
  );
  await assertRejects(
    () => createBuild123dExecutionServerOptionsForBoundCandidateImport(geometry),
    TypeError,
    "physicalImageId=build123d-isolated-worker",
  );
});

Deno.test("Build123d policy module does not expose a raw image-selector API", async () => {
  const source = await Deno.readTextFile(
    new URL("./first-party-build123d-execution.ts", import.meta.url),
  );
  assertEquals(
    source.includes(
      "export async function createBuild123dExecutionServerOptionsForImage",
    ),
    false,
  );
  assertEquals(
    source.includes("createBuild123dExecutionServerOptionsForBoundCandidateImport"),
    true,
  );
});

async function records() {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const matrixFingerprint =
    await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      matrix,
    );
  async function one(physicalImageId: string) {
    const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint,
      physicalImageId,
      ociIndexDigest: OCI_INDEX_DIGEST,
      platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
      locatorTag: `git-${GIT_SHA}-run-1-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    });
    return await buildFirstPartyMicrosandboxImageCandidateImportRecord({
      receipt,
      microsandboxManifestDigest: MICROSANDBOX_DIGEST,
      status: "imported",
    });
  }
  return {
    build123d: await one("build123d-isolated-worker"),
    geometry: await one("geometry-module-assembler-worker"),
  };
}
