import { assertEquals, assertThrows } from "@std/assert";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "../../adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import {
  prescribedKinematicsRequiredSampleTimes,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import type { PrescribedKinematicsObservationRecord } from "../ports/out/mechanics/prescribed-kinematics-observer.ts";
import {
  assertChronoArm64EmulationQualificationReceipt,
  CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS,
  CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED,
  CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT,
  chronoArm64EmulationQualificationCriteriaManifest,
  chronoArm64EmulationQualificationLinkOrientationWxyz,
  chronoArm64EmulationQualificationPrescribedAngleRad,
  fingerprintChronoArm64EmulationQualificationCriteria,
} from "./capability-runtime-qualification-criteria.ts";

Deno.test("Chrono qualification criteria accept FULL exits 2/3/4, q and -q, and reject SUCCESS with a static pose", async () => {
  const candidates = await createFirstPartyCapabilityRuntimeQualificationCandidates();
  const source = candidates[0]!.fixture.source;
  const fingerprint = await fingerprintChronoArm64EmulationQualificationCriteria();
  assertEquals(fingerprint.algorithm, "sha256");
  assertEquals(fingerprint.digest.length, 64);
  assertEquals(
    prescribedKinematicsRequiredSampleTimes(source).length,
    CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT,
  );
  assertEquals(
    chronoArm64EmulationQualificationCriteriaManifest().kinematicsExits,
    CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS,
  );
  assertEquals(
    chronoArm64EmulationQualificationCriteriaManifest().linkQuaternionComparison,
    "normalized-sign-invariant-dot",
  );

  for (const exit of CHRONO_ARM64_EMULATION_QUALIFICATION_KINEMATICS_EXITS) {
    assertChronoArm64EmulationQualificationReceipt(
      qualifiedRecord(source, { exit }),
      source,
    );
  }
  assertChronoArm64EmulationQualificationReceipt(
    qualifiedRecord(source, { quaternion: "negated" }),
    source,
  );

  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { pose: "static" }),
        source,
      ),
    TypeError,
    "link quaternion",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { residual: "bad" }),
        source,
      ),
    TypeError,
    "translation residual",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { limit: "above" }),
        source,
      ),
    TypeError,
    "declared limits",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { quaternion: "wrong" }),
        source,
      ),
    TypeError,
    "link quaternion",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { quaternion: "zero" }),
        source,
      ),
    TypeError,
    "not normalizable",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { exit: { rawCode: 1, rawName: "SUCCESS" } }),
        source,
      ),
    TypeError,
    "accepted FULL kinematics exit",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, {
          executionState: "not-converged",
          exit: { rawCode: 0, rawName: "NOT_CONVERGED" },
        }),
        source,
      ),
    TypeError,
    "accepted FULL kinematics exit",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { pages: "drift" }),
        source,
      ),
    TypeError,
    "65-sample page",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { notEvaluated: ["collision"] }),
        source,
      ),
    TypeError,
    "notEvaluated",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { basePosition: [1, 0, 0] }),
        source,
      ),
    TypeError,
    "base position",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { linkPosition: [0, 0, 0] }),
        source,
      ),
    TypeError,
    "link position",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { baseQuaternion: [0, 1, 0, 0] }),
        source,
      ),
    TypeError,
    "base quaternion",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { motor: "echo-wrong" }),
        source,
      ),
    TypeError,
    "0 -> 0.5 rad ramp",
  );
  assertThrows(
    () =>
      assertChronoArm64EmulationQualificationReceipt(
        qualifiedRecord(source, { rotationResidual: "bad" }),
        source,
      ),
    TypeError,
    "rotation residual",
  );
});

function qualifiedRecord(
  source: Parameters<typeof prescribedKinematicsRequiredSampleTimes>[0],
  options: {
    readonly pose?: "moving" | "static";
    readonly residual?: "zero" | "bad";
    readonly limit?: "within" | "above";
    readonly quaternion?: "exact" | "wrong" | "negated" | "zero";
    readonly pages?: "complete" | "drift";
    readonly notEvaluated?: readonly string[];
    readonly executionState?: "completed" | "not-converged";
    readonly exit?: { readonly rawCode: number; readonly rawName: string };
    readonly basePosition?: readonly [number, number, number];
    readonly linkPosition?: readonly [number, number, number];
    readonly baseQuaternion?: readonly [number, number, number, number];
    readonly motor?: "ramp" | "echo-wrong";
    readonly rotationResidual?: "zero" | "bad";
  } = {},
): PrescribedKinematicsObservationRecord {
  const times = prescribedKinematicsRequiredSampleTimes(source);
  const samples = times.map((timeSeconds, index) => {
    const angle = chronoArm64EmulationQualificationPrescribedAngleRad(index);
    const expected = chronoArm64EmulationQualificationLinkOrientationWxyz(angle);
    const orientation = options.pose === "static" || options.quaternion === "wrong"
      ? ([1, 0, 0, 0] as const)
      : options.quaternion === "zero"
      ? ([0, 0, 0, 0] as const)
      : options.quaternion === "negated"
      ? ([-expected[0], -expected[1], -expected[2], -expected[3]] as const)
      : expected;
    return {
      timeSeconds,
      bodies: [
        {
          bodyId: "base",
          positionMetres: options.basePosition ?? [0, 0, 0] as const,
          rotationWxyz: options.baseQuaternion ?? [1, 0, 0, 0] as const,
        },
        {
          bodyId: "link",
          positionMetres: options.linkPosition ?? [0, 0, 1] as const,
          rotationWxyz: orientation,
        },
      ],
      joints: [{
        jointId: "hinge",
        motorAngleRadians: options.motor === "echo-wrong" ? angle + 0.2 : angle,
        declaredLimitObservation: options.limit ?? "within",
        translationResidualMetres: options.residual === "bad"
          ? [1, 0, 0] as const
          : [0, 0, 0] as const,
        rotationQuaternionImagResidual: options.rotationResidual === "bad"
          ? [1, 0, 0] as const
          : [0, 0, 0] as const,
      }],
    };
  });
  const complete = options.pages !== "drift";
  return {
    request: {
      requestId: "chrono-qual-test",
      caseSha256: "a".repeat(64),
      caseUri: `chrono-case:sha256:${"a".repeat(64)}`,
    },
    recordedAt: "2026-08-29T00:00:00.000Z",
    receipt: {
      receiptSha256: "c".repeat(64),
      caseSha256: "a".repeat(64),
      outcomeSha256: "d".repeat(64),
      requestId: "chrono-qual-test",
      recordedAt: "2026-08-29T00:00:00.000Z",
      engine: { name: "Project Chrono", version: "10.0.0" },
      runtime: {
        binding: "pychrono",
        pythonVersion: "3.12.0",
        serverDenoVersion: "2.0.0",
      },
      workerSourceSha256: "e".repeat(64),
      executionState: options.executionState ?? "completed",
      kinematicsExit: options.exit ?? { rawCode: 2, rawName: "ABSTOL_RESIDUAL" },
    },
    notEvaluated: (options.notEvaluated ??
      CHRONO_ARM64_EMULATION_QUALIFICATION_NOT_EVALUATED) as PrescribedKinematicsObservationRecord[
        "notEvaluated"
      ],
    sampleCount: samples.length,
    sampleTimeRangeSeconds: { first: 0, last: 1 },
    samplePage: {
      sampleOffset: 0,
      sampleLimit: 64,
      total: samples.length,
      returned: complete ? samples.length : 64,
      hasMore: !complete,
      samples: complete ? samples : samples.slice(0, 64),
    },
  };
}
