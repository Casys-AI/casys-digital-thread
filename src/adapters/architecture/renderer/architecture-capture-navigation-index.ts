/**
 * Disposable Graphology traversal index for one exact architecture-capture/4.0.
 *
 * Keyed by the caller with the architecture artifact fingerprint. Deleting the
 * index leaves the capture as the only product-structure authority. Not a
 * domain aggregate and never merged back into SysON.
 */

import { MultiDirectedGraph } from "graphology";
import {
  type ProductStructureElementRef,
  productStructureElementRef,
  type ProductStructureOccurrenceRef,
} from "../../../domain/architecture/product-structure-ref.ts";
import type { ExactArchitectureCapture } from "./architecture-capture.ts";
import { architectureCaptureIsNavigable } from "./architecture-capture-structure.ts";
import {
  productNavigationElementNode,
  type ProductNavigationNode,
  productNavigationOccurrenceNode,
  type ProductSearchHit,
} from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";
import type {
  OpenedProductStructure,
  ProductStructureElementRecord,
} from "../../../application/ports/out/product-navigation/product-structure-traversal.ts";

interface CaptureNavNodeAttrs {
  readonly kind: "part-definition" | "part-usage";
  readonly id: string;
  readonly label: string;
  readonly definitionId?: string;
  readonly ownerDefinitionId?: string;
}

interface CaptureNavEdgeAttrs {
  readonly relation: "contains" | "typed_by";
}

export interface ArchitectureCaptureNeighborhood {
  readonly parent?: ProductNavigationNode;
  readonly siblings: readonly ProductNavigationNode[];
  readonly children: readonly ProductNavigationNode[];
}

export interface ArchitectureCaptureNavigationIndex {
  root(): ProductNavigationNode | undefined;
  childrenOfRoot(): readonly ProductNavigationNode[];
  childrenOf(
    occurrence: ProductStructureOccurrenceRef,
  ): readonly ProductNavigationNode[];
  path(
    usageIds: readonly string[],
  ): readonly ProductNavigationNode[] | undefined;
  neighborhood(
    occurrence: ProductStructureOccurrenceRef,
  ): ArchitectureCaptureNeighborhood;
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
  definition(
    id: string,
  ): { readonly id: string; readonly label: string } | undefined;
  hasElement(query: ProductStructureElementRef): boolean;
  typedDefinition(
    usageId: string,
  ):
    | { readonly element: ProductStructureElementRef; readonly label: string }
    | undefined;
  ownerDefinitionId(usageId: string): string | undefined;
  immediateUsageIds(definitionId: string): readonly string[];
}

export function architectureCaptureNavigationIndex(
  capture: ExactArchitectureCapture,
): ArchitectureCaptureNavigationIndex {
  if (!architectureCaptureIsNavigable(capture)) return emptyIndex();
  const graph = new MultiDirectedGraph<
    CaptureNavNodeAttrs,
    CaptureNavEdgeAttrs
  >();
  const rootId = capture.semanticRoot.id;

  for (const part of capture.partDefinitions) {
    const defKey = definitionKey(part.id);
    if (!graph.hasNode(defKey)) {
      graph.addNode(defKey, {
        kind: "part-definition",
        id: part.id,
        label: part.label,
      });
    }
    for (const usage of part.usages) {
      const usageKey = usageNodeKey(usage.id);
      if (graph.hasNode(usageKey)) {
        return emptyIndex();
      }
      graph.addNode(usageKey, {
        kind: "part-usage",
        id: usage.id,
        label: usage.label,
        definitionId: usage.targetId,
        ownerDefinitionId: part.id,
      });
      graph.addEdge(defKey, usageKey, { relation: "contains" });
      const targetKey = definitionKey(usage.targetId);
      if (!graph.hasNode(targetKey)) {
        const target = capture.partDefinitions.find((item) =>
          item.id === usage.targetId
        );
        if (!target || target.label !== usage.targetLabel) return emptyIndex();
        graph.addNode(targetKey, {
          kind: "part-definition",
          id: target.id,
          label: target.label,
        });
      }
      graph.addEdge(usageKey, targetKey, { relation: "typed_by" });
    }
  }

  return {
    root: () => rootNode(graph, rootId),
    childrenOfRoot: () => childrenFromDefinition(graph, rootId, []),
    childrenOf: (occurrence) => childrenOf(graph, occurrence),
    path: (usageIds) => walkPath(graph, rootId, usageIds),
    neighborhood: (occurrence) => neighborhoodOf(graph, rootId, occurrence),
    element: (id) => elementRecord(graph, id),
    searchElements: (query) => searchElements(graph, query),
    pageOccurrences: (element, offset, limit) =>
      pageOccurrences(graph, rootId, element, offset, limit),
    definition: (id) => {
      const key = definitionKey(id);
      if (!graph.hasNode(key)) return undefined;
      const node = graph.getNodeAttributes(key);
      return { id, label: node.label };
    },
    hasElement: (query) => hasElement(graph, query),
    typedDefinition: (usageId) => typedDefinitionOf(graph, usageId),
    ownerDefinitionId: (usageId) => ownerDefinitionIdOf(graph, usageId),
    immediateUsageIds: (definitionId) => immediateUsageIdsOf(graph, definitionId),
  };
}

function rootNode(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
): ProductNavigationNode | undefined {
  if (!rootId) return undefined;
  const key = definitionKey(rootId);
  if (!graph.hasNode(key)) return undefined;
  const node = graph.getNodeAttributes(key);
  return productNavigationElementNode({
    element: productStructureElementRef("PartDefinition", rootId),
    label: node.label,
    expandable: hasUsageChildren(graph, rootId),
  });
}

function childrenOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  occurrence: ProductStructureOccurrenceRef,
): readonly ProductNavigationNode[] {
  if (occurrence.element.elementKind !== "PartUsage") return [];
  const usageKey = usageNodeKey(occurrence.element.elementId);
  if (!graph.hasNode(usageKey)) return [];
  const typedId = graph.getNodeAttribute(usageKey, "definitionId");
  if (!typedId) return [];
  return childrenFromDefinition(graph, typedId, occurrence.path);
}

function childrenFromDefinition(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  definitionId: string | undefined,
  pathPrefix: readonly string[],
): readonly ProductNavigationNode[] {
  if (!definitionId) return [];
  const from = definitionKey(definitionId);
  if (!graph.hasNode(from)) return [];
  const children: ProductNavigationNode[] = [];
  graph.forEachOutEdge(from, (_edge, attrs, _source, target) => {
    if (attrs.relation !== "contains") return;
    const usage = graph.getNodeAttributes(target);
    const typed = usage.definitionId
      ? graph.getNodeAttributes(definitionKey(usage.definitionId))
      : undefined;
    if (!typed || !usage.definitionId) return;
    children.push(productNavigationOccurrenceNode({
      element: productStructureElementRef("PartUsage", usage.id),
      path: [...pathPrefix, usage.id],
      label: usage.label,
      typedDefinition: productStructureElementRef(
        "PartDefinition",
        usage.definitionId,
      ),
      expandable: hasUsageChildren(graph, typed.id),
    }));
  });
  return children.sort((left, right) =>
    left.element.elementId.localeCompare(right.element.elementId)
  );
}

function walkPath(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
  usageIds: readonly string[],
): readonly ProductNavigationNode[] | undefined {
  const origin = rootNode(graph, rootId);
  if (!origin || !rootId) return undefined;
  const nodes: ProductNavigationNode[] = [origin];
  let owner = rootId;
  const path: string[] = [];
  for (const usageId of usageIds) {
    const usageKey = usageNodeKey(usageId);
    if (!graph.hasNode(usageKey)) return undefined;
    const usage = graph.getNodeAttributes(usageKey);
    if (usage.ownerDefinitionId !== owner) return undefined;
    const typedId = usage.definitionId;
    if (!typedId) return undefined;
    path.push(usageId);
    const typed = graph.getNodeAttributes(definitionKey(typedId));
    nodes.push(productNavigationOccurrenceNode({
      element: productStructureElementRef("PartUsage", usageId),
      path: [...path],
      label: usage.label,
      typedDefinition: productStructureElementRef("PartDefinition", typed.id),
      expandable: hasUsageChildren(graph, typed.id),
    }));
    owner = typed.id;
  }
  return nodes;
}

function hasUsageChildren(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  definitionId: string,
): boolean {
  const from = definitionKey(definitionId);
  if (!graph.hasNode(from)) return false;
  let expandable = false;
  graph.forEachOutEdge(from, (_edge, attrs) => {
    if (attrs.relation === "contains") expandable = true;
  });
  return expandable;
}

function neighborhoodOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
  occurrence: ProductStructureOccurrenceRef,
): ArchitectureCaptureNeighborhood {
  const children = childrenOf(graph, occurrence);
  const parentPath = occurrence.path.slice(0, -1);
  const parentNodes = walkPath(graph, rootId, parentPath);
  const parent = parentNodes?.at(-1);
  if (!parent) return { siblings: [], children };
  const siblingsSource = parent.occurrence
    ? childrenOf(graph, parent.occurrence)
    : childrenFromDefinition(graph, rootId, []);
  const siblings = siblingsSource.filter((item) =>
    item.element.elementId !== occurrence.element.elementId ||
    (item.occurrence?.path.join("\0") ?? "") !== occurrence.path.join("\0")
  );
  return { parent, siblings, children };
}

function elementRecord(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  id: string,
): ProductStructureElementRecord | undefined {
  if (id.length === 0 || id.toLowerCase() === "latest") return undefined;
  const definition = definitionKey(id);
  if (graph.hasNode(definition)) {
    const node = graph.getNodeAttributes(definition);
    return {
      element: productStructureElementRef("PartDefinition", id),
      label: node.label,
      expandable: hasUsageChildren(graph, id),
    };
  }
  const usage = usageNodeKey(id);
  if (!graph.hasNode(usage)) return undefined;
  const node = graph.getNodeAttributes(usage);
  const typedId = node.definitionId;
  return {
    element: productStructureElementRef("PartUsage", id),
    label: node.label,
    expandable: typedId ? hasUsageChildren(graph, typedId) : false,
  };
}

function searchElements(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  query:
    | { readonly kind: "exact-id"; readonly elementId: string }
    | { readonly kind: "text"; readonly text: string },
): readonly ProductSearchHit[] {
  if (query.kind === "exact-id") {
    const found = elementRecord(graph, query.elementId);
    if (!found || found.element.elementId !== query.elementId) return [];
    return [{
      element: found.element,
      label: found.label,
      match: "exact-id",
    }];
  }
  const needle = query.text.trim().toLowerCase();
  if (needle.length === 0 || needle === "latest") return [];
  const queryTokens = tokenize(needle);
  if (queryTokens.length === 0) return [];
  const hits: ProductSearchHit[] = [];
  graph.forEachNode((_key, attrs) => {
    const element = attrs.kind === "part-definition"
      ? productStructureElementRef("PartDefinition", attrs.id)
      : productStructureElementRef("PartUsage", attrs.id);
    const idTokens = tokenize(attrs.id);
    const labelTokens = tokenize(attrs.label);
    if (tokensMatch(queryTokens, idTokens)) {
      hits.push({ element, label: attrs.label, match: "id-token" });
      return;
    }
    if (tokensMatch(queryTokens, labelTokens)) {
      hits.push({ element, label: attrs.label, match: "label-token" });
    }
  });
  return hits.sort((left, right) =>
    left.element.elementKind.localeCompare(right.element.elementKind) ||
    left.element.elementId.localeCompare(right.element.elementId)
  );
}

function pageOccurrences(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
  element: ProductStructureElementRef,
  offset: number,
  limit: number,
): {
  readonly items: readonly ProductNavigationNode[];
  readonly nextOffset: number | null;
} {
  if (!rootId || limit < 1 || offset < 0) {
    return { items: [], nextOffset: null };
  }
  const items: ProductNavigationNode[] = [];
  let skipped = 0;
  let hasMore = false;
  const queue = [...childrenFromDefinition(graph, rootId, [])];
  while (queue.length > 0) {
    const child = queue.shift()!;
    const matched = (child.element.elementKind === element.elementKind &&
      child.element.elementId === element.elementId) ||
      (element.elementKind === "PartDefinition" &&
        child.typedDefinition?.elementId === element.elementId);
    if (matched) {
      if (skipped < offset) {
        skipped += 1;
      } else if (items.length < limit) {
        items.push(child);
      } else {
        hasMore = true;
        break;
      }
    }
    if (child.occurrence) {
      queue.push(...childrenOf(graph, child.occurrence));
    }
  }
  return {
    items,
    nextOffset: hasMore ? offset + items.length : null,
  };
}

function hasElement(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  query: ProductStructureElementRef,
): boolean {
  if (
    query.elementId.length === 0 ||
    query.elementId.toLowerCase() === "latest"
  ) {
    return false;
  }
  const key = query.elementKind === "PartDefinition"
    ? definitionKey(query.elementId)
    : usageNodeKey(query.elementId);
  if (!graph.hasNode(key)) return false;
  const kind = graph.getNodeAttribute(key, "kind");
  return query.elementKind === "PartDefinition"
    ? kind === "part-definition"
    : kind === "part-usage";
}

function ownerDefinitionIdOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  usageId: string,
): string | undefined {
  const key = usageNodeKey(usageId);
  if (!graph.hasNode(key)) return undefined;
  return graph.getNodeAttribute(key, "ownerDefinitionId");
}

function immediateUsageIdsOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  definitionId: string,
): readonly string[] {
  const from = definitionKey(definitionId);
  if (!graph.hasNode(from)) return [];
  const ids: string[] = [];
  graph.forEachOutEdge(from, (_edge, attrs, _source, target) => {
    if (attrs.relation !== "contains") return;
    ids.push(graph.getNodeAttributes(target).id);
  });
  return ids.sort((left, right) => left.localeCompare(right));
}

function typedDefinitionOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  usageId: string,
):
  | { readonly element: ProductStructureElementRef; readonly label: string }
  | undefined {
  const key = usageNodeKey(usageId);
  if (!graph.hasNode(key)) return undefined;
  const typedId = graph.getNodeAttribute(key, "definitionId");
  if (!typedId) return undefined;
  const typedKey = definitionKey(typedId);
  if (!graph.hasNode(typedKey)) return undefined;
  return {
    element: productStructureElementRef("PartDefinition", typedId),
    label: graph.getNodeAttribute(typedKey, "label"),
  };
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function tokensMatch(
  queryTokens: readonly string[],
  candidateTokens: readonly string[],
): boolean {
  return queryTokens.every((token) =>
    candidateTokens.some((candidate) =>
      candidate === token || candidate.startsWith(token)
    )
  );
}

function emptyIndex(): ArchitectureCaptureNavigationIndex {
  return {
    root: () => undefined,
    childrenOfRoot: () => [],
    childrenOf: () => [],
    path: () => undefined,
    neighborhood: () => ({ siblings: [], children: [] }),
    element: () => undefined,
    searchElements: () => [],
    pageOccurrences: () => ({ items: [], nextOffset: null }),
    definition: () => undefined,
    hasElement: () => false,
    typedDefinition: () => undefined,
    ownerDefinitionId: () => undefined,
    immediateUsageIds: () => [],
  };
}

function definitionKey(id: string): string {
  return `part-definition:${id}`;
}

function usageNodeKey(id: string): string {
  return `part-usage:${id}`;
}

export function openedFromIndex(
  architectureArtifactId: string,
  architectureFingerprint: OpenedProductStructure["architectureFingerprint"],
  index: ArchitectureCaptureNavigationIndex,
): OpenedProductStructure {
  return {
    architectureArtifactId,
    architectureFingerprint,
    root: () => index.root(),
    childrenOfRoot: () => index.childrenOfRoot(),
    childrenOf: (occurrence) => index.childrenOf(occurrence),
    path: (usageIds) => index.path(usageIds),
    neighborhood: (occurrence) => index.neighborhood(occurrence),
    element: (id) => index.element(id),
    searchElements: (query) => index.searchElements(query),
    pageOccurrences: (element, offset, limit) =>
      index.pageOccurrences(element, offset, limit),
    hasDefinition: (id) => index.definition(id) !== undefined,
    hasElement: (query) => index.hasElement(query),
    typedDefinition: (usageId) => index.typedDefinition(usageId),
  };
}
