import { assertEquals, assertThrows } from "@std/assert";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  encodeAdmittedObservationEvaluationCloseoutAdmission,
  parseAcceptAdmittedModelicaEvaluationParameters,
  parseRejectAdmittedModelicaEvaluationParameters,
} from "./admitted-observation-evaluation-closeout-proposal.ts";

const digest = "b".repeat(64);
const captureDigest = "d".repeat(64);

function validAdmission(consequence: "accept" | "reject") {
  return {
    schemaVersion: "modelica-admitted-observation-evaluation-closeout/1.0" as const,
    consequence,
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
    capture: {
      id: `modelica-admitted-observation-evaluation-${captureDigest}`,
      fingerprint: { algorithm: "sha256" as const, digest: captureDigest },
    },
  };
}

Deno.test(
  "admitted Modelica evaluation closeout MRTR round-trips without values or provider args",
  () => {
    const admission = validAdmission("accept");
    const parameters = encodeAdmittedObservationEvaluationCloseoutAdmission(
      admission,
    );
    assertEquals(
      `${DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id}@${DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.version}`,
      "decide.accept-admitted-modelica-evaluation@1",
    );
    assertEquals(
      `${DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.id}@${DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.version}`,
      "decide.reject-admitted-modelica-evaluation@1",
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
    const parsed = parseAcceptAdmittedModelicaEvaluationParameters(parameters);
    assertEquals(parsed, admission);
    assertEquals(
      parseAcceptAdmittedModelicaEvaluationParameters(parameters),
      parsed,
    );
  },
);

Deno.test(
  "admitted Modelica evaluation closeout MRTR refuses a caller value parameter",
  () => {
    const parameters = [
      ...encodeAdmittedObservationEvaluationCloseoutAdmission(
        validAdmission("accept"),
      ),
      { key: "thermal.evaluation.closeout.value", label: "Value", value: 42 },
    ];
    assertThrows(
      () => parseAcceptAdmittedModelicaEvaluationParameters(parameters),
      TypeError,
      "exactly",
    );
  },
);

Deno.test(
  "accept closeout refuses a reject consequence and reject refuses accept",
  () => {
    const acceptParameters = encodeAdmittedObservationEvaluationCloseoutAdmission(
      validAdmission("accept"),
    );
    const rejectParameters = encodeAdmittedObservationEvaluationCloseoutAdmission(
      validAdmission("reject"),
    );
    assertThrows(
      () => parseRejectAdmittedModelicaEvaluationParameters(acceptParameters),
      TypeError,
      '"reject"',
    );
    assertThrows(
      () => parseAcceptAdmittedModelicaEvaluationParameters(rejectParameters),
      TypeError,
      '"accept"',
    );
    assertEquals(
      parseRejectAdmittedModelicaEvaluationParameters(rejectParameters)
        .consequence,
      "reject",
    );
  },
);
