import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyArray,
  positiveInteger,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "../../domain/kernel/case-validation.ts";
import {
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeRef,
} from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  CAPABILITY_INSTALLATION_LOCK_SCHEMA_VERSION,
  CAPABILITY_PACK_SCHEMA_VERSION,
  type CapabilityBindingClaim,
  type CapabilityInstallationLock,
  type CapabilityPackActivation,
  type CapabilityPackManifest,
  type CapabilityPackMinimumQualification,
  type CapabilityPackTrustPolicy,
  type CapabilityRuntimeMaterial,
  type InstalledCapabilityPack,
} from "../../application/control-plane/read-model/capability-pack.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SEMVER_CORE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SEMVER_IDENTIFIER = /^[0-9A-Za-z-]+$/;

export interface CapabilityPackFileLoaderOptions {
  readonly readTextFile?: (path: string) => Promise<string>;
}

export class CapabilityPackContractError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityPackContractError";
  }
}

export async function loadCapabilityPackManifest(
  path: string,
  options: CapabilityPackFileLoaderOptions = {},
): Promise<CapabilityPackManifest> {
  const value = await loadJson(path, options);
  return validateCapabilityPackManifest(value);
}

export async function loadCapabilityInstallationLock(
  path: string,
  options: CapabilityPackFileLoaderOptions = {},
): Promise<CapabilityInstallationLock> {
  const value = await loadJson(path, options);
  return validateCapabilityInstallationLock(value);
}

export function validateCapabilityPackManifest(
  value: unknown,
): CapabilityPackManifest {
  return asContractError(() => parseCapabilityPackManifest(value));
}

export function validateCapabilityInstallationLock(
  value: unknown,
): CapabilityInstallationLock {
  return asContractError(() => parseCapabilityInstallationLock(value));
}

function parseCapabilityPackManifest(value: unknown): CapabilityPackManifest {
  const root = exactRecord(
    value,
    ["schemaVersion", "id", "version", "bindingClaims", "materials"],
    "$pack",
  );
  literalValue(
    root.schemaVersion,
    CAPABILITY_PACK_SCHEMA_VERSION,
    "$pack.schemaVersion",
  );
  const id = safeId(root.id, "$pack.id");
  const version = semanticVersion(root.version, "$pack.version");
  const materials = nonEmptyArray(root.materials, "$pack.materials").map(
    (material, index) => parseMaterial(material, `$pack.materials[${index}]`),
  );
  validateMaterialGraph(materials);
  const bindingClaims = nonEmptyArray(
    root.bindingClaims,
    "$pack.bindingClaims",
  ).map((claim, index) => parseBindingClaim(claim, `$pack.bindingClaims[${index}]`));
  rejectDuplicates(
    bindingClaims.map((claim) => claim.id),
    "$pack.bindingClaims[].id",
  );
  validateBindingMaterials(bindingClaims, materials);
  validateImageEstimates(materials);
  return deepFreeze({
    schemaVersion: CAPABILITY_PACK_SCHEMA_VERSION,
    id,
    version,
    bindingClaims,
    materials,
  });
}

function parseBindingClaim(value: unknown, path: string): CapabilityBindingClaim {
  const root = exactRecord(
    value,
    ["id", "version", "capability", "materialIds"],
    path,
  );
  const capability = exactRecord(
    root.capability,
    ["id", "version"],
    `${path}.capability`,
  );
  const materialIds = nonEmptyArray(root.materialIds, `${path}.materialIds`).map(
    (id, index) => safeId(id, `${path}.materialIds[${index}]`),
  );
  rejectDuplicates(materialIds, `${path}.materialIds`);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: semanticVersion(root.version, `${path}.version`),
    capability: {
      id: safeId(capability.id, `${path}.capability.id`),
      version: exactVersionToken(
        capability.version,
        `${path}.capability.version`,
      ),
    },
    materialIds,
  });
}

function parseMaterial(value: unknown, path: string): CapabilityRuntimeMaterial {
  const probe = closedRecord(
    value,
    [
      "id",
      "kind",
      "image",
      "platforms",
      "dependsOn",
      "estimatedBytes",
      "serviceName",
      "exposure",
      "runner",
      "policyFingerprint",
      "network",
    ],
    ["id", "kind", "image", "platforms", "dependsOn"],
    path,
  );
  if (probe.kind === "compose-service") {
    const root = closedRecord(
      value,
      [
        "id",
        "kind",
        "image",
        "platforms",
        "dependsOn",
        "estimatedBytes",
        "serviceName",
        "exposure",
      ],
      [
        "id",
        "kind",
        "image",
        "platforms",
        "dependsOn",
        "serviceName",
        "exposure",
      ],
      path,
    );
    literalValue(root.kind, "compose-service", `${path}.kind`);
    const exposure = oneOf(
      root.exposure,
      ["internal", "loopback-only"] as const,
      `${path}.exposure`,
    );
    return deepFreeze({
      ...parseMaterialBase(root, path),
      kind: "compose-service",
      serviceName: safeId(root.serviceName, `${path}.serviceName`),
      exposure,
    });
  }
  if (probe.kind === "microvm-image") {
    const root = closedRecord(
      value,
      [
        "id",
        "kind",
        "image",
        "platforms",
        "dependsOn",
        "estimatedBytes",
        "runner",
        "policyFingerprint",
        "network",
      ],
      [
        "id",
        "kind",
        "image",
        "platforms",
        "dependsOn",
        "runner",
        "policyFingerprint",
        "network",
      ],
      path,
    );
    literalValue(root.kind, "microvm-image", `${path}.kind`);
    literalValue(root.network, "deny-all", `${path}.network`);
    return deepFreeze({
      ...parseMaterialBase(root, path),
      kind: "microvm-image",
      runner: validateMicrosandboxLocalRuntimeRef(
        root.runner,
        `${path}.runner`,
      ),
      policyFingerprint: fingerprint(
        root.policyFingerprint,
        `${path}.policyFingerprint`,
      ),
      network: "deny-all",
    });
  }
  throw new TypeError(
    `${path}.kind must be one of: compose-service, microvm-image.`,
  );
}

function parseMaterialBase(
  root: Record<string, unknown>,
  path: string,
) {
  const platforms = nonEmptyArray(root.platforms, `${path}.platforms`).map(
    (platform, index) =>
      oneOf(
        platform,
        ["linux/amd64", "linux/arm64"] as const,
        `${path}.platforms[${index}]`,
      ),
  );
  rejectDuplicates(platforms, `${path}.platforms`);
  const dependsOn = arrayOf(root.dependsOn, `${path}.dependsOn`).map(
    (dependency, index) => safeId(dependency, `${path}.dependsOn[${index}]`),
  );
  rejectDuplicates(dependsOn, `${path}.dependsOn`);
  return {
    id: safeId(root.id, `${path}.id`),
    image: pinnedOciImageReference(root.image, `${path}.image`),
    platforms,
    dependsOn,
    estimatedBytes: root.estimatedBytes === undefined
      ? undefined
      : positiveInteger(root.estimatedBytes, `${path}.estimatedBytes`),
  } as const;
}

function validateMaterialGraph(
  materials: readonly CapabilityRuntimeMaterial[],
): void {
  rejectDuplicates(
    materials.map((material) => material.id),
    "$pack.materials[].id",
  );
  const byId = new Map(materials.map((material) => [material.id, material]));
  for (const material of materials) {
    for (const dependency of material.dependsOn) {
      if (dependency === material.id) {
        throw new TypeError(
          `$pack.materials.${material.id}.dependsOn cannot contain itself.`,
        );
      }
      if (!byId.has(dependency)) {
        throw new TypeError(
          `$pack.materials.${material.id}.dependsOn references unknown material ${dependency}.`,
        );
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const visit = (id: string, chain: readonly string[]): void => {
    if (state.get(id) === "visited") return;
    if (state.get(id) === "visiting") {
      throw new TypeError(
        `$pack.materials dependency cycle: ${[...chain, id].join(" -> ")}.`,
      );
    }
    state.set(id, "visiting");
    for (const dependency of byId.get(id)!.dependsOn) {
      visit(dependency, [...chain, id]);
    }
    state.set(id, "visited");
  };
  for (const material of materials) visit(material.id, []);
}

function validateBindingMaterials(
  claims: readonly CapabilityBindingClaim[],
  materials: readonly CapabilityRuntimeMaterial[],
): void {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const reachable = new Set<string>();
  const visit = (id: string): void => {
    const material = byId.get(id);
    if (!material) {
      throw new TypeError(
        `$pack.bindingClaims references unknown material ${id}.`,
      );
    }
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of material.dependsOn) visit(dependency);
  };
  for (const claim of claims) {
    for (const materialId of claim.materialIds) visit(materialId);
  }
  const orphan = materials.find((material) => !reachable.has(material.id));
  if (orphan) {
    throw new TypeError(
      `$pack.materials contains unreferenced material ${orphan.id}.`,
    );
  }
}

function validateImageEstimates(
  materials: readonly CapabilityRuntimeMaterial[],
): void {
  const estimates = new Map<string, number>();
  for (const material of materials) {
    if (material.estimatedBytes === undefined) continue;
    const previous = estimates.get(material.image);
    if (previous !== undefined && previous !== material.estimatedBytes) {
      throw new TypeError(
        `$pack.materials gives conflicting byte estimates for shared image ${material.image}.`,
      );
    }
    estimates.set(material.image, material.estimatedBytes);
  }
}

function parseCapabilityInstallationLock(
  value: unknown,
): CapabilityInstallationLock {
  const root = exactRecord(
    value,
    ["schemaVersion", "revision", "previous", "packs"],
    "$lock",
  );
  literalValue(
    root.schemaVersion,
    CAPABILITY_INSTALLATION_LOCK_SCHEMA_VERSION,
    "$lock.schemaVersion",
  );
  const packs = arrayOf(root.packs, "$lock.packs").map((pack, index) =>
    parseInstalledPack(pack, `$lock.packs[${index}]`)
  );
  rejectDuplicates(packs.map((pack) => pack.id), "$lock.packs[].id");
  return deepFreeze({
    schemaVersion: CAPABILITY_INSTALLATION_LOCK_SCHEMA_VERSION,
    revision: positiveInteger(root.revision, "$lock.revision"),
    previous: root.previous === null
      ? null
      : fingerprint(root.previous, "$lock.previous"),
    packs,
  });
}

function parseInstalledPack(value: unknown, path: string): InstalledCapabilityPack {
  const root = exactRecord(
    value,
    [
      "id",
      "version",
      "manifest",
      "activation",
      "policy",
      "secretSlots",
      "routes",
    ],
    path,
  );
  const policy = exactRecord(
    root.policy,
    ["trust", "minimumQualification", "bindingMode"],
    `${path}.policy`,
  );
  const activation = oneOf(
    root.activation,
    ["inactive", "active"] as const,
    `${path}.activation`,
  ) as CapabilityPackActivation;
  const trust = oneOf(
    policy.trust,
    ["first-party-only", "reviewed-community"] as const,
    `${path}.policy.trust`,
  ) as CapabilityPackTrustPolicy;
  const minimumQualification = oneOf(
    policy.minimumQualification,
    ["compatible", "qualified"] as const,
    `${path}.policy.minimumQualification`,
  ) as CapabilityPackMinimumQualification;
  literalValue(
    policy.bindingMode,
    "server-policy",
    `${path}.policy.bindingMode`,
  );
  const secretSlots = arrayOf(root.secretSlots, `${path}.secretSlots`).map(
    (slot, index) => safeId(slot, `${path}.secretSlots[${index}]`),
  );
  rejectDuplicates(secretSlots, `${path}.secretSlots`);
  const routes = arrayOf(root.routes, `${path}.routes`).map((route, index) => {
    const routePath = `${path}.routes[${index}]`;
    const entry = exactRecord(route, ["materialId", "port"], routePath);
    const port = positiveInteger(entry.port, `${routePath}.port`);
    if (port > 65_535) {
      throw new TypeError(`${routePath}.port must be at most 65535.`);
    }
    return deepFreeze({
      materialId: safeId(entry.materialId, `${routePath}.materialId`),
      port,
    });
  });
  rejectDuplicates(
    routes.map((route) => route.materialId),
    `${path}.routes[].materialId`,
  );
  rejectDuplicates(
    routes.map((route) => String(route.port)),
    `${path}.routes[].port`,
  );
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: semanticVersion(root.version, `${path}.version`),
    manifest: fingerprint(root.manifest, `${path}.manifest`),
    activation,
    policy: {
      trust,
      minimumQualification,
      bindingMode: "server-policy",
    },
    secretSlots,
    routes,
  });
}

function semanticVersion(value: unknown, path: string): string {
  const version = safeVersion(value, path);
  const buildMarker = version.indexOf("+");
  if (buildMarker !== -1 && version.indexOf("+", buildMarker + 1) !== -1) {
    throw new TypeError(`${path} must contain at most one build separator.`);
  }
  const withoutBuild = buildMarker === -1 ? version : version.slice(0, buildMarker);
  const build = buildMarker === -1 ? undefined : version.slice(buildMarker + 1);
  const prereleaseMarker = withoutBuild.indexOf("-");
  const core = prereleaseMarker === -1
    ? withoutBuild
    : withoutBuild.slice(0, prereleaseMarker);
  const prerelease = prereleaseMarker === -1
    ? undefined
    : withoutBuild.slice(prereleaseMarker + 1);
  if (!SEMVER_CORE.test(core)) {
    throw new TypeError(`${path} must be an exact semantic version.`);
  }
  if (prerelease !== undefined) {
    validateSemverIdentifiers(prerelease, `${path} prerelease`, true);
  }
  if (build !== undefined) {
    validateSemverIdentifiers(build, `${path} build`, false);
  }
  return version;
}

function validateSemverIdentifiers(
  value: string,
  path: string,
  rejectNumericLeadingZero: boolean,
): void {
  const identifiers = value.split(".");
  if (
    identifiers.some((identifier) =>
      !SEMVER_IDENTIFIER.test(identifier) ||
      (rejectNumericLeadingZero && /^[0-9]+$/.test(identifier) &&
        identifier.length > 1 && identifier.startsWith("0"))
    )
  ) {
    throw new TypeError(`${path} contains an invalid semantic-version identifier.`);
  }
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !SHA256_HEX.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

async function loadJson(
  path: string,
  options: CapabilityPackFileLoaderOptions,
): Promise<unknown> {
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  let text: string;
  try {
    text = await readTextFile(path);
  } catch (error) {
    throw new CapabilityPackContractError(
      `Unable to read ${path}: ${errorMessage(error)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CapabilityPackContractError(
      `Invalid JSON in ${path}: ${errorMessage(error)}`,
    );
  }
}

function asContractError<T>(body: () => T): T {
  try {
    return body();
  } catch (error) {
    if (error instanceof CapabilityPackContractError) throw error;
    throw new CapabilityPackContractError(errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
