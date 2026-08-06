/**
 * Preparation model for the sigma.js exploration renderer of the Evidence graph.
 *
 * Responsibilities (all pure, no I/O, no Preact):
 *   1. Build a graphology DirectedGraph from an EvidenceCanvasProjection, assigning
 *      x/y positions via a deterministic dagre layout (rankdir: LR) — causal
 *      origins on the left, observations/verdicts on the right.
 *   2. Attach sigma-ready visual attributes to each node and edge (color, size,
 *      type, label). Stub edges get a "stub" type and a "via … — replié" label.
 *   3. Derive a legend of named components (EvidenceGraphComponent) with a count
 *      of their visible nodes in the current projection — never from layout coords.
 *
 * Why this lives here and not in the component:
 *   The component stays thin and testable. This module imports no browser APIs;
 *   colors come in as a CssTokens parameter so Deno tests can pass mock values.
 *
 * Layout strategy: every relation type is normalized to a canonical
 * upstream → downstream direction (see normalizeEdgeDirection) before dagre
 * receives the graph. dagre (rankdir: LR) assigns x = causal depth, y =
 * barycentric within each rank. The layout is synchronous and deterministic:
 * same inputs always yield the same positions. forceatlas2 is no longer used.
 */

// Vite (browser): résout graphology depuis node_modules et expose la classe.
// Deno (tests): résout via npm: dans l'import map de deno.json.
import { DirectedGraph } from "graphology";
// @dagrejs/dagre: layout hiérarchique synchrone, ESM-compatible.
// deno.json référence "@dagrejs/dagre": "npm:@dagrejs/dagre@^3.1.0".
// deno-lint-ignore no-explicit-any
import dagreLib from "@dagrejs/dagre";
// deno-lint-ignore no-explicit-any
const dagre = dagreLib as any;
// essential-graph-filter is no longer imported here: the mask is applied once,
// upstream, by buildEvidenceCanvasProjection. Both renderers (Carte and
// Exploration) consume the same pre-filtered EvidenceCanvasProjection.
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
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
  edgeId: string;
  label: string;
  /** "stub" marks synthetic connector edges rendered with a dashed style. */
  edgeType: "regular" | "stub";
  color: string;
  size: number;
}

/** Prepared model consumed directly by the EvidenceExploration component. */
export interface ExplorationModel {
  /**
   * A DirectedGraph with all visual attributes already set.
   * Sigma consumes this instance directly — no conversion step.
   */
  readonly graph: DirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>;
  /**
   * Legend deduplicated by component name. Multiple model components with the
   * same structural name are merged into a single entry — one chip, all nodes.
   */
  readonly legend: readonly ExplorationLegendItem[];
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
 * Normalizes a directed edge to the canonical causal direction for the dagre
 * layout. Returns { from, to } where `from` is always causally UPSTREAM
 * (rendered on the LEFT) and `to` is always causally DOWNSTREAM (rendered on
 * the RIGHT).
 *
 * Every relation type is documented explicitly. Direction is never inferred
 * from heuristics or guessed — each case names who is upstream of whom.
 *
 * This function is exported so tests can verify each relation's direction
 * independently of dagre internals.
 */
export function normalizeEdgeDirection(
  fromKey: string,
  toKey: string,
  relation: ThreadGraphEdge["relation"],
): { from: string; to: string } {
  switch (relation) {
    /**
     * Data convention verified on the live r104 graph (2026-08-06): these
     * relations are already stored flow-oriented — edge.from is causally
     * UPSTREAM, edge.to is DOWNSTREAM. No reversal.
     *
     * input_to     : model-container --input_to-->     architecture-model
     * source_of    : computed-evidence --source_of-->  observation
     * changes      : change-record --changes-->        produced-artifact
     * derived_from : model-container --derived_from--> architecture-model
     *                (the relation NAME reads backwards; the stored direction
     *                 is source → derived — verified on all 65 live edges)
     * uses         : source-artifact --uses-->         input-attestation
     * evaluates    : requirement --evaluates-->        evaluation-record
     * evidences    : result-artifact --evidences-->    evaluation-record
     */
    case "input_to":
    case "source_of":
    case "changes":
    case "derived_from":
    case "uses":
    case "evaluates":
    case "evidences":
      return { from: fromKey, to: toKey };

    /**
     * These relations are stored downstream → upstream and must be reversed
     * so the causal origin lands on the left.
     *
     * supersedes : newer --supersedes--> older (English reading; verified:
     *              the @2 CAD plan supersedes the r8 correction record).
     *              Version history reads left → right, so dagre gets
     *              older → newer.
     * traces_to  : implementation-artifact --traces_to--> requirement.
     *              The requirement is the upstream specification.
     * caused_by  : effect --caused_by--> cause (no live occurrence on r104;
     *              direction from the relation's English reading).
     * addresses  : fix --addresses--> issue (no live occurrence on r104;
     *              direction from the relation's English reading).
     */
    case "supersedes":
    case "traces_to":
    case "caused_by":
    case "addresses":
      return { from: toKey, to: fromKey };

    /**
     * Unknown relation: keep the stored direction rather than guessing.
     */
    default:
      return { from: fromKey, to: toKey };
  }
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
  const graph = new DirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>();

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
      label: node.label,
      componentId: compId,
    });
  }

  // Separate regular edges from synthetic stubs.
  const regularEdges = (displayEdges as ThreadGraphEdge[]).filter(
    (e) => !e.id.startsWith("stub:"),
  );
  const stubEdges = (displayEdges as ThreadGraphEdge[]).filter((e) =>
    e.id.startsWith("stub:")
  );

  // Add regular edges to the graphology graph.
  for (const edge of regularEdges) {
    const from = nodeKey(edge.from);
    const to = nodeKey(edge.to);
    if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) continue;
    if (graph.hasEdge(from, to)) continue;
    graph.addEdge(from, to, {
      edgeId: edge.id,
      label: edge.relation.replaceAll("_", " "),
      edgeType: "regular",
      color: tokens.lineStrong,
      size: 2,
    });
  }

  // Add stub edges (dashed rendering cue for folded instruments).
  for (const edge of stubEdges) {
    const from = nodeKey(edge.from);
    const to = nodeKey(edge.to);
    if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) continue;
    if (graph.hasEdge(from, to)) continue;
    graph.addEdge(from, to, {
      edgeId: edge.id,
      label: edge.rationale ?? `via ${edge.relation} — replié`,
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
    graph.forEachNode((key) => {
      g.setNode(key, { width: 120, height: 40 });
    });

    // Feed normalized edges to dagre. Use all projection edges (both regular
    // and stubs) so isolated nodes get pulled into the rank ordering when
    // they are still connected via a stub after instrument folding.
    for (const edge of [...regularEdges, ...stubEdges]) {
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

  return { graph, legend, tokens, hiddenSupportingCount };
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

/**
 * Node visual size. Requirements and verdicts deserve emphasis.
 */
function nodeSizeFor(node: ThreadGraphNode): number {
  switch (node.entityKind) {
    case "evaluation":
    case "requirement":
    case "violation":
      return 14;
    case "observation":
      return 10;
    case "artifact":
      return 8;
    default:
      return 7;
  }
}

/**
 * Node color per dominant system. Colours match the thread-blue/green/amber
 * tokens so the graph reads as the same design system as the SVG canvas.
 */
function nodeColorFor(node: ThreadGraphNode, tokens: CssTokens): string {
  switch (node.system) {
    case "syson":
      return tokens.cyan;
    case "build123d":
      return tokens.amber;
    case "calculix":
      return tokens.red;
    case "openmodelica":
    case "mcp-modelica":
      return tokens.violet;
    case "erpnext":
      return tokens.blue;
    case "digital-thread":
      return tokens.green;
    default:
      return tokens.muted;
  }
}

/**
 * Returns the dominant accent color for a component based on its name.
 * Component names are derived structurally (see componentName in evidence-graph-model.ts).
 */
function componentColor(name: string, tokens: CssTokens): string {
  if (name.startsWith("SysML")) return tokens.cyan;
  if (name.startsWith("CAD")) return tokens.amber;
  if (name.startsWith("FEA")) return tokens.red;
  if (name.startsWith("Thermique")) return tokens.violet;
  if (name.startsWith("ERP")) return tokens.blue;
  if (name.startsWith("Chaîne")) return tokens.green;
  return tokens.muted;
}
