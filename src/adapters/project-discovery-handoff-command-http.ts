import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import {
  type CreateEngineeringProjectFromDiscoveryCommand,
  ProjectDiscoveryHandoffError,
  type ProjectDiscoveryHandoffService,
} from "../domain/project-discovery-handoff-service.ts";
import {
  DISCOVERY_OPERATOR_INTENT_HEADER,
  DISCOVERY_OPERATOR_INTENT_VALUE,
} from "./project-discovery-command-http.ts";
import { requestUsesExplicitLoopbackHost } from "./loopback-host.ts";

export const PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA =
  "project-discovery-handoff-command/1.0" as const;
const MAX_COMMAND_BYTES = 64 * 1024;

export interface ProjectDiscoveryHandoffOperatorCommandRequest {
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

export class ProjectDiscoveryHandoffCommandHttpError extends Error {
  constructor(
    readonly status: 403 | 415 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectDiscoveryHandoffCommandHttpError";
  }
}

/**
 * Read one explicit same-origin human command to create a project from an
 * already-approved discovery. The browser cannot provide a brief fingerprint,
 * technical evidence, or an agent origin: those are never trusted inputs here.
 */
export async function readProjectDiscoveryHandoffOperatorCommand(
  request: Request,
): Promise<ProjectDiscoveryHandoffOperatorCommandRequest> {
  const url = new URL(request.url);
  if (!requestUsesExplicitLoopbackHost(request)) {
    throw forbidden(
      "loopback_host_required",
      "Discovery handoff commands require an explicit loopback hostname.",
    );
  }
  if (request.headers.get("Origin") !== url.origin) {
    throw forbidden(
      "same_origin_required",
      "Discovery handoff commands require an exact same-origin request.",
    );
  }
  if (
    request.headers.get(DISCOVERY_OPERATOR_INTENT_HEADER) !==
      DISCOVERY_OPERATOR_INTENT_VALUE
  ) {
    throw forbidden(
      "explicit_operator_intent_required",
      `${DISCOVERY_OPERATOR_INTENT_HEADER}: ${DISCOVERY_OPERATOR_INTENT_VALUE} is required.`,
    );
  }
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ProjectDiscoveryHandoffCommandHttpError(
      415,
      "json_content_type_required",
      "Discovery handoff commands require Content-Type: application/json.",
    );
  }
  const declaredBytes = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_COMMAND_BYTES) {
    throw invalid("Command body exceeds 64 KiB.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_COMMAND_BYTES) {
    throw invalid("Command body exceeds 64 KiB.");
  }
  try {
    return parseProjectDiscoveryHandoffOperatorCommand(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProjectDiscoveryHandoffCommandHttpError) throw error;
    throw invalid("Command body must contain valid JSON.");
  }
}

export function parseProjectDiscoveryHandoffOperatorCommand(
  value: unknown,
): ProjectDiscoveryHandoffOperatorCommandRequest {
  const root = record(value, "$command");
  exactKeys(root, [
    "schemaVersion",
    "commandId",
    "discoveryId",
    "expectedDiscoveryRevision",
    "issuedAt",
    "actor",
    "command",
  ], "$command");
  if (root.schemaVersion !== PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA) {
    throw invalid(
      `schemaVersion must be ${PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA}.`,
    );
  }
  const actor = record(root.actor, "$command.actor");
  exactKeys(actor, ["id"], "$command.actor");
  const command = record(root.command, "$command.command");
  exactKeys(command, ["type", "projectId", "projectName"], "$command.command");
  if (command.type !== "project.create-from-approved-discovery") {
    throw invalid(
      "$command.command.type must be project.create-from-approved-discovery.",
    );
  }
  return {
    schemaVersion: PROJECT_DISCOVERY_HANDOFF_COMMAND_SCHEMA,
    commandId: stableId(root.commandId, "$command.commandId"),
    discoveryId: stableId(root.discoveryId, "$command.discoveryId"),
    expectedDiscoveryRevision: positiveInteger(
      root.expectedDiscoveryRevision,
      "$command.expectedDiscoveryRevision",
    ),
    issuedAt: isoDateTime(root.issuedAt, "$command.issuedAt"),
    actor: { id: stableId(actor.id, "$command.actor.id") },
    command: {
      type: "project.create-from-approved-discovery",
      projectId: stableId(command.projectId, "$command.command.projectId"),
      projectName: nonEmptyString(command.projectName, "$command.command.projectName"),
    },
  };
}

export async function executeProjectDiscoveryHandoffOperatorCommand(
  handoff: ProjectDiscoveryHandoffService,
  request: ProjectDiscoveryHandoffOperatorCommandRequest,
): Promise<EngineeringProjectSnapshot> {
  const command: CreateEngineeringProjectFromDiscoveryCommand = {
    commandId: request.commandId,
    discoveryId: request.discoveryId,
    expectedDiscoveryRevision: request.expectedDiscoveryRevision,
    issuedAt: request.issuedAt,
    projectId: request.command.projectId,
    projectName: request.command.projectName,
  };
  return await handoff.createEngineeringProject(
    { kind: "human", actorId: request.actor.id },
    command,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
): void {
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${path}.${key} is not supported.`);
  }
  for (const key of required) {
    if (!(key in value)) throw invalid(`${path}.${key} is required.`);
  }
}

function stableId(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (result.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(result)) {
    throw invalid(`${path} is not a valid stable id.`);
  }
  if (result.toLowerCase() === "latest") {
    throw invalid(`${path} cannot use a latest alias.`);
  }
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalid(`${path} must be a positive integer.`);
  }
  return value as number;
}

function isoDateTime(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed)) throw invalid(`${path} must be an ISO datetime.`);
  return new Date(parsed).toISOString();
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalid(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function forbidden(
  code: string,
  message: string,
): ProjectDiscoveryHandoffCommandHttpError {
  return new ProjectDiscoveryHandoffCommandHttpError(403, code, message);
}

function invalid(message: string): ProjectDiscoveryHandoffCommandHttpError {
  return new ProjectDiscoveryHandoffCommandHttpError(
    422,
    "invalid_discovery_handoff_command",
    message,
  );
}

export function isProjectDiscoveryHandoffError(
  error: unknown,
): error is ProjectDiscoveryHandoffError {
  return error instanceof ProjectDiscoveryHandoffError;
}
