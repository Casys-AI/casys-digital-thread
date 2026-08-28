import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { MicrosandboxLocalRuntimeRef } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import type { CapabilityRequirementCatalog } from "./capability-demand.ts";
import type { CapabilityPackManifest, RuntimePlatform } from "./capability-pack.ts";

export const BEHAVE_FOUNDATION_CENSUS_SCHEMA_VERSION =
  "behave-foundation-capability-census-candidate/0.1" as const;

export type BehaveFoundationCensusBlockerCode =
  | "runtime.image-not-digest-pinned"
  | "runtime.platforms-unverified"
  | "runtime.local-build-present"
  | "runtime.public-exposure"
  | "runtime.fleet-compose-image-drift"
  | "review.licences-missing"
  | "review.volumes-missing"
  | "review.security-missing";

export interface BehaveFoundationCensusBlocker {
  readonly code: BehaveFoundationCensusBlockerCode;
  readonly subject: string;
  readonly detail: string;
}

interface BehaveFoundationCensusMaterialBase {
  readonly id: string;
  readonly image: string;
  readonly imagePinned: boolean;
  readonly platforms: readonly RuntimePlatform[];
  readonly dependsOn: readonly string[];
  readonly source: string;
}

export interface BehaveFoundationComposeMaterial
  extends BehaveFoundationCensusMaterialBase {
  readonly kind: "compose-service";
  readonly serviceName: string;
  readonly exposure: "internal" | "loopback-only" | "public";
}

export interface BehaveFoundationMicrovmMaterial
  extends BehaveFoundationCensusMaterialBase {
  readonly kind: "microvm-image";
  readonly runner: MicrosandboxLocalRuntimeRef;
  readonly policyFingerprint: ContentFingerprint;
  readonly network: "deny-all";
}

export type BehaveFoundationCensusMaterial =
  | BehaveFoundationComposeMaterial
  | BehaveFoundationMicrovmMaterial;

export interface BehaveFoundationCensusReviewEvidence {
  readonly licences: ContentFingerprint | null;
  readonly volumes: ContentFingerprint | null;
  readonly security: ContentFingerprint | null;
}

export interface BehaveFoundationHostPrerequisite {
  readonly id: "docker-compose-local" | "microsandbox-local";
  readonly version: string | null;
  readonly requiredByMaterialIds: readonly string[];
  readonly installableByPack: false;
}

export interface BehaveFoundationExcludedRuntime {
  readonly id: string;
  readonly reason: string;
}

/** Repository census only. It never observes, installs, pulls or starts a runtime. */
export interface BehaveFoundationCapabilityCensus {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_CENSUS_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly pack: {
    readonly id: "casys.behave-foundation";
    readonly version: "0.1.0";
  };
  readonly status: "blocked" | "candidate-ready";
  readonly productionEligible: false;
  readonly capabilityRequirements: CapabilityRequirementCatalog;
  readonly materials: readonly BehaveFoundationCensusMaterial[];
  readonly hostPrerequisites: readonly BehaveFoundationHostPrerequisite[];
  readonly excludedRuntimes: readonly BehaveFoundationExcludedRuntime[];
  readonly reviewEvidence: BehaveFoundationCensusReviewEvidence;
  readonly blockers: readonly BehaveFoundationCensusBlocker[];
  readonly candidateManifest: CapabilityPackManifest | null;
}
