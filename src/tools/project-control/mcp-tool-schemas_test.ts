import { assertEquals } from "@std/assert";
import { OPERATION_REF_SCHEMA, PROJECT_ID } from "./mcp-tool-schemas.ts";

Deno.test("PROJECT_ID schema refuses latest and requires a safe identifier", () => {
  assertEquals(PROJECT_ID.pattern, "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$");
  assertEquals(PROJECT_ID.not, { const: "latest" });
});

Deno.test("OPERATION_REF_SCHEMA.version refuses latest", () => {
  const version = OPERATION_REF_SCHEMA.properties.version;
  assertEquals(version.not, { const: "latest" });
});
