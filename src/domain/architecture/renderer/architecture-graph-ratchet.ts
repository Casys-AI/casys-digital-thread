/**
 * Predecessor / proposal / live SysML architecture ratchet.
 *
 * Inputs are already-parsed PartDefinition, PartUsage and AttributeUsage
 * projections. AttributeUsage remains an identity/owner/label handle.
 *
 * Live counts are bounded by predecessor ∪ proposal before the corresponding
 * live index is built. Closed delta types live in architecture-graph-delta.ts.
 */

import type {
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingPartDef,
} from "./architecture-proposal.ts";
import {
  ARCHITECTURE_RATCHET_MESSAGES as MSG,
  architectureDeltaItem,
  type ArchitectureGraphRatchetResult,
  buildAcceptedArchitectureDelta,
  definitionLabelDelta,
  extraOccupationKind,
  failRatchet,
  indexPredecessorArchitecture,
  inspectLiveAttributeUsages,
  isPartDefinitionKind,
  isPartUsageKind,
  occupationDelta,
  occupyingDefinition,
  occupyingUsage,
  type RankedRatchetFailure,
  rejectArchitectureGraph,
  rejectUnreviewedCardinality,
  selectedRatchetFailure,
} from "./architecture-graph-delta.ts";

export type {
  ArchitectureGraphDeltaItem,
  ArchitectureGraphDeltaKind,
  ArchitectureGraphRatchetAccepted,
  ArchitectureGraphRatchetFailureCode,
  ArchitectureGraphRatchetRejected,
  ArchitectureGraphRatchetResult,
  ArchitectureGraphRatchetSubject,
} from "./architecture-graph-delta.ts";
export { sortArchitectureGraphDelta } from "./architecture-graph-delta.ts";
export type { ArchitecturePresenceInput } from "./architecture-proposal-presence.ts";
export { verifyProposedArchitecturePresence } from "./architecture-proposal-presence.ts";

export interface ArchitectureGraphRatchetInput {
  readonly predecessor?: ExistingArchitectureStructure;
  readonly proposal: ArchitectureProposal;
  readonly live: ExistingArchitectureStructure;
}

/**
 * Compare attested predecessor PartDefinitions/PartUsages/AttributeUsages,
 * the reviewed proposal, and the live readback. Simultaneous violations in
 * one phase select by check rank, then the full canonical context.
 */
export function ratchetArchitectureGraph(
  input: ArchitectureGraphRatchetInput,
): ArchitectureGraphRatchetResult {
  const { predecessor, proposal, live } = input;
  const increment = (counts: Map<string, number>, key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const edgeKey = (parent: string, label: string, target: string) =>
    `${parent}\u0000${label}\u0000${target}`;
  const slotKey = (parent: string, label: string) => `${parent}\u0000${label}`;
  const delta = architectureDeltaItem;

  if (
    predecessor &&
    (live.packageId !== predecessor.packageId ||
      live.packageLabel !== predecessor.packageLabel)
  ) {
    return rejectArchitectureGraph(
      "predecessor_package_replaced",
      "Package",
      MSG.predPkg,
      {
        predecessorPackageId: predecessor.packageId,
        predecessorPackageLabel: predecessor.packageLabel,
        livePackageId: live.packageId,
        livePackageLabel: live.packageLabel,
      },
      [delta("Package", "replaced", {
        id: live.packageId,
        label: live.packageLabel,
      })],
    );
  }

  const indexed = indexPredecessorArchitecture(predecessor);
  if ("status" in indexed) return indexed;
  const {
    predecessorById,
    predecessorLabels,
    predecessorUsageIds,
    inheritedAttributes,
    inheritedEdges,
  } = indexed;

  const expectedDefinitionLabels = new Map(predecessorLabels);
  for (
    const label of [
      proposal.system.name,
      ...proposal.components.map((component) => component.name),
    ]
  ) {
    if (!expectedDefinitionLabels.has(label)) expectedDefinitionLabels.set(label, 1);
  }
  const expectedLabels = new Set(expectedDefinitionLabels.keys());
  const expectedNewEdges = new Map<string, number>();
  const attestedUsageSlots = new Set<string>();
  for (const [key] of inheritedEdges) {
    const sep = key.indexOf("\u0000");
    attestedUsageSlots.add(key.slice(0, key.indexOf("\u0000", sep + 1)));
  }
  const proposalUsageFacts = new Map<string, {
    parentLabel: string;
    label: string;
    targetLabel: string;
  }>();
  for (const component of proposal.components) {
    const slot = slotKey(component.parentName, component.usageName);
    if (!attestedUsageSlots.has(slot)) {
      proposalUsageFacts.set(slot, {
        parentLabel: component.parentName,
        label: component.usageName,
        targetLabel: component.name,
      });
    }
    const key = edgeKey(
      component.parentName,
      component.usageName,
      component.name,
    );
    if (!inheritedEdges.has(key)) increment(expectedNewEdges, key);
  }

  const admittedDefinitionCount = expectedDefinitionLabels.size;
  if (live.partDefs.length > admittedDefinitionCount) {
    return rejectUnreviewedCardinality(
      "PartDefinition",
      "live_part_definition_unreviewed_or_replaced",
      MSG.liveDef,
      admittedDefinitionCount,
      live.partDefs.length,
    );
  }

  const actualById = new Map<string, ExistingPartDef>();
  const actualSemanticIds = new Set<string>([live.packageId]);
  const actualLabels = new Map<string, number>();
  const liveDefsById = new Map<string, ExistingPartDef[]>();
  const liveDefinitionFailures: RankedRatchetFailure[] = [];
  for (const part of live.partDefs) {
    const group = liveDefsById.get(part.id);
    if (group) group.push(part);
    else liveDefsById.set(part.id, [part]);
    const occupying = occupyingDefinition(
      part,
      predecessorById,
      predecessorLabels,
      expectedLabels,
    );
    if (!isPartDefinitionKind(part.kind ?? "")) {
      liveDefinitionFailures.push(failRatchet(
        0,
        "live_part_definition_ambiguous_identity",
        "PartDefinition",
        MSG.liveDefKind,
        { id: part.id, label: part.label, kind: part.kind },
        occupationDelta("PartDefinition", occupying, {
          id: part.id,
          label: part.label,
        }),
      ));
    }
    actualById.set(part.id, part);
    increment(actualLabels, part.label);
  }
  for (const [id, parts] of liveDefsById) {
    if (id !== live.packageId && parts.length < 2) {
      actualSemanticIds.add(id);
      continue;
    }
    for (const part of parts) {
      liveDefinitionFailures.push(failRatchet(
        1,
        "live_semantic_id_duplicate",
        "PartDefinition",
        MSG.liveIdDup,
        { id, label: part.label },
        [delta("PartDefinition", "duplicate", { id, label: part.label })],
      ));
    }
    actualSemanticIds.add(id);
  }
  const liveDefinitionFailure = selectedRatchetFailure(liveDefinitionFailures);
  if (liveDefinitionFailure) return liveDefinitionFailure;
  if (
    actualLabels.size !== expectedDefinitionLabels.size ||
    [...expectedDefinitionLabels].some(([label, count]) =>
      actualLabels.get(label) !== count
    )
  ) {
    return rejectArchitectureGraph(
      "live_part_definition_unreviewed_or_replaced",
      "PartDefinition",
      MSG.liveDef,
      {
        expected: [...expectedDefinitionLabels.entries()],
        actual: [...actualLabels.entries()],
      },
      definitionLabelDelta(expectedDefinitionLabels, actualLabels),
    );
  }

  const replacedDefinitionFailures: RankedRatchetFailure[] = [];
  for (const prior of predecessor?.partDefs ?? []) {
    const livePart = actualById.get(prior.id);
    if (!livePart || livePart.label !== prior.label) {
      replacedDefinitionFailures.push(failRatchet(
        0,
        "predecessor_part_definition_replaced",
        "PartDefinition",
        MSG.predDefReplaced,
        { id: prior.id, label: prior.label },
        [delta("PartDefinition", "replaced", {
          id: prior.id,
          label: prior.label,
        })],
      ));
    }
  }
  const replacedDefinitionFailure = selectedRatchetFailure(
    replacedDefinitionFailures,
  );
  if (replacedDefinitionFailure) return replacedDefinitionFailure;

  const admittedUsageCount = mapTotal(inheritedEdges) + mapTotal(expectedNewEdges);
  const observedUsageCount = live.partDefs.reduce(
    (sum, part) => sum + part.usages.length,
    0,
  );
  if (observedUsageCount > admittedUsageCount) {
    return rejectUnreviewedCardinality(
      "PartUsage",
      "live_part_usage_unreviewed",
      MSG.liveUsageUnreviewed,
      admittedUsageCount,
      observedUsageCount,
    );
  }

  const inheritedUsageFailures: RankedRatchetFailure[] = [];
  for (const prior of predecessor?.partDefs ?? []) {
    const livePart = actualById.get(prior.id)!;
    const liveUsageById = new Map(
      livePart.usages.map((usage) => [usage.id, usage]),
    );
    if (liveUsageById.size !== livePart.usages.length) {
      inheritedUsageFailures.push(failRatchet(
        0,
        "live_part_usage_duplicate_id",
        "PartUsage",
        MSG.liveUsageDup,
        { parentId: livePart.id, parentLabel: livePart.label },
        [delta("PartUsage", "duplicate", {
          parentId: livePart.id,
          parentLabel: livePart.label,
        })],
      ));
    }
    for (const priorUsage of prior.usages) {
      const liveUsage = liveUsageById.get(priorUsage.id);
      if (
        !liveUsage || !isPartUsageKind(liveUsage.kind ?? "") ||
        liveUsage.label !== priorUsage.label ||
        liveUsage.targetId !== priorUsage.targetId ||
        !isPartDefinitionKind(liveUsage.targetKind ?? "") ||
        liveUsage.targetLabel !== priorUsage.targetLabel
      ) {
        inheritedUsageFailures.push(failRatchet(
          1,
          "predecessor_part_usage_replaced",
          "PartUsage",
          MSG.predUsageReplaced,
          {
            id: priorUsage.id,
            label: priorUsage.label,
            parentId: prior.id,
          },
          [delta("PartUsage", "replaced", {
            id: priorUsage.id as string,
            label: priorUsage.label,
            parentId: prior.id,
          })],
        ));
      }
    }
  }
  const inheritedUsageFailure = selectedRatchetFailure(inheritedUsageFailures);
  if (inheritedUsageFailure) return inheritedUsageFailure;

  const remainingNewEdges = new Map(expectedNewEdges);
  const liveUsageFailures: RankedRatchetFailure[] = [];
  const liveUsagesById = new Map<string, {
    id: string;
    label: string;
    parentId: string;
  }[]>();
  for (const part of live.partDefs) {
    for (const usage of part.usages) {
      const occupying = occupyingUsage(
        usage,
        part.label,
        predecessorUsageIds,
        attestedUsageSlots,
        proposalUsageFacts,
      );
      const usageContext = {
        id: usage.id,
        label: usage.label,
        parentId: part.id,
        parentLabel: part.label,
        targetId: usage.targetId,
        targetLabel: usage.targetLabel,
      };
      const invalidUsage = typeof usage.id !== "string" ||
        typeof usage.targetId !== "string" ||
        typeof usage.targetLabel !== "string" ||
        !isPartUsageKind(usage.kind ?? "") ||
        !isPartDefinitionKind(usage.targetKind ?? "") ||
        actualById.get(usage.targetId)?.label !== usage.targetLabel;
      if (typeof usage.id === "string") {
        const group = liveUsagesById.get(usage.id);
        if (group) {
          group.push({ id: usage.id, label: usage.label, parentId: part.id });
        } else {
          liveUsagesById.set(usage.id, [{
            id: usage.id,
            label: usage.label,
            parentId: part.id,
          }]);
        }
      }
      if (invalidUsage) {
        liveUsageFailures.push(failRatchet(
          0,
          "live_part_usage_ambiguous",
          "PartUsage",
          MSG.liveUsageAmbiguous,
          usageContext,
          occupationDelta("PartUsage", occupying, {
            id: typeof usage.id === "string" ? usage.id : undefined,
            label: usage.label,
            parentId: part.id,
            parentLabel: part.label,
            targetId: typeof usage.targetId === "string" ? usage.targetId : undefined,
            targetLabel: usage.targetLabel,
          }),
        ));
        continue;
      }
      const usageId = usage.id!;
      if (predecessorUsageIds.has(usageId)) continue;
      const key = edgeKey(part.label, usage.label, usage.targetLabel);
      const remaining = remainingNewEdges.get(key) ?? 0;
      if (remaining <= 0) {
        liveUsageFailures.push(failRatchet(
          2,
          "live_part_usage_unreviewed",
          "PartUsage",
          MSG.liveUsageUnreviewed,
          {
            id: usageId,
            label: usage.label,
            parentLabel: part.label,
            targetLabel: usage.targetLabel,
          },
          [delta("PartUsage", extraOccupationKind(occupying), {
            id: usageId,
            label: usage.label,
            parentId: part.id,
            parentLabel: part.label,
            targetLabel: usage.targetLabel,
          })],
        ));
        continue;
      }
      remainingNewEdges.set(key, remaining - 1);
    }
  }
  for (const [id, usages] of liveUsagesById) {
    if (actualSemanticIds.has(id) || usages.length > 1) {
      for (const usage of usages) {
        liveUsageFailures.push(failRatchet(
          1,
          "live_semantic_id_duplicate",
          "PartUsage",
          MSG.liveIdDup,
          { id, label: usage.label, parentId: usage.parentId },
          [delta("PartUsage", "duplicate", {
            id,
            label: usage.label,
            parentId: usage.parentId,
          })],
        ));
      }
    }
    actualSemanticIds.add(id);
  }
  const liveUsageFailure = selectedRatchetFailure(liveUsageFailures);
  if (liveUsageFailure) return liveUsageFailure;
  if ([...remainingNewEdges.values()].some((count) => count !== 0)) {
    return rejectArchitectureGraph(
      "proposal_part_usage_missing",
      "PartUsage",
      MSG.proposalUsageMissing,
      { remaining: [...remainingNewEdges.entries()] },
      [...remainingNewEdges.entries()]
        .filter(([, count]) => count !== 0)
        .map(([key]) => {
          const [parentLabel, label, targetLabel] = key.split("\u0000");
          return delta("PartUsage", "missing", { parentLabel, label, targetLabel });
        }),
    );
  }

  const inheritedAttrKeys = new Set(
    [...inheritedAttributes.values()].map((attribute) =>
      slotKey(attribute.parentLabel, attribute.label)
    ),
  );
  let freshAttributes = 0;
  for (const attribute of proposal.attributes ?? []) {
    if (!inheritedAttrKeys.has(slotKey(attribute.parentName, attribute.name))) {
      freshAttributes++;
    }
  }
  const admittedAttributeCount = inheritedAttributes.size + freshAttributes;
  const observedAttributeCount = live.partDefs.reduce(
    (sum, part) => sum + (part.attributes?.length ?? 0),
    0,
  );
  if (observedAttributeCount > admittedAttributeCount) {
    return rejectUnreviewedCardinality(
      "AttributeUsage",
      "live_attribute_usage_unreviewed",
      MSG.liveAttrUnreviewed,
      admittedAttributeCount,
      observedAttributeCount,
    );
  }

  const attributeFailure = inspectLiveAttributeUsages({
    live,
    proposal,
    inheritedAttributes,
    actualSemanticIds,
  });
  if (attributeFailure) return attributeFailure;

  return {
    status: "accepted",
    delta: buildAcceptedArchitectureDelta(
      predecessor,
      live,
      predecessorById,
      predecessorUsageIds,
      inheritedAttributes,
    ),
  };
}

function mapTotal(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}
