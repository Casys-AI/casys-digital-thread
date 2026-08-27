/**
 * Closed Workbench contract for the product-navigation GET/SSE slice.
 *
 * The application product-navigation port keeps its use-case read model and
 * MCP response DTOs inward. The Workbench consumes this bounded projection at
 * server composition, so presentation has no dependency on that port.
 */

import type {
  ProductStructureElementRef,
  ProductStructureOccurrenceRef,
} from "../../../domain/architecture/product-structure-ref.ts";

export const PRODUCT_NAVIGATION_QUERY_SCHEMA = "product-navigation-query/2.0" as const;

export type ProductNavigationStatus =
  | "observed"
  | "unavailable"
  | "unattached"
  | "unresolved";

export interface ProductNavigationBasis {
  projectId: string;
  threadSnapshotId: string;
  threadRevision: number;
  threadSubjectId: string;
  architectureArtifactId: string;
  architectureFingerprint: string;
  captureSchema: "architecture-capture/4.0";
}

export interface ProductNavigationNode {
  element: ProductStructureElementRef;
  occurrence?: ProductStructureOccurrenceRef;
  typedDefinition?: ProductStructureElementRef;
  label: string;
  expandable: boolean;
}

export interface ProductNavigationAttachment {
  group: "sources" | "geometry" | "physics" | "requirements";
  kind: "source-file" | "artifact" | "requirement";
  id: string;
  label: string;
}

export interface ProductNavigationAttachments {
  sources: ProductNavigationAttachment[];
  geometry: ProductNavigationAttachment[];
  physics: ProductNavigationAttachment[];
  requirements: ProductNavigationAttachment[];
}

/**
 * Workbench packaging of roots plus the unique-root neighborhood. It is not a
 * product-tree dump or a command contract.
 */
export interface ProductNavigationProjection {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  roots: ProductNavigationNode[];
  children: ProductNavigationNode[];
  attachments: ProductNavigationAttachments;
}
