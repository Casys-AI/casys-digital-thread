/**
 * Preparation model for the sigma.js exploration renderer of the Evidence graph.
 *
 * Responsibilities (all pure, no I/O, no React):
 *   1. Build a graphology MultiDirectedGraph from an EvidenceCanvasProjection, assigning
 *      x/y positions via a deterministic dagre layout (rankdir: LR) — causal
 *      origins on the left, observations/verdicts on the right.
 *   2. Attach sigma-ready visual attributes to each node and edge (color, size,
 *      type, label). Stub edges get a "stub" type and a "via … — folded" label.
 *   3. Derive a legend of named components (EvidenceGraphComponent) with a count
 *      of their visible nodes in the current projection — never from layout coords.
 *
 * Why this lives here and not in the component:
 *   The component stays thin and testable. This module imports no browser APIs;
 *   colors come in as a CssTokens parameter so Deno tests can pass mock values.
 *
 * Layout strategy: the BFF already projects every relation in visual
 * dependency/source → result/consumer direction. The browser preserves that
 * exact direction before dagre receives the graph. dagre (rankdir: LR) assigns x = causal depth, y =
 * barycentric within each rank. The layout is synchronous and deterministic:
 * same inputs always yield the same positions. forceatlas2 is no longer used.
 */

// Vite (browser): résout graphology depuis node_modules et expose la classe.
// Deno (tests): résout via npm: dans l'import map de deno.json.
import { MultiDirectedGraph } from "graphology";
// @dagrejs/dagre: layout hiérarchique synchrone, ESM-compatible.
// deno.json référence "@dagrejs/dagre": "npm:@dagrejs/dagre@^3.1.0".
import dagreLib from "@dagrejs/dagre";
// deno-lint-ignore no-explicit-any
const dagre = dagreLib as any;
// essential-graph-filter: re-export the display-kind helpers so callers that
// import from this module get the full exploration API without knowing where
// each function lives internally.
export {
  DISPLAY_KIND_COLOR_TOKEN,
  DISPLAY_KIND_LABELS,
  type DisplayKind,
  displayKindOf,
  isDisplayKindVisible,
} from "./essential-graph-filter.ts";
import {
  DISPLAY_KIND_COLOR_TOKEN,
  displayKindOf,
} from "./essential-graph-filter.ts";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import {
  structuredOccurrenceKey,
  threadGraphEdgeRecordSignature,
} from "./versioned-provenance-model.ts";
import {
  displayedGraphEdgeOccurrenceKey,
  graphRelationAccessibleLabel,
} from "./graph-selection-model.ts";
import { isUiOnlyPresentationEdge } from "../cad/cad-presentation-projection.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/** A legend item describing one named evidence component. */
export interface ExplorationLegendItem {
  /**
   * All component ids that share this legend entry name.
   * Multiple model components may share the same structural name (e.g. when
   * the same dominant system produces several disconnected sub-graphs). The
   * chip focuses the camera on the union of all matching nodes.
   */
  readonly componentIds: readonly number[];
  /** Structural name derived from the full raw graph. */
  readonly name: string;
  readonly intentionallyIsolated: boolean;
  /** Number of visible nodes (after folding + essential filter) in this entry. */
  readonly visibleNodeCount: number;
  /**
   * Accent color for the legend chip — same color family used for the dominant
   * system inside this component.
   */
  readonly color: string;
}

/** Colour palette read from CSS custom properties at runtime. */
export interface CssTokens {
  readonly text: string;
  readonly surface0: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly lineStrong: string;
  readonly green: string;
  readonly amber: string;
  readonly red: string;
  readonly cyan: string;
  readonly blue: string;
  readonly violet: string;
  readonly muted: string;
}

/** Node attributes stored on the graphology graph for sigma. */
export interface SigmaNodeAttrs {
  /** Node ref key (kind:id) — used for reverse lookup on sigma click events. */
  refKey: string;
  /** ThreadGraphNode snapshot — for inspector hydration without extra lookup. */
  node: ThreadGraphNode;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  /** Component id for legend focus. */
  componentId: number | undefined;
}

/** Edge attributes stored on the graphology graph for sigma. */
export interface SigmaEdgeAttrs {
  /** Stable graphology key, unique even when recorded edge ids collide. */
  graphKey: string;
  /** Domain occurrence key used by the versioned projection and inspector. */
  occurrenceKey: string;
  /** Recorded relation id used by the domain inspector (not a graph key). */
  edgeId: string;
  /** Exact occurrence selected by Sigma, retained through the inspector. */
  edge: ThreadGraphEdge;
  /**
   * Every exact assertion represented by this one visual route. The first
   * member is `edge`; secondary members remain separately selectable in the
   * accessible evidence table.
   */
  memberEdges: readonly ThreadGraphEdge[];
  /** Occurrence identity for every member, used to highlight the shared route. */
  memberOccurrenceKeys: readonly string[];
  label: string;
  /** "stub" marks synthetic connector edges rendered with a dashed style. */
  edgeType: "regular" | "stub";
  color: string;
  size: number;
}

export interface ExplorationRelationRecord {
  readonly key: string;
  readonly occurrenceKey: string;
  readonly label: string;
  readonly accessibleLabel: string;
  readonly edgeId: string;
  readonly edge: ThreadGraphEdge;
  /** Visible disclosure when several exact assertions share one drawn route. */
  readonly visualRouteLabel?: string;
}

interface ExplorationVisualEdgeGroup {
  readonly primary: ThreadGraphEdge;
  readonly members: readonly ThreadGraphEdge[];
}

/** Prepared model consumed directly by the EvidenceExploration component. */
/**
 * Une entrée du regroupement par système producteur. Elle ne porte AUCUNE
 * couleur : le canvas peint par type d'enregistrement, pas par outil, et une
 * couleur d'outil ici serait un mapping que rien ne rend.
 */
export interface SystemLegendItem {
  /** Stable visual family id (e.g. "calculix"). */
  readonly system: string;
  /** Exact producer ids represented by this family; provenance stays distinct. */
  readonly systems: readonly string[];
  /** Human label (e.g. "FEA · CalculiX"). */
  readonly label: string;
  /** Number of visible nodes produced by this system. */
  readonly count: number;
}

export interface ExplorationModel {
  /**
   * A MultiDirectedGraph with all visual attributes already set.
   * Sigma consumes this instance directly — no conversion step.
   */
  readonly graph: MultiDirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>;
  /**
   * Legend deduplicated by component name. Multiple model components with the
   * same structural name are merged into a single entry — one chip, all nodes.
   */
  readonly legend: readonly ExplorationLegendItem[];
  /**
   * Tool color key derived from the VISIBLE nodes — one entry per visual tool
   * family present in the projection, with exact producer ids retained.
   */
  readonly systemLegend: readonly SystemLegendItem[];
  readonly tokens: CssTokens;
  /**
   * Count of supporting nodes hidden by the essential filter in full-map mode.
   * 0 when the projection is already a bounded local view (isFiltered=true).
   */
  readonly hiddenSupportingCount: number;
}

// ---------------------------------------------------------------------------
// Edge direction normalization
// ---------------------------------------------------------------------------

/**
 * Returns the visual direction already established by the BFF projection.
 * `ThreadGraphEdge.from` is dependency/source and `to` is result/consumer;
 * re-reading English relation names here used to reverse `traces_to` twice and
 * made geometry bundles absorb every build123d asset into a false star.
 *
 * This function is exported so tests can verify each relation's direction
 * independently of dagre internals.
 */
export function normalizeEdgeDirection(
  fromKey: string,
  toKey: string,
  _relation: ThreadGraphEdge["relation"],
): { from: string; to: string } {
  return { from: fromKey, to: toKey };
}

/**
 * Returns one drawing route for an exact redundant assertion pair while
 * retaining both recorded edge objects on the route.
 *
 * Only the projector-owned pairings below are eligible:
 *
 *   provenance `derived_from` + structural `input_to`
 *   provenance `derived_from` + structural `source_of`
 *
 * The structural assertion is the visual primary because it names the more
 * precise role. Any ambiguity, synthetic/UI route, incompatible endpoint
 * kind or attestation difference fails open and draws every assertion.
 */
export function buildExplorationVisualEdgeGroups(
  edges: readonly ThreadGraphEdge[],
): readonly ExplorationVisualEdgeGroup[] {
  const byDirectionalPair = new Map<string, ThreadGraphEdge[]>();
  for (const edge of edges) {
    const key = `${nodeKey(edge.from)}\u0000${nodeKey(edge.to)}`;
    const candidates = byDirectionalPair.get(key) ?? [];
    candidates.push(edge);
    byDirectionalPair.set(key, candidates);
  }

  const primaryBySecondary = new Map<ThreadGraphEdge, ThreadGraphEdge>();
  const secondaryByPrimary = new Map<ThreadGraphEdge, ThreadGraphEdge>();
  for (const candidates of byDirectionalPair.values()) {
    const derived = candidates.filter(isCollapsibleDerivedFrom);
    const structural = candidates.filter(isCollapsibleStructuralRelation);
    if (derived.length !== 1 || structural.length !== 1) continue;
    const secondary = derived[0]!;
    const primary = structural[0]!;
    if (!relationsDescribeSameRoute(primary)) continue;
    if (!sameAttestation(primary, secondary)) continue;
    primaryBySecondary.set(secondary, primary);
    secondaryByPrimary.set(primary, secondary);
  }

  return edges.flatMap((edge) => {
    if (primaryBySecondary.has(edge)) return [];
    const secondary = secondaryByPrimary.get(edge);
    return [{ primary: edge, members: secondary ? [edge, secondary] : [edge] }];
  });
}

/**
 * Builds the keyboard/table records from the complete projection, never from
 * Sigma's visual quotient. Therefore every assertion keeps its own exact id,
 * occurrence key, attestation and inspector action even when two assertions
 * share one canvas line.
 */
export function buildExplorationRelationRecords(
  edges: readonly ThreadGraphEdge[],
  visibleNodeKeys: ReadonlySet<string>,
  nodeLabelByKey: ReadonlyMap<string, string>,
): readonly ExplorationRelationRecord[] {
  const visibleEdges = edges.filter((edge) =>
    visibleNodeKeys.has(nodeKey(edge.from)) &&
    visibleNodeKeys.has(nodeKey(edge.to)) &&
    !isUiOnlyPresentationEdge(edge)
  );
  const keyFor = makeSigmaEdgeKeyFactory(visibleEdges);
  const groupByMember = new Map<ThreadGraphEdge, ExplorationVisualEdgeGroup>();
  for (const group of buildExplorationVisualEdgeGroups(visibleEdges)) {
    for (const member of group.members) groupByMember.set(member, group);
  }
  const records = visibleEdges.map((edge) => {
    const group = groupByMember.get(edge);
    const sharedRoute = group && group.members.length > 1
      ? `Shared canvas route: ${visualRouteLabel(group.members)}`
      : undefined;
    return {
      key: keyFor(edge),
      occurrenceKey: displayedGraphEdgeOccurrenceKey(edge),
      label: relationLabel(edge),
      edgeId: edge.id,
      edge,
      visualRouteLabel: sharedRoute,
    };
  }).sort((left, right) =>
    left.occurrenceKey.localeCompare(right.occurrenceKey) ||
    left.key.localeCompare(right.key)
  );
  return records.map((record, ordinal) => ({
    ...record,
    accessibleLabel: `${
      graphRelationAccessibleLabel(
        record.edge,
        nodeLabelByKey.get(nodeKey(record.edge.from)) ??
          nodeKey(record.edge.from),
        nodeLabelByKey.get(nodeKey(record.edge.to)) ??
          nodeKey(record.edge.to),
        ordinal,
      )
    }${record.visualRouteLabel ? ` ${record.visualRouteLabel}.` : ""}`,
  }));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds the sigma-ready ExplorationModel from the canonical evidence model
 * and the current canvas projection.
 *
 * Positions are assigned by dagre (rankdir: LR) — the layout is synchronous
 * and deterministic. No animation, no iterative spring force.
 *
 * @param evidenceModel   Full model including component detection.
 * @param projection      Current canvas projection (already filtered/focused).
 * @param tokens          CSS color tokens resolved at call time.
 * @param compact         Compact mode for the feed card vignette (default false).
 *                        Reduces dagre spacing so bounded-depth-2 neighbourhoods
 *                        (≤ ~20 nodes) fit in the 298 px-tall card container
 *                        without extreme zoom-out: nodesep 60→20, ranksep 100→50.
 *                        At normal zoom levels all labels remain readable and
 *                        nodes stay large enough to click.
 */
export function buildExplorationModel(
  evidenceModel: EvidenceGraphModel,
  projection: EvidenceCanvasProjection,
  tokens: CssTokens,
  compact = false,
): ExplorationModel {
  // Provenance can contain multiple independently recorded handoffs between
  // the same endpoints. A simple DirectedGraph silently overwrites/drops all
  // but one, which makes the inspector lie about the record.
  const graph = new MultiDirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>();

  // The essential display mask has been applied once, upstream, by
  // buildEvidenceCanvasProjection. Consume the pre-filtered projection directly:
  //   - Full-map (isFiltered=false): projection.nodes already excludes supporting
  //     nodes (mesh, script, solver-input, change events, consumption records),
  //     so the layout here starts from the essential set with no extra filtering.
  //   - Local view (isFiltered=true): all neighbours including supporting nodes
  //     are present for full inspector context — still no filtering here.
  //
  // hiddenSupportingCount is read from the projection (set by the upstream
  // filter call) so the banner counters remain consistent across both renderers.
  const displayNodes = projection.nodes as ThreadGraphNode[];
  const displayEdges = projection.edges as ThreadGraphEdge[];
  const hiddenSupportingCount = projection.supportingNodeCount;

  // Add nodes with placeholder positions (dagre will set the final x/y).
  for (const node of displayNodes) {
    const key = nodeKey(node.ref);
    const compId = evidenceModel.componentOf(node.ref);
    graph.addNode(key, {
      refKey: key,
      node,
      x: 0,
      y: 0,
      size: nodeSizeFor(node),
      color: nodeColorFor(node, tokens),
      label: explorationNodeLabel(node, evidenceModel),
      componentId: compId,
    });
  }

  // The projection stays complete and canonical. Sigma alone consumes this
  // drawing quotient, where one exact structural/provenance pair becomes one
  // route whose attributes retain both recorded assertions.
  const visualEdgeGroups = buildExplorationVisualEdgeGroups(displayEdges);
  const regularEdgeGroups = visualEdgeGroups.filter(
    ({ primary }) => !primary.id.startsWith("stub:"),
  );
  const stubEdgeGroups = visualEdgeGroups.filter(({ primary }) =>
    primary.id.startsWith("stub:")
  );

  // Graphology edge keys are graph-local occurrence keys, not domain ids:
  // historic imports may contain duplicate edge.id values. Keep edgeId on the
  // attrs for the inspector while assigning every rendered occurrence a
  // deterministic, collision-free key.
  const edgeKeyFor = makeSigmaEdgeKeyFactory(
    visualEdgeGroups.map(({ primary }) => primary),
  );

  // Add regular edges to the graphology graph.
  for (const { primary: edge, members } of regularEdgeGroups) {
    const from = nodeKey(edge.from);
    const to = nodeKey(edge.to);
    if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) continue;
    const graphKey = edgeKeyFor(edge);
    graph.addEdgeWithKey(graphKey, from, to, {
      graphKey,
      occurrenceKey: displayedGraphEdgeOccurrenceKey(edge),
      edgeId: edge.id,
      edge,
      memberEdges: members,
      memberOccurrenceKeys: members.map(displayedGraphEdgeOccurrenceKey),
      label: visualRouteLabel(members),
      edgeType: "regular",
      color: tokens.lineStrong,
      size: 2,
    });
  }

  // Add stub edges (dashed rendering cue for folded instruments).
  for (const { primary: edge, members } of stubEdgeGroups) {
    const from = nodeKey(edge.from);
    const to = nodeKey(edge.to);
    if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) continue;
    const graphKey = edgeKeyFor(edge);
    graph.addEdgeWithKey(graphKey, from, to, {
      graphKey,
      occurrenceKey: displayedGraphEdgeOccurrenceKey(edge),
      edgeId: edge.id,
      edge,
      memberEdges: members,
      memberOccurrenceKeys: members.map(displayedGraphEdgeOccurrenceKey),
      label: edge.rationale ?? `via ${edge.relation} — folded`,
      edgeType: "stub",
      color: tokens.muted,
      size: 1.5,
    });
  }

  // Apply dagre layered layout (LR = causal origins on the left).
  if (graph.order >= 1) {
    // deno-lint-ignore no-explicit-any
    const g: any = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      // Vertical gap between nodes within the same rank.
      // compact: 20 px — a depth-2 neighbourhood of ~13 siblings at the same
      // rank occupies 13×20 = 260 px, fitting inside the 298 px vignette
      // without sigma having to zoom way out. Full-map: 60 px.
      nodesep: compact ? 20 : 60,
      // Horizontal gap between adjacent causal layers.
      // compact: 50 px — 3 ranks × 50 = 150 px, comfortable in a wide card.
      ranksep: compact ? 50 : 100,
      marginx: compact ? 10 : 20,
      marginy: compact ? 10 : 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Register all nodes with an approximate bounding box for dagre.
    graph.forEachNode((key, attrs) => {
      g.setNode(key, dagreNodeBox(attrs.node));
    });

    // Feed the same visual quotient to dagre so a redundant assertion pair
    // cannot add layout weight or a second line between identical endpoints.
    for (const { primary: edge } of visualEdgeGroups) {
      const from = nodeKey(edge.from);
      const to = nodeKey(edge.to);
      if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) continue;
      const { from: dagFrom, to: dagTo } = normalizeEdgeDirection(
        from,
        to,
        edge.relation,
      );
      // Dagre ignores duplicate edges (same from/to); skip explicitly to avoid
      // the multigraph warning.
      if (g.hasEdge(dagFrom, dagTo)) continue;
      g.setEdge(dagFrom, dagTo);
    }

    dagre.layout(g);

    // Write dagre positions back into the graphology attributes.
    graph.forEachNode((key) => {
      // deno-lint-ignore no-explicit-any
      const pos: { x: number; y: number } | undefined = g.node(key) as any;
      if (pos) {
        graph.setNodeAttribute(key, "x", pos.x);
        graph.setNodeAttribute(key, "y", pos.y);
      }
    });
  }

  // Build legend from model components, deduplicated by structural name.
  //
  // Multiple model components can share the same structural name when the same
  // dominant system (e.g. "FEA", "Thermique") produces several disconnected
  // sub-graphs in the raw evidence. In that situation, showing 18 chips with
  // duplicate labels is misleading — it looks like 3 separate "Thermique"
  // branches when there is conceptually one thermal family. We merge by name:
  // one chip per unique structural name, accumulating all componentIds so the
  // camera-focus handler can jump to the union of all matching nodes.
  const legendByName = new Map<
    string,
    {
      componentIds: number[];
      visibleNodeCount: number;
      intentionallyIsolated: boolean;
      color: string;
    }
  >();
  for (const comp of evidenceModel.components) {
    const visibleNodeCount = [...comp.visibleNodeRefKeys].filter((k) =>
      graph.hasNode(k)
    ).length;
    if (visibleNodeCount === 0) continue;
    const color = componentColor(comp.name, tokens);
    const existing = legendByName.get(comp.name);
    if (existing) {
      existing.componentIds.push(comp.id);
      existing.visibleNodeCount += visibleNodeCount;
      // intentionallyIsolated: true only when ALL merged components are isolated.
      existing.intentionallyIsolated = existing.intentionallyIsolated &&
        comp.intentionallyIsolated;
    } else {
      legendByName.set(comp.name, {
        componentIds: [comp.id],
        visibleNodeCount,
        intentionallyIsolated: comp.intentionallyIsolated,
        color,
      });
    }
  }
  const legend: ExplorationLegendItem[] = [...legendByName.entries()].map(
    ([name, entry]) => ({
      componentIds: entry.componentIds,
      name,
      intentionallyIsolated: entry.intentionallyIsolated,
      visibleNodeCount: entry.visibleNodeCount,
      color: entry.color,
    }),
  );

  // Tool color key: one entry per visual tool family among the VISIBLE nodes.
  // Raw producer ids remain on each node and in `systems`, so grouping
  // `calculix` with `mcp-calculix` cannot erase provenance in the inspector.
  const systemCounts = new Map<
    string,
    { count: number; systems: Set<string> }
  >();
  for (const node of displayNodes) {
    const system = evidenceSystemFamily(node.system);
    const entry = systemCounts.get(system) ?? {
      count: 0,
      systems: new Set<string>(),
    };
    entry.count += 1;
    entry.systems.add(node.system);
    systemCounts.set(system, entry);
  }
  const systemLegend: SystemLegendItem[] = [...systemCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([system, entry]) => ({
      system,
      systems: [...entry.systems].sort(),
      label: SYSTEM_LEGEND_LABEL[system] ?? system,
      count: entry.count,
    }));

  return { graph, legend, systemLegend, tokens, hiddenSupportingCount };
}

/**
 * Human labels of the tool color key. Keys are the raw system ids recorded on
 * graph nodes; a system absent from this table keeps its raw id as label
 * (visible fallback, never a silent drop).
 */
const SYSTEM_LEGEND_LABEL: Record<string, string> = {
  "syson": "SysON · model",
  "build123d": "build123d · CAD",
  "build123d-sandbox": "build123d · CAD",
  "calculix": "CalculiX · FEA",
  "modelica": "Modelica · simulation",
  "openmodelica": "Modelica · simulation",
  "mcp-modelica": "Modelica · simulation",
  "erpnext": "ERPNext · ERP",
  "digital-thread": "Digital thread",
  "casys-digital-thread": "Digital thread · plan",
  "brief": "Brief · semantic concept",
  "sysml": "SysML · semantic concept",
  "cad": "CAD · semantic concept",
  "thread": "Thread · semantic concept",
};

/**
 * Canonical visual identity of one recorded producer system.
 *
 * This is deliberately presentation-only: `ThreadGraphNode.system` is never
 * rewritten. The two CalculiX ids describe different recorded layers of the
 * same solver family, so they share one color and legend entry while their
 * exact source ids remain inspectable.
 */
export function evidenceSystemFamily(system: string): string {
  const normalized = system.toLowerCase();
  if (normalized === "calculix" || normalized === "mcp-calculix") {
    return "calculix";
  }
  return system;
}

/**
 * Clarifies the sealed geometry-capture node without mutating its canonical
 * label or inventing a shortcut edge to the SysML model.
 *
 * A geometry bundle is recognized only from the recorded topology:
 *   architecture artifact -> geometry capture -> represented CAD assets,
 * with SysML PartUsage -> PartDefinition -> represented asset chains. The
 * count is therefore the number of explicit modeled usages, not text parsed
 * from a friendly label or artifact id.
 */
export function explorationNodeLabel(
  node: ThreadGraphNode,
  evidenceModel: EvidenceGraphModel,
): string {
  if (
    node.entityKind !== "artifact" || node.artifactKind !== "cad-model" ||
    node.system !== "digital-thread"
  ) {
    return node.label;
  }

  const nodeByRef = new Map(
    evidenceModel.nodes.map((candidate) => [nodeKey(candidate.ref), candidate]),
  );
  const geometryKey = nodeKey(node.ref);
  const hasArchitectureInput = evidenceModel.edges.some((edge) => {
    if (
      nodeKey(edge.to) !== geometryKey ||
      (edge.relation !== "derived_from" && edge.relation !== "input_to")
    ) {
      return false;
    }
    const source = nodeByRef.get(nodeKey(edge.from));
    return source?.entityKind === "artifact" &&
      source.artifactKind === "sysml-model";
  });
  if (!hasArchitectureInput) return node.label;

  const representedAssetKeys = new Set(
    evidenceModel.edges
      .filter((edge) =>
        edge.relation === "traces_to" && nodeKey(edge.from) === geometryKey
      )
      .map((edge) => nodeKey(edge.to)),
  );
  const representedDefinitionKeys = new Set(
    evidenceModel.edges
      .filter((edge) =>
        edge.relation === "represented_by" &&
        edge.from.kind === "part-definition" &&
        representedAssetKeys.has(nodeKey(edge.to))
      )
      .map((edge) => nodeKey(edge.from)),
  );
  const modeledUsageKeys = new Set(
    evidenceModel.edges
      .filter((edge) =>
        edge.relation === "typed_by" && edge.from.kind === "part-usage" &&
        representedDefinitionKeys.has(nodeKey(edge.to))
      )
      .map((edge) => nodeKey(edge.from)),
  );

  if (modeledUsageKeys.size === 0) return node.label;
  return `Geometry bundle · ${modeledUsageKeys.size} modeled part${
    modeledUsageKeys.size === 1 ? "" : "s"
  }`;
}

// ---------------------------------------------------------------------------
// CSS token reader (call in component mount, not at model-build time)
// ---------------------------------------------------------------------------

/**
 * A minimal duck-typed interface for the Element parameter of readCssTokens.
 * Using this instead of the browser's `Element` keeps the module compatible
 * with Deno (which has no lib.dom.d.ts in the default type configuration).
 */
export interface CssTokenSource {
  // A subset of Element sufficient to call getComputedStyle.
  readonly nodeType: number;
}

/**
 * Reads the CSS custom properties from :root at call time.
 * Returns a fallback palette when running outside a browser.
 *
 * Call this from the component mount handler, never at module load time.
 * Pass `document.documentElement` as `root`.
 */
export function readCssTokens(root: CssTokenSource | null): CssTokens {
  // deno-lint-ignore no-explicit-any
  const gcs = (globalThis as any).getComputedStyle;
  if (!root || typeof gcs !== "function") {
    return FALLBACK_TOKENS;
  }
  // deno-lint-ignore no-explicit-any
  const style = gcs(root as any);
  const get = (name: string, fallback: string): string =>
    (style.getPropertyValue(name) as string).trim() || fallback;
  return {
    text: get("--text", FALLBACK_TOKENS.text),
    surface0: get("--surface-0", FALLBACK_TOKENS.surface0),
    surface1: get("--surface-1", FALLBACK_TOKENS.surface1),
    surface2: get("--surface-2", FALLBACK_TOKENS.surface2),
    lineStrong: get("--line-strong", FALLBACK_TOKENS.lineStrong),
    green: get("--green", FALLBACK_TOKENS.green),
    amber: get("--amber", FALLBACK_TOKENS.amber),
    red: get("--red", FALLBACK_TOKENS.red),
    cyan: get("--cyan", FALLBACK_TOKENS.cyan),
    blue: get("--blue", FALLBACK_TOKENS.blue),
    violet: get("--violet", FALLBACK_TOKENS.violet),
    muted: get("--muted", FALLBACK_TOKENS.muted),
  };
}

/** Fallback palette matching the light atelier theme hardcoded values. */
export const FALLBACK_TOKENS: CssTokens = {
  text: "#20302d",
  surface0: "#f8f6f0",
  surface1: "#fffdfa",
  surface2: "#f3f0e8",
  lineStrong: "#93948c",
  green: "#367553",
  amber: "#a35b27",
  red: "#b6453d",
  cyan: "#2c7180",
  blue: "#416f8a",
  violet: "#69577c",
  muted: "#63706a",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

function isCollapsibleDerivedFrom(edge: ThreadGraphEdge): boolean {
  return isRecordedCanvasEdge(edge) && edge.origin === "provenance" &&
    edge.relation === "derived_from";
}

function isCollapsibleStructuralRelation(edge: ThreadGraphEdge): boolean {
  return isRecordedCanvasEdge(edge) && edge.origin === "structure" &&
    (edge.relation === "input_to" || edge.relation === "source_of");
}

function isRecordedCanvasEdge(edge: ThreadGraphEdge): boolean {
  return !edge.id.startsWith("stub:") && !isUiOnlyPresentationEdge(edge) &&
    edge.analysis === undefined;
}

function relationsDescribeSameRoute(edge: ThreadGraphEdge): boolean {
  if (edge.relation === "input_to") {
    return edge.from.kind === "artifact" && edge.to.kind === "artifact";
  }
  return edge.relation === "source_of" && edge.from.kind === "artifact" &&
    edge.to.kind === "observation";
}

function sameAttestation(
  left: ThreadGraphEdge,
  right: ThreadGraphEdge,
): boolean {
  const a = left.attestation;
  const b = right.attestation;
  if (!a || !b) return a === b;
  return a.consumptionId === b.consumptionId && a.status === b.status &&
    a.producerFingerprint === b.producerFingerprint &&
    a.consumedFingerprint === b.consumedFingerprint &&
    a.checkedAt === b.checkedAt;
}

function relationLabel(edge: ThreadGraphEdge): string {
  return edge.relation.replaceAll("_", " ").replaceAll("-", " ");
}

function visualRouteLabel(members: readonly ThreadGraphEdge[]): string {
  const relations = members.map(relationLabel);
  return members.length === 1
    ? relations[0]!
    : `${relations.join(" + ")} · ${members.length} recorded assertions`;
}

/**
 * Makes graph-local edge keys. A domain edge id is only unique by convention,
 * so it must never be handed directly to MultiDirectedGraph. The signature
 * makes different duplicated ids deterministic; the ordinal preserves each
 * genuinely identical recorded occurrence too.
 */
function makeSigmaEdgeKeyFactory(
  edges: readonly ThreadGraphEdge[],
): (edge: ThreadGraphEdge) => string {
  const countBySignature = new Map<string, number>();
  for (const edge of edges) {
    const signature = threadGraphEdgeRecordSignature(edge);
    countBySignature.set(signature, (countBySignature.get(signature) ?? 0) + 1);
  }
  const occurrenceBySignature = new Map<string, number>();
  return (edge) => {
    const signature = threadGraphEdgeRecordSignature(edge);
    const occurrence = occurrenceBySignature.get(signature) ?? 0;
    occurrenceBySignature.set(signature, occurrence + 1);
    return (countBySignature.get(signature) ?? 0) > 1
      ? structuredOccurrenceKey("sigma-edge", [signature, occurrence])
      : structuredOccurrenceKey("sigma-edge", [signature]);
  };
}

/**
 * Node visual size. Requirements and verdicts deserve emphasis. Attribute and
 * CAD literal holes stay smaller than parts and artifacts.
 */
export function nodeSizeFor(node: ThreadGraphNode): number {
  switch (node.entityKind) {
    case "evaluation":
    case "requirement":
    case "violation":
      return 14;
    case "observation":
    case "analysis-node":
      return 10;
    case "artifact":
      return 8;
    case "attribute-usage":
    case "cad-lever":
    case "cad-unnamed-literal":
      return 4;
    default:
      return 7;
  }
}

function dagreNodeBox(
  node: ThreadGraphNode,
): { width: number; height: number } {
  if (
    node.entityKind === "attribute-usage" ||
    node.entityKind === "cad-lever" ||
    node.entityKind === "cad-unnamed-literal"
  ) {
    return { width: 72, height: 24 };
  }
  return { width: 120, height: 40 };
}

/**
 * Node color per dominant system. Colours match the thread-blue/green/amber
 * tokens so the graph reads as the same design system as the SVG canvas.
 */
/**
 * La couleur d'un nœud vient de son TYPE d'enregistrement, pas du système qui
 * l'a produit : un provider est un moyen remplaçable, la nature de la preuve
 * ne l'est pas. C'est aussi ce qui rend la légende TYPES exacte — auparavant
 * elle affichait la couleur d'outil majoritaire d'un type et mentait donc
 * pour ses nœuds minoritaires.
 */
function nodeColorFor(node: ThreadGraphNode, tokens: CssTokens): string {
  return tokens[DISPLAY_KIND_COLOR_TOKEN[displayKindOf(node)]];
}

export interface EvidenceMinimapNode {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

export interface EvidenceMinimapView {
  readonly nodes: readonly EvidenceMinimapNode[];
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly width: number;
  readonly height: number;
  /** Box of local-view keys that also exist on the full map — never invented. */
  readonly localBounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Projects the already-laid-out full map into a minimap. Positions come from
 * dagre on the recorded graph — this never invents nodes, edges, or a second
 * organisation of the dossier.
 */
export function buildEvidenceMinimapView(
  fullMapModel: ExplorationModel,
  localRefKeys?: ReadonlySet<string>,
): EvidenceMinimapView {
  const nodes: EvidenceMinimapNode[] = [];
  fullMapModel.graph.forEachNode((key, attrs) => {
    nodes.push({
      key,
      x: attrs.x,
      y: attrs.y,
      color: attrs.color,
    });
  });
  if (nodes.length === 0) {
    return { nodes: [], nodeCount: 0, edgeCount: 0, width: 132, height: 64 };
  }
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 8;
  const rawWidth = Math.max(maxX - minX, 1);
  const rawHeight = Math.max(maxY - minY, 1);
  const width = 132;
  const height = Math.max(48, Math.round(width * (rawHeight / rawWidth)));
  const scaleX = (width - pad * 2) / rawWidth;
  const scaleY = (height - pad * 2) / rawHeight;
  const project = (x: number, y: number) => ({
    x: pad + (x - minX) * scaleX,
    y: pad + (y - minY) * scaleY,
  });
  const projected = nodes.map((node) => ({
    ...node,
    ...project(node.x, node.y),
  }));
  const local = localRefKeys
    ? projected.filter((node) => localRefKeys.has(node.key))
    : [];
  let localBounds: EvidenceMinimapView["localBounds"];
  if (local.length > 0) {
    const localXs = local.map((node) => node.x);
    const localYs = local.map((node) => node.y);
    const x = Math.min(...localXs) - 4;
    const y = Math.min(...localYs) - 4;
    localBounds = {
      x,
      y,
      width: Math.max(Math.max(...localXs) - x + 4, 8),
      height: Math.max(Math.max(...localYs) - y + 4, 8),
    };
  }
  return {
    nodes: projected,
    nodeCount: projected.length,
    edgeCount: fullMapModel.graph.size,
    width,
    height,
    localBounds,
  };
}

function componentColor(name: string, tokens: CssTokens): string {
  if (name.startsWith("SysML")) return tokens.cyan;
  if (name.startsWith("CAD")) return tokens.amber;
  if (name.startsWith("FEA")) return tokens.red;
  if (name.startsWith("Thermal")) return tokens.violet;
  if (name.startsWith("ERP")) return tokens.blue;
  if (name.startsWith("Digital thread")) return tokens.green;
  return tokens.muted;
}
