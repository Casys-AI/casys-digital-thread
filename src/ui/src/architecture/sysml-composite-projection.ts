import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "../thread/types.ts";

/**
 * Prefix reserved for structural routes invented only by the compact UI.
 * These edges are useful for layout, but they are not recorded relations and
 * must never open the canonical edge inspector.
 */
export const SYSML_COMPOSITE_EDGE_ID_PREFIX = "ui:sysml-composite:";

export interface SysmlCompositeProjection {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
  /** Canonical member ref -> ref rendered for that member in this projection. */
  readonly compositeRefByMemberRefKey: ReadonlyMap<string, ThreadGraphRef>;
  /** Rendered composite ref -> its two exact canonical member refs. */
  readonly memberRefKeysByCompositeRefKey: ReadonlyMap<
    string,
    readonly string[]
  >;
  readonly collapsedPairCount: number;
}

/**
 * Builds the UI-only quotient of one unambiguous PartUsage -> PartDefinition
 * pair. The PartDefinition identity survives because its CAD relations remain
 * exact; the label exposes the occurrence as `usage : Definition`.
 *
 * Reuse and uncertainty fail open: a shared definition, duplicate typing
 * record, duplicate node identity, or mismatched inspector/status metadata
 * keeps both exact SysML nodes and the recorded `typed_by` edge visible.
 * Focusing either member also expands the pair for exact-detail inspection.
 */
export function compactSysmlPartPairs(
  canonical: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  visible: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  expandedRef?: ThreadGraphRef,
): SysmlCompositeProjection {
  const canonicalNodeCounts = countNodesByRef(canonical.nodes);
  const canonicalNodeByKey = uniqueNodeByRef(
    canonical.nodes,
    canonicalNodeCounts,
  );
  const visibleKeys = new Set(visible.nodes.map((node) => refKey(node.ref)));
  const typingByUsage = new Map<string, ThreadGraphEdge[]>();
  const typingByDefinition = new Map<string, ThreadGraphEdge[]>();

  for (const edge of canonical.edges) {
    if (
      edge.relation !== "typed_by" || edge.from.kind !== "part-usage" ||
      edge.to.kind !== "part-definition" || edge.origin !== "structure"
    ) continue;
    append(typingByUsage, refKey(edge.from), edge);
    append(typingByDefinition, refKey(edge.to), edge);
  }

  const expandedKey = expandedRef ? refKey(expandedRef) : undefined;
  const definitionByCollapsedUsage = new Map<string, ThreadGraphNode>();
  const usageByCollapsedDefinition = new Map<string, ThreadGraphNode>();

  for (const [usageKey, typingEdges] of typingByUsage) {
    // More than one typing record is ambiguous even if every record happens
    // to point at the same definition.
    if (typingEdges.length !== 1) continue;
    const typing = typingEdges[0]!;
    const definitionKey = refKey(typing.to);
    // Count recorded edges, not merely distinct refs: duplicate evidence is
    // an ambiguity that the compact view must expose rather than erase.
    if ((typingByDefinition.get(definitionKey)?.length ?? 0) !== 1) continue;
    if (!visibleKeys.has(usageKey) || !visibleKeys.has(definitionKey)) continue;
    if (expandedKey === usageKey || expandedKey === definitionKey) continue;

    const usage = canonicalNodeByKey.get(usageKey);
    const definition = canonicalNodeByKey.get(definitionKey);
    if (!usage || !definition || !canShareCompositeStatus(usage, definition)) {
      continue;
    }

    definitionByCollapsedUsage.set(usageKey, definition);
    usageByCollapsedDefinition.set(definitionKey, usage);
  }

  const projectedNodes = visible.nodes.flatMap((node) => {
    const key = refKey(node.ref);
    if (definitionByCollapsedUsage.has(key)) return [];
    const usage = usageByCollapsedDefinition.get(key);
    if (!usage) return [node];
    return [{
      ...node,
      label: `${usage.label} : ${node.label}`,
      summary:
        `PartUsage ${usage.label} typed by PartDefinition ${node.label} · 2 exact SysML identities`,
    }];
  });

  const compositeRefByMemberRefKey = new Map<string, ThreadGraphRef>();
  const memberRefKeysByCompositeRefKey = new Map<string, readonly string[]>();
  for (const [usageKey, definition] of definitionByCollapsedUsage) {
    const definitionKey = refKey(definition.ref);
    compositeRefByMemberRefKey.set(usageKey, definition.ref);
    compositeRefByMemberRefKey.set(definitionKey, definition.ref);
    memberRefKeysByCompositeRefKey.set(
      definitionKey,
      [usageKey, definitionKey].sort(),
    );
  }
  for (const node of projectedNodes) {
    const key = refKey(node.ref);
    if (!compositeRefByMemberRefKey.has(key)) {
      compositeRefByMemberRefKey.set(key, node.ref);
    }
  }

  const projectedEdges: ThreadGraphEdge[] = [];
  for (const edge of visible.edges) {
    const from = compositeRefByMemberRefKey.get(refKey(edge.from)) ?? edge.from;
    const to = compositeRefByMemberRefKey.get(refKey(edge.to)) ?? edge.to;
    const fromChanged = refKey(from) !== refKey(edge.from);
    const toChanged = refKey(to) !== refKey(edge.to);

    // The unique typed_by relation is represented by the composite itself.
    if (
      edge.relation === "typed_by" && fromChanged &&
      refKey(from) === refKey(to)
    ) continue;

    if (!fromChanged && !toChanged) {
      projectedEdges.push(edge);
      continue;
    }
    // A remapped route is explicitly UI-owned. Keeping the recorded id after
    // changing an endpoint would make the edge inspector lie.
    if (refKey(from) === refKey(to)) continue;
    projectedEdges.push({
      ...edge,
      id: compositeEdgeId(edge, from, to),
      from,
      to,
      rationale:
        `UI-only compact SysML route for ${
          edge.id.startsWith("stub:") ? "folded route" : "recorded relation"
        } ${edge.id}. ` +
        "Select the component to inspect its exact PartUsage and PartDefinition identities.",
    });
  }

  return {
    nodes: projectedNodes,
    edges: projectedEdges,
    compositeRefByMemberRefKey,
    memberRefKeysByCompositeRefKey,
    collapsedPairCount: definitionByCollapsedUsage.size,
  };
}

export function isUiOnlySysmlCompositeEdge(edge: ThreadGraphEdge): boolean {
  return edge.id.startsWith(SYSML_COMPOSITE_EDGE_ID_PREFIX) ||
    edge.id.startsWith(`stub:${SYSML_COMPOSITE_EDGE_ID_PREFIX}`);
}

export function graphRefKey(ref: ThreadGraphRef): string {
  return refKey(ref);
}

function canShareCompositeStatus(
  usage: ThreadGraphNode,
  definition: ThreadGraphNode,
): boolean {
  return usage.entityKind === "part-usage" &&
    definition.entityKind === "part-definition" &&
    usage.system === definition.system &&
    usage.freshness === definition.freshness &&
    sameSelection(usage, definition) &&
    usage.recordedAt === definition.recordedAt &&
    usage.affectedComponentId === definition.affectedComponentId &&
    usage.activityRole === definition.activityRole;
}

function sameSelection(
  left: ThreadGraphNode,
  right: ThreadGraphNode,
): boolean {
  if (!left.selection || !right.selection) {
    return left.selection === right.selection;
  }
  return left.selection.kind === right.selection.kind &&
    left.selection.id === right.selection.id;
}

function countNodesByRef(
  nodes: readonly ThreadGraphNode[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = refKey(node.ref);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function uniqueNodeByRef(
  nodes: readonly ThreadGraphNode[],
  counts: ReadonlyMap<string, number>,
): ReadonlyMap<string, ThreadGraphNode> {
  const result = new Map<string, ThreadGraphNode>();
  for (const node of nodes) {
    const key = refKey(node.ref);
    if (counts.get(key) === 1) result.set(key, node);
  }
  return result;
}

function append(
  map: Map<string, ThreadGraphEdge[]>,
  key: string,
  edge: ThreadGraphEdge,
): void {
  const list = map.get(key) ?? [];
  list.push(edge);
  map.set(key, list);
}

function compositeEdgeId(
  edge: ThreadGraphEdge,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
): string {
  const prefix = edge.id.startsWith("stub:")
    ? `stub:${SYSML_COMPOSITE_EDGE_ID_PREFIX}`
    : SYSML_COMPOSITE_EDGE_ID_PREFIX;
  return `${prefix}${encodeURIComponent(edge.id)}:${
    encodeURIComponent(
      refKey(from),
    )
  }:${encodeURIComponent(refKey(to))}`;
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
