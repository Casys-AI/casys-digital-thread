import { assertEquals, assertRejects } from "@std/assert";
import { HttpMcpToolClient, McpToolCallError } from "./http-mcp-tool-client.ts";

Deno.test("HttpMcpToolClient calls one stateless tool and returns structured content", async () => {
  let observed: { headers: Headers; body: Record<string, unknown> } | undefined;
  const client = new HttpMcpToolClient({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: ((_input, init) => {
      observed = {
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "CAD export completed." }],
          structuredContent: {
            artifacts: [{ kind: "step", uri: "artifact://cad/bracket.step" }],
          },
        },
      }));
    }) as typeof fetch,
  });

  const result = await client.callTool({
    name: "build123d_export",
    arguments: { name: "bracket", formats: ["step"] },
  });

  assertEquals(observed?.headers.get("mcp-protocol-version"), "2026-07-28");
  assertEquals(observed?.headers.get("mcp-method"), "tools/call");
  assertEquals(observed?.headers.get("mcp-name"), "build123d_export");
  assertEquals(observed?.headers.get("mcp-session-id"), null);
  assertEquals(observed?.body.method, "tools/call");
  const params = observed?.body.params as Record<string, unknown>;
  assertEquals(params.name, "build123d_export");
  assertEquals(params.arguments, { name: "bracket", formats: ["step"] });
  assertEquals(result, {
    text: "CAD export completed.",
    structuredContent: {
      artifacts: [{ kind: "step", uri: "artifact://cad/bracket.step" }],
    },
  });
});

Deno.test("HttpMcpToolClient does not hide provider tool errors", async () => {
  const client = new HttpMcpToolClient({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          isError: true,
          content: [{ type: "text", text: "mesh generation failed" }],
        },
      }))) as typeof fetch,
  });

  await assertRejects(
    () => client.callTool({ name: "calculix_solve_static" }),
    McpToolCallError,
    "mesh generation failed",
  );
});

Deno.test("HttpMcpToolClient requires structuredContent", async () => {
  const client = new HttpMcpToolClient({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "human-only result" }],
        },
      }))) as typeof fetch,
  });

  await assertRejects(
    () => client.callTool({ name: "human_only" }),
    McpToolCallError,
    "did not return structuredContent",
  );
});
