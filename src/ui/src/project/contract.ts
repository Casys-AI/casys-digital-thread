import type {
  EngineeringAgentRunStatus,
  EngineeringApprovalStatus,
  EngineeringBlockerStatus,
  EngineeringDecisionStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItemStatus,
} from "../../../domain/engineering-project.ts";

const WORK_ITEM_STATUSES: readonly EngineeringWorkItemStatus[] = [
  "planned",
  "ready",
  "in-progress",
  "waiting-for-decision",
  "completed",
  "cancelled",
];

const AGENT_RUN_STATUSES: readonly EngineeringAgentRunStatus[] = [
  "queued",
  "running",
  "waiting-for-decision",
  "publishing",
  "completed",
  "failed",
  "cancelled",
];

const DECISION_STATUSES: readonly EngineeringDecisionStatus[] = [
  "required",
  "proposed",
  "approved",
  "rejected",
  "superseded",
];

const APPROVAL_STATUSES: readonly EngineeringApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "revoked",
];

const BLOCKER_STATUSES: readonly EngineeringBlockerStatus[] = [
  "open",
  "resolved",
];

const PROJECT_STARTING_POINTS = [
  "idea-or-spec",
  "existing-cad",
  "existing-product",
] as const;

const THREAD_ENTITY_KINDS = [
  "artifact",
  "consumption",
  "observation",
  "requirement",
  "evaluation",
  "violation",
  "change",
  "action",
] as const;

/** Browser boundary check for the JSON project snapshot delivered by the BFF. */
export function isEngineeringProjectSnapshot(
  value: unknown,
): value is EngineeringProjectSnapshot {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== "1.0" || typeof value.id !== "string" ||
    typeof value.revision !== "number" || typeof value.generatedAt !== "string"
  ) return false;
  if (!isRecord(value.project) || !isRecord(value.project.objective)) {
    return false;
  }
  if (
    typeof value.project.id !== "string" ||
    typeof value.project.name !== "string" ||
    typeof value.project.subjectId !== "string" ||
    typeof value.project.objective.title !== "string" ||
    typeof value.project.objective.statement !== "string"
  ) return false;

  return isArrayOf(
    value.threadSnapshots,
    (item) =>
      isRecord(item) && typeof item.snapshotId === "string" &&
      typeof item.revision === "number" && typeof item.subjectId === "string",
  ) &&
    isArrayOf(
      value.phases,
      (item) =>
        isRecord(item) && typeof item.id === "string" &&
        typeof item.name === "string" && typeof item.order === "number" &&
        typeof item.description === "string" &&
        isStringArray(item.workItemIds) &&
        isStringArray(item.requiredDecisionIds) &&
        Array.isArray(item.evidenceRefs),
    ) &&
    isArrayOf(
      value.workItems,
      (item) =>
        isRecord(item) && typeof item.id === "string" &&
        typeof item.phaseId === "string" && typeof item.title === "string" &&
        typeof item.description === "string" &&
        WORK_ITEM_STATUSES.includes(item.status as EngineeringWorkItemStatus) &&
        (item.owner === "human" || item.owner === "agent" ||
          item.owner === "shared") &&
        isStringArray(item.dependsOnWorkItemIds) &&
        isStringArray(item.decisionIds) && isStringArray(item.blockerIds) &&
        Array.isArray(item.evidenceRefs) &&
        (item.operation === undefined ||
          isEngineeringOperation(item.operation)),
    ) &&
    isArrayOf(
      value.agentRuns,
      (item) =>
        isRecord(item) && typeof item.id === "string" &&
        typeof item.workItemId === "string" &&
        typeof item.summary === "string" &&
        typeof item.queuedAt === "string" &&
        AGENT_RUN_STATUSES.includes(item.status as EngineeringAgentRunStatus) &&
        Array.isArray(item.evidenceRefs) && hasValidInputAnchor(item) &&
        (item.claimedBy === undefined || isCommandActor(item.claimedBy)) &&
        (item.waitingForDecisionIds === undefined ||
          isStringArray(item.waitingForDecisionIds)) &&
        (item.resultSnapshot === undefined ||
          isThreadSnapshotRef(item.resultSnapshot)) &&
        (item.failure === undefined ||
          (isRecord(item.failure) && typeof item.failure.code === "string" &&
            typeof item.failure.message === "string")) &&
        (item.statusHistory === undefined ||
          isArrayOf(item.statusHistory, isAgentRunTransition)),
    ) &&
    isArrayOf(
      value.decisions,
      (item) =>
        isRecord(item) && typeof item.id === "string" &&
        typeof item.phaseId === "string" && typeof item.title === "string" &&
        typeof item.question === "string" &&
        typeof item.requestedAt === "string" &&
        DECISION_STATUSES.includes(item.status as EngineeringDecisionStatus) &&
        isStringArray(item.approvalIds) &&
        Array.isArray(item.inputEvidenceRefs) &&
        hasValidInputAnchor(item) &&
        (item.proposal === undefined || isDecisionProposal(item.proposal)),
    ) &&
    isArrayOf(
      value.approvals,
      (item) =>
        isRecord(item) && typeof item.id === "string" &&
        typeof item.decisionId === "string" &&
        typeof item.requestedAt === "string" &&
        APPROVAL_STATUSES.includes(item.status as EngineeringApprovalStatus) &&
        Array.isArray(item.inputEvidenceRefs) && hasValidInputAnchor(item) &&
        (item.decidedByOrigin === undefined ||
          item.decidedByOrigin === "human" || item.decidedByOrigin === "agent"),
    ) &&
    isArrayOf(
      value.blockers,
      (item) =>
        isRecord(item) && typeof item.id === "string" &&
        typeof item.phaseId === "string" && typeof item.title === "string" &&
        typeof item.description === "string" &&
        typeof item.openedAt === "string" &&
        BLOCKER_STATUSES.includes(item.status as EngineeringBlockerStatus) &&
        isStringArray(item.workItemIds) && isStringArray(item.decisionIds),
    ) &&
    (value.plan === undefined || isEngineeringProjectPlan(value.plan));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

function isArrayOf(
  value: unknown,
  predicate: (item: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function isEngineeringProjectPlan(value: unknown): boolean {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "startingPoint",
      "basis",
      "publishedAt",
      "publishedBy",
    ])
  ) {
    return false;
  }
  return PROJECT_STARTING_POINTS.includes(
    value.startingPoint as typeof PROJECT_STARTING_POINTS[number],
  ) &&
    isApprovedDiscoveryBasis(value.basis) &&
    isIsoDateTime(value.publishedAt) &&
    isPlanPublisher(value.publishedBy);
}

function isApprovedDiscoveryBasis(value: unknown): boolean {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "kind",
      "discoveryId",
      "snapshotId",
      "revision",
      "briefId",
      "approvedBriefFingerprint",
    ])
  ) {
    return false;
  }
  return value.kind === "approved-discovery" &&
    isNonEmptyString(value.discoveryId) &&
    isNonEmptyString(value.snapshotId) &&
    isPositiveInteger(value.revision) &&
    isNonEmptyString(value.briefId) &&
    isSha256Fingerprint(value.approvedBriefFingerprint);
}

function isPlanPublisher(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["id", "origin"]) &&
    isNonEmptyString(value.id) &&
    value.origin === "agent";
}

function isEngineeringOperation(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "version", "bindings"])) {
    return false;
  }
  return isNonEmptyString(value.id) && isNonEmptyString(value.version) &&
    Array.isArray(value.bindings) &&
    value.bindings.every(isEngineeringOperationBinding) &&
    hasUniqueBindingNames(value.bindings);
}

function isEngineeringOperationBinding(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["name", "source"])) {
    return false;
  }
  return isNonEmptyString(value.name) &&
    isEngineeringOperationBindingSource(value.source);
}

function isEngineeringOperationBindingSource(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "approved-discovery":
      return hasExactKeys(value, ["kind"]);
    case "discovery-answer":
      return hasExactKeys(value, ["kind", "answerId"]) &&
        isNonEmptyString(value.answerId);
    case "decision-parameter":
      return hasExactKeys(value, ["kind", "decisionId", "key"]) &&
        isNonEmptyString(value.decisionId) && isNonEmptyString(value.key);
    case "thread-entity":
      return hasExactKeys(value, ["kind", "reference"]) &&
        isEngineeringThreadEntityRef(value.reference);
    default:
      return false;
  }
}

function isEngineeringThreadEntityRef(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "snapshotId",
    "snapshotRevision",
    "kind",
    "id",
  ]) &&
    isNonEmptyString(value.snapshotId) &&
    isPositiveInteger(value.snapshotRevision) &&
    THREAD_ENTITY_KINDS.includes(
      value.kind as typeof THREAD_ENTITY_KINDS[number],
    ) &&
    isNonEmptyString(value.id);
}

function hasUniqueBindingNames(bindings: readonly unknown[]): boolean {
  const names = bindings.map((binding) =>
    (binding as Record<string, unknown>).name as string
  );
  return new Set(names).size === names.length;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isSha256Fingerprint(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["algorithm", "digest"]) &&
    value.algorithm === "sha256" && typeof value.digest === "string" &&
    /^[a-f0-9]{64}$/i.test(value.digest);
}

function hasValidInputAnchor(value: Record<string, unknown>): boolean {
  const hasBase = value.baseSnapshot !== undefined;
  const hasFingerprint = value.inputFingerprint !== undefined;
  if (hasBase !== hasFingerprint) return false;
  if (!hasBase) return true;
  return isRecord(value.baseSnapshot) &&
    typeof value.baseSnapshot.snapshotId === "string" &&
    typeof value.baseSnapshot.revision === "number" &&
    typeof value.baseSnapshot.subjectId === "string" &&
    isRecord(value.inputFingerprint) &&
    value.inputFingerprint.algorithm === "sha256" &&
    typeof value.inputFingerprint.digest === "string";
}

function isThreadSnapshotRef(value: unknown): boolean {
  return isRecord(value) && typeof value.snapshotId === "string" &&
    typeof value.revision === "number" && typeof value.subjectId === "string";
}

function isCommandActor(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" &&
    (value.origin === "human" || value.origin === "agent");
}

function isDecisionProposal(value: unknown): boolean {
  return isRecord(value) && typeof value.summary === "string" &&
    typeof value.proposedAt === "string" &&
    isCommandActor(value.proposedBy) &&
    isArrayOf(value.parameters, (parameter) => {
      if (!isRecord(parameter)) return false;
      const hasSupportedValue = typeof parameter.value === "string" ||
        typeof parameter.value === "number" ||
        typeof parameter.value === "boolean";
      return typeof parameter.key === "string" &&
        typeof parameter.label === "string" && hasSupportedValue &&
        (parameter.unit === undefined ||
          (typeof parameter.value === "number" &&
            typeof parameter.unit === "string"));
    });
}

function isAgentRunTransition(value: unknown): boolean {
  return isRecord(value) && typeof value.commandId === "string" &&
    AGENT_RUN_STATUSES.includes(value.status as EngineeringAgentRunStatus) &&
    typeof value.at === "string" && isCommandActor(value.actor) &&
    typeof value.summary === "string";
}
