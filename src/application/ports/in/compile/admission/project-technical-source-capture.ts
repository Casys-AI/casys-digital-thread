/**
 * Inward port for capturing one exact workspace file revision.
 *
 * The MCP surface names only projectId, workspaceRevision, fileId and
 * fileRevision. Profile, role, resource bytes, parser and CAS persistence
 * stay behind this provider-free port.
 *
 * The use case returns a review envelope. Compilation preview accepts only
 * `review.reference`, never the whole review or the capture document.
 */

import type { TechnicalSourceCaptureReview } from "../../../../../domain/compile/admission/technical-source-capture-review.ts";

export interface ProjectTechnicalSourceCaptureCommand {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly fileId: string;
  readonly fileRevision: number;
}

export type ProjectTechnicalSourceCaptureErrorCode =
  | "invalid_request"
  | "workspace_revision_not_found"
  | "workspace_integrity_failed"
  | "file_not_found"
  | "file_revision_not_active"
  | "capture_request_missing"
  | "profile_not_registered"
  | "role_mismatch"
  | "resource_reopen_failed"
  | "source_size_limit_exceeded"
  | "analysis_rejected"
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
