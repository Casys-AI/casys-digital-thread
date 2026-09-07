/**
 * Read-only comparison of a requirements capture's durable brief clauses with
 * a caller-supplied current approved brief.
 *
 * This is source impact, not requirement validity: a changed clause neither
 * invalidates a requirement nor requests a rewrite, rerun, or verdict.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import type { EngineeringApprovedBriefBasis } from "../../project/engineering-project.ts";
import type {
  ProjectBriefItem,
  ProjectBriefRevision,
} from "../../project/project-brief.ts";
import {
  parseRequirementsBriefProvenance,
  type RequirementsBriefProvenance,
} from "./requirements-brief-provenance.ts";

export const REQUIREMENTS_BRIEF_TRACE_GAP = "TRACE GAP" as const;

export type RequirementsBriefSourceImpactState =
  | "unchanged"
  | "changed"
  | "removed"
  | "brief-unavailable";

/** Identity shown for the durable source revision and, separately, its current successor. */
export interface RequirementsBriefRevisionIdentity {
  readonly briefId: string;
  readonly snapshotId: string;
  readonly revision: number;
}

export interface RequirementsBriefSourceItemImpact {
  readonly sourceItemId: string;
  /** Exact immutable source clause preserved by the requirements capture. */
  readonly originalSourceItem: ProjectBriefItem;
  /** Same-id clause from the current approved brief, when it remains present. */
  readonly currentSourceItem?: ProjectBriefItem;
  readonly state: RequirementsBriefSourceImpactState;
}

export interface RequirementsBriefRequirementSourceImpact
  extends RequirementsBriefSourceItemImpact {
  /** Stable canonical requirement metric; never a display slug. */
  readonly requirementId: string;
}

export interface RequirementsBriefImpactAvailable {
  readonly status: "available";
  readonly originalBrief: RequirementsBriefRevisionIdentity & {
    readonly basis: EngineeringApprovedBriefBasis;
    readonly contentFingerprint: ContentFingerprint;
  };
  /** Omitted only when the caller has no current approved brief to compare. */
  readonly currentBrief?: RequirementsBriefRevisionIdentity;
  readonly container: RequirementsBriefSourceItemImpact;
  readonly requirements: readonly RequirementsBriefRequirementSourceImpact[];
}

export interface RequirementsBriefImpactTraceGap {
  readonly status: typeof REQUIREMENTS_BRIEF_TRACE_GAP;
  /** A current approved brief can still be named, but no historic source exists. */
  readonly currentBrief?: RequirementsBriefRevisionIdentity;
}

export type RequirementsBriefImpact =
  | RequirementsBriefImpactAvailable
  | RequirementsBriefImpactTraceGap;

export interface CompareRequirementsBriefImpactInput {
  /**
   * The sealed historical source. Its absence is literal TRACE GAP, not a
   * license to match requirement names, metrics, values, or prose.
   */
  readonly provenance?: RequirementsBriefProvenance;
  /**
   * The caller must supply the current *approved* brief only. This pure helper
   * cannot establish approval from a bare revision; that belongs to its
   * project-store reader. Omit it when the approved brief is unavailable.
   */
  readonly currentBrief?: ProjectBriefRevision;
}

/**
 * Compare source clauses solely by their exact durable item id and complete
 * stored structure. Same-id source text is never treated as a re-approval of
 * the requirement after a newer brief revision.
 */
export function compareRequirementsBriefImpact(
  input: CompareRequirementsBriefImpactInput,
): RequirementsBriefImpact {
  const currentBrief = input.currentBrief;
  const currentIdentity = currentBrief ? revisionIdentity(currentBrief) : undefined;
  if (input.provenance === undefined) {
    return deepFreeze({
      status: REQUIREMENTS_BRIEF_TRACE_GAP,
      ...(currentIdentity ? { currentBrief: currentIdentity } : {}),
    });
  }

  const provenance = parseRequirementsBriefProvenance(input.provenance);
  const currentById = new Map(
    currentBrief?.items.map((item) => [item.id, item]) ?? [],
  );
  const container = sourceItemImpact(
    provenance.container.sourceItem,
    currentById.get(provenance.container.sourceItem.id),
    currentBrief !== undefined,
  );
  const requirements = provenance.requirements.map((entry) => ({
    requirementId: entry.requirementId,
    ...sourceItemImpact(
      entry.sourceItem,
      currentById.get(entry.sourceItem.id),
      currentBrief !== undefined,
    ),
  }));

  return deepFreeze({
    status: "available",
    originalBrief: {
      ...revisionIdentityFromBasis(provenance.briefBasis),
      basis: structuredClone(provenance.briefBasis),
      contentFingerprint: structuredClone(provenance.briefContentFingerprint),
    },
    ...(currentIdentity ? { currentBrief: currentIdentity } : {}),
    container,
    requirements,
  });
}

function sourceItemImpact(
  originalSourceItem: ProjectBriefItem,
  currentSourceItem: ProjectBriefItem | undefined,
  currentBriefAvailable: boolean,
): RequirementsBriefSourceItemImpact {
  const original = structuredClone(originalSourceItem);
  const current = currentSourceItem && structuredClone(currentSourceItem);
  return {
    sourceItemId: original.id,
    originalSourceItem: original,
    ...(current ? { currentSourceItem: current } : {}),
    state: currentBriefAvailable
      ? current
        ? sameProjectBriefItem(original, current) ? "unchanged" : "changed"
        : "removed"
      : "brief-unavailable",
  };
}

/** Includes every declared optional clause field, source reference and dependency. */
function sameProjectBriefItem(
  original: ProjectBriefItem,
  current: ProjectBriefItem,
): boolean {
  return deterministicJson(original) === deterministicJson(current);
}

function revisionIdentity(
  brief: ProjectBriefRevision,
): RequirementsBriefRevisionIdentity {
  return {
    briefId: brief.briefId,
    snapshotId: brief.id,
    revision: brief.revision,
  };
}

function revisionIdentityFromBasis(
  basis: EngineeringApprovedBriefBasis,
): RequirementsBriefRevisionIdentity {
  return {
    briefId: basis.briefId,
    snapshotId: basis.briefSnapshotId,
    revision: basis.briefRevision,
  };
}
