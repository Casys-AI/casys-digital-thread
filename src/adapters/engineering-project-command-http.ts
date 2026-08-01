import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../domain/engineering-project-command-service.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../domain/engineering-project.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";
import { requestUsesExplicitLoopbackHost } from "./loopback-host.ts";

export const ENGINEERING_PROJECT_COMMAND_SCHEMA =
  "engineering-project-command/1.0" as const;
export const OPERATOR_INTENT_HEADER = "X-Casys-Operator-Intent" as const;
export const OPERATOR_INTENT_VALUE = "explicit" as const;
const MAX_COMMAND_BYTES = 64 * 1024;

export type ProjectOperatorCommand =
  | {
    readonly type: "decision.propose";
    readonly decisionId: string;
    readonly proposal: {
      readonly summary: string;
      readonly parameters: readonly EngineeringDecisionProposalParameter[];
    };
  }
  | {
    readonly type: "decision.approve" | "decision.reject";
    readonly decisionId: string;
    readonly rationale: string;
    readonly inputFingerprint: ContentFingerprint;
  }
  | {
    readonly type: "agent-run.queue";
    readonly workItemId: string;
    readonly summary: string;
  };

export interface ProjectOperatorCommandRequest {
  readonly schemaVersion: typeof ENGINEERING_PROJECT_COMMAND_SCHEMA;
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly actor: { readonly id: string };
  readonly command: ProjectOperatorCommand;
}

export class ProjectCommandHttpError extends Error {
  constructor(
    readonly status: 403 | 415 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectCommandHttpError";
  }
}

/** Browser-only command gate. Nothing in the JSON body can weaken it. */
export async function readOperatorProjectCommand(
  request: Request,
): Promise<ProjectOperatorCommandRequest> {
  const requestUrl = new URL(request.url);
  if (!requestUsesExplicitLoopbackHost(request)) {
    throw new ProjectCommandHttpError(
      403,
      "loopback_host_required",
      "Operator commands are available only on an explicit loopback hostname.",
    );
  }
  const requestOrigin = requestUrl.origin;
  if (request.headers.get("Origin") !== requestOrigin) {
    throw new ProjectCommandHttpError(
      403,
      "same_origin_required",
      "Operator commands require an exact same-origin browser request.",
    );
  }
  if (request.headers.get(OPERATOR_INTENT_HEADER) !== OPERATOR_INTENT_VALUE) {
    throw new ProjectCommandHttpError(
      403,
      "explicit_operator_intent_required",
      `${OPERATOR_INTENT_HEADER}: ${OPERATOR_INTENT_VALUE} is required.`,
    );
  }
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ProjectCommandHttpError(
      415,
      "json_content_type_required",
      "Operator commands require Content-Type: application/json.",
    );
  }
  const declaredBytes = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_COMMAND_BYTES) {
    throw invalidCommand("Command body exceeds 64 KiB.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_COMMAND_BYTES) {
    throw invalidCommand("Command body exceeds 64 KiB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalidCommand("Command body must contain valid JSON.");
  }
  return parseOperatorProjectCommand(value);
}

export function parseOperatorProjectCommand(
  value: unknown,
): ProjectOperatorCommandRequest {
  const root = exactRecord(value, "$command");
  exactKeys(
    root,
    [
      "schemaVersion",
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      "actor",
      "command",
    ],
    [],
    "$command",
  );
  if (root.schemaVersion !== ENGINEERING_PROJECT_COMMAND_SCHEMA) {
    throw invalidCommand(
      `schemaVersion must be ${ENGINEERING_PROJECT_COMMAND_SCHEMA}.`,
    );
  }
  const actor = exactRecord(root.actor, "$command.actor");
  exactKeys(actor, ["id"], [], "$command.actor");
  const result: ProjectOperatorCommandRequest = {
    schemaVersion: ENGINEERING_PROJECT_COMMAND_SCHEMA,
    commandId: stableId(root.commandId, "$command.commandId"),
    projectId: stableId(root.projectId, "$command.projectId"),
    expectedRevision: positiveInteger(
      root.expectedRevision,
      "$command.expectedRevision",
    ),
    issuedAt: isoDateTime(root.issuedAt, "$command.issuedAt"),
    actor: { id: stableId(actor.id, "$command.actor.id") },
    command: parseCommand(root.command),
  };
  return result;
}

export async function executeOperatorProjectCommand(
  commands: EngineeringProjectCommandService,
  projects: EngineeringProjectRevisionStore,
  request: ProjectOperatorCommandRequest,
): Promise<EngineeringProjectSnapshot> {
  const origin = { kind: "human" as const, actorId: request.actor.id };
  const common = {
    commandId: request.commandId,
    projectId: request.projectId,
    expectedRevision: request.expectedRevision,
    issuedAt: request.issuedAt,
  };
  switch (request.command.type) {
    case "decision.propose": {
      const project = await requiredProjectRevision(
        projects,
        request.projectId,
        request.expectedRevision,
      );
      return await commands.proposeDecision(origin, {
        ...common,
        decisionId: request.command.decisionId,
        proposal: request.command.proposal,
        baseSnapshot: declaredProjectHead(project),
      });
    }
    case "decision.approve":
      return await commands.approveDecision(origin, {
        ...common,
        decisionId: request.command.decisionId,
        rationale: request.command.rationale,
        inputFingerprint: request.command.inputFingerprint,
      });
    case "decision.reject":
      return await commands.rejectDecision(origin, {
        ...common,
        decisionId: request.command.decisionId,
        rationale: request.command.rationale,
        inputFingerprint: request.command.inputFingerprint,
      });
    case "agent-run.queue": {
      const project = await requiredProjectRevision(
        projects,
        request.projectId,
        request.expectedRevision,
      );
      return await commands.queueRun(origin, {
        ...common,
        runId: `run:${request.commandId}`,
        workItemId: request.command.workItemId,
        summary: request.command.summary,
        baseSnapshot: declaredProjectHead(project),
      });
    }
  }
}

function parseCommand(value: unknown): ProjectOperatorCommand {
  const command = exactRecord(value, "$command.command");
  const type = requiredString(command.type, "$command.command.type");
  switch (type) {
    case "decision.propose": {
      exactKeys(
        command,
        ["type", "decisionId", "proposal"],
        [],
        "$command.command",
      );
      return {
        type,
        decisionId: stableId(command.decisionId, "$command.command.decisionId"),
        proposal: proposal(command.proposal),
      };
    }
    case "decision.approve":
    case "decision.reject": {
      exactKeys(
        command,
        ["type", "decisionId", "rationale", "inputFingerprint"],
        [],
        "$command.command",
      );
      return {
        type,
        decisionId: stableId(command.decisionId, "$command.command.decisionId"),
        rationale: requiredString(
          command.rationale,
          "$command.command.rationale",
        ),
        inputFingerprint: fingerprint(
          command.inputFingerprint,
          "$command.command.inputFingerprint",
        ),
      };
    }
    case "agent-run.queue": {
      exactKeys(
        command,
        ["type", "workItemId", "summary"],
        [],
        "$command.command",
      );
      return {
        type,
        workItemId: stableId(command.workItemId, "$command.command.workItemId"),
        summary: requiredString(command.summary, "$command.command.summary"),
      };
    }
    default:
      throw invalidCommand(`Unsupported operator command type: ${type}.`);
  }
}

function proposal(value: unknown): {
  summary: string;
  parameters: EngineeringDecisionProposalParameter[];
} {
  const input = exactRecord(value, "$command.command.proposal");
  exactKeys(
    input,
    ["summary", "parameters"],
    [],
    "$command.command.proposal",
  );
  if (!Array.isArray(input.parameters)) {
    throw invalidCommand("$command.command.proposal.parameters must be an array.");
  }
  if (input.parameters.length === 0) {
    throw invalidCommand(
      "$command.command.proposal.parameters must contain at least one parameter.",
    );
  }
  const keys = new Set<string>();
  const parameters = input.parameters.map((value, index) => {
    const path = `$command.command.proposal.parameters[${index}]`;
    const item = exactRecord(value, path);
    exactKeys(item, ["key", "label", "value"], ["unit"], path);
    const key = stableId(item.key, `${path}.key`);
    if (keys.has(key)) throw invalidCommand(`${path}.key must be unique.`);
    keys.add(key);
    const scalar = proposalScalar(item.value, `${path}.value`);
    const parameter: {
      key: string;
      label: string;
      value: string | number | boolean;
      unit?: string;
    } = {
      key,
      label: requiredString(item.label, `${path}.label`),
      value: scalar,
    };
    if (item.unit !== undefined) {
      if (typeof scalar !== "number") {
        throw invalidCommand(`${path}.unit is only valid for numeric values.`);
      }
      parameter.unit = requiredString(item.unit, `${path}.unit`);
    }
    return parameter;
  });
  return {
    summary: requiredString(input.summary, "$command.command.proposal.summary"),
    parameters,
  };
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, path);
  exactKeys(input, ["algorithm", "digest"], [], path);
  if (input.algorithm !== "sha256") {
    throw invalidCommand(`${path}.algorithm must be sha256.`);
  }
  const digest = requiredString(input.digest, `${path}.digest`);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw invalidCommand(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest };
}

async function requiredProjectRevision(
  projects: EngineeringProjectRevisionStore,
  projectId: string,
  revision: number,
): Promise<EngineeringProjectSnapshot> {
  const project = await projects.getRevision(projectId, revision);
  if (!project) {
    throw new EngineeringProjectCommandError(
      "project_not_found",
      `Engineering project revision ${projectId}@${revision} does not exist.`,
    );
  }
  return project;
}

function declaredProjectHead(
  project: EngineeringProjectSnapshot,
): EngineeringThreadSnapshotRef {
  const reference =
    [...project.threadSnapshots].sort((left, right) =>
      right.revision - left.revision ||
      right.snapshotId.localeCompare(left.snapshotId)
    )[0];
  if (!reference) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Engineering project ${project.project.id} has no exact thread snapshot.`,
    );
  }
  return structuredClone(reference);
}

function exactRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidCommand(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw invalidCommand(`${path} has unsupported field(s): ${extras.join(", ")}.`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw invalidCommand(`${path} is missing field(s): ${missing.join(", ")}.`);
  }
}

function stableId(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (result.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(result)) {
    throw invalidCommand(
      `${path} must be a stable identifier of at most 160 characters.`,
    );
  }
  return result;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidCommand(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidCommand(`${path} must be a positive safe integer.`);
  }
  return value as number;
}

function isoDateTime(value: unknown, path: string): string {
  const result = requiredString(value, path);
  const parsed = Date.parse(result);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(result) || !Number.isFinite(parsed)
  ) {
    throw invalidCommand(`${path} must be an ISO date-time.`);
  }
  return new Date(parsed).toISOString();
}

function proposalScalar(
  value: unknown,
  path: string,
): string | number | boolean {
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "boolean"
  ) throw invalidCommand(`${path} must be a string, finite number or boolean.`);
  if (typeof value === "string" && value.trim() === "") {
    throw invalidCommand(`${path} must not be empty.`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw invalidCommand(`${path} must be finite.`);
  }
  return value;
}

function invalidCommand(message: string): ProjectCommandHttpError {
  return new ProjectCommandHttpError(422, "invalid_project_command", message);
}
