import { assertEquals } from "jsr:@std/assert@1.0.14";
import type { StoredConversation } from "../chat/store.ts";
import { NodeChatConversationStore } from "./node-store.ts";

Deno.test("Chat Host persists metadata and bounded transcript outside Thread and CAS", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-store-" });
  try {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const store = new NodeChatConversationStore(root, {
      now: () => now,
      retentionDays: 30,
      maxConversations: 2,
      maxMessagesPerConversation: 1,
    });
    const current = conversation("conversation:current", now.toISOString(), 2);
    const expired = conversation("conversation:expired", "2026-07-01T00:00:00.000Z", 1);
    await store.save([expired, current]);
    const loaded = await store.load();
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].id, current.id);
    assertEquals(loaded[0].messages.map((message) => message.text), ["message 2"]);
    const index = JSON.parse(await Deno.readTextFile(`${root}/conversations.json`));
    assertEquals("messages" in index.conversations[0], false);
    assertEquals(await exists(`${root}/thread`), false);
    assertEquals(await exists(`${root}/cas`), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function conversation(
  id: string,
  updatedAt: string,
  messageCount: number,
): StoredConversation {
  return {
    id,
    projectId: "coffee-machine",
    sessionKey: `casys-desktop-exclusive/coffee-machine/${id}`,
    title: "Project coffee-machine",
    status: "idle",
    createdAt: updatedAt,
    updatedAt,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `message:${index + 1}`,
      role: "assistant" as const,
      kind: "text" as const,
      text: `message ${index + 1}`,
      createdAt: updatedAt,
    })),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
