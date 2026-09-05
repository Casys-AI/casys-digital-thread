import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../domain/modelica/local-execution-image.ts";
import {
  admittedModelicaExecutionPolicyBody,
  createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport,
  createLocalAdmittedModelicaExecutionServerOptions,
  createLocalModelicaIsolatedExecutionServerOptions,
  createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport,
  LOCAL_MODELICA_ENGINE,
  LOCAL_MODELICA_EXECUTION_LIMITS,
  modelicaIsolatedExecutionPolicyBody,
} from "./first-party-modelica-execution.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;

Deno.test("active Modelica policy builders stay digest-pinned and shared", async () => {
  const kit = await createLocalModelicaIsolatedExecutionServerOptions();
  const kitAgain = await createLocalModelicaIsolatedExecutionServerOptions();
  const admitted = await createLocalAdmittedModelicaExecutionServerOptions();
  const admittedAgain = await createLocalAdmittedModelicaExecutionServerOptions();
  assertEquals(kit, kitAgain);
  assertEquals(admitted, admittedAgain);
  assertEquals(kit.profile.imageReference, LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE);
  assertEquals(
    admitted.profile.imageReference,
    LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  );
  assertEquals(kit.profile.policy.id, "modelica-microsandbox-deny-all-v1");
  assertEquals(
    admitted.profile.policy.id,
    "modelica-admitted-microsandbox-deny-all-v1",
  );
  assertEquals(kit.profile.policy.version, "1.0.0");
  assertEquals(admitted.profile.policy.version, "1.0.0");
  assertEquals(kit.profile.limits, LOCAL_MODELICA_EXECUTION_LIMITS);
  assertEquals(admitted.profile.limits, LOCAL_MODELICA_EXECUTION_LIMITS);
  assertEquals(kit.profile.engine, LOCAL_MODELICA_ENGINE);
  assertEquals(kit.runtime, {});
  assertEquals(admitted.runtime, {});
  assertEquals(kit.profile.policy.fingerprint, {
    algorithm: "sha256",
    digest: "acd119309fd7827a09b31babdd01a46e27f9839b02145dc8e01b480d904ccabe",
  });
});

Deno.test("Modelica candidate options bind the import-record candidate reference", async () => {
  const { modelica, calculix } = await records();
  const activeKit = await createLocalModelicaIsolatedExecutionServerOptions();
  const activeAdmitted = await createLocalAdmittedModelicaExecutionServerOptions();
  const kit = await createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport(
    modelica,
  );
  const admitted =
    await createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport(
      modelica,
    );
  assertEquals(
    kit.profile.imageReference,
    modelica.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    admitted.profile.imageReference,
    modelica.candidate.microsandbox.candidateReference,
  );
  assertEquals(kit.profile.limits, LOCAL_MODELICA_EXECUTION_LIMITS);
  assertEquals(admitted.profile.limits, LOCAL_MODELICA_EXECUTION_LIMITS);
  assertEquals(kit.profile.engine, LOCAL_MODELICA_ENGINE);
  assertEquals(
    kit.profile.imageReference === LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
    false,
  );
  assertEquals(
    kit.profile.policy.fingerprint.digest ===
      activeKit.profile.policy.fingerprint.digest,
    false,
  );
  assertEquals(
    admitted.profile.policy.fingerprint.digest ===
      activeAdmitted.profile.policy.fingerprint.digest,
    false,
  );
  assertEquals(
    modelicaIsolatedExecutionPolicyBody(kit.profile.imageReference).imageReference,
    modelica.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    admittedModelicaExecutionPolicyBody(admitted.profile.imageReference)
      .imageReference,
    modelica.candidate.microsandbox.candidateReference,
  );
  await assertRejects(
    () => createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport(calculix),
    TypeError,
    "physicalImageId=modelica-microsandbox-worker",
  );
  await assertRejects(
    () => createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport(calculix),
    TypeError,
    "physicalImageId=modelica-microsandbox-worker",
  );
});

Deno.test("Modelica policy module does not expose a raw image-selector API", async () => {
  const source = await Deno.readTextFile(
    new URL("./first-party-modelica-execution.ts", import.meta.url),
  );
  assertEquals(
    source.includes(
      "export async function createModelicaIsolatedExecutionServerOptionsForImage",
    ),
    false,
  );
  assertEquals(
    source.includes(
      "export async function createAdmittedModelicaExecutionServerOptionsForImage",
    ),
    false,
  );
  assertEquals(
    source.includes(
      "createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport",
    ),
    true,
  );
  assertEquals(
    source.includes(
      "createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport",
    ),
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
    modelica: await one("modelica-microsandbox-worker"),
    calculix: await one("calculix-worker"),
  };
}
