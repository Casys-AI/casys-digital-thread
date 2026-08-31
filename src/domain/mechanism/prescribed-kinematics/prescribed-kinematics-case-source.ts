/**
 * Closed project-authored source for the first prescribed-kinematics surface.
 *
 * The source is deliberately exact JSON held as one ProjectSourceWorkspace
 * text resource. It declares bodies, PartUsage mappings, frames, axes, joint
 * limits, linear ramps, zero poses, SI units, duration, and a sample schedule.
 * It cannot name an engine, provider, endpoint, tool, image, runtime, mass,
 * contact model, clearance, force, or strength calculation.
 */

import {
  parseProductStructureElementRef,
  type ProductStructureElementRef,
} from "../../architecture/product-structure-ref.ts";
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
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const PRESCRIBED_KINEMATICS_CASE_SOURCE_SCHEMA =
  "prescribed-kinematics-case-source/1.0" as const;
export const PRESCRIBED_KINEMATICS_CASE_SOURCE_MAX_BYTES = 262_144;
/** One V1 file is deliberately a bounded immediate subassembly. */
export const PRESCRIBED_KINEMATICS_MAX_BODIES = 16;
export const PRESCRIBED_KINEMATICS_MAX_JOINTS = PRESCRIBED_KINEMATICS_MAX_BODIES - 1;
export const PRESCRIBED_KINEMATICS_MAX_DURATION_S = 10;
/** Includes t=0 and duration. */
export const PRESCRIBED_KINEMATICS_MAX_SAMPLE_INSTANTS = 512;
export const PRESCRIBED_KINEMATICS_MAX_SAMPLE_INTERVALS =
  PRESCRIBED_KINEMATICS_MAX_SAMPLE_INSTANTS - 1;
/** Numeric admission tolerance used only to map decimal JSON time to its tick. */
export const PRESCRIBED_KINEMATICS_SAMPLE_TIME_EPSILON = 1e-12;
export const PRESCRIBED_KINEMATICS_UNITS = Object.freeze(
  {
    length: "m",
    angle: "rad",
    time: "s",
  } as const,
);
export const PRESCRIBED_KINEMATICS_QUATERNION_NORM_EPSILON = 1e-12;
export const PRESCRIBED_KINEMATICS_AXIS_NORM_EPSILON = 1e-12;

export interface PrescribedKinematicsPose {
  /** Absolute pose in the one right-handed world frame at time zero. */
  readonly positionM: readonly [number, number, number];
  /** Unit quaternion in W, X, Y, Z order. */
  readonly orientationWxyz: readonly [number, number, number, number];
}

export interface PrescribedKinematicsFrame extends PrescribedKinematicsPose {
  /** Axis in this frame's local coordinates; V1 Chrono lowering retains only +Z. */
  readonly axis: readonly [number, number, number];
}

/** Exact SysML assembly context; never a Chrono, runtime, or provider identity. */
export type PrescribedKinematicsAssemblyContext = ProductStructureElementRef;

export interface PrescribedKinematicsBody {
  readonly bodyId: string;
  /** Exact SysML PartUsage element identity; never a label or a STEP name. */
  readonly partUsageElementId: string;
  /** Absolute centre-of-mass/reference pose at time zero; no mass is asserted. */
  readonly zeroPose: PrescribedKinematicsPose;
}

export interface PrescribedKinematicsRevoluteJoint {
  readonly jointId: string;
  readonly kind: "revolute";
  readonly parentBodyId: string;
  readonly childBodyId: string;
  readonly parentFrame: PrescribedKinematicsFrame;
  readonly childFrame: PrescribedKinematicsFrame;
  readonly limitRad: {
    readonly minimum: number;
    readonly maximum: number;
  };
  /** The V1 scenario has one explicit linear ramp over the full duration. */
  readonly ramp: {
    readonly kind: "linear";
    readonly startTimeS: 0;
    readonly endTimeS: number;
    readonly initialAngleRad: number;
    readonly finalAngleRad: number;
  };
}

export interface PrescribedKinematicsCaseSource {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_CASE_SOURCE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
  };
  /**
   * Exact assembly context: a reusable PartDefinition or an occurrence-specific
   * PartUsage. Distinct from every body PartUsage mapping.
   */
  readonly assembly: PrescribedKinematicsAssemblyContext;
  readonly units: typeof PRESCRIBED_KINEMATICS_UNITS;
  readonly durationS: number;
  readonly groundBodyId: string;
  /** Exact bijection: one bodyId for one PartUsage and conversely. */
  readonly bodies: readonly PrescribedKinematicsBody[];
  /** V1 accepts a connected, immediate, revolute-joint tree only. */
  readonly joints: readonly PrescribedKinematicsRevoluteJoint[];
  /** Explicit factual sample schedule. L4 criteria belong to a later method sheet. */
  readonly sampling: {
    readonly timeStepS: number;
  };
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "assembly",
  "units",
  "durationS",
  "groundBodyId",
  "bodies",
  "joints",
  "sampling",
] as const;

/** These cannot be smuggled into the agent-authored source. */
const FORBIDDEN_ROOT_KEYS = [
  "provider",
  "tool",
  "endpoint",
  "args",
  "image",
  "runtime",
  "profile",
  "solver",
  "mass",
  "inertia",
  "force",
  "contact",
  "collision",
  "clearance",
  "strength",
  "safety",
  "manufacturability",
  "fingerprint",
  "authorization",
  "baseThreadSnapshot",
] as const;

export function validatePrescribedKinematicsCaseSource(
  value: unknown,
  path = "$prescribedKinematicsCaseSource",
): PrescribedKinematicsCaseSource {
  rejectForbiddenRootKeys(value, path);
  const root = exactRecord(value, ROOT_KEYS, path);
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_CASE_SOURCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const project = exactRecord(root.project, ["id", "subjectId"], `${path}.project`);
  validateUnits(root.units, `${path}.units`);
  const durationS = positiveFinite(root.durationS, `${path}.durationS`);
  if (durationS > PRESCRIBED_KINEMATICS_MAX_DURATION_S) {
    throw new TypeError(
      `${path}.durationS exceeds the V1 maximum of ${PRESCRIBED_KINEMATICS_MAX_DURATION_S} seconds per mechanism source.`,
    );
  }
  const bodies = parseBodies(root.bodies, `${path}.bodies`);
  const assembly = parseAssembly(root.assembly, `${path}.assembly`, bodies);
  const groundBodyId = safeId(root.groundBodyId, `${path}.groundBodyId`);
  if (!bodies.some((body) => body.bodyId === groundBodyId)) {
    throw new TypeError(`${path}.groundBodyId must name one declared body.`);
  }
  const joints = parseJoints(root.joints, durationS, bodies, `${path}.joints`);
  assertImmediateConnectedTree(bodies, joints, groundBodyId, `${path}.joints`);
  const sampling = parseSampling(root.sampling, durationS, `${path}.sampling`);
  return deepFreeze({
    schemaVersion: PRESCRIBED_KINEMATICS_CASE_SOURCE_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    scope: nonEmptyText(root.scope, `${path}.scope`),
    evidenceBoundary: nonEmptyText(root.evidenceBoundary, `${path}.evidenceBoundary`),
    project: {
      id: safeId(project.id, `${path}.project.id`),
      subjectId: safeId(project.subjectId, `${path}.project.subjectId`),
    },
    assembly,
    units: PRESCRIBED_KINEMATICS_UNITS,
    durationS,
    groundBodyId,
    bodies,
    joints,
    sampling,
  });
}

/** Canonical JSON for the exact resource bytes that enter ProjectSourceWorkspace. */
export function canonicalPrescribedKinematicsCaseSourceText(
  source: PrescribedKinematicsCaseSource,
): string {
  return deterministicJson(validatePrescribedKinematicsCaseSource(source));
}

export function canonicalizePrescribedKinematicsCaseSource(
  value: unknown,
  path = "$prescribedKinematicsCaseSource",
): { readonly source: PrescribedKinematicsCaseSource; readonly text: string } {
  const source = validatePrescribedKinematicsCaseSource(value, path);
  const text = deterministicJson(source);
  const replay = validatePrescribedKinematicsCaseSource(JSON.parse(text), path);
  if (deterministicJson(replay) !== text) {
    throw new TypeError(`${path} is not canonical after exact replay.`);
  }
  return deepFreeze({ source: replay, text });
}

/**
 * Reopen exact resource bytes. Pretty-printed or otherwise noncanonical JSON
 * must be normalized before capture; this prevents two byte representations of
 * one sealed kinematic input.
 */
export function parsePrescribedKinematicsCaseSourceText(
  text: string,
  path = "$prescribedKinematicsCaseSourceText",
): PrescribedKinematicsCaseSource {
  if (typeof text !== "string") {
    throw new TypeError(`${path} must be UTF-8 text.`);
  }
  if (
    new TextEncoder().encode(text).byteLength >
      PRESCRIBED_KINEMATICS_CASE_SOURCE_MAX_BYTES
  ) {
    throw new TypeError(`${path} exceeds the source byte ceiling.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${path} is not valid JSON.`);
  }
  const source = validatePrescribedKinematicsCaseSource(parsed, path);
  if (deterministicJson(source) !== text) {
    throw new TypeError(`${path} must equal canonical JSON exactly.`);
  }
  return source;
}

export function fingerprintPrescribedKinematicsCaseSource(
  source: PrescribedKinematicsCaseSource,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validatePrescribedKinematicsCaseSource(source));
}

/** Required factual sampling points for any admitted L3 observation. */
export function prescribedKinematicsRequiredSampleTimes(
  source: PrescribedKinematicsCaseSource,
): readonly number[] {
  const validated = validatePrescribedKinematicsCaseSource(source);
  const stepCount = sampleStepCount(
    validated.durationS,
    validated.sampling.timeStepS,
    "$prescribedKinematicsCaseSource.sampling",
  );
  return deepFreeze(
    Array.from(
      { length: stepCount + 1 },
      (_, index) =>
        index === stepCount
          ? validated.durationS
          : index * validated.sampling.timeStepS,
    ),
  );
}

/**
 * Resolve a decimal JSON time to one exact case-derived sample tick. This is
 * the only time-identity boundary: callers must never compare raw floats.
 */
export function prescribedKinematicsSampleIndex(
  source: PrescribedKinematicsCaseSource,
  timeS: number,
): number | undefined {
  const validated = validatePrescribedKinematicsCaseSource(source);
  if (!Number.isFinite(timeS)) return undefined;
  const stepCount = sampleStepCount(
    validated.durationS,
    validated.sampling.timeStepS,
    "$prescribedKinematicsCaseSource.sampling",
  );
  const index = Math.round(timeS / validated.sampling.timeStepS);
  if (index < 0 || index > stepCount) return undefined;
  const canonicalTime = index === stepCount
    ? validated.durationS
    : index * validated.sampling.timeStepS;
  const tolerance = PRESCRIBED_KINEMATICS_SAMPLE_TIME_EPSILON * Math.max(
    Math.abs(validated.sampling.timeStepS),
    Math.abs(canonicalTime),
    Math.abs(timeS),
  );
  return Math.abs(timeS - canonicalTime) <= tolerance ? index : undefined;
}

function rejectForbiddenRootKeys(value: unknown, path: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of FORBIDDEN_ROOT_KEYS) {
    if (Object.hasOwn(value, key)) {
      throw new TypeError(`${path} has unsupported field ${key}.`);
    }
  }
}

function parseAssembly(
  value: unknown,
  path: string,
  bodies: readonly PrescribedKinematicsBody[],
): PrescribedKinematicsAssemblyContext {
  const assembly = parseProductStructureElementRef(value, path);
  if (bodies.some((body) => body.partUsageElementId === assembly.elementId)) {
    throw new TypeError(
      `${path} must be distinct from every body PartUsage.`,
    );
  }
  return deepFreeze({
    elementId: assembly.elementId,
    elementKind: assembly.elementKind,
  });
}

function validateUnits(value: unknown, path: string): void {
  const units = exactRecord(value, ["length", "angle", "time"], path);
  literalValue(units.length, "m", `${path}.length`);
  literalValue(units.angle, "rad", `${path}.angle`);
  literalValue(units.time, "s", `${path}.time`);
}

function parseBodies(
  value: unknown,
  path: string,
): readonly PrescribedKinematicsBody[] {
  const bodies = arrayOf(value, path).map((body, index) => {
    const record = exactRecord(
      body,
      ["bodyId", "partUsageElementId", "zeroPose"],
      `${path}[${index}]`,
    );
    return deepFreeze({
      bodyId: safeId(record.bodyId, `${path}[${index}].bodyId`),
      partUsageElementId: safeId(
        record.partUsageElementId,
        `${path}[${index}].partUsageElementId`,
      ),
      zeroPose: parsePose(record.zeroPose, `${path}[${index}].zeroPose`),
    });
  });
  if (bodies.length < 2) {
    throw new TypeError(`${path} must declare at least two bodies.`);
  }
  if (bodies.length > PRESCRIBED_KINEMATICS_MAX_BODIES) {
    throw new TypeError(
      `${path} exceeds the V1 maximum of ${PRESCRIBED_KINEMATICS_MAX_BODIES} bodies per mechanism source.`,
    );
  }
  rejectDuplicates(bodies.map((body) => body.bodyId), `${path}.bodyId`);
  rejectDuplicates(
    bodies.map((body) => body.partUsageElementId),
    `${path}.partUsageElementId`,
  );
  return deepFreeze(
    [...bodies].sort((left, right) => left.bodyId.localeCompare(right.bodyId)),
  );
}

function parseJoints(
  value: unknown,
  durationS: number,
  bodies: readonly PrescribedKinematicsBody[],
  path: string,
): readonly PrescribedKinematicsRevoluteJoint[] {
  const bodyIds = new Set(bodies.map((body) => body.bodyId));
  const joints = arrayOf(value, path).map((joint, index) => {
    const itemPath = `${path}[${index}]`;
    const record = exactRecord(
      joint,
      [
        "jointId",
        "kind",
        "parentBodyId",
        "childBodyId",
        "parentFrame",
        "childFrame",
        "limitRad",
        "ramp",
      ],
      itemPath,
    );
    literalValue(record.kind, "revolute", `${itemPath}.kind`);
    const parentBodyId = safeId(record.parentBodyId, `${itemPath}.parentBodyId`);
    const childBodyId = safeId(record.childBodyId, `${itemPath}.childBodyId`);
    if (!bodyIds.has(parentBodyId) || !bodyIds.has(childBodyId)) {
      throw new TypeError(`${itemPath} must name declared parent and child bodies.`);
    }
    if (parentBodyId === childBodyId) {
      throw new TypeError(`${itemPath} must join two distinct bodies.`);
    }
    const limitRad = parseLimit(record.limitRad, `${itemPath}.limitRad`);
    const ramp = parseRamp(record.ramp, durationS, limitRad, `${itemPath}.ramp`);
    return deepFreeze({
      jointId: safeId(record.jointId, `${itemPath}.jointId`),
      kind: "revolute" as const,
      parentBodyId,
      childBodyId,
      parentFrame: parseFrame(record.parentFrame, `${itemPath}.parentFrame`),
      childFrame: parseFrame(record.childFrame, `${itemPath}.childFrame`),
      limitRad,
      ramp,
    });
  });
  if (joints.length === 0) {
    throw new TypeError(`${path} must declare at least one revolute joint.`);
  }
  if (joints.length > PRESCRIBED_KINEMATICS_MAX_JOINTS) {
    throw new TypeError(
      `${path} exceeds the V1 maximum of ${PRESCRIBED_KINEMATICS_MAX_JOINTS} joints per mechanism source.`,
    );
  }
  rejectDuplicates(joints.map((joint) => joint.jointId), `${path}.jointId`);
  rejectDuplicates(
    joints.map((joint) =>
      [joint.parentBodyId, joint.childBodyId].sort().join("\u0000")
    ),
    `${path} body pairs`,
  );
  return deepFreeze(
    [...joints].sort((left, right) => left.jointId.localeCompare(right.jointId)),
  );
}

function assertImmediateConnectedTree(
  bodies: readonly PrescribedKinematicsBody[],
  joints: readonly PrescribedKinematicsRevoluteJoint[],
  groundBodyId: string,
  path: string,
): void {
  if (joints.length !== bodies.length - 1) {
    throw new TypeError(
      `${path} must form one immediate tree with bodyCount - 1 joints.`,
    );
  }
  const neighbours = new Map<string, string[]>();
  for (const body of bodies) neighbours.set(body.bodyId, []);
  for (const joint of joints) {
    neighbours.get(joint.parentBodyId)!.push(joint.childBodyId);
    neighbours.get(joint.childBodyId)!.push(joint.parentBodyId);
  }
  const visited = new Set<string>();
  const pending = [groundBodyId];
  while (pending.length > 0) {
    const bodyId = pending.pop()!;
    if (visited.has(bodyId)) continue;
    visited.add(bodyId);
    pending.push(...neighbours.get(bodyId)!);
  }
  if (visited.size !== bodies.length) {
    throw new TypeError(`${path} must connect every body to the declared ground body.`);
  }
}

function parseSampling(
  value: unknown,
  durationS: number,
  path: string,
): PrescribedKinematicsCaseSource["sampling"] {
  const record = exactRecord(value, ["timeStepS"], path);
  const timeStepS = positiveFinite(record.timeStepS, `${path}.timeStepS`);
  sampleStepCount(durationS, timeStepS, path);
  return deepFreeze({ timeStepS });
}

function parseLimit(
  value: unknown,
  path: string,
): PrescribedKinematicsRevoluteJoint["limitRad"] {
  const record = exactRecord(value, ["minimum", "maximum"], path);
  const minimum = finite(record.minimum, `${path}.minimum`);
  const maximum = finite(record.maximum, `${path}.maximum`);
  if (minimum >= maximum) {
    throw new TypeError(`${path}.minimum must be less than maximum.`);
  }
  return deepFreeze({ minimum, maximum });
}

function parseRamp(
  value: unknown,
  durationS: number,
  limitRad: PrescribedKinematicsRevoluteJoint["limitRad"],
  path: string,
): PrescribedKinematicsRevoluteJoint["ramp"] {
  const record = exactRecord(
    value,
    ["kind", "startTimeS", "endTimeS", "initialAngleRad", "finalAngleRad"],
    path,
  );
  literalValue(record.kind, "linear", `${path}.kind`);
  literalValue(record.startTimeS, 0, `${path}.startTimeS`);
  literalValue(record.endTimeS, durationS, `${path}.endTimeS`);
  const initialAngleRad = finite(record.initialAngleRad, `${path}.initialAngleRad`);
  const finalAngleRad = finite(record.finalAngleRad, `${path}.finalAngleRad`);
  assertInsideLimit(initialAngleRad, limitRad, `${path}.initialAngleRad`);
  assertInsideLimit(finalAngleRad, limitRad, `${path}.finalAngleRad`);
  return deepFreeze({
    kind: "linear",
    startTimeS: 0,
    endTimeS: durationS,
    initialAngleRad,
    finalAngleRad,
  });
}

function parsePose(value: unknown, path: string): PrescribedKinematicsPose {
  const record = exactRecord(value, ["positionM", "orientationWxyz"], path);
  return deepFreeze({
    positionM: parseVector3(record.positionM, `${path}.positionM`),
    orientationWxyz: parseQuaternion(record.orientationWxyz, `${path}.orientationWxyz`),
  });
}

function parseFrame(value: unknown, path: string): PrescribedKinematicsFrame {
  const record = exactRecord(value, ["positionM", "orientationWxyz", "axis"], path);
  return deepFreeze({
    positionM: parseVector3(record.positionM, `${path}.positionM`),
    orientationWxyz: parseQuaternion(record.orientationWxyz, `${path}.orientationWxyz`),
    axis: parseUnitVector3(record.axis, `${path}.axis`),
  });
}

function parseVector3(value: unknown, path: string): readonly [number, number, number] {
  const items = arrayOf(value, path);
  if (items.length !== 3) {
    throw new TypeError(`${path} must contain exactly three values.`);
  }
  return deepFreeze([
    finite(items[0], `${path}[0]`),
    finite(items[1], `${path}[1]`),
    finite(items[2], `${path}[2]`),
  ] as [number, number, number]);
}

function parseQuaternion(
  value: unknown,
  path: string,
): readonly [number, number, number, number] {
  const items = arrayOf(value, path);
  if (items.length !== 4) {
    throw new TypeError(`${path} must contain exactly four values.`);
  }
  const quaternion = [
    finite(items[0], `${path}[0]`),
    finite(items[1], `${path}[1]`),
    finite(items[2], `${path}[2]`),
    finite(items[3], `${path}[3]`),
  ] as [number, number, number, number];
  const norm = Math.hypot(...quaternion);
  if (Math.abs(norm - 1) > PRESCRIBED_KINEMATICS_QUATERNION_NORM_EPSILON) {
    throw new TypeError(`${path} must be a unit quaternion.`);
  }
  return deepFreeze(quaternion);
}

function parseUnitVector3(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  const vector = parseVector3(value, path);
  const norm = Math.hypot(...vector);
  if (Math.abs(norm - 1) > PRESCRIBED_KINEMATICS_AXIS_NORM_EPSILON) {
    throw new TypeError(`${path} must be a unit vector.`);
  }
  return vector;
}

function positiveFinite(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) throw new TypeError(`${path} must be positive.`);
  return number;
}

function sampleStepCount(durationS: number, timeStepS: number, path: string): number {
  const candidate = durationS / timeStepS;
  const rounded = Math.round(candidate);
  if (
    rounded < 1 ||
    rounded > PRESCRIBED_KINEMATICS_MAX_SAMPLE_INTERVALS ||
    Math.abs(candidate - rounded) >
      PRESCRIBED_KINEMATICS_SAMPLE_TIME_EPSILON * Math.max(1, Math.abs(candidate))
  ) {
    throw new TypeError(
      `${path}.timeStepS must divide durationS into 1..${PRESCRIBED_KINEMATICS_MAX_SAMPLE_INTERVALS} exact sample intervals.`,
    );
  }
  return rounded;
}

function assertInsideLimit(
  value: number,
  limit: PrescribedKinematicsRevoluteJoint["limitRad"],
  path: string,
): void {
  if (value < limit.minimum || value > limit.maximum) {
    throw new TypeError(`${path} must remain inside the declared joint limit.`);
  }
}
