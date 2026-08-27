/**
 * Closed MRTR grammar for `verify.evaluate-admitted-spice-observations@1`.
 *
 * Signed parameters name identities and fingerprints only. They grant no
 * ngspice dispatch, no SysON envelope, no observation values, and no L4
 * verdict.
 */

import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../../project/engineering-project.ts";
import {
  ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
} from "./admitted-observation-evaluation.ts";

export const VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION = {
  id: "verify.evaluate-admitted-spice-observations",
  version: "1",
} as const;

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA =
  "spice-admitted-observation-evaluation-admission/1.0" as const;

export interface SpiceAdmittedObservationEvaluationAdmission {
  readonly schemaVersion: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA;
  readonly methodSchemaVersion:
    typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA;
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
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly evidence: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly result: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly methodFingerprint: ContentFingerprint;
  readonly profileId: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID;
  readonly unitAlgebra: {
    readonly id: typeof ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID;
    readonly fingerprint: ContentFingerprint;
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const PARAMETER_KEYS = [
  "electrical.evaluation.schemaVersion",
  "electrical.evaluation.project.id",
  "electrical.evaluation.subject.id",
  "electrical.evaluation.basis.snapshotId",
  "electrical.evaluation.basis.revision",
  "electrical.evaluation.basis.fingerprint.digest",
  "electrical.evaluation.sheet.id",
  "electrical.evaluation.sheet.fingerprint.digest",
  "electrical.evaluation.capture.artifactId",
  "electrical.evaluation.capture.fingerprint.digest",
  "electrical.evaluation.evidence.artifactId",
  "electrical.evaluation.evidence.fingerprint.digest",
  "electrical.evaluation.result.artifactId",
  "electrical.evaluation.result.fingerprint.digest",
  "electrical.evaluation.method.fingerprint.digest",
  "electrical.evaluation.profile.id",
  "electrical.evaluation.unitAlgebra.id",
  "electrical.evaluation.unitAlgebra.fingerprint.digest",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "electrical.evaluation.schemaVersion": "Admitted SPICE observation evaluation schema",
  "electrical.evaluation.project.id": "Project",
  "electrical.evaluation.subject.id": "Subject",
  "electrical.evaluation.basis.snapshotId": "Thread snapshot",
  "electrical.evaluation.basis.revision": "Thread revision",
  "electrical.evaluation.basis.fingerprint.digest": "Thread fingerprint",
  "electrical.evaluation.sheet.id": "Electrical observation method sheet",
  "electrical.evaluation.sheet.fingerprint.digest":
    "Electrical observation method sheet fingerprint",
  "electrical.evaluation.capture.artifactId": "Admitted SPICE capture artifact",
  "electrical.evaluation.capture.fingerprint.digest":
    "Admitted SPICE capture fingerprint",
  "electrical.evaluation.evidence.artifactId": "Admitted SPICE evidence artifact",
  "electrical.evaluation.evidence.fingerprint.digest":
    "Admitted SPICE evidence fingerprint",
  "electrical.evaluation.result.artifactId": "Admitted SPICE result artifact",
  "electrical.evaluation.result.fingerprint.digest":
    "Admitted SPICE result fingerprint",
  "electrical.evaluation.method.fingerprint.digest":
    "Observation evaluation method fingerprint",
  "electrical.evaluation.profile.id": "Evaluation profile",
  "electrical.evaluation.unitAlgebra.id": "Unit algebra",
  "electrical.evaluation.unitAlgebra.fingerprint.digest": "Unit algebra fingerprint",
};

export function encodeSpiceAdmittedObservationEvaluationAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateSpiceAdmittedObservationEvaluationAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseSpiceAdmittedObservationEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): SpiceAdmittedObservationEvaluationAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Admitted SPICE observation evaluation proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Admitted SPICE observation evaluation parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  return validateSpiceAdmittedObservationEvaluationAdmission({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA,
    methodSchemaVersion: values.get("electrical.evaluation.schemaVersion"),
    projectId: values.get("electrical.evaluation.project.id"),
    subjectId: values.get("electrical.evaluation.subject.id"),
    basis: {
      snapshotId: values.get("electrical.evaluation.basis.snapshotId"),
      revision: integerValue(
        values.get("electrical.evaluation.basis.revision"),
        "electrical.evaluation.basis.revision",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("electrical.evaluation.basis.fingerprint.digest"),
      },
    },
    sheet: {
      id: values.get("electrical.evaluation.sheet.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("electrical.evaluation.sheet.fingerprint.digest"),
      },
    },
    capture: {
      artifactId: values.get("electrical.evaluation.capture.artifactId"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("electrical.evaluation.capture.fingerprint.digest"),
      },
    },
    evidence: {
      artifactId: values.get("electrical.evaluation.evidence.artifactId"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("electrical.evaluation.evidence.fingerprint.digest"),
      },
    },
    result: {
      artifactId: values.get("electrical.evaluation.result.artifactId"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("electrical.evaluation.result.fingerprint.digest"),
      },
    },
    methodFingerprint: {
      algorithm: "sha256",
      digest: values.get("electrical.evaluation.method.fingerprint.digest"),
    },
    profileId: values.get("electrical.evaluation.profile.id"),
    unitAlgebra: {
      id: values.get("electrical.evaluation.unitAlgebra.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "electrical.evaluation.unitAlgebra.fingerprint.digest",
        ),
      },
    },
  });
}

export function validateSpiceAdmittedObservationEvaluationAdmission(
  value: unknown,
): SpiceAdmittedObservationEvaluationAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "methodSchemaVersion",
      "projectId",
      "subjectId",
      "basis",
      "sheet",
      "capture",
      "evidence",
      "result",
      "methodFingerprint",
      "profileId",
      "unitAlgebra",
    ],
    "$spiceAdmittedObservationEvaluation",
  );
  literalValue(
    root.schemaVersion,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA,
    "$spiceAdmittedObservationEvaluation.schemaVersion",
  );
  literalValue(
    root.methodSchemaVersion,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    "$spiceAdmittedObservationEvaluation.methodSchemaVersion",
  );
  literalValue(
    root.profileId,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
    "$spiceAdmittedObservationEvaluation.profileId",
  );
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$spiceAdmittedObservationEvaluation.basis",
  );
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint"],
    "$spiceAdmittedObservationEvaluation.sheet",
  );
  const capture = exactRecord(
    root.capture,
    ["artifactId", "fingerprint"],
    "$spiceAdmittedObservationEvaluation.capture",
  );
  const evidence = exactRecord(
    root.evidence,
    ["artifactId", "fingerprint"],
    "$spiceAdmittedObservationEvaluation.evidence",
  );
  const result = exactRecord(
    root.result,
    ["artifactId", "fingerprint"],
    "$spiceAdmittedObservationEvaluation.result",
  );
  const unitAlgebra = exactRecord(
    root.unitAlgebra,
    ["id", "fingerprint"],
    "$spiceAdmittedObservationEvaluation.unitAlgebra",
  );
  literalValue(
    unitAlgebra.id,
    ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
    "$spiceAdmittedObservationEvaluation.unitAlgebra.id",
  );
  const captureFingerprint = parseFingerprint(
    capture.fingerprint,
    "$spiceAdmittedObservationEvaluation.capture.fingerprint",
  );
  const evidenceFingerprint = parseFingerprint(
    evidence.fingerprint,
    "$spiceAdmittedObservationEvaluation.evidence.fingerprint",
  );
  const resultFingerprint = parseFingerprint(
    result.fingerprint,
    "$spiceAdmittedObservationEvaluation.result.fingerprint",
  );
  const captureArtifactId = derivedArtifactId(
    capture.artifactId,
    "spice-admitted-capture-",
    captureFingerprint.digest,
    "$spiceAdmittedObservationEvaluation.capture.artifactId",
  );
  const evidenceArtifactId = derivedArtifactId(
    evidence.artifactId,
    "spice-admitted-evidence-",
    evidenceFingerprint.digest,
    "$spiceAdmittedObservationEvaluation.evidence.artifactId",
  );
  const resultArtifactId = derivedArtifactId(
    result.artifactId,
    "spice-admitted-result-",
    resultFingerprint.digest,
    "$spiceAdmittedObservationEvaluation.result.artifactId",
  );
  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA,
    methodSchemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    projectId: safeId(
      root.projectId,
      "$spiceAdmittedObservationEvaluation.projectId",
    ),
    subjectId: safeId(
      root.subjectId,
      "$spiceAdmittedObservationEvaluation.subjectId",
    ),
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$spiceAdmittedObservationEvaluation.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$spiceAdmittedObservationEvaluation.basis.revision",
      ),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$spiceAdmittedObservationEvaluation.basis.fingerprint",
      ),
    },
    sheet: {
      id: safeId(sheet.id, "$spiceAdmittedObservationEvaluation.sheet.id"),
      fingerprint: parseFingerprint(
        sheet.fingerprint,
        "$spiceAdmittedObservationEvaluation.sheet.fingerprint",
      ),
    },
    capture: {
      artifactId: captureArtifactId,
      fingerprint: captureFingerprint,
    },
    evidence: {
      artifactId: evidenceArtifactId,
      fingerprint: evidenceFingerprint,
    },
    result: {
      artifactId: resultArtifactId,
      fingerprint: resultFingerprint,
    },
    methodFingerprint: parseFingerprint(
      root.methodFingerprint,
      "$spiceAdmittedObservationEvaluation.methodFingerprint",
    ),
    profileId: SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
    unitAlgebra: {
      id: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
      fingerprint: parseFingerprint(
        unitAlgebra.fingerprint,
        "$spiceAdmittedObservationEvaluation.unitAlgebra.fingerprint",
      ),
    },
  });
}

function derivedArtifactId(
  value: unknown,
  prefix: string,
  digest: string,
  path: string,
): string {
  const id = safeId(value, path);
  if (id !== `${prefix}${digest}`) {
    throw new TypeError(`${path} must derive from its digest.`);
  }
  return id;
}

function parameterValue(
  admission: SpiceAdmittedObservationEvaluationAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "electrical.evaluation.schemaVersion":
      return admission.methodSchemaVersion;
    case "electrical.evaluation.project.id":
      return admission.projectId;
    case "electrical.evaluation.subject.id":
      return admission.subjectId;
    case "electrical.evaluation.basis.snapshotId":
      return admission.basis.snapshotId;
    case "electrical.evaluation.basis.revision":
      return admission.basis.revision;
    case "electrical.evaluation.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "electrical.evaluation.sheet.id":
      return admission.sheet.id;
    case "electrical.evaluation.sheet.fingerprint.digest":
      return admission.sheet.fingerprint.digest;
    case "electrical.evaluation.capture.artifactId":
      return admission.capture.artifactId;
    case "electrical.evaluation.capture.fingerprint.digest":
      return admission.capture.fingerprint.digest;
    case "electrical.evaluation.evidence.artifactId":
      return admission.evidence.artifactId;
    case "electrical.evaluation.evidence.fingerprint.digest":
      return admission.evidence.fingerprint.digest;
    case "electrical.evaluation.result.artifactId":
      return admission.result.artifactId;
    case "electrical.evaluation.result.fingerprint.digest":
      return admission.result.fingerprint.digest;
    case "electrical.evaluation.method.fingerprint.digest":
      return admission.methodFingerprint.digest;
    case "electrical.evaluation.profile.id":
      return admission.profileId;
    case "electrical.evaluation.unitAlgebra.id":
      return admission.unitAlgebra.id;
    case "electrical.evaluation.unitAlgebra.fingerprint.digest":
      return admission.unitAlgebra.fingerprint.digest;
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
