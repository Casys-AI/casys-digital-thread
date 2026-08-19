import {
  createProviderResourceRead,
  type ExpectedProviderResource,
  type ProviderResourceRead,
  type ProviderResourceReader,
  validateExpectedProviderResource,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  StatelessMcpHttpTransport,
  type StatelessMcpHttpTransportOptions,
  StatelessMcpTransportError,
} from "./stateless-mcp-http-transport.ts";

export type HttpMcpResourceReaderOptions = StatelessMcpHttpTransportOptions;

export class McpResourceReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpResourceReadError";
  }
}

/**
 * Stateless MCP 2026-07-28 adapter for the provider-neutral resource port.
 *
 * The only protocol operation reachable through this adapter is
 * resources/read for the exact ledger URI. It never discovers or lists
 * resources, and a successful byte match is not an authority decision.
 */
export class HttpMcpResourceReader implements ProviderResourceReader {
  readonly #http: StatelessMcpHttpTransport;

  constructor(options: HttpMcpResourceReaderOptions) {
    this.#http = new StatelessMcpHttpTransport(options);
  }

  async read(
    expectedValue: ExpectedProviderResource,
  ): Promise<ProviderResourceRead> {
    const expected = validateExpectedProviderResource(expectedValue);
    let result: Record<string, unknown>;
    try {
      result = await this.#http.request({
        method: "resources/read",
        label: "resources/read",
        name: expected.uri,
        params: { uri: expected.uri },
      });
    } catch (error) {
      if (error instanceof StatelessMcpTransportError) {
        throw new McpResourceReadError(error.message);
      }
      throw error;
    }

    const contentsValue = exactResultContents(result);
    if (contentsValue.length !== 1) {
      throw new McpResourceReadError(
        `resources/read: expected exactly one ResourceContents; received ${contentsValue.length}`,
      );
    }
    const content = resourceContent(contentsValue[0]);
    if (content.uri !== expected.uri) {
      throw new McpResourceReadError(
        `resources/read: URI mismatch; expected ${expected.uri}, received ${content.uri}`,
      );
    }
    if (content.mimeType !== expected.mediaType) {
      throw new McpResourceReadError(
        `resources/read: mimeType mismatch; expected ${expected.mediaType}, received ${content.mimeType}`,
      );
    }

    const bytes = content.text !== undefined
      ? new TextEncoder().encode(content.text)
      : decodeCanonicalBase64(content.blob as string);
    try {
      return await createProviderResourceRead(expected, bytes);
    } catch (error) {
      throw new McpResourceReadError(
        `resources/read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface ValidResourceContent {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

function exactResultContents(result: Record<string, unknown>): unknown[] {
  const keys = Object.keys(result);
  if (
    !Object.hasOwn(result, "contents") ||
    keys.some((key) =>
      key !== "contents" &&
      key !== "resultType" &&
      key !== "ttlMs" &&
      key !== "cacheScope" &&
      key !== "_meta"
    )
  ) {
    throw new McpResourceReadError(
      "resources/read: malformed result object",
    );
  }
  if (result.resultType !== "complete") {
    throw new McpResourceReadError(
      'resources/read: resultType must be "complete"',
    );
  }
  if (
    typeof result.ttlMs !== "number" ||
    !Number.isSafeInteger(result.ttlMs) ||
    result.ttlMs < 0
  ) {
    throw new McpResourceReadError(
      "resources/read: ttlMs must be a non-negative safe integer",
    );
  }
  if (result.cacheScope !== "private" && result.cacheScope !== "public") {
    throw new McpResourceReadError(
      'resources/read: cacheScope must be "private" or "public"',
    );
  }
  if (!Array.isArray(result.contents)) {
    throw new McpResourceReadError(
      "resources/read: contents must be an array",
    );
  }
  if (Object.hasOwn(result, "_meta") && !isRecord(result._meta)) {
    throw new McpResourceReadError(
      "resources/read: result _meta must be an object",
    );
  }
  return result.contents;
}

function resourceContent(value: unknown): ValidResourceContent {
  if (!isRecord(value)) {
    throw new McpResourceReadError(
      "resources/read: ResourceContents must be an object",
    );
  }
  const allowed = new Set(["uri", "mimeType", "text", "blob", "_meta"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new McpResourceReadError(
      "resources/read: ResourceContents has unsupported fields",
    );
  }
  if (Object.hasOwn(value, "_meta") && !isRecord(value._meta)) {
    throw new McpResourceReadError(
      "resources/read: ResourceContents _meta must be an object",
    );
  }
  if (typeof value.uri !== "string" || typeof value.mimeType !== "string") {
    throw new McpResourceReadError(
      "resources/read: ResourceContents requires uri and mimeType",
    );
  }
  const hasText = Object.hasOwn(value, "text");
  const hasBlob = Object.hasOwn(value, "blob");
  if (hasText === hasBlob) {
    throw new McpResourceReadError(
      "resources/read: ResourceContents requires exactly one of text or blob",
    );
  }
  if (hasText && typeof value.text !== "string") {
    throw new McpResourceReadError(
      "resources/read: ResourceContents.text must be a string",
    );
  }
  if (hasBlob && typeof value.blob !== "string") {
    throw new McpResourceReadError(
      "resources/read: ResourceContents.blob must be a string",
    );
  }
  return {
    uri: value.uri,
    mimeType: value.mimeType,
    ...(hasText ? { text: value.text as string } : {}),
    ...(hasBlob ? { blob: value.blob as string } : {}),
  };
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new McpResourceReadError(
      "resources/read: blob must be canonical base64",
    );
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new McpResourceReadError(
      "resources/read: blob must be canonical base64",
    );
  }
  if (btoa(binary) !== value) {
    throw new McpResourceReadError(
      "resources/read: blob must be canonical base64",
    );
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
