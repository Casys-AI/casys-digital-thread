import type {
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyEdgeRef,
  ThreadEvidenceFamilyGraph,
  ThreadEvidenceFamilyGraphEdge,
  ThreadEvidenceFamilyOmittedCycleEdge,
  ThreadEvidenceFamilyOmittedSelfLoop,
} from "../../presentation/workbench/thread/evidence.ts";
import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "../../presentation/workbench/thread/graph.ts";

/**
 * Build the compact, revision-aware quotient graph used by the Workbench.
 *
 * This is intentionally a read-only presentation transform over the already
 * projected canonical graph. It forms a family from an explicit provenance
 * `supersedes` edge, or from a `derived_from` edge whose both endpoints are
 * architecture-capture artefacts or both requirements-capture artefacts
 * (the Thread predecessor of a later tip). Labels, fingerprints, dates and
 * identifier fragments never decide membership.
 */
export interface EvidenceFamilyGraphOptions {
  /** Artifact ids whose capture URI is `casys://architecture-capture/`. */
  readonly architectureCaptureIds?: ReadonlySet<string>;
  /** Artifact ids whose capture URI is `casys://requirements-capture/`. */
  readonly requirementsCaptureIds?: ReadonlySet<string>;
}

export function projectEvidenceFamilyGraph(
  graph: ThreadGraph,
  asOf: ThreadEvidenceFamilyGraph["asOf"],
  options: EvidenceFamilyGraphOptions = {},
): ThreadEvidenceFamilyGraph {
  const nodeByRef = new Map(
    graph.nodes.map((node) => [refKey(node.ref), node]),
  );
  const correctionDeclarations = correctionDeclarationRefs(graph, nodeByRef);
  const architectureCaptureIds = options.architectureCaptureIds ??
    new Set<string>();
  const requirementsCaptureIds = options.requirementsCaptureIds ??
    new Set<string>();
  const candidateTransitions = graph.edges.filter((edge) =>
    isEligibleVersionTransition(
      edge,
      nodeByRef,
      correctionDeclarations,
      architectureCaptureIds,
      requirementsCaptureIds,
    )
  );
  // A fan-out is not a single-current version family. Rather than collapse an
  // unclassified correction record with actual replacement evidence, retain
  // those links solely in the raw forensic graph. Explicit convergence on one
  // successor remains safe: it declares one current record without guessing
  // which sibling branch won.
  const transitions = unambiguousSupersessionChains(candidateTransitions);
  const families = familiesFromTransitions(graph, transitions);
  const familyByMember = new Map<string, string>();
  for (const family of families) {
    for (const reference of [...family.historicalRefs, ...family.currentRefs]) {
      familyByMember.set(refKey(reference), family.id);
    }
  }
  const quotient = quotientEdges(graph.edges, familyByMember);

  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { ...asOf },
    families,
    edges: quotient.edges,
    omittedSelfLoops: quotient.omittedSelfLoops,
    omittedCycleEdges: quotient.omittedCycleEdges,
  };
}

/**
 * Keep only supersession links with one explicit successor per predecessor.
 * Several historical records may explicitly converge on one successor: that
 * has one unambiguous current record and can safely be represented as a
 * family. The reverse shape (one record with sibling successors) remains raw,
 * because the topology does not say which successor is current.
 */
function unambiguousSupersessionChains(
  candidates: readonly ThreadGraphEdge[],
): ThreadGraphEdge[] {
  const successors = groupedDistinctRefs(
    candidates,
    (edge) => edge.from,
    (edge) => edge.to,
  );
  return candidates.filter((edge) =>
    (successors.get(refKey(edge.from))?.size ?? 0) === 1
  );
}

function groupedDistinctRefs(
  edges: readonly ThreadGraphEdge[],
  keyOf: (edge: ThreadGraphEdge) => ThreadGraphRef,
  valueOf: (edge: ThreadGraphEdge) => ThreadGraphRef,
): ReadonlyMap<string, ReadonlySet<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const edge of edges) {
    const key = refKey(keyOf(edge));
    const values = grouped.get(key) ?? new Set<string>();
    values.add(refKey(valueOf(edge)));
    grouped.set(key, values);
  }
  return grouped;
}

/**
 * A correction declaration can explicitly name an affected component in the
 * graph. Its `supersedes` links state that a prior basis is invalid, not that
 * the declaration itself is replacement evidence. Keep that record in the raw
 * graph and out of evidence-version families without inspecting its label or
 * identifier.
 */
function correctionDeclarationRefs(
  graph: ThreadGraph,
  nodeByRef: ReadonlyMap<string, ThreadGraphNode>,
): ReadonlySet<string> {
  const declarations = new Set<string>();
  for (const edge of graph.edges) {
    if (
      edge.relation !== "changes" || edge.from.kind !== "change" ||
      edge.to.kind !== "artifact"
    ) {
      continue;
    }
    const change = nodeByRef.get(refKey(edge.from));
    if (change?.affectedComponentId) declarations.add(refKey(edge.to));
  }
  return declarations;
}

function isEligibleVersionTransition(
  edge: ThreadGraphEdge,
  nodeByRef: ReadonlyMap<string, ThreadGraphNode>,
  correctionDeclarations: ReadonlySet<string>,
  architectureCaptureIds: ReadonlySet<string>,
  requirementsCaptureIds: ReadonlySet<string>,
): boolean {
  if (edge.origin !== "provenance") return false;
  const attestedPredecessor = edge.relation === "derived_from" &&
    edge.from.kind === "artifact" &&
    edge.to.kind === "artifact" &&
    sameCaptureLineage(
      edge.from.id,
      edge.to.id,
      architectureCaptureIds,
      requirementsCaptureIds,
    );
  if (edge.relation !== "supersedes" && !attestedPredecessor) {
    return false;
  }
  const historical = nodeByRef.get(refKey(edge.from));
  const successor = nodeByRef.get(refKey(edge.to));
  if (!historical || !successor) return false;
  if (
    correctionDeclarations.has(refKey(historical.ref)) ||
    correctionDeclarations.has(refKey(successor.ref))
  ) {
    return false;
  }
  if (!isDurableFamilyNode(historical) || !isDurableFamilyNode(successor)) {
    return false;
  }
  if (historical.entityKind !== successor.entityKind) return false;
  if (historical.entityKind === "artifact") {
    return historical.artifactKind !== undefined &&
      historical.artifactKind === successor.artifactKind;
  }
  return historical.entityKind === "requirement";
}

function sameCaptureLineage(
  fromId: string,
  toId: string,
  architectureCaptureIds: ReadonlySet<string>,
  requirementsCaptureIds: ReadonlySet<string>,
): boolean {
  return (architectureCaptureIds.has(fromId) &&
    architectureCaptureIds.has(toId)) ||
    (requirementsCaptureIds.has(fromId) && requirementsCaptureIds.has(toId));
}

/**
 * Live/running and failed executions remain raw execution facts. A stale
 * canonical artifact is still retained durable history and is therefore safe
 * to show as a historical family member.
 */
function isDurableFamilyNode(node: ThreadGraphNode): boolean {
  return (node.entityKind === "artifact" || node.entityKind === "requirement") &&
    node.freshness !== "running" && node.freshness !== "failed";
}

function familiesFromTransitions(
  graph: ThreadGraph,
  transitions: readonly ThreadGraphEdge[],
): ThreadEvidenceFamily[] {
  if (transitions.length === 0) return [];

  const partition = new DisjointSet<string>();
  for (const edge of transitions) {
    partition.union(refKey(edge.from), refKey(edge.to));
  }

  const membersByRoot = new Map<string, Set<string>>();
  for (const edge of transitions) {
    for (const reference of [edge.from, edge.to]) {
      const key = refKey(reference);
      const root = partition.find(key);
      const members = membersByRoot.get(root) ?? new Set<string>();
      members.add(key);
      membersByRoot.set(root, members);
    }
  }

  const transitionsByRoot = new Map<string, ThreadGraphEdge[]>();
  for (const edge of transitions) {
    const root = partition.find(refKey(edge.from));
    const items = transitionsByRoot.get(root) ?? [];
    items.push(edge);
    transitionsByRoot.set(root, items);
  }

  const order = new Map(
    graph.nodes.map((node, index) => [refKey(node.ref), index]),
  );
  const components = [...membersByRoot.entries()].map(([root, members]) => ({
    root,
    members,
    firstOrder: Math.min(
      ...[...members].map((key) => order.get(key) ?? Number.MAX_SAFE_INTEGER),
    ),
  })).toSorted((left, right) => left.firstOrder - right.firstOrder);

  const nodeByRef = new Map(
    graph.nodes.map((node) => [refKey(node.ref), node]),
  );
  return components.map((component) => {
    const members = [...component.members].toSorted((left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
    const familyTransitions = transitionsByRoot.get(component.root) ?? [];
    const historicalKeys = new Set(
      familyTransitions.map((edge) => refKey(edge.from)),
    );
    const currentKeys = members.filter((key) => !historicalKeys.has(key));
    const first = nodeByRef.get(members[0]!);
    if (!first || !isFamilyEntityKind(first.entityKind)) {
      throw new Error("Evidence family members must be compatible durable entities.");
    }
    const status = currentKeys.length === 1 ? "current" : "review-required";

    return {
      id: familyId(first.ref),
      entityKind: first.entityKind,
      ...(first.entityKind === "artifact" ? { artifactKind: first.artifactKind } : {}),
      historicalRefs: members
        .filter((key) => !currentKeys.includes(key))
        .map((key) => copyRef(nodeByRef.get(key)!.ref)),
      currentRefs: currentKeys.map((key) => copyRef(nodeByRef.get(key)!.ref)),
      revisionCount: familyTransitions.length,
      status,
      ...(status === "review-required"
        ? {
          reviewReason: currentKeys.length === 0
            ? "no-current-successor" as const
            : "divergent-successors" as const,
        }
        : {}),
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: familyTransitions.map((edge) => ({
        edgeRef: edgeRef(edge),
        historical: copyRef(edge.from),
        successor: copyRef(edge.to),
      })),
    };
  });
}

function quotientEdges(
  graphEdges: readonly ThreadGraphEdge[],
  familyByMember: ReadonlyMap<string, string>,
): {
  edges: ThreadEvidenceFamilyGraphEdge[];
  omittedSelfLoops: ThreadEvidenceFamilyOmittedSelfLoop[];
  omittedCycleEdges: ThreadEvidenceFamilyOmittedCycleEdge[];
} {
  const selfLoops = new Map<string, ThreadEvidenceFamilyEdgeRef[]>();
  const candidates = new Map<
    string,
    {
      fromFamilyId: string;
      toFamilyId: string;
      relation: ThreadGraphEdge["relation"];
      origin: ThreadGraphEdge["origin"];
      memberEdgeRefs: ThreadEvidenceFamilyEdgeRef[];
    }
  >();

  for (const edge of graphEdges) {
    const fromFamilyId = familyByMember.get(refKey(edge.from));
    const toFamilyId = familyByMember.get(refKey(edge.to));
    if (!fromFamilyId || !toFamilyId) continue;
    if (fromFamilyId === toFamilyId) {
      const references = selfLoops.get(fromFamilyId) ?? [];
      references.push(edgeRef(edge));
      selfLoops.set(fromFamilyId, references);
      continue;
    }
    const key = [fromFamilyId, toFamilyId, edge.relation, edge.origin].join("\u0000");
    const candidate = candidates.get(key) ?? {
      fromFamilyId,
      toFamilyId,
      relation: edge.relation,
      origin: edge.origin,
      memberEdgeRefs: [],
    };
    candidate.memberEdgeRefs.push(edgeRef(edge));
    candidates.set(key, candidate);
  }

  const adjacency = new Map<string, Set<string>>();
  const edges: ThreadEvidenceFamilyGraphEdge[] = [];
  const omittedCycleEdges: ThreadEvidenceFamilyOmittedCycleEdge[] = [];
  for (const candidate of candidates.values()) {
    if (reaches(adjacency, candidate.toFamilyId, candidate.fromFamilyId)) {
      omittedCycleEdges.push({
        fromFamilyId: candidate.fromFamilyId,
        toFamilyId: candidate.toFamilyId,
        memberEdgeRefs: candidate.memberEdgeRefs,
      });
      continue;
    }
    const targets = adjacency.get(candidate.fromFamilyId) ?? new Set<string>();
    targets.add(candidate.toFamilyId);
    adjacency.set(candidate.fromFamilyId, targets);
    edges.push({
      id: `evidence-family-edge:${edges.length + 1}`,
      ...candidate,
    });
  }

  return {
    edges,
    omittedSelfLoops: [...selfLoops].map(([familyId, memberEdgeRefs]) => ({
      familyId,
      memberEdgeRefs,
    })),
    omittedCycleEdges,
  };
}

function reaches(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  target: string,
): boolean {
  const pending = [from];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return false;
}

function isFamilyEntityKind(
  kind: ThreadGraphNode["entityKind"],
): kind is ThreadEvidenceFamily["entityKind"] {
  return kind === "artifact" || kind === "requirement";
}

function familyId(reference: ThreadGraphRef): string {
  return `evidence-family:${reference.kind}:${reference.id}`;
}

function edgeRef(edge: ThreadGraphEdge): ThreadEvidenceFamilyEdgeRef {
  return { id: edge.id, relation: edge.relation, origin: edge.origin };
}

function copyRef(reference: ThreadGraphRef): ThreadGraphRef {
  return { kind: reference.kind, id: reference.id };
}

function refKey(reference: ThreadGraphRef): string {
  return `${reference.kind}\u0000${reference.id}`;
}

class DisjointSet<T> {
  #parents = new Map<T, T>();

  find(value: T): T {
    const parent = this.#parents.get(value);
    if (parent === undefined) {
      this.#parents.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.#parents.set(value, root);
    return root;
  }

  union(left: T, right: T): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.#parents.set(rightRoot, leftRoot);
  }
}
