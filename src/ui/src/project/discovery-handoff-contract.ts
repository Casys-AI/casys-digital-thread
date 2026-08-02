/** Browser-side wire contract for the human discovery-to-project handoff. */

export const PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA =
  "project-discovery-handoff-command/1.0" as const;
export const PROJECT_DISCOVERY_HANDOFF_RESULT_SCHEMA =
  "project-discovery-handoff-result/1.0" as const;
export const PROJECT_DISCOVERY_HANDOFF_RESULT_SCOPE =
  "initial-project-shell" as const;

/**
 * This command deliberately has no technical payload. The approved immutable
 * discovery is the authority for the initial project shell.
 */
export interface ProjectDiscoveryHandoffRequest {
  readonly schemaVersion: typeof PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA;
  readonly commandId: string;
  readonly discoveryId: string;
  readonly expectedDiscoveryRevision: number;
  readonly issuedAt: string;
  readonly actor: { readonly id: string };
  readonly command: {
    readonly type: "project.create-from-approved-discovery";
    readonly projectId: string;
    readonly projectName: string;
  };
}

export interface ProjectDiscoveryHandoffResult {
  readonly schemaVersion: typeof PROJECT_DISCOVERY_HANDOFF_RESULT_SCHEMA;
  /** This receipt describes revision 1 only, never the project's current state. */
  readonly scope: typeof PROJECT_DISCOVERY_HANDOFF_RESULT_SCOPE;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
  };
  readonly message: string;
}

export function createProjectDiscoveryHandoffRequest(options: {
  readonly commandId: string;
  readonly discoveryId: string;
  readonly expectedDiscoveryRevision: number;
  readonly issuedAt: string;
  readonly actorId: string;
  readonly projectId: string;
  readonly projectName: string;
}): ProjectDiscoveryHandoffRequest {
  return {
    schemaVersion: PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA,
    commandId: options.commandId,
    discoveryId: options.discoveryId,
    expectedDiscoveryRevision: options.expectedDiscoveryRevision,
    issuedAt: options.issuedAt,
    actor: { id: options.actorId },
    command: {
      type: "project.create-from-approved-discovery",
      projectId: options.projectId,
      projectName: options.projectName.trim(),
    },
  };
}
