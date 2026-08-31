import { assertEquals } from "@std/assert";
import {
  uniqueOverviewThreadViewerSession,
} from "./src/project/overview-thread-viewer-model.ts";

Deno.test("overview opens no App action when an exact anchor is unavailable or ambiguous", () => {
  const first = { id: "session-a" };
  const second = { id: "session-b" };
  assertEquals(uniqueOverviewThreadViewerSession([]), undefined);
  assertEquals(uniqueOverviewThreadViewerSession([first]), first);
  assertEquals(
    uniqueOverviewThreadViewerSession([first, second]),
    undefined,
  );
});
