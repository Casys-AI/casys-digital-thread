import { assertEquals, assertRejects } from "@std/assert";
import {
  deriveEngineeringProjectStatus,
  type EngineeringApprovedDiscoveryBasis,
  type EngineeringOperationRef,
  type EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import {
  type AppendProjectChangeCommand,
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectCompletionEvidenceValidator,
  type EngineeringProjectInitialCompletionEvidenceValidator,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectPlanOperationRegistry,
  type EngineeringProjectQueueEligibility,
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

Deno.test("V2 queue refuses a planning-only operation before it mutates the project", async () => {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const planningOnlyRegistry: EngineeringProjectPlanOperationRegistry = {
    validate(input) {
      const registered = REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
      return {
        ...registered,
        operation: {
          ...registered.operation,
          execution: "planning-only",
        },
      };
    },
  };
  const service = planService(
    store,
    discovery,
    undefined,
    undefined,
    planningOnlyRegistry,
  );
  const published = await service.publishPlan(AGENT, planCommand(1));
  const before = await store.get(PROJECT_ID);

  await assertCommandError(
    () =>
      service.queueRun(HUMAN, {
        ...common(published.revision, "queue-planning-only-operation"),
        runId: "run:planning-only-operation",
        workItemId: "establish-baseline",
        summary: "A planning descriptor cannot create an executable run.",
        basis: published.plan!.basis,
      }),
    "invalid_transition",
  );

  assertEquals(await store.get(PROJECT_ID), before);
});

Deno.test("V2 queue eligibility refusal leaves the project strictly unchanged", async () => {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const queueEligibility: EngineeringProjectQueueEligibility = {
    validate({ project, workItem, operation, basis }) {
      assertEquals(Object.isFrozen(project), true);
      assertEquals(Object.isFrozen(project.workItems), true);
      assertEquals(Object.isFrozen(workItem), true);
      assertEquals(Object.isFrozen(operation), true);
      assertEquals(workItem.status, "ready");
      assertEquals(project.agentRuns, []);
      assertEquals(operation, workItem.operation);
      assertEquals(basis, project.plan!.basis);
      return Promise.reject(
        new Error("The bounded prerequisite is not yet satisfied."),
      );
    },
  };
  const service = planService(
    store,
    discovery,
    undefined,
    undefined,
    REGISTERED_ENGINEERING_OPERATION_REGISTRY,
    queueEligibility,
  );
  const published = await service.publishPlan(AGENT, planCommand(1));
  const before = await store.get(PROJECT_ID);

  await assertCommandError(
    () =>
      service.queueRun(HUMAN, {
        ...common(published.revision, "queue-ineligible-operation"),
        runId: "run:ineligible-operation",
        workItemId: "establish-baseline",
        summary: "Do not queue until the bounded prerequisite is satisfied.",
        basis: published.plan!.basis,
      }),
    "invalid_transition",
  );

  assertEquals(await store.get(PROJECT_ID), before);
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

Deno.test("a SysON seed can be planned but cannot be queued from discovery", async () => {
  const discovery = discoveryFixture();
  const service = planService(
    new MemoryProjectStore(projectShell()),
    discovery,
  );
  const unsequenced = stagedPlanCommand(1);
  const project = await service.publishPlan(AGENT, {
    ...unsequenced,
    commandId: "publish-unsequenced-seed-plan",
    workItems: unsequenced.workItems.map((item) =>
      item.id === "seed-syson-model" ? { ...item, dependsOnWorkItemIds: [] } : item
    ),
  });

  assertEquals(
    project.workItems.find((item) => item.id === "seed-syson-model")?.status,
    "ready",
  );
  await assertCommandError(
    () =>
      service.queueRun(HUMAN, {
        ...common(project.revision, "queue-unsequenced-seed-from-discovery"),
        runId: "run:unsequenced-seed-from-discovery",
        workItemId: "seed-syson-model",
        summary: "A SysON seed cannot consume the discovery basis directly.",
        basis: project.plan!.basis,
      }),
    "invalid_transition",
  );
});

Deno.test("a staged V2 plan unlocks the SysON seed only after its documentary baseline", async () => {
  const discovery = discoveryFixture();
  const store = new MemoryProjectStore(projectShell());
  const initialValidator = new RecordingInitialEvidenceValidator();
  const descendantValidator = new RecordingThreadEvidenceValidator();
  const service = planService(
    store,
    discovery,
    initialValidator,
    descendantValidator,
  );
  let project = await service.publishPlan(AGENT, stagedPlanCommand(1));
  assertEquals(project.workItems.map((item) => [item.id, item.status]), [
    ["establish-baseline", "ready"],
    ["seed-syson-model", "planned"],
  ]);
  assertEquals(project.workItems[1].dependsOnWorkItemIds, ["establish-baseline"]);
  assertEquals(project.workItems[1].operation, {
    id: "architecture.seed-syson-model",
    version: "1",
    bindings: [{
      name: "approvedDiscovery",
      source: { kind: "approved-discovery" },
    }],
  });

  project = await service.queueRun(HUMAN, {
    ...common(project.revision, "queue-staged-initial-baseline"),
    runId: "run:staged-initial-baseline",
    workItemId: "establish-baseline",
    summary: "Queue the documentary baseline that authorizes later model work.",
    basis: project.plan!.basis,
  });
  project = await service.claimRun(AGENT, {
    ...common(project.revision, "claim-staged-initial-baseline"),
    runId: "run:staged-initial-baseline",
    summary: "Agent starts the bounded documentary baseline.",
  });
  project = await service.publishRun(AGENT, {
    ...common(project.revision, "publish-staged-initial-baseline"),
    runId: "run:staged-initial-baseline",
    summary: "The documentary baseline is ready for validation.",
  });
  const base = {
    snapshotId: `${PROJECT_ID}:thread:r1:staged-initial`,
    revision: 1,
    subjectId: `project:${PROJECT_ID}`,
  };
  project = await service.completeRun(AGENT, {
    ...common(project.revision, "complete-staged-initial-baseline"),
    runId: "run:staged-initial-baseline",
    summary: "Complete the documentary baseline before the system-model seed.",
    resultSnapshot: base,
    evidenceRefs: [{
      snapshotId: base.snapshotId,
      snapshotRevision: base.revision,
      kind: "artifact",
      id: "staged-initial-baseline-manifest",
    }],
  });

  assertEquals(initialValidator.calls, 1);
  assertEquals(project.threadSnapshots, [base]);
  assertEquals(project.workItems.map((item) => [item.id, item.status]), [
    ["establish-baseline", "completed"],
    ["seed-syson-model", "ready"],
  ]);

  await assertCommandError(
    () =>
      service.queueRun(HUMAN, {
        ...common(project.revision, "queue-seed-with-discovery-basis"),
        runId: "run:seed-with-discovery-basis",
        workItemId: "seed-syson-model",
        summary: "A later operation cannot reuse the discovery basis.",
        basis: project.plan!.basis,
      }),
    "invalid_transition",
  );
  await assertCommandError(
    () =>
      service.queueRun(HUMAN, {
        ...common(project.revision, "queue-seed-with-forged-thread-basis"),
        runId: "run:seed-with-forged-thread-basis",
        workItemId: "seed-syson-model",
        summary: "A later operation cannot use an undeclared ThreadSnapshot.",
        basis: { kind: "thread-snapshot", ...base, snapshotId: "other:r1" },
      }),
    "invalid_input",
  );

  project = await service.queueRun(HUMAN, {
    ...common(project.revision, "queue-syson-seed"),
    runId: "run:seed-syson-model",
    workItemId: "seed-syson-model",
    summary: "Queue the exact post-baseline system-model seed.",
    basis: { kind: "thread-snapshot", ...base },
  });
  project = await service.claimRun(AGENT, {
    ...common(project.revision, "claim-syson-seed"),
    runId: "run:seed-syson-model",
    summary: "Agent claims the post-baseline system-model seed.",
  });
  project = await service.publishRun(AGENT, {
    ...common(project.revision, "publish-syson-seed"),
    runId: "run:seed-syson-model",
    summary: "The system-model result is ready for validation.",
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
        ...common(project.revision, "complete-syson-seed-same-id"),
        runId: "run:seed-syson-model",
        summary: "Attempt to publish a non-descendant system-model result.",
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
    ...common(project.revision, "complete-syson-seed"),
    runId: "run:seed-syson-model",
    summary: "Publish a true descendant system-model result.",
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

Deno.test("V2 queue revalidates a persisted post-baseline operation against its concrete basis", async () => {
  const { discovery, project: initialProject } = await completedInitialProject();
  const alteredProject = structuredClone(initialProject) as Mutable<
    EngineeringProjectSnapshot
  >;
  const phase = alteredProject.phases[0];
  phase.workItemIds.push("capture-existing-cad-after-baseline");
  alteredProject.workItems.push({
    id: "capture-existing-cad-after-baseline",
    phaseId: phase.id,
    title: "Capture an existing CAD baseline",
    description: "A deliberately altered persisted operation for queue-boundary proof.",
    kind: "define",
    operation: {
      id: "baseline.capture-existing-cad",
      version: "1",
      bindings: [
        {
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        },
        {
          name: "cadSource",
          source: { kind: "discovery-answer", answerId: "stored-cad-source" },
        },
      ],
    },
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  });
  const store = new MemoryProjectStore(
    validateEngineeringProjectSnapshot(alteredProject),
  );
  const service = planService(store, discovery);
  const base = initialProject.threadSnapshots[0];

  await assertCommandError(
    () =>
      service.queueRun(HUMAN, {
        ...common(initialProject.revision, "queue-unsupported-post-baseline-operation"),
        runId: "run:unsupported-post-baseline-operation",
        workItemId: "capture-existing-cad-after-baseline",
        summary: "Refuse a post-baseline operation that accepts no ThreadSnapshot.",
        basis: { kind: "thread-snapshot", ...base },
      }),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, initialProject.revision);
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

Deno.test("an agent appends a reviewed architecture change without rewriting the completed baseline", async () => {
  const { discovery, project: baseline } = await completedInitialProject();
  const store = new MemoryProjectStore(baseline);
  const service = planService(
    store,
    discovery,
    new RecordingInitialEvidenceValidator(),
  );
  const command = architectureAppendCommand(baseline);

  const appended = await service.appendChange(AGENT, command);

  assertEquals(appended.revision, baseline.revision + 1);
  assertEquals(appended.plan, baseline.plan);
  assertEquals(appended.threadSnapshots, baseline.threadSnapshots);
  assertEquals(appended.agentRuns, baseline.agentRuns);
  assertEquals(appended.phases.slice(0, baseline.phases.length), baseline.phases);
  assertEquals(
    appended.workItems.slice(0, baseline.workItems.length),
    baseline.workItems,
  );
  assertEquals(appended.phases.at(-1)?.id, "architecture");
  assertEquals(appended.workItems.at(-1)?.id, "seed-syson-model");
  assertEquals(appended.workItems.at(-1)?.status, "ready");
  assertEquals(appended.planChanges, [{
    id: "change:append-drone-architecture",
    commandId: "append-drone-architecture",
    baseSnapshot: baseline.threadSnapshots[0],
    phaseIds: ["architecture"],
    workItemIds: ["seed-syson-model"],
    decisionIds: [],
    publishedAt: "2026-08-02T12:01:00.000Z",
    publishedBy: { id: AGENT.actorId, origin: "agent" },
  }]);
  assertEquals(appended.commandReceipts?.at(-1)?.type, "project.change-append");

  const replay = await service.appendChange(AGENT, command);
  assertEquals(replay, appended);
  assertEquals((await store.get(PROJECT_ID))?.revision, appended.revision);
});

Deno.test("a project change is revision-bound and requires the exact current ThreadSnapshot head", async () => {
  const { discovery, project: baseline } = await completedInitialProject();
  const store = new MemoryProjectStore(baseline);
  const service = planService(
    store,
    discovery,
    new RecordingInitialEvidenceValidator(),
  );

  await assertCommandError(
    () => service.appendChange(HUMAN, architectureAppendCommand(baseline)),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.appendChange(AGENT, {
        ...architectureAppendCommand(baseline),
        commandId: "append-drone-architecture-wrong-head",
        baseSnapshot: {
          ...baseline.threadSnapshots[0],
          revision: baseline.threadSnapshots[0].revision + 1,
        },
      }),
    "invalid_input",
  );
  assertEquals(await store.get(PROJECT_ID), baseline);
});

Deno.test("an append is refused while an earlier project run is active", async () => {
  const { discovery, project: baseline } = await completedInitialProject();
  const store = new MemoryProjectStore(baseline);
  const service = planService(
    store,
    discovery,
    new RecordingInitialEvidenceValidator(),
  );
  let project = await service.appendChange(AGENT, architectureAppendCommand(baseline));
  project = await service.queueRun(AGENT, {
    ...common(project.revision, "queue-appended-seed"),
    runId: "run:appended-seed",
    workItemId: "seed-syson-model",
    summary: "Queue the first system-model container.",
    basis: { kind: "thread-snapshot", ...project.threadSnapshots[0] },
  });
  const before = await store.get(PROJECT_ID);

  await assertCommandError(
    () =>
      service.appendChange(AGENT, {
        ...architectureAppendCommand(project),
        commandId: "append-while-seed-active",
        phases: [{
          id: "architecture-detail",
          name: "System model detail",
          description: "Declare work only after the active run has finished.",
        }],
        workItems: [{
          id: "author-inspection-drone",
          phaseId: "architecture-detail",
          owner: "agent",
          dependsOnWorkItemIds: ["seed-syson-model"],
          decisionIds: [],
          operation: {
            id: "architecture.author-inspection-drone",
            version: "1",
            bindings: [{
              name: "approvedDiscovery",
              source: { kind: "approved-discovery" },
            }],
          },
        }],
      }),
    "invalid_transition",
  );
  assertEquals(await store.get(PROJECT_ID), before);
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

function stagedPlanCommand(expectedRevision: number): PublishProjectPlanCommand {
  const baseline = planCommand(expectedRevision);
  return {
    ...baseline,
    commandId: "publish-drone-staged-plan",
    phases: [
      ...baseline.phases,
      {
        id: "architecture",
        name: "System model",
        description:
          "Create the first traceable system-model container after the documentary baseline.",
      },
    ],
    workItems: [
      ...baseline.workItems,
      {
        id: "seed-syson-model",
        phaseId: "architecture",
        owner: "agent",
        dependsOnWorkItemIds: ["establish-baseline"],
        decisionIds: [],
        operation: {
          id: "architecture.seed-syson-model",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" },
          }],
        },
      },
    ],
  };
}

function architectureAppendCommand(
  project: EngineeringProjectSnapshot,
): AppendProjectChangeCommand {
  return {
    ...common(project.revision, "append-drone-architecture"),
    baseSnapshot: project.threadSnapshots[0],
    phases: [{
      id: "architecture",
      name: "System model",
      description:
        "Create the first traceable system-model container from the completed baseline.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["establish-baseline"],
      decisionIds: [],
      operation: {
        id: "architecture.seed-syson-model",
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
  operations: EngineeringProjectPlanOperationRegistry =
    REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  queueEligibility?: EngineeringProjectQueueEligibility,
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
    operations,
    ...(queueEligibility ? { queueEligibility } : {}),
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
