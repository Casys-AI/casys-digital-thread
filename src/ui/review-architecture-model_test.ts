import { assertEquals } from "@std/assert";
import { buildArchitectureBindingRows } from "./src/project/review-architecture-model.ts";

Deno.test("the architecture binding diagram nests DeskLamp by exact definition parent", () => {
  const rows = buildArchitectureBindingRows({
    packageName: "LampPackage",
    system: { name: "DeskLamp" },
    components: [{
      parentName: "DeskLamp",
      usageName: "arm",
      name: "Arm",
    }, {
      parentName: "Arm",
      usageName: "shade",
      name: "Shade",
    }, {
      parentName: "Shade",
      usageName: "led",
      name: "LedModule",
    }],
  });
  assertEquals(rows.map((row) => row.depth), [0, 1, 2]);
});

Deno.test("a reused PartDefinition keeps separate usage rows without duplicating identity", () => {
  const rows = buildArchitectureBindingRows({
    packageName: "LampPackage",
    system: { name: "DeskLamp" },
    components: [{
      parentName: "DeskLamp",
      usageName: "leftFastener",
      name: "Fastener",
    }, {
      parentName: "DeskLamp",
      usageName: "rightFastener",
      name: "Fastener",
    }, {
      parentName: "Fastener",
      usageName: "insert",
      name: "Insert",
    }],
  });
  assertEquals(rows.map((row) => row.component.usageName), [
    "leftFastener",
    "rightFastener",
    "insert",
  ]);
  assertEquals(rows.map((row) => row.depth), [0, 0, 1]);
});
