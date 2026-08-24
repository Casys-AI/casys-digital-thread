/**
 * Disposable exact-capture traversal for one Thread snapshot's architecture.
 *
 * Implementations may keep a Graphology index keyed by capture fingerprint.
 * The index is not product authority.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { ProductNavigationNode } from "../../in/product-navigation/product-navigation-read-model.ts";

export interface OpenedProductStructure {
  readonly architectureArtifactId: string;
  readonly architectureFingerprint: ContentFingerprint;
  root(): ProductNavigationNode | undefined;
  childrenOf(node: {
    readonly kind: "part-definition" | "part-usage";
    readonly id: string;
    readonly path: readonly string[];
  }): readonly ProductNavigationNode[];
  path(usageIds: readonly string[]): readonly ProductNavigationNode[] | undefined;
  locate(id: string): readonly ProductNavigationNode[];
  neighborhood(node: {
    readonly kind: "part-definition" | "part-usage";
    readonly id: string;
    readonly path: readonly string[];
  }): {
    readonly parent?: ProductNavigationNode;
    readonly siblings: readonly ProductNavigationNode[];
    readonly children: readonly ProductNavigationNode[];
  };
  hasDefinition(id: string): boolean;
  hasElement(query: {
    readonly id: string;
    readonly kind: "PartDefinition" | "PartUsage";
  }): boolean;
}

export interface ProductStructureTraversal {
  open(snapshot: ThreadSnapshot): Promise<OpenedProductStructure | undefined>;
}
