/**
 * Inward read port for SysML-first product navigation.
 *
 * The caller names only a project and exact SysML identities. The server
 * selects the unique current Thread tip and unique architecture-capture/4.0.
 * latest, labels, providers and runtimes are refused.
 */

import type {
  ProductNavigationAuthoringAttachments,
  ProductNavigationChildren,
  ProductNavigationContext,
  ProductNavigationNeighborhood,
  ProductNavigationNodeQuery,
  ProductNavigationPath,
  ProductNavigationProjection,
  ProductNavigationRoots,
  ProductNavigationScope,
  ProductNavigationSearch,
  ProductNavigationSourceClosure,
} from "./product-navigation-read-model.ts";

export type {
  ProductNavigationNodeQuery,
  ProductNavigationScope,
} from "./product-navigation-read-model.ts";

export interface ProductNavigationUseCase {
  roots(query: ProductNavigationScope): Promise<ProductNavigationRoots>;
  children(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
    },
  ): Promise<ProductNavigationChildren>;
  path(
    query: ProductNavigationScope & { readonly usagePath: readonly string[] },
  ): Promise<ProductNavigationPath>;
  context(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
    },
  ): Promise<ProductNavigationContext>;
  search(
    query: ProductNavigationScope & { readonly id: string },
  ): Promise<ProductNavigationSearch>;
  neighborhood(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
    },
  ): Promise<ProductNavigationNeighborhood>;
  sourceClosure(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
      readonly fileId: string;
      readonly fileRevision: number;
    },
  ): Promise<ProductNavigationSourceClosure>;
  authoringAttachments(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
      readonly pageSize?: number;
      readonly cursor?: string;
    },
  ): Promise<ProductNavigationAuthoringAttachments>;
  /**
   * Workbench GET packaging: unique root plus its immediate children and
   * grouped attachments. Same open/basis rules as the other reads.
   */
  projection(
    query: ProductNavigationScope,
  ): Promise<ProductNavigationProjection>;
}
