import { assertEquals, assertThrows } from "@std/assert";
import {
  PRINT_ESTIMATE_OBSERVATION_CAPTURE_SCHEMA,
  validatePrintEstimateObservationCapture,
} from "./print-estimate-capture.ts";

const DIGEST = "a".repeat(64);
const PROFILE = "b".repeat(64);

function validCapture() {
  return {
    schemaVersion: PRINT_ESTIMATE_OBSERVATION_CAPTURE_SCHEMA,
    operation: { id: "industrialize.observe-print-estimate", version: "1" },
    trustedRunId: "run.print-estimate-observe",
    dispatchedAt: "2026-08-15T00:00:00.000Z",
    capturedAt: "2026-08-15T00:00:00.000Z",
    caseDigest: "c".repeat(64),
    geometry: {
      artifactId: "geometry-stl-1",
      sha256: DIGEST,
      byteCount: 32,
      mediaType: "model/stl",
      stagedPath: `/exports/${DIGEST}.stl`,
    },
    profile: {
      repoPath: "config/print-estimate-cases/reviewed-fff.ini",
      exportName: "reviewed-fff",
      sha256: PROFILE,
      stagedPath: "/exports/reviewed-fff.ini",
    },
    estimate: {
      printTimeS: 3600,
      printTimeNormalMode: "1h 0m",
      printTimeSilentMode: null,
      filamentLengthMm: 1200,
      filamentVolumeMm3: 4000,
      gcodeSha256: "d".repeat(64),
      notChecked: ["warm-up"],
      stlArtifactSha256: DIGEST,
      profileArtifactSha256: PROFILE,
      profileArtifactBytes: 12,
    },
    limitations: ["Observations only."],
  };
}

Deno.test("print-estimate observation capture reread accepts an exact recorded record", () => {
  const capture = validatePrintEstimateObservationCapture(validCapture());
  assertEquals(capture.geometry.mediaType, "model/stl");
  assertEquals(capture.estimate.printTimeS, 3600);
});

Deno.test("print-estimate observation capture reread refuses a model/step geometry", () => {
  const value = validCapture();
  value.geometry.mediaType = "model/step";
  assertThrows(
    () => validatePrintEstimateObservationCapture(value),
    TypeError,
    "model/stl",
  );
});

Deno.test("print-estimate observation capture reread refuses an extra estimate key", () => {
  const value = validCapture();
  (value.estimate as Record<string, unknown>).priceEur = 12;
  assertThrows(
    () => validatePrintEstimateObservationCapture(value),
    TypeError,
    "unsupported field priceEur",
  );
});
