import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import { compileProjectCapabilityIntent } from "./compile-project-capability-intent.ts";
import { compileProjectCapabilityDemand } from "./compile-project-capability-demand.ts";
import {
  planProjectCapabilityIntent,
  planProjectCapabilityRequirementsProposal,
  projectCapabilityEnvelopeDelta,
  projectCapabilityProposalCovers,
} from "./plan-project-capability-intent.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
  type ProjectCapabilityApprovalReceipt,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityEffectiveEnvelope,
  type ProjectCapabilityEnvelopeDelta,
  type ProjectCapabilityLedger,
  type ProjectCapabilityProposal,
  projectCapabilityProposalsHaveEquivalentCeilings,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "./project-capability-authorization.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
} from "./read-model/capability-runtime-catalog.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type { EngineeringOperationRegistry } from "../../orchestration/operations/operation-contract.ts";
import type { BriefCapabilityIntentRouteTable } from "../../orchestration/operations/brief-capability-intent-routes.ts";
import type { CapabilityRuntimePreloadScheduler } from "./capability-runtime-preload-scheduler.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import { evaluateCapabilityRuntimeQualifications } from "./evaluate-capability-runtime-qualifications.ts";
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
  /** Same exact local overlay consulted by MCP and Workbench runtime contexts. */
  readonly qualifications?: Pick<
    CapabilityRuntimeQualificationAttestationStore,
    "list"
  >;
  /** Non-blocking host-material preload after durable authorization only. */
  readonly preloadScheduler?: Pick<CapabilityRuntimePreloadScheduler, "schedule">;
  readonly now?: () => string;
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
    const unresolvedBlockers = demand.plannedCeiling.operationGroups
      .filter((group) => group.resolution === "unresolved")
      .map((group) =>
        `Operation ${group.operation.id}@${group.operation.version} is unresolved: ${group.reason}.`
      );
    const host = await this.#host();
    const proposal = await planProjectCapabilityRequirementsProposal({
      projectId: project.project.id,
      source: "published-plan",
      brief: {
        briefSnapshotId: project.framing.currentBrief.id,
        briefRevision: project.framing.currentBrief.revision,
        briefReviewFingerprint: project.framing.currentBriefApproval.inputFingerprint,
      },
      intent: null,
      requirements: demand.plannedCeiling.capabilityRequirements,
      unresolvedBlockers,
      catalog: await this.#effectiveCatalog(host),
      policy: await this.#policy(),
      host,
      lock: await this.#lock(),
    });
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
    if (proposal.status === "unresolved") {
      return {
        status: "unresolved",
        ledger,
        proposal,
        effectiveEnvelope: envelope,
        delta: projectCapabilityEnvelopeDelta(envelope.proposal, proposal),
      };
    }
    if (projectCapabilityProposalCovers(envelope.proposal, proposal)) {
      return { status: "covered", ledger, proposal, effectiveEnvelope: envelope };
    }
    const delta = projectCapabilityEnvelopeDelta(envelope.proposal, proposal);
    const bindingChangesWithProof = delta.bindingReplacements.length > 0 &&
      project.threadSnapshots.length > 0;
    return {
      status: bindingChangesWithProof
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
    this.#schedulePreload(amended);
    return amended;
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
    this.dependencies.preloadScheduler?.schedule(envelope.proposal);
  }

  async #host(): Promise<CapabilityRuntimeHostObservation> {
    const host = this.dependencies.host;
    return "read" in host ? await host.read() : structuredClone(host);
  }

  async #policy(): Promise<CapabilityRuntimeAdminPolicy> {
    const policy = this.dependencies.policy;
    return "read" in policy ? await policy.read() : structuredClone(policy);
  }

  async #lock(): Promise<CapabilityRuntimeAdminLock> {
    const lock = this.dependencies.lock;
    return "read" in lock ? await lock.read() : structuredClone(lock);
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
    const host = await this.#host();
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
    return evaluateCapabilityRuntimeQualifications({
      catalog: this.dependencies.catalog,
      host,
      attestations: (await this.dependencies.qualifications?.list()) ?? [],
    });
  }
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
