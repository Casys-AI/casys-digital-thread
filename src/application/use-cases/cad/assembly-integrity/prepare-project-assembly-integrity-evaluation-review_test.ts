import { assertEquals } from "@std/assert";
import {
  selectUniquePendingL4Work,
} from "./prepare-project-assembly-integrity-evaluation-review.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";

const SUBJECT = "subject-assembly";
const BRIEF: EngineeringApprovedBriefBasis = {
  kind: "approved-brief",
  projectId: "project-assembly",
  projectSnapshotId: "project-assembly:r4",
  projectRevision: 4,
  briefId: "brief-assembly",
  briefSnapshotId: "brief-assembly:r3",
  briefRevision: 3,
  approvedBriefFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
};
const TIP = {
  kind: "thread-snapshot" as const,
  snapshotId: "thread-assembly-r9",
  revision: 9,
  subjectId: SUBJECT,
};

Deno.test("L4 review ignores historical evaluation activity and selects only the pending current-tip append", () => {
  const historical = work("work-l4-historical", "activity:l4-historical");
  const current = work("work-l4-current", "activity:l4-current");
  const settled = work(
    "work-l4-settled",
    "activity:l4-settled",
    "completed",
  );
  const project = {
    workItems: [historical, current, settled],
    planChanges: [
      change("change:l4-historical", historical.id, {
        snapshotId: "thread-assembly-r8",
        revision: 8,
        subjectId: SUBJECT,
      }),
      change("change:l4-current", current.id, TIP),
      change("change:l4-settled", settled.id, TIP),
    ],
  } as unknown as EngineeringProjectSnapshot;

  const result = selectUniquePendingL4Work(project, TIP, BRIEF);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.work.id, current.id);
});

function work(
  id: string,
  activityId: string,
  status: "waiting-for-decision" | "completed" = "waiting-for-decision",
) {
  return {
    id,
    activityId,
    phaseId: "phase-assembly",
    operation: {
      id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
      version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
      bindings: [],
    },
    status,
  };
}

function change(
  id: string,
  workItemId: string,
  baseSnapshot: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
) {
  return {
    id,
    workItemIds: [workItemId],
    baseSnapshot,
    approvedBriefBasis: BRIEF,
  };
}
