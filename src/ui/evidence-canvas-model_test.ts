import { assertEquals } from "@std/assert";
import {
  buildEvidenceCanvasProjection,
  buildExplorationKindProjection,
  linkedEvidenceDetail,
  makeEvidenceComponentLabeler,
  paintedDossierMetric,
} from "./src/thread/evidence-canvas-model.ts";
import type { DisplayKind } from "./src/thread/graph-record-display.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

const EMPTY_FAMILY_GRAPH: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "test", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

Deno.test("generic evidence canvas never folds by provider, id prefix or artifact kind", () => {
  const nodes = [
    node("sensitivity-case-a", "artifact", "build123d", "solver-result"),
    node("middle", "consumption", "calculix"),
    node("result", "observation", "syson"),
  ];
  const edges = [
    edge("one", nodes[0]!.ref, nodes[1]!.ref),
    edge("two", nodes[1]!.ref, nodes[2]!.ref),
  ];
  const model = buildEvidenceGraphModel(
    { nodes, edges },
    EMPTY_FAMILY_GRAPH,
  );
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );

  assertEquals(projection.nodes, nodes);
  assertEquals(projection.edges, edges);
  assertEquals(projection.hiddenByKindCount, 0);
});

Deno.test("local evidence view is a generic bounded recorded neighbourhood", () => {
  const nodes = ["a", "b", "c", "d"].map((id) =>
    node(id, "artifact", "recorded-system")
  );
  const model = buildEvidenceGraphModel({
    nodes,
    edges: [
      edge("ab", nodes[0]!.ref, nodes[1]!.ref),
      edge("bc", nodes[1]!.ref, nodes[2]!.ref),
      edge("cd", nodes[2]!.ref, nodes[3]!.ref),
    ],
  }, EMPTY_FAMILY_GRAPH);
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    nodes[0]!.ref,
    new Map(),
  );

  assertEquals(projection.isFiltered, true);
  assertEquals(projection.nodes.map((item) => item.ref.id), [
    "a",
    "b",
    "c",
    "d",
  ]);
  assertEquals(projection.localDepthByRefKey?.get("artifact:a"), 0);
  assertEquals(projection.localDepthByRefKey?.get("artifact:d"), 3);
});

Deno.test("kind filter uses literal recorded entity kinds", () => {
  const artifact = node("artifact", "artifact", "build123d", "mesh");
  const observation = node("observation", "observation", "calculix");
  const model = buildEvidenceGraphModel({
    nodes: [artifact, observation],
    edges: [edge("relation", artifact.ref, observation.ref)],
  }, EMPTY_FAMILY_GRAPH);
  const kinds = allKinds(true);
  kinds.artifact = false;
  const projection = buildExplorationKindProjection(model, kinds);

  assertEquals(projection.nodes.map((item) => item.ref.id), ["observation"]);
  assertEquals(projection.edges, []);
});

Deno.test("component labels and dossier metrics remain graph-derived", () => {
  const record = node("record", "artifact", "digital-thread");
  const model = buildEvidenceGraphModel(
    { nodes: [record], edges: [] },
    EMPTY_FAMILY_GRAPH,
  );
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );
  const label = makeEvidenceComponentLabeler(model, true)([record], 0);

  assertEquals(label.length > 0, true);
  assertEquals(paintedDossierMetric(model, projection), {
    itemCount: 1,
    componentCount: 1,
  });
  assertEquals(linkedEvidenceDetail(1), "in 1 linked dossier");
});

function allKinds(value: boolean): Record<DisplayKind, boolean> {
  return {
    artifact: value,
    consumption: value,
    observation: value,
    requirement: value,
    evaluation: value,
    violation: value,
    change: value,
    action: value,
    "analysis-node": value,
    "part-definition": value,
    "part-usage": value,
    "attribute-usage": value,
  };
}

function node(
  id: string,
  entityKind: ThreadGraphRef["kind"],
  system: string,
  artifactKind?: string,
): ThreadGraphNode {
  return {
    id: `graph:${entityKind}:${id}`,
    ref: { kind: entityKind, id },
    entityKind,
    ...(artifactKind ? { artifactKind } : {}),
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
