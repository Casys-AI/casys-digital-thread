/**
 * Full lifecycle tests for the generic Modelica executor.
 *
 * Every test builds a schema-3.0 project through the real command service,
 * publishes a brief baseline, seals a simulation case, queues the reviewed
 * Modelica run, and uses the real file WAL. These tests therefore exercise the
 * executor catch windows and project transitions, not exported helper seams.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalSimulationCaseText,
  validateSimulationCase,
} from "../../domain/analysis/simulation-case.ts";
import {
  encodeSimulationCaseDecisionParameters,
  SIMULATE_RUN_MODELICA_SCENARIO_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
} from "../../domain/analysis/simulation-case-proposal.ts";
import {
  SIMULATION_EXECUTION_POLICY_VERSION,
  type SimulationExecutionPolicy,
} from "../../domain/analysis/simulation-execution-policy.ts";
import type {
  DynamicSystemRun,
  DynamicSystemSimulator,
  SimulationMethodCatalog,
  SimulationPlanResolver,
  SimulationRunReader,
} from "../../domain/analysis/simulation-capabilities.ts";
import { DynamicSystemResponseError } from "../../domain/analysis/simulation-capabilities.ts";
import type { EngineeringProjectCommandOrigin } from "../../domain/project/engineering-project-command-service.ts";
import { EngineeringProjectCommandService } from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  MODELICA_SCENARIO_RECEIPT_CAPTURE_DESCRIPTOR,
  MODELICA_SCENARIO_RUN_CAPTURE_DESCRIPTOR,
  SIMULATION_CASE_CAPTURE_DESCRIPTOR,
} from "../captures/file-capture-store.ts";
import {
  assertSimulateMatchesRunGet,
  parseModelicaRunRecord,
} from "../captures/modelica-scenario-run-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import {
  FileModelicaScenarioAttemptStore,
  ModelicaScenarioOutcomeUnknownError,
  ModelicaScenarioRunQuarantinedError,
} from "../wal/file-modelica-scenario-attempt-store.ts";
import { lowerModelicaSimulationCase } from "../providers/modelica/mcp-modelica-provider.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { SimulateSealSimulationCaseRunExecutor } from "./simulate-seal-simulation-case-run-executor.ts";
import {
  SimulateRunModelicaScenarioRunExecutor,
  type SimulateRunModelicaScenarioRunExecutorCommand,
} from "./simulate-run-modelica-scenario-run-executor.ts";

const AGENT: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:modelica-integration",
};
const HUMAN: EngineeringProjectCommandOrigin = {
  kind: "human",
  actorId: "human:modelica-reviewer",
};
const PROJECT_ID = "modelica-executor-integration";
const SUBJECT_ID = `project:${PROJECT_ID}`;
const PROVIDER_RUN_ID = "provider-run-integration-001";
const MODEL_SHA256 = "a".repeat(64);
const SCENARIO_SHA256 = "b".repeat(64);

const POLICY: SimulationExecutionPolicy = {
  policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
  timeoutMaxMs: 120_000,
};

const PROVIDER_RUN_ENVELOPE = {
  schemaVersion: "1.0",
  kind: "run",
  run: {
    artifacts: [{
      bytes: 64,
      kind: "evidence",
      sha256: "e".repeat(64),
      uri: "casys://modelica/evidence/integration.json",
    }, {
      bytes: 128,
      kind: "model",
      sha256: MODEL_SHA256,
      uri: "casys://modelica/model/integration.mo",
    }, {
      bytes: 512,
      kind: "result",
      sha256: "c".repeat(64),
      uri: "casys://modelica/result/integration.mat",
    }],
    completed_at: "2026-08-09T10:31:00.000Z",
    engine: {
      msl_version: "4.0.0",
      name: "OpenModelica",
      version: "1.23.0",
    },
    fingerprint: "d".repeat(64),
    metrics: { T_max: { unit: "K", value: 368.15 } },
    model: {
      id: "cm01-thermal-model",
      sha256: MODEL_SHA256,
      version: "1.0.0",
    },
    resolved_parameters: {},
    run_id: PROVIDER_RUN_ID,
    scenario: {
      id: "nominal-heatup",
      sha256: SCENARIO_SHA256,
    },
    started_at: "2026-08-09T10:30:00.000Z",
    status: "succeeded",
    warnings: [],
  },
};

Deno.test(
  "full Modelica executor provider-run-known recovery resolves the plan and invokes only the run reader",
  async () => {
    const directory = await Deno.makeTempDir();
    try {
      const fixture = await queuedModelicaRunFixture(directory);
      const planDigest = await planDigestFor(fixture);
      await fixture.attempts.begin({
        projectId: PROJECT_ID,
        runId: fixture.runId,
        planDigest,
        dispatchedAt: "2026-08-09T10:29:00.000Z",
      });
      await fixture.attempts.recordProviderRun({
        projectId: PROJECT_ID,
        runId: fixture.runId,
        planDigest,
        providerRunId: PROVIDER_RUN_ID,
        canonicalSimulateEnvelope: PROVIDER_RUN_ENVELOPE,
      });

      let resolverCalls = 0;
      let catalogCalls = 0;
      let simulatorCalls = 0;
      let readerCalls = 0;
      let attestationCalls = 0;
      const attestationFailure = new Error("stop after exact run readback");
      const expectedRun = parseExpectedProviderRun(fixture);
      const executor = fixture.executor({
        planResolver: {
          resolve: (simulationCase) => {
            resolverCalls++;
            assertEquals(simulationCase, fixture.simulationCase);
            return exactPlan(fixture);
          },
        },
        methodCatalog: {
          assertMethodAvailable: () => {
            catalogCalls++;
            return Promise.reject(new Error("catalog must stay offline"));
          },
        },
        simulator: {
          simulate: () => {
            simulatorCalls++;
            return Promise.reject(new Error("simulation must not be redispatched"));
          },
        },
        runReader: {
          normalizeRecordedRun: () => {
            throw new Error("completed-WAL normalization was not expected");
          },
          readRun: (providerRunId, expected) => {
            readerCalls++;
            assertStrictEquals(providerRunId, PROVIDER_RUN_ID);
            assertEquals(expected, caseIdentity(fixture));
            return Promise.resolve(expectedRun);
          },
          assertDispatchMatchesReadback: (canonicalDispatch, run) => {
            attestationCalls++;
            assertSimulateMatchesRunGet(canonicalDispatch, run);
            throw attestationFailure;
          },
        },
      });

      const failure = await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        Error,
        attestationFailure.message,
      );
      assertStrictEquals(failure, attestationFailure);
      assertStrictEquals(resolverCalls, 1);
      assertStrictEquals(readerCalls, 1);
      assertStrictEquals(attestationCalls, 1);
      assertStrictEquals(catalogCalls, 0);
      assertStrictEquals(simulatorCalls, 0);
      assertStrictEquals(
        await fixture.attempts.isQuarantined(PROJECT_ID, fixture.runId),
        true,
      );
      assertEquals(
        (await fixture.attempts.readRun(PROJECT_ID, fixture.runId))?.status,
        "provider-run-known",
      );
      await assertRunRemainsActiveWithoutFailureReceipt(fixture);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "full Modelica executor quarantines an acknowledged malformed response and exact retry never redispatches",
  async () => {
    const directory = await Deno.makeTempDir();
    try {
      const fixture = await queuedModelicaRunFixture(directory);
      let resolverCalls = 0;
      let catalogCalls = 0;
      let simulatorCalls = 0;
      const parseCause = new Error("provider response has no run_id");
      const malformed = new DynamicSystemResponseError(
        "modelica_simulate response is malformed",
        { cause: parseCause },
      );
      const executor = fixture.executor({
        planResolver: {
          resolve: () => {
            resolverCalls++;
            return exactPlan(fixture);
          },
        },
        methodCatalog: {
          assertMethodAvailable: () => {
            catalogCalls++;
            return Promise.resolve();
          },
        },
        simulator: {
          simulate: () => {
            simulatorCalls++;
            return Promise.reject(malformed);
          },
        },
        runReader: unreachableRunReader(),
      });

      const failure = await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        DynamicSystemResponseError,
      );
      assertStrictEquals(failure, malformed);
      assertStrictEquals(failure.cause, parseCause);
      assertStrictEquals(resolverCalls, 1);
      assertStrictEquals(catalogCalls, 1);
      assertStrictEquals(simulatorCalls, 1);
      assertEquals(
        (await fixture.attempts.readRun(PROJECT_ID, fixture.runId))?.status,
        "dispatched",
      );
      assertStrictEquals(
        await fixture.attempts.isQuarantined(PROJECT_ID, fixture.runId),
        true,
      );
      await assertRunRemainsActiveWithoutFailureReceipt(fixture);

      await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        ModelicaScenarioRunQuarantinedError,
      );
      assertStrictEquals(resolverCalls, 2, "retry may recompute only the pure plan");
      assertStrictEquals(catalogCalls, 1, "quarantine must precede method discovery");
      assertStrictEquals(simulatorCalls, 1, "quarantined retry must never redispatch");
      await assertRunRemainsActiveWithoutFailureReceipt(fixture);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "full Modelica executor preserves a transport outcome-unknown as running and retry never redispatches",
  async () => {
    const directory = await Deno.makeTempDir();
    try {
      const fixture = await queuedModelicaRunFixture(directory);
      let simulatorCalls = 0;
      let catalogCalls = 0;
      const transportCause = new Error("connection reset after request write");
      const executor = fixture.executor({
        planResolver: { resolve: () => exactPlan(fixture) },
        methodCatalog: {
          assertMethodAvailable: () => {
            catalogCalls++;
            return Promise.resolve();
          },
        },
        simulator: {
          simulate: () => {
            simulatorCalls++;
            return Promise.reject(transportCause);
          },
        },
        runReader: unreachableRunReader(),
      });

      const failure = await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        ModelicaScenarioOutcomeUnknownError,
      );
      assertStrictEquals(failure.cause, transportCause);
      assertStrictEquals(simulatorCalls, 1);
      assertStrictEquals(catalogCalls, 1);
      assertEquals(
        (await fixture.attempts.readRun(PROJECT_ID, fixture.runId))?.status,
        "dispatched",
      );
      assertStrictEquals(
        await fixture.attempts.isQuarantined(PROJECT_ID, fixture.runId),
        false,
      );
      await assertRunRemainsActiveWithoutFailureReceipt(fixture);

      await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        ModelicaScenarioOutcomeUnknownError,
      );
      assertStrictEquals(simulatorCalls, 1, "dispatched retry must never redispatch");
      assertStrictEquals(catalogCalls, 1, "known WAL must not rediscover the method");
      await assertRunRemainsActiveWithoutFailureReceipt(fixture);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "full Modelica executor may fail the claimed run only before any provider issue",
  async () => {
    const directory = await Deno.makeTempDir();
    try {
      const fixture = await queuedModelicaRunFixture(directory);
      let simulatorCalls = 0;
      const preAcknowledgementFailure = new Error("qualified method unavailable");
      const executor = fixture.executor({
        planResolver: { resolve: () => exactPlan(fixture) },
        methodCatalog: {
          assertMethodAvailable: () => Promise.reject(preAcknowledgementFailure),
        },
        simulator: {
          simulate: () => {
            simulatorCalls++;
            return Promise.reject(new Error("provider must not be issued"));
          },
        },
        runReader: unreachableRunReader(),
      });

      const failure = await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        Error,
        preAcknowledgementFailure.message,
      );
      assertStrictEquals(failure, preAcknowledgementFailure);
      assertStrictEquals(simulatorCalls, 0);
      assertStrictEquals(
        await fixture.attempts.readRun(PROJECT_ID, fixture.runId),
        undefined,
      );
      assertStrictEquals(
        await fixture.attempts.isQuarantined(PROJECT_ID, fixture.runId),
        false,
      );
      const project = await fixture.projects.get(PROJECT_ID);
      assertExists(project);
      const run = project.agentRuns.find((candidate) => candidate.id === fixture.runId);
      assertExists(run);
      assertStrictEquals(run.status, "failed");
      assertEquals(run.failure, {
        code: "simulate-modelica-scenario-not-published",
        message: "Modelica scenario run stopped before durable evidence was published.",
      });
      assertStrictEquals(
        project.commandReceipts?.some((receipt) => receipt.type === "agent-run.fail"),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

interface CapabilityDoubles {
  readonly planResolver: SimulationPlanResolver;
  readonly methodCatalog: SimulationMethodCatalog;
  readonly simulator: DynamicSystemSimulator;
  readonly runReader: SimulationRunReader;
}

interface ModelicaRunFixture {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: FileThreadSnapshotStore;
  readonly attempts: FileModelicaScenarioAttemptStore;
  readonly caseCaptures: FileCaptureStore<"simulation-case">;
  readonly recordCaptures: FileCaptureStore<"modelica-scenario-run">;
  readonly receiptCaptures: FileCaptureStore<"modelica-scenario-receipt">;
  readonly simulationCase: ReturnType<typeof validateSimulationCase>;
  readonly caseDigest: string;
  readonly runId: string;
  readonly command: SimulateRunModelicaScenarioRunExecutorCommand;
  executor(capabilities: CapabilityDoubles): SimulateRunModelicaScenarioRunExecutor;
}

async function queuedModelicaRunFixture(
  directory: string,
): Promise<ModelicaRunFixture> {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const caseCaptures = new FileCaptureStore({
    ...SIMULATION_CASE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/case-captures`,
  });
  const recordCaptures = new FileCaptureStore({
    ...MODELICA_SCENARIO_RUN_CAPTURE_DESCRIPTOR,
    directory: `${directory}/record-captures`,
  });
  const receiptCaptures = new FileCaptureStore({
    ...MODELICA_SCENARIO_RECEIPT_CAPTURE_DESCRIPTOR,
    directory: `${directory}/receipt-captures`,
  });
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const attempts = new FileModelicaScenarioAttemptStore(`${directory}/attempts`);
  let tick = 0;
  const baseTime = Date.parse("2026-08-09T10:00:00.000Z");
  const now = () => new Date(baseTime + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-modelica-integration",
    projectId: PROJECT_ID,
    projectName: "Modelica executor integration",
    issuedAt: "2026-08-09T10:00:00.000Z",
    intent: "Exercise the governed Modelica recovery state machine.",
    intentSource: { kind: "human", reference: "conversation:modelica-integration" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Record governed Modelica observations.",
      sourceRefs: [{ kind: "intent", reference: "conversation:modelica-integration" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Seal and execute a qualified thermal scenario.",
      sourceRefs: [{ kind: "intent", reference: "conversation:modelica-integration" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Uncertain dispatches remain recoverable without duplicate execution.",
      sourceRefs: [{ kind: "intent", reference: "conversation:modelica-integration" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved for the executor integration test.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const sourceAnalysis = approvedBriefSourceAnalysisFixture(directory);
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      sourceAnalysis,
    ),
  );

  project = await commands.publishPlan(AGENT, {
    ...context("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline-phase",
      name: "Baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "baseline-item",
      phaseId: "baseline-phase",
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
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline", project.revision),
    runId: "run:modelica-baseline",
    workItemId: "baseline-item",
    summary: "Record approved brief baseline.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...sourceAnalysis,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now,
  }).execute(AGENT, {
    commandId: "execute-baseline",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-09T10:05:00.000Z",
    runId: "run:modelica-baseline",
  });
  const baselineRef = baselined.agentRuns.find((run) =>
    run.id === "run:modelica-baseline"
  )!.resultSnapshot!;

  const simulationCase = validateSimulationCase({
    schemaVersion: "simulation-case/1.0",
    id: "coffee-machine-cm01-thermal-nominal-v1",
    revision: 1,
    scope: "thermal-nominal",
    evidenceBoundary: "demo",
    project: {
      id: PROJECT_ID,
      subjectId: SUBJECT_ID,
      baseThreadSnapshot: {
        id: baselineRef.snapshotId,
        revision: baselineRef.revision,
        subjectId: baselineRef.subjectId,
      },
    },
    kit: {
      modelId: "cm01-thermal-model",
      modelVersion: "1.0.0",
      modelSha256: MODEL_SHA256,
    },
    scenario: { id: "nominal-heatup", sha256: SCENARIO_SHA256 },
    parameters: [],
    expectedMetrics: [{ id: "T_max", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 60_000,
  });
  const caseDigest = (await sha256Fingerprint(simulationCase)).digest;

  project = await commands.appendChange(AGENT, {
    ...context("append-seal", baselined.revision),
    baseSnapshot: baselineRef,
    phases: [{
      id: "seal-phase",
      name: "Seal simulation case",
      description: "Seal the reviewed case.",
    }],
    workItems: [{
      id: "seal-item",
      phaseId: "seal-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["baseline-item"],
      decisionIds: ["seal-decision"],
      operation: {
        id: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id,
        version: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "seal-decision",
      phaseId: "seal-phase",
      title: "Approve simulation case seal",
      question: "Approve the exact thermal case?",
    }],
  });
  project = await commands.proposeDecision(AGENT, {
    ...context("propose-seal", project.revision),
    decisionId: "seal-decision",
    baseSnapshot: baselineRef,
    proposal: {
      summary: "Seal the exact thermal simulation case.",
      parameters: [
        ...encodeSimulationCaseDecisionParameters(caseDigest, simulationCase),
      ],
    },
  });
  project = await commands.approveDecision(HUMAN, {
    ...context("approve-seal", project.revision),
    decisionId: "seal-decision",
    rationale: "Approved exact case seal.",
    inputFingerprint: project.decisions.find((decision) =>
      decision.id === "seal-decision"
    )!.inputFingerprint!,
  });
  project = await commands.queueRun(AGENT, {
    ...context("queue-seal", project.revision),
    runId: "run:modelica-seal",
    workItemId: "seal-item",
    summary: "Seal the reviewed thermal case.",
    basis: { kind: "thread-snapshot", ...baselineRef },
  });
  const sealed = await new SimulateSealSimulationCaseRunExecutor({
    projects,
    commands,
    snapshots,
    simulationCaseCaptures: caseCaptures,
    lease: new FileEngineeringProjectRunLease(`${directory}/seal-leases`),
    readTextFile: () => Promise.resolve(canonicalSimulationCaseText(simulationCase)),
    now,
  }).execute(AGENT, {
    commandId: "execute-seal",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-09T10:15:00.000Z",
    runId: "run:modelica-seal",
  });
  const sealRef = sealed.agentRuns.find((run) => run.id === "run:modelica-seal")!
    .resultSnapshot!;
  const sealSnapshot = await snapshots.get(sealRef.snapshotId);
  assertExists(sealSnapshot);
  const caseArtifact = sealSnapshot.artifacts.find((artifact) =>
    artifact.uri?.startsWith("casys://simulation-case-capture/") &&
    artifact.version === caseDigest
  );
  assertExists(caseArtifact);
  const caseArtifactRef = {
    snapshotId: sealRef.snapshotId,
    snapshotRevision: sealRef.revision,
    kind: "artifact" as const,
    id: caseArtifact.id,
  };

  project = await commands.appendChange(AGENT, {
    ...context("append-modelica-run", sealed.revision),
    baseSnapshot: sealRef,
    phases: [{
      id: "modelica-run-phase",
      name: "Run Modelica scenario",
      description: "Execute the exact sealed case.",
    }],
    workItems: [{
      id: "modelica-run-item",
      phaseId: "modelica-run-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["seal-item"],
      decisionIds: ["modelica-run-decision"],
      operation: {
        id: SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.id,
        version: SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.version,
        bindings: [{
          name: "simulationCase",
          source: { kind: "thread-entity", reference: caseArtifactRef },
        }],
      },
    }],
    requiredDecisions: [{
      id: "modelica-run-decision",
      phaseId: "modelica-run-phase",
      title: "Approve Modelica execution",
      question: "Approve execution of the exact sealed case?",
    }],
  });
  project = await commands.proposeDecision(AGENT, {
    ...context("propose-modelica-run", project.revision),
    decisionId: "modelica-run-decision",
    baseSnapshot: sealRef,
    proposal: {
      summary: "Execute the exact sealed thermal case.",
      parameters: [
        ...encodeSimulationCaseDecisionParameters(caseDigest, simulationCase),
      ],
    },
  });
  project = await commands.approveDecision(HUMAN, {
    ...context("approve-modelica-run", project.revision),
    decisionId: "modelica-run-decision",
    rationale: "Approved exact Modelica execution.",
    inputFingerprint: project.decisions.find((decision) =>
      decision.id === "modelica-run-decision"
    )!.inputFingerprint!,
  });
  const runId = "run:modelica-execution";
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-modelica-run", project.revision),
    runId,
    workItemId: "modelica-run-item",
    summary: "Execute the reviewed Modelica scenario.",
    basis: { kind: "thread-snapshot", ...sealRef },
  });
  const command: SimulateRunModelicaScenarioRunExecutorCommand = {
    commandId: "execute-modelica-run",
    projectId: PROJECT_ID,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-09T10:30:00.000Z",
    runId,
  };

  const fixture: ModelicaRunFixture = {
    projects,
    commands,
    snapshots,
    attempts,
    caseCaptures,
    recordCaptures,
    receiptCaptures,
    simulationCase,
    caseDigest,
    runId,
    command,
    executor(capabilities) {
      return new SimulateRunModelicaScenarioRunExecutor({
        projects,
        commands,
        snapshots,
        caseCaptures,
        recordCaptures,
        receiptCaptures,
        attempts,
        ...capabilities,
        policy: POLICY,
        lease: new FileEngineeringProjectRunLease(`${directory}/run-leases`),
        now,
      });
    },
  };
  return fixture;
}

function exactPlan(fixture: ModelicaRunFixture) {
  return {
    exactDispatchRecord: lowerModelicaSimulationCase(fixture.simulationCase),
    readbackOperation: {
      serverId: "modelica",
      operationId: "modelica_run_get",
    },
  };
}

async function planDigestFor(fixture: ModelicaRunFixture): Promise<string> {
  return (await sha256Fingerprint({
    caseDigest: fixture.caseDigest,
    exactSimulateRequest: exactPlan(fixture).exactDispatchRecord,
    policyVersion: POLICY.policyVersion,
  })).digest;
}

function caseIdentity(fixture: ModelicaRunFixture) {
  return {
    kit: {
      modelId: fixture.simulationCase.kit.modelId,
      modelVersion: fixture.simulationCase.kit.modelVersion,
      modelSha256: fixture.simulationCase.kit.modelSha256,
    },
    scenario: fixture.simulationCase.scenario,
    parameters: fixture.simulationCase.parameters,
    expectedMetrics: fixture.simulationCase.expectedMetrics,
  };
}

function parseExpectedProviderRun(fixture: ModelicaRunFixture): DynamicSystemRun {
  return parseModelicaRunRecord(PROVIDER_RUN_ENVELOPE, caseIdentity(fixture));
}

function unreachableRunReader(): SimulationRunReader {
  return {
    normalizeRecordedRun: () => {
      throw new Error("run normalization must not be reached");
    },
    readRun: () => Promise.reject(new Error("run readback must not be reached")),
    assertDispatchMatchesReadback: () => {
      throw new Error("run attestation must not be reached");
    },
  };
}

async function assertRunRemainsActiveWithoutFailureReceipt(
  fixture: ModelicaRunFixture,
): Promise<void> {
  const project = await fixture.projects.get(PROJECT_ID);
  assertExists(project);
  const run = project.agentRuns.find((candidate) => candidate.id === fixture.runId);
  assertExists(run);
  assertStrictEquals(run.status, "running");
  assertStrictEquals(run.failure, undefined);
  assertStrictEquals(
    project.commandReceipts?.some((receipt) => receipt.type === "agent-run.fail"),
    false,
  );
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-09T10:00:00.000Z",
  };
}
