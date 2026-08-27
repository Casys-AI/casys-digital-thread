const MCP_PROTOCOL_VERSION = "2026-07-28";

const CLIENT_META = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "casys-digital-thread-orchestrator",
    version: "0.1.0",
  },
};

export interface StatelessMcpHttpTransportOptions {
  mcpUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface StatelessMcpRequest {
  method: string;
  params: Readonly<Record<string, unknown>>;
  label: string;
  /** Optional routing identity mirrored into the Mcp-Name header. */
  name?: string;
}

export class StatelessMcpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatelessMcpTransportError";
  }
}

/**
 * Internal backend transport shared by typed MCP adapters.
 *
 * It owns only the stateless HTTP/JSON-RPC envelope. Domain ports never see
 * MCP method names, endpoints, sessions, discovery, or provider credentials.
 */
export class StatelessMcpHttpTransport {
  readonly #mcpUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #nextRequestId = 1;

  constructor(options: StatelessMcpHttpTransportOptions) {
    if (options.mcpUrl.trim() === "") {
      throw new TypeError("mcpUrl must be a non-empty URL");
    }
    let url: URL;
    try {
      url = new URL(options.mcpUrl);
    } catch {
      throw new TypeError("mcpUrl must be an absolute HTTP(S) URL");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      options.mcpUrl !== options.mcpUrl.trim()
    ) {
      throw new TypeError("mcpUrl must be an absolute HTTP(S) URL");
    }
    this.#mcpUrl = url.href;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new TypeError("timeoutMs must be a positive integer");
    }
  }

  async request(request: StatelessMcpRequest): Promise<Record<string, unknown>> {
    if (request.method.trim() === "" || request.label.trim() === "") {
      throw new TypeError("MCP method and label must be non-empty strings");
    }
    if (Object.hasOwn(request.params, "_meta")) {
      throw new TypeError("MCP request params must not override _meta");
    }
    const requestId = this.#nextRequestId++;
    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: request.method,
      params: { ...request.params, _meta: CLIENT_META },
    };
    const headers: Record<string, string> = {
      "accept": "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "mcp-method": request.method,
    };
    if (request.name !== undefined) headers["mcp-name"] = request.name;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(this.#mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new StatelessMcpTransportError(
          `${request.label}: MCP request timed out after ${this.#timeoutMs}ms`,
        );
      }
      throw new StatelessMcpTransportError(
        `${request.label}: MCP request failed: ${errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.redirected) {
      throw new StatelessMcpTransportError(
        `${request.label}: MCP endpoint redirected the request`,
      );
    }
    if (!response.ok) {
      throw new StatelessMcpTransportError(
        `${request.label}: MCP endpoint returned HTTP ${response.status}`,
      );
    }
    const payload = await parseEnvelope(response, request.label);
    if (payload.jsonrpc !== "2.0" || payload.id !== requestId) {
      throw new StatelessMcpTransportError(
        `${request.label}: invalid JSON-RPC response identity`,
      );
    }
    const hasResult = Object.hasOwn(payload, "result");
    const hasError = Object.hasOwn(payload, "error");
    if (hasResult === hasError) {
      throw new StatelessMcpTransportError(
        `${request.label}: expected exactly one JSON-RPC result or error`,
      );
    }
    if (hasError) {
      const error = payload.error;
      const message = isRecord(error) && typeof error.message === "string"
        ? error.message
        : "JSON-RPC error";
      throw new StatelessMcpTransportError(`${request.label}: ${message}`);
    }
    if (!isRecord(payload.result)) {
      throw new StatelessMcpTransportError(`${request.label}: missing result`);
    }
    return payload.result;
  }
}

async function parseEnvelope(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  const text = (await response.text()).trim();
  if (text === "") {
    throw new StatelessMcpTransportError(
      `${label}: MCP endpoint returned an empty body`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new StatelessMcpTransportError(
      `${label}: MCP endpoint returned invalid JSON`,
    );
  }
  if (!isRecord(value)) {
    throw new StatelessMcpTransportError(
      `${label}: MCP endpoint returned a non-object JSON-RPC envelope`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
