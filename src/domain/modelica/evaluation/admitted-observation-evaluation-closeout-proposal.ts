/**
 * Closed MRTR grammar for human L5 closeout of one L4 admitted Modelica
 * evaluation capture.
 *
 * `decide.accept-admitted-modelica-evaluation@1` and
 * `decide.reject-admitted-modelica-evaluation@1` name identities only. They
 * grant no OMC, SysON, observation values, or implicit L5 from an L4 `pass`.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
} from "../../project/engineering-project.ts";

export const DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION = {
  id: "decide.accept-admitted-modelica-evaluation",
  version: "1",
} as const;

export const DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION = {
  id: "decide.reject-admitted-modelica-evaluation",
  version: "1",
} as const;

export const MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA =
  "modelica-admitted-observation-evaluation-closeout/1.0" as const;

export type AdmittedObservationEvaluationCloseoutConsequence =
  | "accept"
  | "reject";

export type AdmittedObservationEvaluationCloseoutOperation =
  | typeof DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION;

export interface AdmittedObservationEvaluationCloseoutAdmission {
  readonly schemaVersion:
    typeof MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA;
  readonly consequence: AdmittedObservationEvaluationCloseoutConsequence;
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly sheet: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly capture: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const PARAMETER_KEYS = [
  "thermal.evaluation.closeout.schemaVersion",
  "thermal.evaluation.closeout.consequence",
  "thermal.evaluation.closeout.project.id",
  "thermal.evaluation.closeout.subject.id",
  "thermal.evaluation.closeout.basis.snapshotId",
  "thermal.evaluation.closeout.basis.revision",
  "thermal.evaluation.closeout.basis.fingerprint.digest",
  "thermal.evaluation.closeout.sheet.id",
  "thermal.evaluation.closeout.sheet.fingerprint.digest",
  "thermal.evaluation.closeout.capture.id",
  "thermal.evaluation.closeout.capture.fingerprint.digest",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "thermal.evaluation.closeout.schemaVersion":
    "Admitted observation evaluation closeout schema",
  "thermal.evaluation.closeout.consequence": "Declared L5 consequence",
  "thermal.evaluation.closeout.project.id": "Project",
  "thermal.evaluation.closeout.subject.id": "Subject",
  "thermal.evaluation.closeout.basis.snapshotId": "Thread snapshot",
  "thermal.evaluation.closeout.basis.revision": "Thread revision",
  "thermal.evaluation.closeout.basis.fingerprint.digest": "Thread fingerprint",
  "thermal.evaluation.closeout.sheet.id": "Thermal method sheet",
  "thermal.evaluation.closeout.sheet.fingerprint.digest":
    "Thermal method sheet fingerprint",
  "thermal.evaluation.closeout.capture.id": "L4 evaluation capture",
  "thermal.evaluation.closeout.capture.fingerprint.digest":
    "L4 evaluation capture fingerprint",
};

export function admittedModelicaEvaluationCloseoutWorkItemOperation(
  consequence: AdmittedObservationEvaluationCloseoutConsequence,
): EngineeringOperationRef {
  const operation = operationFor(consequence);
  return {
    id: operation.id,
    version: operation.version,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
}

export function encodeAdmittedObservationEvaluationCloseoutAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateAdmittedObservationEvaluationCloseoutAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseAcceptAdmittedModelicaEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): AdmittedObservationEvaluationCloseoutAdmission {
  return parseCloseoutParameters(
    parameters,
    DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  );
}

export function parseRejectAdmittedModelicaEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): AdmittedObservationEvaluationCloseoutAdmission {
  return parseCloseoutParameters(
    parameters,
    DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  );
}

export function parseAdmittedObservationEvaluationCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: AdmittedObservationEvaluationCloseoutOperation,
): AdmittedObservationEvaluationCloseoutAdmission {
  return parseCloseoutParameters(parameters, operation);
}

function parseCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: AdmittedObservationEvaluationCloseoutOperation,
): AdmittedObservationEvaluationCloseoutAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Admitted observation evaluation closeout proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Admitted observation evaluation closeout parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  const admission = validateAdmittedObservationEvaluationCloseoutAdmission({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    consequence: values.get("thermal.evaluation.closeout.consequence"),
    projectId: values.get("thermal.evaluation.closeout.project.id"),
    subjectId: values.get("thermal.evaluation.closeout.subject.id"),
    basis: {
      snapshotId: values.get("thermal.evaluation.closeout.basis.snapshotId"),
      revision: integerValue(
        values.get("thermal.evaluation.closeout.basis.revision"),
        "thermal.evaluation.closeout.basis.revision",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "thermal.evaluation.closeout.basis.fingerprint.digest",
        ),
      },
    },
    sheet: {
      id: values.get("thermal.evaluation.closeout.sheet.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "thermal.evaluation.closeout.sheet.fingerprint.digest",
        ),
      },
    },
    capture: {
      id: values.get("thermal.evaluation.closeout.capture.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "thermal.evaluation.closeout.capture.fingerprint.digest",
        ),
      },
    },
  });
  const expectedConsequence = consequenceFor(operation);
  if (admission.consequence !== expectedConsequence) {
    throw new TypeError(
      `Admitted observation evaluation closeout consequence must be "${expectedConsequence}" for ${operation.id}@${operation.version}.`,
    );
  }
  return admission;
}

export function validateAdmittedObservationEvaluationCloseoutAdmission(
  value: unknown,
): AdmittedObservationEvaluationCloseoutAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "consequence",
      "projectId",
      "subjectId",
      "basis",
      "sheet",
      "capture",
    ],
    "$admittedObservationEvaluationCloseout",
  );
  literalValue(
    root.schemaVersion,
    MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    "$admittedObservationEvaluationCloseout.schemaVersion",
  );
  if (root.consequence !== "accept" && root.consequence !== "reject") {
    throw new TypeError(
      '$admittedObservationEvaluationCloseout.consequence must be "accept" or "reject".',
    );
  }
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$admittedObservationEvaluationCloseout.basis",
  );
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint"],
    "$admittedObservationEvaluationCloseout.sheet",
  );
  const capture = exactRecord(
    root.capture,
    ["id", "fingerprint"],
    "$admittedObservationEvaluationCloseout.capture",
  );
  const captureFingerprint = parseFingerprint(
    capture.fingerprint,
    "$admittedObservationEvaluationCloseout.capture.fingerprint",
  );
  const captureId = safeId(
    capture.id,
    "$admittedObservationEvaluationCloseout.capture.id",
  );
  if (
    captureId !==
      `modelica-admitted-observation-evaluation-${captureFingerprint.digest}`
  ) {
    throw new TypeError(
      "$admittedObservationEvaluationCloseout.capture.id must derive from its digest.",
    );
  }
  return deepFreeze({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    consequence: root.consequence,
    projectId: safeId(
      root.projectId,
      "$admittedObservationEvaluationCloseout.projectId",
    ),
    subjectId: safeId(
      root.subjectId,
      "$admittedObservationEvaluationCloseout.subjectId",
    ),
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$admittedObservationEvaluationCloseout.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$admittedObservationEvaluationCloseout.basis.revision",
      ),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$admittedObservationEvaluationCloseout.basis.fingerprint",
      ),
    },
    sheet: {
      id: safeId(sheet.id, "$admittedObservationEvaluationCloseout.sheet.id"),
      fingerprint: parseFingerprint(
        sheet.fingerprint,
        "$admittedObservationEvaluationCloseout.sheet.fingerprint",
      ),
    },
    capture: {
      id: captureId,
      fingerprint: captureFingerprint,
    },
  });
}

function operationFor(
  consequence: AdmittedObservationEvaluationCloseoutConsequence,
): AdmittedObservationEvaluationCloseoutOperation {
  return consequence === "accept"
    ? DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION
    : DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION;
}

function consequenceFor(
  operation: AdmittedObservationEvaluationCloseoutOperation,
): AdmittedObservationEvaluationCloseoutConsequence {
  return operation.id === DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id
    ? "accept"
    : "reject";
}

function parameterValue(
  admission: AdmittedObservationEvaluationCloseoutAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "thermal.evaluation.closeout.schemaVersion":
      return admission.schemaVersion;
    case "thermal.evaluation.closeout.consequence":
      return admission.consequence;
    case "thermal.evaluation.closeout.project.id":
      return admission.projectId;
    case "thermal.evaluation.closeout.subject.id":
      return admission.subjectId;
    case "thermal.evaluation.closeout.basis.snapshotId":
      return admission.basis.snapshotId;
    case "thermal.evaluation.closeout.basis.revision":
      return admission.basis.revision;
    case "thermal.evaluation.closeout.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "thermal.evaluation.closeout.sheet.id":
      return admission.sheet.id;
    case "thermal.evaluation.closeout.sheet.fingerprint.digest":
      return admission.sheet.fingerprint.digest;
    case "thermal.evaluation.closeout.capture.id":
      return admission.capture.id;
    case "thermal.evaluation.closeout.capture.fingerprint.digest":
      return admission.capture.fingerprint.digest;
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof input.digest === "string" ? input.digest : "";
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}

function integerValue(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  throw new TypeError(`${path} must be an integer.`);
}
