/**
 * Turns the code-owned catalogue baseline plus exact local attestations into
 * the runtime catalogue that planning, authorization and queueing may use.
 *
 * This is intentionally pure and read-only. A host platform observation can
 * establish native material availability, but cannot upgrade an `unqualified`
 * binding. Emulation is admitted only by a matching per-material attestation.
 */

import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import type {
  CapabilityRuntimeBindingQualificationAttestation,
  CapabilityRuntimeMaterialRuntimeMode,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type {
  AtomicCapabilityRuntimeMaterial,
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
  QualifiedCapabilityRuntimeBinding,
} from "./read-model/capability-runtime-catalog.ts";

export interface CapabilityRuntimeQualificationEvaluationInput {
  readonly catalog: CapabilityRuntimeCatalog;
  readonly host: CapabilityRuntimeHostObservation;
  readonly attestations: readonly CapabilityRuntimeBindingQualificationAttestation[];
}

/**
 * Existing code-owned qualified bindings remain eligible on their native
 * platform. Everything else is effective only when all of its exact materials
 * carry a current matching `qualified` attestation.
 */
export function evaluateCapabilityRuntimeQualifications(
  input: CapabilityRuntimeQualificationEvaluationInput,
): CapabilityRuntimeCatalog {
  const units = new Map(input.catalog.units.map((unit) => [unit.id, unit]));
  const bindings = input.catalog.bindings.map((binding) =>
    effectiveBinding(binding, units, input.host, input.attestations)
  );
  return deepFreeze({
    schemaVersion: input.catalog.schemaVersion,
    productionEligible: false,
    units: structuredClone(input.catalog.units),
    bindings,
  });
}

function effectiveBinding(
  binding: QualifiedCapabilityRuntimeBinding,
  units: ReadonlyMap<string, AtomicCapabilityRuntimeUnit>,
  host: CapabilityRuntimeHostObservation,
  attestations: readonly CapabilityRuntimeBindingQualificationAttestation[],
): QualifiedCapabilityRuntimeBinding {
  const materials = binding.unitIds.flatMap((unitId) => {
    const unit = units.get(unitId);
    if (!unit) {
      throw new TypeError(
        `Capability runtime binding ${binding.id} references unknown unit ${unitId}.`,
      );
    }
    return unit.materials.map((material) => ({ unit, material }));
  });
  const current = materials.map(({ unit, material }) => {
    const events = attestations.filter((event) =>
      matchesExactCurrentBinding(event, binding, unit, material, host)
    );
    return { unit, material, event: effectiveMaterialAttestation(events) };
  });
  const revoked = current.some(({ event }) => event?.state === "revoked");
  const allAttested = current.length > 0 &&
    current.every(({ event }) => event?.state === "qualified");
  const qualification = binding.qualification === "revoked" || revoked
    ? "revoked" as const
    : binding.qualification === "unqualified"
    ? allAttested ? "qualified" as const : "unqualified" as const
    : binding.qualification;
  const runtimeModes = qualification === "revoked" ||
      (binding.qualification === "unqualified" && !allAttested)
    ? []
    : current.flatMap(({ unit, material, event }) => {
      if (event?.state === "qualified") {
        return [runtimeModeFromAttestation(event)];
      }
      // Code-owned qualification stays useful for an observed native platform,
      // but never lends an emulation claim to a different material or binding.
      return material.platforms.includes(host.platform)
        ? [nativeCodeOwnedMode(unitMaterialIdentity(unit, material), host.platform)]
        : [];
    }).toSorted(compareRuntimeMode);

  return deepFreeze({
    ...structuredClone(binding),
    qualification,
    runtimeModes,
  });
}

/**
 * Revocation is deliberately monotone: any exact revocation remains a block.
 * We never use wall-clock or hash ordering to resurrect a revoked material.
 * Multiple live qualification records would be an unreviewed selector choice,
 * so they are literal unavailable rather than arbitrarily preferred.
 */
function effectiveMaterialAttestation(
  events: readonly CapabilityRuntimeBindingQualificationAttestation[],
): CapabilityRuntimeBindingQualificationAttestation | undefined {
  const revoked = events.find((event) => event.state === "revoked");
  if (revoked) return revoked;
  const qualified = events.filter((event) => event.state === "qualified");
  return qualified.length === 1 ? qualified[0] : undefined;
}

function matchesExactCurrentBinding(
  event: CapabilityRuntimeBindingQualificationAttestation,
  binding: QualifiedCapabilityRuntimeBinding,
  unit: AtomicCapabilityRuntimeUnit,
  material: AtomicCapabilityRuntimeMaterial,
  host: CapabilityRuntimeHostObservation,
): boolean {
  if (
    event.binding.id !== binding.id || event.binding.version !== binding.version ||
    event.selector.capability.id !== binding.capability.id ||
    event.selector.capability.version !== binding.capability.version ||
    event.selector.use !== binding.use ||
    event.contract.id !== binding.adapter.id ||
    event.contract.version !== binding.adapter.version ||
    event.contract.source !== binding.adapter.source ||
    !sameProfile(event.profile, binding.profile) ||
    event.unit.id !== unit.id || event.unit.version !== unit.version ||
    !sameFingerprint(event.unit.manifestFingerprint, unit.manifestFingerprint) ||
    event.material.unitId !== unit.id || event.material.materialId !== material.id ||
    event.material.imageDigest !== digestFromReference(material.imageReference) ||
    !material.platforms.includes(event.targetPlatform) ||
    event.observedHost.platform !== host.platform ||
    !sameFingerprint(
      event.observedHost.identityFingerprint,
      host.identityFingerprint,
    ) ||
    !sameLaunchGroup(event.launchGroup, material.launchGroup)
  ) {
    return false;
  }
  return true;
}

function runtimeModeFromAttestation(
  event: CapabilityRuntimeBindingQualificationAttestation,
): CapabilityRuntimeMaterialRuntimeMode {
  return {
    material: structuredClone(event.material),
    targetPlatform: event.targetPlatform,
    mode: event.mode,
    qualificationAttestationFingerprint: structuredClone(event.fingerprint),
  };
}

function nativeCodeOwnedMode(
  material: CapabilityRuntimeMaterialRuntimeMode["material"],
  platform: CapabilityRuntimeMaterialRuntimeMode["targetPlatform"],
): CapabilityRuntimeMaterialRuntimeMode {
  return {
    material,
    targetPlatform: platform,
    mode: "native",
    qualificationAttestationFingerprint: null,
  };
}

function unitMaterialIdentity(
  unit: AtomicCapabilityRuntimeUnit,
  material: AtomicCapabilityRuntimeMaterial,
): CapabilityRuntimeMaterialRuntimeMode["material"] {
  return {
    unitId: unit.id,
    materialId: material.id,
    imageDigest: digestFromReference(material.imageReference),
  };
}

function sameProfile(
  left: CapabilityRuntimeBindingQualificationAttestation["profile"],
  right: QualifiedCapabilityRuntimeBinding["profile"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    ((left.fingerprint === null && right.fingerprint === null) ||
      (left.fingerprint !== null && right.fingerprint !== null &&
        sameFingerprint(left.fingerprint, right.fingerprint)));
}

function sameLaunchGroup(
  left: CapabilityRuntimeBindingQualificationAttestation["launchGroup"],
  right: AtomicCapabilityRuntimeMaterial["launchGroup"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    sameFingerprint(left.fingerprint, right.fingerprint);
}

function sameFingerprint(
  left: { readonly algorithm: string; readonly digest: string },
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function digestFromReference(reference: string): string {
  const marker = "@sha256:";
  const position = reference.lastIndexOf(marker);
  const digest = position < 0 ? "" : reference.slice(position + marker.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError("Capability runtime material lacks one exact SHA-256 digest.");
  }
  return digest;
}

function compareRuntimeMode(
  left: CapabilityRuntimeMaterialRuntimeMode,
  right: CapabilityRuntimeMaterialRuntimeMode,
): number {
  const leftKey =
    `${left.material.unitId}\u0000${left.material.materialId}\u0000${left.material.imageDigest}`;
  const rightKey =
    `${right.material.unitId}\u0000${right.material.materialId}\u0000${right.material.imageDigest}`;
  return leftKey.localeCompare(rightKey);
}
