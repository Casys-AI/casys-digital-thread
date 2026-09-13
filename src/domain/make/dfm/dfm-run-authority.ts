/**
 * Exact human-approved DFM-check MRTR recross for
 * `industrialize.run-dfm-checks@1`.
 *
 * Queue, executor and viewer share this check: one unique approved decision
 * with a concrete proposal, one matching approved human-origin approval,
 * equal approval/decision input fingerprints, and the same snapshotId,
 * revision and subjectId for approval, decision and run basis.
 */

import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type {
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../project/engineering-project.ts";
import { sameSnapshotRef } from "../../project/validation/engineering-project-invariant-values.ts";

export const DFM_RUN_AUTHORITY_MISSING_REASON =
  "No exact human-approved DFM-check MRTR decision is bound to this run basis.";
export const DFM_RUN_AUTHORITY_DIVERGENT_REASON =
  "The signed DFM-check approval basis differs from this run basis.";
export const DFM_RUN_AUTHORITY_AMBIGUOUS_REASON =
  "Multiple human-approved DFM-check MRTR decisions are bound to this run basis.";

export type DfmRunAuthority = {
  readonly status: "available";
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
} | {
  readonly status: "unavailable";
  readonly reason:
    | typeof DFM_RUN_AUTHORITY_MISSING_REASON
    | typeof DFM_RUN_AUTHORITY_DIVERGENT_REASON
    | typeof DFM_RUN_AUTHORITY_AMBIGUOUS_REASON;
};

export function recrossDfmRunAuthority(
  project: Pick<EngineeringProjectSnapshot, "decisions" | "approvals">,
  workItem: Pick<EngineeringWorkItem, "decisionIds">,
  runBasis: EngineeringThreadSnapshotRef | undefined,
): DfmRunAuthority {
  if (!runBasis) {
    return unavailable(DFM_RUN_AUTHORITY_MISSING_REASON);
  }
  const matching: Array<{
    readonly decision: EngineeringDecision;
    readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  let signedOnAnotherBasis = false;
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || !decision.baseSnapshot) continue;
    const proposal = decision.proposal;
    const decisionBasis = decision.baseSnapshot;
    const approvals = project.approvals.filter((approval) => {
      const approvalBasis = approval.baseSnapshot;
      return approval.decisionId === decision.id &&
        approval.status === "approved" &&
        approval.decidedByOrigin === "human" &&
        approvalBasis !== undefined &&
        fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
        sameSnapshotRef(approvalBasis, decisionBasis);
    });
    if (approvals.length !== 1) continue;
    if (sameSnapshotRef(decisionBasis, runBasis)) {
      matching.push({ decision, proposal });
    } else {
      signedOnAnotherBasis = true;
    }
  }
  if (matching.length === 1) {
    return { status: "available", ...matching[0]! };
  }
  if (matching.length > 1) {
    return unavailable(DFM_RUN_AUTHORITY_AMBIGUOUS_REASON);
  }
  return unavailable(
    signedOnAnotherBasis
      ? DFM_RUN_AUTHORITY_DIVERGENT_REASON
      : DFM_RUN_AUTHORITY_MISSING_REASON,
  );
}

function unavailable(
  reason: Extract<DfmRunAuthority, { status: "unavailable" }>["reason"],
): DfmRunAuthority {
  return { status: "unavailable", reason };
}
