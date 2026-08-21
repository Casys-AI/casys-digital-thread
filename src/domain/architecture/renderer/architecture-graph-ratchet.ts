/**
 * Pure predecessor / proposal / live SysML architecture ratchet.
 *
 * Inputs are already-parsed PartDefinition, PartUsage and AttributeUsage
 * projections. The live capture schema still seals AttributeUsage as an
 * identity/owner/label handle only; this module does not invent type, value
 * or unit fields.
 */

import type {
  AdoptedItem,
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingAttribute,
  ExistingPartDef,
} from "./architecture-proposal.ts";

export type ArchitectureGraphRatchetSubject =
  | "Package"
  | "PartDefinition"
  | "PartUsage"
  | "AttributeUsage";

export type ArchitectureGraphRatchetFailureCode =
  | "predecessor_package_replaced"
  | "predecessor_part_definition_duplicate_id"
  | "predecessor_part_usage_duplicate_id"
  | "predecessor_attribute_usage_duplicate_id"
  | "predecessor_part_definition_ambiguous_label"
  | "live_part_definition_ambiguous_identity"
  | "live_semantic_id_duplicate"
  | "live_part_definition_unreviewed_or_replaced"
  | "predecessor_part_definition_replaced"
  | "live_part_usage_duplicate_id"
  | "predecessor_part_usage_replaced"
  | "live_part_usage_ambiguous"
  | "live_part_usage_unreviewed"
  | "proposal_part_usage_missing"
  | "live_attribute_usage_invalid"
  | "predecessor_attribute_usage_replaced_or_moved"
  | "live_attribute_usage_unreviewed"
  | "predecessor_attribute_usage_removed"
  | "proposal_attribute_usage_missing"
  | "live_part_definition_ambiguous_label"
  | "proposal_system_part_definition_missing"
  | "proposal_component_part_definition_missing"
  | "proposal_parent_part_definition_missing"
  | "live_part_usage_label_ambiguous"
  | "proposal_part_usage_absent_under_parent"
  | "live_part_usage_wrong_target"
  | "adopted_part_definition_removed";

export interface ArchitectureGraphRatchetAccepted {
  readonly status: "accepted";
}

export interface ArchitectureGraphRatchetRejected {
  readonly status: "rejected";
  readonly code: ArchitectureGraphRatchetFailureCode;
  readonly subject: ArchitectureGraphRatchetSubject;
  readonly context: Readonly<Record<string, unknown>>;
  readonly message: string;
}

export type ArchitectureGraphRatchetResult =
  | ArchitectureGraphRatchetAccepted
  | ArchitectureGraphRatchetRejected;

export interface ArchitectureGraphRatchetInput {
  readonly predecessor?: ExistingArchitectureStructure;
  readonly proposal: ArchitectureProposal;
  readonly live: ExistingArchitectureStructure;
}

export interface ArchitecturePresenceInput {
  readonly live: ExistingArchitectureStructure | undefined;
  readonly proposal: ArchitectureProposal;
  readonly adopted: readonly AdoptedItem[];
}

/**
 * Compare attested predecessor PartDefinitions/PartUsages/AttributeUsages,
 * the reviewed proposal, and the live readback. Fail-closed: the first
 * invariant violation is the result.
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

  if (
    predecessor &&
    (live.packageId !== predecessor.packageId ||
      live.packageLabel !== predecessor.packageLabel)
  ) {
    return reject(
      "predecessor_package_replaced",
      "Package",
      "Verification failed: the attested predecessor Package was replaced or removed.",
      {
        predecessorPackageId: predecessor.packageId,
        predecessorPackageLabel: predecessor.packageLabel,
        livePackageId: live.packageId,
        livePackageLabel: live.packageLabel,
      },
    );
  }

  // Definition labels are a multiset: a Set would silently admit a duplicate
  // inherited PartDef.  The predecessor's provider ID remains authoritative.
  const predecessorById = new Map<string, ExistingPartDef>();
  const predecessorLabels = new Map<string, number>();
  const predecessorUsageIds = new Set<string>();
  const predecessorAttributeIds = new Set<string>();
  const inheritedAttributes = new Map<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >();
  const inheritedEdges = new Map<string, number>();
  for (const part of predecessor?.partDefs ?? []) {
    if (predecessorById.has(part.id)) {
      return reject(
        "predecessor_part_definition_duplicate_id",
        "PartDefinition",
        "Verification failed: the predecessor capture repeats a PartDefinition identity.",
        { id: part.id, label: part.label },
      );
    }
    predecessorById.set(part.id, part);
    increment(predecessorLabels, part.label);
    for (const usage of part.usages) {
      if (predecessorUsageIds.has(usage.id as string)) {
        return reject(
          "predecessor_part_usage_duplicate_id",
          "PartUsage",
          "Verification failed: the predecessor capture repeats a PartUsage identity.",
          { id: usage.id, label: usage.label, parentId: part.id },
        );
      }
      predecessorUsageIds.add(usage.id as string);
      increment(inheritedEdges, edgeKey(part.label, usage.label, usage.targetLabel));
    }
    for (const attribute of attributesOf(part)) {
      if (predecessorAttributeIds.has(attribute.id as string)) {
        return reject(
          "predecessor_attribute_usage_duplicate_id",
          "AttributeUsage",
          "Verification failed: the predecessor capture repeats an AttributeUsage identity.",
          { id: attribute.id, label: attribute.label, parentId: part.id },
        );
      }
      predecessorAttributeIds.add(attribute.id as string);
      inheritedAttributes.set(attribute.id as string, {
        id: attribute.id as string,
        label: attribute.label,
        parentId: part.id,
        parentLabel: part.label,
      });
    }
  }
  if ([...predecessorLabels.values()].some((count) => count !== 1)) {
    return reject(
      "predecessor_part_definition_ambiguous_label",
      "PartDefinition",
      "Verification failed: the predecessor capture has ambiguous PartDefinition labels.",
      { labels: [...predecessorLabels.entries()] },
    );
  }

  const expectedDefinitionLabels = new Map(predecessorLabels);
  for (
    const label of [
      proposal.system.name,
      ...proposal.components.map((component) => component.name),
    ]
  ) {
    if (!expectedDefinitionLabels.has(label)) expectedDefinitionLabels.set(label, 1);
  }
  const expectedNewEdges = new Map<string, number>();
  for (const component of proposal.components) {
    const key = edgeKey(
      component.parentName,
      component.usageName,
      component.name,
    );
    if (!inheritedEdges.has(key)) increment(expectedNewEdges, key);
  }

  const actualById = new Map<string, ExistingPartDef>();
  const actualSemanticIds = new Set<string>([live.packageId]);
  const actualLabels = new Map<string, number>();
  for (const part of live.partDefs) {
    if (!isPartDefinitionKind(part.kind ?? "")) {
      return reject(
        "live_part_definition_ambiguous_identity",
        "PartDefinition",
        "Verification failed: live architecture has an ambiguous PartDefinition identity.",
        { id: part.id, label: part.label, kind: part.kind },
      );
    }
    if (actualSemanticIds.has(part.id)) {
      return reject(
        "live_semantic_id_duplicate",
        "PartDefinition",
        "Verification failed: live architecture repeats a semantic identity across its Package, PartDefinitions, or PartUsages.",
        { id: part.id, label: part.label },
      );
    }
    actualSemanticIds.add(part.id);
    actualById.set(part.id, part);
    increment(actualLabels, part.label);
  }
  if (
    actualLabels.size !== expectedDefinitionLabels.size ||
    [...expectedDefinitionLabels].some(([label, count]) =>
      actualLabels.get(label) !== count
    )
  ) {
    return reject(
      "live_part_definition_unreviewed_or_replaced",
      "PartDefinition",
      "Verification failed: live architecture contains an unreviewed PartDefinition addition, removal, replacement, or duplicate.",
      {
        expected: [...expectedDefinitionLabels.entries()],
        actual: [...actualLabels.entries()],
      },
    );
  }

  // Every inherited definition and occurrence must survive with its exact
  // provider identity.  Distinct legitimate occurrences of one target PartDef
  // remain distinct because this compares occurrence IDs, never target sets.
  for (const prior of predecessor?.partDefs ?? []) {
    const livePart = actualById.get(prior.id);
    if (!livePart || livePart.label !== prior.label) {
      return reject(
        "predecessor_part_definition_replaced",
        "PartDefinition",
        "Verification failed: an attested predecessor PartDefinition was replaced or removed.",
        { id: prior.id, label: prior.label },
      );
    }
    const liveUsageById = new Map(
      livePart.usages.map((usage) => [usage.id, usage]),
    );
    if (liveUsageById.size !== livePart.usages.length) {
      return reject(
        "live_part_usage_duplicate_id",
        "PartUsage",
        "Verification failed: live architecture repeats a PartUsage identity.",
        { parentId: livePart.id, parentLabel: livePart.label },
      );
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
        return reject(
          "predecessor_part_usage_replaced",
          "PartUsage",
          "Verification failed: an attested predecessor PartUsage was replaced or removed.",
          {
            id: priorUsage.id,
            label: priorUsage.label,
            parentId: prior.id,
          },
        );
      }
    }
  }

  const remainingNewEdges = new Map(expectedNewEdges);
  for (const part of live.partDefs) {
    for (const usage of part.usages) {
      if (
        typeof usage.id !== "string" || typeof usage.targetId !== "string" ||
        typeof usage.targetLabel !== "string" ||
        !isPartUsageKind(usage.kind ?? "") ||
        !isPartDefinitionKind(usage.targetKind ?? "") ||
        actualById.get(usage.targetId)?.label !== usage.targetLabel
      ) {
        return reject(
          "live_part_usage_ambiguous",
          "PartUsage",
          "Verification failed: live architecture has an invalid or ambiguous PartUsage occurrence.",
          {
            id: usage.id,
            label: usage.label,
            parentId: part.id,
            targetId: usage.targetId,
            targetLabel: usage.targetLabel,
          },
        );
      }
      const usageId = usage.id!;
      if (actualSemanticIds.has(usageId)) {
        return reject(
          "live_semantic_id_duplicate",
          "PartUsage",
          "Verification failed: live architecture repeats a semantic identity across its Package, PartDefinitions, or PartUsages.",
          { id: usageId, label: usage.label, parentId: part.id },
        );
      }
      actualSemanticIds.add(usageId);
      if (predecessorUsageIds.has(usageId)) continue;
      const key = edgeKey(part.label, usage.label, usage.targetLabel);
      const remaining = remainingNewEdges.get(key) ?? 0;
      if (remaining <= 0) {
        return reject(
          "live_part_usage_unreviewed",
          "PartUsage",
          "Verification failed: live architecture contains an unreviewed PartUsage occurrence outside the attested predecessor plus proposal graph.",
          {
            id: usageId,
            label: usage.label,
            parentLabel: part.label,
            targetLabel: usage.targetLabel,
          },
        );
      }
      remainingNewEdges.set(key, remaining - 1);
    }
  }
  if ([...remainingNewEdges.values()].some((count) => count !== 0)) {
    return reject(
      "proposal_part_usage_missing",
      "PartUsage",
      "Verification failed: a proposal PartUsage occurrence is absent from live architecture.",
      { remaining: [...remainingNewEdges.entries()] },
    );
  }

  // AttributeUsage is part of the attested architecture graph too. Preserve
  // every inherited provider identity exactly, and permit only one fresh
  // attribute for each reviewed proposal name/owner pair not already inherited.
  const attributeKey = (parent: string, label: string) => `${parent}\u0000${label}`;
  const inheritedAttributeKeys = new Set(
    [...inheritedAttributes.values()].map((attribute) =>
      attributeKey(attribute.parentLabel, attribute.label)
    ),
  );
  const expectedNewAttributes = new Map<string, number>();
  for (const attribute of proposal.attributes ?? []) {
    const key = attributeKey(attribute.parentName, attribute.name);
    if (!inheritedAttributeKeys.has(key)) {
      increment(expectedNewAttributes, key);
    }
  }

  const actualAttributeIds = new Set<string>();
  const observedNewAttributes = new Map<string, number>();
  for (const part of live.partDefs) {
    for (const attribute of attributesOf(part)) {
      const attributeId = attribute.id;
      if (typeof attributeId !== "string" || attributeId.length === 0) {
        return reject(
          "live_attribute_usage_invalid",
          "AttributeUsage",
          "Verification failed: live architecture has an invalid or repeated AttributeUsage identity.",
          { label: attribute.label, parentId: part.id },
        );
      }
      const exactAttributeId = attributeId as string;
      if (
        !isAttributeUsageKind(attribute.kind ?? "") ||
        actualSemanticIds.has(exactAttributeId) ||
        actualAttributeIds.has(exactAttributeId)
      ) {
        return reject(
          "live_attribute_usage_invalid",
          "AttributeUsage",
          "Verification failed: live architecture has an invalid or repeated AttributeUsage identity.",
          { id: exactAttributeId, label: attribute.label, parentId: part.id },
        );
      }
      actualAttributeIds.add(exactAttributeId);
      actualSemanticIds.add(exactAttributeId);
      const inherited = inheritedAttributes.get(exactAttributeId);
      if (inherited !== undefined) {
        if (
          inherited.label !== attribute.label ||
          inherited.parentId !== part.id ||
          inherited.parentLabel !== part.label
        ) {
          return reject(
            "predecessor_attribute_usage_replaced_or_moved",
            "AttributeUsage",
            "Verification failed: an attested predecessor AttributeUsage was replaced or moved.",
            {
              id: exactAttributeId,
              label: attribute.label,
              parentId: part.id,
              inheritedParentId: inherited.parentId,
            },
          );
        }
        continue;
      }
      const key = attributeKey(part.label, attribute.label);
      if (inheritedAttributeKeys.has(key)) {
        return reject(
          "predecessor_attribute_usage_replaced_or_moved",
          "AttributeUsage",
          "Verification failed: an attested predecessor AttributeUsage was replaced or moved.",
          { id: exactAttributeId, label: attribute.label, parentLabel: part.label },
        );
      }
      const expected = expectedNewAttributes.get(key) ?? 0;
      if (expected <= 0) {
        return reject(
          "live_attribute_usage_unreviewed",
          "AttributeUsage",
          "Verification failed: live architecture contains an unreviewed AttributeUsage outside the attested predecessor plus proposal graph.",
          { id: exactAttributeId, label: attribute.label, parentLabel: part.label },
        );
      }
      observedNewAttributes.set(key, (observedNewAttributes.get(key) ?? 0) + 1);
    }
  }

  for (const inherited of inheritedAttributes.values()) {
    if (!actualAttributeIds.has(inherited.id)) {
      return reject(
        "predecessor_attribute_usage_removed",
        "AttributeUsage",
        "Verification failed: an attested predecessor AttributeUsage was replaced or removed.",
        {
          id: inherited.id,
          label: inherited.label,
          parentId: inherited.parentId,
        },
      );
    }
  }
  for (const [key, expected] of expectedNewAttributes) {
    if (observedNewAttributes.get(key) !== expected) {
      return reject(
        "proposal_attribute_usage_missing",
        "AttributeUsage",
        "Verification failed: a proposal AttributeUsage is absent from live architecture.",
        { key, expected, observed: observedNewAttributes.get(key) },
      );
    }
  }

  return { status: "accepted" };
}

/**
 * Post-insertion presence of the reviewed system, PartDefinitions, PartUsages
 * and previously adopted components. Distinct from the predecessor ratchet:
 * this speaks proposal labels, not inherited provider identities.
 */
export function verifyProposedArchitecturePresence(
  input: ArchitecturePresenceInput,
): ArchitectureGraphRatchetResult {
  const { live, proposal, adopted } = input;
  if (!live) return { status: "accepted" };

  // PARTIEL — re-check for ambiguous PartDef labels that could have appeared
  // after the preflight (e.g. from a concurrent insertion). `new Map(pairs)`
  // silently picks the last entry for a duplicate key, making every subsequent
  // parent→usage→cible triple underdetermined. Reject explicitly.
  const labelCounts = new Map<string, number>();
  for (const pd of live.partDefs) {
    labelCounts.set(pd.label, (labelCounts.get(pd.label) ?? 0) + 1);
  }
  const duplicates = [...labelCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label);
  if (duplicates.length > 0) {
    return reject(
      "live_part_definition_ambiguous_label",
      "PartDefinition",
      `Verification failed: ambiguous PartDefinition labels after insertion: ` +
        `${duplicates.join(", ")}. Manual SysON inspection required.`,
      { labels: duplicates },
    );
  }

  const presentByLabel = new Map(live.partDefs.map((pd) => [pd.label, pd]));

  // System must be present.
  if (!presentByLabel.has(proposal.system.name)) {
    return reject(
      "proposal_system_part_definition_missing",
      "PartDefinition",
      `Verification failed: system PartDef "${proposal.system.name}" is absent after insertion.`,
      { name: proposal.system.name },
    );
  }

  // Finding 1 — verify the FULL parent→usage→cible structure, not just PartDef
  // existence. A wrong type (e.g. `wing : Motor` instead of `wing : Wing`) or
  // a usage under the wrong parent must be rejected as a structural divergence.
  for (const component of proposal.components) {
    const componentDef = presentByLabel.get(component.name);
    if (!componentDef) {
      return reject(
        "proposal_component_part_definition_missing",
        "PartDefinition",
        `Verification failed: component PartDef "${component.name}" is absent after insertion.`,
        { name: component.name },
      );
    }
    const parentDef = presentByLabel.get(component.parentName);
    if (!parentDef) {
      return reject(
        "proposal_parent_part_definition_missing",
        "PartDefinition",
        `Verification failed: parent PartDef "${component.parentName}" for component ` +
          `"${component.name}" is absent after insertion.`,
        { parentName: component.parentName, name: component.name },
      );
    }
    const usagesWithProposedName = parentDef.usages.filter(
      (u) => u.label === component.usageName,
    );
    if (usagesWithProposedName.length > 1) {
      return reject(
        "live_part_usage_label_ambiguous",
        "PartUsage",
        `Verification failed: usage "${component.usageName}" appears ` +
          `${usagesWithProposedName.length} times under "${component.parentName}". ` +
          "A unique parent→usage→target relationship is required.",
        {
          usageName: component.usageName,
          parentName: component.parentName,
          count: usagesWithProposedName.length,
        },
      );
    }
    const matchingUsage = usagesWithProposedName[0];
    if (!matchingUsage) {
      return reject(
        "proposal_part_usage_absent_under_parent",
        "PartUsage",
        `Verification failed: usage "${component.usageName}" is absent under ` +
          `"${component.parentName}" after insertion of component "${component.name}".`,
        {
          usageName: component.usageName,
          parentName: component.parentName,
          name: component.name,
        },
      );
    }
    if (matchingUsage.targetLabel !== component.name) {
      return reject(
        "live_part_usage_wrong_target",
        "PartUsage",
        `Verification failed: usage "${component.usageName}" under "${component.parentName}" ` +
          `types "${matchingUsage.targetLabel}" instead of the proposed "${component.name}".`,
        {
          usageName: component.usageName,
          parentName: component.parentName,
          targetLabel: matchingUsage.targetLabel,
          proposed: component.name,
        },
      );
    }
  }

  // Previously adopted components must still be present.
  for (const adoptedItem of adopted) {
    if (!presentByLabel.has(adoptedItem.componentName)) {
      return reject(
        "adopted_part_definition_removed",
        "PartDefinition",
        `Verification failed: previously-adopted component "${adoptedItem.componentName}" ` +
          "was removed from the model during this run.",
        { componentName: adoptedItem.componentName },
      );
    }
  }

  return { status: "accepted" };
}

function attributesOf(
  part: ExistingPartDef,
): readonly ExistingAttribute[] {
  return part.attributes ?? [];
}

function reject(
  code: ArchitectureGraphRatchetFailureCode,
  subject: ArchitectureGraphRatchetSubject,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): ArchitectureGraphRatchetRejected {
  return { status: "rejected", code, subject, context, message };
}

function isPartDefinitionKind(kind: string): boolean {
  return kind === "PartDefinition" || kind === "sysml::PartDefinition" ||
    kind.endsWith("entity=PartDefinition");
}

function isPartUsageKind(kind: string): boolean {
  return kind === "PartUsage" || kind === "sysml::PartUsage" ||
    kind.endsWith("entity=PartUsage");
}

function isAttributeUsageKind(kind: string): boolean {
  return kind === "AttributeUsage" || kind === "sysml::AttributeUsage" ||
    kind.endsWith("entity=AttributeUsage");
}
