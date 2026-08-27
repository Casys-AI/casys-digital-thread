/**
 * Closed MRTR identity for the provider-free L4 assembly-integrity evaluator.
 *
 * A public review supplies only a project id. The server derives the exact
 * Thread basis, L3 evidence, module, STEP, bundle, and code-owned method.
 * Provider, tool, tolerance, fact values, criteria, and verdicts are not
 * representable by this admission.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../project/thread-tip.ts";
import { ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA } from "./assembly-integrity-input-bundle.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "./assembly-integrity-evaluation-proposal.ts";

export const ASSEMBLY_INTEGRITY_EVALUATION_ADMISSION_SCHEMA =
  "assembly-integrity-evaluation-admission/1.0" as const;

export interface AssemblyIntegrityEvaluationAdmission {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_ADMISSION_SCHEMA;
  readonly operation: typeof VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly observation: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly observationFingerprint: ContentFingerprint;
  };
  readonly geometryModule: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly assemblyStep: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly inputBundle: {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  /** Executor derives and rehashes the full code-owned method body. */
  readonly method: {
    readonly schemaVersion: string;
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
}

const PREFIX = "verify.assemblyIntegrity.evaluation";
const KEYS = [
  "schemaVersion",
  "projectId",
  "basis.kind",
  "basis.snapshotId",
  "basis.revision",
  "basis.subjectId",
  "observation.artifactId",
  "observation.sha256",
  "observation.normalizedObservationSha256",
  "geometryModule.artifactId",
  "geometryModule.sha256",
  "assemblyStep.artifactId",
  "assemblyStep.sha256",
  "inputBundle.schemaVersion",
  "inputBundle.sha256",
  "inputBundle.byteCount",
  "method.schemaVersion",
  "method.id",
  "method.version",
  "method.sha256",
] as const;
type Key = (typeof KEYS)[number];
type Scalar = EngineeringDecisionProposalParameter["value"];

/** Encode the full server-derived selection in one canonical signed sequence. */
export function encodeAssemblyIntegrityEvaluationAdmissionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateAssemblyIntegrityEvaluationAdmission(value);
  return deepFreeze(
    specs(admission).map((spec) =>
      deepFreeze({
        key: `${PREFIX}.${spec.key}`,
        label: `${PREFIX}.${spec.key}`,
        value: spec.value,
      })
    ),
  );
}

/** Parse MRTR scalars exactly: no aliases, units, reordered fields, or extras. */
export function parseAssemblyIntegrityEvaluationAdmissionParameters(
  value: unknown,
): AssemblyIntegrityEvaluationAdmission {
  if (!Array.isArray(value) || value.length !== KEYS.length) {
    throw new TypeError(`$parameters must contain exactly ${KEYS.length} entries.`);
  }
  const values = new Map<Key, Scalar>();
  for (const [index, candidate] of value.entries()) {
    const root = exactRecord(
      candidate,
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    const key = KEYS[index]!;
    literalValue(root.key, `${PREFIX}.${key}`, `$parameters[${index}].key`);
    literalValue(root.label, `${PREFIX}.${key}`, `$parameters[${index}].label`);
    if (
      (typeof root.value !== "string" && typeof root.value !== "number" &&
        typeof root.value !== "boolean") ||
      (typeof root.value === "number" && !Number.isFinite(root.value))
    ) {
      throw new TypeError(`$parameters[${index}].value must be a finite scalar.`);
    }
    values.set(key, root.value);
  }
  const admission = validateAssemblyIntegrityEvaluationAdmission({
    schemaVersion: literal(
      values,
      "schemaVersion",
      ASSEMBLY_INTEGRITY_EVALUATION_ADMISSION_SCHEMA,
    ),
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: id(values, "projectId"),
    basis: {
      kind: literal(values, "basis.kind", "thread-snapshot"),
      snapshotId: id(values, "basis.snapshotId"),
      revision: integer(values, "basis.revision"),
      subjectId: id(values, "basis.subjectId"),
    },
    observation: {
      artifactId: id(values, "observation.artifactId"),
      fingerprint: fingerprint(values, "observation.sha256"),
      observationFingerprint: fingerprint(
        values,
        "observation.normalizedObservationSha256",
      ),
    },
    geometryModule: {
      artifactId: id(values, "geometryModule.artifactId"),
      fingerprint: fingerprint(values, "geometryModule.sha256"),
    },
    assemblyStep: {
      artifactId: id(values, "assemblyStep.artifactId"),
      fingerprint: fingerprint(values, "assemblyStep.sha256"),
    },
    inputBundle: {
      schemaVersion: literal(
        values,
        "inputBundle.schemaVersion",
        ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
      ),
      fingerprint: fingerprint(values, "inputBundle.sha256"),
      byteCount: integer(values, "inputBundle.byteCount"),
    },
    method: {
      schemaVersion: text(values, "method.schemaVersion"),
      id: id(values, "method.id"),
      version: version(values, "method.version"),
      fingerprint: fingerprint(values, "method.sha256"),
    },
  });
  if (
    deterministicJson(
      encodeAssemblyIntegrityEvaluationAdmissionParameters(admission),
    ) !==
      deterministicJson(value)
  ) {
    throw new TypeError("$parameters does not replay the exact evaluation admission.");
  }
  return admission;
}

export function validateAssemblyIntegrityEvaluationAdmission(
  value: unknown,
): AssemblyIntegrityEvaluationAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "projectId",
    "basis",
    "observation",
    "geometryModule",
    "assemblyStep",
    "inputBundle",
    "method",
  ], "$assemblyIntegrityEvaluationAdmission");
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_EVALUATION_ADMISSION_SCHEMA,
    "$assemblyIntegrityEvaluationAdmission.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$assemblyIntegrityEvaluationAdmission.operation",
  );
  literalValue(
    operation.id,
    VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
    "$assemblyIntegrityEvaluationAdmission.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
    "$assemblyIntegrityEvaluationAdmission.operation.version",
  );
  const observation = observationReference(root.observation);
  const geometryModule = geometryReference(root.geometryModule);
  const assemblyStep = stepReference(root.assemblyStep, geometryModule);
  const inputBundle = bundleReference(root.inputBundle);
  const method = methodReference(root.method);
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_ADMISSION_SCHEMA,
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: safeId(
      root.projectId,
      "$assemblyIntegrityEvaluationAdmission.projectId",
    ),
    basis: parseExactThreadSnapshotBasis(
      root.basis,
      "$assemblyIntegrityEvaluationAdmission.basis",
    ),
    observation,
    geometryModule,
    assemblyStep,
    inputBundle,
    method,
  });
}

function observationReference(
  value: unknown,
): AssemblyIntegrityEvaluationAdmission["observation"] {
  const root = exactRecord(value, [
    "artifactId",
    "fingerprint",
    "observationFingerprint",
  ], "$assemblyIntegrityEvaluationAdmission.observation");
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$assemblyIntegrityEvaluationAdmission.observation.fingerprint",
  );
  const artifactId = safeId(
    root.artifactId,
    "$assemblyIntegrityEvaluationAdmission.observation.artifactId",
  );
  if (artifactId !== `assembly-integrity-observation-${fingerprint.digest}`) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationAdmission.observation.artifactId must bind the capture fingerprint.",
    );
  }
  return deepFreeze({
    artifactId,
    fingerprint,
    observationFingerprint: validateContentFingerprint(
      root.observationFingerprint,
      "$assemblyIntegrityEvaluationAdmission.observation.observationFingerprint",
    ),
  });
}

function geometryReference(
  value: unknown,
): AssemblyIntegrityEvaluationAdmission["geometryModule"] {
  const root = exactRecord(
    value,
    ["artifactId", "fingerprint"],
    "$assemblyIntegrityEvaluationAdmission.geometryModule",
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$assemblyIntegrityEvaluationAdmission.geometryModule.fingerprint",
  );
  const artifactId = safeId(
    root.artifactId,
    "$assemblyIntegrityEvaluationAdmission.geometryModule.artifactId",
  );
  if (artifactId !== `geometry-${fingerprint.digest}`) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationAdmission.geometryModule.artifactId must bind the capture fingerprint.",
    );
  }
  return deepFreeze({ artifactId, fingerprint });
}

function stepReference(
  value: unknown,
  geometryModule: AssemblyIntegrityEvaluationAdmission["geometryModule"],
): AssemblyIntegrityEvaluationAdmission["assemblyStep"] {
  const root = exactRecord(
    value,
    ["artifactId", "fingerprint"],
    "$assemblyIntegrityEvaluationAdmission.assemblyStep",
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$assemblyIntegrityEvaluationAdmission.assemblyStep.fingerprint",
  );
  const artifactId = safeId(
    root.artifactId,
    "$assemblyIntegrityEvaluationAdmission.assemblyStep.artifactId",
  );
  if (
    artifactId !==
      `cad-asset-${geometryModule.fingerprint.digest}-module-step-${fingerprint.digest}`
  ) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationAdmission.assemblyStep.artifactId must bind the exact geometry-module and STEP fingerprints.",
    );
  }
  return deepFreeze({ artifactId, fingerprint });
}

function bundleReference(
  value: unknown,
): AssemblyIntegrityEvaluationAdmission["inputBundle"] {
  const root = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount"],
    "$assemblyIntegrityEvaluationAdmission.inputBundle",
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    "$assemblyIntegrityEvaluationAdmission.inputBundle.schemaVersion",
  );
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$assemblyIntegrityEvaluationAdmission.inputBundle.fingerprint",
    ),
    byteCount: positiveInteger(
      root.byteCount,
      "$assemblyIntegrityEvaluationAdmission.inputBundle.byteCount",
    ),
  });
}

function methodReference(
  value: unknown,
): AssemblyIntegrityEvaluationAdmission["method"] {
  const root = exactRecord(
    value,
    ["schemaVersion", "id", "version", "fingerprint"],
    "$assemblyIntegrityEvaluationAdmission.method",
  );
  return deepFreeze({
    schemaVersion: boundedText(
      root.schemaVersion,
      "$assemblyIntegrityEvaluationAdmission.method.schemaVersion",
    ),
    id: safeId(root.id, "$assemblyIntegrityEvaluationAdmission.method.id"),
    version: safeVersion(
      root.version,
      "$assemblyIntegrityEvaluationAdmission.method.version",
    ),
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$assemblyIntegrityEvaluationAdmission.method.fingerprint",
    ),
  });
}

function specs(
  value: AssemblyIntegrityEvaluationAdmission,
): readonly { readonly key: Key; readonly value: Scalar }[] {
  const entries: Record<Key, Scalar> = {
    schemaVersion: value.schemaVersion,
    projectId: value.projectId,
    "basis.kind": value.basis.kind,
    "basis.snapshotId": value.basis.snapshotId,
    "basis.revision": value.basis.revision,
    "basis.subjectId": value.basis.subjectId,
    "observation.artifactId": value.observation.artifactId,
    "observation.sha256": value.observation.fingerprint.digest,
    "observation.normalizedObservationSha256":
      value.observation.observationFingerprint.digest,
    "geometryModule.artifactId": value.geometryModule.artifactId,
    "geometryModule.sha256": value.geometryModule.fingerprint.digest,
    "assemblyStep.artifactId": value.assemblyStep.artifactId,
    "assemblyStep.sha256": value.assemblyStep.fingerprint.digest,
    "inputBundle.schemaVersion": value.inputBundle.schemaVersion,
    "inputBundle.sha256": value.inputBundle.fingerprint.digest,
    "inputBundle.byteCount": value.inputBundle.byteCount,
    "method.schemaVersion": value.method.schemaVersion,
    "method.id": value.method.id,
    "method.version": value.method.version,
    "method.sha256": value.method.fingerprint.digest,
  };
  return KEYS.map((key) => ({ key, value: entries[key] }));
}

function required(values: ReadonlyMap<Key, Scalar>, key: Key): Scalar {
  const value = values.get(key);
  if (value === undefined) throw new TypeError(`$parameters is missing ${key}.`);
  return value;
}

function literal<const Value extends string>(
  values: ReadonlyMap<Key, Scalar>,
  key: Key,
  expected: Value,
): Value {
  literalValue(required(values, key), expected, `$parameters.${key}`);
  return expected;
}

function id(values: ReadonlyMap<Key, Scalar>, key: Key): string {
  return safeId(required(values, key), `$parameters.${key}`);
}

function version(values: ReadonlyMap<Key, Scalar>, key: Key): string {
  return safeVersion(required(values, key), `$parameters.${key}`);
}

function integer(values: ReadonlyMap<Key, Scalar>, key: Key): number {
  return positiveInteger(required(values, key), `$parameters.${key}`);
}

function fingerprint(values: ReadonlyMap<Key, Scalar>, key: Key): ContentFingerprint {
  const digest = required(values, key);
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`$parameters.${key} must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
}

function text(values: ReadonlyMap<Key, Scalar>, key: Key): string {
  return boundedText(required(values, key), `$parameters.${key}`);
}

function boundedText(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    value !== value.trim() || /[^\x20-\x7e]/.test(value)
  ) {
    throw new TypeError(`${path} must be bounded printable ASCII text.`);
  }
  return value;
}
