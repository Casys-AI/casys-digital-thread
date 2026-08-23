/**
 * Closed interpretation registry selected from JSON `schemaVersion`.
 *
 * Codecs are injected; this module does not own typed CAS or schema files.
 * Unparseable UTF-8/JSON cannot declare a known schema and stays raw.
 */

import type { AgentResourceInterpretation } from "../../../domain/resource/agent-resource-capture.ts";
import { rawAgentResourceInterpretation } from "../../../domain/resource/agent-resource-capture.ts";
import type {
  ResourceInterpretationCodec,
  ResourceInterpretationGateway,
} from "../../ports/out/resource/resource-interpretation-gateway.ts";

export class ClosedResourceInterpretationRegistry
  implements ResourceInterpretationGateway {
  readonly #codecs: ReadonlyMap<string, ResourceInterpretationCodec>;

  constructor(codecs: readonly ResourceInterpretationCodec[]) {
    const map = new Map<string, ResourceInterpretationCodec>();
    for (const codec of codecs) {
      if (map.has(codec.schemaVersion)) {
        throw new TypeError(
          `Duplicate resource interpretation codec for ${codec.schemaVersion}.`,
        );
      }
      map.set(codec.schemaVersion, codec);
    }
    this.#codecs = map;
  }

  async interpret(bytes: Uint8Array): Promise<AgentResourceInterpretation> {
    const schemaVersion = peekJsonSchemaVersion(bytes);
    if (schemaVersion === null) return rawAgentResourceInterpretation();
    const codec = this.#codecs.get(schemaVersion);
    if (!codec) return rawAgentResourceInterpretation(schemaVersion);
    return await codec.interpret(bytes);
  }
}

function peekJsonSchemaVersion(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
    return typeof schemaVersion === "string" && schemaVersion.length > 0
      ? schemaVersion
      : null;
  } catch {
    return null;
  }
}
