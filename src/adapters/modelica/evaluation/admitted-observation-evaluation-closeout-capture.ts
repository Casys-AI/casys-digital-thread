/**
 * Replayable envelope for one human L5 closeout of an L4 admitted Modelica
 * observation evaluation. This capture is not an engine dispatch and does not
 * upgrade an L4 `pass` into L5.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  type AdmittedObservationEvaluationCloseoutAdmission,
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
  validateAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";

export const ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA =
  MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA;

export { ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX };

export const ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS = {
  engineCalls: "none",
  l4PassIsNotL5: true,
} as const;

export type AdmittedObservationEvaluationCloseoutCaptureOperation =
  | typeof DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION;

export interface AdmittedObservationEvaluationCloseoutCapture {
  readonly schemaVersion:
    typeof ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA;
  readonly kind: "modelica-admitted-observation-evaluation-closeout";
  readonly operation: {
    readonly id: AdmittedObservationEvaluationCloseoutCaptureOperation["id"];
    readonly version: AdmittedObservationEvaluationCloseoutCaptureOperation["version"];
  };
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: AdmittedObservationEvaluationCloseoutAdmission;
  readonly evaluationCapture: {
    readonly id: string;
    readonly fingerprint: AdmittedObservationEvaluationCloseoutAdmission[
      "capture"
    ]["fingerprint"];
    readonly uri: string;
  };
  readonly sheet: AdmittedObservationEvaluationCloseoutAdmission["sheet"];
  readonly limits: typeof ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS;
}

export function validateAdmittedObservationEvaluationCloseoutCapture(
  value: unknown,
  path = "$admittedObservationEvaluationCloseoutCapture",
): AdmittedObservationEvaluationCloseoutCapture {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "operation",
      "trustedRunId",
      "decisionId",
      "sealedAt",
      "admission",
      "evaluationCapture",
      "sheet",
      "limits",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    "modelica-admitted-observation-evaluation-closeout",
    `${path}.kind`,
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    `${path}.operation`,
  );
  if (
    operation.id !== DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id &&
    operation.id !== DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.id
  ) {
    throw new TypeError(
      `${path}.operation.id must be a registered L5 closeout operation.`,
    );
  }
  literalValue(operation.version, "1", `${path}.operation.version`);
  const admission = validateAdmittedObservationEvaluationCloseoutAdmission(
    root.admission,
  );
  const expectedConsequence =
    operation.id === DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id
      ? "accept"
      : "reject";
  if (admission.consequence !== expectedConsequence) {
    throw new TypeError(
      `${path}.admission.consequence must match ${operation.id}.`,
    );
  }
  const evaluationCapture = exactRecord(
    root.evaluationCapture,
    ["id", "fingerprint", "uri"],
    `${path}.evaluationCapture`,
  );
  const evaluationCaptureId = safeId(
    evaluationCapture.id,
    `${path}.evaluationCapture.id`,
  );
  if (evaluationCaptureId !== admission.capture.id) {
    throw new TypeError(
      `${path}.evaluationCapture.id must equal the signed L4 capture id.`,
    );
  }
  const evaluationFingerprint = admission.capture.fingerprint;
  const fingerprint = exactRecord(
    evaluationCapture.fingerprint,
    ["algorithm", "digest"],
    `${path}.evaluationCapture.fingerprint`,
  );
  literalValue(
    fingerprint.algorithm,
    evaluationFingerprint.algorithm,
    `${path}.evaluationCapture.fingerprint.algorithm`,
  );
  literalValue(
    fingerprint.digest,
    evaluationFingerprint.digest,
    `${path}.evaluationCapture.fingerprint.digest`,
  );
  const expectedUri =
    `${ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${evaluationFingerprint.digest}`;
  const uri = typeof evaluationCapture.uri === "string" ? evaluationCapture.uri : "";
  if (uri !== expectedUri) {
    throw new TypeError(
      `${path}.evaluationCapture.uri must be the content-addressed L4 capture URI.`,
    );
  }
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint"],
    `${path}.sheet`,
  );
  literalValue(sheet.id, admission.sheet.id, `${path}.sheet.id`);
  const sheetFingerprint = exactRecord(
    sheet.fingerprint,
    ["algorithm", "digest"],
    `${path}.sheet.fingerprint`,
  );
  literalValue(
    sheetFingerprint.algorithm,
    admission.sheet.fingerprint.algorithm,
    `${path}.sheet.fingerprint.algorithm`,
  );
  literalValue(
    sheetFingerprint.digest,
    admission.sheet.fingerprint.digest,
    `${path}.sheet.fingerprint.digest`,
  );
  const limits = exactRecord(
    root.limits,
    ["engineCalls", "l4PassIsNotL5"],
    `${path}.limits`,
  );
  literalValue(limits.engineCalls, "none", `${path}.limits.engineCalls`);
  literalValue(limits.l4PassIsNotL5, true, `${path}.limits.l4PassIsNotL5`);
  return deepFreeze({
    schemaVersion: ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    kind: "modelica-admitted-observation-evaluation-closeout",
    operation: {
      id: operation.id,
      version: "1",
    },
    trustedRunId: safeId(root.trustedRunId, `${path}.trustedRunId`),
    decisionId: safeId(root.decisionId, `${path}.decisionId`),
    sealedAt: requireIsoDateTime(root.sealedAt, `${path}.sealedAt`),
    admission,
    evaluationCapture: {
      id: evaluationCaptureId,
      fingerprint: evaluationFingerprint,
      uri,
    },
    sheet: admission.sheet,
    limits: ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
  });
}

export function canonicalAdmittedObservationEvaluationCloseoutCaptureText(
  value: AdmittedObservationEvaluationCloseoutCapture,
): string {
  return deterministicJson(
    validateAdmittedObservationEvaluationCloseoutCapture(value),
  );
}

function requireIsoDateTime(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO-8601 timestamp.`);
  }
  return value;
}
