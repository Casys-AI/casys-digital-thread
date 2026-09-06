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
