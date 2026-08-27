/**
 * Filesystem CAS for exact agent-resource payload bytes plus sidecar metadata.
 *
 * Payload files are named by SHA-256 digest. Metadata is `{digest}.json`.
 * Discovery ignores any other filename. Paths never leave this adapter.
 */

import type {
  AgentResourceStore,
  StoredAgentResource,
} from "../../application/ports/out/resource/agent-resource-store.ts";
import type { AgentResourceEnvelope } from "../../domain/resource/agent-resource-envelope.ts";
import {
  AGENT_RESOURCE_CAPTURE_SCHEMA,
  fingerprintAgentResourceBytes,
} from "../../domain/resource/agent-resource-envelope.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";

const DIGEST_FILE = /^[a-f0-9]{64}$/;

export const AGENT_RESOURCE_BYTES_KIND = "agent-resource" as const;
export const AGENT_RESOURCE_URI_NAMESPACE = "agent-resource-capture" as const;

export class FileAgentResourceStore implements AgentResourceStore {
  readonly #bytes: FileByteStore<"agent-resource">;
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory.replace(/\/+$/, "") || ".";
    this.#bytes = new FileByteStore({
      kind: AGENT_RESOURCE_BYTES_KIND,
      directory: this.#directory,
      uriNamespace: AGENT_RESOURCE_URI_NAMESPACE,
      label: "Agent resource",
    });
  }

  async save(envelope: AgentResourceEnvelope): Promise<StoredAgentResource> {
    const fingerprint = await fingerprintAgentResourceBytes(envelope.bytes);
    const stored = await this.#bytes.save(fingerprint, envelope.bytes);
    const reference: AgentResourceReference = {
      schemaVersion: AGENT_RESOURCE_CAPTURE_SCHEMA,
      uri: stored.uri,
      name: envelope.name,
      mimeType: envelope.mimeType,
      representation: envelope.representation,
      byteCount: stored.byteCount,
      fingerprint,
    };
    await this.#writeMetadata(reference);
    const reread = await this.read(reference.uri);
    if (!reread) {
      throw new TypeError("Agent resource disappeared after publication.");
    }
    if (
      reread.reference.name !== envelope.name ||
      reread.reference.representation !== envelope.representation ||
      reread.reference.mimeType !== envelope.mimeType ||
      reread.reference.byteCount !== envelope.bytes.byteLength
    ) {
      throw new TypeError(
        "Reopened agent resource metadata does not match the captured envelope.",
      );
    }
    return reread;
  }

  async read(uri: string): Promise<StoredAgentResource | undefined> {
    const digest = digestFromUri(uri);
    if (digest === undefined) return undefined;
    const fingerprint = { algorithm: "sha256" as const, digest };
    const payload = await this.#bytes.read(fingerprint);
    if (payload === undefined) return undefined;
    const metadata = await this.#readMetadata(digest);
    if (!metadata) return undefined;
    if (metadata.uri !== uri || metadata.fingerprint.digest !== digest) {
      throw new TypeError("Agent resource metadata URI/digest mismatch.");
    }
    if (metadata.byteCount !== payload.byteLength) {
      throw new TypeError("Agent resource metadata size does not match bytes.");
    }
    return { reference: metadata, bytes: payload.copy() };
  }

  async list(): Promise<readonly StoredAgentResource[]> {
    let names: string[];
    try {
      names = [];
      for await (const entry of Deno.readDir(this.#directory)) {
        if (entry.isFile && DIGEST_FILE.test(entry.name)) names.push(entry.name);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    const resources: StoredAgentResource[] = [];
    for (const digest of names.toSorted()) {
      const uri = this.#bytes.uriFor({ algorithm: "sha256", digest });
      const stored = await this.read(uri);
      if (stored) resources.push(stored);
    }
    return resources;
  }

  async #writeMetadata(reference: AgentResourceReference): Promise<void> {
    const path = this.#metadataPath(reference.fingerprint.digest);
    const text = deterministicJson({
      schemaVersion: AGENT_RESOURCE_CAPTURE_SCHEMA,
      name: reference.name,
      mimeType: reference.mimeType,
      representation: reference.representation,
      byteCount: reference.byteCount,
      fingerprint: reference.fingerprint,
      uri: reference.uri,
    });
    await Deno.mkdir(this.#directory, { recursive: true });
    try {
      await Deno.writeTextFile(path, text, { createNew: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
  }

  async #readMetadata(
    digest: string,
  ): Promise<AgentResourceReference | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.#metadataPath(digest));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    return parseMetadata(JSON.parse(text));
  }

  #metadataPath(digest: string): string {
    return `${this.#directory}/${digest}.json`;
  }
}

function parseMetadata(value: unknown): AgentResourceReference {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "name",
      "mimeType",
      "representation",
      "byteCount",
      "fingerprint",
      "uri",
    ],
    "$agentResourceMetadata",
  );
  literalValue(
    root.schemaVersion,
    AGENT_RESOURCE_CAPTURE_SCHEMA,
    "$agentResourceMetadata.schemaVersion",
  );
  const fingerprint = exactRecord(
    root.fingerprint,
    ["algorithm", "digest"],
    "$agentResourceMetadata.fingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$agentResourceMetadata.fingerprint.algorithm",
  );
  if (
    root.representation !== "text" && root.representation !== "blob"
  ) {
    throw new TypeError("$agentResourceMetadata.representation is unsupported.");
  }
  if (
    typeof root.byteCount !== "number" || !Number.isSafeInteger(root.byteCount) ||
    root.byteCount < 1
  ) {
    throw new TypeError("$agentResourceMetadata.byteCount is invalid.");
  }
  return {
    schemaVersion: AGENT_RESOURCE_CAPTURE_SCHEMA,
    name: nonEmptyText(root.name, "$agentResourceMetadata.name"),
    mimeType: nonEmptyText(root.mimeType, "$agentResourceMetadata.mimeType"),
    representation: root.representation,
    byteCount: root.byteCount,
    uri: nonEmptyText(root.uri, "$agentResourceMetadata.uri"),
    fingerprint: {
      algorithm: "sha256",
      digest: nonEmptyText(
        fingerprint.digest,
        "$agentResourceMetadata.fingerprint.digest",
      ),
    },
  };
}

function digestFromUri(uri: string): string | undefined {
  const prefix = `casys://${AGENT_RESOURCE_URI_NAMESPACE}/sha256/`;
  if (!uri.startsWith(prefix)) return undefined;
  const digest = uri.slice(prefix.length);
  return DIGEST_FILE.test(digest) ? digest : undefined;
}
