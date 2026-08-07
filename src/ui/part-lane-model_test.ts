/**
 * Tests for part-lane-model.ts
 *
 * Fixture topology derived from the real CM-01 V3 projection (same structural
 * source as part-anchorage-model_test.ts, extended with boiler and uncategorized
 * nodes to exercise the collapse threshold and the uncategorized counter).
 *
 * Invariants under test:
 *  1. Every visible node in the projection appears in exactly one (row, station)
 *     position in the layout.
 *  2. DripTray row is dense (factCount > 2 OR proofCount > 0) → not collapsed.
 *  3. Boiler row has factCount <= 2 AND proofCount === 0 → collapsed with reason.
 *  4. Assembly row is never collapsed even when sparse.
 *  5. Uncategorized nodes are counted and placed in the "uncategorized" station.
 *  6. Layout is deterministic: two calls on the same inputs yield identical maps.
 *  7. buildStationAssignment assigns correct stations to known prefixes.
 *  8. Cross-row edges are flagged; same-row edges are not.
 */

import { assertEquals, assertGreater } from "@std/assert";
import { buildPartAnchorage } from "./src/thread/part-anchorage-model.ts";
import {
  buildPartLaneLayout,
  buildStationAssignment,
  COLLAPSED_FACT_THRESHOLD,
  STATION_COLUMNS,
} from "./src/thread/part-lane-model.ts";
import type {
  ThreadComponentCatalog,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";
import type { EvidenceCanvasProjection } from "./src/thread/evidence-canvas-model.ts";
import type { EvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";

// ---------------------------------------------------------------------------
// Stable IDs (same as part-anchorage-model_test.ts)
// ---------------------------------------------------------------------------

const R3_DIGEST = "8484b759a788c018477f062863aff5f5a3ebaf06d28c5045534fb716c19d58f3";
const R3 = `coffee-machine-cm01-v3-cad-r3-${R3_DIGEST}`;

const MECH_R3_PROOF_ID =
  "coffee-machine-cm01-v3-mechanical-r3-ec23ad25f52a9a467bfc8e8fa07e62ee8da1efb48c570c0554c1066b21d48297-proof";
const ORACLE_REQ_ID =
  "oracle-requirements-944e2515fb349d631e9aa4d85a3b9394420990c9610d5dfff8c290f032d633e3";
const SENS_REL_ID =
  "sensitivity-relations-5e5f8384c2ca67297de6ccfa56d89a200b521f021459eefc711dc7e2dcec1a51";
const DT_PRINTABILITY_ID = "drip-tray-printability-abc123-capture";
const DT_PRINT_EST_ID = "drip-tray-print-estimate-def456-step";
const DT_SENS_ID =
  "drip-tray-sensitivity-bacc1c4ef2c0154ca71e72bf4e517290ce2c30aedb4702f724c3cf89d2cadc7e-capture";
const ERPNEXT_BOM_ID = "erpnext-bom-quantity-deadbeef01";
const MODELICA_ID = "modelica-run-c5969d95-db98-41a0-9109-facf9bd7a7a4-scenario-5";
const REQUIREMENT_ID = "req-mechanical-strength-001";
const EVALUATION_ID = "eval-drip-tray-displacement-r3";
const VIOLATION_ID = "violation-drip-tray-overflow-r1";
const OBSERVATION_ID = "obs-drip-tray-weight-r3";
const UNCATEGORIZED_ID = "unknown-origin-artifact-xyz";

// Boiler artifacts — thin component, should collapse.
// IDs deliberately chosen to NOT match any server-fixed prefix or nature rule
// so they reach the catalog criterion (a) only, anchored via explicit binding
// on the boiler component in FIXTURE_CATALOG.
const BOILER_ARTIFACT_1 = "boiler-test-cad-step-001";
const BOILER_ARTIFACT_2 = "boiler-test-cad-step-002";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function node(
  id: string,
  kind: ThreadGraphRef["kind"],
  opts: {
    artifactKind?: string;
    system?: string;
  } = {},
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(opts.artifactKind !== undefined ? { artifactKind: opts.artifactKind } : {}),
    label: id.slice(-30),
    system: opts.system ?? "digital-thread",
    freshness: "fresh",
    summary: `${kind} · ${id.slice(-30)}`,
  };
}

function edge(
  id: string,
  fromKind: ThreadGraphRef["kind"],
  fromId: string,
  toKind: ThreadGraphRef["kind"],
  toId: string,
): ThreadGraphEdge {
  return {
    id,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation: "derived_from",
    rationale: id,
    origin: "provenance",
  };
}

function catalogBinding(
  evidenceArtifactId: string,
  provider: "syson" | "build123d" | "digital-thread" | "erpnext" = "build123d",
) {
  return {
    provider,
    kind: "artifact" as const,
    id: evidenceArtifactId,
    label: evidenceArtifactId.slice(-24),
    evidenceArtifactId,
    status: "verified" as const,
  };
}

// ---------------------------------------------------------------------------
// Representative fixture
//
// Nodes:
//  Assembly row (via prefix b-2, b-5, b-6, b-8-plan, nature-thermal, nature-bom):
//    - ORACLE_REQ_ID         artifact (sysml-model, syson)    → model
//    - SENS_REL_ID           artifact (sysml-model, syson)    → model
//    - ERPNEXT_BOM_ID        artifact (bom)                   → industrialization
//    - R3-plan               artifact (document)              → geometry (via catalog)
//    - MODELICA_ID           artifact (evidence, mcp-modelica)→ verification (thermal)
//    - REQUIREMENT_ID        requirement                      → requirements
//
//  DripTray row (dense, via prefix b-10 + b-13 + b-14 + b-15):
//    - MECH_R3_PROOF_ID      artifact                         → verification
//    - DT_SENS_ID            artifact                         → verification
//    - DT_PRINTABILITY_ID    artifact                         → observations
//    - DT_PRINT_EST_ID       artifact                         → industrialization
//    - EVALUATION_ID         evaluation                       → verification
//    - VIOLATION_ID          violation                        → verification
//    - OBSERVATION_ID        observation                      → observations
//
//  Boiler row (thin, should collapse — exactly 2 facts, 0 proofs):
//    - BOILER_ARTIFACT_1     artifact (catalog binding → boiler) → geometry
//    - BOILER_ARTIFACT_2     artifact (catalog binding → boiler) → geometry
//
//  Uncategorized:
//    - UNCATEGORIZED_ID      artifact (no matching rule)      → uncategorized
//
//  Cross-row edge:
//    MECH_R3_PROOF_ID (drip-tray) → EVALUATION_ID (drip-tray) — same row
//    REQUIREMENT_ID (assembly) → EVALUATION_ID (drip-tray) — cross row
// ---------------------------------------------------------------------------

const FIXTURE_NODES: ThreadGraphNode[] = [
  // Assembly — model station
  node(ORACLE_REQ_ID, "artifact", {
    artifactKind: "sysml-model",
    system: "syson",
  }),
  node(SENS_REL_ID, "artifact", {
    artifactKind: "sysml-model",
    system: "syson",
  }),
  // Assembly — industrialization (bom kind, not anchored by prefix but by nature)
  node(ERPNEXT_BOM_ID, "artifact", {
    artifactKind: "bom",
    system: "digital-thread",
  }),
  // Assembly — geometry (via catalog binding in FIXTURE_CATALOG)
  node(`${R3}-plan`, "artifact", {
    artifactKind: "document",
    system: "digital-thread",
  }),
  // Assembly — verification (thermal)
  node(MODELICA_ID, "artifact", {
    artifactKind: "evidence",
    system: "mcp-modelica",
  }),
  // Assembly — requirements
  node(REQUIREMENT_ID, "requirement", {}),
  // DripTray — verification mechanical
  node(MECH_R3_PROOF_ID, "artifact", { artifactKind: "document" }),
  node(DT_SENS_ID, "artifact", { artifactKind: "document" }),
  // DripTray — observations
  node(DT_PRINTABILITY_ID, "artifact", { artifactKind: "document" }),
  node(OBSERVATION_ID, "observation", {}),
  // DripTray — industrialization
  node(DT_PRINT_EST_ID, "artifact", { artifactKind: "step" }),
  // DripTray — verification (proof nodes)
  node(EVALUATION_ID, "evaluation", {}),
  node(VIOLATION_ID, "violation", {}),
  // Boiler — geometry (thin, collapse threshold).
  // Use artifactKind "step" + system "build123d" so no nature rule fires
  // (sysml-model / bom / document would anchor to assembly via nature criterion).
  // The catalog binds these to the boiler component explicitly (criterion a).
  node(BOILER_ARTIFACT_1, "artifact", {
    artifactKind: "step",
    system: "build123d",
  }),
  node(BOILER_ARTIFACT_2, "artifact", {
    artifactKind: "step",
    system: "build123d",
  }),
  // Uncategorized
  node(UNCATEGORIZED_ID, "artifact", { artifactKind: "other" }),
];

const FIXTURE_EDGES: ThreadGraphEdge[] = [
  // Same-row: drip-tray artifact → drip-tray evaluation (both prefix-anchored to drip-tray)
  edge(
    "e-mech-eval",
    "artifact",
    MECH_R3_PROOF_ID,
    "evaluation",
    EVALUATION_ID,
  ),
  // Cross-row: oracle-requirements (prefix b-2 → assembly) → mechanical-r3 proof
  //            (prefix b-10 → drip-tray). Both are prefix-anchored; no adjacency
  //            inheritance can change their rows.
  edge(
    "e-oracle-mech",
    "artifact",
    ORACLE_REQ_ID,
    "artifact",
    MECH_R3_PROOF_ID,
  ),
  // Same-component adjacency: requirement anchored by propagation (any adjacent)
  edge(
    "e-req-eval",
    "requirement",
    REQUIREMENT_ID,
    "evaluation",
    EVALUATION_ID,
  ),
];

const FIXTURE_GRAPH: ThreadGraph = {
  nodes: FIXTURE_NODES,
  edges: FIXTURE_EDGES,
};

// Catalog: assembly gets R3-plan (geometry); drip-tray and enclosure get
// their own entries; boiler is a separate part with thin evidence.
const FIXTURE_CATALOG: ThreadComponentCatalog = {
  schemaVersion: "thread-components/1.0",
  authority: "workspace-declared",
  subjectId: "project:coffee-machine-cm01-v3",
  rationale: "Part-lane-model test fixture (2026-08-07).",
  systemViews: {},
  components: [
    {
      id: "cm01-v3:coffee-machine",
      label: "CoffeeMachine",
      kind: "assembly",
      quantity: 1,
      bindings: [
        catalogBinding(`${R3}-plan`, "digital-thread"),
      ],
    },
    {
      id: "cm01-v3:drip-tray",
      label: "DripTray",
      kind: "part",
      quantity: 1,
      parentId: "cm01-v3:coffee-machine",
      bindings: [],
    },
    {
      id: "cm01-v3:boiler",
      label: "Boiler",
      kind: "part",
      quantity: 1,
      parentId: "cm01-v3:coffee-machine",
      // Explicit catalog bindings: route BOILER_ARTIFACT_1/2 to the boiler row
      // via criterion (a) so the test genuinely exercises "2 facts, 0 proofs".
      bindings: [
        catalogBinding(BOILER_ARTIFACT_1, "build123d"),
        catalogBinding(BOILER_ARTIFACT_2, "build123d"),
      ],
    },
    {
      id: "cm01-v3:enclosure",
      label: "Enclosure",
      kind: "part",
      quantity: 1,
      parentId: "cm01-v3:coffee-machine",
      bindings: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Minimal EvidenceGraphModel stub (not used by buildPartLaneLayout directly;
// passed as first arg but only the edge set from projection is read).
// ---------------------------------------------------------------------------

// STUB_EVIDENCE_MODEL is defined after FIXTURE_EDGES to pick up the final edge count.
function makeStubModel(): EvidenceGraphModel {
  return {
    nodes: FIXTURE_NODES,
    edges: FIXTURE_EDGES,
    stubs: [],
    components: [],
    rawNodeCount: FIXTURE_NODES.length,
    rawEdgeCount: FIXTURE_EDGES.length,
    componentOf: () => undefined,
    boundedNeighborhood: () => ({ nodes: [], edges: [] }),
  };
}

const STUB_EVIDENCE_MODEL: EvidenceGraphModel = makeStubModel();

// EvidenceCanvasProjection — all fixture nodes visible (no filtering for tests).
function makeProjection(
  nodes: ThreadGraphNode[] = FIXTURE_NODES,
  edges: ThreadGraphEdge[] = FIXTURE_EDGES,
): EvidenceCanvasProjection {
  return {
    nodes,
    edges,
    displayedCount: nodes.length,
    foldedInstrumentCount: 0,
    isFiltered: false,
    supportingNodeCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Pre-compute anchorage and station maps (shared across tests)
// ---------------------------------------------------------------------------

const ANCHORAGE = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
const STATION_MAP = buildStationAssignment(FIXTURE_GRAPH);
const PROJECTION = makeProjection();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "every visible node appears in exactly one position in the layout",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    const seen = new Set<string>();
    for (const [nodeKey] of layout.facts) {
      seen.add(nodeKey);
    }

    for (const node of FIXTURE_NODES) {
      const key = `${node.ref.kind}:${node.ref.id}`;
      assertEquals(
        seen.has(key),
        true,
        `node ${key} must appear in the layout`,
      );
    }
    assertEquals(
      layout.facts.size,
      FIXTURE_NODES.length,
      "layout.facts must contain exactly one entry per visible node",
    );
  },
);

Deno.test(
  "DripTray row is not collapsed (dense: proofCount > 0)",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    const dripTrayRow = layout.rows.find((r) => r.componentId === "cm01-v3:drip-tray");
    assertEquals(dripTrayRow !== undefined, true, "drip-tray row must exist");
    assertEquals(
      dripTrayRow!.collapsed,
      false,
      "drip-tray must not be collapsed",
    );
    assertGreater(
      dripTrayRow!.proofCount,
      0,
      "drip-tray must have proof nodes",
    );
  },
);

Deno.test(
  `Boiler row is collapsed: <= ${COLLAPSED_FACT_THRESHOLD} facts and 0 proofs`,
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    const boilerRow = layout.rows.find((r) => r.componentId === "cm01-v3:boiler");
    assertEquals(boilerRow !== undefined, true, "boiler row must exist");
    assertEquals(boilerRow!.collapsed, true, "boiler must be collapsed");
    assertEquals(
      boilerRow!.proofCount,
      0,
      "boiler must have zero proof nodes",
    );
    // The fixture has exactly 2 boiler artifacts (catalog criterion a).
    // This also asserts the threshold arithmetic: 2 == COLLAPSED_FACT_THRESHOLD.
    assertEquals(
      boilerRow!.factCount,
      2,
      "boiler must have exactly 2 facts (the two catalog-bound step artifacts)",
    );
    assertEquals(
      boilerRow!.factCount <= COLLAPSED_FACT_THRESHOLD,
      true,
      `boiler factCount (${
        boilerRow!.factCount
      }) must be <= threshold (${COLLAPSED_FACT_THRESHOLD})`,
    );
    assertEquals(
      typeof boilerRow!.collapseReason,
      "string",
      "collapsed row must carry a collapseReason string",
    );
  },
);

Deno.test(
  "assembly row is never collapsed even when sparse",
  () => {
    // Build a projection with only 1 assembly fact.
    const sparseAssemblyGraph: ThreadGraph = {
      nodes: [
        node(ORACLE_REQ_ID, "artifact", {
          artifactKind: "sysml-model",
          system: "syson",
        }),
      ],
      edges: [],
    };
    const sparseAnchorage = buildPartAnchorage(
      sparseAssemblyGraph,
      FIXTURE_CATALOG,
    );
    const sparseStations = buildStationAssignment(sparseAssemblyGraph);
    const sparseProjection = makeProjection(sparseAssemblyGraph.nodes, []);

    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      sparseProjection,
      sparseAnchorage,
      sparseStations,
      FIXTURE_CATALOG,
    );

    const assemblyRow = layout.rows.find((r) => r.componentId === "assembly");
    assertEquals(
      assemblyRow !== undefined,
      true,
      "assembly row must always exist",
    );
    assertEquals(
      assemblyRow!.collapsed,
      false,
      "assembly must never be collapsed",
    );
  },
);

Deno.test(
  "assembly row is always first in the sorted row list",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    assertEquals(
      layout.rows[0]!.componentId,
      "assembly",
      "assembly must be the first row",
    );
  },
);

Deno.test(
  "uncategorized nodes are counted in counters.uncategorizedCount",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    // UNCATEGORIZED_ID has artifactKind "other" and no matching prefix.
    // It should land in the "uncategorized" station.
    const uncatKey = `artifact:${UNCATEGORIZED_ID}`;
    const fact = layout.facts.get(uncatKey);
    assertEquals(
      fact?.station,
      "uncategorized",
      `${UNCATEGORIZED_ID} must be placed in the uncategorized station`,
    );
    assertGreater(
      layout.counters.uncategorizedCount,
      0,
      "uncategorizedCount must be > 0",
    );
  },
);

Deno.test(
  "layout is deterministic — two calls on the same inputs yield identical results",
  () => {
    const layout1 = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );
    const layout2 = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    assertEquals(
      layout1.facts.size,
      layout2.facts.size,
      "fact map sizes must match",
    );
    assertEquals(
      layout1.rows.length,
      layout2.rows.length,
      "row counts must match",
    );
    assertEquals(
      layout1.edges.length,
      layout2.edges.length,
      "edge counts must match",
    );

    for (const [key, fact1] of layout1.facts) {
      const fact2 = layout2.facts.get(key);
      assertEquals(
        fact2?.componentId,
        fact1.componentId,
        `componentId for ${key} must be stable`,
      );
      assertEquals(
        fact2?.station,
        fact1.station,
        `station for ${key} must be stable`,
      );
      assertEquals(
        fact2?.stackIndex,
        fact1.stackIndex,
        `stackIndex for ${key} must be stable`,
      );
    }

    for (let i = 0; i < layout1.rows.length; i++) {
      assertEquals(
        layout1.rows[i]!.componentId,
        layout2.rows[i]!.componentId,
        `row order must be stable at index ${i}`,
      );
    }
  },
);

Deno.test(
  "cross-row edge between assembly and drip-tray is flagged crossesRows=true",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    // e-oracle-mech: oracle-requirements artifact (prefix b-2 => assembly row)
    //                → mechanical-r3 proof artifact (prefix b-10 => drip-tray row)
    // Both nodes are independently prefix-anchored so adjacency cannot change their rows.
    const crossEdge = layout.edges.find((e) => e.id === "e-oracle-mech");
    assertEquals(
      crossEdge !== undefined,
      true,
      "cross-row edge e-oracle-mech must be present",
    );
    assertEquals(
      crossEdge!.crossesRows,
      true,
      "e-oracle-mech crosses assembly and drip-tray rows — must be flagged",
    );
  },
);

Deno.test(
  "same-row edge within drip-tray is flagged crossesRows=false",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    // e-mech-eval: artifact:MECH_R3_PROOF_ID → evaluation:EVALUATION_ID
    // Both should be anchored to cm01-v3:drip-tray.
    const sameRowEdge = layout.edges.find((e) => e.id === "e-mech-eval");
    assertEquals(
      sameRowEdge !== undefined,
      true,
      "same-row edge e-mech-eval must be present",
    );
    assertEquals(
      sameRowEdge!.crossesRows,
      false,
      "e-mech-eval stays within drip-tray row — must not be flagged",
    );
  },
);

// ---------------------------------------------------------------------------
// Station assignment unit tests
// ---------------------------------------------------------------------------

Deno.test(
  "buildStationAssignment — requirement node → requirements station",
  () => {
    const stations = buildStationAssignment({
      nodes: [node(REQUIREMENT_ID, "requirement", {})],
      edges: [],
    });
    assertEquals(
      stations.get(`requirement:${REQUIREMENT_ID}`)?.station,
      "requirements",
    );
  },
);

Deno.test(
  "buildStationAssignment — evaluation node → verification/mechanical",
  () => {
    const stations = buildStationAssignment({
      nodes: [node(EVALUATION_ID, "evaluation", {})],
      edges: [],
    });
    const assignment = stations.get(`evaluation:${EVALUATION_ID}`);
    assertEquals(assignment?.station, "verification");
    assertEquals(assignment?.subcategory, "mechanical");
  },
);

Deno.test(
  "buildStationAssignment — oracle-requirements artifact → model station",
  () => {
    const stations = buildStationAssignment({
      nodes: [
        node(ORACLE_REQ_ID, "artifact", {
          artifactKind: "sysml-model",
          system: "syson",
        }),
      ],
      edges: [],
    });
    assertEquals(
      stations.get(`artifact:${ORACLE_REQ_ID}`)?.station,
      "model",
    );
  },
);

Deno.test(
  "buildStationAssignment — sensitivity-relations artifact → model station",
  () => {
    const stations = buildStationAssignment({
      nodes: [
        node(SENS_REL_ID, "artifact", {
          artifactKind: "sysml-model",
          system: "syson",
        }),
      ],
      edges: [],
    });
    assertEquals(
      stations.get(`artifact:${SENS_REL_ID}`)?.station,
      "model",
    );
  },
);

Deno.test(
  "buildStationAssignment — mechanical-r3 artifact → verification/mechanical",
  () => {
    const stations = buildStationAssignment({
      nodes: [node(MECH_R3_PROOF_ID, "artifact", { artifactKind: "document" })],
      edges: [],
    });
    const assignment = stations.get(`artifact:${MECH_R3_PROOF_ID}`);
    assertEquals(assignment?.station, "verification");
    assertEquals(assignment?.subcategory, "mechanical");
  },
);

Deno.test(
  "buildStationAssignment — drip-tray-printability artifact → observations",
  () => {
    const stations = buildStationAssignment({
      nodes: [
        node(DT_PRINTABILITY_ID, "artifact", { artifactKind: "document" }),
      ],
      edges: [],
    });
    assertEquals(
      stations.get(`artifact:${DT_PRINTABILITY_ID}`)?.station,
      "observations",
    );
  },
);

Deno.test(
  "buildStationAssignment — drip-tray-print-estimate artifact → industrialization",
  () => {
    const stations = buildStationAssignment({
      nodes: [node(DT_PRINT_EST_ID, "artifact", { artifactKind: "step" })],
      edges: [],
    });
    assertEquals(
      stations.get(`artifact:${DT_PRINT_EST_ID}`)?.station,
      "industrialization",
    );
  },
);

Deno.test(
  "buildStationAssignment — erpnext-bom artifact → industrialization",
  () => {
    const stations = buildStationAssignment({
      nodes: [
        node(ERPNEXT_BOM_ID, "artifact", {
          artifactKind: "bom",
          system: "erpnext",
        }),
      ],
      edges: [],
    });
    assertEquals(
      stations.get(`artifact:${ERPNEXT_BOM_ID}`)?.station,
      "industrialization",
    );
  },
);

Deno.test(
  "buildStationAssignment — Modelica artifact → verification/thermal (nature criterion)",
  () => {
    const stations = buildStationAssignment({
      nodes: [
        node(MODELICA_ID, "artifact", {
          artifactKind: "evidence",
          system: "mcp-modelica",
        }),
      ],
      edges: [],
    });
    const assignment = stations.get(`artifact:${MODELICA_ID}`);
    assertEquals(assignment?.station, "verification");
    assertEquals(assignment?.subcategory, "thermal");
  },
);

Deno.test(
  "buildStationAssignment — drip-tray-sensitivity artifact → verification/mechanical",
  () => {
    const stations = buildStationAssignment({
      nodes: [node(DT_SENS_ID, "artifact", { artifactKind: "document" })],
      edges: [],
    });
    const assignment = stations.get(`artifact:${DT_SENS_ID}`);
    assertEquals(assignment?.station, "verification");
    assertEquals(assignment?.subcategory, "mechanical");
  },
);

Deno.test(
  "buildStationAssignment — unknown artifact → uncategorized",
  () => {
    const stations = buildStationAssignment({
      nodes: [node(UNCATEGORIZED_ID, "artifact", { artifactKind: "other" })],
      edges: [],
    });
    assertEquals(
      stations.get(`artifact:${UNCATEGORIZED_ID}`)?.station,
      "uncategorized",
    );
  },
);

Deno.test(
  "counters.totalFacts equals projection node count",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );
    assertEquals(
      layout.counters.totalFacts,
      FIXTURE_NODES.length,
      "totalFacts must equal the number of projected nodes",
    );
  },
);

Deno.test(
  "STATION_COLUMNS contains exactly the 7 expected station names",
  () => {
    const expected = [
      "requirements",
      "model",
      "geometry",
      "verification",
      "observations",
      "industrialization",
      "uncategorized",
    ];
    assertEquals(
      [...STATION_COLUMNS],
      expected,
      "STATION_COLUMNS must match the canonical station vocabulary",
    );
  },
);

Deno.test(
  "stackIndex values within each cell are 0-based and contiguous",
  () => {
    const layout = buildPartLaneLayout(
      STUB_EVIDENCE_MODEL,
      PROJECTION,
      ANCHORAGE,
      STATION_MAP,
      FIXTURE_CATALOG,
    );

    // Collect stackIndex values per (componentId, station) cell.
    const cellStacks = new Map<string, number[]>();
    for (const fact of layout.facts.values()) {
      const cellKey = `${fact.componentId}:${fact.station}`;
      const stack = cellStacks.get(cellKey) ?? [];
      stack.push(fact.stackIndex);
      cellStacks.set(cellKey, stack);
    }

    for (const [cellKey, indices] of cellStacks) {
      const sorted = [...indices].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        assertEquals(
          sorted[i],
          i,
          `cell ${cellKey} must have contiguous 0-based stackIndex values`,
        );
      }
    }
  },
);
