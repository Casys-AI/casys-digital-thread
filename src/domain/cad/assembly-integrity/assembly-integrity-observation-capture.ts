/**
 * Canonical L3 factual evidence for one exact assembly-integrity observation.
 *
 * This capture records facts and recrossed provenance only. It cannot express
 * a verdict, fitness claim, safety conclusion, motion result, or strength
 * result; those remain separate L4/L5 authority surfaces.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import type { EngineeringThreadSnapshotBasis } from "../../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../project/thread-tip.ts";
import type {
  AssemblyIntegrityGeometryModuleReference,
} from "./assembly-integrity-input-bundle.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
} from "./assembly-integrity-input-bundle.ts";
import {
  type AssemblyIntegrityInputBundleIdentity,
  type AssemblyIntegrityObservation,
  validateAssemblyIntegrityObservation,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-observation.ts";
import type {
  AssemblyIntegrityObserverConfiguredRuntime,
} from "./assembly-integrity-observer-profile.ts";

export const ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA =
  "assembly-integrity-observation-capture/1.0" as const;
export const ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_URI_PREFIX =
  "casys://assembly-integrity-observation-capture/sha256/" as const;

export interface AssemblyIntegrityObservationCaptureExecution {
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly configuredRuntime: AssemblyIntegrityObserverConfiguredRuntime;
  /** Opaque factual call provenance, never a sandbox attestation. */
  readonly raw: {
    readonly schemaVersion: string;
    readonly producer: {
      readonly service: string;
      readonly packageVersion: string;
      readonly tool: string;
      readonly engine: {
        readonly id: string;
        readonly version: string;
      };
    };
    readonly requestFingerprint: ContentFingerprint;
    readonly responseFingerprint: ContentFingerprint;
  };
}

export interface AssemblyIntegrityObservationCapture {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA;
  readonly kind: "assembly-integrity-observation";
  readonly operation: typeof VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION;
  readonly trustedRunId: string;
  readonly observedAt: string;
  /** The exact technical Thread state that admitted this factual run. */
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly geometryModule: AssemblyIntegrityGeometryModuleReference;
  readonly assemblyStep: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly inputBundle: AssemblyIntegrityInputBundleIdentity;
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
    readonly configuredRuntime: AssemblyIntegrityObserverConfiguredRuntime;
  };
  readonly execution: AssemblyIntegrityObservationCaptureExecution;
  readonly observationFingerprint: ContentFingerprint;
  readonly observation: AssemblyIntegrityObservation;
  readonly limits: {
    readonly verdict: "none";
    readonly fitness: "none";
    readonly safety: "none";
    readonly motion: "none";
    readonly strength: "none";
  };
}

export type AssemblyIntegrityObservationCaptureInput = Omit<
  AssemblyIntegrityObservationCapture,
  "observationFingerprint"
>;

/** Build the capture and bind the exact normalized observation fingerprint. */
export async function createAssemblyIntegrityObservationCapture(
  value: AssemblyIntegrityObservationCaptureInput,
): Promise<AssemblyIntegrityObservationCapture> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "operation",
      "trustedRunId",
      "observedAt",
      "basis",
      "geometryModule",
      "assemblyStep",
      "inputBundle",
      "profile",
      "execution",
      "observation",
      "limits",
    ],
    "$assemblyIntegrityObservationCaptureInput",
  );
  const observation = validateAssemblyIntegrityObservation(root.observation);
  const observationFingerprint = await sha256Fingerprint(observation);
  return await validateAssemblyIntegrityObservationCapture({
    ...root,
    observation,
    observationFingerprint,
  });
}

/** Reopen and validate a complete persisted L3 capture. */
export async function validateAssemblyIntegrityObservationCapture(
  value: unknown,
): Promise<AssemblyIntegrityObservationCapture> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "operation",
      "trustedRunId",
      "observedAt",
      "basis",
      "geometryModule",
      "assemblyStep",
      "inputBundle",
      "profile",
      "execution",
      "observationFingerprint",
      "observation",
      "limits",
    ],
    "$assemblyIntegrityObservationCapture",
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA,
    "$assemblyIntegrityObservationCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "assembly-integrity-observation",
    "$assemblyIntegrityObservationCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$assemblyIntegrityObservationCapture.operation",
  );
  literalValue(
    operation.id,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    "$assemblyIntegrityObservationCapture.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    "$assemblyIntegrityObservationCapture.operation.version",
  );
  const trustedRunId = safeId(
    root.trustedRunId,
    "$assemblyIntegrityObservationCapture.trustedRunId",
  );
  const observedAt = parseIsoInstant(
    root.observedAt,
    "$assemblyIntegrityObservationCapture.observedAt",
  );
  const basis = parseBasis(root.basis);
  const geometryModule = parseGeometryModule(root.geometryModule);
  const assemblyStep = parseAssemblyStep(root.assemblyStep, geometryModule);
  const inputBundle = parseInputBundle(root.inputBundle);
  const profile = parseProfile(root.profile);
  const execution = parseExecution(root.execution);
  const observation = validateAssemblyIntegrityObservation(root.observation);
  const observationFingerprint = validateContentFingerprint(
    root.observationFingerprint,
    "$assemblyIntegrityObservationCapture.observationFingerprint",
  );
  const expectedObservationFingerprint = await sha256Fingerprint(observation);
  if (!fingerprintsEqual(observationFingerprint, expectedObservationFingerprint)) {
    throw new TypeError(
      "$assemblyIntegrityObservationCapture.observationFingerprint does not bind the normalized observation.",
    );
  }
  const limits = parseLimits(root.limits);
  assertObservationBinding(observation, inputBundle);
  assertExecutionBinding(profile, execution);

  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-observation",
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId,
    observedAt,
    basis,
    geometryModule,
    assemblyStep,
    inputBundle,
    profile,
    execution,
    observationFingerprint,
    observation,
    limits,
  });
}

export async function fingerprintAssemblyIntegrityObservationCapture(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    await validateAssemblyIntegrityObservationCapture(value),
  );
}

export async function canonicalAssemblyIntegrityObservationCaptureText(
  value: unknown,
): Promise<string> {
  return deterministicJson(await validateAssemblyIntegrityObservationCapture(value));
}

export function assemblyIntegrityObservationCaptureUri(digest: string): string {
  requireDigest(digest, "$assemblyIntegrityObservationCaptureUri.digest");
  return `${ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_URI_PREFIX}${digest}`;
}

function parseBasis(
  value: unknown,
): AssemblyIntegrityObservationCapture["basis"] {
  return parseExactThreadSnapshotBasis(
    value,
    "$assemblyIntegrityObservationCapture.basis",
  );
}

function parseGeometryModule(
  value: unknown,
): AssemblyIntegrityGeometryModuleReference {
  const root = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint"],
    "$assemblyIntegrityObservationCapture.geometryModule",
  );
  literalValue(
    root.schemaVersion,
    "geometry-module-capture/1.0",
    "$assemblyIntegrityObservationCapture.geometryModule.schemaVersion",
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$assemblyIntegrityObservationCapture.geometryModule.fingerprint",
  );
  const artifactId = safeId(
    root.artifactId,
    "$assemblyIntegrityObservationCapture.geometryModule.artifactId",
  );
  if (artifactId !== `geometry-${fingerprint.digest}`) {
    throw new TypeError(
      "$assemblyIntegrityObservationCapture.geometryModule.artifactId must equal geometry-<sha256>.",
    );
  }
  return deepFreeze({
    schemaVersion: "geometry-module-capture/1.0",
    artifactId,
    fingerprint,
  });
}

function parseAssemblyStep(
  value: unknown,
  geometryModule: AssemblyIntegrityGeometryModuleReference,
): AssemblyIntegrityObservationCapture["assemblyStep"] {
  const root = exactRecord(
    value,
    ["artifactId", "fingerprint"],
    "$assemblyIntegrityObservationCapture.assemblyStep",
  );
  const artifactId = safeId(
    root.artifactId,
    "$assemblyIntegrityObservationCapture.assemblyStep.artifactId",
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$assemblyIntegrityObservationCapture.assemblyStep.fingerprint",
  );
  const expectedArtifactId =
    `cad-asset-${geometryModule.fingerprint.digest}-module-step-${fingerprint.digest}`;
  if (artifactId !== expectedArtifactId) {
    throw new TypeError(
      "$assemblyIntegrityObservationCapture.assemblyStep.artifactId must bind the exact geometry-module and STEP fingerprints.",
    );
  }
  return deepFreeze({ artifactId, fingerprint });
}

function parseInputBundle(
  value: unknown,
): AssemblyIntegrityInputBundleIdentity {
  const root = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount"],
    "$assemblyIntegrityObservationCapture.inputBundle",
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    "$assemblyIntegrityObservationCapture.inputBundle.schemaVersion",
  );
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$assemblyIntegrityObservationCapture.inputBundle.fingerprint",
    ),
    byteCount: positiveInteger(
      root.byteCount,
      "$assemblyIntegrityObservationCapture.inputBundle.byteCount",
    ),
  });
}

function parseProfile(
  value: unknown,
): AssemblyIntegrityObservationCapture["profile"] {
  const root = exactRecord(
    value,
    ["id", "version", "fingerprint", "configuredRuntime"],
    "$assemblyIntegrityObservationCapture.profile",
  );
  return deepFreeze({
    id: safeId(root.id, "$assemblyIntegrityObservationCapture.profile.id"),
    version: safeVersion(
      root.version,
      "$assemblyIntegrityObservationCapture.profile.version",
    ),
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$assemblyIntegrityObservationCapture.profile.fingerprint",
    ),
    configuredRuntime: parseConfiguredRuntime(
      root.configuredRuntime,
      "$assemblyIntegrityObservationCapture.profile.configuredRuntime",
    ),
  });
}

function parseExecution(
  value: unknown,
): AssemblyIntegrityObservationCaptureExecution {
  const root = exactRecord(
    value,
    ["profile", "configuredRuntime", "raw"],
    "$assemblyIntegrityObservationCapture.execution",
  );
  const profile = exactRecord(
    root.profile,
    ["id", "version", "fingerprint"],
    "$assemblyIntegrityObservationCapture.execution.profile",
  );
  const raw = exactRecord(
    root.raw,
    ["schemaVersion", "producer", "requestFingerprint", "responseFingerprint"],
    "$assemblyIntegrityObservationCapture.execution.raw",
  );
  const producer = exactRecord(
    raw.producer,
    ["service", "packageVersion", "tool", "engine"],
    "$assemblyIntegrityObservationCapture.execution.raw.producer",
  );
  const engine = exactRecord(
    producer.engine,
    ["id", "version"],
    "$assemblyIntegrityObservationCapture.execution.raw.producer.engine",
  );
  const schemaVersion = nonEmptyText(
    raw.schemaVersion,
    "$assemblyIntegrityObservationCapture.execution.raw.schemaVersion",
  );
  if (schemaVersion.length > 256 || /[^\x20-\x7e]/.test(schemaVersion)) {
    throw new TypeError(
      "$assemblyIntegrityObservationCapture.execution.raw.schemaVersion must be bounded printable ASCII.",
    );
  }
  return deepFreeze({
    profile: {
      id: safeId(
        profile.id,
        "$assemblyIntegrityObservationCapture.execution.profile.id",
      ),
      version: safeVersion(
        profile.version,
        "$assemblyIntegrityObservationCapture.execution.profile.version",
      ),
      fingerprint: validateContentFingerprint(
        profile.fingerprint,
        "$assemblyIntegrityObservationCapture.execution.profile.fingerprint",
      ),
    },
    configuredRuntime: parseConfiguredRuntime(
      root.configuredRuntime,
      "$assemblyIntegrityObservationCapture.execution.configuredRuntime",
    ),
    raw: {
      schemaVersion,
      producer: {
        service: safeId(
          producer.service,
          "$assemblyIntegrityObservationCapture.execution.raw.producer.service",
        ),
        packageVersion: safeVersion(
          producer.packageVersion,
          "$assemblyIntegrityObservationCapture.execution.raw.producer.packageVersion",
        ),
        tool: safeId(
          producer.tool,
          "$assemblyIntegrityObservationCapture.execution.raw.producer.tool",
        ),
        engine: {
          id: safeId(
            engine.id,
            "$assemblyIntegrityObservationCapture.execution.raw.producer.engine.id",
          ),
          version: safeVersion(
            engine.version,
            "$assemblyIntegrityObservationCapture.execution.raw.producer.engine.version",
          ),
        },
      },
      requestFingerprint: validateContentFingerprint(
        raw.requestFingerprint,
        "$assemblyIntegrityObservationCapture.execution.raw.requestFingerprint",
      ),
      responseFingerprint: validateContentFingerprint(
        raw.responseFingerprint,
        "$assemblyIntegrityObservationCapture.execution.raw.responseFingerprint",
      ),
    },
  });
}

function parseConfiguredRuntime(
  value: unknown,
  path: string,
): AssemblyIntegrityObserverConfiguredRuntime {
  const root = exactRecord(value, ["kind", "imageDigest"], path);
  literalValue(root.kind, "image-digest", `${path}.kind`);
  return deepFreeze({
    kind: "image-digest" as const,
    imageDigest: validateContentFingerprint(root.imageDigest, `${path}.imageDigest`),
  });
}

function parseLimits(
  value: unknown,
): AssemblyIntegrityObservationCapture["limits"] {
  const root = exactRecord(
    value,
    ["verdict", "fitness", "safety", "motion", "strength"],
    "$assemblyIntegrityObservationCapture.limits",
  );
  literalValue(
    root.verdict,
    "none",
    "$assemblyIntegrityObservationCapture.limits.verdict",
  );
  literalValue(
    root.fitness,
    "none",
    "$assemblyIntegrityObservationCapture.limits.fitness",
  );
  literalValue(
    root.safety,
    "none",
    "$assemblyIntegrityObservationCapture.limits.safety",
  );
  literalValue(
    root.motion,
    "none",
    "$assemblyIntegrityObservationCapture.limits.motion",
  );
  literalValue(
    root.strength,
    "none",
    "$assemblyIntegrityObservationCapture.limits.strength",
  );
  return deepFreeze({
    verdict: "none" as const,
    fitness: "none" as const,
    safety: "none" as const,
    motion: "none" as const,
    strength: "none" as const,
  });
}

function assertObservationBinding(
  observation: AssemblyIntegrityObservation,
  inputBundle: AssemblyIntegrityInputBundleIdentity,
): void {
  if (
    observation.inputBundle.schemaVersion !== inputBundle.schemaVersion ||
    observation.inputBundle.byteCount !== inputBundle.byteCount ||
    !fingerprintsEqual(observation.inputBundle.fingerprint, inputBundle.fingerprint)
  ) {
    throw new TypeError(
      "$assemblyIntegrityObservationCapture.observation must name the exact capture input bundle.",
    );
  }
}

function assertExecutionBinding(
  profile: AssemblyIntegrityObservationCapture["profile"],
  execution: AssemblyIntegrityObservationCaptureExecution,
): void {
  if (
    execution.profile.id !== profile.id ||
    execution.profile.version !== profile.version ||
    !fingerprintsEqual(execution.profile.fingerprint, profile.fingerprint) ||
    deterministicJson(execution.configuredRuntime) !==
      deterministicJson(profile.configuredRuntime)
  ) {
    throw new TypeError(
      "$assemblyIntegrityObservationCapture.execution must recross the exact selected profile and configured runtime.",
    );
  }
}

function parseIsoInstant(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result
  ) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 instant.`);
  }
  return result;
}

function requireDigest(value: string, path: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
}
