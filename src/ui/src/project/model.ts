import {
  deriveEngineeringPhaseStatus,
  deriveEngineeringProjectStatus,
  type EngineeringAgentRun,
  type EngineeringBlocker,
  type EngineeringDecision,
  type EngineeringPhaseStatus,
  type EngineeringProjectPhase,
  type EngineeringProjectSnapshot,
  type EngineeringProjectStatus,
  type EngineeringWorkItem,
  isEngineeringDecisionSatisfied,
} from "../../../domain/project/engineering-project.ts";
import {
  attemptIdsForRevision,
  collectEngineeringActivities,
  leafRevisionIdsForActivity,
} from "../../../domain/project/engineering-activity.ts";
import type {
  EngineeringWorkbenchActivity,
  EngineeringWorkbenchCaseActivityJoin,
  EngineeringWorkbenchPhaseLane,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import {
  ENGINEERING_PATH_LANE_IDS,
  type EngineeringPathLaneId,
} from "../../../domain/project/engineering-path-lane.ts";
import { currentRequirements } from "../thread/versioned-provenance-model.ts";

export interface ProjectPhaseView {
  readonly phase: EngineeringProjectPhase;
  readonly status: EngineeringPhaseStatus;
  readonly completedWorkItems: number;
  readonly totalWorkItems: number;
  readonly approvedDecisions: number;
  readonly requiredDecisions: number;
  readonly evidenceCount: number;
}

export interface ProjectBrief {
  readonly status: EngineeringProjectStatus;
  readonly phases: readonly ProjectPhaseView[];
  readonly completedPhases: number;
  readonly currentWork: readonly EngineeringWorkItem[];
  readonly nextWork: readonly EngineeringWorkItem[];
  readonly activeRuns: readonly EngineeringAgentRun[];
  /**
   * Most recent settled run (completed, failed or cancelled). Runs finish in
   * seconds, so the agent panel is almost always between runs: showing the
   * last settled run keeps the panel factual without pretending activity.
   */
  readonly lastSettledRun: EngineeringAgentRun | undefined;
  readonly pendingDecisions: readonly EngineeringDecision[];
  readonly openBlockers: readonly EngineeringBlocker[];
}

/**
 * The one current operational focus rendered by every compact cockpit surface.
 *
 * A live run owns the focus while it exists. Between runs, project planning
 * order is authoritative: later phases take precedence and the work-item
 * order recorded by that phase is the stable tie-breaker. The physical order
 * of append-only `workItems` and `decisions` arrays is audit history, not UI
 * priority, so it must never decide what the cockpit calls current.
 */
export interface CurrentProjectFocus {
  readonly activeRun: EngineeringAgentRun | undefined;
  readonly work: EngineeringWorkItem | undefined;
  /** A concrete human review proposal explicitly linked to the current work. */
  readonly proposedDecision: EngineeringDecision | undefined;
}

/** Concrete proposals that are waiting for a human MRTR decision. */
export function pendingHumanConfirmationDecisions(
  project: Pick<EngineeringProjectSnapshot, "decisions">,
): readonly EngineeringDecision[] {
  return project.decisions.filter((decision) => decision.status === "proposed");
}

/** Decisions for which the agent still owes a new concrete proposal. */
export function agentPreparationDecisions(
  project: Pick<EngineeringProjectSnapshot, "decisions">,
): readonly EngineeringDecision[] {
  return project.decisions.filter((decision) =>
    decision.status === "required" || decision.status === "rejected"
  );
}

/**
 * The single, factual priority for compact "agent now" surfaces. A settled
 * run is explicitly history: it is useful context between executions, never
 * a claim that an agent is still active.
 */
export type AgentNowPresentation =
  | { readonly kind: "active-run"; readonly run: EngineeringAgentRun }
  | { readonly kind: "current-work"; readonly work: EngineeringWorkItem }
  | { readonly kind: "last-settled-run"; readonly run: EngineeringAgentRun }
  | { readonly kind: "empty" };

/**
 * The operational subset of a project brief for a linked, current evidence
 * snapshot. It never removes immutable work or run history. It withholds a
 * ready item from "Up next" only when the snapshot already records either an
 * explicit successor reconciliation, or a later completed revision in the
 * same stable activity. Distinct activities stay distinct.
 */
export interface CurrentProjectWork {
  readonly nextWork: readonly EngineeringWorkItem[];
  /** Retained work items whose later, evidenced successor is complete. */
  readonly historicalWorkItemIds: readonly string[];
  /** Exact thread-entity targets whose proposed actions are now historical. */
  readonly closedActionTargetIds: readonly string[];
}

/**
 * The Project Path is a navigational projection, not the project audit log.
 *
 * Grouping uses the persisted activity/revision/attempt identity. Operation
 * keys, phase order, labels, timestamps and Thread proximity never create a
 * lifecycle link.
 */
export const PROJECT_PATH_PRESENTATION_POLICY = {
  version: "project-path/2.0",
  identity: "explicit activityId + predecessorRevisionId",
  attempts: "EngineeringAgentRun bound to one revision",
} as const;

export interface ProjectPathCaseRef {
  readonly caseKey: string;
  readonly caseId: string;
  readonly caseRevision: number;
}

export interface ProjectPathAttemptView {
  readonly run: EngineeringAgentRun;
  readonly cases: readonly ProjectPathCaseRef[];
}

export interface ProjectPathRevisionView {
  readonly id: string;
  readonly predecessorRevisionId?: string;
  readonly title: string;
  readonly status: EngineeringWorkItem["status"];
  readonly attempts: readonly ProjectPathAttemptView[];
}

export interface ProjectPathActivityView {
  readonly id: string;
  readonly lane: EngineeringPathLaneId;
  readonly title: string;
  readonly status: EngineeringPhaseStatus;
  readonly revisions: readonly ProjectPathRevisionView[];
  readonly approvedDecisions: number;
  readonly requiredDecisions: number;
  readonly evidenceCount: number;
}

export interface ProjectPath {
  readonly status: EngineeringProjectStatus;
  readonly activities: readonly ProjectPathActivityView[];
  readonly completedActivities: number;
  readonly pendingDecisions: readonly EngineeringDecision[];
}

export interface ProjectPathLaneGroup {
  readonly id: EngineeringPathLaneId;
  readonly gates: readonly ProjectPathActivityView[];
  readonly satisfiedGates: number;
  readonly totalGates: number;
}

/**
 * Group exact activity records using only the server-owned five-column
 * projection. Always returns the five canonical lanes in order. An absent
 * lane is [] and 0/0, never dropped.
 *
 * Classification is `gate.lane` only. `_phaseLanes` is a leftover argument
 * kept so callers need not change; it is ignored and never classifies a lane.
 * Friendly phase names never classify a lane.
 */
export function groupProjectPathGatesByLane(
  gates: readonly ProjectPathActivityView[],
  _phaseLanes: readonly EngineeringWorkbenchPhaseLane[],
): readonly ProjectPathLaneGroup[] {
  const grouped = new Map<EngineeringPathLaneId, ProjectPathActivityView[]>();
  for (const gate of gates) {
    const existing = grouped.get(gate.lane);
    if (existing) existing.push(gate);
    else grouped.set(gate.lane, [gate]);
  }
  return ENGINEERING_PATH_LANE_IDS.map((id) => {
    const laneGates = grouped.get(id) ?? [];
    return {
      id,
      gates: laneGates,
      satisfiedGates: laneGates.filter((gate) =>
        gate.status === "completed"
      ).length,
      totalGates: laneGates.length,
    };
  });
}

export type ProjectPathStageStatus =
  | "completed"
  | "blocked"
  | "active"
  | "planned";

/**
 * Band status from group gate statuses only. An empty lane stays planned;
 * it is never invented as active.
 */
export function projectPathLaneStageStatus(
  group: Pick<
    ProjectPathLaneGroup,
    "gates" | "satisfiedGates" | "totalGates"
  >,
): ProjectPathStageStatus {
  if (group.totalGates > 0 && group.satisfiedGates === group.totalGates) {
    return "completed";
  }
  if (group.gates.some((gate) => gate.status === "blocked")) {
    return "blocked";
  }
  if (group.gates.some((gate) => gate.status === "active")) {
    return "active";
  }
  return "planned";
}

export function buildProjectBrief(
  snapshot: EngineeringProjectSnapshot,
): ProjectBrief {
  const phases = [...snapshot.phases]
    .sort((left, right) => left.order - right.order)
    .map((phase): ProjectPhaseView => {
      const workItems = phase.workItemIds.flatMap((id) => {
        const item = snapshot.workItems.find((candidate) =>
          candidate.id === id
        );
        return item ? [item] : [];
      });
      const decisions = phase.requiredDecisionIds.flatMap((id) => {
        const decision = snapshot.decisions.find((candidate) =>
          candidate.id === id
        );
        return decision ? [decision] : [];
      });
      return {
        phase,
        status: deriveEngineeringPhaseStatus(snapshot, phase.id),
        completedWorkItems: workItems.filter((item) =>
          item.status === "completed"
        ).length,
        totalWorkItems: workItems.length,
        approvedDecisions: decisions.filter((decision) =>
          isEngineeringDecisionSatisfied(snapshot, decision)
        ).length,
        requiredDecisions: decisions.length,
        evidenceCount: phase.evidenceRefs.length,
      };
    });

  return {
    status: deriveEngineeringProjectStatus(snapshot),
    phases,
    completedPhases: phases.filter((phase) => phase.status === "completed")
      .length,
    currentWork: currentWorkItemsInPriorityOrder(snapshot),
    nextWork: snapshot.workItems.filter((item) => item.status === "ready"),
    activeRuns: activeRunsInPriorityOrder(snapshot),
    lastSettledRun: snapshot.agentRuns
      .filter((run) =>
        run.status === "completed" || run.status === "failed" ||
        run.status === "cancelled"
      )
      .toSorted((left, right) =>
        agentRunRecordedAt(left).localeCompare(agentRunRecordedAt(right)) ||
        left.id.localeCompare(right.id)
      )
      .at(-1),
    pendingDecisions: snapshot.decisions.filter((decision) =>
      decision.status === "required" || decision.status === "proposed" ||
      decision.status === "rejected"
    ),
    openBlockers: snapshot.blockers.filter((blocker) =>
      blocker.status === "open"
    ),
  };
}

/**
 * Select the current work once for every cockpit projection.
 *
 * `EngineeringProjectSnapshot` keeps append-only records, therefore its raw
 * array order has no presentation authority. A live run is the only
 * execution-time override; otherwise the immutable phase plan is used.
 */
export function selectCurrentProjectFocus(
  snapshot: EngineeringProjectSnapshot,
): CurrentProjectFocus {
  const activeRun = activeRunsInPriorityOrder(snapshot)[0];
  const workById = new Map(snapshot.workItems.map((item) => [item.id, item]));
  const work = activeRun
    ? workById.get(activeRun.workItemId)
    : currentWorkItemsInPriorityOrder(snapshot)[0];
  const decisionsById = new Map(
    snapshot.decisions.map((decision) => [decision.id, decision]),
  );
  const proposedDecision = work?.decisionIds
    .map((id) => decisionsById.get(id))
    .find((decision) => decision?.status === "proposed");

  return { activeRun, work, proposedDecision };
}

export function buildAgentNowPresentation(
  snapshot: EngineeringProjectSnapshot,
): AgentNowPresentation {
  const focus = selectCurrentProjectFocus(snapshot);
  if (focus.activeRun) return { kind: "active-run", run: focus.activeRun };
  if (focus.work) return { kind: "current-work", work: focus.work };

  const brief = buildProjectBrief(snapshot);
  if (brief.lastSettledRun) {
    return { kind: "last-settled-run", run: brief.lastSettledRun };
  }
  return { kind: "empty" };
}

function currentWorkItemsInPriorityOrder(
  snapshot: EngineeringProjectSnapshot,
): readonly EngineeringWorkItem[] {
  const workById = new Map(snapshot.workItems.map((item) => [item.id, item]));
  return snapshot.phases
    .toSorted((left, right) =>
      right.order - left.order ||
      left.id.localeCompare(right.id)
    )
    .flatMap((phase) =>
      phase.workItemIds.flatMap((id) => {
        const item = workById.get(id);
        return item && isCurrentWork(item) ? [item] : [];
      })
    );
}

function activeRunsInPriorityOrder(
  snapshot: EngineeringProjectSnapshot,
): readonly EngineeringAgentRun[] {
  return snapshot.agentRuns
    .filter(isActiveRun)
    .toSorted((left, right) =>
      agentRunRecordedAt(right).localeCompare(agentRunRecordedAt(left)) ||
      left.id.localeCompare(right.id)
    );
}

function isCurrentWork(item: EngineeringWorkItem): boolean {
  return item.status === "in-progress" ||
    item.status === "waiting-for-decision";
}

function isActiveRun(run: EngineeringAgentRun): boolean {
  return run.status === "queued" || run.status === "running" ||
    run.status === "waiting-for-decision" || run.status === "publishing";
}

export function buildCurrentProjectWork(
  snapshot: EngineeringProjectSnapshot,
): CurrentProjectWork {
  const brief = buildProjectBrief(snapshot);
  const historicalWorkItemIds = new Set<string>();
  const closedActionTargetIds = new Set<string>();

  // A reconciliation is the domain's only closure contract here: the
  // cancelled work never produced successor evidence, but its exact operation
  // targets are closed by the separately completed successor named in the
  // immutable record.
  for (const item of snapshot.workItems) {
    if (
      item.status !== "cancelled" ||
      item.reconciliation?.kind !== "superseded-by-successor"
    ) continue;
    historicalWorkItemIds.add(item.id);
    for (const key of threadEntityReferenceKeys(item)) {
      closedActionTargetIds.add(key);
    }
  }

  // `project_change_append` is append-only: a later revision of the same
  // activity becomes a new work item and leaves the predecessor `ready`.
  // That leftover is not current work once a later evidenced completion in
  // the same activity exists. Action targets stay open unless a
  // reconciliation named them.
  for (const id of readyWorkItemIdsClosedByLaterCompletedRevision(snapshot)) {
    historicalWorkItemIds.add(id);
  }

  return {
    nextWork: brief.nextWork.filter((item) =>
      !historicalWorkItemIds.has(item.id)
    ),
    historicalWorkItemIds: [...historicalWorkItemIds].toSorted(),
    closedActionTargetIds: [...closedActionTargetIds].toSorted(),
  };
}

function readyWorkItemIdsClosedByLaterCompletedRevision(
  snapshot: EngineeringProjectSnapshot,
): readonly string[] {
  const byId = new Map(snapshot.workItems.map((item) => [item.id, item]));
  const closed: string[] = [];
  for (const activity of collectEngineeringActivities(snapshot.workItems)) {
    const completedIds = activity.revisionIds.filter((id) => {
      const item = byId.get(id);
      return item?.status === "completed" && item.evidenceRefs.length > 0;
    });
    if (completedIds.length === 0) continue;
    for (const id of activity.revisionIds) {
      const item = byId.get(id);
      if (
        item?.status === "ready" && item.evidenceRefs.length === 0 &&
        isExplicitPredecessorOf(id, completedIds, byId)
      ) {
        closed.push(id);
      }
    }
  }
  return closed;
}

function isExplicitPredecessorOf(
  revisionId: string,
  completedIds: readonly string[],
  byId: ReadonlyMap<string, EngineeringWorkItem>,
): boolean {
  for (const completedId of completedIds) {
    let cursor = byId.get(completedId);
    const seen = new Set<string>();
    while (cursor?.predecessorRevisionId && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.predecessorRevisionId === revisionId) return true;
      cursor = byId.get(cursor.predecessorRevisionId);
    }
  }
  return false;
}

/**
 * Produce the calm, human-facing project path from explicit activity identity.
 * Failed and cancelled attempts remain visible inside their revision.
 */
export function buildProjectPath(
  snapshot: EngineeringProjectSnapshot,
  _thread: ThreadWorkbenchSnapshot,
  projectedActivities: readonly EngineeringWorkbenchActivity[] =
    collectEngineeringActivities(
      snapshot.workItems,
    ).map((activity) => ({
      id: activity.id,
      lane: "system-model",
      rootRevisionId: activity.rootRevisionId,
      revisionIds: activity.revisionIds,
    })),
  caseActivityJoins: readonly EngineeringWorkbenchCaseActivityJoin[] = [],
): ProjectPath {
  const workById = new Map(snapshot.workItems.map((item) => [item.id, item]));
  const runById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
  const historicalWorkItemIds = new Set(
    buildCurrentProjectWork(snapshot).historicalWorkItemIds,
  );
  const activities = projectedActivities.map((projected) => {
    const revisions = projected.revisionIds.flatMap((id) => {
      const item = workById.get(id);
      return item
        ? [projectPathRevision(
          item,
          runById,
          projected.id,
          caseActivityJoins,
        )]
        : [];
    });
    const root = workById.get(projected.rootRevisionId);
    const status = deriveProjectPathActivityStatus(
      revisions,
      projected.id,
      snapshot.blockers,
    );
    const evidenceCount = revisions.reduce(
      (total, revision) =>
        total + (workById.get(revision.id)?.evidenceRefs.length ?? 0),
      0,
    );
    const decisionIds = new Set(
      revisions.flatMap((revision) =>
        workById.get(revision.id)?.decisionIds ?? []
      ),
    );
    const decisions = snapshot.decisions.filter((decision) =>
      decisionIds.has(decision.id)
    );
    return {
      id: projected.id,
      lane: projected.lane,
      title: root?.title ?? projected.id,
      status,
      revisions,
      approvedDecisions: decisions.filter((decision) =>
        isEngineeringDecisionSatisfied(snapshot, decision)
      ).length,
      requiredDecisions: decisions.length,
      evidenceCount,
    };
  });
  const visible = activities.filter((activity) =>
    !activity.revisions.every((revision) =>
      historicalWorkItemIds.has(revision.id) &&
      workById.get(revision.id)?.status === "ready"
    )
  );
  const pendingDecisions = snapshot.decisions.filter(isPendingDecision);
  return {
    status: deriveProjectPathStatus(visible, pendingDecisions),
    activities: visible,
    completedActivities: visible.filter((item) => item.status === "completed")
      .length,
    pendingDecisions,
  };
}

function deriveProjectPathActivityStatus(
  revisions: readonly ProjectPathRevisionView[],
  activityId: string,
  blockers: readonly EngineeringBlocker[],
): EngineeringPhaseStatus {
  const leafIds = new Set(
    leafRevisionIdsForActivity(revisions.map((revision) => ({
      id: revision.id,
      activityId,
      ...(revision.predecessorRevisionId
        ? { predecessorRevisionId: revision.predecessorRevisionId }
        : {}),
    }))),
  );
  if (
    blockers.some((blocker) =>
      blocker.status === "open" &&
      blocker.workItemIds.some((id) => leafIds.has(id))
    )
  ) {
    return "blocked";
  }
  const runs = revisions.flatMap((revision) =>
    revision.attempts.map((attempt) => attempt.run)
  );
  if (
    runs.some((run) =>
      run.status === "queued" || run.status === "running" ||
      run.status === "waiting-for-decision" || run.status === "publishing"
    )
  ) {
    return "active";
  }
  if (
    revisions.some((revision) =>
      revision.status === "waiting-for-decision" ||
      revision.status === "in-progress"
    )
  ) {
    return "active";
  }
  const leaves = revisions.filter((revision) => leafIds.has(revision.id));
  if (
    leaves.length > 0 &&
    leaves.every((revision) => revision.status === "completed")
  ) {
    return "completed";
  }
  return "planned";
}

function projectPathRevision(
  item: EngineeringWorkItem,
  runById: ReadonlyMap<string, EngineeringAgentRun>,
  activityId: string,
  caseActivityJoins: readonly EngineeringWorkbenchCaseActivityJoin[],
): ProjectPathRevisionView {
  const attempts = attemptIdsForRevision([...runById.values()], item.id)
    .flatMap((id) => {
      const run = runById.get(id);
      return run
        ? [{
          run,
          cases: casesAttachedToExistingAttempt(
            caseActivityJoins,
            activityId,
            item.id,
            run.id,
          ),
        }]
        : [];
    });
  return {
    id: item.id,
    ...(item.predecessorRevisionId
      ? { predecessorRevisionId: item.predecessorRevisionId }
      : {}),
    title: item.title,
    status: item.status,
    attempts,
  };
}

/**
 * Attach an exact Thread case only when the join already names this activity,
 * revision and attempt. A join never creates a gate or a predecessor.
 */
function casesAttachedToExistingAttempt(
  joins: readonly EngineeringWorkbenchCaseActivityJoin[],
  activityId: string,
  workItemId: string,
  runId: string,
): readonly ProjectPathCaseRef[] {
  return joins
    .filter((join) =>
      join.activityId === activityId &&
      join.workItemId === workItemId &&
      join.runId === runId
    )
    .map((join) => ({
      caseKey: join.caseKey,
      caseId: join.caseId,
      caseRevision: join.caseRevision,
    }))
    .toSorted((left, right) => left.caseKey.localeCompare(right.caseKey));
}

export function agentRunRecordedAt(run: EngineeringAgentRun): string {
  return run.cancellation?.cancelledAt ?? run.completedAt ?? run.startedAt ??
    run.queuedAt;
}

function deriveProjectPathStatus(
  activities: readonly ProjectPathActivityView[],
  pendingDecisions: readonly EngineeringDecision[],
): EngineeringProjectStatus {
  if (activities.length === 0) return "planned";
  if (activities.every((activity) => activity.status === "completed")) {
    return "completed";
  }
  if (pendingDecisions.length > 0) return "attention-required";
  if (activities.some((activity) => activity.status === "blocked")) {
    return "blocked";
  }
  if (activities.some((activity) => activity.status === "active")) {
    return "active";
  }
  return "planned";
}

function isPendingDecision(decision: EngineeringDecision): boolean {
  return decision.status === "required" || decision.status === "proposed" ||
    decision.status === "rejected";
}

function graphRefKey(ref: Pick<ThreadGraphRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id}`;
}

function threadEntityReferenceKeys(
  item: EngineeringWorkItem,
): ReadonlySet<string> {
  return new Set(
    item.operation?.bindings.flatMap((binding) =>
      binding.source.kind === "thread-entity"
        ? [graphRefKey(binding.source.reference)]
        : []
    ) ?? [],
  );
}

export function projectStatusLabel(status: EngineeringProjectStatus): string {
  if (status === "attention-required") return "Decision required";
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  if (status === "completed") return "Completed";
  if (status === "planned") return "Planned";
  return "Planned";
}

export function phaseStatusLabel(status: EngineeringPhaseStatus): string {
  if (status === "completed") return "Completed";
  if (status === "active") return "In progress";
  if (status === "blocked") return "Blocked";
  if (status === "planned") return "Planned";
  const _never: never = status;
  return _never;
}

export function projectBriefStatusLabel(brief: ProjectBrief): string {
  if (brief.status !== "attention-required") {
    return projectStatusLabel(brief.status);
  }
  if (
    brief.pendingDecisions.some((decision) => decision.status === "proposed")
  ) {
    return "Review required";
  }
  if (
    brief.pendingDecisions.some((decision) =>
      decision.status === "required" || decision.status === "rejected"
    )
  ) {
    return "Agent preparing proposal";
  }
  return "Attention required";
}

export function projectPathStatusLabel(path: ProjectPath): string {
  if (path.status !== "attention-required") {
    return projectStatusLabel(path.status);
  }
  if (
    path.pendingDecisions.some((decision) => decision.status === "proposed")
  ) {
    return "Review required";
  }
  if (
    path.pendingDecisions.some((decision) =>
      decision.status === "required" || decision.status === "rejected"
    )
  ) return "Agent preparing proposal";
  return "Attention required";
}

export function projectStatusTone(
  status: EngineeringProjectStatus,
): "neutral" | "active" | "attention" | "blocked" | "complete" {
  if (status === "attention-required") return "attention";
  if (status === "active") return "active";
  if (status === "blocked") return "blocked";
  if (status === "completed") return "complete";
  return "neutral";
}

export function workOwnerLabel(owner: EngineeringWorkItem["owner"]): string {
  if (owner === "shared") return "Agent + human review";
  return owner === "human" ? "Human review" : "Agent";
}

export function workStatusLabel(status: EngineeringWorkItem["status"]): string {
  return status.replaceAll("-", " ");
}

/**
 * Compact Activity pulse chip: the current run or work status as literal
 * Badge text, so planned/cancelled/completed stay readable when collapsed.
 */
export function projectPulseStatus(
  presentation:
    | {
      readonly kind: "active-run" | "last-settled-run";
      readonly run: { readonly status: string };
    }
    | {
      readonly kind: "current-work";
      readonly work: { readonly status: string };
    }
    | { readonly kind: "empty" },
): { readonly status: string; readonly label: string } {
  if (
    presentation.kind === "active-run" ||
    presentation.kind === "last-settled-run"
  ) {
    return {
      status: presentation.run.status,
      label: sentenceStatusLabel(presentation.run.status),
    };
  }
  if (presentation.kind === "current-work") {
    return {
      status: presentation.work.status,
      label: sentenceStatusLabel(presentation.work.status),
    };
  }
  return { status: "idle", label: "Idle" };
}

function sentenceStatusLabel(status: string): string {
  const label = status.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/**
 * The overview leads with the current engineering decision, while the full
 * Evidence space retains every historical criterion and relation for review.
 */
export function verificationChainDetail(
  thread: ThreadWorkbenchSnapshot,
): string {
  const requirements = currentRequirements(
    thread.requirements,
    thread.evidenceFamilyGraph,
  );
  const historicalCount = thread.requirements.length - requirements.length;
  const passed = requirements.filter((item) => item.status === "pass").length;
  const failed = requirements.filter((item) => item.status === "fail").length;
  const unresolved = requirements.length - passed - failed;
  const currentDetail = requirements.length === 0
    ? "No current modelled criteria"
    : `${passed}/${requirements.length} current criteria passing`;
  const verdictDetail = failed > 0
    ? `${failed} failed`
    : unresolved > 0
    ? `${unresolved} unresolved`
    : `${thread.violations.length} named violations`;
  const historyDetail = historicalCount > 0
    ? `${historicalCount} historical record${historicalCount === 1 ? "" : "s"}`
    : `${thread.graph.edges.length} recorded relations`;
  return `${currentDetail} · ${verdictDetail} · ${historyDetail}.`;
}

/**
 * Run summaries come from an agent-facing command surface. The cockpit is not
 * an audit-log dump: a short token or an accidental pasted fragment should not
 * become the most prominent explanation of current work. Exact records remain
 * available in the execution history.
 */
export function agentRunSummary(
  snapshot: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string {
  const summary = run.summary.trim();
  if (isReadableRunSummary(summary)) return summary;

  const workItem = snapshot.workItems.find((item) =>
    item.id === run.workItemId
  );
  return workItem
    ? `Working on: ${workItem.title}`
    : "The agent is working on a recorded engineering task.";
}

function isReadableRunSummary(value: string): boolean {
  // A useful status sentence has enough context to be understood without
  // opening the technical record. This deliberately treats terse placeholders
  // such as "dsadsadas" as malformed UI content, not engineering truth.
  return value.length >= 12 && /\s/.test(value) &&
    /[A-Za-zÀ-ÖØ-öø-ÿ]{3}/.test(value);
}
