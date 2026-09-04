import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import type {
  CapabilityQualification,
  RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import type {
  AtomicCapabilityRuntimeMaterial,
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeBindingCandidate,
  CapabilityRuntimeBindingPreference,
  CapabilityRuntimeMode,
  CapabilityRuntimeRequirementsPlan,
  CapabilityRuntimeRequirementsPlanningInput,
  PlannedCapabilityRuntimeMaterial,
  PlannedProjectCapabilityBinding,
  ProjectCapabilityPlan,
  ProjectCapabilityPlanEffects,
  ProjectCapabilityPlanningInput,
  QualifiedCapabilityRuntimeBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  fingerprintAtomicCapabilityRuntimeUnit,
  PROJECT_CAPABILITY_PLAN_SCHEMA_VERSION,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";

/**
 * Pure server-owned composition of a provider-neutral project demand into an
 * exact operational plan. It performs no I/O, Docker action, lock write, or
 * project mutation. The caller cannot supply provider/tool/argument data via
 * ProjectCapabilityDemand.
 */
export async function planProjectCapability(
  input: ProjectCapabilityPlanningInput,
): Promise<ProjectCapabilityPlan> {
  const requirementsPlan = await planCapabilityRuntimeRequirements({
    requirements: input.demand.plannedCeiling.capabilityRequirements,
    unresolvedBlockers: unresolvedDemandBlockersFor(input),
    catalog: input.catalog,
    policy: input.policy,
    host: input.host,
    lock: input.lock,
  });
  return deepFreeze({
    schemaVersion: PROJECT_CAPABILITY_PLAN_SCHEMA_VERSION,
    mutatesRuntime: false,
    demandFingerprint: input.demand.plannedCeilingFingerprint,
    registryFingerprint: input.demand.registryFingerprint,
    ...requirementsPlan,
  });
}

/**
 * Pure planner shared by a published project demand and a pending brief
 * intent. Neither entry point can perform a runtime action.
 */
export async function planCapabilityRuntimeRequirements(
  input: CapabilityRuntimeRequirementsPlanningInput,
): Promise<CapabilityRuntimeRequirementsPlan> {
  await assertCanonicalCatalogManifestFingerprints(input.catalog.units);
  const bindings = input.requirements
    .map((requirement) => planRequirement(requirement, input))
    .toSorted((left, right) => compareRequirement(left.requirement, right.requirement));
  const selectedUnits = uniqueSelectedUnits(
    bindings,
    input,
    input.preserveBlockedCandidates === true,
  );
  const materials = selectedUnits
    .flatMap((unit) =>
      unit.materials.map((material) => planMaterial(unit, material, bindings, input))
    )
    .toSorted(compareMaterial);
  const effects = aggregateEffects(selectedUnits);
  const unresolved = bindings.filter((binding) => binding.status !== "selected");
  const lockBlockers = lockBlockersFor(selectedUnits, input);
  const blockers = [
    ...input.unresolvedBlockers,
    ...unresolved.flatMap((binding) => binding.reasons),
    ...lockBlockers,
    ...(effects.security === "unknown"
      ? [
        "Activation is blocked because at least one selected material has unknown security effects.",
      ]
      : []),
  ].toSorted(compareText);
  const activation = input.unresolvedBlockers.length > 0 || unresolved.length > 0 ||
      effects.security === "unknown" || lockBlockers.length > 0
    ? "blocked" as const
    : "allowed" as const;
  const status = input.unresolvedBlockers.length > 0 || unresolved.length > 0
    ? "unresolved" as const
    : activation === "blocked"
    ? "blocked" as const
    : materials.some((material) =>
        material.imageState === "absent" || material.desired !== "active"
      )
    ? "changes-required" as const
    : "ready" as const;

  return deepFreeze({
    bindings,
    materials,
    effects,
    status,
    activation,
    blockers,
  });
}

function unresolvedDemandBlockersFor(
  input: ProjectCapabilityPlanningInput,
): readonly string[] {
  const groups = input.demand.plannedCeiling.operationGroups.filter((group) =>
    group.resolution === "unresolved"
  );
  if (
    input.demand.status === "resolved" &&
    input.demand.plannedCeiling.status === "resolved" &&
    groups.length === 0
  ) {
    return [];
  }
  return [
    "Project capability demand is unresolved; no host capability plan may be trusted.",
    ...groups.map((group) =>
      `Operation ${group.operation.id}@${group.operation.version} is unresolved: ${group.reason}.`
    ),
  ].toSorted(compareText);
}

async function assertCanonicalCatalogManifestFingerprints(
  units: readonly AtomicCapabilityRuntimeUnit[],
): Promise<void> {
  await Promise.all(units.map(async (unit) => {
    const expected = await fingerprintAtomicCapabilityRuntimeUnit(unit);
    if (
      unit.manifestFingerprint.algorithm !== expected.algorithm ||
      unit.manifestFingerprint.digest !== expected.digest
    ) {
      throw new TypeError(
        `Atomic capability unit ${unit.id} has a stale manifest fingerprint.`,
      );
    }
  }));
}

function planRequirement(
  requirement: RequiredEngineeringCapability,
  input: CapabilityRuntimeRequirementsPlanningInput,
): PlannedProjectCapabilityBinding {
  const matching = input.catalog.bindings.filter((binding) =>
    sameRequirement(binding, requirement)
  );
  if (matching.length === 0) {
    return unresolved(requirement, "unavailable", [
      `No trusted binding is registered for ${capabilityLabel(requirement)}.`,
    ]);
  }

  const enabled = matching.filter((binding) =>
    !input.policy.disabledBindingIds.includes(binding.id)
  );
  if (enabled.length === 0) {
    return unresolved(requirement, "disabled", [
      `Every trusted binding for ${
        capabilityLabel(requirement)
      } is disabled by local policy.`,
    ]);
  }

  const nonRevoked = enabled.filter((binding) => binding.qualification !== "revoked");
  if (nonRevoked.length === 0) {
    return unresolved(requirement, "revoked", [
      `Every enabled binding for ${capabilityLabel(requirement)} is revoked.`,
    ]);
  }

  const qualified = nonRevoked.filter((binding) =>
    qualificationCovers(binding.qualification, requirement.minimumQualification)
  );
  if (input.preserveBlockedCandidates) {
    const selected = selectBinding(
      nonRevoked,
      requirement,
      input.policy.preferences,
    );
    if (selected !== null) {
      const candidate = bindingCandidate(selected);
      const units = selected.unitIds.map((id) =>
        input.catalog.units.find((unit) => unit.id === id)!
      );
      const platformResult = materialModesForBinding(selected, units, input);
      const reasons: string[] = [];
      let status:
        | Exclude<PlannedProjectCapabilityBinding["status"], "selected">
        | undefined;
      if (
        !qualificationCovers(selected.qualification, requirement.minimumQualification)
      ) {
        status = "unavailable";
        reasons.push(
          `Selected binding ${selected.id} does not meet ${requirement.minimumQualification} qualification for ${
            capabilityLabel(requirement)
          }.`,
        );
      }
      if (platformResult.some((result) => result.mode === "unavailable")) {
        status = platformResult.some((result) => result.reason === "unknown-platform")
          ? "unavailable"
          : "incompatible";
        reasons.push(
          `Host ${input.host.platform} has no exact qualified runtime mode for every material required by ${selected.id}.`,
        );
      }
      if (status !== undefined) {
        return unresolved(
          requirement,
          status,
          reasons,
          candidate,
          selected.unitIds,
        );
      }
      return selectedBinding(requirement, selected);
    }
    if (nonRevoked.length > 1) {
      return unresolved(requirement, "ambiguous", [
        `Local policy does not choose one of ${
          nonRevoked.map((binding) => binding.id).toSorted(compareText).join(", ")
        } for ${capabilityLabel(requirement)}.`,
      ]);
    }
  }
  if (qualified.length === 0) {
    return unresolved(requirement, "unavailable", [
      `No enabled, non-revoked binding meets ${requirement.minimumQualification} qualification for ${
        capabilityLabel(requirement)
      }.`,
    ]);
  }

  const selected = selectBinding(qualified, requirement, input.policy.preferences);
  if (selected === null) {
    return unresolved(requirement, "ambiguous", [
      `Local policy does not choose one of ${
        qualified.map((binding) => binding.id).toSorted(compareText).join(", ")
      } for ${capabilityLabel(requirement)}.`,
    ]);
  }

  const units = selected.unitIds.map((id) =>
    input.catalog.units.find((unit) => unit.id === id)!
  );
  const platformResult = materialModesForBinding(selected, units, input);
  if (
    platformResult.some((result) =>
      result.mode === "unavailable" && result.reason === "unknown-platform"
    )
  ) {
    return unresolved(requirement, "unavailable", [
      `No reviewed platform claim is available for a material required by ${selected.id}.`,
    ]);
  }
  if (platformResult.some((result) => result.mode === "unavailable")) {
    return unresolved(requirement, "incompatible", [
      `Host ${input.host.platform} has no exact qualified runtime mode for every material required by ${selected.id}.`,
    ]);
  }
  return selectedBinding(requirement, selected);
}

function unresolved(
  requirement: RequiredEngineeringCapability,
  status: Exclude<PlannedProjectCapabilityBinding["status"], "selected">,
  reasons: readonly string[],
  candidate?: CapabilityRuntimeBindingCandidate,
  candidateUnitIds?: readonly string[],
): PlannedProjectCapabilityBinding {
  return deepFreeze({
    requirement: structuredClone(requirement),
    status,
    binding: null,
    unitIds: candidateUnitIds === undefined
      ? []
      : [...candidateUnitIds].toSorted(compareText),
    reasons: [...reasons].toSorted(compareText),
    ...(candidate === undefined ? {} : { candidate }),
  });
}

function selectedBinding(
  requirement: RequiredEngineeringCapability,
  selected: QualifiedCapabilityRuntimeBinding,
): PlannedProjectCapabilityBinding {
  if (
    selected.qualification !== "compatible" && selected.qualification !== "qualified"
  ) {
    throw new TypeError(`Selected binding ${selected.id} is not activation-qualified.`);
  }
  return deepFreeze({
    requirement: structuredClone(requirement),
    status: "selected" as const,
    binding: {
      id: selected.id,
      version: selected.version,
      qualification: selected.qualification,
    },
    unitIds: [...selected.unitIds].toSorted(compareText),
    reasons: [],
    candidate: bindingCandidate(selected),
  });
}

function bindingCandidate(
  selected: QualifiedCapabilityRuntimeBinding,
): CapabilityRuntimeBindingCandidate {
  return deepFreeze({
    id: selected.id,
    version: selected.version,
    qualification: selected.qualification,
    adapter: structuredClone(selected.adapter),
    profile: selected.profile === null ? null : structuredClone(selected.profile),
    unitIds: [...selected.unitIds].toSorted(compareText),
  });
}

function selectBinding(
  bindings: readonly QualifiedCapabilityRuntimeBinding[],
  requirement: RequiredEngineeringCapability,
  preferences: readonly CapabilityRuntimeBindingPreference[],
): QualifiedCapabilityRuntimeBinding | null {
  if (bindings.length === 1) return bindings[0]!;
  const preference = preferences.find((candidate) =>
    candidate.capability.id === requirement.id &&
    candidate.capability.version === requirement.version &&
    candidate.use === requirement.use
  );
  if (!preference) return null;
  for (const id of preference.bindingIds) {
    const selected = bindings.find((binding) => binding.id === id);
    if (selected) return selected;
  }
  return null;
}

function uniqueSelectedUnits(
  bindings: readonly PlannedProjectCapabilityBinding[],
  input: CapabilityRuntimeRequirementsPlanningInput,
  includeBlockedCandidates: boolean,
): readonly AtomicCapabilityRuntimeUnit[] {
  const byId = new Map<string, AtomicCapabilityRuntimeUnit>();
  for (const binding of bindings) {
    if (binding.status !== "selected" && !includeBlockedCandidates) continue;
    if (binding.status !== "selected" && binding.candidate === undefined) continue;
    for (const unitId of binding.unitIds) {
      const unit = input.catalog.units.find((candidate) => candidate.id === unitId);
      if (!unit) {
        throw new TypeError(
          `Selected plan references unknown catalogue unit ${unitId}.`,
        );
      }
      byId.set(unit.id, unit);
    }
  }
  return [...byId.values()].toSorted((left, right) => compareText(left.id, right.id));
}

function planMaterial(
  unit: AtomicCapabilityRuntimeUnit,
  material: AtomicCapabilityRuntimeMaterial,
  bindings: readonly PlannedProjectCapabilityBinding[],
  input: CapabilityRuntimeRequirementsPlanningInput,
): PlannedCapabilityRuntimeMaterial {
  const locked = exactLockFor(unit, input);
  const desired = locked?.desired ?? "absent";
  const imageState =
    input.host.images.some((image) => image.reference === material.imageReference)
      ? "present" as const
      : "absent" as const;
  return deepFreeze({
    unitId: unit.id,
    materialId: material.id,
    imageReference: material.imageReference,
    mode: materialModeForPlannedMaterial(unit, material, bindings, input).mode,
    imageState,
    desired,
    downloadBytes: material.effects.downloadBytes,
    storageBytes: material.effects.storageBytes,
  });
}

function lockBlockersFor(
  units: readonly AtomicCapabilityRuntimeUnit[],
  input: CapabilityRuntimeRequirementsPlanningInput,
): readonly string[] {
  return units.flatMap((unit) => {
    const locked = input.lock.units.find((candidate) => candidate.id === unit.id);
    if (!locked || exactLockFor(unit, input)) return [];
    return [capabilityRuntimeAdminLockMismatchBlocker(unit.id)];
  }).toSorted(compareText);
}

/**
 * Exact planner-owned blocker emitted while an authorized successor manifest
 * is waiting for the derived administrative lock to converge.
 */
export function capabilityRuntimeAdminLockMismatchBlocker(unitId: string): string {
  return `Administrative lock for ${unitId} does not match its exact version and manifest fingerprint.`;
}

function exactLockFor(
  unit: AtomicCapabilityRuntimeUnit,
  input: CapabilityRuntimeRequirementsPlanningInput,
) {
  const locked = input.lock.units.find((candidate) => candidate.id === unit.id);
  return locked &&
      locked.version === unit.version &&
      locked.manifestFingerprint.algorithm === unit.manifestFingerprint.algorithm &&
      locked.manifestFingerprint.digest === unit.manifestFingerprint.digest
    ? locked
    : null;
}

function materialModesForBinding(
  binding: QualifiedCapabilityRuntimeBinding,
  units: readonly AtomicCapabilityRuntimeUnit[],
  input: CapabilityRuntimeRequirementsPlanningInput,
): readonly ReturnType<typeof materialModeForBinding>[] {
  return units.flatMap((unit) =>
    unit.materials.map((material) =>
      materialModeForBinding(binding, unit, material, input)
    )
  );
}

function materialModeForPlannedMaterial(
  unit: AtomicCapabilityRuntimeUnit,
  material: AtomicCapabilityRuntimeMaterial,
  bindings: readonly PlannedProjectCapabilityBinding[],
  input: CapabilityRuntimeRequirementsPlanningInput,
): ReturnType<typeof materialModeForBinding> {
  const candidates = bindings.flatMap((planned) => {
    if (planned.status !== "selected" && planned.candidate === undefined) return [];
    if (!planned.unitIds.includes(unit.id)) return [];
    const bindingId = planned.binding?.id ?? planned.candidate!.id;
    const bindingVersion = planned.binding?.version ?? planned.candidate!.version;
    const binding = input.catalog.bindings.find((candidate) =>
      candidate.id === bindingId && candidate.version === bindingVersion
    );
    if (!binding) {
      throw new TypeError(
        `Planned capability material references unknown binding ${bindingId}.`,
      );
    }
    return [materialModeForBinding(binding, unit, material, input)];
  });
  if (candidates.length === 0) {
    return { mode: "unavailable", reason: "mismatch" };
  }
  const tokens = new Set(
    candidates.map((candidate) => `${candidate.mode}\u0000${candidate.reason}`),
  );
  if (tokens.size !== 1) {
    throw new TypeError(
      `Atomic material ${unit.id}/${material.id} has contradictory exact runtime modes.`,
    );
  }
  return candidates[0]!;
}

function materialModeForBinding(
  binding: QualifiedCapabilityRuntimeBinding,
  unit: AtomicCapabilityRuntimeUnit,
  material: AtomicCapabilityRuntimeMaterial,
  input: CapabilityRuntimeRequirementsPlanningInput,
): {
  readonly mode: CapabilityRuntimeMode;
  readonly reason: "native" | "emulated" | "unknown-platform" | "mismatch";
} {
  if (material.platforms.length === 0) {
    return { mode: "unavailable", reason: "unknown-platform" };
  }
  const digest = ociDigest(material.imageReference);
  const exact = binding.runtimeModes.find((candidate) =>
    candidate.material.unitId === unit.id &&
    candidate.material.materialId === material.id &&
    candidate.material.imageDigest === digest
  );
  if (exact) {
    if (!material.platforms.includes(exact.targetPlatform)) {
      return { mode: "unavailable", reason: "mismatch" };
    }
    if (exact.mode === "native" && exact.targetPlatform === input.host.platform) {
      return { mode: "native", reason: "native" };
    }
    if (exact.mode === "emulated" && exact.targetPlatform !== input.host.platform) {
      return { mode: "emulated", reason: "emulated" };
    }
    return { mode: "unavailable", reason: "mismatch" };
  }
  // Compatibility bridge for pre-attestation, code-owned qualifications. It
  // deliberately permits native only; emulation never follows a host-wide flag.
  if (
    (binding.qualification === "compatible" || binding.qualification === "qualified") &&
    material.platforms.includes(input.host.platform)
  ) {
    return { mode: "native", reason: "native" };
  }
  return { mode: "unavailable", reason: "mismatch" };
}

function aggregateEffects(
  units: readonly AtomicCapabilityRuntimeUnit[],
): ProjectCapabilityPlanEffects {
  const records = units.flatMap((unit) =>
    unit.materials.map((material) => ({ unitId: unit.id, material }))
  );
  const materials = records.map((record) => record.material);
  const materialByDigest = new Map<string, AtomicCapabilityRuntimeMaterial>();
  for (const material of materials) {
    const digest = ociDigest(material.imageReference);
    const previous = materialByDigest.get(digest);
    if (
      previous &&
      (previous.effects.downloadBytes !== material.effects.downloadBytes ||
        previous.effects.storageBytes !== material.effects.storageBytes)
    ) {
      throw new TypeError(
        `OCI digest ${digest} has contradictory download or storage estimates.`,
      );
    }
    if (!previous) materialByDigest.set(digest, material);
  }
  const imageMaterials = [...materialByDigest.values()];
  const services = mergeIdenticalByIdentity(
    materials.flatMap((material) => material.effects.services),
    (service) => service.id,
    (service) => service.lifecycle,
    "service",
  );
  const volumes = mergeIdenticalByIdentity(
    materials.flatMap((material) => material.effects.volumes),
    (volume) => volume.id,
    (volume) => `${volume.access}\u0000${volume.preservation}`,
    "volume",
  );
  const networks = [...new Set(materials.map((material) => material.effects.network))]
    .toSorted(compareText);
  const loopbackPorts = collectLoopbackPorts(records);
  const bindMounts = mergeIdenticalByIdentity(
    materials.flatMap((material) => material.effects.bindMounts),
    (mount) => mount.target,
    (mount) => mount.access,
    "bind mount",
  );
  const devices = [
    ...new Set(materials.flatMap((material) => material.effects.devices)),
  ]
    .toSorted(compareText);
  const secretSlots = [
    ...new Set(materials.flatMap((material) => material.effects.secretSlots)),
  ]
    .toSorted(compareText);
  const licences = dedupeByKey(
    materials.map((material) => material.effects.licence),
    (licence) => `${licence.status}\u0000${licence.reference ?? ""}`,
  );
  return deepFreeze({
    downloadBytes: sumNullable(
      imageMaterials.map((material) => material.effects.downloadBytes),
    ),
    storageBytes: sumNullable(
      imageMaterials.map((material) => material.effects.storageBytes),
    ),
    services: services.toSorted((left, right) => compareText(left.id, right.id)),
    volumes: volumes.toSorted((left, right) => compareText(left.id, right.id)),
    networks,
    loopbackPorts,
    bindMounts: bindMounts.toSorted((left, right) =>
      compareText(
        `${left.target}\u0000${left.access}`,
        `${right.target}\u0000${right.access}`,
      )
    ),
    privileged: false,
    dockerSocket: false,
    devices,
    secretSlots,
    licences: licences.toSorted((left, right) =>
      compareText(
        `${left.status}\u0000${left.reference ?? ""}`,
        `${right.status}\u0000${right.reference ?? ""}`,
      )
    ),
    security: materials.some((material) => material.effects.security === "unknown")
      ? "unknown" as const
      : "reviewed" as const,
  });
}

function collectLoopbackPorts(
  records: readonly {
    readonly unitId: string;
    readonly material: AtomicCapabilityRuntimeMaterial;
  }[],
): readonly number[] {
  const ownerByPort = new Map<number, string>();
  for (const { unitId, material } of records) {
    const owner = `${unitId}/${material.id}`;
    for (const port of material.effects.loopbackPorts) {
      const previousOwner = ownerByPort.get(port);
      if (previousOwner && previousOwner !== owner) {
        throw new TypeError(
          `Loopback port ${port} is claimed by both ${previousOwner} and ${owner}.`,
        );
      }
      ownerByPort.set(port, owner);
    }
  }
  return [...ownerByPort.keys()].toSorted((left, right) => left - right);
}

function mergeIdenticalByIdentity<T>(
  values: readonly T[],
  identity: (value: T) => string,
  representation: (value: T) => string,
  label: string,
): T[] {
  const valuesByIdentity = new Map<string, T>();
  for (const value of values) {
    const key = identity(value);
    const previous = valuesByIdentity.get(key);
    if (previous && representation(previous) !== representation(value)) {
      throw new TypeError(`Runtime ${label} ${key} has contradictory declarations.`);
    }
    if (!previous) valuesByIdentity.set(key, value);
  }
  return [...valuesByIdentity.values()];
}

function ociDigest(imageReference: string): string {
  const match = /@sha256:([a-f0-9]{64})$/.exec(imageReference);
  if (!match) {
    throw new TypeError(
      `Capability runtime material is not OCI digest-pinned: ${imageReference}.`,
    );
  }
  return match[1]!;
}

function sameRequirement(
  binding: QualifiedCapabilityRuntimeBinding,
  requirement: RequiredEngineeringCapability,
): boolean {
  return binding.capability.id === requirement.id &&
    binding.capability.version === requirement.version &&
    binding.use === requirement.use;
}

function qualificationCovers(
  candidate: QualifiedCapabilityRuntimeBinding["qualification"],
  required: CapabilityQualification,
): candidate is CapabilityQualification {
  return candidate === "qualified" ||
    (candidate === "compatible" && required === "compatible");
}

function capabilityLabel(requirement: RequiredEngineeringCapability): string {
  return `${requirement.id}@${requirement.version}/${requirement.use}`;
}

function compareRequirement(
  left: RequiredEngineeringCapability,
  right: RequiredEngineeringCapability,
): number {
  return compareText(
    `${left.id}\u0000${left.version}\u0000${left.use}`,
    `${right.id}\u0000${right.version}\u0000${right.use}`,
  ) ||
    compareText(left.minimumQualification, right.minimumQualification);
}

function compareMaterial(
  left: PlannedCapabilityRuntimeMaterial,
  right: PlannedCapabilityRuntimeMaterial,
): number {
  return compareText(
    `${left.unitId}\u0000${left.materialId}`,
    `${right.unitId}\u0000${right.materialId}`,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sumNullable(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function dedupeByKey<T>(values: readonly T[], key: (value: T) => string): T[] {
  const result = new Map<string, T>();
  for (const value of values) result.set(key(value), value);
  return [...result.values()];
}
