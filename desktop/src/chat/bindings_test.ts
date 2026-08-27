import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  CHAT_COMMAND_BINDING,
  CHAT_SNAPSHOT_BINDING,
  type DesktopChatBindingHost,
  registerDesktopChatBindings,
} from "./bindings.ts";
import {
  type ChatConversationDto,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";

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

Deno.test("Chat snapshot without Workbench focus returns no transcript and calls no Host", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  let snapshots = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot() {
        snapshots += 1;
        return Promise.resolve(snapshot(conversation()));
      },
      command: () => Promise.reject(new Error("not used")),
    },
    undefined,
    { currentProjectId: () => Promise.resolve(undefined) },
  );

  const response = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
  });
  assertEquals(response, {
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: "ready",
    conversations: [],
    error: "Chat transcripts require an available Workbench project focus.",
  });
  assertEquals(snapshots, 0);
  assertEquals(JSON.stringify(response).includes("FOREIGN_SECRET"), false);
});

Deno.test("global Chat snapshot filters foreign transcripts and explicit unknown ids call no Host", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  let snapshots = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot() {
        snapshots += 1;
        return Promise.resolve(snapshot(
          conversation("coffee-machine", "conversation:coffee", "CURRENT"),
          conversation("foreign-project", "conversation:foreign", "FOREIGN_SECRET"),
        ));
      },
      command: () => Promise.reject(new Error("not used")),
    },
    undefined,
    { currentProjectId: () => Promise.resolve("coffee-machine") },
  );

  const global = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
  });
  assertEquals(
    (global as { conversations: readonly ChatConversationDto[] }).conversations
      .map((item) => item.id),
    ["conversation:coffee"],
  );
  assertEquals(JSON.stringify(global).includes("FOREIGN_SECRET"), false);
  assertEquals(snapshots, 1);

  const foreign = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
    conversationId: "conversation:foreign",
  });
  assertEquals(
    (foreign as { conversations: readonly ChatConversationDto[] }).conversations,
    [],
  );
  assertEquals(JSON.stringify(foreign).includes("FOREIGN_SECRET"), false);
  assertEquals(snapshots, 1);
});

Deno.test("focus changing while Chat snapshot loads releases zero transcript", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const focus = ["coffee-machine", "other-project"];
  let snapshots = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot() {
        snapshots += 1;
        return Promise.resolve(snapshot(
          conversation("coffee-machine", "conversation:coffee", "CHANGED_SECRET"),
        ));
      },
      command: () => Promise.reject(new Error("not used")),
    },
    undefined,
    { currentProjectId: () => Promise.resolve(focus.shift()) },
  );

  const response = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
  });
  assertEquals(
    (response as { conversations: readonly ChatConversationDto[] }).conversations,
    [],
  );
  assertEquals(JSON.stringify(response).includes("CHANGED_SECRET"), false);
  assertEquals(snapshots, 1);
});

Deno.test("WebView conversation creation is refused out of focus before Chat Host", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const commandInputs: unknown[] = [];
  let snapshots = 0;
  let focusedProjectId: string | undefined = "coffee-machine";
  const host: DesktopChatBindingHost = {
    snapshot() {
      snapshots += 1;
      return Promise.resolve(snapshot());
    },
    command(input) {
      commandInputs.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        conversationId: "conversation:1",
      });
    },
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId: () => Promise.resolve(focusedProjectId) },
  );

  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-out-of-focus",
      command: "conversation.create",
      projectId: "foreign-project",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-out-of-focus",
      ok: false,
      error: "Chat command project does not match the current Workbench project focus.",
    },
  );
  assertEquals(snapshots, 0);
  assertEquals(commandInputs, []);

  focusedProjectId = undefined;
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-without-focus",
      command: "conversation.create",
      projectId: "coffee-machine",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-without-focus",
      ok: false,
      error: "Chat commands require an available Workbench project focus.",
    },
  );
  assertEquals(commandInputs, []);

  focusedProjectId = "coffee-machine";
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-in-focus",
      command: "conversation.create",
      projectId: "coffee-machine",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-in-focus",
      ok: true,
      conversationId: "conversation:1",
    },
  );
  assertEquals(snapshots, 0);
  assertEquals(commandInputs.length, 1);
});

Deno.test("existing conversation commands remain bound to the current focus", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const commandInputs: unknown[] = [];
  let focusedProjectId: string | undefined = "coffee-machine";
  const host: DesktopChatBindingHost = {
    snapshot: () => Promise.resolve(snapshot(conversation())),
    command(input) {
      commandInputs.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        conversationId: "conversation:1",
      });
    },
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId: () => Promise.resolve(focusedProjectId) },
  );
  const request = {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "message-1",
    command: "message.send",
    conversationId: "conversation:1",
    text: "Continue",
  } as const;

  assertEquals(await handlers.get(CHAT_COMMAND_BINDING)?.(request), {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "message-1",
    ok: true,
    conversationId: "conversation:1",
  });
  focusedProjectId = "other-project";
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      ...request,
      requestId: "message-after-focus-change",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "message-after-focus-change",
      ok: false,
      error: "Chat command project does not match the current Workbench project focus.",
    },
  );
  assertEquals(commandInputs.length, 1);
});

Deno.test("focus changing during existing-conversation authorization fails closed", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const focus = ["coffee-machine", "other-project"];
  let commands = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot: () => Promise.resolve(snapshot(conversation())),
      command(input) {
        commands += 1;
        return Promise.resolve({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: input.requestId,
          ok: true,
        });
      },
    },
    undefined,
    { currentProjectId: () => Promise.resolve(focus.shift()) },
  );

  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "changed-mid-command",
      command: "conversation.close",
      conversationId: "conversation:1",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "changed-mid-command",
      ok: false,
      error: "Chat command project does not match the current Workbench project focus.",
    },
  );
  assertEquals(commands, 0);
});

function snapshot(...conversations: readonly ChatConversationDto[]) {
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: "ready" as const,
    conversations: Object.freeze(conversations),
    ...(conversations[0] === undefined
      ? {}
      : { selectedConversationId: conversations[0].id }),
  });
}

function conversation(
  projectId = "coffee-machine",
  id = "conversation:1",
  message?: string,
): ChatConversationDto {
  return Object.freeze({
    id,
    projectId,
    title: "Coffee machine",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: Object.freeze(
      message === undefined ? [] : [{
        id: `message:${id}`,
        role: "assistant" as const,
        kind: "text" as const,
        text: message,
        createdAt: "2026-08-23T00:00:00.000Z",
      }],
    ),
  });
}
