/**
 * Project-scoped append-only workspace event log. The materialised index is
 * a replaceable read optimisation, not mutation authority.
 */

import type {
  ProjectSourceWorkspaceEventV4,
  ProjectSourceWorkspaceState,
} from "../../../../domain/project-source-workspace/types.ts";

export type ProjectSourceWorkspaceStoreErrorCode =
  | "cas_conflict"
  | "incomplete_claim"
  | "log_gap"
  | "corrupt_log";

export class ProjectSourceWorkspaceStoreError extends Error {
  constructor(
    readonly code: ProjectSourceWorkspaceStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceWorkspaceStoreError";
  }
}

export interface ProjectSourceWorkspaceEventStore {
  load(projectId: string): Promise<ProjectSourceWorkspaceState>;
  loadAt(
    projectId: string,
    workspaceRevision: number,
  ): Promise<ProjectSourceWorkspaceState>;
  /**
   * Authority read: ignore the in-memory index and directory census, then
   * fully replay the hash-chained V3/V4 event files through the named revision.
   * V3 is accepted here only as temporary historical input.
   */
  loadAtFresh(
    projectId: string,
    workspaceRevision: number,
  ): Promise<ProjectSourceWorkspaceState>;
  /** New workspace events are V4 only; V3 is replay-only. */
  append(event: ProjectSourceWorkspaceEventV4): Promise<void>;
}
