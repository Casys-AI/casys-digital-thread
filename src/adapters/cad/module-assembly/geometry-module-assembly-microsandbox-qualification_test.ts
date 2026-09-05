import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
} from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import { FileIsolatedOutputCas } from "../../shared/cas/file-isolated-output-cas.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "../../control-plane/file-capability-runtime-qualification-attempt-store.ts";
import { FileCapabilityRuntimeQualificationAttestationStore } from "../../control-plane/file-capability-runtime-qualification-attestation-store.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import { fingerprintAtomicCapabilityRuntimeUnit } from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import { createLocalGeometryModuleAssemblyServerOptions } from "./first-party-geometry-module-assembly.ts";
import {
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCapture,
  FileGeometryModuleAssemblerMicrosandboxQualificationStore,
  GeometryModuleAssemblerQualificationService,
} from "./geometry-module-assembly-microsandbox-qualification.ts";
import {
  assertSameNormalisedTriangulatedGeometry,
  assertTwoBracketQualificationSemantics,
  exactFixtureOccurrenceMeshes,
} from "./geometry-module-assembly-qualification-oracle.ts";
import { FixedGeometryModuleAssemblyProfileCatalog } from "./fixed-geometry-module-assembly-profile.ts";

const ENCODER = new TextEncoder();
const QUALIFICATION_ASSEMBLY_STEP_FIXTURE = new URL(
  "./testdata/geometry-module-assembler-two-bracket.step",
  import.meta.url,
);
const QUALIFICATION_ASSEMBLY_STEP_FIXTURE_SHA256 =
  "cf603c631e4c33b088aa904d626518c334545078eb5c5ee7778f24344b2f4d81";

Deno.test("geometry-module qualification candidate binds the one exact Microsandbox-runtime atom", async () => {
  const candidate =
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidate();
  const [runtime] = candidate.materials;
  if (!runtime) throw new Error("candidate materials are incomplete");

  assertEquals(candidate.materials.map((material) => material.id), [
    "geometry-module-assembler-worker-image",
  ]);
  assertEquals(runtime.kind, "microvm-image");
  assertEquals(runtime.lifecycle, "ephemeral");
  assertEquals(runtime.imageReference, LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE);
  assertEquals(runtime.platforms, ["linux/arm64"]);
  assertEquals(runtime.launchGroup, null);
  assertEquals(runtime.effects.security, "reviewed");
  assertEquals(candidate.material, {
    unitId: "casys.geometry-module-assembler-worker",
    materialId: runtime.id,
    imageDigest: digestOf(runtime.imageReference),
  });
  assertEquals(
    candidate.unit.manifestFingerprint,
    await fingerprintAtomicCapabilityRuntimeUnit({
      id: candidate.unit.id,
      version: candidate.unit.version,
      materials: candidate.materials,
    }),
  );
});

Deno.test("geometry-module qualification OCCT tree requires one meshless container and two leaf meshes", () => {
  const exact = {
    name: "root",
    meshes: [],
    children: [{
      name: "COMPOUND",
      meshes: [],
      children: [
        { name: "qualification.left", meshes: [0], children: [] },
        { name: "qualification.right", meshes: [1], children: [] },
      ],
    }],
  };
  assertEquals(exactFixtureOccurrenceMeshes(exact, 2), [0, 1]);
  const adversaries = [
    {
      name: "root",
      meshes: [],
      children: [
        { name: "qualification.left", meshes: [0], children: [] },
        { name: "qualification.right", meshes: [1], children: [] },
      ],
    },
    {
      name: "root",
      meshes: [],
      children: [{
        name: "COMPOUND",
        meshes: [0],
        children: [
          { name: "qualification.left", meshes: [0], children: [] },
          { name: "qualification.right", meshes: [1], children: [] },
        ],
      }],
    },
    {
      name: "root",
      meshes: [],
      children: [{
        name: "COMPOUND",
        meshes: [],
        children: [
          {
            name: "qualification.left",
            meshes: [0],
            children: [{ name: "nested", meshes: [], children: [] }],
          },
          { name: "qualification.right", meshes: [0], children: [] },
        ],
      }],
    },
  ];
  for (const adversary of adversaries) {
    assertThrows(
      () => exactFixtureOccurrenceMeshes(adversary, 2),
      Error,
      "exact root/container/leaf topology",
    );
  }
});

Deno.test("geometry-module qualification rejects same-bounds vertex and connectivity impostors", () => {
  const bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 0 };
  const fixture = {
    positions: [
      0,
      0,
      0,
      1,
      0,
      0,
      1,
      1,
      0,
      0,
      1,
      0,
      0.5,
      0.5,
      0,
    ],
    indices: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
    bounds,
  };
  const sameBoundsWrongVertexCloud = {
    ...fixture,
    positions: [
      0,
      0,
      0,
      1,
      0,
      0,
      1,
      1,
      0,
      0,
      1,
      0,
      0.75,
      0.5,
      0,
    ],
  };
  const sameBoundsWrongConnectivity = {
    ...fixture,
    indices: [0, 1, 4, 0, 1, 2, 2, 3, 4, 3, 0, 4],
  };
  for (
    const impostor of [
      sameBoundsWrongVertexCloud,
      sameBoundsWrongConnectivity,
    ]
  ) {
    assertThrows(
      () => assertSameNormalisedTriangulatedGeometry(fixture, impostor),
      Error,
      "same bracket geometry",
    );
  }
});

Deno.test("geometry-module qualification candidate fingerprints the v3 absolute-placement oracle", async () => {
  const candidate =
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidate();
  assertEquals(
    candidate.specification.id,
    "build123d-module-assembler-arm64-native-v3-spec",
  );
  assertEquals(candidate.specification.version, "3.0.0");
});

Deno.test("geometry-module qualification uses the immutable two-bracket OCCT STEP fixture", async () => {
  assertEquals(
    await fingerprintResourceBytes(await twoBracketAssemblyStep()),
    QUALIFICATION_ASSEMBLY_STEP_FIXTURE_SHA256,
  );
});

Deno.test("geometry-module qualification binds the exact candidate, STEP/GLB CAS reread, and standard attestation", async () => {
  const fixture = await receiptFixture();
  try {
    const capture = await createGeometryModuleAssemblerMicrosandboxQualificationCapture(
      {
        candidate: fixture.candidate,
        qualifiedAt: "2026-08-31T00:00:00.000Z",
        observedHost: observedHost(),
        receipt: fixture.receipt,
        publishedReceipt: isolatedCodeExecutionReceiptRecord(fixture.receipt),
        outputBytes: fixture.outputBytes,
      },
    );

    assertEquals(capture.outcome.status, "qualified");
    assertEquals(
      capture.outcome.execution.receipt,
      isolatedCodeExecutionReceiptRecord(fixture.receipt),
    );
    assertEquals(
      capture.attestation.schemaVersion,
      "capability-runtime-binding-qualification-attestation/1.1",
    );
    assertEquals(capture.attestation.binding, fixture.candidate.binding);
    assertEquals(capture.attestation.profile, fixture.candidate.profile);
    assertEquals(capture.attestation.material, fixture.candidate.material);
    assertEquals(capture.attestation.unit, fixture.candidate.unit);
    assertEquals(capture.attestation.targetPlatform, "linux/arm64");
    assertEquals(capture.attestation.mode, "native");
    assertEquals(capture.attestation.qualificationSpec, {
      id: fixture.candidate.specification.id,
      fingerprint: fixture.candidate.specification.fingerprint,
    });

    const directory = await Deno.makeTempDir({
      prefix: "casys-geometry-module-qualification-",
    });
    try {
      const reference =
        await new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
          `${directory}/captures`,
        ).save(capture);
      assertEquals(
        reference.uri,
        `casys://geometry-module-assembler-microsandbox-qualification/sha256/${reference.fingerprint.digest}`,
      );
      assertEquals(
        (await Array.fromAsync(Deno.readDir(`${directory}/captures`))).length,
        1,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  } finally {
    await fixture.remove();
  }
});

Deno.test("geometry-module qualification rejects bytes that drift after the CAS reread", async () => {
  const fixture = await receiptFixture();
  try {
    await assertRejects(
      () =>
        createGeometryModuleAssemblerMicrosandboxQualificationCapture({
          candidate: fixture.candidate,
          qualifiedAt: "2026-08-31T00:00:00.000Z",
          observedHost: observedHost(),
          receipt: fixture.receipt,
          publishedReceipt: isolatedCodeExecutionReceiptRecord(fixture.receipt),
          outputBytes: fixture.outputBytes.map((output) => ({
            ...output,
            bytes: output.role === "assembly.glb"
              ? ENCODER.encode("changed after CAS publication")
              : output.bytes,
          })),
        }),
      TypeError,
      "drifted after CAS reread",
    );
  } finally {
    await fixture.remove();
  }
});

Deno.test("geometry-module qualification independently rejects malformed STEP and GLB publications", async () => {
  const invalidOutputs = [
    ["assembly.step", ENCODER.encode("not a STEP Part 21 file"), "invalid_step"],
    ["assembly.glb", ENCODER.encode("not a GLB container"), "invalid_glb"],
  ] as const;
  for (const [role, bytes, expected] of invalidOutputs) {
    const fixture = await receiptFixture({ [role]: bytes });
    try {
      await assertRejects(
        () =>
          createGeometryModuleAssemblerMicrosandboxQualificationCapture({
            candidate: fixture.candidate,
            qualifiedAt: "2026-08-31T00:00:00.000Z",
            observedHost: observedHost(),
            receipt: fixture.receipt,
            publishedReceipt: isolatedCodeExecutionReceiptRecord(fixture.receipt),
            outputBytes: fixture.outputBytes,
          }),
        Error,
        expected,
      );
    } finally {
      await fixture.remove();
    }
  }
});

Deno.test("geometry-module qualification rejects one child STEP and a meshless GLB", async () => {
  const cases = [
    [
      "assembly.step",
      await Deno.readFile("examples/bracket/bracket.step"),
      "two referenced bracket occurrences",
    ],
    ["assembly.glb", meshlessGlb(), "non-empty binary geometry scene"],
  ] as const;
  for (const [role, bytes, expected] of cases) {
    const fixture = await receiptFixture({ [role]: bytes });
    try {
      await assertRejects(
        () =>
          createGeometryModuleAssemblerMicrosandboxQualificationCapture({
            candidate: fixture.candidate,
            qualifiedAt: "2026-08-31T00:00:00.000Z",
            observedHost: observedHost(),
            receipt: fixture.receipt,
            publishedReceipt: isolatedCodeExecutionReceiptRecord(fixture.receipt),
            outputBytes: fixture.outputBytes,
          }),
        Error,
        expected,
      );
    } finally {
      await fixture.remove();
    }
  }
});

Deno.test("geometry-module qualification rejects nonsemantic STEP and GLB adversaries", async () => {
  const childStep = (
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidate()
  ).fixture.bundle.stepBytes[0]!.copy();
  const cases = [
    [
      await directRootThreeBracketAssemblyStep(),
      validGlb(),
      "exactly two referenced bracket occurrences",
    ],
    [
      await nonIdenticalTwoBracketAssemblyStep(),
      validGlb(),
      "same bracket geometry",
    ],
    [
      await identicalNonFixtureTwoBracketAssemblyStep(),
      validGlb(),
      "exact fixture bracket",
    ],
    [await twoBracketAssemblyStep(), zeroBinGlb(), "non-empty binary geometry scene"],
    [
      await twoBracketAssemblyStep(),
      outOfBoundsBufferViewGlb(),
      "non-empty binary geometry scene",
    ],
    [
      await twoBracketAssemblyStep(),
      outOfBoundsIndexAccessorGlb(),
      "non-empty binary geometry scene",
    ],
    [
      await twoBracketAssemblyStep(),
      nonFinitePositionGlb(),
      "non-empty binary geometry scene",
    ],
    [
      await twoBracketAssemblyStep(),
      degenerateTriangleGlb(),
      "non-empty binary geometry scene",
    ],
  ] as const;
  for (const [step, glb, expected] of cases) {
    await assertRejects(
      () => assertTwoBracketQualificationSemantics(childStep, step, glb),
      Error,
      expected,
    );
  }
});

Deno.test("geometry-module qualification rejects a common global translation that preserves the 80 mm separation", async () => {
  const childStep = (
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidate()
  ).fixture.bundle.stepBytes[0]!.copy();
  await assertRejects(
    async () =>
      assertTwoBracketQualificationSemantics(
        childStep,
        await globallyTranslatedTwoBracketAssemblyStep(),
        validGlb(),
      ),
    Error,
    "declared absolute bracket placements",
  );
});

Deno.test("geometry-module qualification persists one deterministic claim before dispatch and recovery never redispatches", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-service-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    let dispatches = 0;
    const runner = {
      async run(request: IsolatedCodeExecutionRequest) {
        dispatches += 1;
        return await publishValidReceipt(
          await validateIsolatedCodeExecutionRequest(request),
          publications,
          await profiles.initial(),
        );
      },
    };
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner,
      publications,
      recovery: {
        destroyByRunId: () => {
          throw new Error("Published qualification must not call cleanup.");
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(
        `${directory}/attempts`,
      ),
      attestations: new FileCapabilityRuntimeQualificationAttestationStore(
        `${directory}/attestations`,
      ),
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const applied = await service.apply();
    assertEquals(applied.status, "qualified");
    assertEquals(applied.phase, "attested");
    assertEquals(dispatches, 1);
    const recovered = await service.recover();
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.runId, applied.runId);
    assertEquals(recovered.capture, applied.capture);
    assertEquals(dispatches, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification quarantines a claimed missing publication without redispatch", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-recover-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    let dispatches = 0;
    let now = "2026-08-31T00:00:00.000Z";
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner: {
        run: () => {
          dispatches += 1;
          return Promise.reject(new Error("simulated interruption after WAL claim"));
        },
      },
      publications,
      recovery: {
        destroyByRunId(runId) {
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
          });
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(
        `${directory}/attempts`,
      ),
      attestations: new FileCapabilityRuntimeQualificationAttestationStore(
        `${directory}/attestations`,
      ),
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => now,
    });
    await assertRejects(() => service.apply(), Error, "failed closed");
    assertEquals(dispatches, 1);
    now = "2026-08-31T00:05:01.000Z";
    const recovered = await service.recover();
    assertEquals(recovered.status, "unavailable");
    assertEquals(recovered.phase, "stopped");
    await service.recover();
    assertEquals(dispatches, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification resumes a crash after unavailable outcome without redispatch", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-outcome-crash-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    const base = new FileCapabilityRuntimeQualificationAttemptStore(
      `${directory}/attempts`,
    );
    let crashAfterOutcome = true;
    const attempts = crashAfterUnavailableOutcome(base, () => crashAfterOutcome);
    let dispatches = 0;
    let destructions = 0;
    let now = "2026-08-31T00:00:00.000Z";
    const dependencies = {
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner: {
        run: () => {
          dispatches += 1;
          return Promise.reject(new Error("simulated interruption after WAL claim"));
        },
      },
      publications,
      recovery: {
        destroyByRunId(runId: string) {
          destructions += 1;
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: { algorithm: "sha256" as const, digest: "e".repeat(64) },
          });
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attestations: new FileCapabilityRuntimeQualificationAttestationStore(
        `${directory}/attestations`,
      ),
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => now,
    };
    const interrupted = new GeometryModuleAssemblerQualificationService({
      ...dependencies,
      attempts,
    });
    await assertRejects(() => interrupted.apply(), Error, "failed closed");
    now = "2026-08-31T00:05:01.000Z";
    await assertRejects(
      () => interrupted.recover(),
      Error,
      "simulated crash after unavailable outcome",
    );
    assertEquals(destructions, 1);

    crashAfterOutcome = false;
    const recovered = await new GeometryModuleAssemblerQualificationService({
      ...dependencies,
      attempts: base,
    }).recover();
    assertEquals(recovered.status, "unavailable");
    assertEquals(recovered.phase, "stopped");
    assertEquals(dispatches, 1);
    assertEquals(destructions, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification leaves an in-deadline runner claim pending without cleanup", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-pending-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let rejectRun!: (reason: Error) => void;
    const blockedRun = new Promise<never>((_resolve, reject) => {
      rejectRun = reject;
    });
    let destructions = 0;
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner: {
        run: () => {
          notifyStarted();
          return blockedRun;
        },
      },
      publications,
      recovery: {
        destroyByRunId(runId: string) {
          destructions += 1;
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
          });
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(
        `${directory}/attempts`,
      ),
      attestations: new FileCapabilityRuntimeQualificationAttestationStore(
        `${directory}/attestations`,
      ),
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const applying = service.apply();
    await started;
    const recovered = await service.recover();
    assertEquals(recovered.status, "pending");
    assertEquals(recovered.phase, "dispatching");
    assertEquals(destructions, 0);
    rejectRun(new Error("runner interrupted after pending recovery"));
    await assertRejects(() => applying, Error, "failed closed");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification seals an exact rejected publication with its receipt destruction proof", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-malformed-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    const attempts = new FileCapabilityRuntimeQualificationAttemptStore(
      `${directory}/attempts`,
    );
    const quarantines: string[] = [];
    let stoppedReceiptFingerprint: unknown;
    const spyAttempts: CapabilityRuntimeQualificationAttemptStore = {
      read: (key) => attempts.read(key),
      prepare: (identity, clock) => attempts.prepare(identity, clock),
      markActive: (identity, input) => attempts.markActive(identity, input),
      markCaseSubmitted: (identity, input) =>
        attempts.markCaseSubmitted(identity, input),
      claimDispatching: (identity, clock) => attempts.claimDispatching(identity, clock),
      markRecorded: (identity, input) => attempts.markRecorded(identity, input),
      sealDispatchDeadline: (identity) => attempts.sealDispatchDeadline(identity),
      markQuarantined: async (identity, input) => {
        quarantines.push(input.reason);
        return await attempts.markQuarantined(identity, input);
      },
      markOutcome: (identity, outcome) => attempts.markOutcome(identity, outcome),
      markStopped: (identity, input) => {
        stoppedReceiptFingerprint = (
          input.runtimeStopProof as { readonly receiptFingerprint?: unknown }
        ).receiptFingerprint;
        return attempts.markStopped(identity, input);
      },
      markAttested: (identity, input) => attempts.markAttested(identity, input),
    };
    let destructions = 0;
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner: {
        async run(request: IsolatedCodeExecutionRequest) {
          return await publishValidReceipt(
            await validateIsolatedCodeExecutionRequest(request),
            publications,
            await profiles.initial(),
            { "assembly.glb": zeroBinGlb() },
          );
        },
      },
      publications,
      recovery: {
        destroyByRunId(runId: string) {
          destructions += 1;
          return Promise.reject(
            new Error(`Published CAS result ${runId} must not be aborted.`),
          );
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: spyAttempts,
      attestations: new FileCapabilityRuntimeQualificationAttestationStore(
        `${directory}/attestations`,
      ),
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const result = await service.apply();
    assertEquals(result.status, "unavailable");
    assertEquals(result.phase, "stopped");
    assertEquals(quarantines, ["malformed"]);
    assertEquals(destructions, 0);
    assertEquals(stoppedReceiptFingerprint === null, false);
    assertEquals(typeof stoppedReceiptFingerprint, "object");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification quarantines a durable receipt with a mismatched source before it can become qualified", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-receipt-source-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    const attempts = new FileCapabilityRuntimeQualificationAttemptStore(
      `${directory}/attempts`,
    );
    const quarantines: string[] = [];
    const spyAttempts: CapabilityRuntimeQualificationAttemptStore = {
      read: (key) => attempts.read(key),
      prepare: (identity, clock) => attempts.prepare(identity, clock),
      markActive: (identity, input) => attempts.markActive(identity, input),
      markCaseSubmitted: (identity, input) =>
        attempts.markCaseSubmitted(identity, input),
      claimDispatching: (identity, clock) => attempts.claimDispatching(identity, clock),
      markRecorded: (identity, input) => attempts.markRecorded(identity, input),
      sealDispatchDeadline: (identity) => attempts.sealDispatchDeadline(identity),
      markQuarantined: async (identity, input) => {
        quarantines.push(input.reason);
        return await attempts.markQuarantined(identity, input);
      },
      markOutcome: (identity, outcome) => attempts.markOutcome(identity, outcome),
      markStopped: (identity, input) => attempts.markStopped(identity, input),
      markAttested: (identity, input) => attempts.markAttested(identity, input),
    };
    let cleanupCalls = 0;
    let now = "2026-08-31T00:00:00.000Z";
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner: {
        async run(request: IsolatedCodeExecutionRequest) {
          return await publishValidReceipt(
            await validateIsolatedCodeExecutionRequest(request),
            publications,
            await profiles.initial(),
            {},
            ENCODER.encode("different qualified source"),
          );
        },
      },
      publications,
      recovery: {
        destroyByRunId(runId: string) {
          cleanupCalls += 1;
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
          });
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: spyAttempts,
      attestations: new FileCapabilityRuntimeQualificationAttestationStore(
        `${directory}/attestations`,
      ),
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => now,
    });

    await assertRejects(
      () => service.apply(),
      Error,
      "registered execution context",
    );
    now = "2026-08-31T00:05:01.000Z";
    const recovered = await service.recover();
    assertEquals(recovered.status, "unavailable");
    assertEquals(recovered.phase, "stopped");
    assertEquals(quarantines, ["malformed"]);
    assertEquals(cleanupCalls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification revocation before dispatch keeps the runner untouched", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-revoked-before-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const attestations = new FileCapabilityRuntimeQualificationAttestationStore(
      `${directory}/attestations`,
    );
    await attestations.append(await revokedQualificationAttestation(candidate));
    let dispatches = 0;
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles: new FixedGeometryModuleAssemblyProfileCatalog(options.profile),
      runner: {
        run: () => {
          dispatches += 1;
          return Promise.reject(new Error("revoked qualification cannot dispatch"));
        },
      },
      publications: new FileIsolatedOutputCas(`${directory}/outputs`),
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("not used")),
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(
        `${directory}/attempts`,
      ),
      attestations,
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const result = await service.apply();
    assertEquals(result.status, "revoked");
    assertEquals(result.phase, "case-submitted");
    assertEquals(dispatches, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification rechecks a durable revocation after claiming dispatch and before runner.run", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({
      prefix: "geometry-module-qualification-revocation-race-",
    }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const attestations = new FileCapabilityRuntimeQualificationAttestationStore(
      `${directory}/attestations`,
    );
    let runnerCalls = 0;
    let cleanupCalls = 0;
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles: new FixedGeometryModuleAssemblyProfileCatalog(options.profile),
      runner: {
        run: () => {
          runnerCalls += 1;
          return Promise.reject(new Error("revoked qualification must not run"));
        },
      },
      publications: new FileIsolatedOutputCas(`${directory}/outputs`),
      recovery: {
        destroyByRunId(runId: string) {
          cleanupCalls += 1;
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: { algorithm: "sha256" as const, digest: "e".repeat(64) },
          });
        },
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(
        `${directory}/attempts`,
      ),
      attestations,
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      beforeDispatchClaim: async () => {
        await attestations.append(await revokedQualificationAttestation(candidate));
      },
      now: () => "2026-08-31T00:00:00.000Z",
    });

    const result = await service.apply();
    assertEquals(result.status, "revoked");
    assertEquals(result.phase, "stopped");
    assertEquals(runnerCalls, 0);
    assertEquals(cleanupCalls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry-module qualification recovery returns revoked after an attested scope is revoked", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-revoked-after-" }),
  );
  try {
    const [candidate, options] = await Promise.all([
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      createLocalGeometryModuleAssemblyServerOptions(),
    ]);
    const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
    const publications = new FileIsolatedOutputCas(`${directory}/outputs`);
    const attestations = new FileCapabilityRuntimeQualificationAttestationStore(
      `${directory}/attestations`,
    );
    const service = new GeometryModuleAssemblerQualificationService({
      candidate: () => Promise.resolve(candidate),
      observedHost: { read: () => Promise.resolve(observedHost()) },
      profiles,
      runner: {
        async run(request: IsolatedCodeExecutionRequest) {
          return await publishValidReceipt(
            await validateIsolatedCodeExecutionRequest(request),
            publications,
            await profiles.initial(),
          );
        },
      },
      publications,
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("not used")),
        advanceProducerGeneration: () => Promise.reject(new Error("not used")),
      },
      restartPublications: () => new FileIsolatedOutputCas(`${directory}/outputs`),
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(
        `${directory}/attempts`,
      ),
      attestations,
      captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      now: () => "2026-08-31T00:00:00.000Z",
    });
    assertEquals((await service.apply()).status, "qualified");
    await attestations.append(await revokedQualificationAttestation(candidate));
    const recovered = await service.recover();
    assertEquals(recovered.status, "revoked");
    assertEquals(recovered.phase, "stopped");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function receiptFixture(
  overrides: Partial<Record<"assembly.step" | "assembly.glb", Uint8Array>> = {},
) {
  const [candidate, options] = await Promise.all([
    createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
    createLocalGeometryModuleAssemblyServerOptions(),
  ]);
  const profile = await new FixedGeometryModuleAssemblyProfileCatalog(options.profile)
    .initial();
  const bytesByRole = new Map([
    ["assembly.glb", overrides["assembly.glb"] ?? validGlb()],
    [
      "assembly.step",
      overrides["assembly.step"] ??
        await twoBracketAssemblyStep(),
    ],
  ]);
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "geometry-module-qualification-cas-" }),
  );
  const cas = new FileIsolatedOutputCas(directory);
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: "isolated-code-execution-request/1.0",
    runId: "geometry-module-qualification-test-run",
    producerGeneration: 0,
    profile: profile.executionProfile,
    source: {
      bytes: candidate.fixture.bundle.bytes.copy(),
      sha256: candidate.fixture.bundle.fingerprint.digest,
    },
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
  });
  const outputMembers = await Promise.all(profile.outputManifest.map(
    async (declaration) => {
      const bytes = bytesByRole.get(declaration.role)!;
      const sha256 = await fingerprintResourceBytes(bytes);
      return {
        ...declaration,
        byteCount: bytes.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
        bytes,
      };
    },
  ));
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    request.runId,
    request.producerGeneration,
    outputMembers.map(({ bytes: _bytes, ...member }) => member),
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: profile.runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: outputMembers,
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
  const staged = await cas.stageBatch(
    outputMembers.map(({ casUri: _casUri, ...output }) => ({
      ...output,
      runId: request.runId,
      producerGeneration: request.producerGeneration,
    })),
  );
  await cas.commit(staged.batch, isolatedCodeExecutionReceiptRecord(receipt));
  const restarted = new FileIsolatedOutputCas(directory);
  const resolution = await restarted.resolvePublicationByRunId(request.runId, 0);
  if (resolution.status !== "published") {
    throw new Error("Expected a published output fixture.");
  }
  return {
    candidate,
    receipt,
    outputBytes: await Promise.all(
      isolatedCodeExecutionReceiptRecord(receipt).outputs.map(async (output) => {
        const bytes = await restarted.readPublishedObject(resolution.ref, output);
        if (!bytes) throw new Error(`Fixture output ${output.role} is absent.`);
        return { role: output.role, bytes };
      }),
    ),
    remove: () => Deno.remove(directory, { recursive: true }),
  };
}

function validGlb(): Uint8Array {
  return qualificationGlb(qualificationGlbDocument(), triangleBin());
}

function zeroBinGlb(): Uint8Array {
  return qualificationGlb(qualificationGlbDocument(), new Uint8Array());
}

function outOfBoundsBufferViewGlb(): Uint8Array {
  return qualificationGlb(
    {
      ...qualificationGlbDocument(),
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 40, byteLength: 6 },
      ],
    },
    triangleBin(),
  );
}

function outOfBoundsIndexAccessorGlb(): Uint8Array {
  return qualificationGlb(
    {
      ...qualificationGlbDocument(),
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 2 }] }],
    },
    triangleBin(),
  );
}

function nonFinitePositionGlb(): Uint8Array {
  return qualificationGlb(
    qualificationGlbDocument(),
    triangleBin([NaN, 0, 0, 1, 0, 0, 0, 1, 0]),
  );
}

function degenerateTriangleGlb(): Uint8Array {
  return qualificationGlb(
    qualificationGlbDocument(),
    triangleBin([0, 0, 0, 1, 0, 0, 2, 0, 0]),
  );
}

function qualificationGlbDocument(): Record<string, unknown> {
  return {
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
}

function triangleBin(
  positions = [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices = [0, 1, 2],
): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true));
  indices.forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  return bytes;
}

function qualificationGlb(
  document: Record<string, unknown>,
  bin: Uint8Array,
): Uint8Array {
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

function meshlessGlb(): Uint8Array {
  const json = ENCODER.encode(
    '{"asset":{"version":"2.0"},"buffers":[{"byteLength":4}]}',
  );
  const jsonPadded = padFour(json, 0x20);
  const bin = new Uint8Array(4);
  const bytes = new Uint8Array(12 + 8 + jsonPadded.length + 8 + bin.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonPadded, 20);
  const binOffset = 20 + jsonPadded.length;
  view.setUint32(binOffset, bin.length, true);
  view.setUint32(binOffset + 4, 0x004e4942, true);
  bytes.set(bin, binOffset + 8);
  return bytes;
}

async function twoBracketAssemblyStep(): Promise<Uint8Array> {
  return await Deno.readFile(QUALIFICATION_ASSEMBLY_STEP_FIXTURE);
}

/** Deliberately old/direct hierarchy adversary; never a positive fixture. */
async function directRootThreeBracketAssemblyStep(): Promise<Uint8Array> {
  const text = await Deno.readTextFile("examples/bracket/bracket.step");
  const [header, remainder] = text.split("DATA;\n", 2);
  if (header === undefined || remainder === undefined) {
    throw new Error("Qualification STEP fixture has no DATA section.");
  }
  const end = remainder.lastIndexOf("ENDSEC;");
  if (end < 0) throw new Error("Qualification STEP fixture has no DATA terminator.");
  const body = remainder.slice(0, end);
  const identifiers = [...body.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
  const offset = Math.max(...identifiers);
  const copies = Array.from(
    { length: 3 },
    (_value, occurrence) =>
      body.replace(/#(\d+)/g, (_whole, id) => `#${Number(id) + offset * occurrence}`)
        .replace(
          /CARTESIAN_POINT\('',\(([-+.0-9Ee]+),([-+.0-9Ee]+),([-+.0-9Ee]+)\)\)/g,
          (whole, x, y, z) =>
            Number(x) === 0 && Number(y) === 0 && Number(z) === 0
              ? whole
              : `CARTESIAN_POINT('',(${Number(x) + 80 * occurrence},${y},${z}))`,
        ),
  ).join("");
  return ENCODER.encode(
    `${header}DATA;\n${copies}ENDSEC;\nEND-ISO-10303-21;\n`,
  );
}

async function nonIdenticalTwoBracketAssemblyStep(): Promise<Uint8Array> {
  const source = new TextDecoder().decode(await twoBracketAssemblyStep());
  const changed = source.replace(
    "#814 = CARTESIAN_POINT('',(-30.,20.,50.));",
    "#814 = CARTESIAN_POINT('',(-29.,20.,50.));",
  );
  if (changed === source) {
    throw new Error("Qualification STEP mutation was not applied.");
  }
  return ENCODER.encode(changed);
}

async function identicalNonFixtureTwoBracketAssemblyStep(): Promise<Uint8Array> {
  const source = new TextDecoder().decode(await twoBracketAssemblyStep());
  const changed = source
    .replace(
      "#45 = CARTESIAN_POINT('',(-30.,20.,50.));",
      "#45 = CARTESIAN_POINT('',(-29.,20.,50.));",
    )
    .replace(
      "#814 = CARTESIAN_POINT('',(-30.,20.,50.));",
      "#814 = CARTESIAN_POINT('',(-29.,20.,50.));",
    );
  if (changed === source) {
    throw new Error("Qualification STEP fixture-mismatch mutation was not applied.");
  }
  return ENCODER.encode(changed);
}

function globallyTranslatedTwoBracketAssemblyStep(): Promise<Uint8Array> {
  return twoBracketAssemblyStep().then((bytes) => {
    const source = new TextDecoder().decode(bytes);
    const changed = source
      .replace(
        "#16 = CARTESIAN_POINT('',(0.,0.,0.));",
        "#16 = CARTESIAN_POINT('',(10.,0.,0.));",
      )
      .replace(
        "#20 = CARTESIAN_POINT('',(80.,0.,0.));",
        "#20 = CARTESIAN_POINT('',(90.,0.,0.));",
      );
    if (changed === source) {
      throw new Error("Qualification global-translation mutation was not applied.");
    }
    return ENCODER.encode(changed);
  });
}

function padFour(value: Uint8Array, fill: number): Uint8Array {
  const result = new Uint8Array(Math.ceil(value.length / 4) * 4);
  result.fill(fill);
  result.set(value);
  return result;
}

async function publishValidReceipt(
  request: Awaited<ReturnType<typeof validateIsolatedCodeExecutionRequest>>,
  cas: FileIsolatedOutputCas,
  profile: Awaited<ReturnType<FixedGeometryModuleAssemblyProfileCatalog["initial"]>>,
  overrides: Partial<Record<"assembly.step" | "assembly.glb", Uint8Array>> = {},
  receiptSourceBytes?: Uint8Array,
) {
  const bytesByRole = new Map([
    ["assembly.glb", overrides["assembly.glb"] ?? validGlb()],
    ["assembly.step", overrides["assembly.step"] ?? await twoBracketAssemblyStep()],
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
  const receiptRequest = receiptSourceBytes
    ? await validateIsolatedCodeExecutionRequest({
      schemaVersion: request.schemaVersion,
      runId: request.runId,
      producerGeneration: request.producerGeneration,
      profile: request.profile,
      source: {
        bytes: receiptSourceBytes,
        sha256: await fingerprintResourceBytes(receiptSourceBytes),
      },
      policy: request.policy,
      outputs: request.outputs,
    })
    : request;
  const receipt = await createIsolatedCodeExecutionReceipt({
    request: receiptRequest,
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

function observedHost() {
  return {
    schemaVersion: "capability-runtime-host-observation/1.0" as const,
    identityFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    platform: "linux/arm64" as const,
    images: [],
  };
}

function crashAfterUnavailableOutcome(
  base: CapabilityRuntimeQualificationAttemptStore,
  shouldCrash: () => boolean,
): CapabilityRuntimeQualificationAttemptStore {
  return {
    read: (key) => base.read(key),
    prepare: (identity, clock) => base.prepare(identity, clock),
    markActive: (identity, input) => base.markActive(identity, input),
    markCaseSubmitted: (identity, input) => base.markCaseSubmitted(identity, input),
    claimDispatching: (identity, clock) => base.claimDispatching(identity, clock),
    markRecorded: (identity, input) => base.markRecorded(identity, input),
    sealDispatchDeadline: (identity) => base.sealDispatchDeadline(identity),
    markQuarantined: (identity, input) => base.markQuarantined(identity, input),
    async markOutcome(identity, outcome) {
      const persisted = await base.markOutcome(identity, outcome);
      return persisted;
    },
    async markStopped(identity, input) {
      if (shouldCrash()) {
        throw new Error("simulated crash after unavailable outcome");
      }
      return await base.markStopped(identity, input);
    },
    markAttested: (identity, input) => base.markAttested(identity, input),
  };
}

async function revokedQualificationAttestation(
  candidate: Awaited<
    ReturnType<typeof createGeometryModuleAssemblerMicrosandboxQualificationCandidate>
  >,
) {
  const fixture = await receiptFixture();
  try {
    const capture = await createGeometryModuleAssemblerMicrosandboxQualificationCapture(
      {
        candidate,
        qualifiedAt: "2026-08-31T00:00:00.000Z",
        observedHost: observedHost(),
        receipt: fixture.receipt,
        publishedReceipt: isolatedCodeExecutionReceiptRecord(fixture.receipt),
        outputBytes: fixture.outputBytes,
      },
    );
    const body = {
      ...capture.attestation,
      state: "revoked" as const,
      recordedAt: "2026-08-31T00:00:01.000Z",
    };
    return await createCapabilityRuntimeBindingQualificationAttestation({
      ...body,
      fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
        body,
      ),
    });
  } finally {
    await fixture.remove();
  }
}

function digestOf(reference: string): string {
  return reference.slice(reference.lastIndexOf("@sha256:") + 8);
}
