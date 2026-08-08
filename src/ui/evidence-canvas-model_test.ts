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
  isAnalyzeInstrumentNode,
  makeEvidenceComponentLabeler,
  stubToEdge,
} from "./src/thread/evidence-canvas-model.ts";
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

Deno.test("isAnalyzeInstrumentNode keeps sensitivity capture (digital-thread)", () => {
  const n = node(
    "drip-tray-sensitivity-abc123-capture",
    "artifact",
    "digital-thread",
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
  assertEquals(result.rationale, "via sensitivity base step — replié");
  assertEquals(result.origin, "provenance");
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
  const nodeB = node("drip-tray-sensitivity-h-base-step", "artifact", "build123d");
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

Deno.test("buildEvidenceCanvasProjection — collapsedVersionCount does not double-count", () => {
  const { model } = instrumentBridgeFixture();
  // Pretend 1 version was collapsed (even though our fixture has none).
  // foldedInstrumentCount should be max(0, 3-2-1) = 0.
  const projection = buildEvidenceCanvasProjection(
    model,
    1,
    undefined,
    new Map(),
  );
  assertEquals(projection.foldedInstrumentCount, 0);
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
  assertEquals(label, "Preuves liées");
});

Deno.test("makeEvidenceComponentLabeler returns multi-component fallback for empty nodes", () => {
  const { model } = instrumentBridgeFixture();
  const labeler = makeEvidenceComponentLabeler(model, false);
  const label = labeler([], 0);
  assertEquals(label, "Preuves");
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
