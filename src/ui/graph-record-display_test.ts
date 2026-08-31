import { assertEquals } from "@std/assert";
import { displayKindOf } from "./src/thread/graph-record-display.ts";
import type { ThreadGraphNode } from "./src/thread/types.ts";

Deno.test("display classification is the literal recorded entity kind", () => {
  assertEquals(displayKindOf(node("artifact", "artifact", "mesh")), "artifact");
  assertEquals(
    displayKindOf(node("analysis", "analysis-node")),
    "analysis-node",
  );
  assertEquals(
    displayKindOf(node("part", "part-definition")),
    "part-definition",
  );
});

function node(
  id: string,
  entityKind: ThreadGraphNode["entityKind"],
  artifactKind?: string,
): ThreadGraphNode {
  return {
    id: `graph:${id}`,
    ref: { kind: entityKind, id },
    entityKind,
    ...(artifactKind ? { artifactKind } : {}),
    label: id,
    summary: id,
    system: "recorded",
    freshness: "fresh",
  };
}
