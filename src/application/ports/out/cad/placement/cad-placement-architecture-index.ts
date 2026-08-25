/**
 * CAD-owned queries over one exact architecture-capture/4.0 navigation index.
 *
 * Labels never join. The index is disposable and is not product authority.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { CadPlacementArchitectureFacts } from "../../../../../domain/cad/placement/cad-placement-coverage.ts";

export interface CadPlacementArchitectureOpen {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
}

export interface CadPlacementArchitectureIndex {
  open(
    query: CadPlacementArchitectureOpen,
  ): Promise<CadPlacementArchitectureFacts | undefined>;
}
