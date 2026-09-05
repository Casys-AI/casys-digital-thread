import { assertEquals, assertRejects } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  CALCULIX_ISOLATED_REQUEST_SCHEMA,
  CALCULIX_ISOLATED_RESULT_SCHEMA,
  parseCalculixIsolatedInputBundle,
  validateCalculixIsolatedOutput,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { ExecuteIsolatedCalculixStaticProof } from "../../../application/use-cases/fea/isolated-v3/execute-isolated-calculix-static-proof.ts";
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
  CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  readObservedLinuxArm64Host,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { FileIsolatedOutputCas } from "../../shared/cas/file-isolated-output-cas.ts";
import { FileEngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR } from "./calculix-isolated-output-batch-inspector.ts";
import { FileCalculixIsolatedExecutionEvidenceStore } from "./calculix-isolated-execution-evidence.ts";
import { FileCalculixIsolatedExecutionAttemptStore } from "./file-calculix-isolated-execution-attempt-store.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "./fixed-calculix-isolated-execution-profile.ts";
import type { CalculixIsolatedExecutionComposition } from "./calculix-isolated-execution-composition.ts";
import {
  createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport,
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
} from "./local-calculix-isolated-execution-options.ts";
import {
  CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
  calculixWorkerCandidateQualificationPaths,
  createCalculixWorkerCandidateQualificationAttemptIdentity,
  createCalculixWorkerCandidateQualificationBundle,
  planCalculixWorkerCandidateQualification,
  qualifyCalculixWorkerCandidate,
  recoverCalculixWorkerCandidateQualification,
} from "./calculix-worker-candidate-qualification.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const BRACKET_STEP_FIXTURE = new URL(
  "../../../../examples/bracket/bracket.step",
  import.meta.url,
);

Deno.test("CalculiX candidate bundle reopens the exact code-owned bracket fixture", async () => {
  const expectedStep = await Deno.readFile(BRACKET_STEP_FIXTURE);
  const expectedStepSha256 = await fingerprintResourceBytes(expectedStep);
  const bundle = await createCalculixWorkerCandidateQualificationBundle();
  const proof = bundle.manifest.proof;
  assertEquals(bundle.stepBytes.copy(), expectedStep);
  assertEquals(bundle.manifest.step.byteCount, expectedStep.byteLength);
  assertEquals(bundle.manifest.step.sha256, expectedStepSha256);
  assertEquals(proof.expectedCadArtifact, {
    format: "step",
    sha256: expectedStepSha256,
    bytes: expectedStep.byteLength,
  });
  assertEquals(proof.analysis.mesh.targetSize, { value: 3, unit: "mm" });
  assertEquals(proof.analysis.supports, [{
    id: "root-fixed",
    kind: "fixed",
    selection: {
      name: "FIXED",
      box: { min: [-31, -21, -3.1], max: [31, 21, -2.4], unit: "mm" },
    },
  }]);
  assertEquals(proof.analysis.loads, [{
    id: "tip-load",
    kind: "force",
    selection: {
      name: "LOADED",
      box: { min: [-31, -21, 49.4], max: [-24, 21, 50.1], unit: "mm" },
    },
    force: { value: [0, 0, -500], unit: "N" },
  }]);
});

Deno.test("CalculiX candidate plan rejects the other physical image before composition", async () => {
  const { calculix, build123d } = await records();
  let composed = 0;
  const plan = await planCalculixWorkerCandidateQualification(calculix);
  assertEquals(plan.kind, "candidate-qualification");
  assertEquals(plan.mutation, false);
  assertEquals(plan.eligibleForPromotion, false);
  assertEquals(plan.runtimeQualification, "not-run");
  assertEquals(
    plan.candidateReference,
    calculix.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    plan.stateRoot,
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
      plan.importRecordFingerprint,
    ),
  );
  await assertRejects(
    () => planCalculixWorkerCandidateQualification(build123d),
    TypeError,
    "physicalImageId=calculix-worker",
  );
  await assertRejects(
    () =>
      qualifyCalculixWorkerCandidate(build123d, {
        observedHost: { read: () => Promise.resolve(observedHost()) },
        compose: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    TypeError,
    "physicalImageId=calculix-worker",
  );
  assertEquals(composed, 0);
});

Deno.test("tampered CalculiX candidate import records fail before composition", async () => {
  const { calculix } = await records();
  const tampered = JSON.parse(deterministicJson(calculix)) as Record<string, unknown>;
  const identities = tampered.identities as Record<string, unknown>;
  identities.microsandboxManifestDigest = `sha256:${"0".repeat(64)}`;
  tampered.identities = identities;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(tampered),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("CalculiX candidate qualification uses the bound reference, CAS reread, inspector and proven destruction", async () => {
  const { calculix } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-calculix-candidate-qualification-" }),
  );
  const activeRoot = `${directory}/active`;
  await Deno.mkdir(`${activeRoot}/calculix-isolated-execution-attempts`, {
    recursive: true,
  });
  await Deno.mkdir(`${activeRoot}/calculix-isolated-execution-evidence`, {
    recursive: true,
  });
  await Deno.mkdir(`${activeRoot}/capability-runtime-host`, { recursive: true });
  const calls = { compose: 0, run: 0, imageRemove: 0, composedImage: "" };
  const host = observedHost();
  let observedHostReads = 0;
  let nowCalls = 0;
  const startedAt = "2026-09-05T03:00:00.000Z";
  try {
    const result = await qualifyCalculixWorkerCandidate(calculix, {
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
      compose: async (options, paths) => {
        calls.compose += 1;
        calls.composedImage = options.profile.imageReference;
        return await fakeComposition(options.profile, paths, calls);
      },
    });
    assertEquals(calls.compose, 1);
    assertEquals(calls.run, 1);
    assertEquals(calls.imageRemove, 0);
    assertEquals(observedHostReads, 1);
    assertEquals(nowCalls, 1);
    assertEquals(
      calls.composedImage,
      calculix.candidate.microsandbox.candidateReference,
    );
    assertEquals(
      result.candidateReference,
      calculix.candidate.microsandbox.candidateReference,
    );
    assertEquals(
      pinnedOciImageReference(result.candidateReference, "$test"),
      pinnedOciImageReference(
        `casys/first-party-candidate-calculix-worker@${MICROSANDBOX_DIGEST}`,
        "$expected",
      ),
    );
    assertEquals(
      result.candidateReference === LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      false,
    );
    assertEquals(result.kind, "candidate-qualification");
    assertEquals(result.status, "passed");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.destruction, "proven");
    assertEquals(result.reread, "publication-gated");
    assertEquals(result.outputs.length, CALCULIX_ISOLATED_OUTPUT_MANIFEST.length);
    assertEquals(result.engineeringLevels, { l3: false, l4: false, l5: false });
    assertEquals(
      result.importRecordFingerprint,
      await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(calculix),
    );
    assertEquals(result.stateRoot, `${directory}/candidate`);
    assertEquals(
      await Deno.readTextFile(`${directory}/candidate/qualification.json`),
      `${deterministicJson(result.qualification)}\n`,
    );
    assertEquals(result.qualification.eligibleForPromotion, false);
    assertEquals(result.qualification.observedHost.platform, "linux/arm64");
    assertEquals(
      result.qualification.observedHost.identityFingerprint,
      host.identityFingerprint,
    );
    assertEquals(
      result.qualification.execution.runId.startsWith(
        "calculix-worker-candidate-qualification-",
      ),
      true,
    );
    assertEquals(
      result.qualification.execution.receiptFingerprint,
      result.receiptFingerprint,
    );
    assertEquals(result.identities.microsandboxManifestDigest, MICROSANDBOX_DIGEST);
    assertEquals(
      result.identities.ociIndexDigest === MICROSANDBOX_DIGEST,
      false,
    );
    assertEquals(
      result.identities.ociPlatformManifestDigest === MICROSANDBOX_DIGEST,
      false,
    );
    assertEquals(
      (await Deno.stat(`${directory}/candidate/attempts`)).isDirectory,
      true,
    );
    assertEquals((await Deno.stat(`${directory}/candidate/outputs`)).isDirectory, true);
    assertEquals(
      (await Deno.stat(`${directory}/candidate/evidence`)).isDirectory,
      true,
    );
    assertEquals((await Deno.stat(`${directory}/candidate/leases`)).isDirectory, true);
    assertEquals(
      (await Array.fromAsync(
        Deno.readDir(`${activeRoot}/calculix-isolated-execution-attempts`),
      ))
        .length,
      0,
    );
    assertEquals(
      (await Array.fromAsync(
        Deno.readDir(`${activeRoot}/calculix-isolated-execution-evidence`),
      ))
        .length,
      0,
    );
    assertEquals(
      (await Array.fromAsync(Deno.readDir(`${activeRoot}/capability-runtime-host`)))
        .length,
      0,
    );

    const paths = calculixWorkerCandidateQualificationPaths(
      `${directory}/candidate`,
    );
    const attempt = await new FileCalculixIsolatedExecutionAttemptStore(
      paths.attemptDirectory,
      paths.durabilitySyncBoundary,
    ).read(
      CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
      `calculix-worker-candidate-qualification-${
        result.importRecordFingerprint.replace(":", "-")
      }`,
    );
    if (!attempt || attempt.phase !== "evidence-captured") {
      throw new Error("Expected a durable CalculiX candidate evidence WAL.");
    }
    assertEquals(attempt.identity.startedAt, startedAt);
    assertEquals(attempt.evidence.executedAt, startedAt);

    const replayedRun = await qualifyCalculixWorkerCandidate(calculix, {
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
      compose: async (options, paths) =>
        await fakeComposition(options.profile, paths, calls),
    });
    assertEquals(calls.run, 1);
    assertEquals(nowCalls, 1);
    assertEquals(replayedRun.receiptFingerprint, result.receiptFingerprint);
    assertEquals(replayedRun.qualification, result.qualification);

    const replayed = await recoverCalculixWorkerCandidateQualification(calculix, {
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
      compose: async (options, paths) =>
        await fakeComposition(options.profile, paths, calls),
    });
    assertEquals(calls.run, 1);
    assertEquals(observedHostReads, 3);
    assertEquals(nowCalls, 1);
    assertEquals(replayed.receiptFingerprint, result.receiptFingerprint);
    assertEquals(replayed.qualification, result.qualification);
    assertEquals(replayed.eligibleForPromotion, false);
    assertEquals(replayed.engineeringLevels, { l3: false, l4: false, l5: false });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CalculiX candidate qualification refuses a non-linux/arm64 host before composition", async () => {
  const { calculix } = await records();
  let composed = 0;
  await assertRejects(
    () =>
      qualifyCalculixWorkerCandidate(calculix, {
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

Deno.test("CalculiX candidate recovery fails closed without WAL, unpublished or unknown publication", async () => {
  const { calculix } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-calculix-candidate-recover-" }),
  );
  const calls = { run: 0, imageRemove: 0 };
  let nowCalls = 0;
  try {
    await assertRejects(
      () =>
        recoverCalculixWorkerCandidateQualification(calculix, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          now: () => {
            nowCalls += 1;
            return "2026-09-05T06:00:00.000Z";
          },
          stateRoot: `${directory}/missing`,
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, calls),
        }),
      Error,
      "requires an existing WAL attempt",
    );
    assertEquals(calls.run, 0);
    assertEquals(nowCalls, 0);

    await seedDispatchingAttempt(calculix, `${directory}/unpublished`, observedHost());
    await assertRejects(
      () =>
        recoverCalculixWorkerCandidateQualification(calculix, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/unpublished`,
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, calls),
        }),
      Error,
      "unpublished; recovery does not redispatch",
    );
    assertEquals(calls.run, 0);

    await seedDispatchingAttempt(calculix, `${directory}/unknown`, observedHost());
    await assertRejects(
      () =>
        recoverCalculixWorkerCandidateQualification(calculix, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/unknown`,
          compose: async (options, paths) => {
            const composition = await fakeComposition(options.profile, paths, calls);
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
        }),
      Error,
      "outcome is unknown; no redispatch occurs",
    );
    assertEquals(calls.run, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CalculiX candidate qualification refuses a divergent durable record", async () => {
  const { calculix } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-calculix-candidate-divergent-" }),
  );
  const calls = { run: 0, imageRemove: 0 };
  try {
    await qualifyCalculixWorkerCandidate(calculix, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      compose: async (options, paths) =>
        await fakeComposition(options.profile, paths, calls),
    });
    const path = `${directory}/qualification.json`;
    const parsed = JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
    parsed.eligibleForPromotion = true;
    await Deno.writeTextFile(path, `${deterministicJson(parsed)}\n`);
    await assertRejects(
      () =>
        recoverCalculixWorkerCandidateQualification(calculix, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, calls),
        }),
      Error,
      "already occupies this import-record identity",
    );
    assertEquals(calls.run, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CalculiX candidate qualification source never deletes images or builds Docker", async () => {
  const source = await Deno.readTextFile(
    new URL("./calculix-worker-candidate-qualification.ts", import.meta.url),
  );
  assertEquals(source.includes("Image.remove"), false);
  assertEquals(source.includes("image remove"), false);
  assertEquals(source.includes("--keep-image"), false);
  assertEquals(source.includes("docker"), false);
  assertEquals(source.includes("buildx"), false);
  assertEquals(source.includes("Deno.build"), false);
  assertEquals(source.includes("desk-lamp-dl04"), false);
  assertEquals(source.includes("2026-01-01T00:00:00.000Z"), false);
  assertEquals(
    source.includes(CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID),
    true,
  );
});

async function seedDispatchingAttempt(
  record: Awaited<ReturnType<typeof records>>["calculix"],
  stateRoot: string,
  host: ReturnType<typeof observedHost>,
): Promise<void> {
  const paths = calculixWorkerCandidateQualificationPaths(stateRoot);
  const options =
    await createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport(
      record,
    );
  const profile = await new FixedCalculixIsolatedExecutionProfileCatalog(
    options.profile,
  ).initial();
  const observed = await readObservedLinuxArm64Host({
    read: () => Promise.resolve(host),
  });
  const bundle = await createCalculixWorkerCandidateQualificationBundle();
  const identity = await createCalculixWorkerCandidateQualificationAttemptIdentity(
    record,
    profile,
    observed.identity.fingerprint,
    bundle,
    "2026-09-05T03:00:00.000Z",
  );
  const attempts = new FileCalculixIsolatedExecutionAttemptStore(
    paths.attemptDirectory,
    paths.durabilitySyncBoundary,
  );
  const prepared = await attempts.prepare(identity);
  await attempts.markDispatching({
    projectId: prepared.projectId,
    agentRunId: prepared.agentRunId,
    executionRunId: prepared.executionRunId,
    attemptFingerprint: prepared.attemptFingerprint,
    dispatchedAt: identity.startedAt,
  });
}

async function fakeComposition(
  options: ConstructorParameters<
    typeof FixedCalculixIsolatedExecutionProfileCatalog
  >[0],
  paths: {
    readonly outputCasDirectory: string;
    readonly attemptDirectory: string;
    readonly evidenceDirectory: string;
    readonly leaseDirectory: string;
    readonly durabilitySyncBoundary?: string;
  },
  calls: { run?: number; imageRemove: number },
): Promise<CalculixIsolatedExecutionComposition> {
  const profiles = new FixedCalculixIsolatedExecutionProfileCatalog(options);
  await profiles.initial();
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const attempts = new FileCalculixIsolatedExecutionAttemptStore(
    paths.attemptDirectory,
    paths.durabilitySyncBoundary,
  );
  const evidence = new FileCalculixIsolatedExecutionEvidenceStore(
    paths.evidenceDirectory,
    paths.durabilitySyncBoundary,
  );
  const runner = {
    async run(request: IsolatedCodeExecutionRequest) {
      calls.run = (calls.run ?? 0) + 1;
      const validated = await validateIsolatedCodeExecutionRequest(request);
      const bundle = await parseCalculixIsolatedInputBundle(
        validated.source.bytes.copy(),
      );
      const profile = await profiles.initial();
      return await publishReceipt(validated, publications, profile, bundle);
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
  const execute = new ExecuteIsolatedCalculixStaticProof({
    runner,
    recovery: runner,
    publications,
    lease: new FileEngineeringProjectRunLease(paths.leaseDirectory),
    attempts,
    evidence,
    inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
  });
  return {
    profiles,
    execution: {
      runner,
      recovery: runner,
      publications,
      evidence,
      execute,
    },
  };
}

async function publishReceipt(
  request: Awaited<ReturnType<typeof validateIsolatedCodeExecutionRequest>>,
  cas: FileIsolatedOutputCas,
  profile: Awaited<ReturnType<FixedCalculixIsolatedExecutionProfileCatalog["initial"]>>,
  bundle: Awaited<ReturnType<typeof parseCalculixIsolatedInputBundle>>,
) {
  const outputBytes = outputFixture(bundle);
  const outputs = await Promise.all(profile.outputManifest.map(async (declaration) => {
    const bytes = outputBytes.get(declaration.role)!;
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
    runtime: profile.runtime,
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

function outputFixture(
  bundle: Awaited<ReturnType<typeof parseCalculixIsolatedInputBundle>>,
) {
  const proof = bundle.manifest.proof;
  const selections = [
    ...proof.analysis.supports.map((item) => item.selection.name),
    ...proof.analysis.loads.map((item) => item.selection.name),
  ];
  const nodesPerSelection = Object.fromEntries(
    selections.map((name) => [name, 1]),
  );
  const meshInp = [
    "*NODE",
    "1,0,0,0",
    "2,1,0,0",
    "*ELEMENT,TYPE=C3D4,ELSET=PART",
    "1,1,2,1,2",
    "*NSET,NSET=FIXED",
    "1",
    "*NSET,NSET=LOADED",
    "2",
    "",
  ].join("\n");
  const inspected = CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR.inspectMesh(meshInp);
  const meshGeo = CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR.buildMeshScript({
    stepPath: "input.step",
    selections: [
      ...proof.analysis.supports,
      ...proof.analysis.loads,
    ].map((item) => ({
      name: item.selection.name,
      box: { min: item.selection.box.min, max: item.selection.box.max },
    })),
    meshSizeMm: proof.analysis.mesh.targetSize.value,
    elementOrder: bundle.manifest.effective.elementOrder,
    timeoutMs: bundle.manifest.effective.timeoutMs,
  });
  const jobInp = CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR.buildDeck({
    inpText: meshInp,
    maxNodeId: inspected.maxNodeId,
    material: {
      eMpa: proof.analysis.material.youngModulus.value,
      nu: proof.analysis.material.poissonRatio.value,
    },
    fixed: proof.analysis.supports.map((item) => item.selection.name),
    loads: proof.analysis.loads.map((item) => ({
      selection: item.selection.name,
      totalForceN: item.force.value,
    })),
    nodesPerSet: inspected.nodesPerSet,
  });
  const jobDat = [
    " displacements",
    "2 0 0 -0.1",
    " stresses",
    "1 1 2 0 0 0 0 0",
    "",
  ].join("\n");
  const text = (value: string) => new TextEncoder().encode(value);
  const values = new Map<string, Uint8Array>([
    ["input.step", bundle.stepBytes.copy()],
    [
      "request.json",
      text(deterministicJson({
        schemaVersion: CALCULIX_ISOLATED_REQUEST_SCHEMA,
        requestId: bundle.manifest.requestId,
        proofFingerprint: bundle.manifest.proofFingerprint,
        effective: bundle.manifest.effective,
        step: bundle.manifest.step,
      })),
    ],
    ["mesh.geo", text(meshGeo)],
    ["mesh.inp", text(meshInp)],
    ["gmsh.log", text("gmsh passed\n")],
    ["job.inp", text(jobInp)],
    ["ccx.log", text("ccx passed\n")],
    ["job.dat", text(jobDat)],
    [
      "result.json",
      text(deterministicJson({
        schemaVersion: CALCULIX_ISOLATED_RESULT_SCHEMA,
        requestId: bundle.manifest.requestId,
        executionIdentity: {
          schemaVersion: "1.0",
          profile: { id: "calculix-static-proof-v1", version: "1.0.0" },
          wrapper: { id: "calculix-static-proof-v1", version: "1.0.0" },
          lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
          engines: {
            gmsh: { command: "gmsh", version: "4.12.1" },
            ccx: { command: "ccx", version: "This is Version 2.21" },
          },
          image: { status: "bound-by-isolated-runner-receipt" },
        },
        inputArtifact: {
          mediaType: "model/step",
          byteCount: bundle.manifest.step.byteCount,
          sha256: bundle.manifest.step.sha256,
        },
        mesh: { nodes: 2, elements: 1, nodesPerSelection },
        constraints: {
          fixedSelections: proof.analysis.supports.map((item) => item.selection.name),
          loads: proof.analysis.loads.map((item) => ({
            selection: item.selection.name,
            forceN: item.force.value,
          })),
        },
        metrics: {
          maximumDisplacement: {
            value: 0.1,
            unit: "mm",
            nodeId: 2,
            vectorMm: [0, 0, -0.1],
          },
          maximumVonMises: {
            value: 2,
            unit: "MPa",
            elementId: 1,
          },
        },
      })),
    ],
  ]);
  for (const declaration of CALCULIX_ISOLATED_OUTPUT_MANIFEST) {
    validateCalculixIsolatedOutput(declaration, values.get(declaration.role)!);
  }
  return values;
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
    calculix: await one(CALCULIX_WORKER_PHYSICAL_IMAGE_ID),
    build123d: await one(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID),
  };
}
