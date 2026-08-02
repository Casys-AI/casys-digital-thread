/**
 * Browser-safe projection of the linked engineering thread.
 *
 * This contract deliberately contains no MCP transport types. The backend owns
 * tool calls and projects their persisted, linked evidence into this snapshot.
 */

import type { EngineeringProjectSnapshot } from "../../../domain/engineering-project.ts";
import {
  type EngineeringWorkbenchCapabilities,
  isOperatorCommandCapabilities,
} from "../project/command-contract.ts";
import { isEngineeringProjectSnapshot } from "../project/contract.ts";

export type ThreadFreshness = "fresh" | "stale" | "running" | "failed";
export type ThreadTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ThreadRef {
  kind: "change" | "artifact" | "observation" | "requirement" | "violation";
  id: string;
}

/** Every canonical entity kind which can participate in the native graph. */
export interface ThreadGraphRef {
  kind:
    | "artifact"
    | "consumption"
    | "observation"
    | "requirement"
    | "evaluation"
    | "violation"
    | "change"
    | "action";
  id: string;
}

/** Canonical provenance relations plus two explicit structural facts. */
export type ThreadGraphRelation =
  | "changes"
  | "derived_from"
  | "traces_to"
  | "uses"
  | "evaluates"
  | "evidences"
  | "caused_by"
  | "addresses"
  | "supersedes"
  | "input_to"
  | "source_of";

export interface ThreadGraphNode {
  /** Stable browser key, distinct from the canonical entity id. */
  id: string;
  ref: ThreadGraphRef;
  entityKind: ThreadGraphRef["kind"];
  /** Canonical artifact kind, present only for artifact nodes. */
  artifactKind?: string;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  /** Canonical timestamp used to order this fact in the activity feed. */
  recordedAt?: string;
  /** Existing inspector target when this entity has a native detail panel. */
  selection?: ThreadRef;
}

export interface ThreadGraphEdgeAttestation {
  consumptionId: string;
  status: "verified" | "mismatch";
  producerFingerprint: string;
  consumedFingerprint: string;
  checkedAt: string;
}

export interface ThreadGraphEdge {
  id: string;
  /** Visual direction: dependency/source -> result/consumer. */
  from: ThreadGraphRef;
  to: ThreadGraphRef;
  relation: ThreadGraphRelation;
  rationale: string;
  origin: "provenance" | "structure";
  attestation?: ThreadGraphEdgeAttestation;
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
}

export interface ThreadChange {
  id: string;
  title: string;
  summary: string;
  author: string;
  revision: string;
  changedAt: string;
  status: "evaluated" | "partially_evaluated" | "pending";
  files: string[];
}

export interface ThreadFlowStage {
  id: string;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  selection: ThreadRef;
  /** Stage ids backed by an explicit canonical dependency or provenance link. */
  dependsOn: string[];
}

export interface ThreadArtifact {
  id: string;
  label: string;
  kind: string;
  system: string;
  revision: string;
  freshness: ThreadFreshness;
  fingerprint?: string;
  uri?: string;
  producedAt?: string;
  producedBy?: string;
  dependsOn: string[];
  attestation?: {
    status: "verified" | "mismatch";
    sourceArtifactId: string;
    producerFingerprint: string;
    consumedFingerprint: string;
    checkedAt: string;
  };
}

export interface ThreadObservation {
  id: string;
  label: string;
  value: number;
  unit: string;
  display: string;
  sourceArtifactId: string;
  requirementIds: string[];
  freshness: ThreadFreshness;
  measuredAt?: string;
}

export interface ThreadRequirement {
  id: string;
  label: string;
  source: string;
  expression: string;
  status: "pass" | "fail" | "unresolved";
  observationIds: string[];
  violationIds: string[];
  rationale: string;
}

export interface ThreadViolation {
  id: string;
  name: string;
  severity: "blocking" | "warning";
  status: "open" | "resolved";
  requirementId: string;
  observationId: string;
  message: string;
  margin: string;
  evidence: string[];
  proposedActionIds: string[];
}

export interface ThreadAction {
  id: string;
  label: string;
  description: string;
  kind: "change" | "recompute" | "inspect";
  targetId: string;
  system: string;
  readiness: "ready" | "blocked";
  requiresConfirmation: boolean;
}

export type ThreadComponentProvider = "syson" | "erpnext" | "build123d";

export interface ThreadComponentBinding {
  provider: ThreadComponentProvider;
  kind: "part-usage" | "item" | "artifact" | "assembly-child";
  id: string;
  label: string;
  evidenceArtifactId: string;
  status: "verified" | "unverified";
  reason?: string;
  /** Existing browser record which carries the provider evidence. */
  selection?: ThreadRef;
}

export interface ThreadComponentPreview {
  provider: "build123d";
  artifactId: string;
  mediaType: "model/stl";
  url: string;
  /** Presentation mesh fingerprint, distinct from the authoritative CAD hash. */
  sha256: string;
}

export interface ThreadComponent {
  id: string;
  label: string;
  kind: "assembly" | "part";
  quantity: number;
  parentId?: string;
  bindings: ThreadComponentBinding[];
  preview?: ThreadComponentPreview;
}

export interface ThreadComponentCatalog {
  schemaVersion: "thread-components/1.0";
  authority: "workspace-declared";
  subjectId: string;
  rationale: string;
  systemViews: {
    syson?: {
      projectId: string;
      editingContextId: string;
      diagramId: string;
      diagramLabel: string;
    };
    erpnext?: { bomName: string };
  };
  components: ThreadComponent[];
}

export interface ThreadWorkbenchSnapshot {
  /** UI projection produced from the canonical domain ThreadSnapshot. */
  schemaVersion: "thread-workbench/0.1";
  id: string;
  subject: {
    id: string;
    label: string;
    program: string;
  };
  generatedAt: string;
  source: "observed" | "fixture";
  sourceLabel: string;
  change: ThreadChange;
  components: ThreadComponentCatalog;
  graph: ThreadGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}

/** Common BFF fields for a native project surface. */
export interface EngineeringWorkbenchBaseSnapshot {
  readonly schemaVersion: "engineering-workbench/0.2";
  readonly project: EngineeringProjectSnapshot;
  /** Absent means read-only. Mutation is never inferred from HTTP availability. */
  readonly capabilities?: EngineeringWorkbenchCapabilities;
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
 * A durable capture of the approved discovery and reviewed path.
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
      readonly origin: "approved-discovery";
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
  };
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
  if (
    !(candidate.schemaVersion === "engineering-workbench/0.2") ||
    !isEngineeringProjectSnapshot(candidate.project) ||
    (candidate.capabilities !== undefined &&
      (!candidate.capabilities ||
        !isOperatorCommandCapabilities(
          candidate.capabilities.operatorCommands,
        )))
  ) {
    return false;
  }
  if (candidate.surface === "planning") {
    return candidate.project.threadSnapshots.length === 0 &&
      isPlanningWorkbenchProjection(candidate.planning);
  }
  if (candidate.surface === "documentary") {
    const reference = candidate.project.threadSnapshots[0];
    return hasAllowedKeys(candidate, [
      "schemaVersion",
      "surface",
      "project",
      "capabilities",
      "documentary",
    ]) && candidate.project.threadSnapshots.length === 1 &&
      reference !== undefined &&
      isDocumentaryWorkbenchProjection(candidate.documentary) &&
      candidate.documentary.record.snapshotId === reference.snapshotId &&
      candidate.documentary.record.snapshotRevision === reference.revision;
  }
  return candidate.surface === "evidence" &&
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
    !hasExactKeys(documentary, [
      "status",
      "message",
      "record",
      "technicalEvidence",
    ]) ||
    documentary.status !== "recorded" ||
    typeof documentary.message !== "string" ||
    !isDocumentaryRecord(documentary.record) ||
    !isDocumentaryTechnicalEvidence(documentary.technicalEvidence)
  ) {
    return false;
  }
  return true;
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
  ]) && record.origin === "approved-discovery" &&
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
    !!candidate.subject &&
    !!candidate.change &&
    isThreadComponentCatalog(candidate.components) &&
    isThreadGraph(candidate.graph) &&
    Array.isArray(candidate.flow) &&
    candidate.flow.every(isThreadFlowStage) &&
    Array.isArray(candidate.artifacts) &&
    Array.isArray(candidate.observations) &&
    Array.isArray(candidate.requirements) &&
    Array.isArray(candidate.violations) &&
    Array.isArray(candidate.actions);
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
        component.preview.mediaType === "model/stl" &&
        typeof component.preview.url === "string" &&
        typeof component.preview.sha256 === "string"));
}

function isThreadComponentBinding(
  value: unknown,
): value is ThreadComponentBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<ThreadComponentBinding>;
  return (binding.provider === "syson" || binding.provider === "erpnext" ||
    binding.provider === "build123d") &&
    (binding.kind === "part-usage" || binding.kind === "item" ||
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
    typeof node.label === "string" &&
    typeof node.system === "string" &&
    isThreadFreshness(node.freshness) &&
    typeof node.summary === "string" &&
    (node.recordedAt === undefined || typeof node.recordedAt === "string") &&
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
    (edge.origin === "provenance" || edge.origin === "structure") &&
    (edge.attestation === undefined ||
      isThreadGraphEdgeAttestation(edge.attestation));
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
      reference.kind === "action");
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
    value === "source_of";
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
