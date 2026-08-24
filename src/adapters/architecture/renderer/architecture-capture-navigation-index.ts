/**
 * Disposable Graphology traversal index for one exact architecture-capture/4.0.
 *
 * Keyed by the caller with the architecture artifact fingerprint. Deleting the
 * index leaves the capture as the only product-structure authority. Not a
 * domain aggregate and never merged back into SysON.
 */

import { MultiDirectedGraph } from "graphology";
import type { ExactArchitectureCapture } from "./architecture-capture.ts";
import type { ProductNavigationNode } from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";

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
  childrenOf(node: {
    readonly kind: "part-definition" | "part-usage";
    readonly id: string;
    readonly path: readonly string[];
  }): readonly ProductNavigationNode[];
  path(
    usageIds: readonly string[],
  ): readonly ProductNavigationNode[] | undefined;
  locate(id: string): readonly ProductNavigationNode[];
  neighborhood(node: {
    readonly kind: "part-definition" | "part-usage";
    readonly id: string;
    readonly path: readonly string[];
  }): ArchitectureCaptureNeighborhood;
  definition(
    id: string,
  ): { readonly id: string; readonly label: string } | undefined;
}

export function architectureCaptureNavigationIndex(
  capture: ExactArchitectureCapture,
): ArchitectureCaptureNavigationIndex {
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
    root: () => {
      if (!rootId) return undefined;
      const node = graph.getNodeAttributes(definitionKey(rootId));
      return {
        kind: "part-definition",
        id: rootId,
        label: node.label,
        definitionId: rootId,
        path: [],
        expandable: hasUsageChildren(graph, rootId),
      };
    },
    childrenOf: (node) => childrenOf(graph, node),
    path: (usageIds) => walkPath(graph, rootId, usageIds),
    locate: (id) => locateOccurrences(graph, rootId, id),
    neighborhood: (node) => neighborhoodOf(graph, rootId, node),
    definition: (id) => {
      const key = definitionKey(id);
      if (!graph.hasNode(key)) return undefined;
      const node = graph.getNodeAttributes(key);
      return { id, label: node.label };
    },
  };
}

function childrenOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  node: {
    readonly kind: "part-definition" | "part-usage";
    readonly id: string;
    readonly path: readonly string[];
  },
): readonly ProductNavigationNode[] {
  const definitionId = node.kind === "part-definition"
    ? node.id
    : graph.hasNode(usageNodeKey(node.id))
    ? graph.getNodeAttribute(usageNodeKey(node.id), "definitionId")
    : undefined;
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
    if (!typed) return;
    const path = [...node.path, usage.id];
    children.push({
      kind: "part-usage",
      id: usage.id,
      label: usage.label,
      definitionId: typed.id,
      usageId: usage.id,
      path,
      expandable: hasUsageChildren(graph, typed.id),
    });
  });
  return children.sort((left, right) => left.id.localeCompare(right.id));
}

function walkPath(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
  usageIds: readonly string[],
): readonly ProductNavigationNode[] | undefined {
  if (!rootId) return undefined;
  const rootAttrs = graph.getNodeAttributes(definitionKey(rootId));
  const nodes: ProductNavigationNode[] = [{
    kind: "part-definition",
    id: rootId,
    label: rootAttrs.label,
    definitionId: rootId,
    path: [],
    expandable: hasUsageChildren(graph, rootId),
  }];
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
    nodes.push({
      kind: "part-usage",
      id: usageId,
      label: usage.label,
      definitionId: typed.id,
      usageId,
      path: [...path],
      expandable: hasUsageChildren(graph, typed.id),
    });
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

function locateOccurrences(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
  id: string,
): readonly ProductNavigationNode[] {
  if (!rootId || id.length === 0 || id === "latest") return [];
  const matches: ProductNavigationNode[] = [];
  const root = walkPath(graph, rootId, []);
  const origin = root?.[0];
  if (!origin) return [];
  if (origin.id === id) matches.push(origin);
  const stack = [origin];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of childrenOf(graph, current)) {
      if (child.id === id || child.definitionId === id) matches.push(child);
      stack.push(child);
    }
  }
  return matches;
}

function neighborhoodOf(
  graph: MultiDirectedGraph<CaptureNavNodeAttrs, CaptureNavEdgeAttrs>,
  rootId: string | undefined,
  node: {
    readonly kind: "part-definition" | "part-usage";
    readonly id: string;
    readonly path: readonly string[];
  },
): ArchitectureCaptureNeighborhood {
  const children = childrenOf(graph, node);
  if (node.path.length === 0) {
    return { siblings: [], children };
  }
  const parentPath = node.path.slice(0, -1);
  const parentNodes = walkPath(graph, rootId, parentPath);
  const parent = parentNodes?.at(-1);
  if (!parent) return { siblings: [], children };
  const siblings = childrenOf(graph, parent).filter((item) =>
    item.id !== node.id ||
    item.path.join("\0") !== node.path.join("\0")
  );
  return { parent, siblings, children };
}

function emptyIndex(): ArchitectureCaptureNavigationIndex {
  return {
    root: () => undefined,
    childrenOf: () => [],
    path: () => undefined,
    locate: () => [],
    neighborhood: () => ({ siblings: [], children: [] }),
    definition: () => undefined,
  };
}

function definitionKey(id: string): string {
  return `part-definition:${id}`;
}

function usageNodeKey(id: string): string {
  return `part-usage:${id}`;
}
