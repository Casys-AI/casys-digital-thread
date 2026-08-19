import { assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  DFM_CHECK_CASE_SCHEMA,
  validateDfmCheckCase,
} from "../../../domain/make/dfm/dfm-case.ts";
import { DFM_CASE_CAPTURE_SCHEMA, validateDfmCaseCapture } from "./dfm-case-capture.ts";

const LIVE_STEP_SHA256 =
  "9273149a5203a13ef3b14f7e70062e76ee106eaaf5ba474e98e1cd9116cdc270";

function validCaseInput() {
  return {
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id: "generic-product-v1-support-bracket-dfm-v1",
    revision: 1,
    scope: "Measured DFM checks for the isolated support bracket.",
    evidenceBoundary: "Measured provider verdicts against the sealed case.",
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
    ],
    provenance: {
      status: "provisional",
      note: "Limits copied from the archived mcp-dfm qualification call.",
    },
  };
}

Deno.test("the DFM case capture reread accepts an exact sealed record", async () => {
  const dfmCase = validateDfmCheckCase(validCaseInput());
  const caseDigest = (await sha256Fingerprint(dfmCase)).digest;
  const capture = await validateDfmCaseCapture({
    schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
    operation: { id: "industrialize.seal-dfm-case", version: "1" },
    trustedRunId: "run.seal-dfm-case",
    caseDigest,
    canonicalCaseText: deterministicJson(dfmCase),
    dfmCase,
    sealedAt: "2026-08-15T00:00:00.000Z",
  });
  assertEquals(capture.dfmCase.target.sha256, LIVE_STEP_SHA256);
  assertEquals(capture.operation.id, "industrialize.seal-dfm-case");
});

Deno.test("the DFM case capture refuses a digest that does not match the case", async () => {
  const dfmCase = validateDfmCheckCase(validCaseInput());
  await assertRejects(
    () =>
      validateDfmCaseCapture({
        schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
        operation: { id: "industrialize.seal-dfm-case", version: "1" },
        trustedRunId: "run.seal-dfm-case",
        caseDigest: "0".repeat(64),
        canonicalCaseText: deterministicJson(dfmCase),
        dfmCase,
        sealedAt: "2026-08-15T00:00:00.000Z",
      }),
    TypeError,
    "caseDigest",
  );
});

Deno.test("the DFM case capture refuses an extra field", async () => {
  const dfmCase = validateDfmCheckCase(validCaseInput());
  const caseDigest = (await sha256Fingerprint(dfmCase)).digest;
  await assertRejects(
    () =>
      validateDfmCaseCapture({
        schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
        operation: { id: "industrialize.seal-dfm-case", version: "1" },
        trustedRunId: "run.seal-dfm-case",
        caseDigest,
        canonicalCaseText: deterministicJson(dfmCase),
        dfmCase,
        sealedAt: "2026-08-15T00:00:00.000Z",
        extra: true,
      }),
    TypeError,
    "extra",
  );
});
