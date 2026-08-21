/**
 * Closed MRTR grammar for `verify.evaluate-admitted-modelica-observations@1`.
 *
 * Signed parameters name identities and fingerprints only. They grant no OMC
 * dispatch, no SysON envelope, no observation values, and no L4 verdict.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
  MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
  MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID,
} from "./admitted-observation-evaluation.ts";

export const VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION = {
  id: "verify.evaluate-admitted-modelica-observations",
  version: "1",
} as const;

export const MODELICA_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA =
  "modelica-admitted-observation-evaluation-admission/1.0" as const;

export interface AdmittedObservationEvaluationAdmission {
  readonly schemaVersion:
    typeof MODELICA_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA;
  readonly methodSchemaVersion:
    typeof MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA;
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
  readonly evidence: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly methodFingerprint: ContentFingerprint;
  readonly profileId: typeof MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID;
  readonly unitPolicy: {
    readonly id: typeof MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID;
    readonly fingerprint: ContentFingerprint;
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const PARAMETER_KEYS = [
  "thermal.evaluation.schemaVersion",
  "thermal.evaluation.project.id",
  "thermal.evaluation.subject.id",
  "thermal.evaluation.basis.snapshotId",
  "thermal.evaluation.basis.revision",
  "thermal.evaluation.basis.fingerprint.digest",
  "thermal.evaluation.sheet.id",
  "thermal.evaluation.sheet.fingerprint.digest",
  "thermal.evaluation.evidence.artifactId",
  "thermal.evaluation.evidence.fingerprint.digest",
  "thermal.evaluation.method.fingerprint.digest",
  "thermal.evaluation.profile.id",
  "thermal.evaluation.unitPolicy.id",
  "thermal.evaluation.unitPolicy.fingerprint.digest",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "thermal.evaluation.schemaVersion": "Admitted observation evaluation schema",
  "thermal.evaluation.project.id": "Project",
  "thermal.evaluation.subject.id": "Subject",
  "thermal.evaluation.basis.snapshotId": "Thread snapshot",
  "thermal.evaluation.basis.revision": "Thread revision",
  "thermal.evaluation.basis.fingerprint.digest": "Thread fingerprint",
  "thermal.evaluation.sheet.id": "Thermal method sheet",
  "thermal.evaluation.sheet.fingerprint.digest": "Thermal method sheet fingerprint",
  "thermal.evaluation.evidence.artifactId": "Admitted evidence artifact",
  "thermal.evaluation.evidence.fingerprint.digest": "Admitted evidence fingerprint",
  "thermal.evaluation.method.fingerprint.digest":
    "Observation evaluation method fingerprint",
  "thermal.evaluation.profile.id": "Evaluation profile",
  "thermal.evaluation.unitPolicy.id": "Unit policy",
  "thermal.evaluation.unitPolicy.fingerprint.digest": "Unit policy fingerprint",
};

export function encodeAdmittedObservationEvaluationAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateAdmittedObservationEvaluationAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseAdmittedObservationEvaluationParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): AdmittedObservationEvaluationAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Admitted observation evaluation proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Admitted observation evaluation parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  return validateAdmittedObservationEvaluationAdmission({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA,
    methodSchemaVersion: values.get("thermal.evaluation.schemaVersion"),
    projectId: values.get("thermal.evaluation.project.id"),
    subjectId: values.get("thermal.evaluation.subject.id"),
    basis: {
      snapshotId: values.get("thermal.evaluation.basis.snapshotId"),
      revision: integerValue(
        values.get("thermal.evaluation.basis.revision"),
        "thermal.evaluation.basis.revision",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("thermal.evaluation.basis.fingerprint.digest"),
      },
    },
    sheet: {
      id: values.get("thermal.evaluation.sheet.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("thermal.evaluation.sheet.fingerprint.digest"),
      },
    },
    evidence: {
      artifactId: values.get("thermal.evaluation.evidence.artifactId"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("thermal.evaluation.evidence.fingerprint.digest"),
      },
    },
    methodFingerprint: {
      algorithm: "sha256",
      digest: values.get("thermal.evaluation.method.fingerprint.digest"),
    },
    profileId: values.get("thermal.evaluation.profile.id"),
    unitPolicy: {
      id: values.get("thermal.evaluation.unitPolicy.id"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("thermal.evaluation.unitPolicy.fingerprint.digest"),
      },
    },
  });
}

function validateAdmittedObservationEvaluationAdmission(
  value: unknown,
): AdmittedObservationEvaluationAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "methodSchemaVersion",
      "projectId",
      "subjectId",
      "basis",
      "sheet",
      "evidence",
      "methodFingerprint",
      "profileId",
      "unitPolicy",
    ],
    "$admittedObservationEvaluation",
  );
  literalValue(
    root.schemaVersion,
    MODELICA_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA,
    "$admittedObservationEvaluation.schemaVersion",
  );
  literalValue(
    root.methodSchemaVersion,
    MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    "$admittedObservationEvaluation.methodSchemaVersion",
  );
  literalValue(
    root.profileId,
    MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
    "$admittedObservationEvaluation.profileId",
  );
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$admittedObservationEvaluation.basis",
  );
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint"],
    "$admittedObservationEvaluation.sheet",
  );
  const evidence = exactRecord(
    root.evidence,
    ["artifactId", "fingerprint"],
    "$admittedObservationEvaluation.evidence",
  );
  const unitPolicy = exactRecord(
    root.unitPolicy,
    ["id", "fingerprint"],
    "$admittedObservationEvaluation.unitPolicy",
  );
  literalValue(
    unitPolicy.id,
    MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID,
    "$admittedObservationEvaluation.unitPolicy.id",
  );
  const evidenceFingerprint = parseFingerprint(
    evidence.fingerprint,
    "$admittedObservationEvaluation.evidence.fingerprint",
  );
  const evidenceArtifactId = safeId(
    evidence.artifactId,
    "$admittedObservationEvaluation.evidence.artifactId",
  );
  if (
    evidenceArtifactId !== `modelica-admitted-evidence-${evidenceFingerprint.digest}`
  ) {
    throw new TypeError(
      "$admittedObservationEvaluation.evidence.artifactId must derive from its digest.",
    );
  }
  return deepFreeze({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_ADMISSION_SCHEMA,
    methodSchemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    projectId: safeId(root.projectId, "$admittedObservationEvaluation.projectId"),
    subjectId: safeId(root.subjectId, "$admittedObservationEvaluation.subjectId"),
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$admittedObservationEvaluation.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$admittedObservationEvaluation.basis.revision",
      ),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$admittedObservationEvaluation.basis.fingerprint",
      ),
    },
    sheet: {
      id: safeId(sheet.id, "$admittedObservationEvaluation.sheet.id"),
      fingerprint: parseFingerprint(
        sheet.fingerprint,
        "$admittedObservationEvaluation.sheet.fingerprint",
      ),
    },
    evidence: {
      artifactId: evidenceArtifactId,
      fingerprint: evidenceFingerprint,
    },
    methodFingerprint: parseFingerprint(
      root.methodFingerprint,
      "$admittedObservationEvaluation.methodFingerprint",
    ),
    profileId: MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
    unitPolicy: {
      id: MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID,
      fingerprint: parseFingerprint(
        unitPolicy.fingerprint,
        "$admittedObservationEvaluation.unitPolicy.fingerprint",
      ),
    },
  });
}

function parameterValue(
  admission: AdmittedObservationEvaluationAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "thermal.evaluation.schemaVersion":
      return admission.methodSchemaVersion;
    case "thermal.evaluation.project.id":
      return admission.projectId;
    case "thermal.evaluation.subject.id":
      return admission.subjectId;
    case "thermal.evaluation.basis.snapshotId":
      return admission.basis.snapshotId;
    case "thermal.evaluation.basis.revision":
      return admission.basis.revision;
    case "thermal.evaluation.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "thermal.evaluation.sheet.id":
      return admission.sheet.id;
    case "thermal.evaluation.sheet.fingerprint.digest":
      return admission.sheet.fingerprint.digest;
    case "thermal.evaluation.evidence.artifactId":
      return admission.evidence.artifactId;
    case "thermal.evaluation.evidence.fingerprint.digest":
      return admission.evidence.fingerprint.digest;
    case "thermal.evaluation.method.fingerprint.digest":
      return admission.methodFingerprint.digest;
    case "thermal.evaluation.profile.id":
      return admission.profileId;
    case "thermal.evaluation.unitPolicy.id":
      return admission.unitPolicy.id;
    case "thermal.evaluation.unitPolicy.fingerprint.digest":
      return admission.unitPolicy.fingerprint.digest;
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
