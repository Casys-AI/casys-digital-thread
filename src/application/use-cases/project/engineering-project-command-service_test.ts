import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  deriveEngineeringPhaseStatus,
  deriveEngineeringProjectStatus,
  type EngineeringProjectSnapshot,
  type EngineeringThreadSnapshotRef,
} from "../../../domain/project/engineering-project.ts";
import {
  type AbandonWorkItemsCommand,
  type CancelQueuedRunCommand,
  type CompleteRunCommand,
  ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES,
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectCompletionEvidenceValidator,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectReconciliationOperationPolicy,
  type QueueRunCommand,
} from "./engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../ports/out/engineering-project-revision-store.ts";
import {
  EngineeringProjectValidationError,
  validateEngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project-validation.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { UncertainWriterLifecycleQualifier } from "../../ports/out/record/uncertain-writer-lifecycle-qualifier.ts";

const CONFIG = new URL(
  "../../../testing/generic-engineering-project.fixture.json",
  import.meta.url,
);
const HUMAN = { kind: "human" as const, actorId: "operator-7" };
const AGENT = { kind: "agent" as const, actorId: "agent-worker-3" };
const OTHER_AGENT = { kind: "agent" as const, actorId: "agent-worker-9" };

Deno.test("a failed work item closes only through exact successor reconciliation", async () => {
  const project = await reconciliableProject();
  const store = new MemoryRevisionStore(project);
  const service = serviceFor(store);
  const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
    .evidenceRefs;
  const successorRunSnapshot = project.threadSnapshots[0]!;
  const successorSnapshot = {
    snapshotId: "generic-test-system:r6:reconciliation-closeout",
    revision: 6,
    subjectId: PROJECT_ID,
  };
  const command = {
    ...context("reconcile-r2-through-r3", project.revision),
    failedWorkItemId: "verify-current-mechanical-design",
    failedRunId: "run:mechanical-r2-failed",
    successorRunId: "run:mechanical-r3-completed",
    successorRunSnapshot,
    successorSnapshot,
    successorEvidenceRefs: evidence,
    rationale:
      "R2 stopped before durable evidence. The separately completed R3 successor is the exact current proof.",
  };

  const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, command);
  const failedWork = findWorkItem(
    reconciled,
    "verify-current-mechanical-design",
  );

  assertEquals(failedWork.status, "cancelled");
  assertEquals(failedWork.evidenceRefs, []);
  assertEquals(failedWork.reconciliation?.kind, "superseded-by-successor");
  assertEquals(failedWork.reconciliation?.failedRunId, command.failedRunId);
  assertEquals(failedWork.reconciliation?.successorRunId, command.successorRunId);
  assertEquals(
    reconciled.agentRuns.find((run) => run.id === command.failedRunId)?.status,
    "failed",
  );
  assertEquals(
    reconciled.agentRuns.find((run) => run.id === command.successorRunId)?.status,
    "completed",
  );
  assertEquals(
    deriveEngineeringPhaseStatus(reconciled, "verification"),
    "completed",
  );
  assertEquals(deriveEngineeringProjectStatus(reconciled), "completed");
  assertEquals(
    reconciled.commandReceipts?.at(-1)?.type,
    "work-item.reconcile-successor",
  );

  const replay = await service.reconcileWorkItemWithSuccessor(AGENT, command);
  assertEquals(replay.id, reconciled.id);

  await assertCommandError(
    () =>
      service.reconcileWorkItemWithSuccessor(HUMAN, {
        ...command,
        commandId: "human-cannot-reconcile",
        expectedRevision: reconciled.revision,
      }),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.reconcileWorkItemWithSuccessor(AGENT, {
        ...command,
        commandId: "mismatched-successor-evidence",
        expectedRevision: reconciled.revision,
        successorEvidenceRefs: [],
      }),
    "invalid_input",
  );
});

Deno.test(
  "direct reconciliation closes a failed work item when successor run is already the project thread head",
  async () => {
    const project = await reconciliableProject();
    const store = new MemoryRevisionStore(project);
    // Service with the snapshot validator still wired — it is not called for
    // direct reconciliation (no successorSnapshot in the command).
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;
    const successorRunSnapshot = project.threadSnapshots.at(-1)!;

    // Direct reconciliation: no successorSnapshot field.
    const command = {
      ...context("direct-reconcile-r2-through-r3", project.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:mechanical-r2-failed",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot,
      successorEvidenceRefs: evidence,
      rationale:
        "R2 stopped before durable evidence. The separately completed R3 is already the project thread head.",
    };

    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, command);
    const failedWork = findWorkItem(reconciled, "verify-current-mechanical-design");

    assertEquals(failedWork.status, "cancelled");
    assertEquals(failedWork.evidenceRefs, []);
    assertEquals(failedWork.reconciliation?.kind, "superseded-by-successor");
    assertEquals(failedWork.reconciliation?.successorRunId, command.successorRunId);
    // Direct reconciliation leaves successorSnapshot absent.
    assertEquals(failedWork.reconciliation?.successorSnapshot, undefined);
    // No new threadSnapshot was added — the project lineage grows only via
    // published evidence, not through the reconciliation closeout itself.
    assertEquals(reconciled.threadSnapshots.length, project.threadSnapshots.length);
    assertEquals(
      reconciled.agentRuns.find((run) => run.id === command.failedRunId)?.status,
      "failed",
    );
    assertEquals(
      reconciled.agentRuns.find((run) => run.id === command.successorRunId)?.status,
      "completed",
    );
    assertEquals(deriveEngineeringPhaseStatus(reconciled, "verification"), "completed");
    assertEquals(deriveEngineeringProjectStatus(reconciled), "completed");

    // Idempotent replay.
    const replay = await service.reconcileWorkItemWithSuccessor(AGENT, command);
    assertEquals(replay.id, reconciled.id);

    // Guard: mismatched successorRunSnapshot (not the project thread head) is rejected.
    // Use the reconciled revision so the CAS check passes and the domain guard fires.
    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...command,
          commandId: "not-the-head",
          expectedRevision: reconciled.revision,
          successorRunSnapshot: {
            snapshotId: "other:r9",
            revision: 9,
            subjectId: "other-subject",
          },
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "direct reconciliation accepts a declared successor snapshot when the injected lineage validator proves it is a current-head ancestor",
  async () => {
    // Push a second snapshot onto the project so the original r5 is no longer
    // the head. assertDeclaredSnapshot must pass (r5 is declared), but the
    // head-position guard must fire (r6 is at(-1), not r5).
    const base = await reconciliableProject();
    const mutable = structuredClone(base) as Mutable<EngineeringProjectSnapshot>;
    (mutable.threadSnapshots as EngineeringThreadSnapshotRef[]).push({
      snapshotId: "generic-test-system:r6:guard-test-head",
      revision: 6,
      subjectId: "generic-test-system",
    });
    const project = validateEngineeringProjectSnapshot(mutable);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    // r5 is at index [0]; r6 is at index [1] = at(-1). The injected
    // persistence validator is the authority that proves r6 descends from r5.
    const declaredButNotHead = project.threadSnapshots[0]!;

    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, {
      ...context("ancestor-lineage-guard", project.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:mechanical-r2-failed",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot: declaredButNotHead,
      successorEvidenceRefs: evidence,
      rationale: "The persisted current head descends from the completed successor.",
    });
    assertEquals(
      findWorkItem(reconciled, "verify-current-mechanical-design").status,
      "cancelled",
    );
  },
);

Deno.test(
  "direct reconciliation closes a work item whose run was cancelled before any agent claim",
  async () => {
    // The DL-01 case: a work item's run was cancelled (human, before any claim)
    // because the executor rejected the planning lineage. A new successor run
    // independently completed. The cancelled run is a valid "failed" anchor because
    // no provider was ever contacted (no claimedAt, no startedAt).
    const base = await reconciliableProject();
    const store = new MemoryRevisionStore(base);
    const service = serviceFor(store);
    const evidence = findWorkItem(base, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    // Queue a new run for the work item and immediately cancel it before any claim.
    const queued = await service.queueRun(
      AGENT,
      queueRunCommand("queue-r2b-pre-claim-cancel", base, {
        runId: "run:mechanical-r2b-pre-claim",
        workItemId: "verify-current-mechanical-design",
        summary: "Second attempt that will be cancelled before any claim.",
      }),
    );
    const withCancelled = await service.cancelQueuedRun(HUMAN, {
      ...context("cancel-r2b-pre-claim", queued.revision),
      runId: "run:mechanical-r2b-pre-claim",
      rationale:
        "Executor rejects non-append lineage; cancelling before claim avoids any provider contact.",
    });

    const cancelledRun = withCancelled.agentRuns.find((run) =>
      run.id === "run:mechanical-r2b-pre-claim"
    )!;
    assertEquals(cancelledRun.status, "cancelled");
    assertEquals(cancelledRun.claimedAt, undefined);
    assertEquals(cancelledRun.startedAt, undefined);

    // Reconcile using the cancelled run as the "failed" anchor.
    const successorRunSnapshot = withCancelled.threadSnapshots.at(-1)!;
    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, {
      ...context("reconcile-cancelled-r2b-through-r3", withCancelled.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:mechanical-r2b-pre-claim",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot,
      successorEvidenceRefs: evidence,
      rationale:
        "The pre-claim cancelled run never touched a provider; the completed R3 successor already delivered the result.",
    });

    const failedWork = findWorkItem(reconciled, "verify-current-mechanical-design");
    assertEquals(failedWork.status, "cancelled");
    assertEquals(
      failedWork.reconciliation?.failedRunId,
      "run:mechanical-r2b-pre-claim",
    );
    assertEquals(
      failedWork.reconciliation?.successorRunId,
      "run:mechanical-r3-completed",
    );
    assertEquals(failedWork.reconciliation?.successorSnapshot, undefined);
    assertEquals(
      reconciled.agentRuns.find((run) => run.id === "run:mechanical-r2b-pre-claim")
        ?.status,
      "cancelled",
    );
    assertEquals(deriveEngineeringPhaseStatus(reconciled, "verification"), "completed");
    assertEquals(deriveEngineeringProjectStatus(reconciled), "completed");
    // The snapshot was NOT validated so no validator call needed.
    validateEngineeringProjectSnapshot(reconciled);
  },
);

// Friction 2 guard: cancelled + reconciliation must unlock dependents.
Deno.test(
  "a cancelled-with-reconciliation predecessor unlocks its planned dependents",
  async () => {
    // reconciliableProject() sets verify-current-mechanical-design to "ready"
    // and provides verify-current-mechanical-design-r3 as a completed successor.
    // We patch observe-erp-definition to depend on the reconciled work item so
    // nextIdleWorkStatus is exercised with a cancelled + reconciliation dep.
    const base = structuredClone(
      await reconciliableProject(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const dependent = base.workItems.find((item) =>
      item.id === "observe-erp-definition"
    )!;
    (dependent as Mutable<typeof dependent>).status = "planned";
    (dependent as Mutable<typeof dependent>).dependsOnWorkItemIds = [
      "verify-current-mechanical-design",
    ];
    (dependent as Mutable<typeof dependent>).evidenceRefs = [];
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);

    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;
    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, {
      ...context("unlock-planned-dependents", project.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:mechanical-r2-failed",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot: project.threadSnapshots.at(-1)!,
      successorEvidenceRefs: evidence,
      rationale: "Successor independently verified; dependents should unblock.",
    });

    // The cancelled work item carries a reconciliation record.
    const reconciledWork = findWorkItem(reconciled, "verify-current-mechanical-design");
    assertEquals(reconciledWork.status, "cancelled");
    assert(reconciledWork.reconciliation !== undefined);

    // Before the fix, nextIdleWorkStatus only counted "completed" deps, so
    // observe-erp-definition would remain "planned" indefinitely.
    assertEquals(findWorkItem(reconciled, "observe-erp-definition").status, "ready");
  },
);

// Operation equivalence guard tests — DL-01 BLOQUANT fix.
// These tests verify that reconcileWorkItemWithSuccessor refuses to close a
// registered-operation work item with a successor that carries a different operation.

// Plain object (not typed as EngineeringOperationRef) so structuredClone returns
// a mutable copy that can be assigned to Mutable<EngineeringWorkItem>.operation.
const SEED_OP = {
  id: "architecture.seed-syson-model",
  version: "2",
  bindings: [{ name: "project", source: { kind: "approved-brief" as const } }],
};

/** Like reconciliableProject() but both work items carry SEED_OP. */
async function reconciliableProjectWithOperation(): Promise<
  EngineeringProjectSnapshot
> {
  const project = structuredClone(
    await reconciliableProject(),
  ) as Mutable<EngineeringProjectSnapshot>;
  const failedWork = project.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  )!;
  const successorWork = project.workItems.find((item) =>
    item.id === "verify-current-mechanical-design-r3"
  )!;
  (failedWork as Mutable<typeof failedWork>).operation = structuredClone(SEED_OP);
  (successorWork as Mutable<typeof successorWork>).operation = structuredClone(SEED_OP);
  return validateEngineeringProjectSnapshot(project);
}

Deno.test(
  "direct reconciliation rejects a successor from a different operation id",
  async () => {
    // Build the fixture with the successor carrying a different operation id.
    // validateEngineeringProjectSnapshot still passes because no reconciliation
    // record is present yet — the equivalence check only fires on reconcile.
    const base = structuredClone(
      await reconciliableProjectWithOperation(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    (successorWork as Mutable<typeof successorWork>).operation = {
      ...SEED_OP,
      id: "architecture.different-operation",
    };
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-diff-op-id", project.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: project.threadSnapshots.at(-1)!,
          successorEvidenceRefs: evidence,
          rationale: "Should be rejected: different operation id.",
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "direct reconciliation rejects a successor from a different operation version",
  async () => {
    const base = structuredClone(
      await reconciliableProjectWithOperation(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    (successorWork as Mutable<typeof successorWork>).operation = {
      ...SEED_OP,
      version: "3",
    };
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-diff-op-version", project.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: project.threadSnapshots.at(-1)!,
          successorEvidenceRefs: evidence,
          rationale: "Should be rejected: different operation version.",
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "direct reconciliation rejects a successor with different operation bindings",
  async () => {
    const base = structuredClone(
      await reconciliableProjectWithOperation(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    (successorWork as Mutable<typeof successorWork>).operation = {
      ...SEED_OP,
      bindings: [
        { name: "project", source: { kind: "approved-brief" } },
        { name: "extra-binding", source: { kind: "approved-brief" } },
      ],
    };
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-diff-bindings", project.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: project.threadSnapshots.at(-1)!,
          successorEvidenceRefs: evidence,
          rationale: "Should be rejected: different bindings.",
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "direct reconciliation accepts a DL-01 style successor with the identical operation",
  async () => {
    // Happy path: both work items carry the same operation id, version, bindings.
    // This is the DL-01 case — seed@2 failed, seed@2 succeeds via change-append.
    const project = await reconciliableProjectWithOperation();
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, {
      ...context("accept-same-op", project.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:mechanical-r2-failed",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot: project.threadSnapshots.at(-1)!,
      successorEvidenceRefs: evidence,
      rationale: "seed@2 failed; seed@2 via change-append completed the seed.",
    });
    const failedWork = findWorkItem(reconciled, "verify-current-mechanical-design");
    assertEquals(failedWork.status, "cancelled");
    assertEquals(failedWork.reconciliation?.kind, "superseded-by-successor");
    assertEquals(deriveEngineeringProjectStatus(reconciled), "completed");
    validateEngineeringProjectSnapshot(reconciled);
  },
);

Deno.test(
  "direct reconciliation rejects a successor from a different activity",
  async () => {
    const base = structuredClone(await reconciliableProject()) as Mutable<
      EngineeringProjectSnapshot
    >;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    successorWork.activityId = "activity:verify-current-mechanical-design-r3";
    delete successorWork.predecessorRevisionId;
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-cross-activity", project.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: project.threadSnapshots.at(-1)!,
          successorEvidenceRefs: evidence,
          rationale: "Should be rejected: a different stable activity.",
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "direct reconciliation rejects a same-activity sibling with the matching operation",
  async () => {
    const base = structuredClone(await reconciliableProject()) as Mutable<
      EngineeringProjectSnapshot
    >;
    const rootId = "verify-current-mechanical-design-root";
    const activityId = `activity:${rootId}`;
    const failedWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design"
    )!;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    const phase = base.phases.find((item) => item.id === failedWork.phaseId)!;
    base.workItems.push({
      ...structuredClone(failedWork),
      id: rootId,
      activityId,
      title: "Root revision for the sibling guard",
      description: "The stable activity root has no successor closeout evidence.",
      status: "cancelled",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    });
    failedWork.activityId = activityId;
    failedWork.predecessorRevisionId = rootId;
    successorWork.activityId = activityId;
    successorWork.predecessorRevisionId = rootId;
    phase.workItemIds = [rootId, ...phase.workItemIds];
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-same-activity-sibling", project.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: project.threadSnapshots.at(-1)!,
          successorEvidenceRefs: evidence,
          rationale:
            "A same-activity sibling cannot substitute for the direct successor revision.",
        }),
      "invalid_input",
    );
  },
);

Deno.test("proposal is typed, server-timestamped, fingerprinted and idempotent", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const command = {
    ...context("propose-criterion", (await store.get(PROJECT_ID))!.revision),
    issuedAt: "2026-08-01T18:59:00+08:00",
    decisionId: "review-mechanical-proof-case",
    proposal: proposal("criterion"),
    baseSnapshot: baseSnapshot(await store.get(PROJECT_ID)),
  };

  const proposed = await service.proposeDecision(HUMAN, command);
  const decision = findDecision(proposed, command.decisionId);

  assertEquals(proposed.revision, command.expectedRevision + 1);
  assertEquals(decision.status, "proposed");
  assertEquals(decision.proposal?.proposedAt, "2026-08-01T11:00:01.000Z");
  assertEquals(decision.proposal?.proposedBy, { id: HUMAN.actorId, origin: "human" });
  assertEquals(decision.proposal?.parameters[0].value, "criterion");
  assertEquals(decision.inputFingerprint?.digest.length, 64);
  assertEquals(proposed.approvals[0].status, "pending");
  assertEquals(
    proposed.commandReceipts?.at(-1)?.appliedAt,
    "2026-08-01T11:00:01.000Z",
  );
  assertEquals(
    proposed.commandReceipts?.at(-1)?.issuedAt,
    "2026-08-01T10:59:00.000Z",
  );

  const replay = await service.proposeDecision(HUMAN, {
    ...command,
    issuedAt: "2026-08-01T10:59:00.000Z",
  });
  assertEquals(replay.id, proposed.id);
  assertEquals(
    (await store.get(PROJECT_ID))?.revision,
    command.expectedRevision + 1,
  );

  await assertCommandError(
    () =>
      service.proposeDecision(HUMAN, {
        ...command,
        proposal: proposal("different"),
      }),
    "command_id_conflict",
  );
});

Deno.test("stale revision and approval scope mismatch fail without mutation", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const startRevision = (await store.get(PROJECT_ID))!.revision;
  const proposed = await propose(
    service,
    store,
    "review-mechanical-proof-case",
    startRevision,
    1,
  );

  await assertCommandError(
    () =>
      propose(
        service,
        store,
        "review-mechanical-proof-case",
        startRevision,
        2,
      ),
    "stale_revision",
  );
  await assertCommandError(
    () =>
      service.approveDecision(HUMAN, {
        ...context("approve-wrong-scope", proposed.revision),
        decisionId: "review-mechanical-proof-case",
        rationale: "Reviewed in the test.",
        inputFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      }),
    "approval_scope_mismatch",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, proposed.revision);
});

Deno.test("rejected proposal can be replaced without rewriting historical approval scope", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  let project = await propose(
    service,
    store,
    "review-mechanical-proof-case",
    (await store.get(PROJECT_ID))!.revision,
    1,
  );
  const firstDecision = findDecision(project, "review-mechanical-proof-case");
  project = await service.rejectDecision(HUMAN, {
    ...context("reject-first-scope", project.revision),
    decisionId: firstDecision.id,
    rationale: "The first test scope is not acceptable.",
    inputFingerprint: firstDecision.inputFingerprint!,
  });
  assertEquals(deriveEngineeringProjectStatus(project), "attention-required");
  const historicalApproval = structuredClone(project.approvals[0]);

  project = await service.proposeDecision(HUMAN, {
    ...context("propose-replacement-scope", project.revision),
    decisionId: firstDecision.id,
    proposal: proposal("replacement"),
    baseSnapshot: baseSnapshot(project),
  });
  const replacementDecision = findDecision(project, firstDecision.id);
  assertEquals(project.approvals[0], historicalApproval);
  assertEquals(project.approvals[0].status, "rejected");
  assertEquals(project.approvals[1].status, "pending");
  assertEquals(
    project.approvals[0].inputFingerprint?.digest ===
      project.approvals[1].inputFingerprint?.digest,
    false,
  );

  project = await service.approveDecision(HUMAN, {
    ...context("approve-replacement-scope", project.revision),
    decisionId: replacementDecision.id,
    rationale: "The replacement scope was explicitly reviewed.",
    inputFingerprint: replacementDecision.inputFingerprint!,
  });
  assertEquals(findDecision(project, firstDecision.id).status, "approved");
  assertEquals(project.approvals.map((item) => item.status), [
    "rejected",
    "approved",
  ]);
  assertEquals(project.approvals[0], historicalApproval);
});

Deno.test("human approvals resolve their blockers and unlock work only after all decisions", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  let project = (await store.get(PROJECT_ID))!;
  const decisionIds =
    project.workItems.find((item) => item.id === "verify-current-mechanical-design")!
      .decisionIds;

  for (const [index, decisionId] of decisionIds.entries()) {
    project = await propose(
      service,
      store,
      decisionId,
      project.revision,
      index * 2 + 1,
    );
    const decision = findDecision(project, decisionId);
    project = await service.approveDecision(HUMAN, {
      ...context(`approve-${decisionId}`, project.revision),
      decisionId,
      rationale: "Explicit test review.",
      inputFingerprint: decision.inputFingerprint!,
    });
    const blocker = project.blockers.find((item) =>
      item.decisionIds.includes(decisionId)
    )!;
    assertEquals(blocker.status, "resolved");
    assertEquals(blocker.resolvedAt !== undefined, true);
    const status = project.workItems.find((item) =>
      item.id === "verify-current-mechanical-design"
    )!.status;
    assertEquals(
      status,
      index === decisionIds.length - 1 ? "ready" : "waiting-for-decision",
    );
  }

  assertEquals(project.blockers.every((item) => item.status === "resolved"), true);
  assertEquals(
    project.approvals.every((item) =>
      item.status === "approved" && item.decidedByOrigin === "human"
    ),
    true,
  );
});

Deno.test("one approval cannot make two work items ready through a shared blocker decision", async () => {
  const initialStore = await memoryStore();
  const initialService = serviceFor(initialStore);
  let project = (await initialStore.get(PROJECT_ID))!;
  const first = findWorkItem(project, "verify-current-mechanical-design");
  const decisionId = first.decisionIds[0]!;
  project = await propose(
    initialService,
    initialStore,
    decisionId,
    project.revision,
    1,
  );

  const invalid = structuredClone(project) as Mutable<EngineeringProjectSnapshot>;
  const invalidFirst = invalid.workItems.find((item) => item.id === first.id)!;
  const blocker = invalid.blockers.find((item) =>
    item.id === invalidFirst.blockerIds[0]
  )!;
  const second = {
    ...structuredClone(invalidFirst),
    id: "verify-current-mechanical-design-second",
    status: "planned" as const,
    decisionIds: [] as string[],
    blockerIds: [blocker.id],
  };
  invalid.workItems.push(second);
  invalid.phases.find((phase) => phase.id === invalidFirst.phaseId)!.workItemIds.push(
    second.id,
  );
  blocker.workItemIds.push(second.id);

  const store = new MemoryRevisionStore(invalid);
  const service = serviceFor(store);
  const decision = findDecision(invalid, decisionId);
  await assertRejects(
    () =>
      service.approveDecision(HUMAN, {
        ...context("reject-shared-blocker-release", invalid.revision),
        decisionId,
        rationale: "One approval must release only one exact work item.",
        inputFingerprint: decision.inputFingerprint!,
      }),
    EngineeringProjectValidationError,
  );

  const persisted = (await store.get(PROJECT_ID))!;
  assertEquals(findWorkItem(persisted, invalidFirst.id).status, "waiting-for-decision");
  assertEquals(findWorkItem(persisted, second.id).status, "planned");
});

Deno.test("browser cannot claim and a second agent cannot hijack a claimed run", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const project = await approveAll(service, store);
  const queued = await service.queueRun(
    AGENT,
    queueRunCommand("queue-verification", project, {
      runId: "verify-run-1",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue reviewed verification inputs.",
    }),
  );

  assertEquals(queued.agentRuns[0].status, "queued");
  assertEquals(
    findWorkItem(queued, "verify-current-mechanical-design").status,
    "in-progress",
  );
  await assertCommandError(
    () =>
      service.claimRun(HUMAN, {
        ...context("browser-fake-start", queued.revision),
        runId: "verify-run-1",
        summary: "Pretend to start.",
      }),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.publishRun(AGENT, {
        ...context("publish-before-start", queued.revision),
        runId: "verify-run-1",
        summary: "Publish too early.",
      }),
    "invalid_transition",
  );
  await assertCommandError(
    () =>
      service.queueRun(
        AGENT,
        queueRunCommand("agent-self-queue", queued, {
          runId: "verify-run-2",
          workItemId: "verify-current-mechanical-design",
          summary: "A second run cannot duplicate active work.",
        }),
      ),
    "invalid_transition",
  );
  const claimed = await service.claimRun(AGENT, {
    ...context("agent-claims-run", queued.revision),
    runId: "verify-run-1",
    summary: "Assigned worker claimed the run.",
  });
  await assertCommandError(
    () =>
      service.progressRun(OTHER_AGENT, {
        ...context("other-agent-progress", claimed.revision),
        runId: "verify-run-1",
        summary: "A different worker attempts to take over.",
      }),
    "permission_denied",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, claimed.revision);
  const progressed = await service.progressRun(AGENT, {
    ...context("owner-agent-progress", claimed.revision),
    runId: "verify-run-1",
    summary: "Assigned worker reports progress.",
  });
  assertEquals(progressed.agentRuns[0].status, "running");
  assertEquals(
    progressed.agentRuns[0].statusHistory?.at(-1)?.summary,
    "Assigned worker reports progress.",
  );
});

Deno.test("a bound queue receipt seals the initial queued transition actor and timestamp", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const approved = await approveAll(service, store);
  const queued = await service.queueRun(
    AGENT,
    queueRunCommand("queue-receipt-transition-seal", approved, {
      runId: "verify-run-queue-receipt-transition-seal",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue reviewed verification inputs for receipt sealing.",
    }),
  );

  const forgedActor = structuredClone(queued) as Mutable<
    EngineeringProjectSnapshot
  >;
  forgedActor.commandReceipts!.find((receipt) => receipt.type === "agent-run.queue")!
    .actor = { id: "agent-forger", origin: "agent" };
  assertThrows(
    () => validateEngineeringProjectSnapshot(forgedActor),
    EngineeringProjectValidationError,
    "must identify exactly one run and its initial queued transition",
  );

  const forgedTimestamp = structuredClone(queued) as Mutable<
    EngineeringProjectSnapshot
  >;
  forgedTimestamp.commandReceipts!.find((receipt) =>
    receipt.type === "agent-run.queue"
  )!.appliedAt = "2026-08-01T11:00:02.000Z";
  assertThrows(
    () => validateEngineeringProjectSnapshot(forgedTimestamp),
    EngineeringProjectValidationError,
    "must identify exactly one run and its initial queued transition",
  );
});

Deno.test("only a human can append-only cancel an unclaimed queued run", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const approved = await approveAll(service, store);
  const queued = await service.queueRun(
    AGENT,
    queueRunCommand("queue-cancellable-verification", approved, {
      runId: "verify-run-cancellable",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue reviewed verification inputs.",
    }),
  );
  const command = {
    ...context("human-cancel-queued-verification", queued.revision),
    runId: "verify-run-cancellable",
    rationale:
      "This queued run is superseded before any agent claim or provider execution.",
  };
  const queueReceipt = queued.commandReceipts?.at(-1);
  assertEquals(queueReceipt?.type, "agent-run.queue");
  assertEquals(queueReceipt?.queuedRun, {
    runId: "verify-run-cancellable",
    workItemId: "verify-current-mechanical-design",
  });
  assertEquals(queueReceipt?.cancelledRun, undefined);

  await assertCommandError(
    () => service.cancelQueuedRun(AGENT, command),
    "permission_denied",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, queued.revision);

  await assertCommandError(
    () =>
      service.queueRun(AGENT, {
        ...queueRunCommand("queue-caller-supplied-binding", queued, {
          runId: "verify-run-caller-supplied-binding",
          workItemId: "verify-current-mechanical-design",
          summary: "Queue a forged server-owned target.",
        }),
        queuedRun: {
          runId: "forged-run-id",
          workItemId: "forged-work-item-id",
        },
      } as unknown as QueueRunCommand),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, queued.revision);

  await assertCommandError(
    () =>
      service.cancelQueuedRun(HUMAN, {
        ...command,
        commandId: "cancel-caller-supplied-binding",
        cancelledRun: {
          runId: "forged-run-id",
          workItemId: "forged-work-item-id",
          queuedCommandId: "forged-queue-command-id",
        },
      } as unknown as CancelQueuedRunCommand),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, queued.revision);

  const cancelled = await service.cancelQueuedRun(HUMAN, command);
  const run = cancelled.agentRuns.find((item) => item.id === command.runId)!;
  assertEquals(run.status, "cancelled");
  assertEquals(run.startedAt, undefined);
  assertEquals(run.completedAt, undefined);
  assertEquals(run.claimedAt, undefined);
  assertEquals(run.claimedBy, undefined);
  assertEquals(run.failure, undefined);
  assertEquals(run.evidenceRefs, []);
  assertEquals(run.cancellation?.rationale, command.rationale);
  assert(run.cancellation?.cancelledAt);
  assertEquals(run.cancellation?.cancelledBy, {
    id: HUMAN.actorId,
    origin: "human",
  });
  assertEquals(run.statusHistory?.map((item) => item.status), [
    "queued",
    "cancelled",
  ]);
  assertEquals(run.statusHistory?.at(-1), {
    commandId: command.commandId,
    status: "cancelled",
    at: run.cancellation!.cancelledAt,
    actor: { id: HUMAN.actorId, origin: "human" },
    summary: `Cancelled before agent claim: ${command.rationale}`,
  });
  assertEquals(
    findWorkItem(cancelled, "verify-current-mechanical-design").status,
    "ready",
  );
  assertEquals(cancelled.commandReceipts?.at(-1)?.type, "agent-run.cancel");
  assertEquals(cancelled.commandReceipts?.at(-1)?.cancelledRun, {
    runId: command.runId,
    workItemId: "verify-current-mechanical-design",
    queuedCommandId: queued.agentRuns.find((item) => item.id === command.runId)!
      .statusHistory![0]!.commandId,
  });

  const receiptReusedByAnotherRun = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  const cancelledRun = receiptReusedByAnotherRun.agentRuns.find((item) =>
    item.id === command.runId
  )!;
  receiptReusedByAnotherRun.agentRuns.push({
    ...structuredClone(cancelledRun),
    id: "verify-run-cancellable-receipt-clone",
    workItemId: "build-current-cad",
  });
  assertThrows(
    () => validateEngineeringProjectSnapshot(receiptReusedByAnotherRun),
    EngineeringProjectValidationError,
    "already bound to agent run",
  );

  const forgedQueueCommand = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  forgedQueueCommand.agentRuns.find((item) => item.id === command.runId)!
    .statusHistory![0]!.commandId = "forged-queue-command-without-receipt";
  assertThrows(
    () => validateEngineeringProjectSnapshot(forgedQueueCommand),
    EngineeringProjectValidationError,
    "agent-run.queue receipt",
  );

  const tamperedQueuedReceiptBinding = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  tamperedQueuedReceiptBinding.commandReceipts!.find((receipt) =>
    receipt.type === "agent-run.queue"
  )!.queuedRun!.workItemId = "build-current-cad";
  assertThrows(
    () => validateEngineeringProjectSnapshot(tamperedQueuedReceiptBinding),
    EngineeringProjectValidationError,
  );

  const tamperedCancelledRunId = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  tamperedCancelledRunId.agentRuns.find((item) => item.id === command.runId)!
    .id = "forged-cancelled-run-id";
  assertThrows(
    () => validateEngineeringProjectSnapshot(tamperedCancelledRunId),
    EngineeringProjectValidationError,
  );

  const tamperedCancelledWorkItem = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  tamperedCancelledWorkItem.agentRuns.find((item) => item.id === command.runId)!
    .workItemId = "build-current-cad";
  assertThrows(
    () => validateEngineeringProjectSnapshot(tamperedCancelledWorkItem),
    EngineeringProjectValidationError,
  );

  const forgedCancellationSummary = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  forgedCancellationSummary.agentRuns.find((item) => item.id === command.runId)!
    .summary = "Retired by a forged summary.";
  assertThrows(
    () => validateEngineeringProjectSnapshot(forgedCancellationSummary),
    EngineeringProjectValidationError,
    "server-derived queued-run cancellation summary",
  );

  const forgedCancellationTransitionSummary = structuredClone(cancelled) as Mutable<
    EngineeringProjectSnapshot
  >;
  forgedCancellationTransitionSummary.agentRuns.find((item) =>
    item.id === command.runId
  )!.statusHistory![1]!.summary = "Forged cancellation transition summary.";
  assertThrows(
    () => validateEngineeringProjectSnapshot(forgedCancellationTransitionSummary),
    EngineeringProjectValidationError,
    "server-derived queued-run cancellation summary",
  );

  const replay = await service.cancelQueuedRun(HUMAN, command);
  assertEquals(replay.id, cancelled.id);

  await assertCommandError(
    () =>
      service.cancelQueuedRun(HUMAN, {
        ...command,
        commandId: "cancel-terminal-run",
        expectedRevision: cancelled.revision,
      }),
    "invalid_transition",
  );
  await assertCommandError(
    () =>
      service.cancelQueuedRun(HUMAN, {
        ...command,
        commandId: "cancel-without-rationale",
        expectedRevision: cancelled.revision,
        rationale: " ",
      }),
    "invalid_input",
  );

  const retried = await service.queueRun(
    AGENT,
    queueRunCommand("queue-cancellable-retry-for-binding-swap", cancelled, {
      runId: "verify-run-cancellable-retry",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue the replacement verified work after cancellation.",
    }),
  );
  const swappedQueuedReceiptBindings = structuredClone(retried) as Mutable<
    EngineeringProjectSnapshot
  >;
  const queueReceipts = swappedQueuedReceiptBindings.commandReceipts!.filter(
    (receipt) => receipt.type === "agent-run.queue",
  );
  const originalBinding = structuredClone(queueReceipts[0]!.queuedRun)!;
  queueReceipts[0]!.queuedRun = structuredClone(queueReceipts[1]!.queuedRun)!;
  queueReceipts[1]!.queuedRun = originalBinding;
  assertThrows(
    () => validateEngineeringProjectSnapshot(swappedQueuedReceiptBindings),
    EngineeringProjectValidationError,
  );
});

Deno.test("a cancelled queued run remains valid history after a completed retry", async () => {
  const store = await memoryStore();
  const validator = new RecordingEvidenceValidator();
  const service = serviceFor(store, validator);
  let project = await approveAll(service, store);
  project = await service.queueRun(
    AGENT,
    queueRunCommand("queue-before-human-cancellation", project, {
      runId: "verify-run-cancelled-before-start",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue the reviewed verification inputs.",
    }),
  );
  project = await service.cancelQueuedRun(HUMAN, {
    ...context("human-cancel-before-retry", project.revision),
    runId: "verify-run-cancelled-before-start",
    rationale: "The queue entry was retired before a worker claimed it.",
  });

  project = await service.queueRun(
    AGENT,
    queueRunCommand("queue-verification-retry", project, {
      runId: "verify-run-retry-after-cancellation",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue the replacement reviewed verification inputs.",
    }),
  );
  project = await service.claimRun(AGENT, {
    ...context("claim-verification-retry", project.revision),
    runId: "verify-run-retry-after-cancellation",
    summary: "Worker claimed the replacement verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-verification-retry", project.revision),
    runId: "verify-run-retry-after-cancellation",
    summary: "Publishing replacement verified outputs.",
  });
  project = await service.completeRun(AGENT, {
    ...completionCommand(project),
    commandId: "complete-verification-retry",
    runId: "verify-run-retry-after-cancellation",
    summary: "Replacement verification evidence published.",
  });

  assertEquals(
    project.agentRuns.find((run) => run.id === "verify-run-cancelled-before-start")
      ?.status,
    "cancelled",
  );
  assertEquals(
    project.agentRuns.find((run) => run.id === "verify-run-retry-after-cancellation")
      ?.status,
    "completed",
  );
  assertEquals(
    findWorkItem(project, "verify-current-mechanical-design").status,
    "completed",
  );
  assertEquals(validator.calls, 1);
  validateEngineeringProjectSnapshot(project);
});

Deno.test("agent lifecycle completes only after publishing exact externally validated evidence", async () => {
  const store = await memoryStoreWithVerificationDependent();
  const validator = new RecordingEvidenceValidator();
  const service = serviceFor(store, validator);
  let project = await approveAll(service, store);
  project = await service.queueRun(
    HUMAN,
    queueRunCommand("queue-exact-run", project, {
      runId: "verify-run-exact",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue exact verification.",
    }),
  );
  project = await service.claimRun(AGENT, {
    ...context("claim-exact-run", project.revision),
    runId: "verify-run-exact",
    summary: "Worker claimed verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-exact-run", project.revision),
    runId: "verify-run-exact",
    summary: "Publishing verified outputs.",
  });
  const completion = completionCommand(project);
  project = await service.completeRun(AGENT, completion);

  const run = project.agentRuns.find((item) => item.id === "verify-run-exact")!;
  assertEquals(run.status, "completed");
  assertEquals(run.resultSnapshot, completion.resultSnapshot);
  assertEquals(run.statusHistory?.map((item) => item.status), [
    "queued",
    "running",
    "publishing",
    "completed",
  ]);
  assertEquals(validator.calls, 1);
  assertEquals(validator.lastBase, baseSnapshot(project));
  assertEquals(validator.lastResult, completion.resultSnapshot);
  assertEquals(
    project.threadSnapshots.some((item) =>
      item.snapshotId === completion.resultSnapshot.snapshotId &&
      item.revision === completion.resultSnapshot.revision
    ),
    true,
  );
  assertEquals(findWorkItem(project, "observe-erp-definition").status, "ready");
});

Deno.test("completion fails closed without exact evidence validation", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  let project = await approveAll(service, store);
  project = await service.queueRun(
    HUMAN,
    queueRunCommand("queue-no-validator", project, {
      runId: "verify-run-exact",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue exact verification.",
    }),
  );
  project = await service.claimRun(AGENT, {
    ...context("claim-no-validator", project.revision),
    runId: "verify-run-exact",
    summary: "Worker claimed verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-no-validator", project.revision),
    runId: "verify-run-exact",
    summary: "Publishing outputs.",
  });

  await assertCommandError(
    () => service.completeRun(AGENT, completionCommand(project)),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
});

Deno.test("completion refuses a result that does not advance the exact run base", async () => {
  const store = await memoryStore();
  const validator = new RecordingEvidenceValidator();
  const service = serviceFor(store, validator);
  let project = await approveAll(service, store);
  project = await service.queueRun(
    HUMAN,
    queueRunCommand("queue-non-advancing", project, {
      runId: "verify-run-exact",
      workItemId: "verify-current-mechanical-design",
      summary: "Queue exact verification.",
    }),
  );
  project = await service.claimRun(AGENT, {
    ...context("claim-non-advancing", project.revision),
    runId: "verify-run-exact",
    summary: "Worker claimed verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-non-advancing", project.revision),
    runId: "verify-run-exact",
    summary: "Publishing outputs.",
  });
  const runBasis = project.agentRuns.find((run) => run.id === "verify-run-exact")!
    .basis;
  if (!runBasis || runBasis.kind !== "thread-snapshot") {
    throw new Error("queued run lost its thread-snapshot basis");
  }
  const runBase = runBasis;
  const completion = completionCommand(project);

  await assertCommandError(
    () =>
      service.completeRun(AGENT, {
        ...completion,
        resultSnapshot: {
          ...completion.resultSnapshot,
          snapshotId: runBase.snapshotId,
          revision: runBase.revision + 1,
        },
      }),
    "invalid_input",
  );
  await assertCommandError(
    () =>
      service.completeRun(AGENT, {
        ...completion,
        resultSnapshot: {
          ...completion.resultSnapshot,
          revision: runBase.revision,
        },
      }),
    "invalid_input",
  );
  assertEquals(validator.calls, 0);
  assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
});

const PROJECT_ID = "generic-test-system";

async function memoryStore(): Promise<MemoryRevisionStore> {
  return new MemoryRevisionStore(await projectFixture());
}

async function memoryStoreWithVerificationDependent(): Promise<MemoryRevisionStore> {
  const project = structuredClone(await projectFixture()) as Mutable<
    EngineeringProjectSnapshot
  >;
  const dependent = project.workItems.find((item) =>
    item.id === "observe-erp-definition"
  )!;
  dependent.status = "planned";
  dependent.dependsOnWorkItemIds = ["verify-current-mechanical-design"];
  dependent.evidenceRefs = [];
  return new MemoryRevisionStore(validateEngineeringProjectSnapshot(project));
}

function serviceFor(
  store: EngineeringProjectRevisionStore,
  validator?: EngineeringProjectCompletionEvidenceValidator,
  reconciliationOperationPolicy?: EngineeringProjectReconciliationOperationPolicy,
  firstAppliedAt = "2026-08-01T11:00:00.000Z",
  uncertainWriterLifecycle?: UncertainWriterLifecycleQualifier,
) {
  let tick = 0;
  return new EngineeringProjectCommandService(
    store,
    validator,
    () => new Date(Date.parse(firstAppliedAt) + ++tick * 1_000).toISOString(),
    lifecyclePlanning(),
    undefined,
    {
      validate(successorRunSnapshot, successorSnapshot) {
        if (
          successorSnapshot.subjectId !== successorRunSnapshot.subjectId ||
          successorSnapshot.revision !== successorRunSnapshot.revision + 1
        ) {
          return Promise.reject(new Error("invalid synthetic closeout snapshot"));
        }
        return Promise.resolve();
      },
      validateCurrentHeadDescendsFrom(currentHead, ancestor) {
        if (
          currentHead.subjectId !== ancestor.subjectId ||
          currentHead.revision < ancestor.revision
        ) {
          return Promise.reject(new Error("invalid synthetic direct lineage"));
        }
        return Promise.resolve();
      },
    },
    reconciliationOperationPolicy,
    uncertainWriterLifecycle,
  );
}

async function kinematicsGenericReconciliationProject(): Promise<
  EngineeringProjectSnapshot
> {
  return await reconcileAnnotationProject({
    failureCode: "prescribed-kinematics-execution-failed",
    outcome: "write-effect-accepted",
    legacyDecisionFingerprint: false,
  });
}

async function projectFixture(): Promise<EngineeringProjectSnapshot> {
  const project = JSON.parse(await Deno.readTextFile(CONFIG)) as Mutable<
    EngineeringProjectSnapshot
  >;
  const verify = project.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  );
  if (verify && verify.operation === undefined) {
    verify.operation = {
      id: "verify.lifecycle-fixture",
      version: "1",
      bindings: [],
    };
  }
  return validateEngineeringProjectSnapshot(project);
}

async function reconciliableProject(): Promise<EngineeringProjectSnapshot> {
  const project = structuredClone(await projectFixture()) as Mutable<
    EngineeringProjectSnapshot
  >;
  const verification = project.phases.find((phase) => phase.id === "verification")!;
  const failedWork = project.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  )!;
  const successorEvidence = structuredClone(
    project.workItems.find((item) => item.id === "build-current-cad")!
      .evidenceRefs,
  );
  const successor = {
    id: "verify-current-mechanical-design-r3",
    activityId: failedWork.activityId,
    predecessorRevisionId: failedWork.id,
    phaseId: verification.id,
    title: "Verify the current mechanical design through R3",
    description:
      "Retain the completed successor evidence without rewriting the failed R2 work item.",
    kind: "verify" as const,
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: successorEvidence,
    decisionIds: [],
    blockerIds: [],
    ...(failedWork.operation
      ? { operation: structuredClone(failedWork.operation) }
      : {}),
  };
  failedWork.status = "ready";
  failedWork.decisionIds = [];
  failedWork.blockerIds = [];
  failedWork.evidenceRefs = [];
  verification.requiredDecisionIds = [];
  verification.workItemIds = [failedWork.id, successor.id];
  verification.evidenceRefs = structuredClone(successorEvidence);
  project.workItems.push(successor);
  project.decisions = [];
  project.approvals = [];
  project.blockers = [];
  const snapshot = project.threadSnapshots[0]!;
  project.agentRuns = [
    {
      id: "run:mechanical-r2-failed",
      workItemId: failedWork.id,
      status: "failed",
      summary: "R2 stopped before durable project evidence was published.",
      queuedAt: "2026-08-01T10:00:00.000Z",
      startedAt: "2026-08-01T10:00:01.000Z",
      completedAt: "2026-08-01T10:00:02.000Z",
      claimedAt: "2026-08-01T10:00:01.000Z",
      claimedBy: { id: AGENT.actorId, origin: AGENT.kind },
      basis: { kind: "thread-snapshot" as const, ...snapshot },
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      evidenceRefs: [],
      failure: {
        code: "mechanical-not-published",
        message: "No durable evidence was published.",
      },
    },
    {
      id: "run:mechanical-r3-completed",
      workItemId: successor.id,
      status: "completed",
      summary: "R3 published the replacement mechanical evidence.",
      queuedAt: "2026-08-01T10:00:03.000Z",
      startedAt: "2026-08-01T10:00:04.000Z",
      completedAt: "2026-08-01T10:00:05.000Z",
      claimedAt: "2026-08-01T10:00:04.000Z",
      claimedBy: { id: AGENT.actorId, origin: AGENT.kind },
      basis: { kind: "thread-snapshot" as const, ...snapshot },
      inputFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      resultSnapshot: snapshot,
      evidenceRefs: successorEvidence,
    },
  ];
  return validateEngineeringProjectSnapshot(project);
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-01T10:59:00.000Z",
  };
}

function lifecyclePlanning(): EngineeringProjectPlanningDependencies {
  return {
    operations: {
      validate(input) {
        return {
          operation: {
            id: input.operation.id,
            version: input.operation.version,
            startingPoint: "existing-product",
            title: "Lifecycle fixture operation",
            description:
              "Test-only trusted @1 operation so command-service lifecycle tests can queue schema 4.0 runs.",
            workItemKind: "verify",
            execution: "trusted",
          },
          bindings: input.operation.bindings,
        };
      },
    },
  };
}

function threadSnapshotBasis(project: EngineeringProjectSnapshot) {
  return { kind: "thread-snapshot" as const, ...baseSnapshot(project) };
}

function queueRunCommand(
  commandId: string,
  project: EngineeringProjectSnapshot,
  fields: {
    readonly runId: string;
    readonly workItemId: string;
    readonly summary: string;
  },
): QueueRunCommand {
  return {
    ...context(commandId, project.revision),
    ...fields,
    basis: threadSnapshotBasis(project),
  };
}

function proposal(value: string) {
  return {
    summary: "Test-only reviewed input.",
    parameters: [{ key: "choice", label: "Choice", value }],
  };
}

async function propose(
  service: EngineeringProjectCommandService,
  store: EngineeringProjectRevisionStore,
  decisionId: string,
  expectedRevision: number,
  sequence: number,
) {
  return await service.proposeDecision(HUMAN, {
    ...context(`propose-${decisionId}-${sequence}`, expectedRevision),
    decisionId,
    proposal: proposal(`fixture-${sequence}`),
    baseSnapshot: baseSnapshot((await store.get(PROJECT_ID))!),
  });
}

async function approveAll(
  service: EngineeringProjectCommandService,
  store: EngineeringProjectRevisionStore,
): Promise<EngineeringProjectSnapshot> {
  let project = (await store.get(PROJECT_ID))!;
  const decisionIds = findWorkItem(project, "verify-current-mechanical-design")
    .decisionIds;
  for (const [index, decisionId] of decisionIds.entries()) {
    project = await propose(service, store, decisionId, project.revision, index);
    const decision = findDecision(project, decisionId);
    project = await service.approveDecision(HUMAN, {
      ...context(`approve-all-${decisionId}`, project.revision),
      decisionId,
      rationale: "Reviewed for lifecycle test.",
      inputFingerprint: decision.inputFingerprint!,
    });
  }
  return project;
}

function completionCommand(project: EngineeringProjectSnapshot): CompleteRunCommand {
  const resultSnapshot = {
    snapshotId: "generic-test-system:r6:verified-result",
    revision: 6,
    subjectId: PROJECT_ID,
  };
  return {
    ...context("complete-exact-run", project.revision),
    runId: "verify-run-exact",
    summary: "Exact verification evidence published.",
    resultSnapshot,
    evidenceRefs: [{
      snapshotId: resultSnapshot.snapshotId,
      snapshotRevision: resultSnapshot.revision,
      kind: "artifact",
      id: "calculix-result-exact",
    }],
  };
}

function baseSnapshot(project: EngineeringProjectSnapshot | undefined) {
  return structuredClone(project!.threadSnapshots[0]);
}

function findDecision(project: EngineeringProjectSnapshot, id: string) {
  return project.decisions.find((item) => item.id === id)!;
}

function findWorkItem(project: EngineeringProjectSnapshot, id: string) {
  return project.workItems.find((item) => item.id === id)!;
}

async function assertCommandError(
  operation: () => Promise<unknown>,
  code: EngineeringProjectCommandError["code"],
): Promise<void> {
  const error = await assertRejects(operation, EngineeringProjectCommandError);
  assertEquals(error.code, code);
}

class RecordingEvidenceValidator
  implements EngineeringProjectCompletionEvidenceValidator {
  calls = 0;
  lastBase?: EngineeringThreadSnapshotRef;
  lastResult?: EngineeringThreadSnapshotRef;

  validate(
    base: EngineeringThreadSnapshotRef,
    result: EngineeringThreadSnapshotRef,
  ): Promise<void> {
    this.calls++;
    this.lastBase = structuredClone(base);
    this.lastResult = structuredClone(result);
    return Promise.resolve();
  }
}

class MemoryRevisionStore implements EngineeringProjectRevisionStore {
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
    this.#revisions.set(1, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = Math.max(...this.#revisions.keys());
    if (current !== expectedRevision || this.#revisions.has(snapshot.revision)) {
      throw new EngineeringProjectStoreConflictError("concurrent commit");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}

Deno.test(
  "direct reconciliation rejects a successor run executed outside the project thread lineage",
  async () => {
    const base = structuredClone(
      await reconciliableProjectWithOperation(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const successorRun = base.agentRuns.find((run) =>
      run.id === "run:mechanical-r3-completed"
    )!;
    // A foreign execution base cannot survive validateEngineeringProjectSnapshot
    // (the global invariant checks every run basis against threadSnapshots), so
    // the snapshot is stored unvalidated on purpose: this exercises the service's
    // own defense-in-depth lineage guard, not the upstream validator.
    const successorBasis = successorRun.basis;
    if (!successorBasis || successorBasis.kind !== "thread-snapshot") {
      throw new Error("fixture lost its thread-snapshot basis");
    }
    (successorRun as Mutable<typeof successorRun>).basis = {
      ...successorBasis,
      snapshotId: "thread-foreign-project-head",
    };
    const store = new MemoryRevisionStore(base as EngineeringProjectSnapshot);
    const service = serviceFor(store);
    const evidence =
      base.workItems.find((item) => item.id === "verify-current-mechanical-design-r3")!
        .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-foreign-lineage", base.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: base.threadSnapshots.at(-1)!,
          successorEvidenceRefs: evidence,
          rationale:
            "Should be rejected: successor executed outside the project lineage.",
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "the full closeout form rejects a different operation without an injected policy",
  async () => {
    const base = structuredClone(
      await reconciliableProjectWithOperation(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    (successorWork as Mutable<typeof successorWork>).operation = {
      id: "repair.mechanical-identity",
      version: "1",
      bindings: [{ name: "project", source: { kind: "approved-brief" as const } }],
    };
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    await assertCommandError(
      () =>
        service.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-unproved-operation-transition", project.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: project.threadSnapshots.at(-1)!,
          successorSnapshot: {
            snapshotId: "generic-test-system:r6:reconciliation-closeout",
            revision: 6,
            subjectId: PROJECT_ID,
          },
          successorEvidenceRefs: evidence,
          rationale: "A closeout snapshot alone does not authorize another operation.",
        }),
      "invalid_input",
    );
  },
);

Deno.test(
  "the full closeout form executes a different operation only through its injected policy",
  async () => {
    const base = structuredClone(
      await reconciliableProjectWithOperation(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const failedWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design"
    )!;
    const successorWork = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design-r3"
    )!;
    (failedWork as Mutable<typeof failedWork>).operation = {
      id: "verify.reviewed-system",
      version: "2",
      bindings: [{ name: "project", source: { kind: "approved-brief" as const } }],
    };
    (successorWork as Mutable<typeof successorWork>).operation = {
      id: "repair.reviewed-system-identity",
      version: "1",
      bindings: [{ name: "project", source: { kind: "approved-brief" as const } }],
    };
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    let authorizations = 0;
    const policy: EngineeringProjectReconciliationOperationPolicy = {
      authorize(input) {
        assertEquals(input.failedOperation.id, "verify.reviewed-system");
        assertEquals(input.failedOperation.version, "2");
        assertEquals(input.successorOperation?.id, "repair.reviewed-system-identity");
        assertEquals(input.successorOperation?.version, "1");
        assertEquals(input.successorSnapshot.revision, 6);
        authorizations++;
        return Promise.resolve();
      },
    };
    const service = serviceFor(store, undefined, policy);
    const evidence = findWorkItem(project, "verify-current-mechanical-design-r3")
      .evidenceRefs;

    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, {
      ...context("accept-proved-operation-transition", project.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:mechanical-r2-failed",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot: project.threadSnapshots.at(-1)!,
      successorSnapshot: {
        snapshotId: "generic-test-system:r6:reconciliation-closeout",
        revision: 6,
        subjectId: PROJECT_ID,
      },
      successorEvidenceRefs: evidence,
      rationale: "The injected code-owned policy proves this exact repair transition.",
    });

    assertEquals(authorizations, 1);
    assertEquals(
      findWorkItem(reconciled, "verify-current-mechanical-design").status,
      "cancelled",
    );
  },
);

// ---------------------------------------------------------------------------
// reconcileAnnotationRun — blocker cross-reference and eligibility invariants
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid V1 project with one failed run (eligible failure code)
 * and one queued reconciliation run, ready for uncertain-writer reconciliation.
 * Uses the generic V1 project as a base to avoid duplicating the full
 * snapshot structure, then splices in the two runs needed for these tests.
 */
async function reconcileAnnotationProject(
  {
    failureCode,
    outcome = "write-effect-accepted",
    legacyDecisionFingerprint = true,
  }: {
    readonly failureCode?: string;
    readonly outcome?: "provider-did-not-write" | "write-effect-accepted";
    readonly legacyDecisionFingerprint?: boolean;
  } = {},
): Promise<EngineeringProjectSnapshot> {
  const base = structuredClone(await projectFixture()) as Mutable<
    EngineeringProjectSnapshot
  >;

  // Use the verification phase; clear the existing open blocker so the failed
  // work item can start with empty blockerIds.
  const verifyItem = base.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  )!;
  verifyItem.status = "ready";
  verifyItem.blockerIds = [];
  verifyItem.decisionIds = [];
  verifyItem.evidenceRefs = [];
  base.blockers = [];
  const verifyPhase = base.phases.find((p) => p.id === "verification")!;
  const head = base.threadSnapshots.at(-1)!;
  const basis = { kind: "thread-snapshot" as const, ...head };
  const eligibleCode = failureCode ??
    "model-write-architecture-provider-outcome-unknown";
  const decisionId = "decision-mrtr-1";
  const attestation = uncertainWriterAttestation(outcome);
  const proposal = {
    summary: "Record the exact inspected provider outcome.",
    proposedAt: "2026-08-01T10:00:03.000Z",
    proposedBy: { id: AGENT.actorId, origin: "agent" as const },
    parameters: [
      {
        key: "reconcileAction",
        label: "Action",
        value: "resolve-uncertain-writer",
      },
      {
        key: "reconcileOperation",
        label: "Operation",
        value: "record.reconcile-uncertain-writer@1",
      },
      {
        key: "reconcileRunId",
        label: "Failed run",
        value: "run:uncertain-write-failed",
      },
      {
        key: "reconcileFailureCode",
        label: "Failure code",
        value: eligibleCode,
      },
      {
        key: "reconcileBasisSnapshotId",
        label: "Basis snapshot",
        value: basis.snapshotId,
      },
      {
        key: "reconcileOutcome",
        label: "Outcome",
        value: outcome,
      },
      {
        key: "reconcileAttestation",
        label: "Inspection attestation",
        value: attestation,
      },
    ],
  };
  const inputFingerprint = await sha256Fingerprint(
    legacyDecisionFingerprint
      ? {
        basis: { kind: "thread-snapshot", ...head },
        inputEvidenceRefs: [],
        proposal: { summary: proposal.summary, parameters: proposal.parameters },
      }
      : {
        baseSnapshot: head,
        inputEvidenceRefs: [],
        proposal: { summary: proposal.summary, parameters: proposal.parameters },
      },
  );
  base.decisions = [{
    id: decisionId,
    phaseId: "verification",
    title: "Reconcile uncertain writer",
    question: "What exact effect did the provider persist?",
    status: "approved",
    requestedAt: "2026-08-01T10:00:03.000Z",
    proposal,
    baseSnapshot: head,
    inputFingerprint,
    inputEvidenceRefs: [],
    approvalIds: ["approval-mrtr-1"],
  }];
  base.approvals = [{
    id: "approval-mrtr-1",
    decisionId,
    status: "approved",
    requestedAt: "2026-08-01T10:00:03.000Z",
    decidedAt: "2026-08-01T10:00:04.000Z",
    decidedBy: "reviewer-1",
    decidedByOrigin: "human",
    rationale: "Provider history inspected.",
    baseSnapshot: head,
    inputFingerprint,
    inputEvidenceRefs: [],
  }];
  verifyPhase.requiredDecisionIds = [decisionId];

  // Add a human-owned reconciliation work item to the same phase.
  const reconcileItem = {
    id: "reconcile-uncertain-writer",
    activityId: "activity:reconcile-uncertain-writer",
    phaseId: "verification",
    title: "Reconcile the uncertain writer outcome",
    description:
      "Human review of the provider to determine whether the write took effect.",
    kind: "review" as const,
    status: "ready" as const,
    owner: "human" as const,
    operation: {
      id: "record.reconcile-uncertain-writer",
      version: "1",
      bindings: [],
    },
    dependsOnWorkItemIds: [] as string[],
    evidenceRefs: [] as typeof verifyItem.evidenceRefs,
    decisionIds: [decisionId],
    blockerIds: [] as string[],
  };
  verifyPhase.workItemIds = [...verifyPhase.workItemIds, reconcileItem.id];
  base.workItems.push(reconcileItem);

  // Wire up the two agent runs.
  base.agentRuns = [
    {
      id: "run:uncertain-write-failed",
      workItemId: verifyItem.id,
      status: "failed",
      summary:
        "Provider acknowledged the write but the executor crashed before capture.",
      queuedAt: "2026-08-01T10:00:00.000Z",
      startedAt: "2026-08-01T10:00:01.000Z",
      completedAt: "2026-08-01T10:00:02.000Z",
      claimedAt: "2026-08-01T10:00:01.000Z",
      claimedBy: { id: AGENT.actorId, origin: AGENT.kind },
      basis: { kind: "thread-snapshot", ...head },
      inputFingerprint,
      evidenceRefs: [],
      failure: {
        code: eligibleCode,
        message:
          "Provider acknowledged but executor crashed before ThreadSnapshot write.",
      },
    },
    {
      id: "run:reconcile-annotation",
      workItemId: reconcileItem.id,
      status: "queued",
      summary: "Pending human reconciliation.",
      queuedAt: "2026-08-01T10:00:03.000Z",
      basis: { kind: "thread-snapshot", ...head },
      inputFingerprint,
      evidenceRefs: [],
    },
  ];

  return validateEngineeringProjectSnapshot(base);
}

function uncertainWriterAttestation(
  outcome: "provider-did-not-write" | "write-effect-accepted",
): string {
  return outcome === "provider-did-not-write"
    ? "Inspected the SysON history: no durable provider write was found."
    : "Inspected the SysON history: the provider write was found and accepted.";
}

async function reconciledUncertainWriterProjectWithCompletedSuccessor(): Promise<
  EngineeringProjectSnapshot
> {
  const project = await reconcileAnnotationProject({
    outcome: "provider-did-not-write",
    legacyDecisionFingerprint: false,
  });
  const store = new MemoryRevisionStore(project);
  const service = serviceFor(store);
  const reconciled = await service.reconcileAnnotationRun(HUMAN, {
    ...context("prepare-exact-reconciled-writer", project.revision),
    reconciliationRunId: "run:reconcile-annotation",
    failedRunId: "run:uncertain-write-failed",
    decisionId: "decision-mrtr-1",
    outcome: "provider-did-not-write",
    providerInspectionAttestation: uncertainWriterAttestation(
      "provider-did-not-write",
    ),
  });
  const draft = structuredClone(reconciled) as Mutable<
    EngineeringProjectSnapshot
  >;
  const failedWork = draft.workItems.find((workItem) =>
    workItem.id === "verify-current-mechanical-design"
  )!;
  const phase = draft.phases.find((candidate) => candidate.id === failedWork.phaseId)!;
  const evidence = structuredClone(
    draft.workItems.find((workItem) => workItem.id === "build-current-cad")!
      .evidenceRefs,
  );
  const snapshot = draft.threadSnapshots.at(-1)!;
  const successorId = "verify-current-mechanical-design-r3";
  draft.workItems.push({
    id: successorId,
    activityId: failedWork.activityId,
    predecessorRevisionId: failedWork.id,
    phaseId: failedWork.phaseId,
    title: "Retry the exact reconciled verification work",
    description:
      "Append-only successor for the uncertain writer's cancelled original work.",
    kind: failedWork.kind,
    operation: structuredClone(failedWork.operation!),
    status: "completed",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: evidence,
    decisionIds: [],
    blockerIds: [],
  });
  phase.workItemIds = [...phase.workItemIds, successorId];
  phase.evidenceRefs = structuredClone(evidence);
  draft.agentRuns.push({
    id: "run:mechanical-r3-completed",
    workItemId: successorId,
    status: "completed",
    summary: "The append-only successor published replacement evidence.",
    queuedAt: "2026-08-01T11:00:02.000Z",
    startedAt: "2026-08-01T11:00:03.000Z",
    claimedAt: "2026-08-01T11:00:03.000Z",
    claimedBy: { id: AGENT.actorId, origin: AGENT.kind },
    completedAt: "2026-08-01T11:00:04.000Z",
    basis: { kind: "thread-snapshot", ...snapshot },
    inputFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    resultSnapshot: structuredClone(snapshot),
    evidenceRefs: evidence,
  });
  return validateEngineeringProjectSnapshot(draft);
}

Deno.test(
  "reconcileAnnotationRun rejects a legacy V1 ceremony without an exact V3 basis",
  async () => {
    const project = await reconcileAnnotationProject();
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);

    const command = {
      ...context("reconcile-write-effect-accepted", project.revision),
      reconciliationRunId: "run:reconcile-annotation",
      failedRunId: "run:uncertain-write-failed",
      decisionId: "decision-mrtr-1",
      outcome: "write-effect-accepted",
      providerInspectionAttestation: uncertainWriterAttestation(
        "write-effect-accepted",
      ),
    } as const;
    await assertCommandError(
      () => service.reconcileAnnotationRun(HUMAN, command),
      "invalid_transition",
    );
    assertEquals((await store.get(project.project.id))?.revision, project.revision);
  },
);

Deno.test(
  "reconcileAnnotationRun rejects a failure code not in ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES",
  async () => {
    // Guard: the domain must enforce eligibility, not only the executor.
    // A direct call with an ineligible code must throw invalid_transition.
    const ineligibleCode = "some-generic-not-uncertain-failure";
    assert(
      !ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES.has(ineligibleCode),
      "test pre-condition: code must not be eligible",
    );

    const project = await reconcileAnnotationProject({
      failureCode: ineligibleCode,
      outcome: "provider-did-not-write",
    });
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);

    await assertCommandError(
      () =>
        service.reconcileAnnotationRun(HUMAN, {
          ...context("reconcile-ineligible-code", project.revision),
          reconciliationRunId: "run:reconcile-annotation",
          failedRunId: "run:uncertain-write-failed",
          decisionId: "decision-mrtr-1",
          outcome: "provider-did-not-write",
          providerInspectionAttestation: uncertainWriterAttestation(
            "provider-did-not-write",
          ),
        }),
      "invalid_transition",
    );
  },
);

Deno.test(
  "reconcileAnnotationRun rejects an unqualified generic prescribed-kinematics failure",
  async () => {
    const project = await kinematicsGenericReconciliationProject();
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);
    await assertCommandError(
      () =>
        service.reconcileAnnotationRun(HUMAN, {
          ...context("reconcile-generic-kinematics", project.revision),
          reconciliationRunId: "run:reconcile-annotation",
          failedRunId: "run:uncertain-write-failed",
          decisionId: "decision-mrtr-1",
          outcome: "write-effect-accepted",
          providerInspectionAttestation: uncertainWriterAttestation(
            "write-effect-accepted",
          ),
        }),
      "invalid_transition",
    );
  },
);

Deno.test(
  "reconciliation of a lifecycle-qualified generic Chrono failure annotates without evidence or rewriting the failure",
  async () => {
    const project = await kinematicsGenericReconciliationProject();
    const store = new MemoryRevisionStore(project);
    const qualifier: UncertainWriterLifecycleQualifier = {
      qualify: (input) =>
        Promise.resolve({
          status: input.failedRunId === "run:uncertain-write-failed"
            ? "qualified-uncertain-write"
            : "not-qualified",
        }),
    };
    const service = serviceFor(
      store,
      undefined,
      undefined,
      "2026-08-01T11:00:00.000Z",
      qualifier,
    );
    const reconciled = await service.reconcileAnnotationRun(HUMAN, {
      ...context("reconcile-qualified-generic-kinematics", project.revision),
      reconciliationRunId: "run:reconcile-annotation",
      failedRunId: "run:uncertain-write-failed",
      decisionId: "decision-mrtr-1",
      outcome: "write-effect-accepted",
      providerInspectionAttestation: uncertainWriterAttestation(
        "write-effect-accepted",
      ),
    });
    const failed = reconciled.agentRuns.find((run) =>
      run.id === "run:uncertain-write-failed"
    )!;
    assertEquals(failed.status, "failed");
    assertEquals(failed.failure?.code, "prescribed-kinematics-execution-failed");
    assertEquals(failed.evidenceRefs, []);
    assertEquals(
      failed.uncertainWriterReconciliation?.outcome,
      "write-effect-accepted",
    );
    assertEquals(
      findWorkItem(reconciled, "reconcile-uncertain-writer").status,
      "completed",
    );
  },
);

Deno.test(
  "reconcileAnnotationRun rejects a homonymous decision on a non-canonical work item without mutation",
  async () => {
    const base = structuredClone(await reconcileAnnotationProject()) as Mutable<
      EngineeringProjectSnapshot
    >;
    const workItem = base.workItems.find((item) =>
      item.id === "reconcile-uncertain-writer"
    )!;
    workItem.operation = {
      id: "model.write-architecture",
      version: "1",
      bindings: [],
    };
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);

    await assertCommandError(
      () =>
        service.reconcileAnnotationRun(HUMAN, {
          ...context("reject-homonymous-reconciliation", project.revision),
          reconciliationRunId: "run:reconcile-annotation",
          failedRunId: "run:uncertain-write-failed",
          decisionId: "decision-mrtr-1",
          outcome: "write-effect-accepted",
          providerInspectionAttestation: uncertainWriterAttestation(
            "write-effect-accepted",
          ),
        }),
      "invalid_transition",
    );
    assertEquals((await store.get(project.project.id))?.revision, project.revision);
  },
);

Deno.test(
  "reconcileAnnotationRun terminally cancels the failed work item for both human outcomes",
  async () => {
    for (
      const outcome of [
        "provider-did-not-write",
        "write-effect-accepted",
      ] as const
    ) {
      const project = await reconcileAnnotationProject({
        outcome,
        legacyDecisionFingerprint: false,
      });
      const store = new MemoryRevisionStore(project);
      const service = serviceFor(store);
      const reconciled = await service.reconcileAnnotationRun(HUMAN, {
        ...context(`reconcile-${outcome}`, project.revision),
        reconciliationRunId: "run:reconcile-annotation",
        failedRunId: "run:uncertain-write-failed",
        decisionId: "decision-mrtr-1",
        outcome,
        providerInspectionAttestation: uncertainWriterAttestation(outcome),
      });

      const failedWork = findWorkItem(
        reconciled,
        "verify-current-mechanical-design",
      );
      const failedRun = reconciled.agentRuns.find((run) =>
        run.id === "run:uncertain-write-failed"
      )!;
      assertEquals(failedWork.status, "cancelled");
      assertEquals(failedRun.status, "failed");
      assertEquals(failedRun.uncertainWriterReconciliation?.outcome, outcome);
      assertEquals(
        findWorkItem(reconciled, "reconcile-uncertain-writer").status,
        "completed",
      );
      assertEquals(
        reconciled.blockers.some((blocker) =>
          blocker.workItemIds.includes(failedWork.id)
        ),
        outcome === "write-effect-accepted",
      );

      await assertCommandError(
        () =>
          service.queueRun(
            AGENT,
            queueRunCommand(`requeue-${outcome}`, reconciled, {
              runId: `run:requeue-${outcome}`,
              workItemId: failedWork.id,
              summary: "The terminal failed work item must not be queued again.",
            }),
          ),
        "invalid_transition",
      );
    }
  },
);

Deno.test(
  "successor reconciliation accepts only a cancelled work item with its exact durable uncertain-writer ceremony",
  async () => {
    const project = await reconciledUncertainWriterProjectWithCompletedSuccessor();
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(
      store,
      undefined,
      undefined,
      "2026-08-01T11:00:04.000Z",
    );
    const successorWork = findWorkItem(
      project,
      "verify-current-mechanical-design-r3",
    );
    const reconciled = await service.reconcileWorkItemWithSuccessor(AGENT, {
      ...context("close-exact-reconciled-writer", project.revision),
      failedWorkItemId: "verify-current-mechanical-design",
      failedRunId: "run:uncertain-write-failed",
      successorRunId: "run:mechanical-r3-completed",
      successorRunSnapshot: project.threadSnapshots.at(-1)!,
      successorEvidenceRefs: successorWork.evidenceRefs,
      rationale:
        "The later appended successor completed with the exact replacement evidence.",
    });

    const failedWork = findWorkItem(
      reconciled,
      "verify-current-mechanical-design",
    );
    assertEquals(failedWork.status, "cancelled");
    assertEquals(failedWork.reconciliation?.kind, "superseded-by-successor");
    assertEquals(
      reconciled.agentRuns.find((run) => run.id === "run:uncertain-write-failed")
        ?.status,
      "failed",
    );
  },
);

Deno.test(
  "successor reconciliation refuses malformed and ordinary cancelled work items",
  async () => {
    const malformed = structuredClone(
      await reconciledUncertainWriterProjectWithCompletedSuccessor(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const malformedFailedRun = malformed.agentRuns.find((run) =>
      run.id === "run:uncertain-write-failed"
    )!;
    malformedFailedRun.uncertainWriterReconciliation = {
      ...malformedFailedRun.uncertainWriterReconciliation!,
      reconciledBy: { id: AGENT.actorId, origin: AGENT.kind },
    };
    const malformedService = serviceFor(
      new MemoryRevisionStore(
        validateEngineeringProjectSnapshot(malformed),
      ),
    );
    const malformedSuccessor = findWorkItem(
      malformed,
      "verify-current-mechanical-design-r3",
    );
    await assertCommandError(
      () =>
        malformedService.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-malformed-cancelled-writer", malformed.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:uncertain-write-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: malformed.threadSnapshots.at(-1)!,
          successorEvidenceRefs: malformedSuccessor.evidenceRefs,
          rationale: "A malformed annotation cannot close the old work item.",
        }),
      "invalid_transition",
    );

    const ordinary = structuredClone(
      await reconciliableProject(),
    ) as Mutable<EngineeringProjectSnapshot>;
    const ordinaryFailedWork = ordinary.workItems.find((workItem) =>
      workItem.id === "verify-current-mechanical-design"
    )!;
    ordinaryFailedWork.status = "cancelled";
    const ordinaryProject = validateEngineeringProjectSnapshot(ordinary);
    const ordinaryService = serviceFor(new MemoryRevisionStore(ordinaryProject));
    const ordinarySuccessor = findWorkItem(
      ordinaryProject,
      "verify-current-mechanical-design-r3",
    );
    await assertCommandError(
      () =>
        ordinaryService.reconcileWorkItemWithSuccessor(AGENT, {
          ...context("reject-ordinary-cancelled-writer", ordinaryProject.revision),
          failedWorkItemId: "verify-current-mechanical-design",
          failedRunId: "run:mechanical-r2-failed",
          successorRunId: "run:mechanical-r3-completed",
          successorRunSnapshot: ordinaryProject.threadSnapshots.at(-1)!,
          successorEvidenceRefs: ordinarySuccessor.evidenceRefs,
          rationale:
            "An ordinary cancelled work item has no uncertain-writer authority.",
        }),
      "invalid_transition",
    );
  },
);

// ---------------------------------------------------------------------------
// abandonWorkItems — governed abandonment of orphaned work items and decisions
// ---------------------------------------------------------------------------

Deno.test(
  "abandonWorkItems marks a waiting-for-decision work item and its required decision as abandoned",
  async () => {
    /** The base fixture has:
     *  - work item "verify-current-mechanical-design": waiting-for-decision, no runs, no evidence
     *  - decision "review-mechanical-proof-case": required
     * This is the canonical happy-path input for governed abandonment.
     */
    const store = await memoryStore();
    const service = serviceFor(store);
    const project = (await store.get(PROJECT_ID))!;

    const command: AbandonWorkItemsCommand = {
      ...context("abandon-orphaned-work-item", project.revision),
      workItemIds: ["verify-current-mechanical-design"],
      decisionIds: ["review-mechanical-proof-case"],
      rationale: "The proof-case approach was superseded; the item is orphaned.",
    };
    const updated = await service.abandonWorkItems(HUMAN, command);

    assertEquals(
      findWorkItem(updated, "verify-current-mechanical-design").status,
      "abandoned",
    );
    assertEquals(
      findDecision(updated, "review-mechanical-proof-case").status,
      "abandoned",
    );
    // An abandoned decision must not surface as attention-required on the project.
    const projectStatus = deriveEngineeringProjectStatus(updated);
    assert(
      projectStatus !== "attention-required",
      `project status must not be attention-required after abandonment, got: ${projectStatus}`,
    );
    // The store revision must have advanced exactly once.
    assertEquals(
      (await store.get(PROJECT_ID))?.revision,
      project.revision + 1,
    );
  },
);

Deno.test(
  "abandonWorkItems rejects an agent caller with permission_denied",
  async () => {
    /** work-item.abandon is human-only per ENGINEERING_PROJECT_COMMAND_POLICY. */
    const store = await memoryStore();
    const service = serviceFor(store);
    const project = (await store.get(PROJECT_ID))!;

    await assertCommandError(
      () =>
        service.abandonWorkItems(AGENT, {
          ...context("agent-abandon-rejected", project.revision),
          workItemIds: ["verify-current-mechanical-design"],
          decisionIds: [],
          rationale: "An agent must not be able to govern its own abandonment.",
        }),
      "permission_denied",
    );
  },
);

Deno.test(
  "abandonWorkItems rejects a work item that has an associated run",
  async () => {
    /** reconciliableProject() adds run:mechanical-r2-failed to the work item
     *  "verify-current-mechanical-design". A work item with associated runs has
     *  produced durable trace and cannot be silently abandoned.
     */
    const project = await reconciliableProject();
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);

    await assertCommandError(
      () =>
        service.abandonWorkItems(HUMAN, {
          ...context("abandon-with-run-rejected", project.revision),
          workItemIds: ["verify-current-mechanical-design"],
          decisionIds: [],
          rationale: "Should be rejected: a run is already associated.",
        }),
      "invalid_transition",
    );
    // The snapshot must not have been mutated.
    assertEquals(
      (await store.get(PROJECT_ID))?.revision,
      project.revision,
    );
  },
);

Deno.test(
  "abandonWorkItems rejects a work item that carries evidence refs",
  async () => {
    /** Any persisted evidence ref is a durable claim. A work item carrying one
     *  cannot be abandoned — its evidence must first be superseded or reconciled.
     */
    const base = structuredClone(await projectFixture()) as Mutable<
      EngineeringProjectSnapshot
    >;
    const workItem = base.workItems.find((item) =>
      item.id === "verify-current-mechanical-design"
    )!;
    // Force a single evidence ref onto the work item to trip the guard.
    // Use the fixture's only ThreadSnapshot (revision 5) so validation passes.
    (workItem as Mutable<typeof workItem>).evidenceRefs = [{
      snapshotId: "generic-test-system:r5:generic-baseline",
      snapshotRevision: 5,
      kind: "artifact",
      id: "orphaned-artifact",
    }];
    const project = validateEngineeringProjectSnapshot(base);
    const store = new MemoryRevisionStore(project);
    const service = serviceFor(store);

    await assertCommandError(
      () =>
        service.abandonWorkItems(HUMAN, {
          ...context("abandon-with-evidence-rejected", project.revision),
          workItemIds: ["verify-current-mechanical-design"],
          decisionIds: [],
          rationale: "Should be rejected: the work item carries evidence.",
        }),
      "invalid_transition",
    );
  },
);

Deno.test(
  "abandonWorkItems rejects a work item in a terminal status",
  async () => {
    /** "build-current-cad" is completed in the base fixture. Abandonment is only
     *  valid from ready or waiting-for-decision — completed is a terminal state
     *  and the transition must be refused.
     */
    const store = await memoryStore();
    const service = serviceFor(store);
    const project = (await store.get(PROJECT_ID))!;

    await assertCommandError(
      () =>
        service.abandonWorkItems(HUMAN, {
          ...context("abandon-completed-item-rejected", project.revision),
          workItemIds: ["build-current-cad"],
          decisionIds: [],
          rationale: "Should be rejected: completed items cannot be abandoned.",
        }),
      "invalid_transition",
    );
  },
);

Deno.test(
  "abandonWorkItems rejects a decision already in approved status",
  async () => {
    /** Once a decision is approved, it represents a committed human judgement.
     *  Abandoning it is not a valid transition — the caller must supersede it
     *  through the appropriate governance flow instead.
     */
    const store = await memoryStore();
    const service = serviceFor(store);
    // Advance the decision to "approved" via the standard governance path.
    const approved = await approveAll(service, store);

    await assertCommandError(
      () =>
        service.abandonWorkItems(HUMAN, {
          ...context("abandon-approved-decision-rejected", approved.revision),
          workItemIds: ["verify-current-mechanical-design"],
          decisionIds: ["review-mechanical-proof-case"],
          rationale: "Should be rejected: the decision is already approved.",
        }),
      "invalid_transition",
    );
  },
);
