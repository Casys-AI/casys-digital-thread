import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  overviewEffectiveInspection,
  overviewInspectionIsVisualTarget,
  overviewInspectionPresentationRowKey,
} from "./src/project/overview-thread-inspection.ts";
import { flowSegmentState } from "./src/project/overview-thread-d3-flow-highlight.ts";
import {
  buildOverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowEdgeInput,
  type OverviewThreadD3FlowNodeInput,
} from "./src/project/overview-thread-d3-flow-layout.ts";

const SYSML = "group:sysml";
const GEOMETRY = "group:geometry";
const ROOT = "root";
const AIRFRAME = "airframe";
const SYSML_ROOT = `hull-row:${JSON.stringify([SYSML, ROOT])}`;
const SYSML_AIRFRAME = `hull-row:${JSON.stringify([SYSML, AIRFRAME])}`;
const GEOMETRY_ROOT = `hull-row:${JSON.stringify([GEOMETRY, ROOT])}`;
const ARCHITECTURE = "artifact:architecture";
const CAD = "artifact:cad";

const mapped = new Map<string, readonly string[]>([
  [SYSML_ROOT, [ARCHITECTURE]],
  [SYSML_AIRFRAME, []],
  [GEOMETRY_ROOT, [CAD]],
]);

Deno.test("hover overrides retained selection and never unions A with B", () => {
  const selected = overviewEffectiveInspection({
    selectedPresentationRowKey: SYSML_ROOT,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(selected, {
    mode: "selected",
    presentationRowKey: SYSML_ROOT,
    graphKeys: [ARCHITECTURE],
  });
  const hovered = overviewEffectiveInspection({
    hoveredPresentationRowKey: GEOMETRY_ROOT,
    selectedPresentationRowKey: SYSML_ROOT,
    selectedGraphKey: ARCHITECTURE,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(hovered, {
    mode: "hover",
    presentationRowKey: GEOMETRY_ROOT,
    graphKeys: [CAD],
  });
  assertEquals(hovered.graphKeys.includes(ARCHITECTURE), false);
  const restored = overviewEffectiveInspection({
    selectedPresentationRowKey: SYSML_ROOT,
    selectedGraphKey: ARCHITECTURE,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(restored.graphKeys, [ARCHITECTURE]);
});

Deno.test("nav-only hover suppresses selected Thread routes until leave", () => {
  const hovered = overviewEffectiveInspection({
    hoveredPresentationRowKey: SYSML_AIRFRAME,
    selectedPresentationRowKey: GEOMETRY_ROOT,
    selectedGraphKey: CAD,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(hovered.mode, "hover");
  assertEquals(hovered.presentationRowKey, SYSML_AIRFRAME);
  assertEquals(hovered.graphKeys, []);
  const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
    { key: CAD, lane: "geometry", groupKey: "domain:geometry", label: "CAD" },
    {
      key: "observation:fea",
      lane: "physics",
      groupKey: "domain:fea",
      label: "FEA",
    },
  ];
  const edges: readonly OverviewThreadD3FlowEdgeInput[] = [{
    key: "trace",
    fromKey: CAD,
    toKey: "observation:fea",
    pathCount: 1,
    pathKeys: ["trace"],
    emphasis: false,
  }];
  const layout = buildOverviewThreadD3FlowLayout(nodes, edges);
  const segment = layout.segments[0]!;
  assertEquals(
    flowSegmentState(segment, undefined, [], layout.routes, true),
    "muted",
  );
  assertEquals(
    flowSegmentState(segment, CAD, [], layout.routes, false),
    "outgoing",
  );
  assertEquals(
    flowSegmentState(segment, undefined, [], layout.routes, false),
    "default",
  );
});

Deno.test("legacy FlowNode hover overrides a selected structure row", () => {
  const hovered = overviewEffectiveInspection({
    hoveredGraphKey: CAD,
    selectedPresentationRowKey: SYSML_ROOT,
    selectedGraphKey: ARCHITECTURE,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(hovered, {
    mode: "hover",
    graphKey: CAD,
    graphKeys: [CAD],
  });
  assertEquals(hovered.presentationRowKey, undefined);
  assertEquals(hovered.graphKeys.includes(ARCHITECTURE), false);
});

Deno.test("one visual atom: hover overrides retained selection both directions", () => {
  const selectedStructure = overviewEffectiveInspection({
    selectedPresentationRowKey: SYSML_ROOT,
    selectedGraphKey: ARCHITECTURE,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(selectedStructure.graphKey, undefined);
  assertEquals(
    overviewInspectionIsVisualTarget(selectedStructure, {
      presentationRowKey: SYSML_ROOT,
    }),
    true,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(selectedStructure, {
      graphKey: ARCHITECTURE,
    }),
    false,
  );

  const structureThenFlow = overviewEffectiveInspection({
    hoveredGraphKey: CAD,
    selectedPresentationRowKey: SYSML_ROOT,
    selectedGraphKey: ARCHITECTURE,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(structureThenFlow.mode, "hover");
  assertEquals(structureThenFlow.graphKey, CAD);
  assertEquals(structureThenFlow.presentationRowKey, undefined);
  assertEquals(structureThenFlow.graphKeys, [CAD]);
  assertEquals(
    overviewInspectionIsVisualTarget(structureThenFlow, {
      presentationRowKey: SYSML_ROOT,
    }),
    false,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(structureThenFlow, { graphKey: CAD }),
    true,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(structureThenFlow, {
      presentationRowKey: GEOMETRY_ROOT,
      graphKeys: [CAD],
    }),
    true,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(structureThenFlow, {
      graphKey: ARCHITECTURE,
    }),
    false,
  );

  const selectedFlow = overviewEffectiveInspection({
    selectedGraphKey: CAD,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(selectedFlow, {
    mode: "selected",
    graphKey: CAD,
    graphKeys: [CAD],
  });
  assertEquals(
    overviewInspectionIsVisualTarget(selectedFlow, { graphKey: CAD }),
    true,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(selectedFlow, {
      presentationRowKey: GEOMETRY_ROOT,
      graphKeys: [CAD],
    }),
    true,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(selectedStructure, {
      presentationRowKey: SYSML_ROOT,
      graphKeys: [ARCHITECTURE],
    }),
    true,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(selectedStructure, {
      presentationRowKey: GEOMETRY_ROOT,
      graphKeys: [CAD],
    }),
    false,
  );
  assertEquals(
    overviewInspectionPresentationRowKey(selectedFlow, mapped),
    GEOMETRY_ROOT,
  );
  assertEquals(
    overviewInspectionPresentationRowKey(selectedStructure, mapped),
    SYSML_ROOT,
  );

  const flowThenStructure = overviewEffectiveInspection({
    hoveredPresentationRowKey: SYSML_ROOT,
    selectedGraphKey: CAD,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(flowThenStructure.mode, "hover");
  assertEquals(flowThenStructure.presentationRowKey, SYSML_ROOT);
  assertEquals(flowThenStructure.graphKey, undefined);
  assertEquals(flowThenStructure.graphKeys, [ARCHITECTURE]);
  assertEquals(
    overviewInspectionIsVisualTarget(flowThenStructure, { graphKey: CAD }),
    false,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(flowThenStructure, {
      presentationRowKey: SYSML_ROOT,
    }),
    true,
  );

  const structureThenStructure = overviewEffectiveInspection({
    hoveredPresentationRowKey: SYSML_AIRFRAME,
    selectedPresentationRowKey: SYSML_ROOT,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(
    overviewInspectionIsVisualTarget(structureThenStructure, {
      presentationRowKey: SYSML_ROOT,
    }),
    false,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(structureThenStructure, {
      presentationRowKey: SYSML_AIRFRAME,
    }),
    true,
  );

  const flowThenFlow = overviewEffectiveInspection({
    hoveredGraphKey: CAD,
    selectedGraphKey: ARCHITECTURE,
    graphKeysByPresentationRow: mapped,
  });
  assertEquals(
    overviewInspectionIsVisualTarget(flowThenFlow, { graphKey: ARCHITECTURE }),
    false,
  );
  assertEquals(
    overviewInspectionIsVisualTarget(flowThenFlow, { graphKey: CAD }),
    true,
  );
  assertEquals(flowThenFlow.graphKeys.includes(ARCHITECTURE), false);
});

Deno.test("structure rows and FlowNodes bind retained selection separately from visual target", async () => {
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertStringIncludes(flow, "overviewInspectionIsVisualTarget(");
  assertStringIncludes(
    flow,
    "const selected = presentationKey === selectedRowKey;",
  );
  assertStringIncludes(
    flow,
    'data-selected={selected ? "true" : "false"}',
  );
  assertEquals(
    flow.includes("data-inspection-active={inspectionActive"),
    false,
  );
  assertStringIncludes(flow, "aria-pressed={selected}");
  assertEquals(flow.includes("aria-pressed={inspectionActive}"), false);
  assertStringIncludes(flow, "selected={position.key === selectedKey}");
  assertStringIncludes(
    flow,
    "inspectionActive={overviewInspectionIsVisualTarget(inspection, {",
  );
  assertEquals(
    flow.includes('inspectionActive={inspection.mode === "selected" &&'),
    false,
  );
  assertEquals(
    flow.includes('data-state={selected ? "selected"'),
    false,
  );
  assertStringIncludes(flow, "data-state={flowItemVisualState(");
  assertEquals(flow.includes("data-state={inspectionActive"), false);
  assertStringIncludes(flow, "refNode(presentationKey, element)");
  assertStringIncludes(flow, "refNode(key, element)");
  assertStringIncludes(flow, "<FlowItemSurface");
  assertStringIncludes(flow, "whiteboardFlowItem({ density })");
});
