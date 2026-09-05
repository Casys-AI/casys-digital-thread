import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  displayedGraphEdgeOccurrenceKey,
  graphEdgeSelectionMatches,
  graphRelationAccessibleLabel,
} from "./src/thread/graph-selection-model.ts";
import type { ThreadGraphEdge, ThreadGraphRef } from "./src/thread/types.ts";

function ref(id: string): ThreadGraphRef {
  return { kind: "artifact", id };
}

function edge(id: string, rationale = "Recorded relation"): ThreadGraphEdge {
  return {
    id,
    from: ref("source"),
    to: ref("target"),
    relation: "evidences",
    rationale,
    origin: "provenance",
  };
}

Deno.test("a current relation remaps and highlights across Sigma and SVG", () => {
  const sigmaEdge = edge("recorded-relation");
  const svgEdge = structuredClone(sigmaEdge);
  const selection = {
    kind: "edge" as const,
    id: sigmaEdge.id,
    occurrence: {
      key: displayedGraphEdgeOccurrenceKey(sigmaEdge),
      edge: sigmaEdge,
    },
  };

  assertEquals(
    displayedGraphEdgeOccurrenceKey(svgEdge),
    selection.occurrence.key,
  );
  assertEquals(graphEdgeSelectionMatches(selection, svgEdge), true);
});

Deno.test("relation controls expose endpoints, rationale and an ordinal", () => {
  const label = graphRelationAccessibleLabel(
    edge("duplicate-relation", "Recorded proof handoff"),
    "Solver result",
    "Thickness requirement",
    1,
  );

  assertStringIncludes(label, "evidences");
  assertStringIncludes(label, "Solver result (artifact:source)");
  assertStringIncludes(label, "Thickness requirement (artifact:target)");
  assertStringIncludes(label, "Recorded proof handoff");
  assertStringIncludes(label, "Relation 2");
});
