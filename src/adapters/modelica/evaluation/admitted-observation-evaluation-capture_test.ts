import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";

function validCapture(): Record<string, unknown> {
  return {
    schemaVersion: "modelica-admitted-observation-evaluation-capture/1.0",
    kind: "modelica-admitted-observation-evaluation",
    operation: {
      id: "verify.evaluate-admitted-modelica-observations",
      version: "1",
    },
    request: {
      name: "syson_constraint_evaluate",
      arguments: { constraints: [], values: {} },
    },
    response: { structuredContent: { results: [] } },
    unresolved: [{
      requirementElementId: "placeholder-requirement",
      reason: "unit-identity-mismatch",
    }],
  };
}

Deno.test("admitted observation evaluation capture is canonical and SysON-named", () => {
  const capture = validateAdmittedObservationEvaluationCapture(validCapture());
  assertEquals(capture.request.name, "syson_constraint_evaluate");
  assertEquals(
    canonicalAdmittedObservationEvaluationCaptureText(capture),
    canonicalAdmittedObservationEvaluationCaptureText(
      validateAdmittedObservationEvaluationCapture(JSON.parse(
        canonicalAdmittedObservationEvaluationCaptureText(capture),
      )),
    ),
  );
});

Deno.test("admitted observation evaluation capture refuses a provider envelope", () => {
  const input = validCapture();
  input.provider = "syson";
  assertThrows(
    () => validateAdmittedObservationEvaluationCapture(input),
    TypeError,
    "unsupported field",
  );
});
