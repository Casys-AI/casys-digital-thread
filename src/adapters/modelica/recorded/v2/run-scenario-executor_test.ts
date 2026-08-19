import { assert, assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { ModelicaRecordedScenarioAttemptIntegrityError } from "./recorded-scenario-attempt-store.ts";
import {
  createRecordedModelicaV2Fixture,
  InstrumentedRecordedModelicaProvider,
  RECORDED_MODELICA_V2_AGENT,
  type RecordedModelicaV2Fixture,
} from "../../../../testing/recorded-modelica-v2-fixture.ts";
import { SimulateRunModelicaScenarioV2RunExecutor } from "./run-scenario-executor.ts";

Deno.test("recorded Modelica @2 executes the true seal-to-ROP pipeline once and publishes observations without a verdict", async () => {
  await withFixture(async (fixture) => {
    const provider = new InstrumentedRecordedModelicaProvider(fixture);
    const executor = createExecutor(fixture, provider);
    const queued = await requiredProject(fixture);

    const completed = await executor.execute(
      RECORDED_MODELICA_V2_AGENT,
      fixture.command(queued.revision),
    );
    assertEquals(runStatus(completed, fixture.runId), "completed");
    assertEquals(provider.submitCalls, 1);
    assertEquals(provider.requestGetCalls, 1);
    assertEquals(provider.verifyCalls, 1);
    assertEquals(provider.resourceReads, 10);

    const snapshotRef = completed.threadSnapshots.at(-1)!;
    const snapshot = await fixture.snapshots.get(snapshotRef.snapshotId);
    assert(snapshot, "the recorded run must persist its exact successor snapshot");
    const ownArtifacts = snapshot.artifacts.filter((artifact) =>
      artifact.producer.runId === fixture.runId
    );
    assertEquals(
      ownArtifacts.length,
      10,
      "the closed provider profile includes run.json",
    );
    const queuedRun = completed.agentRuns.find((run) => run.id === fixture.runId)!;
    const plan = await fixture.plans.read(queuedRun.resolvedOperationPlan!);
    const expectedInputs = plan.sources.map((source) => source.threadRef.id);
    assertEquals(
      ownArtifacts.map((artifact) => artifact.inputArtifactIds),
      ownArtifacts.map(() => expectedInputs),
      "every provider artifact derives from the exact sealed ROP sources",
    );
    const observation = snapshot.observations.find((item) =>
      item.id === `modelica-v2-${fixture.runId}-observation-temperature`
    );
    assertEquals(
      observation && [observation.metric, observation.quantity],
      ["temperature", { value: 91, unit: "degC" }],
    );
    assertEquals(observation?.source.operation, {
      serverId: "mcp-modelica",
      tool: "modelica_simulation_submit",
      runId: "run_12345678-1234-4234-8234-123456789abc",
    });
    const evidence = ownArtifacts.find((artifact) =>
      artifact.name === "Recorded Modelica evidence"
    )!;
    const runJson = ownArtifacts.find((artifact) =>
      artifact.name === "Recorded Modelica run.json"
    )!;
    assertEquals(observation?.source.artifactIds, [evidence.id, runJson.id]);
    assert(
      snapshot.provenance.some((link) =>
        link.relation === "derived_from" && link.from.kind === "observation" &&
        link.from.id === observation?.id && link.to.kind === "artifact" &&
        link.to.id === runJson.id
      ),
      "provider run identity must remain exact Thread provenance, not a transient binding proof",
    );
    assertEquals(snapshot.requirements, []);
    assertEquals(snapshot.evaluations, []);
    assertEquals(snapshot.violations, []);
    assertEquals(snapshot.proposedActions, []);
    assertEquals(
      snapshot.analysisGraph,
      fixture.sealedSnapshot.analysisGraph,
      "the run preserves the qualified-case graph and adds no decision/evaluation claims",
    );
    assertEquals(
      (snapshot as unknown as Record<string, unknown>).verdict,
      undefined,
      "recorded Modelica remains observational; no verdict is materialized",
    );

    const replay = await executor.execute(
      RECORDED_MODELICA_V2_AGENT,
      fixture.command(completed.revision),
    );
    assertEquals(replay.revision, completed.revision, "completed replay is a no-op");
    assertEquals(provider.submitCalls, 1);
    assertEquals(provider.requestGetCalls, 1);
    assertEquals(provider.resourceReads, 10);
  });
});

Deno.test("recorded Modelica @2 preserves a lost submit acknowledgement as dispatched and retries with request_get only", async () => {
  await withFixture(async (fixture) => {
    const provider = new InstrumentedRecordedModelicaProvider(fixture);
    provider.submitMode = "lost-ack";
    const executor = createExecutor(fixture, provider);
    const queued = await requiredProject(fixture);

    await assertRejects(
      () =>
        executor.execute(RECORDED_MODELICA_V2_AGENT, fixture.command(queued.revision)),
      Error,
      "lost acknowledgement",
    );
    assertEquals(provider.submitCalls, 1);
    assertEquals(provider.requestGetCalls, 0);
    assertEquals(provider.resourceReads, 0);
    const dispatched = await fixture.attempts.read(fixture.projectId, fixture.runId);
    assertEquals(dispatched?.status, "dispatched");
    const running = await requiredProject(fixture);
    assertEquals(runStatus(running, fixture.runId), "running");

    const completed = await executor.execute(
      RECORDED_MODELICA_V2_AGENT,
      fixture.command(running.revision),
    );
    assertEquals(runStatus(completed, fixture.runId), "completed");
    assertEquals(
      provider.submitCalls,
      1,
      "a durable dispatch marker prohibits redispatch",
    );
    assertEquals(provider.requestGetCalls, 1);
    assertEquals(provider.resourceReads, 10);
  });
});

Deno.test("recorded Modelica @2 resumes provider-run-known through the exact readback route", async () => {
  await withFixture(async (fixture) => {
    const provider = new InstrumentedRecordedModelicaProvider(fixture);
    provider.failNextRequestGet = true;
    const executor = createExecutor(fixture, provider);
    const queued = await requiredProject(fixture);

    await assertRejects(
      () =>
        executor.execute(RECORDED_MODELICA_V2_AGENT, fixture.command(queued.revision)),
      Error,
      "readback interruption",
    );
    const known = await fixture.attempts.read(fixture.projectId, fixture.runId);
    assertEquals(known?.status, "provider-run-known");
    assertEquals(provider.submitCalls, 1);
    assertEquals(provider.requestGetCalls, 1);
    assertEquals(provider.resourceReads, 0);

    const running = await requiredProject(fixture);
    const completed = await executor.execute(
      RECORDED_MODELICA_V2_AGENT,
      fixture.command(running.revision),
    );
    assertEquals(runStatus(completed, fixture.runId), "completed");
    assertEquals(provider.submitCalls, 1);
    assertEquals(provider.requestGetCalls, 2);
    assertEquals(provider.resourceReads, 10);
  });
});

Deno.test("recorded Modelica @2 resumes resources-captured only from local CAS", async () => {
  await withFixture(async (fixture) => {
    const provider = new InstrumentedRecordedModelicaProvider(fixture);
    let failSave = true;
    const snapshots = new Proxy(fixture.snapshots, {
      get(target, property, receiver) {
        if (property === "save") {
          return async (...args: Parameters<ThreadSnapshotStore["save"]>) => {
            if (failSave) {
              failSave = false;
              throw new Error("simulated snapshot persistence interruption");
            }
            return await target.save(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ThreadSnapshotStore;
    const interrupted = createExecutor(fixture, provider, snapshots);
    const queued = await requiredProject(fixture);
    await assertRejects(
      () =>
        interrupted.execute(
          RECORDED_MODELICA_V2_AGENT,
          fixture.command(queued.revision),
        ),
      Error,
      "snapshot persistence interruption",
    );
    const captured = await fixture.attempts.read(fixture.projectId, fixture.runId);
    assertEquals(captured?.status, "resources-captured");
    const callsBeforeRecovery = {
      submit: provider.submitCalls,
      requestGet: provider.requestGetCalls,
      reads: provider.resourceReads,
      verify: provider.verifyCalls,
    };

    const running = await requiredProject(fixture);
    const completed = await createExecutor(fixture, provider).execute(
      RECORDED_MODELICA_V2_AGENT,
      fixture.command(running.revision),
    );
    assertEquals(runStatus(completed, fixture.runId), "completed");
    assertEquals(
      {
        submit: provider.submitCalls,
        requestGet: provider.requestGetCalls,
        reads: provider.resourceReads,
        verify: provider.verifyCalls,
      },
      callsBeforeRecovery,
      "post-capture recovery cannot contact the provider",
    );
  });
});

Deno.test("recorded Modelica @2 rejects canonical WAL evidence tampering against intact CAS without provider I/O", async () => {
  await withFixture(async (fixture) => {
    const provider = new InstrumentedRecordedModelicaProvider(fixture);
    let failSave = true;
    const snapshots = new Proxy(fixture.snapshots, {
      get(target, property, receiver) {
        if (property === "save") {
          return async (...args: Parameters<ThreadSnapshotStore["save"]>) => {
            if (failSave) {
              failSave = false;
              throw new Error("simulated snapshot persistence interruption");
            }
            return await target.save(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ThreadSnapshotStore;
    const queued = await requiredProject(fixture);
    await assertRejects(
      () =>
        createExecutor(fixture, provider, snapshots).execute(
          RECORDED_MODELICA_V2_AGENT,
          fixture.command(queued.revision),
        ),
      Error,
      "snapshot persistence interruption",
    );
    const captured = await fixture.attempts.read(fixture.projectId, fixture.runId);
    assertEquals(captured?.status, "resources-captured");

    const walPath = await fixture.attempts.pathFor(
      fixture.projectId,
      fixture.runId,
    );
    const wal = JSON.parse(await Deno.readTextFile(walPath)) as {
      evidence: { metrics: { temperature: { value: number } } };
    };
    wal.evidence.metrics.temperature.value = 999;
    await Deno.writeTextFile(walPath, `${deterministicJson(wal)}\n`);
    const forged = await fixture.attempts.read(fixture.projectId, fixture.runId);
    assert(
      forged?.status === "resources-captured",
      "the forged WAL remains structurally valid and canonical",
    );
    assertEquals(forged.evidence.metrics.temperature?.value, 999);

    const providerCalls = {
      submit: provider.submitCalls,
      requestGet: provider.requestGetCalls,
      reads: provider.resourceReads,
      verify: provider.verifyCalls,
    };
    const running = await requiredProject(fixture);
    await assertRejects(
      () =>
        createExecutor(fixture, provider).execute(
          RECORDED_MODELICA_V2_AGENT,
          fixture.command(running.revision),
        ),
      ModelicaRecordedScenarioAttemptIntegrityError,
      "WAL evidence diverges from the exact CAS capture",
    );
    const refused = await requiredProject(fixture);
    assertEquals(refused.revision, running.revision);
    assertEquals(refused.threadSnapshots, running.threadSnapshots);
    assertEquals(runStatus(refused, fixture.runId), "running");
    assertEquals(
      {
        submit: provider.submitCalls,
        requestGet: provider.requestGetCalls,
        reads: provider.resourceReads,
        verify: provider.verifyCalls,
      },
      providerCalls,
      "CAS-only re-attestation cannot contact or reread the provider",
    );
  });
});

Deno.test("recorded Modelica @2 refuses a tampered ROP or sealed CAS source before claim, WAL, and provider access", async () => {
  const modes: readonly {
    readonly label: string;
    readonly bindingName?: string;
  }[] = [
    { label: "plan" },
    { label: "simulationCase", bindingName: "simulationCase" },
    { label: "modelSource", bindingName: "modelSource" },
    { label: "scenarioSource", bindingName: "scenarioSource" },
    { label: "parameterSchema", bindingName: "parameterSchema" },
  ];
  for (const mode of modes) {
    await withFixture(async (fixture) => {
      const provider = new InstrumentedRecordedModelicaProvider(fixture);
      const queued = await requiredProject(fixture);
      const run = queued.agentRuns.find((item) => item.id === fixture.runId)!;
      if (mode.bindingName === undefined) {
        const ref = run.resolvedOperationPlan!;
        await Deno.writeTextFile(
          `${fixture.directory}/resolved-operation-plans/${ref.fingerprint.digest}`,
          "{}",
        );
      } else {
        const plan = await fixture.plans.read(run.resolvedOperationPlan!);
        const source = plan.sources.find((entry) =>
          entry.bindingName === mode.bindingName
        );
        assert(source, `${mode.label} must be present in the real fixture plan`);
        await Deno.writeTextFile(
          mode.bindingName === "simulationCase"
            ? `${fixture.directory}/simulation-cases/${source.artifact.fingerprint.digest}`
            : `${fixture.directory}/qualified-source-bytes/${source.artifact.fingerprint.digest}`,
          "tampered",
        );
      }
      await assertRejects(
        () =>
          createExecutor(fixture, provider).execute(
            RECORDED_MODELICA_V2_AGENT,
            fixture.command(queued.revision),
          ),
        Error,
      );
      assertEquals(provider.submitCalls, 0, `${mode.label} tamper must precede submit`);
      assertEquals(
        provider.requestGetCalls,
        0,
        `${mode.label} tamper must precede readback`,
      );
      assertEquals(
        provider.resourceReads,
        0,
        `${mode.label} tamper must precede resources`,
      );
      assertEquals(
        await fixture.attempts.read(fixture.projectId, fixture.runId),
        undefined,
        `${mode.label} tamper must precede WAL claim`,
      );
      const stillQueued = await requiredProject(fixture);
      assertEquals(runStatus(stillQueued, fixture.runId), "queued");
    });
  }
});

function createExecutor(
  fixture: RecordedModelicaV2Fixture,
  provider: InstrumentedRecordedModelicaProvider,
  snapshots: ThreadSnapshotStore = fixture.snapshots,
): SimulateRunModelicaScenarioV2RunExecutor {
  return new SimulateRunModelicaScenarioV2RunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots,
    plans: fixture.plans,
    lease: fixture.lease,
    attempts: fixture.attempts,
    sources: fixture.sources,
    provider,
    captures: fixture.createCaptureService(provider.resourceReader),
    capturedResources: fixture.capturedResources,
    captureLedgers: fixture.captureLedgers,
    captureManifests: fixture.captureManifests,
    now: () => "2026-08-12T00:40:00.000Z",
  });
}

function runStatus(
  project: Awaited<ReturnType<RecordedModelicaV2Fixture["projects"]["get"]>>,
  runId: string,
) {
  return project!.agentRuns.find((run) => run.id === runId)?.status;
}

async function requiredProject(fixture: RecordedModelicaV2Fixture) {
  const project = await fixture.projects.get(fixture.projectId);
  if (!project) throw new Error("Fixture project disappeared.");
  return project;
}

async function withFixture(
  body: (fixture: RecordedModelicaV2Fixture) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-recorded-modelica-v2-" });
  try {
    await body(await createRecordedModelicaV2Fixture(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
