import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectModelicaQualifiedKitRunReviewCommand,
  ProjectModelicaQualifiedKitRunReviewUseCase,
} from "../../application/ports/in/modelica/qualified-kit-run-review.ts";
import type {
  ProjectAdmittedModelicaRunReviewRequest,
  ProjectAdmittedModelicaRunReviewUseCase,
} from "../../application/ports/in/modelica/admitted-run-review.ts";
import type {
  ProjectThermalMethodSheetSealReviewCommand,
  ProjectThermalMethodSheetSealReviewUseCase,
} from "../../application/ports/in/modelica/thermal-method-sheet/project-thermal-method-sheet-seal-review.ts";
import type {
  ProjectAdmittedModelicaEvaluationReviewRequest,
  ProjectAdmittedModelicaEvaluationReviewUseCase,
} from "../../application/ports/in/modelica/evaluation/project-admitted-modelica-evaluation-review.ts";
import type {
  ProjectAdmittedModelicaEvaluationCloseoutReviewUseCase,
} from "../../application/ports/in/modelica/evaluation/project-admitted-modelica-evaluation-closeout-review.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectModelicaReviewToolDependencies {
  /** Read-only preparation of the one code-owned qualified Modelica kit run. */
  modelicaQualifiedKitRunReview?: ProjectModelicaQualifiedKitRunReviewUseCase;
  /** Provider-free preparation of one admitted Modelica execution review. */
  admittedModelicaRunReview?: ProjectAdmittedModelicaRunReviewUseCase;
  /** Provider-free preparation of one thermal method-sheet seal review. */
  thermalMethodSheetSealReview?: ProjectThermalMethodSheetSealReviewUseCase;
  /** Provider-free preparation of one admitted observation evaluation review. */
  admittedModelicaEvaluationReview?: ProjectAdmittedModelicaEvaluationReviewUseCase;
  /** Provider-free preparation of one human L5 closeout review. */
  admittedModelicaEvaluationCloseoutReview?:
    ProjectAdmittedModelicaEvaluationCloseoutReviewUseCase;
}

/** Register the provider-free Modelica review surfaces. */
export function registerProjectModelicaReviewTools(
  app: McpApp,
  dependencies: ProjectModelicaReviewToolDependencies,
): void {
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

  if (dependencies.admittedModelicaRunReview) {
    const review = dependencies.admittedModelicaRunReview;
    app.registerTool(projectAdmittedModelicaRunReviewTool, async (args) => {
      const command = admittedModelicaRunReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          "Admitted Modelica execution review for the unique fresh sealed Modelica admission on the current Thread tip was prepared from exact server-reopened facts. Reuse the returned operation and its compilationAdmission binding verbatim on the later work item; do not reconstruct that thread-entity reference from a historical compile.seal-admission@3 creation snapshot. The returned admission, decisionParameters and operation are review material only: they contain no source bytes or runtime capability, no code was executed, and no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority was created.",
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }

  if (dependencies.admittedModelicaEvaluationReview) {
    const review = dependencies.admittedModelicaEvaluationReview;
    app.registerTool(projectAdmittedModelicaEvaluationReviewTool, async (args) => {
      const command = admittedModelicaEvaluationReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          "Admitted Modelica observation evaluation review was prepared from the unique Thread tip, sealed method sheet and admitted evidence. The returned admission and decisionParameters are review material only: they contain no Modelica source bytes, no OMC capability, no SysON envelope, no EngineeringProject or Thread state, and no L4 verdict. Construct a later verify.evaluate-admitted-modelica-observations@1 proposal only from decisionParameters.",
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }

  if (dependencies.admittedModelicaEvaluationCloseoutReview) {
    const review = dependencies.admittedModelicaEvaluationCloseoutReview;
    app.registerTool(
      projectAdmittedModelicaEvaluationCloseoutReviewTool,
      async (args) => {
        const command = admittedModelicaEvaluationCloseoutReviewCommand(args);
        const result = await review.execute(command);
        const content = result.status === "resolved"
          ? "Admitted Modelica evaluation closeout review was prepared from the unique current L4 document. Both accept and reject decisionParameters name the same exact project, subject, Thread basis, sheet and capture; they differ only in the declared human consequence. An L4 pass is never implicit L5. This provider-free read performed no OMC or SysON call and mutated no EngineeringProject or Thread state."
          : result.status === "unavailable"
          ? "Unavailable: the unique current L4 admitted Modelica evaluation cannot be reopened. No human closeout parameters were generated."
          : "Unresolved: current L4 closeout evidence is ambiguous, noncanonical, or has divergent provenance. No human closeout parameters were generated.";
        return {
          content,
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
  }

  if (dependencies.thermalMethodSheetSealReview) {
    const review = dependencies.thermalMethodSheetSealReview;
    app.registerTool(projectThermalMethodSheetSealReviewTool, async (args) => {
      const command = thermalMethodSheetSealReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          "Thermal method-sheet seal review for the named sheet fingerprint was prepared from exact server-reopened identities. The returned admission and decisionParameters are review material only: they contain no Modelica source bytes, no OMC capability, no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority. This is not an admitted run and not an L4 evaluation.",
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

const projectAdmittedModelicaEvaluationCloseoutReviewTool: MCPTool = {
  name: "project_admitted_modelica_evaluation_closeout_review",
  description:
    "Prepare the exact human-review identities and canonical MRTR parameters for one later decide.accept-admitted-modelica-evaluation@1 or decide.reject-admitted-modelica-evaluation@1 closeout. The caller names only projectId. The server reopens the unique current Thread tip and the unique fresh non-archived L4 document produced by verify.evaluate-admitted-modelica-observations@1. Both accept and reject parameters are always derived from those exact identities; L4 pass/fail/unresolved/error stay literal and never imply a closeout. This provider-free read performs no OMC or SysON call, mutates no EngineeringProject or Thread state, and grants no CAD, correction, rerun or provider action.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectAdmittedModelicaEvaluationReviewTool: MCPTool = {
  name: "project_admitted_modelica_evaluation_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one later verify.evaluate-admitted-modelica-observations@1 evaluation. The caller names only projectId. The server reopens the unique current Thread tip, unique sealed thermal method sheet, and unique admitted Modelica evidence. This provider-free read performs no OMC or SysON call, returns no source bytes or observation values as caller authority, mutates no EngineeringProject or Thread state, and grants no MRTR or L4 verdict. Values, units, feature, limit, provider, tool and args remain server-owned.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectAdmittedModelicaRunReviewTool: MCPTool = {
  name: "project_admitted_modelica_run_review",
  description:
    "Prepare the exact human-review identity, canonical MRTR parameters, and registered work-item operation for one future admitted Modelica closed-subset execution. The caller names only projectId; the server reopens the unique current Thread tip, selects its unique fresh non-archived canonical digital-thread compile.seal-admission@3 document whose compilation target/source is Modelica, and joins it to the server-owned execution profile. Reuse the returned operation verbatim: compilationAdmission is that selected admission artifact on the current review Thread basis, never a historical creation snapshot. A concurrent CAD admission is not a candidate. Missing, stale, archived, malformed, foreign-producer, CAD-only, or ambiguous Modelica admissions fail closed. This provider-free read performs no code execution, returns no source bytes or runtime capability, mutates no EngineeringProject or Thread state, and grants no MRTR, provider, or dispatch authority. Modelica text, Thread and artifact identities, runtime, isolation, output, profile, command, tool and transport facts remain server-owned. This is not simulate.run-qualified-modelica-kit@1 and not simulate.run-modelica-scenario@2.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectThermalMethodSheetSealReviewTool: MCPTool = {
  name: "project_thermal_method_sheet_seal_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one later verify.seal-modelica-thermal-method-sheet@1 document seal by reopening a reviewed modelica-thermal-method-sheet/1.0 and recrossing its Modelica source-analysis capture and SysML identities. The caller may name only the exact project and sheet fingerprint. This provider-free read performs no OMC execution, returns no source bytes, mutates no EngineeringProject or Thread state, and grants no MRTR, admission, evaluation, or dispatch authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      sheetFingerprint: FINGERPRINT_SCHEMA,
    },
    required: ["projectId", "sheetFingerprint"],
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

function admittedModelicaEvaluationCloseoutReviewCommand(
  value: Record<string, unknown>,
): { readonly projectId: string } {
  exactKeys(
    value,
    ["projectId"],
    [],
    "admittedModelicaEvaluationCloseoutReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
  };
}

function admittedModelicaEvaluationReviewCommand(
  value: Record<string, unknown>,
): ProjectAdmittedModelicaEvaluationReviewRequest {
  exactKeys(
    value,
    ["projectId"],
    [],
    "admittedModelicaEvaluationReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
  };
}

function thermalMethodSheetSealReviewCommand(
  value: Record<string, unknown>,
): ProjectThermalMethodSheetSealReviewCommand {
  exactKeys(
    value,
    ["projectId", "sheetFingerprint"],
    [],
    "thermalMethodSheetSealReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
    sheetFingerprint: fingerprintInput(
      value.sheetFingerprint,
      "sheetFingerprint",
    ),
  };
}

function admittedModelicaRunReviewCommand(
  value: Record<string, unknown>,
): ProjectAdmittedModelicaRunReviewRequest {
  exactKeys(
    value,
    ["projectId"],
    [],
    "admittedModelicaRunReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
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
): ProjectModelicaQualifiedKitRunReviewCommand["basis"] {
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
