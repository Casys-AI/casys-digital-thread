/**
 * Human L5 closeout candidates for an already-evaluated kinematic method.
 *
 * These are proposal contracts only. A provider completion, L3 observation,
 * or L4 pass does not create an L5 decision; the application layer must append
 * the separately signed human-origin work item with one returned candidate.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  fingerprintPrescribedKinematicsEvaluation,
  type PrescribedKinematicsEvaluation,
  recrossPrescribedKinematicsEvaluation,
  validatePrescribedKinematicsEvaluation,
} from "./prescribed-kinematics-evaluation.ts";
import {
  PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  type PrescribedKinematicsMethodSheet,
} from "./prescribed-kinematics-method-sheet.ts";
import type { PrescribedKinematicsObservation } from "./prescribed-kinematics-observation.ts";
import type { PrescribedKinematicsCase } from "./prescribed-kinematics-source-closure.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
} from "./operations.ts";

export const PRESCRIBED_KINEMATICS_EVALUATION_CLOSEOUT_SCHEMA =
  "prescribed-kinematics-evaluation-closeout/1.0" as const;
/**
 * This pure domain lot determines only L5 eligibility. The registered
 * accept/reject operations still require the application layer to supply the
 * exact project/subject/Thread basis and a signed human origin; neither an L3
 * observation nor an L4 evaluation can self-accept a closeout.
 */
export const PRESCRIBED_KINEMATICS_L5_STATUS = "eligibility-only" as const;

export type PrescribedKinematicsCloseoutConsequence = "accept" | "reject";
export type PrescribedKinematicsCloseoutRejectionDisposition =
  | "none"
  | "prescribed-kinematics-review-required";

export interface PrescribedKinematicsEvaluationCloseoutCandidate {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_EVALUATION_CLOSEOUT_SCHEMA;
  readonly operation:
    | typeof DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
    | typeof DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;
  readonly consequence: PrescribedKinematicsCloseoutConsequence;
  readonly rejectionDisposition: PrescribedKinematicsCloseoutRejectionDisposition;
  readonly evaluation: PrescribedKinematicsEvaluation;
  readonly evaluationFingerprint: ContentFingerprint;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly limitations: typeof PRESCRIBED_KINEMATICS_METHOD_LIMITS;
}

/** Exact evidence basis required before offering an L5 consequence. */
export interface PrescribedKinematicsEvaluationCloseoutBasis {
  readonly evaluation: PrescribedKinematicsEvaluation;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly method: PrescribedKinematicsMethodSheet;
}

/**
 * Return the human consequences eligible for one L4 capture. Reject is always
 * available; accept appears only for an all-pass L4 result.
 */
export async function prescribedKinematicsEvaluationCloseoutCandidates(
  basis: PrescribedKinematicsEvaluationCloseoutBasis,
): Promise<readonly PrescribedKinematicsEvaluationCloseoutCandidate[]> {
  const validated = await recrossPrescribedKinematicsEvaluation(basis);
  const evaluationFingerprint = await fingerprintPrescribedKinematicsEvaluation(
    validated,
  );
  const reject = candidateFor("reject", validated, evaluationFingerprint);
  if (validated.verdict !== "pass") return deepFreeze([reject]);
  return deepFreeze([
    candidateFor("accept", validated, evaluationFingerprint),
    reject,
  ]);
}

/**
 * Prove a persisted L5 candidate is the exact currently eligible consequence
 * for its case, L3 observation, sealed method, and deterministic L4 result.
 */
export async function recrossPrescribedKinematicsEvaluationCloseoutCandidate(input: {
  readonly candidate: PrescribedKinematicsEvaluationCloseoutCandidate;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly method: PrescribedKinematicsMethodSheet;
}): Promise<PrescribedKinematicsEvaluationCloseoutCandidate> {
  const candidate = await validatePrescribedKinematicsEvaluationCloseoutCandidate(
    input.candidate,
  );
  const candidates = await prescribedKinematicsEvaluationCloseoutCandidates({
    evaluation: candidate.evaluation,
    sealedCase: input.sealedCase,
    observation: input.observation,
    method: input.method,
  });
  const expected = candidates.find((entry) =>
    entry.consequence === candidate.consequence
  );
  if (!expected || deterministicJson(candidate) !== deterministicJson(expected)) {
    throw new TypeError(
      "Prescribed-kinematics L5 candidate does not match its exact eligible evidence basis.",
    );
  }
  return expected;
}

export async function validatePrescribedKinematicsEvaluationCloseoutCandidate(
  value: unknown,
  path = "$prescribedKinematicsEvaluationCloseout",
): Promise<PrescribedKinematicsEvaluationCloseoutCandidate> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "consequence",
      "rejectionDisposition",
      "evaluation",
      "evaluationFingerprint",
      "scope",
      "evidenceBoundary",
      "limitations",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_EVALUATION_CLOSEOUT_SCHEMA,
    `${path}.schemaVersion`,
  );
  const consequence = parseConsequence(root.consequence, `${path}.consequence`);
  const operation = parseOperation(root.operation, consequence, `${path}.operation`);
  const evaluation = await validatePrescribedKinematicsEvaluation(
    root.evaluation,
    `${path}.evaluation`,
  );
  const evaluationFingerprint = parseFingerprint(
    root.evaluationFingerprint,
    `${path}.evaluationFingerprint`,
  );
  const expectedFingerprint = await fingerprintPrescribedKinematicsEvaluation(
    evaluation,
  );
  if (!fingerprintsEqual(evaluationFingerprint, expectedFingerprint)) {
    throw new TypeError(
      `${path}.evaluationFingerprint must bind the exact L4 evaluation.`,
    );
  }
  const scope = nonEmptyText(root.scope, `${path}.scope`);
  const evidenceBoundary = nonEmptyText(
    root.evidenceBoundary,
    `${path}.evidenceBoundary`,
  );
  if (
    scope !== evaluation.scope ||
    evidenceBoundary !== evaluation.evidenceBoundary
  ) {
    throw new TypeError(
      `${path} must preserve the exact L4 method scope and evidence boundary.`,
    );
  }
  if (
    deterministicJson(root.limitations) !==
      deterministicJson(PRESCRIBED_KINEMATICS_METHOD_LIMITS)
  ) {
    throw new TypeError(`${path}.limitations must preserve the L4 method limits.`);
  }
  if (consequence === "accept" && evaluation.verdict !== "pass") {
    throw new TypeError(
      `${path}.accept is unavailable until every L4 criterion passes.`,
    );
  }
  const rejectionDisposition = dispositionFor(evaluation.verdict, consequence);
  literalValue(
    root.rejectionDisposition,
    rejectionDisposition,
    `${path}.rejectionDisposition`,
  );
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_EVALUATION_CLOSEOUT_SCHEMA,
    operation,
    consequence,
    rejectionDisposition,
    evaluation,
    evaluationFingerprint: expectedFingerprint,
    scope,
    evidenceBoundary,
    limitations: PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  });
}

function candidateFor(
  consequence: PrescribedKinematicsCloseoutConsequence,
  evaluation: PrescribedKinematicsEvaluation,
  evaluationFingerprint: ContentFingerprint,
): PrescribedKinematicsEvaluationCloseoutCandidate {
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_EVALUATION_CLOSEOUT_SCHEMA,
    operation: consequence === "accept"
      ? DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
      : DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    consequence,
    rejectionDisposition: dispositionFor(evaluation.verdict, consequence),
    evaluation,
    evaluationFingerprint,
    scope: evaluation.scope,
    evidenceBoundary: evaluation.evidenceBoundary,
    limitations: PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  });
}

function parseConsequence(
  value: unknown,
  path: string,
): PrescribedKinematicsCloseoutConsequence {
  if (value !== "accept" && value !== "reject") {
    throw new TypeError(`${path} must be accept or reject.`);
  }
  return value;
}

function parseOperation(
  value: unknown,
  consequence: PrescribedKinematicsCloseoutConsequence,
  path: string,
): PrescribedKinematicsEvaluationCloseoutCandidate["operation"] {
  const root = exactRecord(value, ["id", "version"], path);
  const expected = consequence === "accept"
    ? DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
    : DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;
  literalValue(root.id, expected.id, `${path}.id`);
  literalValue(root.version, expected.version, `${path}.version`);
  return expected;
}

function dispositionFor(
  verdict: PrescribedKinematicsEvaluation["verdict"],
  consequence: PrescribedKinematicsCloseoutConsequence,
): PrescribedKinematicsCloseoutRejectionDisposition {
  return consequence === "reject" && verdict !== "pass"
    ? "prescribed-kinematics-review-required"
    : "none";
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !/^[a-f0-9]{64}$/.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be non-empty text.`);
  }
  return value;
}
