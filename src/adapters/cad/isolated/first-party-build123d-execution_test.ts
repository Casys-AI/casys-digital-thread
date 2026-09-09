import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { BUILD123D_EXECUTION_PROFILE } from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import {
  build123dExecutionPolicyBody,
  createBuild123dExecutionServerOptionsForBoundCandidateImport,
  createLocalBuild123dExecutionServerOptions,
  LOCAL_BUILD123D_EXECUTION_LIMITS,
} from "./first-party-build123d-execution.ts";
import { FixedBuild123dExecutionProfileCatalog } from "./fixed-build123d-execution-profile-catalog.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const PREVIOUS_BUILD123D_IMAGE_REFERENCE =
  "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8";

Deno.test("active Build123d policy builder stays digest-pinned and shared", async () => {
  const first = await createLocalBuild123dExecutionServerOptions();
  const second = await createLocalBuild123dExecutionServerOptions();
  assertEquals(first, second);
  assertEquals(first.profile.imageReference, LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE);
  assertEquals(
    first.profile.imageReference,
    "casys/build123d-microsandbox-worker@sha256:6484a43b3632972de349ba5aa55f3da7316fb5bd7ad957b7c22aaf7888fad159",
  );
  assertEquals(first.profile.policy.id, "build123d-microsandbox-deny-all-v1");
  assertEquals(first.profile.limits, LOCAL_BUILD123D_EXECUTION_LIMITS);
  assertEquals(first.runtime, {});
});

Deno.test("Build123d pin adoption preserves the semantic profile version and invalidates deployment fingerprints", async () => {
  const currentOptions = await createLocalBuild123dExecutionServerOptions();
  const previousPolicy = Object.freeze({
    ...currentOptions.profile.policy,
    fingerprint: await sha256Fingerprint(
      build123dExecutionPolicyBody(PREVIOUS_BUILD123D_IMAGE_REFERENCE),
    ),
  });
  const current = await new FixedBuild123dExecutionProfileCatalog(
    currentOptions.profile,
  ).initial();
  const previous = await new FixedBuild123dExecutionProfileCatalog({
    imageReference: PREVIOUS_BUILD123D_IMAGE_REFERENCE,
    policy: previousPolicy,
    limits: currentOptions.profile.limits,
  }).initial();

  assertEquals(current.executionProfile, BUILD123D_EXECUTION_PROFILE);
  assertEquals(previous.executionProfile, BUILD123D_EXECUTION_PROFILE);
  assertEquals(current.executionProfile.version, "1.0.0");
  assertNotEquals(
    current.isolationPolicy.fingerprint,
    previous.isolationPolicy.fingerprint,
  );
  assertNotEquals(current.profileFingerprint, previous.profileFingerprint);
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
