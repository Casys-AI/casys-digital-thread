import { assertEquals, assertRejects } from "@std/assert";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "./sensitivity-study-template.ts";
import { computeSensitivities } from "./sensitivity-study.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  validateSensitivityStudyCapture,
} from "./sensitivity-study-capture.ts";

const AT = "2026-08-14T00:00:00.000Z";

Deno.test("sensitivity study capture rejects extra STEP bytes on a CAD slot", async () => {
  const capture = await validCapture();
  await assertRejects(
    () =>
      validateSensitivityStudyCapture({
        ...capture,
        cad: {
          ...capture.cad,
          base: { ...capture.cad.base, bytes: [83, 84, 69, 80] },
        },
      }),
    TypeError,
    "unsupported field bytes",
  );
});

Deno.test("sensitivity study capture rejects invented derivatives", async () => {
  const capture = await validCapture();
  const forged = {
    ...capture,
    derivatives: {
      ...capture.derivatives,
      derivatives: capture.derivatives.derivatives.map((item) => ({
        ...item,
        value: item.value + 1,
      })),
    },
  };
  await assertRejects(
    () => validateSensitivityStudyCapture(forged),
    TypeError,
    "do not match the sealed case",
  );
});

Deno.test("sensitivity study capture accepts the exact sealed envelope", async () => {
  const capture = await validCapture();
  const validated = await validateSensitivityStudyCapture(capture);
  assertEquals(validated.schemaVersion, SENSITIVITY_STUDY_CAPTURE_SCHEMA);
  assertEquals("bytes" in validated.cad.base, false);
});

async function validCapture() {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: "thread-artifact://desk-lamp-dl04/admission",
    sha256: "a".repeat(64),
  });
  const base = [
    { metric: "assembly_max_displacement", value: 0.5, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 1.5, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 8, unit: "MPa" },
  ];
  return {
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run.sensitivity",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "run.sensitivity:cad-base",
        sourceSha256: "1".repeat(64),
        stepSha256: "2".repeat(64),
        stepBytes: 4,
      },
      stepped: {
        executionRunId: "run.sensitivity:cad-stepped",
        sourceSha256: "3".repeat(64),
        stepSha256: "4".repeat(64),
        stepBytes: 4,
      },
    },
    measurements: { base, stepped },
    derivatives: computeSensitivities(
      studyCase,
      new Map(base.map((item) => [item.metric, item])),
      new Map(stepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  };
}
