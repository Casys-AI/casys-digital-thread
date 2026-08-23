import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  CHAT_COMMAND_BINDING,
  CHAT_SNAPSHOT_BINDING,
  registerDesktopChatBindings,
} from "./bindings.ts";
import { DESKTOP_CHAT_PROTOCOL } from "./contracts.ts";

Deno.test("Desktop registers only two narrow, versioned Chat bindings", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  registerDesktopChatBindings({
    bind(name, handler) {
      handlers.set(name, handler);
    },
  });
  assertEquals([...handlers.keys()], [CHAT_SNAPSHOT_BINDING, CHAT_COMMAND_BINDING]);
  assertEquals(
    await handlers.get(CHAT_SNAPSHOT_BINDING)?.({ protocol: DESKTOP_CHAT_PROTOCOL }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      host: "unavailable",
      conversations: [],
      error: "The packaged Chat Host is unavailable.",
    },
  );
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-1",
      command: "conversation.create",
      projectId: "coffee-machine",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-1",
      ok: false,
      error: "The packaged Chat Host is unavailable.",
    },
  );
  await assertRejects(() =>
    Promise.resolve(
      handlers.get(CHAT_COMMAND_BINDING)?.({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-2",
        command: "message.send",
        conversationId: "conversation:1",
        text: "",
      }),
    )
  );
});

Deno.test("external URL command stays on the Desktop binding capability", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const opened: string[] = [];
  registerDesktopChatBindings(
    {
      bind(name, handler) {
        handlers.set(name, handler);
      },
    },
    undefined,
    {
      open(url) {
        opened.push(url);
        return Promise.resolve();
      },
    },
  );
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "external-1",
      command: "external.open",
      url: "https://example.com/confirm",
    }),
    { protocol: DESKTOP_CHAT_PROTOCOL, requestId: "external-1", ok: true },
  );
  assertEquals(opened, ["https://example.com/confirm"]);
});
