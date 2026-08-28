import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/architecture/seed/syson-model-seed.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/architecture/renderer/architecture-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/cad/canonical/geometry-proposal.ts";
import {
  CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION,
  type CapabilityRequirementCatalog,
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
  type RequiredEngineeringCapability,
} from "../../application/control-plane/read-model/capability-demand.ts";
import { VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION } from "./fea-isolated-static-proof.ts";

const qualified = (
  capability: Omit<
    RequiredEngineeringCapability,
    "minimumQualification" | "use"
  >,
  use: RequiredEngineeringCapability["use"] = "execution",
): RequiredEngineeringCapability => ({
  ...capability,
  minimumQualification: "qualified",
  use,
});

/**
 * Candidate catalogue for the mandatory from-zero Behave walk only. It is not
 * dynamic registration and is not yet consumed by server composition.
 */
export const BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS = deepFreeze(
  {
    schemaVersion: CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION,
    scope: "behave-foundation",
    entries: [
      {
        operation: SYSON_MODEL_SEED_OPERATION,
        capabilities: [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)],
      },
      {
        operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
        capabilities: [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)],
      },
      {
        operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
        capabilities: [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)],
      },
      {
        operation: DESIGN_WRITE_GEOMETRY_OPERATION,
        capabilities: [
          qualified(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
        ],
      },
      {
        operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
        capabilities: [
          qualified(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
          qualified(MODEL_EVALUATE_REQUIREMENT_CAPABILITY),
        ],
      },
    ],
  } satisfies CapabilityRequirementCatalog,
);
