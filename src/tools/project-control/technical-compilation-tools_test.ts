import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import type { ProjectAdmittedGeometryExportResult } from "../../application/ports/in/cad/canonical/project-admitted-geometry-export.ts";
import type { ProjectBuild123dExecutionReviewResult } from "../../application/ports/in/cad/isolated/project-build123d-execution-review.ts";
import type { ProjectIsolatedGeometrySealReviewResult } from "../../application/ports/in/cad/sealed-isolated/project-isolated-geometry-seal-review.ts";
import { ProjectTechnicalSourceCaptureError } from "../../application/ports/in/compile/admission/project-technical-source-capture.ts";
import { sampleTechnicalSourceAnalysisCaptureLocator } from "../../testing/technical-source-capture-test-support.ts";
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

const SEAL_REVIEW_COMMAND = {
  projectId: "project.drip-tray",
  basis: {
    kind: "thread-snapshot",
    snapshotId: "snapshot.9",
    revision: 9,
    subjectId: "subject.drip-tray",
  },
  artifactId: `build123d-execution-capture-${ARTIFACT_DIGEST}`,
  artifactFingerprint: {
    algorithm: "sha256",
    digest: ARTIFACT_DIGEST,
  },
} as const;

const TECHNICAL_SOURCE_CAPTURE_REFERENCE =
  sampleTechnicalSourceAnalysisCaptureLocator();

Deno.test("Build123d execution review registration is conditional and preserves the existing technical tool order", () => {
  const absent = new CapturingApp();
  registerProjectTechnicalCompilationTools(
    absent as unknown as McpApp,
    {},
  );
  assertEquals(absent.hasTool("project_build123d_execution_review"), false);
  assertEquals(absent.hasTool("project_isolated_geometry_seal_review"), false);
  assertEquals(absent.hasTool("project_admitted_geometry_export"), false);
  assertEquals(absent.hasTool("project_admitted_geometry_export_preflight"), false);

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
      admittedGeometryExport: {
        execute: () => Promise.reject(new Error("not called")),
      },
      admittedGeometryExportPreflight: {
        execute: () => Promise.reject(new Error("not called")),
      },
      build123dExecutionReview: {
        execute: () => Promise.reject(new Error("not called")),
      },
      isolatedGeometrySealReview: {
        execute: () => Promise.reject(new Error("not called")),
      },
    },
  );

  assertEquals(ordered.toolNames(), [
    "project_technical_source_capture",
    "project_technical_compilation_preview",
    "project_admitted_geometry_export",
    "project_admitted_geometry_export_preflight",
    "project_build123d_execution_review",
    "project_isolated_geometry_seal_review",
  ]);
});

Deno.test("admitted geometry export registration is conditional and rejects caller-selected source authority", async () => {
  const absent = new CapturingApp();
  registerProjectTechnicalCompilationTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_admitted_geometry_export"), false);

  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    draftDigest: ARTIFACT_DIGEST,
    assemblyFiles: Object.freeze([]),
    partMeshes: Object.freeze([]),
    sourceAnalysis: Object.freeze({
      sourceId: "geometry-source:assembly",
      selector: Object.freeze({ kind: "assembly" }),
      sourceDigest: ARTIFACT_DIGEST,
      sourceCaptureDigest: ARTIFACT_DIGEST,
      analysisDigest: ARTIFACT_DIGEST,
    }),
    decisionParameters: Object.freeze([
      Object.freeze({
        key: "geometry.draft.digest",
        label: "Draft SHA-256 digest",
        value: ARTIFACT_DIGEST,
      }),
    ]),
  }) as unknown as ProjectAdmittedGeometryExportResult;
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    admittedGeometryExport: {
      execute(value) {
        calls.push(value);
        return Promise.resolve(resultIdentity);
      },
    },
  });

  const response = await app.handler("project_admitted_geometry_export")(
    structuredClone(REVIEW_COMMAND),
  ) as Record<string, unknown>;
  assert(response.structuredContent === resultIdentity);
  assertEquals(calls, [REVIEW_COMMAND]);
  assertStringIncludes(response.content as string, REVIEW_COMMAND.artifactId);
  assertStringIncludes(response.content as string, "geometry draft");
  assertStringIncludes(response.content as string, "no source text");
  assertStringIncludes(response.content as string, "not Thread");
  assertStringIncludes(response.content as string, "design.write-geometry@1");

  const tool = app.tool("project_admitted_geometry_export");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assertStringIncludes(tool.description, "exact admitted source bytes");
  assertStringIncludes(tool.description, "geometry DRAFT");
  assertStringIncludes(tool.description, "design.write-geometry@1");
  assertEquals(tool.description.includes("design.execute-build123d@1"), true);
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
        "script",
        "provider",
        "toolName",
        "path",
        "image",
        "formats",
      ].includes(key)
    ),
    false,
  );

  let rejectedCalls = 0;
  const rejecting = new CapturingApp();
  registerProjectTechnicalCompilationTools(rejecting as unknown as McpApp, {
    admittedGeometryExport: {
      execute: () => {
        rejectedCalls += 1;
        return Promise.reject(new Error("must not be called"));
      },
    },
  });
  const handler = rejecting.handler("project_admitted_geometry_export");
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
  (nestedAuthority.basis as Record<string, unknown>).image = "caller-selected";
  await assertRejects(
    () => handler(nestedAuthority) as Promise<unknown>,
    TypeError,
    "basis has unsupported field(s): image",
  );
  assertEquals(rejectedCalls, 0);
});

Deno.test("Build123d execution review forwards exact identity and passes through the use-case result", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    admission: Object.freeze({ marker: "use-case-owned-admission" }),
    decisionParameters: Object.freeze([
      Object.freeze({ key: "review.identity", label: "Identity", value: "exact" }),
    ]),
    operation: Object.freeze({
      id: "design.execute-build123d",
      version: "1",
      bindings: Object.freeze([
        Object.freeze({
          name: "compilationAdmission",
          source: Object.freeze({
            kind: "thread-entity",
            reference: Object.freeze({
              snapshotId: REVIEW_COMMAND.basis.snapshotId,
              snapshotRevision: REVIEW_COMMAND.basis.revision,
              kind: "artifact",
              id: REVIEW_COMMAND.artifactId,
            }),
          }),
        }),
      ]),
    }),
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
  assertEquals(
    (response.structuredContent as ProjectBuild123dExecutionReviewResult)
      .operation,
    resultIdentity.operation,
  );
  assertEquals(calls, [REVIEW_COMMAND]);
  assertStringIncludes(response.content as string, REVIEW_COMMAND.artifactId);
  assertStringIncludes(response.content as string, "verbatim");
  assertStringIncludes(response.content as string, "compilationAdmission");
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
  assertStringIncludes(tool.description, "Reuse the returned operation verbatim");
  assertStringIncludes(tool.description, "compilationAdmission");
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

Deno.test("isolated geometry seal review forwards exact identity and stays read-only", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const resultIdentity = Object.freeze({
    admission: Object.freeze({ marker: "use-case-owned-seal-admission" }),
    decisionParameters: Object.freeze([
      Object.freeze({ key: "review.identity", label: "Identity", value: "exact" }),
    ]),
  }) as unknown as ProjectIsolatedGeometrySealReviewResult;

  registerProjectTechnicalCompilationTools(
    app as unknown as McpApp,
    {
      isolatedGeometrySealReview: {
        execute(value) {
          calls.push(value);
          return Promise.resolve(resultIdentity);
        },
      },
    },
  );

  const response = await app.handler("project_isolated_geometry_seal_review")(
    structuredClone(SEAL_REVIEW_COMMAND),
  ) as Record<string, unknown>;
  assert(response.structuredContent === resultIdentity);
  assertEquals(calls, [SEAL_REVIEW_COMMAND]);
  assertStringIncludes(response.content as string, SEAL_REVIEW_COMMAND.artifactId);
  assertStringIncludes(response.content as string, "no source bytes");
  assertStringIncludes(response.content as string, "no MRTR");

  const tool = app.tool("project_isolated_geometry_seal_review");
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const inputSchema = tool.inputSchema as Record<string, unknown>;
  assertEquals(
    Object.keys(inputSchema.properties as Record<string, unknown>).sort(),
    ["artifactFingerprint", "artifactId", "basis", "projectId"],
  );
  assertClosedObjectSchemas(inputSchema);
});

Deno.test("isolated geometry seal review rejects unknown authority fields before the use case", async () => {
  const app = new CapturingApp();
  let calls = 0;
  registerProjectTechnicalCompilationTools(
    app as unknown as McpApp,
    {
      isolatedGeometrySealReview: {
        execute: () => {
          calls += 1;
          return Promise.reject(new Error("must not be called"));
        },
      },
    },
  );
  const handler = app.handler("project_isolated_geometry_seal_review");

  await assertRejects(
    () =>
      handler({
        ...structuredClone(SEAL_REVIEW_COMMAND),
        sourceText: "from build123d import Box",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): sourceText",
  );
  assertEquals(calls, 0);
});

Deno.test("technical source capture accepts only attachmentId,attachmentRevision,projectId,workspaceRevision", () => {
  const app = new CapturingApp();
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    technicalSourceCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
    technicalCompilationPreview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  const capture = app.tool("project_technical_source_capture");
  const captureInput = capture.inputSchema as Record<string, unknown>;
  assertEquals(
    Object.keys(captureInput.properties as Record<string, unknown>).sort(),
    ["attachmentId", "attachmentRevision", "projectId", "workspaceRevision"],
  );
  assertEquals(captureInput.required, [
    "projectId",
    "workspaceRevision",
    "attachmentId",
    "attachmentRevision",
  ]);
  assertEquals(captureInput.additionalProperties, false);
  assertEquals(
    "sourceText" in (captureInput.properties as Record<string, unknown>),
    false,
  );
  assertEquals(
    Object.keys(captureInput.properties as Record<string, unknown>).some((key) =>
      [
        "provider",
        "tool",
        "runtime",
        "image",
        "ngspice",
        "profileId",
        "sourceId",
        "resourceRef",
        "fileId",
        "fileRevision",
      ].includes(key)
    ),
    false,
  );
  const preview = app.tool("project_technical_compilation_preview");
  assertStringIncludes(preview.description, "compile.seal-admission@3");
  assertStringIncludes(preview.description, "Reuse that operation verbatim");
  assertStringIncludes(preview.description, "sysmlModel");
  const previewInput = preview.inputSchema as Record<string, unknown>;
  assertEquals(
    Object.keys(previewInput.properties as Record<string, unknown>).includes(
      "profileRequests",
    ),
    false,
  );
  const previewOutput = preview.outputSchema as Record<string, unknown>;
  assertEquals(previewOutput.additionalProperties, false);
  const previewSamples = (previewOutput.properties as Record<string, unknown>)
    .samples as Record<string, unknown>;
  const sampleProperties = previewSamples.properties as Record<string, unknown>;
  assertEquals(
    ((sampleProperties.diagnostics as Record<string, unknown>).maxItems as number) <= 8,
    true,
  );
  assertEquals("$defs" in previewOutput, true);
  const reference = (capture.outputSchema as {
    properties: {
      reference: {
        properties: {
          schemaVersion: { const: string };
          kind: { const: string };
        };
      };
    };
  }).properties.reference.properties;
  assertEquals(
    reference.schemaVersion.const,
    "technical-source-analysis-capture-locator/4.0",
  );
  assertEquals(
    reference.kind.const,
    "technical-source-analysis-capture-locator",
  );
});

Deno.test("technical source capture exposes an exact lowerer rejection to MCP", async () => {
  const app = new CapturingApp();
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    technicalSourceCapture: {
      capture: () =>
        Promise.reject(
          new ProjectTechnicalSourceCaptureError(
            "workspace_import_not_prelude",
            "Workspace imports must form one leading module-level prelude.",
          ),
        ),
    },
  });

  await assertRejects(
    () =>
      app.handler("project_technical_source_capture")({
        projectId: "project.drip-tray",
        workspaceRevision: 2,
        attachmentId: "att.source.cad",
        attachmentRevision: 1,
      }) as Promise<unknown>,
    TypeError,
    "project_technical_source_capture rejected (workspace_import_not_prelude)",
  );
});

Deno.test("technical compilation evidence detail is read-only, exact, and explicit", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const evidenceRef = {
    schemaVersion: "technical-compilation-preview-evidence-reference/1.0",
    projectId: "project.drip-tray",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    byteCount: 246612,
  } as const;
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    technicalCompilationPreviewEvidence: {
      execute(value) {
        calls.push(value);
        const input = value as { section: string; cursor?: string };
        return Promise.resolve({
          section: input.section,
          items: input.section === "full-evidence"
            ? [{ document: "explicit" }]
            : [{ code: "binding.missing" }],
          nextCursor: input.section === "diagnostics" && !input.cursor
            ? "c".repeat(64)
            : null,
        });
      },
    },
  });
  const tool = app.tool("project_technical_compilation_preview_detail");
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "cursor",
    "evidenceRef",
    "projectId",
    "section",
  ]);
  assertEquals(schema.additionalProperties, false);
  assertEquals(
    ((schema.properties as Record<string, unknown>).cursor as Record<string, unknown>)
      .maxLength,
    64,
  );
  const output = tool.outputSchema as Record<string, unknown>;
  assertEquals(Array.isArray(output.oneOf), true);
  assertEquals((output.oneOf as unknown[]).length, 8);
  const page = await app.handler("project_technical_compilation_preview_detail")({
    projectId: "project.drip-tray",
    evidenceRef,
    section: "diagnostics",
  }) as Record<string, unknown>;
  assertEquals(
    (page.structuredContent as Record<string, unknown>).nextCursor,
    "c".repeat(64),
  );
  const full = await app.handler("project_technical_compilation_preview_detail")({
    projectId: "project.drip-tray",
    evidenceRef,
    section: "full-evidence",
  }) as Record<string, unknown>;
  assertEquals((full.structuredContent as Record<string, unknown>).items, [{
    document: "explicit",
  }]);
  await assertRejects(
    () =>
      app.handler("project_technical_compilation_preview_detail")({
        projectId: "project.drip-tray",
        evidenceRef,
        section: "diagnostics",
        provider: "caller-owned",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): provider",
  );
  assertEquals(calls.length, 2);
});

Deno.test("raw preview tool responses stay bounded and exclude full evidence for every status", async () => {
  const app = new CapturingApp();
  const statuses = ["unresolved", "rejected", "ready-for-review"] as const;
  let index = 0;
  registerProjectTechnicalCompilationTools(app as unknown as McpApp, {
    technicalCompilationPreview: {
      execute: () => {
        const status = statuses[index++ % statuses.length];
        return Promise.resolve({
          schemaVersion: "technical-compilation-preview-summary/1.0",
          status,
          evidenceRef: {
            schemaVersion: "technical-compilation-preview-evidence-reference/1.0",
            projectId: "project.drip-tray",
            fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
            byteCount: 246612,
          },
          evidenceBytes: 246612,
          counts: {
            sources: 11,
            projections: 52,
            diagnostics: 946,
            gaps: 946,
            diagnosticsByCode: { "binding.missing": 946 },
            gapsByCode: { "binding.missing": 946 },
          },
          samples: {
            diagnostics: [{
              code: "binding.missing",
              subjectRef: "parameter.thickness",
            }],
            gaps: [{
              code: "binding.missing",
              recovery: "Declare the AttributeUsage.",
            }],
            omittedDiagnostics: 945,
            omittedGaps: 945,
          },
          requiresFullEvidenceForMrtr: status === "ready-for-review",
        }) as never;
      },
    },
  });
  for (const status of statuses) {
    const response = await app.handler("project_technical_compilation_preview")({
      projectId: "project.drip-tray",
      sourceRefs: [TECHNICAL_SOURCE_CAPTURE_REFERENCE],
    }) as Record<string, unknown>;
    const raw = JSON.stringify(response);
    const structured = response.structuredContent as Record<string, unknown>;
    assertEquals(structured.status, status);
    assertEquals(new TextEncoder().encode(raw).byteLength <= 8192, true);
    assertEquals(structured.document, undefined);
    assertEquals(structured.sourceText, undefined);
    assertEquals(structured.decisionParameters, undefined);
    assertEquals(structured.operation, undefined);
    assertEquals(raw.includes("sourceText"), false);
  }
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
