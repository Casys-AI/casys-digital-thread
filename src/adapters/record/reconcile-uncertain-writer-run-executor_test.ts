import { assertEquals, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { ReconcileUncertainWriterRunExecutor } from "./reconcile-uncertain-writer-run-executor.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

const BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "subject:thread:r4",
  revision: 4,
  subjectId: "subject",
};
const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("exact executor retry reaches immutable command-service replay instead of rejecting an existing reconciliation", async () => {
  const base = replaySnapshot();
  const decision = base.decisions[0]!;
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  const sealed: EngineeringProjectSnapshot = {
    ...base,
    decisions: [{ ...decision, inputFingerprint: decisionFingerprint }],
    approvals: base.approvals.map((approval) => ({
      ...approval,
      inputFingerprint: decisionFingerprint,
    })),
  };
  const origin = { kind: "human" as const, actorId: "operator" };
  const command = {
    commandId: "reconcile-command",
    projectId: "project",
    expectedRevision: 8,
    issuedAt: "2026-08-10T00:00:00.000Z",
    runId: "run:reconcile",
  };
  const serviceCommand = {
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    issuedAt: command.issuedAt,
    reconciliationRunId: command.runId,
    failedRunId: "run:failed",
    decisionId: "decision:reconcile",
    outcome: "write-effect-accepted" as const,
    providerInspectionAttestation: "Provider history shows the write.",
  };
  const requestFingerprint = await sha256Fingerprint({
    type: "agent-run.reconcile-annotation",
    origin,
    command: serviceCommand,
  });
  const historical: EngineeringProjectSnapshot = {
    ...sealed,
    commandReceipts: [{
      ...sealed.commandReceipts![0]!,
      requestFingerprint,
    }],
  };
  const current: EngineeringProjectSnapshot = {
    ...historical,
    id: "project:r10:later-unrelated-command",
    revision: 10,
    previous: { snapshotId: historical.id, revision: historical.revision },
    generatedAt: "2026-08-10T00:01:00.000Z",
  };
  let commits = 0;
  const store = {
    get: () => Promise.resolve(current),
    getRevision: (_projectId: string, revision: number) =>
      Promise.resolve(revision === historical.revision ? historical : undefined),
    commit: () => {
      commits++;
      return Promise.reject(new Error("replay must never commit"));
    },
  } as unknown as EngineeringProjectRevisionStore;
  const commands = new EngineeringProjectCommandService(store);
  let retainedLeaseFinalizations = 0;
  const executor = new ReconcileUncertainWriterRunExecutor({
    projects: store,
    commands,
    retainedCapabilityLeaseFinalizer: {
      releaseReconciledUncertainWriterLease: () => {
        retainedLeaseFinalizations++;
        return Promise.resolve();
      },
    },
  });

  const result = await executor.execute(origin, command);

  assertEquals(result.id, historical.id);
  assertEquals(result.revision, 9);
  assertEquals(result.id === current.id, false);
  assertEquals(result.commandReceipts?.length, 1);
  assertEquals(commits, 0);
  assertEquals(retainedLeaseFinalizations, 0);

  const conflict = await assertRejects(
    () =>
      executor.execute(origin, { ...command, issuedAt: "2026-08-10T00:00:01.000Z" }),
    EngineeringProjectCommandError,
  );
  assertEquals(conflict.code, "command_id_conflict");
  const differentCommand = await assertRejects(
    () =>
      executor.execute(origin, {
        ...command,
        commandId: "different-command",
        expectedRevision: current.revision,
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(differentCommand.code, "invalid_transition");
  assertEquals(commits, 0);
  assertEquals(retainedLeaseFinalizations, 0);
});

Deno.test("exact executor retry accepts the immutable legacy annotation-command fingerprint", async () => {
  const base = replaySnapshot();
  const decision = base.decisions[0]!;
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  const sealed: EngineeringProjectSnapshot = {
    ...base,
    decisions: [{ ...decision, inputFingerprint: decisionFingerprint }],
    approvals: base.approvals.map((approval) => ({
      ...approval,
      inputFingerprint: decisionFingerprint,
    })),
  };
  const origin = { kind: "human" as const, actorId: "operator" };
  const command = {
    commandId: "reconcile-command",
    projectId: "project",
    expectedRevision: 8,
    issuedAt: "2026-08-10T00:00:00.000Z",
    runId: "run:reconcile",
  };
  const legacyFingerprint = await sha256Fingerprint({
    type: "agent-run.reconcile-annotation",
    origin,
    command: {
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: command.expectedRevision,
      issuedAt: command.issuedAt,
      reconciliationRunId: command.runId,
      failedRunId: "run:failed",
      reconciliation: sealed.agentRuns[0]!.uncertainWriterReconciliation!,
    },
  });
  const historical: EngineeringProjectSnapshot = {
    ...sealed,
    commandReceipts: [{
      ...sealed.commandReceipts![0]!,
      requestFingerprint: legacyFingerprint,
    }],
  };
  const current: EngineeringProjectSnapshot = {
    ...historical,
    id: "project:r10:later-unrelated-command",
    revision: 10,
    previous: { snapshotId: historical.id, revision: historical.revision },
    generatedAt: "2026-08-10T00:01:00.000Z",
  };
  let commits = 0;
  const store = {
    get: () => Promise.resolve(current),
    getRevision: (_projectId: string, revision: number) =>
      Promise.resolve(revision === historical.revision ? historical : undefined),
    commit: () => {
      commits++;
      return Promise.reject(new Error("legacy replay must never commit"));
    },
  } as unknown as EngineeringProjectRevisionStore;
  const commands = new EngineeringProjectCommandService(store);
  const executor = new ReconcileUncertainWriterRunExecutor({
    projects: store,
    commands,
  });

  const result = await executor.execute(origin, command);

  assertEquals(result.id, historical.id);
  assertEquals(result.revision, historical.revision);
  assertEquals(result.commandReceipts?.length, 1);
  assertEquals(commits, 0);

  const canonicalServiceCommand = {
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    issuedAt: command.issuedAt,
    reconciliationRunId: command.runId,
    failedRunId: "run:failed",
    decisionId: "decision:reconcile",
    outcome: "write-effect-accepted" as const,
    providerInspectionAttestation: "Provider history shows the write.",
  };
  for (
    const forged of [
      { ...canonicalServiceCommand, decisionId: "decision:forged" },
      { ...canonicalServiceCommand, outcome: "provider-did-not-write" as const },
      {
        ...canonicalServiceCommand,
        providerInspectionAttestation: "Different provider claim.",
      },
    ]
  ) {
    const conflict = await assertRejects(
      () => commands.reconcileAnnotationRun(origin, forged),
      EngineeringProjectCommandError,
    );
    assertEquals(conflict.code, "command_id_conflict");
  }
  assertEquals(commits, 0);
});

Deno.test("did-not-write reconciliation finalizes only the exact retained capability lease after the durable annotation", async () => {
  const base = didNotWriteReplaySnapshot();
  const decision = base.decisions[0]!;
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  const sealed: EngineeringProjectSnapshot = {
    ...base,
    decisions: [{ ...decision, inputFingerprint: decisionFingerprint }],
    approvals: base.approvals.map((approval) => ({
      ...approval,
      inputFingerprint: decisionFingerprint,
    })),
  };
  const origin = { kind: "human" as const, actorId: "operator" };
  const command = {
    commandId: "reconcile-command",
    projectId: "project",
    expectedRevision: 8,
    issuedAt: "2026-08-10T00:00:00.000Z",
    runId: "run:reconcile",
  };
  const serviceCommand = {
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    issuedAt: command.issuedAt,
    reconciliationRunId: command.runId,
    failedRunId: "run:failed",
    decisionId: "decision:reconcile",
    outcome: "provider-did-not-write" as const,
    providerInspectionAttestation: "Provider history shows no write.",
  };
  const requestFingerprint = await sha256Fingerprint({
    type: "agent-run.reconcile-annotation",
    origin,
    command: serviceCommand,
  });
  const historical: EngineeringProjectSnapshot = {
    ...sealed,
    commandReceipts: [{
      ...sealed.commandReceipts![0]!,
      requestFingerprint,
    }],
  };
  const store = {
    get: () => Promise.resolve(historical),
    getRevision: (_projectId: string, revision: number) =>
      Promise.resolve(revision === historical.revision ? historical : undefined),
    commit: () => Promise.reject(new Error("replay must never commit")),
  } as unknown as EngineeringProjectRevisionStore;
  const released: unknown[] = [];
  const executor = new ReconcileUncertainWriterRunExecutor({
    projects: store,
    commands: new EngineeringProjectCommandService(store),
    retainedCapabilityLeaseFinalizer: {
      releaseReconciledUncertainWriterLease: (input) => {
        released.push(input);
        return Promise.resolve();
      },
    },
  });

  await executor.execute(origin, command);

  assertEquals(released, [{
    project: historical,
    failedRunId: "run:failed",
    reconciliationRunId: "run:reconcile",
  }]);
});

function didNotWriteReplaySnapshot(): EngineeringProjectSnapshot {
  const base = replaySnapshot();
  const failed = base.agentRuns.find((run) => run.id === "run:failed")!;
  const decision = base.decisions[0]!;
  return {
    ...base,
    agentRuns: base.agentRuns.map((run) =>
      run.id !== failed.id ? run : {
        ...run,
        uncertainWriterReconciliation: {
          ...failed.uncertainWriterReconciliation!,
          outcome: "provider-did-not-write" as const,
          providerInspectionAttestation: "Provider history shows no write.",
        },
      }
    ),
    decisions: [{
      ...decision,
      proposal: {
        ...decision.proposal!,
        parameters: decision.proposal!.parameters.map((parameter) =>
          parameter.key === "reconcileOutcome"
            ? { ...parameter, value: "provider-did-not-write" }
            : parameter.key === "reconcileAttestation"
            ? { ...parameter, value: "Provider history shows no write." }
            : parameter
        ),
      },
    }],
  };
}

function replaySnapshot(): EngineeringProjectSnapshot {
  const reconciliation = {
    kind: "uncertain-writer-resolved" as const,
    outcome: "write-effect-accepted" as const,
    reconciledAt: "2026-08-10T00:00:10.000Z",
    reconciledBy: { id: "operator", origin: "human" as const },
    decisionId: "decision:reconcile",
    providerInspectionAttestation: "Provider history shows the write.",
  };
  return {
    schemaVersion: "4.0",
    id: "project:r9:immutable-receipt",
    revision: 9,
    generatedAt: "2026-08-10T00:00:10.000Z",
    project: {
      id: "project",
      name: "Project",
      subjectId: BASIS.subjectId,
      objective: { title: "Objective", statement: "Test exact replay." },
    },
    threadSnapshots: [BASIS],
    phases: [],
    workItems: [{
      id: "work:failed",
      activityId: "activity:work:failed",
      phaseId: "phase",
      title: "Failed writer",
      description: "Writer with a terminal uncertain result.",
      kind: "architect",
      operation: { id: "model.write-architecture", version: "1", bindings: [] },
      status: "ready",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }, {
      id: "work:reconcile",
      activityId: "activity:work:reconcile",
      phaseId: "phase",
      title: "Reconcile writer",
      description: "Human reconciliation.",
      kind: "review",
      operation: {
        id: "record.reconcile-uncertain-writer",
        version: "1",
        bindings: [],
      },
      status: "completed",
      owner: "human",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["decision:reconcile"],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:failed",
      workItemId: "work:failed",
      status: "failed",
      summary: "Provider outcome unknown.",
      queuedAt: "2026-08-10T00:00:00.000Z",
      basis: BASIS,
      evidenceRefs: [],
      failure: {
        code: "model-write-architecture-provider-outcome-unknown",
        message: "Provider outcome unknown.",
      },
      uncertainWriterReconciliation: reconciliation,
    }, {
      id: "run:reconcile",
      workItemId: "work:reconcile",
      status: "completed",
      summary: "Uncertain-writer reconciliation completed by human operator.",
      queuedAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:10.000Z",
      basis: BASIS,
      evidenceRefs: [],
      annotationOnly: true,
    }],
    decisions: [{
      id: "decision:reconcile",
      phaseId: "phase",
      title: "Reconcile",
      question: "What did the provider do?",
      status: "approved",
      requestedAt: "2026-08-10T00:00:00.000Z",
      baseSnapshot: BASIS,
      inputFingerprint: FINGERPRINT,
      inputEvidenceRefs: [],
      approvalIds: ["approval:reconcile"],
      proposal: {
        summary: "Accept the observed provider effect.",
        proposedAt: "2026-08-10T00:00:00.000Z",
        proposedBy: { id: "agent", origin: "agent" },
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
          { key: "reconcileRunId", label: "Run", value: "run:failed" },
          {
            key: "reconcileFailureCode",
            label: "Failure",
            value: "model-write-architecture-provider-outcome-unknown",
          },
          { key: "reconcileBasisSnapshotId", label: "Basis", value: BASIS.snapshotId },
          { key: "reconcileOutcome", label: "Outcome", value: "write-effect-accepted" },
          {
            key: "reconcileAttestation",
            label: "Attestation",
            value: "Provider history shows the write.",
          },
        ],
      },
    }],
    approvals: [{
      id: "approval:reconcile",
      decisionId: "decision:reconcile",
      status: "approved",
      requestedAt: "2026-08-10T00:00:00.000Z",
      decidedAt: "2026-08-10T00:00:01.000Z",
      decidedBy: "operator",
      decidedByOrigin: "human",
      rationale: "Inspected provider.",
      baseSnapshot: BASIS,
      inputFingerprint: FINGERPRINT,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [{
      commandId: "reconcile-command",
      type: "agent-run.reconcile-annotation",
      actor: { id: "operator", origin: "human" },
      issuedAt: "2026-08-10T00:00:00.000Z",
      appliedAt: "2026-08-10T00:00:10.000Z",
      requestFingerprint: FINGERPRINT,
      resultingSnapshot: { snapshotId: "project:r9:immutable-receipt", revision: 9 },
    }],
  };
}
