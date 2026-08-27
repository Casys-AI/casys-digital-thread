import { assertEquals, assertThrows } from "@std/assert";
import {
  applyIssuedAt,
  callMcpTool,
  CLIENT_NAME,
  DEFAULT_MCP_URL,
  MCP_PROTOCOL_VERSION,
  type McpCallIo,
  parseMcpCallCli,
  printableResult,
  runMcpCall,
  utcIssuedAt,
} from "./mcp-call.ts";

Deno.test("mcp-call refuses to start when --name is missing", () => {
  assertThrows(
    () => parseMcpCallCli([]),
    TypeError,
    "mcp-call requires --name.",
  );
  assertThrows(
    () => parseMcpCallCli(["--name="]),
    TypeError,
    "mcp-call requires --name.",
  );
});

Deno.test("mcp-call rejects --args that are not a JSON object", () => {
  assertThrows(
    () => parseMcpCallCli(["--name=project_start", "--args=not-json"]),
    TypeError,
    "mcp-call --args must be a JSON object.",
  );
  assertThrows(
    () => parseMcpCallCli(["--name=project_start", "--args=[1]"]),
    TypeError,
    "mcp-call --args must be a JSON object.",
  );
  assertThrows(
    () => parseMcpCallCli(["--name=project_start", "--args=1"]),
    TypeError,
    "mcp-call --args must be a JSON object.",
  );
});

Deno.test("mcp-call defaults missing --args to an empty object", () => {
  assertEquals(parseMcpCallCli(["--name=project_start"]).args, {});
});

Deno.test("mcp-call defaults --url to the loopback Console MCP", () => {
  assertEquals(parseMcpCallCli(["--name=project_start"]).url, DEFAULT_MCP_URL);
});

Deno.test("mcp-call enables compact mutation receipts only when requested", () => {
  assertEquals(
    parseMcpCallCli(["--receipt", "--name=project_start"]).receipt,
    true,
  );
  assertEquals(parseMcpCallCli(["--name=project_start"]).receipt, false);
});

Deno.test("mcp-call fills issuedAt with current UTC seconds only when omitted on a mutation", () => {
  const now = new Date("2026-08-16T12:34:56.789Z");
  const original = { commandId: "start-1", projectId: "project-v3" };
  const filled = applyIssuedAt(original, now);
  assertEquals(filled.issuedAt, "2026-08-16T12:34:56.000Z");
  assertEquals(utcIssuedAt(now), "2026-08-16T12:34:56.000Z");
  assertEquals(Object.hasOwn(original, "issuedAt"), false);
});

Deno.test("mcp-call does not inject issuedAt on read-shaped arguments", () => {
  const now = new Date("2026-08-16T12:34:56.789Z");
  const snapshotArgs = { projectId: "project-v3" };
  assertEquals(applyIssuedAt(snapshotArgs, now), snapshotArgs);
  assertEquals(applyIssuedAt({ commandId: "   " }, now), { commandId: "   " });
});

Deno.test("mcp-call does not overwrite a caller-supplied issuedAt", () => {
  const now = new Date("2026-08-16T12:34:56.789Z");
  const kept = applyIssuedAt(
    { issuedAt: "2026-01-01T00:00:00.000Z" },
    now,
  );
  assertEquals(kept.issuedAt, "2026-01-01T00:00:00.000Z");
});

Deno.test("mcp-call posts TestMcpClient headers and casys-mcp-call clientInfo", async () => {
  let observed:
    | { url: string; init: RequestInit }
    | undefined;
  const now = () => new Date("2026-08-16T12:34:56.789Z");
  await callMcpTool(
    {
      name: "project_start",
      args: { commandId: "start-1", projectId: "project-v3" },
      url: DEFAULT_MCP_URL,
    },
    {
      now,
      fetch: ((input, init) => {
        observed = { url: String(input), init: init ?? {} };
        return Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { resultType: "complete" },
        }));
      }) as typeof fetch,
    },
  );

  const headers = new Headers(observed?.init.headers);
  assertEquals(observed?.url, DEFAULT_MCP_URL);
  assertEquals(observed?.init.method, "POST");
  assertEquals(headers.get("accept"), "application/json");
  assertEquals(headers.get("content-type"), "application/json");
  assertEquals(headers.get("mcp-protocol-version"), MCP_PROTOCOL_VERSION);
  assertEquals(headers.get("mcp-method"), "tools/call");
  assertEquals(headers.get("mcp-name"), "project_start");

  const body = JSON.parse(String(observed?.init.body)) as Record<string, unknown>;
  assertEquals(body.jsonrpc, "2.0");
  assertEquals(body.id, 1);
  assertEquals(body.method, "tools/call");
  const params = body.params as Record<string, unknown>;
  assertEquals(params.name, "project_start");
  assertEquals(params.arguments, {
    commandId: "start-1",
    projectId: "project-v3",
    issuedAt: "2026-08-16T12:34:56.000Z",
  });
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/protocolVersion"], MCP_PROTOCOL_VERSION);
  assertEquals(meta["io.modelcontextprotocol/clientCapabilities"], {});
  assertEquals(meta["io.modelcontextprotocol/clientInfo"], {
    name: CLIENT_NAME,
    version: "1",
  });
});

Deno.test("mcp-call prints the JSON-RPC result and exits 0", async () => {
  const io = captureIo({
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { resultType: "complete", ok: true },
      }))) as typeof fetch,
  });
  const code = await runMcpCall(["--name=project_list"], io);
  assertEquals(code, 0);
  assertEquals(JSON.parse(io.written.stdout[0]!), {
    resultType: "complete",
    ok: true,
  });
});

Deno.test("mcp-call prints the JSON-RPC error and exits 1", async () => {
  const io = captureIo({
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }))) as typeof fetch,
  });
  const code = await runMcpCall(["--name=missing_tool"], io);
  assertEquals(code, 1);
  assertEquals(JSON.parse(io.written.stdout[0]!), {
    code: -32601,
    message: "Method not found",
  });
});

Deno.test("mcp-call exits 1 when result.isError is true", async () => {
  const io = captureIo({
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          isError: true,
          content: [{ type: "text", text: "issuedAt cannot be later" }],
        },
      }))) as typeof fetch,
  });
  const code = await runMcpCall(
    [
      "--name=project_start",
      '--args={"issuedAt":"2026-01-01T00:00:00.000Z"}',
    ],
    io,
  );
  assertEquals(code, 1);
  const printed = JSON.parse(io.written.stdout[0]!) as Record<string, unknown>;
  assertEquals(printed.isError, true);
});

Deno.test("mcp-call exits 1 on a transport failure", async () => {
  const io = captureIo({
    fetch: (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch,
  });
  const code = await runMcpCall(["--name=project_list"], io);
  assertEquals(code, 1);
  assertEquals(JSON.parse(io.written.stdout[0]!), {
    code: "transport_failure",
    message: "connection refused",
  });
});

Deno.test("mcp-call posts to the given --url and never overwrites issuedAt", async () => {
  let observedUrl = "";
  let observedArgs: Record<string, unknown> | undefined;
  const io = captureIo({
    now: () => new Date("2026-08-16T12:34:56.789Z"),
    fetch: ((input, init) => {
      observedUrl = String(input);
      const body = JSON.parse(String(init?.body)) as {
        params: { arguments: Record<string, unknown> };
      };
      observedArgs = body.params.arguments;
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { resultType: "complete" },
      }));
    }) as typeof fetch,
  });
  const code = await runMcpCall([
    "--name=project_start",
    "--url=http://127.0.0.1:3999/mcp",
    '--args={"issuedAt":"2026-01-01T00:00:00.000Z","projectId":"p"}',
  ], io);
  assertEquals(code, 0);
  assertEquals(observedUrl, "http://127.0.0.1:3999/mcp");
  assertEquals(observedArgs, {
    issuedAt: "2026-01-01T00:00:00.000Z",
    projectId: "p",
  });
});

Deno.test("mcp-call prints structuredContent instead of the MCP envelope", async () => {
  const io = captureIo({
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          isError: false,
          content: [{ type: "text", text: "human string" }],
          structuredContent: { revision: 28, projectId: "desk-lamp-dl06" },
        },
      }))) as typeof fetch,
  });
  const code = await runMcpCall(["--name=project_snapshot"], io);
  assertEquals(code, 0);
  assertEquals(JSON.parse(io.written.stdout[0]!), {
    revision: 28,
    projectId: "desk-lamp-dl06",
  });
});

Deno.test("mcp-call --receipt prints the completed server receipt without the snapshot", async () => {
  const io = captureIo({
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          isError: false,
          content: [{
            type: "text",
            text: "Run run:architecture completed at project revision 42.",
          }],
          structuredContent: {
            project: { id: "desktop-parts-sorter-ps01" },
            revision: 42,
            phases: Array.from({ length: 20 }, (_, index) => ({ index })),
          },
        },
      }))) as typeof fetch,
  });
  const code = await runMcpCall([
    "--receipt",
    "--name=project_agent_run_execute",
  ], io);
  assertEquals(code, 0);
  assertEquals(JSON.parse(io.written.stdout[0]!), {
    receipt: "Run run:architecture completed at project revision 42.",
  });
});

Deno.test("mcp-call parses content[0].text when structuredContent is absent", () => {
  assertEquals(
    printableResult({
      content: [{ type: "text", text: '{"ok":true}' }],
    }),
    { ok: true },
  );
});

Deno.test("mcp-call writes a TypeError to stderr and exits 1 for invalid flags", async () => {
  const io = captureIo({
    fetch: (() => {
      throw new Error("fetch must not run after a flag error");
    }) as typeof fetch,
  });
  const code = await runMcpCall(["--args={}"], io);
  assertEquals(code, 1);
  assertEquals(io.written.stdout, []);
  assertEquals(io.written.stderr, ["mcp-call requires --name."]);
});

Deno.test("mcp-call --args=- reads a JSON object from stdin and honors --receipt", async () => {
  let observedArgs: Record<string, unknown> | undefined;
  const io = captureIo({
    stdin: () => JSON.stringify({ projectId: "desktop-parts-sorter-ps01" }),
    fetch: ((_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        params: { arguments: Record<string, unknown> };
      };
      observedArgs = body.params.arguments;
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          isError: false,
          content: [{
            type: "text",
            text: "Run run:architecture completed at project revision 42.",
          }],
          structuredContent: { revision: 42 },
        },
      }));
    }) as typeof fetch,
  });
  const code = await runMcpCall([
    "--receipt",
    "--name=project_agent_run_execute",
    "--args=-",
  ], io);
  assertEquals(code, 0);
  assertEquals(observedArgs, { projectId: "desktop-parts-sorter-ps01" });
  assertEquals(JSON.parse(io.written.stdout[0]!), {
    receipt: "Run run:architecture completed at project revision 42.",
  });
});

Deno.test("mcp-call rejects invalid or non-object stdin --args before fetch", async () => {
  for (const stdin of ["not-json", "[1]", "1"]) {
    const io = captureIo({
      stdin: () => stdin,
      fetch: (() => {
        throw new Error("fetch must not run after a stdin args error");
      }) as typeof fetch,
    });
    const code = await runMcpCall(
      ["--name=project_start", "--args=-"],
      io,
    );
    assertEquals(code, 1);
    assertEquals(io.written.stdout, []);
    assertEquals(io.written.stderr, ["mcp-call --args must be a JSON object."]);
  }
});

Deno.test("mcp-call never reads stdin when --args is inline JSON", async () => {
  let stdinReads = 0;
  const io = captureIo({
    stdin: () => {
      stdinReads += 1;
      throw new Error("stdin must not be read for inline --args");
    },
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { resultType: "complete" },
      }))) as typeof fetch,
  });
  const code = await runMcpCall([
    "--name=project_list",
    "--args={}",
  ], io);
  assertEquals(code, 0);
  assertEquals(stdinReads, 0);
});

function captureIo(
  extras: McpCallIo = {},
) {
  const written = { stdout: [] as string[], stderr: [] as string[] };
  return {
    ...extras,
    written,
    stdout: (text: string) => written.stdout.push(text),
    stderr: (text: string) => written.stderr.push(text),
  };
}
