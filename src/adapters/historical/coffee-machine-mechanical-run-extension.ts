import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type {
  ContentFingerprint,
  EngineeringQuantity,
  ProposedThreadAction,
  RequirementEvaluation,
  RequirementEvaluationStatus,
  RequirementOperator,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadViolation,
  TracedRequirement,
} from "../../domain/thread-snapshot.ts";
import type { ThreadSnapshotExtension } from "../../domain/thread-snapshot-extension.ts";

export const COFFEE_MACHINE_MECHANICAL_CAPTURE_SCHEMA =
  "coffee-machine-mechanical-run/1.0" as const;
export const COFFEE_MACHINE_MECHANICAL_SUBJECT_ID = "coffee-machine-cm01" as const;
export const COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID =
  "01942665-3ded-4d3a-9902-08691eae190e" as const;
export const COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID =
  "09e35cdc-5bca-4234-a765-5640b313e93f" as const;
const WORKFLOW_ID = "coffee-machine-mechanical-v1";
const DECISION_ID = "review-mechanical-proof-case";
const WORK_ITEM_ID = "verify-current-mechanical-design";
const SHA256 = /^[a-f0-9]{64}$/;
const EXPECTED_NODE_IDS = [
  "requirements",
  "mechanical",
  "observations",
  "evaluation",
] as const;

export interface CoffeeMachineMechanicalRunExtensionOptions {
  readonly runId: string;
  readonly sourceUri?: string;
}

interface ParsedCapture {
  capturedAt: string;
  runId: string;
  subjectId: string;
  authorization: Record<string, unknown>;
  proofCase: ProofCase;
  sysml: {
    editingContextId: string;
    requirementsElementId: string;
    constraints: Constraint[];
  };
  cad: {
    toolCall: Record<string, unknown>;
    artifact: StepArtifact;
  };
  nodes: {
    requirements: SuccessfulNode;
    mechanical: SuccessfulNode;
    observations: SuccessfulNode;
    evaluation: SuccessfulNode;
  };
  results: EvaluationResult[];
}

interface ProofCase {
  analysisScope: string;
  dimensionsMm: [number, number, number];
  materialBasis: string;
  youngModulusMpa: number;
  poissonRatio: number;
  fixedRegion: "rear-vertical-face";
  loadCase: string;
  loadForceN: [number, number, number];
  meshSizeMm: number;
  maxVonMisesMpa: number;
  maxDisplacementMm: number;
  evidenceBoundary: string;
}

interface StepArtifact {
  format: "step";
  path: string;
  bytes: number;
  sha256: string;
}

interface SuccessfulNode {
  nodeId: string;
  server: string;
  tool: string;
  status: "succeeded";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  arguments: Record<string, unknown>;
  outputs: Record<string, unknown>;
  structuredContent: Record<string, unknown>;
  summary?: string;
}

interface Constraint {
  id: string;
  name: string;
  sourceId: string;
  feature: "assembly_max_displacement" | "assembly_max_von_mises";
  operator: "<=";
  limit: EngineeringQuantity;
  raw: Record<string, unknown>;
}

type MechanicalValues = Record<Constraint["feature"], EngineeringQuantity>;

interface EvaluationResult {
  constraintId: string;
  constraintName: string;
  status: RequirementEvaluationStatus;
  expression: string;
  computedValue?: number;
  threshold?: number;
  margin?: number;
  marginPercent?: number;
  unit?: string;
  error?: string;
  unresolvedRefs?: string[];
}

/**
 * Validate one successful, reviewed mechanical capture and project it into a
 * complete canonical evidence branch. No fixture or optimistic local verdict
 * is used: every quantity and status comes from the captured provider results.
 */
export async function materializeCoffeeMachineMechanicalRunExtension(
  value: unknown,
  options: CoffeeMachineMechanicalRunExtensionOptions,
): Promise<ThreadSnapshotExtension> {
  const runId = safeId(options.runId, "$options.runId");
  const sourceUri = options.sourceUri === undefined
    ? undefined
    : nonEmptyString(options.sourceUri, "$options.sourceUri");
  const capture = await parseCapture(value, runId);
  const prefix = `coffee-machine-mechanical-${runId}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const operations = {
    case: operation("digital-thread", "run_coffee_machine_mechanical", runId),
    cad: operation("build123d", "build123d_export", runId),
    constraints: operation("syson", "syson_constraint_extract", runId),
    mechanical: operation("calculix", "calculix_solve_static", runId),
    evaluation: operation("syson", "syson_constraint_evaluate", runId),
  };
  const fingerprints = {
    case: await sha256Fingerprint({
      authorization: capture.authorization,
      proofCase: capture.proofCase,
      cadToolCall: capture.cad.toolCall,
      mechanicalArguments: capture.nodes.mechanical.arguments,
    }),
    constraints: await sha256Fingerprint(
      capture.nodes.requirements.structuredContent,
    ),
    mechanical: await sha256Fingerprint(
      capture.nodes.mechanical.structuredContent,
    ),
    evaluation: await sha256Fingerprint(
      capture.nodes.evaluation.structuredContent,
    ),
  };
  const ids = {
    case: `${prefix}-analysis-case`,
    constraints: `${prefix}-constraint-extract`,
    step: `${prefix}-step`,
    mechanical: `${prefix}-calculix-result`,
    evaluation: `${prefix}-syson-evaluation`,
  };
  const artifacts: ThreadArtifact[] = [
    artifact({
      id: ids.case,
      name: "Approved CM-01 drip-tray analysis case",
      kind: "document",
      fingerprint: fingerprints.case,
      uri: fragment(sourceUri, "authorization"),
      producer: operations.case,
      freshness,
    }),
    artifact({
      id: ids.constraints,
      name: "SysON model-owned mechanical constraints",
      kind: "sysml-model",
      fingerprint: fingerprints.constraints,
      uri: fragment(sourceUri, "workflow.nodes.requirements.structuredContent"),
      producer: operations.constraints,
      freshness,
    }),
    artifact({
      id: ids.step,
      name: "CM-01 drip-tray STEP",
      kind: "step",
      fingerprint: fingerprint(capture.cad.artifact.sha256),
      uri: capture.cad.artifact.path,
      mediaType: "model/step",
      producer: operations.cad,
      freshness,
    }),
    artifact({
      id: ids.mechanical,
      name: "CM-01 CalculiX static result",
      kind: "solver-result",
      fingerprint: fingerprints.mechanical,
      uri: fragment(sourceUri, "workflow.nodes.mechanical.structuredContent"),
      producer: operations.mechanical,
      inputArtifactIds: [ids.step],
      freshness,
    }),
    artifact({
      id: ids.evaluation,
      name: "CM-01 SysON mechanical evaluation",
      kind: "evidence",
      fingerprint: fingerprints.evaluation,
      uri: fragment(sourceUri, "workflow.nodes.evaluation.structuredContent"),
      producer: operations.evaluation,
      freshness,
    }),
  ];
  const consumptionId = `${prefix}-calculix-consumes-step`;
  const consumptions: ThreadArtifactConsumption[] = [{
    id: consumptionId,
    artifactId: ids.step,
    consumer: operations.mechanical,
    observedFingerprint: fingerprint(capture.cad.artifact.sha256),
    verifiedAt: capture.nodes.mechanical.completedAt,
    status: "verified",
  }];
  const metricBindings = metricBindingsFromCapture(capture, prefix);
  const observations: ThreadObservation[] = metricBindings.map((binding) => ({
    id: binding.observationId,
    name: binding.observationName,
    metric: binding.constraint.feature,
    quantity: structuredClone(binding.solverQuantity),
    source: {
      operation: operations.mechanical,
      artifactIds: [ids.mechanical],
      capturedAt: capture.nodes.mechanical.completedAt,
    },
    freshness,
  }));
  const requirements: TracedRequirement[] = metricBindings.map((binding) => ({
    id: binding.requirementId,
    name: binding.constraint.name,
    statement:
      `${binding.constraint.feature} <= ${binding.constraint.limit.value} [${binding.constraint.limit.unit}]`,
    version: fingerprints.constraints.digest.slice(0, 12),
    criterion: {
      metric: binding.constraint.feature,
      operator: binding.constraint.operator,
      limit: structuredClone(binding.constraint.limit),
    },
    trace: {
      sourceArtifactId: ids.constraints,
      elementId: binding.constraint.sourceId,
      targetArtifactIds: [ids.step],
    },
    freshness,
  }));
  const evaluations: RequirementEvaluation[] = metricBindings.map((binding) =>
    evaluationFromResult({
      binding,
      evaluatedAt: capture.nodes.evaluation.completedAt,
      evaluator: operations.evaluation,
      evidenceArtifactIds: [
        ids.case,
        ids.constraints,
        ids.mechanical,
        ids.evaluation,
      ],
      freshness,
    })
  );
  const violations: ThreadViolation[] = [];
  const proposedActions: ProposedThreadAction[] = [];
  for (const [index, evaluation] of evaluations.entries()) {
    if (evaluation.status !== "fail") continue;
    const binding = metricBindings[index];
    const violationId = `${prefix}-violation-${binding.constraint.feature}`;
    const actionId = `${prefix}-correct-${binding.constraint.feature}`;
    violations.push({
      id: violationId,
      name: `${binding.observationName} exceeds the reviewed limit`,
      requirementId: binding.requirementId,
      evaluationId: evaluation.id,
      severity: "error",
      status: "open",
      detectedAt: capture.nodes.evaluation.completedAt,
      observationIds: [binding.observationId],
      evidenceArtifactIds: [ids.mechanical, ids.evaluation],
      summary: evaluation.message,
      freshness,
    });
    proposedActions.push({
      id: actionId,
      name: `Correct ${binding.observationName.toLowerCase()}`,
      kind: "correct",
      readiness: "ready",
      rationale:
        "Revise the drip-tray design or reviewed analysis case, regenerate the STEP, and rerun the same attested verification loop.",
      targets: [
        { kind: "requirement", id: binding.requirementId },
        { kind: "observation", id: binding.observationId },
      ],
      addressesViolationIds: [violationId],
      dependsOnActionIds: [],
    });
  }
  const provenance: ThreadProvenanceLink[] = [
    link(
      `${prefix}-uses-step`,
      "uses",
      { kind: "consumption", id: consumptionId },
      { kind: "artifact", id: ids.step },
      "CalculiX attested the exact SHA-256 produced by build123d.",
    ),
    link(
      `${prefix}-result-derived-from-step`,
      "derived_from",
      { kind: "artifact", id: ids.mechanical },
      { kind: "artifact", id: ids.step },
      "The static result was computed from the attested STEP bytes.",
    ),
  ];
  for (const binding of metricBindings) {
    provenance.push(
      link(
        `${prefix}-${binding.constraint.feature}-from-calculix`,
        "derived_from",
        { kind: "observation", id: binding.observationId },
        { kind: "artifact", id: ids.mechanical },
        "The unit-bearing observation is the captured CalculiX metric.",
      ),
      link(
        `${prefix}-${binding.constraint.feature}-traces-step`,
        "traces_to",
        { kind: "requirement", id: binding.requirementId },
        { kind: "artifact", id: ids.step },
        "The SysON constraint was inserted under the traced DripTray definition and governs this exact STEP proof artifact.",
      ),
      link(
        `${prefix}-${binding.constraint.feature}-evaluates`,
        "evaluates",
        { kind: "evaluation", id: binding.evaluationId },
        { kind: "requirement", id: binding.requirementId },
        "SysON evaluated this exact model-owned constraint.",
      ),
      link(
        `${prefix}-${binding.constraint.feature}-uses-observation`,
        "uses",
        { kind: "evaluation", id: binding.evaluationId },
        { kind: "observation", id: binding.observationId },
        "The evaluation used the normalized CalculiX observation.",
      ),
    );
    for (
      const artifactId of [
        ids.case,
        ids.constraints,
        ids.mechanical,
        ids.evaluation,
      ]
    ) {
      provenance.push(link(
        `${prefix}-${binding.constraint.feature}-evidenced-by-${artifactId}`,
        "evidences",
        { kind: "evaluation", id: binding.evaluationId },
        { kind: "artifact", id: artifactId },
        "The verdict is bound to the approved case and captured provider evidence.",
      ));
    }
  }
  for (const [index, violation] of violations.entries()) {
    const action = proposedActions[index];
    provenance.push(
      link(
        `${violation.id}-caused-by-${violation.evaluationId}`,
        "caused_by",
        { kind: "violation", id: violation.id },
        { kind: "evaluation", id: violation.evaluationId },
        "The named violation exists because the units-aware evaluation failed.",
      ),
      ...violation.evidenceArtifactIds.map((artifactId) =>
        link(
          `${violation.id}-evidenced-by-${artifactId}`,
          "evidences",
          { kind: "violation", id: violation.id },
          { kind: "artifact", id: artifactId },
          "The captured solver and SysON outputs support this violation.",
        )
      ),
      link(
        `${action.id}-addresses-${violation.id}`,
        "addresses",
        { kind: "action", id: action.id },
        { kind: "violation", id: violation.id },
        "The correction action closes the failed mechanical criterion.",
      ),
    );
  }

  return {
    id: `${prefix}-extension`,
    name: "Publish the reviewed CM-01 drip-tray mechanical proof",
    subjectId: COFFEE_MACHINE_MECHANICAL_SUBJECT_ID,
    capturedAt: capture.capturedAt,
    artifacts,
    consumptions,
    observations,
    requirements,
    evaluations,
    violations,
    provenance,
    proposedActions,
  };
}

interface MetricBinding {
  constraint: Constraint;
  result: EvaluationResult;
  solverQuantity: EngineeringQuantity;
  observationId: string;
  observationName: string;
  requirementId: string;
  evaluationId: string;
}

function metricBindingsFromCapture(
  capture: ParsedCapture,
  prefix: string,
): MetricBinding[] {
  const results = new Map(
    capture.results.map((result) => [result.constraintId, result]),
  );
  return capture.sysml.constraints.map((constraint) => {
    const displacement = constraint.feature === "assembly_max_displacement";
    const solverQuantity = quantity(
      capture.nodes.mechanical.structuredContent,
      displacement ? ["metrics", "maxDisplacement"] : ["metrics", "maxVonMises"],
      `mechanical ${constraint.feature}`,
    );
    const result = results.get(constraint.id)!;
    return {
      constraint,
      result,
      solverQuantity,
      observationId: `${prefix}-observation-${constraint.feature}`,
      observationName: displacement
        ? "Maximum drip-tray displacement"
        : "Maximum drip-tray von Mises stress",
      requirementId: `${prefix}-requirement-${constraint.id}`,
      evaluationId: `${prefix}-evaluation-${constraint.id}`,
    };
  });
}

function evaluationFromResult(input: {
  binding: MetricBinding;
  evaluatedAt: string;
  evaluator: ThreadOperationRef;
  evidenceArtifactIds: string[];
  freshness: ThreadFreshness;
}): RequirementEvaluation {
  const { binding } = input;
  const result = binding.result;
  const comparison = result.status === "pass" || result.status === "fail"
    ? {
      observationId: binding.observationId,
      actual: { value: result.computedValue!, unit: result.unit! },
      operator: binding.constraint.operator as RequirementOperator,
      limit: { value: result.threshold!, unit: result.unit! },
      normalizedUnit: result.unit!,
      margin: { value: result.margin!, unit: result.unit! },
    }
    : undefined;
  const message = result.status === "pass"
    ? `${binding.observationName} satisfies the reviewed limit with a ${result.margin} ${result.unit} margin.`
    : result.status === "fail"
    ? `${binding.observationName} violates the reviewed limit by ${
      Math.abs(result.margin!)
    } ${result.unit}.`
    : result.status === "unresolved"
    ? `SysON could not resolve: ${
      (result.unresolvedRefs ?? []).join(", ") || "required value"
    }.`
    : result.error ?? "SysON reported an evaluation error.";
  return {
    id: binding.evaluationId,
    name: `Evaluate ${binding.constraint.name}`,
    requirementId: binding.requirementId,
    observationIds: [binding.observationId],
    status: result.status,
    evaluatedAt: input.evaluatedAt,
    evaluator: input.evaluator,
    ...(comparison ? { comparison } : {}),
    evidenceArtifactIds: input.evidenceArtifactIds,
    message,
    freshness: input.freshness,
  };
}

async function parseCapture(
  value: unknown,
  expectedRunId: string,
): Promise<ParsedCapture> {
  assertJson(value, "$capture", new Set());
  const root = object(value, "$capture");
  exactKeys(root, [
    "schemaVersion",
    "capturedAt",
    "runId",
    "subjectId",
    "project",
    "authorization",
    "proofCase",
    "sysml",
    "cad",
    "workflow",
  ], "$capture");
  exact(
    root.schemaVersion,
    COFFEE_MACHINE_MECHANICAL_CAPTURE_SCHEMA,
    "$capture.schemaVersion",
  );
  const sourceCapturedAt = isoDate(root.capturedAt, "$capture.capturedAt");
  exact(root.runId, expectedRunId, "$capture.runId");
  exact(root.subjectId, COFFEE_MACHINE_MECHANICAL_SUBJECT_ID, "$capture.subjectId");
  validateProject(root.project);
  const authorization = await validateAuthorization(root.authorization);
  const proofCase = validateProofCase(root.proofCase, authorization);
  const sysml = validateSysml(root.sysml, proofCase);
  const cad = validateCad(root.cad, proofCase, authorization);
  const workflow = object(root.workflow, "$capture.workflow");
  exactKeys(workflow, [
    "workflowId",
    "status",
    "startedAt",
    "completedAt",
    "nodes",
  ], "$capture.workflow");
  exact(workflow.workflowId, WORKFLOW_ID, "$capture.workflow.workflowId");
  exact(workflow.status, "succeeded", "$capture.workflow.status");
  const workflowStartedAt = isoDate(
    workflow.startedAt,
    "$capture.workflow.startedAt",
  );
  const workflowCompletedAt = isoDate(
    workflow.completedAt,
    "$capture.workflow.completedAt",
  );
  const rawNodes = array(workflow.nodes, "$capture.workflow.nodes");
  if (rawNodes.length !== EXPECTED_NODE_IDS.length) {
    throw new Error(
      "$capture.workflow.nodes must contain exactly four successful nodes.",
    );
  }
  const parsedNodes = rawNodes.map((node, index) =>
    validateSuccessfulNode(
      node,
      EXPECTED_NODE_IDS[index],
      `$capture.workflow.nodes[${index}]`,
    )
  );
  const nodes = {
    requirements: parsedNodes[0],
    mechanical: parsedNodes[1],
    observations: parsedNodes[2],
    evaluation: parsedNodes[3],
  };
  validateWorkflowTimeline({
    sourceCapturedAt,
    workflowStartedAt,
    workflowCompletedAt,
    nodes,
  });
  assertNodeIdentities(nodes);
  validateEffectiveArguments({ proofCase, sysml, cad, nodes });
  const results = validateWorkflowEvidence({ proofCase, sysml, cad, nodes });
  return {
    capturedAt: workflowCompletedAt,
    runId: expectedRunId,
    subjectId: COFFEE_MACHINE_MECHANICAL_SUBJECT_ID,
    authorization,
    proofCase,
    sysml,
    cad,
    nodes,
    results,
  };
}

function validateWorkflowTimeline(input: {
  sourceCapturedAt: string;
  workflowStartedAt: string;
  workflowCompletedAt: string;
  nodes: ParsedCapture["nodes"];
}): void {
  const sourceCapturedAt = Date.parse(input.sourceCapturedAt);
  const workflowStartedAt = Date.parse(input.workflowStartedAt);
  const workflowCompletedAt = Date.parse(input.workflowCompletedAt);
  if (sourceCapturedAt > workflowStartedAt) {
    throw new Error(
      "$capture.capturedAt must not follow $capture.workflow.startedAt.",
    );
  }
  if (workflowStartedAt > workflowCompletedAt) {
    throw new Error(
      "$capture.workflow.completedAt must not precede workflow start.",
    );
  }
  for (const node of Object.values(input.nodes)) {
    const startedAt = Date.parse(node.startedAt);
    const completedAt = Date.parse(node.completedAt);
    if (startedAt < workflowStartedAt) {
      throw new Error(
        `$capture.workflow.completedAt cannot publish ${node.nodeId}: its start precedes the workflow.`,
      );
    }
    if (completedAt < startedAt) {
      throw new Error(
        `$capture.workflow.nodes.${node.nodeId}.completedAt must not precede its start.`,
      );
    }
    if (completedAt > workflowCompletedAt) {
      throw new Error(
        `$capture.workflow.completedAt must not precede captured ${node.nodeId} evidence.`,
      );
    }
  }
  assertCausalOrder(input.nodes.requirements, input.nodes.mechanical);
  assertCausalOrder(input.nodes.mechanical, input.nodes.observations);
  assertCausalOrder(input.nodes.observations, input.nodes.evaluation);
}

function assertCausalOrder(
  predecessor: SuccessfulNode,
  successor: SuccessfulNode,
): void {
  if (Date.parse(predecessor.completedAt) > Date.parse(successor.startedAt)) {
    throw new Error(
      `$capture.workflow.nodes.${successor.nodeId}.startedAt must not precede ` +
        `$capture.workflow.nodes.${predecessor.nodeId}.completedAt in the causal workflow.`,
    );
  }
}

function validateProject(value: unknown): void {
  const project = object(value, "$capture.project");
  exactKeys(project, ["id", "snapshotId", "revision"], "$capture.project");
  exact(project.id, COFFEE_MACHINE_MECHANICAL_SUBJECT_ID, "$capture.project.id");
  nonEmptyString(project.snapshotId, "$capture.project.snapshotId");
  positiveInteger(project.revision, "$capture.project.revision");
}

async function validateAuthorization(value: unknown): Promise<Record<string, unknown>> {
  const auth = object(value, "$capture.authorization");
  exactKeys(auth, [
    "decisionId",
    "decisionInputFingerprint",
    "approvedBy",
    "approvedProposal",
    "inputEvidenceRefs",
    "runInputFingerprint",
    "queuedBy",
    "claimedBy",
    "baseSnapshotId",
    "baseSnapshotRevision",
    "baseSnapshotSubjectId",
  ], "$capture.authorization");
  exact(auth.decisionId, DECISION_ID, "$capture.authorization.decisionId");
  const decisionDigest = sha(
    auth.decisionInputFingerprint,
    "$capture.authorization.decisionInputFingerprint",
  );
  nonEmptyString(auth.approvedBy, "$capture.authorization.approvedBy");
  nonEmptyString(auth.queuedBy, "$capture.authorization.queuedBy");
  nonEmptyString(auth.claimedBy, "$capture.authorization.claimedBy");
  const runDigest = sha(
    auth.runInputFingerprint,
    "$capture.authorization.runInputFingerprint",
  );
  const baseSnapshot = {
    snapshotId: nonEmptyString(
      auth.baseSnapshotId,
      "$capture.authorization.baseSnapshotId",
    ),
    revision: positiveInteger(
      auth.baseSnapshotRevision,
      "$capture.authorization.baseSnapshotRevision",
    ),
    subjectId: nonEmptyString(
      auth.baseSnapshotSubjectId,
      "$capture.authorization.baseSnapshotSubjectId",
    ),
  };
  exact(
    baseSnapshot.subjectId,
    COFFEE_MACHINE_MECHANICAL_SUBJECT_ID,
    "$capture.authorization.baseSnapshotSubjectId",
  );
  const proposal = object(
    auth.approvedProposal,
    "$capture.authorization.approvedProposal",
  );
  exactKeys(
    proposal,
    ["summary", "parameters"],
    "$capture.authorization.approvedProposal",
  );
  nonEmptyString(proposal.summary, "$capture.authorization.approvedProposal.summary");
  validateProposalParameters(proposal.parameters);
  validateEvidenceRefs(auth.inputEvidenceRefs);
  const expectedDecision = await sha256Fingerprint({
    baseSnapshot,
    inputEvidenceRefs: auth.inputEvidenceRefs,
    proposal,
  });
  if (expectedDecision.digest !== decisionDigest) {
    throw new Error(
      "$capture.authorization decision fingerprint does not match the approved proposal.",
    );
  }
  const expectedRun = await sha256Fingerprint({
    workItemId: WORK_ITEM_ID,
    baseSnapshot,
    decisionBindings: [{
      id: DECISION_ID,
      inputFingerprint: { algorithm: "sha256", digest: decisionDigest },
    }],
  });
  if (expectedRun.digest !== runDigest) {
    throw new Error(
      "$capture.authorization run fingerprint does not bind the approved decision.",
    );
  }
  return structuredClone(auth);
}

function validateEvidenceRefs(value: unknown): void {
  const refs = array(value, "$capture.authorization.inputEvidenceRefs");
  if (refs.length === 0) throw new Error("Approved input evidence must not be empty.");
  for (const [index, raw] of refs.entries()) {
    const path = `$capture.authorization.inputEvidenceRefs[${index}]`;
    const ref = object(raw, path);
    exactKeys(ref, ["snapshotId", "snapshotRevision", "kind", "id"], path);
    nonEmptyString(ref.snapshotId, `${path}.snapshotId`);
    positiveInteger(ref.snapshotRevision, `${path}.snapshotRevision`);
    nonEmptyString(ref.kind, `${path}.kind`);
    nonEmptyString(ref.id, `${path}.id`);
  }
}

function validateProposalParameters(value: unknown): void {
  const parameters = array(value, "$capture.authorization.approvedProposal.parameters");
  if (parameters.length !== 10) {
    throw new Error("Approved proposal must contain exactly ten parameters.");
  }
  const keys = new Set<string>();
  for (const [index, raw] of parameters.entries()) {
    const path = `$capture.authorization.approvedProposal.parameters[${index}]`;
    const parameter = object(raw, path);
    exactKeys(parameter, ["key", "label", "value", "unit"], path, true);
    const key = nonEmptyString(parameter.key, `${path}.key`);
    if (keys.has(key)) throw new Error(`Duplicate approved proposal parameter ${key}.`);
    keys.add(key);
    nonEmptyString(parameter.label, `${path}.label`);
    if (!["string", "number", "boolean"].includes(typeof parameter.value)) {
      throw new Error(`${path}.value must be a scalar.`);
    }
    if (typeof parameter.value === "number") finite(parameter.value, `${path}.value`);
    if (parameter.unit !== undefined) nonEmptyString(parameter.unit, `${path}.unit`);
  }
}

function validateProofCase(
  value: unknown,
  authorization: Record<string, unknown>,
): ProofCase {
  const proof = object(value, "$capture.proofCase");
  exactKeys(proof, [
    "analysisScope",
    "dimensionsMm",
    "materialBasis",
    "youngModulusMpa",
    "poissonRatio",
    "fixedRegion",
    "loadCase",
    "loadForceN",
    "meshSizeMm",
    "maxVonMisesMpa",
    "maxDisplacementMm",
    "evidenceBoundary",
  ], "$capture.proofCase");
  const proposal = object(
    authorization.approvedProposal,
    "authorization.approvedProposal",
  );
  const parameters = new Map(
    array(proposal.parameters, "authorization.approvedProposal.parameters").map(
      (raw) => {
        const parameter = object(raw, "proposal parameter");
        return [String(parameter.key), parameter] as const;
      },
    ),
  );
  const expected = proofCaseFromParameters(parameters);
  if (deterministicJson(proof) !== deterministicJson(expected)) {
    throw new Error("$capture.proofCase does not exactly match the approved proposal.");
  }
  return expected;
}

function proofCaseFromParameters(
  parameters: ReadonlyMap<string, Record<string, unknown>>,
): ProofCase {
  const text = (key: string): string => {
    const value = parameters.get(key)?.value;
    return nonEmptyString(value, `proposal.${key}.value`);
  };
  const number = (key: string, unit: string): number => {
    const parameter = parameters.get(key);
    exact(parameter?.unit, unit, `proposal.${key}.unit`);
    return positive(parameter?.value, `proposal.${key}.value`);
  };
  const analysisScope = text("analysis_scope");
  const dimensions = analysisScope.match(
    /^CM-01 drip tray; isolated current CAD component, ([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) mm$/,
  );
  if (!dimensions) throw new Error("Approved scope is not one typed drip-tray box.");
  const fixed = text("fixed_region");
  exact(fixed, "Rear vertical face fully fixed", "proposal.fixed_region.value");
  const loadCase = text("load_case");
  const load = loadCase.match(
    /^([0-9]+(?:\.[0-9]+)?) N total downward force on the front vertical face(?: \(about [^)]+\))?$/,
  );
  if (!load) throw new Error("Approved load is not one typed downward face force.");
  const poisson = number("poisson_ratio", "1");
  if (poisson >= 0.5) throw new Error("Approved Poisson ratio must be below 0.5.");
  return {
    analysisScope,
    dimensionsMm: dimensions.slice(1).map(Number) as [number, number, number],
    materialBasis: text("material_basis"),
    youngModulusMpa: number("young_modulus_mpa", "MPa"),
    poissonRatio: poisson,
    fixedRegion: "rear-vertical-face",
    loadCase,
    loadForceN: [0, 0, -positive(Number(load[1]), "proposal.load_case.force")],
    meshSizeMm: number("mesh_size_mm", "mm"),
    maxVonMisesMpa: number("max_von_mises_mpa", "MPa"),
    maxDisplacementMm: number("max_displacement_mm", "mm"),
    evidenceBoundary: text("evidence_boundary"),
  };
}

function validateSysml(value: unknown, proofCase: ProofCase): ParsedCapture["sysml"] {
  const sysml = object(value, "$capture.sysml");
  exactKeys(sysml, [
    "editingContextId",
    "requirementsElementId",
    "inserted",
    "constraints",
  ], "$capture.sysml");
  exact(
    sysml.editingContextId,
    COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID,
    "$capture.sysml.editingContextId",
  );
  exact(
    sysml.requirementsElementId,
    COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID,
    "$capture.sysml.requirementsElementId",
  );
  const editingContextId = COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID;
  const requirementsElementId = COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID;
  if (typeof sysml.inserted !== "boolean") {
    throw new Error("$capture.sysml.inserted must be boolean.");
  }
  const constraints = validateConstraints(
    sysml.constraints,
    proofCase,
    "$capture.sysml.constraints",
  );
  return { editingContextId, requirementsElementId, constraints };
}

function validateCad(
  value: unknown,
  proofCase: ProofCase,
  authorization: Record<string, unknown>,
): ParsedCapture["cad"] {
  const cad = object(value, "$capture.cad");
  exactKeys(cad, ["script", "toolCall", "artifact"], "$capture.cad");
  const expectedScript = [
    "from build123d import Align, Box",
    "",
    `result = Box(${
      proofCase.dimensionsMm.join(", ")
    }, align=(Align.CENTER, Align.CENTER, Align.CENTER))`,
  ].join("\n");
  exact(cad.script, expectedScript, "$capture.cad.script");
  const call = object(cad.toolCall, "$capture.cad.toolCall");
  exactKeys(call, ["name", "arguments"], "$capture.cad.toolCall");
  exact(call.name, "build123d_export", "$capture.cad.toolCall.name");
  const args = object(call.arguments, "$capture.cad.toolCall.arguments");
  exactKeys(
    args,
    ["script", "formats", "name", "timeout_ms"],
    "$capture.cad.toolCall.arguments",
  );
  exact(args.script, expectedScript, "$capture.cad.toolCall.arguments.script");
  exactArray(args.formats, ["step"], "$capture.cad.toolCall.arguments.formats");
  const digest = sha(
    authorization.decisionInputFingerprint,
    "authorization.decisionInputFingerprint",
  );
  exact(
    args.name,
    `cm01-drip-tray-${digest.slice(0, 16)}`,
    "$capture.cad.toolCall.arguments.name",
  );
  exact(args.timeout_ms, 120000, "$capture.cad.toolCall.arguments.timeout_ms");
  const rawArtifact = object(cad.artifact, "$capture.cad.artifact");
  exactKeys(
    rawArtifact,
    ["format", "path", "bytes", "sha256"],
    "$capture.cad.artifact",
  );
  exact(rawArtifact.format, "step", "$capture.cad.artifact.format");
  return {
    toolCall: structuredClone(call),
    artifact: {
      format: "step",
      path: nonEmptyString(rawArtifact.path, "$capture.cad.artifact.path"),
      bytes: positiveInteger(rawArtifact.bytes, "$capture.cad.artifact.bytes"),
      sha256: sha(rawArtifact.sha256, "$capture.cad.artifact.sha256"),
    },
  };
}

function validateSuccessfulNode(
  value: unknown,
  expectedId: string,
  path: string,
): SuccessfulNode {
  const node = object(value, path);
  exactKeys(
    node,
    [
      "nodeId",
      "server",
      "tool",
      "status",
      "startedAt",
      "completedAt",
      "durationMs",
      "arguments",
      "outputs",
      "structuredContent",
      "summary",
    ],
    path,
    true,
  );
  exact(node.nodeId, expectedId, `${path}.nodeId`);
  exact(node.status, "succeeded", `${path}.status`);
  return {
    nodeId: expectedId,
    server: nonEmptyString(node.server, `${path}.server`),
    tool: nonEmptyString(node.tool, `${path}.tool`),
    status: "succeeded",
    startedAt: isoDate(node.startedAt, `${path}.startedAt`),
    completedAt: isoDate(node.completedAt, `${path}.completedAt`),
    durationMs: nonNegative(node.durationMs, `${path}.durationMs`),
    arguments: structuredClone(object(node.arguments, `${path}.arguments`)),
    outputs: structuredClone(object(node.outputs, `${path}.outputs`)),
    structuredContent: structuredClone(
      object(node.structuredContent, `${path}.structuredContent`),
    ),
    ...(node.summary === undefined
      ? {}
      : { summary: nonEmptyString(node.summary, `${path}.summary`) }),
  };
}

function assertNodeIdentities(nodes: ParsedCapture["nodes"]): void {
  const expected = {
    requirements: ["syson", "syson_constraint_extract"],
    mechanical: ["calculix", "calculix_solve_static"],
    observations: ["digital-thread", "thread_observations_normalize"],
    evaluation: ["syson", "syson_constraint_evaluate"],
  } as const;
  for (const [id, [server, tool]] of Object.entries(expected)) {
    const node = nodes[id as keyof typeof nodes];
    exact(node.server, server, `workflow.${id}.server`);
    exact(node.tool, tool, `workflow.${id}.tool`);
  }
}

function validateEffectiveArguments(input: {
  proofCase: ProofCase;
  sysml: ParsedCapture["sysml"];
  cad: ParsedCapture["cad"];
  nodes: ParsedCapture["nodes"];
}): void {
  const { proofCase, sysml, cad, nodes } = input;
  const expectedRequirements = {
    editing_context_id: sysml.editingContextId,
    element_id: sysml.requirementsElementId,
  };
  same(nodes.requirements.arguments, expectedRequirements, "requirements arguments");
  const [x, y, z] = proofCase.dimensionsMm;
  const expectedMechanical = {
    step_path: cad.artifact.path,
    expected_step_sha256: cad.artifact.sha256,
    mesh_size_mm: proofCase.meshSizeMm,
    material: { e_mpa: proofCase.youngModulusMpa, nu: proofCase.poissonRatio },
    selections: [
      {
        name: "FIXED",
        box: {
          min: [-x / 2 - 1, y / 2 - 1, -z / 2 - 1],
          max: [x / 2 + 1, y / 2 + 1, z / 2 + 1],
        },
      },
      {
        name: "LOADED",
        box: {
          min: [-x / 2 - 1, -y / 2 - 1, -z / 2 - 1],
          max: [x / 2 + 1, -y / 2 + 1, z / 2 + 1],
        },
      },
    ],
    fixed: ["FIXED"],
    loads: [{ selection: "LOADED", force_n: proofCase.loadForceN }],
  };
  same(nodes.mechanical.arguments, expectedMechanical, "mechanical arguments");
}

function validateWorkflowEvidence(input: {
  proofCase: ProofCase;
  sysml: ParsedCapture["sysml"];
  cad: ParsedCapture["cad"];
  nodes: ParsedCapture["nodes"];
}): EvaluationResult[] {
  const { proofCase, sysml, cad, nodes } = input;
  const requirementsContent = nodes.requirements.structuredContent;
  if (
    Array.isArray(requirementsContent.errors) && requirementsContent.errors.length > 0
  ) {
    throw new Error("Captured SysON constraint extraction contains errors.");
  }
  if (
    requirementsContent.errors !== undefined &&
    !Array.isArray(requirementsContent.errors)
  ) {
    throw new Error("Captured SysON constraint errors must be an array.");
  }
  same(
    requirementsContent.constraints,
    sysml.constraints.map((item) => item.raw),
    "captured constraints",
  );
  same(
    nodes.requirements.outputs.constraints,
    requirementsContent.constraints,
    "requirements outputs",
  );
  const mechanicalContent = nodes.mechanical.structuredContent;
  exact(
    mechanicalContent.schemaVersion,
    "2.0",
    "mechanical.schemaVersion",
  );
  exact(mechanicalContent.kind, "static-solve", "mechanical.kind");
  const mechanicalConstraints = object(
    mechanicalContent.constraints,
    "mechanical.constraints",
  );
  exactKeys(
    mechanicalConstraints,
    ["fixedSelections", "loads"],
    "mechanical.constraints",
  );
  same(
    mechanicalConstraints.fixedSelections,
    ["FIXED"],
    "mechanical fixed selections",
  );
  same(
    mechanicalConstraints.loads,
    [{ selection: "LOADED", forceN: proofCase.loadForceN }],
    "mechanical loads",
  );
  const inputArtifact = object(
    mechanicalContent.inputArtifact,
    "mechanical.inputArtifact",
  );
  const consumedSha = sha(inputArtifact.sha256, "mechanical.inputArtifact.sha256");
  const outputSha = sha(
    nodes.mechanical.outputs.input_step_sha256,
    "mechanical.outputs.input_step_sha256",
  );
  if (
    new Set([
      cad.artifact.sha256,
      consumedSha,
      outputSha,
      String(nodes.mechanical.arguments.expected_step_sha256),
    ]).size !== 1
  ) {
    throw new Error("Mechanical capture does not prove one exact STEP fingerprint.");
  }
  const metrics = object(mechanicalContent.metrics, "mechanical.metrics");
  const displacementEvidence = object(
    metrics.maxDisplacement,
    "mechanical.metrics.maxDisplacement",
  );
  const stressEvidence = object(
    metrics.maxVonMises,
    "mechanical.metrics.maxVonMises",
  );
  const displacement = quantity(
    mechanicalContent,
    ["metrics", "maxDisplacement"],
    "max displacement",
  );
  const stress = quantity(
    mechanicalContent,
    ["metrics", "maxVonMises"],
    "max von Mises",
  );
  nonNegative(displacement.value, "mechanical.metrics.maxDisplacement.value");
  nonNegative(stress.value, "mechanical.metrics.maxVonMises.value");
  same(
    quantity(
      nodes.mechanical.outputs,
      ["max_displacement"],
      "mechanical displacement output",
    ),
    displacement,
    "mechanical displacement output",
  );
  same(
    quantity(
      nodes.mechanical.outputs,
      ["max_von_mises"],
      "mechanical stress output",
    ),
    stress,
    "mechanical stress output",
  );
  const expectedObservations = {
    observations: {
      assembly_max_displacement: {
        quantity: displacementEvidence,
        produced_by: "mechanical",
      },
      assembly_max_von_mises: {
        quantity: stressEvidence,
        produced_by: "mechanical",
      },
    },
    artifact_attestations: [{
      producer_sha256: cad.artifact.sha256,
      consumer_sha256: consumedSha,
      relation: "consumed_exact_artifact",
    }],
  };
  same(
    nodes.observations.arguments,
    expectedObservations,
    "observation normalization arguments",
  );
  const observationContent = nodes.observations.structuredContent;
  const normalizedValues: MechanicalValues = {
    assembly_max_displacement: quantity(
      observationContent,
      ["values", "assembly_max_displacement"],
      "normalized assembly_max_displacement",
    ),
    assembly_max_von_mises: quantity(
      observationContent,
      ["values", "assembly_max_von_mises"],
      "normalized assembly_max_von_mises",
    ),
  };
  const expectedNormalizedValues: MechanicalValues = {
    assembly_max_displacement: displacement,
    assembly_max_von_mises: stress,
  };
  same(
    observationContent.values,
    normalizedValues,
    "normalized values shape",
  );
  same(
    normalizedValues,
    expectedNormalizedValues,
    "normalized values derived from CalculiX",
  );
  const expectedNormalizationProvenance = {
    observations: {
      assembly_max_displacement: { producedBy: "mechanical" },
      assembly_max_von_mises: { producedBy: "mechanical" },
    },
    artifactAttestations: [{
      relation: "consumed_exact_artifact",
      producerSha256: cad.artifact.sha256,
      consumerSha256: consumedSha,
      status: "verified",
    }],
  };
  same(
    observationContent.provenance,
    expectedNormalizationProvenance,
    "normalized provenance derived from CalculiX",
  );
  same(
    nodes.observations.outputs.values,
    normalizedValues,
    "normalized values output",
  );
  same(
    nodes.observations.outputs.provenance,
    expectedNormalizationProvenance,
    "normalized provenance output",
  );
  const expectedEvaluation = {
    constraints: requirementsContent.constraints,
    values: observationContent.values,
  };
  same(nodes.evaluation.arguments, expectedEvaluation, "evaluation arguments");
  const evaluationContent = nodes.evaluation.structuredContent;
  same(
    nodes.evaluation.outputs.results,
    evaluationContent.results,
    "evaluation results output",
  );
  same(
    nodes.evaluation.outputs.summary,
    evaluationContent.summary,
    "evaluation summary output",
  );
  same(
    nodes.evaluation.outputs.resolved_values,
    evaluationContent.resolvedValues,
    "evaluation resolved values output",
  );
  same(
    evaluationContent.resolvedValues,
    observationContent.values,
    "evaluation resolved values",
  );
  const results = validateResults(
    evaluationContent.results,
    sysml.constraints,
    normalizedValues,
  );
  validateSummary(evaluationContent.summary, results);
  return results;
}

function validateConstraints(
  value: unknown,
  proofCase: ProofCase,
  path: string,
): Constraint[] {
  const raw = array(value, path);
  if (raw.length !== 2) {
    throw new Error(`${path} must contain exactly two constraints.`);
  }
  const expected = new Map<string, EngineeringQuantity>([
    ["assembly_max_displacement", { value: proofCase.maxDisplacementMm, unit: "mm" }],
    ["assembly_max_von_mises", {
      value: proofCase.maxVonMisesMpa * 1_000_000,
      unit: "Pa",
    }],
  ]);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const constraint = object(item, itemPath);
    const id = nonEmptyString(constraint.id, `${itemPath}.id`);
    const name = nonEmptyString(constraint.name, `${itemPath}.name`);
    const sourceId = constraint.sourceId === undefined
      ? id
      : nonEmptyString(constraint.sourceId, `${itemPath}.sourceId`);
    const expression = object(constraint.expression, `${itemPath}.expression`);
    exact(expression.kind, "binary", `${itemPath}.expression.kind`);
    exact(expression.op, "<=", `${itemPath}.expression.op`);
    const left = object(expression.left, `${itemPath}.expression.left`);
    exact(left.kind, "ref", `${itemPath}.expression.left.kind`);
    const featurePath = array(
      left.featurePath,
      `${itemPath}.expression.left.featurePath`,
    );
    if (featurePath.length !== 1 || typeof featurePath[0] !== "string") {
      throw new Error(`${itemPath} must reference one mechanical feature.`);
    }
    const feature = featurePath[0];
    const approved = expected.get(feature);
    if (!approved || seen.has(feature)) {
      throw new Error(`${itemPath} is unknown or duplicates a mechanical constraint.`);
    }
    const right = object(expression.right, `${itemPath}.expression.right`);
    exact(right.kind, "literal", `${itemPath}.expression.right.kind`);
    exact(right.value, approved.value, `${itemPath}.expression.right.value`);
    exact(right.unit, approved.unit, `${itemPath}.expression.right.unit`);
    seen.add(feature);
    return {
      id,
      name,
      sourceId,
      feature: feature as Constraint["feature"],
      operator: "<=",
      limit: approved,
      raw: structuredClone(constraint),
    };
  });
}

function validateResults(
  value: unknown,
  constraints: Constraint[],
  normalizedValues: MechanicalValues,
): EvaluationResult[] {
  const raw = array(value, "evaluation.results");
  if (raw.length !== constraints.length) {
    throw new Error("SysON evaluation must return exactly one result per constraint.");
  }
  const constraintsById = new Map(constraints.map((item) => [item.id, item]));
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const path = `evaluation.results[${index}]`;
    const result = object(item, path);
    const constraintId = nonEmptyString(result.constraintId, `${path}.constraintId`);
    const constraint = constraintsById.get(constraintId);
    if (!constraint || seen.has(constraintId)) {
      throw new Error(`${path} is unknown or duplicates a constraint result.`);
    }
    seen.add(constraintId);
    const status = oneOf(
      result.status,
      ["pass", "fail", "unresolved", "error"] as const,
      `${path}.status`,
    );
    const computedValue = convertQuantity(
      normalizedValues[constraint.feature],
      constraint.limit.unit,
      `${path}.computedValue`,
    );
    const threshold = constraint.limit.value;
    const margin = threshold - computedValue;
    const marginPercent = threshold === 0
      ? undefined
      : Math.round((margin / Math.abs(threshold)) * 10_000) / 100;
    const parsed: EvaluationResult = {
      constraintId,
      constraintName: nonEmptyString(result.constraintName, `${path}.constraintName`),
      status,
      expression: nonEmptyString(result.expression, `${path}.expression`),
    };
    exact(
      parsed.constraintName,
      constraint.name,
      `${path}.constraintName`,
    );
    /**
     * The cross-check detects a real inconsistency: the oracle reports a verdict
     * that contradicts the local recomputation of the same metric (e.g., oracle
     * says "pass" while the CalculiX-derived value exceeds the reviewed limit).
     * When such a divergence is detected, stopping unconditionally is the only
     * safe response — the captured evidence is incoherent and must not reach the
     * snapshot.
     *
     * The guard applies only to "pass" and "fail" because those are the only
     * statuses for which the oracle made a numeric decision. "unresolved" and
     * "error" mean the oracle explicitly opted out of a verdict; comparing a
     * threshold crossing against a non-decision has no meaning and would always
     * throw, preventing these first-class statuses from reaching the published
     * snapshot. Numeric fields (computedValue, threshold, margin, unit) are
     * likewise absent from non-decidable results and must not be validated.
     */
    if (status === "pass" || status === "fail") {
      const expectedStatus: RequirementEvaluationStatus = computedValue <= threshold
        ? "pass"
        : "fail";
      if (status !== expectedStatus) {
        throw new Error(
          `${path}.status does not match the recomputed ${constraint.feature} verdict.`,
        );
      }
      parsed.computedValue = exactFinite(
        result.computedValue,
        computedValue,
        `${path}.computedValue`,
      );
      parsed.threshold = exactFinite(
        result.threshold,
        threshold,
        `${path}.threshold`,
      );
      parsed.margin = exactFinite(result.margin, margin, `${path}.margin`);
      if (marginPercent === undefined) {
        if (result.marginPercent !== undefined) {
          throw new Error(
            `${path}.marginPercent must be omitted for a zero threshold.`,
          );
        }
      } else {
        parsed.marginPercent = exactFinite(
          result.marginPercent,
          marginPercent,
          `${path}.marginPercent`,
        );
      }
      parsed.unit = nonEmptyString(result.unit, `${path}.unit`);
      exact(parsed.unit, constraint.limit.unit, `${path}.unit`);
    } else if (status === "unresolved") {
      if (Array.isArray(result.unresolvedRefs)) {
        parsed.unresolvedRefs = result.unresolvedRefs.filter(
          (ref): ref is string => typeof ref === "string",
        );
      }
    } else {
      // status === "error"
      if (typeof result.error === "string" && result.error.trim() !== "") {
        parsed.error = result.error;
      }
    }
    return parsed;
  });
}

function convertQuantity(
  source: EngineeringQuantity,
  targetUnit: string,
  path: string,
): number {
  const units: Record<string, { dimension: "length" | "pressure"; scale: number }> = {
    m: { dimension: "length", scale: 1 },
    cm: { dimension: "length", scale: 1e-2 },
    mm: { dimension: "length", scale: 1e-3 },
    Pa: { dimension: "pressure", scale: 1 },
    kPa: { dimension: "pressure", scale: 1e3 },
    MPa: { dimension: "pressure", scale: 1e6 },
    GPa: { dimension: "pressure", scale: 1e9 },
  };
  const from = units[source.unit];
  const to = units[targetUnit];
  if (!from || !to || from.dimension !== to.dimension) {
    throw new Error(
      `${path} cannot convert ${source.unit} to model unit ${targetUnit}.`,
    );
  }
  const converted = source.value * from.scale / to.scale;
  if (!Number.isFinite(converted)) {
    throw new Error(`${path} unit conversion must remain finite.`);
  }
  return converted;
}

function validateSummary(value: unknown, results: EvaluationResult[]): void {
  const summary = object(value, "evaluation.summary");
  const expected = {
    total: results.length,
    pass: results.filter((item) => item.status === "pass").length,
    fail: results.filter((item) => item.status === "fail").length,
    error: results.filter((item) => item.status === "error").length,
    unresolved: results.filter((item) => item.status === "unresolved").length,
  };
  same(summary, expected, "evaluation summary");
}

function artifact(input: {
  id: string;
  name: string;
  kind: ThreadArtifact["kind"];
  fingerprint: ContentFingerprint;
  uri?: string;
  mediaType?: string;
  producer: ThreadOperationRef;
  inputArtifactIds?: string[];
  freshness: ThreadFreshness;
}): ThreadArtifact {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    version: input.fingerprint.digest.slice(0, 12),
    fingerprint: input.fingerprint,
    ...(input.uri ? { uri: input.uri } : {}),
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
    producer: input.producer,
    inputArtifactIds: input.inputArtifactIds ?? [],
    freshness: input.freshness,
  };
}

function operation(serverId: string, tool: string, runId: string): ThreadOperationRef {
  return { serverId, tool, runId };
}

function fingerprint(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function fragment(sourceUri: string | undefined, name: string): string | undefined {
  return sourceUri ? `${sourceUri}#${name}` : undefined;
}

function link(
  id: string,
  relation: ThreadProvenanceLink["relation"],
  from: ThreadProvenanceLink["from"],
  to: ThreadProvenanceLink["to"],
  rationale: string,
): ThreadProvenanceLink {
  return { id, relation, from, to, rationale };
}

function quantity(
  root: Record<string, unknown>,
  path: string[],
  label: string,
): EngineeringQuantity {
  let current: unknown = root;
  for (const segment of path) current = object(current, label)[segment];
  const value = object(current, label);
  return {
    value: finite(value.value, `${label}.value`),
    unit: nonEmptyString(value.unit, `${label}.unit`),
  };
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  allowMissingOptional = false,
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${path} has unknown fields: ${unknown.join(", ")}.`);
  }
  if (!allowMissingOptional) {
    const missing = keys.filter((key) => !(key in value));
    if (missing.length > 0) {
      throw new Error(`${path} is missing fields: ${missing.join(", ")}.`);
    }
  }
}

function same(actual: unknown, expected: unknown, path: string): void {
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new Error(`${path} does not match the reviewed causal input.`);
  }
}

function exactArray(actual: unknown, expected: unknown[], path: string): void {
  same(actual, expected, path);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function exactFinite(value: unknown, expected: number, path: string): number {
  const parsed = finite(value, path);
  if (parsed !== expected) {
    throw new Error(`${path} does not match the recomputed value ${expected}.`);
  }
  return parsed;
}

function positive(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (parsed <= 0) throw new Error(`${path} must be positive.`);
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = positive(value, path);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} must be a safe integer.`);
  return parsed;
}

function nonNegative(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (parsed < 0) throw new Error(`${path} must not be negative.`);
  return parsed;
}

function isoDate(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`${path} must be ISO-8601.`);
  return parsed;
}

function sha(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (!SHA256.test(parsed)) throw new Error(`${path} must be lowercase SHA-256 hex.`);
  return parsed;
}

function safeId(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(parsed)) {
    throw new Error(`${path} must be a safe stable id.`);
  }
  return parsed;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new Error(`${path} must be one of ${choices.join(", ")}.`);
  }
  return value as T[number];
}

function assertJson(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} is not JSON-compatible.`);
  if (seen.has(value)) throw new Error(`${path} contains a cycle.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`, seen));
  } else {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
      assertJson(item, `${path}.${key}`, seen)
    );
  }
  seen.delete(value);
}
