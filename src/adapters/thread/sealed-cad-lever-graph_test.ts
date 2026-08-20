import { assertEquals } from "@std/assert";
import type {
  ThreadGraph,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import type { SealedAdmissionCadLever } from "../../domain/compile/admission/sealed-cad-levers.ts";
import {
  projectSealedCadLeverGraph,
  projectSealedUnnamedCadLiteralGraph,
} from "./sealed-cad-lever-graph.ts";

const ADMISSION = "technical-compilation-admission-" + "a".repeat(64);

Deno.test("projectSealedCadLeverGraph paints a uniquely bound lever onto its AttributeUsage", () => {
  const graph = projectSealedCadLeverGraph(baseGraph(), [lever()]);
  const node = graph.nodes.find((item) => item.entityKind === "cad-lever");
  assertEquals(node?.label, "CAD · thickness = 8");
  assertEquals(node?.summary, "named numeric lever · unit undeclared");
  assertEquals(node?.selection, { kind: "artifact", id: ADMISSION });
  const edge = graph.edges.find((item) => item.relation === "parameterizes");
  assertEquals(edge?.from, {
    kind: "cad-lever",
    id: `${ADMISSION}:parameter.thickness`,
  });
  assertEquals(edge?.to, { kind: "attribute-usage", id: "sysml.attr.thickness" });
  assertEquals(edge?.origin, "structure");
});

Deno.test("projectSealedUnnamedCadLiteralGraph hangs constructor photos on the PartDefinition", () => {
  const graph = projectSealedUnnamedCadLiteralGraph(baseGraphWithPart(), [{
    admissionArtifactId: ADMISSION,
    sourceId: "source.cad",
    hostSymbolId: "artifact.result",
    value: 30,
    line: 3,
    column: 13,
    representedPartDefinitionId: "def-hook",
  }]);
  const node = graph.nodes.find((item) => item.entityKind === "cad-unnamed-literal");
  assertEquals(node?.label, "CAD · unnamed 30");
  assertEquals(node?.summary, "constructor literal · no name · unit undeclared");
  const edge = graph.edges.find((item) => item.relation === "unnamed_in");
  assertEquals(edge?.to, { kind: "part-definition", id: "def-hook" });
});

Deno.test("projectSealedCadLeverGraph omits a lever whose AttributeUsage is absent", () => {
  const graph = baseGraph();
  graph.nodes = graph.nodes.filter((node) => node.entityKind !== "attribute-usage");
  assertEquals(projectSealedCadLeverGraph(graph, [lever()]), graph);
});

Deno.test("projectSealedCadLeverGraph fails closed when two levers would share a node id", () => {
  const graph = baseGraph();
  const duplicate = lever();
  assertEquals(
    projectSealedCadLeverGraph(graph, [duplicate, { ...duplicate, value: 9 }]),
    graph,
  );
});

function lever(): SealedAdmissionCadLever {
  return {
    admissionArtifactId: ADMISSION,
    sourceId: "source.cad",
    sourceSymbolId: "parameter.thickness",
    semanticKey: "thickness",
    value: 8,
    parameterBindingId: "binding:thickness",
    parameterSysmlElementId: "sysml.attr.thickness",
  };
}

function baseGraphWithPart(): ThreadGraph {
  return {
    nodes: [
      node("artifact", ADMISSION, "Technical compilation admission"),
      node("part-definition", "def-hook", "WallHook"),
    ],
    edges: [],
  };
}

function baseGraph(): ThreadGraph {
  return {
    nodes: [
      node("artifact", ADMISSION, "Technical compilation admission"),
      node("attribute-usage", "sysml.attr.thickness", "WallHook · thickness"),
    ],
    edges: [],
  };
}

function node(
  kind: ThreadGraphNode["entityKind"],
  id: string,
  label: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    label,
    system: kind === "artifact" ? "digital-thread" : "syson",
    freshness: "fresh",
    summary: label,
    recordedAt: "2026-08-19T00:00:00.000Z",
    selection: { kind: "artifact", id: ADMISSION },
  };
}
