import { assert, assertEquals, assertRejects } from "@std/assert";
import { type McpApp, type MCPTool, SchemaValidator } from "@casys/mcp-platform";
import { FileByteStore } from "../../adapters/shared/cas/file-byte-store.ts";
import { FileBuyCostEstimatePreviewEvidenceStore } from "../../adapters/buy/file-buy-cost-estimate-preview-evidence-store.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
} from "../../adapters/buy/file-buy-cost-estimate-preview-evidence-store.ts";
import {
  BoundedBuyCostEstimatePreview,
  BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS,
  ReadBuyCostEstimatePreviewEvidence,
} from "../../application/use-cases/buy/bounded-buy-cost-estimate-preview.ts";
import { validateBuyCostBundleV2 } from "../../domain/buy/buy-cost-bundle-v2.ts";
import { validateBuyProductionEstimateBundle } from "../../domain/buy/buy-production-estimate.ts";
import {
  genuinePreviewResult,
  PREVIEW_TEST_BASIS,
  PREVIEW_TEST_CANDIDATE_DIGEST,
  PREVIEW_TEST_PROJECT_ID,
} from "../../testing/buy-cost-estimate-preview-test-support.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME,
  BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME,
  registerProjectBuyEstimatePreviewTools,
} from "./buy-estimate-preview-tools.ts";
import { READ_ONLY_ANNOTATIONS } from "./mcp-tool-schemas.ts";

function capturingApp() {
  const tools = new Map<string, MCPTool>();
  const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
  const app = {
    registerTool: (tool: MCPTool, handler: (args: unknown) => Promise<unknown>) => {
      tools.set(tool.name, tool);
      handlers.set(tool.name, handler);
    },
    tool: (name: string) => tools.get(name)!,
    has: (name: string) => tools.has(name),
    handle: (name: string, args: unknown) => handlers.get(name)!(args),
  };
  return app as unknown as McpApp & {
    tool(name: string): MCPTool;
    has(name: string): boolean;
    handle(name: string, args: unknown): Promise<unknown>;
  };
}

async function wired() {
  const directory = await Deno.makeTempDir({ prefix: "buy-preview-tools-" });
  const store = new FileBuyCostEstimatePreviewEvidenceStore(
    new FileByteStore({
      kind: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
      directory,
      uriNamespace: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
      label: "test buy estimate preview evidence",
    }),
  );
  const { inputRefs, result } = await genuinePreviewResult();
  const app = capturingApp();
  registerProjectBuyEstimatePreviewTools(app, {
    costEstimatePreview: new BoundedBuyCostEstimatePreview(
      { execute: () => Promise.resolve(structuredClone(result) as never) },
      store,
    ),
    costEstimatePreviewDetail: new ReadBuyCostEstimatePreviewEvidence(store),
  });
  return {
    app,
    command: {
      projectId: PREVIEW_TEST_PROJECT_ID,
      basis: { ...PREVIEW_TEST_BASIS },
      candidateArtifactId: `buy-cost-candidate-${PREVIEW_TEST_CANDIDATE_DIGEST}`,
      candidateFingerprint: {
        algorithm: "sha256",
        digest: PREVIEW_TEST_CANDIDATE_DIGEST,
      },
      estimateRefs: inputRefs,
    },
  };
}

Deno.test("preview tools stay absent without dependencies", () => {
  const app = capturingApp();
  registerProjectBuyEstimatePreviewTools(app, {});
  assertEquals(app.has(BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME), false);
  assertEquals(app.has(BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME), false);
});

Deno.test("preview summary output validates and advertises no authority", async () => {
  const { app, command } = await wired();
  for (
    const name of [
      BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME,
      BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME,
    ]
  ) {
    assertEquals(app.has(name), true);
    const annotations = name === BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME
      ? { ...READ_ONLY_ANNOTATIONS, readOnlyHint: false }
      : READ_ONLY_ANNOTATIONS;
    assertEquals(app.tool(name).annotations, annotations);
    assertEquals(app.tool(name).annotations?.readOnlyHint, annotations.readOnlyHint);
  }
  const out = await app.handle(BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME, command) as {
    content: string;
    structuredContent: Record<string, unknown>;
  };
  const compiled = new SchemaValidator().compileSchema(
    app.tool(BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME).outputSchema as Record<
      string,
      unknown
    >,
  );
  const checked = compiled.validate(out.structuredContent);
  assertEquals(checked.valid, true, JSON.stringify(checked.errors));
  assertEquals("decisionParameters" in out.structuredContent, false);
  assertEquals("operation" in out.structuredContent, false);
  assert(out.content.includes("no registered seal"));
});

Deno.test("every detail section validates and agrees with domain parsers", async () => {
  const { app, command } = await wired();
  const summary = await app.handle(BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME, command) as {
    structuredContent: {
      evidenceRef: Record<string, unknown>;
    };
  };
  const compiled = new SchemaValidator().compileSchema(
    app.tool(BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME).outputSchema as Record<
      string,
      unknown
    >,
  );
  for (const section of BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS) {
    const out = await app.handle(BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME, {
      projectId: PREVIEW_TEST_PROJECT_ID,
      evidenceRef: summary.structuredContent.evidenceRef,
      section,
    }) as {
      structuredContent: {
        section: string;
        items: Array<Record<string, unknown>>;
      };
    };
    const checked = compiled.validate(out.structuredContent);
    assertEquals(checked.valid, true, `${section}: ${JSON.stringify(checked.errors)}`);
    assertEquals("decisionParameters" in out.structuredContent, false);
    if (section === "full-evidence") {
      const full = out.structuredContent.items[0] as {
        bundle: unknown;
        annexes: unknown[];
      };
      validateBuyCostBundleV2(full.bundle);
      for (const annex of full.annexes) validateBuyProductionEstimateBundle(annex);
    }
    if (section === "lines") {
      for (const line of out.structuredContent.items) {
        assertEquals("decisionParameters" in line, false);
      }
    }
  }
});

Deno.test("mutated nested output fails schema validation and strict reads refuse", async () => {
  const { app, command } = await wired();
  const summary = await app.handle(BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME, command) as {
    structuredContent: {
      evidenceRef: Record<string, unknown>;
      samples: { gaps: Array<Record<string, unknown>>; omittedGaps: number };
    };
  };
  const compiled = new SchemaValidator().compileSchema(
    app.tool(BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME).outputSchema as Record<
      string,
      unknown
    >,
  );
  const mutated = {
    ...summary.structuredContent,
    samples: {
      gaps: [{ code: "invented-code", message: "x".repeat(201) }],
      omittedGaps: 0,
    },
  };
  assertEquals(compiled.validate(mutated).valid, false);
  const withTermGap = {
    ...summary.structuredContent,
    samples: {
      gaps: [{
        code: "unpriced-component",
        message: "Term material.bracket consumption is unknown and is not free.",
        lineId: "line.bracket",
        termId: "material.bracket",
      }],
      omittedGaps: 0,
    },
  };
  const termChecked = compiled.validate(withTermGap);
  assertEquals(termChecked.valid, true, JSON.stringify(termChecked.errors));
  await assertRejects(
    () =>
      app.handle(BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME, {
        projectId: PREVIEW_TEST_PROJECT_ID,
        evidenceRef: summary.structuredContent.evidenceRef,
        section: "lines",
        cursor: "0".repeat(63),
      }),
    TypeError,
    "invalid or foreign",
  );
  await assertRejects(
    () =>
      app.handle(BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME, {
        projectId: PREVIEW_TEST_PROJECT_ID,
        evidenceRef: summary.structuredContent.evidenceRef,
        section: "lines",
        inventedField: true,
      }),
    TypeError,
    "unsupported field",
  );
});
