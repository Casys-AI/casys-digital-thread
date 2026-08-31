/**
 * Separate proposed and sealed L4 method contracts for prescribed kinematics.
 *
 * A case declares only mechanism/scenario/sampling. This method source names
 * the criteria proposed for one exact L3 result. The server later binds the
 * seal operation to the human MRTR; L4 consumes only the resulting immutable
 * method sheet, never criteria from the agent-authored case source.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  PRESCRIBED_KINEMATICS_QUATERNION_NORM_EPSILON,
  type PrescribedKinematicsPose,
  prescribedKinematicsSampleIndex,
} from "./prescribed-kinematics-case-source.ts";
import {
  fingerprintPrescribedKinematicsObservation,
  parsePrescribedKinematicsObservation,
  type PrescribedKinematicsObservation,
} from "./prescribed-kinematics-observation.ts";
import {
  type PrescribedKinematicsCase,
  validatePrescribedKinematicsCase,
} from "./prescribed-kinematics-source-closure.ts";
import { VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION } from "./operations.ts";

export const PRESCRIBED_KINEMATICS_METHOD_SHEET_SOURCE_SCHEMA =
  "prescribed-kinematics-method-sheet-source/1.0" as const;
export const PRESCRIBED_KINEMATICS_METHOD_SHEET_SCHEMA =
  "prescribed-kinematics-method-sheet/1.0" as const;

export const PRESCRIBED_KINEMATICS_METHOD_LIMITS = deepFreeze({
  providerCalls: "none" as const,
  genericSysmlRequirementEvaluation: "none" as const,
  collision: "not_evaluated" as const,
  contact: "not_evaluated" as const,
  clearance: "not_evaluated" as const,
  forces: "not_evaluated" as const,
  strength: "not_evaluated" as const,
  safety: "not_evaluated" as const,
  manufacturability: "not_evaluated" as const,
});

export interface PrescribedKinematicsBodyPoseCriterion {
  readonly id: string;
  readonly kind: "body-pose";
  readonly bodyId: string;
  readonly sampleTimeS: number;
  readonly expectedPose: PrescribedKinematicsPose;
  readonly translationToleranceM: number;
  readonly orientationToleranceRad: number;
}

export interface PrescribedKinematicsJointAngleCriterion {
  readonly id: string;
  readonly kind: "joint-angle";
  readonly jointId: string;
  readonly sampleTimeS: number;
  readonly expectedAngleRad: number;
  readonly toleranceRad: number;
}

export interface PrescribedKinematicsTranslationResidualCriterion {
  readonly id: string;
  readonly kind: "translation-residual";
  readonly jointId: string;
  readonly sampleTimeS: number;
  /** Euclidean norm of the factual `translationResidualM` vector, in metres. */
  readonly maximumNormM: number;
}

export interface PrescribedKinematicsRotationQuaternionImagResidualCriterion {
  readonly id: string;
  readonly kind: "rotation-quaternion-imag-residual";
  readonly jointId: string;
  readonly sampleTimeS: number;
  /** Euclidean norm of the dimensionless quaternion imaginary residual vector. */
  readonly maximumNorm: number;
}

export interface PrescribedKinematicsConvergenceCriterion {
  readonly id: string;
  readonly kind: "convergence";
}

export type PrescribedKinematicsMethodCriterion =
  | PrescribedKinematicsBodyPoseCriterion
  | PrescribedKinematicsJointAngleCriterion
  | PrescribedKinematicsTranslationResidualCriterion
  | PrescribedKinematicsRotationQuaternionImagResidualCriterion
  | PrescribedKinematicsConvergenceCriterion;

/** Agent-proposed criteria; they become usable only in a sealed method sheet. */
export interface PrescribedKinematicsMethodSheetSource {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_METHOD_SHEET_SOURCE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly caseFingerprint: ContentFingerprint;
  readonly observationFingerprint: ContentFingerprint;
  readonly criteria: readonly PrescribedKinematicsMethodCriterion[];
}

/** Immutable input for the L4 evaluator after the human-reviewed method seal. */
export interface PrescribedKinematicsMethodSheet {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_METHOD_SHEET_SCHEMA;
  readonly operation: typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION;
  readonly source: {
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly caseFingerprint: ContentFingerprint;
  readonly observationFingerprint: ContentFingerprint;
  /** Preserved verbatim from the signed method source. */
  readonly scope: string;
  /** Preserved verbatim from the signed method source. */
  readonly evidenceBoundary: string;
  readonly criteria: readonly PrescribedKinematicsMethodCriterion[];
  readonly limits: typeof PRESCRIBED_KINEMATICS_METHOD_LIMITS;
  readonly fingerprint: ContentFingerprint;
}

export function validatePrescribedKinematicsMethodSheetSource(
  value: unknown,
  path = "$prescribedKinematicsMethodSheetSource",
): PrescribedKinematicsMethodSheetSource {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "id",
      "revision",
      "scope",
      "evidenceBoundary",
      "caseFingerprint",
      "observationFingerprint",
      "criteria",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_METHOD_SHEET_SOURCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const criteria = parseCriteria(root.criteria, `${path}.criteria`);
  if (criteria.length === 0) throw new TypeError(`${path}.criteria must not be empty.`);
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_METHOD_SHEET_SOURCE_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    scope: nonEmptyText(root.scope, `${path}.scope`),
    evidenceBoundary: nonEmptyText(root.evidenceBoundary, `${path}.evidenceBoundary`),
    caseFingerprint: parseFingerprint(root.caseFingerprint, `${path}.caseFingerprint`),
    observationFingerprint: parseFingerprint(
      root.observationFingerprint,
      `${path}.observationFingerprint`,
    ),
    criteria,
  });
}

export function canonicalPrescribedKinematicsMethodSheetSourceText(
  source: PrescribedKinematicsMethodSheetSource,
): string {
  return deterministicJson(validatePrescribedKinematicsMethodSheetSource(source));
}

export function canonicalizePrescribedKinematicsMethodSheetSource(
  value: unknown,
): { readonly source: PrescribedKinematicsMethodSheetSource; readonly text: string } {
  const source = validatePrescribedKinematicsMethodSheetSource(value);
  const text = deterministicJson(source);
  const replay = validatePrescribedKinematicsMethodSheetSource(JSON.parse(text));
  if (deterministicJson(replay) !== text) {
    throw new TypeError(
      "Prescribed-kinematics method sheet source is not canonical after exact replay.",
    );
  }
  return deepFreeze({ source: replay, text });
}

export function fingerprintPrescribedKinematicsMethodSheetSource(
  source: PrescribedKinematicsMethodSheetSource,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validatePrescribedKinematicsMethodSheetSource(source));
}

/**
 * Provider-free recross of an authored method source against one exact L1/L3
 * evidence pair. This validates readiness for human review; it does not seal
 * or persist a method sheet.
 */
export async function validatePrescribedKinematicsMethodSheetSourceAgainstEvidence(
  input: {
    readonly source: PrescribedKinematicsMethodSheetSource;
    readonly sealedCase: PrescribedKinematicsCase;
    readonly observation: PrescribedKinematicsObservation;
  },
): Promise<{
  readonly source: PrescribedKinematicsMethodSheetSource;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly observationFingerprint: ContentFingerprint;
}> {
  const sealedCase = await validatePrescribedKinematicsCase(input.sealedCase);
  const observation = await parsePrescribedKinematicsObservation(
    input.observation,
    sealedCase,
  );
  const source = validatePrescribedKinematicsMethodSheetSource(input.source);
  const observationFingerprint = await fingerprintPrescribedKinematicsObservation(
    observation,
    sealedCase,
  );
  if (!fingerprintsEqual(source.caseFingerprint, sealedCase.fingerprint)) {
    throw new TypeError(
      "Prescribed-kinematics method source must bind the exact sealed case.",
    );
  }
  if (!fingerprintsEqual(source.observationFingerprint, observationFingerprint)) {
    throw new TypeError(
      "Prescribed-kinematics method source must bind the exact L3 observation.",
    );
  }
  assertCriteriaFitCase(
    source.criteria,
    sealedCase,
    "$prescribedKinematicsMethodSheetSource.criteria",
  );
  return deepFreeze({ source, sealedCase, observation, observationFingerprint });
}

/**
 * Compile a case/L3-bound method sheet. Calling it does not replace the
 * application-level signed-MRTR requirement for `verify.seal-...-method@1`.
 */
export async function sealPrescribedKinematicsMethodSheet(input: {
  readonly source: PrescribedKinematicsMethodSheetSource;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
}): Promise<PrescribedKinematicsMethodSheet> {
  const recrossed = await validatePrescribedKinematicsMethodSheetSourceAgainstEvidence(
    input,
  );
  const { source, sealedCase, observationFingerprint } = recrossed;
  const sourceFingerprint = await fingerprintPrescribedKinematicsMethodSheetSource(
    source,
  );
  const body = {
    schemaVersion: PRESCRIBED_KINEMATICS_METHOD_SHEET_SCHEMA,
    operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    source: {
      id: source.id,
      revision: source.revision,
      fingerprint: sourceFingerprint,
    },
    caseFingerprint: sealedCase.fingerprint,
    observationFingerprint,
    scope: source.scope,
    evidenceBoundary: source.evidenceBoundary,
    criteria: source.criteria,
    limits: PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  } as const;
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validatePrescribedKinematicsMethodSheet(
  value: unknown,
  path = "$prescribedKinematicsMethodSheet",
): Promise<PrescribedKinematicsMethodSheet> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "source",
      "caseFingerprint",
      "observationFingerprint",
      "scope",
      "evidenceBoundary",
      "criteria",
      "limits",
      "fingerprint",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_METHOD_SHEET_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION.version,
    `${path}.operation.version`,
  );
  const source = exactRecord(
    root.source,
    ["id", "revision", "fingerprint"],
    `${path}.source`,
  );
  const criteria = parseCriteria(root.criteria, `${path}.criteria`);
  if (criteria.length === 0) throw new TypeError(`${path}.criteria must not be empty.`);
  if (
    deterministicJson(root.limits) !==
      deterministicJson(PRESCRIBED_KINEMATICS_METHOD_LIMITS)
  ) {
    throw new TypeError(
      `${path}.limits must equal the literal prescribed-kinematics method limits.`,
    );
  }
  const body = {
    schemaVersion: PRESCRIBED_KINEMATICS_METHOD_SHEET_SCHEMA,
    operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    source: {
      id: safeId(source.id, `${path}.source.id`),
      revision: positiveInteger(source.revision, `${path}.source.revision`),
      fingerprint: parseFingerprint(source.fingerprint, `${path}.source.fingerprint`),
    },
    caseFingerprint: parseFingerprint(root.caseFingerprint, `${path}.caseFingerprint`),
    observationFingerprint: parseFingerprint(
      root.observationFingerprint,
      `${path}.observationFingerprint`,
    ),
    scope: nonEmptyText(root.scope, `${path}.scope`),
    evidenceBoundary: nonEmptyText(root.evidenceBoundary, `${path}.evidenceBoundary`),
    criteria,
    limits: PRESCRIBED_KINEMATICS_METHOD_LIMITS,
  } as const;
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(
      `${path}.fingerprint does not match its exact method-sheet body.`,
    );
  }
  return deepFreeze({ ...body, fingerprint: expected });
}

/** Exact case recross required before L4 reads a persisted method sheet. */
export async function recrossPrescribedKinematicsMethodSheet(
  method: PrescribedKinematicsMethodSheet,
  sealedCase: PrescribedKinematicsCase,
  observation: PrescribedKinematicsObservation,
): Promise<PrescribedKinematicsMethodSheet> {
  const validatedMethod = await validatePrescribedKinematicsMethodSheet(method);
  const validatedCase = await validatePrescribedKinematicsCase(sealedCase);
  const validatedObservation = await parsePrescribedKinematicsObservation(
    observation,
    validatedCase,
  );
  if (!fingerprintsEqual(validatedMethod.caseFingerprint, validatedCase.fingerprint)) {
    throw new TypeError(
      "Prescribed-kinematics method sheet is bound to a different sealed case.",
    );
  }
  const observationFingerprint = await fingerprintPrescribedKinematicsObservation(
    validatedObservation,
    validatedCase,
  );
  if (
    !fingerprintsEqual(validatedMethod.observationFingerprint, observationFingerprint)
  ) {
    throw new TypeError(
      "Prescribed-kinematics method sheet is bound to a different L3 observation.",
    );
  }
  assertCriteriaFitCase(
    validatedMethod.criteria,
    validatedCase,
    "$prescribedKinematicsMethodSheet.criteria",
  );
  return validatedMethod;
}

function parseCriteria(
  value: unknown,
  path: string,
): readonly PrescribedKinematicsMethodCriterion[] {
  const criteria = arrayOf(value, path).map((criterion, index) => {
    const itemPath = `${path}[${index}]`;
    const base = exactRecord(criterion, Object.keys(criterion as object), itemPath);
    if (base.kind === "body-pose") {
      const record = exactRecord(
        criterion,
        [
          "id",
          "kind",
          "bodyId",
          "sampleTimeS",
          "expectedPose",
          "translationToleranceM",
          "orientationToleranceRad",
        ],
        itemPath,
      );
      return deepFreeze({
        id: safeId(record.id, `${itemPath}.id`),
        kind: "body-pose" as const,
        bodyId: safeId(record.bodyId, `${itemPath}.bodyId`),
        sampleTimeS: nonNegativeFinite(record.sampleTimeS, `${itemPath}.sampleTimeS`),
        expectedPose: parsePose(record.expectedPose, `${itemPath}.expectedPose`),
        translationToleranceM: positiveFinite(
          record.translationToleranceM,
          `${itemPath}.translationToleranceM`,
        ),
        orientationToleranceRad: positiveFinite(
          record.orientationToleranceRad,
          `${itemPath}.orientationToleranceRad`,
        ),
      });
    }
    if (base.kind === "joint-angle") {
      const record = exactRecord(
        criterion,
        ["id", "kind", "jointId", "sampleTimeS", "expectedAngleRad", "toleranceRad"],
        itemPath,
      );
      return deepFreeze({
        id: safeId(record.id, `${itemPath}.id`),
        kind: "joint-angle" as const,
        jointId: safeId(record.jointId, `${itemPath}.jointId`),
        sampleTimeS: nonNegativeFinite(record.sampleTimeS, `${itemPath}.sampleTimeS`),
        expectedAngleRad: finite(
          record.expectedAngleRad,
          `${itemPath}.expectedAngleRad`,
        ),
        toleranceRad: positiveFinite(record.toleranceRad, `${itemPath}.toleranceRad`),
      });
    }
    if (base.kind === "translation-residual") {
      const record = exactRecord(
        criterion,
        ["id", "kind", "jointId", "sampleTimeS", "maximumNormM"],
        itemPath,
      );
      return deepFreeze({
        id: safeId(record.id, `${itemPath}.id`),
        kind: "translation-residual" as const,
        jointId: safeId(record.jointId, `${itemPath}.jointId`),
        sampleTimeS: nonNegativeFinite(record.sampleTimeS, `${itemPath}.sampleTimeS`),
        maximumNormM: nonNegativeFinite(
          record.maximumNormM,
          `${itemPath}.maximumNormM`,
        ),
      });
    }
    if (base.kind === "rotation-quaternion-imag-residual") {
      const record = exactRecord(
        criterion,
        ["id", "kind", "jointId", "sampleTimeS", "maximumNorm"],
        itemPath,
      );
      return deepFreeze({
        id: safeId(record.id, `${itemPath}.id`),
        kind: "rotation-quaternion-imag-residual" as const,
        jointId: safeId(record.jointId, `${itemPath}.jointId`),
        sampleTimeS: nonNegativeFinite(record.sampleTimeS, `${itemPath}.sampleTimeS`),
        maximumNorm: nonNegativeFinite(record.maximumNorm, `${itemPath}.maximumNorm`),
      });
    }
    if (base.kind === "convergence") {
      const record = exactRecord(criterion, ["id", "kind"], itemPath);
      return deepFreeze({
        id: safeId(record.id, `${itemPath}.id`),
        kind: "convergence" as const,
      });
    }
    throw new TypeError(`${itemPath}.kind is unsupported.`);
  });
  rejectDuplicates(criteria.map((criterion) => criterion.id), `${path}.id`);
  rejectDuplicates(
    criteria.filter((criterion) => criterion.kind === "body-pose").map((criterion) =>
      `${criterion.bodyId}\u0000${criterion.sampleTimeS}`
    ),
    `${path} body-pose selections`,
  );
  rejectDuplicates(
    criteria.filter((criterion) => criterion.kind === "joint-angle").map((criterion) =>
      `${criterion.jointId}\u0000${criterion.sampleTimeS}`
    ),
    `${path} joint-angle selections`,
  );
  rejectDuplicates(
    criteria.filter((criterion) => criterion.kind === "translation-residual").map((
      criterion,
    ) => `${criterion.jointId}\u0000${criterion.sampleTimeS}`),
    `${path} translation-residual selections`,
  );
  rejectDuplicates(
    criteria.filter((criterion) =>
      criterion.kind === "rotation-quaternion-imag-residual"
    )
      .map((criterion) => `${criterion.jointId}\u0000${criterion.sampleTimeS}`),
    `${path} rotation-quaternion-imag-residual selections`,
  );
  if (criteria.filter((criterion) => criterion.kind === "convergence").length > 1) {
    throw new TypeError(`${path} may declare at most one convergence criterion.`);
  }
  return deepFreeze(
    [...criteria].sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function assertCriteriaFitCase(
  criteria: readonly PrescribedKinematicsMethodCriterion[],
  sealedCase: PrescribedKinematicsCase,
  path: string,
): void {
  const source = sealedCase.sourceClosure.source;
  const bodyIds = new Set(source.bodies.map((body) => body.bodyId));
  const joints = new Map(source.joints.map((joint) => [joint.jointId, joint]));
  const bodyPoseSelections: string[] = [];
  const jointAngleSelections: string[] = [];
  const translationResidualSelections: string[] = [];
  const rotationResidualSelections: string[] = [];
  for (const criterion of criteria) {
    if (criterion.kind === "body-pose") {
      if (!bodyIds.has(criterion.bodyId)) {
        throw new TypeError(
          `${path}.${criterion.id} names a body absent from the sealed case.`,
        );
      }
      bodyPoseSelections.push(`${criterion.bodyId}\u0000${
        assertSampleTime(
          source,
          criterion.sampleTimeS,
          `${path}.${criterion.id}.sampleTimeS`,
        )
      }`);
    } else if (criterion.kind === "joint-angle") {
      const joint = joints.get(criterion.jointId);
      if (!joint) {
        throw new TypeError(
          `${path}.${criterion.id} names a joint absent from the sealed case.`,
        );
      }
      jointAngleSelections.push(`${criterion.jointId}\u0000${
        assertSampleTime(
          source,
          criterion.sampleTimeS,
          `${path}.${criterion.id}.sampleTimeS`,
        )
      }`);
      if (
        criterion.expectedAngleRad < joint.limitRad.minimum ||
        criterion.expectedAngleRad > joint.limitRad.maximum
      ) {
        throw new TypeError(
          `${path}.${criterion.id}.expectedAngleRad exceeds the sealed joint limit.`,
        );
      }
    } else if (
      criterion.kind === "translation-residual" ||
      criterion.kind === "rotation-quaternion-imag-residual"
    ) {
      if (!joints.has(criterion.jointId)) {
        throw new TypeError(
          `${path}.${criterion.id} names a joint absent from the sealed case.`,
        );
      }
      const sampleIndex = assertSampleTime(
        source,
        criterion.sampleTimeS,
        `${path}.${criterion.id}.sampleTimeS`,
      );
      if (criterion.kind === "translation-residual") {
        translationResidualSelections.push(`${criterion.jointId}\u0000${sampleIndex}`);
      } else {
        rotationResidualSelections.push(`${criterion.jointId}\u0000${sampleIndex}`);
      }
    }
  }
  rejectDuplicates(bodyPoseSelections, `${path} body-pose selections`);
  rejectDuplicates(jointAngleSelections, `${path} joint-angle selections`);
  rejectDuplicates(
    translationResidualSelections,
    `${path} translation-residual selections`,
  );
  rejectDuplicates(
    rotationResidualSelections,
    `${path} rotation-quaternion-imag-residual selections`,
  );
}

function assertSampleTime(
  source: PrescribedKinematicsCase["sourceClosure"]["source"],
  timeS: number,
  path: string,
): number {
  const sampleIndex = prescribedKinematicsSampleIndex(source, timeS);
  if (sampleIndex === undefined) {
    throw new TypeError(
      `${path} must identify a case-derived sample tick.`,
    );
  }
  return sampleIndex;
}

function parsePose(value: unknown, path: string): PrescribedKinematicsPose {
  const record = exactRecord(value, ["positionM", "orientationWxyz"], path);
  const positionM = vector3(record.positionM, `${path}.positionM`);
  const orientationWxyz = quaternion(record.orientationWxyz, `${path}.orientationWxyz`);
  return deepFreeze({ positionM, orientationWxyz });
}

function vector3(value: unknown, path: string): readonly [number, number, number] {
  const entries = arrayOf(value, path);
  if (entries.length !== 3) {
    throw new TypeError(`${path} must contain exactly three values.`);
  }
  return deepFreeze([
    finite(entries[0], `${path}[0]`),
    finite(entries[1], `${path}[1]`),
    finite(entries[2], `${path}[2]`),
  ] as [number, number, number]);
}

function quaternion(
  value: unknown,
  path: string,
): readonly [number, number, number, number] {
  const entries = arrayOf(value, path);
  if (entries.length !== 4) {
    throw new TypeError(`${path} must contain exactly four values.`);
  }
  const parsed = [
    finite(entries[0], `${path}[0]`),
    finite(entries[1], `${path}[1]`),
    finite(entries[2], `${path}[2]`),
    finite(entries[3], `${path}[3]`),
  ] as [number, number, number, number];
  if (
    Math.abs(Math.hypot(...parsed) - 1) > PRESCRIBED_KINEMATICS_QUATERNION_NORM_EPSILON
  ) {
    throw new TypeError(`${path} must be a unit quaternion.`);
  }
  return deepFreeze(parsed);
}

function positiveFinite(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) throw new TypeError(`${path} must be positive.`);
  return number;
}

function nonNegativeFinite(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number < 0) throw new TypeError(`${path} must be non-negative.`);
  return number;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(record.algorithm, "sha256", `${path}.algorithm`);
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: record.digest });
}
