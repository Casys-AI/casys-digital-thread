import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectAdmittedGeometryExportCommand,
  ProjectAdmittedGeometryExportUseCase,
} from "../../application/ports/in/cad/canonical/project-admitted-geometry-export.ts";
import type {
  ProjectAdmittedGeometryExportPreflightCommand,
  ProjectAdmittedGeometryExportPreflightUseCase,
} from "../../application/ports/in/cad/canonical/project-admitted-geometry-export-preflight.ts";
import type {
  ProjectBuild123dExecutionReviewCommand,
  ProjectBuild123dExecutionReviewUseCase,
} from "../../application/ports/in/cad/isolated/project-build123d-execution-review.ts";
import type {
  ProjectIsolatedGeometrySealReviewCommand,
  ProjectIsolatedGeometrySealReviewUseCase,
} from "../../application/ports/in/cad/sealed-isolated/project-isolated-geometry-seal-review.ts";
import type {
  ProjectTechnicalCompilationPreviewCommand,
} from "../../application/ports/in/compile/admission/project-technical-compilation-preview.ts";
import {
  type BoundedTechnicalCompilationPreview,
  type BoundedTechnicalCompilationPreviewResult,
  type ReadTechnicalCompilationPreviewEvidence,
  TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_ITEMS,
  TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES,
} from "../../application/use-cases/compile/admission/bounded-technical-compilation-preview.ts";
import type { TechnicalCompilationPreviewEvidenceReference } from "../../application/ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import type {
  ProjectTechnicalSourceCaptureCommand,
  ProjectTechnicalSourceCaptureUseCase,
} from "../../application/ports/in/compile/admission/project-technical-source-capture.ts";
import { ProjectTechnicalSourceCaptureError } from "../../application/ports/in/compile/admission/project-technical-source-capture.ts";
import {
  captureReviewContent,
  TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA,
} from "../../domain/compile/admission/technical-source-capture-review.ts";
import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PATTERN,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  OPERATION_REF_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectTechnicalCompilationToolDependencies {
  /** Provider-free CAS capture of exact agent-authored technical source text. */
  technicalSourceCapture?: ProjectTechnicalSourceCaptureUseCase;
  /** Provider-free bounded compilation review against an exact basis. */
  technicalCompilationPreview?: Pick<BoundedTechnicalCompilationPreview, "execute">;
  /** Read-only, immutable evidence pages for one bounded compilation review. */
  technicalCompilationPreviewEvidence?: Pick<
    ReadTechnicalCompilationPreviewEvidence,
    "execute"
  >;
  /**
   * Private-sandbox export of exact admitted Build123d bytes as a geometry
   * DRAFT. Absent when the sandbox provider is not composed.
   */
  admittedGeometryExport?: ProjectAdmittedGeometryExportUseCase;
  /** Provider-free route selection for one sealed geometry admission. */
  admittedGeometryExportPreflight?: ProjectAdmittedGeometryExportPreflightUseCase;
  /** Provider-free preparation of one qualified Build123d execution review. */
  build123dExecutionReview?: ProjectBuild123dExecutionReviewUseCase;
  /** Provider-free preparation of one isolated geometry seal review. */
  isolatedGeometrySealReview?: ProjectIsolatedGeometrySealReviewUseCase;
}

/** Register the provider-free technical source and compilation draft surfaces. */
export function registerProjectTechnicalCompilationTools(
  app: McpApp,
  dependencies: ProjectTechnicalCompilationToolDependencies,
): void {
  if (dependencies.technicalSourceCapture) {
    const capture = dependencies.technicalSourceCapture;
    app.registerTool(projectTechnicalSourceCaptureTool, async (args) => {
      const command = technicalSourceCaptureCommand(args);
      let review;
      try {
        review = await capture.capture(command);
      } catch (cause) {
        if (cause instanceof ProjectTechnicalSourceCaptureError) {
          // McpApp serialises mapped tool errors as text, not Error properties.
          // Keep the application rejection fail-closed while making its exact,
          // server-owned lowerer diagnosis actionable to the MCP caller.
          throw new TypeError(
            `project_technical_source_capture rejected (${cause.code}): ${cause.message}`,
          );
        }
        throw cause;
      }
      return {
        content: captureReviewContent(review),
        structuredContent: review as unknown as Readonly<Record<string, unknown>>,
      };
    });
  }

  if (dependencies.technicalCompilationPreview) {
    const preview = dependencies.technicalCompilationPreview;
    app.registerTool(projectTechnicalCompilationPreviewTool, async (args) => {
      const command = technicalCompilationPreviewCommand(args);
      const result = await preview.execute(command);
      return {
        content: boundedCompilationPreviewContent(result),
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
  if (dependencies.technicalCompilationPreviewEvidence) {
    const evidence = dependencies.technicalCompilationPreviewEvidence;
    app.registerTool(projectTechnicalCompilationPreviewDetailTool, async (args) => {
      const result = await evidence.execute(
        technicalCompilationPreviewDetailCommand(args),
      );
      return {
        content: result.section === "full-evidence"
          ? "Explicit full technical-compilation evidence. Full review remains required for MRTR."
          : `Technical-compilation evidence section ${result.section}; inspect nextCursor when present.`,
        structuredContent: result as Record<string, unknown>,
      };
    });
  }

  if (dependencies.admittedGeometryExport) {
    const exportAdmitted = dependencies.admittedGeometryExport;
    app.registerTool(projectAdmittedGeometryExportTool, async (args) => {
      const command = admittedGeometryExportCommand(args);
      const result = await exportAdmitted.execute(command);
      return {
        content:
          `Admitted geometry export for sealed admission ${command.artifactId} completed as a geometry draft ${result.draftDigest}. Exact admitted bytes were reopened from compile.seal-admission@3 and sent to the private sandbox; callers supplied no source text, provider, tool, path or image. The result is not Thread state. Construct a later design.write-geometry@1 proposal only from the returned decisionParameters.`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
  if (dependencies.admittedGeometryExportPreflight) {
    const preflight = dependencies.admittedGeometryExportPreflight;
    app.registerTool(projectAdmittedGeometryExportPreflightTool, async (args) => {
      const result = await preflight.execute(
        admittedGeometryExportPreflightCommand(args),
      );
      return {
        content: result.status === "singular-export-ready"
          ? "The sealed admission is compatible with the singular canonical geometry export."
          : result.status === "child-root-admission-required"
          ? "Canonical export remains singular. The server derived independently admitted child-root identities; reread and recross current heads before each later admission."
          : "Canonical child-root guidance is unresolved; inspect the sealed attachments and current workspace heads.",
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }

  if (dependencies.build123dExecutionReview) {
    const review = dependencies.build123dExecutionReview;
    app.registerTool(projectBuild123dExecutionReviewTool, async (args) => {
      const command = build123dExecutionReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          `Build123d execution review for sealed admission ${command.artifactId} was prepared from exact server-reopened facts. Reuse the returned operation and its compilationAdmission binding verbatim on the later work item; do not reconstruct that thread-entity reference from a historical compile.seal-admission@3 creation snapshot. The returned admission, decisionParameters and operation are review material only: they contain no source bytes or runtime capability, no code was executed, and no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority was created.`,
        // The use case owns the complete admission identity and canonical MRTR
        // sequence. The MCP surface must not derive, filter, or repair either.
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }

  if (dependencies.isolatedGeometrySealReview) {
    const review = dependencies.isolatedGeometrySealReview;
    app.registerTool(projectIsolatedGeometrySealReviewTool, async (args) => {
      const command = isolatedGeometrySealReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          `Isolated geometry seal review for execution capture ${command.artifactId} was prepared from exact server-reopened identities. The returned admission and decisionParameters are review material only: they contain no source bytes or STEP payload, no EngineeringProject or Thread state, no MRTR decision, and no Product, FEA, or dispatch authority. The isolation receipt and the first design.execute-build123d@1 MRTR are not this approval.`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
}

const TECHNICAL_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const TECHNICAL_SOURCE_CAPTURE_LOCATOR_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: {
      const: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    },
    kind: { const: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND },
    fingerprint: FINGERPRINT_SCHEMA,
    byteCount: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    casUri: {
      type: "string",
      pattern: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PATTERN.source,
    },
  },
  required: ["schemaVersion", "kind", "fingerprint", "byteCount", "casUri"],
  additionalProperties: false,
} as const;

const TECHNICAL_THREAD_BASIS_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "thread-snapshot" },
    snapshotId: TECHNICAL_ID_SCHEMA,
    revision: { type: "integer", minimum: 1 },
    subjectId: TECHNICAL_ID_SCHEMA,
  },
  required: ["kind", "snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const DRAFT_CAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const CAD_LEVER_DIAGNOSIS_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: { status: { const: "not-applicable" } },
      required: ["status"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ok" },
        levers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              semanticKey: TECHNICAL_ID_SCHEMA,
              value: { type: "number" },
            },
            required: ["semanticKey", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["status", "levers"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "unresolved" },
        code: { const: "source.no-named-numeric-lever" },
        levers: { type: "array", maxItems: 0 },
        message: { type: "string", minLength: 1 },
      },
      required: ["status", "code", "levers", "message"],
      additionalProperties: false,
    },
  ],
} as const;

const TECHNICAL_SOURCE_CAPTURE_REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA },
    reference: TECHNICAL_SOURCE_CAPTURE_LOCATOR_SCHEMA,
    parser: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["passed", "rejected"] },
        profile: TECHNICAL_ID_SCHEMA,
      },
      required: ["status", "profile"],
      additionalProperties: false,
    },
    levers: CAD_LEVER_DIAGNOSIS_SCHEMA,
  },
  required: ["schemaVersion", "reference", "parser", "levers"],
  additionalProperties: false,
} as const;

const projectTechnicalSourceCaptureTool: MCPTool = {
  name: "project_technical_source_capture",
  description:
    "Capture one exact project source workspace attachment head as immutable technical-source analysis. Name only projectId, workspaceRevision, attachmentId and attachmentRevision. The named attachmentRevision must be the unique active head at that workspace snapshot. The server resolves the root file, registered profile and dependency closure. parser.status is the closed-subset parser only; it is not admission. levers.status is the behave-CAD handle diagnosis. Pass result.reference, never this whole review object or the capture document, to project_technical_compilation_preview. Language, analyzer, policy, resource bytes, fileId, fileRevision and profile remain server-owned. MIME, path, sourceText, profileId, sourceId, fileId, fileRevision and resourceRef are refused. This writes no EngineeringProject or Thread state, creates no MRTR decision, and performs no technical execution.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      workspaceRevision: { type: "integer", minimum: 1 },
      attachmentId: TECHNICAL_ID_SCHEMA,
      attachmentRevision: { type: "integer", minimum: 1 },
    },
    required: ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
    additionalProperties: false,
  },
  outputSchema: TECHNICAL_SOURCE_CAPTURE_REVIEW_OUTPUT_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectTechnicalCompilationPreviewTool: MCPTool = {
  name: "project_technical_compilation_preview",
  description:
    "Compile captured technical sources against the unique current Thread tip using only server-owned analysis, catalog profiles, and unique SysML joins. Name projectId and sourceRefs from project_technical_source_capture result.reference locators; never pass the capture review envelope, capture document, bindings, or profileRequests. Omitted basis is the unique current Thread tip, not latest. The result is a bounded canonical summary plus opaque immutable evidenceRef. Read diagnostics, gaps, source manifest, source text, projections, or explicit full-evidence through project_technical_compilation_preview_detail. A ready result still requires full evidence review for MRTR; decisionParameters and the exact compile.seal-admission@3 operation are available only through explicit detail sections. Reuse that operation verbatim in the later project_change_append; never reconstruct its sysmlModel binding. This preview writes no EngineeringProject or Thread state and grants no MRTR, provider, runtime, or execution authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      basis: TECHNICAL_THREAD_BASIS_SCHEMA,
      sourceRefs: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
        items: TECHNICAL_SOURCE_CAPTURE_LOCATOR_SCHEMA,
        description:
          `${TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA} from project_technical_source_capture result.reference. Never pass the capture review envelope or the capture document.`,
      },
    },
    required: ["projectId", "sourceRefs"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      schemaVersion: { const: "technical-compilation-preview-summary/1.0" },
      status: { enum: ["unresolved", "rejected", "ready-for-review"] },
      evidenceRef: {
        type: "object",
        properties: {
          schemaVersion: {
            const: "technical-compilation-preview-evidence-reference/1.0",
          },
          projectId: TECHNICAL_ID_SCHEMA,
          fingerprint: FINGERPRINT_SCHEMA,
          byteCount: { type: "integer", minimum: 1 },
        },
        required: ["schemaVersion", "projectId", "fingerprint", "byteCount"],
        additionalProperties: false,
      },
      evidenceBytes: { type: "integer", minimum: 1 },
      counts: {
        type: "object",
        properties: {
          sources: { type: "integer", minimum: 0 },
          projections: { type: "integer", minimum: 0 },
          diagnostics: { type: "integer", minimum: 0 },
          gaps: { type: "integer", minimum: 0 },
          diagnosticsByCode: {
            type: "object",
            additionalProperties: { type: "integer", minimum: 1 },
            maxProperties: 9,
          },
          gapsByCode: {
            type: "object",
            additionalProperties: { type: "integer", minimum: 1 },
            maxProperties: 8,
          },
        },
        required: [
          "sources",
          "projections",
          "diagnostics",
          "gaps",
          "diagnosticsByCode",
          "gapsByCode",
        ],
        additionalProperties: false,
      },
      samples: {
        type: "object",
        properties: {
          diagnostics: {
            type: "array",
            maxItems: TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES,
            items: { $ref: "#/$defs/sample" },
          },
          gaps: {
            type: "array",
            maxItems: TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES,
            items: { $ref: "#/$defs/sample" },
          },
          omittedDiagnostics: { type: "integer", minimum: 0 },
          omittedGaps: { type: "integer", minimum: 0 },
        },
        required: ["diagnostics", "gaps", "omittedDiagnostics", "omittedGaps"],
        additionalProperties: false,
      },
      requiresFullEvidenceForMrtr: { type: "boolean" },
    },
    required: [
      "schemaVersion",
      "status",
      "evidenceRef",
      "evidenceBytes",
      "counts",
      "samples",
      "requiresFullEvidenceForMrtr",
    ],
    additionalProperties: false,
    $defs: {
      excerpt: {
        type: "object",
        properties: {
          excerpt: { type: "string", maxLength: 256 },
          originalByteCount: { type: "integer", minimum: 0 },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          truncatedBytes: { type: "integer", minimum: 0 },
        },
        required: ["excerpt", "originalByteCount", "sha256", "truncatedBytes"],
        additionalProperties: false,
      },
      sample: {
        anyOf: [
          { type: "null" },
          { type: "boolean" },
          { type: "number" },
          { $ref: "#/$defs/excerpt" },
          {
            type: "array",
            maxItems: TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES,
            items: { $ref: "#/$defs/sample" },
          },
          {
            type: "object",
            properties: {
              code: { $ref: "#/$defs/sample" },
              profileRef: { $ref: "#/$defs/sample" },
              subjectRef: { $ref: "#/$defs/sample" },
              sourceId: { $ref: "#/$defs/sample" },
              relation: { $ref: "#/$defs/sample" },
              symbolName: { $ref: "#/$defs/sample" },
              symbolKind: { $ref: "#/$defs/sample" },
              reason: { $ref: "#/$defs/sample" },
              candidateCount: { $ref: "#/$defs/sample" },
              closureKind: { $ref: "#/$defs/sample" },
              modelSymbolId: { $ref: "#/$defs/sample" },
              attributeUsageId: { $ref: "#/$defs/sample" },
              role: { $ref: "#/$defs/sample" },
              requirementElementId: { $ref: "#/$defs/sample" },
              recovery: { $ref: "#/$defs/sample" },
            },
            additionalProperties: false,
          },
        ],
      },
    },
  },
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REF_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "technical-compilation-preview-evidence-reference/1.0" },
    projectId: TECHNICAL_ID_SCHEMA,
    fingerprint: FINGERPRINT_SCHEMA,
    byteCount: { type: "integer", minimum: 1 },
  },
  required: ["schemaVersion", "projectId", "fingerprint", "byteCount"],
  additionalProperties: false,
} as const;

const TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS = [
  "diagnostics",
  "gaps",
  "source-manifest",
  "source-text",
  "projections",
  "decision-parameters",
  "operation",
  "full-evidence",
] as const;

const PREVIEW_CURSOR_SCHEMA = {
  type: ["string", "null"],
  minLength: 64,
  maxLength: 64,
  pattern: "^[a-f0-9]{64}$",
} as const;

function detailPageSchema(
  section: typeof TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS[number],
  items: Record<string, unknown>,
  maxItems = TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_ITEMS,
) {
  return {
    type: "object",
    properties: {
      section: { const: section },
      items: { type: "array", maxItems, items },
      nextCursor: PREVIEW_CURSOR_SCHEMA,
    },
    required: ["section", "items", "nextCursor"],
    additionalProperties: false,
  } as const;
}

/** The detail reader's fixed section names are a discriminant, never a filter. */
function technicalCompilationPreviewDetailOutputSchema() {
  const gap = {
    type: "object",
    properties: {
      code: { type: "string" },
      sourceId: TECHNICAL_ID_SCHEMA,
      relation: { type: "string" },
      symbolName: { type: "string" },
      symbolKind: { type: "string" },
      reason: { type: "string" },
      candidateCount: { type: "integer", minimum: 0 },
      closureKind: { type: "string" },
      modelSymbolId: TECHNICAL_ID_SCHEMA,
      attributeUsageId: TECHNICAL_ID_SCHEMA,
      role: { type: "string" },
      requirementElementId: TECHNICAL_ID_SCHEMA,
      recovery: {
        type: "object",
        properties: {
          excerpt: { type: "string", maxLength: 256 },
          originalByteCount: { type: "integer", minimum: 0 },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          truncatedBytes: { type: "integer", minimum: 0 },
        },
        required: ["excerpt", "originalByteCount", "sha256", "truncatedBytes"],
        additionalProperties: false,
      },
    },
    required: ["code", "recovery"],
    additionalProperties: false,
  } as const;
  const manifest = {
    type: "object",
    properties: {
      sourceId: TECHNICAL_ID_SCHEMA,
      role: { type: "string" },
      language: { type: "string" },
      sourceFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      analysisFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      effectiveUnit: {
        type: "object",
        properties: {
          kind: { type: "string" },
          closureKind: { type: "string" },
          unitId: TECHNICAL_ID_SCHEMA,
          closureFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
        required: ["kind", "closureKind", "unitId", "closureFingerprint"],
        additionalProperties: false,
      },
      counts: {
        type: "object",
        properties: {
          symbols: { type: "integer", minimum: 0 },
          dependencies: { type: "integer", minimum: 0 },
          unresolvedConstructs: { type: "integer", minimum: 0 },
          bindings: { type: "integer", minimum: 0 },
        },
        required: ["symbols", "dependencies", "unresolvedConstructs", "bindings"],
        additionalProperties: false,
      },
      bindingIds: { type: "array", items: TECHNICAL_ID_SCHEMA },
    },
    required: [
      "sourceId",
      "role",
      "language",
      "sourceFingerprint",
      "analysisFingerprint",
      "effectiveUnit",
      "counts",
      "bindingIds",
    ],
    additionalProperties: false,
  } as const;
  const projection = {
    type: "object",
    properties: {
      target: { type: "string" },
      profile: {
        type: "object",
        properties: { id: TECHNICAL_ID_SCHEMA, version: { type: "string" } },
        required: ["id", "version"],
        additionalProperties: false,
      },
      status: { type: "string" },
      profileFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      counts: {
        type: "object",
        properties: {
          sources: { type: "integer", minimum: 0 },
          bindings: { type: "integer", minimum: 0 },
          diagnostics: { type: "integer", minimum: 0 },
        },
        required: ["sources", "bindings", "diagnostics"],
        additionalProperties: false,
      },
    },
    required: ["target", "profile", "status", "profileFingerprint", "counts"],
    additionalProperties: false,
  } as const;
  return {
    oneOf: [
      detailPageSchema("diagnostics", {
        type: "object",
        properties: {
          code: { type: "string", maxLength: 128 },
          profileRef: { type: "string", maxLength: 256 },
          subjectRef: { type: "string", maxLength: 256 },
        },
        required: ["code", "profileRef", "subjectRef"],
        additionalProperties: false,
      }),
      detailPageSchema("gaps", gap),
      detailPageSchema("source-manifest", manifest),
      detailPageSchema("source-text", {
        type: "object",
        properties: {
          sourceId: TECHNICAL_ID_SCHEMA,
          offset: { type: "integer", minimum: 0 },
          text: { type: "string", maxLength: 1000 },
        },
        required: ["sourceId", "offset", "text"],
        additionalProperties: false,
      }),
      detailPageSchema("projections", projection),
      detailPageSchema("decision-parameters", {
        type: "object",
        properties: {
          key: { type: "string", minLength: 1, maxLength: 256 },
          label: { type: "string", minLength: 1, maxLength: 256 },
          value: { type: ["string", "number", "boolean"] },
          unit: { type: "string", minLength: 1, maxLength: 64 },
        },
        required: ["key", "label", "value"],
        additionalProperties: false,
      }),
      detailPageSchema("operation", OPERATION_REF_SCHEMA),
      detailPageSchema("full-evidence", {
        type: "object",
        properties: {
          status: { enum: ["unresolved", "rejected", "ready-for-review"] },
          document: { type: "object" },
          fingerprint: FINGERPRINT_SCHEMA,
          gaps: { type: "array" },
          draft: { type: "object" },
          decisionParameters: { type: "array" },
          operation: OPERATION_REF_SCHEMA,
        },
        required: ["status", "document", "fingerprint", "gaps"],
        additionalProperties: false,
      }, 1),
    ],
  } as const;
}

const projectTechnicalCompilationPreviewDetailTool: MCPTool = {
  name: "project_technical_compilation_preview_detail",
  description:
    "Read one immutable technical-compilation preview evidence section. Name only projectId, the opaque evidenceRef returned by project_technical_compilation_preview, section, and an optional opaque cursor. Pages are bounded except full-evidence, which is deliberately complete only when explicitly requested. decision-parameters and operation stay in their explicit sections. A ready summary never substitutes for the full MRTR review. This read grants no MRTR, provider, runtime, dispatch, or mutation authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      evidenceRef: TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REF_SCHEMA,
      section: { type: "string", enum: TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS },
      cursor: {
        type: "string",
        minLength: 64,
        maxLength: 64,
        pattern: "^[a-f0-9]{64}$",
      },
    },
    required: ["projectId", "evidenceRef", "section"],
    additionalProperties: false,
  },
  outputSchema: technicalCompilationPreviewDetailOutputSchema(),
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectAdmittedGeometryExportTool: MCPTool = {
  name: "project_admitted_geometry_export",
  description:
    "Reopen one sealed compile.seal-admission@3 Build123d compilation and export its exact admitted source bytes through the private build123d sandbox. The caller may name only the exact project, Thread basis, admission artifact id, and artifact fingerprint; source text, provider, tool, path, image and formats remain server-owned. The result is a geometry DRAFT plus decisionParameters for a later design.write-geometry@1 proposal. This writes no Thread state, grants no MRTR decision, and does not invoke design.execute-build123d@1.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      basis: TECHNICAL_THREAD_BASIS_SCHEMA,
      artifactId: TECHNICAL_ID_SCHEMA,
      artifactFingerprint: FINGERPRINT_SCHEMA,
    },
    required: ["projectId", "basis", "artifactId", "artifactFingerprint"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectAdmittedGeometryExportPreflightTool: MCPTool = {
  name: "project_admitted_geometry_export_preflight",
  description:
    "Read one exact sealed compile.seal-admission@3 Build123d admission and state whether it is ready for the existing singular canonical export, or whether exact independently admitted child roots can be guided. The caller names only projectId, exact Thread basis, admission artifact id and fingerprint. It never starts a runtime, calls a provider, returns source text, or selects a source, profile, provider or runtime. Guidance is documentary: each later admission advances the Thread, so current attachment heads must be reread and recrossed when required.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      basis: TECHNICAL_THREAD_BASIS_SCHEMA,
      artifactId: TECHNICAL_ID_SCHEMA,
      artifactFingerprint: FINGERPRINT_SCHEMA,
    },
    required: ["projectId", "basis", "artifactId", "artifactFingerprint"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectBuild123dExecutionReviewTool: MCPTool = {
  name: "project_build123d_execution_review",
  description:
    "Prepare the exact human-review identity, canonical MRTR parameters, and registered work-item operation for one future qualified Build123d execution by reopening a sealed technical-compilation admission and joining it to the server-owned execution profile. Reuse the returned operation verbatim: compilationAdmission is that selected admission artifact on the current review Thread basis, never a historical creation snapshot. This provider-free read performs no code execution, returns no source bytes or runtime capability, mutates no EngineeringProject or Thread state, and grants no MRTR, provider, or dispatch authority. The caller may name only the exact project, Thread basis, admission artifact id, and artifact fingerprint; runtime, isolation, output, profile, command, tool and transport facts remain server-owned.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      basis: TECHNICAL_THREAD_BASIS_SCHEMA,
      artifactId: TECHNICAL_ID_SCHEMA,
      artifactFingerprint: FINGERPRINT_SCHEMA,
    },
    required: ["projectId", "basis", "artifactId", "artifactFingerprint"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectIsolatedGeometrySealReviewTool: MCPTool = {
  name: "project_isolated_geometry_seal_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one later isolated geometry document seal by reopening a documentary design.execute-build123d@1 capture. This provider-free read performs no code execution, returns no source or STEP bytes, mutates no EngineeringProject or Thread state, and grants no MRTR, Product, FEA, or dispatch authority. The caller may name only the exact project, Thread basis, execution-capture artifact id, and artifact fingerprint. The isolation receipt and the first execute MRTR are not this approval.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      basis: TECHNICAL_THREAD_BASIS_SCHEMA,
      artifactId: TECHNICAL_ID_SCHEMA,
      artifactFingerprint: FINGERPRINT_SCHEMA,
    },
    required: ["projectId", "basis", "artifactId", "artifactFingerprint"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

function technicalSourceCaptureCommand(
  value: Record<string, unknown>,
): ProjectTechnicalSourceCaptureCommand {
  exactKeys(
    value,
    ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
    [],
    "technicalSourceCapture",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    workspaceRevision: positiveInteger(
      value.workspaceRevision,
      "workspaceRevision",
    ),
    attachmentId: technicalId(value.attachmentId, "attachmentId"),
    attachmentRevision: positiveInteger(
      value.attachmentRevision,
      "attachmentRevision",
    ),
  };
}

function technicalCompilationPreviewCommand(
  value: Record<string, unknown>,
): ProjectTechnicalCompilationPreviewCommand {
  exactKeys(
    value,
    ["projectId", "sourceRefs"],
    ["basis"],
    "technicalCompilationPreview",
  );
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) {
    throw new TypeError("sourceRefs must be a non-empty array");
  }
  if (value.sourceRefs.length > 32) {
    throw new TypeError("sourceRefs must not exceed 32 entries");
  }
  return {
    projectId: technicalId(value.projectId, "projectId"),
    ...(value.basis === undefined
      ? {}
      : { basis: technicalThreadBasis(value.basis, "basis") }),
    sourceRefs: value.sourceRefs.map((reference, index) =>
      technicalSourceCaptureReference(reference, `sourceRefs[${index}]`)
    ),
  };
}

function technicalCompilationPreviewDetailCommand(
  value: Record<string, unknown>,
): {
  readonly projectId: string;
  readonly evidenceRef: TechnicalCompilationPreviewEvidenceReference;
  readonly section: typeof TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS[number];
  readonly cursor?: string;
} {
  exactKeys(
    value,
    ["projectId", "evidenceRef", "section"],
    ["cursor"],
    "technicalCompilationPreviewDetail",
  );
  const section = exactNonEmptyText(value.section, "section");
  if (
    !TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS.includes(
      section as typeof TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS[number],
    )
  ) throw new TypeError("section is not a technical-compilation evidence section");
  const evidence = exactRecord(value.evidenceRef, "evidenceRef");
  exactKeys(
    evidence,
    ["schemaVersion", "projectId", "fingerprint", "byteCount"],
    [],
    "evidenceRef",
  );
  if (
    evidence.schemaVersion !== "technical-compilation-preview-evidence-reference/1.0"
  ) {
    throw new TypeError("evidenceRef.schemaVersion is invalid");
  }
  const projectId = technicalId(value.projectId, "projectId");
  const evidenceProjectId = technicalId(evidence.projectId, "evidenceRef.projectId");
  if (evidenceProjectId !== projectId) {
    throw new TypeError("evidenceRef.projectId must equal projectId");
  }
  const cursor = value.cursor === undefined
    ? undefined
    : exactNonEmptyText(value.cursor, "cursor");
  if (cursor !== undefined && !/^[a-f0-9]{64}$/.test(cursor)) {
    throw new TypeError("cursor must be 64 lowercase hex characters");
  }
  return {
    projectId,
    evidenceRef: {
      schemaVersion: "technical-compilation-preview-evidence-reference/1.0",
      projectId,
      fingerprint: fingerprintInput(evidence.fingerprint, "evidenceRef.fingerprint"),
      byteCount: positiveInteger(evidence.byteCount, "evidenceRef.byteCount"),
    },
    section: section as typeof TECHNICAL_COMPILATION_PREVIEW_DETAIL_SECTIONS[number],
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function boundedCompilationPreviewContent(
  result: BoundedTechnicalCompilationPreviewResult,
): string {
  const counts = result.counts;
  const review = result.requiresFullEvidenceForMrtr
    ? " Full evidence review is required before MRTR."
    : "";
  return `Technical compilation preview is ${result.status}: ${counts.diagnostics} diagnostics and ${counts.gaps} gaps across ${counts.sources} sources. Read immutable evidence sections with project_technical_compilation_preview_detail using evidenceRef.${review}`;
}

function admittedGeometryExportCommand(
  value: Record<string, unknown>,
): ProjectAdmittedGeometryExportCommand {
  exactKeys(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    [],
    "admittedGeometryExport",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    basis: technicalThreadBasis(value.basis, "basis"),
    artifactId: technicalId(value.artifactId, "artifactId"),
    artifactFingerprint: fingerprintInput(
      value.artifactFingerprint,
      "artifactFingerprint",
    ),
  };
}

function admittedGeometryExportPreflightCommand(
  value: Record<string, unknown>,
): ProjectAdmittedGeometryExportPreflightCommand {
  exactKeys(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    [],
    "admittedGeometryExportPreflight",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    basis: technicalThreadBasis(value.basis, "basis"),
    artifactId: technicalId(value.artifactId, "artifactId"),
    artifactFingerprint: fingerprintInput(
      value.artifactFingerprint,
      "artifactFingerprint",
    ),
  };
}

function build123dExecutionReviewCommand(
  value: Record<string, unknown>,
): ProjectBuild123dExecutionReviewCommand {
  exactKeys(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    [],
    "build123dExecutionReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    basis: technicalThreadBasis(value.basis, "basis"),
    artifactId: technicalId(value.artifactId, "artifactId"),
    artifactFingerprint: fingerprintInput(
      value.artifactFingerprint,
      "artifactFingerprint",
    ),
  };
}

function isolatedGeometrySealReviewCommand(
  value: Record<string, unknown>,
): ProjectIsolatedGeometrySealReviewCommand {
  exactKeys(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    [],
    "isolatedGeometrySealReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    basis: technicalThreadBasis(value.basis, "basis"),
    artifactId: technicalId(value.artifactId, "artifactId"),
    artifactFingerprint: fingerprintInput(
      value.artifactFingerprint,
      "artifactFingerprint",
    ),
  };
}

function technicalThreadBasis(
  value: unknown,
  name: string,
): NonNullable<ProjectTechnicalCompilationPreviewCommand["basis"]> {
  const basis = exactRecord(value, name);
  exactKeys(basis, ["kind", "snapshotId", "revision", "subjectId"], [], name);
  if (basis.kind !== "thread-snapshot") {
    throw new TypeError(`${name}.kind must be thread-snapshot`);
  }
  const snapshotId = technicalId(basis.snapshotId, `${name}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${name}.snapshotId cannot use the latest alias`);
  }
  return {
    kind: "thread-snapshot",
    snapshotId,
    revision: positiveInteger(basis.revision, `${name}.revision`),
    subjectId: technicalId(basis.subjectId, `${name}.subjectId`),
  };
}

function technicalSourceCaptureReference(
  value: unknown,
  name: string,
) {
  const reference = exactRecord(value, name);
  if (
    reference.schemaVersion === TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA ||
    reference.schemaVersion === "technical-source-capture-review/1.0"
  ) {
    throw new TypeError(
      `${name} is a technical-source-capture-review envelope. Pass result.reference, never the review object.`,
    );
  }
  if (
    reference.schemaVersion === TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA ||
    reference.schemaVersion === "technical-source-analysis-capture/1.0" ||
    reference.kind === TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND
  ) {
    throw new TypeError(
      `${name} is a technical-source-analysis-capture document. Pass the opaque locator, never the capture document.`,
    );
  }
  return validateTechnicalSourceAnalysisCaptureLocator(reference, name);
}

function technicalId(value: unknown, name: string): string {
  const id = exactNonEmptyText(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id)) {
    throw new TypeError(`${name} must be a stable technical identifier`);
  }
  return id;
}

function exactNonEmptyText(value: unknown, name: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim()
  ) {
    throw new TypeError(`${name} must be non-empty without edge whitespace`);
  }
  return value;
}

function fingerprintInput(value: unknown, name: string) {
  const record = exactRecord(value, name);
  exactKeys(record, ["algorithm", "digest"], [], name);
  if (record.algorithm !== "sha256") {
    throw new TypeError(`${name}.algorithm must be sha256`);
  }
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) {
    throw new TypeError(`${name}.digest must be 64 lowercase hex characters`);
  }
  return { algorithm: "sha256" as const, digest: record.digest };
}

function exactRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(`${name} has unsupported field(s): ${extras.join(", ")}`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing field(s): ${missing.join(", ")}`);
  }
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}
