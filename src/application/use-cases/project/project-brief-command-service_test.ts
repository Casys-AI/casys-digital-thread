import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectPlanOperationRegistry,
  type QueueRunCommand,
} from "./engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../ports/out/engineering-project-revision-store.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type { ResolvedOperationPlanRef } from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  ProjectBriefCommandService,
  type ProjectBriefMutationCommand,
} from "./project-brief-command-service.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import { collectEngineeringProjectIssues } from "../../../domain/project/engineering-project-validation.ts";

const PROJECT_ID = "project-v3";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:owner" };

Deno.test(
  "project_start names the service clock when issuedAt is in the future",
  async () => {
    const service = serviceFor(new MemoryProjectStore());
    const error = await assertRejects(
      () =>
        service.startProject(AGENT, {
          commandId: "start-future-clock",
          projectId: PROJECT_ID,
          projectName: "Project V3",
          issuedAt: "2026-08-16T16:00:00.000Z",
          intent: "Build a reviewable engineering project.",
          intentSource: { kind: "human", reference: "conversation:turn-1" },
        }),
      EngineeringProjectCommandError,
    );
    assertEquals(error.code, "invalid_input");
    assertStringIncludes(error.message, "issuedAt 2026-08-16T16:00:00.000Z");
    assertStringIncludes(
      error.message,
      "authoritative service clock 2026-08-03T09:00:00.000Z",
    );
    assertStringIncludes(error.message, "Reuse the same commandId");
  },
);

Deno.test(
  "a later brief mutation names the service clock when issuedAt is in the future",
  async () => {
    const service = serviceFor(new MemoryProjectStore());
    const project = await start(service);
    const error = await assertRejects(
      () =>
        service.proposeQuestion(AGENT, {
          ...context("question-future-clock", project.revision),
          issuedAt: "2026-08-16T16:00:00.000Z",
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
              consequences: "The first proof stays reviewable.",
            }],
            allowUnknown: true,
            risk: "reversible",
            evidenceNeeded: ["reviewed operating scenario"],
          },
        }),
      EngineeringProjectCommandError,
    );
    assertEquals(error.code, "invalid_input");
    assertStringIncludes(error.message, "issuedAt 2026-08-16T16:00:00.000Z");
    assertStringIncludes(
      error.message,
      "authoritative service clock 2026-08-03T09:00:00.000Z",
    );
    assertStringIncludes(error.message, "Reuse the same commandId");
  },
);

Deno.test("project_question_propose names the bounded options when recommendation is outside them", async () => {
  const service = serviceFor(new MemoryProjectStore());
  const project = await start(service);
  const error = await assertRejects(
    () =>
      service.proposeQuestion(AGENT, {
        ...context("question-unbounded-reco", project.revision),
        question: {
          id: "mission",
          prompt: "Which initial operating scenario should the product prove?",
          whyItMatters: "It bounds the architecture and verification plan.",
          recommendation: {
            value: "invented-scenario",
            rationale: "Not one of the offered options.",
            confidence: "medium",
          },
          options: [{
            value: "bounded-demonstration",
            label: "Bounded demonstration",
            consequences: "The first proof stays reviewable.",
          }],
          allowUnknown: true,
          risk: "reversible",
          evidenceNeeded: ["reviewed operating scenario"],
        },
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "invalid_input");
  assertStringIncludes(error.message, '"invented-scenario"');
  assertStringIncludes(error.message, "bounded-demonstration");
});

Deno.test("project_answer_record names the bounded options when the value is outside them", async () => {
  const service = serviceFor(new MemoryProjectStore());
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
        consequences: "The first proof stays reviewable.",
      }],
      allowUnknown: true,
      risk: "reversible",
      evidenceNeeded: ["reviewed operating scenario"],
    },
  });
  const error = await assertRejects(
    () =>
      service.recordAnswer(AGENT, {
        ...context("answer-unbounded", project.revision),
        answer: {
          id: "answer-mission",
          questionId: "mission",
          kind: "provided",
          value: "invented-scenario",
          source: { kind: "human", reference: "conversation:turn-2" },
        },
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "invalid_input");
  assertStringIncludes(error.message, '"invented-scenario"');
  assertStringIncludes(error.message, "bounded-demonstration");
});

Deno.test("project_brief_propose names the missing required kinds", async () => {
  const service = serviceFor(new MemoryProjectStore());
  const project = await start(service);
  const error = await assertRejects(
    () =>
      service.proposeBrief(AGENT, {
        ...context("propose-no-kinds", project.revision),
        items: [{
          id: "c1",
          kind: "constraint",
          statement: "Stay on the behave branch.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "c2",
          kind: "constraint",
          statement: "Do not open make or buy.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "c3",
          kind: "constraint",
          statement: "Do not invent thresholds.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }],
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "invalid_input");
  assertStringIncludes(error.message, "objective=0");
  assertStringIncludes(error.message, "mission-scenario=0");
  assertStringIncludes(error.message, "success-criterion=0");
});

Deno.test("project_brief_propose names the omitted V2 gate dependency field", async () => {
  const service = serviceFor(new MemoryProjectStore());
  const project = await start(service);
  const error = await assertRejects(
    () =>
      service.proposeBrief(AGENT, {
        ...context("propose-missing-deps", project.revision),
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Demonstrate a reviewable system safely.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Demonstrate a bounded operating scenario.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Complete the reviewed scenario.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }],
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "invalid_input");
  assertStringIncludes(error.message, "kind=success-criterion");
  assertStringIncludes(error.message, "requires dependsOnItemIds");
});

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

  assertEquals(project.schemaVersion, "4.0");
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

Deno.test("V2 verification authorities round-trip only on verification activities", async () => {
  const service = serviceFor(new MemoryProjectStore());
  const started = await start(service);
  const items = briefItems("Demonstrate a reviewable system safely").map((item) =>
    item.id === "verify-traceable-record"
      ? {
        ...item,
        verificationAuthority: { id: "assembly-integrity", version: "1.0" },
      }
      : item
  );

  const proposed = await service.proposeBrief(AGENT, {
    ...context("propose-authorized-verification", started.revision),
    items,
  });
  const authority = proposed.framing!.proposedBrief!.items.find((item) =>
    item.id === "verify-traceable-record"
  )?.verificationAuthority;
  assertEquals(authority, { id: "assembly-integrity", version: "1.0" });

  const persistedWrongOwner = structuredClone(proposed) as unknown as {
    framing: {
      proposedBrief: {
        items: Array<Record<string, unknown>>;
      };
    };
  };
  persistedWrongOwner.framing.proposedBrief.items.find((item) =>
    item.id === "success-reviewed-system"
  )!.verificationAuthority = { id: "assembly-integrity", version: "1.0" };
  assertEquals(
    collectEngineeringProjectIssues(persistedWrongOwner).some((issue) =>
      issue.code === "invalid_verification_authority_owner"
    ),
    true,
  );

  const wrongOwner = briefItems("Demonstrate a reviewable system safely").map((item) =>
    item.id === "success-reviewed-system"
      ? {
        ...item,
        verificationAuthority: { id: "assembly-integrity", version: "1.0" },
      }
      : item
  );
  const rejectingService = serviceFor(new MemoryProjectStore());
  const rejectingProject = await start(rejectingService);
  await assertCommandError(
    () =>
      rejectingService.proposeBrief(AGENT, {
        ...context("reject-authority-on-criterion", rejectingProject.revision),
        items: wrongOwner,
      }),
    "invalid_input",
  );
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

Deno.test("publishPlan rejects a caller-supplied activityId", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );
  const plan = baselinePlanCommand("reject-caller-activity", approved.revision);
  (plan.workItems[0] as { activityId?: string }).activityId = "activity:forged";

  await assertCommandError(
    () => commands.publishPlan(AGENT, plan),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, approved.revision);
});

Deno.test("appendChange inherits activity identity from an explicit predecessor", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  let project = await commands.publishPlan(
    AGENT,
    baselinePlanCommand("publish-baseline-for-activity", approved.revision),
  );
  const baselineWorkItemId = "record-approved-brief";
  const runId = "run:baseline-for-activity";
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline-for-activity", project.revision),
    runId,
    workItemId: baselineWorkItemId,
    summary: "Queue the exact approved documentary baseline.",
    basis: project.plan!.basis,
  });
  project = await commands.claimRun(AGENT, {
    ...context("claim-baseline-for-activity", project.revision),
    runId,
    summary: "Claim the exact approved documentary baseline.",
  });
  project = await commands.publishRun(AGENT, {
    ...context("publish-run-for-activity", project.revision),
    runId,
    summary: "Publish the exact approved documentary baseline.",
  });
  const baselineSnapshot = {
    snapshotId: "project-v3:documentary-baseline:r1",
    revision: 1,
    subjectId: project.project.subjectId,
  };
  project = await commands.completeRun(AGENT, {
    ...context("complete-baseline-for-activity", project.revision),
    runId,
    summary: "Complete the exact approved documentary baseline.",
    resultSnapshot: baselineSnapshot,
    evidenceRefs: [{
      snapshotId: baselineSnapshot.snapshotId,
      snapshotRevision: baselineSnapshot.revision,
      kind: "artifact",
      id: "approved-brief-baseline",
    }],
  });

  const changed = await commands.appendChange(AGENT, {
    ...context("append-seed-successor", project.revision),
    baseSnapshot: baselineSnapshot,
    phases: [{
      id: "phase-architecture",
      name: "Architecture",
      description: "Create the bounded reviewed system structure.",
    }],
    workItems: [{
      id: "seed-syson-successor",
      phaseId: "phase-architecture",
      owner: "agent",
      dependsOnWorkItemIds: [baselineWorkItemId],
      decisionIds: [],
      predecessorRevisionId: baselineWorkItemId,
      operation: {
        id: "architecture.seed-syson-model",
        version: "2",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  const successor = changed.workItems.find((item) =>
    item.id === "seed-syson-successor"
  );
  assertEquals(successor?.activityId, "activity:record-approved-brief");
  assertEquals(successor?.predecessorRevisionId, baselineWorkItemId);
});

Deno.test("appendChange can add a successor revision onto an existing phase", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  let project = await commands.publishPlan(
    AGENT,
    baselinePlanCommand("publish-baseline-for-phase-extend", approved.revision),
  );
  const baselineWorkItemId = "record-approved-brief";
  const runId = "run:baseline-for-phase-extend";
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline-for-phase-extend", project.revision),
    runId,
    workItemId: baselineWorkItemId,
    summary: "Queue the exact approved documentary baseline.",
    basis: project.plan!.basis,
  });
  project = await commands.claimRun(AGENT, {
    ...context("claim-baseline-for-phase-extend", project.revision),
    runId,
    summary: "Claim the exact approved documentary baseline.",
  });
  project = await commands.publishRun(AGENT, {
    ...context("publish-run-for-phase-extend", project.revision),
    runId,
    summary: "Publish the exact approved documentary baseline.",
  });
  const baselineSnapshot = {
    snapshotId: "project-v3:documentary-baseline:r1",
    revision: 1,
    subjectId: project.project.subjectId,
  };
  project = await commands.completeRun(AGENT, {
    ...context("complete-baseline-for-phase-extend", project.revision),
    runId,
    summary: "Complete the exact approved documentary baseline.",
    resultSnapshot: baselineSnapshot,
    evidenceRefs: [{
      snapshotId: baselineSnapshot.snapshotId,
      snapshotRevision: baselineSnapshot.revision,
      kind: "artifact",
      id: "approved-brief-baseline",
    }],
  });
  const seedOperation = {
    id: "architecture.seed-syson-model",
    version: "2",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  project = await commands.appendChange(AGENT, {
    ...context("append-seed-root", project.revision),
    baseSnapshot: baselineSnapshot,
    phases: [{
      id: "phase-architecture",
      name: "Architecture",
      description: "Create the bounded reviewed system structure.",
    }],
    workItems: [{
      id: "seed-syson-root",
      phaseId: "phase-architecture",
      owner: "agent",
      dependsOnWorkItemIds: [baselineWorkItemId],
      decisionIds: [],
      operation: seedOperation,
    }],
    requiredDecisions: [],
  });

  const extended = await commands.appendChange(AGENT, {
    ...context("append-seed-successor-same-phase", project.revision),
    baseSnapshot: baselineSnapshot,
    phases: [],
    workItems: [{
      id: "seed-syson-successor-same-phase",
      phaseId: "phase-architecture",
      owner: "agent",
      dependsOnWorkItemIds: [baselineWorkItemId],
      decisionIds: [],
      predecessorRevisionId: "seed-syson-root",
      operation: seedOperation,
    }],
    requiredDecisions: [],
  });
  const architecture = extended.phases.find((phase) =>
    phase.id === "phase-architecture"
  );
  const successor = extended.workItems.find((item) =>
    item.id === "seed-syson-successor-same-phase"
  );
  const change = extended.planChanges?.at(-1);
  assertEquals(extended.phases.map((phase) => phase.id), [
    "phase-baseline",
    "phase-architecture",
  ]);
  assertEquals(architecture?.workItemIds, [
    "seed-syson-root",
    "seed-syson-successor-same-phase",
  ]);
  assertEquals(successor?.activityId, "activity:seed-syson-root");
  assertEquals(successor?.predecessorRevisionId, "seed-syson-root");
  assertEquals(change?.phaseIds, []);
  assertEquals(change?.workItemIds, ["seed-syson-successor-same-phase"]);
});

Deno.test("appendChange rejects a work item that names an unknown phase", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  let project = await commands.publishPlan(
    AGENT,
    baselinePlanCommand("publish-baseline-for-unknown-phase", approved.revision),
  );
  const runId = "run:baseline-for-unknown-phase";
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline-for-unknown-phase", project.revision),
    runId,
    workItemId: "record-approved-brief",
    summary: "Queue the exact approved documentary baseline.",
    basis: project.plan!.basis,
  });
  project = await commands.claimRun(AGENT, {
    ...context("claim-baseline-for-unknown-phase", project.revision),
    runId,
    summary: "Claim the exact approved documentary baseline.",
  });
  project = await commands.publishRun(AGENT, {
    ...context("publish-run-for-unknown-phase", project.revision),
    runId,
    summary: "Publish the exact approved documentary baseline.",
  });
  const baselineSnapshot = {
    snapshotId: "project-v3:documentary-baseline:r1",
    revision: 1,
    subjectId: project.project.subjectId,
  };
  project = await commands.completeRun(AGENT, {
    ...context("complete-baseline-for-unknown-phase", project.revision),
    runId,
    summary: "Complete the exact approved documentary baseline.",
    resultSnapshot: baselineSnapshot,
    evidenceRefs: [{
      snapshotId: baselineSnapshot.snapshotId,
      snapshotRevision: baselineSnapshot.revision,
      kind: "artifact",
      id: "approved-brief-baseline",
    }],
  });

  await assertCommandError(
    () =>
      commands.appendChange(AGENT, {
        ...context("reject-unknown-phase", project.revision),
        baseSnapshot: baselineSnapshot,
        phases: [],
        workItems: [{
          id: "seed-missing-phase",
          phaseId: "phase-does-not-exist",
          owner: "agent",
          dependsOnWorkItemIds: ["record-approved-brief"],
          decisionIds: [],
          operation: {
            id: "architecture.seed-syson-model",
            version: "2",
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        }],
        requiredDecisions: [],
      }),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
});

Deno.test("publishPlan refuses one MRTR decision shared by two work items before persistence", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
  );
  const plan = baselinePlanCommand("reject-shared-mrtr-plan", approved.revision);
  const decisionId = "decision:one-operation-only";
  const first = { ...plan.workItems[0]!, decisionIds: [decisionId] };

  await assertCommandError(
    () =>
      commands.publishPlan(AGENT, {
        ...plan,
        workItems: [first, { ...first, id: "second-reviewed-operation" }],
        requiredDecisions: [{
          id: decisionId,
          phaseId: "phase-baseline",
          title: "One bounded approval",
          question: "Approve one operation only?",
        }],
      }),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, approved.revision);
});

Deno.test("appendChange refuses one MRTR decision shared by two appended work items before persistence", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  let project = await commands.publishPlan(
    AGENT,
    baselinePlanCommand("publish-baseline-for-shared-mrtr-append", approved.revision),
  );
  const baselineWorkItemId = "record-approved-brief";
  const runId = "run:baseline-for-shared-mrtr-append";
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline-for-shared-mrtr-append", project.revision),
    runId,
    workItemId: baselineWorkItemId,
    summary: "Queue the exact approved documentary baseline.",
    basis: project.plan!.basis,
  });
  project = await commands.claimRun(AGENT, {
    ...context("claim-baseline-for-shared-mrtr-append", project.revision),
    runId,
    summary: "Claim the exact approved documentary baseline.",
  });
  project = await commands.publishRun(AGENT, {
    ...context("publish-run-for-shared-mrtr-append", project.revision),
    runId,
    summary: "Publish the exact approved documentary baseline.",
  });
  const baselineSnapshot = {
    snapshotId: "project-v3:documentary-baseline:r1",
    revision: 1,
    subjectId: project.project.subjectId,
  };
  project = await commands.completeRun(AGENT, {
    ...context("complete-baseline-for-shared-mrtr-append", project.revision),
    runId,
    summary: "Complete the exact approved documentary baseline.",
    resultSnapshot: baselineSnapshot,
    evidenceRefs: [{
      snapshotId: baselineSnapshot.snapshotId,
      snapshotRevision: baselineSnapshot.revision,
      kind: "artifact",
      id: "approved-brief-baseline",
    }],
  });
  const decisionId = "decision:one-appended-operation-only";
  const workItem = {
    id: "seed-syson-one",
    phaseId: "phase-architecture",
    owner: "agent" as const,
    dependsOnWorkItemIds: [baselineWorkItemId],
    decisionIds: [decisionId],
    operation: {
      id: "architecture.seed-syson-model",
      version: "2",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
  };

  await assertCommandError(
    () =>
      commands.appendChange(AGENT, {
        ...context("reject-shared-mrtr-append", project.revision),
        baseSnapshot: baselineSnapshot,
        phases: [{
          id: "phase-architecture",
          name: "Architecture",
          description: "Create the bounded reviewed system structure.",
        }],
        workItems: [workItem, { ...workItem, id: "seed-syson-two" }],
        requiredDecisions: [{
          id: decisionId,
          phaseId: "phase-architecture",
          title: "One appended operation",
          question: "Approve one appended operation only?",
        }],
      }),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
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
  assertEquals(
    planned.workItems[0]?.activityId,
    "activity:record-approved-brief",
  );
  assertEquals(planned.workItems[0]?.predecessorRevisionId, undefined);

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
  assertEquals(queued.schemaVersion, "4.0");
  assertEquals(queueReceipt?.type, "agent-run.queue");
  assertEquals(queueReceipt?.queuedRun, {
    runId: "run:legacy-v3-queue",
    workItemId: "record-approved-brief",
  });
  assertEquals(queued.agentRuns[0]?.resolvedOperationPlan, undefined);

  const legacyQueued = structuredClone(queued);
  const legacyQueueReceipt = legacyQueued.commandReceipts!.at(-1)! as {
    commandId: string;
    queuedRun?: unknown;
  };
  delete legacyQueueReceipt.queuedRun;
  await store.commit(legacyQueued, queued.revision);
  assertEquals(legacyQueueReceipt.queuedRun, undefined);
  assertEquals(collectEngineeringProjectIssues(legacyQueued), []);

  const historicalWithPlan = structuredClone(queued);
  const historicalPlanRef: ResolvedOperationPlanRef = {
    schemaVersion: "resolved-operation-plan-ref/1.0",
    planId: "run:legacy-v3-queue",
    fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    byteCount: 1,
    casUri: `casys://resolved-operation-plan/sha256/${"c".repeat(64)}`,
  };
  (historicalWithPlan.agentRuns[0] as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  })
    .resolvedOperationPlan = historicalPlanRef;
  (historicalWithPlan.commandReceipts!.at(-1)!.queuedRun as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = historicalPlanRef;
  assertEquals(
    collectEngineeringProjectIssues(historicalWithPlan).some((issue) =>
      issue.code === "unexpected_resolved_operation_plan"
    ),
    true,
  );

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

Deno.test("a plan 2.0 registered operation seals a server reference before its V3 queue receipt commits", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  let sealInput: RegisteredRunPlanSealInput | undefined;
  const planRef: ResolvedOperationPlanRef = {
    schemaVersion: "resolved-operation-plan-ref/1.0",
    planId: "run:recorded-plan-queue",
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    byteCount: 200,
    casUri: `casys://resolved-operation-plan/sha256/${"a".repeat(64)}`,
  };
  const planning: EngineeringProjectPlanningDependencies = {
    operations: recordedPlanTestRegistry(),
    runPlanSealer: {
      seal(input) {
        sealInput = input;
        return Promise.resolve(planRef);
      },
    },
  };
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    planning,
  );
  const planned = await commands.publishPlan(
    AGENT,
    recordedPlanPlanCommand("publish-plan-2-queue", approved.revision),
  );
  const queueBasis = await addRecordedThreadQueueBasis(store, planned);
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-plan-2", planned.revision),
    runId: planRef.planId,
    workItemId: "verify-fea-isolated",
    summary: "Queue a test-only registered isolated FEA plan.",
    basis: queueBasis,
  });
  const run = queued.agentRuns[0]!;
  const receipt = queued.commandReceipts!.at(-1)!;

  assertEquals(sealInput?.project.id, planned.id);
  assertEquals(sealInput?.project.revision, planned.revision);
  assertEquals(sealInput?.run.inputFingerprint, run.inputFingerprint);
  assertEquals(run.resolvedOperationPlan, planRef);
  assertEquals(receipt.queuedRun?.resolvedOperationPlan, planRef);
  assertEquals(collectEngineeringProjectIssues(queued), []);

  const foreignPlan = structuredClone(queued);
  const foreignPlanRef = { ...planRef, planId: "run:foreign-recorded-plan" };
  (foreignPlan.agentRuns[0] as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = foreignPlanRef;
  (foreignPlan.commandReceipts!.at(-1)!.queuedRun as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = foreignPlanRef;
  assertEquals(
    collectEngineeringProjectIssues(foreignPlan).some((issue) =>
      issue.code === "invalid_resolved_operation_plan_identity" &&
      issue.path === "$.agentRuns[0].resolvedOperationPlan.planId"
    ),
    true,
  );

  const mismatched = structuredClone(queued);
  const mismatchedReceipt = mismatched.commandReceipts!.at(-1)!.queuedRun! as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  };
  mismatchedReceipt.resolvedOperationPlan = {
    ...planRef,
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    casUri: `casys://resolved-operation-plan/sha256/${"b".repeat(64)}`,
  };
  assertEquals(
    collectEngineeringProjectIssues(mismatched).some((issue) =>
      issue.code === "invalid_resolved_operation_plan_receipt"
    ),
    true,
  );

  const planless = structuredClone(queued);
  delete (planless.agentRuns[0] as { resolvedOperationPlan?: unknown })
    .resolvedOperationPlan;
  delete (planless.commandReceipts!.at(-1)!.queuedRun as {
    resolvedOperationPlan?: unknown;
  }).resolvedOperationPlan;
  assertEquals(
    collectEngineeringProjectIssues(planless).some((issue) =>
      issue.code === "missing_resolved_operation_plan"
    ),
    true,
  );

  const receiptWithoutPlan = structuredClone(queued);
  delete (receiptWithoutPlan.commandReceipts!.at(-1)!.queuedRun as {
    resolvedOperationPlan?: unknown;
  }).resolvedOperationPlan;
  assertEquals(
    collectEngineeringProjectIssues(receiptWithoutPlan).some((issue) =>
      issue.code === "invalid_resolved_operation_plan_receipt"
    ),
    true,
  );

  const cancelled = await commands.cancelQueuedRun(HUMAN, {
    ...context("cancel-plan-2-terminal", queued.revision),
    runId: planRef.planId,
    rationale: "Cancel this isolated FEA run before any claim or provider execution.",
  });
  assertEquals(cancelled.agentRuns[0]?.status, "cancelled");
  const foreignTerminalPlan = structuredClone(cancelled);
  (foreignTerminalPlan.agentRuns[0] as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = foreignPlanRef;
  const terminalQueueReceipt = foreignTerminalPlan.commandReceipts!.find((candidate) =>
    candidate.type === "agent-run.queue" &&
    candidate.queuedRun?.runId === planRef.planId
  )!;
  (terminalQueueReceipt.queuedRun as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = foreignPlanRef;
  assertEquals(
    collectEngineeringProjectIssues(foreignTerminalPlan).some((issue) =>
      issue.code === "invalid_resolved_operation_plan_identity" &&
      issue.path === "$.agentRuns[0].resolvedOperationPlan.planId"
    ),
    true,
  );
});

Deno.test("a plan 2.0 sealing failure leaves the V3 project uncommitted", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const planning: EngineeringProjectPlanningDependencies = {
    operations: recordedPlanTestRegistry(),
    runPlanSealer: {
      seal() {
        return Promise.reject(new Error("CAS reread failed"));
      },
    },
  };
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    planning,
  );
  const planned = await commands.publishPlan(
    AGENT,
    recordedPlanPlanCommand("publish-plan-2-failure", approved.revision),
  );
  const queueBasis = await addRecordedThreadQueueBasis(store, planned);
  await assertCommandError(
    () =>
      commands.queueRun(AGENT, {
        ...context("queue-plan-2-forged-plan", planned.revision),
        runId: "run:plan-2-forged-plan",
        workItemId: "verify-fea-isolated",
        summary: "A caller must never choose a plan reference.",
        basis: queueBasis,
        resolvedOperationPlan: {
          schemaVersion: "resolved-operation-plan-ref/1.0",
          planId: "run:forged",
          fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
          byteCount: 1,
          casUri: `casys://resolved-operation-plan/sha256/${"b".repeat(64)}`,
        },
      } as unknown as QueueRunCommand),
    "invalid_input",
  );
  await assertRejects(
    () =>
      commands.queueRun(AGENT, {
        ...context("queue-plan-2-failure", planned.revision),
        runId: "run:plan-2-failure",
        workItemId: "verify-fea-isolated",
        summary: "The synthetic sealer must stop the queue transition.",
        basis: queueBasis,
      }),
    Error,
    "CAS reread failed",
  );
  const unchanged = await store.get(PROJECT_ID);
  assertEquals(unchanged?.revision, planned.revision);
  assertEquals(unchanged?.agentRuns.length, 0);
});

Deno.test("a closed @2 operation cannot queue without a plan sealer or persist without matching seals", async () => {
  const store = new MemoryProjectStore();
  const briefs = serviceFor(store);
  const approved = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => "2026-08-03T09:00:00.000Z",
    { operations: recordedPlanTestRegistry() },
  );
  const planned = await commands.publishPlan(
    AGENT,
    recordedPlanPlanCommand("publish-plan-2-no-sealer", approved.revision),
  );
  const queueBasis = await addRecordedThreadQueueBasis(store, planned);
  await assertCommandError(
    () =>
      commands.queueRun(AGENT, {
        ...context("queue-plan-2-no-sealer", planned.revision),
        runId: "run:plan-2-no-sealer",
        workItemId: "verify-fea-isolated",
        summary: "A closed operation requires a server plan sealer.",
        basis: queueBasis,
      }),
    "invalid_input",
  );
  const unchanged = await store.get(PROJECT_ID);
  assertEquals(unchanged?.revision, planned.revision);
  assertEquals(unchanged?.agentRuns.length, 0);
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

Deno.test(
  "appendChange refuses a SysON seed that does not depend on the unique baseline work item",
  async () => {
    const store = new MemoryProjectStore();
    const briefs = serviceFor(store);
    const approved = await approvedProject(briefs);
    const commands = new EngineeringProjectCommandService(
      store,
      undefined,
      () => "2026-08-03T09:00:00.000Z",
      { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
      { validateInitial: () => Promise.resolve() },
    );
    let project = await commands.publishPlan(
      AGENT,
      baselinePlanCommand("publish-baseline-for-seed-depends", approved.revision),
    );
    const baselineWorkItemId = "record-approved-brief";
    const runId = "run:baseline-for-seed-depends";
    project = await commands.queueRun(AGENT, {
      ...context("queue-baseline-for-seed-depends", project.revision),
      runId,
      workItemId: baselineWorkItemId,
      summary: "Queue the exact approved documentary baseline.",
      basis: project.plan!.basis,
    });
    project = await commands.claimRun(AGENT, {
      ...context("claim-baseline-for-seed-depends", project.revision),
      runId,
      summary: "Claim the exact approved documentary baseline.",
    });
    project = await commands.publishRun(AGENT, {
      ...context("publish-run-for-seed-depends", project.revision),
      runId,
      summary: "Publish the exact approved documentary baseline.",
    });
    const baselineSnapshot = {
      snapshotId: "project-v3:documentary-baseline:r1",
      revision: 1,
      subjectId: project.project.subjectId,
    };
    project = await commands.completeRun(AGENT, {
      ...context("complete-baseline-for-seed-depends", project.revision),
      runId,
      summary: "Complete the exact approved documentary baseline.",
      resultSnapshot: baselineSnapshot,
      evidenceRefs: [{
        snapshotId: baselineSnapshot.snapshotId,
        snapshotRevision: baselineSnapshot.revision,
        kind: "artifact",
        id: "approved-brief-baseline",
      }],
    });

    const error = await assertRejects(
      () =>
        commands.appendChange(AGENT, {
          ...context("append-seed-without-baseline-dep", project.revision),
          baseSnapshot: baselineSnapshot,
          phases: [{
            id: "phase-seed",
            name: "Seed",
            description: "Create the SysON container.",
          }],
          workItems: [{
            id: "wi-seed",
            phaseId: "phase-seed",
            owner: "agent",
            dependsOnWorkItemIds: [],
            decisionIds: [],
            operation: {
              id: "architecture.seed-syson-model",
              version: "2",
              bindings: [{
                name: "approvedBrief",
                source: { kind: "approved-brief" },
              }],
            },
          }],
          requiredDecisions: [],
        }),
      EngineeringProjectCommandError,
    );
    assertEquals(error.code, "invalid_input");
    assertStringIncludes(
      error.message,
      "must depend on baseline.from-approved-brief@1 work item",
    );
    assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
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

function recordedPlanPlanCommand(commandId: string, expectedRevision: number) {
  const command = baselinePlanCommand(commandId, expectedRevision);
  command.workItems[0] = {
    ...command.workItems[0],
    id: "verify-fea-isolated",
    operation: {
      id: "verify.run-fea-static-proof",
      version: "3",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
  };
  return command;
}

function recordedPlanTestRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      if (
        input.operation.id !== "verify.run-fea-static-proof" ||
        input.operation.version !== "3"
      ) {
        throw new TypeError(
          "Test registry permits only verify.run-fea-static-proof@3.",
        );
      }
      return {
        operation: {
          id: "verify.run-fea-static-proof",
          version: "3",
          startingPoint: "idea-or-spec",
          title: "Isolated CalculiX static proof",
          description: "Test-only closed operation marker; no executor is activated.",
          workItemKind: "verify",
          execution: "trusted",
          resolvedOperationPlan: "2.0",
        },
        bindings: input.operation.bindings,
      };
    },
  };
}

async function addRecordedThreadQueueBasis(
  store: MemoryProjectStore,
  project: EngineeringProjectSnapshot,
) {
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: `${project.project.subjectId}:thread:r1`,
    revision: 1,
    subjectId: project.project.subjectId,
  };
  await store.commit({
    ...project,
    threadSnapshots: [{
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
    }],
  }, project.revision);
  return basis;
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
