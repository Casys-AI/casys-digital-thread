/**
 * Receipt evaluation for the closed Chrono arm64-emulation probe.
 * Provider SUCCESS / `{1,SUCCESS}` is never qualification. FULL kinematics
 * must complete with one of `{2,ABSTOL_RESIDUAL}|{3,RELTOL_UPDATE}|{4,ABSTOL_UPDATE}`.
 */

import {
  assertChronoArm64EmulationQualificationFixture,
  CHRONO_ARM64_EMULATION_QUALIFICATION_BASE_POSE,
  CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS,
  CHRONO_ARM64_EMULATION_QUALIFICATION_JOINT_ID,
  CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS,
  CHRONO_ARM64_EMULATION_QUALIFICATION_LINK_POSITION_M,
  CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED,
  CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT,
  CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES,
  chronoArm64EmulationQualificationLinkOrientationWxyz,
  chronoArm64EmulationQualificationPrescribedAngleRad,
} from "../../domain/capability/runtime/capability-runtime-qualification-criteria.ts";
import {
  type PrescribedKinematicsCaseSource,
  prescribedKinematicsRequiredSampleTimes,
  prescribedKinematicsSampleIndex,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import type { PrescribedKinematicsObservationRecord } from "../ports/out/mechanics/prescribed-kinematics-observer.ts";

export {
  assertChronoArm64EmulationQualificationFixture,
  CHRONO_ARM64_EMULATION_QUALIFICATION_BASE_POSE,
  CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS,
  CHRONO_ARM64_EMULATION_QUALIFICATION_CRITERIA_VERSION,
  CHRONO_ARM64_EMULATION_QUALIFICATION_DURATION_S,
  CHRONO_ARM64_EMULATION_QUALIFICATION_JOINT_ID,
  CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS,
  CHRONO_ARM64_EMULATION_QUALIFICATION_LINK_POSITION_M,
  CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED,
  CHRONO_ARM64_EMULATION_QUALIFICATION_RAMP,
  CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT,
  CHRONO_ARM64_EMULATION_QUALIFICATION_TIME_STEP_S,
  CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES,
  chronoArm64EmulationQualificationCriteriaManifest,
  chronoArm64EmulationQualificationLinkOrientationWxyz,
  chronoArm64EmulationQualificationPrescribedAngleRad,
  fingerprintChronoArm64EmulationQualificationCriteria,
} from "../../domain/capability/runtime/capability-runtime-qualification-criteria.ts";

export function assertChronoArm64EmulationQualificationReceipt(
  record: PrescribedKinematicsObservationRecord,
  source: PrescribedKinematicsCaseSource,
): void {
  assertChronoArm64EmulationQualificationFixture(source);
  if (
    record.receipt.engine.name !== "Project Chrono" ||
    record.receipt.executionState !== "completed" ||
    !CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS.some((exit) =>
      exit.rawCode === record.receipt.kinematicsExit.rawCode &&
      exit.rawName === record.receipt.kinematicsExit.rawName
    )
  ) {
    throw new TypeError(
      "Chrono qualification receipt is not Project Chrono completed with an accepted FULL kinematics exit.",
    );
  }
  if (
    record.notEvaluated.length !==
      CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED.length ||
    record.notEvaluated.some((entry, index) =>
      entry !== CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED[index]
    )
  ) {
    throw new TypeError(
      "Chrono qualification receipt does not preserve the literal notEvaluated limits.",
    );
  }
  const expectedTimes = prescribedKinematicsRequiredSampleTimes(source);
  if (
    record.samplePage.hasMore ||
    record.samplePage.samples.length !==
      CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT ||
    record.samplePage.total !== CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT ||
    record.sampleCount !== CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT ||
    expectedTimes.length !== CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT
  ) {
    throw new TypeError(
      "Chrono qualification receipt must contain the complete 65-sample page.",
    );
  }
  const seen = new Set<number>();
  for (const [ordinal, sample] of record.samplePage.samples.entries()) {
    const index = prescribedKinematicsSampleIndex(source, sample.timeSeconds);
    if (index === undefined || index !== ordinal || seen.has(index)) {
      throw new TypeError(
        "Chrono qualification receipt sample times are not the sealed fixture schedule.",
      );
    }
    seen.add(index);
    const bodyById = new Map(sample.bodies.map((body) => [body.bodyId, body]));
    if (
      sample.bodies.length !== CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS.length ||
      CHRONO_ARM64_EMULATION_QUALIFICATION_BODY_IDS.some((id) => !bodyById.has(id))
    ) {
      throw new TypeError(
        "Chrono qualification receipt body ids do not match the exact fixture.",
      );
    }
    const base = bodyById.get("base")!;
    const link = bodyById.get("link")!;
    assertPose(
      base.positionMetres,
      CHRONO_ARM64_EMULATION_QUALIFICATION_BASE_POSE.positionM,
      CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.positionM,
      "base position",
    );
    assertPose(
      base.rotationWxyz,
      CHRONO_ARM64_EMULATION_QUALIFICATION_BASE_POSE.orientationWxyz,
      CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.quaternion,
      "base quaternion",
    );
    assertPose(
      link.positionMetres,
      CHRONO_ARM64_EMULATION_QUALIFICATION_LINK_POSITION_M,
      CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.positionM,
      "link position",
    );
    if (
      sample.joints.length !== 1 ||
      sample.joints[0]?.jointId !== CHRONO_ARM64_EMULATION_QUALIFICATION_JOINT_ID
    ) {
      throw new TypeError(
        "Chrono qualification receipt joint ids do not match the exact hinge.",
      );
    }
    const joint = sample.joints[0];
    const expectedAngle = chronoArm64EmulationQualificationPrescribedAngleRad(index);
    if (
      Math.abs(joint.motorAngleRadians - expectedAngle) >
        CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.motorAngleRad
    ) {
      throw new TypeError(
        "Chrono qualification receipt does not follow the prescribed 0 -> 0.5 rad ramp.",
      );
    }
    const expectedQuaternion = chronoArm64EmulationQualificationLinkOrientationWxyz(
      expectedAngle,
    );
    assertQuaternion(
      link.rotationWxyz,
      expectedQuaternion,
      CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.quaternion,
    );
    if (joint.declaredLimitObservation !== "within") {
      throw new TypeError(
        "Chrono qualification receipt hinge is not within declared limits.",
      );
    }
    if (
      vectorNorm(joint.translationResidualMetres) >
        CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.translationResidualM
    ) {
      throw new TypeError(
        "Chrono qualification receipt translation residual exceeds its bound.",
      );
    }
    if (
      vectorNorm(joint.rotationQuaternionImagResidual) >
        CHRONO_ARM64_EMULATION_QUALIFICATION_TOLERANCES.rotationResidual
    ) {
      throw new TypeError(
        "Chrono qualification receipt rotation residual exceeds its bound.",
      );
    }
  }
  if (seen.size !== CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT) {
    throw new TypeError(
      "Chrono qualification receipt does not cover every fixture sample index.",
    );
  }
}

function assertPose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
  label: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => Math.abs(value - expected[index]!) > tolerance)
  ) {
    throw new TypeError(
      `Chrono qualification receipt ${label} is not the sealed pose.`,
    );
  }
}

function vectorNorm(value: readonly number[]): number {
  return Math.hypot(value[0] ?? NaN, value[1] ?? NaN, value[2] ?? NaN);
}

function assertQuaternion(
  actual: readonly number[],
  expected: readonly [number, number, number, number],
  tolerance: number,
): void {
  const left = normalizeQuaternion(actual);
  const right = normalizeQuaternion(expected);
  if (!left || !right) {
    throw new TypeError(
      "Chrono qualification receipt link quaternion is not normalizable.",
    );
  }
  const dot = Math.abs(
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3],
  );
  if (dot < 1 - tolerance) {
    throw new TypeError(
      "Chrono qualification receipt link quaternion is not the sealed pose.",
    );
  }
}

function normalizeQuaternion(
  value: readonly number[],
): readonly [number, number, number, number] | undefined {
  if (value.length !== 4) return undefined;
  const norm = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
  if (!(norm > 0) || !Number.isFinite(norm)) return undefined;
  return [value[0]! / norm, value[1]! / norm, value[2]! / norm, value[3]! / norm];
}
