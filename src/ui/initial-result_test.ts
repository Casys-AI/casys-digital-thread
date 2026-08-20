import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import type { ConsoleSnapshot } from "../application/control-plane/read-model/console-snapshot.ts";
import {
  initialSnapshotFromResult,
  toolResultErrorMessage,
} from "./src/initial-result.ts";

const SNAPSHOT = {
  schemaVersion: "2.0",
  generatedAt: "2026-07-31T00:00:00.000Z",
  mode: "demo",
  fleet: {
    status: "healthy",
    counts: {
      total: 0,
      healthy: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
      drift: 0,
    },
    servers: [],
  },
  runs: { items: [] },
} as ConsoleSnapshot;

Deno.test("console initial result consumes host structuredContent, never text", () => {
  const snapshot = initialSnapshotFromResult({
    content: [{ type: "text", text: "not a console snapshot" }],
    structuredContent: SNAPSHOT,
  });

  assertStrictEquals(snapshot, SNAPSHOT);
});

Deno.test("console initial result rejects malformed payloads and preserves MCP errors", () => {
  assertThrows(
    () =>
      initialSnapshotFromResult({
        content: [{ type: "text", text: "denied" }],
        isError: true,
      }),
    Error,
    "denied",
  );
  assertThrows(
    () =>
      initialSnapshotFromResult({
        structuredContent: { schemaVersion: "2.0" },
      }),
    Error,
    "structuredContent",
  );
  assertEquals(
    toolResultErrorMessage({ content: [{ type: "image" }] }),
    undefined,
  );
});
