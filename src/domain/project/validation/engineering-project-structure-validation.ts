import type { EngineeringProjectSchemaVersion } from "../engineering-project.ts";
import { ENGINEERING_PROJECT_SCHEMA_VERSION } from "../engineering-project.ts";
import { validateResolvedOperationPlanRef } from "../../compile/rop/resolved-operation-plan-v2.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue, issueWithRecovery } from "./engineering-project-validation-issue.ts";
import {
  exactRecord,
  isoDateTime,
  literal,
  nonEmptyString,
  oneOf,
  optionalIsoDateTime,
  optionalNonEmptyString,
  positiveInteger,
  stringArray,
  uniqueStrings,
  validateArray,
  validateJson,
} from "./engineering-project-value-validation.ts";
import { safeId, safeVersion } from "../../kernel/case-validation.ts";

/**
 * Exact JSON-shape walk of one project snapshot. Graph invariants stay on the
 * public facade so this lot does not move business rules.
 */
export function collectEngineeringProjectStructureIssues(
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
  if (value === ENGINEERING_PROJECT_SCHEMA_VERSION) return value;
  issue(
    issues,
    "invalid_enum",
    path,
    `must be ${ENGINEERING_PROJECT_SCHEMA_VERSION}`,
  );
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
      ? ["owner", "reviewTrigger", "dependsOnItemIds", "verificationAuthority"]
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
  } else if (hasDependencyDeclaration) {
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
  const hasVerificationAuthority = Object.hasOwn(
    input,
    "verificationAuthority",
  );
  if (hasVerificationAuthority && input.kind !== "verification-activity") {
    issueWithRecovery(
      issues,
      "invalid_verification_authority_owner",
      `${path}.verificationAuthority`,
      "only a verification-activity may declare a verification authority",
      { itemKind: typeof input.kind === "string" ? input.kind : "" },
      "Move verificationAuthority to the verification activity it qualifies.",
    );
  }
  if (hasVerificationAuthority) {
    validateVerificationAuthority(
      input.verificationAuthority,
      `${path}.verificationAuthority`,
      issues,
    );
  }
}

function validateVerificationAuthority(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const input = exactRecord(value, path, ["id", "version"], [], issues);
  if (!input) return;
  try {
    safeId(input.id, `${path}.id`);
  } catch {
    issue(
      issues,
      "invalid_verification_authority_id",
      `${path}.id`,
      "must be a stable authority identifier",
    );
  }
  try {
    safeVersion(input.version, `${path}.version`);
  } catch {
    issue(
      issues,
      "invalid_verification_authority_version",
      `${path}.version`,
      "must be a safe authority version",
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
  if (schemaVersion === ENGINEERING_PROJECT_SCHEMA_VERSION) {
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
      "activityId",
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
    ["predecessorRevisionId", "operation", "gateClaims", "reconciliation"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.activityId, `${path}.activityId`, issues);
  if (input.predecessorRevisionId !== undefined) {
    nonEmptyString(
      input.predecessorRevisionId,
      `${path}.predecessorRevisionId`,
      issues,
    );
  }
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
      "impact-decision.accept",
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

  if (hasBase) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.baseSnapshot`,
      "is a retired execution field and cannot appear in a current-schema run",
    );
  }
  if (!hasBasis || !hasFingerprint) {
    issue(
      issues,
      "incomplete_execution_binding",
      path,
      "a current-schema run requires both basis and inputFingerprint",
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
