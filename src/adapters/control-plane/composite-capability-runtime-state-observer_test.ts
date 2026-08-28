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
  const observer = new CompositeCapabilityRuntimeStateObserver([{
    observer: { observe: () => Promise.resolve(new Map()) },
    materialKeys: [],
  }]);
  assertEquals(await observer.observe([MATERIAL]), new Map());
});
