/**
 * One closed, server-owned host-only rollover for mcp-chrono 0.3.1 → 0.3.2.
 *
 * This is intentionally not a generic provider migration framework. Project
 * capability amendment and administrative-lock reconciliation to the successor
 * happen on ordinary surfaces before this saga. The saga never appends a
 * ledger, never writes the lock, and never starts the successor runtime.
 */

import {
  type CapabilityRuntimeRolloverIdentity,
  type CapabilityRuntimeRolloverSaga,
} from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type CapabilityRuntimeJournalEntry,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { type ProjectCapabilityLedger } from "./project-capability-authorization.ts";
import {
  authorizeDurableRolloverPredecessorRuntimeRetire,
  authorizeDurableRolloverSuccessorMaterialAcquire,
} from "./capability-runtime-rollover-host-authorization.ts";
import {
  assertChronoRolloverIdentityMatchesDefinition,
  assertClosedChronoRolloverDefinition,
  type CapabilityRuntimeChronoRolloverDefinition,
  CapabilityRuntimeChronoRolloverError,
  CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
  chronoRolloverIdentityFor,
  emptyChronoRolloverIdentity,
  isSuccessorLock,
  proposalHasExactChronoUnitMaterials,
  rolloverReviewBasis,
  sameLockedUnit,
  sameUnit,
  successorLockDesiredAllowsAuthorizedUse,
} from "./capability-runtime-chrono-rollover-definition.ts";
import type { AtomicCapabilityRuntimeUnit } from "./read-model/capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseStore,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeRolloverHost } from "../ports/out/capability/capability-runtime-rollover-host.ts";
import type { CapabilityRuntimeRolloverSagaStore } from "../ports/out/capability/capability-runtime-rollover-saga-store.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type { CapabilityRuntimeAdminLock } from "./read-model/capability-runtime-catalog.ts";

export {
  CapabilityRuntimeChronoRolloverError,
  CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
} from "./capability-runtime-chrono-rollover-definition.ts";

export interface CapabilityRuntimeChronoRolloverJitDemandReader {
  hasRemainingDemand(input: {
    readonly projectId: string;
    readonly unitId: string;
  }): Promise<boolean>;
}

export interface CapabilityRuntimeChronoRolloverServiceOptions
  extends CapabilityRuntimeChronoRolloverDefinition {
  readonly ledgers: ProjectCapabilityLedgerStore;
  readonly lock: { read(): Promise<CapabilityRuntimeAdminLock> };
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly journal: CapabilityRuntimeJournal;
  readonly sagas: CapabilityRuntimeRolloverSagaStore;
  readonly host: CapabilityRuntimeRolloverHost;
  readonly hostMutationLock: CapabilityRuntimeHostMutationLock;
  readonly jitDemand: CapabilityRuntimeChronoRolloverJitDemandReader;
  readonly now?: () => string;
}

export type CapabilityRuntimeChronoRolloverStatus =
  | "ready"
  | "blocked"
  | "in-progress"
  | "completed"
  | "recovery-required";

export interface CapabilityRuntimeChronoRolloverReview {
  readonly schemaVersion: "capability-runtime-chrono-rollover-review/1.0";
  readonly transitionId: typeof CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID;
  readonly status: CapabilityRuntimeChronoRolloverStatus;
  readonly identity: CapabilityRuntimeRolloverIdentity | null;
  readonly saga: CapabilityRuntimeRolloverSaga | null;
  readonly blockers: readonly string[];
  readonly reviewFingerprint: ContentFingerprint | null;
}

/**
 * H1 orchestrator. All mutable steps happen under the same host mutex used by
 * normal group lifecycle work. The durable saga becomes the barrier before a
 * Docker command can be authorized, and it remains a barrier until completed.
 */
export class CapabilityRuntimeChronoRolloverService {
  readonly #now: () => string;

  constructor(
    private readonly options: CapabilityRuntimeChronoRolloverServiceOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async status(
    transitionId: string,
  ): Promise<CapabilityRuntimeChronoRolloverReview> {
    this.#requireTransitionId(transitionId);
    return await this.options.hostMutationLock.withLock(async () =>
      await this.#reviewUnlocked()
    );
  }

  async review(
    transitionId: string,
  ): Promise<CapabilityRuntimeChronoRolloverReview> {
    return await this.status(transitionId);
  }

  async apply(input: {
    readonly transitionId: string;
    readonly reviewFingerprint: ContentFingerprint;
    readonly confirm: boolean;
  }): Promise<CapabilityRuntimeChronoRolloverReview> {
    this.#requireTransitionId(input.transitionId);
    if (!input.confirm) {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono rollover requires explicit local operator confirmation.",
      );
    }
    return await this.options.hostMutationLock.withLock(async () => {
      let review = await this.#reviewUnlocked();
      this.#assertExactReview(review, input.reviewFingerprint);
      if (review.status === "completed") return review;
      if (review.status === "recovery-required" || review.status === "blocked") {
        throw new CapabilityRuntimeChronoRolloverError(
          `Chrono rollover cannot apply while review status is ${review.status}.`,
        );
      }
      let identity = review.identity;
      if (!identity) {
        throw new CapabilityRuntimeChronoRolloverError(
          "Chrono rollover review did not produce one exact migration identity.",
        );
      }
      let saga = review.saga;
      if (!saga) {
        saga = await this.options.sagas.prepare(identity);
      }
      identity = saga.identity;
      await this.#converge(identity, saga);
      review = await this.#reviewUnlocked();
      return review;
    });
  }

  async #reviewUnlocked(): Promise<CapabilityRuntimeChronoRolloverReview> {
    assertClosedChronoRolloverDefinition(this.options);
    const key = { transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID } as const;
    const saga = await this.options.sagas.read(key);
    if (saga) {
      assertChronoRolloverIdentityMatchesDefinition(saga.identity, this.options);
      const status = saga.phase === "completed"
        ? "completed"
        : saga.phase === "recovery-required"
        ? "recovery-required"
        : "in-progress";
      const host = await this.options.host.observeRollover({ identity: saga.identity });
      return {
        schemaVersion: "capability-runtime-chrono-rollover-review/1.0",
        transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
        status,
        identity: saga.identity,
        saga,
        blockers: status === "in-progress"
          ? [
            "Chrono rollover has a durable non-terminal intent; preload and JIT remain blocked.",
          ]
          : status === "recovery-required"
          ? [
            "Chrono rollover reached recovery-required; no automatic rollback or Docker mutation is permitted.",
          ]
          : [],
        reviewFingerprint: await sha256Fingerprint({
          schemaVersion: "capability-runtime-chrono-rollover-review-fingerprint/1.0",
          status,
          identity: saga.identity,
          sagaFingerprint: saga.fingerprint,
          host,
        }),
      };
    }
    const preflight = await this.#preflight();
    if (preflight.blockers.length > 0 || !preflight.identity) {
      return {
        schemaVersion: "capability-runtime-chrono-rollover-review/1.0",
        transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
        status: "blocked",
        identity: preflight.identity,
        saga: null,
        blockers: preflight.blockers,
        reviewFingerprint: null,
      };
    }
    return {
      schemaVersion: "capability-runtime-chrono-rollover-review/1.0",
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      status: "ready",
      identity: preflight.identity,
      saga: null,
      blockers: [],
      reviewFingerprint: await sha256Fingerprint({
        schemaVersion: "capability-runtime-chrono-rollover-review-fingerprint/1.0",
        status: "ready",
        identity: rolloverReviewBasis(preflight.identity),
        lock: preflight.lockFingerprint,
        ledgers: preflight.authorized.map((ledger) => ledger.ledgerFingerprint),
        host: preflight.host,
      }),
    };
  }

  async #preflight(): Promise<{
    readonly identity: CapabilityRuntimeRolloverIdentity | null;
    readonly blockers: readonly string[];
    readonly authorized: readonly ProjectCapabilityLedger[];
    readonly lockFingerprint: ContentFingerprint;
    readonly host: Awaited<
      ReturnType<CapabilityRuntimeRolloverHost["observeRollover"]>
    >;
  }> {
    const [ledgers, pending, lock, leases, entries, outcomes] = await Promise.all([
      this.options.ledgers.list(),
      this.options.ledgers.listPending(),
      this.options.lock.read(),
      this.options.leases.listActive(this.#now()),
      this.options.journal.list(),
      this.options.journal.listOutcomes(),
    ]);
    const host = await this.options.host.observeRollover({
      identity: emptyChronoRolloverIdentity(this.options, this.#now()),
    });
    const blockers: string[] = [];
    if (pending.length > 0) {
      blockers.push(
        "Chrono rollover is blocked by a pending project capability ledger.",
      );
    }
    if (host.classification === "hybrid" || host.classification === "foreign") {
      blockers.push(
        "Chrono rollover requires an exact predecessor or absent host topology; a hybrid or foreign topology was observed.",
      );
    } else if (host.classification === "unknown") {
      blockers.push("Chrono rollover host topology could not be observed exactly.");
    } else if (host.classification === "successor") {
      blockers.push(
        "Chrono successor is already physically present without a durable rollover saga; recovery must not infer an authoritative handoff.",
      );
    }
    const authorized: ProjectCapabilityLedger[] = [];
    for (const ledger of ledgers) {
      const classified = this.#classifyChronoLedger(ledger);
      if (classified.kind === "none") continue;
      if (classified.kind === "unsupported") {
        blockers.push(
          `Capability ledger ${ledger.projectId} has an unsupported effective status.`,
        );
        continue;
      }
      if (classified.kind === "ambiguous") {
        blockers.push(
          `Capability ledger ${ledger.projectId} has ambiguous Chrono units.`,
        );
        continue;
      }
      if (classified.kind === "predecessor") {
        blockers.push(
          `Capability ledger ${ledger.projectId} is not the exact successor Chrono unit.`,
        );
        continue;
      }
      if (classified.kind === "unknown") {
        blockers.push(
          `Capability ledger ${ledger.projectId} retains an unknown Chrono unit identity.`,
        );
        continue;
      }
      authorized.push(ledger);
    }
    if (
      !isSuccessorLock(lock, this.options.successor.unit) ||
      !successorLockDesiredAllowsAuthorizedUse(
        lock,
        this.options.successor.unit,
        authorized.length,
      )
    ) {
      blockers.push(
        "Chrono rollover requires one exact successor administrative lock unit consistent with authorized successor use.",
      );
    }
    const predecessorReference = capabilityRuntimeLaunchGroupReference(
      this.options.predecessor.launchGroup,
    );
    const successorReference = capabilityRuntimeLaunchGroupReference(
      this.options.successor.launchGroup,
    );
    if (
      leases.some((lease) =>
        lease.launchGroups.some((group) =>
          sameCapabilityRuntimeLaunchGroupReference(group, predecessorReference) ||
          sameCapabilityRuntimeLaunchGroupReference(group, successorReference)
        )
      )
    ) {
      blockers.push("Chrono rollover is blocked by an active runtime lease.");
    }
    const outcomeIds = new Set(outcomes.map((outcome) => outcome.journalEntryId));
    if (
      entries.some((entry) =>
        !outcomeIds.has(entry.id) && this.#isChronoJournalEntry(entry)
      )
    ) {
      blockers.push("Chrono rollover is blocked by a pending runtime journal intent.");
    }
    for (const ledger of authorized) {
      try {
        if (
          await this.options.jitDemand.hasRemainingDemand({
            projectId: ledger.projectId,
            unitId: this.options.successor.unit.id,
          })
        ) {
          blockers.push(
            `Chrono rollover is blocked by JIT demand for ${ledger.projectId}.`,
          );
        }
      } catch (error) {
        blockers.push(
          `Chrono rollover cannot establish JIT demand for ${ledger.projectId}: ${
            compact(error)
          }`,
        );
      }
    }
    const identity = blockers.length === 0
      ? chronoRolloverIdentityFor(this.options, this.#now())
      : null;
    return {
      identity,
      blockers: blockers.toSorted(),
      authorized: authorized.toSorted((left, right) =>
        left.projectId.localeCompare(right.projectId)
      ),
      lockFingerprint: await sha256Fingerprint(lock),
      host,
    };
  }

  async #converge(
    identity: CapabilityRuntimeRolloverIdentity,
    initial: CapabilityRuntimeRolloverSaga,
  ): Promise<void> {
    let saga = initial;
    while (saga.phase !== "completed" && saga.phase !== "recovery-required") {
      if (saga.phase === "intent-recorded") {
        const observation = await this.options.host.acquireRolloverSuccessorMaterial({
          authorization: await authorizeDurableRolloverSuccessorMaterialAcquire(
            identity,
            this.options.sagas,
          ),
        });
        if (
          observation.classification === "hybrid" ||
          observation.classification === "foreign"
        ) {
          await this.#recovery(identity, observation.classification, observation);
          return;
        }
        if (
          observation.successor.materials !== "complete" ||
          (observation.classification !== "predecessor" &&
            observation.classification !== "absent")
        ) {
          throw new CapabilityRuntimeChronoRolloverError(
            "Chrono successor material acquisition did not produce complete successor materials on a predecessor or absent topology; the durable intent remains for recovery.",
          );
        }
        saga = await this.options.sagas.advance(identity, {
          phase: "successor-material-observed",
          evidenceFingerprint: await sha256Fingerprint(observation),
        });
        continue;
      }
      if (saga.phase === "successor-material-observed") {
        const observation = await this.options.host.retireRolloverPredecessor({
          authorization: await authorizeDurableRolloverPredecessorRuntimeRetire(
            identity,
            this.options.sagas,
          ),
        });
        if (
          observation.classification === "hybrid" ||
          observation.classification === "foreign"
        ) {
          await this.#recovery(identity, observation.classification, observation);
          return;
        }
        if (
          observation.classification !== "absent" ||
          observation.successor.materials !== "complete" ||
          observation.predecessor.runtime !== "inactive" ||
          observation.successor.runtime !== "inactive"
        ) {
          throw new CapabilityRuntimeChronoRolloverError(
            "Chrono predecessor retirement did not yield an absent inactive host with complete successor materials; the durable intent remains for recovery.",
          );
        }
        saga = await this.options.sagas.advance(identity, {
          phase: "successor-runtime-observed",
          evidenceFingerprint: await sha256Fingerprint(observation),
        });
        continue;
      }
      if (saga.phase === "successor-runtime-observed") {
        const receipt = await this.#verifiedSuccessorAuthority(identity);
        if (receipt === "recovery") return;
        saga = await this.options.sagas.advance(identity, {
          phase: "successor-lock-recorded",
          evidenceFingerprint: await sha256Fingerprint({
            schemaVersion: "capability-runtime-chrono-rollover-lock-receipt/1.0",
            mutated: false,
            ...receipt,
          }),
        });
        continue;
      }
      if (saga.phase === "successor-lock-recorded") {
        const receipt = await this.#verifiedSuccessorAuthority(identity);
        if (receipt === "recovery") return;
        saga = await this.options.sagas.advance(identity, {
          phase: "completed",
          evidenceFingerprint: await sha256Fingerprint({
            schemaVersion: "capability-runtime-chrono-rollover-completion/1.0",
            mutated: false,
            ...receipt,
          }),
        });
        continue;
      }
      throw new CapabilityRuntimeChronoRolloverError(
        `Chrono rollover cannot converge unexpected saga phase ${saga.phase}.`,
      );
    }
  }

  async #verifiedSuccessorAuthority(
    identity: CapabilityRuntimeRolloverIdentity,
  ): Promise<
    | "recovery"
    | {
      readonly lockFingerprint: ContentFingerprint;
      readonly host: Awaited<
        ReturnType<CapabilityRuntimeRolloverHost["observeRollover"]>
      >;
      readonly ledgers: readonly {
        readonly projectId: string;
        readonly ledgerRevision: number;
        readonly proposalFingerprint: ContentFingerprint;
        readonly ledgerFingerprint: ContentFingerprint;
      }[];
    }
  > {
    const pending = await this.options.ledgers.listPending();
    if (pending.length > 0) {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono rollover observed a pending project capability ledger after durable intent.",
      );
    }
    const [lock, host, ledgers] = await Promise.all([
      this.options.lock.read(),
      this.options.host.observeRollover({ identity }),
      this.options.ledgers.list(),
    ]);
    if (host.classification === "hybrid" || host.classification === "foreign") {
      await this.#recovery(identity, host.classification, host);
      return "recovery";
    }
    const authorized = [];
    for (const ledger of ledgers) {
      const classified = this.#classifyChronoLedger(ledger);
      if (classified.kind === "none") continue;
      if (classified.kind !== "successor") {
        throw new CapabilityRuntimeChronoRolloverError(
          `Chrono rollover ledger ${ledger.projectId} is not its exact successor revision.`,
        );
      }
      const proposal = ledger.effectiveEnvelope?.proposal;
      if (!proposal) {
        throw new CapabilityRuntimeChronoRolloverError(
          `Chrono rollover ledger ${ledger.projectId} lost its effective successor proposal.`,
        );
      }
      authorized.push({
        projectId: ledger.projectId,
        ledgerRevision: ledger.revision,
        proposalFingerprint: structuredClone(proposal.capabilityProposalFingerprint),
        ledgerFingerprint: structuredClone(ledger.ledgerFingerprint),
      });
    }
    if (
      !isSuccessorLock(lock, this.options.successor.unit) ||
      !successorLockDesiredAllowsAuthorizedUse(
        lock,
        this.options.successor.unit,
        authorized.length,
      ) ||
      host.classification !== "absent" ||
      host.successor.materials !== "complete" ||
      host.predecessor.runtime !== "inactive" ||
      host.successor.runtime !== "inactive"
    ) {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono rollover successor authority and absent inactive host did not verify as a no-op lock receipt.",
      );
    }
    return {
      lockFingerprint: await sha256Fingerprint(lock),
      host,
      ledgers: authorized.toSorted((left, right) =>
        left.projectId.localeCompare(right.projectId)
      ),
    };
  }

  async #recovery(
    identity: CapabilityRuntimeRolloverIdentity,
    recoveryState: "hybrid" | "foreign",
    observation: unknown,
  ): Promise<void> {
    await this.options.sagas.advance(identity, {
      phase: "recovery-required",
      recoveryState,
      evidenceFingerprint: await sha256Fingerprint(observation),
    });
  }

  #classifyChronoLedger(ledger: ProjectCapabilityLedger): {
    readonly kind:
      | "none"
      | "successor"
      | "predecessor"
      | "unknown"
      | "ambiguous"
      | "unsupported";
  } {
    const envelope = ledger.effectiveEnvelope;
    if (!envelope || envelope.status === "revoked") return { kind: "none" };
    if (envelope.status !== "authorized") return { kind: "unsupported" };
    const units = envelope.proposal.units.filter((unit) =>
      unit.id === this.options.successor.unit.id
    );
    if (units.length === 0) return { kind: "none" };
    if (units.length !== 1) return { kind: "ambiguous" };
    const unit = units[0]!;
    if (
      sameUnit(unit, this.options.successor.unit) &&
      proposalHasExactChronoUnitMaterials(
        envelope.proposal,
        this.options.successor.unit,
      )
    ) {
      return { kind: "successor" };
    }
    if (samePredecessorChrono(unit, this.options.predecessor.unit)) {
      return { kind: "predecessor" };
    }
    return { kind: "unknown" };
  }

  #isChronoJournalEntry(entry: CapabilityRuntimeJournalEntry): boolean {
    const predecessor = capabilityRuntimeLaunchGroupReference(
      this.options.predecessor.launchGroup,
    );
    const successor = capabilityRuntimeLaunchGroupReference(
      this.options.successor.launchGroup,
    );
    return sameCapabilityRuntimeLaunchGroupReference(entry.launchGroup, predecessor) ||
      sameCapabilityRuntimeLaunchGroupReference(entry.launchGroup, successor);
  }

  #requireTransitionId(value: string): void {
    if (value !== CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID) {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono rollover transition id is not recognized by this server.",
      );
    }
  }

  #assertExactReview(
    review: CapabilityRuntimeChronoRolloverReview,
    expected: ContentFingerprint,
  ): void {
    if (
      !review.reviewFingerprint ||
      !fingerprintsEqual(review.reviewFingerprint, expected)
    ) {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono rollover review no longer matches the exact durable and host state.",
      );
    }
  }
}

/** Gate injected into normal launch-group supervision. It is inert for every
 * group except Chrono and releases only after the dedicated saga is complete. */
export class CapabilityRuntimeChronoRolloverGate {
  constructor(private readonly sagas: CapabilityRuntimeRolloverSagaStore) {}

  async assertLaunchGroupAvailable(group: CapabilityRuntimeLaunchGroup): Promise<void> {
    if (group.id !== "casys-chrono") return;
    const saga = await this.sagas.read({
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    });
    if (saga && saga.phase !== "completed") {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono preload and JIT are blocked by a non-terminal server-owned rollover.",
      );
    }
  }
}

function samePredecessorChrono(
  unit: Pick<AtomicCapabilityRuntimeUnit, "id" | "version" | "manifestFingerprint">,
  predecessor: AtomicCapabilityRuntimeUnit,
): boolean {
  return sameLockedUnit({
    id: unit.id,
    version: unit.version,
    manifestFingerprint: unit.manifestFingerprint,
    desired: "inactive",
  }, predecessor);
}

function compact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 256
    ? `${message.slice(0, 253)}...`
    : message || "unknown error";
}
