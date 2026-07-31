/**
 * Local MCP Apps host for the existing Thread Console resource.
 *
 * This deliberately is not mcp-compose. It is a small, read-only browser
 * harness for visual testing: it reads the registered UI resource from the
 * live console MCP and proxies only the three read-only console tools that
 * the App itself uses.
 *
 * Usage:
 *   deno task preview:browser
 *   deno run --allow-net=127.0.0.1 scripts/console-browser-harness.ts \
 *     --port 3021 --mcp-url http://127.0.0.1:3020/mcp
 */

const DEFAULT_PORT = 3021;
const DEFAULT_MCP_URL = "http://127.0.0.1:3020/mcp";
const CONSOLE_RESOURCE_URI = "ui://casys-digital-thread/console";
const MCP_PROTOCOL_VERSION = "2026-07-28";
const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

const ALLOWED_TOOLS = new Set([
  "console_snapshot",
  "console_refresh",
  "console_run_detail",
]);

interface HarnessOptions {
  port: number;
  mcpUrl: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const options = parseCli(Deno.args);
let nextRequestId = 1;
let mcpCallQueue: Promise<unknown> = Promise.resolve();

const server = Deno.serve(
  { hostname: "127.0.0.1", port: options.port },
  async (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return htmlResponse(await hostPage());
    }
    if (request.method === "GET" && url.pathname === "/resource/console.html") {
      try {
        return htmlResponse(await readConsoleResource());
      } catch (error) {
        return htmlResponse(resourceErrorPage(error), 502);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/mcp") {
      return await proxyAppRequest(request);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        kind: "mcp-app-browser-harness",
        mcpUrl: options.mcpUrl,
        resource: CONSOLE_RESOURCE_URI,
      });
    }
    return new Response("Not found", { status: 404 });
  },
);

console.error(
  `Casys MCP Apps browser harness: http://127.0.0.1:${server.addr.port}/`,
);
console.error(
  `Reads ${CONSOLE_RESOURCE_URI} and proxies read-only calls to ${options.mcpUrl}`,
);

async function proxyAppRequest(request: Request): Promise<Response> {
  let message: JsonRpcRequest;
  try {
    message = await request.json() as JsonRpcRequest;
  } catch {
    return jsonResponse(rpcError(null, -32700, "Invalid JSON request."), 400);
  }

  if (!isRequest(message)) {
    return jsonResponse(rpcError(null, -32600, "Invalid JSON-RPC request."), 400);
  }
  if (message.id === undefined) {
    return new Response(null, { status: 202 });
  }

  if (message.method === "tools/call") {
    const toolName = toolNameFrom(message.params);
    if (!toolName || !ALLOWED_TOOLS.has(toolName)) {
      return jsonResponse(
        rpcError(
          message.id,
          -32601,
          "This harness proxies only the console's read-only tools.",
        ),
        403,
      );
    }
  } else if (message.method !== "resources/read") {
    return jsonResponse(
      rpcError(message.id, -32601, `Unsupported MCP Apps request: ${message.method}`),
      400,
    );
  }

  try {
    const upstream = await callMcp(message.method, message.params);
    return jsonResponse({ ...upstream, id: message.id });
  } catch (error) {
    return jsonResponse(
      rpcError(message.id, -32000, errorMessage(error)),
      502,
    );
  }
}

async function readConsoleResource(): Promise<string> {
  const response = await callMcp("resources/read", { uri: CONSOLE_RESOURCE_URI });
  const result = asRecord(response.result);
  const contents = result ? result.contents : undefined;
  if (!Array.isArray(contents)) {
    throw new Error("The console MCP returned no resource contents.");
  }
  const console = contents.find((item) =>
    asRecord(item)?.uri === CONSOLE_RESOURCE_URI &&
    typeof asRecord(item)?.text === "string"
  );
  const text = asRecord(console)?.text;
  if (typeof text !== "string") {
    throw new Error(`The console MCP did not return ${CONSOLE_RESOURCE_URI} as HTML.`);
  }
  return text;
}

/**
 * Proxies every call through the Console's stateless MCP endpoint. A browser
 * refresh or viewer tool call therefore observes the server currently bound
 * on port 3020; it never reads a fixture or talks directly to Docker.
 */
function callMcp(method: string, params: unknown): Promise<JsonRpcResponse> {
  const call = mcpCallQueue.then(() => callMcpStateless(method, params));
  mcpCallQueue = call.catch(() => undefined);
  return call;
}

async function callMcpStateless(
  method: string,
  params: unknown,
): Promise<JsonRpcResponse> {
  const response = await postMcp({
    jsonrpc: "2.0",
    id: nextId(),
    method,
    params: statelessParams(params),
  });
  return await jsonRpcFrom(response);
}

async function postMcp(
  payload: Omit<JsonRpcRequest, "id"> | JsonRpcRequest,
): Promise<Response> {
  const params = asRecord(payload.params);
  const headers = new Headers({
    "Accept": "application/json",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": payload.method,
  });
  const name = payload.method === "tools/call"
    ? params?.name
    : payload.method === "resources/read"
    ? params?.uri
    : undefined;
  if (typeof name === "string") headers.set("Mcp-Name", name);
  const response = await fetch(options.mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 202) {
    const body = await response.text();
    throw new Error(`MCP HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response;
}

function statelessParams(params: unknown): Record<string, unknown> {
  return {
    ...asRecord(params),
    _meta: {
      "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        name: "casys-console-browser-harness",
        version: "0.1.0",
      },
    },
  };
}

async function jsonRpcFrom(response: Response): Promise<JsonRpcResponse> {
  const body = await response.text();
  if (body.trim() === "") {
    throw new Error(`MCP returned an empty response (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`MCP returned non-JSON content: ${body.slice(0, 500)}`);
  }
  if (!isResponse(payload)) {
    throw new Error("MCP returned an invalid JSON-RPC response.");
  }
  return payload;
}

async function hostPage(): Promise<string> {
  const initialToolResult = await initialSnapshotResult();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Casys Thread Console — local MCP Apps harness</title>
    <style>
      :root { color-scheme: dark; background: #090b0c; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; background: #090b0c; color: #dbe6e3; }
      header { min-height: 42px; display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid #273133; background: #101617; font-size: 12px; }
      strong { color: #a9d16e; }
      small { color: #95a3a2; }
      .dot { width: 8px; height: 8px; border-radius: 999px; background: #a9d16e; box-shadow: 0 0 12px #a9d16e; }
      iframe { display: block; width: 100%; height: calc(100vh - 42px); border: 0; background: #090b0c; }
    </style>
  </head>
  <body>
    <header>
      <span class="dot" aria-hidden="true"></span>
      <strong>LOCAL MCP APPS HARNESS</strong>
      <small>real resource + read-only tool calls relayed to the live console; not mcp-compose</small>
    </header>
    <iframe id="console" title="Casys Thread Console"></iframe>
    <script>
      const frame = document.getElementById("console");
      const hostResult = {
        protocolVersion: ${JSON.stringify(MCP_APP_PROTOCOL_VERSION)},
        hostInfo: { name: "casys-console-browser-harness", version: "0.1.0" },
        hostCapabilities: { serverTools: {}, serverResources: {} },
        hostContext: { theme: "dark", displayMode: "inline", locale: "en-US" },
      };
      const initialToolResult = ${inlineJson(initialToolResult)};
      let initialResultDelivered = false;

      function reply(id, result) {
        frame.contentWindow.postMessage({ jsonrpc: "2.0", id, result }, "*");
      }

      function fail(id, code, message) {
        frame.contentWindow.postMessage({
          jsonrpc: "2.0",
          id,
          error: { code, message },
        }, "*");
      }

      window.addEventListener("message", async (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;

        if (message.method === "ui/initialize") {
          if (message.id !== undefined) reply(message.id, hostResult);
          return;
        }
        if (message.method === "ui/notifications/initialized") {
          if (!initialResultDelivered) {
            initialResultDelivered = true;
            frame.contentWindow.postMessage({
              jsonrpc: "2.0",
              method: "ui/notifications/tool-result",
              params: initialToolResult,
            }, "*");
          }
          return;
        }
        if (message.method === "tools/call" || message.method === "resources/read") {
          if (message.id === undefined) return;
          try {
            const response = await fetch("/api/mcp", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(message),
            });
            const payload = await response.json();
            frame.contentWindow.postMessage(payload, "*");
          } catch (error) {
            fail(message.id, -32000, error instanceof Error ? error.message : "Harness proxy failed.");
          }
          return;
        }
        if (message.method === "ui/request-display-mode") {
          if (message.id !== undefined) reply(message.id, {});
          return;
        }
        if (message.id !== undefined) {
          fail(message.id, -32601, "Unsupported MCP Apps request in the local harness.");
        }
      });
      // Register the host bridge before the App resource starts its
      // ui/initialize handshake.
      frame.src = "/resource/console.html";
    </script>
  </body>
</html>`;
}

/** The host, not the view, executes the tool that opens the Console. */
async function initialSnapshotResult(): Promise<unknown> {
  try {
    const response = await callMcp("tools/call", {
      name: "console_snapshot",
      arguments: {},
    });
    if (response.error) {
      return {
        isError: true,
        content: [{ type: "text", text: response.error.message }],
      };
    }
    if (!asRecord(response.result)) {
      return {
        isError: true,
        content: [{ type: "text", text: "Console MCP returned no tool result." }],
      };
    }
    return response.result;
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: errorMessage(error) }],
    };
  }
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function resourceErrorPage(error: unknown): string {
  return `<!doctype html><title>Console resource unavailable</title><pre>${
    escapeHtml(
      `Unable to read ${CONSOLE_RESOURCE_URI} from ${options.mcpUrl}: ${
        errorMessage(error)
      }`,
    )
  }</pre>`;
}

function parseCli(args: string[]): HarnessOptions {
  const result: HarnessOptions = { port: DEFAULT_PORT, mcpUrl: DEFAULT_MCP_URL };
  for (let index = 0; index < args.length; index++) {
    let argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: deno task preview:browser [--port 3021] [--mcp-url http://127.0.0.1:3020/mcp]",
      );
      Deno.exit(0);
    }
    if (argument === "--port") argument = `--port=${args[++index] ?? ""}`;
    if (argument === "--mcp-url") argument = `--mcp-url=${args[++index] ?? ""}`;
    if (argument.startsWith("--port=")) {
      result.port = positivePort(argument.slice("--port=".length));
    } else if (argument.startsWith("--mcp-url=")) {
      result.mcpUrl = httpUrl(argument.slice("--mcp-url=".length));
    } else {
      throw new TypeError(`Unknown option: ${argument}`);
    }
  }
  return result;
}

function positivePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError("--port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function httpUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("--mcp-url must use http or https.");
  }
  return parsed.href;
}

function nextId(): number {
  return nextRequestId++;
}

function isRequest(value: unknown): value is JsonRpcRequest {
  const record = asRecord(value);
  return record?.jsonrpc === "2.0" && typeof record.method === "string";
}

function isResponse(value: unknown): value is JsonRpcResponse {
  const record = asRecord(value);
  return record?.jsonrpc === "2.0" && "id" in record &&
    ("result" in record || "error" in record);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toolNameFrom(params: unknown): string | undefined {
  const record = asRecord(params);
  return typeof record?.name === "string" ? record.name : undefined;
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
