/**
 * CAD-owned queries over one exact architecture-capture/4.0 navigation index.
 *
 * The query is the attachment declaredAgainst basis. Labels never join. The
 * index is disposable and is not product authority.
 */

import type { CadPlacementArchitectureFacts } from "../../../../../domain/cad/placement/cad-placement-coverage.ts";
import type { ProjectSourceAttachmentDeclaredAgainst } from "../../../../../domain/project-source-workspace/types.ts";

export interface CadPlacementArchitectureIndex {
  open(
    declaredAgainst: ProjectSourceAttachmentDeclaredAgainst,
  ): Promise<CadPlacementArchitectureFacts | undefined>;
}
