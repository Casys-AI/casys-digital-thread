const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * Opaque, backend-only bearer credential.  The token is kept in a module
 * private WeakMap rather than on the public value, so an options object cannot
 * accidentally serialize it into a Thread, WAL payload, log, or URL.
 */
const bearerCredentialValues = new WeakMap<object, string>();

declare const internalMcpBearerCredentialBrand: unique symbol;

export interface InternalMcpBearerCredential {
  readonly [internalMcpBearerCredentialBrand]: true;
}

/**
 * Makes an opaque credential for a server-owned local secret slot.
 *
 * This deliberately accepts no header name and gives callers no general
 * header-injection surface.  Bearer credentials are opaque HTTP tokens and
 * therefore must be non-empty printable non-whitespace ASCII.
 */
export function createInternalMcpBearerCredential(
  value: string,
): InternalMcpBearerCredential {
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new TypeError(
      "MCP bearer credential must be a non-empty printable token without whitespace",
    );
  }
  const credential = Object.freeze({}) as InternalMcpBearerCredential;
  bearerCredentialValues.set(credential, value);
  return credential;
}

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
  /**
   * Optional opaque server-owned credential.  It is sent only as HTTP
   * Authorization at the fetch boundary; it is never made part of JSON-RPC.
   */
  bearerCredential?: InternalMcpBearerCredential;
}

export interface StatelessMcpRequest {
  method: string;
  params: Readonly<Record<string, unknown>>;
  label: string;
  /** Optional routing identity mirrored into the Mcp-Name header. */
  name?: string;
}

/**
 * `transport` and `protocol-invalid` mean no valid provider acknowledgement
 * was observed, so a side-effecting caller must treat dispatch as uncertain.
 * A client-error HTTP status is a definite pre-dispatch rejection by the
 * endpoint/proxy; `rpc-rejection` is a valid JSON-RPC rejection.
 */
export type StatelessMcpTransportErrorKind =
  | "transport"
  | "protocol-invalid"
  | "http-rejection"
  | "rpc-rejection";

export class StatelessMcpTransportError extends Error {
  readonly kind: StatelessMcpTransportErrorKind;
  readonly httpStatus: number | undefined;

  constructor(
    message: string,
    options: {
      readonly kind?: StatelessMcpTransportErrorKind;
      readonly httpStatus?: number;
    } = {},
  ) {
    super(message);
    this.name = "StatelessMcpTransportError";
    this.kind = options.kind ?? "protocol-invalid";
    this.httpStatus = options.httpStatus;
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
  readonly #bearerToken: string | undefined;
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
      url.search !== "" ||
      url.hash !== "" ||
      options.mcpUrl !== options.mcpUrl.trim()
    ) {
      throw new TypeError("mcpUrl must be an absolute HTTP(S) URL");
    }
    this.#mcpUrl = url.href;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#bearerToken = options.bearerCredential === undefined
      ? undefined
      : bearerCredentialValue(options.bearerCredential);
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
    if (this.#bearerToken !== undefined) {
      headers.authorization = `Bearer ${this.#bearerToken}`;
    }

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
          { kind: "transport" },
        );
      }
      throw new StatelessMcpTransportError(
        `${request.label}: MCP request failed: ${this.#redact(errorMessage(error))}`,
        { kind: "transport" },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.redirected) {
      throw new StatelessMcpTransportError(
        `${request.label}: MCP endpoint redirected the request`,
        { kind: "transport" },
      );
    }
    if (!response.ok) {
      throw new StatelessMcpTransportError(
        `${request.label}: MCP endpoint returned HTTP ${response.status}`,
        {
          kind: response.status >= 400 && response.status < 500
            ? "http-rejection"
            : "transport",
          httpStatus: response.status,
        },
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = await parseEnvelope(response, request.label);
    } catch (error) {
      if (error instanceof StatelessMcpTransportError) {
        throw new StatelessMcpTransportError(this.#redact(error.message), {
          kind: error.kind,
          ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
        });
      }
      throw error;
    }
    if (payload.jsonrpc !== "2.0" || payload.id !== requestId) {
      throw new StatelessMcpTransportError(
        `${request.label}: invalid JSON-RPC response identity`,
        { kind: "protocol-invalid" },
      );
    }
    const hasResult = Object.hasOwn(payload, "result");
    const hasError = Object.hasOwn(payload, "error");
    if (hasResult === hasError) {
      throw new StatelessMcpTransportError(
        `${request.label}: expected exactly one JSON-RPC result or error`,
        { kind: "protocol-invalid" },
      );
    }
    if (hasError) {
      if (!isJsonRpcError(payload.error)) {
        throw new StatelessMcpTransportError(
          `${request.label}: invalid JSON-RPC error response`,
          { kind: "protocol-invalid" },
        );
      }
      throw new StatelessMcpTransportError(
        `${request.label}: JSON-RPC request was rejected`,
        { kind: "rpc-rejection" },
      );
    }
    if (!isRecord(payload.result)) {
      throw new StatelessMcpTransportError(`${request.label}: missing result`, {
        kind: "protocol-invalid",
      });
    }
    return payload.result;
  }

  #redact(value: string): string {
    return this.#bearerToken === undefined
      ? value
      : value.replaceAll(this.#bearerToken, "[redacted]");
  }
}

function bearerCredentialValue(credential: InternalMcpBearerCredential): string {
  const value = bearerCredentialValues.get(credential);
  if (value === undefined) {
    throw new TypeError(
      "MCP bearer credential must be created by createInternalMcpBearerCredential",
    );
  }
  return value;
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

function isJsonRpcError(value: unknown): boolean {
  return isRecord(value) &&
    Number.isSafeInteger(value.code) &&
    typeof value.message === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
