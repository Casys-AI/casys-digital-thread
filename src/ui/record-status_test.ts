import { assertEquals, assertStringIncludes } from "@std/assert";
import { recordStatusVariant } from "./src/project/record-status.ts";

// Isolated from badge.tsx so Deno can type-check the mapping without the UI
// package graph.

Deno.test("record status badges keep planned cancelled and completed as named variants", () => {
  assertEquals(recordStatusVariant("planned"), "secondary");
  assertEquals(recordStatusVariant("cancelled"), "secondary");
  assertEquals(recordStatusVariant("completed"), "success");
});

Deno.test("record status mapping names planned and cancelled instead of a silent fallthrough", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/record-status.ts", import.meta.url),
  );
  assertStringIncludes(source, 'status === "planned"');
  assertStringIncludes(source, 'status === "cancelled"');
});
