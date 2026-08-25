/**
 * Read-only server seam for one exact assembly-integrity review.
 *
 * This is deliberately a semantic port, not an observer/provider contract.
 * Its implementation owns the one recross of the current Thread basis and
 * unique primary `geometry-module-capture/1.0` artifact. The use case must
 * not reimplement that reopen logic or inspect project/thread storage itself.
 */

import type { AssemblyIntegrityObservationAdmission } from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

export interface AssemblyIntegrityReviewResolutionRequest {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly geometryModule: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
}

export interface AssemblyIntegrityReviewResolutionDiagnostic {
  readonly code: string;
  readonly artifactId: string | null;
  readonly message: string;
}

/**
 * An already-planned observation leaf selected only by its structural
 * operation/binding identity. This is not caller input and contains no
 * provider or executor detail.
 */
export interface AssemblyIntegrityReviewExistingWork {
  readonly phaseId: string;
  readonly workItemId: string;
  readonly decision: {
    readonly id: string;
    readonly title: string;
    readonly question: string;
  };
  /** Existing generic brief claims recrossed as contributes-to/current only. */
  readonly gateClaims: readonly {
    readonly gateItemId: string;
    readonly role: "contributes-to";
    readonly status: "current";
  }[];
}

export type AssemblyIntegrityReviewResolution =
  | {
    readonly status: "resolved";
    /** Full signed-input identity selected only after exact state recross. */
    readonly admission: AssemblyIntegrityObservationAdmission;
    /** Current EngineeringProject aggregate revision used by next.append. */
    readonly expectedProjectRevision: number;
    /** Present only when a matching planned leaf already exists. */
    readonly existingWork?: AssemblyIntegrityReviewExistingWork;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostics: readonly AssemblyIntegrityReviewResolutionDiagnostic[];
  };

/**
 * Reopens state only. It does not call an engineering observer, write a WAL,
 * mutate Thread/Project state, or expose any provider execution capability.
 */
export interface AssemblyIntegrityReviewResolver {
  resolve(
    request: AssemblyIntegrityReviewResolutionRequest,
  ): Promise<AssemblyIntegrityReviewResolution>;
}
