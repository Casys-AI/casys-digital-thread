/**
 * Closed MRTR grammar for provider-read-only `model.recapture-requirements@1`.
 *
 * The signed parameters name exact Thread, architecture, predecessor,
 * target and envelope identities only. They grant no SysON insert, delete,
 * renderer, solver or runtime selection. The executor rederives every input
 * and proves this exact signed review before any provider read.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import type { OracleRequirement } from "../../kernel/proof-case.ts";
import type { RequirementsTarget } from "./requirements-proposal.ts";

/** Native ConstraintUsage identity sealed by a requirements capture. */
export interface RequirementsNativeConstraintUsage {
  readonly requirementId: string;
  readonly id: string;
  readonly kind: "ConstraintUsage";
  readonly sourceId: string;
}

/** Human-reviewed operation identity. It confers no provider write. */
export const MODEL_RECAPTURE_REQUIREMENTS_OPERATION = Object.freeze(
  {
    id: "model.recapture-requirements",
    version: "1",
  } as const,
);

/**
 * Honest Thread producer for this read-only recapture. It names the
 * requirements-specific inspect tool actually used; it is never
 * `syson_element_insert_sysml`.
 */
export const MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL =
  "syson_constraint_extract" as const;

export const REQUIREMENTS_WRITE_PRODUCER_TOOL = "syson_element_insert_sysml" as const;

export const REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA =
  "requirements-recapture-admission/1.0" as const;

export const REQUIREMENTS_RECAPTURE_CAPTURE_SCHEMA =
  "requirements-capture/4.0" as const;

export interface RequirementsRecaptureArtifactReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface RequirementsRecaptureEnvelope {
  readonly target: RequirementsTarget;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: string;
  };
  readonly containerComponent: string;
  readonly partDefName: string;
  readonly requirementsElementId: string;
  readonly requirementUsage: {
    readonly id: string;
    readonly kind: "RequirementUsage";
  };
  readonly constraintUsages: readonly RequirementsNativeConstraintUsage[];
  readonly requirements: readonly OracleRequirement[];
}

export interface RequirementsRecaptureAdmission {
  readonly schemaVersion: typeof REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA;
  readonly operation: typeof MODEL_RECAPTURE_REQUIREMENTS_OPERATION;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly architecture: RequirementsRecaptureArtifactReference;
  readonly predecessor: RequirementsRecaptureArtifactReference & {
    readonly schemaVersion: string;
  };
  readonly target: RequirementsTarget;
  readonly containerComponent: string;
  readonly partDefName: string;
  readonly requirementsElementId: string;
  readonly envelope: {
    readonly fingerprint: ContentFingerprint;
  };
}

type ParameterValue = EngineeringDecisionProposalParameter["value"];

interface ParameterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: ParameterValue;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const PARAMETER_PREFIX = "model.recaptureRequirements";
const FIXED_PARAMETER_COUNT = 21;

export function encodeRequirementsRecaptureParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateRequirementsRecaptureAdmission(value);
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

export function parseRequirementsRecaptureParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): RequirementsRecaptureAdmission {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  if (parameters.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      `$parameters must contain exactly ${FIXED_PARAMETER_COUNT} entries.`,
    );
  }

  const values = new Map<string, ParameterValue>();
  const actualKeys: string[] = [];
  const actualLabels = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    const record = exactRecord(
      parameter,
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    const key = safeId(record.key, `$parameters[${index}].key`);
    if (values.has(key)) {
      throw new TypeError(`$parameters contains duplicate key ${key}.`);
    }
    values.set(
      key,
      requireParameterValue(record.value, `$parameters[${index}].value`),
    );
    actualLabels.set(
      key,
      requireLabel(record.label, `$parameters[${index}].label`),
    );
    actualKeys.push(key);
  }

  const parsed = validateRequirementsRecaptureAdmission({
    schemaVersion: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.schemaVersion`,
      REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
    ),
    operation: {
      id: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.operation.id`,
        MODEL_RECAPTURE_REQUIREMENTS_OPERATION.id,
      ),
      version: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.operation.version`,
        MODEL_RECAPTURE_REQUIREMENTS_OPERATION.version,
      ),
    },
    basis: {
      snapshotId: requireId(values, `${PARAMETER_PREFIX}.basis.snapshotId`),
      revision: requirePositiveInteger(
        values,
        `${PARAMETER_PREFIX}.basis.revision`,
      ),
      subjectId: requireId(values, `${PARAMETER_PREFIX}.basis.subjectId`),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.basis.sha256`,
      ),
    },
    architecture: {
      artifactId: requireId(
        values,
        `${PARAMETER_PREFIX}.architecture.artifactId`,
      ),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.architecture.sha256`,
      ),
      producerRunId: requireId(
        values,
        `${PARAMETER_PREFIX}.architecture.producerRunId`,
      ),
    },
    predecessor: {
      artifactId: requireId(
        values,
        `${PARAMETER_PREFIX}.predecessor.artifactId`,
      ),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.predecessor.sha256`,
      ),
      producerRunId: requireId(
        values,
        `${PARAMETER_PREFIX}.predecessor.producerRunId`,
      ),
      schemaVersion: requireNonEmpty(
        values,
        `${PARAMETER_PREFIX}.predecessor.schemaVersion`,
      ),
    },
    target: {
      kind: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.target.kind`,
        "part-definition",
      ),
      label: requireNonEmpty(values, `${PARAMETER_PREFIX}.target.label`),
      elementId: requireId(values, `${PARAMETER_PREFIX}.target.elementId`),
    },
    containerComponent: requireNonEmpty(
      values,
      `${PARAMETER_PREFIX}.containerComponent`,
    ),
    partDefName: requireNonEmpty(values, `${PARAMETER_PREFIX}.partDefName`),
    requirementsElementId: requireId(
      values,
      `${PARAMETER_PREFIX}.requirementsElementId`,
    ),
    envelope: {
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.envelope.sha256`,
      ),
    },
  });

  const expected = parameterSpecs(parsed);
  for (const [index, spec] of expected.entries()) {
    if (actualKeys[index] !== spec.key) {
      throw new TypeError(
        `$parameters[${index}].key must equal ${spec.key}.`,
      );
    }
    if (actualLabels.get(spec.key) !== spec.label) {
      throw new TypeError(
        `$parameters label for ${spec.key} must equal ${JSON.stringify(spec.label)}.`,
      );
    }
    if (!Object.is(values.get(spec.key), spec.value)) {
      throw new TypeError(
        `$parameters value for ${spec.key} is not its exact canonical scalar.`,
      );
    }
  }
  return parsed;
}

export function validateRequirementsRecaptureAdmission(
  value: unknown,
  path = "$requirementsRecaptureAdmission",
): RequirementsRecaptureAdmission {
  const root = exactRecord(
    value,
    [
      "architecture",
      "basis",
      "containerComponent",
      "envelope",
      "operation",
      "partDefName",
      "predecessor",
      "requirementsElementId",
      "schemaVersion",
      "target",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );

  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION.version,
    `${path}.operation.version`,
  );

  const basis = exactRecord(
    root.basis,
    ["fingerprint", "revision", "snapshotId", "subjectId"],
    `${path}.basis`,
  );
  const snapshotId = safeId(basis.snapshotId, `${path}.basis.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path}.basis.snapshotId must name an exact snapshot.`);
  }

  const architecture = parseArtifactReference(
    root.architecture,
    `${path}.architecture`,
  );
  const predecessorRecord = exactRecord(
    root.predecessor,
    ["artifactId", "fingerprint", "producerRunId", "schemaVersion"],
    `${path}.predecessor`,
  );
  const predecessorSchema = nonEmptyText(
    predecessorRecord.schemaVersion,
    `${path}.predecessor.schemaVersion`,
  );
  if (
    predecessorSchema !== "requirements-capture/3.0" &&
    predecessorSchema !== REQUIREMENTS_RECAPTURE_CAPTURE_SCHEMA
  ) {
    throw new TypeError(
      `${path}.predecessor.schemaVersion must be an admissible requirements capture.`,
    );
  }
  const predecessor = deepFreeze({
    artifactId: safeId(
      predecessorRecord.artifactId,
      `${path}.predecessor.artifactId`,
    ),
    fingerprint: parseFingerprint(
      predecessorRecord.fingerprint,
      `${path}.predecessor.fingerprint`,
    ),
    producerRunId: safeId(
      predecessorRecord.producerRunId,
      `${path}.predecessor.producerRunId`,
    ),
    schemaVersion: predecessorSchema,
  });

  const targetRecord = exactRecord(
    root.target,
    ["elementId", "kind", "label"],
    `${path}.target`,
  );
  literalValue(targetRecord.kind, "part-definition", `${path}.target.kind`);
  const target: RequirementsTarget = {
    kind: "part-definition",
    label: nonEmptyText(targetRecord.label, `${path}.target.label`),
    elementId: safeId(targetRecord.elementId, `${path}.target.elementId`),
  };

  const containerComponent = nonEmptyText(
    root.containerComponent,
    `${path}.containerComponent`,
  );
  const partDefName = nonEmptyText(root.partDefName, `${path}.partDefName`);
  if (partDefName !== `${containerComponent}Requirements`) {
    throw new TypeError(
      `${path}.partDefName must be the server-derived RequirementUsage name.`,
    );
  }
  if (target.label !== containerComponent) {
    throw new TypeError(
      `${path}.target.label must equal containerComponent.`,
    );
  }
  if (architecture.artifactId === predecessor.artifactId) {
    throw new TypeError(
      `${path} architecture and predecessor must be distinct artifacts.`,
    );
  }

  return deepFreeze({
    schemaVersion: REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
    operation: MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    basis: {
      snapshotId,
      revision: positiveInteger(basis.revision, `${path}.basis.revision`),
      subjectId: safeId(basis.subjectId, `${path}.basis.subjectId`),
      fingerprint: parseFingerprint(basis.fingerprint, `${path}.basis.fingerprint`),
    },
    architecture,
    predecessor,
    target,
    containerComponent,
    partDefName,
    requirementsElementId: safeId(
      root.requirementsElementId,
      `${path}.requirementsElementId`,
    ),
    envelope: {
      fingerprint: parseFingerprint(
        exactRecord(root.envelope, ["fingerprint"], `${path}.envelope`).fingerprint,
        `${path}.envelope.fingerprint`,
      ),
    },
  });
}

export function fingerprintRequirementsRecaptureEnvelope(
  envelope: RequirementsRecaptureEnvelope,
): Promise<ContentFingerprint> {
  return sha256Fingerprint({
    target: envelope.target,
    architectureBasis: envelope.architectureBasis,
    containerComponent: envelope.containerComponent,
    partDefName: envelope.partDefName,
    requirementsElementId: envelope.requirementsElementId,
    requirementUsage: envelope.requirementUsage,
    constraintUsages: envelope.constraintUsages,
    requirements: envelope.requirements,
  });
}

function parameterSpecs(
  admission: RequirementsRecaptureAdmission,
): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const add = (key: string, label: string, value: ParameterValue) => {
    specs.push({ key, label, value });
  };
  add(
    `${PARAMETER_PREFIX}.schemaVersion`,
    "Requirements recapture admission schema",
    admission.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.operation.id`,
    "Reviewed operation id",
    admission.operation.id,
  );
  add(
    `${PARAMETER_PREFIX}.operation.version`,
    "Reviewed operation version",
    admission.operation.version,
  );
  add(
    `${PARAMETER_PREFIX}.basis.snapshotId`,
    "Current Thread snapshot ID",
    admission.basis.snapshotId,
  );
  add(
    `${PARAMETER_PREFIX}.basis.revision`,
    "Current Thread revision",
    admission.basis.revision,
  );
  add(
    `${PARAMETER_PREFIX}.basis.subjectId`,
    "Current Thread subject ID",
    admission.basis.subjectId,
  );
  add(
    `${PARAMETER_PREFIX}.basis.sha256`,
    "Current Thread snapshot SHA-256",
    admission.basis.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.architecture.artifactId`,
    "Current architecture artifact ID",
    admission.architecture.artifactId,
  );
  add(
    `${PARAMETER_PREFIX}.architecture.sha256`,
    "Current architecture SHA-256",
    admission.architecture.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.architecture.producerRunId`,
    "Current architecture producer run",
    admission.architecture.producerRunId,
  );
  add(
    `${PARAMETER_PREFIX}.predecessor.artifactId`,
    "Predecessor requirements artifact ID",
    admission.predecessor.artifactId,
  );
  add(
    `${PARAMETER_PREFIX}.predecessor.sha256`,
    "Predecessor requirements SHA-256",
    admission.predecessor.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.predecessor.producerRunId`,
    "Predecessor requirements producer run",
    admission.predecessor.producerRunId,
  );
  add(
    `${PARAMETER_PREFIX}.predecessor.schemaVersion`,
    "Predecessor requirements capture schema",
    admission.predecessor.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.target.kind`,
    "Target kind",
    admission.target.kind,
  );
  add(
    `${PARAMETER_PREFIX}.target.label`,
    "Target PartDefinition label",
    admission.target.label,
  );
  add(
    `${PARAMETER_PREFIX}.target.elementId`,
    "Target PartDefinition element ID",
    admission.target.elementId,
  );
  add(
    `${PARAMETER_PREFIX}.containerComponent`,
    "Requirements family container",
    admission.containerComponent,
  );
  add(
    `${PARAMETER_PREFIX}.partDefName`,
    "Server-derived RequirementUsage name",
    admission.partDefName,
  );
  add(
    `${PARAMETER_PREFIX}.requirementsElementId`,
    "Native RequirementUsage identity",
    admission.requirementsElementId,
  );
  add(
    `${PARAMETER_PREFIX}.envelope.sha256`,
    "Unchanged semantic envelope SHA-256",
    admission.envelope.fingerprint.digest,
  );
  if (specs.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      "Requirements recapture MRTR grammar is internally inconsistent.",
    );
  }
  return specs;
}

function parseArtifactReference(
  value: unknown,
  path: string,
): RequirementsRecaptureArtifactReference {
  const record = exactRecord(
    value,
    ["artifactId", "fingerprint", "producerRunId"],
    path,
  );
  return deepFreeze({
    artifactId: safeId(record.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(record.fingerprint, `${path}.fingerprint`),
    producerRunId: safeId(record.producerRunId, `${path}.producerRunId`),
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  return deepFreeze({
    algorithm: "sha256",
    digest: canonicalSha256(fingerprint.digest, `${path}.digest`),
  });
}

function canonicalSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(`${path} must be canonical lowercase SHA-256 hex.`);
  }
  return value;
}

function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty string without edge whitespace.`);
  }
  return value;
}

function requireParameterValue(value: unknown, path: string): ParameterValue {
  if (
    (typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "boolean") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new TypeError(`${path} must be a finite MRTR scalar.`);
  }
  return value;
}

function requireLabel(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > 128
  ) {
    throw new TypeError(
      `${path} must be a non-empty label of at most 128 characters without edge whitespace.`,
    );
  }
  return value;
}

function requireLiteral<T extends string>(
  values: Map<string, ParameterValue>,
  key: string,
  expected: T,
): T {
  const value = values.get(key);
  if (value !== expected) {
    throw new TypeError(`${key} must equal ${JSON.stringify(expected)}.`);
  }
  return expected;
}

function requireId(values: Map<string, ParameterValue>, key: string): string {
  return safeId(values.get(key), key);
}

function requireNonEmpty(
  values: Map<string, ParameterValue>,
  key: string,
): string {
  return nonEmptyText(values.get(key), key);
}

function requirePositiveInteger(
  values: Map<string, ParameterValue>,
  key: string,
): number {
  return positiveInteger(values.get(key), key);
}

function requireFingerprint(
  values: Map<string, ParameterValue>,
  key: string,
): ContentFingerprint {
  return {
    algorithm: "sha256",
    digest: canonicalSha256(values.get(key), key),
  };
}
