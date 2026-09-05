import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectPrescribedKinematicsReviewTools } from "./prescribed-kinematics-review-tools.ts";

Deno.test("prescribed-kinematics review exposes only the provider-free case review when no next-hop review is composed", () => {
  const app = new CapturingApp();
  registerProjectPrescribedKinematicsReviewTools(app as unknown as McpApp, {
    prescribedKinematicsCaseReview: {
      review: () =>
        Promise.resolve({
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

Deno.test("prescribed-kinematics method review without a resource reports method-sheet identities rather than a next hop", async () => {
  const app = new CapturingApp();
  registerProjectPrescribedKinematicsReviewTools(app as unknown as McpApp, {
    prescribedKinematicsNextHopReview: {
      review() {
        return Promise.resolve({
          status: "resolved" as const,
          selected: {
            stage: "method" as const,
            mode: "preparation" as const,
            basis: {
              snapshotId: "thread-kinematics",
              revision: 5,
              subjectId: "subject-kinematics",
            },
            evidence: {
              sealedCase: {
                id: "artifact-case",
                fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
                producerRunId: "run-case",
                freshness: "fresh" as const,
              },
              observation: {
                id: "artifact-observation",
                fingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
                producerRunId: "run-observation",
                freshness: "fresh" as const,
              },
            },
            methodSheet: {
              caseFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
              observationFingerprint: {
                algorithm: "sha256" as const,
                digest: "b".repeat(64),
              },
            },
          },
        });
      },
    },
  });
  const result = await app.handler("project_prescribed_kinematics_method_review")({
    projectId: "project-kinematics",
  }) as { content: string; structuredContent: { selected: { next?: unknown } } };
  assertStringIncludes(result.content, "methodSheet.caseFingerprint");
  assertStringIncludes(result.content, "methodSheet.observationFingerprint");
  assertEquals("next" in result.structuredContent.selected, false);
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
    "project_prescribed_kinematics_run_review",
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
  await app.handler("project_prescribed_kinematics_run_review")({
    projectId: "project-kinematics",
  });
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
    { stage: "run", value: { projectId: "project-kinematics" } },
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
    assertStringIncludes(
      tool.description,
      name === "project_prescribed_kinematics_method_review"
        ? "Read-only preparation/review"
        : "Read-only next-hop review",
    );
  }
  assertEquals(
    Object.keys(
      (app.tool("project_prescribed_kinematics_method_review").inputSchema as {
        properties: Record<string, unknown>;
      }).properties,
    ).sort(),
    ["methodResourceRef", "projectId"],
  );
  assertEquals(
    (app.tool("project_prescribed_kinematics_method_review").inputSchema as {
      required: readonly string[];
    }).required,
    ["projectId"],
  );
  for (
    const name of [
      "project_prescribed_kinematics_run_review",
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
