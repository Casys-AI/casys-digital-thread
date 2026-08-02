import { assertEquals, assertRejects } from "@std/assert";
import {
  deriveEngineeringProjectStatus,
  type EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectRevisionStore,
  type PublishProjectPlanCommand,
} from "./engineering-project-command-service.ts";
import { validateEngineeringProjectSnapshot } from "./engineering-project-validation.ts";
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
    status: "planned",
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

function planService(
  store: EngineeringProjectRevisionStore,
  discovery: ProjectDiscoverySnapshot,
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
    undefined,
    () => "2026-08-02T12:01:00.000Z",
    planning,
  );
}

function projectShell(): EngineeringProjectSnapshot {
  return validateEngineeringProjectSnapshot({
    schemaVersion: "1.0",
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
