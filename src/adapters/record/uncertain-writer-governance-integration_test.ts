import { assertEquals, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import {
  assertUncertainWriterBasisReleaseProposal,
  UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
  uncertainWriterBasisReleaseIds,
} from "../../domain/record/uncertain-writer-basis-release.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import { assertThreadWriteBasisAvailable } from "../shared/thread-write-basis-guard.ts";

const PROJECT_ID = "uncertain-writer-governance-integration";
const AGENT = { kind: "agent" as const, actorId: "agent:integration" };
const REVIEWER = { kind: "human" as const, actorId: "human:reviewer" };
const EXECUTOR = { kind: "human" as const, actorId: "human:executor" };
const ISSUED_AT = "2026-08-10T00:00:00.000Z";

Deno.test("a valid V3 accepted-write ceremony blocks another writer until the exact release approval", async () => {
  const store = new MemoryRevisionStore();
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-10T00:01:00.000Z") + tick++ * 1_000)
      .toISOString();
  const briefs = new ProjectBriefCommandService(store, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Uncertain writer governance integration",
    issuedAt: ISSUED_AT,
    intent: "Exercise the complete uncertain-writer governance path.",
    intentSource: { kind: "human", reference: "integration:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...command("propose-brief", project),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Exercise the complete uncertain-writer governance path.",
      sourceRefs: [{ kind: "intent", reference: "integration:test" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Record and release one accepted uncertain provider write.",
      sourceRefs: [{ kind: "intent", reference: "integration:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "A second writer is released only after exact human approval.",
      sourceRefs: [{ kind: "intent", reference: "integration:test" }],
      dependsOnItemIds: [],
    }, {
      id: "verify",
      kind: "verification-activity",
      statement: "Verify the exact reconciliation and release ceremony.",
      sourceRefs: [{ kind: "intent", reference: "integration:test" }],
      dependsOnItemIds: ["success"],
    }],
  });
  project = await briefs.approveBrief(REVIEWER, {
    ...command("approve-brief", project),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approve the bounded integration brief.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    store,
    { validate: () => Promise.resolve() },
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  project = await commands.publishPlan(AGENT, {
    ...command("publish-plan", project),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Baseline",
      description: "Create the first documentary Thread snapshot.",
    }],
    workItems: [{
      id: "baseline-work",
      phaseId: "baseline",
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
  project = await commands.queueRun(AGENT, {
    ...command("queue-baseline", project),
    runId: "run:baseline",
    workItemId: "baseline-work",
    summary: "Queue the approved brief baseline.",
    basis: project.plan!.basis,
  });
  project = await commands.claimRun(AGENT, {
    ...command("claim-baseline", project),
    runId: "run:baseline",
    summary: "Claim the approved brief baseline.",
  });
  project = await commands.publishRun(AGENT, {
    ...command("publish-baseline", project),
    runId: "run:baseline",
    summary: "Publish the approved brief baseline.",
  });
  const head = {
    snapshotId: `${PROJECT_ID}:thread:r1`,
    revision: 1,
    subjectId: project.project.subjectId,
  };
  project = await commands.completeRun(AGENT, {
    ...command("complete-baseline", project),
    runId: "run:baseline",
    summary: "Complete the approved brief baseline.",
    resultSnapshot: head,
    evidenceRefs: [{
      snapshotId: head.snapshotId,
      snapshotRevision: head.revision,
      kind: "artifact",
      id: "baseline-artifact",
    }],
  });

  const reconciliationDecisionId = "decision:reconcile";
  project = await commands.appendChange(AGENT, {
    ...command("append-governance-work", project),
    baseSnapshot: head,
    phases: [{
      id: "governance",
      name: "Uncertain writer governance",
      description: "Exercise exact reconciliation and basis release.",
    }],
    workItems: [{
      id: "failed-writer",
      phaseId: "governance",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: approvedBriefOperation("model.write-architecture"),
    }, {
      id: "candidate-writer",
      phaseId: "governance",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: approvedBriefOperation("model.write-architecture"),
    }, {
      id: "reconcile-work",
      phaseId: "governance",
      owner: "human",
      dependsOnWorkItemIds: [],
      decisionIds: [reconciliationDecisionId],
      operation: approvedBriefOperation("record.reconcile-uncertain-writer"),
    }],
    requiredDecisions: [{
      id: reconciliationDecisionId,
      phaseId: "governance",
      title: "Reconcile the uncertain writer",
      question: "What exact durable effect did the provider produce?",
    }],
  });
  const basis = { kind: "thread-snapshot" as const, ...head };
  project = await commands.queueRun(AGENT, {
    ...command("queue-failed-writer", project),
    runId: "run:failed-writer",
    workItemId: "failed-writer",
    summary: "Queue the writer that will become uncertain.",
    basis,
  });
  project = await commands.queueRun(AGENT, {
    ...command("queue-candidate-writer", project),
    runId: "run:candidate-writer",
    workItemId: "candidate-writer",
    summary: "Queue another writer from the same exact basis.",
    basis,
  });
  project = await commands.claimRun(AGENT, {
    ...command("claim-failed-writer", project),
    runId: "run:failed-writer",
    summary: "Claim the writer that will become uncertain.",
  });
  project = await commands.failRun(AGENT, {
    ...command("fail-writer", project),
    runId: "run:failed-writer",
    summary: "Provider outcome became uncertain.",
    code: "model-write-architecture-provider-outcome-unknown",
    message: "Provider acknowledged the write before capture failed.",
  });

  const attestation = "Provider history shows the exact architecture write.";
  const reconciliationParameters = [{
    key: "reconcileAction",
    label: "Action",
    value: "resolve-uncertain-writer",
  }, {
    key: "reconcileOperation",
    label: "Operation",
    value: "record.reconcile-uncertain-writer@1",
  }, {
    key: "reconcileRunId",
    label: "Run",
    value: "run:failed-writer",
  }, {
    key: "reconcileFailureCode",
    label: "Failure",
    value: "model-write-architecture-provider-outcome-unknown",
  }, {
    key: "reconcileBasisSnapshotId",
    label: "Basis",
    value: head.snapshotId,
  }, {
    key: "reconcileOutcome",
    label: "Outcome",
    value: "write-effect-accepted",
  }, {
    key: "reconcileAttestation",
    label: "Attestation",
    value: attestation,
  }];
  project = await commands.proposeDecision(AGENT, {
    ...command("propose-reconciliation", project),
    decisionId: reconciliationDecisionId,
    proposal: {
      summary: "Accept the exact provider write after inspection.",
      parameters: reconciliationParameters,
    },
    baseSnapshot: head,
  });
  project = await commands.approveDecision(REVIEWER, {
    ...command("approve-reconciliation", project),
    decisionId: reconciliationDecisionId,
    rationale: "The exact provider state was reviewed.",
    inputFingerprint: project.decisions.find((item) =>
      item.id === reconciliationDecisionId
    )!.inputFingerprint!,
  });
  project = await commands.queueRun(REVIEWER, {
    ...command("queue-reconciliation", project),
    runId: "run:reconciliation",
    workItemId: "reconcile-work",
    summary: "Queue the exact human reconciliation.",
    basis,
  });
  const reconciliationCommand = {
    ...command("execute-reconciliation", project),
    reconciliationRunId: "run:reconciliation",
    failedRunId: "run:failed-writer",
    decisionId: reconciliationDecisionId,
    outcome: "write-effect-accepted" as const,
    providerInspectionAttestation: attestation,
  };
  const reconciled = await commands.reconcileAnnotationRun(
    EXECUTOR,
    reconciliationCommand,
  );
  validateEngineeringProjectSnapshot(reconciled);
  assertEquals(
    reconciled.agentRuns.find((item) => item.id === "run:failed-writer")
      ?.uncertainWriterReconciliation?.reconciledBy.id,
    EXECUTOR.actorId,
  );
  const candidate = reconciled.agentRuns.find((item) =>
    item.id === "run:candidate-writer"
  )!;
  await assertRejects(
    () => assertThreadWriteBasisAvailable(reconciled, candidate),
    EngineeringProjectCommandError,
    "requires an approved human basis release",
  );

  const ids = uncertainWriterBasisReleaseIds("run:failed-writer");
  const releaseParameters = [{
    key: "releaseAction",
    label: "Action",
    value: UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  }, {
    key: "releaseOutcome",
    label: "Outcome",
    value: UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
  }, {
    key: "failedRunId",
    label: "Failed run",
    value: "run:failed-writer",
  }, {
    key: "failureCode",
    label: "Failure",
    value: "model-write-architecture-provider-outcome-unknown",
  }, {
    key: "subjectId",
    label: "Subject",
    value: head.subjectId,
  }, {
    key: "snapshotId",
    label: "Snapshot",
    value: head.snapshotId,
  }, {
    key: "revision",
    label: "Revision",
    value: head.revision,
  }, {
    key: "blockerId",
    label: "Blocker",
    value: ids.blockerId,
  }, {
    key: "reconciliationDecisionId",
    label: "Reconciliation decision",
    value: reconciliationDecisionId,
  }, {
    key: "reconciliationOutcome",
    label: "Reconciliation outcome",
    value: "write-effect-accepted",
  }, {
    key: "releaseAttestation",
    label: "Release attestation",
    value: "The uncaptured provider effect was reviewed before release.",
  }];
  assertUncertainWriterBasisReleaseProposal(
    reconciled,
    ids.decisionId,
    releaseParameters,
  );
  project = await commands.proposeDecision(AGENT, {
    ...command("propose-release", reconciled),
    decisionId: ids.decisionId,
    proposal: {
      summary: "Release the exact basis after reviewing the accepted effect.",
      parameters: releaseParameters,
    },
    baseSnapshot: head,
  });
  project = await commands.approveDecision(REVIEWER, {
    ...command("approve-release", project),
    decisionId: ids.decisionId,
    rationale: "Approve release of this exact basis.",
    inputFingerprint: project.decisions.find((item) => item.id === ids.decisionId)!
      .inputFingerprint!,
  });
  validateEngineeringProjectSnapshot(project);
  await assertThreadWriteBasisAvailable(
    project,
    project.agentRuns.find((item) => item.id === candidate.id)!,
  );

  const replay = await commands.reconcileAnnotationRun(
    EXECUTOR,
    reconciliationCommand,
  );
  assertEquals(replay.id, reconciled.id);
  assertEquals(replay.revision, reconciled.revision);
});

function approvedBriefOperation(id: string) {
  return {
    id,
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
}

function command(commandId: string, project: EngineeringProjectSnapshot) {
  return {
    commandId,
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: ISSUED_AT,
  };
}

class MemoryRevisionStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((item) => item.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
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
      throw new EngineeringProjectStoreConflictError("Project already exists.");
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
