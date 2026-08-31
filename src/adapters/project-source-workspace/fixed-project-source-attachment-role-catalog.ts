/**
 * Fixed generic v1 attachment roles. Not a per-project or per-provider catalog.
 */

import type { ProjectSourceAttachmentRoleCatalog } from "../../application/ports/out/project-source-workspace/project-source-attachment-role-catalog.ts";
import type {
  ProjectSourceAttachmentRole,
  ProjectSourceAttachmentTarget,
} from "../../domain/project-source-workspace/types.ts";

export const PROJECT_SOURCE_ATTACHMENT_ROLE_IDS = [
  "architecture-source",
  "design-source",
  "behavior-source",
  "mechanism-source",
  "verification-source",
  "supporting-document",
] as const;

const ROLE_IDS = new Set<string>(PROJECT_SOURCE_ATTACHMENT_ROLE_IDS);
const TARGET_KINDS = new Set(["PartDefinition", "PartUsage"]);

export class FixedProjectSourceAttachmentRoleCatalog
  implements ProjectSourceAttachmentRoleCatalog {
  accept(
    role: ProjectSourceAttachmentRole,
    target: ProjectSourceAttachmentTarget,
  ): boolean {
    return role.version === 1 &&
      ROLE_IDS.has(role.id) &&
      TARGET_KINDS.has(target.elementKind);
  }
}
