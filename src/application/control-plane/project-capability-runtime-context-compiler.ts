/**
 * Compiles the one server-owned runtime context used by queue and execution.
 *
 * This is deliberately a reader over durable project/ledger authority plus
 * current server-owned catalog, policy, host observation and admin lock.  It
 * is not an in-memory test map and it never performs host work.
 */

import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { EngineeringOperationRegistry } from "../../orchestration/operations/operation-contract.ts";
import { compileProjectCapabilityDemand } from "./compile-project-capability-demand.ts";
import { planProjectCapability } from "./plan-project-capability.ts";
import type { ProjectCapabilityEffectiveEnvelope } from "./project-capability-authorization.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
} from "./read-model/capability-runtime-catalog.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type {
  ProjectCapabilityRuntimeAuthorization,
  ProjectCapabilityRuntimeAuthorizedBinding,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

export interface CapabilityRuntimeHostObservationReader {
  read(): Promise<CapabilityRuntimeHostObservation>;
}

export interface CapabilityRuntimeAdminPolicyReader {
  read(): Promise<CapabilityRuntimeAdminPolicy>;
}

export interface CapabilityRuntimeAdminLockReader {
  read(): Promise<CapabilityRuntimeAdminLock>;
}

/** Immutable composition values, used only where the host has no mutable source. */
export class FixedCapabilityRuntimeHostObservationReader
  implements CapabilityRuntimeHostObservationReader {
  constructor(private readonly value: CapabilityRuntimeHostObservation) {}

  async read(): Promise<CapabilityRuntimeHostObservation> {
    return structuredClone(this.value);
  }
}

export class FixedCapabilityRuntimeAdminPolicyReader
  implements CapabilityRuntimeAdminPolicyReader {
  constructor(private readonly value: CapabilityRuntimeAdminPolicy) {}

  async read(): Promise<CapabilityRuntimeAdminPolicy> {
    return structuredClone(this.value);
  }
}

export class FixedCapabilityRuntimeAdminLockReader
  implements CapabilityRuntimeAdminLockReader {
  constructor(private readonly value: CapabilityRuntimeAdminLock) {}

  async read(): Promise<CapabilityRuntimeAdminLock> {
    return structuredClone(this.value);
  }
}

export interface ProjectCapabilityRuntimeContextCompilerOptions {
  readonly registry: Pick<EngineeringOperationRegistry, "list">;
  readonly catalog: CapabilityRuntimeCatalog;
  readonly policy: CapabilityRuntimeAdminPolicyReader;
  readonly host: CapabilityRuntimeHostObservationReader;
  readonly lock: CapabilityRuntimeAdminLockReader;
  readonly ledgers: ProjectCapabilityLedgerStore;
}

/** Server runtime authority, reconstructed from durable sources every read. */
export class ProjectCapabilityRuntimeContextCompiler
  implements ProjectCapabilityRuntimeContextReader {
  constructor(
    private readonly options: ProjectCapabilityRuntimeContextCompilerOptions,
  ) {}

  async read(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityRuntimeContext> {
    const [host, policy, lock, ledger] = await Promise.all([
      this.options.host.read(),
      this.options.policy.read(),
      this.options.lock.read(),
      this.options.ledgers.get(project.project.id),
    ]);
    const demand = await compileProjectCapabilityDemand(project, this.options.registry);
    const plan = await planProjectCapability({
      demand,
      catalog: this.options.catalog,
      policy,
      host,
      lock,
    });
    return deepFreeze({
      demand,
      plan,
      catalog: structuredClone(this.options.catalog),
      authorization: ledger?.effectiveEnvelope
        ? authorizationFromEnvelope(ledger.effectiveEnvelope)
        : undefined,
    });
  }
}

function authorizationFromEnvelope(
  envelope: ProjectCapabilityEffectiveEnvelope,
): ProjectCapabilityRuntimeAuthorization {
  const selected = envelope.proposal.bindings.filter((binding) =>
    binding.status === "selected" && binding.binding !== null &&
    binding.candidate !== undefined
  );
  const allowedBindings = selected.map((binding) => {
    const candidate = binding.candidate!;
    const materials = binding.unitIds.flatMap((unitId) => {
      const unit = envelope.proposal.units.find((value) => value.id === unitId);
      if (!unit) {
        throw new TypeError(
          `Effective capability envelope is missing selected unit ${unitId}.`,
        );
      }
      return unit.materials.map((material) => ({
        unitId: unit.id,
        materialId: material.id,
        imageDigest: digestFromPinnedReference(material.imageReference),
      }));
    });
    return {
      capability: {
        id: binding.requirement.id,
        version: binding.requirement.version,
        use: binding.requirement.use,
      },
      binding: { id: candidate.id, version: candidate.version },
      adapter: structuredClone(candidate.adapter),
      profile: candidate.profile === null ? null : structuredClone(candidate.profile),
      unitIds: [...binding.unitIds].toSorted(),
      materials: materials.toSorted(compareMaterial),
    } satisfies ProjectCapabilityRuntimeAuthorizedBinding;
  });
  const seen = new Set<string>();
  for (const binding of allowedBindings) {
    const key =
      `${binding.capability.id}\u0000${binding.capability.version}\u0000${binding.capability.use}`;
    if (seen.has(key)) {
      throw new TypeError(
        `Effective capability envelope has ambiguous binding authority for ${binding.capability.id}@${binding.capability.version}.`,
      );
    }
    seen.add(key);
  }
  return {
    projectId: envelope.proposal.projectId,
    status: envelope.status,
    fingerprint: structuredClone(envelope.effectiveEnvelopeFingerprint),
    allowedUnits: envelope.proposal.units.map((unit) => ({
      id: unit.id,
      version: unit.version,
      manifestFingerprint: structuredClone(unit.manifestFingerprint),
    })).toSorted((left, right) => left.id.localeCompare(right.id)),
    allowedCapabilities: allowedBindings.map((binding) => {
      const requirement = selected.find((candidate) =>
        candidate.requirement.id === binding.capability.id &&
        candidate.requirement.version === binding.capability.version &&
        candidate.requirement.use === binding.capability.use
      )!.requirement;
      const planned = selected.find((candidate) =>
        candidate.requirement.id === binding.capability.id &&
        candidate.requirement.version === binding.capability.version &&
        candidate.requirement.use === binding.capability.use
      )!;
      return {
        id: requirement.id,
        version: requirement.version,
        use: requirement.use,
        qualification: planned.binding!.qualification,
      };
    }),
    allowedBindings,
  };
}

function digestFromPinnedReference(reference: string): string {
  const marker = "@sha256:";
  const position = reference.lastIndexOf(marker);
  const digest = position < 0 ? "" : reference.slice(position + marker.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(
      "Effective capability envelope material lacks an exact SHA-256 digest.",
    );
  }
  return digest;
}

function compareMaterial(
  left: ProjectCapabilityRuntimeAuthorizedBinding["materials"][number],
  right: ProjectCapabilityRuntimeAuthorizedBinding["materials"][number],
): number {
  const leftKey = `${left.unitId}\u0000${left.materialId}`;
  const rightKey = `${right.unitId}\u0000${right.materialId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
