import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { ChatCoordinator } from "./coordinator.ts";
import {
  type ChatCommandRequest,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  type ChatMcpProbeOutcome,
  type ChatMcpServerConfig,
  type ChatRuntimeAdapter,
  chatRuntimeKey,
  type ChatRuntimePort,
  type RuntimeElicitationResponse,
  type RuntimeEvent,
  type RuntimeHandle,
  type RuntimeInteractionSink,
  type RuntimeTurn,
  type RuntimeTurnResult,
} from "./runtime-port.ts";
import { MemoryChatConversationStore, type StoredConversation } from "./store.ts";
import { parseChatSnapshotDto } from "../../../src/presentation/desktop/chat/contracts.ts";

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

Deno.test("standalone chat runs on the zero-MCP runtime without project binding", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Hello agent"));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(pool.project.turns.length, 0);
  assertEquals(pool.standalone.turns[0].text, "Hello agent");
  const ensured = pool.standalone.ensureInputs[0];
  assertEquals(
    ensured.sessionKey.startsWith("casys-desktop-exclusive/standalone/conversation:"),
    true,
  );
  assertMatch(ensured.sessionOptions.systemPrompt, /standalone conversation/);
  assertEquals(ensured.sessionOptions.systemPrompt.includes("projectId"), false);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const conversation = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(conversation.kind, "standalone");
  assertEquals(conversation.projectId, undefined);
  assertEquals(conversation.mcp, undefined);
  const advertised = coordinator.snapshot(conversationId).connectableMcps;
  assertEquals(advertised.map((entry) => entry.id), ["build123d"]);
  assertEquals(JSON.stringify(advertised).includes("127.0.0.1"), false);
  await coordinator.stop();
});

Deno.test("mcp.enable probes, then restarts the session on the MCP runtime", async () => {
  const pool = standalonePool({ probeTools: ["t_one", "t_two"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  assertEquals(pool.probeCalls, 1);
  assertEquals(pool.standalone.closedHandles, ["casys-codex"]);
  const attached = coordinator.snapshot(conversationId).conversations[0].mcp;
  assertEquals(attached?.status, "connected");
  assertEquals(attached?.displayName, "Build123d");
  assertEquals([...(attached?.tools ?? [])], ["t_one", "t_two"]);

  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => pool.mcp.turns.length === 1);
  assertEquals(pool.standalone.turns.length, 1);
  assertEquals(
    pool.mcp.ensureInputs[0].sessionKey.includes("/mcp/build123d"),
    true,
  );
  assertMatch(
    pool.mcp.ensureInputs[0].sessionOptions.systemPrompt,
    /MCP server is connected/,
  );
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const messages = coordinator.snapshot(conversationId).conversations[0].messages;
  assert(
    messages.some((message) => message.text.includes("Build123d connected (2 tools)")),
  );
  await coordinator.stop();
});

Deno.test("mcp.enable seeds the new agent session with prior context", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send(
      "r1",
      conversationId,
      "The part ZR-AXLE-BRACKET is 37.125 mm wide. Acknowledge.",
    ),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({
    type: "text_delta",
    text: "Acknowledged ZR-AXLE-BRACKET at 37.125 mm.",
  });
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Create the part now."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assertMatch(seed, /Prior conversation context follows/);
  assertMatch(seed, /do not re-execute/);
  assert(seed.includes("ZR-AXLE-BRACKET"), "seed misses the part name");
  assert(seed.includes("37.125"), "seed misses the width");
  assert(seed.includes("Build123d connected"), "seed misses the attach notice");
  assert(seed.endsWith("Create the part now."), "seed buries the current turn");
  assert(
    seed.indexOf("37.125") < seed.indexOf("Create the part now."),
    "seed follows the current turn instead of preceding it",
  );
  pool.mcp.turns[0].events.push({
    type: "text_delta",
    text: "MCP-ERA volume 3712.5 mm3.",
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  await coordinator.command(send("r3", conversationId, "What was the width?"));
  await until(() => pool.standalone.turns.length === 2);
  const reseed = pool.standalone.turns[1].text;
  assertMatch(reseed, /Prior conversation context follows/);
  assert(reseed.includes("3712.5"), "reseed misses the MCP-era delta");
  assert(reseed.includes("detached"), "reseed misses the detach notice");
  assert(reseed.includes("connected"), "reseed misses the attach notice");
  assert(reseed.endsWith("What was the width?"), "reseed buries the current turn");
  assertEquals(
    reseed.includes("Acknowledged ZR-AXLE-BRACKET"),
    false,
    "reseed duplicates what the base session already holds",
  );
  pool.standalone.turns[1].events.push({
    type: "text_delta",
    text: "BASE-ERA reply done.",
  });
  pool.standalone.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const reenabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(reenabled.ok);
  await coordinator.command(send("r4", conversationId, "Again."));
  await until(() => pool.mcp.turns.length === 2);
  const reseedMcp = pool.mcp.turns[1].text;
  assertMatch(reseedMcp, /Prior conversation context follows/);
  assert(reseedMcp.includes("BASE-ERA reply done."), "reseed misses base-era delta");
  assert(
    reseedMcp.includes("What was the width?"),
    "reseed misses the base-era question",
  );
  assert(reseedMcp.endsWith("Again."), "reseed buries the current turn");
  assertEquals(
    reseedMcp.includes("3712.5"),
    false,
    "reseed duplicates what the MCP session already holds",
  );
  pool.mcp.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("restored watermarks prevent duplicate seeding after restart", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Remember RED-SEED-MARKER."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  await resumed.command(send("r2", conversationId, "Continue."));
  await until(() => second.standalone.turns.length === 1);
  assertEquals(
    second.standalone.turns[0].text,
    "Continue.",
    "restart re-seeds what the resumed session already holds",
  );
  second.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    resumed.snapshot(conversationId).conversations[0].status === "idle"
  );
  await resumed.stop();
});

Deno.test("context seeding truncates old messages with a note", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  for (let i = 0; i < 35; i++) {
    await coordinator.command(send(`bulk-${i}`, conversationId, `bulk message ${i}`));
    await until(() => pool.standalone.turns.length === i + 1);
    pool.standalone.turns[i].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  }
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r-final", conversationId, "Summarize."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assertMatch(seed, /6 earlier message\(s\) truncated/);
  assert(seed.includes("bulk message 34"), "seed misses the latest message");
  assert(seed.endsWith("Summarize."), "seed buries the current turn");
  assertEquals(seed.includes("bulk message 0"), false, "seed keeps truncated history");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("context seeding drops oldest messages past the char budget", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  for (let i = 0; i < 10; i++) {
    await coordinator.command(
      send(`char-${i}`, conversationId, `char-bulk ${i} ${"x".repeat(1400)}`),
    );
    await until(() => pool.standalone.turns.length === i + 1);
    pool.standalone.turns[i].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  }
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r-final", conversationId, "Summarize."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assertMatch(seed, /earlier message\(s\) truncated/);
  assertEquals(
    seed.includes("char-bulk 0"),
    false,
    "seed keeps char-truncated history",
  );
  assert(seed.includes("char-bulk 9"), "seed misses the latest message");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("context seeding slices single messages past the per-message cap", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send("r1", conversationId, `head ${"A".repeat(1000)} tail ${"B".repeat(1000)}`),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Next."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assert(seed.includes("A".repeat(1000)), "seed misses the message head");
  assertEquals(
    seed.includes("B".repeat(600)),
    false,
    "seed keeps text past the per-message cap",
  );
  assert(seed.includes("…[truncated]"), "seed hides the per-message cut");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("cancelled turn output reseeds into the switched session", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Interrupted request."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({
    type: "text_delta",
    text: "Partial before cancel.",
  });
  pool.standalone.turns[0].finish({ status: "cancelled" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Continue with the tool."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assert(seed.includes("Interrupted request."), "seed misses the cancelled request");
  assert(seed.includes("Partial before cancel."), "seed misses partial output");
  assert(seed.includes("Turn cancelled."), "seed misses the cancel notice");
  assert(seed.endsWith("Continue with the tool."), "seed buries the current turn");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("startTurn failure drops the pinned handle so the retry reseeds", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const innerStartTurn = pool.standalone.runtime.startTurn;
  let failuresLeft = 1;
  pool.standalone.runtime.startTurn = (input) => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error("startTurn blew up");
    }
    return innerStartTurn(input);
  };
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First context held."));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  assertEquals(pool.standalone.ensureInputs.length, 1);
  assertEquals(pool.standalone.turns.length, 0);
  await coordinator.command(send("r2", conversationId, "Retry now."));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(
    pool.standalone.ensureInputs.length,
    2,
    "retry reused the pinned handle instead of re-ensuring",
  );
  const retry = pool.standalone.turns[0].text;
  assert(retry.includes("First context held."), "retry lost the unmarked seed");
  assert(retry.endsWith("Retry now."), "retry buries the current turn");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("a later-queued message never leaks into the earlier turn seed", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const first = coordinator.command(send("r1", conversationId, "First message."));
  const second = coordinator.command(send("r2", conversationId, "Second message."));
  await first;
  await second;
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(
    pool.standalone.turns[0].text,
    "First message.",
    "later-queued message leaked into the earlier seed",
  );
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() => pool.standalone.turns.length === 2);
  assertEquals(pool.standalone.turns[1].text, "Second message.");
  pool.standalone.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("known-id serialization respects the file-store retention cap", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  for (let i = 0; i < 401; i++) {
    await coordinator.command(send(`cap-${i}`, conversationId, `cap message ${i}`));
    await until(() => pool.standalone.turns.length === i + 1);
    pool.standalone.turns[i].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  }
  const saved = (await store.load()).find((entry) => entry.id === conversationId);
  const ids = Object.values(saved?.knownMessageIdsByKey ?? {}).flat();
  assert(ids.length > 0, "no known ids persisted");
  assert(ids.length <= 400, `known ids exceed retention cap: ${ids.length}`);
  await coordinator.stop();
  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  await resumed.command(send("r-resume", conversationId, "After restart."));
  await until(() => second.standalone.turns.length === 1);
  const reseed = second.standalone.turns[0].text;
  assert(
    reseed.includes("cap message 0"),
    "pruned oldest id does not reseed after restart",
  );
  assertEquals(
    reseed.includes("cap message 400"),
    false,
    "retained recent id reseeds after restart",
  );
  assertEquals(
    reseed.includes("truncated"),
    false,
    "single-message reseed carries a truncation note",
  );
  second.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    resumed.snapshot(conversationId).conversations[0].status === "idle"
  );
  await resumed.stop();
});

Deno.test("failed turn output reseeds into the switched session", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Doomed request."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({
    type: "text_delta",
    text: "Partial output here.",
  });
  pool.standalone.turns[0].finish({ status: "failed", error: { message: "boom" } });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Try with the tool."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assert(seed.includes("Doomed request."), "seed misses the failed user message");
  assert(seed.includes("Partial output here."), "seed misses partial output");
  assert(seed.includes("boom"), "seed misses the failure notice");
  assert(seed.endsWith("Try with the tool."), "seed buries the current turn");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("pre-seeding store entries reseed full history once (fail-safe)", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:legacy-seed",
    kind: "standalone",
    sessionKey: "casys-desktop-exclusive/standalone/conversation:legacy-seed",
    title: "Legacy",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [
      {
        id: "message:legacy-1",
        role: "user",
        kind: "text",
        text: "LEGACY-MARKER question.",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
      {
        id: "message:legacy-2",
        role: "assistant",
        kind: "text",
        text: "LEGACY-MARKER answer.",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
    ],
  }]);
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  await coordinator.command(send("r1", "conversation:legacy-seed", "Continue."));
  await until(() => pool.standalone.turns.length === 1);
  const seed = pool.standalone.turns[0].text;
  assert(seed.includes("LEGACY-MARKER question."), "upgrade lost user history");
  assert(seed.includes("LEGACY-MARKER answer."), "upgrade lost assistant history");
  assert(seed.endsWith("Continue."), "seed buries the current turn");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot("conversation:legacy-seed").conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("mcp.enable records connection failure without touching the agent session", async () => {
  const pool = standalonePool({ probeError: "connection refused" });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enabled.ok, false);
  assertMatch(enabled.error ?? "", /MCP connection failed/);
  assertEquals(pool.standalone.closedHandles, []);
  const attached = coordinator.snapshot(conversationId).conversations[0].mcp;
  assertEquals(attached?.status, "failed");

  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => pool.standalone.turns.length === 2);
  assertEquals(pool.mcp.turns.length, 0);
  pool.standalone.turns[1].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("mcp.enable re-probes as the reconnect path", async () => {
  const pool = standalonePool({ probeError: "connection refused" });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const first = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(first.ok, false);

  pool.probeError = undefined;
  pool.probeTools = ["t_one"];
  const second = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(second.ok);
  assertEquals(pool.probeCalls, 2);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].mcp?.status,
    "connected",
  );
  await coordinator.stop();
});

Deno.test("mcp.disable detaches and restarts without the MCP", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  assertEquals(pool.mcp.closedHandles, ["casys-codex"]);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].mcp,
    undefined,
  );
  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(
    pool.standalone.ensureInputs[0].sessionKey.includes("/mcp/"),
    false,
  );
  pool.standalone.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("project conversations refuse MCP attachment changes", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createConversation(coordinator, "coffee-machine");
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enabled.ok, false);
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assertEquals(disabled.ok, false);
  assertEquals(pool.probeCalls, 0);
  await coordinator.stop();
});

Deno.test("unknown MCP ids are refused before probing", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "no-such-mcp",
  });
  assertEquals(enabled.ok, false);
  assertEquals(pool.probeCalls, 0);
  await coordinator.stop();
});

Deno.test("MCP switch refuses while a turn is active", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Keep running"));
  await until(() => pool.standalone.turns.length === 1);
  const refused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(refused.ok, false);
  assertEquals(pool.probeCalls, 0);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.stop();
});

Deno.test("MCP switch refuses while a turn is queued", async () => {
  const store = new GatedSaveStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const release = store.hold();
  const sending = coordinator.command(send("r1", conversationId, "Queue me"));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "queued"
  );
  assertEquals(pool.standalone.turns.length, 0);
  const enableRefused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enableRefused.ok, false);
  const disableRefused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assertEquals(disableRefused.ok, false);
  assertEquals(pool.probeCalls, 0);
  release();
  await sending;
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("turn.cancel drops a turn queued behind a running turn", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.standalone.turns.length === 1);
  await coordinator.command(send("r2", conversationId, "Second"));
  const cancelled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "cancel-1",
    command: "turn.cancel",
    conversationId,
  });
  assert(cancelled.ok);
  pool.standalone.turns[0].finish({ status: "cancelled" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(pool.standalone.turns.length, 1);
  await coordinator.stop();
});

Deno.test("turn.cancel before the queued turn chains never executes it", async () => {
  const store = new GatedSaveStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const release = store.hold();
  const sending = coordinator.command(send("r1", conversationId, "Queue me"));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "queued"
  );
  const cancelled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "cancel-1",
    command: "turn.cancel",
    conversationId,
  });
  assert(cancelled.ok);
  release();
  await sending;
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(pool.standalone.turns.length, 0);
  await coordinator.stop();
});

Deno.test("failed re-enable from connected detaches and routes back to zero MCP", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r1", conversationId, "Use MCP"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  pool.probeError = "connection refused";
  const reenabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(reenabled.ok, false);
  const failed = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(failed.mcp?.status, "failed");
  assertEquals(pool.mcp.closedHandles, ["casys-codex"]);
  assertEquals(pool.standalone.closedHandles, []);
  await coordinator.command(send("r2", conversationId, "Resume"));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(pool.mcp.turns.length, 1);
  const reseed = pool.standalone.turns[0].text;
  assertMatch(reseed, /Prior conversation context follows/);
  assert(reseed.includes("Use MCP"), "reseed misses the MCP-era request");
  assert(reseed.includes("MCP connection failed"), "reseed misses the failure notice");
  assert(reseed.endsWith("Resume"), "reseed buries the current turn");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  assertEquals(pool.mcp.closedHandles, ["casys-codex"]);
  await coordinator.stop();
});

Deno.test("legacy project entries restore as project conversations", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:legacy",
    projectId: "coffee-machine",
    sessionKey: "casys-desktop-exclusive/coffee-machine/conversation:legacy",
    title: "Project coffee-machine",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [],
  }]);
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter, { store });
  const conversation = coordinator.snapshot("conversation:legacy").conversations[0];
  assertEquals(conversation.kind, "project");
  assertEquals(conversation.projectId, "coffee-machine");
  await coordinator.command(send("r1", "conversation:legacy", "Resume"));
  await until(() => adapter.turns.length === 1);
  assertEquals(
    adapter.turns[0].text,
    "Bound Casys projectId: coffee-machine\n\nHuman message:\nResume",
  );
  adapter.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("standalone attachment restores across coordinator restarts", async () => {
  const store = new MemoryChatConversationStore();
  const first = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await first.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.stop();

  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  const restored = resumed.snapshot(conversationId).conversations[0];
  assertEquals(restored.kind, "standalone");
  assertEquals(restored.mcp?.status, "connected");
  await resumed.command(send("r1", conversationId, "Resume"));
  await until(() => second.mcp.turns.length === 1);
  assertEquals(second.standalone.turns.length, 0);
  second.mcp.turns[0].finish({ status: "completed" });
  await resumed.stop();
});

Deno.test("restore strips MCP fields from project entries", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:poisoned",
    kind: "project",
    projectId: "coffee-machine",
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    sessionKey: "casys-desktop-exclusive/coffee-machine/conversation:poisoned",
    title: "Project coffee-machine",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [],
  }]);
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter, { store });
  const restored = coordinator.snapshot("conversation:poisoned").conversations[0];
  assertEquals(restored.kind, "project");
  assertEquals(restored.mcp, undefined);
  parseChatSnapshotDto(JSON.parse(JSON.stringify(coordinator.snapshot())));
  await coordinator.stop();
});

Deno.test("restore keeps the conversation but drops unpaired standalone MCP fields", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:half",
    kind: "standalone",
    mcpId: "build123d",
    sessionKey: "casys-desktop-exclusive/standalone/conversation:half",
    title: "Half attached",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [],
  }]);
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const restored = coordinator.snapshot("conversation:half").conversations[0];
  assertEquals(restored.kind, "standalone");
  assertEquals(restored.mcp, undefined);
  parseChatSnapshotDto(JSON.parse(JSON.stringify(coordinator.snapshot())));
  await coordinator.command(send("r1", "conversation:half", "Resume"));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
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

async function createStandaloneConversation(
  coordinator: ChatCoordinator,
): Promise<string> {
  const result = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "create",
    command: "conversation.create",
  });
  if (!result.ok || result.conversationId === undefined) {
    throw new Error("create failed");
  }
  return result.conversationId;
}

const TEST_MCP_SERVER: ChatMcpServerConfig = {
  id: "build123d",
  displayName: "Build123d",
  description: "Parametric CAD execution",
  transport: "streamable-http",
  mcpUrl: "http://127.0.0.1:3014/mcp",
  healthUrl: "http://127.0.0.1:3014/health",
  expectedTools: ["t_one"],
};

function standalonePool(options: {
  probeTools?: readonly string[];
  probeError?: string;
  store?: MemoryChatConversationStore;
} = {}): {
  readonly project: FakeRuntimeAdapter;
  readonly standalone: FakeRuntimeAdapter;
  readonly mcp: FakeRuntimeAdapter;
  probeTools: readonly string[] | undefined;
  probeError: string | undefined;
  probeCalls: number;
  coordinator(): Promise<ChatCoordinator>;
} {
  const project = new FakeRuntimeAdapter("project");
  const standalone = new FakeRuntimeAdapter("standalone");
  const mcp = new FakeRuntimeAdapter("mcp");
  const state = {
    project,
    standalone,
    mcp,
    probeTools: options.probeTools,
    probeError: options.probeError,
    probeCalls: 0,
    coordinator(): Promise<ChatCoordinator> {
      return coordinatorWith(project, {
        runtimes: new Map([
          [chatRuntimeKey("project"), project],
          [chatRuntimeKey("standalone"), standalone],
          [chatRuntimeKey("standalone", "build123d"), mcp],
        ]),
        mcpServers: [TEST_MCP_SERVER],
        probeMcp: () => {
          state.probeCalls += 1;
          if (state.probeError !== undefined) {
            return Promise.resolve<ChatMcpProbeOutcome>({
              ok: false,
              error: state.probeError,
            });
          }
          return Promise.resolve<ChatMcpProbeOutcome>({
            ok: true,
            tools: [...(state.probeTools ?? [])],
          });
        },
        ...(options.store === undefined ? {} : { store: options.store }),
      });
    },
  };
  return state;
}

function coordinatorWith(
  adapter: FakeRuntimeAdapter,
  options: {
    runtimes?: ReadonlyMap<string, FakeRuntimeAdapter>;
    mcpServers?: readonly ChatMcpServerConfig[];
    probeMcp?: (server: ChatMcpServerConfig) => Promise<ChatMcpProbeOutcome>;
    store?: MemoryChatConversationStore;
  } = {},
): Promise<ChatCoordinator> {
  let sequence = 0;
  return ChatCoordinator.create({
    runtimes: options.runtimes ??
      new Map([
        [chatRuntimeKey("project"), adapter],
        [chatRuntimeKey("standalone"), adapter],
      ]),
    mcpServers: options.mcpServers ?? [],
    probeMcp: options.probeMcp ??
      (() =>
        Promise.resolve<ChatMcpProbeOutcome>({
          ok: false,
          error: "no MCP configured",
        })),
    store: options.store ?? new MemoryChatConversationStore(),
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

class GatedSaveStore extends MemoryChatConversationStore {
  #gate: Promise<void> = Promise.resolve();

  hold(): () => void {
    let release!: () => void;
    this.#gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  override async save(
    conversations: readonly StoredConversation[],
  ): Promise<void> {
    await this.#gate;
    await super.save(conversations);
  }
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

  constructor(tag = "1") {
    this.runtime = {
      ensureSession: (input) => {
        this.ensureInputs.push(input);
        return Promise.resolve<RuntimeHandle>({
          sessionKey: input.sessionKey,
          backend: "casys-codex",
          runtimeSessionName: input.sessionKey,
          backendSessionId: `backend-session-${tag}`,
          agentSessionId: `agent-session-${tag}`,
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
