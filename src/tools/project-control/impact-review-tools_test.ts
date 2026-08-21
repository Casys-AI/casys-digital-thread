import { assert, assertEquals, assertRejects } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { registerProjectCrossDomainImpactReviewTools } from "./impact-review-tools.ts";

const COMMAND = {
  projectId: "project.impact",
  manifestRef: { fingerprint: { algorithm: "sha256", digest: "a".repeat(64) } },
} as const;

Deno.test("impact-manifest review surface exposes only opaque project and manifest identities", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const result = Object.freeze({
    status: "unavailable" as const,
    diagnostics: Object.freeze([{ code: "manifest_unavailable", message: "Unavailable." }]),
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
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), ["manifestRef", "projectId"]);
  assertEquals(schema.additionalProperties, false);
  const ref = (schema.properties as Record<string, Record<string, unknown>>).manifestRef;
  assertEquals(ref.additionalProperties, false);
  const response = await app.handler(tool.name)(structuredClone(COMMAND)) as Record<string, unknown>;
  assert(response.structuredContent === result);
  assertEquals(calls, [COMMAND]);
});

Deno.test("impact-manifest review rejects caller-selected branch, edge, artifact, and provider data before use case", async () => {
  const app = new CapturingApp();
  let calls = 0;
  registerProjectCrossDomainImpactReviewTools(app as unknown as McpApp, {
    crossDomainImpactManifestSealReview: {
      execute: () => { calls += 1; return Promise.reject(new Error("must not run")); },
    },
  });
  const handler = app.handler("project_cross_domain_impact_manifest_seal_review");
  for (const field of ["branch", "edge", "artifact", "provider"] as const) {
    await assertRejects(
      () => handler({ ...structuredClone(COMMAND), [field]: { forged: true } }) as Promise<unknown>,
      TypeError,
    );
  }
  assertEquals(calls, 0);
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();
  registerTool(tool: MCPTool, handler: ToolHandler): void { this.#tools.set(tool.name, tool); this.#handlers.set(tool.name, handler); }
  tool(name: string): MCPTool { const value = this.#tools.get(name); assert(value); return value; }
  handler(name: string): ToolHandler { const value = this.#handlers.get(name); assert(value); return value; }
}
