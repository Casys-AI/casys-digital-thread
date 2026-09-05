import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./local-image-references.ts";
import {
  admittedSpiceExecutionPolicyBody,
  createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport,
  createLocalAdmittedSpiceExecutionServerOptions,
  LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS,
} from "./first-party-spice-execution.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("active admitted SPICE policy builder stays digest-pinned and shared", async () => {
  const first = await createLocalAdmittedSpiceExecutionServerOptions();
  const second = await createLocalAdmittedSpiceExecutionServerOptions();
  assertEquals(first, second);
  assertEquals(
    first.profile.imageReference,
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  );
  assertEquals(first.profile.policy.id, "spice-admitted-microsandbox-deny-all-v1");
  assertEquals(first.profile.policy.version, "1.0.0");
  assertEquals(first.profile.limits, LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS);
  assertEquals(first.runtime, {});
  assertEquals(
    admittedSpiceExecutionPolicyBody(first.profile.imageReference).imageReference,
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  );
});

Deno.test("admitted SPICE candidate options bind the import-record candidate reference", async () => {
  const { ngspice, modelica } = await records();
  const active = await createLocalAdmittedSpiceExecutionServerOptions();
  const options =
    await createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport(
      ngspice,
    );
  assertEquals(
    options.profile.imageReference,
    ngspice.candidate.microsandbox.candidateReference,
  );
  assertEquals(options.profile.limits, LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS);
  assertEquals(options.runtime, {});
  assertEquals(
    options.profile.imageReference === LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    false,
  );
  assertEquals(
    options.profile.policy.fingerprint.digest ===
      active.profile.policy.fingerprint.digest,
    false,
  );
  assertEquals(
    admittedSpiceExecutionPolicyBody(options.profile.imageReference).imageReference,
    ngspice.candidate.microsandbox.candidateReference,
  );
  await assertRejects(
    () => createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport(modelica),
    TypeError,
    "physicalImageId=ngspice-worker",
  );
});

Deno.test("admitted SPICE policy module does not expose a raw image-selector API", async () => {
  const source = await Deno.readTextFile(
    new URL("./first-party-spice-execution.ts", import.meta.url),
  );
  assertEquals(
    source.includes(
      "export async function createAdmittedSpiceExecutionServerOptionsForImage",
    ),
    false,
  );
  assertEquals(
    source.includes("createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport"),
    true,
  );
});

async function records() {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const matrixFingerprint =
    await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(matrix);
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
    ngspice: await one("ngspice-worker"),
    modelica: await one("modelica-microsandbox-worker"),
  };
}
