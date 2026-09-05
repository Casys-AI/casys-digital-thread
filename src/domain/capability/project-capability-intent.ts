import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { RequiredEngineeringCapability } from "./engineering-capability.ts";

/**
 * Provider-neutral operational intent derived before a project plan exists.
 *
 * A brief names semantic verification authorities. The server resolves those
 * authorities through its closed route table and the registered-operation
 * runtime demands. This value deliberately has no provider, image, endpoint,
 * tool, argument, or secret representation.
 */
export const PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION =
  "project-capability-intent/1.0" as const;

export interface ProjectCapabilityIntentAuthorityReference {
  readonly id: string;
  readonly version: string;
}

export interface ProjectCapabilityIntentOperationReference {
  readonly id: string;
  readonly version: string;
}

export interface ResolvedProjectCapabilityIntentAuthority {
  readonly authority: ProjectCapabilityIntentAuthorityReference;
  readonly resolution: "resolved";
  /** Exact server-owned operations selected by this semantic authority. */
  readonly operations: readonly ProjectCapabilityIntentOperationReference[];
}

export interface UnresolvedProjectCapabilityIntentAuthority {
  readonly authority: ProjectCapabilityIntentAuthorityReference;
  readonly resolution: "unresolved";
  readonly reason:
    | "authority-unrouted"
    | "route-operation-missing"
    | "operation-unregistered";
  /**
   * Present and nonempty only when the closed route named unregistered
   * operations. Every missing exact operation stays visible to the review.
   */
  readonly operations?: readonly ProjectCapabilityIntentOperationReference[];
}

/**
 * Every verification authority selected from a brief remains visible. An
 * unresolved authority is not silently reduced to an empty capability set.
 */
export type ProjectCapabilityIntentAuthorityResolution =
  | ResolvedProjectCapabilityIntentAuthority
  | UnresolvedProjectCapabilityIntentAuthority;

export interface ProjectCapabilityIntent {
  readonly schemaVersion: typeof PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly status: "resolved" | "unresolved";
  /** Canonically ordered unique authority resolutions from the brief. */
  readonly authorities: readonly ProjectCapabilityIntentAuthorityResolution[];
  /** Canonically flattened requirements from resolved routed operations only. */
  readonly capabilityRequirements: readonly RequiredEngineeringCapability[];
  /**
   * Hash of only the semantic operational ceiling: flattened requirements and
   * literal unresolved authority blockers. It intentionally excludes brief
   * prose, sources, IDs, provider details, and route implementation details.
   */
  readonly capabilityIntentFingerprint: ContentFingerprint;
}

export function unresolvedProjectCapabilityIntentAuthorities(
  intent: ProjectCapabilityIntent,
): readonly UnresolvedProjectCapabilityIntentAuthority[] {
  return intent.authorities.filter(
    (authority): authority is UnresolvedProjectCapabilityIntentAuthority =>
      authority.resolution === "unresolved",
  );
}
