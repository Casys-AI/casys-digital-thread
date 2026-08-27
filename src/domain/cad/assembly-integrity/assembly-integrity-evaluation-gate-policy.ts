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
  currentApprovedAssemblyIntegrityVerificationGateIds,
} from "./assembly-integrity-verification-authority.ts";

export function assemblyIntegrityEvaluationGateClaimIssue(
  project: EngineeringProjectSnapshot,
  work: EngineeringWorkItem,
): string | undefined {
  const claims = work.gateClaims;
  if (claims === undefined || claims.length === 0) return undefined;
  const eligibleGateIds = new Set(
    currentApprovedAssemblyIntegrityVerificationGateIds(project),
  );
  const claimedGateIds = new Set<string>();
  for (const claim of claims) {
    if (claimedGateIds.has(claim.gateItemId)) {
      return "L4 may claim each current Brief V2 gate at most once.";
    }
    claimedGateIds.add(claim.gateItemId);
    if (
      claim.role !== "contributes-to" || claim.status !== "current" ||
      !eligibleGateIds.has(claim.gateItemId)
    ) {
      return "L4 may retain only current contributes-to claims targeting current approved Brief V2 assembly-integrity verification activities.";
    }
  }
  return undefined;
}
