/**
 * Turns the code-owned catalogue baseline plus exact local attestations into
 * the runtime catalogue that planning, authorization and queueing may use.
 *
 * This is intentionally pure and read-only. A host platform observation can
 * establish native material availability, but cannot upgrade an `unqualified`
 * binding. Emulation is admitted only by a matching per-material attestation
 * bound to the current code-owned qualification specification and proven
 * against the exact reconstructed attested WAL for the current specification.
 */

import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  type CapabilityRuntimeBindingQualificationAttestation,
  type CapabilityRuntimeObservedHost,
  fingerprintCapabilityRuntimeObservedHost,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeMaterialRuntimeMode } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeQualificationCandidate } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";
import {
  capabilityRuntimeQualificationStoppedOutcomeReference,
  createChronoRuntimeQualificationAttestation,
  stoppedQualificationAttemptFrom,
} from "./capability-runtime-qualification-attestation-factory.ts";
import type {
  AtomicCapabilityRuntimeMaterial,
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
  QualifiedCapabilityRuntimeBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";

export interface CapabilityRuntimeQualificationEvaluationInput {
  readonly catalog: CapabilityRuntimeCatalog;
  readonly host: CapabilityRuntimeHostObservation;
  readonly attestations: readonly CapabilityRuntimeBindingQualificationAttestation[];
  readonly specs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly candidates: readonly CapabilityRuntimeQualificationCandidate[];
  /** Attestations reconstructed from exact phase-attested WAL attempts. */
  readonly provenAttestations:
    readonly CapabilityRuntimeBindingQualificationAttestation[];
}

/**
 * Existing code-owned qualified bindings remain eligible on their native
 * platform. Everything else is effective only when all of its exact materials
 * carry a current matching `qualified` attestation for the one exact spec.
 */
export function evaluateCapabilityRuntimeQualifications(
  input: CapabilityRuntimeQualificationEvaluationInput,
): CapabilityRuntimeCatalog {
  const units = new Map(input.catalog.units.map((unit) => [unit.id, unit]));
  const specIndex = indexCurrentSpecs(input.specs, input.candidates);
  const bindings = input.catalog.bindings.map((binding) =>
    effectiveBinding(
      binding,
      units,
      input.host,
      input.attestations,
      specIndex,
      input.provenAttestations,
    )
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
  specIndex: CurrentSpecIndex,
  provenAttestations: readonly CapabilityRuntimeBindingQualificationAttestation[],
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
    return {
      unit,
      material,
      event: effectiveMaterialAttestation(
        events,
        currentSpecFor(specIndex, binding, material),
        host,
        provenAttestations,
      ),
    };
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
 * Revocation is monotone on the exact binding/host identity, independent of
 * the current qualification specification. Qualified upgrade requires the
 * one current spec and a reconstructed attested WAL.
 */
function effectiveMaterialAttestation(
  events: readonly CapabilityRuntimeBindingQualificationAttestation[],
  current: CurrentSpecBinding | undefined,
  host: CapabilityRuntimeHostObservation,
  provenAttestations: readonly CapabilityRuntimeBindingQualificationAttestation[],
): CapabilityRuntimeBindingQualificationAttestation | undefined {
  if (!current) return undefined;
  const observedHost = {
    identityFingerprint: host.identityFingerprint,
    platform: host.platform,
  };
  const identityEvents = events.filter((event) =>
    matchesCapabilityRuntimeQualificationCandidate(
      event,
      current.candidate,
      observedHost,
    )
  );
  const revoked = identityEvents.find((event) => event.state === "revoked");
  if (revoked) return revoked;
  const qualified = identityEvents.filter((event) =>
    event.state === "qualified" &&
    matchesCapabilityRuntimeQualificationCandidate(
      event,
      current.candidate,
      observedHost,
      current.spec,
    ) &&
    provenAttestations.some((proven) =>
      sameFingerprint(proven.fingerprint, event.fingerprint)
    )
  );
  return qualified.length === 1 ? qualified[0] : undefined;
}

export async function loadProvenCapabilityRuntimeQualificationAttestations(input: {
  readonly attempts: Pick<CapabilityRuntimeQualificationAttemptStore, "read">;
  readonly attestations: readonly CapabilityRuntimeBindingQualificationAttestation[];
  readonly candidates: readonly CapabilityRuntimeQualificationCandidate[];
  readonly specs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly host: Pick<
    CapabilityRuntimeHostObservation,
    "platform" | "identityFingerprint"
  >;
}): Promise<readonly CapabilityRuntimeBindingQualificationAttestation[]> {
  const observedHostFingerprint = await fingerprintCapabilityRuntimeObservedHost(
    input.host.platform,
    input.host.identityFingerprint,
  );
  const proven: CapabilityRuntimeBindingQualificationAttestation[] = [];
  for (const spec of input.specs) {
    const candidate = input.candidates.find((item) =>
      item.id === spec.candidate.id &&
      fingerprintsEqual(item.fingerprint, spec.candidate.fingerprint)
    );
    if (!candidate) continue;
    const attempt = await input.attempts.read({
      candidateId: candidate.id,
      candidateFingerprint: candidate.fingerprint,
      observedHostFingerprint,
      qualificationSpecFingerprint: spec.fingerprint,
    });
    if (
      attempt?.phase !== "attested" ||
      attempt.outcome.status !== "qualified" ||
      attempt.outcome.basis !== "recorded" ||
      attempt.runtimeStopProof.schemaVersion !==
        CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA
    ) {
      continue;
    }
    const expected = await createChronoRuntimeQualificationAttestation({
      attempt: stoppedQualificationAttemptFrom(attempt),
      candidate,
      spec,
    });
    const stored = input.attestations.find((event) =>
      fingerprintsEqual(event.fingerprint, expected.fingerprint)
    );
    const outcome = await capabilityRuntimeQualificationStoppedOutcomeReference(
      attempt,
    );
    if (
      !stored ||
      !fingerprintsEqual(attempt.attestationFingerprint, expected.fingerprint) ||
      !fingerprintsEqual(stored.fingerprint, expected.fingerprint) ||
      !fingerprintsEqual(outcome.fingerprint, expected.outcome.fingerprint) ||
      outcome.id !== expected.outcome.id
    ) {
      continue;
    }
    proven.push(stored);
  }
  return proven;
}

type CurrentSpecBinding = {
  readonly spec: CapabilityRuntimeQualificationSpecification;
  readonly candidate: CapabilityRuntimeQualificationCandidate;
};

type CurrentSpecIndex = Map<string, CurrentSpecBinding[]>;

function indexCurrentSpecs(
  specs: readonly CapabilityRuntimeQualificationSpecification[],
  candidates: readonly CapabilityRuntimeQualificationCandidate[],
): CurrentSpecIndex {
  const byCandidate = new Map(
    candidates.map((candidate) => [
      `${candidate.id}\u0000${candidate.fingerprint.digest}`,
      candidate,
    ]),
  );
  const index: CurrentSpecIndex = new Map();
  for (const spec of specs) {
    const candidate = byCandidate.get(
      `${spec.candidate.id}\u0000${spec.candidate.fingerprint.digest}`,
    );
    if (!candidate) continue;
    const key = materialSpecKey(
      candidate.binding.id,
      candidate.material.imageDigest,
      candidate.material.materialId,
    );
    const bucket = index.get(key) ?? [];
    bucket.push({ spec, candidate });
    index.set(key, bucket);
  }
  return index;
}

function currentSpecFor(
  index: CurrentSpecIndex,
  binding: QualifiedCapabilityRuntimeBinding,
  material: AtomicCapabilityRuntimeMaterial,
): CurrentSpecBinding | undefined {
  const found = index.get(
    materialSpecKey(
      binding.id,
      digestFromReference(material.imageReference),
      material.id,
    ),
  );
  return found?.length === 1 ? found[0] : undefined;
}

function materialSpecKey(
  bindingId: string,
  imageDigest: string,
  materialId: string,
): string {
  return `${bindingId}\u0000${imageDigest}\u0000${materialId}`;
}

export function matchesCapabilityRuntimeQualificationCandidate(
  event: CapabilityRuntimeBindingQualificationAttestation,
  candidate: CapabilityRuntimeQualificationCandidate,
  observedHost: Pick<
    CapabilityRuntimeObservedHost,
    "identityFingerprint" | "platform"
  >,
  spec?: CapabilityRuntimeQualificationSpecification,
): boolean {
  const axes = event.binding.id === candidate.binding.id &&
    event.binding.version === candidate.binding.version &&
    event.selector.capability.id === candidate.selector.capability.id &&
    event.selector.capability.version === candidate.selector.capability.version &&
    event.selector.use === candidate.selector.use &&
    event.contract.id === candidate.contract.id &&
    event.contract.version === candidate.contract.version &&
    event.contract.source === candidate.contract.source &&
    sameProfile(event.profile, candidate.profile) &&
    event.unit.id === candidate.unit.id &&
    event.unit.version === candidate.unit.version &&
    sameFingerprint(
      event.unit.manifestFingerprint,
      candidate.unit.manifestFingerprint,
    ) &&
    event.material.unitId === candidate.material.unitId &&
    event.material.materialId === candidate.material.materialId &&
    event.material.imageDigest === candidate.material.imageDigest &&
    event.targetPlatform === candidate.targetPlatform &&
    event.mode === candidate.mode &&
    event.launchGroup !== null &&
    event.launchGroup.id === candidate.launchGroup.id &&
    event.launchGroup.version === candidate.launchGroup.version &&
    sameFingerprint(event.launchGroup.fingerprint, candidate.launchGroup.fingerprint) &&
    event.observedHost.platform === observedHost.platform &&
    sameFingerprint(
      event.observedHost.identityFingerprint,
      observedHost.identityFingerprint,
    ) &&
    event.fixture.id === candidate.fixture.id &&
    sameFingerprint(event.fixture.fingerprint, candidate.fixture.sourceFingerprint);
  if (!axes) return false;
  if (!spec) return true;
  return event.qualificationSpec.id === spec.id &&
    sameFingerprint(event.qualificationSpec.fingerprint, spec.fingerprint);
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
