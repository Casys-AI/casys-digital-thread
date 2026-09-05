/**
 * Provider-neutral L3 factual observation for prescribed kinematics.
 *
 * The adapter will later normalize a qualified provider response into this
 * shape. This domain module does not know which provider produced it and never
 * turns an observed pose, angle, residual, or convergence fact into a verdict.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
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
  parsePrescribedKinematicsCaseSourceText,
  PRESCRIBED_KINEMATICS_QUATERNION_NORM_EPSILON,
  type PrescribedKinematicsPose,
  prescribedKinematicsRequiredSampleTimes,
  prescribedKinematicsSampleIndex,
} from "./prescribed-kinematics-case-source.ts";
import {
  type PrescribedKinematicsCase,
  validatePrescribedKinematicsCase,
} from "./prescribed-kinematics-source-closure.ts";
import { VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION } from "./operations.ts";

export const PRESCRIBED_KINEMATICS_OBSERVATION_SCHEMA =
  "prescribed-kinematics-observation/1.0" as const;
export const PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_SCHEMA =
  "prescribed-kinematics-observation-method/1.0" as const;
export const PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_ID =
  "prescribed-kinematics-observation" as const;
export const PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_VERSION = "1.0" as const;
/**
 * Derived from V1 source bounds: 512 samples × (16 poses + 15 angles + 15
 * residual rows). The parser admits exactly the source-derived row set.
 */
export const PRESCRIBED_KINEMATICS_MAX_OBSERVATION_FACT_ROWS = 23_552;

export type PrescribedKinematicsFact<T> =
  | { readonly status: "observed"; readonly value: T }
  | {
    readonly status: "unresolved";
    readonly reason: "identity-missing" | "observability-missing";
  }
  | { readonly status: "unavailable"; readonly reason: "unsupported" };

export const PRESCRIBED_KINEMATICS_OBSERVATION_LIMITS = deepFreeze({
  collision: "not_evaluated" as const,
  contact: "not_evaluated" as const,
  clearance: "not_evaluated" as const,
  forces: "not_evaluated" as const,
  strength: "not_evaluated" as const,
  safety: "not_evaluated" as const,
  manufacturability: "not_evaluated" as const,
});

export interface PrescribedKinematicsObservationMethodBody {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_SCHEMA;
  readonly id: typeof PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_ID;
  readonly version: typeof PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_VERSION;
  readonly samples: "case-derived-required-times";
  readonly facts: readonly [
    "poses",
    "joint-angles",
    "joint-translation-residuals",
    "joint-rotation-quaternion-imag-residuals",
    "convergence",
  ];
  readonly limits: typeof PRESCRIBED_KINEMATICS_OBSERVATION_LIMITS;
}

export interface PrescribedKinematicsObservationMethod
  extends PrescribedKinematicsObservationMethodBody {
  readonly fingerprint: ContentFingerprint;
}

const OBSERVATION_METHOD_BODY = deepFreeze<PrescribedKinematicsObservationMethodBody>({
  schemaVersion: PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_SCHEMA,
  id: PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_ID,
  version: PRESCRIBED_KINEMATICS_OBSERVATION_METHOD_VERSION,
  samples: "case-derived-required-times",
  facts: [
    "poses",
    "joint-angles",
    "joint-translation-residuals",
    "joint-rotation-quaternion-imag-residuals",
    "convergence",
  ],
  limits: PRESCRIBED_KINEMATICS_OBSERVATION_LIMITS,
});

export interface PrescribedKinematicsObservationSample {
  readonly timeS: number;
  readonly poses: readonly {
    readonly bodyId: string;
    readonly pose: PrescribedKinematicsFact<PrescribedKinematicsPose>;
  }[];
  readonly jointAngles: readonly {
    readonly jointId: string;
    readonly angleRad: PrescribedKinematicsFact<number>;
  }[];
  /**
   * Per-joint factual residuals preserve two distinct quantities. No scalar
   * residual is inferred, shared between units, or used as a hidden proxy.
   */
  readonly jointResiduals: readonly {
    readonly jointId: string;
    readonly translationResidualM: PrescribedKinematicsFact<
      readonly [number, number, number]
    >;
    /** Dimensionless vector: imaginary components of the quaternion residual. */
    readonly rotationQuaternionImagResidual: PrescribedKinematicsFact<
      readonly [number, number, number]
    >;
  }[];
}

export interface PrescribedKinematicsObservation {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_OBSERVATION_SCHEMA;
  readonly operation: typeof VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION;
  readonly caseFingerprint: ContentFingerprint;
  readonly method: PrescribedKinematicsObservationMethod;
  readonly samples: readonly PrescribedKinematicsObservationSample[];
  readonly convergence: PrescribedKinematicsFact<"converged" | "not-converged">;
  readonly limits: typeof PRESCRIBED_KINEMATICS_OBSERVATION_LIMITS;
}

export async function prescribedKinematicsObservationMethod(): Promise<
  PrescribedKinematicsObservationMethod
> {
  return deepFreeze({
    ...OBSERVATION_METHOD_BODY,
    fingerprint: await sha256Fingerprint(OBSERVATION_METHOD_BODY),
  });
}

export async function validatePrescribedKinematicsObservationMethod(
  value: unknown,
): Promise<PrescribedKinematicsObservationMethod> {
  const root = exactRecord(
    value,
    ["schemaVersion", "id", "version", "samples", "facts", "limits", "fingerprint"],
    "$prescribedKinematicsObservationMethod",
  );
  const expected = await prescribedKinematicsObservationMethod();
  if (deterministicJson(root) !== deterministicJson(expected)) {
    throw new TypeError(
      "$prescribedKinematicsObservationMethod must equal the exact code-owned method.",
    );
  }
  return expected;
}

/**
 * Parse a provider-normalized L3 observation against the exact case produced
 * from one source closure. The adapter must express missing factual values as
 * literal unresolved/unavailable facts, not infer them from names or geometry.
 */
export async function parsePrescribedKinematicsObservation(
  value: unknown,
  sealedCase: PrescribedKinematicsCase,
  path = "$prescribedKinematicsObservation",
): Promise<PrescribedKinematicsObservation> {
  const expectedCase = await validatePrescribedKinematicsCase(sealedCase);
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "caseFingerprint",
      "method",
      "samples",
      "convergence",
      "limits",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_OBSERVATION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.version,
    `${path}.operation.version`,
  );
  const caseFingerprint = parseFingerprint(
    root.caseFingerprint,
    `${path}.caseFingerprint`,
  );
  if (!fingerprintsEqual(caseFingerprint, expectedCase.fingerprint)) {
    throw new TypeError(`${path}.caseFingerprint must equal the exact sealed case.`);
  }
  const method = await validatePrescribedKinematicsObservationMethod(root.method);
  validateLimits(root.limits, `${path}.limits`);
  const source = expectedCase.sourceClosure.source;
  const samples = parseSamples(root.samples, source, `${path}.samples`);
  const convergence = parseFact(
    root.convergence,
    `${path}.convergence`,
    (candidate, candidatePath) => {
      if (candidate !== "converged" && candidate !== "not-converged") {
        throw new TypeError(`${candidatePath} must be converged or not-converged.`);
      }
      return candidate;
    },
  );
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_OBSERVATION_SCHEMA,
    operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    caseFingerprint: expectedCase.fingerprint,
    method,
    samples,
    convergence,
    limits: PRESCRIBED_KINEMATICS_OBSERVATION_LIMITS,
  });
}

export async function fingerprintPrescribedKinematicsObservation(
  observation: PrescribedKinematicsObservation,
  sealedCase: PrescribedKinematicsCase,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    await parsePrescribedKinematicsObservation(observation, sealedCase),
  );
}

function parseSamples(
  value: unknown,
  source: PrescribedKinematicsCaseSourceForObservation,
  path: string,
): readonly PrescribedKinematicsObservationSample[] {
  const requiredTimes = prescribedKinematicsRequiredSampleTimes(source);
  const bodyIds = source.bodies.map((body) => body.bodyId);
  const jointIds = source.joints.map((joint) => joint.jointId);
  const samples = arrayOf(value, path).map((sample, index) => {
    const itemPath = `${path}[${index}]`;
    const record = exactRecord(
      sample,
      ["timeS", "poses", "jointAngles", "jointResiduals"],
      itemPath,
    );
    const suppliedTimeS = finite(record.timeS, `${itemPath}.timeS`);
    const sampleIndex = prescribedKinematicsSampleIndex(source, suppliedTimeS);
    if (sampleIndex !== index) {
      throw new TypeError(
        `${itemPath}.timeS must identify the ordered case-derived sample tick.`,
      );
    }
    const poses = parsePoses(record.poses, bodyIds, `${itemPath}.poses`);
    const jointAngles = parseJointAngles(
      record.jointAngles,
      jointIds,
      `${itemPath}.jointAngles`,
    );
    const jointResiduals = parseJointResiduals(
      record.jointResiduals,
      jointIds,
      `${itemPath}.jointResiduals`,
    );
    return deepFreeze({
      timeS: requiredTimes[index]!,
      poses,
      jointAngles,
      jointResiduals,
    });
  });
  if (samples.length !== requiredTimes.length) {
    throw new TypeError(`${path} must cover every exact case-derived sample time.`);
  }
  return deepFreeze(samples);
}

type PrescribedKinematicsCaseSourceForObservation = Awaited<
  ReturnType<typeof parsePrescribedKinematicsCaseSourceText>
>;

function parsePoses(
  value: unknown,
  bodyIds: readonly string[],
  path: string,
): PrescribedKinematicsObservationSample["poses"] {
  const rows = arrayOf(value, path).map((entry, index) => {
    const rowPath = `${path}[${index}]`;
    const record = exactRecord(entry, ["bodyId", "pose"], rowPath);
    return deepFreeze({
      bodyId: safeId(record.bodyId, `${rowPath}.bodyId`),
      pose: parseFact(record.pose, `${rowPath}.pose`, parsePose),
    });
  });
  assertExactIds(rows.map((row) => row.bodyId), bodyIds, path);
  return deepFreeze(rows);
}

function parseJointAngles(
  value: unknown,
  jointIds: readonly string[],
  path: string,
): PrescribedKinematicsObservationSample["jointAngles"] {
  const rows = arrayOf(value, path).map((entry, index) => {
    const rowPath = `${path}[${index}]`;
    const record = exactRecord(entry, ["jointId", "angleRad"], rowPath);
    return deepFreeze({
      jointId: safeId(record.jointId, `${rowPath}.jointId`),
      angleRad: parseFact(record.angleRad, `${rowPath}.angleRad`, finite),
    });
  });
  assertExactIds(rows.map((row) => row.jointId), jointIds, path);
  return deepFreeze(rows);
}

function parseJointResiduals(
  value: unknown,
  jointIds: readonly string[],
  path: string,
): PrescribedKinematicsObservationSample["jointResiduals"] {
  const rows = arrayOf(value, path).map((entry, index) => {
    const rowPath = `${path}[${index}]`;
    const record = exactRecord(
      entry,
      ["jointId", "translationResidualM", "rotationQuaternionImagResidual"],
      rowPath,
    );
    return deepFreeze({
      jointId: safeId(record.jointId, `${rowPath}.jointId`),
      translationResidualM: parseFact(
        record.translationResidualM,
        `${rowPath}.translationResidualM`,
        vector3,
      ),
      rotationQuaternionImagResidual: parseFact(
        record.rotationQuaternionImagResidual,
        `${rowPath}.rotationQuaternionImagResidual`,
        vector3,
      ),
    });
  });
  assertExactIds(rows.map((row) => row.jointId), jointIds, path);
  return deepFreeze(rows);
}

function parseFact<T>(
  value: unknown,
  path: string,
  parseValue: (value: unknown, path: string) => T,
): PrescribedKinematicsFact<T> {
  const statusRecord = exactRecord(value, ["status", ...factTailKeys(value)], path);
  if (statusRecord.status === "observed") {
    const record = exactRecord(value, ["status", "value"], path);
    return deepFreeze({
      status: "observed",
      value: parseValue(record.value, `${path}.value`),
    });
  }
  if (statusRecord.status === "unresolved") {
    const record = exactRecord(value, ["status", "reason"], path);
    if (
      record.reason !== "identity-missing" && record.reason !== "observability-missing"
    ) {
      throw new TypeError(`${path}.reason is unsupported.`);
    }
    return deepFreeze({ status: "unresolved", reason: record.reason });
  }
  if (statusRecord.status === "unavailable") {
    const record = exactRecord(value, ["status", "reason"], path);
    literalValue(record.reason, "unsupported", `${path}.reason`);
    return deepFreeze({ status: "unavailable", reason: "unsupported" });
  }
  throw new TypeError(`${path}.status is unsupported.`);
}

function factTailKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const status = (value as Record<string, unknown>).status;
  return status === "observed"
    ? ["value"]
    : status === "unresolved" || status === "unavailable"
    ? ["reason"]
    : [];
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

function validateLimits(value: unknown, path: string): void {
  if (
    deterministicJson(value) !==
      deterministicJson(PRESCRIBED_KINEMATICS_OBSERVATION_LIMITS)
  ) {
    throw new TypeError(
      `${path} must equal the literal prescribed-kinematics coverage limits.`,
    );
  }
}

function assertExactIds(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  rejectDuplicates(actual, `${path} ids`);
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  ) {
    throw new TypeError(
      `${path} must cover the exact case-derived identities in canonical order.`,
    );
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(record.algorithm, "sha256", `${path}.algorithm`);
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: record.digest });
}
