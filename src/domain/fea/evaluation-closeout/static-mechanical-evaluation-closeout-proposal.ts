/**
 * Closed human L5 grammar for one static-mechanical FEA closeout.
 *
 * The server derives this admission from the current exact @3 proof branch.
 * It carries identities and literal L4 statuses only: callers never provide
 * a solver, SysON envelope, criterion limit, measured value, or CAD action.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
} from "../../project/engineering-project.ts";
import type { RequirementEvaluationStatus } from "../../thread/thread-snapshot.ts";
import type { CadEngineeringBoundary } from "../seal-case/mechanical-proof-case.ts";

export const STATIC_MECHANICAL_EVALUATION_FAMILY = "static-mechanical" as const;

export const DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION = {
  id: "decide.accept-evaluation-closeout",
  version: "1",
} as const;

export const DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION = {
  id: "decide.reject-evaluation-closeout",
  version: "1",
} as const;

export const EVALUATION_CLOSEOUT_ADMISSION_SCHEMA =
  "evaluation-closeout-admission/1.0" as const;

export type StaticMechanicalCloseoutConsequence = "accept" | "reject";
export type StaticMechanicalRejectionDisposition =
  | "none"
  | "mechanical-review-required";

export type StaticMechanicalEvaluationCloseoutOperation =
  | typeof DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION
  | typeof DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION;

export interface StaticMechanicalCloseoutEvidenceIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface StaticMechanicalCloseoutCriterion {
  /** MechanicalProofCase requirement id, in the proof's declared order. */
  readonly proofCriterionId: string;
  /** Exact L4 RequirementEvaluation id on the Thread basis. */
  readonly evaluationId: string;
  readonly status: RequirementEvaluationStatus;
  /** Exact immutable FEA SysON capture artifact supporting this criterion. */
  readonly evidenceArtifactId: string;
}

/**
 * The bounded mechanical claims carried by the sealed proof case.  These are
 * deliberately copied as ordered literal fields into the signed admission:
 * an L5 decision is about this proof boundary, not merely its L4 verdict.
 */
export interface StaticMechanicalProofLimitations {
  readonly proofScope: string;
  readonly evidenceBoundary: string;
  readonly cadEngineeringBoundary: CadEngineeringBoundary;
}

export const STATIC_MECHANICAL_CLOSEOUT_LIMITS = {
  engineCalls: "none",
  sysonCalls: "none",
  l4PassIsNotL5: true,
  rejectionGrants: "none",
} as const;

export interface StaticMechanicalEvaluationCloseoutAdmission {
  readonly schemaVersion: typeof EVALUATION_CLOSEOUT_ADMISSION_SCHEMA;
  readonly family: typeof STATIC_MECHANICAL_EVALUATION_FAMILY;
  readonly consequence: StaticMechanicalCloseoutConsequence;
  readonly rejectionDisposition: StaticMechanicalRejectionDisposition;
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly canonicalStep: StaticMechanicalCloseoutEvidenceIdentity;
  readonly sealedProof: StaticMechanicalCloseoutEvidenceIdentity;
  readonly executionEvidence: StaticMechanicalCloseoutEvidenceIdentity;
  readonly evaluationCapture: StaticMechanicalCloseoutEvidenceIdentity;
  readonly criteria: readonly StaticMechanicalCloseoutCriterion[];
  readonly proofLimitations: StaticMechanicalProofLimitations;
  readonly limits: typeof STATIC_MECHANICAL_CLOSEOUT_LIMITS;
}

const SHA256 = /^[a-f0-9]{64}$/;
const STATUSES = ["pass", "fail", "unresolved", "error"] as const;

const FIXED_PARAMETER_KEYS = [
  "evaluation.closeout.schemaVersion",
  "evaluation.closeout.family",
  "evaluation.closeout.consequence",
  "evaluation.closeout.rejectionDisposition",
  "evaluation.closeout.project.id",
  "evaluation.closeout.subject.id",
  "evaluation.closeout.basis.snapshotId",
  "evaluation.closeout.basis.revision",
  "evaluation.closeout.basis.fingerprint.digest",
  "evaluation.closeout.canonicalStep.id",
  "evaluation.closeout.canonicalStep.fingerprint.digest",
  "evaluation.closeout.canonicalStep.producerRunId",
  "evaluation.closeout.sealedProof.id",
  "evaluation.closeout.sealedProof.fingerprint.digest",
  "evaluation.closeout.sealedProof.producerRunId",
  "evaluation.closeout.executionEvidence.id",
  "evaluation.closeout.executionEvidence.fingerprint.digest",
  "evaluation.closeout.executionEvidence.producerRunId",
  "evaluation.closeout.evaluationCapture.id",
  "evaluation.closeout.evaluationCapture.fingerprint.digest",
  "evaluation.closeout.evaluationCapture.producerRunId",
  "evaluation.closeout.proofLimitations.proofScope",
  "evaluation.closeout.proofLimitations.evidenceBoundary",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.designIntent",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.editableCad",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.manufacturability",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.count",
  "evaluation.closeout.limits.engineCalls",
  "evaluation.closeout.limits.sysonCalls",
  "evaluation.closeout.limits.l4PassIsNotL5",
  "evaluation.closeout.limits.rejectionGrants",
  "evaluation.closeout.criteria.count",
] as const;

const FIXED_LABELS: Record<(typeof FIXED_PARAMETER_KEYS)[number], string> = {
  "evaluation.closeout.schemaVersion": "Evaluation closeout schema",
  "evaluation.closeout.family": "Evaluation family",
  "evaluation.closeout.consequence": "Declared human consequence",
  "evaluation.closeout.rejectionDisposition": "Rejected-closeout disposition",
  "evaluation.closeout.project.id": "Project",
  "evaluation.closeout.subject.id": "Subject",
  "evaluation.closeout.basis.snapshotId": "Thread snapshot",
  "evaluation.closeout.basis.revision": "Thread revision",
  "evaluation.closeout.basis.fingerprint.digest": "Thread fingerprint",
  "evaluation.closeout.canonicalStep.id": "Canonical STEP artifact",
  "evaluation.closeout.canonicalStep.fingerprint.digest": "Canonical STEP fingerprint",
  "evaluation.closeout.canonicalStep.producerRunId": "Canonical STEP producer run",
  "evaluation.closeout.sealedProof.id": "Sealed mechanical proof artifact",
  "evaluation.closeout.sealedProof.fingerprint.digest":
    "Sealed mechanical proof fingerprint",
  "evaluation.closeout.sealedProof.producerRunId":
    "Sealed mechanical proof producer run",
  "evaluation.closeout.executionEvidence.id": "Isolated execution evidence artifact",
  "evaluation.closeout.executionEvidence.fingerprint.digest":
    "Isolated execution evidence fingerprint",
  "evaluation.closeout.executionEvidence.producerRunId":
    "Isolated execution evidence producer run",
  "evaluation.closeout.evaluationCapture.id": "L4 evaluation capture artifact",
  "evaluation.closeout.evaluationCapture.fingerprint.digest":
    "L4 evaluation capture fingerprint",
  "evaluation.closeout.evaluationCapture.producerRunId":
    "L4 evaluation capture producer run",
  "evaluation.closeout.proofLimitations.proofScope": "Sealed proof scope",
  "evaluation.closeout.proofLimitations.evidenceBoundary":
    "Sealed proof evidence boundary",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.designIntent":
    "CAD design-intent boundary",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.editableCad":
    "CAD editability boundary",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.manufacturability":
    "CAD manufacturability boundary",
  "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.count":
    "CAD limitation count",
  "evaluation.closeout.limits.engineCalls": "Engine-call limit",
  "evaluation.closeout.limits.sysonCalls": "SysON-call limit",
  "evaluation.closeout.limits.l4PassIsNotL5": "L4 is not L5 limit",
  "evaluation.closeout.limits.rejectionGrants": "Rejected-closeout grants",
  "evaluation.closeout.criteria.count": "Declared criterion count",
};

export function staticMechanicalEvaluationCloseoutWorkItemOperation(
  consequence: StaticMechanicalCloseoutConsequence,
): EngineeringOperationRef {
  const operation = operationFor(consequence);
  return {
    id: operation.id,
    version: operation.version,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
}

export function encodeStaticMechanicalEvaluationCloseoutAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateStaticMechanicalEvaluationCloseoutAdmission(value);
  const fixed = FIXED_PARAMETER_KEYS.map((key) => ({
    key,
    label: FIXED_LABELS[key],
    value: fixedParameterValue(admission, key),
  }));
  const proofLimitations = admission.proofLimitations.cadEngineeringBoundary.limitations
    .map((limitation, index) => ({
      key: limitationKey(index),
      label: `CAD limitation ${index + 1}`,
      value: limitation,
    }));
  const criteria = admission.criteria.flatMap((criterion, index) => [
    {
      key: criterionKey(index, "proofCriterionId"),
      label: `Criterion ${index + 1} proof id`,
      value: criterion.proofCriterionId,
    },
    {
      key: criterionKey(index, "evaluationId"),
      label: `Criterion ${index + 1} evaluation`,
      value: criterion.evaluationId,
    },
    {
      key: criterionKey(index, "status"),
      label: `Criterion ${index + 1} L4 status`,
      value: criterion.status,
    },
    {
      key: criterionKey(index, "evidenceArtifactId"),
      label: `Criterion ${index + 1} evidence artifact`,
      value: criterion.evidenceArtifactId,
    },
  ]);
  return deepFreeze([...fixed, ...proofLimitations, ...criteria]);
}

export function parseStaticMechanicalEvaluationCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: StaticMechanicalEvaluationCloseoutOperation,
): StaticMechanicalEvaluationCloseoutAdmission {
  if (parameters.length < FIXED_PARAMETER_KEYS.length) {
    throw new TypeError("Evaluation closeout proposal is missing fixed parameters.");
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, expected] of FIXED_PARAMETER_KEYS.entries()) {
    const parameter = parameters[index];
    if (!parameter || parameter.key !== expected) {
      throw new TypeError(
        `Evaluation closeout parameter ${index} must be ${expected}.`,
      );
    }
    values.set(expected, parameter.value);
  }
  const count = integerValue(
    values.get("evaluation.closeout.criteria.count"),
    "evaluation.closeout.criteria.count",
  );
  if (count < 1) {
    throw new TypeError("Evaluation closeout must declare at least one criterion.");
  }
  const limitationCount = integerValue(
    values.get(
      "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.count",
    ),
    "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.count",
  );
  if (limitationCount < 1) {
    throw new TypeError(
      "Evaluation closeout must carry at least one sealed CAD limitation.",
    );
  }
  const expectedLength = FIXED_PARAMETER_KEYS.length + limitationCount + count * 4;
  if (parameters.length !== expectedLength) {
    throw new TypeError(
      `Evaluation closeout proposal must contain exactly ${expectedLength} parameters for ${count} criteria.`,
    );
  }
  const limitations: string[] = [];
  let offset = FIXED_PARAMETER_KEYS.length;
  for (let index = 0; index < limitationCount; index++) {
    const key = limitationKey(index);
    const parameter = parameters[offset++];
    if (!parameter || parameter.key !== key) {
      throw new TypeError(
        `Evaluation closeout CAD limitation ${index} must be ordered exactly.`,
      );
    }
    limitations.push(parameter.value as string);
  }
  const criteria: StaticMechanicalCloseoutCriterion[] = [];
  for (let index = 0; index < count; index++) {
    const expected = [
      criterionKey(index, "proofCriterionId"),
      criterionKey(index, "evaluationId"),
      criterionKey(index, "status"),
      criterionKey(index, "evidenceArtifactId"),
    ] as const;
    for (const key of expected) {
      const parameter = parameters[offset++];
      if (!parameter || parameter.key !== key) {
        throw new TypeError(
          `Evaluation closeout criterion ${index} must be ordered exactly.`,
        );
      }
      values.set(key, parameter.value);
    }
    criteria.push({
      proofCriterionId: values.get(expected[0]) as string,
      evaluationId: values.get(expected[1]) as string,
      status: values.get(expected[2]) as RequirementEvaluationStatus,
      evidenceArtifactId: values.get(expected[3]) as string,
    });
  }
  const admission = validateStaticMechanicalEvaluationCloseoutAdmission({
    schemaVersion: values.get("evaluation.closeout.schemaVersion"),
    family: values.get("evaluation.closeout.family"),
    consequence: values.get("evaluation.closeout.consequence"),
    rejectionDisposition: values.get("evaluation.closeout.rejectionDisposition"),
    projectId: values.get("evaluation.closeout.project.id"),
    subjectId: values.get("evaluation.closeout.subject.id"),
    basis: {
      snapshotId: values.get("evaluation.closeout.basis.snapshotId"),
      revision: values.get("evaluation.closeout.basis.revision"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("evaluation.closeout.basis.fingerprint.digest"),
      },
    },
    canonicalStep: evidenceFrom(values, "canonicalStep"),
    sealedProof: evidenceFrom(values, "sealedProof"),
    executionEvidence: evidenceFrom(values, "executionEvidence"),
    evaluationCapture: evidenceFrom(values, "evaluationCapture"),
    criteria,
    proofLimitations: {
      proofScope: values.get("evaluation.closeout.proofLimitations.proofScope"),
      evidenceBoundary: values.get(
        "evaluation.closeout.proofLimitations.evidenceBoundary",
      ),
      cadEngineeringBoundary: {
        designIntent: values.get(
          "evaluation.closeout.proofLimitations.cadEngineeringBoundary.designIntent",
        ),
        editableCad: values.get(
          "evaluation.closeout.proofLimitations.cadEngineeringBoundary.editableCad",
        ),
        manufacturability: values.get(
          "evaluation.closeout.proofLimitations.cadEngineeringBoundary.manufacturability",
        ),
        limitations,
      },
    },
    limits: {
      engineCalls: values.get("evaluation.closeout.limits.engineCalls"),
      sysonCalls: values.get("evaluation.closeout.limits.sysonCalls"),
      l4PassIsNotL5: values.get("evaluation.closeout.limits.l4PassIsNotL5"),
      rejectionGrants: values.get("evaluation.closeout.limits.rejectionGrants"),
    },
  });
  const expectedConsequence = consequenceFor(operation);
  if (admission.consequence !== expectedConsequence) {
    throw new TypeError(
      `Evaluation closeout consequence must be ${expectedConsequence} for ${operation.id}@${operation.version}.`,
    );
  }
  if (
    admission.consequence === "accept" &&
    admission.criteria.some((criterion) => criterion.status !== "pass")
  ) {
    throw new TypeError(
      "A static-mechanical accept closeout requires every declared L4 criterion to be literal pass.",
    );
  }
  return admission;
}

export function validateStaticMechanicalEvaluationCloseoutAdmission(
  value: unknown,
): StaticMechanicalEvaluationCloseoutAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "family",
    "consequence",
    "rejectionDisposition",
    "projectId",
    "subjectId",
    "basis",
    "canonicalStep",
    "sealedProof",
    "executionEvidence",
    "evaluationCapture",
    "criteria",
    "proofLimitations",
    "limits",
  ], "$staticMechanicalEvaluationCloseout");
  literalValue(
    root.schemaVersion,
    EVALUATION_CLOSEOUT_ADMISSION_SCHEMA,
    "$staticMechanicalEvaluationCloseout.schemaVersion",
  );
  literalValue(
    root.family,
    STATIC_MECHANICAL_EVALUATION_FAMILY,
    "$staticMechanicalEvaluationCloseout.family",
  );
  if (root.consequence !== "accept" && root.consequence !== "reject") {
    throw new TypeError("Evaluation closeout consequence must be accept or reject.");
  }
  if (
    root.rejectionDisposition !== "none" &&
    root.rejectionDisposition !== "mechanical-review-required"
  ) {
    throw new TypeError(
      "Evaluation closeout rejectionDisposition must be none or mechanical-review-required.",
    );
  }
  if (root.consequence === "accept" && root.rejectionDisposition !== "none") {
    throw new TypeError("An accepted closeout cannot grant a rejection disposition.");
  }
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$staticMechanicalEvaluationCloseout.basis",
  );
  const criteriaValue = Array.isArray(root.criteria) ? root.criteria : undefined;
  if (!criteriaValue || criteriaValue.length === 0) {
    throw new TypeError(
      "Evaluation closeout criteria must be a non-empty ordered array.",
    );
  }
  const criteria = criteriaValue.map((item, index) => criterion(item, index));
  const proofIds = new Set<string>();
  const evaluationIds = new Set<string>();
  for (const entry of criteria) {
    if (proofIds.has(entry.proofCriterionId) || evaluationIds.has(entry.evaluationId)) {
      throw new TypeError(
        "Evaluation closeout criteria must not duplicate proof or evaluation ids.",
      );
    }
    proofIds.add(entry.proofCriterionId);
    evaluationIds.add(entry.evaluationId);
  }
  if (
    root.consequence === "accept" && criteria.some((item) => item.status !== "pass")
  ) {
    throw new TypeError(
      "An accepted closeout requires literal pass for every criterion.",
    );
  }
  const proofLimitations = mechanicalProofLimitations(root.proofLimitations);
  const limits = exactRecord(root.limits, [
    "engineCalls",
    "sysonCalls",
    "l4PassIsNotL5",
    "rejectionGrants",
  ], "$staticMechanicalEvaluationCloseout.limits");
  literalValue(
    limits.engineCalls,
    "none",
    "$staticMechanicalEvaluationCloseout.limits.engineCalls",
  );
  literalValue(
    limits.sysonCalls,
    "none",
    "$staticMechanicalEvaluationCloseout.limits.sysonCalls",
  );
  literalValue(
    limits.l4PassIsNotL5,
    true,
    "$staticMechanicalEvaluationCloseout.limits.l4PassIsNotL5",
  );
  literalValue(
    limits.rejectionGrants,
    "none",
    "$staticMechanicalEvaluationCloseout.limits.rejectionGrants",
  );
  return deepFreeze({
    schemaVersion: EVALUATION_CLOSEOUT_ADMISSION_SCHEMA,
    family: STATIC_MECHANICAL_EVALUATION_FAMILY,
    consequence: root.consequence,
    rejectionDisposition: root.rejectionDisposition,
    projectId: safeId(root.projectId, "$staticMechanicalEvaluationCloseout.projectId"),
    subjectId: safeId(root.subjectId, "$staticMechanicalEvaluationCloseout.subjectId"),
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$staticMechanicalEvaluationCloseout.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$staticMechanicalEvaluationCloseout.basis.revision",
      ),
      fingerprint: fingerprint(
        basis.fingerprint,
        "$staticMechanicalEvaluationCloseout.basis.fingerprint",
      ),
    },
    canonicalStep: evidence(root.canonicalStep, "canonicalStep"),
    sealedProof: evidence(root.sealedProof, "sealedProof"),
    executionEvidence: evidence(root.executionEvidence, "executionEvidence"),
    evaluationCapture: evidence(root.evaluationCapture, "evaluationCapture"),
    criteria,
    proofLimitations,
    limits: STATIC_MECHANICAL_CLOSEOUT_LIMITS,
  });
}

function operationFor(
  consequence: StaticMechanicalCloseoutConsequence,
): StaticMechanicalEvaluationCloseoutOperation {
  return consequence === "accept"
    ? DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION
    : DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION;
}

function consequenceFor(
  operation: StaticMechanicalEvaluationCloseoutOperation,
): StaticMechanicalCloseoutConsequence {
  return operation.id === DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id
    ? "accept"
    : "reject";
}

function criterionKey(
  index: number,
  field: "proofCriterionId" | "evaluationId" | "status" | "evidenceArtifactId",
): string {
  return `evaluation.closeout.criteria.${index}.${field}`;
}

function limitationKey(index: number): string {
  return `evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.${index}`;
}

function fixedParameterValue(
  admission: StaticMechanicalEvaluationCloseoutAdmission,
  key: (typeof FIXED_PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "evaluation.closeout.schemaVersion":
      return admission.schemaVersion;
    case "evaluation.closeout.family":
      return admission.family;
    case "evaluation.closeout.consequence":
      return admission.consequence;
    case "evaluation.closeout.rejectionDisposition":
      return admission.rejectionDisposition;
    case "evaluation.closeout.project.id":
      return admission.projectId;
    case "evaluation.closeout.subject.id":
      return admission.subjectId;
    case "evaluation.closeout.basis.snapshotId":
      return admission.basis.snapshotId;
    case "evaluation.closeout.basis.revision":
      return admission.basis.revision;
    case "evaluation.closeout.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "evaluation.closeout.canonicalStep.id":
      return admission.canonicalStep.id;
    case "evaluation.closeout.canonicalStep.fingerprint.digest":
      return admission.canonicalStep.fingerprint.digest;
    case "evaluation.closeout.canonicalStep.producerRunId":
      return admission.canonicalStep.producerRunId;
    case "evaluation.closeout.sealedProof.id":
      return admission.sealedProof.id;
    case "evaluation.closeout.sealedProof.fingerprint.digest":
      return admission.sealedProof.fingerprint.digest;
    case "evaluation.closeout.sealedProof.producerRunId":
      return admission.sealedProof.producerRunId;
    case "evaluation.closeout.executionEvidence.id":
      return admission.executionEvidence.id;
    case "evaluation.closeout.executionEvidence.fingerprint.digest":
      return admission.executionEvidence.fingerprint.digest;
    case "evaluation.closeout.executionEvidence.producerRunId":
      return admission.executionEvidence.producerRunId;
    case "evaluation.closeout.evaluationCapture.id":
      return admission.evaluationCapture.id;
    case "evaluation.closeout.evaluationCapture.fingerprint.digest":
      return admission.evaluationCapture.fingerprint.digest;
    case "evaluation.closeout.evaluationCapture.producerRunId":
      return admission.evaluationCapture.producerRunId;
    case "evaluation.closeout.proofLimitations.proofScope":
      return admission.proofLimitations.proofScope;
    case "evaluation.closeout.proofLimitations.evidenceBoundary":
      return admission.proofLimitations.evidenceBoundary;
    case "evaluation.closeout.proofLimitations.cadEngineeringBoundary.designIntent":
      return admission.proofLimitations.cadEngineeringBoundary.designIntent;
    case "evaluation.closeout.proofLimitations.cadEngineeringBoundary.editableCad":
      return admission.proofLimitations.cadEngineeringBoundary.editableCad;
    case "evaluation.closeout.proofLimitations.cadEngineeringBoundary.manufacturability":
      return admission.proofLimitations.cadEngineeringBoundary.manufacturability;
    case "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.count":
      return admission.proofLimitations.cadEngineeringBoundary.limitations.length;
    case "evaluation.closeout.limits.engineCalls":
      return admission.limits.engineCalls;
    case "evaluation.closeout.limits.sysonCalls":
      return admission.limits.sysonCalls;
    case "evaluation.closeout.limits.l4PassIsNotL5":
      return admission.limits.l4PassIsNotL5;
    case "evaluation.closeout.limits.rejectionGrants":
      return admission.limits.rejectionGrants;
    case "evaluation.closeout.criteria.count":
      return admission.criteria.length;
  }
}

function evidenceFrom(
  values: ReadonlyMap<string, EngineeringDecisionProposalParameter["value"]>,
  name: "canonicalStep" | "sealedProof" | "executionEvidence" | "evaluationCapture",
): StaticMechanicalCloseoutEvidenceIdentity {
  const prefix = `evaluation.closeout.${name}`;
  return {
    id: values.get(`${prefix}.id`) as string,
    fingerprint: {
      algorithm: "sha256",
      digest: values.get(`${prefix}.fingerprint.digest`) as string,
    },
    producerRunId: values.get(`${prefix}.producerRunId`) as string,
  };
}

function evidence(
  value: unknown,
  name: string,
): StaticMechanicalCloseoutEvidenceIdentity {
  const record = exactRecord(
    value,
    ["id", "fingerprint", "producerRunId"],
    `$staticMechanicalEvaluationCloseout.${name}`,
  );
  return {
    id: safeId(record.id, `$staticMechanicalEvaluationCloseout.${name}.id`),
    fingerprint: fingerprint(
      record.fingerprint,
      `$staticMechanicalEvaluationCloseout.${name}.fingerprint`,
    ),
    producerRunId: safeId(
      record.producerRunId,
      `$staticMechanicalEvaluationCloseout.${name}.producerRunId`,
    ),
  };
}

function criterion(value: unknown, index: number): StaticMechanicalCloseoutCriterion {
  const record = exactRecord(value, [
    "proofCriterionId",
    "evaluationId",
    "status",
    "evidenceArtifactId",
  ], `$staticMechanicalEvaluationCloseout.criteria[${index}]`);
  if (!STATUSES.includes(record.status as RequirementEvaluationStatus)) {
    throw new TypeError(
      `Evaluation closeout criterion ${index} has an unsupported L4 status.`,
    );
  }
  return {
    proofCriterionId: safeId(
      record.proofCriterionId,
      `$staticMechanicalEvaluationCloseout.criteria[${index}].proofCriterionId`,
    ),
    evaluationId: safeId(
      record.evaluationId,
      `$staticMechanicalEvaluationCloseout.criteria[${index}].evaluationId`,
    ),
    status: record.status as RequirementEvaluationStatus,
    evidenceArtifactId: safeId(
      record.evidenceArtifactId,
      `$staticMechanicalEvaluationCloseout.criteria[${index}].evidenceArtifactId`,
    ),
  };
}

function mechanicalProofLimitations(value: unknown): StaticMechanicalProofLimitations {
  const root = exactRecord(value, [
    "proofScope",
    "evidenceBoundary",
    "cadEngineeringBoundary",
  ], "$staticMechanicalEvaluationCloseout.proofLimitations");
  const boundary = exactRecord(root.cadEngineeringBoundary, [
    "designIntent",
    "editableCad",
    "manufacturability",
    "limitations",
  ], "$staticMechanicalEvaluationCloseout.proofLimitations.cadEngineeringBoundary");
  if (
    boundary.designIntent !== "preserved" && boundary.designIntent !== "partial" &&
    boundary.designIntent !== "lost"
  ) {
    throw new TypeError("Evaluation closeout CAD designIntent is unsupported.");
  }
  if (
    boundary.editableCad !== "native" && boundary.editableCad !== "reconstructed" &&
    boundary.editableCad !== "absent"
  ) {
    throw new TypeError("Evaluation closeout CAD editableCad is unsupported.");
  }
  literalValue(
    boundary.manufacturability,
    "not-established",
    "$staticMechanicalEvaluationCloseout.proofLimitations.cadEngineeringBoundary.manufacturability",
  );
  const limitations = Array.isArray(boundary.limitations)
    ? boundary.limitations
    : undefined;
  if (!limitations || limitations.length === 0) {
    throw new TypeError(
      "Evaluation closeout CAD limitations must be a non-empty ordered array.",
    );
  }
  const normalized = limitations.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item !== item.trim()) {
      throw new TypeError(
        `Evaluation closeout CAD limitation ${index} must be non-empty text.`,
      );
    }
    return item;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(
      "Evaluation closeout CAD limitations must not duplicate values.",
    );
  }
  if (boundary.designIntent === "preserved" && boundary.editableCad !== "native") {
    throw new TypeError("A preserved CAD design intent requires native editability.");
  }
  const proofScope = text(
    root.proofScope,
    "$staticMechanicalEvaluationCloseout.proofLimitations.proofScope",
  );
  const evidenceBoundary = text(
    root.evidenceBoundary,
    "$staticMechanicalEvaluationCloseout.proofLimitations.evidenceBoundary",
  );
  return deepFreeze({
    proofScope,
    evidenceBoundary,
    cadEngineeringBoundary: {
      designIntent: boundary.designIntent,
      editableCad: boundary.editableCad,
      manufacturability: "not-established",
      limitations: normalized,
    },
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} must be non-empty text.`);
  }
  return value;
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(record.algorithm, "sha256", `${path}.algorithm`);
  if (typeof record.digest !== "string" || !SHA256.test(record.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function integerValue(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  throw new TypeError(`${path} must be an integer.`);
}
