/**
 * Private local operator actions for capability host authority.
 *
 * This service is intentionally absent from MCP, Workbench and project
 * commands. Reviews carry only local administrative lock/ledger identities;
 * they never accept or reveal provider endpoints, tool names or arguments.
 */

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { CapabilityRuntimeHostMutationLock } from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type {
  CapabilityRuntimeAdminLockWriter,
  ProjectCapabilityAuthorizationService,
} from "./project-capability-authorization-service.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeCatalog,
} from "./read-model/capability-runtime-catalog.ts";

export interface LocalCapabilityRuntimeLockReview {
  readonly kind: "lock-apply" | "rollback-apply";
  readonly currentLockFingerprint: ContentFingerprint;
  readonly nextLock: CapabilityRuntimeAdminLock;
  readonly reviewFingerprint: ContentFingerprint;
}

export type LocalCapabilityRuntimeAdminReview =
  | LocalCapabilityRuntimeLockReview
  | {
    readonly kind: "revoke-apply";
    readonly projectId: string;
    readonly expectedEffectiveEnvelopeFingerprint: ContentFingerprint;
    readonly reason: string;
    readonly ledgerFingerprint: ContentFingerprint;
    readonly reviewFingerprint: ContentFingerprint;
  };

export interface LocalCapabilityRuntimeAdminServiceOptions {
  readonly catalog: CapabilityRuntimeCatalog;
  readonly ledgers: ProjectCapabilityLedgerStore;
  readonly lock: CapabilityRuntimeAdminLockWriter;
  readonly hostMutationLock: CapabilityRuntimeHostMutationLock;
  readonly authorization: ProjectCapabilityAuthorizationService;
}

/** Local-only: callers must present a just-recomputed review fingerprint and `--confirm`. */
export class LocalCapabilityRuntimeAdminService {
  constructor(private readonly options: LocalCapabilityRuntimeAdminServiceOptions) {}

  async status(): Promise<{
    readonly lock: CapabilityRuntimeAdminLock;
    readonly authorizedProjectIds: readonly string[];
  }> {
    const [lock, ledgers] = await Promise.all([
      this.options.lock.read(),
      this.options.ledgers.list(),
    ]);
    return {
      lock,
      authorizedProjectIds: ledgers
        .filter((ledger) => ledger.effectiveEnvelope?.status === "authorized")
        .map((ledger) => ledger.projectId)
        .toSorted(),
    };
  }

  async lockReview(): Promise<LocalCapabilityRuntimeLockReview> {
    const [current, units] = await Promise.all([
      this.options.lock.read(),
      this.#desiredUnion(),
    ]);
    const next = await nextLock(current, units);
    return await lockReview("lock-apply", current, next);
  }

  async lockApply(
    expectedReviewFingerprint: ContentFingerprint,
    confirm: boolean,
  ): Promise<CapabilityRuntimeAdminLock> {
    requireConfirm(confirm);
    return await this.options.hostMutationLock.withLock(async () => {
      const review = await this.lockReview();
      assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
      if (
        deterministicJson(review.currentLockFingerprint) ===
          deterministicJson(await sha256Fingerprint(review.nextLock)) &&
        review.nextLock.revision === (await this.options.lock.read()).revision
      ) return await this.options.lock.read();
      await this.options.lock.save(review.nextLock);
      return await this.options.lock.read();
    });
  }

  async rollbackReview(
    revision: number,
  ): Promise<LocalCapabilityRuntimeLockReview> {
    const [current, source] = await Promise.all([
      this.options.lock.read(),
      this.options.lock.readRevision(revision),
    ]);
    return await lockReview(
      "rollback-apply",
      current,
      await nextLock(current, source.units),
    );
  }

  async rollbackApply(
    revision: number,
    expectedReviewFingerprint: ContentFingerprint,
    confirm: boolean,
  ): Promise<CapabilityRuntimeAdminLock> {
    requireConfirm(confirm);
    return await this.options.hostMutationLock.withLock(async () => {
      const review = await this.rollbackReview(revision);
      assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
      await this.options.lock.save(review.nextLock);
      return await this.options.lock.read();
    });
  }

  async revokeReview(
    projectId: string,
    reason: string,
  ): Promise<
    Extract<LocalCapabilityRuntimeAdminReview, {
      readonly kind: "revoke-apply";
    }>
  > {
    if (!reason.trim()) {
      throw new Error("Local capability revocation requires a reason.");
    }
    const ledger = await this.options.ledgers.get(projectId);
    const envelope = ledger?.effectiveEnvelope;
    if (!ledger || !envelope || envelope.status !== "authorized") {
      throw new Error(
        "Local capability revocation requires one authorized project envelope.",
      );
    }
    const body = {
      kind: "revoke-apply" as const,
      projectId,
      expectedEffectiveEnvelopeFingerprint: envelope.effectiveEnvelopeFingerprint,
      reason: reason.trim(),
      ledgerFingerprint: ledger.ledgerFingerprint,
    };
    return { ...body, reviewFingerprint: await sha256Fingerprint(body) };
  }

  async revokeApply(
    projectId: string,
    reason: string,
    expectedReviewFingerprint: ContentFingerprint,
    confirm: boolean,
  ): Promise<void> {
    requireConfirm(confirm);
    const review = await this.revokeReview(projectId, reason);
    assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
    await this.options.authorization.revoke(
      projectId,
      review.expectedEffectiveEnvelopeFingerprint,
      review.reason,
    );
  }

  async #desiredUnion(): Promise<
    readonly CapabilityRuntimeAdminLock["units"][number][]
  > {
    const active = new Map<string, CapabilityRuntimeAdminLock["units"][number]>();
    for (const ledger of await this.options.ledgers.list()) {
      const envelope = ledger.effectiveEnvelope;
      if (envelope?.status !== "authorized") continue;
      for (const unit of envelope.proposal.units) {
        const catalogued = this.options.catalog.units.find((candidate) =>
          candidate.id === unit.id
        );
        if (
          !catalogued || catalogued.version !== unit.version ||
          !fingerprintsEqual(catalogued.manifestFingerprint, unit.manifestFingerprint)
        ) {
          throw new Error(
            `Authorized capability unit ${unit.id} is not exact in the local catalogue.`,
          );
        }
        active.set(unit.id, {
          id: unit.id,
          version: unit.version,
          manifestFingerprint: structuredClone(unit.manifestFingerprint),
          desired: "active",
        });
      }
    }
    return this.options.catalog.units.map((unit) =>
      active.get(unit.id) ?? ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: structuredClone(unit.manifestFingerprint),
        desired: "inactive" as const,
      })
    ).toSorted((left, right) => left.id.localeCompare(right.id));
  }
}

async function nextLock(
  current: CapabilityRuntimeAdminLock,
  units: readonly CapabilityRuntimeAdminLock["units"][number][],
): Promise<CapabilityRuntimeAdminLock> {
  if (deterministicJson(current.units) === deterministicJson(units)) return current;
  return {
    schemaVersion: current.schemaVersion,
    revision: current.revision + 1,
    previous: await sha256Fingerprint(current),
    units: structuredClone(units),
  };
}

async function lockReview(
  kind: "lock-apply" | "rollback-apply",
  current: CapabilityRuntimeAdminLock,
  next: CapabilityRuntimeAdminLock,
): Promise<LocalCapabilityRuntimeLockReview> {
  const body = {
    kind,
    currentLockFingerprint: await sha256Fingerprint(current),
    nextLock: next,
  };
  return { ...body, reviewFingerprint: await sha256Fingerprint(body) };
}

function requireConfirm(confirm: boolean): void {
  if (!confirm) {
    throw new Error("Local capability administrative mutation requires --confirm.");
  }
}

function assertExactReview(
  actual: ContentFingerprint,
  expected: ContentFingerprint,
): void {
  if (!fingerprintsEqual(actual, expected)) {
    throw new Error(
      "Local capability administrative review is stale or does not match --review-fingerprint.",
    );
  }
}
