/**
 * Closed local ERPNext Buy installation profile.
 *
 * It names exact digest-pinned material, Compose topology, and the installed
 * site / secret-slot association. It is not qualification, a tool envelope,
 * a free MCP endpoint, or a credential store.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  BUY_SOURCE_INSTANCE_KIND,
  type BuySourceInstance,
  prefixedSha256,
} from "../../domain/buy/buy-source-capture.ts";
import type { CapabilityRuntimePlatform } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeQualificationCandidateMode } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";

export const LOCAL_ERPNEXT_BUY_INSTALLATION_PROFILE_SCHEMA =
  "local-erpnext-buy-installation-profile/1.0" as const;

export const DEFAULT_LOCAL_ERPNEXT_BUY_INSTALLATION_PROFILE_PATH =
  "state/local/capability-runtime/erpnext-buy-installation-profile.json" as const;

export const ERPNEXT_BUY_RUNTIME_BINDING_ID = "erpnext-buy-source" as const;
export const ERPNEXT_BUY_RUNTIME_BINDING_VERSION = "1.0.0" as const;
export const ERPNEXT_BUY_RUNTIME_ADAPTER_ID = "erpnext-buy-capture-adapter" as const;
export const ERPNEXT_BUY_RUNTIME_ADAPTER_VERSION = "1.0.0" as const;
export const ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE =
  "src/adapters/buy/erpnext-buy-capture-client.ts" as const;

export interface LocalErpnextBuyInstallationVolume {
  readonly id: string;
  readonly access: "read-only" | "read-write";
  readonly preservation: "preserve" | "ephemeral";
  readonly containerPath: string;
}

export interface LocalErpnextBuyInstallationSecretSlot {
  readonly id: string;
  readonly composeEnvironmentKey: string;
}

export interface LocalErpnextBuyInstallationProfile {
  readonly schemaVersion: typeof LOCAL_ERPNEXT_BUY_INSTALLATION_PROFILE_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly material: {
    readonly unitId: string;
    readonly unitVersion: string;
    readonly materialId: string;
    readonly imageReference: string;
    readonly platforms: readonly CapabilityRuntimePlatform[];
  };
  readonly launchGroup: {
    readonly id: string;
    readonly version: string;
    readonly projectName: string;
    readonly serviceName: string;
    readonly loopbackHostPort: number;
    readonly containerPort: number;
    readonly volumes: readonly LocalErpnextBuyInstallationVolume[];
    readonly secretSlots: readonly LocalErpnextBuyInstallationSecretSlot[];
    readonly readiness: {
      readonly timeoutMs: number;
      readonly attemptTimeoutMs: number;
      readonly retryIntervalMs: number;
    };
    readonly security: "reviewed" | "unknown";
  };
  readonly sourceInstance: BuySourceInstance;
  readonly qualificationHost: {
    readonly observedHostPlatform: CapabilityRuntimePlatform;
    readonly targetPlatform: CapabilityRuntimePlatform;
    readonly mode: CapabilityRuntimeQualificationCandidateMode;
  };
  readonly licence: {
    readonly status: "reviewed" | "unknown";
    readonly reference: string | null;
  };
}

export type LocalErpnextBuyInstallationProfileLoad =
  | { readonly status: "absent" }
  | {
    readonly status: "present";
    readonly profile: LocalErpnextBuyInstallationProfile;
    readonly sourcePath: string;
  };

export async function loadLocalErpnextBuyInstallationProfile(
  options: { readonly path?: string } = {},
): Promise<LocalErpnextBuyInstallationProfileLoad> {
  const sourcePath = options.path ??
    DEFAULT_LOCAL_ERPNEXT_BUY_INSTALLATION_PROFILE_PATH;
  let text: string;
  try {
    text = await Deno.readTextFile(sourcePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "absent" };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(
      `ERP Buy installation profile at ${sourcePath} is not JSON.`,
    );
  }
  try {
    return {
      status: "present",
      sourcePath,
      profile: parseLocalErpnextBuyInstallationProfile(parsed),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(
      `ERP Buy installation profile at ${sourcePath} is not a closed installation profile: ${message}`,
    );
  }
}

export function parseLocalErpnextBuyInstallationProfile(
  value: unknown,
  path = "$erpnextBuyInstallationProfile",
): LocalErpnextBuyInstallationProfile {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TypeError(`${path} is not JSON.`);
    }
  }
  const root = exactRecord(parsed, [
    "schemaVersion",
    "id",
    "version",
    "material",
    "launchGroup",
    "sourceInstance",
    "qualificationHost",
    "licence",
  ], path);
  literalValue(
    root.schemaVersion,
    LOCAL_ERPNEXT_BUY_INSTALLATION_PROFILE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const material = parseMaterial(root.material, `${path}.material`);
  const launchGroup = parseLaunchGroup(root.launchGroup, `${path}.launchGroup`);
  const qualificationHost = parseQualificationHost(
    root.qualificationHost,
    `${path}.qualificationHost`,
  );
  if (qualificationHost.mode === "native") {
    if (
      qualificationHost.observedHostPlatform !== qualificationHost.targetPlatform
    ) {
      throw new TypeError(
        `${path}.qualificationHost.mode native requires matching platforms.`,
      );
    }
  } else if (
    qualificationHost.observedHostPlatform === qualificationHost.targetPlatform
  ) {
    throw new TypeError(
      `${path}.qualificationHost.mode emulated requires distinct platforms.`,
    );
  }
  if (!material.platforms.includes(qualificationHost.targetPlatform)) {
    throw new TypeError(
      `${path}.qualificationHost.targetPlatform is not a material platform.`,
    );
  }
  return deepFreeze({
    schemaVersion: LOCAL_ERPNEXT_BUY_INSTALLATION_PROFILE_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    material,
    launchGroup,
    sourceInstance: parseSourceInstance(
      root.sourceInstance,
      `${path}.sourceInstance`,
    ),
    qualificationHost,
    licence: parseLicence(root.licence, `${path}.licence`),
  });
}

function parseMaterial(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationProfile["material"] {
  const root = exactRecord(value, [
    "unitId",
    "unitVersion",
    "materialId",
    "imageReference",
    "platforms",
  ], path);
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    `${path}.imageReference`,
  );
  const platforms = arrayOf(root.platforms, `${path}.platforms`).map((
    platform,
    index,
  ) => parsePlatform(platform, `${path}.platforms[${index}]`));
  if (platforms.length === 0) {
    throw new TypeError(`${path}.platforms must not be empty.`);
  }
  rejectDuplicates(platforms, `${path}.platforms`);
  return deepFreeze({
    unitId: safeId(root.unitId, `${path}.unitId`),
    unitVersion: exactVersionToken(root.unitVersion, `${path}.unitVersion`),
    materialId: safeId(root.materialId, `${path}.materialId`),
    imageReference,
    platforms,
  });
}

function parseLaunchGroup(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationProfile["launchGroup"] {
  const root = exactRecord(value, [
    "id",
    "version",
    "projectName",
    "serviceName",
    "loopbackHostPort",
    "containerPort",
    "volumes",
    "secretSlots",
    "readiness",
    "security",
  ], path);
  const projectName = nonEmptyText(root.projectName, `${path}.projectName`);
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectName)) {
    throw new TypeError(`${path}.projectName is not a safe Compose project name.`);
  }
  const volumes = arrayOf(root.volumes, `${path}.volumes`).map((volume, index) =>
    parseVolume(volume, `${path}.volumes[${index}]`)
  );
  rejectDuplicates(volumes.map((volume) => volume.id), `${path}.volumes[].id`);
  rejectDuplicates(
    volumes.map((volume) => volume.containerPath),
    `${path}.volumes[].containerPath`,
  );
  const secretSlots = arrayOf(root.secretSlots, `${path}.secretSlots`).map((
    slot,
    index,
  ) => parseSecretSlot(slot, `${path}.secretSlots[${index}]`));
  rejectDuplicates(secretSlots.map((slot) => slot.id), `${path}.secretSlots[].id`);
  rejectDuplicates(
    secretSlots.map((slot) => slot.composeEnvironmentKey),
    `${path}.secretSlots[].composeEnvironmentKey`,
  );
  const readiness = parseReadiness(root.readiness, `${path}.readiness`);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    projectName,
    serviceName: safeId(root.serviceName, `${path}.serviceName`),
    loopbackHostPort: parsePort(root.loopbackHostPort, `${path}.loopbackHostPort`),
    containerPort: parsePort(root.containerPort, `${path}.containerPort`),
    volumes,
    secretSlots,
    readiness,
    security: oneOf(
      root.security,
      ["reviewed", "unknown"] as const,
      `${path}.security`,
    ),
  });
}

function parseVolume(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationVolume {
  const root = exactRecord(value, [
    "id",
    "access",
    "preservation",
    "containerPath",
  ], path);
  const containerPath = nonEmptyText(root.containerPath, `${path}.containerPath`);
  if (
    !containerPath.startsWith("/") || containerPath.includes("..") ||
    containerPath.includes("//") || containerPath.includes("\\") ||
    containerPath.includes(":")
  ) {
    throw new TypeError(`${path}.containerPath must be an absolute container path.`);
  }
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    access: oneOf(
      root.access,
      ["read-only", "read-write"] as const,
      `${path}.access`,
    ),
    preservation: oneOf(
      root.preservation,
      ["preserve", "ephemeral"] as const,
      `${path}.preservation`,
    ),
    containerPath,
  });
}

function parseSecretSlot(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationSecretSlot {
  const root = exactRecord(value, ["id", "composeEnvironmentKey"], path);
  const composeEnvironmentKey = nonEmptyText(
    root.composeEnvironmentKey,
    `${path}.composeEnvironmentKey`,
  );
  if (!/^[A-Z][A-Z0-9_]*$/.test(composeEnvironmentKey)) {
    throw new TypeError(
      `${path}.composeEnvironmentKey must be a closed Compose environment key.`,
    );
  }
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    composeEnvironmentKey,
  });
}

function parseReadiness(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationProfile["launchGroup"]["readiness"] {
  const root = exactRecord(value, [
    "timeoutMs",
    "attemptTimeoutMs",
    "retryIntervalMs",
  ], path);
  const timeoutMs = positiveInteger(root.timeoutMs, `${path}.timeoutMs`);
  const attemptTimeoutMs = positiveInteger(
    root.attemptTimeoutMs,
    `${path}.attemptTimeoutMs`,
  );
  const retryIntervalMs = positiveInteger(
    root.retryIntervalMs,
    `${path}.retryIntervalMs`,
  );
  if (attemptTimeoutMs > timeoutMs || retryIntervalMs > timeoutMs) {
    throw new TypeError(
      `${path} attempt and retry windows must not exceed the total timeout.`,
    );
  }
  return deepFreeze({ timeoutMs, attemptTimeoutMs, retryIntervalMs });
}

function parseSourceInstance(value: unknown, path: string): BuySourceInstance {
  const root = exactRecord(value, ["kind", "siteId"], path);
  literalValue(root.kind, BUY_SOURCE_INSTANCE_KIND, `${path}.kind`);
  return deepFreeze({
    kind: BUY_SOURCE_INSTANCE_KIND,
    siteId: prefixedSha256(root.siteId, `${path}.siteId`),
  });
}

function parseQualificationHost(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationProfile["qualificationHost"] {
  const root = exactRecord(value, [
    "observedHostPlatform",
    "targetPlatform",
    "mode",
  ], path);
  const mode = root.mode;
  if (mode !== "native" && mode !== "emulated") {
    throw new TypeError(`${path}.mode is unsupported.`);
  }
  return deepFreeze({
    observedHostPlatform: parsePlatform(
      root.observedHostPlatform,
      `${path}.observedHostPlatform`,
    ),
    targetPlatform: parsePlatform(root.targetPlatform, `${path}.targetPlatform`),
    mode,
  });
}

function parseLicence(
  value: unknown,
  path: string,
): LocalErpnextBuyInstallationProfile["licence"] {
  const root = exactRecord(value, ["status", "reference"], path);
  const status = oneOf(
    root.status,
    ["reviewed", "unknown"] as const,
    `${path}.status`,
  );
  if (root.reference !== null && typeof root.reference !== "string") {
    throw new TypeError(`${path}.reference must be a string or null.`);
  }
  if (status === "reviewed" && root.reference === null) {
    throw new TypeError(`${path}.reference is required when the licence is reviewed.`);
  }
  if (
    root.reference !== null &&
    (root.reference.includes("..") || root.reference.includes("\\") ||
      root.reference.includes("\0") || root.reference.startsWith("/"))
  ) {
    throw new TypeError(`${path}.reference must be a repository-relative reference.`);
  }
  return deepFreeze({
    status,
    reference: root.reference === null ? null : nonEmptyText(
      root.reference,
      `${path}.reference`,
    ),
  });
}

function parsePlatform(value: unknown, path: string): CapabilityRuntimePlatform {
  if (value === "linux/arm64" || value === "linux/amd64") return value;
  throw new TypeError(`${path} is unsupported.`);
}

function parsePort(value: unknown, path: string): number {
  const port = positiveInteger(value, path);
  if (port > 65_535) throw new TypeError(`${path} must be at most 65535.`);
  return port;
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

export function imageDigestFromPinnedReference(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  const digest = index < 0 ? "" : reference.slice(index + marker.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError("ERP Buy image must be SHA-256 pinned.");
  }
  return digest;
}
