/**
 * Lifecycle supervision for one or more immutable Compose launch groups.
 *
 * A group is the smallest persistent host boundary.  The supervisor never
 * picks a provider or interprets engineering output: it just creates one
 * durable group intent before a trusted host adapter may mutate Docker.
 */

import {
  type CapabilityRuntimeLaunchGroup,
  type CapabilityRuntimeLaunchGroupReference,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
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
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeStateObserver,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import {
  authorizeDurableCapabilityRuntimeHostMutation,
} from "./capability-runtime-host-authorization.ts";

export class CapabilityRuntimeLaunchGroupSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeLaunchGroupSafetyError";
  }
}

export interface CapabilityRuntimeLaunchGroupSupervisorOptions {
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly states: CapabilityRuntimeStateObserver;
  readonly host: CapabilityRuntimeHostMutator;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  readonly lock: CapabilityRuntimeHostMutationLock;
}

export interface EnsureCapabilityRuntimeLaunchGroupRequest {
  readonly group: CapabilityRuntimeLaunchGroupReference;
  readonly projectId: string;
  readonly lease: CapabilityRuntimeLease;
  readonly at: string;
  /** Fresh queues reject an extant claim; only the same session may reuse it. */
  readonly reuseExistingLease: "allow" | "reject";
}

export interface CapabilityRuntimeLaunchGroupEnsureResult {
  readonly group: CapabilityRuntimeLaunchGroupReference;
  readonly states: ReadonlyMap<string, CapabilityRuntimeObservedState>;
  /** Present only for an activation that claimed the shared session lease. */
  readonly leaseDisposition?: "created" | "reused";
  readonly mutation: CapabilityRuntimeJournalOutcome | undefined;
}

export class CapabilityRuntimeLaunchGroupSupervisor {
  constructor(
    private readonly options: CapabilityRuntimeLaunchGroupSupervisorOptions,
  ) {}

  async ensureMaterial(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly projectId: string | null;
    readonly at: string;
    /** Rechecks local authority under this exact host mutation mutex. */
    readonly guard?: () => Promise<boolean>;
  }): Promise<CapabilityRuntimeLaunchGroupEnsureResult> {
    return await this.options.lock.withLock(async () => {
      if (input.guard && !(await input.guard())) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime material preload is no longer authorized by the exact local envelope and lock.",
        );
      }
      const group = await this.#requireUsableGroup(input.group);
      await this.#assertNoPending(group);
      const before = await this.#observe(group);
      if (allInstalled(group, before)) {
        return {
          group: capabilityRuntimeLaunchGroupReference(group),
          states: before,
          mutation: undefined,
        };
      }
      const mutation = await this.#mutate(
        group,
        "material-acquire",
        input.projectId,
        input.at,
        before,
      );
      if (mutation.status !== "succeeded") {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          `Capability runtime group material acquisition is ${mutation.status}; recovery is required.`,
        );
      }
      const after = await this.#observe(group);
      if (!allInstalled(group, after)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime group acquisition succeeded without all exact materials installed.",
        );
      }
      return {
        group: capabilityRuntimeLaunchGroupReference(group),
        states: after,
        mutation,
      };
    });
  }

  async ensureActive(
    request: EnsureCapabilityRuntimeLaunchGroupRequest,
  ): Promise<CapabilityRuntimeLaunchGroupEnsureResult> {
    return await this.options.lock.withLock(async () => {
      const group = await this.#requireUsableGroup(request.group);
      const lease = validateCapabilityRuntimeLease(request.lease);
      this.#assertLeaseCovers(group, lease, request.projectId, request.at);
      await this.#assertNoPending(group);
      const disposition = await this.#claim(
        lease,
        request.reuseExistingLease,
        request.at,
      );
      const before = await this.#observe(group);
      let intentWritten = false;
      try {
        if (!allInstalled(group, before)) {
          intentWritten = true;
          const acquisition = await this.#mutate(
            group,
            "material-acquire",
            request.projectId,
            request.at,
            before,
          );
          if (acquisition.status !== "succeeded") {
            throw new CapabilityRuntimeLaunchGroupSafetyError(
              `Capability runtime group material acquisition is ${acquisition.status}; recovery is required.`,
            );
          }
        }
        const installed = await this.#observe(group);
        if (allActive(group, installed)) {
          return {
            group: capabilityRuntimeLaunchGroupReference(group),
            states: installed,
            leaseDisposition: disposition,
            mutation: undefined,
          };
        }
        intentWritten = true;
        const mutation = await this.#mutate(
          group,
          "runtime-start",
          request.projectId,
          request.at,
          installed,
        );
        if (mutation.status !== "succeeded") {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            `Capability runtime group start is ${mutation.status}; recovery is required.`,
          );
        }
        const active = await this.#observe(group);
        if (!allActive(group, active)) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Capability runtime group start did not produce an exact active group observation.",
          );
        }
        return {
          group: capabilityRuntimeLaunchGroupReference(group),
          states: active,
          leaseDisposition: disposition,
          mutation,
        };
      } catch (error) {
        // A group intent may have reached Docker.  Keeping the one session lease
        // gives recovery an exact owner and prevents a blind second start.
        if (disposition === "created" && !intentWritten) {
          await this.options.leases.release(lease.id);
        }
        throw error;
      }
    });
  }

  /**
   * Stops requested groups in reverse canonical order while retaining the one
   * session lease. Only after every decision succeeds is that lease released.
   */
  async releaseTerminal(input: {
    readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
    readonly leaseId: string;
    readonly projectId: string;
    readonly at: string;
    readonly hasRemainingJitDemand: (
      materialKeys: readonly string[],
    ) => Promise<boolean>;
  }): Promise<void> {
    await this.options.lock.withLock(async () => {
      const leaseValue = await this.options.leases.read(input.leaseId);
      if (!leaseValue) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime lease is absent.",
        );
      }
      const lease = validateCapabilityRuntimeLease(leaseValue);
      if (lease.projectId !== input.projectId) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime lease belongs to another project.",
        );
      }
      const groups = await Promise.all(
        uniqueGroups(input.groups).map((reference) =>
          this.#requireUsableGroup(reference)
        ),
      );
      for (const group of groups) {
        this.#assertLeaseCovers(group, lease, input.projectId, input.at);
      }
      const activeLeases = await this.options.leases.listActive(input.at);
      for (const group of [...groups].toSorted(compareGroup).reverse()) {
        const materialKeys = group.materials.map((material) =>
          capabilityRuntimeMaterialKey(material.material)
        );
        if (await input.hasRemainingJitDemand(materialKeys)) continue;
        if (
          activeLeases.some((candidate) =>
            candidate.id !== lease.id && leaseProtectsGroup(candidate, group)
          )
        ) continue;
        await this.#assertNoPending(group);
        const before = await this.#observe(group);
        if (allInactive(group, before)) continue;
        const mutation = await this.#mutate(
          group,
          "runtime-stop",
          null,
          input.at,
          before,
        );
        if (mutation.status !== "succeeded") {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            `Capability runtime group stop is ${mutation.status}; lease is retained for recovery.`,
          );
        }
        const after = await this.#observe(group);
        if (!allInactive(group, after)) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Capability runtime group stop did not yield an exact inactive observation.",
          );
        }
      }
      await this.options.leases.release(lease.id);
    });
  }

  async #requireUsableGroup(
    reference: CapabilityRuntimeLaunchGroupReference,
  ): Promise<CapabilityRuntimeLaunchGroup> {
    const group = await this.options.groups.require(reference);
    if (group.security !== "reviewed" || group.qualification === "revoked") {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group is not operationally admissible.",
      );
    }
    const availability = await this.options.secrets.observe(group.secretSlots);
    if (group.secretSlots.some((slot) => availability.get(slot) !== "available")) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group secret availability is unknown or unavailable.",
      );
    }
    return group;
  }

  #assertLeaseCovers(
    group: CapabilityRuntimeLaunchGroup,
    lease: CapabilityRuntimeLease,
    projectId: string,
    at: string,
  ): void {
    if (lease.projectId !== projectId || lease.expiresAt <= at) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime lease is not current for this group activation.",
      );
    }
    const reference = capabilityRuntimeLaunchGroupReference(group);
    if (
      !lease.launchGroups.some((candidate) =>
        sameCapabilityRuntimeLaunchGroupReference(candidate, reference)
      )
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime lease does not attest the exact launch group.",
      );
    }
    for (const material of group.materials) {
      const key = capabilityRuntimeMaterialKey(material.material);
      if (!lease.materialKeys.includes(key)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime lease does not protect each exact group material.",
        );
      }
    }
  }

  async #claim(
    lease: CapabilityRuntimeLease,
    reuse: "allow" | "reject",
    at: string,
  ): Promise<"created" | "reused"> {
    const claim = await this.options.leases.claim(lease);
    if (claim.status === "created") return "created";
    if (
      reuse === "reject" || claim.lease.expiresAt <= at ||
      !sameLeaseScope(claim.lease, lease)
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "An existing capability runtime lease requires explicit recovery.",
      );
    }
    return "reused";
  }

  async #assertNoPending(group: CapabilityRuntimeLaunchGroup): Promise<void> {
    const journal = await this.options.journal.list();
    const entries = journal.filter((entry) => hasGroupIntent([entry], group))
      .toSorted((left, right) =>
        left.plannedAt.localeCompare(right.plannedAt) || left.id.localeCompare(right.id)
      );
    const latest = entries.at(-1);
    if (!latest) return;
    const outcome = (await this.options.journal.listOutcomes()).find((candidate) =>
      candidate.journalEntryId === latest.id
    );
    const states = await this.#observe(group);
    if (!entryCoversExactGroup(latest, group)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group recovery tip does not cover the exact group materials.",
      );
    }
    // A write can have reached Docker even if its terminal outcome was never
    // recorded or reports failed/uncertain. Only the latest group intent and a
    // fresh complete observation decide whether it converged, had no effect
    // and may be safely retried, or needs human recovery. Older entries are
    // superseded by this tip and cannot permanently poison the group.
    if (
      group.materials.every((material) =>
        stateSatisfiesAction(
          latest.action,
          states.get(capabilityRuntimeMaterialKey(material.material))!,
        )
      )
    ) return;
    // An explicitly successful tip already claimed that the mutation reached
    // its target. A later return to the previous state is external drift, not
    // an idempotent retry. Failed, uncertain and pending intents may safely
    // retry only when the complete group still exactly matches their prior
    // observation.
    if (
      outcome?.status !== "succeeded" &&
      matchesPreviousObservation(latest, group, states)
    ) {
      return;
    }
    throw new CapabilityRuntimeLaunchGroupSafetyError(
      "Capability runtime group tip has a partial or third-party state; recovery is required.",
    );
  }

  async #observe(
    group: CapabilityRuntimeLaunchGroup,
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    const states = await this.options.states.observe(
      group.materials.map((material) => material.material),
    );
    if (
      group.materials.some((material) =>
        !states.has(capabilityRuntimeMaterialKey(material.material))
      )
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group observation is incomplete.",
      );
    }
    return states;
  }

  async #mutate(
    group: CapabilityRuntimeLaunchGroup,
    action: CapabilityRuntimeJournalEntry["action"],
    projectId: string | null,
    at: string,
    states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
  ): Promise<CapabilityRuntimeJournalOutcome> {
    const entry: CapabilityRuntimeJournalEntry = {
      id: `capability-group-${await shortId(group, action, at, projectId)}`,
      action,
      materials: group.materials.map((material) => ({ ...material.material })),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      projectId,
      plannedAt: at,
      previousObservations: group.materials.map((material) => ({
        material: { ...material.material },
        state: states.get(capabilityRuntimeMaterialKey(material.material)) ?? null,
      })),
      administrativeRemovalPlanFingerprint: null,
    };
    await this.options.journal.appendBeforeMutation(entry);
    let outcome: CapabilityRuntimeJournalOutcome;
    try {
      const authorization = await authorizeDurableCapabilityRuntimeHostMutation(
        entry,
        this.options.journal,
      );
      outcome = await this.options.host.mutate({ authorization });
    } catch (error) {
      outcome = {
        schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
        journalEntryId: entry.id,
        recordedAt: new Date().toISOString(),
        status: "uncertain",
        observations: entry.materials.map((material) => ({ material, state: null })),
        detail: compact(error),
      };
    }
    if (outcome.journalEntryId !== entry.id) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Host returned an outcome for another group intent.",
      );
    }
    await this.options.journal.appendOutcome(outcome);
    return outcome;
  }
}

async function shortId(
  group: CapabilityRuntimeLaunchGroup,
  action: string,
  at: string,
  projectId: string | null,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}\u0000${action}\u0000${
        projectId ?? "administrative"
      }\u0000${at}`,
    ),
  );
  return `${action}-${
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    )
  }`;
}

function allInstalled(
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): boolean {
  return group.materials.every((material) =>
    states.get(capabilityRuntimeMaterialKey(material.material))?.material ===
      "installed"
  );
}

function allActive(
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): boolean {
  return group.materials.every((material) => {
    const state = states.get(capabilityRuntimeMaterialKey(material.material));
    return state?.material === "installed" && state.runtime === "active" &&
      (state.qualification === "qualified" || state.qualification === "compatible");
  });
}

function allInactive(
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): boolean {
  return group.materials.every((material) =>
    states.get(capabilityRuntimeMaterialKey(material.material))?.runtime === "inactive"
  );
}

function uniqueGroups(
  value: readonly CapabilityRuntimeLaunchGroupReference[],
): readonly CapabilityRuntimeLaunchGroupReference[] {
  const groups = new Map<string, CapabilityRuntimeLaunchGroupReference>();
  for (const group of value) {
    groups.set(
      `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}`,
      group,
    );
  }
  return [...groups.values()].toSorted((left, right) =>
    `${left.id}\u0000${left.version}`.localeCompare(`${right.id}\u0000${right.version}`)
  );
}

function compareGroup(
  left: CapabilityRuntimeLaunchGroup,
  right: CapabilityRuntimeLaunchGroup,
): number {
  return `${left.id}\u0000${left.version}`.localeCompare(
    `${right.id}\u0000${right.version}`,
  );
}

function hasGroupIntent(
  entries: readonly CapabilityRuntimeJournalEntry[],
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  const reference = capabilityRuntimeLaunchGroupReference(group);
  return entries.some((entry) =>
    sameCapabilityRuntimeLaunchGroupReference(entry.launchGroup, reference)
  );
}

function leaseProtectsGroup(
  lease: CapabilityRuntimeLease,
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  const reference = capabilityRuntimeLaunchGroupReference(group);
  return lease.launchGroups.some((candidate) =>
    sameCapabilityRuntimeLaunchGroupReference(candidate, reference)
  ) && group.materials.every((material) =>
    lease.materialKeys.includes(capabilityRuntimeMaterialKey(material.material))
  );
}

function entryCoversExactGroup(
  entry: CapabilityRuntimeJournalEntry,
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  return entry.materials.length === group.materials.length &&
    entry.materials.every((material, index) =>
      sameMaterial(material, group.materials[index]!.material)
    );
}

function matchesPreviousObservation(
  entry: CapabilityRuntimeJournalEntry,
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): boolean {
  return entry.previousObservations.length === group.materials.length &&
    group.materials.every((member, index) => {
      const prior = entry.previousObservations[index];
      const current = states.get(capabilityRuntimeMaterialKey(member.material));
      return prior !== undefined && sameMaterial(prior.material, member.material) &&
        prior.state !== null && current !== undefined &&
        sameState(prior.state, current);
    });
}

function sameMaterial(
  left: CapabilityRuntimeJournalEntry["materials"][number],
  right: CapabilityRuntimeJournalEntry["materials"][number],
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}

function sameState(
  left: CapabilityRuntimeObservedState,
  right: CapabilityRuntimeObservedState,
): boolean {
  return left.material === right.material && left.runtime === right.runtime &&
    left.qualification === right.qualification;
}

function stateSatisfiesAction(
  action: CapabilityRuntimeJournalEntry["action"],
  state: CapabilityRuntimeObservedState,
): boolean {
  switch (action) {
    case "material-acquire":
      return state.material === "installed";
    case "runtime-start":
      return state.runtime === "active";
    case "runtime-stop":
      return state.runtime === "inactive";
    case "material-remove":
      return state.material === "absent";
  }
}

function sameLeaseScope(
  left: CapabilityRuntimeLease,
  right: CapabilityRuntimeLease,
): boolean {
  return left.id === right.id && left.projectId === right.projectId &&
    sameTokens(left.materialKeys, right.materialKeys) &&
    sameTokens(left.bindingIds, right.bindingIds) &&
    sameTokens(left.launchGroups.map(groupToken), right.launchGroups.map(groupToken));
}

function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  return [...left].toSorted().join("\u0000") === [...right].toSorted().join("\u0000");
}

function groupToken(group: CapabilityRuntimeLaunchGroupReference): string {
  return `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}`;
}

function compact(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 512
    ? `${text.slice(0, 509)}...`
    : text || "Host mutation threw.";
}
