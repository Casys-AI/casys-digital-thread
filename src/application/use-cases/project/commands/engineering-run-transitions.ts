import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringApprovedBriefBasis,
  EngineeringBasisRef,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectCommandName,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { queuedRunCancellationSummary } from "../../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import { validateResolvedOperationPlanRef } from "../../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deepFreeze } from "../../../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";
import { assertRunLifecycleOrigin } from "./engineering-project-command-policy.ts";
import type {
  CancelQueuedRunCommand,
  CompleteRunCommand,
  EngineeringProjectCompletionEvidenceValidator,
  EngineeringProjectInitialCompletionEvidenceValidator,
  EngineeringProjectPlanningDependencies,
  EngineeringProjectPlanOperationRegistry,
  FailRunCommand,
  QueueRunCommand,
  RunCommand,
} from "./engineering-project-commands.ts";
import {
  actor,
  addThreadSnapshot,
  assertDeclaredSnapshot,
  assertExactResultEvidence,
  assertResultAdvancesBase,
  assertThreadSnapshotBasisInput,
  findDecision,
  findRun,
  findWorkItem,
  invalidInput,
  invalidTransition,
  isActiveRunStatus,
  mergeEvidence,
  type Mutable,
  nextIdleWorkStatus,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
  sameApprovedBriefBasis,
  threadSnapshotReference,
  transition,
} from "./engineering-project-transition-values.ts";

export async function applyQueueRun(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: QueueRunCommand,
  planning: EngineeringProjectPlanningDependencies | undefined,
): Promise<void> {
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
  const decisionBindings = workItem.decisionIds.map((id) => {
    const decision = findDecision(draft, id);
    if (!decision || decision.status !== "approved" || !decision.inputFingerprint) {
      invalidTransition(`Work item decision ${id} is not approved.`);
    }
    return {
      id,
      inputFingerprint: structuredClone(decision.inputFingerprint),
    };
  });
  const queued = await queueV3Run(
    draft,
    command,
    workItem,
    decisionBindings,
    appliedAt,
    origin,
    planning,
  );
  draft.agentRuns.push(queued);
  workItem.status = "in-progress";
}

export function applyCancelQueuedRun(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: CancelQueuedRunCommand,
): void {
  nonEmpty(command.runId, "runId");
  nonEmpty(command.rationale, "rationale");
  const run = findRun(draft, command.runId);
  if (!run) notFound("agent run", command.runId);
  if (run.status !== "queued") {
    invalidTransition(
      `Agent run ${run.id} can be cancelled only while queued; it is ${run.status}.`,
    );
  }
  if (
    run.startedAt || run.completedAt || run.claimedAt || run.claimedBy ||
    run.waitingForDecisionIds || run.resultSnapshot || run.failure ||
    run.evidenceRefs.length !== 0
  ) {
    invalidTransition(
      `Queued agent run ${run.id} has execution state and cannot be cancelled safely.`,
    );
  }
  const summary = queuedRunCancellationSummary(command.rationale);
  run.status = "cancelled";
  run.summary = summary;
  run.cancellation = {
    rationale: command.rationale,
    cancelledAt: appliedAt,
    cancelledBy: actor(origin),
  };
  run.statusHistory ??= [];
  run.statusHistory.push(transition(
    { commandId: command.commandId, summary },
    origin,
    "cancelled",
    appliedAt,
  ));
  const workItem = findWorkItem(draft, run.workItemId)!;
  workItem.status = nextIdleWorkStatus(draft, workItem);
  recomputeWorkReadiness(draft);
}

export async function applyOrdinaryRunTransition(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  type: EngineeringProjectCommandName,
  command: RunCommand,
  allowed: readonly EngineeringAgentRunStatus[],
  status: EngineeringAgentRunStatus,
  planning: EngineeringProjectPlanningDependencies | undefined,
  update: (
    run: Mutable<EngineeringAgentRun>,
    appliedAt: string,
    draft: Mutable<EngineeringProjectSnapshot>,
  ) => void | Promise<void> = () => {},
): Promise<void> {
  nonEmpty(command.summary, "summary");
  const run = draft.agentRuns.find((candidate) => candidate.id === command.runId);
  if (!run) notFound("agent run", command.runId);
  assertRunLifecycleOrigin(origin, planning, draft, run, type);
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
}

export function applyClaimRun(
  run: Mutable<EngineeringAgentRun>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
): void {
  run.claimedAt = appliedAt;
  run.claimedBy = actor(origin);
  run.startedAt = appliedAt;
}

export async function applyCompleteRun(
  run: Mutable<EngineeringAgentRun>,
  appliedAt: string,
  draft: Mutable<EngineeringProjectSnapshot>,
  command: CompleteRunCommand,
  evidenceValidator: EngineeringProjectCompletionEvidenceValidator | undefined,
  initialEvidenceValidator:
    | EngineeringProjectInitialCompletionEvidenceValidator
    | undefined,
): Promise<void> {
  assertExactResultEvidence(draft, command.resultSnapshot, command.evidenceRefs);
  {
    const basis = run.basis;
    if (!basis) {
      invalidInput(
        `V3 agent run ${run.id} has no exact basis; completion is unsafe.`,
      );
    }
    const workItem = findWorkItem(draft, run.workItemId)!;
    if (basis.kind === "approved-brief") {
      assertInitialV3CompletionBasis(draft, workItem, basis);
      if (!initialEvidenceValidator) {
        invalidInput(
          "Initial completion validation is unavailable; refusing to publish a brief-derived documentary baseline.",
        );
      }
      await initialEvidenceValidator.validateInitial(
        run.id,
        basis,
        workItem.operation!,
        command.resultSnapshot,
        command.evidenceRefs,
      );
    } else {
      const baseSnapshot = threadSnapshotReference(basis);
      assertResultAdvancesBase(baseSnapshot, command.resultSnapshot);
      if (!evidenceValidator) {
        invalidInput(
          "Completion evidence validation is unavailable; refusing to publish unverified refs.",
        );
      }
      await evidenceValidator.validate(
        baseSnapshot,
        command.resultSnapshot,
        command.evidenceRefs,
      );
    }
  }
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
}

export function applyFailRun(
  run: Mutable<EngineeringAgentRun>,
  appliedAt: string,
  draft: Mutable<EngineeringProjectSnapshot>,
  command: FailRunCommand,
): void {
  nonEmpty(command.code, "code");
  nonEmpty(command.message, "message");
  run.completedAt = appliedAt;
  run.failure = { code: command.code, message: command.message };
  delete run.waitingForDecisionIds;
  const workItem = findWorkItem(draft, run.workItemId)!;
  workItem.status = nextIdleWorkStatus(draft, workItem);
}

/** The queue receipt target is derived from the server draft, never input. */
export function hasCallerQueuedRunBinding(command: QueueRunCommand): boolean {
  return Object.prototype.hasOwnProperty.call(command, "queuedRun") ||
    Object.prototype.hasOwnProperty.call(command, "resolvedOperationPlan") ||
    Object.prototype.hasOwnProperty.call(command, "plan");
}

/** The cancellation receipt target is derived from the server draft, never input. */
export function hasCallerCancelledRunBinding(command: CancelQueuedRunCommand): boolean {
  return Object.prototype.hasOwnProperty.call(command, "cancelledRun");
}

interface ApprovedDecisionBinding {
  readonly id: string;
  readonly inputFingerprint: ContentFingerprint;
}

async function queueV3Run(
  draft: EngineeringProjectSnapshot,
  command: QueueRunCommand,
  workItem: EngineeringWorkItem,
  approvedDecisions: readonly ApprovedDecisionBinding[],
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  planning: EngineeringProjectPlanningDependencies | undefined,
): Promise<Mutable<EngineeringAgentRun>> {
  if (command.baseSnapshot !== undefined) {
    invalidInput("A V3 run must use basis and cannot accept baseSnapshot.");
  }
  const basis = assertV3QueueBasis(draft, workItem, command.basis);
  const operation = workItem.operation;
  if (!operation) {
    invalidInput("A V3 run requires a registered operation on its work item.");
  }
  const registered = assertRegisteredQueueOperation(planning, operation, basis.kind);
  if (registered.operation.threadEntityBindingsMustMatchBasis) {
    assertThreadEntityBindingsMatchRunBasis(registered.bindings, basis);
  }
  const operationalCapability = await assertQueueEligibility(
    planning,
    draft,
    workItem.id,
    basis,
  );
  const inputFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions,
  });
  const candidate: Mutable<EngineeringAgentRun> = {
    id: command.runId,
    workItemId: workItem.id,
    status: "queued",
    summary: command.summary,
    queuedAt: appliedAt,
    basis: structuredClone(basis),
    inputFingerprint,
    evidenceRefs: [],
    statusHistory: [transition(command, origin, "queued", appliedAt)],
  };
  if (registered.operation.resolvedOperationPlan === "2.0") {
    const sealer = planning?.runPlanSealer;
    if (!sealer) {
      invalidInput(
        `Queued operation ${registered.operation.id}@${registered.operation.version} requires a configured resolved-operation-plan/2.0 sealer.`,
      );
    }
    const project = validateEngineeringProjectSnapshot(draft);
    const frozenCandidate = deepFreeze(
      structuredClone(candidate),
    ) as EngineeringAgentRun;
    const sealed = await sealer.seal({
      project,
      workItem: project.workItems.find((item) => item.id === workItem.id)!,
      run: frozenCandidate,
      queueBasisProject: {
        snapshotId: project.id,
        revision: project.revision,
        fingerprint: await sha256Fingerprint(project),
      },
      ...(operationalCapability ? { operationalCapability } : {}),
    });
    candidate.resolvedOperationPlan = validateResolvedOperationPlanRef(sealed);
  }
  return candidate;
}

/**
 * Recheck basis-bound Thread entities immediately before a queue transition.
 * Append validation is the primary UX guard; this remains a pre-persistence
 * defence against a historical/corrupt work item or a changed registry seam.
 */
function assertThreadEntityBindingsMatchRunBasis(
  bindings: readonly EngineeringOperationInputBinding[],
  basis: EngineeringBasisRef,
): void {
  if (basis.kind !== "thread-snapshot") {
    invalidInput(
      "A Thread-entity basis-bound operation requires an exact ThreadSnapshot run basis.",
    );
  }
  for (const binding of bindings) {
    if (binding.source.kind !== "thread-entity") continue;
    const reference = binding.source.reference;
    if (
      reference.snapshotId !== basis.snapshotId ||
      reference.snapshotRevision !== basis.revision
    ) {
      invalidInput(
        `Operation binding ${binding.name} must name the exact queued run Thread basis; historical Thread-entity references are not queueable.`,
      );
    }
  }
}

/**
 * A plan is deliberately checked against the approved project brief when it is
 * published. That alone is insufficient once a later work item is queued:
 * the reviewed operation must also explicitly accept the concrete run basis.
 */
function assertRegisteredQueueOperation(
  planning: EngineeringProjectPlanningDependencies | undefined,
  operation: EngineeringOperationRef,
  basisKind: EngineeringBasisRef["kind"],
): ReturnType<EngineeringProjectPlanOperationRegistry["validate"]> {
  if (!planning) {
    invalidInput(
      "V3 run queueing is unavailable because no reviewed operation registry is configured.",
    );
  }
  let registered: ReturnType<EngineeringProjectPlanOperationRegistry["validate"]>;
  try {
    registered = planning.operations.validate({ operation, stage: "queue", basisKind });
  } catch (error) {
    invalidInput(
      error instanceof Error
        ? `Queued operation is not accepted by the reviewed registry: ${error.message}`
        : "Queued operation is not accepted by the reviewed registry.",
    );
  }
  if (registered.operation.execution !== "trusted") {
    invalidTransition(
      `Queued operation ${registered.operation.id}@${registered.operation.version} is planning-only and is not backed by a trusted executor.`,
    );
  }
  return registered;
}

/**
 * Give an optional queue gate a detached, validated snapshot of exactly the
 * state it is deciding about. Nothing below this point mutates `draft` until
 * queueV3Run returns a run, so a rejected promise leaves the durable project
 * untouched.
 */
async function assertQueueEligibility(
  planning: EngineeringProjectPlanningDependencies | undefined,
  draft: EngineeringProjectSnapshot,
  workItemId: string,
  basis: EngineeringBasisRef,
): Promise<ResolvedCapabilityRuntimeOperation | undefined> {
  const queueEligibility = planning?.queueEligibility;
  if (!queueEligibility) return undefined;

  const project = validateEngineeringProjectSnapshot(draft);
  const workItem = project.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem || !workItem.operation) {
    invalidInput(
      "The reviewed V3 work item is unavailable for queue-eligibility validation.",
    );
  }

  try {
    return await queueEligibility.validate({
      project,
      workItem,
      operation: workItem.operation,
      basis: immutableQueueEligibilityBasis(project, basis),
    });
  } catch (error) {
    invalidTransition(
      error instanceof Error
        ? `The requested V3 run is not eligible for queueing: ${error.message}`
        : "The requested V3 run is not eligible for queueing.",
    );
  }
}

/** Return the same declared basis through the immutable project view. */
function immutableQueueEligibilityBasis(
  project: EngineeringProjectSnapshot,
  basis: EngineeringBasisRef,
): EngineeringBasisRef {
  if (basis.kind === "approved-brief") {
    const plannedBasis = project.plan?.basis;
    if (
      !plannedBasis || plannedBasis.kind !== "approved-brief" ||
      !sameApprovedBriefBasis(basis, plannedBasis)
    ) {
      invalidInput(
        "The reviewed approved-brief basis is unavailable for queue-eligibility validation.",
      );
    }
    return plannedBasis;
  }

  const snapshot = project.threadSnapshots.find((candidate) =>
    candidate.snapshotId === basis.snapshotId &&
    candidate.revision === basis.revision &&
    candidate.subjectId === basis.subjectId
  );
  if (!snapshot) {
    invalidInput(
      "The reviewed thread-snapshot basis is unavailable for queue-eligibility validation.",
    );
  }
  return Object.freeze({ kind: "thread-snapshot" as const, ...snapshot });
}

function assertV3QueueBasis(
  draft: EngineeringProjectSnapshot,
  workItem: EngineeringWorkItem,
  basis: EngineeringBasisRef | undefined,
): EngineeringBasisRef {
  if (!basis || typeof basis !== "object") {
    invalidInput("A V3 run requires an exact basis.");
  }
  if (basis.kind === "approved-brief") {
    const plan = draft.plan;
    if (
      !plan || plan.basis.kind !== "approved-brief" ||
      !sameApprovedBriefBasis(basis, plan.basis)
    ) {
      invalidInput(
        "The approved-brief run basis must exactly match the published project plan basis.",
      );
    }
    if (
      workItem.operation?.id !== "baseline.from-approved-brief" ||
      workItem.operation.version !== "1"
    ) {
      invalidTransition(
        "An approved-brief basis is valid only for baseline.from-approved-brief@1.",
      );
    }
    if (draft.threadSnapshots.length !== 0) {
      invalidTransition(
        "An approved-brief basis is valid only before the first documentary ThreadSnapshot exists.",
      );
    }
    return structuredClone(basis);
  }
  if (basis.kind === "thread-snapshot") {
    assertThreadSnapshotBasisInput(basis);
    assertDeclaredSnapshot(draft, basis);
    return structuredClone(basis);
  }
  invalidInput(
    "basis.kind must be approved-brief or thread-snapshot.",
  );
}

function assertInitialV3CompletionBasis(
  draft: EngineeringProjectSnapshot,
  workItem: EngineeringWorkItem,
  basis: EngineeringApprovedBriefBasis,
): void {
  if (
    !draft.plan || draft.plan.basis.kind !== "approved-brief" ||
    !sameApprovedBriefBasis(basis, draft.plan.basis) ||
    workItem.operation?.id !== "baseline.from-approved-brief" ||
    workItem.operation.version !== "1"
  ) {
    invalidInput(
      "A brief-derived initial result must complete the exact published baseline.from-approved-brief@1 operation.",
    );
  }
  if (draft.threadSnapshots.length !== 0) {
    invalidTransition(
      "A brief-derived initial result cannot be published after a documentary ThreadSnapshot exists.",
    );
  }
}
