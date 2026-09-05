import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeRuntimeAttestation,
  validateIsolatedCodeExecutionRequest,
} from "../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateImportRecord,
  parseFirstPartyMicrosandboxImageCandidateImportRecord,
} from "../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT,
} from "../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import {
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
} from "../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { readFirstPartyMicrosandboxImageCandidateQualificationSuccessor } from "../control-plane/first-party-microsandbox-image-candidate-qualification-successor.ts";
import { FileIsolatedOutputCas } from "../shared/cas/file-isolated-output-cas.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  validateModelicaIsolatedEvidence,
  validateModelicaIsolatedInputBundle,
} from "../../domain/modelica/qualified-kit/isolated-execution.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../domain/modelica/local-execution-image.ts";
import type { AdmittedModelicaExecutionComposition } from "./admitted/execution-composition.ts";
import { FixedAdmittedModelicaExecutionProfileCatalog } from "./admitted/execution-profile-catalog.ts";
import {
  authorizeAdmittedModelicaSource,
  normalizeAdmittedResult,
} from "./admitted/closed-subset-v2/run.ts";
import {
  FileModelicaWorkerCandidateProfileAttemptStore,
} from "./modelica-worker-candidate-profile-attempt-store.ts";
import {
  MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
  MODELICA_WORKER_CANDIDATE_ADMITTED_SOURCE,
  MODELICA_WORKER_CANDIDATE_PROOF_IDS,
  MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
  modelicaWorkerCandidateProfileRoot,
  type ModelicaWorkerCandidateQualificationPorts,
  parseModelicaWorkerCandidateQualificationAggregate,
  planModelicaWorkerCandidateQualification,
  qualifyModelicaWorkerCandidate,
  recoverModelicaWorkerCandidateQualification,
  retryModelicaWorkerCandidateQualificationFromInfrastructureFailure,
} from "./modelica-worker-candidate-qualification.ts";
import type { ModelicaIsolatedExecutionComposition } from "./qualified-kit/execution-composition.ts";
import { FixedModelicaIsolatedExecutionProfileCatalog } from "./qualified-kit/execution-profile.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const ENCODER = new TextEncoder();

Deno.test("current matrix remains five physical / five logical with one Modelica target", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  assertEquals(matrix.contract, FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT);
  assertEquals(matrix.images.length, 5);
  assertEquals(
    matrix.images.reduce((count, image) => count + image.logicalTargets.length, 0),
    5,
  );
  const modelica = matrix.images.filter((image) =>
    image.physicalImageId === MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID
  );
  assertEquals(modelica.length, 1);
  assertEquals(modelica[0]!.logicalTargets.length, 1);
  assertEquals(modelica[0]!.logicalTargets[0]!.unitId, "casys.modelica-worker");
});

Deno.test("Modelica candidate plan is non-mutating, record-bound and names both proofs", async () => {
  const { modelica, calculix } = await records();
  let composed = 0;
  const plan = await planModelicaWorkerCandidateQualification(modelica);
  assertEquals(plan.kind, "candidate-qualification");
  assertEquals(plan.mutation, false);
  assertEquals(plan.eligibleForPromotion, false);
  assertEquals(plan.runtimeQualification, "not-run");
  assertEquals(plan.proofs.map((proof) => proof.id), [
    ...MODELICA_WORKER_CANDIDATE_PROOF_IDS,
  ]);
  assertEquals(plan.proofs.every((proof) => proof.status === "not-run"), true);
  assertEquals(
    plan.candidateReference,
    modelica.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    plan.stateRoot,
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
      plan.importRecordFingerprint,
    ),
  );
  await assertRejects(
    () => planModelicaWorkerCandidateQualification(calculix),
    TypeError,
    "physicalImageId=modelica-microsandbox-worker",
  );
  await assertRejects(
    () =>
      qualifyModelicaWorkerCandidate(calculix, {
        observedHost: { read: () => Promise.resolve(observedHost()) },
        composeQualifiedKit: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
        composeAdmitted: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    TypeError,
    "physicalImageId=modelica-microsandbox-worker",
  );
  assertEquals(composed, 0);
});

Deno.test("tampered Modelica candidate import records fail before composition", async () => {
  const { modelica } = await records();
  const tampered = JSON.parse(deterministicJson(modelica)) as Record<string, unknown>;
  const identities = tampered.identities as Record<string, unknown>;
  identities.microsandboxManifestDigest = `sha256:${"0".repeat(64)}`;
  tampered.identities = identities;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(tampered),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("Modelica candidate qualification uses one host snapshot, both proofs, CAS reread and proven destruction", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-qualification-" }),
  );
  const activeRoot = `${directory}/active`;
  await Deno.mkdir(`${activeRoot}/modelica-microsandbox-qualification`, {
    recursive: true,
  });
  await Deno.mkdir(`${activeRoot}/recorded-analysis`, { recursive: true });
  await Deno.mkdir(`${activeRoot}/capability-runtime-host`, { recursive: true });
  const calls = {
    kitCompose: 0,
    admittedCompose: 0,
    kitRun: 0,
    admittedRun: 0,
    imageRemove: 0,
    kitImage: "",
    admittedImage: "",
  };
  const host = observedHost();
  let observedHostReads = 0;
  let nowCalls = 0;
  const startedAt = "2026-09-05T03:00:00.000Z";
  try {
    const result = await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: {
        read: () => {
          observedHostReads += 1;
          return Promise.resolve(host);
        },
      },
      now: () => {
        nowCalls += 1;
        return startedAt;
      },
      stateRoot: `${directory}/candidate`,
      composeQualifiedKit: async (options, paths) => {
        calls.kitCompose += 1;
        calls.kitImage = options.profile.imageReference;
        return await fakeKitComposition(options.profile, paths, calls);
      },
      composeAdmitted: async (options, paths) => {
        calls.admittedCompose += 1;
        calls.admittedImage = options.profile.imageReference;
        return await fakeAdmittedComposition(options.profile, paths, calls);
      },
    });
    assertEquals(calls.kitCompose, 1);
    assertEquals(calls.admittedCompose, 1);
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 1);
    assertEquals(calls.imageRemove, 0);
    assertEquals(observedHostReads, 1);
    assertEquals(nowCalls, 1);
    assertEquals(calls.kitImage, modelica.candidate.microsandbox.candidateReference);
    assertEquals(
      calls.admittedImage,
      modelica.candidate.microsandbox.candidateReference,
    );
    assertEquals(calls.kitImage, calls.admittedImage);
    assertEquals(
      result.candidateReference,
      modelica.candidate.microsandbox.candidateReference,
    );
    assertEquals(
      pinnedOciImageReference(result.candidateReference, "$test") ===
        pinnedOciImageReference(LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE, "$pin"),
      false,
    );
    assertEquals(result.status, "passed");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.engineeringLevels, { l3: false, l4: false, l5: false });
    assertEquals(result.admittedMethodQualification, "unqualified");
    assertEquals(result.proofs.length, 2);
    assertEquals(
      result.proofs[0]!.profileId,
      MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
    );
    assertEquals(
      result.proofs[1]!.profileId,
      MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
    );
    assertEquals(
      result.proofs[0]!.execution.runId === result.proofs[1]!.execution.runId,
      false,
    );
    if (result.status !== "passed") throw new Error("expected passed");
    assertEquals(result.qualification.eligibleForPromotion, false);
    assertEquals(result.qualification.admittedMethodQualification, "unqualified");
    assertEquals(result.qualification.observedHost.platform, "linux/arm64");
    assertEquals(
      result.qualification.observedHost.identityFingerprint,
      host.identityFingerprint,
    );
    assertEquals(
      await Deno.readTextFile(`${directory}/candidate/qualification.json`),
      `${deterministicJson(result.qualification)}\n`,
    );
    const reread = await parseModelicaWorkerCandidateQualificationAggregate(
      JSON.parse(await Deno.readTextFile(`${directory}/candidate/qualification.json`)),
    );
    assertEquals(reread, result.qualification);
    if (!("methodQualification" in result.proofs[1]!)) {
      throw new Error("admitted proof must keep method qualification literal");
    }
    assertEquals(result.proofs[1].methodQualification, "unqualified");
    assertEquals(result.proofs[1].bindingQualification, "unqualified");
    const kitRoot = modelicaWorkerCandidateProfileRoot(
      `${directory}/candidate`,
      MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
    );
    const admittedRoot = modelicaWorkerCandidateProfileRoot(
      `${directory}/candidate`,
      MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
    );
    assertEquals((await Deno.stat(`${kitRoot}/outputs`)).isDirectory, true);
    assertEquals((await Deno.stat(`${admittedRoot}/outputs`)).isDirectory, true);
    assertEquals((await Deno.stat(`${kitRoot}/attempts`)).isDirectory, true);
    assertEquals((await Deno.stat(`${admittedRoot}/attempts`)).isDirectory, true);
    assertEquals(kitRoot === admittedRoot, false);
    const kitAttempt = await new FileModelicaWorkerCandidateProfileAttemptStore(
      `${kitRoot}/attempts`,
      `${directory}/candidate`,
    ).read();
    const admittedAttempt = await new FileModelicaWorkerCandidateProfileAttemptStore(
      `${admittedRoot}/attempts`,
      `${directory}/candidate`,
    ).read();
    if (kitAttempt?.phase !== "attested" || admittedAttempt?.phase !== "attested") {
      throw new Error("Expected durable attested profile WALs.");
    }
    assertEquals(kitAttempt.identity.startedAt, startedAt);
    assertEquals(admittedAttempt.identity.startedAt, startedAt);
    assertEquals(kitAttempt.attestation.attestedAt, startedAt);
    assertEquals(
      kitAttempt.identity.candidateReference ===
        LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
      false,
    );
    assertEquals(
      kitAttempt.identity.microsandboxManifestDigest,
      MICROSANDBOX_DIGEST,
    );
    assertEquals(
      (await Array.fromAsync(
        Deno.readDir(`${activeRoot}/modelica-microsandbox-qualification`),
      )).length,
      0,
    );
    assertEquals(
      (await Array.fromAsync(Deno.readDir(`${activeRoot}/recorded-analysis`))).length,
      0,
    );
    assertEquals(
      (await Array.fromAsync(Deno.readDir(`${activeRoot}/capability-runtime-host`)))
        .length,
      0,
    );

    const replayed = await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: {
        read: () => {
          observedHostReads += 1;
          return Promise.resolve(host);
        },
      },
      now: () => {
        nowCalls += 1;
        return "2026-09-05T04:00:00.000Z";
      },
      stateRoot: `${directory}/candidate`,
      composeQualifiedKit: async (options, paths) =>
        await fakeKitComposition(options.profile, paths, calls),
      composeAdmitted: async (options, paths) =>
        await fakeAdmittedComposition(options.profile, paths, calls),
    });
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 1);
    assertEquals(nowCalls, 1);
    assertEquals(replayed.status, "passed");
    if (replayed.status !== "passed") throw new Error("expected passed replay");
    assertEquals(replayed.qualification, result.qualification);

    const recovered = await recoverModelicaWorkerCandidateQualification(modelica, {
      observedHost: {
        read: () => {
          observedHostReads += 1;
          return Promise.resolve(host);
        },
      },
      now: () => {
        nowCalls += 1;
        return "2026-09-05T05:00:00.000Z";
      },
      stateRoot: `${directory}/candidate`,
      composeQualifiedKit: async (options, paths) =>
        await fakeKitComposition(options.profile, paths, calls),
      composeAdmitted: async (options, paths) =>
        await fakeAdmittedComposition(options.profile, paths, calls),
    });
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 1);
    assertEquals(observedHostReads, 3);
    assertEquals(nowCalls, 1);
    assertEquals(recovered.status, "passed");
    if (recovered.status !== "passed") throw new Error("expected passed recover");
    assertEquals(recovered.qualification, result.qualification);
    assertEquals(recovered.eligibleForPromotion, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("attested Modelica replay rejects proof drift from the current server profile", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-proof-drift-" }),
  );
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  const composeQualifiedKit: NonNullable<
    ModelicaWorkerCandidateQualificationPorts["composeQualifiedKit"]
  > = async (options, paths) => await fakeKitComposition(options.profile, paths, calls);
  const composeAdmitted: NonNullable<
    ModelicaWorkerCandidateQualificationPorts["composeAdmitted"]
  > = async (options, paths) =>
    await fakeAdmittedComposition(options.profile, paths, calls);
  try {
    await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      composeQualifiedKit,
      composeAdmitted,
    });
    const proofPath = `${
      modelicaWorkerCandidateProfileRoot(
        directory,
        MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
      )
    }/proof.json`;
    const proof = JSON.parse(await Deno.readTextFile(proofPath)) as Record<
      string,
      unknown
    >;
    proof.executionProfile = {
      ...(proof.executionProfile as Record<string, unknown>),
      id: "divergent-server-profile",
    };
    await Deno.writeTextFile(proofPath, `${deterministicJson(proof)}\n`);

    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          composeQualifiedKit,
          composeAdmitted,
        }),
      Error,
      "current server-owned profile",
    );
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("attested Modelica replay rejects a receipt fingerprint drift", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-receipt-drift-" }),
  );
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  try {
    await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      composeQualifiedKit: async (options, paths) =>
        await fakeKitComposition(options.profile, paths, calls),
      composeAdmitted: async (options, paths) =>
        await fakeAdmittedComposition(options.profile, paths, calls),
    });

    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          composeQualifiedKit: async (options, paths) => {
            const composition = await fakeKitComposition(
              options.profile,
              paths,
              calls,
            );
            const publications = composition.execution!.publications;
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                publications: {
                  resolvePublicationByRunId: (runId, producerGeneration) =>
                    publications.resolvePublicationByRunId(
                      runId,
                      producerGeneration,
                    ),
                  readReceipt: async (ref) => {
                    const receipt = await publications.readReceipt(ref);
                    return receipt === undefined ? undefined : {
                      ...receipt,
                      fingerprint: {
                        algorithm: "sha256" as const,
                        digest: "0".repeat(64),
                      },
                    };
                  },
                  readPublishedObject: (ref, member) =>
                    publications.readPublishedObject(ref, member),
                },
              },
            };
          },
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "receipt diverged",
    );
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica candidate qualification rejects a receipt runtime from another image", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-runtime-drift-" }),
  );
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  try {
    await assertRejects(
      () =>
        qualifyModelicaWorkerCandidate(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          composeQualifiedKit: async (options, paths) => {
            const composition = await fakeKitComposition(
              options.profile,
              paths,
              calls,
            );
            const runner = composition.execution!.runner;
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                runner: {
                  async run(request) {
                    const receipt = await runner.run(request);
                    return {
                      ...receipt,
                      runtime: {
                        ...receipt.runtime,
                        imageDigest: {
                          algorithm: "sha256" as const,
                          digest: "0".repeat(64),
                        },
                      },
                    };
                  },
                },
              },
            };
          },
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "runtime attestation diverged",
    );
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 0);
    await assertRejects(
      () => Deno.stat(`${directory}/qualification.json`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica candidate qualification refuses a non-linux/arm64 host before composition", async () => {
  const { modelica } = await records();
  let composed = 0;
  await assertRejects(
    () =>
      qualifyModelicaWorkerCandidate(modelica, {
        observedHost: {
          read: () =>
            Promise.resolve({ ...observedHost(), platform: "linux/amd64" as const }),
        },
        composeQualifiedKit: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
        composeAdmitted: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    Error,
    "linux/arm64",
  );
  assertEquals(composed, 0);
});

Deno.test("partial Modelica candidate success writes no passed aggregate and retry skips the passed proof", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-partial-" }),
  );
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  let failAdmitted = true;
  try {
    const incomplete = await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      now: () => "2026-09-05T03:00:00.000Z",
      stateRoot: directory,
      composeQualifiedKit: async (options, paths) =>
        await fakeKitComposition(options.profile, paths, calls),
      composeAdmitted: async (options, paths) => {
        const composition = await fakeAdmittedComposition(
          options.profile,
          paths,
          calls,
        );
        return {
          ...composition,
          execution: {
            ...composition.execution!,
            runner: {
              run(request) {
                if (failAdmitted) {
                  return Promise.reject(new Error("admitted fixture failed"));
                }
                return composition.execution!.runner.run(request);
              },
            },
          },
        };
      },
    });
    assertEquals(incomplete.status, "incomplete");
    assertEquals(incomplete.runtimeQualification, "incomplete");
    assertEquals(incomplete.eligibleForPromotion, false);
    assertEquals(incomplete.proofs.length, 1);
    assertEquals(
      incomplete.proofs[0]!.profileId,
      MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
    );
    await assertRejects(
      () => Deno.stat(`${directory}/qualification.json`),
      Deno.errors.NotFound,
    );
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 0);

    failAdmitted = false;
    await assertRejects(
      () =>
        qualifyModelicaWorkerCandidate(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          now: () => "2026-09-05T04:00:00.000Z",
          stateRoot: directory,
          composeQualifiedKit: async (options, paths) =>
            await fakeKitComposition(options.profile, paths, calls),
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "unpublished; recovery does not redispatch",
    );
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica candidate recovery fails closed without WAL, unpublished or unknown publication", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-recover-" }),
  );
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  let nowCalls = 0;
  try {
    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          now: () => {
            nowCalls += 1;
            return "2026-09-05T06:00:00.000Z";
          },
          stateRoot: `${directory}/missing`,
          composeQualifiedKit: async (options, paths) =>
            await fakeKitComposition(options.profile, paths, calls),
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "requires an existing WAL attempt",
    );
    assertEquals(calls.kitRun, 0);
    assertEquals(calls.admittedRun, 0);
    assertEquals(nowCalls, 0);

    await seedDispatchingKit(modelica, `${directory}/unpublished`);
    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/unpublished`,
          composeQualifiedKit: async (options, paths) =>
            await fakeKitComposition(options.profile, paths, calls),
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "unpublished; recovery does not redispatch",
    );
    assertEquals(calls.kitRun, 0);

    await seedDispatchingKit(modelica, `${directory}/unknown`);
    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/unknown`,
          composeQualifiedKit: async (options, paths) => {
            const composition = await fakeKitComposition(options.profile, paths, calls);
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                publications: {
                  resolvePublicationByRunId: (runId, producerGeneration) =>
                    Promise.resolve({
                      status: "outcome-unknown" as const,
                      runId,
                      producerGeneration,
                    }),
                  readReceipt: () => Promise.resolve(undefined),
                  readPublishedObject: () => Promise.resolve(undefined),
                },
              },
            };
          },
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "outcome is unknown; no redispatch occurs",
    );
    assertEquals(calls.kitRun, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica candidate qualification refuses a divergent durable aggregate", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-divergent-" }),
  );
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  try {
    await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      composeQualifiedKit: async (options, paths) =>
        await fakeKitComposition(options.profile, paths, calls),
      composeAdmitted: async (options, paths) =>
        await fakeAdmittedComposition(options.profile, paths, calls),
    });
    const path = `${directory}/qualification.json`;
    const parsed = JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
    parsed.eligibleForPromotion = true;
    await Deno.writeTextFile(path, `${deterministicJson(parsed)}\n`);
    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(modelica, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          composeQualifiedKit: async (options, paths) =>
            await fakeKitComposition(options.profile, paths, calls),
          composeAdmitted: async (options, paths) =>
            await fakeAdmittedComposition(options.profile, paths, calls),
        }),
      Error,
      "already occupies this import-record identity",
    );
    assertEquals(calls.kitRun, 1);
    assertEquals(calls.admittedRun, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica candidate aggregate rejects missing, duplicate or foreign proofs", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-aggregate-" }),
  );
  try {
    const result = await qualifyModelicaWorkerCandidate(modelica, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      composeQualifiedKit: async (options, paths) =>
        await fakeKitComposition(options.profile, paths, { imageRemove: 0 }),
      composeAdmitted: async (options, paths) =>
        await fakeAdmittedComposition(options.profile, paths, { imageRemove: 0 }),
    });
    if (result.status !== "passed") throw new Error("expected passed");
    const aggregate = JSON.parse(
      deterministicJson(result.qualification),
    ) as Record<string, unknown>;
    assertThrows(
      () =>
        parseModelicaWorkerCandidateQualificationAggregate({
          ...aggregate,
          proofs: [result.proofs[0]],
        }),
      TypeError,
      "exactly two distinct profile proofs",
    );
    assertThrows(
      () =>
        parseModelicaWorkerCandidateQualificationAggregate({
          ...aggregate,
          proofs: [result.proofs[0], result.proofs[0]],
        }),
      TypeError,
      "openmodelica-admitted-modelica",
    );
    assertThrows(
      () =>
        parseModelicaWorkerCandidateQualificationAggregate({
          ...aggregate,
          physicalImageId: "calculix-worker",
        }),
      TypeError,
      "foreign",
    );
    assertThrows(
      () =>
        parseModelicaWorkerCandidateQualificationAggregate({
          ...aggregate,
          admittedMethodQualification: "qualified",
        }),
      TypeError,
      "eligibleForPromotion=false",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica successor covers both unpublished predecessors and stays promotion-false", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-successor-" }),
  );
  const runIds: string[] = [];
  try {
    await seedDispatchingBoth(modelica, directory);
    const kitWal = await Deno.readTextFile(
      `${
        modelicaWorkerCandidateProfileRoot(
          directory,
          MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
        )
      }/attempts/dispatching.json`,
    );
    const admittedWal = await Deno.readTextFile(
      `${
        modelicaWorkerCandidateProfileRoot(
          directory,
          MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
        )
      }/attempts/dispatching.json`,
    );
    const result =
      await retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
        modelica,
        trackingPorts(directory, runIds),
      );
    assertEquals(result.status, "passed");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.proofs.length, 2);
    assertEquals(runIds.length, 2);
    assertEquals(runIds[0] === JSON.parse(kitWal).identity.executionRunId, false);
    assertEquals(
      runIds[1] === JSON.parse(admittedWal).identity.executionRunId,
      false,
    );
    const successor =
      await readFirstPartyMicrosandboxImageCandidateQualificationSuccessor(directory);
    assertEquals(successor?.predecessor.attempts.length, 2);
    assertEquals(successor?.predecessor.ordinal, 0);
    assertEquals(successor?.successor.ordinal, 1);
    assertEquals(
      successor?.predecessor.attempts.map((attempt) => attempt.producerGeneration),
      [0, 0],
    );
    assertEquals(
      successor?.predecessor.attempts.map((attempt) => attempt.publication),
      ["not-published", "not-published"],
    );
    assertEquals(
      successor?.predecessor.attempts.map((attempt) => attempt.destruction.status),
      ["proven", "proven"],
    );
    assertEquals(
      successor?.predecessor.attempts[0]?.destruction.runId ===
        successor?.predecessor.attempts[1]?.destruction.runId,
      false,
    );
    assertEquals(
      successor?.successor.attempts.map((attempt) => attempt.producerGeneration),
      [0, 0],
    );
    assertEquals(successor?.eligibleForPromotion, false);
    assertEquals(
      await Deno.readTextFile(
        `${
          modelicaWorkerCandidateProfileRoot(
            directory,
            MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
          )
        }/attempts/dispatching.json`,
      ),
      kitWal,
    );
    assertEquals(
      await Deno.readTextFile(
        `${
          modelicaWorkerCandidateProfileRoot(
            directory,
            MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
          )
        }/attempts/dispatching.json`,
      ),
      admittedWal,
    );
    await assertRejects(
      () =>
        retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
          modelica,
          trackingPorts(directory, runIds),
        ),
      Error,
      "already consumed this predecessor",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica successor refuses missing, prepared, published and mixed-profile predecessors", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-successor-refuse-" }),
  );
  try {
    await assertRejects(
      () =>
        retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
          modelica,
          trackingPorts(`${directory}/missing`, []),
        ),
      Error,
      "existing producerGeneration-0 predecessor",
    );

    await seedDispatchingBoth(modelica, `${directory}/prepared`);
    await Deno.remove(
      `${
        modelicaWorkerCandidateProfileRoot(
          `${directory}/prepared`,
          MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
        )
      }/attempts/dispatching.json`,
    );
    await assertRejects(
      () =>
        retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
          modelica,
          trackingPorts(`${directory}/prepared`, []),
        ),
      Error,
      "prepared-only",
    );

    await qualifyModelicaWorkerCandidate(
      modelica,
      trackingPorts(`${directory}/published`, []),
    );
    await assertRejects(
      () =>
        retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
          modelica,
          trackingPorts(`${directory}/published`, []),
        ),
      Error,
      "already-successful",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica successor aggregate stays incomplete unless both new proofs pass", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-successor-atomic-" }),
  );
  try {
    await seedDispatchingBoth(modelica, directory);
    const result =
      await retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
        modelica,
        {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          composeQualifiedKit: async (options, paths) =>
            await fakeKitComposition(options.profile, paths, { imageRemove: 0 }),
          composeAdmitted: async (options, paths) => {
            const composition = fakeAdmittedComposition(options.profile, paths, {
              imageRemove: 0,
            });
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                runner: {
                  ...composition.execution!.runner,
                  run: () => {
                    throw new Error("admitted successor infrastructure failure");
                  },
                },
              },
            };
          },
        },
      );
    assertEquals(result.status, "incomplete");
    assertEquals(result.eligibleForPromotion, false);
    await assertRejects(
      () => Deno.stat(`${directory}/qualification.json`),
      Deno.errors.NotFound,
    );
    await assertRejects(
      () =>
        retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
          modelica,
          trackingPorts(directory, []),
        ),
      Error,
      "already consumed this predecessor",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica recover reconciles an existing successor without redispatched worker calls", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-modelica-candidate-successor-recover-" }),
  );
  const recoverIds: string[] = [];
  try {
    await seedDispatchingBoth(modelica, directory);
    const passed =
      await retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
        modelica,
        trackingPorts(directory, []),
      );
    assertEquals(passed.status, "passed");
    const admittedRoot =
      `${directory}/successor/targets/${MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID}`;
    await Deno.remove(`${directory}/qualification.json`);
    await Deno.remove(`${admittedRoot}/attempts/attested.json`);
    await Deno.remove(`${admittedRoot}/proof.json`);
    const result = await recoverModelicaWorkerCandidateQualification(
      modelica,
      trackingPorts(directory, recoverIds),
    );
    assertEquals(result.status, "passed");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.proofs.length, 2);
    assertEquals(recoverIds, []);
    assertEquals(
      (await Deno.stat(`${directory}/qualification.json`)).isFile,
      true,
    );
    assertEquals(
      (await Deno.stat(`${admittedRoot}/attempts/attested.json`)).isFile,
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica recover of a successor requires both profile WALs and does not fall back", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({
      prefix: "casys-modelica-candidate-successor-recover-missing-",
    }),
  );
  const recoverIds: string[] = [];
  try {
    await seedDispatchingBoth(modelica, directory);
    await retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
      modelica,
      trackingPorts(directory, []),
    );
    await Deno.remove(`${directory}/qualification.json`);
    await Deno.remove(
      `${directory}/successor/targets/${MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID}`,
      { recursive: true },
    );
    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(
          modelica,
          trackingPorts(directory, recoverIds),
        ),
      Error,
      "recovery of a successor requires an existing WAL attempt",
    );
    assertEquals(recoverIds, []);
    await assertRejects(
      () => Deno.stat(`${directory}/qualification.json`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica recover refuses a successor WAL that diverged from the successor authority", async () => {
  const { modelica } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({
      prefix: "casys-modelica-candidate-successor-recover-divergent-",
    }),
  );
  const recoverIds: string[] = [];
  try {
    await seedDispatchingBoth(modelica, directory);
    await retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
      modelica,
      trackingPorts(directory, []),
    );
    const admittedRoot =
      `${directory}/successor/targets/${MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID}`;
    await Deno.remove(`${admittedRoot}/attempts/attested.json`);
    const dispatchingPath = `${admittedRoot}/attempts/dispatching.json`;
    const attempt = JSON.parse(await Deno.readTextFile(dispatchingPath)) as {
      identity: { executionRunId: string };
    };
    attempt.identity.executionRunId = "foreign-modelica-successor-run";
    await Deno.writeTextFile(dispatchingPath, `${deterministicJson(attempt)}\n`);
    await assertRejects(
      () =>
        recoverModelicaWorkerCandidateQualification(
          modelica,
          trackingPorts(directory, recoverIds),
        ),
      Error,
      "diverged from the successor authority",
    );
    assertEquals(recoverIds, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica candidate qualification source never deletes images or builds Docker", async () => {
  const source = await Deno.readTextFile(
    new URL("./modelica-worker-candidate-qualification.ts", import.meta.url),
  );
  assertEquals(source.includes("Image.remove"), false);
  assertEquals(source.includes("image remove"), false);
  assertEquals(source.includes("--keep-image"), false);
  assertEquals(source.includes("docker"), false);
  assertEquals(source.includes("buildx"), false);
  assertEquals(source.includes("Deno.build"), false);
  assertEquals(source.includes("2026-01-01T00:00:00.000Z"), false);
  assertEquals(
    source.includes(MODELICA_WORKER_CANDIDATE_ADMITTED_SOURCE.slice(0, 20)),
    true,
  );
  assertEquals(source.includes("LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE"), true);
});

async function seedDispatchingBoth(
  record: Awaited<ReturnType<typeof records>>["modelica"],
  stateRoot: string,
): Promise<void> {
  await qualifyModelicaWorkerCandidate(record, trackingPorts(stateRoot, []));
  await Deno.remove(`${stateRoot}/qualification.json`);
  for (
    const profileId of [
      MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
      MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
    ]
  ) {
    const root = modelicaWorkerCandidateProfileRoot(stateRoot, profileId);
    await Deno.remove(`${root}/attempts/attested.json`);
    await Deno.remove(`${root}/proof.json`);
    await Deno.remove(`${root}/outputs`, { recursive: true });
    await Deno.mkdir(`${root}/outputs`, { recursive: true });
  }
}

function trackingPorts(
  stateRoot: string,
  runIds: string[],
): ModelicaWorkerCandidateQualificationPorts {
  return {
    observedHost: { read: () => Promise.resolve(observedHost()) },
    stateRoot,
    composeQualifiedKit: async (options, paths) => {
      const composition = fakeKitComposition(options.profile, paths, {
        imageRemove: 0,
      });
      return withTrackedRun(composition, runIds);
    },
    composeAdmitted: async (options, paths) => {
      const composition = fakeAdmittedComposition(options.profile, paths, {
        imageRemove: 0,
      });
      return withTrackedRun(composition, runIds);
    },
  };
}

function withTrackedRun<
  T extends {
    readonly execution?: {
      readonly runner: {
        run: (request: IsolatedCodeExecutionRequest) => Promise<unknown>;
      };
      readonly recovery: unknown;
      readonly publications: unknown;
    };
  },
>(composition: T, runIds: string[]): T {
  const execution = composition.execution!;
  const runner = execution.runner;
  return {
    ...composition,
    execution: {
      ...execution,
      runner: {
        ...runner,
        run: async (request: IsolatedCodeExecutionRequest) => {
          runIds.push(request.runId);
          return await runner.run(request);
        },
      },
    },
  };
}

async function seedDispatchingKit(
  record: Awaited<ReturnType<typeof records>>["modelica"],
  stateRoot: string,
): Promise<void> {
  const calls = { kitRun: 0, admittedRun: 0, imageRemove: 0 };
  await qualifyModelicaWorkerCandidate(record, {
    observedHost: { read: () => Promise.resolve(observedHost()) },
    now: () => "2026-09-05T03:00:00.000Z",
    stateRoot,
    composeQualifiedKit: async (options, paths) =>
      await fakeKitComposition(options.profile, paths, calls),
    composeAdmitted: async (options, paths) =>
      await fakeAdmittedComposition(options.profile, paths, calls),
  });
  await Deno.remove(`${stateRoot}/qualification.json`);
  const kitRoot = modelicaWorkerCandidateProfileRoot(
    stateRoot,
    MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
  );
  await Deno.remove(`${kitRoot}/attempts/attested.json`);
  await Deno.remove(`${kitRoot}/proof.json`);
  await Deno.remove(`${kitRoot}/outputs`, { recursive: true });
  await Deno.mkdir(`${kitRoot}/outputs`, { recursive: true });
  const admittedRoot = modelicaWorkerCandidateProfileRoot(
    stateRoot,
    MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
  );
  await Deno.remove(admittedRoot, { recursive: true });
}

function fakeKitComposition(
  options: ConstructorParameters<
    typeof FixedModelicaIsolatedExecutionProfileCatalog
  >[0],
  paths: { readonly outputCasDirectory: string },
  calls: { kitRun?: number; imageRemove: number },
): ModelicaIsolatedExecutionComposition {
  const profiles = new FixedModelicaIsolatedExecutionProfileCatalog(options);
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const runner = {
    async run(request: IsolatedCodeExecutionRequest) {
      calls.kitRun = (calls.kitRun ?? 0) + 1;
      const validated = await validateIsolatedCodeExecutionRequest(request);
      const profile = await profiles.initial();
      const outputs = await kitOutputs(validated.source.bytes.copy());
      return await publishReceipt(
        validated,
        publications,
        profile.runtime,
        profile.outputManifest,
        outputs,
      );
    },
    destroyByRunId(runId: string) {
      return Promise.resolve({
        status: "proven" as const,
        runId,
        proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
      });
    },
    advanceProducerGeneration: () => Promise.reject(new Error("not used")),
  };
  Object.defineProperty(runner, "removeImage", {
    get() {
      calls.imageRemove += 1;
      throw new Error("candidate image must not be deleted");
    },
  });
  return {
    profiles,
    execution: { runner, recovery: runner, publications },
  };
}

function fakeAdmittedComposition(
  options: ConstructorParameters<
    typeof FixedAdmittedModelicaExecutionProfileCatalog
  >[0],
  paths: { readonly outputCasDirectory: string },
  calls: { admittedRun?: number; imageRemove: number },
): AdmittedModelicaExecutionComposition {
  const profiles = new FixedAdmittedModelicaExecutionProfileCatalog(options);
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const runner = {
    async run(request: IsolatedCodeExecutionRequest) {
      calls.admittedRun = (calls.admittedRun ?? 0) + 1;
      const validated = await validateIsolatedCodeExecutionRequest(request);
      const profile = await profiles.initial();
      const outputs = await admittedOutputs(validated.source.bytes.copy());
      return await publishReceipt(
        validated,
        publications,
        profile.runtime,
        profile.outputManifest,
        outputs,
      );
    },
    destroyByRunId(runId: string) {
      return Promise.resolve({
        status: "proven" as const,
        runId,
        proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
      });
    },
    advanceProducerGeneration: () => Promise.reject(new Error("not used")),
  };
  Object.defineProperty(runner, "removeImage", {
    get() {
      calls.imageRemove += 1;
      throw new Error("candidate image must not be deleted");
    },
  });
  return {
    profiles,
    execution: { runner, recovery: runner, publications },
  };
}

async function publishReceipt(
  request: Awaited<ReturnType<typeof validateIsolatedCodeExecutionRequest>>,
  cas: FileIsolatedOutputCas,
  runtime: IsolatedCodeRuntimeAttestation,
  manifest: readonly {
    readonly role: string;
    readonly basename: string;
    readonly mediaType: string;
    readonly format: string;
  }[],
  bytesByRole: ReadonlyMap<string, Uint8Array>,
) {
  const outputs = await Promise.all(manifest.map(async (declaration) => {
    const bytes = bytesByRole.get(declaration.role)!;
    return {
      ...declaration,
      byteCount: bytes.byteLength,
      sha256: await fingerprintResourceBytes(bytes),
      casUri: `casys://isolated-output/sha256/${await fingerprintResourceBytes(bytes)}`,
      bytes,
    };
  }));
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    request.runId,
    request.producerGeneration,
    outputs.map(({ bytes: _bytes, ...output }) => output),
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs,
    destruction: {
      status: "proven",
      runId: request.runId,
      proofFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    },
    publication: await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      publicationFingerprint,
    ),
  });
  const staged = await cas.stageBatch(outputs.map(({ casUri: _casUri, ...output }) => ({
    ...output,
    runId: request.runId,
    producerGeneration: request.producerGeneration,
  })));
  await cas.commit(staged.batch, isolatedCodeExecutionReceiptRecord(receipt));
  return receipt;
}

async function kitOutputs(source: Uint8Array): Promise<Map<string, Uint8Array>> {
  const bundle = await validateModelicaIsolatedInputBundle(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)),
  );
  const rows = Array.from(
    { length: 21 },
    (_, index) => `${index / 10},${20 + index / 10}`,
  );
  const resultBytes = ENCODER.encode(`time,temperatureC\n${rows.join("\n")}\n`);
  const bundleFingerprint = await sha256Fingerprint(bundle);
  const evidence = validateModelicaIsolatedEvidence({
    schemaVersion: "modelica-isolated-evidence/1.0",
    inputBundleSha256: bundleFingerprint.digest,
    status: "succeeded",
    method: bundle.method,
    resolvedParameters: bundle.invocation.parameters.map((parameter) => ({
      id: parameter.id,
      modelicaName: parameter.modelicaName,
      value: parameter.inputValue,
      unit: parameter.inputUnit,
      modelicaValue: parameter.modelicaValue,
      modelicaUnit: parameter.modelicaUnit,
    })),
    metrics: [{ id: "temperature_final", value: 22, unit: "degC" }],
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
    warnings: [],
  });
  return new Map([
    ["evidence", ENCODER.encode(deterministicJson(evidence))],
    ["result", resultBytes],
  ]);
}

async function admittedOutputs(source: Uint8Array): Promise<Map<string, Uint8Array>> {
  const authorized = await authorizeAdmittedModelicaSource(source);
  const rows = ['"time","position","velocity"'];
  for (let index = 0; index <= 20; index += 1) {
    const time = index / 10;
    rows.push(`${time},${1 + time},${time}`);
  }
  const csv = `${rows.join("\n")}\n`;
  const resultBytes = ENCODER.encode(csv);
  normalizeAdmittedResult(csv, authorized.source);
  const evidence = {
    schemaVersion: "modelica-isolated-evidence/2.0",
    inputBundleSha256: authorized.sha256,
    status: "succeeded",
    method: {
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      resultNormalizer: {
        id: "modelica-closed-subset-v2-result-normalizer",
        version: "2.0.0",
      },
      engine: { name: "OpenModelica", version: "1.27.0", mslVersion: "not-used" },
    },
    modelName: authorized.source.modelName,
    scenario: {
      startTimeS: 0,
      stopTimeS: 2,
      intervalS: 0.1,
      tolerance: 0.000001,
      numberOfIntervals: 20,
      solver: "dassl",
    },
    resolvedParameters: [
      { name: "initialPosition", value: 1, unit: "m" },
      { name: "drive", value: 2, unit: "m/s2" },
    ],
    metrics: [
      { outputName: "position", statistic: "final", value: 3, unit: "m" },
      { outputName: "position", statistic: "max_abs", value: 3, unit: "m" },
      { outputName: "velocity", statistic: "final", value: 2, unit: "m/s" },
      { outputName: "velocity", statistic: "max_abs", value: 2, unit: "m/s" },
    ],
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
    warnings: [],
  };
  return new Map([
    ["evidence", ENCODER.encode(JSON.stringify(evidence))],
    ["result", resultBytes],
  ]);
}

function observedHost() {
  return {
    schemaVersion: "capability-runtime-host-observation/1.0" as const,
    identityFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    platform: "linux/arm64" as const,
    images: [],
  };
}

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
