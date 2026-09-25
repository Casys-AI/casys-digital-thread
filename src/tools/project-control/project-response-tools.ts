/**
 * Read-only MCP surface for the server-owned project-response index.
 *
 * Default payload is a bounded canonical summary. Named item detail and
 * full evidence require the exact expected basis. Workbench keeps the full
 * internal result through ProjectResponseUseCase.project.
 */

import type { McpApp, MCPTool } from "@casys/mcp-platform";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  PROJECT_BRIEF_ITEM_KINDS,
  PROJECT_BRIEF_SOURCE_KINDS,
  type ProjectBriefItemKind,
} from "../../domain/project/project-brief.ts";
import type {
  ProjectResponseItem,
  ProjectResponseReadModel,
  ProjectResponseReadQuery,
  ProjectResponseUseCase,
} from "../../application/ports/in/project-response/project-response.ts";
import {
  parseProjectResponseBasis,
  PROJECT_RESPONSE_SCHEMA,
} from "../../application/ports/in/project-response/project-response.ts";
import { DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX } from "../../domain/record/documentary-clause-response.ts";
import { AGENT_RESOURCE_REFERENCE_SCHEMA } from "../../domain/resource/agent-resource-reference.ts";
import { PROJECT_ID, READ_ONLY_ANNOTATIONS } from "./mcp-tool-schemas.ts";

export interface ProjectResponseToolDependencies {
  readonly projectResponse?: ProjectResponseUseCase;
}

export const PROJECT_RESPONSE_SUMMARY_MAX_BYTES = 8192;

export const PROJECT_RESPONSE_TOOL_NAME = "project_response_read" as const;

const ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;

const CORRESPONDENCE = [
  "native",
  "documentary",
  "unresolved",
  "TRACE GAP",
] as const;

const ORIGIN = ["native", "documentary"] as const;

const APPLICABILITY = ["current", "historical", "unresolved"] as const;

const EVALUATION_STATUS = ["pass", "fail", "unresolved", "error"] as const;

const SOURCE_STATE = [
  "unchanged",
  "changed",
  "removed",
  "brief-unavailable",
] as const;

const CURRENT_CLAUSE_RESPONSE_SOURCE_STATE = [
  "unchanged",
  "changed",
  "brief-unavailable",
] as const;

const FRESHNESS_STATUS = ["fresh", "stale", "running", "failed"] as const;

const STRING = { type: "string", minLength: 1 } as const;

const DIAGNOSTIC = {
  type: "object",
  properties: {
    code: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
  },
  required: ["code", "message"],
  additionalProperties: false,
} as const;

const BRIEF_IDENTITY = {
  type: "object",
  properties: {
    briefId: ID,
    snapshotId: ID,
    revision: { type: "integer", minimum: 1 },
  },
  required: ["briefId", "snapshotId", "revision"],
  additionalProperties: false,
} as const;

const THREAD_IDENTITY = {
  type: "object",
  properties: {
    snapshotId: ID,
    revision: { type: "integer", minimum: 1 },
    subjectId: ID,
  },
  required: ["snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const BASIS = {
  type: "object",
  properties: {
    projectId: PROJECT_ID,
    projectRevision: { type: "integer", minimum: 1 },
    brief: BRIEF_IDENTITY,
    thread: THREAD_IDENTITY,
  },
  required: ["projectId", "projectRevision", "brief"],
  additionalProperties: false,
} as const;

const COUNTS = {
  type: "object",
  properties: {
    items: { type: "integer", minimum: 0 },
    included: { type: "integer", minimum: 0 },
    omitted: { type: "integer", minimum: 0 },
    gaps: { type: "integer", minimum: 0 },
    diagnostics: { type: "integer", minimum: 0 },
    diagnosticsIncluded: { type: "integer", minimum: 0 },
    diagnosticsOmitted: { type: "integer", minimum: 0 },
    removedClauseResponseCount: { type: "integer", minimum: 0 },
    byKind: {
      type: "object",
      additionalProperties: { type: "integer", minimum: 0 },
    },
    byCorrespondence: {
      type: "object",
      additionalProperties: { type: "integer", minimum: 0 },
    },
  },
  required: [
    "items",
    "included",
    "omitted",
    "gaps",
    "diagnostics",
    "diagnosticsIncluded",
    "diagnosticsOmitted",
    "removedClauseResponseCount",
    "byKind",
    "byCorrespondence",
  ],
  additionalProperties: false,
} as const;

const OMISSION = {
  type: "object",
  properties: {
    declared: { const: true },
    omittedItemCount: { type: "integer", minimum: 1 },
    afterItemId: ID,
    retrieval: {
      type: "object",
      properties: {
        tool: { const: PROJECT_RESPONSE_TOOL_NAME },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            expectedBasis: BASIS,
            afterItemId: ID,
            evidence: { enum: ["summary", "full-evidence"] },
          },
          required: [
            "projectId",
            "expectedBasis",
            "afterItemId",
            "evidence",
          ],
          additionalProperties: false,
        },
      },
      required: ["tool", "arguments"],
      additionalProperties: false,
    },
  },
  required: ["declared", "omittedItemCount", "afterItemId", "retrieval"],
  additionalProperties: false,
} as const;

const DIAGNOSTIC_OMISSION = {
  type: "object",
  properties: {
    declared: { const: true },
    omittedDiagnosticCount: { type: "integer", minimum: 1 },
    retrieval: {
      type: "object",
      properties: {
        tool: { const: PROJECT_RESPONSE_TOOL_NAME },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            expectedBasis: BASIS,
            evidence: { const: "full-evidence" },
          },
          required: ["projectId", "expectedBasis", "evidence"],
          additionalProperties: false,
        },
      },
      required: ["tool", "arguments"],
      additionalProperties: false,
    },
  },
  required: ["declared", "omittedDiagnosticCount"],
  additionalProperties: false,
} as const;

const SOURCE_REF = {
  type: "object",
  properties: {
    kind: { type: "string", enum: PROJECT_BRIEF_SOURCE_KINDS },
    reference: STRING,
  },
  required: ["kind", "reference"],
  additionalProperties: false,
} as const;

const VERIFICATION_AUTHORITY = {
  type: "object",
  properties: {
    id: STRING,
    version: STRING,
  },
  required: ["id", "version"],
  additionalProperties: false,
} as const;

const BRIEF_ITEM = {
  type: "object",
  properties: {
    id: ID,
    kind: { type: "string", enum: PROJECT_BRIEF_ITEM_KINDS },
    statement: { type: "string" },
    sourceRefs: { type: "array", items: SOURCE_REF },
    owner: STRING,
    reviewTrigger: STRING,
    dependsOnItemIds: { type: "array", items: ID },
    verificationAuthority: VERIFICATION_AUTHORITY,
  },
  required: ["id", "kind", "statement", "sourceRefs"],
  additionalProperties: false,
} as const;

const FRESHNESS = {
  type: "object",
  properties: {
    status: { type: "string", enum: FRESHNESS_STATUS },
    changedAt: STRING,
    reason: STRING,
    invalidatedByChangeIds: { type: "array", items: { type: "string" } },
  },
  required: ["status", "changedAt", "invalidatedByChangeIds"],
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: { status: { enum: ["stale", "failed"] } },
        required: ["status"],
      },
      then: { required: ["reason"] },
    },
  ],
} as const;

const EVALUATION = {
  type: "object",
  properties: {
    evaluationId: ID,
    status: { type: "string", enum: EVALUATION_STATUS },
    applicability: { type: "string", enum: APPLICABILITY },
    observationIds: { type: "array", items: STRING },
    evidenceArtifactIds: { type: "array", items: STRING },
    evaluatedAt: STRING,
    freshness: FRESHNESS,
  },
  required: [
    "evaluationId",
    "status",
    "applicability",
    "observationIds",
    "evidenceArtifactIds",
    "evaluatedAt",
    "freshness",
  ],
  additionalProperties: false,
} as const;

const REQUIREMENT = {
  type: "object",
  properties: {
    threadRequirementId: ID,
    requirementsArtifactId: ID,
    traceArtifactId: ID,
    origin: { type: "string", enum: ORIGIN },
    sourceBrief: BRIEF_IDENTITY,
    sourceItemId: ID,
    sourceState: { type: "string", enum: SOURCE_STATE },
    applicability: { type: "string", enum: APPLICABILITY },
    evaluations: { type: "array", items: EVALUATION },
  },
  required: [
    "threadRequirementId",
    "requirementsArtifactId",
    "traceArtifactId",
    "origin",
    "sourceBrief",
    "sourceItemId",
    "sourceState",
    "applicability",
    "evaluations",
  ],
  additionalProperties: false,
} as const;

const CLAUSE_SOURCE_REF = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "agent-resource" },
        uri: AGENT_RESOURCE_REFERENCE_SCHEMA.properties.uri,
      },
      required: ["kind", "uri"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "thread-artifact" }, artifactId: ID },
      required: ["kind", "artifactId"],
      additionalProperties: false,
    },
  ],
} as const;

const CLAUSE_RESPONSE = {
  type: "object",
  properties: {
    artifactId: ID,
    revision: { type: "integer", minimum: 1 },
    sourceItemId: ID,
    sourceBrief: BRIEF_IDENTITY,
    sourceState: {
      type: "string",
      enum: CURRENT_CLAUSE_RESPONSE_SOURCE_STATE,
    },
    applicability: { type: "string", enum: APPLICABILITY },
    recordingStatus: { const: "proposal" },
    authorKind: { const: "agent" },
    scope: STRING,
    answer: STRING,
    sourceRefs: {
      type: "array",
      minItems: 1,
      maxItems: DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX,
      items: CLAUSE_SOURCE_REF,
    },
    predecessorArtifactId: ID,
  },
  required: [
    "artifactId",
    "revision",
    "sourceItemId",
    "sourceBrief",
    "sourceState",
    "applicability",
    "recordingStatus",
    "authorKind",
    "scope",
    "answer",
    "sourceRefs",
  ],
  additionalProperties: false,
} as const;

const RESPONSE_ITEM = {
  type: "object",
  properties: {
    item: BRIEF_ITEM,
    correspondence: { type: "string", enum: CORRESPONDENCE },
    requirements: { type: "array", items: REQUIREMENT },
    clauseResponses: { type: "array", items: CLAUSE_RESPONSE },
    gaps: { type: "array", items: DIAGNOSTIC },
  },
  required: ["item", "correspondence", "requirements", "clauseResponses", "gaps"],
  additionalProperties: false,
} as const;

const SUMMARY_ROW = {
  type: "object",
  properties: {
    itemId: ID,
    kind: { type: "string", enum: PROJECT_BRIEF_ITEM_KINDS },
    correspondence: { type: "string", enum: CORRESPONDENCE },
    requirementCount: { type: "integer", minimum: 0 },
    currentEvaluationCount: { type: "integer", minimum: 0 },
    historicalEvaluationCount: { type: "integer", minimum: 0 },
    clauseResponseCount: { type: "integer", minimum: 0 },
    currentClauseResponseCount: { type: "integer", minimum: 0 },
    historicalClauseResponseCount: { type: "integer", minimum: 0 },
    gapCount: { type: "integer", minimum: 0 },
  },
  required: [
    "itemId",
    "kind",
    "correspondence",
    "requirementCount",
    "currentEvaluationCount",
    "historicalEvaluationCount",
    "clauseResponseCount",
    "currentClauseResponseCount",
    "historicalClauseResponseCount",
    "gapCount",
  ],
  additionalProperties: false,
} as const;

const ENVELOPE = {
  schemaVersion: { const: PROJECT_RESPONSE_SCHEMA },
  status: { enum: ["available", "unavailable", "unresolved"] },
  basis: BASIS,
  diagnostics: { type: "array", items: DIAGNOSTIC },
  grants: { const: "none" },
} as const;

const SUMMARY_OUTPUT = {
  type: "object",
  properties: {
    ...ENVELOPE,
    view: { const: "summary" },
    counts: COUNTS,
    items: { type: "array", items: SUMMARY_ROW },
    omission: OMISSION,
    diagnosticOmission: DIAGNOSTIC_OMISSION,
  },
  required: [
    "schemaVersion",
    "status",
    "view",
    "counts",
    "items",
    "diagnostics",
    "grants",
  ],
  additionalProperties: false,
} as const;

const ITEM_OUTPUT = {
  type: "object",
  properties: {
    ...ENVELOPE,
    view: { const: "item" },
    itemId: ID,
    items: { type: "array", maxItems: 1, items: RESPONSE_ITEM },
  },
  required: [
    "schemaVersion",
    "status",
    "view",
    "itemId",
    "items",
    "diagnostics",
    "grants",
  ],
  additionalProperties: false,
} as const;

const FULL_OUTPUT = {
  type: "object",
  properties: {
    ...ENVELOPE,
    view: { const: "full-evidence" },
    counts: COUNTS,
    items: { type: "array", items: RESPONSE_ITEM },
    historicalClauseResponses: {
      type: "array",
      items: {
        ...CLAUSE_RESPONSE,
        properties: {
          ...CLAUSE_RESPONSE.properties,
          sourceState: { const: "removed" },
          applicability: { const: "historical" },
        },
      },
    },
    omission: OMISSION,
  },
  required: [
    "schemaVersion",
    "status",
    "view",
    "counts",
    "items",
    "historicalClauseResponses",
    "diagnostics",
    "grants",
  ],
  additionalProperties: false,
} as const;

const projectResponseReadTool: MCPTool = {
  name: PROJECT_RESPONSE_TOOL_NAME,
  description:
    "Read-only index of every current human-approved brief item against recorded evidence. Default is a bounded canonical summary (≤8KiB) of exact item ids, kinds, independent correspondence, gap counts and a bounded diagnostic prefix; statements, full brief text and solver bytes are omitted. available means the index was readable, never that the response is ready or a clause is satisfied. Named item detail (itemId) and full-evidence require the exact expectedBasis from that summary. Omitted item rows are retrieved with the same expectedBasis and afterItemId. Omitted diagnostic text is declared as diagnosticOmission. An available model retrieves complete diagnostic facts with that expectedBasis and evidence full-evidence, a documented soft budget that may exceed 8KiB. A non-available or request-refused model, including basis.stale, declares the omission and count without a retrieval handle; following the current model.basis would drop the request-scoped refusal. Without an exact available basis, diagnostic omission is declared without a retrieval handle. No provider, runtime, config or GET command. Grants none. Workbench stays GET/SSE.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      expectedBasis: BASIS,
      itemId: ID,
      afterItemId: ID,
      evidence: { enum: ["summary", "full-evidence"] },
    },
    required: ["projectId"],
    additionalProperties: false,
    dependentRequired: {
      itemId: ["expectedBasis"],
      afterItemId: ["expectedBasis"],
    },
    allOf: [
      {
        if: {
          properties: { evidence: { const: "full-evidence" } },
          required: ["evidence"],
        },
        then: { required: ["expectedBasis"] },
      },
      {
        not: { required: ["itemId", "afterItemId"] },
      },
      {
        not: {
          required: ["itemId", "evidence"],
          properties: { evidence: { const: "full-evidence" } },
        },
      },
    ],
  },
  outputSchema: {
    oneOf: [SUMMARY_OUTPUT, ITEM_OUTPUT, FULL_OUTPUT],
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export function registerProjectResponseTools(
  app: McpApp,
  dependencies: ProjectResponseToolDependencies,
): void {
  const useCase = dependencies.projectResponse;
  if (!useCase) return;
  app.registerTool(projectResponseReadTool, async (args) => {
    const request = parseProjectResponseReadArgs(args);
    const model = await useCase.read(request.query);
    const presented = presentProjectResponse(model, request);
    return {
      content: contentFor(presented),
      structuredContent: presented as unknown as Record<string, unknown>,
    };
  });
}

interface ProjectResponseReadArgs {
  readonly query: ProjectResponseReadQuery;
  readonly itemId?: string;
  readonly afterItemId?: string;
  readonly evidence: "summary" | "full-evidence";
}

export interface ProjectResponseSummaryRow {
  readonly itemId: string;
  readonly kind: ProjectBriefItemKind;
  readonly correspondence: ProjectResponseItem["correspondence"];
  readonly requirementCount: number;
  readonly currentEvaluationCount: number;
  readonly historicalEvaluationCount: number;
  readonly clauseResponseCount: number;
  readonly currentClauseResponseCount: number;
  readonly historicalClauseResponseCount: number;
  readonly gapCount: number;
}

interface ProjectResponseCounts {
  readonly items: number;
  readonly included: number;
  readonly omitted: number;
  readonly gaps: number;
  readonly diagnostics: number;
  readonly diagnosticsIncluded: number;
  readonly diagnosticsOmitted: number;
  readonly removedClauseResponseCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byCorrespondence: Readonly<Record<string, number>>;
}

interface ProjectResponseOmission {
  readonly declared: true;
  readonly omittedItemCount: number;
  readonly afterItemId: string;
  readonly retrieval: {
    readonly tool: typeof PROJECT_RESPONSE_TOOL_NAME;
    readonly arguments: {
      readonly projectId: string;
      readonly expectedBasis: NonNullable<ProjectResponseReadModel["basis"]>;
      readonly afterItemId: string;
      readonly evidence: "summary" | "full-evidence";
    };
  };
}

interface ProjectResponseDiagnosticOmission {
  readonly declared: true;
  readonly omittedDiagnosticCount: number;
  readonly retrieval?: {
    readonly tool: typeof PROJECT_RESPONSE_TOOL_NAME;
    readonly arguments: {
      readonly projectId: string;
      readonly expectedBasis: NonNullable<ProjectResponseReadModel["basis"]>;
      readonly evidence: "full-evidence";
    };
  };
}

export interface ProjectResponseToolResult {
  readonly schemaVersion: typeof PROJECT_RESPONSE_SCHEMA;
  readonly status: ProjectResponseReadModel["status"];
  readonly view: "summary" | "item" | "full-evidence";
  readonly basis?: ProjectResponseReadModel["basis"];
  readonly itemId?: string;
  readonly counts?: ProjectResponseCounts;
  readonly items: readonly unknown[];
  readonly historicalClauseResponses?:
    readonly ProjectResponseItem["clauseResponses"][number][];
  readonly omission?: ProjectResponseOmission;
  readonly diagnosticOmission?: ProjectResponseDiagnosticOmission;
  readonly diagnostics: ProjectResponseReadModel["diagnostics"];
  readonly grants: "none";
}

export function parseProjectResponseReadArgs(
  args: Record<string, unknown>,
): ProjectResponseReadArgs {
  const projectId = String(args.projectId);
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("projectId cannot use a latest alias.");
  }
  const itemId = optionalId(args.itemId, "itemId");
  const afterItemId = optionalId(args.afterItemId, "afterItemId");
  const evidence = args.evidence === "full-evidence" ? "full-evidence" : "summary";
  if (itemId && afterItemId) {
    throw new TypeError("itemId and afterItemId cannot be combined.");
  }
  if (itemId && evidence === "full-evidence") {
    throw new TypeError("itemId cannot be combined with full-evidence.");
  }
  const expectedBasis = args.expectedBasis === undefined
    ? undefined
    : parseProjectResponseBasis(args.expectedBasis, "expectedBasis");
  if ((itemId || afterItemId || evidence === "full-evidence") && !expectedBasis) {
    throw new TypeError(
      "expectedBasis is required for named item detail, continuation and full-evidence.",
    );
  }
  return {
    query: {
      projectId,
      ...(expectedBasis ? { expectedBasis } : {}),
    },
    ...(itemId ? { itemId } : {}),
    ...(afterItemId ? { afterItemId } : {}),
    evidence,
  };
}

export function presentProjectResponse(
  model: ProjectResponseReadModel,
  request: ProjectResponseReadArgs,
): ProjectResponseToolResult {
  const envelope = {
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: model.status,
    ...(model.basis ? { basis: model.basis } : {}),
    diagnostics: model.diagnostics,
    grants: "none" as const,
  };
  if (request.itemId) {
    const item = model.status === "available"
      ? model.items.find((candidate) => candidate.item.id === request.itemId)
      : undefined;
    return {
      ...envelope,
      view: "item",
      itemId: request.itemId,
      items: item ? [item] : [],
      diagnostics: item || model.status !== "available" ? model.diagnostics : [
        ...model.diagnostics,
        {
          code: "item.unknown",
          message:
            `Approved brief item ${request.itemId} is not present on this exact basis.`,
        },
      ],
      status: item || model.status !== "available" ? model.status : "unresolved",
    };
  }
  const start = model.status === "available"
    ? sliceStart(model.items, request.afterItemId)
    : 0;
  const remaining = model.status === "available" ? model.items.slice(start) : [];
  if (request.evidence === "full-evidence") {
    const included = takeFitting(
      remaining,
      (items) =>
        fullPage(
          envelope,
          model,
          remaining,
          items,
          request.query.projectId,
        ),
      PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
      "oversized-single",
    );
    return fullPage(
      envelope,
      model,
      remaining,
      included,
      request.query.projectId,
    );
  }
  const rows = remaining.map(summaryRow);
  const diagnosticPlan = planSummaryDiagnostics(
    envelope,
    model,
    remaining,
    rows,
    request.query.projectId,
  );
  const summaryEnvelope = {
    ...envelope,
    diagnostics: diagnosticPlan.diagnostics,
  };
  const included = takeFitting(
    rows,
    (items) =>
      summaryPage(
        summaryEnvelope,
        model,
        remaining,
        items,
        request.query.projectId,
        diagnosticPlan.omission,
      ),
    PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
    "strict",
  );
  return summaryPage(
    summaryEnvelope,
    model,
    remaining,
    included,
    request.query.projectId,
    diagnosticPlan.omission,
  );
}

function summaryPage(
  envelope: Omit<
    ProjectResponseToolResult,
    "view" | "items" | "diagnosticOmission"
  >,
  model: ProjectResponseReadModel,
  remaining: readonly ProjectResponseItem[],
  included: readonly ProjectResponseSummaryRow[],
  projectId: string,
  diagnosticOmission?: ProjectResponseDiagnosticOmission,
): ProjectResponseToolResult {
  return {
    ...envelope,
    view: "summary",
    counts: countsFor(
      model.items,
      remaining,
      included.length,
      model.diagnostics.length,
      envelope.diagnostics.length,
      model.historicalClauseResponses.length,
    ),
    items: included,
    ...omissionFor(
      model,
      remaining,
      included,
      projectId,
      "summary",
      (row) => row.itemId,
    ),
    ...(diagnosticOmission ? { diagnosticOmission } : {}),
  };
}

function fullPage(
  envelope: Omit<ProjectResponseToolResult, "view" | "items">,
  model: ProjectResponseReadModel,
  remaining: readonly ProjectResponseItem[],
  included: readonly ProjectResponseItem[],
  projectId: string,
): ProjectResponseToolResult {
  return {
    ...envelope,
    view: "full-evidence",
    counts: countsFor(
      model.items,
      remaining,
      included.length,
      model.diagnostics.length,
      model.diagnostics.length,
      model.historicalClauseResponses.length,
    ),
    items: included,
    historicalClauseResponses: model.historicalClauseResponses,
    ...omissionFor(
      model,
      remaining,
      included,
      projectId,
      "full-evidence",
      (item) => item.item.id,
    ),
  };
}

function omissionFor<T>(
  model: ProjectResponseReadModel,
  remaining: readonly ProjectResponseItem[],
  included: readonly T[],
  projectId: string,
  evidence: "summary" | "full-evidence",
  idOf: (row: T) => string,
): { readonly omission: ProjectResponseOmission } | Record<string, never> {
  const omittedItemCount = remaining.length - included.length;
  if (omittedItemCount <= 0 || included.length === 0 || !model.basis) {
    return {};
  }
  const afterItemId = idOf(included[included.length - 1]!);
  return {
    omission: {
      declared: true,
      omittedItemCount,
      afterItemId,
      retrieval: {
        tool: PROJECT_RESPONSE_TOOL_NAME,
        arguments: {
          projectId,
          expectedBasis: model.basis,
          afterItemId,
          evidence,
        },
      },
    },
  };
}

function countsFor(
  all: readonly ProjectResponseItem[],
  remaining: readonly ProjectResponseItem[],
  included: number,
  diagnostics: number,
  diagnosticsIncluded: number,
  removedClauseResponseCount: number,
): ProjectResponseCounts {
  const byKind: Record<string, number> = {};
  const byCorrespondence: Record<string, number> = {};
  let gaps = 0;
  for (const item of all) {
    byKind[item.item.kind] = (byKind[item.item.kind] ?? 0) + 1;
    byCorrespondence[item.correspondence] =
      (byCorrespondence[item.correspondence] ?? 0) + 1;
    gaps += item.gaps.length;
  }
  return {
    items: all.length,
    included,
    omitted: remaining.length - included,
    gaps,
    diagnostics,
    diagnosticsIncluded,
    diagnosticsOmitted: diagnostics - diagnosticsIncluded,
    removedClauseResponseCount,
    byKind,
    byCorrespondence,
  };
}

function planSummaryDiagnostics(
  envelope: Omit<ProjectResponseToolResult, "view" | "items">,
  model: ProjectResponseReadModel,
  remaining: readonly ProjectResponseItem[],
  rows: readonly ProjectResponseSummaryRow[],
  projectId: string,
): {
  readonly diagnostics: ProjectResponseReadModel["diagnostics"];
  readonly omission?: ProjectResponseDiagnosticOmission;
} {
  const all = model.diagnostics;
  const probe = rows.length > 0 ? [rows[0]!] : [];
  let fitted = 0;
  for (let count = all.length; count >= 0; count--) {
    const diagnostics = all.slice(0, count);
    const omission = diagnosticOmissionFor(model, all.length - count, projectId);
    const page = summaryPage(
      { ...envelope, diagnostics },
      model,
      remaining,
      probe,
      projectId,
      omission,
    );
    if (byteLength(page) <= PROJECT_RESPONSE_SUMMARY_MAX_BYTES) {
      fitted = count;
      break;
    }
  }
  const diagnostics = all.slice(0, fitted);
  const omission = diagnosticOmissionFor(
    model,
    all.length - fitted,
    projectId,
  );
  return { diagnostics, ...(omission ? { omission } : {}) };
}

function diagnosticOmissionFor(
  model: ProjectResponseReadModel,
  omittedDiagnosticCount: number,
  projectId: string,
): ProjectResponseDiagnosticOmission | undefined {
  if (omittedDiagnosticCount <= 0) return undefined;
  if (model.status !== "available" || !model.basis) {
    return { declared: true, omittedDiagnosticCount };
  }
  return {
    declared: true,
    omittedDiagnosticCount,
    retrieval: {
      tool: PROJECT_RESPONSE_TOOL_NAME,
      arguments: {
        projectId,
        expectedBasis: model.basis,
        evidence: "full-evidence",
      },
    },
  };
}

function summaryRow(item: ProjectResponseItem): ProjectResponseSummaryRow {
  let currentEvaluationCount = 0;
  let historicalEvaluationCount = 0;
  for (const requirement of item.requirements) {
    for (const evaluation of requirement.evaluations) {
      if (evaluation.applicability === "current") currentEvaluationCount++;
      if (evaluation.applicability === "historical") historicalEvaluationCount++;
    }
  }
  let currentClauseResponseCount = 0;
  let historicalClauseResponseCount = 0;
  for (const record of item.clauseResponses) {
    if (record.applicability === "current") currentClauseResponseCount++;
    if (record.applicability === "historical") historicalClauseResponseCount++;
  }
  return {
    itemId: item.item.id,
    kind: item.item.kind,
    correspondence: item.correspondence,
    requirementCount: item.requirements.length,
    currentEvaluationCount,
    historicalEvaluationCount,
    clauseResponseCount: item.clauseResponses.length,
    currentClauseResponseCount,
    historicalClauseResponseCount,
    gapCount: item.gaps.length,
  };
}

function sliceStart(
  items: readonly ProjectResponseItem[],
  afterItemId: string | undefined,
): number {
  if (!afterItemId) return 0;
  const index = items.findIndex((item) => item.item.id === afterItemId);
  if (index === -1) {
    throw new TypeError(
      "afterItemId is not an item on this exact project-response basis.",
    );
  }
  return index + 1;
}

function takeFitting<T>(
  remaining: readonly T[],
  page: (items: readonly T[]) => unknown,
  maxBytes: number,
  overflow: "strict" | "oversized-single",
): readonly T[] {
  let count = remaining.length;
  while (count > 0) {
    const included = remaining.slice(0, count);
    if (byteLength(page(included)) <= maxBytes) return included;
    count--;
  }
  const empty = remaining.slice(0, 0);
  if (byteLength(page(empty)) > maxBytes) {
    if (overflow === "oversized-single") {
      return remaining.length === 0 ? empty : remaining.slice(0, 1);
    }
    throw new TypeError("Project response metadata exceeds its fixed bound.");
  }
  if (remaining.length === 0) return empty;
  if (overflow === "oversized-single") {
    return remaining.slice(0, 1);
  }
  throw new TypeError(
    "Project response summary row exceeds its fixed 8KiB bound.",
  );
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(deterministicJson(value)).byteLength;
}

function optionalId(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  const id = String(value);
  if (!id || id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}

function contentFor(result: ProjectResponseToolResult): string {
  if (result.status !== "available") {
    return `Project response is ${result.status}. See the structured diagnostics for the missing or unresolved read basis. Correspondence is recorded evidence, not clause satisfaction. Grants none.`;
  }
  if (result.view === "item") {
    return `Project response item ${result.itemId} on the exact expected basis. Correspondence is recorded evidence, not clause satisfaction. Grants none.`;
  }
  const omitted = result.omission
    ? ` ${result.omission.omittedItemCount} later items are omitted; retrieve them with the returned expectedBasis and afterItemId.`
    : "";
  const omittedDiagnostics = result.diagnosticOmission
    ? result.diagnosticOmission.retrieval
      ? ` ${result.diagnosticOmission.omittedDiagnosticCount} diagnostics are omitted; retrieve exact text with evidence full-evidence on the returned expectedBasis.`
      : ` ${result.diagnosticOmission.omittedDiagnosticCount} diagnostics are omitted.`
    : "";
  if (result.view === "full-evidence") {
    return `Project response full evidence for ${
      result.counts?.included ?? 0
    } approved brief items on the exact expected basis.${omitted}${omittedDiagnostics} Artifact bytes, source texts and solver outputs stay omitted. Grants none.`;
  }
  return `Project response summary for ${result.counts?.included ?? 0} of ${
    result.counts?.items ?? 0
  } approved brief items on the exact current basis.${omitted}${omittedDiagnostics} Correspondence is recorded evidence, not clause satisfaction. Grants none.`;
}
