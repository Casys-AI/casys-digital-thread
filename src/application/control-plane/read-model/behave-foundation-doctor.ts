import type { BehaveFoundationCapabilityCensus } from "./behave-foundation-census.ts";
import type {
  CapabilityPackInstallationPlan,
  ObservedCapabilityImage,
  RuntimePlatform,
} from "./capability-pack.ts";

export const BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION =
  "behave-foundation-host-observation/0.1" as const;
export const BEHAVE_FOUNDATION_DOCTOR_SCHEMA_VERSION =
  "behave-foundation-doctor/0.1" as const;

export interface BehaveFoundationHostPrerequisiteObservation {
  readonly id: "docker-compose-local" | "microsandbox-local";
  readonly status: "available" | "unavailable";
  readonly version: string | null;
  readonly detail: string;
}

export interface BehaveFoundationHostObservation {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly platform: RuntimePlatform | null;
  readonly prerequisites: readonly BehaveFoundationHostPrerequisiteObservation[];
  readonly images: readonly ObservedCapabilityImage[];
  readonly blockers: readonly string[];
}

export interface BehaveFoundationDoctorReport {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_DOCTOR_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly status: "ready" | "changes-required" | "blocked";
  readonly census: BehaveFoundationCapabilityCensus;
  readonly host: BehaveFoundationHostObservation;
  readonly installationPlan: CapabilityPackInstallationPlan | null;
}
