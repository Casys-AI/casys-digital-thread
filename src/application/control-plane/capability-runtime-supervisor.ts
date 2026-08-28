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
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  type CapabilityRuntimeMaterialIdentity,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
  type CapabilityRuntimeRecovery,
  recoverCapabilityRuntime,
  type ResolvedCapabilityRuntimeBinding,
  type ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
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
  QualifiedCapabilityRuntimeBinding,
} from "./read-model/capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeExecutionEligibility,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimeQueueEligibility,
  CapabilityRuntimeStateObserver,
  ProjectCapabilityRuntimeAuthorizedBinding,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import { authorizeDurableCapabilityRuntimeHostMutation } from "./capability-runtime-host-authorization.ts";

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
  readonly states: CapabilityRuntimeStateObserver;
}

/**
 * The same server-owned authority is evaluated at queue and execution time.
 * Queue calls it before the project draft changes; executor integration calls
 * it again before a WAL lease or provider dispatch.
 */
export class CapabilityRuntimeSupervisor
  implements CapabilityRuntimeQueueEligibility, CapabilityRuntimeExecutionEligibility {
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
    const context = await this.options.contexts.read(input.project);
    assertExactProjectContext(context, input.project);
    assertAuthorizedEnvelope(context);
    const requirements = flattenEngineeringCapabilityRequirements(
      registered.runtimeDemand.capabilities,
    );
    const bindings = await resolveRuntimeBindings(
      requirements,
      context,
      this.options.states,
    );
    return deepFreeze({
      schemaVersion: "resolved-capability-runtime-operation/1.0" as const,
      projectId: input.project.project.id,
      operation: { id: input.operation.id, version: input.operation.version },
      authorizationFingerprint: context.authorization!.fingerprint,
      demandFingerprint: context.demand.plannedCeilingFingerprint,
      registryFingerprint: context.demand.registryFingerprint,
      bindings,
    });
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

async function resolveRuntimeBindings(
  requirements: readonly RequiredEngineeringCapability[],
  context: ProjectCapabilityRuntimeContext,
  states: CapabilityRuntimeStateObserver,
): Promise<readonly ResolvedCapabilityRuntimeBinding[]> {
  const selected = requirements.map((requirement) =>
    selectResolvedBinding(requirement, context.catalog, context)
  );
  const materials = uniqueMaterials(selected.flatMap((binding) => binding.materials));
  const observations = await states.observe(materials);
  for (const binding of selected) {
    const required = requirements.find((candidate) =>
      candidate.id === binding.capability.id &&
      candidate.version === binding.capability.version &&
      candidate.use === binding.capability.use
    )!;
    for (const material of binding.materials) {
      const state = observations.get(capabilityRuntimeMaterialKey(material));
      if (!state) {
        throw new CapabilityRuntimeAuthorizationError(
          `Capability runtime has no fresh observation for ${material.unitId}/${material.materialId}.`,
        );
      }
      if (state.material !== "installed" || state.runtime !== "active") {
        throw new CapabilityRuntimeAuthorizationError(
          `Capability runtime material ${material.unitId}/${material.materialId} is ${state.material}/${state.runtime}, not installed/active.`,
        );
      }
      if (!qualificationCovers(state.qualification, required.minimumQualification)) {
        throw new CapabilityRuntimeAuthorizationError(
          `Capability runtime material ${material.unitId}/${material.materialId} is ${state.qualification}, below ${required.minimumQualification} qualification.`,
        );
      }
    }
  }
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
  const materials = planned.unitIds.flatMap((unitId) => {
    const unit = catalog.units.find((candidate) => candidate.id === unitId);
    if (!unit || !binding.unitIds.includes(unitId)) {
      throw new CapabilityRuntimeAuthorizationError(
        `Selected capability binding ${binding.id} names an invalid atomic unit ${unitId}.`,
      );
    }
    return unit.materials.map((material) => ({
      unitId: unit.id,
      materialId: material.id,
      imageDigest: imageDigest(material.imageReference),
    }));
  });
  const result: ResolvedCapabilityRuntimeBinding = {
    capability: {
      id: requirement.id,
      version: requirement.version,
      use: requirement.use,
    },
    binding: { id: binding.id, version: binding.version },
    adapter: { ...binding.adapter },
    profile: binding.profile === null ? null : structuredClone(binding.profile),
    materials: uniqueMaterials(materials),
  };
  assertAuthorizationAllowsBinding(context.authorization!, result, planned.unitIds);
  return result;
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
  observed: CapabilityRuntimeObservedState["qualification"] | CapabilityQualification,
  required: CapabilityQualification,
): boolean {
  return observed === "qualified" ||
    (observed === "compatible" && required === "compatible");
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
 * Keeps the host lifecycle mutation order explicit without implementing a host
 * backend. A caller must persist the journal intent before invoking the future
 * Docker/Microsandbox adapter, and recovery always rereads host observation.
 */
export class CapabilityRuntimeLifecycleCoordinator {
  constructor(
    private readonly journal: CapabilityRuntimeJournal,
    private readonly leases: CapabilityRuntimeLeaseStore,
    private readonly states: CapabilityRuntimeStateObserver,
    private readonly host: CapabilityRuntimeHostMutator,
  ) {}

  async acquireLease(lease: CapabilityRuntimeLease): Promise<void> {
    await this.leases.acquire(lease);
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
      const authorization = await authorizeDurableCapabilityRuntimeHostMutation(
        entry,
        this.journal,
      );
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
        observation: null,
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
    !removalPlan.ownedMaterials.some((material) =>
      capabilityRuntimeMaterialKey(material) ===
        capabilityRuntimeMaterialKey(entry.material) &&
      material.imageDigest === entry.material.imageDigest
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
