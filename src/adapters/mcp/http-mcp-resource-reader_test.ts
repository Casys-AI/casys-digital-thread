import { assertEquals, assertRejects } from "@std/assert";
import {
  type ExpectedProviderResource,
  fingerprintResourceBytes,
} from "../../domain/analysis/provider-resource-reader.ts";
import {
  HttpMcpResourceReader,
  McpResourceReadError,
} from "./http-mcp-resource-reader.ts";

const URI = "artifact://provider/run-1/result.bin";

async function expectedFor(
  bytes: Uint8Array,
  mediaType = "application/octet-stream",
): Promise<ExpectedProviderResource> {
  return {
    uri: URI,
    mediaType,
    byteCount: bytes.byteLength,
    sha256: await fingerprintResourceBytes(bytes),
  };
}

function rpcFetch(
  result: unknown,
  methods: string[] = [],
): typeof fetch {
  return ((_input, init) => {
    assertEquals(init?.redirect, "error");
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    methods.push(body.method);
    assertEquals(new Headers(init?.headers).get("mcp-protocol-version"), "2026-07-28");
    assertEquals(new Headers(init?.headers).get("mcp-method"), "resources/read");
    assertEquals(body.params.uri, URI);
    assertEquals(Object.hasOwn(body.params, "_meta"), true);
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result,
    }));
  }) as typeof fetch;
}

Deno.test("HttpMcpResourceReader turns multibyte text into exact UTF-8 bytes without listing", async () => {
  const bytes = new TextEncoder().encode("café ☕");
  const expected = await expectedFor(bytes, "text/plain; charset=utf-8");
  const methods: string[] = [];
  const reader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: rpcFetch({
      contents: [{
        uri: URI,
        mimeType: "text/plain; charset=utf-8",
        text: "café ☕",
        _meta: { providerRunId: "run-1" },
      }],
      _meta: {},
    }, methods),
  });

  const result = await reader.read(expected);
  assertEquals(result.bytes.copy(), bytes);
  assertEquals(result.attestation.sha256, expected.sha256);
  assertEquals(methods, ["resources/read"]);
});

Deno.test("HttpMcpResourceReader decodes canonical blob bytes", async () => {
  const bytes = new Uint8Array([0, 255, 16, 42]);
  const reader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: rpcFetch({
      contents: [{ uri: URI, mimeType: "application/octet-stream", blob: "AP8QKg==" }],
    }),
  });
  assertEquals((await reader.read(await expectedFor(bytes))).bytes.copy(), bytes);
});

Deno.test("HttpMcpResourceReader preserves a canonical zero-byte blob", async () => {
  const bytes = new Uint8Array();
  const expected = await expectedFor(bytes);
  const reader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: rpcFetch({
      contents: [{ uri: URI, mimeType: expected.mediaType, blob: "" }],
    }),
  });
  const read = await reader.read(expected);
  assertEquals(read.bytes.byteLength, 0);
  assertEquals(read.bytes.copy(), bytes);
});

Deno.test("HttpMcpResourceReader rejects non-canonical and malformed base64", async () => {
  const expected = await expectedFor(new Uint8Array([0]));
  for (const blob of ["AB==", "AA", "AA==\n", "AA-_", "***="]) {
    const reader = new HttpMcpResourceReader({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: rpcFetch({
        contents: [{ uri: URI, mimeType: expected.mediaType, blob }],
      }),
    });
    await assertRejects(
      () => reader.read(expected),
      McpResourceReadError,
      "canonical base64",
    );
  }
});

Deno.test("HttpMcpResourceReader rejects URI, MIME, count, and hash mismatches", async () => {
  const bytes = new TextEncoder().encode("ok");
  const expected = await expectedFor(bytes, "text/plain");
  const cases: Array<[unknown, ExpectedProviderResource, string]> = [
    [
      { contents: [{ uri: `${URI}-other`, mimeType: "text/plain", text: "ok" }] },
      expected,
      "URI mismatch",
    ],
    [
      { contents: [{ uri: URI, mimeType: "text/csv", text: "ok" }] },
      expected,
      "mimeType mismatch",
    ],
    [
      { contents: [{ uri: URI, mimeType: "text/plain", text: "ok" }] },
      { ...expected, byteCount: 3 },
      "expected 3",
    ],
    [
      { contents: [{ uri: URI, mimeType: "text/plain", text: "ok" }] },
      { ...expected, sha256: "a".repeat(64) },
      "expected aaaaaaaaa",
    ],
  ];
  for (const [result, expectedCase, message] of cases) {
    const reader = new HttpMcpResourceReader({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: rpcFetch(result),
    });
    await assertRejects(
      () => reader.read(expectedCase),
      McpResourceReadError,
      message,
    );
  }
});

Deno.test("HttpMcpResourceReader requires exactly one well-formed ResourceContents", async () => {
  const bytes = new Uint8Array();
  const expected = await expectedFor(bytes);
  const malformed: Array<[unknown, string]> = [
    [{ contents: [] }, "received 0"],
    [
      {
        contents: [
          { uri: URI, mimeType: expected.mediaType, blob: "" },
          { uri: URI, mimeType: expected.mediaType, blob: "" },
        ],
      },
      "received 2",
    ],
    [{}, "malformed result"],
    [{ contents: "not-an-array" }, "must be an array"],
    [{ contents: [{}] }, "requires uri and mimeType"],
    [
      { contents: [{ uri: URI, mimeType: expected.mediaType }] },
      "exactly one of text or blob",
    ],
    [
      {
        contents: [{
          uri: URI,
          mimeType: expected.mediaType,
          text: "",
          blob: "",
        }],
      },
      "exactly one of text or blob",
    ],
    [
      {
        contents: [{
          uri: URI,
          mimeType: expected.mediaType,
          blob: "",
          annotations: {},
        }],
      },
      "unsupported fields",
    ],
    [
      {
        contents: [{
          uri: URI,
          mimeType: expected.mediaType,
          blob: "",
          _meta: "not-an-object",
        }],
      },
      "_meta must be an object",
    ],
    [{ contents: [], _meta: "not-an-object" }, "result _meta must be an object"],
  ];
  for (const [result, message] of malformed) {
    const reader = new HttpMcpResourceReader({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: rpcFetch(result),
    });
    await assertRejects(
      () => reader.read(expected),
      McpResourceReadError,
      message,
    );
  }
});

Deno.test("HttpMcpResourceReader rejects path-like caller input before network I/O", async () => {
  let calls = 0;
  const reader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: (() => {
      calls += 1;
      return Promise.reject(new Error("must not run"));
    }) as typeof fetch,
  });
  await assertRejects(
    () =>
      reader.read({
        uri: "./provider-output.bin",
        mediaType: "application/octet-stream",
        byteCount: 0,
        sha256: "0".repeat(64),
      }),
    TypeError,
    "absolute canonical URI",
  );
  assertEquals(calls, 0);
});

Deno.test("HttpMcpResourceReader fails closed if a transport reports a redirect", async () => {
  const bytes = new Uint8Array();
  const expected = await expectedFor(bytes);
  const reader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: ((_input, init) => {
      assertEquals(init?.redirect, "error");
      const body = JSON.parse(String(init?.body)) as { id: number };
      const response = Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { contents: [{ uri: URI, mimeType: expected.mediaType, blob: "" }] },
      });
      Object.defineProperty(response, "redirected", { value: true });
      return Promise.resolve(response);
    }) as typeof fetch,
  });
  await assertRejects(
    () => reader.read(expected),
    McpResourceReadError,
    "redirected the request",
  );
});
