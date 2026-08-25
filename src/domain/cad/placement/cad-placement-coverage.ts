/**
 * Exact immediate-PartUsage coverage and typed_by recross.
 *
 * Missing or extra mappings stay unresolved. Array order and labels never
 * fill a hole. The server-derived owner and typed definitions come from the
 * architecture navigation index, not from the JSON.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import type { ProductStructureElementRef } from "../../architecture/product-structure-ref.ts";
import type { CadImmediatePlacementSource } from "./cad-immediate-placement-source.ts";

export type CadPlacementCoverageGapRelation =
  | "owner"
  | "placement"
  | "attachment"
  | "typed_by"
  | "architecture";

export interface CadPlacementCoverageGap {
  readonly name: string;
  readonly relation: CadPlacementCoverageGapRelation;
  readonly recovery: string;
}

export type CadPlacementCoverage =
  | {
    readonly status: "resolved";
    readonly owner: ProductStructureElementRef;
    readonly usages: readonly {
      readonly usageElementId: string;
      readonly partDefinitionElementId: string;
    }[];
  }
  | {
    readonly status: "unresolved";
    readonly gaps: readonly CadPlacementCoverageGap[];
  };

export interface CadPlacementArchitectureFacts {
  readonly ownerDefinitionId: (usageId: string) => string | undefined;
  readonly immediateUsageIds: (definitionId: string) => readonly string[];
  readonly typedDefinitionId: (usageId: string) => string | undefined;
}

export function assessCadPlacementCoverage(input: {
  readonly source: CadImmediatePlacementSource;
  readonly attachedUsageIds: readonly string[];
  readonly architecture: CadPlacementArchitectureFacts;
}): CadPlacementCoverage {
  const sourceIds = input.source.placements.map((entry) => entry.usageElementId);
  const attached = uniqueSorted(input.attachedUsageIds);
  const sourceSet = new Set(sourceIds);
  const attachedSet = new Set(attached);
  const gaps: CadPlacementCoverageGap[] = [];

  for (const usageId of duplicateIds(input.attachedUsageIds)) {
    gaps.push({
      name: usageId,
      relation: "attachment",
      recovery:
        "Keep exactly one active same-file placement attachment for this PartUsage.",
    });
  }

  for (const usageId of attached) {
    if (!sourceSet.has(usageId)) {
      gaps.push({
        name: usageId,
        relation: "placement",
        recovery:
          "Author an exact JSON placement for this attached PartUsage. Array order cannot fill it.",
      });
    }
  }
  for (const usageId of sourceIds) {
    if (!attachedSet.has(usageId)) {
      gaps.push({
        name: usageId,
        relation: "attachment",
        recovery:
          "Attach the same cad-placement-source file with design-source@1 to this exact PartUsage.",
      });
    }
  }

  const owners = new Set<string>();
  for (const usageId of attached) {
    const owner = input.architecture.ownerDefinitionId(usageId);
    if (owner === undefined) {
      gaps.push({
        name: usageId,
        relation: "owner",
        recovery:
          "The architecture navigation index must name the exact owner PartDefinition of this usage.",
      });
      continue;
    }
    owners.add(owner);
  }
  if (owners.size > 1) {
    gaps.push({
      name: "common-owner",
      relation: "owner",
      recovery:
        "Every same-file placement attachment must name an immediate PartUsage of one owner PartDefinition.",
    });
  }
  const ownerId = owners.size === 1 ? [...owners][0] : undefined;
  if (ownerId !== undefined) {
    const immediate = uniqueSorted(input.architecture.immediateUsageIds(ownerId));
    const immediateSet = new Set(immediate);
    for (const usageId of immediate) {
      if (!sourceSet.has(usageId) || !attachedSet.has(usageId)) {
        gaps.push({
          name: usageId,
          relation: "placement",
          recovery:
            "The JSON entries, same-file attachments and immediate owner usages must be exactly equal.",
        });
      }
    }
    for (const usageId of sourceIds) {
      if (!immediateSet.has(usageId)) {
        gaps.push({
          name: usageId,
          relation: "owner",
          recovery:
            "A placement entry that is not an immediate child of the common owner stays unresolved.",
        });
      }
    }
  } else if (attached.length === 0) {
    gaps.push({
      name: "common-owner",
      relation: "owner",
      recovery:
        "At least one exact immediate PartUsage attachment is required to derive the owner.",
    });
  }

  for (const entry of input.source.placements) {
    const typed = input.architecture.typedDefinitionId(entry.usageElementId);
    if (typed === undefined) {
      gaps.push({
        name: entry.usageElementId,
        relation: "typed_by",
        recovery:
          "The architecture navigation index must recross this PartUsage to one exact PartDefinition.",
      });
      continue;
    }
    if (typed !== entry.partDefinitionElementId) {
      gaps.push({
        name: entry.usageElementId,
        relation: "typed_by",
        recovery:
          "partDefinitionElementId must equal the exact typed_by PartDefinition. Labels cannot join.",
      });
    }
  }

  if (gaps.length > 0) {
    return deepFreeze({
      status: "unresolved",
      gaps: dedupeGaps(gaps),
    });
  }
  if (ownerId === undefined) {
    return deepFreeze({
      status: "unresolved",
      gaps: [{
        name: "common-owner",
        relation: "owner",
        recovery: "The common owner PartDefinition could not be derived.",
      }],
    });
  }
  return deepFreeze({
    status: "resolved",
    owner: { elementKind: "PartDefinition", elementId: ownerId },
    usages: input.source.placements.map((entry) => ({
      usageElementId: entry.usageElementId,
      partDefinitionElementId: entry.partDefinitionElementId,
    })),
  });
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function duplicateIds(ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));
}

function dedupeGaps(
  gaps: readonly CadPlacementCoverageGap[],
): CadPlacementCoverageGap[] {
  const seen = new Set<string>();
  const unique: CadPlacementCoverageGap[] = [];
  for (const gap of gaps) {
    const key = `${gap.relation}\0${gap.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(gap);
  }
  return unique.sort((left, right) =>
    left.relation.localeCompare(right.relation) ||
    left.name.localeCompare(right.name)
  );
}
