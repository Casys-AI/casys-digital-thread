/**
 * Closed MRTR identity for the two trusted consumers of a completed
 * sensitivity-study result.
 *
 * The admission carries only server-derived identity and scope. It cannot
 * represent SysML, a provider, a solver argument, a metric alias, a verdict,
 * or a numerical sensitivity value.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../project/thread-tip.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../base-evaluation/sensitivity-base-evaluation.ts";
import type { SensitivityStudyResult } from "./sensitivity-study-result.ts";
import {
  isSensitivityStudyResultArtifactId,
  SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA,
} from "./sensitivity-study-result.ts";
import { SENSITIVITY_STUDY_CAPTURE_SCHEMA } from "./sensitivity-study-capture.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "./sensitivity-study-proposal.ts";

export const SENSITIVITY_STUDY_CONSUMER_ADMISSION_SCHEMA =
  "sensitivity-study-consumer-admission/1.0" as const;

export type SensitivityStudyConsumerOperation =
  | typeof VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION
  | typeof MODEL_WRITE_SENSITIVITY_EDGES_OPERATION;

export interface SensitivityStudyConsumerAdmission {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CONSUMER_ADMISSION_SCHEMA;
  readonly operation: SensitivityStudyConsumerOperation;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly studyCapture: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly schemaVersion:
      | typeof SENSITIVITY_STUDY_CAPTURE_SCHEMA
      | typeof SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA;
    readonly trustedRunId: string;
    readonly caseDigest: string;
  };
  readonly target: {
    readonly componentKey: string;
    readonly semanticKey: string;
  };
  readonly metricIds: readonly string[];
}

const PREFIX = "sensitivity.studyConsumer";
const FIXED_KEYS = [
  "schemaVersion",
  "operation.id",
  "operation.version",
  "projectId",
  "basis.kind",
  "basis.snapshotId",
  "basis.revision",
  "basis.subjectId",
  "studyCapture.artifactId",
  "studyCapture.sha256",
  "studyCapture.schemaVersion",
  "studyCapture.trustedRunId",
  "studyCapture.caseDigest",
  "target.componentKey",
  "target.semanticKey",
  "metrics.count",
] as const;

type Scalar = EngineeringDecisionProposalParameter["value"];

export function sensitivityStudyConsumerAdmission(input: {
  readonly operation: SensitivityStudyConsumerOperation;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
  readonly capture: SensitivityStudyResult;
}): SensitivityStudyConsumerAdmission {
  return validateSensitivityStudyConsumerAdmission({
    schemaVersion: SENSITIVITY_STUDY_CONSUMER_ADMISSION_SCHEMA,
    operation: input.operation,
    projectId: input.projectId,
    basis: input.basis,
    studyCapture: {
      artifactId: input.artifactId,
      fingerprint: input.artifactFingerprint,
      schemaVersion: input.capture.schemaVersion,
      trustedRunId: input.capture.trustedRunId,
      caseDigest: input.capture.caseDigest,
    },
    target: {
      componentKey: input.capture.studyCase.target.componentKey,
      semanticKey: input.capture.studyCase.target.semanticKey,
    },
    metricIds: input.capture.studyCase.metrics.map((metric) => metric.id),
  });
}

/** Encode one canonical, ordered human-review sequence. */
export function encodeSensitivityStudyConsumerDecisionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateSensitivityStudyConsumerAdmission(value);
  const values: readonly Scalar[] = [
    admission.schemaVersion,
    admission.operation.id,
    admission.operation.version,
    admission.projectId,
    admission.basis.kind,
    admission.basis.snapshotId,
    admission.basis.revision,
    admission.basis.subjectId,
    admission.studyCapture.artifactId,
    admission.studyCapture.fingerprint.digest,
    admission.studyCapture.schemaVersion,
    admission.studyCapture.trustedRunId,
    admission.studyCapture.caseDigest,
    admission.target.componentKey,
    admission.target.semanticKey,
    admission.metricIds.length,
    ...admission.metricIds,
  ];
  const keys = [
    ...FIXED_KEYS,
    ...admission.metricIds.map((_, index) => `metrics.${index}.id`),
  ];
  return deepFreeze(keys.map((key, index) => ({
    key: `${PREFIX}.${key}`,
    label: `${PREFIX}.${key}`,
    value: values[index]!,
  })));
}

/** Parse exact keys, order and scalars; aliases, units and extras are refused. */
export function parseSensitivityStudyConsumerDecisionParameters(
  value: unknown,
  expectedOperation?: SensitivityStudyConsumerOperation,
): SensitivityStudyConsumerAdmission {
  if (!Array.isArray(value) || value.length < FIXED_KEYS.length) {
    throw new TypeError(
      `$parameters must contain at least ${FIXED_KEYS.length} entries.`,
    );
  }
  const fixed = new Map<string, Scalar>();
  for (const [index, key] of FIXED_KEYS.entries()) {
    fixed.set(key, parameterValue(value[index], key, index));
  }
  const count = integerValue(fixed.get("metrics.count"), "metrics.count");
  if (count < 1 || value.length !== FIXED_KEYS.length + count) {
    throw new TypeError(
      `$parameters metrics.count requires exactly ${
        FIXED_KEYS.length + count
      } entries.`,
    );
  }
  const metricIds = [];
  for (let index = 0; index < count; index += 1) {
    metricIds.push(
      stringValue(
        parameterValue(
          value[FIXED_KEYS.length + index],
          `metrics.${index}.id`,
          FIXED_KEYS.length + index,
        ),
        `metrics.${index}.id`,
      ),
    );
  }
  const operation = parseOperation(
    stringValue(fixed.get("operation.id"), "operation.id"),
    stringValue(fixed.get("operation.version"), "operation.version"),
  );
  if (
    expectedOperation &&
    (operation.id !== expectedOperation.id ||
      operation.version !== expectedOperation.version)
  ) {
    throw new TypeError(
      `The admission operation is ${operation.id}@${operation.version}, not ` +
        `${expectedOperation.id}@${expectedOperation.version}.`,
    );
  }
  const parsed = validateSensitivityStudyConsumerAdmission({
    schemaVersion: stringValue(fixed.get("schemaVersion"), "schemaVersion"),
    operation,
    projectId: stringValue(fixed.get("projectId"), "projectId"),
    basis: {
      kind: stringValue(fixed.get("basis.kind"), "basis.kind"),
      snapshotId: stringValue(fixed.get("basis.snapshotId"), "basis.snapshotId"),
      revision: integerValue(fixed.get("basis.revision"), "basis.revision"),
      subjectId: stringValue(fixed.get("basis.subjectId"), "basis.subjectId"),
    },
    studyCapture: {
      artifactId: stringValue(
        fixed.get("studyCapture.artifactId"),
        "studyCapture.artifactId",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: stringValue(
          fixed.get("studyCapture.sha256"),
          "studyCapture.sha256",
        ),
      },
      schemaVersion: stringValue(
        fixed.get("studyCapture.schemaVersion"),
        "studyCapture.schemaVersion",
      ),
      trustedRunId: stringValue(
        fixed.get("studyCapture.trustedRunId"),
        "studyCapture.trustedRunId",
      ),
      caseDigest: stringValue(
        fixed.get("studyCapture.caseDigest"),
        "studyCapture.caseDigest",
      ),
    },
    target: {
      componentKey: stringValue(
        fixed.get("target.componentKey"),
        "target.componentKey",
      ),
      semanticKey: stringValue(
        fixed.get("target.semanticKey"),
        "target.semanticKey",
      ),
    },
    metricIds,
  });
  if (
    deterministicJson(
      encodeSensitivityStudyConsumerDecisionParameters(parsed),
    ) !== deterministicJson(value)
  ) {
    throw new TypeError("The sensitivity consumer MRTR did not replay exactly.");
  }
  return parsed;
}

export function validateSensitivityStudyConsumerAdmission(
  value: unknown,
): SensitivityStudyConsumerAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "projectId",
    "basis",
    "studyCapture",
    "target",
    "metricIds",
  ], "$sensitivityStudyConsumerAdmission");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_CONSUMER_ADMISSION_SCHEMA,
    "$sensitivityStudyConsumerAdmission.schemaVersion",
  );
  const operationRoot = exactRecord(
    root.operation,
    ["id", "version"],
    "$sensitivityStudyConsumerAdmission.operation",
  );
  const operation = parseOperation(
    safeId(operationRoot.id, "$sensitivityStudyConsumerAdmission.operation.id"),
    String(operationRoot.version),
  );
  const basis = parseExactThreadSnapshotBasis(
    root.basis,
    "$sensitivityStudyConsumerAdmission.basis",
  );
  const captureRoot = exactRecord(
    root.studyCapture,
    [
      "artifactId",
      "fingerprint",
      "schemaVersion",
      "trustedRunId",
      "caseDigest",
    ],
    "$sensitivityStudyConsumerAdmission.studyCapture",
  );
  const fingerprintRoot = exactRecord(
    captureRoot.fingerprint,
    ["algorithm", "digest"],
    "$sensitivityStudyConsumerAdmission.studyCapture.fingerprint",
  );
  literalValue(
    fingerprintRoot.algorithm,
    "sha256",
    "$sensitivityStudyConsumerAdmission.studyCapture.fingerprint.algorithm",
  );
  const digest = sha256(
    fingerprintRoot.digest,
    "$sensitivityStudyConsumerAdmission.studyCapture.fingerprint.digest",
  );
  const artifactId = safeId(
    captureRoot.artifactId,
    "$sensitivityStudyConsumerAdmission.studyCapture.artifactId",
  );
  if (
    !isSensitivityStudyResultArtifactId(artifactId, {
      algorithm: "sha256",
      digest,
    })
  ) {
    throw new TypeError(
      "The sensitivity-study artifact id does not match its SHA-256 fingerprint.",
    );
  }
  const captureSchema = captureRoot.schemaVersion;
  if (
    captureSchema !== SENSITIVITY_STUDY_CAPTURE_SCHEMA &&
    captureSchema !== SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA
  ) {
    throw new TypeError("Unsupported sensitivity-study result schema.");
  }
  const targetRoot = exactRecord(
    root.target,
    ["componentKey", "semanticKey"],
    "$sensitivityStudyConsumerAdmission.target",
  );
  if (!Array.isArray(root.metricIds) || root.metricIds.length < 1) {
    throw new TypeError(
      "$sensitivityStudyConsumerAdmission.metricIds must be non-empty.",
    );
  }
  const metricIds = root.metricIds.map((metric, index) =>
    safeId(metric, `$sensitivityStudyConsumerAdmission.metricIds[${index}]`)
  );
  if (new Set(metricIds).size !== metricIds.length) {
    throw new TypeError("Sensitivity-study metric ids must be unique.");
  }
  return deepFreeze({
    schemaVersion: SENSITIVITY_STUDY_CONSUMER_ADMISSION_SCHEMA,
    operation,
    projectId: safeId(
      root.projectId,
      "$sensitivityStudyConsumerAdmission.projectId",
    ),
    basis,
    studyCapture: {
      artifactId,
      fingerprint: { algorithm: "sha256", digest },
      schemaVersion: captureSchema,
      trustedRunId: safeId(
        captureRoot.trustedRunId,
        "$sensitivityStudyConsumerAdmission.studyCapture.trustedRunId",
      ),
      caseDigest: sha256(
        captureRoot.caseDigest,
        "$sensitivityStudyConsumerAdmission.studyCapture.caseDigest",
      ),
    },
    target: {
      componentKey: safeId(
        targetRoot.componentKey,
        "$sensitivityStudyConsumerAdmission.target.componentKey",
      ),
      semanticKey: safeId(
        targetRoot.semanticKey,
        "$sensitivityStudyConsumerAdmission.target.semanticKey",
      ),
    },
    metricIds,
  });
}

function parameterValue(value: unknown, key: string, index: number): Scalar {
  const root = exactRecord(
    value,
    ["key", "label", "value"],
    `$parameters[${index}]`,
  );
  literalValue(root.key, `${PREFIX}.${key}`, `$parameters[${index}].key`);
  literalValue(root.label, `${PREFIX}.${key}`, `$parameters[${index}].label`);
  if (
    typeof root.value !== "string" && typeof root.value !== "number" &&
    typeof root.value !== "boolean"
  ) {
    throw new TypeError(`$parameters[${index}].value must be a scalar.`);
  }
  if (typeof root.value === "number" && !Number.isFinite(root.value)) {
    throw new TypeError(`$parameters[${index}].value must be finite.`);
  }
  return root.value;
}

function parseOperation(
  id: string,
  version: string,
): SensitivityStudyConsumerOperation {
  if (
    id === VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id &&
    version === VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version
  ) return VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION;
  if (
    id === MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id &&
    version === MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version
  ) return MODEL_WRITE_SENSITIVITY_EDGES_OPERATION;
  throw new TypeError(`Unsupported sensitivity-study consumer ${id}@${version}.`);
}

function stringValue(value: Scalar | undefined, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function integerValue(value: Scalar | undefined, path: string): number {
  return positiveInteger(value, path);
}

function sha256(value: unknown, path: string): string {
  const digest = typeof value === "string" ? value : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}
