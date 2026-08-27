/**
 * Publish captured agent resources on McpApp `resources/read`.
 *
 * Size and MIME are attested at registration. Representation (text XOR blob)
 * is preserved from capture metadata. Discovery restores after restart.
 */

import type { McpApp, ResourceContent } from "@casys/mcp-server";
import type { AgentResourceExposure } from "../../application/ports/out/resource/agent-resource-exposure.ts";
import type { AgentResourceStore } from "../../application/ports/out/resource/agent-resource-store.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import {
  decodeUtf8ResourceText,
  encodeCanonicalBase64,
} from "../../domain/resource/agent-resource-envelope.ts";

export class McpAgentResourcePublisher implements AgentResourceExposure {
  readonly #app: McpApp;
  readonly #store: AgentResourceStore;

  constructor(app: McpApp, store: AgentResourceStore) {
    this.#app = app;
    this.#store = store;
  }

  expose(reference: AgentResourceReference): Promise<void> {
    if (this.#app.hasResource(reference.uri)) return Promise.resolve();
    this.#app.registerResource(
      {
        uri: reference.uri,
        name: reference.name,
        mimeType: reference.mimeType,
        size: reference.byteCount,
        description: "Draft agent-authored resource. Grants none.",
      },
      (uri) => this.#read(uri.toString()),
    );
    return Promise.resolve();
  }

  async restore(): Promise<void> {
    for (const stored of await this.#store.list()) {
      await this.expose(stored.reference);
    }
  }

  async #read(uri: string): Promise<ResourceContent> {
    const stored = await this.#store.read(uri);
    if (!stored) {
      throw new TypeError(`Agent resource ${uri} is unavailable.`);
    }
    const { reference, bytes } = stored;
    if (reference.representation === "text") {
      return {
        uri,
        mimeType: reference.mimeType,
        text: decodeUtf8ResourceText(bytes, "$agentResource.text"),
      };
    }
    return {
      uri,
      mimeType: reference.mimeType,
      blob: encodeCanonicalBase64(bytes),
    };
  }
}
