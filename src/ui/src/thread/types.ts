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
  type ThreadAssemblyIntegrityArtifactRef,
  type ThreadAssemblyIntegrityBasis,
  type ThreadAssemblyIntegrityChain,
  type ThreadAssemblyIntegrityCloseoutCard,
  type ThreadAssemblyIntegrityEvaluationCard,
  type ThreadAssemblyIntegrityEvaluationCriterion,
  type ThreadAssemblyIntegrityFact,
  type ThreadAssemblyIntegrityIndex,
  type ThreadAssemblyIntegrityObservationCard,
  type ThreadAssemblyIntegrityObservationFacts,
  type ThreadEvaluationCloseoutBasis,
  type ThreadEvaluationCloseoutCard,
  type ThreadEvaluationCloseoutCriterion,
  type ThreadEvaluationCloseoutEvidenceRef,
  type ThreadEvaluationCloseoutIndex,
  type ThreadEvaluationCloseoutProofLimitations,
  type ThreadObservation,
  type ThreadRequirement,
  type ThreadViolation,
  type ThreadWorkbenchPreviousSnapshot,
  type ThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/thread/snapshot.ts";
import {
  THREAD_SOURCE_FILE_CATALOG_SCHEMA,
  type ThreadSourceFileCatalog,
} from "../../../presentation/workbench/thread/source-files.ts";
import {
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  type ProductNavigationProjection,
} from "../../../presentation/workbench/thread/product-navigation.ts";
import type {
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentCatalog,
} from "../../../presentation/workbench/thread/components.ts";
import {
  collectEngineeringActivities,
  collectEngineeringActivityLifecycleIssues,
  engineeringActivityIdFromRootRevision,
} from "../../../domain/project/engineering-activity.ts";
import {
  isEngineeringProjectSnapshot,
  isEngineeringPublicPretechnicalProjectSnapshot,
} from "../project/contract.ts";

export type { ThreadSourceFileCatalog } from "../../../presentation/workbench/thread/source-files.ts";
export type { ProductNavigationProjection } from "../../../presentation/workbench/thread/product-navigation.ts";
export type {
  ThreadAction,
  ThreadArtifact,
  ThreadAssemblyIntegrityArtifactRef,
  ThreadAssemblyIntegrityBasis,
  ThreadAssemblyIntegrityChain,
  ThreadAssemblyIntegrityCloseoutCard,
  ThreadAssemblyIntegrityEvaluationCard,
  ThreadAssemblyIntegrityEvaluationCriterion,
  ThreadAssemblyIntegrityFact,
  ThreadAssemblyIntegrityIndex,
  ThreadAssemblyIntegrityObservationCard,
  ThreadAssemblyIntegrityObservationFacts,
  ThreadEvaluationCloseoutBasis,
  ThreadEvaluationCloseoutCard,
  ThreadEvaluationCloseoutCriterion,
  ThreadEvaluationCloseoutEvidenceRef,
  ThreadEvaluationCloseoutIndex,
  ThreadEvaluationCloseoutProofLimitations,
  ThreadObservation,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchPreviousSnapshot,
  ThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/thread/snapshot.ts";
export type {
  ThreadArchitectureSysmlSealIncidence,
  ThreadArchitectureSysmlSealPresentation,
  ThreadArchitectureSysmlSealSpan,
  ThreadArchitectureSysmlSealSymbol,
  ThreadArchitectureSysmlSealUnresolved,
} from "../../../presentation/workbench/thread/architecture.ts";
export type {
  ThreadComponent,
  ThreadComponentAttribute,
  ThreadComponentBinding,
  ThreadComponentCatalog,
  ThreadComponentPreview,
  ThreadComponentProvider,
} from "../../../presentation/workbench/thread/components.ts";
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
    thread.components.subjectId === thread.subject.id &&
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
    "components",
    "engineeringCases",
    "evaluationCloseouts",
    "assemblyIntegrity",
    "sourceFiles",
    "productNavigation",
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
    isThreadComponentCatalog(candidate.components) &&
    candidate.components.subjectId === candidate.subject.id &&
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
    (candidate.evaluationCloseouts === undefined ||
      isThreadEvaluationCloseoutIndex(candidate.evaluationCloseouts, {
        artifacts: candidate.artifacts,
        previous: candidate.previous,
      })) &&
    (candidate.assemblyIntegrity === undefined ||
      isThreadAssemblyIntegrityIndex(candidate.assemblyIntegrity, {
        artifacts: candidate.artifacts,
        previous: candidate.previous,
        subjectId: candidate.subject.id,
      })) &&
    (candidate.sourceFiles === undefined ||
      isThreadSourceFileCatalog(candidate.sourceFiles, candidate.graph)) &&
    (candidate.productNavigation === undefined ||
      isProductNavigationProjection(candidate.productNavigation)) &&
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

function isThreadEvaluationCloseoutIndex(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts" | "previous">,
): value is ThreadEvaluationCloseoutIndex {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "schemaVersion",
      "family",
      "status",
      "cards",
    ])
  ) return false;
  if (
    value.schemaVersion !== "thread-evaluation-closeouts/1.0" ||
    value.family !== "static-mechanical" ||
    (value.status !== "not-recorded" && value.status !== "current" &&
      value.status !== "historical" && value.status !== "unresolved" &&
      value.status !== "unavailable") ||
    !Array.isArray(value.cards) ||
    !value.cards.every((card) => isThreadEvaluationCloseoutCard(card, snapshot))
  ) return false;
  const cards = value.cards as ThreadEvaluationCloseoutCard[];
  if (value.status === "not-recorded") return cards.length === 0;
  if (value.status === "current") {
    return cards.some((card) => card.status === "current");
  }
  if (value.status === "historical") {
    return cards.length > 0 &&
      cards.every((card) => card.status === "historical");
  }
  return true;
}

function isThreadEvaluationCloseoutCard(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts" | "previous">,
): value is ThreadEvaluationCloseoutCard {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "artifactId",
      "captureFingerprint",
      "basis",
      "humanDisposition",
      "rejectionDisposition",
      "acceptanceEligibility",
      "status",
      "criteria",
      "proofLimitations",
      "evidence",
    ])
  ) return false;
  if (
    typeof value.artifactId !== "string" || value.artifactId.length === 0 ||
    typeof value.captureFingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.captureFingerprint) ||
    !isThreadEvaluationCloseoutBasis(value.basis) ||
    (value.humanDisposition !== "accept" &&
      value.humanDisposition !== "reject") ||
    (value.rejectionDisposition !== "none" &&
      value.rejectionDisposition !== "mechanical-review-required") ||
    typeof value.acceptanceEligibility !== "boolean" ||
    (value.status !== "current" && value.status !== "historical" &&
      value.status !== "unresolved") ||
    !Array.isArray(value.criteria) ||
    !value.criteria.every(isThreadEvaluationCloseoutCriterion) ||
    !isThreadEvaluationCloseoutProofLimitations(value.proofLimitations) ||
    !isRecord(value.evidence) || !hasExactKeys(value.evidence, [
      "canonicalStep",
      "sealedProof",
      "executionEvidence",
      "evaluationCapture",
    ]) ||
    !isThreadEvaluationCloseoutEvidenceRef(value.evidence.canonicalStep) ||
    !isThreadEvaluationCloseoutEvidenceRef(value.evidence.sealedProof) ||
    !isThreadEvaluationCloseoutEvidenceRef(value.evidence.executionEvidence) ||
    !isThreadEvaluationCloseoutEvidenceRef(value.evidence.evaluationCapture)
  ) return false;
  const criteria = value.criteria as ThreadEvaluationCloseoutCriterion[];
  if (
    criteria.length === 0 ||
    new Set(criteria.map((criterion) => criterion.proofCriterionId)).size !==
      criteria.length ||
    new Set(criteria.map((criterion) => criterion.evaluationId)).size !==
      criteria.length ||
    (value.humanDisposition === "accept" &&
      (!value.acceptanceEligibility ||
        criteria.some((criterion) => criterion.status !== "pass"))) ||
    (value.status === "current" &&
      (!snapshot.previous ||
        snapshot.previous.snapshotId !== value.basis.snapshotId ||
        snapshot.previous.revision !== value.basis.revision ||
        !snapshot.artifacts.some((artifact) =>
          artifact.id === value.artifactId
        )))
  ) return false;
  return true;
}

function isThreadEvaluationCloseoutBasis(
  value: unknown,
): value is ThreadEvaluationCloseoutBasis {
  return isRecord(value) &&
    hasExactKeys(value, ["snapshotId", "revision", "fingerprint"]) &&
    typeof value.snapshotId === "string" && value.snapshotId.length > 0 &&
    isPositiveSafeInteger(value.revision) &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint);
}

function isThreadEvaluationCloseoutCriterion(
  value: unknown,
): value is ThreadEvaluationCloseoutCriterion {
  return isRecord(value) && hasExactKeys(value, [
    "proofCriterionId",
    "evaluationId",
    "status",
    "evidenceArtifactId",
  ]) && typeof value.proofCriterionId === "string" &&
    value.proofCriterionId.length > 0 &&
    typeof value.evaluationId === "string" && value.evaluationId.length > 0 &&
    (value.status === "pass" || value.status === "fail" ||
      value.status === "unresolved" || value.status === "error") &&
    typeof value.evidenceArtifactId === "string" &&
    value.evidenceArtifactId.length > 0;
}

function isThreadEvaluationCloseoutEvidenceRef(
  value: unknown,
): value is ThreadEvaluationCloseoutEvidenceRef {
  return isRecord(value) && hasExactKeys(value, [
    "id",
    "fingerprint",
    "producerRunId",
    "freshness",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint) &&
    typeof value.producerRunId === "string" && value.producerRunId.length > 0 &&
    (value.freshness === "fresh" || value.freshness === "stale" ||
      value.freshness === "unavailable");
}

function isThreadEvaluationCloseoutProofLimitations(
  value: unknown,
): value is ThreadEvaluationCloseoutProofLimitations {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "proofScope",
      "evidenceBoundary",
      "cadEngineeringBoundary",
    ]) || typeof value.proofScope !== "string" ||
    value.proofScope.length === 0 ||
    typeof value.evidenceBoundary !== "string" ||
    value.evidenceBoundary.length === 0 ||
    !isRecord(value.cadEngineeringBoundary) ||
    !hasExactKeys(value.cadEngineeringBoundary, [
      "designIntent",
      "editableCad",
      "manufacturability",
      "limitations",
    ])
  ) return false;
  const boundary = value.cadEngineeringBoundary;
  return (boundary.designIntent === "preserved" ||
    boundary.designIntent === "partial" ||
    boundary.designIntent === "lost") &&
    (boundary.editableCad === "native" ||
      boundary.editableCad === "reconstructed" ||
      boundary.editableCad === "absent") &&
    boundary.manufacturability === "not-established" &&
    Array.isArray(boundary.limitations) && boundary.limitations.length > 0 &&
    boundary.limitations.every((item) =>
      typeof item === "string" && item.length > 0
    );
}

function isThreadAssemblyIntegrityIndex(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts" | "previous"> & {
    subjectId: string;
  },
): value is ThreadAssemblyIntegrityIndex {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "schemaVersion",
      "family",
      "status",
      "chains",
    ]) || value.schemaVersion !== "thread-assembly-integrity/1.0" ||
    value.family !== "assembly-integrity" ||
    !isAssemblyIntegrityIndexStatus(value.status) ||
    !Array.isArray(value.chains) ||
    !value.chains.every((chain) =>
      isThreadAssemblyIntegrityChain(chain, snapshot)
    )
  ) {
    return false;
  }
  const chains = value.chains as ThreadAssemblyIntegrityChain[];
  if (new Set(chains.map((chain) => chain.id)).size !== chains.length) {
    return false;
  }
  if (value.status === "not-recorded") return chains.length === 0;
  if (value.status === "current") {
    return chains.some((chain) => chain.status === "current");
  }
  if (value.status === "historical") {
    return chains.length > 0 &&
      chains.every((chain) => chain.status === "historical");
  }
  return true;
}

function isThreadAssemblyIntegrityChain(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts" | "previous"> & {
    subjectId: string;
  },
): value is ThreadAssemblyIntegrityChain {
  if (
    !isRecord(value) || !hasAllowedKeys(value, [
      "id",
      "status",
      "observation",
      "evaluation",
      "closeout",
    ]) || typeof value.id !== "string" || value.id.length === 0 ||
    !isAssemblyIntegrityChainStatus(value.status) ||
    !isThreadAssemblyIntegrityObservationCard(value.observation, snapshot) ||
    (value.evaluation !== undefined &&
      !isThreadAssemblyIntegrityEvaluationCard(value.evaluation, snapshot)) ||
    (value.closeout !== undefined &&
      !isThreadAssemblyIntegrityCloseoutCard(value.closeout, snapshot))
  ) {
    return false;
  }
  const observation = value
    .observation as ThreadAssemblyIntegrityObservationCard;
  const evaluation = value.evaluation as
    | ThreadAssemblyIntegrityEvaluationCard
    | undefined;
  const closeout = value.closeout as
    | ThreadAssemblyIntegrityCloseoutCard
    | undefined;
  if (closeout && !evaluation) return false;
  if (
    evaluation && !sameAssemblyArtifactRef(
      evaluation.evidence.observation,
      observation.record,
    )
  ) return false;
  if (
    evaluation && (!sameAssemblyArtifactRef(
      evaluation.evidence.geometryModule,
      observation.evidence.geometryModule,
    ) || !sameAssemblyArtifactRef(
      evaluation.evidence.assemblyStep,
      observation.evidence.assemblyStep,
    ))
  ) return false;
  if (
    closeout && (!sameAssemblyArtifactRef(
      closeout.evidence.evaluation,
      evaluation!.record,
    ) || !sameAssemblyArtifactRef(
      closeout.evidence.geometryModule,
      observation.evidence.geometryModule,
    ) || !sameAssemblyArtifactRef(
      closeout.evidence.assemblyStep,
      observation.evidence.assemblyStep,
    ) || !sameAssemblyArtifactRef(
      closeout.evidence.observation,
      observation.record,
    ))
  ) return false;
  const terminal = closeout?.record ?? evaluation?.record ?? observation.record;
  const terminalBasis = closeout?.basis ?? evaluation?.basis ??
    observation.basis;
  if (value.id !== terminal.id) return false;
  if (value.status !== "current") return true;
  return snapshot.previous !== undefined &&
    snapshot.previous.snapshotId === terminalBasis.snapshotId &&
    snapshot.previous.revision === terminalBasis.revision &&
    assemblyArtifactIsInSnapshot(terminal, snapshot.artifacts) &&
    [
      observation.record,
      observation.evidence.geometryModule,
      observation.evidence.assemblyStep,
      ...(evaluation === undefined ? [] : [
        evaluation.record,
        evaluation.evidence.geometryModule,
        evaluation.evidence.assemblyStep,
        evaluation.evidence.observation,
      ]),
      ...(closeout === undefined ? [] : [
        closeout.record,
        closeout.evidence.evaluation,
        closeout.evidence.geometryModule,
        closeout.evidence.assemblyStep,
        closeout.evidence.observation,
      ]),
    ].every((artifact) => artifact.freshness === "fresh");
}

function isThreadAssemblyIntegrityObservationCard(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts"> & { subjectId: string },
): value is ThreadAssemblyIntegrityObservationCard {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "record",
      "basis",
      "inputBundle",
      "evidence",
      "facts",
      "limitations",
    ]) ||
    !isThreadAssemblyIntegrityArtifactRef(value.record, snapshot.artifacts) ||
    !isThreadAssemblyIntegrityBasis(value.basis, snapshot.subjectId) ||
    !isAssemblyIntegrityInputBundle(value.inputBundle) ||
    !isRecord(value.evidence) || !hasExactKeys(value.evidence, [
      "geometryModule",
      "assemblyStep",
    ]) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.geometryModule,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.assemblyStep,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityObservationFacts(value.facts) ||
    !isAssemblyIntegrityL3Limitations(value.limitations)
  ) return false;
  const record = value.record as ThreadAssemblyIntegrityArtifactRef;
  const evidence = value
    .evidence as ThreadAssemblyIntegrityObservationCard["evidence"];
  return record.id.startsWith("assembly-integrity-observation-") &&
    record.dependsOn.length === 2 &&
    record.dependsOn[0] === evidence.geometryModule.id &&
    record.dependsOn[1] === evidence.assemblyStep.id;
}

function isThreadAssemblyIntegrityEvaluationCard(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts"> & { subjectId: string },
): value is ThreadAssemblyIntegrityEvaluationCard {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "record",
      "basis",
      "evidence",
      "method",
      "criteria",
      "aggregateVerdict",
      "limitations",
    ]) ||
    !isThreadAssemblyIntegrityArtifactRef(value.record, snapshot.artifacts) ||
    !isThreadAssemblyIntegrityBasis(value.basis, snapshot.subjectId) ||
    !isRecord(value.evidence) || !hasExactKeys(value.evidence, [
      "geometryModule",
      "assemblyStep",
      "observation",
    ]) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.geometryModule,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.assemblyStep,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.observation,
      snapshot.artifacts,
    ) || !isAssemblyIntegrityMethod(value.method) ||
    !Array.isArray(value.criteria) ||
    !value.criteria.every(isThreadAssemblyIntegrityEvaluationCriterion) ||
    !isAssemblyIntegrityVerdict(value.aggregateVerdict) ||
    !isAssemblyIntegrityL4Limitations(value.limitations)
  ) return false;
  const record = value.record as ThreadAssemblyIntegrityArtifactRef;
  const evidence = value
    .evidence as ThreadAssemblyIntegrityEvaluationCard["evidence"];
  const criteria = value
    .criteria as ThreadAssemblyIntegrityEvaluationCriterion[];
  return record.id.startsWith("assembly-integrity-evaluation-") &&
    sameIds(record.dependsOn, [
      evidence.geometryModule.id,
      evidence.assemblyStep.id,
      evidence.observation.id,
    ]) && criteria.length === 5 &&
    sameIds(criteria.map((criterion) => criterion.id), [
      "assembly-import",
      "occurrence-coverage",
      "placement-recross",
      "brep-validity",
      "pairwise-intersection",
    ]);
}

function isThreadAssemblyIntegrityCloseoutCard(
  value: unknown,
  snapshot: Pick<ThreadWorkbenchSnapshot, "artifacts"> & { subjectId: string },
): value is ThreadAssemblyIntegrityCloseoutCard {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "record",
      "basis",
      "humanDisposition",
      "rejectionDisposition",
      "approvedBriefBasis",
      "verificationAuthority",
      "gateClaims",
      "evidence",
      "l4Limitations",
      "limitations",
    ]) ||
    !isThreadAssemblyIntegrityArtifactRef(value.record, snapshot.artifacts) ||
    !isThreadAssemblyIntegrityCloseoutBasis(value.basis) ||
    (value.humanDisposition !== "accept" &&
      value.humanDisposition !== "reject") ||
    (value.rejectionDisposition !== "none" &&
      value.rejectionDisposition !== "assembly-integrity-review-required") ||
    !isAssemblyIntegrityApprovedBriefBasis(value.approvedBriefBasis) ||
    !isAssemblyIntegrityAuthority(value.verificationAuthority) ||
    !Array.isArray(value.gateClaims) ||
    !value.gateClaims.every(isAssemblyIntegrityGateClaim) ||
    !isRecord(value.evidence) || !hasExactKeys(value.evidence, [
      "evaluation",
      "geometryModule",
      "assemblyStep",
      "observation",
    ]) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.evaluation,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.geometryModule,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.assemblyStep,
      snapshot.artifacts,
    ) || !isThreadAssemblyIntegrityArtifactRef(
      value.evidence.observation,
      snapshot.artifacts,
    ) || !isAssemblyIntegrityL4Limitations(value.l4Limitations) ||
    !isAssemblyIntegrityL5Limitations(value.limitations)
  ) return false;
  const record = value.record as ThreadAssemblyIntegrityArtifactRef;
  const evidence = value
    .evidence as ThreadAssemblyIntegrityCloseoutCard["evidence"];
  const claims = value
    .gateClaims as ThreadAssemblyIntegrityCloseoutCard["gateClaims"];
  return record.id.startsWith("assembly-integrity-evaluation-closeout-") &&
    sameIds(record.dependsOn, [evidence.evaluation.id]) &&
    (value.humanDisposition === "reject"
      ? claims.length === 0
      : claims.every((claim) =>
        claim.role === "satisfies" && claim.status === "current"
      ));
}

function isThreadAssemblyIntegrityArtifactRef(
  value: unknown,
  artifacts: readonly ThreadArtifact[],
): value is ThreadAssemblyIntegrityArtifactRef {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "id",
      "uri",
      "fingerprint",
      "producerRunId",
      "dependsOn",
      "freshness",
    ]) || typeof value.id !== "string" || value.id.length === 0 ||
    typeof value.uri !== "string" || value.uri.length === 0 ||
    typeof value.fingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.fingerprint) ||
    typeof value.producerRunId !== "string" ||
    value.producerRunId.length === 0 ||
    !Array.isArray(value.dependsOn) ||
    !value.dependsOn.every((entry) =>
      typeof entry === "string" && entry.length > 0
    ) ||
    (value.freshness !== "fresh" && value.freshness !== "stale" &&
      value.freshness !== "unavailable")
  ) return false;
  return assemblyArtifactIsInSnapshot(
    value as unknown as ThreadAssemblyIntegrityArtifactRef,
    artifacts,
  );
}

function assemblyArtifactIsInSnapshot(
  reference: ThreadAssemblyIntegrityArtifactRef,
  artifacts: readonly ThreadArtifact[],
): boolean {
  const matches = artifacts.filter((artifact) => artifact.id === reference.id);
  const artifact = matches[0];
  const expectedFreshness = artifact?.freshness === "fresh"
    ? "fresh"
    : artifact?.freshness === "stale"
    ? "stale"
    : "unavailable";
  return matches.length === 1 && artifact !== undefined &&
    artifact.uri === reference.uri &&
    artifact.fingerprint === reference.fingerprint &&
    artifact.producerRunId === reference.producerRunId &&
    sameIds(artifact.dependsOn, reference.dependsOn) &&
    reference.freshness === expectedFreshness;
}

function isThreadAssemblyIntegrityBasis(
  value: unknown,
  subjectId: string,
): value is ThreadAssemblyIntegrityBasis {
  return isRecord(value) && hasExactKeys(value, [
    "snapshotId",
    "revision",
    "subjectId",
  ]) && typeof value.snapshotId === "string" && value.snapshotId.length > 0 &&
    isPositiveSafeInteger(value.revision) && value.subjectId === subjectId;
}

function isThreadAssemblyIntegrityCloseoutBasis(
  value: unknown,
): value is ThreadAssemblyIntegrityCloseoutCard["basis"] {
  return isRecord(value) && hasExactKeys(value, [
    "snapshotId",
    "revision",
    "fingerprint",
  ]) && typeof value.snapshotId === "string" && value.snapshotId.length > 0 &&
    isPositiveSafeInteger(value.revision) &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint);
}

function isAssemblyIntegrityInputBundle(
  value: unknown,
): value is ThreadAssemblyIntegrityObservationCard["inputBundle"] {
  return isRecord(value) && hasExactKeys(value, ["fingerprint", "byteCount"]) &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint) &&
    isPositiveSafeInteger(value.byteCount);
}

function isThreadAssemblyIntegrityObservationFacts(
  value: unknown,
): value is ThreadAssemblyIntegrityObservationFacts {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "importability",
      "importFacts",
      "topology",
      "occurrences",
      "pairs",
    ]) ||
    !isAssemblyIntegrityFact(
      value.importability,
      (candidate) => candidate === "imported" || candidate === "failed",
    ) ||
    !isRecord(value.importFacts) || !hasExactKeys(value.importFacts, [
      "unitSystem",
      "solidCount",
    ]) ||
    !isAssemblyIntegrityFact(
      value.importFacts.unitSystem,
      (candidate) => candidate === "mm",
    ) ||
    !isAssemblyIntegrityFact(value.importFacts.solidCount, isFiniteNumber) ||
    !isRecord(value.topology) || !hasExactKeys(value.topology, [
      "brepValidity",
      "degenerateEdgeCount",
      "freeEdgeCount",
      "shellCount",
    ]) ||
    !isAssemblyIntegrityFact(
      value.topology.brepValidity,
      (candidate) => candidate === "valid" || candidate === "invalid",
    ) ||
    !isAssemblyIntegrityFact(
      value.topology.degenerateEdgeCount,
      isFiniteNumber,
    ) ||
    !isAssemblyIntegrityFact(value.topology.freeEdgeCount, isFiniteNumber) ||
    !isAssemblyIntegrityFact(value.topology.shellCount, isFiniteNumber) ||
    !Array.isArray(value.occurrences) ||
    !value.occurrences.every(isAssemblyIntegrityOccurrence) ||
    !Array.isArray(value.pairs) || !value.pairs.every(isAssemblyIntegrityPair)
  ) return false;
  return true;
}

function isAssemblyIntegrityOccurrence(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "usageElementId",
    "target",
    "transformStatus",
  ]) && typeof value.usageElementId === "string" &&
    value.usageElementId.length > 0 &&
    isAssemblyIntegrityFact(value.target, isAssemblyIntegrityTarget) &&
    (value.transformStatus === "observed" ||
      value.transformStatus === "unresolved" ||
      value.transformStatus === "unavailable");
}

function isAssemblyIntegrityTarget(
  candidate: unknown,
): candidate is { partDefinitionElementId: string } {
  return isRecord(candidate) &&
    hasExactKeys(candidate, ["partDefinitionElementId"]) &&
    typeof candidate.partDefinitionElementId === "string" &&
    candidate.partDefinitionElementId.length > 0;
}

function isAssemblyIntegrityPair(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "firstUsageElementId",
    "secondUsageElementId",
    "linearToleranceMm",
    "minimumDistanceMm",
    "intersectionVolumeMm3",
    "contact",
  ]) && typeof value.firstUsageElementId === "string" &&
    value.firstUsageElementId.length > 0 &&
    typeof value.secondUsageElementId === "string" &&
    value.secondUsageElementId.length > 0 &&
    isFiniteNumber(value.linearToleranceMm) &&
    isAssemblyIntegrityFact(value.minimumDistanceMm, isFiniteNumber) &&
    isAssemblyIntegrityFact(value.intersectionVolumeMm3, isFiniteNumber) &&
    isAssemblyIntegrityFact(
      value.contact,
      (candidate) => candidate === "contact" || candidate === "no-contact",
    );
}

function isAssemblyIntegrityFact<T>(
  value: unknown,
  isObservedValue: (candidate: unknown) => candidate is T,
): value is ThreadAssemblyIntegrityFact<T> {
  if (!isRecord(value)) return false;
  if (value.status === "observed") {
    return hasExactKeys(value, ["status", "value"]) &&
      isObservedValue(value.value);
  }
  if (value.status === "unresolved") {
    return hasExactKeys(value, ["status", "reason"]) &&
      (value.reason === "identity-missing" ||
        value.reason === "observability-missing");
  }
  return value.status === "unavailable" &&
    hasExactKeys(value, ["status", "reason"]) &&
    value.reason === "unsupported";
}

function isThreadAssemblyIntegrityEvaluationCriterion(
  value: unknown,
): value is ThreadAssemblyIntegrityEvaluationCriterion {
  return isRecord(value) && hasExactKeys(value, ["id", "verdict"]) &&
    (value.id === "assembly-import" || value.id === "occurrence-coverage" ||
      value.id === "placement-recross" || value.id === "brep-validity" ||
      value.id === "pairwise-intersection") &&
    isAssemblyIntegrityVerdict(value.verdict);
}

function isAssemblyIntegrityMethod(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["id", "version", "fingerprint"]) &&
    value.id === "assembly-integrity-evaluation" && value.version === "1.0" &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint);
}

function isAssemblyIntegrityVerdict(value: unknown): boolean {
  return value === "pass" || value === "fail" || value === "unresolved";
}

function isAssemblyIntegrityL3Limitations(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "verdict",
    "fitness",
    "safety",
    "motion",
    "strength",
  ]) && value.verdict === "none" && value.fitness === "none" &&
    value.safety === "none" && value.motion === "none" &&
    value.strength === "none";
}

function isAssemblyIntegrityL4Limitations(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "providerCalls",
    "genericSysmlRequirementEvaluation",
    "safety",
    "physicalJoints",
    "clearance",
    "motion",
    "load",
    "fabricability",
  ]) && value.providerCalls === "none" &&
    value.genericSysmlRequirementEvaluation === "none" &&
    value.safety === "not-evaluated" &&
    value.physicalJoints === "not-evaluated" &&
    value.clearance === "not-evaluated" && value.motion === "not-evaluated" &&
    value.load === "not-evaluated" && value.fabricability === "not-evaluated";
}

function isAssemblyIntegrityL5Limitations(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "providerCalls",
    "genericSysmlRequirementEvaluation",
    "certification",
    "l4PassIsNotL5",
  ]) && value.providerCalls === "none" &&
    value.genericSysmlRequirementEvaluation === "none" &&
    value.certification === "not-issued" && value.l4PassIsNotL5 === true;
}

function isAssemblyIntegrityApprovedBriefBasis(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "projectId",
    "projectSnapshotId",
    "projectRevision",
    "briefId",
    "briefSnapshotId",
    "briefRevision",
    "fingerprint",
  ]) && typeof value.projectId === "string" && value.projectId.length > 0 &&
    typeof value.projectSnapshotId === "string" &&
    value.projectSnapshotId.length > 0 &&
    isPositiveSafeInteger(value.projectRevision) &&
    typeof value.briefId === "string" &&
    value.briefId.length > 0 && typeof value.briefSnapshotId === "string" &&
    value.briefSnapshotId.length > 0 &&
    isPositiveSafeInteger(value.briefRevision) &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint);
}

function isAssemblyIntegrityAuthority(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["id", "version"]) &&
    value.id === "assembly-integrity" && value.version === "1.0";
}

function isAssemblyIntegrityGateClaim(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["gateItemId", "role", "status"]) &&
    typeof value.gateItemId === "string" && value.gateItemId.length > 0 &&
    (value.role === "contributes-to" || value.role === "satisfies") &&
    (value.status === "current" || value.status === "impact-unresolved" ||
      value.status === "invalidated" || value.status === "carried-forward");
}

function isAssemblyIntegrityIndexStatus(value: unknown): boolean {
  return value === "not-recorded" || value === "current" ||
    value === "historical" || value === "unresolved" || value === "unavailable";
}

function isAssemblyIntegrityChainStatus(value: unknown): boolean {
  return value === "current" || value === "historical" ||
    value === "unresolved";
}

function sameAssemblyArtifactRef(
  left: ThreadAssemblyIntegrityArtifactRef,
  right: ThreadAssemblyIntegrityArtifactRef,
): boolean {
  return left.id === right.id && left.uri === right.uri &&
    left.fingerprint === right.fingerprint &&
    left.producerRunId === right.producerRunId &&
    sameIds(left.dependsOn, right.dependsOn) &&
    left.freshness === right.freshness;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
    "revision",
    "freshness",
    "fingerprint",
    "uri",
    "producedAt",
    "producedBy",
    "producerRunId",
    "dependsOn",
    "attestation",
    "architectureSysmlSeal",
  ]) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && typeof value.kind === "string" &&
    typeof value.system === "string" && typeof value.revision === "string" &&
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
      isThreadArtifactAttestation(value.attestation)) &&
    (value.architectureSysmlSeal === undefined ||
      isArchitectureSysmlSealPresentation(value.architectureSysmlSeal));
}

function isArchitectureSysmlSealPresentation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasAllowedKeys(value, [
    "producer",
    "authority",
    "artifactKind",
    "notSyson",
    "notWriteArchitecture",
    "notCompilationAdmission",
    "symbolsStatus",
    "sourceStatus",
    "sourceText",
    "symbols",
    "incidences",
    "unresolvedConstructs",
  ]) && value.producer === "model.seal-architecture-sysml@1" &&
    value.authority === "documentary" &&
    value.artifactKind === "document" &&
    value.notSyson === true &&
    value.notWriteArchitecture === true &&
    value.notCompilationAdmission === true &&
    (value.symbolsStatus === "observed" ||
      value.symbolsStatus === "unavailable") &&
    (value.sourceStatus === "observed" ||
      value.sourceStatus === "unavailable") &&
    Array.isArray(value.symbols) &&
    value.symbols.every(isArchitectureSysmlSealSymbol) &&
    Array.isArray(value.incidences) &&
    value.incidences.every(isArchitectureSysmlSealIncidence) &&
    Array.isArray(value.unresolvedConstructs) &&
    value.unresolvedConstructs.every(isArchitectureSysmlSealUnresolved) &&
    (value.symbolsStatus === "observed" ||
      (value.symbols.length === 0 && value.incidences.length === 0)) &&
    (value.sourceStatus === "observed"
      ? typeof value.sourceText === "string"
      : value.sourceText === undefined &&
        documentarySourceIsAbsent(value.symbols) &&
        documentarySourceIsAbsent(value.incidences) &&
        documentarySourceIsAbsent(value.unresolvedConstructs, ["message"]));
}

function documentarySourceIsAbsent(
  items: readonly unknown[],
  extraKeys: readonly string[] = [],
): boolean {
  return items.every((item) => {
    if (!isRecord(item)) return false;
    return !Object.hasOwn(item, "span") &&
      extraKeys.every((key) => !Object.hasOwn(item, key));
  });
}

function isArchitectureSysmlSealIncidence(value: unknown): boolean {
  return isRecord(value) && hasAllowedKeys(value, [
    "id",
    "kind",
    "fromSymbolId",
    "toSymbolId",
    "span",
  ]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    value.kind === "structural-incidence" &&
    typeof value.fromSymbolId === "string" && value.fromSymbolId.length > 0 &&
    typeof value.toSymbolId === "string" && value.toSymbolId.length > 0 &&
    (value.span === undefined || isArchitectureSysmlSealSpan(value.span));
}

function isArchitectureSysmlSealSymbol(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasAllowedKeys(value, ["id", "kind", "label", "span"]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.kind === "string" && value.kind.length > 0 &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.span === undefined || isArchitectureSysmlSealSpan(value.span));
}

function isArchitectureSysmlSealUnresolved(value: unknown): boolean {
  return isRecord(value) && hasAllowedKeys(value, [
    "id",
    "kind",
    "message",
    "span",
  ]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.kind === "string" && value.kind.length > 0 &&
    (value.message === undefined ||
      (typeof value.message === "string" && value.message.length > 0)) &&
    (value.span === undefined || isArchitectureSysmlSealSpan(value.span));
}

function isArchitectureSysmlSealSpan(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["start", "end"])) return false;
  if (
    !isArchitectureSysmlSealLocation(value.start) ||
    !isArchitectureSysmlSealLocation(value.end)
  ) {
    return false;
  }
  const start = value.start;
  const end = value.end;
  return end.line > start.line ||
    (end.line === start.line && end.column >= start.column);
}

function isArchitectureSysmlSealLocation(
  value: unknown,
): value is { line: number; column: number } {
  return isRecord(value) && hasExactKeys(value, ["line", "column"]) &&
    isPositiveSafeInteger(value.line) &&
    isNonNegativeSafeInteger(value.column);
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

function isThreadComponentCatalog(
  value: unknown,
): value is ThreadComponentCatalog {
  if (!isRecord(value)) return false;
  const catalog = value as Partial<ThreadComponentCatalog>;
  return hasExactKeys(value, [
    "schemaVersion",
    "authority",
    "subjectId",
    "rationale",
    "systemViews",
    "components",
  ]) && catalog.schemaVersion === "thread-components/1.0" &&
    catalog.authority === "workspace-declared" &&
    typeof catalog.subjectId === "string" &&
    typeof catalog.rationale === "string" &&
    isThreadComponentSystemViews(catalog.systemViews) &&
    Array.isArray(catalog.components) &&
    catalog.components.every(isThreadComponent);
}

function isThreadComponentSystemViews(value: unknown): boolean {
  if (!isRecord(value) || !hasAllowedKeys(value, ["syson", "erpnext"])) {
    return false;
  }
  return (value.syson === undefined ||
    (isRecord(value.syson) && hasExactKeys(value.syson, [
      "projectId",
      "editingContextId",
      "diagramId",
      "diagramLabel",
    ]) && typeof value.syson.projectId === "string" &&
      typeof value.syson.editingContextId === "string" &&
      typeof value.syson.diagramId === "string" &&
      typeof value.syson.diagramLabel === "string")) &&
    (value.erpnext === undefined ||
      (isRecord(value.erpnext) && hasExactKeys(value.erpnext, ["bomName"]) &&
        typeof value.erpnext.bomName === "string"));
}

function isThreadComponent(value: unknown): value is ThreadComponent {
  if (!isRecord(value)) return false;
  const component = value as Partial<ThreadComponent>;
  return hasAllowedKeys(value, [
    "id",
    "label",
    "kind",
    "quantity",
    "parentId",
    "bindings",
    "preview",
    "attributes",
  ]) && typeof component.id === "string" && component.id.length > 0 &&
    typeof component.label === "string" &&
    (component.kind === "assembly" || component.kind === "part") &&
    typeof component.quantity === "number" &&
    Number.isFinite(component.quantity) &&
    component.quantity > 0 &&
    (component.parentId === undefined ||
      typeof component.parentId === "string") &&
    Array.isArray(component.bindings) &&
    component.bindings.every(isThreadComponentBinding) &&
    (component.preview === undefined ||
      isThreadComponentPreview(component.preview)) &&
    (component.attributes === undefined ||
      isThreadComponentAttributes(component.attributes));
}

function isThreadComponentAttributes(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const labels = new Set<string>();
  return value.every((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["id", "kind", "label"])) {
      return false;
    }
    if (
      typeof entry.id !== "string" || entry.id.length === 0 ||
      entry.kind !== "AttributeUsage" ||
      typeof entry.label !== "string" || entry.label.length === 0 ||
      ids.has(entry.id) || labels.has(entry.label)
    ) {
      return false;
    }
    ids.add(entry.id);
    labels.add(entry.label);
    return true;
  });
}

function isThreadComponentPreview(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "provider",
    "artifactId",
    "mediaType",
    "url",
    "sha256",
  ]) && value.provider === "build123d" &&
    (value.mediaType === "model/stl" ||
      value.mediaType === "model/gltf-binary") &&
    typeof value.artifactId === "string" && typeof value.url === "string" &&
    typeof value.sha256 === "string";
}

function isThreadComponentBinding(
  value: unknown,
): value is ThreadComponentBinding {
  if (!isRecord(value)) return false;
  const binding = value as Partial<ThreadComponentBinding>;
  return hasAllowedKeys(value, [
    "provider",
    "kind",
    "id",
    "label",
    "evidenceArtifactId",
    "status",
    "reason",
    "selection",
  ]) && (binding.provider === "syson" || binding.provider === "erpnext" ||
    binding.provider === "build123d" ||
    binding.provider === "digital-thread") &&
    (binding.kind === "part-definition" || binding.kind === "part-usage" ||
      binding.kind === "item" ||
      binding.kind === "artifact" || binding.kind === "assembly-child") &&
    typeof binding.id === "string" &&
    typeof binding.label === "string" &&
    typeof binding.evidenceArtifactId === "string" &&
    (binding.status === "verified" || binding.status === "unverified") &&
    (binding.reason === undefined || typeof binding.reason === "string") &&
    (binding.selection === undefined || isThreadRef(binding.selection));
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

function isProductNavigationProjection(
  value: unknown,
): value is ProductNavigationProjection {
  if (
    !isRecord(value) ||
    !hasAllowedKeys(value, [
      "schemaVersion",
      "status",
      "basis",
      "roots",
      "children",
      "attachments",
    ]) ||
    value.schemaVersion !== PRODUCT_NAVIGATION_QUERY_SCHEMA ||
    (value.status !== "observed" && value.status !== "unavailable" &&
      value.status !== "unattached" && value.status !== "unresolved") ||
    !Array.isArray(value.roots) ||
    !Array.isArray(value.children) ||
    !isProductNavigationAttachments(value.attachments)
  ) {
    return false;
  }
  if (value.status === "unavailable") {
    return value.roots.length === 0 && value.children.length === 0;
  }
  if (value.status === "observed") {
    return value.basis !== undefined && isProductNavigationBasis(value.basis) &&
      value.roots.length > 0 &&
      value.roots.every(isProductNavigationNode) &&
      value.children.every(isProductNavigationNode);
  }
  return value.roots.every(isProductNavigationNode) &&
    value.children.every(isProductNavigationNode) &&
    (value.basis === undefined || isProductNavigationBasis(value.basis));
}

function isProductNavigationAttachments(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["sources", "geometry", "physics", "requirements"]) &&
    Array.isArray(value.sources) &&
    Array.isArray(value.geometry) &&
    Array.isArray(value.physics) &&
    Array.isArray(value.requirements) &&
    [
      ...value.sources,
      ...value.geometry,
      ...value.physics,
      ...value.requirements,
    ]
      .every(isProductNavigationAttachment);
}

function isProductNavigationAttachment(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["group", "kind", "id", "label"]) &&
    (value.group === "sources" || value.group === "geometry" ||
      value.group === "physics" || value.group === "requirements") &&
    (value.kind === "source-file" || value.kind === "artifact" ||
      value.kind === "requirement") &&
    typeof value.id === "string" &&
    typeof value.label === "string";
}

function isProductNavigationBasis(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, [
      "projectId",
      "threadSnapshotId",
      "threadRevision",
      "threadSubjectId",
      "architectureArtifactId",
      "architectureFingerprint",
      "captureSchema",
    ]) &&
    typeof value.projectId === "string" &&
    typeof value.threadSnapshotId === "string" &&
    isPositiveSafeInteger(value.threadRevision) &&
    typeof value.threadSubjectId === "string" &&
    value.threadSubjectId.length > 0 &&
    typeof value.architectureArtifactId === "string" &&
    typeof value.architectureFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.architectureFingerprint) &&
    value.captureSchema === "architecture-capture/4.0";
}

function isProductNavigationNode(value: unknown): boolean {
  return isRecord(value) &&
    hasAllowedKeys(value, [
      "element",
      "occurrence",
      "typedDefinition",
      "label",
      "expandable",
    ]) &&
    isProductStructureElementRef(value.element) &&
    typeof value.label === "string" &&
    typeof value.expandable === "boolean" &&
    (value.occurrence === undefined ||
      isProductStructureOccurrenceRef(value.occurrence)) &&
    (value.typedDefinition === undefined ||
      isProductStructureElementRef(value.typedDefinition));
}

function isProductStructureElementRef(
  value: unknown,
): value is { elementKind: "PartDefinition" | "PartUsage"; elementId: string } {
  return isRecord(value) &&
    hasExactKeys(value, ["elementKind", "elementId"]) &&
    (value.elementKind === "PartDefinition" ||
      value.elementKind === "PartUsage") &&
    typeof value.elementId === "string" &&
    value.elementId.length > 0;
}

function isProductStructureOccurrenceRef(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ["element", "path"]) &&
    isProductStructureElementRef(value.element) &&
    value.element.elementKind === "PartUsage" &&
    Array.isArray(value.path) &&
    value.path.length > 0 &&
    value.path.every((item) => typeof item === "string") &&
    value.path[value.path.length - 1] === value.element.elementId;
}

function isThreadSourceFileCatalog(
  value: unknown,
  graph: ThreadGraph,
): value is ThreadSourceFileCatalog {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "status", "files"]) ||
    value.schemaVersion !== THREAD_SOURCE_FILE_CATALOG_SCHEMA ||
    (value.status !== "observed" && value.status !== "unattached" &&
      value.status !== "unavailable") ||
    !Array.isArray(value.files)
  ) {
    return false;
  }
  const files = value.files as ThreadSourceFileCatalog["files"];
  if (value.status === "unavailable" || value.status === "unattached") {
    return files.length === 0;
  }
  if (files.length === 0) return false;
  const sourceFileIds = new Set(
    graph.nodes.flatMap((node) =>
      node.ref.kind === "source-file" ? [node.ref.id] : []
    ),
  );
  return files.every((file) =>
    isThreadSourceFileRecord(file) &&
    sourceFileIds.has(`${file.fileId}@${file.fileRevision}`)
  );
}

function isThreadSourceFileRecord(
  value: unknown,
): value is ThreadSourceFileCatalog["files"][number] {
  if (!isRecord(value)) return false;
  return hasAllowedKeys(value, [
    "fileId",
    "fileRevision",
    "workspaceRevision",
    "workspaceEventFingerprint",
    "fileFingerprint",
    "resourceFingerprint",
    "resourceUri",
    "resourceName",
    "mimeType",
    "moduleId",
    "role",
    "admissionArtifactId",
    "bindings",
    "derivedPath",
  ]) &&
    typeof value.fileId === "string" && value.fileId.length > 0 &&
    isPositiveSafeInteger(value.fileRevision) &&
    isPositiveSafeInteger(value.workspaceRevision) &&
    typeof value.workspaceEventFingerprint === "string" &&
    typeof value.fileFingerprint === "string" &&
    typeof value.resourceFingerprint === "string" &&
    typeof value.resourceUri === "string" &&
    typeof value.resourceName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.moduleId === "string" &&
    typeof value.role === "string" &&
    typeof value.admissionArtifactId === "string" &&
    Array.isArray(value.bindings) &&
    value.bindings.every(isThreadSourceFileBinding) &&
    (value.derivedPath === undefined || typeof value.derivedPath === "string");
}

function isThreadSourceFileBinding(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, [
      "relation",
      "sourceSymbolId",
      "sysmlElementId",
      "sysmlElementKind",
    ]) &&
    (value.relation === "represents" || value.relation === "parameterizes") &&
    typeof value.sourceSymbolId === "string" &&
    typeof value.sysmlElementId === "string" &&
    typeof value.sysmlElementKind === "string";
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
      reference.kind === "attribute-usage" ||
      reference.kind === "cad-lever" ||
      reference.kind === "cad-unnamed-literal" ||
      reference.kind === "source-file");
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
    value === "parameterizes" ||
    value === "unnamed_in" ||
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
