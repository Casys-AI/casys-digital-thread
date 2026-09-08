import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  overviewEffectiveInspection,
  overviewInspectionIsRelatedRow,
  overviewInspectionRelatedGraphKeys,
} from "./src/project/overview-thread-inspection.ts";

Deno.test("route endpoint illumination follows exact mapped rows, not labels or hull membership", () => {
  const selected = overviewEffectiveInspection({
    selectedGraphKey: "claim:camera",
  });
  const related = new Set(["claim:camera", "brief:r2:camera", "part:camera"]);
  assertEquals(
    overviewInspectionIsRelatedRow(selected, "brief:camera", [
      "brief:r2:camera",
    ], related),
    true,
  );
  assertEquals(
    overviewInspectionIsRelatedRow(selected, "brief:camera-old", [
      "brief:r1:camera",
    ], related),
    false,
  );
  assertEquals(
    overviewInspectionIsRelatedRow(selected, "brief:section", [], related),
    false,
  );
  assertEquals(
    overviewInspectionIsRelatedRow(
      selected,
      "part:airframe",
      ["part:airframe"],
      related,
    ),
    false,
  );
});

Deno.test("idle and the selected presentation row do not receive the connected-row style", () => {
  const related = new Set(["part:camera"]);
  assertEquals(
    overviewInspectionIsRelatedRow(overviewEffectiveInspection({}), "camera", [
      "part:camera",
    ], related),
    false,
  );
  const selected = overviewEffectiveInspection({
    selectedPresentationRowKey: "camera",
    graphKeysByPresentationRow: new Map([["camera", ["part:camera"]]]),
  });
  assertEquals(
    overviewInspectionIsRelatedRow(
      selected,
      "camera",
      ["part:camera"],
      related,
    ),
    false,
  );
});

Deno.test("a graph-backed structured row is the visual target, not a related ring", () => {
  const related = new Set(["part:camera", "brief:r2:camera"]);
  const selectedGraph = overviewEffectiveInspection({
    selectedGraphKey: "part:camera",
  });
  assertEquals(
    overviewInspectionIsRelatedRow(
      selectedGraph,
      "camera",
      ["part:camera"],
      related,
    ),
    false,
  );
  assertEquals(
    overviewInspectionIsRelatedRow(
      selectedGraph,
      "brief:camera",
      ["brief:r2:camera"],
      related,
    ),
    true,
  );
});

Deno.test("related destinations are weaker than selected and idle stays unmarked", async () => {
  const interaction = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-item-interaction.ts",
      import.meta.url,
    ),
  );
  assertStringIncludes(interaction, 'if (inspectionActive) return "selected"');
  assertStringIncludes(interaction, 'if (!inspecting) return "default"');
  assertStringIncludes(
    interaction,
    'return related ? "related" : "muted"',
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const relatedTint =
    "data-[state=related]:bg-[color-mix(in_srgb,var(--flow-color)_4%,transparent)]";
  const selectedTint =
    "data-[state=selected]:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]";
  const relatedHalo =
    "group-data-[state=related]:shadow-[0_0_0_2px_#fff,0_0_0_3px_color-mix(in_srgb,var(--flow-color)_26%,transparent)]";
  const selectedHalo =
    "group-data-[state=selected]:shadow-[0_0_0_2px_#fff,0_0_0_4px_color-mix(in_srgb,var(--flow-color)_48%,transparent)]";
  assertStringIncludes(recipes, relatedTint);
  assertStringIncludes(recipes, selectedTint);
  assertStringIncludes(recipes, relatedHalo);
  assertStringIncludes(recipes, selectedHalo);
  assertEquals(recipes.includes("ring-primary"), false);
  assertEquals(recipes.includes("whiteboardRelatedRow"), false);
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertEquals(flow.split("flowItemVisualState(").length - 1, 2);
  assertStringIncludes(flow, 'inspection.mode !== "idle"');
});

Deno.test("connected rows match the lit incident routes without order-dependent transitive expansion", () => {
  const routes = [
    { fromKey: "a", toKey: "b" },
    { fromKey: "b", toKey: "c" },
  ];
  assertEquals([...overviewInspectionRelatedGraphKeys(routes, ["a"])].sort(), [
    "a",
    "b",
  ]);
  assertEquals(
    [...overviewInspectionRelatedGraphKeys([...routes].reverse(), ["a"])]
      .sort(),
    ["a", "b"],
  );
});
