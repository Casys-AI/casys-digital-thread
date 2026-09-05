import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  type AtomicCapabilityRuntimeUnit,
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  type CapabilityRuntimeAdminLock,
  type CapabilityRuntimeCatalog,
  type CapabilityRuntimeLockedUnit,
  fingerprintAtomicCapabilityRuntimeUnit,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Strict human-owned lock parser. No filesystem write is performed here. */
export async function validateCapabilityRuntimeAdminLock(
  value: unknown,
  catalog?: CapabilityRuntimeCatalog,
): Promise<CapabilityRuntimeAdminLock> {
  const root = exactRecord(
    value,
    ["schemaVersion", "revision", "previous", "units"],
    "$adminLock",
  );
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
    "$adminLock.schemaVersion",
  );
  const units = arrayOf(root.units, "$adminLock.units").map((unit, index) =>
    parseLockedUnit(unit, `$adminLock.units[${index}]`)
  );
  rejectDuplicates(units.map((unit) => unit.id), "$adminLock.units[].id");
  if (catalog) {
    await Promise.all(
      catalog.units.map((unit, index) =>
        assertAtomicUnitManifestFingerprint(unit, `$catalog.units[${index}]`)
      ),
    );
    for (const locked of units) {
      const unit = catalog.units.find((candidate) => candidate.id === locked.id);
      if (!unit) {
        throw new TypeError(`$adminLock references unknown unit ${locked.id}.`);
      }
      if (
        unit.version !== locked.version ||
        !fingerprintsEqual(unit.manifestFingerprint, locked.manifestFingerprint)
      ) {
        throw new TypeError(
          `$adminLock unit ${locked.id} does not match the exact catalogue unit.`,
        );
      }
    }
  }
  const revision = nonNegativeInteger(root.revision, "$adminLock.revision");
  const previous = root.previous === null
    ? null
    : fingerprint(root.previous, "$adminLock.previous");
  if (revision === 0 && previous !== null) {
    throw new TypeError(
      "$adminLock revision 0 must not name a previous administrative lock.",
    );
  }
  if (revision > 0 && previous === null) {
    throw new TypeError(
      "$adminLock revision greater than 0 must name the exact previous administrative lock.",
    );
  }
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
    revision,
    previous,
    units,
  });
}

function parseLockedUnit(value: unknown, path: string): CapabilityRuntimeLockedUnit {
  const root = exactRecord(
    value,
    ["id", "version", "manifestFingerprint", "desired"],
    path,
  );
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    manifestFingerprint: fingerprint(
      root.manifestFingerprint,
      `${path}.manifestFingerprint`,
    ),
    desired: oneOf(root.desired, ["inactive", "active"] as const, `${path}.desired`),
  });
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return Number(value);
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !SHA256_HEX.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

async function assertAtomicUnitManifestFingerprint(
  unit: AtomicCapabilityRuntimeUnit,
  path: string,
): Promise<void> {
  const expected = await fingerprintAtomicCapabilityRuntimeUnit(unit);
  if (!fingerprintsEqual(unit.manifestFingerprint, expected)) {
    throw new TypeError(
      `${path}.manifestFingerprint does not match the canonical unit body.`,
    );
  }
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
