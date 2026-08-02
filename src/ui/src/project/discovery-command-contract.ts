import type { ContentFingerprint } from "../../../domain/thread-snapshot.ts";

/** Browser-side wire contract for explicit human discovery commands. */

export const PROJECT_DISCOVERY_COMMAND_SCHEMA =
  "project-discovery-command/1.0" as const;
export const PROJECT_DISCOVERY_INTENT_HEADER =
  "X-Casys-Operator-Intent" as const;

export type ProjectDiscoveryOperatorCommand =
  | {
    readonly type: "answer.record";
    readonly answer: {
      readonly id: string;
      readonly questionId: string;
      readonly kind: "provided" | "unknown";
      readonly value?: string;
      readonly explanation?: string;
      readonly supersedesAnswerId?: string;
    };
  }
  | {
    readonly type: "brief.approve" | "brief.reject";
    readonly briefId: string;
    readonly rationale: string;
    /** Exact proposal scope shown to the reviewer. Never entered manually. */
    readonly inputFingerprint: ContentFingerprint;
  };

export interface ProjectDiscoveryOperatorCommandRequest {
  readonly schemaVersion: typeof PROJECT_DISCOVERY_COMMAND_SCHEMA;
  readonly commandId: string;
  readonly discoveryId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  /** Self-declared local reviewer identity; authentication is outside V1. */
  readonly actor: { readonly id: string };
  readonly command: ProjectDiscoveryOperatorCommand;
}

export function createProjectDiscoveryCommandRequest(options: {
  readonly commandId: string;
  readonly discoveryId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly actorId: string;
  readonly command: ProjectDiscoveryOperatorCommand;
}): ProjectDiscoveryOperatorCommandRequest {
  return {
    schemaVersion: PROJECT_DISCOVERY_COMMAND_SCHEMA,
    commandId: options.commandId,
    discoveryId: options.discoveryId,
    expectedRevision: options.expectedRevision,
    issuedAt: options.issuedAt,
    actor: { id: options.actorId },
    command: options.command,
  };
}
