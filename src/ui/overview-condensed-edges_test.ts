import { assertEquals } from "@std/assert";
import {
  condenseEdgesThroughHiddenNodes,
} from "./src/project/overview-condensed-edges.ts";
import type { ThreadGraphEdge } from "./src/thread/types.ts";

Deno.test("hidden SPICE result connectors keep visible observations linked", () => {
  const edges: ThreadGraphEdge[] = [
    edge("cad-to-result", "artifact", "cad", "artifact", "spice-result"),
    edge("result-to-obs", "artifact", "spice-result", "observation", "v-led"),
  ];
  const condensed = condenseEdgesThroughHiddenNodes(
    new Set(["artifact:cad", "observation:v-led"]),
    edges,
  );
  assertEquals(condensed.length, 1);
  assertEquals(condensed[0]?.from, { kind: "artifact", id: "cad" });
  assertEquals(condensed[0]?.to, { kind: "observation", id: "v-led" });
  assertEquals(condensed[0]?.via, ["artifact:spice-result"]);
});

Deno.test("condensation never invents an edge when no exact path exists", () => {
  const edges: ThreadGraphEdge[] = [
    edge("cad-to-hidden", "artifact", "cad", "artifact", "hidden"),
    edge("other-to-obs", "artifact", "other", "observation", "v-led"),
  ];
  const condensed = condenseEdgesThroughHiddenNodes(
    new Set(["artifact:cad", "observation:v-led"]),
    edges,
  );
  assertEquals(condensed, []);
});

function edge(
  id: string,
  fromKind: "artifact" | "observation",
  fromId: string,
  toKind: "artifact" | "observation",
  toId: string,
): ThreadGraphEdge {
  return {
    id,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation: "derived_from",
    origin: "provenance",
    rationale: "Recorded consumption.",
  };
}
