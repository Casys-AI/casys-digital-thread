import { assertEquals, assertRejects } from "@std/assert";
import type { ExecuteIsolatedCalculixStaticProof } from "../../../application/use-cases/fea/isolated-v3/execute-isolated-calculix-static-proof.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  CalculixIsolatedExecutionEvidence,
  CalculixIsolatedInputBundle,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { CALCULIX_ISOLATED_OUTPUT_MANIFEST } from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import type { IsolatedCodeExecutionReceiptRecord } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "./fixed-calculix-isolated-execution-profile.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { FileEngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { FileCalculixIsolatedProductAttemptStore } from "./file-calculix-isolated-product-attempt-store.ts";
import {
  createHistoricalFeaStaticProofV2Fixture,
  createIsolatedCalculixV3Fixture,
  ISOLATED_CALCULIX_FIXTURE_AGENT,
} from "../../../testing/isolated-calculix-v3-fixture.ts";
import {
  CalculixIsolatedProductOutcomeUnknownError,
  VerifyRunFeaStaticProofV3RunExecutor,
  type VerifyRunFeaStaticProofV3RunExecutorDependencies,
} from "./verify-run-fea-static-proof-v3-run-executor.ts";

Deno.test("isolated CalculiX @3 publishes nine local outputs and two evidence artifacts exactly once", async () => {
  await withRuntime(async (runtime) => {
    const completed = await runtime.executor.execute(
      ISOLATED_CALCULIX_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    assertEquals(
      completed.agentRuns.find((run) => run.id === runtime.fixture.runId)?.status,
      "completed",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
    const resultRef = completed.threadSnapshots.at(-1)!;
    const snapshot = await runtime.fixture.snapshots.get(resultRef.snapshotId);
    const localArtifacts = snapshot!.artifacts.filter((artifact) =>
      artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === "verify.run-fea-static-proof@3" &&
      artifact.producer.runId === runtime.fixture.runId
    );
    assertEquals(localArtifacts.length, 11);
    assertEquals(
      localArtifacts.filter((artifact) => artifact.name.startsWith("Local CalculiX "))
        .length,
      9,
    );
    assertEquals(
      snapshot!.evaluations.length > runtime.fixture.basis.evaluations.length,
      true,
    );

    const replayed = await runtime.executor.execute(
      ISOLATED_CALCULIX_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    const completedRun = completed.agentRuns.find((run) =>
      run.id === runtime.fixture.runId
    )!;
    const replayedRun = replayed.agentRuns.find((run) =>
      run.id === runtime.fixture.runId
    )!;
    const replayedSnapshot = await runtime.fixture.snapshots.get(
      replayed.threadSnapshots.at(-1)!.snapshotId,
    );
    assertEquals(replayed.revision, completed.revision);
    assertEquals(
      deterministicJson(replayedSnapshot),
      deterministicJson(snapshot),
    );
    assertEquals(
      deterministicJson(replayedRun.resultSnapshot),
      deterministicJson(completedRun.resultSnapshot),
    );
    assertEquals(
      deterministicJson(replayedRun.evidenceRefs),
      deterministicJson(completedRun.evidenceRefs),
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
  });
});

Deno.test("isolated CalculiX @3 project lease collapses concurrent same-run calls to one solve and oracle", async () => {
  await withRuntime(async (runtime) => {
    const [first, second] = await Promise.all([
      runtime.executor.execute(
        ISOLATED_CALCULIX_FIXTURE_AGENT,
        runtime.fixture.command,
      ),
      runtime.executor.execute(
        ISOLATED_CALCULIX_FIXTURE_AGENT,
        runtime.fixture.command,
      ),
    ]);
    assertEquals(first.id, second.id);
    assertEquals(first.revision, second.revision);
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
  });
});

Deno.test("isolated CalculiX @3 completed replay reopens WAL evidence and SysON CAS without redispatch", async () => {
  await withRuntime(async (runtime) => {
    await runtime.executor.execute(
      ISOLATED_CALCULIX_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    const calls = { ...runtime.counts };
    await assertRejects(
      () =>
        runtime.executorWith({
          attempts: new FileCalculixIsolatedProductAttemptStore(
            `${runtime.directory}/absent-completed-wal`,
          ),
        }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "no exact completed product WAL",
    );
    await assertRejects(
      () =>
        runtime.executorWith({
          executionEvidence: {
            save: () => Promise.reject(new Error("must not save")),
            read: () => Promise.resolve(undefined),
            uriFor: (fingerprint) =>
              `casys://calculix-isolated-execution-evidence/sha256/${fingerprint.digest}`,
          },
        }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "evidence named by the product WAL is absent",
    );
    const absentEvaluations = new FileByteStore({
      kind: "calculix-isolated-syson-evaluation",
      directory: `${runtime.directory}/absent-syson-cas`,
      uriNamespace: "calculix-isolated-syson-evaluation",
      label: "Absent isolated CalculiX SysON evaluation",
    });
    await assertRejects(
      () =>
        runtime.executorWith({
          sysonEvaluationCaptureStore: absentEvaluations,
        }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "evaluation capture is absent",
    );
    await assertRejects(
      () =>
        runtime.executorWith({
          projects: projectStoreWithMutation(
            runtime.fixture.projects,
            (project) => {
              const basisArtifact = runtime.fixture.basis.artifacts[0];
              const basisRef = {
                snapshotId: runtime.fixture.basis.id,
                revision: runtime.fixture.basis.revision,
                subjectId: runtime.fixture.basis.subject.id,
              };
              return {
                ...project,
                agentRuns: project.agentRuns.map((run) =>
                  run.id === runtime.fixture.runId
                    ? {
                      ...run,
                      resultSnapshot: basisRef,
                      evidenceRefs: [{
                        snapshotId: runtime.fixture.basis.id,
                        snapshotRevision: runtime.fixture.basis.revision,
                        kind: "artifact" as const,
                        id: basisArtifact.id,
                      }],
                    }
                    : run
                ),
              };
            },
          ),
        }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "do not bind the exact isolated CalculiX snapshot and evidence refs",
    );
    assertEquals(runtime.counts, calls);
  });
});

Deno.test("isolated CalculiX @3 reopens completed WAL evidence before resuming a lost publication acknowledgement", async () => {
  await withRuntime(async (runtime) => {
    const lostPublishAck = new Proxy(runtime.fixture.commands, {
      get(target, property) {
        if (property === "publishRun") {
          return async (...args: Parameters<typeof target.publishRun>) => {
            await target.publishRun(...args);
            throw new Error("lost publication acknowledgement");
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await assertRejects(
      () =>
        runtime.executorWith({ commands: lostPublishAck }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "lost publication acknowledgement",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
    assertEquals(
      (await runtime.fixture.projects.get(runtime.fixture.projectId))!.agentRuns
        .find((run) => run.id === runtime.fixture.runId)?.status,
      "publishing",
    );

    await assertRejects(
      () =>
        runtime.executorWith({
          executionEvidence: {
            save: () => Promise.reject(new Error("must not save")),
            read: () => Promise.resolve(undefined),
            uriFor: (fingerprint) =>
              `casys://calculix-isolated-execution-evidence/sha256/${fingerprint.digest}`,
          },
        }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "evidence named by the product WAL is absent",
    );
    assertEquals(
      (await runtime.fixture.projects.get(runtime.fixture.projectId))!.agentRuns
        .find((run) => run.id === runtime.fixture.runId)?.status,
      "publishing",
    );

    const completed = await runtime.executor.execute(
      ISOLATED_CALCULIX_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    assertEquals(
      completed.agentRuns.find((run) => run.id === runtime.fixture.runId)?.status,
      "completed",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
  });
});

Deno.test("isolated CalculiX @3 refuses the legacy @2 ROP before local solve or SysON", async () => {
  const directory = await Deno.makeTempDir({ prefix: "calculix-v3-refuse-v2-" });
  try {
    const profiles = profileCatalog("a");
    const profile = await profiles.initial();
    const fixture = await createHistoricalFeaStaticProofV2Fixture(directory);
    let executes = 0;
    let syson = 0;
    const executor = executorForFixture(directory, fixture, {
      profiles,
      execute: () => {
        executes++;
        throw new Error("must not execute");
      },
      syson: () => {
        syson++;
        throw new Error("must not call SysON");
      },
      evidence: new Map(),
      profile,
    });
    await assertRejects(
      () => executor.execute(ISOLATED_CALCULIX_FIXTURE_AGENT, fixture.command),
      TypeError,
      "not the fixed executor verify.run-fea-static-proof@3",
    );
    assertEquals(executes, 0);
    assertEquals(syson, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("isolated CalculiX @3 cross-binds the ROP profile and durable evidence before SysON", async () => {
  await withRuntime(async (runtime) => {
    const foreignProfiles = profileCatalog("f");
    await assertRejects(
      () =>
        runtime.executorWith({ profiles: foreignProfiles }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "does not bind the exact active local profile",
    );
    assertEquals(runtime.counts.execute, 0);
    assertEquals(runtime.counts.syson, 0);

    runtime.evidenceMutation = "foreign-plan";
    await assertRejects(
      () =>
        runtime.executor.execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "does not cross-bind the exact plan",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 0);
  });
});

Deno.test("isolated CalculiX @3 refuses divergent canonical STEP bytes before local solve", async () => {
  await withRuntime(async (runtime) => {
    await assertRejects(
      () =>
        runtime.executorWith({
          canonicalAssets: {
            read: () => Promise.resolve(new TextEncoder().encode("foreign STEP")),
          },
        }).execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "Canonical STEP bytes do not match",
    );
    assertEquals(runtime.counts.execute, 0);
    assertEquals(runtime.counts.syson, 0);
  });
});

Deno.test("isolated CalculiX @3 quarantines unknown SysON outcome and never calls solve or oracle twice", async () => {
  await withRuntime(async (runtime) => {
    runtime.sysonFails = true;
    await assertRejects(
      () =>
        runtime.executor.execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      CalculixIsolatedProductOutcomeUnknownError,
      "may have completed",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
    runtime.sysonFails = false;
    await assertRejects(
      () =>
        runtime.executor.execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      CalculixIsolatedProductOutcomeUnknownError,
      "second oracle call is forbidden",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
  });
});

Deno.test("isolated CalculiX @3 recovers a lost evaluation-capture WAL acknowledgement without another oracle", async () => {
  await withRuntime(async (runtime) => {
    const attempts = new AckLossEvaluationStore(`${runtime.directory}/attempts-ack`);
    const executor = runtime.executorWith({ attempts });
    await assertRejects(
      () =>
        executor.execute(
          ISOLATED_CALCULIX_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "lost evaluation WAL acknowledgement",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
    const completed = await executor.execute(
      ISOLATED_CALCULIX_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    assertEquals(
      completed.agentRuns.find((run) => run.id === runtime.fixture.runId)?.status,
      "completed",
    );
    assertEquals(runtime.counts.execute, 1);
    assertEquals(runtime.counts.syson, 1);
  });
});

class AckLossEvaluationStore extends FileCalculixIsolatedProductAttemptStore {
  #fail = true;

  override async recordEvaluation(
    input: Parameters<FileCalculixIsolatedProductAttemptStore["recordEvaluation"]>[0],
  ) {
    const result = await super.recordEvaluation(input);
    if (this.#fail) {
      this.#fail = false;
      throw new Error("lost evaluation WAL acknowledgement");
    }
    return result;
  }
}

interface Runtime {
  readonly directory: string;
  readonly fixture: Awaited<ReturnType<typeof createIsolatedCalculixV3Fixture>>;
  readonly counts: { execute: number; syson: number };
  readonly executor: VerifyRunFeaStaticProofV3RunExecutor;
  executorWith(
    overrides: Partial<VerifyRunFeaStaticProofV3RunExecutorDependencies>,
  ): VerifyRunFeaStaticProofV3RunExecutor;
  sysonFails: boolean;
  evidenceMutation: "none" | "foreign-plan";
}

async function withRuntime(body: (runtime: Runtime) => Promise<void>) {
  const directory = await Deno.makeTempDir({ prefix: "calculix-v3-executor-" });
  try {
    await body(await createRuntime(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function createRuntime(directory: string): Promise<Runtime> {
  const profiles = profileCatalog("a");
  const profile = await profiles.initial();
  const fixture = await createIsolatedCalculixV3Fixture(directory, profile);
  const evidence = new Map<string, CalculixIsolatedExecutionEvidence>();
  const counts = { execute: 0, syson: 0 };
  const mutable = {
    sysonFails: false,
    evidenceMutation: "none" as Runtime["evidenceMutation"],
  };
  const base = executorDependencies(directory, fixture, {
    profiles,
    profile,
    evidence,
    execute: async (input) => {
      counts.execute++;
      let created = await fakeEvidence(input.bundle, input.identity, profile);
      if (mutable.evidenceMutation === "foreign-plan") {
        created = {
          ...created,
          authority: {
            resolvedOperationPlanFingerprint: {
              algorithm: "sha256",
              digest: "9".repeat(64),
            },
          },
        };
      }
      evidence.set(created.fingerprint.digest, created);
      return created;
    },
    syson: (call) => {
      counts.syson++;
      if (mutable.sysonFails) {
        throw new Error("transport disconnected after request");
      }
      const constraints = call.arguments!.constraints as Array<{
        id: string;
        expression: { right: { value: number; unit: string } };
      }>;
      return {
        structuredContent: {
          results: constraints.map((constraint) => ({
            constraintId: constraint.id,
            status: "pass",
            computedValue: constraint.expression.right.value / 2,
            threshold: constraint.expression.right.value,
            margin: constraint.expression.right.value / 2,
            marginPercent: 50,
            unit: constraint.expression.right.unit,
          })),
        },
        text: "fixture SysON",
      };
    },
  });
  const runtime: Runtime = {
    directory,
    fixture,
    counts,
    executor: new VerifyRunFeaStaticProofV3RunExecutor(base),
    executorWith: (overrides) =>
      new VerifyRunFeaStaticProofV3RunExecutor({ ...base, ...overrides }),
    get sysonFails() {
      return mutable.sysonFails;
    },
    set sysonFails(value: boolean) {
      mutable.sysonFails = value;
    },
    get evidenceMutation() {
      return mutable.evidenceMutation;
    },
    set evidenceMutation(value: Runtime["evidenceMutation"]) {
      mutable.evidenceMutation = value;
    },
  };
  return runtime;
}

function executorForFixture(
  directory: string,
  fixture: Awaited<ReturnType<typeof createHistoricalFeaStaticProofV2Fixture>>,
  options: {
    readonly profiles: ReturnType<typeof profileCatalog>;
    readonly profile: Awaited<ReturnType<ReturnType<typeof profileCatalog>["initial"]>>;
    readonly evidence: Map<string, CalculixIsolatedExecutionEvidence>;
    readonly execute: () => never;
    readonly syson: () => never;
  },
): VerifyRunFeaStaticProofV3RunExecutor {
  return new VerifyRunFeaStaticProofV3RunExecutor(
    executorDependencies(directory, fixture, options),
  );
}

function executorDependencies(
  directory: string,
  fixture: Awaited<ReturnType<typeof createHistoricalFeaStaticProofV2Fixture>>,
  options: {
    readonly profiles: ReturnType<typeof profileCatalog>;
    readonly profile: Awaited<ReturnType<ReturnType<typeof profileCatalog>["initial"]>>;
    readonly evidence: Map<string, CalculixIsolatedExecutionEvidence>;
    readonly execute: (
      input: Parameters<ExecuteIsolatedCalculixStaticProof["execute"]>[0],
    ) => Promise<CalculixIsolatedExecutionEvidence> | never;
    readonly syson: (
      call: { name: string; arguments?: Readonly<Record<string, unknown>> },
    ) => {
      readonly structuredContent: Readonly<Record<string, unknown>>;
      readonly text: string;
    } | never;
  },
): VerifyRunFeaStaticProofV3RunExecutorDependencies {
  const evaluations = new FileByteStore({
    kind: "calculix-isolated-syson-evaluation",
    directory: `${directory}/evaluations`,
    uriNamespace: "calculix-isolated-syson-evaluation",
    label: "Isolated CalculiX SysON evaluation",
  });
  return {
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    plans: fixture.plans,
    artifacts: {
      readArtifact(artifact) {
        const bytes = artifact.uri
          ? fixture.artifactBytes.get(artifact.uri)
          : undefined;
        return Promise.resolve(
          bytes && artifact.uri && artifact.mediaType
            ? {
              uri: artifact.uri,
              mediaType: artifact.mediaType,
              byteCount: bytes.byteLength,
              sha256: artifact.fingerprint.digest,
              bytes: Uint8Array.from(bytes),
            }
            : undefined,
        );
      },
    },
    canonicalAssets: {
      read: () => Promise.resolve(Uint8Array.from(fixture.stepBytes)),
    },
    profiles: options.profiles,
    executeIsolated: {
      async execute(input) {
        const created = await options.execute(input);
        return {
          evidence: created,
          attempt: {} as never,
        };
      },
    },
    executionEvidence: {
      save: () => Promise.reject(new Error("outer executor does not save evidence")),
      read: (fingerprint) => Promise.resolve(options.evidence.get(fingerprint.digest)),
      uriFor: (fingerprint) =>
        `casys://calculix-isolated-execution-evidence/sha256/${fingerprint.digest}`,
    },
    sysonEvaluationCaptureStore: evaluations,
    attempts: new FileCalculixIsolatedProductAttemptStore(`${directory}/attempts`),
    syson: {
      callTool: (call) => Promise.resolve(options.syson(call)),
      callToolTextResult: () => Promise.reject(new Error("unexpected text call")),
    },
    lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
    now: monotonicNow(),
  };
}

async function fakeEvidence(
  bundle: CalculixIsolatedInputBundle,
  identity: Parameters<ExecuteIsolatedCalculixStaticProof["execute"]>[0]["identity"],
  profile: Awaited<ReturnType<ReturnType<typeof profileCatalog>["initial"]>>,
): Promise<CalculixIsolatedExecutionEvidence> {
  const outputs = await Promise.all(
    CALCULIX_ISOLATED_OUTPUT_MANIFEST.map(async (declaration) => {
      const sha256 = declaration.role === "input.step"
        ? bundle.manifest.step.sha256
        : await fingerprintResourceBytes(
          new TextEncoder().encode(`fixture:${declaration.role}`),
        );
      return {
        ...declaration,
        byteCount: declaration.role === "input.step"
          ? bundle.manifest.step.byteCount
          : `fixture:${declaration.role}`.length,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
        validation: "accepted" as const,
        persistence: "staged-reread-atomic-commit" as const,
      };
    }),
  );
  const body = {
    schemaVersion: "calculix-isolated-static-evidence/1.0" as const,
    projectId: identity.projectId,
    agentRunId: identity.agentRunId,
    executionRunId: identity.executionRunId,
    executedAt: identity.startedAt,
    bundleFingerprint: bundle.fingerprint,
    proofFingerprint: bundle.manifest.proofFingerprint,
    executionProfileFingerprint: profile.profileFingerprint,
    authority: {
      resolvedOperationPlanFingerprint: identity.resolvedOperationPlanFingerprint,
    },
    receipt: {
      runId: identity.executionRunId,
      sourceSha256: bundle.fingerprint.digest,
      outputs,
    } as unknown as IsolatedCodeExecutionReceiptRecord,
    executionIdentity: {
      schemaVersion: "1.0" as const,
      profile: { id: "calculix-static-proof-v1" as const, version: "1.0.0" as const },
      wrapper: { id: "calculix-static-proof-v1" as const, version: "1.0.0" as const },
      lowering: { id: "calculix.static.abaqus-deck" as const, version: "1.0" as const },
      engines: {
        gmsh: { command: "gmsh" as const, version: "4.12.1" },
        ccx: { command: "ccx" as const, version: "This is Version 2.21" },
      },
      image: { status: "bound-by-isolated-runner-receipt" as const },
    },
    result: {
      schemaVersion: "calculix-isolated-static-result/1.0" as const,
      requestId: bundle.manifest.requestId,
      executionIdentity: {
        schemaVersion: "1.0" as const,
        profile: { id: "calculix-static-proof-v1" as const, version: "1.0.0" as const },
        wrapper: { id: "calculix-static-proof-v1" as const, version: "1.0.0" as const },
        lowering: {
          id: "calculix.static.abaqus-deck" as const,
          version: "1.0" as const,
        },
        engines: {
          gmsh: { command: "gmsh" as const, version: "4.12.1" },
          ccx: { command: "ccx" as const, version: "This is Version 2.21" },
        },
        image: { status: "bound-by-isolated-runner-receipt" as const },
      },
      inputArtifact: {
        mediaType: "model/step" as const,
        byteCount: bundle.manifest.step.byteCount,
        sha256: bundle.manifest.step.sha256,
      },
      mesh: { nodes: 2, elements: 1, nodesPerSelection: {} },
      constraints: { fixedSelections: [], loads: [] },
      metrics: {
        maximumDisplacement: {
          value: 0.1,
          unit: "mm" as const,
          nodeId: 2,
          vectorMm: [0, 0, -0.1] as const,
        },
        maximumVonMises: {
          value: 2,
          unit: "MPa" as const,
          elementId: 1,
        },
      },
    },
    outputs,
  };
  return {
    ...body,
    fingerprint: await sha256Fingerprint(body),
  };
}

function profileCatalog(seed: string) {
  return new FixedCalculixIsolatedExecutionProfileCatalog({
    imageReference: `casys/calculix@sha256:${seed.repeat(64)}`,
    wrapperSha256: "b".repeat(64),
    policy: {
      id: "calculix-local-test",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    limits: {
      maxWallTimeMs: 120_000,
      maxCpuTimeMs: 100_000,
      maxMemoryBytes: 1_073_741_824,
      maxProcesses: 32,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 134_217_728,
      maxOutputTotalBytes: 268_435_456,
    },
  });
}

function monotonicNow() {
  let tick = 0;
  return () =>
    new Date(Date.parse("2026-08-14T06:00:00.000Z") + tick++ * 1_000)
      .toISOString();
}

function projectStoreWithMutation(
  store: EngineeringProjectRevisionStore,
  mutate: (project: EngineeringProjectSnapshot) => EngineeringProjectSnapshot,
): EngineeringProjectRevisionStore {
  return {
    async get(projectId) {
      const project = await store.get(projectId);
      return project ? mutate(structuredClone(project)) : undefined;
    },
    getRevision: (projectId, revision) => store.getRevision(projectId, revision),
    createInitial: (snapshot) => store.createInitial(snapshot),
    commit: (snapshot, expectedRevision) => store.commit(snapshot, expectedRevision),
  };
}
