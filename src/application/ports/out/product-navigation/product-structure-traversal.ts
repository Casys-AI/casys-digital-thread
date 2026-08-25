/**
 * Disposable exact-capture traversal for one Thread snapshot's architecture.
 *
 * Implementations may keep a Graphology index keyed by capture fingerprint.
 * The index is not product authority.
 */

import type {
  ProductStructureElementRef,
  ProductStructureOccurrenceRef,
} from "../../../../domain/architecture/product-structure-ref.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type {
  ProductNavigationNode,
  ProductSearchHit,
} from "../../in/product-navigation/product-navigation-read-model.ts";

export interface ProductStructureElementRecord {
  readonly element: ProductStructureElementRef;
  readonly label: string;
  readonly expandable: boolean;
}

export interface OpenedProductStructure {
  readonly architectureArtifactId: string;
  readonly architectureFingerprint: ContentFingerprint;
  root(): ProductNavigationNode | undefined;
  childrenOfRoot(): readonly ProductNavigationNode[];
  childrenOf(
    occurrence: ProductStructureOccurrenceRef,
  ): readonly ProductNavigationNode[];
  path(
    usageIds: readonly string[],
  ): readonly ProductNavigationNode[] | undefined;
  neighborhood(occurrence: ProductStructureOccurrenceRef): {
    readonly parent?: ProductNavigationNode;
    readonly siblings: readonly ProductNavigationNode[];
    readonly children: readonly ProductNavigationNode[];
  };
  element(id: string): ProductStructureElementRecord | undefined;
  searchElements(
    query:
      | { readonly kind: "exact-id"; readonly elementId: string }
      | { readonly kind: "text"; readonly text: string },
  ): readonly ProductSearchHit[];
  pageOccurrences(
    element: ProductStructureElementRef,
    offset: number,
    limit: number,
  ): {
    readonly items: readonly ProductNavigationNode[];
    readonly nextOffset: number | null;
  };
  hasDefinition(id: string): boolean;
  hasElement(query: ProductStructureElementRef): boolean;
  typedDefinition(
    usageId: string,
  ):
    | { readonly element: ProductStructureElementRef; readonly label: string }
    | undefined;
}

export interface ProductStructureTraversal {
  open(snapshot: ThreadSnapshot): Promise<OpenedProductStructure | undefined>;
}
