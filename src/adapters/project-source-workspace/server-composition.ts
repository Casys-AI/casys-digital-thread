/**
 * Compose the project source workspace kernel: event log, reopen, use cases.
 *
 * Construction never receives a provider URL, tool client, runtime, image
 * or compilation catalog. A capture request is caller-authored identity only.
 * Attachment recross uses the shared product-structure traversal and a fixed
 * generic role catalog.
 */

import type { ProjectSourceWorkspaceUseCase } from "../../application/ports/in/project-source-workspace/project-source-workspace.ts";
import type { AgentResourceExactReopener } from "../../application/ports/out/resource/agent-resource-exact-reopener.ts";
import type { ProjectSourceAttachmentRoleCatalog } from "../../application/ports/out/project-source-workspace/project-source-attachment-role-catalog.ts";
import type {
  ProductStructureTraversal,
} from "../../application/ports/out/product-navigation/product-structure-traversal.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import {
  type ProjectExistenceReader,
  ProjectSourceWorkspaceUseCases,
} from "../../application/use-cases/project-source-workspace/project-source-workspace-use-cases.ts";
import { FileProjectSourceWorkspaceStore } from "./file-project-source-workspace-store.ts";
import { FixedProjectSourceAttachmentRoleCatalog } from "./fixed-project-source-attachment-role-catalog.ts";

export const DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY =
  "state/local/project-source-workspaces";

export interface ProjectSourceWorkspaceCompositionOptions {
  readonly directory?: string;
  readonly store?: FileProjectSourceWorkspaceStore;
  readonly projects: ProjectExistenceReader;
  readonly resources: AgentResourceExactReopener;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly traversal: ProductStructureTraversal;
  readonly roles?: ProjectSourceAttachmentRoleCatalog;
}

export interface ProjectSourceWorkspaceComposition {
  readonly sourceWorkspace: ProjectSourceWorkspaceUseCase;
  readonly store: FileProjectSourceWorkspaceStore;
}

export function createProjectSourceWorkspaceComposition(
  options: ProjectSourceWorkspaceCompositionOptions,
): ProjectSourceWorkspaceComposition {
  const store = options.store ??
    new FileProjectSourceWorkspaceStore(
      options.directory ?? DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY,
    );
  return {
    store,
    sourceWorkspace: new ProjectSourceWorkspaceUseCases({
      projects: options.projects,
      workspace: store,
      resources: options.resources,
      snapshots: options.snapshots,
      traversal: options.traversal,
      roles: options.roles ?? new FixedProjectSourceAttachmentRoleCatalog(),
    }),
  };
}
