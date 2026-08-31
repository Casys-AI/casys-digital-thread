/**
 * Replayable envelope for one human L5 closeout of an L4 admitted SPICE
 * observation evaluation. This capture is not an engine dispatch and does not
 * upgrade an L4 `pass` into L5.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
  type SpiceAdmittedObservationEvaluationCloseoutAdmission,
  validateSpiceAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
} from "../../../shared/cas/file-capture-store.ts";

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA =
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA;

export { SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX };

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS = {
  engineCalls: "none",
  l4PassIsNotL5: true,
} as const;

export type SpiceAdmittedObservationEvaluationCloseoutCaptureOperation =
  | typeof DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION;

export interface SpiceAdmittedObservationEvaluationCloseoutCapture {
  readonly schemaVersion:
    typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA;
  readonly kind: "spice-admitted-observation-evaluation-closeout";
  readonly operation: {
    readonly id: SpiceAdmittedObservationEvaluationCloseoutCaptureOperation["id"];
    readonly version:
      SpiceAdmittedObservationEvaluationCloseoutCaptureOperation["version"];
  };
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: SpiceAdmittedObservationEvaluationCloseoutAdmission;
  readonly evaluationCapture: {
    readonly id: string;
    readonly fingerprint: SpiceAdmittedObservationEvaluationCloseoutAdmission[
      "capture"
    ]["fingerprint"];
    readonly uri: string;
  };
  readonly sheet: SpiceAdmittedObservationEvaluationCloseoutAdmission["sheet"];
  readonly limits: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS;
}

export function validateSpiceAdmittedObservationEvaluationCloseoutCapture(
  value: unknown,
  path = "$spiceAdmittedObservationEvaluationCloseoutCapture",
): SpiceAdmittedObservationEvaluationCloseoutCapture {
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
    SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    "spice-admitted-observation-evaluation-closeout",
    `${path}.kind`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  if (
    operation.id !== DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.id &&
    operation.id !== DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION.id
  ) {
    throw new TypeError(
      `${path}.operation.id must be a registered L5 closeout operation.`,
    );
  }
  literalValue(operation.version, "1", `${path}.operation.version`);
  const admission = validateSpiceAdmittedObservationEvaluationCloseoutAdmission(
    root.admission,
  );
  const expectedConsequence =
    operation.id === DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.id
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
    `${SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${evaluationFingerprint.digest}`;
  const uri = typeof evaluationCapture.uri === "string" ? evaluationCapture.uri : "";
  if (uri !== expectedUri) {
    throw new TypeError(
      `${path}.evaluationCapture.uri must be the content-addressed L4 capture URI.`,
    );
  }
  const sheet = exactRecord(root.sheet, ["id", "fingerprint"], `${path}.sheet`);
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
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError(`${path}.sealedAt must be ISO-8601.`);
  }
  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    kind: "spice-admitted-observation-evaluation-closeout",
    operation: {
      id: operation.id as SpiceAdmittedObservationEvaluationCloseoutCaptureOperation[
        "id"
      ],
      version: "1",
    },
    trustedRunId: safeId(root.trustedRunId, `${path}.trustedRunId`),
    decisionId: safeId(root.decisionId, `${path}.decisionId`),
    sealedAt: root.sealedAt,
    admission,
    evaluationCapture: {
      id: evaluationCaptureId,
      fingerprint: evaluationFingerprint,
      uri: expectedUri,
    },
    sheet: admission.sheet,
    limits: SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
  });
}

export function canonicalSpiceAdmittedObservationEvaluationCloseoutCaptureText(
  value: SpiceAdmittedObservationEvaluationCloseoutCapture,
): string {
  return deterministicJson(
    validateSpiceAdmittedObservationEvaluationCloseoutCapture(value),
  );
}
