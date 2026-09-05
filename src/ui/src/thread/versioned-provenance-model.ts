import type {
  ThreadArtifact,
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRequirement,
} from "./types.ts";

export type VersionedGraphSelection =
  | { kind: "node"; ref: ThreadGraphRef }
  | {
    kind: "edge";
    id: string;
    occurrence?: VersionedEdgeOccurrence;
  };

export interface VersionedEvidenceFamily {
  family: ThreadEvidenceFamily;
  /** Canonical tip. Version history marks this CURRENT. */
  representative: ThreadGraphNode;
  /**
   * Single visible graph node for the family. Equals `representative` unless
   * a historical member is being presented as-of.
   */
  visible: ThreadGraphNode;
  /** Explicit supersession order, oldest first and current last. */
  members: ThreadGraphNode[];
  /** Canonical relations hidden only because both endpoints are in this node. */
  internalEdges: ThreadGraphEdge[];
}

/**
 * Optional presentation overlay. It never mutates family membership or the
 * canonical graph: it only chooses which folded member occupies the visible
 * node slot and which of that member's external relations are shown.
 */
export interface VersionedProvenanceOptions {
  readonly presentedMemberRef?: ThreadGraphRef;
}

export interface VersionedEdgeOccurrence {
  /** Stable group identity, never the user/provider-supplied edge id alone. */
  readonly key: string;
  /** Exact visible or member relation for this occurrence. */
  readonly edge: ThreadGraphEdge;
}

export interface VersionedProvenanceEdgeGroup {
  /** One canonical relation represents this visible handoff. */
  representative: ThreadGraphEdge;
  /** Every canonical relation folded into the same visible handoff. */
  members: ThreadGraphEdge[];
}

export interface VersionedProvenanceProjection {
  graph: ThreadGraph;
  collapsedVersionCount: number;
  familyByMemberRef: ReadonlyMap<string, VersionedEvidenceFamily>;
  familyByVisibleRef: ReadonlyMap<string, VersionedEvidenceFamily>;
  /** Groups keyed by the unique visible relation occurrence. */
  edgeGroupByVisibleOccurrenceKey: ReadonlyMap<
    string,
    VersionedProvenanceEdgeGroup
  >;
  /** Raw member occurrence → visible representative occurrence. */
  visibleOccurrenceKeyByMemberOccurrenceKey: ReadonlyMap<string, string>;
  /** Identity indexes used to reproject a selection after folding/live updates. */
  memberOccurrenceKeyByEdge: ReadonlyMap<ThreadGraphEdge, string>;
  memberEdgeByOccurrenceKey: ReadonlyMap<string, ThreadGraphEdge>;
  /**
   * A byte-for-byte duplicate has no business discriminator in the contract.
   * Its ordinal is graph-local only, so a stale selection is rejected rather
   * than being reassigned to an arbitrary duplicate after an SSE snapshot.
   */
  ambiguousMemberOccurrenceKeys: ReadonlySet<string>;
  visibleOccurrenceKeyByEdge: ReadonlyMap<ThreadGraphEdge, string>;
  visibleEdgeByOccurrenceKey: ReadonlyMap<string, ThreadGraphEdge>;
  visibleRefByMemberRef: ReadonlyMap<string, ThreadGraphRef>;
}

/**
 * Current graph occurrences that can safely hydrate a controlled selection.
 *
 * The map is deliberately keyed by occurrence identity, never by the
 * provider-facing `edge.id`: edge ids are not unique in the thread contract.
 * `legacyEdgesById` exists only for selections produced before occurrence keys
 * were introduced and is resolved only when exactly one recorded edge matches.
 */
export interface VersionedGraphSelectionIndex {
  readonly edgeByOccurrenceKey: ReadonlyMap<string, ThreadGraphEdge>;
  readonly legacyEdgesById: ReadonlyMap<
    string,
    readonly ThreadGraphEdge[]
  >;
}

/**
 * Folds only BFF-declared, single-successor revision families into the raw
 * provenance graph. Ambiguous or incomplete families remain fully visible.
 * Labels, hashes, timestamps and provider names never create membership.
 */
export function buildVersionedProvenanceProjection(
  graph: ThreadGraph,
  familyGraph: ThreadEvidenceFamilyGraph,
  options: VersionedProvenanceOptions = {},
): VersionedProvenanceProjection {
  const nodeByRef = new Map(
    graph.nodes.map((node) => [refKey(node.ref), node] as const),
  );
  const membershipCount = new Map<string, number>();
  for (const family of familyGraph.families) {
    for (const reference of familyRefs(family)) {
      const key = refKey(reference);
      membershipCount.set(key, (membershipCount.get(key) ?? 0) + 1);
    }
  }

  const visibleRefByMemberRef = new Map<string, ThreadGraphRef>();
  const familyByMemberRef = new Map<string, VersionedEvidenceFamily>();
  const familyByVisibleRef = new Map<string, VersionedEvidenceFamily>();
  const pendingFamilies: Array<{
    family: ThreadEvidenceFamily;
    representative: ThreadGraphNode;
    visible: ThreadGraphNode;
    members: ThreadGraphNode[];
  }> = [];
  /**
   * Members hidden by an as-of presentation. Their external relations must
   * not be remapped onto the presented node — that would keep the tip's
   * neighbours while claiming to show an earlier version.
   */
  const asOfHiddenMemberKeys = new Set<string>();

  for (const family of familyGraph.families) {
    if (family.status !== "current" || family.currentRefs.length !== 1) {
      continue;
    }
    const references = orderedFamilyRefs(family);
    if (
      references.some((reference) =>
        membershipCount.get(refKey(reference)) !== 1 ||
        !nodeByRef.has(refKey(reference))
      )
    ) {
      continue;
    }
    const representative = nodeByRef.get(refKey(family.currentRefs[0]!));
    if (!representative) continue;
    const members = references.map((reference) =>
      nodeByRef.get(refKey(reference))!
    );
    const presented = presentedMemberInFamily(
      members,
      options.presentedMemberRef,
    );
    const visible = presented ?? representative;
    pendingFamilies.push({ family, representative, visible, members });
    for (const member of members) {
      visibleRefByMemberRef.set(refKey(member.ref), visible.ref);
      if (presented && refKey(member.ref) !== refKey(visible.ref)) {
        asOfHiddenMemberKeys.add(refKey(member.ref));
      }
    }
  }

  const exclusiveAsOfHiddenKeys = exclusiveDependentKeys(
    graph,
    pendingFamilies
      .filter((pending) =>
        options.presentedMemberRef !== undefined &&
        pending.members.some((member) =>
          refKey(member.ref) === refKey(options.presentedMemberRef!)
        )
      )
      .map((pending) => ({
        memberKeys: new Set(
          pending.members.map((member) => refKey(member.ref)),
        ),
        presentedKey: refKey(pending.visible.ref),
      })),
  );

  const memberOccurrences = indexMemberEdgeOccurrences(graph.edges);
  const memberOccurrenceKeyByEdge = memberOccurrences.keyByEdge;
  const memberEdgeByOccurrenceKey = new Map<string, ThreadGraphEdge>();
  for (const [edge, occurrenceKey] of memberOccurrenceKeyByEdge) {
    memberEdgeByOccurrenceKey.set(occurrenceKey, edge);
  }
  const internalEdgesByVisibleRef = new Map<string, ThreadGraphEdge[]>();
  const groupedEdges = new Map<
    string,
    Array<{ edge: ThreadGraphEdge; memberOccurrenceKey: string }>
  >();
  for (const edge of graph.edges) {
    const from = visibleRefByMemberRef.get(refKey(edge.from)) ?? edge.from;
    const to = visibleRefByMemberRef.get(refKey(edge.to)) ?? edge.to;
    if (refKey(from) === refKey(to)) {
      const bucket = internalEdgesByVisibleRef.get(refKey(from)) ?? [];
      bucket.push(edge);
      internalEdgesByVisibleRef.set(refKey(from), bucket);
      continue;
    }
    if (
      asOfHiddenMemberKeys.has(refKey(edge.from)) ||
      asOfHiddenMemberKeys.has(refKey(edge.to)) ||
      exclusiveAsOfHiddenKeys.has(refKey(edge.from)) ||
      exclusiveAsOfHiddenKeys.has(refKey(edge.to))
    ) {
      continue;
    }
    const groupKey = versionedEdgeOccurrenceKey({ ...edge, from, to });
    const bucket = groupedEdges.get(groupKey) ?? [];
    bucket.push({
      edge,
      memberOccurrenceKey: memberOccurrenceKeyByEdge.get(edge)!,
    });
    groupedEdges.set(groupKey, bucket);
  }

  for (const pending of pendingFamilies) {
    const versionedFamily: VersionedEvidenceFamily = {
      ...pending,
      internalEdges: [
        ...(
          internalEdgesByVisibleRef.get(refKey(pending.visible.ref)) ??
            []
        ),
      ].sort(compareEdges),
    };
    familyByVisibleRef.set(
      refKey(pending.visible.ref),
      versionedFamily,
    );
    for (const member of pending.members) {
      familyByMemberRef.set(refKey(member.ref), versionedFamily);
    }
  }

  const nodes: ThreadGraphNode[] = [];
  for (const node of graph.nodes) {
    if (exclusiveAsOfHiddenKeys.has(refKey(node.ref))) continue;
    const visibleRef = visibleRefByMemberRef.get(refKey(node.ref));
    if (!visibleRef) {
      nodes.push(node);
      continue;
    }
    if (refKey(visibleRef) !== refKey(node.ref)) continue;
    const family = familyByVisibleRef.get(refKey(visibleRef));
    if (!family) {
      nodes.push(node);
      continue;
    }
    nodes.push({
      ...node,
      summary: `${versionLabel(family.members.length)} · ${node.summary}`,
    });
  }

  const edgeGroupByVisibleOccurrenceKey = new Map<
    string,
    VersionedProvenanceEdgeGroup
  >();
  const visibleOccurrenceKeyByMemberOccurrenceKey = new Map<string, string>();
  const visibleOccurrenceKeyByEdge = new Map<ThreadGraphEdge, string>();
  const visibleEdgeByOccurrenceKey = new Map<string, ThreadGraphEdge>();
  const edges = [...groupedEdges.entries()].map(
    ([visibleOccurrenceKey, members]) => {
      const orderedMembers = [...members].sort((left, right) =>
        compareRepresentativeEdges(
          left.edge,
          right.edge,
          visibleRefByMemberRef,
        )
      );
      const canonicalRepresentative = orderedMembers[0]!.edge;
      const from =
        visibleRefByMemberRef.get(refKey(canonicalRepresentative.from)) ??
          canonicalRepresentative.from;
      const to =
        visibleRefByMemberRef.get(refKey(canonicalRepresentative.to)) ??
          canonicalRepresentative.to;
      const representative: ThreadGraphEdge = {
        ...canonicalRepresentative,
        from,
        to,
        rationale: members.length === 1
          ? canonicalRepresentative.rationale
          : `${members.length} recorded handoffs across versions. ${canonicalRepresentative.rationale}`,
      };
      const group: VersionedProvenanceEdgeGroup = {
        representative,
        members: orderedMembers.map((member) => member.edge),
      };
      edgeGroupByVisibleOccurrenceKey.set(visibleOccurrenceKey, group);
      visibleOccurrenceKeyByEdge.set(representative, visibleOccurrenceKey);
      visibleEdgeByOccurrenceKey.set(visibleOccurrenceKey, representative);
      for (const member of members) {
        visibleOccurrenceKeyByMemberOccurrenceKey.set(
          member.memberOccurrenceKey,
          visibleOccurrenceKey,
        );
      }
      return representative;
    },
  ).sort(compareEdges);

  return {
    graph: { nodes, edges },
    collapsedVersionCount: pendingFamilies.reduce(
      (count, pending) => count + pending.members.length - 1,
      0,
    ),
    familyByMemberRef,
    familyByVisibleRef,
    edgeGroupByVisibleOccurrenceKey,
    visibleOccurrenceKeyByMemberOccurrenceKey,
    memberOccurrenceKeyByEdge,
    memberEdgeByOccurrenceKey,
    ambiguousMemberOccurrenceKeys: memberOccurrences.ambiguousKeys,
    visibleOccurrenceKeyByEdge,
    visibleEdgeByOccurrenceKey,
    visibleRefByMemberRef,
  };
}

export function visibleGraphRef(
  projection: VersionedProvenanceProjection,
  reference: ThreadGraphRef | undefined,
): ThreadGraphRef | undefined {
  if (!reference) return undefined;
  return projection.visibleRefByMemberRef.get(refKey(reference)) ?? reference;
}

/**
 * Builds the current selection index shared by the raw Feed, versioned graph,
 * Sigma and SVG renderers.
 */
export function buildVersionedGraphSelectionIndex(
  projection: VersionedProvenanceProjection,
): VersionedGraphSelectionIndex {
  const edgeByOccurrenceKey = new Map<string, ThreadGraphEdge>();
  const legacyEdgesById = new Map<string, ThreadGraphEdge[]>();
  const addLegacyEdge = (edge: ThreadGraphEdge) => {
    const candidates = legacyEdgesById.get(edge.id) ?? [];
    if (!candidates.includes(edge)) candidates.push(edge);
    legacyEdgesById.set(edge.id, candidates);
  };

  for (const [key, edge] of projection.memberEdgeByOccurrenceKey) {
    edgeByOccurrenceKey.set(key, edge);
    addLegacyEdge(edge);
  }
  for (const [key, edge] of projection.visibleEdgeByOccurrenceKey) {
    edgeByOccurrenceKey.set(key, edge);
  }
  return { edgeByOccurrenceKey, legacyEdgesById };
}

export function visibleGraphSelection(
  projection: VersionedProvenanceProjection,
  selection: VersionedGraphSelection | undefined,
  selectionIndex = buildVersionedGraphSelectionIndex(projection),
): VersionedGraphSelection | undefined {
  if (!selection) return undefined;
  if (selection.kind === "node") {
    return {
      kind: "node",
      ref: visibleGraphRef(projection, selection.ref) ?? selection.ref,
    };
  }
  const visibleOccurrence = visibleEdgeOccurrenceForSelection(
    projection,
    selection,
    selectionIndex,
  );
  if (visibleOccurrence) {
    return {
      kind: "edge",
      id: visibleOccurrence.edge.id,
      occurrence: visibleOccurrence,
    };
  }
  if (selection.occurrence) {
    // A keyed selection is an exact current-occurrence lookup. Never retain
    // the stale object or fall back to its non-unique provider id after SSE.
    const currentEdge = currentEdgeForKeyedSelection(
      projection,
      selectionIndex,
      selection,
    );
    return currentEdge
      ? {
        kind: "edge",
        id: currentEdge.id,
        occurrence: { key: selection.occurrence.key, edge: currentEdge },
      }
      : undefined;
  }
  // Legacy selections have no occurrence identity and can only stay visible
  // when the current graph contains exactly one recorded relation with this id.
  const currentEdge = uniqueLegacyEdgeForId(selectionIndex, selection.id);
  return currentEdge ? { kind: "edge", id: currentEdge.id } : undefined;
}

/** Resolve a member/visible edge selection to its one visible occurrence. */
export function visibleEdgeOccurrenceForSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }>,
  selectionIndex = buildVersionedGraphSelectionIndex(projection),
): VersionedEdgeOccurrence | undefined {
  let visibleKey: string | undefined;
  if (selection.occurrence) {
    const occurrenceKey = selection.occurrence.key;
    // A current lookup by the supplied key is mandatory before any mapping.
    // This prevents a stale object or duplicate raw id from selecting another
    // relation after a live cardinality change.
    if (!currentEdgeForKeyedSelection(projection, selectionIndex, selection)) {
      return undefined;
    }
    visibleKey = projection.visibleEdgeByOccurrenceKey.has(occurrenceKey)
      ? occurrenceKey
      : projection.visibleOccurrenceKeyByMemberOccurrenceKey.get(
        occurrenceKey,
      );
  } else {
    const memberKey = uniqueMemberOccurrenceKeyForLegacyId(
      projection,
      selection.id,
    );
    visibleKey = memberKey
      ? projection.visibleOccurrenceKeyByMemberOccurrenceKey.get(memberKey)
      : undefined;
  }
  if (!visibleKey) return undefined;
  const edge = projection.visibleEdgeByOccurrenceKey.get(visibleKey);
  return edge ? { key: visibleKey, edge } : undefined;
}

/**
 * Resolves a selection to the current edge object for the inspector. A raw
 * Feed occurrence stays raw; a folded visible occurrence stays visible. Both
 * paths replace stale objects after an SSE snapshot with the current graph
 * object identified by their occurrence key.
 */
export function edgeForVersionedGraphSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }> | undefined,
  selectionIndex = buildVersionedGraphSelectionIndex(projection),
): ThreadGraphEdge | undefined {
  if (!selection) return undefined;
  if (selection.occurrence) {
    // No raw-id fallback is permitted for a keyed selection. The current
    // occurrence map is the sole source of truth for inspector hydration.
    return currentEdgeForKeyedSelection(projection, selectionIndex, selection);
  }
  return uniqueLegacyEdgeForId(selectionIndex, selection.id);
}

/**
 * Whether a keyed selection no longer resolves to one safe current occurrence.
 * This covers a missing key after an SSE cardinality change and a byte-identical
 * duplicate whose graph-local ordinal cannot prove continuity after reorder.
 */
export function isStaleAmbiguousVersionedEdgeSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }> | undefined,
  selectionIndex = buildVersionedGraphSelectionIndex(projection),
): boolean {
  return !!selection?.occurrence &&
    !currentEdgeForKeyedSelection(projection, selectionIndex, selection);
}

/** Resolve a version-history group without ever indexing by edge.id alone. */
export function versionedEdgeGroupForSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }> | undefined,
  selectionIndex = buildVersionedGraphSelectionIndex(projection),
): VersionedProvenanceEdgeGroup | undefined {
  if (!selection) return undefined;
  const occurrence = visibleEdgeOccurrenceForSelection(
    projection,
    selection,
    selectionIndex,
  );
  return occurrence
    ? projection.edgeGroupByVisibleOccurrenceKey.get(occurrence.key)
    : undefined;
}

/**
 * Stable visible-group key. It intentionally excludes edge.id: duplicate ids
 * are permitted, whereas the transformed endpoints + relation + origin +
 * attestation status define the versioned grouping contract.
 */
export function versionedEdgeOccurrenceKey(edge: ThreadGraphEdge): string {
  return structuredOccurrenceKey("versioned-edge", [
    edge.from.kind,
    edge.from.id,
    edge.to.kind,
    edge.to.id,
    edge.relation,
    edge.origin,
    edge.attestation?.status ?? null,
  ]);
}

/**
 * Collision-free tuple encoding for occurrence and group keys. JSON strings
 * preserve field boundaries (including user ids containing `|` or NUL) while
 * remaining deterministic and readable in diagnostics.
 */
export function structuredOccurrenceKey(
  namespace: string,
  parts: readonly (string | number | null)[],
): string {
  return JSON.stringify([namespace, ...parts]);
}

/**
 * Every stable field of a recorded graph edge. It deliberately includes the
 * consumption id: two otherwise equal handoffs can record distinct consumed
 * inputs and must survive an SSE reorder as distinct occurrences.
 */
export function threadGraphEdgeRecordSignature(edge: ThreadGraphEdge): string {
  return structuredOccurrenceKey("thread-edge-record", [
    edge.id,
    edge.from.kind,
    edge.from.id,
    edge.to.kind,
    edge.to.id,
    edge.relation,
    edge.rationale,
    edge.origin,
    edge.attestation?.consumptionId ?? null,
    edge.attestation?.status ?? null,
    edge.attestation?.producerFingerprint ?? null,
    edge.attestation?.consumedFingerprint ?? null,
    edge.attestation?.checkedAt ?? null,
  ]);
}

export function versionLabel(count: number): string {
  return `${count} recorded version${count === 1 ? "" : "s"}`;
}

/**
 * Any foldable family member may occupy the visible node. The unfocused
 * map keeps the tip plus remapped historical handoffs; selecting a member
 * presents that member's recorded path only.
 */
export function presentedFamilyMemberRef(
  familyGraph: ThreadEvidenceFamilyGraph,
  reference: ThreadGraphRef | undefined,
): ThreadGraphRef | undefined {
  if (!reference) return undefined;
  const key = refKey(reference);
  let found: ThreadGraphRef | undefined;
  for (const family of familyGraph.families) {
    if (family.status !== "current" || family.currentRefs.length !== 1) {
      continue;
    }
    if (!familyRefs(family).some((item) => refKey(item) === key)) continue;
    if (found) return undefined;
    found = reference;
  }
  return found;
}

/**
 * Nodes reachable from a hidden family member without walking through the
 * presented member, minus the presented member's own path. Shared trunk
 * (seed, common inputs) stays; the other version's exclusive path leaves.
 */
function exclusiveDependentKeys(
  graph: ThreadGraph,
  presentedFamilies: readonly {
    readonly memberKeys: ReadonlySet<string>;
    readonly presentedKey: string;
  }[],
): Set<string> {
  if (presentedFamilies.length === 0) return new Set();
  const adjacency = new Map<string, Set<string>>();
  const link = (left: string, right: string) => {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    adjacency.get(left)!.add(right);
  };
  for (const edge of graph.edges) {
    const from = refKey(edge.from);
    const to = refKey(edge.to);
    if (from === to) continue;
    link(from, to);
    link(to, from);
  }
  const cone = (start: string, blocked: ReadonlySet<string>) => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next) || (blocked.has(next) && next !== start)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    seen.delete(start);
    return seen;
  };
  const hidden = new Set<string>();
  for (const family of presentedFamilies) {
    const presentedCone = cone(family.presentedKey, family.memberKeys);
    for (const memberKey of family.memberKeys) {
      if (memberKey === family.presentedKey) continue;
      for (const key of cone(memberKey, family.memberKeys)) {
        if (!presentedCone.has(key) && !family.memberKeys.has(key)) {
          hidden.add(key);
        }
      }
    }
  }
  return hidden;
}

function presentedMemberInFamily(
  members: readonly ThreadGraphNode[],
  presentedMemberRef: ThreadGraphRef | undefined,
): ThreadGraphNode | undefined {
  if (!presentedMemberRef) return undefined;
  return members.find((member) =>
    refKey(member.ref) === refKey(presentedMemberRef)
  );
}

export function versionedRefKey(reference: ThreadGraphRef): string {
  return refKey(reference);
}

/**
 * Returns the requirements that remain current in the BFF-declared revision
 * topology. A historical requirement is hidden from summary counts only when
 * one explicit `supersedes` family names exactly one current successor. An
 * unresolved requirement without that canonical relation remains visible.
 */
export function currentRequirements(
  requirements: readonly ThreadRequirement[],
  familyGraph: ThreadEvidenceFamilyGraph,
): readonly ThreadRequirement[] {
  const historical = historicalFamilyMembers("requirement", familyGraph);
  return requirements.filter((requirement) =>
    !historical.has(refKey({ kind: "requirement", id: requirement.id }))
  );
}

/**
 * Returns artifacts that remain current in the BFF-declared revision
 * topology. A stale historical artifact is retained in the inspector and
 * version history, but does not turn the current evidence health amber when
 * one explicit successor is canonical.
 */
export function currentArtifacts(
  artifacts: readonly ThreadArtifact[],
  familyGraph: ThreadEvidenceFamilyGraph,
): readonly ThreadArtifact[] {
  const historical = historicalFamilyMembers("artifact", familyGraph);
  return artifacts.filter((artifact) =>
    !historical.has(refKey({ kind: "artifact", id: artifact.id }))
  );
}

function historicalFamilyMembers(
  entityKind: "artifact" | "requirement",
  familyGraph: ThreadEvidenceFamilyGraph,
): ReadonlySet<string> {
  const historical = new Set<string>();
  for (const family of familyGraph.families) {
    if (
      family.entityKind !== entityKind || family.status !== "current" ||
      family.currentRefs.length !== 1
    ) continue;
    for (const reference of family.historicalRefs) {
      historical.add(refKey(reference));
    }
  }
  return historical;
}

function familyRefs(family: ThreadEvidenceFamily): ThreadGraphRef[] {
  return [...family.historicalRefs, ...family.currentRefs];
}

function orderedFamilyRefs(family: ThreadEvidenceFamily): ThreadGraphRef[] {
  // A convergent family has several explicit historical predecessors for the
  // same current record. That is enough to establish currency, but not a
  // total ordering between those predecessors. Keep their declared graph
  // order, then show the sole current successor, rather than inventing a
  // misleading R1 -> R3 -> R2 sequence.
  const successorCounts = new Map<string, number>();
  for (const transition of family.transitions) {
    const key = refKey(transition.successor);
    successorCounts.set(key, (successorCounts.get(key) ?? 0) + 1);
  }
  if ([...successorCounts.values()].some((count) => count > 1)) {
    return [...family.historicalRefs, ...family.currentRefs];
  }

  const remaining = new Map(
    familyRefs(family).map((reference) =>
      [refKey(reference), reference] as const
    ),
  );
  const successorKeys = new Set(
    family.transitions.map((transition) => refKey(transition.successor)),
  );
  const successorByHistorical = new Map(
    family.transitions.map((transition) =>
      [refKey(transition.historical), transition.successor] as const
    ),
  );
  const ordered: ThreadGraphRef[] = [];
  for (const reference of family.historicalRefs) {
    if (successorKeys.has(refKey(reference))) continue;
    let current: ThreadGraphRef | undefined = reference;
    while (current && remaining.delete(refKey(current))) {
      ordered.push(current);
      current = successorByHistorical.get(refKey(current));
    }
  }
  // Declaration order is the fail-safe fallback. No timestamp or label is
  // used to invent a sequence when the explicit topology is incomplete.
  for (const reference of familyRefs(family)) {
    if (remaining.delete(refKey(reference))) ordered.push(reference);
  }
  return ordered;
}

function compareRepresentativeEdges(
  left: ThreadGraphEdge,
  right: ThreadGraphEdge,
  visibleRefByMemberRef: ReadonlyMap<string, ThreadGraphRef>,
): number {
  const score = (edge: ThreadGraphEdge) => {
    let value = 0;
    const visibleFrom = visibleRefByMemberRef.get(refKey(edge.from));
    const visibleTo = visibleRefByMemberRef.get(refKey(edge.to));
    if (!visibleFrom || refKey(visibleFrom) === refKey(edge.from)) value += 1;
    if (!visibleTo || refKey(visibleTo) === refKey(edge.to)) value += 1;
    return value;
  };
  const scoreDifference = score(right) - score(left);
  if (scoreDifference !== 0) return scoreDifference;
  const checkedAtDifference = (right.attestation?.checkedAt ?? "")
    .localeCompare(
      left.attestation?.checkedAt ?? "",
    );
  return checkedAtDifference || left.id.localeCompare(right.id) ||
    threadGraphEdgeRecordSignature(left).localeCompare(
      threadGraphEdgeRecordSignature(right),
    );
}

function compareEdges(left: ThreadGraphEdge, right: ThreadGraphEdge): number {
  return left.id.localeCompare(right.id) ||
    threadGraphEdgeRecordSignature(left).localeCompare(
      threadGraphEdgeRecordSignature(right),
    );
}

function uniqueMemberOccurrenceKeyForLegacyId(
  projection: VersionedProvenanceProjection,
  edgeId: string,
): string | undefined {
  const keys = [...projection.memberEdgeByOccurrenceKey.entries()]
    .filter(([, edge]) => edge.id === edgeId)
    .map(([key]) => key);
  return keys.length === 1 ? keys[0] : undefined;
}

function uniqueLegacyEdgeForId(
  selectionIndex: VersionedGraphSelectionIndex,
  edgeId: string,
): ThreadGraphEdge | undefined {
  const candidates = selectionIndex.legacyEdgesById.get(edgeId) ?? [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

function currentEdgeForKeyedSelection(
  projection: VersionedProvenanceProjection,
  selectionIndex: VersionedGraphSelectionIndex,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }>,
): ThreadGraphEdge | undefined {
  const occurrence = selection.occurrence;
  if (!occurrence) return undefined;
  const currentEdge = selectionIndex.edgeByOccurrenceKey.get(occurrence.key);
  if (!currentEdge) return undefined;
  // A byte-identical duplicate only has a graph-local ordinal. Its key cannot
  // prove continuity across a reordered SSE snapshot, so reject the stale
  // object rather than assigning the ordinal to an arbitrary counterpart.
  if (
    projection.ambiguousMemberOccurrenceKeys.has(occurrence.key) &&
    occurrence.edge !== currentEdge
  ) return undefined;
  return currentEdge;
}

interface MemberEdgeOccurrenceIndex {
  keyByEdge: ReadonlyMap<ThreadGraphEdge, string>;
  ambiguousKeys: ReadonlySet<string>;
}

function indexMemberEdgeOccurrences(
  edges: readonly ThreadGraphEdge[],
): MemberEdgeOccurrenceIndex {
  const occurrences = new Map<ThreadGraphEdge, string>();
  const signatureByEdge = new Map<ThreadGraphEdge, string>();
  const countBySignature = new Map<string, number>();
  for (const edge of edges) {
    const signature = threadGraphEdgeRecordSignature(edge);
    signatureByEdge.set(edge, signature);
    countBySignature.set(signature, (countBySignature.get(signature) ?? 0) + 1);
  }

  const ordinalBySignature = new Map<string, number>();
  const ambiguousKeys = new Set<string>();
  for (const edge of edges) {
    const signature = signatureByEdge.get(edge)!;
    const ordinal = ordinalBySignature.get(signature) ?? 0;
    ordinalBySignature.set(signature, ordinal + 1);
    const hasByteIdenticalDuplicate = (countBySignature.get(signature) ?? 0) >
      1;
    // An ordinal is needed only for exact contract duplicates. It is local to
    // this graph instance, never treated as a cross-SSE business identity.
    const occurrenceKey = hasByteIdenticalDuplicate
      ? structuredOccurrenceKey("member-edge", [signature, ordinal])
      : structuredOccurrenceKey("member-edge", [signature]);
    if (hasByteIdenticalDuplicate) ambiguousKeys.add(occurrenceKey);
    occurrences.set(edge, occurrenceKey);
  }
  return { keyByEdge: occurrences, ambiguousKeys };
}

function refKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}
