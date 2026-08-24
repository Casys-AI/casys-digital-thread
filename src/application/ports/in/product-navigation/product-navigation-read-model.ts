/**
 * Provider-neutral product-navigation read model.
 *
 * MCP tools and the Workbench GET/SSE projection consume these types. This is
 * not product authority: exact architecture-capture/4.0 remains the basis.
 */

import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";

export const THREAD_PRODUCT_NAVIGATION_SCHEMA =
  "thread-product-navigation/1.0" as const;

export const PRODUCT_NAVIGATION_QUERY_SCHEMA = "product-navigation-query/1.0" as const;

export type ProductNavigationStatus =
  | "observed"
  | "unavailable"
  | "unattached"
  | "unresolved";

export interface ProductNavigationBasis {
  projectId: string;
  threadSnapshotId: string;
  threadRevision: number;
  architectureArtifactId: string;
  architectureFingerprint: string;
  captureSchema: "architecture-capture/4.0";
}

export interface ProductNavigationNode {
  kind: "part-definition" | "part-usage";
  id: string;
  label: string;
  definitionId: string;
  usageId?: string;
  path: string[];
  expandable: boolean;
}

export interface ProductNavigationNodeQuery {
  readonly kind: "part-definition" | "part-usage";
  readonly id: string;
  readonly path?: readonly string[];
}

export interface ProductNavigationScope {
  readonly projectId: string;
  /** Workbench-bound snapshot. MCP omits this; the server selects the current tip. */
  readonly snapshot?: ThreadSnapshot;
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

export interface ProductNavigationRoots {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  roots: ProductNavigationNode[];
}

export interface ProductNavigationChildren {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  parent: ProductNavigationNode;
  children: ProductNavigationNode[];
}

export interface ProductNavigationPath {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  nodes: ProductNavigationNode[];
}

export interface ProductNavigationContext {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  node: ProductNavigationNode;
  attachments: ProductNavigationAttachments;
}

export interface ProductNavigationSourceClosureFile {
  fileId: string;
  fileRevision: number;
  role: string;
  resourceUri: string;
  resourceFingerprint: string;
}

export interface ProductNavigationSourceClosureEdge {
  from: { fileId: string; fileRevision: number };
  to: { fileId: string; fileRevision: number };
}

export interface ProductNavigationSourceClosure {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  workspaceRevision?: number;
  workspaceEventFingerprint?: string;
  files: ProductNavigationSourceClosureFile[];
  edges: ProductNavigationSourceClosureEdge[];
}

export interface ProductNavigationSearch {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  matches: ProductNavigationNode[];
}

export interface ProductNavigationNeighborhood {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  node: ProductNavigationNode;
  parent?: ProductNavigationNode;
  siblings: ProductNavigationNode[];
  children: ProductNavigationNode[];
}

/**
 * Workbench GET/SSE packaging of roots plus the unique-root neighborhood.
 * Not a dump of the product tree.
 */
export interface ProductNavigationProjection {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  roots: ProductNavigationNode[];
  children: ProductNavigationNode[];
  attachments: ProductNavigationAttachments;
}

export interface ProductNavigationAttachmentGraph {
  readonly nodes: readonly {
    readonly ref: { readonly kind: string; readonly id: string };
    readonly label: string;
  }[];
  readonly edges: readonly {
    readonly relation: string;
    readonly from: { readonly kind: string; readonly id: string };
    readonly to: { readonly kind: string; readonly id: string };
  }[];
}

export function emptyAttachments(): ProductNavigationAttachments {
  return {
    sources: [],
    geometry: [],
    physics: [],
    requirements: [],
  };
}

export function unavailableProductNavigationRoots(): ProductNavigationRoots {
  return {
    schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
    status: "unavailable",
    roots: [],
  };
}

export function unavailableProductNavigationProjection(): ProductNavigationProjection {
  return {
    schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
    status: "unavailable",
    roots: [],
    children: [],
    attachments: emptyAttachments(),
  };
}

export function attachmentsForDefinition(
  graph: ProductNavigationAttachmentGraph,
  definitionId: string,
  sourceFileIds?: ReadonlySet<string> | readonly string[],
): ProductNavigationAttachments {
  const allowed = sourceFileIds === undefined
    ? undefined
    : sourceFileIds instanceof Set
    ? sourceFileIds
    : new Set(sourceFileIds);
  const from = `part-definition:${definitionId}`;
  const attachments = emptyAttachments();
  for (const edge of graph.edges) {
    if (`${edge.from.kind}:${edge.from.id}` !== from) continue;
    const node = graph.nodes.find((item) =>
      item.ref.kind === edge.to.kind && item.ref.id === edge.to.id
    );
    const label = node?.label ?? edge.to.id;
    if (edge.relation === "represented_by" && edge.to.kind === "source-file") {
      if (allowed && !allowed.has(edge.to.id)) continue;
      attachments.sources.push({
        group: "sources",
        kind: "source-file",
        id: edge.to.id,
        label,
      });
    } else if (
      edge.relation === "represented_by" && edge.to.kind === "artifact"
    ) {
      attachments.geometry.push({
        group: "geometry",
        kind: "artifact",
        id: edge.to.id,
        label,
      });
    } else if (edge.relation === "verified_by") {
      attachments.physics.push({
        group: "physics",
        kind: "artifact",
        id: edge.to.id,
        label,
      });
    } else if (edge.relation === "constrained_by") {
      attachments.requirements.push({
        group: "requirements",
        kind: "requirement",
        id: edge.to.id,
        label,
      });
    }
  }
  return attachments;
}
