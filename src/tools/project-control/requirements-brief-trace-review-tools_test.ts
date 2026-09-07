import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectRequirementsBriefTraceReviewTools } from "./requirements-brief-trace-review-tools.ts";

Deno.test("requirements brief trace review tool registers only with its exact read-only use case", () => {
  const absent = new CapturingApp();
  registerProjectRequirementsBriefTraceReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_requirements_brief_trace_review"), false);

  const present = new CapturingApp();
  registerProjectRequirementsBriefTraceReviewTools(present as unknown as McpApp, {
    requirementsBriefTraceReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.toolNames(), ["project_requirements_brief_trace_review"]);
});

Deno.test("project_requirements_brief_trace_review accepts only singular source identities", () => {
  const app = new CapturingApp();
  registerProjectRequirementsBriefTraceReviewTools(app as unknown as McpApp, {
    requirementsBriefTraceReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  const tool = app.tool("project_requirements_brief_trace_review");
  const input = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties), [
    "projectId",
    "containerComponent",
    "containerSourceItemId",
    "requirementId",
    "sourceItemId",
  ]);
  assertEquals(input.required, [
    "projectId",
    "containerComponent",
    "containerSourceItemId",
    "requirementId",
    "sourceItemId",
  ]);
  for (
    const forbidden of [
      "threshold",
      "unit",
      "sourceText",
      "provider",
      "targets",
      "runtime",
      "targetElementId",
      "latest",
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
  assertStringIncludes(tool.description, "record.seal-requirements-brief-trace@1");
  assertStringIncludes(tool.description, "decisionParameters");
  assertStringIncludes(tool.description, "inputEvidenceRefs");
  assertStringIncludes(tool.description, "No scalar values");
});

Deno.test("project_requirements_brief_trace_review returns compiled parameters and evidence refs only when resolved", async () => {
  const app = new CapturingApp();
  const calls: Record<string, unknown>[] = [];
  const inputEvidenceRefs = [{
    snapshotId: "thread.id01.7",
    snapshotRevision: 7,
    kind: "artifact" as const,
    id: "requirements-capture-arm",
  }];
  const resolved = {
    status: "resolved" as const,
    operation: {
      id: "record.seal-requirements-brief-trace" as const,
      version: "1" as const,
    },
    briefBasis: {
      kind: "approved-brief" as const,
      projectId: "project-id01",
      projectSnapshotId: "project.snapshot.4",
      projectRevision: 4,
      briefId: "brief.id01",
      briefSnapshotId: "brief.snapshot.2",
      briefRevision: 2,
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
    requirementsCaptureEvidenceRef: inputEvidenceRefs[0]!,
    inputEvidenceRefs,
    decisionParameters: [{
      key: "trace.requirementId",
      label: "Captured requirement",
      value: "maxDisplacement",
    }],
    diagnostics: [] as const,
  };
  registerProjectRequirementsBriefTraceReviewTools(app as unknown as McpApp, {
    requirementsBriefTraceReview: {
      execute: (args) => {
        calls.push(args as Record<string, unknown>);
        return Promise.resolve(resolved);
      },
    },
  });
  const args = {
    projectId: "project-id01",
    containerComponent: "Arm",
    containerSourceItemId: "mission.arm",
    requirementId: "maxDisplacement",
    sourceItemId: "success.displacement",
  };
  const response = await app.handler("project_requirements_brief_trace_review")(
    args,
  ) as {
    structuredContent: Record<string, unknown>;
  };
  assertEquals(calls, [args]);
  assertEquals(
    response.structuredContent.decisionParameters,
    resolved.decisionParameters,
  );
  assertEquals(response.structuredContent.inputEvidenceRefs, inputEvidenceRefs);

  const unresolved = new CapturingApp();
  registerProjectRequirementsBriefTraceReviewTools(unresolved as unknown as McpApp, {
    requirementsBriefTraceReview: {
      execute: () =>
        Promise.resolve({
          status: "unresolved" as const,
          diagnostics: [{ code: "source-unresolved", message: "not unique" }],
        }),
    },
  });
  const unresolvedResponse = await unresolved.handler(
    "project_requirements_brief_trace_review",
  )(args) as { structuredContent: Record<string, unknown> };
  assertEquals(unresolvedResponse.structuredContent.status, "unresolved");
  assert(!("decisionParameters" in unresolvedResponse.structuredContent));
  assert(!("inputEvidenceRefs" in unresolvedResponse.structuredContent));
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
