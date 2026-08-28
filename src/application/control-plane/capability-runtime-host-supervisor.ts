/**
 * Generic host lifecycle orchestration for one exact launch profile.
 *
 * This supervisor never changes project/Thread/CAS/WAL state, does not select
 * a provider, and does not dispatch engineering work.  It only journals and
 * observes a server-selected host profile under a local mutation lock.
 */

import {
  type CapabilityRuntimeLaunchProfile,
  capabilityRuntimeLaunchProfileMaterialMatches,
  type CapabilityRuntimeLaunchProfileReference,
  capabilityRuntimeLaunchProfileReference,
  sameCapabilityRuntimeLaunchProfileReference,
} from "../../domain/capability/runtime/capability-runtime-host.ts";
import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
  validateCapabilityRuntimeLease,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLaunchProfileRegistry,
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeStateObserver,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import { CapabilityRuntimeLifecycleCoordinator } from "./capability-runtime-supervisor.ts";

export class CapabilityRuntimeHostSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeHostSafetyError";
  }
}

export interface CapabilityRuntimeHostSupervisorOptions {
  readonly profiles: CapabilityRuntimeLaunchProfileRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly states: CapabilityRuntimeStateObserver;
  readonly host: CapabilityRuntimeHostMutator;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  readonly lock: CapabilityRuntimeHostMutationLock;
}

export interface CapabilityRuntimeMaterialEnsureRequest {
  readonly profile: CapabilityRuntimeLaunchProfileReference;
  readonly projectId: string | null;
  readonly at: string;
}

export interface CapabilityRuntimeActiveEnsureRequest
  extends CapabilityRuntimeMaterialEnsureRequest {
  readonly lease: CapabilityRuntimeLease;
}

export interface CapabilityRuntimeLeaseReleaseRequest {
  readonly profile: CapabilityRuntimeLaunchProfileReference;
  readonly leaseId: string;
  /** The durable lease must name this exact project before it can be released. */
  readonly projectId: string;
  readonly at: string;
  /** Server-derived JIT demand; `true` makes deactivation ineligible. */
  readonly jitDemand: boolean;
}

export interface CapabilityRuntimeHostEnsureResult {
  readonly profile: CapabilityRuntimeLaunchProfileReference;
  readonly state: CapabilityRuntimeObservedState | undefined;
  readonly mutation: CapabilityRuntimeJournalOutcome | undefined;
}

export interface CapabilityRuntimeLeaseReleaseResult {
  readonly remainingLeaseCount: number;
  readonly deactivation: CapabilityRuntimeJournalOutcome | undefined;
}

export class CapabilityRuntimeHostSupervisor {
  readonly #coordinator: CapabilityRuntimeLifecycleCoordinator;

  constructor(private readonly options: CapabilityRuntimeHostSupervisorOptions) {
    this.#coordinator = new CapabilityRuntimeLifecycleCoordinator(
      options.journal,
      options.leases,
      options.states,
      options.host,
    );
  }

  async ensureMaterial(
    request: CapabilityRuntimeMaterialEnsureRequest,
  ): Promise<CapabilityRuntimeHostEnsureResult> {
    return await this.options.lock.withLock(async () =>
      await this.#ensureMaterial(request)
    );
  }

  async ensureActive(
    request: CapabilityRuntimeActiveEnsureRequest,
  ): Promise<CapabilityRuntimeHostEnsureResult> {
    return await this.options.lock.withLock(async () => {
      const profile = await this.#safeProfile(request.profile);
      if (profile.activationPolicy !== "persistent") {
        throw new CapabilityRuntimeHostSafetyError(
          "A cache-only capability runtime profile must never be activated.",
        );
      }
      const lease = validateCapabilityRuntimeLease(request.lease);
      if (lease.expiresAt <= request.at) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease is expired at the requested activation time.",
        );
      }
      if (lease.projectId !== request.projectId) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease project does not match the activation request.",
        );
      }
      if (
        !lease.materialKeys.includes(capabilityRuntimeMaterialKey(profile.material))
      ) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease does not protect the exact profile material.",
        );
      }
      if (
        !lease.launchProfiles.some((reference) =>
          sameCapabilityRuntimeLaunchProfileReference(
            reference,
            capabilityRuntimeLaunchProfileReference(profile),
          )
        )
      ) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease does not attest the exact launch profile.",
        );
      }
      const material = await this.#ensureMaterial({
        profile: request.profile,
        projectId: request.projectId,
        at: request.at,
      }, profile);
      if (
        material.state && material.state.runtime === "inactive"
      ) {
        await this.#assertNoPendingRecovery(profile);
      }
      // The expiring claim is retained even if start becomes uncertain.  It
      // prevents a competing cleanup while an operator recovers the host.
      await this.options.leases.acquire(lease);
      if (!material.state || material.state.runtime === "active") return material;
      if (material.state.runtime !== "inactive") {
        throw new CapabilityRuntimeHostSafetyError(
          `Capability runtime is ${material.state.runtime}; recovery must observe it before another start.`,
        );
      }
      const mutation = await this.#coordinator.mutate(
        journalEntry(
          profile,
          "runtime-start",
          request.projectId,
          request.at,
          material.state,
        ),
      );
      return {
        profile: capabilityRuntimeLaunchProfileReference(profile),
        state: await this.#observe(profile),
        mutation,
      };
    });
  }

  async releaseLease(
    request: CapabilityRuntimeLeaseReleaseRequest,
  ): Promise<CapabilityRuntimeLeaseReleaseResult> {
    return await this.options.lock.withLock(async () => {
      const profile = await this.#safeProfile(request.profile);
      const lease = await this.options.leases.read(request.leaseId);
      if (!lease) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease is absent and cannot be released.",
        );
      }
      const exactLease = validateCapabilityRuntimeLease(lease);
      if (exactLease.id !== request.leaseId) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease identifier does not match the release request.",
        );
      }
      if (exactLease.projectId !== request.projectId) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease project does not match the release request.",
        );
      }
      if (
        !exactLease.materialKeys.includes(
          capabilityRuntimeMaterialKey(profile.material),
        )
      ) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease does not protect the exact profile material.",
        );
      }
      if (
        !exactLease.launchProfiles.some((reference) =>
          sameCapabilityRuntimeLaunchProfileReference(
            reference,
            capabilityRuntimeLaunchProfileReference(profile),
          )
        )
      ) {
        throw new CapabilityRuntimeHostSafetyError(
          "Capability runtime lease does not attest the exact launch profile.",
        );
      }
      const materialKey = capabilityRuntimeMaterialKey(profile.material);
      const remaining = (await this.options.leases.listActive(request.at)).filter(
        (lease) =>
          lease.id !== exactLease.id && lease.materialKeys.includes(materialKey),
      );
      if (
        profile.activationPolicy !== "persistent" || request.jitDemand ||
        remaining.length > 0
      ) {
        await this.options.leases.release(request.leaseId);
        return { remainingLeaseCount: remaining.length, deactivation: undefined };
      }
      const observed = await this.#observe(profile);
      if (!observed || observed.runtime === "inactive") {
        await this.options.leases.release(request.leaseId);
        return { remainingLeaseCount: 0, deactivation: undefined };
      }
      if (observed.runtime !== "active") {
        throw new CapabilityRuntimeHostSafetyError(
          `Capability runtime is ${observed.runtime}; recovery must observe it before stop.`,
        );
      }
      await this.#assertNoPendingRecovery(profile);
      await this.options.leases.release(request.leaseId);
      const deactivation = await this.#coordinator.mutate(
        journalEntry(profile, "runtime-stop", null, request.at, observed),
      );
      return { remainingLeaseCount: 0, deactivation };
    });
  }

  async #ensureMaterial(
    request: CapabilityRuntimeMaterialEnsureRequest,
    exactProfile?: CapabilityRuntimeLaunchProfile,
  ): Promise<CapabilityRuntimeHostEnsureResult> {
    const profile = exactProfile ?? await this.#safeProfile(request.profile);
    const observed = await this.#observe(profile);
    if (observed?.material === "installed") {
      return {
        profile: capabilityRuntimeLaunchProfileReference(profile),
        state: observed,
        mutation: undefined,
      };
    }
    if (observed && observed.material !== "absent") {
      throw new CapabilityRuntimeHostSafetyError(
        `Capability material is ${observed.material}; recovery must observe it before another acquisition.`,
      );
    }
    await this.#assertNoPendingRecovery(profile);
    const mutation = await this.#coordinator.mutate(
      journalEntry(
        profile,
        "material-acquire",
        request.projectId,
        request.at,
        observed,
      ),
    );
    return {
      profile: capabilityRuntimeLaunchProfileReference(profile),
      state: await this.#observe(profile),
      mutation,
    };
  }

  async #safeProfile(
    reference: CapabilityRuntimeLaunchProfileReference,
  ): Promise<CapabilityRuntimeLaunchProfile> {
    const profile = await this.options.profiles.require(reference);
    if (profile.security !== "reviewed") {
      throw new CapabilityRuntimeHostSafetyError(
        "Capability runtime profile security is unknown; host mutation is blocked.",
      );
    }
    if (profile.qualification === "revoked") {
      throw new CapabilityRuntimeHostSafetyError(
        "Capability runtime profile qualification is revoked; host mutation is blocked.",
      );
    }
    const availability = await this.options.secrets.observe(profile.secretSlots);
    for (const slot of profile.secretSlots) {
      const state = availability.get(slot);
      if (state !== "available") {
        throw new CapabilityRuntimeHostSafetyError(
          `Capability runtime secret slot ${slot} is ${
            state ?? "unknown"
          }; host mutation is blocked.`,
        );
      }
    }
    return profile;
  }

  async #observe(
    profile: CapabilityRuntimeLaunchProfile,
  ): Promise<CapabilityRuntimeObservedState | undefined> {
    const observations = await this.options.states.observe([profile.material]);
    return observations.get(capabilityRuntimeMaterialKey(profile.material));
  }

  async #assertNoPendingRecovery(
    profile: CapabilityRuntimeLaunchProfile,
  ): Promise<void> {
    const recovery = await this.#coordinator.recover([profile.material]);
    const reference = capabilityRuntimeLaunchProfileReference(profile);
    const pending = recovery.pendingJournalEntries.filter((entry) =>
      entry.material.unitId === profile.material.unitId &&
      entry.material.materialId === profile.material.materialId &&
      entry.material.imageDigest === profile.material.imageDigest &&
      sameCapabilityRuntimeLaunchProfileReference(entry.launchProfile, reference)
    );
    if (pending.length > 0) {
      throw new CapabilityRuntimeHostSafetyError(
        "Capability runtime has an unreconciled pending host intent; recovery must complete before a new mutation.",
      );
    }
  }
}

function journalEntry(
  profile: CapabilityRuntimeLaunchProfile,
  action: CapabilityRuntimeJournalEntry["action"],
  projectId: string | null,
  at: string,
  previousObservation: CapabilityRuntimeObservedState | undefined,
): CapabilityRuntimeJournalEntry {
  if (!capabilityRuntimeLaunchProfileMaterialMatches(profile, profile.material)) {
    throw new CapabilityRuntimeHostSafetyError(
      "Launch profile material is internally inconsistent.",
    );
  }
  return {
    id: `host-runtime:${crypto.randomUUID()}`,
    action,
    material: profile.material,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId,
    plannedAt: at,
    previousObservation: previousObservation ?? null,
    administrativeRemovalPlanFingerprint: null,
  };
}
