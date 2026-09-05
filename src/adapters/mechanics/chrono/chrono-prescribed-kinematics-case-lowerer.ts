/** Fixed mcp-chrono 0.3.2 lowering for the prescribed-kinematics binding. */

import type {
  PrescribedKinematicsCaseLowerer,
  PrescribedKinematicsLoweredCase,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-case-lowerer.ts";
import {
  canonicalPrescribedKinematicsCaseSourceText,
  fingerprintPrescribedKinematicsCaseSource,
  type PrescribedKinematicsCaseSource,
  type PrescribedKinematicsFrame,
  type PrescribedKinematicsPose,
  validatePrescribedKinematicsCaseSource,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

const CHRONO_CASE_SCHEMA = "chrono-prescribed-kinematics-case/1.0" as const;
const LOWERING_SCHEMA = "chrono-prescribed-kinematics-lowering/1.0" as const;
const CHRONO_BINDING = {
  unitId: "casys.mcp-chrono",
  adapterVersion: "0.3.2",
} as const;
const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PROVIDER_MAX_ABS = 1_000_000;
const PROVIDER_MAX_DURATION_S = 10;
const PROVIDER_MAX_STEP_RATIO = 10_000;
const PROVIDER_MAX_STORED_SAMPLES = 512;
const PROVIDER_MAX_CASE_BYTES = 512 * 1024;

interface ChronoPose {
  readonly position_m: readonly [number, number, number];
  readonly rotation_wxyz: readonly [number, number, number, number];
}

interface ChronoPrescribedKinematicsCase {
  readonly schema_id: typeof CHRONO_CASE_SCHEMA;
  readonly units: { readonly length: "m"; readonly angle: "rad"; readonly time: "s" };
  readonly frame: { readonly handedness: "right" };
  readonly bodies: readonly {
    readonly id: string;
    readonly fixed: boolean;
    readonly absolute_com_pose: ChronoPose;
  }[];
  readonly joints: readonly {
    readonly id: string;
    readonly parent_body: string;
    readonly child_body: string;
    readonly absolute_joint_frame: ChronoPose;
    readonly angle_ramp: {
      readonly initial_angle_rad: number;
      readonly angular_speed_rad_s: number;
    };
    readonly limits_rad: readonly [number, number];
  }[];
  readonly duration_s: number;
  readonly step_s: number;
  readonly sample_every_steps: 1;
}

export class ChronoPrescribedKinematicsLoweringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChronoPrescribedKinematicsLoweringError";
  }
}

/**
 * The lowering identity names the concrete installed Chrono material and the
 * adapter contract that produced its wire request. A lifecycle recross can
 * therefore rederive a historical fingerprint from sealed runtime provenance
 * without enrolling that historical runtime as the active one.
 */
export interface ChronoPrescribedKinematicsLoweringBinding {
  readonly unitId: string;
  readonly adapterVersion: string;
}

export function fingerprintChronoPrescribedKinematicsLowering(input: {
  readonly sourceFingerprint: ContentFingerprint;
  readonly binding: ChronoPrescribedKinematicsLoweringBinding;
}): Promise<ContentFingerprint> {
  return sha256Fingerprint({
    schemaVersion: LOWERING_SCHEMA,
    sourceFingerprint: input.sourceFingerprint,
    binding: `${input.binding.unitId}@${input.binding.adapterVersion}`,
    targetSchema: CHRONO_CASE_SCHEMA,
    mapping: "absolute-zero-angle-revolute-z-ramp-v1",
  });
}

/**
 * The source remains the engineering authority. This adapter merely lowers its
 * exact, already-validated global zero-angle poses to Chrono's closed wire
 * case. It rejects every relationship that cannot be represented by one
 * absolute +Z revolute motor frame rather than manufacturing a frame.
 */
export class ChronoPrescribedKinematicsCaseLowerer
  implements PrescribedKinematicsCaseLowerer {
  async lower(input: {
    readonly source: PrescribedKinematicsCaseSource;
    readonly sourceFingerprint: ContentFingerprint;
  }): Promise<PrescribedKinematicsLoweredCase> {
    const source = validatePrescribedKinematicsCaseSource(input.source);
    const sourceFingerprint = await fingerprintPrescribedKinematicsCaseSource(source);
    if (!fingerprintsEqual(sourceFingerprint, input.sourceFingerprint)) {
      throw new ChronoPrescribedKinematicsLoweringError(
        "The prescribed-kinematics source fingerprint does not bind the exact source reopened for lowering.",
      );
    }
    const sourceText = canonicalPrescribedKinematicsCaseSourceText(source);
    const sourceTextDigest = await sha256Hex(new TextEncoder().encode(sourceText));
    if (sourceTextDigest !== sourceFingerprint.digest) {
      throw new ChronoPrescribedKinematicsLoweringError(
        "The prescribed-kinematics source canonical bytes do not match their sealed fingerprint.",
      );
    }

    const request = lowerChronoCase(source);
    const exactRequestText = deterministicJson(request);
    if (
      new TextEncoder().encode(exactRequestText).byteLength > PROVIDER_MAX_CASE_BYTES
    ) {
      throw unsupported(
        "The exact lowered Chrono case exceeds its 512 KiB provider boundary.",
      );
    }
    const requestFingerprint: ContentFingerprint = Object.freeze({
      algorithm: "sha256",
      digest: await sha256Hex(new TextEncoder().encode(exactRequestText)),
    });
    const loweringFingerprint = await fingerprintChronoPrescribedKinematicsLowering({
      sourceFingerprint,
      binding: CHRONO_BINDING,
    });
    return Object.freeze({
      sourceFingerprint,
      loweringFingerprint,
      requestFingerprint,
      exactRequestText,
    });
  }
}

export function lowerChronoCase(
  sourceValue: PrescribedKinematicsCaseSource,
): ChronoPrescribedKinematicsCase {
  const source = validatePrescribedKinematicsCaseSource(sourceValue);
  const bodyIds = new Set<string>();
  const bodies = source.bodies.map((body) => {
    assertProviderId(body.bodyId, `body ${body.bodyId}`);
    if (bodyIds.has(body.bodyId)) {
      throw unsupported(`Body ${body.bodyId} is duplicated.`);
    }
    bodyIds.add(body.bodyId);
    return Object.freeze({
      id: body.bodyId,
      fixed: body.bodyId === source.groundBodyId,
      absolute_com_pose: pose(body.zeroPose),
    });
  });
  const fixedCount = bodies.filter((body) => body.fixed).length;
  if (fixedCount !== 1) {
    throw unsupported(
      "Exactly the source groundBodyId must lower to the one fixed Chrono body.",
    );
  }

  const jointIds = new Set<string>();
  const children = new Set<string>();
  const joints = source.joints.map((joint) => {
    assertProviderId(joint.jointId, `joint ${joint.jointId}`);
    if (jointIds.has(joint.jointId)) {
      throw unsupported(`Joint ${joint.jointId} is duplicated.`);
    }
    jointIds.add(joint.jointId);
    if (!bodyIds.has(joint.parentBodyId) || !bodyIds.has(joint.childBodyId)) {
      throw unsupported(
        `Joint ${joint.jointId} references a body outside the exact source.`,
      );
    }
    if (joint.childBodyId === source.groundBodyId || children.has(joint.childBodyId)) {
      throw unsupported(
        `Joint ${joint.jointId} cannot lower to Chrono's single-parent rooted tree topology.`,
      );
    }
    children.add(joint.childBodyId);
    const absoluteJointFrame = representableAbsoluteJointFrame(
      joint.parentFrame,
      joint.childFrame,
      joint.jointId,
    );
    if (
      joint.ramp.kind !== "linear" || joint.ramp.startTimeS !== 0 ||
      joint.ramp.endTimeS !== source.durationS
    ) {
      throw unsupported(
        `Joint ${joint.jointId} has no exact full-duration linear ramp representable by Chrono 0.3.2.`,
      );
    }
    return Object.freeze({
      id: joint.jointId,
      parent_body: joint.parentBodyId,
      child_body: joint.childBodyId,
      absolute_joint_frame: absoluteJointFrame,
      angle_ramp: Object.freeze({
        initial_angle_rad: joint.ramp.initialAngleRad,
        angular_speed_rad_s: (joint.ramp.finalAngleRad - joint.ramp.initialAngleRad) /
          source.durationS,
      }),
      limits_rad: Object.freeze(
        [joint.limitRad.minimum, joint.limitRad.maximum] as const,
      ),
    });
  });
  if (joints.length !== bodies.length - 1 || children.size !== bodies.length - 1) {
    throw unsupported(
      "The exact source topology is not one Chrono rooted revolute tree.",
    );
  }

  const result = Object.freeze({
    schema_id: CHRONO_CASE_SCHEMA,
    units: Object.freeze({ length: "m", angle: "rad", time: "s" }),
    frame: Object.freeze({ handedness: "right" }),
    bodies: Object.freeze(bodies),
    joints: Object.freeze(joints),
    duration_s: source.durationS,
    step_s: source.sampling.timeStepS,
    sample_every_steps: 1,
  });
  assertChronoProviderBounds(result);
  return result;
}

function representableAbsoluteJointFrame(
  parent: PrescribedKinematicsFrame,
  child: PrescribedKinematicsFrame,
  jointId: string,
): ChronoPose {
  if (!samePose(parent, child)) {
    throw unsupported(
      `Joint ${jointId} has distinct parent and child frames; Chrono requires one exact absolute zero-angle joint frame.`,
    );
  }
  if (!sameVector(parent.axis, child.axis)) {
    throw unsupported(
      `Joint ${jointId} has distinct parent and child axes; Chrono requires one local +Z axis.`,
    );
  }
  if (!sameVector(parent.axis, [0, 0, 1])) {
    throw unsupported(
      `Joint ${jointId} axis is not the literal local +Z; its absolute Chrono frame would be ambiguous.`,
    );
  }
  return pose(parent);
}

function pose(value: PrescribedKinematicsPose): ChronoPose {
  return Object.freeze({
    position_m: Object.freeze([...value.positionM] as [number, number, number]),
    rotation_wxyz: Object.freeze([
      ...value.orientationWxyz,
    ] as [number, number, number, number]),
  });
}

function samePose(
  left: PrescribedKinematicsPose,
  right: PrescribedKinematicsPose,
): boolean {
  return sameVector(left.positionM, right.positionM) &&
    left.orientationWxyz.every((value, index) =>
      value === right.orientationWxyz[index]!
    );
}

function sameVector(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): boolean {
  return left.every((value, index) => value === right[index]!);
}

function assertProviderId(value: string, label: string): void {
  if (!PROVIDER_ID.test(value)) {
    throw unsupported(`${label} is outside Chrono's exact identifier grammar.`);
  }
}

/** Mirror the catalogued mcp-chrono 0.3.2 numeric gate before any submission. */
function assertChronoProviderBounds(value: ChronoPrescribedKinematicsCase): void {
  const finite = (number: number, path: string): void => {
    if (!Number.isFinite(number) || Math.abs(number) > PROVIDER_MAX_ABS) {
      throw unsupported(
        `${path} is outside mcp-chrono's +/-${PROVIDER_MAX_ABS} numeric boundary.`,
      );
    }
  };
  const poseBounds = (pose: ChronoPose, path: string): void => {
    pose.position_m.forEach((number, index) =>
      finite(number, `${path}.position_m[${index}]`)
    );
    pose.rotation_wxyz.forEach((number, index) =>
      finite(number, `${path}.rotation_wxyz[${index}]`)
    );
  };
  finite(value.duration_s, "duration_s");
  finite(value.step_s, "step_s");
  if (
    !(value.duration_s > 0 && value.duration_s <= PROVIDER_MAX_DURATION_S) ||
    !(value.step_s > 0) || value.duration_s / value.step_s > PROVIDER_MAX_STEP_RATIO
  ) {
    throw unsupported(
      "duration_s/step_s is outside mcp-chrono's supported timing bounds.",
    );
  }
  if (!Number.isSafeInteger(value.sample_every_steps) || value.sample_every_steps < 1) {
    throw unsupported(
      "sample_every_steps is outside mcp-chrono's supported timing bounds.",
    );
  }
  if (
    Math.floor(value.duration_s / value.step_s) / value.sample_every_steps + 2 >
      PROVIDER_MAX_STORED_SAMPLES
  ) {
    throw unsupported("The mcp-chrono stored-sample budget would exceed 512.");
  }
  for (const body of value.bodies) {
    poseBounds(body.absolute_com_pose, `bodies.${body.id}.absolute_com_pose`);
  }
  for (const joint of value.joints) {
    poseBounds(joint.absolute_joint_frame, `joints.${joint.id}.absolute_joint_frame`);
    finite(
      joint.angle_ramp.initial_angle_rad,
      `joints.${joint.id}.angle_ramp.initial_angle_rad`,
    );
    finite(
      joint.angle_ramp.angular_speed_rad_s,
      `joints.${joint.id}.angle_ramp.angular_speed_rad_s`,
    );
    finite(joint.limits_rad[0], `joints.${joint.id}.limits_rad[0]`);
    finite(joint.limits_rad[1], `joints.${joint.id}.limits_rad[1]`);
    if (joint.limits_rad[0] > joint.limits_rad[1]) {
      throw unsupported(`joints.${joint.id}.limits_rad is invalid for mcp-chrono.`);
    }
  }
}

function unsupported(message: string): ChronoPrescribedKinematicsLoweringError {
  return new ChronoPrescribedKinematicsLoweringError(message);
}
