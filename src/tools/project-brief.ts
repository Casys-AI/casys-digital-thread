import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import { fingerprintsEqual } from "../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../domain/project/engineering-project-command-service.ts";
import {
  type ProjectAnswerInput,
  ProjectBriefCommandService,
  type ProjectBriefMutationCommand,
  type ProjectQuestionProposalInput,
} from "../domain/project/project-brief-command-service.ts";
import type {
  ProjectBriefItem,
  ProjectBriefSourceKind,
} from "../domain/project/project-brief.ts";
import type { ContentFingerprint } from "../domain/thread/thread-snapshot.ts";

const MUTATION = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const OBJECT_OUTPUT = { type: "object", additionalProperties: true } as const;
const STRING = { type: "string", minLength: 1 } as const;
const COMMAND_ID = {
  ...STRING,
  maxLength: 160,
  description:
    "Stable command id. Reuse it verbatim with identical arguments when retrying an uncertain call.",
} as const;
const PROJECT_ID = {
  ...STRING,
  maxLength: 160,
  description: "Stable engineering project identity from the first intent onward.",
} as const;
const ISSUED_AT = {
  ...STRING,
  description: "Stable ISO timestamp; preserve it with commandId on retry.",
} as const;
const EXPECTED_REVISION = {
  type: "integer",
  minimum: 1,
  description: "Optimistic revision from project_snapshot.",
} as const;
const FINGERPRINT = {
  type: "object",
  properties: {
    algorithm: { const: "sha256" },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  required: ["algorithm", "digest"],
  additionalProperties: false,
} as const;
const SOURCE = {
  type: "object",
  properties: {
    kind: { enum: ["intent", "answer", "tool", "document", "expert"] },
    reference: STRING,
  },
  required: ["kind", "reference"],
  additionalProperties: false,
} as const;
const BRIEF_ITEM_KINDS = [
  "objective",
  "primary-user",
  "mission-scenario",
  "operating-environment",
  "success-criterion",
  "constraint",
  "exclusion",
  "intended-market",
  "manufacturing-jurisdiction",
  "operating-jurisdiction",
  "compliance-target",
  "verification-activity",
  "manufacturing-evidence",
  "observed-fact",
  "assumption",
  "open-question",
  "proposed-decision",
] as const;

export interface ProjectBriefToolDependencies {
  readonly projects: Pick<
    EngineeringProjectRevisionStore,
    "get" | "getRevision"
  >;
  readonly commands: ProjectBriefCommandService;
}

/** Conversation-first project framing. No separate Discovery aggregate exists. */
export function registerProjectBriefTools(
  app: McpApp,
  dependencies: ProjectBriefToolDependencies,
): void {
  app.registerTool(projectStartTool, async (args, context) => {
    const snapshot = await dependencies.commands.startProject(agentOrigin(context), {
      commandId: requiredString(args.commandId, "commandId"),
      projectId: requiredString(args.projectId, "projectId"),
      projectName: requiredString(args.projectName, "projectName"),
      issuedAt: isoDateTime(args.issuedAt, "issuedAt"),
      intent: requiredString(args.intent, "intent"),
      intentSource: intentSource(args.intentSource),
    });
    return projectResult(
      `Project ${snapshot.project.id} now exists at revision 1 in framing. No technical model or evidence was created.`,
      snapshot,
    );
  });

  app.registerTool(projectQuestionProposeTool, async (args, context) => {
    const question = questionInput(args.question);
    const snapshot = await dependencies.commands.proposeQuestion(
      agentOrigin(context),
      { ...commonMutation(args), question },
    );
    return projectResult(
      `Question ${question.id} was added to project framing at revision ${snapshot.revision}; it is guidance, not a requirement.`,
      snapshot,
    );
  });

  app.registerTool(projectAnswerRecordTool, async (args, context) => {
    const answer = answerInput(args.answer);
    const snapshot = await dependencies.commands.recordAnswer(
      agentOrigin(context),
      { ...commonMutation(args), answer },
    );
    return projectResult(
      `Sourced answer ${answer.id} was recorded in project framing at revision ${snapshot.revision}.`,
      snapshot,
    );
  });

  app.registerTool(projectBriefProposeTool, async (args, context) => {
    const items = briefItems(args.items);
    const snapshot = await dependencies.commands.proposeBrief(
      agentOrigin(context),
      { ...commonMutation(args), items },
    );
    return projectResult(
      `A sourced project brief revision is awaiting human review at project revision ${snapshot.revision}. It is intent and planning context, not technical or certification evidence.`,
      snapshot,
    );
  });

  app.registerTool(projectBriefConfirmTool, async (args, context) => {
    const common = commonMutation(args);
    const briefSnapshotId = requiredString(
      args.briefSnapshotId,
      "briefSnapshotId",
    );
    const briefRevision = positiveInteger(args.briefRevision, "briefRevision");
    const inputFingerprint = fingerprintInput(
      args.inputFingerprint,
      "inputFingerprint",
    );
    const current = await requiredPendingBrief(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
      briefSnapshotId,
      briefRevision,
      inputFingerprint,
    );
    const confirmation = briefConfirmationResponse(context);
    if (confirmation === undefined) return briefConfirmationRequest(current);
    if (!confirmation) {
      return projectResult(
        "The brief was not confirmed. Project truth did not change; continue refining it in the paired conversation.",
        current,
      );
    }
    // Blank-only rationale (e.g. "   ") is explicitly treated as absent and
    // falls back to the generic host-confirmation message. When non-blank, the
    // raw string is preserved verbatim in the approval record — no trimming.
    const rationale = typeof args.rationale === "string" && args.rationale.trim()
      ? args.rationale
      : "The paired MCP host returned an accepted confirmation response.";
    const snapshot = await dependencies.commands.approveBrief(
      elicitedHumanOrigin(context),
      {
        ...common,
        briefSnapshotId,
        briefRevision,
        inputFingerprint,
        rationale,
      },
    );
    return projectResult(
      `The exact brief revision is now the canonical project intent at project revision ${snapshot.revision}. No technical evidence was created.`,
      snapshot,
    );
  });
}

const projectStartTool: MCPTool = {
  name: "project_start",
  description:
    "Create the engineering project immediately from a person's plain-language intent. The project begins in framing; this does not create SysML, CAD, simulation, proof or certification evidence.",
  inputSchema: {
    type: "object",
    properties: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      projectName: STRING,
      issuedAt: ISSUED_AT,
      intent: STRING,
      intentSource: {
        type: "object",
        properties: {
          kind: { enum: ["human", "document"] },
          reference: STRING,
        },
        required: ["kind", "reference"],
        additionalProperties: false,
      },
    },
    required: [
      "commandId",
      "projectId",
      "projectName",
      "issuedAt",
      "intent",
      "intentSource",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT,
  annotations: MUTATION,
};

const projectQuestionProposeTool: MCPTool = {
  name: "project_question_propose",
  description:
    "Add one adaptive, plain-language framing question with a recommendation, bounded alternatives, consequences, uncertainty path, risk and needed evidence.",
  inputSchema: mutationSchema({
    question: {
      type: "object",
      properties: {
        id: STRING,
        prompt: STRING,
        whyItMatters: STRING,
        recommendation: {
          type: "object",
          properties: {
            value: STRING,
            rationale: STRING,
            confidence: { enum: ["low", "medium", "high"] },
          },
          required: ["value", "rationale", "confidence"],
          additionalProperties: false,
        },
        options: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              value: STRING,
              label: STRING,
              consequences: STRING,
            },
            required: ["value", "label", "consequences"],
            additionalProperties: false,
          },
        },
        allowUnknown: { type: "boolean" },
        risk: {
          enum: ["reversible", "material", "safety-critical", "regulatory"],
        },
        evidenceNeeded: { type: "array", items: STRING },
      },
      required: [
        "id",
        "prompt",
        "whyItMatters",
        "recommendation",
        "options",
        "allowUnknown",
        "risk",
        "evidenceNeeded",
      ],
      additionalProperties: false,
    },
  }, ["question"]),
  outputSchema: OBJECT_OUTPUT,
  annotations: MUTATION,
};

const projectAnswerRecordTool: MCPTool = {
  name: "project_answer_record",
  description:
    "Record a sourced answer from the paired conversation or an identified source. Unknown remains first-class and no answer is promoted to observed engineering fact.",
  inputSchema: mutationSchema({
    answer: {
      type: "object",
      properties: {
        id: STRING,
        questionId: STRING,
        kind: { enum: ["provided", "unknown"] },
        value: STRING,
        explanation: STRING,
        source: {
          type: "object",
          properties: {
            kind: { enum: ["human", "tool", "document", "expert"] },
            reference: STRING,
          },
          required: ["kind", "reference"],
          additionalProperties: false,
        },
        supersedesAnswerId: STRING,
      },
      required: ["id", "questionId", "kind", "source"],
      additionalProperties: false,
    },
  }, ["answer"]),
  outputSchema: OBJECT_OUTPUT,
  annotations: MUTATION,
};

const projectBriefProposeTool: MCPTool = {
  name: "project_brief_propose",
  description:
    "Propose a new immutable revision of the living project brief. Every item has a stable semantic kind and source; observed facts require external evidence and assumptions require an owner and review trigger. The proposal never replaces the canonical brief without exact human confirmation.",
  inputSchema: mutationSchema({
    items: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        properties: {
          id: STRING,
          kind: { enum: BRIEF_ITEM_KINDS },
          statement: STRING,
          sourceRefs: { type: "array", minItems: 1, items: SOURCE },
          owner: STRING,
          reviewTrigger: STRING,
        },
        required: ["id", "kind", "statement", "sourceRefs"],
        additionalProperties: false,
      },
    },
  }, ["items"]),
  outputSchema: OBJECT_OUTPUT,
  annotations: MUTATION,
};

const projectBriefConfirmTool: MCPTool = {
  name: "project_brief_confirm",
  description:
    "Ask the paired MCP host to present the exact pending brief. Only a verified signed retry carrying an accepted human confirmation can promote it to canonical project intent.",
  inputSchema: mutationSchema({
    briefSnapshotId: STRING,
    briefRevision: { type: "integer", minimum: 1 },
    inputFingerprint: FINGERPRINT,
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "Optional verbatim record of why this brief reflects the paired conversation. Stored verbatim (including leading/trailing whitespace) in the approval record. Absent or blank-only values (all whitespace) are treated identically and fall back to a generic host-confirmation message.",
    },
  }, ["briefSnapshotId", "briefRevision", "inputFingerprint"]),
  outputSchema: OBJECT_OUTPUT,
  annotations: MUTATION,
};

function mutationSchema(
  properties: Record<string, unknown>,
  required: readonly string[],
) {
  return {
    type: "object",
    properties: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: EXPECTED_REVISION,
      issuedAt: ISSUED_AT,
      ...properties,
    },
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

function commonMutation(args: Record<string, unknown>): ProjectBriefMutationCommand {
  return {
    commandId: requiredString(args.commandId, "commandId"),
    projectId: requiredString(args.projectId, "projectId"),
    expectedRevision: positiveInteger(args.expectedRevision, "expectedRevision"),
    issuedAt: isoDateTime(args.issuedAt, "issuedAt"),
  };
}

function intentSource(value: unknown) {
  const source = exactRecord(value, "intentSource");
  exactKeys(source, ["kind", "reference"], [], "intentSource");
  return {
    kind: oneOf(source.kind, ["human", "document"] as const, "intentSource.kind"),
    reference: requiredString(source.reference, "intentSource.reference"),
  };
}

function questionInput(value: unknown): ProjectQuestionProposalInput {
  const input = exactRecord(value, "question");
  exactKeys(
    input,
    [
      "id",
      "prompt",
      "whyItMatters",
      "recommendation",
      "options",
      "allowUnknown",
      "risk",
      "evidenceNeeded",
    ],
    [],
    "question",
  );
  const recommendation = exactRecord(input.recommendation, "question.recommendation");
  exactKeys(
    recommendation,
    ["value", "rationale", "confidence"],
    [],
    "question.recommendation",
  );
  if (!Array.isArray(input.options) || input.options.length === 0) {
    throw new TypeError("question.options must be a non-empty array");
  }
  return {
    id: requiredString(input.id, "question.id"),
    prompt: requiredString(input.prompt, "question.prompt"),
    whyItMatters: requiredString(input.whyItMatters, "question.whyItMatters"),
    recommendation: {
      value: requiredString(recommendation.value, "question.recommendation.value"),
      rationale: requiredString(
        recommendation.rationale,
        "question.recommendation.rationale",
      ),
      confidence: oneOf(
        recommendation.confidence,
        ["low", "medium", "high"] as const,
        "question.recommendation.confidence",
      ),
    },
    options: input.options.map((value, index) => {
      const option = exactRecord(value, `question.options[${index}]`);
      exactKeys(
        option,
        ["value", "label", "consequences"],
        [],
        `question.options[${index}]`,
      );
      return {
        value: requiredString(option.value, `question.options[${index}].value`),
        label: requiredString(option.label, `question.options[${index}].label`),
        consequences: requiredString(
          option.consequences,
          `question.options[${index}].consequences`,
        ),
      };
    }),
    allowUnknown: requiredBoolean(input.allowUnknown, "question.allowUnknown"),
    risk: oneOf(
      input.risk,
      ["reversible", "material", "safety-critical", "regulatory"] as const,
      "question.risk",
    ),
    evidenceNeeded: stringList(input.evidenceNeeded, "question.evidenceNeeded"),
  };
}

function answerInput(value: unknown): ProjectAnswerInput {
  const input = exactRecord(value, "answer");
  exactKeys(
    input,
    ["id", "questionId", "kind", "source"],
    ["value", "explanation", "supersedesAnswerId"],
    "answer",
  );
  const source = exactRecord(input.source, "answer.source");
  exactKeys(source, ["kind", "reference"], [], "answer.source");
  const kind = oneOf(input.kind, ["provided", "unknown"] as const, "answer.kind");
  const result: Mutable<ProjectAnswerInput> = {
    id: requiredString(input.id, "answer.id"),
    questionId: requiredString(input.questionId, "answer.questionId"),
    kind,
    source: {
      kind: oneOf(
        source.kind,
        ["human", "tool", "document", "expert"] as const,
        "answer.source.kind",
      ),
      reference: requiredString(source.reference, "answer.source.reference"),
    },
  };
  if (kind === "provided") result.value = requiredString(input.value, "answer.value");
  else if (input.value !== undefined) {
    throw new TypeError("answer.value must be absent for an unknown answer");
  }
  if (input.explanation !== undefined) {
    result.explanation = requiredString(input.explanation, "answer.explanation");
  }
  if (input.supersedesAnswerId !== undefined) {
    result.supersedesAnswerId = requiredString(
      input.supersedesAnswerId,
      "answer.supersedesAnswerId",
    );
  }
  return result;
}

function briefItems(value: unknown): ProjectBriefItem[] {
  if (!Array.isArray(value)) throw new TypeError("items must be an array");
  return value.map((value, index) => {
    const path = `items[${index}]`;
    const input = exactRecord(value, path);
    exactKeys(
      input,
      ["id", "kind", "statement", "sourceRefs"],
      ["owner", "reviewTrigger"],
      path,
    );
    if (!Array.isArray(input.sourceRefs)) {
      throw new TypeError(`${path}.sourceRefs must be an array`);
    }
    const item: Mutable<ProjectBriefItem> = {
      id: requiredString(input.id, `${path}.id`),
      kind: oneOf(input.kind, BRIEF_ITEM_KINDS, `${path}.kind`),
      statement: requiredString(input.statement, `${path}.statement`),
      sourceRefs: input.sourceRefs.map((value, sourceIndex) => {
        const source = exactRecord(value, `${path}.sourceRefs[${sourceIndex}]`);
        exactKeys(
          source,
          ["kind", "reference"],
          [],
          `${path}.sourceRefs[${sourceIndex}]`,
        );
        return {
          kind: oneOf(
            source.kind,
            ["intent", "answer", "tool", "document", "expert"] as const,
            `${path}.sourceRefs[${sourceIndex}].kind`,
          ) as ProjectBriefSourceKind,
          reference: requiredString(
            source.reference,
            `${path}.sourceRefs[${sourceIndex}].reference`,
          ),
        };
      }),
    };
    if (input.owner !== undefined) {
      item.owner = requiredString(input.owner, `${path}.owner`);
    }
    if (input.reviewTrigger !== undefined) {
      item.reviewTrigger = requiredString(input.reviewTrigger, `${path}.reviewTrigger`);
    }
    return item;
  });
}

async function requiredPendingBrief(
  projects: ProjectBriefToolDependencies["projects"],
  projectId: string,
  expectedRevision: number,
  briefSnapshotId: string,
  briefRevision: number,
  inputFingerprint: ContentFingerprint,
): Promise<EngineeringProjectSnapshot> {
  const project = await projects.get(projectId);
  if (!project || project.revision !== expectedRevision) {
    throw new TypeError(
      `Engineering project ${projectId} is not readable at revision ${expectedRevision}.`,
    );
  }
  const brief = project.framing?.proposedBrief;
  const review = project.framing?.proposalReview;
  if (
    !brief || !review || review.status !== "pending" ||
    brief.id !== briefSnapshotId || brief.revision !== briefRevision ||
    !fingerprintsEqual(review.inputFingerprint, inputFingerprint)
  ) {
    throw new TypeError(
      `Brief ${briefSnapshotId}@${briefRevision} is not the exact pending project brief.`,
    );
  }
  return project;
}

function briefConfirmationRequest(project: EngineeringProjectSnapshot) {
  const brief = project.framing!.proposedBrief!;
  const objective = brief.items.find((item) => item.kind === "objective")!.statement;
  return {
    resultType: "input_required",
    inputRequests: {
      brief_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `The agent consolidated this project brief: “${objective}”. Confirm this exact framing, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: "Confirm this project brief",
                description:
                  "I confirm that this brief reflects the project framing agreed in the conversation.",
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function briefConfirmationResponse(context?: ToolHandlerContext): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Brief confirmation requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.brief_confirmation,
    "inputResponses.brief_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.brief_confirmation",
  );
  const action = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.brief_confirmation.action",
  );
  if (action !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.brief_confirmation.content",
  );
  exactKeys(content, ["confirmed"], [], "inputResponses.brief_confirmation.content");
  return requiredBoolean(
    content.confirmed,
    "inputResponses.brief_confirmation.content.confirmed",
  );
}

function agentOrigin(context?: ToolHandlerContext) {
  const subject = context?.authInfo?.subject?.trim();
  if (subject) return { kind: "agent" as const, actorId: subject };
  const name = context?.clientInfo?.name?.trim();
  const version = context?.clientInfo?.version?.trim();
  return {
    kind: "agent" as const,
    actorId: name
      ? `mcp:${name}${version ? `@${version}` : ""}`
      : "mcp:unidentified-client",
  };
}

function elicitedHumanOrigin(context?: ToolHandlerContext) {
  const subject = context?.authInfo?.subject?.trim();
  const name = context?.clientInfo?.name?.trim();
  const version = context?.clientInfo?.version?.trim();
  const channel = subject ||
    (name ? `${name}${version ? `@${version}` : ""}` : "client");
  return { kind: "human" as const, actorId: `mcp-elicitation:${channel}` };
}

function projectResult(content: string, snapshot: EngineeringProjectSnapshot) {
  return {
    content,
    structuredContent: snapshot as unknown as Record<string, unknown>,
  };
}

function fingerprintInput(value: unknown, name: string): ContentFingerprint {
  const input = exactRecord(value, name);
  exactKeys(input, ["algorithm", "digest"], [], name);
  if (input.algorithm !== "sha256") {
    throw new TypeError(`${name}.algorithm must be sha256`);
  }
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) {
    throw new TypeError(`${name}.digest must be 64 lowercase hex characters`);
  }
  return { algorithm: "sha256", digest: input.digest };
}

function exactRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(input).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(`${name} has unsupported field(s): ${extras.join(", ")}`);
  }
  const missing = required.filter((key) => !(key in input));
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing field(s): ${missing.join(", ")}`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function isoDateTime(value: unknown, name: string): string {
  const input = requiredString(value, name);
  if (!Number.isFinite(Date.parse(input))) {
    throw new TypeError(`${name} must be an ISO date-time`);
  }
  return new Date(Date.parse(input)).toISOString();
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new TypeError(`${name} must be one of ${choices.join(", ")}`);
  }
  return value as T[number];
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
