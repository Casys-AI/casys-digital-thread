import { compileProjectCapabilityDemand } from "../../application/control-plane/compile-project-capability-demand.ts";
import type { ProjectCapabilityDemand } from "../../domain/capability/project-capability-demand.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { engineeringOperationRegistry } from "../../orchestration/operations/registry.ts";

/**
 * Behave composition resolves all planned work against the full trusted
 * registry. Behave routes are a separate census projection, never an
 * authorization filter for project capability demand.
 */
export function compileBehaveFoundationProjectCapabilityDemand(
  project: EngineeringProjectSnapshot,
): Promise<ProjectCapabilityDemand> {
  return compileProjectCapabilityDemand(project, engineeringOperationRegistry);
}
