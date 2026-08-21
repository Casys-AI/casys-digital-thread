import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalAdmittedObservationEvaluationCloseoutCaptureText,
  validateAdmittedObservationEvaluationCloseoutCapture,
} from "./admitted-observation-evaluation-closeout-capture.ts";

const digest = "b".repeat(64);
const captureDigest = "d".repeat(64);

function validCapture(): Record<string, unknown> {
  return {
    schemaVersion: "modelica-admitted-observation-evaluation-closeout/1.0",
    kind: "modelica-admitted-observation-evaluation-closeout",
    operation: {
      id: "decide.accept-admitted-modelica-evaluation",
      version: "1",
    },
    trustedRunId: "run.closeout",
    decisionId: "decision.closeout",
    sealedAt: "2026-08-21T12:00:00.000Z",
    admission: {
      schemaVersion: "modelica-admitted-observation-evaluation-closeout/1.0",
      consequence: "accept",
      projectId: "articulated-led-desk-lamp",
      subjectId: "articulated-led-desk-lamp",
      basis: {
        snapshotId: "placeholder-thread-snapshot",
        revision: 1,
        fingerprint: { algorithm: "sha256", digest },
      },
      sheet: {
        id: "placeholder-thermal-method-sheet",
        fingerprint: { algorithm: "sha256", digest },
      },
      capture: {
        id: `modelica-admitted-observation-evaluation-${captureDigest}`,
        fingerprint: { algorithm: "sha256", digest: captureDigest },
      },
    },
    evaluationCapture: {
      id: `modelica-admitted-observation-evaluation-${captureDigest}`,
      fingerprint: { algorithm: "sha256", digest: captureDigest },
      uri:
        `casys://modelica-admitted-observation-evaluation-capture/sha256/${captureDigest}`,
    },
    sheet: {
      id: "placeholder-thermal-method-sheet",
      fingerprint: { algorithm: "sha256", digest },
    },
    limits: {
      engineCalls: "none",
      l4PassIsNotL5: true,
    },
  };
}

Deno.test("admitted Modelica evaluation closeout capture is canonical and engine-free", () => {
  const capture = validateAdmittedObservationEvaluationCloseoutCapture(
    validCapture(),
  );
  assertEquals(capture.limits.engineCalls, "none");
  assertEquals(capture.limits.l4PassIsNotL5, true);
  assertEquals(
    canonicalAdmittedObservationEvaluationCloseoutCaptureText(capture),
    canonicalAdmittedObservationEvaluationCloseoutCaptureText(
      validateAdmittedObservationEvaluationCloseoutCapture(JSON.parse(
        canonicalAdmittedObservationEvaluationCloseoutCaptureText(capture),
      )),
    ),
  );
});

Deno.test("admitted Modelica evaluation closeout capture refuses a provider envelope", () => {
  const input = validCapture();
  input.provider = "syson";
  assertThrows(
    () => validateAdmittedObservationEvaluationCloseoutCapture(input),
    TypeError,
    "unsupported field",
  );
});

Deno.test("admitted Modelica evaluation closeout capture refuses a non-L5 operation", () => {
  const input = validCapture();
  input.operation = {
    id: "verify.evaluate-admitted-modelica-observations",
    version: "1",
  };
  assertThrows(
    () => validateAdmittedObservationEvaluationCloseoutCapture(input),
    TypeError,
    "L5 closeout",
  );
});
