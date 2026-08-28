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
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";

/** Preparation is bounded to one brief host reservation, not a run lifetime. */
const PREPARATION_LEASE_TTL_MS = 15 * 60 * 1_000;

export class CapabilityRuntimePreparationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimePreparationUnavailableError";
  }
}

export interface CapabilityRuntimePreparationSession {
  readonly lease: CapabilityRuntimeLease;
  /** The completed draft was durably captured and reread. */
  releaseSuccess(): Promise<void>;
  /** A provider call may have dispatched, but its outcome is not certain. */
  retainForRecovery(): void;
}

export interface CapabilityRuntimePreparationSessionCoordinatorOptions {
  /** Cold server authority: it validates registry, authorization and digest. */
  readonly authorization: CapabilityRuntimePreparationEligibility;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly groups: CapabilityRuntimeLaunchGroupSupervisor;
  readonly now?: () => string;
}

/**
 * Owns a precise pre-provider activation boundary for a fixed registered
 * preparation operation.  It deliberately accepts neither a capability nor
 * provider/image/endpoint/tool/arguments/source from its caller.
 */
export class CapabilityRuntimePreparationSessionCoordinator {
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
    const resolved = validateResolvedCapabilityRuntimeOperation(
      await this.options.authorization.requirePreparation({
        project: input.project,
        operation: input.operation,
      }),
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
    const binding = resolved.bindings[0]!;
    const lifecycles = exactPersistentLifecycles(binding.hostLifecycles);
    const groups = uniqueGroups(lifecycles.map((lifecycle) => lifecycle.launchGroup!));
    if (groups.length !== 1) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation requires one exact persistent launch group.",
      );
    }

    const at = this.#now();
    const fingerprint = await fingerprintResolvedCapabilityRuntimeOperation(resolved);
    const lease = await candidateLease({
      projectId: input.project.project.id,
      projectSnapshotId: input.project.id,
      projectRevision: input.project.revision,
      operationalCapabilityFingerprint: fingerprint.digest,
      bindingIds: resolved.bindings.map((candidate) => candidate.binding.id),
      lifecycles,
      groups,
      at,
    });

    // H1 journals before any Docker mutation.  On a known pre-mutation failure
    // it releases a created lease itself; a possible host mutation retains it.
    const activated = await this.options.groups.ensureActive({
      group: groups[0]!,
      projectId: input.project.project.id,
      lease,
      at,
      reuseExistingLease: "reject",
    });
    assertActiveExactMaterials(activated.states, lifecycles);
    const stored = await this.options.leases.read(lease.id);
    if (!stored) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation activation completed without an exact durable lease.",
      );
    }
    return new ActiveCapabilityRuntimePreparationSession(
      equivalentLease(stored, lease),
      groups,
      this.options,
    );
  }
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
        // This path has just captured its only draft. A later preparation must
        // obtain a fresh exact lease; keeping a private sandbox warm is not an
        // engineering result or an implicit future authorization.
        hasRemainingJitDemand: () => Promise.resolve(false),
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
    readonly qualification: string;
  }>,
  lifecycles: readonly CapabilityRuntimeHostLifecycle[],
): void {
  for (const lifecycle of lifecycles) {
    const state = states.get(capabilityRuntimeMaterialKey(lifecycle.material));
    if (
      !state || state.material !== "installed" || state.runtime !== "active" ||
      (state.qualification !== "qualified" && state.qualification !== "compatible")
    ) {
      throw new CapabilityRuntimePreparationUnavailableError(
        "Preparation launch group did not reach an exact installed, active and qualified state.",
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
