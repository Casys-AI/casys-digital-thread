/**
 * Canvas-level projection of the EvidenceGraphModel for the Evidence tab.
 *
 * Extracts the structural predicate and projection logic from workbench.tsx so
 * they are testable in Deno without React. The presentation (JSX) layer in
 * workbench.tsx calls these functions and passes the result to ThreadGraph.
 *
 * Design constraints (confirmed by operator, not renegotiable):
 * - Component names are derived structurally; no "EVIDENCE COMPONENT NN".
 * - Folding never severs a link: stubs bridge folded-out segments.
 * - Analyze.* instruments are identified by structural fields only (system +
 *   entityKind + id content), never by label or summary.
 * - Bounded neighbourhood is always COMPUTED at LOCAL_VIEW_MAX_DEPTH; the
 *   operator's visible-depth control (default 1) filters DISPLAY only via
 *   localDepthByRefKey, so depth changes never re-layout or reset the camera.
 */

import type {
  EvidenceGraphModel,
  EvidenceGraphStub,
} from "./evidence-graph-model.ts";
import { boundedLineageNeighborhood } from "./evidence-graph-model.ts";
import {
  applyEssentialFilter,
  type DisplayKind,
  isDisplayKindVisible,
  isSupportingNode,
} from "./essential-graph-filter.ts";
import {
  cadPresentationSiblingOf,
  compactCadPresentationPairs,
  mergePresentationCompacts,
} from "../cad/cad-presentation-projection.ts";
import {
  compactSysmlPartPairs,
  graphRefKey,
} from "../architecture/sysml-composite-projection.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Structural predicate for analyze.* instruments
// ---------------------------------------------------------------------------

/**
 * Server-fixed artifact id prefixes of the sensitivity *campaign* (experience
 * accumulated on a neighbourhood). Folded from Evidence so they do not paint
 * as a second construction study. Study-base evaluations stay visible: they
 * attach that experience to the Thread requirement they evaluate.
 */
const SENSITIVITY_CAMPAIGN_ARTIFACT_PREFIXES = [
  "sensitivity-case-",
  "sensitivity-study-",
  "sensitivity-edges-",
  "sensitivity-relations-",
  "sensitivity-base-evaluation-",
] as const;

/**
 * Returns true if `node` belongs to the analyze.* instrument family and should
 * be folded out of the default Evidence canvas, preserved only as a stub link.
 *
 * Structural criterion (system + entityKind + id content — never label or
 * summary):
 *
 * Artifacts:
 *   - ref.id starts with a sensitivity-campaign prefix (case, study, edges,
 *     relations, join capture) — any producer system
 *   - system "build123d" or "calculix" whose ref.id contains "sensitivity"
 *     (intermediate CAD/FEA steps of the instrument run)
 *
 *   Kept visible:
 *   - Study-base evaluations (`entityKind === "evaluation"`)
 *   - SysON model specs (including `sensitivity-oracle-requirements-*`)
 *   - Proof-run CalculiX artifacts without a sensitivity id
 *
 * Observations:
 *   - ref.id contains "sensitivity" (server-fixed prefix, never a label)
 *
 * Folding never severs a recorded path: a stub remains from the visible
 * construction node (admission, requirement) to the visible evaluation.
 */
export function isAnalyzeInstrumentNode(node: ThreadGraphNode): boolean {
  if (node.entityKind === "artifact") {
    if (
      SENSITIVITY_CAMPAIGN_ARTIFACT_PREFIXES.some((prefix) =>
        node.ref.id.startsWith(prefix)
      )
    ) {
      return true;
    }
    if (node.system === "build123d" || node.system === "calculix") {
      return node.ref.id.includes("sensitivity");
    }
    return false;
  }
  if (node.entityKind === "observation") {
    return node.ref.id.includes("sensitivity");
  }
  return false;
}

/**
 * Provider file envelopes whose essential counterpart is already on the
 * Thread: the authoritative STEP (geometry) and the extracted observations
 * (measures). `CalculiX input.step` is a byte-identical copy of the staged
 * STEP; `CalculiX result.json` is the raw solver container. Painting either
 * next to those facts looks like a second CAD product.
 *
 * Structural only (`artifactKind`). Never label or filename.
 */
const SOLVER_ENVELOPE_ARTIFACT_KINDS = new Set([
  "solver-input",
  "solver-result",
]);

export function isSolverEnvelopeNode(node: ThreadGraphNode): boolean {
  return node.entityKind === "artifact" &&
    node.artifactKind !== undefined &&
    SOLVER_ENVELOPE_ARTIFACT_KINDS.has(node.artifactKind);
}

/**
 * Default Evidence canvas fold. Campaign instruments stay experience, not
 * a second study. Solver envelopes stay inspector records, not dossier
 * products. The graph model emits stubs so a fold never severs a path.
 */
export function isFoldedEvidenceNode(node: ThreadGraphNode): boolean {
  return isAnalyzeInstrumentNode(node) || isSolverEnvelopeNode(node);
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
    rationale: `via ${stub.viaLabel} — folded`,
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
  /** Edges to pass to the canvas renderer (includes stub edges). */
  readonly edges: readonly ThreadGraphEdge[];
  /** Displayed node count (for the truthful counter in the banner). */
  readonly displayedCount: number;
  /**
   * Analyze.* instruments folded from the default view.
   * Computed from instrument folding only. Version folding is reported
   * separately by VersionedProvenanceProjection and must never be subtracted
   * here (the banner adds the two independent quantities).
   */
  readonly foldedInstrumentCount: number;
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
   * Local view only: ref keys of the supporting (plumbing) nodes in the
   * neighbourhood. Pure DISPLAY input for the burger toggle « éléments
   * digital thread » — hiding them never re-layouts. Undefined on the full
   * map, where the essential filter removes them upstream instead.
   */
  readonly localSupportingRefKeys?: ReadonlySet<string>;
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
 * 1. No focus → full folded visible graph (stubs bridging instruments).
 * 2. Focus on a visible node → bounded neighbourhood at the chosen depth (default 1).
 * 3. Focus on a historical (folded) node → neighbourhood of the visible
 *    representative via `visibleRefByMemberRef`; falls back to full graph.
 *
 * @param model                 EvidenceGraphModel (built with the structural predicate).
 * @param collapsedVersionCount From VersionedProvenanceProjection. The
 *                              evidence model has already folded these nodes,
 *                              so they must be excluded from the instrument
 *                              subtotal reported here.
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
  // pre-filtered result. No renderer applies the mask independently, and no
  // renderer gets its own reading: the two views must show the same facts.
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
    const compacted = compactEvidencePresentation(model, filtered);
    return {
      nodes: compacted.nodes,
      edges: compacted.edges,
      displayedCount: compacted.nodes.length,
      foldedInstrumentCount,
      isFiltered: false,
      // hiddenCount = supporting nodes removed by the filter; used by the
      // banner as "Z hors vue courante".
      supportingNodeCount: filtered.hiddenCount,
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
    return localProjection(
      model,
      focusRef,
      neighborhood,
      foldedInstrumentCount,
    );
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
      return localProjection(
        model,
        visibleRef,
        repNeighborhood,
        foldedInstrumentCount,
      );
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
  const compactedFallback = compactEvidencePresentation(
    model,
    filteredFallback,
  );
  return {
    nodes: compactedFallback.nodes,
    edges: compactedFallback.edges,
    displayedCount: compactedFallback.nodes.length,
    foldedInstrumentCount,
    isFiltered: false,
    supportingNodeCount: filteredFallback.hiddenCount,
  };
}

/**
 * The local neighbourhood is always computed at this depth; the operator's
 * 1/2/3 control filters DISPLAY only (default 1). Keeping computation and
 * display separate is what lets depth changes add nodes in place without a
 * re-layout or camera reset.
 */
export const LOCAL_VIEW_MAX_DEPTH = 3 as const;

function withCadPresentationSibling(
  model: EvidenceGraphModel,
  neighborhood: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  focusRef: ThreadGraphRef,
): {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
} {
  const siblingRef = cadPresentationSiblingOf(model, focusRef);
  if (!siblingRef) return neighborhood;
  const siblingKey = graphRefKey(siblingRef);
  if (neighborhood.nodes.some((node) => graphRefKey(node.ref) === siblingKey)) {
    return neighborhood;
  }
  const sibling = model.nodes.find((node) =>
    graphRefKey(node.ref) === siblingKey
  );
  if (!sibling) return neighborhood;
  const nodes = [...neighborhood.nodes, sibling];
  const visible = new Set(nodes.map((node) => graphRefKey(node.ref)));
  const existing = new Set(neighborhood.edges.map((edge) => edge.id));
  const extra = [
    ...model.edges,
    ...model.stubs.map(stubToEdge),
  ].filter((edge) =>
    visible.has(graphRefKey(edge.from)) &&
    visible.has(graphRefKey(edge.to)) &&
    !existing.has(edge.id)
  );
  return { nodes, edges: [...neighborhood.edges, ...extra] };
}

function compactEvidencePresentation(
  canonical: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  visible: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  expandedRef?: ThreadGraphRef,
) {
  const sysml = compactSysmlPartPairs(canonical, visible, expandedRef);
  const cad = compactCadPresentationPairs(canonical, sysml, expandedRef);
  return mergePresentationCompacts(sysml, cad);
}

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
 * Builds the local-view projection. The local view computes EVERYTHING
 * (essential facts AND supporting plumbing) and exposes two display maps —
 * localDepthByRefKey and localSupportingRefKeys — so the renderers can filter
 * without ever re-layouting:
 *
 *   - the 1/2/3 depth control (default 1) hides beyond-depth nodes in place;
 *   - the burger toggle « éléments digital thread » (operator decision
 *     2026-08-08, checked by default) shows or hides the supporting nodes in
 *     place. Showing them keeps inspector-list clicks landing on a visible
 *     node, which is the natural reading the operator asked for.
 */
function localProjection(
  model: EvidenceGraphModel,
  focusRef: ThreadGraphRef,
  neighborhood: {
    readonly nodes: readonly ThreadGraphNode[];
    readonly edges: readonly ThreadGraphEdge[];
  },
  foldedInstrumentCount: number,
): EvidenceCanvasProjection {
  const neighborhoodWithPair = withCadPresentationSibling(
    model,
    neighborhood,
    focusRef,
  );
  const depths = bfsDepths(focusRef, neighborhoodWithPair);
  const compacted = compactEvidencePresentation(
    model,
    neighborhoodWithPair,
    focusRef,
  );
  const compactedDepths = new Map<string, number>();
  for (const node of compacted.nodes) {
    const key = graphRefKey(node.ref);
    const memberKeys = compacted.memberRefKeysByCompositeRefKey.get(key) ??
      [key];
    const memberDepths = memberKeys.flatMap((memberKey) => {
      const depth = depths.get(memberKey);
      return depth === undefined ? [] : [depth];
    });
    if (memberDepths.length > 0) {
      compactedDepths.set(key, Math.min(...memberDepths));
    }
  }
  const supportingRefKeys = new Set<string>(
    compacted.nodes
      .filter((node) => isSupportingNode(node))
      .map((node) => graphRefKey(node.ref)),
  );

  return {
    nodes: compacted.nodes,
    edges: compacted.edges,
    displayedCount: compacted.nodes.length,
    foldedInstrumentCount,
    isFiltered: true,
    localDepthByRefKey: compactedDepths,
    localSupportingRefKeys: supportingRefKeys,
    supportingNodeCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Kind-based projection for the Exploration full-map view
// ---------------------------------------------------------------------------

/**
 * Builds a canvas projection filtered by DisplayKind for the Exploration
 * full-map view. Unlike the essential-filter projection, this applies the
 * operator's type toggles instead of the structural essential mask — each
 * DisplayKind can be individually shown or hidden.
 *
 * This projection triggers a dagre re-layout when the visible set changes
 * (the caller memoises it on visibleKinds). No in-place sigma reducer is
 * applied: the remount is intentional so the layout never shows gaps from
 * hidden-in-place nodes.
 *
 * @param model         EvidenceGraphModel (post-fold: instruments already
 *                      folded, versions collapsed into stubs).
 * @param visibleKinds  Record mapping each DisplayKind to its visibility flag.
 */
export function buildExplorationKindProjection(
  model: EvidenceGraphModel,
  visibleKinds: Record<DisplayKind, boolean>,
  collapsedVersionCount = 0,
): EvidenceCanvasProjection {
  const allEdges: ThreadGraphEdge[] = [
    ...(model.edges as ThreadGraphEdge[]),
    ...model.stubs.map(stubToEdge),
  ];
  // Exploration must start from exactly the same essential mask as Carte.
  // Applying the kind toggle to the raw model used to reintroduce mesh/script
  // islands.  A supporting node is retained only when it is still a connector
  // between two requested facts; hidden fact kinds are never traversed.
  const essential = applyEssentialFilter(
    model.nodes as ThreadGraphNode[],
    allEdges,
  );
  const requested = new Set(
    essential.nodes
      .filter((node) => isDisplayKindVisible(visibleKinds, node))
      .map((node) => `${node.ref.kind}:${node.ref.id}`),
  );
  const byKey = new Map<string, ThreadGraphNode>(essential.nodes.map((node) =>
    [
      `${node.ref.kind}:${node.ref.id}`,
      node,
    ] as const
  ));
  const adjacency = new Map<string, string[]>();
  for (const edge of essential.edges) {
    const from = `${edge.from.kind}:${edge.from.id}`;
    const to = `${edge.to.kind}:${edge.to.id}`;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    // A disabled non-supporting fact cannot silently become plumbing.
    if (!requested.has(to) && !isSupportingNode(byKey.get(to)!)) continue;
    if (!requested.has(from) && !isSupportingNode(byKey.get(from)!)) continue;
    adjacency.get(from)!.push(to);
    adjacency.get(to)!.push(from);
  }
  const visibleKeys = new Set(requested);
  const keys = [...requested].sort();
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const start = keys[i]!;
      const goal = keys[j]!;
      const previous = new Map<string, string | undefined>([[
        start,
        undefined,
      ]]);
      const queue = [start];
      while (queue.length && !previous.has(goal)) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current) ?? []) {
          if (!previous.has(next)) {
            previous.set(next, current);
            queue.push(next);
          }
        }
      }
      if (!previous.has(goal)) {
        continue;
      }
      for (
        let cursor: string | undefined = goal;
        cursor !== undefined;
        cursor = previous.get(cursor)
      ) visibleKeys.add(cursor);
    }
  }
  const visibleNodes = essential.nodes.filter((node) =>
    visibleKeys.has(`${node.ref.kind}:${node.ref.id}`)
  );
  const visibleEdges = essential.edges.filter((edge) =>
    visibleKeys.has(`${edge.from.kind}:${edge.from.id}`) &&
    visibleKeys.has(`${edge.to.kind}:${edge.to.id}`)
  );
  const hiddenByKind = essential.nodes.length - visibleNodes.length;
  const compacted = compactEvidencePresentation(model, {
    nodes: visibleNodes,
    edges: visibleEdges,
  });

  // foldedInstrumentCount: how many analyze.* instruments were folded by the
  // model pipeline. The model's raw count also includes historical versions
  // already collapsed by VersionedProvenanceProjection, so subtract those
  // first. The banner adds these two independent counts exactly once.
  const foldedInstrumentCount = Math.max(
    0,
    model.rawNodeCount - model.nodes.length - collapsedVersionCount,
  );

  return {
    nodes: compacted.nodes,
    edges: compacted.edges,
    displayedCount: compacted.nodes.length,
    foldedInstrumentCount,
    isFiltered: false,
    // supportingNodeCount carries the count of nodes hidden by type filter.
    // In full-map mode the banner reads this as "M masqués par type".
    supportingNodeCount: hiddenByKind,
  };
}
