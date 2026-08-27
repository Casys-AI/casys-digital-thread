import { assertEquals, assertRejects } from "@std/assert";
import {
  type ExpectedProviderResource,
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  HttpMcpResourceReader,
  McpResourceReadError,
} from "./http-mcp-resource-reader.ts";
import {
  StatelessMcpHttpTransport,
  StatelessMcpTransportError,
} from "./stateless-mcp-http-transport.ts";

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
  options: {
    rawResult?: boolean;
    names?: Array<string | null>;
  } = {},
): typeof fetch {
  return ((_input, init) => {
    assertEquals(init?.redirect, "error");
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    methods.push(body.method);
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("mcp-protocol-version"), "2026-07-28");
    assertEquals(headers.get("mcp-method"), "resources/read");
    assertEquals(body.params.uri, URI);
    assertEquals(Object.hasOwn(body.params, "_meta"), true);
    const name = headers.get("mcp-name");
    options.names?.push(name);
    if (name !== body.params.uri) {
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32020,
          message: "Mcp-Name must mirror params.uri",
        },
      }, { status: 400 }));
    }
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: options.rawResult ? result : liveResourceResult(result),
    }));
  }) as typeof fetch;
}

function liveResourceResult(result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return result;
  }
  return {
    resultType: "complete",
    ttlMs: 0,
    cacheScope: "private",
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: "strict-resource-provider",
        version: "1.0.0",
      },
    },
    ...result,
  };
}

Deno.test("HttpMcpResourceReader mirrors the exact URI into Mcp-Name required by resources/read", async () => {
  const bytes = new TextEncoder().encode("bound");
  const expected = await expectedFor(bytes, "text/plain");
  const names: Array<string | null> = [];
  const strictFetch = rpcFetch(
    {
      contents: [{ uri: URI, mimeType: expected.mediaType, text: "bound" }],
    },
    [],
    { names },
  );

  const bareTransport = new StatelessMcpHttpTransport({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: strictFetch,
  });
  await assertRejects(
    () =>
      bareTransport.request({
        method: "resources/read",
        label: "resources/read",
        params: { uri: URI },
      }),
    StatelessMcpTransportError,
    "HTTP 400",
  );

  const reader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: strictFetch,
  });
  assertEquals((await reader.read(expected)).bytes.copy(), bytes);
  assertEquals(names, [null, URI]);
});

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

Deno.test("HttpMcpResourceReader validates the complete cache envelope fail-closed", async () => {
  const expected = await expectedFor(new Uint8Array());
  const contents = [{ uri: URI, mimeType: expected.mediaType, blob: "" }];
  const valid = liveResourceResult({ contents }) as Record<string, unknown>;

  const publicReader = new HttpMcpResourceReader({
    mcpUrl: "http://127.0.0.1:3999/mcp",
    fetch: rpcFetch({ ...valid, cacheScope: "public" }, [], { rawResult: true }),
  });
  assertEquals((await publicReader.read(expected)).bytes.byteLength, 0);

  const malformed: Array<[Record<string, unknown>, string]> = [
    [{ ...valid, resultType: "input_required" }, 'resultType must be "complete"'],
    [without(valid, "resultType"), 'resultType must be "complete"'],
    [{ ...valid, ttlMs: -1 }, "non-negative safe integer"],
    [{ ...valid, ttlMs: 0.5 }, "non-negative safe integer"],
    [{ ...valid, ttlMs: Number.MAX_SAFE_INTEGER + 1 }, "non-negative safe integer"],
    [without(valid, "ttlMs"), "non-negative safe integer"],
    [
      { ...valid, cacheScope: "tenant" },
      'cacheScope must be "private" or "public"',
    ],
    [
      without(valid, "cacheScope"),
      'cacheScope must be "private" or "public"',
    ],
    [{ ...valid, unexpected: true }, "malformed result object"],
  ];
  for (const [result, message] of malformed) {
    const reader = new HttpMcpResourceReader({
      mcpUrl: "http://127.0.0.1:3999/mcp",
      fetch: rpcFetch(result, [], { rawResult: true }),
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
        result: liveResourceResult({
          contents: [{ uri: URI, mimeType: expected.mediaType, blob: "" }],
        }),
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

function without(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key));
}
