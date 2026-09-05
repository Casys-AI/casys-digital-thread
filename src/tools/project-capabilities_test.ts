import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  McpApp,
  MCPTool,
  ToolHandler,
  ToolHandlerContext,
} from "@casys/mcp-server";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { ProjectCapabilityLedger } from "../domain/capability/project-capability-authorization.ts";
import type {
  ProjectCapabilityAuthorizationService,
  ProjectCapabilityChangeReview,
} from "../application/control-plane/project-capability-authorization-service.ts";
import { registerProjectCapabilityTools } from "./project-capabilities.ts";
import { LOCAL_YOLO_PROJECT_APPROVAL_MODE } from "./project-approval-mode.ts";

Deno.test("capability amendment emits its exact fingerprint then accepts only the signed retry", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  const review = {
    status: "amendment-required",
    ledger: {} as ProjectCapabilityLedger,
    proposal: { capabilityProposalFingerprint: fingerprint },
    effectiveEnvelope: {},
    delta: {
      addedRequirementKeys: ["simulation.kinematics\u00001\u0000execution"],
      bindingReplacements: [],
      units: { addedIds: ["casys.mcp-chrono"], removedIds: [], changedIds: [] },
    },
  } as unknown as Extract<
    ProjectCapabilityChangeReview,
    { status: "amendment-required" }
  >;
  const calls: unknown[] = [];
  const authorization = {
    reviewPublishedPlan: () => Promise.resolve(review),
    authorizeAmendment: (
      _project: EngineeringProjectSnapshot,
      supplied: unknown,
    ) => {
      calls.push(supplied);
      return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
    },
  } as unknown as ProjectCapabilityAuthorizationService;
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          {
            project: { id: "amendment-test" },
          } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization,
  });
  const handler = app.handler("project_capability_change_review");

  const first = reviewResult(await handler({ projectId: "amendment-test" }));
  assertEquals(first.resultType, "input_required");
  assertEquals(first.structuredContent.capabilityProposalFingerprint, fingerprint);

  const accepted = reviewResult(
    await handler(
      { projectId: "amendment-test", capabilityProposalFingerprint: fingerprint },
      {
        retryVerified: true,
        inputResponses: {
          capability_change_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      } as unknown as ToolHandlerContext,
    ),
  );
  assertEquals(calls, [fingerprint]);
  assertEquals(accepted.structuredContent, {
    authorization: { status: "authorized" },
  });
});

Deno.test("a revoked capability review remains explicit and cannot open an amendment elicitation", async () => {
  const review = {
    status: "revoked",
    ledger: {},
    proposal: {},
    effectiveEnvelope: { status: "revoked" },
  } as unknown as Extract<ProjectCapabilityChangeReview, { status: "revoked" }>;
  const authorization = {
    reviewPublishedPlan: () => Promise.resolve(review),
  } as unknown as ProjectCapabilityAuthorizationService;
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          { project: { id: "revoked-test" } } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization,
  });
  const result = reviewResult(
    await app.handler("project_capability_change_review")({
      projectId: "revoked-test",
    }),
  );
  assertEquals(result.resultType, undefined);
  assertEquals(result.structuredContent, review);
  assertEquals(result.content.includes("revoked"), true);
});

Deno.test("covered subset stays covered unless withdrawUnused is explicit", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: "c".repeat(64) };
  const review = {
    status: "covered",
    ledger: { revision: 2 },
    proposal: { capabilityProposalFingerprint: fingerprint },
    effectiveEnvelope: { status: "authorized" },
  } as unknown as Extract<ProjectCapabilityChangeReview, { status: "covered" }>;
  const calls: string[] = [];
  const authorization = {
    reviewPublishedPlan: () => {
      calls.push("reviewPublishedPlan");
      return Promise.resolve(review);
    },
    reviewUnusedWithdrawal: () => {
      calls.push("reviewUnusedWithdrawal");
      return Promise.resolve({
        ...review,
        status: "withdrawal-required" as const,
        delta: {
          addedRequirementKeys: [],
          removedRequirementKeys: [],
          bindingReplacements: [],
          units: { addedIds: [], removedIds: [], changedIds: [] },
        },
      });
    },
    authorizeAmendment: () => {
      calls.push("authorizeAmendment");
      return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
    },
    authorizeUnusedWithdrawal: () => {
      calls.push("authorizeUnusedWithdrawal");
      return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
    },
  } as unknown as ProjectCapabilityAuthorizationService;
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          { project: { id: "covered-test" } } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization,
  });
  const handler = app.handler("project_capability_change_review");
  const omitted = reviewResult(await handler({ projectId: "covered-test" }));
  const explicitFalse = reviewResult(
    await handler({
      projectId: "covered-test",
      withdrawUnused: false,
    }),
  );
  assertEquals(calls, ["reviewPublishedPlan", "reviewPublishedPlan"]);
  assertEquals(omitted.structuredContent.status, "covered");
  assertEquals(explicitFalse.structuredContent.status, "covered");
  assertStringIncludes(omitted.content, "no new prompt is needed");
});

Deno.test("unused withdrawal elicits then appends only the signed retry", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: "d".repeat(64) };
  const review = {
    status: "withdrawal-required",
    ledger: {} as ProjectCapabilityLedger,
    proposal: { capabilityProposalFingerprint: fingerprint },
    effectiveEnvelope: {},
    delta: {
      addedRequirementKeys: [],
      removedRequirementKeys: [
        "mechanics.observe-prescribed-kinematics\u00001\u0000execution",
      ],
      bindingReplacements: [{ previous: {}, next: null }],
      units: { addedIds: [], removedIds: ["casys.mcp-chrono"], changedIds: [] },
    },
  } as unknown as Extract<
    ProjectCapabilityChangeReview,
    { status: "withdrawal-required" }
  >;
  const calls: unknown[] = [];
  const authorization = {
    reviewUnusedWithdrawal: () => Promise.resolve(review),
    authorizeUnusedWithdrawal: (
      _project: EngineeringProjectSnapshot,
      supplied: unknown,
    ) => {
      calls.push(supplied);
      return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
    },
  } as unknown as ProjectCapabilityAuthorizationService;
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          {
            project: { id: "withdrawal-test" },
          } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization,
  });
  const handler = app.handler("project_capability_change_review");
  const first = reviewResult(
    await handler({
      projectId: "withdrawal-test",
      withdrawUnused: true,
    }),
  );
  assertEquals(first.resultType, "input_required");
  assertEquals(first.structuredContent.capabilityProposalFingerprint, fingerprint);
  assertStringIncludes(
    first.inputRequests.capability_change_confirmation.params.message,
    "unused operational authority only",
  );
  assertStringIncludes(
    first.inputRequests.capability_change_confirmation.params.message,
    "does not delete images",
  );

  const accepted = reviewResult(
    await handler(
      {
        projectId: "withdrawal-test",
        withdrawUnused: true,
        capabilityProposalFingerprint: fingerprint,
      },
      {
        retryVerified: true,
        inputResponses: {
          capability_change_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      } as unknown as ToolHandlerContext,
    ),
  );
  assertEquals(calls, [fingerprint]);
  assertEquals(accepted.structuredContent, {
    authorization: { status: "authorized" },
  });
  assertStringIncludes(accepted.content, "does not delete images, data, or evidence");
});

Deno.test("YOLO may auto-confirm unused withdrawal through capability-amend", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: "e".repeat(64) };
  const review = {
    status: "withdrawal-required",
    ledger: {},
    proposal: { capabilityProposalFingerprint: fingerprint },
    effectiveEnvelope: {},
    delta: {
      addedRequirementKeys: [],
      removedRequirementKeys: [
        "mechanics.observe-prescribed-kinematics\u00001\u0000execution",
      ],
      bindingReplacements: [],
      units: { addedIds: [], removedIds: [], changedIds: [] },
    },
  } as unknown as Extract<
    ProjectCapabilityChangeReview,
    { status: "withdrawal-required" }
  >;
  const calls: unknown[] = [];
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          {
            project: { id: "yolo-withdrawal" },
          } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization: {
      reviewUnusedWithdrawal: () => Promise.resolve(review),
      authorizeUnusedWithdrawal: (
        _project: EngineeringProjectSnapshot,
        supplied: unknown,
      ) => {
        calls.push(supplied);
        return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
      },
    } as unknown as ProjectCapabilityAuthorizationService,
    approvalMode: LOCAL_YOLO_PROJECT_APPROVAL_MODE,
  });
  const result = reviewResult(
    await app.handler("project_capability_change_review")({
      projectId: "yolo-withdrawal",
      withdrawUnused: true,
    }),
  );
  assertEquals(calls, [fingerprint]);
  assertStringIncludes(result.content, "YOLO");
  assertStringIncludes(result.content, "unused capability withdrawal");
});

Deno.test("no-op unused withdrawal returns a literal no-change result", async () => {
  const review = {
    status: "no-change",
    ledger: { revision: 2 },
    proposal: {},
    effectiveEnvelope: { status: "authorized" },
  } as unknown as Extract<ProjectCapabilityChangeReview, { status: "no-change" }>;
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          {
            project: { id: "noop-withdrawal" },
          } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization: {
      reviewUnusedWithdrawal: () => Promise.resolve(review),
      authorizeUnusedWithdrawal: () => {
        throw new Error("no-op withdrawal must not mutate");
      },
    } as unknown as ProjectCapabilityAuthorizationService,
  });
  const result = reviewResult(
    await app.handler("project_capability_change_review")({
      projectId: "noop-withdrawal",
      withdrawUnused: true,
    }),
  );
  assertEquals(result.structuredContent.status, "no-change");
  assertStringIncludes(result.content, "authorized ceiling is unchanged");
});

Deno.test("withdrawUnused falls closed when current demand is a widening", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: "f".repeat(64) };
  const review = {
    status: "amendment-required",
    ledger: {},
    proposal: { capabilityProposalFingerprint: fingerprint },
    effectiveEnvelope: { status: "authorized" },
    delta: {
      addedRequirementKeys: [
        "mechanics.observe-prescribed-kinematics\u00001\u0000execution",
      ],
      removedRequirementKeys: [],
      bindingReplacements: [],
      units: { addedIds: ["casys.mcp-chrono"], removedIds: [], changedIds: [] },
    },
  } as unknown as Extract<
    ProjectCapabilityChangeReview,
    { status: "amendment-required" }
  >;
  const calls: string[] = [];
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: {
      get: () =>
        Promise.resolve(
          {
            project: { id: "widening-withdrawal" },
          } as unknown as EngineeringProjectSnapshot,
        ),
    },
    authorization: {
      reviewUnusedWithdrawal: () => Promise.resolve(review),
      authorizeUnusedWithdrawal: () => {
        calls.push("authorizeUnusedWithdrawal");
        return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
      },
      authorizeAmendment: () => {
        calls.push("authorizeAmendment");
        return Promise.resolve({ effectiveEnvelope: { status: "authorized" } });
      },
    } as unknown as ProjectCapabilityAuthorizationService,
  });
  const result = reviewResult(
    await app.handler("project_capability_change_review")({
      projectId: "widening-withdrawal",
      withdrawUnused: true,
    }),
  );
  assertEquals(calls, []);
  assertEquals(result.resultType, undefined);
  assertEquals(result.structuredContent.status, "amendment-required");
  assertStringIncludes(
    result.content,
    "Unused operational withdrawal is not available",
  );
});

Deno.test("capability change review schema stays closed to caller runtime fields", () => {
  const app = new CapturingApp();
  registerProjectCapabilityTools(app as unknown as McpApp, {
    projects: { get: () => Promise.resolve(undefined) },
    authorization: {} as ProjectCapabilityAuthorizationService,
  });
  const schema = app.tool("project_capability_change_review").inputSchema as {
    additionalProperties: unknown;
    properties: Record<string, unknown>;
  };
  assertEquals(schema.additionalProperties, false);
  assertEquals(Object.keys(schema.properties).sort(), [
    "capabilityProposalFingerprint",
    "projectId",
    "withdrawUnused",
  ]);
  for (
    const rejected of [
      "capability",
      "capabilityIds",
      "requirementKeys",
      "provider",
      "image",
      "endpoint",
      "tool",
      "args",
      "unitId",
      "materialId",
    ]
  ) {
    assertEquals(Object.hasOwn(schema.properties, rejected), false);
  }
});

type CapabilityReviewResult = {
  readonly resultType?: string;
  readonly structuredContent: {
    readonly capabilityProposalFingerprint?: unknown;
    readonly status?: string;
    readonly authorization?: unknown;
  };
  readonly content: string;
  readonly inputRequests: {
    readonly capability_change_confirmation: {
      readonly params: { readonly message: string };
    };
  };
};

function reviewResult(value: unknown): CapabilityReviewResult {
  return value as CapabilityReviewResult;
}

class CapturingApp {
  readonly tools: MCPTool[] = [];
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(
    tool: MCPTool,
    handler: ToolHandler,
  ): void {
    this.tools.push(tool);
    this.#handlers.set(tool.name, handler);
  }

  tool(name: string) {
    const found = this.tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing tool ${name}.`);
    return found;
  }

  handler(name: string) {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Missing handler ${name}.`);
    return handler;
  }
}
