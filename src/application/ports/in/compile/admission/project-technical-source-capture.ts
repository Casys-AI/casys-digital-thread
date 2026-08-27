/**
 * Inward port for capturing one exact workspace attachment head.
 *
 * The MCP surface names only projectId, workspaceRevision, attachmentId and
 * attachmentRevision. The server resolves the root file, registered profile,
 * dependency closure and resource bytes. Callers cannot name fileId,
 * fileRevision, profileId, sourceText or resourceRef.
 *
 * The use case returns a review envelope. Compilation preview accepts only
 * `review.reference`, never the whole review or the capture document.
 */

import type { TechnicalSourceCaptureReview } from "../../../../../domain/compile/admission/technical-source-capture-review.ts";

export interface ProjectTechnicalSourceCaptureCommand {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly attachmentId: string;
  readonly attachmentRevision: number;
}

export type ProjectTechnicalSourceCaptureErrorCode =
  | "invalid_request"
  | "workspace_revision_not_found"
  | "workspace_integrity_failed"
  | "attachment_not_found"
  | "attachment_not_active"
  | "attachment_revision_not_head"
  | "source_removed"
  | "file_not_found"
  | "file_revision_not_active"
  | "capture_request_missing"
  | "profile_not_registered"
  | "role_catalog_rejected"
  | "closure_unresolved"
  | "resource_reopen_failed"
  | "source_size_limit_exceeded"
  | "analysis_rejected"
  | "closure_persist_failed"
  | "closure_integrity_failed"
  | "locator_persist_failed"
  | "locator_integrity_failed";

export class ProjectTechnicalSourceCaptureError extends Error {
  constructor(
    readonly code: ProjectTechnicalSourceCaptureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectTechnicalSourceCaptureError";
  }
}

export interface ProjectTechnicalSourceCaptureUseCase {
  capture(
    command: ProjectTechnicalSourceCaptureCommand,
  ): Promise<TechnicalSourceCaptureReview>;
}
