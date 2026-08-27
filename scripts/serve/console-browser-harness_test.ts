import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("preview:browser source refuses the retired Console human surface", async () => {
  const source = await Deno.readTextFile(
    new URL("./console-browser-harness.ts", import.meta.url),
  );
  assertStringIncludes(source, "retired");
  assertStringIncludes(source, "preview:thread");
  assertStringIncludes(source, "console_snapshot");
  assertStringIncludes(source, "Deno.exit(1)");
  assertEquals(source.includes("Deno.serve"), false);
  assertEquals(source.includes("ui://casys-digital-thread/console"), false);
});
