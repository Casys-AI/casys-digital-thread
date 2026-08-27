import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectAssemblyIntegrityReviewTools } from "./assembly-integrity-review-tools.ts";

Deno.test("assembly-integrity review tool registers only with its injected read-only use case", () => {
  const absent = new CapturingApp();
  registerProjectAssemblyIntegrityReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_assembly_integrity_review"), false);

  const present = new CapturingApp();
  registerProjectAssemblyIntegrityReviewTools(present as unknown as McpApp, {
    assemblyIntegrityReview: { execute: () => Promise.reject(new Error("not called")) },
  });
  assertEquals(present.toolNames(), ["project_assembly_integrity_review"]);
});

Deno.test("project_assembly_integrity_review exposes only the exact closed public command", () => {
  const app = new CapturingApp();
  registerProjectAssemblyIntegrityReviewTools(app as unknown as McpApp, {
    assemblyIntegrityReview: { execute: () => Promise.reject(new Error("not called")) },
  });
  const tool = app.tool("project_assembly_integrity_review");
  const input = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties).sort(), [
    "basis",
    "geometryModule",
    "projectId",
  ]);
  assertEquals(input.required, ["projectId", "basis", "geometryModule"]);
  for (
    const forbidden of [
      "provider",
      "tool",
      "profile",
      "runtime",
      "children",
      "transform",
      "tolerance",
      "latest",
    ]
  ) {
    assertEquals(forbidden in input.properties, false);
  }

  const basis = input.properties.basis as {
    additionalProperties: unknown;
    properties: { snapshotId: { not?: unknown } };
  };
  const geometryModule = input.properties.geometryModule as {
    additionalProperties: unknown;
    properties: { artifactId: { pattern?: unknown } };
  };
  assertEquals(basis.additionalProperties, false);
  assertEquals(basis.properties.snapshotId.not, { const: "latest" });
  assertEquals(geometryModule.additionalProperties, false);
  assertEquals(geometryModule.properties.artifactId.pattern, "^geometry-[a-f0-9]{64}$");
  assertStringIncludes(tool.description, "verify.observe-assembly-integrity@1");
  assertStringIncludes(tool.description, "decisionParameters");
  assertStringIncludes(tool.description, "read-only");
  assertEquals(tool.description.includes("planning-only"), false);
  assertStringIncludes(tool.description, "verdict");
});

Deno.test("project_assembly_integrity_review forwards only the received closed command and preserves grants none", async () => {
  const app = new CapturingApp();
  const calls: Record<string, unknown>[] = [];
  registerProjectAssemblyIntegrityReviewTools(app as unknown as McpApp, {
    assemblyIntegrityReview: {
      execute: (args) => {
        calls.push(args as Record<string, unknown>);
        return Promise.resolve({
          status: "unavailable" as const,
          projectId: "project.assembly-integrity",
          basis: {
            kind: "thread-snapshot" as const,
            snapshotId: "thread.snapshot.12",
            revision: 12,
            subjectId: "subject.assembly",
          },
          geometryModule: {
            artifactId: `geometry-${"a".repeat(64)}`,
            fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
          },
          diagnostics: [],
          grants: "none" as const,
        });
      },
    },
  });
  const args = {
    projectId: "project.assembly-integrity",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread.snapshot.12",
      revision: 12,
      subjectId: "subject.assembly",
    },
    geometryModule: {
      artifactId: `geometry-${"a".repeat(64)}`,
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    },
  };
  const response = await app.handler("project_assembly_integrity_review")(args) as {
    structuredContent: { grants?: unknown };
  };
  assertEquals(calls, [args]);
  assertEquals(response.structuredContent.grants, "none");
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<
    string,
    (args: Record<string, unknown>) => unknown
  >();

  registerTool(
    tool: MCPTool,
    handler: (args: Record<string, unknown>) => unknown,
  ) {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  hasTool(name: string) {
    return this.#tools.has(name);
  }

  toolNames() {
    return [...this.#tools.keys()];
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    if (tool === undefined) throw new Error(`Expected ${name} to be registered.`);
    return tool;
  }

  handler(name: string) {
    const handler = this.#handlers.get(name);
    if (handler === undefined) {
      throw new Error(`Expected ${name} handler to be registered.`);
    }
    return handler;
  }
}
