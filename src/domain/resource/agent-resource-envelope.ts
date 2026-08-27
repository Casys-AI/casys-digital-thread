/**
 * Agent-authored MCP resource envelope for draft CAS ingress.
 *
 * The caller names a display name, a MIME type, and exactly one payload:
 * UTF-8 `text` or canonical padded standard-base64 `blob`. Paths, fingerprints,
 * CAS URIs, project commands and MRTR stay out of this contract.
 */

import { closedRecord, nonEmptyText } from "../kernel/case-validation.ts";
import { fingerprintResourceBytes } from "../kernel/resource-bytes.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const AGENT_RESOURCE_MAX_BYTES = 262_144;
export const AGENT_RESOURCE_CAPTURE_SCHEMA = "agent-resource-capture/1.0" as const;
export const AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA =
  "agent-resource-capture-review/1.0" as const;

const NAME_MAX = 256;
const MIME_MAX = 256;
const MIME_TYPE =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type AgentResourceRepresentation = "text" | "blob";

export interface AgentResourceEnvelope {
  readonly name: string;
  readonly mimeType: string;
  readonly representation: AgentResourceRepresentation;
  readonly bytes: Uint8Array;
}

export type AgentResourceEnvelopeErrorCode =
  | "invalid_request"
  | "payload_xor"
  | "invalid_base64"
  | "source_size_limit_exceeded";

export class AgentResourceEnvelopeError extends Error {
  constructor(
    readonly code: AgentResourceEnvelopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentResourceEnvelopeError";
  }
}

/** Parse the mutating-tool envelope into exact bytes. */
export function parseAgentResourceEnvelope(value: unknown): AgentResourceEnvelope {
  const root = closedRecord(
    value,
    ["name", "mimeType", "text", "blob"],
    ["name", "mimeType"],
    "$agentResource",
  );
  const name = parseName(root.name);
  const mimeType = parseMimeType(root.mimeType);
  const hasText = Object.hasOwn(root, "text");
  const hasBlob = Object.hasOwn(root, "blob");
  if (hasText === hasBlob) {
    throw new AgentResourceEnvelopeError(
      "payload_xor",
      "$agentResource must contain exactly one of text or blob.",
    );
  }
  if (hasText) {
    if (typeof root.text !== "string" || root.text.length === 0) {
      throw new AgentResourceEnvelopeError(
        "invalid_request",
        "$agentResource.text must be a non-empty UTF-8 string.",
      );
    }
    return boundEnvelope({
      name,
      mimeType,
      representation: "text",
      bytes: new TextEncoder().encode(root.text),
    });
  }
  if (typeof root.blob !== "string") {
    throw new AgentResourceEnvelopeError(
      "invalid_base64",
      "$agentResource.blob must be canonical padded standard base64.",
    );
  }
  return boundEnvelope({
    name,
    mimeType,
    representation: "blob",
    bytes: decodeCanonicalBase64(root.blob),
  });
}

export function encodeCanonicalBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeUtf8ResourceText(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new AgentResourceEnvelopeError(
      "invalid_request",
      `${path} is not valid UTF-8.`,
    );
  }
}

export async function fingerprintAgentResourceBytes(
  bytes: Uint8Array,
): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  };
}

function boundEnvelope(envelope: AgentResourceEnvelope): AgentResourceEnvelope {
  if (envelope.bytes.byteLength === 0) {
    throw new AgentResourceEnvelopeError(
      "invalid_request",
      "$agentResource payload must decode to at least one byte.",
    );
  }
  if (envelope.bytes.byteLength > AGENT_RESOURCE_MAX_BYTES) {
    throw new AgentResourceEnvelopeError(
      "source_size_limit_exceeded",
      `$agentResource payload is ${envelope.bytes.byteLength} bytes; at most ${AGENT_RESOURCE_MAX_BYTES} are permitted.`,
    );
  }
  return envelope;
}

export function parseAgentResourceName(value: unknown, path: string): string {
  const name = nonEmptyText(value, path);
  if (name.length > NAME_MAX) {
    throw new TypeError(`${path} is longer than 256 characters.`);
  }
  if (
    name.includes("/") || name.includes("\\") || name.includes("\0") ||
    name.includes("..")
  ) {
    throw new TypeError(`${path} must not contain a path.`);
  }
  return name;
}

export function parseAgentResourceMimeType(value: unknown, path: string): string {
  const mimeType = nonEmptyText(value, path);
  if (mimeType.length > MIME_MAX) {
    throw new TypeError(`${path} is longer than 256 characters.`);
  }
  if (!MIME_TYPE.test(mimeType)) {
    throw new TypeError(`${path} must be a nonempty type/subtype token.`);
  }
  return mimeType;
}

function parseName(value: unknown): string {
  try {
    return parseAgentResourceName(value, "$agentResource.name");
  } catch (error) {
    throw new AgentResourceEnvelopeError(
      "invalid_request",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseMimeType(value: unknown): string {
  try {
    return parseAgentResourceMimeType(value, "$agentResource.mimeType");
  } catch (error) {
    throw new AgentResourceEnvelopeError(
      "invalid_request",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function decodeCanonicalBase64(blob: string): Uint8Array {
  if (
    blob.length === 0 || blob.length % 4 !== 0 || !CANONICAL_BASE64.test(blob)
  ) {
    throw new AgentResourceEnvelopeError(
      "invalid_base64",
      "$agentResource.blob must be canonical padded standard base64.",
    );
  }
  let decoded: string;
  try {
    decoded = atob(blob);
  } catch {
    throw new AgentResourceEnvelopeError(
      "invalid_base64",
      "$agentResource.blob must be canonical padded standard base64.",
    );
  }
  if (btoa(decoded) !== blob) {
    throw new AgentResourceEnvelopeError(
      "invalid_base64",
      "$agentResource.blob must be canonical padded standard base64.",
    );
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}
