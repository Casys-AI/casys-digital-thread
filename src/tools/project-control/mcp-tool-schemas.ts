import type { ThreadEntityKind } from "../../domain/thread/thread-snapshot.ts";
import { AGENT_RESOURCE_REFERENCE_SCHEMA as AGENT_RESOURCE_REFERENCE_JSON_SCHEMA } from "../../domain/resource/agent-resource-reference.ts";

export const AGENT_RESOURCE_REFERENCE_SCHEMA = AGENT_RESOURCE_REFERENCE_JSON_SCHEMA;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * These commands mutate only the durable EngineeringProject aggregate. They do
 * not directly execute an external engineering tool and are not safe for
 * speculative or automatic retries without their durable command id.
 */
export const PROJECT_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Same-command retries resume the server-owned local execution safely. */
export const PROJECT_EXECUTION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Signed elicitation request state makes same-command retries safe. */
export const PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const OBJECT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const;

export const COMMAND_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description:
    "Stable command id. Reuse it verbatim, with identical arguments, when retrying an uncertain call.",
} as const;

export const PROJECT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$",
  not: { const: "latest" },
  description: "Engineering project identity from project_snapshot. latest is refused.",
} as const;

export const EXPECTED_REVISION = {
  type: "integer",
  minimum: 1,
  description:
    "Optimistic EngineeringProject revision from the latest project_snapshot.",
} as const;

export const ISSUED_AT = {
  type: "string",
  description:
    "Client audit ISO timestamp preserved with commandId on retry. It must not be later than the server clock; use the current UTC time at whole seconds. Do not invent a future timestamp.",
} as const;

export const THREAD_ENTITY_KINDS = [
  "artifact",
  "consumption",
  "observation",
  "requirement",
  "evaluation",
  "violation",
  "change",
  "action",
] as const satisfies readonly ThreadEntityKind[];

const SNAPSHOT_ID = {
  type: "string",
  minLength: 1,
  not: { const: "latest" },
  description: "Exact Thread snapshot id. latest is refused.",
} as const;

export const THREAD_ENTITY_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    snapshotId: SNAPSHOT_ID,
    snapshotRevision: { type: "integer", minimum: 1 },
    kind: { type: "string", enum: THREAD_ENTITY_KINDS },
    id: { type: "string", minLength: 1 },
  },
  required: ["snapshotId", "snapshotRevision", "kind", "id"],
  additionalProperties: false,
} as const;

const OPERATION_BINDING_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    source: {
      oneOf: [
        {
          type: "object",
          properties: { kind: { const: "approved-brief" } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "project-answer" },
            answerId: { type: "string", minLength: 1 },
          },
          required: ["kind", "answerId"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "thread-entity" },
            reference: THREAD_ENTITY_REFERENCE_SCHEMA,
          },
          required: ["kind", "reference"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["name", "source"],
  additionalProperties: false,
} as const;

export const OPERATION_REF_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    version: {
      type: "string",
      minLength: 1,
      not: { const: "latest" },
      description: "Exact registered operation version. latest is refused.",
    },
    bindings: {
      type: "array",
      items: OPERATION_BINDING_SCHEMA,
    },
  },
  required: ["id", "version", "bindings"],
  additionalProperties: false,
} as const;

export const GATE_CLAIM_SCHEMA = {
  type: "object",
  properties: {
    gateItemId: { type: "string", minLength: 1 },
    role: { type: "string", enum: ["contributes-to", "satisfies"] },
    status: {
      type: "string",
      enum: ["current", "impact-unresolved", "invalidated", "carried-forward"],
    },
  },
  required: ["gateItemId", "role", "status"],
  additionalProperties: false,
} as const;

export const COMMON_MUTATION_PROPERTIES = {
  commandId: COMMAND_ID,
  projectId: PROJECT_ID,
  expectedRevision: EXPECTED_REVISION,
  issuedAt: ISSUED_AT,
} as const;

export const FINGERPRINT_SCHEMA = {
  type: "object",
  properties: {
    algorithm: { const: "sha256" },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  required: ["algorithm", "digest"],
  additionalProperties: false,
} as const;

export const THREAD_SNAPSHOT_REF_SCHEMA = {
  type: "object",
  properties: {
    snapshotId: SNAPSHOT_ID,
    revision: { type: "integer", minimum: 1 },
    subjectId: { type: "string", minLength: 1 },
  },
  required: ["snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

/** Build one exact mutation envelope around tool-specific properties. */
export function mutationSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...COMMON_MUTATION_PROPERTIES, ...properties },
    required: [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      ...required,
    ],
    additionalProperties: false,
  };
}
