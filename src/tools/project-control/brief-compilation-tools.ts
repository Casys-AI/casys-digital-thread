import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectBriefArchitectureReviewUseCase } from "../../application/ports/in/architecture/renderer/project-brief-architecture-review.ts";
import type { ProjectBriefRequirementsReviewUseCase } from "../../application/ports/in/architecture/requirements/project-brief-requirements-review.ts";
import { PROPOSAL_PARAMETER_SLUG_BODY } from "../../domain/kernel/case-validation.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectBriefCompilationToolDependencies {
  /** Provider-free compilation of reviewed brief criteria into MRTR parameters. */
  briefRequirementsReview?: ProjectBriefRequirementsReviewUseCase;
  /** Provider-free compilation of reviewed brief architecture into MRTR parameters. */
  briefArchitectureReview?: ProjectBriefArchitectureReviewUseCase;
}

/** Register the provider-free approved-brief compilation surfaces. */
export function registerProjectBriefCompilationTools(
  app: McpApp,
  dependencies: ProjectBriefCompilationToolDependencies,
): void {
  registerRequirements(app, dependencies);
  registerArchitecture(app, dependencies);
}

function registerRequirements(
  app: McpApp,
  dependencies: ProjectBriefCompilationToolDependencies,
): void {
  if (!dependencies.briefRequirementsReview) return;
  const review = dependencies.briefRequirementsReview;
  app.registerTool(projectBriefRequirementsReviewTool, async (args) => {
    // The use case owns fail-closed validation; the MCP surface must not
    // pre-parse, repair or filter the request.
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? "Brief requirements review is resolved against the exact human-approved canonical brief. Every parameter names the brief item it was traced to; the server did not read the item prose, so the signing human still confirms each value against its statement. Construct a later model.write-requirements@1 proposal only from the returned decisionParameters; if none are present, do not invent them. This wrote no EngineeringProject or Thread state and granted no MRTR authority."
      : "Brief requirements review is unresolved: the diagnostics name the exact declarations the approved brief does not support, and no decisionParameters are returned. Resolve them against the brief itself; never construct the proposal by hand from an unresolved review.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

function registerArchitecture(
  app: McpApp,
  dependencies: ProjectBriefCompilationToolDependencies,
): void {
  if (!dependencies.briefArchitectureReview) return;
  const review = dependencies.briefArchitectureReview;
  app.registerTool(projectBriefArchitectureReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? "Brief architecture review is resolved against the exact human-approved canonical brief. Every parameter names the brief item it was traced to; the server did not read the item prose, so the signing human still confirms each name against its statement. Construct a later model.write-architecture@1 proposal only from the returned decisionParameters; if none are present, do not invent them. This wrote no EngineeringProject or Thread state, called no SysON, and granted no MRTR authority."
      : "Brief architecture review is unresolved: the diagnostics name the exact declarations the approved brief does not support, and no decisionParameters are returned. Resolve them against the brief itself; never construct the proposal by hand from an unresolved review.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const BRIEF_ITEM_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const PROPOSAL_PARAMETER_SLUG_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: `^${PROPOSAL_PARAMETER_SLUG_BODY}$`,
} as const;

const REQUIREMENT_DECLARATION_SCHEMA = {
  type: "object",
  properties: {
    slug: {
      ...PROPOSAL_PARAMETER_SLUG_SCHEMA,
      description:
        "Requirement slug used by the requirement.<slug>.<field> grammar. Letters, digits, hyphen and underscore only; not a SysML identifier.",
    },
    name: { type: "string", minLength: 1, maxLength: 256 },
    metric: { type: "string", minLength: 1, maxLength: 256 },
    operator: { type: "string", minLength: 1, maxLength: 8 },
    threshold: { type: "number" },
    unit: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      description:
        "Unit of the threshold. Admissibility is decided by the server-owned unit allowlist, not by the caller.",
    },
    sourceItemId: {
      ...BRIEF_ITEM_ID_SCHEMA,
      description:
        "Exact approved-brief item stating this criterion. It must be a success-criterion or verification-activity.",
    },
  },
  required: [
    "slug",
    "name",
    "metric",
    "operator",
    "threshold",
    "unit",
    "sourceItemId",
  ],
  additionalProperties: false,
} as const;

const projectBriefRequirementsReviewTool: MCPTool = {
  name: "project_brief_requirements_review",
  description:
    "Compile reviewed brief criteria into the canonical model.write-requirements@1 MRTR parameters. The server reopens the exact human-approved canonical brief itself and checks every declaration against it: an absent item, a non-normative item, an unsourced item, a duplicate slug or an envelope the requirements grammar refuses yields an unresolved result with diagnostics and no parameters. The caller may name only the target component, the brief items and the reviewed scalar values; parameter keys, labels and unit admissibility remain server-owned. This read-only surface writes no EngineeringProject or Thread state, calls no provider, and grants no MRTR or dispatch authority. It does not read the item prose, so it never asserts that a declared value restates its statement — the signing human does.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      containerComponent: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        description:
          "Exact component the requirements are anchored to, as named in the reviewed architecture.",
      },
      containerSourceItemId: {
        ...BRIEF_ITEM_ID_SCHEMA,
        description:
          "Exact approved-brief item naming that component. It only has to be sourced; it is not itself normative.",
      },
      requirements: {
        type: "array",
        minItems: 1,
        items: REQUIREMENT_DECLARATION_SCHEMA,
      },
    },
    required: [
      "projectId",
      "containerComponent",
      "containerSourceItemId",
      "requirements",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const COMPONENT_DECLARATION_SCHEMA = {
  type: "object",
  properties: {
    slug: {
      ...PROPOSAL_PARAMETER_SLUG_SCHEMA,
      description:
        "Component slug used by the component.<slug>.<field> grammar. Letters, digits, hyphen and underscore only; not a SysML identifier.",
    },
    name: { type: "string", minLength: 1, maxLength: 256 },
    usage: { type: "string", minLength: 1, maxLength: 256 },
    parent: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Parent PartDefinition or system name. Omit it and the production parser anchors the component to system.name.",
    },
    sourceItemId: {
      ...BRIEF_ITEM_ID_SCHEMA,
      description:
        "Exact approved-brief item stating this retained occurrence. It must not be an exclusion or an open-question.",
    },
  },
  required: ["slug", "name", "usage", "sourceItemId"],
  additionalProperties: false,
} as const;

const ATTRIBUTE_DECLARATION_SCHEMA = {
  type: "object",
  properties: {
    slug: {
      ...PROPOSAL_PARAMETER_SLUG_SCHEMA,
      description:
        "Attribute slug used by the attribute.<slug>.<field> grammar. Letters, digits, hyphen and underscore only; not a SysML identifier.",
    },
    name: { type: "string", minLength: 1, maxLength: 256 },
    parent: { type: "string", minLength: 1, maxLength: 256 },
    sourceItemId: {
      ...BRIEF_ITEM_ID_SCHEMA,
      description:
        "Exact approved-brief item stating this AttributeUsage. It must not be an exclusion or an open-question.",
    },
  },
  required: ["slug", "name", "sourceItemId"],
  additionalProperties: false,
} as const;

const projectBriefArchitectureReviewTool: MCPTool = {
  name: "project_brief_architecture_review",
  description:
    "Compile reviewed brief architecture into the canonical model.write-architecture@1 MRTR parameters. The server reopens the exact human-approved canonical brief itself and checks every declaration against it: an absent item, an item that is an exclusion or an open-question, an unsourced item, a duplicate slug, a slug that is not a proposal-parameter slug, or an envelope the architecture grammar refuses (unknown parent, cycle, duplicate usage) yields an unresolved result with diagnostics and no parameters. The caller may name only the package, the system, optional component rows, optional AttributeUsage rows and the brief items; parameter keys, labels and structural admissibility remain server-owned. Zero components is a single-part system. This read-only surface writes no EngineeringProject or Thread state, calls no SysON, and grants no MRTR or dispatch authority. It does not read the item prose, so it never asserts that a declared name restates its statement — the signing human does.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      packageName: { type: "string", minLength: 1, maxLength: 256 },
      packageSourceItemId: {
        ...BRIEF_ITEM_ID_SCHEMA,
        description: "Exact approved-brief item stating the architecture package.",
      },
      systemName: { type: "string", minLength: 1, maxLength: 256 },
      systemSourceItemId: {
        ...BRIEF_ITEM_ID_SCHEMA,
        description: "Exact approved-brief item stating the architecture system.",
      },
      components: {
        type: "array",
        minItems: 0,
        items: COMPONENT_DECLARATION_SCHEMA,
      },
      attributes: {
        type: "array",
        minItems: 0,
        items: ATTRIBUTE_DECLARATION_SCHEMA,
      },
    },
    required: [
      "projectId",
      "packageName",
      "packageSourceItemId",
      "systemName",
      "systemSourceItemId",
      "components",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
