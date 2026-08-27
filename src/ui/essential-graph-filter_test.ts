/**
 * Tests for essential-graph-filter.ts
 *
 * Invariants under test:
 * 1. isSupportingNode — structural predicate correctness per entityKind/artifactKind.
 * 2. applyEssentialFilter — supporting nodes removed from display.
 * 3. applyEssentialFilter — connector preservation: supporting node on sole path between
 *    two essential nodes is kept so no false island appears.
 * 4. applyEssentialFilter — essential nodes are never removed.
 * 5. applyEssentialFilter — hiddenCount reflects only actually removed nodes.
 * 6. applyEssentialFilter — edges whose endpoints are both visible survive.
 * 7. Integration with EvidenceCanvasProjection: supportingNodeCount truthful.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  applyEssentialFilter,
  isDisplayKindVisible,
  isSupportingNode,
  SUPPORTING_ARTIFACT_KINDS,
} from "./src/thread/essential-graph-filter.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import { buildEvidenceCanvasProjection } from "./src/thread/evidence-canvas-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_FAMILY: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "test", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

function ref(id: string, kind: ThreadGraphRef["kind"]): ThreadGraphRef {
  return { kind, id };
}

function artifactNode(
  id: string,
  artifactKind: string,
  system = "build123d",
): ThreadGraphNode {
  return {
    id,
    ref: ref(id, "artifact"),
    label: `Label ${id}`,
    summary: `Summary ${id}`,
    system,
    entityKind: "artifact",
    artifactKind,
    freshness: "fresh",
    selection: undefined,
  };
}

function changeNode(id: string): ThreadGraphNode {
  return {
    id,
    ref: ref(id, "change"),
    label: `Change ${id}`,
    summary: `Summary ${id}`,
    system: "digital-thread",
    entityKind: "change",
    freshness: "fresh",
    selection: undefined,
  };
}

function requirementNode(id: string): ThreadGraphNode {
  return {
    id,
    ref: ref(id, "requirement"),
    label: `Req ${id}`,
    summary: `Summary ${id}`,
    system: "syson",
    entityKind: "requirement",
    freshness: "fresh",
    selection: undefined,
  };
}

function observationNode(id: string): ThreadGraphNode {
  return {
    id,
    ref: ref(id, "observation"),
    label: `Obs ${id}`,
    summary: `Summary ${id}`,
    system: "calculix",
    entityKind: "observation",
    freshness: "fresh",
    selection: undefined,
  };
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

// ---------------------------------------------------------------------------
// 1. isSupportingNode — structural predicate
// ---------------------------------------------------------------------------

Deno.test("isSupportingNode: consumption entityKind is always supporting", () => {
  const node: ThreadGraphNode = {
    id: "c1",
    ref: ref("c1", "artifact"),
    label: "C1",
    summary: "S",
    system: "digital-thread",
    entityKind: "consumption",
    freshness: "fresh",
    selection: undefined,
  };
  assertEquals(isSupportingNode(node), true);
});

Deno.test("isSupportingNode: change entityKind is always supporting", () => {
  assertEquals(isSupportingNode(changeNode("chg-1")), true);
});

Deno.test("isSupportingNode: artifact with supporting artifactKind is supporting", () => {
  for (const kind of SUPPORTING_ARTIFACT_KINDS) {
    assertEquals(
      isSupportingNode(artifactNode("a", kind)),
      true,
      `artifactKind "${kind}" should be supporting`,
    );
  }
});

Deno.test("isSupportingNode: requirement is essential (never supporting)", () => {
  assertEquals(isSupportingNode(requirementNode("req-1")), false);
});

Deno.test("isSupportingNode: observation is essential (never supporting)", () => {
  assertEquals(isSupportingNode(observationNode("obs-1")), false);
});

Deno.test("isSupportingNode keeps SysML PartDefinition, PartUsage and AttributeUsage nodes essential", () => {
  for (
    const kind of [
      "part-definition",
      "part-usage",
      "attribute-usage",
      "cad-lever",
      "cad-unnamed-literal",
    ] as const
  ) {
    const node: ThreadGraphNode = {
      id: `graph:${kind}:element`,
      ref: ref("element", kind),
      label: kind,
      summary: kind,
      system: "syson",
      entityKind: kind,
      freshness: "fresh",
    };
    assertEquals(isSupportingNode(node), false);
  }
});

Deno.test("isDisplayKindVisible keeps a missing kind visible", () => {
  const node: ThreadGraphNode = {
    id: "graph:cad-lever:thickness",
    ref: ref("thickness", "cad-lever"),
    label: "CAD · thickness = 5",
    summary: "named numeric lever · unit undeclared",
    system: "build123d",
    entityKind: "cad-lever",
    freshness: "fresh",
  };
  const kinds = {
    artifact: true,
    "supporting-artifact": false,
    observation: true,
    requirement: true,
    evaluation: true,
    "study-base-evaluation": true,
    violation: true,
    change: false,
    consumption: false,
    action: true,
    analysis: true,
    "sysml-element": true,
  } as Record<string, boolean>;
  assertEquals(isDisplayKindVisible(kinds as never, node), true);
  assertEquals(
    isDisplayKindVisible({ ...kinds, "cad-lever": false } as never, node),
    false,
  );
});

Deno.test("isSupportingNode: artifact with non-supporting artifactKind is essential", () => {
  assertEquals(isSupportingNode(artifactNode("a", "step", "calculix")), false);
  assertEquals(isSupportingNode(artifactNode("a", "stl", "build123d")), false);
  assertEquals(isSupportingNode(artifactNode("a", "glb", "build123d")), false);
});

// ---------------------------------------------------------------------------
// 2. applyEssentialFilter — supporting nodes removed from display
// ---------------------------------------------------------------------------

Deno.test(
  "applyEssentialFilter: script artifact (supporting) is hidden when not a connector",
  () => {
    // REQ --input_to--> SCRIPT --source_of--> OBS
    // SCRIPT and REQ are not in the same chain through SCRIPT only;
    // REQ is essential, OBS is essential, SCRIPT is supporting.
    // BUT SCRIPT IS the sole connector → it must stay.
    // Test with no connection between REQ and OBS except through SCRIPT.
    const req = requirementNode("REQ");
    const script = artifactNode("SCRIPT", "script");
    const obs = observationNode("OBS");

    const nodes = [req, script, obs];
    const edges = [
      edge("e1", req.ref, script.ref, "input_to"),
      edge("e2", script.ref, obs.ref, "source_of"),
    ];

    const result = applyEssentialFilter(nodes, edges);
    // SCRIPT is the sole path between REQ and OBS → preserved.
    const ids = result.nodes.map((n) => n.ref.id).sort();
    assertEquals(ids, ["OBS", "REQ", "SCRIPT"]);
    assertEquals(result.hiddenCount, 0);
    assertEquals(result.supportingCount, 1);
  },
);

Deno.test(
  "applyEssentialFilter: mesh artifact is hidden when essential nodes connect directly",
  () => {
    // REQ --input_to--> OBS (direct)
    // REQ --input_to--> MESH (dead-end, no connection to OBS through it)
    const req = requirementNode("REQ");
    const obs = observationNode("OBS");
    const mesh = artifactNode("MESH", "mesh");

    const nodes = [req, obs, mesh];
    const edges = [
      edge("e1", req.ref, obs.ref, "input_to"),
      edge("e2", req.ref, mesh.ref, "input_to"), // mesh is a dead end here
    ];

    const result = applyEssentialFilter(nodes, edges);
    // MESH is a dead end (no path from MESH to another essential node beyond REQ
    // which is already connected to OBS directly).
    // Actually: shortest path between REQ and OBS doesn't use MESH.
    // REQ and MESH don't have another essential node to bridge.
    // So MESH is hidden.
    const ids = result.nodes.map((n) => n.ref.id).sort();
    assertEquals(ids, ["OBS", "REQ"]);
    assertEquals(result.hiddenCount, 1);
  },
);

// ---------------------------------------------------------------------------
// 3. applyEssentialFilter — connector preservation (the key invariant)
// ---------------------------------------------------------------------------

Deno.test(
  "applyEssentialFilter: supporting node on sole path between two essential nodes is preserved",
  () => {
    // REQ --input_to--> SCRIPT --source_of--> OBS2
    // The only path REQ→OBS2 is through SCRIPT → SCRIPT must be kept.
    const req = requirementNode("REQ");
    const script = artifactNode("SCRIPT", "script");
    const obs = observationNode("OBS");

    const nodes = [req, script, obs];
    const edges = [
      edge("e1", req.ref, script.ref, "input_to"),
      edge("e2", script.ref, obs.ref, "source_of"),
    ];

    const result = applyEssentialFilter(nodes, edges);
    const ids = result.nodes.map((n) => n.ref.id).sort();
    assertEquals(ids, ["OBS", "REQ", "SCRIPT"], "Connector must be preserved");
    assertEquals(result.hiddenCount, 0);
  },
);

Deno.test(
  "applyEssentialFilter: change node on sole path between two essential nodes is preserved",
  () => {
    // OBS1 --changes--> CHG --changes--> REQ
    const obs1 = observationNode("OBS1");
    const chg = changeNode("CHG");
    const req = requirementNode("REQ");

    const nodes = [obs1, chg, req];
    const edges = [
      edge("e1", obs1.ref, chg.ref, "changes"),
      edge("e2", chg.ref, req.ref, "changes"),
    ];

    const result = applyEssentialFilter(nodes, edges);
    const ids = result.nodes.map((n) => n.ref.id).sort();
    assertEquals(
      ids,
      ["CHG", "OBS1", "REQ"],
      "Change node connector must be preserved",
    );
  },
);

Deno.test(
  "applyEssentialFilter: an off-path change node folds away",
  () => {
    // OBS1 and REQ are directly linked; CHG hangs off OBS1 and is on no
    // essential-pair shortest path, so it is not a connector and folds.
    const obs1 = observationNode("OBS1");
    const chg = changeNode("CHG");
    const req = requirementNode("REQ");

    const nodes = [obs1, chg, req];
    const edges = [
      edge("e1", obs1.ref, req.ref, "input_to"),
      edge("e2", chg.ref, obs1.ref, "changes"),
    ];

    const result = applyEssentialFilter(nodes, edges);
    assertEquals(
      result.nodes.map((n) => n.ref.id).sort(),
      ["OBS1", "REQ"],
      "Off-path change must fold away",
    );
    assertEquals(result.hiddenCount, 1);
  },
);

Deno.test(
  "applyEssentialFilter: consumption node on sole path between two essential nodes is preserved",
  () => {
    // OBS1 --uses--> CONS --uses--> REQ : the consumption stays a fold target,
    // so the connector-preservation guarantee must hold through it.
    const obs1 = observationNode("OBS1");
    const cons: ThreadGraphNode = {
      id: "CONS",
      ref: ref("CONS", "consumption"),
      label: "Consumption CONS",
      summary: "S",
      system: "digital-thread",
      entityKind: "consumption",
      freshness: "fresh",
      selection: undefined,
    };
    const req = requirementNode("REQ");

    const nodes = [obs1, cons, req];
    const edges = [
      edge("e1", obs1.ref, cons.ref, "uses"),
      edge("e2", cons.ref, req.ref, "uses"),
    ];

    const result = applyEssentialFilter(nodes, edges);
    const ids = result.nodes.map((n) => n.ref.id).sort();
    assertEquals(
      ids,
      ["CONS", "OBS1", "REQ"],
      "Consumption connector must be preserved",
    );
  },
);

// ---------------------------------------------------------------------------
// 4. applyEssentialFilter — essential nodes are never removed
// ---------------------------------------------------------------------------

Deno.test(
  "applyEssentialFilter: requirement, observation, evaluation nodes are always kept",
  () => {
    const req = requirementNode("REQ");
    const obs = observationNode("OBS");
    const evaluation: ThreadGraphNode = {
      id: "EVAL",
      ref: ref("EVAL", "evaluation"),
      label: "Eval",
      summary: "S",
      system: "syson",
      entityKind: "evaluation",
      freshness: "fresh",
      selection: undefined,
    };

    const nodes = [req, obs, evaluation];
    const result = applyEssentialFilter(nodes, []);
    const ids = result.nodes.map((n) => n.ref.id).sort();
    assertEquals(ids, ["EVAL", "OBS", "REQ"]);
    assertEquals(result.hiddenCount, 0);
  },
);

// ---------------------------------------------------------------------------
// 5. applyEssentialFilter — hiddenCount reflects actually removed nodes
// ---------------------------------------------------------------------------

Deno.test(
  "applyEssentialFilter: hiddenCount is zero when all nodes are essential",
  () => {
    const req = requirementNode("REQ");
    const obs = observationNode("OBS");
    const result = applyEssentialFilter([req, obs], [
      edge("e1", req.ref, obs.ref),
    ]);
    assertEquals(result.hiddenCount, 0);
    assertEquals(result.supportingCount, 0);
  },
);

Deno.test(
  "applyEssentialFilter: hiddenCount counts only removed (not preserved connector) supporting nodes",
  () => {
    // Three supporting nodes: one is a dead-end (hidden), two are connectors (kept).
    const req1 = requirementNode("REQ1");
    const req2 = requirementNode("REQ2");
    const req3 = requirementNode("REQ3");
    // SCRIPT1 bridges REQ1 and REQ2 (sole path) → kept
    const script1 = artifactNode("S1", "script");
    // SCRIPT2 bridges REQ2 and REQ3 (sole path) → kept
    const script2 = artifactNode("S2", "script");
    // MESH is a dead end hanging off REQ1 → hidden
    const mesh = artifactNode("MESH", "mesh");

    const nodes = [req1, req2, req3, script1, script2, mesh];
    const edges = [
      edge("e1", req1.ref, script1.ref),
      edge("e2", script1.ref, req2.ref),
      edge("e3", req2.ref, script2.ref),
      edge("e4", script2.ref, req3.ref),
      edge("e5", req1.ref, mesh.ref), // dead end
    ];

    const result = applyEssentialFilter(nodes, edges);
    assertEquals(result.supportingCount, 3); // S1 + S2 + MESH
    assertEquals(result.hiddenCount, 1); // only MESH hidden
    assertEquals(
      result.nodes.find((n) => n.ref.id === "MESH"),
      undefined,
      "MESH must be hidden",
    );
    assertNotEquals(
      result.nodes.find((n) => n.ref.id === "S1"),
      undefined,
      "S1 must be kept",
    );
    assertNotEquals(
      result.nodes.find((n) => n.ref.id === "S2"),
      undefined,
      "S2 must be kept",
    );
  },
);

// ---------------------------------------------------------------------------
// 6. applyEssentialFilter — edges follow their nodes
// ---------------------------------------------------------------------------

Deno.test(
  "applyEssentialFilter: edges to hidden nodes are removed",
  () => {
    const req = requirementNode("REQ");
    const obs = observationNode("OBS");
    const mesh = artifactNode("MESH", "mesh");

    const e1 = edge("e1", req.ref, obs.ref);
    const e2 = edge("e2", req.ref, mesh.ref); // MESH is dead end → hidden

    const result = applyEssentialFilter([req, obs, mesh], [e1, e2]);
    assertEquals(
      result.edges.some((e) => e.id === "e1"),
      true,
      "e1 must survive",
    );
    assertEquals(
      result.edges.some((e) => e.id === "e2"),
      false,
      "e2 must be removed (MESH hidden)",
    );
  },
);

// ---------------------------------------------------------------------------
// 7. Integration: EvidenceCanvasProjection.supportingNodeCount is truthful
// ---------------------------------------------------------------------------

Deno.test(
  "EvidenceCanvasProjection.supportingNodeCount equals count of supporting nodes in model.nodes",
  () => {
    const req = requirementNode("REQ");
    const obs = observationNode("OBS");
    const chg = changeNode("CHG");
    const script = artifactNode("SCRIPT", "script");

    const rawGraph = {
      nodes: [req, obs, chg, script],
      edges: [
        edge("e1", chg.ref, req.ref, "changes"),
        edge("e2", req.ref, obs.ref, "input_to"),
        edge("e3", req.ref, script.ref, "input_to"),
      ],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});
    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      undefined,
      new Map(),
    );

    // CHG (change) and SCRIPT (script artifact) are both supporting.
    assertEquals(
      projection.supportingNodeCount,
      2,
      "Should count CHG + SCRIPT as supporting",
    );
    // isFiltered is false (no focus) → supportingNodeCount is the full count.
    assertEquals(projection.isFiltered, false);
  },
);

Deno.test(
  "the local view keeps its supporting nodes and marks them for the display toggle",
  () => {
    // Operator decision 2026-08-08 (burger « éléments digital thread »,
    // coché par défaut) : la vue locale CALCULE tout et expose
    // localSupportingRefKeys — le repli devient un filtre d'affichage
    // débrayable, jamais une suppression. Un clic depuis les listes de
    // l'inspecteur atterrit ainsi sur un nœud visible par défaut.
    const req = requirementNode("REQ");
    const obs = observationNode("OBS");
    const chg = changeNode("CHG");

    const rawGraph = {
      nodes: [req, obs, chg],
      edges: [
        edge("e1", chg.ref, req.ref, "changes"),
        edge("e2", req.ref, obs.ref, "input_to"),
      ],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});
    // Focus on req → bounded neighborhood → isFiltered = true.
    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      req.ref,
      new Map(),
    );

    assertEquals(projection.isFiltered, true);
    assertEquals(
      projection.nodes.map((n) => n.ref.id).sort(),
      ["CHG", "OBS", "REQ"],
      "The local view computes everything, plumbing included.",
    );
    assertEquals(
      projection.localSupportingRefKeys !== undefined &&
        projection.localSupportingRefKeys.has("change:CHG"),
      true,
      "The supporting change must be marked for the display toggle.",
    );
    assertEquals(
      projection.localSupportingRefKeys!.has("requirement:REQ"),
      false,
      "Essential facts are never marked as supporting.",
    );
  },
);
