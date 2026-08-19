/**
 * Closed MRTR grammar for sealing one isolated Build123d execution document.
 *
 * The signed parameters name exact identities only. They grant no provider
 * dispatch, no STEP persistence, no `design.write-geometry@1` authority, and
 * no Product/FEA admission. The first `design.execute-build123d@1` MRTR and
 * the isolation receipt are not this approval.
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
import { BUILD123D_EXECUTION_OUTPUT } from "../isolated/build123d-execution-proposal.ts";
import { BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA } from "../isolated/build123d-execution-evidence.ts";

/** Human-reviewed operation identity. It is not a runtime capability. */
export const DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION = Object.freeze(
  {
    id: "design.seal-isolated-geometry",
    version: "1",
  } as const,
);

export const ISOLATED_GEOMETRY_SEAL_ADMISSION_SCHEMA =
  "isolated-geometry-seal-admission/1.0" as const;

export interface IsolatedGeometrySealAdmission {
  readonly schemaVersion: typeof ISOLATED_GEOMETRY_SEAL_ADMISSION_SCHEMA;
  readonly executionCapture: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly draft: {
    readonly schemaVersion: typeof BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA;
    readonly draftId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly publication: {
    readonly fingerprint: ContentFingerprint;
  };
  readonly step: {
    readonly role: typeof BUILD123D_EXECUTION_OUTPUT.role;
    readonly basename: typeof BUILD123D_EXECUTION_OUTPUT.basename;
    readonly mediaType: typeof BUILD123D_EXECUTION_OUTPUT.mediaType;
    readonly format: typeof BUILD123D_EXECUTION_OUTPUT.format;
    readonly sha256: string;
    readonly byteCount: number;
  };
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
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
const PARAMETER_PREFIX = "design.isolatedGeometry.seal";
const FIXED_PARAMETER_COUNT = 18;

/** Encode a typed admission into its unique, stable MRTR parameter order. */
export function encodeIsolatedGeometrySealParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateIsolatedGeometrySealAdmission(value);
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

/**
 * Parse and replay the complete signed MRTR parameter sequence.
 *
 * Keys, labels, order, scalar types, values and derived identities are all
 * checked. `Object.is` prevents signed numeric distinctions from being
 * normalized away during canonical replay.
 */
export function parseIsolatedGeometrySealParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): IsolatedGeometrySealAdmission {
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

  const parsed = validateIsolatedGeometrySealAdmission({
    schemaVersion: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.schemaVersion`,
      ISOLATED_GEOMETRY_SEAL_ADMISSION_SCHEMA,
    ),
    executionCapture: {
      id: requireId(values, `${PARAMETER_PREFIX}.executionCapture.id`),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.executionCapture.sha256`,
      ),
    },
    draft: {
      schemaVersion: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.draft.schemaVersion`,
        BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA,
      ),
      draftId: requireId(values, `${PARAMETER_PREFIX}.draft.draftId`),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.draft.sha256`,
      ),
    },
    publication: {
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.publication.sha256`,
      ),
    },
    step: {
      role: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.step.role`,
        BUILD123D_EXECUTION_OUTPUT.role,
      ),
      basename: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.step.basename`,
        BUILD123D_EXECUTION_OUTPUT.basename,
      ),
      mediaType: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.step.mediaType`,
        BUILD123D_EXECUTION_OUTPUT.mediaType,
      ),
      format: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.step.format`,
        BUILD123D_EXECUTION_OUTPUT.format,
      ),
      sha256: requireSha256(values, `${PARAMETER_PREFIX}.step.sha256`),
      byteCount: requireNonNegativeInteger(
        values,
        `${PARAMETER_PREFIX}.step.byteCount`,
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

/** Validate the closed object form and recompute its cross-field invariants. */
export function validateIsolatedGeometrySealAdmission(
  value: unknown,
  path = "$isolatedGeometrySealAdmission",
): IsolatedGeometrySealAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "executionCapture",
      "draft",
      "publication",
      "step",
      "basis",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    ISOLATED_GEOMETRY_SEAL_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );

  const executionCapture = exactRecord(
    root.executionCapture,
    ["id", "fingerprint"],
    `${path}.executionCapture`,
  );
  const executionFingerprint = parseFingerprint(
    executionCapture.fingerprint,
    `${path}.executionCapture.fingerprint`,
  );
  const executionCaptureId = safeId(
    executionCapture.id,
    `${path}.executionCapture.id`,
  );
  const expectedCaptureId =
    `build123d-execution-capture-${executionFingerprint.digest}`;
  if (executionCaptureId !== expectedCaptureId) {
    throw new TypeError(
      `${path}.executionCapture.id must be derived from its exact fingerprint.`,
    );
  }

  const draft = exactRecord(
    root.draft,
    ["schemaVersion", "draftId", "fingerprint"],
    `${path}.draft`,
  );
  literalValue(
    draft.schemaVersion,
    BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA,
    `${path}.draft.schemaVersion`,
  );
  const draftFingerprint = parseFingerprint(
    draft.fingerprint,
    `${path}.draft.fingerprint`,
  );
  const draftId = safeId(draft.draftId, `${path}.draft.draftId`);
  if (draftId !== `build123d-execution-draft-${draftFingerprint.digest}`) {
    throw new TypeError(
      `${path}.draft.draftId must be derived from its exact fingerprint.`,
    );
  }

  const publication = exactRecord(
    root.publication,
    ["fingerprint"],
    `${path}.publication`,
  );
  const step = exactRecord(
    root.step,
    ["role", "basename", "mediaType", "format", "sha256", "byteCount"],
    `${path}.step`,
  );
  for (
    const key of ["role", "basename", "mediaType", "format"] as const
  ) {
    literalValue(
      step[key],
      BUILD123D_EXECUTION_OUTPUT[key],
      `${path}.step.${key}`,
    );
  }

  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "subjectId", "fingerprint"],
    `${path}.basis`,
  );
  const snapshotId = safeId(basis.snapshotId, `${path}.basis.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path}.basis.snapshotId must name an exact snapshot.`);
  }

  return deepFreeze({
    schemaVersion: ISOLATED_GEOMETRY_SEAL_ADMISSION_SCHEMA,
    executionCapture: {
      id: executionCaptureId,
      fingerprint: executionFingerprint,
    },
    draft: {
      schemaVersion: BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA,
      draftId,
      fingerprint: draftFingerprint,
    },
    publication: {
      fingerprint: parseFingerprint(
        publication.fingerprint,
        `${path}.publication.fingerprint`,
      ),
    },
    step: {
      ...BUILD123D_EXECUTION_OUTPUT,
      sha256: canonicalSha256(step.sha256, `${path}.step.sha256`),
      byteCount: nonNegativeInteger(step.byteCount, `${path}.step.byteCount`),
    },
    basis: {
      snapshotId,
      revision: positiveInteger(basis.revision, `${path}.basis.revision`),
      subjectId: safeId(basis.subjectId, `${path}.basis.subjectId`),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        `${path}.basis.fingerprint`,
      ),
    },
  });
}

function parameterSpecs(
  admission: IsolatedGeometrySealAdmission,
): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const add = (key: string, label: string, value: ParameterValue) => {
    specs.push({ key, label, value });
  };
  add(
    `${PARAMETER_PREFIX}.schemaVersion`,
    "Isolated geometry seal admission schema",
    admission.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.operation`,
    "Reviewed operation",
    `${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id}@${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version}`,
  );
  add(
    `${PARAMETER_PREFIX}.executionCapture.id`,
    "Execution capture artifact ID",
    admission.executionCapture.id,
  );
  add(
    `${PARAMETER_PREFIX}.executionCapture.sha256`,
    "Execution capture SHA-256",
    admission.executionCapture.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.draft.schemaVersion`,
    "Noncanonical execution draft schema",
    admission.draft.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.draft.draftId`,
    "Noncanonical execution draft ID",
    admission.draft.draftId,
  );
  add(
    `${PARAMETER_PREFIX}.draft.sha256`,
    "Noncanonical execution draft SHA-256",
    admission.draft.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.publication.sha256`,
    "Isolated-output publication SHA-256",
    admission.publication.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.step.role`,
    "Published STEP role",
    admission.step.role,
  );
  add(
    `${PARAMETER_PREFIX}.step.basename`,
    "Published STEP basename",
    admission.step.basename,
  );
  add(
    `${PARAMETER_PREFIX}.step.mediaType`,
    "Published STEP media type",
    admission.step.mediaType,
  );
  add(
    `${PARAMETER_PREFIX}.step.format`,
    "Published STEP format",
    admission.step.format,
  );
  add(
    `${PARAMETER_PREFIX}.step.sha256`,
    "Published STEP SHA-256",
    admission.step.sha256,
  );
  add(
    `${PARAMETER_PREFIX}.step.byteCount`,
    "Published STEP byte count",
    admission.step.byteCount,
  );
  add(
    `${PARAMETER_PREFIX}.basis.snapshotId`,
    "Seal Thread basis snapshot ID",
    admission.basis.snapshotId,
  );
  add(
    `${PARAMETER_PREFIX}.basis.revision`,
    "Seal Thread basis revision",
    admission.basis.revision,
  );
  add(
    `${PARAMETER_PREFIX}.basis.subjectId`,
    "Seal Thread basis subject ID",
    admission.basis.subjectId,
  );
  add(
    `${PARAMETER_PREFIX}.basis.sha256`,
    "Seal Thread basis snapshot SHA-256",
    admission.basis.fingerprint.digest,
  );
  if (specs.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      "Isolated geometry seal MRTR grammar is internally inconsistent.",
    );
  }
  return specs;
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

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
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

function requireValue(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ParameterValue {
  if (!values.has(key)) throw new TypeError(`$parameters is missing key ${key}.`);
  return values.get(key)!;
}

function requireId(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return safeId(requireValue(values, key), `$parameters.${key}`);
}

function requireLiteral<const Value extends string>(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  expected: Value,
): Value {
  literalValue(requireValue(values, key), expected, `$parameters.${key}`);
  return expected;
}

function requireFingerprint(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ContentFingerprint {
  return deepFreeze({
    algorithm: "sha256",
    digest: requireSha256(values, key),
  });
}

function requireSha256(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return canonicalSha256(requireValue(values, key), `$parameters.${key}`);
}

function requirePositiveInteger(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  return positiveInteger(requireValue(values, key), `$parameters.${key}`);
}

function requireNonNegativeInteger(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  return nonNegativeInteger(requireValue(values, key), `$parameters.${key}`);
}
