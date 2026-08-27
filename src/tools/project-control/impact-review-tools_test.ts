import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import { registerProjectCrossDomainImpactReviewTools } from "./impact-review-tools.ts";

const COMMAND = {
  projectId: "project.impact",
  manifestRef: { fingerprint: { algorithm: "sha256", digest: "a".repeat(64) } },
} as const;

Deno.test("impact capture registers independently of the read-only review surfaces", () => {
  const absent = new CapturingApp();
  registerProjectCrossDomainImpactReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_cross_domain_impact_manifest_capture"), false);
  assertEquals(
    absent.hasTool("project_cross_domain_impact_manifest_seal_review"),
    false,
  );

  const captureOnly = new CapturingApp();
  registerProjectCrossDomainImpactReviewTools(captureOnly as unknown as McpApp, {
    crossDomainImpactManifestCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(captureOnly.toolNames(), [
    "project_cross_domain_impact_manifest_capture",
  ]);
});

Deno.test("project_cross_domain_impact_manifest_capture is a draft CAS write and stays reference-only", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const review = Object.freeze({
    schemaVersion: "cross-domain-impact-manifest-capture-review/2.0",
    status: "captured",
    reference: Object.freeze({
      fingerprint: Object.freeze({
        algorithm: "sha256",
        digest: "a".repeat(64),
      }),
    }),
    summary: Object.freeze({
      id: "impact-manifest-generic-1",
      revision: 1,
      basis: Object.freeze({
        projectId: "project.generic",
        subjectId: "subject.generic",
        snapshotId: "thread.generic",
        revision: 3,
      }),
      changeKinds: Object.freeze(["geometry-change"]),
    }),
    grants: "none",
  });
  registerProjectCrossDomainImpactReviewTools(app as unknown as McpApp, {
    crossDomainImpactManifestCapture: {
      capture(command) {
        calls.push(command);
        return Promise.resolve(review as never);
      },
    },
  });

  const resourceRef = sampleAgentResourceReference({
    name: "impact.json",
    mimeType: "application/json",
  });
  const result = await app.handler("project_cross_domain_impact_manifest_capture")({
    resourceRef,
  }) as Record<string, unknown>;
  assert(result.structuredContent === review);
  assertEquals(calls, [{ resourceRef }]);
  assertStringIncludes(result.content as string, "result.reference");
  assertStringIncludes(
    result.content as string,
    "project_cross_domain_impact_manifest_seal_review",
  );
  assertStringIncludes(
    result.content as string,
    "no EngineeringProject or Thread state",
  );
  assertStringIncludes(result.content as string, "not proof");

  const tool = app.tool("project_cross_domain_impact_manifest_capture");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assertStringIncludes(tool.description, "cross-domain-impact-manifest/2.0");
  assertStringIncludes(tool.description, "draft CAS");
  assertStringIncludes(tool.description, "Pass result.reference");
  assertStringIncludes(tool.description, "no EngineeringProject or Thread state");
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>), [
    "resourceRef",
  ]);
  assertEquals(schema.additionalProperties, false);
  assertEquals("sourceText" in (schema.properties as Record<string, unknown>), false);
  assertEquals(
    Object.keys(
      (tool.outputSchema as { properties: Record<string, unknown> }).properties,
    ).sort(),
    ["grants", "reference", "schemaVersion", "status", "summary"],
  );
  assertEquals(
    (tool.outputSchema as { additionalProperties: unknown }).additionalProperties,
    false,
  );

  await assertRejects(
    () =>
      app.handler("project_cross_domain_impact_manifest_capture")({
        resourceRef,
        provider: "ngspice",
      }) as Promise<unknown>,
    TypeError,
  );
  await assertRejects(
    () =>
      app.handler("project_cross_domain_impact_manifest_capture")({
        resourceRef,
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      }) as Promise<unknown>,
    TypeError,
  );
  assertEquals(calls.length, 1);
});

Deno.test("impact-manifest review surface exposes only opaque project and manifest identities", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const result = Object.freeze({
    status: "unavailable" as const,
    diagnostics: Object.freeze([{
      code: "manifest_unavailable",
      message: "Unavailable.",
    }]),
  });
  registerProjectCrossDomainImpactReviewTools(app as unknown as McpApp, {
    crossDomainImpactManifestSealReview: {
      execute(value) {
        calls.push(value);
        return Promise.resolve(result);
      },
    },
  });
  const tool = app.tool("project_cross_domain_impact_manifest_seal_review");
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "manifestRef",
    "projectId",
  ]);
  assertEquals(schema.additionalProperties, false);
  const ref =
    (schema.properties as Record<string, Record<string, unknown>>).manifestRef;
  assertEquals(ref.additionalProperties, false);
  const response = await app.handler(tool.name)(structuredClone(COMMAND)) as Record<
    string,
    unknown
  >;
  assert(response.structuredContent === result);
  assertEquals(calls, [COMMAND]);
});

Deno.test("impact-decision review surface exposes only projectId", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const result = Object.freeze({
    status: "unavailable" as const,
    diagnostics: Object.freeze([{
      code: "evaluation_capture_unavailable",
      message: "Unavailable.",
    }]),
  });
  registerProjectCrossDomainImpactReviewTools(app as unknown as McpApp, {
    crossDomainImpactDecisionReview: {
      execute(value) {
        calls.push(value);
        return Promise.resolve(result);
      },
    },
  });
  const tool = app.tool("project_cross_domain_impact_decision_review");
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>), [
    "projectId",
  ]);
  assertEquals(schema.additionalProperties, false);
  const response = await app.handler(tool.name)({
    projectId: "project.impact",
  }) as Record<string, unknown>;
  assert(response.structuredContent === result);
  assertEquals(calls, [{ projectId: "project.impact" }]);
});

Deno.test("impact-decision review rejects caller-selected branch, impact, status, and work item before use case", async () => {
  const app = new CapturingApp();
  let calls = 0;
  registerProjectCrossDomainImpactReviewTools(app as unknown as McpApp, {
    crossDomainImpactDecisionReview: {
      execute: () => {
        calls += 1;
        return Promise.reject(new Error("must not run"));
      },
    },
  });
  const handler = app.handler("project_cross_domain_impact_decision_review");
  for (
    const field of ["branch", "impact", "status", "workItemId", "provider"] as const
  ) {
    await assertRejects(
      () =>
        handler({ projectId: "project.impact", [field]: { forged: true } }) as Promise<
          unknown
        >,
      TypeError,
    );
  }
  assertEquals(calls, 0);
});

Deno.test("impact-manifest review rejects caller-selected branch, edge, artifact, and provider data before use case", async () => {
  const app = new CapturingApp();
  let calls = 0;
  registerProjectCrossDomainImpactReviewTools(app as unknown as McpApp, {
    crossDomainImpactManifestSealReview: {
      execute: () => {
        calls += 1;
        return Promise.reject(new Error("must not run"));
      },
    },
  });
  const handler = app.handler("project_cross_domain_impact_manifest_seal_review");
  for (const field of ["branch", "edge", "artifact", "provider"] as const) {
    await assertRejects(
      () =>
        handler({ ...structuredClone(COMMAND), [field]: { forged: true } }) as Promise<
          unknown
        >,
      TypeError,
    );
  }
  assertEquals(calls, 0);
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();
  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }
  tool(name: string): MCPTool {
    const value = this.#tools.get(name);
    assert(value);
    return value;
  }
  handler(name: string): ToolHandler {
    const value = this.#handlers.get(name);
    assert(value);
    return value;
  }
  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }
  toolNames(): string[] {
    return [...this.#tools.keys()];
  }
}
