import { assertEquals, assertRejects } from "@std/assert";
import {
  deriveEngineeringProjectStatus,
  type EngineeringApprovedDiscoveryBasis,
  type EngineeringOperationRef,
  type EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectCompletionEvidenceValidator,
  type EngineeringProjectInitialCompletionEvidenceValidator,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectRevisionStore,
  type PublishProjectPlanCommand,
} from "./engineering-project-command-service.ts";
import {
  collectEngineeringProjectIssues,
  validateEngineeringProjectSnapshot,
} from "./engineering-project-validation.ts";
import { sha256Fingerprint } from "./deterministic-json.ts";
import type { ProjectDiscoverySnapshot } from "./project-discovery.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";

const PROJECT_ID = "drone-concept";
const HUMAN = { kind: "human" as const, actorId: "human:owner" };
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const DISCOVERY_HUMAN = { id: HUMAN.actorId, origin: "human" as const };
const DISCOVERY_AGENT = { id: AGENT.actorId, origin: "agent" as const };
const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("agent publishes a bounded discovery plan with registered operations and no technical evidence", async () => {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const service = planService(store, discovery);
  const command = planCommand(1);

  const published = await service.publishPlan(AGENT, command);

  assertEquals(published.revision, 2);
  assertEquals(published.threadSnapshots, []);
  assertEquals(published.agentRuns, []);
  assertEquals(published.approvals, []);
  assertEquals(published.blockers, []);
  assertEquals(published.plan, {
    startingPoint: "idea-or-spec",
    basis: {
      kind: "approved-discovery",
      discoveryId: discovery.discoveryId,
      snapshotId: discovery.id,
      revision: discovery.revision,
      briefId: discovery.brief!.id,
      approvedBriefFingerprint: FINGERPRINT,
    },
    publishedAt: "2026-08-02T12:01:00.000Z",
    publishedBy: { id: AGENT.actorId, origin: "agent" },
  });
  assertEquals(published.phases.map((phase) => phase.id), ["baseline"]);
  assertEquals(published.workItems[0], {
    id: "establish-baseline",
    phaseId: "baseline",
    title: "Create the engineering baseline",
    description:
      "Create the first reviewable engineering baseline from the approved discovery brief.",
    kind: "define",
    operation: {
      id: "baseline.from-approved-discovery",
      version: "1",
      bindings: [{
        name: "approvedDiscovery",
        source: { kind: "approved-discovery" },
      }],
    },
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  });
  assertEquals(deriveEngineeringProjectStatus(published), "planned");
  assertEquals(published.commandReceipts?.map((receipt) => receipt.type), [
    "project.create-from-discovery",
    "project.plan-publish",
  ]);

  const replay = await service.publishPlan(AGENT, command);
  assertEquals(replay.id, published.id);
  assertEquals((await store.get(PROJECT_ID))?.revision, 2);
});

Deno.test("V2 queues only the exact published discovery basis and fingerprints its reviewed operation", async () => {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const service = planService(store, discovery);
  const published = await service.publishPlan(AGENT, planCommand(1));
  const basis = published.plan!.basis;
  const queued = await service.queueRun(HUMAN, {
    ...common(published.revision, "queue-discovery-baseline"),
    runId: "run:discovery-baseline",
    workItemId: "establish-baseline",
    summary: "Human review authorizes the bounded baseline.",
    basis,
  });

  const run = queued.agentRuns[0];
  assertEquals(run.basis, basis);
  assertEquals(run.baseSnapshot, undefined);
  assertEquals(queued.workItems[0].status, "in-progress");
  assertEquals(
    run.inputFingerprint,
    await sha256Fingerprint({
      workItemId: "establish-baseline",
      basis,
      operation: {
        id: "baseline.from-approved-discovery",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      },
      approvedDecisions: [],
    }),
  );

  const forgedStore = new MemoryProjectStore(projectShell());
  const forgedService = planService(forgedStore, discovery);
  const forgedPlan = await forgedService.publishPlan(AGENT, planCommand(1));
  await assertCommandError(
    () =>
      forgedService.queueRun(HUMAN, {
        ...common(forgedPlan.revision, "queue-forged-discovery-basis"),
        runId: "run:forged-discovery-basis",
        workItemId: "establish-baseline",
        summary: "Attempt to substitute a different approved brief.",
        basis: { ...forgedPlan.plan!.basis, briefId: "other-brief" },
      }),
    "invalid_input",
  );
  await assertCommandError(
    () =>
      forgedService.queueRun(HUMAN, {
        ...common(forgedPlan.revision, "queue-v2-with-v1-base"),
        runId: "run:v2-with-v1-base",
        workItemId: "establish-baseline",
        summary: "Attempt to use a V1 base field in V2.",
        baseSnapshot: {
          snapshotId: "invented",
          revision: 1,
          subjectId: `project:${PROJECT_ID}`,
        },
      }),
    "invalid_input",
  );
});

Deno.test("a readable V1 discovery snapshot is not a fallback route into V2 planning", async () => {
  const historic = structuredClone(projectShell()) as Mutable<
    EngineeringProjectSnapshot
  >;
  historic.schemaVersion = "1.0";
  const readableHistoric = validateEngineeringProjectSnapshot(historic);
  const service = planService(
    new MemoryProjectStore(readableHistoric),
    discoveryFixture(),
  );

  await assertCommandError(
    () => service.publishPlan(AGENT, planCommand(1)),
    "invalid_transition",
  );
});

Deno.test("V2 initial completion uses a dedicated validator instead of a fabricated ancestor", async () => {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const initialValidator = new RecordingInitialEvidenceValidator();
  const service = planService(store, discovery, initialValidator);
  let project = await service.publishPlan(AGENT, planCommand(1));
  project = await service.queueRun(HUMAN, {
    ...common(project.revision, "queue-initial-baseline"),
    runId: "run:initial-baseline",
    workItemId: "establish-baseline",
    summary: "Queue the first reviewable documentary baseline.",
    basis: project.plan!.basis,
  });
  project = await service.claimRun(AGENT, {
    ...common(project.revision, "claim-initial-baseline"),
    runId: "run:initial-baseline",
    summary: "Agent starts the reviewed baseline operation.",
  });
  project = await service.publishRun(AGENT, {
    ...common(project.revision, "publish-initial-baseline"),
    runId: "run:initial-baseline",
    summary: "Agent is ready to publish the initial documentary baseline.",
  });
  const resultSnapshot = {
    snapshotId: `${PROJECT_ID}:thread:r1:initial-baseline`,
    revision: 1,
    subjectId: `project:${PROJECT_ID}`,
  };
  project = await service.completeRun(AGENT, {
    ...common(project.revision, "complete-initial-baseline"),
    runId: "run:initial-baseline",
    summary: "Initial documentary baseline has been materialized.",
    resultSnapshot,
    evidenceRefs: [{
      snapshotId: resultSnapshot.snapshotId,
      snapshotRevision: resultSnapshot.revision,
      kind: "artifact",
      id: "initial-baseline-manifest",
    }],
  });

  assertEquals(initialValidator.calls, 1);
  assertEquals(initialValidator.lastRunId, "run:initial-baseline");
  assertEquals(initialValidator.lastBasis, project.plan!.basis);
  assertEquals(initialValidator.lastOperation, project.workItems[0].operation);
  assertEquals(project.agentRuns[0].resultSnapshot, resultSnapshot);
  assertEquals(project.threadSnapshots, [resultSnapshot]);
  const v1FieldInjected = structuredClone(project) as Mutable<
    EngineeringProjectSnapshot
  >;
  v1FieldInjected.agentRuns[0].baseSnapshot = resultSnapshot;
  assertEquals(
    collectEngineeringProjectIssues(v1FieldInjected).some((issue) =>
      issue.code === "schema_version_mismatch" &&
      issue.path === "$.agentRuns[0].baseSnapshot"
    ),
    true,
  );

  const noHookStore = new MemoryProjectStore(projectShell());
  const noHookService = planService(noHookStore, discovery);
  let noHook = await noHookService.publishPlan(AGENT, planCommand(1));
  noHook = await noHookService.queueRun(HUMAN, {
    ...common(noHook.revision, "queue-initial-without-hook"),
    runId: "run:initial-without-hook",
    workItemId: "establish-baseline",
    summary: "Queue an initial baseline without its evidence validator.",
    basis: noHook.plan!.basis,
  });
  noHook = await noHookService.claimRun(AGENT, {
    ...common(noHook.revision, "claim-initial-without-hook"),
    runId: "run:initial-without-hook",
    summary: "Agent starts the pending initial baseline.",
  });
  noHook = await noHookService.publishRun(AGENT, {
    ...common(noHook.revision, "publish-initial-without-hook"),
    runId: "run:initial-without-hook",
    summary: "The baseline awaits validation.",
  });
  await assertCommandError(
    () =>
      noHookService.completeRun(AGENT, {
        ...common(noHook.revision, "complete-initial-without-hook"),
        runId: "run:initial-without-hook",
        summary: "Attempt to complete without dedicated validation.",
        resultSnapshot,
        evidenceRefs: [{
          snapshotId: resultSnapshot.snapshotId,
          snapshotRevision: resultSnapshot.revision,
          kind: "artifact",
          id: "initial-baseline-manifest",
        }],
      }),
    "invalid_input",
  );
});

Deno.test("a subsequent V2 thread basis still requires a true descendant result", async () => {
  const { discovery, project: initialProject } = await completedInitialProject();
  const laterProject = structuredClone(initialProject) as Mutable<
    EngineeringProjectSnapshot
  >;
  const phase = laterProject.phases[0];
  phase.workItemIds.push("refine-after-baseline");
  laterProject.workItems.push({
    id: "refine-after-baseline",
    phaseId: phase.id,
    title: "Refine the established baseline",
    description: "A later reviewed operation anchored to the exact baseline.",
    kind: "design",
    operation: {
      id: "test.refine-after-baseline",
      version: "1",
      bindings: [],
    },
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  });
  const store = new MemoryProjectStore(
    validateEngineeringProjectSnapshot(laterProject),
  );
  const descendantValidator = new RecordingThreadEvidenceValidator();
  const service = planService(
    store,
    discovery,
    undefined,
    descendantValidator,
  );
  const base = initialProject.threadSnapshots[0];
  let project = await service.queueRun(HUMAN, {
    ...common(initialProject.revision, "queue-thread-basis"),
    runId: "run:refine-after-baseline",
    workItemId: "refine-after-baseline",
    summary: "Queue an exact post-baseline refinement.",
    basis: { kind: "thread-snapshot", ...base },
  });
  project = await service.claimRun(AGENT, {
    ...common(project.revision, "claim-thread-basis"),
    runId: "run:refine-after-baseline",
    summary: "Agent claims the post-baseline refinement.",
  });
  project = await service.publishRun(AGENT, {
    ...common(project.revision, "publish-thread-basis"),
    runId: "run:refine-after-baseline",
    summary: "The refinement result is ready for validation.",
  });
  const evidenceRefs = [{
    snapshotId: `${PROJECT_ID}:thread:r2:refined`,
    snapshotRevision: 2,
    kind: "artifact" as const,
    id: "refined-baseline-manifest",
  }];
  await assertCommandError(
    () =>
      service.completeRun(AGENT, {
        ...common(project.revision, "complete-thread-basis-same-id"),
        runId: "run:refine-after-baseline",
        summary: "Attempt to publish a non-descendant result.",
        resultSnapshot: {
          snapshotId: base.snapshotId,
          revision: base.revision + 1,
          subjectId: base.subjectId,
        },
        evidenceRefs,
      }),
    "invalid_input",
  );
  assertEquals(descendantValidator.calls, 0);

  project = await service.completeRun(AGENT, {
    ...common(project.revision, "complete-thread-basis"),
    runId: "run:refine-after-baseline",
    summary: "Publish a true descendant refinement result.",
    resultSnapshot: {
      snapshotId: `${PROJECT_ID}:thread:r2:refined`,
      revision: 2,
      subjectId: base.subjectId,
    },
    evidenceRefs,
  });
  assertEquals(descendantValidator.calls, 1);
  assertEquals(descendantValidator.lastBase, base);
  assertEquals(project.agentRuns.at(-1)?.basis, {
    kind: "thread-snapshot",
    ...base,
  });
});

Deno.test("an unexecuted plan can be revised, which lets the agent adapt before a consequential run", async () => {
  const store = new MemoryProjectStore(projectShell());
  const service = planService(store, discoveryFixture());
  const first = await service.publishPlan(AGENT, planCommand(1));
  const revised = await service.publishPlan(AGENT, {
    ...planCommand(first.revision),
    commandId: "publish-drone-plan-revised",
    phases: [{
      ...planCommand(first.revision).phases[0],
      description: "Clarify the first reviewable definition before execution.",
    }],
  });

  assertEquals(revised.revision, 3);
  assertEquals(
    revised.phases[0].description,
    "Clarify the first reviewable definition before execution.",
  );
  assertEquals(revised.workItems[0].title, "Create the engineering baseline");
  assertEquals(revised.commandReceipts?.map((receipt) => receipt.type), [
    "project.create-from-discovery",
    "project.plan-publish",
    "project.plan-publish",
  ]);
});

Deno.test("plan publication is agent-only, revision-bound, and fails closed for unknown operations", async () => {
  const store = new MemoryProjectStore(projectShell());
  const service = planService(store, discoveryFixture());

  await assertCommandError(
    () => service.publishPlan(HUMAN, planCommand(1)),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.publishPlan(AGENT, {
        ...planCommand(1),
        workItems: [{
          ...planCommand(1).workItems[0],
          operation: {
            id: "provider.call-anything",
            version: "1",
            bindings: [],
          },
        }],
      }),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, 1);

  const published = await service.publishPlan(AGENT, planCommand(1));
  await assertCommandError(
    () =>
      service.publishPlan(AGENT, {
        ...planCommand(1),
        commandId: "publish-drone-plan-stale",
      }),
    "stale_revision",
  );
  assertEquals((await store.get(PROJECT_ID))?.id, published.id);
});

Deno.test("plan publication requires the exact human approval recorded by the discovery handoff", async () => {
  const discovery = discoveryFixture();
  const approvalTimeChanged = validateEngineeringProjectSnapshot({
    ...projectShell(),
    discoveryHandoff: {
      ...projectShell().discoveryHandoff!,
      approvedAt: "2026-08-02T11:58:00.000Z",
    },
  });
  const approverChanged = validateEngineeringProjectSnapshot({
    ...projectShell(),
    discoveryHandoff: {
      ...projectShell().discoveryHandoff!,
      approvedBy: { id: "human:other-reviewer", origin: "human" },
    },
  });

  await assertCommandError(
    () =>
      planService(new MemoryProjectStore(approvalTimeChanged), discovery)
        .publishPlan(AGENT, planCommand(1)),
    "invalid_input",
  );
  await assertCommandError(
    () =>
      planService(new MemoryProjectStore(approverChanged), discovery)
        .publishPlan(AGENT, planCommand(1)),
    "invalid_input",
  );
});

Deno.test("existing-CAD planning accepts only a current provided answer from the exact approved discovery", async () => {
  const discovery = discoveryFixture({
    answers: [{
      id: "cad-source-answer",
      questionId: "existing-cad-source",
      kind: "provided",
      value: "A supplied CAD source is available for capture.",
      source: { kind: "human", reference: "operator-provided" },
      recordedAt: "2026-08-02T11:20:00.000Z",
      recordedBy: DISCOVERY_HUMAN,
    }],
  });
  const store = new MemoryProjectStore(projectShell());
  const service = planService(store, discovery);
  const command: PublishProjectPlanCommand = {
    ...common(1, "publish-existing-cad-plan"),
    startingPoint: "existing-cad",
    phases: [{
      id: "capture",
      name: "Capture source",
      description: "Resolve the supplied source before any technical claim.",
    }],
    workItems: [{
      id: "capture-existing-cad",
      phaseId: "capture",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.capture-existing-cad",
        version: "1",
        bindings: [
          { name: "approvedDiscovery", source: { kind: "approved-discovery" } },
          {
            name: "cadSource",
            source: { kind: "discovery-answer", answerId: "cad-source-answer" },
          },
        ],
      },
    }],
    requiredDecisions: [],
  };
  const published = await service.publishPlan(AGENT, command);
  assertEquals(published.workItems[0].operation?.id, "baseline.capture-existing-cad");

  const invalidStore = new MemoryProjectStore(projectShell());
  const invalidService = planService(invalidStore, discovery);
  await assertCommandError(
    () =>
      invalidService.publishPlan(AGENT, {
        ...command,
        commandId: "publish-existing-cad-plan-wrong-answer",
        workItems: [{
          ...command.workItems[0],
          operation: {
            ...command.workItems[0].operation,
            bindings: [
              { name: "approvedDiscovery", source: { kind: "approved-discovery" } },
              {
                name: "cadSource",
                source: { kind: "discovery-answer", answerId: "not-in-discovery" },
              },
            ],
          },
        }],
      }),
    "invalid_input",
  );
});

function planCommand(expectedRevision: number): PublishProjectPlanCommand {
  return {
    ...common(expectedRevision, "publish-drone-plan"),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Turn the approved discovery into a first reviewable definition.",
    }],
    workItems: [{
      id: "establish-baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-discovery",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      },
    }],
    requiredDecisions: [],
  };
}

function common(expectedRevision: number, commandId: string) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-02T20:00:00+08:00",
  };
}

async function completedInitialProject(): Promise<{
  discovery: ProjectDiscoverySnapshot;
  project: EngineeringProjectSnapshot;
}> {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const service = planService(
    store,
    discovery,
    new RecordingInitialEvidenceValidator(),
  );
  let project = await service.publishPlan(AGENT, planCommand(1));
  project = await service.queueRun(HUMAN, {
    ...common(project.revision, "queue-helper-initial-baseline"),
    runId: "run:helper-initial-baseline",
    workItemId: "establish-baseline",
    summary: "Queue the fixture initial baseline.",
    basis: project.plan!.basis,
  });
  project = await service.claimRun(AGENT, {
    ...common(project.revision, "claim-helper-initial-baseline"),
    runId: "run:helper-initial-baseline",
    summary: "Claim the fixture initial baseline.",
  });
  project = await service.publishRun(AGENT, {
    ...common(project.revision, "publish-helper-initial-baseline"),
    runId: "run:helper-initial-baseline",
    summary: "Publish the fixture initial baseline.",
  });
  const resultSnapshot = {
    snapshotId: `${PROJECT_ID}:thread:r1:helper-initial`,
    revision: 1,
    subjectId: `project:${PROJECT_ID}`,
  };
  project = await service.completeRun(AGENT, {
    ...common(project.revision, "complete-helper-initial-baseline"),
    runId: "run:helper-initial-baseline",
    summary: "Complete the fixture initial baseline.",
    resultSnapshot,
    evidenceRefs: [{
      snapshotId: resultSnapshot.snapshotId,
      snapshotRevision: resultSnapshot.revision,
      kind: "artifact",
      id: "helper-initial-baseline-manifest",
    }],
  });
  return { discovery, project };
}

function planService(
  store: EngineeringProjectRevisionStore,
  discovery: ProjectDiscoverySnapshot,
  initialEvidenceValidator?: EngineeringProjectInitialCompletionEvidenceValidator,
  evidenceValidator?: EngineeringProjectCompletionEvidenceValidator,
): EngineeringProjectCommandService {
  const planning: EngineeringProjectPlanningDependencies = {
    discoveries: {
      getRevision: (id, revision) =>
        Promise.resolve(
          id === discovery.discoveryId && revision === discovery.revision
            ? structuredClone(discovery)
            : undefined,
        ),
    },
    operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  };
  return new EngineeringProjectCommandService(
    store,
    evidenceValidator,
    () => "2026-08-02T12:01:00.000Z",
    planning,
    initialEvidenceValidator,
  );
}

function projectShell(): EngineeringProjectSnapshot {
  return validateEngineeringProjectSnapshot({
    schemaVersion: "2.0",
    id: "drone-concept:project:r1:handoff",
    revision: 1,
    generatedAt: "2026-08-02T12:00:00.000Z",
    project: {
      id: PROJECT_ID,
      name: "Build a reviewable drone demonstrator",
      subjectId: `project:${PROJECT_ID}`,
      objective: {
        title: "Build a reviewable drone demonstrator",
        statement: "Build a reviewable drone demonstrator",
      },
    },
    discoveryHandoff: {
      discoveryId: "drone-discovery",
      snapshotId: "drone-discovery:r4:approved",
      revision: 4,
      briefId: "drone-brief-v1",
      approvedBriefFingerprint: FINGERPRINT,
      approvedAt: "2026-08-02T11:59:00.000Z",
      approvedBy: { id: HUMAN.actorId, origin: "human" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "create-drone-project",
      type: "project.create-from-discovery",
      actor: { id: HUMAN.actorId, origin: "human" },
      issuedAt: "2026-08-02T11:59:30.000Z",
      appliedAt: "2026-08-02T12:00:00.000Z",
      requestFingerprint: FINGERPRINT,
      resultingSnapshot: {
        snapshotId: "drone-concept:project:r1:handoff",
        revision: 1,
      },
    }],
  });
}

function discoveryFixture(
  override: Partial<ProjectDiscoverySnapshot> = {},
): ProjectDiscoverySnapshot {
  return {
    schemaVersion: "1.0",
    id: "drone-discovery:r4:approved",
    discoveryId: "drone-discovery",
    revision: 4,
    generatedAt: "2026-08-02T11:59:00.000Z",
    status: "approved",
    intent: {
      statement: "Build a reviewable drone demonstrator.",
      capturedAt: "2026-08-02T11:00:00.000Z",
      capturedBy: DISCOVERY_HUMAN,
    },
    questions: [],
    answers: [],
    brief: {
      id: "drone-brief-v1",
      objective: "Build a reviewable drone demonstrator",
      missionScenarios: ["Demonstrate controlled flight"],
      successCriteria: ["Produce reviewable engineering evidence"],
      constraints: ["No autonomous provider execution"],
      intendedMarkets: ["Initial market to be confirmed"],
      manufacturingJurisdictions: ["To be confirmed"],
      operatingJurisdictions: ["To be confirmed"],
      complianceTargets: ["Identify applicable obligations"],
      verificationPlan: ["Plan bounded analysis"],
      exclusions: ["No certification claim"],
      assumptions: ["Controlled demonstrator"],
      openQuestions: ["First payload to be determined"],
      proposedAt: "2026-08-02T11:30:00.000Z",
      proposedBy: DISCOVERY_AGENT,
    },
    review: {
      briefId: "drone-brief-v1",
      status: "approved",
      inputFingerprint: FINGERPRINT,
      requestedAt: "2026-08-02T11:30:00.000Z",
      decidedAt: "2026-08-02T11:59:00.000Z",
      decidedBy: DISCOVERY_HUMAN,
      rationale: "Ready to start the engineering project.",
    },
    commandReceipts: [],
    ...override,
  };
}

async function assertCommandError(
  operation: () => Promise<unknown>,
  code: EngineeringProjectCommandError["code"],
): Promise<void> {
  const error = await assertRejects(operation, EngineeringProjectCommandError);
  assertEquals(error.code, code);
}

class RecordingInitialEvidenceValidator
  implements EngineeringProjectInitialCompletionEvidenceValidator {
  calls = 0;
  lastRunId?: string;
  lastBasis?: EngineeringApprovedDiscoveryBasis;
  lastOperation?: EngineeringOperationRef;

  validateInitial(
    runId: string,
    basis: EngineeringApprovedDiscoveryBasis,
    operation: EngineeringOperationRef,
  ): Promise<void> {
    this.calls++;
    this.lastRunId = runId;
    this.lastBasis = structuredClone(basis);
    this.lastOperation = structuredClone(operation);
    return Promise.resolve();
  }
}

class RecordingThreadEvidenceValidator
  implements EngineeringProjectCompletionEvidenceValidator {
  calls = 0;
  lastBase?: { snapshotId: string; revision: number; subjectId: string };

  validate(
    base: { snapshotId: string; revision: number; subjectId: string },
  ): Promise<void> {
    this.calls++;
    this.lastBase = structuredClone(base);
    return Promise.resolve();
  }
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  constructor(initial: EngineeringProjectSnapshot) {
    this.#revisions.set(initial.revision, structuredClone(initial));
  }

  get(_projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const revision = Math.max(...this.#revisions.keys());
    return Promise.resolve(structuredClone(this.#revisions.get(revision)));
  }

  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(structuredClone(this.#revisions.get(revision)));
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = this.#revisions.get(expectedRevision);
    if (!current || snapshot.previous?.snapshotId !== current.id) {
      return Promise.reject(new Error("Unexpected test-store revision."));
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
