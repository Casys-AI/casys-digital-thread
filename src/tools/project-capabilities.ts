import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
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
    const withdrawUnused = optionalBoolean(args.withdrawUnused, "withdrawUnused") ??
      false;
    const review = withdrawUnused
      ? await dependencies.authorization.reviewUnusedWithdrawal(project)
      : await dependencies.authorization.reviewPublishedPlan(project);
    if (withdrawUnused) {
      return await resolveUnusedWithdrawal(
        dependencies,
        project,
        review,
        args,
        context,
      );
    }
    if (review.status !== "amendment-required") {
      return changeReviewResult(review);
    }
    return await resolveConfirmedCapabilityChange({
      dependencies,
      project,
      review,
      args,
      context,
      kind: "amendment",
    });
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
    "Compare the current exact published-plan demand with the project operational capability ceiling. Covered subsets need no prompt and do not shrink the ceiling. withdrawUnused=true may offer a server-derived shrink to that exact current demand when the delta is strictly subtractive. A widening or binding/digest/host-effect change remains a delta-only human confirmation. Callers never supply capabilities, providers, images, endpoints, tools or arguments.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      withdrawUnused: {
        type: "boolean",
        default: false,
        description:
          "When true, review shrinking the authorized ceiling to the exact current planned demand. Omitted or false leaves a covered subset unchanged. Callers never supply capability ids, providers, images, endpoints, tools or arguments.",
      },
      capabilityProposalFingerprint: {
        ...FINGERPRINT_SCHEMA,
        description:
          "Optional on the first read. Required only on an accepted signed retry, copied exactly from the preceding amendment or unused-withdrawal review.",
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
    : review.status === "no-change"
    ? "No unused operational capability authority to withdraw; the authorized ceiling is unchanged."
    : review.status === "not-authorized"
    ? "This project has no effective operational capability authorization."
    : review.status === "revoked"
    ? "This project operational capability authorization was revoked. It cannot cover or amend the published-plan demand."
    : review.status === "method-transition-required"
    ? "The exact plan would switch a binding on a project with recorded proofs. A method transition/MRTR path is required; no silent amendment is available."
    : review.status === "unresolved"
    ? "The exact plan capability demand is unresolved and cannot be authorized."
    : review.status === "withdrawal-required"
    ? "The project can shrink unused operational authority to the exact current planned demand."
    : "The exact plan needs an operational capability amendment.";
  return { content, structuredContent: review };
}

async function resolveUnusedWithdrawal(
  dependencies: ProjectCapabilityToolDependencies,
  project: EngineeringProjectSnapshot,
  review: ProjectCapabilityChangeReview,
  args: Record<string, unknown>,
  context?: ToolHandlerContext,
) {
  if (review.status === "no-change" || review.status === "covered") {
    return {
      content:
        "No unused operational capability authority to withdraw; the authorized ceiling is unchanged.",
      structuredContent: { ...review, status: "no-change" as const },
    };
  }
  if (review.status !== "withdrawal-required") {
    const fallback = changeReviewResult(review);
    return {
      content: `Unused operational withdrawal is not available. ${fallback.content}`,
      structuredContent: review,
    };
  }
  return await resolveConfirmedCapabilityChange({
    dependencies,
    project,
    review,
    args,
    context,
    kind: "withdrawal",
  });
}

async function resolveConfirmedCapabilityChange(input: {
  readonly dependencies: ProjectCapabilityToolDependencies;
  readonly project: EngineeringProjectSnapshot;
  readonly review: Extract<
    ProjectCapabilityChangeReview,
    { status: "amendment-required" | "withdrawal-required" }
  >;
  readonly args: Record<string, unknown>;
  readonly context?: ToolHandlerContext;
  readonly kind: "amendment" | "withdrawal";
}) {
  const expectedFingerprint = optionalFingerprint(
    input.args.capabilityProposalFingerprint,
    "capabilityProposalFingerprint",
  );
  const mode = input.dependencies.approvalMode ?? INTERACTIVE_PROJECT_APPROVAL_MODE;
  const authorize = input.kind === "withdrawal"
    ? input.dependencies.authorization.authorizeUnusedWithdrawal.bind(
      input.dependencies.authorization,
    )
    : input.dependencies.authorization.authorizeAmendment.bind(
      input.dependencies.authorization,
    );
  if (autoConfirms(mode, "capability-amend")) {
    const ledger = await authorize(
      input.project,
      expectedFingerprint ?? input.review.proposal.capabilityProposalFingerprint,
    );
    return {
      content: localYoloRationale(
        input.kind === "withdrawal"
          ? `unused capability withdrawal ${input.review.proposal.capabilityProposalFingerprint.digest}`
          : `capability amendment ${input.review.proposal.capabilityProposalFingerprint.digest}`,
      ),
      structuredContent: { authorization: ledger.effectiveEnvelope },
    };
  }
  const confirmed = amendmentConfirmationResponse(input.context);
  if (confirmed === undefined) {
    return capabilityChangeConfirmationRequest(input.review, input.kind);
  }
  if (!confirmed) {
    return {
      content: input.kind === "withdrawal"
        ? "The unused capability withdrawal was not confirmed. The existing operational authorization remains unchanged."
        : "The capability amendment was not confirmed. The existing operational authorization remains unchanged.",
      structuredContent: input.review,
    };
  }
  if (!expectedFingerprint) {
    throw new TypeError(
      input.kind === "withdrawal"
        ? "A confirmed unused capability withdrawal must echo capabilityProposalFingerprint from this exact review."
        : "A confirmed capability amendment must echo capabilityProposalFingerprint from this exact review.",
    );
  }
  const ledger = await authorize(input.project, expectedFingerprint);
  return {
    content: input.kind === "withdrawal"
      ? "The unused operational capability authority has been withdrawn to the exact current planned demand. This removes unused operational authority only; it does not delete images, data, or evidence, and does not approve or reinterpret engineering methods or results."
      : "The exact operational capability amendment is now authorized. It does not approve an engineering method or result.",
    structuredContent: { authorization: ledger.effectiveEnvelope },
  };
}

function capabilityChangeConfirmationRequest(
  review: Extract<
    ProjectCapabilityChangeReview,
    { status: "amendment-required" | "withdrawal-required" }
  >,
  kind: "amendment" | "withdrawal",
) {
  const withdrawalCopy =
    "This removes unused operational authority only; it does not delete images, data, or evidence, and does not approve or reinterpret engineering methods or results.";
  const message = kind === "withdrawal"
    ? `The project can shrink unused operational authority: -${review.delta.removedRequirementKeys.length} requirement(s), binding removals ${review.delta.bindingReplacements.length}, unit removals ${review.delta.units.removedIds.length}. Confirm this exact host-operational withdrawal. ${withdrawalCopy}`
    : `The project now needs an operational capability delta: +${review.delta.addedRequirementKeys.length}, binding changes ${review.delta.bindingReplacements.length}, unit changes ${
      review.delta.units.addedIds.length +
      review.delta.units.removedIds.length +
      review.delta.units.changedIds.length
    }. Confirm this exact host-operational amendment. This does not approve an engineering method or result.`;
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
          message,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: kind === "withdrawal"
                  ? "Confirm this unused capability withdrawal"
                  : "Confirm this capability amendment",
                description: kind === "withdrawal"
                  ? `I authorize shrinking this project's operational capability ceiling to the exact current planned demand. ${withdrawalCopy}`
                  : "I authorize this exact additional local operational capability ceiling for the project.",
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

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requiredBoolean(value, name);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError("Invalid confirmation response.");
  }
  return value as T;
}
