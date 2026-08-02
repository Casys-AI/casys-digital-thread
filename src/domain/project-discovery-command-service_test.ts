import { assertEquals } from "@std/assert";
import type { ProjectDiscoverySnapshot } from "./project-discovery.ts";
import {
  ProjectDiscoveryCommandError,
  ProjectDiscoveryCommandService,
  type ProjectDiscoveryRevisionStore,
  ProjectDiscoveryStoreConflictError,
} from "./project-discovery-command-service.ts";
import { validateProjectDiscoverySnapshot } from "./project-discovery-validation.ts";

const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const DISCOVERY_ID = "new-product-1";

Deno.test("agent starts an idempotent discovery from free intent", async () => {
  const store = new MemoryDiscoveryStore();
  const service = serviceFor(store);
  const command = {
    commandId: "start-new-product",
    discoveryId: DISCOVERY_ID,
    issuedAt: "2026-08-02T18:59:00+08:00",
    intent: "  Build an adaptable inspection product.  ",
  };

  const started = await service.start(AGENT, command);
  assertEquals(started.revision, 1);
  assertEquals(started.status, "discovering");
  assertEquals(started.intent.statement, "Build an adaptable inspection product.");
  assertEquals(started.intent.capturedBy, { id: AGENT.actorId, origin: "agent" });
  assertEquals(started.commandReceipts[0].issuedAt, "2026-08-02T10:59:00.000Z");

  const replay = await service.start(AGENT, {
    ...command,
    intent: "Build an adaptable inspection product.",
    issuedAt: "2026-08-02T10:59:00.000Z",
  });
  assertEquals(replay.id, started.id);
  assertEquals((await store.get(DISCOVERY_ID))?.revision, 1);

  await assertCommandError(
    () => service.start(AGENT, { ...command, intent: "A different intent." }),
    "command_id_conflict",
  );
  await assertCommandError(
    () =>
      service.start(AGENT, {
        ...command,
        commandId: "second-start",
      }),
    "discovery_exists",
  );
});

Deno.test("human may state the initial intent but guided authoring remains agent-first", async () => {
  const store = new MemoryDiscoveryStore();
  const service = serviceFor(store);
  const started = await service.start(HUMAN, {
    commandId: "human-start",
    discoveryId: DISCOVERY_ID,
    issuedAt: "2026-08-02T10:59:00.000Z",
    intent: "Help me frame a product idea.",
  });
  assertEquals(started.intent.capturedBy.origin, "human");

  await assertCommandError(
    () =>
      service.proposeQuestion(HUMAN, {
        ...context("human-authored-question", started.revision),
        question: question("human-question", true),
      }),
    "permission_denied",
  );
});

Deno.test("guided questions and sourced unknown answers remain honest and revision-bound", async () => {
  const store = new MemoryDiscoveryStore();
  const service = serviceFor(store);
  let discovery = await start(service);
  const questionCommand = {
    ...context("question-mission", discovery.revision),
    question: question("mission", true),
  };
  await assertCommandError(
    () =>
      service.proposeQuestion(AGENT, {
        ...questionCommand,
        commandId: "question-unselectable-recommendation",
        question: {
          ...questionCommand.question,
          recommendation: {
            ...questionCommand.question.recommendation,
            value: "not-an-option",
          },
        },
      }),
    "invalid_input",
  );
  discovery = await service.proposeQuestion(AGENT, questionCommand);
  assertEquals(discovery.questions[0].proposedBy.origin, "agent");
  assertEquals(discovery.questions[0].options.length, 2);

  const replay = await service.proposeQuestion(AGENT, questionCommand);
  assertEquals(replay.id, discovery.id);

  await assertCommandError(
    () =>
      service.recordAnswer(AGENT, {
        ...context("answer-outside-options", discovery.revision),
        answer: {
          id: "answer-outside-options",
          questionId: "mission",
          kind: "provided",
          value: "free-text-answer",
          source: { kind: "human", reference: "conversation:turn-11" },
        },
      }),
    "invalid_input",
  );

  discovery = await service.recordAnswer(AGENT, {
    ...context("answer-mission-unknown", discovery.revision),
    answer: {
      id: "answer-mission-1",
      questionId: "mission",
      kind: "unknown",
      explanation: "The person needs guidance before selecting a mission.",
      source: { kind: "human", reference: "conversation:turn-12" },
    },
  });
  assertEquals(discovery.answers[0].kind, "unknown");
  assertEquals(discovery.answers[0].source, {
    kind: "human",
    reference: "conversation:turn-12",
  });
  assertEquals(discovery.answers[0].recordedBy.origin, "agent");

  await assertCommandError(
    () =>
      service.recordAnswer(AGENT, {
        ...context("ambiguous-answer", discovery.revision),
        answer: {
          id: "answer-mission-2",
          questionId: "mission",
          kind: "provided",
          value: "controlled-inspection",
          source: { kind: "human", reference: "conversation:turn-13" },
        },
      }),
    "invalid_input",
  );

  discovery = await service.recordAnswer(HUMAN, {
    ...context("correct-answer", discovery.revision),
    answer: {
      id: "answer-mission-2",
      questionId: "mission",
      kind: "provided",
      value: "controlled-inspection",
      source: { kind: "human", reference: "workbench:human-selection" },
      supersedesAnswerId: "answer-mission-1",
    },
  });
  assertEquals(discovery.answers.at(-1)?.recordedBy.origin, "human");

  await assertCommandError(
    () =>
      service.recordAnswer(HUMAN, {
        ...context("false-human-source", discovery.revision),
        answer: {
          id: "answer-mission-3",
          questionId: "mission",
          kind: "provided",
          value: "uncontrolled-operation",
          source: { kind: "tool", reference: "mcp:test" },
          supersedesAnswerId: "answer-mission-2",
        },
      }),
    "invalid_input",
  );
});

Deno.test("agent proposes a generic compliance-aware brief but only human review can decide it", async () => {
  const store = new MemoryDiscoveryStore();
  const service = serviceFor(store);
  let discovery = await start(service);
  discovery = await service.proposeQuestion(AGENT, {
    ...context("question-context", discovery.revision),
    question: question("operating-context", true),
  });
  discovery = await service.recordAnswer(AGENT, {
    ...context("answer-context", discovery.revision),
    answer: {
      id: "answer-context-1",
      questionId: "operating-context",
      kind: "provided",
      value: "controlled-inspection",
      source: { kind: "human", reference: "conversation:turn-20" },
    },
  });
  discovery = await service.proposeBrief(AGENT, {
    ...context("brief-proposal-1", discovery.revision),
    brief: brief("brief-1"),
  });

  assertEquals(discovery.status, "awaiting-review");
  assertEquals(discovery.brief?.intendedMarkets, ["Initial target market unknown"]);
  assertEquals(discovery.brief?.manufacturingJurisdictions, [
    "Manufacturing location unresolved",
  ]);
  assertEquals(discovery.brief?.operatingJurisdictions, [
    "Operating jurisdiction unresolved",
  ]);
  assertEquals(discovery.brief?.complianceTargets, [
    "Identify applicable product and operational rules from licensed sources",
  ]);
  assertEquals(discovery.brief?.verificationPlan, [
    "Bind every success criterion to a named test or analysis",
  ]);
  const fingerprint = discovery.review!.inputFingerprint;

  await assertCommandError(
    () =>
      service.approveBrief(AGENT, {
        ...context("agent-fake-approval", discovery.revision),
        briefId: "brief-1",
        rationale: "An agent must not approve this.",
        inputFingerprint: fingerprint,
      }),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.approveBrief(HUMAN, {
        ...context("wrong-scope", discovery.revision),
        briefId: "brief-1",
        rationale: "Wrong displayed scope.",
        inputFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      }),
    "review_scope_mismatch",
  );

  discovery = await service.approveBrief(HUMAN, {
    ...context("human-approval", discovery.revision),
    briefId: "brief-1",
    rationale: "The bounded discovery brief is accepted for project creation.",
    inputFingerprint: fingerprint,
  });
  assertEquals(discovery.status, "approved");
  assertEquals(discovery.review?.status, "approved");
  assertEquals(discovery.review?.decidedBy, {
    id: HUMAN.actorId,
    origin: "human",
  });

  await assertCommandError(
    () =>
      service.proposeQuestion(AGENT, {
        ...context("edit-approved", discovery.revision),
        question: question("late-question", true),
      }),
    "invalid_transition",
  );
});

Deno.test("rejected brief keeps exact history and accepts a new proposal id", async () => {
  const store = new MemoryDiscoveryStore();
  const service = serviceFor(store);
  let discovery = await start(service);
  discovery = await service.proposeBrief(AGENT, {
    ...context("brief-first", discovery.revision),
    brief: brief("brief-1"),
  });
  const firstProposalRevision = discovery.revision;
  discovery = await service.rejectBrief(HUMAN, {
    ...context("brief-reject", discovery.revision),
    briefId: "brief-1",
    rationale: "Mission context needs another guided question.",
    inputFingerprint: discovery.review!.inputFingerprint,
  });
  assertEquals(discovery.status, "revision-requested");
  assertEquals(discovery.review?.status, "rejected");

  discovery = await service.proposeQuestion(AGENT, {
    ...context("question-after-reject", discovery.revision),
    question: question("mission-after-review", true),
  });
  await assertCommandError(
    () =>
      service.proposeBrief(AGENT, {
        ...context("brief-same-id", discovery.revision),
        brief: brief("brief-1"),
      }),
    "invalid_input",
  );
  discovery = await service.proposeBrief(AGENT, {
    ...context("brief-second", discovery.revision),
    brief: brief("brief-2"),
  });
  assertEquals(discovery.status, "awaiting-review");
  assertEquals(discovery.brief?.id, "brief-2");
  assertEquals(
    (await store.getRevision(DISCOVERY_ID, firstProposalRevision))?.brief?.id,
    "brief-1",
  );
});

function serviceFor(store: ProjectDiscoveryRevisionStore) {
  let tick = 0;
  return new ProjectDiscoveryCommandService(
    store,
    () =>
      new Date(Date.parse("2026-08-02T11:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
}

function start(service: ProjectDiscoveryCommandService) {
  return service.start(AGENT, {
    commandId: "start-1",
    discoveryId: DISCOVERY_ID,
    issuedAt: "2026-08-02T10:59:00.000Z",
    intent: "Develop a new inspection product.",
  });
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    discoveryId: DISCOVERY_ID,
    expectedRevision,
    issuedAt: "2026-08-02T10:59:30.000Z",
  };
}

function question(id: string, allowUnknown: boolean) {
  return {
    id,
    prompt: "Which bounded mission should the first product perform?",
    whyItMatters: "Mission determines architecture and relevant verification.",
    recommendation: {
      value: "controlled-inspection",
      rationale: "A controlled first mission reduces irreversible risk.",
      confidence: "medium" as const,
    },
    options: [
      {
        value: "controlled-inspection",
        label: "Controlled inspection",
        consequences: "Lower environmental and certification uncertainty.",
      },
      {
        value: "uncontrolled-operation",
        label: "Uncontrolled operation",
        consequences: "Broader safety and compliance evidence is required.",
      },
    ],
    allowUnknown,
    risk: "material" as const,
    evidenceNeeded: ["Document the operating context before architecture work"],
  };
}

function brief(id: string) {
  return {
    id,
    objective: "Deliver a reviewable inspection-product demonstrator.",
    missionScenarios: ["Perform inspection in a controlled environment"],
    successCriteria: ["Complete the mission with measured acceptance criteria"],
    constraints: ["No production release during discovery"],
    intendedMarkets: ["Initial target market unknown"],
    manufacturingJurisdictions: ["Manufacturing location unresolved"],
    operatingJurisdictions: ["Operating jurisdiction unresolved"],
    complianceTargets: [
      "Identify applicable product and operational rules from licensed sources",
    ],
    verificationPlan: [
      "Bind every success criterion to a named test or analysis",
    ],
    exclusions: ["Legal advice and unverified certification claims"],
    assumptions: ["Operating context remains provisional"],
    openQuestions: ["Which jurisdiction and market are intended?"],
  };
}

async function assertCommandError(
  operation: () => Promise<unknown>,
  code: ProjectDiscoveryCommandError["code"],
): Promise<void> {
  try {
    await operation();
    throw new Error(`Expected ProjectDiscoveryCommandError ${code}.`);
  } catch (error) {
    if (!(error instanceof ProjectDiscoveryCommandError)) throw error;
    assertEquals(error.code, code);
  }
}

class MemoryDiscoveryStore implements ProjectDiscoveryRevisionStore {
  private readonly revisions = new Map<number, ProjectDiscoverySnapshot>();

  get(discoveryId: string): Promise<ProjectDiscoverySnapshot | undefined> {
    const values = [...this.revisions.values()].filter((item) =>
      item.discoveryId === discoveryId
    );
    const current = values.sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    discoveryId: string,
    revision: number,
  ): Promise<ProjectDiscoverySnapshot | undefined> {
    const snapshot = this.revisions.get(revision);
    return Promise.resolve(
      snapshot?.discoveryId === discoveryId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: ProjectDiscoverySnapshot,
  ): Promise<ProjectDiscoverySnapshot> {
    if (this.revisions.size > 0) {
      throw new ProjectDiscoveryStoreConflictError("Already exists.");
    }
    const validated = validateProjectDiscoverySnapshot(snapshot);
    this.revisions.set(1, validated);
    return Promise.resolve(structuredClone(validated));
  }

  async commit(
    snapshot: ProjectDiscoverySnapshot,
    expectedRevision: number,
  ): Promise<ProjectDiscoverySnapshot> {
    const current = await this.get(snapshot.discoveryId);
    if (!current || current.revision !== expectedRevision) {
      throw new ProjectDiscoveryStoreConflictError("Stale revision.");
    }
    const validated = validateProjectDiscoverySnapshot(snapshot);
    this.revisions.set(validated.revision, validated);
    return structuredClone(validated);
  }
}
