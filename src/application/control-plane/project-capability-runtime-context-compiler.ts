/**
 * Compiles the one server-owned runtime context used by queue and execution.
 *
 * This is deliberately a reader over durable project/ledger authority plus
 * current server-owned catalog, policy, host observation and admin lock.  It
 * is not an in-memory test map and it never performs host work.
 */

import { flattenEngineeringCapabilityRequirements } from "../../domain/capability/engineering-capability.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { EngineeringOperationRegistry } from "../../orchestration/operations/operation-contract.ts";
import { capabilityRuntimeCatalogMaterialsForRequirements } from "./capability-runtime-catalog-materials.ts";
import { compileProjectCapabilityDemand } from "./compile-project-capability-demand.ts";
import { planProjectCapability } from "./plan-project-capability.ts";
import {
  evaluateCapabilityRuntimeQualifications,
  loadProvenCapabilityRuntimeQualificationAttestations,
} from "./evaluate-capability-runtime-qualifications.ts";
import type { CapabilityRuntimeQualificationCandidate } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type { ProjectCapabilityEffectiveEnvelope } from "../../domain/capability/project-capability-authorization.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import type {
  ProjectCapabilityRuntimeAuthorization,
  ProjectCapabilityRuntimeAuthorizedBinding,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

/** Closed host-read scope. Omitted `read()` remains the full-catalogue path. */
export interface CapabilityRuntimeHostObservationScope {
  readonly materials: readonly CapabilityRuntimeMaterialIdentity[];
}

export interface CapabilityRuntimeHostObservationReader {
  read(
    scope?: CapabilityRuntimeHostObservationScope,
  ): Promise<CapabilityRuntimeHostObservation>;
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

  read(
    _scope?: CapabilityRuntimeHostObservationScope,
  ): Promise<CapabilityRuntimeHostObservation> {
    return Promise.resolve(structuredClone(this.value));
  }
}

export class FixedCapabilityRuntimeAdminPolicyReader
  implements CapabilityRuntimeAdminPolicyReader {
  constructor(private readonly value: CapabilityRuntimeAdminPolicy) {}

  read(): Promise<CapabilityRuntimeAdminPolicy> {
    return Promise.resolve(structuredClone(this.value));
  }
}

export class FixedCapabilityRuntimeAdminLockReader
  implements CapabilityRuntimeAdminLockReader {
  constructor(private readonly value: CapabilityRuntimeAdminLock) {}

  read(): Promise<CapabilityRuntimeAdminLock> {
    return Promise.resolve(structuredClone(this.value));
  }
}

export interface ProjectCapabilityRuntimeContextCompilerOptions {
  readonly registry: Pick<EngineeringOperationRegistry, "list">;
  readonly catalog: CapabilityRuntimeCatalog;
  readonly qualificationSpecs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly qualificationCandidates: readonly CapabilityRuntimeQualificationCandidate[];
  readonly policy: CapabilityRuntimeAdminPolicyReader;
  readonly host: CapabilityRuntimeHostObservationReader;
  readonly lock: CapabilityRuntimeAdminLockReader;
  /** Same host-local source used by the MCP and the Workbench BFF. */
  readonly qualifications?: Pick<
    CapabilityRuntimeQualificationAttestationStore,
    "list"
  >;
  readonly qualificationAttempts?: Pick<
    CapabilityRuntimeQualificationAttemptStore,
    "read"
  >;
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
    const [policy, lock, ledger, attestations, demand] = await Promise.all([
      this.options.policy.read(),
      this.options.lock.read(),
      this.options.ledgers.get(project.project.id),
      this.options.qualifications?.list() ?? Promise.resolve([]),
      compileProjectCapabilityDemand(project, this.options.registry),
    ]);
    const host = await this.options.host.read({
      materials: capabilityRuntimeCatalogMaterialsForRequirements(
        this.options.catalog,
        flattenEngineeringCapabilityRequirements([
          ...demand.plannedCeiling.capabilityRequirements,
          ...demand.jitDemand.capabilityRequirements,
        ]),
      ),
    });
    const catalog = evaluateCapabilityRuntimeQualifications({
      catalog: this.options.catalog,
      host,
      attestations,
      specs: this.options.qualificationSpecs,
      candidates: this.options.qualificationCandidates,
      provenAttestations: this.options.qualificationAttempts
        ? await loadProvenCapabilityRuntimeQualificationAttestations({
          attempts: this.options.qualificationAttempts,
          attestations,
          candidates: this.options.qualificationCandidates,
          specs: this.options.qualificationSpecs,
          host,
        })
        : [],
    });
    const plan = await planProjectCapability({
      demand,
      catalog,
      policy,
      host,
      lock,
    });
    return deepFreeze({
      demand,
      plan,
      catalog: structuredClone(catalog),
      lock: structuredClone(lock),
      authorization: ledger?.effectiveEnvelope
        ? authorizationFromEnvelope(ledger.effectiveEnvelope)
        : undefined,
    });
  }
}

function authorizationFromEnvelope(
  envelope: ProjectCapabilityEffectiveEnvelope,
): ProjectCapabilityRuntimeAuthorization {
  // The brief authorizes the exact candidate ceiling even while its runtime is
  // unavailable. Qualification later changes execution eligibility, not the
  // binding/digest/profile scope that the human already approved.
  const authorized = envelope.proposal.bindings.filter((binding) =>
    binding.candidate !== undefined
  );
  const allowedBindings = authorized.map((binding) => {
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
      const requirement = authorized.find((candidate) =>
        candidate.requirement.id === binding.capability.id &&
        candidate.requirement.version === binding.capability.version &&
        candidate.requirement.use === binding.capability.use
      )!.requirement;
      return {
        id: requirement.id,
        version: requirement.version,
        use: requirement.use,
        qualification: requirement.minimumQualification,
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
