/**
 * Compose the project source workspace kernel: event log, reopen, use cases.
 *
 * Construction never receives a provider URL, tool client, runtime, image
 * or compilation catalog. A capture request is caller-authored identity only.
 */

import type { ProjectSourceWorkspaceUseCase } from "../../application/ports/in/project-source-workspace/project-source-workspace.ts";
import type { AgentResourceExactReopener } from "../../application/ports/out/resource/agent-resource-exact-reopener.ts";
import {
  type ProjectExistenceReader,
  ProjectSourceWorkspaceUseCases,
} from "../../application/use-cases/project-source-workspace/project-source-workspace-use-cases.ts";
import { FileProjectSourceWorkspaceStore } from "./file-project-source-workspace-store.ts";

export const DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY =
  "state/local/project-source-workspaces";

export interface ProjectSourceWorkspaceCompositionOptions {
  readonly directory?: string;
  readonly projects: ProjectExistenceReader;
  readonly resources: AgentResourceExactReopener;
}

export interface ProjectSourceWorkspaceComposition {
  readonly sourceWorkspace: ProjectSourceWorkspaceUseCase;
  readonly store: FileProjectSourceWorkspaceStore;
}

export function createProjectSourceWorkspaceComposition(
  options: ProjectSourceWorkspaceCompositionOptions,
): ProjectSourceWorkspaceComposition {
  const store = new FileProjectSourceWorkspaceStore(
    options.directory ?? DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY,
  );
  return {
    store,
    sourceWorkspace: new ProjectSourceWorkspaceUseCases({
      projects: options.projects,
      workspace: store,
      resources: options.resources,
    }),
  };
}
