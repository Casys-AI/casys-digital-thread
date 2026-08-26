import { assertEquals } from "@std/assert";
import { engineeringActivityIdFromRootRevision } from "../../../../domain/project/engineering-activity.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import {
  isolatedFeaRunDecisionId,
  isolatedFeaRunWorkItemId,
  resolveFeaIsolatedRunSuccessor,
} from "./fea-isolated-run-successor.ts";

const ROOT_ID = isolatedFeaRunWorkItemId("a".repeat(64), 15);
const ACTIVITY_ID = engineeringActivityIdFromRootRevision(ROOT_ID);
const PHASE_ID = `phase-${ROOT_ID}`;
const FAILED_RUN_ID = "run:fea-isolated-r15-failed";

Deno.test("isolated FEA revision identities stay stable on generation 1 and increment after the root", () => {
  assertEquals(
    isolatedFeaRunWorkItemId("abcd".repeat(16), 15),
    "work-fea-isolated-abcdabcdabcdabcd-r15",
  );
  assertEquals(
    isolatedFeaRunWorkItemId("abcd".repeat(16), 15, 2),
    "work-fea-isolated-abcdabcdabcdabcd-r15-2",
  );
  assertEquals(
    isolatedFeaRunDecisionId("abcd".repeat(16), 15, 3),
    "decision-fea-isolated-abcdabcdabcdabcd-r15-3",
  );
});

Deno.test("isolated-run successor accepts the unique evidence-free output-validation leaf", () => {
  const resolved = resolveFeaIsolatedRunSuccessor(qualifyingInput());
  assertEquals(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assertEquals(resolved.predecessorWorkItemId, ROOT_ID);
  assertEquals(resolved.failedRunId, FAILED_RUN_ID);
  assertEquals(resolved.phaseId, PHASE_ID);
  assertEquals(resolved.workItemId, isolatedFeaRunWorkItemId("a".repeat(64), 15, 2));
  assertEquals(resolved.decisionId, isolatedFeaRunDecisionId("a".repeat(64), 15, 2));
  assertEquals(resolved.dependsOnWorkItemIds, ["work-step-export"]);
});

Deno.test("isolated-run successor refuses a foreign compiled root", () => {
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      workItems: [workItem({ activityId: "activity:other-root" })],
    }))),
    "activity-foreign",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      workItems: [workItem({ predecessorRevisionId: "work-other" })],
    }))),
    "activity-foreign",
  );
});

Deno.test("isolated-run successor refuses a forked activity", () => {
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      workItems: [
        workItem(),
        workItem({ id: `${ROOT_ID}-left`, predecessorRevisionId: ROOT_ID }),
        workItem({ id: `${ROOT_ID}-right`, predecessorRevisionId: ROOT_ID }),
      ],
    }))),
    "activity-leaf-ambiguous",
  );
});

Deno.test("isolated-run successor refuses completed, cancelled, evidenced, and reconciled leaves", () => {
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(withLeaf({ status: "completed" }))),
    "activity-leaf-not-ready",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(withLeaf({ status: "cancelled" }))),
    "activity-leaf-not-ready",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(withLeaf({ owner: "human" }))),
    "activity-leaf-not-agent-owned",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(withLeaf({
      evidenceRefs: [{
        snapshotId: "snap",
        snapshotRevision: 6,
        kind: "artifact",
        id: "fea-evidence",
      }],
    }))),
    "activity-leaf-has-evidence",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(withLeaf({
      reconciliation: {
        kind: "superseded-by-successor",
        reconciledAt: "2026-08-16T00:00:00.000Z",
        reconciledBy: { id: "human:reviewer", origin: "human" },
        failedRunId: FAILED_RUN_ID,
        successorRunId: "run:later",
        successorRunSnapshot: {
          snapshotId: "snap",
          revision: 6,
          subjectId: "project:desk-lamp-dl06",
        },
        successorEvidenceRefs: [],
        rationale: "Closed by a later revision.",
      },
    }))),
    "activity-leaf-reconciled",
  );
});

Deno.test("isolated-run successor refuses missing, multiple, cancelled, uncertain, and other failures", () => {
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({ runs: [] }))),
    "activity-attempt-missing",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      runs: [failedRun(), { ...failedRun(), id: "run:second-attempt" }],
    }))),
    "activity-attempt-ambiguous",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      runs: [{ ...failedRun(), status: "cancelled", failure: undefined }],
    }))),
    "activity-run-not-failed",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      runs: [{
        ...failedRun(),
        failure: {
          code: "verify-run-fea-static-proof-provider-outcome-unknown",
          message: "Provider write outcome is unknown.",
        },
      }],
    }))),
    "activity-run-uncertain",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      runs: [{
        ...failedRun(),
        failure: { code: "mechanical-not-published", message: "No evidence." },
      }],
    }))),
    "activity-failure-code-mismatch",
  );
});

Deno.test("isolated-run successor refuses a run that already names a result or evidence", () => {
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      runs: [{
        ...failedRun(),
        resultSnapshot: {
          snapshotId: "snap",
          revision: 6,
          subjectId: "project:desk-lamp-dl06",
        },
      }],
    }))),
    "activity-run-has-result",
  );
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      runs: [{
        ...failedRun(),
        evidenceRefs: [{
          snapshotId: "snap",
          snapshotRevision: 6,
          kind: "artifact",
          id: "fea-evidence",
        }],
      }],
    }))),
    "activity-run-has-result",
  );
});

Deno.test("isolated-run successor refuses a leaf whose operation or bindings differ", () => {
  assertEquals(
    refusalCode(resolveFeaIsolatedRunSuccessor(qualifyingInput({
      workItems: [workItem({ operation: { ...operation(), version: "2" } })],
    }))),
    "activity-operation-mismatch",
  );
});

Deno.test("isolated-run successor derives the next revision from a qualifying failed successor leaf", () => {
  const firstSuccessorId = isolatedFeaRunWorkItemId("a".repeat(64), 15, 2);
  const resolved = resolveFeaIsolatedRunSuccessor(qualifyingInput({
    workItems: [
      workItem({ id: ROOT_ID }),
      workItem({ id: firstSuccessorId, predecessorRevisionId: ROOT_ID }),
    ],
    runs: [{
      ...failedRun(),
      id: "run:fea-isolated-r15-2-failed",
      workItemId: firstSuccessorId,
    }],
  }));
  assertEquals(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assertEquals(resolved.predecessorWorkItemId, firstSuccessorId);
  assertEquals(resolved.failedRunId, "run:fea-isolated-r15-2-failed");
  assertEquals(resolved.workItemId, isolatedFeaRunWorkItemId("a".repeat(64), 15, 3));
});

function refusalCode(
  resolved: ReturnType<typeof resolveFeaIsolatedRunSuccessor>,
): string | null {
  return resolved.status === "unresolved" ? resolved.diagnostic.code : null;
}

function qualifyingInput(options: {
  readonly workItems?: readonly EngineeringWorkItem[];
  readonly runs?: readonly EngineeringAgentRun[];
} = {}) {
  return {
    project: project(
      [...(options.workItems ?? [workItem()])],
      [...(options.runs ?? [failedRun()])],
    ),
    rootWorkItemId: ROOT_ID,
    proofDigest: "a".repeat(64),
    threadRevision: 15,
    operation: operation(),
  };
}

function withLeaf(patch: Partial<EngineeringWorkItem>) {
  return qualifyingInput({ workItems: [workItem(patch)] });
}

function project(
  workItems: EngineeringWorkItem[],
  agentRuns: EngineeringAgentRun[],
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "desk-lamp-dl06:r12",
    revision: 12,
    generatedAt: "2026-08-16T00:00:00.000Z",
    project: {
      id: "desk-lamp-dl06",
      name: "Desk Lamp DL06",
      subjectId: "project:desk-lamp-dl06",
      objective: { title: "Objective", statement: "Statement." },
    },
    threadSnapshots: [{
      snapshotId: "snap",
      revision: 6,
      subjectId: "project:desk-lamp-dl06",
    }],
    phases: [{
      id: PHASE_ID,
      name: "Isolated FEA verification",
      order: 1,
      description: "Run the isolated CalculiX proof on the canonical part STEP.",
      workItemIds: workItems.map((item) => item.id),
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems,
    agentRuns,
    decisions: [],
    approvals: [],
    blockers: [],
  } as EngineeringProjectSnapshot;
}

function workItem(patch: Partial<EngineeringWorkItem> = {}): EngineeringWorkItem {
  return {
    id: ROOT_ID,
    activityId: ACTIVITY_ID,
    phaseId: PHASE_ID,
    title: "Isolated FEA verification",
    description: "Run the isolated CalculiX proof on the canonical part STEP.",
    kind: "verify",
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: ["work-step-export"],
    evidenceRefs: [],
    decisionIds: [isolatedFeaRunDecisionId("a".repeat(64), 15)],
    blockerIds: [],
    operation: operation(),
    ...patch,
  };
}

function failedRun(): EngineeringAgentRun {
  return {
    id: FAILED_RUN_ID,
    workItemId: ROOT_ID,
    status: "failed",
    summary: "Isolated output validation rejected the worker bundle.",
    queuedAt: "2026-08-16T00:00:00.000Z",
    startedAt: "2026-08-16T00:00:01.000Z",
    completedAt: "2026-08-16T00:00:02.000Z",
    evidenceRefs: [],
    failure: {
      code: "isolated_output_validation_failed",
      message: "Isolated output validation rejected registered role result.json.",
    },
  };
}

function operation(): EngineeringOperationRef {
  return {
    id: "verify.run-fea-static-proof",
    version: "3",
    bindings: [{
      name: "proofCase",
      source: {
        kind: "thread-entity",
        reference: {
          snapshotId: "snap",
          snapshotRevision: 6,
          kind: "artifact",
          id: "fea-proof",
        },
      },
    }, {
      name: "geometry",
      source: {
        kind: "thread-entity",
        reference: {
          snapshotId: "snap",
          snapshotRevision: 6,
          kind: "artifact",
          id: "arm-step",
        },
      },
    }],
  };
}
