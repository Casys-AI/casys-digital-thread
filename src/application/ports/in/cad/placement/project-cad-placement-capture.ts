/**
 * Inward port for capturing one exact workspace placement attachment set.
 *
 * The MCP surface names only projectId, workspaceRevision, attachmentId and
 * attachmentRevision. The server reopens the same-file active heads and
 * recrosses immediate PartUsage coverage. Callers cannot name fileId,
 * source text, transforms or a resource tuple.
 */

import type { CadPlacementCaptureReview } from "../../../../../domain/cad/placement/cad-placement-capture-review.ts";

export interface ProjectCadPlacementCaptureCommand {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly attachmentId: string;
  readonly attachmentRevision: number;
}

export type ProjectCadPlacementCaptureErrorCode =
  | "invalid_request"
  | "workspace_revision_not_found"
  | "workspace_integrity_failed"
  | "attachment_not_found"
  | "attachment_not_active"
  | "attachment_revision_not_head"
  | "source_removed"
  | "file_not_found"
  | "file_revision_not_active"
  | "file_role_rejected"
  | "named_attachment_not_placement"
  | "resource_reopen_failed"
  | "source_size_limit_exceeded"
  | "source_parse_failed"
  | "source_persist_failed"
  | "architecture_reopen_failed"
  | "locator_persist_failed"
  | "locator_integrity_failed";

export class ProjectCadPlacementCaptureError extends Error {
  constructor(
    readonly code: ProjectCadPlacementCaptureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectCadPlacementCaptureError";
  }
}

export interface ProjectCadPlacementCaptureUseCase {
  capture(
    command: unknown,
  ): Promise<CadPlacementCaptureReview>;
}
