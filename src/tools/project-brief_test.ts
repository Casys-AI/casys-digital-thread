import { assertEquals } from "@std/assert";
import { createConsoleServer } from "../../server.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/engineering-project-store.ts";
import { ProjectBriefCommandService } from "../domain/project-brief-command-service.ts";

Deno.test("project MCP framing uses one project identity from intent through approved brief", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-brief-tools-" });
  const projects = new FileEngineeringProjectRevisionStore(directory);
  let tick = 0;
  const commands = new ProjectBriefCommandService(
    projects,
    () =>
      new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  const { app } = await createConsoleServer({
    manifest: { version: 1, servers: [] },
    runs: [],
    projectControl: false,
    projectBrief: { projects, commands },
    mrtrSigningKey: "b".repeat(64),
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

  try {
    const client = new TestMcpClient(`http://127.0.0.1:${port}/mcp`);
    const listed = await client.call("tools/list", {});
    const names = (listed.tools as Array<{ name: string }>).map((tool) => tool.name);
    assertEquals(names.includes("project_start"), true);
    assertEquals(names.includes("project_brief_confirm"), true);
    assertEquals(names.some((name) => name.startsWith("project_discovery_")), false);

    let result = await client.tool("project_start", {
      commandId: "start-drone",
      projectId: "drone-v3",
      projectName: "Inspection drone",
      issuedAt: "2026-08-03T08:59:00.000Z",
      intent: "Build a safe roof-inspection drone.",
      intentSource: { kind: "human", reference: "conversation:turn-1" },
    });
    let project = result.structuredContent as Record<string, unknown>;
    assertEquals(project.schemaVersion, "3.0");
    assertEquals(project.revision, 1);

    result = await client.tool("project_brief_propose", {
      ...common("propose-brief", 1),
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Inspect a roof safely.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Capture usable imagery while maintaining safe separation.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement: "Complete the route without loss of controlled flight.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }],
    });
    project = result.structuredContent as Record<string, unknown>;
    const framing = project.framing as Record<string, unknown>;
    const proposal = framing.proposedBrief as Record<string, unknown>;
    const review = framing.proposalReview as Record<string, unknown>;
    assertEquals(project.revision, 2);
    assertEquals(review.status, "pending");

    const confirmArgs = {
      ...common("confirm-brief", 2),
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      inputFingerprint: review.inputFingerprint,
    };
    const inputRequired = await client.toolInputRequired(
      "project_brief_confirm",
      confirmArgs,
    );
    result = await client.toolRetry(
      "project_brief_confirm",
      confirmArgs,
      inputRequired.requestState as string,
      {
        brief_confirmation: {
          action: "accept",
          content: { confirmed: true },
        },
      },
    );
    project = result.structuredContent as Record<string, unknown>;
    assertEquals(project.revision, 3);
    assertEquals(
      ((project.framing as Record<string, unknown>).currentBriefApproval as Record<
        string,
        unknown
      >).status,
      "approved",
    );
    assertEquals(
      (await projects.get("drone-v3"))?.project.objective.statement,
      "Inspect a roof safely.",
    );
  } finally {
    await http.shutdown();
    await Deno.remove(directory, { recursive: true });
  }
});

function common(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "drone-v3",
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
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
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          },
        },
      }),
    });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    if (body.error) throw new Error(JSON.stringify(body.error));
    const result = body.result as Record<string, unknown>;
    assertEquals(result.resultType, expectedResultType);
    return result;
  }
}
