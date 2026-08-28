/**
 * Best-effort material preload after host-operational authorization.
 *
 * It is intentionally narrower than a JIT session: it can ask H1 to ensure a
 * persistent material exists, but it can neither acquire a run lease nor
 * activate Compose. Failures stay in H1's host observation/journal lanes and
 * never compensate, roll back, or alter the already-confirmed project brief.
 */

import type { ProjectCapabilityProposal } from "./project-capability-authorization.ts";
import type { CapabilityRuntimeHostSupervisor } from "./capability-runtime-host-supervisor.ts";

export interface CapabilityRuntimePreloadSchedulerOptions {
  readonly host: Pick<CapabilityRuntimeHostSupervisor, "ensureMaterial">;
  readonly now?: () => string;
  /** Operational diagnostics only; never a project/Thread mutation. */
  readonly onHostError?: (input: {
    readonly projectId: string;
    readonly unitId: string;
    readonly materialId: string;
    readonly error: unknown;
  }) => void;
}

export class CapabilityRuntimePreloadScheduler {
  readonly #now: () => string;

  constructor(private readonly options: CapabilityRuntimePreloadSchedulerOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** Fire-and-forget by design: capability approval is already durable. */
  schedule(proposal: ProjectCapabilityProposal): void {
    if (proposal.status === "unresolved" || proposal.activation === "blocked") return;
    for (const unit of proposal.units) {
      for (const material of unit.materials) {
        // No profile is guessed. Disposable/cache material is JIT-only and
        // deliberately excluded: no image pull, no microsandbox load here.
        if (material.lifecycle !== "persistent" || material.launchProfile === null) {
          continue;
        }
        void this.options.host.ensureMaterial({
          profile: material.launchProfile,
          projectId: proposal.projectId,
          at: this.#now(),
        }).catch((error) => {
          this.options.onHostError?.({
            projectId: proposal.projectId,
            unitId: unit.id,
            materialId: material.id,
            error,
          });
        });
      }
    }
  }
}
