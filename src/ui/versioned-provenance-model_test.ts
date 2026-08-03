import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildVersionedProvenanceProjection,
  visibleGraphRef,
  visibleGraphSelection,
} from "./src/thread/versioned-provenance-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
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
  assertEquals(
    projection.edgeGroupByVisibleId.get("proof-r3-to-requirement")?.members
      .map((edge) => edge.id),
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
  assertEquals(
    visibleGraphSelection(projection, {
      kind: "edge",
      id: "proof-r2-to-requirement",
    }),
    { kind: "edge", id: "proof-r3-to-requirement" },
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
