/**
 * Canvas-level projection of the EvidenceGraphModel for the Evidence tab.
 *
 * Extracts the structural predicate and projection logic from workbench.tsx so
 * they are testable in Deno without React. The presentation (JSX) layer in
 * workbench.tsx calls these functions and passes the result to ThreadGraph.
 *
 * Design constraints (confirmed by operator, not renegotiable):
 * - Component names are derived from the recorded graph; no domain-specific
 *   provider, prefix or artifact-kind classification is performed here.
 * - Explicit version-family projection preserves its recorded relations; the
 *   canvas invents no connector.
 * - Bounded neighbourhood is always COMPUTED at LOCAL_VIEW_MAX_DEPTH; the
 *   operator's visible-depth control (default 1) filters DISPLAY only via
 *   localDepthByRefKey, so depth changes never re-layout or reset the camera.
 */

import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import { boundedLineageNeighborhood } from "./evidence-graph-model.ts";
import {
  type DisplayKind,
  isDisplayKindVisible,
} from "./graph-record-display.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Component labeler
// ---------------------------------------------------------------------------

/**
 * Returns the named component label for a set of nodes in a layout component.
 *
 * Looks up each node's component in the EvidenceGraphModel (computed on the
 * full raw graph), collects all matching component names, and returns the most
 * frequent one. Falls back to "Linked evidence" for a single component or
 * "Evidence" for unknown islands.
 *
 * This function is called by ThreadGraph at render time via the
 * `componentLabeler` prop.
 */
export function makeEvidenceComponentLabeler(
  model: EvidenceGraphModel,
  isOnlyComponent: boolean,
): (nodes: ThreadGraphNode[], _index: number) => string {
  return (nodes, _index) => {
    if (nodes.length === 0) {
      return isOnlyComponent ? "Linked evidence" : "Evidence";
    }
    // Collect model component names for all nodes in this layout component.
    const nameCounts = new Map<string, number>();
    for (const node of nodes) {
      const compId = model.componentOf(node.ref);
      const comp = compId !== undefined
        ? model.components.find((c) => c.id === compId)
        : undefined;
      const name = comp?.name ?? "Evidence";
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    // Return the most frequent name.
    let best = isOnlyComponent ? "Linked evidence" : "Evidence";
    let bestCount = -1;
    for (const [name, count] of nameCounts) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    return best;
  };
}

// ---------------------------------------------------------------------------
// Full canvas projection
// ---------------------------------------------------------------------------

export interface EvidenceCanvasProjection {
  /** Nodes to pass to the canvas renderer. */
  readonly nodes: readonly ThreadGraphNode[];
  /** Exact projected edges to pass to the canvas renderer. */
  readonly edges: readonly ThreadGraphEdge[];
  /** Displayed node count (for the truthful counter in the banner). */
  readonly displayedCount: number;
  /** True when the canvas shows a bounded neighbourhood instead of the full graph. */
  readonly isFiltered: boolean;
  /**
   * Local view only: BFS depth of every node from the focused node (focus =
   * 0, immediate neighbours = 1, …). The neighbourhood is always COMPUTED at
   * LOCAL_VIEW_MAX_DEPTH; renderers use this map as a pure DISPLAY filter so
   * changing the visible depth adds or removes nodes in place — no re-layout,
   * no camera reset (Obsidian-style). Undefined on the full map.
   */
  readonly localDepthByRefKey?: ReadonlyMap<string, number>;
  /**
   * Count hidden only by an explicit literal-kind toggle. The base and local
   * projections retain every recorded node.
   */
  readonly hiddenByKindCount: number;
}

/**
 * Full-map dossier counts for the Evidence header. Derived from the painted
 * projection, never from Activity flow producers.
 */
export interface PaintedDossierMetric {
  readonly itemCount: number;
  readonly componentCount: number;
}

export function paintedDossierMetric(
  model: EvidenceGraphModel,
  projection: Pick<EvidenceCanvasProjection, "nodes">,
): PaintedDossierMetric {
  const visible = new Set(
    projection.nodes.map((node) => graphRefKey(node.ref)),
  );
  const componentCount =
    model.components.filter((component) =>
      [...component.visibleNodeRefKeys].some((key) => visible.has(key))
    ).length;
  return { itemCount: projection.nodes.length, componentCount };
}

export function linkedEvidenceDetail(componentCount: number): string {
  if (componentCount <= 0) return "no painted dossier";
  if (componentCount === 1) return "in 1 linked dossier";
  return `across ${componentCount} linked dossier components`;
}

/**
 * Computes the canvas projection for the Evidence tab.
 *
 * Rules (non-negotiable):
 * 1. No focus → full visible graph after generic version projection.
 * 2. Focus on a visible node → bounded neighbourhood at the chosen depth (default 1).
 * 3. Focus on a historical (folded) node → neighbourhood of the visible
 *    representative via `visibleRefByMemberRef`; falls back to full graph.
 *
 * @param model                 EvidenceGraphModel after version projection.
 * @param collapsedVersionCount Retained for API compatibility; the caller
 *                              reports generic history folding separately.
 * @param focusRef              Inspector selection (lineageFocus state).
 * @param visibleRefByMemberRef Map from historical ref key to visible ref.
 */
export function buildEvidenceCanvasProjection(
  model: EvidenceGraphModel,
  collapsedVersionCount: number,
  focusRef: ThreadGraphRef | undefined,
  visibleRefByMemberRef: ReadonlyMap<string, ThreadGraphRef>,
): EvidenceCanvasProjection {
  void collapsedVersionCount;

  // Full graph (no focus): both renderers consume the same identity
  // projection. No renderer gets a provider- or artifact-specific reading.
  if (!focusRef) {
    const allEdges = model.edges as ThreadGraphEdge[];
    return {
      nodes: model.nodes,
      edges: allEdges,
      displayedCount: model.nodes.length,
      isFiltered: false,
      hiddenByKindCount: 0,
    };
  }

  // Focus on a visible node: bounded neighbourhood, always computed at the
  // MAX depth — the visible depth is a display filter over localDepthByRefKey.
  const neighborhood = boundedLineageNeighborhood(
    model,
    focusRef,
    LOCAL_VIEW_MAX_DEPTH,
  );
  if (neighborhood.nodes.length > 0) {
    return localProjection(focusRef, neighborhood);
  }

  // Historical node: map to visible representative.
  const focusKey = `${focusRef.kind}:${focusRef.id}`;
  const visibleRef = visibleRefByMemberRef.get(focusKey);
  if (visibleRef) {
    const repNeighborhood = boundedLineageNeighborhood(
      model,
      visibleRef,
      LOCAL_VIEW_MAX_DEPTH,
    );
    if (repNeighborhood.nodes.length > 0) {
      return localProjection(visibleRef, repNeighborhood);
    }
  }

  // Fallback: the same full recorded graph as the no-focus case.
  const allEdgesFallback = model.edges as ThreadGraphEdge[];
  return {
    nodes: model.nodes,
    edges: allEdgesFallback,
    displayedCount: model.nodes.length,
    isFiltered: false,
    hiddenByKindCount: 0,
  };
}

/**
 * The local neighbourhood is always computed at this depth; the operator's
 * 1/2/3 control filters DISPLAY only (default 1). Keeping computation and
 * display separate is what lets depth changes add nodes in place without a
 * re-layout or camera reset.
 */
export const LOCAL_VIEW_MAX_DEPTH = 3 as const;

/**
 * BFS depth of every neighbourhood node from the focus, over undirected
 * edges. The focus is 0; nodes unreachable through the neighbourhood edges
 * (defensive case) keep no entry and renderers treat them as visible.
 */
function bfsDepths(
  focusRef: ThreadGraphRef,
  neighborhood: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
): ReadonlyMap<string, number> {
  const key = (ref: ThreadGraphRef) => `${ref.kind}:${ref.id}`;
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const edge of neighborhood.edges) {
    const from = key(edge.from);
    const to = key(edge.to);
    link(from, to);
    link(to, from);
  }
  const depths = new Map<string, number>();
  const start = key(focusRef);
  depths.set(start, 0);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = depths.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (!depths.has(next)) {
        depths.set(next, depth + 1);
        queue.push(next);
      }
    }
  }
  return depths;
}

/**
 * Builds the local-view projection. The 1/2/3 depth control hides
 * beyond-depth records in place without re-layouting; every record inside the
 * selected neighbourhood otherwise stays visible.
 */
function localProjection(
  focusRef: ThreadGraphRef,
  neighborhood: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
): EvidenceCanvasProjection {
  const depths = bfsDepths(focusRef, neighborhood);
  const visibleDepths = new Map<string, number>();
  for (const node of neighborhood.nodes) {
    const key = graphRefKey(node.ref);
    const depth = depths.get(key);
    if (depth !== undefined) visibleDepths.set(key, depth);
  }
  return {
    nodes: neighborhood.nodes,
    edges: neighborhood.edges,
    displayedCount: neighborhood.nodes.length,
    isFiltered: true,
    localDepthByRefKey: visibleDepths,
    hiddenByKindCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Kind-based projection for the Exploration full-map view
// ---------------------------------------------------------------------------

/**
 * Builds a canvas projection filtered by DisplayKind for the Exploration
 * full-map view. Each literal DisplayKind can be individually shown or
 * hidden; hidden records are not reused as inferred connector topology.
 *
 * This projection triggers a dagre re-layout when the visible set changes
 * (the caller memoises it on visibleKinds). No in-place sigma reducer is
 * applied: the remount is intentional so the layout never shows gaps from
 * hidden-in-place nodes.
 *
 * @param model         EvidenceGraphModel after generic version projection.
 * @param visibleKinds  Record mapping each DisplayKind to its visibility flag.
 */
export function buildExplorationKindProjection(
  model: EvidenceGraphModel,
  visibleKinds: Record<DisplayKind, boolean>,
  collapsedVersionCount = 0,
): EvidenceCanvasProjection {
  const visibleKeys = new Set(
    model.nodes
      .filter((node) => isDisplayKindVisible(visibleKinds, node))
      .map((node) => `${node.ref.kind}:${node.ref.id}`),
  );
  const visibleNodes = model.nodes.filter((node) =>
    visibleKeys.has(`${node.ref.kind}:${node.ref.id}`)
  );
  const visibleEdges = model.edges.filter((edge) =>
    visibleKeys.has(`${edge.from.kind}:${edge.from.id}`) &&
    visibleKeys.has(`${edge.to.kind}:${edge.to.id}`)
  );
  const hiddenByKind = model.nodes.length - visibleNodes.length;
  void collapsedVersionCount;

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    displayedCount: visibleNodes.length,
    isFiltered: false,
    hiddenByKindCount: hiddenByKind,
  };
}

function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
