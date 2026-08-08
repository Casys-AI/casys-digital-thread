import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildVersionedProvenanceProjection,
  currentArtifacts,
  currentRequirements,
  edgeForVersionedGraphSelection,
  versionedEdgeGroupForSelection,
  visibleGraphRef,
  visibleGraphSelection,
} from "./src/thread/versioned-provenance-model.ts";
import type {
  ThreadArtifact,
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRequirement,
} from "./src/thread/types.ts";

Deno.test("versioned provenance folds one explicit successor chain into its current node", () => {
  const projection = buildVersionedProvenanceProjection(
    rawGraph(),
    familyGraph("current"),
  );

  assertEquals(
    projection.graph.nodes.map((node) => node.ref.id),
    ["proof-r3", "requirement"],
  );
  assertStringIncludes(
    projection.graph.nodes[0]!.summary,
    "2 recorded versions",
  );
  assertEquals(projection.collapsedVersionCount, 1);
  assertEquals(
    projection.graph.edges.map((edge) => edge.id),
    ["proof-r3-to-requirement"],
  );
  const selected = visibleGraphSelection(projection, {
    kind: "edge",
    id: "proof-r2-to-requirement",
  });
  assertEquals(
    selected?.kind === "edge"
      ? versionedEdgeGroupForSelection(projection, selected)?.members.map((
        edge,
      ) => edge.id)
      : undefined,
    ["proof-r3-to-requirement", "proof-r2-to-requirement"],
  );
  assertEquals(
    projection.familyByVisibleRef.get("artifact:proof-r3")?.internalEdges.map(
      (edge) => edge.id,
    ),
    ["proof-r2-to-r3"],
  );
});

Deno.test("ambiguous evidence families remain fully visible", () => {
  const projection = buildVersionedProvenanceProjection(
    rawGraph(),
    familyGraph("review-required"),
  );

  assertEquals(
    projection.graph.nodes.map((node) => node.ref.id),
    ["proof-r2", "proof-r3", "requirement"],
  );
  assertEquals(projection.collapsedVersionCount, 0);
});

Deno.test("historic selections resolve to the visible node without changing the exact inspector record", () => {
  const projection = buildVersionedProvenanceProjection(
    rawGraph(),
    familyGraph("current"),
  );

  assertEquals(visibleGraphRef(projection, ref("proof-r2")), ref("proof-r3"));
  const selected = visibleGraphSelection(projection, {
    kind: "edge",
    id: "proof-r2-to-requirement",
  });
  assertEquals(selected?.kind, "edge");
  assertEquals(
    selected?.kind === "edge" ? selected.id : undefined,
    "proof-r3-to-requirement",
  );
  assertEquals(
    selected?.kind === "edge" ? selected.occurrence?.edge.id : undefined,
    "proof-r3-to-requirement",
  );
});

Deno.test("synthetic stubs retain their exact renderer occurrence", () => {
  const projection = buildVersionedProvenanceProjection(
    rawGraph(),
    familyGraph("current"),
  );
  const stub = {
    ...edge("stub:proof-to-requirement", "proof-r3", "requirement", "evidences"),
    rationale: "via folded instrument — replié",
  };

  const selected = visibleGraphSelection(projection, {
    kind: "edge",
    id: stub.id,
    occurrence: { key: "stub-occurrence:proof-to-requirement", edge: stub },
  });

  assertEquals(
    selected?.kind === "edge" ? selected.occurrence?.edge : undefined,
    stub,
  );
});

Deno.test("duplicate edge ids retain separate versioned histories and reproject exact occurrences", () => {
  const graph = duplicateIdGraph();
  const projection = buildVersionedProvenanceProjection(
    graph,
    duplicateIdFamilyGraph(),
  );
  const firstMember = graph.edges.find((edge) =>
    edge.rationale === "first-family historical handoff"
  )!;
  const secondMember = graph.edges.find((edge) =>
    edge.rationale === "second-family historical handoff"
  )!;
  const selectionFor = (edge: ThreadGraphEdge) => ({
    kind: "edge" as const,
    id: edge.id,
    occurrence: {
      key: projection.memberOccurrenceKeyByEdge.get(edge)!,
      edge,
    },
  });
  const firstSelection = selectionFor(firstMember);
  const secondSelection = selectionFor(secondMember);
  const firstHistory = versionedEdgeGroupForSelection(
    projection,
    firstSelection,
  );
  const secondHistory = versionedEdgeGroupForSelection(
    projection,
    secondSelection,
  );
  assertEquals(
    firstHistory?.members.map((edge) => edge.rationale).sort(),
    ["first-family current handoff", "first-family historical handoff"],
  );
  assertEquals(
    secondHistory?.members.map((edge) => edge.rationale).sort(),
    ["second-family current handoff", "second-family historical handoff"],
  );

  const firstVisible = visibleGraphSelection(projection, firstSelection);
  const secondVisible = visibleGraphSelection(projection, secondSelection);
  assertEquals(firstVisible?.kind, "edge");
  assertEquals(secondVisible?.kind, "edge");
  assertEquals(
    firstVisible?.kind === "edge" ? firstVisible.occurrence?.edge.to.id : undefined,
    "requirement-one",
  );
  assertEquals(
    secondVisible?.kind === "edge" ? secondVisible.occurrence?.edge.to.id : undefined,
    "requirement-two",
  );
  assertEquals(
    firstVisible?.kind === "edge" && secondVisible?.kind === "edge"
      ? firstVisible.occurrence?.key === secondVisible.occurrence?.key
      : undefined,
    false,
  );

  // A live snapshot is a new object graph. The old selection must reproject
  // to the new visible edge, rather than retaining the stale member object.
  const refreshed = buildVersionedProvenanceProjection(
    structuredClone(graph),
    duplicateIdFamilyGraph(),
  );
  const refreshedVisible = visibleGraphSelection(refreshed, firstSelection);
  const refreshedFirstVisibleEdge = refreshed.graph.edges.find((edge) =>
    edge.to.id === "requirement-one"
  );
  assertEquals(refreshedVisible?.kind, "edge");
  assertEquals(
    refreshedVisible?.kind === "edge"
      ? refreshedVisible.occurrence?.edge === firstMember
      : undefined,
    false,
  );
  assertEquals(
    refreshedVisible?.kind === "edge"
      ? refreshedVisible.occurrence?.edge.to.id
      : undefined,
    "requirement-one",
  );
  assertEquals(
    refreshedVisible?.kind === "edge" ? refreshedVisible.occurrence?.edge : undefined,
    refreshedFirstVisibleEdge,
  );
  const refreshedFromFoldedSelection = firstVisible?.kind === "edge"
    ? visibleGraphSelection(refreshed, firstVisible)
    : undefined;
  assertEquals(
    refreshedFromFoldedSelection?.kind === "edge"
      ? refreshedFromFoldedSelection.occurrence?.edge
      : undefined,
    refreshedFirstVisibleEdge,
  );
  assertEquals(
    edgeForVersionedGraphSelection(refreshed, firstSelection)?.rationale,
    "first-family historical handoff",
  );
  assertEquals(
    edgeForVersionedGraphSelection(refreshed, secondSelection)?.rationale,
    "second-family historical handoff",
  );
});

Deno.test("matching labels never create a version family", () => {
  const graph = rawGraph();
  graph.nodes.push(node("same-label", "Proof"));
  const projection = buildVersionedProvenanceProjection(
    graph,
    familyGraph("current"),
  );

  assertEquals(
    projection.graph.nodes.some((node) => node.ref.id === "same-label"),
    true,
  );
});

Deno.test("handoffs with different attestation states never collapse together", () => {
  const graph = rawGraph();
  graph.edges[1]!.attestation = {
    consumptionId: "old-consumption",
    status: "mismatch",
    producerFingerprint: "old-producer",
    consumedFingerprint: "different-input",
    checkedAt: "2026-08-02T10:00:00.000Z",
  };
  graph.edges[2]!.attestation = {
    consumptionId: "current-consumption",
    status: "verified",
    producerFingerprint: "current-input",
    consumedFingerprint: "current-input",
    checkedAt: "2026-08-03T10:00:00.000Z",
  };

  const projection = buildVersionedProvenanceProjection(
    graph,
    familyGraph("current"),
  );

  assertEquals(
    projection.graph.edges.map((edge) => edge.attestation?.status),
    ["mismatch", "verified"],
  );
});

Deno.test("current requirement summaries hide only an explicit historical family member", () => {
  const family = requirementFamily();
  const requirements: ThreadRequirement[] = [
    requirement("requirement-r1", "unresolved"),
    requirement("requirement-r2", "unresolved"),
    requirement("requirement-r3", "pass"),
    requirement("unrelated-unresolved", "unresolved"),
  ];

  assertEquals(
    currentRequirements(requirements, family).map((item) => item.id),
    ["requirement-r3", "unrelated-unresolved"],
  );
});

Deno.test("current artifact currency ignores only explicit stale predecessors", () => {
  const artifacts: ThreadArtifact[] = [
    artifact("proof-r2", "stale"),
    artifact("proof-r3", "fresh"),
    artifact("still-current-stale", "stale"),
  ];

  assertEquals(
    currentArtifacts(artifacts, familyGraph("current")).map((item) => item.id),
    ["proof-r3", "still-current-stale"],
  );
});

Deno.test("convergent family history stays in declared order before its current successor", () => {
  const graph: ThreadGraph = {
    nodes: [
      node("proof-r1", "R1"),
      node("proof-r2", "R2"),
      node("proof-r3", "R3"),
    ],
    edges: [
      edge("proof-r1-to-r3", "proof-r1", "proof-r3", "supersedes"),
      edge("proof-r2-to-r3", "proof-r2", "proof-r3", "supersedes"),
    ],
  };
  const family = familyGraph("current").families[0]!;
  const convergent = {
    ...family,
    historicalRefs: [ref("proof-r1"), ref("proof-r2")],
    currentRefs: [ref("proof-r3")],
    revisionCount: 2,
    transitions: [
      {
        edgeRef: {
          id: "proof-r1-to-r3",
          relation: "supersedes" as const,
          origin: "provenance" as const,
        },
        historical: ref("proof-r1"),
        successor: ref("proof-r3"),
      },
      {
        edgeRef: {
          id: "proof-r2-to-r3",
          relation: "supersedes" as const,
          origin: "provenance" as const,
        },
        historical: ref("proof-r2"),
        successor: ref("proof-r3"),
      },
    ],
  };
  const projection = buildVersionedProvenanceProjection(graph, {
    ...familyGraph("current"),
    families: [convergent],
  });

  assertEquals(
    projection.familyByVisibleRef.get("artifact:proof-r3")?.members.map((
      node,
    ) => node.ref.id),
    ["proof-r1", "proof-r2", "proof-r3"],
  );
});

Deno.test("Evidence owns one versioned graph and one existing inspector", () => {
  const source = Deno.readTextFileSync(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertEquals(source.includes("EvidenceFamilyGraph"), false);
  assertEquals(source.includes("Full provenance"), false);
  assertStringIncludes(source, "buildVersionedProvenanceProjection");
  assertStringIncludes(source, "EvidenceVersionHistory");
});

function rawGraph(): ThreadGraph {
  return {
    nodes: [
      node("proof-r2", "Proof"),
      node("proof-r3", "Proof current"),
      node("requirement", "Requirement"),
    ],
    edges: [
      edge("proof-r2-to-r3", "proof-r2", "proof-r3", "supersedes"),
      edge(
        "proof-r2-to-requirement",
        "proof-r2",
        "requirement",
        "evidences",
      ),
      edge(
        "proof-r3-to-requirement",
        "proof-r3",
        "requirement",
        "evidences",
      ),
    ],
  };
}

function duplicateIdGraph(): ThreadGraph {
  return {
    nodes: [
      node("first-old", "First old"),
      node("first-current", "First current"),
      node("requirement-one", "Requirement one"),
      node("second-old", "Second old"),
      node("second-current", "Second current"),
      node("requirement-two", "Requirement two"),
    ],
    edges: [
      edge("first-supersedes", "first-old", "first-current", "supersedes"),
      {
        ...edge("duplicate-id", "first-old", "requirement-one", "evidences"),
        rationale: "first-family historical handoff",
      },
      {
        ...edge(
          "duplicate-id",
          "first-current",
          "requirement-one",
          "evidences",
        ),
        rationale: "first-family current handoff",
      },
      edge(
        "second-supersedes",
        "second-old",
        "second-current",
        "supersedes",
      ),
      {
        ...edge("duplicate-id", "second-old", "requirement-two", "evidences"),
        rationale: "second-family historical handoff",
      },
      {
        ...edge(
          "duplicate-id",
          "second-current",
          "requirement-two",
          "evidences",
        ),
        rationale: "second-family current handoff",
      },
    ],
  };
}

function duplicateIdFamilyGraph(): ThreadEvidenceFamilyGraph {
  const family = (
    id: string,
    historicalId: string,
    currentId: string,
    transitionId: string,
  ) => ({
    id,
    entityKind: "artifact" as const,
    artifactKind: "solver-result",
    historicalRefs: [ref(historicalId)],
    currentRefs: [ref(currentId)],
    revisionCount: 1,
    status: "current" as const,
    relationship: {
      relation: "supersedes" as const,
      classification: "not-recorded" as const,
      equivalence: "not-recorded" as const,
    },
    transitions: [{
      edgeRef: {
        id: transitionId,
        relation: "supersedes" as const,
        origin: "provenance" as const,
      },
      historical: ref(historicalId),
      successor: ref(currentId),
    }],
  });
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-r11", revision: 11 },
    families: [
      family("first-family", "first-old", "first-current", "first-supersedes"),
      family(
        "second-family",
        "second-old",
        "second-current",
        "second-supersedes",
      ),
    ],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
}

function familyGraph(
  status: "current" | "review-required",
): ThreadEvidenceFamilyGraph {
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-r11", revision: 11 },
    families: [{
      id: "proof-family",
      entityKind: "artifact",
      artifactKind: "solver-result",
      historicalRefs: [ref("proof-r2")],
      currentRefs: [ref("proof-r3")],
      revisionCount: 1,
      status,
      ...(status === "review-required"
        ? { reviewReason: "divergent-successors" as const }
        : {}),
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: [{
        edgeRef: {
          id: "proof-r2-to-r3",
          relation: "supersedes",
          origin: "provenance",
        },
        historical: ref("proof-r2"),
        successor: ref("proof-r3"),
      }],
    }],
    edges: [],
    omittedSelfLoops: [{
      familyId: "proof-family",
      memberEdgeRefs: [{
        id: "proof-r2-to-r3",
        relation: "supersedes",
        origin: "provenance",
      }],
    }],
    omittedCycleEdges: [],
  };
}

function requirementFamily(): ThreadEvidenceFamilyGraph {
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-r11", revision: 11 },
    families: [{
      id: "requirement-family",
      entityKind: "requirement",
      historicalRefs: [
        { kind: "requirement", id: "requirement-r1" },
        { kind: "requirement", id: "requirement-r2" },
      ],
      currentRefs: [{ kind: "requirement", id: "requirement-r3" }],
      revisionCount: 1,
      status: "current",
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: [{
        edgeRef: {
          id: "requirement-r2-to-r3",
          relation: "supersedes",
          origin: "provenance",
        },
        historical: { kind: "requirement", id: "requirement-r2" },
        successor: { kind: "requirement", id: "requirement-r3" },
      }, {
        edgeRef: {
          id: "requirement-r1-to-r2",
          relation: "supersedes",
          origin: "provenance",
        },
        historical: { kind: "requirement", id: "requirement-r1" },
        successor: { kind: "requirement", id: "requirement-r2" },
      }],
    }],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
}

function node(id: string, label: string): ThreadGraphNode {
  return {
    id: `node-${id}`,
    ref: ref(id),
    entityKind: "artifact",
    artifactKind: "solver-result",
    label,
    system: "calculix",
    freshness: "fresh",
    summary: `solver-result · ${id}`,
    selection: { kind: "artifact", id },
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  relation: ThreadGraphEdge["relation"],
): ThreadGraphEdge {
  return {
    id,
    from: ref(from),
    to: ref(to),
    relation,
    rationale: id,
    origin: "provenance",
  };
}

function ref(id: string): ThreadGraphRef {
  return { kind: "artifact", id };
}

function requirement(
  id: string,
  status: ThreadRequirement["status"],
): ThreadRequirement {
  return {
    id,
    label: id,
    source: "SysON",
    expression: "value <= 1 mm",
    status,
    observationIds: [],
    violationIds: [],
    rationale: id,
  };
}

function artifact(
  id: string,
  freshness: ThreadArtifact["freshness"],
): ThreadArtifact {
  return {
    id,
    label: id,
    kind: "solver-result",
    system: "calculix",
    revision: id,
    freshness,
    dependsOn: [],
  };
}
