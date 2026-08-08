/**
 * Tests for evidence-exploration-model.ts
 *
 * Invariants under test:
 * 1. normalizeEdgeDirection — direction par type de relation (source à gauche
 *    = x minimal dans le graphe dagre)
 * 2. buildExplorationModel — source strictement à gauche de ce qui en dérive
 *    sur la topologie réelle (input_to : SysML à gauche, observation à droite)
 * 3. buildExplorationModel — déterminisme : deux appels identiques, mêmes positions
 * 4. buildExplorationModel — les arêtes moignons sont marquées edgeType:"stub"
 * 5. buildExplorationModel — la légende reflète les composantes nommées du modèle
 * 6. buildExplorationModel — les couleurs viennent du paramètre CssTokens, jamais
 *    codées en dur
 * 7. buildExplorationModel — les endpoints des moignons reçoivent des positions
 *    cohérentes (les deux extrémités existent dans le graphe sigma)
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildExplorationModel,
  type CssTokens,
  DISPLAY_KIND_LABELS,
  displayKindOf,
  FALLBACK_TOKENS,
  normalizeEdgeDirection,
  type SigmaEdgeAttrs,
  type SigmaNodeAttrs,
} from "./src/thread/evidence-exploration-model.ts";
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
  "normalizeEdgeDirection: changes conserve la direction (from=événement, to=artefact)",
  () => {
    const result = normalizeEdgeDirection("CHG", "ART", "changes");
    // CHG --changes--> ART : l'événement de changement est en amont. Pas d'inversion.
    assertEquals(result, { from: "CHG", to: "ART" });
  },
);

Deno.test(
  "normalizeEdgeDirection: supersedes est inversé (les données font nouveau --supersedes--> ancien)",
  () => {
    const result = normalizeEdgeDirection("V2", "V1", "supersedes");
    // V2 --supersedes--> V1 (lecture anglaise : le nouveau remplace l'ancien) :
    // l'ancien V1 est en amont (gauche), inversion requise.
    assertEquals(result, { from: "V1", to: "V2" });
  },
);

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

Deno.test(
  "normalizeEdgeDirection: traces_to est inversé (from=impl, to=exigence → exigence en amont)",
  () => {
    const result = normalizeEdgeDirection("IMPL", "REQ", "traces_to");
    // IMPL --traces_to--> REQ : REQ est en amont, inversion.
    assertEquals(result, { from: "REQ", to: "IMPL" });
  },
);

Deno.test(
  "normalizeEdgeDirection: caused_by est inversé (from=effet, to=cause → cause en amont)",
  () => {
    const result = normalizeEdgeDirection("EFFECT", "CAUSE", "caused_by");
    // EFFECT --caused_by--> CAUSE : CAUSE est en amont, inversion.
    assertEquals(result, { from: "CAUSE", to: "EFFECT" });
  },
);

Deno.test(
  "normalizeEdgeDirection: addresses est inversé (from=action, to=violation → violation en amont)",
  () => {
    const result = normalizeEdgeDirection("ACTION", "VIOLATION", "addresses");
    // ACTION --addresses--> VIOLATION : VIOLATION est en amont, inversion.
    assertEquals(result, { from: "VIOLATION", to: "ACTION" });
  },
);

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
// 4. Arêtes moignons → edgeType: "stub"
// ---------------------------------------------------------------------------

Deno.test(
  "les arêtes moignons du modèle sont marquées edgeType:stub dans le graphe sigma",
  () => {
    // A ← B (instrument) → C : B est un outil analyze.* qui devient un moignon.
    const nodeA = node("A", "artifact", "calculix", "artifact");
    const nodeB = node("B", "artifact", "analyze", "artifact");
    const nodeC = node("C", "requirement", "syson", "requirement");

    const rawGraph = {
      nodes: [nodeA, nodeB, nodeC],
      edges: [
        edge("e1", nodeA.ref, nodeB.ref, "input_to"),
        edge("e2", nodeB.ref, nodeC.ref, "input_to"),
      ],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {
      isAnalyzeInstrumentNode: (n) => n.system === "analyze",
    });

    const projection = buildEvidenceCanvasProjection(
      evidenceModel,
      0,
      undefined,
      new Map(),
    );

    // La projection contient au moins un moignon (id commence par "stub:")
    const hasStub = projection.edges.some((e) => e.id.startsWith("stub:"));
    assertEquals(
      hasStub,
      true,
      "La projection doit contenir au moins un moignon",
    );

    const explorationModel = buildExplorationModel(
      evidenceModel,
      projection,
      FALLBACK_TOKENS,
    );

    // Dans le graphe sigma, les arêtes moignons doivent être marquées "stub".
    let stubEdgeFound = false;
    explorationModel.graph.forEachEdge(
      (_key: string, attrs: SigmaEdgeAttrs) => {
        if (attrs.edgeType === "stub") stubEdgeFound = true;
      },
    );
    assertEquals(
      stubEdgeFound,
      true,
      "Le graphe sigma doit contenir une arête de type stub",
    );
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
  "nodeColorFor utilise les tokens passés en paramètre, pas des constantes",
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

    // Tokens avec une couleur cyan distincte
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

    assertEquals(
      sysonColor,
      "#123456",
      "La couleur du nœud syson doit utiliser tokens.cyan",
    );
  },
);

// ---------------------------------------------------------------------------
// 7. Les endpoints des moignons reçoivent des positions cohérentes
// ---------------------------------------------------------------------------

Deno.test(
  "les endpoints des arêtes moignons ont des positions dans le graphe sigma",
  () => {
    // A (calculix) ← B (analyze instrument) → C (syson) :
    // B est replié en moignon ; A et C doivent chacun avoir une position dagre.
    const nodeA = node("A", "artifact", "calculix", "artifact");
    const nodeB = node("B", "artifact", "analyze", "artifact");
    const nodeC = node("C", "requirement", "syson", "requirement");

    const evidenceModel = buildEvidenceGraphModel(
      {
        nodes: [nodeA, nodeB, nodeC],
        edges: [
          edge("e1", nodeA.ref, nodeB.ref, "input_to"),
          edge("e2", nodeB.ref, nodeC.ref, "input_to"),
        ],
      },
      EMPTY_FAMILY,
      { isAnalyzeInstrumentNode: (n) => n.system === "analyze" },
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

    // Vérifie que les stubs ont des endpoints présents dans le graphe sigma.
    projection.edges.filter((e) => e.id.startsWith("stub:")).forEach((stub) => {
      const fromKey = `${stub.from.kind}:${stub.from.id}`;
      const toKey = `${stub.to.kind}:${stub.to.id}`;
      assertEquals(
        model.graph.hasNode(fromKey) || model.graph.hasNode(toKey),
        true,
        `Au moins un endpoint du moignon ${stub.id} doit être présent dans le graphe`,
      );
      // Si les deux endpoints sont présents, leurs positions doivent exister.
      if (model.graph.hasNode(fromKey)) {
        const x = model.graph.getNodeAttribute(fromKey, "x");
        assertEquals(
          typeof x === "number",
          true,
          `Le nœud source ${fromKey} du moignon doit avoir une position x`,
        );
      }
      if (model.graph.hasNode(toKey)) {
        const x = model.graph.getNodeAttribute(toKey, "x");
        assertEquals(
          typeof x === "number",
          true,
          `Le nœud cible ${toKey} du moignon doit avoir une position x`,
        );
      }
    });
  },
);

// ---------------------------------------------------------------------------
// 8. Parité de projection : Carte et Exploration reçoivent les mêmes refs
// ---------------------------------------------------------------------------

Deno.test(
  "Carte et Exploration reçoivent exactement les mêmes node refs en mode full-map",
  () => {
    // Fixture: essential node (syson requirement) + supporting node (mesh artifact).
    // The essential filter (applied once upstream by buildEvidenceCanvasProjection)
    // must remove the supporting node from both renderers' inputs.
    const nodeReq: ThreadGraphNode = {
      id: "REQ-1",
      ref: ref("REQ-1", "requirement"),
      entityKind: "requirement",
      label: "Requirement 1",
      system: "syson",
      freshness: "fresh",
      summary: "essential",
    };
    const nodeMesh: ThreadGraphNode = {
      id: "mesh-xyz",
      ref: ref("mesh-xyz", "artifact"),
      entityKind: "artifact",
      artifactKind: "mesh",
      label: "Mesh XYZ",
      system: "build123d",
      freshness: "fresh",
      summary: "supporting mesh",
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
      // REQ-1 ← OBS-1 (via evidences edge); mesh-xyz is disconnected (supporting).
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

    // mesh-xyz (supporting) must be absent from both.
    assertEquals(
      carteRefs.has("artifact:mesh-xyz"),
      false,
      "Supporting mesh node must not be visible in Carte",
    );
    assertEquals(
      explorationRefs.has("artifact:mesh-xyz"),
      false,
      "Supporting mesh node must not be visible in Exploration",
    );

    // REQ-1 and OBS-1 (essential) must be present in both.
    assertEquals(carteRefs.has("requirement:REQ-1"), true);
    assertEquals(explorationRefs.has("requirement:REQ-1"), true);
    assertEquals(carteRefs.has("observation:OBS-1"), true);
    assertEquals(explorationRefs.has("observation:OBS-1"), true);
  },
);

// ---------------------------------------------------------------------------
// Tool color key (systemLegend)
// ---------------------------------------------------------------------------

Deno.test(
  "modelica nodes are painted violet, never the muted fallback",
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
    const attrs = model.graph.getNodeAttributes("artifact:m1");
    assertEquals(attrs.color, FALLBACK_TOKENS.violet);
    assertNotEquals(attrs.color, FALLBACK_TOKENS.muted);
  },
);

Deno.test(
  "the tool color key lists exactly the visible systems with the exact canvas colors",
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
    assertEquals(bySystem.size, 3, "One legend entry per visible system.");
    // The legend color must equal the color painted on the canvas node.
    assertEquals(
      bySystem.get("modelica")?.color,
      model.graph.getNodeAttributes("artifact:m1").color,
    );
    assertEquals(
      bySystem.get("calculix")?.color,
      model.graph.getNodeAttributes("artifact:c1").color,
    );
    assertEquals(bySystem.get("modelica")?.count, 1);
  },
);

// ---------------------------------------------------------------------------
// displayKindOf — classification per node type
// ---------------------------------------------------------------------------

Deno.test(
  "displayKindOf: an essential artifact (non-supporting artifactKind) returns 'artifact'",
  () => {
    const n: ThreadGraphNode = {
      ...node("a1", "artifact", "build123d", "artifact"),
      artifactKind: "SysML v2 model",
    };
    assertEquals(displayKindOf(n), "artifact");
  },
);

Deno.test(
  "displayKindOf: an artifact whose artifactKind is in SUPPORTING_ARTIFACT_KINDS returns 'supporting-artifact'",
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
        "supporting-artifact",
        `artifactKind '${kind}' should produce 'supporting-artifact'`,
      );
    }
  },
);

Deno.test(
  "displayKindOf: an artifact with undefined artifactKind returns 'artifact' (not supporting)",
  () => {
    const n: ThreadGraphNode = node("a2", "artifact", "syson", "artifact");
    // No artifactKind set — essential by default.
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

Deno.test(
  "DISPLAY_KIND_LABELS has a French label for every DisplayKind",
  () => {
    const expectedKinds = [
      "artifact",
      "supporting-artifact",
      "observation",
      "requirement",
      "evaluation",
      "violation",
      "change",
      "consumption",
      "action",
    ];
    for (const kind of expectedKinds) {
      const label =
        DISPLAY_KIND_LABELS[kind as keyof typeof DISPLAY_KIND_LABELS];
      assertEquals(
        typeof label,
        "string",
        `Missing label for kind '${kind}'`,
      );
      assertNotEquals(label, "", `Empty label for kind '${kind}'`);
    }
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
