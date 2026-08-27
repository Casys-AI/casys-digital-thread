/**
 * Semantic authority for the bounded digital assembly-integrity method.
 *
 * This identifies verification scope in a Brief. It is intentionally separate
 * from the Build123d observer profile, any MCP tool, and any runtime image.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import type { EngineeringProjectSnapshot } from "../../project/engineering-project.ts";
import {
  projectBriefContractVersion,
  type ProjectBriefRevision,
  type ProjectBriefVerificationAuthority,
  sameProjectBriefVerificationAuthority,
} from "../../project/project-brief.ts";

export const ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY = deepFreeze(
  {
    id: "assembly-integrity",
    version: "1.0",
  } satisfies ProjectBriefVerificationAuthority,
);

export function isAssemblyIntegrityVerificationAuthority(
  authority: ProjectBriefVerificationAuthority | undefined,
): boolean {
  return authority !== undefined &&
    sameProjectBriefVerificationAuthority(
      authority,
      ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
    );
}

/**
 * Select only explicit V2 verification activities carrying the exact semantic
 * authority. The result is an ID set in canonical order; labels, dependencies
 * and product-specific identifiers have no role in this selection.
 */
export function canonicalAssemblyIntegrityVerificationGateIds(
  brief: ProjectBriefRevision,
): readonly string[] {
  if (projectBriefContractVersion(brief) !== "2.0") return deepFreeze([]);
  return deepFreeze(
    brief.items
      .filter((item) =>
        item.kind === "verification-activity" &&
        isAssemblyIntegrityVerificationAuthority(item.verificationAuthority)
      )
      .map((item) => item.id)
      .sort((left, right) => left.localeCompare(right)),
  );
}

/**
 * Read-only projection of the matching gate IDs from exactly the current
 * approved V2 Brief. An absent, mismatched or older brief yields no eligible
 * gates rather than a guessed authority.
 */
export function currentApprovedAssemblyIntegrityVerificationGateIds(
  project: Pick<EngineeringProjectSnapshot, "framing">,
): readonly string[] {
  const brief = project.framing?.currentBrief;
  const approval = project.framing?.currentBriefApproval;
  if (
    !brief || !approval || approval.status !== "approved" ||
    approval.briefSnapshotId !== brief.id ||
    approval.briefRevision !== brief.revision
  ) {
    return deepFreeze([]);
  }
  return canonicalAssemblyIntegrityVerificationGateIds(brief);
}
