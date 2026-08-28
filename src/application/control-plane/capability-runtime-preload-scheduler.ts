/**
 * Best-effort material preload after host-operational authorization.
 *
 * It is intentionally narrower than a JIT session: it can ask H1 to ensure a
 * persistent material exists, but it can neither acquire a run lease nor
 * activate Compose. Failures stay in H1's host observation/journal lanes and
 * never compensate, roll back, or alter the already-confirmed project brief.
 */

import type { ProjectCapabilityProposal } from "./project-capability-authorization.ts";
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";

export interface CapabilityRuntimePreloadSchedulerOptions {
  readonly host: Pick<CapabilityRuntimeLaunchGroupSupervisor, "ensureMaterial">;
  readonly now?: () => string;
  /** Operational diagnostics only; never a project/Thread mutation. */
  readonly onHostError?: (input: {
    readonly projectId: string;
    readonly launchGroupId: string;
    readonly error: unknown;
  }) => void;
}

export class CapabilityRuntimePreloadScheduler {
  readonly #now: () => string;

  constructor(private readonly options: CapabilityRuntimePreloadSchedulerOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** Fire-and-forget by design: capability approval is already durable. */
  schedule(
    proposal: ProjectCapabilityProposal,
    recheck?: () => Promise<boolean>,
  ): void {
    if (proposal.status === "unresolved" || proposal.activation === "blocked") return;
    const groups = new Map<
      string,
      NonNullable<
        ProjectCapabilityProposal["units"][number]["materials"][number]["launchGroup"]
      >
    >();
    for (const unit of proposal.units) {
      for (const material of unit.materials) {
        // No group is guessed. Disposable/cache material is JIT-only and
        // deliberately excluded: no image pull, no microsandbox load here.
        if (material.lifecycle !== "persistent" || material.launchGroup === null) {
          continue;
        }
        groups.set(
          `${material.launchGroup.id}\u0000${material.launchGroup.version}\u0000${material.launchGroup.fingerprint.digest}`,
          material.launchGroup,
        );
      }
    }
    for (const group of groups.values()) {
      const request = {
        group,
        projectId: proposal.projectId,
        at: this.#now(),
      };
      const guarded = recheck === undefined ? request : { ...request, guard: recheck };
      void this.options.host.ensureMaterial(guarded).catch((error) => {
        this.options.onHostError?.({
          projectId: proposal.projectId,
          launchGroupId: group.id,
          error,
        });
      });
    }
  }
}
