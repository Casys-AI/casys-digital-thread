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
import { applyEssentialFilter } from "./essential-graph-filter.ts";
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
     * input_to: edge.from IS the provider/input (upstream).
     * edge.to IS the consumer (downstream).
     * Example: SysML-model --input_to--> CAD-artifact
     *   → SysML is upstream (left), CAD is downstream (right). No reversal.
     */
    case "input_to":

    /**
     * source_of: edge.from IS the source artifact (upstream).
     * edge.to IS the derived record (downstream).
     * Example: CAD-artifact --source_of--> mass-observation
     *   → CAD is upstream (left), observation is downstream (right). No reversal.
     */
    case "source_of":

    /**
     * changes: edge.from IS the change event (upstream initiator).
     * edge.to IS the artifact introduced or modified by that change (downstream).
     * Example: change-record --changes--> artifact-it-produced
     *   → change is upstream (left), artifact is downstream (right). No reversal.
     */
    case "changes":

    /**
     * supersedes: edge.from IS the older artifact (upstream in version history).
     * edge.to IS the newer successor (downstream).
     * Version history reads left → right; old on left, current on right.
     * Example: artifact@v1 --supersedes--> artifact@v2
     *   → v1 is upstream (left), v2 is downstream (right). No reversal.
     */
    case "supersedes":
      return { from: fromKey, to: toKey };

    /**
     * derived_from: edge.from IS the DERIVED artifact (downstream result).
     * edge.to IS the SOURCE (upstream origin).
     * The relation name reads "from was derived from to" → to is upstream.
     * Reversed so the source (to) appears on the left.
     * Example: derived-model --derived_from--> source-model
     *   → dagre edge: source-model → derived-model
     */
    case "derived_from":

    /**
     * uses: edge.from IS the CONSUMER (downstream).
     * edge.to IS the USED item (upstream dependency).
     * "from uses to" → to is the dependency that must come first (upstream).
     * Reversed so the used item (to) appears on the left.
     * Example: consumer-artifact --uses--> shared-artifact
     *   → dagre edge: shared-artifact → consumer-artifact
     */
    case "uses":

    /**
     * evaluates: edge.from IS the EVALUATION record (downstream result).
     * edge.to IS the artifact/requirement being evaluated (upstream subject).
     * "from evaluates to" → to came first (upstream), evaluation is downstream.
     * Reversed so the evaluated item (to) appears on the left.
     * Example: evaluation --evaluates--> requirement
     *   → dagre edge: requirement → evaluation
     */
    case "evaluates":

    /**
     * evidences: edge.from IS the EVIDENCE artifact (downstream proof).
     * edge.to IS the claim/requirement being evidenced (upstream).
     * "from evidences to" → to is the claim (upstream), from is the proof.
     * Reversed so the claim (to) appears on the left, proof on the right.
     * Example: proof-artifact --evidences--> requirement
     *   → dagre edge: requirement → proof-artifact
     */
    case "evidences":

    /**
     * traces_to: edge.from IS the IMPLEMENTATION (downstream artifact).
     * edge.to IS the REQUIREMENT (upstream specification).
     * "from traces to to" → to is the requirement that came first (upstream).
     * Reversed so the requirement (to) appears on the left.
     * Example: artifact --traces_to--> requirement
     *   → dagre edge: requirement → artifact
     */
    case "traces_to":

    /**
     * caused_by: edge.from IS the EFFECT (downstream consequence).
     * edge.to IS the CAUSE (upstream origin).
     * "from was caused by to" → to is upstream.
     * Reversed so the cause (to) appears on the left.
     * Example: derived-violation --caused_by--> upstream-artifact
     *   → dagre edge: upstream-artifact → derived-violation
     */
    case "caused_by":

    /**
     * addresses: edge.from IS the ACTION/FIX (downstream response).
     * edge.to IS the VIOLATION (upstream trigger that prompted the action).
     * "from addresses to" → to (violation) came first (upstream).
     * Reversed so the violation (to) appears on the left, fix on the right.
     * Example: action --addresses--> violation
     *   → dagre edge: violation → action
     */
    case "addresses":
      return { from: toKey, to: fromKey };

    default:
      // Unknown relation: keep stored direction unchanged.
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
 */
export function buildExplorationModel(
  evidenceModel: EvidenceGraphModel,
  projection: EvidenceCanvasProjection,
  tokens: CssTokens,
): ExplorationModel {
  const graph = new DirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>();

  // Apply the essential display mask on full-map views (no active focus).
  // The mask reduces ~161 visible nodes to the ~60 semantically essential ones:
  // supporting artifacts (mesh, script, solver-input…), change events, and
  // consumption records are hidden unless they are the sole path between two
  // essential nodes. The upstream EvidenceGraphModel is NOT mutated — the local
  // inspector and boundedNeighborhood still reach hidden nodes.
  let displayNodes: readonly ThreadGraphNode[];
  let displayEdges: readonly ThreadGraphEdge[];
  let hiddenSupportingCount = 0;

  if (!projection.isFiltered) {
    const filtered = applyEssentialFilter(
      projection.nodes as ThreadGraphNode[],
      projection.edges as ThreadGraphEdge[],
    );
    displayNodes = filtered.nodes;
    displayEdges = filtered.edges;
    hiddenSupportingCount = filtered.hiddenCount;
  } else {
    // Local view (bounded neighbourhood): show all nodes including supporting ones
    // so the inspector context is complete.
    displayNodes = projection.nodes as ThreadGraphNode[];
    displayEdges = projection.edges as ThreadGraphEdge[];
  }

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
      nodesep: 60,
      // Horizontal gap between adjacent ranks (causal layers).
      ranksep: 100,
      marginx: 20,
      marginy: 20,
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
    { componentIds: number[]; visibleNodeCount: number; intentionallyIsolated: boolean; color: string }
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
