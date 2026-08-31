/**
 * One closed, server-owned rollover for the published SysON node repack.
 *
 * This is intentionally not a generic provider migration framework. It moves
 * one immutable predecessor descriptor to one immutable successor descriptor
 * under the same H1 host mutex, preserving project ledgers, Thread/CAS/WAL
 * references and the retained SysON database volume.
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
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { type ProjectCapabilityLedger } from "./project-capability-authorization.ts";
import type {
  CapabilityRuntimeAdminLockWriter,
} from "./project-capability-authorization-service.ts";
import {
  authorizeDurableRolloverSuccessorMaterialAcquire,
  authorizeDurableRolloverSuccessorRuntimeStart,
} from "./capability-runtime-rollover-host-authorization.ts";
import {
  assertClosedSysonRolloverDefinition,
  assertSysonRolloverIdentityMatchesDefinition,
  type CapabilityRuntimeSysonRolloverDefinition,
  CapabilityRuntimeSysonRolloverError,
  emptySysonRolloverIdentity,
  isSuccessorLock,
  rolloverReviewBasis,
  sameLockedUnit,
  sameUnit,
  SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
  sysonRolloverIdentityFor,
} from "./capability-runtime-syson-rollover-definition.ts";
import {
  predecessorSysonRolloverLedgerFor,
  proposalHasExactUnitMaterials,
  successorSysonRolloverLedger,
} from "./capability-runtime-syson-rollover-ledger-transition.ts";
import type { CapabilityRuntimeAdminLock } from "./read-model/capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseStore,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeRolloverHost } from "../ports/out/capability/capability-runtime-rollover-host.ts";
import type { CapabilityRuntimeRolloverSagaStore } from "../ports/out/capability/capability-runtime-rollover-saga-store.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";

export {
  CapabilityRuntimeSysonRolloverError,
  SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
} from "./capability-runtime-syson-rollover-definition.ts";

export interface CapabilityRuntimeSysonRolloverJitDemandReader {
  hasRemainingDemand(input: {
    readonly projectId: string;
    readonly unitId: string;
  }): Promise<boolean>;
}

export interface CapabilityRuntimeSysonRolloverServiceOptions
  extends CapabilityRuntimeSysonRolloverDefinition {
  readonly ledgers: ProjectCapabilityLedgerStore;
  readonly lock: CapabilityRuntimeAdminLockWriter;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly journal: CapabilityRuntimeJournal;
  readonly sagas: CapabilityRuntimeRolloverSagaStore;
  readonly host: CapabilityRuntimeRolloverHost;
  readonly hostMutationLock: CapabilityRuntimeHostMutationLock;
  /**
   * Mandatory fail-closed drain: a rollover must establish that no affected
   * project still has ready or in-progress SysON work before a host handoff.
   */
  readonly jitDemand: CapabilityRuntimeSysonRolloverJitDemandReader;
  readonly now?: () => string;
}

export type CapabilityRuntimeSysonRolloverStatus =
  | "ready"
  | "blocked"
  | "in-progress"
  | "completed"
  | "recovery-required";

export interface CapabilityRuntimeSysonRolloverReview {
  readonly schemaVersion: "capability-runtime-syson-rollover-review/1.0";
  readonly transitionId: typeof SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID;
  readonly status: CapabilityRuntimeSysonRolloverStatus;
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
export class CapabilityRuntimeSysonRolloverService {
  readonly #now: () => string;

  constructor(private readonly options: CapabilityRuntimeSysonRolloverServiceOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async status(
    transitionId: string,
  ): Promise<CapabilityRuntimeSysonRolloverReview> {
    this.#requireTransitionId(transitionId);
    return await this.options.hostMutationLock.withLock(async () =>
      await this.#reviewUnlocked()
    );
  }

  async review(
    transitionId: string,
  ): Promise<CapabilityRuntimeSysonRolloverReview> {
    return await this.status(transitionId);
  }

  async apply(input: {
    readonly transitionId: string;
    readonly reviewFingerprint: ContentFingerprint;
    readonly confirm: boolean;
  }): Promise<CapabilityRuntimeSysonRolloverReview> {
    this.#requireTransitionId(input.transitionId);
    if (!input.confirm) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON rollover requires explicit local operator confirmation.",
      );
    }
    return await this.options.hostMutationLock.withLock(async () => {
      let review = await this.#reviewUnlocked();
      this.#assertExactReview(review, input.reviewFingerprint);
      if (review.status === "completed") return review;
      if (review.status === "recovery-required" || review.status === "blocked") {
        throw new CapabilityRuntimeSysonRolloverError(
          `SysON rollover cannot apply while review status is ${review.status}.`,
        );
      }
      let identity = review.identity;
      if (!identity) {
        throw new CapabilityRuntimeSysonRolloverError(
          "SysON rollover review did not produce one exact migration identity.",
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

  async #reviewUnlocked(): Promise<CapabilityRuntimeSysonRolloverReview> {
    assertClosedSysonRolloverDefinition(this.options);
    const key = { transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID } as const;
    const saga = await this.options.sagas.read(key);
    if (saga) {
      assertSysonRolloverIdentityMatchesDefinition(saga.identity, this.options);
      const status = saga.phase === "completed"
        ? "completed"
        : saga.phase === "recovery-required"
        ? "recovery-required"
        : "in-progress";
      const host = await this.options.host.observeRollover({ identity: saga.identity });
      return {
        schemaVersion: "capability-runtime-syson-rollover-review/1.0",
        transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
        status,
        identity: saga.identity,
        saga,
        blockers: status === "in-progress"
          ? [
            "SysON rollover has a durable non-terminal intent; preload and JIT remain blocked.",
          ]
          : status === "recovery-required"
          ? [
            "SysON rollover reached recovery-required; no automatic rollback or Docker mutation is permitted.",
          ]
          : [],
        reviewFingerprint: await sha256Fingerprint({
          schemaVersion: "capability-runtime-syson-rollover-review-fingerprint/1.0",
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
        schemaVersion: "capability-runtime-syson-rollover-review/1.0",
        transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
        status: "blocked",
        identity: preflight.identity,
        saga: null,
        blockers: preflight.blockers,
        reviewFingerprint: null,
      };
    }
    return {
      schemaVersion: "capability-runtime-syson-rollover-review/1.0",
      transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
      status: "ready",
      identity: preflight.identity,
      saga: null,
      blockers: [],
      reviewFingerprint: await sha256Fingerprint({
        schemaVersion: "capability-runtime-syson-rollover-review-fingerprint/1.0",
        status: "ready",
        // `authorizedAt` is server-selected and becomes durable only when
        // `prepare` records the intent.  A human review binds the exact
        // runtime/ledger basis, not an ephemeral clock tick between review
        // and apply.
        identity: rolloverReviewBasis(preflight.identity),
        lock: preflight.lockFingerprint,
        ledgers: preflight.affected.map((ledger) => ledger.ledgerFingerprint),
        host: preflight.host,
      }),
    };
  }

  async #preflight(): Promise<{
    readonly identity: CapabilityRuntimeRolloverIdentity | null;
    readonly blockers: readonly string[];
    readonly affected: readonly ProjectCapabilityLedger[];
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
      identity: emptySysonRolloverIdentity(this.options, this.#now()),
    });
    const blockers: string[] = [];
    if (pending.length > 0) {
      blockers.push(
        "SysON rollover is blocked by a pending project capability ledger.",
      );
    }
    if (host.classification === "hybrid" || host.classification === "foreign") {
      blockers.push(
        "SysON rollover requires an exact predecessor or successor host topology; a hybrid or foreign topology was observed.",
      );
    } else if (host.classification === "unknown") {
      blockers.push("SysON rollover host topology could not be observed exactly.");
    } else if (host.classification === "successor") {
      blockers.push(
        "SysON successor is already physically present without a durable rollover saga; recovery must not infer an authoritative handoff.",
      );
    }
    const affected: ProjectCapabilityLedger[] = [];
    for (const ledger of ledgers) {
      const envelope = ledger.effectiveEnvelope;
      if (!envelope || envelope.status === "revoked") continue;
      if (envelope.status !== "authorized") {
        blockers.push(
          `Capability ledger ${ledger.projectId} has an unsupported effective status.`,
        );
        continue;
      }
      const units = envelope.proposal.units.filter((unit) =>
        unit.id === "casys.syson-stack"
      );
      if (units.length === 0) continue;
      if (units.length !== 1) {
        blockers.push(
          `Capability ledger ${ledger.projectId} has ambiguous SysON units.`,
        );
        continue;
      }
      if (sameUnit(units[0]!, this.options.predecessor.unit)) {
        if (
          !proposalHasExactUnitMaterials(
            envelope.proposal,
            this.options.predecessor.unit,
          )
        ) {
          blockers.push(
            `Capability ledger ${ledger.projectId} does not retain exact predecessor SysON material identities.`,
          );
          continue;
        }
        affected.push(ledger);
        continue;
      }
      if (sameUnit(units[0]!, this.options.successor.unit)) {
        blockers.push(
          `Capability ledger ${ledger.projectId} is already on the successor without a durable SysON rollover saga.`,
        );
      } else {
        blockers.push(
          `Capability ledger ${ledger.projectId} retains an unknown SysON unit identity.`,
        );
      }
    }
    const locked = lock.units.filter((unit) => unit.id === "casys.syson-stack");
    if (
      locked.length !== 1 || !sameLockedUnit(locked[0]!, this.options.predecessor.unit)
    ) {
      blockers.push(
        "SysON rollover requires one exact predecessor administrative lock unit.",
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
      blockers.push("SysON rollover is blocked by an active runtime lease.");
    }
    const outcomeIds = new Set(outcomes.map((outcome) => outcome.journalEntryId));
    if (
      entries.some((entry) =>
        !outcomeIds.has(entry.id) && this.#isSysONJournalEntry(entry)
      )
    ) {
      blockers.push("SysON rollover is blocked by a pending runtime journal intent.");
    }
    for (const ledger of affected) {
      try {
        if (
          await this.options.jitDemand.hasRemainingDemand({
            projectId: ledger.projectId,
            unitId: this.options.predecessor.unit.id,
          })
        ) {
          blockers.push(
            `SysON rollover is blocked by JIT demand for ${ledger.projectId}.`,
          );
        }
      } catch (error) {
        blockers.push(
          `SysON rollover cannot establish JIT demand for ${ledger.projectId}: ${
            compact(error)
          }`,
        );
      }
    }
    const identity = blockers.length === 0
      ? sysonRolloverIdentityFor(this.options, affected, this.#now())
      : null;
    return {
      identity,
      blockers: blockers.toSorted(),
      affected: affected.toSorted((left, right) =>
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
        if (observation.successor.materials !== "complete") {
          throw new CapabilityRuntimeSysonRolloverError(
            "SysON successor material acquisition did not produce complete exact successor materials; the durable intent remains for recovery.",
          );
        }
        saga = await this.options.sagas.advance(identity, {
          phase: "successor-material-observed",
          evidenceFingerprint: await sha256Fingerprint(observation),
        });
        continue;
      }
      if (saga.phase === "successor-material-observed") {
        const observation = await this.options.host.activateRolloverSuccessor({
          authorization: await authorizeDurableRolloverSuccessorRuntimeStart(
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
          observation.classification !== "successor" ||
          observation.successor.materials !== "complete" ||
          observation.successor.runtime !== "active"
        ) {
          throw new CapabilityRuntimeSysonRolloverError(
            "SysON successor runtime did not reach the exact active topology; the durable intent remains for recovery.",
          );
        }
        saga = await this.options.sagas.advance(identity, {
          phase: "successor-runtime-observed",
          evidenceFingerprint: await sha256Fingerprint(observation),
        });
        continue;
      }
      if (
        saga.phase === "successor-runtime-observed" ||
        saga.phase === "project-amendment-recorded"
      ) {
        const exact = await this.options.host.observeRollover({ identity });
        if (
          exact.classification !== "successor" ||
          exact.successor.materials !== "complete" ||
          exact.successor.runtime !== "active"
        ) {
          await this.#recovery(identity, "foreign", exact);
          return;
        }
        const next = this.#nextAffectedProject(identity, saga);
        if (!next) {
          saga = await this.#advanceSuccessorLock(identity);
          continue;
        }
        const ledger = await this.#ensureSuccessorLedger(identity, next.projectId);
        saga = await this.options.sagas.advance(identity, {
          phase: "project-amendment-recorded",
          projectId: next.projectId,
          evidenceFingerprint: await sha256Fingerprint({
            schemaVersion: "capability-runtime-syson-rollover-ledger-receipt/1.0",
            projectId: ledger.projectId,
            ledgerFingerprint: ledger.ledgerFingerprint,
          }),
        });
        continue;
      }
      if (saga.phase === "successor-lock-recorded") {
        const [lock, host, ledgers] = await Promise.all([
          this.options.lock.read(),
          this.options.host.observeRollover({ identity }),
          this.#verifySuccessorLedgers(identity),
        ]);
        if (
          !isSuccessorLock(lock, this.options.successor.unit) ||
          host.classification !== "successor" ||
          host.successor.materials !== "complete" ||
          host.successor.runtime !== "active"
        ) {
          await this.#recovery(identity, "foreign", host);
          return;
        }
        saga = await this.options.sagas.advance(identity, {
          phase: "completed",
          evidenceFingerprint: await sha256Fingerprint({
            schemaVersion: "capability-runtime-syson-rollover-completion/1.0",
            lockFingerprint: await sha256Fingerprint(lock),
            host,
            ledgers,
          }),
        });
        continue;
      }
      throw new CapabilityRuntimeSysonRolloverError(
        `SysON rollover cannot converge unexpected saga phase ${saga.phase}.`,
      );
    }
  }

  async #advanceSuccessorLock(
    identity: CapabilityRuntimeRolloverIdentity,
  ): Promise<CapabilityRuntimeRolloverSaga> {
    const current = await this.options.lock.read();
    const next = await this.#successorLock(current);
    if (deterministicJson(current) !== deterministicJson(next)) {
      await this.options.lock.save(next);
    }
    const observed = await this.options.lock.read();
    if (deterministicJson(observed) !== deterministicJson(next)) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON successor administrative lock did not converge to its exact append-only revision.",
      );
    }
    return await this.options.sagas.advance(identity, {
      phase: "successor-lock-recorded",
      evidenceFingerprint: await sha256Fingerprint(observed),
    });
  }

  async #ensureSuccessorLedger(
    identity: CapabilityRuntimeRolloverIdentity,
    projectId: string,
  ): Promise<ProjectCapabilityLedger> {
    const target = identity.affectedProjects.find((project) =>
      project.projectId === projectId
    );
    if (!target) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON rollover named an unknown affected project.",
      );
    }
    const current = await this.options.ledgers.get(projectId);
    if (!current) {
      throw new CapabilityRuntimeSysonRolloverError(
        `SysON rollover ledger ${projectId} disappeared.`,
      );
    }
    const predecessor = await predecessorSysonRolloverLedgerFor(
      current,
      target,
      this.options.predecessor.unit,
    );
    const expected = await successorSysonRolloverLedger(
      predecessor,
      identity,
      this.options.predecessor.unit,
      this.options.successor.unit,
    );
    if (deterministicJson(current) === deterministicJson(expected)) return current;
    if (deterministicJson(current) !== deterministicJson(predecessor)) {
      throw new CapabilityRuntimeSysonRolloverError(
        `SysON rollover ledger ${projectId} diverged from its one exact predecessor or successor revision.`,
      );
    }
    const appended = await this.options.ledgers.append(expected, predecessor.revision);
    if (deterministicJson(appended) !== deterministicJson(expected)) {
      throw new CapabilityRuntimeSysonRolloverError(
        `SysON rollover ledger ${projectId} did not append the exact successor revision.`,
      );
    }
    return appended;
  }

  async #successorLock(
    current: CapabilityRuntimeAdminLock,
  ): Promise<CapabilityRuntimeAdminLock> {
    const currentSysON = current.units.filter((unit) =>
      unit.id === "casys.syson-stack"
    );
    if (currentSysON.length !== 1) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON rollover administrative lock is ambiguous.",
      );
    }
    if (sameLockedUnit(currentSysON[0]!, this.options.successor.unit)) return current;
    if (!sameLockedUnit(currentSysON[0]!, this.options.predecessor.unit)) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON rollover administrative lock is neither the exact predecessor nor successor.",
      );
    }
    const previous = await sha256Fingerprint(current);
    return {
      schemaVersion: current.schemaVersion,
      revision: current.revision + 1,
      previous,
      units: current.units.map((unit) =>
        unit.id === "casys.syson-stack"
          ? {
            id: this.options.successor.unit.id,
            version: this.options.successor.unit.version,
            manifestFingerprint: structuredClone(
              this.options.successor.unit.manifestFingerprint,
            ),
            desired: unit.desired,
          }
          : structuredClone(unit)
      ).toSorted((left, right) => left.id.localeCompare(right.id)),
    };
  }

  #nextAffectedProject(
    identity: CapabilityRuntimeRolloverIdentity,
    saga: CapabilityRuntimeRolloverSaga,
  ): CapabilityRuntimeRolloverIdentity["affectedProjects"][number] | undefined {
    if (saga.phase === "successor-runtime-observed") {
      return identity.affectedProjects[0];
    }
    const index = identity.affectedProjects.findIndex((project) =>
      project.projectId === saga.projectId
    );
    return index < 0 ? undefined : identity.affectedProjects[index + 1];
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

  async #verifySuccessorLedgers(
    identity: CapabilityRuntimeRolloverIdentity,
  ): Promise<
    readonly {
      readonly projectId: string;
      readonly ledgerRevision: number;
      readonly proposalFingerprint: ContentFingerprint;
      readonly ledgerFingerprint: ContentFingerprint;
    }[]
  > {
    const receipts = await Promise.all(identity.affectedProjects.map(async (target) => {
      const current = await this.options.ledgers.get(target.projectId);
      if (!current) {
        throw new CapabilityRuntimeSysonRolloverError(
          `SysON rollover ledger ${target.projectId} disappeared before completion.`,
        );
      }
      const predecessor = await predecessorSysonRolloverLedgerFor(
        current,
        target,
        this.options.predecessor.unit,
      );
      const expected = await successorSysonRolloverLedger(
        predecessor,
        identity,
        this.options.predecessor.unit,
        this.options.successor.unit,
      );
      if (deterministicJson(current) !== deterministicJson(expected)) {
        throw new CapabilityRuntimeSysonRolloverError(
          `SysON rollover ledger ${target.projectId} is not its exact successor revision.`,
        );
      }
      const proposal = current.effectiveEnvelope?.proposal;
      if (!proposal) {
        throw new CapabilityRuntimeSysonRolloverError(
          `SysON rollover ledger ${target.projectId} lost its effective successor proposal.`,
        );
      }
      return {
        projectId: current.projectId,
        ledgerRevision: current.revision,
        proposalFingerprint: structuredClone(proposal.capabilityProposalFingerprint),
        ledgerFingerprint: structuredClone(current.ledgerFingerprint),
      };
    }));
    return receipts.toSorted((left, right) =>
      left.projectId.localeCompare(right.projectId)
    );
  }

  #isSysONJournalEntry(entry: CapabilityRuntimeJournalEntry): boolean {
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
    if (value !== SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON rollover transition id is not recognized by this server.",
      );
    }
  }

  #assertExactReview(
    review: CapabilityRuntimeSysonRolloverReview,
    expected: ContentFingerprint,
  ): void {
    if (
      !review.reviewFingerprint ||
      !fingerprintsEqual(review.reviewFingerprint, expected)
    ) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON rollover review no longer matches the exact durable and host state.",
      );
    }
  }
}

/** Gate injected into normal launch-group supervision. It is inert for every
 * group except SysON and releases only after the dedicated saga is complete. */
export class CapabilityRuntimeSysonRolloverGate {
  constructor(private readonly sagas: CapabilityRuntimeRolloverSagaStore) {}

  async assertLaunchGroupAvailable(group: CapabilityRuntimeLaunchGroup): Promise<void> {
    if (group.id !== "casys-syson") return;
    const saga = await this.sagas.read({
      transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    });
    if (saga && saga.phase !== "completed") {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON preload and JIT are blocked by a non-terminal server-owned rollover.",
      );
    }
  }
}

function compact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 256
    ? `${message.slice(0, 253)}...`
    : message || "unknown error";
}
