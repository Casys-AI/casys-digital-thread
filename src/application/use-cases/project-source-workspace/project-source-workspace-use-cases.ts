/**
 * Project-scoped workspace mutations and revision-anchored reads.
 *
 * EngineeringProject must already exist. File puts reopen the exact
 * AgentResourceReference before the aggregate accepts the revision.
 */

import type { ProjectSourceWorkspaceUseCase } from "../../ports/in/project-source-workspace/project-source-workspace.ts";
import type { AgentResourceExactReopener } from "../../ports/out/resource/agent-resource-exact-reopener.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  ProjectSourceWorkspaceStoreError,
} from "../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  applyProjectSourceWorkspaceCommand,
} from "../../../domain/project-source-workspace/transitions.ts";
import {
  projectSourceWorkspaceFileRead,
  projectSourceWorkspaceSearchPage,
  projectSourceWorkspaceSnapshot,
  projectSourceWorkspaceTreePage,
} from "../../../domain/project-source-workspace/reads.ts";
import {
  type ProjectSourceFileRead,
  type ProjectSourcePage,
  type ProjectSourceSearchHit,
  type ProjectSourceTreeEntry,
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceSnapshot,
  type ProjectSourceWorkspaceState,
} from "../../../domain/project-source-workspace/types.ts";
import {
  parseFileReadQuery,
  parseSearchQuery,
  parseSnapshotQuery,
  parseTreeQuery,
  parseWorkspaceCommand,
} from "../../../domain/project-source-workspace/validation.ts";

export interface ProjectExistenceReader {
  get(projectId: string): Promise<unknown>;
}

export class ProjectSourceWorkspaceUseCases implements ProjectSourceWorkspaceUseCase {
  readonly #projects: ProjectExistenceReader;
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: AgentResourceExactReopener;

  constructor(dependencies: {
    readonly projects: ProjectExistenceReader;
    readonly workspace: ProjectSourceWorkspaceEventStore;
    readonly resources: AgentResourceExactReopener;
  }) {
    this.#projects = dependencies.projects;
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
  }

  async putModule(value: unknown): Promise<ProjectSourceWorkspaceSnapshot> {
    return await this.mutate(value, "module_put");
  }

  async putFile(value: unknown): Promise<ProjectSourceWorkspaceSnapshot> {
    return await this.mutate(value, "file_put");
  }

  async removeFile(value: unknown): Promise<ProjectSourceWorkspaceSnapshot> {
    return await this.mutate(value, "file_remove");
  }

  async snapshot(value: unknown): Promise<ProjectSourceWorkspaceSnapshot> {
    const query = parseSnapshotQuery(value);
    await this.requireProject(query.projectId);
    const state = await this.#workspace.load(query.projectId);
    return projectSourceWorkspaceSnapshot(state);
  }

  async tree(
    value: unknown,
  ): Promise<ProjectSourcePage<ProjectSourceTreeEntry>> {
    const query = parseTreeQuery(value);
    await this.requireProject(query.projectId);
    const state = await this.loadRevision(query.projectId, query.workspaceRevision);
    return projectSourceWorkspaceTreePage(state, query);
  }

  async search(
    value: unknown,
  ): Promise<ProjectSourcePage<ProjectSourceSearchHit>> {
    const query = parseSearchQuery(value);
    await this.requireProject(query.projectId);
    const state = await this.loadRevision(query.projectId, query.workspaceRevision);
    return projectSourceWorkspaceSearchPage(state, query);
  }

  async readFile(value: unknown): Promise<ProjectSourceFileRead> {
    const query = parseFileReadQuery(value);
    await this.requireProject(query.projectId);
    const state = await this.loadRevision(query.projectId, query.workspaceRevision);
    return projectSourceWorkspaceFileRead(state, query);
  }

  private async mutate(
    value: unknown,
    kind: "module_put" | "file_put" | "file_remove",
  ): Promise<ProjectSourceWorkspaceSnapshot> {
    const command = parseWorkspaceCommand(value);
    if (command.mutation.kind !== kind) {
      throw new ProjectSourceWorkspaceError(
        "invalid_request",
        `This command accepts only ${kind} mutations.`,
      );
    }
    await this.requireProject(command.projectId);
    const current = await this.#workspace.load(command.projectId);
    if (current.mutations.has(command.mutationId)) {
      const replayed = await applyProjectSourceWorkspaceCommand(current, command);
      return await this.snapshotAt(
        command.projectId,
        replayed.event.workspaceRevision,
      );
    }
    if (command.mutation.kind === "file_put") {
      await this.#resources.reopenExact(command.mutation.resourceRef);
    }
    const state = await this.#workspace.load(command.projectId);
    const transition = await applyProjectSourceWorkspaceCommand(state, command);
    if (transition.replayed) {
      return await this.snapshotAt(
        command.projectId,
        transition.event.workspaceRevision,
      );
    }
    try {
      await this.#workspace.append(transition.event);
    } catch (cause) {
      const concurrentPublication = cause instanceof ProjectSourceWorkspaceStoreError &&
          cause.code === "cas_conflict" ||
        cause instanceof ProjectSourceWorkspaceError &&
          cause.code === "event_sequence_mismatch";
      if (concurrentPublication) {
        const latest = await this.#workspace.load(command.projectId);
        const retry = await applyProjectSourceWorkspaceCommand(latest, command);
        if (retry.replayed) {
          return await this.snapshotAt(
            command.projectId,
            retry.event.workspaceRevision,
          );
        }
        throw new ProjectSourceWorkspaceError(
          "stale_revision",
          `Workspace expected revision ${command.expectedWorkspaceRevision}, current is ${latest.workspaceRevision}.`,
        );
      }
      throw cause;
    }
    return await this.snapshotAt(
      command.projectId,
      transition.event.workspaceRevision,
    );
  }

  private async snapshotAt(
    projectId: string,
    workspaceRevision: number,
  ): Promise<ProjectSourceWorkspaceSnapshot> {
    const state = await this.#workspace.loadAt(projectId, workspaceRevision);
    return projectSourceWorkspaceSnapshot(state);
  }

  private async loadRevision(
    projectId: string,
    workspaceRevision: number,
  ): Promise<ProjectSourceWorkspaceState> {
    return await this.#workspace.loadAt(projectId, workspaceRevision);
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new ProjectSourceWorkspaceApplicationError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
  }
}

export type ProjectSourceWorkspaceApplicationErrorCode = "project_not_found";

export class ProjectSourceWorkspaceApplicationError extends Error {
  constructor(
    readonly code: ProjectSourceWorkspaceApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceWorkspaceApplicationError";
  }
}
