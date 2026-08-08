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

function edge(
  id: string,
  rationale = "via folded Analyze instrument — replié",
): ThreadGraphEdge {
  return {
    id,
    from: ref("source"),
    to: ref("target"),
    relation: "evidences",
    rationale,
    origin: "provenance",
  };
}

Deno.test("a current stub remaps and highlights across Sigma and SVG", () => {
  const sigmaStub = edge("stub:artifact:source->artifact:target");
  const svgStub = structuredClone(sigmaStub);
  const selection = {
    kind: "edge" as const,
    id: sigmaStub.id,
    occurrence: {
      key: displayedGraphEdgeOccurrenceKey(sigmaStub),
      edge: sigmaStub,
    },
  };

  assertEquals(
    displayedGraphEdgeOccurrenceKey(svgStub),
    selection.occurrence.key,
  );
  assertEquals(graphEdgeSelectionMatches(selection, svgStub), true);
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
