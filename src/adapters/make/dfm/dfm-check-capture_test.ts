import { assertEquals, assertThrows } from "@std/assert";
import {
  DFM_CHECK_CAPTURE_SCHEMA,
  evaluateCapturedDfmChecks,
  parseDfmEnvelopeResult,
  parseDfmOverhangResult,
  parseDfmThicknessResult,
  persistZMinFilterTrace,
  validateDfmCheckCapture,
} from "./dfm-check-capture.ts";
import qualification from "./dfm-mcp-qualification.json" with {
  type: "json",
};

const LIVE_SHA256 = qualification.expected_step_sha256;

function liveParsed() {
  const envelope = parseDfmEnvelopeResult(
    qualification.dfm_check_envelope,
    LIVE_SHA256,
    { x: 250, y: 210, z: 200 },
  );
  const thickness = parseDfmThicknessResult(
    qualification.dfm_check_min_thickness,
    LIVE_SHA256,
    2,
  );
  const overhang = parseDfmOverhangResult(
    qualification.dfm_check_overhangs,
    LIVE_SHA256,
    45,
  );
  const zMinFilter = {
    enabled: true,
    planeZMm: { value: -3, unit: "mm" as const },
    toleranceMm: { value: 0.1, unit: "mm" as const },
  };
  const recomputed = evaluateCapturedDfmChecks({
    zMinFilter,
    buildVolumeMm: { x: 250, y: 210, z: 200 },
    minThicknessMm: 2,
    envelope,
    thickness,
    overhang,
  });
  return { envelope, thickness, overhang, zMinFilter, recomputed };
}

function validCapture() {
  const parsed = liveParsed();
  return {
    schemaVersion: DFM_CHECK_CAPTURE_SCHEMA,
    operation: { id: "industrialize.run-dfm-checks", version: "1" },
    trustedRunId: "run.dfm-checks",
    dispatchedAt: "2026-08-15T00:00:00.000Z",
    capturedAt: "2026-08-15T00:00:00.000Z",
    caseDigest: "b".repeat(64),
    geometry: {
      artifactId: "geometry-step-support-bracket",
      sha256: LIVE_SHA256,
      byteCount: 86130,
      mediaType: "model/step",
      stagedPath: `/exports/${LIVE_SHA256}.step`,
    },
    providerCallParams: {
      expectedStepSha256: LIVE_SHA256,
      buildVolumeMm: { x: 250, y: 210, z: 200 },
      minThicknessMm: 2,
      maxOverhangDeg: 45,
      meshSizeMm: 2,
      buildDirection: [0, 0, 1],
    },
    zMinFilter: persistZMinFilterTrace(parsed.recomputed.zMinTrace),
    envelope: {
      tool: "dfm_check_envelope",
      measured: parsed.envelope.measured,
      violations: parsed.envelope.violations,
      notChecked: parsed.envelope.notChecked,
      inputArtifactSha256: parsed.envelope.inputArtifactSha256,
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: parsed.thickness.measured,
      violations: parsed.thickness.violations,
      notChecked: parsed.thickness.notChecked,
      inputArtifactSha256: parsed.thickness.inputArtifactSha256,
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: parsed.overhang.measured,
      violations: parsed.overhang.violations,
      notChecked: parsed.overhang.notChecked,
      inputArtifactSha256: parsed.overhang.inputArtifactSha256,
    },
    evaluations: parsed.recomputed.evaluations,
    limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
  };
}

Deno.test("the recorded envelope fixture is parsed without inventing fields", () => {
  const result = parseDfmEnvelopeResult(
    qualification.dfm_check_envelope,
    LIVE_SHA256,
    { x: 250, y: 210, z: 200 },
  );
  assertEquals(result.measured.xMm, 190);
  assertEquals(result.measured.yMm, 135);
  assertEquals(result.measured.zMm, 18);
  assertEquals(result.violations, []);
  assertEquals(result.inputArtifactSha256, LIVE_SHA256);
});

Deno.test("the recorded thickness fixture is parsed without inventing fields", () => {
  const result = parseDfmThicknessResult(
    qualification.dfm_check_min_thickness,
    LIVE_SHA256,
    2,
  );
  assertEquals(result.violations, []);
  assertEquals(result.measured.sampleCount, 500);
  assertEquals(result.inputArtifactSha256, LIVE_SHA256);
});

Deno.test("the recorded overhang fixture keeps the bed-contact zone until Z-min is applied", () => {
  const result = parseDfmOverhangResult(
    qualification.dfm_check_overhangs,
    LIVE_SHA256,
    45,
  );
  assertEquals(result.violations.length, 6);
  assertEquals(result.violations[0]?.centroid_mm[2], -3);
});

Deno.test("the SHA-256 attestation mismatch is fail-closed on the recorded envelope", () => {
  assertThrows(
    () =>
      parseDfmEnvelopeResult(
        qualification.dfm_check_envelope,
        "0".repeat(64),
        { x: 250, y: 210, z: 200 },
      ),
    TypeError,
    "SHA-256 mismatch",
  );
});

Deno.test("the DFM check capture reread accepts the recorded qualification envelope", () => {
  const capture = validateDfmCheckCapture(validCapture());
  assertEquals(capture.evaluations.status, "fail");
  assertEquals(capture.zMinFilter.applied, true);
  assertEquals(capture.zMinFilter.filtered.length, 1);
  assertEquals(capture.zMinFilter.remaining.length, 5);
  assertEquals(
    capture.evaluations.verdicts.find((item) => item.check === "envelope")?.status,
    "pass",
  );
  assertEquals(
    capture.evaluations.verdicts.find((item) => item.check === "min-thickness")
      ?.status,
    "pass",
  );
  assertEquals(
    capture.evaluations.verdicts.find((item) => item.check === "overhangs")
      ?.violations[0]?.name,
    "overhang-zone-0-requires-support",
  );
});

Deno.test("the DFM check capture reread refuses a tampered evaluation", () => {
  const value = validCapture();
  value.evaluations = { status: "pass", verdicts: value.evaluations.verdicts };
  assertThrows(
    () => validateDfmCheckCapture(value),
    TypeError,
    "recomputed measured verdicts",
  );
});

Deno.test("the DFM check capture reread refuses a hidden Z-min change", () => {
  const value = validCapture() as Record<string, unknown>;
  const zMin = value.zMinFilter as Record<string, unknown>;
  zMin.applied = false;
  assertThrows(
    () => validateDfmCheckCapture(value),
    TypeError,
    "declared filter application",
  );
});

Deno.test("the DFM check capture reread refuses a model/stl geometry", () => {
  const value = validCapture();
  value.geometry.mediaType = "model/stl";
  assertThrows(
    () => validateDfmCheckCapture(value),
    TypeError,
    "model/step",
  );
});

Deno.test("the DFM check capture reread refuses an extra measured key", () => {
  const value = validCapture();
  (value.envelope.measured as Record<string, unknown>).massKg = 0.57;
  assertThrows(
    () => validateDfmCheckCapture(value),
    TypeError,
    "unsupported field massKg",
  );
});

Deno.test("the recorded mismatch message names the STEP attestation", () => {
  assertEquals(
    qualification.dfm_mismatch_test.message.includes("STEP SHA-256 mismatch"),
    true,
  );
});
