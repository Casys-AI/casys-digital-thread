import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import type { ProjectModelicaQualifiedKitRunReviewResult } from "../../application/ports/in/modelica/qualified-kit-run-review.ts";
import type { ProjectAdmittedModelicaRunReviewResult } from "../../application/ports/in/modelica/admitted-run-review.ts";
import type { ProjectThermalMethodSheetSealReviewResult } from "../../application/ports/in/modelica/thermal-method-sheet/project-thermal-method-sheet-seal-review.ts";
import type { ProjectAdmittedModelicaEvaluationReviewResult } from "../../application/ports/in/modelica/evaluation/project-admitted-modelica-evaluation-review.ts";
import type { ProjectAdmittedModelicaEvaluationCloseoutReviewResult } from "../../application/ports/in/modelica/evaluation/project-admitted-modelica-evaluation-closeout-review.ts";
import { registerProjectModelicaReviewTools } from "./modelica-review-tools.ts";

const ADMITTED_REVIEW_REQUEST = {
  projectId: "project.drip-tray",
} as const;

const THERMAL_METHOD_SHEET_REVIEW_COMMAND = {
  projectId: "articulated-led-desk-lamp",
  sheetFingerprint: {
    algorithm: "sha256",
    digest: "c".repeat(64),
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

Deno.test("admitted Modelica review exposes only projectId and rejects caller-selected identities", async () => {
  const absent = new CapturingApp();
  registerProjectModelicaReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_admitted_modelica_run_review"), false);

  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    admission: Object.freeze({ marker: "use-case-owned-admitted-modelica" }),
    decisionParameters: Object.freeze([
      Object.freeze({ key: "review.identity", label: "Identity", value: "exact" }),
    ]),
  }) as unknown as ProjectAdmittedModelicaRunReviewResult;
  registerProjectModelicaReviewTools(app as unknown as McpApp, {
    admittedModelicaRunReview: {
      execute(value) {
        calls.push(value);
        return Promise.resolve(resultIdentity);
      },
    },
  });

  const response = await app.handler("project_admitted_modelica_run_review")(
    structuredClone(ADMITTED_REVIEW_REQUEST),
  ) as Record<string, unknown>;
  assert(response.structuredContent === resultIdentity);
  assertEquals(calls, [ADMITTED_REVIEW_REQUEST]);
  assertStringIncludes(response.content as string, "current Thread tip");
  assertStringIncludes(response.content as string, "no source bytes");
  assertStringIncludes(response.content as string, "verbatim");
  assertStringIncludes(response.content as string, "compilationAdmission");

  const tool = app.tool("project_admitted_modelica_run_review");
  assertStringIncludes(tool.description, "Reuse the returned operation verbatim");
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const inputSchema = tool.inputSchema as Record<string, unknown>;
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
    ["projectId"],
  );
  assertEquals(inputSchema.required, ["projectId"]);
  assertClosedObjectSchemas(inputSchema);
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).some((key) =>
      ["sourceText", "modelicaText", "runtime", "profile", "provider"].includes(
        key,
      )
    ),
    false,
  );

  const handler = app.handler("project_admitted_modelica_run_review");
  await assertRejects(
    () =>
      handler({
        ...structuredClone(ADMITTED_REVIEW_REQUEST),
        modelicaText: "model CallerSelected end CallerSelected;",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): modelicaText",
  );
  await assertRejects(
    () =>
      handler({
        ...structuredClone(ADMITTED_REVIEW_REQUEST),
        basis: structuredClone(MODELICA_REVIEW_COMMAND.basis),
        artifactId: `technical-compilation-admission-${"a".repeat(64)}`,
        artifactFingerprint: {
          algorithm: "sha256",
          digest: "a".repeat(64),
        },
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): basis, artifactId, artifactFingerprint",
  );
  assertEquals(calls, [ADMITTED_REVIEW_REQUEST]);
});

Deno.test(
  "admitted observation evaluation review exposes only projectId and rejects SysON/OMC extras",
  async () => {
    const absent = new CapturingApp();
    registerProjectModelicaReviewTools(absent as unknown as McpApp, {});
    assertEquals(
      absent.hasTool("project_admitted_modelica_evaluation_review"),
      false,
    );

    const app = new CapturingApp();
    const calls: unknown[] = [];
    const resultIdentity = Object.freeze({
      admission: Object.freeze({ marker: "use-case-owned-evaluation" }),
      method: Object.freeze({ marker: "method" }),
      decisionParameters: Object.freeze([
        Object.freeze({
          key: "thermal.evaluation.project.id",
          label: "Project",
          value: "articulated-led-desk-lamp",
        }),
      ]),
    }) as unknown as ProjectAdmittedModelicaEvaluationReviewResult;
    registerProjectModelicaReviewTools(app as unknown as McpApp, {
      admittedModelicaEvaluationReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    });

    const response = await app.handler(
      "project_admitted_modelica_evaluation_review",
    )({ projectId: "articulated-led-desk-lamp" }) as Record<string, unknown>;
    assert(response.structuredContent === resultIdentity);
    assertEquals(calls, [{ projectId: "articulated-led-desk-lamp" }]);
    assertStringIncludes(response.content as string, "no OMC");
    assertStringIncludes(response.content as string, "no SysON envelope");

    const tool = app.tool("project_admitted_modelica_evaluation_review");
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
      ["projectId"],
    );
    assertClosedObjectSchemas(inputSchema);

    const handler = app.handler("project_admitted_modelica_evaluation_review");
    await assertRejects(
      () =>
        handler({
          projectId: "articulated-led-desk-lamp",
          provider: "syson",
          tool: "syson_constraint_evaluate",
          args: { constraints: [] },
          modelicaText: "model X end X;",
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s)",
    );
    assertEquals(calls, [{ projectId: "articulated-led-desk-lamp" }]);
  },
);

Deno.test(
  "admitted Modelica evaluation closeout review exposes only projectId and rejects values, units, source, provider, args and consequence",
  async () => {
    const absent = new CapturingApp();
    registerProjectModelicaReviewTools(absent as unknown as McpApp, {});
    assertEquals(
      absent.hasTool("project_admitted_modelica_evaluation_closeout_review"),
      false,
    );

    const app = new CapturingApp();
    const calls: unknown[] = [];
    const resultIdentity = Object.freeze({
      status: "resolved",
      selected: Object.freeze({ marker: "use-case-owned-closeout" }),
    }) as unknown as ProjectAdmittedModelicaEvaluationCloseoutReviewResult;
    registerProjectModelicaReviewTools(app as unknown as McpApp, {
      admittedModelicaEvaluationCloseoutReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    });

    const response = await app.handler(
      "project_admitted_modelica_evaluation_closeout_review",
    )({ projectId: "project.closeout-review" }) as Record<string, unknown>;
    assert(response.structuredContent === resultIdentity);
    assertEquals(calls, [{ projectId: "project.closeout-review" }]);
    assertStringIncludes(response.content as string, "An L4 pass is never implicit L5");
    assertStringIncludes(response.content as string, "no OMC");

    const tool = app.tool("project_admitted_modelica_evaluation_closeout_review");
    assertEquals(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
      ["projectId"],
    );
    assertEquals(inputSchema.required, ["projectId"]);
    assertClosedObjectSchemas(inputSchema);

    const handler = app.handler(
      "project_admitted_modelica_evaluation_closeout_review",
    );
    await assertRejects(
      () =>
        handler({
          projectId: "project.closeout-review",
          value: 80,
          unit: "K",
          source: "caller.mo",
          provider: "syson",
          args: { solver: "dassl" },
          consequence: "accept",
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s)",
    );
    assertEquals(calls, [{ projectId: "project.closeout-review" }]);
  },
);

Deno.test(
  "thermal method-sheet seal review exposes only projectId and sheetFingerprint and rejects extras",
  async () => {
    const absent = new CapturingApp();
    registerProjectModelicaReviewTools(absent as unknown as McpApp, {});
    assertEquals(
      absent.hasTool("project_thermal_method_sheet_seal_review"),
      false,
    );

    const app = new CapturingApp();
    const calls: unknown[] = [];
    const resultIdentity = Object.freeze({
      admission: Object.freeze({ marker: "use-case-owned-thermal-method-sheet" }),
      decisionParameters: Object.freeze([
        Object.freeze({
          key: "thermal.methodSheet.id",
          label: "Thermal method sheet id",
          value: "placeholder-thermal-method-sheet",
        }),
      ]),
    }) as unknown as ProjectThermalMethodSheetSealReviewResult;
    registerProjectModelicaReviewTools(app as unknown as McpApp, {
      thermalMethodSheetSealReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    });

    const response = await app.handler(
      "project_thermal_method_sheet_seal_review",
    )(
      structuredClone(THERMAL_METHOD_SHEET_REVIEW_COMMAND),
    ) as Record<string, unknown>;
    assert(response.structuredContent === resultIdentity);
    assertEquals(calls, [THERMAL_METHOD_SHEET_REVIEW_COMMAND]);
    assertStringIncludes(response.content as string, "no Modelica source bytes");
    assertStringIncludes(response.content as string, "no OMC");
    assertStringIncludes(response.content as string, "not an L4 evaluation");

    const tool = app.tool("project_thermal_method_sheet_seal_review");
    assertEquals(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
      ["projectId", "sheetFingerprint"],
    );
    assertEquals(inputSchema.required, ["projectId", "sheetFingerprint"]);
    assertClosedObjectSchemas(inputSchema);
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).some((key) =>
        [
          "modelicaText",
          "sourceText",
          "runtime",
          "profile",
          "provider",
          "tool",
          "args",
          "basis",
        ].includes(key)
      ),
      false,
    );

    const handler = app.handler("project_thermal_method_sheet_seal_review");
    await assertRejects(
      () =>
        handler({
          ...structuredClone(THERMAL_METHOD_SHEET_REVIEW_COMMAND),
          modelicaText: "model CallerSelected end CallerSelected;",
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s): modelicaText",
    );
    await assertRejects(
      () =>
        handler({
          ...structuredClone(THERMAL_METHOD_SHEET_REVIEW_COMMAND),
          provider: "omc",
          args: { solver: "dassl" },
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s): provider, args",
    );
    assertEquals(calls, [THERMAL_METHOD_SHEET_REVIEW_COMMAND]);
  },
);

Deno.test("qualified Modelica review exposes one closed two-field input and forwards it exactly", async () => {
  const absent = new CapturingApp();
  registerProjectModelicaReviewTools(absent as unknown as McpApp, {});
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
  registerProjectModelicaReviewTools(app as unknown as McpApp, {
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
  registerProjectModelicaReviewTools(app as unknown as McpApp, {
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
}
