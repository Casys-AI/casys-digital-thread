/**
 * Tests for evidence-canvas-model.ts
 *
 * Tests cover:
 * 1. isAnalyzeInstrumentNode — structural predicate using system + entityKind + id
 * 2. stubToEdge — stub → ThreadGraphEdge conversion
 * 3. buildEvidenceCanvasProjection — full graph, focus, historical fallback
 * 4. makeEvidenceComponentLabeler — named frames from model
 */

import { assertEquals } from "@std/assert";
import {
  buildEvidenceCanvasProjection,
  buildExplorationKindProjection,
  isAnalyzeInstrumentNode,
  isFoldedEvidenceNode,
  isSolverEnvelopeNode,
  linkedEvidenceDetail,
  makeEvidenceComponentLabeler,
  paintedDossierMetric,
  stubToEdge,
} from "./src/thread/evidence-canvas-model.ts";
import type { DisplayKind } from "./src/thread/essential-graph-filter.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import type {
  EvidenceGraphModel,
  EvidenceGraphStub,
} from "./src/thread/evidence-graph-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

function ref(id: string, kind: ThreadGraphRef["kind"]): ThreadGraphRef {
  return { id, kind };
}

function node(
  id: string,
  kind: ThreadGraphRef["kind"],
  system: string,
): ThreadGraphNode {
  return {
    id,
    ref: ref(id, kind),
    entityKind: kind,
    label: id,
    system,
    freshness: "fresh",
    summary: id,
  };
}

function edge(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation: "derived_from",
    rationale: id,
    origin: "provenance",
  };
}

const emptyFamilyGraph: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "test", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

// ---------------------------------------------------------------------------
// 1 — isAnalyzeInstrumentNode
// ---------------------------------------------------------------------------

Deno.test("isAnalyzeInstrumentNode folds build123d sensitivity artifacts", () => {
  const n = node(
    "drip-tray-sensitivity-abc123-base-step",
    "artifact",
    "build123d",
  );
  assertEquals(isAnalyzeInstrumentNode(n), true);
});

Deno.test("isAnalyzeInstrumentNode folds calculix sensitivity artifacts", () => {
  const n = node(
    "drip-tray-sensitivity-abc123-base-solve",
    "artifact",
    "calculix",
  );
  assertEquals(isAnalyzeInstrumentNode(n), true);
});

Deno.test("isAnalyzeInstrumentNode folds digital-thread sensitivity-study campaign documents", () => {
  assertEquals(
    isAnalyzeInstrumentNode(
      node("sensitivity-study-abc123", "artifact", "digital-thread"),
    ),
    true,
  );
  assertEquals(
    isAnalyzeInstrumentNode(
      node("sensitivity-case-abc123", "artifact", "digital-thread"),
    ),
    true,
  );
  assertEquals(
    isAnalyzeInstrumentNode(
      node("sensitivity-edges-abc123", "artifact", "digital-thread"),
    ),
    true,
  );
  assertEquals(
    isAnalyzeInstrumentNode(
      node("sensitivity-base-evaluation-abc123", "artifact", "digital-thread"),
    ),
    true,
  );
});

Deno.test("isAnalyzeInstrumentNode keeps a digital-thread document that is not a campaign id", () => {
  const n = node(
    "drip-tray-sensitivity-abc123-capture",
    "artifact",
    "digital-thread",
  );
  assertEquals(isAnalyzeInstrumentNode(n), false);
});

Deno.test("isAnalyzeInstrumentNode keeps study-base evaluations attached to Thread requirements", () => {
  const n = node(
    "requirement-arm-maxDisplacement-evaluation-abc123",
    "evaluation",
    "syson",
  );
  assertEquals(isAnalyzeInstrumentNode(n), false);
});

Deno.test("isAnalyzeInstrumentNode folds sensitivity-relations syson declaration", () => {
  // sensitivity-relations-* artifacts are structural traces of the analyze.* run
  // anchored as SysML elements. They belong to the instrument family and are folded.
  const n = node(
    "sensitivity-relations-abc123",
    "artifact",
    "syson",
  );
  assertEquals(isAnalyzeInstrumentNode(n), true);
});

Deno.test("isAnalyzeInstrumentNode folds sensitivity-edges syson declaration", () => {
  // sensitivity-edges-* artifacts are the SysML edge-set declarations produced
  // alongside sensitivity-relations-* by the same analyze.* run.
  const n = node(
    "sensitivity-edges-def456",
    "artifact",
    "syson",
  );
  assertEquals(isAnalyzeInstrumentNode(n), true);
});

Deno.test("isAnalyzeInstrumentNode keeps non-sensitivity syson artifact (e.g. DripTray geometry)", () => {
  // A regular syson element (model spec, requirement, geometry declaration) is kept visible.
  const n = node(
    "drip-tray-geometry-v3",
    "artifact",
    "syson",
  );
  assertEquals(isAnalyzeInstrumentNode(n), false);
});

Deno.test("isAnalyzeInstrumentNode keeps syson sensitivity-oracle-requirements (model spec, not trace)", () => {
  // The oracle requirements declaration is a model specification, not an analyze.* trace.
  // Its id does not start with sensitivity-relations- or sensitivity-edges-.
  const n = node(
    "sensitivity-oracle-requirements-abc",
    "artifact",
    "syson",
  );
  assertEquals(isAnalyzeInstrumentNode(n), false);
});

Deno.test("isAnalyzeInstrumentNode keeps non-sensitivity calculix artifacts", () => {
  const n = node(
    "drip-tray-r3-static-result",
    "artifact",
    "calculix",
  );
  assertEquals(isAnalyzeInstrumentNode(n), false);
});

Deno.test("isAnalyzeInstrumentNode folds sensitivity observations (server-fixed id prefix)", () => {
  // Sensitivity observations share the same id prefix as their source artifact.
  // They are intermediate measurements about the instrument run, not the current design.
  const n: ThreadGraphNode = {
    id: "drip-tray-sensitivity-abc123-displacement",
    ref: ref("drip-tray-sensitivity-abc123-displacement", "observation"),
    entityKind: "observation",
    label: "DripTray displacement sensitivity (size-z)",
    system: "digital-thread",
    freshness: "fresh",
    summary: "obs",
  };
  assertEquals(isAnalyzeInstrumentNode(n), true);
});

Deno.test("isAnalyzeInstrumentNode folds von-Mises sensitivity observation", () => {
  const n: ThreadGraphNode = {
    id: "drip-tray-sensitivity-abc123-von-mises",
    ref: ref("drip-tray-sensitivity-abc123-von-mises", "observation"),
    entityKind: "observation",
    label: "von Mises sensitivity",
    system: "calculix",
    freshness: "fresh",
    summary: "obs",
  };
  assertEquals(isAnalyzeInstrumentNode(n), true);
});

Deno.test("isAnalyzeInstrumentNode keeps non-sensitivity observations", () => {
  // A regular FEA observation (no sensitivity in the server-fixed id) stays visible.
  const n: ThreadGraphNode = {
    id: "drip-tray-r3-displacement",
    ref: ref("drip-tray-r3-displacement", "observation"),
    entityKind: "observation",
    label: "DripTray displacement",
    system: "calculix",
    freshness: "fresh",
    summary: "0.012 mm",
  };
  assertEquals(isAnalyzeInstrumentNode(n), false);
});

function artifactNode(
  id: string,
  system: string,
  artifactKind: ThreadGraphNode["artifactKind"],
): ThreadGraphNode {
  return {
    ...node(id, "artifact", system),
    artifactKind,
  };
}

Deno.test("isSolverEnvelopeNode folds CalculiX result.json", () => {
  assertEquals(
    isSolverEnvelopeNode(
      artifactNode("calculix-result-json-abc", "mcp-calculix", "solver-result"),
    ),
    true,
  );
});

Deno.test("isSolverEnvelopeNode folds CalculiX input.step", () => {
  assertEquals(
    isSolverEnvelopeNode(
      artifactNode("calculix-input-step-abc", "mcp-calculix", "solver-input"),
    ),
    true,
  );
});

Deno.test("isSolverEnvelopeNode keeps authoritative STEP and observations", () => {
  assertEquals(
    isSolverEnvelopeNode(
      artifactNode("cad-asset-arm-step", "build123d-sandbox", "step"),
    ),
    false,
  );
  assertEquals(
    isSolverEnvelopeNode(
      artifactNode("cad-asset-arm-glb", "build123d-sandbox", "cad-model"),
    ),
    false,
  );
  assertEquals(
    isSolverEnvelopeNode(
      node("maxDisplacement", "observation", "mcp-calculix"),
    ),
    false,
  );
});

Deno.test("isFoldedEvidenceNode covers campaign instruments and solver envelopes", () => {
  assertEquals(
    isFoldedEvidenceNode(
      node("sensitivity-case-abc", "artifact", "digital-thread"),
    ),
    true,
  );
  assertEquals(
    isFoldedEvidenceNode(
      artifactNode("calculix-result-json-abc", "mcp-calculix", "solver-result"),
    ),
    true,
  );
  assertEquals(
    isFoldedEvidenceNode(
      artifactNode("cad-asset-arm-step", "build123d-sandbox", "step"),
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// 2 — stubToEdge
// ---------------------------------------------------------------------------

Deno.test("stubToEdge produces a ThreadGraphEdge with via rationale", () => {
  const stub: EvidenceGraphStub = {
    id: "stub:artifact:A->artifact:C",
    from: ref("A", "artifact"),
    to: ref("C", "artifact"),
    viaLabel: "sensitivity base step",
    relation: "derived_from",
    origin: "provenance",
  };
  const result = stubToEdge(stub);
  assertEquals(result.id, "stub:artifact:A->artifact:C");
  assertEquals(result.from, ref("A", "artifact"));
  assertEquals(result.to, ref("C", "artifact"));
  assertEquals(result.relation, "derived_from");
  assertEquals(result.rationale, "via sensitivity base step — folded");
  assertEquals(result.origin, "provenance");
});

Deno.test("paintedDossierMetric counts the full-map essential nodes and visible components", () => {
  const { model } = instrumentBridgeFixture();
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );
  const painted = paintedDossierMetric(model, projection);
  assertEquals(painted.itemCount, projection.displayedCount);
  assertEquals(painted.componentCount, 1);
  assertEquals(linkedEvidenceDetail(1), "in 1 linked dossier");
  assertEquals(
    linkedEvidenceDetail(2),
    "across 2 linked dossier components",
  );
  assertEquals(linkedEvidenceDetail(0), "no painted dossier");
});

// ---------------------------------------------------------------------------
// 3 — buildEvidenceCanvasProjection
// ---------------------------------------------------------------------------

/**
 * Minimal fixture: A → B(instrument) → C
 * B is an analyze instrument (build123d sensitivity artifact).
 * After folding: A and C are visible, B is folded with a stub A→C.
 */
function instrumentBridgeFixture(): {
  model: EvidenceGraphModel;
  refA: ThreadGraphRef;
  refC: ThreadGraphRef;
} {
  const nodeA = node("A", "artifact", "digital-thread");
  const nodeB = node(
    "drip-tray-sensitivity-h-base-step",
    "artifact",
    "build123d",
  );
  const nodeC = node("C", "artifact", "syson");
  const graph = {
    nodes: [nodeA, nodeB, nodeC],
    edges: [
      edge(
        "e1",
        ref("A", "artifact"),
        ref("drip-tray-sensitivity-h-base-step", "artifact"),
      ),
      edge(
        "e2",
        ref("drip-tray-sensitivity-h-base-step", "artifact"),
        ref("C", "artifact"),
      ),
    ],
  };
  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph, {
    isAnalyzeInstrumentNode,
  });
  return { model, refA: ref("A", "artifact"), refC: ref("C", "artifact") };
}

Deno.test("buildEvidenceCanvasProjection — no focus returns full visible graph with stubs", () => {
  const { model } = instrumentBridgeFixture();
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );
  assertEquals(projection.isFiltered, false);
  assertEquals(projection.nodes.length, 2); // A and C visible; B folded
  assertEquals(projection.displayedCount, 2);
  // Stub edge A→C is included
  const stubEdge = projection.edges.find((e) => e.id.startsWith("stub:"));
  assertEquals(stubEdge !== undefined, true);
});

Deno.test("Evidence Map and Exploration share the same definition-backed SysML composites", () => {
  const root = node("def-root", "part-definition", "syson");
  const usage = node("usage-stem", "part-usage", "syson");
  const definition = node("def-stem", "part-definition", "syson");
  const step = node("step-stem", "artifact", "build123d");
  usage.label = "stem";
  definition.label = "FixedStem";
  const structural = (
    id: string,
    from: ThreadGraphRef,
    to: ThreadGraphRef,
    relation: ThreadGraphEdge["relation"],
  ): ThreadGraphEdge => ({
    id,
    from,
    to,
    relation,
    rationale: id,
    origin: "structure",
  });
  const model = buildEvidenceGraphModel({
    nodes: [root, usage, definition, step],
    edges: [
      structural("contains", root.ref, usage.ref, "contains"),
      structural("typed", usage.ref, definition.ref, "typed_by"),
      structural("represented", definition.ref, step.ref, "represented_by"),
    ],
  }, emptyFamilyGraph);

  const map = buildEvidenceCanvasProjection(model, 0, undefined, new Map());
  const exploration = buildExplorationKindProjection(
    model,
    ALL_KINDS_VISIBLE,
  );
  const signature = (projection: typeof map) =>
    projection.nodes.map((candidate) =>
      `${candidate.ref.kind}:${candidate.ref.id}:${candidate.label}`
    ).sort();

  assertEquals(signature(map), signature(exploration));
  assertEquals(signature(map), [
    "artifact:step-stem:step-stem",
    "part-definition:def-root:def-root",
    "part-definition:def-stem:stem : FixedStem",
  ]);
  assertEquals(map.displayedCount, 3);
});

Deno.test("Evidence canvas draws STEP + GLB as one node and keeps both identities", () => {
  const definition = node("arm-def", "part-definition", "syson");
  const step: ThreadGraphNode = {
    ...node("arm-step", "artifact", "build123d-sandbox"),
    artifactKind: "step",
    label: "Authoritative STEP: Arm",
  };
  const preview: ThreadGraphNode = {
    ...node("arm-glb", "artifact", "build123d-sandbox"),
    artifactKind: "cad-model",
    label: "GLTF: Arm",
  };
  const structural = (
    id: string,
    from: ThreadGraphRef,
    to: ThreadGraphRef,
    relation: ThreadGraphEdge["relation"],
  ): ThreadGraphEdge => ({
    id,
    from,
    to,
    relation,
    rationale: id,
    origin: "structure",
  });
  const model = buildEvidenceGraphModel({
    nodes: [definition, step, preview],
    edges: [
      structural("arm-step", definition.ref, step.ref, "represented_by"),
      structural("arm-glb", definition.ref, preview.ref, "represented_by"),
    ],
  }, emptyFamilyGraph);
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );
  assertEquals(projection.nodes.map((item) => item.ref.id).sort(), [
    "arm-def",
    "arm-step",
  ]);
  assertEquals(
    projection.nodes.find((item) => item.ref.id === "arm-step")?.summary,
    "Authoritative STEP: Arm plus GLB presentation · 2 exact artifact identities",
  );
  const focused = buildEvidenceCanvasProjection(
    model,
    0,
    preview.ref,
    new Map(),
  );
  assertEquals(focused.nodes.map((item) => item.ref.id).sort(), [
    "arm-def",
    "arm-glb",
    "arm-step",
  ]);
});

Deno.test("focusing a compact SysML member restores the exact usage-definition pair", () => {
  const root = node("def-root", "part-definition", "syson");
  const usage = node("usage-stem", "part-usage", "syson");
  const definition = node("def-stem", "part-definition", "syson");
  const edges: ThreadGraphEdge[] = [{
    id: "contains",
    from: root.ref,
    to: usage.ref,
    relation: "contains",
    rationale: "root contains stem",
    origin: "structure",
  }, {
    id: "typed",
    from: usage.ref,
    to: definition.ref,
    relation: "typed_by",
    rationale: "stem is typed by FixedStem",
    origin: "structure",
  }];
  const model = buildEvidenceGraphModel(
    { nodes: [root, usage, definition], edges },
    emptyFamilyGraph,
  );

  for (const focus of [usage.ref, definition.ref]) {
    const detail = buildEvidenceCanvasProjection(
      model,
      0,
      focus,
      new Map(),
    );
    assertEquals(detail.isFiltered, true);
    assertEquals(
      detail.nodes.map((candidate) => `${candidate.ref.kind}:${candidate.ref.id}`)
        .sort(),
      [
        "part-definition:def-root",
        "part-definition:def-stem",
        "part-usage:usage-stem",
      ],
    );
    assertEquals(
      detail.edges.some((candidate) => candidate.id === "typed"),
      true,
    );
  }
});

Deno.test("buildEvidenceCanvasProjection — focus on visible node returns bounded neighbourhood", () => {
  const { model, refA } = instrumentBridgeFixture();
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    refA,
    new Map(),
  );
  assertEquals(projection.isFiltered, true);
  // neighbourhood of A at depth 3 includes A (and C via the stub edge)
  assertEquals(projection.nodes.some((n) => n.ref.id === "A"), true);
  assertEquals(projection.displayedCount > 0, true);
});

Deno.test("buildEvidenceCanvasProjection — focus on historical node uses visible representative", () => {
  const { model, refA } = instrumentBridgeFixture();
  // Simulate a historical ref that maps to refA via visibleRefByMemberRef.
  const historicalRef = ref("A-old", "artifact");
  const visibleRefByMemberRef = new Map([
    ["artifact:A-old", refA],
  ]);
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    historicalRef,
    visibleRefByMemberRef,
  );
  // Should fall through to representative neighbourhood (A visible) or full fallback.
  // Either way, result is non-empty.
  assertEquals(projection.nodes.length > 0, true);
});

Deno.test("buildEvidenceCanvasProjection — local view computes max depth and reports BFS depths for display filtering", () => {
  // Chain D0 → D1 → D2 → D3 : the neighbourhood is always COMPUTED at
  // LOCAL_VIEW_MAX_DEPTH; renderers filter display by localDepthByRefKey so
  // depth changes never re-layout. The map must carry exact BFS depths.
  const chain = ["D0", "D1", "D2", "D3"].map((id) =>
    node(id, "artifact", "digital-thread")
  );
  const graph = {
    nodes: chain,
    edges: [
      edge("c1", ref("D0", "artifact"), ref("D1", "artifact")),
      edge("c2", ref("D1", "artifact"), ref("D2", "artifact")),
      edge("c3", ref("D2", "artifact"), ref("D3", "artifact")),
    ],
  };
  const model = buildEvidenceGraphModel(graph, emptyFamilyGraph, {
    isAnalyzeInstrumentNode,
  });

  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    ref("D0", "artifact"),
    new Map(),
  );
  assertEquals(projection.isFiltered, true);
  assertEquals(
    projection.nodes.map((n) => n.ref.id).sort(),
    ["D0", "D1", "D2", "D3"],
    "The neighbourhood is computed at LOCAL_VIEW_MAX_DEPTH (3).",
  );
  const depths = projection.localDepthByRefKey;
  assertEquals(depths !== undefined, true, "Local view must expose depths.");
  assertEquals(depths!.get("artifact:D0"), 0);
  assertEquals(depths!.get("artifact:D1"), 1);
  assertEquals(depths!.get("artifact:D2"), 2);
  assertEquals(depths!.get("artifact:D3"), 3);

  // Full map: no depth map — the display filter only exists in local view.
  const fullMap = buildEvidenceCanvasProjection(model, 0, undefined, new Map());
  assertEquals(fullMap.localDepthByRefKey, undefined);
});

Deno.test("buildEvidenceCanvasProjection — foldedInstrumentCount is non-negative", () => {
  const { model } = instrumentBridgeFixture();
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );
  // rawNodeCount=3, nodes.length=2, collapsedVersionCount=0 → foldedInstrumentCount=1
  assertEquals(projection.foldedInstrumentCount, 1);
});

Deno.test("instrument and version folds are counted once in Carte and Exploration", () => {
  const historical = node("proof-r1", "artifact", "build123d");
  const current = node("proof-r2", "artifact", "build123d");
  const instrument = node(
    "drip-tray-sensitivity-h-base-step",
    "artifact",
    "build123d",
  );
  const result = node("result", "observation", "calculix");
  const familyGraph: ThreadEvidenceFamilyGraph = {
    ...emptyFamilyGraph,
    families: [{
      id: "proof-family",
      entityKind: "artifact",
      historicalRefs: [historical.ref],
      currentRefs: [current.ref],
      revisionCount: 1,
      status: "current",
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: [{
        edgeRef: {
          id: "old-to-current",
          relation: "supersedes",
          origin: "provenance",
        },
        historical: historical.ref,
        successor: current.ref,
      }],
    }],
    omittedSelfLoops: [],
  };
  const model = buildEvidenceGraphModel(
    {
      nodes: [historical, current, instrument, result],
      edges: [
        {
          ...edge("old-to-current", historical.ref, current.ref),
          relation: "supersedes",
        },
        edge("current-to-instrument", current.ref, instrument.ref),
        edge("instrument-to-result", instrument.ref, result.ref),
      ],
    },
    familyGraph,
    { isAnalyzeInstrumentNode },
  );
  const carte = buildEvidenceCanvasProjection(model, 1, undefined, new Map());
  const exploration = buildExplorationKindProjection(
    model,
    ALL_KINDS_VISIBLE,
    1,
  );
  assertEquals(carte.foldedInstrumentCount, 1);
  assertEquals(exploration.foldedInstrumentCount, 1);
  // The banner adds the two disjoint folds: one instrument + one old version.
  assertEquals(carte.foldedInstrumentCount + 1, 2);
  assertEquals(exploration.foldedInstrumentCount + 1, 2);
});

// ---------------------------------------------------------------------------
// 4 — makeEvidenceComponentLabeler
// ---------------------------------------------------------------------------

Deno.test("makeEvidenceComponentLabeler returns named component from model", () => {
  const { model, refA } = instrumentBridgeFixture();
  const labeler = makeEvidenceComponentLabeler(model, true);
  // A is in a component with nodes from digital-thread and syson; dominant is
  // determined by model.componentOf.  The name should not be "EVIDENCE COMPONENT NN".
  const nodeA: ThreadGraphNode = {
    id: "A",
    ref: refA,
    entityKind: "artifact",
    label: "A",
    system: "digital-thread",
    freshness: "fresh",
    summary: "A",
  };
  const label = labeler([nodeA], 0);
  assertEquals(label.includes("EVIDENCE COMPONENT"), false);
  assertEquals(label.length > 0, true);
});

Deno.test("makeEvidenceComponentLabeler returns fallback for empty nodes", () => {
  const { model } = instrumentBridgeFixture();
  const labeler = makeEvidenceComponentLabeler(model, true);
  const label = labeler([], 0);
  assertEquals(label, "Linked evidence");
});

Deno.test("makeEvidenceComponentLabeler returns multi-component fallback for empty nodes", () => {
  const { model } = instrumentBridgeFixture();
  const labeler = makeEvidenceComponentLabeler(model, false);
  const label = labeler([], 0);
  assertEquals(label, "Evidence");
});

// ---------------------------------------------------------------------------
// 5 — Essential filter applied upstream: banner counter semantics
// ---------------------------------------------------------------------------

/**
 * Fixture: essential node A (requirement) + supporting node B (mesh artifact).
 * The two are isolated (no edges). Essential filter should:
 *   - Keep A (essential)
 *   - Remove B (supporting, no path to any essential node)
 */
function essentialPlusSupportingFixture(): { model: EvidenceGraphModel } {
  const nodeA: ThreadGraphNode = {
    id: "A-requirement",
    ref: { kind: "requirement", id: "A-requirement" },
    entityKind: "requirement",
    label: "A requirement",
    system: "syson",
    freshness: "fresh",
    summary: "essential",
  };
  const nodeB: ThreadGraphNode = {
    id: "mesh-B",
    ref: { kind: "artifact", id: "mesh-B" },
    entityKind: "artifact",
    artifactKind: "mesh",
    label: "Mesh B",
    system: "build123d",
    freshness: "fresh",
    summary: "supporting mesh file",
  };
  const model = buildEvidenceGraphModel(
    { nodes: [nodeA, nodeB], edges: [] },
    emptyFamilyGraph,
    {},
  );
  return { model };
}

Deno.test(
  "buildEvidenceCanvasProjection — displayedCount is the post-filter essential count",
  () => {
    const { model } = essentialPlusSupportingFixture();
    const projection = buildEvidenceCanvasProjection(
      model,
      0,
      undefined,
      new Map(),
    );
    // displayedCount = essential nodes only (B was removed by the essential filter).
    assertEquals(projection.displayedCount, 1);
    assertEquals(projection.nodes.length, 1);
    assertEquals(projection.nodes[0]!.ref.id, "A-requirement");
  },
);

Deno.test(
  "buildEvidenceCanvasProjection — supportingNodeCount is the hidden count (for banner)",
  () => {
    const { model } = essentialPlusSupportingFixture();
    const projection = buildEvidenceCanvasProjection(
      model,
      0,
      undefined,
      new Map(),
    );
    // supportingNodeCount = B (hidden by the essential filter), not B's presence in
    // the full visible set. The banner formula is: displayedCount + supportingNodeCount
    // = total projected (essential + hidden).
    assertEquals(projection.supportingNodeCount, 1);
  },
);

Deno.test(
  "buildEvidenceCanvasProjection — sensitivity observations are folded alongside instruments",
  () => {
    // Graph: capture(digital-thread) --source_of--> obs-sensitivity(digital-thread)
    // The capture is NOT folded (digital-thread system). The sensitivity observation IS.
    const capture: ThreadGraphNode = {
      id: "drip-tray-sensitivity-h-capture",
      ref: { kind: "artifact", id: "drip-tray-sensitivity-h-capture" },
      entityKind: "artifact",
      label: "Sensitivity capture",
      system: "digital-thread",
      freshness: "fresh",
      summary: "capture",
    };
    const sensitivityObs: ThreadGraphNode = {
      id: "drip-tray-sensitivity-h-displacement",
      ref: {
        kind: "observation",
        id: "drip-tray-sensitivity-h-displacement",
      },
      entityKind: "observation",
      label: "DripTray displacement sensitivity (size-z)",
      system: "digital-thread",
      freshness: "fresh",
      summary: "0.012 mm",
    };
    const nonSensitivityObs: ThreadGraphNode = {
      id: "drip-tray-r3-displacement",
      ref: { kind: "observation", id: "drip-tray-r3-displacement" },
      entityKind: "observation",
      label: "DripTray displacement",
      system: "calculix",
      freshness: "fresh",
      summary: "0.012 mm",
    };
    // Build the model with the extended predicate. sensitivityObs should be
    // treated as an analyze instrument and folded.
    const model = buildEvidenceGraphModel(
      {
        nodes: [capture, sensitivityObs, nonSensitivityObs],
        edges: [
          {
            id: "e1",
            from: capture.ref,
            to: sensitivityObs.ref,
            relation: "source_of",
            rationale: "produced",
            origin: "provenance",
          },
        ],
      },
      emptyFamilyGraph,
      { isAnalyzeInstrumentNode },
    );
    const projection = buildEvidenceCanvasProjection(
      model,
      0,
      undefined,
      new Map(),
    );
    // capture: visible (digital-thread, not an instrument)
    // sensitivityObs: folded by isAnalyzeInstrumentNode (observation + sensitivity id)
    // nonSensitivityObs: visible (no sensitivity in id)
    const visibleIds = projection.nodes.map((n) => n.ref.id);
    assertEquals(visibleIds.includes("drip-tray-sensitivity-h-capture"), true);
    assertEquals(
      visibleIds.includes("drip-tray-sensitivity-h-displacement"),
      false,
    );
    assertEquals(visibleIds.includes("drip-tray-r3-displacement"), true);
  },
);

Deno.test(
  "sensitivity campaign folds into the construction dossier via a stub to the study-base evaluation",
  () => {
    const admission = node(
      "technical-compilation-admission-abc",
      "artifact",
      "digital-thread",
    );
    const studyCase = node(
      "sensitivity-case-abc",
      "artifact",
      "digital-thread",
    );
    const study = node(
      "sensitivity-study-abc",
      "artifact",
      "digital-thread",
    );
    const requirement = node("maxDisplacement", "requirement", "syson");
    const evaluation = node(
      "requirement-maxDisplacement-evaluation-abc",
      "evaluation",
      "syson",
    );
    const model = buildEvidenceGraphModel(
      {
        nodes: [admission, studyCase, study, requirement, evaluation],
        edges: [
          edge("admission-case", admission.ref, studyCase.ref),
          edge("case-study", studyCase.ref, study.ref),
          edge("study-eval", study.ref, evaluation.ref),
          {
            id: "req-eval",
            from: requirement.ref,
            to: evaluation.ref,
            relation: "evaluates",
            rationale: "join",
            origin: "provenance",
          },
        ],
      },
      emptyFamilyGraph,
      { isAnalyzeInstrumentNode },
    );
    const projection = buildEvidenceCanvasProjection(
      model,
      0,
      undefined,
      new Map(),
    );
    const visibleIds = projection.nodes.map((n) => n.ref.id).sort();
    assertEquals(visibleIds, [
      "maxDisplacement",
      "requirement-maxDisplacement-evaluation-abc",
      "technical-compilation-admission-abc",
    ]);
    const stub = projection.edges.find((item) =>
      item.id.startsWith("stub:") &&
      ((item.from.id === "technical-compilation-admission-abc" &&
        item.to.id === "requirement-maxDisplacement-evaluation-abc") ||
        (item.from.id === "requirement-maxDisplacement-evaluation-abc" &&
          item.to.id === "technical-compilation-admission-abc"))
    );
    assertEquals(stub !== undefined, true);
    assertEquals(
      projection.edges.some((item) =>
        item.id.startsWith("stub:") && item.from.id === item.to.id
      ),
      false,
    );
    assertEquals(model.componentOf(admission.ref), 0);
    assertEquals(model.componentOf(evaluation.ref), 0);
    assertEquals(model.componentOf(requirement.ref), 0);
  },
);

Deno.test(
  "solver envelopes fold so the authoritative STEP reaches the observation",
  () => {
    const step = artifactNode(
      "cad-asset-arm-step",
      "build123d-sandbox",
      "step",
    );
    const input = artifactNode(
      "calculix-input-step-abc",
      "mcp-calculix",
      "solver-input",
    );
    const result = artifactNode(
      "calculix-result-json-abc",
      "mcp-calculix",
      "solver-result",
    );
    const observation = node(
      "maxDisplacement",
      "observation",
      "mcp-calculix",
    );
    const model = buildEvidenceGraphModel(
      {
        nodes: [step, input, result, observation],
        edges: [
          {
            id: "step-input",
            from: step.ref,
            to: input.ref,
            relation: "input_to",
            rationale: "byte-identical staged STEP",
            origin: "structure",
          },
          {
            id: "input-result",
            from: input.ref,
            to: result.ref,
            relation: "input_to",
            rationale: "solver consumed the captured STEP",
            origin: "structure",
          },
          {
            id: "result-obs",
            from: result.ref,
            to: observation.ref,
            relation: "source_of",
            rationale: "observation extracted from result.json",
            origin: "structure",
          },
        ],
      },
      emptyFamilyGraph,
      { isAnalyzeInstrumentNode: isFoldedEvidenceNode },
    );
    const projection = buildEvidenceCanvasProjection(
      model,
      0,
      undefined,
      new Map(),
    );
    assertEquals(projection.nodes.map((item) => item.ref.id).sort(), [
      "cad-asset-arm-step",
      "maxDisplacement",
    ]);
    const stub = projection.edges.find((item) =>
      item.id.startsWith("stub:") &&
      item.from.id === "cad-asset-arm-step" &&
      item.to.id === "maxDisplacement"
    );
    assertEquals(stub !== undefined, true);
  },
);

// ---------------------------------------------------------------------------
// 6 — buildExplorationKindProjection
// ---------------------------------------------------------------------------

/** All kinds visible — every entry true. */
const ALL_KINDS_VISIBLE: Record<DisplayKind, boolean> = {
  "artifact": true,
  "supporting-artifact": true,
  "observation": true,
  "requirement": true,
  "evaluation": true,
  "study-base-evaluation": true,
  "violation": true,
  "change": true,
  "consumption": true,
  "action": true,
  "analysis": true,
  "sysml-element": true,
  "cad-lever": true,
  "cad-unnamed-literal": true,
};

/** Default map-mode kinds (matching workbench defaults). */
const DEFAULT_MAP_KINDS: Record<DisplayKind, boolean> = {
  "artifact": true,
  "supporting-artifact": false,
  "observation": true,
  "requirement": true,
  "evaluation": true,
  "study-base-evaluation": true,
  "violation": true,
  "change": false,
  "consumption": false,
  "action": true,
  "analysis": true,
  "sysml-element": true,
  "cad-lever": true,
  "cad-unnamed-literal": true,
};

Deno.test(
  "buildExplorationKindProjection — all kinds visible returns all model nodes",
  () => {
    const { model } = instrumentBridgeFixture();
    const projection = buildExplorationKindProjection(model, ALL_KINDS_VISIBLE);
    // The instrument is folded in the model; only A and C are in model.nodes.
    assertEquals(projection.isFiltered, false);
    assertEquals(projection.nodes.length, model.nodes.length);
    assertEquals(projection.displayedCount, model.nodes.length);
    assertEquals(projection.supportingNodeCount, 0);
  },
);

Deno.test(
  "buildExplorationKindProjection — default map kinds hide changes and consumptions",
  () => {
    // Build a graph with: artifact (essential), observation, requirement,
    // change, consumption.
    const nodeA: ThreadGraphNode = {
      id: "A-artifact",
      ref: ref("A-artifact", "artifact"),
      entityKind: "artifact",
      label: "A artifact",
      system: "build123d",
      freshness: "fresh",
      summary: "artifact",
    };
    const nodeObs: ThreadGraphNode = {
      id: "obs-1",
      ref: ref("obs-1", "observation"),
      entityKind: "observation",
      label: "Obs 1",
      system: "calculix",
      freshness: "fresh",
      summary: "obs",
    };
    const nodeChg: ThreadGraphNode = {
      id: "chg-1",
      ref: ref("chg-1", "change"),
      entityKind: "change",
      label: "Change 1",
      system: "digital-thread",
      freshness: "fresh",
      summary: "change",
    };
    const nodeMesh: ThreadGraphNode = {
      id: "mesh-1",
      ref: ref("mesh-1", "artifact"),
      entityKind: "artifact",
      artifactKind: "mesh",
      label: "Mesh 1",
      system: "build123d",
      freshness: "fresh",
      summary: "mesh",
    };
    const model = buildEvidenceGraphModel(
      {
        nodes: [nodeA, nodeObs, nodeChg, nodeMesh],
        edges: [
          edge(
            "e1",
            ref("A-artifact", "artifact"),
            ref("obs-1", "observation"),
          ),
        ],
      },
      emptyFamilyGraph,
      {},
    );
    const projection = buildExplorationKindProjection(model, DEFAULT_MAP_KINDS);

    const visibleIds = projection.nodes.map((n) => n.ref.id);
    // artifact (essential): visible
    assertEquals(visibleIds.includes("A-artifact"), true);
    // observation: visible
    assertEquals(visibleIds.includes("obs-1"), true);
    // change: hidden (DEFAULT_MAP_KINDS.change = false)
    assertEquals(visibleIds.includes("chg-1"), false);
    // supporting-artifact (mesh): hidden (DEFAULT_MAP_KINDS["supporting-artifact"] = false)
    assertEquals(visibleIds.includes("mesh-1"), false);
    // The isolated mesh was already excluded by the Carte essential mask;
    // Exploration must not reintroduce it just because it has a type toggle.
    assertEquals(projection.supportingNodeCount, 0);
    assertEquals(projection.displayedCount, 2);
  },
);

Deno.test(
  "buildExplorationKindProjection — stubs are included only when both endpoints are visible",
  () => {
    // Graph: A(artifact) → B(instrument) → C(artifact). B is folded → stub A→C.
    const { model } = instrumentBridgeFixture();
    // With all kinds visible the stub should be present (both A and C visible).
    const projAll = buildExplorationKindProjection(model, ALL_KINDS_VISIBLE);
    const stubAll = projAll.edges.find((e) => e.id.startsWith("stub:"));
    assertEquals(
      stubAll !== undefined,
      true,
      "Stub must be present when both endpoints are visible",
    );

    // Hide artifacts: A and C are both hidden → stub must be dropped.
    const noArtifacts: Record<DisplayKind, boolean> = {
      ...ALL_KINDS_VISIBLE,
      "artifact": false,
      "supporting-artifact": false,
    };
    const projNoArt = buildExplorationKindProjection(model, noArtifacts);
    assertEquals(projNoArt.nodes.length, 0, "No nodes when artifacts hidden");
    const stubNoArt = projNoArt.edges.find((e) => e.id.startsWith("stub:"));
    assertEquals(
      stubNoArt,
      undefined,
      "Stub must be absent when both endpoints are hidden",
    );
  },
);

Deno.test(
  "buildExplorationKindProjection — counters describe the shared essential mask",
  () => {
    const { model } = essentialPlusSupportingFixture();
    // essentialPlusSupportingFixture: one essential (requirement), one mesh (supporting).
    // With DEFAULT_MAP_KINDS, requirement is visible, supporting-artifact is hidden.
    const projection = buildExplorationKindProjection(model, DEFAULT_MAP_KINDS);
    assertEquals(
      projection.displayedCount + projection.supportingNodeCount,
      1,
      "an excluded isolated support is not reintroduced or counted as type-hidden",
    );
  },
);
