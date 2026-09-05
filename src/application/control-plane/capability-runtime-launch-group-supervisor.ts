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
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeExecutionLeaseOwner,
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
  type CapabilityRuntimeQualificationStartAuthority,
  deriveEffectiveCapabilityRuntimeLaunchProjection,
  type EffectiveCapabilityRuntimeLaunchProjection,
  type ResolvedCapabilityRuntimeOperation,
  validateCapabilityRuntimeLease,
  validateCapabilityRuntimeQualificationStartAuthority,
  validateEffectiveCapabilityRuntimeLaunchProjection,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeSecretSnapshot,
  CapabilityRuntimeStateObserver,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import {
  authorizeDurableMaterialAcquire,
  authorizeDurableNormalRuntimeStart,
  authorizeDurableQualificationRuntimeStart,
  authorizeDurableRuntimeStop,
} from "./capability-runtime-host-authorization.ts";
import { sameExactCapabilityRuntimeExecutionLeaseOwner } from "./capability-runtime-session-primitives.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA,
  type CapabilityRuntimeQualificationHostStopProof,
  createCapabilityRuntimeQualificationHostStopProof,
  validateCapabilityRuntimeQualificationHostStopProof,
} from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";

export class CapabilityRuntimeLaunchGroupSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeLaunchGroupSafetyError";
  }
}

/**
 * Narrow, server-owned temporary barrier for one launch group.  It is not a
 * policy engine: normal lifecycle supervision asks it only after resolving a
 * reviewed, registry-owned group and before it writes any lease or intent.
 */
export interface CapabilityRuntimeLaunchGroupAvailabilityGate {
  assertLaunchGroupAvailable(group: CapabilityRuntimeLaunchGroup): Promise<void>;
}

export interface CapabilityRuntimeLaunchGroupSupervisorOptions {
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly states: CapabilityRuntimeStateObserver;
  readonly host: CapabilityRuntimeHostMutator;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  readonly lock: CapabilityRuntimeHostMutationLock;
  readonly availabilityGate?: CapabilityRuntimeLaunchGroupAvailabilityGate;
  /** H1-owned clock used for lock-bound lease expiry checks. */
  readonly now?: () => string;
}

export interface EnsureCapabilityRuntimeLaunchGroupRequest {
  readonly group: CapabilityRuntimeLaunchGroupReference;
  /** Exact ROP lifecycle materials expected to use this group, including digest. */
  readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
  /** Exact server-derived authority, never an observation or caller payload. */
  readonly effectiveRuntimeProjection: EffectiveCapabilityRuntimeLaunchProjection;
  /**
   * The sealed ROP that produced the projection. H1 independently derives the
   * same projection while holding its mutex, so a canonical but foreign
   * binding/mode/attestation cannot acquire a lease or write an intent.
   */
  readonly resolvedOperation: ResolvedCapabilityRuntimeOperation;
  readonly projectId: string;
  readonly lease: CapabilityRuntimeLease;
  readonly at: string;
  /** Fresh queues reject an extant claim; only the same session may reuse it. */
  readonly reuseExistingLease: "allow" | "reject";
  /**
   * Internal retry expectation for one queued run that reached H1 before its
   * agent-run claim. It is never supplied by MCP/CLI surfaces. When present,
   * H1 requires the atomic existing lease to retain this exact provenance.
   */
  readonly queuedPreclaimResumeOwner?: CapabilityRuntimeExecutionLeaseOwner;
  /**
   * Revalidates the exact project authorization while the host mutation mutex
   * is held. It runs before a lease claim or journalled host action so a
   * concurrent revocation cannot leave a disposable session behind.
   */
  readonly guard?: () => Promise<boolean>;
  /**
   * One server-minted secret generation shared with the provider client. It
   * is needed only by groups declaring secret slots and never reaches the
   * journal entry or a persisted launch descriptor.
   */
  readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
}

export interface CapabilityRuntimeLaunchGroupEnsureResult {
  readonly group: CapabilityRuntimeLaunchGroupReference;
  readonly states: ReadonlyMap<string, CapabilityRuntimeObservedState>;
  /** Present only for an activation that claimed the shared session lease. */
  readonly leaseDisposition?: "created" | "reused";
  readonly mutation: CapabilityRuntimeJournalOutcome | undefined;
  readonly qualificationStart?: CapabilityRuntimeQualificationStartProof;
}

export type CapabilityRuntimeQualificationConvergence =
  | "host-outcome-succeeded"
  | "observed-all-active-after-exact-intent"
  | "observed-all-inactive-after-exact-intent";

/** Exact durable qualification-start proof. It is not a boolean health flag. */
export interface CapabilityRuntimeQualificationStartProof {
  readonly qualificationStartAuthority: CapabilityRuntimeQualificationStartAuthority;
  readonly journalEntry: CapabilityRuntimeJournalEntry;
  readonly outcome: CapabilityRuntimeJournalOutcome | null;
  readonly convergence: CapabilityRuntimeQualificationConvergence;
  readonly observations: ReadonlyMap<string, CapabilityRuntimeObservedState>;
  readonly fingerprint: ContentFingerprint;
}

export type CapabilityRuntimeQualificationStopProof =
  CapabilityRuntimeQualificationHostStopProof;

/**
 * Private host-only qualification activation. Its guard is composed by the
 * caller from the exact candidate and reviewed snapshot before a lease,
 * durable intent, or Docker action is possible. It deliberately has no ROP
 * nor effective runtime projection because it is not an engineering run.
 */
export interface EnsureCapabilityRuntimeQualificationLaunchGroupRequest {
  readonly group: CapabilityRuntimeLaunchGroupReference;
  readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
  readonly qualificationStartAuthority: CapabilityRuntimeQualificationStartAuthority;
  readonly lease: CapabilityRuntimeLease;
  readonly at: string;
  readonly reuseExistingLease: "allow" | "reject";
  readonly guard: () => Promise<boolean>;
  readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
  /**
   * Runs after H1 start preflight and before the lease is claimed. Failure
   * leaves no lease, journal entry, or host mutation.
   */
  readonly prepareAfterAuthorization?: () => Promise<void>;
}

export class CapabilityRuntimeLaunchGroupSupervisor {
  readonly #now: () => string;

  constructor(
    private readonly options: CapabilityRuntimeLaunchGroupSupervisorOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

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
      const group = await this.#requireReviewedGroup(input.group);
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
      if (request.guard && !(await request.guard())) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime activation is no longer authorized by the exact local envelope and lock.",
        );
      }
      const group = await this.#requireReviewedGroup(request.group);
      await this.#assertEffectiveRuntimeProjection(
        group,
        request.expectedMaterials,
        request.effectiveRuntimeProjection,
        request.resolvedOperation,
      );
      await this.#assertSecretSnapshotReady(group, request.secretSnapshot);
      const lease = validateCapabilityRuntimeLease(request.lease);
      this.#assertExpectedMaterials(group, request.expectedMaterials);
      this.#assertLeaseCovers(group, lease, request.projectId, request.at);
      await this.#assertNoQualificationLeaseProtects(group, lease.id, request.at);
      let disposition: "created" | "reused" | undefined;
      let intentWritten = false;
      try {
        if (request.queuedPreclaimResumeOwner !== undefined) {
          // The atomic claim and its exact queued owner check must precede
          // journal/host observation: H1 alone then decides convergence.
          disposition = await this.#claim(
            lease,
            request.reuseExistingLease,
            request.at,
            request.queuedPreclaimResumeOwner,
          );
          await this.#assertNoPending(group);
        } else {
          await this.#assertNoPending(group);
          // A fresh execution lease is deliberately not delivered while an
          // owned process is merely starting. The sealed host mutation keeps
          // the journal intent pending through its bounded readiness check;
          // only then may H1 create or reuse the session lease.
          await this.#assertLeasePreflight(
            lease,
            request.reuseExistingLease,
            request.at,
          );
        }
        const before = await this.#observe(group);
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
        // A non-secret, readiness-free group is already exactly usable. A
        // secret-bearing or readiness-gated group must still run the fixed
        // reconciliation: after a process restart, observation alone cannot
        // prove either that a container uses the secret generation or that
        // its MCP endpoint is accepting requests.
        if (
          allActive(group, installed) && group.secretSlots.length === 0 &&
          group.readiness === undefined
        ) {
          disposition ??= await this.#claim(
            lease,
            request.reuseExistingLease,
            request.at,
          );
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
          {
            effectiveRuntimeProjection: request.effectiveRuntimeProjection,
            secretSnapshot: request.secretSnapshot,
          },
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
        disposition ??= await this.#claim(
          lease,
          request.reuseExistingLease,
          request.at,
        );
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
   * Starts a sealed group solely for a private runtime-qualification probe.
   * Unlike an engineering operation start this has no ROP and no effective
   * projection. The candidate/review guard is recomposed under the same H1
   * host mutex before it can claim a lease or write any mutation intent.
   */
  async ensureQualificationActive(
    request: EnsureCapabilityRuntimeQualificationLaunchGroupRequest,
  ): Promise<CapabilityRuntimeLaunchGroupEnsureResult> {
    return await this.options.lock.withLock(async () => {
      if (!(await request.guard())) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification candidate or review is no longer current under the host lock.",
        );
      }
      const group = await this.#requireReviewedGroup(request.group);
      this.#assertExpectedMaterials(group, request.expectedMaterials);
      const qualificationStartAuthority =
        validateCapabilityRuntimeQualificationStartAuthority(
          request.qualificationStartAuthority,
        );
      await this.#assertSecretSnapshotReady(group, request.secretSnapshot);
      const lease = validateCapabilityRuntimeLease(request.lease);
      this.#assertLeaseCovers(
        group,
        lease,
        CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
        request.at,
      );
      await this.#assertNoForeignPending(group, qualificationStartAuthority);
      await this.#assertNoOtherLeaseProtects(group, lease.id, request.at);
      await this.#assertLeasePreflight(lease, request.reuseExistingLease, request.at);
      if (request.prepareAfterAuthorization) {
        await request.prepareAfterAuthorization();
      }
      const disposition = await this.#claim(
        lease,
        request.reuseExistingLease,
        request.at,
      );
      const before = await this.#observe(group);
      try {
        const reconciled = await this.#reconcileQualificationStart(
          group,
          qualificationStartAuthority,
          before,
          request.secretSnapshot,
        );
        if (reconciled) {
          return {
            group: capabilityRuntimeLaunchGroupReference(group),
            states: reconciled.observations,
            leaseDisposition: disposition,
            mutation: reconciled.outcome ?? undefined,
            qualificationStart: reconciled,
          };
        }
        if (!allInactive(group, before)) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Capability runtime qualification start requires an exact inactive group; partial or foreign active state is blocked.",
          );
        }
        await this.#assertNoPending(group);
        if (!allInstalled(group, before)) {
          const acquisition = await this.#mutate(
            group,
            "material-acquire",
            CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
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
        const mutation = await this.#mutate(
          group,
          "runtime-qualification-start",
          CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
          request.at,
          installed,
          {
            qualificationStartAuthority,
            secretSnapshot: request.secretSnapshot,
          },
        );
        const active = await this.#observe(group);
        if (!allActive(group, active)) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            `Capability runtime qualification start is ${mutation.status} without an exact active group observation.`,
          );
        }
        const entry = (await this.options.journal.list()).find((item) =>
          item.id === mutation.journalEntryId
        );
        if (!entry) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Capability runtime qualification start intent was not readable.",
          );
        }
        const proof = await this.#makeQualificationStartProof(
          group,
          entry,
          mutation,
          active,
        );
        return {
          group: capabilityRuntimeLaunchGroupReference(group),
          states: active,
          leaseDisposition: disposition,
          mutation,
          qualificationStart: proof,
        };
      } catch (error) {
        const after = await this.#observe(group);
        if (disposition === "created" && allInactive(group, after)) {
          const exact = await this.#uniqueQualificationStartEntry(
            group,
            qualificationStartAuthority,
          );
          if (!exact) {
            const held = await this.options.leases.read(lease.id);
            if (held && !sameLeaseScope(held, lease)) {
              throw new CapabilityRuntimeLaunchGroupSafetyError(
                "Capability runtime qualification start lease is foreign to this attempt.",
              );
            }
            if (held) await this.options.leases.release(lease.id);
          }
        }
        throw error;
      }
    });
  }

  /**
   * Reacquires the exact reserved qualification lease. It never journals or
   * starts Docker. An exact expired qualification lease may be refreshed when
   * no other active lease protects the group.
   */
  async reacquireQualificationLease(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
    readonly lease: CapabilityRuntimeLease;
    readonly at: string;
  }): Promise<CapabilityRuntimeLease> {
    return await this.options.lock.withLock(async () => {
      const group = await this.#requireReviewedGroup(input.group);
      this.#assertExpectedMaterials(group, input.expectedMaterials);
      const lease = validateCapabilityRuntimeLease(input.lease);
      this.#assertQualificationLeaseScope(group, lease);
      await this.#assertNoOtherLeaseProtects(group, lease.id, input.at);
      const existing = await this.options.leases.read(lease.id);
      if (existing) {
        if (!sameLeaseScope(existing, lease)) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Capability runtime qualification recovery lease is foreign to this attempt.",
          );
        }
        if (existing.expiresAt > input.at) return existing;
        await this.options.leases.release(lease.id);
      }
      const claimed = await this.options.leases.claim(lease);
      if (claimed.status === "existing" && !sameLeaseScope(claimed.lease, lease)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification recovery lease is foreign to this attempt.",
        );
      }
      return claimed.lease;
    });
  }

  /**
   * Mutation authority for an existing qualification attempt. Historical
   * start-proof lookup remains available to bind stop to its start; this
   * method only authorizes acting on the current group journal tip.
   */
  async requireQualificationMutationTip(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
    readonly qualificationStartAuthority: CapabilityRuntimeQualificationStartAuthority;
    readonly kind: "start" | "stop";
    readonly startProofFingerprint?: ContentFingerprint;
  }): Promise<void> {
    await this.options.lock.withLock(async () => {
      const group = await this.#requireReviewedGroup(input.group);
      this.#assertExpectedMaterials(group, input.expectedMaterials);
      const authority = validateCapabilityRuntimeQualificationStartAuthority(
        input.qualificationStartAuthority,
      );
      const tip = await this.#groupTip(group);
      if (input.kind === "start") {
        const exact = await this.#uniqueQualificationStartEntry(group, authority);
        if (exact && (!tip || tip.id !== exact.id)) {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Capability runtime qualification start is blocked by a later group tip.",
          );
        }
        return;
      }
      if (!input.startProofFingerprint) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop requires the exact start proof.",
        );
      }
      const start = await this.#qualificationStartProofByFingerprint(
        group,
        authority,
        input.startProofFingerprint,
      );
      if (!start) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop requires the exact start proof.",
        );
      }
      const stopId = await qualificationStopIntentId(
        group,
        input.startProofFingerprint,
      );
      if (!tip || (tip.id !== start.journalEntry.id && tip.id !== stopId)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop is blocked by a later group tip.",
        );
      }
    });
  }

  async verifyQualificationStopProof(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
    readonly qualificationStartAuthority: CapabilityRuntimeQualificationStartAuthority;
    readonly proof: CapabilityRuntimeQualificationHostStopProof;
  }): Promise<CapabilityRuntimeQualificationHostStopProof> {
    return await this.options.lock.withLock(async () => {
      const group = await this.#requireReviewedGroup(input.group);
      this.#assertExpectedMaterials(group, input.expectedMaterials);
      const authority = validateCapabilityRuntimeQualificationStartAuthority(
        input.qualificationStartAuthority,
      );
      const proof = await validateCapabilityRuntimeQualificationHostStopProof(
        input.proof,
      );
      const expectedStopId = await qualificationStopIntentId(
        group,
        proof.startProofFingerprint,
      );
      if (proof.journalEntry.id !== expectedStopId) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof does not bind the derived stop intent.",
        );
      }
      const start = await this.#qualificationStartProofByFingerprint(
        group,
        authority,
        proof.startProofFingerprint,
      );
      if (!start) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof does not bind the exact start.",
        );
      }
      this.#assertQualificationStopProofFacts(group, start, proof);
      const stored = (await this.options.journal.list()).find((entry) =>
        entry.id === proof.journalEntry.id
      );
      if (
        !stored || deterministicJson(stored) !== deterministicJson(proof.journalEntry)
      ) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof does not match the journal.",
        );
      }
      const outcome = await this.#outcomeOf(proof.journalEntry.id);
      if (deterministicJson(outcome) !== deterministicJson(proof.outcome)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof outcome does not match the journal.",
        );
      }
      const expected = await createCapabilityRuntimeQualificationHostStopProof({
        schemaVersion: proof.schemaVersion,
        journalEntry: proof.journalEntry,
        outcome: proof.outcome,
        convergence: proof.convergence,
        observations: proof.observations,
        observedAt: proof.observedAt,
        startProofFingerprint: proof.startProofFingerprint,
      });
      if (
        expected.fingerprint.digest !== proof.fingerprint.digest ||
        expected.fingerprint.algorithm !== proof.fingerprint.algorithm
      ) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof fingerprint is not canonical.",
        );
      }
      return proof;
    });
  }

  /**
   * Observes an exact active qualification start proof. It never claims a
   * lease, journals, or starts Docker.
   */
  async readQualificationStartProof(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
    readonly qualificationStartAuthority: CapabilityRuntimeQualificationStartAuthority;
  }): Promise<CapabilityRuntimeQualificationStartProof | undefined> {
    return await this.options.lock.withLock(async () => {
      const group = await this.#requireReviewedGroup(input.group);
      this.#assertExpectedMaterials(group, input.expectedMaterials);
      const authority = validateCapabilityRuntimeQualificationStartAuthority(
        input.qualificationStartAuthority,
      );
      const observed = await this.#observe(group);
      if (!allActive(group, observed)) return undefined;
      const exact = await this.#uniqueQualificationStartEntry(group, authority);
      const tip = await this.#groupTip(group);
      if (!exact || !tip || tip.id !== exact.id) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification start refuses a foreign or superseded group tip.",
        );
      }
      return await this.#makeQualificationStartProof(
        group,
        exact,
        await this.#outcomeOf(exact.id),
        observed,
      );
    });
  }

  /**
   * Stops the qualification group from an exact start proof. Cleanup does not
   * require the current start policy, review, or bearer.
   */
  async releaseQualificationTerminal(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly expectedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
    readonly qualificationStartAuthority: CapabilityRuntimeQualificationStartAuthority;
    readonly startProofFingerprint: ContentFingerprint;
    readonly lease: CapabilityRuntimeLease;
    readonly at: string;
  }): Promise<CapabilityRuntimeQualificationStopProof> {
    return await this.options.lock.withLock(async () => {
      const group = await this.#requireReviewedGroup(input.group);
      this.#assertExpectedMaterials(group, input.expectedMaterials);
      const authority = validateCapabilityRuntimeQualificationStartAuthority(
        input.qualificationStartAuthority,
      );
      const start = await this.#qualificationStartProofByFingerprint(
        group,
        authority,
        input.startProofFingerprint,
      );
      if (!start) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop requires the exact start proof.",
        );
      }
      const expectedLease = validateCapabilityRuntimeLease(input.lease);
      const stopId = await qualificationStopIntentId(
        group,
        input.startProofFingerprint,
      );
      const tip = await this.#groupTip(group);
      if (!tip || (tip.id !== start.journalEntry.id && tip.id !== stopId)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop is blocked by a later group tip.",
        );
      }
      const existing = (await this.options.journal.list()).find((entry) =>
        entry.id === stopId
      );
      const existingOutcome = existing
        ? (await this.options.journal.listOutcomes()).find((outcome) =>
          outcome.journalEntryId === existing.id
        )
        : undefined;
      const observed = await this.#observe(group);
      const reconciled = await this.#reconcileQualificationStop(
        group,
        existing,
        existingOutcome,
        observed,
        input.startProofFingerprint,
        expectedLease,
        input.at,
      );
      if (reconciled) return reconciled;
      if (isPartial(group, observed)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop is blocked on a partial group observation.",
        );
      }
      await this.#requireMatchingQualificationLease(expectedLease);
      if (!allActive(group, observed)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop requires the exact active group or an exact terminal stop proof.",
        );
      }
      if (existing) {
        if (
          !existingOutcome &&
          matchesPreviousObservation(existing, group, observed)
        ) {
          const mutation = await this.#replay(existing, undefined);
          const after = await this.#observe(group);
          return await this.#finishQualificationStop(
            group,
            existing,
            mutation,
            after,
            input.startProofFingerprint,
            expectedLease,
            input.at,
          );
        }
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          `Capability runtime qualification stop is ${
            existingOutcome?.status ?? "pending"
          }; a second host stop is blocked.`,
        );
      }
      const mutation = await this.#mutate(
        group,
        "runtime-stop",
        CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
        input.at,
        observed,
        {
          intentId: stopId,
          plannedAt: start.journalEntry.plannedAt,
        },
      );
      const after = await this.#observe(group);
      const entry = existing ??
        (await this.options.journal.list()).find((item) => item.id === stopId);
      if (!entry) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop intent was not readable.",
        );
      }
      return await this.#finishQualificationStop(
        group,
        entry,
        mutation,
        after,
        input.startProofFingerprint,
        expectedLease,
        input.at,
      );
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
        uniqueGroups(input.groups).map((reference) => this.#requireGroup(reference)),
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

  async #requireReviewedGroup(
    reference: CapabilityRuntimeLaunchGroupReference,
  ): Promise<CapabilityRuntimeLaunchGroup> {
    const group = await this.#requireGroup(reference);
    if (group.security !== "reviewed") {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group topology is not reviewed.",
      );
    }
    await this.options.availabilityGate?.assertLaunchGroupAvailable(group);
    return group;
  }

  async #requireGroup(
    reference: CapabilityRuntimeLaunchGroupReference,
  ): Promise<CapabilityRuntimeLaunchGroup> {
    return await this.options.groups.require(reference);
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

  async #assertSecretSnapshotReady(
    group: CapabilityRuntimeLaunchGroup,
    secretSnapshot: CapabilityRuntimeSecretSnapshot | undefined,
  ): Promise<void> {
    if (group.secretSlots.length > 0 && secretSnapshot === undefined) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group requires a server-minted launch secret snapshot.",
      );
    }
    const availability = await this.options.secrets.observe(group.secretSlots);
    if (group.secretSlots.some((slot) => availability.get(slot) !== "available")) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group secret availability is unknown or unavailable.",
      );
    }
  }

  #assertQualificationStopProofFacts(
    group: CapabilityRuntimeLaunchGroup,
    start: CapabilityRuntimeQualificationStartProof,
    proof: CapabilityRuntimeQualificationHostStopProof,
  ): void {
    const reference = capabilityRuntimeLaunchGroupReference(group);
    if (
      !sameCapabilityRuntimeLaunchGroupReference(
        proof.journalEntry.launchGroup,
        reference,
      ) ||
      !sameCapabilityRuntimeLaunchGroupReference(
        start.journalEntry.launchGroup,
        reference,
      )
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop proof does not bind the exact launch group.",
      );
    }
    if (
      proof.journalEntry.projectId !==
        CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID ||
      start.journalEntry.projectId !==
        CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop proof does not bind the reserved qualification owner.",
      );
    }
    if (
      !sameGroupMaterials(group, proof.journalEntry.materials) ||
      !sameGroupMaterials(group, start.journalEntry.materials)
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop proof materials do not match the launch group.",
      );
    }
    if (
      !coversExactGroup(group, start.observations) ||
      !allActive(group, start.observations)
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification start proof observations are not the exact active group.",
      );
    }
    const stopStates = statesOf(proof.observations);
    if (
      proof.observations.length !== group.materials.length ||
      !coversExactGroup(group, stopStates) ||
      !allInactive(group, stopStates)
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop proof observations are not the exact inactive group.",
      );
    }
    if (proof.convergence === "host-outcome-succeeded") {
      if (!outcomeProvesExactRuntime(group, proof.outcome, "inactive")) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof convergence contradicts its journal outcome.",
        );
      }
      if (
        deterministicJson(proof.observations) !==
          deterministicJson(observationVector(group, observationMap(proof.outcome!)))
      ) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop proof observations contradict the succeeded outcome.",
        );
      }
    } else if (outcomeProvesExactRuntime(group, proof.outcome, "inactive")) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop proof convergence contradicts its journal outcome.",
      );
    }
  }

  #assertExpectedMaterials(
    group: CapabilityRuntimeLaunchGroup,
    expected: readonly CapabilityRuntimeMaterialIdentity[],
  ): void {
    if (
      expected.length !== group.materials.length ||
      !group.materials.every((member) =>
        expected.some((material) => sameMaterial(material, member.material))
      )
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime activation does not bind the exact launch-group material digests.",
      );
    }
  }

  async #assertEffectiveRuntimeProjection(
    group: CapabilityRuntimeLaunchGroup,
    expected: readonly CapabilityRuntimeMaterialIdentity[],
    value: EffectiveCapabilityRuntimeLaunchProjection,
    resolvedOperation: ResolvedCapabilityRuntimeOperation,
  ): Promise<void> {
    const projection = await validateEffectiveCapabilityRuntimeLaunchProjection(value);
    const expectedProjection = await deriveEffectiveCapabilityRuntimeLaunchProjection({
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      operation: resolvedOperation,
    });
    if (
      projection.fingerprint.digest !== expectedProjection.fingerprint.digest ||
      projection.fingerprint.algorithm !== expectedProjection.fingerprint.algorithm
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime projection does not match the exact rechecked ROP binding, mode, or attestation.",
      );
    }
    const reference = capabilityRuntimeLaunchGroupReference(group);
    if (!sameCapabilityRuntimeLaunchGroupReference(projection.launchGroup, reference)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime projection names another immutable launch group.",
      );
    }
    if (
      projection.materials.length !== group.materials.length ||
      projection.materials.some((entry) =>
        !group.materials.some((member) => sameMaterial(member.material, entry.material))
      ) ||
      projection.materials.some((entry) =>
        !expected.some((material) => sameMaterial(material, entry.material))
      )
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime projection does not cover the exact sealed group materials.",
      );
    }
  }

  async #claim(
    lease: CapabilityRuntimeLease,
    reuse: "allow" | "reject",
    at: string,
    queuedPreclaimResumeOwner?: CapabilityRuntimeExecutionLeaseOwner,
  ): Promise<"created" | "reused"> {
    const claim = await this.options.leases.claim(lease);
    if (claim.status === "created") {
      if (queuedPreclaimResumeOwner !== undefined) {
        await this.options.leases.release(lease.id);
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "A queued pre-claim resume requires its exact retained lease; a replacement session lease was not accepted.",
        );
      }
      return "created";
    }
    if (
      reuse === "reject" ||
      !sameLeaseScope(claim.lease, lease)
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "An existing capability runtime lease requires explicit recovery.",
      );
    }
    if (queuedPreclaimResumeOwner !== undefined) {
      // `at` belongs to the caller's sealed request. Queue retry expiry is a
      // host decision, so it uses H1's fresh clock while the mutex is held.
      if (
        claim.lease.expiresAt <= this.#now() ||
        !sameExactCapabilityRuntimeExecutionLeaseOwner(
          lease.executionOwner,
          queuedPreclaimResumeOwner,
        ) ||
        !sameExactCapabilityRuntimeExecutionLeaseOwner(
          claim.lease.executionOwner,
          queuedPreclaimResumeOwner,
        )
      ) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "A queued pre-claim resume lease is expired, foreign, or lacks its exact execution owner.",
        );
      }
      return "reused";
    }
    if (claim.lease.expiresAt <= at) {
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

  /**
   * A private qualification probe has exclusive possession of its complete
   * persistent group. Ordinary engineering execution waits rather than
   * sharing a process whose candidate credentials/configuration are changing.
   */
  async #assertNoQualificationLeaseProtects(
    group: CapabilityRuntimeLaunchGroup,
    leaseId: string,
    at: string,
  ): Promise<void> {
    const protectedByQualification = (await this.options.leases.listActive(at)).some(
      (lease) =>
        lease.id !== leaseId &&
        lease.projectId === CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID &&
        leaseProtectsGroup(lease, group),
    );
    if (protectedByQualification) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime group is exclusively leased by a private qualification probe.",
      );
    }
  }

  /** A qualification probe never shares its group with another active lease. */
  async #assertNoOtherLeaseProtects(
    group: CapabilityRuntimeLaunchGroup,
    leaseId: string,
    at: string,
  ): Promise<void> {
    const protectedByAnotherLease = (await this.options.leases.listActive(at)).some(
      (lease) => lease.id !== leaseId && leaseProtectsGroup(lease, group),
    );
    if (protectedByAnotherLease) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification requires exclusive possession of its exact launch group.",
      );
    }
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

  async #assertLeasePreflight(
    lease: CapabilityRuntimeLease,
    reuse: "allow" | "reject",
    at: string,
  ): Promise<void> {
    const existing = await this.options.leases.read(lease.id);
    if (!existing) return;
    if (
      reuse === "reject" || existing.expiresAt <= at ||
      !sameLeaseScope(existing, lease)
    ) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "An existing capability runtime lease requires explicit recovery.",
      );
    }
  }

  #assertQualificationLeaseScope(
    group: CapabilityRuntimeLaunchGroup,
    lease: CapabilityRuntimeLease,
  ): void {
    if (lease.projectId !== CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification lease requires the reserved local owner.",
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
      if (
        !lease.materialKeys.includes(capabilityRuntimeMaterialKey(material.material))
      ) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime lease does not protect each exact group material.",
        );
      }
    }
  }

  async #reconcileQualificationStart(
    group: CapabilityRuntimeLaunchGroup,
    authority: CapabilityRuntimeQualificationStartAuthority,
    observed: ReadonlyMap<string, CapabilityRuntimeObservedState>,
    secretSnapshot: CapabilityRuntimeSecretSnapshot | undefined,
  ): Promise<CapabilityRuntimeQualificationStartProof | undefined> {
    const exact = await this.#uniqueQualificationStartEntry(group, authority);
    const tip = await this.#groupTip(group);
    if (allActive(group, observed)) {
      if (!exact || !tip || tip.id !== exact.id) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification start refuses a foreign or superseded group tip.",
        );
      }
      return await this.#makeQualificationStartProof(
        group,
        exact,
        await this.#outcomeOf(exact.id),
        observed,
      );
    }
    if (isPartial(group, observed)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification start is blocked on a partial group observation.",
      );
    }
    if (!exact) return undefined;
    if (!tip || tip.id !== exact.id) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification start is blocked by a later group tip.",
      );
    }
    const outcome = await this.#outcomeOf(exact.id);
    if (outcome?.status === "succeeded") {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification start proof is succeeded but the group is inactive.",
      );
    }
    if (!matchesPreviousObservation(exact, group, observed)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification start prior observation does not match the inactive group.",
      );
    }
    if (outcome) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        `Capability runtime qualification start is ${outcome.status}; a second host start is blocked.`,
      );
    }
    const mutation = await this.#replay(exact, secretSnapshot);
    const active = await this.#observe(group);
    if (!allActive(group, active)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        `Capability runtime qualification start replay is ${mutation.status} without an exact active group.`,
      );
    }
    return await this.#makeQualificationStartProof(group, exact, mutation, active);
  }

  async #reconcileQualificationStop(
    group: CapabilityRuntimeLaunchGroup,
    existing: CapabilityRuntimeJournalEntry | undefined,
    existingOutcome: CapabilityRuntimeJournalOutcome | undefined,
    observed: ReadonlyMap<string, CapabilityRuntimeObservedState>,
    startProofFingerprint: ContentFingerprint,
    expectedLease: CapabilityRuntimeLease,
    at: string,
  ): Promise<CapabilityRuntimeQualificationStopProof | undefined> {
    if (!existing || !allInactive(group, observed)) return undefined;
    return await this.#releaseInactiveStopProof(
      group,
      existing,
      existingOutcome ?? null,
      observed,
      startProofFingerprint,
      expectedLease,
      at,
    );
  }

  async #releaseInactiveStopProof(
    group: CapabilityRuntimeLaunchGroup,
    entry: CapabilityRuntimeJournalEntry,
    outcome: CapabilityRuntimeJournalOutcome | null,
    observed: ReadonlyMap<string, CapabilityRuntimeObservedState>,
    startProofFingerprint: ContentFingerprint,
    expectedLease: CapabilityRuntimeLease,
    at: string,
  ): Promise<CapabilityRuntimeQualificationStopProof> {
    const held = await this.options.leases.read(expectedLease.id);
    if (held && !sameLeaseScope(held, expectedLease)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop lease is foreign to this attempt.",
      );
    }
    if (!held && outcome?.status !== "succeeded") {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop without a lease requires the exact prior succeeded stop proof.",
      );
    }
    if (held) {
      if (!sameLeaseScope(held, expectedLease)) {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Capability runtime qualification stop lease is foreign to this attempt.",
        );
      }
      await this.options.leases.release(expectedLease.id);
    }
    return await this.#makeQualificationStopProof(
      group,
      entry,
      outcome,
      observed,
      startProofFingerprint,
      at,
    );
  }

  async #finishQualificationStop(
    group: CapabilityRuntimeLaunchGroup,
    entry: CapabilityRuntimeJournalEntry,
    mutation: CapabilityRuntimeJournalOutcome,
    after: ReadonlyMap<string, CapabilityRuntimeObservedState>,
    startProofFingerprint: ContentFingerprint,
    expectedLease: CapabilityRuntimeLease,
    at: string,
  ): Promise<CapabilityRuntimeQualificationStopProof> {
    if (!allInactive(group, after)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        `Capability runtime qualification stop is ${mutation.status} without an exact inactive observation.`,
      );
    }
    return await this.#releaseInactiveStopProof(
      group,
      entry,
      mutation,
      after,
      startProofFingerprint,
      expectedLease,
      at,
    );
  }

  async #requireMatchingQualificationLease(
    expected: CapabilityRuntimeLease,
  ): Promise<CapabilityRuntimeLease> {
    const held = await this.options.leases.read(expected.id);
    if (!held) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop without a lease requires the exact prior succeeded stop proof.",
      );
    }
    if (!sameLeaseScope(held, expected)) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification stop lease is foreign to this attempt.",
      );
    }
    return held;
  }

  async #qualificationStartProofByFingerprint(
    group: CapabilityRuntimeLaunchGroup,
    authority: CapabilityRuntimeQualificationStartAuthority,
    fingerprint: ContentFingerprint,
  ): Promise<CapabilityRuntimeQualificationStartProof | undefined> {
    const matches = await this.#qualificationStartEntries(group, authority);
    const proofs = [];
    for (const journalEntry of matches) {
      const proof = await this.#makeQualificationStartProof(
        group,
        journalEntry,
        await this.#outcomeOf(journalEntry.id),
        canonicalStates(group, "active"),
      );
      if (
        proof.fingerprint.algorithm === fingerprint.algorithm &&
        proof.fingerprint.digest === fingerprint.digest
      ) {
        proofs.push(proof);
      }
    }
    if (proofs.length > 1) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification has multiple exact start proofs.",
      );
    }
    return proofs[0];
  }

  async #qualificationStartEntries(
    group: CapabilityRuntimeLaunchGroup,
    authority: CapabilityRuntimeQualificationStartAuthority,
  ): Promise<readonly CapabilityRuntimeJournalEntry[]> {
    const reference = capabilityRuntimeLaunchGroupReference(group);
    return (await this.options.journal.list()).filter((entry) =>
      entry.action === "runtime-qualification-start" &&
      entry.projectId === CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID &&
      sameCapabilityRuntimeLaunchGroupReference(entry.launchGroup, reference) &&
      deterministicJson(entry.qualificationStartAuthority) ===
        deterministicJson(authority)
    );
  }

  async #succeededJournalEntries(
    entries: readonly CapabilityRuntimeJournalEntry[],
  ): Promise<readonly CapabilityRuntimeJournalEntry[]> {
    const outcomes = await this.options.journal.listOutcomes();
    return entries.filter((entry) =>
      outcomes.some((outcome) =>
        outcome.journalEntryId === entry.id && outcome.status === "succeeded"
      )
    );
  }

  async #makeQualificationStartProof(
    group: CapabilityRuntimeLaunchGroup,
    journalEntry: CapabilityRuntimeJournalEntry,
    outcome: CapabilityRuntimeJournalOutcome | null,
    observed: ReadonlyMap<string, CapabilityRuntimeObservedState>,
  ): Promise<CapabilityRuntimeQualificationStartProof> {
    const authority = validateCapabilityRuntimeQualificationStartAuthority(
      journalEntry.qualificationStartAuthority,
    );
    const exact = outcomeProvesExactRuntime(group, outcome, "active");
    const convergence = exact
      ? "host-outcome-succeeded" as const
      : "observed-all-active-after-exact-intent" as const;
    const observations = exact ? observationMap(outcome!) : observed;
    return {
      qualificationStartAuthority: authority,
      journalEntry,
      outcome,
      convergence,
      observations,
      fingerprint: await fingerprintQualificationStartProof({
        journalEntry,
        outcome,
        convergence,
        observations: observationVector(group, observations),
      }),
    };
  }

  async #makeQualificationStopProof(
    group: CapabilityRuntimeLaunchGroup,
    journalEntry: CapabilityRuntimeJournalEntry,
    outcome: CapabilityRuntimeJournalOutcome | null,
    observed: ReadonlyMap<string, CapabilityRuntimeObservedState>,
    startProofFingerprint: ContentFingerprint,
    observedAt: string,
  ): Promise<CapabilityRuntimeQualificationStopProof> {
    const exact = outcomeProvesExactRuntime(group, outcome, "inactive");
    const convergence = exact
      ? "host-outcome-succeeded" as const
      : "observed-all-inactive-after-exact-intent" as const;
    const observations = exact ? observationMap(outcome!) : observed;
    return await createCapabilityRuntimeQualificationHostStopProof({
      schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA,
      journalEntry,
      outcome,
      convergence,
      observations: observationVector(group, observations),
      observedAt,
      startProofFingerprint,
    });
  }

  async #groupTip(
    group: CapabilityRuntimeLaunchGroup,
  ): Promise<CapabilityRuntimeJournalEntry | undefined> {
    return (await this.options.journal.list()).filter((entry) =>
      hasGroupIntent([entry], group)
    ).toSorted((left, right) =>
      left.plannedAt.localeCompare(right.plannedAt) || left.id.localeCompare(right.id)
    ).at(-1);
  }

  async #uniqueQualificationStartEntry(
    group: CapabilityRuntimeLaunchGroup,
    authority: CapabilityRuntimeQualificationStartAuthority,
  ): Promise<CapabilityRuntimeJournalEntry | undefined> {
    const matches = await this.#qualificationStartEntries(group, authority);
    if (matches.length > 1) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Capability runtime qualification has multiple exact start proofs.",
      );
    }
    return matches[0];
  }

  async #outcomeOf(
    journalEntryId: string,
  ): Promise<CapabilityRuntimeJournalOutcome | null> {
    return (await this.options.journal.listOutcomes()).find((item) =>
      item.journalEntryId === journalEntryId
    ) ?? null;
  }

  async #assertNoForeignPending(
    group: CapabilityRuntimeLaunchGroup,
    authority: CapabilityRuntimeQualificationStartAuthority,
  ): Promise<void> {
    const exact = await this.#qualificationStartEntries(group, authority);
    const journal = await this.options.journal.list();
    const latest = journal.filter((entry) => hasGroupIntent([entry], group))
      .toSorted((left, right) =>
        left.plannedAt.localeCompare(right.plannedAt) || left.id.localeCompare(right.id)
      ).at(-1);
    if (latest && !exact.some((entry) => entry.id === latest.id)) {
      await this.#assertNoPending(group);
    }
  }

  async #replay(
    entry: CapabilityRuntimeJournalEntry,
    secretSnapshot: CapabilityRuntimeSecretSnapshot | undefined,
  ): Promise<CapabilityRuntimeJournalOutcome> {
    const authorization = entry.action === "runtime-qualification-start"
      ? await authorizeDurableQualificationRuntimeStart(entry, this.options.journal)
      : entry.action === "runtime-stop"
      ? await authorizeDurableRuntimeStop(entry, this.options.journal)
      : (() => {
        throw new CapabilityRuntimeLaunchGroupSafetyError(
          "Qualification replay requires an exact start or stop intent.",
        );
      })();
    let outcome: CapabilityRuntimeJournalOutcome;
    try {
      outcome = await this.options.host.mutate({ authorization, secretSnapshot });
    } catch (error) {
      outcome = {
        schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
        journalEntryId: entry.id,
        recordedAt: new Date().toISOString(),
        status: "uncertain",
        observations: entry.materials.map((material) => ({ material, state: null })),
        detail: "Sealed qualification replay did not return an outcome.",
      };
      void error;
    }
    if (outcome.journalEntryId !== entry.id) {
      throw new CapabilityRuntimeLaunchGroupSafetyError(
        "Host returned an outcome for another group intent.",
      );
    }
    await this.options.journal.appendOutcome(outcome);
    return outcome;
  }

  async #mutate(
    group: CapabilityRuntimeLaunchGroup,
    action: CapabilityRuntimeJournalEntry["action"],
    projectId: string | null,
    at: string,
    states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
    options: {
      readonly effectiveRuntimeProjection?: EffectiveCapabilityRuntimeLaunchProjection;
      readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
      readonly qualificationStartAuthority?:
        CapabilityRuntimeQualificationStartAuthority;
      readonly intentId?: string;
      readonly plannedAt?: string;
    } = {},
  ): Promise<CapabilityRuntimeJournalOutcome> {
    const entry: CapabilityRuntimeJournalEntry = {
      id: options.intentId ??
        `capability-group-${await shortId(group, action, at, projectId)}`,
      action,
      materials: group.materials.map((material) => ({ ...material.material })),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      projectId,
      plannedAt: options.plannedAt ?? at,
      previousObservations: group.materials.map((material) => ({
        material: { ...material.material },
        state: states.get(capabilityRuntimeMaterialKey(material.material)) ?? null,
      })),
      effectiveRuntimeProjection: action === "runtime-start"
        ? options.effectiveRuntimeProjection ?? (() => {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Normal runtime start requires its exact effective projection.",
          );
        })()
        : null,
      qualificationStartAuthority: action === "runtime-qualification-start"
        ? options.qualificationStartAuthority ?? (() => {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Qualification runtime start requires its exact private authority.",
          );
        })()
        : null,
      administrativeRemovalPlanFingerprint: null,
    };
    await this.options.journal.appendBeforeMutation(entry);
    let outcome: CapabilityRuntimeJournalOutcome;
    try {
      const authorization = action === "material-acquire"
        ? await authorizeDurableMaterialAcquire(entry, this.options.journal)
        : action === "runtime-start"
        ? await authorizeDurableNormalRuntimeStart(entry, this.options.journal)
        : action === "runtime-qualification-start"
        ? await authorizeDurableQualificationRuntimeStart(entry, this.options.journal)
        : action === "runtime-stop"
        ? await authorizeDurableRuntimeStop(entry, this.options.journal)
        : (() => {
          throw new CapabilityRuntimeLaunchGroupSafetyError(
            "Launch group supervisor cannot remove materials administratively.",
          );
        })();
      outcome = await this.options.host.mutate({
        authorization,
        secretSnapshot: options.secretSnapshot,
      });
    } catch (error) {
      outcome = {
        schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
        journalEntryId: entry.id,
        recordedAt: new Date().toISOString(),
        status: "uncertain",
        observations: entry.materials.map((material) => ({ material, state: null })),
        // An injector/Compose implementation must never leak bearer material
        // into a durable journal, even if its own error message is defective.
        // Secret-bearing groups therefore receive only a fixed diagnostic.
        detail: group.secretSlots.length > 0
          ? "Sealed secret-bearing launch group mutation did not return an outcome."
          : compact(error),
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

async function fingerprintQualificationStartProof(input: {
  readonly journalEntry: CapabilityRuntimeJournalEntry;
  readonly outcome: CapabilityRuntimeJournalOutcome | null;
  readonly convergence: CapabilityRuntimeQualificationConvergence;
  readonly observations: readonly unknown[];
}): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: "capability-runtime-qualification-start-proof/2.0",
    journalEntry: input.journalEntry,
    outcome: input.outcome,
    convergence: input.convergence,
    observations: input.observations,
    qualificationStartAuthority: input.journalEntry.qualificationStartAuthority,
  });
}

function isPartial(
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): boolean {
  return !allActive(group, states) && !allInactive(group, states);
}

function canonicalStates(
  group: CapabilityRuntimeLaunchGroup,
  runtime: "active" | "inactive",
): ReadonlyMap<string, CapabilityRuntimeObservedState> {
  return new Map(
    group.materials.map((member) => [
      capabilityRuntimeMaterialKey(member.material),
      { material: "installed" as const, runtime },
    ]),
  );
}

function observationMap(
  outcome: CapabilityRuntimeJournalOutcome,
): ReadonlyMap<string, CapabilityRuntimeObservedState> {
  return statesOf(outcome.observations);
}

function statesOf(
  observations: CapabilityRuntimeJournalOutcome["observations"],
): ReadonlyMap<string, CapabilityRuntimeObservedState> {
  return new Map(
    observations.flatMap((item) =>
      item.state
        ? [[capabilityRuntimeMaterialKey(item.material), item.state] as const]
        : []
    ),
  );
}

function outcomeProvesExactRuntime(
  group: CapabilityRuntimeLaunchGroup,
  outcome: CapabilityRuntimeJournalOutcome | null,
  runtime: "active" | "inactive",
): boolean {
  if (outcome?.status !== "succeeded") return false;
  const states = observationMap(outcome);
  return coversExactGroup(group, states) &&
    (runtime === "active" ? allActive(group, states) : allInactive(group, states));
}

function coversExactGroup(
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): boolean {
  const keys = group.materials.map((member) =>
    capabilityRuntimeMaterialKey(member.material)
  );
  return states.size === keys.length && keys.every((key) => states.has(key));
}

function sameGroupMaterials(
  group: CapabilityRuntimeLaunchGroup,
  materials: readonly CapabilityRuntimeMaterialIdentity[],
): boolean {
  return materials.length === group.materials.length &&
    group.materials.every((member) =>
      materials.some((material) => sameMaterial(material, member.material))
    );
}

function observationVector(
  group: CapabilityRuntimeLaunchGroup,
  states: ReadonlyMap<string, CapabilityRuntimeObservedState>,
): CapabilityRuntimeJournalOutcome["observations"] {
  return group.materials.map((member) => ({
    material: member.material,
    state: states.get(capabilityRuntimeMaterialKey(member.material)) ?? null,
  }));
}

export async function qualificationStopIntentId(
  group: CapabilityRuntimeLaunchGroup,
  startProofFingerprint: ContentFingerprint,
): Promise<string> {
  const digest = await sha256Hex(
    new TextEncoder().encode(
      `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}\u0000runtime-stop\u0000${CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID}\u0000${startProofFingerprint.digest}`,
    ),
  );
  return `capability-group-runtime-stop-${digest}`;
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
    return state?.material === "installed" && state.runtime === "active";
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
  left: CapabilityRuntimeMaterialIdentity,
  right: CapabilityRuntimeMaterialIdentity,
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}

function sameState(
  left: CapabilityRuntimeObservedState,
  right: CapabilityRuntimeObservedState,
): boolean {
  return left.material === right.material && left.runtime === right.runtime;
}

function stateSatisfiesAction(
  action: CapabilityRuntimeJournalEntry["action"],
  state: CapabilityRuntimeObservedState,
): boolean {
  switch (action) {
    case "material-acquire":
      return state.material === "installed";
    case "runtime-start":
    case "runtime-qualification-start":
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
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].toSorted();
  const orderedRight = [...right].toSorted();
  return orderedLeft.every((token, index) => token === orderedRight[index]);
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
