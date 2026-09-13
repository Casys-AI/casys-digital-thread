import type { BuyConfigurationSourceReader } from "../../application/ports/out/buy/buy-configuration-source-reader.ts";
import type { AgentResourceStore } from "../../application/ports/out/resource/agent-resource-store.ts";
import { decodeUtf8ResourceText } from "../../domain/resource/agent-resource-envelope.ts";

export class AgentResourceBuyConfigurationReader
  implements BuyConfigurationSourceReader {
  constructor(private readonly resources: Pick<AgentResourceStore, "read">) {}

  async read(uri: string, digest: string): Promise<string | undefined> {
    const stored = await this.resources.read(uri);
    if (!stored) return undefined;
    if (stored.reference.fingerprint.digest !== digest) return undefined;
    return decodeUtf8ResourceText(stored.bytes, "Buy configuration");
  }
}
