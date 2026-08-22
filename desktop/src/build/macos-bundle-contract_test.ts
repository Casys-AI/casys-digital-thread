import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  assertMacosBundleStrings,
  expectedMacosBundleStrings,
  MACOS_MINIMUM_SYSTEM_VERSION,
} from "./macos-bundle-contract.ts";

Deno.test("macOS bundle metadata uses the exact executable deployment target", () => {
  const expected = expectedMacosBundleStrings({
    identifier: "ai.casys.digital-thread",
    version: "0.2.0",
  });

  assertEquals(MACOS_MINIMUM_SYSTEM_VERSION, "14.0");
  assertEquals(expected.LSMinimumSystemVersion, "14.0");
  assertMacosBundleStrings(expected, expected);

  assertThrows(
    () =>
      assertMacosBundleStrings({
        ...expected,
        LSMinimumSystemVersion: "10.15",
      }, expected),
    Error,
    "LSMinimumSystemVersion",
  );
});
