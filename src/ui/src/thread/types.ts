/**
 * Browser-safe projection of the linked engineering thread.
 *
 * This contract deliberately contains no MCP transport types. The backend owns
 * tool calls and projects their persisted, linked evidence into this snapshot.
 */

import {
  ENGINEERING_WORKBENCH_SCHEMA,
  LIVE_THREAD_OVERLAY_SCHEMA,
} from "../../../presentation/workbench/engineering/schema.ts";
import {
  ENGINEERING_PATH_LANE_IDS,
  type EngineeringPathLaneId,
} from "../../../domain/project/engineering-path-lane.ts";
import type {
  EngineeringDocumentaryTechnicalStart,
  EngineeringDocumentaryTechnicalStartState,
  EngineeringDocumentaryTechnicalStartStep,
  EngineeringDocumentaryWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/documentary.ts";
import type {
  EngineeringEvidenceWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/evidence.ts";
import type {
  EngineeringPlanningActivity,
  EngineeringPlanningActivityMilestone,
  EngineeringPlanningAgentRunStatus,
  EngineeringPlanningBaselineRun,
  EngineeringPlanningBaselineRunMilestone,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
} from "../../../presentation/workbench/engineering/planning.ts";
import type {
  LiveThreadOverlay,
  LiveThreadOverlayActivity,
  LiveThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/live-overlay.ts";
import type { EngineeringWorkbenchSnapshot } from "../../../presentation/workbench/engineering/snapshot.ts";
import type {
  ThreadAnalysisEdgeDetail,
  ThreadAnalysisNodeDetail,
  ThreadAnalysisQuantity,
  ThreadAnalysisScope,
  ThreadAnalysisSemanticRef,
  ThreadFreshness,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphEdgeAttestation,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadGraphRelation,
  ThreadRef,
} from "../../../presentation/workbench/thread/graph.ts";
import type {
  EngineeringCase,
  EngineeringCaseCatalog,
  EngineeringCaseCoverage,
  EngineeringCaseFamily,
  EngineeringCaseIssue,
  ThreadChange,
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyEdgeRef,
  ThreadEvidenceFamilyGraph,
  ThreadEvidenceFamilyGraphEdge,
  ThreadEvidenceFamilyOmittedCycleEdge,
  ThreadEvidenceFamilyOmittedSelfLoop,
  ThreadEvidenceFamilyTransition,
  ThreadFlowStage,
} from "../../../presentation/workbench/thread/evidence.ts";
import {
  ENGINEERING_CASE_CATALOG_SCHEMA,
  ENGINEERING_CASE_FAMILIES,
  ENGINEERING_CASE_SCHEMA_BY_FAMILY,
} from "../../../presentation/workbench/thread/evidence.ts";
import {
  THREAD_WORKBENCH_SCHEMA,
  type ThreadAction,
  type ThreadArtifact,
  type ThreadObservation,
  type ThreadRequirement,
  type ThreadViolation,
  type ThreadWorkbenchPreviousSnapshot,
  type ThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/thread/snapshot.ts";
import {
  collectEngineeringActivities,
  collectEngineeringActivityLifecycleIssues,
  engineeringActivityIdFromRootRevision,
} from "../../../domain/project/engineering-activity.ts";
import {
  isEngineeringProjectSnapshot,
  isEngineeringPublicPretechnicalProjectSnapshot,
} from "../project/contract.ts";

export type {
  ThreadAction,
  ThreadArtifact,
  ThreadObservation,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchPreviousSnapshot,
  ThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/thread/snapshot.ts";
export type {
  EngineeringCase,
  EngineeringCaseCatalog,
  EngineeringCaseCoverage,
  EngineeringCaseFamily,
  EngineeringCaseIssue,
  ThreadChange,
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyEdgeRef,
  ThreadEvidenceFamilyGraph,
  ThreadEvidenceFamilyGraphEdge,
  ThreadEvidenceFamilyOmittedCycleEdge,
  ThreadEvidenceFamilyOmittedSelfLoop,
  ThreadEvidenceFamilyTransition,
  ThreadFlowStage,
} from "../../../presentation/workbench/thread/evidence.ts";
export type {
  ThreadFreshness,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphEdgeAttestation,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadGraphRelation,
  ThreadRef,
  ThreadTone,
} from "../../../presentation/workbench/thread/graph.ts";

export {
  ENGINEERING_WORKBENCH_SCHEMA,
  LIVE_THREAD_OVERLAY_SCHEMA,
} from "../../../presentation/workbench/engineering/schema.ts";
export { THREAD_WORKBENCH_SCHEMA } from "../../../presentation/workbench/thread/snapshot.ts";
export type {
  EngineeringDocumentaryTechnicalStart,
  EngineeringDocumentaryTechnicalStartState,
  EngineeringDocumentaryTechnicalStartStep,
  EngineeringDocumentaryWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/documentary.ts";
export type {
  EngineeringEvidenceWorkbenchSnapshot,
  EngineeringWorkbenchActivity,
  EngineeringWorkbenchAlignment,
  EngineeringWorkbenchBaseSnapshot,
  EngineeringWorkbenchCaseActivityJoin,
  EngineeringWorkbenchPhaseLane,
  EngineeringWorkbenchProjectPathProjection,
} from "../../../presentation/workbench/engineering/evidence.ts";
export type {
  EngineeringPlanningActivity,
  EngineeringPlanningActivityMilestone,
  EngineeringPlanningAgentRunStatus,
  EngineeringPlanningBaselineRun,
  EngineeringPlanningBaselineRunMilestone,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
} from "../../../presentation/workbench/engineering/planning.ts";
export type { EngineeringWorkbenchSnapshot } from "../../../presentation/workbench/engineering/snapshot.ts";
export type {
  LiveThreadGraphState,
  LiveThreadOverlay,
  LiveThreadOverlayActivity,
  LiveThreadUpdateState,
  LiveThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/live-overlay.ts";

export function isEngineeringWorkbenchSnapshot(
  value: unknown,
): value is EngineeringWorkbenchSnapshot {
  if (!isRecord(value)) return false;
  const candidate = value as
    & Record<string, unknown>
    & Partial<EngineeringWorkbenchSnapshot>;
  if (candidate.schemaVersion !== ENGINEERING_WORKBENCH_SCHEMA) {
    return false;
  }
  if (candidate.surface === "planning") {
    return hasExactKeys(candidate, [
      "schemaVersion",
      "surface",
      "project",
      "planning",
    ]) && isEngineeringPublicPretechnicalProjectSnapshot(candidate.project) &&
      candidate.project.threadSnapshots.length === 0 &&
      isPlanningWorkbenchProjection(candidate.planning);
  }
  if (candidate.surface === "documentary") {
    if (!isEngineeringPublicPretechnicalProjectSnapshot(candidate.project)) {
      return false;
    }
    const reference = candidate.project.threadSnapshots[0];
    return hasExactKeys(candidate, [
      "schemaVersion",
      "surface",
      "project",
      "documentary",
    ]) && candidate.project.threadSnapshots.length === 1 &&
      reference !== undefined &&
      isDocumentaryWorkbenchProjection(candidate.documentary) &&
      candidate.documentary.record.snapshotId === reference.snapshotId &&
      candidate.documentary.record.snapshotRevision === reference.revision;
  }
  return candidate.surface === "evidence" &&
    isEvidenceWorkbenchSnapshot(candidate);
}

function isEvidenceWorkbenchSnapshot(
  value: unknown,
): value is EngineeringEvidenceWorkbenchSnapshot {
  if (!isRecord(value)) return false;
  const candidate = value as
    & Record<string, unknown>
    & Partial<EngineeringEvidenceWorkbenchSnapshot>;
  if (
    !hasExactKeys(candidate, [
      "schemaVersion",
      "surface",
      "project",
      "thread",
      "projectPath",
      "alignment",
      "caseActivityJoins",
      "unresolvedEvidenceReferences",
    ]) ||
    !isEngineeringProjectSnapshot(candidate.project) ||
    !isLiveThreadWorkbenchSnapshot(candidate.thread) ||
    !isProjectPathProjection(candidate.projectPath, candidate.project) ||
    !isWorkbenchAlignment(candidate.alignment) ||
    !isCaseActivityJoinList(
      candidate.caseActivityJoins,
      candidate.project,
      candidate.thread,
    ) ||
    !isUnresolvedEvidenceReferenceList(candidate.unresolvedEvidenceReferences)
  ) {
    return false;
  }
  const { project, thread, alignment } = candidate;
  const projectThreadRevision = Math.max(
    ...project.threadSnapshots.map((reference) => reference.revision),
  );
  const linkedReference = project.threadSnapshots.some((reference) =>
    reference.snapshotId === thread.id &&
    reference.subjectId === thread.subject.id &&
    reference.revision === projectThreadRevision
  );
  return project.threadSnapshots.length > 0 &&
    project.project.subjectId === thread.subject.id &&
    linkedReference &&
    alignment.projectThreadRevision === projectThreadRevision &&
    alignment.currentThreadRevision >= projectThreadRevision &&
    thread.evidenceFamilyGraph.asOf.snapshotId === thread.id &&
    thread.evidenceFamilyGraph.asOf.revision ===
      alignment.currentThreadRevision &&
    thread.live.active.every((activity) =>
      activity.baseRevision <= alignment.currentThreadRevision
    ) &&
    alignment.status ===
      (alignment.currentThreadRevision === projectThreadRevision
        ? "aligned"
        : "thread-ahead");
}

function isProjectPathProjection(
  value: unknown,
  project: EngineeringEvidenceWorkbenchSnapshot["project"],
): value is EngineeringEvidenceWorkbenchSnapshot["projectPath"] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["phaseLanes", "activities"]) ||
    !Array.isArray(value.phaseLanes) ||
    !Array.isArray(value.activities)
  ) {
    return false;
  }
  const knownPhaseIds = new Set(project.phases.map((phase) => phase.id));
  const knownWorkItemIds = new Set(project.workItems.map((item) => item.id));
  const projectedPhaseIds = new Set<string>();
  for (const entry of value.phaseLanes) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["phaseId", "lane"]) ||
      typeof entry.phaseId !== "string" ||
      !knownPhaseIds.has(entry.phaseId) ||
      projectedPhaseIds.has(entry.phaseId) ||
      !isEngineeringPathLaneId(entry.lane)
    ) {
      return false;
    }
    projectedPhaseIds.add(entry.phaseId);
  }
  if (projectedPhaseIds.size !== knownPhaseIds.size) return false;
  if (
    collectEngineeringActivityLifecycleIssues(project.workItems).length > 0
  ) {
    return false;
  }
  const domainActivities = collectEngineeringActivities(project.workItems);
  if (value.activities.length !== domainActivities.length) return false;
  const expectedById = new Map(
    domainActivities.map((activity) => [activity.id, activity]),
  );
  const projectedActivityIds = new Set<string>();
  for (const activity of value.activities) {
    if (
      !isRecord(activity) ||
      !hasExactKeys(activity, [
        "id",
        "lane",
        "rootRevisionId",
        "revisionIds",
      ]) ||
      typeof activity.id !== "string" ||
      projectedActivityIds.has(activity.id) ||
      !isEngineeringPathLaneId(activity.lane) ||
      typeof activity.rootRevisionId !== "string" ||
      !Array.isArray(activity.revisionIds)
    ) {
      return false;
    }
    const expected = expectedById.get(activity.id);
    if (
      expected === undefined ||
      activity.id !==
        engineeringActivityIdFromRootRevision(expected.rootRevisionId) ||
      activity.rootRevisionId !== expected.rootRevisionId ||
      activity.revisionIds.length !== expected.revisionIds.length ||
      activity.revisionIds.some((id, index) =>
        id !== expected.revisionIds[index]
      )
    ) {
      return false;
    }
    projectedActivityIds.add(activity.id);
  }
  return projectedActivityIds.size === domainActivities.length &&
    knownWorkItemIds.size ===
      domainActivities.reduce(
        (total, activity) => total + activity.revisionIds.length,
        0,
      );
}

function isEngineeringPathLaneId(
  value: unknown,
): value is EngineeringPathLaneId {
  return typeof value === "string" &&
    (ENGINEERING_PATH_LANE_IDS as readonly string[]).includes(value);
}

function isCaseActivityJoinList(
  value: unknown,
  project: EngineeringEvidenceWorkbenchSnapshot["project"],
  thread: EngineeringEvidenceWorkbenchSnapshot["thread"],
): value is EngineeringEvidenceWorkbenchSnapshot["caseActivityJoins"] {
  if (!Array.isArray(value)) return false;
  const knownWork = new Map(project.workItems.map((item) => [item.id, item]));
  const knownRuns = new Map(project.agentRuns.map((run) => [run.id, run]));
  const knownCases = new Map(
    (thread.engineeringCases?.cases ?? []).map((item) => [item.key, item]),
  );
  const seenKeys = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "caseKey",
        "caseId",
        "caseRevision",
        "activityId",
        "workItemId",
        "runId",
      ]) ||
      typeof entry.caseKey !== "string" ||
      typeof entry.caseId !== "string" ||
      !Number.isSafeInteger(entry.caseRevision) ||
      (entry.caseRevision as number) <= 0 ||
      typeof entry.activityId !== "string" ||
      typeof entry.workItemId !== "string" ||
      typeof entry.runId !== "string" ||
      seenKeys.has(entry.caseKey)
    ) {
      return false;
    }
    seenKeys.add(entry.caseKey);
    const workItem = knownWork.get(entry.workItemId);
    const run = knownRuns.get(entry.runId);
    const engineeringCase = knownCases.get(entry.caseKey);
    if (
      !workItem || workItem.activityId !== entry.activityId ||
      !run || run.workItemId !== entry.workItemId
    ) {
      return false;
    }
    if (thread.engineeringCases === undefined) return false;
    if (
      !engineeringCase ||
      engineeringCase.id !== entry.caseId ||
      engineeringCase.revision !== entry.caseRevision ||
      engineeringCase.authorityArtifactIds.length === 0
    ) {
      return false;
    }
    const artifactsById = new Map(
      thread.artifacts.map((artifact) => [artifact.id, artifact]),
    );
    for (const artifactId of engineeringCase.authorityArtifactIds) {
      const artifact = artifactsById.get(artifactId);
      if (!artifact || artifact.producerRunId !== entry.runId) return false;
    }
  }
  return true;
}

function isUnresolvedEvidenceReferenceList(
  value: unknown,
): value is EngineeringEvidenceWorkbenchSnapshot[
  "unresolvedEvidenceReferences"
] {
  return Array.isArray(value) && value.every((entry) =>
    isRecord(entry) &&
    hasExactKeys(entry, ["path", "message"]) &&
    typeof entry.path === "string" &&
    typeof entry.message === "string"
  );
}

function isWorkbenchAlignment(
  value: unknown,
): value is EngineeringEvidenceWorkbenchSnapshot["alignment"] {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, [
    "status",
    "projectThreadRevision",
    "currentThreadRevision",
  ]) &&
    (value.status === "aligned" || value.status === "thread-ahead") &&
    isPositiveSafeInteger(value.projectThreadRevision) &&
    isPositiveSafeInteger(value.currentThreadRevision);
}

function isDocumentaryWorkbenchProjection(
  value: unknown,
): value is EngineeringDocumentaryWorkbenchSnapshot["documentary"] {
  if (!value || typeof value !== "object") return false;
  const documentary = value as Partial<
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]
  >;
  if (
    !hasAllowedKeys(documentary, [
      "status",
      "message",
      "record",
      "technicalEvidence",
      "technicalStart",
    ]) ||
    documentary.status !== "recorded" ||
    typeof documentary.message !== "string" ||
    !isDocumentaryRecord(documentary.record) ||
    !isDocumentaryTechnicalEvidence(documentary.technicalEvidence) ||
    (documentary.technicalStart !== undefined &&
      !isDocumentaryTechnicalStart(documentary.technicalStart))
  ) {
    return false;
  }
  return true;
}

function isDocumentaryTechnicalStart(
  value: unknown,
): value is EngineeringDocumentaryTechnicalStart {
  if (!value || typeof value !== "object") return false;
  const start = value as Partial<EngineeringDocumentaryTechnicalStart>;
  return hasExactKeys(start, ["kind", "state", "message", "activity"]) &&
    start.kind === "sysml-container-seed" &&
    isDocumentaryTechnicalStartState(start.state) &&
    typeof start.message === "string" &&
    isDocumentaryTechnicalStartActivity(start.activity);
}

function isDocumentaryTechnicalStartState(
  value: unknown,
): value is EngineeringDocumentaryTechnicalStartState {
  return value === "queued" || value === "running" ||
    value === "publishing" || value === "failed";
}

function isDocumentaryTechnicalStartActivity(
  value: unknown,
): value is EngineeringDocumentaryTechnicalStart["activity"] {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<
    EngineeringDocumentaryTechnicalStart["activity"]
  >;
  return hasExactKeys(activity, ["version", "steps"]) &&
    typeof activity.version === "number" &&
    Number.isSafeInteger(activity.version) && activity.version >= 0 &&
    Array.isArray(activity.steps) &&
    activity.steps.every(isDocumentaryTechnicalStartStep) &&
    new Set(activity.steps.map((step) => step.id)).size ===
      activity.steps.length;
}

function isDocumentaryTechnicalStartStep(
  value: unknown,
): value is EngineeringDocumentaryTechnicalStartStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<EngineeringDocumentaryTechnicalStartStep>;
  if (
    !hasAllowedKeys(step, [
      "id",
      "state",
      "label",
      "summary",
      "recordedAt",
      "predecessor",
    ]) ||
    !isDocumentaryTechnicalStartStepId(step.id) ||
    !isDocumentaryTechnicalStartStepState(step.state) ||
    typeof step.label !== "string" ||
    typeof step.summary !== "string" ||
    typeof step.recordedAt !== "string"
  ) {
    return false;
  }
  return step.id === "project-container"
    ? step.predecessor === undefined
    : step.id === "sysml-document"
    ? step.predecessor === "project-container"
    : step.predecessor === "sysml-document";
}

function isDocumentaryTechnicalStartStepId(
  value: unknown,
): value is EngineeringDocumentaryTechnicalStartStep["id"] {
  return value === "project-container" || value === "sysml-document" ||
    value === "root-package";
}

function isDocumentaryTechnicalStartStepState(
  value: unknown,
): value is EngineeringDocumentaryTechnicalStartStep["state"] {
  return value === "running" || value === "fresh" || value === "failed";
}

function isDocumentaryRecord(
  value: unknown,
): value is EngineeringDocumentaryWorkbenchSnapshot["documentary"]["record"] {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]["record"]
  >;
  return hasAllowedKeys(record, [
    "origin",
    "snapshotId",
    "snapshotRevision",
    "artifactId",
    "label",
    "fingerprint",
    "uri",
    "recordedAt",
  ]) && record.origin === "approved-brief" &&
    typeof record.snapshotId === "string" &&
    typeof record.snapshotRevision === "number" &&
    Number.isSafeInteger(record.snapshotRevision) &&
    record.snapshotRevision > 0 &&
    typeof record.artifactId === "string" &&
    typeof record.label === "string" &&
    typeof record.fingerprint === "string" && record.fingerprint.length > 0 &&
    (record.uri === undefined || typeof record.uri === "string") &&
    typeof record.recordedAt === "string";
}

function isDocumentaryTechnicalEvidence(
  value: unknown,
): value is EngineeringDocumentaryWorkbenchSnapshot["documentary"][
  "technicalEvidence"
] {
  if (!value || typeof value !== "object") return false;
  const technicalEvidence = value as Partial<
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]["technicalEvidence"]
  >;
  return hasExactKeys(technicalEvidence, ["status", "message"]) &&
    technicalEvidence.status === "not-recorded" &&
    typeof technicalEvidence.message === "string";
}

function isPlanningWorkbenchProjection(
  value: unknown,
): value is EngineeringPlanningWorkbenchSnapshot["planning"] {
  if (!value || typeof value !== "object") return false;
  const planning = value as Partial<
    EngineeringPlanningWorkbenchSnapshot["planning"]
  >;
  const hasBaseline = planning.baselineRun !== undefined &&
    isPlanningBaselineRun(planning.baselineRun);
  return hasAllowedKeys(planning, [
    "technicalBaseline",
    "baselineRun",
    "activity",
  ]) && !!planning.technicalBaseline &&
    isTechnicalBaseline(planning.technicalBaseline) &&
    isPlanningActivity(planning.activity) &&
    (hasBaseline
      ? planning.technicalBaseline.status ===
        technicalBaselineStatusForRun(planning.baselineRun.status)
      : planning.baselineRun === undefined &&
        planning.technicalBaseline.status === "not-created" &&
        planning.activity.milestones.length === 0);
}

function isTechnicalBaseline(
  value: unknown,
): value is EngineeringPlanningWorkbenchSnapshot["planning"][
  "technicalBaseline"
] {
  if (!value || typeof value !== "object") return false;
  const baseline = value as Partial<
    EngineeringPlanningWorkbenchSnapshot["planning"]["technicalBaseline"]
  >;
  return hasExactKeys(baseline, ["status", "message"]) &&
    typeof baseline.message === "string" &&
    isTechnicalBaselineStatus(baseline.status);
}

function isTechnicalBaselineStatus(
  value: unknown,
): value is EngineeringTechnicalBaselineStatus {
  return value === "not-created" || value === "queued" ||
    value === "running" || value === "publishing" || value === "failed";
}

function isPlanningBaselineRun(
  value: unknown,
): value is EngineeringPlanningBaselineRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<EngineeringPlanningBaselineRun>;
  return hasAllowedKeys(run, [
    "id",
    "status",
    "workItem",
    "queuedAt",
    "startedAt",
    "completedAt",
    "statusHistory",
  ]) && typeof run.id === "string" &&
    isPlanningAgentRunStatus(run.status) &&
    !!run.workItem && hasExactKeys(run.workItem, ["id", "title", "kind"]) &&
    typeof run.workItem.id === "string" &&
    typeof run.workItem.title === "string" &&
    isEngineeringWorkItemKind(run.workItem.kind) &&
    typeof run.queuedAt === "string" &&
    (run.startedAt === undefined || typeof run.startedAt === "string") &&
    (run.completedAt === undefined || typeof run.completedAt === "string") &&
    Array.isArray(run.statusHistory) &&
    run.statusHistory.every(isPlanningBaselineRunMilestone);
}

function isEngineeringWorkItemKind(value: unknown): boolean {
  return value === "define" || value === "architect" || value === "design" ||
    value === "simulate" || value === "verify" || value === "industrialize" ||
    value === "review";
}

function isPlanningBaselineRunMilestone(
  value: unknown,
): value is EngineeringPlanningBaselineRunMilestone {
  if (!value || typeof value !== "object") return false;
  const milestone = value as Partial<EngineeringPlanningBaselineRunMilestone>;
  return hasExactKeys(milestone, ["status", "at"]) &&
    isPlanningAgentRunStatus(milestone.status) &&
    typeof milestone.at === "string";
}

function isPlanningAgentRunStatus(
  value: unknown,
): value is EngineeringPlanningAgentRunStatus {
  return value === "queued" || value === "running" ||
    value === "waiting-for-decision" || value === "publishing" ||
    value === "completed" || value === "failed" || value === "cancelled";
}

function technicalBaselineStatusForRun(
  status: EngineeringPlanningAgentRunStatus,
): EngineeringTechnicalBaselineStatus {
  if (status === "queued") return "queued";
  if (status === "running" || status === "waiting-for-decision") {
    return "running";
  }
  if (status === "publishing") return "publishing";
  if (status === "failed") return "failed";
  return "not-created";
}

function isPlanningActivity(
  value: unknown,
): value is EngineeringPlanningActivity {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<EngineeringPlanningActivity>;
  if (
    !hasExactKeys(activity, ["version", "milestones"]) ||
    typeof activity.version !== "number" ||
    !Number.isSafeInteger(activity.version) || activity.version < 0 ||
    !Array.isArray(activity.milestones)
  ) {
    return false;
  }
  const { version, milestones } = activity;
  return milestones.every(isPlanningActivityMilestone) &&
    milestones.every((milestone) => milestone.sequence <= version) &&
    milestones.every((milestone, index) => {
      if (index === 0) return true;
      const previous = milestones[index - 1];
      return previous !== undefined && milestone.sequence > previous.sequence;
    });
}

function isPlanningActivityMilestone(
  value: unknown,
): value is EngineeringPlanningActivityMilestone {
  if (!value || typeof value !== "object") return false;
  const milestone = value as Partial<EngineeringPlanningActivityMilestone>;
  return hasExactKeys(milestone, ["sequence", "state", "recordedAt"]) &&
    typeof milestone.sequence === "number" &&
    Number.isSafeInteger(milestone.sequence) && milestone.sequence > 0 &&
    (milestone.state === "running" || milestone.state === "fresh" ||
      milestone.state === "failed" || milestone.state === "reconciled") &&
    typeof milestone.recordedAt === "string";
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isLiveThreadWorkbenchSnapshot(
  value: unknown,
): value is LiveThreadWorkbenchSnapshot {
  return isThreadWorkbenchSnapshot(value) && isRecord(value) &&
    isLiveThreadOverlay(value.live);
}

function isLiveThreadOverlay(value: unknown): value is LiveThreadOverlay {
  if (!isRecord(value)) return false;
  const version = value.version;
  if (
    !hasExactKeys(value, ["schemaVersion", "version", "active"]) ||
    value.schemaVersion !== LIVE_THREAD_OVERLAY_SCHEMA ||
    !isNonNegativeSafeInteger(version) ||
    !Array.isArray(value.active) ||
    !value.active.every(isLiveThreadOverlayActivity)
  ) {
    return false;
  }
  const activities = value.active as LiveThreadOverlayActivity[];
  return activities.every((activity) => activity.sequence <= version) &&
    activities.every((activity, index) =>
      index === 0 || activity.sequence > activities[index - 1]!.sequence
    );
}

function isLiveThreadOverlayActivity(
  value: unknown,
): value is LiveThreadOverlayActivity {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, [
    "runId",
    "operationId",
    "state",
    "recordedAt",
    "baseRevision",
    "sequence",
  ]) && typeof value.runId === "string" && value.runId.length > 0 &&
    typeof value.operationId === "string" && value.operationId.length > 0 &&
    (value.state === "running" || value.state === "fresh" ||
      value.state === "failed") &&
    typeof value.recordedAt === "string" &&
    isNonNegativeSafeInteger(value.baseRevision) &&
    isPositiveSafeInteger(value.sequence);
}

export function isThreadWorkbenchSnapshot(
  value: unknown,
): value is ThreadWorkbenchSnapshot {
  if (!isRecord(value)) return false;
  const candidate = value as
    & Record<string, unknown>
    & Partial<ThreadWorkbenchSnapshot>;
  return hasAllowedKeys(candidate, [
    "schemaVersion",
    "id",
    "subject",
    "generatedAt",
    "previous",
    "source",
    "sourceLabel",
    "change",
    "engineeringCases",
    "graph",
    "evidenceFamilyGraph",
    "flow",
    "artifacts",
    "observations",
    "requirements",
    "violations",
    "actions",
    "live",
  ]) && candidate.schemaVersion === THREAD_WORKBENCH_SCHEMA &&
    typeof candidate.id === "string" && candidate.id.length > 0 &&
    typeof candidate.generatedAt === "string" &&
    (candidate.previous === undefined ||
      isThreadWorkbenchPreviousSnapshot(candidate.previous)) &&
    isThreadSubject(candidate.subject) &&
    (candidate.source === "observed" || candidate.source === "fixture") &&
    typeof candidate.sourceLabel === "string" &&
    isThreadChange(candidate.change) &&
    isThreadGraph(candidate.graph) &&
    isThreadEvidenceFamilyGraph(
      candidate.evidenceFamilyGraph,
      candidate.graph,
    ) &&
    candidate.evidenceFamilyGraph.asOf.snapshotId === candidate.id &&
    Array.isArray(candidate.flow) &&
    candidate.flow.every(isThreadFlowStage) &&
    Array.isArray(candidate.artifacts) &&
    candidate.artifacts.every(isThreadArtifact) &&
    (candidate.engineeringCases === undefined
      ? candidate.graph.nodes.every((node) =>
        node.engineeringCaseRefs === undefined
      )
      : isEngineeringCaseCatalog(
        candidate.engineeringCases,
        candidate.artifacts,
        candidate.graph,
      )) &&
    Array.isArray(candidate.observations) &&
    candidate.observations.every(isThreadObservation) &&
    Array.isArray(candidate.requirements) &&
    candidate.requirements.every(isThreadRequirement) &&
    Array.isArray(candidate.violations) &&
    candidate.violations.every(isThreadViolation) &&
    Array.isArray(candidate.actions) &&
    candidate.actions.every(isThreadAction) &&
    (candidate.live === undefined || isLiveThreadOverlay(candidate.live));
}

function isThreadSubject(
  value: unknown,
): value is ThreadWorkbenchSnapshot["subject"] {
  return isRecord(value) && hasExactKeys(value, ["id", "label", "program"]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && typeof value.program === "string";
}

function isThreadChange(value: unknown): value is ThreadChange {
  return isRecord(value) && hasExactKeys(value, [
    "id",
    "title",
    "summary",
    "author",
    "revision",
    "changedAt",
    "status",
    "files",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.title === "string" && typeof value.summary === "string" &&
    typeof value.author === "string" && typeof value.revision === "string" &&
    typeof value.changedAt === "string" &&
    (value.status === "evaluated" || value.status === "partially_evaluated" ||
      value.status === "pending") &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string");
}

function isThreadArtifact(value: unknown): value is ThreadArtifact {
  if (!isRecord(value)) return false;
  return hasAllowedKeys(value, [
    "id",
    "label",
    "kind",
    "system",
    "producer",
    "revision",
    "freshness",
    "fingerprint",
    "uri",
    "producedAt",
    "producedBy",
    "producerRunId",
    "dependsOn",
    "attestation",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && typeof value.kind === "string" &&
    typeof value.system === "string" && typeof value.revision === "string" &&
    (value.producer === undefined ||
      isThreadArtifactProducer(value.producer)) &&
    isThreadFreshness(value.freshness) &&
    (value.fingerprint === undefined ||
      typeof value.fingerprint === "string") &&
    (value.uri === undefined || typeof value.uri === "string") &&
    (value.producedAt === undefined || typeof value.producedAt === "string") &&
    (value.producedBy === undefined || typeof value.producedBy === "string") &&
    (value.producerRunId === undefined ||
      (typeof value.producerRunId === "string" &&
        value.producerRunId.length > 0)) &&
    Array.isArray(value.dependsOn) &&
    value.dependsOn.every((id) => typeof id === "string") &&
    (value.attestation === undefined ||
      isThreadArtifactAttestation(value.attestation));
}

function isThreadArtifactProducer(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["serverId", "tool", "runId"]) &&
    typeof value.serverId === "string" && value.serverId.length > 0 &&
    typeof value.tool === "string" && value.tool.length > 0 &&
    typeof value.runId === "string" && value.runId.length > 0;
}

function isThreadArtifactAttestation(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "status",
    "sourceArtifactId",
    "producerFingerprint",
    "consumedFingerprint",
    "checkedAt",
  ]) && (value.status === "verified" || value.status === "mismatch") &&
    typeof value.sourceArtifactId === "string" &&
    typeof value.producerFingerprint === "string" &&
    typeof value.consumedFingerprint === "string" &&
    typeof value.checkedAt === "string";
}

function isThreadObservation(value: unknown): value is ThreadObservation {
  return isRecord(value) && hasAllowedKeys(value, [
    "id",
    "label",
    "value",
    "unit",
    "display",
    "sourceArtifactId",
    "requirementIds",
    "freshness",
    "measuredAt",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && typeof value.value === "number" &&
    Number.isFinite(value.value) && typeof value.unit === "string" &&
    typeof value.display === "string" &&
    typeof value.sourceArtifactId === "string" &&
    Array.isArray(value.requirementIds) &&
    value.requirementIds.every((id) => typeof id === "string") &&
    isThreadFreshness(value.freshness) &&
    (value.measuredAt === undefined || typeof value.measuredAt === "string");
}

function isThreadViolation(value: unknown): value is ThreadViolation {
  return isRecord(value) && hasExactKeys(value, [
    "id",
    "name",
    "severity",
    "status",
    "requirementId",
    "observationId",
    "message",
    "margin",
    "evidence",
    "proposedActionIds",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.name === "string" &&
    (value.severity === "blocking" || value.severity === "warning") &&
    (value.status === "open" || value.status === "resolved") &&
    typeof value.requirementId === "string" &&
    typeof value.observationId === "string" &&
    typeof value.message === "string" &&
    typeof value.margin === "string" && Array.isArray(value.evidence) &&
    value.evidence.every((id) => typeof id === "string") &&
    Array.isArray(value.proposedActionIds) &&
    value.proposedActionIds.every((id) => typeof id === "string");
}

function isThreadAction(value: unknown): value is ThreadAction {
  return isRecord(value) && hasExactKeys(value, [
    "id",
    "label",
    "description",
    "kind",
    "targetId",
    "system",
    "readiness",
    "requiresConfirmation",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && typeof value.description === "string" &&
    (value.kind === "change" || value.kind === "recompute" ||
      value.kind === "inspect") &&
    typeof value.targetId === "string" &&
    typeof value.system === "string" &&
    (value.readiness === "ready" || value.readiness === "blocked") &&
    typeof value.requiresConfirmation === "boolean";
}

function isThreadRequirement(value: unknown): value is ThreadRequirement {
  if (!isRecord(value)) return false;
  const requirement = value as Partial<ThreadRequirement>;
  const required = [
    "id",
    "label",
    "source",
    "sourceElementId",
    "expression",
    "status",
    "observationIds",
    "violationIds",
    "rationale",
  ] as const;
  return required.every((key) => Object.hasOwn(value, key)) &&
    hasAllowedKeys(value, [...required, "targetElementId"]) &&
    typeof requirement.id === "string" && requirement.id.length > 0 &&
    typeof requirement.label === "string" &&
    typeof requirement.source === "string" &&
    typeof requirement.sourceElementId === "string" &&
    requirement.sourceElementId.length > 0 &&
    (requirement.targetElementId === undefined ||
      (typeof requirement.targetElementId === "string" &&
        requirement.targetElementId.length > 0)) &&
    typeof requirement.expression === "string" &&
    (requirement.status === "pass" || requirement.status === "fail" ||
      requirement.status === "unresolved") &&
    Array.isArray(requirement.observationIds) &&
    requirement.observationIds.every((id) => typeof id === "string") &&
    Array.isArray(requirement.violationIds) &&
    requirement.violationIds.every((id) => typeof id === "string") &&
    typeof requirement.rationale === "string";
}

/**
 * The family graph is a mandatory derived BFF projection. It has no fallback
 * to labels, fingerprints, timestamps or the raw graph: an absent or malformed
 * quotient is an unsupported workbench contract, not a cue to recreate one in
 * the browser.
 */
function isThreadEvidenceFamilyGraph(
  value: unknown,
  threadGraph: ThreadGraph,
): value is ThreadEvidenceFamilyGraph {
  if (!isRecord(value)) return false;
  const graph = value as Partial<ThreadEvidenceFamilyGraph>;
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "asOf",
      "families",
      "edges",
      "omittedSelfLoops",
      "omittedCycleEdges",
    ]) || graph.schemaVersion !== "thread-evidence-family-graph/1.0" ||
    !isRecord(graph.asOf) ||
    !hasExactKeys(graph.asOf, ["snapshotId", "revision"]) ||
    typeof graph.asOf.snapshotId !== "string" ||
    graph.asOf.snapshotId.length === 0 ||
    typeof graph.asOf.revision !== "number" ||
    !Number.isSafeInteger(graph.asOf.revision) || graph.asOf.revision <= 0 ||
    !Array.isArray(graph.families) ||
    !graph.families.every(isThreadEvidenceFamily) ||
    !Array.isArray(graph.edges) ||
    !graph.edges.every(isThreadEvidenceFamilyGraphEdge) ||
    !Array.isArray(graph.omittedSelfLoops) ||
    !graph.omittedSelfLoops.every(isThreadEvidenceFamilyOmittedSelfLoop) ||
    !Array.isArray(graph.omittedCycleEdges) ||
    !graph.omittedCycleEdges.every(isThreadEvidenceFamilyOmittedCycleEdge)
  ) {
    return false;
  }
  return isEvidenceFamilyGraphConsistent(
    graph as ThreadEvidenceFamilyGraph,
    threadGraph,
  );
}

function isEvidenceFamilyGraphConsistent(
  graph: ThreadEvidenceFamilyGraph,
  threadGraph: ThreadGraph,
): boolean {
  const nodeByRef = new Map(
    threadGraph.nodes.map((node) => [threadGraphRefKey(node.ref), node]),
  );
  const familyById = new Map(
    graph.families.map((family) => [family.id, family]),
  );
  if (familyById.size !== graph.families.length) return false;

  const familyIdByMember = new Map<string, string>();
  for (const family of graph.families) {
    if (!isEvidenceFamilyConsistent(family, nodeByRef, threadGraph.edges)) {
      return false;
    }
    for (const reference of [...family.historicalRefs, ...family.currentRefs]) {
      const key = threadGraphRefKey(reference);
      if (familyIdByMember.has(key)) return false;
      familyIdByMember.set(key, family.id);
    }
  }

  return graph.edges.every((edge) =>
    familyById.has(edge.fromFamilyId) && familyById.has(edge.toFamilyId) &&
    edge.memberEdgeRefs.every((reference) => {
      return hasExactlyOneMatchingRawEdge(
        threadGraph.edges,
        reference,
        (rawEdge) =>
          familyIdByMember.get(threadGraphRefKey(rawEdge.from)) ===
            edge.fromFamilyId &&
          familyIdByMember.get(threadGraphRefKey(rawEdge.to)) ===
            edge.toFamilyId,
      );
    })
  ) &&
    graph.omittedSelfLoops.every((omitted) =>
      familyById.has(omitted.familyId) &&
      omitted.memberEdgeRefs.every((reference) => {
        return hasExactlyOneMatchingRawEdge(
          threadGraph.edges,
          reference,
          (rawEdge) =>
            familyIdByMember.get(threadGraphRefKey(rawEdge.from)) ===
              omitted.familyId &&
            familyIdByMember.get(threadGraphRefKey(rawEdge.to)) ===
              omitted.familyId,
        );
      })
    ) &&
    graph.omittedCycleEdges.every((omitted) =>
      familyById.has(omitted.fromFamilyId) &&
      familyById.has(omitted.toFamilyId) &&
      omitted.memberEdgeRefs.every((reference) => {
        return hasExactlyOneMatchingRawEdge(
          threadGraph.edges,
          reference,
          (rawEdge) =>
            familyIdByMember.get(threadGraphRefKey(rawEdge.from)) ===
              omitted.fromFamilyId &&
            familyIdByMember.get(threadGraphRefKey(rawEdge.to)) ===
              omitted.toFamilyId,
        );
      })
    );
}

function isEvidenceFamilyConsistent(
  family: ThreadEvidenceFamily,
  nodeByRef: ReadonlyMap<string, ThreadGraphNode>,
  rawEdges: readonly ThreadGraphEdge[],
): boolean {
  const members = [...family.historicalRefs, ...family.currentRefs];
  const memberKeys = members.map(threadGraphRefKey);
  if (members.length === 0 || !hasUniqueStrings(memberKeys)) return false;
  if (
    family.entityKind === "artifact"
      ? typeof family.artifactKind !== "string" ||
        family.artifactKind.length === 0
      : family.artifactKind !== undefined
  ) {
    return false;
  }
  for (const reference of members) {
    const node = nodeByRef.get(threadGraphRefKey(reference));
    if (!node || reference.kind !== family.entityKind) return false;
    if (
      node.entityKind !== family.entityKind ||
      (family.entityKind === "artifact" &&
        node.artifactKind !== family.artifactKind)
    ) {
      return false;
    }
  }

  const memberKeySet = new Set(memberKeys);
  const historicalKeys = new Set(family.historicalRefs.map(threadGraphRefKey));
  const transitionHistoricalKeys = new Set<string>();
  for (const transition of family.transitions) {
    const historicalKey = threadGraphRefKey(transition.historical);
    const successorKey = threadGraphRefKey(transition.successor);
    if (
      !historicalKeys.has(historicalKey) || !memberKeySet.has(successorKey) ||
      !hasExactlyOneMatchingRawEdge(
        rawEdges,
        transition.edgeRef,
        (rawEdge) =>
          isVersionFamilyTransitionRelation(rawEdge.relation) &&
          rawEdge.origin === "provenance" &&
          threadGraphRefKey(rawEdge.from) === historicalKey &&
          threadGraphRefKey(rawEdge.to) === successorKey,
      )
    ) {
      return false;
    }
    transitionHistoricalKeys.add(historicalKey);
  }
  if (!sameStringSet(historicalKeys, transitionHistoricalKeys)) return false;
  const derivedCurrentKeys = new Set(
    memberKeys.filter((key) => !transitionHistoricalKeys.has(key)),
  );
  return sameStringSet(
    derivedCurrentKeys,
    new Set(family.currentRefs.map(threadGraphRefKey)),
  );
}

function matchesRawEdgeRef(
  reference: ThreadEvidenceFamilyEdgeRef,
  rawEdge: ThreadGraphEdge,
): boolean {
  return reference.id === rawEdge.id &&
    reference.relation === rawEdge.relation &&
    reference.origin === rawEdge.origin;
}

function hasExactlyOneMatchingRawEdge(
  rawEdges: readonly ThreadGraphEdge[],
  reference: ThreadEvidenceFamilyEdgeRef,
  matchesEndpoints: (edge: ThreadGraphEdge) => boolean,
): boolean {
  return rawEdges.filter((edge) =>
    matchesRawEdgeRef(reference, edge) && matchesEndpoints(edge)
  ).length === 1;
}

function isThreadEvidenceFamily(value: unknown): value is ThreadEvidenceFamily {
  if (!isRecord(value)) return false;
  const family = value as Partial<ThreadEvidenceFamily>;
  const hasCurrent = family.status === "current" &&
    Array.isArray(family.currentRefs) && family.currentRefs.length === 1 &&
    family.reviewReason === undefined;
  const needsReview = family.status === "review-required" &&
    (family.reviewReason === "divergent-successors" ||
      family.reviewReason === "no-current-successor");
  return hasAllowedKeys(value, [
    "id",
    "entityKind",
    "artifactKind",
    "historicalRefs",
    "currentRefs",
    "revisionCount",
    "status",
    "reviewReason",
    "relationship",
    "transitions",
  ]) && typeof family.id === "string" && family.id.length > 0 &&
    (family.entityKind === "artifact" || family.entityKind === "requirement") &&
    (family.artifactKind === undefined ||
      (family.entityKind === "artifact" &&
        typeof family.artifactKind === "string")) &&
    Array.isArray(family.historicalRefs) &&
    family.historicalRefs.every(isThreadGraphRef) &&
    Array.isArray(family.currentRefs) &&
    family.currentRefs.every(isThreadGraphRef) &&
    typeof family.revisionCount === "number" &&
    Number.isSafeInteger(family.revisionCount) && family.revisionCount >= 1 &&
    isRecord(family.relationship) &&
    hasExactKeys(family.relationship, [
      "relation",
      "classification",
      "equivalence",
    ]) && family.relationship.relation === "supersedes" &&
    family.relationship.classification === "not-recorded" &&
    family.relationship.equivalence === "not-recorded" &&
    Array.isArray(family.transitions) &&
    family.transitions.every(isThreadEvidenceFamilyTransition) &&
    family.transitions.length === family.revisionCount &&
    (hasCurrent || needsReview);
}

function isThreadEvidenceFamilyTransition(
  value: unknown,
): value is ThreadEvidenceFamilyTransition {
  if (!isRecord(value)) return false;
  const transition = value as Partial<ThreadEvidenceFamilyTransition>;
  return hasExactKeys(value, ["edgeRef", "historical", "successor"]) &&
    isThreadEvidenceFamilyEdgeRef(transition.edgeRef) &&
    isVersionFamilyTransitionRelation(transition.edgeRef.relation) &&
    isThreadGraphRef(transition.historical) &&
    isThreadGraphRef(transition.successor) &&
    (transition.historical.kind !== transition.successor.kind ||
      transition.historical.id !== transition.successor.id);
}

function isThreadEvidenceFamilyEdgeRef(
  value: unknown,
): value is ThreadEvidenceFamilyEdgeRef {
  if (!isRecord(value)) return false;
  const reference = value as Partial<ThreadEvidenceFamilyEdgeRef>;
  return hasExactKeys(value, ["id", "relation", "origin"]) &&
    typeof reference.id === "string" && reference.id.length > 0 &&
    isThreadGraphRelation(reference.relation) &&
    (reference.origin === "provenance" || reference.origin === "structure");
}

function isThreadEvidenceFamilyGraphEdge(
  value: unknown,
): value is ThreadEvidenceFamilyGraphEdge {
  if (!isRecord(value)) return false;
  const edge = value as Partial<ThreadEvidenceFamilyGraphEdge>;
  return hasExactKeys(value, [
    "id",
    "fromFamilyId",
    "toFamilyId",
    "relation",
    "origin",
    "memberEdgeRefs",
  ]) && typeof edge.id === "string" && edge.id.length > 0 &&
    typeof edge.fromFamilyId === "string" && edge.fromFamilyId.length > 0 &&
    typeof edge.toFamilyId === "string" && edge.toFamilyId.length > 0 &&
    edge.fromFamilyId !== edge.toFamilyId &&
    isThreadGraphRelation(edge.relation) &&
    (edge.origin === "provenance" || edge.origin === "structure") &&
    Array.isArray(edge.memberEdgeRefs) &&
    edge.memberEdgeRefs.length > 0 &&
    edge.memberEdgeRefs.every(isThreadEvidenceFamilyEdgeRef);
}

function isThreadEvidenceFamilyOmittedSelfLoop(
  value: unknown,
): value is ThreadEvidenceFamilyOmittedSelfLoop {
  if (!isRecord(value)) return false;
  const loop = value as Partial<ThreadEvidenceFamilyOmittedSelfLoop>;
  return hasExactKeys(value, ["familyId", "memberEdgeRefs"]) &&
    typeof loop.familyId === "string" && loop.familyId.length > 0 &&
    Array.isArray(loop.memberEdgeRefs) && loop.memberEdgeRefs.length > 0 &&
    loop.memberEdgeRefs.every(isThreadEvidenceFamilyEdgeRef);
}

function isThreadEvidenceFamilyOmittedCycleEdge(
  value: unknown,
): value is ThreadEvidenceFamilyOmittedCycleEdge {
  if (!isRecord(value)) return false;
  const edge = value as Partial<ThreadEvidenceFamilyOmittedCycleEdge>;
  return hasExactKeys(value, [
    "fromFamilyId",
    "toFamilyId",
    "memberEdgeRefs",
  ]) &&
    typeof edge.fromFamilyId === "string" &&
    edge.fromFamilyId.length > 0 &&
    typeof edge.toFamilyId === "string" && edge.toFamilyId.length > 0 &&
    edge.fromFamilyId !== edge.toFamilyId &&
    Array.isArray(edge.memberEdgeRefs) && edge.memberEdgeRefs.length > 0 &&
    edge.memberEdgeRefs.every(isThreadEvidenceFamilyEdgeRef);
}

function isThreadWorkbenchPreviousSnapshot(
  value: unknown,
): value is ThreadWorkbenchPreviousSnapshot {
  if (!value || typeof value !== "object") return false;
  const previous = value as Partial<ThreadWorkbenchPreviousSnapshot>;
  return hasExactKeys(previous, ["snapshotId", "revision"]) &&
    typeof previous.snapshotId === "string" && previous.snapshotId.length > 0 &&
    typeof previous.revision === "number" &&
    Number.isSafeInteger(previous.revision) && previous.revision > 0;
}

function isEngineeringCaseCatalog(
  value: unknown,
  artifactsValue: unknown,
  graphValue: unknown,
): value is EngineeringCaseCatalog {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "coverage",
      "cases",
      "issues",
    ]) ||
    value.schemaVersion !== ENGINEERING_CASE_CATALOG_SCHEMA ||
    (value.status !== "observed" && value.status !== "unresolved" &&
      value.status !== "unavailable") ||
    !Array.isArray(value.coverage) ||
    !value.coverage.every(isEngineeringCaseCoverage) ||
    !hasExactVerificationCaseCoverage(value.coverage) ||
    !Array.isArray(value.cases) ||
    !value.cases.every(isEngineeringCase) ||
    !Array.isArray(value.issues) ||
    !value.issues.every(isEngineeringCaseIssue) ||
    !Array.isArray(artifactsValue) ||
    !isRecord(graphValue) ||
    !Array.isArray(graphValue.nodes)
  ) return false;

  const catalog = value as unknown as EngineeringCaseCatalog;
  const artifacts = artifactsValue as unknown as ThreadArtifact[];
  const nodes = graphValue.nodes as unknown as ThreadGraphNode[];
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const artifactsById = new Map(
    artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const artifactNodeIds = new Set(
    nodes.flatMap((node) => node.ref?.kind === "artifact" ? [node.ref.id] : []),
  );
  const caseKeys = catalog.cases.map((item) => item.key);
  if (!hasUniqueStrings(caseKeys)) return false;
  const knownCaseKeys = new Set(caseKeys);
  const exactCaseIdentities = catalog.cases.map((item) =>
    `${item.family}:${item.caseDigest}`
  );
  if (!hasUniqueStrings(exactCaseIdentities)) return false;
  const authorityIds = catalog.cases.flatMap((item) =>
    item.authorityArtifactIds
  );
  if (!hasUniqueStrings(authorityIds)) return false;
  const coverageByFamily = new Map(
    catalog.coverage.map((item) => [item.family, item.status]),
  );
  if (
    catalog.cases.some((item) =>
      coverageByFamily.get(item.family) !== "observed" ||
      item.authorityArtifactIds.some((id) =>
        !artifactIds.has(id) || !artifactNodeIds.has(id) ||
        !authorityArtifactMatchesCase(artifactsById.get(id), item) ||
        !nodes.some((node) =>
          node.ref.kind === "artifact" && node.ref.id === id &&
          node.engineeringCaseRefs?.includes(item.key)
        )
      )
    ) ||
    catalog.issues.some((item) => !artifactIds.has(item.authorityArtifactId)) ||
    nodes.some((node) =>
      node.engineeringCaseRefs?.some((key) => !knownCaseKeys.has(key)) ?? false
    )
  ) return false;

  const unavailableCoverage =
    catalog.coverage.filter((item) => item.status === "unavailable").length;
  if (catalog.status === "observed") {
    return unavailableCoverage === 0 && catalog.issues.length === 0;
  }
  if (catalog.status === "unavailable") {
    return unavailableCoverage === catalog.coverage.length &&
      catalog.cases.length === 0 && catalog.issues.length === 0 &&
      nodes.every((node) => node.engineeringCaseRefs === undefined);
  }
  return unavailableCoverage > 0 || catalog.issues.length > 0;
}

function isEngineeringCaseCoverage(
  value: unknown,
): value is EngineeringCaseCoverage {
  return isRecord(value) && hasExactKeys(value, ["family", "status"]) &&
    isEngineeringCaseFamily(value.family) &&
    (value.status === "observed" || value.status === "unavailable");
}

function hasExactVerificationCaseCoverage(
  coverage: readonly EngineeringCaseCoverage[],
): boolean {
  const families = coverage.map((item) => item.family);
  return families.length === ENGINEERING_CASE_FAMILIES.length &&
    hasUniqueStrings(families) &&
    ENGINEERING_CASE_FAMILIES.every((family) => families.includes(family));
}

function isEngineeringCase(
  value: unknown,
): value is EngineeringCase {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<EngineeringCase>;
  const required = [
    "key",
    "family",
    "caseSchemaVersion",
    "id",
    "revision",
    "scope",
    "caseDigest",
    "authorityArtifactIds",
  ] as const;
  const allowed = [
    ...required,
    ...(candidate.family === "mechanical-proof" ? ["target"] : []),
  ];
  return required.every((key) => Object.hasOwn(value, key)) &&
    hasAllowedKeys(value, allowed) &&
    typeof candidate.key === "string" && candidate.key.length > 0 &&
    isEngineeringCaseFamily(candidate.family) &&
    caseSchemaMatchesFamily(
      candidate.family,
      candidate.caseSchemaVersion,
    ) &&
    typeof candidate.id === "string" && candidate.id.length > 0 &&
    isPositiveSafeInteger(candidate.revision) &&
    typeof candidate.scope === "string" && candidate.scope.length > 0 &&
    typeof candidate.caseDigest === "string" &&
    isSha256Digest(candidate.caseDigest) &&
    Array.isArray(candidate.authorityArtifactIds) &&
    candidate.authorityArtifactIds.length > 0 &&
    candidate.authorityArtifactIds.every((id) =>
      typeof id === "string" && id.length > 0
    ) && hasUniqueStrings(candidate.authorityArtifactIds) &&
    (candidate.family !== "mechanical-proof" ||
      candidate.target === undefined ||
      isMechanicalProofTarget(candidate.target));
}

function isMechanicalProofTarget(
  value: unknown,
): value is { modelElementId: string } {
  return isRecord(value) &&
    hasExactKeys(value, ["modelElementId"]) &&
    typeof value.modelElementId === "string" &&
    value.modelElementId.length > 0;
}

function isEngineeringCaseIssue(
  value: unknown,
): value is EngineeringCaseIssue {
  return isRecord(value) && hasExactKeys(value, [
    "family",
    "authorityArtifactId",
    "status",
    "reason",
  ]) && isEngineeringCaseFamily(value.family) &&
    typeof value.authorityArtifactId === "string" &&
    value.authorityArtifactId.length > 0 &&
    ((value.status === "unavailable" &&
      (value.reason === "capture-reader-unavailable" ||
        value.reason === "capture-unavailable")) ||
      (value.status === "error" &&
        (value.reason === "artifact-binding-invalid" ||
          value.reason === "capture-invalid" ||
          value.reason === "case-binding-divergent")));
}

function isEngineeringCaseFamily(
  value: unknown,
): value is EngineeringCaseFamily {
  return typeof value === "string" &&
    (ENGINEERING_CASE_FAMILIES as readonly string[]).includes(value);
}

function caseSchemaMatchesFamily(
  family: EngineeringCaseFamily | undefined,
  schemaVersion: unknown,
): boolean {
  return family !== undefined &&
    schemaVersion === ENGINEERING_CASE_SCHEMA_BY_FAMILY[family];
}

function authorityArtifactMatchesCase(
  artifact: ThreadArtifact | undefined,
  engineeringCase: EngineeringCase,
): boolean {
  if (
    !artifact || artifact.kind !== "document" ||
    artifact.system !== "digital-thread" ||
    artifact.producerRunId === undefined ||
    artifact.revision !== engineeringCase.caseDigest ||
    artifact.fingerprint === undefined || artifact.uri === undefined
  ) return false;
  const fingerprint = /^sha256:([a-f0-9]{64})$/.exec(artifact.fingerprint);
  if (!fingerprint) return false;
  const captureDigest = fingerprint[1]!;
  const binding = ENGINEERING_CASE_AUTHORITY[engineeringCase.family];
  return artifact.producedBy === binding.producedBy &&
    artifact.id ===
      binding.artifactId(captureDigest, engineeringCase.caseDigest) &&
    artifact.uri === `${binding.uriPrefix}${captureDigest}`;
}

const ENGINEERING_CASE_AUTHORITY: Record<
  EngineeringCaseFamily,
  {
    producedBy: string;
    artifactId: (captureDigest: string, caseDigest: string) => string;
    uriPrefix: string;
  }
> = {
  "mechanical-proof": {
    producedBy: "verify.seal-proof-case@1",
    artifactId: (captureDigest) => `fea-proof-${captureDigest}`,
    uriPrefix: "casys://fea-proof-case-capture/sha256/",
  },
  "sensitivity-study": {
    producedBy: "analyze.seal-sensitivity-study@1",
    artifactId: (_captureDigest, caseDigest) =>
      `sensitivity-case-${caseDigest}`,
    uriPrefix: "casys://sensitivity-study-case-capture/sha256/",
  },
  "printability-check": {
    producedBy: "industrialize.seal-printability-case@1",
    artifactId: (_captureDigest, caseDigest) =>
      `printability-case-${caseDigest}`,
    uriPrefix: "casys://printability-case-capture/sha256/",
  },
  "print-estimate": {
    producedBy: "industrialize.seal-print-estimate-case@1",
    artifactId: (_captureDigest, caseDigest) =>
      `print-estimate-case-${caseDigest}`,
    uriPrefix: "casys://print-estimate-case-capture/sha256/",
  },
  "dfm-check": {
    producedBy: "industrialize.seal-dfm-case@1",
    artifactId: (_captureDigest, caseDigest) => `dfm-case-${caseDigest}`,
    uriPrefix: "casys://dfm-case-capture/sha256/",
  },
};

function isThreadGraph(value: unknown): value is ThreadGraph {
  if (!isRecord(value)) return false;
  const graph = value as Partial<ThreadGraph>;
  if (
    !hasExactKeys(value, ["nodes", "edges"]) ||
    !Array.isArray(graph.nodes) || !graph.nodes.every(isThreadGraphNode) ||
    !Array.isArray(graph.edges) || !graph.edges.every(isThreadGraphEdge)
  ) {
    return false;
  }
  const nodes = graph.nodes as ThreadGraphNode[];
  const edges = graph.edges as ThreadGraphEdge[];
  const nodeRefs = new Set(nodes.map((node) => threadGraphRefKey(node.ref)));
  return hasUniqueStrings(nodes.map((node) => node.id)) &&
    nodeRefs.size === nodes.length &&
    edges.every((edge) =>
      nodeRefs.has(threadGraphRefKey(edge.from)) &&
      nodeRefs.has(threadGraphRefKey(edge.to))
    );
}

function threadGraphRefKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size &&
    [...left].every((value) => right.has(value));
}

function isThreadGraphNode(value: unknown): value is ThreadGraphNode {
  if (!isRecord(value)) return false;
  const node = value as Partial<ThreadGraphNode>;
  return hasAllowedKeys(value, [
    "id",
    "ref",
    "entityKind",
    "artifactKind",
    "analysis",
    "label",
    "system",
    "freshness",
    "summary",
    "recordedAt",
    "affectedComponentId",
    "activityRole",
    "evaluationFamily",
    "engineeringCaseRefs",
    "selection",
  ]) && typeof node.id === "string" && node.id.length > 0 &&
    isThreadGraphRef(node.ref) &&
    node.entityKind === node.ref?.kind &&
    (node.artifactKind === undefined ||
      typeof node.artifactKind === "string") &&
    (node.entityKind === "analysis-node"
      ? isThreadAnalysisNodeDetail(node.analysis)
      : node.analysis === undefined) &&
    typeof node.label === "string" &&
    typeof node.system === "string" &&
    isThreadFreshness(node.freshness) &&
    typeof node.summary === "string" &&
    (node.recordedAt === undefined || typeof node.recordedAt === "string") &&
    (node.affectedComponentId === undefined ||
      (typeof node.affectedComponentId === "string" &&
        node.affectedComponentId.length > 0)) &&
    (node.activityRole === undefined || node.activityRole === "milestone") &&
    (node.evaluationFamily === undefined ||
      node.evaluationFamily === "study-base") &&
    (node.engineeringCaseRefs === undefined ||
      (Array.isArray(node.engineeringCaseRefs) &&
        node.engineeringCaseRefs.length > 0 &&
        node.engineeringCaseRefs.every((key) =>
          typeof key === "string" && key.length > 0
        ) &&
        hasUniqueStrings(node.engineeringCaseRefs))) &&
    (node.selection === undefined || isThreadRef(node.selection));
}

function isThreadGraphEdge(value: unknown): value is ThreadGraphEdge {
  if (!isRecord(value)) return false;
  const edge = value as Partial<ThreadGraphEdge>;
  return hasAllowedKeys(value, [
    "id",
    "from",
    "to",
    "relation",
    "rationale",
    "origin",
    "attestation",
    "analysis",
  ]) && typeof edge.id === "string" && edge.id.length > 0 &&
    isThreadGraphRef(edge.from) &&
    isThreadGraphRef(edge.to) &&
    isThreadGraphRelation(edge.relation) &&
    typeof edge.rationale === "string" &&
    (edge.origin === "provenance" || edge.origin === "structure" ||
      edge.origin === "analysis") &&
    (edge.attestation === undefined ||
      isThreadGraphEdgeAttestation(edge.attestation)) &&
    (edge.origin === "analysis"
      ? isThreadAnalysisRelation(edge.relation) &&
        edge.attestation === undefined &&
        isThreadAnalysisEdgeDetail(edge.analysis) &&
        edge.analysis.assertionId === edge.id &&
        (edge.relation === "measured-local-sensitivity"
          ? edge.analysis.measurement !== undefined
          : edge.analysis.measurement === undefined)
      : !isThreadAnalysisRelation(edge.relation) &&
        edge.analysis === undefined);
}

function isThreadGraphEdgeAttestation(
  value: unknown,
): value is ThreadGraphEdgeAttestation {
  if (!isRecord(value)) return false;
  const attestation = value as Partial<ThreadGraphEdgeAttestation>;
  return hasExactKeys(value, [
    "consumptionId",
    "status",
    "producerFingerprint",
    "consumedFingerprint",
    "checkedAt",
  ]) && typeof attestation.consumptionId === "string" &&
    (attestation.status === "verified" || attestation.status === "mismatch") &&
    typeof attestation.producerFingerprint === "string" &&
    typeof attestation.consumedFingerprint === "string" &&
    typeof attestation.checkedAt === "string";
}

function isThreadGraphRef(value: unknown): value is ThreadGraphRef {
  if (!isRecord(value)) return false;
  const reference = value as Partial<ThreadGraphRef>;
  return hasExactKeys(value, ["kind", "id"]) &&
    typeof reference.id === "string" && reference.id.length > 0 &&
    (reference.kind === "artifact" ||
      reference.kind === "consumption" ||
      reference.kind === "observation" ||
      reference.kind === "requirement" ||
      reference.kind === "evaluation" ||
      reference.kind === "violation" ||
      reference.kind === "change" ||
      reference.kind === "action" ||
      reference.kind === "analysis-node" ||
      reference.kind === "part-definition" ||
      reference.kind === "part-usage" ||
      reference.kind === "attribute-usage");
}

function isThreadRef(value: unknown): value is ThreadRef {
  if (!isRecord(value)) return false;
  const reference = value as Partial<ThreadRef>;
  return hasExactKeys(value, ["kind", "id"]) &&
    typeof reference.id === "string" && reference.id.length > 0 &&
    (reference.kind === "change" ||
      reference.kind === "artifact" ||
      reference.kind === "observation" ||
      reference.kind === "requirement" ||
      reference.kind === "violation");
}

/** Raw edges that may form one BFF version family. */
function isVersionFamilyTransitionRelation(
  value: unknown,
): value is "supersedes" | "derived_from" {
  return value === "supersedes" || value === "derived_from";
}

function isThreadGraphRelation(value: unknown): value is ThreadGraphRelation {
  return value === "changes" ||
    value === "derived_from" ||
    value === "traces_to" ||
    value === "uses" ||
    value === "evaluates" ||
    value === "evidences" ||
    value === "caused_by" ||
    value === "addresses" ||
    value === "supersedes" ||
    value === "input_to" ||
    value === "source_of" ||
    value === "contains" ||
    value === "typed_by" ||
    value === "represented_by" ||
    value === "verified_by" ||
    value === "constrained_by" ||
    isThreadAnalysisRelation(value);
}

function isThreadAnalysisRelation(value: unknown): boolean {
  return value === "semantic-binding" || value === "declared-dependency" ||
    value === "static-value-flow" || value === "structural-incidence" ||
    value === "runtime-consumption" ||
    value === "measured-local-sensitivity" || value === "projection-of";
}

function isThreadAnalysisNodeDetail(
  value: unknown,
): value is ThreadAnalysisNodeDetail {
  return isRecord(value) && hasExactKeys(value, ["semanticRef"]) &&
    isThreadAnalysisSemanticRef(
      (value as Partial<ThreadAnalysisNodeDetail>).semanticRef,
    );
}

function isThreadAnalysisSemanticRef(
  value: unknown,
): value is ThreadAnalysisSemanticRef {
  if (!isRecord(value)) return false;
  const reference = value as Partial<ThreadAnalysisSemanticRef>;
  return hasAllowedKeys(value, ["domain", "kind", "id", "basisFingerprint"]) &&
    (reference.domain === "brief" || reference.domain === "sysml" ||
      reference.domain === "cad" || reference.domain === "modelica" ||
      reference.domain === "calculix" || reference.domain === "thread") &&
    typeof reference.kind === "string" && reference.kind.length > 0 &&
    typeof reference.id === "string" && reference.id.length > 0 &&
    (reference.basisFingerprint === undefined ||
      isSha256Digest(reference.basisFingerprint));
}

function isThreadAnalysisEdgeDetail(
  value: unknown,
): value is ThreadAnalysisEdgeDetail {
  if (!isRecord(value)) return false;
  const detail = value as Partial<ThreadAnalysisEdgeDetail>;
  return hasAllowedKeys(value, [
    "assertionId",
    "epistemicBasis",
    "assertedBy",
    "evidence",
    "scope",
    "measurement",
  ]) && typeof detail.assertionId === "string" &&
    detail.assertionId.length > 0 &&
    (detail.epistemicBasis === "declared" ||
      detail.epistemicBasis === "inferred" ||
      detail.epistemicBasis === "observed") &&
    isRecord(detail.assertedBy) &&
    hasAllowedKeys(detail.assertedBy, ["kind", "id", "version"]) &&
    (detail.assertedBy.kind === "agent" ||
      detail.assertedBy.kind === "analyzer" ||
      detail.assertedBy.kind === "provider" ||
      detail.assertedBy.kind === "server") &&
    typeof detail.assertedBy.id === "string" &&
    detail.assertedBy.id.length > 0 &&
    (detail.assertedBy.version === undefined ||
      typeof detail.assertedBy.version === "string") &&
    Array.isArray(detail.evidence) && detail.evidence.length > 0 &&
    detail.evidence.every((item) => isThreadAnalysisEvidence(item)) &&
    isThreadAnalysisScope(detail.scope) &&
    (detail.measurement === undefined ||
      (isRecord(detail.measurement) && hasExactKeys(detail.measurement, [
        "method",
        "basePoint",
        "perturbationStep",
        "responseAtBase",
        "responseAtPerturbed",
        "derivative",
      ]) && detail.measurement.method === "forward-finite-difference" &&
        isThreadAnalysisQuantity(detail.measurement.basePoint) &&
        isThreadAnalysisQuantity(detail.measurement.perturbationStep) &&
        isThreadAnalysisQuantity(detail.measurement.responseAtBase) &&
        isThreadAnalysisQuantity(detail.measurement.responseAtPerturbed) &&
        isThreadAnalysisQuantity(detail.measurement.derivative)));
}

function isThreadAnalysisEvidence(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["id", "fingerprint"]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    isSha256Digest(value.fingerprint);
}

function isThreadAnalysisScope(value: unknown): value is ThreadAnalysisScope {
  if (!isRecord(value)) return false;
  const scope = value as Partial<ThreadAnalysisScope> & Record<string, unknown>;
  if (!isSha256Digest(scope.basisFingerprint)) return false;
  if (scope.kind === "basis") {
    return hasExactKeys(scope, ["kind", "basisFingerprint"]);
  }
  if (scope.kind === "source-span") {
    return hasExactKeys(scope, [
      "kind",
      "source",
      "basisFingerprint",
      "start",
      "end",
    ]) && isThreadAnalysisSemanticRef(scope.source) &&
      isSourcePosition(scope.start) && isSourcePosition(scope.end);
  }
  if (scope.kind === "scenario") {
    return hasExactKeys(scope, ["kind", "scenario", "basisFingerprint"]) &&
      isThreadAnalysisSemanticRef(scope.scenario);
  }
  return hasExactKeys(scope, [
    "kind",
    "parameter",
    "basisFingerprint",
    "lower",
    "upper",
  ]) && scope.kind === "local-neighborhood" &&
    isThreadAnalysisSemanticRef(scope.parameter) &&
    isThreadAnalysisQuantity(scope.lower) &&
    isThreadAnalysisQuantity(scope.upper);
}

function isThreadAnalysisQuantity(
  value: unknown,
): value is ThreadAnalysisQuantity {
  return isRecord(value) && hasExactKeys(value, ["value", "unit"]) &&
    typeof value.value === "number" && Number.isFinite(value.value) &&
    typeof value.unit === "string" && value.unit.length > 0;
}

function isSourcePosition(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["line", "column"]) &&
    Number.isSafeInteger((value as { line?: unknown }).line) &&
    (value as { line: number }).line >= 1 &&
    Number.isSafeInteger((value as { column?: unknown }).column) &&
    (value as { column: number }).column >= 0;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isThreadFreshness(value: unknown): value is ThreadFreshness {
  return value === "fresh" || value === "stale" || value === "running" ||
    value === "failed";
}

function isThreadFlowStage(value: unknown): value is ThreadFlowStage {
  if (!isRecord(value)) return false;
  const stage = value as Partial<ThreadFlowStage>;
  return hasExactKeys(value, [
    "id",
    "label",
    "system",
    "freshness",
    "summary",
    "selection",
    "dependsOn",
  ]) && typeof stage.id === "string" && stage.id.length > 0 &&
    typeof stage.label === "string" && typeof stage.system === "string" &&
    isThreadFreshness(stage.freshness) && typeof stage.summary === "string" &&
    isThreadRef(stage.selection) &&
    Array.isArray(stage.dependsOn) &&
    stage.dependsOn.every((dependency) => typeof dependency === "string");
}
