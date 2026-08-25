/**
 * Outbound facts for product-navigation authoring attachments.
 *
 * Reads active ProjectSourceWorkspace attachment heads for one exact SysML
 * target. Produces no Thread evidence, represented_by edge, or admission.
 * `cursorBinding` is an opaque application-owned digest of the opened
 * ProductNavigationBasis and exact inspect selection. The adapter HMAC-seals
 * it; it does not interpret Thread or occurrence fields.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  ProjectSourceAttachmentDeclaredAgainst,
  ProjectSourceAttachmentRole,
  ProjectSourceAttachmentSourceStatus,
  ProjectSourceAttachmentTarget,
} from "../../../../domain/project-source-workspace/types.ts";

export interface ProductNavigationAuthoringAttachmentQuery {
  readonly projectId: string;
  readonly target: ProjectSourceAttachmentTarget;
  /** Application-provided digest of the full inspect basis and selection. */
  readonly cursorBinding: string;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProductNavigationAuthoringAttachmentHead {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly fingerprint: ContentFingerprint;
  readonly fileId: string;
  readonly fileHeadRevision: number | null;
  readonly sourceStatus: ProjectSourceAttachmentSourceStatus;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
}

export interface ProductNavigationAuthoringAttachmentPage {
  readonly workspaceRevision: number;
  readonly workspaceEventFingerprint?: string;
  readonly attachments: readonly ProductNavigationAuthoringAttachmentHead[];
  readonly nextCursor: string | null;
}

export interface ProductNavigationAuthoringAttachmentReader {
  listActiveHeads(
    query: ProductNavigationAuthoringAttachmentQuery,
  ): Promise<ProductNavigationAuthoringAttachmentPage>;
}
