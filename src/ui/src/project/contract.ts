import type {
  EngineeringAgentRunStatus,
  EngineeringApprovalStatus,
  EngineeringApprovedBriefBasis,
  EngineeringApprovedDiscoveryBasis,
  EngineeringBasisRef,
  EngineeringBlockerStatus,
  EngineeringDecisionStatus,
  EngineeringProjectDiscoveryHandoff,
  EngineeringProjectPlan,
  EngineeringProjectSchemaVersion,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
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
  return isEngineeringProjectSnapshotShape(
    value,
    (item, schemaVersion, project) =>
      hasValidAgentRunInputAnchor(item, schemaVersion, project) &&
      (item.claimedBy === undefined || isCommandActor(item.claimedBy)) &&
      (item.waitingForDecisionIds === undefined ||
        isStringArray(item.waitingForDecisionIds)) &&
      (item.resultSnapshot === undefined ||
        isThreadSnapshotRef(item.resultSnapshot)) &&
      (item.failure === undefined || isAgentRunFailure(item.failure)) &&
      (item.statusHistory === undefined ||
        isArrayOf(item.statusHistory, isAgentRunTransition)),
  );
}

/**
 * Browser boundary check for planning and documentary workbenches before a
 * technical evidence graph exists.
 *
 * The persisted project validator above intentionally requires V2 execution
 * anchors. Those anchors, command actors and transition prose do not cross the
 * browser boundary on the pre-technical surfaces: the BFF publishes a closed,
 * presentation-only run summary instead. Keep this separate from the durable
 * aggregate validator so a redacted browser projection can never be mistaken
 * for a persisted project snapshot. It returns the shared structural type only
 * because its redacted optional run fields remain TypeScript-compatible; code
 * that needs persisted V2 invariants must call isEngineeringProjectSnapshot.
 */
export function isEngineeringPublicPretechnicalProjectSnapshot(
  value: unknown,
): value is EngineeringProjectSnapshot {
  return isRecord(value) && value.commandReceipts === undefined &&
    isEngineeringProjectSnapshotShape(
      value,
      (item) => isPublicPretechnicalAgentRun(item),
    );
}

function isEngineeringProjectSnapshotShape(
  value: unknown,
  isValidAgentRun: (
    item: Record<string, unknown>,
    schemaVersion: EngineeringProjectSchemaVersion,
    project: Record<string, unknown>,
  ) => boolean,
): boolean {
  if (!isRecord(value)) return false;
  const schemaVersion = value.schemaVersion;
  if (
    !isEngineeringProjectSchemaVersion(schemaVersion) ||
    typeof value.id !== "string" ||
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
    isThreadSnapshotRef,
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
        Array.isArray(item.evidenceRefs) &&
        isValidAgentRun(item, schemaVersion, value),
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
    hasValidProjectProvenance(value, schemaVersion);
}

function isEngineeringProjectSchemaVersion(
  value: unknown,
): value is EngineeringProjectSchemaVersion {
  return value === "1.0" || value === "2.0" || value === "3.0";
}

/**
 * V2 starts from one human-approved discovery handoff. A plan, when present,
 * must retain that exact basis; it is never inferred from a V1 snapshot.
 */
function hasValidProjectProvenance(
  project: Record<string, unknown>,
  schemaVersion: EngineeringProjectSchemaVersion,
): boolean {
  const handoff = project.discoveryHandoff;
  const plan = project.plan;
  if (handoff !== undefined && !isDiscoveryHandoff(handoff)) return false;
  if (schemaVersion === "2.0" && !isDiscoveryHandoff(handoff)) return false;
  if (schemaVersion === "3.0") {
    if (handoff !== undefined || !isProjectFraming(project.framing, project)) {
      return false;
    }
    if (plan === undefined) return true;
    return isEngineeringProjectPlan(plan) &&
      isApprovedBriefBasis(plan.basis) &&
      briefBasisMatchesFraming(plan.basis, project);
  }

  if (plan === undefined) return true;
  if (!isEngineeringProjectPlan(plan)) return false;
  if (!isApprovedDiscoveryBasis(plan.basis)) return false;
  if (!isDiscoveryHandoff(handoff)) {
    return false;
  }
  return sameApprovedDiscoveryBasis(plan.basis, handoff);
}

function isDiscoveryHandoff(
  value: unknown,
): value is EngineeringProjectDiscoveryHandoff {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "discoveryId",
      "snapshotId",
      "revision",
      "briefId",
      "approvedBriefFingerprint",
      "approvedAt",
      "approvedBy",
    ])
  ) {
    return false;
  }
  return isNonEmptyString(value.discoveryId) &&
    isNonEmptyString(value.snapshotId) &&
    isPositiveInteger(value.revision) &&
    isNonEmptyString(value.briefId) &&
    isSha256Fingerprint(value.approvedBriefFingerprint) &&
    isIsoDateTime(value.approvedAt) &&
    isHumanCommandActor(value.approvedBy);
}

function isHumanCommandActor(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["id", "origin"]) &&
    isNonEmptyString(value.id) && value.origin === "human";
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

function isEngineeringProjectPlan(
  value: unknown,
): value is EngineeringProjectPlan {
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
    (isApprovedDiscoveryBasis(value.basis) ||
      isApprovedBriefBasis(value.basis)) &&
    isIsoDateTime(value.publishedAt) &&
    isPlanPublisher(value.publishedBy);
}

function isApprovedBriefBasis(
  value: unknown,
): value is EngineeringApprovedBriefBasis {
  if (
    !isRecord(value) || !hasExactKeys(value, [
      "kind",
      "projectId",
      "projectSnapshotId",
      "projectRevision",
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "approvedBriefFingerprint",
    ])
  ) return false;
  return value.kind === "approved-brief" &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.projectSnapshotId) &&
    isPositiveInteger(value.projectRevision) &&
    isNonEmptyString(value.briefId) &&
    isNonEmptyString(value.briefSnapshotId) &&
    isPositiveInteger(value.briefRevision) &&
    isSha256Fingerprint(value.approvedBriefFingerprint);
}

function briefBasisMatchesFraming(
  basis: EngineeringApprovedBriefBasis,
  project: Record<string, unknown>,
): boolean {
  if (!isRecord(project.project) || !isRecord(project.framing)) return false;
  const brief = project.framing.currentBrief;
  const approval = project.framing.currentBriefApproval;
  if (
    !isRecord(brief) || !isRecord(approval) ||
    !isSha256Fingerprint(approval.inputFingerprint)
  ) return false;
  const fingerprint = approval.inputFingerprint as {
    algorithm: "sha256";
    digest: string;
  };
  return basis.projectId === project.project.id &&
    basis.briefId === brief.briefId && basis.briefSnapshotId === brief.id &&
    basis.briefRevision === brief.revision &&
    basis.approvedBriefFingerprint.algorithm ===
      fingerprint.algorithm &&
    basis.approvedBriefFingerprint.digest === fingerprint.digest;
}

function isProjectFraming(
  value: unknown,
  project: Record<string, unknown>,
): boolean {
  if (!isRecord(value) || !isRecord(value.intent)) return false;
  const intent = value.intent;
  if (
    !isNonEmptyString(intent.statement) || !isRecord(intent.source) ||
    (intent.source.kind !== "human" && intent.source.kind !== "document") ||
    !isNonEmptyString(intent.source.reference) ||
    !isIsoDateTime(intent.capturedAt) || !isCommandActor(intent.capturedBy) ||
    !Array.isArray(value.questions) || !Array.isArray(value.answers)
  ) return false;
  if (
    !value.questions.every(isProjectQuestion) ||
    !value.answers.every(isProjectAnswer)
  ) {
    return false;
  }
  const current = value.currentBrief;
  const approval = value.currentBriefApproval;
  const proposed = value.proposedBrief;
  const proposalReview = value.proposalReview;
  if ((current === undefined) !== (approval === undefined)) return false;
  if ((proposed === undefined) !== (proposalReview === undefined)) return false;
  if (current !== undefined && !isProjectBrief(current, project)) return false;
  if (
    approval !== undefined &&
    (!isProjectBriefReview(approval, "approved") ||
      !sameBriefReview(current, approval))
  ) return false;
  if (proposed !== undefined && !isProjectBrief(proposed, project)) {
    return false;
  }
  if (
    proposalReview !== undefined &&
    (!isProjectBriefReview(proposalReview, "proposal") ||
      !sameBriefReview(proposed, proposalReview))
  ) return false;
  return true;
}

function isProjectQuestion(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) &&
    isNonEmptyString(value.prompt) && isNonEmptyString(value.whyItMatters) &&
    isRecord(value.recommendation) &&
    isNonEmptyString(value.recommendation.value) &&
    isNonEmptyString(value.recommendation.rationale) &&
    ["low", "medium", "high"].includes(
      String(value.recommendation.confidence),
    ) &&
    Array.isArray(value.options) && value.options.length > 0 &&
    value.options.every((option) =>
      isRecord(option) && isNonEmptyString(option.value) &&
      isNonEmptyString(option.label) && isNonEmptyString(option.consequences)
    ) && typeof value.allowUnknown === "boolean" &&
    ["reversible", "material", "safety-critical", "regulatory"].includes(
      String(value.risk),
    ) && isStringArray(value.evidenceNeeded) &&
    isIsoDateTime(value.proposedAt) && isCommandActor(value.proposedBy);
}

function isProjectAnswer(value: unknown): boolean {
  if (
    !isRecord(value) || !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.questionId) ||
    (value.kind !== "provided" && value.kind !== "unknown") ||
    !isRecord(value.source) ||
    !["human", "tool", "document", "expert"].includes(
      String(value.source.kind),
    ) ||
    !isNonEmptyString(value.source.reference) ||
    !isIsoDateTime(value.recordedAt) || !isCommandActor(value.recordedBy)
  ) return false;
  return value.kind === "provided"
    ? isNonEmptyString(value.value)
    : value.value === undefined;
}

function isProjectBrief(
  value: unknown,
  project: Record<string, unknown>,
): boolean {
  if (!isRecord(value) || !isRecord(project.project)) return false;
  return value.briefId === `${project.project.id}:brief` &&
    isNonEmptyString(value.id) && isPositiveInteger(value.revision) &&
    Array.isArray(value.items) && value.items.length > 0 &&
    value.items.every((item) =>
      isRecord(item) && isNonEmptyString(item.id) &&
      isNonEmptyString(item.kind) && isNonEmptyString(item.statement) &&
      Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0
    ) && isIsoDateTime(value.proposedAt) && isCommandActor(value.proposedBy);
}

function isProjectBriefReview(
  value: unknown,
  expected: "approved" | "proposal",
): boolean {
  if (
    !isRecord(value) || !isNonEmptyString(value.briefSnapshotId) ||
    !isPositiveInteger(value.briefRevision) ||
    !isSha256Fingerprint(value.inputFingerprint) ||
    !isIsoDateTime(value.requestedAt)
  ) return false;
  if (expected === "approved") {
    const actor = value.decidedBy;
    return value.status === "approved" && isIsoDateTime(value.decidedAt) &&
      isCommandActor(actor) && actor.origin === "human" &&
      isNonEmptyString(value.rationale);
  }
  if (value.status === "pending") {
    return value.decidedAt === undefined && value.decidedBy === undefined;
  }
  const actor = value.decidedBy;
  return value.status === "rejected" && isIsoDateTime(value.decidedAt) &&
    isCommandActor(actor) && actor.origin === "human" &&
    isNonEmptyString(value.rationale);
}

function sameBriefReview(brief: unknown, review: unknown): boolean {
  return isRecord(brief) && isRecord(review) &&
    brief.id === review.briefSnapshotId &&
    brief.revision === review.briefRevision;
}

function isApprovedDiscoveryBasis(
  value: unknown,
): value is EngineeringApprovedDiscoveryBasis {
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

function sameApprovedDiscoveryBasis(
  left: EngineeringApprovedDiscoveryBasis,
  right: Pick<
    EngineeringApprovedDiscoveryBasis,
    | "discoveryId"
    | "snapshotId"
    | "revision"
    | "briefId"
    | "approvedBriefFingerprint"
  >,
): boolean {
  return left.discoveryId === right.discoveryId &&
    left.snapshotId === right.snapshotId &&
    left.revision === right.revision && left.briefId === right.briefId &&
    left.approvedBriefFingerprint.algorithm ===
      right.approvedBriefFingerprint.algorithm &&
    left.approvedBriefFingerprint.digest ===
      right.approvedBriefFingerprint.digest;
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
    case "approved-brief":
      return hasExactKeys(value, ["kind"]);
    case "project-answer":
      return hasExactKeys(value, ["kind", "answerId"]) &&
        isNonEmptyString(value.answerId);
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

/**
 * The pre-technical BFF exposes only these run fields. In particular, this
 * rejects execution anchors, fingerprints, command actors, result snapshots,
 * decision ids and status history rather than merely ignoring them.
 */
function isPublicPretechnicalAgentRun(value: Record<string, unknown>): boolean {
  if (
    !hasAllowedKeys(value, [
      "id",
      "workItemId",
      "status",
      "summary",
      "queuedAt",
      "startedAt",
      "completedAt",
      "evidenceRefs",
      "failure",
    ])
  ) {
    return false;
  }
  return typeof value.id === "string" && typeof value.workItemId === "string" &&
    AGENT_RUN_STATUSES.includes(value.status as EngineeringAgentRunStatus) &&
    typeof value.summary === "string" && isIsoDateTime(value.queuedAt) &&
    (value.startedAt === undefined || isIsoDateTime(value.startedAt)) &&
    (value.completedAt === undefined || isIsoDateTime(value.completedAt)) &&
    // Before evidence exists, an execution run cannot carry an entity
    // reference into the browser. The documentary record itself is projected
    // separately with its explicit, bounded provenance fields.
    Array.isArray(value.evidenceRefs) && value.evidenceRefs.length === 0 &&
    (value.failure === undefined || isAgentRunFailure(value.failure));
}

function isAgentRunFailure(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["code", "message"]) &&
    typeof value.code === "string" && typeof value.message === "string";
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
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

/** Decisions and approvals keep their exact technical snapshot anchor in both schemas. */
function hasValidInputAnchor(value: Record<string, unknown>): boolean {
  const hasBase = value.baseSnapshot !== undefined;
  const hasFingerprint = value.inputFingerprint !== undefined;
  if (hasBase !== hasFingerprint) return false;
  if (!hasBase) return true;
  return isThreadSnapshotRef(value.baseSnapshot) &&
    isSha256Fingerprint(value.inputFingerprint);
}

/**
 * Agent-run execution bindings are schema-discriminated: V1 retains the
 * historic baseSnapshot pair, while V2 must name a typed basis instead.
 */
function hasValidAgentRunInputAnchor(
  value: Record<string, unknown>,
  schemaVersion: EngineeringProjectSchemaVersion,
  project: Record<string, unknown>,
): boolean {
  if (schemaVersion === "1.0") {
    return value.basis === undefined && hasValidInputAnchor(value);
  }

  if (
    value.baseSnapshot !== undefined || value.basis === undefined ||
    value.inputFingerprint === undefined ||
    !isEngineeringBasis(value.basis) ||
    !isSha256Fingerprint(value.inputFingerprint)
  ) {
    return false;
  }

  if (value.basis.kind === "approved-discovery") {
    const plan = project.plan;
    return plan !== undefined && isEngineeringProjectPlan(plan) &&
      isApprovedDiscoveryBasis(plan.basis) &&
      sameApprovedDiscoveryBasis(value.basis, plan.basis);
  }

  if (value.basis.kind === "approved-brief") {
    const plan = project.plan;
    return plan !== undefined && isEngineeringProjectPlan(plan) &&
      isApprovedBriefBasis(plan.basis) &&
      value.basis.projectSnapshotId === plan.basis.projectSnapshotId &&
      value.basis.briefSnapshotId === plan.basis.briefSnapshotId &&
      value.basis.approvedBriefFingerprint.digest ===
        plan.basis.approvedBriefFingerprint.digest;
  }

  return isDeclaredProjectThreadSnapshot(value.basis, project);
}

function isEngineeringBasis(value: unknown): value is EngineeringBasisRef {
  return isApprovedBriefBasis(value) || isApprovedDiscoveryBasis(value) ||
    isThreadSnapshotBasis(value);
}

function isThreadSnapshotBasis(
  value: unknown,
): value is Extract<EngineeringBasisRef, { readonly kind: "thread-snapshot" }> {
  return isRecord(value) && hasExactKeys(value, [
    "kind",
    "snapshotId",
    "revision",
    "subjectId",
  ]) && value.kind === "thread-snapshot" &&
    isNonEmptyString(value.snapshotId) && isPositiveInteger(value.revision) &&
    isNonEmptyString(value.subjectId);
}

function isDeclaredProjectThreadSnapshot(
  basis: Extract<EngineeringBasisRef, { readonly kind: "thread-snapshot" }>,
  project: Record<string, unknown>,
): boolean {
  if (!isThreadSnapshotRef(basis) || !Array.isArray(project.threadSnapshots)) {
    return false;
  }
  return project.threadSnapshots.some((snapshot) =>
    isThreadSnapshotRef(snapshot) && snapshot.snapshotId === basis.snapshotId &&
    snapshot.revision === basis.revision &&
    snapshot.subjectId === basis.subjectId
  );
}

function isThreadSnapshotRef(
  value: unknown,
): value is EngineeringThreadSnapshotRef {
  return isRecord(value) && hasExactKeys(value, [
    "snapshotId",
    "revision",
    "subjectId",
  ]) && isNonEmptyString(value.snapshotId) &&
    isPositiveInteger(value.revision) && isNonEmptyString(value.subjectId);
}

function isCommandActor(
  value: unknown,
): value is { id: string; origin: "human" | "agent" } {
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
