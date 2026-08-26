/**
 * Inward port for the draft project source workspace. Mutations grant none.
 */

import type {
  ProjectSourceAttachmentListEntry,
  ProjectSourceAttachmentRead,
  ProjectSourceAttachmentRecrossResult,
  ProjectSourceFileRead,
  ProjectSourcePage,
  ProjectSourceSearchHit,
  ProjectSourceTreeEntry,
  ProjectSourceWorkspaceSnapshot,
} from "../../../../domain/project-source-workspace/types.ts";

export interface ProjectSourceWorkspaceUseCase {
  putModule(value: unknown): Promise<ProjectSourceWorkspaceSnapshot>;
  putFile(value: unknown): Promise<ProjectSourceWorkspaceSnapshot>;
  removeFile(value: unknown): Promise<ProjectSourceWorkspaceSnapshot>;
  putAttachment(value: unknown): Promise<ProjectSourceWorkspaceSnapshot>;
  recrossAttachments(
    value: unknown,
  ): Promise<ProjectSourceAttachmentRecrossResult>;
  detachAttachment(value: unknown): Promise<ProjectSourceWorkspaceSnapshot>;
  snapshot(value: unknown): Promise<ProjectSourceWorkspaceSnapshot>;
  tree(
    value: unknown,
  ): Promise<ProjectSourcePage<ProjectSourceTreeEntry>>;
  search(
    value: unknown,
  ): Promise<ProjectSourcePage<ProjectSourceSearchHit>>;
  readFile(value: unknown): Promise<ProjectSourceFileRead>;
  readAttachment(value: unknown): Promise<ProjectSourceAttachmentRead>;
  listAttachments(
    value: unknown,
  ): Promise<ProjectSourcePage<ProjectSourceAttachmentListEntry>>;
}
