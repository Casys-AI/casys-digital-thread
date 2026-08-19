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

Deno.test("HttpMcpToolClient rejects a result that is neither structuredContent nor JSON text", async () => {
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
    "neither structuredContent nor JSON text",
  );
});

Deno.test("HttpMcpToolClient accepts a JSON-object text result when structuredContent is absent", async () => {
  // structuredContent is optional in the MCP specification; provider releases
  // move between the two shapes. The parsed object must round-trip unchanged.
  const client = new HttpMcpToolClient({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          content: [{
            type: "text",
            text: JSON.stringify({ id: "p-1", editingContextId: "ctx-1" }),
          }],
        },
      }))) as typeof fetch,
  });

  const result = await client.callTool({ name: "text_shaped_write" });
  if (
    result.structuredContent.id !== "p-1" ||
    result.structuredContent.editingContextId !== "ctx-1"
  ) {
    throw new Error("JSON text result was not surfaced as structuredContent");
  }
});

Deno.test(
  "callToolTextResult parses JSON from content[0].text when structuredContent is absent",
  async () => {
    const payload = { status: "sat", model: { x: { value: 0.028, unit: "m" } } };
    const client = new HttpMcpToolClient({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: (() =>
        Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: JSON.stringify(payload) }],
          },
        }))) as typeof fetch,
    });

    const result = await client.callToolTextResult({
      name: "syson_constraint_solve",
      arguments: { constraintIds: ["c1"] },
    });

    assertEquals(result, payload);
  },
);

Deno.test(
  "callToolTextResult raises a typed error when content array is empty",
  async () => {
    const client = new HttpMcpToolClient({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: (() =>
        Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            content: [],
          },
        }))) as typeof fetch,
    });

    await assertRejects(
      () => client.callToolTextResult({ name: "syson_constraint_solve" }),
      McpToolCallError,
      "no content[0].text",
    );
  },
);

Deno.test(
  "callToolTextResult raises a typed error when content[0].text is not valid JSON",
  async () => {
    const client = new HttpMcpToolClient({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: (() =>
        Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "this is not json {" }],
          },
        }))) as typeof fetch,
    });

    await assertRejects(
      () => client.callToolTextResult({ name: "syson_constraint_solve" }),
      McpToolCallError,
      "not valid JSON",
    );
  },
);

Deno.test(
  "callToolTextResult raises a typed error when content[0].text parses to a non-object",
  async () => {
    const client = new HttpMcpToolClient({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: (() =>
        Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: JSON.stringify([1, 2, 3]) }],
          },
        }))) as typeof fetch,
    });

    await assertRejects(
      () => client.callToolTextResult({ name: "syson_constraint_solve" }),
      McpToolCallError,
      "did not parse to an object",
    );
  },
);

Deno.test(
  "callToolTextResult propagates isError from the provider tool",
  async () => {
    const client = new HttpMcpToolClient({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: (() =>
        Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            isError: true,
            content: [{ type: "text", text: "constraint set is unsatisfiable" }],
          },
        }))) as typeof fetch,
    });

    await assertRejects(
      () => client.callToolTextResult({ name: "syson_constraint_solve" }),
      McpToolCallError,
      "constraint set is unsatisfiable",
    );
  },
);
