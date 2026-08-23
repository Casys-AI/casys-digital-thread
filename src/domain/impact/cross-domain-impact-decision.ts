/**
 * Pure recross of X07/X08 proposed gate-claim statuses onto existing work-item
 * claims. X07/X08 capture limits keep workItemInvalidations and rerunProposals
 * as `none`; this module never invents a work item, changes work-item
 * lifecycle, queues a rerun, or calls a provider.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import type {
  EngineeringGateClaimRole,
  EngineeringGateClaimStatus,
  EngineeringWorkItem,
} from "../project/engineering-project.ts";
import type { CrossDomainImpactGateMap } from "./cross-domain-impact-manifest.ts";
import {
  CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES,
  type CrossDomainImpactGateClaimStatus,
} from "./cross-domain-impact-evaluation.ts";

const GATE_ROLES = ["contributes-to", "satisfies"] as const;

export interface CrossDomainImpactProposedGateClaim {
  readonly gateItemId: string;
  readonly role: EngineeringGateClaimRole;
  readonly status: CrossDomainImpactGateClaimStatus;
}

export interface CrossDomainImpactWorkItemClaimTransition {
  readonly workItemId: string;
  readonly gateItemId: string;
  readonly role: EngineeringGateClaimRole;
  readonly previousStatus: EngineeringGateClaimStatus;
  readonly status: CrossDomainImpactGateClaimStatus;
}

export interface CrossDomainImpactResolvedWorkItemGateClaim {
  readonly workItemId: string;
  readonly gateItemId: string;
  readonly role: EngineeringGateClaimRole;
  readonly status: EngineeringGateClaimStatus;
}

/**
 * Resolve each manifest gateMap target onto exactly one current work-item
 * gate claim. Missing, role-mismatched, or duplicate coverage is refused.
 * This does not invent, rename, or attach a claim.
 */
export function recrossCrossDomainImpactManifestGateMap(
  workItems: readonly EngineeringWorkItem[],
  gateMap: readonly Pick<CrossDomainImpactGateMap, "gateItemId" | "role">[],
  options: { readonly excludeWorkItemId?: string } = {},
): readonly CrossDomainImpactResolvedWorkItemGateClaim[] {
  if (gateMap.length === 0) {
    throw new TypeError(
      "$manifest.gateMap must recross at least one work-item gate claim.",
    );
  }
  const resolved = gateMap.map((gate) =>
    uniqueWorkItemGateClaim(workItems, gate, options)
  );
  return deepFreeze(resolved);
}

/**
 * Map each proposed gate-claim onto exactly one existing work-item claim.
 * Missing, role-mismatched, or duplicate coverage is refused.
 */
export function recrossCrossDomainImpactWorkItemClaims(
  workItems: readonly EngineeringWorkItem[],
  gateClaims: readonly CrossDomainImpactProposedGateClaim[],
  options: { readonly excludeWorkItemId?: string } = {},
): readonly CrossDomainImpactWorkItemClaimTransition[] {
  if (gateClaims.length === 0) {
    throw new TypeError(
      "$impactDecision.workItemClaims must recross at least one proposed gate claim.",
    );
  }
  const transitions = gateClaims.map((claim, index) => {
    let resolved: CrossDomainImpactResolvedWorkItemGateClaim;
    try {
      resolved = uniqueWorkItemGateClaim(workItems, claim, options);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TypeError(
        `$impactDecision.workItemClaims[${index}] ${detail}`,
      );
    }
    return {
      workItemId: resolved.workItemId,
      gateItemId: resolved.gateItemId,
      role: resolved.role,
      previousStatus: resolved.status,
      status: claim.status,
    };
  });
  return deepFreeze(
    [...transitions].sort((left, right) =>
      workItemClaimKey(left).localeCompare(workItemClaimKey(right))
    ),
  );
}

function uniqueWorkItemGateClaim(
  workItems: readonly EngineeringWorkItem[],
  target: { readonly gateItemId: string; readonly role: EngineeringGateClaimRole },
  options: { readonly excludeWorkItemId?: string } = {},
): CrossDomainImpactResolvedWorkItemGateClaim {
  const excluded = options.excludeWorkItemId;
  const matches: CrossDomainImpactResolvedWorkItemGateClaim[] = [];
  const sameGate: string[] = [];
  for (const workItem of workItems) {
    if (excluded !== undefined && workItem.id === excluded) continue;
    for (const existing of workItem.gateClaims ?? []) {
      if (existing.gateItemId !== target.gateItemId) continue;
      sameGate.push(workItem.id);
      if (existing.role !== target.role) continue;
      matches.push({
        workItemId: workItem.id,
        gateItemId: existing.gateItemId,
        role: existing.role,
        status: existing.status,
      });
    }
  }
  const gateItemId = JSON.stringify(target.gateItemId);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new TypeError(
      `gateItemId ${gateItemId} is an ambiguous work-item gate claim.`,
    );
  }
  if (sameGate.length > 0) {
    throw new TypeError(
      `gateItemId ${gateItemId} is a mismatched work-item gate claim.`,
    );
  }
  throw new TypeError(
    `gateItemId ${gateItemId} is a missing work-item gate claim.`,
  );
}

/** Canonical, closed work-item claim-transition list signed by the MRTR. */
export function canonicalizeCrossDomainImpactWorkItemClaims(
  value: unknown,
): readonly CrossDomainImpactWorkItemClaimTransition[] {
  const items = arrayOf(value, "$impactDecision.workItemClaims").map(
    (item, index) =>
      parseWorkItemClaim(item, `$impactDecision.workItemClaims[${index}]`),
  );
  if (items.length === 0) {
    throw new TypeError("$impactDecision.workItemClaims must not be empty.");
  }
  rejectDuplicates(
    items.map(workItemClaimKey),
    "$impactDecision.workItemClaims identities",
  );
  const ordered = [...items].sort((left, right) =>
    workItemClaimKey(left).localeCompare(workItemClaimKey(right))
  );
  if (deterministicJson(ordered) !== deterministicJson(items)) {
    throw new TypeError(
      "$impactDecision.workItemClaims must use canonical stable ordering.",
    );
  }
  return deepFreeze(ordered);
}

/**
 * Apply already-recrossed transitions onto cloned work items. The current
 * claim must still equal `previousStatus`.
 */
export function applyCrossDomainImpactWorkItemClaims(
  workItems: readonly EngineeringWorkItem[],
  transitions: readonly CrossDomainImpactWorkItemClaimTransition[],
  options: { readonly excludeWorkItemId?: string } = {},
): readonly EngineeringWorkItem[] {
  const expected = canonicalizeCrossDomainImpactWorkItemClaims(transitions);
  const recrossed = recrossCrossDomainImpactWorkItemClaims(
    workItems,
    expected.map((item) => ({
      gateItemId: item.gateItemId,
      role: item.role,
      status: item.status,
    })),
    options,
  );
  if (deterministicJson(recrossed) !== deterministicJson(expected)) {
    throw new TypeError(
      "Current work-item gate claims do not equal the signed impact-decision recross.",
    );
  }
  const next = workItems.map((workItem) => {
    const claimed = expected.filter((item) => item.workItemId === workItem.id);
    if (claimed.length === 0) return workItem;
    if (workItem.gateClaims === undefined) {
      throw new TypeError(
        `Work item ${workItem.id} has no gate claims for the signed impact decision.`,
      );
    }
    return {
      ...workItem,
      gateClaims: workItem.gateClaims.map((claim) => {
        const transition = claimed.find((item) =>
          item.gateItemId === claim.gateItemId && item.role === claim.role
        );
        if (!transition) return claim;
        return { ...claim, status: transition.status };
      }),
    };
  });
  return deepFreeze(next);
}

function parseWorkItemClaim(
  value: unknown,
  path: string,
): CrossDomainImpactWorkItemClaimTransition {
  const input = exactRecord(
    value,
    ["workItemId", "gateItemId", "role", "previousStatus", "status"],
    path,
  );
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!GATE_ROLES.includes(role as EngineeringGateClaimRole)) {
    throw new TypeError(`${path}.role must be contributes-to or satisfies.`);
  }
  return {
    workItemId: safeId(input.workItemId, `${path}.workItemId`),
    gateItemId: safeId(input.gateItemId, `${path}.gateItemId`),
    role: role as EngineeringGateClaimRole,
    previousStatus: parseGateStatus(input.previousStatus, `${path}.previousStatus`),
    status: parseImpactStatus(input.status, `${path}.status`),
  };
}

function parseGateStatus(value: unknown, path: string): EngineeringGateClaimStatus {
  const status = nonEmptyText(value, path);
  if (
    !CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES.includes(
      status as CrossDomainImpactGateClaimStatus,
    )
  ) {
    throw new TypeError(`${path} must be a declared gate-link status.`);
  }
  return status as EngineeringGateClaimStatus;
}

function parseImpactStatus(
  value: unknown,
  path: string,
): CrossDomainImpactGateClaimStatus {
  return parseGateStatus(value, path) as CrossDomainImpactGateClaimStatus;
}

function workItemClaimKey(value: CrossDomainImpactWorkItemClaimTransition): string {
  return `${value.workItemId}:${value.gateItemId}:${value.role}`;
}
