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
  closedRecord,
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
import type { CapabilityRuntimeMaterialIdentity } from "./capability-runtime-material.ts";

export const CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION =
  "capability-runtime-launch-group/2.0" as const;

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
  /**
   * Optional, sealed process-readiness contract for a published MCP service.
   * It is a host-lifecycle fact only: no binding, provider envelope, tool
   * invocation, or credential is carried here.
   */
  readonly readiness?: CapabilityRuntimeLaunchGroupReadiness;
  readonly retention: {
    readonly containers: "stop-only";
    readonly images: "preserve";
    readonly volumes: "preserve";
  };
  /** Names only. Values remain outside groups, project data and agent input. */
  readonly secretSlots: readonly string[];
  readonly security: "reviewed" | "unknown";
}

export interface CapabilityRuntimeLaunchGroupMaterial {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly serviceName: string;
  readonly imageReference: string;
  readonly ownership: readonly { readonly key: string; readonly value: string }[];
}

/**
 * A bounded read-only MCP handshake after Compose has started the exact group.
 * The adapter derives the one loopback publication from the sealed Compose
 * descriptor; callers never provide a URL, port, provider name, or tool.
 */
export interface CapabilityRuntimeLaunchGroupReadiness {
  readonly kind: "mcp-tools-list";
  /** Total bounded readiness window, including all attempts and waits. */
  readonly timeoutMs: number;
  /** Per-read-only-probe transport deadline. */
  readonly attemptTimeoutMs: number;
  /** Declared spacing between failed readiness probes. */
  readonly retryIntervalMs: number;
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
    ...(group.readiness === undefined ? {} : { readiness: group.readiness }),
    retention: group.retention,
    secretSlots: group.secretSlots,
    security: group.security,
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
  const root = closedRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "fingerprint",
    "activationPolicy",
    "acquisition",
    "materials",
    "compose",
    "readiness",
    "retention",
    "secretSlots",
    "security",
  ], [
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
  ], "$launchGroup");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    "$launchGroup.schemaVersion",
  );
  const acquisition = parseAcquisition(root.acquisition);
  const materials = parseMaterials(root.materials, acquisition.projectName);
  const compose = await parseCompose(
    root.compose,
    acquisition.projectName,
    materials,
  );
  const readiness = parseReadiness(root.readiness);
  const group = deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    id: safeId(root.id, "$launchGroup.id"),
    version: exactVersionToken(root.version, "$launchGroup.version"),
    fingerprint: fingerprint(root.fingerprint, "$launchGroup.fingerprint"),
    activationPolicy: literalPersistent(root.activationPolicy),
    acquisition,
    materials,
    compose,
    ...(readiness === undefined ? {} : { readiness }),
    retention: parseRetention(root.retention),
    secretSlots: parseSlots(root.secretSlots),
    security: oneOf(
      root.security,
      ["reviewed", "unknown"] as const,
      "$launchGroup.security",
    ),
  });
  if (
    readiness !== undefined &&
    capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(group).length !== 1
  ) {
    throw new TypeError(
      "$launchGroup.readiness requires exactly one published loopback host port.",
    );
  }
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
  const document = exactRecord(
    value,
    ["services", "volumes"],
    "$launchGroup.compose.content",
  );
  const services = record(document.services, "$launchGroup.compose.content.services");
  const volumes = record(document.volumes, "$launchGroup.compose.content.volumes");
  const expected = new Map(
    materials.map((material) => [material.serviceName, material]),
  );
  if (Object.keys(services).length !== expected.size) {
    throw new TypeError("Compose services must exactly equal launch-group services.");
  }
  for (const [name, material] of expected) {
    const path = `$launchGroup.compose.content.services.${name}`;
    const service = composeService(services[name], path);
    if (service.image !== material.imageReference) {
      throw new TypeError("Compose service image is not the pinned group material.");
    }
    // Docker Compose creates these reserved ownership labels itself. The
    // descriptor must not try to spoof them; runtime inspection proves them.
    if (service.labels !== undefined) {
      const labels = stringRecord(service.labels, `${path}.labels`);
      for (const label of material.ownership) {
        if (labels[label.key] !== undefined && labels[label.key] !== label.value) {
          throw new TypeError("Compose service labels conflict with group ownership.");
        }
      }
    }
    validateComposeService(
      service,
      path,
      name,
      materials,
      projectName,
      volumes,
    );
  }
  const declaredVolumes = new Set(Object.keys(volumes));
  const referencedVolumes = new Set<string>();
  for (const [volume, config] of Object.entries(volumes)) {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(volume) ||
      Object.keys(record(config, `$launchGroup.compose.content.volumes.${volume}`))
          .length !== 0
    ) {
      throw new TypeError(
        "Compose launch-group volumes must be empty named-volume declarations.",
      );
    }
  }
  for (const service of Object.values(services)) {
    const parsedService = record(service, "$launchGroup.compose.content.services.*");
    const values = parsedService.volumes;
    if (values !== undefined) {
      for (
        const mount of arrayOf(
          values,
          "$launchGroup.compose.content.services.*.volumes",
        )
      ) {
        if (typeof mount === "string") referencedVolumes.add(mount.split(":", 1)[0]!);
      }
    }
  }
  collectPublishedLoopbackHostPorts(services);
  if (
    declaredVolumes.size !== referencedVolumes.size ||
    [...declaredVolumes].some((volume) => !referencedVolumes.has(volume))
  ) {
    throw new TypeError(
      "Compose launch-group volumes must be exactly declared and referenced.",
    );
  }
}

function composeService(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  const service = record(value, path);
  const allowed = new Set([
    "image",
    "labels",
    "environment",
    "volumes",
    "ports",
    "depends_on",
    "healthcheck",
    "command",
    "cap_drop",
    "security_opt",
    "mem_limit",
    "cpus",
    "pids_limit",
    "platform",
  ]);
  for (const key of Object.keys(service)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${path}.${key} is not admitted in a launch group.`);
    }
  }
  if (typeof service.image !== "string" || service.image.length === 0) {
    throw new TypeError(`${path}.image must be an exact pinned image.`);
  }
  return service;
}

function validateComposeService(
  service: Readonly<Record<string, unknown>>,
  path: string,
  name: string,
  materials: readonly CapabilityRuntimeLaunchGroupMaterial[],
  projectName: string,
  declaredVolumes: Readonly<Record<string, unknown>>,
): void {
  if (service.environment !== undefined) {
    for (
      const [key, value] of Object.entries(
        stringRecord(service.environment, `${path}.environment`),
      )
    ) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || value.includes("$")) {
        throw new TypeError(`${path}.environment is not a closed literal map.`);
      }
    }
  }
  if (service.volumes !== undefined) {
    const seenTargets = new Set<string>();
    for (
      const [index, mount] of arrayOf(service.volumes, `${path}.volumes`).entries()
    ) {
      if (
        typeof mount !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{0,62}:[/][^:\0]+(?::ro)?$/.test(mount)
      ) {
        throw new TypeError(
          `${path}.volumes[${index}] must be a named retained volume, never a bind mount.`,
        );
      }
      const [name, target] = mount.split(":", 2) as [string, string];
      if (!(name in declaredVolumes) || seenTargets.has(target)) {
        throw new TypeError(
          `${path}.volumes must name declared unique volume targets.`,
        );
      }
      seenTargets.add(target);
    }
  }
  if (service.ports !== undefined) {
    const seen = new Set<number>();
    for (const [index, port] of arrayOf(service.ports, `${path}.ports`).entries()) {
      const host = loopbackHostPort(port, `${path}.ports[${index}]`);
      if (seen.has(host)) {
        throw new TypeError(
          `${path}.ports[${index}] must be a loopback-only literal mapping.`,
        );
      }
      seen.add(host);
    }
  }
  if (service.depends_on !== undefined) {
    const dependencies = record(service.depends_on, `${path}.depends_on`);
    const index = materials.findIndex((material) => material.serviceName === name);
    for (const [dependency, condition] of Object.entries(dependencies)) {
      const dependencyIndex = materials.findIndex((material) =>
        material.serviceName === dependency
      );
      if (dependencyIndex < 0 || dependencyIndex >= index) {
        throw new TypeError(
          `${path}.depends_on must point to an earlier group service.`,
        );
      }
      const detail = exactRecord(
        condition,
        ["condition"],
        `${path}.depends_on.${dependency}`,
      );
      literalValue(
        detail.condition,
        "service_healthy",
        `${path}.depends_on.${dependency}.condition`,
      );
    }
  }
  // The immutable descriptor records the provider's actual Compose contract.
  // A provider image without a Compose healthcheck is observed as `running`
  // after `docker compose up --wait`; callers must not manufacture a probe
  // merely to activate it. Services which do declare one still require a
  // healthy observation at the host boundary.
  if (service.healthcheck !== undefined) {
    const health = record(service.healthcheck, `${path}.healthcheck`);
    const allowed = new Set(["test", "interval", "timeout", "retries", "start_period"]);
    for (const key of Object.keys(health)) {
      if (!allowed.has(key)) {
        throw new TypeError(`${path}.healthcheck.${key} is not admitted.`);
      }
    }
    const test = arrayOf(health.test, `${path}.healthcheck.test`);
    if (
      test.length === 0 ||
      test.some((part) => typeof part !== "string" || part.includes("$"))
    ) {
      throw new TypeError(
        `${path}.healthcheck.test must be a closed nonempty command array.`,
      );
    }
    for (const key of ["interval", "timeout", "start_period"] as const) {
      if (
        health[key] !== undefined &&
        (typeof health[key] !== "string" ||
          !/^[1-9][0-9]*(?:ms|s|m|h)$/.test(health[key] as string))
      ) {
        throw new TypeError(`${path}.healthcheck.${key} must be a closed literal.`);
      }
    }
    if (
      health.retries !== undefined &&
      (!Number.isInteger(health.retries) || (health.retries as number) < 1 ||
        (health.retries as number) > 60)
    ) {
      throw new TypeError(`${path}.healthcheck.retries must be a positive integer.`);
    }
  }
  for (const key of ["command", "cap_drop", "security_opt"] as const) {
    if (service[key] !== undefined) {
      const values = arrayOf(service[key], `${path}.${key}`);
      if (
        values.length === 0 ||
        values.some((value) => typeof value !== "string" || value.includes("$"))
      ) {
        throw new TypeError(`${path}.${key} must be a closed nonempty string array.`);
      }
    }
  }
  if (
    service.mem_limit !== undefined &&
    (typeof service.mem_limit !== "string" ||
      !/^[1-9][0-9]*(?:b|k|m|g)$/i.test(service.mem_limit))
  ) {
    throw new TypeError(`${path}.mem_limit must be a closed positive memory limit.`);
  }
  if (
    service.cpus !== undefined &&
    (typeof service.cpus !== "number" || !Number.isFinite(service.cpus) ||
      service.cpus <= 0 || service.cpus > 64)
  ) {
    throw new TypeError(`${path}.cpus must be a bounded positive number.`);
  }
  if (
    service.pids_limit !== undefined &&
    (typeof service.pids_limit !== "number" ||
      !Number.isSafeInteger(service.pids_limit) || service.pids_limit < 1 ||
      service.pids_limit > 65_535)
  ) {
    throw new TypeError(`${path}.pids_limit must be a bounded positive integer.`);
  }
  if (
    service.platform !== undefined && service.platform !== "linux/arm64" &&
    service.platform !== "linux/amd64"
  ) {
    throw new TypeError(`${path}.platform is not admitted.`);
  }
  // A descriptor declares no explicit network, so Compose derives one private
  // network from this immutable group project name. No shared `chain` network.
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectName)) {
    throw new TypeError(`${path} has an invalid group Compose project.`);
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

/**
 * Host ports published by one already-validated canonical Compose descriptor.
 * This is not a second Compose authority: YAML, aliases and raw documents are
 * refused. Inter-group uniqueness is a registry invariant.
 */
export function capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(
  group: CapabilityRuntimeLaunchGroup,
): readonly number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(group.compose.content);
  } catch {
    throw new TypeError("$launchGroup.compose.content must be canonical JSON.");
  }
  const document = exactRecord(
    parsed,
    ["services", "volumes"],
    "$launchGroup.compose.content",
  );
  const services = record(document.services, "$launchGroup.compose.content.services");
  return deepFreeze(collectPublishedLoopbackHostPorts(services));
}

function collectPublishedLoopbackHostPorts(
  services: Readonly<Record<string, unknown>>,
): readonly number[] {
  const ports: number[] = [];
  const seen = new Set<number>();
  for (const [name, service] of Object.entries(services)) {
    const path = `$launchGroup.compose.content.services.${name}`;
    const parsedService = record(service, path);
    if (parsedService.ports === undefined) continue;
    for (
      const [index, port] of arrayOf(parsedService.ports, `${path}.ports`).entries()
    ) {
      const host = loopbackHostPort(port, `${path}.ports[${index}]`);
      if (seen.has(host)) {
        throw new TypeError("Compose launch-group loopback ports must be unique.");
      }
      seen.add(host);
      ports.push(host);
    }
  }
  return ports;
}

function loopbackHostPort(value: unknown, path: string): number {
  const parts = typeof value === "string" ? value.split(":") : [];
  const host = Number(parts[1]);
  const container = Number(parts[2]);
  if (
    parts.length !== 3 || parts[0] !== "127.0.0.1" || !Number.isInteger(host) ||
    !Number.isInteger(container) || host < 1 || host > 65535 || container < 1 ||
    container > 65535
  ) {
    throw new TypeError(`${path} must be a loopback-only literal mapping.`);
  }
  return host;
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

function parseReadiness(
  value: unknown,
): CapabilityRuntimeLaunchGroupReadiness | undefined {
  if (value === undefined) return undefined;
  const root = exactRecord(value, [
    "kind",
    "timeoutMs",
    "attemptTimeoutMs",
    "retryIntervalMs",
  ], "$launchGroup.readiness");
  literalValue(root.kind, "mcp-tools-list", "$launchGroup.readiness.kind");
  const timeoutMs = readinessMilliseconds(
    root.timeoutMs,
    "$launchGroup.readiness.timeoutMs",
  );
  const attemptTimeoutMs = readinessMilliseconds(
    root.attemptTimeoutMs,
    "$launchGroup.readiness.attemptTimeoutMs",
  );
  const retryIntervalMs = readinessMilliseconds(
    root.retryIntervalMs,
    "$launchGroup.readiness.retryIntervalMs",
  );
  if (attemptTimeoutMs > timeoutMs || retryIntervalMs > timeoutMs) {
    throw new TypeError(
      "$launchGroup.readiness attempt and retry windows must not exceed the total timeout.",
    );
  }
  return deepFreeze({
    kind: "mcp-tools-list" as const,
    timeoutMs,
    attemptTimeoutMs,
    retryIntervalMs,
  });
}

function readinessMilliseconds(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) || typeof value !== "number" || value < 1 ||
    value > 300_000
  ) {
    throw new TypeError(
      `${path} must be a bounded positive integer milliseconds value.`,
    );
  }
  return value;
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

function stringRecord(value: unknown, path: string): Readonly<Record<string, string>> {
  const values = record(value, path);
  for (const [key, candidate] of Object.entries(values)) {
    if (typeof candidate !== "string") {
      throw new TypeError(`${path}.${key} must be a string.`);
    }
  }
  return values as Readonly<Record<string, string>>;
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
