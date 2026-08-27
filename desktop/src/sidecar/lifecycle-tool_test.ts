import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  createLifecycleIdentity,
  DESKTOP_LIFECYCLE_TOOL,
  lifecycleToolResult,
} from "./lifecycle-tool.ts";

Deno.test("lifecycle tool declares and returns only the exact identity fields", () => {
  const identity = createLifecycleIdentity(
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    `sha256:${"ab".repeat(32)}`,
  );
  assertEquals(Object.keys(identity).sort(), [
    "configDigest",
    "launchId",
    "productVersion",
    "schema",
    "serverVersion",
  ]);
  const output = DESKTOP_LIFECYCLE_TOOL.outputSchema;
  assertEquals(output.additionalProperties, false);
  assertEquals([...output.required].sort(), Object.keys(identity).sort());

  const result = lifecycleToolResult(identity);
  assertEquals(result.structuredContent, identity);
  assertEquals(result.content, "Desktop control-plane lifecycle identity observed.");
  assertEquals(result.content.includes(identity.launchId), false);
  assertEquals(result.content.includes(identity.configDigest), false);
});
