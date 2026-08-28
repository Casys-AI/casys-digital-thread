/**
 * Fresh, project-scoped JIT demand reader used only when a terminal host lease
 * considers stopping a shared launch group. It reuses the authoritative
 * runtime context compiler; it does not select a provider, change a project,
 * or mutate a host.
 */

import {
  capabilityRuntimeMaterialKey,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { EngineeringProjectRevisionStore } from "../ports/out/engineering-project-revision-store.ts";
import type { ProjectCapabilityRuntimeContextReader } from "../ports/out/capability/capability-runtime-supervisor.ts";

export interface ProjectCapabilityJitDemandReaderOptions {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly contexts: ProjectCapabilityRuntimeContextReader;
}

/**
 * Missing project state, an unresolved JIT slice, or a stale catalogue link is
 * an error rather than a negative answer: terminal cleanup must retain the
 * lease and leave the host untouched until recovery can reread authority.
 */
export class ProjectCapabilityJitDemandReader {
  constructor(private readonly options: ProjectCapabilityJitDemandReaderOptions) {}

  async hasRemainingDemand(input: {
    readonly projectId: string;
    readonly materialKeys: readonly string[];
  }): Promise<boolean> {
    const project = await this.options.projects.get(input.projectId);
    if (!project) {
      throw new Error(
        `Capability runtime JIT demand cannot read project ${input.projectId}.`,
      );
    }
    const context = await this.options.contexts.read(project);
    const jit = context.demand.jitDemand;
    if (jit.status !== "resolved") {
      throw new Error(
        "Capability runtime JIT demand is unresolved; terminal host cleanup is blocked.",
      );
    }
    const requested = new Set(input.materialKeys);
    const requirements = new Set(
      jit.capabilityRequirements.map(capabilityKey),
    );
    for (const binding of context.catalog.bindings) {
      if (
        !requirements.has(capabilityKey({
          id: binding.capability.id,
          version: binding.capability.version,
          use: binding.use,
        }))
      ) continue;
      for (const unitId of binding.unitIds) {
        const unit = context.catalog.units.find((candidate) => candidate.id === unitId);
        if (!unit) {
          throw new Error(
            `Capability runtime catalogue binding ${binding.id} references missing unit ${unitId}.`,
          );
        }
        if (
          unit.materials.some((material) =>
            requested.has(capabilityRuntimeMaterialKey({
              unitId: unit.id,
              materialId: material.id,
            }))
          )
        ) return true;
      }
    }
    return false;
  }
}

function capabilityKey(value: {
  readonly id: string;
  readonly version: string;
  readonly use: "preparation" | "execution";
}): string {
  return `${value.id}\u0000${value.version}\u0000${value.use}`;
}
