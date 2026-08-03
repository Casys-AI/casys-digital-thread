import { assertEquals, assertRejects } from "@std/assert";
import {
  CockpitFocusConflictError,
  FileCockpitFocusStore,
} from "./file-cockpit-focus-store.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../domain/cockpit-focus.ts";

Deno.test("file cockpit focus keeps an append-only CAS target and exact retries", async () => {
  const directory = await Deno.makeTempDir({ prefix: "cockpit-focus-" });
  try {
    const store = new FileCockpitFocusStore(directory);
    const first = focus(1, "focus-discovery", {
      kind: "discovery",
      discoveryId: "drone-concept",
    });
    assertEquals(await store.select(first, 0), first);
    assertEquals(await store.select(first, 0), first);
    await assertRejects(
      () =>
        store.select({ ...first, target: { kind: "project", projectId: "drone" } }, 0),
      CockpitFocusConflictError,
      "different arguments",
    );
    const second = focus(2, "focus-project", {
      kind: "project",
      projectId: "drone",
    });
    assertEquals(await store.select(second, 1), second);
    assertEquals((await store.get("primary"))?.target, second.target);
    await assertRejects(
      () => store.select(first, 2),
      CockpitFocusConflictError,
      "cannot be reused after later focus revision 2",
    );
    await assertRejects(
      () => store.select(focus(3, "stale", { kind: "project", projectId: "other" }), 1),
      CockpitFocusConflictError,
      "current revision is 2",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function focus(
  revision: number,
  commandId: string,
  target: { kind: "discovery"; discoveryId: string } | {
    kind: "project";
    projectId: string;
  },
) {
  return {
    schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
    workspaceId: "primary",
    revision,
    commandId,
    selectedAt: "2026-08-03T12:00:00.000Z",
    selectedBy: { kind: "agent" as const, actorId: "mcp:test@1" },
    target,
    ...(revision === 1 ? {} : { previous: { revision: revision - 1 } }),
  } as const;
}
