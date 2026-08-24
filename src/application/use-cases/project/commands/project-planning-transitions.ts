import type {
  EngineeringApprovedBriefBasis,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectChange,
  EngineeringProjectPhase,
  EngineeringProjectPlan,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
  EngineeringWorkOwner,
} from "../../../../domain/project/engineering-project.ts";
import { stampEngineeringActivityIdentity } from "../../../../domain/project/engineering-activity.ts";
import { collectRequiredDependsOnOperationIssues } from "../../../../domain/project/required-depends-on-operation.ts";
import {
  engineeringProjectPlanReplacementLock,
  engineeringProjectPlanReplacementLockMessage,
} from "../../../../domain/project/engineering-project-plan-replaceability.ts";
import {
  currentProjectAnswer,
  isProjectBriefGateKind,
  projectBriefContractVersion,
} from "../../../../domain/project/project-brief.ts";
import { isReservedUncertainWriterBasisReleaseDecisionId } from "../../../../domain/record/uncertain-writer-basis-release.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type {
  AppendProjectChangeCommand,
  EngineeringProjectPlanningDependencies,
  EngineeringProjectPlanOperationRegistry,
  PlannedEngineeringDecision,
  PlannedEngineeringWorkItem,
  PublishProjectPlanCommand,
} from "./engineering-project-commands.ts";
import {
  actor,
  assertThreadSnapshotBasisInput,
  evidenceKey,
  invalidInput,
  invalidTransition,
  isActiveRunStatus,
  type Mutable,
  nonEmpty,
  recomputeWorkReadiness,
  sameApprovedBriefBasis,
} from "./engineering-project-transition-values.ts";

export function applyPublishPlan(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: PublishProjectPlanCommand,
  planning: EngineeringProjectPlanningDependencies | undefined,
): void {
  if (!planning) {
    invalidInput(
      "Project-plan publication is unavailable because no reviewed operation registry is configured.",
    );
  }
  assertPlanningProject(draft);
  assertPlanningCanChange(draft);
  validatePlanCommand(command);
  assertPlanGateClaimsResolve(draft, command.workItems);
  const basis = planningBasisForProject(draft);

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
    // Fail early: some operations require a planChange lineage that the
    // initial plan can never provide.  The executor would catch this at
    // run time, but by then the baseline has completed and
    // assertPlanningCanChange forbids republication — leaving the agent
    // with no recovery path.  Rejecting here preserves the plan slot.
    if (resolved.operation.requiresAdditiveChange) {
      invalidInput(
        `Operation ${resolved.operation.id}@${resolved.operation.version} must be introduced ` +
          "by an additive project change (project_change_append) after the baseline completes " +
          "— it cannot appear in the initial plan.",
      );
    }
    assertPlanBindingsResolve(draft, resolved.bindings);
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
      decisionEvidenceScope: resolved.operation.decisionEvidenceScope,
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
  const activityIdentity = stampDeclaredActivityIdentity([], resolvedWorkItems);

  const decisions = command.requiredDecisions.map((decision) => ({
    id: decision.id,
    phaseId: decision.phaseId,
    title: decision.title,
    question: decision.question,
    status: "required" as const,
    requestedAt: appliedAt,
    inputEvidenceRefs: decisionInputEvidenceRefs(decision.id, resolvedWorkItems),
    approvalIds: [],
  }));
  const workItems = resolvedWorkItems.map((item) => ({
    id: item.id,
    ...activityIdentity.get(item.id)!,
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
    ...(item.gateClaims === undefined
      ? {}
      : { gateClaims: item.gateClaims.map((claim) => ({ ...claim })) }),
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
    basis,
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
  // A bounded first-baseline operation without dependencies or decisions
  // is ready for explicit human queueing immediately. Planning never
  // queues it itself.
  recomputeWorkReadiness(draft);
}

export function applyAppendChange(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: AppendProjectChangeCommand,
  planning: EngineeringProjectPlanningDependencies | undefined,
): void {
  if (!planning) {
    invalidInput(
      "Project-change publication is unavailable because no reviewed operation registry is configured.",
    );
  }
  assertPlanningProject(draft);
  assertChangeCanAppend(draft);
  validateChangeCommand(command);
  assertPlanGateClaimsResolve(draft, command.workItems);
  const currentHead = assertCurrentThreadSnapshotHead(
    draft,
    command.baseSnapshot,
  );
  const approvedBriefBasis = planningBasisForProject(draft);
  const startingPoint = draft.plan!.startingPoint;

  const existingPhaseIds = new Set(draft.phases.map((phase) => phase.id));
  const existingWorkItemIds = new Set(draft.workItems.map((item) => item.id));
  const existingDecisionIds = new Set(
    draft.decisions.map((decision) => decision.id),
  );
  assertNewPlanIds(
    command.phases.map((phase) => phase.id),
    existingPhaseIds,
    "phase",
  );
  assertNewPlanIds(
    command.workItems.map((item) => item.id),
    existingWorkItemIds,
    "work item",
  );
  assertNewPlanIds(
    command.requiredDecisions.map((decision) => decision.id),
    existingDecisionIds,
    "decision",
  );

  const newPhaseIds = new Set(command.phases.map((phase) => phase.id));
  const knownPhaseIds = new Set([...existingPhaseIds, ...newPhaseIds]);
  const allWorkItemIds = new Set([
    ...existingWorkItemIds,
    ...command.workItems.map((item) => item.id),
  ]);
  const decisionIds = new Set(
    command.requiredDecisions.map((decision) => decision.id),
  );
  const decisionsById = new Map(
    command.requiredDecisions.map((decision) => [decision.id, decision]),
  );
  for (const [index, decision] of command.requiredDecisions.entries()) {
    if (!knownPhaseIds.has(decision.phaseId)) {
      invalidInput(
        `requiredDecisions[${index}].phaseId must reference an existing project phase or a newly declared phase.`,
      );
    }
  }
  const activityIdentity = stampDeclaredActivityIdentity(
    draft.workItems,
    command.workItems,
  );
  const requiredDependsOnRevisions = [
    ...draft.workItems,
    ...command.workItems.map((item) => ({
      id: item.id,
      ...activityIdentity.get(item.id)!,
      operation: item.operation,
    })),
  ];
  const resolvedWorkItems = command.workItems.map((item) => {
    const resolved = resolvePlanOperation(planning.operations, item.operation);
    if (resolved.operation.startingPoint !== startingPoint) {
      invalidInput(
        `Operation ${resolved.operation.id}@${resolved.operation.version} is not registered for ${startingPoint}.`,
      );
    }
    assertPlanBindingsResolve(draft, resolved.bindings);
    assertChangeWorkItemReferences(
      item,
      knownPhaseIds,
      allWorkItemIds,
      decisionIds,
      decisionsById,
    );
    assertRequiredDependsOnOperation(
      item,
      resolved.operation,
      requiredDependsOnRevisions,
    );
    return {
      ...item,
      title: resolved.operation.title,
      description: resolved.operation.description,
      kind: resolved.operation.workItemKind,
      decisionEvidenceScope: resolved.operation.decisionEvidenceScope,
      operation: {
        id: resolved.operation.id,
        version: resolved.operation.version,
        bindings: structuredClone(resolved.bindings) as Mutable<
          EngineeringOperationInputBinding
        >[],
      },
    };
  });
  assertPlanDependenciesAreAcyclic([
    ...draft.workItems,
    ...resolvedWorkItems,
  ]);

  const decisions = command.requiredDecisions.map((decision) => ({
    id: decision.id,
    phaseId: decision.phaseId,
    title: decision.title,
    question: decision.question,
    status: "required" as const,
    requestedAt: appliedAt,
    inputEvidenceRefs: decisionInputEvidenceRefs(decision.id, resolvedWorkItems),
    approvalIds: [],
  }));
  const workItems = resolvedWorkItems.map((item) => ({
    id: item.id,
    ...activityIdentity.get(item.id)!,
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
    ...(item.gateClaims === undefined
      ? {}
      : { gateClaims: item.gateClaims.map((claim) => ({ ...claim })) }),
    evidenceRefs: [],
    decisionIds: [...item.decisionIds],
    blockerIds: [],
  }));
  const phases = command.phases.map((phase, index) => ({
    id: phase.id,
    name: phase.name,
    order: draft.phases.length + index + 1,
    description: phase.description,
    workItemIds: workItems.filter((item) => item.phaseId === phase.id).map((
      item,
    ) => item.id),
    requiredDecisionIds: decisions.filter((item) => item.phaseId === phase.id)
      .map((item) => item.id),
    evidenceRefs: [],
  }));
  assertEveryPhaseHasWork(phases);

  const change: Mutable<EngineeringProjectChange> = {
    id: `change:${command.commandId}`,
    commandId: command.commandId,
    approvedBriefBasis: structuredClone(approvedBriefBasis),
    baseSnapshot: structuredClone(currentHead),
    phaseIds: phases.map((phase) => phase.id),
    workItemIds: workItems.map((item) => item.id),
    decisionIds: decisions.map((decision) => decision.id),
    publishedAt: appliedAt,
    publishedBy: actor(origin),
  };

  draft.phases = [
    ...draft.phases.map((phase) => {
      const addedWorkIds = workItems
        .filter((item) => item.phaseId === phase.id)
        .map((item) => item.id);
      const addedDecisionIds = decisions
        .filter((item) => item.phaseId === phase.id)
        .map((item) => item.id);
      if (addedWorkIds.length === 0 && addedDecisionIds.length === 0) {
        return phase;
      }
      return {
        ...phase,
        workItemIds: [...phase.workItemIds, ...addedWorkIds],
        requiredDecisionIds: [
          ...phase.requiredDecisionIds,
          ...addedDecisionIds,
        ],
      };
    }),
    ...phases,
  ];
  draft.workItems = [...draft.workItems, ...workItems];
  draft.decisions = [...draft.decisions, ...decisions];
  draft.planChanges = [...(draft.planChanges ?? []), change];
  recomputeWorkReadiness(draft);
}

function assertPlanningCanChange(draft: EngineeringProjectSnapshot): void {
  const lock = engineeringProjectPlanReplacementLock(draft);
  if (lock) invalidTransition(engineeringProjectPlanReplacementLockMessage(lock));
}

function assertChangeCanAppend(draft: EngineeringProjectSnapshot): void {
  if (!draft.plan) {
    invalidTransition(
      "A project change requires an already published initial project plan.",
    );
  }
  const completedBaseline = draft.agentRuns.some((run) => {
    const workItem = draft.workItems.find((item) => item.id === run.workItemId);
    return run.status === "completed" &&
      run.basis?.kind === "approved-brief" &&
      workItem?.operation?.id === "baseline.from-approved-brief" &&
      workItem?.operation?.version === "1";
  });
  if (!completedBaseline || draft.threadSnapshots.length === 0) {
    invalidTransition(
      "A project change can be appended only after the reviewed initial baseline has completed and produced a ThreadSnapshot.",
    );
  }
  if (draft.agentRuns.some((run) => isActiveRunStatus(run.status))) {
    invalidTransition(
      "A project change cannot be appended while an agent run is active.",
    );
  }
}

function assertPlanningProject(
  draft: EngineeringProjectSnapshot,
): void {
  if (
    !draft.framing?.currentBrief ||
    draft.framing.currentBriefApproval?.status !== "approved"
  ) {
    invalidTransition(
      "A project plan requires a current human-approved project brief.",
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
  validatePlannedChange(command);
}

function validateChangeCommand(command: AppendProjectChangeCommand): void {
  assertThreadSnapshotBasisInput({ kind: "thread-snapshot", ...command.baseSnapshot });
  validatePlannedChange(command, { allowEmptyPhases: true });
}

function assertCurrentThreadSnapshotHead(
  draft: EngineeringProjectSnapshot,
  baseSnapshot: EngineeringThreadSnapshotRef,
): EngineeringThreadSnapshotRef {
  const head = draft.threadSnapshots.reduce<EngineeringThreadSnapshotRef | undefined>(
    (latest, candidate) =>
      !latest || candidate.revision > latest.revision ? candidate : latest,
    undefined,
  );
  if (!head) {
    invalidTransition(
      "A project change requires an exact completed ThreadSnapshot as its base.",
    );
  }
  if (
    baseSnapshot.snapshotId !== head.snapshotId ||
    baseSnapshot.revision !== head.revision ||
    baseSnapshot.subjectId !== head.subjectId
  ) {
    invalidInput(
      "Project-change baseSnapshot must exactly equal the current project ThreadSnapshot head.",
    );
  }
  return structuredClone(head);
}

function validatePlannedChange(
  command: Pick<
    PublishProjectPlanCommand,
    "phases" | "workItems" | "requiredDecisions"
  >,
  options: { readonly allowEmptyPhases?: boolean } = {},
): void {
  if (!Array.isArray(command.phases)) {
    invalidInput("phases must be an array.");
  }
  if (!options.allowEmptyPhases && command.phases.length === 0) {
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
    if (item.predecessorRevisionId !== undefined) {
      nonEmpty(
        item.predecessorRevisionId,
        `workItems[${index}].predecessorRevisionId`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(item, "activityId")
    ) {
      invalidInput(
        `workItems[${index}].activityId is server-stamped and cannot be supplied.`,
      );
    }
  }
  assertPlannedDecisionScopesAreUnambiguous(command.workItems);
  for (const [index, decision] of command.requiredDecisions.entries()) {
    nonEmpty(decision.id, `requiredDecisions[${index}].id`);
    if (isReservedUncertainWriterBasisReleaseDecisionId(decision.id)) {
      invalidInput(
        `requiredDecisions[${index}].id uses the server-reserved uncertain-writer basis-release namespace.`,
      );
    }
    nonEmpty(decision.phaseId, `requiredDecisions[${index}].phaseId`);
    nonEmpty(decision.title, `requiredDecisions[${index}].title`);
    nonEmpty(decision.question, `requiredDecisions[${index}].question`);
  }
}

/**
 * An MRTR approval is scoped to one concrete operation.  Letting a decision
 * appear on two work items would make one human confirmation silently release
 * multiple actions, even if each individual reference is otherwise valid.
 */
function assertPlannedDecisionScopesAreUnambiguous(
  workItems: readonly Pick<PlannedEngineeringWorkItem, "id" | "decisionIds">[],
): void {
  const ownerByDecisionId = new Map<string, string>();
  for (const item of workItems) {
    for (const decisionId of item.decisionIds) {
      const existingOwner = ownerByDecisionId.get(decisionId);
      if (existingOwner !== undefined && existingOwner !== item.id) {
        invalidInput(
          `Decision ${decisionId} must be bound to exactly one work item; ` +
            `it is already bound to ${existingOwner}.`,
        );
      }
      ownerByDecisionId.set(decisionId, item.id);
    }
  }
}

/**
 * Claims are declared coverage of the current reviewed mandate. They are
 * checked separately from operation bindings so no gate becomes a fabricated
 * operation input or evidence-consumption edge.
 */
function assertPlanGateClaimsResolve(
  project: EngineeringProjectSnapshot,
  workItems: readonly PlannedEngineeringWorkItem[],
): void {
  if (!workItems.some((item) => item.gateClaims !== undefined)) return;
  const brief = project.framing?.currentBrief;
  const approval = project.framing?.currentBriefApproval;
  if (!brief || approval?.status !== "approved") {
    invalidInput("Gate claims require the current human-approved canonical brief.");
  }
  if (projectBriefContractVersion(brief) !== "2.0") {
    invalidInput(
      "Gate claims require a V2 canonical brief with explicit gate dependencies.",
    );
  }
  const briefItems = new Map(brief.items.map((item) => [item.id, item]));
  for (const [workItemIndex, workItem] of workItems.entries()) {
    if (workItem.gateClaims === undefined) continue;
    if (!Array.isArray(workItem.gateClaims)) {
      invalidInput(`workItems[${workItemIndex}].gateClaims must be an array.`);
    }
    const claimedGateIds = new Set<string>();
    for (const [claimIndex, claim] of workItem.gateClaims.entries()) {
      nonEmpty(
        claim.gateItemId,
        `workItems[${workItemIndex}].gateClaims[${claimIndex}].gateItemId`,
      );
      if (claim.role !== "contributes-to" && claim.role !== "satisfies") {
        invalidInput(
          `workItems[${workItemIndex}].gateClaims[${claimIndex}].role must be contributes-to or satisfies.`,
        );
      }
      if (
        claim.status !== "current" && claim.status !== "impact-unresolved" &&
        claim.status !== "invalidated" && claim.status !== "carried-forward"
      ) {
        invalidInput(
          `workItems[${workItemIndex}].gateClaims[${claimIndex}].status must be a declared gate-link status.`,
        );
      }
      if (claimedGateIds.has(claim.gateItemId)) {
        invalidInput(
          `Work item ${workItem.id} may claim gate ${claim.gateItemId} only once.`,
        );
      }
      claimedGateIds.add(claim.gateItemId);
      const gate = briefItems.get(claim.gateItemId);
      if (!gate || !isProjectBriefGateKind(gate.kind)) {
        invalidInput(
          `Work item ${workItem.id} must claim a success-criterion or verification-activity in the current canonical brief.`,
        );
      }
    }
  }
}

function assertRequiredDependsOnOperation(
  item: {
    readonly id: string;
    readonly dependsOnWorkItemIds: readonly string[];
  },
  operation: {
    readonly id: string;
    readonly version: string;
    readonly requiresDependsOnOperation?: {
      readonly id: string;
      readonly version: string;
    };
  },
  revisions: readonly {
    readonly id: string;
    readonly activityId: string;
    readonly predecessorRevisionId?: string;
    readonly operation?: { readonly id: string; readonly version: string };
  }[],
): void {
  const issue = collectRequiredDependsOnOperationIssues(
    item,
    operation,
    revisions,
  )[0];
  if (issue) invalidInput(issue.message);
}

function assertNewPlanIds(
  ids: readonly string[],
  existing: ReadonlySet<string>,
  label: string,
): void {
  for (const id of ids) {
    if (existing.has(id)) {
      invalidInput(`Project change cannot reuse existing ${label} id ${id}.`);
    }
  }
}

function planningBasisForProject(
  project: EngineeringProjectSnapshot,
): EngineeringApprovedBriefBasis {
  return approvedBriefBasisForProject(project);
}

/**
 * Exported so read surfaces that must name the same approved brief (for
 * example the brief-requirements review) enforce this exact rule rather than
 * a second, drifting copy of it.
 */
export function approvedBriefBasisForProject(
  project: EngineeringProjectSnapshot,
): EngineeringApprovedBriefBasis {
  const framing = project.framing;
  const brief = framing?.currentBrief;
  const review = framing?.currentBriefApproval;
  if (
    !brief || !review ||
    review.status !== "approved" || !review.decidedAt ||
    review.decidedBy?.origin !== "human" ||
    review.briefSnapshotId !== brief.id ||
    review.briefRevision !== brief.revision
  ) {
    invalidTransition(
      "The project has no exact human-approved canonical brief for planning.",
    );
  }
  const receipt = [...(project.commandReceipts ?? [])].reverse().find((item) =>
    item.type === "project.brief-approve" &&
    Date.parse(item.appliedAt) === Date.parse(review.decidedAt!) &&
    item.actor.id === review.decidedBy?.id &&
    item.actor.origin === "human"
  );
  if (!receipt) {
    invalidTransition(
      "The canonical brief is not anchored by an exact human approval receipt.",
    );
  }
  const expected: EngineeringApprovedBriefBasis = {
    kind: "approved-brief",
    projectId: project.project.id,
    projectSnapshotId: receipt.resultingSnapshot.snapshotId,
    projectRevision: receipt.resultingSnapshot.revision,
    briefId: brief.briefId,
    briefSnapshotId: brief.id,
    briefRevision: brief.revision,
    approvedBriefFingerprint: structuredClone(review.inputFingerprint),
  };
  if (
    !receipt.approvedBriefBasis ||
    !sameApprovedBriefBasis(receipt.approvedBriefBasis, expected)
  ) {
    invalidTransition(
      "The canonical brief approval receipt does not retain its exact approved brief basis.",
    );
  }
  return structuredClone(receipt.approvedBriefBasis);
}

function resolvePlanOperation(
  operations: EngineeringProjectPlanOperationRegistry,
  operation: EngineeringOperationRef,
): ReturnType<EngineeringProjectPlanOperationRegistry["validate"]> {
  try {
    return operations.validate({ operation, stage: "planning" });
  } catch (error) {
    invalidInput(
      error instanceof Error
        ? `Project operation is not accepted by the reviewed registry: ${error.message}`
        : "Project operation is not accepted by the reviewed registry.",
    );
  }
}

function assertPlanBindingsResolve(
  project: EngineeringProjectSnapshot,
  bindings: readonly EngineeringOperationInputBinding[],
): void {
  for (const binding of bindings) {
    if (binding.source.kind === "approved-brief") {
      if (
        !project.framing?.currentBrief ||
        project.framing.currentBriefApproval?.status !== "approved"
      ) {
        invalidInput(
          `Operation binding ${binding.name} requires the current human-approved project brief.`,
        );
      }
      continue;
    }
    if (binding.source.kind === "project-answer") {
      const answerId = binding.source.answerId;
      const answer = project.framing
        ? project.framing.answers.find((item) =>
          item.id === answerId &&
          currentProjectAnswer(project.framing!, item.questionId)?.id === item.id
        )
        : undefined;
      if (!answer || answer.kind !== "provided") {
        invalidInput(
          `Operation binding ${binding.name} must reference one current provided project answer.`,
        );
      }
      continue;
    }
  }
}

function decisionInputEvidenceRefs(
  decisionId: string,
  workItems: readonly {
    readonly decisionIds: readonly string[];
    readonly decisionEvidenceScope?: "thread-entity-bindings";
    readonly operation: {
      readonly bindings: readonly EngineeringOperationInputBinding[];
    };
  }[],
): EngineeringThreadEntityRef[] {
  const refs = workItems
    .filter((item) =>
      item.decisionEvidenceScope === "thread-entity-bindings" &&
      item.decisionIds.includes(decisionId)
    )
    .flatMap((item) => item.operation.bindings)
    .flatMap((binding) =>
      binding.source.kind === "thread-entity" ? [binding.source.reference] : []
    );
  const unique = new Map<string, EngineeringThreadEntityRef>();
  for (const ref of refs) {
    unique.set(evidenceKey(ref), structuredClone(ref));
  }
  return [...unique.values()].sort((left, right) =>
    evidenceKey(left).localeCompare(evidenceKey(right))
  );
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

/**
 * A change may depend on completed historical work and may append work onto
 * an existing phase. New decisions remain owned by this command so prior
 * review scope stays immutable.
 */
function assertChangeWorkItemReferences(
  item: PlannedEngineeringWorkItem,
  phaseIds: ReadonlySet<string>,
  workItemIds: ReadonlySet<string>,
  decisionIds: ReadonlySet<string>,
  decisionsById: ReadonlyMap<string, PlannedEngineeringDecision>,
): void {
  if (!phaseIds.has(item.phaseId)) {
    invalidInput(
      `Project-change work item ${item.id} must reference an existing project phase or a newly declared phase.`,
    );
  }
  for (const dependencyId of item.dependsOnWorkItemIds) {
    if (dependencyId === item.id || !workItemIds.has(dependencyId)) {
      invalidInput(
        `Project-change work item ${item.id} must depend only on declared project work.`,
      );
    }
  }
  for (const decisionId of item.decisionIds) {
    const decision = decisionsById.get(decisionId);
    if (
      !decisionIds.has(decisionId) || !decision || decision.phaseId !== item.phaseId
    ) {
      invalidInput(
        `Project-change work item ${item.id} must reference a newly declared decision in the same phase.`,
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

function stampDeclaredActivityIdentity(
  existing: readonly EngineeringWorkItem[],
  declared: readonly PlannedEngineeringWorkItem[],
): ReadonlyMap<
  string,
  { readonly activityId: string; readonly predecessorRevisionId?: string }
> {
  const { stamped, issues } = stampEngineeringActivityIdentity(
    existing,
    declared,
  );
  const first = issues[0];
  if (first) invalidInput(first.message);
  return stamped;
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
