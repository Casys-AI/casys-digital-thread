import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
} from "../../domain/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project-brief-command-service.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import {
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
} from "../../orchestration/operations/registry.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_PROJECT_ID,
  COFFEE_MACHINE_CM01_V3_SUBJECT_ID,
  COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION,
  CoffeeMachineCm01V3ThermalRunExecutor,
} from "./coffee-machine-cm01-v3-thermal-run-executor.ts";
import {
  CM01_NOMINAL_MODELICA_MODEL,
  CM01_NOMINAL_MODELICA_SCENARIO,
  type Cm01NominalModelicaCapture,
} from "../cm01-nominal-modelica-capture.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { FileCm01NominalModelicaAttemptStore } from "../file-cm01-nominal-modelica-attempt-store.ts";
import { FileEngineeringProjectRunLease } from "../file-engineering-project-run-lease.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../engineering-project-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { FileThreadSnapshotStore } from "../file-thread-snapshot-store.ts";
import { LiveThreadUpdateStore } from "../live-thread-update-store.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

const THERMAL_OPERATION: RegisteredEngineeringOperation = {
  ...COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Run nominal thermal simulation",
  description: "Capture the reviewed CM-01 nominal thermal evidence.",
  workItemKind: "simulate",
  riskClass: "consequential",
  execution: "trusted",
  bindings: [{ name: "approvedBrief", allowedSourceKinds: ["approved-brief"] }],
};

const OPERATIONS: EngineeringProjectPlanOperationRegistry = {
  validate(input) {
    const candidate = input as {
      operation?: { id?: unknown; version?: unknown; bindings?: unknown };
      stage?: unknown;
      basisKind?: unknown;
    };
    if (
      candidate.operation?.id !== THERMAL_OPERATION.id ||
      candidate.operation.version !== THERMAL_OPERATION.version
    ) {
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(
        input as RegisteredEngineeringOperationInput,
      );
    }
    const bindings = candidate.operation.bindings;
    if (
      (candidate.stage !== "planning" && candidate.stage !== "queue") ||
      (candidate.stage === "queue" && candidate.basisKind !== "thread-snapshot") ||
      !Array.isArray(bindings) || bindings.length !== 1 ||
      bindings[0]?.name !== "approvedBrief" ||
      bindings[0]?.source?.kind !== "approved-brief"
    ) throw new Error("Invalid CM-01 thermal operation input.");
    return {
      operation: THERMAL_OPERATION,
      stage: candidate.stage,
      ...(candidate.stage === "queue" ? { basisKind: "thread-snapshot" as const } : {}),
      bindings: structuredClone(bindings),
    };
  },
};

Deno.test("CM-01 V3 thermal executor captures one closed Modelica run and publishes an evidence-only descendant", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-thermal-executor-" });
  try {
    const fixture = await queuedThermal(directory);
    const capture = new FakeCapture();
    const executor = thermalExecutor(fixture, capture);
    const command = executionCommand(fixture.queued);

    const completed = await executor.execute(AGENT, command);
    const run = completed.agentRuns.find((item) => item.id === command.runId);
    assertExists(run);
    assertEquals(run.status, "completed");
    assertEquals(run.resultSnapshot?.subjectId, COFFEE_MACHINE_CM01_V3_SUBJECT_ID);
    assertEquals(capture.calls, 1);
    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    assertEquals(snapshot.requirements.length, 0);
    assertEquals(snapshot.evaluations.length, 0);
    assertEquals(snapshot.observations.map((item) => item.metric).sort(), [
      "heater_energy",
      "heater_power_peak",
      "time_to_target_temperature",
      "water_temperature_max",
    ]);
    assertEquals(
      (await fixture.liveUpdates.list(COFFEE_MACHINE_CM01_V3_SUBJECT_ID)).map((item) =>
        item.state
      ),
      ["running", "fresh", "reconciled"],
    );

    const replay = await executor.execute(AGENT, command);
    assertEquals(replay.revision, completed.revision);
    assertEquals(capture.calls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 thermal executor refuses a foreign project before it calls Modelica", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-thermal-executor-" });
  try {
    const fixture = await queuedThermal(directory);
    const capture = new FakeCapture();
    const executor = thermalExecutor(fixture, capture);
    const command = executionCommand(fixture.queued);
    await assertRejects(
      () => executor.execute(HUMAN, command),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
    assertEquals(capture.calls, 0);

    const foreign = { ...command, projectId: "coffee-machine-cm01" };
    await assertRejects(
      () => executor.execute(AGENT, foreign),
      EngineeringProjectCommandError,
      "does not exist",
    );
    assertEquals(capture.calls, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 thermal executor resumes a durable capture after snapshot persistence fails without simulating twice", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-thermal-executor-" });
  try {
    const fixture = await queuedThermal(directory);
    const capture = new FakeCapture();
    const snapshots = new FailOnceSnapshotStore(fixture.snapshots);
    const executor = thermalExecutor(fixture, capture, snapshots);
    const command = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, command),
      Error,
      "snapshot persistence",
    );
    assertEquals(capture.calls, 1);
    assertEquals(
      (await fixture.projects.get(command.projectId))?.agentRuns.at(-1)?.status,
      "running",
    );

    const resumed = await executor.execute(AGENT, command);
    assertEquals(resumed.agentRuns.at(-1)?.status, "completed");
    assertEquals(capture.calls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 thermal executor fails closed when a pre-existing dispatch marker has an unknown outcome", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-thermal-executor-" });
  try {
    const fixture = await queuedThermal(directory);
    const capture = new FakeCapture();
    const command = executionCommand(fixture.queued);
    await fixture.attempts.begin({
      projectId: command.projectId,
      runId: command.runId,
      dispatchedAt: "2026-08-03T14:00:00.000Z",
    });

    await assertRejects(
      () => thermalExecutor(fixture, capture).execute(AGENT, command),
      Error,
      "will not be retried automatically",
    );
    assertEquals(capture.calls, 0);
    assertEquals(
      (await fixture.projects.get(command.projectId))?.agentRuns.at(-1)?.status,
      "failed",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function thermalExecutor(
  fixture: Awaited<ReturnType<typeof queuedThermal>>,
  capture: FakeCapture,
  snapshots: ThreadSnapshotStore = fixture.snapshots,
) {
  return new CoffeeMachineCm01V3ThermalRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots,
    capture,
    attempts: fixture.attempts,
    captures: fixture.thermalCaptures,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/thermal-leases`),
    liveUpdates: fixture.liveUpdates,
    now: () => "2026-08-03T15:00:00.000Z",
  });
}

function executionCommand(queued: Awaited<ReturnType<typeof queuedThermal>>["queued"]) {
  const run = queued.agentRuns.at(-1)!;
  return {
    commandId: "agent-run-cm01-nominal-thermal",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-03T14:00:00.000Z",
    runId: run.id,
  };
}

async function queuedThermal(directory: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const thermalCaptures = new FileCaptureStore({
    ...CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
    directory: `${directory}/thermal-captures`,
  });
  const attempts = new FileCm01NominalModelicaAttemptStore(
    `${directory}/thermal-attempts`,
  );
  const liveUpdates = new LiveThreadUpdateStore();
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-03T13:00:00.000Z") + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-v3",
    projectId: COFFEE_MACHINE_CM01_V3_PROJECT_ID,
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-03T12:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-cm01-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Create a reviewable CM-01 coffee-machine engineering record.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement:
        "Heat water to the nominal brewing temperature with the reviewed CM-01 thermal model.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Capture a nominal thermal simulation as evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-cm01-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 thermal evidence scenario is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: OPERATIONS },
    new ExactInitialBaselineEvidenceValidator(snapshots, captures),
  );
  project = await commands.publishPlan(AGENT, {
    ...context("publish-cm01-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  const baselineQueued = await commands.queueRun(AGENT, {
    ...context("queue-cm01-baseline", project.revision),
    runId: "run:cm01-brief-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });
  const baselineExecutor = new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-03T13:30:00.000Z",
  });
  const baselineCompleted = await baselineExecutor.execute(AGENT, {
    commandId: "agent-record-cm01-brief",
    projectId: COFFEE_MACHINE_CM01_V3_PROJECT_ID,
    expectedRevision: baselineQueued.revision,
    issuedAt: "2026-08-03T13:30:00.000Z",
    runId: "run:cm01-brief-baseline",
  });
  const base = baselineCompleted.threadSnapshots[0]!;
  project = await commands.appendChange(AGENT, {
    ...context("append-cm01-thermal", baselineCompleted.revision),
    baseSnapshot: base,
    phases: [{
      id: "thermal",
      name: "Thermal evidence",
      description: "Run the reviewed nominal heat-up scenario.",
    }],
    workItems: [{
      id: "simulate-cm01-nominal-thermal",
      phaseId: "thermal",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-cm01-thermal", project.revision),
    runId: "run:cm01-nominal-thermal",
    workItemId: "simulate-cm01-nominal-thermal",
    summary: "Run the reviewed CM-01 nominal thermal scenario.",
    basis: { kind: "thread-snapshot", ...base },
  });
  return {
    directory,
    projects,
    commands,
    snapshots,
    liveUpdates,
    attempts,
    thermalCaptures,
    queued,
  };
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: COFFEE_MACHINE_CM01_V3_PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-03T13:00:00.000Z",
  };
}

class FakeCapture {
  calls = 0;

  capture(): Promise<Cm01NominalModelicaCapture> {
    this.calls++;
    // mcp-modelica creates UUID-like run ids with underscores. This catches
    // accidental raw-run-id prefix matching after ThreadSnapshot slugging.
    const runId = "run_cm01_thermal_001";
    const sha = (tail: string) => `${"a".repeat(63)}${tail}`;
    const kinds = [
      "request",
      "resolved-parameters",
      "model",
      "script",
      "diagnostics",
      "result",
      "evidence",
    ] as const;
    return Promise.resolve({
      schemaVersion: "cm01-nominal-modelica-capture/1.0",
      kind: "cm01-nominal-modelica-capture",
      producer: {
        serverId: "modelica",
        simulation: { tool: "modelica_simulate", runId },
        readback: { tool: "modelica_run_get", runId },
      },
      engine: { name: "OpenModelica", version: "1.25.5", mslVersion: "4.0.0" },
      resolvedParameters: [],
      evidence: {
        runId,
        completedAt: "2026-08-03T14:05:00.000Z",
        fingerprint: { algorithm: "sha256", digest: sha("0") },
        model: {
          id: CM01_NOMINAL_MODELICA_MODEL.id,
          version: CM01_NOMINAL_MODELICA_MODEL.version,
          fingerprint: {
            algorithm: "sha256",
            digest: CM01_NOMINAL_MODELICA_MODEL.sha256,
          },
        },
        scenario: {
          id: CM01_NOMINAL_MODELICA_SCENARIO.id,
          fingerprint: {
            algorithm: "sha256",
            digest: CM01_NOMINAL_MODELICA_SCENARIO.sha256,
          },
        },
        measurements: [
          {
            id: "heater_energy",
            name: "Heater energy",
            value: 493_914.2758438271,
            unit: "J",
          },
          {
            id: "heater_power_peak",
            name: "Peak heater power",
            value: 1500,
            unit: "W",
          },
          {
            id: "time_to_target_temperature",
            name: "Time to target",
            value: 138,
            unit: "s",
          },
          {
            id: "water_temperature_max",
            name: "Maximum water temperature",
            value: 94,
            unit: "degC",
          },
        ],
        artifacts: kinds.map((kind, index) => ({
          kind,
          name: kind === "evidence" ? "Computed evidence" : `Modelica ${kind}`,
          uri: `casys://modelica/runs/${runId}/${kind}`,
          fingerprint: {
            algorithm: "sha256" as const,
            digest: kind === "model"
              ? CM01_NOMINAL_MODELICA_MODEL.sha256
              : sha(String(index + 1)),
          },
          bytes: 100 + index,
        })),
      },
      warnings: [],
    });
  }
}

class FailOnceSnapshotStore implements ThreadSnapshotStore {
  #fail = true;

  constructor(private readonly delegate: ThreadSnapshotStore) {}

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return this.delegate.get(snapshotId);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    return this.delegate.latest(subjectId);
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    if (this.#fail) {
      this.#fail = false;
      return Promise.reject(new Error("snapshot persistence interrupted"));
    }
    return this.delegate.save(snapshot);
  }
}
