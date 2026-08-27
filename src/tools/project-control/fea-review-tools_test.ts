import { assertEquals } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectFeaReviewTools } from "./fea-review-tools.ts";

const SAFE_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

Deno.test("FEA tools register capture independently of seal review", () => {
  const absent = new CapturingApp();
  registerProjectFeaReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_fea_proof_case_capture"), false);
  assertEquals(absent.hasTool("project_fea_proof_seal_review"), false);

  const captureOnly = new CapturingApp();
  registerProjectFeaReviewTools(captureOnly as unknown as McpApp, {
    feaProofCaseCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(captureOnly.toolNames(), ["project_fea_proof_case_capture"]);
});

Deno.test("project_fea_proof_case_capture review names exact project and target identities", () => {
  const app = new CapturingApp();
  registerProjectFeaReviewTools(app as unknown as McpApp, {
    feaProofCaseCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
  });
  const output = app.tool("project_fea_proof_case_capture").outputSchema as {
    properties: Record<string, unknown>;
    additionalProperties: unknown;
    required: unknown;
  };
  assertEquals(output.additionalProperties, false);
  assertEquals(output.required, [
    "schemaVersion",
    "status",
    "reference",
    "id",
    "revision",
    "project",
    "target",
    "metrics",
    "grants",
  ]);
  assertEquals(output.properties.id, {
    type: "string",
    minLength: 1,
    maxLength: 256,
  });
  assertEquals(output.properties.project, {
    type: "object",
    properties: {
      id: SAFE_ID_SCHEMA,
      subjectId: SAFE_ID_SCHEMA,
    },
    required: ["id", "subjectId"],
    additionalProperties: false,
  });
  const input = app.tool("project_fea_proof_case_capture").inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
  };
  assertEquals(Object.keys(input.properties), ["resourceRef"]);
  assertEquals(input.required, ["resourceRef"]);
  assertEquals("sourceText" in input.properties, false);
  assertEquals(output.properties.target, {
    type: "object",
    properties: {
      id: SAFE_ID_SCHEMA,
      modelElementId: SAFE_ID_SCHEMA,
    },
    required: ["id", "modelElementId"],
    additionalProperties: false,
  });
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  registerTool(
    tool: MCPTool,
    _handler: (args: Record<string, unknown>) => unknown,
  ) {
    this.#tools.set(tool.name, tool);
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
}
