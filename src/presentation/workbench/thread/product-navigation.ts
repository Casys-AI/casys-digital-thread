/**
 * Presentation re-export of the application product-navigation read model.
 *
 * Workbench GET/SSE and the UI contract consume these types. Application owns
 * the DTOs and grouping semantics.
 */

export {
  attachmentsForDefinition,
  emptyAttachments,
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  THREAD_PRODUCT_NAVIGATION_SCHEMA,
  unavailableProductNavigationProjection,
  unavailableProductNavigationRoots,
} from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";
export type {
  ProductNavigationAttachment,
  ProductNavigationAttachmentGraph,
  ProductNavigationAttachments,
  ProductNavigationAuthoringAttachment,
  ProductNavigationAuthoringAttachments,
  ProductNavigationAuthoringBasisStatus,
  ProductNavigationBasis,
  ProductNavigationChildren,
  ProductNavigationContext,
  ProductNavigationNeighborhood,
  ProductNavigationNode,
  ProductNavigationNodeQuery,
  ProductNavigationPath,
  ProductNavigationProjection,
  ProductNavigationRoots,
  ProductNavigationScope,
  ProductNavigationSearch,
  ProductNavigationSourceClosure,
  ProductNavigationSourceClosureEdge,
  ProductNavigationSourceClosureFile,
  ProductNavigationStatus,
} from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";
