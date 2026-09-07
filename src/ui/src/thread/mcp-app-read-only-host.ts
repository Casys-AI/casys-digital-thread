import type { ThreadViewerSession } from "./viewer-sessions-client.ts";
import {
  isMcpAppHostResourcePortOffer,
  isMcpAppHostResourceReadRequest,
  type McpAppHostResourceFetch,
  readMcpAppHostResource,
} from "./mcp-app-resource-bridge.ts";

/** Protocol version implemented by the pinned MCP Apps clients in MCP Apps. */
export const MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION = "2026-01-26" as const;
export const MCP_APP_READ_ONLY_HOST_VERSION = "1.0.0" as const;

export interface McpAppHostPostTarget {
  postMessage(
    message: unknown,
    targetOrigin: string,
    transfer?: Transferable[],
  ): void;
}

export interface McpAppHostMessageEvent {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
  readonly ports?: readonly MessagePort[];
}

export interface McpAppHostPresentationContext {
  readonly theme?: "light" | "dark";
  readonly locale?: string;
}

export interface McpAppInlineHostContext extends McpAppHostPresentationContext {
  readonly displayMode: "inline";
  readonly availableDisplayModes: readonly ["inline"];
}

export interface McpAppReadOnlyHost {
  /** Accept one source-locked message. Returns false when it was ignored. */
  handleMessage(event: McpAppHostMessageEvent): boolean;
  /** Update only host-owned presentation, preserving this App document and session. */
  updateHostContext(context: McpAppHostPresentationContext): void;
  /** Permanently closes this document generation and drops pending reads. */
  invalidate(): void;
}

export type McpAppHostPresentationReadiness =
  | { readonly kind: "session-delivered" }
  | {
    readonly kind: "resource-read";
    readonly status: "available" | "unavailable";
    readonly reason?:
      | "not-registered"
      | "fetch-failed"
      | "identity-mismatch"
      | "too-large";
  };

export interface McpAppReadOnlyHostOptions {
  readonly target: McpAppHostPostTarget;
  readonly session: ThreadViewerSession;
  readonly hostContext: McpAppInlineHostContext;
  readonly fetcher?: McpAppHostResourceFetch;
  /**
   * Presentation-only. Fired after the exact opaque-origin App identity is
   * verified and the recorded session is delivered, then after each posted
   * resource-port read. Never inferred from iframe load or unknown messages.
   */
  readonly onPresentationReadiness?: (
    event: McpAppHostPresentationReadiness,
  ) => void;
}

const UNSUPPORTED_AUTHORITY_METHODS = new Set([
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "sampling/createMessage",
  "ui/message",
  "ui/open-link",
  "ui/update-model-context",
  "ui/compose/event",
]);

/**
 * Minimal MCP Apps lifecycle host for one exact, opaque-origin whole App.
 *
 * It is deliberately not an MCP client or provider proxy. The only data
 * delivery is the registered read projection, once, after the App confirms
 * that its initialize response was accepted. The fingerprint-only byte bridge
 * remains a separate non-JSON-RPC message contract.
 */
export function createMcpAppReadOnlyHost(
  options: McpAppReadOnlyHostOptions,
): McpAppReadOnlyHost {
  let active = true;
  let initializedResponseSent = false;
  let sessionDelivered = false;
  let pendingGeneration = 0;
  let resourcePort: MessagePort | undefined;
  let resourcePortOffersSealed = false;
  let hostContext: McpAppInlineHostContext = {
    ...presentationContext(options.hostContext),
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  };
  let sentPresentation: McpAppHostPresentationContext | undefined;

  const post = (message: unknown): void => {
    if (!active) return;
    // `allow-scripts` without `allow-same-origin` gives the child an opaque
    // origin, so a more specific outgoing target origin is impossible.
    options.target.postMessage(message, "*");
  };

  const sendHostContextChanges = (): void => {
    if (!active || !sessionDelivered || !sentPresentation) return;
    const changes = {
      ...(hostContext.theme !== sentPresentation.theme
        ? { theme: hostContext.theme }
        : {}),
      ...(hostContext.locale !== sentPresentation.locale
        ? { locale: hostContext.locale }
        : {}),
    };
    if (Object.keys(changes).length === 0) return;
    sentPresentation = presentationContext(hostContext);
    post({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: changes,
    });
  };

  const closeResourcePort = (): void => {
    const port = resourcePort;
    resourcePort = undefined;
    pendingGeneration += 1;
    if (!port) return;
    port.onmessage = null;
    port.close();
  };

  const bindResourcePort = (ports: readonly MessagePort[]): void => {
    if (resourcePortOffersSealed || resourcePort || ports.length !== 1) {
      for (const port of ports) port.close();
      return;
    }
    const port = ports[0];
    if (!port) return;
    resourcePort = port;
    const generation = pendingGeneration;
    port.onmessage = (event: MessageEvent<unknown>): void => {
      if (
        !active || !sessionDelivered || resourcePort !== port ||
        !isMcpAppHostResourceReadRequest(event.data)
      ) return;
      void readMcpAppHostResource(
        options.session.readResources,
        event.data,
        options.fetcher,
      ).then((result) => {
        if (
          !active || resourcePort !== port || generation !== pendingGeneration
        ) return;
        port.postMessage(result);
        options.onPresentationReadiness?.(
          result.status === "available"
            ? { kind: "resource-read", status: "available" }
            : {
              kind: "resource-read",
              status: "unavailable",
              reason: result.reason,
            },
        );
      });
    };
    port.start();
  };

  const handleMessage = (event: McpAppHostMessageEvent): boolean => {
    if (
      !active || event.source !== options.target || event.origin !== "null"
    ) return false;

    if (isMcpAppHostResourcePortOffer(event.data)) {
      bindResourcePort(event.ports ?? []);
      return true;
    }

    if (!isJsonRpcMessage(event.data)) return false;
    const message = event.data;

    if (message.method === "ui/initialize") {
      if (!hasRequestId(message)) return false;
      if (initializedResponseSent) {
        postJsonRpcError(
          post,
          message.id,
          -32600,
          "App document is already initialized.",
        );
        return true;
      }
      if (!matchesRegisteredApp(message.params, options.session)) {
        postJsonRpcError(
          post,
          message.id,
          -32602,
          "App identity does not match the registered whole-App descriptor.",
        );
        return true;
      }
      // The App posts its one-shot port offer before connect/initialize.
      // Messages from that child are delivered FIFO, so accepting the exact
      // initialize request closes the bootstrap window without racing the
      // browser's earlier iframe load event.
      resourcePortOffersSealed = true;
      post({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION,
          hostInfo: {
            name: "casys-digital-thread-read-only-app-host",
            version: MCP_APP_READ_ONLY_HOST_VERSION,
          },
          // Absence is authoritative: no serverTools, serverResources,
          // sampling, message or provider capability exists in this host.
          hostCapabilities: {},
          hostContext: { ...hostContext },
        },
      });
      sentPresentation = presentationContext(hostContext);
      initializedResponseSent = true;
      return true;
    }

    if (message.method === "ui/notifications/initialized") {
      if (!initializedResponseSent) return false;
      if (hasRequestId(message)) {
        post({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      if (!sessionDelivered) {
        sessionDelivered = true;
        // Presentation may have changed while the App accepted initialize.
        // Deliver that latest context before its one recorded session.
        sendHostContextChanges();
        post({
          jsonrpc: "2.0",
          method: "ui/compose/event",
          params: {
            action: options.session.session.action,
            data: structuredClone(options.session.session.payload),
          },
        });
        options.onPresentationReadiness?.({ kind: "session-delivered" });
      }
      return true;
    }

    if (message.method === "ui/request-display-mode") {
      if (!hasRequestId(message)) return false;
      post({
        jsonrpc: "2.0",
        id: message.id,
        result: { mode: "inline" },
      });
      return true;
    }

    if (message.method === "ui/notifications/size-changed") {
      if (hasRequestId(message)) {
        post({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      return true;
    }

    if (UNSUPPORTED_AUTHORITY_METHODS.has(message.method)) {
      if (hasRequestId(message)) {
        postJsonRpcError(
          post,
          message.id,
          -32601,
          `Read-only App host does not implement ${message.method}.`,
        );
      }
      return true;
    }

    if (hasRequestId(message)) {
      postJsonRpcError(
        post,
        message.id,
        -32601,
        `Read-only App host does not implement ${message.method}.`,
      );
      return true;
    }
    return false;
  };

  return {
    handleMessage,
    updateHostContext(context): void {
      if (!active) return;
      hostContext = { ...hostContext, ...presentationContext(context) };
      sendHostContextChanges();
    },
    invalidate(): void {
      if (!active) return;
      active = false;
      closeResourcePort();
    },
  };
}

/** Copy an explicit presentation allowlist; never forward capability or session fields. */
function presentationContext(
  value: McpAppHostPresentationContext,
): McpAppHostPresentationContext {
  return {
    ...(value.theme === "light" || value.theme === "dark"
      ? { theme: value.theme }
      : {}),
    ...(typeof value.locale === "string" && value.locale.trim().length > 0
      ? { locale: value.locale.trim() }
      : {}),
  };
}

function matchesRegisteredApp(
  params: unknown,
  session: ThreadViewerSession,
): boolean {
  if (!isRecord(params) || !isRecord(params.appInfo)) return false;
  return params.appInfo.name === session.app.id &&
    params.appInfo.version === session.app.version &&
    params.protocolVersion === MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION &&
    isRecord(params.appCapabilities);
}

interface JsonRpcMessage extends Record<string, unknown> {
  readonly jsonrpc: "2.0";
  readonly method: string;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return isRecord(value) && value.jsonrpc === "2.0" &&
    typeof value.method === "string" && value.method.length > 0;
}

function hasRequestId(
  message: JsonRpcMessage,
): message is JsonRpcMessage & { readonly id: string | number } {
  return Object.prototype.hasOwnProperty.call(message, "id") &&
    (typeof message.id === "string" ||
      (typeof message.id === "number" && Number.isFinite(message.id)));
}

function postJsonRpcError(
  post: (message: unknown) => void,
  id: string | number,
  code: number,
  message: string,
): void {
  post({ jsonrpc: "2.0", id, error: { code, message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
