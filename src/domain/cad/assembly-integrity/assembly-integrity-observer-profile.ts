/**
 * Server-owned capability profile for factual assembly-integrity observation.
 *
 * A profile selects a bounded factual method and input ceilings. It is not a
 * provider endpoint, runtime image, worker command, product criterion, or
 * verdict policy. Those concerns stay respectively in adapters, composition,
 * and later oracle/gate layers.
 */

import {
  deepFreeze,
  exactRecord,
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
import {
  ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES,
  ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS,
  ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES,
  type AssemblyIntegrityMethodIdentity,
  validateAssemblyIntegrityMethodIdentity,
} from "./assembly-integrity-input-bundle.ts";

export const ASSEMBLY_INTEGRITY_OBSERVER_PROFILE_SCHEMA =
  "assembly-integrity-observer-profile/1.0" as const;

export interface AssemblyIntegrityObserverProfileRef {
  readonly id: string;
  readonly version: string;
}

/**
 * Exact factual capability exposed to an application workflow. The capability
 * is deliberately independent of a provider implementation name.
 */
export interface AssemblyIntegrityObserverCapability {
  readonly id: string;
  readonly version: string;
}

/**
 * Opaque producer contract selected by server composition. The neutral domain
 * knows only stable identities; concrete provider/tool names are supplied by
 * the named adapter that owns this profile.
 */
export interface AssemblyIntegrityObserverProducerContract {
  /** Expected provider-native factual result schema. */
  readonly rawSchemaVersion: string;
  readonly engine: {
    readonly id: string;
    readonly version: string;
  };
  readonly package: {
    readonly id: string;
    readonly version: string;
  };
}

/**
 * Deployment configuration selected by the server, not an attestation that a
 * call reached that deployment. The configured runtime is always one exact
 * published image; no opaque generation or fallback can enter review/dispatch.
 */
export interface AssemblyIntegrityObserverConfiguredRuntime {
  readonly kind: "image-digest";
  readonly imageDigest: ContentFingerprint;
}

export interface AssemblyIntegrityObserverProfile {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVER_PROFILE_SCHEMA;
  readonly profile: AssemblyIntegrityObserverProfileRef;
  readonly capability: AssemblyIntegrityObserverCapability;
  readonly method: AssemblyIntegrityMethodIdentity;
  readonly producer: AssemblyIntegrityObserverProducerContract;
  readonly configuredRuntime: AssemblyIntegrityObserverConfiguredRuntime;
  readonly maximumStepBytes: number;
  readonly maximumOccurrences: number;
  readonly maximumPairs: number;
  readonly profileFingerprint: ContentFingerprint;
}

type AssemblyIntegrityObserverProfileFingerprintBody = Omit<
  AssemblyIntegrityObserverProfile,
  "profileFingerprint"
>;

/**
 * Build and seal a profile in one place so adapters cannot silently drift from
 * the exact capability and limits that their catalogue returns.
 */
export async function createAssemblyIntegrityObserverProfile(
  value: AssemblyIntegrityObserverProfileFingerprintBody,
): Promise<AssemblyIntegrityObserverProfile> {
  const body = parseProfileBody(value, "$assemblyIntegrityObserverProfile");
  const profileFingerprint = await sha256Fingerprint(body);
  return deepFreeze({ ...body, profileFingerprint });
}

/** Reopen an already-persisted profile and verify its self-excluded hash. */
export async function validateAssemblyIntegrityObserverProfile(
  value: unknown,
): Promise<AssemblyIntegrityObserverProfile> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "profile",
      "capability",
      "method",
      "producer",
      "configuredRuntime",
      "maximumStepBytes",
      "maximumOccurrences",
      "maximumPairs",
      "profileFingerprint",
    ],
    "$assemblyIntegrityObserverProfile",
  );
  const body = parseProfileBody({
    schemaVersion: root.schemaVersion,
    profile: root.profile,
    capability: root.capability,
    method: root.method,
    producer: root.producer,
    configuredRuntime: root.configuredRuntime,
    maximumStepBytes: root.maximumStepBytes,
    maximumOccurrences: root.maximumOccurrences,
    maximumPairs: root.maximumPairs,
  }, "$assemblyIntegrityObserverProfile");
  const profileFingerprint = validateContentFingerprint(
    root.profileFingerprint,
    "$assemblyIntegrityObserverProfile.profileFingerprint",
  );
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(profileFingerprint, expected)) {
    throw new TypeError(
      "$assemblyIntegrityObserverProfile.profileFingerprint does not seal the exact profile body.",
    );
  }
  return deepFreeze({ ...body, profileFingerprint });
}

export function sameAssemblyIntegrityObserverProfileRef(
  left: AssemblyIntegrityObserverProfileRef,
  right: AssemblyIntegrityObserverProfileRef,
): boolean {
  return left.id === right.id && left.version === right.version;
}

function parseProfileBody(
  value: unknown,
  path: string,
): AssemblyIntegrityObserverProfileFingerprintBody {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "profile",
      "capability",
      "method",
      "producer",
      "configuredRuntime",
      "maximumStepBytes",
      "maximumOccurrences",
      "maximumPairs",
    ],
    path,
  );
  if (root.schemaVersion !== ASSEMBLY_INTEGRITY_OBSERVER_PROFILE_SCHEMA) {
    throw new TypeError(
      `${path}.schemaVersion must equal ${
        JSON.stringify(ASSEMBLY_INTEGRITY_OBSERVER_PROFILE_SCHEMA)
      }.`,
    );
  }
  const profile = parseRef(root.profile, `${path}.profile`);
  const capability = parseRef(root.capability, `${path}.capability`);
  const method = validateAssemblyIntegrityMethodIdentity(
    root.method,
    `${path}.method`,
  );
  const producer = parseProducer(root.producer, `${path}.producer`);
  const configuredRuntime = parseConfiguredRuntime(
    root.configuredRuntime,
    `${path}.configuredRuntime`,
  );
  const maximumStepBytes = positiveInteger(
    root.maximumStepBytes,
    `${path}.maximumStepBytes`,
  );
  const maximumOccurrences = positiveInteger(
    root.maximumOccurrences,
    `${path}.maximumOccurrences`,
  );
  const maximumPairs = positiveInteger(root.maximumPairs, `${path}.maximumPairs`);
  if (maximumStepBytes > ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES) {
    throw new TypeError(`${path}.maximumStepBytes exceeds the bundle ceiling.`);
  }
  if (maximumOccurrences > ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES) {
    throw new TypeError(`${path}.maximumOccurrences exceeds the bundle ceiling.`);
  }
  if (maximumPairs > ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS) {
    throw new TypeError(`${path}.maximumPairs exceeds the bundle ceiling.`);
  }
  if (maximumPairs !== maximumOccurrences * (maximumOccurrences - 1) / 2) {
    throw new TypeError(
      `${path}.maximumPairs must equal the complete immediate-occurrence pair bound.`,
    );
  }
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVER_PROFILE_SCHEMA,
    profile,
    capability,
    method,
    producer,
    configuredRuntime,
    maximumStepBytes,
    maximumOccurrences,
    maximumPairs,
  });
}

function parseRef(
  value: unknown,
  path: string,
): AssemblyIntegrityObserverProfileRef {
  const root = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: safeVersion(root.version, `${path}.version`),
  });
}

function parseProducer(
  value: unknown,
  path: string,
): AssemblyIntegrityObserverProducerContract {
  const root = exactRecord(value, ["rawSchemaVersion", "engine", "package"], path);
  const rawSchemaVersion = nonEmptyText(
    root.rawSchemaVersion,
    `${path}.rawSchemaVersion`,
  );
  if (rawSchemaVersion.length > 256 || /[^\x20-\x7e]/.test(rawSchemaVersion)) {
    throw new TypeError(`${path}.rawSchemaVersion must be bounded printable ASCII.`);
  }
  return deepFreeze({
    rawSchemaVersion,
    engine: parseRef(root.engine, `${path}.engine`),
    package: parseRef(root.package, `${path}.package`),
  });
}

function parseConfiguredRuntime(
  value: unknown,
  path: string,
): AssemblyIntegrityObserverConfiguredRuntime {
  const root = exactRecord(value, ["kind", "imageDigest"], path);
  if (root.kind !== "image-digest") {
    throw new TypeError(`${path}.kind must equal image-digest.`);
  }
  return deepFreeze({
    kind: "image-digest" as const,
    imageDigest: validateContentFingerprint(
      root.imageDigest,
      `${path}.imageDigest`,
    ),
  });
}

/** Useful when a profile has crossed a storage boundary and needs a stable text. */
export function canonicalAssemblyIntegrityObserverProfileText(
  profile: AssemblyIntegrityObserverProfile,
): string {
  return deterministicJson(profile);
}
