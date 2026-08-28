import type { BehaveFoundationCapabilityCensus } from "./behave-foundation-census.ts";
import type { BehaveFoundationEvidenceLevel } from "./behave-foundation-census.ts";
import type {
  CapabilityPackInstallationPlan,
  ObservedCapabilityImage,
  RuntimePlatform,
} from "./capability-pack.ts";

export const BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION =
  "behave-foundation-host-observation/0.2" as const;
export const BEHAVE_FOUNDATION_DOCTOR_SCHEMA_VERSION =
  "behave-foundation-doctor/0.2" as const;

export interface BehaveFoundationHostPrerequisiteObservation {
  readonly id: "docker-compose-local" | "microsandbox-local";
  readonly status: "available" | "unavailable";
  readonly version: string | null;
  readonly detail: string;
}

export interface BehaveFoundationCachedMaterialObservation {
  readonly materialId: string;
  readonly expectedReference: string;
  readonly status: "cached-exact" | "unavailable" | "mismatch";
  readonly observedReference: string | null;
  readonly detail: string;
}

export interface BehaveFoundationHostObservation {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly platform: RuntimePlatform | null;
  readonly prerequisites: readonly BehaveFoundationHostPrerequisiteObservation[];
  readonly images: readonly ObservedCapabilityImage[];
  /** Exact local identity only; a present but different image is excluded. */
  readonly cachedExactMaterialIds: readonly string[];
  readonly materialObservations: readonly BehaveFoundationCachedMaterialObservation[];
  readonly blockers: readonly string[];
}

export interface BehaveFoundationDoctorReport {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_DOCTOR_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly status: "ready" | "changes-required" | "blocked";
  /** `ready` at this level means cached material, never a live provider proof. */
  readonly evidenceLevel: BehaveFoundationEvidenceLevel;
  readonly verticalQualification: "not-observed";
  readonly census: BehaveFoundationCapabilityCensus;
  readonly host: BehaveFoundationHostObservation;
  readonly installationPlan: CapabilityPackInstallationPlan | null;
}
