/**
 * Server-owned product-relation roles for source attachments.
 *
 * Roles are generic `{id, version}` pairs. They are never configured per
 * project, tool or provider and grant no technical authority.
 */

import type {
  ProjectSourceAttachmentRole,
  ProjectSourceAttachmentTarget,
} from "../../../../domain/project-source-workspace/types.ts";

export interface ProjectSourceAttachmentRoleCatalog {
  accept(
    role: ProjectSourceAttachmentRole,
    target: ProjectSourceAttachmentTarget,
  ): boolean;
}
