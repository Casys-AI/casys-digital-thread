import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createHandshake, serializeHandshake } from "./handshake.ts";

Deno.test("the readiness handshake is bounded to identity fields", () => {
  const handshake = createHandshake(
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    `sha256:${"ab".repeat(32)}`,
  );
  const parsed = JSON.parse(serializeHandshake(handshake)) as Record<string, unknown>;
  assertEquals(Object.keys(parsed).sort(), [
    "configDigest",
    "launchId",
    "productVersion",
    "schema",
    "serverVersion",
    "status",
  ]);
  assertEquals(parsed.status, "ready");
  assertEquals(parsed.pid, undefined);
  assertEquals(parsed.path, undefined);
});
