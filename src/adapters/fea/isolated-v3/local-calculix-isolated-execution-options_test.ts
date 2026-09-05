import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import {
  calculixIsolatedExecutionPolicyBody,
  createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport,
  createLocalCalculixIsolatedExecutionServerOptions,
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
  LOCAL_CALCULIX_EXECUTION_LIMITS,
  LOCAL_CALCULIX_WRAPPER_SHA256,
} from "./local-calculix-isolated-execution-options.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("active CalculiX policy builder stays digest-pinned and shared", async () => {
  const first = await createLocalCalculixIsolatedExecutionServerOptions();
  const second = await createLocalCalculixIsolatedExecutionServerOptions();
  assertEquals(first, second);
  assertEquals(first.profile.imageReference, LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE);
  assertEquals(first.profile.wrapperSha256, LOCAL_CALCULIX_WRAPPER_SHA256);
  assertEquals(first.profile.policy.id, "calculix-microsandbox-deny-all-v1");
  assertEquals(first.profile.limits, LOCAL_CALCULIX_EXECUTION_LIMITS);
  assertEquals(first.runtime, {});
});

Deno.test("CalculiX candidate options bind the import-record candidate reference", async () => {
  const { calculix, build123d } = await records();
  const active = await createLocalCalculixIsolatedExecutionServerOptions();
  const options =
    await createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport(
      calculix,
    );
  assertEquals(
    options.profile.imageReference,
    calculix.candidate.microsandbox.candidateReference,
  );
  assertEquals(options.profile.wrapperSha256, LOCAL_CALCULIX_WRAPPER_SHA256);
  assertEquals(options.profile.limits, LOCAL_CALCULIX_EXECUTION_LIMITS);
  assertEquals(options.runtime, {});
  assertEquals(
    options.profile.imageReference === LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
    false,
  );
  assertEquals(
    options.profile.policy.fingerprint.digest ===
      active.profile.policy.fingerprint.digest,
    false,
  );
  assertEquals(
    calculixIsolatedExecutionPolicyBody(options.profile.imageReference)
      .imageReference,
    calculix.candidate.microsandbox.candidateReference,
  );
  await assertRejects(
    () =>
      createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport(build123d),
    TypeError,
    "physicalImageId=calculix-worker",
  );
});

Deno.test("CalculiX policy module does not expose a raw image-selector API", async () => {
  const source = await Deno.readTextFile(
    new URL("./local-calculix-isolated-execution-options.ts", import.meta.url),
  );
  assertEquals(
    source.includes(
      "export async function createCalculixIsolatedExecutionServerOptionsForImage",
    ),
    false,
  );
  assertEquals(
    source.includes(
      "createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport",
    ),
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
    calculix: await one("calculix-worker"),
    build123d: await one("build123d-isolated-worker"),
  };
}
