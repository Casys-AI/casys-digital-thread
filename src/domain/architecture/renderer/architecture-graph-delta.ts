/**
 * Closed SysML architecture delta: PartDefinition, PartUsage and AttributeUsage
 * items classified from identity and owner-scoped slots. Not a generic graph
 * library.
 */

import type {
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingAttribute,
  ExistingPartDef,
  ExistingPartUsage,
} from "./architecture-proposal.ts";
import {
  canonicalizeContext,
  compareCodeUnit,
  selectRankedFailure,
} from "./architecture-graph-selection.ts";

export type ArchitectureGraphRatchetSubject =
  | "Package"
  | "PartDefinition"
  | "PartUsage"
  | "AttributeUsage";

export type ArchitectureGraphDeltaKind =
  | "inherited_exact"
  | "reviewed_addition"
  | "missing"
  | "replaced"
  | "moved"
  | "duplicate"
  | "unreviewed";

export interface ArchitectureGraphDeltaItem {
  readonly subject: ArchitectureGraphRatchetSubject;
  readonly kind: ArchitectureGraphDeltaKind;
  readonly id?: string;
  readonly label?: string;
  readonly parentId?: string;
  readonly parentLabel?: string;
  readonly targetId?: string;
  readonly targetLabel?: string;
}

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
  readonly delta: readonly ArchitectureGraphDeltaItem[];
}

export interface ArchitectureGraphRatchetRejected {
  readonly status: "rejected";
  readonly code: ArchitectureGraphRatchetFailureCode;
  readonly subject: ArchitectureGraphRatchetSubject;
  readonly context: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly delta: readonly ArchitectureGraphDeltaItem[];
}

export type ArchitectureGraphRatchetResult =
  | ArchitectureGraphRatchetAccepted
  | ArchitectureGraphRatchetRejected;

export interface RankedRatchetFailure {
  readonly rank: number;
  readonly code: ArchitectureGraphRatchetFailureCode;
  readonly subject: ArchitectureGraphRatchetSubject;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly delta: readonly ArchitectureGraphDeltaItem[];
}

export const ARCHITECTURE_RATCHET_MESSAGES = {
  predPkg:
    "Verification failed: the attested predecessor Package was replaced or removed.",
  predDefDup:
    "Verification failed: the predecessor capture repeats a PartDefinition identity.",
  predUsageDup:
    "Verification failed: the predecessor capture repeats a PartUsage identity.",
  predAttrDup:
    "Verification failed: the predecessor capture repeats an AttributeUsage identity.",
  predDefLabel:
    "Verification failed: the predecessor capture has ambiguous PartDefinition labels.",
  liveDefKind:
    "Verification failed: live architecture has an ambiguous PartDefinition identity.",
  liveIdDup:
    "Verification failed: live architecture repeats a semantic identity across its Package, PartDefinitions, or PartUsages.",
  liveDef:
    "Verification failed: live architecture contains an unreviewed PartDefinition addition, removal, replacement, or duplicate.",
  predDefReplaced:
    "Verification failed: an attested predecessor PartDefinition was replaced or removed.",
  liveUsageDup: "Verification failed: live architecture repeats a PartUsage identity.",
  predUsageReplaced:
    "Verification failed: an attested predecessor PartUsage was replaced or removed.",
  liveUsageAmbiguous:
    "Verification failed: live architecture has an invalid or ambiguous PartUsage occurrence.",
  liveUsageUnreviewed:
    "Verification failed: live architecture contains an unreviewed PartUsage occurrence outside the attested predecessor plus proposal graph.",
  proposalUsageMissing:
    "Verification failed: a proposal PartUsage occurrence is absent from live architecture.",
  liveAttrInvalid:
    "Verification failed: live architecture has an invalid or repeated AttributeUsage identity.",
  predAttrMoved:
    "Verification failed: an attested predecessor AttributeUsage was replaced or moved.",
  liveAttrUnreviewed:
    "Verification failed: live architecture contains an unreviewed AttributeUsage outside the attested predecessor plus proposal graph.",
  predAttrRemoved:
    "Verification failed: an attested predecessor AttributeUsage was replaced or removed.",
  proposalAttrMissing:
    "Verification failed: a proposal AttributeUsage is absent from live architecture.",
} as const;

export function architectureDeltaItem(
  subject: ArchitectureGraphRatchetSubject,
  kind: ArchitectureGraphDeltaKind,
  fields: Omit<ArchitectureGraphDeltaItem, "subject" | "kind"> = {},
): ArchitectureGraphDeltaItem {
  const { id, label, parentId, parentLabel, targetId, targetLabel } = fields;
  return {
    subject,
    kind,
    ...(id !== undefined ? { id } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(parentLabel !== undefined ? { parentLabel } : {}),
    ...(targetId !== undefined ? { targetId } : {}),
    ...(targetLabel !== undefined ? { targetLabel } : {}),
  };
}

export function failRatchet(
  rank: number,
  code: ArchitectureGraphRatchetFailureCode,
  subject: ArchitectureGraphRatchetSubject,
  message: string,
  context: Readonly<Record<string, unknown>>,
  delta: readonly ArchitectureGraphDeltaItem[],
): RankedRatchetFailure {
  return { rank, code, subject, message, context, delta };
}

export type OccupiedArchitectureSlot =
  | { readonly kind: "attested"; readonly relation: "replaced" | "moved" }
  | {
    readonly kind: "proposal";
    readonly fact: Omit<ArchitectureGraphDeltaItem, "subject" | "kind">;
  }
  | { readonly kind: "none" };

/**
 * replaced/moved only when the observation occupies an attested predecessor
 * identity or owner-scoped slot. A first-time proposal slot is missing plus
 * unreviewed — never replaced.
 */
export function occupationDelta(
  subject: ArchitectureGraphRatchetSubject,
  slot: OccupiedArchitectureSlot,
  live: Omit<ArchitectureGraphDeltaItem, "subject" | "kind">,
): readonly ArchitectureGraphDeltaItem[] {
  if (slot.kind === "attested") {
    return [architectureDeltaItem(subject, slot.relation, live)];
  }
  if (slot.kind === "proposal") {
    return [
      architectureDeltaItem(subject, "missing", slot.fact),
      architectureDeltaItem(subject, "unreviewed", live),
    ];
  }
  return [architectureDeltaItem(subject, "unreviewed", live)];
}

export function extraOccupationKind(
  slot: OccupiedArchitectureSlot,
): "replaced" | "moved" | "unreviewed" {
  return slot.kind === "attested" ? slot.relation : "unreviewed";
}

export function rejectArchitectureGraph(
  code: ArchitectureGraphRatchetFailureCode,
  subject: ArchitectureGraphRatchetSubject,
  message: string,
  context: Readonly<Record<string, unknown>>,
  items: readonly ArchitectureGraphDeltaItem[],
): ArchitectureGraphRatchetRejected {
  return {
    status: "rejected",
    code,
    subject,
    context: canonicalizeContext(context),
    message,
    delta: sortArchitectureGraphDelta(items),
  };
}

export function selectedRatchetFailure(
  failures: readonly RankedRatchetFailure[],
): ArchitectureGraphRatchetRejected | undefined {
  const chosen = selectRankedFailure(failures);
  if (!chosen) return undefined;
  return rejectArchitectureGraph(
    chosen.code,
    chosen.subject,
    chosen.message,
    chosen.context,
    chosen.delta,
  );
}

/**
 * Pre-index cardinality guard. observedCount > admittedCount proves at least
 * one live occurrence outside predecessor ∪ proposal, but names no identity.
 * The delta item is therefore identity-free unreviewed — never duplicate or
 * replaced from the count alone.
 */
export function rejectUnreviewedCardinality(
  subject: ArchitectureGraphRatchetSubject,
  code: ArchitectureGraphRatchetFailureCode,
  message: string,
  admittedCount: number,
  observedCount: number,
): ArchitectureGraphRatchetRejected {
  return rejectArchitectureGraph(
    code,
    subject,
    message,
    { admittedCount, observedCount },
    [architectureDeltaItem(subject, "unreviewed")],
  );
}

export function attributesOf(
  part: ExistingPartDef,
): readonly ExistingAttribute[] {
  return part.attributes ?? [];
}

export function isPartDefinitionKind(kind: string): boolean {
  return kind === "PartDefinition" || kind === "sysml::PartDefinition" ||
    kind.endsWith("entity=PartDefinition");
}

export function isPartUsageKind(kind: string): boolean {
  return kind === "PartUsage" || kind === "sysml::PartUsage" ||
    kind.endsWith("entity=PartUsage");
}

export function isAttributeUsageKind(kind: string): boolean {
  return kind === "AttributeUsage" || kind === "sysml::AttributeUsage" ||
    kind.endsWith("entity=AttributeUsage");
}

export function occupyingDefinition(
  part: ExistingPartDef,
  predecessorById: ReadonlyMap<string, ExistingPartDef>,
  predecessorLabels: ReadonlyMap<string, number>,
  expectedLabels: ReadonlySet<string>,
): OccupiedArchitectureSlot {
  if (predecessorById.has(part.id) || predecessorLabels.has(part.label)) {
    return { kind: "attested", relation: "replaced" };
  }
  if (expectedLabels.has(part.label)) {
    return { kind: "proposal", fact: { label: part.label } };
  }
  return { kind: "none" };
}

export function occupyingUsage(
  usage: ExistingPartUsage,
  parentLabel: string,
  predecessorUsageIds: ReadonlySet<string>,
  attestedSlots: ReadonlySet<string>,
  proposalFacts: ReadonlyMap<
    string,
    { parentLabel: string; label: string; targetLabel: string }
  >,
): OccupiedArchitectureSlot {
  const slot = `${parentLabel}\u0000${usage.label}`;
  if (
    (typeof usage.id === "string" && predecessorUsageIds.has(usage.id)) ||
    attestedSlots.has(slot)
  ) {
    return { kind: "attested", relation: "replaced" };
  }
  const fact = proposalFacts.get(slot);
  if (fact) return { kind: "proposal", fact };
  return { kind: "none" };
}

export function occupyingAttribute(
  attribute: ExistingAttribute,
  part: ExistingPartDef,
  inheritedAttributes: ReadonlyMap<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >,
  inheritedByKey: ReadonlyMap<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >,
  proposalSlots: ReadonlyMap<string, number>,
): OccupiedArchitectureSlot {
  const slot = `${part.label}\u0000${attribute.label}`;
  const id = attribute.id;
  if (typeof id === "string") {
    const inherited = inheritedAttributes.get(id);
    if (inherited) {
      return {
        kind: "attested",
        relation: inherited.parentId !== part.id ? "moved" : "replaced",
      };
    }
  }
  if (inheritedByKey.has(slot)) {
    return { kind: "attested", relation: "replaced" };
  }
  if (proposalSlots.has(slot)) {
    return {
      kind: "proposal",
      fact: { parentLabel: part.label, label: attribute.label },
    };
  }
  return { kind: "none" };
}

export function definitionLabelDelta(
  expected: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): readonly ArchitectureGraphDeltaItem[] {
  const items: ArchitectureGraphDeltaItem[] = [];
  for (const [label, count] of expected) {
    const observed = actual.get(label) ?? 0;
    for (let i = observed; i < count; i++) {
      items.push(architectureDeltaItem("PartDefinition", "missing", { label }));
    }
  }
  for (const [label, count] of actual) {
    const admitted = expected.get(label) ?? 0;
    for (let i = admitted; i < count; i++) {
      items.push(
        architectureDeltaItem("PartDefinition", "unreviewed", { label }),
      );
    }
  }
  return items;
}

export function buildAcceptedArchitectureDelta(
  predecessor: ExistingArchitectureStructure | undefined,
  live: ExistingArchitectureStructure,
  predecessorById: ReadonlyMap<string, ExistingPartDef>,
  predecessorUsageIds: ReadonlySet<string>,
  inheritedAttributes: ReadonlyMap<string, { id: string }>,
): readonly ArchitectureGraphDeltaItem[] {
  const items: ArchitectureGraphDeltaItem[] = [architectureDeltaItem(
    "Package",
    predecessor ? "inherited_exact" : "reviewed_addition",
    { id: live.packageId, label: live.packageLabel },
  )];
  for (const part of live.partDefs) {
    items.push(architectureDeltaItem(
      "PartDefinition",
      predecessorById.has(part.id) ? "inherited_exact" : "reviewed_addition",
      { id: part.id, label: part.label },
    ));
    for (const usage of part.usages) {
      const usageId = usage.id;
      items.push(architectureDeltaItem(
        "PartUsage",
        typeof usageId === "string" && predecessorUsageIds.has(usageId)
          ? "inherited_exact"
          : "reviewed_addition",
        {
          ...(typeof usageId === "string" ? { id: usageId } : {}),
          label: usage.label,
          parentId: part.id,
          parentLabel: part.label,
          ...(typeof usage.targetId === "string" ? { targetId: usage.targetId } : {}),
          targetLabel: usage.targetLabel,
        },
      ));
    }
    for (const attribute of attributesOf(part)) {
      const attributeId = attribute.id;
      items.push(architectureDeltaItem(
        "AttributeUsage",
        typeof attributeId === "string" && inheritedAttributes.has(attributeId)
          ? "inherited_exact"
          : "reviewed_addition",
        {
          ...(typeof attributeId === "string" ? { id: attributeId } : {}),
          label: attribute.label,
          parentId: part.id,
          parentLabel: part.label,
        },
      ));
    }
  }
  return sortArchitectureGraphDelta(items);
}

const SUBJECT_RANK: Readonly<Record<ArchitectureGraphRatchetSubject, number>> = {
  Package: 0,
  PartDefinition: 1,
  PartUsage: 2,
  AttributeUsage: 3,
};

const DELTA_KIND_RANK: Readonly<Record<ArchitectureGraphDeltaKind, number>> = {
  inherited_exact: 0,
  reviewed_addition: 1,
  missing: 2,
  replaced: 3,
  moved: 4,
  duplicate: 5,
  unreviewed: 6,
};

export function sortArchitectureGraphDelta(
  items: readonly ArchitectureGraphDeltaItem[],
): ArchitectureGraphDeltaItem[] {
  return [...items].sort((left, right) =>
    SUBJECT_RANK[left.subject] - SUBJECT_RANK[right.subject] ||
    DELTA_KIND_RANK[left.kind] - DELTA_KIND_RANK[right.kind] ||
    compareCodeUnit(left.id ?? "", right.id ?? "") ||
    compareCodeUnit(left.parentId ?? "", right.parentId ?? "") ||
    compareCodeUnit(left.label ?? "", right.label ?? "") ||
    compareCodeUnit(left.targetId ?? "", right.targetId ?? "")
  );
}

export interface ArchitecturePredecessorIndex {
  readonly predecessorById: ReadonlyMap<string, ExistingPartDef>;
  readonly predecessorLabels: ReadonlyMap<string, number>;
  readonly predecessorUsageIds: ReadonlySet<string>;
  readonly inheritedAttributes: ReadonlyMap<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >;
  readonly inheritedEdges: ReadonlyMap<string, number>;
}

export function indexPredecessorArchitecture(
  predecessor: ExistingArchitectureStructure | undefined,
): ArchitecturePredecessorIndex | ArchitectureGraphRatchetRejected {
  const MSG = ARCHITECTURE_RATCHET_MESSAGES;
  const predecessorById = new Map<string, ExistingPartDef>();
  const predecessorLabels = new Map<string, number>();
  const predecessorUsageIds = new Set<string>();
  const inheritedAttributes = new Map<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >();
  const inheritedEdges = new Map<string, number>();
  const defsById = new Map<string, ExistingPartDef[]>();
  const usagesById = new Map<string, {
    id: string;
    label: string;
    parentId: string;
  }[]>();
  const attrsById = new Map<string, {
    id: string;
    label: string;
    parentId: string;
  }[]>();
  const edgeKey = (parent: string, label: string, target: string) =>
    `${parent}\u0000${label}\u0000${target}`;
  for (const part of predecessor?.partDefs ?? []) {
    pushGroup(defsById, part.id, part);
    if (!predecessorById.has(part.id)) {
      predecessorById.set(part.id, part);
      predecessorLabels.set(part.label, (predecessorLabels.get(part.label) ?? 0) + 1);
    }
    for (const usage of part.usages) {
      const usageId = usage.id as string;
      pushGroup(usagesById, usageId, {
        id: usageId,
        label: usage.label,
        parentId: part.id,
      });
      if (!predecessorUsageIds.has(usageId)) {
        predecessorUsageIds.add(usageId);
        inheritedEdges.set(
          edgeKey(part.label, usage.label, usage.targetLabel),
          (inheritedEdges.get(
            edgeKey(part.label, usage.label, usage.targetLabel),
          ) ?? 0) + 1,
        );
      }
    }
    for (const attribute of attributesOf(part)) {
      const attributeId = attribute.id as string;
      pushGroup(attrsById, attributeId, {
        id: attributeId,
        label: attribute.label,
        parentId: part.id,
      });
      if (!inheritedAttributes.has(attributeId)) {
        inheritedAttributes.set(attributeId, {
          id: attributeId,
          label: attribute.label,
          parentId: part.id,
          parentLabel: part.label,
        });
      }
    }
  }
  const failures: RankedRatchetFailure[] = [];
  for (const [id, parts] of defsById) {
    if (parts.length < 2) continue;
    for (const part of parts) {
      failures.push(failRatchet(
        0,
        "predecessor_part_definition_duplicate_id",
        "PartDefinition",
        MSG.predDefDup,
        { id, label: part.label },
        [architectureDeltaItem("PartDefinition", "duplicate", {
          id,
          label: part.label,
        })],
      ));
    }
  }
  for (const [id, usages] of usagesById) {
    if (usages.length < 2) continue;
    for (const usage of usages) {
      failures.push(failRatchet(
        1,
        "predecessor_part_usage_duplicate_id",
        "PartUsage",
        MSG.predUsageDup,
        { id, label: usage.label, parentId: usage.parentId },
        [architectureDeltaItem("PartUsage", "duplicate", {
          id,
          label: usage.label,
          parentId: usage.parentId,
        })],
      ));
    }
  }
  for (const [id, attributes] of attrsById) {
    if (attributes.length < 2) continue;
    for (const attribute of attributes) {
      failures.push(failRatchet(
        2,
        "predecessor_attribute_usage_duplicate_id",
        "AttributeUsage",
        MSG.predAttrDup,
        { id, label: attribute.label, parentId: attribute.parentId },
        [architectureDeltaItem("AttributeUsage", "duplicate", {
          id,
          label: attribute.label,
          parentId: attribute.parentId,
        })],
      ));
    }
  }
  const failure = selectedRatchetFailure(failures);
  if (failure) return failure;
  if ([...predecessorLabels.values()].some((count) => count !== 1)) {
    return rejectArchitectureGraph(
      "predecessor_part_definition_ambiguous_label",
      "PartDefinition",
      MSG.predDefLabel,
      { labels: [...predecessorLabels.entries()] },
      [...predecessorLabels.entries()]
        .filter(([, count]) => count !== 1)
        .map(([label]) =>
          architectureDeltaItem("PartDefinition", "duplicate", { label })
        ),
    );
  }
  return {
    predecessorById,
    predecessorLabels,
    predecessorUsageIds,
    inheritedAttributes,
    inheritedEdges,
  };
}

function pushGroup<T>(groups: Map<string, T[]>, id: string, item: T): void {
  const group = groups.get(id);
  if (group) group.push(item);
  else groups.set(id, [item]);
}

export function inspectLiveAttributeUsages(input: {
  live: ExistingArchitectureStructure;
  proposal: ArchitectureProposal;
  inheritedAttributes: ReadonlyMap<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >;
  actualSemanticIds: Set<string>;
}): ArchitectureGraphRatchetRejected | undefined {
  const { live, proposal, inheritedAttributes, actualSemanticIds } = input;
  const slotKey = (parent: string, label: string) => `${parent}\u0000${label}`;
  const inheritedByKey = new Map<
    string,
    { id: string; label: string; parentId: string; parentLabel: string }
  >();
  for (const inherited of inheritedAttributes.values()) {
    inheritedByKey.set(slotKey(inherited.parentLabel, inherited.label), inherited);
  }
  const expectedNewAttributes = new Map<string, number>();
  for (const attribute of proposal.attributes ?? []) {
    const key = slotKey(attribute.parentName, attribute.name);
    if (!inheritedByKey.has(key)) {
      expectedNewAttributes.set(key, (expectedNewAttributes.get(key) ?? 0) + 1);
    }
  }

  const actualAttributeIds = new Set<string>();
  const observedNewAttributes = new Map<string, number>();
  const failures: RankedRatchetFailure[] = [];
  const MSG = ARCHITECTURE_RATCHET_MESSAGES;
  for (const part of live.partDefs) {
    for (const attribute of attributesOf(part)) {
      const occupying = occupyingAttribute(
        attribute,
        part,
        inheritedAttributes,
        inheritedByKey,
        expectedNewAttributes,
      );
      const liveFields = {
        ...(typeof attribute.id === "string" && attribute.id.length > 0
          ? { id: attribute.id }
          : {}),
        label: attribute.label,
        parentId: part.id,
        parentLabel: part.label,
      };
      const attributeId = attribute.id;
      if (typeof attributeId !== "string" || attributeId.length === 0) {
        failures.push(failRatchet(
          0,
          "live_attribute_usage_invalid",
          "AttributeUsage",
          MSG.liveAttrInvalid,
          { label: attribute.label, parentId: part.id, reason: "missing_id" },
          occupationDelta("AttributeUsage", occupying, liveFields),
        ));
        continue;
      }
      if (!isAttributeUsageKind(attribute.kind ?? "")) {
        failures.push(failRatchet(
          0,
          "live_attribute_usage_invalid",
          "AttributeUsage",
          MSG.liveAttrInvalid,
          {
            id: attributeId,
            label: attribute.label,
            parentId: part.id,
            reason: "wrong_kind",
          },
          occupationDelta("AttributeUsage", occupying, liveFields),
        ));
        continue;
      }
      if (
        actualSemanticIds.has(attributeId) || actualAttributeIds.has(attributeId)
      ) {
        failures.push(failRatchet(
          0,
          "live_attribute_usage_invalid",
          "AttributeUsage",
          MSG.liveAttrInvalid,
          {
            id: attributeId,
            label: attribute.label,
            parentId: part.id,
            reason: "duplicate_id",
          },
          [architectureDeltaItem("AttributeUsage", "duplicate", liveFields)],
        ));
        continue;
      }
      actualAttributeIds.add(attributeId);
      actualSemanticIds.add(attributeId);
      const inherited = inheritedAttributes.get(attributeId);
      if (inherited !== undefined) {
        if (
          inherited.label !== attribute.label ||
          inherited.parentId !== part.id ||
          inherited.parentLabel !== part.label
        ) {
          failures.push(failRatchet(
            1,
            "predecessor_attribute_usage_replaced_or_moved",
            "AttributeUsage",
            MSG.predAttrMoved,
            {
              id: attributeId,
              label: attribute.label,
              parentId: part.id,
              parentLabel: part.label,
              inheritedParentId: inherited.parentId,
            },
            occupationDelta("AttributeUsage", occupying, liveFields),
          ));
        }
        continue;
      }
      const key = slotKey(part.label, attribute.label);
      const inheritedKey = inheritedByKey.get(key);
      if (inheritedKey !== undefined) {
        failures.push(failRatchet(
          1,
          "predecessor_attribute_usage_replaced_or_moved",
          "AttributeUsage",
          MSG.predAttrMoved,
          {
            id: attributeId,
            label: attribute.label,
            parentId: part.id,
            parentLabel: part.label,
            inheritedParentId: inheritedKey.parentId,
          },
          occupationDelta("AttributeUsage", occupying, liveFields),
        ));
        continue;
      }
      const expected = expectedNewAttributes.get(key) ?? 0;
      if (expected <= 0) {
        failures.push(failRatchet(
          2,
          "live_attribute_usage_unreviewed",
          "AttributeUsage",
          MSG.liveAttrUnreviewed,
          {
            id: attributeId,
            label: attribute.label,
            parentLabel: part.label,
          },
          [architectureDeltaItem(
            "AttributeUsage",
            extraOccupationKind(occupying),
            liveFields,
          )],
        ));
        continue;
      }
      observedNewAttributes.set(key, (observedNewAttributes.get(key) ?? 0) + 1);
    }
  }
  const liveFailure = selectedRatchetFailure(failures);
  if (liveFailure) return liveFailure;

  const removed: RankedRatchetFailure[] = [];
  for (const inherited of inheritedAttributes.values()) {
    if (!actualAttributeIds.has(inherited.id)) {
      removed.push(failRatchet(
        0,
        "predecessor_attribute_usage_removed",
        "AttributeUsage",
        MSG.predAttrRemoved,
        {
          id: inherited.id,
          label: inherited.label,
          parentId: inherited.parentId,
        },
        [architectureDeltaItem("AttributeUsage", "missing", {
          id: inherited.id,
          label: inherited.label,
          parentId: inherited.parentId,
        })],
      ));
    }
  }
  const removedFailure = selectedRatchetFailure(removed);
  if (removedFailure) return removedFailure;

  const missing: RankedRatchetFailure[] = [];
  for (const [key, expected] of expectedNewAttributes) {
    if (observedNewAttributes.get(key) !== expected) {
      const [parentLabel, label] = key.split("\u0000");
      missing.push(failRatchet(
        0,
        "proposal_attribute_usage_missing",
        "AttributeUsage",
        MSG.proposalAttrMissing,
        { key, expected, observed: observedNewAttributes.get(key) },
        [architectureDeltaItem("AttributeUsage", "missing", { parentLabel, label })],
      ));
    }
  }
  return selectedRatchetFailure(missing);
}
