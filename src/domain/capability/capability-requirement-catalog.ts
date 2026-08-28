import type { RequiredEngineeringCapability } from "./engineering-capability.ts";

export interface CapabilityDemandOperationReference {
  readonly id: string;
  readonly version: string;
}

export interface OperationCapabilityRequirement {
  readonly operation: CapabilityDemandOperationReference;
  readonly capabilities: readonly RequiredEngineeringCapability[];
}

/** Minimal view of a catalogue selected by trusted server composition. */
export interface CapabilityRequirementCatalogView {
  readonly entries: readonly OperationCapabilityRequirement[];
}
