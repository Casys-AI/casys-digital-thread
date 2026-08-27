import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectAssemblyIntegrityEvaluationCloseoutReviewResult } from "../../application/ports/in/cad/assembly-integrity/project-assembly-integrity-evaluation-closeout-review.ts";
import { registerProjectAssemblyIntegrityCloseoutReviewTools } from "./assembly-integrity-closeout-review-tools.ts";

Deno.test("L5 closeout review tool registers only with its exact read-only use case", () => {
  const absent = new CapturingApp();
  registerProjectAssemblyIntegrityCloseoutReviewTools(
    absent as unknown as McpApp,
    {},
  );
  assertEquals(
    absent.hasTool("project_assembly_integrity_evaluation_closeout_review"),
    false,
  );

  const present = new CapturingApp();
  registerProjectAssemblyIntegrityCloseoutReviewTools(present as unknown as McpApp, {
    assemblyIntegrityEvaluationCloseoutReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.toolNames(), [
    "project_assembly_integrity_evaluation_closeout_review",
  ]);
});

Deno.test("L5 closeout review copy names complete propose except issuedAt", async () => {
  const app = new CapturingApp();
  let eligibility = true;
  registerProjectAssemblyIntegrityCloseoutReviewTools(app as unknown as McpApp, {
    assemblyIntegrityEvaluationCloseoutReview: {
      execute: () => Promise.resolve(resolvedCopyResult(eligibility)),
    },
  });
  const tool = app.tool("project_assembly_integrity_evaluation_closeout_review");
  assertStringIncludes(tool.description, "complete next.propose except issuedAt");
  assertStringIncludes(tool.description, "deno task mcp:call fills issuedAt");
  assertStringIncludes(tool.description, "direct client must add it");
  assertStringIncludes(tool.description, "post-append project revision");

  const accept = await app.handler(
    "project_assembly_integrity_evaluation_closeout_review",
  )({ projectId: "project-assembly" }) as { content: string };
  assertResolvedProposeCopy(accept.content);

  eligibility = false;
  const reject = await app.handler(
    "project_assembly_integrity_evaluation_closeout_review",
  )({ projectId: "project-assembly" }) as { content: string };
  assertResolvedProposeCopy(reject.content);
  assertStringIncludes(reject.content, "Paste reject.next.append.arguments");
});

function resolvedCopyResult(
  acceptanceEligibility: boolean,
): ProjectAssemblyIntegrityEvaluationCloseoutReviewResult {
  return {
    status: "resolved",
    selected: { acceptanceEligibility },
  } as ProjectAssemblyIntegrityEvaluationCloseoutReviewResult;
}

function assertResolvedProposeCopy(content: string) {
  assertStringIncludes(content, "complete except issuedAt");
  assertStringIncludes(content, "deno task mcp:call fills it");
  assertStringIncludes(content, "direct client must add issuedAt");
  assertStringIncludes(
    content,
    "propose.expectedRevision is the project revision after that successful append",
  );
}

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  registerTool(tool: MCPTool, handler: (args: Record<string, unknown>) => unknown) {
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
    if (!tool) throw new Error(`Expected ${name} to be registered.`);
    return tool;
  }

  handler(name: string) {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Expected ${name} handler to be registered.`);
    return handler;
  }
}
