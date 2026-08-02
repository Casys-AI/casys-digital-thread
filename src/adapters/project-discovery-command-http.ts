import {
  ProjectDiscoveryCommandError,
  type ProjectDiscoveryCommandService,
  type ProjectDiscoveryRevisionStore,
} from "../domain/project-discovery-command-service.ts";
import type { ProjectDiscoverySnapshot } from "../domain/project-discovery.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";
import { requestUsesExplicitLoopbackHost } from "./loopback-host.ts";

export const PROJECT_DISCOVERY_OPERATOR_COMMAND_SCHEMA =
  "project-discovery-command/1.0" as const;
export const DISCOVERY_OPERATOR_INTENT_HEADER = "X-Casys-Operator-Intent" as const;
export const DISCOVERY_OPERATOR_INTENT_VALUE = "explicit" as const;
const MAX_COMMAND_BYTES = 64 * 1024;

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
    readonly inputFingerprint: ContentFingerprint;
  };

export interface ProjectDiscoveryOperatorCommandRequest {
  readonly schemaVersion: typeof PROJECT_DISCOVERY_OPERATOR_COMMAND_SCHEMA;
  readonly commandId: string;
  readonly discoveryId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly actor: { readonly id: string };
  readonly command: ProjectDiscoveryOperatorCommand;
}

export class ProjectDiscoveryCommandHttpError extends Error {
  constructor(
    readonly status: 403 | 415 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectDiscoveryCommandHttpError";
  }
}

/** Parse one explicit same-origin human discovery command. */
export async function readProjectDiscoveryOperatorCommand(
  request: Request,
): Promise<ProjectDiscoveryOperatorCommandRequest> {
  const url = new URL(request.url);
  if (!requestUsesExplicitLoopbackHost(request)) {
    throw forbidden(
      "loopback_host_required",
      "Discovery review commands require an explicit loopback hostname.",
    );
  }
  if (request.headers.get("Origin") !== url.origin) {
    throw forbidden(
      "same_origin_required",
      "Discovery review commands require an exact same-origin request.",
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
    throw new ProjectDiscoveryCommandHttpError(
      415,
      "json_content_type_required",
      "Discovery review commands require Content-Type: application/json.",
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
    return parseProjectDiscoveryOperatorCommand(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProjectDiscoveryCommandHttpError) throw error;
    throw invalid("Command body must contain valid JSON.");
  }
}

export function parseProjectDiscoveryOperatorCommand(
  value: unknown,
): ProjectDiscoveryOperatorCommandRequest {
  const root = record(value, "$command");
  exactKeys(root, [
    "schemaVersion",
    "commandId",
    "discoveryId",
    "expectedRevision",
    "issuedAt",
    "actor",
    "command",
  ], "$command");
  if (root.schemaVersion !== PROJECT_DISCOVERY_OPERATOR_COMMAND_SCHEMA) {
    throw invalid(
      `schemaVersion must be ${PROJECT_DISCOVERY_OPERATOR_COMMAND_SCHEMA}.`,
    );
  }
  const actor = record(root.actor, "$command.actor");
  exactKeys(actor, ["id"], "$command.actor");
  return {
    schemaVersion: PROJECT_DISCOVERY_OPERATOR_COMMAND_SCHEMA,
    commandId: stableId(root.commandId, "$command.commandId"),
    discoveryId: stableId(root.discoveryId, "$command.discoveryId"),
    expectedRevision: positiveInteger(
      root.expectedRevision,
      "$command.expectedRevision",
    ),
    issuedAt: isoDateTime(root.issuedAt, "$command.issuedAt"),
    actor: { id: stableId(actor.id, "$command.actor.id") },
    command: parseCommand(root.command),
  };
}

export async function executeProjectDiscoveryOperatorCommand(
  commands: ProjectDiscoveryCommandService,
  _discoveries: ProjectDiscoveryRevisionStore,
  request: ProjectDiscoveryOperatorCommandRequest,
): Promise<ProjectDiscoverySnapshot> {
  const origin = { kind: "human" as const, actorId: request.actor.id };
  const common = {
    commandId: request.commandId,
    discoveryId: request.discoveryId,
    expectedRevision: request.expectedRevision,
    issuedAt: request.issuedAt,
  };
  if (request.command.type === "answer.record") {
    return await commands.recordAnswer(origin, {
      ...common,
      answer: {
        ...request.command.answer,
        source: {
          kind: "human",
          reference: "same-origin Discovery Workbench",
        },
      },
    });
  }
  const review = {
    ...common,
    briefId: request.command.briefId,
    rationale: request.command.rationale,
    inputFingerprint: request.command.inputFingerprint,
  };
  return request.command.type === "brief.approve"
    ? await commands.approveBrief(origin, review)
    : await commands.rejectBrief(origin, review);
}

function parseCommand(value: unknown): ProjectDiscoveryOperatorCommand {
  const input = record(value, "$command.command");
  const type = nonEmptyString(input.type, "$command.command.type");
  if (type === "answer.record") {
    exactKeys(input, ["type", "answer"], "$command.command");
    const answer = record(input.answer, "$command.command.answer");
    exactKeys(
      answer,
      ["id", "questionId", "kind"],
      "$command.command.answer",
      ["value", "explanation", "supersedesAnswerId"],
    );
    const kind = oneOf(answer.kind, ["provided", "unknown"] as const, "kind");
    const value = optionalString(answer.value, "$command.command.answer.value");
    if (kind === "provided" && value === undefined) {
      throw invalid("A provided answer requires value.");
    }
    if (kind === "unknown" && value !== undefined) {
      throw invalid("An unknown answer cannot carry value.");
    }
    return {
      type,
      answer: {
        id: stableId(answer.id, "$command.command.answer.id"),
        questionId: stableId(
          answer.questionId,
          "$command.command.answer.questionId",
        ),
        kind,
        ...(value === undefined ? {} : { value }),
        ...optionalField(
          "explanation",
          optionalString(
            answer.explanation,
            "$command.command.answer.explanation",
          ),
        ),
        ...optionalField(
          "supersedesAnswerId",
          optionalStableId(
            answer.supersedesAnswerId,
            "$command.command.answer.supersedesAnswerId",
          ),
        ),
      },
    };
  }
  if (type === "brief.approve" || type === "brief.reject") {
    exactKeys(
      input,
      ["type", "briefId", "rationale", "inputFingerprint"],
      "$command.command",
    );
    return {
      type,
      briefId: stableId(input.briefId, "$command.command.briefId"),
      rationale: nonEmptyString(input.rationale, "$command.command.rationale"),
      inputFingerprint: fingerprint(
        input.inputFingerprint,
        "$command.command.inputFingerprint",
      ),
    };
  }
  throw invalid(`Unsupported discovery command type: ${type}.`);
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const input = record(value, path);
  exactKeys(input, ["algorithm", "digest"], path);
  if (input.algorithm !== "sha256") throw invalid(`${path}.algorithm must be sha256.`);
  const digest = nonEmptyString(input.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw invalid(`${path}.digest must contain 64 hexadecimal characters.`);
  }
  return { algorithm: "sha256", digest };
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
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${path}.${key} is not supported.`);
  }
  for (const key of required) {
    if (!(key in value)) throw invalid(`${path}.${key} is required.`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalid(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, path);
}

function stableId(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (result.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(result)) {
    throw invalid(`${path} is not a valid stable id.`);
  }
  return result;
}

function optionalStableId(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stableId(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalid(`${path} must be a positive integer.`);
  }
  return value as number;
}

function isoDateTime(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  const date = new Date(result);
  if (Number.isNaN(date.valueOf())) throw invalid(`${path} must be an ISO datetime.`);
  return date.toISOString();
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw invalid(`${path} must be one of ${choices.join(", ")}.`);
  }
  return value as T[number];
}

function optionalField<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]: V };
}

function forbidden(code: string, message: string): ProjectDiscoveryCommandHttpError {
  return new ProjectDiscoveryCommandHttpError(403, code, message);
}

function invalid(message: string): ProjectDiscoveryCommandHttpError {
  return new ProjectDiscoveryCommandHttpError(
    422,
    "invalid_discovery_command",
    message,
  );
}

export function isProjectDiscoveryCommandError(
  error: unknown,
): error is ProjectDiscoveryCommandError {
  return error instanceof ProjectDiscoveryCommandError;
}
