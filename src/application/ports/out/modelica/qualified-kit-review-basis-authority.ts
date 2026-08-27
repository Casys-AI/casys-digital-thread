/** Read-only authority for the exact project/Thread basis used by Modelica review. */

import type {
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";

export interface ModelicaQualifiedKitReviewBasisRequest {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
}

/**
 * Reopens the canonical current basis. `undefined` means the project, its
 * schema-3 identity, its current Thread head or the exact snapshot is absent.
 */
export interface ModelicaQualifiedKitReviewBasisAuthority {
  reopenExact(
    request: ModelicaQualifiedKitReviewBasisRequest,
  ): Promise<ModelicaQualifiedKitReviewBasisRequest | undefined>;
}
