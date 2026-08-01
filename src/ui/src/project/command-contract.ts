/** Browser-side wire contract for explicit, human operator commands. */

export const PROJECT_COMMAND_INTENTS = [
  "decision.propose",
  "decision.approve",
  "decision.reject",
  "agent-run.queue",
] as const;

export type ProjectCommandIntent = typeof PROJECT_COMMAND_INTENTS[number];

export interface DecisionProposalParameter {
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
}

export interface DecisionProposal {
  readonly summary: string;
  readonly parameters: readonly DecisionProposalParameter[];
}

export interface CommandInputFingerprint {
  readonly algorithm: "sha256";
  readonly digest: string;
}

export type ProjectOperatorCommand =
  | {
    readonly type: "decision.propose";
    readonly decisionId: string;
    readonly proposal: DecisionProposal;
  }
  | {
    readonly type: "decision.approve" | "decision.reject";
    readonly decisionId: string;
    readonly rationale: string;
    /** Exact proposal scope shown to the operator. Never entered manually. */
    readonly inputFingerprint: CommandInputFingerprint;
  }
  | {
    readonly type: "agent-run.queue";
    readonly workItemId: string;
    readonly summary: string;
  };

export interface ProjectCommandRequest {
  readonly schemaVersion: "engineering-project-command/1.0";
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  /** Self-declared operator identity. Authentication is outside this prototype. */
  readonly actor: { readonly id: string };
  readonly command: ProjectOperatorCommand;
}

export interface OperatorCommandCapabilities {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly intents: readonly ProjectCommandIntent[];
  readonly explicitIntentHeader: string;
  readonly expectedRevision: number;
}

export interface EngineeringWorkbenchCapabilities {
  readonly operatorCommands: OperatorCommandCapabilities;
}

export function isProjectCommandIntent(
  value: unknown,
): value is ProjectCommandIntent {
  return typeof value === "string" &&
    (PROJECT_COMMAND_INTENTS as readonly string[]).includes(value);
}

export function isOperatorCommandCapabilities(
  value: unknown,
): value is OperatorCommandCapabilities {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OperatorCommandCapabilities>;
  return typeof candidate.enabled === "boolean" &&
    typeof candidate.endpoint === "string" &&
    Array.isArray(candidate.intents) &&
    candidate.intents.every(isProjectCommandIntent) &&
    typeof candidate.explicitIntentHeader === "string" &&
    typeof candidate.expectedRevision === "number";
}

export function createProjectCommandRequest(options: {
  command: ProjectOperatorCommand;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  issuedAt: string;
  actorId: string;
}): ProjectCommandRequest {
  return {
    schemaVersion: "engineering-project-command/1.0",
    commandId: options.commandId,
    projectId: options.projectId,
    expectedRevision: options.expectedRevision,
    issuedAt: options.issuedAt,
    actor: { id: options.actorId },
    command: options.command,
  };
}
