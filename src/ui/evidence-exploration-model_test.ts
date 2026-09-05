/**
 * Tests for evidence-exploration-model.ts
 *
 * Invariants under test:
 * 1. normalizeEdgeDirection — direction par type de relation (source à gauche
 *    = x minimal dans le graphe dagre)
 * 2. buildExplorationModel — source strictement à gauche de ce qui en dérive
 *    sur la topologie réelle (input_to : SysML à gauche, observation à droite)
 * 3. buildExplorationModel — déterminisme : deux appels identiques, mêmes positions
 * 4. buildExplorationModel — every recorded edge remains a regular exact edge
 * 5. buildExplorationModel — la légende reflète les composantes nommées du modèle
 * 6. buildExplorationModel — les couleurs viennent du paramètre CssTokens, jamais
 *    codées en dur
 * 7. buildExplorationModel — les endpoints des moignons reçoivent des positions
 *    cohérentes (les deux extrémités existent dans le graphe sigma)
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildEvidenceMinimapView,
  buildExplorationModel,
  buildExplorationRelationRecords,
  buildExplorationVisualEdgeGroups,
  type CssTokens,
  DISPLAY_KIND_LABELS,
  displayKindOf,
  FALLBACK_TOKENS,
  nodeSizeFor,
  normalizeEdgeDirection,
  type SigmaNodeAttrs,
} from "./src/thread/evidence-exploration-model.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import { buildEvidenceCanvasProjection } from "./src/thread/evidence-canvas-model.ts";
import {
  buildVersionedGraphSelectionIndex,
  buildVersionedProvenanceProjection,
  edgeForVersionedGraphSelection,
} from "./src/thread/versioned-provenance-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ref(id: string, kind: ThreadGraphRef["kind"]): ThreadGraphRef {
  return { kind, id };
}

function node(
  id: string,
  kind: ThreadGraphRef["kind"],
  system: string,
  entityKind: ThreadGraphNode["entityKind"],
): ThreadGraphNode {
  return {
    id,
    ref: ref(id, kind),
    label: `Label ${id}`,
    summary: `Summary ${id}`,
    system,
    entityKind,
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

const EMPTY_FAMILY: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "test", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

/** Builds a minimal ExplorationModel from nodes + edges (helper). */
function buildMinimalModel(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
  tokens = FALLBACK_TOKENS,
) {
  const evidenceModel = buildEvidenceGraphModel(
    { nodes, edges },
    EMPTY_FAMILY,
    {},
  );
  const projection = buildEvidenceCanvasProjection(
    evidenceModel,
    0,
    undefined,
    new Map(),
  );
  return buildExplorationModel(evidenceModel, projection, tokens);
}

/** Gets the x position of a node key in the sigma graph. */
function xOf(
  model: ReturnType<typeof buildExplorationModel>,
  nodeId: string,
  kind: ThreadGraphRef["kind"],
): number {
  const key = `${kind}:${nodeId}`;
  return model.graph.getNodeAttribute(key, "x");
}

// ---------------------------------------------------------------------------
// 1. normalizeEdgeDirection — direction par type de relation
// ---------------------------------------------------------------------------

Deno.test(
  "normalizeEdgeDirection: input_to conserve la direction stockée (from=source, to=consommateur)",
  () => {
    const result = normalizeEdgeDirection("A", "B", "input_to");
    // A --input_to--> B : A est en amont, B est en aval. Pas d'inversion.
    assertEquals(result, { from: "A", to: "B" });
  },
);

Deno.test(
  "normalizeEdgeDirection: source_of conserve la direction stockée (from=source, to=dérivé)",
  () => {
    const result = normalizeEdgeDirection("CAD", "OBS", "source_of");
    // CAD --source_of--> OBS : CAD est en amont, OBS est en aval. Pas d'inversion.
    assertEquals(result, { from: "CAD", to: "OBS" });
  },
);

Deno.test(
  "normalizeEdgeDirection preserves the recorded SysML hierarchy and CAD representation directions",
  () => {
    for (
      const relation of ["contains", "typed_by", "represented_by"] as const
    ) {
      assertEquals(normalizeEdgeDirection("A", "B", relation), {
        from: "A",
        to: "B",
      });
    }
  },
);

Deno.test(
  "normalizeEdgeDirection: changes conserve la direction (from=événement, to=artefact)",
  () => {
    const result = normalizeEdgeDirection("CHG", "ART", "changes");
    // CHG --changes--> ART : l'événement de changement est en amont. Pas d'inversion.
    assertEquals(result, { from: "CHG", to: "ART" });
  },
);

Deno.test("normalizeEdgeDirection preserves projected supersession direction", () => {
  assertEquals(normalizeEdgeDirection("V1", "V2", "supersedes"), {
    from: "V1",
    to: "V2",
  });
});

Deno.test(
  "normalizeEdgeDirection: derived_from conserve la direction stockée (convention réelle : source --derived_from--> dérivé)",
  () => {
    const result = normalizeEdgeDirection("SOURCE", "DERIVED", "derived_from");
    // Vérifié sur les 65 arêtes réelles du r104 : le nom de la relation se lit
    // à l'envers, mais la direction STOCKÉE est source → dérivé. Pas d'inversion.
    assertEquals(result, { from: "SOURCE", to: "DERIVED" });
  },
);

Deno.test(
  "normalizeEdgeDirection: uses conserve la direction stockée (convention réelle : source --uses--> attestation d'entrée)",
  () => {
    const result = normalizeEdgeDirection("SOURCE", "ATTESTATION", "uses");
    // Vérifié sur les 37 arêtes réelles : l'artefact source est en amont de
    // l'attestation d'entrée qui enregistre son usage. Pas d'inversion.
    assertEquals(result, { from: "SOURCE", to: "ATTESTATION" });
  },
);

Deno.test(
  "normalizeEdgeDirection: evaluates conserve la direction stockée (convention réelle : exigence --evaluates--> évaluation)",
  () => {
    const result = normalizeEdgeDirection("REQ", "EVAL", "evaluates");
    // Vérifié sur les 6 arêtes réelles : l'exigence (spécifiée d'abord) est en
    // amont de son évaluation. Pas d'inversion.
    assertEquals(result, { from: "REQ", to: "EVAL" });
  },
);

Deno.test(
  "normalizeEdgeDirection: evidences conserve la direction stockée (convention réelle : résultat --evidences--> évaluation)",
  () => {
    const result = normalizeEdgeDirection("RESULT", "EVAL", "evidences");
    // Vérifié sur les 6 arêtes réelles : le résultat de calcul est en amont de
    // l'évaluation qu'il soutient. Pas d'inversion.
    assertEquals(result, { from: "RESULT", to: "EVAL" });
  },
);

Deno.test("normalizeEdgeDirection preserves projected trace direction", () => {
  assertEquals(normalizeEdgeDirection("SOURCE", "RESULT", "traces_to"), {
    from: "SOURCE",
    to: "RESULT",
  });
});

Deno.test("normalizeEdgeDirection preserves projected cause direction", () => {
  assertEquals(normalizeEdgeDirection("CAUSE", "EFFECT", "caused_by"), {
    from: "CAUSE",
    to: "EFFECT",
  });
});

Deno.test("normalizeEdgeDirection preserves projected remediation direction", () => {
  assertEquals(normalizeEdgeDirection("VIOLATION", "ACTION", "addresses"), {
    from: "VIOLATION",
    to: "ACTION",
  });
});

// ---------------------------------------------------------------------------
// 2. Source strictement à gauche de ce qui en dérive sur la topologie réelle
// ---------------------------------------------------------------------------

Deno.test(
  "layout LR: la source (input_to) est strictement à gauche de son consommateur",
  () => {
    // SysML --input_to--> CAD --input_to--> Observation
    // Ordre attendu gauche→droite : SysML | CAD | Observation
    const nodeSys = node("SYS", "artifact", "syson", "artifact");
    const nodeCAD = node("CAD", "artifact", "build123d", "artifact");
    const nodeObs = node("OBS", "observation", "calculix", "observation");

    const edgeSysCAD = edge(
      "e1",
      nodeSys.ref,
      nodeCAD.ref,
      "input_to",
    );
    const edgeCADObs = edge(
      "e2",
      nodeCAD.ref,
      nodeObs.ref,
      "source_of",
    );

    const model = buildMinimalModel(
      [nodeSys, nodeCAD, nodeObs],
      [edgeSysCAD, edgeCADObs],
    );

    const xSys = xOf(model, "SYS", "artifact");
    const xCAD = xOf(model, "CAD", "artifact");
    const xObs = xOf(model, "OBS", "observation");

    // SysML doit être le plus à gauche, observation le plus à droite.
    assertEquals(
      xSys < xCAD,
      true,
      `SysML (x=${xSys}) doit être à gauche de CAD (x=${xCAD})`,
    );
    assertEquals(
      xCAD < xObs,
      true,
      `CAD (x=${xCAD}) doit être à gauche de l'observation (x=${xObs})`,
    );
  },
);

Deno.test(
  "layout LR: avec derived_from, la source est à gauche du dérivé (convention réelle : source --derived_from--> dérivé)",
  () => {
    // SOURCE --derived_from--> DERIVED (direction stockée, vérifiée sur r104)
    // Attendu : SOURCE à gauche, DERIVED à droite.
    const nodeSource = node("SOURCE", "artifact", "syson", "artifact");
    const nodeDerived = node("DERIVED", "artifact", "build123d", "artifact");
    const edgeDerived = edge(
      "e1",
      nodeSource.ref,
      nodeDerived.ref,
      "derived_from",
    );

    const model = buildMinimalModel([nodeSource, nodeDerived], [edgeDerived]);

    const xSource = xOf(model, "SOURCE", "artifact");
    const xDerived = xOf(model, "DERIVED", "artifact");

    assertEquals(
      xSource < xDerived,
      true,
      `SOURCE (x=${xSource}) doit être à gauche de DERIVED (x=${xDerived}) — convention stockée source → dérivé`,
    );
  },
);

// ---------------------------------------------------------------------------
// 3. Déterminisme : deux appels avec les mêmes entrées → mêmes positions
// ---------------------------------------------------------------------------

Deno.test(
  "buildExplorationModel produit des positions stables pour les mêmes entrées",
  () => {
    const nodeA = node("A", "artifact", "calculix", "artifact");
    const nodeB = node("B", "artifact", "syson", "requirement");
    const rawEdge = edge("e1", nodeA.ref, nodeB.ref, "source_of");

    const m1 = buildMinimalModel([nodeA, nodeB], [rawEdge]);
    const m2 = buildMinimalModel([nodeA, nodeB], [rawEdge]);

    const positions1: Record<string, { x: number; y: number }> = {};
    m1.graph.forEachNode((key: string, attrs: SigmaNodeAttrs) => {
      positions1[key] = { x: attrs.x, y: attrs.y };
    });

    m2.graph.forEachNode((key: string, attrs: SigmaNodeAttrs) => {
      const p1 = positions1[key];
      assertEquals(
        p1 !== undefined,
        true,
        `Nœud ${key} absent du premier appel`,
      );
      assertEquals(attrs.x, p1!.x, `Position x instable pour ${key}`);
      assertEquals(attrs.y, p1!.y, `Position y instable pour ${key}`);
    });
  },
);

// ---------------------------------------------------------------------------
// 5. Légende = composantes nommées du modèle
// ---------------------------------------------------------------------------

Deno.test(
  "la légende contient une entrée par composante visible et pas plus",
  () => {
    // Deux composantes isolées : syson et calculix.
    const nodeSys = node("SYS-1", "requirement", "syson", "requirement");
    const nodeCalc = node("CALC-1", "artifact", "calculix", "artifact");

    const rawGraph = {
      nodes: [nodeSys, nodeCalc],
      edges: [], // pas de lien → deux composantes distinctes
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});

    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      undefined,
      new Map(),
    );

    const explorationModel = buildExplorationModel(
      evidenceModel,
      projection,
      FALLBACK_TOKENS,
    );

    // Deux composantes → deux entrées de légende.
    assertEquals(
      explorationModel.legend.length,
      2,
      "Deux composantes → deux entrées de légende",
    );

    // Chaque entrée doit avoir un nom non vide, un compte de 1, et au moins un componentId.
    for (const item of explorationModel.legend) {
      assertNotEquals(
        item.name,
        "",
        "Le nom de composante ne doit pas être vide",
      );
      assertEquals(item.visibleNodeCount, 1);
      assertEquals(
        item.componentIds.length >= 1,
        true,
        "Chaque entrée doit référencer au moins un component",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// 6. Couleurs issues de CssTokens, pas codées en dur
// ---------------------------------------------------------------------------

Deno.test(
  "node colors use the literal recorded system and passed generic palette",
  () => {
    const nodeSys = node("SYS-1", "requirement", "syson", "requirement");
    const rawGraph = { nodes: [nodeSys], edges: [] };
    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});
    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      undefined,
      new Map(),
    );

    const customTokens: CssTokens = {
      ...FALLBACK_TOKENS,
      cyan: "#123456",
    };

    const model = buildExplorationModel(
      evidenceModel,
      projection,
      customTokens,
    );

    let sysonColor: string | undefined;
    model.graph.forEachNode((_key: string, attrs: SigmaNodeAttrs) => {
      if (attrs.node.system === "syson") sysonColor = attrs.color;
    });

    assertEquals(model.systemLegend[0]?.system, "syson");
    assertEquals(model.systemLegend[0]?.label, "syson");
    assertEquals(model.systemLegend[0]?.color, sysonColor);
    assertEquals(
      new Set([
        customTokens.cyan,
        customTokens.blue,
        customTokens.violet,
        customTokens.amber,
        customTokens.green,
        customTokens.red,
        customTokens.muted,
      ]).has(sysonColor ?? ""),
      true,
    );
  },
);

Deno.test(
  "a recorded system remains literal in the generic system key",
  () => {
    const sandboxCad = node(
      "CAD-SANDBOX",
      "artifact",
      "build123d-sandbox",
      "artifact",
    );
    const customTokens: CssTokens = {
      ...FALLBACK_TOKENS,
      amber: "#0e7490",
      muted: "#777777",
    };
    const model = buildMinimalModel([sandboxCad], [], customTokens);

    const color = model.graph.getNodeAttribute(
      "artifact:CAD-SANDBOX",
      "color",
    );
    assertEquals(model.systemLegend, [{
      system: "build123d-sandbox",
      label: "build123d-sandbox",
      color,
      count: 1,
    }]);
  },
);

// ---------------------------------------------------------------------------
// 8. Parité de projection : Carte et Exploration reçoivent les mêmes refs
// ---------------------------------------------------------------------------

Deno.test(
  "Carte et Exploration reçoivent exactement les mêmes node refs en mode full-map",
  () => {
    // Fixture deliberately mixes literal recorded kinds. The generic
    // projection must not hide a node because it recognises a mesh payload.
    const nodeReq: ThreadGraphNode = {
      id: "REQ-1",
      ref: ref("REQ-1", "requirement"),
      entityKind: "requirement",
      label: "Requirement 1",
      system: "syson",
      freshness: "fresh",
      summary: "recorded result",
    };
    const nodeMesh: ThreadGraphNode = {
      id: "mesh-xyz",
      ref: ref("mesh-xyz", "artifact"),
      entityKind: "artifact",
      artifactKind: "mesh",
      label: "Mesh XYZ",
      system: "build123d",
      freshness: "fresh",
      summary: "recorded mesh",
    };
    const nodeObs: ThreadGraphNode = {
      id: "OBS-1",
      ref: ref("OBS-1", "observation"),
      entityKind: "observation",
      label: "Observation 1",
      system: "calculix",
      freshness: "fresh",
      summary: "0.015 mm",
    };

    const evidenceModel = buildEvidenceGraphModel(
      // REQ-1 ← OBS-1 (via evidences edge); mesh-xyz is disconnected.
      {
        nodes: [nodeReq, nodeMesh, nodeObs],
        edges: [
          edge("e1", nodeObs.ref, nodeReq.ref, "evidences"),
        ],
      },
      EMPTY_FAMILY,
      {},
    );

    // Shared projection — this is what both renderers receive.
    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      undefined,
      new Map(),
    );

    // Carte refs: the nodes list the SVG canvas would receive.
    const carteRefs = new Set(
      projection.nodes.map((n) => `${n.ref.kind}:${n.ref.id}`),
    );

    // Exploration refs: keys present in the sigma graphology graph.
    const explorationModel = buildExplorationModel(
      evidenceModel,
      projection,
      FALLBACK_TOKENS,
    );
    const explorationRefs = new Set<string>();
    explorationModel.graph.forEachNode((key: string) => {
      explorationRefs.add(key);
    });

    // Both renderers must show exactly the same set of nodes.
    assertEquals(
      carteRefs,
      explorationRefs,
      "Carte and Exploration must have identical visible node refs",
    );

    // The exact mesh record stays visible in both; an MCP App may present its
    // domain payload separately, but the graph does not classify it away.
    assertEquals(
      carteRefs.has("artifact:mesh-xyz"),
      true,
      "Recorded mesh node must remain visible in Carte",
    );
    assertEquals(
      explorationRefs.has("artifact:mesh-xyz"),
      true,
      "Recorded mesh node must remain visible in Exploration",
    );

    // REQ-1 and OBS-1 must also be present in both.
    assertEquals(carteRefs.has("requirement:REQ-1"), true);
    assertEquals(explorationRefs.has("requirement:REQ-1"), true);
    assertEquals(carteRefs.has("observation:OBS-1"), true);
    assertEquals(explorationRefs.has("observation:OBS-1"), true);
  },
);

// ---------------------------------------------------------------------------
// Literal recorded-system key (systemLegend)
// ---------------------------------------------------------------------------

Deno.test(
  "literal systems receive stable generic colours",
  () => {
    const model = buildMinimalModel(
      [
        node("m1", "artifact", "modelica", "artifact"),
        node("s1", "artifact", "syson", "artifact"),
      ],
      [edge("e1", { kind: "artifact", id: "m1" }, {
        kind: "artifact",
        id: "s1",
      })],
    );
    const modelica = model.graph.getNodeAttributes("artifact:m1");
    const syson = model.graph.getNodeAttributes("artifact:s1");
    assertNotEquals(modelica.color, syson.color);
    assertNotEquals(modelica.color, FALLBACK_TOKENS.muted);
  },
);

Deno.test(
  "the system key lists exact literal ids and visible counts",
  () => {
    const model = buildMinimalModel(
      [
        node("m1", "artifact", "modelica", "artifact"),
        node("s1", "artifact", "syson", "artifact"),
        node("c1", "artifact", "calculix", "artifact"),
      ],
      [
        edge("e1", { kind: "artifact", id: "m1" }, {
          kind: "artifact",
          id: "s1",
        }),
        edge("e2", { kind: "artifact", id: "s1" }, {
          kind: "artifact",
          id: "c1",
        }),
      ],
    );
    const bySystem = new Map(
      model.systemLegend.map((item) => [item.system, item]),
    );
    assertEquals(bySystem.size, 3, "One legend entry per exact system id.");
    assertEquals(bySystem.get("modelica")?.count, 1);
    assertEquals(bySystem.get("modelica")?.label, "modelica");
    for (const item of model.systemLegend) {
      assertEquals(typeof item.color, "string");
      assertNotEquals(item.color, "");
    }
  },
);

Deno.test(
  "similar system ids remain separate without browser aliases",
  () => {
    const legacy = node("c1", "artifact", "calculix", "artifact");
    const provider = node("c2", "artifact", "mcp-calculix", "artifact");
    const model = buildMinimalModel(
      [legacy, provider],
      [edge("e1", legacy.ref, provider.ref)],
    );

    assertEquals(
      model.systemLegend.map(({ system, label, count }) => ({
        system,
        label,
        count,
      })),
      [
        { system: "calculix", label: "calculix", count: 1 },
        { system: "mcp-calculix", label: "mcp-calculix", count: 1 },
      ],
    );
    assertEquals(
      model.graph.getNodeAttribute("artifact:c1", "node").system,
      "calculix",
    );
    assertEquals(
      model.graph.getNodeAttribute("artifact:c2", "node").system,
      "mcp-calculix",
    );
  },
);

// ---------------------------------------------------------------------------
// displayKindOf — classification per node type
// ---------------------------------------------------------------------------

Deno.test(
  "displayKindOf returns the literal artifact kind regardless of artifactKind",
  () => {
    const n: ThreadGraphNode = {
      ...node("a1", "artifact", "build123d", "artifact"),
      artifactKind: "SysML v2 model",
    };
    assertEquals(displayKindOf(n), "artifact");
  },
);

Deno.test(
  "displayKindOf never reclassifies an artifact from its artifactKind",
  () => {
    for (
      const kind of [
        "script",
        "mesh",
        "solver-input",
        "evidence",
        "document",
        "other",
      ]
    ) {
      const n: ThreadGraphNode = {
        ...node(`a-${kind}`, "artifact", "build123d", "artifact"),
        artifactKind: kind,
      };
      assertEquals(
        displayKindOf(n),
        "artifact",
        `artifactKind '${kind}' must remain the literal artifact entity kind`,
      );
    }
  },
);

Deno.test(
  "displayKindOf returns artifact when artifactKind is absent",
  () => {
    const n: ThreadGraphNode = node("a2", "artifact", "syson", "artifact");
    // No artifactKind is required for the literal entity kind.
    assertEquals(displayKindOf(n), "artifact");
  },
);

Deno.test(
  "displayKindOf: non-artifact kinds map directly to their entityKind",
  () => {
    const cases: Array<[ThreadGraphNode["entityKind"], string]> = [
      ["observation", "observation"],
      ["requirement", "requirement"],
      ["evaluation", "evaluation"],
      ["violation", "violation"],
      ["change", "change"],
      ["consumption", "consumption"],
      ["action", "action"],
      ["analysis-node", "analysis-node"],
      ["part-definition", "part-definition"],
      ["part-usage", "part-usage"],
      ["attribute-usage", "attribute-usage"],
    ];
    for (const [entityKind, expected] of cases) {
      const n = node(
        `n-${entityKind}`,
        entityKind as ThreadGraphRef["kind"],
        "syson",
        entityKind,
      );
      assertEquals(
        displayKindOf(n),
        expected,
        `entityKind '${entityKind}' should return '${expected}'`,
      );
    }
  },
);

Deno.test("nodeSizeFor keeps attribute records smaller than parts", () => {
  const part = node("def", "part-definition", "syson", "part-definition");
  const attribute = node("attr", "attribute-usage", "syson", "attribute-usage");
  assertEquals(nodeSizeFor(part), 7);
  assertEquals(nodeSizeFor(attribute), 4);
});

Deno.test(
  "displayKindOf does not create a special view from evaluationFamily",
  () => {
    const n: ThreadGraphNode = {
      ...node("eval-join", "evaluation", "syson", "evaluation"),
      evaluationFamily: "study-base",
    };
    assertEquals(displayKindOf(n), "evaluation");
  },
);

Deno.test(
  "DISPLAY_KIND_LABELS has an English label for every DisplayKind",
  () => {
    const expectedKinds = [
      "artifact",
      "consumption",
      "observation",
      "requirement",
      "evaluation",
      "violation",
      "change",
      "action",
      "analysis-node",
      "part-definition",
      "part-usage",
      "attribute-usage",
    ];
    for (const kind of expectedKinds) {
      const label = DISPLAY_KIND_LABELS[kind as keyof typeof DISPLAY_KIND_LABELS];
      assertEquals(
        typeof label,
        "string",
        `Missing label for kind '${kind}'`,
      );
      assertNotEquals(label, "", `Empty label for kind '${kind}'`);
    }
  },
);

Deno.test(
  "Sigma draws one source route while the table retains derived_from and source_of",
  () => {
    const source = node("source", "artifact", "calculix", "artifact");
    const observation = node(
      "measure",
      "observation",
      "calculix",
      "observation",
    );
    const derived: ThreadGraphEdge = {
      ...edge(
        "derived",
        source.ref,
        observation.ref,
        "derived_from",
      ),
      origin: "provenance",
    };
    const sourceOf = edge(
      "source-of",
      source.ref,
      observation.ref,
      "source_of",
    );
    const versioned = buildVersionedProvenanceProjection(
      { nodes: [source, observation], edges: [derived, sourceOf] },
      EMPTY_FAMILY,
    );
    const projectedDerived = versioned.graph.edges.find((candidate) =>
      candidate.id === derived.id
    )!;
    const projectedSourceOf = versioned.graph.edges.find((candidate) =>
      candidate.id === sourceOf.id
    )!;
    const evidenceModel = buildEvidenceGraphModel(
      versioned.graph,
      EMPTY_FAMILY,
      {},
    );
    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      undefined,
      new Map(),
    );
    const model = buildExplorationModel(
      evidenceModel,
      projection,
      FALLBACK_TOKENS,
    );

    assertEquals(projection.edges.length, 2, "Projection stays complete.");
    assertEquals(model.graph.size, 1, "Sigma draws one shared route.");
    const attrs = model.graph.getEdgeAttributes(model.graph.edges()[0]!);
    assertEquals(
      attrs.edge,
      projectedSourceOf,
      "The precise structural edge is primary.",
    );
    assertEquals(attrs.memberEdges, [projectedSourceOf, projectedDerived]);
    assertEquals(attrs.memberOccurrenceKeys.length, 2);
    assertEquals(
      attrs.label,
      "source of + derived from · 2 recorded assertions",
    );

    const records = buildExplorationRelationRecords(
      projection.edges,
      new Set(["artifact:source", "observation:measure"]),
      new Map([
        ["artifact:source", "Solver result"],
        ["observation:measure", "Measured displacement"],
      ]),
    );
    assertEquals(records.length, 2, "The table lists both assertions.");
    assertEquals(
      new Set(records.map((record) => record.edgeId)),
      new Set(["derived", "source-of"]),
    );
    assertEquals(
      new Set(records.map((record) => record.edge)),
      new Set([projectedDerived, projectedSourceOf]),
      "Each table action retains its exact edge object for the inspector.",
    );
    assertEquals(
      new Set(records.map((record) => record.occurrenceKey)).size,
      2,
    );
    assertEquals(
      records.every((record) =>
        record.visualRouteLabel?.includes("2 recorded assertions") === true
      ),
      true,
    );
    const selectionIndex = buildVersionedGraphSelectionIndex(versioned);
    for (const record of records) {
      const inspectorEdge = edgeForVersionedGraphSelection(
        versioned,
        {
          kind: "edge",
          id: record.edgeId,
          occurrence: {
            key: record.occurrenceKey,
            edge: record.edge,
          },
        },
        selectionIndex,
      );
      assertEquals(inspectorEdge?.id, record.edge.id);
      assertEquals(inspectorEdge?.relation, record.edge.relation);
      assertEquals(inspectorEdge?.from, record.edge.from);
      assertEquals(inspectorEdge?.to, record.edge.to);
      assertEquals(inspectorEdge?.attestation, record.edge.attestation);
    }
  },
);

Deno.test(
  "Sigma draws one input route only when derived_from has the same attestation",
  () => {
    const input = node("input", "artifact", "build123d", "artifact");
    const result = node("result", "artifact", "calculix", "artifact");
    const attestation = {
      consumptionId: "consumption-1",
      status: "verified" as const,
      producerFingerprint: "sha256:a",
      consumedFingerprint: "sha256:a",
      checkedAt: "2026-08-13T00:00:00.000Z",
    };
    const derived: ThreadGraphEdge = {
      ...edge("derived", input.ref, result.ref, "derived_from"),
      origin: "provenance",
      attestation,
    };
    const inputTo: ThreadGraphEdge = {
      ...edge("input-to", input.ref, result.ref, "input_to"),
      attestation: { ...attestation },
    };
    const groups = buildExplorationVisualEdgeGroups([derived, inputTo]);

    assertEquals(groups.length, 1);
    assertEquals(groups[0]!.primary, inputTo);
    assertEquals(groups[0]!.members, [inputTo, derived]);

    const mismatch: ThreadGraphEdge = {
      ...inputTo,
      attestation: { ...attestation, status: "mismatch" },
    };
    assertEquals(
      buildExplorationVisualEdgeGroups([derived, mismatch]).length,
      2,
      "A different attestation fails open.",
    );
  },
);

Deno.test(
  "Sigma fails open when redundant route candidates are ambiguous",
  () => {
    const from = ref("input", "artifact");
    const to = ref("result", "artifact");
    const derivedA: ThreadGraphEdge = {
      ...edge("derived-a", from, to, "derived_from"),
      origin: "provenance",
    };
    const derivedB: ThreadGraphEdge = {
      ...edge("derived-b", from, to, "derived_from"),
      origin: "provenance",
    };
    const inputTo = edge("input", from, to, "input_to");

    assertEquals(
      buildExplorationVisualEdgeGroups([derivedA, inputTo, derivedB]).length,
      3,
    );
  },
);

Deno.test("Sigma preserves parallel recorded relations for inspection", () => {
  const evidenceModel = buildEvidenceGraphModel(
    {
      nodes: [
        node("source", "artifact", "build123d", "artifact"),
        node("result", "observation", "calculix", "observation"),
      ],
      edges: [
        edge(
          "handoff-a",
          ref("source", "artifact"),
          ref("result", "observation"),
          "source_of",
        ),
        edge(
          "handoff-b",
          ref("source", "artifact"),
          ref("result", "observation"),
          "evidences",
        ),
      ],
    },
    EMPTY_FAMILY,
    {},
  );
  const projection = buildEvidenceCanvasProjection(
    evidenceModel,
    0,
    undefined,
    new Map(),
  );
  const model = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );
  assertEquals(model.graph.size, 2);
  assertEquals(
    new Set(model.graph.mapEdges((_key, attrs) => attrs.edgeId)).size,
    2,
  );
});

Deno.test("Sigma assigns distinct graph keys when recorded edge ids collide", () => {
  const evidenceModel = buildEvidenceGraphModel(
    {
      nodes: [
        node("source", "artifact", "build123d", "artifact"),
        node("left", "observation", "calculix", "observation"),
        node("right", "observation", "calculix", "observation"),
      ],
      edges: [
        edge(
          "duplicated-id",
          ref("source", "artifact"),
          ref("left", "observation"),
          "source_of",
        ),
        edge(
          "duplicated-id",
          ref("source", "artifact"),
          ref("right", "observation"),
          "source_of",
        ),
      ],
    },
    EMPTY_FAMILY,
    {},
  );
  const projection = buildEvidenceCanvasProjection(
    evidenceModel,
    0,
    undefined,
    new Map(),
  );
  const model = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );
  const graphKeys = model.graph.edges();
  assertEquals(graphKeys.length, 2);
  assertEquals(new Set(graphKeys).size, 2);
  assertEquals(
    model.graph.mapEdges((_key, attrs) => attrs.edgeId),
    ["duplicated-id", "duplicated-id"],
  );
});

Deno.test("Sigma does not merge occurrence groups when recorded ids contain pipes", () => {
  const evidenceModel = buildEvidenceGraphModel(
    {
      nodes: [
        node("one|artifact:two", "artifact", "build123d", "artifact"),
        node("three", "artifact", "build123d", "artifact"),
        node("one", "artifact", "build123d", "artifact"),
        node("two|artifact:three", "artifact", "build123d", "artifact"),
      ],
      edges: [
        edge(
          "handoff|one",
          ref("one|artifact:two", "artifact"),
          ref("three", "artifact"),
          "evidences",
        ),
        edge(
          "handoff|two",
          ref("one", "artifact"),
          ref("two|artifact:three", "artifact"),
          "evidences",
        ),
      ],
    },
    EMPTY_FAMILY,
    {},
  );
  const projection = buildEvidenceCanvasProjection(
    evidenceModel,
    0,
    undefined,
    new Map(),
  );
  const model = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );

  assertEquals(model.graph.size, 2);
  assertEquals(
    new Set(model.graph.mapEdges((_key, attrs) => attrs.occurrenceKey)).size,
    2,
  );
  assertEquals(
    model.graph.mapEdges((_key, attrs) => attrs.edgeId).sort(),
    ["handoff|one", "handoff|two"],
  );
});

Deno.test("exploration labels preserve canonical evidence records", () => {
  const step = {
    ...node("step", "artifact", "build123d", "artifact"),
    artifactKind: "step",
    label: "Authoritative STEP: ArticulatedArm",
  };
  const proof = {
    ...node("proof", "artifact", "digital-thread", "artifact"),
    artifactKind: "document",
    label: "FEA proof case seal: desk-lamp arm cantilever revision one",
  };
  const solverInput = {
    ...node("input", "artifact", "mcp-calculix", "artifact"),
    artifactKind: "solver-input",
    label: "CalculiX input.step",
  };
  const result = {
    ...node("result", "artifact", "mcp-calculix", "artifact"),
    artifactKind: "solver-result",
    label: "CalculiX result.json",
  };
  const evaluationRecord = {
    ...node("evaluation-record", "artifact", "digital-thread", "artifact"),
    artifactKind: "evidence",
    label: "Recorded SysON FEA evaluation",
  };
  const displacementObservation = {
    ...node(
      "displacement-observation",
      "observation",
      "mcp-calculix",
      "observation",
    ),
    label: "maximumDisplacement measured by CalculiX",
  };
  const stressObservation = {
    ...node(
      "stress-observation",
      "observation",
      "mcp-calculix",
      "observation",
    ),
    label: "maximumVonMisesStress measured by CalculiX",
  };
  const displacementRequirement = {
    ...node(
      "displacement-requirement",
      "requirement",
      "syson",
      "requirement",
    ),
    label: "Maximum arm tip displacement",
  };
  const stressRequirement = {
    ...node("stress-requirement", "requirement", "syson", "requirement"),
    label: "Maximum arm von Mises stress",
  };
  const displacementEvaluation = {
    ...node(
      "displacement-evaluation",
      "evaluation",
      "syson",
      "evaluation",
    ),
    label: "maximumDisplacement evaluation",
  };
  const stressEvaluation = {
    ...node("stress-evaluation", "evaluation", "syson", "evaluation"),
    label: "maximumVonMisesStress evaluation",
  };
  const nodes = [
    step,
    proof,
    solverInput,
    result,
    evaluationRecord,
    displacementObservation,
    stressObservation,
    displacementRequirement,
    stressRequirement,
    displacementEvaluation,
    stressEvaluation,
  ];
  const edges = [
    edge("step-proof", step.ref, proof.ref, "derived_from"),
    edge("step-input", step.ref, solverInput.ref, "input_to"),
    edge("input-result", solverInput.ref, result.ref, "input_to"),
    edge("result-record", result.ref, evaluationRecord.ref, "input_to"),
    edge("proof-record", proof.ref, evaluationRecord.ref, "input_to"),
    edge(
      "record-evaluation",
      evaluationRecord.ref,
      displacementEvaluation.ref,
      "evidences",
    ),
    edge(
      "record-stress-evaluation",
      evaluationRecord.ref,
      stressEvaluation.ref,
      "evidences",
    ),
    edge(
      "result-displacement-observation",
      result.ref,
      displacementObservation.ref,
      "source_of",
    ),
    edge(
      "result-stress-observation",
      result.ref,
      stressObservation.ref,
      "source_of",
    ),
    edge(
      "displacement-observation-evaluation",
      displacementObservation.ref,
      displacementEvaluation.ref,
      "uses",
    ),
    edge(
      "stress-observation-evaluation",
      stressObservation.ref,
      stressEvaluation.ref,
      "uses",
    ),
    edge(
      "displacement-requirement-evaluation",
      displacementRequirement.ref,
      displacementEvaluation.ref,
      "evaluates",
    ),
    edge(
      "stress-requirement-evaluation",
      stressRequirement.ref,
      stressEvaluation.ref,
      "evaluates",
    ),
  ];
  const evidenceModel = buildEvidenceGraphModel(
    { nodes, edges },
    EMPTY_FAMILY,
  );
  const projection = {
    nodes,
    edges,
    displayedCount: nodes.length,
    isFiltered: false,
    hiddenByKindCount: 0,
  };
  const model = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );
  const modelAgain = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
  );

  assertEquals(model.graph.order, 11);
  for (const canonicalNode of nodes) {
    const key = `${canonicalNode.ref.kind}:${canonicalNode.ref.id}`;
    assertEquals(
      modelAgain.graph.getNodeAttribute(key, "label"),
      model.graph.getNodeAttribute(key, "label"),
    );
    assertEquals(
      model.graph.getNodeAttribute(key, "node").label,
      canonicalNode.label,
    );
  }
  assertEquals(
    model.graph.getNodeAttribute("artifact:step", "label"),
    step.label,
  );
});

Deno.test("minimap projects recorded full-map nodes and never invents a box", () => {
  const origin = node("sysml", "artifact", "SysON", "artifact");
  const result = node("obs", "observation", "CalculiX", "observation");
  const model = buildMinimalModel(
    [origin, result],
    [edge("e1", origin.ref, result.ref)],
  );
  const emptyLocal = buildEvidenceMinimapView(
    model,
    new Set(["requirement:ghost"]),
  );
  assertEquals(emptyLocal.nodeCount, 2);
  assertEquals(emptyLocal.edgeCount, 1);
  assertEquals(emptyLocal.localBounds, undefined);
  assertEquals(
    emptyLocal.nodes.some((item) => item.key === "requirement:ghost"),
    false,
  );

  const focused = buildEvidenceMinimapView(
    model,
    new Set(["artifact:sysml", "observation:obs"]),
  );
  assertEquals(focused.localBounds !== undefined, true);
  assertEquals(focused.nodes.length, 2);
});
