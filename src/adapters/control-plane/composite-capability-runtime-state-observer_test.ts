import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { CompositeCapabilityRuntimeStateObserver } from "./composite-capability-runtime-state-observer.ts";

const MATERIAL = {
  unitId: "casys.syson-stack",
  materialId: "mcp-syson-image",
  imageDigest: "a".repeat(64),
};

Deno.test("composite capability observer refuses duplicate coverage and incomplete owned observations", async () => {
  const observer = { observe: () => Promise.resolve(new Map()) };
  assertThrows(
    () =>
      new CompositeCapabilityRuntimeStateObserver([
        { observer, materialKeys: ["casys.syson-stack\u0000mcp-syson-image"] },
        { observer, materialKeys: ["casys.syson-stack\u0000mcp-syson-image"] },
      ]),
    TypeError,
    "overlap",
  );

  const incomplete = new CompositeCapabilityRuntimeStateObserver([{
    observer,
    materialKeys: ["casys.syson-stack\u0000mcp-syson-image"],
  }]);
  await assertRejects(
    () => incomplete.observe([MATERIAL]),
    Error,
    "did not return its owned requested material",
  );
});

Deno.test("composite capability observer leaves an unowned material literally unavailable", async () => {
  let invoked = 0;
  const observer = new CompositeCapabilityRuntimeStateObserver([{
    observer: {
      observe: () => {
        invoked++;
        return Promise.resolve(new Map());
      },
    },
    materialKeys: [],
  }]);
  assertEquals(await observer.observe([MATERIAL]), new Map());
  assertEquals(invoked, 0);
});

Deno.test("composite capability observer never invokes a slice with no assigned material", async () => {
  const invoked: string[] = [];
  const sysonKey = "casys.syson-stack\u0000mcp-syson-image";
  const calculixKey = "casys.calculix-worker\u0000calculix-worker-image";
  const observer = new CompositeCapabilityRuntimeStateObserver([
    {
      observer: {
        observe: (materials) => {
          invoked.push("compose");
          return Promise.resolve(
            new Map(materials.map((material) => [
              `${material.unitId}\u0000${material.materialId}`,
              { material: "installed" as const, runtime: "inactive" as const },
            ])),
          );
        },
      },
      materialKeys: [sysonKey],
    },
    {
      observer: {
        observe: () => {
          invoked.push("microsandbox");
          return Promise.resolve(new Map());
        },
      },
      materialKeys: [calculixKey],
    },
  ]);
  const observed = await observer.observe([MATERIAL]);
  assertEquals([...observed.keys()], [sysonKey]);
  assertEquals(invoked, ["compose"]);
});
