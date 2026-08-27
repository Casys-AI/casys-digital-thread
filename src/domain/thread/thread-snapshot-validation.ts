import type {
  ContentFingerprint,
  EvaluationComparison,
  ProposedThreadAction,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadChange,
  ThreadEntityKind,
  ThreadEntityRef,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation,
  TracedRequirement,
} from "./thread-snapshot.ts";
import { type AnalysisGraph, validateAnalysisGraph } from "./analysis-graph.ts";
import { deepFreeze } from "../kernel/case-validation.ts";

export interface ThreadSnapshotValidationIssue {
  code: string;
  path: string;
  message: string;
}

export class ThreadSnapshotValidationError extends Error {
  readonly issues: readonly ThreadSnapshotValidationIssue[];

  constructor(issues: readonly ThreadSnapshotValidationIssue[]) {
    super(
      `Invalid ThreadSnapshot: ${
        issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
      }`,
    );
    this.name = "ThreadSnapshotValidationError";
    this.issues = issues;
  }
}

/**
 * Validate untrusted JSON, clone it and recursively freeze the result.
 *
 * This function performs no I/O and never fills missing engineering data.
 */
export function validateThreadSnapshot(value: unknown): ThreadSnapshot {
  const issues = collectThreadSnapshotIssues(value);
  if (issues.length > 0) {
    throw new ThreadSnapshotValidationError(issues);
  }
  return deepFreeze(structuredClone(value)) as ThreadSnapshot;
}

/** Alias emphasizing construction at a BFF/domain boundary. */
export function createThreadSnapshot(value: unknown): ThreadSnapshot {
  return validateThreadSnapshot(value);
}

/** Return every structural and causal issue without mutating the candidate. */
export function collectThreadSnapshotIssues(
  value: unknown,
): ThreadSnapshotValidationIssue[] {
  const issues: ThreadSnapshotValidationIssue[] = [];
  validateJsonValue(value, "$", issues, new Set());
  const schemaVersion = threadSnapshotSchemaVersion(value);
  const root = exactRecord(
    value,
    "$",
    [
      "schemaVersion",
      "id",
      "revision",
      "generatedAt",
      "subject",
      "freshness",
      "changeSet",
      "artifacts",
      "consumptions",
      "observations",
      "requirements",
      "evaluations",
      "violations",
      "provenance",
      "proposedActions",
    ],
    [
      "previous",
      ...(schemaVersion === "1.1" ? ["analysisGraph"] : []),
    ],
    issues,
  );
  if (!root) return issues;

  oneOf(root.schemaVersion, ["1.0", "1.1"], "$.schemaVersion", issues);
  nonEmptyString(root.id, "$.id", issues);
  positiveInteger(root.revision, "$.revision", issues);
  isoDateTime(root.generatedAt, "$.generatedAt", issues);

  if (root.previous !== undefined) {
    const previous = exactRecord(
      root.previous,
      "$.previous",
      ["snapshotId", "revision"],
      [],
      issues,
    );
    if (previous) {
      nonEmptyString(previous.snapshotId, "$.previous.snapshotId", issues);
      positiveInteger(previous.revision, "$.previous.revision", issues);
    }
  }

  validateSubject(root.subject, "$.subject", issues);
  validateFreshness(root.freshness, "$.freshness", issues);
  validateChangeSet(root.changeSet, "$.changeSet", issues);
  validateArray(root.artifacts, "$.artifacts", issues, validateArtifact);
  validateArray(root.consumptions, "$.consumptions", issues, validateConsumption);
  validateArray(root.observations, "$.observations", issues, validateObservation);
  validateArray(root.requirements, "$.requirements", issues, validateRequirement);
  validateArray(root.evaluations, "$.evaluations", issues, validateEvaluation);
  validateArray(root.violations, "$.violations", issues, validateViolation);
  validateArray(root.provenance, "$.provenance", issues, validateProvenanceLink);
  validateArray(root.proposedActions, "$.proposedActions", issues, validateAction);
  validateAnalysisGraphForSchema(root, issues);

  if (issues.length === 0) {
    validateInvariants(value as ThreadSnapshot, issues);
  }
  return issues;
}

function threadSnapshotSchemaVersion(
  value: unknown,
): ThreadSnapshot["schemaVersion"] | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>).schemaVersion;
  return candidate === "1.0" || candidate === "1.1" ? candidate : undefined;
}

/**
 * `analysisGraph` is intentionally version-gated rather than treated as an
 * optional convenience field.  A 1.0 record cannot silently gain semantic
 * relations, and a 1.1 record cannot pretend that no graph was recorded.
 */
function validateAnalysisGraphForSchema(
  root: Record<string, unknown>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const hasAnalysisGraph = Object.hasOwn(root, "analysisGraph");
  if (root.schemaVersion === "1.0") {
    if (hasAnalysisGraph) {
      issue(
        issues,
        "unsupported_analysis_graph",
        "$.analysisGraph",
        "is not supported by ThreadSnapshot schema 1.0",
      );
    }
    return;
  }
  if (root.schemaVersion !== "1.1") return;
  if (!hasAnalysisGraph) {
    issue(
      issues,
      "missing_analysis_graph",
      "$.analysisGraph",
      "is required by ThreadSnapshot schema 1.1",
    );
    return;
  }
  try {
    validateAnalysisGraph(root.analysisGraph);
  } catch (error) {
    issue(
      issues,
      "invalid_analysis_graph",
      "$.analysisGraph",
      error instanceof Error ? error.message : "is invalid",
    );
  }
}

function validateSubject(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "name", "kind", "version", "modelArtifactId"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  oneOf(input.kind, ["system", "assembly", "part", "process"], `${path}.kind`, issues);
  nonEmptyString(input.version, `${path}.version`, issues);
  nonEmptyString(input.modelArtifactId, `${path}.modelArtifactId`, issues);
}

function validateChangeSet(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "name", "status", "createdAt", "changes"],
    ["appliedAt"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  oneOf(input.status, ["proposed", "applied"], `${path}.status`, issues);
  isoDateTime(input.createdAt, `${path}.createdAt`, issues);
  optionalIsoDateTime(input.appliedAt, `${path}.appliedAt`, issues);
  validateArray(input.changes, `${path}.changes`, issues, validateChange);
}

function validateChange(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "kind", "target", "summary"],
    ["beforeFingerprint", "afterFingerprint"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  oneOf(
    input.kind,
    ["created", "modified", "deleted", "archived"],
    `${path}.kind`,
    issues,
  );
  validateEntityRef(input.target, `${path}.target`, issues);
  nonEmptyString(input.summary, `${path}.summary`, issues);
  optionalFingerprint(input.beforeFingerprint, `${path}.beforeFingerprint`, issues);
  optionalFingerprint(input.afterFingerprint, `${path}.afterFingerprint`, issues);
}

function validateArtifact(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "name",
      "kind",
      "version",
      "fingerprint",
      "producer",
      "inputArtifactIds",
      "freshness",
    ],
    ["uri", "mediaType"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  oneOf(
    input.kind,
    [
      "sysml-model",
      "script",
      "cad-model",
      "step",
      "mesh",
      "simulation-model",
      "solver-input",
      "solver-result",
      "evidence",
      "bom",
      "document",
      "other",
    ],
    `${path}.kind`,
    issues,
  );
  nonEmptyString(input.version, `${path}.version`, issues);
  validateFingerprint(input.fingerprint, `${path}.fingerprint`, issues);
  optionalNonEmptyString(input.uri, `${path}.uri`, issues);
  optionalNonEmptyString(input.mediaType, `${path}.mediaType`, issues);
  validateOperation(input.producer, `${path}.producer`, issues);
  stringArray(input.inputArtifactIds, `${path}.inputArtifactIds`, issues);
  validateFreshness(input.freshness, `${path}.freshness`, issues);
}

function validateObservation(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "name", "metric", "quantity", "source", "freshness"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  nonEmptyString(input.metric, `${path}.metric`, issues);
  validateQuantity(input.quantity, `${path}.quantity`, issues);
  const source = exactRecord(
    input.source,
    `${path}.source`,
    ["operation", "artifactIds", "capturedAt"],
    [],
    issues,
  );
  if (source) {
    validateOperation(source.operation, `${path}.source.operation`, issues);
    stringArray(source.artifactIds, `${path}.source.artifactIds`, issues);
    isoDateTime(source.capturedAt, `${path}.source.capturedAt`, issues);
  }
  validateFreshness(input.freshness, `${path}.freshness`, issues);
}

function validateConsumption(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "artifactId",
      "consumer",
      "observedFingerprint",
      "verifiedAt",
      "status",
    ],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.artifactId, `${path}.artifactId`, issues);
  validateOperation(input.consumer, `${path}.consumer`, issues);
  validateFingerprint(input.observedFingerprint, `${path}.observedFingerprint`, issues);
  isoDateTime(input.verifiedAt, `${path}.verifiedAt`, issues);
  oneOf(input.status, ["verified", "mismatch"], `${path}.status`, issues);
}

function validateRequirement(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "name", "statement", "version", "criterion", "trace", "freshness"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  nonEmptyString(input.statement, `${path}.statement`, issues);
  nonEmptyString(input.version, `${path}.version`, issues);
  const criterion = exactRecord(
    input.criterion,
    `${path}.criterion`,
    ["metric", "operator", "limit"],
    [],
    issues,
  );
  if (criterion) {
    nonEmptyString(criterion.metric, `${path}.criterion.metric`, issues);
    oneOf(
      criterion.operator,
      ["<=", ">=", "<", ">", "="],
      `${path}.criterion.operator`,
      issues,
    );
    validateQuantity(criterion.limit, `${path}.criterion.limit`, issues);
  }
  const trace = exactRecord(
    input.trace,
    `${path}.trace`,
    ["sourceArtifactId", "elementId", "targetArtifactIds"],
    [],
    issues,
  );
  if (trace) {
    nonEmptyString(trace.sourceArtifactId, `${path}.trace.sourceArtifactId`, issues);
    nonEmptyString(trace.elementId, `${path}.trace.elementId`, issues);
    stringArray(trace.targetArtifactIds, `${path}.trace.targetArtifactIds`, issues);
  }
  validateFreshness(input.freshness, `${path}.freshness`, issues);
}

function validateEvaluation(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "name",
      "requirementId",
      "observationIds",
      "status",
      "evaluatedAt",
      "evaluator",
      "evidenceArtifactIds",
      "message",
      "freshness",
    ],
    ["comparison"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  nonEmptyString(input.requirementId, `${path}.requirementId`, issues);
  stringArray(input.observationIds, `${path}.observationIds`, issues);
  oneOf(
    input.status,
    ["pass", "fail", "unresolved", "error"],
    `${path}.status`,
    issues,
  );
  isoDateTime(input.evaluatedAt, `${path}.evaluatedAt`, issues);
  validateOperation(input.evaluator, `${path}.evaluator`, issues);
  if (input.comparison !== undefined) {
    validateComparison(input.comparison, `${path}.comparison`, issues);
  }
  stringArray(input.evidenceArtifactIds, `${path}.evidenceArtifactIds`, issues);
  nonEmptyString(input.message, `${path}.message`, issues);
  validateFreshness(input.freshness, `${path}.freshness`, issues);
}

function validateComparison(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["observationId", "actual", "operator", "limit", "normalizedUnit"],
    ["margin"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.observationId, `${path}.observationId`, issues);
  validateQuantity(input.actual, `${path}.actual`, issues);
  oneOf(input.operator, ["<=", ">=", "<", ">", "="], `${path}.operator`, issues);
  validateQuantity(input.limit, `${path}.limit`, issues);
  nonEmptyString(input.normalizedUnit, `${path}.normalizedUnit`, issues);
  if (input.margin !== undefined) {
    validateQuantity(input.margin, `${path}.margin`, issues);
  }
}

function validateViolation(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "name",
      "requirementId",
      "evaluationId",
      "severity",
      "status",
      "detectedAt",
      "observationIds",
      "evidenceArtifactIds",
      "summary",
      "freshness",
    ],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  nonEmptyString(input.requirementId, `${path}.requirementId`, issues);
  nonEmptyString(input.evaluationId, `${path}.evaluationId`, issues);
  oneOf(
    input.severity,
    ["info", "warning", "error", "critical"],
    `${path}.severity`,
    issues,
  );
  oneOf(input.status, ["open", "accepted", "resolved"], `${path}.status`, issues);
  isoDateTime(input.detectedAt, `${path}.detectedAt`, issues);
  stringArray(input.observationIds, `${path}.observationIds`, issues);
  stringArray(input.evidenceArtifactIds, `${path}.evidenceArtifactIds`, issues);
  nonEmptyString(input.summary, `${path}.summary`, issues);
  validateFreshness(input.freshness, `${path}.freshness`, issues);
}

function validateProvenanceLink(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["id", "relation", "from", "to", "rationale"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  oneOf(
    input.relation,
    [
      "changes",
      "derived_from",
      "traces_to",
      "uses",
      "evaluates",
      "evidences",
      "caused_by",
      "addresses",
      "supersedes",
    ],
    `${path}.relation`,
    issues,
  );
  validateEntityRef(input.from, `${path}.from`, issues);
  validateEntityRef(input.to, `${path}.to`, issues);
  nonEmptyString(input.rationale, `${path}.rationale`, issues);
}

function validateAction(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    [
      "id",
      "name",
      "kind",
      "readiness",
      "rationale",
      "targets",
      "addressesViolationIds",
      "dependsOnActionIds",
    ],
    ["operation", "blockedReason"],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.id, `${path}.id`, issues);
  nonEmptyString(input.name, `${path}.name`, issues);
  oneOf(
    input.kind,
    ["recompute", "correct", "review", "synchronize", "inspect"],
    `${path}.kind`,
    issues,
  );
  oneOf(input.readiness, ["ready", "blocked"], `${path}.readiness`, issues);
  nonEmptyString(input.rationale, `${path}.rationale`, issues);
  validateArray(input.targets, `${path}.targets`, issues, validateEntityRef);
  stringArray(input.addressesViolationIds, `${path}.addressesViolationIds`, issues);
  stringArray(input.dependsOnActionIds, `${path}.dependsOnActionIds`, issues);
  if (input.operation !== undefined) {
    const operation = exactRecord(
      input.operation,
      `${path}.operation`,
      ["id", "inputs"],
      [],
      issues,
    );
    if (operation) {
      nonEmptyString(operation.id, `${path}.operation.id`, issues);
      record(operation.inputs, `${path}.operation.inputs`, issues);
    }
  }
  optionalNonEmptyString(input.blockedReason, `${path}.blockedReason`, issues);
}

function validateFreshness(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["status", "changedAt", "invalidatedByChangeIds"],
    ["reason"],
    issues,
  );
  if (!input) return;
  oneOf(
    input.status,
    ["fresh", "stale", "running", "failed"],
    `${path}.status`,
    issues,
  );
  isoDateTime(input.changedAt, `${path}.changedAt`, issues);
  optionalNonEmptyString(input.reason, `${path}.reason`, issues);
  stringArray(input.invalidatedByChangeIds, `${path}.invalidatedByChangeIds`, issues);
}

function validateOperation(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(
    value,
    path,
    ["serverId", "tool", "runId"],
    [],
    issues,
  );
  if (!input) return;
  nonEmptyString(input.serverId, `${path}.serverId`, issues);
  nonEmptyString(input.tool, `${path}.tool`, issues);
  nonEmptyString(input.runId, `${path}.runId`, issues);
}

function validateEntityRef(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(value, path, ["kind", "id"], [], issues);
  if (!input) return;
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

function validateFingerprint(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
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
      "invalid_sha256",
      `${path}.digest`,
      "must contain exactly 64 hexadecimal characters",
    );
  }
}

function optionalFingerprint(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (value !== undefined) validateFingerprint(value, path, issues);
}

function validateQuantity(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const input = exactRecord(value, path, ["value", "unit"], [], issues);
  if (!input) return;
  finiteNumber(input.value, `${path}.value`, issues);
  nonEmptyString(input.unit, `${path}.unit`, issues);
}

function validateInvariants(
  snapshot: ThreadSnapshot,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const artifacts = indexed(snapshot.artifacts, "$.artifacts", issues);
  const consumptions = indexed(snapshot.consumptions, "$.consumptions", issues);
  const observations = indexed(snapshot.observations, "$.observations", issues);
  const requirements = indexed(snapshot.requirements, "$.requirements", issues);
  const evaluations = indexed(snapshot.evaluations, "$.evaluations", issues);
  const violations = indexed(snapshot.violations, "$.violations", issues);
  const changes = indexed(snapshot.changeSet.changes, "$.changeSet.changes", issues);
  const actions = indexed(snapshot.proposedActions, "$.proposedActions", issues);
  indexed(snapshot.provenance, "$.provenance", issues);

  if (snapshot.analysisGraph) {
    checkAnalysisGraphEvidence(snapshot.analysisGraph, artifacts, issues);
  }

  if (snapshot.previous && snapshot.previous.revision >= snapshot.revision) {
    issue(
      issues,
      "invalid_revision",
      "$.previous.revision",
      "must be lower than the current revision",
    );
  }
  if (!artifacts.has(snapshot.subject.modelArtifactId)) {
    issue(
      issues,
      "missing_reference",
      "$.subject.modelArtifactId",
      "does not reference an artifact in this snapshot",
    );
  }
  if (snapshot.changeSet.status === "applied" && !snapshot.changeSet.appliedAt) {
    issue(
      issues,
      "missing_applied_at",
      "$.changeSet.appliedAt",
      "is required for an applied change set",
    );
  }
  if (snapshot.changeSet.status === "proposed" && snapshot.changeSet.appliedAt) {
    issue(
      issues,
      "unexpected_applied_at",
      "$.changeSet.appliedAt",
      "must be absent for a proposed change set",
    );
  }

  const changeIds = new Set(changes.keys());
  checkFreshness(snapshot.freshness, "$.freshness", changeIds, issues);
  snapshot.artifacts.forEach((item, index) =>
    checkFreshness(item.freshness, `$.artifacts[${index}].freshness`, changeIds, issues)
  );
  snapshot.observations.forEach((item, index) =>
    checkFreshness(
      item.freshness,
      `$.observations[${index}].freshness`,
      changeIds,
      issues,
    )
  );
  snapshot.requirements.forEach((item, index) =>
    checkFreshness(
      item.freshness,
      `$.requirements[${index}].freshness`,
      changeIds,
      issues,
    )
  );
  snapshot.evaluations.forEach((item, index) =>
    checkFreshness(
      item.freshness,
      `$.evaluations[${index}].freshness`,
      changeIds,
      issues,
    )
  );
  snapshot.violations.forEach((item, index) =>
    checkFreshness(
      item.freshness,
      `$.violations[${index}].freshness`,
      changeIds,
      issues,
    )
  );

  snapshot.changeSet.changes.forEach((change, index) =>
    checkChange(change, `$.changeSet.changes[${index}]`, snapshot, issues)
  );

  const references = new Map<ThreadEntityKind, Set<string>>([
    ["artifact", new Set(artifacts.keys())],
    ["consumption", new Set(consumptions.keys())],
    ["observation", new Set(observations.keys())],
    ["requirement", new Set(requirements.keys())],
    ["evaluation", new Set(evaluations.keys())],
    ["violation", new Set(violations.keys())],
    ["change", new Set(changes.keys())],
    ["action", new Set(actions.keys())],
  ]);

  snapshot.provenance.forEach((link, index) => {
    checkReference(link.from, `$.provenance[${index}].from`, references, issues);
    const deletedTarget = link.relation === "changes" && link.from.kind === "change" &&
      changes.get(link.from.id)?.kind === "deleted" &&
      changes.get(link.from.id)?.target.kind === link.to.kind &&
      changes.get(link.from.id)?.target.id === link.to.id;
    if (!deletedTarget) {
      checkReference(link.to, `$.provenance[${index}].to`, references, issues);
    }
    checkLinkShape(link, `$.provenance[${index}]`, issues);
    checkMechanicalLink(
      link,
      `$.provenance[${index}]`,
      artifacts,
      consumptions,
      issues,
    );
  });
  const links = new Set(snapshot.provenance.map(linkKey));

  snapshot.changeSet.changes.forEach((change, index) =>
    requireLink(
      links,
      "changes",
      { kind: "change", id: change.id },
      change.target,
      `$.changeSet.changes[${index}].target`,
      issues,
    )
  );

  snapshot.consumptions.forEach((consumption, index) =>
    checkConsumption(consumption, index, artifacts, links, issues)
  );

  snapshot.artifacts.forEach((artifact, index) =>
    checkArtifact(artifact, index, artifacts, consumptions, links, issues)
  );
  snapshot.observations.forEach((observation, index) =>
    checkObservation(observation, index, artifacts, links, issues)
  );
  snapshot.requirements.forEach((requirement, index) =>
    checkRequirement(requirement, index, artifacts, links, issues)
  );
  snapshot.evaluations.forEach((evaluation, index) =>
    checkEvaluation(
      evaluation,
      index,
      observations,
      requirements,
      artifacts,
      violations,
      links,
      issues,
    )
  );
  snapshot.violations.forEach((violation, index) =>
    checkViolation(
      violation,
      index,
      observations,
      requirements,
      evaluations,
      artifacts,
      links,
      issues,
    )
  );
  snapshot.proposedActions.forEach((action, index) =>
    checkAction(action, index, references, violations, actions, links, issues)
  );
  checkDependencyCycles(
    snapshot.artifacts.map((artifact) =>
      [artifact.id, artifact.inputArtifactIds] as const
    ),
    "$.artifacts",
    "artifact_dependency_cycle",
    issues,
  );
  checkDependencyCycles(
    snapshot.proposedActions.map((action) =>
      [action.id, action.dependsOnActionIds] as const
    ),
    "$.proposedActions",
    "action_dependency_cycle",
    issues,
  );
  snapshot.violations.forEach((violation, index) => {
    if (
      violation.status === "open" &&
      !snapshot.proposedActions.some((action) =>
        action.addressesViolationIds.includes(violation.id)
      )
    ) {
      issue(
        issues,
        "missing_proposed_action",
        `$.violations[${index}]`,
        "an open violation must have at least one proposed action",
      );
    }
  });

  const computedFreshness = aggregateFreshness([
    ...snapshot.artifacts,
    ...snapshot.observations,
    ...snapshot.requirements,
    ...snapshot.evaluations,
    ...snapshot.violations,
    ...snapshot.consumptions.filter((item) => item.status === "mismatch").map(() => ({
      freshness: { status: "failed" as const },
    })),
  ].map((item) => item.freshness.status));
  if (snapshot.freshness.status !== computedFreshness) {
    issue(
      issues,
      "inconsistent_freshness",
      "$.freshness.status",
      `must be ${computedFreshness} to summarize its entities`,
    );
  }
}

/**
 * Semantic assertions may cite only bytes retained by this immutable snapshot.
 * The pair is checked exactly: an artifact id alone is not provenance, and a
 * matching digest under another id cannot be substituted.
 */
function checkAnalysisGraphEvidence(
  graph: AnalysisGraph,
  artifacts: Map<string, ThreadArtifact>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  graph.relations.forEach((relation, relationIndex) => {
    relation.assertion.evidence.forEach((evidence, evidenceIndex) => {
      const path =
        `$.analysisGraph.relations[${relationIndex}].assertion.evidence[${evidenceIndex}]`;
      const artifact = artifacts.get(evidence.id);
      if (!artifact) {
        issue(
          issues,
          "missing_reference",
          `${path}.id`,
          "does not reference an artifact in this snapshot",
        );
        return;
      }
      if (
        fingerprintKey(artifact.fingerprint) !== fingerprintKey(evidence.fingerprint)
      ) {
        issue(
          issues,
          "analysis_evidence_fingerprint_mismatch",
          `${path}.fingerprint`,
          "must exactly equal the referenced artifact fingerprint",
        );
      }
    });
  });
}

function checkArtifact(
  artifact: ThreadArtifact,
  index: number,
  artifacts: Map<string, ThreadArtifact>,
  consumptions: Map<string, ThreadArtifactConsumption>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  artifact.inputArtifactIds.forEach((id, inputIndex) => {
    if (!artifacts.has(id)) {
      issue(
        issues,
        "missing_reference",
        `$.artifacts[${index}].inputArtifactIds[${inputIndex}]`,
        "does not reference an artifact",
      );
    }
    const attestation = [...consumptions.values()].find((consumption) =>
      consumption.artifactId === id &&
      sameOperation(consumption.consumer, artifact.producer) &&
      consumption.status === "verified"
    );
    if (!attestation) {
      issue(
        issues,
        "missing_consumption_attestation",
        `$.artifacts[${index}].inputArtifactIds[${inputIndex}]`,
        "requires a verified consumer fingerprint from the downstream producer run",
      );
    }
    requireLink(
      links,
      "derived_from",
      { kind: "artifact", id: artifact.id },
      { kind: "artifact", id },
      `$.artifacts[${index}].inputArtifactIds[${inputIndex}]`,
      issues,
    );
  });
}

function checkConsumption(
  consumption: ThreadArtifactConsumption,
  index: number,
  artifacts: Map<string, ThreadArtifact>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const path = `$.consumptions[${index}]`;
  const artifact = artifacts.get(consumption.artifactId);
  if (!artifact) {
    issue(
      issues,
      "missing_reference",
      `${path}.artifactId`,
      "does not reference an artifact",
    );
    return;
  }
  const fingerprintsMatch = fingerprintKey(artifact.fingerprint) ===
    fingerprintKey(consumption.observedFingerprint);
  if (consumption.status === "verified" && !fingerprintsMatch) {
    issue(
      issues,
      "fingerprint_mismatch",
      `${path}.status`,
      "cannot be verified because producer and consumer fingerprints differ",
    );
  }
  if (consumption.status === "mismatch" && fingerprintsMatch) {
    issue(
      issues,
      "incorrect_mismatch",
      `${path}.status`,
      "must be verified because producer and consumer fingerprints are equal",
    );
  }
  const key = linkKey({
    relation: "uses",
    from: { kind: "consumption", id: consumption.id },
    to: { kind: "artifact", id: consumption.artifactId },
  });
  if (consumption.status === "verified" && !links.has(key)) {
    issue(
      issues,
      "missing_provenance",
      `${path}.artifactId`,
      "verified consumption requires a uses provenance link",
    );
  }
  if (consumption.status === "mismatch" && links.has(key)) {
    issue(
      issues,
      "unverified_provenance",
      `${path}.artifactId`,
      "a fingerprint mismatch cannot prove a uses provenance link",
    );
  }
}

function checkObservation(
  observation: ThreadObservation,
  index: number,
  artifacts: Map<string, ThreadArtifact>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (observation.source.artifactIds.length === 0) {
    issue(
      issues,
      "missing_evidence",
      `$.observations[${index}].source.artifactIds`,
      "must contain at least one source artifact",
    );
  }
  observation.source.artifactIds.forEach((id, sourceIndex) => {
    if (!artifacts.has(id)) {
      issue(
        issues,
        "missing_reference",
        `$.observations[${index}].source.artifactIds[${sourceIndex}]`,
        "does not reference an artifact",
      );
    }
    requireLink(
      links,
      "derived_from",
      { kind: "observation", id: observation.id },
      { kind: "artifact", id },
      `$.observations[${index}].source.artifactIds[${sourceIndex}]`,
      issues,
    );
  });
}

function checkRequirement(
  requirement: TracedRequirement,
  index: number,
  artifacts: Map<string, ThreadArtifact>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const tracePath = `$.requirements[${index}].trace`;
  if (!artifacts.has(requirement.trace.sourceArtifactId)) {
    issue(
      issues,
      "missing_reference",
      `${tracePath}.sourceArtifactId`,
      "does not reference an artifact",
    );
  }
  if (requirement.trace.targetArtifactIds.length === 0) {
    issue(
      issues,
      "missing_trace",
      `${tracePath}.targetArtifactIds`,
      "must contain at least one constrained artifact",
    );
  }
  requirement.trace.targetArtifactIds.forEach((id, targetIndex) => {
    if (!artifacts.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${tracePath}.targetArtifactIds[${targetIndex}]`,
        "does not reference an artifact",
      );
    }
    requireLink(
      links,
      "traces_to",
      { kind: "requirement", id: requirement.id },
      { kind: "artifact", id },
      `${tracePath}.targetArtifactIds[${targetIndex}]`,
      issues,
    );
  });
}

function checkEvaluation(
  evaluation: RequirementEvaluation,
  index: number,
  observations: Map<string, ThreadObservation>,
  requirements: Map<string, TracedRequirement>,
  artifacts: Map<string, ThreadArtifact>,
  violations: Map<string, ThreadViolation>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const path = `$.evaluations[${index}]`;
  const requirement = requirements.get(evaluation.requirementId);
  if (!requirement) {
    issue(
      issues,
      "missing_reference",
      `${path}.requirementId`,
      "does not reference a requirement",
    );
  }
  requireLink(
    links,
    "evaluates",
    { kind: "evaluation", id: evaluation.id },
    { kind: "requirement", id: evaluation.requirementId },
    `${path}.requirementId`,
    issues,
  );
  if (
    (evaluation.status === "pass" || evaluation.status === "fail") &&
    evaluation.observationIds.length === 0
  ) {
    issue(
      issues,
      "missing_observation",
      `${path}.observationIds`,
      "must contain at least one observation",
    );
  }
  evaluation.observationIds.forEach((id, observationIndex) => {
    if (!observations.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.observationIds[${observationIndex}]`,
        "does not reference an observation",
      );
    }
    requireLink(
      links,
      "uses",
      { kind: "evaluation", id: evaluation.id },
      { kind: "observation", id },
      `${path}.observationIds[${observationIndex}]`,
      issues,
    );
  });
  evaluation.evidenceArtifactIds.forEach((id, evidenceIndex) => {
    if (!artifacts.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.evidenceArtifactIds[${evidenceIndex}]`,
        "does not reference an artifact",
      );
    }
    requireLink(
      links,
      "evidences",
      { kind: "evaluation", id: evaluation.id },
      { kind: "artifact", id },
      `${path}.evidenceArtifactIds[${evidenceIndex}]`,
      issues,
    );
  });

  if (evaluation.status === "pass" || evaluation.status === "fail") {
    if (!evaluation.comparison) {
      issue(
        issues,
        "missing_comparison",
        `${path}.comparison`,
        "is required for a pass or fail verdict",
      );
    } else {
      checkComparison(
        evaluation.comparison,
        path,
        evaluation,
        requirement,
        observations,
        issues,
      );
    }
  } else if (evaluation.comparison) {
    issue(
      issues,
      "unexpected_comparison",
      `${path}.comparison`,
      "must be absent for unresolved or error verdicts",
    );
  }

  const namedViolations = [...violations.values()].filter((violation) =>
    violation.evaluationId === evaluation.id
  );
  if (evaluation.status === "fail" && namedViolations.length === 0) {
    issue(
      issues,
      "missing_violation",
      path,
      "a failed evaluation must produce a named violation",
    );
  }
  if (evaluation.status !== "fail" && namedViolations.length > 0) {
    issue(
      issues,
      "unexpected_violation",
      path,
      "only a failed evaluation may produce a violation",
    );
  }
}

function checkComparison(
  comparison: EvaluationComparison,
  evaluationPath: string,
  evaluation: RequirementEvaluation,
  requirement: TracedRequirement | undefined,
  observations: Map<string, ThreadObservation>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const path = `${evaluationPath}.comparison`;
  if (!evaluation.observationIds.includes(comparison.observationId)) {
    issue(
      issues,
      "missing_reference",
      `${path}.observationId`,
      "must be listed in observationIds",
    );
  }
  const observation = observations.get(comparison.observationId);
  if (
    observation && requirement && observation.metric !== requirement.criterion.metric
  ) {
    issue(
      issues,
      "metric_mismatch",
      `${path}.observationId`,
      "observation metric does not match the requirement criterion",
    );
  }
  if (requirement && comparison.operator !== requirement.criterion.operator) {
    issue(
      issues,
      "operator_mismatch",
      `${path}.operator`,
      "does not match the requirement criterion",
    );
  }
  for (
    const [field, quantity] of [
      ["actual", comparison.actual],
      ["limit", comparison.limit],
      ["margin", comparison.margin],
    ] as const
  ) {
    if (quantity && quantity.unit !== comparison.normalizedUnit) {
      issue(
        issues,
        "unit_mismatch",
        `${path}.${field}.unit`,
        "must equal normalizedUnit after oracle conversion",
      );
    }
  }
}

function checkViolation(
  violation: ThreadViolation,
  index: number,
  observations: Map<string, ThreadObservation>,
  requirements: Map<string, TracedRequirement>,
  evaluations: Map<string, RequirementEvaluation>,
  artifacts: Map<string, ThreadArtifact>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const path = `$.violations[${index}]`;
  const evaluation = evaluations.get(violation.evaluationId);
  if (!requirements.has(violation.requirementId)) {
    issue(
      issues,
      "missing_reference",
      `${path}.requirementId`,
      "does not reference a requirement",
    );
  }
  if (!evaluation) {
    issue(
      issues,
      "missing_reference",
      `${path}.evaluationId`,
      "does not reference an evaluation",
    );
  } else {
    if (evaluation.status !== "fail") {
      issue(
        issues,
        "invalid_violation",
        `${path}.evaluationId`,
        "must reference a failed evaluation",
      );
    }
    if (evaluation.requirementId !== violation.requirementId) {
      issue(
        issues,
        "requirement_mismatch",
        `${path}.requirementId`,
        "does not match the evaluation requirement",
      );
    }
  }
  requireLink(
    links,
    "caused_by",
    { kind: "violation", id: violation.id },
    { kind: "evaluation", id: violation.evaluationId },
    `${path}.evaluationId`,
    issues,
  );
  violation.observationIds.forEach((id, observationIndex) => {
    if (!observations.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.observationIds[${observationIndex}]`,
        "does not reference an observation",
      );
    }
  });
  violation.evidenceArtifactIds.forEach((id, evidenceIndex) => {
    if (!artifacts.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.evidenceArtifactIds[${evidenceIndex}]`,
        "does not reference an artifact",
      );
    }
    requireLink(
      links,
      "evidences",
      { kind: "violation", id: violation.id },
      { kind: "artifact", id },
      `${path}.evidenceArtifactIds[${evidenceIndex}]`,
      issues,
    );
  });
}

function checkAction(
  action: ProposedThreadAction,
  index: number,
  references: Map<ThreadEntityKind, Set<string>>,
  violations: Map<string, ThreadViolation>,
  actions: Map<string, ProposedThreadAction>,
  links: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const path = `$.proposedActions[${index}]`;
  action.targets.forEach((target, targetIndex) =>
    checkReference(target, `${path}.targets[${targetIndex}]`, references, issues)
  );
  action.addressesViolationIds.forEach((id, violationIndex) => {
    if (!violations.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.addressesViolationIds[${violationIndex}]`,
        "does not reference a violation",
      );
    }
    requireLink(
      links,
      "addresses",
      { kind: "action", id: action.id },
      { kind: "violation", id },
      `${path}.addressesViolationIds[${violationIndex}]`,
      issues,
    );
  });
  action.dependsOnActionIds.forEach((id, dependencyIndex) => {
    if (!actions.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.dependsOnActionIds[${dependencyIndex}]`,
        "does not reference an action",
      );
    }
    if (id === action.id) {
      issue(
        issues,
        "self_dependency",
        `${path}.dependsOnActionIds[${dependencyIndex}]`,
        "an action cannot depend on itself",
      );
    }
  });
  if (action.readiness === "blocked" && !action.blockedReason) {
    issue(
      issues,
      "missing_blocked_reason",
      `${path}.blockedReason`,
      "is required for a blocked action",
    );
  }
  if (action.readiness === "ready" && action.blockedReason) {
    issue(
      issues,
      "unexpected_blocked_reason",
      `${path}.blockedReason`,
      "must be absent for a ready action",
    );
  }
}

function checkChange(
  change: ThreadChange,
  path: string,
  snapshot: ThreadSnapshot,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (
    change.target.kind !== "artifact" && change.target.kind !== "requirement" &&
    change.target.kind !== "observation" && change.target.kind !== "evaluation" &&
    change.target.kind !== "violation"
  ) {
    issue(
      issues,
      "invalid_change_target",
      `${path}.target.kind`,
      "must be artifact, requirement, observation, evaluation or violation",
    );
  }
  const exists = entityExists(snapshot, change.target);
  if (change.kind !== "deleted" && !exists) {
    issue(
      issues,
      "missing_reference",
      `${path}.target`,
      "does not reference a current entity",
    );
  }
  const currentArtifact = change.target.kind === "artifact"
    ? snapshot.artifacts.find((item) => item.id === change.target.id)
    : undefined;
  if (
    currentArtifact && change.afterFingerprint &&
    fingerprintKey(currentArtifact.fingerprint) !==
      fingerprintKey(change.afterFingerprint)
  ) {
    issue(
      issues,
      "current_fingerprint_mismatch",
      `${path}.afterFingerprint`,
      "must equal the current artifact fingerprint",
    );
  }
  if (change.kind === "created") {
    if (change.beforeFingerprint) {
      issue(
        issues,
        "unexpected_fingerprint",
        `${path}.beforeFingerprint`,
        "must be absent for a created entity",
      );
    }
    if (!change.afterFingerprint) {
      issue(
        issues,
        "missing_fingerprint",
        `${path}.afterFingerprint`,
        "is required for a created entity",
      );
    }
  }
  if (change.kind === "modified") {
    if (!change.beforeFingerprint) {
      issue(
        issues,
        "missing_fingerprint",
        `${path}.beforeFingerprint`,
        "is required for a modified entity",
      );
    }
    if (!change.afterFingerprint) {
      issue(
        issues,
        "missing_fingerprint",
        `${path}.afterFingerprint`,
        "is required for a modified entity",
      );
    }
    if (
      change.beforeFingerprint && change.afterFingerprint &&
      fingerprintKey(change.beforeFingerprint) ===
        fingerprintKey(change.afterFingerprint)
    ) {
      issue(
        issues,
        "unchanged_fingerprint",
        path,
        "a modified entity must have different fingerprints",
      );
    }
  }
  if (change.kind === "deleted") {
    if (!change.beforeFingerprint) {
      issue(
        issues,
        "missing_fingerprint",
        `${path}.beforeFingerprint`,
        "is required for a deleted entity",
      );
    }
    if (change.afterFingerprint) {
      issue(
        issues,
        "unexpected_fingerprint",
        `${path}.afterFingerprint`,
        "must be absent for a deleted entity",
      );
    }
  }
  if (change.kind === "archived") {
    // Archival is an append-only status change: no content is altered,
    // so neither fingerprint is meaningful or expected.
    if (change.beforeFingerprint) {
      issue(
        issues,
        "unexpected_fingerprint",
        `${path}.beforeFingerprint`,
        "must be absent for an archived entity",
      );
    }
    if (change.afterFingerprint) {
      issue(
        issues,
        "unexpected_fingerprint",
        `${path}.afterFingerprint`,
        "must be absent for an archived entity",
      );
    }
  }
}

function entityExists(snapshot: ThreadSnapshot, reference: ThreadEntityRef): boolean {
  switch (reference.kind) {
    case "artifact":
      return snapshot.artifacts.some((item) => item.id === reference.id);
    case "requirement":
      return snapshot.requirements.some((item) => item.id === reference.id);
    case "observation":
      return snapshot.observations.some((item) => item.id === reference.id);
    case "evaluation":
      return snapshot.evaluations.some((item) => item.id === reference.id);
    case "violation":
      return snapshot.violations.some((item) => item.id === reference.id);
    default:
      return false;
  }
}

function checkFreshness(
  freshness: ThreadFreshness,
  path: string,
  changeIds: Set<string>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (
    (freshness.status === "stale" || freshness.status === "failed") && !freshness.reason
  ) {
    issue(
      issues,
      "missing_freshness_reason",
      `${path}.reason`,
      `is required for ${freshness.status}`,
    );
  }
  if (freshness.status === "fresh" && freshness.invalidatedByChangeIds.length > 0) {
    issue(
      issues,
      "fresh_but_invalidated",
      `${path}.invalidatedByChangeIds`,
      "must be empty when status is fresh",
    );
  }
  freshness.invalidatedByChangeIds.forEach((id, index) => {
    if (!changeIds.has(id)) {
      issue(
        issues,
        "missing_reference",
        `${path}.invalidatedByChangeIds[${index}]`,
        "does not reference a change in the current change set",
      );
    }
  });
}

function checkReference(
  reference: ThreadEntityRef,
  path: string,
  references: Map<ThreadEntityKind, Set<string>>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (!references.get(reference.kind)?.has(reference.id)) {
    issue(
      issues,
      "missing_reference",
      path,
      `does not reference an existing ${reference.kind}`,
    );
  }
}

function checkLinkShape(
  link: ThreadProvenanceLink,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const allowed: Record<
    ThreadProvenanceLink["relation"],
    readonly [ThreadEntityKind[], ThreadEntityKind[]]
  > = {
    changes: [["change"], [
      "artifact",
      "requirement",
      "observation",
      "evaluation",
      "violation",
    ]],
    derived_from: [["artifact", "observation"], ["artifact", "observation"]],
    // traces_to is requirement-to-model traceability and historical
    // evidence-to-design anchoring (geometry bundle → recorded STEP/GLB).
    // It never implies inputs or verified consumptions. PartDefinition →
    // STEP is `represented_by` on the BFF structure graph, not traces_to.
    traces_to: [["requirement", "artifact"], ["artifact"]],
    uses: [["evaluation", "consumption"], ["observation", "artifact"]],
    evaluates: [["evaluation"], ["requirement"]],
    evidences: [["evaluation", "violation"], ["artifact"]],
    caused_by: [["violation"], ["evaluation"]],
    addresses: [["action"], ["violation"]],
    supersedes: [["artifact", "requirement"], ["artifact", "requirement"]],
  };
  const [fromKinds, toKinds] = allowed[link.relation];
  if (!fromKinds.includes(link.from.kind) || !toKinds.includes(link.to.kind)) {
    issue(
      issues,
      "invalid_provenance_shape",
      path,
      `${link.relation} does not support ${link.from.kind} -> ${link.to.kind}`,
    );
  }
  if (link.from.kind === link.to.kind && link.from.id === link.to.id) {
    issue(issues, "self_link", path, "a provenance link cannot point to itself");
  }
}

function checkMechanicalLink(
  link: ThreadProvenanceLink,
  path: string,
  artifacts: Map<string, ThreadArtifact>,
  consumptions: Map<string, ThreadArtifactConsumption>,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (
    link.relation !== "derived_from" || link.from.kind !== "artifact" ||
    link.to.kind !== "artifact"
  ) return;

  const downstream = artifacts.get(link.from.id);
  const upstream = artifacts.get(link.to.id);
  if (!downstream || !upstream) return;
  if (!downstream.inputArtifactIds.includes(upstream.id)) {
    issue(
      issues,
      "unbound_derivation",
      path,
      "artifact derivation must be declared in the downstream inputArtifactIds",
    );
    return;
  }
  const verified = [...consumptions.values()].some((consumption) =>
    consumption.artifactId === upstream.id &&
    sameOperation(consumption.consumer, downstream.producer) &&
    consumption.status === "verified" &&
    fingerprintKey(consumption.observedFingerprint) ===
      fingerprintKey(upstream.fingerprint)
  );
  if (!verified) {
    issue(
      issues,
      "unverified_derivation",
      path,
      "artifact derivation requires equal producer and consumer fingerprints",
    );
  }
}

function requireLink(
  links: Set<string>,
  relation: ThreadProvenanceLink["relation"],
  from: ThreadEntityRef,
  to: ThreadEntityRef,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const expected = linkKey({ relation, from, to });
  if (!links.has(expected)) {
    issue(
      issues,
      "missing_provenance",
      path,
      `requires ${relation} provenance from ${from.kind}:${from.id} to ${to.kind}:${to.id}`,
    );
  }
}

function linkKey(
  link: Pick<ThreadProvenanceLink, "relation" | "from" | "to">,
): string {
  return `${link.relation}:${link.from.kind}:${link.from.id}->${link.to.kind}:${link.to.id}`;
}

function aggregateFreshness(
  statuses: ThreadFreshness["status"][],
): ThreadFreshness["status"] {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("stale")) return "stale";
  return "fresh";
}

function checkDependencyCycles(
  graph: ReadonlyArray<readonly [string, readonly string[]]>,
  path: string,
  code: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  const dependencies = new Map(graph);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      if (!reported.has(id)) {
        issue(issues, code, path, `dependency cycle includes ${id}`);
        reported.add(id);
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of dependencies.keys()) visit(id);
}

function indexed<T extends { id: string }>(
  values: readonly T[],
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  values.forEach((value, index) => {
    if (result.has(value.id)) {
      issue(issues, "duplicate_id", `${path}[${index}].id`, `duplicates ${value.id}`);
    } else {
      result.set(value.id, value);
    }
  });
  return result;
}

function fingerprintKey(fingerprint: ContentFingerprint): string {
  return `${fingerprint.algorithm}:${fingerprint.digest.toLowerCase()}`;
}

function sameOperation(left: ThreadOperationRef, right: ThreadOperationRef): boolean {
  return left.serverId === right.serverId && left.tool === right.tool &&
    left.runId === right.runId;
}

function validateArray(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
  validateItem: (
    value: unknown,
    path: string,
    issues: ThreadSnapshotValidationIssue[],
  ) => void,
): void {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_type", path, "must be an array");
    return;
  }
  value.forEach((item, index) => validateItem(item, `${path}[${index}]`, issues));
}

function stringArray(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_type", path, "must be an array");
    return;
  }
  value.forEach((item, index) => nonEmptyString(item, `${path}[${index}]`, issues));
  const strings = value.filter((item): item is string => typeof item === "string");
  if (new Set(strings).size !== strings.length) {
    issue(issues, "duplicate_value", path, "must not contain duplicates");
  }
}

function exactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: ThreadSnapshotValidationIssue[],
): Record<string, unknown> | undefined {
  const input = record(value, path, issues);
  if (!input) return undefined;

  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(input, key)) {
      issue(issues, "missing_property", `${path}.${key}`, "is required");
    }
  }
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      issue(issues, "unknown_property", `${path}.${key}`, "is not allowed");
    }
  }
  return input;
}

function record(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issue(issues, "invalid_type", path, "must be an object");
    return undefined;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    issue(issues, "invalid_string", path, "must be a non-empty string");
    return false;
  }
  return true;
}

function optionalNonEmptyString(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (value !== undefined) nonEmptyString(value, path, issues);
}

function finiteNumber(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(issues, "invalid_number", path, "must be a finite number");
  }
}

function positiveInteger(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    issue(issues, "invalid_integer", path, "must be a positive safe integer");
  }
}

function isoDateTime(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (!nonEmptyString(value, path, issues)) return;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    issue(issues, "invalid_datetime", path, "must be an ISO 8601 UTC date-time");
  }
}

function optionalIsoDateTime(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (value !== undefined) isoDateTime(value, path, issues);
}

function literal(
  value: unknown,
  expected: string,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (value !== expected) {
    issue(issues, "invalid_literal", path, `must be ${expected}`);
  }
}

function oneOf(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: ThreadSnapshotValidationIssue[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issue(issues, "invalid_enum", path, `must be one of ${allowed.join(", ")}`);
  }
}

function validateJsonValue(
  value: unknown,
  path: string,
  issues: ThreadSnapshotValidationIssue[],
  ancestors: Set<object>,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(issues, "not_json", path, "JSON numbers must be finite");
    }
    return;
  }
  if (typeof value !== "object") {
    issue(issues, "not_json", path, `contains unsupported ${typeof value}`);
    return;
  }
  if (ancestors.has(value)) {
    issue(issues, "not_json", path, "contains a circular reference");
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    issue(issues, "not_json", path, "must contain only plain JSON objects");
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, issues, ancestors)
    );
  } else {
    Object.entries(value).forEach(([key, item]) =>
      validateJsonValue(item, `${path}.${key}`, issues, ancestors)
    );
  }
  ancestors.delete(value);
}

function issue(
  issues: ThreadSnapshotValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}
