import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectAdmittedGeometryExportCommand,
  ProjectAdmittedGeometryExportUseCase,
} from "../../application/ports/in/cad/canonical/project-admitted-geometry-export.ts";
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
  ProjectTechnicalCompilationPreviewUseCase,
} from "../../application/ports/in/compile/admission/project-technical-compilation-preview.ts";
import type {
  ProjectTechnicalSourceCaptureCommand,
  ProjectTechnicalSourceCaptureUseCase,
} from "../../application/ports/in/compile/admission/project-technical-source-capture.ts";
import { compilationPreviewContent } from "../../domain/compile/admission/technical-compilation-preview-review.ts";
import { captureReviewContent } from "../../domain/compile/admission/technical-source-capture-review.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectTechnicalCompilationToolDependencies {
  /** Provider-free CAS capture of exact agent-authored technical source text. */
  technicalSourceCapture?: ProjectTechnicalSourceCaptureUseCase;
  /** Provider-free compilation of captured sources against an exact basis. */
  technicalCompilationPreview?: ProjectTechnicalCompilationPreviewUseCase;
  /**
   * Private-sandbox export of exact admitted Build123d bytes as a geometry
   * DRAFT. Absent when the sandbox provider is not composed.
   */
  admittedGeometryExport?: ProjectAdmittedGeometryExportUseCase;
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
      const review = await capture.capture(command);
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
      const content = compilationPreviewContent({
        status: result.status,
        ...(result.status === "ready-for-review"
          ? { draftId: result.draft.draftId }
          : {}),
        gaps: result.gaps,
      });
      return {
        content,
        // Preserve every use-case-owned review field verbatim, including
        // decisionParameters when the ready result provides them. The MCP
        // surface must never derive or repair MRTR parameters itself.
        structuredContent: result as unknown as Record<string, unknown>,
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
          `Admitted geometry export for sealed admission ${command.artifactId} completed as a geometry draft ${result.draftDigest}. Exact admitted bytes were reopened from compile.seal-admission@1 and sent to the private sandbox; callers supplied no source text, provider, tool, path or image. The result is not Thread state. Construct a later design.write-geometry@1 proposal only from the returned decisionParameters.`,
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
          `Build123d execution review for sealed admission ${command.artifactId} was prepared from exact server-reopened facts. The returned admission and decisionParameters are review material only: they contain no source bytes or runtime capability, no code was executed, and no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority was created.`,
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

const TECHNICAL_VERSION_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const TECHNICAL_ANALYZER_SCHEMA = {
  type: "object",
  properties: {
    id: TECHNICAL_ID_SCHEMA,
    version: TECHNICAL_VERSION_SCHEMA,
  },
  required: ["id", "version"],
  additionalProperties: false,
} as const;

const TECHNICAL_SOURCE_CAPTURE_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "technical-source-analysis-capture/1.0" },
    kind: { const: "technical-source-analysis" },
    profile: {
      type: "object",
      properties: {
        id: TECHNICAL_ID_SCHEMA,
        version: TECHNICAL_VERSION_SCHEMA,
        fingerprint: FINGERPRINT_SCHEMA,
      },
      required: ["id", "version", "fingerprint"],
      additionalProperties: false,
    },
    source: {
      type: "object",
      properties: {
        id: TECHNICAL_ID_SCHEMA,
        role: {
          type: "string",
          enum: ["cad-script", "modelica-model", "spice-circuit"],
        },
        language: { type: "string", enum: ["python", "modelica", "spice"] },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        byteCount: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        casUri: {
          type: "string",
          pattern: "^casys://[a-z0-9][a-z0-9.-]{0,62}/sha256/[a-f0-9]{64}$",
        },
      },
      required: ["id", "role", "language", "sha256", "byteCount", "casUri"],
      additionalProperties: false,
    },
    analysis: {
      type: "object",
      properties: {
        analyzer: TECHNICAL_ANALYZER_SCHEMA,
        policy: {
          type: "object",
          properties: {
            profile: TECHNICAL_ID_SCHEMA,
            status: { type: "string", enum: ["passed", "rejected"] },
          },
          required: ["profile", "status"],
          additionalProperties: false,
        },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        byteCount: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        casUri: {
          type: "string",
          pattern: "^casys://[a-z0-9][a-z0-9.-]{0,62}/sha256/[a-f0-9]{64}$",
        },
      },
      required: ["analyzer", "policy", "sha256", "byteCount", "casUri"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "kind", "profile", "source", "analysis"],
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

const TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "technical-source-capture-review/1.0" },
    reference: TECHNICAL_SOURCE_CAPTURE_REFERENCE_SCHEMA,
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
    "Capture exact agent-authored technical source bytes and their server-selected parser analysis in immutable draft CAS. parser.status is the closed-subset parser only; it is not admission. levers.status is the behave-CAD handle diagnosis (reachable named numeric literals). Pass result.reference, never this whole review object, to project_technical_compilation_preview. The caller may select only a registered profile id and source id; language, analyzer and policy remain server-owned. This writes no EngineeringProject or Thread state, creates no MRTR decision, and performs no technical execution.",
  inputSchema: {
    type: "object",
    properties: {
      profileId: TECHNICAL_ID_SCHEMA,
      sourceId: TECHNICAL_ID_SCHEMA,
      sourceText: {
        type: "string",
        minLength: 1,
        maxLength: 65_536,
        description:
          "Exact UTF-8 technical source. Edge whitespace and line endings are preserved.",
      },
    },
    required: ["profileId", "sourceId", "sourceText"],
    additionalProperties: false,
  },
  outputSchema: TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectTechnicalCompilationPreviewTool: MCPTool = {
  name: "project_technical_compilation_preview",
  description:
    "Compile captured technical sources against the unique current Thread tip using only server-owned analysis, catalog profiles, and unique SysML joins. Name projectId and sourceRefs from project_technical_source_capture result.reference; never pass the capture review envelope, bindings, or profileRequests. Omitted basis is the unique current Thread tip, not latest. A reachable CAD lever is reopened from the source; the server does not invent one. A ready result contains the exact review draft and compilation document. Construct a later MRTR proposal only from decisionParameters returned by the use case; never invent missing parameters. The preview writes no EngineeringProject or Thread state and grants no MRTR or execution authority.",
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
        items: TECHNICAL_SOURCE_CAPTURE_REFERENCE_SCHEMA,
        description:
          "technical-source-analysis-capture/1.0 locators from project_technical_source_capture result.reference. Never pass the capture review envelope.",
      },
    },
    required: ["projectId", "sourceRefs"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectAdmittedGeometryExportTool: MCPTool = {
  name: "project_admitted_geometry_export",
  description:
    "Reopen one sealed compile.seal-admission@1 Build123d compilation and export its exact admitted source bytes through the private build123d sandbox. The caller may name only the exact project, Thread basis, admission artifact id, and artifact fingerprint; source text, provider, tool, path, image and formats remain server-owned. The result is a geometry DRAFT plus decisionParameters for a later design.write-geometry@1 proposal. This writes no Thread state, grants no MRTR decision, and does not invoke design.execute-build123d@1.",
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

const projectBuild123dExecutionReviewTool: MCPTool = {
  name: "project_build123d_execution_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one future qualified Build123d execution by reopening a sealed technical-compilation admission and joining it to the server-owned execution profile. This provider-free read performs no code execution, returns no source bytes or runtime capability, mutates no EngineeringProject or Thread state, and grants no MRTR, provider, or dispatch authority. The caller may name only the exact project, Thread basis, admission artifact id, and artifact fingerprint; runtime, isolation, output, profile, command, tool and transport facts remain server-owned.",
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
    ["profileId", "sourceId", "sourceText"],
    [],
    "technicalSourceCapture",
  );
  const sourceText = exactSourceText(value.sourceText, "sourceText");
  if (sourceText.length > 65_536) {
    throw new TypeError("sourceText must not exceed 65536 characters");
  }
  return {
    profileId: technicalId(value.profileId, "profileId"),
    sourceId: technicalId(value.sourceId, "sourceId"),
    sourceText,
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
): Readonly<Record<string, unknown>> {
  const reference = exactRecord(value, name);
  if (reference.schemaVersion === "technical-source-capture-review/1.0") {
    throw new TypeError(
      `${name} is a technical-source-capture-review/1.0 envelope. Pass result.reference, never the review object.`,
    );
  }
  exactKeys(
    reference,
    ["schemaVersion", "kind", "profile", "source", "analysis"],
    [],
    name,
  );
  if (
    reference.schemaVersion !== "technical-source-analysis-capture/1.0" ||
    reference.kind !== "technical-source-analysis"
  ) {
    throw new TypeError(`${name} must be a technical source-analysis reference`);
  }
  const profile = exactRecord(reference.profile, `${name}.profile`);
  exactKeys(profile, ["id", "version", "fingerprint"], [], `${name}.profile`);
  const profileId = technicalId(profile.id, `${name}.profile.id`);
  exactNonEmptyText(profile.version, `${name}.profile.version`);
  fingerprintInput(profile.fingerprint, `${name}.profile.fingerprint`);

  const source = exactRecord(reference.source, `${name}.source`);
  exactKeys(
    source,
    ["id", "role", "language", "sha256", "byteCount", "casUri"],
    [],
    `${name}.source`,
  );
  technicalId(source.id, `${name}.source.id`);
  const role = oneOf(
    source.role,
    ["cad-script", "modelica-model", "spice-circuit"] as const,
    `${name}.source.role`,
  );
  const language = oneOf(
    source.language,
    ["python", "modelica", "spice"] as const,
    `${name}.source.language`,
  );
  if (
    !(
      (role === "cad-script" && language === "python") ||
      (role === "modelica-model" && language === "modelica") ||
      (role === "spice-circuit" && language === "spice")
    )
  ) {
    throw new TypeError(`${name}.source role and language do not match`);
  }
  const sourceDigest = hex64(source.sha256, `${name}.source.sha256`);
  nonNegativeInteger(source.byteCount, `${name}.source.byteCount`);
  technicalCasUri(source.casUri, sourceDigest, `${name}.source.casUri`);

  const analysis = exactRecord(reference.analysis, `${name}.analysis`);
  exactKeys(
    analysis,
    ["analyzer", "policy", "sha256", "byteCount", "casUri"],
    [],
    `${name}.analysis`,
  );
  const analyzer = exactRecord(analysis.analyzer, `${name}.analysis.analyzer`);
  exactKeys(analyzer, ["id", "version"], [], `${name}.analysis.analyzer`);
  technicalId(analyzer.id, `${name}.analysis.analyzer.id`);
  exactNonEmptyText(analyzer.version, `${name}.analysis.analyzer.version`);
  const policy = exactRecord(analysis.policy, `${name}.analysis.policy`);
  exactKeys(policy, ["profile", "status"], [], `${name}.analysis.policy`);
  if (technicalId(policy.profile, `${name}.analysis.policy.profile`) !== profileId) {
    throw new TypeError(`${name}.analysis.policy.profile must match profile.id`);
  }
  oneOf(
    policy.status,
    ["passed", "rejected"] as const,
    `${name}.analysis.policy.status`,
  );
  const analysisDigest = hex64(analysis.sha256, `${name}.analysis.sha256`);
  nonNegativeInteger(analysis.byteCount, `${name}.analysis.byteCount`);
  technicalCasUri(analysis.casUri, analysisDigest, `${name}.analysis.casUri`);
  return reference;
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

function exactSourceText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be non-empty source text`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return Number(value);
}

function technicalCasUri(value: unknown, digest: string, name: string): string {
  const uri = exactNonEmptyText(value, name);
  if (
    !/^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/.test(uri) ||
    !uri.endsWith(`/sha256/${digest}`)
  ) {
    throw new TypeError(`${name} must be a canonical CAS URI for its digest`);
  }
  return uri;
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

function hex64(value: unknown, name: string): string {
  const s = requiredString(value, name);
  if (!/^[a-f0-9]{64}$/.test(s)) {
    throw new TypeError(`${name} must be a 64-char lowercase hex SHA-256`);
  }
  return s;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new TypeError(`${name} must be one of ${choices.join(", ")}`);
  }
  return value as T[number];
}
