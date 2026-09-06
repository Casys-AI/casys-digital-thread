import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintCapabilityRuntimeObservedHost } from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateImportRecord,
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  parseFirstPartyMicrosandboxImageCandidateImportRecord,
} from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import {
  BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import {
  readCandidateQualificationPredecessorRunFence,
  readFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification-successor.ts";
import { FileIsolatedOutputCas } from "../../shared/cas/file-isolated-output-cas.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import type { Build123dExecutionComposition } from "./build123d-execution-composition.ts";
import { FixedBuild123dExecutionProfileCatalog } from "./fixed-build123d-execution-profile-catalog.ts";
import {
  BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_SOURCE,
  planBuild123dIsolatedWorkerCandidateQualification,
  qualifyBuild123dIsolatedWorkerCandidate,
  retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure,
} from "./build123d-isolated-worker-candidate-qualification.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const STEP_BYTES = new TextEncoder().encode("ISO-10303-21; candidate-step");

Deno.test("Build123d candidate plan rejects the other CAD image before composition", async () => {
  const { build123d, geometry } = await records();
  let composed = 0;
  const plan = await planBuild123dIsolatedWorkerCandidateQualification(build123d);
  assertEquals(plan.kind, "candidate-qualification");
  assertEquals(plan.mutation, false);
  assertEquals(plan.eligibleForPromotion, false);
  assertEquals(
    plan.candidateReference,
    build123d.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    plan.stateRoot,
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
      plan.importRecordFingerprint,
    ),
  );
  await assertRejects(
    () => planBuild123dIsolatedWorkerCandidateQualification(geometry),
    TypeError,
    "physicalImageId=build123d-isolated-worker",
  );
  await assertRejects(
    () =>
      qualifyBuild123dIsolatedWorkerCandidate(geometry, {
        observedHost: { read: () => Promise.resolve(observedHost()) },
        compose: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    TypeError,
    "physicalImageId=build123d-isolated-worker",
  );
  assertEquals(composed, 0);
});

Deno.test("tampered Build123d candidate import records fail before composition", async () => {
  const { build123d } = await records();
  const tampered = JSON.parse(deterministicJson(build123d)) as Record<string, unknown>;
  const identities = tampered.identities as Record<string, unknown>;
  identities.microsandboxManifestDigest = `sha256:${"0".repeat(64)}`;
  tampered.identities = identities;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(tampered),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("Build123d candidate qualification uses the bound reference, CAS reread, validator and proven destruction", async () => {
  const { build123d } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-build123d-candidate-qualification-" }),
  );
  const calls = {
    compose: 0,
    validate: 0,
    imageRemove: 0,
    composedImage: "",
  };
  try {
    const host = observedHost();
    const result = await qualifyBuild123dIsolatedWorkerCandidate(build123d, {
      observedHost: { read: () => Promise.resolve(host) },
      stateRoot: directory,
      validateOutput: () => {
        calls.validate += 1;
        return Promise.resolve();
      },
      compose: async (options, paths) => {
        calls.compose += 1;
        calls.composedImage = options.profile.imageReference;
        return await fakeComposition(options.profile, paths, calls);
      },
    });
    assertEquals(calls.compose, 1);
    assertEquals(calls.validate, 1);
    assertEquals(calls.imageRemove, 0);
    assertEquals(
      calls.composedImage,
      build123d.candidate.microsandbox.candidateReference,
    );
    assertEquals(
      result.candidateReference,
      build123d.candidate.microsandbox.candidateReference,
    );
    assertEquals(
      pinnedOciImageReference(result.candidateReference, "$test"),
      pinnedOciImageReference(
        `casys/first-party-candidate-build123d-isolated-worker@${MICROSANDBOX_DIGEST}`,
        "$expected",
      ),
    );
    assertEquals(
      result.candidateReference === LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      false,
    );
    assertEquals(result.kind, "candidate-qualification");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.destruction, "proven");
    assertEquals(result.output.reread, "publication-gated");
    assertEquals(result.engineeringLevels, { l3: false, l4: false, l5: false });
    assertEquals(
      result.importRecordFingerprint,
      await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(build123d),
    );
    assertEquals(result.stateRoot, directory);
    assertEquals(
      await Deno.readTextFile(`${directory}/qualification.json`),
      `${deterministicJson(result.qualification)}\n`,
    );
    assertEquals(result.qualification.eligibleForPromotion, false);
    assertEquals(result.qualification.observedHost.platform, "linux/arm64");
    assertEquals(
      result.qualification.observedHost.identityFingerprint,
      host.identityFingerprint,
    );
    assertEquals(result.qualification.execution.runId.length > 0, true);
    assertEquals(
      result.qualification.execution.receiptFingerprint,
      result.receiptFingerprint,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Build123d candidate qualification requires output reread, validator and proven destruction", async () => {
  const { build123d } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-build123d-candidate-required-" }),
  );
  try {
    await assertRejects(
      () =>
        qualifyBuild123dIsolatedWorkerCandidate(build123d, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/destruction`,
          validateOutput: () => Promise.resolve(),
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, { imageRemove: 0 }, {
              destruction: "acknowledged-unattested",
            }),
        }),
      Error,
      "proven microVM destruction",
    );
    await assertRejects(
      () =>
        qualifyBuild123dIsolatedWorkerCandidate(build123d, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/validator`,
          validateOutput: () => Promise.reject(new Error("validator required")),
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, { imageRemove: 0 }),
        }),
      Error,
      "validator required",
    );
    await assertRejects(
      () =>
        qualifyBuild123dIsolatedWorkerCandidate(build123d, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/reread`,
          validateOutput: () => Promise.resolve(),
          compose: async (options, paths) => {
            const composition = await fakeComposition(options.profile, paths, {
              imageRemove: 0,
            });
            const publications = composition.execution!.publications;
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                publications: {
                  resolvePublicationByRunId: (runId, generation) =>
                    publications.resolvePublicationByRunId(runId, generation),
                  readReceipt: (ref) => publications.readReceipt(ref),
                  readPublishedObject: () => Promise.resolve(undefined),
                },
              },
            };
          },
        }),
      Error,
      "could not be reopened",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Build123d candidate qualification refuses a non-linux/arm64 host before composition", async () => {
  const { build123d } = await records();
  let composed = 0;
  await assertRejects(
    () =>
      qualifyBuild123dIsolatedWorkerCandidate(build123d, {
        observedHost: {
          read: () =>
            Promise.resolve({ ...observedHost(), platform: "linux/amd64" as const }),
        },
        compose: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    Error,
    "linux/arm64",
  );
  assertEquals(composed, 0);
});

Deno.test("Build123d successor dispatches a distinct run from a fenced not-published predecessor", async () => {
  const { build123d } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-build123d-candidate-successor-" }),
  );
  const calls = { runIds: [] as string[], imageRemove: 0 };
  try {
    const predecessorRunId = await predecessorRunIdFor(build123d);
    const cas = new FileIsolatedOutputCas(`${directory}/outputs`);
    await cas.abortByRunId(predecessorRunId, 0);
    const fence = await readCandidateQualificationPredecessorRunFence(
      `${directory}/outputs`,
      predecessorRunId,
    );
    const result =
      await retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure(
        build123d,
        {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          validateOutput: () => Promise.resolve(),
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, calls),
        },
      );
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.qualification.eligibleForPromotion, false);
    assertEquals(result.qualification.execution.runId === predecessorRunId, false);
    assertEquals(calls.runIds, [result.qualification.execution.runId]);
    assertEquals(
      await readCandidateQualificationPredecessorRunFence(
        `${directory}/outputs`,
        predecessorRunId,
      ),
      fence,
    );
    const successor =
      await readFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
        directory,
      );
    assertEquals(successor?.predecessor.attempts[0]?.runId, predecessorRunId);
    assertEquals(successor?.predecessor.ordinal, 0);
    assertEquals(successor?.successor.ordinal, 1);
    assertEquals(successor?.predecessor.attempts[0]?.producerGeneration, 0);
    assertEquals(successor?.successor.attempts[0]?.producerGeneration, 0);
    assertEquals(successor?.predecessor.attempts[0]?.publication, "not-published");
    assertEquals(successor?.predecessor.attempts[0]?.destruction.status, "proven");
    assertEquals(
      successor?.predecessor.attempts[0]?.destruction.runId,
      predecessorRunId,
    );
    assertEquals(
      successor?.successor.attempts[0]?.runId,
      result.qualification.execution.runId,
    );
    assertEquals(successor?.reason, "infrastructure-failure");
    assertEquals(successor?.eligibleForPromotion, false);
    await assertRejects(
      () =>
        retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure(
          build123d,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: directory,
            validateOutput: () => Promise.resolve(),
            compose: async (options, paths) =>
              await fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "already consumed this predecessor",
    );
    assertEquals(calls.runIds.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Build123d successor refuses missing, published, unknown and foreign predecessors", async () => {
  const { build123d, geometry } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-build123d-candidate-successor-refuse-" }),
  );
  const calls = { runIds: [] as string[], imageRemove: 0 };
  try {
    await assertRejects(
      () =>
        retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure(
          build123d,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/missing`,
            compose: async (options, paths) =>
              await fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "existing producerGeneration-0 predecessor",
    );
    assertEquals(calls.runIds.length, 0);

    await qualifyBuild123dIsolatedWorkerCandidate(build123d, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: `${directory}/published`,
      validateOutput: () => Promise.resolve(),
      compose: async (options, paths) =>
        await fakeComposition(options.profile, paths, calls),
    });
    await assertRejects(
      () =>
        retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure(
          build123d,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/published`,
            compose: async (options, paths) =>
              await fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "already-successful",
    );

    const unknownRoot = `${directory}/unknown`;
    const predecessorRunId = await predecessorRunIdFor(build123d);
    await new FileIsolatedOutputCas(`${unknownRoot}/outputs`).abortByRunId(
      predecessorRunId,
      0,
    );
    await assertRejects(
      () =>
        retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure(
          build123d,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: unknownRoot,
            compose: async (options, paths) => {
              const composition = await fakeComposition(
                options.profile,
                paths,
                calls,
              );
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
          },
        ),
      Error,
      "publication outcome is unknown",
    );
    await assertRejects(
      () =>
        retryBuild123dIsolatedWorkerCandidateQualificationFromInfrastructureFailure(
          geometry,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            compose: () => Promise.reject(new Error("composition must not run")),
          },
        ),
      TypeError,
      "physicalImageId=build123d-isolated-worker",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Build123d candidate qualification source never deletes images or builds Docker", async () => {
  const source = await Deno.readTextFile(
    new URL("./build123d-isolated-worker-candidate-qualification.ts", import.meta.url),
  );
  assertEquals(source.includes("Image.remove"), false);
  assertEquals(source.includes("image remove"), false);
  assertEquals(source.includes("--keep-image"), false);
  assertEquals(source.includes("docker"), false);
  assertEquals(source.includes("buildx"), false);
  assertEquals(source.includes("Deno.build"), false);
  assertMatch(source, /BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_SOURCE/u);
  assertEquals(
    BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_SOURCE.includes(
      "Box(10, 20, 30)",
    ),
    true,
  );
});

async function fakeComposition(
  options: {
    readonly imageReference: string;
    readonly policy: ConstructorParameters<
      typeof FixedBuild123dExecutionProfileCatalog
    >[0]["policy"];
    readonly limits: ConstructorParameters<
      typeof FixedBuild123dExecutionProfileCatalog
    >[0]["limits"];
  },
  paths: { readonly outputCasDirectory: string },
  calls: { imageRemove: number; runIds?: string[] },
  overrides: { readonly destruction?: "acknowledged-unattested" } = {},
): Promise<Build123dExecutionComposition> {
  const profiles = new FixedBuild123dExecutionProfileCatalog(options);
  const profile = await profiles.initial();
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const runner = {
    async run(request: IsolatedCodeExecutionRequest) {
      calls.runIds?.push(request.runId);
      return await publishReceipt(
        await validateIsolatedCodeExecutionRequest(request),
        publications,
        profile,
        overrides,
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
    execution: {
      runner,
      recovery: runner,
      publications,
    },
  };
}

async function publishReceipt(
  request: Awaited<ReturnType<typeof validateIsolatedCodeExecutionRequest>>,
  cas: FileIsolatedOutputCas,
  profile: Awaited<ReturnType<FixedBuild123dExecutionProfileCatalog["initial"]>>,
  overrides: { readonly destruction?: "acknowledged-unattested" },
) {
  const outputs = await Promise.all(profile.outputManifest.map(async (declaration) => ({
    ...declaration,
    byteCount: STEP_BYTES.byteLength,
    sha256: await fingerprintResourceBytes(STEP_BYTES),
    casUri: `casys://isolated-output/sha256/${await fingerprintResourceBytes(
      STEP_BYTES,
    )}`,
    bytes: STEP_BYTES,
  })));
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    request.runId,
    request.producerGeneration,
    outputs.map(({ bytes: _bytes, ...output }) => output),
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: profile.runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs,
    destruction: overrides.destruction === "acknowledged-unattested"
      ? {
        status: "acknowledged-unattested" as const,
        runId: request.runId,
        acknowledgementFingerprint: {
          algorithm: "sha256" as const,
          digest: "d".repeat(64),
        },
      }
      : {
        status: "proven" as const,
        runId: request.runId,
        proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
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

async function predecessorRunIdFor(
  record: Awaited<ReturnType<typeof records>>["build123d"],
): Promise<string> {
  const host = observedHost();
  const sourceSha256 = await fingerprintResourceBytes(
    new TextEncoder().encode(BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_SOURCE),
  );
  return `build123d-isolated-worker-candidate-qualification-${
    (await sha256Fingerprint({
      schemaVersion: "build123d-isolated-worker-candidate-qualification-run/1.0",
      importRecordFingerprint:
        await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record),
      candidateReference: record.candidate.microsandbox.candidateReference,
      sourceSha256,
      observedHost: await fingerprintCapabilityRuntimeObservedHost(
        "linux/arm64",
        host.identityFingerprint,
      ),
    })).digest
  }`;
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
    build123d: await one(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID),
    geometry: await one(GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID),
  };
}
