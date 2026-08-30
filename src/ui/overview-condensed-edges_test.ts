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

Deno.test("direct visible occurrences survive duplicate domain edge ids", () => {
  const first = edge(
    "duplicate-handoff",
    "artifact",
    "cad",
    "observation",
    "stress",
  );
  const condensed = condenseEdgesThroughHiddenNodes(
    new Set(["artifact:cad", "observation:stress"]),
    [first, structuredClone(first)],
  );

  assertEquals(condensed.length, 2);
  assertEquals(new Set(condensed.map((item) => item.key)).size, 2);
  assertEquals(condensed.map((item) => item.via), [[], []]);
  assertEquals(
    condensed.map((item) => [item.from, item.to]),
    [
      [
        { kind: "artifact", id: "cad" },
        { kind: "observation", id: "stress" },
      ],
      [
        { kind: "artifact", id: "cad" },
        { kind: "observation", id: "stress" },
      ],
    ],
  );
});

Deno.test("massive hidden branching projects one deterministic witness instead of every simple path", () => {
  const edges: ThreadGraphEdge[] = [];
  const width = 5;
  const layerCount = 6;
  const hidden = (layer: number, index: number) => `hidden-${layer}-${index}`;

  for (let index = 0; index < width; index++) {
    edges.push(
      edge(
        `source-${index}`,
        "artifact",
        "source",
        "artifact",
        hidden(1, index),
      ),
    );
  }
  for (let layer = 1; layer < layerCount; layer++) {
    for (let from = 0; from < width; from++) {
      for (let to = 0; to < width; to++) {
        edges.push(
          edge(
            `layer-${layer}-${from}-${to}`,
            "artifact",
            hidden(layer, from),
            "artifact",
            hidden(layer + 1, to),
          ),
        );
      }
    }
  }
  for (let index = 0; index < width; index++) {
    edges.push(
      edge(
        `target-${index}`,
        "artifact",
        hidden(layerCount, index),
        "observation",
        "target",
      ),
    );
  }

  const visible = new Set(["artifact:source", "observation:target"]);
  const projected = condenseEdgesThroughHiddenNodes(visible, edges);
  const reversed = condenseEdgesThroughHiddenNodes(
    visible,
    edges.toReversed(),
  );

  // There are 5^6 = 15,625 simple source-to-target paths in this DAG.
  assertEquals(projected.length, 1);
  assertEquals(projected, reversed);
  assertEquals(projected[0]?.via, [
    "artifact:hidden-1-0",
    "artifact:hidden-2-0",
    "artifact:hidden-3-0",
    "artifact:hidden-4-0",
    "artifact:hidden-5-0",
    "artifact:hidden-6-0",
  ]);
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
