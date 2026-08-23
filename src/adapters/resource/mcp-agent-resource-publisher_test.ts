import { assertEquals } from "@std/assert";
import { McpApp } from "@casys/mcp-server";
import { parseAgentResourceEnvelope } from "../../domain/resource/agent-resource-envelope.ts";
import { encodeCanonicalBase64 } from "../../domain/resource/agent-resource-envelope.ts";
import { FileAgentResourceStore } from "./file-agent-resource-store.ts";
import { McpAgentResourcePublisher } from "./mcp-agent-resource-publisher.ts";
import { PrepareProjectResourceCapture } from "../../application/use-cases/resource/prepare-project-resource-capture.ts";
import { ClosedResourceInterpretationRegistry } from "../../application/use-cases/resource/closed-resource-interpretation-registry.ts";

Deno.test("captured text and blob resources survive resources/read after restart discovery", async () => {
  const root = await Deno.makeTempDir({ prefix: "agent-resource-mcp-" });
  try {
    const store = new FileAgentResourceStore(root);
    const capture = new PrepareProjectResourceCapture({
      store,
      interpretation: new ClosedResourceInterpretationRegistry([]),
    });
    const textReview = await capture.capture({
      name: "notes.txt",
      mimeType: "text/plain",
      text: "hello-resource",
    });
    const blobBytes = Uint8Array.from([9, 8, 7]);
    const blobReview = await capture.capture({
      name: "blob.bin",
      mimeType: "application/octet-stream",
      blob: encodeCanonicalBase64(blobBytes),
    });

    const restarted = new McpApp({
      name: "resource-ingress-test",
      version: "0.0.1",
      transport: "stateless",
      expectResources: true,
      logger: () => {},
    });
    const publisher = new McpAgentResourcePublisher(restarted, store);
    await publisher.restore();
    assertEquals(restarted.hasResource(textReview.reference.uri), true);
    assertEquals(restarted.hasResource(blobReview.reference.uri), true);

    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await restarted.startHttp({
      port,
      hostname: "127.0.0.1",
      onListen: () => {},
    });
    try {
      const text = await resourcesRead(
        port,
        textReview.reference.uri,
      ) as { contents: Array<{ text?: string; blob?: string; mimeType: string }> };
      assertEquals(text.contents[0]?.text, "hello-resource");
      assertEquals(text.contents[0]?.mimeType, "text/plain");
      const blob = await resourcesRead(
        port,
        blobReview.reference.uri,
      ) as { contents: Array<{ blob?: string; mimeType: string }> };
      assertEquals(blob.contents[0]?.blob, encodeCanonicalBase64(blobBytes));
      assertEquals(blob.contents[0]?.mimeType, "application/octet-stream");
    } finally {
      await http.shutdown();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("envelope parse is available for captured bytes used as MCP resources", () => {
  const envelope = parseAgentResourceEnvelope({
    name: "ok.txt",
    mimeType: "text/plain",
    text: "ok",
  });
  assertEquals(envelope.representation, "text");
});

async function resourcesRead(
  port: number,
  uri: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "resources/read",
      "mcp-name": uri,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: {
        uri,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }),
  });
  const body = await response.json() as {
    result?: Record<string, unknown>;
    error?: unknown;
  };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result ?? {};
}
