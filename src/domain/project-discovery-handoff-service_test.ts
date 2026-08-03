import { assertEquals } from "@std/assert";
import {
  FileEngineeringProjectRevisionStore,
} from "../adapters/engineering-project-store.ts";
import { FileProjectDiscoveryRevisionStore } from "../adapters/project-discovery-store.ts";
import { deriveEngineeringProjectStatus } from "./engineering-project.ts";
import { ProjectDiscoveryCommandService } from "./project-discovery-command-service.ts";
import {
  CreateEngineeringProjectFromDiscoveryCommand,
  ProjectDiscoveryHandoffError,
  ProjectDiscoveryHandoffService,
} from "./project-discovery-handoff-service.ts";
import {
  collectEngineeringProjectIssues,
  validateEngineeringProjectSnapshot,
} from "./engineering-project-validation.ts";

const DISCOVERY_ID = "inspection-product-discovery";
const PROJECT_ID = "inspection-product";
const HUMAN = { kind: "human" as const, actorId: "human:owner" };
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };

Deno.test("human discovery handoff creates only a provenance-bound engineering project shell", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const before = await discoveries.get(DISCOVERY_ID);
    const service = handoffService(discoveries, projects);

    const project = await service.createEngineeringProject(
      HUMAN,
      command(discovery.revision),
    );

    assertEquals(project.revision, 1);
    assertEquals(project.project, {
      id: PROJECT_ID,
      name: "Deliver a reviewable inspection demonstrator.",
      subjectId: `project:${PROJECT_ID}`,
      objective: {
        title: discovery.brief!.objective,
        statement: discovery.brief!.objective,
      },
    });
    assertEquals(project.discoveryHandoff, {
      discoveryId: DISCOVERY_ID,
      snapshotId: discovery.id,
      revision: discovery.revision,
      briefId: discovery.brief!.id,
      approvedBriefFingerprint: discovery.review!.inputFingerprint,
      approvedAt: discovery.review!.decidedAt,
      approvedBy: discovery.review!.decidedBy,
    });
    assertEquals(project.threadSnapshots, []);
    assertEquals(project.phases, []);
    assertEquals(project.workItems, []);
    assertEquals(project.agentRuns, []);
    assertEquals(project.decisions, []);
    assertEquals(project.approvals, []);
    assertEquals(project.blockers, []);
    assertEquals(deriveEngineeringProjectStatus(project), "planned");
    assertEquals(project.commandReceipts?.[0], {
      commandId: "create-inspection-project",
      type: "project.create-from-discovery",
      actor: { id: HUMAN.actorId, origin: "human" },
      issuedAt: "2026-08-02T10:59:00.000Z",
      appliedAt: "2026-08-02T12:01:00.000Z",
      requestFingerprint: project.commandReceipts![0]!.requestFingerprint,
      resultingSnapshot: { snapshotId: project.id, revision: 1 },
    });
    assertEquals(await discoveries.get(DISCOVERY_ID), before);
    assertEquals(await projects.get(PROJECT_ID), project);
    assertEquals(validateEngineeringProjectSnapshot(project), project);
  });
});

Deno.test("human or agent can hand off only the exact human-approved discovery revision", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const service = handoffService(discoveries, projects);

    await assertHandoffError(
      () => service.createEngineeringProject(AGENT, command(discovery.revision - 1)),
      "stale_discovery_revision",
    );
    const project = await service.createEngineeringProject(
      AGENT,
      command(discovery.revision),
    );
    assertEquals(project.commandReceipts?.[0].actor, {
      id: AGENT.actorId,
      origin: "agent",
    });
    assertEquals(project.discoveryHandoff?.approvedBy.origin, "human");
  });
});

Deno.test("handoff refuses a discovery that the human has not approved", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discoveryService = discoveryServiceFor(discoveries);
    const proposed = await discoveryService.start(HUMAN, {
      commandId: "start-unapproved-discovery",
      discoveryId: DISCOVERY_ID,
      issuedAt: "2026-08-02T10:59:00.000Z",
      intent: "Develop an inspection demonstrator.",
    });
    const service = handoffService(discoveries, projects);

    await assertHandoffError(
      () => service.createEngineeringProject(HUMAN, command(proposed.revision)),
      "invalid_transition",
    );
    assertEquals(await projects.get(PROJECT_ID), undefined);
  });
});

Deno.test("handoff replays one exact command and rejects ambiguous project creation", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const service = handoffService(discoveries, projects);
    const created = await service.createEngineeringProject(
      HUMAN,
      command(discovery.revision),
    );

    const replay = await service.createEngineeringProject(HUMAN, {
      ...command(discovery.revision),
      issuedAt: "2026-08-02T10:59:00.000Z",
      projectName: "Deliver a reviewable inspection demonstrator.",
    });
    assertEquals(replay.id, created.id);
    assertEquals((await projects.get(PROJECT_ID))?.revision, 1);

    await assertHandoffError(
      () =>
        service.createEngineeringProject(HUMAN, {
          ...command(discovery.revision),
          projectName: "Different project name",
        }),
      "command_id_conflict",
    );
    await assertHandoffError(
      () =>
        service.createEngineeringProject(HUMAN, {
          ...command(discovery.revision),
          commandId: "create-inspection-project-again",
        }),
      "project_exists",
    );
  });
});

Deno.test("handoff derives the canonical project name from the approved objective", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const service = handoffService(discoveries, projects);

    await assertHandoffError(
      () =>
        service.createEngineeringProject(HUMAN, {
          ...command(discovery.revision),
          projectName: "An unrelated project name",
        }),
      "invalid_input",
    );
    assertEquals(await projects.get(PROJECT_ID), undefined);
  });
});

Deno.test("handoff rejects a client timestamp later than the service clock", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const service = handoffService(discoveries, projects);

    await assertHandoffError(
      () =>
        service.createEngineeringProject(HUMAN, {
          ...command(discovery.revision),
          issuedAt: "2099-01-01T00:00:00.000Z",
        }),
      "invalid_input",
    );
    assertEquals(await projects.get(PROJECT_ID), undefined);
  });
});

Deno.test("concurrent handoff create calls resolve to one immutable project winner", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const service = handoffService(discoveries, projects);
    const [left, right] = await Promise.all([
      service.createEngineeringProject(HUMAN, command(discovery.revision)),
      service.createEngineeringProject(HUMAN, command(discovery.revision)),
    ]);

    assertEquals(left.id, right.id);
    assertEquals(left.revision, 1);
    assertEquals((await projects.get(PROJECT_ID))?.id, left.id);
  });
});

Deno.test("handoff validation rejects forged technical state in the initial project", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const project = await handoffService(discoveries, projects)
      .createEngineeringProject(HUMAN, command(discovery.revision));
    const forged = structuredClone(project) as unknown as {
      threadSnapshots: unknown[];
      discoveryHandoff: { approvedBy: { origin: string } };
      commandReceipts: Array<{ type: string }>;
    };
    forged.threadSnapshots.push({
      snapshotId: "invented-thread",
      revision: 1,
      subjectId: `project:${PROJECT_ID}`,
    });
    forged.discoveryHandoff.approvedBy.origin = "agent";
    forged.commandReceipts[0].type = "decision.propose";

    const codes = collectEngineeringProjectIssues(forged).map((issue) => issue.code);
    assertEquals(codes.includes("handoff_initial_scope"), true);
    assertEquals(codes.includes("handoff_approval_origin_forbidden"), true);
    assertEquals(codes.includes("invalid_handoff_receipt"), true);
  });
});

Deno.test("handoff receipt validation preserves human approval, singular creation, and chronology", async () => {
  await withStores(async ({ discoveries, projects }) => {
    const discovery = await approvedDiscovery(discoveries);
    const project = await handoffService(discoveries, projects)
      .createEngineeringProject(HUMAN, command(discovery.revision));

    const agentCreated = structuredClone(project) as unknown as {
      commandReceipts: Array<{ actor: { origin: string } }>;
    };
    agentCreated.commandReceipts[0].actor.origin = "agent";
    assertEquals(
      collectEngineeringProjectIssues(agentCreated).some((issue) =>
        issue.code === "command_authority_mismatch" &&
        issue.path === "$.commandReceipts[0].actor.origin"
      ),
      false,
    );

    const beforeApproval = structuredClone(project) as unknown as {
      commandReceipts: Array<{ appliedAt: string }>;
    };
    beforeApproval.commandReceipts[0].appliedAt = "2026-08-02T12:00:02.000Z";
    assertEquals(
      collectEngineeringProjectIssues(beforeApproval).some((issue) =>
        issue.code === "invalid_chronology" &&
        issue.path === "$.commandReceipts[0].appliedAt" &&
        issue.message.includes("approved discovery brief")
      ),
      true,
    );

    const detachedFromInitialSnapshot = structuredClone(project) as unknown as {
      commandReceipts: Array<{ appliedAt: string }>;
    };
    detachedFromInitialSnapshot.commandReceipts[0].appliedAt =
      "2026-08-02T12:00:30.000Z";
    assertEquals(
      collectEngineeringProjectIssues(detachedFromInitialSnapshot).some((issue) =>
        issue.code === "invalid_chronology" &&
        issue.path === "$.commandReceipts[0].appliedAt" &&
        issue.message.includes("initial project snapshot generation time")
      ),
      true,
    );

    const issuedInTheFuture = structuredClone(project) as unknown as {
      commandReceipts: Array<{ issuedAt: string }>;
    };
    issuedInTheFuture.commandReceipts[0].issuedAt = "2099-01-01T00:00:00.000Z";
    assertEquals(
      collectEngineeringProjectIssues(issuedInTheFuture).some((issue) =>
        issue.code === "invalid_chronology" &&
        issue.path === "$.commandReceipts[0].issuedAt" &&
        issue.message.includes("application time")
      ),
      true,
    );

    const createdTwice = structuredClone(project) as unknown as {
      id: string;
      revision: number;
      generatedAt: string;
      previous?: { snapshotId: string; revision: number };
      commandReceipts: Array<{
        commandId: string;
        type: string;
        actor: { id: string; origin: string };
        issuedAt: string;
        appliedAt: string;
        requestFingerprint: { algorithm: string; digest: string };
        resultingSnapshot: { snapshotId: string; revision: number };
      }>;
    };
    createdTwice.id = `${project.id}:r2`;
    createdTwice.revision = 2;
    createdTwice.previous = { snapshotId: project.id, revision: 1 };
    createdTwice.generatedAt = "2026-08-02T12:02:00.000Z";
    createdTwice.commandReceipts.push({
      commandId: "create-inspection-project-twice",
      type: "project.create-from-discovery",
      actor: { id: HUMAN.actorId, origin: "human" },
      issuedAt: "2026-08-02T12:01:30.000Z",
      appliedAt: createdTwice.generatedAt,
      requestFingerprint: structuredClone(
        createdTwice.commandReceipts[0].requestFingerprint,
      ),
      resultingSnapshot: { snapshotId: createdTwice.id, revision: 2 },
    });
    assertEquals(
      collectEngineeringProjectIssues(createdTwice).some((issue) =>
        issue.code === "invalid_handoff_receipt" &&
        issue.path === "$.commandReceipts[1].type"
      ),
      true,
    );
  });
});

async function approvedDiscovery(store: FileProjectDiscoveryRevisionStore) {
  const service = discoveryServiceFor(store);
  let discovery = await service.start(HUMAN, {
    commandId: "start-inspection-discovery",
    discoveryId: DISCOVERY_ID,
    issuedAt: "2026-08-02T10:59:00.000Z",
    intent: "Develop an inspection demonstrator.",
  });
  discovery = await service.proposeBrief(AGENT, {
    commandId: "propose-inspection-brief",
    discoveryId: DISCOVERY_ID,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-02T10:59:10.000Z",
    brief: {
      id: "inspection-brief-v1",
      objective: "Deliver a reviewable inspection demonstrator.",
      missionScenarios: ["Inspect one controlled demonstration surface"],
      successCriteria: ["Record measurable inspection evidence"],
      constraints: ["Do not claim production readiness"],
      intendedMarkets: ["Initial market to be confirmed"],
      manufacturingJurisdictions: ["Manufacturing location to be confirmed"],
      operatingJurisdictions: ["Operating jurisdiction to be confirmed"],
      complianceTargets: ["Identify applicable rules from authoritative sources"],
      verificationPlan: ["Plan named analyses and physical tests"],
      exclusions: ["No certification claim from discovery"],
      assumptions: ["The first demonstrator stays in a controlled setting"],
      openQuestions: ["Which inspection environment is the first target?"],
    },
  });
  return await service.approveBrief(HUMAN, {
    commandId: "approve-inspection-brief",
    discoveryId: DISCOVERY_ID,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-02T10:59:20.000Z",
    briefId: discovery.brief!.id,
    rationale: "The discovery brief is approved as the project planning basis.",
    inputFingerprint: discovery.review!.inputFingerprint,
  });
}

function discoveryServiceFor(store: FileProjectDiscoveryRevisionStore) {
  let tick = 0;
  return new ProjectDiscoveryCommandService(
    store,
    () =>
      new Date(Date.parse("2026-08-02T12:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
}

function handoffService(
  discoveries: FileProjectDiscoveryRevisionStore,
  projects: FileEngineeringProjectRevisionStore,
) {
  return new ProjectDiscoveryHandoffService(
    discoveries,
    projects,
    () => "2026-08-02T12:01:00.000Z",
  );
}

function command(
  expectedDiscoveryRevision: number,
): CreateEngineeringProjectFromDiscoveryCommand {
  return {
    commandId: "create-inspection-project",
    discoveryId: DISCOVERY_ID,
    expectedDiscoveryRevision,
    issuedAt: "2026-08-02T18:59:00+08:00",
    projectId: PROJECT_ID,
    projectName: "  Deliver a reviewable inspection demonstrator.  ",
  };
}

async function withStores(
  run: (stores: {
    discoveries: FileProjectDiscoveryRevisionStore;
    projects: FileEngineeringProjectRevisionStore;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-discovery-handoff-" });
  try {
    await run({
      discoveries: new FileProjectDiscoveryRevisionStore(`${directory}/discoveries`),
      projects: new FileEngineeringProjectRevisionStore(`${directory}/projects`),
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function assertHandoffError(
  operation: () => Promise<unknown>,
  code: ProjectDiscoveryHandoffError["code"],
): Promise<void> {
  try {
    await operation();
    throw new Error(`Expected ProjectDiscoveryHandoffError ${code}.`);
  } catch (error) {
    if (!(error instanceof ProjectDiscoveryHandoffError)) throw error;
    assertEquals(error.code, code);
  }
}
