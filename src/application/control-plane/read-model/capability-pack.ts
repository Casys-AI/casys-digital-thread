import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { MicrosandboxLocalRuntimeRef } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import type {
  CapabilityQualification,
  CapabilityReference,
} from "../../../domain/capability/engineering-capability.ts";

export type { CapabilityReference } from "../../../domain/capability/engineering-capability.ts";

export const CAPABILITY_PACK_SCHEMA_VERSION = "capability-pack-candidate/0.1" as const;
export const CAPABILITY_INSTALLATION_LOCK_SCHEMA_VERSION =
  "capability-installation-lock-candidate/0.1" as const;
export const CAPABILITY_PACK_INSTALLATION_PLAN_SCHEMA_VERSION =
  "capability-pack-installation-plan-candidate/0.1" as const;

export type RuntimePlatform = "linux/amd64" | "linux/arm64";

/** Publisher claim only. Trusted catalogue qualification remains separate. */
export interface CapabilityBindingClaim {
  readonly id: string;
  readonly version: string;
  readonly capability: CapabilityReference;
  readonly materialIds: readonly string[];
}

interface RuntimeMaterialBase {
  readonly id: string;
  readonly image: string;
  readonly platforms: readonly RuntimePlatform[];
  readonly dependsOn: readonly string[];
  /** Publisher estimate only. A live runtime observation outranks it. */
  readonly estimatedBytes?: number;
}

export interface ComposeServiceMaterial extends RuntimeMaterialBase {
  readonly kind: "compose-service";
  readonly serviceName: string;
  readonly exposure: "internal" | "loopback-only";
}

export interface MicrovmImageMaterial extends RuntimeMaterialBase {
  readonly kind: "microvm-image";
  readonly runner: MicrosandboxLocalRuntimeRef;
  readonly policyFingerprint: ContentFingerprint;
  readonly network: "deny-all";
}

export type CapabilityRuntimeMaterial =
  | ComposeServiceMaterial
  | MicrovmImageMaterial;

export interface CapabilityPackManifest {
  readonly schemaVersion: typeof CAPABILITY_PACK_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly bindingClaims: readonly CapabilityBindingClaim[];
  readonly materials: readonly CapabilityRuntimeMaterial[];
}

export type CapabilityPackActivation = "inactive" | "active";
export type CapabilityPackTrustPolicy =
  | "first-party-only"
  | "reviewed-community";
export type CapabilityPackMinimumQualification = CapabilityQualification;

export interface CapabilityPackInstallationPolicy {
  readonly trust: CapabilityPackTrustPolicy;
  readonly minimumQualification: CapabilityPackMinimumQualification;
  /** The lock constrains candidates; the server still selects the exact binding. */
  readonly bindingMode: "server-policy";
}

export interface CapabilityPackLoopbackRoute {
  readonly materialId: string;
  readonly port: number;
}

export interface InstalledCapabilityPack {
  readonly id: string;
  readonly version: string;
  readonly manifest: ContentFingerprint;
  readonly activation: CapabilityPackActivation;
  readonly policy: CapabilityPackInstallationPolicy;
  readonly secretSlots: readonly string[];
  readonly routes: readonly CapabilityPackLoopbackRoute[];
}

/** Host-operational desired state. Never an Engineering Thread document. */
export interface CapabilityInstallationLock {
  readonly schemaVersion: typeof CAPABILITY_INSTALLATION_LOCK_SCHEMA_VERSION;
  readonly revision: number;
  readonly previous: ContentFingerprint | null;
  readonly packs: readonly InstalledCapabilityPack[];
}

export interface ObservedCapabilityImage {
  readonly reference: string;
  readonly sizeBytes?: number;
}

export interface CapabilityPackPlanningHost {
  readonly platform: RuntimePlatform;
  readonly images: readonly ObservedCapabilityImage[];
}

export interface PlannedCapabilityMaterial {
  readonly id: string;
  readonly kind: CapabilityRuntimeMaterial["kind"];
  readonly image: string;
  readonly dependsOn: readonly string[];
  readonly platformSupported: boolean;
}

export interface PlannedCapabilityImage {
  readonly reference: string;
  readonly materialIds: readonly string[];
  /** Backend-neutral: Compose may pull; a microVM backend may import a cache. */
  readonly action: "reuse" | "acquire";
  readonly estimatedAdditionalBytes: number | null;
}

export interface CapabilityPackInstallationPlan {
  readonly schemaVersion: typeof CAPABILITY_PACK_INSTALLATION_PLAN_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly pack: {
    readonly id: string;
    readonly version: string;
  };
  readonly platform: RuntimePlatform;
  readonly status: "ready" | "changes-required" | "blocked";
  readonly bindingClaims: readonly CapabilityBindingClaim[];
  readonly materials: readonly PlannedCapabilityMaterial[];
  readonly images: readonly PlannedCapabilityImage[];
  readonly estimatedAdditionalBytes: number | null;
  readonly unknownSizeImageReferences: readonly string[];
  readonly blockers: readonly string[];
}
