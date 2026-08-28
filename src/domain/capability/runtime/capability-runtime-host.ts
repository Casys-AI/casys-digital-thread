/**
 * Closed host-launch profiles for the capability-runtime supervisor.
 *
 * This is operational configuration only.  It is deliberately separate from
 * semantic engineering capabilities, project state, Thread, CAS and WAL.  A
 * profile gives the server a reviewed, immutable way to operate one material;
 * it does not expose a provider, tool, endpoint, argument envelope or secret
 * value to an agent.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeQualificationState,
} from "./capability-runtime-supervision.ts";

export const CAPABILITY_RUNTIME_LAUNCH_PROFILE_SCHEMA_VERSION =
  "capability-runtime-launch-profile/1.0" as const;

export interface CapabilityRuntimeLaunchProfileReference {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeLaunchProfile {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_LAUNCH_PROFILE_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  /** SHA-256 of the closed body below; it is never a publisher assertion. */
  readonly fingerprint: ContentFingerprint;
  readonly material: CapabilityRuntimeMaterialIdentity;
  /** `cache-only` may be pulled/observed but is never started by this lot. */
  readonly activationPolicy: "persistent" | "cache-only";
  /** Closed Compose coordinates selected by the server profile, never a caller. */
  readonly acquisition: CapabilityRuntimeComposeAcquisition;
  /** Exact UTF-8 Compose descriptor supplied to the CLI on standard input. */
  readonly compose: CapabilityRuntimeSealedComposeDescriptor;
  /** Labels which must be present verbatim before a container is considered owned. */
  readonly ownership: CapabilityRuntimeContainerOwnership;
  /** Retention is deliberately all-preserving; no removal command is representable. */
  readonly retention: CapabilityRuntimeRetention;
  /** Names only: secret values never enter this contract, journal or argv. */
  readonly secretSlots: readonly string[];
  /** Unknown blocks acquisition and activation rather than being guessed. */
  readonly security: "reviewed" | "unknown";
  /** Operational gate only; it is not an engineering result or verdict. */
  readonly qualification: CapabilityRuntimeQualificationState;
}

export interface CapabilityRuntimeComposeAcquisition {
  readonly kind: "compose";
  readonly projectName: string;
  readonly serviceName: string;
  /** Pinned exact image used only for local image inspection. */
  readonly imageReference: string;
}

/**
 * Server-owned Compose bytes.  They are part of the immutable profile body;
 * no source YAML path can be substituted between inspection and launch.
 */
export interface CapabilityRuntimeSealedComposeDescriptor {
  readonly schemaVersion: "capability-runtime-compose-descriptor/1.0";
  readonly content: string;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeContainerOwnership {
  readonly labels: readonly CapabilityRuntimeOwnershipLabel[];
}

export interface CapabilityRuntimeOwnershipLabel {
  readonly key: string;
  readonly value: string;
}

export interface CapabilityRuntimeRetention {
  readonly containers: "stop-only";
  readonly images: "preserve";
  readonly volumes: "preserve";
}

/**
 * The catalogue records this reference only.  Bodies remain in the exact
 * server-side registry so a project plan cannot become a launch envelope.
 */
export function capabilityRuntimeLaunchProfileReference(
  profile: CapabilityRuntimeLaunchProfile,
): CapabilityRuntimeLaunchProfileReference {
  return deepFreeze({
    id: profile.id,
    version: profile.version,
    fingerprint: { ...profile.fingerprint },
  });
}

/** Closed profile body whose SHA-256 is the launch identity. */
export function capabilityRuntimeLaunchProfileManifest(
  profile: Omit<CapabilityRuntimeLaunchProfile, "fingerprint">,
): Omit<CapabilityRuntimeLaunchProfile, "fingerprint"> {
  return {
    schemaVersion: profile.schemaVersion,
    id: profile.id,
    version: profile.version,
    material: profile.material,
    activationPolicy: profile.activationPolicy,
    acquisition: profile.acquisition,
    compose: profile.compose,
    ownership: profile.ownership,
    retention: profile.retention,
    secretSlots: profile.secretSlots,
    security: profile.security,
    qualification: profile.qualification,
  };
}

export function fingerprintCapabilityRuntimeLaunchProfile(
  profile: Omit<CapabilityRuntimeLaunchProfile, "fingerprint">,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(capabilityRuntimeLaunchProfileManifest(profile));
}

export async function validateCapabilityRuntimeLaunchProfile(
  value: unknown,
): Promise<CapabilityRuntimeLaunchProfile> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "fingerprint",
    "material",
    "activationPolicy",
    "acquisition",
    "compose",
    "ownership",
    "retention",
    "secretSlots",
    "security",
    "qualification",
  ], "$launchProfile");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_LAUNCH_PROFILE_SCHEMA_VERSION,
    "$launchProfile.schemaVersion",
  );
  const materialValue = material(root.material, "$launchProfile.material");
  const acquisitionValue = acquisition(root.acquisition, "$launchProfile.acquisition");
  const ownershipValue = ownership(root.ownership, "$launchProfile.ownership");
  const profile = deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_PROFILE_SCHEMA_VERSION,
    id: safeId(root.id, "$launchProfile.id"),
    version: exactVersionToken(root.version, "$launchProfile.version"),
    fingerprint: fingerprint(root.fingerprint, "$launchProfile.fingerprint"),
    material: materialValue,
    activationPolicy: oneOf(
      root.activationPolicy,
      ["persistent", "cache-only"] as const,
      "$launchProfile.activationPolicy",
    ),
    acquisition: acquisitionValue,
    compose: await composeDescriptor(
      root.compose,
      "$launchProfile.compose",
      acquisitionValue,
      ownershipValue,
    ),
    ownership: ownershipValue,
    retention: retention(root.retention, "$launchProfile.retention"),
    secretSlots: slots(root.secretSlots, "$launchProfile.secretSlots"),
    security: oneOf(
      root.security,
      ["reviewed", "unknown"] as const,
      "$launchProfile.security",
    ),
    qualification: oneOf(
      root.qualification,
      ["unqualified", "compatible", "qualified", "revoked"] as const,
      "$launchProfile.qualification",
    ),
  });
  const expected = await fingerprintCapabilityRuntimeLaunchProfile(
    capabilityRuntimeLaunchProfileManifest(profile),
  );
  if (!sameFingerprint(profile.fingerprint, expected)) {
    throw new TypeError(
      "$launchProfile.fingerprint does not match the canonical launch-profile body.",
    );
  }
  assertOwnershipMatchesAcquisition(profile);
  return profile;
}

export function validateCapabilityRuntimeLaunchProfileReference(
  value: unknown,
  path = "$launchProfileReference",
): CapabilityRuntimeLaunchProfileReference {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

export function sameCapabilityRuntimeLaunchProfileReference(
  left: CapabilityRuntimeLaunchProfileReference,
  right: CapabilityRuntimeLaunchProfileReference,
): boolean {
  return left.id === right.id && left.version === right.version &&
    sameFingerprint(left.fingerprint, right.fingerprint);
}

export function capabilityRuntimeLaunchProfileMaterialMatches(
  profile: CapabilityRuntimeLaunchProfile,
  candidate: CapabilityRuntimeMaterialIdentity,
): boolean {
  return profile.material.unitId === candidate.unitId &&
    profile.material.materialId === candidate.materialId &&
    profile.material.imageDigest === candidate.imageDigest;
}

function material(value: unknown, path: string): CapabilityRuntimeMaterialIdentity {
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

function acquisition(
  value: unknown,
  path: string,
): CapabilityRuntimeComposeAcquisition {
  const root = exactRecord(value, [
    "kind",
    "projectName",
    "serviceName",
    "imageReference",
  ], path);
  literalValue(root.kind, "compose", `${path}.kind`);
  const imageReference = nonEmptyText(root.imageReference, `${path}.imageReference`);
  const digest = digestFromPinnedReference(imageReference, `${path}.imageReference`);
  return deepFreeze({
    kind: "compose" as const,
    projectName: composeProjectName(root.projectName, `${path}.projectName`),
    serviceName: safeId(root.serviceName, `${path}.serviceName`),
    imageReference: `${
      imageReference.slice(0, imageReference.lastIndexOf("@sha256:") + 8)
    }${digest}`,
  });
}

async function composeDescriptor(
  value: unknown,
  path: string,
  acquisition: CapabilityRuntimeComposeAcquisition,
  ownership: CapabilityRuntimeContainerOwnership,
): Promise<CapabilityRuntimeSealedComposeDescriptor> {
  const root = exactRecord(value, ["schemaVersion", "content", "fingerprint"], path);
  literalValue(
    root.schemaVersion,
    "capability-runtime-compose-descriptor/1.0",
    `${path}.schemaVersion`,
  );
  if (typeof root.content !== "string" || root.content.length === 0) {
    throw new TypeError(`${path}.content must be non-empty exact Compose text.`);
  }
  const content = root.content;
  if (content.length > 1_048_576) {
    throw new TypeError(
      `${path}.content exceeds the one-megabyte sealed descriptor limit.`,
    );
  }
  validateClosedComposeJson(content, `${path}.content`, acquisition, ownership);
  const supplied = fingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await fingerprintCapabilityRuntimeComposeContent(content);
  if (!sameFingerprint(supplied, expected)) {
    throw new TypeError(
      `${path}.fingerprint does not match the exact UTF-8 Compose bytes.`,
    );
  }
  return deepFreeze({
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content,
    fingerprint: supplied,
  });
}

/**
 * Compose accepts JSON as a YAML subset.  Restricting the descriptor to this
 * canonical shape rules out interpolation, env files, extends/includes, build
 * contexts and every other mutable file indirection for this H1 boundary.
 */
function validateClosedComposeJson(
  content: string,
  path: string,
  acquisition: CapabilityRuntimeComposeAcquisition,
  ownership: CapabilityRuntimeContainerOwnership,
): void {
  if (content.includes("$")) {
    throw new TypeError(`${path} must not contain Compose interpolation.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TypeError(`${path} must be canonical closed Compose JSON.`);
  }
  if (containsForbiddenComposeDirective(parsed)) {
    throw new TypeError(`${path} declares a forbidden external Compose directive.`);
  }
  if (content !== deterministicJson(parsed)) {
    throw new TypeError(`${path} must be canonical JSON with no insignificant bytes.`);
  }
  const document = exactRecord(parsed, ["services"], path);
  const services = plainRecord(document.services, `${path}.services`);
  const servicesEntries = Object.entries(services);
  if (
    servicesEntries.length !== 1 || servicesEntries[0]![0] !== acquisition.serviceName
  ) {
    throw new TypeError(
      `${path}.services must contain only the exact profile service.`,
    );
  }
  const service = exactRecord(
    servicesEntries[0]![1],
    ["image", "labels"],
    `${path}.services.${acquisition.serviceName}`,
  );
  if (service.image !== acquisition.imageReference) {
    throw new TypeError(
      `${path}.services image must equal the exact pinned profile image.`,
    );
  }
  const labels = plainRecord(
    service.labels,
    `${path}.services.${acquisition.serviceName}.labels`,
  );
  const expected = new Map(ownership.labels.map((label) => [label.key, label.value]));
  if (Object.keys(labels).length !== expected.size) {
    throw new TypeError(
      `${path}.services labels must equal the exact profile ownership labels.`,
    );
  }
  for (const [key, expectedValue] of expected) {
    if (labels[key] !== expectedValue) {
      throw new TypeError(
        `${path}.services labels must equal the exact profile ownership labels.`,
      );
    }
  }
}

function plainRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function containsForbiddenComposeDirective(value: unknown): boolean {
  const forbidden = new Set([
    "env_file",
    "include",
    "extends",
    "build",
    "configs",
    "secrets",
    "file",
    "context",
    "dockerfile",
    "label_file",
  ]);
  if (Array.isArray(value)) return value.some(containsForbiddenComposeDirective);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    forbidden.has(key) || containsForbiddenComposeDirective(child)
  );
}

/** SHA-256 of the exact UTF-8 bytes sent to Docker Compose standard input. */
export async function fingerprintCapabilityRuntimeComposeContent(
  content: string,
): Promise<ContentFingerprint> {
  return deepFreeze({
    algorithm: "sha256" as const,
    digest: await sha256Hex(new TextEncoder().encode(content)),
  });
}

function ownership(value: unknown, path: string): CapabilityRuntimeContainerOwnership {
  const root = exactRecord(value, ["labels"], path);
  const labels = arrayOf(root.labels, `${path}.labels`).map((label, index) => {
    const labelPath = `${path}.labels[${index}]`;
    const entry = exactRecord(label, ["key", "value"], labelPath);
    return deepFreeze({
      key: labelKey(entry.key, `${labelPath}.key`),
      value: nonEmptyText(entry.value, `${labelPath}.value`),
    });
  });
  if (labels.length === 0) throw new TypeError(`${path}.labels must not be empty.`);
  rejectDuplicates(labels.map((label) => label.key), `${path}.labels[].key`);
  return deepFreeze({ labels });
}

function retention(value: unknown, path: string): CapabilityRuntimeRetention {
  const root = exactRecord(value, ["containers", "images", "volumes"], path);
  literalValue(root.containers, "stop-only", `${path}.containers`);
  literalValue(root.images, "preserve", `${path}.images`);
  literalValue(root.volumes, "preserve", `${path}.volumes`);
  return deepFreeze({
    containers: "stop-only" as const,
    images: "preserve" as const,
    volumes: "preserve" as const,
  });
}

function slots(value: unknown, path: string): readonly string[] {
  const parsed = arrayOf(value, path).map((slot, index) =>
    safeId(slot, `${path}[${index}]`)
  );
  rejectDuplicates(parsed, path);
  return deepFreeze(parsed);
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

function assertOwnershipMatchesAcquisition(
  profile: CapabilityRuntimeLaunchProfile,
): void {
  const labels = new Map(
    profile.ownership.labels.map((label) => [label.key, label.value]),
  );
  if (labels.get("com.docker.compose.project") !== profile.acquisition.projectName) {
    throw new TypeError(
      "$launchProfile.ownership.labels must bind the exact Compose project name.",
    );
  }
  if (labels.get("com.docker.compose.service") !== profile.acquisition.serviceName) {
    throw new TypeError(
      "$launchProfile.ownership.labels must bind the exact Compose service name.",
    );
  }
  const digest = digestFromPinnedReference(
    profile.acquisition.imageReference,
    "$launchProfile.acquisition.imageReference",
  );
  if (digest !== profile.material.imageDigest) {
    throw new TypeError(
      "$launchProfile.acquisition.imageReference must match the exact material image digest.",
    );
  }
}

function digestFromPinnedReference(value: string, path: string): string {
  const marker = "@sha256:";
  const index = value.lastIndexOf(marker);
  const digest = index < 1 ? "" : value.slice(index + marker.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path} must be an exact @sha256 image reference.`);
  }
  return digest;
}

function composeProjectName(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(text)) {
    throw new TypeError(`${path} must be a bounded lowercase Compose project name.`);
  }
  return text;
}

function labelKey(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(text)) {
    throw new TypeError(`${path} must be a safe Docker label key.`);
  }
  return text;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${path} must be one of: ${values.join(", ")}.`);
  }
  return value;
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return deterministicJson(left) === deterministicJson(right);
}
