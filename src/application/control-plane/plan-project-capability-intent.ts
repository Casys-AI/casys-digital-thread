import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  engineeringCapabilityRequirementKey,
} from "../../domain/capability/engineering-capability.ts";
import type { ProjectCapabilityIntent } from "../../domain/capability/project-capability-intent.ts";
import {
  fingerprintProjectCapabilityProposal,
  PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
  type ProjectCapabilityBriefBasis,
  type ProjectCapabilityEnvelopeDelta,
  type ProjectCapabilityProposal,
} from "../../domain/capability/project-capability-authorization.ts";
import { planCapabilityRuntimeRequirements } from "./plan-project-capability.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";

export interface ProjectCapabilityIntentPlanningInput {
  readonly projectId: string;
  readonly brief: ProjectCapabilityBriefBasis;
  readonly intent: ProjectCapabilityIntent;
  readonly catalog: CapabilityRuntimeCatalog;
  readonly policy: CapabilityRuntimeAdminPolicy;
  readonly host: CapabilityRuntimeHostObservation;
  readonly lock: CapabilityRuntimeAdminLock;
}

export interface ProjectCapabilityRequirementsProposalInput {
  readonly projectId: string;
  readonly source: "brief-intent" | "published-plan";
  readonly brief: ProjectCapabilityBriefBasis;
  readonly intent: ProjectCapabilityIntent | null;
  readonly requirements: ProjectCapabilityIntent["capabilityRequirements"];
  readonly unresolvedBlockers: readonly string[];
  readonly catalog: CapabilityRuntimeCatalog;
  readonly policy: CapabilityRuntimeAdminPolicy;
  readonly host: CapabilityRuntimeHostObservation;
  readonly lock: CapabilityRuntimeAdminLock;
}

/**
 * Compiles a pending-brief operational proposal from the exact semantic
 * intent. This is intentionally not a fabricated ProjectCapabilityDemand:
 * there is no published plan yet and no work-item history to pretend exists.
 */
export async function planProjectCapabilityIntent(
  input: ProjectCapabilityIntentPlanningInput,
): Promise<ProjectCapabilityProposal> {
  const unresolvedBlockers = input.intent.authorities
    .filter((authority) => authority.resolution === "unresolved")
    .map((authority) =>
      `Brief verification authority ${authority.authority.id}@${authority.authority.version} is unresolved: ${authority.reason}.`
    )
    .toSorted(compareText);
  return await planProjectCapabilityRequirementsProposal({
    projectId: input.projectId,
    source: "brief-intent",
    brief: input.brief,
    intent: input.intent,
    requirements: input.intent.capabilityRequirements,
    unresolvedBlockers,
    catalog: input.catalog,
    policy: input.policy,
    host: input.host,
    lock: input.lock,
  });
}

/** Same trusted planner for a later exact plan; no fake demand is constructed. */
export async function planProjectCapabilityRequirementsProposal(
  input: ProjectCapabilityRequirementsProposalInput,
): Promise<ProjectCapabilityProposal> {
  const plan = await planCapabilityRuntimeRequirements({
    requirements: input.requirements,
    unresolvedBlockers: input.unresolvedBlockers,
    catalog: input.catalog,
    policy: input.policy,
    host: input.host,
    lock: input.lock,
    preserveBlockedCandidates: true,
  });
  const unitIds = new Set<string>();
  for (const binding of plan.bindings) {
    for (const unitId of binding.unitIds) unitIds.add(unitId);
  }
  const units = [...unitIds]
    .map((unitId) => input.catalog.units.find((unit) => unit.id === unitId))
    .map((unit) => {
      if (!unit) throw new TypeError("Capability proposal selected an unknown unit.");
      return structuredClone(unit);
    })
    .toSorted((left, right) => compareText(left.id, right.id));
  const materials = plan.materials.map((material) => ({
    unitId: material.unitId,
    materialId: material.materialId,
    imageReference: material.imageReference,
    mode: material.mode,
    downloadBytes: material.downloadBytes,
    storageBytes: material.storageBytes,
  }));
  const body = {
    schemaVersion: PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
    mutatesRuntime: false,
    projectId: input.projectId,
    source: input.source,
    brief: structuredClone(input.brief),
    intent: input.intent === null ? null : structuredClone(input.intent),
    semanticRequirements: structuredClone(input.requirements),
    bindings: structuredClone(plan.bindings),
    units,
    materials,
    effects: structuredClone(plan.effects),
    status: plan.status,
    activation: plan.activation,
    blockers: [...plan.blockers],
  } as const;
  return deepFreeze({
    ...body,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(body),
  });
}

/** Exact, delta-only comparison used for append-only amendments. */
export function projectCapabilityEnvelopeDelta(
  previous: ProjectCapabilityProposal,
  next: ProjectCapabilityProposal,
): ProjectCapabilityEnvelopeDelta {
  const previousRequirements = new Map(
    previous.semanticRequirements.map((requirement) => [
      engineeringCapabilityRequirementKey(requirement),
      requirement,
    ]),
  );
  const nextRequirements = new Map(
    next.semanticRequirements.map((requirement) => [
      engineeringCapabilityRequirementKey(requirement),
      requirement,
    ]),
  );
  const addedRequirementKeys = [...nextRequirements.keys()]
    .filter((key) => !previousRequirements.has(key))
    .toSorted(compareText);
  const removedRequirementKeys = [...previousRequirements.keys()]
    .filter((key) => !nextRequirements.has(key))
    .toSorted(compareText);
  const requirementReplacements = [...nextRequirements.keys()]
    .flatMap((key) => {
      const before = previousRequirements.get(key);
      const after = nextRequirements.get(key)!;
      return before && deterministicJson(before) !== deterministicJson(after)
        ? [{ requirementKey: key, previous: before, next: after }]
        : [];
    })
    .toSorted((left, right) => compareText(left.requirementKey, right.requirementKey));
  const previousBindings = new Map(previous.bindings.map((binding) => [
    engineeringCapabilityRequirementKey(binding.requirement),
    binding,
  ]));
  const nextBindings = new Map(next.bindings.map((binding) => [
    engineeringCapabilityRequirementKey(binding.requirement),
    binding,
  ]));
  const bindingReplacements = [
    ...new Set([...previousBindings.keys(), ...nextBindings.keys()]),
  ]
    .flatMap((key) => {
      const before = previousBindings.get(key) ?? null;
      const after = nextBindings.get(key) ?? null;
      return sameAuthorizationBinding(before, after)
        ? []
        : [{ requirementKey: key, previous: before, next: after }];
    })
    .toSorted((left, right) => compareText(left.requirementKey, right.requirementKey));
  const previousUnits = new Map(previous.units.map((unit) => [unit.id, unit]));
  const nextUnits = new Map(next.units.map((unit) => [unit.id, unit]));
  const addedUnits = [...nextUnits.entries()]
    .flatMap(([id, unit]) => previousUnits.has(id) ? [] : [unit])
    .toSorted((left, right) => compareText(left.id, right.id));
  const removedUnitIds = [...previousUnits.keys()]
    .filter((id) => !nextUnits.has(id))
    .toSorted(compareText);
  const changedUnits = [...nextUnits.keys()]
    .flatMap((id) => {
      const before = previousUnits.get(id);
      const after = nextUnits.get(id)!;
      return before && deterministicJson(before) !== deterministicJson(after)
        ? [{ id, previous: before, next: after }]
        : [];
    })
    .toSorted((left, right) => compareText(left.id, right.id));
  const previousMaterials = new Map(
    previous.materials.map((material) => [materialKey(material), material]),
  );
  const nextMaterials = new Map(
    next.materials.map((material) => [materialKey(material), material]),
  );
  const addedMaterials = [...nextMaterials.entries()]
    .flatMap(([key, material]) => previousMaterials.has(key) ? [] : [material])
    .toSorted((left, right) => compareText(materialKey(left), materialKey(right)));
  const removedMaterialKeys = [...previousMaterials.keys()]
    .filter((key) => !nextMaterials.has(key))
    .toSorted(compareText);
  const changedMaterials = [...nextMaterials.keys()]
    .flatMap((key) => {
      const before = previousMaterials.get(key);
      const after = nextMaterials.get(key)!;
      return before && !sameAuthorizedMaterial(before, after)
        ? [{ key, previous: before, next: after }]
        : [];
    })
    .toSorted((left, right) => compareText(left.key, right.key));
  return deepFreeze({
    addedRequirementKeys,
    removedRequirementKeys,
    addedRequirements: addedRequirementKeys.map((key) => nextRequirements.get(key)!),
    requirementReplacements,
    bindingReplacements,
    units: {
      addedIds: addedUnits.map((unit) => unit.id),
      removedIds: removedUnitIds,
      changedIds: changedUnits.map((unit) => unit.id),
      added: addedUnits,
      changed: changedUnits,
    },
    materials: {
      added: addedMaterials,
      removedKeys: removedMaterialKeys,
      changed: changedMaterials,
    },
    effects: effectsDelta(previous.effects, next.effects),
    next: {
      source: next.source,
      brief: structuredClone(next.brief),
      intent: next.intent === null ? null : structuredClone(next.intent),
      status: next.status,
      activation: next.activation,
      blockers: [...next.blockers].toSorted(compareText),
    },
  });
}

export function projectCapabilityProposalCovers(
  envelope: ProjectCapabilityProposal,
  proposal: ProjectCapabilityProposal,
): boolean {
  const envelopeRequirements = new Set(
    envelope.semanticRequirements.map(engineeringCapabilityRequirementKey),
  );
  if (
    proposal.semanticRequirements.some((requirement) =>
      !envelopeRequirements.has(engineeringCapabilityRequirementKey(requirement))
    )
  ) return false;
  const envelopeBindings = bindingKeyByRequirement(envelope);
  const proposalBindings = bindingKeyByRequirement(proposal);
  for (const requirement of proposal.semanticRequirements) {
    const key = engineeringCapabilityRequirementKey(requirement);
    if (envelopeBindings.get(key) !== proposalBindings.get(key)) return false;
  }
  const envelopeUnits = new Map(envelope.units.map((unit) => [unit.id, unit]));
  for (const unit of proposal.units) {
    const allowed = envelopeUnits.get(unit.id);
    if (
      !allowed || allowed.version !== unit.version ||
      allowed.manifestFingerprint.digest !== unit.manifestFingerprint.digest
    ) {
      return false;
    }
  }
  const envelopeMaterials = new Map(
    envelope.materials.map((material) => [materialKey(material), material]),
  );
  for (const material of proposal.materials) {
    const authorized = envelopeMaterials.get(materialKey(material));
    // Runtime mode is observed locally after authorization. Image identity and
    // exact byte estimates remain part of the human-approved ceiling.
    if (!authorized || !sameAuthorizedMaterial(authorized, material)) {
      return false;
    }
  }
  return effectsAreCoveredBy(envelope, proposal);
}

function effectsDelta(
  previous: ProjectCapabilityProposal["effects"],
  next: ProjectCapabilityProposal["effects"],
) {
  const change = <T>(left: readonly T[], right: readonly T[]) => {
    const leftByValue = new Map(left.map((value) => [deterministicJson(value), value]));
    const rightByValue = new Map(
      right.map((value) => [deterministicJson(value), value]),
    );
    return {
      added: [...rightByValue.entries()]
        .flatMap(([key, value]) => leftByValue.has(key) ? [] : [value])
        .toSorted((a, b) => compareText(deterministicJson(a), deterministicJson(b))),
      removed: [...leftByValue.entries()]
        .flatMap(([key, value]) => rightByValue.has(key) ? [] : [value])
        .toSorted((a, b) => compareText(deterministicJson(a), deterministicJson(b))),
    };
  };
  const services = change(previous.services, next.services);
  const volumes = change(previous.volumes, next.volumes);
  const networks = change(previous.networks, next.networks);
  const loopbackPorts = change(previous.loopbackPorts, next.loopbackPorts);
  const bindMounts = change(previous.bindMounts, next.bindMounts);
  const devices = change(previous.devices, next.devices);
  const secretSlots = change(previous.secretSlots, next.secretSlots);
  const licences = change(previous.licences, next.licences);
  const bytes = (before: number | null, after: number | null) => ({
    previous: before,
    next: after,
    delta: before === null || after === null ? null : after - before,
  });
  return {
    added: {
      services: services.added,
      volumes: volumes.added,
      networks: networks.added,
      loopbackPorts: loopbackPorts.added,
      bindMounts: bindMounts.added,
      devices: devices.added,
      secretSlots: secretSlots.added,
      licences: licences.added,
      security: previous.security === next.security ? null : next.security,
    },
    removed: {
      services: services.removed,
      volumes: volumes.removed,
      networks: networks.removed,
      loopbackPorts: loopbackPorts.removed,
      bindMounts: bindMounts.removed,
      devices: devices.removed,
      secretSlots: secretSlots.removed,
      licences: licences.removed,
      security: previous.security === next.security ? null : previous.security,
    },
    downloadBytes: bytes(previous.downloadBytes, next.downloadBytes),
    storageBytes: bytes(previous.storageBytes, next.storageBytes),
  };
}

/**
 * A later plan may use fewer units. It may never introduce a service, port,
 * writable volume/mount, device, secret slot, network class, or weaker
 * security declaration outside the already approved envelope.
 */
function effectsAreCoveredBy(
  envelope: ProjectCapabilityProposal,
  proposal: ProjectCapabilityProposal,
): boolean {
  const allowed = envelope.effects;
  const next = proposal.effects;
  if (allowed.security === "reviewed" && next.security !== "reviewed") return false;
  if (
    !isSubset(
      next.services,
      allowed.services,
      (item) => `${item.id}\u0000${item.lifecycle}`,
    )
  ) return false;
  if (
    !isSubset(
      next.volumes,
      allowed.volumes,
      (item) => `${item.id}\u0000${item.access}\u0000${item.preservation}`,
    )
  ) return false;
  if (!isSubset(next.networks, allowed.networks, (item) => item)) return false;
  if (!isSubset(next.loopbackPorts, allowed.loopbackPorts, (item) => String(item))) {
    return false;
  }
  if (
    !isSubset(
      next.bindMounts,
      allowed.bindMounts,
      (item) => `${item.target}\u0000${item.access}`,
    )
  ) return false;
  if (!isSubset(next.devices, allowed.devices, (item) => item)) return false;
  if (!isSubset(next.secretSlots, allowed.secretSlots, (item) => item)) return false;
  if (
    !isSubset(
      next.licences,
      allowed.licences,
      (item) => deterministicJson(item),
    )
  ) return false;
  if (
    !bytesAreCovered(next.downloadBytes, allowed.downloadBytes) ||
    !bytesAreCovered(next.storageBytes, allowed.storageBytes)
  ) return false;
  if (
    next.privileged !== false || next.dockerSocket !== false ||
    (allowed.security === "reviewed" && next.security !== "reviewed")
  ) return false;
  return true;
}

/**
 * Aggregate bytes may drop when an exact plan uses fewer already-authorized
 * materials. An authorized unknown aggregate may become a known exact remainder
 * after those unknown materials are dropped; retained material identities and
 * individual estimates are checked above. A new unknown or a larger known
 * estimate is an operational widening.
 */
function bytesAreCovered(
  next: number | null,
  allowed: number | null,
): boolean {
  if (allowed === null) return true;
  return next !== null && next <= allowed;
}

function isSubset<T>(
  candidate: readonly T[],
  allowed: readonly T[],
  key: (item: T) => string,
): boolean {
  const allowedKeys = new Set(allowed.map(key));
  return candidate.every((item) => allowedKeys.has(key(item)));
}

function bindingKeyByRequirement(
  proposal: ProjectCapabilityProposal,
): ReadonlyMap<string, string> {
  return new Map(proposal.bindings.map((binding) => {
    return [
      engineeringCapabilityRequirementKey(binding.requirement),
      deterministicJson(authorizationBinding(binding)),
    ];
  }));
}

/** Runtime availability is intentionally not part of the approved ceiling. */
function authorizationBinding(
  binding: ProjectCapabilityProposal["bindings"][number] | null,
): unknown {
  if (binding === null) return null;
  const candidate = binding.candidate;
  return {
    requirement: binding.requirement,
    // Qualification is a current local observation.  The human ceiling keeps
    // the exact selectable binding, adapter/profile and units, so an exact
    // `unqualified -> qualified` transition cannot manufacture an amendment.
    candidate: candidate === undefined ? null : {
      id: candidate.id,
      version: candidate.version,
      adapter: candidate.adapter,
      profile: candidate.profile,
      unitIds: candidate.unitIds,
    },
  };
}

function sameAuthorizationBinding(
  left: ProjectCapabilityProposal["bindings"][number] | null,
  right: ProjectCapabilityProposal["bindings"][number] | null,
): boolean {
  return deterministicJson(authorizationBinding(left)) ===
    deterministicJson(authorizationBinding(right));
}

/** `unavailable → emulated/native` is a local qualification change, not an amendment. */
function sameAuthorizedMaterial(
  left: ProjectCapabilityProposal["materials"][number],
  right: ProjectCapabilityProposal["materials"][number],
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageReference === right.imageReference &&
    left.downloadBytes === right.downloadBytes &&
    left.storageBytes === right.storageBytes;
}

function materialKey(value: ProjectCapabilityProposal["materials"][number]): string {
  return `${value.unitId}\u0000${value.materialId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
