/**
 * Closed MRTR grammar for a factual assembly-integrity observation.
 *
 * The public review command names only the project, exact Thread basis and
 * exact geometry-module capture. The resolver selects the observation profile,
 * method and configured runtime server-side, then this grammar carries those
 * reviewed identities into the human-signed decision. It contains no provider,
 * tool, caller-selected runtime, child transform, product criterion, or verdict.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../project/thread-tip.ts";
import type { EngineeringThreadSnapshotBasis } from "../../project/engineering-project.ts";
import {
  type AssemblyIntegrityMethodIdentity,
  validateAssemblyIntegrityMethodIdentity,
} from "./assembly-integrity-input-bundle.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "./assembly-integrity-observation.ts";

export const ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA =
  "assembly-integrity-observation-admission/1.0" as const;

/**
 * Neutral configured-runtime identity. It identifies immutable execution
 * material only; no provider, tool, endpoint, path, argument or lease crosses
 * the MRTR boundary.
 */
export type AssemblyIntegrityConfiguredRuntime = {
  readonly kind: "image-digest";
  readonly imageDigest: ContentFingerprint;
};

/**
 * Complete reviewable identity for one future factual observation.
 *
 * `observer` is deliberately capability-neutral. It identifies the
 * server-owned profile and factual method but exposes neither a provider nor
 * any executable or dispatch capability.
 */
export interface AssemblyIntegrityObservationAdmission {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA;
  readonly operation: typeof VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly geometryModule: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly observer: {
    readonly profile: {
      readonly id: string;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly method: AssemblyIntegrityMethodIdentity;
    /** Exact server-configured runtime identity; never caller-selected. */
    readonly configuredRuntime: AssemblyIntegrityConfiguredRuntime;
  };
}

type ParameterValue = EngineeringDecisionProposalParameter["value"];

interface ParameterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: ParameterValue;
}

const PARAMETER_PREFIX = "verify.assemblyIntegrity.observation";
const FIXED_PARAMETER_COUNT = 17;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Encode the complete admission in the one signed MRTR sequence. */
export function encodeAssemblyIntegrityObservationAdmissionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateAssemblyIntegrityObservationAdmission(value);
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

/**
 * Parse the signed MRTR sequence without accepting alternate keys, labels,
 * units, order, scalar types, aliases, or derived identities.
 */
export function parseAssemblyIntegrityObservationAdmissionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): AssemblyIntegrityObservationAdmission {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  if (parameters.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      `$parameters must contain exactly ${FIXED_PARAMETER_COUNT} entries.`,
    );
  }

  const values = new Map<string, ParameterValue>();
  const keys: string[] = [];
  const labels = new Map<string, string>();
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
      parameterValue(record.value, `$parameters[${index}].value`),
    );
    labels.set(key, parameterLabel(record.label, `$parameters[${index}].label`));
    keys.push(key);
  }

  const parsed = validateAssemblyIntegrityObservationAdmission({
    schemaVersion: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.schemaVersion`,
      ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
    ),
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: requireExactId(values, `${PARAMETER_PREFIX}.projectId`),
    basis: {
      kind: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.basis.kind`,
        "thread-snapshot",
      ),
      snapshotId: requireExactId(
        values,
        `${PARAMETER_PREFIX}.basis.snapshotId`,
      ),
      revision: requirePositiveInteger(
        values,
        `${PARAMETER_PREFIX}.basis.revision`,
      ),
      subjectId: requireExactId(
        values,
        `${PARAMETER_PREFIX}.basis.subjectId`,
      ),
    },
    geometryModule: {
      artifactId: requireExactId(
        values,
        `${PARAMETER_PREFIX}.geometryModule.artifactId`,
      ),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.geometryModule.sha256`,
      ),
    },
    observer: {
      profile: {
        id: requireExactId(values, `${PARAMETER_PREFIX}.observer.profile.id`),
        version: requireExactVersion(
          values,
          `${PARAMETER_PREFIX}.observer.profile.version`,
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.observer.profile.sha256`,
        ),
      },
      method: {
        id: requireExactId(values, `${PARAMETER_PREFIX}.observer.method.id`),
        version: requireExactVersion(
          values,
          `${PARAMETER_PREFIX}.observer.method.version`,
        ),
        linearToleranceMm: requireNonNegativeFinite(
          values,
          `${PARAMETER_PREFIX}.observer.method.linearToleranceMm`,
        ),
      },
      configuredRuntime: {
        kind: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.observer.configuredRuntime.kind`,
          "image-digest",
        ),
        imageDigest: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.observer.configuredRuntime.imageSha256`,
        ),
      },
    },
  });

  const expected = parameterSpecs(parsed);
  for (const [index, spec] of expected.entries()) {
    if (keys[index] !== spec.key) {
      throw new TypeError(
        `$parameters[${index}].key must equal ${spec.key}.`,
      );
    }
    if (labels.get(spec.key) !== spec.label) {
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

/** Validate the closed object form used only behind the review resolver. */
export function validateAssemblyIntegrityObservationAdmission(
  value: unknown,
  path = "$assemblyIntegrityObservationAdmission",
): AssemblyIntegrityObservationAdmission {
  const root = exactRecord(
    value,
    ["schemaVersion", "operation", "projectId", "basis", "geometryModule", "observer"],
    path,
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    `${path}.operation.version`,
  );

  const geometryModule = exactRecord(
    root.geometryModule,
    ["artifactId", "fingerprint"],
    `${path}.geometryModule`,
  );
  const fingerprint = validateContentFingerprint(
    geometryModule.fingerprint,
    `${path}.geometryModule.fingerprint`,
  );
  const artifactId = exactId(
    geometryModule.artifactId,
    `${path}.geometryModule.artifactId`,
  );
  if (artifactId !== `geometry-${fingerprint.digest}`) {
    throw new TypeError(
      `${path}.geometryModule.artifactId must equal geometry-<sha256>.`,
    );
  }

  const observer = exactRecord(
    root.observer,
    ["profile", "method", "configuredRuntime"],
    `${path}.observer`,
  );
  const profile = exactRecord(
    observer.profile,
    ["id", "version", "fingerprint"],
    `${path}.observer.profile`,
  );
  const method = validateAssemblyIntegrityMethodIdentity(
    observer.method,
    `${path}.observer.method`,
  );
  assertNotLatest(method.id, `${path}.observer.method.id`);
  assertNotLatest(method.version, `${path}.observer.method.version`);

  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_ADMISSION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: exactId(root.projectId, `${path}.projectId`),
    basis: parseExactThreadSnapshotBasis(root.basis, `${path}.basis`),
    geometryModule: { artifactId, fingerprint },
    observer: {
      profile: {
        id: exactId(profile.id, `${path}.observer.profile.id`),
        version: exactVersion(profile.version, `${path}.observer.profile.version`),
        fingerprint: validateContentFingerprint(
          profile.fingerprint,
          `${path}.observer.profile.fingerprint`,
        ),
      },
      method,
      configuredRuntime: parseConfiguredRuntime(
        observer.configuredRuntime,
        `${path}.observer.configuredRuntime`,
      ),
    },
  });
}

function parameterSpecs(
  admission: AssemblyIntegrityObservationAdmission,
): readonly ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const add = (key: string, label: string, value: ParameterValue) =>
    specs.push({ key, label, value });
  add(
    `${PARAMETER_PREFIX}.schemaVersion`,
    "Assembly-integrity observation admission schema",
    admission.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.operation`,
    "Reviewed operation",
    `${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version}`,
  );
  add(`${PARAMETER_PREFIX}.projectId`, "Project ID", admission.projectId);
  add(`${PARAMETER_PREFIX}.basis.kind`, "Thread basis kind", admission.basis.kind);
  add(
    `${PARAMETER_PREFIX}.basis.snapshotId`,
    "Thread snapshot ID",
    admission.basis.snapshotId,
  );
  add(
    `${PARAMETER_PREFIX}.basis.revision`,
    "Thread snapshot revision",
    admission.basis.revision,
  );
  add(
    `${PARAMETER_PREFIX}.basis.subjectId`,
    "Thread subject ID",
    admission.basis.subjectId,
  );
  add(
    `${PARAMETER_PREFIX}.geometryModule.artifactId`,
    "Geometry-module artifact ID",
    admission.geometryModule.artifactId,
  );
  add(
    `${PARAMETER_PREFIX}.geometryModule.sha256`,
    "Geometry-module SHA-256",
    admission.geometryModule.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.observer.profile.id`,
    "Observer profile ID",
    admission.observer.profile.id,
  );
  add(
    `${PARAMETER_PREFIX}.observer.profile.version`,
    "Observer profile version",
    admission.observer.profile.version,
  );
  add(
    `${PARAMETER_PREFIX}.observer.profile.sha256`,
    "Observer profile SHA-256",
    admission.observer.profile.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.observer.method.id`,
    "Observation method ID",
    admission.observer.method.id,
  );
  add(
    `${PARAMETER_PREFIX}.observer.method.version`,
    "Observation method version",
    admission.observer.method.version,
  );
  add(
    `${PARAMETER_PREFIX}.observer.method.linearToleranceMm`,
    "Method linear tolerance (mm)",
    admission.observer.method.linearToleranceMm,
  );
  add(
    `${PARAMETER_PREFIX}.observer.configuredRuntime.kind`,
    "Configured runtime kind",
    admission.observer.configuredRuntime.kind,
  );
  add(
    `${PARAMETER_PREFIX}.observer.configuredRuntime.imageSha256`,
    "Configured runtime image SHA-256",
    admission.observer.configuredRuntime.imageDigest.digest,
  );
  if (specs.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      "Assembly-integrity observation MRTR grammar is internally inconsistent.",
    );
  }
  return specs;
}

function exactId(value: unknown, path: string): string {
  const id = safeId(value, path);
  assertNotLatest(id, path);
  return id;
}

function exactVersion(value: unknown, path: string): string {
  const version = safeVersion(value, path);
  assertNotLatest(version, path);
  return version;
}

function assertNotLatest(value: string, path: string): void {
  if (value.toLowerCase() === "latest") {
    throw new TypeError(`${path} must not use a latest alias.`);
  }
}

function parameterValue(value: unknown, path: string): ParameterValue {
  if (
    (typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "boolean") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new TypeError(`${path} must be a finite MRTR scalar.`);
  }
  return value;
}

function parameterLabel(value: unknown, path: string): string {
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

function requireLiteral<const Value extends string>(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  expected: Value,
): Value {
  literalValue(requireValue(values, key), expected, `$parameters.${key}`);
  return expected;
}

function requireExactId(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return exactId(requireValue(values, key), `$parameters.${key}`);
}

function requireExactVersion(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return exactVersion(requireValue(values, key), `$parameters.${key}`);
}

function requireFingerprint(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ContentFingerprint {
  const digest = requireValue(values, key);
  if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
    throw new TypeError(`$parameters.${key} must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest });
}

function requirePositiveInteger(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  const value = requireValue(values, key);
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`$parameters.${key} must be a positive integer.`);
  }
  return Number(value);
}

function requireNonNegativeFinite(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  const value = finite(requireValue(values, key), `$parameters.${key}`);
  if (value < 0) {
    throw new TypeError(`${key} must be non-negative.`);
  }
  return value;
}

function parseConfiguredRuntime(
  value: unknown,
  path: string,
): AssemblyIntegrityConfiguredRuntime {
  const runtime = exactRecord(value, ["kind", "imageDigest"], path);
  literalValue(runtime.kind, "image-digest", `${path}.kind`);
  return deepFreeze({
    kind: "image-digest" as const,
    imageDigest: validateContentFingerprint(runtime.imageDigest, `${path}.imageDigest`),
  });
}
