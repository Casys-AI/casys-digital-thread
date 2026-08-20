import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectModelicaQualifiedKitRunReviewCommand,
  ProjectModelicaQualifiedKitRunReviewUseCase,
} from "../../application/ports/in/modelica/qualified-kit-run-review.ts";
import type {
  ProjectAdmittedModelicaRunReviewRequest,
  ProjectAdmittedModelicaRunReviewUseCase,
} from "../../application/ports/in/modelica/admitted-run-review.ts";
import { OBJECT_OUTPUT_SCHEMA, READ_ONLY_ANNOTATIONS } from "./mcp-tool-schemas.ts";

export interface ProjectModelicaReviewToolDependencies {
  /** Read-only preparation of the one code-owned qualified Modelica kit run. */
  modelicaQualifiedKitRunReview?: ProjectModelicaQualifiedKitRunReviewUseCase;
  /** Provider-free preparation of one admitted Modelica execution review. */
  admittedModelicaRunReview?: ProjectAdmittedModelicaRunReviewUseCase;
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
          "Admitted Modelica execution review for the unique fresh sealed admission on the current Thread tip was prepared from exact server-reopened facts. The returned admission and decisionParameters are review material only: they contain no source bytes or runtime capability, no code was executed, and no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority was created.",
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

const projectAdmittedModelicaRunReviewTool: MCPTool = {
  name: "project_admitted_modelica_run_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one future admitted Modelica closed-subset execution. The caller names only projectId; the server reopens the unique current Thread tip, selects its unique fresh non-archived canonical digital-thread compile.seal-admission@1 document, and joins it to the server-owned execution profile. Missing, stale, archived, malformed, foreign-producer, or ambiguous admissions fail closed. This provider-free read performs no code execution, returns no source bytes or runtime capability, mutates no EngineeringProject or Thread state, and grants no MRTR, provider, or dispatch authority. Modelica text, Thread and artifact identities, runtime, isolation, output, profile, command, tool and transport facts remain server-owned. This is not simulate.run-qualified-modelica-kit@1 and not simulate.run-modelica-scenario@2.",
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
