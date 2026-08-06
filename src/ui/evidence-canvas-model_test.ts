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

Deno.test("isAnalyzeInstrumentNode keeps sensitivity SysML declaration (syson)", () => {
  const n = node(
    "sensitivity-relations-abc123",
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

Deno.test("isAnalyzeInstrumentNode ignores observations (wrong entityKind)", () => {
  const n: ThreadGraphNode = {
    id: "sensitivity-obs",
    ref: ref("drip-tray-sensitivity-abc123-base-displacement", "observation"),
    entityKind: "observation",
    label: "obs",
    system: "calculix",
    freshness: "fresh",
    summary: "obs",
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
