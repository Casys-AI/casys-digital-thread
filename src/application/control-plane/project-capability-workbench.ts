/**
 * Read-only, redacted operational capability projection for one exact project
 * revision.  It reuses the runtime context compiled by server composition;
 * it never recompiles demand, selects a binding, or grants runtime authority.
 */

import {
  engineeringCapabilityRequirementKey,
} from "../../domain/capability/engineering-capability.ts";
import type { ProjectCapabilityDemandSlice } from "../../domain/capability/project-capability-demand.ts";
import {
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeStateObserver,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type {
  AtomicCapabilityRuntimeMaterial,
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeMode,
  PlannedCapabilityRuntimeMaterial,
  PlannedProjectCapabilityBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";

export const PROJECT_CAPABILITY_WORKBENCH_SCHEMA_VERSION =
  "project-capability-workbench/1.0" as const;

type WorkbenchObservedMaterialState =
  | CapabilityRuntimeObservedState["material"]
  | "unavailable";
type WorkbenchObservedRuntimeState =
  | CapabilityRuntimeObservedState["runtime"]
  | "unavailable";
type WorkbenchObservedQualificationState =
  | "compatible"
  | "qualified"
  | "unavailable";

export interface ProjectCapabilityWorkbenchProjection {
  readonly schemaVersion: typeof PROJECT_CAPABILITY_WORKBENCH_SCHEMA_VERSION;
  readonly project: {
    readonly id: string;
    readonly snapshotId: string;
    readonly revision: number;
  };
  readonly authorization: {
    readonly status: "not-authorized" | "authorized" | "revoked";
    readonly fingerprint: ContentFingerprint | null;
  };
  readonly demand: {
    readonly plannedCeiling: ProjectCapabilityWorkbenchDemandSlice;
    readonly jit: ProjectCapabilityWorkbenchDemandSlice;
  };
  readonly plan: {
    readonly status: "ready" | "changes-required" | "blocked" | "unresolved";
    readonly activation: "allowed" | "blocked";
    /** Opaque identities prevent a runtime diagnostic from becoming a transport leak. */
    readonly blockers: readonly ContentFingerprint[];
  };
  readonly bindings: readonly ProjectCapabilityWorkbenchBinding[];
  readonly units: readonly ProjectCapabilityWorkbenchUnit[];
  readonly materials: readonly ProjectCapabilityWorkbenchMaterial[];
  /** Null stays literal when neither aggregate size is known. */
  readonly footprint: {
    readonly downloadBytes: number | null;
    readonly storageBytes: number | null;
  } | null;
  /** Counts and status classes only: no ports, mounts, slot names, or service bodies. */
  readonly effects: {
    readonly serviceCount: number;
    readonly volumeCount: number;
    readonly networkModes: readonly ("internal" | "loopback-only" | "deny-all")[];
    readonly bindMountCount: number;
    readonly deviceCount: number;
    readonly licences: { readonly reviewed: number; readonly unknown: number };
    readonly security: "reviewed" | "unknown";
  };
  /** SHA-256 over this complete redacted projection, excluding this field. */
  readonly projectionFingerprint: ContentFingerprint;
}

export interface ProjectCapabilityWorkbenchDemandSlice {
  readonly status: "resolved" | "unresolved";
  readonly requirements: readonly {
    readonly key: string;
    readonly fingerprint: ContentFingerprint;
  }[];
  readonly fingerprint: ContentFingerprint;
}

export interface ProjectCapabilityWorkbenchBinding {
  readonly capability: {
    readonly id: string;
    readonly version: string;
    readonly use: "preparation" | "execution";
    readonly minimumQualification: "compatible" | "qualified";
    readonly key: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly status:
    | "selected"
    | "unavailable"
    | "ambiguous"
    | "disabled"
    | "revoked"
    | "incompatible";
  readonly binding: {
    readonly id: string;
    readonly version: string;
    readonly qualification: "compatible" | "qualified";
  } | null;
  readonly unitIds: readonly string[];
}

export interface ProjectCapabilityWorkbenchUnit {
  readonly id: string;
  readonly version: string | null;
  readonly manifestFingerprint: ContentFingerprint | null;
}

export interface ProjectCapabilityWorkbenchMaterial {
  readonly unitId: string;
  readonly materialId: string;
  /** Bare OCI SHA-256 hex, never the full registry/repository reference. */
  readonly digest: string | null;
  readonly mode: CapabilityRuntimeMode;
  readonly material: WorkbenchObservedMaterialState;
  readonly runtime: WorkbenchObservedRuntimeState;
  readonly qualification: WorkbenchObservedQualificationState;
}

export interface ProjectCapabilityWorkbenchReader {
  read(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityWorkbenchProjection>;
}

export interface ProjectCapabilityWorkbenchProjectorDependencies {
  readonly contexts: ProjectCapabilityRuntimeContextReader;
  readonly states: CapabilityRuntimeStateObserver;
}

/**
 * A browser/MCP-safe projection over the one authoritative runtime context.
 * It intentionally has no access to a ledger, journal, Compose profile, or
 * provider client.
 */
export class ProjectCapabilityWorkbenchProjector
  implements ProjectCapabilityWorkbenchReader {
  constructor(
    private readonly dependencies: ProjectCapabilityWorkbenchProjectorDependencies,
  ) {}

  async read(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityWorkbenchProjection> {
    const context = await this.dependencies.contexts.read(project);
    assertExactProjectContext(context, project);

    const resolvedMaterials = context.plan.materials.map((material) =>
      resolveMaterial(material, context.catalog.units)
    );
    const observed = await this.dependencies.states.observe(
      uniqueMaterialIdentities(
        resolvedMaterials.flatMap((material) =>
          material.identity === null ? [] : [material.identity]
        ),
      ),
    );
    const plannedCeiling = await demandSlice(
      context.demand.plannedCeiling,
      context.demand.plannedCeilingFingerprint,
    );
    const jit = await demandSlice(
      context.demand.jitDemand,
      context.demand.jitDemandFingerprint,
    );
    const bindings = await Promise.all(
      context.plan.bindings.map(projectBinding),
    );
    const blockers = await Promise.all(
      context.plan.blockers.map((blocker) => sha256Fingerprint({ blocker })),
    );
    const body = {
      schemaVersion: PROJECT_CAPABILITY_WORKBENCH_SCHEMA_VERSION,
      project: {
        id: project.project.id,
        snapshotId: project.id,
        revision: project.revision,
      },
      authorization: context.authorization
        ? {
          status: context.authorization.status,
          fingerprint: structuredClone(context.authorization.fingerprint),
        }
        : { status: "not-authorized" as const, fingerprint: null },
      demand: { plannedCeiling, jit },
      plan: {
        status: context.plan.status,
        activation: context.plan.activation,
        blockers,
      },
      bindings,
      units: projectUnits(context.plan.bindings, resolvedMaterials),
      materials: resolvedMaterials.map((material) =>
        projectMaterial(material, observed, context)
      ),
      footprint: projectFootprint(context),
      effects: projectEffects(context),
    } as const;
    const projectionFingerprint = await sha256Fingerprint(body);
    return deepFreeze({ ...body, projectionFingerprint });
  }
}

async function demandSlice(
  slice: ProjectCapabilityDemandSlice,
  fingerprint: ContentFingerprint,
): Promise<ProjectCapabilityWorkbenchDemandSlice> {
  return {
    status: slice.status,
    requirements: await Promise.all(
      slice.capabilityRequirements.map(async (requirement) => ({
        key: engineeringCapabilityRequirementKey(requirement),
        fingerprint: await sha256Fingerprint(requirement),
      })),
    ),
    fingerprint: structuredClone(fingerprint),
  };
}

async function projectBinding(
  binding: PlannedProjectCapabilityBinding,
): Promise<ProjectCapabilityWorkbenchBinding> {
  const requirement = binding.requirement;
  return {
    capability: {
      id: requirement.id,
      version: requirement.version,
      use: requirement.use,
      minimumQualification: requirement.minimumQualification,
      key: engineeringCapabilityRequirementKey(requirement),
      fingerprint: await sha256Fingerprint(requirement),
    },
    status: binding.status,
    binding: binding.binding === null ? null : { ...binding.binding },
    unitIds: [...binding.unitIds].toSorted(),
  };
}

interface ResolvedPlannedMaterial {
  readonly planned: PlannedCapabilityRuntimeMaterial;
  readonly unit: AtomicCapabilityRuntimeUnit | null;
  readonly material: AtomicCapabilityRuntimeMaterial | null;
  readonly identity: CapabilityRuntimeMaterialIdentity | null;
}

function resolveMaterial(
  planned: PlannedCapabilityRuntimeMaterial,
  units: readonly AtomicCapabilityRuntimeUnit[],
): ResolvedPlannedMaterial {
  const unit = units.find((candidate) => candidate.id === planned.unitId) ?? null;
  const material =
    unit?.materials.find((candidate) => candidate.id === planned.materialId) ?? null;
  const digest = material ? bareOciDigest(material.imageReference) : null;
  return {
    planned,
    unit,
    material,
    identity: digest === null ? null : {
      unitId: planned.unitId,
      materialId: planned.materialId,
      imageDigest: digest,
    },
  };
}

function projectUnits(
  bindings: readonly PlannedProjectCapabilityBinding[],
  materials: readonly ResolvedPlannedMaterial[],
): readonly ProjectCapabilityWorkbenchUnit[] {
  const units = new Map<string, AtomicCapabilityRuntimeUnit | null>();
  for (const binding of bindings) {
    for (const unitId of binding.unitIds) units.set(unitId, null);
  }
  for (const material of materials) {
    units.set(material.planned.unitId, material.unit);
  }
  return [...units.entries()]
    .map(([id, unit]) => ({
      id,
      version: unit?.version ?? null,
      manifestFingerprint: unit === null
        ? null
        : structuredClone(unit.manifestFingerprint),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

function projectMaterial(
  material: ResolvedPlannedMaterial,
  observed: ReadonlyMap<string, CapabilityRuntimeObservedState>,
  context: ProjectCapabilityRuntimeContext,
): ProjectCapabilityWorkbenchMaterial {
  const state = material.identity === null
    ? undefined
    : observed.get(capabilityRuntimeMaterialKey(material.identity));
  return {
    unitId: material.planned.unitId,
    materialId: material.planned.materialId,
    digest: material.identity?.imageDigest ?? null,
    mode: material.planned.mode,
    material: state?.material ?? "unavailable",
    runtime: state?.runtime ?? "unavailable",
    qualification: effectiveMaterialQualification(material, context),
  };
}

/** Docker observation is deliberately not a qualification source. */
function effectiveMaterialQualification(
  material: ResolvedPlannedMaterial,
  context: ProjectCapabilityRuntimeContext,
): WorkbenchObservedQualificationState {
  if (material.identity === null) return "unavailable";
  const candidates = context.plan.bindings.flatMap((planned) => {
    if (
      planned.status !== "selected" || planned.binding === null ||
      !planned.unitIds.includes(material.planned.unitId)
    ) return [];
    return context.catalog.bindings.filter((binding) =>
      binding.id === planned.binding!.id &&
      binding.version === planned.binding!.version &&
      binding.unitIds.includes(material.planned.unitId) &&
      (binding.qualification === "compatible" ||
        binding.qualification === "qualified") &&
      binding.qualification === planned.binding!.qualification &&
      binding.runtimeModes.some((mode) =>
        sameMaterialIdentity(mode.material, material.identity!) &&
        mode.mode === material.planned.mode
      )
    ).map((binding) =>
      `${binding.id}\u0000${binding.version}\u0000${binding.qualification}`
    );
  });
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) return "unavailable";
  const qualification = unique[0]!.split("\u0000").at(-1);
  return qualification === "compatible" || qualification === "qualified"
    ? qualification
    : "unavailable";
}

function sameMaterialIdentity(
  left: CapabilityRuntimeMaterialIdentity,
  right: CapabilityRuntimeMaterialIdentity,
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}

function projectFootprint(
  context: ProjectCapabilityRuntimeContext,
): ProjectCapabilityWorkbenchProjection["footprint"] {
  const { downloadBytes, storageBytes } = context.plan.effects;
  return downloadBytes === null && storageBytes === null
    ? null
    : { downloadBytes, storageBytes };
}

function projectEffects(
  context: ProjectCapabilityRuntimeContext,
): ProjectCapabilityWorkbenchProjection["effects"] {
  const effects = context.plan.effects;
  return {
    serviceCount: effects.services.length,
    volumeCount: effects.volumes.length,
    networkModes: [...new Set(effects.networks)].toSorted(),
    bindMountCount: effects.bindMounts.length,
    deviceCount: effects.devices.length,
    licences: {
      reviewed:
        effects.licences.filter((licence) => licence.status === "reviewed").length,
      unknown: effects.licences.filter((licence) => licence.status === "unknown")
        .length,
    },
    security: effects.security,
  };
}

function uniqueMaterialIdentities(
  materials: readonly CapabilityRuntimeMaterialIdentity[],
): readonly CapabilityRuntimeMaterialIdentity[] {
  const unique = new Map<string, CapabilityRuntimeMaterialIdentity>();
  for (const material of materials) {
    unique.set(capabilityRuntimeMaterialKey(material), material);
  }
  return [...unique.values()].toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left).localeCompare(
      capabilityRuntimeMaterialKey(right),
    )
  );
}

function bareOciDigest(reference: string): string | null {
  return /@sha256:([a-f0-9]{64})$/.exec(reference)?.[1] ?? null;
}

function assertExactProjectContext(
  context: ProjectCapabilityRuntimeContext,
  project: EngineeringProjectSnapshot,
): void {
  const basis = context.demand.projectSnapshot;
  if (
    basis.projectId !== project.project.id || basis.snapshotId !== project.id ||
    basis.revision !== project.revision
  ) {
    throw new TypeError(
      "Capability workbench context does not belong to the exact requested project revision.",
    );
  }
  if (
    !fingerprintsEqual(
      context.plan.demandFingerprint,
      context.demand.plannedCeilingFingerprint,
    )
  ) {
    throw new TypeError(
      "Capability workbench plan does not bind the exact planned-ceiling demand fingerprint.",
    );
  }
  if (
    !fingerprintsEqual(
      context.plan.registryFingerprint,
      context.demand.registryFingerprint,
    )
  ) {
    throw new TypeError(
      "Capability workbench plan does not bind the exact runtime registry fingerprint.",
    );
  }
  if (
    context.authorization && context.authorization.projectId !== project.project.id
  ) {
    throw new TypeError(
      "Capability workbench authorization belongs to another project.",
    );
  }
}
