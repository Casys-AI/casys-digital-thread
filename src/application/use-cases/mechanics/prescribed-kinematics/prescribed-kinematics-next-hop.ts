/**
 * Display-only append/propose envelopes for the prescribed-kinematics next hops.
 * These are not approvals, queue commands, or provider selections.
 */

import type { ProjectPrescribedKinematicsNextHop } from "../../../ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-next-hop-review.ts";
import { deepFreeze } from "../../../../domain/kernel/case-validation.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";

export function prescribedKinematicsNextHop(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly basis: EngineeringThreadSnapshotRef;
  readonly predecessorWorkItemId: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly owner: "agent" | "human";
  readonly tokenFingerprint: string;
  readonly phaseName: string;
  readonly phaseDescription: string;
  readonly decisionTitle: string;
  readonly decisionQuestion: string;
  readonly summary: string;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
}): ProjectPrescribedKinematicsNextHop {
  const token = `${input.operation.id.replaceAll(".", "-")}-${
    input.tokenFingerprint.slice(0, 16)
  }-r${input.project.revision}`;
  const phaseId = `phase-prescribed-kinematics-${token}`;
  const workItemId = `work-prescribed-kinematics-${token}`;
  const decisionId = `decision-prescribed-kinematics-${token}`;
  return deepFreeze({
    append: {
      tool: "project_change_append" as const,
      arguments: {
        commandId: `append-prescribed-kinematics-${token}`,
        projectId: input.project.project.id,
        baseSnapshot: {
          snapshotId: input.basis.snapshotId,
          revision: input.basis.revision,
          subjectId: input.basis.subjectId,
        },
        expectedRevision: input.project.revision,
        phases: [{
          id: phaseId,
          name: input.phaseName,
          description: input.phaseDescription,
        }],
        workItems: [{
          id: workItemId,
          phaseId,
          owner: input.owner,
          dependsOnWorkItemIds: [input.predecessorWorkItemId],
          decisionIds: [decisionId],
          operation: { ...input.operation, bindings: [] },
          gateClaims: [],
        }],
        requiredDecisions: [{
          id: decisionId,
          phaseId,
          title: input.decisionTitle,
          question: input.decisionQuestion,
        }],
      },
    },
    propose: {
      tool: "project_decision_propose" as const,
      arguments: {
        commandId: `propose-prescribed-kinematics-${token}`,
        projectId: input.project.project.id,
        expectedRevision: input.project.revision + 1,
        decisionId,
        proposal: {
          summary: input.summary,
          parameters: [...input.parameters],
        },
      },
    },
  });
}
