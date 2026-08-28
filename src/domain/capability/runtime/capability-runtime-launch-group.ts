/**
 * Closed, server-owned Compose launch group.
 *
 * A group is deliberately distinct from an atomic capability unit: one unit
 * describes installable material, while a group describes the indivisible
 * local Compose topology that owns one or more already-pinned materials. A
 * lease and host journal entry name the group, never an arbitrary service.
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
import type { CapabilityRuntimeMaterialIdentity } from "./capability-runtime-supervision.ts";

export const CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION =
  "capability-runtime-launch-group/1.0" as const;

export interface CapabilityRuntimeLaunchGroupReference {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeLaunchGroup {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
  /** A Compose group is service lifecycle only. Cache/microVM have no group. */
  readonly activationPolicy: "persistent";
  readonly acquisition: {
    readonly kind: "compose";
    readonly projectName: string;
  };
  /** Ordered names are part of the exact Compose plan, never caller input. */
  readonly materials: readonly CapabilityRuntimeLaunchGroupMaterial[];
  readonly compose: {
    readonly schemaVersion: "capability-runtime-compose-descriptor/1.0";
    readonly content: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly retention: {
    readonly containers: "stop-only";
    readonly images: "preserve";
    readonly volumes: "preserve";
  };
  /** Names only. Values remain outside groups, project data and agent input. */
  readonly secretSlots: readonly string[];
  readonly security: "reviewed" | "unknown";
  readonly qualification: "unqualified" | "compatible" | "qualified" | "revoked";
}

export interface CapabilityRuntimeLaunchGroupMaterial {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly serviceName: string;
  readonly imageReference: string;
  readonly ownership: readonly { readonly key: string; readonly value: string }[];
}

export function capabilityRuntimeLaunchGroupReference(
  group: CapabilityRuntimeLaunchGroup,
): CapabilityRuntimeLaunchGroupReference {
  return deepFreeze({
    id: group.id,
    version: group.version,
    fingerprint: { ...group.fingerprint },
  });
}

export function sameCapabilityRuntimeLaunchGroupReference(
  left: CapabilityRuntimeLaunchGroupReference,
  right: CapabilityRuntimeLaunchGroupReference,
): boolean {
  return left.id === right.id && left.version === right.version &&
    left.fingerprint.algorithm === right.fingerprint.algorithm &&
    left.fingerprint.digest === right.fingerprint.digest;
}

export function capabilityRuntimeLaunchGroupManifest(
  group: Omit<CapabilityRuntimeLaunchGroup, "fingerprint">,
): Omit<CapabilityRuntimeLaunchGroup, "fingerprint"> {
  return {
    schemaVersion: group.schemaVersion,
    id: group.id,
    version: group.version,
    activationPolicy: group.activationPolicy,
    acquisition: group.acquisition,
    materials: group.materials,
    compose: group.compose,
    retention: group.retention,
    secretSlots: group.secretSlots,
    security: group.security,
    qualification: group.qualification,
  };
}

export function fingerprintCapabilityRuntimeLaunchGroup(
  group: Omit<CapabilityRuntimeLaunchGroup, "fingerprint">,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(capabilityRuntimeLaunchGroupManifest(group));
}

export async function validateCapabilityRuntimeLaunchGroup(
  value: unknown,
): Promise<CapabilityRuntimeLaunchGroup> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "fingerprint",
    "activationPolicy",
    "acquisition",
    "materials",
    "compose",
    "retention",
    "secretSlots",
    "security",
    "qualification",
  ], "$launchGroup");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    "$launchGroup.schemaVersion",
  );
  const acquisition = parseAcquisition(root.acquisition);
  const materials = parseMaterials(root.materials, acquisition.projectName);
  const compose = await parseCompose(root.compose, acquisition.projectName, materials);
  const group = deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    id: safeId(root.id, "$launchGroup.id"),
    version: exactVersionToken(root.version, "$launchGroup.version"),
    fingerprint: fingerprint(root.fingerprint, "$launchGroup.fingerprint"),
    activationPolicy: literalPersistent(root.activationPolicy),
    acquisition,
    materials,
    compose,
    retention: parseRetention(root.retention),
    secretSlots: parseSlots(root.secretSlots),
    security: oneOf(
      root.security,
      ["reviewed", "unknown"] as const,
      "$launchGroup.security",
    ),
    qualification: oneOf(
      root.qualification,
      ["unqualified", "compatible", "qualified", "revoked"] as const,
      "$launchGroup.qualification",
    ),
  });
  const expected = await fingerprintCapabilityRuntimeLaunchGroup(
    capabilityRuntimeLaunchGroupManifest(group),
  );
  if (!sameFingerprint(group.fingerprint, expected)) {
    throw new TypeError(
      "$launchGroup.fingerprint does not match the canonical group body.",
    );
  }
  return group;
}

export function validateCapabilityRuntimeLaunchGroupReference(
  value: unknown,
  path = "$launchGroupReference",
): CapabilityRuntimeLaunchGroupReference {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function parseAcquisition(value: unknown): CapabilityRuntimeLaunchGroup["acquisition"] {
  const root = exactRecord(value, ["kind", "projectName"], "$launchGroup.acquisition");
  literalValue(root.kind, "compose", "$launchGroup.acquisition.kind");
  const projectName = nonEmptyText(
    root.projectName,
    "$launchGroup.acquisition.projectName",
  );
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectName)) {
    throw new TypeError(
      "$launchGroup.acquisition.projectName is not a safe Compose project name.",
    );
  }
  return deepFreeze({ kind: "compose" as const, projectName });
}

function parseMaterials(
  value: unknown,
  projectName: string,
): readonly CapabilityRuntimeLaunchGroupMaterial[] {
  const values = arrayOf(value, "$launchGroup.materials").map((entry, index) => {
    const path = `$launchGroup.materials[${index}]`;
    const root = exactRecord(entry, [
      "material",
      "serviceName",
      "imageReference",
      "ownership",
    ], path);
    const materialRoot = exactRecord(root.material, [
      "unitId",
      "materialId",
      "imageDigest",
    ], `${path}.material`);
    const digest = nonEmptyText(
      materialRoot.imageDigest,
      `${path}.material.imageDigest`,
    );
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new TypeError(`${path}.material.imageDigest must be SHA-256.`);
    }
    const imageReference = pinnedReference(
      root.imageReference,
      `${path}.imageReference`,
    );
    if (!imageReference.endsWith(`@sha256:${digest}`)) {
      throw new TypeError(
        `${path}.imageReference must attest the exact material digest.`,
      );
    }
    const serviceName = safeId(root.serviceName, `${path}.serviceName`);
    const ownership = arrayOf(root.ownership, `${path}.ownership`).map(
      (value, labelIndex) => {
        const label = exactRecord(
          value,
          ["key", "value"],
          `${path}.ownership[${labelIndex}]`,
        );
        return deepFreeze({
          key: nonEmptyText(label.key, `${path}.ownership[${labelIndex}].key`),
          value: nonEmptyText(label.value, `${path}.ownership[${labelIndex}].value`),
        });
      },
    );
    rejectDuplicates(ownership.map((label) => label.key), `${path}.ownership[].key`);
    const labels = new Map(ownership.map((label) => [label.key, label.value]));
    if (
      labels.get("com.docker.compose.project") !== projectName ||
      labels.get("com.docker.compose.service") !== serviceName
    ) {
      throw new TypeError(
        `${path}.ownership must bind exact Compose project and service labels.`,
      );
    }
    return deepFreeze({
      material: {
        unitId: safeId(materialRoot.unitId, `${path}.material.unitId`),
        materialId: safeId(materialRoot.materialId, `${path}.material.materialId`),
        imageDigest: digest,
      },
      serviceName,
      imageReference,
      ownership,
    });
  });
  if (values.length === 0) {
    throw new TypeError("$launchGroup.materials must not be empty.");
  }
  rejectDuplicates(
    values.map((value) => value.serviceName),
    "$launchGroup.materials[].serviceName",
  );
  rejectDuplicates(
    values.map((value) => `${value.material.unitId}\u0000${value.material.materialId}`),
    "$launchGroup.materials[].material",
  );
  return deepFreeze(values);
}

async function parseCompose(
  value: unknown,
  projectName: string,
  materials: readonly CapabilityRuntimeLaunchGroupMaterial[],
): Promise<CapabilityRuntimeLaunchGroup["compose"]> {
  const root = exactRecord(
    value,
    ["schemaVersion", "content", "fingerprint"],
    "$launchGroup.compose",
  );
  literalValue(
    root.schemaVersion,
    "capability-runtime-compose-descriptor/1.0",
    "$launchGroup.compose.schemaVersion",
  );
  const content = nonEmptyText(root.content, "$launchGroup.compose.content");
  if (content.includes("$")) {
    throw new TypeError("$launchGroup.compose.content must not interpolate values.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TypeError("$launchGroup.compose.content must be canonical JSON.");
  }
  if (content !== deterministicJson(parsed)) {
    throw new TypeError("$launchGroup.compose.content must be canonical JSON.");
  }
  validateStrictCompose(parsed, projectName, materials);
  const supplied = fingerprint(root.fingerprint, "$launchGroup.compose.fingerprint");
  const expected = await fingerprintCapabilityRuntimeComposeContent(content);
  if (!sameFingerprint(supplied, expected)) {
    throw new TypeError("$launchGroup.compose.fingerprint is stale.");
  }
  return deepFreeze({
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content,
    fingerprint: supplied,
  });
}

/** Strict allowlist: no builds, indirection, host sockets or public ports. */
function validateStrictCompose(
  value: unknown,
  projectName: string,
  materials: readonly CapabilityRuntimeLaunchGroupMaterial[],
): void {
  rejectForbiddenCompose(value);
  const document = exactRecord(value, ["services"], "$launchGroup.compose.content");
  const services = record(document.services, "$launchGroup.compose.content.services");
  const expected = new Map(
    materials.map((material) => [material.serviceName, material]),
  );
  if (Object.keys(services).length !== expected.size) {
    throw new TypeError("Compose services must exactly equal launch-group services.");
  }
  for (const [name, material] of expected) {
    const service = exactRecord(
      services[name],
      ["image", "labels"],
      `$launchGroup.compose.content.services.${name}`,
    );
    if (service.image !== material.imageReference) {
      throw new TypeError("Compose service image is not the pinned group material.");
    }
    const labels = record(
      service.labels,
      `$launchGroup.compose.content.services.${name}.labels`,
    );
    if (Object.keys(labels).length !== material.ownership.length) {
      throw new TypeError("Compose service labels differ from group ownership.");
    }
    for (const label of material.ownership) {
      if (labels[label.key] !== label.value) {
        throw new TypeError("Compose service labels differ from group ownership.");
      }
    }
    if (labels["com.docker.compose.project"] !== projectName) {
      throw new TypeError("Compose ownership project drifted.");
    }
  }
}

function rejectForbiddenCompose(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectForbiddenCompose);
    return;
  }
  if (!value || typeof value !== "object") return;
  const forbidden = new Set([
    "build",
    "env_file",
    "include",
    "extends",
    "configs",
    "secrets",
    "file",
    "context",
    "dockerfile",
    "label_file",
    "privileged",
    "dockerSocket",
    "volumes",
  ]);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) {
      throw new TypeError(
        `Compose directive ${key} is not admitted for a launch group.`,
      );
    }
    if (key === "ports") {
      throw new TypeError(
        "Launch groups forbid host port publication until an explicit loopback profile is admitted.",
      );
    }
    rejectForbiddenCompose(child);
  }
}

export async function fingerprintCapabilityRuntimeComposeContent(
  content: string,
): Promise<ContentFingerprint> {
  return deepFreeze({
    algorithm: "sha256" as const,
    digest: await sha256Hex(new TextEncoder().encode(content)),
  });
}

function parseRetention(value: unknown): CapabilityRuntimeLaunchGroup["retention"] {
  const root = exactRecord(
    value,
    ["containers", "images", "volumes"],
    "$launchGroup.retention",
  );
  literalValue(root.containers, "stop-only", "$launchGroup.retention.containers");
  literalValue(root.images, "preserve", "$launchGroup.retention.images");
  literalValue(root.volumes, "preserve", "$launchGroup.retention.volumes");
  return deepFreeze({
    containers: "stop-only" as const,
    images: "preserve" as const,
    volumes: "preserve" as const,
  });
}

function parseSlots(value: unknown): readonly string[] {
  const slots = arrayOf(value, "$launchGroup.secretSlots").map((slot, index) =>
    safeId(slot, `$launchGroup.secretSlots[${index}]`)
  );
  rejectDuplicates(slots, "$launchGroup.secretSlots");
  return deepFreeze(slots);
}

function pinnedReference(value: unknown, path: string): string {
  const reference = nonEmptyText(value, path);
  if (!/@sha256:[a-f0-9]{64}$/.test(reference)) {
    throw new TypeError(`${path} must be a pinned image reference.`);
  }
  return reference;
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be SHA-256.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} is not admitted.`);
  }
  return value;
}

function literalPersistent(value: unknown): "persistent" {
  literalValue(value, "persistent", "$launchGroup.activationPolicy");
  return "persistent";
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}
