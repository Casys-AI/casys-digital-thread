/**
 * Server-owned pasteable L5 closeout append and proposal. The caller does not
 * choose the predecessor, operation, owner, binding, decision, gate claim,
 * command ids, or expected revisions. Propose omits issuedAt so mcp:call can
 * fill it. One successful project.change-append lands at current + 1.
 */

import type { ProjectAssemblyIntegrityEvaluationCloseoutReviewNext } from "../../../ports/in/cad/assembly-integrity/project-assembly-integrity-evaluation-closeout-review.ts";
import {
  type AssemblyIntegrityEvaluationCloseoutAdmission,
  assemblyIntegrityEvaluationCloseoutWorkItemOperation,
  encodeAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import { deepFreeze } from "../../../../domain/kernel/case-validation.ts";
import type { EngineeringThreadSnapshotRef } from "../../../../domain/project/engineering-project.ts";

export function assemblyIntegrityEvaluationCloseoutReviewNext(input: {
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly l4WorkItemId: string;
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
  readonly admission: AssemblyIntegrityEvaluationCloseoutAdmission;
}): ProjectAssemblyIntegrityEvaluationCloseoutReviewNext {
  const admission = input.admission;
  const digestPrefix = admission.evaluationCapture.fingerprint.digest.slice(0, 16);
  const token = `${admission.consequence}-${digestPrefix}-r${admission.basis.revision}`;
  const phaseId = `phase-assembly-integrity-${token}`;
  const workItemId = `work-assembly-integrity-${token}`;
  const decisionId = `decision-assembly-integrity-${token}`;
  const title = admission.consequence === "accept"
    ? "Accept the assembly-integrity evaluation closeout"
    : "Reject the assembly-integrity evaluation closeout";
  const question = admission.consequence === "accept"
    ? "Accept decide.accept-assembly-integrity-evaluation@1 for this exact current L4 evaluation?"
    : "Reject decide.reject-assembly-integrity-evaluation@1 for this exact current L4 evaluation?";
  const summary = admission.consequence === "accept"
    ? "Accept this exact assembly-integrity evaluation closeout."
    : "Reject this exact assembly-integrity evaluation closeout.";
  // EngineeringProjectCommandService.apply persists current.revision + 1 after
  // a successful (non-replay) mutation and refuses a mismatched head. Propose
  // therefore targets the post-append revision; a stale or concurrent head
  // fails closed instead of inventing a later revision.
  const proposeExpectedRevision = input.expectedRevision + 1;
  return deepFreeze({
    append: {
      tool: "project_change_append" as const,
      arguments: {
        commandId: `append-assembly-integrity-${token}`,
        projectId: input.projectId,
        baseSnapshot: {
          snapshotId: input.baseSnapshot.snapshotId,
          revision: input.baseSnapshot.revision,
          subjectId: input.baseSnapshot.subjectId,
        },
        expectedRevision: input.expectedRevision,
        phases: [{
          id: phaseId,
          name: "Assembly integrity closeout",
          description:
            "Record the human L5 closeout of one exact current assembly-integrity L4 evaluation.",
        }],
        workItems: [{
          id: workItemId,
          phaseId,
          owner: "human" as const,
          dependsOnWorkItemIds: [input.l4WorkItemId],
          decisionIds: [decisionId],
          operation: assemblyIntegrityEvaluationCloseoutWorkItemOperation(
            admission.consequence,
          ),
          gateClaims: [...admission.gateClaims],
        }],
        requiredDecisions: [{
          id: decisionId,
          phaseId,
          title,
          question,
        }],
      },
    },
    propose: {
      tool: "project_decision_propose" as const,
      arguments: {
        commandId: `propose-assembly-integrity-${token}`,
        projectId: input.projectId,
        expectedRevision: proposeExpectedRevision,
        decisionId,
        proposal: {
          summary,
          parameters: encodeAssemblyIntegrityEvaluationCloseoutAdmission(admission),
        },
      },
    },
  });
}
