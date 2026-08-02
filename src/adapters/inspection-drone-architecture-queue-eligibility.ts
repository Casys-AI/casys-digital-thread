import type {
  EngineeringProjectQueueEligibility,
} from "../domain/engineering-project-command-service.ts";
import {
  INSPECTION_DRONE_ARCHITECTURE_OPERATION,
} from "../domain/inspection-drone-architecture.ts";
import {
  type InspectionDroneArchitectureEligibilityDependencies,
  resolveInspectionDroneArchitectureEligibility,
} from "./inspection-drone-architecture-run-executor.ts";

/**
 * Provider-free admission gate for the one bounded r3 SysON operation.
 *
 * The generic command service invokes this before queueing a run. It leaves
 * every other registered operation alone, while r3 must re-read the exact r2
 * model seed and its r1 human-approved discovery lineage before a human
 * authorization becomes durable queue state.
 */
export class InspectionDroneArchitectureQueueEligibility
  implements EngineeringProjectQueueEligibility {
  readonly #dependencies: InspectionDroneArchitectureEligibilityDependencies;

  constructor(dependencies: InspectionDroneArchitectureEligibilityDependencies) {
    this.#dependencies = dependencies;
  }

  async validate(
    input: Parameters<EngineeringProjectQueueEligibility["validate"]>[0],
  ): Promise<void> {
    if (
      input.operation.id !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.id ||
      input.operation.version !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.version
    ) return;

    if (
      input.workItem.operation?.id !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.id ||
      input.workItem.operation.version !==
        INSPECTION_DRONE_ARCHITECTURE_OPERATION.version ||
      input.basis.kind !== "thread-snapshot"
    ) {
      throw new Error(
        "The bounded inspection-drone architecture must be queued only from its exact reviewed thread-snapshot basis.",
      );
    }

    await resolveInspectionDroneArchitectureEligibility(this.#dependencies, {
      project: input.project,
      basis: input.basis,
    });
  }
}
