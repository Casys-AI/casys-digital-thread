import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
} from "../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";
import type { ProjectBriefVerificationAuthority } from "../../domain/project/project-brief.ts";
import type { EngineeringOperationRef } from "../../domain/project/engineering-project.ts";

/**
 * Server-owned route from a semantic Brief verification authority to exact
 * registered operations. It names neither a provider nor a runtime.
 */
export interface BriefCapabilityIntentRoute {
  readonly authority: ProjectBriefVerificationAuthority;
  readonly operations: readonly Pick<EngineeringOperationRef, "id" | "version">[];
}

/** Read-only server-composition seam; never request or agent-provided data. */
export interface BriefCapabilityIntentRouteTable {
  list(): readonly BriefCapabilityIntentRoute[];
}

/** Semantic authority for the admitted canonical-geometry static FEA vertical. */
export const STATIC_STRUCTURAL_FEA_VERIFICATION_AUTHORITY = deepFreeze(
  {
    id: "static-structural-fea",
    version: "1.0",
  } satisfies ProjectBriefVerificationAuthority,
);

/**
 * Semantic authority for factual finite-difference static-structural
 * sensitivity observations. It is intentionally separate from a static proof:
 * a brief must opt in explicitly before the operational ceiling can include
 * the recorded CalculiX sensitivity binding.
 */
export const STATIC_STRUCTURAL_FEA_SENSITIVITY_VERIFICATION_AUTHORITY = deepFreeze(
  {
    id: "static-structural-fea-sensitivity",
    version: "1.0",
  } satisfies ProjectBriefVerificationAuthority,
);

/** Semantic authority for admitted Modelica thermal evidence and L4 evaluation. */
export const ADMITTED_MODELICA_THERMAL_VERIFICATION_AUTHORITY = deepFreeze(
  {
    id: "admitted-modelica-thermal",
    version: "1.0",
  } satisfies ProjectBriefVerificationAuthority,
);

/** Semantic authority for admitted circuit-only SPICE electrical evidence. */
export const ADMITTED_SPICE_ELECTRICAL_VERIFICATION_AUTHORITY = deepFreeze(
  {
    id: "admitted-spice-electrical",
    version: "1.0",
  } satisfies ProjectBriefVerificationAuthority,
);

/**
 * Semantic authority for one prescribed rigid-body kinematics observation.
 *
 * This names the engineering intent only.  The capability planner later
 * selects (or marks unavailable) an exact server-owned binding; a Brief never
 * accepts a Chrono image, endpoint, provider tool, or argument from a caller.
 */
export const PRESCRIBED_KINEMATICS_VERIFICATION_AUTHORITY = deepFreeze(
  {
    id: "prescribed-kinematics",
    version: "1.0",
  } satisfies ProjectBriefVerificationAuthority,
);

/**
 * The route table forecasts only the registered operations which may carry a
 * runtime demand. The compiler resolves those demands from the real registry;
 * this table never restates a capability or selects a provider/runtime.
 */
export const BRIEF_CAPABILITY_INTENT_ROUTES = deepFreeze(
  [
    {
      authority: STATIC_STRUCTURAL_FEA_VERIFICATION_AUTHORITY,
      operations: [
        { id: "design.write-geometry", version: "1" },
        { id: "verify.run-fea-static-proof", version: "3" },
      ],
    },
    {
      authority: STATIC_STRUCTURAL_FEA_SENSITIVITY_VERIFICATION_AUTHORITY,
      operations: [{ id: "analyze.run-fea-sensitivity", version: "1" }],
    },
    {
      authority: ADMITTED_MODELICA_THERMAL_VERIFICATION_AUTHORITY,
      operations: [
        { id: "simulate.run-admitted-modelica", version: "1" },
        { id: "verify.evaluate-admitted-modelica-observations", version: "1" },
      ],
    },
    {
      authority: ADMITTED_SPICE_ELECTRICAL_VERIFICATION_AUTHORITY,
      operations: [{ id: "simulate.run-admitted-spice", version: "1" }],
    },
    {
      authority: PRESCRIBED_KINEMATICS_VERIFICATION_AUTHORITY,
      operations: [{ id: "verify.run-prescribed-kinematics", version: "1" }],
    },
    {
      authority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
      // Assembly integrity is only meaningful after the server-owned SysON
      // structure and canonical geometry path have been made available. The
      // Brief ceiling must therefore forecast their exact runtime-bearing
      // registered operations as well as the factual observer itself.
      operations: [
        { id: "architecture.seed-syson-model", version: "2" },
        { id: "model.write-architecture", version: "1" },
        { id: "model.capture-part-definitions", version: "1" },
        { id: "design.write-geometry", version: "1" },
        { id: "verify.observe-assembly-integrity", version: "1" },
      ],
    },
  ] satisfies readonly BriefCapabilityIntentRoute[],
);

export const briefCapabilityIntentRouteTable: BriefCapabilityIntentRouteTable =
  deepFreeze({
    list(): readonly BriefCapabilityIntentRoute[] {
      return BRIEF_CAPABILITY_INTENT_ROUTES;
    },
  });
