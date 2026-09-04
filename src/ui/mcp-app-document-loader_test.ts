import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import type { ThreadViewerSession } from "../presentation/workbench/thread/viewer-sessions.ts";
import {
  loadVerifiedMcpAppDocument,
  materializeMcpAppDocument,
  MCP_APP_CHILD_CONTENT_SECURITY_POLICY,
  MCP_APP_DOCUMENT_MIME_TYPE,
  type McpAppHostNonceMetaRoot,
  type McpAppObjectUrlFactory,
  planMcpAppDocument,
  readMcpAppHostScriptNonce,
} from "./src/thread/mcp-app-document-loader.ts";

const HOST_NONCE = "A".repeat(43);
const APP_HTML = [
  '<!doctype html><html><head><meta charset="utf-8">',
  "<style>body{color:CanvasText}</style></head><body>",
  "<script type='module' crossorigin>globalThis.first = 1; globalThis.second = 2; globalThis.moduleUrl = import.meta.url;</script>",
  "</body></html>",
].join("");
const APP_BYTES = new TextEncoder().encode(APP_HTML);

Deno.test("whole-App loader attests raw bytes before producing a closed Blob child", async () => {
  const session = await sessionFor(APP_BYTES);
  const objectUrls = new FakeObjectUrls();
  let input: RequestInfo | URL | undefined;
  let init: RequestInit | undefined;
  const loaded = await loadVerifiedMcpAppDocument(session, HOST_NONCE, {
    objectUrls,
    fetcher: (nextInput, nextInit) => {
      input = nextInput;
      init = nextInit;
      return Promise.resolve(exactResponse(APP_BYTES));
    },
  });

  assertEquals(input, session.launchUri);
  assertEquals(init?.method, "GET");
  assertEquals(init?.cache, "no-store");
  assertEquals(init?.credentials, "same-origin");
  assertEquals(init?.redirect, "error");
  assertEquals(init?.headers, { Accept: MCP_APP_DOCUMENT_MIME_TYPE });
  assertEquals(objectUrls.blobs.length, 1);
  const childHtml = await objectUrls.blobs[0]!.text();
  assertStringIncludes(childHtml, MCP_APP_CHILD_CONTENT_SECURITY_POLICY);
  assertStringIncludes(childHtml, "script-src 'none'");
  assertStringIncludes(childHtml, "script-src-attr 'none'");
  assertStringIncludes(
    childHtml,
    `<script type="module" crossorigin nonce="${HOST_NONCE}">globalThis.first = 1; globalThis.second = 2; globalThis.moduleUrl = import.meta.url;</script>`,
  );
  assertEquals(childHtml.includes(HOST_NONCE), true);
  assertEquals(childHtml.includes("nonce-"), false);
  assertEquals(childHtml.includes("http:"), false);
  assertEquals(childHtml.includes("https:"), false);
  assertEquals(
    childHtml.indexOf("<script") <
      childHtml.indexOf('http-equiv="Content-Security-Policy"'),
    true,
  );
  assertEquals(
    childHtml.indexOf('http-equiv="Content-Security-Policy"') <
      childHtml.indexOf("<style>"),
    true,
  );
  assertEquals(loaded.url, "blob:test/1");

  loaded.revoke();
  loaded.revoke();
  assertEquals(objectUrls.revoked, ["blob:test/1"]);
});

Deno.test("whole-App loader accepts absent Content-Length only after exact bounded EOF", async () => {
  const session = await sessionFor(APP_BYTES);
  const objectUrls = new FakeObjectUrls();
  const loaded = await loadVerifiedMcpAppDocument(session, HOST_NONCE, {
    objectUrls,
    fetcher: () =>
      Promise.resolve(
        new Response(APP_BYTES, {
          headers: { "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE },
        }),
      ),
  });
  assertEquals(objectUrls.blobs.length, 1);
  loaded.revoke();
});

Deno.test("whole-App loader rejects status, redirect, MIME, size and SHA drift before HTML parsing", async () => {
  const session = await sessionFor(APP_BYTES);
  const changed = Uint8Array.from(APP_BYTES);
  changed[changed.length - 1] ^= 1;

  const cases: Array<{
    readonly name: string;
    readonly response: () => Response;
  }> = [
    {
      name: "status",
      response: () =>
        new Response("missing", {
          status: 404,
          headers: { "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE },
        }),
    },
    {
      name: "MIME",
      response: () =>
        new Response(APP_BYTES, {
          headers: {
            "Content-Type": "text/html",
            "Content-Length": String(APP_BYTES.byteLength),
          },
        }),
    },
    {
      name: "declared size",
      response: () =>
        new Response(APP_BYTES, {
          headers: {
            "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE,
            "Content-Length": String(APP_BYTES.byteLength + 1),
          },
        }),
    },
    {
      name: "stream size",
      response: () =>
        new Response(APP_BYTES.slice(0, -1), {
          headers: { "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE },
        }),
    },
    {
      name: "SHA",
      response: () =>
        new Response(changed, {
          headers: {
            "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE,
            "Content-Length": String(changed.byteLength),
          },
        }),
    },
    {
      name: "encoding",
      response: () =>
        new Response(APP_BYTES, {
          headers: {
            "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE,
            "Content-Length": String(APP_BYTES.byteLength),
            "Content-Encoding": "gzip",
          },
        }),
    },
  ];

  for (const candidate of cases) {
    const objectUrls = new FakeObjectUrls();
    await assertRejects(
      () =>
        loadVerifiedMcpAppDocument(session, HOST_NONCE, {
          objectUrls,
          fetcher: () => Promise.resolve(candidate.response()),
        }),
      Error,
      undefined,
      candidate.name,
    );
    assertEquals(objectUrls.blobs.length, 0, candidate.name);
    assertEquals(objectUrls.revoked, [], candidate.name);
  }
});

Deno.test("whole-App HTML admission refuses original script authority and ambiguous forms", () => {
  const rejected = [
    '<!doctype html><html><img src="/leak"><head></head><body><script type="module">x()</script></body></html>',
    '<!doctype html><html><style>@import "/leak"</style><head></head><body><script type="module">x()</script></body></html>',
    '<!doctype html><html><meta http-equiv="refresh" content="0;url=/leak"><head></head><body><script type="module">x()</script></body></html>',
    '<html><head></head><body><script src="https://evil.invalid/x.js"></script></body></html>',
    '<html><head></head><body><script type="module" integrity="sha256-x">x()</script></body></html>',
    '<html><head></head><body><script type="module" crossorigin="anonymous">x()</script></body></html>',
    '<html><head></head><body><script type="importmap">{}</script></body></html>',
    '<html><head></head><body><script type="speculationrules">{}</script></body></html>',
    '<html><head><link rel="modulepreload" href="https://evil.invalid/x.js"></head><body></body></html>',
    "<html><head></head><body><script type=module>x()</script></body></html>",
    "<html><head></head><body><script>x()</script></body></html>",
    '<html><head></head><body><script type="module"/>x()</body></html>',
    '<html><body><script type="module">x()</script><head></head></body></html>',
    "<html><head></head><head></head><body></body></html>",
    '<html><head></head><body><script type="module">x()</script ></body></html>',
    '<html><head></head><body><script type="module">x()</script><script type="module">y()</script></body></html>',
    "<html><head></head><body></body></html>",
  ];
  for (const html of rejected) {
    assertThrows(() => planMcpAppDocument(html), Error, undefined, html);
  }
});

Deno.test("whole-App plan moves one exact module before the closing child CSP", () => {
  const plan = planMcpAppDocument(APP_HTML);
  assertEquals(
    plan.scriptSource,
    "globalThis.first = 1; globalThis.second = 2; globalThis.moduleUrl = import.meta.url;",
  );
  assertEquals(plan.crossOrigin, true);
  const html = materializeMcpAppDocument(plan, HOST_NONCE);
  assertEquals(
    html.indexOf("<script") <
      html.indexOf('http-equiv="Content-Security-Policy"'),
    true,
  );
  assertEquals(
    html.indexOf('http-equiv="Content-Security-Policy"') <
      html.indexOf("<style>"),
    true,
  );
  assertEquals((html.match(/<script/g) ?? []).length, 1);
  assertEquals(html.includes("src="), false);
});

Deno.test("whole-App plan admits formatting whitespace between html and head", () => {
  const formatted = APP_HTML.replace(
    "<html><head>",
    '<html lang="fr">\n  <head>',
  );
  const plan = planMcpAppDocument(formatted);
  assertEquals(
    plan.scriptSource,
    "globalThis.first = 1; globalThis.second = 2; globalThis.moduleUrl = import.meta.url;",
  );
});

Deno.test("whole-App loader revokes the HTML Blob on stale abort", async () => {
  const session = await sessionFor(APP_BYTES);
  const abort = new AbortController();
  const abortedUrls = new FakeObjectUrls(() => {
    if (abortedUrls.blobs.length === 1) abort.abort("stale-session");
  });
  await assertRejects(() =>
    loadVerifiedMcpAppDocument(session, HOST_NONCE, {
      signal: abort.signal,
      objectUrls: abortedUrls,
      fetcher: () => Promise.resolve(exactResponse(APP_BYTES)),
    })
  );
  assertEquals(abortedUrls.revoked, ["blob:test/1"]);
});

Deno.test("whole-App host nonce is unique and absent from the closing child CSP", () => {
  const meta = (content: string) => ({
    getAttribute: (name: string) => name === "content" ? content : null,
  });
  const root = (values: readonly ReturnType<typeof meta>[]) =>
    ({
      querySelectorAll: () => values,
    }) as unknown as McpAppHostNonceMetaRoot;

  assertEquals(readMcpAppHostScriptNonce(root([meta(HOST_NONCE)])), HOST_NONCE);
  assertThrows(() => readMcpAppHostScriptNonce(root([])), TypeError);
  assertThrows(
    () => readMcpAppHostScriptNonce(root([meta(HOST_NONCE), meta(HOST_NONCE)])),
    TypeError,
  );
  assertThrows(
    () => readMcpAppHostScriptNonce(root([meta("not-a-nonce")])),
    TypeError,
  );
  assertEquals(MCP_APP_CHILD_CONTENT_SECURITY_POLICY.includes("nonce-"), false);
  assertEquals(
    MCP_APP_CHILD_CONTENT_SECURITY_POLICY.includes("sha256-"),
    false,
  );
});

class FakeObjectUrls implements McpAppObjectUrlFactory {
  readonly blobs: Blob[] = [];
  readonly revoked: string[] = [];

  constructor(private readonly onCreate?: () => void) {}

  create(blob: Blob): string {
    this.blobs.push(blob);
    const url = `blob:test/${this.blobs.length}`;
    this.onCreate?.();
    return url;
  }

  revoke(url: string): void {
    this.revoked.push(url);
  }
}

function exactResponse(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers: {
      "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE,
      "Content-Length": String(bytes.byteLength),
    },
  });
}

async function sessionFor(bytes: Uint8Array): Promise<ThreadViewerSession> {
  return {
    id: `mcp-app:${"d".repeat(64)}`,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: "recorded-result" },
    app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
    manifest: {
      uri: "ui://mcp-build123d/app-manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-build123d/results-viewer",
      fingerprint: await sha256Fingerprint(bytes),
      ownership: "whole-view",
      mimeType: MCP_APP_DOCUMENT_MIME_TYPE,
      bytes: bytes.byteLength,
    },
    launchUri: "/api/thread/viewer-apps/launch/manifest/html",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
      payload: {
        schemaVersion: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
      },
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}
