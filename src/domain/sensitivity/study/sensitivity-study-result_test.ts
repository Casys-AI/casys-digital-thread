import { assertEquals, assertRejects } from "@std/assert";
import { reconstructSensitivityEdgesFromStudyCapture } from "../edges/sensitivity-edge-from-study.ts";
import { computeSensitivities } from "./sensitivity-study.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "./sensitivity-study-template.ts";
import {
  makeSensitivityStudyReuseResult,
  validateSensitivityStudyReuseResult,
} from "./sensitivity-study-result.ts";

const AT = "2026-08-23T00:00:00.000Z";

Deno.test("exact reuse publishes only validated target scientific facts, never synthetic CAD", async () => {
  const studyCase = assembleSensitivityStudyCaseV2(
    validateSensitivityStudyCaseTemplate(JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    )),
    {
      artifactUri: `thread-artifact://target/admission-${"a".repeat(64)}`,
      sha256: "a".repeat(64),
    },
  );
  const base = [
    { metric: "assembly_max_displacement", value: 2, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 3, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 12, unit: "MPa" },
  ];
  const derivatives = computeSensitivities(
    studyCase,
    new Map(base.map((item) => [item.metric, item])),
    new Map(stepped.map((item) => [item.metric, item])),
  );
  const result = await makeSensitivityStudyReuseResult({
    trustedRunId: "target-run",
    studyCase,
    record: { result: { measurements: { base, stepped }, derivatives } } as never,
    reuseReceiptFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
    },
    capturedAt: AT,
  });

  assertEquals("cad" in result, false);
  assertEquals(JSON.stringify(result).includes("source-run"), false);
  assertEquals(reconstructSensitivityEdgesFromStudyCapture(result).length, 2);
  await assertRejects(
    () =>
      validateSensitivityStudyReuseResult({
        ...result,
        caseDigest: "c".repeat(64),
      }),
    TypeError,
  );
});
