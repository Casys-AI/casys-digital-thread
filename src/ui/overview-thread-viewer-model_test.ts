import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  resolveOverviewThreadViewerCapabilities,
  uniqueOverviewThreadViewerSession,
} from "./src/project/overview-thread-viewer-model.ts";

Deno.test("overview viewer resolver exposes only generic record navigation", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const node = snapshot.graph.nodes[0]!;

  assertEquals(resolveOverviewThreadViewerCapabilities(snapshot, node), {
    inspectRecord: true,
    openVerification: true,
  });
});

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
