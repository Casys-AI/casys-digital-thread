/**
 * Post-insertion presence of the reviewed system, PartDefinitions, PartUsages
 * and previously adopted components. Distinct from the predecessor ratchet:
 * this speaks proposal labels, not inherited provider identities.
 */

import type {
  AdoptedItem,
  ArchitectureProposal,
  ExistingArchitectureStructure,
} from "./architecture-proposal.ts";
import {
  architectureDeltaItem,
  type ArchitectureGraphRatchetResult,
  rejectArchitectureGraph,
} from "./architecture-graph-delta.ts";
import { compareCodeUnit } from "./architecture-graph-selection.ts";

export interface ArchitecturePresenceInput {
  readonly live: ExistingArchitectureStructure | undefined;
  readonly proposal: ArchitectureProposal;
  readonly adopted: readonly AdoptedItem[];
}

export function verifyProposedArchitecturePresence(
  input: ArchitecturePresenceInput,
): ArchitectureGraphRatchetResult {
  const { live, proposal, adopted } = input;
  if (!live) return { status: "accepted", delta: [] };

  const labelCounts = new Map<string, number>();
  for (const pd of live.partDefs) {
    labelCounts.set(pd.label, (labelCounts.get(pd.label) ?? 0) + 1);
  }
  const duplicates = [...labelCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label)
    .toSorted(compareCodeUnit);
  if (duplicates.length > 0) {
    return rejectArchitectureGraph(
      "live_part_definition_ambiguous_label",
      "PartDefinition",
      `Verification failed: ambiguous PartDefinition labels after insertion: ` +
        `${duplicates.join(", ")}. Manual SysON inspection required.`,
      { labels: duplicates },
      duplicates.map((label) =>
        architectureDeltaItem("PartDefinition", "duplicate", { label })
      ),
    );
  }

  const presentByLabel = new Map(live.partDefs.map((pd) => [pd.label, pd]));
  if (!presentByLabel.has(proposal.system.name)) {
    return rejectArchitectureGraph(
      "proposal_system_part_definition_missing",
      "PartDefinition",
      `Verification failed: system PartDef "${proposal.system.name}" is absent after insertion.`,
      { name: proposal.system.name },
      [architectureDeltaItem("PartDefinition", "missing", {
        label: proposal.system.name,
      })],
    );
  }

  for (const component of proposal.components) {
    if (!presentByLabel.has(component.name)) {
      return rejectArchitectureGraph(
        "proposal_component_part_definition_missing",
        "PartDefinition",
        `Verification failed: component PartDef "${component.name}" is absent after insertion.`,
        { name: component.name },
        [architectureDeltaItem("PartDefinition", "missing", {
          label: component.name,
        })],
      );
    }
    const parentDef = presentByLabel.get(component.parentName);
    if (!parentDef) {
      return rejectArchitectureGraph(
        "proposal_parent_part_definition_missing",
        "PartDefinition",
        `Verification failed: parent PartDef "${component.parentName}" for component ` +
          `"${component.name}" is absent after insertion.`,
        { parentName: component.parentName, name: component.name },
        [architectureDeltaItem("PartDefinition", "missing", {
          label: component.parentName,
        })],
      );
    }
    const usagesWithProposedName = parentDef.usages.filter(
      (u) => u.label === component.usageName,
    );
    if (usagesWithProposedName.length > 1) {
      return rejectArchitectureGraph(
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
        [architectureDeltaItem("PartUsage", "duplicate", {
          label: component.usageName,
          parentLabel: component.parentName,
        })],
      );
    }
    const matchingUsage = usagesWithProposedName[0];
    if (!matchingUsage) {
      return rejectArchitectureGraph(
        "proposal_part_usage_absent_under_parent",
        "PartUsage",
        `Verification failed: usage "${component.usageName}" is absent under ` +
          `"${component.parentName}" after insertion of component "${component.name}".`,
        {
          usageName: component.usageName,
          parentName: component.parentName,
          name: component.name,
        },
        [architectureDeltaItem("PartUsage", "missing", {
          label: component.usageName,
          parentLabel: component.parentName,
        })],
      );
    }
    if (matchingUsage.targetLabel !== component.name) {
      return rejectArchitectureGraph(
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
        [architectureDeltaItem("PartUsage", "replaced", {
          label: component.usageName,
          parentLabel: component.parentName,
          targetLabel: matchingUsage.targetLabel,
        })],
      );
    }
  }

  for (const adoptedItem of adopted) {
    if (!presentByLabel.has(adoptedItem.componentName)) {
      return rejectArchitectureGraph(
        "adopted_part_definition_removed",
        "PartDefinition",
        `Verification failed: previously-adopted component "${adoptedItem.componentName}" ` +
          "was removed from the model during this run.",
        { componentName: adoptedItem.componentName },
        [architectureDeltaItem("PartDefinition", "missing", {
          label: adoptedItem.componentName,
        })],
      );
    }
  }

  return { status: "accepted", delta: [] };
}
