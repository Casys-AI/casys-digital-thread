import { assertEquals } from "@std/assert";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import { COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE } from "./src/project/fixture.ts";
import {
  nextLiveFocusNode,
  shouldAcceptWorkbenchUpdate,
} from "./src/thread/live-update.ts";
import type { EngineeringWorkbenchSnapshot } from "./src/thread/types.ts";

Deno.test("same-id projection focuses a genuinely new feed node", () => {
  const previous = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const incoming = structuredClone(previous);
  incoming.graph.nodes.push({
    id: "graph:artifact:cad-live",
    ref: { kind: "artifact", id: "cad-live" },
    entityKind: "artifact",
    artifactKind: "cad-model",
    label: "CoffeeMachine CAD assembly",
    system: "mcp-build123d",
    freshness: "running",
    summary: "Generating from observed SysML dimensions",
    recordedAt: "2026-08-01T10:00:00.000Z",
    selection: { kind: "artifact", id: "cad-live" },
  });

  assertEquals(incoming.id, previous.id);
  assertEquals(nextLiveFocusNode(previous, incoming)?.ref.id, "cad-live");
});

Deno.test("same-id in-place update preserves current focus", () => {
  const previous = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const incoming = structuredClone(previous);
  incoming.graph.nodes[0].freshness = "running";
  incoming.graph.nodes[0].summary = "Rereading current SysML element";

  assertEquals(incoming.id, previous.id);
  assertEquals(nextLiveFocusNode(previous, incoming), undefined);
});

Deno.test("delayed SSE cannot overwrite an immediate project command response", () => {
  const fixture = structuredClone(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE);
  const current = { ...fixture, project: { ...fixture.project, revision: 3 } };
  const delayed = { ...fixture, project: { ...fixture.project, revision: 2 } };

  assertEquals(shouldAcceptWorkbenchUpdate(current, delayed), false);
});

Deno.test("equal project revision accepts a newer thread or live sequence only", () => {
  const current = withLiveVersion(
    structuredClone(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE),
    4,
  );
  const newerLive = withLiveVersion(structuredClone(current), 5);
  const duplicate = withLiveVersion(structuredClone(current), 4);
  const newerThread = {
    ...structuredClone(current),
    alignment: {
      ...current.alignment,
      currentThreadRevision: current.alignment.currentThreadRevision + 1,
    },
  };

  assertEquals(shouldAcceptWorkbenchUpdate(current, newerLive), true);
  assertEquals(shouldAcceptWorkbenchUpdate(current, newerThread), true);
  assertEquals(shouldAcceptWorkbenchUpdate(current, duplicate), false);
});

function withLiveVersion(
  snapshot: EngineeringWorkbenchSnapshot,
  version: number,
): EngineeringWorkbenchSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      live: { version, active: [], schemaVersion: "live-thread-overlay/1.0" },
    } as EngineeringWorkbenchSnapshot["thread"],
  };
}
