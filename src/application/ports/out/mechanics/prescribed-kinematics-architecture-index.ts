/**
 * Read-only navigation over the architecture capture named by a mechanism
 * source attachment.  It deliberately exposes identities only: labels, STEP
 * names, and inferred hierarchy are not a join surface.
 */

import type { ProjectSourceAttachmentDeclaredAgainst } from "../../../../domain/project-source-workspace/types.ts";

export interface PrescribedKinematicsArchitectureFacts {
  /** Exact PartDefinition selected by a PartUsage typed_by edge. */
  typedDefinitionId(usageElementId: string): string | undefined;
  /** Exact immediate PartUsage children of one PartDefinition. */
  immediateUsageIds(definitionElementId: string): readonly string[];
}

export interface PrescribedKinematicsArchitectureIndex {
  open(
    declaredAgainst: ProjectSourceAttachmentDeclaredAgainst,
  ): Promise<PrescribedKinematicsArchitectureFacts | undefined>;
}
