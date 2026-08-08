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
  /** Current canonical record used as the single visible graph node. */
  representative: ThreadGraphNode;
  /** Explicit supersession order, oldest first and current last. */
  members: ThreadGraphNode[];
  /** Canonical relations hidden only because both endpoints are in this node. */
  internalEdges: ThreadGraphEdge[];
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
  visibleOccurrenceKeyByEdge: ReadonlyMap<ThreadGraphEdge, string>;
  visibleEdgeByOccurrenceKey: ReadonlyMap<string, ThreadGraphEdge>;
  visibleRefByMemberRef: ReadonlyMap<string, ThreadGraphRef>;
}

/**
 * Folds only BFF-declared, single-successor revision families into the raw
 * provenance graph. Ambiguous or incomplete families remain fully visible.
 * Labels, hashes, timestamps and provider names never create membership.
 */
export function buildVersionedProvenanceProjection(
  graph: ThreadGraph,
  familyGraph: ThreadEvidenceFamilyGraph,
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
    members: ThreadGraphNode[];
  }> = [];

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
    pendingFamilies.push({ family, representative, members });
    for (const member of members) {
      visibleRefByMemberRef.set(refKey(member.ref), representative.ref);
    }
  }

  const memberOccurrenceKeyByEdge = indexMemberEdgeOccurrences(graph.edges);
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
          internalEdgesByVisibleRef.get(refKey(pending.representative.ref)) ??
            []
        ),
      ].sort(compareEdges),
    };
    familyByVisibleRef.set(
      refKey(pending.representative.ref),
      versionedFamily,
    );
    for (const member of pending.members) {
      familyByMemberRef.set(refKey(member.ref), versionedFamily);
    }
  }

  const nodes: ThreadGraphNode[] = [];
  for (const node of graph.nodes) {
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
    collapsedVersionCount: graph.nodes.length - nodes.length,
    familyByMemberRef,
    familyByVisibleRef,
    edgeGroupByVisibleOccurrenceKey,
    visibleOccurrenceKeyByMemberOccurrenceKey,
    memberOccurrenceKeyByEdge,
    memberEdgeByOccurrenceKey,
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

export function visibleGraphSelection(
  projection: VersionedProvenanceProjection,
  selection: VersionedGraphSelection | undefined,
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
  );
  if (visibleOccurrence) {
    return {
      kind: "edge",
      id: visibleOccurrence.edge.id,
      occurrence: visibleOccurrence,
    };
  }
  // Synthetic stubs do not belong to the versioned raw-edge index. Preserve
  // their renderer occurrence instead of degrading them to an ambiguous id.
  return selection.occurrence
    ? { kind: "edge", id: selection.id, occurrence: selection.occurrence }
    : { kind: "edge", id: selection.id };
}

/** Resolve a member/visible edge selection to its one visible occurrence. */
export function visibleEdgeOccurrenceForSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }>,
): VersionedEdgeOccurrence | undefined {
  const selectedEdge = selection.occurrence?.edge;
  const directVisibleKey = selectedEdge
    ? projection.visibleOccurrenceKeyByEdge.get(selectedEdge)
    : undefined;
  const memberKey = memberOccurrenceKeyForSelection(projection, selection);
  const suppliedOccurrenceKey = selection.occurrence?.key;
  const visibleKey = directVisibleKey ??
    (memberKey
      ? projection.visibleOccurrenceKeyByMemberOccurrenceKey.get(memberKey)
      : undefined) ??
    (suppliedOccurrenceKey
      ? projection.visibleOccurrenceKeyByMemberOccurrenceKey.get(
        suppliedOccurrenceKey,
      ) ??
        (projection.visibleEdgeByOccurrenceKey.has(suppliedOccurrenceKey)
          ? suppliedOccurrenceKey
          : undefined)
      : undefined) ??
    uniqueVisibleOccurrenceKeyForLegacyId(projection, selection.id);
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
): ThreadGraphEdge | undefined {
  if (!selection) return undefined;
  const memberKey = memberOccurrenceKeyForSelection(projection, selection) ??
    uniqueMemberOccurrenceKeyForLegacyId(projection, selection.id);
  if (memberKey) return projection.memberEdgeByOccurrenceKey.get(memberKey);
  return visibleEdgeOccurrenceForSelection(projection, selection)?.edge;
}

/** Resolve a version-history group without ever indexing by edge.id alone. */
export function versionedEdgeGroupForSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }> | undefined,
): VersionedProvenanceEdgeGroup | undefined {
  if (!selection) return undefined;
  const occurrence = visibleEdgeOccurrenceForSelection(projection, selection);
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
  return [
    "versioned-edge",
    refKey(edge.from),
    refKey(edge.to),
    edge.relation,
    edge.origin,
    edge.attestation?.status ?? "none",
  ].join("|");
}

export function versionLabel(count: number): string {
  return `${count} recorded version${count === 1 ? "" : "s"}`;
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
  return checkedAtDifference || left.id.localeCompare(right.id);
}

function compareEdges(left: ThreadGraphEdge, right: ThreadGraphEdge): number {
  return left.id.localeCompare(right.id);
}

function uniqueVisibleOccurrenceKeyForLegacyId(
  projection: VersionedProvenanceProjection,
  edgeId: string,
): string | undefined {
  const keys = [...projection.edgeGroupByVisibleOccurrenceKey.entries()]
    .filter(([, group]) => group.members.some((member) => member.id === edgeId))
    .map(([key]) => key);
  return keys.length === 1 ? keys[0] : undefined;
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

function memberOccurrenceKeyForSelection(
  projection: VersionedProvenanceProjection,
  selection: Extract<VersionedGraphSelection, { kind: "edge" }>,
): string | undefined {
  const exactMemberKey = selection.occurrence?.edge
    ? projection.memberOccurrenceKeyByEdge.get(selection.occurrence.edge)
    : undefined;
  if (exactMemberKey) return exactMemberKey;
  const suppliedKey = selection.occurrence?.key;
  return suppliedKey && projection.memberEdgeByOccurrenceKey.has(suppliedKey)
    ? suppliedKey
    : undefined;
}

function indexMemberEdgeOccurrences(
  edges: readonly ThreadGraphEdge[],
): ReadonlyMap<ThreadGraphEdge, string> {
  const occurrences = new Map<ThreadGraphEdge, string>();
  const ordinalBySignature = new Map<string, number>();
  for (const edge of edges) {
    const signature = [
      edge.id,
      refKey(edge.from),
      refKey(edge.to),
      edge.relation,
      edge.origin,
      edge.rationale,
      edge.attestation?.status ?? "none",
      edge.attestation?.producerFingerprint ?? "",
      edge.attestation?.consumedFingerprint ?? "",
      edge.attestation?.checkedAt ?? "",
    ].join("\u0000");
    const ordinal = ordinalBySignature.get(signature) ?? 0;
    ordinalBySignature.set(signature, ordinal + 1);
    occurrences.set(edge, `member-edge|${signature}|${ordinal}`);
  }
  return occurrences;
}

function refKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}
