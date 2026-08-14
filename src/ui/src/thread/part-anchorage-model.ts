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
 * specific part component (for example, "robot:articulated-arm").
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
 * `ambiguous` — criteria fired but produced conflicting part targets.
 * `orphan`    — no anchorage criterion could resolve the node.
 */
export interface AnchorageCoverage {
  readonly unique: number;
  readonly ambiguous: number;
  readonly orphan: number;
}

/**
 * Complete anchorage outcome. `anchors` preserves the historical API for UI
 * consumers that only need a unique part target; `ambiguousByRef` retains the
 * conflicting candidate set instead of silently treating it as an orphan.
 */
export interface PartAnchorageResolution {
  readonly anchors: Map<string, PartAnchor>;
  readonly ambiguousByRef: ReadonlyMap<string, readonly PartTarget[]>;
  readonly orphanRefKeys: ReadonlySet<string>;
}

type AnchorState =
  | { readonly kind: "unique"; readonly anchor: PartAnchor }
  | { readonly kind: "ambiguous"; readonly targets: readonly PartTarget[] };

const resolutionByAnchors = new WeakMap<
  ReadonlyMap<string, PartAnchor>,
  PartAnchorageResolution
>();

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
// `AnchorFamily` classifies the producing executor family from the same
// structural source, without duplicating the prefix strings.
// ---------------------------------------------------------------------------

const HEX64 = "[0-9a-f]{64}";

/**
 * Semantic family of the executor that produced a graph node, derived from
 * the same server-fixed id prefixes used for part anchoring.
 *
 * Consumers import `anchorFamilyByPrefix` to classify node ids without
 * re-declaring the prefix strings.
 *
 * Family → engineering-step reading:
 *   architecture | architecture-sysml-seal | requirements → model
 *   cad → geometry
 *   fea-proof | fea-solver-result | fea-verdict → verification
 *
 * `architecture-sysml-seal` is a Thread document only. It never invents
 * part-definition or part-usage nodes.
 */
export type AnchorFamily =
  | "architecture"
  | "architecture-sysml-seal"
  | "cad"
  | "requirements"
  | "fea-proof"
  | "fea-solver-result"
  | "fea-verdict";

type PrefixResult = {
  target: PartTarget;
  family: AnchorFamily;
  /**
   * Generic ids are only authoritative for the artifact shape their
   * server-fixed executor emits. This prevents a similarly named fact from
   * becoming whole-assembly evidence merely because its id has that prefix.
   */
  expectedArtifactKind?: string;
} | null;
type PrefixMatcher = (id: string) => PrefixResult;

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
 * Entries are constrained to active generic operation contracts. An archived
 * golden-path naming scheme is intentionally not a UI fallback: old evidence
 * must supply its own exact component catalog.
 */
const PREFIX_TABLE: readonly PrefixMatcher[] = [
  // (b-1) Generic architecture SysML artifact — id: architecture-{HEX64}
  //        model-write-architecture-run-executor.ts:1743
  re(new RegExp(`^architecture-${HEX64}$`), () => ({
    target: "assembly",
    family: "architecture",
    expectedArtifactKind: "sysml-model",
  })),

  // (b-2) Generic geometry bundle capture — id: geometry-{HEX64}
  //        design-write-geometry-run-executor.ts:1525
  re(new RegExp(`^geometry-${HEX64}$`), () => ({
    target: "assembly",
    family: "cad",
    expectedArtifactKind: "cad-model",
  })),

  // (b-3) Generic FEA proof-case document — id: fea-proof-{HEX64}
  //        verify-seal-proof-case-run-executor.ts:508
  re(new RegExp(`^fea-proof-${HEX64}$`), () => ({
    target: "assembly",
    family: "fea-proof",
    expectedArtifactKind: "document",
  })),

  // (b-4) Generic FEA solver result — id: fea-solver-result-{HEX64}
  //        verify-run-fea-static-proof-run-executor.ts:1137
  re(new RegExp(`^fea-solver-result-${HEX64}$`), () => ({
    target: "assembly",
    family: "fea-solver-result",
    expectedArtifactKind: "solver-result",
  })),

  // (b-5) Generic FEA verdict document — id: fea-verdict-{HEX64}
  //        verify-run-fea-static-proof-run-executor.ts:1138
  re(new RegExp(`^fea-verdict-${HEX64}$`), () => ({
    target: "assembly",
    family: "fea-verdict",
    expectedArtifactKind: "document",
  })),

  // (b-6) Generic requirements artifact
  //        id: requirements-{containerComponent}-{HEX64}
  //        model-write-requirements-run-executor.ts:1284
  //        The component segment varies per project, but the complete shape
  //        remains anchored by its terminal capture digest.
  re(new RegExp(`^requirements-.+?-${HEX64}$`), () => ({
    target: "assembly",
    family: "requirements",
    expectedArtifactKind: "sysml-model",
  })),

  // (b-7) Agent-authored architecture SysML seal document
  //        id: architecture-sysml-seal-{HEX64}
  //        model-seal-architecture-sysml-run-executor.ts:629
  //        Thread document only; never a sysml-model or Product Structure node.
  re(new RegExp(`^architecture-sysml-seal-${HEX64}$`), () => ({
    target: "assembly",
    family: "architecture-sysml-seal",
    expectedArtifactKind: "document",
  })),
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
 * Build catalog lookups with their two deliberately distinct identities.
 * `binding.id` is the exact provider-owned identity and can anchor an artifact
 * to one component. `evidenceArtifactId` is the immutable capture supporting
 * that claim; it can legitimately be shared across components and therefore
 * must retain an explicit ambiguity rather than silently selecting a part.
 *
 * Duplicate evidenceArtifactId values across different components stay
 * explicitly ambiguous, including an assembly/part combination. The capture
 * proves where identities were read; it does not identify one component.
 * Lower-priority criteria must not erase that ambiguity.
 *
 * The catalog validator rejects duplicate provider:kind:id combinations within
 * a single component but permits a shared evidenceArtifactId across components:
 * several provider identities may have been captured by one artifact.
 */
function buildCatalogCandidates(
  components: ThreadComponentCatalog,
): {
  readonly bindingId: ReadonlyMap<string, readonly PartTarget[]>;
  readonly evidenceArtifactId: ReadonlyMap<string, readonly PartTarget[]>;
} {
  const bindingId = new Map<string, Set<PartTarget>>();
  const evidenceArtifactId = new Map<string, Set<PartTarget>>();
  for (const component of components.components) {
    const target: PartTarget = component.kind === "assembly"
      ? "assembly"
      : component.id;
    for (const binding of component.bindings) {
      // A graph artifact is a digital-thread artifact id; other provider ids
      // (for example a SysON element id) are not graph artifact identities.
      if (
        binding.provider === "digital-thread" && binding.kind === "artifact"
      ) {
        const values = bindingId.get(binding.id) ?? new Set();
        values.add(target);
        bindingId.set(binding.id, values);
      }
      const evidence = evidenceArtifactId.get(binding.evidenceArtifactId) ??
        new Set();
      evidence.add(target);
      evidenceArtifactId.set(binding.evidenceArtifactId, evidence);
    }
  }
  const normalize = (candidates: ReadonlyMap<string, Set<PartTarget>>) =>
    new Map(
      [...candidates].map(([id, targets]) => [id, sortTargets(targets)]),
    );
  return {
    bindingId: normalize(bindingId),
    evidenceArtifactId: normalize(evidenceArtifactId),
  };
}

/** Apply the prefix table against a node ref id — returns the PartTarget only. */
function anchorByPrefix(node: ThreadGraphNode): PartTarget | null {
  for (const matcher of PREFIX_TABLE) {
    const result = matcher(node.ref.id);
    if (
      result !== null &&
      (result.expectedArtifactKind === undefined ||
        (node.entityKind === "artifact" &&
          node.artifactKind === result.expectedArtifactKind))
    ) return result.target;
  }
  return null;
}

/**
 * Classify a node id by the producer executor family that generated it.
 *
 * Uses the same server-fixed prefix patterns as `buildPartAnchorage` (criterion
 * b) so that callers can classify node ids without re-declaring the prefix
 * strings.
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
 * Criterion (b): assembly-level nature.
 *
 * Certain artifact kinds or producer systems are always whole-machine scope.
 * This criterion fires only for artifact nodes not already resolved by the
 * exact component catalog.
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

function sortTargets(targets: Iterable<PartTarget>): readonly PartTarget[] {
  return [...new Set(targets)].sort((left, right) => {
    if (left === "assembly") return -1;
    if (right === "assembly") return 1;
    return left.localeCompare(right);
  });
}

function stateFromTargets(
  targets: Iterable<PartTarget>,
  criterion: PartAnchor["criterion"],
): AnchorState | undefined {
  const sorted = sortTargets(targets);
  if (sorted.length === 0) return undefined;
  // Whole-assembly evidence is the explicit broad-scope tie-break. It wins
  // over individual parts; only competing part targets remain ambiguous.
  if (sorted.includes("assembly")) {
    return { kind: "unique", anchor: { target: "assembly", criterion } };
  }
  if (sorted.length === 1) {
    return { kind: "unique", anchor: { target: sorted[0]!, criterion } };
  }
  return { kind: "ambiguous", targets: sorted };
}

/** A shared capture is not a component identity; competing bindings stay open. */
function stateFromEvidenceCaptureTargets(
  targets: Iterable<PartTarget>,
): AnchorState | undefined {
  const sorted = sortTargets(targets);
  if (sorted.length === 0) return undefined;
  if (sorted.length === 1) {
    return {
      kind: "unique",
      anchor: { target: sorted[0]!, criterion: "catalog" },
    };
  }
  return { kind: "ambiguous", targets: sorted };
}

function stateTargets(state: AnchorState | undefined): readonly PartTarget[] {
  if (!state) return [];
  return state.kind === "unique" ? [state.anchor.target] : state.targets;
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
  states: Map<string, AnchorState>,
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
    for (const node of [...graph.nodes].sort(compareNodes)) {
      const key = refKey(node);
      if (states.has(key)) continue;
      const srcs = [...(sources.get(key) ?? [])].sort();
      if (srcs.length === 0) continue;
      const state = stateFromTargets(
        srcs.flatMap((source) => stateTargets(states.get(source))),
        "derived-from",
      );
      if (state) {
        states.set(key, state);
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
  states: Map<string, AnchorState>,
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
    for (const node of [...graph.nodes].sort(compareNodes)) {
      const key = refKey(node);
      if (states.has(key)) continue;

      let candidates: readonly PartTarget[] = [];

      if (node.entityKind === "change") {
        // A change node inherits from the artifact it "changes".
        // Edge direction: change → artifact (changes, forward).
        const artifacts = outgoing.get(key)?.filter((e) =>
          e.relation === "changes"
        ) ??
          [];
        candidates = artifacts.flatMap((artifact) =>
          stateTargets(states.get(artifact.key))
        );
      } else if (node.entityKind === "consumption") {
        // A consumption node inherits from the artifact it attests.
        // Edge direction: artifact → consumption (uses, reverse).
        const artifacts = incoming.get(key)?.filter((e) =>
          e.relation === "uses"
        ) ?? [];
        candidates = artifacts.flatMap((artifact) =>
          stateTargets(states.get(artifact.key))
        );
      } else {
        // General: inherit from any adjacent resolved node via any edge.
        const neighbours = [
          ...(outgoing.get(key) ?? []),
          ...(incoming.get(key) ?? []),
        ];
        candidates = neighbours.flatMap((neighbour) =>
          stateTargets(states.get(neighbour.key))
        );
      }

      const state = stateFromTargets(candidates, "change-consumption");
      if (state) {
        states.set(key, state);
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
 * (a) Catalog exact `binding.id` — a digital-thread artifact binding resolves
 *     to its declared component. A shared `evidenceArtifactId` remains a
 *     capture fallback and is explicitly ambiguous across components.
 *
 * (b) Assembly-level nature — certain artifact kinds or producer systems are
 *     always whole-machine scope (sysml-model, thermal, BOM, brief, seed).
 *     Applies to artifact nodes only.
 *
 * (c) Transitive `derived_from` propagation — iterative BFS through
 *     derived_from graph edges.  Assembly wins on conflict between parts.
 *
 * (d) Change / consumption / adjacent inheritance — change and consumption
 *     nodes inherit from their directly connected artifact; other non-artifact
 *     nodes inherit from any adjacent resolved node.  Iterates until stable.
 *
 * (e) Generic server-fixed artifact forms — complete id + artifact kind forms
 *     fill only gaps left by the more-specific catalog and lineage criteria.
 *
 * Only uniquely-resolved nodes appear in the returned map; use
 * `buildPartAnchorageResolution` when the caller must also inspect conflicts.
 */
export function buildPartAnchorage(
  graph: ThreadGraph,
  components: ThreadComponentCatalog,
): Map<string, PartAnchor> {
  const resolution = buildPartAnchorageResolution(graph, components);
  resolutionByAnchors.set(resolution.anchors, resolution);
  return resolution.anchors;
}

/** Build the complete, deterministic unique / ambiguous / orphan outcome. */
export function buildPartAnchorageResolution(
  graph: ThreadGraph,
  components: ThreadComponentCatalog,
): PartAnchorageResolution {
  const states = new Map<string, AnchorState>();

  // (a) Catalog exact binding id, then immutable capture fallback.
  const catalogCandidates = buildCatalogCandidates(components);
  for (const node of [...graph.nodes].sort(compareNodes)) {
    if (node.entityKind !== "artifact") continue;
    const state = stateFromTargets(
      catalogCandidates.bindingId.get(node.ref.id) ?? [],
      "catalog",
    ) ?? stateFromEvidenceCaptureTargets(
      catalogCandidates.evidenceArtifactId.get(node.ref.id) ?? [],
    );
    if (state) states.set(refKey(node), state);
  }

  // (b) Assembly-level nature — artifact nodes only.
  for (const node of [...graph.nodes].sort(compareNodes)) {
    if (states.has(refKey(node))) continue;
    const target = anchorByNature(node);
    if (target !== null) {
      states.set(refKey(node), {
        kind: "unique",
        anchor: { target, criterion: "nature" },
      });
    }
  }

  // (c) Transitive derived_from propagation.
  propagateDerivedFrom(graph, states);

  // (d) Change / consumption / adjacent inheritance.
  propagateChangeConsumption(graph, states);

  // (e) Generic whole-assembly forms only fill gaps left by exact catalog
  // identity and provenance. Their complete shape and artifact kind are
  // checked by anchorByPrefix.
  for (const node of [...graph.nodes].sort(compareNodes)) {
    if (states.has(refKey(node))) continue;
    const target = anchorByPrefix(node);
    if (target !== null) {
      states.set(refKey(node), {
        kind: "unique",
        anchor: { target, criterion: "prefix" },
      });
    }
  }

  // A generic fallback can in turn anchor an adjacent fact.
  propagateChangeConsumption(graph, states);

  const anchors = new Map<string, PartAnchor>();
  const ambiguousByRef = new Map<string, readonly PartTarget[]>();
  for (const [key, state] of states) {
    if (state.kind === "unique") anchors.set(key, state.anchor);
    else ambiguousByRef.set(key, state.targets);
  }
  const orphanRefKeys = new Set(
    graph.nodes.map(refKey).filter((key) => !states.has(key)),
  );
  const resolution: PartAnchorageResolution = {
    anchors,
    ambiguousByRef,
    orphanRefKeys,
  };
  resolutionByAnchors.set(anchors, resolution);
  return resolution;
}

/**
 * Compute anchorage coverage from the anchored map and the full graph.
 *
 * The metadata is attached when the map comes from `buildPartAnchorage`.
 * Manually constructed maps remain conservative: any unknown graph node is an
 * orphan, never an invented ambiguity.
 */
export function anchorageCoverage(
  map: ReadonlyMap<string, PartAnchor>,
  graph: ThreadGraph,
): AnchorageCoverage {
  const metadata = resolutionByAnchors.get(map);
  const graphKeys = new Set(graph.nodes.map(refKey));
  const unique = [...graphKeys].filter((key) => map.has(key)).length;
  const ambiguous = metadata
    ? [...metadata.ambiguousByRef.keys()].filter((key) => graphKeys.has(key))
      .length
    : 0;
  return {
    unique,
    ambiguous,
    orphan: graph.nodes.length - unique - ambiguous,
  };
}

function compareNodes(left: ThreadGraphNode, right: ThreadGraphNode): number {
  return refKey(left).localeCompare(refKey(right));
}
