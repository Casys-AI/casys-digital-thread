/**
 * Operational capability guards and lifecycle coordination.
 *
 * This module never selects a provider, changes a project, dispatches an
 * engineering provider, or interprets a result. It consumes only server-owned
 * registry/context/host observations and fails closed before queue commit or
 * executor WAL/provider boundaries.
 */

import {
  type CapabilityRuntimeAdministrativeRemovalPlan,
  capabilityRuntimeBindingKey,
  type CapabilityRuntimeHostLifecycle,
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeRecovery,
  recoverCapabilityRuntime,
  type ResolvedCapabilityRuntimeBinding,
  type ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import {
  type CapabilityQualification,
  compareEngineeringCapabilities,
  flattenEngineeringCapabilityRequirements,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import {
  evaluateProjectCapabilityDemandCoverage,
} from "../../domain/capability/project-capability-demand.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringBasisRef,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeCatalog,
  ProjectCapabilityPlan,
  QualifiedCapabilityRuntimeBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeExecutionEligibility,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimePreparationEligibility,
  CapabilityRuntimeQueueEligibility,
  CapabilityRuntimeStateObserver,
  ProjectCapabilityRuntimeAuthorizedBinding,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import {
  authorizeDurableAdministrativeMaterialRemoval,
  authorizeDurableMaterialAcquire,
  authorizeDurableNormalRuntimeStart,
  authorizeDurableRuntimeStop,
} from "./capability-runtime-host-authorization.ts";

/** Narrow registry port: server composition owns exact operation descriptors. */
export interface CapabilityRuntimeOperationRegistry {
  require(
    operation: Pick<EngineeringOperationRef, "id" | "version">,
  ): {
    readonly id: string;
    readonly version: string;
    readonly runtimeDemand:
      | { readonly kind: "none" }
      | {
        readonly kind: "required";
        readonly capabilities: readonly RequiredEngineeringCapability[];
      };
  };
}

export class CapabilityRuntimeAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeAuthorizationError";
  }
}

export interface CapabilityRuntimeSupervisorOptions {
  readonly contexts: ProjectCapabilityRuntimeContextReader;
  readonly operations: CapabilityRuntimeOperationRegistry;
}

/**
 * The same server-owned authority is evaluated at queue and execution time.
 * Both checks are deliberately cold: they seal/recheck exact project,
 * authorization, registry, binding, material digest and lifecycle identity;
 * neither observes nor mutates a host. JIT acquisition belongs after the final
 * executor recheck and before its WAL/provider boundary.
 */
export class CapabilityRuntimeSupervisor
  implements
    CapabilityRuntimeQueueEligibility,
    CapabilityRuntimeExecutionEligibility,
    CapabilityRuntimePreparationEligibility {
  constructor(private readonly options: CapabilityRuntimeSupervisorOptions) {}

  async validate(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly workItem: EngineeringWorkItem;
    readonly operation: EngineeringOperationRef;
    readonly basis: EngineeringBasisRef;
  }): Promise<ResolvedCapabilityRuntimeOperation | undefined> {
    return await this.#authorize({
      project: input.project,
      workItem: input.workItem,
      operation: input.operation,
    });
  }

  async requireExecution(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly run: EngineeringAgentRun;
    readonly workItem: EngineeringWorkItem;
    readonly operation: EngineeringOperationRef;
  }): Promise<ResolvedCapabilityRuntimeOperation | undefined> {
    if (input.run.workItemId !== input.workItem.id) {
      throw new CapabilityRuntimeAuthorizationError(
        "Capability runtime execution run does not belong to the supplied work item.",
      );
    }
    return await this.#authorize(input);
  }

  /**
   * Preparation never invents a work item or a run merely to start a private
   * server-owned prerequisite.  The registered operation must have exactly
   * one preparation demand; any execution, mixed, or no-runtime operation is
   * refused before the host is observed or mutated.
   */
  async requirePreparation(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<ResolvedCapabilityRuntimeOperation> {
    const registered = this.options.operations.require(input.operation);
    assertRegisteredOperation(registered, input.operation);
    if (
      registered.runtimeDemand.kind !== "required" ||
      registered.runtimeDemand.capabilities.length !== 1 ||
      registered.runtimeDemand.capabilities[0]?.use !== "preparation"
    ) {
      throw new CapabilityRuntimeAuthorizationError(
        "Capability runtime preparation requires one exact registered preparation demand.",
      );
    }
    const resolved = await this.#authorizeRegistered({
      project: input.project,
      operation: input.operation,
      registered,
    });
    if (
      resolved.bindings.length !== 1 ||
      resolved.bindings[0]?.capability.use !== "preparation"
    ) {
      throw new CapabilityRuntimeAuthorizationError(
        "Capability runtime preparation did not resolve one exact preparation binding.",
      );
    }
    return resolved;
  }

  async #authorize(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly workItem: EngineeringWorkItem;
    readonly operation: EngineeringOperationRef;
  }): Promise<ResolvedCapabilityRuntimeOperation | undefined> {
    assertWorkItemOperation(input.workItem, input.operation);
    const registered = this.options.operations.require(input.operation);
    assertRegisteredOperation(registered, input.operation);
    if (registered.runtimeDemand.kind === "none") {
      return undefined;
    }
    return await this.#authorizeRegistered({ ...input, registered });
  }

  async #authorizeRegistered(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
    readonly registered: {
      readonly id: string;
      readonly version: string;
      readonly runtimeDemand:
        | { readonly kind: "none" }
        | {
          readonly kind: "required";
          readonly capabilities: readonly RequiredEngineeringCapability[];
        };
    };
  }): Promise<ResolvedCapabilityRuntimeOperation> {
    if (input.registered.runtimeDemand.kind !== "required") {
      throw new CapabilityRuntimeAuthorizationError(
        "Capability runtime authorization requires a registered runtime demand.",
      );
    }
    const context = await this.options.contexts.read(input.project);
    assertExactProjectContext(context, input.project);
    assertAuthorizedEnvelope(context);
    const requirements = flattenEngineeringCapabilityRequirements(
      input.registered.runtimeDemand.capabilities,
    );
    const bindings = resolveRuntimeBindings(requirements, context);
    assertResolvedMaterialsHaveActiveAdminLock(context, bindings);
    return deepFreeze({
      schemaVersion: "resolved-capability-runtime-operation/2.0" as const,
      projectId: input.project.project.id,
      operation: { id: input.operation.id, version: input.operation.version },
      authorizationFingerprint: context.authorization!.fingerprint,
      demandFingerprint: context.demand.plannedCeilingFingerprint,
      registryFingerprint: context.demand.registryFingerprint,
      bindings,
    });
  }
}

/**
 * The brief envelope grants project scope; the local lock grants JIT on this
 * host. Both identities must agree at the atomic-unit manifest boundary.
 */
function assertResolvedMaterialsHaveActiveAdminLock(
  context: ProjectCapabilityRuntimeContext,
  bindings: readonly ResolvedCapabilityRuntimeBinding[],
): void {
  const approved = new Map(
    context.authorization!.allowedUnits.map((unit) => [unit.id, unit]),
  );
  const requiredUnitIds = new Set(
    bindings.flatMap((binding) => binding.materials.map((material) => material.unitId)),
  );
  for (const unitId of requiredUnitIds) {
    const authorization = approved.get(unitId);
    const lock = context.lock.units.find((candidate) => candidate.id === unitId);
    if (
      !authorization || !lock || lock.desired !== "active" ||
      lock.version !== authorization.version ||
      !sameFingerprint(lock.manifestFingerprint, authorization.manifestFingerprint)
    ) {
      throw new CapabilityRuntimeAuthorizationError(
        `Capability runtime local administrative lock does not permit exact unit ${unitId}.`,
      );
    }
  }
}

function assertWorkItemOperation(
  workItem: EngineeringWorkItem,
  operation: EngineeringOperationRef,
): void {
  if (
    !workItem.operation || workItem.operation.id !== operation.id ||
    workItem.operation.version !== operation.version
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Capability runtime guard requires the exact current work-item operation.",
    );
  }
}

function assertRegisteredOperation(
  registered: ReturnType<CapabilityRuntimeOperationRegistry["require"]>,
  operation: EngineeringOperationRef,
): void {
  if (registered.id !== operation.id || registered.version !== operation.version) {
    throw new CapabilityRuntimeAuthorizationError(
      "Capability runtime registry returned a different operation identity.",
    );
  }
}

function assertExactProjectContext(
  context: ProjectCapabilityRuntimeContext,
  project: EngineeringProjectSnapshot,
): void {
  const snapshot = context.demand.projectSnapshot;
  if (
    snapshot.projectId !== project.project.id || snapshot.snapshotId !== project.id ||
    snapshot.revision !== project.revision
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Capability runtime context is not compiled from the exact current project snapshot.",
    );
  }
  if (
    context.demand.status !== "resolved" ||
    context.demand.plannedCeiling.status !== "resolved"
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Project capability demand is unresolved.",
    );
  }
  if (
    context.plan.demandFingerprint.digest !==
      context.demand.plannedCeilingFingerprint.digest ||
    context.plan.demandFingerprint.algorithm !==
      context.demand.plannedCeilingFingerprint.algorithm ||
    context.plan.registryFingerprint.digest !==
      context.demand.registryFingerprint.digest ||
    context.plan.registryFingerprint.algorithm !==
      context.demand.registryFingerprint.algorithm
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Capability runtime plan does not bind the exact project demand and registry.",
    );
  }
}

function assertAuthorizedEnvelope(context: ProjectCapabilityRuntimeContext): void {
  const authorization = context.authorization;
  if (!authorization) {
    throw new CapabilityRuntimeAuthorizationError(
      "Project capability runtime is not-authorized; historical projects are not implicitly covered.",
    );
  }
  if (authorization.status !== "authorized") {
    throw new CapabilityRuntimeAuthorizationError(
      "Project capability runtime authorization is revoked.",
    );
  }
  if (authorization.projectId !== context.demand.projectSnapshot.projectId) {
    throw new CapabilityRuntimeAuthorizationError(
      "Project capability runtime authorization belongs to another project.",
    );
  }
  assertUnambiguousAuthorizedBindings(authorization.allowedBindings);
  assertExactAuthorizedUnits(context.catalog, authorization);
  const coverage = evaluateProjectCapabilityDemandCoverage(
    context.demand,
    authorization.allowedCapabilities,
  );
  if (!coverage.fits) {
    throw new CapabilityRuntimeAuthorizationError(
      "Project capability runtime authorization does not cover the current planned ceiling.",
    );
  }
}

function assertExactAuthorizedUnits(
  catalog: CapabilityRuntimeCatalog,
  authorization: NonNullable<ProjectCapabilityRuntimeContext["authorization"]>,
): void {
  const authorized = new Map(authorization.allowedUnits.map((unit) => [unit.id, unit]));
  for (const binding of authorization.allowedBindings) {
    for (const unitId of binding.unitIds) {
      const approved = authorized.get(unitId);
      const current = catalog.units.find((unit) => unit.id === unitId);
      if (
        !approved || !current || approved.version !== current.version ||
        !sameFingerprint(approved.manifestFingerprint, current.manifestFingerprint)
      ) {
        throw new CapabilityRuntimeAuthorizationError(
          `Project capability authorization does not admit the exact current atomic unit ${unitId}.`,
        );
      }
    }
  }
}

function resolveRuntimeBindings(
  requirements: readonly RequiredEngineeringCapability[],
  context: ProjectCapabilityRuntimeContext,
): readonly ResolvedCapabilityRuntimeBinding[] {
  const selected = requirements.map((requirement) =>
    selectResolvedBinding(requirement, context.catalog, context)
  );
  return selected.toSorted(compareResolvedBinding);
}

function selectResolvedBinding(
  requirement: RequiredEngineeringCapability,
  catalog: CapabilityRuntimeCatalog,
  context: ProjectCapabilityRuntimeContext,
): ResolvedCapabilityRuntimeBinding {
  const plannedMatches = context.plan.bindings.filter((candidate) =>
    candidate.requirement.id === requirement.id &&
    candidate.requirement.version === requirement.version &&
    candidate.requirement.use === requirement.use
  );
  if (plannedMatches.length !== 1) {
    throw new CapabilityRuntimeAuthorizationError(
      `Project capability plan has ${plannedMatches.length} selected candidates for ${requirement.id}@${requirement.version}; server selection is ambiguous.`,
    );
  }
  const planned = plannedMatches[0]!;
  if (planned.status !== "selected" || !planned.binding) {
    throw new CapabilityRuntimeAuthorizationError(
      `No resolved binding is selected for ${requirement.id}@${requirement.version}.`,
    );
  }
  const catalogMatches = catalog.bindings.filter((candidate) =>
    candidate.id === planned.binding!.id &&
    candidate.version === planned.binding!.version
  );
  if (catalogMatches.length !== 1) {
    throw new CapabilityRuntimeAuthorizationError(
      `Capability runtime catalogue has ${catalogMatches.length} entries for selected binding ${planned.binding.id}@${planned.binding.version}; server selection is ambiguous.`,
    );
  }
  const binding = catalogMatches[0]!;
  if (!bindingMatchesRequirement(binding, requirement)) {
    throw new CapabilityRuntimeAuthorizationError(
      `Selected capability binding ${planned.binding.id} is absent or does not match its semantic requirement.`,
    );
  }
  if (!qualificationCovers(binding.qualification, requirement.minimumQualification)) {
    throw new CapabilityRuntimeAuthorizationError(
      `Selected capability binding ${binding.id} does not meet ${requirement.minimumQualification} qualification.`,
    );
  }
  const materialLifecyclePairs = planned.unitIds.flatMap((unitId) => {
    const unit = catalog.units.find((candidate) => candidate.id === unitId);
    if (!unit || !binding.unitIds.includes(unitId)) {
      throw new CapabilityRuntimeAuthorizationError(
        `Selected capability binding ${binding.id} names an invalid atomic unit ${unitId}.`,
      );
    }
    return unit.materials.map((material) => {
      const identity = {
        unitId: unit.id,
        materialId: material.id,
        imageDigest: imageDigest(material.imageReference),
      };
      return {
        material: identity,
        lifecycle: lifecycleForCatalogMaterial(identity, material),
      };
    });
  });
  const materials = uniqueMaterials(
    materialLifecyclePairs.map((pair) => pair.material),
  );
  const hostLifecycles = uniqueHostLifecycles(
    materialLifecyclePairs.map((pair) => pair.lifecycle),
  );
  const runtimeModes = exactResolvedRuntimeModes(
    binding,
    materials,
    context.plan,
  );
  const result: ResolvedCapabilityRuntimeBinding = {
    capability: {
      id: requirement.id,
      version: requirement.version,
      use: requirement.use,
      minimumQualification: requirement.minimumQualification,
    },
    binding: { id: binding.id, version: binding.version },
    effectiveQualification: binding.qualification as "compatible" | "qualified",
    adapter: { ...binding.adapter },
    profile: binding.profile === null ? null : structuredClone(binding.profile),
    materials,
    runtimeModes,
    hostLifecycles,
  };
  assertAuthorizationAllowsBinding(context.authorization!, result, planned.unitIds);
  return result;
}

function exactResolvedRuntimeModes(
  binding: QualifiedCapabilityRuntimeBinding,
  materials: readonly CapabilityRuntimeMaterialIdentity[],
  plan: ProjectCapabilityPlan,
): ResolvedCapabilityRuntimeBinding["runtimeModes"] {
  const modes = materials.map((material) => {
    const matches = binding.runtimeModes.filter((candidate) =>
      candidate.material.unitId === material.unitId &&
      candidate.material.materialId === material.materialId &&
      candidate.material.imageDigest === material.imageDigest
    );
    if (matches.length !== 1) {
      throw new CapabilityRuntimeAuthorizationError(
        `Selected capability binding ${binding.id} has no one exact runtime mode for ${material.unitId}/${material.materialId}.`,
      );
    }
    const mode = matches[0]!;
    const planned = plan.materials.filter((candidate) =>
      candidate.unitId === material.unitId &&
      candidate.materialId === material.materialId
    );
    if (
      planned.length !== 1 || planned[0]!.mode === "unavailable" ||
      planned[0]!.mode !== mode.mode
    ) {
      throw new CapabilityRuntimeAuthorizationError(
        `Project capability plan does not retain the exact runnable mode for ${material.unitId}/${material.materialId}.`,
      );
    }
    return structuredClone(mode);
  });
  if (modes.length !== binding.runtimeModes.length) {
    throw new CapabilityRuntimeAuthorizationError(
      `Selected capability binding ${binding.id} has an extraneous runtime mode.`,
    );
  }
  return modes.toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left.material).localeCompare(
      capabilityRuntimeMaterialKey(right.material),
    )
  );
}

function assertAuthorizationAllowsBinding(
  authorization: NonNullable<ProjectCapabilityRuntimeContext["authorization"]>,
  resolved: ResolvedCapabilityRuntimeBinding,
  selectedUnitIds: readonly string[],
): void {
  const allowedMatches = authorization.allowedBindings.filter((candidate) =>
    sameAuthorizedBindingIdentity(candidate, resolved)
  );
  if (allowedMatches.length !== 1) {
    throw new CapabilityRuntimeAuthorizationError(
      `Project capability authorization does not admit binding ${resolved.binding.id}@${resolved.binding.version} exactly once.`,
    );
  }
  const allowed = allowedMatches[0]!;
  const exactUnits = [...selectedUnitIds].toSorted().join("\u0000") ===
    [...allowed.unitIds].toSorted().join("\u0000");
  if (!exactUnits || !sameMaterialSet(allowed.materials, resolved.materials)) {
    throw new CapabilityRuntimeAuthorizationError(
      `Project capability authorization does not bind the exact units and material digests for ${resolved.binding.id}.`,
    );
  }
}

function assertUnambiguousAuthorizedBindings(
  bindings: readonly ProjectCapabilityRuntimeAuthorizedBinding[],
): void {
  const identities = new Set<string>();
  for (const binding of bindings) {
    const key = [
      binding.capability.id,
      binding.capability.version,
      binding.capability.use,
    ].join("\u0000");
    if (identities.has(key)) {
      throw new CapabilityRuntimeAuthorizationError(
        `Project capability authorization has multiple exact bindings for ${binding.capability.id}@${binding.capability.version}; an amendment must replace rather than silently add a binding.`,
      );
    }
    identities.add(key);
  }
}

function sameAuthorizedBindingIdentity(
  left: ProjectCapabilityRuntimeAuthorizedBinding,
  right: ResolvedCapabilityRuntimeBinding,
): boolean {
  return left.capability.id === right.capability.id &&
    left.capability.version === right.capability.version &&
    left.capability.use === right.capability.use &&
    left.binding.id === right.binding.id &&
    left.binding.version === right.binding.version &&
    left.adapter.id === right.adapter.id &&
    left.adapter.version === right.adapter.version &&
    left.adapter.source === right.adapter.source &&
    sameProfile(left.profile, right.profile);
}

function sameProfile(
  left: ProjectCapabilityRuntimeAuthorizedBinding["profile"],
  right: ResolvedCapabilityRuntimeBinding["profile"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    ((left.fingerprint === null && right.fingerprint === null) ||
      (left.fingerprint !== null && right.fingerprint !== null &&
        sameFingerprint(left.fingerprint, right.fingerprint)));
}

function sameMaterialSet(
  left: readonly CapabilityRuntimeMaterialIdentity[],
  right: readonly CapabilityRuntimeMaterialIdentity[],
): boolean {
  const materialToken = (material: CapabilityRuntimeMaterialIdentity) =>
    `${capabilityRuntimeMaterialKey(material)}\u0000${material.imageDigest}`;
  const leftTokens = left.map(materialToken).toSorted();
  const rightTokens = right.map(materialToken).toSorted();
  return leftTokens.length === rightTokens.length &&
    leftTokens.every((token, index) => token === rightTokens[index]);
}

function bindingMatchesRequirement(
  binding: QualifiedCapabilityRuntimeBinding,
  requirement: RequiredEngineeringCapability,
): boolean {
  return binding.capability.id === requirement.id &&
    binding.capability.version === requirement.version &&
    binding.use === requirement.use;
}

function uniqueMaterials(
  materials: readonly CapabilityRuntimeMaterialIdentity[],
): readonly CapabilityRuntimeMaterialIdentity[] {
  const unique = new Map<string, CapabilityRuntimeMaterialIdentity>();
  for (const material of materials) {
    const key = capabilityRuntimeMaterialKey(material);
    const previous = unique.get(key);
    if (previous && previous.imageDigest !== material.imageDigest) {
      throw new CapabilityRuntimeAuthorizationError(
        `Atomic material ${material.unitId}/${material.materialId} has inconsistent image digests.`,
      );
    }
    unique.set(key, { ...material });
  }
  return [...unique.values()].toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left).localeCompare(
      capabilityRuntimeMaterialKey(right),
    )
  );
}

function imageDigest(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  const digest = index >= 0 ? reference.slice(index + marker.length) : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new CapabilityRuntimeAuthorizationError(
      "A selected atomic material does not carry an exact sha256 image digest.",
    );
  }
  return digest;
}

function qualificationCovers(
  observed: CapabilityQualification | "unqualified" | "revoked",
  required: CapabilityQualification,
): boolean {
  return observed === "qualified" ||
    (observed === "compatible" && required === "compatible");
}

function lifecycleForCatalogMaterial(
  material: CapabilityRuntimeMaterialIdentity,
  catalogMaterial: CapabilityRuntimeCatalog["units"][number]["materials"][number],
): CapabilityRuntimeHostLifecycle {
  switch (catalogMaterial.lifecycle) {
    case "persistent":
      return {
        material,
        kind: "persistent-compose",
        launchGroup: catalogMaterial.launchGroup === null
          ? null
          : structuredClone(catalogMaterial.launchGroup),
      };
    case "ephemeral":
      return { material, kind: "ephemeral-microsandbox", launchGroup: null };
    case "cache":
      return { material, kind: "cache-only", launchGroup: null };
  }
}

function uniqueHostLifecycles(
  lifecycles: readonly CapabilityRuntimeHostLifecycle[],
): readonly CapabilityRuntimeHostLifecycle[] {
  const unique = new Map<string, CapabilityRuntimeHostLifecycle>();
  for (const lifecycle of lifecycles) {
    const key = capabilityRuntimeMaterialKey(lifecycle.material);
    const previous = unique.get(key);
    if (
      previous && JSON.stringify(previous) !== JSON.stringify(lifecycle)
    ) {
      throw new CapabilityRuntimeAuthorizationError(
        `Atomic material ${lifecycle.material.unitId}/${lifecycle.material.materialId} has inconsistent host lifecycles.`,
      );
    }
    unique.set(key, structuredClone(lifecycle));
  }
  return [...unique.values()].toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left.material).localeCompare(
      capabilityRuntimeMaterialKey(right.material),
    )
  );
}

function compareResolvedBinding(
  left: ResolvedCapabilityRuntimeBinding,
  right: ResolvedCapabilityRuntimeBinding,
): number {
  return compareEngineeringCapabilities(
    {
      ...left.capability,
      minimumQualification: "compatible",
    },
    {
      ...right.capability,
      minimumQualification: "compatible",
    },
  ) || capabilityRuntimeBindingKey(left.binding).localeCompare(
    capabilityRuntimeBindingKey(right.binding),
  );
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

/**
 * Keeps the host lifecycle mutation order explicit without embedding a host
 * backend. A caller must persist the journal intent before invoking the
 * Docker Compose or Microsandbox adapter, and recovery always rereads host
 * observation.
 */
export class CapabilityRuntimeLifecycleCoordinator {
  constructor(
    private readonly journal: CapabilityRuntimeJournal,
    private readonly leases: CapabilityRuntimeLeaseStore,
    private readonly states: CapabilityRuntimeStateObserver,
    private readonly host: CapabilityRuntimeHostMutator,
  ) {}

  async acquireLease(lease: CapabilityRuntimeLease): Promise<void> {
    const claim = await this.leases.claim(lease);
    if (claim.status === "existing") {
      throw new CapabilityRuntimeAuthorizationError(
        "Capability runtime lease already exists; lifecycle coordination requires an explicit recovery path.",
      );
    }
  }

  async releaseLease(leaseId: string): Promise<void> {
    await this.leases.release(leaseId);
  }

  async mutate(
    entry: CapabilityRuntimeJournalEntry,
    removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan,
  ): Promise<CapabilityRuntimeJournalOutcome> {
    assertMutationContract(entry, removalPlan);
    await this.journal.appendBeforeMutation(entry);
    let outcome: CapabilityRuntimeJournalOutcome;
    try {
      const authorization = entry.action === "material-acquire"
        ? await authorizeDurableMaterialAcquire(entry, this.journal)
        : entry.action === "runtime-start"
        ? await authorizeDurableNormalRuntimeStart(entry, this.journal)
        : entry.action === "runtime-stop"
        ? await authorizeDurableRuntimeStop(entry, this.journal)
        : removalPlan
        ? await authorizeDurableAdministrativeMaterialRemoval(
          entry,
          removalPlan,
          this.journal,
        )
        : (() => {
          throw new CapabilityRuntimeAuthorizationError(
            "Administrative material removal requires its exact reviewed plan.",
          );
        })();
      outcome = await this.host.mutate({
        authorization,
        ...(removalPlan ? { removalPlan } : {}),
      });
    } catch (error) {
      outcome = {
        schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
        journalEntryId: entry.id,
        // This is recorded only after the mutator has thrown.  A planned
        // timestamp is intent metadata, never evidence that a command ended.
        recordedAt: new Date().toISOString(),
        status: "uncertain",
        observations: entry.materials.map((material) => ({ material, state: null })),
        detail: compactHostError(error),
      };
    }
    if (outcome.journalEntryId !== entry.id) {
      throw new CapabilityRuntimeAuthorizationError(
        "Capability runtime host returned an outcome for another journal entry.",
      );
    }
    await this.journal.appendOutcome(outcome);
    return outcome;
  }

  async recover(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<CapabilityRuntimeRecovery> {
    const [states, journal, outcomes] = await Promise.all([
      this.states.observe(materials),
      this.journal.list(),
      this.journal.listOutcomes(),
    ]);
    return recoverCapabilityRuntime(
      materials.flatMap((material) => {
        const state = states.get(capabilityRuntimeMaterialKey(material));
        return state ? [{ material, state }] : [];
      }),
      journal,
      outcomes,
    );
  }
}

function compactHostError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 512
    ? `${message.slice(0, 509)}...`
    : message || "Host mutation threw.";
}

function assertMutationContract(
  entry: CapabilityRuntimeJournalEntry,
  removalPlan: CapabilityRuntimeAdministrativeRemovalPlan | undefined,
): void {
  if (entry.action === "runtime-qualification-start") {
    throw new CapabilityRuntimeAuthorizationError(
      "Private runtime qualification starts are available only through the launch-group qualification supervisor.",
    );
  }
  if (entry.action !== "material-remove") {
    if (removalPlan !== undefined) {
      throw new CapabilityRuntimeAuthorizationError(
        "Only a material-remove mutation may carry an administrative removal plan.",
      );
    }
    return;
  }
  if (!removalPlan || !entry.administrativeRemovalPlanFingerprint) {
    throw new CapabilityRuntimeAuthorizationError(
      "Material removal requires an exact administrative removal plan.",
    );
  }
  if (
    !sameFingerprint(
      entry.administrativeRemovalPlanFingerprint,
      removalPlan.fingerprint,
    )
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Material removal journal entry does not bind the supplied administrative plan.",
    );
  }
  if (
    !entry.materials.every((entryMaterial) =>
      removalPlan.ownedMaterials.some((material) =>
        capabilityRuntimeMaterialKey(material) ===
          capabilityRuntimeMaterialKey(entryMaterial) &&
        material.imageDigest === entryMaterial.imageDigest
      )
    )
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Administrative removal plan does not own the selected material.",
    );
  }
  if (
    !removalPlan.preserveThread || !removalPlan.preserveCas ||
    !removalPlan.preserveWal || !removalPlan.preserveProjectState ||
    !removalPlan.preserveRetainedVolumes
  ) {
    throw new CapabilityRuntimeAuthorizationError(
      "Capability runtime removal must preserve Thread, CAS, WAL, project state, and retained volumes.",
    );
  }
}
