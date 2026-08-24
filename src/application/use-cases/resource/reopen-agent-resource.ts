/**
 * Reopen one captured agent resource by exact closed reference.
 *
 * Verifies persisted URI, SHA-256, byteCount, MIME, representation and
 * display name, copies bytes, then optionally requires fatal UTF-8. Domain
 * parsers receive the copied text; they never read the filesystem or
 * resources/read. MIME allowlists are guards, not parser selection.
 */

import type { AgentResourceStore } from "../../ports/out/resource/agent-resource-store.ts";
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import {
  decodeUtf8ResourceText,
  fingerprintAgentResourceBytes,
} from "../../../domain/resource/agent-resource-envelope.ts";
import { agentResourceReferencesEqual } from "../../../domain/resource/agent-resource-reference.ts";

export type AgentResourceReopenErrorCode =
  | "invalid_request"
  | "resource_missing"
  | "resource_mismatch"
  | "invalid_utf8"
  | "source_exactness_failed"
  | "disallowed_mime"
  | "source_size_limit_exceeded";

export class AgentResourceReopenError extends Error {
  constructor(
    readonly code: AgentResourceReopenErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentResourceReopenError";
  }
}

export interface ReopenAgentResourceUtf8Options {
  readonly acceptedMimeTypes: readonly string[];
  readonly maxBytes: number;
}

export interface ReopenedAgentResourceText {
  readonly reference: AgentResourceReference;
  readonly bytes: Uint8Array;
  readonly text: string;
}

export interface ReopenedAgentResourceBytes {
  readonly reference: AgentResourceReference;
  readonly bytes: Uint8Array;
}

export class ReopenAgentResource {
  readonly #store: AgentResourceStore;

  constructor(store: AgentResourceStore) {
    this.#store = store;
  }

  async reopenExact(
    expected: AgentResourceReference,
  ): Promise<ReopenedAgentResourceBytes> {
    const stored = await this.#store.read(expected.uri);
    if (!stored) {
      throw new AgentResourceReopenError(
        "resource_missing",
        "The named agent resource is not present in draft CAS.",
      );
    }
    const copy = Uint8Array.from(stored.bytes);
    if (!agentResourceReferencesEqual(expected, stored.reference)) {
      throw new AgentResourceReopenError(
        "resource_mismatch",
        "The agent resource reference does not match persisted URI, sha256, byteCount, MIME, representation, or name.",
      );
    }
    if (copy.byteLength !== expected.byteCount) {
      throw new AgentResourceReopenError(
        "resource_mismatch",
        "The agent resource reference does not match persisted URI, sha256, byteCount, MIME, representation, or name.",
      );
    }
    const actual = await fingerprintAgentResourceBytes(copy);
    if (actual.digest !== expected.fingerprint.digest) {
      throw new AgentResourceReopenError(
        "resource_mismatch",
        "The agent resource reference does not match persisted URI, sha256, byteCount, MIME, representation, or name.",
      );
    }
    return { reference: stored.reference, bytes: copy };
  }

  async reopenUtf8Text(
    expected: AgentResourceReference,
    options: ReopenAgentResourceUtf8Options,
  ): Promise<ReopenedAgentResourceText> {
    const reopened = await this.reopenExact(expected);
    const copy = reopened.bytes;
    if (!options.acceptedMimeTypes.includes(expected.mimeType)) {
      throw new AgentResourceReopenError(
        "disallowed_mime",
        `Agent resource MIME ${expected.mimeType} is not accepted for this domain.`,
      );
    }
    if (copy.byteLength > options.maxBytes) {
      throw new AgentResourceReopenError(
        "source_size_limit_exceeded",
        `Agent resource is ${copy.byteLength} bytes; this domain permits at most ${options.maxBytes}.`,
      );
    }
    let text: string;
    try {
      text = decodeUtf8ResourceText(copy, "$resourceRef");
    } catch (cause) {
      throw new AgentResourceReopenError(
        "invalid_utf8",
        "The reopened agent resource is not valid UTF-8.",
        cause,
      );
    }
    if (!utf8TextMatchesBytes(text, copy)) {
      throw new AgentResourceReopenError(
        "source_exactness_failed",
        "Reopened agent resource UTF-8 text does not round-trip to the stored bytes.",
      );
    }
    return { reference: reopened.reference, bytes: copy, text };
  }
}

function utf8TextMatchesBytes(text: string, bytes: Uint8Array): boolean {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength !== bytes.byteLength) return false;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (encoded[index] !== bytes[index]) return false;
  }
  return true;
}
