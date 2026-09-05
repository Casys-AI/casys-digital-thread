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
import {
  type CapabilityRuntimeAdministrativeRemovalPlan,
  type CapabilityRuntimeJournalEntry,
  capabilityRuntimeMaterialKey,
  createCapabilityRuntimeAdministrativeRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  type CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  type CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  capabilityRuntimeNonpersistentRemovalIntentId,
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
  reconstructCapabilityRuntimeNonpersistentMaterialRemovalPlan,
  sameNonpersistentRemovalIdentity,
  sameNonpersistentRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  authorizeDurableAdministrativeMaterialRemoval,
} from "./capability-runtime-host-authorization.ts";
import {
  authorizeDurableNonpersistentMaterialRemoval,
} from "./capability-runtime-nonpersistent-material-removal-authorization.ts";
import { capabilityRuntimeNonpersistentRemovalBackend } from "./capability-runtime-nonpersistent-removal-backend.ts";
import type { CapabilityRuntimeCachePreparationJournal } from "../ports/out/capability/capability-runtime-cache-preparation.ts";
import type {
  CapabilityRuntimeNonpersistentMaterialRemovalHost,
  CapabilityRuntimeNonpersistentMaterialRemovalJournal,
} from "../ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";
import type {
  CapabilityRuntimeAdministrativeRemovalInspector,
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeLeaseStore,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import {
  type ProjectCapabilityLedger,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "../../domain/capability/project-capability-authorization.ts";
import type {
  CapabilityRuntimeAdminLockWriter,
  ProjectCapabilityAuthorizationService,
} from "./project-capability-authorization-service.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeCatalog,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { validateCapabilityRuntimeAdminLock } from "./validate-capability-runtime-admin-lock.ts";

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

export type LocalCapabilityRuntimeRemovalTarget =
  | { readonly kind: "unit"; readonly id: string }
  | { readonly kind: "launch-group"; readonly id: string }
  | { readonly kind: "material"; readonly unitId: string; readonly materialId: string };

export type LocalCapabilityRuntimeRemovalReview =
  | {
    readonly kind: "remove-apply";
    readonly target: Extract<
      LocalCapabilityRuntimeRemovalTarget,
      { readonly kind: "unit" | "launch-group" }
    >;
    /** The exact inactive successor which must exist before the intent. */
    readonly requiredInactiveLock: CapabilityRuntimeAdminLock;
    readonly plan: CapabilityRuntimeAdministrativeRemovalPlan;
    /** Recovery is allowed only for this exact pending removal plan. */
    /**
     * `complete-pending-absent` is observation-only crash recovery: the
     * exact Compose group is already absent after a durable remove intent,
     * but its host outcome was never journalled.
     */
    readonly recovery:
      | "none"
      | "resume-pending"
      | "complete-pending-absent";
    readonly reviewFingerprint: ContentFingerprint;
  }
  | {
    readonly kind: "remove-nonpersistent-apply";
    readonly target: Extract<
      LocalCapabilityRuntimeRemovalTarget,
      { readonly kind: "material" }
    >;
    readonly requiredInactiveLock: CapabilityRuntimeAdminLock;
    readonly plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan;
    readonly recovery: "none" | "resume-pending" | "complete-pending-absent";
    readonly reviewFingerprint: ContentFingerprint;
  };

export type LocalCapabilityRuntimeRemovalApplyResult =
  | {
    readonly kind: "remove-result";
    readonly status: "removed" | "already-absent";
    readonly plan: CapabilityRuntimeAdministrativeRemovalPlan;
    readonly journalEntryId: string | null;
  }
  | {
    readonly kind: "remove-nonpersistent-result";
    readonly status: "removed" | "already-absent";
    readonly plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan;
    readonly journalEntryId: string | null;
  };

interface LocalCapabilityRuntimeRemovalDependencies {
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly host:
    & CapabilityRuntimeHostMutator
    & CapabilityRuntimeAdministrativeRemovalInspector;
  readonly jitDemand: {
    hasRemainingDemand(input: {
      readonly projectId: string;
      readonly materialKeys: readonly string[];
    }): Promise<boolean>;
  };
  readonly now?: () => string;
}

interface ResolvedNonpersistentRemovalMaterial {
  readonly unit: CapabilityRuntimeCatalog["units"][number];
  readonly backend: ReturnType<typeof capabilityRuntimeNonpersistentRemovalBackend>;
  readonly imageDigest: string;
  readonly removalMaterial:
    CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"];
  readonly materialIdentity: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  };
}

interface LocalCapabilityRuntimeNonpersistentRemovalDependencies {
  readonly journal: CapabilityRuntimeNonpersistentMaterialRemovalJournal;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly host: CapabilityRuntimeNonpersistentMaterialRemovalHost;
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly cachePreparations: CapabilityRuntimeCachePreparationJournal;
  readonly jitDemand: {
    hasRemainingDemand(input: {
      readonly projectId: string;
      readonly materialKeys: readonly string[];
    }): Promise<boolean>;
  };
  readonly now?: () => string;
}

export interface LocalCapabilityRuntimeAdminServiceOptions {
  readonly catalog: CapabilityRuntimeCatalog;
  readonly ledgers: ProjectCapabilityLedgerStore;
  readonly lock: CapabilityRuntimeAdminLockWriter;
  readonly hostMutationLock: CapabilityRuntimeHostMutationLock;
  readonly authorization: ProjectCapabilityAuthorizationService;
  /** Omitted compositions retain the explicit local-admin removal unavailable state. */
  readonly removal?: LocalCapabilityRuntimeRemovalDependencies;
  /** Sibling non-persistent cache-image removal; omitted remains unavailable. */
  readonly nonpersistentRemoval?:
    LocalCapabilityRuntimeNonpersistentRemovalDependencies;
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
      await validateCapabilityRuntimeAdminLock(
        await rollbackSuccessor(current, source.units),
        this.options.catalog,
      ),
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
    if (!ledger) {
      throw new Error(
        "Local capability revocation requires one authorized project envelope.",
      );
    }
    const reviewBasis = await revocationReviewBasis(ledger, reason.trim());
    const body = {
      kind: "revoke-apply" as const,
      projectId,
      expectedEffectiveEnvelopeFingerprint:
        reviewBasis.expectedEffectiveEnvelopeFingerprint,
      reason: reviewBasis.reason,
      ledgerFingerprint: reviewBasis.ledgerFingerprint,
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

  async removeReview(
    target: LocalCapabilityRuntimeRemovalTarget,
  ): Promise<LocalCapabilityRuntimeRemovalReview> {
    return await this.options.hostMutationLock.withLock(async () =>
      target.kind === "material"
        ? await this.#removeNonpersistentReview(target)
        : await this.#removeReview(target)
    );
  }

  async removeApply(
    target: LocalCapabilityRuntimeRemovalTarget,
    expectedReviewFingerprint: ContentFingerprint,
    confirm: boolean,
  ): Promise<LocalCapabilityRuntimeRemovalApplyResult> {
    requireConfirm(confirm);
    if (target.kind === "material") {
      return await this.options.hostMutationLock.withLock(async () =>
        await this.#removeNonpersistentApply(target, expectedReviewFingerprint)
      );
    }
    return await this.options.hostMutationLock.withLock(async () => {
      let review = await this.#removeReview(target);
      assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
      const requiredFingerprint = await sha256Fingerprint(review.requiredInactiveLock);
      const currentFingerprint = await sha256Fingerprint(
        await this.options.lock.read(),
      );
      if (!fingerprintsEqual(requiredFingerprint, currentFingerprint)) {
        // The administrative desired-state successor is durable before a
        // material-remove intent can be visible to recovery.
        await this.options.lock.save(review.requiredInactiveLock);
      }
      review = await this.#removeReview(target);
      assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
      const removal = this.#removal();
      const alreadyAbsent = review.plan.observedMaterials.every((entry) =>
        entry.state === "absent"
      ) && review.plan.ownedContainerIds.length === 0;
      if (review.recovery === "complete-pending-absent") {
        if (!alreadyAbsent) {
          throw new Error(
            "Administrative removal crash recovery requires an exact absent Compose group.",
          );
        }
        const entry = await this.#pendingRemovalIntent(review, removal.journal);
        await removal.journal.appendOutcome({
          schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
          journalEntryId: entry.id,
          recordedAt: removal.now?.() ?? new Date().toISOString(),
          status: "succeeded",
          observations: entry.materials.map((material) => ({
            material,
            state: { material: "absent" as const, runtime: "inactive" as const },
          })),
          detail: null,
        });
        return {
          kind: "remove-result",
          status: "already-absent",
          plan: review.plan,
          journalEntryId: entry.id,
        };
      }
      if (alreadyAbsent && review.recovery === "none") {
        return {
          kind: "remove-result",
          status: "already-absent",
          plan: review.plan,
          journalEntryId: null,
        };
      }
      const entry = review.recovery === "resume-pending"
        ? await this.#pendingRemovalIntent(review, removal.journal)
        : await this.#removalIntent(
          review,
          removal.now?.() ?? new Date().toISOString(),
        );
      if (review.recovery === "none") {
        await removal.journal.appendBeforeMutation(entry);
      }
      if (alreadyAbsent) {
        await removal.journal.appendOutcome({
          schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
          journalEntryId: entry.id,
          recordedAt: removal.now?.() ?? new Date().toISOString(),
          status: "succeeded",
          observations: entry.materials.map((material) => ({
            material,
            state: {
              material: "absent" as const,
              runtime: "inactive" as const,
            },
          })),
          detail: null,
        });
        return {
          kind: "remove-result",
          status: "already-absent",
          plan: review.plan,
          journalEntryId: entry.id,
        };
      }
      let outcome;
      try {
        outcome = await removal.host.mutate({
          authorization: await authorizeDurableAdministrativeMaterialRemoval(
            entry,
            review.plan,
            removal.journal,
          ),
          removalPlan: review.plan,
        });
      } catch (error) {
        outcome = {
          schemaVersion: "capability-runtime-host-mutation-outcome/1.0" as const,
          journalEntryId: entry.id,
          recordedAt: removal.now?.() ?? new Date().toISOString(),
          status: "uncertain" as const,
          observations: entry.materials.map((material) => ({ material, state: null })),
          detail: compact(error),
        };
      }
      if (outcome.journalEntryId !== entry.id) {
        throw new Error("Administrative removal host outcome names another intent.");
      }
      await removal.journal.appendOutcome(outcome);
      if (outcome.status !== "succeeded") {
        throw new Error(
          `Administrative material removal is ${outcome.status}; recovery is required.`,
        );
      }
      return {
        kind: "remove-result",
        status: "removed",
        plan: review.plan,
        journalEntryId: entry.id,
      };
    });
  }

  async #removeReview(
    target: Extract<
      LocalCapabilityRuntimeRemovalTarget,
      { readonly kind: "unit" | "launch-group" }
    >,
  ): Promise<
    Extract<LocalCapabilityRuntimeRemovalReview, {
      readonly kind: "remove-apply";
    }>
  > {
    const removal = this.#removal();
    const group = await this.#resolveRemovalGroup(target, removal.groups);
    await this.#assertNoProjectRetention(group);
    const [current, desired] = await Promise.all([
      this.options.lock.read(),
      this.#desiredUnion(),
    ]);
    const requiredInactiveLock = await nextLock(current, desired);
    if (!hasInactiveExactLock(group, requiredInactiveLock, this.options.catalog)) {
      throw new Error(
        "Administrative material removal requires an exact inactive local lock.",
      );
    }
    const materialKeys = group.materials.map((member) =>
      capabilityRuntimeMaterialKey(member.material)
    );
    const at = removal.now?.() ?? new Date().toISOString();
    if (
      (await removal.leases.listActive(at)).some((lease) =>
        lease.materialKeys.some((key) => materialKeys.includes(key))
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by an active runtime lease.",
      );
    }
    for (const ledger of await this.options.ledgers.list()) {
      // Any unreadable or unresolved fresh JIT decision is deliberately a
      // blocker: cleanup cannot infer a negative demand from partial state.
      if (
        await removal.jitDemand.hasRemainingDemand({
          projectId: ledger.projectId,
          materialKeys,
        })
      ) {
        throw new Error("Administrative material removal is blocked by JIT demand.");
      }
    }
    if (await this.#sharedDigestOutsideGroup(group, removal.groups)) {
      throw new Error(
        "Administrative material removal is blocked by a shared catalogue image digest.",
      );
    }
    const observed = await removal.host.inspectAdministrativeRemoval({
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
    });
    if (observed.safety !== "exact") {
      throw new Error(
        observed.safety === "unknown"
          ? "Administrative material removal host observation is unknown."
          : "Administrative material removal found foreign host material.",
      );
    }
    if (
      !sameCapabilityRuntimeLaunchGroupReference(
        observed.launchGroup,
        capabilityRuntimeLaunchGroupReference(group),
      ) || !sameObservedGroup(group, observed.materials, observed.ownedContainerIds)
    ) {
      throw new Error(
        "Administrative material removal observation does not cover the exact group.",
      );
    }
    const plan = await createCapabilityRuntimeAdministrativeRemovalPlan({
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      ownedMaterials: group.materials.map((member) => ({ ...member.material })),
      observedMaterials: observed.materials,
      ownedContainerIds: observed.ownedContainerIds,
    });
    const recovery = await this.#removalJournalState(group, plan, removal.journal);
    const body = {
      kind: "remove-apply" as const,
      target: { ...target },
      requiredInactiveLock,
      plan,
      recovery,
    };
    return { ...body, reviewFingerprint: await sha256Fingerprint(body) };
  }

  #removal(): LocalCapabilityRuntimeRemovalDependencies {
    if (!this.options.removal) {
      throw new Error(
        "Administrative material removal is unavailable in this local composition.",
      );
    }
    return this.options.removal;
  }

  #nonpersistent(): LocalCapabilityRuntimeNonpersistentRemovalDependencies {
    if (!this.options.nonpersistentRemoval) {
      throw new Error(
        "Administrative non-persistent material removal is unavailable in this local composition.",
      );
    }
    return this.options.nonpersistentRemoval;
  }

  async #removeNonpersistentApply(
    target: Extract<LocalCapabilityRuntimeRemovalTarget, { readonly kind: "material" }>,
    expectedReviewFingerprint: ContentFingerprint,
  ): Promise<
    Extract<LocalCapabilityRuntimeRemovalApplyResult, {
      readonly kind: "remove-nonpersistent-result";
    }>
  > {
    let review = await this.#removeNonpersistentReview(target);
    assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
    const requiredFingerprint = await sha256Fingerprint(review.requiredInactiveLock);
    const currentFingerprint = await sha256Fingerprint(await this.options.lock.read());
    if (!fingerprintsEqual(requiredFingerprint, currentFingerprint)) {
      await this.options.lock.save(review.requiredInactiveLock);
    }
    review = await this.#removeNonpersistentReview(target);
    assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
    const removal = this.#nonpersistent();
    const alreadyAbsent = review.plan.observedState === "absent";
    if (review.recovery === "complete-pending-absent") {
      if (!alreadyAbsent) {
        throw new Error(
          "Non-persistent removal crash recovery requires exact absence.",
        );
      }
      const intent = await this.#pendingNonpersistentIntent(
        review,
        removal.journal,
      );
      await removal.journal.appendOutcome(
        await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
          intentId: intent.id,
          intentFingerprint: intent.fingerprint,
          recordedAt: removal.now?.() ?? new Date().toISOString(),
          status: "succeeded",
          observedState: "absent",
          detail: null,
        }),
      );
      return {
        kind: "remove-nonpersistent-result",
        status: "already-absent",
        plan: review.plan,
        journalEntryId: intent.id,
      };
    }
    if (alreadyAbsent && review.recovery === "none") {
      return {
        kind: "remove-nonpersistent-result",
        status: "already-absent",
        plan: review.plan,
        journalEntryId: null,
      };
    }
    const intent = review.recovery === "resume-pending"
      ? await this.#pendingNonpersistentIntent(review, removal.journal)
      : await this.#nonpersistentIntent(
        review,
        removal.journal,
        removal.now?.() ?? new Date().toISOString(),
      );
    if (review.recovery === "none") {
      await removal.journal.appendIntent(intent);
    }
    if (alreadyAbsent) {
      await removal.journal.appendOutcome(
        await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
          intentId: intent.id,
          intentFingerprint: intent.fingerprint,
          recordedAt: removal.now?.() ?? new Date().toISOString(),
          status: "succeeded",
          observedState: "absent",
          detail: null,
        }),
      );
      return {
        kind: "remove-nonpersistent-result",
        status: "already-absent",
        plan: review.plan,
        journalEntryId: intent.id,
      };
    }
    let outcome;
    try {
      outcome = await removal.host.mutate({
        authorization: await authorizeDurableNonpersistentMaterialRemoval(
          intent,
          review.plan,
          removal.journal,
        ),
        plan: review.plan,
      });
    } catch (error) {
      outcome = await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
        intentId: intent.id,
        intentFingerprint: intent.fingerprint,
        recordedAt: removal.now?.() ?? new Date().toISOString(),
        status: "uncertain",
        observedState: null,
        detail: compact(error),
      });
    }
    if (outcome.intentId !== intent.id) {
      throw new Error(
        "Non-persistent material removal host outcome names another intent.",
      );
    }
    await removal.journal.appendOutcome(outcome);
    if (outcome.status !== "succeeded") {
      throw new Error(
        `Administrative non-persistent material removal is ${outcome.status}; recovery is required.`,
      );
    }
    return {
      kind: "remove-nonpersistent-result",
      status: "removed",
      plan: review.plan,
      journalEntryId: intent.id,
    };
  }

  async #removeNonpersistentReview(
    target: Extract<LocalCapabilityRuntimeRemovalTarget, { readonly kind: "material" }>,
  ): Promise<
    Extract<LocalCapabilityRuntimeRemovalReview, {
      readonly kind: "remove-nonpersistent-apply";
    }>
  > {
    const removal = this.#nonpersistent();
    const resolved = this.#resolveNonpersistentMaterial(target);
    await this.#assertNoProjectRetentionForUnit(resolved.unit.id);
    const [current, desired] = await Promise.all([
      this.options.lock.read(),
      this.#desiredUnion(),
    ]);
    const requiredInactiveLock = await nextLock(current, desired);
    if (!hasInactiveExactLockForUnit(resolved.unit, requiredInactiveLock)) {
      throw new Error(
        "Administrative material removal requires an exact inactive local lock.",
      );
    }
    const materialKey = capabilityRuntimeMaterialKey({
      unitId: resolved.materialIdentity.unitId,
      materialId: resolved.materialIdentity.materialId,
    });
    const at = removal.now?.() ?? new Date().toISOString();
    if (
      (await removal.leases.listActive(at)).some((lease) =>
        lease.materialKeys.includes(materialKey)
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by an active runtime lease.",
      );
    }
    for (const ledger of await this.options.ledgers.list()) {
      let remaining: boolean;
      try {
        remaining = await removal.jitDemand.hasRemainingDemand({
          projectId: ledger.projectId,
          materialKeys: [materialKey],
        });
      } catch {
        throw new Error(
          "Administrative material removal is blocked because JIT demand cannot be read.",
        );
      }
      if (remaining) {
        throw new Error("Administrative material removal is blocked by JIT demand.");
      }
    }
    await this.#assertCachePreparationIdle(resolved, removal.cachePreparations);
    if (
      await this.#sharedDigestOutsideMaterial(
        resolved,
        removal.groups,
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by a shared catalogue image digest.",
      );
    }
    const observed = await removal.host.inspect({
      material: resolved.removalMaterial,
      backend: resolved.backend,
    });
    if (observed.safety !== "exact") {
      throw new Error(
        observed.safety === "unknown"
          ? "Administrative material removal host observation is unknown."
          : "Administrative material removal found foreign host material.",
      );
    }
    if (
      observed.material.unitId !== resolved.removalMaterial.unitId ||
      observed.material.materialId !== resolved.removalMaterial.materialId ||
      observed.material.imageDigest !== resolved.removalMaterial.imageDigest ||
      observed.backend !== resolved.backend
    ) {
      throw new Error(
        "Administrative material removal observation does not cover the exact material.",
      );
    }
    const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
      unit: {
        id: resolved.unit.id,
        version: resolved.unit.version,
        manifestFingerprint: structuredClone(resolved.unit.manifestFingerprint),
      },
      material: resolved.removalMaterial,
      backend: resolved.backend,
      observedState: observed.state,
    });
    const recovery = await this.#nonpersistentJournalState(plan, removal.journal);
    const body = {
      kind: "remove-nonpersistent-apply" as const,
      target: { ...target },
      requiredInactiveLock,
      plan,
      recovery,
    };
    return { ...body, reviewFingerprint: await sha256Fingerprint(body) };
  }

  #resolveNonpersistentMaterial(
    target: Extract<LocalCapabilityRuntimeRemovalTarget, { readonly kind: "material" }>,
  ) {
    if (!target.unitId.trim() || !target.materialId.trim()) {
      throw new TypeError(
        "Administrative non-persistent removal requires unitId and materialId.",
      );
    }
    const unit = this.options.catalog.units.find((candidate) =>
      candidate.id === target.unitId
    );
    if (!unit) {
      throw new Error(
        "Administrative non-persistent removal requires one code-owned unit id.",
      );
    }
    const catalogMaterial = unit.materials.find((candidate) =>
      candidate.id === target.materialId
    );
    if (!catalogMaterial) {
      throw new Error(
        "Administrative non-persistent removal requires one code-owned material id.",
      );
    }
    const backend = capabilityRuntimeNonpersistentRemovalBackend(catalogMaterial);
    const imageDigest = digestFromReference(catalogMaterial.imageReference);
    const removalMaterial = {
      unitId: unit.id,
      materialId: catalogMaterial.id,
      imageReference: catalogMaterial.imageReference,
      imageDigest,
      launchGroup: null,
    };
    return {
      unit,
      catalogMaterial,
      backend,
      imageDigest,
      removalMaterial,
      materialIdentity: {
        unitId: unit.id,
        materialId: catalogMaterial.id,
        imageDigest,
      },
    };
  }

  async #assertNoProjectRetentionForUnit(unitId: string): Promise<void> {
    const unitIds = new Set([unitId]);
    const [ledgers, pendingLedgers] = await Promise.all([
      this.options.ledgers.list(),
      this.options.ledgers.listPending(),
    ]);
    for (const pending of pendingLedgers) {
      if (retainsAnyUnit(pending, unitIds)) {
        throw new Error(
          "Administrative material removal is blocked by a pending project capability ledger.",
        );
      }
    }
    for (const ledger of ledgers) {
      if (
        ledger.effectiveEnvelope?.status === "authorized" &&
        retainsAnyUnit(ledger, unitIds)
      ) {
        throw new Error(
          "Administrative material removal is retained by an authorized project ledger.",
        );
      }
    }
  }

  async #assertCachePreparationIdle(
    resolved: ResolvedNonpersistentRemovalMaterial,
    journal: CapabilityRuntimeCachePreparationJournal,
  ): Promise<void> {
    let preparations;
    try {
      preparations = await journal.list();
    } catch {
      throw new Error(
        "Administrative material removal is blocked because cache preparation cannot be read.",
      );
    }
    const key = capabilityRuntimeMaterialKey(resolved.materialIdentity);
    for (const preparation of preparations) {
      const covers = preparation.intent.scope.materials.some((entry) =>
        capabilityRuntimeMaterialKey(entry.material) === key
      );
      if (!covers) continue;
      if (preparation.terminal === null) {
        throw new Error(
          "Administrative material removal is blocked by pending cache preparation.",
        );
      }
    }
  }

  async #sharedDigestOutsideMaterial(
    resolved: ResolvedNonpersistentRemovalMaterial,
    groups: CapabilityRuntimeLaunchGroupRegistry,
  ): Promise<boolean> {
    const selected = materialIdentityKey(resolved.materialIdentity);
    const digest = resolved.imageDigest;
    if (
      this.options.catalog.units.some((unit) =>
        unit.materials.some((material) =>
          digestFromReference(material.imageReference) === digest &&
          materialIdentityKey({ unitId: unit.id, materialId: material.id }) !==
            selected
        )
      )
    ) return true;
    return (await groups.list()).some((candidate) =>
      candidate.materials.some((member) =>
        member.material.imageDigest === digest &&
        materialIdentityKey(member.material) !== selected
      )
    );
  }

  async #nonpersistentJournalState(
    plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan,
    journal: CapabilityRuntimeNonpersistentMaterialRemovalJournal,
  ): Promise<"none" | "resume-pending" | "complete-pending-absent"> {
    const intents = await journal.listIntents();
    const outcomes = await journal.listOutcomes();
    const relevant = intents.filter((intent) =>
      intent.material.unitId === plan.material.unitId &&
      intent.material.materialId === plan.material.materialId
    );
    if (
      outcomes.some((outcome) =>
        relevant.some((intent) => intent.id === outcome.intentId) &&
        outcome.status === "uncertain"
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by an uncertain non-persistent journal outcome.",
      );
    }
    if (
      outcomes.some((outcome) =>
        relevant.some((intent) => intent.id === outcome.intentId) &&
        outcome.status === "failed"
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by a failed non-persistent journal outcome.",
      );
    }
    const pending = relevant.filter((intent) =>
      !outcomes.some((outcome) => outcome.intentId === intent.id)
    );
    if (pending.length === 0) return "none";
    if (pending.length !== 1) {
      throw new Error(
        "Administrative material removal is blocked by a pending non-persistent journal mutation.",
      );
    }
    let original;
    try {
      original = await reconstructCapabilityRuntimeNonpersistentMaterialRemovalPlan(
        pending[0]!,
      );
    } catch {
      throw new Error(
        "Administrative material removal is blocked by a pending non-persistent journal mutation.",
      );
    }
    if (!sameNonpersistentRemovalIdentity(original, plan)) {
      throw new Error(
        "Administrative material removal is blocked by a pending non-persistent journal mutation.",
      );
    }
    if (sameNonpersistentRemovalPlan(original, plan)) return "resume-pending";
    if (plan.observedState === "absent" && original.observedState === "owned") {
      return "complete-pending-absent";
    }
    throw new Error(
      "Administrative material removal is blocked by a pending non-persistent journal mutation.",
    );
  }

  async #nonpersistentIntent(
    review: Extract<LocalCapabilityRuntimeRemovalReview, {
      readonly kind: "remove-nonpersistent-apply";
    }>,
    journal: CapabilityRuntimeNonpersistentMaterialRemovalJournal,
    plannedAt: string,
  ): Promise<CapabilityRuntimeNonpersistentMaterialRemovalIntent> {
    const generation = nextNonpersistentRemovalGeneration(
      await journal.listIntents(),
      review.plan.material,
    );
    return await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
      id: capabilityRuntimeNonpersistentRemovalIntentId({
        planFingerprint: review.plan.fingerprint,
        generation,
      }),
      unit: review.plan.unit,
      material: review.plan.material,
      backend: review.plan.backend,
      generation,
      planFingerprint: review.plan.fingerprint,
      previousObservation: review.plan.observedState,
      plannedAt,
    });
  }

  async #pendingNonpersistentIntent(
    review: Extract<LocalCapabilityRuntimeRemovalReview, {
      readonly kind: "remove-nonpersistent-apply";
    }>,
    journal: CapabilityRuntimeNonpersistentMaterialRemovalJournal,
  ): Promise<CapabilityRuntimeNonpersistentMaterialRemovalIntent> {
    const outcomes = await journal.listOutcomes();
    const matches = (await journal.listIntents()).filter((intent) =>
      intent.action === "material-remove" &&
      intent.material.unitId === review.plan.material.unitId &&
      intent.material.materialId === review.plan.material.materialId &&
      !outcomes.some((outcome) => outcome.intentId === intent.id)
    );
    if (matches.length !== 1) {
      throw new Error(
        "Non-persistent removal recovery requires one exact pending intent.",
      );
    }
    const original = await reconstructCapabilityRuntimeNonpersistentMaterialRemovalPlan(
      matches[0]!,
    );
    if (!sameNonpersistentRemovalIdentity(original, review.plan)) {
      throw new Error(
        "Non-persistent removal recovery requires one exact pending intent.",
      );
    }
    if (review.recovery === "resume-pending") {
      if (!sameNonpersistentRemovalPlan(original, review.plan)) {
        throw new Error(
          "Non-persistent removal recovery requires one exact pending intent.",
        );
      }
    } else if (review.recovery === "complete-pending-absent") {
      if (
        original.observedState !== "owned" ||
        review.plan.observedState !== "absent"
      ) {
        throw new Error(
          "Non-persistent removal recovery requires one exact pending intent.",
        );
      }
    } else {
      throw new Error(
        "Non-persistent removal recovery requires one exact pending intent.",
      );
    }
    return matches[0]!;
  }

  async #resolveRemovalGroup(
    target: Extract<
      LocalCapabilityRuntimeRemovalTarget,
      { readonly kind: "unit" | "launch-group" }
    >,
    groups: CapabilityRuntimeLaunchGroupRegistry,
  ): Promise<CapabilityRuntimeLaunchGroup> {
    if (!target.id.trim()) {
      throw new TypeError("Administrative removal target id is required.");
    }
    const available = await groups.list();
    if (target.kind === "launch-group") {
      const matches = available.filter((group) => group.id === target.id);
      if (matches.length !== 1) {
        throw new Error(
          "Administrative removal requires one code-owned launch group id.",
        );
      }
      return matches[0]!;
    }
    const unit = this.options.catalog.units.find((candidate) =>
      candidate.id === target.id
    );
    if (!unit) {
      throw new Error("Administrative removal requires one code-owned unit id.");
    }
    const references = unit.materials.map((material) => material.launchGroup);
    if (references.some((reference) => reference === null)) {
      throw new Error(
        "Administrative removal is unavailable for cache or microVM material without a launch group.",
      );
    }
    const unique = references.filter((reference, index, values) =>
      values.findIndex((candidate) =>
        candidate !== null && reference !== null &&
        sameCapabilityRuntimeLaunchGroupReference(candidate, reference)
      ) === index
    ) as NonNullable<typeof references[number]>[];
    if (unique.length !== 1) {
      throw new Error(
        "Administrative removal unit does not resolve to one whole launch group.",
      );
    }
    const group = await groups.require(unique[0]!);
    if (
      group.materials.length !== unit.materials.length ||
      group.materials.some((member, index) =>
        member.material.unitId !== unit.id ||
        member.material.materialId !== unit.materials[index]!.id ||
        member.material.imageDigest !==
          digestFromReference(unit.materials[index]!.imageReference)
      )
    ) {
      throw new Error(
        "Administrative removal unit does not own the complete exact launch group.",
      );
    }
    return group;
  }

  async #assertNoProjectRetention(group: CapabilityRuntimeLaunchGroup): Promise<void> {
    const unitIds = new Set(group.materials.map((member) => member.material.unitId));
    const [ledgers, pendingLedgers] = await Promise.all([
      this.options.ledgers.list(),
      this.options.ledgers.listPending(),
    ]);
    for (const pending of pendingLedgers) {
      if (retainsAnyUnit(pending, unitIds)) {
        throw new Error(
          "Administrative material removal is blocked by a pending project capability ledger.",
        );
      }
    }
    for (const ledger of ledgers) {
      if (
        ledger.effectiveEnvelope?.status === "authorized" &&
        retainsAnyUnit(ledger, unitIds)
      ) {
        throw new Error(
          "Administrative material removal is retained by an authorized project ledger.",
        );
      }
    }
  }

  async #sharedDigestOutsideGroup(
    group: CapabilityRuntimeLaunchGroup,
    groups: CapabilityRuntimeLaunchGroupRegistry,
  ): Promise<boolean> {
    const selected = new Set(
      group.materials.map((member) => materialIdentityKey(member.material)),
    );
    const digests = new Set(
      group.materials.map((member) => member.material.imageDigest),
    );
    if (
      this.options.catalog.units.some((unit) =>
        unit.materials.some((material) =>
          digests.has(digestFromReference(material.imageReference)) &&
          !selected.has(materialIdentityKey({
            unitId: unit.id,
            materialId: material.id,
          }))
        )
      )
    ) return true;
    return (await groups.list()).some((candidate) =>
      candidate.materials.some((member) =>
        digests.has(member.material.imageDigest) &&
        !selected.has(materialIdentityKey(member.material))
      )
    );
  }

  async #removalJournalState(
    group: CapabilityRuntimeLaunchGroup,
    plan: CapabilityRuntimeAdministrativeRemovalPlan,
    journal: CapabilityRuntimeJournal,
  ): Promise<"none" | "resume-pending" | "complete-pending-absent"> {
    const reference = capabilityRuntimeLaunchGroupReference(group);
    const entries = (await journal.list()).filter((entry) =>
      sameCapabilityRuntimeLaunchGroupReference(entry.launchGroup, reference)
    );
    if (entries.some((entry) => !sameJournalGroup(entry, group))) {
      throw new Error(
        "Administrative material removal is blocked by a non-exact group journal intent.",
      );
    }
    const outcomes = await journal.listOutcomes();
    const pending = entries.filter((entry) =>
      !outcomes.some((outcome) => outcome.journalEntryId === entry.id)
    );
    if (
      outcomes.some((outcome) =>
        entries.some((entry) => entry.id === outcome.journalEntryId) &&
        outcome.status === "uncertain"
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by an uncertain group journal outcome.",
      );
    }
    if (
      outcomes.some((outcome) =>
        entries.some((entry) =>
          entry.id === outcome.journalEntryId && entry.action === "material-remove"
        ) && outcome.status === "failed"
      )
    ) {
      throw new Error(
        "Administrative material removal is blocked by a failed group journal outcome.",
      );
    }
    if (pending.length === 0) return "none";
    if (
      pending.length === 1 && pending[0]!.action === "material-remove" &&
      pending[0]!.projectId === null &&
      pending[0]!.administrativeRemovalPlanFingerprint !== null
    ) {
      const exactPending = pending[0]!;
      const pendingFingerprint = exactPending.administrativeRemovalPlanFingerprint;
      if (pendingFingerprint === null) {
        throw new Error(
          "Administrative material removal is blocked by a pending group journal mutation.",
        );
      }
      if (
        pendingFingerprint.algorithm ===
          plan.fingerprint.algorithm &&
        pendingFingerprint.digest ===
          plan.fingerprint.digest
      ) return "resume-pending";
      // A Compose removal can finish after its durable intent but before its
      // outcome write. The fresh exact host observation is sufficient to
      // converge that *same* group intent without replaying Docker.
      if (
        plan.observedMaterials.every((entry) => entry.state === "absent") &&
        plan.ownedContainerIds.length === 0
      ) return "complete-pending-absent";
    }
    throw new Error(
      "Administrative material removal is blocked by a pending group journal mutation.",
    );
  }

  #removalIntent(
    review: Extract<LocalCapabilityRuntimeRemovalReview, {
      readonly kind: "remove-apply";
    }>,
    plannedAt: string,
  ): CapabilityRuntimeJournalEntry {
    const activeMaterials = new Set(
      review.plan.ownedContainerIds.map((entry) =>
        capabilityRuntimeMaterialKey(entry.material)
      ),
    );
    return {
      id: `capability-admin-remove-${review.plan.fingerprint.digest}`,
      action: "material-remove",
      materials: review.plan.ownedMaterials.map((material) => ({ ...material })),
      launchGroup: review.plan.launchGroup,
      projectId: null,
      plannedAt,
      previousObservations: review.plan.observedMaterials.map((observation) => ({
        material: { ...observation.material },
        state: observation.state === "owned"
          ? {
            material: "installed" as const,
            runtime: activeMaterials.has(
                capabilityRuntimeMaterialKey(observation.material),
              )
              ? "active" as const
              : "inactive" as const,
          }
          : {
            material: "absent" as const,
            runtime: "inactive" as const,
          },
      })),
      effectiveRuntimeProjection: null,
      qualificationStartAuthority: null,
      administrativeRemovalPlanFingerprint: review.plan.fingerprint,
    };
  }

  async #pendingRemovalIntent(
    review: Extract<LocalCapabilityRuntimeRemovalReview, {
      readonly kind: "remove-apply";
    }>,
    journal: CapabilityRuntimeJournal,
  ): Promise<CapabilityRuntimeJournalEntry> {
    const matches = (await journal.list()).filter((entry) =>
      entry.action === "material-remove" && entry.projectId === null &&
      sameCapabilityRuntimeLaunchGroupReference(
        entry.launchGroup,
        review.plan.launchGroup,
      )
    );
    if (matches.length !== 1) {
      throw new Error(
        "Administrative removal recovery requires one exact pending intent.",
      );
    }
    const pending = matches[0]!;
    if (review.recovery === "resume-pending") {
      if (
        pending.administrativeRemovalPlanFingerprint?.algorithm !==
          review.plan.fingerprint.algorithm ||
        pending.administrativeRemovalPlanFingerprint?.digest !==
          review.plan.fingerprint.digest
      ) {
        throw new Error(
          "Administrative removal recovery requires one exact pending intent.",
        );
      }
    } else if (review.recovery === "complete-pending-absent") {
      if (
        pending.administrativeRemovalPlanFingerprint === null ||
        !review.plan.observedMaterials.every((entry) => entry.state === "absent") ||
        review.plan.ownedContainerIds.length !== 0
      ) {
        throw new Error(
          "Administrative removal recovery requires one exact pending intent.",
        );
      }
    } else {
      throw new Error(
        "Administrative removal recovery requires one exact pending intent.",
      );
    }
    return pending;
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

/** A rollback is an auditable successor even when its desired body is identical. */
async function rollbackSuccessor(
  current: CapabilityRuntimeAdminLock,
  units: readonly CapabilityRuntimeAdminLock["units"][number][],
): Promise<CapabilityRuntimeAdminLock> {
  return {
    schemaVersion: current.schemaVersion,
    revision: current.revision + 1,
    previous: await sha256Fingerprint(current),
    units: structuredClone(units),
  };
}

async function revocationReviewBasis(
  ledger: ProjectCapabilityLedger,
  reason: string,
): Promise<{
  readonly expectedEffectiveEnvelopeFingerprint: ContentFingerprint;
  readonly reason: string;
  readonly ledgerFingerprint: ContentFingerprint;
}> {
  const envelope = ledger.effectiveEnvelope;
  if (envelope?.status === "authorized") {
    return {
      expectedEffectiveEnvelopeFingerprint: envelope.effectiveEnvelopeFingerprint,
      reason,
      ledgerFingerprint: ledger.ledgerFingerprint,
    };
  }
  const event = ledger.events.at(-1);
  const predecessor = event?.kind === "revocation-recorded"
    ? await reconstructProjectCapabilityEffectiveEnvelope(ledger.events.slice(0, -1))
    : null;
  if (
    event?.kind !== "revocation-recorded" || event.reason !== reason ||
    predecessor?.status !== "authorized" || !ledger.previous
  ) {
    throw new Error(
      "Local capability revocation requires one authorized project envelope.",
    );
  }
  // Recreate the exact original review after a crash between ledger append and
  // host-lock convergence. A different reason or predecessor is fail-closed.
  return {
    expectedEffectiveEnvelopeFingerprint: predecessor.effectiveEnvelopeFingerprint,
    reason,
    ledgerFingerprint: ledger.previous,
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

function hasInactiveExactLockForUnit(
  unit: {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  },
  lock: CapabilityRuntimeAdminLock,
): boolean {
  const locked = lock.units.find((candidate) => candidate.id === unit.id);
  return !!locked && locked.desired === "inactive" &&
    locked.version === unit.version &&
    fingerprintsEqual(locked.manifestFingerprint, unit.manifestFingerprint);
}

function hasInactiveExactLock(
  group: CapabilityRuntimeLaunchGroup,
  lock: CapabilityRuntimeAdminLock,
  catalog: CapabilityRuntimeCatalog,
): boolean {
  return group.materials.every((member) => {
    const catalogued = catalog.units.find((unit) => unit.id === member.material.unitId);
    const locked = lock.units.find((unit) => unit.id === member.material.unitId);
    return !!catalogued && !!locked && locked.desired === "inactive" &&
      locked.version === catalogued.version &&
      fingerprintsEqual(locked.manifestFingerprint, catalogued.manifestFingerprint) &&
      catalogued.materials.some((material) =>
        material.id === member.material.materialId &&
        digestFromReference(material.imageReference) === member.material.imageDigest &&
        material.launchGroup !== null &&
        sameCapabilityRuntimeLaunchGroupReference(
          material.launchGroup,
          capabilityRuntimeLaunchGroupReference(group),
        )
      );
  });
}

function sameObservedGroup(
  group: CapabilityRuntimeLaunchGroup,
  materials: readonly {
    readonly material: {
      readonly unitId: string;
      readonly materialId: string;
      readonly imageDigest: string;
    };
  }[],
  containers: readonly {
    readonly material: {
      readonly unitId: string;
      readonly materialId: string;
      readonly imageDigest: string;
    };
  }[],
): boolean {
  const exactMaterial = (left: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  }, right: typeof left) =>
    left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
  return materials.length === group.materials.length &&
    materials.every((material, index) =>
      exactMaterial(material.material, group.materials[index]!.material)
    ) &&
    containers.every((container) =>
      group.materials.some((member) =>
        exactMaterial(container.material, member.material)
      )
    );
}

function digestFromReference(reference: string): string {
  const digest = reference.slice(reference.lastIndexOf("@sha256:") + "@sha256:".length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(
      "Capability runtime catalogue material lacks one exact image digest.",
    );
  }
  return digest;
}

function materialIdentityKey(value: {
  readonly unitId: string;
  readonly materialId: string;
}): string {
  return `${value.unitId}\u0000${value.materialId}`;
}

function nextNonpersistentRemovalGeneration(
  intents: readonly CapabilityRuntimeNonpersistentMaterialRemovalIntent[],
  material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"],
): number {
  let max = 0;
  for (const intent of intents) {
    if (
      intent.material.unitId === material.unitId &&
      intent.material.materialId === material.materialId &&
      intent.generation > max
    ) {
      max = intent.generation;
    }
  }
  return max + 1;
}

function retainsAnyUnit(
  ledger: ProjectCapabilityLedger,
  unitIds: ReadonlySet<string>,
): boolean {
  return ledger.effectiveEnvelope?.proposal.units.some((unit) =>
    unitIds.has(unit.id)
  ) ??
    ledger.events.some((event) =>
      event.kind === "initial-prepared" &&
      event.proposal.units.some((unit) => unitIds.has(unit.id))
    );
}

function sameJournalGroup(
  entry: CapabilityRuntimeJournalEntry,
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  return entry.materials.length === group.materials.length &&
    entry.materials.every((material, index) => {
      const member = group.materials[index]!.material;
      return material.unitId === member.unitId &&
        material.materialId === member.materialId &&
        material.imageDigest === member.imageDigest;
    });
}

function compact(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.length > 512 ? `${detail.slice(0, 509)}...` : detail || "unknown error";
}
