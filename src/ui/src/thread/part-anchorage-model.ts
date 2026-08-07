import type {
  ThreadComponentCatalog,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "./types.ts";

/**
 * The resolved target for an anchored graph node.
 *
 * The literal "assembly" denotes the whole-assembly component (the catalog
 * component with kind === "assembly"). Any other string is the catalog id of a
 * specific part component (e.g., "cm01-v3:drip-tray").
 */
export type PartTarget = "assembly" | string;

/**
 * A resolved anchor for one graph node.
 *
 * `criterion` names which rule produced the anchor (first match in the ordered
 * evaluation wins: "catalog" > "prefix" > "nature" > "derived-from" >
 * "change-consumption").
 */
export interface PartAnchor {
  readonly target: PartTarget;
  readonly criterion:
    | "catalog"
    | "prefix"
    | "nature"
    | "derived-from"
    | "change-consumption";
}

/**
 * Anchorage coverage summary derived from a resolved map and the full graph.
 *
 * unique + ambiguous + orphan === graph.nodes.length
 *
 * `unique`    — nodes with exactly one deterministic anchor (present in the map).
 * `ambiguous` — criteria fired but produced conflicting targets; assembly-wins
 *               tie-break did not apply.  Reported as (total − map.size) by
 *               convention; the implementation aims for zero.
 * `orphan`    — reported as 0 by convention; the implementation is designed to
 *               cover every node kind.
 */
export interface AnchorageCoverage {
  readonly unique: number;
  readonly ambiguous: number;
  readonly orphan: number;
}

// ---------------------------------------------------------------------------
// Server-fixed prefix table (criterion b)
//
// Each entry maps a well-known id prefix to a part target AND a producer
// family.  The table is ordered: the first matching entry wins.  Entries with
// a digest placeholder use a regex that matches exactly 64 lowercase hex
// characters so that versioned siblings (e.g., -r2-, -r3-) never collide with
// the base pattern.
//
// Every entry is annotated with the executor file and line that defines the
// server-fixed naming contract.
//
// `AnchorFamily` classifies the producing executor family.  It is consumed by
// part-lane-model.ts to derive station assignment from the same structural
// source without duplicating the prefix strings.
// ---------------------------------------------------------------------------

const HEX64 = "[0-9a-f]{64}";

/**
 * Semantic family of the executor that produced a graph node, derived from
 * the same server-fixed id prefixes used for part anchoring.
 *
 * Consumers (e.g. part-lane-model.ts) import `anchorFamilyByPrefix` to map
 * node ids to stations without re-declaring the prefix strings.
 *
 * Family → canonical station mapping (documented in part-lane-model.ts):
 *   architecture | oracle-requirements | sensitivity-edges |
 *   sensitivity-relations  →  model
 *   cad                    →  geometry
 *   mechanical | sensitivity-study | drip-tray-correction |
 *   run-queue-mechanical   →  verification
 *   printability           →  observations
 *   erpnext-bom | print-estimate  →  industrialization
 */
export type AnchorFamily =
  | "architecture"
  | "oracle-requirements"
  | "sensitivity-edges"
  | "sensitivity-relations"
  | "erpnext-bom"
  | "cad"
  | "mechanical"
  | "sensitivity-study"
  | "printability"
  | "print-estimate"
  | "drip-tray-correction"
  | "run-queue-mechanical";

type PrefixResult = { target: PartTarget; family: AnchorFamily } | null;
type PrefixMatcher = (id: string) => PrefixResult;

/**
 * Return a matcher that fires when `id` starts with `prefix`.
 */
function sp(
  prefix: string,
  target: PartTarget,
  family: AnchorFamily,
): PrefixMatcher {
  return (id) => (id.startsWith(prefix) ? { target, family } : null);
}

/**
 * Return a matcher for an id of the form `{base}{HEX64}{suffix-start}`.
 * The resolver receives the full regex match and returns a combined result
 * (or null to skip to the next entry).
 */
function re(
  pattern: RegExp,
  resolve: (match: RegExpMatchArray) => PrefixResult,
): PrefixMatcher {
  return (id) => {
    const m = pattern.exec(id);
    return m ? resolve(m) : null;
  };
}

/**
 * Explicit server-fixed prefix table.
 *
 * Assembly-level entries appear first; drip-tray-specific entries follow.
 * More-specific patterns (versioned) precede their generic base patterns so
 * that -r2- and -r3- variants are not swallowed by the plain-digest pattern.
 */
const PREFIX_TABLE: readonly PrefixMatcher[] = [
  // (b-1) Architecture SysML model artifact
  //       coffee-machine-cm01-v3-architecture-run-executor.ts:651
  sp("coffee-machine-cm01-v3-architecture-", "assembly", "architecture"),

  // (b-2) Oracle requirements SysML artifact
  //       coffee-machine-cm01-v3-oracle-requirements-run-executor.ts:920
  sp("oracle-requirements-", "assembly", "oracle-requirements"),

  // (b-3) Oracle requirements capture document (extensionId)
  //       coffee-machine-cm01-v3-oracle-requirements-run-executor.ts:988
  sp("capture-oracle-requirements-", "assembly", "oracle-requirements"),

  // (b-4) Sensitivity edges SysML artifact
  //       coffee-machine-cm01-v3-sensitivity-edges-run-executor.ts:827
  sp("sensitivity-edges-", "assembly", "sensitivity-edges"),

  // (b-5) Sensitivity relations SysML artifact
  //       coffee-machine-cm01-v3-sensitivity-relations-run-executor.ts:805
  sp("sensitivity-relations-", "assembly", "sensitivity-relations"),

  // (b-6) ERP BOM artifacts (erpnext-bom-quantity-*, erpnext-bom-components-*)
  //       coffee-machine-cm01-v3-erpnext-bom-run-executor.ts:504
  sp("erpnext-bom-", "assembly", "erpnext-bom"),

  // (b-7) CAD R2 whole-assembly artifacts (plan, script, step)
  //       coffee-machine-cm01-v3-r2-successor-materializer.ts:52
  re(
    new RegExp(`^coffee-machine-cm01-v3-cad-r2-${HEX64}-`),
    () => ({ target: "assembly", family: "cad" }),
  ),

  // (b-8) CAD R3/R4 artifacts — cad-r3-run-executor.ts:513
  //       plan, script, step, mesh-assembly → assembly
  //       mesh-{semanticKey} → cm01-v3:{semanticKey} (per-part mesh)
  re(
    new RegExp(`^coffee-machine-cm01-v3-cad-r3-${HEX64}-(.+)$`),
    (m) => {
      const suffix = m[1]!;
      if (
        suffix === "plan" || suffix === "script" || suffix === "step" ||
        suffix === "mesh-assembly"
      ) {
        return { target: "assembly", family: "cad" };
      }
      if (suffix.startsWith("mesh-")) {
        // "mesh-drip-tray" → "cm01-v3:drip-tray"
        return {
          target: `cm01-v3:${suffix.slice("mesh-".length)}`,
          family: "cad",
        };
      }
      // Other suffixes (consumptions etc.) may be caught by later criteria.
      return null;
    },
  ),

  // (b-9) CAD R1 whole-assembly artifacts (plan, script, step)
  //       coffee-machine-cm01-v3-cad-run-executor.ts:476
  //       Pattern: coffee-machine-cm01-v3-cad-{64hex}-{...}
  //       The regex uses HEX64 immediately after "cad-" to avoid matching
  //       "cad-r2-" or "cad-r3-" which start with the letter 'r' (not hex).
  re(
    new RegExp(`^coffee-machine-cm01-v3-cad-${HEX64}-`),
    () => ({ target: "assembly", family: "cad" }),
  ),

  // (b-10) Mechanical R3 DripTray artifacts (proof, isolated-step, solve, …)
  //        coffee-machine-cm01-v3-r3-successor-materializer.ts:102
  re(
    new RegExp(`^coffee-machine-cm01-v3-mechanical-r3-${HEX64}-`),
    () => ({ target: "cm01-v3:drip-tray", family: "mechanical" }),
  ),

  // (b-11) Mechanical R2 DripTray artifacts (proof, isolated-step, solve, …)
  //        coffee-machine-cm01-v3-r2-successor-materializer.ts:214
  re(
    new RegExp(`^coffee-machine-cm01-v3-mechanical-r2-${HEX64}-`),
    () => ({ target: "cm01-v3:drip-tray", family: "mechanical" }),
  ),

  // (b-12) Mechanical R1 DripTray artifacts (proof, step, solve, observations)
  //        coffee-machine-cm01-v3-mechanical-run-executor.ts:549
  //        HEX64 guard prevents matching -r2- and -r3- variants.
  re(
    new RegExp(`^coffee-machine-cm01-v3-mechanical-${HEX64}-`),
    () => ({ target: "cm01-v3:drip-tray", family: "mechanical" }),
  ),

  // (b-13) DripTray sensitivity study (capture, STEPs, solves, observations)
  //        coffee-machine-cm01-v3-sensitivity-run-executor.ts:571
  sp("drip-tray-sensitivity-", "cm01-v3:drip-tray", "sensitivity-study"),

  // (b-14) DripTray printability DFM (step, capture, observations)
  //        coffee-machine-cm01-v3-printability-run-executor.ts:570
  sp("drip-tray-printability-", "cm01-v3:drip-tray", "printability"),

  // (b-15) DripTray print estimate (STL, gcode, observations)
  //        coffee-machine-cm01-v3-print-estimate-run-executor.ts:588
  sp("drip-tray-print-estimate-", "cm01-v3:drip-tray", "print-estimate"),

  // (b-16) DripTray height-correction action and run-queue artifacts
  //        src/domain/cm01/cm01-drip-tray-height-correction.ts:38,143
  sp(
    "coffee-machine-cm01-v3-drip-tray-height-",
    "cm01-v3:drip-tray",
    "drip-tray-correction",
  ),

  // (b-17) Mechanical R2 re-verification run-queue artifact
  //        src/domain/cm01/cm01-v3-r11-closeout.ts:19
  sp(
    "run:cm01-v3-r7-r10-28-to-30-queue-mechanical-r2:",
    "cm01-v3:drip-tray",
    "run-queue-mechanical",
  ),

  // (b-18) Printability run artifacts — id ends with :drip-tray-printability
  //        coffee-machine-cm01-v3-printability-run-executor.ts:495
  re(
    /:drip-tray-printability$/,
    () => ({ target: "cm01-v3:drip-tray", family: "printability" }),
  ),
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function refKey(node: ThreadGraphNode): string {
  return `${node.ref.kind}:${node.ref.id}`;
}

function edgeFromKey(edge: ThreadGraphEdge): string {
  return `${edge.from.kind}:${edge.from.id}`;
}

function edgeToKey(edge: ThreadGraphEdge): string {
  return `${edge.to.kind}:${edge.to.id}`;
}

/**
 * Build a lookup map from evidence artifact id to component target using the
 * catalog's binding declarations.  Assembly components yield "assembly"; parts
 * yield their catalog component id.
 *
 * Duplicate evidenceArtifactId values across DIFFERENT components are resolved
 * with assembly-wins merge semantics (same as mergeTargets): if both an assembly
 * component and a part component bind the same evidenceArtifactId, "assembly"
 * wins.  Two different parts that bind the same id produce an ambiguous result;
 * the entry is removed from the map so that the artifact falls through to the
 * prefix and nature criteria.
 *
 * Note: the catalog validator rejects duplicate provider:kind:id combinations
 * within a single component's bindings, but it does NOT reject the same
 * evidenceArtifactId appearing in bindings of different components — for
 * example, the architecture artifact is bound by every component (assembly and
 * all parts) because each SysML element definition was read from that artifact.
 */
function buildCatalogMap(
  components: ThreadComponentCatalog,
): ReadonlyMap<string, PartTarget> {
  const map = new Map<string, PartTarget>();
  for (const component of components.components) {
    const target: PartTarget = component.kind === "assembly"
      ? "assembly"
      : component.id;
    for (const binding of component.bindings) {
      const existing = map.get(binding.evidenceArtifactId);
      if (existing === undefined) {
        map.set(binding.evidenceArtifactId, target);
      } else {
        // Assembly wins on conflict; two different parts → remove the entry.
        const merged = mergeTargets(existing, target);
        if (merged !== null) {
          map.set(binding.evidenceArtifactId, merged);
        } else {
          map.delete(binding.evidenceArtifactId);
        }
      }
    }
  }
  return map;
}

/** Apply the prefix table against a node ref id — returns the PartTarget only. */
function anchorByPrefix(id: string): PartTarget | null {
  for (const matcher of PREFIX_TABLE) {
    const result = matcher(id);
    if (result !== null) return result.target;
  }
  return null;
}

/**
 * Classify a node id by the producer executor family that generated it.
 *
 * Uses the same server-fixed prefix patterns as `buildPartAnchorage` (criterion
 * b) so that callers — notably part-lane-model.ts — can map node ids to
 * stations without re-declaring the prefix strings.
 *
 * Returns null for ids that do not match any server-fixed prefix (nature-based
 * or entity-kind-based classification must then be applied by the caller).
 */
export function anchorFamilyByPrefix(id: string): AnchorFamily | null {
  for (const matcher of PREFIX_TABLE) {
    const result = matcher(id);
    if (result !== null) return result.family;
  }
  return null;
}

/**
 * Criterion (c): machine-level nature.
 *
 * Certain artifact kinds or producer systems are always whole-machine scope.
 * This criterion fires ONLY for artifact nodes not already resolved by (a)/(b).
 *
 * Named categories:
 *   "architecture" — sysml-model artifacts not caught by the explicit prefix
 *                    (e.g., initial model-seed container)
 *   "thermal"      — Modelica simulation results; producer is mcp-modelica /
 *                    openmodelica / modelica
 *   "BOM"          — bill-of-materials artifacts; artifactKind === "bom"
 *   "brief"        — project brief documentary artifact; kind "document",
 *                    system "casys-digital-thread"
 *   "model-seed"   — initial SysON container document; same system as brief
 */
function anchorByNature(node: ThreadGraphNode): PartTarget | null {
  if (node.entityKind !== "artifact") return null;
  const k = node.artifactKind;
  const s = node.system;

  // Thermal simulation results — always whole-machine scope.
  if (s === "mcp-modelica" || s === "openmodelica" || s === "modelica") {
    return "assembly";
  }
  // Bill of Materials — always whole-machine scope.
  if (k === "bom") return "assembly";
  // Project brief / model-seed documentary artifact — whole-project scope.
  if (k === "document" && s === "casys-digital-thread") return "assembly";
  // SysML architecture or model-seed not caught by catalog or prefix.
  if (k === "sysml-model") return "assembly";
  return null;
}

/**
 * Merge two resolved targets with the tie-break rule:
 *   - Both agree → return the common target.
 *   - One is "assembly" and the other is a part → "assembly" wins.
 *   - Two different parts → ambiguous (return null).
 */
function mergeTargets(a: PartTarget, b: PartTarget): PartTarget | null {
  if (a === b) return a;
  if (a === "assembly" || b === "assembly") return "assembly";
  return null; // two different parts — ambiguous
}

/**
 * Phase (d): transitive `derived_from` propagation.
 *
 * In the projected graph, a `derived_from` edge runs from the source artifact
 * to the derived artifact (GRAPH_PROVENANCE_DIRECTION reverse → graph edge:
 * source → derivative).  A derived artifact inherits the anchor of all its
 * direct source ancestors if they agree; assembly wins on conflict; two
 * different parts remain ambiguous.
 *
 * Runs iteratively until no new resolutions occur (handles chains).  Only
 * `derived_from` edges are followed here; other relations are handled in
 * phase (e).
 */
function propagateDerivedFrom(
  graph: ThreadGraph,
  resolved: Map<string, PartAnchor>,
): void {
  // Index: for each node key, which keys point to it via derived_from?
  const sources = new Map<string, string[]>();
  for (const node of graph.nodes) {
    sources.set(refKey(node), []);
  }
  for (const edge of graph.edges) {
    if (edge.relation !== "derived_from") continue;
    const to = edgeToKey(edge);
    const from = edgeFromKey(edge);
    const list = sources.get(to);
    if (list) list.push(from);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      const key = refKey(node);
      if (resolved.has(key)) continue;
      const srcs = sources.get(key) ?? [];
      if (srcs.length === 0) continue;
      // Collect anchors of all resolved sources.
      const srcTargets = srcs
        .map((s) => resolved.get(s)?.target)
        .filter((t): t is PartTarget => t !== undefined);
      if (srcTargets.length === 0) continue;
      // Merge all source targets.
      let merged: PartTarget | null = srcTargets[0]!;
      for (let i = 1; i < srcTargets.length; i++) {
        merged = merged !== null ? mergeTargets(merged, srcTargets[i]!) : null;
      }
      if (merged !== null) {
        resolved.set(key, { target: merged, criterion: "derived-from" });
        changed = true;
      }
    }
  }
}

/**
 * Phase (e): change / consumption / adjacent inheritance.
 *
 * Covers all node kinds not resolved by (a)–(d):
 *
 *  • `change` nodes  — inherit from the artifact at the `to` end of a
 *    `changes` edge (graph direction: change → artifact).
 *
 *  • `consumption` nodes — inherit from the artifact at the `from` end of a
 *    `uses` edge (graph direction: artifact → consumption).
 *
 *  • All other non-artifact nodes (observation, requirement, evaluation,
 *    violation, action) — inherit from all adjacent resolved nodes via any
 *    edge.  Assembly wins on conflict; two different parts → not resolved.
 *
 * Runs iteratively until stable to handle chains.
 */
function propagateChangeConsumption(
  graph: ThreadGraph,
  resolved: Map<string, PartAnchor>,
): void {
  // Index: outgoing and incoming neighbours by edge type.
  type Adj = { key: string; relation: string }[];
  const outgoing = new Map<string, Adj>();
  const incoming = new Map<string, Adj>();
  for (const node of graph.nodes) {
    outgoing.set(refKey(node), []);
    incoming.set(refKey(node), []);
  }
  for (const edge of graph.edges) {
    const fromKey = edgeFromKey(edge);
    const toKey = edgeToKey(edge);
    outgoing.get(fromKey)?.push({ key: toKey, relation: edge.relation });
    incoming.get(toKey)?.push({ key: fromKey, relation: edge.relation });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      const key = refKey(node);
      if (resolved.has(key)) continue;

      let target: PartTarget | null = null;

      if (node.entityKind === "change") {
        // A change node inherits from the artifact it "changes".
        // Edge direction: change → artifact (changes, forward).
        const artifacts = outgoing.get(key)?.filter((e) =>
          e.relation === "changes"
        ) ?? [];
        for (const a of artifacts) {
          const t = resolved.get(a.key)?.target;
          if (t === undefined) continue;
          target = target === null ? t : mergeTargets(target, t);
        }
      } else if (node.entityKind === "consumption") {
        // A consumption node inherits from the artifact it attests.
        // Edge direction: artifact → consumption (uses, reverse).
        const artifacts = incoming.get(key)?.filter((e) =>
          e.relation === "uses"
        ) ?? [];
        for (const a of artifacts) {
          const t = resolved.get(a.key)?.target;
          if (t === undefined) continue;
          target = target === null ? t : mergeTargets(target, t);
        }
      } else {
        // General: inherit from any adjacent resolved node via any edge.
        const neighbours = [
          ...(outgoing.get(key) ?? []),
          ...(incoming.get(key) ?? []),
        ];
        for (const n of neighbours) {
          const t = resolved.get(n.key)?.target;
          if (t === undefined) continue;
          target = target === null ? t : mergeTargets(target, t);
        }
      }

      if (target !== null) {
        resolved.set(key, {
          target,
          criterion: "change-consumption",
        });
        changed = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Build a fact-to-part anchorage map for every resolvable graph node.
 *
 * Criteria applied in order (first match wins):
 *
 * (a) Catalog `evidenceArtifactId` binding — artifact id declared in a
 *     catalog component binding.  Applies to artifact nodes only.
 *
 * (b) Server-fixed prefix table — the explicit table above maps well-known
 *     id prefixes to component targets.  Applies to ALL node kinds because
 *     observation, consumption and other derived ids share the same
 *     server-fixed prefix as the artifact they trace back to.
 *
 * (c) Machine-level nature — certain artifact kinds or producer systems are
 *     always whole-machine scope (sysml-model, thermal, BOM, brief, seed).
 *     Applies to artifact nodes only.
 *
 * (d) Transitive `derived_from` propagation — iterative BFS through
 *     derived_from graph edges.  Assembly wins on conflict between parts.
 *
 * (e) Change / consumption / adjacent inheritance — change and consumption
 *     nodes inherit from their directly connected artifact; other non-artifact
 *     nodes inherit from any adjacent resolved node.  Iterates until stable.
 *
 * Only uniquely-resolved nodes appear in the returned map; ambiguous nodes
 * (criteria fired but targets conflicted) are absent.
 */
export function buildPartAnchorage(
  graph: ThreadGraph,
  components: ThreadComponentCatalog,
): Map<string, PartAnchor> {
  const resolved = new Map<string, PartAnchor>();

  // (a) Catalog evidenceArtifactId binding.
  const catalogMap = buildCatalogMap(components);
  for (const node of graph.nodes) {
    if (node.entityKind !== "artifact") continue;
    const target = catalogMap.get(node.ref.id);
    if (target !== undefined) {
      resolved.set(refKey(node), { target, criterion: "catalog" });
    }
  }

  // (b) Server-fixed prefix table — all node kinds.
  for (const node of graph.nodes) {
    if (resolved.has(refKey(node))) continue;
    const target = anchorByPrefix(node.ref.id);
    if (target !== null) {
      resolved.set(refKey(node), { target, criterion: "prefix" });
    }
  }

  // (c) Machine-level nature — artifact nodes only.
  for (const node of graph.nodes) {
    if (resolved.has(refKey(node))) continue;
    const target = anchorByNature(node);
    if (target !== null) {
      resolved.set(refKey(node), { target, criterion: "nature" });
    }
  }

  // (d) Transitive derived_from propagation.
  propagateDerivedFrom(graph, resolved);

  // (e) Change / consumption / adjacent inheritance.
  propagateChangeConsumption(graph, resolved);

  return resolved;
}

/**
 * Compute anchorage coverage from the anchored map and the full graph.
 *
 *   unique    = map.size (uniquely resolved).
 *   ambiguous = graph.nodes.length − map.size (unresolved; conflicting or
 *               unreachable).
 *   orphan    = 0 by convention (the implementation is designed to cover all
 *               node kinds; true orphans appear as ambiguous in this report).
 */
export function anchorageCoverage(
  map: ReadonlyMap<string, PartAnchor>,
  graph: ThreadGraph,
): AnchorageCoverage {
  return {
    unique: map.size,
    ambiguous: graph.nodes.length - map.size,
    orphan: 0,
  };
}
