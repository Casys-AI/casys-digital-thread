import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectBuild123dExecutionReviewCommand,
  ProjectBuild123dExecutionReviewUseCase,
} from "../../application/ports/in/project-build123d-execution-review.ts";
import type {
  ProjectModelicaQualifiedKitRunReviewCommand,
  ProjectModelicaQualifiedKitRunReviewUseCase,
} from "../../application/ports/in/project-modelica-qualified-kit-run-review.ts";
import type {
  ProjectTechnicalCompilationPreviewCommand,
  ProjectTechnicalCompilationPreviewUseCase,
} from "../../application/ports/in/project-technical-compilation-preview.ts";
import type {
  ProjectTechnicalSourceCaptureCommand,
  ProjectTechnicalSourceCaptureUseCase,
} from "../../application/ports/in/project-technical-source-capture.ts";
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
  /** Provider-free preparation of one qualified Build123d execution review. */
  build123dExecutionReview?: ProjectBuild123dExecutionReviewUseCase;
  /** Read-only preparation of the one code-owned qualified Modelica kit run. */
  modelicaQualifiedKitRunReview?: ProjectModelicaQualifiedKitRunReviewUseCase;
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
      const reference = await capture.capture(command);
      return {
        content:
          `Technical source ${command.sourceId} was captured as exact UTF-8 bytes, analysed under server-registered profile ${command.profileId}, and reread from draft CAS. Preserve the returned reference verbatim. This creates no EngineeringProject or Thread state, no MRTR decision, and no execution authority.`,
        structuredContent: reference as Readonly<Record<string, unknown>>,
      };
    });
  }

  if (dependencies.technicalCompilationPreview) {
    const preview = dependencies.technicalCompilationPreview;
    app.registerTool(projectTechnicalCompilationPreviewTool, async (args) => {
      const command = technicalCompilationPreviewCommand(args);
      const result = await preview.execute(command);
      const content = result.status === "ready-for-review"
        ? `Technical compilation ${result.draft.draftId} is ready for review and was reread from draft CAS. Its document and exact draft reference are not EngineeringProject or Thread state, an MRTR decision, or execution authority. Construct a later MRTR proposal only from decisionParameters returned by this preview; if none are present, do not invent them.`
        : `Technical compilation preview is ${result.status}. No reviewable draft was created. The returned document is diagnostic only and creates no EngineeringProject or Thread state, MRTR decision, or execution authority.`;
      return {
        content,
        // Preserve every use-case-owned review field verbatim, including
        // decisionParameters when the ready result provides them. The MCP
        // surface must never derive or repair MRTR parameters itself.
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

  if (dependencies.modelicaQualifiedKitRunReview) {
    const review = dependencies.modelicaQualifiedKitRunReview;
    app.registerTool(projectModelicaQualifiedKitRunReviewTool, async (args) => {
      const command = modelicaQualifiedKitRunReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          "The exact local Modelica solver-conformance kit review was prepared from the current Thread basis, code-owned bundle, pinned profile, and durable runtime qualification. The returned admission and decisionParameters are review material only: no source bytes or runtime capability are exposed, no simulation ran, no project or Thread state changed, and no dispatch authority was created.",
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
        role: { type: "string", enum: ["cad-script", "modelica-model"] },
        language: { type: "string", enum: ["python", "modelica"] },
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

const TECHNICAL_BINDING_SCHEMA = {
  type: "object",
  properties: {
    id: TECHNICAL_ID_SCHEMA,
    sourceId: TECHNICAL_ID_SCHEMA,
    sourceSymbolId: TECHNICAL_ID_SCHEMA,
    sysmlElementId: TECHNICAL_ID_SCHEMA,
    sysmlElementKind: TECHNICAL_ID_SCHEMA,
    relation: {
      type: "string",
      enum: ["represents", "parameterizes", "satisfies", "constrains"],
    },
  },
  required: [
    "id",
    "sourceId",
    "sourceSymbolId",
    "sysmlElementId",
    "sysmlElementKind",
    "relation",
  ],
  additionalProperties: false,
} as const;

const TECHNICAL_PROFILE_REQUEST_SCHEMA = {
  type: "object",
  properties: {
    profileId: TECHNICAL_ID_SCHEMA,
    profileVersion: TECHNICAL_VERSION_SCHEMA,
    sourceIds: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
      items: TECHNICAL_ID_SCHEMA,
    },
  },
  required: ["profileId", "profileVersion", "sourceIds"],
  additionalProperties: false,
} as const;

const DRAFT_CAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const projectTechnicalSourceCaptureTool: MCPTool = {
  name: "project_technical_source_capture",
  description:
    "Capture exact agent-authored technical source bytes and their server-selected parser analysis in immutable draft CAS. The caller may select only a registered profile id and source id; language, analyzer and policy remain server-owned. The returned object is an opaque reference to preserve verbatim for project_technical_compilation_preview. This writes no EngineeringProject or Thread state, creates no MRTR decision, and performs no technical execution.",
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
  outputSchema: TECHNICAL_SOURCE_CAPTURE_REFERENCE_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectTechnicalCompilationPreviewTool: MCPTool = {
  name: "project_technical_compilation_preview",
  description:
    "Compile exact draft-CAS technical source references against one exact Thread/SysML basis using only server-owned analysis and qualification profiles. This is provider-free and performs no technical execution. A ready result contains the exact review draft and compilation document. Construct a later MRTR proposal only from decisionParameters returned by the use case; never invent missing parameters. The preview writes no EngineeringProject or Thread state and grants no MRTR or execution authority.",
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
      },
      bindings: {
        type: "array",
        maxItems: 256,
        items: TECHNICAL_BINDING_SCHEMA,
      },
      profileRequests: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: TECHNICAL_PROFILE_REQUEST_SCHEMA,
      },
    },
    required: ["projectId", "basis", "sourceRefs", "bindings", "profileRequests"],
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

const projectModelicaQualifiedKitRunReviewTool: MCPTool = {
  name: "project_modelica_qualified_kit_run_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for the one qualified local Modelica linear thermal ramp conformance run. The caller names only the exact project and current Thread basis. Kit source, scenario, solver, image, policy, limits, profile and qualification remain server-owned. This read-only operation performs no execution, returns no source bytes or runtime capability, mutates no project or Thread state, and grants no MRTR or dispatch authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      basis: TECHNICAL_THREAD_BASIS_SCHEMA,
    },
    required: ["projectId", "basis"],
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
    ["projectId", "basis", "sourceRefs", "bindings", "profileRequests"],
    [],
    "technicalCompilationPreview",
  );
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) {
    throw new TypeError("sourceRefs must be a non-empty array");
  }
  if (value.sourceRefs.length > 32) {
    throw new TypeError("sourceRefs must not exceed 32 entries");
  }
  if (!Array.isArray(value.bindings)) {
    throw new TypeError("bindings must be an array");
  }
  if (value.bindings.length > 256) {
    throw new TypeError("bindings must not exceed 256 entries");
  }
  if (!Array.isArray(value.profileRequests) || value.profileRequests.length === 0) {
    throw new TypeError("profileRequests must be a non-empty array");
  }
  if (value.profileRequests.length > 32) {
    throw new TypeError("profileRequests must not exceed 32 entries");
  }
  return {
    projectId: technicalId(value.projectId, "projectId"),
    basis: technicalThreadBasis(value.basis, "basis"),
    sourceRefs: value.sourceRefs.map((reference, index) =>
      technicalSourceCaptureReference(reference, `sourceRefs[${index}]`)
    ),
    bindings: value.bindings.map((binding, index) =>
      technicalBinding(binding, `bindings[${index}]`)
    ),
    profileRequests: value.profileRequests.map((request, index) =>
      technicalProfileRequest(request, `profileRequests[${index}]`)
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

function modelicaQualifiedKitRunReviewCommand(
  value: Record<string, unknown>,
): ProjectModelicaQualifiedKitRunReviewCommand {
  exactKeys(
    value,
    ["projectId", "basis"],
    [],
    "modelicaQualifiedKitRunReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    basis: technicalThreadBasis(value.basis, "basis"),
  };
}

function technicalThreadBasis(
  value: unknown,
  name: string,
): ProjectTechnicalCompilationPreviewCommand["basis"] {
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

function technicalBinding(
  value: unknown,
  name: string,
): ProjectTechnicalCompilationPreviewCommand["bindings"][number] {
  const binding = exactRecord(value, name);
  exactKeys(
    binding,
    [
      "id",
      "sourceId",
      "sourceSymbolId",
      "sysmlElementId",
      "sysmlElementKind",
      "relation",
    ],
    [],
    name,
  );
  return {
    id: technicalId(binding.id, `${name}.id`),
    sourceId: technicalId(binding.sourceId, `${name}.sourceId`),
    sourceSymbolId: technicalId(binding.sourceSymbolId, `${name}.sourceSymbolId`),
    sysmlElementId: technicalId(binding.sysmlElementId, `${name}.sysmlElementId`),
    sysmlElementKind: technicalId(
      binding.sysmlElementKind,
      `${name}.sysmlElementKind`,
    ),
    relation: oneOf(
      binding.relation,
      ["represents", "parameterizes", "satisfies", "constrains"] as const,
      `${name}.relation`,
    ),
  };
}

function technicalProfileRequest(
  value: unknown,
  name: string,
): ProjectTechnicalCompilationPreviewCommand["profileRequests"][number] {
  const request = exactRecord(value, name);
  exactKeys(request, ["profileId", "profileVersion", "sourceIds"], [], name);
  if (!Array.isArray(request.sourceIds) || request.sourceIds.length === 0) {
    throw new TypeError(`${name}.sourceIds must be a non-empty array`);
  }
  if (request.sourceIds.length > 32) {
    throw new TypeError(`${name}.sourceIds must not exceed 32 entries`);
  }
  return {
    profileId: technicalId(request.profileId, `${name}.profileId`),
    profileVersion: exactNonEmptyText(
      request.profileVersion,
      `${name}.profileVersion`,
    ),
    sourceIds: request.sourceIds.map((sourceId, index) =>
      technicalId(sourceId, `${name}.sourceIds[${index}]`)
    ),
  };
}

function technicalSourceCaptureReference(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> {
  const reference = exactRecord(value, name);
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
    ["cad-script", "modelica-model"] as const,
    `${name}.source.role`,
  );
  const language = oneOf(
    source.language,
    ["python", "modelica"] as const,
    `${name}.source.language`,
  );
  if (
    !(
      (role === "cad-script" && language === "python") ||
      (role === "modelica-model" && language === "modelica")
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
