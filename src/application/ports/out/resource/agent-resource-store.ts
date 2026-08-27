/**
 * Persistence for exact agent-authored resource bytes plus capture metadata.
 *
 * Implementations never expose a filesystem path. The minted URI and
 * fingerprint are store-owned.
 */

import type { AgentResourceEnvelope } from "../../../../domain/resource/agent-resource-envelope.ts";
import type { AgentResourceReference } from "../../../../domain/resource/agent-resource-capture.ts";

export interface StoredAgentResource {
  readonly reference: AgentResourceReference;
  readonly bytes: Uint8Array;
}

export interface AgentResourceStore {
  save(envelope: AgentResourceEnvelope): Promise<StoredAgentResource>;
  read(uri: string): Promise<StoredAgentResource | undefined>;
  list(): Promise<readonly StoredAgentResource[]>;
}
