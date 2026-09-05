import {
  MCP_APP_HOST_MAX_RESOURCE_BYTES,
  type ThreadViewerReadResource,
} from "../../../presentation/workbench/thread/viewer-sessions.ts";

export const MCP_APP_HOST_RESOURCE_READ_SCHEMA =
  "io.casys.mcp-app-host.resource-read/1.0" as const;
export const MCP_APP_HOST_RESOURCE_READ_REQUEST =
  "mcp-app-host.resource.read" as const;
export const MCP_APP_HOST_RESOURCE_READ_RESULT =
  "mcp-app-host.resource.read.result" as const;
export const MCP_APP_HOST_RESOURCE_PORT_OFFER =
  "mcp-app-host.resource.port.offer" as const;

export interface McpAppHostResourcePortOffer {
  readonly schemaVersion: typeof MCP_APP_HOST_RESOURCE_READ_SCHEMA;
  readonly type: typeof MCP_APP_HOST_RESOURCE_PORT_OFFER;
}

export function isMcpAppHostResourcePortOffer(
  value: unknown,
): value is McpAppHostResourcePortOffer {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 2 && keys.every((key) => typeof key === "string") &&
    keys.includes("schemaVersion") && keys.includes("type") &&
    value.schemaVersion === MCP_APP_HOST_RESOURCE_READ_SCHEMA &&
    value.type === MCP_APP_HOST_RESOURCE_PORT_OFFER;
}

export interface McpAppHostResourceReadRequest {
  readonly schemaVersion: typeof MCP_APP_HOST_RESOURCE_READ_SCHEMA;
  readonly type: typeof MCP_APP_HOST_RESOURCE_READ_REQUEST;
  readonly requestId: string;
  /** Exact registered SHA-256; the App never supplies a URI or media type. */
  readonly fingerprint: string;
}

export interface McpAppHostAvailableResource {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly fingerprint: string;
  readonly encoding: "base64";
  /** RFC 4648 base64 without a data-URL prefix. */
  readonly data: string;
}

export type McpAppHostResourceReadResult =
  | {
    readonly schemaVersion: typeof MCP_APP_HOST_RESOURCE_READ_SCHEMA;
    readonly type: typeof MCP_APP_HOST_RESOURCE_READ_RESULT;
    readonly requestId: string;
    readonly fingerprint: string;
    readonly status: "available";
    readonly resource: McpAppHostAvailableResource;
  }
  | {
    readonly schemaVersion: typeof MCP_APP_HOST_RESOURCE_READ_SCHEMA;
    readonly type: typeof MCP_APP_HOST_RESOURCE_READ_RESULT;
    readonly requestId: string;
    readonly fingerprint: string;
    readonly status: "unavailable";
    readonly reason:
      | "not-registered"
      | "fetch-failed"
      | "identity-mismatch"
      | "too-large";
  };

export type McpAppHostResourceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Strict parser for the only message an opaque-origin App may send here. */
export function isMcpAppHostResourceReadRequest(
  value: unknown,
): value is McpAppHostResourceReadRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).toSorted();
  if (
    keys.length !== 4 || keys[0] !== "fingerprint" ||
    keys[1] !== "requestId" || keys[2] !== "schemaVersion" ||
    keys[3] !== "type"
  ) return false;
  return value.schemaVersion === MCP_APP_HOST_RESOURCE_READ_SCHEMA &&
    value.type === MCP_APP_HOST_RESOURCE_READ_REQUEST &&
    typeof value.requestId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.requestId) &&
    typeof value.fingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.fingerprint);
}

/**
 * Resolve and attest one explicitly registered same-origin resource.
 *
 * This is a GET-only Digital Thread CAS bridge. It never accepts a URL,
 * provider endpoint, credential, MCP tool name, argument object or byte limit
 * from the App. The response is released only after exact MIME, length and
 * SHA-256 verification.
 */
export async function readMcpAppHostResource(
  resources: readonly ThreadViewerReadResource[],
  request: McpAppHostResourceReadRequest,
  fetcher: McpAppHostResourceFetch = globalThis.fetch.bind(globalThis),
): Promise<McpAppHostResourceReadResult> {
  const base = {
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_RESULT,
    requestId: request.requestId,
    fingerprint: request.fingerprint,
  } as const;
  const resource = resources.find((candidate) =>
    candidate.fingerprint === request.fingerprint
  );
  if (!resource) {
    return { ...base, status: "unavailable", reason: "not-registered" };
  }
  if (resource.bytes > MCP_APP_HOST_MAX_RESOURCE_BYTES) {
    return { ...base, status: "unavailable", reason: "too-large" };
  }

  try {
    const response = await fetcher(resource.uri, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: { Accept: resource.mimeType },
    });
    if (!response.ok) {
      return { ...base, status: "unavailable", reason: "fetch-failed" };
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
        return { ...base, status: "unavailable", reason: "identity-mismatch" };
      }
      const declaredBytes = Number(declaredLength);
      if (declaredBytes > MCP_APP_HOST_MAX_RESOURCE_BYTES) {
        return { ...base, status: "unavailable", reason: "too-large" };
      }
      if (declaredBytes !== resource.bytes) {
        return { ...base, status: "unavailable", reason: "identity-mismatch" };
      }
    }
    const responseMime = response.headers.get("content-type")?.split(";", 1)[0]
      ?.trim().toLowerCase();
    if (responseMime !== resource.mimeType.toLowerCase()) {
      return { ...base, status: "unavailable", reason: "identity-mismatch" };
    }
    const body = await readBoundedBody(response, resource.bytes);
    if (body.status !== "available") return { ...base, ...body };
    const bytes = body.bytes;
    if (bytes.byteLength !== resource.bytes) {
      return { ...base, status: "unavailable", reason: "identity-mismatch" };
    }
    const fingerprint = await sha256Fingerprint(bytes);
    if (fingerprint !== resource.fingerprint) {
      return { ...base, status: "unavailable", reason: "identity-mismatch" };
    }
    return {
      ...base,
      status: "available",
      resource: {
        ...resource,
        encoding: "base64",
        data: bytesToBase64(bytes),
      },
    };
  } catch {
    return { ...base, status: "unavailable", reason: "fetch-failed" };
  }
}

async function readBoundedBody(
  response: Response,
  expectedBytes: number,
): Promise<
  | { readonly status: "available"; readonly bytes: Uint8Array }
  | {
    readonly status: "unavailable";
    readonly reason: "identity-mismatch" | "too-large";
  }
> {
  if (!response.body) {
    return expectedBytes === 0
      ? { status: "available", bytes: new Uint8Array() }
      : { status: "unavailable", reason: "identity-mismatch" };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (
        total > expectedBytes || total > MCP_APP_HOST_MAX_RESOURCE_BYTES
      ) {
        await reader.cancel();
        return {
          status: "unavailable",
          reason: total > MCP_APP_HOST_MAX_RESOURCE_BYTES
            ? "too-large"
            : "identity-mismatch",
        };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) {
    return { status: "unavailable", reason: "identity-mismatch" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "available", bytes };
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
