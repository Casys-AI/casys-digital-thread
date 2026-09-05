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
import { createFirstPartyCapabilityRuntimeCatalog } from "../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { buildFirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import {
  BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  parseFirstPartyMicrosandboxImageCandidateQualificationRecord,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { FileIsolatedOutputCas } from "../../shared/cas/file-isolated-output-cas.ts";
import { LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import { createGeometryModuleAssemblyServerOptionsForBoundCandidateImport } from "./first-party-geometry-module-assembly.ts";
import { FixedGeometryModuleAssemblyProfileCatalog } from "./fixed-geometry-module-assembly-profile.ts";
import {
  assertExactGeometryModuleAssemblerQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport,
  createGeometryModuleAssemblerMicrosandboxQualificationCapture,
} from "./geometry-module-assembly-microsandbox-qualification.ts";
import { readFirstPartyMicrosandboxImageCandidateQualificationSuccessor } from "../../control-plane/first-party-microsandbox-image-candidate-qualification-successor.ts";
import {
  applyGeometryModuleAssemblerWorkerCandidateQualification,
  geometryCandidateRuntimeQualification,
  planGeometryModuleAssemblerWorkerCandidateQualification,
  retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure,
} from "./geometry-module-assembler-worker-candidate-qualification.ts";
import type { GeometryModuleAssemblyComposition } from "./geometry-module-assembly-composition.ts";

const ENCODER = new TextEncoder();
const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const QUALIFICATION_ASSEMBLY_STEP_FIXTURE = new URL(
  "./testdata/geometry-module-assembler-two-bracket.step",
  import.meta.url,
);

Deno.test("geometry candidate plan rejects the other CAD image before composition", async () => {
  const { geometry, build123d } = await records();
  let composed = 0;
  const plan = await planGeometryModuleAssemblerWorkerCandidateQualification(
    geometry,
  );
  assertEquals(plan.kind, "candidate-qualification");
  assertEquals(plan.eligibleForPromotion, false);
  assertEquals(
    plan.candidateReference,
    geometry.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    plan.stateRoot,
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
      plan.importRecordFingerprint,
    ),
  );
  await assertRejects(
    () => planGeometryModuleAssemblerWorkerCandidateQualification(build123d),
    TypeError,
    "physicalImageId=geometry-module-assembler-worker",
  );
  await assertRejects(
    () =>
      applyGeometryModuleAssemblerWorkerCandidateQualification(build123d, {
        observedHost: { read: () => Promise.resolve(observedHost()) },
        compose: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    TypeError,
    "physicalImageId=geometry-module-assembler-worker",
  );
  assertEquals(composed, 0);
  await assertRejects(
    () => createGeometryModuleAssemblyServerOptionsForBoundCandidateImport(build123d),
    TypeError,
    "physicalImageId=geometry-module-assembler-worker",
  );
});

Deno.test("active and imported geometry qualification authorities cannot substitute", async () => {
  const { geometry } = await records();
  const active =
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidate();
  const imported =
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport(
      geometry,
    );
  assertEquals(
    imported.image.manifestDigest,
    geometry.identities.microsandboxManifestDigest,
  );
  assertEquals(
    imported.image.reference,
    pinnedOciImageReference(
      geometry.candidate.microsandbox.candidateReference,
      "$imported",
    ),
  );
  assertEquals(
    imported.image.reference === LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
    false,
  );
  await assertRejects(
    () => assertExactGeometryModuleAssemblerQualificationCandidate(imported),
    TypeError,
    "qualification candidate drifted",
  );
  await assertRejects(
    () => assertExactGeometryModuleAssemblerQualificationCandidate(active, imported),
    TypeError,
    "qualification candidate drifted",
  );
  const expected =
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport(
      geometry,
    );
  const exact = await assertExactGeometryModuleAssemblerQualificationCandidate(
    imported,
    expected,
  );
  assertEquals(exact.image.manifestDigest, imported.image.manifestDigest);
});

Deno.test("geometry candidate capture refuses an active-pin authority", async () => {
  const { geometry } = await records();
  const imported =
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport(
      geometry,
    );
  await assertRejects(
    () =>
      createGeometryModuleAssemblerMicrosandboxQualificationCapture({
        candidate: imported,
        qualifiedAt: "2026-08-31T00:00:00.000Z",
        observedHost: observedHost(),
        receipt: {} as never,
        publishedReceipt: {} as never,
        outputBytes: [],
      }),
    TypeError,
    "qualification candidate drifted",
  );
});

Deno.test("geometry candidate qualification writes only the candidate-specific root", async () => {
  const { geometry } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-geometry-candidate-qualification-" }),
  );
  const hostRoot = `${directory}/capability-runtime-host`;
  await Deno.mkdir(hostRoot);
  let composedImage = "";
  let observedHostReads = 0;
  const observedHostSnapshot = observedHost();
  try {
    const result = await applyGeometryModuleAssemblerWorkerCandidateQualification(
      geometry,
      {
        observedHost: {
          read: () => {
            observedHostReads += 1;
            return Promise.resolve(observedHostSnapshot);
          },
        },
        stateRoot: `${directory}/candidate`,
        compose: async (options, paths) => {
          composedImage = options.profile.imageReference;
          return await fakeComposition(options.profile, paths);
        },
      },
    );
    assertEquals(
      composedImage,
      geometry.candidate.microsandbox.candidateReference,
    );
    assertEquals(result.kind, "candidate-qualification");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.result.status, "qualified");
    assertEquals(result.runtimeQualification, "passed");
    assertEquals(result.engineeringLevels, { l3: false, l4: false, l5: false });
    assertEquals(observedHostReads, 1);
    assertEquals(result.qualification?.observedHost.platform, "linux/arm64");
    assertEquals(
      result.qualification?.observedHost.identityFingerprint,
      observedHostSnapshot.identityFingerprint,
    );
    assertEquals(
      result.qualification?.execution.runId,
      result.result.runId,
    );
    assertEquals(
      result.qualification?.execution.receiptFingerprint,
      result.result.receiptFingerprint,
    );
    assertEquals(result.stateRoot, `${directory}/candidate`);
    assertEquals(
      (await Deno.stat(`${directory}/candidate/qualification.json`)).isFile,
      true,
    );
    const persisted =
      await parseFirstPartyMicrosandboxImageCandidateQualificationRecord(
        JSON.parse(
          await Deno.readTextFile(`${directory}/candidate/qualification.json`),
        ),
      );
    assertEquals(
      persisted.observedHost.identityFingerprint,
      observedHostSnapshot.identityFingerprint,
    );
    assertEquals(
      (await Deno.stat(`${directory}/candidate/attempts`)).isDirectory,
      true,
    );
    assertEquals(
      (await Deno.stat(`${directory}/candidate/captures`)).isDirectory,
      true,
    );
    assertEquals(
      (await Deno.stat(`${directory}/candidate/outputs`)).isDirectory,
      true,
    );
    assertEquals((await Array.fromAsync(Deno.readDir(hostRoot))).length, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry candidate apply/recover preserves literal qualification statuses", () => {
  assertEquals(geometryCandidateRuntimeQualification("qualified"), "passed");
  assertEquals(geometryCandidateRuntimeQualification("unavailable"), "unavailable");
  assertEquals(geometryCandidateRuntimeQualification("pending"), "pending");
  assertEquals(geometryCandidateRuntimeQualification("revoked"), "revoked");
});

Deno.test("geometry candidate qualification refuses a non-linux/arm64 host before composition", async () => {
  const { geometry } = await records();
  let composed = 0;
  await assertRejects(
    () =>
      applyGeometryModuleAssemblerWorkerCandidateQualification(geometry, {
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

Deno.test("geometry successor dispatches a distinct run from a dispatched not-published predecessor", async () => {
  const { geometry } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-geometry-candidate-successor-" }),
  );
  const calls = { runIds: [] as string[] };
  try {
    await seedDispatching(geometry, `${directory}/candidate`, calls);
    const predecessorFiles = await snapshot(`${directory}/candidate/attempts`);
    const result =
      await retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
        geometry,
        {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/candidate`,
          compose: async (options, paths) =>
            fakeComposition(options.profile, paths, calls),
        },
      );
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.runtimeQualification, "passed");
    assertEquals(result.result.status, "qualified");
    assertEquals(calls.runIds.length >= 2, true);
    assertEquals(calls.runIds[0] === calls.runIds.at(-1), false);
    assertEquals(result.result.runId, calls.runIds.at(-1));
    const successor =
      await readFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
        `${directory}/candidate`,
      );
    assertEquals(successor?.predecessor.ordinal, 0);
    assertEquals(successor?.successor.ordinal, 1);
    assertEquals(successor?.predecessor.attempts[0]?.producerGeneration, 0);
    assertEquals(successor?.successor.attempts[0]?.producerGeneration, 0);
    assertEquals(successor?.predecessor.attempts[0]?.publication, "not-published");
    assertEquals(successor?.predecessor.attempts[0]?.destruction.status, "proven");
    assertEquals(successor?.successor.attempts[0]?.runId, result.result.runId);
    assertEquals(successor?.eligibleForPromotion, false);
    assertEquals(
      await snapshot(`${directory}/candidate/attempts`),
      predecessorFiles,
    );
    await assertRejects(
      () =>
        retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
          geometry,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/candidate`,
            compose: async (options, paths) =>
              fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "already consumed this predecessor",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry successor refuses missing, prepared, published and unknown predecessors", async () => {
  const { geometry } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-geometry-candidate-successor-refuse-" }),
  );
  const calls = { runIds: [] as string[] };
  try {
    await assertRejects(
      () =>
        retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
          geometry,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/missing`,
            compose: async (options, paths) =>
              fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "existing producerGeneration-0 predecessor",
    );

    await seedDispatching(geometry, `${directory}/prepared`, calls);
    await keepOnlyPrepared(`${directory}/prepared/attempts`);
    await assertRejects(
      () =>
        retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
          geometry,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/prepared`,
            compose: async (options, paths) =>
              fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "prepared-only",
    );

    await applyGeometryModuleAssemblerWorkerCandidateQualification(geometry, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: `${directory}/published`,
      compose: async (options, paths) => fakeComposition(options.profile, paths, calls),
    });
    await assertRejects(
      () =>
        retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
          geometry,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/published`,
            compose: async (options, paths) =>
              fakeComposition(options.profile, paths, calls),
          },
        ),
      Error,
      "already-successful",
    );

    await seedDispatching(geometry, `${directory}/unknown`, calls);
    await assertRejects(
      () =>
        retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
          geometry,
          {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot: `${directory}/unknown`,
            compose: async (options, paths) => {
              const composition = fakeComposition(options.profile, paths, calls);
              return {
                ...composition,
                execution: {
                  ...composition.execution!,
                  publications: {
                    resolvePublicationByRunId: (
                      runId: string,
                      producerGeneration: 0 | 1,
                    ) =>
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
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry candidate qualification source never deletes images", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "./geometry-module-assembler-worker-candidate-qualification.ts",
      import.meta.url,
    ),
  );
  assertEquals(source.includes("Image.remove"), false);
  assertEquals(source.includes("image remove"), false);
  assertEquals(source.includes("--keep-image"), false);
  assertEquals(source.includes("Deno.build"), false);
});

async function seedDispatching(
  record: Awaited<ReturnType<typeof records>>["geometry"],
  stateRoot: string,
  calls: { runIds: string[] },
): Promise<void> {
  let fail = true;
  await assertRejects(
    () =>
      applyGeometryModuleAssemblerWorkerCandidateQualification(record, {
        observedHost: { read: () => Promise.resolve(observedHost()) },
        stateRoot,
        compose: async (options, paths) =>
          fakeComposition(options.profile, paths, calls, {
            run: async (_request, publish) => {
              if (fail) {
                fail = false;
                throw new Error("ephemeral execution environment could not be created");
              }
              return await publish();
            },
          }),
      }),
    Error,
    "The registered geometry-module assembler failed closed.",
  );
}

async function keepOnlyPrepared(attemptsRoot: string): Promise<void> {
  for await (const group of Deno.readDir(attemptsRoot)) {
    if (!group.isDirectory) continue;
    const directory = `${attemptsRoot}/${group.name}`;
    for await (const entry of Deno.readDir(directory)) {
      if (
        entry.name.startsWith("event-prepared-") ||
        entry.name === "attempt.lock"
      ) continue;
      await Deno.remove(`${directory}/${entry.name}`);
    }
  }
}

async function snapshot(directory: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(current));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!entry.isFile) continue;
      files.push(`${path}\n${await Deno.readTextFile(path)}`);
    }
  }
  await walk(directory);
  return files.join("\n");
}

function fakeComposition(
  profileOptions: ConstructorParameters<
    typeof FixedGeometryModuleAssemblyProfileCatalog
  >[0],
  paths: { readonly outputCasDirectory: string },
  calls: { runIds?: string[] } = {},
  hooks: {
    readonly run?: (
      request: IsolatedCodeExecutionRequest,
      publish: () => Promise<
        Awaited<ReturnType<typeof publishValidReceipt>>
      >,
    ) => Promise<Awaited<ReturnType<typeof publishValidReceipt>>>;
  } = {},
): GeometryModuleAssemblyComposition {
  const profiles = new FixedGeometryModuleAssemblyProfileCatalog(profileOptions);
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const runner = {
    async run(request: IsolatedCodeExecutionRequest) {
      calls.runIds?.push(request.runId);
      const publish = async () =>
        await publishValidReceipt(
          await validateIsolatedCodeExecutionRequest(request),
          publications,
          await profiles.initial(),
        );
      return hooks.run ? await hooks.run(request, publish) : await publish();
    },
    destroyByRunId(runId: string) {
      return Promise.resolve({
        status: "proven" as const,
        runId,
        proofFingerprint: { algorithm: "sha256" as const, digest: "e".repeat(64) },
      });
    },
    advanceProducerGeneration: () => Promise.reject(new Error("not used")),
  };
  return {
    profiles,
    execution: {
      runner,
      recovery: runner,
      publications,
    },
  };
}

async function publishValidReceipt(
  request: Awaited<ReturnType<typeof validateIsolatedCodeExecutionRequest>>,
  cas: FileIsolatedOutputCas,
  profile: Awaited<ReturnType<FixedGeometryModuleAssemblyProfileCatalog["initial"]>>,
) {
  const bytesByRole = new Map([
    ["assembly.glb", validGlb()],
    ["assembly.step", await Deno.readFile(QUALIFICATION_ASSEMBLY_STEP_FIXTURE)],
  ]);
  const outputs = await Promise.all(profile.outputManifest.map(async (declaration) => {
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

function validGlb(): Uint8Array {
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 42 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const indices = [0, 1, 2];
  const bin = new Uint8Array(44);
  const binView = new DataView(bin.buffer);
  positions.forEach((value, index) => binView.setFloat32(index * 4, value, true));
  indices.forEach((value, index) => binView.setUint16(36 + index * 2, value, true));
  const json = padFour(ENCODER.encode(JSON.stringify(document)), 0x20);
  const bytes = new Uint8Array(12 + 8 + json.length + 8 + bin.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  const binOffset = 20 + json.length;
  view.setUint32(binOffset, bin.length, true);
  view.setUint32(binOffset + 4, 0x004e4942, true);
  bytes.set(bin, binOffset + 8);
  return bytes;
}

function padFour(value: Uint8Array, fill: number): Uint8Array {
  const result = new Uint8Array(Math.ceil(value.length / 4) * 4);
  result.fill(fill);
  result.set(value);
  return result;
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
    geometry: await one(GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID),
    build123d: await one(BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID),
  };
}
