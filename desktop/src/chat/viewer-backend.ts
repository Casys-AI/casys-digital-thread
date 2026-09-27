/**
 * Owning-session MCP backend for live chat viewer Apps (#50).
 *
 * The coordinator authorizes every interaction against the conversation's
 * attached MCP session (attached server id + probed tool list); this backend
 * only executes conformant loopback JSON-RPC against the fixed registry
 * upstream of that server. It never invents endpoints, credentials, tool
 * names, or view URIs: unknown servers are refused, App documents must
 * exactly match the fleet manifest `expectedViews`, and other resources
 * must stay inside the shared view namespace.
 */
import { MCP_PROTOCOL_VERSION } from "../control-plane/contracts.ts";
import { CHAT_HOST_COMPONENT_VERSION } from "../../../src/presentation/desktop/chat/contracts.ts";
import type { ChatMcpServerConfig } from "./runtime-port.ts";

export interface ChatViewerAppBytes {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly fingerprint: string;
}

/**
 * Resource scope admitted for one server: the `ui://<authority>/` head
 * shared by every expected view. Undefined when the server declares no
 * view or spans authorities: App documents still open by exact match,
 * but no other resource read is authorized.
 */
export function viewerResourceScope(
  expectedViews: readonly string[],
): string | undefined {
  if (expectedViews.length === 0) return undefined;
  const heads = expectedViews.map((view) => {
    const rest = view.slice("ui://".length);
    return `ui://${rest.slice(0, rest.indexOf("/") + 1)}`;
  });
  const [first] = heads;
  if (first === undefined || !heads.every((head) => head === first)) {
    return undefined;
  }
  return first;
}

/** Chunked base64 for whole App documents; avoids spread stack overflows. */
export function encodeViewerBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export interface ChatViewerBackend {
  resolveApp(server: string, uri: string): Promise<ChatViewerAppBytes>;
  callTool(server: string, name: string, args: unknown): Promise<unknown>;
  readResource(server: string, uri: string): Promise<unknown>;
}

export interface RegistryViewerBackendOptions {
  readonly servers: readonly ChatMcpServerConfig[];
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const APP_MAX_BYTES = 8_388_608;
const RESULT_MAX_BYTES = 1_048_576;

export function createRefusingViewerBackend(reason: string): ChatViewerBackend {
  const refuse = (): Promise<never> => Promise.reject(new Error(reason));
  return { resolveApp: refuse, callTool: refuse, readResource: refuse };
}

export function createRegistryViewerBackend(
  options: RegistryViewerBackendOptions,
): ChatViewerBackend {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  const fetchImpl = options.fetch ?? fetch;
  const upstreams = new Map<string, string>();
  const views = new Map<string, readonly string[]>();
  for (const server of options.servers) {
    upstreams.set(server.id, server.mcpUrl);
    views.set(server.id, server.expectedViews);
  }
  function scopedViews(server: string): readonly string[] {
    const admitted = views.get(server);
    if (admitted === undefined) throw new Error(`Unknown MCP server "${server}".`);
    return admitted;
  }

  async function rpc(
    server: string,
    method: "resources/read" | "tools/call",
    params: Record<string, unknown>,
    nameHeader: string,
    maxBytes: number,
  ): Promise<Record<string, unknown>> {
    const upstream = upstreams.get(server);
    if (upstream === undefined) throw new Error(`Unknown MCP server "${server}".`);
    const url = new URL(upstream);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    ) {
      throw new Error("MCP upstream must be loopback HTTP(S).");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(upstream, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          "mcp-method": method,
          "Mcp-Name": nameHeader,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "casys-desktop-chat-viewer",
                version: CHAT_HOST_COMPONENT_VERSION,
              },
            },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`MCP ${method} returned HTTP ${response.status}.`);
      }
      const text = await response.text();
      if (text.length > maxBytes) {
        throw new Error(`MCP ${method} response is too large.`);
      }
      const envelope = JSON.parse(text) as Record<string, unknown>;
      if (
        envelope.jsonrpc !== "2.0" || envelope.id !== 1 || envelope.error !== undefined
      ) {
        throw new Error(`MCP ${method} returned an invalid response.`);
      }
      return envelope.result as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async resolveApp(server: string, uri: string): Promise<ChatViewerAppBytes> {
      if (!scopedViews(server).includes(uri)) {
        throw new Error("App URI is not an expected view of the owning MCP server.");
      }
      const result = await rpc(
        server,
        "resources/read",
        { uri },
        uri,
        APP_MAX_BYTES + 1024,
      );
      const contents = (result as { contents?: unknown }).contents;
      if (!Array.isArray(contents) || contents.length !== 1) {
        throw new Error("App resource returned an unexpected payload.");
      }
      const entry = contents[0] as Record<string, unknown>;
      if (entry.uri !== uri || typeof entry.text !== "string") {
        throw new Error("App resource returned an unexpected payload.");
      }
      const mimeType = entry.mimeType;
      if (mimeType !== "text/html;profile=mcp-app") {
        throw new Error("App resource is not a whole MCP App document.");
      }
      const bytes = new TextEncoder().encode(entry.text);
      if (bytes.byteLength === 0 || bytes.byteLength > APP_MAX_BYTES) {
        throw new Error("App resource size is invalid.");
      }
      const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
      const fingerprint = `sha256:${
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      }`;
      return { uri, mimeType, bytes, fingerprint };
    },

    async callTool(server: string, name: string, args: unknown): Promise<unknown> {
      const result = await rpc(
        server,
        "tools/call",
        { name, arguments: args ?? {} },
        name,
        RESULT_MAX_BYTES + 1024,
      );
      return result;
    },

    async readResource(server: string, uri: string): Promise<unknown> {
      const admitted = scopedViews(server);
      const scope = viewerResourceScope(admitted);
      const inViewScope = admitted.includes(uri) ||
        (scope !== undefined && uri.startsWith(scope));
      // Provider-issued artifacts addressed to the owning server
      // (observed: `casys://build123d/artifacts/<sha>.<ext>`). Scope here
      // is the owning server; digest attestation of artifact bytes happens
      // on the renderer port-bridge path against the exact result record.
      const inArtifactScope = uri.startsWith(`casys://${server}/`);
      if (!inViewScope && !inArtifactScope) {
        throw new Error("Resource URI is outside the owning MCP server.");
      }
      return await rpc(server, "resources/read", { uri }, uri, RESULT_MAX_BYTES + 1024);
    },
  };
}
