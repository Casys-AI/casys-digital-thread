/**
 * Best-effort material preload after host-operational authorization.
 *
 * It is intentionally narrower than a JIT session: it can ask H1 to ensure a
 * persistent material exists, but it can neither acquire a run lease nor
 * activate Compose. Failures stay in H1's host observation/journal lanes and
 * never compensate, roll back, or alter the already-confirmed project brief.
 */

import type { ProjectCapabilityProposal } from "./project-capability-authorization.ts";
import type { CapabilityRuntimeCachePreparationCoordinator } from "./capability-runtime-cache-preparation-coordinator.ts";
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";

export interface CapabilityRuntimePreloadSchedulerOptions {
  readonly host: Pick<CapabilityRuntimeLaunchGroupSupervisor, "ensureMaterial">;
  /**
   * Separate cache lane. It receives only non-persistent materials and never
   * sees a Compose launch group. Omitted until a code-owned recipe composition
   * exists; persistent H1 behaviour remains unchanged.
   */
  readonly cachePreparer?: Pick<
    CapabilityRuntimeCachePreparationCoordinator,
    "prepare"
  >;
  readonly now?: () => string;
  /** Operational diagnostics only; never a project/Thread mutation. */
  readonly onHostError?: (input: {
    readonly projectId: string;
    readonly launchGroupId: string;
    readonly error: unknown;
  }) => void;
  /** Operational-only failure hook for the non-Compose cache lane. */
  readonly onCachePreparationError?: (input: {
    readonly projectId: string;
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
    const cacheMaterials = new Map<string, {
      readonly material: {
        readonly unitId: string;
        readonly materialId: string;
        readonly imageDigest: string;
      };
      readonly imageReference: string;
      readonly lifecycle: "ephemeral" | "cache";
    }>();
    for (const unit of proposal.units) {
      for (const material of unit.materials) {
        if (material.lifecycle !== "persistent") {
          // Cache/microVM material is not a hidden service. The coordinator
          // resolves a code-owned atomic recipe from this closed scope.
          if (!this.options.cachePreparer) continue;
          const digest = /@sha256:([a-f0-9]{64})$/.exec(
            material.imageReference,
          )?.[1];
          if (!digest) {
            this.options.onCachePreparationError?.({
              projectId: proposal.projectId,
              error: new Error("Cache preload material is not digest-pinned."),
            });
            continue;
          }
          const identity = {
            unitId: unit.id,
            materialId: material.id,
            imageDigest: digest,
          };
          cacheMaterials.set(
            `${identity.unitId}\u0000${identity.materialId}`,
            {
              material: identity,
              imageReference: material.imageReference,
              lifecycle: material.lifecycle,
            },
          );
          continue;
        }
        // No group is guessed. Persistent acquisition remains H1-only.
        if (material.launchGroup === null) continue;
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
    if (this.options.cachePreparer && cacheMaterials.size > 0) {
      if (!recheck) {
        this.options.onCachePreparationError?.({
          projectId: proposal.projectId,
          error: new Error("Cache preload requires a durable authorization recheck."),
        });
        return;
      }
      const materials = [...cacheMaterials.values()].toSorted((left, right) =>
        `${left.material.unitId}\u0000${left.material.materialId}`.localeCompare(
          `${right.material.unitId}\u0000${right.material.materialId}`,
        )
      );
      void this.options.cachePreparer.prepare({
        projectId: proposal.projectId,
        materials,
        guard: recheck,
      }).catch((error) => {
        this.options.onCachePreparationError?.({
          projectId: proposal.projectId,
          error,
        });
      });
    }
  }
}
