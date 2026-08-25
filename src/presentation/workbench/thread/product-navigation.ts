/**
 * Presentation re-export of the application product-navigation read model.
 *
 * Workbench GET/SSE and the UI contract consume these types. Application owns
 * the DTOs and grouping semantics.
 */

export {
  attachmentsForDefinition,
  emptyAttachments,
  PRODUCT_EXPLORE_SCHEMA,
  PRODUCT_INSPECT_SCHEMA,
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  PRODUCT_SEARCH_SCHEMA,
  PRODUCT_SOURCE_CLOSURE_SCHEMA,
  THREAD_PRODUCT_NAVIGATION_SCHEMA,
  unavailableProductNavigationProjection,
} from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";
export type {
  ProductApplicableAction,
  ProductExploreResult,
  ProductInspectResult,
  ProductNavigationAttachment,
  ProductNavigationAttachmentGraph,
  ProductNavigationAttachments,
  ProductNavigationAuthoringAttachment,
  ProductNavigationAuthoringBasisStatus,
  ProductNavigationBasis,
  ProductNavigationDiagnostic,
  ProductNavigationNode,
  ProductNavigationProjection,
  ProductNavigationScope,
  ProductNavigationStatus,
  ProductSearchResult,
  ProductSourceClosureResult,
  ProductStructureSelection,
} from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";
