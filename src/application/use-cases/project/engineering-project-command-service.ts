import {
  type EngineeringAgentRun,
  type EngineeringAgentRunStatus,
  type EngineeringAgentRunUncertainWriterReconciliation,
  type EngineeringCancelledRunReceiptBinding,
  type EngineeringDecision,
  type EngineeringProjectCommandName,
  type EngineeringProjectSnapshot,
  type EngineeringQueuedRunReceiptBinding,
  type EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  requireApprovedUncertainWriterReconciliationDecision,
  TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES,
} from "../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  applyCrossDomainImpactWorkItemClaims,
  canonicalizeCrossDomainImpactWorkItemClaims,
  recrossCrossDomainImpactWorkItemClaims,
} from "../../../domain/impact/cross-domain-impact-decision.ts";
import {
  uncertainWriterBasisReleaseIds,
  uncertainWriterBasisReleaseText,
} from "../../../domain/record/uncertain-writer-basis-release.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandOrigin } from "../../ports/in/engineering-project-command-origin.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandErrorCode,
} from "./commands/engineering-project-command-error.ts";
import {
  assertAllowed,
  ENGINEERING_PROJECT_COMMAND_POLICY,
} from "./commands/engineering-project-command-policy.ts";
import type {
  AbandonWorkItemsCommand,
  AcceptCrossDomainImpactDecisionCommand,
  AppendProjectChangeCommand,
  CancelQueuedRunCommand,
  CompleteRunCommand,
  DecideDecisionCommand,
  EngineeringDecisionProposalInput,
  EngineeringProjectCommandInput,
  EngineeringProjectCompletionEvidenceValidator,
  EngineeringProjectInitialCompletionEvidenceValidator,
  EngineeringProjectPlanningDependencies,
  EngineeringProjectPlanOperationRegistry,
  EngineeringProjectQueueEligibility,
  EngineeringProjectReconciliationOperationPolicy,
  EngineeringProjectReconciliationSnapshotValidator,
  FailRunCommand,
  PlannedEngineeringDecision,
  PlannedEngineeringProjectPhase,
  PlannedEngineeringWorkItem,
  ProposeDecisionCommand,
  PublishProjectPlanCommand,
  QueueRunCommand,
  ReconcileAnnotationRunCommand,
  ReconcileWorkItemWithSuccessorCommand,
  RunCommand,
} from "./commands/engineering-project-commands.ts";
import {
  applyAppendChange,
  applyPublishPlan,
  approvedBriefBasisForProject,
} from "./commands/project-planning-transitions.ts";
import {
  applyDecideDecision,
  applyProposeDecision,
} from "./commands/engineering-decision-transitions.ts";
import {
  applyCancelQueuedRun,
  applyClaimRun,
  applyCompleteRun,
  applyFailRun,
  applyOrdinaryRunTransition,
  applyQueueRun,
  hasCallerCancelledRunBinding,
  hasCallerQueuedRunBinding,
} from "./commands/engineering-run-transitions.ts";
import {
  actor,
  addThreadSnapshot,
  assertDeclaredSnapshot,
  assertExactResultEvidence,
  assertResultAdvancesBase,
  findDecision,
  findRun,
  findWorkItem,
  invalidInput,
  invalidTransition,
  mergeEvidence,
  type Mutable,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
  sameEvidenceReferences,
  sameSnapshotReference,
  stale,
  threadSnapshotReference,
  transition,
} from "./commands/engineering-project-transition-values.ts";

export {
  approvedBriefBasisForProject,
  ENGINEERING_PROJECT_COMMAND_POLICY,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandErrorCode,
};
export type {
  AbandonWorkItemsCommand,
  AcceptCrossDomainImpactDecisionCommand,
  AppendProjectChangeCommand,
  CancelQueuedRunCommand,
  CompleteRunCommand,
  DecideDecisionCommand,
  EngineeringDecisionProposalInput,
  EngineeringProjectCommandInput,
  EngineeringProjectCompletionEvidenceValidator,
  EngineeringProjectInitialCompletionEvidenceValidator,
  EngineeringProjectPlanningDependencies,
  EngineeringProjectPlanOperationRegistry,
  EngineeringProjectQueueEligibility,
  EngineeringProjectReconciliationOperationPolicy,
  EngineeringProjectReconciliationSnapshotValidator,
  FailRunCommand,
  PlannedEngineeringDecision,
  PlannedEngineeringProjectPhase,
  PlannedEngineeringWorkItem,
  ProposeDecisionCommand,
  PublishProjectPlanCommand,
  QueueRunCommand,
  ReconcileAnnotationRunCommand,
  ReconcileWorkItemWithSuccessorCommand,
  RunCommand,
};

/**
 * Failure codes that indicate a terminal uncertain write — the provider
 * acknowledged a write but the executor crashed before the ThreadSnapshot was
 * published.  Only these codes (or the geometry write, which is conservatively
 * terminal regardless of code) are eligible for uncertain-writer reconciliation.
 *
 * WHY IN DOMAIN — eligibility is a domain invariant enforced by
 * `reconcileAnnotationRun`, not just an adapter-level gate. The domain set is
 * the single authority; the executor and basis guard import or alias it.
 */
export const ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES =
  TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES;

interface CancellationFingerprintInput extends EngineeringProjectCommandInput {
  readonly runId?: string;
  readonly rationale?: string;
}

type Clock = () => string;

/**
 * Trusted command boundary for immutable EngineeringProjectSnapshot revisions.
 * The transport supplies the authenticated origin; browser payloads cannot
 * acquire agent lifecycle authority by changing their JSON.
 */
export class EngineeringProjectCommandService {
  constructor(
    private readonly store: EngineeringProjectRevisionStore,
    private readonly evidenceValidator?: EngineeringProjectCompletionEvidenceValidator,
    private readonly now: Clock = () => new Date().toISOString(),
    private readonly planning?: EngineeringProjectPlanningDependencies,
    private readonly initialEvidenceValidator?:
      EngineeringProjectInitialCompletionEvidenceValidator,
    private readonly reconciliationSnapshotValidator?:
      EngineeringProjectReconciliationSnapshotValidator,
    private readonly reconciliationOperationPolicy?:
      EngineeringProjectReconciliationOperationPolicy,
  ) {}

  /**
   * Persist a bounded, agent-authored project path after an exact approved
   * project brief. This is planning only: it neither approves anything,
   * queues a run, calls a provider nor manufactures technical evidence.
   */
  publishPlan(
    origin: EngineeringProjectCommandOrigin,
    command: PublishProjectPlanCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.plan-publish",
      command,
      (draft, appliedAt) => {
        applyPublishPlan(draft, appliedAt, origin, command, this.planning);
      },
    );
  }

  /**
   * Append one bounded, registry-reviewed change to an already materialized
   * V3 project. This is deliberately not a plan replacement: the
   * initial plan and all execution history stay intact in the next immutable
   * project revision.
   */
  appendChange(
    origin: EngineeringProjectCommandOrigin,
    command: AppendProjectChangeCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.change-append",
      command,
      (draft, appliedAt) => {
        applyAppendChange(draft, appliedAt, origin, command, this.planning);
      },
    );
  }

  proposeDecision(
    origin: EngineeringProjectCommandOrigin,
    command: ProposeDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, "decision.propose", command, async (draft, appliedAt) => {
      await applyProposeDecision(draft, appliedAt, origin, command);
    });
  }

  approveDecision(
    origin: EngineeringProjectCommandOrigin,
    command: DecideDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.decide(origin, "decision.approve", command, "approved");
  }

  rejectDecision(
    origin: EngineeringProjectCommandOrigin,
    command: DecideDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.decide(origin, "decision.reject", command, "rejected");
  }

  queueRun(
    origin: EngineeringProjectCommandOrigin,
    command: QueueRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (hasCallerQueuedRunBinding(command)) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "invalid_input",
          "queuedRun is server-stamped and cannot be supplied by a caller.",
        ),
      );
    }
    return this.apply(origin, "agent-run.queue", command, async (draft, appliedAt) => {
      await applyQueueRun(draft, appliedAt, origin, command, this.planning);
    });
  }

  claimRun(
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.claim",
      command,
      ["queued"],
      "running",
      (run, appliedAt) => {
        applyClaimRun(run, appliedAt, origin);
      },
    );
  }

  progressRun(
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.progress",
      command,
      ["running"],
      "running",
    );
  }

  publishRun(
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.publish",
      command,
      ["running"],
      "publishing",
    );
  }

  completeRun(
    origin: EngineeringProjectCommandOrigin,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.complete",
      command,
      ["publishing"],
      "completed",
      async (run, appliedAt, draft) => {
        await applyCompleteRun(
          run,
          appliedAt,
          draft,
          command,
          this.evidenceValidator,
          this.initialEvidenceValidator,
        );
      },
    );
  }

  failRun(
    origin: EngineeringProjectCommandOrigin,
    command: FailRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.fail",
      command,
      ["running", "waiting-for-decision", "publishing"],
      "failed",
      (run, appliedAt, draft) => {
        applyFailRun(run, appliedAt, draft, command);
      },
    );
  }

  /**
   * Record an explicit human cancellation before a run is claimed. This is a
   * truthful administrative closeout, not a failed execution and never
   * manufactures an execution timestamp or agent authority.
   */
  cancelQueuedRun(
    origin: EngineeringProjectCommandOrigin,
    command: CancelQueuedRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (hasCallerCancelledRunBinding(command)) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "invalid_input",
          "cancelledRun is server-stamped and cannot be supplied by a caller.",
        ),
      );
    }
    return this.apply(origin, "agent-run.cancel", command, (draft, appliedAt) => {
      applyCancelQueuedRun(draft, appliedAt, origin, command);
    });
  }

  /**
   * Resolve the write-uncertainty on a terminal failed run and complete the
   * reconciliation work item atomically.
   *
   * WHY ONE STEP — no provider is called, no ThreadSnapshot is produced.  The
   * reconciliation run transitions directly queued → completed (annotationOnly:
   * true) in one atomic write, mirroring the simplicity of cancelQueuedRun.
   * The human executor has already validated the MRTR and inspected the
   * provider; the command service only enforces the domain state invariants.
   */
  reconcileAnnotationRun(
    origin: EngineeringProjectCommandOrigin,
    command: ReconcileAnnotationRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "agent-run.reconcile-annotation",
      command,
      async (draft, appliedAt) => {
        nonEmpty(command.reconciliationRunId, "reconciliationRunId");
        nonEmpty(command.failedRunId, "failedRunId");
        nonEmpty(command.decisionId, "decisionId");
        nonEmpty(
          command.providerInspectionAttestation,
          "providerInspectionAttestation",
        );
        if (
          command.outcome !== "provider-did-not-write" &&
          command.outcome !== "write-effect-accepted"
        ) {
          invalidInput(
            'outcome must be "provider-did-not-write" or "write-effect-accepted".',
          );
        }
        if (command.reconciliationRunId === command.failedRunId) {
          invalidInput("A reconciliation run cannot target itself as the failed run.");
        }

        // Reconciliation run must be queued and unstarted.
        const reconciliationRun = findRun(draft, command.reconciliationRunId);
        if (!reconciliationRun) {
          notFound("reconciliation agent run", command.reconciliationRunId);
        }
        if (reconciliationRun.status !== "queued") {
          invalidTransition(
            `Reconciliation run ${reconciliationRun.id} must be queued; it is ${reconciliationRun.status}.`,
          );
        }
        if (
          reconciliationRun.startedAt || reconciliationRun.completedAt ||
          reconciliationRun.claimedAt || reconciliationRun.claimedBy ||
          reconciliationRun.waitingForDecisionIds || reconciliationRun.resultSnapshot ||
          reconciliationRun.failure || reconciliationRun.evidenceRefs.length !== 0
        ) {
          invalidTransition(
            `Queued reconciliation run ${reconciliationRun.id} has unexpected execution state.`,
          );
        }

        // Target run must be a terminal failed run with no existing reconciliation.
        const failedRun = findRun(draft, command.failedRunId);
        if (!failedRun) notFound("failed agent run", command.failedRunId);
        if (failedRun.status !== "failed" || !failedRun.failure) {
          invalidTransition(
            `Target run ${failedRun.id} must be a failed run with a structured failure.`,
          );
        }

        // Domain eligibility guard: only terminal-uncertain failures (or the geometry
        // write, which is conservatively terminal) may be reconciled.  This prevents
        // bypassing the executor-level gate via a direct domain call.
        const failedWorkItem = findWorkItem(draft, failedRun.workItemId);
        if (!failedWorkItem) {
          notFound("work item for failed run", failedRun.workItemId);
        }
        const failedOperation = failedWorkItem.operation;
        const isGeometryWrite = failedOperation
          ? `${failedOperation.id}@${failedOperation.version}` ===
            `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`
          : false;
        if (
          !ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES.has(failedRun.failure.code) &&
          !isGeometryWrite
        ) {
          invalidTransition(
            `Target run ${failedRun.id} failure code "${failedRun.failure.code}" is not in ` +
              "ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES and is not the geometry write operation. " +
              "Only terminal-uncertain failures are eligible for uncertain-writer reconciliation.",
          );
        }

        if (failedRun.uncertainWriterReconciliation !== undefined) {
          invalidTransition(
            `Target run ${failedRun.id} already has an uncertainWriterReconciliation; ` +
              "a run can be reconciled only once.",
          );
        }
        if (failedRun.evidenceRefs.length !== 0) {
          invalidTransition(
            `Target run ${failedRun.id} has evidence refs; uncertain writer reconciliation ` +
              "is not applicable to runs that produced evidence.",
          );
        }

        try {
          await requireApprovedUncertainWriterReconciliationDecision(
            draft,
            reconciliationRun,
            failedRun,
            {
              decisionId: command.decisionId,
              outcome: command.outcome,
              providerInspectionAttestation: command.providerInspectionAttestation,
            },
          );
        } catch (error) {
          invalidTransition(
            `The reconciliation command has no exact approved MRTR authority: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        // The service owns provenance. Caller-supplied actors or timestamps can
        // never masquerade as the authoritative application event.
        failedRun.uncertainWriterReconciliation = {
          kind: "uncertain-writer-resolved",
          outcome: command.outcome,
          reconciledAt: appliedAt,
          reconciledBy: actor(origin),
          decisionId: command.decisionId,
          providerInspectionAttestation: command.providerInspectionAttestation,
        };

        // An accepted provider effect creates a server-owned blocker plus a
        // separate required decision. The decision is phase/blocker-linked but
        // deliberately not attached to the failed writer work item: doing so
        // would apply that writer operation's proposal grammar to this release.
        if (command.outcome === "write-effect-accepted") {
          const ids = uncertainWriterBasisReleaseIds(failedRun.id);
          const text = uncertainWriterBasisReleaseText(failedRun.id);
          if (draft.blockers.some((b) => b.id === ids.blockerId)) {
            invalidInput(`Blocker id ${ids.blockerId} already exists.`);
          }
          if (findDecision(draft, ids.decisionId)) {
            invalidInput(
              `Resolution decision id ${ids.decisionId} already exists.`,
            );
          }
          const resolutionDecision: Mutable<EngineeringDecision> = {
            id: ids.decisionId,
            phaseId: failedWorkItem.phaseId,
            title: text.decisionTitle,
            question: text.decisionQuestion,
            status: "required",
            requestedAt: appliedAt,
            inputEvidenceRefs: [],
            approvalIds: [],
          };
          draft.decisions.push(resolutionDecision);
          const phase = draft.phases.find((item) =>
            item.id === failedWorkItem.phaseId
          )!;
          phase.requiredDecisionIds = [
            ...phase.requiredDecisionIds,
            resolutionDecision.id,
          ];
          draft.blockers.push({
            id: ids.blockerId,
            phaseId: failedWorkItem.phaseId,
            title: text.blockerTitle,
            description: text.blockerDescription,
            kind: "tool-failure",
            status: "open",
            openedAt: appliedAt,
            workItemIds: [failedWorkItem.id],
            decisionIds: [resolutionDecision.id],
          });
          // Bidirectional cross-reference: the failed work item must know it has a blocker.
          failedWorkItem.blockerIds = [
            ...failedWorkItem.blockerIds,
            ids.blockerId,
          ];
        }

        // Complete the reconciliation run (annotation-only, no ThreadSnapshot).
        const summary = "Uncertain-writer reconciliation completed by human operator.";
        reconciliationRun.status = "completed";
        reconciliationRun.annotationOnly = true;
        reconciliationRun.completedAt = appliedAt;
        reconciliationRun.summary = summary;
        reconciliationRun.statusHistory ??= [];
        reconciliationRun.statusHistory.push(transition(
          { commandId: command.commandId, summary },
          origin,
          "completed",
          appliedAt,
        ));

        const workItem = findWorkItem(draft, reconciliationRun.workItemId)!;
        workItem.status = "completed";
        recomputeWorkReadiness(draft);
      },
    );
  }

  /**
   * Complete the human-only impact-decision run and apply the signed gate-claim
   * statuses onto existing work items in one project write. Other work-item
   * lifecycle is unchanged. No work item or rerun is added.
   */
  acceptCrossDomainImpactDecision(
    origin: EngineeringProjectCommandOrigin,
    command: AcceptCrossDomainImpactDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "impact-decision.accept",
      command,
      async (draft, appliedAt) => {
        nonEmpty(command.runId, "runId");
        nonEmpty(command.summary, "summary");
        nonEmpty(command.decisionId, "decisionId");
        if (
          command.limits.providerCalls !== "none" ||
          command.limits.solverCalls !== "none" ||
          command.limits.reruns !== "none" ||
          command.limits.newWorkItems !== "none"
        ) {
          invalidInput(
            "An impact decision cannot grant a provider, solver, rerun, or new work item.",
          );
        }
        const run = findRun(draft, command.runId);
        if (!run) notFound("agent run", command.runId);
        const decisionWork = findWorkItem(draft, run.workItemId);
        if (!decisionWork) notFound("work item", run.workItemId);
        const operation = decisionWork.operation;
        if (
          run.basis?.kind !== "thread-snapshot" ||
          operation?.id !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id ||
          operation.version !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version
        ) {
          invalidTransition(
            "This command may complete only decide.accept-cross-domain-impact@1.",
          );
        }
        if (run.status !== "queued") {
          invalidTransition(
            `Impact-decision run ${run.id} can complete only from queued; it is ${run.status}.`,
          );
        }
        const decision = findDecision(draft, command.decisionId);
        if (
          !decision ||
          decision.status !== "approved" ||
          !decisionWork.decisionIds.includes(command.decisionId)
        ) {
          invalidTransition(
            "The impact decision is not the exact approved MRTR bound to this run.",
          );
        }
        const workItemIds = draft.workItems.map((item) => item.id);
        const runIds = draft.agentRuns.map((item) => item.id);
        const appliedGateClaims = canonicalizeCrossDomainImpactWorkItemClaims(
          command.appliedGateClaims,
        );
        const recrossed = recrossCrossDomainImpactWorkItemClaims(
          draft.workItems,
          appliedGateClaims.map((item) => ({
            gateItemId: item.gateItemId,
            role: item.role,
            status: item.status,
          })),
          { excludeWorkItemId: decisionWork.id },
        );
        if (deterministicJson(recrossed) !== deterministicJson(appliedGateClaims)) {
          invalidTransition(
            "Current work-item gate claims do not equal the signed impact-decision recross.",
          );
        }
        if (
          command.evaluationCapture.id !==
            `cross-domain-impact-evaluation-${command.evaluationCapture.fingerprint.digest}`
        ) {
          invalidInput(
            "The impact-decision evaluation capture id must derive from its digest.",
          );
        }
        assertExactResultEvidence(
          draft,
          command.resultSnapshot,
          command.evidenceRefs,
        );
        const basis = run.basis;
        if (basis?.kind !== "thread-snapshot") {
          invalidTransition(
            "This command may complete only decide.accept-cross-domain-impact@1.",
          );
        }
        const baseSnapshot = threadSnapshotReference(basis);
        assertResultAdvancesBase(baseSnapshot, command.resultSnapshot);
        if (!this.evidenceValidator) {
          invalidInput(
            "Completion evidence validation is unavailable; refusing to publish unverified refs.",
          );
        }
        await this.evidenceValidator.validate(
          baseSnapshot,
          command.resultSnapshot,
          command.evidenceRefs,
        );
        draft.workItems = structuredClone(
          applyCrossDomainImpactWorkItemClaims(
            draft.workItems,
            appliedGateClaims,
            { excludeWorkItemId: decisionWork.id },
          ),
        ) as Mutable<EngineeringWorkItem>[];
        addThreadSnapshot(draft, command.resultSnapshot);
        run.status = "completed";
        run.summary = command.summary;
        run.claimedAt = appliedAt;
        run.claimedBy = actor(origin);
        run.startedAt = appliedAt;
        run.completedAt = appliedAt;
        run.resultSnapshot = structuredClone(command.resultSnapshot);
        run.evidenceRefs = [...structuredClone(command.evidenceRefs)];
        run.statusHistory ??= [];
        run.statusHistory.push(transition(
          { commandId: command.commandId, summary: command.summary },
          origin,
          "completed",
          appliedAt,
        ));
        const completedWork = findWorkItem(draft, run.workItemId)!;
        completedWork.status = "completed";
        completedWork.evidenceRefs = [...structuredClone(command.evidenceRefs)];
        const phase = draft.phases.find((item) => item.id === completedWork.phaseId)!;
        phase.evidenceRefs = mergeEvidence(phase.evidenceRefs, command.evidenceRefs);
        if (
          deterministicJson(draft.workItems.map((item) => item.id)) !==
            deterministicJson(workItemIds) ||
          deterministicJson(draft.agentRuns.map((item) => item.id)) !==
            deterministicJson(runIds) ||
          draft.agentRuns.some((item) =>
            item.id !== run.id && item.status === "queued" &&
            !runIds.includes(item.id)
          )
        ) {
          invalidTransition(
            "An impact decision cannot add a work item or enqueue a rerun.",
          );
        }
        recomputeWorkReadiness(draft);
      },
    );
  }

  /**
   * Permanently close a failed work item behind a separately completed
   * successor. Both execution histories remain intact: the failed run stays
   * failed and the successor retains its own completed work item and evidence.
   */
  reconcileWorkItemWithSuccessor(
    origin: EngineeringProjectCommandOrigin,
    command: ReconcileWorkItemWithSuccessorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "work-item.reconcile-successor",
      command,
      async (draft, appliedAt) => {
        nonEmpty(command.failedWorkItemId, "failedWorkItemId");
        nonEmpty(command.failedRunId, "failedRunId");
        nonEmpty(command.successorRunId, "successorRunId");
        nonEmpty(command.rationale, "rationale");
        if (command.failedRunId === command.successorRunId) {
          invalidInput("A failed run cannot reconcile itself as its successor.");
        }
        assertDeclaredSnapshot(draft, command.successorRunSnapshot);
        if (command.successorSnapshot !== undefined) {
          // Full closeout path: a separate closeout snapshot was produced and
          // must immediately follow the successor result in the project lineage.
          if (
            command.successorSnapshot.subjectId !== draft.project.subjectId ||
            command.successorSnapshot.snapshotId.toLowerCase() === "latest" ||
            command.successorSnapshot.revision !==
              command.successorRunSnapshot.revision + 1 ||
            !sameSnapshotReference(
              draft.threadSnapshots.at(-1)!,
              command.successorRunSnapshot,
            )
          ) {
            invalidInput(
              "The closeout snapshot must directly follow the current completed successor snapshot.",
            );
          }
          if (!this.reconciliationSnapshotValidator) {
            invalidInput(
              "Successor reconciliation requires an exact persisted closeout snapshot validator.",
            );
          }
          await this.reconciliationSnapshotValidator.validate(
            command.successorRunSnapshot,
            command.successorSnapshot,
          );
        } else {
          // Direct reconciliation does not create a synthetic ThreadSnapshot.
          // The successor result may already be an immutable ancestor of the
          // current project head (e.g. a later independently published run).
          // Prove that topology through the injected persistence reader; a
          // familiar subject/revision is never accepted as a substitute.
          const currentHead = draft.threadSnapshots.at(-1)!;
          if (
            currentHead.subjectId !== command.successorRunSnapshot.subjectId ||
            currentHead.revision < command.successorRunSnapshot.revision
          ) {
            invalidInput(
              "Direct reconciliation requires the current project thread head to be at or after the successor run snapshot.",
            );
          }
          if (!this.reconciliationSnapshotValidator) {
            invalidInput(
              "Direct reconciliation requires an exact persisted thread-lineage validator.",
            );
          }
          await this.reconciliationSnapshotValidator.validateCurrentHeadDescendsFrom(
            currentHead,
            command.successorRunSnapshot,
          );
        }
        const failedWork = findWorkItem(draft, command.failedWorkItemId);
        if (!failedWork) notFound("work item", command.failedWorkItemId);
        if (failedWork.status !== "ready") {
          invalidTransition(
            `Work item ${failedWork.id} can reconcile only from ready after its failed attempt.`,
          );
        }
        if (failedWork.evidenceRefs.length !== 0) {
          invalidTransition(
            `Work item ${failedWork.id} already owns evidence and cannot be reconciled as failed work.`,
          );
        }
        const failedRun = findRun(draft, command.failedRunId);
        if (!failedRun) notFound("agent run", command.failedRunId);
        // Accept either an evidence-free failed run (explicit failure record) or
        // a run that was cancelled by a human before any agent claim — meaning no
        // provider was ever touched (no claimedAt, no startedAt). A queued run
        // must be cancelled first via human elicitation before reconciliation is
        // valid; reconciliation is not a substitute for cancellation.
        const isEvidenceFreeFailure = failedRun.status === "failed" &&
          !!failedRun.failure &&
          failedRun.evidenceRefs.length === 0;
        const isPreClaimCancellation = failedRun.status === "cancelled" &&
          !failedRun.claimedAt &&
          !failedRun.startedAt && failedRun.evidenceRefs.length === 0;
        if (
          failedRun.workItemId !== failedWork.id ||
          (!isEvidenceFreeFailure && !isPreClaimCancellation)
        ) {
          invalidTransition(
            `Run ${command.failedRunId} must be an evidence-free failed attempt or a pre-claim cancelled run for ${failedWork.id}.`,
          );
        }
        const successor = findRun(draft, command.successorRunId);
        if (!successor) notFound("agent run", command.successorRunId);
        if (
          successor.workItemId === failedWork.id || successor.status !== "completed" ||
          !successor.resultSnapshot || successor.evidenceRefs.length === 0
        ) {
          invalidTransition(
            `Run ${command.successorRunId} is not a completed successor with evidence.`,
          );
        }
        if (
          !sameSnapshotReference(
            successor.resultSnapshot,
            command.successorRunSnapshot,
          ) ||
          !sameEvidenceReferences(
            successor.evidenceRefs,
            command.successorEvidenceRefs,
          )
        ) {
          invalidInput(
            "The declared successor snapshot and evidence must exactly match the completed successor run.",
          );
        }
        const successorWork = findWorkItem(draft, successor.workItemId)!;
        if (successorWork.activityId !== failedWork.activityId) {
          invalidInput(
            `Successor work item ${successorWork.id} is not in the same stable activity as ${failedWork.id}.`,
          );
        }
        if (
          successorWork.status !== "completed" ||
          !sameEvidenceReferences(
            successorWork.evidenceRefs,
            successor.evidenceRefs,
          )
        ) {
          invalidTransition(
            `Completed successor run ${successor.id} has inconsistent work-item evidence.`,
          );
        }
        // Equivalent operations are always safe. A different operation is
        // forbidden on the direct recovery form and requires a code-owned,
        // injected proof on the full closeout form. The mere presence of a
        // direct-child snapshot proves topology, not semantic compatibility.
        if (failedWork.operation !== undefined) {
          const operationsMatch =
            successorWork.operation?.id === failedWork.operation.id &&
            successorWork.operation?.version === failedWork.operation.version &&
            deterministicJson(successorWork.operation.bindings) ===
              deterministicJson(failedWork.operation.bindings);
          if (!operationsMatch && command.successorSnapshot === undefined) {
            invalidInput(
              `Successor work item ${successorWork.id} does not carry the same operation ` +
                `(id, version, bindings) as the failed work item ${failedWork.id}. ` +
                `Use the exact registered operation the failed work was supposed to execute.`,
            );
          }
          if (!operationsMatch && command.successorSnapshot !== undefined) {
            if (!this.reconciliationOperationPolicy) {
              invalidInput(
                `Full closeout from operation ${failedWork.operation.id}@${failedWork.operation.version} ` +
                  `to ${successorWork.operation?.id ?? "an undeclared operation"}@${
                    successorWork.operation?.version ?? "unknown"
                  } requires an injected operation-transition policy.`,
              );
            }
            await this.reconciliationOperationPolicy.authorize({
              failedWorkItemId: failedWork.id,
              failedOperation: structuredClone(failedWork.operation),
              successorWorkItemId: successorWork.id,
              successorOperation: successorWork.operation
                ? structuredClone(successorWork.operation)
                : undefined,
              successorRunSnapshot: structuredClone(command.successorRunSnapshot),
              successorSnapshot: structuredClone(command.successorSnapshot),
            });
          }
        }
        // Lineage guard: the successor run must have been executed against a snapshot
        // that belongs to this project's declared thread lineage. This prevents
        // cross-project runs from being used as reconciliation successors.
        {
          const lineageIds = new Set(draft.threadSnapshots.map((s) => s.snapshotId));
          const successorBaseId = successor.baseSnapshot?.snapshotId ??
            (successor.basis?.kind === "thread-snapshot"
              ? successor.basis.snapshotId
              : successor.basis?.kind === "approved-brief"
              ? successor.basis.projectSnapshotId
              : undefined);
          if (!successorBaseId || !lineageIds.has(successorBaseId)) {
            invalidInput(
              `Successor run ${successor.id} was not executed against this project's ` +
                "declared thread lineage.",
            );
          }
        }
        if (command.successorSnapshot !== undefined) {
          addThreadSnapshot(draft, command.successorSnapshot);
        }
        failedWork.status = "cancelled";
        failedWork.reconciliation = {
          kind: "superseded-by-successor",
          reconciledAt: appliedAt,
          reconciledBy: actor(origin),
          failedRunId: failedRun.id,
          successorRunId: successor.id,
          successorRunSnapshot: structuredClone(command.successorRunSnapshot),
          ...(command.successorSnapshot !== undefined
            ? { successorSnapshot: structuredClone(command.successorSnapshot) }
            : {}),
          successorEvidenceRefs: structuredClone([...command.successorEvidenceRefs]),
          rationale: command.rationale,
        };
        recomputeWorkReadiness(draft);
      },
    );
  }

  /**
   * Human-only governed abandonment for work items that never acquired a
   * provider run and their associated pending or required decisions.
   *
   * Every listed work item must be in `ready` or `waiting-for-decision` with
   * no associated agent runs and no evidence refs. Every listed decision must
   * be in `required` or `proposed`. The resulting snapshot marks each target
   * as `abandoned`, revoking any pending approval for an abandoned proposed
   * decision. History remains intact; active views derive the exclusion from
   * the status field.
   */
  abandonWorkItems(
    origin: EngineeringProjectCommandOrigin,
    command: AbandonWorkItemsCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "work-item.abandon",
      command,
      (draft, appliedAt) => {
        if (!Array.isArray(command.workItemIds) || command.workItemIds.length === 0) {
          invalidInput("At least one workItemId is required.");
        }
        nonEmpty(command.rationale, "rationale");

        for (const workItemId of command.workItemIds) {
          if (typeof workItemId !== "string" || !workItemId.trim()) {
            invalidInput(`Invalid workItemId value: ${String(workItemId)}.`);
          }
          const work = findWorkItem(draft, workItemId);
          if (!work) notFound("work item", workItemId);
          if (work.status !== "ready" && work.status !== "waiting-for-decision") {
            invalidTransition(
              `Work item ${work.id} has status ${work.status}; only ready or waiting-for-decision items without runs can be abandoned.`,
            );
          }
          if (draft.agentRuns.some((run) => run.workItemId === work.id)) {
            invalidTransition(
              `Work item ${work.id} has an associated run and cannot be abandoned.`,
            );
          }
          if (work.evidenceRefs.length > 0) {
            invalidTransition(
              `Work item ${work.id} carries evidence refs and cannot be abandoned.`,
            );
          }
          work.status = "abandoned";
        }

        for (const decisionId of command.decisionIds ?? []) {
          if (typeof decisionId !== "string" || !decisionId.trim()) {
            invalidInput(`Invalid decisionId value: ${String(decisionId)}.`);
          }
          const decision = findDecision(draft, decisionId);
          if (!decision) notFound("decision", decisionId);
          if (decision.status !== "required" && decision.status !== "proposed") {
            invalidTransition(
              `Decision ${decision.id} has status ${decision.status}; only required or proposed decisions can be abandoned.`,
            );
          }
          // Revoke any pending approval to keep the approval ledger consistent.
          if (decision.status === "proposed") {
            const pendingApproval = [...decision.approvalIds].reverse().map((id) =>
              draft.approvals.find((approval) => approval.id === id)
            ).find((approval) => approval?.status === "pending");
            if (pendingApproval) {
              pendingApproval.status = "revoked";
              pendingApproval.decidedAt = appliedAt;
              pendingApproval.decidedBy = origin.actorId;
              pendingApproval.decidedByOrigin = origin.kind;
              pendingApproval.rationale = command.rationale;
            }
          }
          decision.status = "abandoned";
        }

        recomputeWorkReadiness(draft);
      },
    );
  }

  private decide(
    origin: EngineeringProjectCommandOrigin,
    type: "decision.approve" | "decision.reject",
    command: DecideDecisionCommand,
    status: "approved" | "rejected",
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, type, command, (draft, appliedAt) => {
      applyDecideDecision(draft, appliedAt, origin, command, status);
    });
  }

  private runTransition(
    origin: EngineeringProjectCommandOrigin,
    type: EngineeringProjectCommandName,
    command: RunCommand,
    allowed: readonly EngineeringAgentRunStatus[],
    status: EngineeringAgentRunStatus,
    update: (
      run: Mutable<EngineeringAgentRun>,
      appliedAt: string,
      draft: Mutable<EngineeringProjectSnapshot>,
    ) => void | Promise<void> = () => {},
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, type, command, async (draft, appliedAt) => {
      await applyOrdinaryRunTransition(
        draft,
        appliedAt,
        origin,
        type,
        command,
        allowed,
        status,
        this.planning,
        update,
      );
    });
  }

  private async apply<T extends EngineeringProjectCommandInput>(
    origin: EngineeringProjectCommandOrigin,
    type: EngineeringProjectCommandName,
    command: T,
    update: (
      draft: Mutable<EngineeringProjectSnapshot>,
      appliedAt: string,
    ) => void | Promise<void>,
  ): Promise<EngineeringProjectSnapshot> {
    validateCommandContext(origin, command);
    assertAllowed(origin.kind, type);
    const issuedAt = normalizeIsoDateTime(command.issuedAt)!;
    const normalizedCommand = { ...command, issuedAt };
    const fingerprintCommand = type === "agent-run.cancel"
      ? cancellationFingerprintCommand(
        command,
        issuedAt,
      )
      : normalizedCommand;
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command: fingerprintCommand,
    });
    const current = await this.store.get(command.projectId);
    if (!current) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${command.projectId} does not exist.`,
      );
    }
    const replayFingerprints = await reconciliationReplayFingerprints(
      current,
      type,
      origin,
      normalizedCommand,
      requestFingerprint,
    );
    const replay = await this.replay(
      current,
      command.commandId,
      replayFingerprints,
    );
    if (replay) return replay;
    if (current.revision !== command.expectedRevision) {
      throw stale(command.projectId, command.expectedRevision, current.revision);
    }
    const appliedAt = normalizeIsoDateTime(this.now());
    if (
      !appliedAt ||
      Date.parse(appliedAt) < Date.parse(current.generatedAt)
    ) {
      invalidInput("The authoritative service clock is invalid or moved backwards.");
    }
    const draft = structuredClone(current) as Mutable<EngineeringProjectSnapshot>;
    await update(draft, appliedAt);
    const revision = current.revision + 1;
    const snapshotId = `${current.project.id}:project:r${revision}:${
      requestFingerprint.digest.slice(0, 16)
    }`;
    draft.id = snapshotId;
    draft.revision = revision;
    draft.previous = { snapshotId: current.id, revision: current.revision };
    draft.generatedAt = appliedAt;
    const queuedRun = type === "agent-run.queue"
      ? queuedRunReceiptBinding(draft, command.commandId)
      : undefined;
    const cancelledRun = type === "agent-run.cancel"
      ? cancelledRunReceiptBinding(draft, command.commandId)
      : undefined;
    draft.commandReceipts ??= [];
    draft.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: actor(origin),
      issuedAt,
      appliedAt,
      requestFingerprint,
      resultingSnapshot: { snapshotId, revision },
      ...(queuedRun ? { queuedRun } : {}),
      ...(cancelledRun ? { cancelledRun } : {}),
    });
    const next = validateEngineeringProjectSnapshot(draft);
    try {
      return await this.store.commit(next, current.revision);
    } catch (error) {
      if (!(error instanceof EngineeringProjectStoreConflictError)) throw error;
      const winner = await this.store.get(command.projectId);
      if (winner) {
        const concurrentReplay = await this.replay(
          winner,
          command.commandId,
          await reconciliationReplayFingerprints(
            winner,
            type,
            origin,
            normalizedCommand,
            requestFingerprint,
          ),
        );
        if (concurrentReplay) return concurrentReplay;
        throw stale(command.projectId, command.expectedRevision, winner.revision);
      }
      throw error;
    }
  }

  private async replay(
    current: EngineeringProjectSnapshot,
    commandId: string,
    fingerprints: readonly ContentFingerprint[],
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const receipt = current.commandReceipts?.find((item) =>
      item.commandId === commandId
    );
    if (!receipt) return undefined;
    if (
      !fingerprints.some((fingerprint) =>
        fingerprintsEqual(receipt.requestFingerprint, fingerprint)
      )
    ) {
      throw new EngineeringProjectCommandError(
        "command_id_conflict",
        `Command id ${commandId} was already used for a different request.`,
      );
    }
    const result = await this.store.getRevision(
      current.project.id,
      receipt.resultingSnapshot.revision,
    );
    if (!result || result.id !== receipt.resultingSnapshot.snapshotId) {
      throw new EngineeringProjectCommandError(
        "command_id_conflict",
        `Command id ${commandId} has an invalid immutable result receipt.`,
      );
    }
    return result;
  }
}

/**
 * Preserve immutable replay across the server-stamped provenance upgrade.
 * Old commands carried the complete annotation, including an adapter clock;
 * only an already-persisted annotation may reconstruct that legacy fingerprint.
 */
async function reconciliationReplayFingerprints(
  current: EngineeringProjectSnapshot,
  type: EngineeringProjectCommandName,
  origin: EngineeringProjectCommandOrigin,
  command: EngineeringProjectCommandInput,
  currentFingerprint: ContentFingerprint,
): Promise<readonly ContentFingerprint[]> {
  if (type !== "agent-run.reconcile-annotation") return [currentFingerprint];
  const input = command as unknown as ReconcileAnnotationRunCommand;
  const annotation = current.agentRuns.find((run) => run.id === input.failedRunId)
    ?.uncertainWriterReconciliation;
  if (!annotation) return [currentFingerprint];
  if (
    input.decisionId !== annotation.decisionId ||
    input.outcome !== annotation.outcome ||
    input.providerInspectionAttestation !==
      annotation.providerInspectionAttestation
  ) {
    return [currentFingerprint];
  }
  const legacyFingerprint = await sha256Fingerprint({
    type,
    origin,
    command: {
      commandId: input.commandId,
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      issuedAt: input.issuedAt,
      reconciliationRunId: input.reconciliationRunId,
      failedRunId: input.failedRunId,
      reconciliation: structuredClone(
        annotation,
      ) as EngineeringAgentRunUncertainWriterReconciliation,
    },
  });
  return [currentFingerprint, legacyFingerprint];
}

/** Keep server-stamped receipt fields outside the caller's idempotency payload. */
function cancellationFingerprintCommand(
  command: CancellationFingerprintInput,
  issuedAt: string,
): {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId?: string;
  readonly rationale?: string;
} {
  return {
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    issuedAt,
    runId: command.runId,
    rationale: command.rationale,
  };
}

function queuedRunReceiptBinding(
  draft: EngineeringProjectSnapshot,
  queueCommandId: string,
): EngineeringQueuedRunReceiptBinding {
  const candidates = draft.agentRuns.filter((run) =>
    run.status === "queued" &&
    run.statusHistory?.[0]?.status === "queued" &&
    run.statusHistory?.[0]?.commandId === queueCommandId
  );
  if (candidates.length !== 1) {
    invalidTransition(
      "A queue receipt must resolve to exactly one server-queued agent run.",
    );
  }
  const run = candidates[0]!;
  return {
    runId: run.id,
    workItemId: run.workItemId,
    ...(run.resolvedOperationPlan
      ? { resolvedOperationPlan: structuredClone(run.resolvedOperationPlan) }
      : {}),
  };
}

function cancelledRunReceiptBinding(
  draft: EngineeringProjectSnapshot,
  cancellationCommandId: string,
): EngineeringCancelledRunReceiptBinding {
  const candidates = draft.agentRuns.filter((run) =>
    run.status === "cancelled" &&
    run.statusHistory?.at(-1)?.commandId === cancellationCommandId
  );
  if (candidates.length !== 1) {
    invalidTransition(
      "A cancellation receipt must resolve to exactly one server-cancelled agent run.",
    );
  }
  const run = candidates[0]!;
  const queuedTransition = run.statusHistory?.[0];
  if (!queuedTransition || queuedTransition.status !== "queued") {
    invalidTransition(
      `Cancelled agent run ${run.id} has no exact initial queued transition.`,
    );
  }
  return {
    runId: run.id,
    workItemId: run.workItemId,
    queuedCommandId: queuedTransition.commandId,
  };
}

function validateCommandContext(
  origin: EngineeringProjectCommandOrigin,
  command: EngineeringProjectCommandInput,
): void {
  nonEmpty(origin.actorId, "origin.actorId");
  nonEmpty(command.commandId, "commandId");
  nonEmpty(command.projectId, "projectId");
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
    invalidInput("expectedRevision must be a positive integer.");
  }
  if (!normalizeIsoDateTime(command.issuedAt)) {
    invalidInput("issuedAt must be an ISO datetime.");
  }
}

function normalizeIsoDateTime(value: string): string | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value)
  ) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
