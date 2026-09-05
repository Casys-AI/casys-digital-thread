import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  type AtomicCapabilityRuntimeMaterial,
  type AtomicCapabilityRuntimeUnit,
  CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
  type CapabilityRuntimeAdapterReference,
  type CapabilityRuntimeAdminPolicy,
  type CapabilityRuntimeBindingPreference,
  type CapabilityRuntimeCatalog,
  type CapabilityRuntimeHostEffects,
  type CapabilityRuntimeHostObservation,
  type CapabilityRuntimeLicence,
  type CapabilityRuntimeObservedImage,
  type CapabilityRuntimeProfileReference,
  type CapabilityRuntimeQualificationEvidence,
  type CapabilityRuntimeVolume,
  fingerprintAtomicCapabilityRuntimeUnit,
  type QualifiedCapabilityRuntimeBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeMaterialRuntimeMode,
  CapabilityRuntimePlatform,
} from "../../domain/capability/runtime/capability-runtime-material.ts";
import type {
  CapabilityReference,
} from "../../domain/capability/engineering-capability.ts";
export {
  validateCapabilityRuntimeAdminLock,
} from "../../application/control-plane/validate-capability-runtime-admin-lock.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Strict parser for repository-trusted atomic units and bindings. */
export async function validateCapabilityRuntimeCatalog(
  value: unknown,
): Promise<CapabilityRuntimeCatalog> {
  const root = exactRecord(
    value,
    ["schemaVersion", "productionEligible", "units", "bindings"],
    "$catalog",
  );
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION,
    "$catalog.schemaVersion",
  );
  literalValue(root.productionEligible, false, "$catalog.productionEligible");
  const units = nonEmptyArray(root.units, "$catalog.units").map((unit, index) =>
    parseUnit(unit, `$catalog.units[${index}]`)
  );
  rejectDuplicates(units.map((unit) => unit.id), "$catalog.units[].id");
  await Promise.all(
    units.map((unit, index) =>
      assertAtomicUnitManifestFingerprint(unit, `$catalog.units[${index}]`)
    ),
  );
  const materialIds = units.flatMap((unit) =>
    unit.materials.map((material) => material.id)
  );
  rejectDuplicates(materialIds, "$catalog.units[].materials[].id");
  const bindings = nonEmptyArray(root.bindings, "$catalog.bindings").map((
    binding,
    index,
  ) => parseBinding(binding, `$catalog.bindings[${index}]`));
  rejectDuplicates(bindings.map((binding) => binding.id), "$catalog.bindings[].id");
  const unitIds = new Set(units.map((unit) => unit.id));
  for (const binding of bindings) {
    for (const unitId of binding.unitIds) {
      if (!unitIds.has(unitId)) {
        throw new TypeError(
          `$catalog binding ${binding.id} references unknown unit ${unitId}.`,
        );
      }
    }
  }
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION,
    productionEligible: false,
    units,
    bindings,
  });
}

/** Strict local policy parser; optional catalogue validation rejects invented ids. */
export function validateCapabilityRuntimeAdminPolicy(
  value: unknown,
  catalog?: CapabilityRuntimeCatalog,
): CapabilityRuntimeAdminPolicy {
  const root = exactRecord(
    value,
    ["schemaVersion", "disabledBindingIds", "preferences"],
    "$adminPolicy",
  );
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
    "$adminPolicy.schemaVersion",
  );
  const disabledBindingIds = arrayOf(
    root.disabledBindingIds,
    "$adminPolicy.disabledBindingIds",
  )
    .map((id, index) => safeId(id, `$adminPolicy.disabledBindingIds[${index}]`));
  rejectDuplicates(disabledBindingIds, "$adminPolicy.disabledBindingIds");
  const preferences = arrayOf(root.preferences, "$adminPolicy.preferences").map(
    (preference, index) =>
      parsePreference(preference, `$adminPolicy.preferences[${index}]`),
  );
  rejectDuplicates(
    preferences.map((preference) => preferenceKey(preference)),
    "$adminPolicy.preferences[]",
  );
  if (catalog) {
    const bindingIds = new Set(catalog.bindings.map((binding) => binding.id));
    for (const bindingId of disabledBindingIds) {
      if (!bindingIds.has(bindingId)) {
        throw new TypeError(`$adminPolicy disables unknown binding ${bindingId}.`);
      }
    }
    for (const preference of preferences) {
      for (const bindingId of preference.bindingIds) {
        const binding = catalog.bindings.find((candidate) =>
          candidate.id === bindingId
        );
        if (!binding) {
          throw new TypeError(
            `$adminPolicy preference references unknown binding ${bindingId}.`,
          );
        }
        if (
          binding.capability.id !== preference.capability.id ||
          binding.capability.version !== preference.capability.version ||
          binding.use !== preference.use
        ) {
          throw new TypeError(
            `$adminPolicy preference ${bindingId} does not match its capability requirement.`,
          );
        }
      }
    }
  }
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
    disabledBindingIds,
    preferences,
  });
}

/** Strict read-only host observation parser. It never probes a host itself. */
export function validateCapabilityRuntimeHostObservation(
  value: unknown,
): CapabilityRuntimeHostObservation {
  const root = exactRecord(
    value,
    ["schemaVersion", "identityFingerprint", "platform", "images"],
    "$hostObservation",
  );
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
    "$hostObservation.schemaVersion",
  );
  const platform = parsePlatform(root.platform, "$hostObservation.platform");
  const images = arrayOf(root.images, "$hostObservation.images").map((image, index) =>
    parseObservedImage(image, `$hostObservation.images[${index}]`)
  );
  rejectDuplicates(
    images.map((image) => image.reference),
    "$hostObservation.images[].reference",
  );
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
    identityFingerprint: fingerprint(
      root.identityFingerprint,
      "$hostObservation.identityFingerprint",
    ),
    platform,
    images,
  });
}

function parseUnit(value: unknown, path: string): AtomicCapabilityRuntimeUnit {
  const root = exactRecord(
    value,
    ["id", "version", "manifestFingerprint", "materials"],
    path,
  );
  const materials = nonEmptyArray(root.materials, `${path}.materials`).map((
    material,
    index,
  ) => parseMaterial(material, `${path}.materials[${index}]`));
  rejectDuplicates(materials.map((material) => material.id), `${path}.materials[].id`);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    manifestFingerprint: fingerprint(
      root.manifestFingerprint,
      `${path}.manifestFingerprint`,
    ),
    materials,
  });
}

function parseMaterial(value: unknown, path: string): AtomicCapabilityRuntimeMaterial {
  const root = exactRecord(
    value,
    [
      "id",
      "kind",
      "imageReference",
      "platforms",
      "lifecycle",
      "launchGroup",
      "effects",
    ],
    path,
  );
  const kind = oneOf(
    root.kind,
    ["compose-service", "microvm-image", "oci-image"] as const,
    `${path}.kind`,
  );
  const lifecycle = oneOf(
    root.lifecycle,
    ["persistent", "ephemeral", "cache"] as const,
    `${path}.lifecycle`,
  );
  const expectedLifecycle = kind === "compose-service"
    ? "persistent"
    : kind === "microvm-image"
    ? "ephemeral"
    : "cache";
  if (lifecycle !== expectedLifecycle) {
    throw new TypeError(
      `${path} must use ${expectedLifecycle} lifecycle for ${kind}.`,
    );
  }
  const platforms = arrayOf(root.platforms, `${path}.platforms`).map((
    candidate,
    index,
  ) => parsePlatform(candidate, `${path}.platforms[${index}]`));
  rejectDuplicates(platforms, `${path}.platforms`);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    kind,
    imageReference: pinnedOciImageReference(
      root.imageReference,
      `${path}.imageReference`,
    ),
    platforms,
    lifecycle,
    launchGroup: root.launchGroup === null
      ? null
      : parseLaunchGroupReference(root.launchGroup, `${path}.launchGroup`),
    effects: parseEffects(root.effects, `${path}.effects`),
  });
}

function parseLaunchGroupReference(
  value: unknown,
  path: string,
): NonNullable<AtomicCapabilityRuntimeMaterial["launchGroup"]> {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

async function assertAtomicUnitManifestFingerprint(
  unit: AtomicCapabilityRuntimeUnit,
  path: string,
): Promise<void> {
  const expected = await fingerprintAtomicCapabilityRuntimeUnit(unit);
  if (!sameFingerprint(unit.manifestFingerprint, expected)) {
    throw new TypeError(
      `${path}.manifestFingerprint does not match the canonical unit body.`,
    );
  }
}

function parseEffects(value: unknown, path: string): CapabilityRuntimeHostEffects {
  const root = exactRecord(
    value,
    [
      "downloadBytes",
      "storageBytes",
      "services",
      "volumes",
      "network",
      "loopbackPorts",
      "bindMounts",
      "privileged",
      "dockerSocket",
      "devices",
      "secretSlots",
      "licence",
      "security",
    ],
    path,
  );
  const services = arrayOf(root.services, `${path}.services`).map((service, index) => {
    const servicePath = `${path}.services[${index}]`;
    const entry = exactRecord(service, ["id", "lifecycle"], servicePath);
    return deepFreeze({
      id: safeId(entry.id, `${servicePath}.id`),
      lifecycle: oneOf(
        entry.lifecycle,
        ["persistent", "ephemeral"] as const,
        `${servicePath}.lifecycle`,
      ),
    });
  });
  rejectDuplicates(services.map((service) => service.id), `${path}.services[].id`);
  const volumes = arrayOf(root.volumes, `${path}.volumes`).map((volume, index) =>
    parseVolume(volume, `${path}.volumes[${index}]`)
  );
  rejectDuplicates(volumes.map((volume) => volume.id), `${path}.volumes[].id`);
  const network = oneOf(
    root.network,
    ["internal", "loopback-only", "deny-all"] as const,
    `${path}.network`,
  );
  const loopbackPorts = arrayOf(root.loopbackPorts, `${path}.loopbackPorts`).map(
    (port, index) => {
      const parsed = positiveInteger(port, `${path}.loopbackPorts[${index}]`);
      if (parsed > 65_535) {
        throw new TypeError(`${path}.loopbackPorts[${index}] must be at most 65535.`);
      }
      return parsed;
    },
  );
  if (new Set(loopbackPorts).size !== loopbackPorts.length) {
    throw new TypeError(`${path}.loopbackPorts must not contain duplicates.`);
  }
  if (network === "loopback-only" && loopbackPorts.length === 0) {
    throw new TypeError(
      `${path}.loopbackPorts is required for a loopback-only service.`,
    );
  }
  if (network !== "loopback-only" && loopbackPorts.length > 0) {
    throw new TypeError(
      `${path}.loopbackPorts is only valid for loopback-only services.`,
    );
  }
  const bindMounts = arrayOf(root.bindMounts, `${path}.bindMounts`).map(
    (mount, index) => {
      const mountPath = `${path}.bindMounts[${index}]`;
      const entry = exactRecord(mount, ["target", "access"], mountPath);
      return deepFreeze({
        target: absoluteContainerPath(entry.target, `${mountPath}.target`),
        access: oneOf(
          entry.access,
          ["read-only", "read-write"] as const,
          `${mountPath}.access`,
        ),
      });
    },
  );
  rejectDuplicates(
    bindMounts.map((mount) => mount.target),
    `${path}.bindMounts[].target`,
  );
  const secretSlots = arrayOf(root.secretSlots, `${path}.secretSlots`).map((
    slot,
    index,
  ) => safeId(slot, `${path}.secretSlots[${index}]`));
  rejectDuplicates(secretSlots, `${path}.secretSlots`);
  const devices = arrayOf(root.devices, `${path}.devices`).map((device, index) =>
    safeId(device, `${path}.devices[${index}]`)
  );
  rejectDuplicates(devices, `${path}.devices`);
  if (root.dockerSocket !== false) {
    throw new TypeError(`${path}.dockerSocket must equal false.`);
  }
  if (root.privileged !== false) {
    throw new TypeError(`${path}.privileged must equal false.`);
  }
  const licence = parseLicence(root.licence, `${path}.licence`);
  return deepFreeze({
    downloadBytes: nullableBytes(root.downloadBytes, `${path}.downloadBytes`),
    storageBytes: nullableBytes(root.storageBytes, `${path}.storageBytes`),
    services,
    volumes,
    network,
    loopbackPorts,
    bindMounts,
    privileged: false,
    dockerSocket: false,
    devices,
    secretSlots,
    licence,
    security: oneOf(
      root.security,
      ["reviewed", "unknown"] as const,
      `${path}.security`,
    ),
  });
}

function parseVolume(value: unknown, path: string): CapabilityRuntimeVolume {
  const root = exactRecord(value, ["id", "access", "preservation"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    access: oneOf(root.access, ["read-only", "read-write"] as const, `${path}.access`),
    preservation: oneOf(
      root.preservation,
      ["preserve", "ephemeral"] as const,
      `${path}.preservation`,
    ),
  });
}

function parseLicence(value: unknown, path: string): CapabilityRuntimeLicence {
  const root = exactRecord(value, ["status", "reference"], path);
  const status = oneOf(root.status, ["reviewed", "unknown"] as const, `${path}.status`);
  if (root.reference !== null && typeof root.reference !== "string") {
    throw new TypeError(`${path}.reference must be a string or null.`);
  }
  if (status === "reviewed" && root.reference === null) {
    throw new TypeError(`${path}.reference is required when the licence is reviewed.`);
  }
  return deepFreeze({
    status,
    reference: root.reference === null
      ? null
      : repositoryReference(root.reference, `${path}.reference`),
  });
}

function parseBinding(value: unknown, path: string): QualifiedCapabilityRuntimeBinding {
  const root = exactRecord(
    value,
    [
      "id",
      "version",
      "capability",
      "use",
      "qualification",
      "adapter",
      "profile",
      "unitIds",
      "qualificationEvidence",
      "runtimeModes",
      "limitations",
    ],
    path,
  );
  const unitIds = nonEmptyArray(root.unitIds, `${path}.unitIds`).map((id, index) =>
    safeId(id, `${path}.unitIds[${index}]`)
  );
  rejectDuplicates(unitIds, `${path}.unitIds`);
  const limitations = arrayOf(root.limitations, `${path}.limitations`).map((
    limitation,
    index,
  ) => nonEmptyText(limitation, `${path}.limitations[${index}]`));
  rejectDuplicates(limitations, `${path}.limitations`);
  const runtimeModes = parseRuntimeModes(root.runtimeModes, `${path}.runtimeModes`);
  if (runtimeModes.length > 0) {
    throw new TypeError(
      `${path}.runtimeModes must be empty in the code-owned catalogue baseline.`,
    );
  }
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    capability: parseCapability(root.capability, `${path}.capability`),
    use: oneOf(root.use, ["preparation", "execution"] as const, `${path}.use`),
    qualification: oneOf(
      root.qualification,
      ["compatible", "qualified", "unqualified", "revoked"] as const,
      `${path}.qualification`,
    ),
    adapter: parseAdapter(root.adapter, `${path}.adapter`),
    profile: root.profile === null
      ? null
      : parseProfile(root.profile, `${path}.profile`),
    unitIds,
    qualificationEvidence: parseQualificationEvidence(
      root.qualificationEvidence,
      `${path}.qualificationEvidence`,
    ),
    runtimeModes,
    limitations,
  });
}

function parseRuntimeModes(
  value: unknown,
  path: string,
): readonly CapabilityRuntimeMaterialRuntimeMode[] {
  const modes = arrayOf(value, path).map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const root = exactRecord(entry, [
      "material",
      "targetPlatform",
      "mode",
      "qualificationAttestationFingerprint",
    ], entryPath);
    const material = parseRuntimeModeMaterial(root.material, `${entryPath}.material`);
    const targetPlatform = parsePlatform(
      root.targetPlatform,
      `${entryPath}.targetPlatform`,
    );
    const mode = oneOf(root.mode, ["native", "emulated"] as const, `${entryPath}.mode`);
    return deepFreeze({
      material,
      targetPlatform,
      mode,
      qualificationAttestationFingerprint:
        root.qualificationAttestationFingerprint === null ? null : fingerprint(
          root.qualificationAttestationFingerprint,
          `${entryPath}.qualificationAttestationFingerprint`,
        ),
    });
  });
  rejectDuplicates(
    modes.map((mode) =>
      `${mode.material.unitId}\u0000${mode.material.materialId}\u0000${mode.material.imageDigest}`
    ),
    path,
  );
  return modes;
}

function parseRuntimeModeMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeMaterialRuntimeMode["material"] {
  const root = exactRecord(value, ["unitId", "materialId", "imageDigest"], path);
  const imageDigest = nonEmptyText(root.imageDigest, `${path}.imageDigest`);
  if (!SHA256_HEX.test(imageDigest)) {
    throw new TypeError(`${path}.imageDigest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({
    unitId: safeId(root.unitId, `${path}.unitId`),
    materialId: safeId(root.materialId, `${path}.materialId`),
    imageDigest,
  });
}

function parseCapability(value: unknown, path: string): CapabilityReference {
  const root = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
  });
}

function parseAdapter(value: unknown, path: string): CapabilityRuntimeAdapterReference {
  const root = exactRecord(value, ["id", "version", "source"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    source: repositoryReference(root.source, `${path}.source`),
  });
}

function parseProfile(value: unknown, path: string): CapabilityRuntimeProfileReference {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: root.fingerprint === null
      ? null
      : fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function parseQualificationEvidence(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationEvidence {
  const root = exactRecord(value, ["id", "source", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    source: repositoryReference(root.source, `${path}.source`),
    fingerprint: root.fingerprint === null
      ? null
      : fingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function parsePreference(
  value: unknown,
  path: string,
): CapabilityRuntimeBindingPreference {
  const root = exactRecord(value, ["capability", "use", "bindingIds"], path);
  const bindingIds = nonEmptyArray(root.bindingIds, `${path}.bindingIds`).map((
    id,
    index,
  ) => safeId(id, `${path}.bindingIds[${index}]`));
  rejectDuplicates(bindingIds, `${path}.bindingIds`);
  return deepFreeze({
    capability: parseCapability(root.capability, `${path}.capability`),
    use: oneOf(root.use, ["preparation", "execution"] as const, `${path}.use`),
    bindingIds,
  });
}

function parseObservedImage(
  value: unknown,
  path: string,
): CapabilityRuntimeObservedImage {
  const root = exactRecord(value, ["reference", "sizeBytes"], path);
  return deepFreeze({
    reference: pinnedOciImageReference(root.reference, `${path}.reference`),
    sizeBytes: nullableBytes(root.sizeBytes, `${path}.sizeBytes`),
  });
}

function parsePlatform(value: unknown, path: string): CapabilityRuntimePlatform {
  return oneOf(value, ["linux/amd64", "linux/arm64"] as const, path);
}

function nullableBytes(value: unknown, path: string): number | null {
  return value === null ? null : positiveInteger(value, path);
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !SHA256_HEX.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function preferenceKey(preference: CapabilityRuntimeBindingPreference): string {
  return `${preference.capability.id}\u0000${preference.capability.version}\u0000${preference.use}`;
}

function absoluteContainerPath(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (
    !text.startsWith("/") || text.includes("..") || text.includes("\\") ||
    text.includes("\0")
  ) {
    throw new TypeError(`${path} must be one absolute container path.`);
  }
  return text;
}

function repositoryReference(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (
    text.includes("..") || text.includes("\\") || text.includes("\0") ||
    text.startsWith("/")
  ) {
    throw new TypeError(`${path} must be a repository-relative reference.`);
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
