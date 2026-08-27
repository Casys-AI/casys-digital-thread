/**
 * Durable provider-free envelope for a human static-mechanical L5 closeout.
 *
 * It names the exact already-recorded FEA @3 branch.  Saving this document
 * neither runs CalculiX nor calls SysON, and a literal L4 pass remains only
 * an eligibility condition for a separately signed human consequence.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
  EVALUATION_CLOSEOUT_ADMISSION_SCHEMA,
  STATIC_MECHANICAL_CLOSEOUT_LIMITS,
  type StaticMechanicalEvaluationCloseoutAdmission,
  type StaticMechanicalEvaluationCloseoutOperation,
  validateStaticMechanicalEvaluationCloseoutAdmission,
} from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";

export const EVALUATION_CLOSEOUT_CAPTURE_SCHEMA =
  "evaluation-closeout-capture/1.0" as const;

export { EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX };

export interface StaticMechanicalEvaluationCloseoutCapture {
  readonly schemaVersion: typeof EVALUATION_CLOSEOUT_CAPTURE_SCHEMA;
  readonly kind: "static-mechanical-evaluation-closeout";
  readonly operation: {
    readonly id: StaticMechanicalEvaluationCloseoutOperation["id"];
    readonly version: StaticMechanicalEvaluationCloseoutOperation["version"];
  };
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: StaticMechanicalEvaluationCloseoutAdmission;
  /** Exact repeated identities make a standalone CAS record inspectable. */
  readonly inputs: {
    readonly canonicalStep:
      StaticMechanicalEvaluationCloseoutAdmission["canonicalStep"];
    readonly sealedProof: StaticMechanicalEvaluationCloseoutAdmission["sealedProof"];
    readonly executionEvidence:
      StaticMechanicalEvaluationCloseoutAdmission["executionEvidence"];
    readonly evaluationCapture:
      StaticMechanicalEvaluationCloseoutAdmission["evaluationCapture"];
  };
  /** Server-derived proof limits, copied literally from the sealed proof. */
  readonly proofLimitations:
    StaticMechanicalEvaluationCloseoutAdmission["proofLimitations"];
  readonly limits: typeof STATIC_MECHANICAL_CLOSEOUT_LIMITS;
}

export function validateStaticMechanicalEvaluationCloseoutCapture(
  value: unknown,
  path = "$staticMechanicalEvaluationCloseoutCapture",
): StaticMechanicalEvaluationCloseoutCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "admission",
    "inputs",
    "proofLimitations",
    "limits",
  ], path);
  literalValue(
    root.schemaVersion,
    EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, "static-mechanical-evaluation-closeout", `${path}.kind`);
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  if (
    operation.id !== DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id &&
    operation.id !== DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id
  ) {
    throw new TypeError(
      `${path}.operation.id must name a registered static-mechanical closeout.`,
    );
  }
  literalValue(operation.version, "1", `${path}.operation.version`);
  const admission = validateStaticMechanicalEvaluationCloseoutAdmission(root.admission);
  if (admission.schemaVersion !== EVALUATION_CLOSEOUT_ADMISSION_SCHEMA) {
    throw new TypeError(`${path}.admission has an unsupported schema.`);
  }
  const consequence = operation.id === DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id
    ? "accept"
    : "reject";
  if (admission.consequence !== consequence) {
    throw new TypeError(
      `${path}.operation must match the signed admission consequence.`,
    );
  }
  const inputs = exactRecord(root.inputs, [
    "canonicalStep",
    "sealedProof",
    "executionEvidence",
    "evaluationCapture",
  ], `${path}.inputs`);
  assertIdentity(
    inputs.canonicalStep,
    admission.canonicalStep,
    `${path}.inputs.canonicalStep`,
  );
  assertIdentity(
    inputs.sealedProof,
    admission.sealedProof,
    `${path}.inputs.sealedProof`,
  );
  assertIdentity(
    inputs.executionEvidence,
    admission.executionEvidence,
    `${path}.inputs.executionEvidence`,
  );
  assertIdentity(
    inputs.evaluationCapture,
    admission.evaluationCapture,
    `${path}.inputs.evaluationCapture`,
  );
  const proofLimitations = validateStaticMechanicalEvaluationCloseoutAdmission({
    ...admission,
    proofLimitations: root.proofLimitations,
  }).proofLimitations;
  if (
    deterministicJson(proofLimitations) !==
      deterministicJson(admission.proofLimitations)
  ) {
    throw new TypeError(
      `${path}.proofLimitations must equal the signed sealed-proof boundary.`,
    );
  }
  const limits = exactRecord(root.limits, [
    "engineCalls",
    "sysonCalls",
    "l4PassIsNotL5",
    "rejectionGrants",
  ], `${path}.limits`);
  literalValue(limits.engineCalls, "none", `${path}.limits.engineCalls`);
  literalValue(limits.sysonCalls, "none", `${path}.limits.sysonCalls`);
  literalValue(limits.l4PassIsNotL5, true, `${path}.limits.l4PassIsNotL5`);
  literalValue(limits.rejectionGrants, "none", `${path}.limits.rejectionGrants`);
  return deepFreeze({
    schemaVersion: EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    kind: "static-mechanical-evaluation-closeout",
    operation: { id: operation.id, version: "1" },
    trustedRunId: safeId(root.trustedRunId, `${path}.trustedRunId`),
    decisionId: safeId(root.decisionId, `${path}.decisionId`),
    sealedAt: isoDateTime(root.sealedAt, `${path}.sealedAt`),
    admission,
    inputs: {
      canonicalStep: admission.canonicalStep,
      sealedProof: admission.sealedProof,
      executionEvidence: admission.executionEvidence,
      evaluationCapture: admission.evaluationCapture,
    },
    proofLimitations: admission.proofLimitations,
    limits: STATIC_MECHANICAL_CLOSEOUT_LIMITS,
  });
}

export function canonicalStaticMechanicalEvaluationCloseoutCaptureText(
  value: StaticMechanicalEvaluationCloseoutCapture,
): string {
  return deterministicJson(validateStaticMechanicalEvaluationCloseoutCapture(value));
}

function assertIdentity(
  value: unknown,
  expected: StaticMechanicalEvaluationCloseoutAdmission["canonicalStep"],
  path: string,
): void {
  const identity = exactRecord(value, ["id", "fingerprint", "producerRunId"], path);
  const fingerprint = exactRecord(
    identity.fingerprint,
    ["algorithm", "digest"],
    `${path}.fingerprint`,
  );
  literalValue(identity.id, expected.id, `${path}.id`);
  literalValue(identity.producerRunId, expected.producerRunId, `${path}.producerRunId`);
  literalValue(
    fingerprint.algorithm,
    expected.fingerprint.algorithm,
    `${path}.fingerprint.algorithm`,
  );
  literalValue(
    fingerprint.digest,
    expected.fingerprint.digest,
    `${path}.fingerprint.digest`,
  );
}

function isoDateTime(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO-8601 timestamp.`);
  }
  return value;
}
