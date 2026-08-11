/**
 * Browser-safe projection of the linked engineering thread.
 *
 * This contract deliberately contains no MCP transport types. The backend owns
 * tool calls and projects their persisted, linked evidence into this snapshot.
 */

import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadAnalysisEdgeDetail,
  ThreadAnalysisNodeDetail,
  ThreadAnalysisQuantity,
  ThreadAnalysisScope,
  ThreadAnalysisSemanticRef,
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
  ThreadRef,
  ThreadRequirement,
  ThreadWorkbenchPreviousSnapshot,
  ThreadWorkbenchSnapshot,
} from "../../../contracts/thread-workbench.ts";
import {
  isEngineeringProjectSnapshot,
  isEngineeringPublicPretechnicalProjectSnapshot,
} from "../project/contract.ts";

export type {
  ThreadAction,
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

/** Common BFF fields for a native project surface. */
export interface EngineeringWorkbenchBaseSnapshot {
  readonly schemaVersion: "engineering-workbench/0.2";
  readonly project: EngineeringProjectSnapshot;
}

/** Project intent and linked technical proof delivered as one atomic BFF read. */
export interface EngineeringEvidenceWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "evidence";
  readonly thread: ThreadWorkbenchSnapshot;
  readonly alignment: {
    readonly status: "aligned" | "thread-ahead";
    readonly projectThreadRevision: number;
    readonly currentThreadRevision: number;
  };
}

/**
 * A durable capture of the approved project brief and reviewed path.
 *
 * This deliberately has no `thread` field: the first record is documentary
 * provenance, not an empty evidence graph. CAD, SysML, simulation,
 * measurement, requirement and compliance claims must arrive through a later
 * linked technical snapshot.
 */
export interface EngineeringDocumentaryWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "documentary";
  readonly documentary: {
    readonly status: "recorded";
    readonly message: string;
    readonly record: {
      readonly origin: "approved-brief";
      readonly snapshotId: string;
      readonly snapshotRevision: number;
      readonly artifactId: string;
      readonly label: string;
      readonly fingerprint: string;
      readonly uri?: string;
      readonly recordedAt: string;
    };
    readonly technicalEvidence: {
      readonly status: "not-recorded";
      readonly message: string;
    };
    /**
     * Browser-safe live context for the one bounded SysON container seed. It
     * deliberately contains no generic thread graph, provider identities,
     * tool arguments, or raw structured results.
     */
    readonly technicalStart?: EngineeringDocumentaryTechnicalStart;
  };
}

export type EngineeringDocumentaryTechnicalStartState =
  | "queued"
  | "running"
  | "publishing"
  | "failed";

export interface EngineeringDocumentaryTechnicalStart {
  readonly kind: "sysml-container-seed";
  readonly state: EngineeringDocumentaryTechnicalStartState;
  readonly message: string;
  readonly activity: {
    readonly version: number;
    readonly steps: readonly EngineeringDocumentaryTechnicalStartStep[];
  };
}

export interface EngineeringDocumentaryTechnicalStartStep {
  readonly id: "project-container" | "sysml-document" | "root-package";
  readonly state: "running" | "fresh" | "failed";
  readonly label: string;
  readonly summary: string;
  readonly recordedAt: string;
  readonly predecessor?: "project-container" | "sysml-document";
}

/**
 * Discovery-derived project intent before any documentary pre-technical baseline exists.
 * This is deliberately not an empty technical thread.
 */
export interface EngineeringPlanningWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "planning";
  readonly planning: {
    readonly technicalBaseline: {
      readonly status: EngineeringTechnicalBaselineStatus;
      readonly message: string;
    };
    /** Public-safe status history for the first documentary baseline attempt. */
    readonly baselineRun?: EngineeringPlanningBaselineRun;
    /** Filtered milestones from the append-only live activity journal. */
    readonly activity: EngineeringPlanningActivity;
  };
}

export type EngineeringTechnicalBaselineStatus =
  | "not-created"
  | "queued"
  | "running"
  | "publishing"
  | "failed";

export type EngineeringPlanningAgentRunStatus =
  | "queued"
  | "running"
  | "waiting-for-decision"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export interface EngineeringPlanningBaselineRun {
  readonly id: string;
  readonly status: EngineeringPlanningAgentRunStatus;
  readonly workItem: {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
  };
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  /** Intentionally excludes command id, actor id and agent/provider prose. */
  readonly statusHistory: readonly EngineeringPlanningBaselineRunMilestone[];
}

export interface EngineeringPlanningBaselineRunMilestone {
  readonly status: EngineeringPlanningAgentRunStatus;
  readonly at: string;
}

export interface EngineeringPlanningActivity {
  readonly version: number;
  /** No run id, operation id, graph patch, tool arguments or tool result. */
  readonly milestones: readonly EngineeringPlanningActivityMilestone[];
}

export interface EngineeringPlanningActivityMilestone {
  readonly sequence: number;
  readonly state: "running" | "fresh" | "failed" | "reconciled";
  readonly recordedAt: string;
}

export type EngineeringWorkbenchSnapshot =
  | EngineeringEvidenceWorkbenchSnapshot
  | EngineeringDocumentaryWorkbenchSnapshot
  | EngineeringPlanningWorkbenchSnapshot;

export function isEngineeringWorkbenchSnapshot(
  value: unknown,
): value is EngineeringWorkbenchSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EngineeringWorkbenchSnapshot>;
  if (!(candidate.schemaVersion === "engineering-workbench/0.2")) {
    return false;
  }
  if (candidate.surface === "planning") {
    return isEngineeringPublicPretechnicalProjectSnapshot(candidate.project) &&
      candidate.project.threadSnapshots.length === 0 &&
      isPlanningWorkbenchProjection(candidate.planning);
  }
  if (candidate.surface === "documentary") {
    if (!isEngineeringPublicPretechnicalProjectSnapshot(candidate.project)) {
      return false;
    }
    const reference = candidate.project.threadSnapshots[0];
    return hasAllowedKeys(candidate, [
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
    isEngineeringProjectSnapshot(candidate.project) &&
    isThreadWorkbenchSnapshot(candidate.thread) &&
    !!candidate.alignment &&
    (candidate.alignment.status === "aligned" ||
      candidate.alignment.status === "thread-ahead") &&
    typeof candidate.alignment.projectThreadRevision === "number" &&
    typeof candidate.alignment.currentThreadRevision === "number";
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
    typeof run.workItem.kind === "string" &&
    typeof run.queuedAt === "string" &&
    (run.startedAt === undefined || typeof run.startedAt === "string") &&
    (run.completedAt === undefined || typeof run.completedAt === "string") &&
    Array.isArray(run.statusHistory) &&
    run.statusHistory.every(isPlanningBaselineRunMilestone);
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

export function isThreadWorkbenchSnapshot(
  value: unknown,
): value is ThreadWorkbenchSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThreadWorkbenchSnapshot>;
  return candidate.schemaVersion === "thread-workbench/0.1" &&
    typeof candidate.id === "string" &&
    typeof candidate.generatedAt === "string" &&
    (candidate.previous === undefined ||
      isThreadWorkbenchPreviousSnapshot(candidate.previous)) &&
    !!candidate.subject &&
    !!candidate.change &&
    isThreadComponentCatalog(candidate.components) &&
    isThreadGraph(candidate.graph) &&
    isThreadEvidenceFamilyGraph(candidate.evidenceFamilyGraph) &&
    Array.isArray(candidate.flow) &&
    candidate.flow.every(isThreadFlowStage) &&
    Array.isArray(candidate.artifacts) &&
    Array.isArray(candidate.observations) &&
    Array.isArray(candidate.requirements) &&
    candidate.requirements.every(isThreadRequirement) &&
    Array.isArray(candidate.violations) &&
    Array.isArray(candidate.actions);
}

function isThreadRequirement(value: unknown): value is ThreadRequirement {
  if (!value || typeof value !== "object") return false;
  const requirement = value as Partial<ThreadRequirement>;
  return typeof requirement.id === "string" && requirement.id.length > 0 &&
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
): value is ThreadEvidenceFamilyGraph {
  if (!value || typeof value !== "object") return false;
  const graph = value as Partial<ThreadEvidenceFamilyGraph>;
  return graph.schemaVersion === "thread-evidence-family-graph/1.0" &&
    !!graph.asOf && typeof graph.asOf.snapshotId === "string" &&
    graph.asOf.snapshotId.length > 0 &&
    typeof graph.asOf.revision === "number" &&
    Number.isSafeInteger(graph.asOf.revision) && graph.asOf.revision > 0 &&
    Array.isArray(graph.families) &&
    graph.families.every(isThreadEvidenceFamily) &&
    Array.isArray(graph.edges) &&
    graph.edges.every(isThreadEvidenceFamilyGraphEdge) &&
    Array.isArray(graph.omittedSelfLoops) &&
    graph.omittedSelfLoops.every(isThreadEvidenceFamilyOmittedSelfLoop) &&
    Array.isArray(graph.omittedCycleEdges) &&
    graph.omittedCycleEdges.every(isThreadEvidenceFamilyOmittedCycleEdge);
}

function isThreadEvidenceFamily(value: unknown): value is ThreadEvidenceFamily {
  if (!value || typeof value !== "object") return false;
  const family = value as Partial<ThreadEvidenceFamily>;
  const hasCurrent = family.status === "current" &&
    Array.isArray(family.currentRefs) && family.currentRefs.length === 1 &&
    family.reviewReason === undefined;
  const needsReview = family.status === "review-required" &&
    (family.reviewReason === "divergent-successors" ||
      family.reviewReason === "no-current-successor");
  return typeof family.id === "string" && family.id.length > 0 &&
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
    !!family.relationship && family.relationship.relation === "supersedes" &&
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
  if (!value || typeof value !== "object") return false;
  const transition = value as Partial<ThreadEvidenceFamilyTransition>;
  return isThreadEvidenceFamilyEdgeRef(transition.edgeRef) &&
    transition.edgeRef.relation === "supersedes" &&
    isThreadGraphRef(transition.historical) &&
    isThreadGraphRef(transition.successor) &&
    (transition.historical.kind !== transition.successor.kind ||
      transition.historical.id !== transition.successor.id);
}

function isThreadEvidenceFamilyEdgeRef(
  value: unknown,
): value is ThreadEvidenceFamilyEdgeRef {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ThreadEvidenceFamilyEdgeRef>;
  return typeof reference.id === "string" && reference.id.length > 0 &&
    isThreadGraphRelation(reference.relation) &&
    (reference.origin === "provenance" || reference.origin === "structure");
}

function isThreadEvidenceFamilyGraphEdge(
  value: unknown,
): value is ThreadEvidenceFamilyGraphEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<ThreadEvidenceFamilyGraphEdge>;
  return typeof edge.id === "string" && edge.id.length > 0 &&
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
  if (!value || typeof value !== "object") return false;
  const loop = value as Partial<ThreadEvidenceFamilyOmittedSelfLoop>;
  return typeof loop.familyId === "string" && loop.familyId.length > 0 &&
    Array.isArray(loop.memberEdgeRefs) && loop.memberEdgeRefs.length > 0 &&
    loop.memberEdgeRefs.every(isThreadEvidenceFamilyEdgeRef);
}

function isThreadEvidenceFamilyOmittedCycleEdge(
  value: unknown,
): value is ThreadEvidenceFamilyOmittedCycleEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<ThreadEvidenceFamilyOmittedCycleEdge>;
  return typeof edge.fromFamilyId === "string" &&
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
  if (!value || typeof value !== "object") return false;
  const catalog = value as Partial<ThreadComponentCatalog>;
  return catalog.schemaVersion === "thread-components/1.0" &&
    catalog.authority === "workspace-declared" &&
    typeof catalog.subjectId === "string" &&
    typeof catalog.rationale === "string" &&
    !!catalog.systemViews &&
    Array.isArray(catalog.components) &&
    catalog.components.every(isThreadComponent);
}

function isThreadComponent(value: unknown): value is ThreadComponent {
  if (!value || typeof value !== "object") return false;
  const component = value as Partial<ThreadComponent>;
  return typeof component.id === "string" &&
    typeof component.label === "string" &&
    (component.kind === "assembly" || component.kind === "part") &&
    typeof component.quantity === "number" &&
    Array.isArray(component.bindings) &&
    component.bindings.every(isThreadComponentBinding) &&
    (component.preview === undefined ||
      (component.preview.provider === "build123d" &&
        (component.preview.mediaType === "model/stl" ||
          component.preview.mediaType === "model/gltf-binary") &&
        typeof component.preview.artifactId === "string" &&
        typeof component.preview.url === "string" &&
        typeof component.preview.sha256 === "string"));
}

function isThreadComponentBinding(
  value: unknown,
): value is ThreadComponentBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<ThreadComponentBinding>;
  return (binding.provider === "syson" || binding.provider === "erpnext" ||
    binding.provider === "build123d" ||
    binding.provider === "digital-thread") &&
    (binding.kind === "part-definition" || binding.kind === "part-usage" ||
      binding.kind === "item" ||
      binding.kind === "artifact" || binding.kind === "assembly-child") &&
    typeof binding.id === "string" &&
    typeof binding.label === "string" &&
    typeof binding.evidenceArtifactId === "string" &&
    (binding.status === "verified" || binding.status === "unverified") &&
    (binding.selection === undefined || isThreadRef(binding.selection));
}

function isThreadGraph(value: unknown): value is ThreadGraph {
  if (!value || typeof value !== "object") return false;
  const graph = value as Partial<ThreadGraph>;
  return Array.isArray(graph.nodes) && graph.nodes.every(isThreadGraphNode) &&
    Array.isArray(graph.edges) && graph.edges.every(isThreadGraphEdge);
}

function isThreadGraphNode(value: unknown): value is ThreadGraphNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<ThreadGraphNode>;
  return typeof node.id === "string" &&
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
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<ThreadGraphEdge>;
  return typeof edge.id === "string" &&
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
  if (!value || typeof value !== "object") return false;
  const attestation = value as Partial<ThreadGraphEdgeAttestation>;
  return typeof attestation.consumptionId === "string" &&
    (attestation.status === "verified" || attestation.status === "mismatch") &&
    typeof attestation.producerFingerprint === "string" &&
    typeof attestation.consumedFingerprint === "string" &&
    typeof attestation.checkedAt === "string";
}

function isThreadGraphRef(value: unknown): value is ThreadGraphRef {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ThreadGraphRef>;
  return typeof reference.id === "string" &&
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
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ThreadRef>;
  return typeof reference.id === "string" &&
    (reference.kind === "change" ||
      reference.kind === "artifact" ||
      reference.kind === "observation" ||
      reference.kind === "requirement" ||
      reference.kind === "violation");
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
  return !!value && typeof value === "object" &&
    isThreadAnalysisSemanticRef(
      (value as Partial<ThreadAnalysisNodeDetail>).semanticRef,
    );
}

function isThreadAnalysisSemanticRef(
  value: unknown,
): value is ThreadAnalysisSemanticRef {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ThreadAnalysisSemanticRef>;
  return (reference.domain === "brief" || reference.domain === "sysml" ||
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
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<ThreadAnalysisEdgeDetail>;
  return typeof detail.assertionId === "string" &&
    detail.assertionId.length > 0 &&
    (detail.epistemicBasis === "declared" ||
      detail.epistemicBasis === "inferred" ||
      detail.epistemicBasis === "observed") &&
    !!detail.assertedBy && typeof detail.assertedBy === "object" &&
    (detail.assertedBy.kind === "agent" ||
      detail.assertedBy.kind === "analyzer" ||
      detail.assertedBy.kind === "provider" ||
      detail.assertedBy.kind === "server") &&
    typeof detail.assertedBy.id === "string" &&
    detail.assertedBy.id.length > 0 &&
    (detail.assertedBy.version === undefined ||
      typeof detail.assertedBy.version === "string") &&
    Array.isArray(detail.evidence) && detail.evidence.length > 0 &&
    detail.evidence.every((item) =>
      !!item && typeof item === "object" && typeof item.id === "string" &&
      item.id.length > 0 && isSha256Digest(item.fingerprint)
    ) &&
    isThreadAnalysisScope(detail.scope) &&
    (detail.measurement === undefined ||
      (detail.measurement.method === "forward-finite-difference" &&
        isThreadAnalysisQuantity(detail.measurement.basePoint) &&
        isThreadAnalysisQuantity(detail.measurement.perturbationStep) &&
        isThreadAnalysisQuantity(detail.measurement.responseAtBase) &&
        isThreadAnalysisQuantity(detail.measurement.responseAtPerturbed) &&
        isThreadAnalysisQuantity(detail.measurement.derivative)));
}

function isThreadAnalysisScope(value: unknown): value is ThreadAnalysisScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<ThreadAnalysisScope> & Record<string, unknown>;
  if (!isSha256Digest(scope.basisFingerprint)) return false;
  if (scope.kind === "basis") return true;
  if (scope.kind === "source-span") {
    return isThreadAnalysisSemanticRef(scope.source) &&
      isSourcePosition(scope.start) && isSourcePosition(scope.end);
  }
  if (scope.kind === "scenario") {
    return isThreadAnalysisSemanticRef(scope.scenario);
  }
  return scope.kind === "local-neighborhood" &&
    isThreadAnalysisSemanticRef(scope.parameter) &&
    isThreadAnalysisQuantity(scope.lower) &&
    isThreadAnalysisQuantity(scope.upper);
}

function isThreadAnalysisQuantity(
  value: unknown,
): value is ThreadAnalysisQuantity {
  return !!value && typeof value === "object" &&
    typeof (value as ThreadAnalysisQuantity).value === "number" &&
    Number.isFinite((value as ThreadAnalysisQuantity).value) &&
    typeof (value as ThreadAnalysisQuantity).unit === "string" &&
    (value as ThreadAnalysisQuantity).unit.length > 0;
}

function isSourcePosition(value: unknown): boolean {
  return !!value && typeof value === "object" &&
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
  if (!value || typeof value !== "object") return false;
  const stage = value as Partial<ThreadFlowStage>;
  return typeof stage.id === "string" &&
    Array.isArray(stage.dependsOn) &&
    stage.dependsOn.every((dependency) => typeof dependency === "string");
}
