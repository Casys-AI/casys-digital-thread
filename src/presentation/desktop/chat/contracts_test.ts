import { assertEquals, assertThrows } from "@std/assert";
import { DESKTOP_CHAT_PROTOCOL, parseChatSnapshotDto } from "./contracts.ts";

function conversation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "conv-1",
    kind: "standalone",
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

function snapshotWith(
  ...conversations: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: "ready",
    conversations: [...conversations],
    connectableMcps: [],
  };
}

Deno.test("snapshot accepts a standalone conversation without a projectId", () => {
  const parsed = parseChatSnapshotDto(snapshotWith(conversation()));
  assertEquals(parsed.conversations.length, 1);
  assertEquals(parsed.conversations[0]?.kind, "standalone");
});

Deno.test("snapshot accepts a project conversation with a valid projectId", () => {
  const parsed = parseChatSnapshotDto(
    snapshotWith(
      conversation({
        kind: "project",
        projectId: "proj-123",
        title: "proj-123",
      }),
    ),
  );
  assertEquals(parsed.conversations[0]?.projectId, "proj-123");
});

Deno.test("snapshot rejects a standalone conversation carrying a projectId", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(conversation({ projectId: "proj-123" })),
      ),
    TypeError,
    "standalone conversation must not have a projectId",
  );
});

Deno.test("snapshot rejects a project conversation without a projectId", () => {
  assertThrows(
    () => parseChatSnapshotDto(snapshotWith(conversation({ kind: "project" }))),
    TypeError,
    "project conversation requires a projectId",
  );
});

Deno.test("snapshot rejects a projectId outside the closed identifier contract", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(
          conversation({ kind: "project", projectId: "not a project!" }),
        ),
      ),
    TypeError,
    "projectId must be an explicit Casys project identifier",
  );
});
