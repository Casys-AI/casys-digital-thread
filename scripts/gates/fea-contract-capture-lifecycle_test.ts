import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { requireCleanCaptureForPersistence } from "./fea-contract-capture-lifecycle.ts";

Deno.test("FEA contract fixture bytes are released only after a clean capture", () => {
  assertEquals(
    requireCleanCaptureForPersistence({
      pendingFixtureText: "fixture-bytes\n",
      runFailure: undefined,
      cleanupFailure: undefined,
    }),
    "fixture-bytes\n",
  );
});

Deno.test("FEA contract cleanup failure blocks persistence even after a valid capture", () => {
  const cleanupFailure = new Error("cleanup failed");
  const thrown = assertThrows(() =>
    requireCleanCaptureForPersistence({
      pendingFixtureText: "fixture-bytes\n",
      runFailure: undefined,
      cleanupFailure,
    })
  );
  assertStrictEquals(thrown, cleanupFailure);
});

Deno.test("FEA contract run failure or missing bytes blocks persistence", () => {
  const runFailure = new Error("solve failed");
  assertStrictEquals(
    assertThrows(() =>
      requireCleanCaptureForPersistence({
        pendingFixtureText: undefined,
        runFailure,
        cleanupFailure: undefined,
      })
    ),
    runFailure,
  );
  assertThrows(
    () =>
      requireCleanCaptureForPersistence({
        pendingFixtureText: undefined,
        runFailure: undefined,
        cleanupFailure: undefined,
      }),
    Error,
    "produced no fixture bytes",
  );
});
