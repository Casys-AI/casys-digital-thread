import { assertEquals } from "@std/assert";
import { flowSegmentState } from "./src/project/overview-thread-d3-flow-highlight.ts";
import {
  buildOverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowEdgeInput,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowNodeInput,
} from "./src/project/overview-thread-d3-flow-layout.ts";

Deno.test(
  "hovering one endpoint lights the exact branch, shared trunk, and far branch",
  () => {
    const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "artifact:cad-a",
        lane: "geometry",
        groupKey: "domain:geometry",
        label: "CAD A",
      },
      {
        key: "artifact:cad-b",
        lane: "geometry",
        groupKey: "domain:geometry",
        label: "CAD B",
      },
      {
        key: "observation:fea",
        lane: "physics",
        groupKey: "domain:fea",
        label: "FEA",
      },
    ];
    const edges: readonly OverviewThreadD3FlowEdgeInput[] = [
      {
        key: "trace:a>fea",
        fromKey: "artifact:cad-a",
        toKey: "observation:fea",
        pathCount: 1,
        pathKeys: ["trace:a>fea"],
        emphasis: false,
      },
      {
        key: "trace:b>fea",
        fromKey: "artifact:cad-b",
        toKey: "observation:fea",
        pathCount: 1,
        pathKeys: ["trace:b>fea"],
        emphasis: false,
      },
    ];
    const layout = buildOverviewThreadD3FlowLayout(nodes, edges);
    const routeA = layout.routes.find((route) => route.edgeKey === "trace:a>fea");
    const routeB = layout.routes.find((route) => route.edgeKey === "trace:b>fea");
    assertEquals(Boolean(routeA && routeB), true);
    assertEquals(routeA!.segmentKeys[1], routeB!.segmentKeys[1]);
    const chain = routeA!.segmentKeys.map((key) =>
      layout.segments.find((segment) => segment.key === key)!
    );
    assertEquals(
      chain.map((segment) =>
        flowSegmentState(segment, "artifact:cad-a", [], layout.routes)
      ),
      ["outgoing", "outgoing", "outgoing"],
    );
    const otherSource = layout.segments.find((segment) =>
      segment.key === routeB!.segmentKeys[0]
    )!;
    assertEquals(
      flowSegmentState(otherSource, "artifact:cad-a", [], layout.routes),
      "muted",
    );
    assertEquals(
      overviewThreadD3FlowGroupIdentity("geometry", "domain:geometry") !==
        overviewThreadD3FlowGroupIdentity("physics", "domain:fea"),
      true,
    );
  },
);
