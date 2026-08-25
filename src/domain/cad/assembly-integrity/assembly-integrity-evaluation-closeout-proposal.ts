/**
 * Closed MRTR grammar for a human L5 closeout of one assembly-integrity L4.
 *
 * The public review derives every field from the unique fresh L4 capture on
 * the current Thread tip. Callers cannot choose a provider, tolerance,
 * evaluation outcome, SysON call, or gate identifier. A literal L4 pass is
 * only eligibility for a separately signed human accept.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
  EngineeringGateClaim,
  EngineeringOperationRef,
} from "../../project/engineering-project.ts";
import {
  ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
} from "./assembly-integrity-verification-authority.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA,
  ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
  ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID,
  ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA,
  ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION,
  type AssemblyIntegrityEvaluationCriterion,
  type AssemblyIntegrityEvaluationLimits,
  type AssemblyIntegrityEvaluationVerdict,
} from "./assembly-integrity-evaluation.ts";

export const DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION = {
  id: "decide.accept-assembly-integrity-evaluation",
  version: "1",
} as const;

export const DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION = {
  id: "decide.reject-assembly-integrity-evaluation",
  version: "1",
} as const;

export const ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA =
  "assembly-integrity-evaluation-closeout/1.0" as const;

export type AssemblyIntegrityEvaluationCloseoutConsequence = "accept" | "reject";

export type AssemblyIntegrityEvaluationCloseoutOperation =
  | typeof DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION;

export type AssemblyIntegrityEvaluationRejectionDisposition =
  | "none"
  | "assembly-integrity-review-required";

export interface AssemblyIntegrityEvaluationCloseoutEvidenceIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

/**
 * Full closed identity of the L4 branch. Criterion status is retained only as
 * a literal record of L4; it is never a caller-selected verdict.
 */
export interface AssemblyIntegrityEvaluationCloseoutAdmission {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA;
  readonly consequence: AssemblyIntegrityEvaluationCloseoutConsequence;
  readonly rejectionDisposition: AssemblyIntegrityEvaluationRejectionDisposition;
  readonly projectId: string;
  readonly subjectId: string;
  /** Exact current human-approved V2 Brief basis that authorized this L5. */
  readonly approvedBriefBasis: EngineeringApprovedBriefBasis;
  /** Fixed semantic verification authority; never a provider/runtime choice. */
  readonly verificationAuthority: typeof ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY;
  /** Exact canonical compatible Brief-gate set, signed with the MRTR. */
  readonly gateClaims: readonly EngineeringGateClaim[];
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly evaluationCapture: AssemblyIntegrityEvaluationCloseoutEvidenceIdentity;
  readonly geometryModule: AssemblyIntegrityEvaluationCloseoutEvidenceIdentity;
  readonly assemblyStep: AssemblyIntegrityEvaluationCloseoutEvidenceIdentity;
  readonly observation: AssemblyIntegrityEvaluationCloseoutEvidenceIdentity & {
    readonly observationFingerprint: ContentFingerprint;
  };
  readonly method: {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA;
    readonly id: typeof ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID;
    readonly version: typeof ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION;
    readonly fingerprint: ContentFingerprint;
  };
  /** Exactly the five code-owned L4 criteria, in method order. */
  readonly criteria: readonly AssemblyIntegrityEvaluationCriterion[];
  /** Literal L4 boundaries; no L5 consequence may weaken one. */
  readonly limitations: AssemblyIntegrityEvaluationLimits;
}

const PREFIX = "assembly.integrity.closeout";
const FIXED_KEYS = [
  "schemaVersion",
  "consequence",
  "rejectionDisposition",
  "project.id",
  "subject.id",
  "approvedBrief.kind",
  "approvedBrief.projectId",
  "approvedBrief.projectSnapshotId",
  "approvedBrief.projectRevision",
  "approvedBrief.briefId",
  "approvedBrief.briefSnapshotId",
  "approvedBrief.briefRevision",
  "approvedBrief.fingerprint.digest",
  "verificationAuthority.id",
  "verificationAuthority.version",
  "gateClaims.count",
  "basis.snapshotId",
  "basis.revision",
  "basis.fingerprint.digest",
  "evaluationCapture.id",
  "evaluationCapture.fingerprint.digest",
  "geometryModule.id",
  "geometryModule.fingerprint.digest",
  "assemblyStep.id",
  "assemblyStep.fingerprint.digest",
  "observation.id",
  "observation.fingerprint.digest",
  "observation.normalizedObservationFingerprint.digest",
  "method.schemaVersion",
  "method.id",
  "method.version",
  "method.fingerprint.digest",
  "limitations.providerCalls",
  "limitations.genericSysmlRequirementEvaluation",
  "limitations.safety",
  "limitations.physicalJoints",
  "limitations.clearance",
  "limitations.motion",
  "limitations.load",
  "limitations.fabricability",
  "criteria.count",
] as const;

type FixedKey = (typeof FIXED_KEYS)[number];
type Scalar = EngineeringDecisionProposalParameter["value"];

export function assemblyIntegrityEvaluationCloseoutWorkItemOperation(
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
): EngineeringOperationRef {
  const operation = operationFor(consequence);
  return {
    id: operation.id,
    version: operation.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
}

export function encodeAssemblyIntegrityEvaluationCloseoutAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateAssemblyIntegrityEvaluationCloseoutAdmission(value);
  const fixed = FIXED_KEYS.map((key) =>
    deepFreeze({
      key: `${PREFIX}.${key}`,
      label: `${PREFIX}.${key}`,
      value: fixedValue(admission, key),
    })
  );
  const criteria = admission.criteria.flatMap((criterion, index) => [
    deepFreeze({
      key: criterionKey(index, "id"),
      label: criterionKey(index, "id"),
      value: criterion.id,
    }),
    deepFreeze({
      key: criterionKey(index, "verdict"),
      label: criterionKey(index, "verdict"),
      value: criterion.verdict,
    }),
  ]);
  const gateClaims = admission.gateClaims.flatMap((claim, index) => [
    deepFreeze({
      key: gateClaimKey(index, "gateItemId"),
      label: gateClaimKey(index, "gateItemId"),
      value: claim.gateItemId,
    }),
    deepFreeze({
      key: gateClaimKey(index, "role"),
      label: gateClaimKey(index, "role"),
      value: claim.role,
    }),
    deepFreeze({
      key: gateClaimKey(index, "status"),
      label: gateClaimKey(index, "status"),
      value: claim.status,
    }),
  ]);
  return deepFreeze([...fixed, ...criteria, ...gateClaims]);
}

export function parseAcceptAssemblyIntegrityEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): AssemblyIntegrityEvaluationCloseoutAdmission {
  return parseCloseoutParameters(
    parameters,
    DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  );
}

export function parseRejectAssemblyIntegrityEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): AssemblyIntegrityEvaluationCloseoutAdmission {
  return parseCloseoutParameters(
    parameters,
    DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  );
}

export function parseAssemblyIntegrityEvaluationCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
): AssemblyIntegrityEvaluationCloseoutAdmission {
  return parseCloseoutParameters(parameters, operation);
}

export function validateAssemblyIntegrityEvaluationCloseoutAdmission(
  value: unknown,
): AssemblyIntegrityEvaluationCloseoutAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "consequence",
    "rejectionDisposition",
    "projectId",
    "subjectId",
    "approvedBriefBasis",
    "verificationAuthority",
    "gateClaims",
    "basis",
    "evaluationCapture",
    "geometryModule",
    "assemblyStep",
    "observation",
    "method",
    "criteria",
    "limitations",
  ], "$assemblyIntegrityEvaluationCloseout");
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    "$assemblyIntegrityEvaluationCloseout.schemaVersion",
  );
  const consequence = consequenceValue(
    root.consequence,
    "$assemblyIntegrityEvaluationCloseout.consequence",
  );
  const projectId = safeId(
    root.projectId,
    "$assemblyIntegrityEvaluationCloseout.projectId",
  );
  const approvedBriefBasis = parseApprovedBriefBasis(root.approvedBriefBasis);
  if (approvedBriefBasis.projectId !== projectId) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCloseout.approvedBriefBasis must name the signed project.",
    );
  }
  const basis = parseBasis(root.basis);
  const criteria = parseCriteria(root.criteria);
  const gateClaims = parseGateClaims(root.gateClaims, consequence);
  const rejectionDisposition = rejectionDispositionFor(criteria, consequence);
  literalValue(
    root.rejectionDisposition,
    rejectionDisposition,
    "$assemblyIntegrityEvaluationCloseout.rejectionDisposition",
  );
  const admission = deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    consequence,
    rejectionDisposition,
    projectId,
    subjectId: safeId(root.subjectId, "$assemblyIntegrityEvaluationCloseout.subjectId"),
    approvedBriefBasis,
    verificationAuthority: parseVerificationAuthority(root.verificationAuthority),
    gateClaims,
    basis,
    evaluationCapture: parseIdentity(
      root.evaluationCapture,
      "$assemblyIntegrityEvaluationCloseout.evaluationCapture",
    ),
    geometryModule: parseIdentity(
      root.geometryModule,
      "$assemblyIntegrityEvaluationCloseout.geometryModule",
    ),
    assemblyStep: parseIdentity(
      root.assemblyStep,
      "$assemblyIntegrityEvaluationCloseout.assemblyStep",
    ),
    observation: parseObservation(root.observation),
    method: parseMethod(root.method),
    criteria,
    limitations: parseLimitations(root.limitations),
  });
  if (
    admission.evaluationCapture.id !==
      `assembly-integrity-evaluation-${admission.evaluationCapture.fingerprint.digest}`
  ) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCloseout.evaluationCapture.id must bind its content fingerprint.",
    );
  }
  if (
    admission.geometryModule.id !==
      `geometry-${admission.geometryModule.fingerprint.digest}`
  ) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCloseout.geometryModule.id must bind its content fingerprint.",
    );
  }
  if (
    admission.assemblyStep.id !==
      `cad-asset-${admission.geometryModule.fingerprint.digest}-module-step-${admission.assemblyStep.fingerprint.digest}`
  ) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCloseout.assemblyStep.id must bind its geometry module and content fingerprints.",
    );
  }
  if (
    admission.observation.id !==
      `assembly-integrity-observation-${admission.observation.fingerprint.digest}`
  ) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCloseout.observation.id must bind its content fingerprint.",
    );
  }
  return admission;
}

/** Accept has the stricter L5 eligibility rule. Reject is always representable. */
export function isAssemblyIntegrityEvaluationAcceptEligible(
  criteria: readonly AssemblyIntegrityEvaluationCriterion[],
): boolean {
  return criteria.length === ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA.length &&
    criteria.every((criterion, index) =>
      criterion.id === ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA[index] &&
      criterion.verdict === "pass"
    );
}

function parseCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
): AssemblyIntegrityEvaluationCloseoutAdmission {
  if (parameters.length < FIXED_KEYS.length) {
    throw new TypeError(
      "Assembly-integrity evaluation closeout proposal omits fixed signed parameters.",
    );
  }
  const values = new Map<string, Scalar>();
  for (const [index, key] of FIXED_KEYS.entries()) {
    const parameter = parameters[index];
    requireParameter(parameter, `${PREFIX}.${key}`, index);
    values.set(key, parameter.value);
  }
  const criteria: AssemblyIntegrityEvaluationCriterion[] = [];
  let offset = FIXED_KEYS.length;
  for (const [index, id] of ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA.entries()) {
    const idParameter = parameters[offset++];
    const verdictParameter = parameters[offset++];
    requireParameter(idParameter, criterionKey(index, "id"), offset - 2);
    requireParameter(verdictParameter, criterionKey(index, "verdict"), offset - 1);
    literalValue(idParameter.value, id, `${idParameter.key}.value`);
    criteria.push({
      id,
      verdict: verdictValue(verdictParameter.value, `${verdictParameter.key}.value`),
    });
  }
  const claimCount = nonnegativeInteger(
    scalar(values, "gateClaims.count"),
    "gateClaims.count",
  );
  const expectedLength = FIXED_KEYS.length +
    ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA.length * 2 + claimCount * 3;
  if (parameters.length !== expectedLength) {
    throw new TypeError(
      `Assembly-integrity evaluation closeout proposal must contain exactly ${expectedLength} parameters.`,
    );
  }
  const gateClaims: EngineeringGateClaim[] = [];
  for (let index = 0; index < claimCount; index++) {
    const gateItemId = parameters[offset++];
    const role = parameters[offset++];
    const status = parameters[offset++];
    requireParameter(gateItemId, gateClaimKey(index, "gateItemId"), offset - 3);
    requireParameter(role, gateClaimKey(index, "role"), offset - 2);
    requireParameter(status, gateClaimKey(index, "status"), offset - 1);
    gateClaims.push({
      gateItemId: safeId(gateItemId.value, `${gateItemId.key}.value`),
      role: gateClaimRoleValue(role.value, `${role.key}.value`),
      status: gateClaimStatusValue(status.value, `${status.key}.value`),
    });
  }
  const admission = validateAssemblyIntegrityEvaluationCloseoutAdmission({
    schemaVersion: scalar(values, "schemaVersion"),
    consequence: scalar(values, "consequence"),
    rejectionDisposition: scalar(values, "rejectionDisposition"),
    projectId: scalar(values, "project.id"),
    subjectId: scalar(values, "subject.id"),
    approvedBriefBasis: approvedBriefBasisFrom(values),
    verificationAuthority: {
      id: scalar(values, "verificationAuthority.id"),
      version: scalar(values, "verificationAuthority.version"),
    },
    gateClaims,
    basis: {
      snapshotId: scalar(values, "basis.snapshotId"),
      revision: scalar(values, "basis.revision"),
      fingerprint: fingerprint(
        scalar(values, "basis.fingerprint.digest"),
        "basis.fingerprint.digest",
      ),
    },
    evaluationCapture: identityFrom(values, "evaluationCapture"),
    geometryModule: identityFrom(values, "geometryModule"),
    assemblyStep: identityFrom(values, "assemblyStep"),
    observation: {
      ...identityFrom(values, "observation"),
      observationFingerprint: fingerprint(
        scalar(values, "observation.normalizedObservationFingerprint.digest"),
        "observation.normalizedObservationFingerprint.digest",
      ),
    },
    method: {
      schemaVersion: scalar(values, "method.schemaVersion"),
      id: scalar(values, "method.id"),
      version: scalar(values, "method.version"),
      fingerprint: fingerprint(
        scalar(values, "method.fingerprint.digest"),
        "method.fingerprint.digest",
      ),
    },
    criteria,
    limitations: limitationsFrom(values),
  });
  if (admission.consequence !== consequenceFor(operation)) {
    throw new TypeError(
      `Assembly-integrity evaluation closeout consequence must be ${
        consequenceFor(operation)
      } for ${operation.id}@${operation.version}.`,
    );
  }
  if (
    deterministicJson(encodeAssemblyIntegrityEvaluationCloseoutAdmission(admission)) !==
      deterministicJson(parameters)
  ) {
    throw new TypeError(
      "Assembly-integrity evaluation closeout parameters do not replay the canonical signed admission.",
    );
  }
  return admission;
}

function parseBasis(
  value: unknown,
): AssemblyIntegrityEvaluationCloseoutAdmission["basis"] {
  const root = exactRecord(
    value,
    ["snapshotId", "revision", "fingerprint"],
    "$assemblyIntegrityEvaluationCloseout.basis",
  );
  return deepFreeze({
    snapshotId: safeId(
      root.snapshotId,
      "$assemblyIntegrityEvaluationCloseout.basis.snapshotId",
    ),
    revision: positiveInteger(
      root.revision,
      "$assemblyIntegrityEvaluationCloseout.basis.revision",
    ),
    fingerprint: parseFingerprint(
      root.fingerprint,
      "$assemblyIntegrityEvaluationCloseout.basis.fingerprint",
    ),
  });
}

function parseApprovedBriefBasis(
  value: unknown,
): EngineeringApprovedBriefBasis {
  const path = "$assemblyIntegrityEvaluationCloseout.approvedBriefBasis";
  const root = exactRecord(value, [
    "kind",
    "projectId",
    "projectSnapshotId",
    "projectRevision",
    "briefId",
    "briefSnapshotId",
    "briefRevision",
    "approvedBriefFingerprint",
  ], path);
  literalValue(root.kind, "approved-brief", `${path}.kind`);
  return deepFreeze({
    kind: "approved-brief" as const,
    projectId: safeId(root.projectId, `${path}.projectId`),
    projectSnapshotId: safeId(root.projectSnapshotId, `${path}.projectSnapshotId`),
    projectRevision: positiveInteger(root.projectRevision, `${path}.projectRevision`),
    briefId: safeId(root.briefId, `${path}.briefId`),
    briefSnapshotId: safeId(root.briefSnapshotId, `${path}.briefSnapshotId`),
    briefRevision: positiveInteger(root.briefRevision, `${path}.briefRevision`),
    approvedBriefFingerprint: parseFingerprint(
      root.approvedBriefFingerprint,
      `${path}.approvedBriefFingerprint`,
    ),
  });
}

function parseVerificationAuthority(
  value: unknown,
): typeof ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY {
  const root = exactRecord(
    value,
    ["id", "version"],
    "$assemblyIntegrityEvaluationCloseout.verificationAuthority",
  );
  literalValue(
    root.id,
    ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY.id,
    "$assemblyIntegrityEvaluationCloseout.verificationAuthority.id",
  );
  literalValue(
    root.version,
    ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY.version,
    "$assemblyIntegrityEvaluationCloseout.verificationAuthority.version",
  );
  return ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY;
}

function parseGateClaims(
  value: unknown,
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
): readonly EngineeringGateClaim[] {
  const path = "$assemblyIntegrityEvaluationCloseout.gateClaims";
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  if (consequence === "reject" && value.length !== 0) {
    throw new TypeError(
      "A rejected assembly-integrity closeout must retain no gate claims.",
    );
  }
  const claims = value.map((candidate, index) => {
    const claimPath = `${path}[${index}]`;
    const root = exactRecord(candidate, ["gateItemId", "role", "status"], claimPath);
    const gateItemId = safeId(root.gateItemId, `${claimPath}.gateItemId`);
    if (consequence !== "accept") {
      throw new TypeError(
        "Only an accepted assembly-integrity closeout may retain a gate claim.",
      );
    }
    literalValue(root.role, "satisfies", `${claimPath}.role`);
    literalValue(root.status, "current", `${claimPath}.status`);
    return deepFreeze({
      gateItemId,
      role: "satisfies" as const,
      status: "current" as const,
    });
  });
  const ids = claims.map((claim) => claim.gateItemId);
  const canonicalIds = [...ids].toSorted((left, right) => left.localeCompare(right));
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => id !== canonicalIds[index])
  ) {
    throw new TypeError(
      "Accepted assembly-integrity gate claims must be unique and in canonical gate-id order.",
    );
  }
  return deepFreeze(claims);
}

function parseIdentity(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationCloseoutEvidenceIdentity {
  const root = exactRecord(value, ["id", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function parseObservation(
  value: unknown,
): AssemblyIntegrityEvaluationCloseoutAdmission["observation"] {
  const root = exactRecord(
    value,
    ["id", "fingerprint", "observationFingerprint"],
    "$assemblyIntegrityEvaluationCloseout.observation",
  );
  return deepFreeze({
    id: safeId(
      root.id,
      "$assemblyIntegrityEvaluationCloseout.observation.id",
    ),
    fingerprint: parseFingerprint(
      root.fingerprint,
      "$assemblyIntegrityEvaluationCloseout.observation.fingerprint",
    ),
    observationFingerprint: parseFingerprint(
      root.observationFingerprint,
      "$assemblyIntegrityEvaluationCloseout.observation.observationFingerprint",
    ),
  });
}

function parseMethod(
  value: unknown,
): AssemblyIntegrityEvaluationCloseoutAdmission["method"] {
  const root = exactRecord(
    value,
    ["schemaVersion", "id", "version", "fingerprint"],
    "$assemblyIntegrityEvaluationCloseout.method",
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA,
    "$assemblyIntegrityEvaluationCloseout.method.schemaVersion",
  );
  literalValue(
    root.id,
    ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID,
    "$assemblyIntegrityEvaluationCloseout.method.id",
  );
  literalValue(
    root.version,
    ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION,
    "$assemblyIntegrityEvaluationCloseout.method.version",
  );
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA,
    id: ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID,
    version: ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION,
    fingerprint: parseFingerprint(
      root.fingerprint,
      "$assemblyIntegrityEvaluationCloseout.method.fingerprint",
    ),
  });
}

function parseCriteria(
  value: unknown,
): readonly AssemblyIntegrityEvaluationCriterion[] {
  if (
    !Array.isArray(value) ||
    value.length !== ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA.length
  ) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCloseout.criteria must name every L4 criterion exactly once.",
    );
  }
  return deepFreeze(value.map((candidate, index) => {
    const root = exactRecord(
      candidate,
      ["id", "verdict"],
      `$assemblyIntegrityEvaluationCloseout.criteria[${index}]`,
    );
    const id = ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA[index]!;
    literalValue(
      root.id,
      id,
      `$assemblyIntegrityEvaluationCloseout.criteria[${index}].id`,
    );
    return deepFreeze({
      id,
      verdict: verdictValue(
        root.verdict,
        `$assemblyIntegrityEvaluationCloseout.criteria[${index}].verdict`,
      ),
    });
  }));
}

function parseLimitations(value: unknown): AssemblyIntegrityEvaluationLimits {
  const root = exactRecord(value, [
    "providerCalls",
    "genericSysmlRequirementEvaluation",
    "safety",
    "physicalJoints",
    "clearance",
    "motion",
    "load",
    "fabricability",
  ], "$assemblyIntegrityEvaluationCloseout.limitations");
  for (
    const [key, expected] of Object.entries(
      ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
    )
  ) {
    literalValue(
      root[key as keyof typeof root],
      expected,
      `$assemblyIntegrityEvaluationCloseout.limitations.${key}`,
    );
  }
  return ASSEMBLY_INTEGRITY_EVALUATION_LIMITS;
}

function fixedValue(
  value: AssemblyIntegrityEvaluationCloseoutAdmission,
  key: FixedKey,
): Scalar {
  const entries: Record<FixedKey, Scalar> = {
    schemaVersion: value.schemaVersion,
    consequence: value.consequence,
    rejectionDisposition: value.rejectionDisposition,
    "project.id": value.projectId,
    "subject.id": value.subjectId,
    "approvedBrief.kind": value.approvedBriefBasis.kind,
    "approvedBrief.projectId": value.approvedBriefBasis.projectId,
    "approvedBrief.projectSnapshotId": value.approvedBriefBasis.projectSnapshotId,
    "approvedBrief.projectRevision": value.approvedBriefBasis.projectRevision,
    "approvedBrief.briefId": value.approvedBriefBasis.briefId,
    "approvedBrief.briefSnapshotId": value.approvedBriefBasis.briefSnapshotId,
    "approvedBrief.briefRevision": value.approvedBriefBasis.briefRevision,
    "approvedBrief.fingerprint.digest":
      value.approvedBriefBasis.approvedBriefFingerprint.digest,
    "verificationAuthority.id": value.verificationAuthority.id,
    "verificationAuthority.version": value.verificationAuthority.version,
    "gateClaims.count": value.gateClaims.length,
    "basis.snapshotId": value.basis.snapshotId,
    "basis.revision": value.basis.revision,
    "basis.fingerprint.digest": value.basis.fingerprint.digest,
    "evaluationCapture.id": value.evaluationCapture.id,
    "evaluationCapture.fingerprint.digest": value.evaluationCapture.fingerprint.digest,
    "geometryModule.id": value.geometryModule.id,
    "geometryModule.fingerprint.digest": value.geometryModule.fingerprint.digest,
    "assemblyStep.id": value.assemblyStep.id,
    "assemblyStep.fingerprint.digest": value.assemblyStep.fingerprint.digest,
    "observation.id": value.observation.id,
    "observation.fingerprint.digest": value.observation.fingerprint.digest,
    "observation.normalizedObservationFingerprint.digest":
      value.observation.observationFingerprint.digest,
    "method.schemaVersion": value.method.schemaVersion,
    "method.id": value.method.id,
    "method.version": value.method.version,
    "method.fingerprint.digest": value.method.fingerprint.digest,
    "limitations.providerCalls": value.limitations.providerCalls,
    "limitations.genericSysmlRequirementEvaluation":
      value.limitations.genericSysmlRequirementEvaluation,
    "limitations.safety": value.limitations.safety,
    "limitations.physicalJoints": value.limitations.physicalJoints,
    "limitations.clearance": value.limitations.clearance,
    "limitations.motion": value.limitations.motion,
    "limitations.load": value.limitations.load,
    "limitations.fabricability": value.limitations.fabricability,
    "criteria.count": value.criteria.length,
  };
  return entries[key];
}

function criterionKey(
  index: number,
  field: "id" | "verdict",
): string {
  return `${PREFIX}.criteria.${index}.${field}`;
}

function gateClaimKey(
  index: number,
  field: "gateItemId" | "role" | "status",
): string {
  return `${PREFIX}.gateClaims.${index}.${field}`;
}

function approvedBriefBasisFrom(
  values: ReadonlyMap<string, Scalar>,
): EngineeringApprovedBriefBasis {
  return {
    kind: literalApprovedBriefKind(scalar(values, "approvedBrief.kind")),
    projectId: scalar(values, "approvedBrief.projectId") as string,
    projectSnapshotId: scalar(values, "approvedBrief.projectSnapshotId") as string,
    projectRevision: scalar(values, "approvedBrief.projectRevision") as number,
    briefId: scalar(values, "approvedBrief.briefId") as string,
    briefSnapshotId: scalar(values, "approvedBrief.briefSnapshotId") as string,
    briefRevision: scalar(values, "approvedBrief.briefRevision") as number,
    approvedBriefFingerprint: fingerprint(
      scalar(values, "approvedBrief.fingerprint.digest"),
      "approvedBrief.fingerprint.digest",
    ),
  };
}

function literalApprovedBriefKind(value: Scalar): "approved-brief" {
  literalValue(value, "approved-brief", "approvedBrief.kind");
  return "approved-brief";
}

function consequenceFor(
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
): AssemblyIntegrityEvaluationCloseoutConsequence {
  if (
    operation.id === DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id &&
    operation.version === DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version
  ) return "accept";
  if (
    operation.id === DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id &&
    operation.version === DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version
  ) return "reject";
  throw new TypeError("Assembly-integrity closeout operation is not registered.");
}

function operationFor(
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
): AssemblyIntegrityEvaluationCloseoutOperation {
  return consequence === "accept"
    ? DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION
    : DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION;
}

function consequenceValue(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationCloseoutConsequence {
  if (value !== "accept" && value !== "reject") {
    throw new TypeError(`${path} must be accept or reject.`);
  }
  return value;
}

function rejectionDispositionFor(
  criteria: readonly AssemblyIntegrityEvaluationCriterion[],
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
): AssemblyIntegrityEvaluationRejectionDisposition {
  const eligible = isAssemblyIntegrityEvaluationAcceptEligible(criteria);
  if (consequence === "accept") {
    if (!eligible) {
      throw new TypeError(
        "An assembly-integrity accept closeout requires all five literal L4 criteria to be pass.",
      );
    }
    return "none";
  }
  return eligible ? "none" : "assembly-integrity-review-required";
}

function verdictValue(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationVerdict {
  if (value !== "pass" && value !== "fail" && value !== "unresolved") {
    throw new TypeError(`${path} must be pass, fail, or unresolved.`);
  }
  return value;
}

function gateClaimRoleValue(
  value: unknown,
  path: string,
): EngineeringGateClaim["role"] {
  if (value !== "satisfies" && value !== "contributes-to") {
    throw new TypeError(`${path} must be satisfies or contributes-to.`);
  }
  return value;
}

function gateClaimStatusValue(
  value: unknown,
  path: string,
): EngineeringGateClaim["status"] {
  if (
    value !== "current" && value !== "impact-unresolved" &&
    value !== "invalidated" && value !== "carried-forward"
  ) {
    throw new TypeError(`${path} must be an engineering gate-claim status.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a nonnegative integer.`);
  }
  return Number(value);
}

function requireParameter(
  parameter: EngineeringDecisionProposalParameter | undefined,
  key: string,
  index: number,
): asserts parameter is EngineeringDecisionProposalParameter {
  if (!parameter || parameter.key !== key || parameter.label !== key) {
    throw new TypeError(
      `Assembly-integrity evaluation closeout parameter ${index} must be ${key}.`,
    );
  }
}

function scalar(values: ReadonlyMap<string, Scalar>, key: string): Scalar {
  const value = values.get(key);
  if (value === undefined) {
    throw new TypeError(`Assembly-integrity evaluation closeout is missing ${key}.`);
  }
  return value;
}

function identityFrom(
  values: ReadonlyMap<string, Scalar>,
  prefix: "evaluationCapture" | "geometryModule" | "assemblyStep" | "observation",
): AssemblyIntegrityEvaluationCloseoutEvidenceIdentity {
  return {
    id: scalar(values, `${prefix}.id`) as string,
    fingerprint: fingerprint(
      scalar(values, `${prefix}.fingerprint.digest`),
      `${prefix}.fingerprint.digest`,
    ),
  };
}

function limitationsFrom(
  values: ReadonlyMap<string, Scalar>,
): AssemblyIntegrityEvaluationLimits {
  return {
    providerCalls: scalar(values, "limitations.providerCalls") as "none",
    genericSysmlRequirementEvaluation: scalar(
      values,
      "limitations.genericSysmlRequirementEvaluation",
    ) as "none",
    safety: scalar(values, "limitations.safety") as "not-evaluated",
    physicalJoints: scalar(values, "limitations.physicalJoints") as "not-evaluated",
    clearance: scalar(values, "limitations.clearance") as "not-evaluated",
    motion: scalar(values, "limitations.motion") as "not-evaluated",
    load: scalar(values, "limitations.load") as "not-evaluated",
    fabricability: scalar(values, "limitations.fabricability") as "not-evaluated",
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !/^[a-f0-9]{64}$/.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest: root.digest });
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest: value });
}
