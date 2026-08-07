/**
 * Tests for part-lane-graph-model.ts
 *
 * Invariants under test:
 *  1. Assembly lane always renders on top (greatest y — sigma's y axis points UP).
 *  2. Exhaustive node assignment: every node in the sigma graph appears in
 *     exactly the lane given by its anchorage (or "assembly" if unanchored).
 *  3. No y overlap within a non-collapsed lane: all nodes have distinct y values.
 *  4. Determinism: two calls with identical inputs produce identical positions.
 *  5. Collapsed lane height === COLLAPSED_LANE_HEIGHT.
 *  6. Non-collapsed lane height === LANE_PADDING_TOP + n × LANE_NODE_SPACING
 *     + LANE_PADDING_BOTTOM (for a lane with n nodes; max(1,n) slots).
 *  7. x positions are unchanged from the Exploration model (causal flow preserved).
 *  8. Collapsed lane nodes are smaller than LANE_NODE_SPACING / 2 in size
 *     (they appear as small dots within the thin band).
 *
 * Fixture topology:
 *   - Assembly lane: 2 nodes (architecture artifact + oracle-requirements artifact)
 *   - DripTray lane: 3 nodes (mechanical proof + sensitivity capture + printability)
 *   - Boiler lane: 1 node (collapses — factCount=1 ≤ COLLAPSED_FACT_THRESHOLD=2)
 *
 * Real CM-01 V3 artifact IDs are used so prefix-table anchorage entries are
 * exercised, matching the contract from part-anchorage-model.ts.
 */

import { assertEquals, assertGreater } from "@std/assert";
import { buildPartAnchorage } from "./src/thread/part-anchorage-model.ts";
import {
  buildPartLaneLayout,
  buildStationAssignment,
} from "./src/thread/part-lane-model.ts";
import {
  buildPartLaneGraphModel,
  COLLAPSED_LANE_HEIGHT,
  LANE_NODE_SPACING,
  LANE_PADDING_BOTTOM,
  LANE_PADDING_TOP,
} from "./src/thread/part-lane-graph-model.ts";
import {
  buildExplorationModel,
  FALLBACK_TOKENS,
} from "./src/thread/evidence-exploration-model.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import { buildEvidenceCanvasProjection } from "./src/thread/evidence-canvas-model.ts";
import type {
  ThreadComponentCatalog,
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Stable IDs derived from the real CM-01 V3 projection (same source as
// part-anchorage-model_test.ts and part-lane-model_test.ts)
// ---------------------------------------------------------------------------

const ARCH_ID =
  "coffee-machine-cm01-v3-architecture-b4c805a45d9f3ac9ae67318d2822804ceaaa00e121b7079e13c62dce38d4add7";
const ORACLE_REQ_ID =
  "oracle-requirements-944e2515fb349d631e9aa4d85a3b9394420990c9610d5dfff8c290f032d633e3";
const MECH_R3_PROOF_ID =
  "coffee-machine-cm01-v3-mechanical-r3-ec23ad25f52a9a467bfc8e8fa07e62ee8da1efb48c570c0554c1066b21d48297-proof";
const DT_SENS_ID =
  "drip-tray-sensitivity-bacc1c4ef2c0154ca71e72bf4e517290ce2c30aedb4702f724c3cf89d2cadc7e-capture";
const DT_PRINT_ID = "drip-tray-printability-abc123-capture";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ref(
  id: string,
  kind: ThreadGraphRef["kind"],
): ThreadGraphRef {
  return { kind, id };
}

function node(
  id: string,
  kind: ThreadGraphRef["kind"],
  system: string,
  entityKind: ThreadGraphNode["entityKind"],
  artifactKind?: string,
): ThreadGraphNode {
  const n: ThreadGraphNode = {
    id,
    ref: ref(id, kind),
    label: `Label ${id.slice(0, 16)}`,
    summary: `Summary ${id.slice(0, 8)}`,
    system,
    entityKind,
    freshness: "fresh",
    selection: undefined,
  };
  if (artifactKind !== undefined) {
    return { ...n, artifactKind } as ThreadGraphNode;
  }
  return n;
}

function edge(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: ThreadGraphEdge["relation"] = "input_to",
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation,
    rationale: `Relation ${id}`,
    origin: "structure",
  };
}

function catalogBinding(
  evidenceArtifactId: string,
  provider: "syson" | "build123d" | "digital-thread" = "syson",
): {
  provider: "syson" | "build123d" | "digital-thread";
  kind: "artifact";
  id: string;
  label: string;
  evidenceArtifactId: string;
  status: "verified";
} {
  return {
    provider,
    kind: "artifact",
    id: evidenceArtifactId,
    label: evidenceArtifactId.slice(-20),
    evidenceArtifactId,
    status: "verified",
  };
}

const EMPTY_FAMILY: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "test-plg", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * Builds the minimal fixture graph and catalog covering:
 *   - Assembly lane: ARCH_ID (architecture → assembly), ORACLE_REQ_ID (oracle-requirements → assembly)
 *   - DripTray lane: MECH_R3_PROOF_ID (mechanical-r3 → drip-tray), DT_SENS_ID (drip-tray-sensitivity → drip-tray), DT_PRINT_ID (drip-tray-printability → drip-tray)
 *   - Boiler lane: "boiler-artifact-001" (not in prefix table → unanchored unless catalog)
 */
function buildFixture(): {
  graph: ThreadGraph;
  catalog: ThreadComponentCatalog;
  evidenceModel: ReturnType<typeof buildEvidenceGraphModel>;
  projection: ReturnType<typeof buildEvidenceCanvasProjection>;
  anchorage: ReturnType<typeof buildPartAnchorage>;
  rows: ReturnType<typeof buildPartLaneLayout>["rows"];
  counters: ReturnType<typeof buildPartLaneLayout>["counters"];
} {
  const archNode = node(
    ARCH_ID,
    "artifact",
    "syson",
    "artifact",
    "sysml-model",
  );
  const oracleNode = node(
    ORACLE_REQ_ID,
    "artifact",
    "syson",
    "artifact",
    "sysml-model",
  );
  const mechProofNode = node(
    MECH_R3_PROOF_ID,
    "artifact",
    "calculix",
    "artifact",
  );
  const sensNode = node(
    DT_SENS_ID,
    "artifact",
    "casys-digital-thread",
    "artifact",
    "capture",
  );
  const printNode = node(
    DT_PRINT_ID,
    "artifact",
    "casys-digital-thread",
    "artifact",
    "capture",
  );
  const boilerNode = node(
    "boiler-artifact-001",
    "artifact",
    "syson",
    "artifact",
    "sysml-model",
  );

  const nodes: ThreadGraphNode[] = [
    archNode,
    oracleNode,
    mechProofNode,
    sensNode,
    printNode,
    boilerNode,
  ];

  const edges: ThreadGraphEdge[] = [
    // Assembly chain: arch → oracle-req
    edge("e-arch-oracle", archNode.ref, oracleNode.ref, "derived_from"),
    // Assembly → DripTray
    edge("e-arch-mech", archNode.ref, mechProofNode.ref, "input_to"),
    // DripTray chain
    edge("e-mech-sens", mechProofNode.ref, sensNode.ref, "source_of"),
    edge("e-mech-print", mechProofNode.ref, printNode.ref, "derived_from"),
    // Boiler stands alone (no edges connecting to assembly chain)
  ];

  const graph: ThreadGraph = { nodes, edges };

  const catalog: ThreadComponentCatalog = {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: "CM-01-TEST",
    rationale: "Test fixture for part-lane-graph-model_test.ts",
    systemViews: {},
    components: [
      {
        id: "assembly",
        kind: "assembly" as const,
        label: "CoffeeMachine",
        quantity: 1,
        bindings: [catalogBinding(ARCH_ID, "syson")],
      },
      {
        id: "cm01-v3:drip-tray",
        kind: "part" as const,
        label: "DripTray",
        quantity: 1,
        bindings: [],
      },
      {
        id: "cm01-v3:boiler",
        kind: "part" as const,
        label: "Boiler",
        quantity: 1,
        bindings: [catalogBinding("boiler-artifact-001", "syson")],
      },
    ],
  };

  const evidenceModel = buildEvidenceGraphModel(graph, EMPTY_FAMILY, {});
  const projection = buildEvidenceCanvasProjection(
    evidenceModel,
    0,
    undefined,
    new Map(),
  );
  const anchorage = buildPartAnchorage(graph, catalog);
  const stations = buildStationAssignment(graph);
  const layout = buildPartLaneLayout(
    evidenceModel,
    projection,
    anchorage,
    stations,
    catalog,
  );

  return {
    graph,
    catalog,
    evidenceModel,
    projection,
    anchorage,
    rows: layout.rows,
    counters: layout.counters,
  };
}

// ---------------------------------------------------------------------------
// 1. Assembly lane is always first
// ---------------------------------------------------------------------------

// Sigma renders with the WebGL convention: GREATER y is HIGHER on screen. The
// assembly lane (superior level) must therefore carry the greatest y range —
// asserting on layout order alone would pass even when the rendered order is
// inverted, which is exactly the defect this test now pins.
Deno.test("assembly lane renders above every part lane (greatest y in sigma space)", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();
  const model = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  const assemblyLane = model.lanes.find((l) => l.componentId === "assembly");
  const otherLanes = model.lanes.filter((l) => l.componentId !== "assembly");

  assertEquals(
    assemblyLane !== undefined,
    true,
    "Assembly lane must exist",
  );
  for (const other of otherLanes) {
    assertEquals(
      assemblyLane!.yMin > other.yMax,
      true,
      `Assembly (yMin=${
        assemblyLane!.yMin
      }) must render above ${other.componentId} (yMax=${other.yMax})`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Exhaustive node assignment — every node in its anchored lane
// ---------------------------------------------------------------------------

Deno.test("every graph node appears in exactly its anchored lane", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();
  const model = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  // Build a map from nodeKey → expected componentId
  const expectedLane = new Map<string, string>();
  model.graph.forEachNode((key: string) => {
    const anchor = anchorage.get(key);
    expectedLane.set(
      key,
      anchor ? (anchor.target === "assembly" ? "assembly" : anchor.target) : "assembly",
    );
  });

  // Build a map from nodeKey → assigned y, and verify it falls within the
  // expected lane's [yMin, yMax] range.
  model.graph.forEachNode((key: string) => {
    const y = model.graph.getNodeAttribute(key, "y") as number;
    const cid = expectedLane.get(key)!;
    const lane = model.lanes.find((l) => l.componentId === cid);
    assertEquals(
      lane !== undefined,
      true,
      `No lane found for componentId "${cid}" (node: ${key})`,
    );
    assertEquals(
      y >= lane!.yMin && y <= lane!.yMax,
      true,
      `Node ${key} y=${y} is outside lane ${cid} [${lane!.yMin}, ${lane!.yMax}]`,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. No y overlap within a non-collapsed lane
// ---------------------------------------------------------------------------

Deno.test("no two nodes in the same non-collapsed lane share the same y", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();
  const model = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  // Group node y values by lane.
  const yByLane = new Map<string, number[]>();
  model.graph.forEachNode((key: string) => {
    const anchor = anchorage.get(key);
    const cid = anchor
      ? (anchor.target === "assembly" ? "assembly" : anchor.target)
      : "assembly";
    const lane = model.lanes.find((l) => l.componentId === cid);
    if (!lane || lane.collapsed) return;
    const y = model.graph.getNodeAttribute(key, "y") as number;
    const list = yByLane.get(cid) ?? [];
    list.push(y);
    yByLane.set(cid, list);
  });

  for (const [cid, ys] of yByLane) {
    const unique = new Set(ys);
    assertEquals(
      unique.size,
      ys.length,
      `Lane "${cid}" has duplicate y values: ${ys.join(", ")}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Determinism
// ---------------------------------------------------------------------------

Deno.test("buildPartLaneGraphModel is deterministic: same inputs → same positions", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();

  const m1 = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );
  const m2 = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  // Positions must be identical.
  m1.graph.forEachNode((key: string) => {
    const x1 = m1.graph.getNodeAttribute(key, "x") as number;
    const y1 = m1.graph.getNodeAttribute(key, "y") as number;
    const x2 = m2.graph.getNodeAttribute(key, "x") as number;
    const y2 = m2.graph.getNodeAttribute(key, "y") as number;
    assertEquals(x1, x2, `x not deterministic for node ${key}`);
    assertEquals(y1, y2, `y not deterministic for node ${key}`);
  });

  // Lane boundaries must be identical.
  assertEquals(m1.lanes.length, m2.lanes.length);
  for (let i = 0; i < m1.lanes.length; i++) {
    assertEquals(
      m1.lanes[i]!.yMin,
      m2.lanes[i]!.yMin,
      `yMin differs at index ${i}`,
    );
    assertEquals(
      m1.lanes[i]!.yMax,
      m2.lanes[i]!.yMax,
      `yMax differs at index ${i}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Collapsed lane height === COLLAPSED_LANE_HEIGHT
// ---------------------------------------------------------------------------

Deno.test("collapsed lane has height exactly COLLAPSED_LANE_HEIGHT", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();
  const model = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  // The boiler lane should be collapsed (1 node ≤ COLLAPSED_FACT_THRESHOLD=2, 0 proofs).
  const collapsedLanes = model.lanes.filter((l) => l.collapsed);
  assertGreater(
    collapsedLanes.length,
    0,
    "Expected at least one collapsed lane (boiler)",
  );

  for (const lane of collapsedLanes) {
    const h = lane.yMax - lane.yMin;
    assertEquals(
      h,
      COLLAPSED_LANE_HEIGHT,
      `Collapsed lane "${lane.componentId}" has height ${h}, expected ${COLLAPSED_LANE_HEIGHT}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Non-collapsed lane height = LANE_PADDING_TOP + n × LANE_NODE_SPACING + LANE_PADDING_BOTTOM
// ---------------------------------------------------------------------------

Deno.test("non-collapsed lane height matches formula for its node count", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();
  const model = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  // Count actual nodes per lane in the sigma graph.
  const nodeCountByLane = new Map<string, number>();
  model.graph.forEachNode((key: string) => {
    const anchor = anchorage.get(key);
    const cid = anchor
      ? (anchor.target === "assembly" ? "assembly" : anchor.target)
      : "assembly";
    nodeCountByLane.set(cid, (nodeCountByLane.get(cid) ?? 0) + 1);
  });

  for (const lane of model.lanes) {
    if (lane.collapsed) continue;
    const n = nodeCountByLane.get(lane.componentId) ?? 0;
    const expectedH = LANE_PADDING_TOP + Math.max(1, n) * LANE_NODE_SPACING +
      LANE_PADDING_BOTTOM;
    const actualH = lane.yMax - lane.yMin;
    assertEquals(
      actualH,
      expectedH,
      `Lane "${lane.componentId}" (${n} nodes): height ${actualH} ≠ ${expectedH}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. x positions unchanged from dagre (causal flow preserved)
// ---------------------------------------------------------------------------

Deno.test("x positions in corridor model match dagre Exploration model", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();

  // Build exploration model (pure dagre, no y reassignment).
  const exploration = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );

  // Build corridor model (dagre x kept, y reassigned).
  const corridor = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  // Every node present in both models must have the same x.
  exploration.graph.forEachNode((key: string) => {
    if (!corridor.graph.hasNode(key)) return;
    const xExploration = exploration.graph.getNodeAttribute(key, "x") as number;
    const xCorridor = corridor.graph.getNodeAttribute(key, "x") as number;
    assertEquals(
      xExploration,
      xCorridor,
      `Node ${key}: x in Exploration (${xExploration}) ≠ x in corridor (${xCorridor})`,
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Collapsed lane nodes are smaller (size ≤ 4)
// ---------------------------------------------------------------------------

Deno.test("nodes in collapsed lanes are rendered small (size ≤ 4)", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();
  const model = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  const collapsedCids = new Set(
    model.lanes.filter((l) => l.collapsed).map((l) => l.componentId),
  );
  if (collapsedCids.size === 0) return; // no collapsed lanes in fixture — skip

  model.graph.forEachNode((key: string) => {
    const anchor = anchorage.get(key);
    const cid = anchor
      ? (anchor.target === "assembly" ? "assembly" : anchor.target)
      : "assembly";
    if (!collapsedCids.has(cid)) return;
    const size = model.graph.getNodeAttribute(key, "size") as number;
    assertEquals(
      size <= 4,
      true,
      `Collapsed lane node ${key} has size ${size} > 4`,
    );
  });
});

// ---------------------------------------------------------------------------
// 9. hiddenSupportingCount propagated correctly from Exploration model
// ---------------------------------------------------------------------------

Deno.test("hiddenSupportingCount equals the Exploration model value", () => {
  const { evidenceModel, projection, anchorage, rows } = buildFixture();

  const exploration = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );
  const corridor = buildPartLaneGraphModel(
    evidenceModel,
    projection,
    anchorage,
    rows,
    FALLBACK_TOKENS,
  );

  assertEquals(
    corridor.hiddenSupportingCount,
    exploration.hiddenSupportingCount,
    "hiddenSupportingCount must match the Exploration model",
  );
});
