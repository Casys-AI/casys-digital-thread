/**
 * Browser-safe projection of the linked engineering thread.
 *
 * This contract deliberately contains no MCP transport types. The backend owns
 * tool calls and projects their persisted, linked evidence into this snapshot.
 */

import {
  ENGINEERING_WORKBENCH_SCHEMA,
  type EngineeringDocumentaryTechnicalStart,
  type EngineeringDocumentaryTechnicalStartState,
  type EngineeringDocumentaryTechnicalStartStep,
  type EngineeringDocumentaryWorkbenchSnapshot,
  type EngineeringEvidenceWorkbenchSnapshot,
  type EngineeringPlanningActivity,
  type EngineeringPlanningActivityMilestone,
  type EngineeringPlanningAgentRunStatus,
  type EngineeringPlanningBaselineRun,
  type EngineeringPlanningBaselineRunMilestone,
  type EngineeringPlanningWorkbenchSnapshot,
  type EngineeringTechnicalBaselineStatus,
  type EngineeringWorkbenchSnapshot,
  LIVE_THREAD_OVERLAY_SCHEMA,
  type LiveThreadOverlay,
  type LiveThreadOverlayActivity,
  type LiveThreadWorkbenchSnapshot,
} from "../../../contracts/engineering-workbench.ts";
import type {
  ThreadAction,
  ThreadAnalysisEdgeDetail,
  ThreadAnalysisNodeDetail,
  ThreadAnalysisQuantity,
  ThreadAnalysisScope,
  ThreadAnalysisSemanticRef,
  ThreadArtifact,
  ThreadChange,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentCatalog,
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyEdgeRef,
  ThreadEvidenceFamilyGraph,
  ThreadEvidenceFamilyGraphEdge,
  ThreadEvidenceFamilyOmittedCycleEdge,
  ThreadEvidenceFamilyOmittedSelfLoop,
  ThreadEvidenceFamilyTransition,
  ThreadFlowStage,
  ThreadFreshness,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphEdgeAttestation,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadGraphRelation,
  ThreadObservation,
  ThreadRef,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchPreviousSnapshot,
  ThreadWorkbenchSnapshot,
} from "../../../contracts/thread-workbench.ts";
import {
  isEngineeringProjectSnapshot,
  isEngineeringPublicPretechnicalProjectSnapshot,
} from "../project/contract.ts";

export type {
  ThreadAction,
  ThreadArchitectureSysmlSealIncidence,
  ThreadArchitectureSysmlSealPresentation,
  ThreadArchitectureSysmlSealSymbol,
  ThreadArchitectureSysmlSealUnresolved,
  ThreadArtifact,
  ThreadChange,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentCatalog,
  ThreadComponentPreview,
  ThreadComponentProvider,
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyEdgeRef,
  ThreadEvidenceFamilyGraph,
  ThreadEvidenceFamilyGraphEdge,
  ThreadEvidenceFamilyOmittedCycleEdge,
  ThreadEvidenceFamilyOmittedSelfLoop,
  ThreadEvidenceFamilyTransition,
  ThreadFlowStage,
  ThreadFreshness,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphEdgeAttestation,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadGraphRelation,
  ThreadObservation,
  ThreadRef,
  ThreadRequirement,
  ThreadTone,
  ThreadViolation,
  ThreadWorkbenchPreviousSnapshot,
  ThreadWorkbenchSnapshot,
} from "../../../contracts/thread-workbench.ts";

export {
  ENGINEERING_WORKBENCH_SCHEMA,
  LIVE_THREAD_OVERLAY_SCHEMA,
} from "../../../contracts/engineering-workbench.ts";
export type {
  EngineeringDocumentaryTechnicalStart,
  EngineeringDocumentaryTechnicalStartState,
  EngineeringDocumentaryTechnicalStartStep,
  EngineeringDocumentaryWorkbenchSnapshot,
  EngineeringEvidenceWorkbenchSnapshot,
  EngineeringPlanningActivity,
  EngineeringPlanningActivityMilestone,
  EngineeringPlanningAgentRunStatus,
  EngineeringPlanningBaselineRun,
  EngineeringPlanningBaselineRunMilestone,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
  EngineeringWorkbenchAlignment,
  EngineeringWorkbenchBaseSnapshot,
  EngineeringWorkbenchSnapshot,
  LiveThreadGraphState,
  LiveThreadOverlay,
  LiveThreadOverlayActivity,
  LiveThreadUpdateState,
  LiveThreadWorkbenchSnapshot,
} from "../../../contracts/engineering-workbench.ts";

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
      "alignment",
    ]) ||
    !isEngineeringProjectSnapshot(candidate.project) ||
    !isLiveThreadWorkbenchSnapshot(candidate.thread) ||
    !isWorkbenchAlignment(candidate.alignment)
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
    "graph",
    "evidenceFamilyGraph",
    "flow",
    "artifacts",
    "observations",
    "requirements",
    "violations",
    "actions",
    "live",
  ]) && candidate.schemaVersion === "thread-workbench/0.1" &&
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
    "revision",
    "freshness",
    "fingerprint",
    "uri",
    "producedAt",
    "producedBy",
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
    Array.isArray(value.symbols) &&
    value.symbols.every(isArchitectureSysmlSealSymbol) &&
    Array.isArray(value.incidences) &&
    value.incidences.every(isArchitectureSysmlSealIncidence) &&
    Array.isArray(value.unresolvedConstructs) &&
    value.unresolvedConstructs.every(isArchitectureSysmlSealUnresolved) &&
    (value.symbolsStatus === "observed" ||
      (value.symbols.length === 0 && value.incidences.length === 0));
}

function isArchitectureSysmlSealIncidence(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "id",
    "kind",
    "fromSymbolId",
    "toSymbolId",
  ]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    value.kind === "structural-incidence" &&
    typeof value.fromSymbolId === "string" && value.fromSymbolId.length > 0 &&
    typeof value.toSymbolId === "string" && value.toSymbolId.length > 0;
}

function isArchitectureSysmlSealSymbol(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasAllowedKeys(value, ["id", "kind", "label"]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.kind === "string" && value.kind.length > 0 &&
    (value.label === undefined || typeof value.label === "string");
}

function isArchitectureSysmlSealUnresolved(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["id", "kind"]) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.kind === "string" && value.kind.length > 0;
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
  return hasExactKeys(value, [
    "id",
    "label",
    "source",
    "sourceElementId",
    "expression",
    "status",
    "observationIds",
    "violationIds",
    "rationale",
  ]) && typeof requirement.id === "string" && requirement.id.length > 0 &&
    typeof requirement.label === "string" &&
    typeof requirement.source === "string" &&
    typeof requirement.sourceElementId === "string" &&
    requirement.sourceElementId.length > 0 &&
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
      isThreadComponentPreview(component.preview));
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
      reference.kind === "part-usage");
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
