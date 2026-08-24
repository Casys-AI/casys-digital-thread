/**
 * Outbound facts for product-navigation Thread/admission evidence.
 *
 * Adapters reopen exact Thread evidence. Grouping stays in the application
 * read model. The reader never selects a provider or runtime. This is not
 * the ProjectSourceWorkspace authoring-attachment reader.
 */

import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { ProductNavigationAttachmentGraph } from "../../in/product-navigation/product-navigation-read-model.ts";

export interface ProductNavigationAttachedSourceFile {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly workspaceRevision: number;
}

export interface ProductNavigationEvidenceAttachmentFacts
  extends ProductNavigationAttachmentGraph {
  readonly sourceFileIds?: readonly string[];
  readonly sourceFiles?: readonly ProductNavigationAttachedSourceFile[];
}

export interface ProductNavigationEvidenceAttachmentReader {
  read(
    snapshot: ThreadSnapshot,
    context: { readonly projectId: string },
  ): Promise<ProductNavigationEvidenceAttachmentFacts | undefined>;
}
