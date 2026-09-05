/**
 * Closed Chrono arm64-emulation probe criteria identities. Receipt evaluation
 * against an observation record lives in the application layer.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type PrescribedKinematicsCaseSource,
  prescribedKinematicsRequiredSampleTimes,
} from "../../mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";

export const CHRONO_ARM64_EMULATION_QUALIFICATION_CRITERIA_VERSION = "2" as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS = [
  "base",
  "link",
] as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_JOINT_ID = "hinge" as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_DURATION_S = 1;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_TIME_STEP_S = 1 / 64;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT = 65;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP = {
  initialAngleRad: 0,
  finalAngleRad: 0.5,
} as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_BASE_POSE = {
  positionM: [0, 0, 0] as const,
  orientationWxyz: [1, 0, 0, 0] as const,
};
export const CHRONO_ARM64_EMULATION_QUALIFICATION_LINK_POSITION_M = [
  0,
  0,
  1,
] as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS = [
  { rawCode: 2, rawName: "ABSTOL_RESIDUAL" },
  { rawCode: 3, rawName: "RELTOL_UPDATE" },
  { rawCode: 4, rawName: "ABSTOL_UPDATE" },
] as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES = {
  motorAngleRad: 1e-6,
  positionM: 1e-8,
  quaternion: 1e-8,
  translationResidualM: 1e-6,
  rotationResidual: 1e-6,
} as const;
export const CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED = [
  "collision",
  "clearance",
  "contact",
  "forces",
  "torques",
  "dynamics",
  "strength",
  "safety",
  "product fitness",
] as const;

export function chronoArm64EmulationQualificationCriteriaManifest() {
  return deepFreeze({
    schemaVersion: "chrono-arm64-emulation-qualification-criteria/2.0",
    version: CHRONO_ARM64_EMULATION_QUALIFICATION_CRITERIA_VERSION,
    bodyIds: CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS,
    jointId: CHRONO_ARM64_EMULATION_QUALIFICATION_JOINT_ID,
    durationS: CHRONO_ARM64_EMULATION_QUALIFICATION_DURATION_S,
    timeStepS: CHRONO_ARM64_EMULATION_QUALIFICATION_TIME_STEP_S,
    sampleCount: CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT,
    ramp: CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP,
    basePose: CHRONO_ARM64_EMULATION_QUALIFICATION_BASE_POSE,
    linkPositionM: CHRONO_ARM64_EMULATION_QUALIFICATION_LINK_POSITION_M,
    linkQuaternion: "cos(angle/2),0,0,sin(angle/2)",
    declaredLimitObservation: "within",
    engineName: "Project Chrono",
    executionState: "completed",
    kinematicsExits: CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS,
    linkQuaternionComparison: "normalized-sign-invariant-dot",
    notEvaluated: CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED,
    tolerances: CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES,
  });
}

export function fingerprintChronoArm64EmulationQualificationCriteria(): Promise<
  ContentFingerprint
> {
  return sha256Fingerprint(chronoArm64EmulationQualificationCriteriaManifest());
}

export function chronoArm64EmulationQualificationPrescribedAngleRad(
  sampleIndex: number,
): number {
  if (
    !Number.isInteger(sampleIndex) || sampleIndex < 0 ||
    sampleIndex >= CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT
  ) {
    throw new TypeError("Chrono qualification sample index is out of range.");
  }
  const last = CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT - 1;
  return CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP.initialAngleRad +
    (CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP.finalAngleRad -
        CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP.initialAngleRad) *
      (sampleIndex / last);
}

export function chronoArm64EmulationQualificationLinkOrientationWxyz(
  angleRad: number,
): readonly [number, number, number, number] {
  const half = angleRad / 2;
  return [Math.cos(half), 0, 0, Math.sin(half)];
}

export function assertChronoArm64EmulationQualificationFixture(
  source: PrescribedKinematicsCaseSource,
): void {
  const bodyIds = source.bodies.map((body) => body.bodyId).toSorted();
  const expectedBodies = [...CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS]
    .toSorted();
  if (
    bodyIds.length !== expectedBodies.length ||
    bodyIds.some((id, index) => id !== expectedBodies[index])
  ) {
    throw new TypeError(
      "Chrono qualification fixture must declare exact base and link bodies.",
    );
  }
  if (
    source.joints.length !== 1 ||
    source.joints[0]?.jointId !== CHRONO_ARM64_EMULATION_QUALIFICATION_JOINT_ID ||
    source.joints[0]?.kind !== "revolute"
  ) {
    throw new TypeError(
      "Chrono qualification fixture must declare the exact hinge joint.",
    );
  }
  const ramp = source.joints[0].ramp;
  if (
    ramp.kind !== "linear" ||
    ramp.initialAngleRad !==
      CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP.initialAngleRad ||
    ramp.finalAngleRad !== CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP.finalAngleRad
  ) {
    throw new TypeError(
      "Chrono qualification fixture must prescribe the exact 0 -> 0.5 rad ramp.",
    );
  }
  if (
    source.durationS !== CHRONO_ARM64_EMULATION_QUALIFICATION_DURATION_S ||
    source.sampling.timeStepS !==
      CHRONO_ARM64_EMULATION_QUALIFICATION_TIME_STEP_S
  ) {
    throw new TypeError(
      "Chrono qualification fixture must use duration 1 s and timeStep 1/64 s.",
    );
  }
  const times = prescribedKinematicsRequiredSampleTimes(source);
  if (times.length !== CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT) {
    throw new TypeError(
      "Chrono qualification fixture must declare exactly 65 sample instants.",
    );
  }
}
