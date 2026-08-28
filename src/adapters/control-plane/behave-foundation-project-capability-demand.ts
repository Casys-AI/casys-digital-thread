import { compileProjectCapabilityDemandFromServerCatalog } from "../../application/control-plane/compile-project-capability-demand.ts";
import type { ProjectCapabilityDemand } from "../../domain/capability/project-capability-demand.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS } from "../../orchestration/operations/behave-capability-requirements.ts";

/**
 * Product composition for the current Behave Foundation scope. The trusted,
 * frozen catalogue is selected here; no caller can provide capability ids.
 */
export function compileBehaveFoundationProjectCapabilityDemand(
  project: EngineeringProjectSnapshot,
): Promise<ProjectCapabilityDemand> {
  return compileProjectCapabilityDemandFromServerCatalog(
    project,
    BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS,
  );
}
