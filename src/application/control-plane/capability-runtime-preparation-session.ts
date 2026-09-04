/**
 * Short private-runtime session for one server-owned preparation operation.
 *
 * This is intentionally not a reduced execution session.  A draft-preparation
 * path has no work item, agent run, provider WAL, or caller-selected runtime
 * envelope to borrow.  It first resolves the registered preparation demand
 * through the normal cold authority, then acquires exactly one persistent
 * launch-group lease.  Provider ambiguity retains that lease for host
 * recovery; successful durable draft capture releases it.
 */

import {
  type CapabilityRuntimeHostLifecycle,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  deriveEffectiveCapabilityRuntimeLaunchProjection,
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
  validateCapabilityRuntimeLease,
  validateResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimePreparationEligibility,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimePreparationPort,
  CapabilityRuntimePreparationSession,
} from "../ports/out/capability/capability-runtime-preparation-session.ts";
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";
import type { CapabilityRuntimeGlobalJitDemandReader } from "./capability-runtime-jit-demand.ts";

/** Preparation is bounded to one brief host reservation, not a run lifetime. */
const PREPARATION_LEASE_TTL_MS = 15 * 60 * 1_000;

export class CapabilityRuntimePreparationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimePreparationUnavailableError";
  }
}

export interface CapabilityRuntimePreparationSessionCoordinatorOptions {
  /** Cold server authority: it validates registry, authorization and digest. */
  readonly authorization: CapabilityRuntimePreparationEligibility;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly groups: CapabilityRuntimeLaunchGroupSupervisor;
  /**
   * A preparation lease can share a persistent group with executions from
   * other projects. Without a host-wide demand census, cleanup releases only
   * its lease and retains the group rather than inferring idleness.
   */
  readonly hasAnyRemainingJitDemand?: CapabilityRuntimeGlobalJitDemandReader;
  readonly now?: () => string;
}

/**
 * Owns a precise pre-provider activation boundary for a fixed registered
 * preparation operation.  It deliberately accepts neither a capability nor
 * provider/image/endpoint/tool/arguments/source from its caller.
 */
export class CapabilityRuntimePreparationSessionCoordinator
  implements CapabilityRuntimePreparationPort {
  readonly #now: () => string;

  constructor(
    private readonly options: CapabilityRuntimePreparationSessionCoordinatorOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async begin(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<CapabilityRuntimePreparationSession> {
    const scope = await this.#scope(input);

    const at = this.#now();
    const effectiveRuntimeProjection =
      await deriveEffectiveCapabilityRuntimeLaunchProjection({
        launchGroup: scope.groups[0]!,
        operation: scope.resolved,
      });
    const initialLease = await candidateLease({
      projectId: input.project.project.id,
      projectSnapshotId: input.project.id,
      projectRevision: input.project.revision,
      operationalCapabilityFingerprint: scope.fingerprint.digest,
      bindingIds: scope.resolved.bindings.map((candidate) => candidate.binding.id),
      lifecycles: scope.lifecycles,
      groups: scope.groups,
      at,
    });
    const reservation = await recoverableLease(
      initialLease,
      at,
      this.options.leases,
    );

    // H1 journals before any Docker mutation. An exact live reservation can be
    // resumed after a process interruption, because reaching this coordinator
    // is permitted only while the export WAL is still pre-dispatch. Expired
    // reservations receive an immutable successor linked to the old id; old
    // records are retained instead of deleted or silently overwritten.
    const activated = await this.options.groups.ensureActive({
      group: scope.groups[0]!,
      expectedMaterials: scope.lifecycles.map((lifecycle) => lifecycle.material),
      effectiveRuntimeProjection,
      resolvedOperation: scope.resolved,
      projectId: input.project.project.id,
      lease: reservation.lease,
      at,
      reuseExistingLease: reservation.reuseExistingLease,
      // Recheck the same sealed preparation authority while H1 is held. A
      // concurrent revoke or lock change therefore wins before a lease claim,
      // journal intent, pull, or Compose start.
      guard: async () => {
        try {
          const current = validateResolvedCapabilityRuntimeOperation(
            await this.options.authorization.requirePreparation(input),
          );
          return (await fingerprintResolvedCapabilityRuntimeOperation(current))
            .digest === scope.fingerprint.digest;
        } catch {
          return false;
        }
      },
    });
    assertActiveExactMaterials(activated.states, scope.lifecycles);
    const stored = await this.options.leases.read(reservation.lease.id);
    if (!stored) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation activation completed without an exact durable lease.",
      );
    }
    return new ActiveCapabilityRuntimePreparationSession(
      equivalentLease(stored, reservation.lease),
      scope.groups,
      this.options,
    );
  }

  /**
   * A recorded replay has already captured and reread its provider result.
   * This recovery path never calls ensureActive: it only releases an exact
   * extant lease, and the group supervisor preserves any other live lease/JIT
   * protection before deciding whether a stop is safe.
   */
  async releaseRecorded(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<void> {
    const scope = await this.#scope(input);
    const at = this.#now();
    const initialLease = await candidateLease({
      projectId: input.project.project.id,
      projectSnapshotId: input.project.id,
      projectRevision: input.project.revision,
      operationalCapabilityFingerprint: scope.fingerprint.digest,
      bindingIds: scope.resolved.bindings.map((candidate) => candidate.binding.id),
      lifecycles: scope.lifecycles,
      groups: scope.groups,
      at,
    });
    const lease = await findLiveExactLease(initialLease, at, this.options.leases);
    if (!lease) return;
    await this.options.groups.releaseTerminal({
      groups: scope.groups,
      leaseId: lease.id,
      projectId: input.project.project.id,
      at,
      hasRemainingJitDemand: (materialKeys) =>
        this.options.hasAnyRemainingJitDemand === undefined
          ? Promise.resolve(true)
          : this.options.hasAnyRemainingJitDemand.hasAnyRemainingDemand({
            materialKeys,
          }),
    });
  }

  async #scope(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<PreparationScope> {
    const resolved = validateResolvedCapabilityRuntimeOperation(
      await this.options.authorization.requirePreparation(input),
    );
    if (
      resolved.projectId !== input.project.project.id ||
      resolved.operation.id !== input.operation.id ||
      resolved.operation.version !== input.operation.version
    ) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation authority does not match the exact current project operation.",
      );
    }
    if (
      resolved.bindings.length !== 1 ||
      resolved.bindings[0]?.capability.use !== "preparation"
    ) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation requires exactly one resolved preparation binding.",
      );
    }
    const lifecycles = exactPersistentLifecycles(
      resolved.bindings[0]!.hostLifecycles,
    );
    const groups = uniqueGroups(lifecycles.map((lifecycle) => lifecycle.launchGroup!));
    if (groups.length !== 1) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation requires one exact persistent launch group.",
      );
    }
    return {
      resolved,
      lifecycles,
      groups,
      fingerprint: await fingerprintResolvedCapabilityRuntimeOperation(resolved),
    };
  }
}

interface PreparationScope {
  readonly resolved: ResolvedCapabilityRuntimeOperation;
  readonly lifecycles: readonly Extract<CapabilityRuntimeHostLifecycle, {
    readonly kind: "persistent-compose";
  }>[];
  readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
}

async function recoverableLease(
  initial: CapabilityRuntimeLease,
  at: string,
  leases: CapabilityRuntimeLeaseStore,
): Promise<{
  readonly lease: CapabilityRuntimeLease;
  readonly reuseExistingLease: "allow" | "reject";
}> {
  let candidate = initial;
  // Each expired exact claim produces one deterministic immutable successor.
  // The bound prevents a corrupt circular history from becoming a host loop.
  for (let generation = 0; generation < 32; generation++) {
    const existing = await leases.read(candidate.id);
    if (!existing) return { lease: candidate, reuseExistingLease: "reject" };
    const equivalent = equivalentLease(existing, candidate);
    if (equivalent.expiresAt > at) {
      return { lease: equivalent, reuseExistingLease: "allow" };
    }
    candidate = await successorLease(equivalent, at);
  }
  throw new CapabilityRuntimePreparationUnavailableError(
    "Preparation lease recovery exceeded its bounded exact successor chain.",
  );
}

async function findLiveExactLease(
  initial: CapabilityRuntimeLease,
  at: string,
  leases: CapabilityRuntimeLeaseStore,
): Promise<CapabilityRuntimeLease | undefined> {
  let candidate = initial;
  for (let generation = 0; generation < 32; generation++) {
    const existing = await leases.read(candidate.id);
    if (!existing) return undefined;
    const equivalent = equivalentLease(existing, candidate);
    if (equivalent.expiresAt > at) return equivalent;
    candidate = await successorLease(equivalent, at);
  }
  throw new CapabilityRuntimePreparationUnavailableError(
    "Preparation lease cleanup exceeded its bounded exact successor chain.",
  );
}

async function successorLease(
  previous: CapabilityRuntimeLease,
  at: string,
): Promise<CapabilityRuntimeLease> {
  const suffix = (await sha256Fingerprint({
    schemaVersion: "capability-runtime-preparation-lease-successor/1.0",
    previousLeaseId: previous.id,
    previousExpiresAt: previous.expiresAt,
    projectId: previous.projectId,
    bindingIds: previous.bindingIds,
    materialKeys: previous.materialKeys,
    launchGroups: previous.launchGroups.map(groupToken),
  })).digest;
  return validateCapabilityRuntimeLease({
    ...previous,
    id: `capability-preparation-recovery-${suffix}`,
    acquiredAt: at,
    expiresAt: new Date(Date.parse(at) + PREPARATION_LEASE_TTL_MS).toISOString(),
  });
}

class ActiveCapabilityRuntimePreparationSession
  implements CapabilityRuntimePreparationSession {
  #retained = false;
  #released = false;

  constructor(
    readonly lease: CapabilityRuntimeLease,
    private readonly groups: readonly CapabilityRuntimeLaunchGroupReference[],
    private readonly options: CapabilityRuntimePreparationSessionCoordinatorOptions,
  ) {}

  retainForRecovery(): void {
    this.#retained = true;
  }

  async releaseSuccess(): Promise<void> {
    if (this.#retained || this.#released) return;
    this.#released = true;
    try {
      await this.options.groups.releaseTerminal({
        groups: this.groups,
        leaseId: this.lease.id,
        projectId: this.lease.projectId,
        at: this.options.now?.() ?? new Date().toISOString(),
        // This project just captured its draft, but another project can still
        // have an exact ready/in-progress demand for the same shared group.
        // Omitted global census is intentionally a retain decision.
        hasRemainingJitDemand: (materialKeys) =>
          this.options.hasAnyRemainingJitDemand === undefined
            ? Promise.resolve(true)
            : this.options.hasAnyRemainingJitDemand.hasAnyRemainingDemand({
              materialKeys,
            }),
      });
    } catch {
      // The draft is durable but host cleanup was not. Preserve the lease for
      // recovery instead of rewriting the successful draft as a failed run.
      this.#retained = true;
    }
  }
}

function exactPersistentLifecycles(
  values: readonly CapabilityRuntimeHostLifecycle[],
): readonly Extract<CapabilityRuntimeHostLifecycle, {
  readonly kind: "persistent-compose";
}>[] {
  if (
    values.length === 0 ||
    values.some((value) =>
      value.kind !== "persistent-compose" || value.launchGroup === null
    )
  ) {
    throw new CapabilityRuntimePreparationUnavailableError(
      "Preparation binding must have only exact persistent launch-group materials.",
    );
  }
  return values as readonly Extract<CapabilityRuntimeHostLifecycle, {
    readonly kind: "persistent-compose";
  }>[];
}

async function candidateLease(input: {
  readonly projectId: string;
  readonly projectSnapshotId: string;
  readonly projectRevision: number;
  readonly operationalCapabilityFingerprint: string;
  readonly bindingIds: readonly string[];
  readonly lifecycles: readonly Extract<CapabilityRuntimeHostLifecycle, {
    readonly kind: "persistent-compose";
  }>[];
  readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
  readonly at: string;
}): Promise<CapabilityRuntimeLease> {
  const materialKeys = input.lifecycles.map((value) =>
    capabilityRuntimeMaterialKey(value.material)
  ).toSorted();
  const groups = uniqueGroups(input.groups);
  const id = `capability-preparation-${
    (await sha256Fingerprint({
      schemaVersion: "capability-runtime-preparation-lease/1.0",
      projectId: input.projectId,
      projectSnapshotId: input.projectSnapshotId,
      projectRevision: input.projectRevision,
      operationalCapabilityFingerprint: input.operationalCapabilityFingerprint,
      bindingIds: [...input.bindingIds].toSorted(),
      materialKeys,
      launchGroups: groups.map(groupToken),
    })).digest
  }`;
  return validateCapabilityRuntimeLease({
    id,
    projectId: input.projectId,
    bindingIds: [...input.bindingIds].toSorted(),
    materialKeys,
    launchGroups: groups,
    acquiredAt: input.at,
    expiresAt: new Date(
      Date.parse(input.at) + PREPARATION_LEASE_TTL_MS,
    ).toISOString(),
  });
}

function equivalentLease(
  storedValue: CapabilityRuntimeLease,
  candidate: CapabilityRuntimeLease,
): CapabilityRuntimeLease {
  const stored = validateCapabilityRuntimeLease(storedValue);
  if (
    stored.id !== candidate.id ||
    stored.projectId !== candidate.projectId ||
    !sameTokens(stored.bindingIds, candidate.bindingIds) ||
    !sameTokens(stored.materialKeys, candidate.materialKeys) ||
    !sameTokens(
      stored.launchGroups.map(groupToken),
      candidate.launchGroups.map(groupToken),
    )
  ) {
    throw new CapabilityRuntimePreparationUnavailableError(
      "Preparation lease is already held for a different exact operational scope.",
    );
  }
  return stored;
}

function assertActiveExactMaterials(
  states: ReadonlyMap<string, {
    readonly material: string;
    readonly runtime: string;
  }>,
  lifecycles: readonly CapabilityRuntimeHostLifecycle[],
): void {
  for (const lifecycle of lifecycles) {
    const state = states.get(capabilityRuntimeMaterialKey(lifecycle.material));
    if (
      !state || state.material !== "installed" || state.runtime !== "active"
    ) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation launch group did not reach an exact installed, active physical state.",
      );
    }
  }
}

function uniqueGroups(
  groups: readonly CapabilityRuntimeLaunchGroupReference[],
): readonly CapabilityRuntimeLaunchGroupReference[] {
  const result = new Map<string, CapabilityRuntimeLaunchGroupReference>();
  for (const group of groups) result.set(groupToken(group), group);
  return [...result.values()].toSorted((left, right) =>
    groupToken(left).localeCompare(groupToken(right))
  );
}

function groupToken(group: CapabilityRuntimeLaunchGroupReference): string {
  return `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}`;
}

function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].toSorted();
  const sortedRight = [...right].toSorted();
  return sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index]);
}
