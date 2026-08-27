import { assertEquals, assertThrows } from "@std/assert";
import { validatePrintabilityCheckCase } from "../printability/printability-case.ts";
import {
  applyDeclaredZMinFilter,
  assertSha256Attestation,
  DFM_CHECK_CASE_SCHEMA,
  evaluateMeasuredDfmChecks,
  parseDfmTargetArtifactUri,
  validateDfmCheckCase,
} from "./dfm-case.ts";

const LIVE_STEP_SHA256 =
  "9273149a5203a13ef3b14f7e70062e76ee106eaaf5ba474e98e1cd9116cdc270";

/** Live overhang clusters from the archived mcp-dfm qualification call. */
const LIVE_OVERHANG_ZONES = [
  {
    area_mm2: 20849.999999999225,
    centroid_mm: [-0.03837144008855162, 0.008605671595452903, -3] as const,
  },
  {
    area_mm2: 959.9999999999995,
    centroid_mm: [-60.06554509145262, 0.5276039591380303, -15] as const,
  },
  {
    area_mm2: 960.0000000000011,
    centroid_mm: [-30.08684139289863, 0.39506884825609334, -15] as const,
  },
  {
    area_mm2: 960,
    centroid_mm: [-0.011395083637985807, 0.3748991084792701, -15] as const,
  },
  {
    area_mm2: 959.9999999999993,
    centroid_mm: [29.952818066405477, 0.10921998475374492, -15] as const,
  },
  {
    area_mm2: 959.9999999999995,
    centroid_mm: [59.934454908547394, 0.5276039591380303, -15] as const,
  },
];

function validCaseInput() {
  return {
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id: "generic-product-v1-support-bracket-dfm-v1",
    revision: 1,
    scope: "Measured DFM checks for the isolated support bracket.",
    evidenceBoundary:
      "Measured provider verdicts against the sealed case; a fail is a named violation, not a certification.",
    project: {
      id: "generic-product-v1",
      subjectId: "project:generic-product-v1",
    },
    target: {
      componentKey: "support-bracket",
      artifactUri: "thread-artifact://generic-product-v1/geometry-step-support-bracket",
      sha256: LIVE_STEP_SHA256,
      mediaType: "model/step",
    },
    buildVolumeMm: {
      x: { value: 250, unit: "mm" },
      y: { value: 210, unit: "mm" },
      z: { value: 200, unit: "mm" },
    },
    minThicknessMm: { value: 2, unit: "mm" },
    maxOverhangAngleDeg: { value: 45, unit: "deg" },
    meshSizeMm: { value: 2, unit: "mm" },
    buildDirection: [0, 0, 1],
    zMinFilter: {
      enabled: true,
      planeZMm: { value: -3, unit: "mm" },
      toleranceMm: { value: 0.1, unit: "mm" },
    },
    provider: {
      envelopeTool: "dfm_check_envelope",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: [
      "The live mcp-dfm tools analyse STEP, not STL.",
      "The declared Z-min filter is the only bed-contact exclusion.",
    ],
    provenance: {
      status: "provisional",
      note: "Limits copied from the archived mcp-dfm qualification call.",
    },
  };
}

Deno.test("the DFM case accepts a fully attested STEP target and declared Z-min filter", () => {
  const result = validateDfmCheckCase(validCaseInput());
  assertEquals(result.schemaVersion, "dfm-check-case/1.0");
  assertEquals(result.target.sha256, LIVE_STEP_SHA256);
  assertEquals(result.target.mediaType, "model/step");
  assertEquals(result.buildVolumeMm.x, { value: 250, unit: "mm" });
  assertEquals(result.zMinFilter.enabled, true);
  assertEquals(result.zMinFilter.planeZMm, { value: -3, unit: "mm" });
  assertEquals(result.provider.envelopeTool, "dfm_check_envelope");
  assertEquals(
    parseDfmTargetArtifactUri(result.target.artifactUri),
    {
      projectId: "generic-product-v1",
      artifactId: "geometry-step-support-bracket",
    },
  );
});

Deno.test("the DFM case refuses a STEP target without sha256 attestation", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  delete (input.target as any).sha256;
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "sha256",
  );
});

Deno.test("the DFM case refuses an empty sha256 attestation", () => {
  const input = validCaseInput();
  input.target.sha256 = "";
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "sha256",
  );
});

Deno.test("the DFM case refuses an uppercase sha256 attestation", () => {
  const input = validCaseInput();
  input.target.sha256 = LIVE_STEP_SHA256.toUpperCase();
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "lowercase 64-character hex",
  );
});

Deno.test("the DFM case refuses a model/stl target because mcp-dfm attests STEP", () => {
  const input = validCaseInput();
  input.target.mediaType = "model/stl";
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "model/step",
  );
});

Deno.test("the DFM case refuses a build volume expressed as an array", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).buildVolumeMm = [250, 210, 200];
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "must be an object",
  );
});

Deno.test("the DFM case refuses a missing Z-min filter declaration", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  delete (input as any).zMinFilter;
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "zMinFilter",
  );
});

Deno.test("the DFM case refuses an extra field", () => {
  const input = { ...validCaseInput(), extraField: "forbidden" };
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "extraField",
  );
});

Deno.test("the DFM case refuses a zero build direction", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).buildDirection = [0, 0, 0];
  assertThrows(
    () => validateDfmCheckCase(input),
    TypeError,
    "zero vector",
  );
});

Deno.test("the SHA-256 attestation mismatch is fail-closed", () => {
  assertThrows(
    () =>
      assertSha256Attestation(
        "0000000000000000000000000000000000000000000000000000000000000000",
        LIVE_STEP_SHA256,
        "dfm_check_envelope.input_artifact.sha256",
      ),
    TypeError,
    "SHA-256 mismatch",
  );
});

Deno.test("the declared Z-min filter is applied and traced on the live overhang clusters", () => {
  const dfmCase = validateDfmCheckCase(validCaseInput());
  const trace = applyDeclaredZMinFilter(LIVE_OVERHANG_ZONES, dfmCase.zMinFilter);
  assertEquals(trace.applied, true);
  assertEquals(trace.filtered.length, 1);
  assertEquals(trace.filtered[0]?.reason, "z-min-bed-contact");
  assertEquals(trace.filtered[0]?.centroidZMm, -3);
  assertEquals(trace.remaining.length, 5);
  assertEquals(
    trace.remaining.every((zone) => zone.centroid_mm[2] === -15),
    true,
  );
});

Deno.test("a disabled Z-min filter is traced and does not drop the bed face", () => {
  const input = validCaseInput();
  input.zMinFilter.enabled = false;
  const dfmCase = validateDfmCheckCase(input);
  const trace = applyDeclaredZMinFilter(LIVE_OVERHANG_ZONES, dfmCase.zMinFilter);
  assertEquals(trace.applied, false);
  assertEquals(trace.filtered.length, 0);
  assertEquals(trace.remaining.length, 6);
});

Deno.test("a measured check fail publishes a named violation", () => {
  const dfmCase = validateDfmCheckCase(validCaseInput());
  const result = evaluateMeasuredDfmChecks({
    dfmCase,
    envelope: {
      measured: { x_mm: 260, y_mm: 135, z_mm: 18 },
      providerViolations: [{ axis: "x", measured_mm: 260, limit_mm: 250 }],
    },
    thickness: {
      minThicknessMm: 1.0,
      providerViolationCount: 1,
    },
    overhangs: { zones: LIVE_OVERHANG_ZONES },
  });
  assertEquals(result.status, "fail");
  assertEquals(result.zMinTrace.applied, true);
  assertEquals(result.zMinTrace.remaining.length, 5);
  const names = result.verdicts.flatMap((verdict) =>
    verdict.violations.map((item) => item.name)
  );
  assertEquals(names.includes("envelope-axis-x-exceeds-build-volume"), true);
  assertEquals(names.includes("min-thickness-below-declared-limit"), true);
  assertEquals(names.includes("overhang-zone-0-requires-support"), true);
  assertEquals(
    result.verdicts.find((item) => item.check === "overhangs")?.violations.length,
    5,
  );
});

Deno.test("the live qualification envelope and thickness pass after the declared Z-min filter", () => {
  const dfmCase = validateDfmCheckCase(validCaseInput());
  const result = evaluateMeasuredDfmChecks({
    dfmCase,
    envelope: {
      measured: { x_mm: 190, y_mm: 135, z_mm: 18 },
      providerViolations: [],
    },
    thickness: {
      minThicknessMm: 5.999999999999998,
      providerViolationCount: 0,
    },
    overhangs: { zones: LIVE_OVERHANG_ZONES },
  });
  assertEquals(
    result.verdicts.find((item) => item.check === "envelope")?.status,
    "pass",
  );
  assertEquals(
    result.verdicts.find((item) => item.check === "min-thickness")?.status,
    "pass",
  );
  assertEquals(
    result.verdicts.find((item) => item.check === "overhangs")?.status,
    "fail",
  );
  assertEquals(result.status, "fail");
});

Deno.test(
  "the documentary printability-check-case/1.0 schema stays distinct from dfm-check-case/1.0",
  () => {
    const printability = validatePrintabilityCheckCase({
      schemaVersion: "printability-check-case/1.0",
      id: "generic-product-v1-support-bracket-fdm-v1",
      revision: 2,
      scope: "FDM printability check for the isolated support bracket.",
      evidenceBoundary: "Observations only; not a verdict or certification.",
      project: {
        id: "generic-product-v1",
        subjectId: "project:generic-product-v1",
      },
      target: { componentKey: "support-bracket" },
      thresholds: {
        minWallThicknessMm: { value: 1.2, unit: "mm" },
        maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
        maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
      },
      meshSizeMm: { value: 2.0, unit: "mm" },
      buildDirection: [0, 0, 1],
      provider: {
        build123dTool: "build123d_export",
        thicknessTool: "dfm_check_min_thickness",
        overhangTool: "dfm_check_overhangs",
      },
      limitations: [
        "Thresholds are provisional FDM candidate values, not confirmed manufacturer data.",
        "This check covers only min wall thickness and max overhang angle.",
      ],
      provenance: {
        status: "provisional",
        note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
      },
    });
    assertEquals(printability.schemaVersion, "printability-check-case/1.0");
    assertEquals(DFM_CHECK_CASE_SCHEMA, "dfm-check-case/1.0");
    assertThrows(
      () => validateDfmCheckCase(printability),
      TypeError,
      "unsupported field",
    );
  },
);
