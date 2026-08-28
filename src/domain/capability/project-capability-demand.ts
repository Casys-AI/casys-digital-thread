import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { EngineeringApprovedBriefBasis } from "../project/engineering-project.ts";
import type {
  AllowedEngineeringCapability,
  CapabilityQualification,
  RequiredEngineeringCapability,
} from "./engineering-capability.ts";
import type { CapabilityDemandOperationReference } from "./capability-requirement-catalog.ts";

export type { RequiredEngineeringCapability } from "./engineering-capability.ts";

export const PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION =
  "project-capability-demand/1.0" as const;

/** Exact immutable project revision from which an operational path was read. */
export interface ProjectCapabilityDemandSnapshotBasis {
  readonly projectId: string;
  readonly snapshotId: string;
  readonly revision: number;
}

interface ProjectCapabilityOperationGroupBase {
  readonly operation: CapabilityDemandOperationReference;
  readonly workItemIds: readonly string[];
}

export interface ResolvedProjectCapabilityOperationGroup
  extends ProjectCapabilityOperationGroupBase {
  readonly resolution: "resolved";
  readonly capabilities: readonly RequiredEngineeringCapability[];
}

export interface UnresolvedProjectCapabilityOperationGroup
  extends ProjectCapabilityOperationGroupBase {
  readonly resolution: "unresolved";
  readonly reason: "catalog-entry-missing";
}

/**
 * One canonical operation group in the planned path. Unknown operations remain
 * first-class unresolved demand and are never omitted from the result.
 */
export type ProjectCapabilityOperationGroup =
  | ResolvedProjectCapabilityOperationGroup
  | UnresolvedProjectCapabilityOperationGroup;

/**
 * Provider-neutral, read-only capability demand derived from one exact planned
 * project revision. It cannot choose a pack, image, tool, endpoint or arguments.
 */
export interface ProjectCapabilityDemand {
  readonly schemaVersion: typeof PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly status: "resolved" | "unresolved";
  readonly projectSnapshot: ProjectCapabilityDemandSnapshotBasis;
  readonly approvedBriefBasis: EngineeringApprovedBriefBasis;
  readonly operationGroups: readonly ProjectCapabilityOperationGroup[];
  readonly capabilityRequirements: readonly RequiredEngineeringCapability[];
  /** Binds the exact project, approved brief and canonical operation path. */
  readonly pathFingerprint: ContentFingerprint;
  /** Binds canonical requirements and every unresolved operation group. */
  readonly capabilitySetFingerprint: ContentFingerprint;
}

export interface ProjectCapabilityDemandCoverage {
  readonly fits: boolean;
  readonly unresolvedOperationGroups:
    readonly UnresolvedProjectCapabilityOperationGroup[];
  readonly missingRequirements: readonly RequiredEngineeringCapability[];
}

/**
 * Pure subset policy for a later approved capability envelope. An unresolved
 * operation never fits. Capability identity, version and use must match, and
 * the available qualification must be equal to or stronger than required.
 */
export function evaluateProjectCapabilityDemandCoverage(
  demand: ProjectCapabilityDemand,
  allowed: readonly AllowedEngineeringCapability[],
): ProjectCapabilityDemandCoverage {
  const unresolvedOperationGroups = demand.operationGroups.filter(
    (group): group is UnresolvedProjectCapabilityOperationGroup =>
      group.resolution === "unresolved",
  );
  const missingRequirements = demand.capabilityRequirements.filter(
    (requirement) =>
      !allowed.some((candidate) =>
        sameCapabilityUse(candidate, requirement) &&
        qualificationCovers(
          candidate.qualification,
          requirement.minimumQualification,
        )
      ),
  );
  return {
    fits: unresolvedOperationGroups.length === 0 &&
      missingRequirements.length === 0,
    unresolvedOperationGroups,
    missingRequirements,
  };
}

function sameCapabilityUse(
  left: AllowedEngineeringCapability,
  right: RequiredEngineeringCapability,
): boolean {
  return left.id === right.id &&
    left.version === right.version &&
    left.use === right.use;
}

function qualificationCovers(
  allowed: CapabilityQualification,
  required: CapabilityQualification,
): boolean {
  return allowed === "qualified" || required === "compatible";
}
