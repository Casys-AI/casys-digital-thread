/**
 * Tests for evidence-graph-model.ts
 *
 * All fixtures are minimal synthetic graphs derived from the real GEN-01 V3
 * graph structure (175 nodes, 256 edges, 1 giant component + 12 small islands),
 * constructed so that each test exercises exactly one invariant.
 *
 * The analyze.* predicate in these tests uses node.system === "analyze" as a
 * structural identifier — a sentinel value that synthetic fixtures stamp on
 * instrument nodes. Real callers will use operation identifiers, not labels.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  boundedLineageNeighborhood,
  buildEvidenceGraphModel,
  graphWithoutAnalysisOverlay,
} from "./src/thread/evidence-graph-model.ts";
import { buildVersionedProvenanceProjection } from "./src/thread/versioned-provenance-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Evidence canvas policy: AnalysisGraph overlay is not painted
// ---------------------------------------------------------------------------

Deno.test(
  "graphWithoutAnalysisOverlay drops analysis-node islands and analysis-origin edges",
  () => {
    const graph = {
      nodes: [
        nodeFor("step", "artifact", "build123d"),
        nodeFor("obs", "observation", "calculix"),
        nodeFor("param", "analysis-node", "calculix"),
        nodeFor("response", "analysis-node", "calculix"),
      ],
      edges: [
        edgeFor(
          "step-obs",
          "step",
          "artifact",
          "obs",
          "observation",
          "evidences",
        ),
        analysisEdge(
          "param-response",
          "param",
          "response",
          "measured-local-sensitivity",
        ),
      ],
    };

    const filtered = graphWithoutAnalysisOverlay(graph);

    assertEquals(
      filtered.nodes.map((node) => node.ref.id).sort(),
      ["obs", "step"],
    );
    assertEquals(filtered.edges.map((edge) => edge.id), ["step-obs"]);
    assertEquals(
      filtered.nodes.some((node) => node.entityKind === "analysis-node"),
      false,
    );
    assertEquals(
      filtered.edges.some((edge) => edge.origin === "analysis"),
      false,
    );
  },
);

Deno.test(
  "graphWithoutAnalysisOverlay keeps Thread sensitivity observations and invents no join",
  () => {
    const graph = {
      nodes: [
        nodeFor("step", "artifact", "build123d"),
        nodeFor(
          "sensitivity-base-maxDisplacement-x",
          "observation",
          "calculix",
        ),
        nodeFor("eval", "evaluation", "digital-thread"),
        nodeFor("driver", "analysis-node", "calculix"),
      ],
      edges: [
        edgeFor(
          "step-obs",
          "step",
          "artifact",
          "sensitivity-base-maxDisplacement-x",
          "observation",
          "evidences",
        ),
        edgeFor(
          "obs-eval",
          "sensitivity-base-maxDisplacement-x",
          "observation",
          "eval",
          "evaluation",
          "evaluates",
        ),
        {
          id: "driver-obs",
          from: { kind: "analysis-node" as const, id: "driver" },
          to: {
            kind: "observation" as const,
            id: "sensitivity-base-maxDisplacement-x",
          },
          relation: "projection-of" as const,
          rationale: "driver-obs",
          origin: "analysis" as const,
        },
      ],
    };

    const filtered = graphWithoutAnalysisOverlay(graph);

    assertEquals(
      filtered.nodes.map((node) => node.ref.id).sort(),
      ["eval", "sensitivity-base-maxDisplacement-x", "step"],
    );
    assertEquals(
      filtered.edges.map((edge) => edge.id).sort(),
      ["obs-eval", "step-obs"],
    );
    assertEquals(
      filtered.edges.some((edge) => edge.id === "driver-obs"),
      false,
      "must not keep or invent an analysis→Thread join",
    );
  },
);

Deno.test(
  "presentation graph is a Graphology MultiDirectedGraph that keeps parallel edges",
  () => {
    const graph = {
      nodes: [
        nodeFor("A", "artifact", "calculix"),
        nodeFor("B", "observation", "calculix"),
      ],
      edges: [
        edgeFor(
          "A-B-evidences",
          "A",
          "artifact",
          "B",
          "observation",
          "evidences",
        ),
        edgeFor("A-B-uses", "A", "artifact", "B", "observation", "uses"),
      ],
    };

    const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

    assertEquals(model.graph.multi, true);
    assertEquals(model.graph.type, "directed");
    assertEquals(model.graph.order, 2);
    assertEquals(model.graph.size, 2);
    assertEquals(model.edges.length, 2);
    assertEquals(model.graph.hasNode("artifact:A"), true);
    assertEquals(model.graph.hasNode("observation:B"), true);
  },
);

Deno.test(
  "Evidence model built after overlay omission has no analysis-node component",
  () => {
    const graph = {
      nodes: [
        nodeFor("A", "artifact", "build123d"),
        nodeFor("B", "artifact", "build123d"),
        nodeFor("param", "analysis-node", "calculix"),
        nodeFor("response", "analysis-node", "calculix"),
      ],
      edges: [
        edgeFor("A-B", "A", "artifact", "B", "artifact", "derived_from"),
        analysisEdge(
          "param-response",
          "param",
          "response",
          "measured-local-sensitivity",
        ),
      ],
    };

    const model = buildEvidenceGraphModel(
      graphWithoutAnalysisOverlay(graph),
      emptyFamilyGraph(),
    );

    assertEquals(model.components.length, 1);
    assertEquals(model.nodes.map((node) => node.ref.id).sort(), ["A", "B"]);
    assertEquals(
      model.graph.nodes().some((key) => key.startsWith("analysis-node:")),
      false,
    );
    assertEquals(model.rawNodeCount, 2);
  },
);

// ---------------------------------------------------------------------------
// Core invariant: a folded connector never severs the component link
// ---------------------------------------------------------------------------

Deno.test("component assignment survives analyze.* folding — stub preserves the link", () => {
  // A ← evaluates — B (instrument) — evidences → C
  // B is an analyze.* instrument. Without the fix, A and C appear as islands.
  // With the model: component computed on full graph → A and C share component 0.
  // The stub A→C must exist after folding.
  const { graph, familyGraph } = threeNodeBridge();

  const model = buildEvidenceGraphModel(graph, familyGraph, {
    isAnalyzeInstrumentNode: (n) => n.system === "analyze",
  });

  // A and C are in the same component (computed before folding).
  assertEquals(model.componentOf(ref("A", "artifact")), 0);
  assertEquals(model.componentOf(ref("C", "artifact")), 0);
  // B is also in component 0 (full graph never changes).
  assertEquals(model.componentOf(ref("B", "evaluation")), 0);

  // B is not in the visible nodes.
  assertEquals(
    model.nodes.map((n) => n.ref.id),
    ["A", "C"],
  );

  // A stub connecting A→C must exist.
  assertEquals(model.stubs.length, 1);
  assertEquals(model.stubs[0]?.from.id, "A");
  assertEquals(model.stubs[0]?.to.id, "C");
});

Deno.test("folding never emits a stub whose endpoints are the same node", () => {
  // admission → instrument, and the instrument's only other path is back to
  // admission. A self-loop stub would look like a recorded relation.
  const graph = {
    nodes: [
      nodeFor("admission", "artifact", "digital-thread"),
      nodeFor("case", "artifact", "analyze"),
      nodeFor("eval", "evaluation", "syson"),
    ],
    edges: [
      edgeFor(
        "admission-case",
        "admission",
        "artifact",
        "case",
        "artifact",
        "derived_from",
      ),
      edgeFor(
        "case-eval",
        "case",
        "artifact",
        "eval",
        "evaluation",
        "derived_from",
      ),
    ],
  };
  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph(), {
    isAnalyzeInstrumentNode: (n) => n.system === "analyze",
  });
  assertEquals(
    model.stubs.some((stub) =>
      stub.from.kind === stub.to.kind && stub.from.id === stub.to.id
    ),
    false,
  );
  assertEquals(
    model.stubs.some((stub) => stub.from.id === "admission" && stub.to.id === "eval"),
    true,
  );
});

Deno.test("non-instrument nodes are never folded — stubs are only for instruments", () => {
  const { graph, familyGraph } = threeNodeBridge();

  const model = buildEvidenceGraphModel(graph, familyGraph, {
    isAnalyzeInstrumentNode: () => false, // no exclusion
  });

  // All three nodes visible.
  assertEquals(model.nodes.map((n) => n.ref.id).sort(), ["A", "B", "C"]);
  // No stubs needed.
  assertEquals(model.stubs.length, 0);
});

// ---------------------------------------------------------------------------
// Intentionally isolated component (Modelica thermal)
// ---------------------------------------------------------------------------

Deno.test("intentionally isolated component is flagged but nodes remain in data", () => {
  // Component 0: mechanical chain A→B
  // Component 1: thermal simulation (system="mcp-modelica"), node T
  const graph = {
    nodes: [
      nodeFor("A", "artifact", "calculix"),
      nodeFor("B", "artifact", "calculix"),
      nodeFor("T", "artifact", "mcp-modelica"),
    ],
    edges: [
      edgeFor("A-B", "A", "artifact", "B", "artifact", "derived_from"),
    ],
  };

  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph(), {
    intentionallyIsolatedSystems: ["mcp-modelica"],
  });

  assertEquals(model.components.length, 2);
  const thermal = model.components.find((c) => c.allNodeRefKeys.has("artifact:T"));
  assertEquals(thermal?.intentionallyIsolated, true);
  // Thermal node still in raw data.
  assertEquals(model.rawNodeCount, 3);
  // Thermal node IS visible (not folded — isolation is purely a flag).
  assertEquals(model.nodes.some((n) => n.ref.id === "T"), true);
});

// ---------------------------------------------------------------------------
// Versioned supersession + stub combination
// ---------------------------------------------------------------------------

Deno.test("superseded versions are folded before analyze instrument folding", () => {
  // Proof-R1 superseded → Proof-R2 (current). Proof-R2 feeds an instrument I
  // which feeds requirement R.
  // After version folding: Proof-R1 disappears → Proof-R2 visible.
  // After instrument folding: I disappears → stub Proof-R2 → R.
  const { graph, familyGraph } = versionedPlusBridgeGraph();

  const model = buildEvidenceGraphModel(graph, familyGraph, {
    isAnalyzeInstrumentNode: (n) => n.system === "analyze",
  });

  const visibleIds = model.nodes.map((n) => n.ref.id).sort();
  assertEquals(visibleIds.includes("proof-r1"), false);
  assertEquals(visibleIds.includes("proof-r2"), true);
  assertEquals(visibleIds.includes("R"), true);
  assertEquals(visibleIds.includes("I"), false);

  // Stub from Proof-R2 to R.
  const stub = model.stubs.find((s) => s.from.id === "proof-r2" && s.to.id === "R");
  assertNotEquals(stub, undefined, "stub proof-r2→R must exist");
  assertEquals(
    model.stubs.some((s) => s.from.id === "R" && s.to.id === "proof-r2"),
    false,
  );
});

Deno.test("a supplied versioned projection preserves the exact rendered edge object", () => {
  const { graph, familyGraph } = versionedPlusBridgeGraph();
  const versioned = buildVersionedProvenanceProjection(graph, familyGraph);
  const model = buildEvidenceGraphModel(graph, familyGraph, {
    versionedProjection: versioned,
  });
  const visible = versioned.graph.edges.find((edge) => edge.id === "r2-I");

  assertEquals(
    model.edges.find((edge) => edge.id === "r2-I"),
    visible,
  );
});

// ---------------------------------------------------------------------------
// Component naming (structural — never label-based)
// ---------------------------------------------------------------------------

Deno.test("component name uses dominant system, not node labels", () => {
  const graph = {
    nodes: [
      nodeFor("X", "artifact", "calculix"),
      nodeFor("Y", "observation", "calculix"),
      nodeFor("Z", "evaluation", "calculix"),
    ],
    edges: [
      edgeFor("X-Y", "X", "artifact", "Y", "observation", "evidences"),
      edgeFor("Y-Z", "Y", "observation", "Z", "evaluation", "evaluates"),
    ],
  };

  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  assertEquals(model.components.length, 1);
  const name = model.components[0]!.name;
  // Name must contain "FEA" (the SYSTEM_LABEL for calculix).
  assertEquals(name.includes("FEA"), true);
  // Name must NOT be "EVIDENCE COMPONENT 01" or any numbered fallback.
  assertEquals(/COMPONENT\s+\d+/i.test(name), false);
});

Deno.test("single-node component gets a name from its system", () => {
  const graph = {
    nodes: [nodeFor("solo", "artifact", "syson")],
    edges: [],
  };

  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  assertEquals(model.components.length, 1);
  assertEquals(model.components[0]!.name.includes("SysML"), true);
});

Deno.test(
  "SYSTEM_LABEL maps 'modelica' to 'Thermal' — intentionally isolated component",
  () => {
    // Generic "modelica" serverId (producer identity used by the simulate
    // executors) must be treated identically to "mcp-modelica"/"openmodelica".
    const graph = {
      nodes: [nodeFor("sim", "artifact", "modelica")],
      edges: [],
    };

    const model = buildEvidenceGraphModel(graph, emptyFamilyGraph(), {
      intentionallyIsolatedSystems: ["modelica"],
    });

    assertEquals(model.components.length, 1);
    // Component is flagged isolated (all nodes belong to "modelica" system).
    assertEquals(model.components[0]!.intentionallyIsolated, true);
    // Name is derived from SYSTEM_LABEL["modelica"] = "Thermal".
    assertEquals(
      model.components[0]!.name.includes("Thermal"),
      true,
      "SYSTEM_LABEL must map 'modelica' to 'Thermal'",
    );
  },
);

// ---------------------------------------------------------------------------
// Bounded neighbourhood query
// ---------------------------------------------------------------------------

Deno.test("boundedNeighborhood depth=1 returns only direct neighbours", () => {
  // A → B → C → D
  const graph = chainGraph(["A", "B", "C", "D"]);

  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  const nb = model.boundedNeighborhood(ref("B", "artifact"), 1);
  const ids = nb.nodes.map((n) => n.ref.id).sort();
  // A and C are direct neighbours of B; D is 2 hops away.
  assertEquals(ids.includes("A"), true);
  assertEquals(ids.includes("B"), true);
  assertEquals(ids.includes("C"), true);
  assertEquals(ids.includes("D"), false);
});

Deno.test("boundedNeighborhood direction=downstream excludes upstream nodes", () => {
  const graph = chainGraph(["A", "B", "C"]);

  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  const nb = model.boundedNeighborhood(
    ref("B", "artifact"),
    1,
    "downstream",
  );
  const ids = nb.nodes.map((n) => n.ref.id);
  assertEquals(ids.includes("C"), true);
  assertEquals(ids.includes("A"), false);
});

Deno.test("boundedNeighborhood direction=upstream excludes downstream nodes", () => {
  const graph = chainGraph(["A", "B", "C"]);

  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  const nb = model.boundedNeighborhood(
    ref("B", "artifact"),
    1,
    "upstream",
  );
  const ids = nb.nodes.map((n) => n.ref.id);
  assertEquals(ids.includes("A"), true);
  assertEquals(ids.includes("C"), false);
});

Deno.test("boundedNeighborhood for invisible node returns empty", () => {
  const { graph, familyGraph } = threeNodeBridge();

  const model = buildEvidenceGraphModel(graph, familyGraph, {
    isAnalyzeInstrumentNode: (n) => n.system === "analyze",
  });

  // B is folded (invisible).
  const nb = model.boundedNeighborhood(ref("B", "evaluation"), 2);
  assertEquals(nb.nodes.length, 0);
  assertEquals(nb.edges.length, 0);
});

Deno.test("boundedLineageNeighborhood keeps ancestors and descendants without hub siblings", () => {
  // source -> hub -> focus and source -> hub -> sibling is the exact shape of
  // one geometry capture publishing several CAD assets. A contextual lineage
  // for focus must not pull sibling into view through the shared hub.
  const nodes = ["source", "hub", "focus", "sibling", "result"].map((id) =>
    nodeFor(id, "artifact", "digital-thread")
  );
  const graph = {
    nodes,
    edges: [
      edgeFor(
        "source-hub",
        "source",
        "artifact",
        "hub",
        "artifact",
        "derived_from",
      ),
      edgeFor(
        "hub-focus",
        "hub",
        "artifact",
        "focus",
        "artifact",
        "derived_from",
      ),
      edgeFor(
        "hub-sibling",
        "hub",
        "artifact",
        "sibling",
        "artifact",
        "derived_from",
      ),
      edgeFor(
        "focus-result",
        "focus",
        "artifact",
        "result",
        "artifact",
        "derived_from",
      ),
    ],
  };
  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  const lineage = boundedLineageNeighborhood(
    model,
    ref("focus", "artifact"),
    2,
  );

  assertEquals(
    lineage.nodes.map((node) => node.ref.id).sort(),
    ["focus", "hub", "result", "source"],
  );
  assertEquals(
    lineage.edges.map((edge) => edge.id).sort(),
    ["focus-result", "hub-focus", "source-hub"],
  );
});

Deno.test("boundedLineageNeighborhood adds the exact SysML identity of one STEP without sibling CAD", () => {
  const nodes = [
    nodeFor("capture", "artifact", "digital-thread"),
    nodeFor("step-assembly", "artifact", "build123d"),
    nodeFor("step-base", "artifact", "build123d"),
    nodeFor("step-stem", "artifact", "build123d"),
    nodeFor("def-root", "part-definition", "syson"),
    nodeFor("def-base", "part-definition", "syson"),
    nodeFor("def-stem", "part-definition", "syson"),
    nodeFor("usage-base", "part-usage", "syson"),
    nodeFor("usage-stem", "part-usage", "syson"),
  ];
  const graph = {
    nodes,
    edges: [
      edgeFor(
        "capture-step-assembly",
        "capture",
        "artifact",
        "step-assembly",
        "artifact",
        "traces_to",
      ),
      edgeFor(
        "capture-step-base",
        "capture",
        "artifact",
        "step-base",
        "artifact",
        "traces_to",
      ),
      edgeFor(
        "capture-step-stem",
        "capture",
        "artifact",
        "step-stem",
        "artifact",
        "traces_to",
      ),
      edgeFor(
        "def-root-step-assembly",
        "def-root",
        "part-definition",
        "step-assembly",
        "artifact",
        "represented_by",
      ),
      edgeFor(
        "def-base-step-base",
        "def-base",
        "part-definition",
        "step-base",
        "artifact",
        "represented_by",
      ),
      edgeFor(
        "def-stem-step-stem",
        "def-stem",
        "part-definition",
        "step-stem",
        "artifact",
        "represented_by",
      ),
      edgeFor(
        "usage-base-def-base",
        "usage-base",
        "part-usage",
        "def-base",
        "part-definition",
        "typed_by",
      ),
      edgeFor(
        "usage-stem-def-stem",
        "usage-stem",
        "part-usage",
        "def-stem",
        "part-definition",
        "typed_by",
      ),
      edgeFor(
        "root-usage-base",
        "def-root",
        "part-definition",
        "usage-base",
        "part-usage",
        "contains",
      ),
      edgeFor(
        "root-usage-stem",
        "def-root",
        "part-definition",
        "usage-stem",
        "part-usage",
        "contains",
      ),
    ],
  };
  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph());

  const lineage = boundedLineageNeighborhood(
    model,
    ref("step-base", "artifact"),
    2,
  );

  assertEquals(
    lineage.nodes.map((node) => node.ref.id).sort(),
    ["capture", "def-base", "step-base", "usage-base"],
  );
  assertEquals(
    lineage.nodes.some((node) => node.ref.id === "step-stem"),
    false,
  );
  assertEquals(lineage.nodes.some((node) => node.ref.id === "def-stem"), false);
  assertEquals(
    lineage.nodes.some((node) => node.ref.id === "usage-stem"),
    false,
  );

  const bundleLineage = boundedLineageNeighborhood(
    model,
    ref("capture", "artifact"),
    2,
  );
  assertEquals(
    bundleLineage.nodes
      .filter((node) =>
        node.ref.kind === "part-definition" || node.ref.kind === "part-usage"
      )
      .map((node) => node.ref.id)
      .sort(),
    ["def-base", "def-root", "def-stem", "usage-base", "usage-stem"],
  );
});

// ---------------------------------------------------------------------------
// Raw counts are unchanged by folding
// ---------------------------------------------------------------------------

Deno.test("rawNodeCount and rawEdgeCount reflect the unfiltered graph", () => {
  const { graph, familyGraph } = threeNodeBridge();

  const model = buildEvidenceGraphModel(graph, familyGraph, {
    isAnalyzeInstrumentNode: (n) => n.system === "analyze",
  });

  assertEquals(model.rawNodeCount, 3);
  assertEquals(model.rawEdgeCount, 2);
  // Only 2 visible (B folded).
  assertEquals(model.nodes.length, 2);
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function ref(id: string, kind: ThreadGraphRef["kind"]): ThreadGraphRef {
  return { kind, id };
}

function nodeFor(
  id: string,
  kind: ThreadGraphRef["kind"],
  system: string,
): ThreadGraphNode {
  return {
    id: `node-${id}`,
    ref: { kind, id },
    entityKind: kind,
    label: id,
    system,
    freshness: "fresh",
    summary: `${kind} · ${id}`,
  };
}

function edgeFor(
  id: string,
  fromId: string,
  fromKind: ThreadGraphRef["kind"],
  toId: string,
  toKind: ThreadGraphRef["kind"],
  relation: ThreadGraphEdge["relation"],
): ThreadGraphEdge {
  return {
    id,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation,
    rationale: id,
    origin: "provenance",
  };
}

function analysisEdge(
  id: string,
  fromId: string,
  toId: string,
  relation: Extract<
    ThreadGraphEdge["relation"],
    | "measured-local-sensitivity"
    | "projection-of"
    | "semantic-binding"
    | "declared-dependency"
  >,
): ThreadGraphEdge {
  return {
    id,
    from: { kind: "analysis-node", id: fromId },
    to: { kind: "analysis-node", id: toId },
    relation,
    rationale: id,
    origin: "analysis",
  };
}

function emptyFamilyGraph(): ThreadEvidenceFamilyGraph {
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "test-snap", revision: 1 },
    families: [],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
}

/**
 * Three-node bridge: A (artifact/calculix) — B (evaluation/analyze) — C (artifact/calculix).
 * Derived from the sensitivity study structure:
 *   base-run artifact → capture (instrument) → anchored artifact
 */
function threeNodeBridge() {
  const graph = {
    nodes: [
      nodeFor("A", "artifact", "calculix"),
      nodeFor("B", "evaluation", "analyze"),
      nodeFor("C", "artifact", "calculix"),
    ],
    edges: [
      edgeFor("A-B", "A", "artifact", "B", "evaluation", "evaluates"),
      edgeFor("B-C", "B", "evaluation", "C", "artifact", "evidences"),
    ],
  };
  return { graph, familyGraph: emptyFamilyGraph() };
}

/**
 * Versioned proof plus a bridge instrument.
 *
 * Mirrors the real structure:
 *   Proof-R1 — supersedes → Proof-R2 (both calculix artifacts)
 *   Proof-R2 — evaluates → I (instrument, system=analyze)
 *   I        — evidences → R (requirement, system=syson)
 */
function versionedPlusBridgeGraph() {
  const graph = {
    nodes: [
      nodeFor("proof-r1", "artifact", "calculix"),
      nodeFor("proof-r2", "artifact", "calculix"),
      nodeFor("I", "evaluation", "analyze"),
      nodeFor("R", "requirement", "syson"),
    ],
    edges: [
      edgeFor(
        "r1-supersedes-r2",
        "proof-r1",
        "artifact",
        "proof-r2",
        "artifact",
        "supersedes",
      ),
      edgeFor("r2-I", "proof-r2", "artifact", "I", "evaluation", "evaluates"),
      edgeFor("I-R", "I", "evaluation", "R", "requirement", "evidences"),
    ],
  };
  const familyGraph: ThreadEvidenceFamilyGraph = {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "test-snap", revision: 1 },
    families: [{
      id: "proof-family",
      entityKind: "artifact",
      artifactKind: "solver-result",
      historicalRefs: [{ kind: "artifact", id: "proof-r1" }],
      currentRefs: [{ kind: "artifact", id: "proof-r2" }],
      revisionCount: 1,
      status: "current" as const,
      relationship: {
        relation: "supersedes" as const,
        classification: "not-recorded" as const,
        equivalence: "not-recorded" as const,
      },
      transitions: [{
        edgeRef: {
          id: "r1-supersedes-r2",
          relation: "supersedes" as const,
          origin: "provenance" as const,
        },
        historical: { kind: "artifact" as const, id: "proof-r1" },
        successor: { kind: "artifact" as const, id: "proof-r2" },
      }],
    }],
    edges: [],
    omittedSelfLoops: [{
      familyId: "proof-family",
      memberEdgeRefs: [{
        id: "r1-supersedes-r2",
        relation: "supersedes" as const,
        origin: "provenance" as const,
      }],
    }],
    omittedCycleEdges: [],
  };
  return { graph, familyGraph };
}

/**
 * Linear chain A → B → C → D, all artifacts, all "calculix".
 * Used to test depth-bounded neighbourhood.
 */
function chainGraph(ids: string[]) {
  const nodes = ids.map((id) => nodeFor(id, "artifact", "calculix"));
  const edges: ThreadGraphEdge[] = ids.slice(0, -1).map((id, i) =>
    edgeFor(
      `${id}-${ids[i + 1]}`,
      id,
      "artifact",
      ids[i + 1]!,
      "artifact",
      "derived_from",
    )
  );
  return { nodes, edges };
}
