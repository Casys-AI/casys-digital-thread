import { assertEquals, assertStringIncludes } from "@std/assert";
import { createConsoleServer } from "../../server.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { ProjectBriefCommandService } from "../../src/application/use-cases/project/project-brief-command-service.ts";
import { ChatCoordinator } from "../src/chat/coordinator.ts";
import { DESKTOP_CHAT_PROTOCOL } from "../../src/presentation/desktop/chat/contracts.ts";
import type {
  ChatRuntimeAdapter,
  ChatRuntimePort,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeInteractionSink,
  RuntimeTurn,
} from "../src/chat/runtime-port.ts";
import { MemoryChatConversationStore } from "../src/chat/store.ts";

Deno.test("Desktop Chat carries one Casys MRTR through server-signed retry validation", async () => {
  const directory = await Deno.makeTempDir({ prefix: "desktop-chat-mrtr-" });
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const commands = new ProjectBriefCommandService(projects);
  const { app } = await createConsoleServer({
    manifest: { version: 1, servers: [] },
    runs: [],
    projectControl: false,
    projectBrief: { projects, commands },
    mrtrSigningKey: "d".repeat(64),
    logger: () => {},
  });
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await app.startHttp({
    port,
    hostname: "127.0.0.1",
    onListen: () => {},
  });
  const client = new TestMcpClient(`http://127.0.0.1:${port}/mcp`);
  try {
    const projectId = "desktop-mrtr";
    const issuedAt = () => new Date(Date.now() - 1_000).toISOString();
    await client.tool("project_start", {
      commandId: "start",
      projectId,
      projectName: "Desktop MRTR proof",
      issuedAt: issuedAt(),
      intent: "Prove a server-validated Desktop chat decision.",
      intentSource: { kind: "human", reference: "desktop-chat:e2e" },
    });
    const proposed = await client.tool("project_brief_propose", {
      commandId: "propose",
      projectId,
      expectedRevision: 1,
      issuedAt: issuedAt(),
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Prove a server-signed MRTR round trip.",
        sourceRefs: [{ kind: "intent", reference: "desktop-chat:e2e" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Review the exact proposed project brief in Desktop chat.",
        sourceRefs: [{ kind: "intent", reference: "desktop-chat:e2e" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement: "The Casys server persists the signed human approval.",
        sourceRefs: [{ kind: "intent", reference: "desktop-chat:e2e" }],
        dependsOnItemIds: [],
      }],
    });
    const projection = proposed.structuredContent as Record<string, unknown>;
    const framing = projection.framing as Record<string, unknown>;
    const proposal = framing.proposedBrief as Record<string, unknown>;
    const review = framing.proposalReview as Record<string, unknown>;
    const confirmArgs = {
      commandId: "confirm",
      projectId,
      expectedRevision: 2,
      issuedAt: issuedAt(),
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      inputFingerprint: review.inputFingerprint,
    };
    const adapter = mrtrRuntime(client, confirmArgs);
    const coordinator = await ChatCoordinator.create({
      runtimeAdapter: adapter,
      store: new MemoryChatConversationStore(),
      workspaceRoot: `${directory}/private-workspace`,
      newId: (() => {
        let id = 0;
        return () => String(++id);
      })(),
    });
    const created = await coordinator.command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create",
      command: "conversation.create",
      projectId,
    });
    assertEquals(created.ok, true);
    await coordinator.command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "turn",
      command: "message.send",
      conversationId: created.conversationId!,
      text: "Confirm the reviewed project brief.",
    });
    const pending = await waitFor(() =>
      coordinator.snapshot(created.conversationId).conversations[0]
        ?.pendingInteraction
    );
    assertEquals(pending.type, "elicitation-form");
    if (pending.type !== "elicitation-form") {
      throw new Error("Casys MRTR did not produce a form elicitation");
    }
    assertStringIncludes(pending.message, "Confirm this exact framing");
    const accepted = await coordinator.command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "accept",
      command: "elicitation.resolve",
      conversationId: created.conversationId!,
      correlationId: pending.correlationId,
      action: "accept",
      content: { confirmed: true },
    });
    assertEquals(accepted.ok, true);
    await waitFor(() => {
      const conversation = coordinator.snapshot(created.conversationId)
        .conversations[0];
      return conversation?.status === "idle" ? conversation : undefined;
    });
    const stored = await projects.get(projectId);
    assertEquals(stored?.framing?.currentBriefApproval?.status, "approved");
    assertEquals(
      stored?.framing?.currentBriefApproval?.decidedBy,
      { origin: "human", id: "mcp-elicitation:casys-desktop-chat-e2e@0.4.0" },
    );
    await coordinator.stop();
  } finally {
    await http.shutdown();
    await Deno.remove(directory, { recursive: true });
  }
});

function mrtrRuntime(
  client: TestMcpClient,
  args: Record<string, unknown>,
): ChatRuntimeAdapter {
  const handle: RuntimeHandle = {
    sessionKey: "desktop-mrtr",
    backend: "fixture",
    runtimeSessionName: "desktop-mrtr",
    backendSessionId: "desktop-mrtr-backend",
  };
  const runtime: ChatRuntimePort = {
    ensureSession: () => Promise.resolve(handle),
    startTurn(input): RuntimeTurn {
      const result = Promise.withResolvers<
        { readonly status: "completed" } | {
          readonly status: "failed";
          readonly error: { readonly message: string };
        }
      >();
      const events = (async function* (): AsyncGenerator<RuntimeEvent> {
        try {
          const first = await client.toolInputRequired("project_brief_confirm", args);
          const request = (first.inputRequests as Record<string, unknown>)
            .brief_confirmation as Record<string, unknown>;
          const params = request.params as Record<string, unknown>;
          const response = await input.onElicitation({
            mode: "form",
            message: String(params.message),
            sessionId: "desktop-mrtr-backend",
            requestedSchema: params.requestedSchema,
          }, { requestId: 1, signal: input.signal });
          if (response.action !== "accept") throw new Error("MRTR was not accepted");
          const completed = await client.toolRetry(
            "project_brief_confirm",
            args,
            String(first.requestState),
            { brief_confirmation: response },
          );
          yield {
            type: "text_delta",
            text: String(completed.content ?? "Server recorded the MRTR."),
          };
          result.resolve({ status: "completed" });
        } catch (error) {
          result.resolve({
            status: "failed",
            error: { message: error instanceof Error ? error.message : "MRTR failed" },
          });
        }
      })();
      return {
        events,
        result: result.promise,
        cancel: () => Promise.resolve(),
        closeStream: () => Promise.resolve(),
      };
    },
    cancel: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  let sink: RuntimeInteractionSink | undefined;
  return {
    runtime,
    setInteractionSink(value) {
      sink = value;
    },
    close() {
      sink = undefined;
      return Promise.resolve();
    },
  };
}

class TestMcpClient {
  #id = 0;
  constructor(private readonly url: string) {}

  tool(name: string, args: Record<string, unknown>) {
    return this.call("tools/call", { name, arguments: args });
  }

  toolInputRequired(name: string, args: Record<string, unknown>) {
    return this.call(
      "tools/call",
      { name, arguments: args },
      { elicitation: {} },
      "input_required",
    );
  }

  toolRetry(
    name: string,
    args: Record<string, unknown>,
    requestState: string,
    inputResponses: Record<string, unknown>,
  ) {
    return this.call(
      "tools/call",
      { name, arguments: args, requestState, inputResponses },
      { elicitation: {} },
    );
  }

  async call(
    method: string,
    params: Record<string, unknown>,
    capabilities: Record<string, unknown> = {},
    expectedResultType = "complete",
  ): Promise<Record<string, unknown>> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(method === "tools/call" && typeof params.name === "string"
          ? { "mcp-name": params.name }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.#id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": capabilities,
            "io.modelcontextprotocol/clientInfo": {
              name: "casys-desktop-chat-e2e",
              version: "0.4.0",
            },
          },
        },
      }),
    });
    const envelope = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof envelope.error === "object") {
      throw new Error(`MCP ${method} failed: ${JSON.stringify(envelope.error)}`);
    }
    const result = envelope.result as Record<string, unknown>;
    if (result.resultType !== expectedResultType) {
      throw new Error(`MCP ${method} returned ${String(result.resultType)}`);
    }
    return result;
  }
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Desktop Chat state");
}
