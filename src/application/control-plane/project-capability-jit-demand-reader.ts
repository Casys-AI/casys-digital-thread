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
    const authorization = context.authorization;
    if (!authorization || authorization.status !== "authorized") {
      throw new Error(
        "Capability runtime authorization is absent or not authorized; terminal host cleanup is blocked.",
      );
    }
    const requested = new Set(input.materialKeys);
    const requirements = new Set(jit.capabilityRequirements.map(capabilityKey));
    for (const planned of context.plan.bindings) {
      if (planned.status !== "selected" || planned.binding === null) continue;
      const key = capabilityKey({
        id: planned.requirement.id,
        version: planned.requirement.version,
        use: planned.requirement.use,
      });
      const authorized = authorization.allowedBindings.filter((candidate) =>
        capabilityKey(candidate.capability) === key &&
        candidate.binding.id === planned.binding!.id &&
        candidate.binding.version === planned.binding!.version
      );
      if (authorized.length !== 1) {
        throw new Error(
          `Capability runtime selected binding ${planned.binding.id}@${planned.binding.version} does not match one exact authorized binding.`,
        );
      }
      const binding = authorized[0]!;
      if (!sameIds(binding.unitIds, planned.unitIds)) {
        throw new Error(
          `Capability runtime selected binding ${planned.binding.id}@${planned.binding.version} has an authorization unit mismatch.`,
        );
      }
      assertAuthorizedMaterialsMatchCatalog(binding.materials, context.catalog.units);
      if (
        requirements.has(key) &&
        binding.materials.some((material) =>
          requested.has(capabilityRuntimeMaterialKey(material))
        )
      ) return true;
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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const orderedLeft = [...left].toSorted();
  const orderedRight = [...right].toSorted();
  return orderedLeft.length === orderedRight.length &&
    orderedLeft.every((id, index) => id === orderedRight[index]);
}

function assertAuthorizedMaterialsMatchCatalog(
  materials: readonly {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  }[],
  units: readonly {
    readonly id: string;
    readonly materials: readonly {
      readonly id: string;
      readonly imageReference: string;
    }[];
  }[],
): void {
  for (const authorized of materials) {
    const unit = units.find((candidate) => candidate.id === authorized.unitId);
    const material = unit?.materials.find((candidate) =>
      candidate.id === authorized.materialId
    );
    const currentDigest = material === undefined
      ? undefined
      : digestFromReference(material.imageReference);
    if (currentDigest !== authorized.imageDigest) {
      throw new Error(
        `Capability runtime authorized material ${authorized.unitId}/${authorized.materialId} does not match the current catalogue.`,
      );
    }
  }
}

function digestFromReference(reference: string): string {
  const digest = reference.slice(reference.lastIndexOf("@sha256:") + "@sha256:".length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Capability runtime catalogue material lacks an exact OCI digest.");
  }
  return digest;
}
