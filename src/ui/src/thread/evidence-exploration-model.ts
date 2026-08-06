/**
 * Preparation model for the sigma.js exploration renderer of the Evidence graph.
 *
 * Responsibilities (all pure, no I/O, no Preact):
 *   1. Build a graphology DirectedGraph from an EvidenceCanvasProjection, adding
 *      x/y positions via a deterministic ForceAtlas2 run (seeded by key hash,
 *      fixed iterations — same inputs always yield the same positions).
 *   2. Attach sigma-ready visual attributes to each node and edge (color, size,
 *      type, label). Stub edges get a "dashed" type and a "via … — replié" label.
 *   3. Derive a legend of named components (EvidenceGraphComponent) with a count
 *      of their visible nodes in the current projection — never from layout coords.
 *
 * Why this lives here and not in the component:
 *   The component stays thin and testable.  This module imports no browser APIs;
 *   colors come in as a CssTokens parameter so Deno tests can pass mock values.
 */

// Vite (browser): résout graphology depuis node_modules et expose la classe.
// Deno (tests): résout via npm: dans l'import map de deno.json.
// Dans les deux cas, l'export nommé { DirectedGraph } est préféré pour
// éviter les ambiguïtés de default export selon le bundler.
import { DirectedGraph } from "graphology";
// graphology-layout-forceatlas2 n'a pas d'export ESM propre ; on le cast.
// deno.json référence "graphology-layout-forceatlas2": "npm:graphology-layout-forceatlas2@^0.10.1"
// pour que le test Deno puisse résoudre le module.
// deno-lint-ignore no-explicit-any
import forceAtlas2Raw from "graphology-layout-forceatlas2";
// deno-lint-ignore no-explicit-any
const forceAtlas2 = forceAtlas2Raw as any;
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A legend item describing one named evidence component. */
export interface ExplorationLegendItem {
  /** Component id (from EvidenceGraphModel.components). */
  readonly componentId: number;
  /** Structural name derived from the full raw graph. */
  readonly name: string;
  readonly intentionallyIsolated: boolean;
  /** Number of visible nodes (after folding) in this component. */
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
  /** True when this node is a stub endpoint (should not happen, stubs are edges). */
  isStub?: boolean;
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
  readonly legend: readonly ExplorationLegendItem[];
  readonly tokens: CssTokens;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds the sigma-ready ExplorationModel from the canonical evidence model
 * and the current canvas projection.
 *
 * @param evidenceModel   Full model including component detection.
 * @param projection      Current canvas projection (already filtered/focused).
 * @param tokens          CSS color tokens resolved at call time.
 * @param faIterations    ForceAtlas2 iteration count (default 120, fixed for determinism).
 */
export function buildExplorationModel(
  evidenceModel: EvidenceGraphModel,
  projection: EvidenceCanvasProjection,
  tokens: CssTokens,
  faIterations = 120,
): ExplorationModel {
  const graph = new DirectedGraph<SigmaNodeAttrs, SigmaEdgeAttrs>();

  // Add nodes with deterministic initial positions derived from key hash.
  const nodes = projection.nodes as ThreadGraphNode[];
  for (const node of nodes) {
    const key = nodeKey(node.ref);
    const { x, y } = deterministicPosition(key);
    const compId = evidenceModel.componentOf(node.ref);
    graph.addNode(key, {
      refKey: key,
      node,
      x,
      y,
      size: nodeSizeFor(node),
      color: nodeColorFor(node, tokens),
      label: node.label,
      componentId: compId,
    });
  }

  // Add regular edges.
  const regularEdges = projection.edges.filter(
    (e) => !e.id.startsWith("stub:"),
  ) as ThreadGraphEdge[];
  const stubEdges = projection.edges.filter((e) =>
    e.id.startsWith("stub:")
  ) as ThreadGraphEdge[];

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

  // Add stub edges (dashed rendering cue).
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

  // Run ForceAtlas2 only when there are at least 2 nodes.
  // Initial positions (from deterministicPosition) are already set as node x/y,
  // so FA2 starts from a stable state → same inputs → same output.
  if (graph.order >= 2) {
    forceAtlas2.assign(graph, {
      iterations: faIterations,
      settings: {
        gravity: 1,
        scalingRatio: 4,
        strongGravityMode: false,
        barnesHutOptimize: graph.order > 100,
      },
    });
  }

  // Build legend from model components.
  const legend: ExplorationLegendItem[] = evidenceModel.components.map(
    (comp) => {
      const visibleNodeCount = [...comp.visibleNodeRefKeys].filter((k) =>
        graph.hasNode(k)
      ).length;
      return {
        componentId: comp.id,
        name: comp.name,
        intentionallyIsolated: comp.intentionallyIsolated,
        visibleNodeCount,
        color: componentColor(comp.name, tokens),
      };
    },
  ).filter((item) => item.visibleNodeCount > 0);

  return { graph, legend, tokens };
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
 * Derives a stable (x, y) starting position from the node key.
 *
 * Uses a simple djb2-like hash. The initial positions lie on a unit circle
 * scaled by node count so ForceAtlas2 starts from a spread-out state that
 * converges quickly and reproducibly.
 */
export function deterministicPosition(key: string): { x: number; y: number } {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  const angle = (h % 10000) / 10000 * Math.PI * 2;
  const radius = 10 + ((h >> 10) % 1000) / 100; // 10..20
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

/**
 * Node visual size.  Requirements and verdicts deserve emphasis.
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
 * Node color per dominant system.  Colours match the thread-blue/green/amber
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
