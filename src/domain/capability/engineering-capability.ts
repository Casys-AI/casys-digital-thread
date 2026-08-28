/** Stable semantic identity shared by demand, approval, and pack read models. */
export interface CapabilityReference {
  readonly id: string;
  readonly version: string;
}

export type CapabilityQualification = "compatible" | "qualified";
export type EngineeringCapabilityUse = "preparation" | "execution";

/** Minimum semantic capability required by one registered operation. */
export interface RequiredEngineeringCapability extends CapabilityReference {
  readonly minimumQualification: CapabilityQualification;
  /** Whether the runtime prepares admitted input or executes the operation. */
  readonly use: EngineeringCapabilityUse;
}

/** Capability explicitly allowed by a later host-operational envelope. */
export interface AllowedEngineeringCapability extends CapabilityReference {
  readonly qualification: CapabilityQualification;
  readonly use: EngineeringCapabilityUse;
}
