import { assertEquals, assertThrows } from "@std/assert";
import {
  parseDfmThicknessResult,
  PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA,
  validatePrintabilityObservationCapture,
} from "./printability-check-capture.ts";

const DIGEST = "a".repeat(64);

function validCapture() {
  return {
    schemaVersion: PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA,
    operation: { id: "industrialize.observe-printability", version: "1" },
    trustedRunId: "run.printability-observe",
    dispatchedAt: "2026-08-15T00:00:00.000Z",
    capturedAt: "2026-08-15T00:00:00.000Z",
    caseDigest: "b".repeat(64),
    geometry: {
      artifactId: "geometry-step-1",
      sha256: DIGEST,
      byteCount: 32,
      mediaType: "model/step",
      stagedPath: `/exports/${DIGEST}.step`,
    },
    providerCallParams: {
      meshSizeMm: 2,
      buildDirection: [0, 0, 1],
      minWallThicknessMm: 1.2,
      maxOverhangAngleDeg: 45,
    },
    reviewedCaseThresholds: { maxUnsupportedAreaMm2: 600 },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: {
        minThicknessMm: 0.8,
        minPositionMm: [1, 2, 3],
        sampleCount: 10,
        validRayCount: 8,
      },
      violations: [{ area_mm2: 1, centroid_mm: [0, 0, 0] }],
      notChecked: ["bridging"],
      inputArtifactSha256: DIGEST,
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: {
        totalSurfaceAreaMm2: 100,
        overhangAreaMm2: 4,
        overhangTriangleCount: 2,
        totalTriangleCount: 20,
      },
      violations: [],
      notChecked: ["support"],
      inputArtifactSha256: DIGEST,
    },
    limitations: ["Observations only."],
  };
}

Deno.test("printability observation capture reread accepts an exact recorded record", () => {
  const capture = validatePrintabilityObservationCapture(validCapture());
  assertEquals(capture.geometry.mediaType, "model/step");
  assertEquals(capture.thickness.violations, [{
    area_mm2: 1,
    centroid_mm: [0, 0, 0],
  }]);
});

Deno.test("printability observation capture reread refuses a model/stl geometry", () => {
  const value = validCapture();
  value.geometry.mediaType = "model/stl";
  assertThrows(
    () => validatePrintabilityObservationCapture(value),
    TypeError,
    "model/step",
  );
});

Deno.test("printability observation capture reread refuses an extra measured key", () => {
  const value = validCapture();
  (value.thickness.measured as Record<string, unknown>).extra = true;
  assertThrows(
    () => validatePrintabilityObservationCapture(value),
    TypeError,
    "unsupported field extra",
  );
});

Deno.test("printability observation capture reread refuses an extra violation key", () => {
  const value = validCapture();
  (value.thickness.violations[0] as Record<string, unknown>).extra = true;
  assertThrows(
    () => validatePrintabilityObservationCapture(value),
    TypeError,
    "unsupported field extra",
  );
});

Deno.test("parseDfmThicknessResult persists only area_mm2 and centroid_mm", () => {
  const result = parseDfmThicknessResult(
    {
      violations: [{ area_mm2: 1, centroid_mm: [0, 0, 0], extra: true }],
      measured: {
        min_thickness_mm: 0.8,
        min_position_mm: [1, 2, 3],
        sample_count: 10,
        valid_ray_count: 8,
      },
      limits_declared: { min_thickness_mm: 1.2 },
      not_checked: ["bridging"],
      input_artifact: { sha256: DIGEST },
    },
    DIGEST,
    1.2,
  );
  assertEquals(result.violations, [{ area_mm2: 1, centroid_mm: [0, 0, 0] }]);
});
