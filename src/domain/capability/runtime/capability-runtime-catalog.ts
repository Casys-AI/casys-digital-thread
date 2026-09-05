import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeMaterialRuntimeMode,
  CapabilityRuntimePlatform,
} from "./capability-runtime-material.ts";
import type {
  CapabilityQualification,
  CapabilityReference,
  RequiredEngineeringCapability,
} from "../engineering-capability.ts";
import type { ProjectCapabilityDemand } from "../project-capability-demand.ts";
import type {
  CapabilityRuntimeLaunchGroupReference,
} from "./capability-runtime-launch-group.ts";

export const CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION =
  "capability-runtime-catalog/1.0" as const;
export const CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION =
  "capability-runtime-admin-policy/1.0" as const;
export const CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION =
  "capability-runtime-host-observation/1.0" as const;
export const CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION =
  "capability-runtime-admin-lock/1.0" as const;
export const PROJECT_CAPABILITY_PLAN_SCHEMA_VERSION =
  "project-capability-plan/1.0" as const;

export type CapabilityRuntimeMode = "native" | "emulated" | "unavailable";
export type CapabilityRuntimeMaterialKind =
  | "compose-service"
  | "microvm-image"
  | "oci-image";

/**
 * An atom is one image/service lifecycle or a technically indivisible local
 * cluster. It is host-operational metadata only: never provider arguments.
 */
export interface AtomicCapabilityRuntimeMaterial {
  readonly id: string;
  readonly kind: CapabilityRuntimeMaterialKind;
  readonly imageReference: string;
  /** Empty only when no reviewed platform claim exists. */
  readonly platforms: readonly CapabilityRuntimePlatform[];
  readonly lifecycle: "persistent" | "ephemeral" | "cache";
  /**
   * Host catalogue carries only this exact group reference. The immutable
   * topology remains in the server-side registry and is never project data.
   * `null` is literal until a separately reviewed group is enrolled.
   */
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference | null;
  readonly effects: CapabilityRuntimeHostEffects;
}

export interface CapabilityRuntimeHostEffects {
  readonly downloadBytes: number | null;
  readonly storageBytes: number | null;
  readonly services: readonly CapabilityRuntimeService[];
  readonly volumes: readonly CapabilityRuntimeVolume[];
  readonly network: "internal" | "loopback-only" | "deny-all";
  /** Published host ports only; internal container ports are not an authority. */
  readonly loopbackPorts: readonly number[];
  readonly bindMounts: readonly CapabilityRuntimeBindMount[];
  /** The reviewed Compose/microVM material never requests a privileged container. */
  readonly privileged: false;
  readonly dockerSocket: false;
  readonly devices: readonly string[];
  readonly secretSlots: readonly string[];
  readonly licence: CapabilityRuntimeLicence;
  /** Unknown safety prevents future activation; unknown size does not. */
  readonly security: "reviewed" | "unknown";
}

export interface CapabilityRuntimeService {
  readonly id: string;
  readonly lifecycle: "persistent" | "ephemeral" | "cache";
}

export interface CapabilityRuntimeVolume {
  readonly id: string;
  readonly access: "read-only" | "read-write";
  /** Runtime removal always preserves an authoritative/retained volume. */
  readonly preservation: "preserve" | "ephemeral";
}

export interface CapabilityRuntimeBindMount {
  readonly target: string;
  readonly access: "read-only" | "read-write";
}

export interface CapabilityRuntimeLicence {
  readonly status: "reviewed" | "unknown";
  readonly reference: string | null;
}

export interface AtomicCapabilityRuntimeUnit {
  readonly id: string;
  readonly version: string;
  readonly manifestFingerprint: ContentFingerprint;
  readonly materials: readonly AtomicCapabilityRuntimeMaterial[];
}

/** Closed body whose SHA-256 is the exact atomic-unit manifest identity. */
export function atomicCapabilityRuntimeUnitManifest(
  unit: Pick<AtomicCapabilityRuntimeUnit, "id" | "version" | "materials">,
): {
  readonly schemaVersion: "capability-runtime-unit/1.0";
  readonly id: string;
  readonly version: string;
  readonly materials: readonly AtomicCapabilityRuntimeMaterial[];
} {
  return {
    schemaVersion: "capability-runtime-unit/1.0",
    id: unit.id,
    version: unit.version,
    materials: unit.materials,
  };
}

/** Pure cryptographic calculation; it neither observes nor changes a runtime. */
export function fingerprintAtomicCapabilityRuntimeUnit(
  unit: Pick<AtomicCapabilityRuntimeUnit, "id" | "version" | "materials">,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(atomicCapabilityRuntimeUnitManifest(unit));
}

/** A concrete, qualified server-owned mapping. It is never agent input. */
export interface QualifiedCapabilityRuntimeBinding {
  readonly id: string;
  readonly version: string;
  readonly capability: CapabilityReference;
  readonly use: RequiredEngineeringCapability["use"];
  readonly qualification: CapabilityQualification | "unqualified" | "revoked";
  readonly adapter: CapabilityRuntimeAdapterReference;
  /** Null is literal when the selected adapter has no separately versioned profile. */
  readonly profile: CapabilityRuntimeProfileReference | null;
  readonly unitIds: readonly string[];
  readonly qualificationEvidence: CapabilityRuntimeQualificationEvidence;
  /**
   * Effective per-material runtime modes. The repository catalogue has an
   * empty baseline; a local attestation evaluator populates this only for the
   * exact host/binding/material identity it can prove.
   */
  readonly runtimeModes: readonly CapabilityRuntimeMaterialRuntimeMode[];
  readonly limitations: readonly string[];
}

export interface CapabilityRuntimeAdapterReference {
  readonly id: string;
  readonly version: string;
  readonly source: string;
}

export interface CapabilityRuntimeProfileReference {
  readonly id: string;
  readonly version: string;
  /** `null` is literal when a source exposes no stable profile fingerprint. */
  readonly fingerprint: ContentFingerprint | null;
}

export interface CapabilityRuntimeQualificationEvidence {
  readonly id: string;
  readonly source: string;
  readonly fingerprint: ContentFingerprint | null;
}

/** Trusted, code-owned input. Publisher claims never become bindings directly. */
export interface CapabilityRuntimeCatalog {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION;
  /** Local developer catalogue only; it carries no production redistribution claim. */
  readonly productionEligible: false;
  readonly units: readonly AtomicCapabilityRuntimeUnit[];
  readonly bindings: readonly QualifiedCapabilityRuntimeBinding[];
}

/** Local administration can disable or rank reviewed bindings, never invent one. */
export interface CapabilityRuntimeAdminPolicy {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION;
  readonly disabledBindingIds: readonly string[];
  readonly preferences: readonly CapabilityRuntimeBindingPreference[];
}

export interface CapabilityRuntimeBindingPreference {
  readonly capability: CapabilityReference;
  readonly use: RequiredEngineeringCapability["use"];
  /** Ordered only among trusted catalogue entries for this semantic need. */
  readonly bindingIds: readonly string[];
}

/** A fresh local observation; it does not assert health or engineering success. */
export interface CapabilityRuntimeHostObservation {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION;
  /** Opaque, stable local-host identity; never a credential or provider value. */
  readonly identityFingerprint: ContentFingerprint;
  readonly platform: CapabilityRuntimePlatform;
  readonly images: readonly CapabilityRuntimeObservedImage[];
}

export interface CapabilityRuntimeObservedImage {
  readonly reference: string;
  readonly sizeBytes: number | null;
}

/** Human-owned desired state. This does not live in an engineering Thread. */
export interface CapabilityRuntimeAdminLock {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION;
  readonly revision: number;
  readonly previous: ContentFingerprint | null;
  readonly units: readonly CapabilityRuntimeLockedUnit[];
}

export interface CapabilityRuntimeLockedUnit {
  readonly id: string;
  readonly version: string;
  readonly manifestFingerprint: ContentFingerprint;
  readonly desired: "inactive" | "active";
}

export type PlannedCapabilityBindingStatus =
  | "selected"
  | "unavailable"
  | "ambiguous"
  | "disabled"
  | "revoked"
  | "incompatible";

export interface PlannedProjectCapabilityBinding {
  readonly requirement: RequiredEngineeringCapability;
  readonly status: PlannedCapabilityBindingStatus;
  readonly binding: {
    readonly id: string;
    readonly version: string;
    readonly qualification: CapabilityQualification;
  } | null;
  readonly unitIds: readonly string[];
  readonly reasons: readonly string[];
  /**
   * A policy-selected concrete candidate retained for an operational review
   * even when it cannot be activated yet (for example it is unqualified or
   * only available on an unobserved platform). This is deliberately separate
   * from `binding`: `binding` remains non-null only when the normal runtime
   * plan may select it for activation.
   */
  readonly candidate?: CapabilityRuntimeBindingCandidate;
}

/** Exact server-selected binding identity shown in a capability review. */
export interface CapabilityRuntimeBindingCandidate {
  readonly id: string;
  readonly version: string;
  readonly qualification: QualifiedCapabilityRuntimeBinding["qualification"];
  readonly adapter: CapabilityRuntimeAdapterReference;
  readonly profile: CapabilityRuntimeProfileReference | null;
  readonly unitIds: readonly string[];
}

export interface PlannedCapabilityRuntimeMaterial {
  readonly unitId: string;
  readonly materialId: string;
  readonly imageReference: string;
  readonly mode: CapabilityRuntimeMode;
  readonly imageState: "present" | "absent";
  readonly desired: "active" | "inactive" | "absent";
  readonly downloadBytes: number | null;
  readonly storageBytes: number | null;
}

export interface ProjectCapabilityPlanEffects {
  readonly downloadBytes: number | null;
  readonly storageBytes: number | null;
  readonly services: readonly CapabilityRuntimeService[];
  readonly volumes: readonly CapabilityRuntimeVolume[];
  readonly networks: readonly CapabilityRuntimeHostEffects["network"][];
  readonly loopbackPorts: readonly number[];
  readonly bindMounts: readonly CapabilityRuntimeBindMount[];
  readonly privileged: false;
  readonly dockerSocket: false;
  readonly devices: readonly string[];
  readonly secretSlots: readonly string[];
  readonly licences: readonly CapabilityRuntimeLicence[];
  readonly security: "reviewed" | "unknown";
}

/**
 * Concrete operational plan derived by the server. It does not grant MRTR,
 * dispatch, install, activate, or infer a domain result.
 */
export interface ProjectCapabilityPlan {
  readonly schemaVersion: typeof PROJECT_CAPABILITY_PLAN_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly demandFingerprint: ContentFingerprint;
  readonly registryFingerprint: ContentFingerprint;
  readonly bindings: readonly PlannedProjectCapabilityBinding[];
  readonly materials: readonly PlannedCapabilityRuntimeMaterial[];
  readonly effects: ProjectCapabilityPlanEffects;
  readonly status: "ready" | "changes-required" | "blocked" | "unresolved";
  readonly activation: "allowed" | "blocked";
  readonly blockers: readonly string[];
}

export interface ProjectCapabilityPlanningInput {
  readonly demand: ProjectCapabilityDemand;
  readonly catalog: CapabilityRuntimeCatalog;
  readonly policy: CapabilityRuntimeAdminPolicy;
  readonly host: CapabilityRuntimeHostObservation;
  readonly lock: CapabilityRuntimeAdminLock;
}

/**
 * Shared, pure planning input for an already server-derived semantic ceiling.
 * It intentionally has no project, brief, provider endpoint, tool, or caller
 * supplied runtime fields. The two callers are the published-plan demand and
 * the pending-brief capability intent.
 */
export interface CapabilityRuntimeRequirementsPlanningInput {
  readonly requirements: readonly RequiredEngineeringCapability[];
  readonly unresolvedBlockers: readonly string[];
  readonly catalog: CapabilityRuntimeCatalog;
  readonly policy: CapabilityRuntimeAdminPolicy;
  readonly host: CapabilityRuntimeHostObservation;
  readonly lock: CapabilityRuntimeAdminLock;
  /** Keep the one policy-selected candidate visible despite activation blockers. */
  readonly preserveBlockedCandidates?: boolean;
}

/** Pure planner output without an engineering-project demand identity. */
export interface CapabilityRuntimeRequirementsPlan {
  readonly bindings: readonly PlannedProjectCapabilityBinding[];
  readonly materials: readonly PlannedCapabilityRuntimeMaterial[];
  readonly effects: ProjectCapabilityPlanEffects;
  readonly status: "ready" | "changes-required" | "blocked" | "unresolved";
  readonly activation: "allowed" | "blocked";
  readonly blockers: readonly string[];
}
