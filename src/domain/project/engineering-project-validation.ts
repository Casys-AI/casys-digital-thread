import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringApprovedBriefBasis,
  EngineeringBlocker,
  EngineeringCancelledRunReceiptBinding,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectPhase,
  EngineeringProjectSchemaVersion,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "./engineering-project.ts";
import { queuedRunCancellationSummary } from "./engineering-project.ts";
import {
  sameResolvedOperationPlanRef,
  validateResolvedOperationPlanRef,
} from "../compile/rop/resolved-operation-plan-v2.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import {
  currentProjectAnswer,
  type EngineeringProjectFraming,
  isProjectBriefGateKind,
  projectBriefContractVersion,
  projectBriefObjective,
  type ProjectBriefRevision,
} from "./project-brief.ts";
import type { ContentFingerprint, ThreadSnapshot } from "../thread/thread-snapshot.ts";

export interface EngineeringProjectValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  /** Structured details for a domain-specific recovery, when one is available. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
  readonly recovery?: string;
}

export class EngineeringProjectValidationError extends Error {
  readonly issues: readonly EngineeringProjectValidationIssue[];

  constructor(issues: readonly EngineeringProjectValidationIssue[]) {
    super(
      `Invalid EngineeringProjectSnapshot: ${
        issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
      }`,
    );
    this.name = "EngineeringProjectValidationError";
    this.issues = issues;
  }
}

/**
 * Validate untrusted project JSON, clone it and recursively freeze the result.
 * No missing project intent, decision or engineering input is inferred.
 */
export function validateEngineeringProjectSnapshot(
  value: unknown,
): EngineeringProjectSnapshot {
  const issues = collectEngineeringProjectIssues(value);
  if (issues.length > 0) throw new EngineeringProjectValidationError(issues);
  return deepFreeze(structuredClone(value)) as EngineeringProjectSnapshot;
}

export const createEngineeringProjectSnapshot = validateEngineeringProjectSnapshot;

/** Return every structural and project-graph issue without mutating input. */
export function collectEngineeringProjectIssues(
  value: unknown,
): EngineeringProjectValidationIssue[] {
  const issues: EngineeringProjectValidationIssue[] = [];
  validateJson(value, "$", issues, new Set());
  const root = exactRecord(
    value,
    "$",
    [
      "schemaVersion",
      "id",
      "revision",
      "generatedAt",
      "project",
      "threadSnapshots",
      "phases",
      "workItems",
      "agentRuns",
      "decisions",
      "approvals",
      "blockers",
    ],
    [
      "previous",
      "commandReceipts",
      "framing",
      "plan",
      "planChanges",
    ],
    issues,
  );
  if (!root) return issues;

  const schemaVersion = engineeringProjectSchemaVersion(
    root.schemaVersion,
    "$.schemaVersion",
    issues,
  );
  nonEmptyString(root.id, "$.id", issues);
  positiveInteger(root.revision, "$.revision", issues);
  isoDateTime(root.generatedAt, "$.generatedAt", issues);
  if (root.previous !== undefined) {
    validatePrevious(root.previous, "$.previous", issues);
  }
  validateProjectIdentity(root.project, "$.project", issues);
  if (root.framing !== undefined) {
    validateProjectFraming(root.framing, "$.framing", issues);
  }
  if (root.plan !== undefined) {
    validateProjectPlan(root.plan, "$.plan", issues, schemaVersion);
  }
  if (root.planChanges !== undefined) {
    validateArray(root.planChanges, "$.planChanges", issues, validateProjectChange);
  }
  validateArray(root.threadSnapshots, "$.threadSnapshots", issues, validateSnapshotRef);
  validateArray(root.phases, "$.phases", issues, validatePhase);
  validateArray(root.workItems, "$.workItems", issues, validateWorkItem);
  validateArray(
    root.agentRuns,
    "$.agentRuns",
    issues,
    (item, path) => validateAgentRun(item, path, issues, schemaVersion),
  );
  validateArray(root.decisions, "$.decisions", issues, validateDecision);
  validateArray(root.approvals, "$.approvals", issues, validateApproval);
  validateArray(root.blockers, "$.blockers", issues, validateBlocker);
  if (root.commandReceipts !== undefined) {
    validateArray(
      root.commandReceipts,
      "$.commandReceipts",
      issues,
      validateCommandReceipt,
    );
  }

  if (issues.length === 0) {
    validateInvariants(value as EngineeringProjectSnapshot, issues);
  }
  return issues;
}

/**
 * Validate every project evidence link against the supplied exact snapshots.
 * This intentionally has no "latest snapshot" semantics.
 */
export function validateEngineeringProjectThreadReferences(
  project: EngineeringProjectSnapshot,
  snapshots: readonly ThreadSnapshot[],
): EngineeringProjectSnapshot {
  const validated = validateEngineeringProjectSnapshot(project);
  const issues = collectEngineeringProjectThreadReferenceIssues(validated, snapshots);
  if (issues.length > 0) throw new EngineeringProjectValidationError(issues);
  return validated;
}

export function collectEngineeringProjectThreadReferenceIssues(
  project: EngineeringProjectSnapshot,
  snapshots: readonly ThreadSnapshot[],
): EngineeringProjectValidationIssue[] {
  const structuralIssues = collectEngineeringProjectIssues(project);
  if (structuralIssues.length > 0) return structuralIssues;

  const issues: EngineeringProjectValidationIssue[] = [];
  const snapshotsByKey = new Map(
    snapshots.map((
      snapshot,
    ) => [snapshotKey(snapshot.id, snapshot.revision), snapshot]),
  );

  project.threadSnapshots.forEach((reference, index) => {
    const path = `$.threadSnapshots[${index}]`;
    const snapshot = snapshotsByKey.get(
      snapshotKey(reference.snapshotId, reference.revision),
    );
    if (!snapshot) {
      issue(
        issues,
        "missing_thread_snapshot",
        path,
        "does not resolve to a supplied exact ThreadSnapshot revision",
      );
      return;
    }
    if (snapshot.subject.id !== reference.subjectId) {
      issue(
        issues,
        "thread_subject_mismatch",
        `${path}.subjectId`,
        `does not match ThreadSnapshot subject ${snapshot.subject.id}`,
      );
    }
  });

  allEvidenceRefs(project).forEach(({ reference, path }) => {
    const snapshot = snapshotsByKey.get(
      snapshotKey(reference.snapshotId, reference.snapshotRevision),
    );
    if (!snapshot) return;
    if (!threadEntityExists(snapshot, reference)) {
      issue(
        issues,
        "missing_thread_entity",
        path,
        `does not resolve to a ${reference.kind} in the exact ThreadSnapshot revision`,
      );
    }
  });
  return issues;
}

function validatePrevious(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(value, path, ["snapshotId", "revision"], [], issues);
  if (!input) return;
  nonEmptyString(input.snapshotId, `${path}.snapshotId`, issues);
  positiveInteger(input.revision, `${path}.revision`, issues);
}

function engineeringProjectSchemaVersion(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): EngineeringProjectSchemaVersion | undefined {
  if (value === "1.0" || value === "3.0") return value;
  issue(issues, "invalid_enum", path, "must be 1.0 or 3.0");
  return undefined;
}

function validateProjectIdentity(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "name", "subjectId", "objective"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  nonEmptyString(input.subjectId, `${path}.subjectId`, issues);
  const objective = exactRecord(
    input.objective,
    `${path}.objective`,
    ["title", "statement"],
    [],
    issues,
  );
  if (!objective) return;
  nonEmptyString(objective.title, `${path}.objective.title`, issues);
  nonEmptyString(objective.statement, `${path}.objective.statement`, issues);
}

function validateProjectFraming(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["intent", "questions", "answers"],
    [
      "currentBrief",
      "currentBriefApproval",
      "proposedBrief",
      "proposalReview",
    ],
    issues,
  );
  if (!input) return;
  validateProjectIntent(input.intent, `${path}.intent`, issues);
  validateArray(input.questions, `${path}.questions`, issues, validateProjectQuestion);
  validateArray(input.answers, `${path}.answers`, issues, validateProjectAnswer);
  if (input.currentBrief !== undefined) {
    validateProjectBriefRevision(
      input.currentBrief,
      `${path}.currentBrief`,
      issues,
    );
  }
  if (input.proposedBrief !== undefined) {
    validateProjectBriefRevision(
      input.proposedBrief,
      `${path}.proposedBrief`,
      issues,
    );
  }
  if (input.currentBriefApproval !== undefined) {
    validateProjectBriefReview(
      input.currentBriefApproval,
      `${path}.currentBriefApproval`,
      issues,
    );
  }
  if (input.proposalReview !== undefined) {
    validateProjectBriefReview(
      input.proposalReview,
      `${path}.proposalReview`,
      issues,
    );
  }
}

function validateProjectIntent(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["statement", "source", "capturedAt", "capturedBy"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.statement, `${path}.statement`, issues);
  const source = exactRecord(
    input.source,
    `${path}.source`,
    ["kind", "reference"],
    [],
    issues,
  );
  if (source) {
    oneOf(source.kind, ["human", "document"], `${path}.source.kind`, issues);
    nonEmptyString(source.reference, `${path}.source.reference`, issues);
  }
  isoDateTime(input.capturedAt, `${path}.capturedAt`, issues);
  validateCommandActor(input.capturedBy, `${path}.capturedBy`, issues);
}

function validateProjectQuestion(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "prompt",
      "whyItMatters",
      "recommendation",
      "options",
      "allowUnknown",
      "risk",
      "evidenceNeeded",
      "proposedAt",
      "proposedBy",
    ],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.prompt, `${path}.prompt`, issues);
  nonEmptyString(input.whyItMatters, `${path}.whyItMatters`, issues);
  const recommendation = exactRecord(
    input.recommendation,
    `${path}.recommendation`,
    ["value", "rationale", "confidence"],
    [],
    issues,
  );
  if (recommendation) {
    nonEmptyString(recommendation.value, `${path}.recommendation.value`, issues);
    nonEmptyString(
      recommendation.rationale,
      `${path}.recommendation.rationale`,
      issues,
    );
    oneOf(
      recommendation.confidence,
      ["low", "medium", "high"],
      `${path}.recommendation.confidence`,
      issues,
    );
  }
  validateArray(
    input.options,
    `${path}.options`,
    issues,
    (option, optionPath, optionIssues) => {
      const record = exactRecord(
        option,
        optionPath,
        ["value", "label", "consequences"],
        [],
        optionIssues,
      );
      if (!record) return;
      nonEmptyString(record.value, `${optionPath}.value`, optionIssues);
      nonEmptyString(record.label, `${optionPath}.label`, optionIssues);
      nonEmptyString(
        record.consequences,
        `${optionPath}.consequences`,
        optionIssues,
      );
    },
  );
  if (typeof input.allowUnknown !== "boolean") {
    issue(
      issues,
      "invalid_type",
      `${path}.allowUnknown`,
      "must be a boolean",
    );
  }
  oneOf(
    input.risk,
    ["reversible", "material", "safety-critical", "regulatory"],
    `${path}.risk`,
    issues,
  );
  stringArray(input.evidenceNeeded, `${path}.evidenceNeeded`, issues);
  isoDateTime(input.proposedAt, `${path}.proposedAt`, issues);
  validateCommandActor(input.proposedBy, `${path}.proposedBy`, issues);
}

function validateProjectAnswer(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "questionId", "kind", "source", "recordedAt", "recordedBy"],
    ["value", "explanation", "supersedesAnswerId"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.questionId, `${path}.questionId`, issues);
  oneOf(input.kind, ["provided", "unknown"], `${path}.kind`, issues);
  if (input.kind === "provided") {
    nonEmptyString(input.value, `${path}.value`, issues);
  } else if (input.value !== undefined) {
    issue(
      issues,
      "unknown_has_value",
      `${path}.value`,
      "must be absent for an unknown answer",
    );
  }
  optionalNonEmptyString(input.explanation, `${path}.explanation`, issues);
  optionalNonEmptyString(
    input.supersedesAnswerId,
    `${path}.supersedesAnswerId`,
    issues,
  );
  const source = exactRecord(
    input.source,
    `${path}.source`,
    ["kind", "reference"],
    [],
    issues,
  );
  if (source) {
    oneOf(
      source.kind,
      ["human", "tool", "document", "expert"],
      `${path}.source.kind`,
      issues,
    );
    nonEmptyString(source.reference, `${path}.source.reference`, issues);
  }
  isoDateTime(input.recordedAt, `${path}.recordedAt`, issues);
  validateCommandActor(input.recordedBy, `${path}.recordedBy`, issues);
}

function validateProjectBriefRevision(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "briefId",
      "id",
      "revision",
      "items",
      "proposedAt",
      "proposedBy",
    ],
    ["contractVersion", "previous"],
    issues,
  );
  if (!input) return;
  const contractVersion = readProjectBriefContractVersion(
    input.contractVersion,
    `${path}.contractVersion`,
    issues,
  );
  nonEmptyString(input.briefId, `${path}.briefId`, issues);
  nonEmptyString(input.id, `${path}.id`, issues);
  positiveInteger(input.revision, `${path}.revision`, issues);
  if (input.previous !== undefined) {
    validatePrevious(input.previous, `${path}.previous`, issues);
  }
  validateArray(
    input.items,
    `${path}.items`,
    issues,
    (item, itemPath, itemIssues) =>
      validateProjectBriefItem(item, itemPath, itemIssues, contractVersion),
  );
  isoDateTime(input.proposedAt, `${path}.proposedAt`, issues);
  validateCommandActor(input.proposedBy, `${path}.proposedBy`, issues);
}

function readProjectBriefContractVersion(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): "1.0" | "2.0" {
  // Historical brief bytes never carried a version field. They are V1 by
  // representation, not silently rewritten with a synthetic stored property.
  if (value === undefined) return "1.0";
  if (value === "1.0" || value === "2.0") return value;
  issueWithRecovery(
    issues,
    "invalid_brief_contract_version",
    path,
    "must be 1.0 or 2.0",
    { value: typeof value === "string" ? value : typeof value },
    "Use 2.0 for a newly proposed brief; leave the field absent only for an immutable V1 record.",
  );
  return "1.0";
}

function validateProjectBriefItem(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  contractVersion: "1.0" | "2.0",
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "kind", "statement", "sourceRefs"],
    contractVersion === "2.0"
      ? ["owner", "reviewTrigger", "dependsOnItemIds"]
      : ["owner", "reviewTrigger"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  oneOf(
    input.kind,
    [
      "objective",
      "primary-user",
      "mission-scenario",
      "operating-environment",
      "success-criterion",
      "constraint",
      "exclusion",
      "intended-market",
      "manufacturing-jurisdiction",
      "operating-jurisdiction",
      "compliance-target",
      "verification-activity",
      "manufacturing-evidence",
      "observed-fact",
      "assumption",
      "open-question",
      "proposed-decision",
    ],
    `${path}.kind`,
    issues,
  );
  nonEmptyString(input.statement, `${path}.statement`, issues);
  validateArray(
    input.sourceRefs,
    `${path}.sourceRefs`,
    issues,
    (source, sourcePath, sourceIssues) => {
      const record = exactRecord(
        source,
        sourcePath,
        ["kind", "reference"],
        [],
        sourceIssues,
      );
      if (!record) return;
      oneOf(
        record.kind,
        ["intent", "answer", "tool", "document", "expert"],
        `${sourcePath}.kind`,
        sourceIssues,
      );
      nonEmptyString(record.reference, `${sourcePath}.reference`, sourceIssues);
    },
  );
  optionalNonEmptyString(input.owner, `${path}.owner`, issues);
  optionalNonEmptyString(input.reviewTrigger, `${path}.reviewTrigger`, issues);
  if (contractVersion !== "2.0") return;

  const isGate = input.kind === "success-criterion" ||
    input.kind === "verification-activity";
  const hasDependencyDeclaration = Object.prototype.hasOwnProperty.call(
    input,
    "dependsOnItemIds",
  );
  if (isGate && !hasDependencyDeclaration) {
    issueWithRecovery(
      issues,
      "missing_gate_dependency_declaration",
      `${path}.dependsOnItemIds`,
      "a V2 gate must explicitly declare its brief-item dependencies",
      {
        contractVersion,
        gateItemId: typeof input.id === "string" ? input.id : "",
      },
      "Declare dependsOnItemIds explicitly; use [] only when the gate is intentionally independent of other brief items.",
    );
    return;
  }
  if (isGate) {
    stringArray(input.dependsOnItemIds, `${path}.dependsOnItemIds`, issues);
    return;
  }
  if (hasDependencyDeclaration) {
    issueWithRecovery(
      issues,
      "invalid_gate_dependency_declaration",
      `${path}.dependsOnItemIds`,
      "only success-criterion and verification-activity items may declare gate dependencies",
      {
        contractVersion,
        itemKind: typeof input.kind === "string" ? input.kind : "",
      },
      "Move dependsOnItemIds to the gate that depends on this normative item.",
    );
  }
}

function validateProjectBriefReview(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "briefSnapshotId",
      "briefRevision",
      "status",
      "inputFingerprint",
      "requestedAt",
    ],
    ["decidedAt", "decidedBy", "rationale"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.briefSnapshotId, `${path}.briefSnapshotId`, issues);
  positiveInteger(input.briefRevision, `${path}.briefRevision`, issues);
  oneOf(input.status, ["pending", "approved", "rejected"], `${path}.status`, issues);
  validateFingerprint(input.inputFingerprint, `${path}.inputFingerprint`, issues);
  isoDateTime(input.requestedAt, `${path}.requestedAt`, issues);
  optionalIsoDateTime(input.decidedAt, `${path}.decidedAt`, issues);
  if (input.decidedBy !== undefined) {
    validateCommandActor(input.decidedBy, `${path}.decidedBy`, issues);
  }
  optionalNonEmptyString(input.rationale, `${path}.rationale`, issues);
}

function validateProjectPlan(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  schemaVersion: EngineeringProjectSchemaVersion | undefined,
): void {
  const input = exactRecord(
    value,
    path,
    ["startingPoint", "basis", "publishedAt", "publishedBy"],
    [],
    issues,
  );
  if (!input) return;
  oneOf(
    input.startingPoint,
    ["idea-or-spec", "existing-cad", "existing-product"],
    `${path}.startingPoint`,
    issues,
  );
  if (schemaVersion === "3.0") {
    validateApprovedBriefBasis(input.basis, `${path}.basis`, issues);
  }
  isoDateTime(input.publishedAt, `${path}.publishedAt`, issues);
  validateCommandActor(input.publishedBy, `${path}.publishedBy`, issues);
}

function validateApprovedBriefBasis(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "kind",
      "projectId",
      "projectSnapshotId",
      "projectRevision",
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "approvedBriefFingerprint",
    ],
    [],
    issues,
  );
  if (!input) return;
  literal(input.kind, "approved-brief", `${path}.kind`, issues);
  nonEmptyString(input.projectId, `${path}.projectId`, issues);
  nonEmptyString(input.projectSnapshotId, `${path}.projectSnapshotId`, issues);
  positiveInteger(input.projectRevision, `${path}.projectRevision`, issues);
  nonEmptyString(input.briefId, `${path}.briefId`, issues);
  nonEmptyString(input.briefSnapshotId, `${path}.briefSnapshotId`, issues);
  positiveInteger(input.briefRevision, `${path}.briefRevision`, issues);
  validateFingerprint(
    input.approvedBriefFingerprint,
    `${path}.approvedBriefFingerprint`,
    issues,
  );
}

function validateProjectChange(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "commandId",
      "baseSnapshot",
      "phaseIds",
      "workItemIds",
      "decisionIds",
      "publishedAt",
      "publishedBy",
    ],
    ["approvedBriefBasis"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.commandId, `${path}.commandId`, issues);
  if (input.approvedBriefBasis !== undefined) {
    validateApprovedBriefBasis(
      input.approvedBriefBasis,
      `${path}.approvedBriefBasis`,
      issues,
    );
  }
  validateSnapshotRef(input.baseSnapshot, `${path}.baseSnapshot`, issues);
  validateArray(
    input.phaseIds,
    `${path}.phaseIds`,
    issues,
    (item, itemPath) => nonEmptyString(item, itemPath, issues),
  );
  validateArray(
    input.workItemIds,
    `${path}.workItemIds`,
    issues,
    (item, itemPath) => nonEmptyString(item, itemPath, issues),
  );
  validateArray(
    input.decisionIds,
    `${path}.decisionIds`,
    issues,
    (item, itemPath) => nonEmptyString(item, itemPath, issues),
  );
  isoDateTime(input.publishedAt, `${path}.publishedAt`, issues);
  validateCommandActor(input.publishedBy, `${path}.publishedBy`, issues);
}

function validateSnapshotRef(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["snapshotId", "revision", "subjectId"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.snapshotId, `${path}.snapshotId`, issues);
  positiveInteger(input.revision, `${path}.revision`, issues);
  nonEmptyString(input.subjectId, `${path}.subjectId`, issues);
}

function validateEvidenceRef(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["snapshotId", "snapshotRevision", "kind", "id"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.snapshotId, `${path}.snapshotId`, issues);
  positiveInteger(input.snapshotRevision, `${path}.snapshotRevision`, issues);
  oneOf(
    input.kind,
    [
      "artifact",
      "consumption",
      "observation",
      "requirement",
      "evaluation",
      "violation",
      "change",
      "action",
    ],
    `${path}.kind`,
    issues,
  );
  nonEmptyString(input.id, `${path}.id`, issues);
}

function validatePhase(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "name",
      "order",
      "description",
      "workItemIds",
      "requiredDecisionIds",
      "evidenceRefs",
    ],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  positiveInteger(input.order, `${path}.order`, issues);
  nonEmptyString(input.description, `${path}.description`, issues);
  stringArray(input.workItemIds, `${path}.workItemIds`, issues);
  stringArray(input.requiredDecisionIds, `${path}.requiredDecisionIds`, issues);
  validateArray(
    input.evidenceRefs,
    `${path}.evidenceRefs`,
    issues,
    validateEvidenceRef,
  );
}

function validateWorkItem(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "phaseId",
      "title",
      "description",
      "kind",
      "status",
      "owner",
      "dependsOnWorkItemIds",
      "evidenceRefs",
      "decisionIds",
      "blockerIds",
    ],
    ["operation", "gateClaims", "reconciliation"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.phaseId, `${path}.phaseId`, issues);
  nonEmptyString(input.title, `${path}.title`, issues);
  nonEmptyString(input.description, `${path}.description`, issues);
  oneOf(
    input.kind,
    ["define", "architect", "design", "simulate", "verify", "industrialize", "review"],
    `${path}.kind`,
    issues,
  );
  oneOf(
    input.status,
    [
      "planned",
      "ready",
      "in-progress",
      "waiting-for-decision",
      "completed",
      "cancelled",
      "abandoned",
    ],
    `${path}.status`,
    issues,
  );
  oneOf(input.owner, ["human", "agent", "shared"], `${path}.owner`, issues);
  if (input.operation !== undefined) {
    validateOperationRef(input.operation, `${path}.operation`, issues);
  }
  if (input.gateClaims !== undefined) {
    validateArray(
      input.gateClaims,
      `${path}.gateClaims`,
      issues,
      validateGateClaim,
    );
  }
  if (input.reconciliation !== undefined) {
    validateWorkItemReconciliation(
      input.reconciliation,
      `${path}.reconciliation`,
      issues,
    );
  }
  stringArray(input.dependsOnWorkItemIds, `${path}.dependsOnWorkItemIds`, issues);
  validateArray(
    input.evidenceRefs,
    `${path}.evidenceRefs`,
    issues,
    validateEvidenceRef,
  );
  stringArray(input.decisionIds, `${path}.decisionIds`, issues);
  stringArray(input.blockerIds, `${path}.blockerIds`, issues);
}

function validateGateClaim(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["gateItemId", "role", "status"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.gateItemId, `${path}.gateItemId`, issues);
  if (input.role !== "contributes-to" && input.role !== "satisfies") {
    issueWithRecovery(
      issues,
      "invalid_gate_claim_role",
      `${path}.role`,
      "must be contributes-to or satisfies",
      {
        value: typeof input.role === "string" ? input.role : typeof input.role,
      },
      "Declare whether this work item contributes to the gate or satisfies it.",
    );
  }
  if (
    input.status !== "current" && input.status !== "impact-unresolved" &&
    input.status !== "invalidated" && input.status !== "carried-forward"
  ) {
    issueWithRecovery(
      issues,
      "invalid_gate_claim_status",
      `${path}.status`,
      "must be current, impact-unresolved, invalidated or carried-forward",
      { value: typeof input.status === "string" ? input.status : typeof input.status },
      "Use the link status that reflects the reviewed gate claim; do not use artifact freshness here.",
    );
  }
}

function validateWorkItemReconciliation(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (typeof value !== "object" || value === null) {
    issue(issues, "invalid_type", path, "must be an object");
    return;
  }
  const input = exactRecord(
    value,
    path,
    [
      "kind",
      "reconciledAt",
      "reconciledBy",
      "failedRunId",
      "successorRunId",
      "successorRunSnapshot",
      "successorEvidenceRefs",
      "rationale",
    ],
    // successorSnapshot is absent for a direct reconciliation where the
    // successor run result is already the project thread head.
    ["successorSnapshot"],
    issues,
  );
  if (!input) return;
  oneOf(
    input.kind,
    ["superseded-by-successor"],
    `${path}.kind`,
    issues,
  );
  isoDateTime(input.reconciledAt, `${path}.reconciledAt`, issues);
  validateCommandActor(input.reconciledBy, `${path}.reconciledBy`, issues);
  nonEmptyString(input.failedRunId, `${path}.failedRunId`, issues);
  nonEmptyString(input.successorRunId, `${path}.successorRunId`, issues);
  validateSnapshotRef(
    input.successorRunSnapshot,
    `${path}.successorRunSnapshot`,
    issues,
  );
  if (input.successorSnapshot !== undefined) {
    validateSnapshotRef(
      input.successorSnapshot,
      `${path}.successorSnapshot`,
      issues,
    );
  }
  validateArray(
    input.successorEvidenceRefs,
    `${path}.successorEvidenceRefs`,
    issues,
    validateEvidenceRef,
  );
  nonEmptyString(input.rationale, `${path}.rationale`, issues);
}

function validateOperationRef(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(value, path, ["id", "version", "bindings"], [], issues);
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.version, `${path}.version`, issues);
  validateArray(
    input.bindings,
    `${path}.bindings`,
    issues,
    validateOperationBinding,
  );
  if (Array.isArray(input.bindings)) {
    // WHY (name + source) AND NOT name ALONE — a reviewed operation may declare
    // a variadic slot: the archive operation names N entities to retire, each
    // through a binding called `archiveTarget`. The registry is the authority on
    // that contract and admits repeats only for a declared `one-or-more`
    // cardinality, but this validator lives in the domain and cannot read the
    // registry. Enforcing name-uniqueness here therefore contradicted a contract
    // the registry accepts, and made every multi-target operation unqueueable.
    // The invariant that remains is the one this layer can honestly state: the
    // exact same binding may not be supplied twice.
    uniqueStrings(
      input.bindings.flatMap((binding) =>
        binding && typeof binding === "object" && !Array.isArray(binding) &&
          typeof (binding as Record<string, unknown>).name === "string"
          ? [deterministicJson(binding)]
          : []
      ),
      `${path}.bindings`,
      issues,
    );
  }
}

function validateOperationBinding(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(value, path, ["name", "source"], [], issues);
  if (!input) return;
  nonEmptyString(input.name, `${path}.name`, issues);
  const source = exactRecord(
    input.source,
    `${path}.source`,
    ["kind"],
    ["answerId", "decisionId", "key", "reference"],
    issues,
  );
  if (!source) return;
  switch (source.kind) {
    case "approved-brief":
      return;
    case "project-answer": {
      const withAnswer = exactRecord(
        input.source,
        `${path}.source`,
        ["kind", "answerId"],
        [],
        issues,
      );
      if (withAnswer) {
        nonEmptyString(withAnswer.answerId, `${path}.source.answerId`, issues);
      }
      return;
    }
    case "decision-parameter": {
      const withDecision = exactRecord(
        input.source,
        `${path}.source`,
        ["kind", "decisionId", "key"],
        [],
        issues,
      );
      if (withDecision) {
        nonEmptyString(withDecision.decisionId, `${path}.source.decisionId`, issues);
        nonEmptyString(withDecision.key, `${path}.source.key`, issues);
      }
      return;
    }
    case "thread-entity": {
      const withReference = exactRecord(
        input.source,
        `${path}.source`,
        ["kind", "reference"],
        [],
        issues,
      );
      if (withReference) {
        validateEvidenceRef(
          withReference.reference,
          `${path}.source.reference`,
          issues,
        );
      }
      return;
    }
    default:
      issue(
        issues,
        "invalid_enum",
        `${path}.source.kind`,
        "must be approved-brief, project-answer, decision-parameter or thread-entity",
      );
  }
}

function validateAgentRun(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  schemaVersion: EngineeringProjectSchemaVersion | undefined,
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "workItemId", "status", "summary", "queuedAt", "evidenceRefs"],
    [
      "startedAt",
      "completedAt",
      "claimedAt",
      "claimedBy",
      "basis",
      "baseSnapshot",
      "inputFingerprint",
      "resolvedOperationPlan",
      "waitingForDecisionIds",
      "resultSnapshot",
      "failure",
      "cancellation",
      "uncertainWriterReconciliation",
      "annotationOnly",
      "statusHistory",
    ],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.workItemId, `${path}.workItemId`, issues);
  oneOf(
    input.status,
    [
      "queued",
      "running",
      "waiting-for-decision",
      "publishing",
      "completed",
      "failed",
      "cancelled",
    ],
    `${path}.status`,
    issues,
  );
  nonEmptyString(input.summary, `${path}.summary`, issues);
  isoDateTime(input.queuedAt, `${path}.queuedAt`, issues);
  optionalIsoDateTime(input.startedAt, `${path}.startedAt`, issues);
  optionalIsoDateTime(input.completedAt, `${path}.completedAt`, issues);
  optionalIsoDateTime(input.claimedAt, `${path}.claimedAt`, issues);
  if (input.claimedBy !== undefined) {
    validateCommandActor(input.claimedBy, `${path}.claimedBy`, issues);
  }
  validateRunExecutionBinding(input, path, issues, schemaVersion);
  if (input.resolvedOperationPlan !== undefined) {
    validateResolvedPlanReference(
      input.resolvedOperationPlan,
      `${path}.resolvedOperationPlan`,
      issues,
    );
  }
  validateArray(
    input.evidenceRefs,
    `${path}.evidenceRefs`,
    issues,
    validateEvidenceRef,
  );
  if (input.waitingForDecisionIds !== undefined) {
    stringArray(
      input.waitingForDecisionIds,
      `${path}.waitingForDecisionIds`,
      issues,
    );
  }
  if (input.resultSnapshot !== undefined) {
    validateSnapshotRef(input.resultSnapshot, `${path}.resultSnapshot`, issues);
  }
  if (input.failure !== undefined) {
    const failure = exactRecord(
      input.failure,
      `${path}.failure`,
      ["code", "message"],
      [],
      issues,
    );
    if (failure) {
      nonEmptyString(failure.code, `${path}.failure.code`, issues);
      nonEmptyString(failure.message, `${path}.failure.message`, issues);
    }
  }
  if (input.cancellation !== undefined) {
    const cancellation = exactRecord(
      input.cancellation,
      `${path}.cancellation`,
      ["rationale", "cancelledAt", "cancelledBy"],
      [],
      issues,
    );
    if (cancellation) {
      nonEmptyString(cancellation.rationale, `${path}.cancellation.rationale`, issues);
      isoDateTime(cancellation.cancelledAt, `${path}.cancellation.cancelledAt`, issues);
      validateCommandActor(
        cancellation.cancelledBy,
        `${path}.cancellation.cancelledBy`,
        issues,
      );
    }
  }
  if (input.uncertainWriterReconciliation !== undefined) {
    const reconciliation = exactRecord(
      input.uncertainWriterReconciliation,
      `${path}.uncertainWriterReconciliation`,
      [
        "kind",
        "outcome",
        "reconciledAt",
        "reconciledBy",
        "decisionId",
        "providerInspectionAttestation",
      ],
      [],
      issues,
    );
    if (reconciliation) {
      oneOf(
        reconciliation.kind,
        ["uncertain-writer-resolved"],
        `${path}.uncertainWriterReconciliation.kind`,
        issues,
      );
      oneOf(
        reconciliation.outcome,
        ["provider-did-not-write", "write-effect-accepted"],
        `${path}.uncertainWriterReconciliation.outcome`,
        issues,
      );
      isoDateTime(
        reconciliation.reconciledAt,
        `${path}.uncertainWriterReconciliation.reconciledAt`,
        issues,
      );
      validateCommandActor(
        reconciliation.reconciledBy,
        `${path}.uncertainWriterReconciliation.reconciledBy`,
        issues,
      );
      nonEmptyString(
        reconciliation.decisionId,
        `${path}.uncertainWriterReconciliation.decisionId`,
        issues,
      );
      nonEmptyString(
        reconciliation.providerInspectionAttestation,
        `${path}.uncertainWriterReconciliation.providerInspectionAttestation`,
        issues,
      );
    }
  }
  if (input.annotationOnly !== undefined && input.annotationOnly !== true) {
    issue(
      issues,
      "invalid_enum",
      `${path}.annotationOnly`,
      "when present, annotationOnly must be exactly true",
    );
  }
  if (input.statusHistory !== undefined) {
    validateArray(
      input.statusHistory,
      `${path}.statusHistory`,
      issues,
      validateRunTransition,
    );
  }
}

function validateDecision(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "phaseId",
      "title",
      "question",
      "status",
      "requestedAt",
      "inputEvidenceRefs",
      "approvalIds",
    ],
    [
      "supersedesDecisionId",
      "supersededByDecisionId",
      "baseSnapshot",
      "inputFingerprint",
      "proposal",
    ],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.phaseId, `${path}.phaseId`, issues);
  nonEmptyString(input.title, `${path}.title`, issues);
  nonEmptyString(input.question, `${path}.question`, issues);
  oneOf(
    input.status,
    ["required", "proposed", "approved", "rejected", "superseded", "abandoned"],
    `${path}.status`,
    issues,
  );
  isoDateTime(input.requestedAt, `${path}.requestedAt`, issues);
  validateExecutionBinding(input, path, issues);
  validateArray(
    input.inputEvidenceRefs,
    `${path}.inputEvidenceRefs`,
    issues,
    validateEvidenceRef,
  );
  stringArray(input.approvalIds, `${path}.approvalIds`, issues);
  optionalNonEmptyString(
    input.supersedesDecisionId,
    `${path}.supersedesDecisionId`,
    issues,
  );
  optionalNonEmptyString(
    input.supersededByDecisionId,
    `${path}.supersededByDecisionId`,
    issues,
  );
  if (input.proposal !== undefined) {
    validateDecisionProposal(input.proposal, `${path}.proposal`, issues);
  }
}

function validateApproval(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "decisionId", "status", "requestedAt", "inputEvidenceRefs"],
    [
      "decidedAt",
      "decidedBy",
      "rationale",
      "decidedByOrigin",
      "baseSnapshot",
      "inputFingerprint",
    ],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.decisionId, `${path}.decisionId`, issues);
  oneOf(
    input.status,
    ["pending", "approved", "rejected", "revoked"],
    `${path}.status`,
    issues,
  );
  isoDateTime(input.requestedAt, `${path}.requestedAt`, issues);
  optionalIsoDateTime(input.decidedAt, `${path}.decidedAt`, issues);
  optionalNonEmptyString(input.decidedBy, `${path}.decidedBy`, issues);
  optionalNonEmptyString(input.rationale, `${path}.rationale`, issues);
  if (input.decidedByOrigin !== undefined) {
    oneOf(
      input.decidedByOrigin,
      ["human", "agent"],
      `${path}.decidedByOrigin`,
      issues,
    );
  }
  validateExecutionBinding(input, path, issues);
  validateArray(
    input.inputEvidenceRefs,
    `${path}.inputEvidenceRefs`,
    issues,
    validateEvidenceRef,
  );
}

function validateCommandActor(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(value, path, ["id", "origin"], [], issues);
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  oneOf(input.origin, ["human", "agent"], `${path}.origin`, issues);
}

function validateDecisionProposal(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["summary", "parameters", "proposedAt", "proposedBy"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.summary, `${path}.summary`, issues);
  isoDateTime(input.proposedAt, `${path}.proposedAt`, issues);
  validateCommandActor(input.proposedBy, `${path}.proposedBy`, issues);
  if (Array.isArray(input.parameters) && input.parameters.length === 0) {
    issue(
      issues,
      "missing_parameter",
      `${path}.parameters`,
      "must contain at least one typed parameter",
    );
  }
  validateArray(
    input.parameters,
    `${path}.parameters`,
    issues,
    (parameter, itemPath) => {
      const item = exactRecord(
        parameter,
        itemPath,
        ["key", "label", "value"],
        ["unit"],
        issues,
      );
      if (!item) return;
      nonEmptyString(item.key, `${itemPath}.key`, issues);
      nonEmptyString(item.label, `${itemPath}.label`, issues);
      if (
        typeof item.value !== "string" && typeof item.value !== "number" &&
        typeof item.value !== "boolean"
      ) {
        issue(
          issues,
          "invalid_type",
          `${itemPath}.value`,
          "must be a string, finite number or boolean",
        );
      } else if (typeof item.value === "string") {
        nonEmptyString(item.value, `${itemPath}.value`, issues);
      } else if (typeof item.value === "number" && !Number.isFinite(item.value)) {
        issue(issues, "invalid_number", `${itemPath}.value`, "must be finite");
      }
      optionalNonEmptyString(item.unit, `${itemPath}.unit`, issues);
      if (item.unit !== undefined && typeof item.value !== "number") {
        issue(
          issues,
          "invalid_unit",
          `${itemPath}.unit`,
          "is only valid for a numeric parameter",
        );
      }
    },
  );
}

function validateRunTransition(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["commandId", "status", "at", "actor", "summary"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.commandId, `${path}.commandId`, issues);
  oneOf(
    input.status,
    [
      "queued",
      "running",
      "waiting-for-decision",
      "publishing",
      "completed",
      "failed",
      "cancelled",
    ],
    `${path}.status`,
    issues,
  );
  isoDateTime(input.at, `${path}.at`, issues);
  validateCommandActor(input.actor, `${path}.actor`, issues);
  nonEmptyString(input.summary, `${path}.summary`, issues);
}

function validateCommandReceipt(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "commandId",
      "type",
      "actor",
      "issuedAt",
      "appliedAt",
      "requestFingerprint",
      "resultingSnapshot",
    ],
    ["approvedBriefBasis", "queuedRun", "cancelledRun"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.commandId, `${path}.commandId`, issues);
  oneOf(
    input.type,
    [
      "project.start",
      "project.question-propose",
      "project.answer-record",
      "project.brief-propose",
      "project.brief-approve",
      "project.brief-reject",
      "project.plan-publish",
      "project.change-append",
      "work-item.reconcile-successor",
      "work-item.abandon",
      "decision.propose",
      "decision.approve",
      "decision.reject",
      "agent-run.queue",
      "agent-run.claim",
      "agent-run.progress",
      "agent-run.publish",
      "agent-run.complete",
      "agent-run.fail",
      "agent-run.cancel",
      "agent-run.reconcile-annotation",
    ],
    `${path}.type`,
    issues,
  );
  validateCommandActor(input.actor, `${path}.actor`, issues);
  isoDateTime(input.issuedAt, `${path}.issuedAt`, issues);
  isoDateTime(input.appliedAt, `${path}.appliedAt`, issues);
  validateFingerprint(
    input.requestFingerprint,
    `${path}.requestFingerprint`,
    issues,
  );
  validatePrevious(input.resultingSnapshot, `${path}.resultingSnapshot`, issues);
  if (input.approvedBriefBasis !== undefined) {
    validateApprovedBriefBasis(
      input.approvedBriefBasis,
      `${path}.approvedBriefBasis`,
      issues,
    );
  }
  if (input.queuedRun !== undefined) {
    validateQueuedRunReceiptBinding(
      input.queuedRun,
      `${path}.queuedRun`,
      issues,
    );
  }
  if (input.cancelledRun !== undefined) {
    validateCancelledRunReceiptBinding(
      input.cancelledRun,
      `${path}.cancelledRun`,
      issues,
    );
  }
}

function validateQueuedRunReceiptBinding(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["runId", "workItemId"],
    ["resolvedOperationPlan"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.runId, `${path}.runId`, issues);
  nonEmptyString(input.workItemId, `${path}.workItemId`, issues);
  if (input.resolvedOperationPlan !== undefined) {
    validateResolvedPlanReference(
      input.resolvedOperationPlan,
      `${path}.resolvedOperationPlan`,
      issues,
    );
  }
}

function validateCancelledRunReceiptBinding(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["runId", "workItemId", "queuedCommandId"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.runId, `${path}.runId`, issues);
  nonEmptyString(input.workItemId, `${path}.workItemId`, issues);
  nonEmptyString(input.queuedCommandId, `${path}.queuedCommandId`, issues);
}

function validateBlocker(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "phaseId",
      "title",
      "description",
      "kind",
      "status",
      "openedAt",
      "workItemIds",
      "decisionIds",
    ],
    ["resolvedAt", "resolution"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.phaseId, `${path}.phaseId`, issues);
  nonEmptyString(input.title, `${path}.title`, issues);
  nonEmptyString(input.description, `${path}.description`, issues);
  oneOf(
    input.kind,
    ["required-input", "decision-required", "dependency", "tool-failure"],
    `${path}.kind`,
    issues,
  );
  oneOf(input.status, ["open", "resolved"], `${path}.status`, issues);
  isoDateTime(input.openedAt, `${path}.openedAt`, issues);
  optionalIsoDateTime(input.resolvedAt, `${path}.resolvedAt`, issues);
  optionalNonEmptyString(input.resolution, `${path}.resolution`, issues);
  stringArray(input.workItemIds, `${path}.workItemIds`, issues);
  stringArray(input.decisionIds, `${path}.decisionIds`, issues);
}

function validateExecutionBinding(
  input: Record<string, unknown>,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const hasBase = input.baseSnapshot !== undefined;
  const hasFingerprint = input.inputFingerprint !== undefined;
  if (hasBase !== hasFingerprint) {
    issue(
      issues,
      "incomplete_execution_binding",
      path,
      "baseSnapshot and inputFingerprint must be supplied together",
    );
  }
  if (hasBase) validateSnapshotRef(input.baseSnapshot, `${path}.baseSnapshot`, issues);
  if (hasFingerprint) {
    validateFingerprint(input.inputFingerprint, `${path}.inputFingerprint`, issues);
  }
}

/**
 * V1 run state is deliberately read as-is for immutable project history. V3
 * rejects that field rather than silently treating it as a new execution basis.
 */
function validateRunExecutionBinding(
  input: Record<string, unknown>,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  schemaVersion: EngineeringProjectSchemaVersion | undefined,
): void {
  if (!schemaVersion) return;
  const hasBasis = input.basis !== undefined;
  const hasBase = input.baseSnapshot !== undefined;
  const hasFingerprint = input.inputFingerprint !== undefined;

  if (schemaVersion === "1.0") {
    if (hasBasis) {
      issue(
        issues,
        "schema_version_mismatch",
        `${path}.basis`,
        "is a V3 execution field and cannot appear in a V1 run",
      );
    }
    validateExecutionBinding(input, path, issues);
    return;
  }

  if (hasBase) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.baseSnapshot`,
      "is a V1 execution field and cannot appear in a V3 run",
    );
  }
  if (!hasBasis || !hasFingerprint) {
    issue(
      issues,
      "incomplete_execution_binding",
      path,
      "a V3 run requires both basis and inputFingerprint",
    );
  }
  if (hasBasis) validateEngineeringBasis(input.basis, `${path}.basis`, issues);
  if (hasFingerprint) {
    validateFingerprint(input.inputFingerprint, `${path}.inputFingerprint`, issues);
  }
}

function validateEngineeringBasis(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["kind"],
    [
      "projectId",
      "projectSnapshotId",
      "projectRevision",
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "approvedBriefFingerprint",
      "snapshotId",
      "revision",
      "subjectId",
    ],
    issues,
  );
  if (!input) return;
  if (input.kind === "approved-brief") {
    validateApprovedBriefBasis(value, path, issues);
    return;
  }
  if (input.kind === "thread-snapshot") {
    const threadBasis = exactRecord(
      value,
      path,
      ["kind", "snapshotId", "revision", "subjectId"],
      [],
      issues,
    );
    if (!threadBasis) return;
    nonEmptyString(threadBasis.snapshotId, `${path}.snapshotId`, issues);
    positiveInteger(threadBasis.revision, `${path}.revision`, issues);
    nonEmptyString(threadBasis.subjectId, `${path}.subjectId`, issues);
    return;
  }
  issue(
    issues,
    "invalid_enum",
    `${path}.kind`,
    "must be approved-brief or thread-snapshot",
  );
}

function validateFingerprint(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(value, path, ["algorithm", "digest"], [], issues);
  if (!input) return;
  literal(input.algorithm, "sha256", `${path}.algorithm`, issues);
  if (
    nonEmptyString(input.digest, `${path}.digest`, issues) &&
    !/^[a-f0-9]{64}$/i.test(input.digest as string)
  ) {
    issue(
      issues,
      "invalid_fingerprint",
      `${path}.digest`,
      "must be 64 hexadecimal characters",
    );
  }
}

function validateInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (project.revision === 1 && project.previous !== undefined) {
    issue(
      issues,
      "unexpected_previous",
      "$.previous",
      "revision 1 cannot have a previous snapshot",
    );
  } else if (project.revision > 1 && project.previous === undefined) {
    issue(issues, "missing_previous", "$.previous", "is required after revision 1");
  } else if (
    project.previous && project.previous.revision !== project.revision - 1
  ) {
    issue(
      issues,
      "invalid_revision",
      "$.previous.revision",
      "must be the immediately preceding revision",
    );
  }

  requireUnique(
    project.threadSnapshots,
    (item) => item.snapshotId,
    "$.threadSnapshots",
    issues,
  );
  const createdByCommand = project.schemaVersion === "3.0";
  const expectedCommandReceiptCount = createdByCommand
    ? project.revision
    : Math.max(0, project.revision - 1);
  if ((project.commandReceipts?.length ?? 0) !== expectedCommandReceiptCount) {
    issue(
      issues,
      "incomplete_command_history",
      "$.commandReceipts",
      createdByCommand
        ? "must contain the project-start receipt and one receipt for every later command revision"
        : "must contain exactly one durable receipt for every command-created revision",
    );
  }
  requireUnique(
    project.threadSnapshots,
    (item) => `${item.subjectId}\u0000${item.revision}`,
    "$.threadSnapshots",
    issues,
  );
  requireUnique(project.phases, (item) => item.id, "$.phases", issues);
  requireUnique(project.workItems, (item) => item.id, "$.workItems", issues);
  requireUnique(project.agentRuns, (item) => item.id, "$.agentRuns", issues);
  requireUnique(project.decisions, (item) => item.id, "$.decisions", issues);
  requireUnique(project.approvals, (item) => item.id, "$.approvals", issues);
  requireUnique(project.blockers, (item) => item.id, "$.blockers", issues);
  requireUnique(
    project.commandReceipts ?? [],
    (item) => item.commandId,
    "$.commandReceipts",
    issues,
  );

  if (
    project.threadSnapshots.length === 0 && project.schemaVersion !== "3.0"
  ) {
    issue(
      issues,
      "missing_thread_snapshot",
      "$.threadSnapshots",
      "must declare at least one exact ThreadSnapshot revision",
    );
  }
  if (project.schemaVersion === "3.0") {
    if (!project.framing) {
      issue(
        issues,
        "missing_reference",
        "$.framing",
        "a V3 project owns its living brief from the first revision",
      );
    } else {
      validateProjectFramingInvariants(project, project.framing, issues);
    }
    if (
      project.revision === 1 && (
        project.threadSnapshots.length > 0 || project.phases.length > 0 ||
        project.workItems.length > 0 || project.agentRuns.length > 0 ||
        project.decisions.length > 0 || project.approvals.length > 0 ||
        project.blockers.length > 0 || project.plan !== undefined
      )
    ) {
      issue(
        issues,
        "project_start_scope",
        "$",
        "an initial V3 project contains intent only and cannot fabricate planning or technical state",
      );
    }
  } else if (project.framing) {
    issue(
      issues,
      "schema_version_mismatch",
      "$.framing",
      "living project framing belongs only to V3 projects",
    );
  }
  validatePlanInvariants(project, issues);
  validatePlanChangeInvariants(project, issues);
  project.threadSnapshots.forEach((reference, index) => {
    if (reference.subjectId !== project.project.subjectId) {
      issue(
        issues,
        "thread_subject_mismatch",
        `$.threadSnapshots[${index}].subjectId`,
        "must match the project subjectId",
      );
    }
    if (reference.snapshotId.toLowerCase() === "latest") {
      issue(
        issues,
        "non_exact_reference",
        `$.threadSnapshots[${index}].snapshotId`,
        "cannot use a latest alias",
      );
    }
  });

  project.phases.forEach((phase, index) => {
    if (phase.order !== index + 1) {
      issue(
        issues,
        "invalid_phase_order",
        `$.phases[${index}].order`,
        `must equal ${index + 1}`,
      );
    }
    uniqueStrings(phase.workItemIds, `$.phases[${index}].workItemIds`, issues);
    uniqueStrings(
      phase.requiredDecisionIds,
      `$.phases[${index}].requiredDecisionIds`,
      issues,
    );
    uniqueEvidence(phase.evidenceRefs, `$.phases[${index}].evidenceRefs`, issues);
  });

  const phaseById = new Map(project.phases.map((item) => [item.id, item]));
  const workById = new Map(project.workItems.map((item) => [item.id, item]));
  const decisionById = new Map(project.decisions.map((item) => [item.id, item]));
  const approvalById = new Map(project.approvals.map((item) => [item.id, item]));
  const blockerById = new Map(project.blockers.map((item) => [item.id, item]));
  /**
   * Work item IDs whose sole completed run is an annotation run (annotationOnly:
   * true).  Annotation runs produce no ThreadSnapshot evidence; the invariant
   * "a completed work item requires exact ThreadSnapshot evidence" is explicitly
   * exempted for these items because their work is project-level state change,
   * not thread-level artifact production.
   */
  const annotationOnlyWorkItemIds = new Set(
    project.agentRuns
      .filter((run) => run.status === "completed" && run.annotationOnly === true)
      .map((run) => run.workItemId),
  );
  const declaredSnapshots = new Set(
    project.threadSnapshots.map((item) => snapshotKey(item.snapshotId, item.revision)),
  );

  allEvidenceRefs(project).forEach(({ reference, path }) => {
    if (
      !declaredSnapshots.has(
        snapshotKey(reference.snapshotId, reference.snapshotRevision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        path,
        "references an undeclared ThreadSnapshot revision",
      );
    }
  });
  operationThreadEntityRefs(project).forEach(({ reference, path }) => {
    if (
      !declaredSnapshots.has(
        snapshotKey(reference.snapshotId, reference.snapshotRevision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        path,
        "references an undeclared ThreadSnapshot revision",
      );
    }
  });
  executionBindings(project).forEach(({ baseSnapshot, path }) => {
    if (
      !declaredSnapshots.has(
        snapshotKey(baseSnapshot.snapshotId, baseSnapshot.revision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        path,
        "references an undeclared ThreadSnapshot revision",
      );
    }
    if (baseSnapshot.subjectId !== project.project.subjectId) {
      issue(
        issues,
        "thread_subject_mismatch",
        `${path}.subjectId`,
        "must match the project subjectId",
      );
    }
  });
  project.agentRuns.forEach((run, index) => {
    if (!run.resultSnapshot) return;
    if (
      !declaredSnapshots.has(
        snapshotKey(run.resultSnapshot.snapshotId, run.resultSnapshot.revision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        `$.agentRuns[${index}].resultSnapshot`,
        "references an undeclared ThreadSnapshot revision",
      );
    }
  });
  const workItemOwnerByDecisionId = new Map<string, string>();
  project.workItems.forEach((item, index) => {
    const reconciliation = item.reconciliation;
    if (!reconciliation) return;
    // successorSnapshot is absent for a direct reconciliation — skip the
    // cross-reference check for it when the field is undefined.
    const snapshotRefs: Array<
      [string, { snapshotId: string; revision: number }]
    > = [["successorRunSnapshot", reconciliation.successorRunSnapshot]];
    if (reconciliation.successorSnapshot !== undefined) {
      snapshotRefs.push(["successorSnapshot", reconciliation.successorSnapshot]);
    }
    for (const [name, reference] of snapshotRefs) {
      if (
        !declaredSnapshots.has(
          snapshotKey(reference.snapshotId, reference.revision),
        )
      ) {
        issue(
          issues,
          "unknown_thread_snapshot",
          `$.workItems[${index}].reconciliation.${name}`,
          "references an undeclared ThreadSnapshot revision",
        );
      }
    }
  });

  project.phases.forEach((phase, phaseIndex) => {
    phase.workItemIds.forEach((id, itemIndex) => {
      const item = workById.get(id);
      if (!item || item.phaseId !== phase.id) {
        issue(
          issues,
          "missing_reference",
          `$.phases[${phaseIndex}].workItemIds[${itemIndex}]`,
          "must reference a work item in this phase",
        );
      }
    });
    phase.requiredDecisionIds.forEach((id, decisionIndex) => {
      const decision = decisionById.get(id);
      if (!decision || decision.phaseId !== phase.id) {
        issue(
          issues,
          "missing_reference",
          `$.phases[${phaseIndex}].requiredDecisionIds[${decisionIndex}]`,
          "must reference a decision in this phase",
        );
      }
    });
    const actualItems = project.workItems.filter((item) => item.phaseId === phase.id)
      .map((item) => item.id);
    if (!sameStringSet(actualItems, phase.workItemIds)) {
      issue(
        issues,
        "incomplete_phase_membership",
        `$.phases[${phaseIndex}].workItemIds`,
        "must list every work item assigned to this phase exactly once",
      );
    }
  });

  project.workItems.forEach((item, index) => {
    const path = `$.workItems[${index}]`;
    if (!phaseById.has(item.phaseId)) {
      issue(
        issues,
        "missing_reference",
        `${path}.phaseId`,
        "does not reference a phase",
      );
    }
    uniqueStrings(item.dependsOnWorkItemIds, `${path}.dependsOnWorkItemIds`, issues);
    uniqueStrings(item.decisionIds, `${path}.decisionIds`, issues);
    uniqueStrings(item.blockerIds, `${path}.blockerIds`, issues);
    uniqueEvidence(item.evidenceRefs, `${path}.evidenceRefs`, issues);
    item.dependsOnWorkItemIds.forEach((id, dependencyIndex) => {
      if (id === item.id || !workById.has(id)) {
        issue(
          issues,
          "missing_reference",
          `${path}.dependsOnWorkItemIds[${dependencyIndex}]`,
          "must reference a different work item",
        );
      }
    });
    item.decisionIds.forEach((id, decisionIndex) => {
      claimDecisionWorkItemScope(
        workItemOwnerByDecisionId,
        id,
        item.id,
        `${path}.decisionIds[${decisionIndex}]`,
        issues,
      );
      const decision = decisionById.get(id);
      if (!decision || decision.phaseId !== item.phaseId) {
        issue(
          issues,
          "missing_reference",
          `${path}.decisionIds[${decisionIndex}]`,
          "must reference a decision in the same phase",
        );
      }
    });
    item.operation?.bindings.forEach((binding, bindingIndex) => {
      const bindingPath = `${path}.operation.bindings[${bindingIndex}].source`;
      if (binding.source.kind === "decision-parameter") {
        const decision = decisionById.get(binding.source.decisionId);
        if (!decision || !item.decisionIds.includes(decision.id)) {
          issue(
            issues,
            "missing_reference",
            bindingPath,
            "must reference a decision bound to the same work item",
          );
        }
      }
    });
    item.blockerIds.forEach((id, blockerIndex) => {
      const blocker = blockerById.get(id);
      if (
        !blocker || blocker.phaseId !== item.phaseId ||
        !blocker.workItemIds.includes(item.id)
      ) {
        issue(
          issues,
          "missing_reference",
          `${path}.blockerIds[${blockerIndex}]`,
          "must reference a reciprocal blocker in the same phase",
        );
      }
    });
    if (
      item.status === "completed" && item.evidenceRefs.length === 0 &&
      !annotationOnlyWorkItemIds.has(item.id)
    ) {
      issue(
        issues,
        "missing_evidence",
        `${path}.evidenceRefs`,
        "a completed work item requires exact ThreadSnapshot evidence",
      );
    }
    if (
      item.status === "waiting-for-decision" &&
      !item.decisionIds.some((id) => {
        const decision = decisionById.get(id);
        return decision?.status === "required" || decision?.status === "proposed" ||
          decision?.status === "rejected";
      })
    ) {
      issue(
        issues,
        "missing_decision",
        `${path}.decisionIds`,
        "waiting-for-decision requires an unresolved linked decision",
      );
    }
    if (item.status === "ready") {
      const decisionsApproved = item.decisionIds.every((id) =>
        decisionById.get(id)?.status === "approved"
      );
      const blockersResolved = item.blockerIds.every((id) =>
        blockerById.get(id)?.status === "resolved"
      );
      // Mirror of nextIdleWorkStatus and deriveEngineeringPhaseStatus:
      // a cancelled dep with a reconciliation record carries equivalent evidence
      // from an independently completed successor, so it satisfies the dependency.
      const dependenciesCompleted = item.dependsOnWorkItemIds.every((id) => {
        const dep = workById.get(id);
        return dep?.status === "completed" ||
          (dep?.status === "cancelled" && dep.reconciliation !== undefined);
      });
      if (!decisionsApproved || !blockersResolved || !dependenciesCompleted) {
        issue(
          issues,
          "work_item_not_ready",
          `${path}.status`,
          "ready requires every decision approved, blocker resolved and dependency completed",
        );
      }
    }
  });
  validateGateClaimsAgainstCanonicalBrief(project, issues);
  detectWorkCycles(project.workItems, issues);

  project.agentRuns.forEach((run, index) =>
    validateRunInvariant(run, index, workById, project, issues)
  );
  validateRunTransitionCommandUsage(project, issues);
  project.workItems.forEach((item, index) =>
    validateWorkItemReconciliationInvariant(item, index, project, issues)
  );
  project.decisions.forEach((decision, index) =>
    validateDecisionInvariant(
      decision,
      index,
      phaseById,
      approvalById,
      project.decisions,
      issues,
    )
  );
  project.approvals.forEach((approval, index) =>
    validateApprovalInvariant(approval, index, decisionById, issues)
  );
  project.blockers.forEach((blocker, index) => {
    blocker.decisionIds.forEach((decisionId) => {
      blocker.workItemIds.forEach((workItemId, workItemIndex) =>
        claimDecisionWorkItemScope(
          workItemOwnerByDecisionId,
          decisionId,
          workItemId,
          `$.blockers[${index}].workItemIds[${workItemIndex}]`,
          issues,
        )
      );
    });
    validateBlockerInvariant(
      blocker,
      index,
      phaseById,
      workById,
      decisionById,
      issues,
    );
  });
  (project.commandReceipts ?? []).forEach((receipt, index) =>
    validateCommandReceiptInvariant(receipt, index, project, issues)
  );
  validateQueuedRunReceiptBindings(project, issues);
  validateCancelledRunReceiptBindings(project, issues);
}

/**
 * Every decision that can release work has one exact work-item owner. Direct
 * decision links and blocker-mediated links share this same authority map.
 */
function claimDecisionWorkItemScope(
  ownerByDecisionId: Map<string, string>,
  decisionId: string,
  workItemId: string,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const existingOwner = ownerByDecisionId.get(decisionId);
  if (existingOwner !== undefined && existingOwner !== workItemId) {
    issue(
      issues,
      "ambiguous_decision_scope",
      path,
      "must not let one decision release more than one work item",
    );
    return;
  }
  ownerByDecisionId.set(decisionId, workItemId);
}

/**
 * A claim is coverage of a reviewed mandate, not an operation input. It can
 * only target an explicit V2 gate in the current human-approved canonical
 * brief; V1 remains readable but lacks the dependency contract needed for a
 * new claim.
 */
function validateGateClaimsAgainstCanonicalBrief(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const brief = project.framing?.currentBrief;
  const approval = project.framing?.currentBriefApproval;
  const hasCanonicalBrief = brief !== undefined &&
    approval?.status === "approved";
  const gateItems = hasCanonicalBrief && brief
    ? new Map(brief.items.map((item) => [item.id, item]))
    : undefined;
  const isV2Contract = brief !== undefined &&
    projectBriefContractVersion(brief) === "2.0";

  project.workItems.forEach((workItem, workItemIndex) => {
    if (workItem.gateClaims === undefined) return;
    const seenGateItemIds = new Set<string>();
    workItem.gateClaims.forEach((claim, claimIndex) => {
      const path = `$.workItems[${workItemIndex}].gateClaims[${claimIndex}]`;
      if (seenGateItemIds.has(claim.gateItemId)) {
        issueWithRecovery(
          issues,
          "duplicate_gate_claim",
          `${path}.gateItemId`,
          "a work item may claim each gate only once",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Keep one claim per gate and set its single reviewed role and link status.",
        );
      }
      seenGateItemIds.add(claim.gateItemId);
      if (!hasCanonicalBrief) {
        issueWithRecovery(
          issues,
          "missing_canonical_brief_for_gate_claim",
          `${path}.gateItemId`,
          "a gate claim requires one current human-approved canonical brief",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Approve the exact brief before recording work-item gate claims.",
        );
        return;
      }
      if (!isV2Contract) {
        issueWithRecovery(
          issues,
          "gate_claim_contract_incomplete",
          `${path}.gateItemId`,
          "a gate claim requires a V2 canonical brief with explicit dependencies",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Revise and approve the brief as V2 with explicit dependsOnItemIds before declaring claims.",
        );
        return;
      }
      const gate = gateItems?.get(claim.gateItemId);
      if (!gate) {
        issueWithRecovery(
          issues,
          "unknown_gate_claim",
          `${path}.gateItemId`,
          "must reference a gate item in the current canonical brief",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Use the stable ID of a success-criterion or verification-activity in the current canonical brief.",
        );
      } else if (!isProjectBriefGateKind(gate.kind)) {
        issueWithRecovery(
          issues,
          "gate_claim_target_not_gate",
          `${path}.gateItemId`,
          "must reference a success-criterion or verification-activity",
          {
            workItemId: workItem.id,
            gateItemId: claim.gateItemId,
            itemKind: gate.kind,
          },
          "Target a success-criterion or verification-activity, not a general brief item.",
        );
      }
    });
  });
}

function validateWorkItemReconciliationInvariant(
  item: EngineeringWorkItem,
  index: number,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.workItems[${index}]`;
  const reconciliation = item.reconciliation;
  if (!reconciliation) return;
  if (item.status !== "cancelled") {
    issue(
      issues,
      "invalid_transition",
      `${path}.status`,
      "a successor reconciliation is valid only for cancelled work",
    );
    return;
  }
  if (item.evidenceRefs.length !== 0) {
    issue(
      issues,
      "invalid_transition",
      `${path}.evidenceRefs`,
      "reconciled failed work must not claim successor evidence as its own",
    );
  }
  if (reconciliation.failedRunId === reconciliation.successorRunId) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation`,
      "a failed run cannot reconcile itself as its successor",
    );
  }
  const failed = project.agentRuns.find((run) => run.id === reconciliation.failedRunId);
  // Mirror the command-service guard: a pre-claim cancelled run (no claimedAt,
  // no startedAt — never touched a provider) is valid alongside a failed run.
  const isEvidenceFreeFailure = !!failed && failed.status === "failed" &&
    !!failed.failure &&
    failed.evidenceRefs.length === 0;
  const isPreClaimCancellation = !!failed && failed.status === "cancelled" &&
    !failed.claimedAt &&
    !failed.startedAt && failed.evidenceRefs.length === 0;
  if (
    !failed || failed.workItemId !== item.id ||
    (!isEvidenceFreeFailure && !isPreClaimCancellation)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.failedRunId`,
      "must identify this work item's evidence-free failed or pre-claim cancelled run",
    );
  }
  const successor = project.agentRuns.find((run) =>
    run.id === reconciliation.successorRunId
  );
  const successorWork = successor
    ? project.workItems.find((work) => work.id === successor.workItemId)
    : undefined;
  if (
    !successor || successor.workItemId === item.id ||
    successor.status !== "completed" || !successor.resultSnapshot ||
    successor.evidenceRefs.length === 0 || successorWork?.status !== "completed"
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorRunId`,
      "must identify an independently completed successor run with evidence",
    );
    return;
  }
  if (
    !sameSnapshotRef(successor.resultSnapshot, reconciliation.successorRunSnapshot)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorRunSnapshot`,
      "must exactly match the completed successor result snapshot",
    );
  }
  // For a direct reconciliation the successor run result is already the project
  // thread head and no separate closeout snapshot is produced. When present,
  // the full closeout path is validated as before.
  if (reconciliation.successorSnapshot !== undefined) {
    if (
      reconciliation.successorSnapshot.subjectId !== project.project.subjectId ||
      reconciliation.successorSnapshot.revision !==
        reconciliation.successorRunSnapshot.revision + 1 ||
      // The closeout snapshot must belong to the project's recorded lineage. It
      // was the newest snapshot when the closeout happened, but this validation
      // replays on every later revision — requiring it to still be the *last*
      // snapshot would freeze the whole project the moment any post-closeout
      // run publishes. The direct-successor position is already pinned by the
      // revision equality above; lineage membership is the durable property.
      !project.threadSnapshots.some((snapshot) =>
        sameSnapshotRef(snapshot, reconciliation.successorSnapshot!)
      )
    ) {
      issue(
        issues,
        "invalid_transition",
        `${path}.reconciliation.successorSnapshot`,
        "must be the direct closeout snapshot after the successor result, " +
          "recorded in the project lineage",
      );
    }
  }
  if (
    !sameEvidenceSet(successor.evidenceRefs, reconciliation.successorEvidenceRefs)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorEvidenceRefs`,
      "must exactly match the completed successor evidence",
    );
  }
  if (
    successorWork &&
    !sameEvidenceSet(successorWork.evidenceRefs, successor.evidenceRefs)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorRunId`,
      "must retain the same exact evidence on its completed work item",
    );
  }
  // Mirror the command-service equivalence guard, and ONLY for the direct form.
  //
  // WHY THE DIRECT FORM ONLY — the direct path must remain self-contained on
  // replay. A full closeout may deliberately carry another operation, but the
  // command service now requires a code-owned injected operation-transition
  // policy before persisting it, in addition to the exact snapshot validator.
  // This structural replay validator cannot rerun that caller-owned proof; it
  // still verifies the immutable successor snapshot, evidence and lineage below.
  if (
    reconciliation.successorSnapshot === undefined &&
    item.operation !== undefined && successorWork !== undefined
  ) {
    if (
      successorWork.operation?.id !== item.operation.id ||
      successorWork.operation?.version !== item.operation.version ||
      deterministicJson(successorWork.operation?.bindings ?? []) !==
        deterministicJson(item.operation.bindings)
    ) {
      issue(
        issues,
        "invalid_transition",
        `${path}.reconciliation.successorRunId`,
        "successor work item must carry the identical registered operation (id, version, bindings)",
      );
    }
  }
  // Mirror the command-service lineage guard: the successor run must have been
  // executed against a snapshot declared in this project's thread lineage.
  {
    const lineageIds = new Set(project.threadSnapshots.map((s) => s.snapshotId));
    const successorBaseId = successor.baseSnapshot?.snapshotId ??
      (successor.basis?.kind === "thread-snapshot"
        ? successor.basis.snapshotId
        : successor.basis?.kind === "approved-brief"
        ? successor.basis.projectSnapshotId
        : undefined);
    if (!successorBaseId || !lineageIds.has(successorBaseId)) {
      issue(
        issues,
        "invalid_transition",
        `${path}.reconciliation.successorRunId`,
        "successor run base snapshot must descend from this project's declared thread lineage",
      );
    }
  }
  if (Date.parse(reconciliation.reconciledAt) < Date.parse(successor.completedAt!)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.reconciliation.reconciledAt`,
      "cannot precede the completed successor run",
    );
  }
}

function validateProjectFramingInvariants(
  project: EngineeringProjectSnapshot,
  framing: EngineeringProjectFraming,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (Date.parse(framing.intent.capturedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      "$.framing.intent.capturedAt",
      "cannot be later than the current project revision",
    );
  }
  requireUnique(framing.questions, (item) => item.id, "$.framing.questions", issues);
  requireUnique(framing.answers, (item) => item.id, "$.framing.answers", issues);
  const questionById = new Map(framing.questions.map((item) => [item.id, item]));
  const answerById = new Map(framing.answers.map((item) => [item.id, item]));
  const superseded = new Set<string>();
  framing.questions.forEach((question, index) => {
    uniqueStrings(
      question.options.map((option) => option.value),
      `$.framing.questions[${index}].options`,
      issues,
    );
    if (question.options.length === 0) {
      issue(
        issues,
        "missing_question_option",
        `$.framing.questions[${index}].options`,
        "must contain at least one bounded option",
      );
    }
    if (
      !question.options.some((option) => option.value === question.recommendation.value)
    ) {
      issue(
        issues,
        "unselectable_recommendation",
        `$.framing.questions[${index}].recommendation.value`,
        "must match one bounded option value",
      );
    }
  });
  framing.answers.forEach((answer, index) => {
    const question = questionById.get(answer.questionId);
    if (!question) {
      issue(
        issues,
        "unknown_question",
        `$.framing.answers[${index}].questionId`,
        "does not resolve to a project question",
      );
    } else if (answer.kind === "unknown" && !question.allowUnknown) {
      issue(
        issues,
        "unknown_not_allowed",
        `$.framing.answers[${index}].kind`,
        "the question does not permit an unknown answer",
      );
    } else if (
      answer.kind === "provided" &&
      !question.options.some((option) => option.value === answer.value)
    ) {
      issue(
        issues,
        "unselectable_answer",
        `$.framing.answers[${index}].value`,
        "must match one bounded question option value",
      );
    }
    if (answer.recordedBy.origin === "human" && answer.source.kind !== "human") {
      issue(
        issues,
        "false_human_source",
        `$.framing.answers[${index}].source.kind`,
        "a directly recorded human answer must declare a human source",
      );
    }
    if (!answer.supersedesAnswerId) return;
    const previous = answerById.get(answer.supersedesAnswerId);
    if (
      !previous || previous.questionId !== answer.questionId ||
      framing.answers.indexOf(previous) >= index
    ) {
      issue(
        issues,
        "invalid_supersession",
        `$.framing.answers[${index}].supersedesAnswerId`,
        "must resolve to an earlier answer for the same question",
      );
    }
    if (superseded.has(answer.supersedesAnswerId)) {
      issue(
        issues,
        "answer_superseded_twice",
        `$.framing.answers[${index}].supersedesAnswerId`,
        "an answer may be superseded only once",
      );
    }
    superseded.add(answer.supersedesAnswerId);
  });
  for (const question of framing.questions) {
    const active = framing.answers.filter((answer) =>
      answer.questionId === question.id && !superseded.has(answer.id)
    );
    if (active.length > 1) {
      issue(
        issues,
        "ambiguous_current_answer",
        "$.framing.answers",
        `question ${question.id} has more than one current answer`,
      );
    }
  }

  if (framing.currentBrief) {
    validateProjectBriefInvariants(
      project,
      framing,
      framing.currentBrief,
      "$.framing.currentBrief",
      issues,
    );
  }
  if (framing.proposedBrief) {
    validateProjectBriefInvariants(
      project,
      framing,
      framing.proposedBrief,
      "$.framing.proposedBrief",
      issues,
    );
  }
  if (
    framing.currentBrief && framing.proposedBrief &&
    framing.proposedBrief.revision <= framing.currentBrief.revision
  ) {
    issue(
      issues,
      "non_contiguous_revision",
      "$.framing.proposedBrief.revision",
      "must be newer than the current approved brief",
    );
  }

  if (Boolean(framing.currentBrief) !== Boolean(framing.currentBriefApproval)) {
    issue(
      issues,
      "missing_review_scope",
      "$.framing",
      "currentBrief and currentBriefApproval must be present together",
    );
  }
  if (Boolean(framing.proposedBrief) !== Boolean(framing.proposalReview)) {
    issue(
      issues,
      "missing_review_scope",
      "$.framing",
      "proposedBrief and proposalReview must be present together",
    );
  }
  if (framing.currentBrief && framing.currentBriefApproval) {
    validateBriefReviewBinding(
      framing.currentBrief,
      framing.currentBriefApproval,
      "$.framing.currentBriefApproval",
      true,
      issues,
    );
    const objective = projectBriefObjective(framing.currentBrief);
    if (
      project.project.objective.title !== objective ||
      project.project.objective.statement !== objective
    ) {
      issue(
        issues,
        "brief_objective_mismatch",
        "$.project.objective",
        "must mirror the current canonical brief objective",
      );
    }
  }
  if (framing.proposedBrief && framing.proposalReview) {
    validateBriefReviewBinding(
      framing.proposedBrief,
      framing.proposalReview,
      "$.framing.proposalReview",
      false,
      issues,
    );
  }
}

function validateBriefReviewBinding(
  brief: ProjectBriefRevision,
  review:
    | EngineeringProjectFraming["currentBriefApproval"]
    | EngineeringProjectFraming["proposalReview"],
  path: string,
  approved: boolean,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (!review) return;
  if (
    review.briefSnapshotId !== brief.id ||
    review.briefRevision !== brief.revision
  ) {
    issue(
      issues,
      "review_brief_mismatch",
      path,
      "must reference the exact reviewed brief revision",
    );
  }
  if (approved && review.status !== "approved") {
    issue(issues, "review_status_mismatch", `${path}.status`, "must be approved");
  }
  if (!approved && review.status === "approved") {
    issue(
      issues,
      "review_status_mismatch",
      `${path}.status`,
      "a proposal review cannot already be approved",
    );
  }
  const decided = review.status !== "pending";
  if (
    !decided &&
    (review.decidedAt || review.decidedBy || review.rationale)
  ) {
    issue(
      issues,
      "pending_review_has_decision",
      path,
      "a pending brief review cannot contain decision fields",
    );
  }
  if (
    decided &&
    (!review.decidedAt || !review.decidedBy || !review.rationale)
  ) {
    issue(
      issues,
      "incomplete_review_decision",
      path,
      "a decided brief review requires time, human actor and rationale",
    );
  }
  if (review.decidedBy?.origin === "agent") {
    issue(
      issues,
      "agent_review_forbidden",
      `${path}.decidedBy.origin`,
      "an agent cannot approve or reject the project brief",
    );
  }
  chronological(
    review.requestedAt,
    review.decidedAt,
    `${path}.decidedAt`,
    issues,
  );
}

function validateProjectBriefInvariants(
  project: EngineeringProjectSnapshot,
  framing: EngineeringProjectFraming,
  brief: ProjectBriefRevision,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const expectedBriefId = `${project.project.id}:brief`;
  if (brief.briefId !== expectedBriefId) {
    issue(
      issues,
      "brief_identity_mismatch",
      `${path}.briefId`,
      `must equal ${expectedBriefId}`,
    );
  }
  if (brief.revision === 1 && brief.previous) {
    issue(
      issues,
      "unexpected_previous",
      `${path}.previous`,
      "must be absent at brief revision 1",
    );
  } else if (
    brief.revision > 1 &&
    (!brief.previous || brief.previous.revision !== brief.revision - 1)
  ) {
    issue(
      issues,
      "non_contiguous_revision",
      `${path}.previous`,
      "must reference the immediately preceding brief revision",
    );
  }
  if (Date.parse(brief.proposedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.proposedAt`,
      "cannot be later than the current project revision",
    );
  }
  requireUnique(brief.items, (item) => item.id, `${path}.items`, issues);
  validateV2BriefGateDependencies(brief, path, issues);
  const objective = brief.items.filter((item) => item.kind === "objective");
  if (objective.length !== 1) {
    issue(
      issues,
      "invalid_brief_objective",
      `${path}.items`,
      "must contain exactly one objective",
    );
  }
  if (!brief.items.some((item) => item.kind === "mission-scenario")) {
    issue(
      issues,
      "missing_brief_section",
      `${path}.items`,
      "must contain at least one mission scenario",
    );
  }
  if (!brief.items.some((item) => item.kind === "success-criterion")) {
    issue(
      issues,
      "missing_brief_section",
      `${path}.items`,
      "must contain at least one success criterion",
    );
  }
  brief.items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (item.sourceRefs.length === 0) {
      issue(
        issues,
        "missing_source",
        `${itemPath}.sourceRefs`,
        "every brief item must retain at least one source",
      );
    }
    for (const [sourceIndex, source] of item.sourceRefs.entries()) {
      if (
        source.kind === "answer" &&
        !framing.answers.some((answer) =>
          answer.id === source.reference &&
          currentProjectAnswer(framing, answer.questionId)?.id === answer.id
        )
      ) {
        issue(
          issues,
          "stale_brief_source",
          `${itemPath}.sourceRefs[${sourceIndex}]`,
          "must reference one current project answer",
        );
      }
    }
    if (item.kind === "assumption" && (!item.owner || !item.reviewTrigger)) {
      issue(
        issues,
        "incomplete_assumption",
        itemPath,
        "an assumption requires both owner and reviewTrigger",
      );
    }
    if (
      item.kind === "observed-fact" &&
      !item.sourceRefs.some((source) =>
        source.kind === "tool" || source.kind === "document" ||
        source.kind === "expert"
      )
    ) {
      issue(
        issues,
        "unobserved_fact",
        `${itemPath}.sourceRefs`,
        "an observed fact requires a tool, document or expert source",
      );
    }
  });
}

/**
 * V2 makes every gate's impact contract explicit. The gate's own fingerprint
 * remains implicit, so self references would only disguise an incomplete
 * declaration rather than add dependency information.
 */
function validateV2BriefGateDependencies(
  brief: ProjectBriefRevision,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (projectBriefContractVersion(brief) !== "2.0") return;
  const itemsById = new Map(brief.items.map((item) => [item.id, item]));
  brief.items.forEach((item, itemIndex) => {
    if (!isProjectBriefGateKind(item.kind)) return;
    const itemPath = `${path}.items[${itemIndex}]`;
    const dependencyIds = item.dependsOnItemIds;
    // Structural validation reports a missing or malformed declaration first.
    if (!dependencyIds) return;
    const seen = new Set<string>();
    dependencyIds.forEach((dependencyId, dependencyIndex) => {
      const dependencyPath = `${itemPath}.dependsOnItemIds[${dependencyIndex}]`;
      if (seen.has(dependencyId)) {
        issueWithRecovery(
          issues,
          "duplicate_gate_dependency",
          dependencyPath,
          "must name each dependent brief item only once",
          { gateItemId: item.id, dependencyItemId: dependencyId },
          "Keep one explicit dependency per brief item.",
        );
      }
      seen.add(dependencyId);
      if (dependencyId === item.id) {
        issueWithRecovery(
          issues,
          "invalid_gate_self_dependency",
          dependencyPath,
          "must not name the gate itself; its own fingerprint is implicit",
          { gateItemId: item.id },
          "Remove the self reference; use [] when the gate has no other brief-item dependencies.",
        );
      } else if (!itemsById.has(dependencyId)) {
        issueWithRecovery(
          issues,
          "unknown_gate_dependency",
          dependencyPath,
          "must reference an existing brief item",
          { gateItemId: item.id, dependencyItemId: dependencyId },
          "Reference an existing different brief item or use [] for declared independence.",
        );
      }
    });
  });
}

function validatePlanInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const plan = project.plan;
  const path = "$.plan";
  if (!plan) return;
  if (project.schemaVersion === "3.0") {
    if (plan.basis.kind !== "approved-brief") {
      issue(
        issues,
        "approval_scope_mismatch",
        `${path}.basis`,
        "must name one exact human-approved project brief revision",
      );
    } else {
      validateApprovedBriefBasisAuthorization(
        project,
        plan.basis,
        `${path}.basis`,
        plan.publishedAt,
        issues,
      );
    }
  }
  if (plan.publishedBy.origin !== "agent") {
    issue(
      issues,
      "command_authority_mismatch",
      `${path}.publishedBy.origin`,
      "only an agent may publish a project path",
    );
  }
  if (Date.parse(plan.publishedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.publishedAt`,
      "cannot be later than the project snapshot generation time",
    );
  }
  if (project.phases.length === 0 || project.workItems.length === 0) {
    issue(
      issues,
      "missing_plan_content",
      path,
      "must declare at least one phase and one work item",
    );
  }
  project.workItems.forEach((item, index) => {
    if (!item.operation) {
      issue(
        issues,
        "missing_operation",
        `$.workItems[${index}].operation`,
        "agent-published work must reference a registered operation",
      );
    }
  });
  const matchingReceipt = project.commandReceipts?.some((receipt) =>
    receipt.type === "project.plan-publish" &&
    receipt.actor.id === plan.publishedBy.id &&
    receipt.actor.origin === plan.publishedBy.origin &&
    Date.parse(receipt.appliedAt) === Date.parse(plan.publishedAt)
  );
  if (!matchingReceipt) {
    issue(
      issues,
      "missing_plan_receipt",
      path,
      "must be anchored by an agent project.plan-publish receipt",
    );
  }
}

function validatePlanChangeInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const changes = project.planChanges ?? [];
  if (changes.length === 0) return;
  if (!project.plan) {
    issue(
      issues,
      "missing_reference",
      "$.planChanges",
      "an appended project change requires an initial project plan",
    );
  }
  requireUnique(changes, (change) => change.id, "$.planChanges", issues);
  requireUnique(changes, (change) => change.commandId, "$.planChanges", issues);
  const phaseIds = new Set<string>();
  const workItemIds = new Set<string>();
  const decisionIds = new Set<string>();
  const phaseById = new Map(project.phases.map((phase) => [phase.id, phase]));
  const workById = new Map(project.workItems.map((item) => [item.id, item]));
  const decisionById = new Map(
    project.decisions.map((decision) => [decision.id, decision]),
  );
  const snapshots = new Set(
    project.threadSnapshots.map((snapshot) =>
      snapshotKey(snapshot.snapshotId, snapshot.revision)
    ),
  );
  changes.forEach((change, index) => {
    const path = `$.planChanges[${index}]`;
    if (project.schemaVersion === "3.0") {
      if (!change.approvedBriefBasis) {
        issue(
          issues,
          "approval_scope_mismatch",
          `${path}.approvedBriefBasis`,
          "a V3 project change must retain the exact human-approved brief revision that authorized it",
        );
      } else {
        validateApprovedBriefBasisAuthorization(
          project,
          change.approvedBriefBasis,
          `${path}.approvedBriefBasis`,
          change.publishedAt,
          issues,
        );
      }
    }
    if (change.publishedBy.origin !== "agent") {
      issue(
        issues,
        "command_authority_mismatch",
        `${path}.publishedBy.origin`,
        "only an agent may append a project change",
      );
    }
    if (Date.parse(change.publishedAt) > Date.parse(project.generatedAt)) {
      issue(
        issues,
        "invalid_chronology",
        `${path}.publishedAt`,
        "cannot be later than the project snapshot generation time",
      );
    }
    if (
      !snapshots.has(
        snapshotKey(change.baseSnapshot.snapshotId, change.baseSnapshot.revision),
      ) || change.baseSnapshot.subjectId !== project.project.subjectId
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        `${path}.baseSnapshot`,
        "must name one exact ThreadSnapshot declared by this project",
      );
    }
    if (change.phaseIds.length === 0 || change.workItemIds.length === 0) {
      issue(
        issues,
        "missing_plan_content",
        path,
        "must append at least one phase and one work item",
      );
    }
    uniqueStrings(change.phaseIds, `${path}.phaseIds`, issues);
    uniqueStrings(change.workItemIds, `${path}.workItemIds`, issues);
    uniqueStrings(change.decisionIds, `${path}.decisionIds`, issues);
    change.phaseIds.forEach((phaseId, phaseIndex) => {
      if (phaseIds.has(phaseId)) {
        issue(
          issues,
          "duplicate_id",
          `${path}.phaseIds[${phaseIndex}]`,
          "must be owned by exactly one appended project change",
        );
      }
      phaseIds.add(phaseId);
      if (!phaseById.has(phaseId)) {
        issue(
          issues,
          "missing_reference",
          `${path}.phaseIds[${phaseIndex}]`,
          "must reference a declared project phase",
        );
      }
    });
    change.workItemIds.forEach((workItemId, workItemIndex) => {
      if (workItemIds.has(workItemId)) {
        issue(
          issues,
          "duplicate_id",
          `${path}.workItemIds[${workItemIndex}]`,
          "must be owned by exactly one appended project change",
        );
      }
      workItemIds.add(workItemId);
      const workItem = workById.get(workItemId);
      if (!workItem) {
        issue(
          issues,
          "missing_reference",
          `${path}.workItemIds[${workItemIndex}]`,
          "must reference a declared project work item",
        );
      } else if (!change.phaseIds.includes(workItem.phaseId)) {
        issue(
          issues,
          "missing_reference",
          `${path}.workItemIds[${workItemIndex}]`,
          "must belong to one phase appended by the same project change",
        );
      }
    });
    change.decisionIds.forEach((decisionId, decisionIndex) => {
      if (decisionIds.has(decisionId)) {
        issue(
          issues,
          "duplicate_id",
          `${path}.decisionIds[${decisionIndex}]`,
          "must be owned by exactly one appended project change",
        );
      }
      decisionIds.add(decisionId);
      const decision = decisionById.get(decisionId);
      if (!decision) {
        issue(
          issues,
          "missing_reference",
          `${path}.decisionIds[${decisionIndex}]`,
          "must reference a declared project decision",
        );
      } else if (!change.phaseIds.includes(decision.phaseId)) {
        issue(
          issues,
          "missing_reference",
          `${path}.decisionIds[${decisionIndex}]`,
          "must belong to one phase appended by the same project change",
        );
      }
    });
    const receipt = project.commandReceipts?.find((candidate) =>
      candidate.type === "project.change-append" &&
      candidate.commandId === change.commandId &&
      candidate.actor.id === change.publishedBy.id &&
      candidate.actor.origin === change.publishedBy.origin &&
      Date.parse(candidate.appliedAt) === Date.parse(change.publishedAt) &&
      change.id === `change:${candidate.commandId}`
    );
    if (!receipt) {
      issue(
        issues,
        "missing_plan_receipt",
        path,
        "must be anchored by an agent project.change-append receipt",
      );
    }
  });
}

function validateRunBasisInvariant(
  run: EngineeringAgentRun,
  index: number,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (project.schemaVersion === "1.0") return;
  const path = `$.agentRuns[${index}]`;
  const basis = run.basis;
  if (!basis) return;
  if (basis.kind === "approved-brief") {
    const plan = project.plan;
    if (
      !plan || plan.basis.kind !== "approved-brief" ||
      !sameApprovedBriefBasis(basis, plan.basis)
    ) {
      issue(
        issues,
        "approval_scope_mismatch",
        `${path}.basis`,
        "an approved-brief run must use the exact published plan basis",
      );
    }
    const workItem = workById.get(run.workItemId);
    if (
      !workItem?.operation ||
      workItem.operation.id !== "baseline.from-approved-brief" ||
      workItem.operation.version !== "1"
    ) {
      issue(
        issues,
        "invalid_transition",
        `${path}.workItemId`,
        "an approved-brief basis is valid only for baseline.from-approved-brief@1",
      );
    }
    if (!run.resultSnapshot && project.threadSnapshots.length > 0) {
      issue(
        issues,
        "invalid_transition",
        `${path}.basis`,
        "an approved-brief run cannot remain active after its documentary ThreadSnapshot exists",
      );
    }
    return;
  }
}

function sameApprovedBriefBasis(
  left: EngineeringApprovedBriefBasis,
  right: EngineeringApprovedBriefBasis,
): boolean {
  return left.projectId === right.projectId &&
    left.projectSnapshotId === right.projectSnapshotId &&
    left.projectRevision === right.projectRevision &&
    left.briefId === right.briefId &&
    left.briefSnapshotId === right.briefSnapshotId &&
    left.briefRevision === right.briefRevision &&
    fingerprintKey(left.approvedBriefFingerprint) ===
      fingerprintKey(right.approvedBriefFingerprint);
}

function validateApprovedBriefBasisAuthorization(
  project: EngineeringProjectSnapshot,
  basis: EngineeringApprovedBriefBasis,
  path: string,
  authorizedAt: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (basis.projectId !== project.project.id) {
    issue(
      issues,
      "approval_scope_mismatch",
      `${path}.projectId`,
      "must match this engineering project",
    );
  }
  const receipt = (project.commandReceipts ?? []).find((item) =>
    item.type === "project.brief-approve" &&
    item.actor.origin === "human" &&
    item.resultingSnapshot.snapshotId === basis.projectSnapshotId &&
    item.resultingSnapshot.revision === basis.projectRevision
  );
  if (!receipt) {
    issue(
      issues,
      "approval_scope_mismatch",
      path,
      "must resolve to an exact historical human project.brief-approve receipt",
    );
    return;
  }
  if (
    !receipt.approvedBriefBasis ||
    !sameApprovedBriefBasis(receipt.approvedBriefBasis, basis)
  ) {
    issue(
      issues,
      "approval_scope_mismatch",
      path,
      "must exactly match the approved brief basis retained by its human approval receipt",
    );
    return;
  }
  if (Date.parse(receipt.appliedAt) > Date.parse(authorizedAt)) {
    issue(
      issues,
      "invalid_chronology",
      path,
      "cannot authorize work published before the historical brief approval",
    );
  }
}

function validateRunInvariant(
  run: EngineeringAgentRun,
  index: number,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.agentRuns[${index}]`;
  const workItem = workById.get(run.workItemId);
  if (!workItem) {
    issue(
      issues,
      "missing_reference",
      `${path}.workItemId`,
      "does not reference a work item",
    );
  }
  validateResolvedOperationPlanRunInvariant(
    run,
    index,
    workItem,
    project,
    issues,
  );
  validateRunBasisInvariant(run, index, workById, project, issues);
  uniqueEvidence(run.evidenceRefs, `${path}.evidenceRefs`, issues);
  uniqueStrings(
    run.waitingForDecisionIds ?? [],
    `${path}.waitingForDecisionIds`,
    issues,
  );
  uniqueStrings(
    (run.statusHistory ?? []).map((transition) => transition.commandId),
    `${path}.statusHistory`,
    issues,
  );
  const active = ["running", "waiting-for-decision", "publishing"].includes(run.status);
  const executionTerminal = ["completed", "failed"].includes(run.status);
  if (run.status === "queued" && (run.startedAt || run.completedAt)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a queued run cannot have start or completion timestamps",
    );
  }
  if (
    run.status === "queued" &&
    (run.claimedAt || run.claimedBy || run.waitingForDecisionIds ||
      run.resultSnapshot || run.failure)
  ) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a queued run cannot have claim, waiting, result or failure fields",
    );
  }
  if (active && (!run.claimedAt || !run.claimedBy)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "an active run must have an agent claim",
    );
  }
  if (active && (!run.startedAt || run.completedAt)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "an active run requires startedAt and no completedAt",
    );
  }
  if (executionTerminal && !run.completedAt) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a terminal run requires completedAt",
    );
  }
  /**
   * Annotation runs (agent-run.reconcile-annotation) go directly queued →
   * completed without a claim step, so they lack startedAt/claimedAt/claimedBy.
   * Evidence-producing runs (agent-run.complete) must still have startedAt.
   */
  if (executionTerminal && !run.annotationOnly && !run.startedAt) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a terminal non-annotation run requires startedAt",
    );
  }
  if (
    run.status === "completed" && !run.annotationOnly && run.evidenceRefs.length === 0
  ) {
    issue(
      issues,
      "missing_evidence",
      `${path}.evidenceRefs`,
      "a completed run requires exact ThreadSnapshot evidence",
    );
  }
  if (run.status === "completed" && !run.annotationOnly && !run.resultSnapshot) {
    issue(
      issues,
      "missing_evidence",
      `${path}.resultSnapshot`,
      "a completed run requires an exact result ThreadSnapshot",
    );
  }
  if (run.annotationOnly && run.status === "completed" && run.resultSnapshot) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.resultSnapshot`,
      "an annotation run must not have a result ThreadSnapshot",
    );
  }
  if (run.annotationOnly && run.status === "completed" && run.evidenceRefs.length > 0) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.evidenceRefs`,
      "an annotation run must not carry ThreadSnapshot evidence refs",
    );
  }
  if (
    run.status === "completed" && run.resultSnapshot &&
    run.evidenceRefs.some((reference) =>
      reference.snapshotId !== run.resultSnapshot?.snapshotId ||
      reference.snapshotRevision !== run.resultSnapshot?.revision
    )
  ) {
    issue(
      issues,
      "result_evidence_mismatch",
      `${path}.evidenceRefs`,
      "completed evidence must belong to the exact result ThreadSnapshot",
    );
  }
  if (run.status === "failed" && !run.failure) {
    issue(
      issues,
      "missing_failure",
      `${path}.failure`,
      "a failed run requires a structured failure",
    );
  }
  if (run.status !== "failed" && run.failure) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.failure`,
      "failure is only valid for a failed run",
    );
  }
  if (run.status === "cancelled") {
    if (!run.cancellation) {
      issue(
        issues,
        "missing_cancellation",
        `${path}.cancellation`,
        "a cancelled run requires an explicit human queued-run cancellation",
      );
    }
    if (run.cancellation?.cancelledBy.origin !== "human") {
      issue(
        issues,
        "cancellation_origin_forbidden",
        `${path}.cancellation.cancelledBy.origin`,
        "only a human origin can cancel an unclaimed queued run",
      );
    }
    if (
      run.startedAt || run.completedAt || run.claimedAt || run.claimedBy ||
      run.waitingForDecisionIds || run.resultSnapshot || run.failure ||
      run.evidenceRefs.length !== 0
    ) {
      issue(
        issues,
        "invalid_run_lifecycle",
        path,
        "a cancelled queued run cannot contain execution, result, failure or evidence fields",
      );
    }
    const history = run.statusHistory;
    const queuedTransition = history?.[0];
    const finalTransition = history?.at(-1);
    if (
      !history || history.length !== 2 || queuedTransition?.status !== "queued" ||
      Date.parse(queuedTransition.at) !== Date.parse(run.queuedAt) ||
      finalTransition?.status !== "cancelled" ||
      Date.parse(queuedTransition.at) > Date.parse(finalTransition.at)
    ) {
      issue(
        issues,
        "invalid_run_history",
        `${path}.statusHistory`,
        "a cancelled queued run must contain exactly its initial queued transition at queuedAt and its final cancelled transition",
      );
    }
    const queueReceipt = queuedTransition
      ? (project.commandReceipts ?? []).find((receipt) =>
        receipt.type === "agent-run.queue" &&
        receipt.commandId === queuedTransition.commandId
      )
      : undefined;
    if (
      !queuedTransition || !queueReceipt ||
      queueReceipt.actor.id !== queuedTransition.actor.id ||
      queueReceipt.actor.origin !== queuedTransition.actor.origin ||
      Date.parse(queueReceipt.appliedAt) !== Date.parse(run.queuedAt) ||
      Date.parse(queueReceipt.appliedAt) !== Date.parse(queuedTransition.at) ||
      (queueReceipt.queuedRun !== undefined &&
        !matchesQueuedRunReceiptBinding(run, queueReceipt))
    ) {
      issue(
        issues,
        "missing_queue_receipt",
        `${path}.statusHistory[0]`,
        "must be anchored by its exact agent-run.queue receipt at queuedAt",
      );
    }
    if (
      run.cancellation &&
      (!finalTransition || finalTransition.status !== "cancelled" ||
        Date.parse(finalTransition.at) !== Date.parse(run.cancellation.cancelledAt) ||
        finalTransition.actor.id !== run.cancellation.cancelledBy.id ||
        finalTransition.actor.origin !== run.cancellation.cancelledBy.origin)
    ) {
      issue(
        issues,
        "invalid_run_history",
        `${path}.cancellation`,
        "must exactly match the final cancelled status transition",
      );
    }
    const cancellationReceipt = run.cancellation && finalTransition
      ? (project.commandReceipts ?? []).find((receipt) =>
        receipt.type === "agent-run.cancel" &&
        receipt.commandId === finalTransition.commandId
      )
      : undefined;
    if (
      run.cancellation &&
      (!cancellationReceipt || cancellationReceipt.actor.origin !== "human" ||
        cancellationReceipt.actor.id !== run.cancellation.cancelledBy.id ||
        cancellationReceipt.actor.origin !== run.cancellation.cancelledBy.origin ||
        Date.parse(cancellationReceipt.appliedAt) !==
          Date.parse(run.cancellation.cancelledAt) ||
        Date.parse(cancellationReceipt.appliedAt) !== Date.parse(finalTransition!.at) ||
        !matchesCancelledRunReceiptBinding(run, cancellationReceipt.cancelledRun) ||
        !queueAndCancellationReceiptBindingsAgree(
          queueReceipt,
          cancellationReceipt,
        ))
    ) {
      issue(
        issues,
        "missing_cancellation_receipt",
        `${path}.cancellation`,
        "must be anchored by its exact human agent-run.cancel receipt",
      );
    }
    if (run.cancellation) {
      const expectedSummary = queuedRunCancellationSummary(
        run.cancellation.rationale,
      );
      if (run.summary !== expectedSummary) {
        issue(
          issues,
          "invalid_run_cancellation_summary",
          `${path}.summary`,
          "must be the server-derived queued-run cancellation summary",
        );
      }
      if (finalTransition?.summary !== expectedSummary) {
        issue(
          issues,
          "invalid_run_cancellation_summary",
          `${path}.statusHistory[1].summary`,
          "must be the server-derived queued-run cancellation summary",
        );
      }
    }
  } else if (run.cancellation) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.cancellation`,
      "cancellation is only valid for a cancelled queued run",
    );
  }
  if (
    run.status === "waiting-for-decision" &&
    (run.waitingForDecisionIds?.length ?? 0) === 0
  ) {
    issue(
      issues,
      "missing_decision",
      `${path}.waitingForDecisionIds`,
      "a waiting run must name at least one exact decision",
    );
  }
  if (run.status !== "waiting-for-decision" && run.waitingForDecisionIds) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.waitingForDecisionIds`,
      "waiting decision ids are only valid while waiting",
    );
  }
  if (run.statusHistory) {
    if (
      run.statusHistory.length === 0 || run.statusHistory.at(-1)?.status !== run.status
    ) {
      issue(
        issues,
        "invalid_run_history",
        `${path}.statusHistory`,
        "must end with the current run status",
      );
    }
    run.statusHistory.forEach((transition, transitionIndex) => {
      if (
        transitionIndex > 0 &&
        Date.parse(transition.at) <
          Date.parse(run.statusHistory![transitionIndex - 1].at)
      ) {
        issue(
          issues,
          "invalid_chronology",
          `${path}.statusHistory[${transitionIndex}].at`,
          "cannot precede the previous transition",
        );
      }
    });
  }
  chronological(run.queuedAt, run.startedAt, `${path}.startedAt`, issues);
  chronological(run.startedAt, run.completedAt, `${path}.completedAt`, issues);
}

/**
 * Resolved-operation-plan/2.0 is a closed persisted contract, not a marker
 * that can be dropped from a stored snapshot. The exact plan-bearing operation
 * identities require the server-stamped run and queue-receipt references;
 * every other operation, including immutable @1 history, must remain planless.
 */
function validateResolvedOperationPlanRunInvariant(
  run: EngineeringAgentRun,
  index: number,
  workItem: EngineeringWorkItem | undefined,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.agentRuns[${index}]`;
  const requiresPlan = isResolvedOperationPlanV2Operation(workItem?.operation);
  const queueCommandId = run.statusHistory?.[0]?.commandId;
  const queueReceipt = queueCommandId
    ? project.commandReceipts?.find((receipt) =>
      receipt.type === "agent-run.queue" && receipt.commandId === queueCommandId
    )
    : undefined;
  const receiptPlan = queueReceipt?.queuedRun?.resolvedOperationPlan;

  if (!requiresPlan) {
    if (run.resolvedOperationPlan !== undefined) {
      issue(
        issues,
        "unexpected_resolved_operation_plan",
        `${path}.resolvedOperationPlan`,
        "is allowed only for a closed plan-bearing operation identity",
      );
    }
    if (receiptPlan !== undefined) {
      issue(
        issues,
        "unexpected_resolved_operation_plan",
        "$.commandReceipts",
        "a queue receipt may carry a resolved operation plan only for a closed plan-bearing run",
      );
    }
    return;
  }

  if (!run.resolvedOperationPlan) {
    issue(
      issues,
      "missing_resolved_operation_plan",
      `${path}.resolvedOperationPlan`,
      "is required for a closed plan-bearing operation",
    );
  } else if (run.resolvedOperationPlan.planId !== run.id) {
    issue(
      issues,
      "invalid_resolved_operation_plan_identity",
      `${path}.resolvedOperationPlan.planId`,
      "must equal the exact persisted run id",
    );
  }
  if (!queueReceipt?.queuedRun) {
    issue(
      issues,
      "missing_resolved_operation_plan_receipt",
      `${path}.statusHistory[0]`,
      "a closed plan-bearing operation requires its exact queue receipt binding",
    );
    return;
  }
  if (
    !receiptPlan ||
    !sameOptionalResolvedPlanReference(run.resolvedOperationPlan, receiptPlan)
  ) {
    issue(
      issues,
      "invalid_resolved_operation_plan_receipt",
      `${path}.resolvedOperationPlan`,
      "must exactly match the server-stamped resolved operation plan on its queue receipt",
    );
  }
}

function isResolvedOperationPlanV2Operation(
  operation: EngineeringWorkItem["operation"],
): boolean {
  return (
    operation?.id === "verify.run-fea-static-proof" &&
    (operation.version === "2" || operation.version === "3")
  );
}

/**
 * A command receipt is globally unique, so one transition commandId must
 * belong to one agent run. This prevents copying an otherwise valid cancelled
 * history to a second work item and claiming the same queue/cancel receipts.
 * Older snapshots without transition history remain readable.
 */
function validateRunTransitionCommandUsage(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const ownerByCommandId = new Map<string, { runId: string }>();
  project.agentRuns.forEach((run, runIndex) => {
    run.statusHistory?.forEach((transition, transitionIndex) => {
      const path =
        `$.agentRuns[${runIndex}].statusHistory[${transitionIndex}].commandId`;
      const owner = ownerByCommandId.get(transition.commandId);
      if (owner && owner.runId !== run.id) {
        issue(
          issues,
          "duplicate_run_transition_command",
          path,
          `commandId ${transition.commandId} is already bound to agent run ${owner.runId}`,
        );
        return;
      }
      if (!owner) ownerByCommandId.set(transition.commandId, { runId: run.id });
    });
  });
}

function matchesQueuedRunReceiptBinding(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
): boolean {
  const queuedTransition = run.statusHistory?.[0];
  const binding = receipt.queuedRun;
  return receipt.type === "agent-run.queue" && !!binding &&
    queuedTransition?.status === "queued" &&
    receipt.commandId === queuedTransition.commandId &&
    receipt.actor.id === queuedTransition.actor.id &&
    receipt.actor.origin === queuedTransition.actor.origin &&
    Date.parse(receipt.appliedAt) === Date.parse(queuedTransition.at) &&
    binding.runId === run.id &&
    binding.workItemId === run.workItemId &&
    sameOptionalResolvedPlanReference(
      run.resolvedOperationPlan,
      binding.resolvedOperationPlan,
    );
}

function queueAndCancellationReceiptBindingsAgree(
  queueReceipt: EngineeringProjectCommandReceipt | undefined,
  cancellationReceipt: EngineeringProjectCommandReceipt,
): boolean {
  const queuedRun = queueReceipt?.queuedRun;
  if (!queuedRun) return true;
  const cancelledRun = cancellationReceipt.cancelledRun;
  return queuedRun.runId === cancelledRun?.runId &&
    queuedRun.workItemId === cancelledRun.workItemId &&
    queueReceipt.commandId === cancelledRun.queuedCommandId;
}

/**
 * New queue receipts seal their queued run, while receipts created before the
 * binding was introduced remain valid legacy history. When the field exists,
 * it is a one-to-one, actor-and-time anchor for the initial queued transition.
 */
function validateQueuedRunReceiptBindings(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const queueReceipts = (project.commandReceipts ?? []).map((receipt, index) => ({
    receipt,
    index,
  })).filter(({ receipt }) =>
    receipt.type === "agent-run.queue" && receipt.queuedRun !== undefined
  );

  queueReceipts.forEach(({ receipt, index }) => {
    const matches = project.agentRuns.filter((run) =>
      matchesQueuedRunReceiptBinding(run, receipt)
    );
    if (matches.length !== 1) {
      issue(
        issues,
        "invalid_queued_run_receipt_binding",
        `$.commandReceipts[${index}].queuedRun`,
        "must identify exactly one run and its initial queued transition",
      );
    }
  });
}

function matchesCancelledRunReceiptBinding(
  run: EngineeringAgentRun,
  binding: EngineeringCancelledRunReceiptBinding | undefined,
): boolean {
  const queuedTransition = run.statusHistory?.[0];
  return !!binding && queuedTransition?.status === "queued" &&
    binding.runId === run.id &&
    binding.workItemId === run.workItemId &&
    binding.queuedCommandId === queuedTransition.commandId;
}

function runMatchesCancellationReceipt(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
): boolean {
  return receipt.type === "agent-run.cancel" &&
    run.status === "cancelled" &&
    receipt.commandId === run.statusHistory?.at(-1)?.commandId &&
    matchesCancelledRunReceiptBinding(run, receipt.cancelledRun);
}

/**
 * A cancellation receipt is a one-to-one, server-stamped seal over its
 * cancelled run. It carries enough immutable identity to reject a copied
 * status history even when an older queue receipt has no such binding.
 */
function validateCancelledRunReceiptBindings(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const cancelledRuns = project.agentRuns.filter((run) => run.status === "cancelled");
  const cancellationReceipts = (project.commandReceipts ?? []).map((
    receipt,
    index,
  ) => ({ receipt, index })).filter(({ receipt }) =>
    receipt.type === "agent-run.cancel"
  );

  cancellationReceipts.forEach(({ receipt, index }) => {
    const matches = cancelledRuns.filter((run) =>
      runMatchesCancellationReceipt(run, receipt)
    );
    if (matches.length !== 1) {
      issue(
        issues,
        "invalid_cancellation_receipt_binding",
        `$.commandReceipts[${index}].cancelledRun`,
        "must identify exactly one cancelled run, work item and initial queued command",
      );
    }
  });

  project.agentRuns.forEach((run, index) => {
    if (run.status !== "cancelled") return;
    const matches = cancellationReceipts.filter(({ receipt }) =>
      runMatchesCancellationReceipt(run, receipt)
    );
    if (matches.length !== 1) {
      issue(
        issues,
        "missing_cancellation_receipt_binding",
        `$.agentRuns[${index}].cancellation`,
        "must be sealed by exactly one matching agent-run.cancel receipt binding",
      );
    }
  });
}

function validateDecisionInvariant(
  decision: EngineeringDecision,
  index: number,
  phaseById: ReadonlyMap<string, EngineeringProjectPhase>,
  approvalById: ReadonlyMap<string, EngineeringApproval>,
  decisions: readonly EngineeringDecision[],
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.decisions[${index}]`;
  if (!phaseById.has(decision.phaseId)) {
    issue(issues, "missing_reference", `${path}.phaseId`, "does not reference a phase");
  }
  uniqueEvidence(decision.inputEvidenceRefs, `${path}.inputEvidenceRefs`, issues);
  uniqueStrings(decision.approvalIds, `${path}.approvalIds`, issues);
  const approvals = decision.approvalIds.map((id, approvalIndex) => {
    const approval = approvalById.get(id);
    if (!approval || approval.decisionId !== decision.id) {
      issue(
        issues,
        "missing_reference",
        `${path}.approvalIds[${approvalIndex}]`,
        "must reference an approval for this decision",
      );
    }
    return approval;
  }).filter((item): item is EngineeringApproval => item !== undefined);
  const currentApproval = approvals.at(-1);

  if (decision.status === "required" && approvals.length > 0) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.approvalIds`,
      "a required decision cannot already have approvals",
    );
  }
  if (
    decision.status === "required" &&
    (decision.proposal || decision.baseSnapshot || decision.inputFingerprint)
  ) {
    issue(
      issues,
      "decision_proposal_contradiction",
      path,
      "a required decision cannot already carry a concrete proposal binding",
    );
  }
  if (
    decision.status !== "required" &&
    decision.status !== "abandoned" &&
    !decision.proposal
  ) {
    issue(
      issues,
      "missing_proposal",
      `${path}.proposal`,
      "a proposed, decided or superseded decision requires its concrete proposal",
    );
  }
  if (decision.proposal) {
    uniqueStrings(
      decision.proposal.parameters.map((parameter) => parameter.key),
      `${path}.proposal.parameters`,
      issues,
    );
  }
  if (
    decision.status === "proposed" &&
    currentApproval?.status !== "pending"
  ) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.status`,
      "a proposed decision requires a pending approval",
    );
  }
  if (
    decision.status === "approved" &&
    currentApproval?.status !== "approved"
  ) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.status`,
      "an approved decision requires an approved approval",
    );
  }
  if (
    decision.status === "rejected" &&
    currentApproval?.status !== "rejected"
  ) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.status`,
      "a rejected decision requires a rejected approval",
    );
  }
  if (
    decision.status === "superseded" &&
    !decisions.some((candidate) =>
      candidate.supersedesDecisionId === decision.id ||
      decision.supersededByDecisionId === candidate.id
    )
  ) {
    issue(
      issues,
      "missing_superseding_decision",
      `${path}.status`,
      "no decision supersedes this decision",
    );
  }
  if (decision.supersedesDecisionId === decision.id) {
    issue(
      issues,
      "self_reference",
      `${path}.supersedesDecisionId`,
      "cannot reference itself",
    );
  }
  if (decision.supersededByDecisionId === decision.id) {
    issue(
      issues,
      "self_reference",
      `${path}.supersededByDecisionId`,
      "cannot reference itself",
    );
  }
  if (decision.supersededByDecisionId !== undefined) {
    const successor = decisions.find((candidate) =>
      candidate.id === decision.supersededByDecisionId
    );
    if (!successor || successor.status !== "approved") {
      issue(
        issues,
        "missing_superseding_decision",
        `${path}.supersededByDecisionId`,
        "must reference an approved successor decision",
      );
    }
  }
}

function validateApprovalInvariant(
  approval: EngineeringApproval,
  index: number,
  decisionById: ReadonlyMap<string, EngineeringDecision>,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.approvals[${index}]`;
  const decision = decisionById.get(approval.decisionId);
  if (!decision || !decision.approvalIds.includes(approval.id)) {
    issue(
      issues,
      "missing_reference",
      `${path}.decisionId`,
      "must reference a reciprocal decision",
    );
    return;
  }
  uniqueEvidence(approval.inputEvidenceRefs, `${path}.inputEvidenceRefs`, issues);
  const isCurrentApproval = decision.approvalIds.at(-1) === approval.id;
  if (isCurrentApproval) {
    if (!sameEvidenceSet(approval.inputEvidenceRefs, decision.inputEvidenceRefs)) {
      issue(
        issues,
        "approval_input_mismatch",
        `${path}.inputEvidenceRefs`,
        "the current approval must exactly match the decision evidence inputs",
      );
    }
    if (!sameExecutionBinding(approval, decision)) {
      issue(
        issues,
        "approval_input_mismatch",
        path,
        "the current approval binding must exactly match the decision",
      );
    }
  } else if (approval.status === "pending") {
    issue(
      issues,
      "stale_pending_approval",
      `${path}.status`,
      "a historical approval cannot remain pending after a newer proposal",
    );
  }
  if (approval.status === "pending") {
    if (
      approval.decidedAt || approval.decidedBy || approval.rationale ||
      approval.decidedByOrigin
    ) {
      issue(
        issues,
        "approval_lifecycle_contradiction",
        path,
        "a pending approval cannot have decision fields",
      );
    }
  } else if (
    !approval.decidedAt || !approval.decidedBy || !approval.rationale ||
    !approval.decidedByOrigin
  ) {
    issue(
      issues,
      "approval_lifecycle_contradiction",
      path,
      "a decided approval requires decidedAt, decidedBy and rationale",
    );
  }
  if (approval.decidedByOrigin && approval.decidedByOrigin !== "human") {
    issue(
      issues,
      "approval_origin_forbidden",
      `${path}.decidedByOrigin`,
      "only a human origin can approve or reject a decision",
    );
  }
  chronological(approval.requestedAt, approval.decidedAt, `${path}.decidedAt`, issues);
}

function validateCommandReceiptInvariant(
  receipt: EngineeringProjectCommandReceipt,
  index: number,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.commandReceipts[${index}]`;
  if (
    receipt.approvedBriefBasis !== undefined &&
    receipt.type !== "project.brief-approve"
  ) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.approvedBriefBasis`,
      "is permitted only on a project.brief-approve receipt",
    );
  }
  if (
    receipt.cancelledRun !== undefined &&
    receipt.type !== "agent-run.cancel"
  ) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.cancelledRun`,
      "is permitted only on an agent-run.cancel receipt",
    );
  }
  if (
    receipt.queuedRun !== undefined &&
    receipt.type !== "agent-run.queue"
  ) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.queuedRun`,
      "is permitted only on an agent-run.queue receipt",
    );
  }
  if (
    receipt.type === "agent-run.cancel" &&
    receipt.cancelledRun === undefined
  ) {
    issue(
      issues,
      "missing_cancellation_receipt_binding",
      `${path}.cancelledRun`,
      "is required for every agent-run.cancel receipt",
    );
  }
  if (
    project.schemaVersion === "3.0" &&
    receipt.type === "project.brief-approve" &&
    receipt.approvedBriefBasis === undefined
  ) {
    issue(
      issues,
      "approval_scope_mismatch",
      `${path}.approvedBriefBasis`,
      "is required for every V3 human brief approval",
    );
  }
  if (receipt.approvedBriefBasis) {
    const basis = receipt.approvedBriefBasis;
    if (
      basis.projectId !== project.project.id ||
      basis.projectSnapshotId !== receipt.resultingSnapshot.snapshotId ||
      basis.projectRevision !== receipt.resultingSnapshot.revision
    ) {
      issue(
        issues,
        "approval_scope_mismatch",
        `${path}.approvedBriefBasis`,
        "must identify this project and the exact snapshot created by the approval receipt",
      );
    }
    const framing = project.framing;
    const brief = framing?.currentBrief;
    const approval = framing?.currentBriefApproval;
    if (
      brief && approval?.status === "approved" && approval.decidedAt &&
      Date.parse(approval.decidedAt) === Date.parse(receipt.appliedAt) &&
      approval.decidedBy?.id === receipt.actor.id &&
      approval.decidedBy.origin === receipt.actor.origin
    ) {
      const expected: EngineeringApprovedBriefBasis = {
        kind: "approved-brief",
        projectId: project.project.id,
        projectSnapshotId: receipt.resultingSnapshot.snapshotId,
        projectRevision: receipt.resultingSnapshot.revision,
        briefId: brief.briefId,
        briefSnapshotId: brief.id,
        briefRevision: brief.revision,
        approvedBriefFingerprint: approval.inputFingerprint,
      };
      if (!sameApprovedBriefBasis(basis, expected)) {
        issue(
          issues,
          "approval_scope_mismatch",
          `${path}.approvedBriefBasis`,
          "must exactly describe the canonical brief approved by this receipt",
        );
      }
    }
  }
  const firstCommandRevision = project.schemaVersion === "3.0" ? 1 : 2;
  if (
    receipt.resultingSnapshot.revision < firstCommandRevision ||
    receipt.resultingSnapshot.revision > project.revision
  ) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.revision`,
      "must address a command-created revision in this project history",
    );
  }
  if (
    receipt.resultingSnapshot.revision === project.revision &&
    receipt.resultingSnapshot.snapshotId !== project.id
  ) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.snapshotId`,
      "must match the current snapshot id for the current revision",
    );
  }
  if (receipt.resultingSnapshot.revision !== index + firstCommandRevision) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.revision`,
      `must equal command revision ${index + firstCommandRevision}`,
    );
  }
  const isProjectStart = project.schemaVersion === "3.0" && index === 0;
  if (isProjectStart && receipt.type !== "project.start") {
    issue(
      issues,
      "invalid_project_start_receipt",
      `${path}.type`,
      "the first V3 receipt must create the project from its reported intent",
    );
  }
  if (!isProjectStart && receipt.type === "project.start") {
    issue(
      issues,
      "invalid_project_start_receipt",
      `${path}.type`,
      "project.start is valid only for the first V3 revision",
    );
  }
  if (
    (receipt.type === "project.plan-publish" ||
      receipt.type === "project.change-append" ||
      receipt.type === "work-item.reconcile-successor" ||
      receipt.type === "project.question-propose" ||
      receipt.type === "project.brief-propose") &&
    receipt.actor.origin !== "agent"
  ) {
    issue(
      issues,
      "command_authority_mismatch",
      `${path}.actor.origin`,
      `${receipt.type} requires agent authority`,
    );
  }
  if (
    (receipt.type === "project.brief-approve" ||
      receipt.type === "project.brief-reject" ||
      receipt.type === "agent-run.cancel") &&
    receipt.actor.origin !== "human"
  ) {
    issue(
      issues,
      "command_authority_mismatch",
      `${path}.actor.origin`,
      `${receipt.type} requires human authority`,
    );
  }
  if (
    isProjectStart && project.revision === 1 &&
    Date.parse(receipt.appliedAt) !== Date.parse(project.generatedAt)
  ) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.appliedAt`,
      "must equal the initial project snapshot generation time",
    );
  }
  if (
    isProjectStart &&
    Date.parse(receipt.issuedAt) > Date.parse(receipt.appliedAt)
  ) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.issuedAt`,
      "cannot be later than the authoritative command application time",
    );
  }
  const previous = project.commandReceipts?.[index - 1];
  if (previous && Date.parse(receipt.appliedAt) < Date.parse(previous.appliedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.appliedAt`,
      "cannot precede the previous command application time",
    );
  }
  if (Date.parse(receipt.appliedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.appliedAt`,
      "cannot be later than the project snapshot generation time",
    );
  }
}

function validateBlockerInvariant(
  blocker: EngineeringBlocker,
  index: number,
  phaseById: ReadonlyMap<string, EngineeringProjectPhase>,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  decisionById: ReadonlyMap<string, EngineeringDecision>,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.blockers[${index}]`;
  if (!phaseById.has(blocker.phaseId)) {
    issue(issues, "missing_reference", `${path}.phaseId`, "does not reference a phase");
  }
  uniqueStrings(blocker.workItemIds, `${path}.workItemIds`, issues);
  uniqueStrings(blocker.decisionIds, `${path}.decisionIds`, issues);
  if (blocker.workItemIds.length === 0) {
    issue(
      issues,
      "unscoped_blocker",
      `${path}.workItemIds`,
      "must block at least one work item",
    );
  }
  blocker.workItemIds.forEach((id, workIndex) => {
    const item = workById.get(id);
    if (
      !item || item.phaseId !== blocker.phaseId || !item.blockerIds.includes(blocker.id)
    ) {
      issue(
        issues,
        "missing_reference",
        `${path}.workItemIds[${workIndex}]`,
        "must reference a reciprocal work item in the same phase",
      );
    }
  });
  blocker.decisionIds.forEach((id, decisionIndex) => {
    const decision = decisionById.get(id);
    if (!decision || decision.phaseId !== blocker.phaseId) {
      issue(
        issues,
        "missing_reference",
        `${path}.decisionIds[${decisionIndex}]`,
        "must reference a decision in the same phase",
      );
    }
  });
  if (blocker.status === "open" && (blocker.resolvedAt || blocker.resolution)) {
    issue(
      issues,
      "blocker_lifecycle_contradiction",
      path,
      "an open blocker cannot have resolution fields",
    );
  }
  if (blocker.status === "resolved" && (!blocker.resolvedAt || !blocker.resolution)) {
    issue(
      issues,
      "blocker_lifecycle_contradiction",
      path,
      "a resolved blocker requires resolvedAt and resolution",
    );
  }
  chronological(blocker.openedAt, blocker.resolvedAt, `${path}.resolvedAt`, issues);
}

function allEvidenceRefs(
  project: EngineeringProjectSnapshot,
): Array<{ reference: EngineeringThreadEntityRef; path: string }> {
  const result: Array<{ reference: EngineeringThreadEntityRef; path: string }> = [];
  const add = (references: readonly EngineeringThreadEntityRef[], path: string) => {
    references.forEach((reference, index) =>
      result.push({ reference, path: `${path}[${index}]` })
    );
  };
  project.phases.forEach((item, index) =>
    add(item.evidenceRefs, `$.phases[${index}].evidenceRefs`)
  );
  project.workItems.forEach((item, index) =>
    add(item.evidenceRefs, `$.workItems[${index}].evidenceRefs`)
  );
  project.workItems.forEach((item, index) => {
    if (!item.reconciliation) return;
    add(
      item.reconciliation.successorEvidenceRefs,
      `$.workItems[${index}].reconciliation.successorEvidenceRefs`,
    );
  });
  project.agentRuns.forEach((item, index) =>
    add(item.evidenceRefs, `$.agentRuns[${index}].evidenceRefs`)
  );
  project.decisions.forEach((item, index) =>
    add(item.inputEvidenceRefs, `$.decisions[${index}].inputEvidenceRefs`)
  );
  project.approvals.forEach((item, index) =>
    add(item.inputEvidenceRefs, `$.approvals[${index}].inputEvidenceRefs`)
  );
  return result;
}

function operationThreadEntityRefs(
  project: EngineeringProjectSnapshot,
): Array<{ reference: EngineeringThreadEntityRef; path: string }> {
  const result: Array<{ reference: EngineeringThreadEntityRef; path: string }> = [];
  project.workItems.forEach((item, workItemIndex) => {
    item.operation?.bindings.forEach((binding, bindingIndex) => {
      if (binding.source.kind !== "thread-entity") return;
      result.push({
        reference: binding.source.reference,
        path:
          `$.workItems[${workItemIndex}].operation.bindings[${bindingIndex}].source.reference`,
      });
    });
  });
  return result;
}

function executionBindings(
  project: EngineeringProjectSnapshot,
): Array<{ baseSnapshot: EngineeringThreadSnapshotRef; path: string }> {
  const result: Array<{ baseSnapshot: EngineeringThreadSnapshotRef; path: string }> =
    [];
  project.agentRuns.forEach((item, index) => {
    if (item.baseSnapshot) {
      result.push({
        baseSnapshot: item.baseSnapshot,
        path: `$.agentRuns[${index}].baseSnapshot`,
      });
    }
    if (item.basis?.kind === "thread-snapshot") {
      result.push({
        baseSnapshot: item.basis,
        path: `$.agentRuns[${index}].basis`,
      });
    }
  });
  project.decisions.forEach((item, index) => {
    if (item.baseSnapshot) {
      result.push({
        baseSnapshot: item.baseSnapshot,
        path: `$.decisions[${index}].baseSnapshot`,
      });
    }
  });
  project.approvals.forEach((item, index) => {
    if (item.baseSnapshot) {
      result.push({
        baseSnapshot: item.baseSnapshot,
        path: `$.approvals[${index}].baseSnapshot`,
      });
    }
  });
  return result;
}

function threadEntityExists(
  snapshot: ThreadSnapshot,
  reference: EngineeringThreadEntityRef,
): boolean {
  const ids = (items: readonly { id: string }[]) =>
    items.some((item) => item.id === reference.id);
  switch (reference.kind) {
    case "artifact":
      return ids(snapshot.artifacts);
    case "consumption":
      return ids(snapshot.consumptions);
    case "observation":
      return ids(snapshot.observations);
    case "requirement":
      return ids(snapshot.requirements);
    case "evaluation":
      return ids(snapshot.evaluations);
    case "violation":
      return ids(snapshot.violations);
    case "change":
      return ids(snapshot.changeSet.changes);
    case "action":
      return ids(snapshot.proposedActions);
  }
}

function detectWorkCycles(
  workItems: readonly EngineeringWorkItem[],
  issues: EngineeringProjectValidationIssue[],
): void {
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle =
      byId.get(id)?.dependsOnWorkItemIds.some((dependency) =>
        byId.has(dependency) && visit(dependency)
      ) ?? false;
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  workItems.forEach((item, index) => {
    if (visit(item.id)) {
      issue(
        issues,
        "dependency_cycle",
        `$.workItems[${index}].dependsOnWorkItemIds`,
        "participates in a dependency cycle",
      );
    }
  });
}

function sameExecutionBinding(
  left: Pick<EngineeringApproval, "baseSnapshot" | "inputFingerprint">,
  right: Pick<EngineeringDecision, "baseSnapshot" | "inputFingerprint">,
): boolean {
  return JSON.stringify(left.baseSnapshot) === JSON.stringify(right.baseSnapshot) &&
    fingerprintKey(left.inputFingerprint) === fingerprintKey(right.inputFingerprint);
}

function fingerprintKey(value: ContentFingerprint | undefined): string {
  return value ? `${value.algorithm}:${value.digest.toLowerCase()}` : "";
}

function sameEvidenceSet(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return sameStringSet(left.map(evidenceKey), right.map(evidenceKey));
}

function sameSnapshotRef(
  left: EngineeringThreadSnapshotRef,
  right: EngineeringThreadSnapshotRef,
): boolean {
  return left.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value));
}

function uniqueEvidence(
  values: readonly EngineeringThreadEntityRef[],
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  uniqueStrings(values.map(evidenceKey), path, issues);
}

function evidenceKey(reference: EngineeringThreadEntityRef): string {
  return `${
    snapshotKey(reference.snapshotId, reference.snapshotRevision)
  }\u0000${reference.kind}\u0000${reference.id}`;
}

function snapshotKey(id: string, revision: number): string {
  return `${id}\u0000${revision}`;
}

function requireUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const candidate = key(value);
    if (seen.has(candidate)) {
      issue(issues, "duplicate_id", `${path}[${index}].id`, "must be unique");
    }
    seen.add(candidate);
  });
}

function uniqueStrings(
  values: readonly string[],
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issue(issues, "duplicate_reference", `${path}[${index}]`, "must be unique");
    }
    seen.add(value);
  });
}

function chronological(
  before: string | undefined,
  after: string | undefined,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (before && after && Date.parse(after) < Date.parse(before)) {
    issue(
      issues,
      "invalid_chronology",
      path,
      "cannot precede the prior lifecycle timestamp",
    );
  }
}

function validateArray(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  validate: (
    value: unknown,
    path: string,
    issues: EngineeringProjectValidationIssue[],
  ) => void,
): void {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_array", path, "must be an array");
    return;
  }
  value.forEach((item, index) => validate(item, `${path}[${index}]`, issues));
}

function stringArray(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_array", path, "must be an array");
    return;
  }
  value.forEach((item, index) => nonEmptyString(item, `${path}[${index}]`, issues));
}

function exactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: EngineeringProjectValidationIssue[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issue(issues, "invalid_object", path, "must be an object");
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  required.forEach((key) => {
    if (!(key in input)) {
      issue(issues, "missing_property", `${path}.${key}`, "is required");
    }
  });
  Object.keys(input).forEach((key) => {
    if (!allowed.has(key)) {
      issue(
        issues,
        "unknown_property",
        `${path}.${key}`,
        "is not allowed by schema 1.0",
      );
    }
  });
  return input;
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    issue(issues, "invalid_string", path, "must be a non-empty string");
    return false;
  }
  return true;
}

function optionalNonEmptyString(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (value !== undefined) nonEmptyString(value, path, issues);
}

function positiveInteger(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    issue(issues, "invalid_integer", path, "must be a positive integer");
  }
}

function isoDateTime(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) issue(issues, "invalid_datetime", path, "must be an ISO 8601 UTC timestamp");
}

function optionalIsoDateTime(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (value !== undefined) isoDateTime(value, path, issues);
}

function literal(
  value: unknown,
  expected: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (value !== expected) {
    issue(issues, "invalid_literal", path, `must equal ${String(expected)}`);
  }
}

function oneOf(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issue(issues, "invalid_enum", path, `must be one of ${allowed.join(", ")}`);
  }
}

function validateJson(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  ancestors: Set<object>,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(issues, "not_json", path, "must be a finite JSON number");
    }
    return;
  }
  if (typeof value !== "object") {
    issue(issues, "not_json", path, "must contain only JSON values");
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    issue(issues, "not_json", path, "must be a plain JSON object");
    return;
  }
  if (ancestors.has(value)) {
    issue(issues, "not_json", path, "must not contain cycles");
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJson(item, `${path}[${index}]`, issues, ancestors)
    );
  } else {
    Object.entries(value).forEach(([key, item]) =>
      validateJson(item, `${path}.${key}`, issues, ancestors)
    );
  }
  ancestors.delete(value);
}

function issue(
  issues: EngineeringProjectValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateResolvedPlanReference(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  try {
    validateResolvedOperationPlanRef(value);
  } catch (error) {
    issue(
      issues,
      "invalid_resolved_operation_plan_ref",
      path,
      error instanceof Error
        ? error.message
        : "must be an exact resolved operation plan reference",
    );
  }
}

function sameOptionalResolvedPlanReference(
  left: EngineeringAgentRun["resolvedOperationPlan"],
  right: EngineeringAgentRun["resolvedOperationPlan"],
): boolean {
  return left === undefined && right === undefined ||
    sameResolvedOperationPlanRef(left, right);
}

function issueWithRecovery(
  issues: EngineeringProjectValidationIssue[],
  code: string,
  path: string,
  message: string,
  context: Readonly<Record<string, string | number | boolean>>,
  recovery: string,
): void {
  issues.push({ code, path, message, context, recovery });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
