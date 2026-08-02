import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type {
  ProjectDiscoveryAnswerInput,
  ProjectDiscoveryBriefInput,
  ProjectDiscoveryCommandService,
  ProjectDiscoveryQuestionProposalInput,
} from "../domain/project-discovery-command-service.ts";
import type { ProjectDiscoverySnapshot } from "../domain/project-discovery.ts";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const IDEMPOTENT_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const OBJECT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const;

const COMMAND_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description:
    "Stable command id. Reuse it verbatim with identical arguments when retrying an uncertain call.",
} as const;

const DISCOVERY_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description: "Stable discovery identity; this is not yet an engineering project id.",
} as const;

const EXPECTED_REVISION = {
  type: "integer",
  minimum: 1,
  description: "Optimistic ProjectDiscovery revision from project_discovery_snapshot.",
} as const;

const ISSUED_AT = {
  type: "string",
  description:
    "Stable ISO timestamp for this command. Preserve it with commandId on retry.",
} as const;

const COMMON_MUTATION_PROPERTIES = {
  commandId: COMMAND_ID,
  discoveryId: DISCOVERY_ID,
  expectedRevision: EXPECTED_REVISION,
  issuedAt: ISSUED_AT,
} as const;

const STRING_LIST = {
  type: "array",
  items: { type: "string", minLength: 1 },
} as const;

export interface ProjectDiscoverySnapshotReader {
  get(discoveryId: string): Promise<ProjectDiscoverySnapshot | undefined>;
  getRevision(
    discoveryId: string,
    revision: number,
  ): Promise<ProjectDiscoverySnapshot | undefined>;
}

export interface ProjectDiscoveryToolDependencies {
  discoveries: ProjectDiscoverySnapshotReader;
  commands: ProjectDiscoveryCommandService;
}

/** Register agent-authoring discovery tools. Human brief review is not MCP-exposed. */
export function registerProjectDiscoveryTools(
  app: McpApp,
  dependencies: ProjectDiscoveryToolDependencies,
): void {
  app.registerTool(projectDiscoverySnapshotTool, async (args) => {
    const discoveryId = requiredString(args.discoveryId, "discoveryId");
    const snapshot = await requiredDiscovery(dependencies.discoveries, discoveryId);
    return discoveryResult(
      `Project discovery ${discoveryId} is ${snapshot.status} at revision ${snapshot.revision}.`,
      snapshot,
    );
  });

  app.registerTool(projectDiscoveryStartTool, async (args, context) => {
    const discoveryId = requiredString(args.discoveryId, "discoveryId");
    const snapshot = await dependencies.commands.start(agentOrigin(context), {
      commandId: requiredString(args.commandId, "commandId"),
      discoveryId,
      issuedAt: isoDateTime(args.issuedAt, "issuedAt"),
      intent: requiredString(args.intent, "intent"),
    });
    return discoveryResult(
      `Discovery ${discoveryId} started from plain-language intent at revision ${snapshot.revision}; no EngineeringProject or ThreadSnapshot was created.`,
      snapshot,
    );
  });

  app.registerTool(projectDiscoveryQuestionProposeTool, async (args, context) => {
    const common = commonMutation(args);
    const question = questionInput(args.question);
    const snapshot = await dependencies.commands.proposeQuestion(
      agentOrigin(context),
      { ...common, question },
    );
    return discoveryResult(
      `Guided question ${question.id} was prepared at discovery revision ${snapshot.revision}. It is not an approved requirement.`,
      snapshot,
    );
  });

  app.registerTool(projectDiscoveryAnswerRecordTool, async (args, context) => {
    const common = commonMutation(args);
    const answer = answerInput(args.answer);
    const snapshot = await dependencies.commands.recordAnswer(
      agentOrigin(context),
      { ...common, answer },
    );
    return discoveryResult(
      `Sourced ${answer.kind} answer ${answer.id} was recorded at discovery revision ${snapshot.revision}.`,
      snapshot,
    );
  });

  app.registerTool(projectDiscoveryBriefProposeTool, async (args, context) => {
    const common = commonMutation(args);
    const brief = briefInput(args.brief);
    const snapshot = await dependencies.commands.proposeBrief(
      agentOrigin(context),
      { ...common, brief },
    );
    return discoveryResult(
      `Brief ${brief.id} is awaiting human review at discovery revision ${snapshot.revision}. Compliance targets are planning context, not legal advice or certification evidence.`,
      snapshot,
    );
  });
}

const projectDiscoverySnapshotTool: MCPTool = {
  name: "project_discovery_snapshot",
  description:
    "Read one durable pre-project discovery: plain-language intent, guided questions, sourced answers, proposed brief, review status, and immutable receipts. It contains no technical ThreadSnapshot evidence.",
  inputSchema: {
    type: "object",
    properties: { discoveryId: DISCOVERY_ID },
    required: ["discoveryId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectDiscoveryStartTool: MCPTool = {
  name: "project_discovery_start",
  description:
    "Start an immutable discovery from a person's plain-language industrial product intent. This creates neither an approved project nor technical evidence.",
  inputSchema: {
    type: "object",
    properties: {
      commandId: COMMAND_ID,
      discoveryId: DISCOVERY_ID,
      issuedAt: ISSUED_AT,
      intent: { type: "string", minLength: 1 },
    },
    required: ["commandId", "discoveryId", "issuedAt", "intent"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: IDEMPOTENT_MUTATION_ANNOTATIONS,
};

const projectDiscoveryQuestionProposeTool: MCPTool = {
  name: "project_discovery_question_propose",
  description:
    "Prepare one adaptive, plain-language question with recommendation, bounded consequences, an explicit unknown path, risk and needed evidence. The question is not an approved requirement.",
  inputSchema: mutationSchema({
    question: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        prompt: { type: "string", minLength: 1 },
        whyItMatters: { type: "string", minLength: 1 },
        recommendation: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 1 },
            rationale: { type: "string", minLength: 1 },
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
              value: { type: "string", minLength: 1 },
              label: { type: "string", minLength: 1 },
              consequences: { type: "string", minLength: 1 },
            },
            required: ["value", "label", "consequences"],
            additionalProperties: false,
          },
        },
        allowUnknown: { type: "boolean" },
        risk: {
          enum: ["reversible", "material", "safety-critical", "regulatory"],
        },
        evidenceNeeded: STRING_LIST,
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
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: IDEMPOTENT_MUTATION_ANNOTATIONS,
};

const projectDiscoveryAnswerRecordTool: MCPTool = {
  name: "project_discovery_answer_record",
  description:
    "Record a person's or identified source's reported answer to a guided question. Unknown is first-class. The MCP caller remains recorded as agent and cannot disguise the answer source.",
  inputSchema: {
    ...mutationSchema({
      answer: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          questionId: { type: "string", minLength: 1 },
          kind: { enum: ["provided", "unknown"] },
          value: { type: "string", minLength: 1 },
          explanation: { type: "string", minLength: 1 },
          source: {
            type: "object",
            properties: {
              kind: { enum: ["human", "tool", "document", "expert"] },
              reference: { type: "string", minLength: 1 },
            },
            required: ["kind", "reference"],
            additionalProperties: false,
          },
          supersedesAnswerId: { type: "string", minLength: 1 },
        },
        required: ["id", "questionId", "kind", "source"],
        additionalProperties: false,
      },
    }, ["answer"]),
    oneOf: [
      {
        properties: {
          answer: {
            properties: { kind: { const: "provided" } },
            required: ["kind", "value"],
          },
        },
      },
      {
        properties: {
          answer: {
            properties: { kind: { const: "unknown" } },
            required: ["kind"],
            not: { required: ["value"] },
          },
        },
      },
    ],
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: IDEMPOTENT_MUTATION_ANNOTATIONS,
};

const projectDiscoveryBriefProposeTool: MCPTool = {
  name: "project_discovery_brief_propose",
  description:
    "Propose a reviewable project brief from discovery truth, including missions, measurable success, markets, manufacturing/operating jurisdictions, compliance targets and verification plan. Never claim legal advice, standards access, certification or approval.",
  inputSchema: mutationSchema({
    brief: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        missionScenarios: { ...STRING_LIST, minItems: 1 },
        successCriteria: { ...STRING_LIST, minItems: 1 },
        constraints: STRING_LIST,
        intendedMarkets: STRING_LIST,
        manufacturingJurisdictions: STRING_LIST,
        operatingJurisdictions: STRING_LIST,
        complianceTargets: STRING_LIST,
        verificationPlan: STRING_LIST,
        exclusions: STRING_LIST,
        assumptions: STRING_LIST,
        openQuestions: STRING_LIST,
      },
      required: [
        "id",
        "objective",
        "missionScenarios",
        "successCriteria",
        "constraints",
        "intendedMarkets",
        "manufacturingJurisdictions",
        "operatingJurisdictions",
        "complianceTargets",
        "verificationPlan",
        "exclusions",
        "assumptions",
        "openQuestions",
      ],
      additionalProperties: false,
    },
  }, ["brief"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: IDEMPOTENT_MUTATION_ANNOTATIONS,
};

function mutationSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...COMMON_MUTATION_PROPERTIES, ...properties },
    required: [
      "commandId",
      "discoveryId",
      "expectedRevision",
      "issuedAt",
      ...required,
    ],
    additionalProperties: false,
  };
}

function commonMutation(args: Record<string, unknown>) {
  return {
    commandId: requiredString(args.commandId, "commandId"),
    discoveryId: requiredString(args.discoveryId, "discoveryId"),
    expectedRevision: positiveInteger(args.expectedRevision, "expectedRevision"),
    issuedAt: isoDateTime(args.issuedAt, "issuedAt"),
  };
}

function questionInput(value: unknown): ProjectDiscoveryQuestionProposalInput {
  const record = exactRecord(value, "question");
  exactKeys(
    record,
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
  const recommendation = exactRecord(
    record.recommendation,
    "question.recommendation",
  );
  exactKeys(
    recommendation,
    ["value", "rationale", "confidence"],
    [],
    "question.recommendation",
  );
  if (!Array.isArray(record.options) || record.options.length === 0) {
    throw new TypeError("question.options must be a non-empty array");
  }
  return {
    id: requiredString(record.id, "question.id"),
    prompt: requiredString(record.prompt, "question.prompt"),
    whyItMatters: requiredString(record.whyItMatters, "question.whyItMatters"),
    recommendation: {
      value: requiredString(
        recommendation.value,
        "question.recommendation.value",
      ),
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
    options: record.options.map((item, index) => {
      const path = `question.options[${index}]`;
      const option = exactRecord(item, path);
      exactKeys(option, ["value", "label", "consequences"], [], path);
      return {
        value: requiredString(option.value, `${path}.value`),
        label: requiredString(option.label, `${path}.label`),
        consequences: requiredString(
          option.consequences,
          `${path}.consequences`,
        ),
      };
    }),
    allowUnknown: requiredBoolean(record.allowUnknown, "question.allowUnknown"),
    risk: oneOf(
      record.risk,
      ["reversible", "material", "safety-critical", "regulatory"] as const,
      "question.risk",
    ),
    evidenceNeeded: stringList(
      record.evidenceNeeded,
      "question.evidenceNeeded",
    ),
  };
}

function answerInput(value: unknown): ProjectDiscoveryAnswerInput {
  const record = exactRecord(value, "answer");
  exactKeys(
    record,
    ["id", "questionId", "kind", "source"],
    ["value", "explanation", "supersedesAnswerId"],
    "answer",
  );
  const kind = oneOf(
    record.kind,
    ["provided", "unknown"] as const,
    "answer.kind",
  );
  const source = exactRecord(record.source, "answer.source");
  exactKeys(source, ["kind", "reference"], [], "answer.source");
  const result: Mutable<ProjectDiscoveryAnswerInput> = {
    id: requiredString(record.id, "answer.id"),
    questionId: requiredString(record.questionId, "answer.questionId"),
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
  if (kind === "provided") {
    result.value = requiredString(record.value, "answer.value");
  } else if (record.value !== undefined) {
    throw new TypeError("answer.value must be absent for an unknown answer");
  }
  if (record.explanation !== undefined) {
    result.explanation = requiredString(record.explanation, "answer.explanation");
  }
  if (record.supersedesAnswerId !== undefined) {
    result.supersedesAnswerId = requiredString(
      record.supersedesAnswerId,
      "answer.supersedesAnswerId",
    );
  }
  return result;
}

function briefInput(value: unknown): ProjectDiscoveryBriefInput {
  const record = exactRecord(value, "brief");
  const fields = [
    "id",
    "objective",
    "missionScenarios",
    "successCriteria",
    "constraints",
    "intendedMarkets",
    "manufacturingJurisdictions",
    "operatingJurisdictions",
    "complianceTargets",
    "verificationPlan",
    "exclusions",
    "assumptions",
    "openQuestions",
  ] as const;
  exactKeys(record, fields, [], "brief");
  const result = {
    id: requiredString(record.id, "brief.id"),
    objective: requiredString(record.objective, "brief.objective"),
    missionScenarios: stringList(
      record.missionScenarios,
      "brief.missionScenarios",
      true,
    ),
    successCriteria: stringList(
      record.successCriteria,
      "brief.successCriteria",
      true,
    ),
    constraints: stringList(record.constraints, "brief.constraints"),
    intendedMarkets: stringList(
      record.intendedMarkets,
      "brief.intendedMarkets",
    ),
    manufacturingJurisdictions: stringList(
      record.manufacturingJurisdictions,
      "brief.manufacturingJurisdictions",
    ),
    operatingJurisdictions: stringList(
      record.operatingJurisdictions,
      "brief.operatingJurisdictions",
    ),
    complianceTargets: stringList(
      record.complianceTargets,
      "brief.complianceTargets",
    ),
    verificationPlan: stringList(
      record.verificationPlan,
      "brief.verificationPlan",
    ),
    exclusions: stringList(record.exclusions, "brief.exclusions"),
    assumptions: stringList(record.assumptions, "brief.assumptions"),
    openQuestions: stringList(record.openQuestions, "brief.openQuestions"),
  };
  return result;
}

async function requiredDiscovery(
  store: ProjectDiscoverySnapshotReader,
  discoveryId: string,
): Promise<ProjectDiscoverySnapshot> {
  const snapshot = await store.get(discoveryId);
  if (!snapshot) throw new TypeError(`Project discovery not found: ${discoveryId}.`);
  return snapshot;
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

function discoveryResult(content: string, snapshot: ProjectDiscoverySnapshot) {
  return {
    content,
    structuredContent: snapshot as unknown as Record<string, unknown>,
  };
}

function exactRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(`${name} has unsupported field(s): ${extras.join(", ")}`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing field(s): ${missing.join(", ")}`);
  }
}

function stringList(
  value: unknown,
  name: string,
  requireNonEmpty = false,
): string[] {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0)) {
    throw new TypeError(
      `${name} must be ${requireNonEmpty ? "a non-empty" : "an"} array`,
    );
  }
  return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
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
  const result = requiredString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(result) || !Number.isFinite(Date.parse(result))
  ) throw new TypeError(`${name} must be an ISO date-time`);
  return new Date(Date.parse(result)).toISOString();
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
