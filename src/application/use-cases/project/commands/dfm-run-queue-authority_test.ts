import { assertEquals, assertRejects } from "@std/assert";
import { INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION } from "../../../../domain/make/dfm/dfm-case.ts";
import {
  DFM_RUN_AUTHORITY_DIVERGENT_REASON,
  DFM_RUN_AUTHORITY_MISSING_REASON,
} from "../../../../domain/make/dfm/dfm-run-authority.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";
import type { EngineeringProjectPlanningDependencies } from "./engineering-project-commands.ts";
import { applyQueueRun } from "./engineering-run-transitions.ts";

const FIXTURE = new URL(
  "../../../../testing/generic-engineering-project.fixture.json",
  import.meta.url,
);
const ORIGIN = { kind: "agent" as const, actorId: "agent:dfm-queue-authority" };
const APPLIED_AT = "2026-09-12T06:15:56.877Z";
const WORK_ID = "capture-system-model";
const DECISION_ID = "decision-run-dfm-id01-camera-board-envelope-mk4s-r1";
const APPROVAL_ID =
  "approval:decision-run-dfm-id01-camera-board-envelope-mk4s-r1:id01-propose-dfm-run-board-r1-20260911";
const FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "2a3e87eaac08eb56a96d16d7d83a43cb7854bd8bd151665c9dc2626306e5453a",
};
const SIGNED_BASIS: EngineeringThreadSnapshotRef = {
  snapshotId:
    "project:inspection-drone-id01:r115:industrialize-seal-dfm-case-run:id01-queue-dfm-seal-board-r1e-retry-f50-20260911",
  revision: 115,
  subjectId: "generic-test-system",
};
const QUEUE_BASIS: EngineeringThreadSnapshotRef = {
  snapshotId:
    "project:inspection-drone-id01:r117:analyze-seal-sensitivity-study-run:id01-queue-sens-seal-arm-height-b0e5ba4d-20260912",
  revision: 117,
  subjectId: "generic-test-system",
};

Deno.test(
  "queue refuses a stale r115 DFM approval against an r117 basis before eligibility",
  async () => {
    const project = await dfmQueueableProject(SIGNED_BASIS, QUEUE_BASIS);
    const workItem = project.workItems.find((item) => item.id === WORK_ID)!;
    const calls = { operations: 0, eligibility: 0 };
    const runCount = project.agentRuns.length;
    const receiptCount = project.commandReceipts?.length ?? 0;

    await assertRejects(
      () =>
        applyQueueRun(
          project as never,
          APPLIED_AT,
          ORIGIN,
          queueCommand(QUEUE_BASIS),
          dfmPlanning(calls),
        ),
      EngineeringProjectCommandError,
      DFM_RUN_AUTHORITY_DIVERGENT_REASON,
    );

    assertEquals(calls.operations, 1);
    assertEquals(calls.eligibility, 0);
    assertEquals(project.agentRuns.length, runCount);
    assertEquals(project.commandReceipts?.length ?? 0, receiptCount);
    assertEquals(workItem.status, "ready");
  },
);

Deno.test(
  "queue accepts industrialize.run-dfm-checks@1 on its exact approved Thread basis",
  async () => {
    const project = await dfmQueueableProject(QUEUE_BASIS, QUEUE_BASIS);
    const workItem = project.workItems.find((item) => item.id === WORK_ID)!;
    const calls = { operations: 0, eligibility: 0 };

    await applyQueueRun(
      project as never,
      APPLIED_AT,
      ORIGIN,
      queueCommand(QUEUE_BASIS),
      dfmPlanning(calls, { allowEligibility: true }),
    );

    assertEquals(calls.operations, 1);
    assertEquals(calls.eligibility, 1);
    assertEquals(project.agentRuns.length, 1);
    assertEquals(project.agentRuns[0]?.status, "queued");
    assertEquals(project.agentRuns[0]?.basis, {
      kind: "thread-snapshot",
      ...QUEUE_BASIS,
    });
    assertEquals(workItem.status, "in-progress");
  },
);

Deno.test(
  "queue refuses a DFM run with no human-approved decision before eligibility",
  async () => {
    const project = await dfmQueueableProject(QUEUE_BASIS, QUEUE_BASIS);
    const workItem = project.workItems.find((item) => item.id === WORK_ID)!;
    workItem.decisionIds = [];
    project.decisions = project.decisions.filter((item) => item.id !== DECISION_ID);
    project.approvals = [];
    const calls = { operations: 0, eligibility: 0 };
    const runCount = project.agentRuns.length;

    await assertRejects(
      () =>
        applyQueueRun(
          project as never,
          APPLIED_AT,
          ORIGIN,
          queueCommand(QUEUE_BASIS),
          dfmPlanning(calls),
        ),
      EngineeringProjectCommandError,
      DFM_RUN_AUTHORITY_MISSING_REASON,
    );

    assertEquals(calls.operations, 1);
    assertEquals(calls.eligibility, 0);
    assertEquals(project.agentRuns.length, runCount);
    assertEquals(workItem.status, "ready");
  },
);

async function dfmQueueableProject(
  signedBasis: EngineeringThreadSnapshotRef,
  queueBasis: EngineeringThreadSnapshotRef,
): Promise<Mutable<EngineeringProjectSnapshot>> {
  const project = JSON.parse(await Deno.readTextFile(FIXTURE)) as Mutable<
    EngineeringProjectSnapshot
  >;
  const declared = new Map(
    [...project.threadSnapshots, signedBasis, queueBasis].map((item) => [
      `${item.snapshotId}:${item.revision}:${item.subjectId}`,
      item,
    ]),
  );
  project.threadSnapshots = [...declared.values()];
  const workItem = project.workItems.find((item) => item.id === WORK_ID)!;
  workItem.status = "ready";
  workItem.kind = "industrialize";
  workItem.decisionIds = [DECISION_ID];
  const phase = project.phases.find((item) => item.id === workItem.phaseId);
  if (phase && !phase.requiredDecisionIds.includes(DECISION_ID)) {
    phase.requiredDecisionIds.push(DECISION_ID);
  }
  workItem.operation = {
    id: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id,
    version: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version,
    bindings: [
      threadBinding("dfmCase", queueBasis, "dfm-case-sealed"),
      threadBinding("geometry", queueBasis, "geometry-step"),
    ],
  };
  project.decisions.push({
    id: DECISION_ID,
    phaseId: workItem.phaseId,
    title: "Run measured CameraBoardEnvelope DFM (MK4S screening)",
    question: "Run the sealed MK4S DFM case against the canonical STEP?",
    status: "approved",
    requestedAt: APPLIED_AT,
    baseSnapshot: signedBasis,
    inputFingerprint: FINGERPRINT,
    inputEvidenceRefs: [],
    approvalIds: [APPROVAL_ID],
    proposal: {
      summary: "Run sealed MK4S DFM case. Screening only.",
      parameters: [{
        key: "dfm.run.caseDigest",
        label: "Sealed DFM case digest",
        value: "3ab2905dcce20501f5c7563fd59bcdc03512e61cb27e67e92fa5e51a62511a37",
      }],
      proposedAt: APPLIED_AT,
      proposedBy: { id: ORIGIN.actorId, origin: ORIGIN.kind },
    },
  });
  project.approvals.push({
    id: APPROVAL_ID,
    decisionId: DECISION_ID,
    status: "approved",
    requestedAt: APPLIED_AT,
    decidedAt: APPLIED_AT,
    decidedBy: "human:test",
    decidedByOrigin: "human",
    rationale: "Reviewed the sealed DFM case.",
    baseSnapshot: signedBasis,
    inputFingerprint: FINGERPRINT,
    inputEvidenceRefs: [],
  });
  return project;
}

function dfmPlanning(
  calls: { operations: number; eligibility: number },
  options: { readonly allowEligibility?: boolean } = {},
): EngineeringProjectPlanningDependencies {
  return {
    operations: {
      validate(input) {
        calls.operations++;
        return {
          operation: {
            id: input.operation.id,
            version: input.operation.version,
            startingPoint: "idea-or-spec" as const,
            title: "Run measured DFM checks on sealed canonical geometry",
            description: "Fixture DFM run operation.",
            workItemKind: "industrialize" as const,
            execution: "trusted" as const,
          },
          bindings: input.operation.bindings,
        };
      },
    },
    queueEligibility: {
      validate() {
        calls.eligibility++;
        if (!options.allowEligibility) {
          return Promise.reject(new Error("runtime must not be resolved"));
        }
        return Promise.resolve(undefined);
      },
    },
  };
}

function threadBinding(
  name: string,
  basis: EngineeringThreadSnapshotRef,
  id: string,
) {
  return {
    name,
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact" as const,
        id,
      },
    },
  };
}

function queueCommand(basis: EngineeringThreadSnapshotRef) {
  return {
    commandId: "id01-queue-dfm-run-board-r1-f52c-20260912",
    projectId: "generic-test-system",
    expectedRevision: 2,
    issuedAt: APPLIED_AT,
    runId: "run:id01-queue-dfm-run-board-r1-f52c-20260912",
    workItemId: WORK_ID,
    summary: "Execute reviewed operation industrialize.run-dfm-checks@1.",
    basis: { kind: "thread-snapshot" as const, ...basis },
  };
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
