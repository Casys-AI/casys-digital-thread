import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectPrescribedKinematicsReviewTools } from "./prescribed-kinematics-review-tools.ts";

Deno.test("prescribed-kinematics review exposes only the provider-free case review when no next-hop review is composed", () => {
  const app = new CapturingApp();
  registerProjectPrescribedKinematicsReviewTools(app as unknown as McpApp, {
    prescribedKinematicsCaseReview: {
      capture: async () => ({
        status: "unavailable" as const,
        diagnostic: { code: "fixture", message: "fixture" },
        grants: "none" as const,
      }),
    },
  });
  assertEquals(app.toolNames(), ["project_prescribed_kinematics_case_review"]);
  const tool = app.tool("project_prescribed_kinematics_case_review");
  assertStringIncludes(tool.description, "provider, image, tool, args, runtime");
  assertEquals(tool.description.includes("Chrono client"), false);
  assertEquals(JSON.stringify(tool.inputSchema).includes("case_json"), false);
  assertEquals(JSON.stringify(tool.inputSchema).includes("loweredCaseJson"), false);
});

Deno.test("prescribed-kinematics next-hop reviews are read-only and caller cannot choose Chrono or an L4/L5 consequence", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  registerProjectPrescribedKinematicsReviewTools(app as unknown as McpApp, {
    prescribedKinematicsNextHopReview: {
      review(stage, value) {
        calls.push({ stage, value });
        return Promise.resolve({
          status: "unavailable" as const,
          family: "prescribed-kinematics" as const,
          stage,
          diagnostic: { code: "fixture", message: "fixture" },
        });
      },
    },
  });

  assertEquals(app.toolNames(), [
    "project_prescribed_kinematics_method_review",
    "project_prescribed_kinematics_evaluation_review",
    "project_prescribed_kinematics_evaluation_closeout_review",
  ]);
  const resourceRef = {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
    name: "method.json",
    mimeType: "application/json",
    representation: "text",
    byteCount: 128,
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
  } as const;
  await app.handler("project_prescribed_kinematics_method_review")({
    projectId: "project-kinematics",
    methodResourceRef: resourceRef,
  });
  await app.handler("project_prescribed_kinematics_evaluation_review")({
    projectId: "project-kinematics",
  });
  const closeout = await app.handler(
    "project_prescribed_kinematics_evaluation_closeout_review",
  )({ projectId: "project-kinematics" }) as { content: string };
  assertStringIncludes(closeout.content, "No project change, MRTR proposal, approval");
  assertEquals(calls, [
    {
      stage: "method",
      value: { projectId: "project-kinematics", methodResourceRef: resourceRef },
    },
    { stage: "evaluation", value: { projectId: "project-kinematics" } },
    { stage: "closeout", value: { projectId: "project-kinematics" } },
  ]);

  for (const name of app.toolNames()) {
    const tool = app.tool(name);
    assertEquals(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const schema = tool.inputSchema as { properties: Record<string, unknown> };
    assertEquals(
      Object.keys(schema.properties).some((key) =>
        ["provider", "image", "endpoint", "runtime", "tool", "args", "consequence"]
          .includes(key)
      ),
      false,
    );
    assertStringIncludes(tool.description, "Read-only next-hop review");
  }
  assertEquals(
    Object.keys(
      (app.tool("project_prescribed_kinematics_method_review").inputSchema as {
        properties: Record<string, unknown>;
      }).properties,
    ).sort(),
    ["methodResourceRef", "projectId"],
  );
  for (
    const name of [
      "project_prescribed_kinematics_evaluation_review",
      "project_prescribed_kinematics_evaluation_closeout_review",
    ]
  ) {
    assertEquals(
      Object.keys(
        (app.tool(name).inputSchema as {
          properties: Record<string, unknown>;
        }).properties,
      ),
      ["projectId"],
    );
  }
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  registerTool(tool: MCPTool, handler: (args: Record<string, unknown>) => unknown) {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
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
