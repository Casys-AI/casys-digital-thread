import type { ContentFingerprint } from "../kernel/primitives.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectPlan,
  EngineeringWorkItemStatus,
} from "../project/engineering-project.ts";
import type {
  AllowedEngineeringCapability,
  CapabilityQualification,
  RequiredEngineeringCapability,
} from "./engineering-capability.ts";

export type { RequiredEngineeringCapability } from "./engineering-capability.ts";

export const PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION =
  "project-capability-demand/2.0" as const;

/** Exact immutable project revision from which an operational path was read. */
export interface ProjectCapabilityDemandSnapshotBasis {
  readonly projectId: string;
  readonly snapshotId: string;
  readonly revision: number;
}

export interface ProjectCapabilityOperationReference {
  readonly id: string;
  readonly version: string;
}

interface ProjectCapabilityOperationGroupBase {
  readonly operation: ProjectCapabilityOperationReference;
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
  readonly reason: "operation-unregistered";
}

/**
 * One canonical operation group in the planned path. Unknown operations remain
 * first-class unresolved demand and are never omitted from the result.
 */
export type ProjectCapabilityOperationGroup =
  | ResolvedProjectCapabilityOperationGroup
  | UnresolvedProjectCapabilityOperationGroup;

/** One immutable work-item revision, including historical non-leaf revisions. */
export interface ProjectCapabilityWorkItemHistory {
  readonly id: string;
  readonly activityId: string;
  readonly predecessorRevisionId?: string;
  readonly status: EngineeringWorkItemStatus;
  /** Exact operation identity only; bindings are deliberately absent. */
  readonly operation: ProjectCapabilityOperationReference | null;
  readonly resolution: "resolved" | "unresolved";
  readonly reason?: "operation-missing" | "operation-unregistered";
}

/** A canonical capability set for a bounded operation path. */
export interface ProjectCapabilityDemandSlice {
  readonly status: "resolved" | "unresolved";
  readonly operationGroups: readonly ProjectCapabilityOperationGroup[];
  readonly capabilityRequirements: readonly RequiredEngineeringCapability[];
}

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
  /** Exact project-plan publication basis; no caller-provided catalogue exists. */
  readonly plan: EngineeringProjectPlan;
  /** Every revision, including cancelled, abandoned and superseded history. */
  readonly workItemHistory: readonly ProjectCapabilityWorkItemHistory[];
  /** Current activity leaves except cancelled or abandoned: the authorization ceiling. */
  readonly plannedCeiling: ProjectCapabilityDemandSlice;
  /** Ready or in-progress leaves already inside the planned ceiling. */
  readonly jitDemand: ProjectCapabilityDemandSlice;
  /** Binds project/brief/plan/registry and the canonical full revision history. */
  readonly historyPathFingerprint: ContentFingerprint;
  /** Binds the exact canonical current authorization ceiling. */
  readonly plannedCeilingFingerprint: ContentFingerprint;
  /** Binds the exact ready/in-progress subset of that ceiling. */
  readonly jitDemandFingerprint: ContentFingerprint;
  /** Fingerprint of every registry operation and runtime demand, including `none`. */
  readonly registryFingerprint: ContentFingerprint;
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
  const unresolvedOperationGroups = demand.plannedCeiling.operationGroups.filter(
    (group): group is UnresolvedProjectCapabilityOperationGroup =>
      group.resolution === "unresolved",
  );
  const missingRequirements = demand.plannedCeiling.capabilityRequirements.filter(
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
