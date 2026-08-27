/**
 * Durable provider-free envelope for one human assembly-integrity L5 closeout.
 *
 * This is a consequence over an exact L4 capture. It neither calls the
 * observer nor re-evaluates L4, and it never turns numerical integrity into a
 * safety conclusion or certification.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
  type AssemblyIntegrityEvaluationLimits,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  type AssemblyIntegrityEvaluationCloseoutAdmission,
  type AssemblyIntegrityEvaluationCloseoutOperation,
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  validateAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";

export const ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA =
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA;

export const ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX =
  "casys://assembly-integrity-evaluation-closeout/" as const;

export const ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS = deepFreeze({
  providerCalls: "none" as const,
  genericSysmlRequirementEvaluation: "none" as const,
  certification: "not-issued" as const,
  l4PassIsNotL5: true as const,
});

export interface AssemblyIntegrityEvaluationCloseoutCapture {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA;
  readonly kind: "assembly-integrity-evaluation-closeout";
  readonly operation: {
    readonly id: AssemblyIntegrityEvaluationCloseoutOperation["id"];
    readonly version: AssemblyIntegrityEvaluationCloseoutOperation["version"];
  };
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: AssemblyIntegrityEvaluationCloseoutAdmission;
  readonly evaluationCapture: {
    readonly id: string;
    readonly fingerprint: AssemblyIntegrityEvaluationCloseoutAdmission[
      "evaluationCapture"
    ]["fingerprint"];
    readonly uri: string;
  };
  /** Literal L4 scope copied without abbreviation or reinterpretation. */
  readonly l4Limitations: AssemblyIntegrityEvaluationLimits;
  readonly limits: typeof ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS;
}

export function validateAssemblyIntegrityEvaluationCloseoutCapture(
  value: unknown,
  path = "$assemblyIntegrityEvaluationCloseoutCapture",
): AssemblyIntegrityEvaluationCloseoutCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "admission",
    "evaluationCapture",
    "l4Limitations",
    "limits",
  ], path);
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, "assembly-integrity-evaluation-closeout", `${path}.kind`);
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  const consequence = operation.id ===
        DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id &&
      operation.version ===
        DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version
    ? "accept"
    : operation.id === DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id &&
        operation.version ===
          DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version
    ? "reject"
    : undefined;
  if (!consequence) {
    throw new TypeError(
      `${path}.operation must name a registered assembly-integrity closeout.`,
    );
  }
  const admission = validateAssemblyIntegrityEvaluationCloseoutAdmission(
    root.admission,
  );
  if (admission.consequence !== consequence) {
    throw new TypeError(
      `${path}.operation must match the signed admission consequence.`,
    );
  }
  const evaluationCapture = exactRecord(
    root.evaluationCapture,
    ["id", "fingerprint", "uri"],
    `${path}.evaluationCapture`,
  );
  literalValue(
    evaluationCapture.id,
    admission.evaluationCapture.id,
    `${path}.evaluationCapture.id`,
  );
  const fingerprint = exactRecord(
    evaluationCapture.fingerprint,
    ["algorithm", "digest"],
    `${path}.evaluationCapture.fingerprint`,
  );
  literalValue(
    fingerprint.algorithm,
    admission.evaluationCapture.fingerprint.algorithm,
    `${path}.evaluationCapture.fingerprint.algorithm`,
  );
  literalValue(
    fingerprint.digest,
    admission.evaluationCapture.fingerprint.digest,
    `${path}.evaluationCapture.fingerprint.digest`,
  );
  literalValue(
    evaluationCapture.uri,
    `${ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX}${admission.evaluationCapture.fingerprint.digest}`,
    `${path}.evaluationCapture.uri`,
  );
  const l4Limitations = validateLimitations(
    root.l4Limitations,
    `${path}.l4Limitations`,
  );
  if (deterministicJson(l4Limitations) !== deterministicJson(admission.limitations)) {
    throw new TypeError(`${path}.l4Limitations must equal the signed L4 limitations.`);
  }
  const limits = exactRecord(root.limits, [
    "providerCalls",
    "genericSysmlRequirementEvaluation",
    "certification",
    "l4PassIsNotL5",
  ], `${path}.limits`);
  literalValue(limits.providerCalls, "none", `${path}.limits.providerCalls`);
  literalValue(
    limits.genericSysmlRequirementEvaluation,
    "none",
    `${path}.limits.genericSysmlRequirementEvaluation`,
  );
  literalValue(limits.certification, "not-issued", `${path}.limits.certification`);
  literalValue(limits.l4PassIsNotL5, true, `${path}.limits.l4PassIsNotL5`);
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation-closeout" as const,
    operation: {
      id: operation.id as AssemblyIntegrityEvaluationCloseoutOperation["id"],
      version: operation
        .version as AssemblyIntegrityEvaluationCloseoutOperation["version"],
    },
    trustedRunId: safeId(root.trustedRunId, `${path}.trustedRunId`),
    decisionId: safeId(root.decisionId, `${path}.decisionId`),
    sealedAt: isoDateTime(root.sealedAt, `${path}.sealedAt`),
    admission,
    evaluationCapture: {
      id: admission.evaluationCapture.id,
      fingerprint: admission.evaluationCapture.fingerprint,
      uri:
        `${ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX}${admission.evaluationCapture.fingerprint.digest}`,
    },
    l4Limitations,
    limits: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  });
}

export function canonicalAssemblyIntegrityEvaluationCloseoutCaptureText(
  value: AssemblyIntegrityEvaluationCloseoutCapture,
): string {
  return deterministicJson(validateAssemblyIntegrityEvaluationCloseoutCapture(value));
}

function validateLimitations(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationLimits {
  const root = exactRecord(value, [
    "providerCalls",
    "genericSysmlRequirementEvaluation",
    "safety",
    "physicalJoints",
    "clearance",
    "motion",
    "load",
    "fabricability",
  ], path);
  for (
    const [key, expected] of Object.entries(
      ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
    )
  ) {
    literalValue(root[key as keyof typeof root], expected, `${path}.${key}`);
  }
  return ASSEMBLY_INTEGRITY_EVALUATION_LIMITS;
}

function isoDateTime(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO-8601 timestamp.`);
  }
  return value;
}
