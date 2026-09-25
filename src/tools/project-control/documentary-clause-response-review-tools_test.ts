import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-platform";
import { registerProjectDocumentaryClauseResponseReviewTools } from "./documentary-clause-response-review-tools.ts";

Deno.test("documentary clause-response review tool registers only with its exact read-only use case", () => {
  const absent = new CapturingApp();
  registerProjectDocumentaryClauseResponseReviewTools(absent as unknown as McpApp, {});
  assertEquals(
    absent.hasTool("project_documentary_clause_response_review"),
    false,
  );

  const present = new CapturingApp();
  registerProjectDocumentaryClauseResponseReviewTools(
    present as unknown as McpApp,
    {
      documentaryClauseResponseReview: {
        execute: () => Promise.reject(new Error("not called")),
      },
    },
  );
  assertEquals(present.toolNames(), [
    "project_documentary_clause_response_review",
  ]);
});

Deno.test("project_documentary_clause_response_review is a closed source-backed grammar", () => {
  const app = new CapturingApp();
  registerProjectDocumentaryClauseResponseReviewTools(app as unknown as McpApp, {
    documentaryClauseResponseReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  const tool = app.tool("project_documentary_clause_response_review");
  const input = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties), [
    "projectId",
    "sourceItemId",
    "answer",
    "scope",
    "sourceRefs",
  ]);
  assertEquals(input.required, [
    "projectId",
    "sourceItemId",
    "answer",
    "scope",
    "sourceRefs",
  ]);
  for (
    const forbidden of [
      "url",
      "digest",
      "requirementId",
      "provider",
      "runtime",
      "latest",
      "agentApproved",
    ]
  ) {
    assertEquals(forbidden in input.properties, false);
  }
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assertStringIncludes(
    tool.description,
    "record.seal-documentary-clause-response@1",
  );
  assertStringIncludes(tool.description, "decisionParameters");
  assertStringIncludes(tool.description, "not accepting its content");
});

Deno.test("project_documentary_clause_response_review returns compiled parameters only when resolved", async () => {
  const app = new CapturingApp();
  const resolved = {
    status: "resolved" as const,
    operation: {
      id: "record.seal-documentary-clause-response" as const,
      version: "1" as const,
    },
    briefBasis: {
      kind: "approved-brief" as const,
      projectId: "project-id01",
      projectSnapshotId: "project.snapshot.4",
      projectRevision: 4,
      briefId: "brief.id01",
      briefSnapshotId: "brief.snapshot.7",
      briefRevision: 7,
      approvedBriefFingerprint: {
        algorithm: "sha256" as const,
        digest: "a".repeat(64),
      },
    },
    baseSnapshot: {
      kind: "thread-snapshot" as const,
      snapshotId: "thread.id01.7",
      revision: 7,
      subjectId: "inspection-drone-id01",
    },
    inputEvidenceRefs: [],
    decisionParameters: [{
      key: "clause.sourceItemId",
      label: "clause.sourceItemId",
      value: "exclusion.flight",
    }],
    diagnostics: [] as const,
  };
  registerProjectDocumentaryClauseResponseReviewTools(app as unknown as McpApp, {
    documentaryClauseResponseReview: {
      execute: () => Promise.resolve(resolved),
    },
  });
  const response = await app.handler("project_documentary_clause_response_review")(
    {
      projectId: "project-id01",
      sourceItemId: "exclusion.flight",
      answer: "Bench evidence does not claim flight.",
      scope: "context",
      sourceRefs: [{
        kind: "agent-resource",
        resourceRef: {
          schemaVersion: "agent-resource-capture/1.0",
          uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
          name: "note.md",
          mimeType: "text/markdown",
          representation: "text",
          byteCount: 12,
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        },
      }],
    },
  ) as { structuredContent: Record<string, unknown> };
  assertEquals(
    response.structuredContent.decisionParameters,
    resolved.decisionParameters,
  );
  assertEquals(response.structuredContent.status, "resolved");

  const unresolved = new CapturingApp();
  registerProjectDocumentaryClauseResponseReviewTools(
    unresolved as unknown as McpApp,
    {
      documentaryClauseResponseReview: {
        execute: () =>
          Promise.resolve({
            status: "unresolved" as const,
            diagnostics: [{ code: "source-unresolved", message: "missing item" }],
          }),
      },
    },
  );
  const unresolvedResponse = await unresolved.handler(
    "project_documentary_clause_response_review",
  )({ projectId: "project-id01" }) as {
    structuredContent: Record<string, unknown>;
  };
  assertEquals(unresolvedResponse.structuredContent.status, "unresolved");
  assert(!("decisionParameters" in unresolvedResponse.structuredContent));
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  registerTool(tool: MCPTool, handler: (args: Record<string, unknown>) => unknown) {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  toolNames(): string[] {
    return [...this.#tools.keys()];
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  }

  handler(name: string): (args: Record<string, unknown>) => unknown {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`missing handler ${name}`);
    return handler;
  }
}
