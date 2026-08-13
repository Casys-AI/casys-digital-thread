import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import type {
  CalculixRecordedStaticCompleted,
  CalculixRecordedStaticEvidenceVerifier,
  CalculixRecordedStaticPlan,
  CalculixRecordedStaticRecovery,
  CalculixRecordedStaticSolver,
} from "../../domain/analysis/calculix-recorded-capabilities.ts";
import { fingerprintResolvedOperationPlanV2 } from "../../domain/analysis/resolved-operation-plan-v2.ts";
import {
  createProviderResourceRead,
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  immutableBytes,
  type ProviderResourceReader,
} from "../../domain/analysis/provider-resource-reader.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { validateFeaSysonEvaluationCapture } from "../captures/fea-syson-evaluation-capture.ts";
import { FileByteStore } from "../captures/file-byte-store.ts";
import { ProviderResourceCaptureService } from "../captures/provider-resource-capture-service.ts";
import type { CanonicalAssetReader } from "../../application/ports/out/canonical-asset-reader.ts";
import type { ContainerAssetStager } from "./container-asset-stager.ts";
import {
  VerifyRunFeaStaticProofV2RunExecutor,
  type VerifyRunFeaStaticProofV2RunExecutorDependencies,
} from "./verify-run-fea-static-proof-v2-run-executor.ts";
import {
  FileCalculixRecordedStaticAttemptStore,
} from "../wal/file-calculix-recorded-static-attempt-store.ts";
import {
  createRecordedCalculixV2Fixture,
  RECORDED_CALCULIX_V2_FIXTURE_AGENT,
} from "../../testing/recorded-calculix-v2-fixture.ts";

const PROVIDER_RUN_ID = "r-01234567-89ab-cdef-0123-456789abcdef";

Deno.test("Recorded CalculiX @2 executes once, captures exact nine resources and durable SysON evidence", async () => {
  await withRuntime(async (runtime) => {
    const queued = await runtime.fixture.projects.get(runtime.fixture.projectId);
    assertExists(queued);
    const executionRun = queued.agentRuns.find((run) =>
      run.id === runtime.fixture.runId
    );
    assertExists(executionRun);
    assertEquals(
      runtime.fixture.proofCase.authorization,
      {
        workItemId: "fixture-proof-seal-item",
        decisionId: "fixture-proof-seal-decision",
      },
      "the declaration retains its seal MRTR, not the later execution MRTR",
    );
    assertStrictEquals(executionRun.workItemId, "recorded-fea-item");
    assertStrictEquals(
      executionRun.workItemId === runtime.fixture.proofCase.authorization.workItemId,
      false,
    );
    const completed = await runtime.executor.execute(
      RECORDED_CALCULIX_V2_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    assertStrictEquals(
      completed.agentRuns.find((run) => run.id === runtime.fixture.runId)?.status,
      "completed",
    );
    assertEquals(runtime.counts.stage, 1);
    assertEquals(runtime.counts.solve, 1);
    assertEquals(runtime.counts.runGet, 1);
    assertEquals(runtime.counts.providerCapture, 1);
    assertEquals(runtime.counts.resourceRead, 9);
    assertEquals(runtime.counts.syson, 1);

    const attempt = await runtime.attempts.read(
      runtime.fixture.projectId,
      runtime.fixture.runId,
    );
    assertExists(attempt);
    assertStrictEquals(attempt.status, "completed");
    const evaluation = await runtime.evaluations.read({
      algorithm: "sha256",
      digest: attempt.evaluationCapture.sha256,
    });
    assertExists(evaluation);
    const capture = validateFeaSysonEvaluationCapture(
      JSON.parse(new TextDecoder().decode(evaluation.copy())),
    );
    assertEquals(capture.request, runtime.sysonCalls[0]);
    assertEquals(capture.response.structuredContent, runtime.sysonResponses[0]);

    const snapshot = await runtime.fixture.snapshots.get(attempt.snapshot.snapshotId);
    assertExists(snapshot);
    assertEquals(
      snapshot.artifacts.filter((artifact) =>
        artifact.producer.serverId === "mcp-calculix"
      ).length,
      9,
    );
    assertEquals(
      snapshot.observations.length,
      runtime.fixture.proofCase.requirements.length,
    );
    assertEquals(
      snapshot.evaluations.length,
      runtime.fixture.proofCase.requirements.length,
    );
    const evaluationArtifact = snapshot.artifacts.find((artifact) =>
      artifact.uri === attempt.evaluationCapture.uri
    );
    assertExists(evaluationArtifact);
    const manifestArtifact = snapshot.artifacts.find((artifact) =>
      artifact.uri === attempt.captureManifest.uri
    );
    assertExists(manifestArtifact);
    assertEquals(
      manifestArtifact.uri,
      runtime.manifestStore.uriFor(manifestArtifact.fingerprint),
    );
    const ledgerArtifact = snapshot.artifacts.find((artifact) =>
      artifact.name === "CalculiX provider resource ledger"
    );
    assertExists(ledgerArtifact);
    assertEquals(
      ledgerArtifact.uri,
      runtime.ledgerStore.uriFor(ledgerArtifact.fingerprint),
    );
    const resultArtifact = snapshot.artifacts.find((artifact) =>
      artifact.kind === "solver-result" &&
      artifact.producer.serverId === "mcp-calculix"
    );
    assertExists(resultArtifact);
    const digitalThread = {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@2",
      runId: runtime.fixture.runId,
    };
    const syson = {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: `capture:${evaluationArtifact.fingerprint.digest}`,
    };
    const evaluationInputs = [
      runtime.fixture.proofArtifact.id,
      runtime.fixture.requirementsArtifact.id,
      resultArtifact.id,
    ];
    assertEquals(evaluationArtifact.producer, digitalThread);
    assertEquals(evaluationArtifact.inputArtifactIds, evaluationInputs);
    assertEquals(
      evaluationArtifact.uri,
      runtime.evaluations.uriFor(evaluationArtifact.fingerprint),
    );
    for (const artifactId of evaluationInputs) {
      assertExists(
        snapshot.consumptions.find((consumption) =>
          consumption.artifactId === artifactId &&
          deterministicJson(consumption.consumer) ===
            deterministicJson(digitalThread) &&
          consumption.status === "verified"
        ),
        `missing Digital Thread re-attestation for ${artifactId}`,
      );
      assertExists(
        snapshot.provenance.find((link) =>
          link.relation === "derived_from" &&
          link.from.kind === "artifact" &&
          link.from.id === evaluationArtifact.id &&
          link.to.kind === "artifact" && link.to.id === artifactId
        ),
        `missing evaluation derivation from ${artifactId}`,
      );
    }
    assertEquals(
      snapshot.consumptions.filter((consumption) =>
        consumption.consumer.serverId === "syson"
      ),
      [],
    );
    for (const entry of snapshot.evaluations) {
      assertEquals(entry.evidenceArtifactIds, [evaluationArtifact.id]);
      assertEquals(entry.evaluator, syson);
      assertEquals(entry.evaluatedAt, attempt.evaluationDispatchedAt);
    }
    assertEquals(snapshot.generatedAt, attempt.evaluationDispatchedAt);
    assertEquals(
      snapshot.observations.map((entry) => entry.source.capturedAt),
      snapshot.observations.map(() => attempt.evaluationDispatchedAt),
    );
    const completedRun = completed.agentRuns.find((run) =>
      run.id === runtime.fixture.runId
    );
    assertExists(completedRun);
    assertExists(
      completedRun.evidenceRefs.find((reference) =>
        reference.kind === "artifact" && reference.id === evaluationArtifact.id
      ),
      "normal @2 producer evidence must complete without a SysON exception",
    );
    assertStrictEquals(
      attempt.evaluationDispatchedAt === completedRun.startedAt,
      false,
      "evaluation evidence must not inherit the run claim timestamp",
    );
    const input = runtime.resources.find((resource) => resource.role === "input.step")!;
    const storedInput = await runtime.resourceStore.read({
      algorithm: "sha256",
      digest: input.sha256,
    });
    assertExists(storedInput);
    assertEquals(storedInput.copy(), runtime.fixture.stepBytes);

    await runtime.executor.execute(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
      ...runtime.fixture.command,
      commandId: "fixture:execute-recorded-again",
      expectedRevision: completed.revision,
    });
    assertEquals(runtime.counts.solve, 1);
    assertEquals(runtime.counts.syson, 1);
    assertEquals(runtime.counts.resourceRead, 9);
  });
});

Deno.test("Recorded CalculiX @2 rejects tampered plan, proof or STEP before staging/provider access", async () => {
  for (const tamper of ["plan", "proof", "step"] as const) {
    await withRuntime(async (runtime) => {
      const executor = runtime.executorFor({ tamper });
      await assertRejects(
        () =>
          executor.execute(RECORDED_CALCULIX_V2_FIXTURE_AGENT, runtime.fixture.command),
        Error,
        undefined,
        `tampered ${tamper}`,
      );
      assertEquals(runtime.counts.stage, 0, tamper);
      assertEquals(runtime.counts.solve, 0, tamper);
      assertEquals(runtime.counts.runGet, 0, tamper);
      assertEquals(runtime.counts.resourceRead, 0, tamper);
      assertEquals(runtime.counts.syson, 0, tamper);
    });
  }
});

Deno.test("Recorded CalculiX @2 rereads requirements bytes before SysON or provider access", async () => {
  for (const tamper of ["requirements-absent", "requirements-tampered"] as const) {
    await withRuntime(async (runtime) => {
      await assertRejects(
        () =>
          runtime.executorFor({ tamper }).execute(
            RECORDED_CALCULIX_V2_FIXTURE_AGENT,
            runtime.fixture.command,
          ),
        Error,
        "Requirements capture CAS bytes",
      );
      assertEquals(runtime.artifactReads, [
        runtime.fixture.proofArtifact.id,
        runtime.fixture.requirementsArtifact.id,
      ]);
      assertEquals(runtime.counts.stage, 0, tamper);
      assertEquals(runtime.counts.solve, 0, tamper);
      assertEquals(runtime.counts.runGet, 0, tamper);
      assertEquals(runtime.counts.resourceRead, 0, tamper);
      assertEquals(runtime.counts.syson, 0, tamper);
      const latest = await runtime.fixture.snapshots.latest(
        runtime.fixture.basis.subject.id,
      );
      assertExists(latest);
      assertEquals(latest.id, runtime.fixture.basis.id, tamper);
    });
  }
});

Deno.test("Recorded CalculiX @2 recovers a lost solve ACK through run_get without redispatch", async () => {
  await withRuntime(async (runtime) => {
    runtime.mode = "lost-ack";
    await assertRejects(
      () =>
        runtime.executor.execute(
          RECORDED_CALCULIX_V2_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "may have reached",
    );
    assertEquals(runtime.counts.solve, 1);
    assertEquals(runtime.counts.stage, 1);
    runtime.mode = "completed";
    const completed = await runtime.executor.execute(
      RECORDED_CALCULIX_V2_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    assertStrictEquals(
      completed.agentRuns.find((run) => run.id === runtime.fixture.runId)?.status,
      "completed",
    );
    assertEquals(runtime.counts.solve, 1);
    assertEquals(runtime.counts.stage, 1);
    assertEquals(runtime.counts.runGet, 2);
  });
});

Deno.test("Recorded CalculiX @2 reads provider-known and resources-captured states without solve/stage", async () => {
  await withRuntime(async (runtime) => {
    runtime.mode = "completed";
    await runtime.attempts.begin({
      projectId: runtime.fixture.projectId,
      runId: runtime.fixture.runId,
      planSha256: await runtime.planSha256(),
      requestId: await runtime.requestId(),
      preparedAt: "2026-08-12T04:00:00.000Z",
    });
    await runtime.attempts.markDispatched({
      projectId: runtime.fixture.projectId,
      runId: runtime.fixture.runId,
      dispatchedAt: "2026-08-12T04:00:01.000Z",
    });
    await runtime.attempts.recordProviderRun({
      projectId: runtime.fixture.projectId,
      runId: runtime.fixture.runId,
      requestSha256: "a".repeat(64),
      providerRunId: PROVIDER_RUN_ID,
      resources: runtime.resources,
    });
    const completed = await runtime.executor.execute(
      RECORDED_CALCULIX_V2_FIXTURE_AGENT,
      runtime.fixture.command,
    );
    assertStrictEquals(
      completed.agentRuns.find((run) => run.id === runtime.fixture.runId)?.status,
      "completed",
    );
    assertEquals(runtime.counts.runGet, 1);
    assertEquals(runtime.counts.solve, 0);
    assertEquals(runtime.counts.stage, 0);

    // A separate fresh fixture starts from an already reread provider capture.
    await withRuntime(async (capturedRuntime) => {
      await capturedRuntime.seedResourcesCaptured();
      const beforeReads = capturedRuntime.counts.resourceRead;
      const result = await capturedRuntime.executor.execute(
        RECORDED_CALCULIX_V2_FIXTURE_AGENT,
        capturedRuntime.fixture.command,
      );
      assertStrictEquals(
        result.agentRuns.find((run) => run.id === capturedRuntime.fixture.runId)
          ?.status,
        "completed",
      );
      assertEquals(capturedRuntime.counts.solve, 0);
      assertEquals(capturedRuntime.counts.stage, 0);
      assertEquals(capturedRuntime.counts.runGet, 0);
      assertEquals(capturedRuntime.counts.resourceRead, beforeReads);
    });
  });
});

Deno.test("Recorded CalculiX @2 rejects transplanted manifest and evaluation WAL CAS URIs", async () => {
  await withRuntime(async (runtime) => {
    await runtime.seedResourcesCaptured();
    const before = { ...runtime.counts };
    await transplantWalCasUri(runtime, "captureManifest", "transplanted-manifest");
    await assertRejects(
      () =>
        runtime.executor.execute(
          RECORDED_CALCULIX_V2_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "manifest WAL URI",
    );
    assertEquals(runtime.counts, before);
  });

  await withRuntime(async (runtime) => {
    const crashAfterCapture = runtime.executorWith({
      snapshots: {
        get: (snapshotId) => runtime.fixture.snapshots.get(snapshotId),
        latest: (subjectId) => runtime.fixture.snapshots.latest(subjectId),
        save: () => Promise.reject(new Error("fixture snapshot crash")),
      },
    });
    await assertRejects(
      () =>
        crashAfterCapture.execute(
          RECORDED_CALCULIX_V2_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "fixture snapshot crash",
    );
    const captured = await runtime.attempts.read(
      runtime.fixture.projectId,
      runtime.fixture.runId,
    );
    assertExists(captured);
    assertStrictEquals(captured.status, "evaluation-captured");
    const sysonCalls = runtime.counts.syson;
    const solves = runtime.counts.solve;
    await transplantWalCasUri(runtime, "evaluationCapture", "transplanted-evaluation");
    await assertRejects(
      () =>
        runtime.executor.execute(
          RECORDED_CALCULIX_V2_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "evaluation WAL URI",
    );
    assertEquals(runtime.counts.syson, sysonCalls);
    assertEquals(runtime.counts.solve, solves);
  });
});

Deno.test("Recorded CalculiX @2 requires the exact canonical acquisition ledger before evidence", async () => {
  for (const tamper of ["ledger-absent", "ledger-tampered"] as const) {
    await withRuntime(async (runtime) => {
      const executor = runtime.executorFor({ tamper });
      await assertRejects(
        () =>
          executor.execute(
            RECORDED_CALCULIX_V2_FIXTURE_AGENT,
            runtime.fixture.command,
          ),
        Error,
        tamper === "ledger-absent" ? "ledger is absent" : "exact CAS hash",
      );
      assertEquals(runtime.counts.syson, 0, tamper);
      const latest = await runtime.fixture.snapshots.latest(
        runtime.fixture.basis.subject.id,
      );
      assertExists(latest);
      assertEquals(latest.id, runtime.fixture.basis.id, tamper);
    });
  }
});

Deno.test("Recorded CalculiX @2 rejects ledger and resource CAS URI transplants with identical bytes", async () => {
  for (const tamper of ["ledger-uri", "resource-uri"] as const) {
    await withRuntime(async (runtime) => {
      await runtime.seedResourcesCaptured();
      const before = { ...runtime.counts };
      await assertRejects(
        () =>
          runtime.executorFor({ tamper }).execute(
            RECORDED_CALCULIX_V2_FIXTURE_AGENT,
            runtime.fixture.command,
          ),
        Error,
        tamper === "ledger-uri" ? "ledger manifest URI" : "exact local CAS object",
      );
      assertEquals(runtime.counts.providerCapture, before.providerCapture, tamper);
      assertEquals(runtime.counts.resourceRead, before.resourceRead, tamper);
      assertEquals(runtime.counts.solve, before.solve, tamper);
      assertEquals(runtime.counts.syson, 0, tamper);
      const latest = await runtime.fixture.snapshots.latest(
        runtime.fixture.basis.subject.id,
      );
      assertExists(latest);
      assertEquals(latest.id, runtime.fixture.basis.id, tamper);
    });
  }
});

Deno.test("Recorded CalculiX @2 quarantines provider-unknown and evaluation-unknown calls without retry", async () => {
  for (const mode of ["outcome_unknown", "quarantined", "evicted"] as const) {
    await withRuntime(async (runtime) => {
      runtime.mode = mode;
      await assertRejects(
        () =>
          runtime.executor.execute(
            RECORDED_CALCULIX_V2_FIXTURE_AGENT,
            runtime.fixture.command,
          ),
        Error,
        "recovery is",
      );
      assertEquals(runtime.counts.solve, 0, mode);
      assertEquals(runtime.counts.stage, 0, mode);
    });
  }
  await withRuntime(async (runtime) => {
    runtime.sysonFails = true;
    await assertRejects(
      () =>
        runtime.executor.execute(
          RECORDED_CALCULIX_V2_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "SysON evaluation may have reached",
    );
    assertEquals(runtime.counts.solve, 1);
    assertEquals(runtime.counts.syson, 1);
    runtime.sysonFails = false;
    await assertRejects(
      () =>
        runtime.executor.execute(
          RECORDED_CALCULIX_V2_FIXTURE_AGENT,
          runtime.fixture.command,
        ),
      Error,
      "second evaluation is forbidden",
    );
    assertEquals(runtime.counts.solve, 1);
    assertEquals(runtime.counts.syson, 1);
  });
});

type ProviderMode =
  | "not_found"
  | "completed"
  | "lost-ack"
  | "outcome_unknown"
  | "quarantined"
  | "evicted";

interface Runtime {
  readonly fixture: Awaited<ReturnType<typeof createRecordedCalculixV2Fixture>>;
  readonly attempts: FileCalculixRecordedStaticAttemptStore;
  readonly resourceStore: FileByteStore<"calculix-recorded-resource">;
  readonly ledgerStore: FileByteStore<"calculix-recorded-ledger">;
  readonly manifestStore: FileByteStore<"calculix-recorded-manifest">;
  readonly evaluations: FileByteStore<"calculix-recorded-syson-evaluation">;
  readonly resources: readonly (ExpectedProviderResource & { readonly role: string })[];
  readonly counts: {
    stage: number;
    solve: number;
    runGet: number;
    resourceRead: number;
    providerCapture: number;
    syson: number;
  };
  readonly sysonCalls: Array<
    {
      readonly name: "syson_constraint_evaluate";
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  >;
  readonly sysonResponses: Array<Readonly<Record<string, unknown>>>;
  readonly artifactReads: string[];
  mode: ProviderMode;
  sysonFails: boolean;
  readonly executor: VerifyRunFeaStaticProofV2RunExecutor;
  executorWith(
    overrides: Partial<VerifyRunFeaStaticProofV2RunExecutorDependencies>,
  ): VerifyRunFeaStaticProofV2RunExecutor;
  executorFor(
    options: {
      readonly tamper:
        | "plan"
        | "proof"
        | "step"
        | "requirements-absent"
        | "requirements-tampered"
        | "ledger-absent"
        | "ledger-tampered"
        | "ledger-uri"
        | "resource-uri";
    },
  ): VerifyRunFeaStaticProofV2RunExecutor;
  planSha256(): Promise<string>;
  requestId(): Promise<string>;
  seedResourcesCaptured(): Promise<void>;
}

async function withRuntime(
  test: (runtime: Runtime) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "recorded-calculix-v2-executor-",
  });
  try {
    await test(await createRuntime(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function createRuntime(directory: string): Promise<Runtime> {
  const fixture = await createRecordedCalculixV2Fixture(directory);
  const queuedProject = await fixture.projects.get(fixture.projectId);
  const queuedRun = queuedProject?.agentRuns.find((run) => run.id === fixture.runId);
  if (!queuedRun?.resolvedOperationPlan) {
    throw new Error("Recorded CalculiX fixture has no resolved operation plan.");
  }
  const queuedPlan = await fixture.plans.read(queuedRun.resolvedOperationPlan);
  if (queuedPlan.action.kind !== "static-structural-analysis") {
    throw new Error("Recorded CalculiX fixture resolved a non-FEA plan.");
  }
  const requestId = queuedPlan.action.requestId;
  const attempts = new FileCalculixRecordedStaticAttemptStore(`${directory}/attempts`);
  const resourceStore = new FileByteStore({
    kind: "calculix-recorded-resource",
    directory: `${directory}/resources`,
    uriNamespace: "calculix-recorded-resource",
    label: "Recorded CalculiX resource",
  });
  const ledgerStore = new FileByteStore({
    kind: "calculix-recorded-ledger",
    directory: `${directory}/ledgers`,
    uriNamespace: "calculix-recorded-ledger",
    label: "Recorded CalculiX ledger",
  });
  const manifestStore = new FileByteStore({
    kind: "calculix-recorded-manifest",
    directory: `${directory}/manifests`,
    uriNamespace: "calculix-recorded-manifest",
    label: "Recorded CalculiX manifest",
  });
  const evaluations = new FileByteStore({
    kind: "calculix-recorded-syson-evaluation",
    directory: `${directory}/syson-evaluations`,
    uriNamespace: "calculix-recorded-syson-evaluation",
    label: "Recorded SysON evaluation",
  });
  const resources = await providerResources(fixture.stepBytes);
  const bytesByUri = new Map<string, Uint8Array>(resources.map((resource) => [
    resource.uri,
    resource.bytes,
  ]));
  const counts = {
    stage: 0,
    solve: 0,
    runGet: 0,
    resourceRead: 0,
    providerCapture: 0,
    syson: 0,
  };
  const resourceReader: ProviderResourceReader = {
    async read(expected) {
      counts.resourceRead += 1;
      const bytes = bytesByUri.get(expected.uri);
      if (!bytes) throw new Error(`unexpected resource ${expected.uri}`);
      return await createProviderResourceRead(expected, bytes);
    },
  };
  const captureService = new ProviderResourceCaptureService({
    reader: resourceReader,
    artifactStore: resourceStore,
    ledgerStore,
    manifestStore,
  });
  const providerCaptures = {
    async capture(input: Parameters<typeof captureService.capture>[0]) {
      counts.providerCapture += 1;
      return await captureService.capture(input);
    },
  };
  let mode: ProviderMode = "not_found";
  let providerAccepted = false;
  let sysonFails = false;
  const completed: CalculixRecordedStaticCompleted = {
    status: "completed",
    requestId,
    requestSha256: "a".repeat(64),
    runId: PROVIDER_RUN_ID,
    resources: resources.map(({ bytes: _bytes, ...resource }) => resource),
  };
  const solver: CalculixRecordedStaticSolver = {
    resolve(input) {
      return {
        requestId: input.requestId,
        exactDispatchRecord: {
          requestId: input.requestId,
          staged: input.inputArtifact.stagedAsset.location,
        },
        expectedInput: {
          fingerprint: input.inputArtifact.fingerprint,
          byteCount: input.inputArtifact.byteCount,
        },
      };
    },
    solve(plan) {
      counts.solve += 1;
      assertEquals(plan.requestId, completed.requestId);
      if (mode === "lost-ack") {
        providerAccepted = true;
        throw new Error("connection lost after provider accepted request");
      }
      providerAccepted = true;
      return Promise.resolve(completed);
    },
  };
  const runReader = {
    getByRequestId(requestId: string): Promise<CalculixRecordedStaticRecovery> {
      counts.runGet += 1;
      assertEquals(requestId, completed.requestId);
      if (mode === "completed" || (mode === "lost-ack" && providerAccepted)) {
        return Promise.resolve(completed);
      }
      if (mode === "quarantined" || mode === "evicted") {
        return Promise.resolve({
          status: mode,
          requestId,
          runId: PROVIDER_RUN_ID,
          reason: "fixture",
        });
      }
      if (mode === "outcome_unknown") {
        return Promise.resolve({
          status: "outcome_unknown",
          requestId,
          reason: "fixture",
        });
      }
      return Promise.resolve({ status: "not_found" });
    },
  };
  const evidenceVerifier: CalculixRecordedStaticEvidenceVerifier = {
    verifyCapturedEvidence(plan, acknowledged, captured) {
      assertEquals(
        acknowledged.resources.map((resource) => resource.role),
        resources.map((resource) => resource.role),
      );
      assertEquals(
        captured.find((entry) => entry.role === "input.step")?.bytes,
        fixture.stepBytes,
      );
      return Promise.resolve({
        executionIdentity: {
          schemaVersion: "1.0",
          server: { package: "@casys/mcp-calculix", version: "0.7.0" },
          method: { id: "calculix_solve_static_recorded", version: "1.0" },
          lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
          engines: {
            gmsh: { command: "gmsh", version: "4.13" },
            ccx: { command: "ccx", version: "2.22" },
          },
          image: { status: "unattested" },
        },
        result: resultFor(plan),
      });
    },
  };
  const stager: ContainerAssetStager = {
    resolveTarget: ({ containerFileName }) => ({
      containerPath: `/inputs/${containerFileName}`,
    }),
    async stage(input) {
      counts.stage += 1;
      assertEquals(
        input.expectedDigest,
        await fingerprintResourceBytes(fixture.stepBytes),
      );
      assertEquals(input.expectedBytes, fixture.stepBytes.byteLength);
      return { containerPath: `/inputs/${input.containerFileName}` };
    },
  };
  const canonicalAssets: CanonicalAssetReader = {
    read: () => Promise.resolve(Uint8Array.from(fixture.stepBytes)),
  };
  const sysonCalls: Runtime["sysonCalls"] = [];
  const sysonResponses: Runtime["sysonResponses"] = [];
  const artifactReads: string[] = [];
  const syson = {
    callTool(
      call: { name: string; arguments?: Readonly<Record<string, unknown>> },
    ) {
      counts.syson += 1;
      assertEquals(call.name, "syson_constraint_evaluate");
      const request = {
        name: "syson_constraint_evaluate" as const,
        arguments: call.arguments!,
      };
      sysonCalls.push(request);
      if (sysonFails) {
        return Promise.reject(new Error("transport disconnected after request"));
      }
      const constraints = request.arguments.constraints as Array<
        { id: string; expression: { right: { value: number; unit: string } } }
      >;
      const structuredContent = {
        results: constraints.map((constraint) => ({
          constraintId: constraint.id,
          status: "pass",
          computedValue: constraint.expression.right.value / 2,
          threshold: constraint.expression.right.value,
          margin: constraint.expression.right.value / 2,
          marginPercent: 50,
          unit: constraint.expression.right.unit,
        })),
      };
      sysonResponses.push(structuredContent);
      return Promise.resolve({ structuredContent, text: "fixture syson" });
    },
    callToolTextResult: () => Promise.reject(new Error("unexpected SysON text call")),
  };
  const baseDependencies = {
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    plans: fixture.plans,
    artifacts: {
      readArtifact(artifact: { id: string; uri?: string; mediaType?: string }) {
        artifactReads.push(artifact.id);
        const bytes = artifact.uri
          ? fixture.artifactBytes.get(artifact.uri)
          : undefined;
        return Promise.resolve(
          bytes && artifact.uri && artifact.mediaType
            ? {
              uri: artifact.uri,
              mediaType: artifact.mediaType,
              byteCount: bytes.byteLength,
              sha256: artifact.id === fixture.proofArtifact.id
                ? fixture.proofArtifact.fingerprint.digest
                : fixture.requirementsArtifact.fingerprint.digest,
              bytes: Uint8Array.from(bytes),
            }
            : undefined,
        );
      },
    },
    canonicalAssets,
    canonicalAssetDirectory: `${directory}/canonical-assets`,
    stager,
    solver,
    runReader,
    evidenceVerifier,
    providerCaptures,
    resourceCaptureStore: resourceStore,
    ledgerCaptureStore: ledgerStore,
    manifestCaptureStore: manifestStore,
    sysonEvaluationCaptureStore: evaluations,
    attempts,
    syson,
    lease: {
      withLease: <T>(_projectId: string, _scope: string, operation: () => Promise<T>) =>
        operation(),
    },
    now: () => "2026-08-12T05:00:00.000Z",
  } as const;
  const executor = new VerifyRunFeaStaticProofV2RunExecutor(baseDependencies);
  return {
    fixture,
    attempts,
    resourceStore,
    ledgerStore,
    manifestStore,
    evaluations,
    resources: completed.resources,
    counts,
    sysonCalls,
    sysonResponses,
    artifactReads,
    get mode() {
      return mode;
    },
    set mode(value: ProviderMode) {
      mode = value;
    },
    get sysonFails() {
      return sysonFails;
    },
    set sysonFails(value: boolean) {
      sysonFails = value;
    },
    executor,
    executorWith(overrides) {
      return new VerifyRunFeaStaticProofV2RunExecutor({
        ...baseDependencies,
        ...overrides,
      });
    },
    executorFor({ tamper }) {
      if (tamper === "plan") {
        return new VerifyRunFeaStaticProofV2RunExecutor({
          ...baseDependencies,
          plans: {
            async read(reference) {
              const plan = await fixture.plans.read(reference);
              return {
                ...plan,
                sources: plan.sources.map((source) =>
                  source.bindingName === "proofCase"
                    ? {
                      ...source,
                      artifact: {
                        ...source.artifact,
                        byteCount: source.artifact.byteCount + 1,
                      },
                    }
                    : source
                ),
              };
            },
          },
        });
      }
      const ledgerCaptureStore = tamper === "ledger-absent"
        ? {
          uriFor: (fingerprint: { algorithm: "sha256"; digest: string }) =>
            ledgerStore.uriFor(fingerprint),
          read: () => Promise.resolve(undefined),
        }
        : tamper === "ledger-tampered"
        ? {
          uriFor: (fingerprint: { algorithm: "sha256"; digest: string }) =>
            ledgerStore.uriFor(fingerprint),
          async read(fingerprint: { algorithm: "sha256"; digest: string }) {
            const opened = await ledgerStore.read(fingerprint);
            if (!opened) return undefined;
            const bytes = opened.copy();
            bytes[0] = bytes[0]! ^ 1;
            return immutableBytes(bytes);
          },
        }
        : tamper === "ledger-uri"
        ? {
          uriFor: (fingerprint: { algorithm: "sha256"; digest: string }) =>
            `casys://transplanted-ledger/sha256/${fingerprint.digest}`,
          read: (fingerprint: { algorithm: "sha256"; digest: string }) =>
            ledgerStore.read(fingerprint),
        }
        : baseDependencies.ledgerCaptureStore;
      const resourceCaptureStore = tamper === "resource-uri"
        ? {
          uriFor: (fingerprint: { algorithm: "sha256"; digest: string }) =>
            `casys://transplanted-resource/sha256/${fingerprint.digest}`,
          read: (fingerprint: { algorithm: "sha256"; digest: string }) =>
            resourceStore.read(fingerprint),
        }
        : baseDependencies.resourceCaptureStore;
      const artifacts = tamper === "proof"
        ? {
          readArtifact(artifact: {
            id: string;
            uri?: string;
            mediaType?: string;
          }) {
            artifactReads.push(artifact.id);
            return Promise.resolve(
              artifact.uri && artifact.mediaType
                ? {
                  uri: artifact.uri,
                  mediaType: artifact.mediaType,
                  byteCount: 1,
                  sha256: fixture.proofArtifact.fingerprint.digest,
                  bytes: Uint8Array.from([0]),
                }
                : undefined,
            );
          },
        }
        : tamper === "requirements-absent" || tamper === "requirements-tampered"
        ? {
          async readArtifact(artifact: {
            id: string;
            uri?: string;
            mediaType?: string;
          }) {
            if (artifact.id !== fixture.requirementsArtifact.id) {
              return await baseDependencies.artifacts.readArtifact(artifact);
            }
            artifactReads.push(artifact.id);
            if (tamper === "requirements-absent") return undefined;
            return artifact.uri && artifact.mediaType
              ? {
                uri: artifact.uri,
                mediaType: artifact.mediaType,
                byteCount: 1,
                sha256: fixture.requirementsArtifact.fingerprint.digest,
                bytes: Uint8Array.from([0]),
              }
              : undefined;
          },
        }
        : baseDependencies.artifacts;
      return new VerifyRunFeaStaticProofV2RunExecutor({
        ...baseDependencies,
        ledgerCaptureStore,
        resourceCaptureStore,
        artifacts,
        canonicalAssets: tamper === "step"
          ? { read: () => Promise.resolve(Uint8Array.from([1, 2, 3])) }
          : baseDependencies.canonicalAssets,
      });
    },
    async planSha256() {
      const project = await fixture.projects.get(fixture.projectId);
      const run = project!.agentRuns.find((item) => item.id === fixture.runId)!;
      const plan = await fixture.plans.read(run.resolvedOperationPlan!);
      return (await fingerprintResolvedOperationPlanV2(plan)).digest;
    },
    requestId: () => Promise.resolve(requestId),
    async seedResourcesCaptured() {
      const project = await fixture.projects.get(fixture.projectId);
      const run = project!.agentRuns.find((item) => item.id === fixture.runId)!;
      const plan = await fixture.plans.read(run.resolvedOperationPlan!);
      await attempts.begin({
        projectId: fixture.projectId,
        runId: fixture.runId,
        planSha256: (await fingerprintResolvedOperationPlanV2(plan)).digest,
        requestId: completed.requestId,
        preparedAt: "2026-08-12T04:00:00.000Z",
      });
      await attempts.markDispatched({
        projectId: fixture.projectId,
        runId: fixture.runId,
        dispatchedAt: "2026-08-12T04:00:01.000Z",
      });
      await attempts.recordProviderRun({
        projectId: fixture.projectId,
        runId: fixture.runId,
        requestSha256: completed.requestSha256,
        providerRunId: completed.runId,
        resources: completed.resources,
      });
      const captured = await providerCaptures.capture({
        provider: { id: "mcp-calculix", runId: completed.runId },
        resources: completed.resources,
      });
      await attempts.recordResourcesCaptured({
        projectId: fixture.projectId,
        runId: fixture.runId,
        captureManifest: {
          uri: captured.storedManifest.uri,
          byteCount: captured.storedManifest.byteCount,
          sha256: captured.storedManifest.fingerprint.digest,
        },
      });
    },
  };
}

async function transplantWalCasUri(
  runtime: Runtime,
  field: "captureManifest" | "evaluationCapture",
  namespace: string,
): Promise<void> {
  const path = await runtime.attempts.pathFor(
    runtime.fixture.projectId,
    runtime.fixture.runId,
  );
  const attempt = JSON.parse(await Deno.readTextFile(path)) as Record<
    string,
    unknown
  >;
  const reference = attempt[field] as Record<string, unknown> | undefined;
  if (!reference || typeof reference.sha256 !== "string") {
    throw new Error(`fixture WAL has no ${field}`);
  }
  reference.uri = `casys://${namespace}/sha256/${reference.sha256}`;
  await Deno.writeTextFile(path, `${deterministicJson(attempt)}\n`);
}

async function providerResources(step: Uint8Array) {
  const profile = [
    ["input.step", "model/step", step],
    [
      "request.json",
      "application/json",
      new TextEncoder().encode('{"request":"recorded"}'),
    ],
    ["mesh.geo", "text/plain", new TextEncoder().encode("mesh geo")],
    ["mesh.inp", "text/plain", new TextEncoder().encode("mesh inp")],
    ["gmsh.log", "text/plain", new TextEncoder().encode("gmsh log")],
    ["job.inp", "text/plain", new TextEncoder().encode("job inp")],
    ["ccx.log", "text/plain", new TextEncoder().encode("ccx log")],
    ["job.dat", "text/plain", new TextEncoder().encode("job dat")],
    [
      "result.json",
      "application/json",
      new TextEncoder().encode('{"result":"recorded"}'),
    ],
  ] as const;
  return await Promise.all(profile.map(async ([role, mediaType, bytes]) => {
    const sha256 = await fingerprintResourceBytes(bytes);
    return {
      role,
      uri: `casys://calculix-provider/sha256/${sha256}`,
      mediaType,
      byteCount: bytes.byteLength,
      sha256,
      bytes: Uint8Array.from(bytes),
    };
  }));
}

function resultFor(plan: CalculixRecordedStaticPlan) {
  return {
    inputArtifact: {
      uri: `casys://calculix-provider/sha256/${plan.expectedInput.fingerprint.digest}`,
      mediaType: "model/step",
      byteCount: plan.expectedInput.byteCount,
      sha256: plan.expectedInput.fingerprint.digest,
    },
    mesh: { nodes: 10, elements: 5, nodesPerSelection: { fixture: 1 } },
    constraints: {
      fixedSelections: ["fixture-support"],
      loads: [{ selection: "fixture-load", forceN: [0, 0, -1] as const }],
    },
    metrics: {
      maximumDisplacement: {
        value: 0.1,
        unit: "mm" as const,
        nodeId: 1,
        vectorMm: [0.1, 0, 0] as const,
      },
      maximumVonMises: { value: 1, unit: "MPa" as const, elementId: 1 },
    },
  };
}
