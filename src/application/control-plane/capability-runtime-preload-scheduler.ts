/**
 * Best-effort material preload after host-operational authorization.
 *
 * It is intentionally narrower than a JIT session: it can ask H1 to ensure a
 * persistent material exists, but it can neither acquire a run lease nor
 * activate Compose. Failures stay in H1's host observation/journal lanes and
 * never compensate, roll back, or alter the already-confirmed project brief.
 */

import type { ProjectCapabilityProposal } from "../../domain/capability/project-capability-authorization.ts";
import type { CapabilityRuntimeCachePreparationCoordinator } from "./capability-runtime-cache-preparation-coordinator.ts";
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";
import { capabilityRuntimeAdminLockMismatchBlocker } from "./plan-project-capability.ts";

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
    if (proposal.status === "unresolved") return;
    if (
      proposal.activation === "blocked" &&
      (!recheck || !isTransientAdminLockMismatchOnly(proposal))
    ) return;
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
          // Docker source/build is internal acquisition, not a cache recipe.
          if (material.lifecycle === "cache") continue;
          // MicroVM material is not a hidden service. The coordinator
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

/**
 * An amendment proposal records the pre-reconciliation lock as immutable
 * review evidence. Once the ledger is durable, the authorization service
 * reconciles that lock before scheduling preload. Only that exact transient
 * blocker may therefore cross this boundary, and only with the service's
 * durable authorization recheck attached to every host request.
 */
function isTransientAdminLockMismatchOnly(
  proposal: ProjectCapabilityProposal,
): boolean {
  if (
    proposal.effects.security === "unknown" || proposal.blockers.length === 0
  ) return false;
  const exactBlockers = new Set(
    proposal.units.map((unit) => capabilityRuntimeAdminLockMismatchBlocker(unit.id)),
  );
  return proposal.blockers.every((blocker) => exactBlockers.has(blocker));
}
