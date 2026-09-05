/**
 * Durable, host-local qualification of one exact capability runtime binding.
 *
 * An attestation is operational evidence only.  It does not admit an MRTR,
 * select a provider request, or make an engineering verdict.  Its deliberately
 * closed schema prevents bearer tokens, headers and provider payloads from
 * leaking into the host ledger.
 */

import {
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type CapabilityRuntimeLaunchGroupReference,
  validateCapabilityRuntimeLaunchGroupReference,
} from "./capability-runtime-launch-group.ts";
import type {
  CapabilityRuntimeExecutionMode,
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimePlatform,
} from "./capability-runtime-material.ts";

export const CAPABILITY_RUNTIME_BINDING_QUALIFICATION_ATTESTATION_SCHEMA_VERSION =
  "capability-runtime-binding-qualification-attestation/1.1" as const;

export type CapabilityRuntimeQualificationAttestationState = "qualified" | "revoked";

export interface CapabilityRuntimeBindingQualificationAttestation {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_BINDING_QUALIFICATION_ATTESTATION_SCHEMA_VERSION;
  /** `qualified` and `revoked` records are both immutable append-only events. */
  readonly state: CapabilityRuntimeQualificationAttestationState;
  readonly recordedAt: string;
  readonly binding: { readonly id: string; readonly version: string };
  /** Semantic selector that the code-owned binding must still expose. */
  readonly selector: {
    readonly capability: { readonly id: string; readonly version: string };
    readonly use: "preparation" | "execution";
  };
  /** The fixed server adapter contract, never an agent/provider envelope. */
  readonly contract: {
    readonly id: string;
    readonly version: string;
    readonly source: string;
  };
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint | null;
  } | null;
  readonly unit: {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  };
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly targetPlatform: CapabilityRuntimePlatform;
  readonly mode: CapabilityRuntimeExecutionMode;
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference | null;
  /** A compact identity of the observed host, not a Docker/provider payload. */
  readonly observedHost: CapabilityRuntimeObservedHost;
  /** References only: no probe command, headers, secrets or provider output. */
  readonly fixture: CapabilityRuntimeQualificationEvidenceReference;
  readonly qualificationSpec: CapabilityRuntimeQualificationEvidenceReference;
  readonly outcome: CapabilityRuntimeQualificationEvidenceReference;
  /** SHA-256 of this exact closed event body. */
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeObservedHost {
  readonly identityFingerprint: ContentFingerprint;
  readonly platform: CapabilityRuntimePlatform;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeQualificationEvidenceReference {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export function capabilityRuntimeQualificationStoppedOutcomeId(
  stoppedFingerprint: ContentFingerprint,
): string {
  return `capability-runtime-qualification-stopped-${stoppedFingerprint.digest}`;
}

export function isCanonicalCapabilityRuntimeQualificationStoppedOutcome(
  value: CapabilityRuntimeQualificationEvidenceReference,
): boolean {
  return value.id ===
    capabilityRuntimeQualificationStoppedOutcomeId(value.fingerprint);
}

/**
 * Exact monotone revocation identity. Spec, outcome, state, recordedAt and
 * fingerprint are excluded: a later specification cannot escape an earlier
 * revocation of the same binding/host probe.
 */
export function sameCapabilityRuntimeQualificationRevocationScope(
  left: CapabilityRuntimeBindingQualificationAttestation,
  right: CapabilityRuntimeBindingQualificationAttestation,
): boolean {
  return left.binding.id === right.binding.id &&
    left.binding.version === right.binding.version &&
    left.selector.capability.id === right.selector.capability.id &&
    left.selector.capability.version === right.selector.capability.version &&
    left.selector.use === right.selector.use &&
    left.contract.id === right.contract.id &&
    left.contract.version === right.contract.version &&
    left.contract.source === right.contract.source &&
    sameAttestationProfile(left.profile, right.profile) &&
    left.unit.id === right.unit.id &&
    left.unit.version === right.unit.version &&
    sameFingerprint(left.unit.manifestFingerprint, right.unit.manifestFingerprint) &&
    left.material.unitId === right.material.unitId &&
    left.material.materialId === right.material.materialId &&
    left.material.imageDigest === right.material.imageDigest &&
    left.targetPlatform === right.targetPlatform &&
    left.mode === right.mode &&
    sameLaunchGroup(left.launchGroup, right.launchGroup) &&
    left.observedHost.platform === right.observedHost.platform &&
    sameFingerprint(
      left.observedHost.identityFingerprint,
      right.observedHost.identityFingerprint,
    ) &&
    left.fixture.id === right.fixture.id &&
    sameFingerprint(left.fixture.fingerprint, right.fixture.fingerprint);
}

function sameLaunchGroup(
  left: CapabilityRuntimeBindingQualificationAttestation["launchGroup"],
  right: CapabilityRuntimeBindingQualificationAttestation["launchGroup"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    sameFingerprint(left.fingerprint, right.fingerprint);
}

function sameAttestationProfile(
  left: CapabilityRuntimeBindingQualificationAttestation["profile"],
  right: CapabilityRuntimeBindingQualificationAttestation["profile"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    ((left.fingerprint === null && right.fingerprint === null) ||
      (left.fingerprint !== null && right.fingerprint !== null &&
        sameFingerprint(left.fingerprint, right.fingerprint)));
}

export function capabilityRuntimeObservedHostManifest(
  platform: CapabilityRuntimePlatform,
  identityFingerprint: ContentFingerprint,
): {
  readonly schemaVersion: "capability-runtime-observed-host/1.0";
  readonly identityFingerprint: ContentFingerprint;
  readonly platform: CapabilityRuntimePlatform;
} {
  return {
    schemaVersion: "capability-runtime-observed-host/1.0",
    identityFingerprint,
    platform,
  };
}

export function fingerprintCapabilityRuntimeObservedHost(
  platform: CapabilityRuntimePlatform,
  identityFingerprint: ContentFingerprint,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(
    capabilityRuntimeObservedHostManifest(platform, identityFingerprint),
  );
}

export function capabilityRuntimeBindingQualificationAttestationManifest(
  value: Omit<CapabilityRuntimeBindingQualificationAttestation, "fingerprint">,
): Omit<CapabilityRuntimeBindingQualificationAttestation, "fingerprint"> {
  return {
    schemaVersion: value.schemaVersion,
    state: value.state,
    recordedAt: value.recordedAt,
    binding: value.binding,
    selector: value.selector,
    contract: value.contract,
    profile: value.profile,
    unit: value.unit,
    material: value.material,
    targetPlatform: value.targetPlatform,
    mode: value.mode,
    launchGroup: value.launchGroup,
    observedHost: value.observedHost,
    fixture: value.fixture,
    qualificationSpec: value.qualificationSpec,
    outcome: value.outcome,
  };
}

export function fingerprintCapabilityRuntimeBindingQualificationAttestation(
  value: Omit<CapabilityRuntimeBindingQualificationAttestation, "fingerprint">,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(
    capabilityRuntimeBindingQualificationAttestationManifest(value),
  );
}

export async function createCapabilityRuntimeBindingQualificationAttestation(
  value: CapabilityRuntimeBindingQualificationAttestation,
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  return await validateCapabilityRuntimeBindingQualificationAttestation(value);
}

export async function validateCapabilityRuntimeBindingQualificationAttestation(
  value: unknown,
  path = "$capabilityRuntimeQualificationAttestation",
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  const root = exactRecord(value, [
    "schemaVersion",
    "state",
    "recordedAt",
    "binding",
    "selector",
    "contract",
    "profile",
    "unit",
    "material",
    "targetPlatform",
    "mode",
    "launchGroup",
    "observedHost",
    "fixture",
    "qualificationSpec",
    "outcome",
    "fingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_BINDING_QUALIFICATION_ATTESTATION_SCHEMA_VERSION,
    `${path}.schemaVersion`,
  );
  const targetPlatform = platform(root.targetPlatform, `${path}.targetPlatform`);
  const mode = executionMode(root.mode, `${path}.mode`);
  const observedHost = await parseObservedHost(
    root.observedHost,
    `${path}.observedHost`,
  );
  if (mode === "native" && observedHost.platform !== targetPlatform) {
    throw new TypeError(
      `${path}.mode native requires the observed native target platform.`,
    );
  }
  if (mode === "emulated" && observedHost.platform === targetPlatform) {
    throw new TypeError(`${path}.mode emulated requires a distinct target platform.`);
  }
  const result = deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_BINDING_QUALIFICATION_ATTESTATION_SCHEMA_VERSION,
    state: qualificationState(root.state, `${path}.state`),
    recordedAt: canonicalTimestamp(root.recordedAt, `${path}.recordedAt`),
    binding: parseBinding(root.binding, `${path}.binding`),
    selector: parseSelector(root.selector, `${path}.selector`),
    contract: parseContract(root.contract, `${path}.contract`),
    profile: root.profile === null
      ? null
      : parseProfile(root.profile, `${path}.profile`),
    unit: parseUnit(root.unit, `${path}.unit`),
    material: parseMaterial(root.material, `${path}.material`),
    targetPlatform,
    mode,
    launchGroup: root.launchGroup === null
      ? null
      : validateCapabilityRuntimeLaunchGroupReference(
        root.launchGroup,
        `${path}.launchGroup`,
      ),
    observedHost,
    fixture: parseEvidenceReference(root.fixture, `${path}.fixture`),
    qualificationSpec: parseEvidenceReference(
      root.qualificationSpec,
      `${path}.qualificationSpec`,
    ),
    outcome: parseEvidenceReference(root.outcome, `${path}.outcome`),
    fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
  if (result.material.unitId !== result.unit.id) {
    throw new TypeError(`${path}.material.unitId must equal ${path}.unit.id.`);
  }
  const expectedHost = await fingerprintCapabilityRuntimeObservedHost(
    result.observedHost.platform,
    result.observedHost.identityFingerprint,
  );
  if (!sameFingerprint(result.observedHost.fingerprint, expectedHost)) {
    throw new TypeError(`${path}.observedHost.fingerprint is not canonical.`);
  }
  const expected = await fingerprintCapabilityRuntimeBindingQualificationAttestation(
    capabilityRuntimeBindingQualificationAttestationManifest(result),
  );
  if (!sameFingerprint(result.fingerprint, expected)) {
    throw new TypeError(
      `${path}.fingerprint does not match the canonical attestation body.`,
    );
  }
  return result;
}

export function canonicalCapabilityRuntimeBindingQualificationAttestationText(
  value: unknown,
): Promise<string> {
  return validateCapabilityRuntimeBindingQualificationAttestation(value).then(
    deterministicJson,
  );
}

function parseBinding(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
  });
}

function parseSelector(value: unknown, path: string) {
  const root = exactRecord(value, ["capability", "use"], path);
  const capability = exactRecord(
    root.capability,
    ["id", "version"],
    `${path}.capability`,
  );
  return deepFreeze({
    capability: {
      id: safeId(capability.id, `${path}.capability.id`),
      version: exactVersionToken(capability.version, `${path}.capability.version`),
    },
    use: capabilityUse(root.use, `${path}.use`),
  });
}

function parseContract(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version", "source"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    source: repositoryReference(root.source, `${path}.source`),
  });
}

function parseProfile(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: root.fingerprint === null
      ? null
      : fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function parseUnit(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version", "manifestFingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    manifestFingerprint: fingerprint(
      root.manifestFingerprint,
      `${path}.manifestFingerprint`,
    ),
  });
}

function parseMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeMaterialIdentity {
  const root = exactRecord(value, ["unitId", "materialId", "imageDigest"], path);
  const imageDigest = nonEmptyText(root.imageDigest, `${path}.imageDigest`);
  if (!/^[a-f0-9]{64}$/.test(imageDigest)) {
    throw new TypeError(`${path}.imageDigest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({
    unitId: safeId(root.unitId, `${path}.unitId`),
    materialId: safeId(root.materialId, `${path}.materialId`),
    imageDigest,
  });
}

function parseObservedHost(
  value: unknown,
  path: string,
): Promise<CapabilityRuntimeObservedHost> {
  try {
    const root = exactRecord(
      value,
      ["identityFingerprint", "platform", "fingerprint"],
      path,
    );
    return Promise.resolve(deepFreeze({
      identityFingerprint: fingerprint(
        root.identityFingerprint,
        `${path}.identityFingerprint`,
      ),
      platform: platform(root.platform, `${path}.platform`),
      fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
    }));
  } catch (error) {
    return Promise.reject(error);
  }
}

function parseEvidenceReference(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationEvidenceReference {
  const root = exactRecord(value, ["id", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function qualificationState(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationAttestationState {
  if (value === "qualified" || value === "revoked") return value;
  throw new TypeError(`${path} must equal qualified or revoked.`);
}

function platform(value: unknown, path: string): CapabilityRuntimePlatform {
  if (value === "linux/amd64" || value === "linux/arm64") return value;
  throw new TypeError(`${path} must equal linux/amd64 or linux/arm64.`);
}

function executionMode(value: unknown, path: string): CapabilityRuntimeExecutionMode {
  if (value === "native" || value === "emulated") return value;
  throw new TypeError(`${path} must equal native or emulated.`);
}

function capabilityUse(value: unknown, path: string): "preparation" | "execution" {
  if (value === "preparation" || value === "execution") return value;
  throw new TypeError(`${path} must equal preparation or execution.`);
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${path} must be an exact canonical UTC timestamp.`);
  }
  return value;
}

function repositoryReference(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (
    text.startsWith("/") || text.includes("..") || text.includes("\\") ||
    text.includes("\0")
  ) {
    throw new TypeError(`${path} must be a repository-relative reference.`);
  }
  return text;
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}
