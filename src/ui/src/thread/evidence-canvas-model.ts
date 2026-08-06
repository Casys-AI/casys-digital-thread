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
import { isSupportingNode } from "./essential-graph-filter.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Structural predicate for analyze.* instruments
// ---------------------------------------------------------------------------

/**
 * Returns true if `node` is an intermediate instrument artifact produced by a
 * sensitivity analysis run — one that should be folded out of the default
 * Evidence canvas but preserved as a stub link.
 *
 * Structural criterion (system + entityKind + id content):
 *   - entityKind "artifact"
 *   - system "build123d" or "calculix" (intermediate CAD/FEA steps)
 *   - ref.id contains "sensitivity" (encodes the operation family)
 *
 * Excluded from folding (kept visible):
 *   - The sensitivity capture artifact (digital-thread system)
 *   - Derivative observations (digital-thread system)
 *   - Anchored SysML declarations (syson system)
 */
export function isAnalyzeInstrumentNode(node: ThreadGraphNode): boolean {
  return (
    node.entityKind === "artifact" &&
    node.ref.id.includes("sensitivity") &&
    (node.system === "build123d" || node.system === "calculix")
  );
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
   * Count of supporting nodes present in the full visible projection.
   * These are hidden by the default "current-design" essential filter applied
   * by both the SVG carte (showSupporting=false) and the sigma exploration
   * renderer. Used by the banner to say "Z hors vue courante".
   *
   * Always 0 when isFiltered=true (local view already bounded).
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

  // supportingNodeCount is measured on the full visible set (before any
  // essential filter). The banner uses it to show "Z hors vue courante".
  const supportingNodeCount = model.nodes.filter(isSupportingNode).length;

  // Full graph (no focus): show all visible nodes + stubs.
  if (!focusRef) {
    return {
      nodes: model.nodes,
      edges: [...model.edges, ...model.stubs.map(stubToEdge)],
      displayedCount: model.nodes.length,
      foldedInstrumentCount,
      isFiltered: false,
      supportingNodeCount,
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

  // Fallback: full visible graph.
  return {
    nodes: model.nodes,
    edges: [...model.edges, ...model.stubs.map(stubToEdge)],
    displayedCount: model.nodes.length,
    foldedInstrumentCount,
    isFiltered: false,
    supportingNodeCount,
  };
}
