import { assertEquals } from "@std/assert";
import {
  deriveEngineeringPhaseStatus,
  type EngineeringProjectSnapshot,
  type EngineeringThreadEntityRef,
  type EngineeringWorkItem,
  type EngineeringWorkItemRunSuccessorReconciliation,
} from "./engineering-project.ts";
import { engineeringActivityIdFromRootRevision } from "./engineering-activity.ts";

Deno.test(
  "same-phase successor evidence still completes a cancelled-and-reconciled phase",
  () => {
    const snapshot = reconcileSnapshot({ samePhase: true });

    assertEquals(
      deriveEngineeringPhaseStatus(snapshot, "verification"),
      "completed",
    );
  },
);

Deno.test(
  "an empty other-phase cancelled seed is planned, not completed, when successor evidence lives elsewhere",
  () => {
    const snapshot = reconcileSnapshot({ samePhase: false });

    assertEquals(deriveEngineeringPhaseStatus(snapshot, "phase-seed"), "planned");
    assertEquals(
      deriveEngineeringPhaseStatus(snapshot, "phase-seed-2"),
      "completed",
    );
  },
);

function reconcileSnapshot(
  spec: { readonly samePhase: boolean },
): EngineeringProjectSnapshot {
  const evidence: EngineeringThreadEntityRef = {
    kind: "artifact",
    id: "syson-model-seed",
    snapshotId: "thread-seed",
    snapshotRevision: 2,
  };
  const failedPhaseId = spec.samePhase ? "verification" : "phase-seed";
  const successorPhaseId = spec.samePhase ? "verification" : "phase-seed-2";
  const reconciliation: EngineeringWorkItemRunSuccessorReconciliation = {
    kind: "superseded-by-successor",
    reconciledAt: "2026-08-18T06:58:30.000Z",
    reconciledBy: { id: "agent:reconciler", origin: "agent" },
    failedRunId: "run:seed-cancelled",
    successorRunId: "run:seed-2",
    successorRunSnapshot: {
      snapshotId: "thread-seed",
      revision: 2,
      subjectId: "project-seed",
    },
    successorEvidenceRefs: [evidence],
    rationale: "The pre-claim cancelled seed was closed by the completed successor.",
  };
  const failedWork: EngineeringWorkItem = workItem({
    id: "wi-seed",
    phaseId: failedPhaseId,
    status: "cancelled",
    evidenceRefs: [],
    reconciliation,
  });
  const successorWork: EngineeringWorkItem = workItem({
    id: "wi-seed-2",
    phaseId: successorPhaseId,
    status: "completed",
    evidenceRefs: [evidence],
  });
  const phases = spec.samePhase
    ? [phase("verification", 2, ["wi-seed", "wi-seed-2"], [evidence])]
    : [
      phase("phase-seed", 1, ["wi-seed"], []),
      phase("phase-seed-2", 2, ["wi-seed-2"], [evidence]),
    ];
  return {
    schemaVersion: "4.0",
    id: "project-seed",
    revision: 1,
    generatedAt: "2026-08-18T06:58:30.000Z",
    project: {
      id: "project-seed",
      name: "Seed",
      subjectId: "project-seed",
      objective: { title: "Seed", statement: "Seed the model container." },
    },
    threadSnapshots: [{
      snapshotId: "thread-seed",
      revision: 2,
      subjectId: "project-seed",
    }],
    phases,
    workItems: [failedWork, successorWork],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function phase(
  id: string,
  order: number,
  workItemIds: readonly string[],
  evidenceRefs: readonly EngineeringThreadEntityRef[],
) {
  return {
    id,
    name: id,
    order,
    description: id,
    workItemIds,
    requiredDecisionIds: [],
    evidenceRefs,
  };
}

function workItem(spec: {
  readonly id: string;
  readonly phaseId: string;
  readonly status: EngineeringWorkItem["status"];
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly reconciliation?: EngineeringWorkItem["reconciliation"];
}): EngineeringWorkItem {
  return {
    id: spec.id,
    activityId: engineeringActivityIdFromRootRevision(spec.id),
    phaseId: spec.phaseId,
    title: spec.id,
    description: spec.id,
    kind: "architect",
    operation: {
      id: "architecture.seed-syson-model",
      version: "2",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }],
    },
    status: spec.status,
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: spec.evidenceRefs,
    decisionIds: [],
    blockerIds: [],
    ...(spec.reconciliation ? { reconciliation: spec.reconciliation } : {}),
  };
}
