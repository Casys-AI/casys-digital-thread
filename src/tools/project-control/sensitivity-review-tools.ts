import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectSensitivityStudySealReviewUseCase } from "../../application/ports/in/sensitivity/study/project-sensitivity-study-seal-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectSensitivityReviewToolDependencies {
  /** Provider-free compilation of one catalogued template into sensitivity.case.* parameters. */
  sensitivityStudySealReview?: ProjectSensitivityStudySealReviewUseCase;
}

/** Register the provider-free sensitivity-study seal-review surface. */
export function registerProjectSensitivityReviewTools(
  app: McpApp,
  dependencies: ProjectSensitivityReviewToolDependencies,
): void {
  if (!dependencies.sensitivityStudySealReview) return;
  const review = dependencies.sensitivityStudySealReview;
  app.registerTool(projectSensitivityStudySealReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? `Resolved ${result.selected.caseId} on current Thread r${result.selected.basis.revision}. Paste next.append.arguments into project_change_append and next.propose.arguments into project_decision_propose; compiled workItemId=${result.selected.workItemId}, decisionId=${result.selected.decisionId}. cadSource is admission ${result.selected.admissionArtifactId}. No project or Thread write.`
      : result.status === "unavailable"
      ? "Unavailable: diagnostics name the missing project head, historical basis, or unreadable admission. No paste-ready next hop. Do not invent sensitivity.case.*."
      : "Unresolved: diagnostics name the catalog, Thread join, conflicting identity, or lookalike cadSource that failed. No decisionParameters. Do not invent sensitivity.case.*.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const CASE_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  description:
    "Optional catalog id or compiled signed-offer case id. Unknown ids yield unresolved; the caller never supplies a path, JSON, or cadSource.",
} as const;

const ARTIFACT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const BASIS_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "thread-snapshot" },
    snapshotId: {
      ...ARTIFACT_ID_SCHEMA,
      description:
        "Exact Thread snapshot id. latest is refused as unresolved basis-latest; do not send it.",
    },
    revision: { type: "integer", minimum: 1 },
    subjectId: ARTIFACT_ID_SCHEMA,
  },
  required: ["kind", "snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const projectSensitivityStudySealReviewTool: MCPTool = {
  name: "project_sensitivity_study_seal_review",
  description:
    "Compile analyze.seal-sensitivity-study@1 MRTR parameters and server-owned work/decision identities compiled from the case id. Name the project; caseId and basis are optional (unique catalog template, or unique signed catalog-offer when the catalog does not uniquely select — absent or ambiguous; unique current Thread tip — not latest). cadSource is the signed offer compile.seal-admission@3 admission or the unique readable admission whose source binds the template target.semanticKey. Not design.write-geometry@1, a cad-model, a STEP, or design.seal-isolated-geometry@1. Only an appendable review against the exact current project head is resolved and carries next.append / next.propose. A historical basis, catalog-absent project without a signed offer, or unbound semanticKey is unavailable or unresolved — never resolved. The caller never supplies mesh, loads, boxes, hashes or cadSource. Read-only: no project, Thread, MRTR or solver authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      caseId: CASE_ID_SCHEMA,
      basis: BASIS_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
