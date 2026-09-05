import { assertEquals, assertRejects } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeRuntimeAttestation,
  validateIsolatedCodeExecutionRequest,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import { pinnedOciImageReference } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  SPICE_ADMITTED_MAX_OBSERVABLES,
  SPICE_ADMITTED_MAX_RESULT_BYTES,
  SPICE_ADMITTED_MAX_SOURCE_BYTES,
  SPICE_ADMITTED_MAX_VECTOR_BYTES,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  SPICE_ISOLATED_EVIDENCE_SCHEMA,
  SPICE_OPERATING_POINT_EXPORT,
  SPICE_OPERATING_POINT_RESULT_SCHEMA,
  SPICE_OPERATING_POINT_SIGN_CONVENTION,
  SPICE_OPERATING_POINT_WRAPPER,
} from "../../../../domain/electrical/spice/admitted/contract.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../../control-plane/first-party-capability-binding-catalog.ts";
import { buildFirstPartyMicrosandboxImageCandidateReceipt } from "../../../control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateImportRecord,
  parseFirstPartyMicrosandboxImageCandidateImportRecord,
} from "../../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT,
} from "../../../control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import {
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
} from "../../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { FileIsolatedOutputCas } from "../../../shared/cas/file-isolated-output-cas.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { AdmittedSpiceExecutionComposition } from "./execution-composition.ts";
import { FixedAdmittedSpiceExecutionProfileCatalog } from "./execution-profile-catalog.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./local-image-references.ts";
import { FileNgspiceWorkerCandidateAttemptStore } from "./ngspice-worker-candidate-attempt-store.ts";
import {
  NGSPICE_ADMITTED_CIRCUIT_BINDING_ID,
  NGSPICE_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID,
  ngspiceWorkerCandidateQualificationPaths,
  type NgspiceWorkerCandidateQualificationPorts,
  parseNgspiceWorkerCandidateProof,
  planNgspiceWorkerCandidateQualification,
  qualifyNgspiceWorkerCandidate,
  readNgspiceWorkerCandidateQualificationSource,
  recoverNgspiceWorkerCandidateQualification,
} from "./ngspice-worker-candidate-qualification.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const ENCODER = new TextEncoder();
const DIVIDER_OBSERVABLES = [
  {
    nativeName: "@r1[i]",
    kind: "branch-current",
    sourceSymbol: "R1",
    value: 0.0025,
    unit: "A",
  },
  {
    nativeName: "@r2[i]",
    kind: "branch-current",
    sourceSymbol: "R2",
    value: 0.0025,
    unit: "A",
  },
  {
    nativeName: "i(vin)",
    kind: "branch-current",
    sourceSymbol: "Vin",
    value: -0.0025,
    unit: "A",
  },
  {
    nativeName: "v(in)",
    kind: "node-voltage",
    sourceSymbol: "in",
    value: 5,
    unit: "V",
  },
  {
    nativeName: "v(out)",
    kind: "node-voltage",
    sourceSymbol: "out",
    value: 2.5,
    unit: "V",
  },
] as const;

Deno.test("current matrix remains five physical / five logical with one ngspice target", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  assertEquals(matrix.contract, FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT);
  assertEquals(matrix.images.length, 5);
  assertEquals(
    matrix.images.reduce((count, image) => count + image.logicalTargets.length, 0),
    5,
  );
  const ngspice = matrix.images.filter((image) =>
    image.physicalImageId === NGSPICE_WORKER_PHYSICAL_IMAGE_ID
  );
  assertEquals(ngspice.length, 1);
  assertEquals(ngspice[0]!.logicalTargets.length, 1);
  assertEquals(ngspice[0]!.logicalTargets[0]!.unitId, "casys.spice-worker");
  assertEquals(ngspice[0]!.logicalTargets[0]!.materialId, "ngspice-runtime-image");
});

Deno.test("ngspice candidate plan is non-mutating, record-bound and names the resistor-divider fixture", async () => {
  const { ngspice, modelica } = await records();
  let composed = 0;
  let hostReads = 0;
  const plan = await planNgspiceWorkerCandidateQualification(ngspice);
  assertEquals(plan.kind, "candidate-qualification");
  assertEquals(plan.mutation, false);
  assertEquals(plan.eligibleForPromotion, false);
  assertEquals(plan.runtimeQualification, "not-run");
  assertEquals(plan.physicalImageId, NGSPICE_WORKER_PHYSICAL_IMAGE_ID);
  assertEquals(plan.bindingId, NGSPICE_ADMITTED_CIRCUIT_BINDING_ID);
  assertEquals(plan.fixtureId, NGSPICE_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID);
  assertEquals(
    plan.candidateReference,
    ngspice.candidate.microsandbox.candidateReference,
  );
  assertEquals(
    plan.stateRoot,
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
      plan.importRecordFingerprint,
    ),
  );
  await assertRejects(
    () => planNgspiceWorkerCandidateQualification(modelica),
    TypeError,
    "physicalImageId=ngspice-worker",
  );
  await assertRejects(
    () =>
      qualifyNgspiceWorkerCandidate(modelica, {
        observedHost: {
          read: () => {
            hostReads += 1;
            return Promise.resolve(observedHost());
          },
        },
        compose: () => {
          composed += 1;
          return Promise.reject(new Error("composition must not run"));
        },
      }),
    TypeError,
    "physicalImageId=ngspice-worker",
  );
  assertEquals(composed, 0);
  assertEquals(hostReads, 0);
});

Deno.test("tampered ngspice candidate import records fail before composition", async () => {
  const { ngspice } = await records();
  const tampered = JSON.parse(deterministicJson(ngspice)) as Record<string, unknown>;
  const identities = tampered.identities as Record<string, unknown>;
  identities.microsandboxManifestDigest = `sha256:${"0".repeat(64)}`;
  tampered.identities = identities;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(tampered),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("ngspice candidate qualification uses one host snapshot, exact source, WAL/CAS and numeric validation", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-qualification-" }),
  );
  const activeRoot = `${directory}/active`;
  await Deno.mkdir(
    `${activeRoot}/recorded-analysis/electrical/spice/admitted/attempts`,
    {
      recursive: true,
    },
  );
  await Deno.mkdir(`${activeRoot}/capability-runtime-host`, { recursive: true });
  const calls = {
    compose: 0,
    run: 0,
    imageRemove: 0,
    image: "",
    source: new Uint8Array(),
  };
  const host = observedHost();
  let observedHostReads = 0;
  let nowCalls = 0;
  const startedAt = "2026-09-05T03:00:00.000Z";
  const fixture = await readNgspiceWorkerCandidateQualificationSource();
  try {
    const result = await qualifyNgspiceWorkerCandidate(ngspice, {
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
        calls.image = options.profile.imageReference;
        return await fakeComposition(options.profile, paths, calls);
      },
    });
    assertEquals(calls.compose, 1);
    assertEquals(calls.run, 1);
    assertEquals(calls.imageRemove, 0);
    assertEquals(observedHostReads, 1);
    assertEquals(nowCalls, 1);
    assertEquals(calls.image, ngspice.candidate.microsandbox.candidateReference);
    assertEquals(calls.source, fixture);
    assertEquals(
      pinnedOciImageReference(result.candidateReference, "$test") ===
        pinnedOciImageReference(LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE, "$pin"),
      false,
    );
    assertEquals(result.status, "passed");
    assertEquals(result.eligibleForPromotion, false);
    assertEquals(result.engineeringLevels, { l3: false, l4: false, l5: false });
    assertEquals(result.methodQualification, "unqualified");
    assertEquals(result.bindingQualification, "unqualified");
    assertEquals(result.proof.methodQualification, "unqualified");
    assertEquals(result.proof.bindingQualification, "unqualified");
    assertEquals(result.outputs.map((output) => output.role), ["evidence", "result"]);
    assertEquals(result.qualification.eligibleForPromotion, false);
    assertEquals(result.qualification.observedHost.platform, "linux/arm64");
    const paths = ngspiceWorkerCandidateQualificationPaths(`${directory}/candidate`);
    assertEquals((await Deno.stat(paths.outputCasDirectory)).isDirectory, true);
    assertEquals((await Deno.stat(paths.attemptDirectory)).isDirectory, true);
    assertEquals((await Deno.stat(paths.captureDirectory)).isDirectory, true);
    const attempt = await new FileNgspiceWorkerCandidateAttemptStore(
      paths.attemptDirectory,
      `${directory}/candidate`,
    ).read();
    if (attempt?.phase !== "attested") {
      throw new Error("Expected durable attested WAL.");
    }
    assertEquals(attempt.identity.startedAt, startedAt);
    assertEquals(attempt.attestation.attestedAt, startedAt);
    assertEquals(
      await Deno.readTextFile(`${directory}/candidate/qualification.json`),
      `${deterministicJson(result.qualification)}\n`,
    );
    const rereadProof = parseNgspiceWorkerCandidateProof(
      JSON.parse(await Deno.readTextFile(`${paths.captureDirectory}/proof.json`)),
    );
    assertEquals(rereadProof, result.proof);
    assertEquals(
      (await Array.fromAsync(
        Deno.readDir(
          `${activeRoot}/recorded-analysis/electrical/spice/admitted/attempts`,
        ),
      )).length,
      0,
    );
    assertEquals(
      (await Array.fromAsync(Deno.readDir(`${activeRoot}/capability-runtime-host`)))
        .length,
      0,
    );

    const replayed = await qualifyNgspiceWorkerCandidate(ngspice, {
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
    assertEquals(replayed.status, "passed");
    assertEquals(replayed.qualification, result.qualification);

    const recovered = await recoverNgspiceWorkerCandidateQualification(ngspice, {
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
    assertEquals(recovered.status, "passed");
    assertEquals(recovered.qualification, result.qualification);
    assertEquals(recovered.eligibleForPromotion, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("attested ngspice replay rejects proof drift from the current server profile", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-proof-drift-" }),
  );
  const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
  const compose: NonNullable<NgspiceWorkerCandidateQualificationPorts["compose"]> =
    async (options, paths) => await fakeComposition(options.profile, paths, calls);
  try {
    await qualifyNgspiceWorkerCandidate(ngspice, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      compose,
    });
    const proofPath = `${
      ngspiceWorkerCandidateQualificationPaths(directory).captureDirectory
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
        recoverNgspiceWorkerCandidateQualification(ngspice, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          compose,
        }),
      Error,
      "current server-owned profile",
    );
    assertEquals(calls.run, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("attested ngspice replay rejects a receipt fingerprint drift", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-receipt-drift-" }),
  );
  const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
  try {
    await qualifyNgspiceWorkerCandidate(ngspice, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      compose: async (options, paths) =>
        await fakeComposition(options.profile, paths, calls),
    });
    await assertRejects(
      () =>
        recoverNgspiceWorkerCandidateQualification(ngspice, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          compose: async (options, paths) => {
            const composition = await fakeComposition(options.profile, paths, calls);
            const publications = composition.execution!.publications;
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                publications: {
                  resolvePublicationByRunId: (runId, producerGeneration) =>
                    publications.resolvePublicationByRunId(runId, producerGeneration),
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
        }),
      Error,
      "receipt diverged",
    );
    assertEquals(calls.run, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("attested ngspice replay rejects CAS output drift", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-cas-drift-" }),
  );
  const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
  try {
    await qualifyNgspiceWorkerCandidate(ngspice, {
      observedHost: { read: () => Promise.resolve(observedHost()) },
      stateRoot: directory,
      compose: async (options, paths) =>
        await fakeComposition(options.profile, paths, calls),
    });
    await assertRejects(
      () =>
        recoverNgspiceWorkerCandidateQualification(ngspice, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          compose: async (options, paths) => {
            const composition = await fakeComposition(options.profile, paths, calls);
            const publications = composition.execution!.publications;
            return {
              ...composition,
              execution: {
                ...composition.execution!,
                publications: {
                  resolvePublicationByRunId: (runId, producerGeneration) =>
                    publications.resolvePublicationByRunId(runId, producerGeneration),
                  readReceipt: (ref) => publications.readReceipt(ref),
                  readPublishedObject: async (ref, member) => {
                    const bytes = await publications.readPublishedObject(ref, member);
                    if (bytes === undefined) return undefined;
                    const mutated = new Uint8Array(bytes.byteLength + 1);
                    mutated.set(bytes);
                    return mutated;
                  },
                },
              },
            };
          },
        }),
      Error,
      "drifted after CAS reread",
    );
    assertEquals(calls.run, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ngspice candidate qualification rejects a receipt runtime from another image", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-runtime-drift-" }),
  );
  const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
  try {
    await assertRejects(
      () =>
        qualifyNgspiceWorkerCandidate(ngspice, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: directory,
          compose: async (options, paths) => {
            const composition = await fakeComposition(options.profile, paths, calls);
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
        }),
      Error,
      "runtime attestation diverged",
    );
    assertEquals(calls.run, 1);
    await assertRejects(
      () => Deno.stat(`${directory}/qualification.json`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ngspice candidate qualification rejects divergent receipt output declarations", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-manifest-drift-" }),
  );
  const drifts = [
    { field: "basename" as const, value: "foreign.json" },
    { field: "mediaType" as const, value: "application/octet-stream" },
    { field: "format" as const, value: "foreign-format" },
  ];
  try {
    for (const drift of drifts) {
      const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
      const stateRoot = `${directory}/${drift.field}`;
      await assertRejects(
        () =>
          qualifyNgspiceWorkerCandidate(ngspice, {
            observedHost: { read: () => Promise.resolve(observedHost()) },
            stateRoot,
            compose: async (options, paths) => {
              const composition = await fakeComposition(
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
                        outputs: receipt.outputs.map((output, index) =>
                          index === 0
                            ? { ...output, [drift.field]: drift.value }
                            : output
                        ),
                      };
                    },
                  },
                },
              };
            },
          }),
        Error,
        "output manifest diverged",
      );
      assertEquals(calls.run, 1);
      await assertRejects(
        () => Deno.stat(`${stateRoot}/qualification.json`),
        Deno.errors.NotFound,
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ngspice candidate qualification refuses a non-linux/arm64 host before composition", async () => {
  const { ngspice } = await records();
  let composed = 0;
  await assertRejects(
    () =>
      qualifyNgspiceWorkerCandidate(ngspice, {
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

Deno.test("ngspice candidate recovery fails closed without WAL, unpublished or unknown publication", async () => {
  const { ngspice } = await records();
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-ngspice-candidate-recover-" }),
  );
  const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
  let nowCalls = 0;
  try {
    await assertRejects(
      () =>
        recoverNgspiceWorkerCandidateQualification(ngspice, {
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

    await seedDispatching(ngspice, `${directory}/unpublished`);
    await assertRejects(
      () =>
        recoverNgspiceWorkerCandidateQualification(ngspice, {
          observedHost: { read: () => Promise.resolve(observedHost()) },
          stateRoot: `${directory}/unpublished`,
          compose: async (options, paths) =>
            await fakeComposition(options.profile, paths, calls),
        }),
      Error,
      "unpublished; recovery does not redispatch",
    );
    assertEquals(calls.run, 0);

    await seedDispatching(ngspice, `${directory}/unknown`);
    await assertRejects(
      () =>
        recoverNgspiceWorkerCandidateQualification(ngspice, {
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

Deno.test("ngspice candidate qualification source never deletes images or builds Docker", async () => {
  const source = await Deno.readTextFile(
    new URL("./ngspice-worker-candidate-qualification.ts", import.meta.url),
  );
  assertEquals(source.includes("Image.remove"), false);
  assertEquals(source.includes("image remove"), false);
  assertEquals(source.includes("--keep-image"), false);
  assertEquals(source.includes("docker"), false);
  assertEquals(source.includes("buildx"), false);
  assertEquals(source.includes("Deno.build"), false);
  assertEquals(source.includes("1970-01-01T00:00:00.000Z"), false);
  assertEquals(source.includes("resistor-divider.cir"), true);
  assertEquals(source.includes("LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE"), true);
  const fixture = await Deno.readFile(
    new URL(
      "../../../../testing/fixtures/electrical/spice/operating-point/resistor-divider.cir",
      import.meta.url,
    ),
  );
  assertEquals(await readNgspiceWorkerCandidateQualificationSource(), fixture);
});

async function seedDispatching(
  record: Awaited<ReturnType<typeof records>>["ngspice"],
  stateRoot: string,
): Promise<void> {
  const calls = { run: 0, imageRemove: 0, source: new Uint8Array() };
  await qualifyNgspiceWorkerCandidate(record, {
    observedHost: { read: () => Promise.resolve(observedHost()) },
    now: () => "2026-09-05T03:00:00.000Z",
    stateRoot,
    compose: async (options, paths) =>
      await fakeComposition(options.profile, paths, calls),
  });
  await Deno.remove(`${stateRoot}/qualification.json`);
  const paths = ngspiceWorkerCandidateQualificationPaths(stateRoot);
  await Deno.remove(`${paths.attemptDirectory}/attested.json`);
  await Deno.remove(`${paths.captureDirectory}/proof.json`);
  await Deno.remove(paths.outputCasDirectory, { recursive: true });
  await Deno.mkdir(paths.outputCasDirectory, { recursive: true });
}

function fakeComposition(
  options: ConstructorParameters<typeof FixedAdmittedSpiceExecutionProfileCatalog>[0],
  paths: { readonly outputCasDirectory: string },
  calls: { run?: number; imageRemove: number; source: Uint8Array },
): AdmittedSpiceExecutionComposition {
  const profiles = new FixedAdmittedSpiceExecutionProfileCatalog(options);
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const runner = {
    async run(request: IsolatedCodeExecutionRequest) {
      calls.run = (calls.run ?? 0) + 1;
      const validated = await validateIsolatedCodeExecutionRequest(request);
      calls.source = validated.source.bytes.copy();
      const profile = await profiles.initial();
      const outputs = await spiceOutputs(validated.source.bytes.copy());
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

async function spiceOutputs(source: Uint8Array): Promise<Map<string, Uint8Array>> {
  const result = {
    schemaVersion: SPICE_OPERATING_POINT_RESULT_SCHEMA,
    analysisKind: "operating-point",
    signConvention: SPICE_OPERATING_POINT_SIGN_CONVENTION,
    observables: DIVIDER_OBSERVABLES,
  };
  const resultBytes = ENCODER.encode(deterministicJson(result));
  const evidence = {
    schemaVersion: SPICE_ISOLATED_EVIDENCE_SCHEMA,
    status: "succeeded",
    analysisKind: "operating-point",
    inputSourceSha256: await fingerprintResourceBytes(source),
    profile: SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
    wrapper: SPICE_OPERATING_POINT_WRAPPER,
    method: {
      engine: { name: "ngspice", version: "42" },
      export: SPICE_OPERATING_POINT_EXPORT,
    },
    counts: {
      sourceBytes: source.byteLength,
      observableCount: DIVIDER_OBSERVABLES.length,
      nodeVoltageCount: 2,
      branchCurrentCount: 3,
    },
    limits: {
      maxSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
      maxObservables: SPICE_ADMITTED_MAX_OBSERVABLES,
      maxResultBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
      maxEvidenceBytes: SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
      maxVectorBytes: SPICE_ADMITTED_MAX_VECTOR_BYTES,
      maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
    },
    limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
    warnings: [],
    result: {
      role: "result",
      basename: "result.json",
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
  };
  return new Map([
    ["evidence", ENCODER.encode(deterministicJson(evidence))],
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
    ngspice: await one("ngspice-worker"),
    modelica: await one("modelica-microsandbox-worker"),
  };
}
