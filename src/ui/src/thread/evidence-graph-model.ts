/**
 * Graphology-backed evidence presentation graph.
 *
 * This is the navigation model for Evidence, not Thread authority.
 * ThreadSnapshot + AnalysisGraph remain the source of truth. Graphology
 * never grants admission, a join, or an execution.
 *
 * Solves the false-island bug: connected components are computed on the FULL
 * raw graph, and folding (version supersession, analyze.* instruments) is
 * applied AFTER component assignment. A folded connector between two clusters
 * never silently drops their link — it leaves a stub edge that carries the
 * original relation and a human label describing what was folded.
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
 * `name` is derived structurally from the dominant producer system and entity
 * kind present in the component — never from a node label.
 * `intentionallyIsolated` marks components whose isolation from the main
 * cluster is expected (e.g. the thermal Modelica simulation family).
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

/**
 * A synthetic connector edge that preserves a link severed by folding.
 *
 * When an analyze.* instrument node that is the only path between two clusters
 * is folded out, a stub is emitted so the canvas can render a "via … — folded"
 * indicator instead of presenting a false island.
 */
export interface EvidenceGraphStub {
  readonly id: string;
  readonly from: ThreadGraphRef;
  readonly to: ThreadGraphRef;
  /** Human-readable label of the folded node, used as tooltip / moignon text. */
  readonly viaLabel: string;
  readonly relation: ThreadGraphRelation;
  readonly origin: ThreadGraphEdge["origin"];
}

export interface EvidenceGraphNeighborhood {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
}

export interface EvidenceGraphModel {
  /** Visible nodes for the default canvas (versioned + analyze* folded). */
  readonly nodes: readonly ThreadGraphNode[];
  /** Visible edges for the default canvas (versioned + stubs preserved). */
  readonly edges: readonly ThreadGraphEdge[];
  /**
   * Graphology presentation graph: the same visible nodes and recorded
   * edges, stored as a directed multigraph. Stubs stay a separate list so a
   * folded instrument never silently becomes a recorded Thread relation.
   * This graph is navigation only — never admission, join, or execution.
   */
  readonly graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>;
  /** Synthetic connector stubs for folded instruments bridging clusters. */
  readonly stubs: readonly EvidenceGraphStub[];
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
  // Add a bounded structural halo around the selected result and its
  // consequences. This lets a geometry bundle reveal the PartDefinition /
  // PartUsage identities of the CAD assets it published, while deliberately
  // avoiding a direction change through an upstream capture hub.
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
  const edges = [
    ...model.edges.filter((edge) =>
      nodeKeys.has(refKey(edge.from)) && nodeKeys.has(refKey(edge.to))
    ),
    ...upstream.edges.filter((edge) => edge.id.startsWith("stub:")),
    ...downstream.edges.filter((edge) => edge.id.startsWith("stub:")),
  ].filter((edge) => {
    const key = edgeOccurrenceKey(edge);
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    return true;
  });
  return { nodes, edges };
}

/**
 * Configuration for the evidence graph model.
 *
 * isAnalyzeInstrumentNode is the structural criterion for the analyze.* family.
 * Implementations MUST check against operation identifiers (e.g. prefix of
 * node.ref.id derived from the operation registration), never against
 * node.label or node.summary. The default predicate excludes nothing.
 */
export interface EvidenceGraphConfig {
  isAnalyzeInstrumentNode?: (node: ThreadGraphNode) => boolean;
  /**
   * Server IDs whose nodes form an intentionally isolated component.
   * Matched against node.system with exact equality.
   */
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
  const isInstrument = config.isAnalyzeInstrumentNode ?? (() => false);
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

  // Step 4 — identify analyze.* instrument nodes in the versioned projection.
  const instrumentRefKeys = new Set(
    afterVersioning.nodes
      .filter(isInstrument)
      .map((n) => refKey(n.ref)),
  );

  // Step 5 — compute visible nodes and edges (instruments removed).
  const visibleNodes = afterVersioning.nodes.filter(
    (n) => !instrumentRefKeys.has(refKey(n.ref)),
  );
  const visibleRefKeys = new Set(visibleNodes.map((n) => refKey(n.ref)));

  // Step 6 — compute visible edges.
  // An edge is visible when both endpoints are visible.
  // When an instrument node is the only path connecting two visible nodes,
  // we emit a stub that preserves the link for the renderer.
  const visibleEdges: ThreadGraphEdge[] = [];
  const stubs: EvidenceGraphStub[] = [];
  const stubIds = new Set<string>();

  for (const edge of afterVersioning.edges) {
    const fromKey = refKey(edge.from);
    const toKey = refKey(edge.to);
    const fromVisible = visibleRefKeys.has(fromKey);
    const toVisible = visibleRefKeys.has(toKey);

    if (fromVisible && toVisible) {
      visibleEdges.push(edge);
      continue;
    }

    // One or both endpoints are instruments — try to bridge visible neighbours.
    if (fromVisible && instrumentRefKeys.has(toKey)) {
      // `to` is an instrument: emit a stub for each visible node reachable
      // through `to` within the full graph.
      const toNode = nodeByRefKey(afterVersioning.nodes, toKey);
      const downstream = visibleNeighboursOf(
        toKey,
        fullGraph,
        visibleRefKeys,
        "downstream",
      );
      for (const targetKey of downstream) {
        if (targetKey === fromKey) continue;
        const target = nodeByRefKey(afterVersioning.nodes, targetKey) ??
          nodeByRefKey(raw.nodes, targetKey);
        if (!target) continue;
        const stubId = `stub:${fromKey}->${targetKey}`;
        if (stubIds.has(stubId)) continue;
        stubIds.add(stubId);
        stubs.push({
          id: stubId,
          from: edge.from,
          to: target.ref,
          viaLabel: toNode?.label ?? toKey,
          relation: edge.relation,
          origin: edge.origin,
        });
      }
      continue;
    }

    if (instrumentRefKeys.has(fromKey) && toVisible) {
      // `from` is an instrument: emit a stub from each visible upstream node.
      const fromNode = nodeByRefKey(afterVersioning.nodes, fromKey);
      const upstream = visibleNeighboursOf(
        fromKey,
        fullGraph,
        visibleRefKeys,
        "upstream",
      );
      for (const sourceKey of upstream) {
        if (sourceKey === toKey) continue;
        const source = nodeByRefKey(afterVersioning.nodes, sourceKey) ??
          nodeByRefKey(raw.nodes, sourceKey);
        if (!source) continue;
        const stubId = `stub:${sourceKey}->${toKey}`;
        if (stubIds.has(stubId)) continue;
        stubIds.add(stubId);
        stubs.push({
          id: stubId,
          from: source.ref,
          to: edge.to,
          viaLabel: fromNode?.label ?? fromKey,
          relation: edge.relation,
          origin: edge.origin,
        });
      }
    }
  }

  // Step 7 — build component descriptors with names and visibility sets.
  const components: EvidenceGraphComponent[] = componentNodeKeys.map(
    (keys, id) => {
      const allNodeRefKeys = new Set(keys);
      const visibleNodeRefKeys = new Set(
        keys.filter((k) => visibleRefKeys.has(k)),
      );
      // Dominant system: most frequent node.system value in this component.
      const systemCounts = new Map<string, number>();
      for (const k of keys) {
        const node = fullGraph.getNodeAttributes(k) as ThreadGraphNode;
        systemCounts.set(
          node.system,
          (systemCounts.get(node.system) ?? 0) + 1,
        );
      }
      const dominantSystem = maxEntry(systemCounts) ?? "unknown";
      const name = componentName(dominantSystem, allNodeRefKeys, fullGraph);
      const intentionallyIsolated = keys.every((k) => {
        const node = fullGraph.getNodeAttributes(k) as ThreadGraphNode;
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

  // Step 8 — the visible dossier is one Graphology MultiDirectedGraph.
  // Neighbourhood walks this graph; stubs stay off it so a folded
  // instrument cannot be mistaken for a recorded Thread edge.
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
    stubs,
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
      const resultStubEdges: ThreadGraphEdge[] = stubs
        .filter((s) => {
          const from = refKey(s.from);
          const to = refKey(s.to);
          return visited.has(from) && visited.has(to);
        })
        .map((s) => stubAsEdge(s));
      return {
        nodes: resultNodes,
        edges: [...resultEdges, ...resultStubEdges],
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

function nodeByRefKey(
  nodes: readonly ThreadGraphNode[],
  key: string,
): ThreadGraphNode | undefined {
  return nodes.find((n) => refKey(n.ref) === key);
}

/**
 * Returns the first visible nodes reachable from `key` through folded nodes
 * in one causal direction. Direction matters: treating a directed evidence
 * graph as undirected can manufacture reverse stubs and cycles that were
 * never recorded in the Thread.
 */
function visibleNeighboursOf(
  key: string,
  graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>,
  visibleRefKeys: Set<string>,
  direction: "downstream" | "upstream",
): Set<string> {
  const result = new Set<string>();
  const visited = new Set<string>([key]);
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbours = direction === "downstream"
      ? graph.outNeighbors(current)
      : graph.inNeighbors(current);
    for (const neighbour of neighbours) {
      if (visited.has(neighbour)) continue;
      visited.add(neighbour);
      if (visibleRefKeys.has(neighbour)) {
        result.add(neighbour);
        continue; // stop at first visible hop
      }
      queue.push(neighbour); // continue through invisible nodes
    }
  }
  return result;
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
 * Derives a human component name from the dominant producer system and the
 * entity kinds present. Uses only structural fields (system, entityKind,
 * artifactKind) — never node labels.
 */
function componentName(
  dominantSystem: string,
  allNodeRefKeys: ReadonlySet<string>,
  graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>,
): string {
  // Collect entity kinds.
  const kinds = new Set<string>();
  for (const key of allNodeRefKeys) {
    const node = graph.getNodeAttributes(key) as ThreadGraphNode;
    kinds.add(node.entityKind);
    if (node.artifactKind) kinds.add(node.artifactKind);
  }

  const systemLabel = SYSTEM_LABEL[dominantSystem] ?? dominantSystem;

  // Dominant entity kind heuristic.
  if (kinds.has("evaluation") || kinds.has("violation")) {
    return `${systemLabel} · verification`;
  }
  if (kinds.has("observation")) {
    return `${systemLabel} · measurements`;
  }
  if (kinds.has("requirement")) {
    return `${systemLabel} · requirements`;
  }
  if (kinds.has("step") || kinds.has("stl") || kinds.has("glb")) {
    return `${systemLabel} · geometry`;
  }
  return systemLabel;
}

const SYSTEM_LABEL: Record<string, string> = {
  "digital-thread": "Digital thread",
  "syson": "SysML",
  "build123d": "CAD",
  "calculix": "FEA",
  "openmodelica": "Thermal",
  "mcp-modelica": "Thermal",
  "modelica": "Thermal",
  "erpnext": "ERP",
};

function neighboursOn(
  graph: MultiDirectedGraph<ThreadGraphNode, ThreadGraphEdge>,
  key: string,
  direction: "both" | "upstream" | "downstream",
): readonly string[] {
  if (direction === "downstream") return graph.outNeighbors(key);
  if (direction === "upstream") return graph.inNeighbors(key);
  return graph.neighbors(key);
}

/**
 * Converts a stub into a ThreadGraphEdge for inclusion in neighbourhood
 * results. The id encodes the stub origin so callers can distinguish it.
 */
function stubAsEdge(stub: EvidenceGraphStub): ThreadGraphEdge {
  return {
    id: stub.id,
    from: stub.from,
    to: stub.to,
    relation: stub.relation,
    rationale: `via ${stub.viaLabel} — folded`,
    origin: stub.origin,
  };
}
