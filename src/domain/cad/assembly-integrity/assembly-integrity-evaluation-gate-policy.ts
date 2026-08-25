/**
 * Narrow L4 gate-claim policy.
 *
 * L4 is evidence that may contribute to zero or more current Brief V2 gates.
 * It is never an acceptance or satisfaction authority; leaving it ungated is
 * also valid for a generic evaluation work item.
 */

import type {
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../project/engineering-project.ts";
import {
  isProjectBriefGateKind,
  projectBriefContractVersion,
} from "../../project/project-brief.ts";

export function assemblyIntegrityEvaluationGateClaimIssue(
  project: EngineeringProjectSnapshot,
  work: EngineeringWorkItem,
): string | undefined {
  const claims = work.gateClaims;
  if (claims === undefined || claims.length === 0) return undefined;
  const brief = project.framing?.currentBrief;
  const approval = project.framing?.currentBriefApproval;
  if (
    !brief || approval?.status !== "approved" ||
    projectBriefContractVersion(brief) !== "2.0"
  ) {
    return "An L4 gate claim requires the current human-approved Brief V2.";
  }
  const claimedGateIds = new Set<string>();
  for (const claim of claims) {
    if (claimedGateIds.has(claim.gateItemId)) {
      return "L4 may claim each current Brief V2 gate at most once.";
    }
    claimedGateIds.add(claim.gateItemId);
    const gate = brief.items.find((item) => item.id === claim.gateItemId);
    if (
      claim.role !== "contributes-to" || claim.status !== "current" ||
      !gate || !isProjectBriefGateKind(gate.kind)
    ) {
      return "L4 may retain only current contributes-to claims targeting existing Brief V2 gates.";
    }
  }
  return undefined;
}
