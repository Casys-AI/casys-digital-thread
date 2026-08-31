/**
 * Closed MRTR grammar for human L5 closeout of one L4 admitted SPICE
 * evaluation capture.
 *
 * `decide.accept-admitted-spice-evaluation@1` and
 * `decide.reject-admitted-spice-evaluation@1` name identities only. They
 * grant no ngspice, SysON, observation values, or implicit L5 from an L4
 * `pass`.
 */

import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../kernel/case-validation.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
} from "../../../project/engineering-project.ts";

export const DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION = {
  id: "decide.accept-admitted-spice-evaluation",
  version: "1",
} as const;

export const DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION = {
  id: "decide.reject-admitted-spice-evaluation",
  version: "1",
} as const;

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA =
  "spice-admitted-observation-evaluation-closeout/1.0" as const;

export type SpiceAdmittedObservationEvaluationCloseoutConsequence =
  | "accept"
  | "reject";

export type SpiceAdmittedObservationEvaluationCloseoutOperation =
  | typeof DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION;

export interface SpiceAdmittedObservationEvaluationCloseoutAdmission {
  readonly schemaVersion: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA;
  readonly consequence: SpiceAdmittedObservationEvaluationCloseoutConsequence;
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
  "electrical.evaluation.closeout.schemaVersion",
  "electrical.evaluation.closeout.consequence",
  "electrical.evaluation.closeout.project.id",
  "electrical.evaluation.closeout.subject.id",
  "electrical.evaluation.closeout.basis.snapshotId",
  "electrical.evaluation.closeout.basis.revision",
  "electrical.evaluation.closeout.basis.fingerprint.digest",
  "electrical.evaluation.closeout.sheet.id",
  "electrical.evaluation.closeout.sheet.fingerprint.digest",
  "electrical.evaluation.closeout.capture.id",
  "electrical.evaluation.closeout.capture.fingerprint.digest",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "electrical.evaluation.closeout.schemaVersion":
    "Admitted SPICE observation evaluation closeout schema",
  "electrical.evaluation.closeout.consequence": "Declared L5 consequence",
  "electrical.evaluation.closeout.project.id": "Project",
  "electrical.evaluation.closeout.subject.id": "Subject",
  "electrical.evaluation.closeout.basis.snapshotId": "Thread snapshot",
  "electrical.evaluation.closeout.basis.revision": "Thread revision",
  "electrical.evaluation.closeout.basis.fingerprint.digest": "Thread fingerprint",
  "electrical.evaluation.closeout.sheet.id": "Electrical observation method sheet",
  "electrical.evaluation.closeout.sheet.fingerprint.digest":
    "Electrical observation method sheet fingerprint",
  "electrical.evaluation.closeout.capture.id": "L4 evaluation capture",
  "electrical.evaluation.closeout.capture.fingerprint.digest":
    "L4 evaluation capture fingerprint",
};

export function admittedSpiceEvaluationCloseoutWorkItemOperation(
  consequence: SpiceAdmittedObservationEvaluationCloseoutConsequence,
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

export function encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateSpiceAdmittedObservationEvaluationCloseoutAdmission(
    value,
  );
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseAcceptAdmittedSpiceEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
  return parseCloseoutParameters(
    parameters,
    DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  );
}

export function parseRejectAdmittedSpiceEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
  return parseCloseoutParameters(
    parameters,
    DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  );
}

export function parseSpiceAdmittedObservationEvaluationCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
  return parseCloseoutParameters(parameters, operation);
}

function parseCloseoutParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Admitted SPICE observation evaluation closeout proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Admitted SPICE observation evaluation closeout parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  const admission = validateSpiceAdmittedObservationEvaluationCloseoutAdmission({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    consequence: values.get("electrical.evaluation.closeout.consequence"),
    projectId: values.get("electrical.evaluation.closeout.project.id"),
    subjectId: values.get("electrical.evaluation.closeout.subject.id"),
    basis: {
      snapshotId: values.get("electrical.evaluation.closeout.basis.snapshotId"),
      revision: integerValue(
        values.get("electrical.evaluation.closeout.basis.revision"),
        "electrical.evaluation.closeout.basis.revision",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "electrical.evaluation.closeout.basis.fingerprint.digest",
        ),
      },
    },
    sheet: {
      id: values.get("electrical.evaluation.closeout.sheet.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "electrical.evaluation.closeout.sheet.fingerprint.digest",
        ),
      },
    },
    capture: {
      id: values.get("electrical.evaluation.closeout.capture.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "electrical.evaluation.closeout.capture.fingerprint.digest",
        ),
      },
    },
  });
  const expectedConsequence = consequenceFor(operation);
  if (admission.consequence !== expectedConsequence) {
    throw new TypeError(
      `Admitted SPICE observation evaluation closeout consequence must be "${expectedConsequence}" for ${operation.id}@${operation.version}.`,
    );
  }
  return admission;
}

export function validateSpiceAdmittedObservationEvaluationCloseoutAdmission(
  value: unknown,
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
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
    "$spiceAdmittedObservationEvaluationCloseout",
  );
  literalValue(
    root.schemaVersion,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    "$spiceAdmittedObservationEvaluationCloseout.schemaVersion",
  );
  if (root.consequence !== "accept" && root.consequence !== "reject") {
    throw new TypeError(
      '$spiceAdmittedObservationEvaluationCloseout.consequence must be "accept" or "reject".',
    );
  }
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$spiceAdmittedObservationEvaluationCloseout.basis",
  );
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint"],
    "$spiceAdmittedObservationEvaluationCloseout.sheet",
  );
  const capture = exactRecord(
    root.capture,
    ["id", "fingerprint"],
    "$spiceAdmittedObservationEvaluationCloseout.capture",
  );
  const captureFingerprint = parseFingerprint(
    capture.fingerprint,
    "$spiceAdmittedObservationEvaluationCloseout.capture.fingerprint",
  );
  const captureId = safeId(
    capture.id,
    "$spiceAdmittedObservationEvaluationCloseout.capture.id",
  );
  if (
    captureId !==
      `spice-admitted-observation-evaluation-${captureFingerprint.digest}`
  ) {
    throw new TypeError(
      "$spiceAdmittedObservationEvaluationCloseout.capture.id must derive from its digest.",
    );
  }
  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    consequence: root.consequence,
    projectId: safeId(
      root.projectId,
      "$spiceAdmittedObservationEvaluationCloseout.projectId",
    ),
    subjectId: safeId(
      root.subjectId,
      "$spiceAdmittedObservationEvaluationCloseout.subjectId",
    ),
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$spiceAdmittedObservationEvaluationCloseout.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$spiceAdmittedObservationEvaluationCloseout.basis.revision",
      ),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$spiceAdmittedObservationEvaluationCloseout.basis.fingerprint",
      ),
    },
    sheet: {
      id: safeId(sheet.id, "$spiceAdmittedObservationEvaluationCloseout.sheet.id"),
      fingerprint: parseFingerprint(
        sheet.fingerprint,
        "$spiceAdmittedObservationEvaluationCloseout.sheet.fingerprint",
      ),
    },
    capture: {
      id: captureId,
      fingerprint: captureFingerprint,
    },
  });
}

function operationFor(
  consequence: SpiceAdmittedObservationEvaluationCloseoutConsequence,
): SpiceAdmittedObservationEvaluationCloseoutOperation {
  return consequence === "accept"
    ? DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION
    : DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION;
}

function consequenceFor(
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
): SpiceAdmittedObservationEvaluationCloseoutConsequence {
  return operation.id === DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.id
    ? "accept"
    : "reject";
}

function parameterValue(
  admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "electrical.evaluation.closeout.schemaVersion":
      return admission.schemaVersion;
    case "electrical.evaluation.closeout.consequence":
      return admission.consequence;
    case "electrical.evaluation.closeout.project.id":
      return admission.projectId;
    case "electrical.evaluation.closeout.subject.id":
      return admission.subjectId;
    case "electrical.evaluation.closeout.basis.snapshotId":
      return admission.basis.snapshotId;
    case "electrical.evaluation.closeout.basis.revision":
      return admission.basis.revision;
    case "electrical.evaluation.closeout.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "electrical.evaluation.closeout.sheet.id":
      return admission.sheet.id;
    case "electrical.evaluation.closeout.sheet.fingerprint.digest":
      return admission.sheet.fingerprint.digest;
    case "electrical.evaluation.closeout.capture.id":
      return admission.capture.id;
    case "electrical.evaluation.closeout.capture.fingerprint.digest":
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
