import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeAdmittedObservationEvaluationAdmission,
  parseAdmittedObservationEvaluationParameters,
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
} from "./admitted-observation-evaluation-proposal.ts";

const digest = "b".repeat(64);
const evidenceDigest = "c".repeat(64);

function validAdmission() {
  return {
    schemaVersion: "modelica-admitted-observation-evaluation-admission/1.0" as const,
    methodSchemaVersion: "modelica-admitted-observation-evaluation-method/1.0" as const,
    projectId: "articulated-led-desk-lamp",
    subjectId: "articulated-led-desk-lamp",
    basis: {
      snapshotId: "placeholder-thread-snapshot",
      revision: 1,
      fingerprint: { algorithm: "sha256" as const, digest },
    },
    sheet: {
      id: "placeholder-thermal-method-sheet",
      fingerprint: { algorithm: "sha256" as const, digest },
    },
    evidence: {
      artifactId: `modelica-admitted-evidence-${evidenceDigest}`,
      fingerprint: { algorithm: "sha256" as const, digest: evidenceDigest },
    },
    methodFingerprint: { algorithm: "sha256" as const, digest },
    profileId: "admitted-modelica-observations-v1" as const,
    unitPolicy: {
      id: "admitted-modelica-unit-identity" as const,
      fingerprint: { algorithm: "sha256" as const, digest },
    },
  };
}

Deno.test(
  "admitted observation evaluation MRTR round-trips without values or provider args",
  () => {
    const admission = validAdmission();
    const parameters = encodeAdmittedObservationEvaluationAdmission(admission);
    assertEquals(
      `${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version}`,
      "verify.evaluate-admitted-modelica-observations@1",
    );
    assertEquals(
      parameters.map((parameter) => parameter.key).some((key) =>
        key.includes("feature") ||
        key.includes("provider") ||
        key.includes("args") ||
        key.endsWith(".value") ||
        key.endsWith(".limit") ||
        key.endsWith(".unit")
      ),
      false,
    );
    const parsed = parseAdmittedObservationEvaluationParameters(parameters);
    assertEquals(parsed, admission);
    assertEquals(
      parseAdmittedObservationEvaluationParameters(parameters),
      parsed,
    );
  },
);

Deno.test(
  "admitted observation evaluation MRTR refuses a caller value parameter",
  () => {
    const parameters = [
      ...encodeAdmittedObservationEvaluationAdmission(validAdmission()),
      { key: "thermal.evaluation.value", label: "Value", value: 42 },
    ];
    assertThrows(
      () => parseAdmittedObservationEvaluationParameters(parameters),
      TypeError,
      "exactly",
    );
  },
);
