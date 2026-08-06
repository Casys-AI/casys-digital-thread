/**
 * Tests for evidence-exploration-model.ts
 *
 * Invariants under test:
 * 1. deterministicPosition — mêmes entrées, mêmes sorties (deux appels)
 * 2. buildExplorationModel — les arêtes moignons sont marquées edgeType:"stub"
 * 3. buildExplorationModel — la légende reflète les composantes nommées du modèle
 * 4. buildExplorationModel — les couleurs viennent du paramètre CssTokens, jamais codées en dur
 * 5. buildExplorationModel — résultat stable sur deux appels identiques (déterminisme FA2)
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildExplorationModel,
  deterministicPosition,
  FALLBACK_TOKENS,
  type CssTokens,
  type SigmaEdgeAttrs,
  type SigmaNodeAttrs,
} from "./src/thread/evidence-exploration-model.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import {
  buildEvidenceCanvasProjection,
} from "./src/thread/evidence-canvas-model.ts";
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
  relation: ThreadGraphEdge["relation"] = "evidences",
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
  asOf: { snapshotId: "test", revision: 0 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

// ---------------------------------------------------------------------------
// 1. deterministicPosition
// ---------------------------------------------------------------------------

Deno.test("deterministicPosition retourne le même résultat sur deux appels avec la même clé", () => {
  const key = "artifact:cm01-drip-tray-step-r3";
  const first = deterministicPosition(key);
  const second = deterministicPosition(key);
  assertEquals(first.x, second.x);
  assertEquals(first.y, second.y);
});

Deno.test("deterministicPosition retourne des valeurs différentes pour des clés différentes", () => {
  const a = deterministicPosition("artifact:node-a");
  const b = deterministicPosition("artifact:node-b");
  // Il est astronomiquement improbable qu'une collision exacte se produise.
  const sameCoordsUnlikely = a.x === b.x && a.y === b.y;
  assertEquals(sameCoordsUnlikely, false);
});

// ---------------------------------------------------------------------------
// 2. Arêtes moignons → edgeType: "stub"
// ---------------------------------------------------------------------------

Deno.test("les arêtes moignons du modèle sont marquées edgeType:stub dans le graphe sigma", () => {
  // A ← B (instrument) → C : B est un outil analyze.* qui devient un moignon.
  const nodeA = node("A", "artifact", "calculix", "artifact");
  const nodeB = node("B", "artifact", "analyze", "artifact");
  const nodeC = node("C", "artifact", "syson", "requirement");

  const rawGraph = {
    nodes: [nodeA, nodeB, nodeC],
    edges: [
      edge("e1", nodeA.ref, nodeB.ref),
      edge("e2", nodeB.ref, nodeC.ref),
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
  assertEquals(hasStub, true, "La projection doit contenir au moins un moignon");

  const explorationModel = buildExplorationModel(
    evidenceModel,
    projection,
    FALLBACK_TOKENS,
    10,
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
});

// ---------------------------------------------------------------------------
// 3. Légende = composantes nommées du modèle
// ---------------------------------------------------------------------------

Deno.test("la légende contient une entrée par composante visible et pas plus", () => {
  // Deux composantes isolées : syson et calculix.
  const nodeSys = node("SYS-1", "artifact", "syson", "requirement");
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
    10,
  );

  // Deux composantes → deux entrées de légende.
  assertEquals(
    explorationModel.legend.length,
    2,
    "Deux composantes → deux entrées de légende",
  );

  // Chaque entrée doit avoir un nom non vide et un compte de 1.
  for (const item of explorationModel.legend) {
    assertNotEquals(item.name, "", "Le nom de composante ne doit pas être vide");
    assertEquals(item.visibleNodeCount, 1);
  }
});

// ---------------------------------------------------------------------------
// 4. Couleurs issues de CssTokens, pas codées en dur
// ---------------------------------------------------------------------------

Deno.test("nodeColorFor utilise les tokens passés en paramètre, pas des constantes", () => {
  const nodeSys = node("SYS-1", "artifact", "syson", "requirement");
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

  const model = buildExplorationModel(evidenceModel, projection, customTokens, 5);

  let sysonColor: string | undefined;
  model.graph.forEachNode((_key: string, attrs: SigmaNodeAttrs) => {
    if (attrs.node.system === "syson") sysonColor = attrs.color;
  });

  assertEquals(
    sysonColor,
    "#123456",
    "La couleur du noeud syson doit utiliser tokens.cyan",
  );
});

// ---------------------------------------------------------------------------
// 5. Déterminisme FA2 : deux appels avec les mêmes entrées → mêmes positions
// ---------------------------------------------------------------------------

Deno.test("buildExplorationModel produit des positions stables pour les mêmes entrées", () => {
  const nodeA = node("A", "artifact", "calculix", "artifact");
  const nodeB = node("B", "artifact", "syson", "requirement");
  const rawGraph = {
    nodes: [nodeA, nodeB],
    edges: [edge("e1", nodeA.ref, nodeB.ref)],
  };

  const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});
  const projection = buildEvidenceCanvasProjection(
    evidenceModel,
    0,
    undefined,
    new Map(),
  );

  const m1 = buildExplorationModel(evidenceModel, projection, FALLBACK_TOKENS, 20);
  const m2 = buildExplorationModel(evidenceModel, projection, FALLBACK_TOKENS, 20);

  const positions1: Record<string, { x: number; y: number }> = {};
  m1.graph.forEachNode((key: string, attrs: SigmaNodeAttrs) => {
    positions1[key] = { x: attrs.x, y: attrs.y };
  });

  m2.graph.forEachNode((key: string, attrs: SigmaNodeAttrs) => {
    const p1 = positions1[key];
    assertEquals(
      p1 !== undefined,
      true,
      `Noeud ${key} absent du premier appel`,
    );
    assertEquals(
      attrs.x,
      p1!.x,
      `Position x instable pour ${key}`,
    );
    assertEquals(
      attrs.y,
      p1!.y,
      `Position y instable pour ${key}`,
    );
  });
});
