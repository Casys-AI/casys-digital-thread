/**
 * Project-scoped workspace mutations and revision-anchored reads.
 *
 * EngineeringProject must already exist. File puts reopen the exact
 * AgentResourceReference before the aggregate accepts the revision.
 * Attachment puts recross the current Thread tip and architecture-capture/4.0
 * unless the mutation id is already accepted.
 */

import type { ProjectSourceWorkspaceUseCase } from "../../ports/in/project-source-workspace/project-source-workspace.ts";
import type { AgentResourceExactReopener } from "../../ports/out/resource/agent-resource-exact-reopener.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  ProjectSourceWorkspaceStoreError,
} from "../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { ProjectSourceAttachmentRoleCatalog } from "../../ports/out/project-source-workspace/project-source-attachment-role-catalog.ts";
import type {
  ProductStructureTraversal,
} from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import {
  applyProjectSourceWorkspaceCommand,
} from "../../../domain/project-source-workspace/transitions.ts";
import {
  projectSourceWorkspaceAttachmentList,
  projectSourceWorkspaceAttachmentRead,
  projectSourceWorkspaceFileRead,
  projectSourceWorkspaceSearchPage,
  projectSourceWorkspaceSnapshot,
  projectSourceWorkspaceTreePage,
} from "../../../domain/project-source-workspace/reads.ts";
import {
  type ProjectSourceAttachmentListEntry,
  type ProjectSourceAttachmentPut,
  type ProjectSourceAttachmentRead,
  type ProjectSourceFileRead,
  type ProjectSourcePage,
  type ProjectSourceSearchHit,
  type ProjectSourceTreeEntry,
  type ProjectSourceWorkspaceCommand,
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceSnapshot,
  type ProjectSourceWorkspaceState,
} from "../../../domain/project-source-workspace/types.ts";
import {
  parseAttachmentListQuery,
  parseAttachmentReadQuery,
  parseFileReadQuery,
  parseSearchQuery,
  parseSnapshotQuery,
  parseTreeQuery,
  parseWorkspaceCommand,
} from "../../../domain/project-source-workspace/validation.ts";

export interface ProjectExistenceReader {
  get(projectId: string): Promise<unknown>;
}

export interface ProjectSourceWorkspaceUseCasesDependencies {
  readonly projects: ProjectExistenceReader;
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: AgentResourceExactReopener;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly traversal: ProductStructureTraversal;
  readonly roles: ProjectSourceAttachmentRoleCatalog;
}

export class ProjectSourceWorkspaceUseCases implements ProjectSourceWorkspaceUseCase {
  readonly #projects: ProjectExistenceReader;
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: AgentResourceExactReopener;
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #traversal: ProductStructureTraversal;
  readonly #roles: ProjectSourceAttachmentRoleCatalog;

  constructor(dependencies: ProjectSourceWorkspaceUseCasesDependencies) {
    this.#projects = dependencies.projects;
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
    this.#snapshots = dependencies.snapshots;
    this.#traversal = dependencies.traversal;
    this.#roles = dependencies.roles;
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

  async putAttachment(value: unknown): Promise<ProjectSourceWorkspaceSnapshot> {
    const command = parseWorkspaceCommand(value);
    if (command.mutation.kind !== "attachment_put") {
      throw new ProjectSourceWorkspaceError(
        "invalid_request",
        "This command accepts only attachment_put mutations.",
      );
    }
    const current = await this.#workspace.load(command.projectId);
    if (current.mutations.has(command.mutationId)) {
      const replayed = await applyProjectSourceWorkspaceCommand(current, command);
      return await this.snapshotAt(
        command.projectId,
        replayed.event.workspaceRevision,
      );
    }
    await this.recrossAttachmentPut(command.projectId, command.mutation);
    const state = await this.#workspace.load(command.projectId);
    return await this.commit(state, command);
  }

  async detachAttachment(value: unknown): Promise<ProjectSourceWorkspaceSnapshot> {
    return await this.mutate(value, "attachment_detach");
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

  async readAttachment(value: unknown): Promise<ProjectSourceAttachmentRead> {
    const query = parseAttachmentReadQuery(value);
    await this.requireProject(query.projectId);
    const state = await this.loadRevision(query.projectId, query.workspaceRevision);
    return projectSourceWorkspaceAttachmentRead(state, query);
  }

  async listAttachments(
    value: unknown,
  ): Promise<ProjectSourcePage<ProjectSourceAttachmentListEntry>> {
    const query = parseAttachmentListQuery(value);
    await this.requireProject(query.projectId);
    const state = await this.loadRevision(query.projectId, query.workspaceRevision);
    return projectSourceWorkspaceAttachmentList(state, query);
  }

  private async mutate(
    value: unknown,
    kind:
      | "module_put"
      | "file_put"
      | "file_remove"
      | "attachment_detach",
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
    return await this.commit(state, command);
  }

  private async commit(
    state: ProjectSourceWorkspaceState,
    command: ProjectSourceWorkspaceCommand,
  ): Promise<ProjectSourceWorkspaceSnapshot> {
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

  private async recrossAttachmentPut(
    projectId: string,
    mutation: ProjectSourceAttachmentPut,
  ): Promise<void> {
    const project = await this.requireExactProject(projectId);
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      throw new ProjectSourceWorkspaceApplicationError(
        "thread_tip_unresolved",
        tip.diagnostic.message,
      );
    }
    const declaredThread = mutation.declaredAgainst.thread;
    if (
      declaredThread.snapshotId !== tip.basis.snapshotId ||
      declaredThread.revision !== tip.basis.revision ||
      declaredThread.subjectId !== tip.basis.subjectId
    ) {
      throw new ProjectSourceWorkspaceApplicationError(
        "declared_against_mismatch",
        "declaredAgainst.thread must equal the unique current Thread tip.",
      );
    }
    const snapshot = await this.#snapshots.get(declaredThread.snapshotId);
    if (
      !snapshot ||
      snapshot.id !== declaredThread.snapshotId ||
      snapshot.revision !== declaredThread.revision ||
      snapshot.subject.id !== declaredThread.subjectId
    ) {
      throw new ProjectSourceWorkspaceApplicationError(
        "thread_snapshot_mismatch",
        "Thread snapshot recross does not match declaredAgainst.thread.",
      );
    }
    const opened = await this.#traversal.open(snapshot);
    const architecture = mutation.declaredAgainst.architecture;
    if (
      !opened ||
      opened.architectureArtifactId !== architecture.artifactId ||
      !fingerprintsEqual(
        opened.architectureFingerprint,
        architecture.fingerprint,
      )
    ) {
      throw new ProjectSourceWorkspaceApplicationError(
        "architecture_mismatch",
        "Architecture recross does not match declaredAgainst.architecture on architecture-capture/4.0.",
      );
    }
    if (
      !opened.hasElement({
        id: mutation.target.elementId,
        kind: mutation.target.elementKind,
      })
    ) {
      throw new ProjectSourceWorkspaceApplicationError(
        "target_not_found",
        `Target ${mutation.target.elementKind} ${mutation.target.elementId} is not present on the recrossed architecture capture.`,
      );
    }
    if (!this.#roles.accept(mutation.role, mutation.target)) {
      throw new ProjectSourceWorkspaceApplicationError(
        "role_not_accepted",
        `Attachment role ${mutation.role.id}@${mutation.role.version} is not accepted for ${mutation.target.elementKind}.`,
      );
    }
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

  private async requireExactProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!isExactEngineeringProject(project, projectId)) {
      throw new ProjectSourceWorkspaceApplicationError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

function isExactEngineeringProject(
  value: unknown,
  projectId: string,
): value is EngineeringProjectSnapshot {
  if (value === null || typeof value !== "object") return false;
  const rec = value as EngineeringProjectSnapshot;
  return rec.project?.id === projectId && Array.isArray(rec.threadSnapshots);
}

export type ProjectSourceWorkspaceApplicationErrorCode =
  | "project_not_found"
  | "thread_tip_unresolved"
  | "declared_against_mismatch"
  | "thread_snapshot_mismatch"
  | "architecture_mismatch"
  | "target_not_found"
  | "role_not_accepted";

export class ProjectSourceWorkspaceApplicationError extends Error {
  constructor(
    readonly code: ProjectSourceWorkspaceApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceWorkspaceApplicationError";
  }
}
