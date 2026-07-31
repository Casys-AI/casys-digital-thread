import { assert, assertEquals } from "@std/assert";
import type { DockerObserver } from "../adapters/docker-observer.ts";
import type { McpProbe } from "../adapters/http-mcp-probe.ts";
import type { FleetManifest, ObservedContainer, RunDetail } from "../domain/types.ts";
import { createConsoleServer } from "../../server.ts";
import { CONSOLE_RESOURCE_URI } from "./register.ts";

Deno.test("control-plane MCP tools are namespaced, read-only, and return structured roots", async () => {
  const { app } = await createConsoleServer({
    manifest: manifestFixture(),
    runs: [runFixture()],
    probe: healthyProbe(),
    docker: unavailableDocker(),
    logger: () => {},
  });
  assertEquals(app.getToolNames().sort(), [
    "console_refresh",
    "console_run_detail",
    "console_run_list",
    "console_server_detail",
    "console_snapshot",
  ]);
  try {
    const built = Deno.statSync("src/ui/dist/console/index.html").isFile;
    if (built) {
      assertEquals(app.hasResource(CONSOLE_RESOURCE_URI), true);
      const content = await app.readResourceContent(CONSOLE_RESOURCE_URI);
      assert(content);
      assertEquals(content.uri, CONSOLE_RESOURCE_URI);
      assert(content.text.includes("<html"));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

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
    const discovered = await client.discover();
    assertEquals(discovered.resultType, "complete");
    assertEquals(discovered.serverInfo, {
      name: "casys-digital-thread-console",
      version: "0.1.0",
    });
    const listed = await client.call("tools/list", {});
    const tools = listed.tools as Array<Record<string, unknown>>;
    assertEquals(tools.map((tool) => tool.name).sort(), [
      "console_run_detail",
      "console_run_list",
      "console_server_detail",
      "console_snapshot",
    ]);
    const snapshotTool = tools.find((tool) => tool.name === "console_snapshot");
    assert(snapshotTool);
    assertEquals(
      ((snapshotTool._meta as Record<string, unknown>).ui as Record<
        string,
        unknown
      >).resourceUri,
      CONSOLE_RESOURCE_URI,
    );
    assertEquals(snapshotTool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });

    const result = await client.call("tools/call", {
      name: "console_snapshot",
      arguments: {},
    });
    const structured = result.structuredContent as Record<string, unknown>;
    assertEquals(structured.schemaVersion, "1.0");
    assertEquals(structured.mode, "mixed");
    assert("fleet" in structured);
    assert("runs" in structured);
    assert("workbench" in structured);
  } finally {
    await http.shutdown();
  }
});

class TestMcpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  async discover(): Promise<Record<string, unknown>> {
    return await this.call("server/discover", {});
  }

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.#request({
      jsonrpc: "2.0",
      id: ++this.#id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    });
    const body = await parseResponse(response);
    if (body.error) throw new Error(JSON.stringify(body.error));
    const result = body.result as Record<string, unknown>;
    assertEquals(result.resultType, "complete");
    return result;
  }

  async #request(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "accept": "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": String(body.method),
    };
    const params = body.params as Record<string, unknown>;
    if (body.method === "tools/call" && typeof params.name === "string") {
      headers["mcp-name"] = params.name;
    }
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assertEquals(response.headers.get("mcp-session-id"), null);
    return response;
  }
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  return JSON.parse(text);
}

function manifestFixture(): FleetManifest {
  return {
    version: 1,
    servers: [{
      id: "test",
      displayName: "Test",
      role: "test",
      serviceName: "mcp-test",
      transport: "streamable-http",
      mcpUrl: "http://127.0.0.1:3999/mcp",
      healthUrl: "http://127.0.0.1:3999/health",
      image: "example.test/toolchain:1",
      required: true,
      expectedTools: ["test_read"],
    }],
  };
}

function runFixture(): RunDetail {
  return {
    id: "run-1",
    name: "Run",
    subject: "Part",
    status: "succeeded",
    verdictStatus: "passed",
    source: "demo",
    startedAt: "2026-07-30T00:00:00.000Z",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Test fixture",
    stages: [],
    measurements: [],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [],
  };
}

function healthyProbe(): McpProbe {
  return {
    probe: () =>
      Promise.resolve({
        checkedAt: "2026-07-30T00:00:00.000Z",
        status: "healthy",
        httpStatus: 200,
        mcp: {
          reachable: true,
          tools: [{ name: "test_read" }],
          resourceUris: [],
          viewerUris: [],
        },
      }),
  };
}

function unavailableDocker(): DockerObserver {
  return {
    observe: (servers) =>
      Promise.resolve(
        new Map<string, ObservedContainer>(
          servers.map((server) => [
            server.id,
            {
              runtimeAvailable: false,
              present: false,
              error: "Docker unavailable",
            },
          ]),
        ),
      ),
  };
}
