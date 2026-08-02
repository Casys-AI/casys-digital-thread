import type {
  ProjectDiscoveryAnswer,
  ProjectDiscoverySnapshot,
} from "./project-discovery.ts";

export interface ProjectDiscoveryValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class ProjectDiscoveryValidationError extends Error {
  readonly issues: readonly ProjectDiscoveryValidationIssue[];

  constructor(issues: readonly ProjectDiscoveryValidationIssue[]) {
    super(
      `Invalid ProjectDiscoverySnapshot: ${
        issues.map((item) => `${item.path}: ${item.message}`).join("; ")
      }`,
    );
    this.name = "ProjectDiscoveryValidationError";
    this.issues = issues;
  }
}

/** Validate, clone and recursively freeze untrusted discovery state. */
export function validateProjectDiscoverySnapshot(
  value: unknown,
): ProjectDiscoverySnapshot {
  const issues = collectProjectDiscoveryIssues(value);
  if (issues.length > 0) throw new ProjectDiscoveryValidationError(issues);
  return deepFreeze(structuredClone(value)) as ProjectDiscoverySnapshot;
}

export const createProjectDiscoverySnapshot = validateProjectDiscoverySnapshot;

export function collectProjectDiscoveryIssues(
  value: unknown,
): ProjectDiscoveryValidationIssue[] {
  const issues: ProjectDiscoveryValidationIssue[] = [];
  validateJson(value, "$", issues, new Set());
  const root = exactRecord(
    value,
    "$",
    [
      "schemaVersion",
      "id",
      "discoveryId",
      "revision",
      "generatedAt",
      "status",
      "intent",
      "questions",
      "answers",
      "commandReceipts",
    ],
    ["previous", "brief", "review"],
    issues,
  );
  if (!root) return issues;

  literal(root.schemaVersion, "1.0", "$.schemaVersion", issues);
  nonEmptyString(root.id, "$.id", issues);
  safeId(root.discoveryId, "$.discoveryId", issues);
  positiveInteger(root.revision, "$.revision", issues);
  isoDateTime(root.generatedAt, "$.generatedAt", issues);
  oneOf(
    root.status,
    ["discovering", "awaiting-review", "revision-requested", "approved"],
    "$.status",
    issues,
  );
  if (root.previous !== undefined) {
    validatePrevious(root.previous, "$.previous", issues);
  }
  validateIntent(root.intent, "$.intent", issues);
  validateArray(root.questions, "$.questions", issues, validateQuestion);
  validateArray(root.answers, "$.answers", issues, validateAnswer);
  if (root.brief !== undefined) validateBrief(root.brief, "$.brief", issues);
  if (root.review !== undefined) validateReview(root.review, "$.review", issues);
  validateArray(
    root.commandReceipts,
    "$.commandReceipts",
    issues,
    validateReceipt,
  );

  if (issues.length === 0) {
    validateInvariants(value as ProjectDiscoverySnapshot, issues);
  }
  return issues;
}

function validatePrevious(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(value, path, ["snapshotId", "revision"], [], issues);
  if (!input) return;
  nonEmptyString(input.snapshotId, `${path}.snapshotId`, issues);
  positiveInteger(input.revision, `${path}.revision`, issues);
}

function validateIntent(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["statement", "capturedAt", "capturedBy"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.statement, `${path}.statement`, issues);
  isoDateTime(input.capturedAt, `${path}.capturedAt`, issues);
  validateActor(input.capturedBy, `${path}.capturedBy`, issues);
}

function validateActor(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(value, path, ["id", "origin"], [], issues);
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  oneOf(input.origin, ["human", "agent"], `${path}.origin`, issues);
}

function validateQuestion(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
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
  validateRecommendation(input.recommendation, `${path}.recommendation`, issues);
  validateArray(input.options, `${path}.options`, issues, validateOption, true);
  boolean(input.allowUnknown, `${path}.allowUnknown`, issues);
  oneOf(
    input.risk,
    ["reversible", "material", "safety-critical", "regulatory"],
    `${path}.risk`,
    issues,
  );
  stringArray(input.evidenceNeeded, `${path}.evidenceNeeded`, issues);
  isoDateTime(input.proposedAt, `${path}.proposedAt`, issues);
  validateActor(input.proposedBy, `${path}.proposedBy`, issues);
}

function validateRecommendation(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["value", "rationale", "confidence"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.value, `${path}.value`, issues);
  nonEmptyString(input.rationale, `${path}.rationale`, issues);
  oneOf(input.confidence, ["low", "medium", "high"], `${path}.confidence`, issues);
}

function validateOption(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["value", "label", "consequences"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.value, `${path}.value`, issues);
  nonEmptyString(input.label, `${path}.label`, issues);
  nonEmptyString(input.consequences, `${path}.consequences`, issues);
}

function validateAnswer(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
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
    issue(issues, "unknown_has_value", `${path}.value`, "must be absent for unknown");
  }
  if (input.explanation !== undefined) {
    nonEmptyString(input.explanation, `${path}.explanation`, issues);
  }
  if (input.supersedesAnswerId !== undefined) {
    nonEmptyString(
      input.supersedesAnswerId,
      `${path}.supersedesAnswerId`,
      issues,
    );
  }
  validateAnswerSource(input.source, `${path}.source`, issues);
  isoDateTime(input.recordedAt, `${path}.recordedAt`, issues);
  validateActor(input.recordedBy, `${path}.recordedBy`, issues);
}

function validateAnswerSource(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(value, path, ["kind", "reference"], [], issues);
  if (!input) return;
  oneOf(
    input.kind,
    ["human", "tool", "document", "expert"],
    `${path}.kind`,
    issues,
  );
  nonEmptyString(input.reference, `${path}.reference`, issues);
}

function validateBrief(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "objective",
      "missionScenarios",
      "successCriteria",
      "constraints",
      "intendedMarkets",
      "manufacturingJurisdictions",
      "operatingJurisdictions",
      "complianceTargets",
      "verificationPlan",
      "exclusions",
      "assumptions",
      "openQuestions",
      "proposedAt",
      "proposedBy",
    ],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.objective, `${path}.objective`, issues);
  stringArray(input.missionScenarios, `${path}.missionScenarios`, issues, true);
  stringArray(input.successCriteria, `${path}.successCriteria`, issues, true);
  stringArray(input.constraints, `${path}.constraints`, issues);
  stringArray(input.intendedMarkets, `${path}.intendedMarkets`, issues);
  stringArray(
    input.manufacturingJurisdictions,
    `${path}.manufacturingJurisdictions`,
    issues,
  );
  stringArray(
    input.operatingJurisdictions,
    `${path}.operatingJurisdictions`,
    issues,
  );
  stringArray(input.complianceTargets, `${path}.complianceTargets`, issues);
  stringArray(input.verificationPlan, `${path}.verificationPlan`, issues);
  stringArray(input.exclusions, `${path}.exclusions`, issues);
  stringArray(input.assumptions, `${path}.assumptions`, issues);
  stringArray(input.openQuestions, `${path}.openQuestions`, issues);
  isoDateTime(input.proposedAt, `${path}.proposedAt`, issues);
  validateActor(input.proposedBy, `${path}.proposedBy`, issues);
}

function validateReview(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["briefId", "status", "inputFingerprint", "requestedAt"],
    ["decidedAt", "decidedBy", "rationale"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.briefId, `${path}.briefId`, issues);
  oneOf(input.status, ["pending", "approved", "rejected"], `${path}.status`, issues);
  validateFingerprint(input.inputFingerprint, `${path}.inputFingerprint`, issues);
  isoDateTime(input.requestedAt, `${path}.requestedAt`, issues);
  if (input.decidedAt !== undefined) {
    isoDateTime(input.decidedAt, `${path}.decidedAt`, issues);
  }
  if (input.decidedBy !== undefined) {
    validateActor(input.decidedBy, `${path}.decidedBy`, issues);
  }
  if (input.rationale !== undefined) {
    nonEmptyString(input.rationale, `${path}.rationale`, issues);
  }
}

function validateReceipt(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
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
      "discovery.start",
      "question.propose",
      "answer.record",
      "brief.propose",
      "brief.approve",
      "brief.reject",
    ],
    `${path}.type`,
    issues,
  );
  validateActor(input.actor, `${path}.actor`, issues);
  isoDateTime(input.issuedAt, `${path}.issuedAt`, issues);
  isoDateTime(input.appliedAt, `${path}.appliedAt`, issues);
  validateFingerprint(
    input.requestFingerprint,
    `${path}.requestFingerprint`,
    issues,
  );
  validatePrevious(input.resultingSnapshot, `${path}.resultingSnapshot`, issues);
}

function validateFingerprint(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const input = exactRecord(value, path, ["algorithm", "digest"], [], issues);
  if (!input) return;
  literal(input.algorithm, "sha256", `${path}.algorithm`, issues);
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) {
    issue(
      issues,
      "invalid_fingerprint",
      `${path}.digest`,
      "must be 64 lowercase hex characters",
    );
  }
}

function validateInvariants(
  snapshot: ProjectDiscoverySnapshot,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (snapshot.revision === 1 && snapshot.previous) {
    issue(issues, "unexpected_previous", "$.previous", "must be absent at revision 1");
  } else if (snapshot.revision > 1) {
    if (!snapshot.previous) {
      issue(issues, "missing_previous", "$.previous", "is required after revision 1");
    } else if (snapshot.previous.revision !== snapshot.revision - 1) {
      issue(
        issues,
        "non_contiguous_revision",
        "$.previous.revision",
        "must be the immediately preceding revision",
      );
    }
  }

  unique(snapshot.questions.map((item) => item.id), "$.questions", "question", issues);
  unique(snapshot.answers.map((item) => item.id), "$.answers", "answer", issues);
  for (const [index, question] of snapshot.questions.entries()) {
    unique(
      question.options.map((item) => item.value),
      `$.questions[${index}].options`,
      "option value",
      issues,
    );
    if (
      !question.options.some((item) => item.value === question.recommendation.value)
    ) {
      issue(
        issues,
        "unselectable_recommendation",
        `$.questions[${index}].recommendation.value`,
        "must match one bounded option value",
      );
    }
  }
  validateAnswerGraph(snapshot, issues);
  validateReviewState(snapshot, issues);
  validateReceiptLedger(snapshot, issues);
}

function validateAnswerGraph(
  snapshot: ProjectDiscoverySnapshot,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const questions = new Map(snapshot.questions.map((item) => [item.id, item]));
  const answers = new Map(snapshot.answers.map((item) => [item.id, item]));
  const supersededCounts = new Map<string, number>();
  for (const [index, answer] of snapshot.answers.entries()) {
    const question = questions.get(answer.questionId);
    if (!question) {
      issue(
        issues,
        "unknown_question",
        `$.answers[${index}].questionId`,
        "does not resolve to a guided question",
      );
    } else if (answer.kind === "unknown" && !question.allowUnknown) {
      issue(
        issues,
        "unknown_not_allowed",
        `$.answers[${index}].kind`,
        "question does not permit an unknown answer",
      );
    } else if (
      answer.kind === "provided" &&
      !question.options.some((option) => option.value === answer.value)
    ) {
      issue(
        issues,
        "unselectable_answer",
        `$.answers[${index}].value`,
        "must match one bounded question option value",
      );
    }
    if (
      answer.recordedBy.origin === "human" && answer.source.kind !== "human"
    ) {
      issue(
        issues,
        "false_human_source",
        `$.answers[${index}].source.kind`,
        "a directly recorded human answer must declare a human source",
      );
    }
    if (!answer.supersedesAnswerId) continue;
    const previous = answers.get(answer.supersedesAnswerId);
    if (!previous || previous.questionId !== answer.questionId) {
      issue(
        issues,
        "invalid_supersession",
        `$.answers[${index}].supersedesAnswerId`,
        "must resolve to an earlier answer for the same question",
      );
    } else if (
      snapshot.answers.indexOf(previous) >= index ||
      previous.id === answer.id
    ) {
      issue(
        issues,
        "non_historical_supersession",
        `$.answers[${index}].supersedesAnswerId`,
        "must refer to an earlier answer",
      );
    }
    supersededCounts.set(
      answer.supersedesAnswerId,
      (supersededCounts.get(answer.supersedesAnswerId) ?? 0) + 1,
    );
  }
  for (const [id, count] of supersededCounts) {
    if (count > 1) {
      issue(
        issues,
        "answer_superseded_twice",
        "$.answers",
        `answer ${id} is superseded more than once`,
      );
    }
  }
  const activeByQuestion = new Map<string, ProjectDiscoveryAnswer[]>();
  for (const answer of snapshot.answers) {
    if (supersededCounts.has(answer.id)) continue;
    const active = activeByQuestion.get(answer.questionId) ?? [];
    active.push(answer);
    activeByQuestion.set(answer.questionId, active);
  }
  for (const [questionId, active] of activeByQuestion) {
    if (active.length > 1) {
      issue(
        issues,
        "ambiguous_current_answer",
        "$.answers",
        `question ${questionId} has more than one unsuperseded answer`,
      );
    }
  }
}

function validateReviewState(
  snapshot: ProjectDiscoverySnapshot,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const expectedReview = snapshot.status === "awaiting-review"
    ? "pending"
    : snapshot.status === "revision-requested"
    ? "rejected"
    : snapshot.status === "approved"
    ? "approved"
    : undefined;
  if (expectedReview === undefined) {
    if (snapshot.brief || snapshot.review) {
      issue(
        issues,
        "unexpected_review_scope",
        "$",
        "discovering state cannot contain a brief or review",
      );
    }
    return;
  }
  if (!snapshot.brief || !snapshot.review) {
    issue(
      issues,
      "missing_review_scope",
      "$",
      `${snapshot.status} requires both brief and review`,
    );
    return;
  }
  if (snapshot.review.briefId !== snapshot.brief.id) {
    issue(issues, "review_brief_mismatch", "$.review.briefId", "must match brief.id");
  }
  if (snapshot.review.status !== expectedReview) {
    issue(
      issues,
      "review_status_mismatch",
      "$.review.status",
      `must be ${expectedReview} while discovery is ${snapshot.status}`,
    );
  }
  const decided = snapshot.review.status !== "pending";
  if (
    decided &&
    (!snapshot.review.decidedAt || !snapshot.review.decidedBy ||
      !snapshot.review.rationale)
  ) {
    issue(
      issues,
      "incomplete_review_decision",
      "$.review",
      "a decided review requires time, human actor and rationale",
    );
  }
  if (snapshot.review.decidedBy?.origin === "agent") {
    issue(
      issues,
      "agent_review_forbidden",
      "$.review.decidedBy.origin",
      "an agent cannot approve or reject a discovery brief",
    );
  }
  if (
    !decided &&
    (snapshot.review.decidedAt || snapshot.review.decidedBy ||
      snapshot.review.rationale)
  ) {
    issue(
      issues,
      "premature_review_decision",
      "$.review",
      "a pending review cannot contain decision fields",
    );
  }
}

function validateReceiptLedger(
  snapshot: ProjectDiscoverySnapshot,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (snapshot.commandReceipts.length !== snapshot.revision) {
    issue(
      issues,
      "incomplete_command_ledger",
      "$.commandReceipts",
      "must contain exactly one receipt for every immutable revision",
    );
  }
  unique(
    snapshot.commandReceipts.map((item) => item.commandId),
    "$.commandReceipts",
    "command id",
    issues,
  );
  unique(
    snapshot.commandReceipts.map((item) => item.resultingSnapshot.revision),
    "$.commandReceipts",
    "result revision",
    issues,
  );
  for (const [index, receipt] of snapshot.commandReceipts.entries()) {
    const allowedOrigin = receipt.type === "brief.approve" ||
        receipt.type === "brief.reject"
      ? "human"
      : receipt.type === "answer.record" || receipt.type === "discovery.start"
      ? undefined
      : "agent";
    if (allowedOrigin && receipt.actor.origin !== allowedOrigin) {
      issue(
        issues,
        "command_authority_mismatch",
        `$.commandReceipts[${index}].actor.origin`,
        `${receipt.type} requires ${allowedOrigin} authority`,
      );
    }
  }
  const latest = snapshot.commandReceipts.find((item) =>
    item.resultingSnapshot.revision === snapshot.revision
  );
  if (
    !latest || latest.resultingSnapshot.snapshotId !== snapshot.id ||
    latest.resultingSnapshot.revision !== snapshot.revision
  ) {
    issue(
      issues,
      "missing_current_receipt",
      "$.commandReceipts",
      "must include a receipt for the exact current snapshot",
    );
  }
}

function validateArray(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
  validator: (
    value: unknown,
    path: string,
    issues: ProjectDiscoveryValidationIssue[],
  ) => void,
  requireNonEmpty = false,
): void {
  if (!Array.isArray(value)) {
    issue(issues, "expected_array", path, "must be an array");
    return;
  }
  if (requireNonEmpty && value.length === 0) {
    issue(issues, "empty_array", path, "must contain at least one item");
  }
  value.forEach((item, index) => validator(item, `${path}[${index}]`, issues));
}

function stringArray(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
  requireNonEmpty = false,
): void {
  if (!Array.isArray(value)) {
    issue(issues, "expected_array", path, "must be an array");
    return;
  }
  if (requireNonEmpty && value.length === 0) {
    issue(issues, "empty_array", path, "must contain at least one item");
  }
  value.forEach((item, index) => nonEmptyString(item, `${path}[${index}]`, issues));
  if (value.every((item) => typeof item === "string" && item.trim())) {
    unique(value as string[], path, "value", issues);
  }
}

function unique(
  values: readonly (string | number)[],
  path: string,
  label: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  const seen = new Set<string | number>();
  for (const value of values) {
    if (seen.has(value)) {
      issue(issues, "duplicate_value", path, `${label} ${value} is duplicated`);
    }
    seen.add(value);
  }
}

function exactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: ProjectDiscoveryValidationIssue[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issue(issues, "expected_object", path, "must be an object");
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      issue(issues, "unsupported_field", `${path}.${key}`, "is not supported");
    }
  }
  for (const key of required) {
    if (!(key in input)) {
      issue(issues, "missing_field", `${path}.${key}`, "is required");
    }
  }
  return input;
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    issue(issues, "expected_non_empty_string", path, "must be a non-empty string");
  }
}

function safeId(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  nonEmptyString(value, path, issues);
  if (typeof value !== "string" || !value.trim()) return;
  if (!/^[A-Za-z0-9]/.test(value) || value.toLowerCase() === "latest") {
    issue(
      issues,
      "unsafe_id",
      path,
      "must begin with an ASCII alphanumeric character and cannot be latest",
    );
  }
}

function positiveInteger(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    issue(issues, "expected_positive_integer", path, "must be a positive safe integer");
  }
}

function boolean(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (typeof value !== "boolean") {
    issue(issues, "expected_boolean", path, "must be boolean");
  }
}

function literal(
  value: unknown,
  expected: string,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (value !== expected) {
    issue(issues, "unexpected_literal", path, `must be ${expected}`);
  }
}

function oneOf(
  value: unknown,
  choices: readonly string[],
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (typeof value !== "string" || !choices.includes(value)) {
    issue(issues, "unexpected_literal", path, `must be one of ${choices.join(", ")}`);
  }
}

function isoDateTime(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    issue(issues, "invalid_datetime", path, "must be an ISO date-time");
  }
}

function validateJson(
  value: unknown,
  path: string,
  issues: ProjectDiscoveryValidationIssue[],
  ancestors: Set<object>,
): void {
  if (
    value === undefined || typeof value === "bigint" || typeof value === "function" ||
    typeof value === "symbol"
  ) {
    issue(issues, "non_json_value", path, "must be JSON-compatible");
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    issue(issues, "non_json_number", path, "must be finite");
    return;
  }
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) {
    issue(issues, "cyclic_value", path, "must not contain cycles");
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJson(item, `${path}[${index}]`, issues, ancestors)
    );
  } else {
    for (const [key, item] of Object.entries(value)) {
      validateJson(item, `${path}.${key}`, issues, ancestors);
    }
  }
  ancestors.delete(value);
}

function issue(
  issues: ProjectDiscoveryValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
