import { assertEquals } from "@std/assert";
import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { ProjectCapabilityLedger } from "../application/control-plane/project-capability-authorization.ts";
import type {
  ProjectCapabilityAuthorizationService,
  ProjectCapabilityChangeReview,
} from "../application/control-plane/project-capability-authorization-service.ts";
import { registerProjectCapabilityTools } from "./project-capabilities.ts";

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

  const first = await handler({ projectId: "amendment-test" });
  assertEquals(first.resultType, "input_required");
  assertEquals(first.structuredContent.capabilityProposalFingerprint, fingerprint);

  const accepted = await handler(
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
  const result = await app.handler("project_capability_change_review")({
    projectId: "revoked-test",
  });
  assertEquals(result.resultType, undefined);
  assertEquals(result.structuredContent, review);
  assertEquals(result.content.includes("revoked"), true);
});

class CapturingApp {
  readonly #handlers = new Map<
    string,
    (args: Record<string, unknown>, context?: ToolHandlerContext) => Promise<any>
  >();

  registerTool(
    tool: MCPTool,
    handler: (
      args: Record<string, unknown>,
      context?: ToolHandlerContext,
    ) => Promise<any>,
  ): void {
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string) {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Missing handler ${name}.`);
    return handler;
  }
}
