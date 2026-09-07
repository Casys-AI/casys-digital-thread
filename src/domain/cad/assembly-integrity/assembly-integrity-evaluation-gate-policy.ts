/**
 * Narrow L4 gate-claim policy and the L5 accept transform of those claims.
 *
 * L4 is evidence that may contribute to zero or more current Brief V2 gates.
 * It is never an acceptance or satisfaction authority; leaving it ungated is
 * also valid for a generic evaluation work item. L5 accept may satisfy only
 * those exact recorded L4 contributes-to claims after recrossing them against
 * the current approved Brief. Empty L4 claims stay an empty accept.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import type {
  EngineeringGateClaim,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../project/engineering-project.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-evaluation-proposal.ts";
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

/**
 * Transform the selected L4 work item's current contributes-to claims into
 * canonical satisfies/current L5 accept claims. The Brief eligible set is a
 * recross filter, not a source of invented satisfaction.
 */
export function assemblyIntegrityCloseoutAcceptGateClaims(
  project: EngineeringProjectSnapshot,
  l4Work: EngineeringWorkItem,
): readonly EngineeringGateClaim[] {
  if (
    l4Work.operation?.id !== VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id ||
    l4Work.operation.version !== VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version
  ) {
    throw new TypeError(
      "Assembly-integrity L5 accept claims may be derived only from the selected L4 evaluation work item.",
    );
  }
  const issue = assemblyIntegrityEvaluationGateClaimIssue(project, l4Work);
  if (issue !== undefined) throw new TypeError(issue);
  const ids = [...new Set((l4Work.gateClaims ?? []).map((claim) => claim.gateItemId))]
    .toSorted((left, right) => left.localeCompare(right));
  return deepFreeze(
    ids.map((gateItemId) => ({
      gateItemId,
      role: "satisfies" as const,
      status: "current" as const,
    })),
  );
}
