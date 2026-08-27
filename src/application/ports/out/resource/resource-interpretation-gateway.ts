/**
 * Server-owned interpretation of captured bytes.
 *
 * The gateway selects a closed codec from JSON `schemaVersion`. Unknown
 * files stay raw. A declared known schema that fails validation stays
 * unresolved and never yields a typed fingerprint.
 */

import type { AgentResourceInterpretation } from "../../../../domain/resource/agent-resource-capture.ts";

export interface ResourceInterpretationCodec {
  readonly schemaVersion: string;
  interpret(bytes: Uint8Array): Promise<AgentResourceInterpretation>;
}

export interface ResourceInterpretationGateway {
  interpret(bytes: Uint8Array): Promise<AgentResourceInterpretation>;
}
