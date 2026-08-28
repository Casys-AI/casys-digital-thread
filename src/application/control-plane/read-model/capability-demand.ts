import type {
  CapabilityPackMinimumQualification,
  CapabilityReference,
} from "./capability-pack.ts";

export const CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION =
  "capability-requirement-catalog-candidate/0.1" as const;

export const MODEL_AUTHOR_SYSTEM_CAPABILITY = Object.freeze(
  {
    id: "model.author-system",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MODEL_EVALUATE_REQUIREMENT_CAPABILITY = Object.freeze(
  {
    id: "model.evaluate-requirement",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY = Object.freeze(
  {
    id: "geometry.export-admitted-source",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY = Object.freeze(
  {
    id: "mechanics.solve-static-structural",
    version: "1",
  } as const satisfies CapabilityReference,
);

export interface CapabilityDemandOperationReference {
  readonly id: string;
  readonly version: string;
}

export interface RequiredEngineeringCapability extends CapabilityReference {
  readonly minimumQualification: CapabilityPackMinimumQualification;
  /** Whether the runtime prepares admitted input or executes the operation. */
  readonly use: "preparation" | "execution";
}

/**
 * Provider-free operational demand. This record cannot select a binding, tool,
 * profile, image, endpoint, runtime, or provider argument.
 */
export interface OperationCapabilityRequirement {
  readonly operation: CapabilityDemandOperationReference;
  readonly capabilities: readonly RequiredEngineeringCapability[];
}

export interface CapabilityRequirementCatalog {
  readonly schemaVersion: typeof CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION;
  readonly scope: "behave-foundation";
  readonly entries: readonly OperationCapabilityRequirement[];
}
