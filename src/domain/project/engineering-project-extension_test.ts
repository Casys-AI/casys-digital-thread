import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "./engineering-project.ts";
import {
  collectEngineeringProjectExtensionIssues,
  validateEngineeringProjectExtension,
} from "./engineering-project-extension.ts";
import {
  EngineeringProjectValidationError,
  validateEngineeringProjectSnapshot,
} from "./engineering-project-validation.ts";

const AT = "2026-08-01T10:36:58.345Z";
const LATER = "2026-08-01T12:00:00.000Z";
const FINGERPRINT = { algorithm: "sha256" as const, digest: "e".repeat(64) };

Deno.test("validateEngineeringProjectExtension accepts a membership append onto existing phases", () => {
  const previous = plannedProject();
  const next = successorOf(previous, (draft) => {
    draft.phases[0]!.workItemIds = [
      ...draft.phases[0]!.workItemIds,
      "review-geometry",
    ];
    draft.workItems.push({
      id: "review-geometry",
      activityId: "activity:review-geometry",
      phaseId: "verification",
      title: "Review the geometry",
      description: "Appended onto the existing verification phase.",
      kind: "verify",
      operation: {
        id: "verify.run-fea-static-proof",
        version: "3",
        bindings: [],
      },
      status: "planned",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    });
    const change = {
      id: "change:append-existing-phase",
      commandId: "append-existing-phase",
      approvedBriefBasis: plannedBasis(previous),
      baseSnapshot: previous.threadSnapshots[0]!,
      phaseIds: [] as string[],
      workItemIds: ["review-geometry"],
      decisionIds: [] as string[],
      publishedAt: LATER,
      publishedBy: { id: "agent:planner" as const, origin: "agent" as const },
    };
    draft.planChanges = [change];
    stampChangeReceipt(draft, change.commandId);
  });

  assertEquals(validateEngineeringProjectExtension(previous, next).id, next.id);
  assertEquals(collectEngineeringProjectExtensionIssues(previous, next), []);
});

Deno.test("validateEngineeringProjectExtension rejects renaming an existing phase", () => {
  const previous = plannedProject();
  const next = successorOf(previous, (draft) => {
    draft.phases[0]!.name = "Renamed verification";
  });
  assertExtensionRejected(previous, next, "phase_identity_mutated", ".name");
});

Deno.test("validateEngineeringProjectExtension rejects reordering existing phases", () => {
  const previous = plannedProject();
  const next = successorOf(previous, (draft) => {
    const [first, second] = draft.phases;
    draft.phases = [
      { ...second!, order: 1 },
      { ...first!, order: 2 },
    ];
  });
  assertExtensionRejected(previous, next, "phase_removed", "$.phases[0]");
});

Deno.test("validateEngineeringProjectExtension rejects rewriting an existing phase description", () => {
  const previous = plannedProject();
  const next = successorOf(previous, (draft) => {
    draft.phases[0]!.description = "Rewritten description.";
  });
  assertExtensionRejected(
    previous,
    next,
    "phase_identity_mutated",
    ".description",
  );
});

Deno.test("validateEngineeringProjectExtension rejects removing a phase member", () => {
  const previous = plannedProject();
  const next = successorOf(previous, (draft) => {
    draft.phases[1]!.workItemIds = [];
    draft.workItems = draft.workItems.filter((item) => item.id !== "close-record");
  });
  assertExtensionRejected(previous, next, "phase_membership_rewritten");
});

Deno.test(
  "validateEngineeringProjectExtension rejects reclassifying an initial phase as change-created",
  () => {
    const previous = plannedProject();
    const next = successorOf(previous, (draft) => {
      draft.phases[0]!.workItemIds = [
        ...draft.phases[0]!.workItemIds,
        "review-geometry",
      ];
      draft.workItems.push({
        id: "review-geometry",
        activityId: "activity:review-geometry",
        phaseId: "verification",
        title: "Review the geometry",
        description: "Appended onto the existing verification phase.",
        kind: "verify",
        operation: {
          id: "verify.run-fea-static-proof",
          version: "3",
          bindings: [],
        },
        status: "planned",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        decisionIds: [],
        blockerIds: [],
      });
      const change = {
        id: "change:reclassify-verification",
        commandId: "reclassify-verification",
        approvedBriefBasis: plannedBasis(previous),
        baseSnapshot: previous.threadSnapshots[0]!,
        phaseIds: ["verification"],
        workItemIds: ["review-geometry"],
        decisionIds: [] as string[],
        publishedAt: LATER,
        publishedBy: { id: "agent:planner" as const, origin: "agent" as const },
      };
      draft.planChanges = [change];
      stampChangeReceipt(draft, change.commandId);
    });
    assertExtensionRejected(previous, next, "phase_reclassified");
  },
);

Deno.test(
  "validateEngineeringProjectExtension rejects a new work item that the appended change does not own",
  () => {
    const previous = plannedProject();
    const next = successorOf(previous, (draft) => {
      draft.phases[0]!.workItemIds = [
        ...draft.phases[0]!.workItemIds,
        "review-geometry",
        "orphan-work",
      ];
      for (const id of ["review-geometry", "orphan-work"]) {
        draft.workItems.push({
          id,
          activityId: `activity:${id}`,
          phaseId: "verification",
          title: id,
          description: "Appended work.",
          kind: "verify",
          operation: {
            id: "verify.run-fea-static-proof",
            version: "3",
            bindings: [],
          },
          status: "planned",
          owner: "agent",
          dependsOnWorkItemIds: [],
          evidenceRefs: [],
          decisionIds: [],
          blockerIds: [],
        });
      }
      const change = {
        id: "change:partial-ownership",
        commandId: "partial-ownership",
        approvedBriefBasis: plannedBasis(previous),
        baseSnapshot: previous.threadSnapshots[0]!,
        phaseIds: [] as string[],
        workItemIds: ["review-geometry"],
        decisionIds: [] as string[],
        publishedAt: LATER,
        publishedBy: { id: "agent:planner" as const, origin: "agent" as const },
      };
      draft.planChanges = [change];
      stampChangeReceipt(draft, change.commandId);
    });
    assertExtensionRejected(previous, next, "plan_change_delta_mismatch");
  },
);

Deno.test(
  "validateEngineeringProjectExtension rejects reopening abandoned work",
  () => {
    const previous = successorOf(plannedProject(), (draft) => {
      draft.workItems = draft.workItems.map((item) =>
        item.id === "close-record" ? { ...item, status: "abandoned" } : item
      );
    });
    const next = successorOf(previous, (draft) => {
      draft.workItems = draft.workItems.map((item) =>
        item.id === "close-record" ? { ...item, status: "planned" } : item
      );
    });
    assertExtensionRejected(previous, next, "work_terminal_reopened");
  },
);

Deno.test(
  "validateEngineeringProjectExtension allows an unexecuted plan-publish replacement",
  () => {
    const previous = replaceablePlannedProject();
    const next = successorOf(previous, (draft) => {
      draft.plan = {
        ...draft.plan!,
        publishedAt: LATER,
        publishedBy: { id: "agent:planner", origin: "agent" },
      };
      draft.phases = [{
        id: "baseline",
        name: "Engineering baseline",
        order: 1,
        description: "Replacement unexecuted plan.",
        workItemIds: ["record-approved-brief"],
        requiredDecisionIds: [],
        evidenceRefs: [],
      }];
      draft.workItems = [{
        id: "record-approved-brief",
        activityId: "activity:record-approved-brief",
        phaseId: "baseline",
        title: "Establish the engineering baseline",
        description: "Replacement baseline work.",
        kind: "define",
        operation: {
          id: "baseline.from-approved-brief",
          version: "1",
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
        status: "planned",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        decisionIds: [],
        blockerIds: [],
      }];
      draft.decisions = [];
      const receipts = draft.commandReceipts ?? [];
      receipts[receipts.length - 1] = {
        commandId: "republish-plan",
        type: "project.plan-publish",
        actor: { id: "agent:planner", origin: "agent" },
        issuedAt: LATER,
        appliedAt: LATER,
        requestFingerprint: { algorithm: "sha256", digest: "5".repeat(64) },
        resultingSnapshot: { snapshotId: draft.id, revision: draft.revision },
      };
    });
    assertEquals(validateEngineeringProjectExtension(previous, next).id, next.id);
  },
);

Deno.test(
  "validateEngineeringProjectExtension rejects removing a recorded reconciliation",
  () => {
    const previous = reconciledCancelledProject();
    const next = successorOf(previous, (draft) => {
      draft.workItems = draft.workItems.map((item) => {
        if (item.id !== "close-record") return item;
        const { reconciliation: _removed, ...rest } = item;
        return rest;
      });
    });
    assertExtensionRejected(previous, next, "reconciliation_mutated");
  },
);

function assertExtensionRejected(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  code: string,
  pathFragment?: string,
): void {
  const issues = collectEngineeringProjectExtensionIssues(previous, next);
  assertEquals(issues.some((issue) => issue.code === code), true);
  if (pathFragment) {
    assertEquals(
      issues.some((issue) => issue.path.includes(pathFragment)),
      true,
    );
  }
  assertThrows(
    () => validateEngineeringProjectExtension(previous, next),
    EngineeringProjectValidationError,
  );
}

function successorOf(
  previous: EngineeringProjectSnapshot,
  mutate: (draft: Mutable<EngineeringProjectSnapshot>) => void,
): EngineeringProjectSnapshot {
  const next = structuredClone(previous) as Mutable<EngineeringProjectSnapshot>;
  next.id = `${previous.project.id}:r${previous.revision + 1}`;
  next.revision = previous.revision + 1;
  next.generatedAt = LATER;
  next.previous = { snapshotId: previous.id, revision: previous.revision };
  next.commandReceipts = [
    ...(previous.commandReceipts ?? []),
    {
      commandId: `extension-${next.revision}`,
      type: "decision.propose",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: LATER,
      appliedAt: LATER,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: next.id, revision: next.revision },
    },
  ];
  mutate(next);
  return validateEngineeringProjectSnapshot(next);
}

function replaceablePlannedProject(): EngineeringProjectSnapshot {
  const planned = structuredClone(plannedProject()) as Mutable<
    EngineeringProjectSnapshot
  >;
  planned.threadSnapshots = [];
  return validateEngineeringProjectSnapshot(planned);
}

function reconciledCancelledProject(): EngineeringProjectSnapshot {
  return successorOf(plannedProject(), (draft) => {
    const snapshot = draft.threadSnapshots[0]!;
    const evidence = {
      snapshotId: snapshot.snapshotId,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: "close-record-successor",
    };
    draft.workItems = draft.workItems.map((item) =>
      item.id === "close-record"
        ? {
          ...item,
          status: "cancelled" as const,
          reconciliation: {
            kind: "superseded-by-successor" as const,
            reconciledAt: LATER,
            reconciledBy: { id: "agent:planner", origin: "agent" as const },
            failedRunId: "run:close-failed",
            successorRunId: "run:close-successor",
            successorRunSnapshot: structuredClone(snapshot),
            successorEvidenceRefs: [evidence],
            rationale: "A completed successor closed the failed attempt.",
          },
        }
        : item
    );
    draft.workItems.push({
      id: "close-record-v2",
      activityId: "activity:close-record",
      predecessorRevisionId: "close-record",
      phaseId: "closeout",
      title: "Close the record",
      description: "Completed successor of the cancelled closeout.",
      kind: "industrialize",
      operation: {
        id: "record.archive-lineage",
        version: "1",
        bindings: [],
      },
      status: "completed",
      owner: "shared",
      dependsOnWorkItemIds: ["verify-generic-input"],
      evidenceRefs: [evidence],
      decisionIds: [],
      blockerIds: [],
    });
    draft.phases[1] = {
      ...draft.phases[1]!,
      workItemIds: [...draft.phases[1]!.workItemIds, "close-record-v2"],
      evidenceRefs: [evidence],
    };
    const basis = {
      kind: "thread-snapshot" as const,
      snapshotId: snapshot.snapshotId,
      revision: snapshot.revision,
      subjectId: snapshot.subjectId,
    };
    const inputFingerprint = {
      algorithm: "sha256" as const,
      digest: "b".repeat(64),
    };
    draft.agentRuns = [{
      id: "run:close-failed",
      workItemId: "close-record",
      status: "failed",
      summary: "Failed before evidence.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: LATER,
      evidenceRefs: [],
      failure: { code: "provider_failed", message: "The run failed." },
      basis,
      inputFingerprint,
    }, {
      id: "run:close-successor",
      workItemId: "close-record-v2",
      status: "completed",
      summary: "Completed successor.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: LATER,
      evidenceRefs: [evidence],
      resultSnapshot: structuredClone(snapshot),
      basis,
      inputFingerprint,
    }];
  });
}

function plannedProject(): EngineeringProjectSnapshot {
  const basis = {
    kind: "approved-brief" as const,
    projectId: "generic-project",
    projectSnapshotId: "engineering-project-generic-r1",
    projectRevision: 2,
    briefId: "generic-project:brief",
    briefSnapshotId: "generic-project:brief:r1:fixture",
    briefRevision: 1,
    approvedBriefFingerprint: FINGERPRINT,
  };
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "engineering-project-generic-r2",
    revision: 3,
    generatedAt: AT,
    previous: {
      snapshotId: "engineering-project-generic-r1",
      revision: 2,
    },
    project: {
      id: "generic-project",
      name: "Generic project",
      subjectId: "generic-subject",
      objective: {
        title: "Exercise immutable project storage without a product fixture.",
        statement: "Exercise immutable project storage without a product fixture.",
      },
    },
    framing: {
      intent: {
        statement: "Exercise immutable project storage without a product fixture.",
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: AT,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId: "generic-project:brief",
        id: "generic-project:brief:r1:fixture",
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Exercise immutable project storage without a product fixture.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Persist and reread an exact project revision.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "The stored revision validates and round-trips unchanged.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }],
        proposedAt: AT,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: "generic-project:brief:r1:fixture",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: FINGERPRINT,
        requestedAt: AT,
        decidedAt: AT,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Confirmed in the paired conversation.",
      },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis,
      publishedAt: AT,
      publishedBy: { id: "agent:planner", origin: "agent" },
    },
    threadSnapshots: [{
      snapshotId: "generic-thread-r1",
      revision: 1,
      subjectId: "generic-subject",
    }],
    phases: [{
      id: "verification",
      name: "Verification",
      order: 1,
      description: "Review the bounded verification input.",
      workItemIds: ["verify-generic-input"],
      requiredDecisionIds: ["review-generic-input"],
      evidenceRefs: [],
    }, {
      id: "closeout",
      name: "Closeout",
      order: 2,
      description: "Close the manufacturing record.",
      workItemIds: ["close-record"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "verify-generic-input",
      activityId: "activity:verify-generic-input",
      phaseId: "verification",
      title: "Verify the generic input",
      description: "Wait for the exact input decision before execution.",
      kind: "verify",
      operation: {
        id: "verify.lifecycle-fixture",
        version: "1",
        bindings: [],
      },
      status: "waiting-for-decision",
      owner: "shared",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["review-generic-input"],
      blockerIds: [],
    }, {
      id: "close-record",
      activityId: "activity:close-record",
      phaseId: "closeout",
      title: "Close the record",
      description: "Keep a second phase so order mutations are observable.",
      kind: "industrialize",
      operation: {
        id: "record.archive-lineage",
        version: "1",
        bindings: [],
      },
      status: "planned",
      owner: "shared",
      dependsOnWorkItemIds: ["verify-generic-input"],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: [{
      id: "review-generic-input",
      phaseId: "verification",
      title: "Review the generic input",
      question: "Which exact input should govern the generic verification?",
      status: "required",
      requestedAt: AT,
      inputEvidenceRefs: [],
      approvalIds: [],
    }],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start-generic-project",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: {
        snapshotId: "engineering-project-generic-r0-start",
        revision: 1,
      },
    }, {
      commandId: "approve-generic-brief",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: {
        snapshotId: "engineering-project-generic-r1",
        revision: 2,
      },
      approvedBriefBasis: basis,
    }, {
      commandId: "publish-generic-plan",
      type: "project.plan-publish",
      actor: { id: "agent:planner", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
      resultingSnapshot: {
        snapshotId: "engineering-project-generic-r2",
        revision: 3,
      },
    }],
  });
}

function plannedBasis(project: EngineeringProjectSnapshot) {
  return structuredClone(project.plan!.basis);
}

function stampChangeReceipt(
  draft: Mutable<EngineeringProjectSnapshot>,
  commandId: string,
): void {
  const receipts = draft.commandReceipts ?? [];
  receipts[receipts.length - 1] = {
    commandId,
    type: "project.change-append",
    actor: { id: "agent:planner", origin: "agent" },
    issuedAt: LATER,
    appliedAt: LATER,
    requestFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
    resultingSnapshot: { snapshotId: draft.id, revision: draft.revision },
  };
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
