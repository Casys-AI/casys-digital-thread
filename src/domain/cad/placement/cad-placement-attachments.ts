/**
 * Exact same-file active placement-attachment resolution.
 *
 * Reads a workspace snapshot. It does not mutate ProjectSourceWorkspace or
 * invent an attachment role. Placement edges stay `design-source@1` onto
 * exact PartUsage identities of one `cad-placement-source` file.
 */

import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  ProjectSourceAttachmentDeclaredAgainst,
  ProjectSourceAttachmentRevision,
  ProjectSourceFileRevision,
  ProjectSourceWorkspaceState,
} from "../../project-source-workspace/types.ts";
import { CAD_PLACEMENT_SOURCE_FILE_ROLE } from "./cad-immediate-placement-source.ts";

export const CAD_PLACEMENT_ATTACHMENT_ROLE_ID = "design-source" as const;
export const CAD_PLACEMENT_ATTACHMENT_ROLE_VERSION = 1 as const;

export type CadPlacementAttachmentErrorCode =
  | "attachment_not_found"
  | "attachment_not_active"
  | "attachment_revision_not_head"
  | "source_removed"
  | "file_not_found"
  | "file_revision_not_active"
  | "file_role_rejected"
  | "named_attachment_not_placement";

export class CadPlacementAttachmentError extends Error {
  constructor(
    readonly code: CadPlacementAttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CadPlacementAttachmentError";
  }
}

export interface CadPlacementSameFileResolution {
  readonly file: ProjectSourceFileRevision;
  readonly named: ProjectSourceAttachmentRevision;
  readonly attachments: readonly ProjectSourceAttachmentRevision[];
}

export function isCadPlacementAttachment(
  attachment: ProjectSourceAttachmentRevision,
): boolean {
  return attachment.role.id === CAD_PLACEMENT_ATTACHMENT_ROLE_ID &&
    attachment.role.version === CAD_PLACEMENT_ATTACHMENT_ROLE_VERSION &&
    attachment.target.elementKind === "PartUsage";
}

export function requireSameFileActivePlacementAttachments(
  state: ProjectSourceWorkspaceState,
  named: {
    readonly attachmentId: string;
    readonly attachmentRevision: number;
  },
): CadPlacementSameFileResolution {
  const record = state.attachments.get(named.attachmentId);
  if (!record) {
    throw new CadPlacementAttachmentError(
      "attachment_not_found",
      `Attachment ${named.attachmentId} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  const revision = record.revisions.get(named.attachmentRevision);
  if (!revision) {
    throw new CadPlacementAttachmentError(
      "attachment_not_found",
      `Attachment ${named.attachmentId}@${named.attachmentRevision} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (record.status === "detached" || revision.kind !== "content") {
    throw new CadPlacementAttachmentError(
      "attachment_not_active",
      `Attachment ${named.attachmentId}@${named.attachmentRevision} is not an active head.`,
    );
  }
  if (record.headRevision !== named.attachmentRevision) {
    throw new CadPlacementAttachmentError(
      "attachment_revision_not_head",
      `Attachment ${named.attachmentId}@${named.attachmentRevision} is not the unique active head.`,
    );
  }
  const fileRecord = state.files.get(revision.fileId);
  if (!fileRecord) {
    throw new CadPlacementAttachmentError(
      "file_not_found",
      `File ${revision.fileId} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  const file = fileRecord.revisions.get(fileRecord.headRevision);
  if (!file || file.kind !== "content") {
    throw new CadPlacementAttachmentError(
      "source_removed",
      `Attachment ${named.attachmentId} source file is not an active content head.`,
    );
  }
  if (
    fileRecord.status !== "active" ||
    file.fileRevision !== fileRecord.headRevision
  ) {
    throw new CadPlacementAttachmentError(
      "file_revision_not_active",
      `File ${revision.fileId} is not the active content revision in workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (file.role !== CAD_PLACEMENT_SOURCE_FILE_ROLE) {
    throw new CadPlacementAttachmentError(
      "file_role_rejected",
      `File ${file.fileId} role must be ${CAD_PLACEMENT_SOURCE_FILE_ROLE}.`,
    );
  }
  if (!isCadPlacementAttachment(revision)) {
    throw new CadPlacementAttachmentError(
      "named_attachment_not_placement",
      `Attachment ${named.attachmentId} must be design-source@1 onto an exact PartUsage.`,
    );
  }
  const attachments = [...state.attachments.values()]
    .filter((item) => item.status === "active")
    .map((item) => item.revisions.get(item.headRevision))
    .filter((item): item is ProjectSourceAttachmentRevision =>
      item !== undefined &&
      item.kind === "content" &&
      item.fileId === file.fileId &&
      isCadPlacementAttachment(item)
    )
    .sort((left, right) => left.attachmentId.localeCompare(right.attachmentId));
  if (
    !attachments.some((item) =>
      item.attachmentId === named.attachmentId &&
      item.attachmentRevision === named.attachmentRevision
    )
  ) {
    throw new CadPlacementAttachmentError(
      "named_attachment_not_placement",
      `Named attachment ${named.attachmentId} is not among the active same-file placement attachments.`,
    );
  }
  return {
    file,
    named: revision,
    attachments,
  };
}

export function placementAttachmentsShareDeclaredAgainst(
  attachments: readonly ProjectSourceAttachmentRevision[],
): boolean {
  const first = attachments[0];
  if (!first) return false;
  return attachments.every((item) =>
    declaredAgainstEqual(item.declaredAgainst, first.declaredAgainst)
  );
}

export function declaredAgainstEqual(
  left: ProjectSourceAttachmentDeclaredAgainst,
  right: ProjectSourceAttachmentDeclaredAgainst,
): boolean {
  return left.thread.snapshotId === right.thread.snapshotId &&
    left.thread.revision === right.thread.revision &&
    left.thread.subjectId === right.thread.subjectId &&
    left.architecture.artifactId === right.architecture.artifactId &&
    left.architecture.captureSchema === right.architecture.captureSchema &&
    fingerprintsEqual(
      left.architecture.fingerprint,
      right.architecture.fingerprint,
    );
}

export function attachmentFingerprintsEqual(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return fingerprintsEqual(left, right);
}
