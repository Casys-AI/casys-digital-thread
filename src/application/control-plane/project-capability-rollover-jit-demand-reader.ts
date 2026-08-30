/**
 * Historical JIT-demand reader for a closed runtime rollover.
 *
 * This deliberately does not reuse the normal terminal-cleanup reader: that
 * reader proves a current catalogue binding, while this reader must inspect a
 * still-authorized predecessor ledger before the catalogue is allowed to move.
 * It never resolves an image, provider, endpoint or operation argument.
 */

import { engineeringCapabilityRequirementKey } from "../../domain/capability/engineering-capability.ts";
import type { EngineeringProjectRevisionStore } from "../ports/out/engineering-project-revision-store.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import {
  compileProjectCapabilityDemand,
  type EngineeringOperationRuntimeDemandRegistryView,
} from "./compile-project-capability-demand.ts";

export interface ProjectCapabilityRolloverJitDemandReaderOptions {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly operations: EngineeringOperationRuntimeDemandRegistryView;
  readonly ledgers: ProjectCapabilityLedgerStore;
}

/**
 * Answers only whether a ready/in-progress registered operation still needs
 * one unit authorized by the current predecessor ledger. Unknown project,
 * unresolved demand, missing ledger or non-unique authorization all throw so
 * rollover preflight remains fail-closed.
 */
export class ProjectCapabilityRolloverJitDemandReader {
  constructor(
    private readonly options: ProjectCapabilityRolloverJitDemandReaderOptions,
  ) {}

  async hasRemainingDemand(input: {
    readonly projectId: string;
    readonly unitId: string;
  }): Promise<boolean> {
    const [project, ledger] = await Promise.all([
      this.options.projects.get(input.projectId),
      this.options.ledgers.get(input.projectId),
    ]);
    if (!project) {
      throw new Error(
        `Capability rollover JIT demand cannot read project ${input.projectId}.`,
      );
    }
    const envelope = ledger?.effectiveEnvelope;
    if (!envelope || envelope.status !== "authorized") {
      throw new Error(
        "Capability rollover JIT demand requires one exact authorized predecessor ledger.",
      );
    }
    const demand = await compileProjectCapabilityDemand(
      project,
      this.options.operations,
    );
    if (demand.jitDemand.status !== "resolved") {
      throw new Error(
        "Capability rollover JIT demand is unresolved; rollover remains blocked.",
      );
    }
    for (const requirement of demand.jitDemand.capabilityRequirements) {
      const key = engineeringCapabilityRequirementKey(requirement);
      const bindings = envelope.proposal.bindings.filter((binding) =>
        engineeringCapabilityRequirementKey(binding.requirement) === key
      );
      if (bindings.length !== 1) {
        throw new Error(
          `Capability rollover JIT demand lacks one exact authorized binding for ${requirement.id}@${requirement.version}.`,
        );
      }
      const binding = bindings[0]!;
      if (binding.status !== "selected" || binding.binding === null) {
        throw new Error(
          `Capability rollover JIT demand binding for ${requirement.id}@${requirement.version} is not active and exact.`,
        );
      }
      if (binding.unitIds.includes(input.unitId)) return true;
    }
    return false;
  }
}
