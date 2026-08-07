/**
 * Essential-graph filter — shared display mask for the Evidence canvas.
 *
 * Both the SVG carte renderer (graph.tsx) and the sigma exploration renderer
 * (evidence-exploration-model.ts) need the same "current-design" projection:
 * hide supporting intermediaries (script artifacts, mesh files, change events,
 * consumption records) but keep any supporting node that is the ONLY path
 * between two essential nodes, so the condensed view never invents a false
 * island.
 *
 * Why a separate module:
 *   - graph.tsx is a .tsx file; models cannot import from it.
 *   - evidence-exploration-model.ts has no Preact dependency.
 *   - Predicates extracted here are testable without a browser.
 *
 * This module is pure domain (no I/O, no Preact, no browser APIs).
 */

import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Structural predicates
// ---------------------------------------------------------------------------

/**
 * Artifact kinds that are visually supporting rather than semantically
 * essential in the current-design view. A supporting artifact is still
 * reachable via the inspector; it simply does not appear in the default map.
 */
export const SUPPORTING_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  "script",
  "mesh",
  "solver-input",
  "evidence",
  "document",
  "other",
]);

/**
 * Returns true when `node` plays a supporting (non-essential) role in the
 * current-design view. Supporting nodes are hidden by default; they are kept
 * only when they are on the sole path between two essential nodes.
 *
 * Structural criteria (no labels, no summaries):
 *   - entityKind "consumption" — always supporting.
 *   - entityKind "change"      — always supporting.
 *   - entityKind "artifact" whose artifactKind is in SUPPORTING_ARTIFACT_KINDS.
 */
export function isSupportingNode(node: ThreadGraphNode): boolean {
  return (
    node.entityKind === "consumption" ||
    node.entityKind === "change" ||
    (node.entityKind === "artifact" &&
      !!node.artifactKind &&
      SUPPORTING_ARTIFACT_KINDS.has(node.artifactKind))
  );
}

// ---------------------------------------------------------------------------
// Filter result
// ---------------------------------------------------------------------------

export interface EssentialFilterResult {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
  /** Number of supporting nodes removed (for banner counters). */
  readonly hiddenCount: number;
  /** Total supporting nodes in the input (whether removed or preserved as connectors). */
  readonly supportingCount: number;
}

// ---------------------------------------------------------------------------
// Public filter
// ---------------------------------------------------------------------------

/**
 * Applies the essential display mask to a set of nodes and edges.
 *
 * Algorithm:
 *   1. Identify supporting nodes (isSupportingNode).
 *   2. Mark all non-supporting nodes as initially visible.
 *   3. For each pair of essential nodes, run a BFS on the full undirected
 *      graph. Every node on the shortest path between them — including any
 *      supporting connector — is added to the visible set.
 *   4. Return visible nodes and the edges whose both endpoints are visible.
 *
 * This guarantees that removing a supporting node never severs a genuine link:
 * if A and C are only connected through supporting node B, then B stays in the
 * result and the viewer can read A → B → C.
 *
 * The filter is a DISPLAY MASK only. It does not remove nodes from upstream
 * models (EvidenceGraphModel, EvidenceCanvasProjection). Callers that need the
 * full graph for neighbourhood queries must use the unfiltered model.
 *
 * @param nodes All nodes in the current projection.
 * @param edges All edges in the current projection.
 */
export function applyEssentialFilter(
  nodes: readonly ThreadGraphNode[],
  edges: readonly ThreadGraphEdge[],
): EssentialFilterResult {
  const supportingCount = nodes.filter(isSupportingNode).length;
  if (supportingCount === 0) {
    return { nodes, edges, hiddenCount: 0, supportingCount: 0 };
  }

  // Start with all non-supporting nodes visible.
  const visible = new Set(
    nodes
      .filter((n) => !isSupportingNode(n))
      .map((n) => filterRefKey(n.ref)),
  );

  // Undirected BFS adjacency over all nodes (supporting + essential).
  const adjacency = filterMakeAdjacency(nodes, edges);
  const essentialKeys = [...visible].sort();

  // Preserve supporting connectors on shortest paths between essential pairs.
  for (let left = 0; left < essentialKeys.length; left += 1) {
    for (let right = left + 1; right < essentialKeys.length; right += 1) {
      const from = essentialKeys[left];
      const to = essentialKeys[right];
      if (!from || !to) continue;
      for (const key of filterShortestPath(from, to, adjacency)) {
        visible.add(key);
      }
    }
  }

  const filteredNodes = nodes.filter((n) => visible.has(filterRefKey(n.ref)));
  // Edge is visible when both endpoints are visible (same semantics as the SVG
  // canvas, which drops edges to invisible nodes silently).
  const filteredEdges = edges.filter((e) =>
    visible.has(filterRefKey(e.from)) && visible.has(filterRefKey(e.to))
  );

  const hiddenCount = nodes.length - filteredNodes.length;
  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    hiddenCount,
    supportingCount,
  };
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function filterRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Builds an undirected adjacency map. Each node maps to the sorted list of
 * nodes it can reach in either direction through any edge.
 */
function filterMakeAdjacency(
  nodes: readonly ThreadGraphNode[],
  edges: readonly ThreadGraphEdge[],
): Map<string, string[]> {
  const values = new Map<string, Set<string>>(
    nodes.map((n) => [filterRefKey(n.ref), new Set()]),
  );
  for (const edge of edges) {
    const from = filterRefKey(edge.from);
    const to = filterRefKey(edge.to);
    values.get(from)?.add(to);
    values.get(to)?.add(from);
  }
  return new Map(
    [...values].map(([key, targets]) => [key, [...targets].sort()]),
  );
}

/**
 * BFS shortest path between `from` and `to` in the given adjacency map.
 * Returns an empty array when no path exists.
 */
function filterShortestPath(
  from: string,
  to: string,
  adjacency: Map<string, string[]>,
): string[] {
  if (from === to) return [from];
  const queue = [from];
  const previous = new Map<string, string | undefined>([[from, undefined]]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let cursor = current;
        while (cursor !== from) {
          path.push(cursor);
          const predecessor = previous.get(cursor);
          if (!predecessor) break;
          cursor = predecessor;
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}
