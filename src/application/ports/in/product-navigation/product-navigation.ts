/**
 * Inward read port for SysML-first product navigation.
 *
 * The caller names only a project and exact SysML identities. The server
 * selects the unique current Thread tip and unique architecture-capture/4.0.
 * latest, labels, providers and runtimes are refused.
 */

import type {
  ProductExploreQuery,
  ProductExploreResult,
  ProductInspectQuery,
  ProductInspectResult,
  ProductNavigationProjection,
  ProductNavigationScope,
  ProductSearchQuery,
  ProductSearchResult,
  ProductSourceClosureQuery,
  ProductSourceClosureResult,
} from "./product-navigation-read-model.ts";

export type {
  ProductExploreQuery,
  ProductInspectQuery,
  ProductNavigationScope,
  ProductSearchQuery,
  ProductSourceClosureQuery,
} from "./product-navigation-read-model.ts";

export interface ProductNavigationUseCase {
  explore(query: ProductExploreQuery): Promise<ProductExploreResult>;
  search(query: ProductSearchQuery): Promise<ProductSearchResult>;
  inspect(query: ProductInspectQuery): Promise<ProductInspectResult>;
  sourceClosure(
    query: ProductSourceClosureQuery,
  ): Promise<ProductSourceClosureResult>;
  /**
   * Workbench GET packaging: unique root plus its immediate children and
   * grouped attachments. Same open/basis rules as the other reads.
   */
  projection(
    query: ProductNavigationScope,
  ): Promise<ProductNavigationProjection>;
}
