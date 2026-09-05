import { assert, assertEquals, assertRejects } from "@std/assert";
import { CapabilityRuntimeSessionUnavailableError } from "../../../application/control-plane/capability-runtime-execution-session.ts";
import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { PersistedModelicaIsolatedExecutionCapture } from "../../../application/ports/out/modelica/isolated-execution-evidence-store.ts";
import type { ModelicaIsolatedExecutionProfile } from "../../../application/ports/out/modelica/isolated-execution-profile.ts";
import {
  type ExecuteIsolatedModelicaRunInput,
  type ExecuteIsolatedModelicaRunResult,
  IsolatedQualifiedModelicaOutputValidationRejectedError,
} from "../../../application/use-cases/modelica/qualified-kit/execute-isolated-run.ts";
import { deriveModelicaIsolatedExecutionRunId } from "../../../application/use-cases/modelica/qualified-kit/execute-isolated-run.ts";
import { PrepareProjectModelicaQualifiedKitRunReview } from "../../../application/use-cases/modelica/qualified-kit/prepare-run-review.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { EngineeringProjectCommandService } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  FixedModelicaIsolatedExecutionProfileCatalog,
  MODELICA_MICROSANDBOX_WORKER_IMAGE,
} from "./execution-profile.ts";
import { createModelicaMicrosandboxQualificationKit } from "./kit-v1/qualification-kit.ts";
import {
  createModelicaIsolatedExecutionCapture,
  type ModelicaIsolatedExecutionCapture,
} from "../../../domain/modelica/qualified-kit/isolated-execution-evidence.ts";
import {
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  type ModelicaIsolatedEvidence,
  type PreparedModelicaIsolatedInputBundle,
} from "../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
  type ModelicaMicrosandboxQualificationReference,
} from "../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import {
  encodeModelicaQualifiedKitRunAdmissionParameters,
  MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
} from "../../../domain/modelica/qualified-kit/run-proposal.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  SimulateRunQualifiedModelicaKitRunExecutor,
  type SimulateRunQualifiedModelicaKitRunExecutorDependencies,
} from "./run-executor.ts";
import {
  type RecordingCapabilityRuntimeSession,
  recordingCapabilityRuntimeSession,
  testResolvedCapabilityRuntimeOperation,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";

const AT = "2026-08-14T00:00:00.000Z";
const AGENT = { kind: "agent" as const, actorId: "agent.modelica" };
const COMMAND = {
  commandId: "execute.modelica.qualified",
  projectId: "project.motor",
  expectedRevision: 1,
  issuedAt: AT,
  runId: "run.modelica.qualified",
};

Deno.test("qualified Modelica executor requires an agent and reopens admission before isolated execution", async () => {
  const denied = await createFixture();
  await assertRejects(
    () =>
      denied.executor.execute({ kind: "human", actorId: "human.reviewer" }, COMMAND),
    Error,
    "Only an authenticated agent",
  );
  assertEquals(denied.review.calls, 0);
  assertEquals(denied.execution.executeCalls, 0);

  const admitted = await createFixture();
  await admitted.executor.execute(AGENT, COMMAND);
  assertEquals(admitted.execution.executeCalls, 1);
  assertEquals(
    admitted.events.indexOf("review") < admitted.events.indexOf("execute"),
    true,
  );
});

Deno.test("qualified Modelica executor publishes three documentary solver artifacts and one observation", async () => {
  const fixture = await createFixture();
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(runStatus(completed), "completed");
  assertEquals(fixture.execution.executeCalls, 1);
  const result = completed.agentRuns[0]!.resultSnapshot!;
  const snapshot = await fixture.snapshots.getFresh(result.snapshotId);
  assert(snapshot);
  const ownArtifacts = snapshot.artifacts.filter((artifact) =>
    artifact.producer.runId === COMMAND.runId
  );
  assertEquals(ownArtifacts.length, 3);
  assertEquals(ownArtifacts.map((artifact) => artifact.kind).sort(), [
    "document",
    "evidence",
    "solver-result",
  ]);
  assertEquals(ownArtifacts.map((artifact) => artifact.inputArtifactIds), [[], [], []]);
  assertEquals(
    snapshot.observations.map((observation) => ({
      metric: observation.metric,
      quantity: observation.quantity,
    })),
    [{ metric: "temperature_final", quantity: { value: 22, unit: "degC" } }],
  );
  assertEquals(snapshot.requirements, []);
  assertEquals(snapshot.evaluations, []);
  assertEquals(snapshot.violations, []);
  assertEquals(snapshot.proposedActions, []);
  assertEquals(completed.agentRuns[0]!.evidenceRefs.length, 3);
  assertEquals(completed.threadSnapshots.at(-1), {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  });
});

Deno.test("qualified Modelica executor starts the exact JIT microVM session before execution and releases it on completion", async () => {
  const fixture = await createFixture();
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(runStatus(completed), "completed");
  assertEquals(fixture.capabilitySession.events, ["begin"]);
  assertEquals(fixture.capabilitySession.releases, 1);
  assertEquals(fixture.capabilitySession.microsandboxExecutionProfiles?.length, 1);
  assertEquals(fixture.execution.executeCalls, 1);
});

Deno.test("qualified Modelica executor leaves its queued run unchanged when JIT activation fails", async () => {
  const fixture = await createFixture({ sessionUnavailable: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "exact qualified Modelica capability session is unavailable",
  );
  assertEquals(runStatus(fixture.project), "queued");
  assertEquals(fixture.project.workItems[0]?.status, "in-progress");
  assertEquals(fixture.project.commandReceipts.length, 0);
  assertEquals(fixture.capabilitySession.events, ["begin"]);
  assertEquals(fixture.execution.executeCalls, 0);
});

Deno.test("completed qualified Modelica replay only reopens durable evidence", async () => {
  const fixture = await createFixture();
  const first = await fixture.executor.execute(AGENT, COMMAND);
  const saved = fixture.snapshots.saveCalls;
  const reopened = fixture.execution.reopenCalls;
  const second = await fixture.executor.execute(AGENT, {
    ...COMMAND,
    expectedRevision: first.revision,
  });
  assertEquals(second, first);
  assertEquals(fixture.execution.executeCalls, 1);
  assertEquals(fixture.execution.reopenCalls, reopened + 1);
  assertEquals(fixture.snapshots.saveCalls, saved);
});

Deno.test("completed replay reconstructs the original claim for the real command service", async () => {
  const fixture = await createFixture();
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  const revisions = new Map(
    fixture.project.commandReceipts.map((receipt) => [
      receipt.resultingSnapshot.revision,
      {
        ...structuredClone(fixture.project),
        id: receipt.resultingSnapshot.snapshotId,
        revision: receipt.resultingSnapshot.revision,
      } as EngineeringProjectSnapshot,
    ]),
  );
  let commits = 0;
  const store = {
    get: () => Promise.resolve(fixture.project),
    getRevision: (_projectId: string, revision: number) =>
      Promise.resolve(revisions.get(revision)),
    commit: () => {
      commits += 1;
      return Promise.reject(new Error("an exact replay must never commit"));
    },
  } as unknown as EngineeringProjectRevisionStore;
  const executor = new SimulateRunQualifiedModelicaKitRunExecutor({
    ...fixture.dependencies,
    projects: store,
    commands: new EngineeringProjectCommandService(store),
  });

  const replayed = await executor.execute(AGENT, {
    ...COMMAND,
    // Deliberately current rather than the original pre-claim revision. The
    // executor must recover revision 1 from the immutable claim receipt.
    expectedRevision: completed.revision,
  });

  assertEquals(runStatus(replayed), "completed");
  assertEquals(fixture.execution.executeCalls, 1);
  assertEquals(commits, 0);
});

Deno.test("publishing replay uses reopenCompleted and never executes the isolated run twice", async () => {
  const fixture = await createFixture({ publishAckLostOnce: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "publish acknowledgement lost",
  );
  assertEquals(runStatus(fixture.project), "publishing");
  assertEquals(fixture.execution.executeCalls, 1);
  const completed = await fixture.executor.execute(AGENT, {
    ...COMMAND,
    expectedRevision: fixture.project.revision,
  });
  assertEquals(runStatus(completed), "completed");
  assertEquals(fixture.execution.executeCalls, 1);
  assertEquals(fixture.execution.reopenCalls, 1);
});

Deno.test("admission and capture drift fail closed without another isolated execution", async () => {
  const admission = await createFixture();
  const decision = admission.project.decisions[0] as MutableDecision;
  decision.proposal = {
    ...decision.proposal!,
    parameters: [{
      ...decision.proposal!.parameters[0]!,
      value: "foreign-qualified-kit",
    }],
  };
  await assertRejects(
    () => admission.executor.execute(AGENT, COMMAND),
    Error,
  );
  assertEquals(admission.execution.executeCalls, 0);

  const capture = await createFixture();
  const completed = await capture.executor.execute(AGENT, COMMAND);
  capture.captures.drift = true;
  await assertRejects(
    () =>
      capture.executor.execute(AGENT, {
        ...COMMAND,
        expectedRevision: completed.revision,
      }),
    Error,
  );
  assertEquals(capture.execution.executeCalls, 1);
});

Deno.test("foreign operation plans, approval tampering and qualification drift stop before dispatch", async () => {
  const legacy = await createFixture();
  (legacy.project.workItems[0] as MutableWork).operation = {
    id: "simulate.run-modelica-scenario",
    version: "2",
    bindings: [],
  };
  await assertRejects(
    () => legacy.executor.execute(AGENT, COMMAND),
    Error,
    "simulate.run-qualified-modelica-kit@1",
  );
  assertEquals(legacy.review.calls, 0);
  assertEquals(legacy.execution.executeCalls, 0);

  const planned = await createFixture();
  const plannedRun = planned.project.agentRuns[0] as MutableRun;
  plannedRun.resolvedOperationPlan = {
    schemaVersion: "resolved-operation-plan-ref/1.0",
    planId: "foreign-modelica-plan",
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    byteCount: 1,
    casUri: `casys://resolved-operation-plan/sha256/${"a".repeat(64)}`,
  };
  await assertRejects(
    () => planned.executor.execute(AGENT, COMMAND),
    Error,
    "no resolved plan",
  );
  assertEquals(planned.review.calls, 0);
  assertEquals(planned.execution.executeCalls, 0);

  const approval = await createFixture();
  (approval.project.approvals[0] as MutableApproval).decidedByOrigin = "agent";
  await assertRejects(
    () => approval.executor.execute(AGENT, COMMAND),
    Error,
    "human approval",
  );
  assertEquals(approval.review.calls, 0);
  assertEquals(approval.execution.executeCalls, 0);

  const qualification = await createFixture();
  qualification.review.qualificationDrift = true;
  await assertRejects(
    () => qualification.executor.execute(AGENT, COMMAND),
    Error,
    "profile, qualification",
  );
  assertEquals(qualification.review.calls, 1);
  assertEquals(qualification.execution.executeCalls, 0);
});

Deno.test("basis-scoped lease admits one concurrent qualified Modelica execution", async () => {
  const fixture = await createFixture({ blockExecution: true });
  const first = fixture.executor.execute(AGENT, COMMAND);
  await fixture.execution.started;
  const second = fixture.executor.execute(AGENT, COMMAND);
  fixture.execution.release();
  const [one, two] = await Promise.all([first, second]);
  assertEquals(runStatus(one), "completed");
  assertEquals(runStatus(two), "completed");
  assertEquals(fixture.execution.executeCalls, 1);
  assertEquals(fixture.execution.reopenCalls, 1);
  assertEquals(fixture.snapshots.saveCalls, 1);
});

Deno.test("qualified Modelica fails the claimed run on output-validation rejection without Thread write", async () => {
  const fixture = await createFixture({ rejectOutputValidation: true });
  const beforeSnapshots = [...fixture.project.threadSnapshots];
  const failed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(runStatus(failed), "failed");
  assertEquals(failed.agentRuns[0]?.failure?.code, "isolated_output_validation_failed");
  assertEquals(failed.agentRuns[0]?.failure?.message.includes("evidence"), true);
  assertEquals(failed.threadSnapshots, beforeSnapshots);
  assertEquals(fixture.execution.executeCalls, 1);
  assertEquals(fixture.snapshots.saveCalls, 0);

  const replayed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(runStatus(replayed), "failed");
  assertEquals(fixture.execution.executeCalls, 1);
  assertEquals(replayed.threadSnapshots, beforeSnapshots);
});

Deno.test("qualified Modelica refuses a divergent fail code on output-validation replay without redispatch", async () => {
  const fixture = await createFixture({ rejectOutputValidation: true });
  await fixture.executor.execute(AGENT, COMMAND);
  const run = fixture.project.agentRuns[0] as MutableRun;
  run.failure = {
    code: "isolated_execution_rejected",
    message: run.failure!.message,
  };
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "evidence-free terminal failure",
  );
  assertEquals(fixture.execution.executeCalls, 1);
});

Deno.test("qualified Modelica refuses a divergent fail receipt on output-validation replay without redispatch", async () => {
  const fixture = await createFixture({ rejectOutputValidation: true });
  await fixture.executor.execute(AGENT, COMMAND);
  const receipts = fixture.project.commandReceipts;
  const index = receipts.findIndex((item) => item.type === "agent-run.fail");
  assertEquals(index >= 0, true);
  receipts[index] = {
    ...receipts[index]!,
    requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
  };
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "agent-run.fail receipt",
  );
  assertEquals(fixture.execution.executeCalls, 1);
});

interface FixtureOptions {
  readonly publishAckLostOnce?: boolean;
  readonly blockExecution?: boolean;
  readonly rejectOutputValidation?: boolean;
  readonly sessionUnavailable?: boolean;
}

interface Fixture {
  readonly executor: SimulateRunQualifiedModelicaKitRunExecutor;
  readonly project: MutableProject;
  readonly review: FakeReview;
  readonly execution: FakeExecution;
  readonly captures: FakeCaptures;
  readonly snapshots: FakeSnapshots;
  readonly dependencies: SimulateRunQualifiedModelicaKitRunExecutorDependencies;
  readonly events: string[];
  readonly capabilitySession: RecordingCapabilityRuntimeSession;
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const profile = await modelicaProfile();
  const bundle =
    (await createModelicaMicrosandboxQualificationKit(profile.method.engine)).bundle;
  const qualification: ModelicaMicrosandboxQualificationReference = {
    schemaVersion: MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
    uri:
      `casys://modelica-microsandbox-qualification/sha256/${MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT.digest}`,
    fingerprint: MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
    executionProfileFingerprint: profile.profileFingerprint,
  };
  const modelFingerprint = await sha256Fingerprint({ model: "motor" });
  const modelArtifact = {
    id: "artifact.model.motor",
    name: "Motor model",
    kind: "sysml-model" as const,
    version: modelFingerprint.digest,
    fingerprint: modelFingerprint,
    uri: `casys://sysml/sha256/${modelFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "capture", runId: "run.syson" },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const basis = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread.motor.1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "subject.motor",
      name: "Motor",
      kind: "system",
      version: "1",
      modelArtifactId: modelArtifact.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "changes.motor.1",
      name: "Motor baseline",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.model.motor",
        kind: "created",
        target: { kind: "artifact", id: modelArtifact.id },
        summary: "Captured the exact motor model.",
        afterFingerprint: modelArtifact.fingerprint,
      }],
    },
    artifacts: [modelArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.model.motor",
      relation: "changes",
      from: { kind: "change", id: "change.model.motor" },
      to: { kind: "artifact", id: modelArtifact.id },
      rationale: "Created the exact model baseline.",
    }],
    proposedActions: [],
  });
  const reviewCommand = {
    projectId: COMMAND.projectId,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
  };
  const reviewService = new PrepareProjectModelicaQualifiedKitRunReview({
    basisAuthority: { reopenExact: () => Promise.resolve(reviewCommand) },
    profiles: {
      initial: () => Promise.resolve(profile),
      resolve: () => Promise.resolve(profile),
    },
    qualifications: { reopenQualified: () => Promise.resolve(qualification) },
    bundleFactory: { prepare: () => Promise.resolve(cloneBundle(bundle)) },
  });
  const prepared = await reviewService.prepareForExecution(reviewCommand);
  const basisRef = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basisRef };
  const proposal = {
    summary: "Run the exact qualified local Modelica conformance kit.",
    parameters: encodeModelicaQualifiedKitRunAdmissionParameters(prepared.admission),
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs: [],
    proposal,
  });
  const operation = {
    ...SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
    bindings: [],
  };
  const runFingerprint = await sha256Fingerprint({
    workItemId: "work.modelica.qualified",
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: "decision.modelica.qualified",
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: "project.motor:r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: COMMAND.projectId,
      name: "Motor",
      subjectId: basis.subject.id,
      objective: { title: "Motor", statement: "Run solver conformance." },
    },
    threadSnapshots: [basisRef],
    phases: [{
      id: "phase.simulate",
      name: "Simulate",
      order: 1,
      description: "Run local Modelica.",
      workItemIds: ["work.modelica.qualified"],
      requiredDecisionIds: ["decision.modelica.qualified"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.modelica.qualified",
      activityId: "activity:work.modelica.qualified",
      phaseId: "phase.simulate",
      title: "Run qualified Modelica",
      description: "Run the fixed local kit.",
      kind: "simulate",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["decision.modelica.qualified"],
      blockerIds: [],
    }],
    agentRuns: [{
      id: COMMAND.runId,
      workItemId: "work.modelica.qualified",
      status: "queued",
      summary: "Run qualified Modelica.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: "decision.modelica.qualified",
      phaseId: "phase.simulate",
      title: "Qualified Modelica run",
      question: "Run the exact qualified kit?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: ["approval.modelica.qualified"],
      proposal: {
        ...proposal,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: AGENT.kind },
      },
    }],
    approvals: [{
      id: "approval.modelica.qualified",
      decisionId: "decision.modelica.qualified",
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: "human.reviewer",
      decidedByOrigin: "human",
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const events: string[] = [];
  const review = new FakeReview(prepared, events);
  const captures = new FakeCaptures();
  const executionResult = await isolatedResult({
    profile,
    qualification,
    bundle,
    reviewedRunFingerprint: runFingerprint,
    captures,
  });
  const execution = new FakeExecution(
    executionResult,
    events,
    options.blockExecution,
    options.rejectOutputValidation,
  );
  const snapshots = new FakeSnapshots(basis);
  const commands = new FakeCommands(project, options);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const capabilitySession = recordingCapabilityRuntimeSession(
    options.sessionUnavailable
      ? () =>
        Promise.reject(
          new CapabilityRuntimeSessionUnavailableError(
            "The exact qualified Modelica capability session is unavailable.",
          ),
        )
      : undefined,
  );
  const capabilityRuntime = {
    requireExecution: () =>
      Promise.resolve(testResolvedCapabilityRuntimeOperation({
        projectId: COMMAND.projectId,
        operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
        capabilityId: "simulation.run-qualified-modelica",
        unitId: "casys.modelica-worker",
        materialId: "modelica-worker-image",
        imageDigest: profile.runtimeBackend.imageDigest.digest,
        hostLifecycleKind: "ephemeral-microsandbox",
      })),
  };
  const dependencies = {
    projects,
    commands,
    snapshots,
    review,
    execution,
    captures,
    lease: new SerialLease(),
    capabilityRuntime,
    capabilityRuntimeSession: capabilitySession,
  } as unknown as SimulateRunQualifiedModelicaKitRunExecutorDependencies;
  return {
    executor: new SimulateRunQualifiedModelicaKitRunExecutor(dependencies),
    project,
    review,
    execution,
    captures,
    snapshots,
    dependencies,
    events,
    capabilitySession,
  };
}

class FakeReview {
  calls = 0;
  qualificationDrift = false;
  constructor(
    readonly result: Awaited<
      ReturnType<PrepareProjectModelicaQualifiedKitRunReview["prepareForExecution"]>
    >,
    readonly events: string[],
  ) {}
  prepareForExecution() {
    this.calls += 1;
    this.events.push("review");
    if (this.qualificationDrift) {
      return Promise.resolve({
        ...this.result,
        admission: {
          ...this.result.admission,
          execution: {
            ...this.result.admission.execution,
            runtimeQualification: {
              ...this.result.admission.execution.runtimeQualification,
              fingerprint: {
                algorithm: "sha256" as const,
                digest: "f".repeat(64),
              },
            },
          },
        },
      });
    }
    return Promise.resolve(this.result);
  }
}

class FakeExecution {
  executeCalls = 0;
  reopenCalls = 0;
  readonly started: Promise<void>;
  #announce!: () => void;
  #release!: () => void;
  #released: Promise<void>;
  #rejected = false;
  constructor(
    readonly result: ExecuteIsolatedModelicaRunResult,
    readonly events: string[],
    readonly blocked = false,
    readonly rejectOutputValidation = false,
  ) {
    this.started = new Promise((resolve) => this.#announce = resolve);
    this.#released = new Promise((resolve) => this.#release = resolve);
    if (!blocked) this.#release();
  }
  #rejection() {
    return new IsolatedQualifiedModelicaOutputValidationRejectedError({
      executionRunId: "run.modelica.qualified-exec",
      observation: { role: "evidence", byteCount: 32, sha256: "7".repeat(64) },
      destruction: {
        status: "proven",
        runId: "run.modelica.qualified-exec",
        proofFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      },
    });
  }
  async execute(_input: ExecuteIsolatedModelicaRunInput) {
    this.executeCalls += 1;
    this.events.push("execute");
    this.#announce();
    await this.#released;
    if (this.rejectOutputValidation) {
      this.#rejected = true;
      throw this.#rejection();
    }
    return this.result;
  }
  reopenCompleted(_input: ExecuteIsolatedModelicaRunInput) {
    this.reopenCalls += 1;
    this.events.push("reopen");
    return Promise.resolve(this.result);
  }
  reopenOutputValidationRejection() {
    if (this.#rejected || this.rejectOutputValidation) {
      throw this.#rejection();
    }
    return Promise.resolve();
  }
  release() {
    this.#release();
  }
}

class FakeCaptures {
  readonly items = new Map<string, ModelicaIsolatedExecutionCapture>();
  drift = false;
  async save(capture: ModelicaIsolatedExecutionCapture) {
    const fingerprint = await sha256Fingerprint(capture);
    this.items.set(fingerprint.digest, structuredClone(capture));
    return {
      capture,
      fingerprint,
      uri: this.uriFor(fingerprint),
    } satisfies PersistedModelicaIsolatedExecutionCapture;
  }
  read(fingerprint: ContentFingerprint) {
    const capture = this.items.get(fingerprint.digest);
    if (!capture) return Promise.resolve(undefined);
    if (!this.drift) return Promise.resolve(structuredClone(capture));
    return Promise.resolve({
      ...structuredClone(capture),
      executedAt: "2099-01-01T00:00:00.000Z",
    } as unknown as ModelicaIsolatedExecutionCapture);
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://modelica-qualified-execution/sha256/${fingerprint.digest}`;
  }
}

class FakeSnapshots {
  readonly items = new Map<string, ThreadSnapshot>();
  saveCalls = 0;
  constructor(...snapshots: ThreadSnapshot[]) {
    for (const snapshot of snapshots) {
      this.items.set(snapshot.id, structuredClone(snapshot));
    }
  }
  get(id: string) {
    const value = this.items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }
  getFresh(id: string) {
    return this.get(id);
  }
  latest(subjectId: string) {
    const value =
      [...this.items.values()].filter((item) => item.subject.id === subjectId).sort((
        a,
        b,
      ) => b.revision - a.revision)[0];
    return Promise.resolve(value && structuredClone(value));
  }
  save(snapshot: ThreadSnapshot) {
    this.saveCalls += 1;
    const existing = this.items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(new Error("immutable snapshot rewrite"));
    }
    this.items.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }
}

class FakeCommands {
  publishCalls = 0;
  #publishAckLostOnce: boolean;
  constructor(readonly project: MutableProject, options: FixtureOptions) {
    this.#publishAckLostOnce = options.publishAckLostOnce ?? false;
  }
  async claimRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      run.summary = command.summary;
      this.project.revision += 1;
      this.project.commandReceipts.push(
        await commandReceipt(
          "agent-run.claim",
          origin,
          command,
          this.project.revision,
        ),
      );
      run.statusHistory = [...(run.statusHistory ?? []), {
        commandId: command.commandId,
        status: "running",
        at: AT,
        actor: { id: origin.actorId, origin: origin.kind },
        summary: command.summary,
      }];
    }
    return this.project;
  }
  async publishRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    this.publishCalls += 1;
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "running") {
      run.status = "publishing";
      this.project.revision += 1;
      this.project.commandReceipts.push(
        await commandReceipt(
          "agent-run.publish",
          origin,
          command,
          this.project.revision,
        ),
      );
      if (this.#publishAckLostOnce) {
        this.#publishAckLostOnce = false;
        throw new Error("publish acknowledgement lost after durable commit");
      }
    }
    return this.project;
  }
  async completeRun(
    origin: EngineeringProjectCommandOrigin,
    command: CompleteRunCommand,
  ) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status !== "completed") {
      run.status = "completed";
      run.completedAt = AT;
      run.resultSnapshot = command.resultSnapshot;
      run.evidenceRefs = [...command.evidenceRefs];
      const work = this.project.workItems[0] as MutableWork;
      work.status = "completed";
      work.evidenceRefs = [...command.evidenceRefs];
      (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
      this.project.threadSnapshots.push(command.resultSnapshot);
      this.project.revision += 1;
      this.project.commandReceipts.push(
        await commandReceipt(
          "agent-run.complete",
          origin,
          command,
          this.project.revision,
        ),
      );
    }
    return this.project;
  }
  async failRun(origin: EngineeringProjectCommandOrigin, command: FailRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "failed") return this.project;
    run.status = "failed";
    run.completedAt = AT;
    run.failure = { code: command.code, message: command.message };
    run.summary = command.summary;
    this.project.revision += 1;
    this.project.commandReceipts.push(
      await commandReceipt(
        "agent-run.fail",
        origin,
        command,
        this.project.revision,
      ),
    );
    run.statusHistory = [...(run.statusHistory ?? []), {
      commandId: command.commandId,
      status: "failed",
      at: AT,
      actor: { id: origin.actorId, origin: origin.kind },
      summary: command.summary,
    }];
    return this.project;
  }
}

class SerialLease {
  #tail: Promise<void> = Promise.resolve();
  async withLease<T>(_projectId: string, _scope: string, operation: () => Promise<T>) {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => release = resolve);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function isolatedResult(input: {
  readonly profile: ModelicaIsolatedExecutionProfile;
  readonly qualification: ModelicaMicrosandboxQualificationReference;
  readonly bundle: PreparedModelicaIsolatedInputBundle;
  readonly reviewedRunFingerprint: ContentFingerprint;
  readonly captures: FakeCaptures;
}): Promise<ExecuteIsolatedModelicaRunResult> {
  const resultBytes = new TextEncoder().encode(
    `time,temperatureC\n${
      Array.from({ length: 21 }, (_, index) => `${index / 10},${20 + index / 10}`).join(
        "\n",
      )
    }\n`,
  );
  const evidence: ModelicaIsolatedEvidence = {
    schemaVersion: "modelica-isolated-evidence/1.0",
    inputBundleSha256: input.bundle.fingerprint.digest,
    status: "succeeded",
    method: input.bundle.document.method,
    resolvedParameters: input.bundle.document.invocation.parameters.map((
      parameter,
    ) => ({
      id: parameter.id,
      modelicaName: parameter.modelicaName,
      value: parameter.inputValue,
      unit: parameter.inputUnit,
      modelicaValue: parameter.modelicaValue,
      modelicaUnit: parameter.modelicaUnit,
    })),
    metrics: [{ id: "temperature_final", value: 22, unit: "degC" }],
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
    warnings: [],
  };
  const evidenceBytes = new TextEncoder().encode(deterministicJson(evidence));
  const bytesByRole = new Map([
    ["evidence", evidenceBytes],
    ["result", resultBytes],
  ]);
  const executionRunId = await deriveModelicaIsolatedExecutionRunId({
    projectId: COMMAND.projectId,
    agentRunId: COMMAND.runId,
  });
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: "isolated-code-execution-request/1.0",
    runId: executionRunId,
    producerGeneration: 0,
    profile: input.profile.executionProfile,
    source: {
      bytes: input.bundle.bytes,
      sha256: input.bundle.fingerprint.digest,
    },
    policy: input.profile.isolationPolicy,
    outputs: input.profile.outputManifest,
  });
  const outputs = await Promise.all(MODELICA_ISOLATED_OUTPUT_MANIFEST.map(
    async (declaration) => {
      const bytes = bytesByRole.get(declaration.role)!;
      const sha256 = await fingerprintResourceBytes(bytes);
      return {
        ...declaration,
        bytes,
        byteCount: bytes.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
      };
    },
  ));
  const publication = await createIsolatedOutputPublicationRef(
    executionRunId,
    0,
    await fingerprintIsolatedOutputPublicationManifest(
      executionRunId,
      0,
      outputs.map(({ bytes: _bytes, ...output }) => output),
    ),
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: input.profile.runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs,
    destruction: {
      status: "proven",
      runId: executionRunId,
      proofFingerprint: await sha256Fingerprint({ destroyed: executionRunId }),
    },
    publication,
  });
  const capture = await createModelicaIsolatedExecutionCapture({
    schemaVersion: "modelica-qualified-kit-execution-capture/1.0",
    operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
    projectId: COMMAND.projectId,
    agentRunId: COMMAND.runId,
    executionRunId,
    reviewedRunFingerprint: input.reviewedRunFingerprint,
    bundle: {
      fingerprint: input.bundle.fingerprint,
      byteCount: input.bundle.bytes.byteLength,
      caseSha256: input.bundle.document.qualification.caseSha256,
      manifestSha256: input.bundle.document.qualification.manifestSha256,
      sourceCaptureSha256: input.bundle.document.qualification.sourceCaptureSha256,
    },
    executionProfileFingerprint: input.profile.profileFingerprint,
    runtimeQualification: input.qualification,
    generationRecovery: null,
    receipt: isolatedCodeExecutionReceiptRecord(receipt),
    evidence,
  });
  const persisted = await input.captures.save(capture);
  return {
    executionRunId,
    receipt,
    evidence,
    capture,
    captureReference: {
      schemaVersion: "modelica-qualified-kit-execution-capture-reference/1.0",
      uri: persisted.uri,
      fingerprint: persisted.fingerprint,
    },
  };
}

async function modelicaProfile(): Promise<ModelicaIsolatedExecutionProfile> {
  return await new FixedModelicaIsolatedExecutionProfileCatalog({
    imageReference: MODELICA_MICROSANDBOX_WORKER_IMAGE,
    policy: {
      id: "modelica-microsandbox-deny-all-v1",
      version: "1.0.0",
      fingerprint: {
        algorithm: "sha256",
        digest: "acd119309fd7827a09b31babdd01a46e27f9839b02145dc8e01b480d904ccabe",
      },
    },
    limits: {
      maxWallTimeMs: 120_000,
      maxCpuTimeMs: 120_000,
      maxMemoryBytes: 3_221_225_472,
      maxProcesses: 64,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      maxOutputFileBytes: 16_777_216,
      maxOutputTotalBytes: 17_825_792,
    },
    engine: { name: "OpenModelica", version: "1.27.0", mslVersion: "4.1.0" },
  }).initial();
}

async function commandReceipt(
  type:
    | "agent-run.claim"
    | "agent-run.publish"
    | "agent-run.complete"
    | "agent-run.fail",
  origin: EngineeringProjectCommandOrigin,
  command: RunCommand | CompleteRunCommand | FailRunCommand,
  revision: number,
): Promise<EngineeringProjectCommandReceipt> {
  return {
    commandId: command.commandId,
    type,
    actor: { id: origin.actorId, origin: origin.kind },
    issuedAt: command.issuedAt,
    appliedAt: AT,
    requestFingerprint: await sha256Fingerprint({ type, origin, command }),
    resultingSnapshot: {
      snapshotId: `project.receipt.${revision}`,
      revision,
    },
  };
}

function cloneBundle(
  bundle: PreparedModelicaIsolatedInputBundle,
): PreparedModelicaIsolatedInputBundle {
  return {
    document: structuredClone(bundle.document),
    text: bundle.text,
    bytes: Uint8Array.from(bundle.bytes),
    fingerprint: structuredClone(bundle.fingerprint),
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function runStatus(project: EngineeringProjectSnapshot) {
  return project.agentRuns.find((run) => run.id === COMMAND.runId)?.status;
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  decisions: Array<EngineeringProjectSnapshot["decisions"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};
type MutableRun = {
  -readonly [K in keyof MutableProject["agentRuns"][number]]:
    MutableProject["agentRuns"][number][K];
};
type MutableWork = {
  -readonly [K in keyof MutableProject["workItems"][number]]:
    MutableProject["workItems"][number][K];
};
type MutablePhase = {
  -readonly [K in keyof MutableProject["phases"][number]]:
    MutableProject["phases"][number][K];
};
type MutableDecision = {
  -readonly [K in keyof MutableProject["decisions"][number]]:
    MutableProject["decisions"][number][K];
};
type MutableApproval = {
  -readonly [K in keyof MutableProject["approvals"][number]]:
    MutableProject["approvals"][number][K];
};
