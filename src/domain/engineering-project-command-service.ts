import {
  type EngineeringAgentRun,
  type EngineeringAgentRunStatus,
  type EngineeringApproval,
  type EngineeringCommandActor,
  type EngineeringCommandOriginKind,
  type EngineeringDecision,
  type EngineeringDecisionProposalParameter,
  type EngineeringOperationInputBinding,
  type EngineeringOperationRef,
  type EngineeringProjectCommandName,
  type EngineeringProjectPhase,
  type EngineeringProjectPlan,
  type EngineeringProjectSnapshot,
  type EngineeringProjectStartingPoint,
  type EngineeringThreadEntityRef,
  type EngineeringThreadSnapshotRef,
  type EngineeringWorkItem,
  type EngineeringWorkOwner,
} from "./engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "./engineering-project-validation.ts";
import { fingerprintsEqual, sha256Fingerprint } from "./deterministic-json.ts";
import type { ContentFingerprint } from "./thread-snapshot.ts";
import type { ProjectDiscoveryRevisionStore } from "./project-discovery-command-service.ts";
import type { ProjectDiscoverySnapshot } from "./project-discovery.ts";

export interface EngineeringProjectRevisionStore {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot>;
  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot>;
}

export class EngineeringProjectStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineeringProjectStoreConflictError";
  }
}

export type EngineeringProjectCommandErrorCode =
  | "project_not_found"
  | "stale_revision"
  | "command_id_conflict"
  | "permission_denied"
  | "invalid_transition"
  | "invalid_input"
  | "approval_scope_mismatch"
  | "entity_not_found";

export class EngineeringProjectCommandError extends Error {
  readonly httpStatus: 403 | 404 | 409 | 422;

  constructor(
    readonly code: EngineeringProjectCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineeringProjectCommandError";
    this.httpStatus = code === "permission_denied"
      ? 403
      : code === "project_not_found" || code === "entity_not_found"
      ? 404
      : code === "stale_revision" || code === "command_id_conflict"
      ? 409
      : 422;
  }
}

export interface EngineeringProjectCommandOrigin {
  readonly kind: EngineeringCommandOriginKind;
  readonly actorId: string;
}

export interface EngineeringDecisionProposalInput {
  readonly summary: string;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
}

export interface EngineeringProjectCommandInput {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  /** Client-provided audit metadata; never used as authoritative state time. */
  readonly issuedAt: string;
}

export interface ProposeDecisionCommand extends EngineeringProjectCommandInput {
  readonly decisionId: string;
  readonly proposal: EngineeringDecisionProposalInput;
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
}

export interface DecideDecisionCommand extends EngineeringProjectCommandInput {
  readonly decisionId: string;
  readonly rationale: string;
  /** The exact proposal binding displayed to the human reviewer. */
  readonly inputFingerprint: ContentFingerprint;
}

export interface QueueRunCommand extends EngineeringProjectCommandInput {
  readonly runId: string;
  readonly workItemId: string;
  readonly summary: string;
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
}

export interface RunCommand extends EngineeringProjectCommandInput {
  readonly runId: string;
  readonly summary: string;
}

export interface CompleteRunCommand extends RunCommand {
  readonly resultSnapshot: EngineeringThreadSnapshotRef;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
}

export interface FailRunCommand extends RunCommand {
  readonly code: string;
  readonly message: string;
}

export interface PublishProjectPlanCommand extends EngineeringProjectCommandInput {
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly phases: readonly PlannedEngineeringProjectPhase[];
  readonly workItems: readonly PlannedEngineeringWorkItem[];
  readonly requiredDecisions: readonly PlannedEngineeringDecision[];
}

/** The agent declares only structure; the service derives membership and order. */
export interface PlannedEngineeringProjectPhase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** A safe operation reference, not a provider/tool invocation. */
export interface PlannedEngineeringWorkItem {
  readonly id: string;
  readonly phaseId: string;
  readonly owner: EngineeringWorkOwner;
  readonly dependsOnWorkItemIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly operation: EngineeringOperationRef;
}

export interface PlannedEngineeringDecision {
  readonly id: string;
  readonly phaseId: string;
  readonly title: string;
  readonly question: string;
}

/**
 * Narrow adapter over the code-owned operation registry. The plan service
 * cannot receive provider names, tool arguments or executable workflows.
 */
export interface EngineeringProjectPlanOperationRegistry {
  validate(input: {
    readonly operation: EngineeringOperationRef;
    readonly basisKind: "approved-discovery";
  }): {
    readonly operation: {
      readonly id: string;
      readonly version: string;
      readonly startingPoint: EngineeringProjectStartingPoint;
      readonly title: string;
      readonly description: string;
      readonly workItemKind: EngineeringWorkItem["kind"];
    };
    readonly bindings: readonly EngineeringOperationInputBinding[];
  };
}

export interface EngineeringProjectPlanningDependencies {
  readonly discoveries: Pick<ProjectDiscoveryRevisionStore, "getRevision">;
  readonly operations: EngineeringProjectPlanOperationRegistry;
}

export interface EngineeringProjectCompletionEvidenceValidator {
  validate(
    baseSnapshot: EngineeringThreadSnapshotRef,
    resultSnapshot: EngineeringThreadSnapshotRef,
    evidenceRefs: readonly EngineeringThreadEntityRef[],
  ): Promise<void>;
}

export const ENGINEERING_PROJECT_COMMAND_POLICY = {
  human: [
    "decision.propose",
    "decision.approve",
    "decision.reject",
    "agent-run.queue",
  ],
  agent: [
    "project.plan-publish",
    "decision.propose",
    "agent-run.claim",
    "agent-run.progress",
    "agent-run.publish",
    "agent-run.complete",
    "agent-run.fail",
  ],
} as const;

type EngineeringProjectCommandType = EngineeringProjectCommandName;

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
  ) {}

  /**
   * Persist a bounded, agent-authored project path after an exact approved
   * discovery handoff. This is planning only: it neither approves anything,
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
      async (draft, appliedAt) => {
        const planning = this.planning;
        if (!planning) {
          invalidInput(
            "Project-plan publication is unavailable because no reviewed operation registry is configured.",
          );
        }
        assertPlanningCanChange(draft);
        validatePlanCommand(command);
        const handoff = draft.discoveryHandoff;
        if (!handoff) {
          invalidTransition(
            "Only a project created from an approved discovery can receive an initial agent plan.",
          );
        }
        const discovery = await planning.discoveries.getRevision(
          handoff.discoveryId,
          handoff.revision,
        );
        const exactDiscovery = assertExactApprovedDiscoveryHandoff(draft, discovery);

        const phaseIds = new Set(command.phases.map((phase) => phase.id));
        const workItemIds = new Set(command.workItems.map((workItem) => workItem.id));
        const decisionsById = new Map(
          command.requiredDecisions.map((decision) => [decision.id, decision]),
        );
        const decisionIds = new Set(
          command.requiredDecisions.map((decision) => decision.id),
        );
        const resolvedWorkItems = command.workItems.map((item) => {
          const resolved = resolvePlanOperation(planning.operations, item.operation);
          if (resolved.operation.startingPoint !== command.startingPoint) {
            invalidInput(
              `Operation ${resolved.operation.id}@${resolved.operation.version} is not registered for ${command.startingPoint}.`,
            );
          }
          assertPlanBindingsResolveToDiscovery(resolved.bindings, exactDiscovery);
          assertPlanWorkItemReferences(
            item,
            phaseIds,
            workItemIds,
            decisionIds,
            decisionsById,
          );
          return {
            ...item,
            title: resolved.operation.title,
            description: resolved.operation.description,
            kind: resolved.operation.workItemKind,
            operation: {
              id: resolved.operation.id,
              version: resolved.operation.version,
              bindings: structuredClone(resolved.bindings) as Mutable<
                EngineeringOperationInputBinding
              >[],
            },
          };
        });
        assertPlanDependenciesAreAcyclic(resolvedWorkItems);

        const decisions = command.requiredDecisions.map((decision) => ({
          id: decision.id,
          phaseId: decision.phaseId,
          title: decision.title,
          question: decision.question,
          status: "required" as const,
          requestedAt: appliedAt,
          inputEvidenceRefs: [],
          approvalIds: [],
        }));
        const workItems = resolvedWorkItems.map((item) => ({
          id: item.id,
          phaseId: item.phaseId,
          title: item.title,
          description: item.description,
          kind: item.kind,
          operation: item.operation,
          status: item.decisionIds.length
            ? "waiting-for-decision" as const
            : "planned" as const,
          owner: item.owner,
          dependsOnWorkItemIds: [...item.dependsOnWorkItemIds],
          evidenceRefs: [],
          decisionIds: [...item.decisionIds],
          blockerIds: [],
        }));
        const phases = command.phases.map((phase, index) => ({
          id: phase.id,
          name: phase.name,
          order: index + 1,
          description: phase.description,
          workItemIds: workItems.filter((item) => item.phaseId === phase.id).map((
            item,
          ) => item.id),
          requiredDecisionIds: decisions.filter((item) => item.phaseId === phase.id)
            .map((item) => item.id),
          evidenceRefs: [],
        }));
        assertEveryPhaseHasWork(phases);

        const plan: EngineeringProjectPlan = {
          startingPoint: command.startingPoint,
          basis: {
            kind: "approved-discovery",
            discoveryId: handoff.discoveryId,
            snapshotId: handoff.snapshotId,
            revision: handoff.revision,
            briefId: handoff.briefId,
            approvedBriefFingerprint: structuredClone(handoff.approvedBriefFingerprint),
          },
          publishedAt: appliedAt,
          publishedBy: actor(origin),
        };
        draft.plan = plan;
        draft.phases = phases;
        draft.workItems = workItems;
        draft.decisions = decisions;
        draft.approvals = [];
        draft.blockers = [];
        draft.agentRuns = [];
      },
    );
  }

  proposeDecision(
    origin: EngineeringProjectCommandOrigin,
    command: ProposeDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, "decision.propose", command, async (draft, appliedAt) => {
      const decision = findDecision(draft, command.decisionId);
      if (!decision) notFound("decision", command.decisionId);
      if (decision.status !== "required" && decision.status !== "rejected") {
        invalidTransition(
          `Decision ${decision.id} cannot be proposed from ${decision.status}.`,
        );
      }
      assertDeclaredSnapshot(draft, command.baseSnapshot);
      validateProposalInput(command.proposal);
      const proposal = {
        summary: command.proposal.summary,
        parameters: [...structuredClone(command.proposal.parameters)],
        proposedAt: appliedAt,
        proposedBy: actor(origin),
      };
      const inputFingerprint = await sha256Fingerprint({
        baseSnapshot: command.baseSnapshot,
        inputEvidenceRefs: decision.inputEvidenceRefs,
        proposal: command.proposal,
      });
      const approvalId = `approval:${decision.id}:${command.commandId}`;
      const approval: Mutable<EngineeringApproval> = {
        id: approvalId,
        decisionId: decision.id,
        status: "pending",
        requestedAt: appliedAt,
        baseSnapshot: structuredClone(command.baseSnapshot),
        inputFingerprint,
        inputEvidenceRefs: structuredClone(decision.inputEvidenceRefs),
      };
      draft.approvals.push(approval);
      decision.status = "proposed";
      decision.baseSnapshot = structuredClone(command.baseSnapshot);
      decision.inputFingerprint = inputFingerprint;
      decision.proposal = proposal;
      decision.approvalIds.push(approvalId);
      recomputeWorkReadiness(draft);
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
    return this.apply(origin, "agent-run.queue", command, async (draft, appliedAt) => {
      nonEmpty(command.runId, "runId");
      nonEmpty(command.summary, "summary");
      if (draft.agentRuns.some((run) => run.id === command.runId)) {
        invalidInput(`Agent run id ${command.runId} already exists.`);
      }
      const workItem = findWorkItem(draft, command.workItemId);
      if (!workItem) notFound("work item", command.workItemId);
      if (workItem.status !== "ready") {
        invalidTransition(
          `Work item ${workItem.id} must be ready before a run can be queued.`,
        );
      }
      if (
        draft.agentRuns.some((run) =>
          run.workItemId === workItem.id && isActiveRunStatus(run.status)
        )
      ) {
        invalidTransition(`Work item ${workItem.id} already has an active run.`);
      }
      assertDeclaredSnapshot(draft, command.baseSnapshot);
      const decisionBindings = workItem.decisionIds.map((id) => {
        const decision = findDecision(draft, id);
        if (!decision || decision.status !== "approved" || !decision.inputFingerprint) {
          invalidTransition(`Work item decision ${id} is not approved.`);
        }
        return { id, inputFingerprint: decision.inputFingerprint };
      });
      const inputFingerprint = await sha256Fingerprint({
        workItemId: workItem.id,
        baseSnapshot: command.baseSnapshot,
        decisionBindings,
      });
      const queued: Mutable<EngineeringAgentRun> = {
        id: command.runId,
        workItemId: workItem.id,
        status: "queued",
        summary: command.summary,
        queuedAt: appliedAt,
        baseSnapshot: structuredClone(command.baseSnapshot),
        inputFingerprint,
        evidenceRefs: [],
        statusHistory: [transition(command, origin, "queued", appliedAt)],
      };
      draft.agentRuns.push(queued);
      workItem.status = "in-progress";
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
        run.claimedAt = appliedAt;
        run.claimedBy = actor(origin);
        run.startedAt = appliedAt;
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
        if (!run.baseSnapshot) {
          invalidInput(
            `Agent run ${run.id} has no exact base snapshot; completion is unsafe.`,
          );
        }
        assertResultAdvancesBase(run.baseSnapshot, command.resultSnapshot);
        assertExactResultEvidence(draft, command.resultSnapshot, command.evidenceRefs);
        if (!this.evidenceValidator) {
          invalidInput(
            "Completion evidence validation is unavailable; refusing to publish unverified refs.",
          );
        }
        await this.evidenceValidator.validate(
          run.baseSnapshot,
          command.resultSnapshot,
          command.evidenceRefs,
        );
        addThreadSnapshot(draft, command.resultSnapshot);
        run.completedAt = appliedAt;
        run.resultSnapshot = structuredClone(command.resultSnapshot);
        run.evidenceRefs = [...structuredClone(command.evidenceRefs)];
        const workItem = findWorkItem(draft, run.workItemId)!;
        workItem.status = "completed";
        workItem.evidenceRefs = [...structuredClone(command.evidenceRefs)];
        const phase = draft.phases.find((item) => item.id === workItem.phaseId)!;
        phase.evidenceRefs = mergeEvidence(
          phase.evidenceRefs,
          command.evidenceRefs,
        );
        recomputeWorkReadiness(draft);
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
        nonEmpty(command.code, "code");
        nonEmpty(command.message, "message");
        run.completedAt = appliedAt;
        run.failure = { code: command.code, message: command.message };
        delete run.waitingForDecisionIds;
        const workItem = findWorkItem(draft, run.workItemId)!;
        workItem.status = nextIdleWorkStatus(draft, workItem);
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
      nonEmpty(command.rationale, "rationale");
      const decision = findDecision(draft, command.decisionId);
      if (!decision) notFound("decision", command.decisionId);
      if (decision.status !== "proposed" || !decision.inputFingerprint) {
        invalidTransition(`Decision ${decision.id} is not awaiting approval.`);
      }
      if (!fingerprintsEqual(decision.inputFingerprint, command.inputFingerprint)) {
        throw new EngineeringProjectCommandError(
          "approval_scope_mismatch",
          `Decision ${decision.id} proposal fingerprint no longer matches the reviewed input.`,
        );
      }
      const approval = [...decision.approvalIds].reverse().map((id) =>
        draft.approvals.find((candidate) => candidate.id === id)
      ).find((candidate) => candidate?.status === "pending");
      if (!approval) {
        invalidTransition(`Decision ${decision.id} has no pending approval.`);
      }
      approval.status = status;
      approval.decidedAt = appliedAt;
      approval.decidedBy = origin.actorId;
      approval.decidedByOrigin = origin.kind;
      approval.rationale = command.rationale;
      decision.status = status;
      if (status === "approved") resolveSatisfiedBlockers(draft, appliedAt);
      recomputeWorkReadiness(draft);
    });
  }

  private runTransition(
    origin: EngineeringProjectCommandOrigin,
    type: EngineeringProjectCommandType,
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
      nonEmpty(command.summary, "summary");
      const run = draft.agentRuns.find((candidate) => candidate.id === command.runId);
      if (!run) notFound("agent run", command.runId);
      if (!allowed.includes(run.status)) {
        invalidTransition(
          `Agent run ${run.id} cannot transition from ${run.status} to ${status}.`,
        );
      }
      if (
        run.status !== "queued" &&
        (run.claimedBy?.origin !== origin.kind ||
          run.claimedBy.id !== origin.actorId)
      ) {
        throw new EngineeringProjectCommandError(
          "permission_denied",
          `Agent run ${run.id} is claimed by ${
            run.claimedBy?.id ?? "nobody"
          }; implicit handoff is forbidden.`,
        );
      }
      await update(run, appliedAt, draft);
      run.status = status;
      run.summary = command.summary;
      run.statusHistory ??= [];
      run.statusHistory.push(transition(command, origin, status, appliedAt));
    });
  }

  private async apply<T extends EngineeringProjectCommandInput>(
    origin: EngineeringProjectCommandOrigin,
    type: EngineeringProjectCommandType,
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
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command: normalizedCommand,
    });
    const current = await this.store.get(command.projectId);
    if (!current) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${command.projectId} does not exist.`,
      );
    }
    const replay = await this.replay(current, command.commandId, requestFingerprint);
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
    draft.commandReceipts ??= [];
    draft.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: actor(origin),
      issuedAt,
      appliedAt,
      requestFingerprint,
      resultingSnapshot: { snapshotId, revision },
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
          requestFingerprint,
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
    fingerprint: ContentFingerprint,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const receipt = current.commandReceipts?.find((item) =>
      item.commandId === commandId
    );
    if (!receipt) return undefined;
    if (!fingerprintsEqual(receipt.requestFingerprint, fingerprint)) {
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

function assertPlanningCanChange(draft: EngineeringProjectSnapshot): void {
  if (!draft.discoveryHandoff) {
    invalidTransition(
      "Only a project created from an approved discovery can receive an initial agent plan.",
    );
  }
  if (draft.threadSnapshots.length > 0) {
    invalidTransition(
      "A project plan cannot be replaced after technical evidence exists; publish a new reviewed change instead.",
    );
  }
  if (
    draft.agentRuns.length > 0 || draft.approvals.length > 0 ||
    draft.blockers.length > 0
  ) {
    invalidTransition(
      "A project plan cannot be replaced after run, approval or blocker state exists.",
    );
  }
  if (
    draft.workItems.some((item) =>
      item.status === "in-progress" || item.status === "completed" ||
      item.status === "cancelled" || item.evidenceRefs.length > 0
    ) ||
    draft.phases.some((phase) => phase.evidenceRefs.length > 0) ||
    draft.decisions.some((decision) => decision.status !== "required")
  ) {
    invalidTransition(
      "A project plan cannot be replaced after work, evidence or a concrete decision proposal exists.",
    );
  }
}

function validatePlanCommand(command: PublishProjectPlanCommand): void {
  if (
    command.startingPoint !== "idea-or-spec" &&
    command.startingPoint !== "existing-cad" &&
    command.startingPoint !== "existing-product"
  ) {
    invalidInput("startingPoint must be an approved project entry path.");
  }
  if (!Array.isArray(command.phases) || command.phases.length === 0) {
    invalidInput("phases must contain at least one declared project phase.");
  }
  if (!Array.isArray(command.workItems) || command.workItems.length === 0) {
    invalidInput("workItems must contain at least one bounded operation.");
  }
  if (!Array.isArray(command.requiredDecisions)) {
    invalidInput("requiredDecisions must be an array.");
  }
  uniquePlanIds(command.phases.map((phase) => phase.id), "phase");
  uniquePlanIds(command.workItems.map((item) => item.id), "work item");
  uniquePlanIds(command.requiredDecisions.map((decision) => decision.id), "decision");
  for (const [index, phase] of command.phases.entries()) {
    nonEmpty(phase.id, `phases[${index}].id`);
    nonEmpty(phase.name, `phases[${index}].name`);
    nonEmpty(phase.description, `phases[${index}].description`);
  }
  for (const [index, item] of command.workItems.entries()) {
    nonEmpty(item.id, `workItems[${index}].id`);
    nonEmpty(item.phaseId, `workItems[${index}].phaseId`);
    if (!isEngineeringWorkOwner(item.owner)) {
      invalidInput(`workItems[${index}].owner must be human, agent or shared.`);
    }
    if (!Array.isArray(item.dependsOnWorkItemIds) || !Array.isArray(item.decisionIds)) {
      invalidInput(
        `workItems[${index}].dependsOnWorkItemIds and decisionIds must be arrays.`,
      );
    }
    uniquePlanIds(item.dependsOnWorkItemIds, `workItems[${index}] dependency`);
    uniquePlanIds(item.decisionIds, `workItems[${index}] decision`);
  }
  for (const [index, decision] of command.requiredDecisions.entries()) {
    nonEmpty(decision.id, `requiredDecisions[${index}].id`);
    nonEmpty(decision.phaseId, `requiredDecisions[${index}].phaseId`);
    nonEmpty(decision.title, `requiredDecisions[${index}].title`);
    nonEmpty(decision.question, `requiredDecisions[${index}].question`);
  }
}

function assertExactApprovedDiscoveryHandoff(
  project: EngineeringProjectSnapshot,
  discovery: ProjectDiscoverySnapshot | undefined,
): ProjectDiscoverySnapshot {
  const handoff = project.discoveryHandoff!;
  if (
    !discovery || discovery.discoveryId !== handoff.discoveryId ||
    discovery.id !== handoff.snapshotId || discovery.revision !== handoff.revision
  ) {
    invalidInput(
      "The exact discovery revision recorded by this project handoff is unavailable.",
    );
  }
  if (
    discovery.status !== "approved" || !discovery.brief || !discovery.review ||
    discovery.brief.id !== handoff.briefId ||
    discovery.review.status !== "approved" ||
    discovery.review.briefId !== handoff.briefId ||
    discovery.review.decidedAt !== handoff.approvedAt ||
    discovery.review.decidedBy?.origin !== "human" ||
    discovery.review.decidedBy?.id !== handoff.approvedBy.id ||
    !fingerprintsEqual(
      discovery.review.inputFingerprint,
      handoff.approvedBriefFingerprint,
    )
  ) {
    invalidInput(
      "The recorded discovery handoff no longer resolves to the exact human-approved brief.",
    );
  }
  return discovery;
}

function resolvePlanOperation(
  operations: EngineeringProjectPlanOperationRegistry,
  operation: EngineeringOperationRef,
): ReturnType<EngineeringProjectPlanOperationRegistry["validate"]> {
  try {
    return operations.validate({ operation, basisKind: "approved-discovery" });
  } catch (error) {
    invalidInput(
      error instanceof Error
        ? `Project operation is not accepted by the reviewed registry: ${error.message}`
        : "Project operation is not accepted by the reviewed registry.",
    );
  }
}

function assertPlanBindingsResolveToDiscovery(
  bindings: readonly EngineeringOperationInputBinding[],
  discovery: ProjectDiscoverySnapshot,
): void {
  for (const binding of bindings) {
    if (binding.source.kind !== "discovery-answer") continue;
    const answerId = binding.source.answerId;
    const answer = discovery.answers.find((item) => item.id === answerId);
    if (
      !answer || answer.kind !== "provided" ||
      discovery.answers.some((item) => item.supersedesAnswerId === answer.id)
    ) {
      invalidInput(
        `Operation binding ${binding.name} must reference one current provided answer from the approved discovery.`,
      );
    }
  }
}

function assertPlanWorkItemReferences(
  item: PlannedEngineeringWorkItem,
  phaseIds: ReadonlySet<string>,
  workItemIds: ReadonlySet<string>,
  decisionIds: ReadonlySet<string>,
  decisionsById: ReadonlyMap<string, PlannedEngineeringDecision>,
): void {
  if (!phaseIds.has(item.phaseId)) {
    invalidInput(`Work item ${item.id} references an unknown phase ${item.phaseId}.`);
  }
  for (const dependencyId of item.dependsOnWorkItemIds) {
    if (dependencyId === item.id || !workItemIds.has(dependencyId)) {
      invalidInput(
        `Work item ${item.id} must depend only on another declared work item.`,
      );
    }
  }
  for (const decisionId of item.decisionIds) {
    const decision = decisionsById.get(decisionId);
    if (
      !decisionIds.has(decisionId) || !decision || decision.phaseId !== item.phaseId
    ) {
      invalidInput(
        `Work item ${item.id} must reference a declared decision in the same phase.`,
      );
    }
  }
}

function assertPlanDependenciesAreAcyclic(
  workItems: readonly Pick<PlannedEngineeringWorkItem, "id" | "dependsOnWorkItemIds">[],
): void {
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      invalidInput(`Project plan dependency cycle includes work item ${id}.`);
    }
    visiting.add(id);
    for (const dependencyId of byId.get(id)?.dependsOnWorkItemIds ?? []) {
      visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of workItems) visit(item.id);
}

function assertEveryPhaseHasWork(
  phases: readonly Pick<EngineeringProjectPhase, "id" | "workItemIds">[],
): void {
  for (const phase of phases) {
    if (phase.workItemIds.length === 0) {
      invalidInput(`Project phase ${phase.id} must contain at least one work item.`);
    }
  }
}

function uniquePlanIds(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (seen.has(value)) invalidInput(`${label} id ${value} is duplicated.`);
    seen.add(value);
  }
}

function isEngineeringWorkOwner(value: unknown): value is EngineeringWorkOwner {
  return value === "human" || value === "agent" || value === "shared";
}

function transition(
  command: RunCommand,
  origin: EngineeringProjectCommandOrigin,
  status: EngineeringAgentRunStatus,
  at: string,
) {
  return {
    commandId: command.commandId,
    status,
    at,
    actor: actor(origin),
    summary: command.summary,
  };
}

function actor(origin: EngineeringProjectCommandOrigin): EngineeringCommandActor {
  return { id: origin.actorId, origin: origin.kind };
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

function validateProposalInput(proposal: EngineeringDecisionProposalInput): void {
  nonEmpty(proposal.summary, "proposal.summary");
  if (proposal.parameters.length === 0) {
    invalidInput("proposal.parameters must contain at least one typed parameter.");
  }
  const keys = new Set<string>();
  for (const [index, parameter] of proposal.parameters.entries()) {
    nonEmpty(parameter.key, `proposal.parameters[${index}].key`);
    nonEmpty(parameter.label, `proposal.parameters[${index}].label`);
    if (keys.has(parameter.key)) {
      invalidInput(`Proposal parameter key ${parameter.key} is duplicated.`);
    }
    keys.add(parameter.key);
    if (typeof parameter.value === "string") {
      nonEmpty(parameter.value, `proposal.parameters[${index}].value`);
    } else if (
      typeof parameter.value !== "boolean" &&
      (typeof parameter.value !== "number" || !Number.isFinite(parameter.value))
    ) {
      invalidInput(`Proposal parameter ${parameter.key} has an invalid value.`);
    }
    if (parameter.unit !== undefined) {
      nonEmpty(parameter.unit, `proposal.parameters[${index}].unit`);
      if (typeof parameter.value !== "number") {
        invalidInput(
          `Proposal parameter ${parameter.key} can only use a unit when numeric.`,
        );
      }
    }
  }
}

function assertAllowed(
  origin: EngineeringCommandOriginKind,
  type: EngineeringProjectCommandType,
): void {
  const allowed: readonly string[] = ENGINEERING_PROJECT_COMMAND_POLICY[origin];
  if (!allowed.includes(type)) {
    throw new EngineeringProjectCommandError(
      "permission_denied",
      `${origin} origin cannot execute ${type}.`,
    );
  }
}

function assertDeclaredSnapshot(
  draft: EngineeringProjectSnapshot,
  reference: EngineeringThreadSnapshotRef,
): void {
  if (reference.snapshotId.toLowerCase() === "latest") {
    invalidInput("Thread snapshot references cannot use latest aliases.");
  }
  if (reference.subjectId !== draft.project.subjectId) {
    invalidInput("Thread snapshot subject does not match the engineering project.");
  }
  if (
    !draft.threadSnapshots.some((candidate) =>
      candidate.snapshotId === reference.snapshotId &&
      candidate.revision === reference.revision &&
      candidate.subjectId === reference.subjectId
    )
  ) {
    invalidInput("Thread snapshot reference is not declared by this project revision.");
  }
}

function assertExactResultEvidence(
  draft: EngineeringProjectSnapshot,
  snapshot: EngineeringThreadSnapshotRef,
  evidenceRefs: readonly EngineeringThreadEntityRef[],
): void {
  if (!snapshot.snapshotId.trim() || snapshot.snapshotId.toLowerCase() === "latest") {
    invalidInput("Result snapshot must be an exact non-latest reference.");
  }
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
    invalidInput("Result snapshot revision must be a positive integer.");
  }
  if (snapshot.subjectId !== draft.project.subjectId) {
    invalidInput("Result snapshot subject does not match the engineering project.");
  }
  if (evidenceRefs.length === 0) {
    invalidInput("Completion requires exact evidence refs.");
  }
  const seen = new Set<string>();
  for (const reference of evidenceRefs) {
    if (
      reference.snapshotId !== snapshot.snapshotId ||
      reference.snapshotRevision !== snapshot.revision
    ) {
      invalidInput(
        "Every completion evidence ref must belong to the exact result snapshot.",
      );
    }
    const key = `${reference.kind}\u0000${reference.id}`;
    if (seen.has(key)) invalidInput("Completion evidence refs must be unique.");
    seen.add(key);
  }
}

function assertResultAdvancesBase(
  base: EngineeringThreadSnapshotRef,
  result: EngineeringThreadSnapshotRef,
): void {
  if (
    result.snapshotId === base.snapshotId ||
    result.revision <= base.revision
  ) {
    invalidInput(
      `Result snapshot ${result.snapshotId}@${result.revision} must be newer than run base ${base.snapshotId}@${base.revision}.`,
    );
  }
}

function addThreadSnapshot(
  draft: Mutable<EngineeringProjectSnapshot>,
  snapshot: EngineeringThreadSnapshotRef,
): void {
  const sameRevision = draft.threadSnapshots.find((candidate) =>
    candidate.subjectId === snapshot.subjectId &&
    candidate.revision === snapshot.revision
  );
  if (sameRevision) {
    if (sameRevision.snapshotId !== snapshot.snapshotId) {
      invalidInput(
        `Thread snapshot revision ${snapshot.revision} is already bound to ${sameRevision.snapshotId}.`,
      );
    }
    return;
  }
  if (
    draft.threadSnapshots.some((candidate) =>
      candidate.snapshotId === snapshot.snapshotId
    )
  ) {
    invalidInput(`Thread snapshot id ${snapshot.snapshotId} is already declared.`);
  }
  draft.threadSnapshots.push(structuredClone(snapshot));
}

function resolveSatisfiedBlockers(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
): void {
  for (const blocker of draft.blockers) {
    if (
      blocker.status === "open" && blocker.decisionIds.length > 0 &&
      blocker.decisionIds.every((id) => findDecision(draft, id)?.status === "approved")
    ) {
      blocker.status = "resolved";
      blocker.resolvedAt = appliedAt;
      blocker.resolution = `Resolved by approved decision${
        blocker.decisionIds.length === 1 ? "" : "s"
      }: ${blocker.decisionIds.join(", ")}.`;
    }
  }
}

function recomputeWorkReadiness(draft: Mutable<EngineeringProjectSnapshot>): void {
  for (const workItem of draft.workItems) {
    if (
      workItem.status === "completed" || workItem.status === "cancelled" ||
      draft.agentRuns.some((run) =>
        run.workItemId === workItem.id && isActiveRunStatus(run.status)
      )
    ) continue;
    workItem.status = nextIdleWorkStatus(draft, workItem);
  }
}

function nextIdleWorkStatus(
  draft: EngineeringProjectSnapshot,
  workItem: EngineeringWorkItem,
): "planned" | "ready" | "waiting-for-decision" {
  const decisionsApproved = workItem.decisionIds.every((id) =>
    findDecision(draft, id)?.status === "approved"
  );
  const blockersResolved = workItem.blockerIds.every((id) =>
    draft.blockers.find((blocker) => blocker.id === id)?.status === "resolved"
  );
  const dependenciesCompleted = workItem.dependsOnWorkItemIds.every((id) =>
    findWorkItem(draft, id)?.status === "completed"
  );
  if (decisionsApproved && blockersResolved && dependenciesCompleted) return "ready";
  if (
    workItem.decisionIds.some((id) => {
      const status = findDecision(draft, id)?.status;
      return status === "required" || status === "proposed" || status === "rejected";
    })
  ) return "waiting-for-decision";
  return "planned";
}

function mergeEvidence(
  existing: readonly EngineeringThreadEntityRef[],
  additions: readonly EngineeringThreadEntityRef[],
): Mutable<EngineeringThreadEntityRef>[] {
  const result = structuredClone(existing) as Mutable<EngineeringThreadEntityRef>[];
  const keys = new Set(result.map(evidenceKey));
  for (const reference of additions) {
    if (!keys.has(evidenceKey(reference))) result.push(structuredClone(reference));
  }
  return result;
}

function evidenceKey(reference: EngineeringThreadEntityRef): string {
  return `${reference.snapshotId}\u0000${reference.snapshotRevision}\u0000${reference.kind}\u0000${reference.id}`;
}

function findDecision(
  draft: EngineeringProjectSnapshot,
  id: string,
): Mutable<EngineeringDecision> | undefined {
  return draft.decisions.find((decision) => decision.id === id) as
    | Mutable<EngineeringDecision>
    | undefined;
}

function findWorkItem(
  draft: EngineeringProjectSnapshot,
  id: string,
): Mutable<EngineeringWorkItem> | undefined {
  return draft.workItems.find((item) => item.id === id) as
    | Mutable<EngineeringWorkItem>
    | undefined;
}

function isActiveRunStatus(status: EngineeringAgentRunStatus): boolean {
  return ["queued", "running", "waiting-for-decision", "publishing"].includes(status);
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

function nonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    invalidInput(`${name} cannot be empty.`);
  }
}

function invalidInput(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}

function invalidTransition(message: string): never {
  throw new EngineeringProjectCommandError("invalid_transition", message);
}

function notFound(kind: string, id: string): never {
  throw new EngineeringProjectCommandError(
    "entity_not_found",
    `Engineering ${kind} ${id} does not exist.`,
  );
}

function stale(projectId: string, expected: number, actual: number) {
  return new EngineeringProjectCommandError(
    "stale_revision",
    `Engineering project ${projectId} expected revision ${expected}, current revision is ${actual}.`,
  );
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
