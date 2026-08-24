/**
 * Generic project source workspace: draft file identities, not product evidence.
 *
 * No provider, tool, runtime, image or path authority is representable. An
 * optional capture request is caller-authored registered-profile identity
 * only (`profileId`). `fileId` is the sole stable technical source id.
 */

import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA =
  "project-source-workspace-event/3.0" as const;
export const PROJECT_SOURCE_WORKSPACE_SNAPSHOT_SCHEMA =
  "project-source-workspace-snapshot/2.0" as const;
export const PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA =
  "architecture-capture/4.0" as const;
export const PROJECT_SOURCE_ATTACHMENT_ELEMENT_KINDS = [
  "PartDefinition",
  "PartUsage",
] as const;

export const PROJECT_SOURCE_WORKSPACE_BOUNDS = Object.freeze({
  maxSlugLength: 64,
  maxLogicalNameLength: 128,
  maxDisplayNameLength: 128,
  maxDerivedPathLength: 1024,
  maxModuleDepth: 16,
  maxDependencyFanout: 32,
  maxMutationJsonBytes: 65_536,
  maxPageSize: 50,
  defaultPageSize: 20,
  maxFilterLength: 256,
  maxCursorLength: 4_096,
});

export type ProjectSourceWorkspaceErrorCode =
  | "invalid_request"
  | "stale_revision"
  | "mutation_id_conflict"
  | "predecessor_mismatch"
  | "branch_ambiguity"
  | "path_collision"
  | "module_cycle"
  | "dependency_cycle"
  | "module_not_found"
  | "file_not_found"
  | "attachment_not_found"
  | "duplicate_attachment"
  | "file_id_mismatch"
  | "revision_not_found"
  | "cursor_mismatch"
  | "bound_exceeded"
  | "event_fingerprint_mismatch"
  | "event_sequence_mismatch"
  | "event_chain_mismatch";

export class ProjectSourceWorkspaceError extends Error {
  constructor(
    readonly code: ProjectSourceWorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceWorkspaceError";
  }
}

/**
 * Caller-authored requested parser/policy identity. Grants nothing until
 * technical capture resolves it fail-closed against the registry. `fileId`
 * is the sole stable technical source id inside one project.
 */
export interface ProjectSourceCaptureRequest {
  readonly profileId: string;
}

export interface ProjectSourceFileRevisionRef {
  readonly fileId: string;
  readonly fileRevision: number;
}

export interface ProjectSourceModule {
  readonly moduleId: string;
  readonly parentModuleId?: string;
  readonly slug: string;
  readonly displayName: string;
  readonly domain?: string;
}

export interface ProjectSourceModulePut {
  readonly kind: "module_put";
  readonly moduleId: string;
  readonly parentModuleId?: string;
  readonly slug: string;
  readonly displayName: string;
  readonly domain?: string;
}

export interface ProjectSourceFilePut {
  readonly kind: "file_put";
  readonly fileId: string;
  readonly predecessorFileRevision?: number;
  readonly moduleId: string;
  readonly logicalName: string;
  readonly role: string;
  readonly dependencies: readonly ProjectSourceFileRevisionRef[];
  readonly captureRequest?: ProjectSourceCaptureRequest;
  readonly resourceRef: AgentResourceReference;
}

export interface ProjectSourceFileRemove {
  readonly kind: "file_remove";
  readonly fileId: string;
  readonly activeFileRevision: number;
}

export type ProjectSourceAttachmentElementKind =
  typeof PROJECT_SOURCE_ATTACHMENT_ELEMENT_KINDS[number];

/** Product-relation role. Distinct from the file capture role. */
export interface ProjectSourceAttachmentRole {
  readonly id: string;
  readonly version: number;
}

export interface ProjectSourceAttachmentTarget {
  readonly elementId: string;
  readonly elementKind: ProjectSourceAttachmentElementKind;
}

export interface ProjectSourceAttachmentThreadBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface ProjectSourceAttachmentArchitectureBasis {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly captureSchema: typeof PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA;
}

export interface ProjectSourceAttachmentDeclaredAgainst {
  readonly thread: ProjectSourceAttachmentThreadBasis;
  readonly architecture: ProjectSourceAttachmentArchitectureBasis;
}

export interface ProjectSourceAttachmentPut {
  readonly kind: "attachment_put";
  readonly attachmentId: string;
  readonly predecessorAttachmentRevision?: number;
  readonly fileId: string;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
}

export interface ProjectSourceAttachmentDetach {
  readonly kind: "attachment_detach";
  readonly attachmentId: string;
  readonly activeAttachmentRevision: number;
}

export type ProjectSourceWorkspaceMutation =
  | ProjectSourceModulePut
  | ProjectSourceFilePut
  | ProjectSourceFileRemove
  | ProjectSourceAttachmentPut
  | ProjectSourceAttachmentDetach;

export interface ProjectSourceWorkspaceCommand {
  readonly projectId: string;
  readonly mutationId: string;
  readonly expectedWorkspaceRevision: number;
  readonly mutation: ProjectSourceWorkspaceMutation;
}

export interface ProjectSourceFileRevision {
  readonly kind: "content";
  readonly fileId: string;
  readonly fileRevision: number;
  readonly predecessorFileRevision?: number;
  readonly resourceRef: AgentResourceReference;
  readonly moduleId: string;
  readonly logicalName: string;
  readonly role: string;
  readonly captureRequest?: ProjectSourceCaptureRequest;
  readonly dependencies: readonly ProjectSourceFileRevisionRef[];
  readonly fingerprint: ContentFingerprint;
}

export interface ProjectSourceFileTombstone {
  readonly kind: "tombstone";
  readonly fileId: string;
  readonly fileRevision: number;
  readonly predecessorFileRevision: number;
  readonly fingerprint: ContentFingerprint;
}

export type ProjectSourceFileRevisionRecord =
  | ProjectSourceFileRevision
  | ProjectSourceFileTombstone;

export interface ProjectSourceFileRecord {
  readonly fileId: string;
  readonly headRevision: number;
  readonly status: "active" | "removed";
  readonly revisions: ReadonlyMap<number, ProjectSourceFileRevisionRecord>;
}

export interface ProjectSourceAttachmentRevision {
  readonly kind: "content";
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly predecessorAttachmentRevision?: number;
  readonly fileId: string;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  readonly fingerprint: ContentFingerprint;
}

export interface ProjectSourceAttachmentTombstone {
  readonly kind: "tombstone";
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly predecessorAttachmentRevision: number;
  readonly fingerprint: ContentFingerprint;
}

export type ProjectSourceAttachmentRevisionRecord =
  | ProjectSourceAttachmentRevision
  | ProjectSourceAttachmentTombstone;

export interface ProjectSourceAttachmentRecord {
  readonly attachmentId: string;
  readonly fileId: string;
  readonly headRevision: number;
  readonly status: "active" | "detached";
  readonly revisions: ReadonlyMap<number, ProjectSourceAttachmentRevisionRecord>;
}

export type ProjectSourceAttachmentSourceStatus = "active" | "source-removed";

export interface ProjectSourceMutationAck {
  readonly mutationId: string;
  readonly commandFingerprint: ContentFingerprint;
  readonly event: ProjectSourceWorkspaceEvent;
}

export interface ProjectSourceWorkspaceEvent {
  readonly schemaVersion: typeof PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA;
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly previousWorkspaceRevision: number;
  readonly previousEventFingerprint: ContentFingerprint | null;
  readonly mutationId: string;
  readonly mutation: ProjectSourceWorkspaceMutation;
  readonly fingerprint: ContentFingerprint;
}

export interface ProjectSourceWorkspaceState {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly lastEventFingerprint?: ContentFingerprint;
  readonly modules: ReadonlyMap<string, ProjectSourceModule>;
  readonly files: ReadonlyMap<string, ProjectSourceFileRecord>;
  readonly attachments: ReadonlyMap<string, ProjectSourceAttachmentRecord>;
  readonly mutations: ReadonlyMap<string, ProjectSourceMutationAck>;
}

export interface ProjectSourceWorkspaceTransition {
  readonly state: ProjectSourceWorkspaceState;
  readonly event: ProjectSourceWorkspaceEvent;
  readonly replayed: boolean;
}

export interface ProjectSourceWorkspaceSnapshot {
  readonly schemaVersion: typeof PROJECT_SOURCE_WORKSPACE_SNAPSHOT_SCHEMA;
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly lastEventFingerprint: ContentFingerprint | null;
  readonly rootModuleIds: readonly string[];
  readonly moduleCount: number;
  readonly activeFileCount: number;
  readonly activeAttachmentCount: number;
  readonly grants: "none";
}

export interface ProjectSourceTreeQuery {
  readonly workspaceRevision: number;
  readonly moduleId?: string;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProjectSourceSearchQuery {
  readonly workspaceRevision: number;
  readonly pathPrefix?: string;
  readonly moduleId?: string;
  readonly domain?: string;
  readonly role?: string;
  readonly profileId?: string;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProjectSourceFileReadQuery {
  readonly workspaceRevision: number;
  readonly fileId: string;
  readonly fileRevision: number;
}

export interface ProjectSourceAttachmentReadQuery {
  readonly workspaceRevision: number;
  readonly attachmentId: string;
  readonly attachmentRevision: number;
}

export interface ProjectSourceAttachmentListQuery {
  readonly workspaceRevision: number;
  readonly fileId?: string;
  readonly target?: ProjectSourceAttachmentTarget;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProjectSourceTreeEntry {
  readonly kind: "module" | "file";
  readonly id: string;
  readonly name: string;
  readonly derivedPath: string;
  readonly domain?: string;
  readonly role?: string;
  readonly fileRevision?: number;
}

export interface ProjectSourcePage<T> {
  readonly workspaceRevision: number;
  readonly entries: readonly T[];
  readonly nextCursor: string | null;
  readonly grants: "none";
}

export interface ProjectSourceSearchHit {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly moduleId: string;
  readonly logicalName: string;
  readonly derivedPath: string;
  readonly role: string;
  readonly domain?: string;
  readonly captureRequest?: ProjectSourceCaptureRequest;
  readonly fingerprint: ContentFingerprint;
}

export interface ProjectSourceFileRead {
  readonly workspaceRevision: number;
  readonly derivedPath: string | null;
  readonly record: ProjectSourceFileRevisionRecord;
  readonly grants: "none";
}

export interface ProjectSourceAttachmentRead {
  readonly workspaceRevision: number;
  readonly fileId: string;
  readonly fileHeadRevision: number | null;
  readonly sourceStatus: ProjectSourceAttachmentSourceStatus;
  readonly record: ProjectSourceAttachmentRevisionRecord;
  readonly grants: "none";
}

export interface ProjectSourceAttachmentListEntry {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly fileId: string;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  readonly fingerprint: ContentFingerprint;
  readonly fileHeadRevision: number | null;
  readonly sourceStatus: ProjectSourceAttachmentSourceStatus;
}
