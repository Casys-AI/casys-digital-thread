import {
  isUiOnlySysmlCompositeEdge,
  type SysmlCompositeProjection,
} from "../architecture/sysml-composite-projection.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "../thread/types.ts";

/**
 * Prefix reserved for UI-only routes created when a STEP and its GLB
 * presentation are drawn as one node. Not a recorded Thread relation.
 */
export const CAD_PRESENTATION_EDGE_ID_PREFIX = "ui:cad-presentation:";

export interface CadPresentationProjection {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
  readonly compositeRefByMemberRefKey: ReadonlyMap<string, ThreadGraphRef>;
  readonly memberRefKeysByCompositeRefKey: ReadonlyMap<
    string,
    readonly string[]
  >;
  readonly collapsedPairCount: number;
}

/**
 * UI-only quotient of one unambiguous authoritative STEP + GLB preview.
 *
 * The two CAS identities stay exact: the STEP node survives, the GLB is
 * folded, and focusing either member expands the pair. This does not merge
 * writes, operations, or agent work. Reuse and uncertainty fail open.
 *
 * Pairing is structural:
 *   1. A PartDefinition with exactly one `represented_by` STEP and one
 *      `represented_by` cad-model (catalog preview).
 *   2. Leftover assembly binaries that share one geometry `traces_to`
 *      parent, where the STEP's PartDefinition has no catalog preview
 *      and the GLB has no `represented_by` of its own.
 */
export function compactCadPresentationPairs(
  canonical: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  visible: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  expandedRef?: ThreadGraphRef,
): CadPresentationProjection {
  const canonicalNodeCounts = countNodesByRef(canonical.nodes);
  const canonicalNodeByKey = uniqueNodeByRef(
    canonical.nodes,
    canonicalNodeCounts,
  );
  const visibleKeys = new Set(visible.nodes.map((node) => refKey(node.ref)));
  const expandedKey = expandedRef ? refKey(expandedRef) : undefined;

  const pairs = findCadPresentationPairs(
    canonical.edges,
    canonicalNodeByKey,
    visibleKeys,
    expandedKey,
  );

  const previewByStepKey = new Map<string, ThreadGraphNode>();
  const stepByPreviewKey = new Map<string, ThreadGraphNode>();
  for (const pair of pairs) {
    previewByStepKey.set(refKey(pair.step.ref), pair.preview);
    stepByPreviewKey.set(refKey(pair.preview.ref), pair.step);
  }

  const projectedNodes = visible.nodes.flatMap((node) => {
    const key = refKey(node.ref);
    if (stepByPreviewKey.has(key)) return [];
    const preview = previewByStepKey.get(key);
    if (!preview) return [node];
    return [{
      ...node,
      summary:
        `${node.label} plus GLB presentation · 2 exact artifact identities`,
    }];
  });

  const compositeRefByMemberRefKey = new Map<string, ThreadGraphRef>();
  const memberRefKeysByCompositeRefKey = new Map<string, readonly string[]>();
  for (const [stepKey, preview] of previewByStepKey) {
    const previewKey = refKey(preview.ref);
    const step = canonicalNodeByKey.get(stepKey);
    if (!step) continue;
    compositeRefByMemberRefKey.set(stepKey, step.ref);
    compositeRefByMemberRefKey.set(previewKey, step.ref);
    memberRefKeysByCompositeRefKey.set(
      stepKey,
      [stepKey, previewKey].sort(),
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
    const from = compositeRefByMemberRefKey.get(refKey(edge.from)) ??
      edge.from;
    const to = compositeRefByMemberRefKey.get(refKey(edge.to)) ?? edge.to;
    const fromChanged = refKey(from) !== refKey(edge.from);
    const toChanged = refKey(to) !== refKey(edge.to);

    if (
      edge.relation === "represented_by" && toChanged &&
      refKey(from) !== refKey(to)
    ) {
      // PartDef already has the surviving STEP route; the preview route
      // is the pair itself.
      const already = visible.edges.some((candidate) =>
        candidate.relation === "represented_by" &&
        refKey(candidate.from) === refKey(from) &&
        refKey(candidate.to) === refKey(to)
      );
      if (already) continue;
    }

    if (!fromChanged && !toChanged) {
      projectedEdges.push(edge);
      continue;
    }
    if (refKey(from) === refKey(to)) continue;
    projectedEdges.push({
      ...edge,
      id: compositeEdgeId(edge, from, to),
      from,
      to,
      rationale:
        `UI-only compact CAD presentation route for ${
          edge.id.startsWith("stub:") ? "folded route" : "recorded relation"
        } ${edge.id}. ` +
        "Select the node to inspect the exact STEP and GLB identities.",
    });
  }

  return {
    nodes: projectedNodes,
    edges: projectedEdges,
    compositeRefByMemberRefKey,
    memberRefKeysByCompositeRefKey,
    collapsedPairCount: previewByStepKey.size,
  };
}

/** Other recorded encoding of a CAD pair, if `focusRef` is one member. */
export function cadPresentationSiblingOf(
  canonical: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  focusRef: ThreadGraphRef,
): ThreadGraphRef | undefined {
  const nodeCounts = countNodesByRef(canonical.nodes);
  const nodeByKey = uniqueNodeByRef(canonical.nodes, nodeCounts);
  const visibleKeys = new Set(canonical.nodes.map((node) => refKey(node.ref)));
  const focusKey = refKey(focusRef);
  for (
    const pair of findCadPresentationPairs(
      canonical.edges,
      nodeByKey,
      visibleKeys,
      undefined,
    )
  ) {
    if (refKey(pair.step.ref) === focusKey) return pair.preview.ref;
    if (refKey(pair.preview.ref) === focusKey) return pair.step.ref;
  }
  return undefined;
}

export function isUiOnlyCadPresentationEdge(edge: ThreadGraphEdge): boolean {
  return edge.id.startsWith(CAD_PRESENTATION_EDGE_ID_PREFIX) ||
    edge.id.startsWith(`stub:${CAD_PRESENTATION_EDGE_ID_PREFIX}`);
}

export function isUiOnlyPresentationEdge(edge: ThreadGraphEdge): boolean {
  return isUiOnlySysmlCompositeEdge(edge) || isUiOnlyCadPresentationEdge(edge);
}

export function mergePresentationCompacts(
  sysml: SysmlCompositeProjection,
  cad: CadPresentationProjection,
): CadPresentationProjection {
  const compositeRefByMemberRefKey = new Map(sysml.compositeRefByMemberRefKey);
  for (const [memberKey, composite] of cad.compositeRefByMemberRefKey) {
    if (cad.memberRefKeysByCompositeRefKey.has(refKey(composite))) {
      compositeRefByMemberRefKey.set(memberKey, composite);
    }
  }
  const memberRefKeysByCompositeRefKey = new Map(
    sysml.memberRefKeysByCompositeRefKey,
  );
  for (const [compositeKey, members] of cad.memberRefKeysByCompositeRefKey) {
    memberRefKeysByCompositeRefKey.set(compositeKey, members);
  }
  return {
    nodes: cad.nodes,
    edges: cad.edges,
    compositeRefByMemberRefKey,
    memberRefKeysByCompositeRefKey,
    collapsedPairCount: sysml.collapsedPairCount + cad.collapsedPairCount,
  };
}

interface CadPresentationPair {
  readonly step: ThreadGraphNode;
  readonly preview: ThreadGraphNode;
}

function findCadPresentationPairs(
  edges: readonly ThreadGraphEdge[],
  nodeByKey: ReadonlyMap<string, ThreadGraphNode>,
  visibleKeys: ReadonlySet<string>,
  expandedKey: string | undefined,
): CadPresentationPair[] {
  const representedByDef = new Map<string, ThreadGraphEdge[]>();
  for (const edge of edges) {
    if (
      edge.relation !== "represented_by" ||
      edge.origin !== "structure" ||
      edge.from.kind !== "part-definition" ||
      edge.to.kind !== "artifact"
    ) continue;
    append(representedByDef, refKey(edge.from), edge);
  }

  const pairs: CadPresentationPair[] = [];
  const used = new Set<string>();

  for (const representationEdges of representedByDef.values()) {
    const pair = exclusiveStepPreview(
      representationEdges.map((edge) => nodeByKey.get(refKey(edge.to))),
    );
    if (
      !pair ||
      !visibleKeys.has(refKey(pair.step.ref)) ||
      !visibleKeys.has(refKey(pair.preview.ref)) ||
      expandedKey === refKey(pair.step.ref) ||
      expandedKey === refKey(pair.preview.ref) ||
      !canSharePresentation(pair.step, pair.preview)
    ) continue;
    pairs.push(pair);
    used.add(refKey(pair.step.ref));
    used.add(refKey(pair.preview.ref));
  }

  const previewDefs = new Set<string>();
  const stepOnlyDefs = new Set<string>();
  for (const [defKey, representationEdges] of representedByDef) {
    const kinds = representationEdges.flatMap((edge) => {
      const node = nodeByKey.get(refKey(edge.to));
      return node?.artifactKind ? [node.artifactKind] : [];
    });
    if (kinds.includes("cad-model")) previewDefs.add(defKey);
    if (kinds.includes("step") && !kinds.includes("cad-model")) {
      stepOnlyDefs.add(defKey);
    }
  }

  const leftoversByParent = new Map<string, ThreadGraphNode[]>();
  for (const edge of edges) {
    if (
      edge.relation !== "traces_to" ||
      edge.from.kind !== "artifact" ||
      edge.to.kind !== "artifact"
    ) continue;
    const child = nodeByKey.get(refKey(edge.to));
    if (!child || used.has(refKey(child.ref))) continue;
    if (child.artifactKind !== "step" && child.artifactKind !== "cad-model") {
      continue;
    }
    append(leftoversByParent, refKey(edge.from), child);
  }

  for (const children of leftoversByParent.values()) {
    const unused = children.filter((node) => !used.has(refKey(node.ref)));
    const pair = exclusiveStepPreview(unused);
    if (
      !pair ||
      !visibleKeys.has(refKey(pair.step.ref)) ||
      !visibleKeys.has(refKey(pair.preview.ref)) ||
      expandedKey === refKey(pair.step.ref) ||
      expandedKey === refKey(pair.preview.ref) ||
      !canSharePresentation(pair.step, pair.preview)
    ) continue;
    if (
      !isAssemblyLeftoverPair(
        pair,
        representedByDef,
        previewDefs,
        stepOnlyDefs,
      )
    ) continue;
    pairs.push(pair);
    used.add(refKey(pair.step.ref));
    used.add(refKey(pair.preview.ref));
  }

  return pairs;
}

function exclusiveStepPreview(
  nodes: readonly (ThreadGraphNode | undefined)[],
): CadPresentationPair | undefined {
  const unique = new Map<string, ThreadGraphNode>();
  for (const node of nodes) {
    if (!node) return undefined;
    unique.set(refKey(node.ref), node);
  }
  const steps = [...unique.values()].filter((node) =>
    node.artifactKind === "step"
  );
  const previews = [...unique.values()].filter((node) =>
    node.artifactKind === "cad-model"
  );
  if (steps.length !== 1 || previews.length !== 1) return undefined;
  return { step: steps[0]!, preview: previews[0]! };
}

function isAssemblyLeftoverPair(
  pair: CadPresentationPair,
  representedByDef: ReadonlyMap<string, ThreadGraphEdge[]>,
  previewDefs: ReadonlySet<string>,
  stepOnlyDefs: ReadonlySet<string>,
): boolean {
  const previewParents = parentsOf(pair.preview, representedByDef);
  if (previewParents.length !== 0) return false;
  const stepParents = parentsOf(pair.step, representedByDef);
  if (stepParents.length !== 1) return false;
  const parent = stepParents[0]!;
  return stepOnlyDefs.has(parent) && !previewDefs.has(parent);
}

function parentsOf(
  node: ThreadGraphNode,
  representedByDef: ReadonlyMap<string, ThreadGraphEdge[]>,
): string[] {
  const key = refKey(node.ref);
  const parents: string[] = [];
  for (const [defKey, representationEdges] of representedByDef) {
    if (representationEdges.some((edge) => refKey(edge.to) === key)) {
      parents.push(defKey);
    }
  }
  return parents.sort();
}

function canSharePresentation(
  step: ThreadGraphNode,
  preview: ThreadGraphNode,
): boolean {
  return step.entityKind === "artifact" &&
    preview.entityKind === "artifact" &&
    step.artifactKind === "step" &&
    preview.artifactKind === "cad-model" &&
    step.system === preview.system &&
    step.freshness === preview.freshness;
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

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function compositeEdgeId(
  edge: ThreadGraphEdge,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
): string {
  const prefix = edge.id.startsWith("stub:")
    ? `stub:${CAD_PRESENTATION_EDGE_ID_PREFIX}`
    : CAD_PRESENTATION_EDGE_ID_PREFIX;
  return `${prefix}${encodeURIComponent(edge.id)}:${
    encodeURIComponent(refKey(from))
  }:${encodeURIComponent(refKey(to))}`;
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
