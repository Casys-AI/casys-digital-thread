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
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type {
  ProjectCapabilityRuntimeAuthorization,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeAdminLock } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { CapabilityRuntimeGlobalJitDemandReader } from "./capability-runtime-jit-demand.ts";

export interface ProjectCapabilityJitDemandReaderOptions {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly contexts: ProjectCapabilityRuntimeContextReader;
  /**
   * Local host-authority census for a shared launch group. It is optional only
   * while older compositions are being wired; a missing census is a literal
   * unknown, never evidence that a shared group may stop.
   */
  readonly ledgers?: Pick<ProjectCapabilityLedgerStore, "list" | "listPending">;
}

/**
 * Missing project state, an unresolved JIT slice, or a stale catalogue link is
 * an error rather than a negative answer: terminal cleanup must retain the
 * lease and leave the host untouched until recovery can reread authority.
 */
export class ProjectCapabilityJitDemandReader
  implements CapabilityRuntimeGlobalJitDemandReader {
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
    if (!authorization) {
      throw new Error(
        "Capability runtime authorization is absent; terminal host cleanup is blocked.",
      );
    }
    // A durable revocation is an exact, terminal negative authority: its
    // group must be releasable. It is not an unreadable or unresolved state.
    if (authorization.status === "revoked") return false;
    if (authorization.status !== "authorized") {
      throw new Error(
        "Capability runtime authorization is unreadable; terminal host cleanup is blocked.",
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
        !materialsHaveActiveAdminLock(binding.materials, authorization, context.lock)
      ) {
        // An inactive/missing local lock is literal negative JIT authority.
        // It is not an unreadable project state, so terminal cleanup may stop
        // the group once all leases drain.
        continue;
      }
      if (
        requirements.has(key) &&
        binding.materials.some((material) =>
          requested.has(capabilityRuntimeMaterialKey(material))
        )
      ) return true;
    }
    return false;
  }

  /**
   * Host-wide form required by shared Compose cleanup. The ledger is the
   * local, durable census of projects which could have an operational
   * envelope; pending records are included so an unreadable transition cannot
   * be mistaken for a negative demand.
   */
  async hasAnyRemainingDemand(input: {
    readonly materialKeys: readonly string[];
  }): Promise<boolean> {
    const ledgers = this.options.ledgers;
    if (!ledgers) {
      throw new Error(
        "Capability runtime global JIT demand census is not configured; shared host cleanup is blocked.",
      );
    }
    let projectIds: readonly string[];
    try {
      const [published, pending] = await Promise.all([
        ledgers.list(),
        ledgers.listPending(),
      ]);
      projectIds = [
        ...new Set([
          ...published.map((ledger) => ledger.projectId),
          ...pending.map((ledger) => ledger.projectId),
        ]),
      ].toSorted();
    } catch {
      throw new Error(
        "Capability runtime global JIT demand census cannot be read; shared host cleanup is blocked.",
      );
    }
    for (const projectId of projectIds) {
      try {
        if (
          await this.hasRemainingDemand({
            projectId,
            materialKeys: input.materialKeys,
          })
        ) return true;
      } catch {
        throw new Error(
          `Capability runtime global JIT demand cannot read project ${projectId}; shared host cleanup is blocked.`,
        );
      }
    }
    return false;
  }
}

function materialsHaveActiveAdminLock(
  materials: readonly {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  }[],
  authorization: ProjectCapabilityRuntimeAuthorization,
  lock: CapabilityRuntimeAdminLock,
): boolean {
  const units = new Map(
    (authorization.allowedUnits ?? []).map((unit) => [unit.id, unit]),
  );
  return materials.every((material) => {
    const unit = units.get(material.unitId);
    const locked = (lock?.units ?? []).find((candidate) =>
      candidate.id === material.unitId
    );
    return !!unit && !!locked && locked.desired === "active" &&
      locked.version === unit.version &&
      locked.manifestFingerprint.algorithm === unit.manifestFingerprint.algorithm &&
      locked.manifestFingerprint.digest === unit.manifestFingerprint.digest;
  });
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
