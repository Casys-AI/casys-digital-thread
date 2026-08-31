import { assertEquals, assertRejects } from "@std/assert";
import {
  ChronoPrescribedKinematicsCaseLowerer,
  ChronoPrescribedKinematicsLoweringError,
} from "./chrono-prescribed-kinematics-case-lowerer.ts";
import {
  fingerprintPrescribedKinematicsCaseSource,
  validatePrescribedKinematicsCaseSource,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import { sha256Hex } from "../../../domain/kernel/deterministic-json.ts";

Deno.test("Chrono lowerer emits the exact closed 0.3.2 provider case", async () => {
  const source = validSource();
  const sourceFingerprint = await fingerprintPrescribedKinematicsCaseSource(source);
  const lowered = await new ChronoPrescribedKinematicsCaseLowerer().lower({
    source,
    sourceFingerprint,
  });

  assertEquals(
    lowered.exactRequestText,
    '{"bodies":[{"absolute_com_pose":{"position_m":[0,0,0],"rotation_wxyz":[1,0,0,0]},"fixed":true,"id":"base"},{"absolute_com_pose":{"position_m":[0,0,1],"rotation_wxyz":[1,0,0,0]},"fixed":false,"id":"head"}],"duration_s":1,"frame":{"handedness":"right"},"joints":[{"absolute_joint_frame":{"position_m":[0,0,0],"rotation_wxyz":[1,0,0,0]},"angle_ramp":{"angular_speed_rad_s":0.5,"initial_angle_rad":0},"child_body":"head","id":"hinge","limits_rad":[-1,1],"parent_body":"base"}],"sample_every_steps":1,"schema_id":"chrono-prescribed-kinematics-case/1.0","step_s":0.5,"units":{"angle":"rad","length":"m","time":"s"}}',
  );
  assertEquals(lowered.sourceFingerprint, sourceFingerprint);
  assertEquals(
    lowered.requestFingerprint.digest,
    await sha256Hex(new TextEncoder().encode(lowered.exactRequestText)),
  );
  assertEquals(
    lowered.loweringFingerprint,
    {
      algorithm: "sha256",
      digest: "82adfc794e27a5af418f5152a2488e9ac2312eb8443152f547e317c0ad77dab4",
    },
  );
});

Deno.test("Chrono lowering ignores assembly context identity", async () => {
  const nested = validSource();
  const root = validatePrescribedKinematicsCaseSource({
    ...nested,
    assembly: {
      elementId: "definition-assembly",
      elementKind: "PartDefinition",
    },
  });
  const lowerer = new ChronoPrescribedKinematicsCaseLowerer();
  const nestedLowered = await lowerer.lower({
    source: nested,
    sourceFingerprint: await fingerprintPrescribedKinematicsCaseSource(nested),
  });
  const rootLowered = await lowerer.lower({
    source: root,
    sourceFingerprint: await fingerprintPrescribedKinematicsCaseSource(root),
  });
  assertEquals(rootLowered.exactRequestText, nestedLowered.exactRequestText);
  assertEquals(rootLowered.exactRequestText.includes("PartDefinition"), false);
  assertEquals(rootLowered.exactRequestText.includes("PartUsage"), false);
  assertEquals(rootLowered.exactRequestText.includes("elementKind"), false);
  assertEquals(rootLowered.exactRequestText.includes("definition-assembly"), false);
  assertEquals(
    nestedLowered.sourceFingerprint.digest === rootLowered.sourceFingerprint.digest,
    false,
  );
});

Deno.test("Chrono lowerer is deterministic and refuses a mismatched sealed source identity", async () => {
  const source = validSource();
  const sourceFingerprint = await fingerprintPrescribedKinematicsCaseSource(source);
  const lowerer = new ChronoPrescribedKinematicsCaseLowerer();
  const first = await lowerer.lower({ source, sourceFingerprint });
  const second = await lowerer.lower({ source, sourceFingerprint });
  assertEquals(second, first);
  await assertRejects(
    () =>
      lowerer.lower({
        source,
        sourceFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      }),
    ChronoPrescribedKinematicsLoweringError,
    "does not bind the exact source reopened",
  );
});

Deno.test("Chrono lowerer rejects unrepresentable frames, axes, and identifiers", async () => {
  const lowerer = new ChronoPrescribedKinematicsCaseLowerer();
  for (
    const value of [
      {
        ...validSource(),
        joints: [{
          ...validSource().joints[0],
          childFrame: {
            ...validSource().joints[0].childFrame,
            positionM: [0, 0, 0.1] as const,
          },
        }],
      },
      {
        ...validSource(),
        joints: [{
          ...validSource().joints[0],
          parentFrame: {
            ...validSource().joints[0].parentFrame,
            axis: [1, 0, 0] as const,
          },
          childFrame: {
            ...validSource().joints[0].childFrame,
            axis: [1, 0, 0] as const,
          },
        }],
      },
      {
        ...validSource(),
        bodies: [
          { ...validSource().bodies[0], bodyId: "1base" },
          validSource().bodies[1],
        ],
        groundBodyId: "1base",
        joints: [{ ...validSource().joints[0], parentBodyId: "1base" }],
      },
    ]
  ) {
    const source = validatePrescribedKinematicsCaseSource(value);
    const sourceFingerprint = await fingerprintPrescribedKinematicsCaseSource(source);
    await assertRejects(
      () => lowerer.lower({ source, sourceFingerprint }),
      ChronoPrescribedKinematicsLoweringError,
    );
  }
});

Deno.test("Chrono lowerer refuses a partial ramp rather than inventing a speed", async () => {
  const source = validSource();
  const nonRepresentableTiming = {
    ...source,
    joints: [{
      ...source.joints[0]!,
      ramp: { ...source.joints[0]!.ramp, endTimeS: 0.5 },
    }],
  };
  await assertRejects(
    () =>
      new ChronoPrescribedKinematicsCaseLowerer().lower({
        source: nonRepresentableTiming as typeof source,
        sourceFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      }),
    TypeError,
    "endTimeS must equal",
  );
});

/** Mirrors the provider's numeric gates before the request can reach Chrono. */
Deno.test("Chrono lowerer accepts provider-boundary values and rejects every uncovered numeric or sample budget", async () => {
  const lowerer = new ChronoPrescribedKinematicsCaseLowerer();
  const inside = validSource({
    headX: 1_000_000,
    limitMinimum: -1_000_000,
    limitMaximum: 1_000_000,
    initialAngleRad: -1_000_000,
    finalAngleRad: 0,
    durationS: 1,
    timeStepS: 1 / 510,
  });
  const insideFingerprint = await fingerprintPrescribedKinematicsCaseSource(inside);
  const lowered = await lowerer.lower({
    source: inside,
    sourceFingerprint: insideFingerprint,
  });
  assertEquals(JSON.parse(lowered.exactRequestText).sample_every_steps, 1);

  for (
    const source of [
      validSource({ headX: 1_000_001 }),
      validSource({
        limitMinimum: -1_000_001,
        limitMaximum: 1_000_001,
        initialAngleRad: 0,
        finalAngleRad: 0.5,
      }),
      validSource({
        limitMinimum: -1_000_000,
        limitMaximum: 1_000_000,
        initialAngleRad: -1_000_000,
        finalAngleRad: 1_000_000,
        durationS: 0.5,
        timeStepS: 0.5,
      }),
      validSource({ durationS: 10, timeStepS: 10 / 511 }),
    ]
  ) {
    const sourceFingerprint = await fingerprintPrescribedKinematicsCaseSource(source);
    await assertRejects(
      () => lowerer.lower({ source, sourceFingerprint }),
      ChronoPrescribedKinematicsLoweringError,
    );
  }
});

function validSource(options: {
  readonly durationS?: number;
  readonly timeStepS?: number;
  readonly headX?: number;
  readonly limitMinimum?: number;
  readonly limitMaximum?: number;
  readonly initialAngleRad?: number;
  readonly finalAngleRad?: number;
} = {}) {
  const pose = {
    positionM: [0, 0, 0] as const,
    orientationWxyz: [1, 0, 0, 0] as const,
  };
  const durationS = options.durationS ?? 1;
  const timeStepS = options.timeStepS ?? 0.5;
  const limitMinimum = options.limitMinimum ?? -1;
  const limitMaximum = options.limitMaximum ?? 1;
  const initialAngleRad = options.initialAngleRad ?? 0;
  const finalAngleRad = options.finalAngleRad ?? 0.5;
  return validatePrescribedKinematicsCaseSource({
    schemaVersion: "prescribed-kinematics-case-source/1.0",
    id: "case",
    revision: 1,
    scope: "One prescribed hinge.",
    evidenceBoundary: "Only factual prescribed kinematics.",
    project: { id: "project", subjectId: "subject" },
    assembly: { elementId: "assembly", elementKind: "PartUsage" },
    units: { length: "m", angle: "rad", time: "s" },
    durationS,
    groundBodyId: "base",
    bodies: [{ bodyId: "base", partUsageElementId: "baseUsage", zeroPose: pose }, {
      bodyId: "head",
      partUsageElementId: "headUsage",
      zeroPose: { ...pose, positionM: [options.headX ?? 0, 0, 1] as const },
    }],
    joints: [{
      jointId: "hinge",
      kind: "revolute",
      parentBodyId: "base",
      childBodyId: "head",
      parentFrame: { ...pose, axis: [0, 0, 1] as const },
      childFrame: { ...pose, axis: [0, 0, 1] as const },
      limitRad: { minimum: limitMinimum, maximum: limitMaximum },
      ramp: {
        kind: "linear",
        startTimeS: 0,
        endTimeS: durationS,
        initialAngleRad,
        finalAngleRad,
      },
    }],
    sampling: { timeStepS },
  });
}
