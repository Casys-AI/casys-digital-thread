/**
 * Canvas-level projection of the EvidenceGraphModel for the Evidence tab.
 *
 * Extracts the structural predicate and projection logic from workbench.tsx so
 * they are testable in Deno without Preact. The presentation (JSX) layer in
 * workbench.tsx calls these functions and passes the result to ThreadGraph.
 *
 * Design constraints (confirmed by operator, not renegotiable):
 * - Component names are derived structurally; no "EVIDENCE COMPONENT NN".
 * - Folding never severs a link: stubs bridge folded-out segments.
 * - Analyze.* instruments are identified by structural fields only (system +
 *   entityKind + id content), never by label or summary.
 * - Bounded neighbourhood is depth 3 in both directions from the inspector
 *   selection when a focus is active.
 */

import type {
  EvidenceGraphModel,
  EvidenceGraphStub,
} from "./evidence-graph-model.ts";
import { applyEssentialFilter } from "./essential-graph-filter.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Structural predicate for analyze.* instruments
// ---------------------------------------------------------------------------

/**
 * Returns true if `node` belongs to the analyze.* instrument family and should
 * be folded out of the default Evidence canvas, preserved only as a stub link.
 *
 * Structural criterion (system + entityKind + id content — never label or summary):
 *
 * Artifacts:
 *   - entityKind "artifact"
 *   - system "build123d" or "calculix" (intermediate CAD/FEA steps)
 *     → ref.id contains "sensitivity" (server-fixed operation-family prefix)
 *   - system "syson" with ref.id starting with "sensitivity-relations-" or
 *     "sensitivity-edges-" (SysML structural trace declarations anchored by the
 *     analyze.* run — not independent model specifications)
 *
 *   Excluded from artifact folding (kept visible):
 *   - The sensitivity capture artifact (digital-thread system)
 *   - All other syson elements (model specifications, requirements, etc.)
 *
 * Observations:
 *   - entityKind "observation"
 *   - ref.id contains "sensitivity" (server-fixed prefix shared with the source
 *     artifact, e.g. "drip-tray-sensitivity-<digest>-displacement")
 *
 *   Rationale: observations produced by the analyze.* family are intermediate
 *   measurements — facts about the instrument run, not about the current design.
 *   The validated rule is "facts produced by the analyze.* family hors vitrine,
 *   products included". The structural signal is the server-fixed id prefix,
 *   never a label or summary.
 *
 *   Excluded from observation folding:
 *   - Any observation whose ref.id does not contain "sensitivity" (the id is
 *     controlled server-side; no free-text criterion is used here).
 */
export function isAnalyzeInstrumentNode(node: ThreadGraphNode): boolean {
  if (node.entityKind === "artifact") {
    // Intermediate CAD/FEA steps produced by the sensitivity instrument run.
    if (node.system === "build123d" || node.system === "calculix") {
      return node.ref.id.includes("sensitivity");
    }
    // SysML structural trace declarations anchored by the analyze.* run.
    // The server-fixed id prefixes "sensitivity-relations-" and
    // "sensitivity-edges-" identify these elements uniquely; all other syson
    // elements (model specs, requirements, DripTray geometry) are kept visible.
    if (node.system === "syson") {
      return (
        node.ref.id.startsWith("sensitivity-relations-") ||
        node.ref.id.startsWith("sensitivity-edges-")
      );
    }
    return false;
  }
  if (node.entityKind === "observation") {
    // Sensitivity observations share the same server-fixed id prefix as their
    // source artifact. The criterion is structural: presence of "sensitivity"
    // in the stable ref.id — never derived from label, summary, or system name.
    return node.ref.id.includes("sensitivity");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Stub → edge conversion (for renderers that only understand ThreadGraphEdge)
// ---------------------------------------------------------------------------

/**
 * Converts a stub into a ThreadGraphEdge for the canvas renderer.
 * The "stub:" id prefix lets callers distinguish synthetic connectors from
 * canonical edges if needed.
 */
export function stubToEdge(stub: EvidenceGraphStub): ThreadGraphEdge {
  return {
    id: stub.id,
    from: stub.from,
    to: stub.to,
    relation: stub.relation,
    rationale: `via ${stub.viaLabel} — replié`,
    origin: stub.origin,
  };
}

// ---------------------------------------------------------------------------
// Component labeler
// ---------------------------------------------------------------------------

/**
 * Returns the named component label for a set of nodes in a layout component.
 *
 * Looks up each node's component in the EvidenceGraphModel (computed on the
 * full raw graph), collects all matching component names, and returns the most
 * frequent one. Falls back to "Preuves liées" for a single component or
 * "Preuves" for unknown islands.
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
      return isOnlyComponent ? "Preuves liées" : "Preuves";
    }
    // Collect model component names for all nodes in this layout component.
    const nameCounts = new Map<string, number>();
    for (const node of nodes) {
      const compId = model.componentOf(node.ref);
      const comp = compId !== undefined
        ? model.components.find((c) => c.id === compId)
        : undefined;
      const name = comp?.name ?? "Preuves";
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    // Return the most frequent name.
    let best = isOnlyComponent ? "Preuves liées" : "Preuves";
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
  /** Edges to pass to the canvas renderer (includes stub edges). */
  readonly edges: readonly ThreadGraphEdge[];
  /** Displayed node count (for the truthful counter in the banner). */
  readonly displayedCount: number;
  /**
   * Analyze.* instruments folded from the default view.
   * Computed as max(0, rawNodeCount - visibleNodes - collapsedVersionCount).
   */
  readonly foldedInstrumentCount: number;
  /** True when the canvas shows a bounded neighbourhood instead of the full graph. */
  readonly isFiltered: boolean;
  /**
   * Count of supporting nodes HIDDEN by the essential filter in the full-map
   * view. The essential filter is applied once, upstream, by
   * buildEvidenceCanvasProjection — both the SVG carte (ThreadGraph) and the
   * sigma exploration renderer (EvidenceExploration) consume the same
   * already-filtered projection and never re-apply the filter independently.
   * Used by the banner to say "Z hors vue courante".
   *
   * Always 0 when isFiltered=true (local view; essential filter not applied,
   * all neighbours including supporting are shown for full inspector context).
   */
  readonly supportingNodeCount: number;
}

/**
 * Computes the canvas projection for the Evidence tab.
 *
 * Rules (non-negotiable):
 * 1. No focus → full folded visible graph (stubs bridging instruments).
 * 2. Focus on a visible node → bounded neighbourhood at depth 3.
 * 3. Focus on a historical (folded) node → neighbourhood of the visible
 *    representative via `visibleRefByMemberRef`; falls back to full graph.
 *
 * @param model                 EvidenceGraphModel (built with the structural predicate).
 * @param collapsedVersionCount From VersionedProvenanceProjection.
 * @param focusRef              Inspector selection (lineageFocus state).
 * @param visibleRefByMemberRef Map from historical ref key to visible ref.
 */
export function buildEvidenceCanvasProjection(
  model: EvidenceGraphModel,
  collapsedVersionCount: number,
  focusRef: ThreadGraphRef | undefined,
  visibleRefByMemberRef: ReadonlyMap<string, ThreadGraphRef>,
): EvidenceCanvasProjection {
  const foldedInstrumentCount = Math.max(
    0,
    model.rawNodeCount - model.nodes.length - collapsedVersionCount,
  );

  // Full graph (no focus): apply the essential display mask once, here.
  //
  // Both renderers — SVG carte (ThreadGraph) and sigma exploration
  // (EvidenceExploration / buildExplorationModel) — consume this single
  // pre-filtered result. No renderer applies the mask independently.
  //
  // The mask removes supporting nodes (mesh, script, solver-input, change
  // events, consumption records) but preserves any supporting connector that
  // is the sole path between two essential nodes, so no genuine link is lost.
  //
  // Local views (isFiltered=true) are exempt: they show all neighbours
  // including supporting ones so the inspector context is complete.
  if (!focusRef) {
    const allEdges: ThreadGraphEdge[] = [
      ...(model.edges as ThreadGraphEdge[]),
      ...model.stubs.map(stubToEdge),
    ];
    const filtered = applyEssentialFilter(
      model.nodes as ThreadGraphNode[],
      allEdges,
    );
    return {
      nodes: filtered.nodes,
      edges: filtered.edges,
      displayedCount: filtered.nodes.length,
      foldedInstrumentCount,
      isFiltered: false,
      // hiddenCount = supporting nodes removed by the filter; used by the
      // banner as "Z hors vue courante".
      supportingNodeCount: filtered.hiddenCount,
    };
  }

  // Focus on a visible node: bounded neighbourhood at depth 3.
  const neighborhood = model.boundedNeighborhood(focusRef, 3);
  if (neighborhood.nodes.length > 0) {
    return {
      nodes: neighborhood.nodes,
      edges: neighborhood.edges,
      displayedCount: neighborhood.nodes.length,
      foldedInstrumentCount,
      isFiltered: true,
      supportingNodeCount: 0, // local view: essential filter not applied.
    };
  }

  // Historical node: map to visible representative.
  const focusKey = `${focusRef.kind}:${focusRef.id}`;
  const visibleRef = visibleRefByMemberRef.get(focusKey);
  if (visibleRef) {
    const repNeighborhood = model.boundedNeighborhood(visibleRef, 3);
    if (repNeighborhood.nodes.length > 0) {
      return {
        nodes: repNeighborhood.nodes,
        edges: repNeighborhood.edges,
        displayedCount: repNeighborhood.nodes.length,
        foldedInstrumentCount,
        isFiltered: true,
        supportingNodeCount: 0, // local view: essential filter not applied.
      };
    }
  }

  // Fallback: full visible graph (same essential-filter path as the no-focus case).
  const allEdgesFallback: ThreadGraphEdge[] = [
    ...(model.edges as ThreadGraphEdge[]),
    ...model.stubs.map(stubToEdge),
  ];
  const filteredFallback = applyEssentialFilter(
    model.nodes as ThreadGraphNode[],
    allEdgesFallback,
  );
  return {
    nodes: filteredFallback.nodes,
    edges: filteredFallback.edges,
    displayedCount: filteredFallback.nodes.length,
    foldedInstrumentCount,
    isFiltered: false,
    supportingNodeCount: filteredFallback.hiddenCount,
  };
}
