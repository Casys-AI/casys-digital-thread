import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import { capabilityRuntimeCatalogMaterialsForRequirements } from "./capability-runtime-catalog-materials.ts";
import { compileProjectCapabilityIntent } from "./compile-project-capability-intent.ts";
import {
  engineeringCapabilityRequirementKey,
  flattenEngineeringCapabilityRequirements,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import { compileProjectCapabilityDemand } from "./compile-project-capability-demand.ts";
import {
  planProjectCapabilityIntent,
  planProjectCapabilityRequirementsProposal,
  projectCapabilityEnvelopeDelta,
  projectCapabilityProposalCovers,
} from "./plan-project-capability-intent.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  isStrictUnusedWithdrawalDelta,
  PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
  type ProjectCapabilityApprovalReceipt,
  type ProjectCapabilityAuthorizationEvent,
  projectCapabilityBindingReplacementChangesMethod,
  projectCapabilityChangeRequiresMethodTransition,
  type ProjectCapabilityEffectiveEnvelope,
  type ProjectCapabilityEnvelopeDelta,
  type ProjectCapabilityLedger,
  type ProjectCapabilityProposal,
  projectCapabilityProposalsHaveEquivalentCeilings,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "../../domain/capability/project-capability-authorization.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type { CapabilityRuntimeHostMutationLock } from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { EngineeringOperationRegistry } from "../../orchestration/operations/operation-contract.ts";
import type { ResolvedRunPlanReader } from "../../domain/project/resolved-run-plan-sealer.ts";
import { evaluateProjectCapabilityBindingEvidence } from "./project-capability-binding-evidence.ts";
import type { BriefCapabilityIntentRouteTable } from "../../orchestration/operations/brief-capability-intent-routes.ts";
import type { CapabilityRuntimePreloadScheduler } from "./capability-runtime-preload-scheduler.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import {
  evaluateCapabilityRuntimeQualifications,
  loadProvenCapabilityRuntimeQualificationAttestations,
} from "./evaluate-capability-runtime-qualifications.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type { CapabilityRuntimeQualificationCandidate } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import type {
  CapabilityRuntimeAdminLockReader,
  CapabilityRuntimeAdminPolicyReader,
  CapabilityRuntimeHostObservationReader,
} from "./project-capability-runtime-context-compiler.ts";

export class ProjectCapabilityAuthorizationError extends Error {}

export interface ProjectCapabilityAuthorizationServiceDependencies {
  readonly ledgers: ProjectCapabilityLedgerStore;
  readonly registry: Pick<EngineeringOperationRegistry, "list">;
  readonly routes?: BriefCapabilityIntentRouteTable;
  readonly catalog: CapabilityRuntimeCatalog;
  /** Server-composed CAS reader; callers never select a plan or provider. */
  readonly recordedPlans: ResolvedRunPlanReader;
  readonly qualificationSpecs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly qualificationCandidates: readonly CapabilityRuntimeQualificationCandidate[];
  /** Durable local administrator policy or a fixed test fixture. */
  readonly policy:
    | CapabilityRuntimeAdminPolicy
    | CapabilityRuntimeAdminPolicyReader;
  /** Static fixture or fresh, read-only host observation at review time. */
  readonly host:
    | CapabilityRuntimeHostObservation
    | CapabilityRuntimeHostObservationReader;
  /** Durable local desired-state lock or a fixed test fixture. */
  readonly lock: CapabilityRuntimeAdminLock | CapabilityRuntimeAdminLockReader;
  /**
   * Present only in the local control-plane composition. It advances the
   * host desired-state history under the exact same mutex used by runtime
   * acquisition. Fixed fixtures remain read-only in focused unit tests.
   */
  readonly lockWriter?: CapabilityRuntimeAdminLockWriter;
  readonly hostMutationLock?: CapabilityRuntimeHostMutationLock;
  /** Same exact local overlay consulted by MCP and Workbench runtime contexts. */
  readonly qualifications?: Pick<
    CapabilityRuntimeQualificationAttestationStore,
    "list"
  >;
  readonly qualificationAttempts?: Pick<
    CapabilityRuntimeQualificationAttemptStore,
    "read"
  >;
  /** Non-blocking host-material preload after durable authorization only. */
  readonly preloadScheduler?: Pick<CapabilityRuntimePreloadScheduler, "schedule">;
  readonly now?: () => string;
}

export interface CapabilityRuntimeAdminLockWriter
  extends CapabilityRuntimeAdminLockReader {
  save(value: CapabilityRuntimeAdminLock): Promise<void>;
  readRevision(revision: number): Promise<CapabilityRuntimeAdminLock>;
  list(): Promise<readonly CapabilityRuntimeAdminLock[]>;
}

export type ProjectCapabilityChangeReview =
  | {
    readonly status: "not-authorized";
    readonly ledger: null;
    readonly proposal: ProjectCapabilityProposal | null;
  }
  | {
    readonly status: "covered";
    readonly ledger: ProjectCapabilityLedger;
    readonly proposal: ProjectCapabilityProposal;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope;
  }
  | {
    readonly status: "no-change";
    readonly ledger: ProjectCapabilityLedger;
    readonly proposal: ProjectCapabilityProposal;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope;
  }
  | {
    readonly status: "revoked";
    readonly ledger: ProjectCapabilityLedger;
    readonly proposal: ProjectCapabilityProposal;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope;
  }
  | {
    readonly status: "amendment-required";
    readonly ledger: ProjectCapabilityLedger;
    readonly proposal: ProjectCapabilityProposal;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope;
    readonly delta: ProjectCapabilityEnvelopeDelta;
  }
  | {
    readonly status: "withdrawal-required";
    readonly ledger: ProjectCapabilityLedger;
    readonly proposal: ProjectCapabilityProposal;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope;
    readonly delta: ProjectCapabilityEnvelopeDelta;
  }
  | {
    readonly status: "method-transition-required" | "unresolved";
    readonly ledger: ProjectCapabilityLedger;
    readonly proposal: ProjectCapabilityProposal;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope;
    readonly delta: ProjectCapabilityEnvelopeDelta;
  };

/**
 * Owns only the host-operational authorization ledger. It neither mutates an
 * engineering project nor grants an MRTR/result verdict. The caller already
 * controls the human brief/elicitation authority.
 */
export class ProjectCapabilityAuthorizationService {
  readonly #now: () => string;

  constructor(
    private readonly dependencies: ProjectCapabilityAuthorizationServiceDependencies,
  ) {
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async proposeForPendingBrief(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityProposal> {
    const brief = project.framing?.proposedBrief;
    const review = project.framing?.proposalReview;
    if (!brief || !review || review.status !== "pending") {
      throw new ProjectCapabilityAuthorizationError(
        "Capability proposal requires one exact pending project brief review.",
      );
    }
    return await this.proposeForBrief(
      project,
      brief,
      review.inputFingerprint,
    );
  }

  /**
   * Replay-only recomposition from the server-persisted approved brief. This
   * lets an editorially equivalent B2 re-cross its own receipt without adding
   * a misleading duplicate initial-prepared ledger revision.
   */
  async proposeForApprovedBrief(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityProposal> {
    const brief = project.framing?.currentBrief;
    const approval = project.framing?.currentBriefApproval;
    if (!brief || !approval || approval.status !== "approved") {
      throw new ProjectCapabilityAuthorizationError(
        "Capability proposal requires one exact approved project brief for replay.",
      );
    }
    return await this.proposeForBrief(
      project,
      brief,
      approval.inputFingerprint,
    );
  }

  /** Creates the append-only prepared record before the independent brief approval. */
  async prepareInitial(
    proposal: ProjectCapabilityProposal,
  ): Promise<ProjectCapabilityLedger> {
    if (proposal.source !== "brief-intent" || proposal.intent === null) {
      throw new ProjectCapabilityAuthorizationError(
        "Initial capability authorization requires a pending brief proposal.",
      );
    }
    const current = await this.dependencies.ledgers.get(proposal.projectId);
    const pending = await this.dependencies.ledgers.getPending(proposal.projectId);
    if (pending) {
      if (!isExactPreparedAppend(current, pending, proposal)) {
        throw new ProjectCapabilityAuthorizationError(
          "A different unclaimed capability ledger revision is pending; it must not be replaced by this brief confirmation.",
        );
      }
      return await this.dependencies.ledgers.append(
        pending,
        current?.revision ?? 0,
      );
    }
    if (current) {
      const prepared = current.events.find((event) =>
        event.kind === "initial-prepared" &&
        fingerprintsEqual(
          event.proposal.capabilityProposalFingerprint,
          proposal.capabilityProposalFingerprint,
        )
      );
      if (prepared) return current;
      if (current.effectiveEnvelope) {
        if (
          current.effectiveEnvelope.status === "authorized" &&
          await projectCapabilityProposalsHaveEquivalentCeilings(
            current.effectiveEnvelope.proposal,
            proposal,
          )
        ) {
          return current;
        }
        throw new ProjectCapabilityAuthorizationError(
          "Project already has an operational capability ledger with a different or revoked ceiling; use a delta amendment instead of replacing its initial authority.",
        );
      }
      if (current.events.some((event) => event.kind === "initial-prepared")) {
        throw new ProjectCapabilityAuthorizationError(
          "A different prepared capability proposal already exists and must be finalized or recovered before another initial proposal can be prepared.",
        );
      }
      const event = await eventWithFingerprint({
        kind: "initial-prepared" as const,
        recordedAt: this.#now(),
        proposal: structuredClone(proposal),
      });
      return await this.append(proposal.projectId, current.revision, [
        ...current.events,
        event,
      ]);
    }
    const recordedAt = this.#now();
    const event = await eventWithFingerprint({
      kind: "initial-prepared" as const,
      recordedAt,
      proposal: structuredClone(proposal),
    });
    return await this.append(proposal.projectId, 0, [event]);
  }

  async preparedProposal(
    projectId: string,
    fingerprint: ProjectCapabilityProposal["capabilityProposalFingerprint"],
  ): Promise<ProjectCapabilityProposal | undefined> {
    const ledger = await this.dependencies.ledgers.get(projectId);
    const pending = await this.dependencies.ledgers.getPending(projectId);
    const prepared = [ledger, pending].flatMap((candidate) => candidate?.events ?? [])
      .find((event) =>
        event.kind === "initial-prepared" &&
        fingerprintsEqual(event.proposal.capabilityProposalFingerprint, fingerprint)
      );
    return prepared?.kind === "initial-prepared"
      ? structuredClone(prepared.proposal)
      : undefined;
  }

  /**
   * Idempotent post-brief finalization. A crash after the project approval can
   * retry this method: only the exact pre-existing prepared proposal plus the
   * canonical approved-brief receipt becomes an effective envelope.
   */
  async finalizeInitial(
    approvedProject: EngineeringProjectSnapshot,
    proposal: ProjectCapabilityProposal,
  ): Promise<ProjectCapabilityLedger> {
    const receipt = approvalReceipt(approvedProject, proposal);
    let current = await this.dependencies.ledgers.get(proposal.projectId);
    const pending = await this.dependencies.ledgers.getPending(proposal.projectId);
    if (pending) {
      if (!isExactPreparedAppend(current, pending, proposal)) {
        throw new ProjectCapabilityAuthorizationError(
          "A different unclaimed capability ledger revision is pending; finalization fails closed.",
        );
      }
      current = await this.dependencies.ledgers.append(
        pending,
        current?.revision ?? 0,
      );
    }
    if (!current) {
      throw new ProjectCapabilityAuthorizationError(
        "Capability ledger was not prepared before brief approval; prepared authority alone is required before finalization.",
      );
    }
    const alreadyAuthorized = current.events.find((event) =>
      event.kind === "initial-authorized" &&
      fingerprintsEqual(
        event.proposalFingerprint,
        proposal.capabilityProposalFingerprint,
      )
    );
    if (alreadyAuthorized) {
      await this.reconcileHostAuthorization();
      this.#schedulePreload(current);
      return current;
    }
    if (current.effectiveEnvelope) {
      if (
        current.effectiveEnvelope.status === "authorized" &&
        await projectCapabilityProposalsHaveEquivalentCeilings(
          current.effectiveEnvelope.proposal,
          proposal,
        )
      ) {
        // The new approved brief is independently persisted by the project
        // service. Its exact receipt was recrossed above; the host ceiling is
        // unchanged, so adding a second ledger event would be misleading.
        await this.reconcileHostAuthorization();
        this.#schedulePreload(current);
        return current;
      }
      throw new ProjectCapabilityAuthorizationError(
        "The approved brief capability ceiling differs from the existing or revoked operational authorization.",
      );
    }
    const prepared = current.events.find((event) =>
      event.kind === "initial-prepared" &&
      fingerprintsEqual(
        event.proposal.capabilityProposalFingerprint,
        proposal.capabilityProposalFingerprint,
      )
    );
    if (!prepared) {
      throw new ProjectCapabilityAuthorizationError(
        "The approved brief does not have the exact prepared capability proposal required for finalization.",
      );
    }
    const event = await eventWithFingerprint({
      kind: "initial-authorized" as const,
      recordedAt: this.#now(),
      proposalFingerprint: structuredClone(proposal.capabilityProposalFingerprint),
      approval: receipt,
    });
    const finalized = await this.append(proposal.projectId, current.revision, [
      ...current.events,
      event,
    ]);
    await this.reconcileHostAuthorization();
    this.#schedulePreload(finalized);
    return finalized;
  }

  async inspect(projectId: string): Promise<{
    readonly authorization: "not-authorized" | "authorized" | "revoked";
    readonly ledger: ProjectCapabilityLedger | null;
    readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope | null;
  }> {
    const ledger = await this.dependencies.ledgers.get(projectId);
    return deepFreeze({
      authorization: ledger?.effectiveEnvelope?.status ?? "not-authorized",
      ledger: ledger ? structuredClone(ledger) : null,
      effectiveEnvelope: ledger?.effectiveEnvelope
        ? structuredClone(ledger.effectiveEnvelope)
        : null,
    });
  }

  async reviewPublishedPlan(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityChangeReview> {
    const ledger = await this.dependencies.ledgers.get(project.project.id);
    const envelope = ledger?.effectiveEnvelope;
    if (
      !project.plan || !project.framing?.currentBrief ||
      !project.framing.currentBriefApproval
    ) {
      return { status: "not-authorized", ledger: null, proposal: null };
    }
    const demand = await compileProjectCapabilityDemand(
      project,
      this.dependencies.registry,
    );
    const unresolvedBlockers = publishedPlanUnresolvedBlockers(demand);
    // Union retained authorized requirements so a later plan extension cannot
    // silently drop still-authorized brief capacity.
    const retainedRequirements = envelope?.status === "authorized"
      ? envelope.proposal.semanticRequirements
      : [];
    const requirements = flattenEngineeringCapabilityRequirements([
      ...retainedRequirements,
      ...demand.plannedCeiling.capabilityRequirements,
    ]);
    const proposal = await this.#planPublishedProposal(
      project,
      requirements,
      unresolvedBlockers,
    );
    if (!ledger || !envelope) {
      return { status: "not-authorized", ledger: null, proposal };
    }
    if (envelope.status === "revoked") {
      return {
        status: "revoked",
        ledger,
        proposal,
        effectiveEnvelope: envelope,
      };
    }
    const delta = projectCapabilityEnvelopeDelta(envelope.proposal, proposal);
    if (
      proposal.status === "unresolved" &&
      !unresolvedProposalOnlyRetainsAuthorizedBlockers(
        envelope.proposal,
        proposal,
        unresolvedBlockers,
        delta,
      )
    ) {
      return {
        status: "unresolved",
        ledger,
        proposal,
        effectiveEnvelope: envelope,
        delta,
      };
    }
    if (projectCapabilityProposalCovers(envelope.proposal, proposal)) {
      return { status: "covered", ledger, proposal, effectiveEnvelope: envelope };
    }
    const evidence = await evaluateProjectCapabilityBindingEvidence({
      project,
      registry: this.dependencies.registry,
      recordedPlans: this.dependencies.recordedPlans,
      replacements: delta.bindingReplacements,
    });
    const methodChanges = delta.bindingReplacements.filter(
      projectCapabilityBindingReplacementChangesMethod,
    );
    if (
      methodChanges.some((replacement) =>
        evidence.get(replacement.requirementKey) === "unresolved"
      )
    ) {
      return {
        status: "unresolved",
        ledger,
        proposal,
        effectiveEnvelope: envelope,
        delta,
      };
    }
    return {
      status: projectCapabilityChangeRequiresMethodTransition(
          delta,
          (requirementKey) => evidence.get(requirementKey) === "published",
        )
        ? "method-transition-required"
        : "amendment-required",
      ledger,
      proposal,
      effectiveEnvelope: envelope,
      delta,
    };
  }

  async authorizeAmendment(
    project: EngineeringProjectSnapshot,
    expectedProposalFingerprint:
      ProjectCapabilityProposal["capabilityProposalFingerprint"],
  ): Promise<ProjectCapabilityLedger> {
    const review = await this.reviewPublishedPlan(project);
    if (review.status === "covered") {
      if (
        !fingerprintsEqual(
          review.proposal.capabilityProposalFingerprint,
          expectedProposalFingerprint,
        )
      ) {
        throw new ProjectCapabilityAuthorizationError(
          "The capability amendment retry no longer matches the exact server-derived proposal.",
        );
      }
      // The ledger may have committed immediately before a process crash. A
      // retry must converge its host lock before it is allowed to preload.
      await this.reconcileHostAuthorization();
      this.#schedulePreload(review.ledger);
      return review.ledger;
    }
    if (review.status !== "amendment-required") {
      throw new ProjectCapabilityAuthorizationError(
        `Capability amendment cannot be authorized while review status is ${review.status}.`,
      );
    }
    if (
      !fingerprintsEqual(
        review.proposal.capabilityProposalFingerprint,
        expectedProposalFingerprint,
      )
    ) {
      throw new ProjectCapabilityAuthorizationError(
        "The capability amendment no longer matches the exact server-derived proposal.",
      );
    }
    const event = await eventWithFingerprint({
      kind: "amendment-authorized" as const,
      recordedAt: this.#now(),
      previousEnvelopeFingerprint:
        review.effectiveEnvelope.effectiveEnvelopeFingerprint,
      proposalFingerprint: structuredClone(
        review.proposal.capabilityProposalFingerprint,
      ),
      delta: review.delta,
    });
    const amended = await this.append(project.project.id, review.ledger.revision, [
      ...review.ledger.events,
      event,
    ]);
    await this.reconcileHostAuthorization();
    this.#schedulePreload(amended);
    return amended;
  }

  /**
   * Plans the exact current planned ceiling without retaining unused brief
   * capacity. Dropping unused bindings is not a method transition.
   */
  async reviewUnusedWithdrawal(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityChangeReview> {
    const ledger = await this.dependencies.ledgers.get(project.project.id);
    const envelope = ledger?.effectiveEnvelope;
    if (
      !project.plan || !project.framing?.currentBrief ||
      !project.framing.currentBriefApproval
    ) {
      return { status: "not-authorized", ledger: null, proposal: null };
    }
    const demand = await compileProjectCapabilityDemand(
      project,
      this.dependencies.registry,
    );
    const unresolvedBlockers = publishedPlanUnresolvedBlockers(demand);
    const requirements = flattenEngineeringCapabilityRequirements(
      demand.plannedCeiling.capabilityRequirements,
    );
    const proposal = await this.#planPublishedProposal(
      project,
      requirements,
      unresolvedBlockers,
    );
    if (!ledger || !envelope) {
      return { status: "not-authorized", ledger: null, proposal };
    }
    if (envelope.status === "revoked") {
      return {
        status: "revoked",
        ledger,
        proposal,
        effectiveEnvelope: envelope,
      };
    }
    const withdrawalDelta = projectCapabilityEnvelopeDelta(
      envelope.proposal,
      proposal,
    );
    if (
      proposal.status === "unresolved" &&
      !unresolvedProposalOnlyRetainsAuthorizedBlockers(
        envelope.proposal,
        proposal,
        unresolvedBlockers,
        withdrawalDelta,
      )
    ) {
      return {
        status: "unresolved",
        ledger,
        proposal,
        effectiveEnvelope: envelope,
        delta: withdrawalDelta,
      };
    }
    if (projectCapabilityProposalCovers(envelope.proposal, proposal)) {
      const delta = withdrawalDelta;
      if (isStrictUnusedWithdrawalDelta(delta)) {
        return {
          status: "withdrawal-required",
          ledger,
          proposal,
          effectiveEnvelope: envelope,
          delta,
        };
      }
      return { status: "no-change", ledger, proposal, effectiveEnvelope: envelope };
    }
    const published = await this.reviewPublishedPlan(project);
    if (published.status === "covered") {
      return {
        status: "no-change",
        ledger: published.ledger,
        proposal: published.proposal,
        effectiveEnvelope: published.effectiveEnvelope,
      };
    }
    return published;
  }

  async authorizeUnusedWithdrawal(
    project: EngineeringProjectSnapshot,
    expectedProposalFingerprint:
      ProjectCapabilityProposal["capabilityProposalFingerprint"],
  ): Promise<ProjectCapabilityLedger> {
    const review = await this.reviewUnusedWithdrawal(project);
    if (review.status === "covered" || review.status === "no-change") {
      if (
        !fingerprintsEqual(
          review.proposal.capabilityProposalFingerprint,
          expectedProposalFingerprint,
        )
      ) {
        throw new ProjectCapabilityAuthorizationError(
          "The unused capability withdrawal retry no longer matches the exact server-derived proposal.",
        );
      }
      await this.reconcileHostAuthorization();
      this.#schedulePreload(review.ledger);
      return review.ledger;
    }
    if (
      review.status !== "withdrawal-required" ||
      !isStrictUnusedWithdrawalDelta(review.delta)
    ) {
      throw new ProjectCapabilityAuthorizationError(
        review.status === "amendment-required" ||
          review.status === "method-transition-required"
          ? "Unused capability withdrawal is not available; use the published-plan amendment or method-transition path."
          : `Unused capability withdrawal cannot be authorized while review status is ${review.status}.`,
      );
    }
    if (
      !fingerprintsEqual(
        review.proposal.capabilityProposalFingerprint,
        expectedProposalFingerprint,
      )
    ) {
      throw new ProjectCapabilityAuthorizationError(
        "The unused capability withdrawal no longer matches the exact server-derived proposal.",
      );
    }
    const event = await eventWithFingerprint({
      kind: "amendment-authorized" as const,
      recordedAt: this.#now(),
      previousEnvelopeFingerprint:
        review.effectiveEnvelope.effectiveEnvelopeFingerprint,
      proposalFingerprint: structuredClone(
        review.proposal.capabilityProposalFingerprint,
      ),
      delta: review.delta,
    });
    const withdrawn = await this.append(project.project.id, review.ledger.revision, [
      ...review.ledger.events,
      event,
    ]);
    await this.reconcileHostAuthorization();
    this.#schedulePreload(withdrawn);
    return withdrawn;
  }

  /**
   * Full-envelope revocation is an append-only local operational decision.
   * It does not delete project data, evidence, CAS, WAL or retained volumes.
   */
  async revoke(
    projectId: string,
    expectedEffectiveEnvelopeFingerprint:
      ProjectCapabilityEffectiveEnvelope["effectiveEnvelopeFingerprint"],
    reason: string,
  ): Promise<ProjectCapabilityLedger> {
    if (!reason.trim()) {
      throw new ProjectCapabilityAuthorizationError(
        "Capability revocation requires a non-empty local operator reason.",
      );
    }
    const ledger = await this.dependencies.ledgers.get(projectId);
    const envelope = ledger?.effectiveEnvelope;
    if (ledger && envelope?.status === "revoked") {
      const event = ledger.events.at(-1);
      const predecessor = event?.kind === "revocation-recorded"
        ? await reconstructProjectCapabilityEffectiveEnvelope(
          ledger.events.slice(0, -1),
        )
        : null;
      if (
        event?.kind === "revocation-recorded" && event.reason === reason.trim() &&
        predecessor?.status === "authorized" && fingerprintsEqual(
          predecessor.effectiveEnvelopeFingerprint,
          expectedEffectiveEnvelopeFingerprint,
        )
      ) {
        await this.reconcileHostAuthorization();
        return ledger;
      }
    }
    if (!ledger || !envelope || envelope.status !== "authorized") {
      throw new ProjectCapabilityAuthorizationError(
        "Capability revocation requires one currently authorized project envelope.",
      );
    }
    if (
      !fingerprintsEqual(
        envelope.effectiveEnvelopeFingerprint,
        expectedEffectiveEnvelopeFingerprint,
      )
    ) {
      throw new ProjectCapabilityAuthorizationError(
        "Capability revocation review no longer names the exact effective envelope.",
      );
    }
    const event = await eventWithFingerprint({
      kind: "revocation-recorded" as const,
      recordedAt: this.#now(),
      scope: "full-envelope" as const,
      reason: reason.trim(),
    });
    const revoked = await this.append(projectId, ledger.revision, [
      ...ledger.events,
      event,
    ]);
    await this.reconcileHostAuthorization();
    return revoked;
  }

  /** Local-only convergence repair after an interrupted ledger-to-lock handoff. */
  async reconcileHostAuthorization(): Promise<void> {
    await this.#reconcileHostAuthorization();
  }

  /**
   * Replays only the durable local authorization ledger after control-plane
   * startup. It first converges the derived lock, then re-enqueues the exact
   * authorized envelopes through the same guarded, best-effort preload path
   * used after an approval. It neither accepts caller runtime data nor
   * changes a project, Thread, or authorization record.
   */
  async resumeAuthorizedPreloads(): Promise<void> {
    await this.#reconcileHostAuthorization();
    const ledgers = await this.dependencies.ledgers.list();
    for (const ledger of ledgers) {
      if (ledger.effectiveEnvelope?.status === "authorized") {
        this.#schedulePreload(ledger);
      }
    }
  }

  private async append(
    projectId: string,
    expectedRevision: number,
    events: readonly ProjectCapabilityAuthorizationEvent[],
  ): Promise<ProjectCapabilityLedger> {
    const previous = expectedRevision === 0
      ? null
      : (await this.dependencies.ledgers.get(projectId))?.ledgerFingerprint;
    if (expectedRevision > 0 && !previous) {
      throw new ProjectCapabilityAuthorizationError(
        "Capability ledger disappeared before its next revision could be appended.",
      );
    }
    const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope(
      events,
    );
    const body = {
      schemaVersion: PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
      projectId,
      revision: expectedRevision + 1,
      previous: previous ?? null,
      events,
      effectiveEnvelope,
    };
    const ledgerFingerprint = await sha256Fingerprint(body);
    return await this.dependencies.ledgers.append({
      ...body,
      ledgerFingerprint,
    }, expectedRevision);
  }

  #schedulePreload(ledger: ProjectCapabilityLedger): void {
    const envelope = ledger.effectiveEnvelope;
    if (envelope?.status !== "authorized") return;
    this.dependencies.preloadScheduler?.schedule(
      envelope.proposal,
      () => this.#canPreload(envelope.proposal),
    );
  }

  /** Called by the preload host guard while it holds the host mutation mutex. */
  async #canPreload(proposal: ProjectCapabilityProposal): Promise<boolean> {
    const ledger = await this.dependencies.ledgers.get(proposal.projectId);
    const envelope = ledger?.effectiveEnvelope;
    if (
      !envelope || envelope.status !== "authorized" ||
      !fingerprintsEqual(
        envelope.proposal.capabilityProposalFingerprint,
        proposal.capabilityProposalFingerprint,
      )
    ) return false;
    const lock = await this.#lock();
    return proposal.units.every((unit) =>
      lock.units.some((locked) =>
        locked.id === unit.id && locked.version === unit.version &&
        fingerprintsEqual(locked.manifestFingerprint, unit.manifestFingerprint) &&
        locked.desired === "active"
      )
    );
  }

  /**
   * One durable project ledger is committed before this host projection. A
   * crash therefore only yields a stricter host state; every later finalize
   * retry recomputes the full union before it can enqueue preload.
   */
  async #reconcileHostAuthorization(): Promise<void> {
    const writer = this.dependencies.lockWriter;
    const hostLock = this.dependencies.hostMutationLock;
    if (!writer || !hostLock) return;
    await hostLock.withLock(async () => {
      const ledgers = await this.dependencies.ledgers.list();
      const active = new Map<string, CapabilityRuntimeAdminLock["units"][number]>();
      for (const ledger of ledgers) {
        const envelope = ledger.effectiveEnvelope;
        if (envelope?.status !== "authorized") continue;
        for (const unit of envelope.proposal.units) {
          const catalogued = this.dependencies.catalog.units.find((candidate) =>
            candidate.id === unit.id
          );
          if (
            !catalogued || catalogued.version !== unit.version ||
            !fingerprintsEqual(
              catalogued.manifestFingerprint,
              unit.manifestFingerprint,
            )
          ) {
            throw new ProjectCapabilityAuthorizationError(
              `Authorized capability unit ${unit.id} is absent or differs from the current local catalogue.`,
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
      const current = await writer.read();
      const units = this.dependencies.catalog.units.map((unit) =>
        active.get(unit.id) ?? {
          id: unit.id,
          version: unit.version,
          manifestFingerprint: structuredClone(unit.manifestFingerprint),
          desired: "inactive" as const,
        }
      ).toSorted((left, right) => left.id.localeCompare(right.id));
      if (deterministicJson(current.units) === deterministicJson(units)) return;
      const previous = await sha256Fingerprint(current);
      await writer.save({
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
        previous,
        units,
      });
    });
  }

  async #host(
    requirements: readonly RequiredEngineeringCapability[],
  ): Promise<CapabilityRuntimeHostObservation> {
    const host = this.dependencies.host;
    if (!("read" in host)) return structuredClone(host);
    return await host.read({
      materials: capabilityRuntimeCatalogMaterialsForRequirements(
        this.dependencies.catalog,
        requirements,
      ),
    });
  }

  async #policy(): Promise<CapabilityRuntimeAdminPolicy> {
    const policy = this.dependencies.policy;
    return "read" in policy ? await policy.read() : structuredClone(policy);
  }

  async #lock(): Promise<CapabilityRuntimeAdminLock> {
    const lock = this.dependencies.lock;
    return "read" in lock ? await lock.read() : structuredClone(lock);
  }

  async #planPublishedProposal(
    project: EngineeringProjectSnapshot,
    requirements: readonly RequiredEngineeringCapability[],
    unresolvedBlockers: readonly string[],
  ): Promise<ProjectCapabilityProposal> {
    const brief = project.framing?.currentBrief;
    const approval = project.framing?.currentBriefApproval;
    if (!brief || !approval) {
      throw new ProjectCapabilityAuthorizationError(
        "Published-plan capability proposal requires one exact approved brief.",
      );
    }
    const host = await this.#host(requirements);
    return await planProjectCapabilityRequirementsProposal({
      projectId: project.project.id,
      source: "published-plan",
      brief: {
        briefSnapshotId: brief.id,
        briefRevision: brief.revision,
        briefReviewFingerprint: approval.inputFingerprint,
      },
      intent: null,
      requirements,
      unresolvedBlockers,
      catalog: await this.#effectiveCatalog(host),
      policy: await this.#policy(),
      host,
      lock: await this.#lock(),
    });
  }

  private async proposeForBrief(
    project: EngineeringProjectSnapshot,
    brief: ProjectBriefRevision,
    briefReviewFingerprint:
      ProjectCapabilityProposal["brief"]["briefReviewFingerprint"],
  ): Promise<ProjectCapabilityProposal> {
    const intent = await compileProjectCapabilityIntent(
      brief,
      this.dependencies.registry,
      this.dependencies.routes,
    );
    const host = await this.#host(intent.capabilityRequirements);
    return await planProjectCapabilityIntent({
      projectId: project.project.id,
      brief: {
        briefSnapshotId: brief.id,
        briefRevision: brief.revision,
        briefReviewFingerprint,
      },
      intent,
      catalog: await this.#effectiveCatalog(host),
      policy: await this.#policy(),
      host,
      lock: await this.#lock(),
    });
  }

  async #effectiveCatalog(
    host: CapabilityRuntimeHostObservation,
  ): Promise<CapabilityRuntimeCatalog> {
    const attestations = (await this.dependencies.qualifications?.list()) ?? [];
    return evaluateCapabilityRuntimeQualifications({
      catalog: this.dependencies.catalog,
      host,
      attestations,
      specs: this.dependencies.qualificationSpecs,
      candidates: this.dependencies.qualificationCandidates,
      provenAttestations: this.dependencies.qualificationAttempts
        ? await loadProvenCapabilityRuntimeQualificationAttestations({
          attempts: this.dependencies.qualificationAttempts,
          attestations,
          candidates: this.dependencies.qualificationCandidates,
          specs: this.dependencies.qualificationSpecs,
          host,
        })
        : [],
    });
  }
}

/**
 * A published-plan amendment may retain an explicitly authorized unavailable
 * binding (for example, an unqualified Chrono candidate). That retained local
 * state remains visible on the successor proposal, but cannot make a wholly
 * resolved delta unamendable. A new unresolved operation or binding stays a
 * hard unresolved review. A changed retained candidate that the envelope delta
 * already names as a binding replacement is classified by the evidence fork
 * instead of being treated as an unexplained unresolved blocker.
 */
function publishedPlanUnresolvedBlockers(
  demand: Awaited<ReturnType<typeof compileProjectCapabilityDemand>>,
): readonly string[] {
  return demand.plannedCeiling.operationGroups
    .filter((group) => group.resolution === "unresolved")
    .map((group) =>
      `Operation ${group.operation.id}@${group.operation.version} is unresolved: ${group.reason}.`
    );
}

function unresolvedProposalOnlyRetainsAuthorizedBlockers(
  envelope: ProjectCapabilityProposal,
  proposal: ProjectCapabilityProposal,
  unresolvedBlockers: readonly string[],
  delta: ProjectCapabilityEnvelopeDelta,
): boolean {
  if (unresolvedBlockers.length > 0) return false;
  const previousBindings = new Map(
    envelope.bindings.map((binding) => [
      engineeringCapabilityRequirementKey(binding.requirement),
      binding,
    ]),
  );
  const replaced = new Set(
    delta.bindingReplacements.map((replacement) => replacement.requirementKey),
  );

  return proposal.bindings
    .filter((binding) => binding.status !== "selected")
    .every((binding) => {
      const key = engineeringCapabilityRequirementKey(binding.requirement);
      const previous = previousBindings.get(key);
      if (!previous || previous.status === "selected") return false;
      if (
        deterministicJson(retainedBlockedBindingIdentity(envelope, previous)) ===
          deterministicJson(retainedBlockedBindingIdentity(proposal, binding))
      ) {
        return true;
      }
      return replaced.has(key);
    });
}

function retainedBlockedBindingIdentity(
  proposal: ProjectCapabilityProposal,
  binding: ProjectCapabilityProposal["bindings"][number],
): unknown {
  const candidate = binding.candidate;
  return {
    candidate: candidate === undefined ? null : {
      id: candidate.id,
      version: candidate.version,
      adapter: candidate.adapter,
      profile: candidate.profile,
      unitIds: candidate.unitIds,
    },
    units: binding.unitIds.map((unitId) => {
      const unit = proposal.units.find((candidate) => candidate.id === unitId);
      return unit === undefined ? null : {
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
      };
    }),
    materials: proposal.materials
      .filter((material) => binding.unitIds.includes(material.unitId))
      .map((material) => ({
        unitId: material.unitId,
        materialId: material.materialId,
        imageReference: material.imageReference,
        downloadBytes: material.downloadBytes,
        storageBytes: material.storageBytes,
      })),
  };
}

async function eventWithFingerprint<
  T extends Omit<ProjectCapabilityAuthorizationEvent, "eventFingerprint">,
>(
  event: T,
): Promise<
  T & { readonly eventFingerprint: Awaited<ReturnType<typeof sha256Fingerprint>> }
> {
  const eventFingerprint = await fingerprintProjectCapabilityAuthorizationEvent(event);
  return deepFreeze({ ...event, eventFingerprint });
}

/**
 * A pending file may only be completed by the exact initial-preparation
 * command that produced it. It remains unauthorised until `append` claims it.
 */
function isExactPreparedAppend(
  current: ProjectCapabilityLedger | undefined,
  pending: ProjectCapabilityLedger,
  proposal: ProjectCapabilityProposal,
): boolean {
  const priorEvents = current?.events ?? [];
  const tail = pending.events.at(-1);
  return pending.revision === (current?.revision ?? 0) + 1 &&
    pending.events.length === priorEvents.length + 1 &&
    deterministicJson(pending.events.slice(0, -1)) ===
      deterministicJson(priorEvents) &&
    tail?.kind === "initial-prepared" &&
    fingerprintsEqual(
      tail.proposal.capabilityProposalFingerprint,
      proposal.capabilityProposalFingerprint,
    );
}

function approvalReceipt(
  project: EngineeringProjectSnapshot,
  proposal: ProjectCapabilityProposal,
): ProjectCapabilityApprovalReceipt {
  const brief = project.framing?.currentBrief;
  const approval = project.framing?.currentBriefApproval;
  const receipt = project.commandReceipts?.find((candidate) =>
    candidate.type === "project.brief-approve" &&
    candidate.resultingSnapshot.revision === project.revision
  );
  if (
    !brief || !approval || approval.status !== "approved" || !receipt ||
    brief.id !== proposal.brief.briefSnapshotId ||
    brief.revision !== proposal.brief.briefRevision ||
    !fingerprintsEqual(approval.inputFingerprint, proposal.brief.briefReviewFingerprint)
  ) {
    throw new ProjectCapabilityAuthorizationError(
      "Initial capability finalization requires the exact approved brief receipt matching its prepared proposal.",
    );
  }
  return {
    projectSnapshotId: project.id,
    projectRevision: project.revision,
    approvedBriefFingerprint: structuredClone(approval.inputFingerprint),
  };
}
