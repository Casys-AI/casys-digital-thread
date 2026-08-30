/** Stable semantic identity shared by demand, approval, and pack read models. */
export interface CapabilityReference {
  readonly id: string;
  readonly version: string;
}

/**
 * Versioned provider-neutral capability identities.  Operations may demand
 * these semantic capabilities, but neither this vocabulary nor a demand
 * selects a provider, package, image, endpoint, tool, argument, or secret.
 */
export const MODEL_AUTHOR_SYSTEM_CAPABILITY = Object.freeze(
  { id: "model.author-system", version: "1" } as const satisfies CapabilityReference,
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

/** Factual finite-difference observations; it carries no engineering verdict. */
export const MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY = Object.freeze(
  {
    id: "mechanics.observe-static-structural-sensitivity",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY = Object.freeze(
  {
    id: "mechanics.observe-prescribed-kinematics",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MODEL_INSPECT_SYSTEM_CAPABILITY = Object.freeze(
  { id: "model.inspect-system", version: "1" } as const satisfies CapabilityReference,
);

export const GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY = Object.freeze(
  {
    id: "geometry.execute-admitted-source",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY = Object.freeze(
  {
    id: "geometry.observe-assembly-integrity",
    version: "1",
  } as const satisfies CapabilityReference,
);

/**
 * Server-owned assembly of exact immediate child geometry into a compound
 * module. This semantic capability does not select a provider or runtime.
 */
export const GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY = Object.freeze(
  {
    id: "geometry.module.immediate-compound",
    version: "1.0",
  } as const satisfies CapabilityReference,
);

export const SIMULATION_RUN_QUALIFIED_MODELICA_CAPABILITY = Object.freeze(
  {
    id: "simulation.run-qualified-modelica",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY = Object.freeze(
  {
    id: "simulation.run-admitted-modelica",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY = Object.freeze(
  {
    id: "electronics.run-admitted-spice",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MANUFACTURING_OBSERVE_PRINTABILITY_CAPABILITY = Object.freeze(
  {
    id: "manufacturing.observe-printability",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MANUFACTURING_ESTIMATE_FFF_CAPABILITY = Object.freeze(
  {
    id: "manufacturing.estimate-fff",
    version: "1",
  } as const satisfies CapabilityReference,
);

export const MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY = Object.freeze(
  {
    id: "manufacturing.run-dfm-checks",
    version: "1",
  } as const satisfies CapabilityReference,
);

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

/** Exact semantic identity of one requirement, excluding qualification. */
export function engineeringCapabilityRequirementKey(
  capability: Pick<RequiredEngineeringCapability, "id" | "version" | "use">,
): string {
  return `${capability.id}\u0000${capability.version}\u0000${capability.use}`;
}

/** Provider-neutral, code-unit ordering used by every requirement projection. */
export function compareEngineeringCapabilities(
  left: RequiredEngineeringCapability,
  right: RequiredEngineeringCapability,
): number {
  return compareCodeUnitText(
    engineeringCapabilityRequirementKey(left),
    engineeringCapabilityRequirementKey(right),
  ) || compareCodeUnitText(left.minimumQualification, right.minimumQualification);
}

/**
 * Canonically flatten capability requirements. Qualification is the only
 * strength order: qualified covers compatible for the same semantic identity.
 * Callers remain responsible for validating their source contracts first.
 */
export function flattenEngineeringCapabilityRequirements(
  capabilities: readonly RequiredEngineeringCapability[],
): readonly RequiredEngineeringCapability[] {
  const flattened = new Map<string, RequiredEngineeringCapability>();
  for (const capability of capabilities) {
    const key = engineeringCapabilityRequirementKey(capability);
    const previous = flattened.get(key);
    if (
      !previous ||
      qualificationRank(capability.minimumQualification) >
        qualificationRank(previous.minimumQualification)
    ) {
      flattened.set(key, { ...capability });
    }
  }
  return [...flattened.values()].toSorted(compareEngineeringCapabilities);
}

function qualificationRank(value: CapabilityQualification): number {
  return value === "qualified" ? 1 : 0;
}

function compareCodeUnitText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
