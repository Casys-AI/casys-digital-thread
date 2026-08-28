import type {
  CapabilityReference,
} from "../../../domain/capability/engineering-capability.ts";
import type { CapabilityRequirementCatalogView } from "../../../domain/capability/capability-requirement-catalog.ts";

export type {
  CapabilityDemandOperationReference,
  CapabilityRequirementCatalogView,
  OperationCapabilityRequirement,
} from "../../../domain/capability/capability-requirement-catalog.ts";
export type { RequiredEngineeringCapability } from "../../../domain/capability/engineering-capability.ts";

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

export interface CapabilityRequirementCatalog extends CapabilityRequirementCatalogView {
  readonly schemaVersion: typeof CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION;
  readonly scope: "behave-foundation";
}
