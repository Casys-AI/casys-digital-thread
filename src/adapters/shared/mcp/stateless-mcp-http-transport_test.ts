import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  createInternalMcpBearerCredential,
  StatelessMcpHttpTransport,
  StatelessMcpTransportError,
} from "./stateless-mcp-http-transport.ts";

const TOKEN = "secret-token-for-transport-test";

Deno.test("opaque bearer credentials reach only the HTTP fetch boundary", async () => {
  let observedHeaders: Headers | undefined;
  let observedBody = "";
  const credential = createInternalMcpBearerCredential(TOKEN);
  const transport = new StatelessMcpHttpTransport({
    mcpUrl: "http://127.0.0.1:3025/mcp",
    bearerCredential: credential,
    fetch: ((_input, init) => {
      observedHeaders = new Headers(init?.headers);
      observedBody = String(init?.body);
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { resultType: "complete" },
      }));
    }) as typeof fetch,
  });

  await transport.request({ method: "tools/call", label: "fixed", params: {} });

  assertEquals(observedHeaders?.get("authorization"), `Bearer ${TOKEN}`);
  assertEquals(observedBody.includes(TOKEN), false);
  assertEquals(JSON.stringify(credential).includes(TOKEN), false);
  assertEquals(JSON.stringify(transport).includes(TOKEN), false);
});

Deno.test("stateless transport redacts bearer values from fetch and JSON-RPC failures", async () => {
  const credential = createInternalMcpBearerCredential(TOKEN);
  const fetchFailure = new StatelessMcpHttpTransport({
    mcpUrl: "http://127.0.0.1:3025/mcp",
    bearerCredential: credential,
    fetch: (() =>
      Promise.reject(new Error(`network reflected ${TOKEN}`))) as typeof fetch,
  });
  await assertRedacted(fetchFailure);

  const rpcFailure = new StatelessMcpHttpTransport({
    mcpUrl: "http://127.0.0.1:3025/mcp",
    bearerCredential: credential,
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: `provider reflected ${TOKEN}` },
      }))) as typeof fetch,
  });
  const rpcError = await assertSecretAbsent(rpcFailure);
  assertEquals(rpcError.kind, "rpc-rejection");
});

Deno.test("stateless transport preserves a definite HTTP auth rejection", async () => {
  const transport = new StatelessMcpHttpTransport({
    mcpUrl: "http://127.0.0.1:3025/mcp",
    bearerCredential: createInternalMcpBearerCredential(TOKEN),
    fetch: (() =>
      Promise.resolve(
        new Response(`proxy reflected ${TOKEN}`, {
          status: 401,
        }),
      )) as typeof fetch,
  });

  let thrown: unknown;
  try {
    await transport.request({ method: "tools/call", label: "fixed", params: {} });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof StatelessMcpTransportError);
  assertEquals(thrown.kind, "http-rejection");
  assertEquals(thrown.httpStatus, 401);
  assertEquals(thrown.message.includes(TOKEN), false);
});

Deno.test("stateless transport refuses URLs that could carry credentials through a query", () => {
  assertThrows(
    () =>
      new StatelessMcpHttpTransport({
        mcpUrl: "http://127.0.0.1:3025/mcp?token=never",
      }),
    TypeError,
    "absolute HTTP(S) URL",
  );
});

async function assertRedacted(transport: StatelessMcpHttpTransport): Promise<void> {
  let thrown: unknown;
  try {
    await transport.request({ method: "tools/call", label: "fixed", params: {} });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof StatelessMcpTransportError);
  assertEquals(thrown.message.includes(TOKEN), false);
  assertEquals(thrown.message.includes("[redacted]"), true);
}

async function assertSecretAbsent(
  transport: StatelessMcpHttpTransport,
): Promise<StatelessMcpTransportError> {
  let thrown: unknown;
  try {
    await transport.request({ method: "tools/call", label: "fixed", params: {} });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof StatelessMcpTransportError);
  assertEquals(thrown.message.includes(TOKEN), false);
  return thrown;
}
