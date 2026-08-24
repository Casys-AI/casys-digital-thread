import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { ChatCoordinator } from "./coordinator.ts";
import {
  type ChatCommandRequest,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import type {
  ChatRuntimeAdapter,
  ChatRuntimePort,
  RuntimeElicitationResponse,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeInteractionSink,
  RuntimeTurn,
  RuntimeTurnResult,
} from "./runtime-port.ts";
import { MemoryChatConversationStore } from "./store.ts";

Deno.test("ChatCoordinator binds one project, streams sanitized events, and preserves FIFO", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");

  await coordinator.command(send("r1", conversationId, "First"));
  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => adapter.turns.length === 1);
  assertEquals(
    adapter.turns[0].text,
    "Bound Casys projectId: coffee-machine\n\nHuman message:\nFirst",
  );
  adapter.turns[0].events.push({ type: "text_delta", text: "Answer one" });
  adapter.turns[0].finish({ status: "completed" });

  await until(() => adapter.turns.length === 2);
  assertEquals(adapter.maxConcurrent, 1);
  adapter.turns[1].events.push({
    type: "tool_call",
    text: "ignored raw summary",
    title: "Review project brief",
    status: "completed",
    kind: "read",
  });
  adapter.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const conversation = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(conversation.projectId, "coffee-machine");
  assertEquals(conversation.messages.map((message) => message.text), [
    "First",
    "Second",
    "Answer one",
    "Review project brief — completed",
  ]);
  assertEquals(
    adapter.ensureInputs[0].sessionKey.startsWith(
      "casys-desktop-exclusive/coffee-machine/conversation:",
    ),
    true,
  );
  assertMatch(
    adapter.ensureInputs[0].sessionOptions.systemPrompt,
    /exclusively bound to projectId coffee-machine/,
  );
  await coordinator.stop();
});

Deno.test("permission is separate from MRTR, correlated, and late replies fail closed", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Inspect the project"));
  await until(() => adapter.turns.length === 1);

  const permission = coordinator.requestPermission({
    sessionId: "agent-session-1",
    inferredKind: "read",
    raw: {
      toolCall: {
        toolCallId: "tool-1",
        title: "Read project status",
        kind: "read",
      },
      options: [
        { name: "Allow once", kind: "allow_once" },
        { name: "Reject", kind: "reject_once" },
      ],
    },
  }, new AbortController().signal);
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction !==
      undefined
  );
  const pending = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  assertEquals(pending?.type, "permission");
  if (pending?.type !== "permission") throw new Error("missing permission");
  assertMatch(pending.detail, /not an MRTR engineering decision/);

  const response = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "permission-reply",
    command: "permission.resolve",
    conversationId,
    correlationId: pending.correlationId,
    decision: "allow_once",
  });
  assert(response.ok);
  assertEquals(await permission, { outcome: "allow_once" });

  const late = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "late-reply",
    command: "permission.resolve",
    conversationId,
    correlationId: pending.correlationId,
    decision: "allow_once",
  });
  assertEquals(late.ok, false);
  adapter.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("form and URL elicitation accept, abort, and reject stale replies", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Approve a decision"));
  await until(() => adapter.turns.length === 1);
  const turn = adapter.turns[0];

  assertEquals(
    await turn.elicit({
      mode: "form",
      message: "Wrong session",
      sessionId: "foreign-session",
      requestedSchema: { type: "object", properties: {} },
    }, "rpc-mismatch"),
    { action: "cancel" },
  );
  assertEquals(
    await turn.elicit({
      mode: "form",
      message: "Unsafe schema",
      sessionId: "agent-session-1",
      requestedSchema: {
        type: "object",
        properties: { value: { type: "string", pattern: "(a|aa)+$" } },
      },
    }, "rpc-unsafe-pattern"),
    { action: "cancel" },
  );

  const formPromise = turn.elicit({
    mode: "form",
    message: "Confirm the server-validated decision",
    sessionId: "agent-session-1",
    requestedSchema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          title: "Confirm decision",
        },
      },
      required: ["confirmed"],
    },
  }, "rpc-form");
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-form"
  );
  const form = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (form?.type !== "elicitation-form") throw new Error("missing form");
  const accepted = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "form-reply",
    command: "elicitation.resolve",
    conversationId,
    correlationId: form.correlationId,
    action: "accept",
    content: { confirmed: true },
  });
  assert(accepted.ok);
  assertEquals(await formPromise, {
    action: "accept",
    content: { confirmed: true },
  });

  const declinePromise = turn.elicit({
    mode: "form",
    message: "Optional follow-up",
    sessionId: "agent-session-1",
    requestedSchema: { type: "object", properties: {} },
  }, "rpc-decline");
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-form"
  );
  const decline = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (decline?.type !== "elicitation-form") throw new Error("missing decline form");
  const declined = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "form-decline",
    command: "elicitation.resolve",
    conversationId,
    correlationId: decline.correlationId,
    action: "decline",
  });
  assert(declined.ok);
  assertEquals(await declinePromise, { action: "decline" });

  const abort = new AbortController();
  const urlPromise = turn.elicit(
    {
      mode: "url",
      message: "Complete sign-in, then return",
      sessionId: "agent-session-1",
      elicitationId: "url-1",
      url: "https://identity.example.test/authorize",
    },
    "rpc-url",
    abort,
  );
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-url"
  );
  const url = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (url?.type !== "elicitation-url") throw new Error("missing URL");
  assertEquals(url.url, "https://identity.example.test/authorize");
  abort.abort();
  assertEquals(await urlPromise, { action: "cancel" });
  const late = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "url-late",
    command: "elicitation.resolve",
    conversationId,
    correlationId: url.correlationId,
    action: "accept",
  });
  assertEquals(late.ok, false);

  turn.finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("invalid elicitation content cancels the ACP request instead of orphaning it", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Approve a decision"));
  await until(() => adapter.turns.length === 1);

  const formPromise = adapter.turns[0].elicit({
    mode: "form",
    message: "Confirm the server-validated decision",
    sessionId: "agent-session-1",
    requestedSchema: {
      type: "object",
      properties: { confirmed: { type: "boolean", title: "Confirm" } },
      required: ["confirmed"],
    },
  }, "rpc-invalid");
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-form"
  );
  const pending = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (pending?.type !== "elicitation-form") throw new Error("missing form");

  const response = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "invalid-form-reply",
    command: "elicitation.resolve",
    conversationId,
    correlationId: pending.correlationId,
    action: "accept",
    content: {},
  });
  assertEquals(response.ok, false);
  assertEquals(await formPromise, { action: "cancel" });
  adapter.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("shutdown cancels the active turn and closes every retained session", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Keep running"));
  await until(() => adapter.turns.length === 1);
  const turn = adapter.turns[0];
  const stopped = coordinator.stop();
  await until(() => turn.cancelled);
  turn.finish({ status: "cancelled" });
  await stopped;
  assertEquals(adapter.closedHandles, ["casys-codex"]);
  assertEquals(adapter.closed, true);
  assertEquals(coordinator.snapshot(conversationId).host, "shutting-down");
});

function send(
  requestId: string,
  conversationId: string,
  text: string,
): ChatCommandRequest {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId,
    command: "message.send",
    conversationId,
    text,
  };
}

async function createConversation(
  coordinator: ChatCoordinator,
  projectId: string,
): Promise<string> {
  const result = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "create",
    command: "conversation.create",
    projectId,
  });
  if (!result.ok || result.conversationId === undefined) {
    throw new Error("create failed");
  }
  return result.conversationId;
}

function coordinatorWith(adapter: FakeRuntimeAdapter): Promise<ChatCoordinator> {
  let sequence = 0;
  return ChatCoordinator.create({
    runtimeAdapter: adapter,
    store: new MemoryChatConversationStore(),
    workspaceRoot: "/private/chat-workspace",
    now: () => new Date(1_700_000_000_000 + sequence++),
    newId: () => String(sequence++),
  });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}

class AsyncEventQueue implements AsyncIterable<RuntimeEvent> {
  readonly #values: RuntimeEvent[] = [];
  readonly #waiters: ((value: IteratorResult<RuntimeEvent>) => void)[] = [];
  #done = false;

  push(value: RuntimeEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    this.#done = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

class FakeTurn implements RuntimeTurn {
  readonly events = new AsyncEventQueue();
  readonly result: Promise<RuntimeTurnResult>;
  readonly text: string;
  readonly #onElicitation: Parameters<ChatRuntimePort["startTurn"]>[0][
    "onElicitation"
  ];
  readonly #finish: (result: RuntimeTurnResult) => void;
  readonly #onFinished: () => void;
  cancelled = false;

  constructor(
    input: Parameters<ChatRuntimePort["startTurn"]>[0],
    onFinished: () => void,
  ) {
    this.text = input.text;
    this.#onElicitation = input.onElicitation;
    this.#onFinished = onFinished;
    const deferred = Promise.withResolvers<RuntimeTurnResult>();
    this.result = deferred.promise;
    this.#finish = deferred.resolve;
  }

  finish(result: RuntimeTurnResult): void {
    this.events.close();
    this.#finish(result);
    this.#onFinished();
  }

  elicit(
    request: Parameters<
      Parameters<ChatRuntimePort["startTurn"]>[0]["onElicitation"]
    >[0],
    requestId: string,
    controller = new AbortController(),
  ): Promise<RuntimeElicitationResponse> {
    return this.#onElicitation(request, {
      requestId,
      signal: controller.signal,
    });
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    return Promise.resolve();
  }

  closeStream(): Promise<void> {
    this.events.close();
    return Promise.resolve();
  }
}

class FakeRuntimeAdapter implements ChatRuntimeAdapter {
  readonly turns: FakeTurn[] = [];
  readonly ensureInputs: Parameters<ChatRuntimePort["ensureSession"]>[0][] = [];
  readonly closedHandles: string[] = [];
  readonly runtime: ChatRuntimePort;
  sink?: RuntimeInteractionSink;
  active = 0;
  maxConcurrent = 0;
  closed = false;

  constructor() {
    this.runtime = {
      ensureSession: (input) => {
        this.ensureInputs.push(input);
        return Promise.resolve<RuntimeHandle>({
          sessionKey: input.sessionKey,
          backend: "casys-codex",
          runtimeSessionName: input.sessionKey,
          backendSessionId: "backend-session-1",
          agentSessionId: "agent-session-1",
        });
      },
      startTurn: (input) => {
        this.active++;
        this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
        const turn = new FakeTurn(input, () => this.active--);
        this.turns.push(turn);
        return turn;
      },
      cancel: () => Promise.resolve(),
      close: (input) => {
        this.closedHandles.push(input.handle.backend);
        return Promise.resolve();
      },
    };
  }

  setInteractionSink(sink: RuntimeInteractionSink): void {
    this.sink = sink;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
