/**
 * Graphology-backed evidence presentation graph.
 *
 * This is the navigation model for Evidence, not Thread authority.
 * ThreadSnapshot + AnalysisGraph remain the source of truth. Graphology
 * never grants admission, a join, or an execution.
 *
 * Connected components are computed on the full raw graph before the generic
 * version projection. No provider, id-prefix or artifact-kind fold is applied.
 *
 * Why MultiDirectedGraph: the painted Sigma canvas is already a directed
 * multigraph. Topology, components, and neighbourhood share that same
 * Graphology kind so the presentation graph is one model, not an undirected
 * twin plus a later conversion.
 */

import { MultiDirectedGraph } from "graphology";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadGraphRelation,
} from "./types.ts";
import {
  buildVersionedProvenanceProjection,
  type VersionedProvenanceProjection,
} from "./versioned-provenance-model.ts";

/**
 * Evidence paints the Thread dossier (provenance + structure). AnalysisGraph
 * stays a semantic index: painting it as `analysis-node` islands created a
 * second, third, and fourth disconnected graph. Sensitivity measurements
 * already appear as Thread observations and evaluations.
 */
export function graphWithoutAnalysisOverlay(graph: ThreadGraph): ThreadGraph {
  const nodes = graph.nodes.filter((node) =>
    node.entityKind !== "analysis-node"
  );
  const visible = new Set(nodes.map((node) => refKey(node.ref)));
  return {
    nodes,
    edges: graph.edges.filter((edge) =>
      edge.origin !== "analysis" &&
      visible.has(refKey(edge.from)) &&
      visible.has(refKey(edge.to))
    ),
  };
}

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/**
 * A named connected component derived from the FULL raw graph.
 *
 * `name` is derived structurally from the recorded system and entity kind
 * fields. It is graph organisation, not a domain payload reconstruction.
 * `intentionallyIsolated` is an explicit layout hint supplied by the caller.
 */
export interface EvidenceGraphComponent {
  readonly id: number;
  readonly name: string;
  readonly intentionallyIsolated: boolean;
  /** All node ref keys (kind:id) present in this component in the full graph. */
  readonly allNodeRefKeys: ReadonlySet<string>;
  /** Ref keys of nodes that remain visible after folding. */
  readonly visibleNodeRefKeys: ReadonlySet<string>;
}

export interface EvidenceGraphNeighborhood {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
}

export interface EvidenceGraphModel {
  /** Visible nodes for the default canvas after generic version projection. */
  readonly nodes: readonly ThreadGraphNode[];
  /** Visible edges for the default canvas after generic version projection. */
  readonly edges: readonly ThreadGraphEdge[];
  /**
   * Graphology presentation graph: the same visible nodes and recorded
   * edges, stored as a directed multigraph.
   * This graph is navigation only — never admission, join, or execution.
   */
  readonly graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>;
  /** Connected components from the FULL raw graph. Never re-computed after folding. */
  readonly components: readonly EvidenceGraphComponent[];
  /** Total raw node count before any folding. */
  readonly rawNodeCount: number;
  /** Total raw edge count before any folding. */
  readonly rawEdgeCount: number;
  /**
   * Component id for any node ref (full graph).
   * Returns undefined for refs not present in the raw graph.
   */
  componentOf(ref: ThreadGraphRef): number | undefined;
  /**
   * Bounded neighborhood on the VISIBLE graph.
   * Includes `ref` itself; returns empty sets if `ref` is not visible.
   *
   * @param depth  Maximum hop count (1 = direct neighbours only).
   * @param direction  "both" (default) = undirected BFS.
   *                   "upstream" = incoming edges only.
   *                   "downstream" = outgoing edges only.
   */
  boundedNeighborhood(
    ref: ThreadGraphRef,
    depth: number,
    direction?: "both" | "upstream" | "downstream",
  ): EvidenceGraphNeighborhood;
}

/**
 * Returns the bounded ancestors and bounded descendants of one fact without
 * walking through the fact's parent and back out to its siblings.
 *
 * A plain undirected BFS is useful for topology inspection, but it is the
 * wrong projection for a contextual lineage: selecting one STEP would walk
 * STEP -> geometry bundle -> every sibling STEP.  The Activity vignette and
 * focused Evidence view need the union of the two directional traversals
 * instead.  Structural branches (`contains`, `typed_by`, `represented_by`)
 * remain visible when they are genuinely upstream or downstream of the
 * selected fact.
 */
export function boundedLineageNeighborhood(
  model: EvidenceGraphModel,
  ref: ThreadGraphRef,
  depth: number,
): EvidenceGraphNeighborhood {
  const upstream = model.boundedNeighborhood(ref, depth, "upstream");
  const downstream = model.boundedNeighborhood(ref, depth, "downstream");
  const nodeKeys = new Set([
    ...upstream.nodes.map((node) => refKey(node.ref)),
    ...downstream.nodes.map((node) => refKey(node.ref)),
  ]);
  // Add a bounded structural halo around the selected record and its
  // consequences. Only literal recorded structural relations participate;
  // the Workbench does not reconstruct a provider or domain topology.
  let frontier = new Set([
    refKey(ref),
    ...downstream.nodes.map((node) => refKey(node.ref)),
  ]);
  for (let hop = 0; hop < depth && frontier.size > 0; hop += 1) {
    const next = new Set<string>();
    for (const edge of model.edges) {
      if (!isContextStructureRelation(edge.relation)) continue;
      const from = refKey(edge.from);
      const to = refKey(edge.to);
      if (frontier.has(from) && !nodeKeys.has(to)) next.add(to);
      if (frontier.has(to) && !nodeKeys.has(from)) next.add(from);
    }
    for (const key of next) nodeKeys.add(key);
    frontier = next;
  }
  const nodes = model.nodes.filter((node) => nodeKeys.has(refKey(node.ref)));
  const edgeKeys = new Set<string>();
  const edges = model.edges.filter((edge) =>
    nodeKeys.has(refKey(edge.from)) && nodeKeys.has(refKey(edge.to))
  ).filter((edge) => {
    const key = edgeOccurrenceKey(edge);
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    return true;
  });
  return { nodes, edges };
}

/**
 * Configuration for the evidence graph model.
 */
export interface EvidenceGraphConfig {
  /** Exact recorded system ids whose graph component is intentionally isolated. */
  intentionallyIsolatedSystems?: readonly string[];
  /**
   * Canonical versioned projection owned by the Workbench. Sharing it with
   * the render model preserves the exact visible edge objects used by
   * selection/highlight state; callers without a Workbench keep the local
   * projection fallback.
   */
  versionedProjection?: VersionedProvenanceProjection;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function buildEvidenceGraphModel(
  raw: ThreadGraph,
  familyGraph: ThreadEvidenceFamilyGraph,
  config: EvidenceGraphConfig = {},
): EvidenceGraphModel {
  const isolatedSystems = new Set(config.intentionallyIsolatedSystems ?? []);

  // Step 1 — load the FULL raw graph into Graphology. Direction is the BFF
  // source → consumer axis; component BFS still walks undirected neighbours.
  // Parallel recorded relations stay distinct edges: collapsing them would
  // make the presentation graph lie about the dossier.
  const fullGraph = new MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>();
  for (const node of raw.nodes) {
    const key = refKey(node.ref);
    if (!fullGraph.hasNode(key)) fullGraph.addNode(key, node);
  }
  for (const edge of raw.edges) addThreadEdge(fullGraph, edge);

  // Step 2 — compute connected components on the FULL graph.
  const componentIdByKey = new Map<string, number>();
  const componentNodeKeys: string[][] = [];
  const unseen = new Set(fullGraph.nodes());
  while (unseen.size > 0) {
    const root = firstSorted(unseen);
    if (root === undefined) break;
    const id = componentNodeKeys.length;
    const members: string[] = [];
    const queue = [root];
    unseen.delete(root);
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      componentIdByKey.set(current, id);
      fullGraph.forEachNeighbor(current, (neighbour) => {
        if (!unseen.has(neighbour)) return;
        unseen.delete(neighbour);
        queue.push(neighbour);
      });
    }
    componentNodeKeys.push(members.sort());
  }

  // Step 3 — apply version folding (supersedes families from familyGraph).
  const versionedProjection = config.versionedProjection ??
    buildVersionedProvenanceProjection(raw, familyGraph);
  const afterVersioning = versionedProjection.graph;

  // Step 4 — keep every record selected by the generic version projection.
  // Domain-specific Apps own any further presentation; the Workbench never
  // folds records by provider, artifact kind or id prefix.
  const visibleNodes = afterVersioning.nodes;
  const visibleRefKeys = new Set(visibleNodes.map((n) => refKey(n.ref)));
  const visibleEdges = afterVersioning.edges;

  // Step 5 — build neutral connected-component descriptors.
  const components: EvidenceGraphComponent[] = componentNodeKeys.map(
    (keys, id) => {
      const allNodeRefKeys = new Set(keys);
      const visibleNodeRefKeys = new Set(
        keys.filter((k) => visibleRefKeys.has(k)),
      );
      const systemCounts = new Map<string, number>();
      for (const key of keys) {
        const node = fullGraph.getNodeAttributes(key) as ThreadGraphNode;
        systemCounts.set(
          node.system,
          (systemCounts.get(node.system) ?? 0) + 1,
        );
      }
      const dominantSystem = maxEntry(systemCounts) ?? "unknown";
      const name = componentName(dominantSystem, allNodeRefKeys, fullGraph);
      const intentionallyIsolated = keys.every((key) => {
        const node = fullGraph.getNodeAttributes(key) as ThreadGraphNode;
        return isolatedSystems.has(node.system);
      }) && isolatedSystems.size > 0;
      return {
        id,
        name,
        intentionallyIsolated,
        allNodeRefKeys,
        visibleNodeRefKeys,
      };
    },
  );

  // Step 6 — the visible dossier is one Graphology MultiDirectedGraph.
  const presentation = new MultiDirectedGraph<
    ThreadGraphNode,
    ThreadGraphEdge
  >();
  for (const node of visibleNodes) {
    const key = refKey(node.ref);
    if (!presentation.hasNode(key)) presentation.addNode(key, node);
  }
  for (const edge of visibleEdges) addThreadEdge(presentation, edge);

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    graph: presentation,
    components,
    rawNodeCount: raw.nodes.length,
    rawEdgeCount: raw.edges.length,

    componentOf(ref) {
      return componentIdByKey.get(refKey(ref));
    },

    boundedNeighborhood(ref, depth, direction = "both") {
      const root = refKey(ref);
      if (!presentation.hasNode(root)) {
        return { nodes: [], edges: [] };
      }
      const visited = new Set<string>([root]);
      const queue: Array<{ key: string; remaining: number }> = [
        { key: root, remaining: depth },
      ];
      while (queue.length > 0) {
        const item = queue.shift()!;
        if (item.remaining <= 0) continue;
        for (
          const neighbour of neighboursOn(presentation, item.key, direction)
        ) {
          if (visited.has(neighbour)) continue;
          visited.add(neighbour);
          queue.push({ key: neighbour, remaining: item.remaining - 1 });
        }
      }
      const resultNodes = [...visited]
        .map((k) => presentation.getNodeAttributes(k))
        .filter((n): n is ThreadGraphNode => n !== undefined);
      const resultEdges = visibleEdges.filter((e) => {
        const from = refKey(e.from);
        const to = refKey(e.to);
        return visited.has(from) && visited.has(to);
      });
      return {
        nodes: resultNodes,
        edges: resultEdges,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

function edgeOccurrenceKey(edge: ThreadGraphEdge): string {
  return [
    edge.id,
    refKey(edge.from),
    refKey(edge.to),
    edge.relation,
    edge.origin,
  ].join("\u0000");
}

function addThreadEdge(
  graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>,
  edge: ThreadGraphEdge,
): void {
  const from = refKey(edge.from);
  const to = refKey(edge.to);
  if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) return;
  const key = edgeOccurrenceKey(edge);
  if (graph.hasEdge(key)) return;
  graph.addEdgeWithKey(key, from, to, edge);
}

function isContextStructureRelation(
  relation: ThreadGraphRelation,
): boolean {
  return relation === "contains" || relation === "typed_by" ||
    relation === "represented_by";
}

function firstSorted(set: Set<string>): string | undefined {
  const sorted = [...set].sort();
  return sorted[0];
}

function maxEntry(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Names a connected graph component from literal recorded fields only. This
 * remains layout/legend metadata; it never parses a provider payload or
 * computes a domain result.
 */
function componentName(
  dominantSystem: string,
  allNodeRefKeys: ReadonlySet<string>,
  graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>,
): string {
  const kinds = new Set<string>();
  for (const key of allNodeRefKeys) {
    const node = graph.getNodeAttributes(key) as ThreadGraphNode;
    kinds.add(node.entityKind);
    if (node.artifactKind) kinds.add(node.artifactKind);
  }

  const systemLabel = dominantSystem;
  if (kinds.has("evaluation") || kinds.has("violation")) {
    return `${systemLabel} · verification`;
  }
  if (kinds.has("observation")) return `${systemLabel} · measurements`;
  if (kinds.has("requirement")) return `${systemLabel} · requirements`;
  if (kinds.has("step") || kinds.has("stl") || kinds.has("glb")) {
    return `${systemLabel} · geometry`;
  }
  return systemLabel;
}

function neighboursOn(
  graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>,
  key: string,
  direction: "both" | "upstream" | "downstream",
): readonly string[] {
  if (direction === "downstream") return graph.outNeighbors(key);
  if (direction === "upstream") return graph.inNeighbors(key);
  return graph.neighbors(key);
}
