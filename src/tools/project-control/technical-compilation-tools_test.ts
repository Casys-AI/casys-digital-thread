import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import type { ProjectBuild123dExecutionReviewResult } from "../../application/ports/in/project-build123d-execution-review.ts";
import type { ProjectModelicaQualifiedKitRunReviewResult } from "../../application/ports/in/project-modelica-qualified-kit-run-review.ts";
import { registerProjectTechnicalCompilationTools } from "./technical-compilation-tools.ts";

const ARTIFACT_DIGEST = "a".repeat(64);
const REVIEW_COMMAND = {
  projectId: "project.drip-tray",
  basis: {
    kind: "thread-snapshot",
    snapshotId: "snapshot.9",
    revision: 9,
    subjectId: "subject.drip-tray",
  },
  artifactId: `technical-compilation-admission-${ARTIFACT_DIGEST}`,
  artifactFingerprint: {
    algorithm: "sha256",
    digest: ARTIFACT_DIGEST,
  },
} as const;

const MODELICA_REVIEW_COMMAND = {
  projectId: "project.drip-tray",
  basis: {
    kind: "thread-snapshot",
    snapshotId: "snapshot.9",
    revision: 9,
    subjectId: "subject.drip-tray",
  },
} as const;

Deno.test("Build123d execution review registration is conditional and preserves the existing technical tool order", () => {
  const absent = new CapturingApp();
  registerProjectTechnicalCompilationTools(
    absent as unknown as McpApp,
    {},
  );
  assertEquals(absent.hasTool("project_build123d_execution_review"), false);

  const ordered = new CapturingApp();
  registerProjectTechnicalCompilationTools(
    ordered as unknown as McpApp,
    {
      technicalSourceCapture: {
        capture: () => Promise.reject(new Error("not called")),
      },
      technicalCompilationPreview: {
        execute: () => Promise.reject(new Error("not called")),
      },
      build123dExecutionReview: {
        execute: () => Promise.reject(new Error("not called")),
      },
    },
  );

  assertEquals(ordered.toolNames(), [
    "project_technical_source_capture",
    "project_technical_compilation_preview",
    "project_build123d_execution_review",
  ]);
});

Deno.test("Build123d execution review forwards exact identity and passes through the use-case result", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    admission: Object.freeze({ marker: "use-case-owned-admission" }),
    decisionParameters: Object.freeze([
      Object.freeze({ key: "review.identity", label: "Identity", value: "exact" }),
    ]),
  }) as unknown as ProjectBuild123dExecutionReviewResult;

  registerProjectTechnicalCompilationTools(
    app as unknown as McpApp,
    {
      build123dExecutionReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    },
  );

  const response = await app.handler("project_build123d_execution_review")(
    structuredClone(REVIEW_COMMAND),
  ) as Record<string, unknown>;
  assert(response.structuredContent === resultIdentity);
  assertEquals(calls, [REVIEW_COMMAND]);
  assertStringIncludes(response.content as string, REVIEW_COMMAND.artifactId);
  assertStringIncludes(response.content as string, "no source bytes");
  assertStringIncludes(response.content as string, "no code was executed");
  assertStringIncludes(response.content as string, "no EngineeringProject");
  assertStringIncludes(response.content as string, "no MRTR");
  assertStringIncludes(response.content as string, "dispatch authority");

  const tool = app.tool("project_build123d_execution_review");
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assertStringIncludes(tool.description, "performs no code execution");
  assertStringIncludes(tool.description, "returns no source bytes");
  const inputSchema = tool.inputSchema as Record<string, unknown>;
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
    ["artifactFingerprint", "artifactId", "basis", "projectId"],
  );
  assertClosedObjectSchemas(inputSchema);
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).some((key) =>
      [
        "sourceText",
        "runtime",
        "profile",
        "provider",
        "toolName",
        "arguments",
        "path",
      ].includes(key)
    ),
    false,
  );
});

Deno.test("Build123d execution review rejects unknown authority fields before the use case", async () => {
  const app = new CapturingApp();
  let calls = 0;
  registerProjectTechnicalCompilationTools(
    app as unknown as McpApp,
    {
      build123dExecutionReview: {
        execute: () => {
          calls += 1;
          return Promise.reject(new Error("must not be called"));
        },
      },
    },
  );
  const handler = app.handler("project_build123d_execution_review");

  await assertRejects(
    () =>
      handler({
        ...structuredClone(REVIEW_COMMAND),
        sourceText: "from build123d import Box",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): sourceText",
  );

  const nestedAuthority = structuredClone(REVIEW_COMMAND) as Record<
    string,
    unknown
  >;
  (nestedAuthority.basis as Record<string, unknown>).runtime = {
    image: "caller-selected",
  };
  await assertRejects(
    () => handler(nestedAuthority) as Promise<unknown>,
    TypeError,
    "basis has unsupported field(s): runtime",
  );
  assertEquals(calls, 0);
});

Deno.test("qualified Modelica review exposes one closed two-field input and forwards it exactly", async () => {
  const absent = new CapturingApp();
  registerProjectTechnicalCompilationTools(absent as unknown as McpApp, {});
  assertEquals(
    absent.hasTool("project_modelica_qualified_kit_run_review"),
    false,
  );

  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    admission: Object.freeze({ marker: "use-case-owned-modelica-admission" }),
    decisionParameters: Object.freeze([
      Object.freeze({ key: "review.identity", label: "Identity", value: "exact" }),
    ]),
  }) as unknown as ProjectModelicaQualifiedKitRunReviewResult;
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    modelicaQualifiedKitRunReview: {
      execute(value) {
        calls.push(value);
        return Promise.resolve(resultIdentity);
      },
    },
  });

  const response = await app.handler(
    "project_modelica_qualified_kit_run_review",
  )(structuredClone(MODELICA_REVIEW_COMMAND)) as Record<string, unknown>;
  assert(response.structuredContent === resultIdentity);
  assertEquals(calls, [MODELICA_REVIEW_COMMAND]);
  assertStringIncludes(response.content as string, "no source bytes");
  assertStringIncludes(response.content as string, "no simulation ran");
  assertStringIncludes(response.content as string, "no dispatch authority");

  const tool = app.tool("project_modelica_qualified_kit_run_review");
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const inputSchema = tool.inputSchema as Record<string, unknown>;
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
    ["basis", "projectId"],
  );
  assertClosedObjectSchemas(inputSchema);
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).some((key) =>
      [
        "sourceText",
        "modelicaText",
        "kit",
        "scenario",
        "runtime",
        "profile",
        "provider",
        "toolName",
        "arguments",
      ].includes(key)
    ),
    false,
  );
});

Deno.test("qualified Modelica review rejects caller-selected model and runtime fields before its use case", async () => {
  const app = new CapturingApp();
  let calls = 0;
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    modelicaQualifiedKitRunReview: {
      execute: () => {
        calls += 1;
        return Promise.reject(new Error("must not be called"));
      },
    },
  });
  const handler = app.handler("project_modelica_qualified_kit_run_review");

  await assertRejects(
    () =>
      handler({
        ...structuredClone(MODELICA_REVIEW_COMMAND),
        modelicaText: "model CallerSelected end CallerSelected;",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): modelicaText",
  );
  const nestedAuthority = structuredClone(MODELICA_REVIEW_COMMAND) as Record<
    string,
    unknown
  >;
  (nestedAuthority.basis as Record<string, unknown>).runtime = {
    image: "caller-selected",
  };
  await assertRejects(
    () => handler(nestedAuthority) as Promise<unknown>,
    TypeError,
    "basis has unsupported field(s): runtime",
  );
  assertEquals(calls, 0);
});

function assertClosedObjectSchemas(schema: Record<string, unknown>): void {
  if (schema.type === "object") {
    assertEquals(
      schema.additionalProperties,
      false,
      "Every technical review input object must reject unknown fields.",
    );
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return;
  }
  for (const value of Object.values(properties)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertClosedObjectSchemas(value as Record<string, unknown>);
    }
  }
}

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected ${name} handler to be registered.`);
    return handler;
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    assert(tool, `Expected ${name} tool to be registered.`);
    return tool;
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  toolNames(): string[] {
    return [...this.#tools.keys()];
  }
}
