import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringBlocker,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectPhase,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "./engineering-project.ts";
import type { ContentFingerprint, ThreadSnapshot } from "./thread-snapshot.ts";

export interface EngineeringProjectValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
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
    ["previous", "commandReceipts"],
    issues,
  );
  if (!root) return issues;

  literal(root.schemaVersion, "1.0", "$.schemaVersion", issues);
  nonEmptyString(root.id, "$.id", issues);
  positiveInteger(root.revision, "$.revision", issues);
  isoDateTime(root.generatedAt, "$.generatedAt", issues);
  if (root.previous !== undefined) {
    validatePrevious(root.previous, "$.previous", issues);
  }
  validateProjectIdentity(root.project, "$.project", issues);
  validateArray(root.threadSnapshots, "$.threadSnapshots", issues, validateSnapshotRef);
  validateArray(root.phases, "$.phases", issues, validatePhase);
  validateArray(root.workItems, "$.workItems", issues, validateWorkItem);
  validateArray(root.agentRuns, "$.agentRuns", issues, validateAgentRun);
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
    [],
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
    ],
    `${path}.status`,
    issues,
  );
  oneOf(input.owner, ["human", "agent", "shared"], `${path}.owner`, issues);
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

function validateAgentRun(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
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
      "baseSnapshot",
      "inputFingerprint",
      "waitingForDecisionIds",
      "resultSnapshot",
      "failure",
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
  validateExecutionBinding(input, path, issues);
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
    ["supersedesDecisionId", "baseSnapshot", "inputFingerprint", "proposal"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.phaseId, `${path}.phaseId`, issues);
  nonEmptyString(input.title, `${path}.title`, issues);
  nonEmptyString(input.question, `${path}.question`, issues);
  oneOf(
    input.status,
    ["required", "proposed", "approved", "rejected", "superseded"],
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
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.commandId, `${path}.commandId`, issues);
  oneOf(
    input.type,
    [
      "decision.propose",
      "decision.approve",
      "decision.reject",
      "agent-run.queue",
      "agent-run.claim",
      "agent-run.progress",
      "agent-run.publish",
      "agent-run.complete",
      "agent-run.fail",
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
  if (
    project.revision > 1 &&
    (project.commandReceipts?.length ?? 0) !== project.revision - 1
  ) {
    issue(
      issues,
      "incomplete_command_history",
      "$.commandReceipts",
      "must contain exactly one durable receipt for every command-created revision",
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

  if (project.threadSnapshots.length === 0) {
    issue(
      issues,
      "missing_thread_snapshot",
      "$.threadSnapshots",
      "must declare at least one exact ThreadSnapshot revision",
    );
  }
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
    if (item.status === "completed" && item.evidenceRefs.length === 0) {
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
      const dependenciesCompleted = item.dependsOnWorkItemIds.every((id) =>
        workById.get(id)?.status === "completed"
      );
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
  detectWorkCycles(project.workItems, issues);

  project.agentRuns.forEach((run, index) =>
    validateRunInvariant(run, index, workById, issues)
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
  project.blockers.forEach((blocker, index) =>
    validateBlockerInvariant(blocker, index, phaseById, workById, decisionById, issues)
  );
  (project.commandReceipts ?? []).forEach((receipt, index) =>
    validateCommandReceiptInvariant(receipt, index, project, issues)
  );
}

function validateRunInvariant(
  run: EngineeringAgentRun,
  index: number,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.agentRuns[${index}]`;
  if (!workById.has(run.workItemId)) {
    issue(
      issues,
      "missing_reference",
      `${path}.workItemId`,
      "does not reference a work item",
    );
  }
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
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
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
  if (terminal && (!run.startedAt || !run.completedAt)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a terminal run requires startedAt and completedAt",
    );
  }
  if (run.status === "completed" && run.evidenceRefs.length === 0) {
    issue(
      issues,
      "missing_evidence",
      `${path}.evidenceRefs`,
      "a completed run requires exact ThreadSnapshot evidence",
    );
  }
  if (run.status === "completed" && !run.resultSnapshot) {
    issue(
      issues,
      "missing_evidence",
      `${path}.resultSnapshot`,
      "a completed run requires an exact result ThreadSnapshot",
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
  if (decision.status !== "required" && !decision.proposal) {
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
    !decisions.some((candidate) => candidate.supersedesDecisionId === decision.id)
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
    receipt.resultingSnapshot.revision < 2 ||
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
  if (receipt.resultingSnapshot.revision !== index + 2) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.revision`,
      `must equal command revision ${index + 2}`,
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

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
