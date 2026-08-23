import { FileAgentResourceStore } from "../adapters/resource/file-agent-resource-store.ts";
import { ReopenAgentResource } from "../application/use-cases/resource/reopen-agent-resource.ts";
import type { AgentResourceReference } from "../domain/resource/agent-resource-capture.ts";
import { parseAgentResourceEnvelope } from "../domain/resource/agent-resource-envelope.ts";

export function testReopenAgentResource(directory: string): ReopenAgentResource {
  return new ReopenAgentResource(new FileAgentResourceStore(directory));
}

export function sampleAgentResourceReference(
  overrides: Partial<AgentResourceReference> = {},
): AgentResourceReference {
  const digest = overrides.fingerprint?.digest ?? "a".repeat(64);
  return {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${digest}`,
    name: "source.txt",
    mimeType: "text/plain",
    representation: "text",
    byteCount: 1,
    fingerprint: { algorithm: "sha256", digest },
    ...overrides,
  };
}

export async function persistAgentResourceText(
  directory: string,
  input: { name: string; mimeType: string; text: string },
): Promise<{
  store: FileAgentResourceStore;
  reopen: ReopenAgentResource;
  reference: AgentResourceReference;
}> {
  const store = new FileAgentResourceStore(directory);
  const stored = await store.save(parseAgentResourceEnvelope({
    name: input.name,
    mimeType: input.mimeType,
    text: input.text,
  }));
  return {
    store,
    reopen: new ReopenAgentResource(store),
    reference: stored.reference,
  };
}

export function tamperAgentResourceReference(
  reference: AgentResourceReference,
  patch:
    & Partial<
      Omit<AgentResourceReference, "fingerprint" | "schemaVersion">
    >
    & {
      fingerprint?: AgentResourceReference["fingerprint"];
    },
): AgentResourceReference {
  return { ...reference, ...patch };
}
