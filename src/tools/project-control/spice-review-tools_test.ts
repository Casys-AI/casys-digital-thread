import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import type { ProjectAdmittedSpiceRunReviewResult } from "../../application/ports/in/electrical/spice/admitted-run-review.ts";
import type { ProjectAdmittedSpiceEvaluationReviewResult } from "../../application/ports/in/electrical/spice/evaluation/project-admitted-spice-evaluation-review.ts";
import type { ProjectAdmittedSpiceEvaluationCloseoutReviewResult } from "../../application/ports/in/electrical/spice/evaluation/project-admitted-spice-evaluation-closeout-review.ts";
import type { ProjectElectricalObservationMethodSheetSealReviewResult } from "../../application/ports/in/electrical/observation-method-sheet/project-electrical-observation-method-sheet-seal-review.ts";
import { registerProjectSpiceReviewTools } from "./spice-review-tools.ts";

const ADMITTED_REVIEW_REQUEST = {
  projectId: "project.spice-al01",
} as const;

Deno.test("admitted SPICE review exposes only projectId and rejects caller-selected identities", async () => {
  const absent = new CapturingApp();
  registerProjectSpiceReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_admitted_spice_run_review"), false);

  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    admission: Object.freeze({ marker: "use-case-owned-admitted-spice" }),
    decisionParameters: Object.freeze([
      Object.freeze({ key: "review.identity", label: "Identity", value: "exact" }),
    ]),
  }) as unknown as ProjectAdmittedSpiceRunReviewResult;
  registerProjectSpiceReviewTools(app as unknown as McpApp, {
    admittedSpiceRunReview: {
      execute(value) {
        calls.push(value);
        return Promise.resolve(resultIdentity);
      },
    },
  });

  const response = await app.handler("project_admitted_spice_run_review")(
    structuredClone(ADMITTED_REVIEW_REQUEST),
  ) as Record<string, unknown>;
  assert(response.structuredContent === resultIdentity);
  assertEquals(calls, [ADMITTED_REVIEW_REQUEST]);
  assertStringIncludes(response.content as string, "current Thread tip");
  assertStringIncludes(response.content as string, "no source bytes");
  assertStringIncludes(response.content as string, "not mcp-spice");
  assertStringIncludes(response.content as string, "verbatim");
  assertStringIncludes(response.content as string, "compilationAdmission");

  const tool = app.tool("project_admitted_spice_run_review");
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
  assertEquals(inputSchema.additionalProperties, false);

  const handler = app.handler("project_admitted_spice_run_review");
  for (
    const extra of [
      { sourceText: "Vin in 0 5" },
      { image: "casys/ngspice-microsandbox-worker:latest" },
      { runtime: "ngspice" },
      { args: [".op"] },
      { path: "/input/source.cir" },
      { observations: ["v(out)"] },
      { source: "caller" },
    ]
  ) {
    await assertRejects(
      () =>
        handler({
          ...structuredClone(ADMITTED_REVIEW_REQUEST),
          ...extra,
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s)",
    );
  }
  assertEquals(calls, [ADMITTED_REVIEW_REQUEST]);
});

Deno.test(
  "admitted SPICE evaluation review exposes only projectId and rejects provider/tool/args",
  async () => {
    const absent = new CapturingApp();
    registerProjectSpiceReviewTools(absent as unknown as McpApp, {});
    assertEquals(
      absent.hasTool("project_admitted_spice_evaluation_review"),
      false,
    );

    const app = new CapturingApp();
    const calls: unknown[] = [];
    const resultIdentity = Object.freeze({
      admission: Object.freeze({ marker: "use-case-owned-evaluation" }),
      method: Object.freeze({ marker: "method" }),
      decisionParameters: Object.freeze([
        Object.freeze({
          key: "electrical.evaluation.project.id",
          label: "Project",
          value: "project.spice-al01",
        }),
      ]),
    }) as unknown as ProjectAdmittedSpiceEvaluationReviewResult;
    registerProjectSpiceReviewTools(app as unknown as McpApp, {
      admittedSpiceEvaluationReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    });

    const response = await app.handler("project_admitted_spice_evaluation_review")(
      { projectId: "project.spice-al01" },
    ) as Record<string, unknown>;
    assert(response.structuredContent === resultIdentity);
    assertEquals(calls, [{ projectId: "project.spice-al01" }]);
    const tool = app.tool("project_admitted_spice_evaluation_review");
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
      ["projectId"],
    );
    await assertRejects(
      () =>
        app.handler("project_admitted_spice_evaluation_review")({
          projectId: "project.spice-al01",
          provider: "ngspice",
          tool: "simulate.run-admitted-spice@1",
          args: { image: "latest" },
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s)",
    );
    assertEquals(calls, [{ projectId: "project.spice-al01" }]);
  },
);

Deno.test(
  "admitted SPICE evaluation closeout review exposes only projectId and rejects consequence, values and provider",
  async () => {
    const app = new CapturingApp();
    const calls: unknown[] = [];
    const resultIdentity = Object.freeze({
      status: "resolved",
      selected: Object.freeze({ marker: "use-case-owned-closeout" }),
    }) as unknown as ProjectAdmittedSpiceEvaluationCloseoutReviewResult;
    registerProjectSpiceReviewTools(app as unknown as McpApp, {
      admittedSpiceEvaluationCloseoutReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    });
    const response = await app.handler(
      "project_admitted_spice_evaluation_closeout_review",
    )({ projectId: "project.spice-closeout-review" }) as Record<string, unknown>;
    assert(response.structuredContent === resultIdentity);
    assertEquals(calls, [{ projectId: "project.spice-closeout-review" }]);
    assertStringIncludes(
      response.content as string,
      "An L4 pass is never implicit L5",
    );
    const inputSchema = app.tool("project_admitted_spice_evaluation_closeout_review")
      .inputSchema as Record<string, unknown>;
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
      ["projectId"],
    );
    await assertRejects(
      () =>
        app.handler("project_admitted_spice_evaluation_closeout_review")({
          projectId: "project.spice-closeout-review",
          consequence: "accept",
          provider: "ngspice",
          value: 3,
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s)",
    );
  },
);

Deno.test(
  "electrical method-sheet seal review exposes only projectId and sheetFingerprint",
  async () => {
    const app = new CapturingApp();
    const calls: unknown[] = [];
    const resultIdentity = Object.freeze({
      admission: Object.freeze({ marker: "sheet-seal" }),
      decisionParameters: Object.freeze([]),
    }) as unknown as ProjectElectricalObservationMethodSheetSealReviewResult;
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: "a".repeat(64),
    };
    registerProjectSpiceReviewTools(app as unknown as McpApp, {
      electricalObservationMethodSheetSealReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    });
    const response = await app.handler(
      "project_electrical_observation_method_sheet_seal_review",
    )({
      projectId: "project.spice-al01",
      sheetFingerprint: fingerprint,
    }) as Record<string, unknown>;
    assert(response.structuredContent === resultIdentity);
    assertEquals(calls, [{
      projectId: "project.spice-al01",
      sheetFingerprint: fingerprint,
    }]);
    const inputSchema = app.tool(
      "project_electrical_observation_method_sheet_seal_review",
    ).inputSchema as Record<string, unknown>;
    assertEquals(
      Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
      ["projectId", "sheetFingerprint"],
    );
    await assertRejects(
      () =>
        app.handler("project_electrical_observation_method_sheet_seal_review")({
          projectId: "project.spice-al01",
          sheetFingerprint: fingerprint,
          provider: "ngspice",
        }) as Promise<unknown>,
      TypeError,
      "unsupported field(s)",
    );
  },
);

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
