/** Provider-free L4 evaluation of one sealed prescribed-kinematics method. */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  type PrescribedKinematicsMethodCriterion,
  type PrescribedKinematicsMethodSheet,
  recrossPrescribedKinematicsMethodSheet,
} from "./prescribed-kinematics-method-sheet.ts";
import {
  fingerprintPrescribedKinematicsObservation,
  parsePrescribedKinematicsObservation,
  type PrescribedKinematicsFact,
  type PrescribedKinematicsObservation,
} from "./prescribed-kinematics-observation.ts";
import { prescribedKinematicsSampleIndex } from "./prescribed-kinematics-case-source.ts";
import {
  type PrescribedKinematicsCase,
  validatePrescribedKinematicsCase,
} from "./prescribed-kinematics-source-closure.ts";
import { VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION } from "./operations.ts";

export const PRESCRIBED_KINEMATICS_EVALUATION_SCHEMA =
  "prescribed-kinematics-evaluation/1.0" as const;

export const PRESCRIBED_KINEMATICS_EVALUATION_VERDICTS = [
  "pass",
  "fail",
  "unresolved",
] as const;
export type PrescribedKinematicsEvaluationVerdict =
  (typeof PRESCRIBED_KINEMATICS_EVALUATION_VERDICTS)[number];

export interface PrescribedKinematicsEvaluationCriterion {
  readonly id: string;
  readonly kind: PrescribedKinematicsMethodCriterion["kind"];
  readonly verdict: PrescribedKinematicsEvaluationVerdict;
}

export interface PrescribedKinematicsEvaluation {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_EVALUATION_SCHEMA;
  readonly operation: typeof VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION;
  readonly caseFingerprint: ContentFingerprint;
  readonly observationFingerprint: ContentFingerprint;
  readonly methodFingerprint: ContentFingerprint;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly criteria: readonly PrescribedKinematicsEvaluationCriterion[];
  readonly verdict: PrescribedKinematicsEvaluationVerdict;
  readonly limits: typeof PRESCRIBED_KINEMATICS_METHOD_LIMITS;
}

/**
 * L4 recrosses exact case, L3, and method identities, then compares only the
 * signed pose, angle, unit-bearing per-joint residual, and convergence
 * criteria. It has no provider call and never evaluates collision, contact,
 * clearance, forces, strength, safety, manufacturability, or generic SysML
 * requirements.
 */
export async function evaluatePrescribedKinematics(input: {
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly method: PrescribedKinematicsMethodSheet;
}): Promise<PrescribedKinematicsEvaluation> {
  const sealedCase = await validatePrescribedKinematicsCase(input.sealedCase);
  const observation = await parsePrescribedKinematicsObservation(
    input.observation,
    sealedCase,
  );
  const method = await recrossPrescribedKinematicsMethodSheet(
    input.method,
    sealedCase,
    observation,
  );
  const criteria = deepFreeze(
    method.criteria.map((criterion) =>
      deepFreeze({
        id: criterion.id,
        kind: criterion.kind,
        verdict: evaluateCriterion(criterion, observation, sealedCase),
      })
    ),
  );
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_EVALUATION_SCHEMA,
    operation: VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    caseFingerprint: sealedCase.fingerprint,
    observationFingerprint: await fingerprintPrescribedKinematicsObservation(
      observation,
      sealedCase,
    ),
    methodFingerprint: method.fingerprint,
    scope: method.scope,
    evidenceBoundary: method.evidenceBoundary,
    criteria,
    verdict: aggregateVerdict(criteria.map((criterion) => criterion.verdict)),
    limits: PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  });
}

export function validatePrescribedKinematicsEvaluation(
  value: unknown,
  path = "$prescribedKinematicsEvaluation",
): Promise<PrescribedKinematicsEvaluation> {
  try {
    return Promise.resolve(validatePrescribedKinematicsEvaluationValue(value, path));
  } catch (error) {
    return Promise.reject(error);
  }
}

function validatePrescribedKinematicsEvaluationValue(
  value: unknown,
  path: string,
): PrescribedKinematicsEvaluation {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "caseFingerprint",
      "observationFingerprint",
      "methodFingerprint",
      "scope",
      "evidenceBoundary",
      "criteria",
      "verdict",
      "limits",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_EVALUATION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION.version,
    `${path}.operation.version`,
  );
  const criteria = parseEvaluationCriteria(root.criteria, `${path}.criteria`);
  if (criteria.length === 0) throw new TypeError(`${path}.criteria must not be empty.`);
  const verdict = parseVerdict(root.verdict, `${path}.verdict`);
  if (verdict !== aggregateVerdict(criteria.map((criterion) => criterion.verdict))) {
    throw new TypeError(`${path}.verdict must equal the fixed aggregate precedence.`);
  }
  if (
    deterministicJson(root.limits) !==
      deterministicJson(PRESCRIBED_KINEMATICS_METHOD_LIMITS)
  ) {
    throw new TypeError(`${path}.limits must equal the sealed method limits.`);
  }
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_EVALUATION_SCHEMA,
    operation: VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    caseFingerprint: parseFingerprint(root.caseFingerprint, `${path}.caseFingerprint`),
    observationFingerprint: parseFingerprint(
      root.observationFingerprint,
      `${path}.observationFingerprint`,
    ),
    methodFingerprint: parseFingerprint(
      root.methodFingerprint,
      `${path}.methodFingerprint`,
    ),
    scope: parseText(root.scope, `${path}.scope`),
    evidenceBoundary: parseText(root.evidenceBoundary, `${path}.evidenceBoundary`),
    criteria,
    verdict,
    limits: PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  });
}

export async function fingerprintPrescribedKinematicsEvaluation(
  evaluation: PrescribedKinematicsEvaluation,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    await validatePrescribedKinematicsEvaluation(evaluation),
  );
}

/**
 * Recompute a persisted L4 result from its exact L3 and sealed-method basis.
 * Structural validation alone intentionally cannot establish that provenance.
 */
export async function recrossPrescribedKinematicsEvaluation(input: {
  readonly evaluation: PrescribedKinematicsEvaluation;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly method: PrescribedKinematicsMethodSheet;
}): Promise<PrescribedKinematicsEvaluation> {
  const declared = await validatePrescribedKinematicsEvaluation(input.evaluation);
  const recomputed = await evaluatePrescribedKinematics({
    sealedCase: input.sealedCase,
    observation: input.observation,
    method: input.method,
  });
  if (deterministicJson(declared) !== deterministicJson(recomputed)) {
    throw new TypeError(
      "Prescribed-kinematics evaluation does not match its exact case, L3, and sealed-method basis.",
    );
  }
  return recomputed;
}

function evaluateCriterion(
  criterion: PrescribedKinematicsMethodCriterion,
  observation: PrescribedKinematicsObservation,
  sealedCase: PrescribedKinematicsCase,
): PrescribedKinematicsEvaluationVerdict {
  if (criterion.kind === "convergence") {
    return observation.convergence.status !== "observed"
      ? "unresolved"
      : observation.convergence.value === "converged"
      ? "pass"
      : "fail";
  }
  const sampleIndex = prescribedKinematicsSampleIndex(
    sealedCase.sourceClosure.source,
    criterion.sampleTimeS,
  );
  const sample = sampleIndex === undefined
    ? undefined
    : observation.samples[sampleIndex];
  if (!sample) return "unresolved";
  if (criterion.kind === "body-pose") {
    const fact = sample.poses.find((candidate) => candidate.bodyId === criterion.bodyId)
      ?.pose;
    if (!fact || fact.status !== "observed") return "unresolved";
    return poseVerdict(fact, criterion);
  }
  if (criterion.kind === "joint-angle") {
    const fact = sample.jointAngles.find((candidate) =>
      candidate.jointId === criterion.jointId
    )?.angleRad;
    if (!fact || fact.status !== "observed") return "unresolved";
    return Math.abs(fact.value - criterion.expectedAngleRad) <= criterion.toleranceRad
      ? "pass"
      : "fail";
  }
  const jointResidual = sample.jointResiduals.find((candidate) =>
    candidate.jointId === criterion.jointId
  );
  const residual = criterion.kind === "translation-residual"
    ? jointResidual?.translationResidualM
    : jointResidual?.rotationQuaternionImagResidual;
  if (!residual || residual.status !== "observed") return "unresolved";
  const observedNorm = Math.hypot(...residual.value);
  const maximumNorm = criterion.kind === "translation-residual"
    ? criterion.maximumNormM
    : criterion.maximumNorm;
  return observedNorm <= maximumNorm ? "pass" : "fail";
}

function poseVerdict(
  fact: Extract<PrescribedKinematicsFact<unknown>, { readonly status: "observed" }> & {
    readonly value: {
      readonly positionM: readonly [number, number, number];
      readonly orientationWxyz: readonly [number, number, number, number];
    };
  },
  criterion: Extract<
    PrescribedKinematicsMethodCriterion,
    { readonly kind: "body-pose" }
  >,
): PrescribedKinematicsEvaluationVerdict {
  const translationDistanceM = Math.hypot(
    fact.value.positionM[0] - criterion.expectedPose.positionM[0],
    fact.value.positionM[1] - criterion.expectedPose.positionM[1],
    fact.value.positionM[2] - criterion.expectedPose.positionM[2],
  );
  const dot = Math.abs(
    fact.value.orientationWxyz[0] * criterion.expectedPose.orientationWxyz[0] +
      fact.value.orientationWxyz[1] * criterion.expectedPose.orientationWxyz[1] +
      fact.value.orientationWxyz[2] * criterion.expectedPose.orientationWxyz[2] +
      fact.value.orientationWxyz[3] * criterion.expectedPose.orientationWxyz[3],
  );
  const orientationDistanceRad = 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
  return translationDistanceM <= criterion.translationToleranceM &&
      orientationDistanceRad <= criterion.orientationToleranceRad
    ? "pass"
    : "fail";
}

function parseEvaluationCriteria(
  value: unknown,
  path: string,
): readonly PrescribedKinematicsEvaluationCriterion[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const criteria = value.map((criterion, index) => {
    const itemPath = `${path}[${index}]`;
    const root = exactRecord(criterion, ["id", "kind", "verdict"], itemPath);
    const kind = root.kind;
    if (
      kind !== "body-pose" &&
      kind !== "joint-angle" &&
      kind !== "translation-residual" &&
      kind !== "rotation-quaternion-imag-residual" &&
      kind !== "convergence"
    ) {
      throw new TypeError(`${itemPath}.kind is unsupported.`);
    }
    return deepFreeze({
      id: safeId(root.id, `${itemPath}.id`),
      kind: kind as PrescribedKinematicsEvaluationCriterion["kind"],
      verdict: parseVerdict(root.verdict, `${itemPath}.verdict`),
    });
  });
  rejectDuplicates(criteria.map((criterion) => criterion.id), `${path}.id`);
  return deepFreeze(criteria);
}

function aggregateVerdict(
  verdicts: readonly PrescribedKinematicsEvaluationVerdict[],
): PrescribedKinematicsEvaluationVerdict {
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("unresolved")) return "unresolved";
  return "pass";
}

function parseVerdict(
  value: unknown,
  path: string,
): PrescribedKinematicsEvaluationVerdict {
  if (value !== "pass" && value !== "fail" && value !== "unresolved") {
    throw new TypeError(`${path} must be pass, fail, or unresolved.`);
  }
  return value;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !/^[a-f0-9]{64}$/.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

function parseText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be non-empty text.`);
  }
  return value;
}
