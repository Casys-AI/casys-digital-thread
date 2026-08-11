import { assertEquals, assertRejects } from "@std/assert";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "./engineering-project-command-service.ts";
import {
  ProjectBriefCommandService,
  type ProjectBriefMutationCommand,
} from "./project-brief-command-service.ts";
import type { ProjectBriefItem } from "./project-brief.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import { collectEngineeringProjectIssues } from "./engineering-project-validation.ts";

const PROJECT_ID = "project-v3";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:owner" };

Deno.test("a project exists from first intent and framing stays inside it", async () => {
  const store = new MemoryProjectStore();
  const service = serviceFor(store);
  const command = {
    commandId: "start-project",
    projectId: PROJECT_ID,
    projectName: "Project V3",
    issuedAt: "2026-08-03T08:59:00.000Z",
    intent: "  Build a reviewable engineering project.  ",
    intentSource: { kind: "human" as const, reference: "conversation:turn-1" },
  };

  const project = await service.startProject(AGENT, command);

  assertEquals(project.schemaVersion, "3.0");
  assertEquals(project.revision, 1);
  assertEquals(project.project.id, PROJECT_ID);
  assertEquals(project.framing?.intent.statement, command.intent.trim());
  assertEquals(project.plan, undefined);
  assertEquals(project.threadSnapshots, []);

  const replay = await service.startProject(AGENT, {
    ...command,
    intent: command.intent.trim(),
  });
  assertEquals(replay.id, project.id);

  await assertCommandError(
    () => service.startProject(AGENT, { ...command, intent: "Another product" }),
    "command_id_conflict",
  );
});

Deno.test("an agent builds a sourced brief but only exact human review makes it canonical", async () => {
  const store = new MemoryProjectStore();
  const service = serviceFor(store);
  let project = await start(service);

  project = await service.proposeQuestion(AGENT, {
    ...context("question-mission", project.revision),
    question: {
      id: "mission",
      prompt: "Which initial operating scenario should the product prove?",
      whyItMatters: "It bounds the architecture and verification plan.",
      recommendation: {
        value: "bounded-demonstration",
        rationale: "It is observable and can be tested incrementally.",
        confidence: "medium",
      },
      options: [{
        value: "bounded-demonstration",
        label: "Bounded demonstration",
        consequences: "Prioritises a small, observable first proof.",
      }, {
        value: "broader-demonstration",
        label: "Broader demonstration",
        consequences: "Prioritises broader coverage and more evidence.",
      }],
      allowUnknown: true,
      risk: "material",
      evidenceNeeded: ["operating-envelope analysis"],
    },
  });
  project = await service.recordAnswer(AGENT, {
    ...context("answer-mission", project.revision),
    answer: {
      id: "answer-mission-1",
      questionId: "mission",
      kind: "provided",
      value: "bounded-demonstration",
      source: { kind: "human", reference: "conversation:turn-2" },
    },
  });
  project = await service.proposeBrief(AGENT, {
    ...context("propose-brief-r1", project.revision),
    items: briefItems("Demonstrate a reviewable system safely"),
  });

  assertEquals(project.framing?.currentBrief, undefined);
  assertEquals(project.framing?.proposalReview?.status, "pending");
  assertEquals(
    project.project.objective.statement,
    "Build a reviewable engineering system.",
  );

  const proposal = project.framing!.proposedBrief!;
  const review = project.framing!.proposalReview!;
  await assertCommandError(
    () =>
      service.approveBrief(AGENT, {
        ...context("agent-cannot-approve", project.revision),
        briefSnapshotId: proposal.id,
        briefRevision: proposal.revision,
        rationale: "Looks good.",
        inputFingerprint: review.inputFingerprint,
      }),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.approveBrief(HUMAN, {
        ...context("wrong-scope", project.revision),
        briefSnapshotId: proposal.id,
        briefRevision: proposal.revision,
        rationale: "Reviewed.",
        inputFingerprint: {
          algorithm: "sha256",
          digest: "f".repeat(64),
        },
      }),
    "approval_scope_mismatch",
  );

  project = await service.approveBrief(HUMAN, {
    ...context("approve-brief-r1", project.revision),
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "The mission and criterion reflect the conversation.",
    inputFingerprint: review.inputFingerprint,
  });

  assertEquals(project.framing?.currentBrief?.id, proposal.id);
  assertEquals(project.framing?.currentBriefApproval?.status, "approved");
  assertEquals(project.framing?.proposedBrief, undefined);
  assertEquals(
    project.project.objective.statement,
    "Demonstrate a reviewable system safely",
  );
});

Deno.test("V2 briefs require explicit gate dependencies while V1 brief records remain readable", async () => {
  const store = new MemoryProjectStore();
  const service = serviceFor(store);
  const started = await start(service);
  const incompleteItems = briefItems("Demonstrate a reviewable system safely").map(
    (item) => {
      if (item.id !== "success-reviewed-system") return item;
      const { dependsOnItemIds: _ignored, ...withoutDeclaration } = item;
      return withoutDeclaration;
    },
  );

  await assertCommandError(
    () =>
      service.proposeBrief(AGENT, {
        ...context("reject-incomplete-v2-gate", started.revision),
        items: incompleteItems,
      }),
    "invalid_input",
  );

  let approved = await service.proposeBrief(AGENT, {
    ...context("propose-explicit-v2-gates", started.revision),
    items: briefItems("Demonstrate a reviewable system safely"),
  });
  const proposal = approved.framing!.proposedBrief!;
  assertEquals(proposal.contractVersion, "2.0");
  assertEquals(
    proposal.items.find((item) => item.id === "success-reviewed-system")
      ?.dependsOnItemIds,
    [],
  );
  assertEquals(
    proposal.items.find((item) => item.id === "verify-traceable-record")
      ?.dependsOnItemIds,
    ["success-reviewed-system"],
  );

  approved = await service.approveBrief(HUMAN, {
    ...context("approve-explicit-v2-gates", approved.revision),
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "The explicit gate contract is reviewed.",
    inputFingerprint: approved.framing!.proposalReview!.inputFingerprint,
  });
  const historical = structuredClone(approved) as unknown as {
    framing: {
      currentBrief: {
        contractVersion?: string;
        items: Array<{ kind: string; dependsOnItemIds?: string[] }>;
      };
    };
  };
  delete historical.framing.currentBrief.contractVersion;
  for (const item of historical.framing.currentBrief.items) {
    if (
      item.kind === "success-criterion" ||
      item.kind === "verification-activity"
    ) {
      delete item.dependsOnItemIds;
    }
  }
  assertEquals(collectEngineeringProjectIssues(historical), []);
});

Deno.test("gate claims resolve only to canonical V2 gates and preserve link status", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );
  const invalidClaim = {
    gateItemId: "objective",
    role: "satisfies" as const,
    status: "current" as const,
  };
  await assertCommandError(
    () =>
      commands.publishPlan(AGENT, {
        ...baselinePlanCommand("reject-non-gate-claim", approved.revision),
        workItems: baselinePlanCommand(
          "reject-non-gate-claim",
          approved.revision,
        ).workItems.map((item) => ({ ...item, gateClaims: [invalidClaim] })),
      }),
    "invalid_input",
  );
  await assertCommandError(
    () =>
      commands.publishPlan(AGENT, {
        ...baselinePlanCommand("reject-unknown-gate-claim", approved.revision),
        workItems: baselinePlanCommand(
          "reject-unknown-gate-claim",
          approved.revision,
        ).workItems.map((item) => ({
          ...item,
          gateClaims: [{ ...invalidClaim, gateItemId: "missing-gate" }],
        })),
      }),
    "invalid_input",
  );

  const validClaim = {
    gateItemId: "verify-traceable-record",
    role: "satisfies" as const,
    status: "impact-unresolved" as const,
  };
  const planned = await commands.publishPlan(AGENT, {
    ...baselinePlanCommand("publish-gate-claim", approved.revision),
    workItems: baselinePlanCommand(
      "publish-gate-claim",
      approved.revision,
    ).workItems.map((item) => ({ ...item, gateClaims: [validClaim] })),
  });
  assertEquals(planned.workItems[0]?.gateClaims, [validClaim]);
  assertEquals(
    planned.workItems[0]?.operation?.bindings,
    [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  );

  const malformedStatus = structuredClone(planned) as unknown as {
    workItems: Array<{
      gateClaims?: Array<{ gateItemId: string; role: string; status: string }>;
    }>;
  };
  malformedStatus.workItems[0]!.gateClaims![0]!.status = "stale";
  const statusIssue = collectEngineeringProjectIssues(malformedStatus).find(
    (issue) => issue.code === "invalid_gate_claim_status",
  );
  assertEquals(statusIssue?.context, { value: "stale" });
  assertEquals(typeof statusIssue?.recovery, "string");
});

Deno.test("an agent cannot preempt the server-reserved uncertain-writer release decision namespace", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );
  const reservedId = "decision:uncertain-write-release:future-run";
  const plan = baselinePlanCommand("reject-reserved-release-id", approved.revision);

  await assertCommandError(
    () =>
      commands.publishPlan(AGENT, {
        ...plan,
        workItems: plan.workItems.map((item) => ({
          ...item,
          decisionIds: [reservedId],
        })),
        requiredDecisions: [{
          id: reservedId,
          phaseId: "phase-baseline",
          title: "Forged release",
          question: "Can an agent reserve a future release id?",
        }],
      }),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, approved.revision);
});

Deno.test("a rejected update preserves the approved brief and stale proposals cannot be approved", async () => {
  const store = new MemoryProjectStore();
  const service = serviceFor(store);
  let project = await approvedProject(service);
  const canonicalId = project.framing!.currentBrief!.id;

  project = await service.proposeBrief(AGENT, {
    ...context("propose-brief-r2", project.revision),
    items: briefItems("Demonstrate a broader system scope safely"),
  });
  const rejected = project.framing!.proposedBrief!;
  const rejectedReview = project.framing!.proposalReview!;
  project = await service.rejectBrief(HUMAN, {
    ...context("reject-brief-r2", project.revision),
    briefSnapshotId: rejected.id,
    briefRevision: rejected.revision,
    rationale: "The broader scope is outside the first product scope.",
    inputFingerprint: rejectedReview.inputFingerprint,
  });

  assertEquals(project.framing?.currentBrief?.id, canonicalId);
  assertEquals(project.framing?.proposalReview?.status, "rejected");
  assertEquals(
    project.project.objective.statement,
    "Demonstrate a reviewable system safely",
  );

  project = await service.proposeBrief(AGENT, {
    ...context("propose-brief-r3", project.revision),
    items: briefItems("Demonstrate a reviewable system with traceable evidence"),
  });
  const staleProposal = project.framing!.proposedBrief!;
  const staleReview = project.framing!.proposalReview!;
  project = await service.proposeQuestion(AGENT, {
    ...context("intervening-question", project.revision),
    question: {
      id: "payload",
      prompt: "Which payload must be carried?",
      whyItMatters: "Payload changes mass and endurance.",
      recommendation: {
        value: "camera",
        rationale: "It satisfies the current inspection mission.",
        confidence: "high",
      },
      options: [{
        value: "camera",
        label: "Camera",
        consequences: "Keeps the first iteration bounded.",
      }],
      allowUnknown: true,
      risk: "material",
      evidenceNeeded: ["payload mass"],
    },
  });
  await assertCommandError(
    () =>
      service.approveBrief(HUMAN, {
        ...context("approve-stale-brief", project.revision),
        briefSnapshotId: staleProposal.id,
        briefRevision: staleProposal.revision,
        rationale: "Reviewed.",
        inputFingerprint: staleReview.inputFingerprint,
      }),
    "invalid_transition",
  );
});

Deno.test("the initial engineering plan is bound to the exact approved in-project brief", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );

  const planned = await commands.publishPlan(AGENT, {
    ...context("publish-initial-plan", approved.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "phase-baseline",
      name: "Engineering baseline",
      description: "Record the reviewed intent before technical work begins.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "phase-baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });

  assertEquals(planned.plan?.basis.kind, "approved-brief");
  if (planned.plan?.basis.kind !== "approved-brief") {
    throw new Error("Expected an approved-brief plan basis.");
  }
  assertEquals(
    planned.plan.basis.briefSnapshotId,
    approved.framing?.currentBrief?.id,
  );
  assertEquals(planned.workItems[0]?.status, "ready");

  const exactBasis = planned.plan.basis;
  const tamperedBases: readonly EngineeringApprovedBriefBasis[] = [{
    ...exactBasis,
    briefId: `${exactBasis.briefId}:forged`,
  }, {
    ...exactBasis,
    briefSnapshotId: `${exactBasis.briefSnapshotId}:forged`,
  }, {
    ...exactBasis,
    briefRevision: exactBasis.briefRevision + 1,
  }, {
    ...exactBasis,
    projectSnapshotId: `${exactBasis.projectSnapshotId}:forged`,
  }, {
    ...exactBasis,
    projectRevision: exactBasis.projectRevision + 1,
  }, {
    ...exactBasis,
    approvedBriefFingerprint: {
      algorithm: "sha256",
      digest: "0".repeat(64),
    },
  }];
  for (const tamperedBasis of tamperedBases) {
    const forged = {
      ...structuredClone(planned),
      plan: { ...structuredClone(planned.plan!), basis: tamperedBasis },
    };
    assertEquals(
      collectEngineeringProjectIssues(forged).some((issue) =>
        issue.path === "$.plan.basis" &&
        issue.code === "approval_scope_mismatch"
      ),
      true,
    );
  }
  const approvalReceiptIndex = planned.commandReceipts!.findIndex((receipt) =>
    receipt.type === "project.brief-approve"
  );
  for (const tamperedBasis of tamperedBases) {
    const forged = {
      ...structuredClone(planned),
      commandReceipts: planned.commandReceipts!.map((receipt, index) =>
        index === approvalReceiptIndex
          ? { ...structuredClone(receipt), approvedBriefBasis: tamperedBasis }
          : structuredClone(receipt)
      ),
    };
    assertEquals(
      collectEngineeringProjectIssues(forged).some((issue) =>
        issue.path ===
          `$.commandReceipts[${approvalReceiptIndex}].approvedBriefBasis` &&
        issue.code === "approval_scope_mismatch"
      ),
      true,
    );
  }
});

Deno.test("a V3 cancellation seals its legacy unbound queue receipt", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );
  const planned = await commands.publishPlan(
    AGENT,
    baselinePlanCommand("publish-cancellable-v3-plan", approved.revision),
  );
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-legacy-v3-receipt", planned.revision),
    runId: "run:legacy-v3-queue",
    workItemId: "record-approved-brief",
    summary: "Queue the approved V3 documentary baseline.",
    basis: planned.plan!.basis,
  });
  const queueReceipt = queued.commandReceipts?.at(-1);
  assertEquals(queued.schemaVersion, "3.0");
  assertEquals(queueReceipt?.type, "agent-run.queue");
  assertEquals(queueReceipt?.queuedRun, {
    runId: "run:legacy-v3-queue",
    workItemId: "record-approved-brief",
  });

  const legacyQueued = structuredClone(queued);
  const legacyQueueReceipt = legacyQueued.commandReceipts!.at(-1)! as {
    commandId: string;
    queuedRun?: unknown;
  };
  delete legacyQueueReceipt.queuedRun;
  await store.commit(legacyQueued, queued.revision);
  assertEquals(legacyQueueReceipt.queuedRun, undefined);
  assertEquals(collectEngineeringProjectIssues(legacyQueued), []);

  const cancelled = await commands.cancelQueuedRun(HUMAN, {
    ...context("cancel-legacy-v3-queue", legacyQueued.revision),
    runId: "run:legacy-v3-queue",
    rationale: "The reviewed baseline was retired before any worker claim.",
  });
  const run = cancelled.agentRuns.find((item) => item.id === "run:legacy-v3-queue")!;
  assertEquals(cancelled.commandReceipts?.at(-1)?.cancelledRun, {
    runId: run.id,
    workItemId: run.workItemId,
    queuedCommandId: legacyQueueReceipt.commandId,
  });
  assertEquals(collectEngineeringProjectIssues(cancelled), []);
});

Deno.test("a living brief revision does not rewrite the historical approval that authorized the plan", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:01:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );
  const planned = await commands.publishPlan(AGENT, {
    ...context("publish-historical-plan", approved.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "phase-baseline",
      name: "Engineering baseline",
      description: "Record the reviewed intent before technical work begins.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "phase-baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  const originalBasis = structuredClone(planned.plan!.basis);
  const laterBriefs = new ProjectBriefCommandService(
    store,
    () => "2026-08-03T09:02:00.000Z",
  );
  let revised = await laterBriefs.proposeBrief(AGENT, {
    ...context("propose-living-brief-r2", planned.revision),
    items: briefItems(
      "Demonstrate a reviewable system with a reviewed maintenance envelope",
    ),
  });
  const proposal = revised.framing!.proposedBrief!;
  const review = revised.framing!.proposalReview!;
  revised = await laterBriefs.approveBrief(HUMAN, {
    ...context("approve-living-brief-r2", revised.revision),
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "The living brief evolves without rewriting prior authority.",
    inputFingerprint: review.inputFingerprint,
  });

  assertEquals(revised.plan?.basis, originalBasis);
  const approvalReceipts =
    revised.commandReceipts?.filter((receipt) =>
      receipt.type === "project.brief-approve"
    ) ?? [];
  assertEquals(approvalReceipts.length, 2);
  assertEquals(approvalReceipts[0]?.approvedBriefBasis, originalBasis);
  assertEquals(
    approvalReceipts[1]?.approvedBriefBasis?.briefSnapshotId,
    revised.framing?.currentBrief?.id,
  );
  assertEquals(collectEngineeringProjectIssues(revised), []);

  const withoutApprovalReceipt = {
    ...structuredClone(revised),
    commandReceipts: revised.commandReceipts!.filter((receipt) =>
      receipt.resultingSnapshot.snapshotId !==
        (originalBasis.kind === "approved-brief" ? originalBasis.projectSnapshotId : "")
    ),
  };
  assertEquals(
    collectEngineeringProjectIssues(withoutApprovalReceipt).some((issue) =>
      issue.path === "$.plan.basis" &&
      issue.code === "approval_scope_mismatch"
    ),
    true,
  );
});

Deno.test(
  "publishPlan rejects the SysON seed in the initial plan before any run can lock it",
  async () => {
    // Friction 1 guard: architecture.seed-syson-model@2 requires a planChange
    // lineage (the executor checks planChanges.includes(workItemId)).  Without
    // the publishPlan guard, the plan publishes, the baseline completes, the
    // plan locks — and only then does the executor reject.  The agent is left
    // with no recovery path.  The guard must fire here, at planning time.
    const store = new MemoryProjectStore();
    const briefs = serviceFor(store);
    const approved = await approvedProject(briefs);
    const commands = new EngineeringProjectCommandService(
      store,
      undefined,
      () => "2026-08-03T09:00:00.000Z",
      { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    );

    await assertCommandError(
      () =>
        commands.publishPlan(AGENT, {
          ...context("publish-with-seed-in-plan", approved.revision),
          startingPoint: "idea-or-spec",
          phases: [{ id: "ph-1", name: "Phase 1", description: "Baseline." }],
          workItems: [{
            id: "seed-syson",
            phaseId: "ph-1",
            owner: "agent",
            dependsOnWorkItemIds: [],
            decisionIds: [],
            operation: {
              id: "architecture.seed-syson-model",
              version: "2",
              bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
            },
          }],
          requiredDecisions: [],
        }),
      "invalid_input",
    );
  },
);

async function approvedProject(service: ProjectBriefCommandService) {
  let project = await start(service);
  project = await service.proposeBrief(AGENT, {
    ...context("propose-initial-brief", project.revision),
    items: briefItems("Demonstrate a reviewable system safely"),
  });
  const proposal = project.framing!.proposedBrief!;
  const review = project.framing!.proposalReview!;
  return await service.approveBrief(HUMAN, {
    ...context("approve-initial-brief", project.revision),
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "Approved for initial engineering.",
    inputFingerprint: review.inputFingerprint,
  });
}

function start(service: ProjectBriefCommandService) {
  return service.startProject(AGENT, {
    commandId: "start-project",
    projectId: PROJECT_ID,
    projectName: "Reviewable engineering system",
    issuedAt: "2026-08-03T08:59:00.000Z",
    intent: "Build a reviewable engineering system.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
}

function context(
  commandId: string,
  expectedRevision: number,
): ProjectBriefMutationCommand {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}

function baselinePlanCommand(commandId: string, expectedRevision: number) {
  return {
    ...context(commandId, expectedRevision),
    startingPoint: "idea-or-spec" as const,
    phases: [{
      id: "phase-baseline",
      name: "Engineering baseline",
      description: "Record the reviewed intent before technical work begins.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "phase-baseline",
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" as const },
        }],
      },
    }],
    requiredDecisions: [],
  };
}

function briefItems(objective: string): readonly ProjectBriefItem[] {
  return [{
    id: "objective",
    kind: "objective",
    statement: objective,
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
  }, {
    id: "mission-bounded-demonstration",
    kind: "mission-scenario",
    statement: "Demonstrate a bounded operating scenario with traceable evidence.",
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
  }, {
    id: "success-reviewed-system",
    kind: "success-criterion",
    statement: "Complete the reviewed scenario with a traceable engineering record.",
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    dependsOnItemIds: [],
  }, {
    id: "verify-traceable-record",
    kind: "verification-activity",
    statement: "Verify the reviewed record against the declared success criterion.",
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    dependsOnItemIds: ["success-reviewed-system"],
  }];
}

function serviceFor(store: MemoryProjectStore): ProjectBriefCommandService {
  return new ProjectBriefCommandService(store, () => "2026-08-03T09:00:00.000Z");
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

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const revisions = [...this.#revisions.values()].filter((snapshot) =>
      snapshot.project.id === projectId
    );
    const current = revisions.sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale revision.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
