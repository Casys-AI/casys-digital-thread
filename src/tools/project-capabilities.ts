import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type { EngineeringProjectRevisionStore } from "../application/ports/out/engineering-project-revision-store.ts";
import {
  ProjectCapabilityAuthorizationService,
  type ProjectCapabilityChangeReview,
} from "../application/control-plane/project-capability-authorization-service.ts";
import {
  autoConfirms,
  INTERACTIVE_PROJECT_APPROVAL_MODE,
  localYoloRationale,
  type ProjectApprovalMode,
} from "./project-approval-mode.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
} from "./project-control/mcp-tool-schemas.ts";

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const CONDITIONAL_MUTATION = { ...READ, readOnlyHint: false } as const;

export interface ProjectCapabilityToolDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly authorization: ProjectCapabilityAuthorizationService;
  readonly approvalMode?: ProjectApprovalMode;
}

/** Read-only inspection plus a narrowly human-confirmed amendment review. */
export function registerProjectCapabilityTools(
  app: McpApp,
  dependencies: ProjectCapabilityToolDependencies,
): void {
  app.registerTool(projectCapabilityInspectTool, async (args) => {
    const projectId = requiredString(args.projectId, "projectId");
    return {
      content:
        `Operational capability authorization for ${projectId}. This is host authority only: it does not approve an engineering method or result.`,
      structuredContent: await dependencies.authorization.inspect(projectId),
    };
  });

  app.registerTool(projectCapabilityChangeReviewTool, async (args, context) => {
    const projectId = requiredString(args.projectId, "projectId");
    const project = await dependencies.projects.get(projectId);
    if (!project) {
      throw new TypeError(`Engineering project ${projectId} does not exist.`);
    }
    const review = await dependencies.authorization.reviewPublishedPlan(project);
    if (review.status !== "amendment-required") {
      return changeReviewResult(review);
    }
    const expectedFingerprint = optionalFingerprint(
      args.capabilityProposalFingerprint,
      "capabilityProposalFingerprint",
    );
    const mode = dependencies.approvalMode ?? INTERACTIVE_PROJECT_APPROVAL_MODE;
    if (autoConfirms(mode, "capability-amend")) {
      const ledger = await dependencies.authorization.authorizeAmendment(
        project,
        expectedFingerprint ?? review.proposal.capabilityProposalFingerprint,
      );
      return {
        content: localYoloRationale(
          `capability amendment ${review.proposal.capabilityProposalFingerprint.digest}`,
        ),
        structuredContent: { authorization: ledger.effectiveEnvelope },
      };
    }
    const confirmed = amendmentConfirmationResponse(context);
    if (confirmed === undefined) return amendmentConfirmationRequest(review);
    if (!confirmed) {
      return {
        content:
          "The capability amendment was not confirmed. The existing operational authorization remains unchanged.",
        structuredContent: review,
      };
    }
    if (!expectedFingerprint) {
      throw new TypeError(
        "A confirmed capability amendment must echo capabilityProposalFingerprint from this exact review.",
      );
    }
    const ledger = await dependencies.authorization.authorizeAmendment(
      project,
      expectedFingerprint,
    );
    return {
      content:
        "The exact operational capability amendment is now authorized. It does not approve an engineering method or result.",
      structuredContent: { authorization: ledger.effectiveEnvelope },
    };
  });
}

const projectCapabilityInspectTool: MCPTool = {
  name: "project_capability_inspect",
  description:
    "Read the server-owned local operational capability authorization for one project. It reveals semantic requirements, selected bindings/units/digests and host effects without Docker credentials, secret values, MRTR authority or result claims.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ,
};

const projectCapabilityChangeReviewTool: MCPTool = {
  name: "project_capability_change_review",
  description:
    "Compare the current exact published-plan demand with the project operational capability ceiling. Covered subsets need no prompt. A widening or binding/digest/host-effect change is presented as a delta-only human confirmation; callers never supply capabilities, providers, images, endpoints, tools or arguments.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      capabilityProposalFingerprint: {
        ...FINGERPRINT_SCHEMA,
        description:
          "Optional on the first read. Required only on an accepted signed retry, copied exactly from the preceding amendment review.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: CONDITIONAL_MUTATION,
};

function changeReviewResult(review: ProjectCapabilityChangeReview) {
  const content = review.status === "covered"
    ? "The exact published-plan capability demand is covered by the existing operational ceiling; no new prompt is needed."
    : review.status === "not-authorized"
    ? "This project has no effective operational capability authorization."
    : review.status === "revoked"
    ? "This project operational capability authorization was revoked. It cannot cover or amend the published-plan demand."
    : review.status === "method-transition-required"
    ? "The exact plan would switch a binding on a project with recorded proofs. A method transition/MRTR path is required; no silent amendment is available."
    : review.status === "unresolved"
    ? "The exact plan capability demand is unresolved and cannot be authorized."
    : "The exact plan needs an operational capability amendment.";
  return { content, structuredContent: review };
}

function amendmentConfirmationRequest(
  review: Extract<ProjectCapabilityChangeReview, { status: "amendment-required" }>,
) {
  return {
    resultType: "input_required",
    // The signed retry needs an exact opaque proposal identity. It is emitted
    // alongside the elicitation rather than hidden in prose/counts.
    structuredContent: {
      status: review.status,
      capabilityProposalFingerprint: review.proposal.capabilityProposalFingerprint,
      delta: review.delta,
    },
    inputRequests: {
      capability_change_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `The project now needs an operational capability delta: +${review.delta.addedRequirementKeys.length}, binding changes ${review.delta.bindingReplacements.length}, unit changes ${
              review.delta.units.addedIds.length +
              review.delta.units.removedIds.length +
              review.delta.units.changedIds.length
            }. Confirm this exact host-operational amendment. This does not approve an engineering method or result.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: "Confirm this capability amendment",
                description:
                  "I authorize this exact additional local operational capability ceiling for the project.",
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

function amendmentConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Capability amendment requires an MCP retry with verified signed request state.",
    );
  }
  const response = record(context.inputResponses.capability_change_confirmation);
  const action = oneOf(response.action, ["accept", "decline", "cancel"] as const);
  if (action !== "accept") return false;
  const content = record(response.content);
  return requiredBoolean(
    content.confirmed,
    "inputResponses.capability_change_confirmation.content.confirmed",
  );
}

function optionalFingerprint(value: unknown, name: string) {
  if (value === undefined) return undefined;
  const item = record(value);
  if (
    item.algorithm !== "sha256" || typeof item.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.digest)
  ) {
    throw new TypeError(`${name} must be a SHA-256 fingerprint.`);
  }
  return { algorithm: "sha256" as const, digest: item.digest };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean.`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError("Invalid confirmation response.");
  }
  return value as T;
}
