import { assertEquals, assertThrows } from "@std/assert";
import { requireFinalizerOutputDirectory } from "./finalize-coffee-machine-cm01-v3-local.ts";

Deno.test("CM-01 V3 finalizer accepts exactly one explicit direct run directory", () => {
  assertEquals(
    requireFinalizerOutputDirectory(
      "state/local/cm01-v3-local-runs/2026-08-03T10-46-20-657Z/",
    ),
    "state/local/cm01-v3-local-runs/2026-08-03T10-46-20-657Z",
  );
});

Deno.test("CM-01 V3 finalizer refuses aliases, traversal, and nested run paths", () => {
  for (
    const path of [
      "state/local/cm01-v3-local-runs",
      "state/local/cm01-v3-local-runs/../other",
      "state/local/cm01-v3-local-runs/run/nested",
      "/tmp/cm01-v3-local-runs/run",
    ]
  ) {
    assertThrows(
      () => requireFinalizerOutputDirectory(path),
      Error,
      "direct child",
    );
  }
});
