import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectFeaProofSealReviewUseCase } from "../../application/ports/in/project-fea-proof-seal-review.ts";
import type { ProjectFeaRecordedRunReviewUseCase } from "../../application/ports/in/project-fea-recorded-run-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectFeaReviewToolDependencies {
  /** Provider-free compilation of one catalogued case into fea.proof.* parameters. */
  feaProofSealReview?: ProjectFeaProofSealReviewUseCase;
  /** Provider-free compilation of @2 bindings from a sealed proof document. */
  feaRecordedRunReview?: ProjectFeaRecordedRunReviewUseCase;
}

/** Register the provider-free FEA seal and recorded-run review surfaces. */
export function registerProjectFeaReviewTools(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  registerSeal(app, dependencies);
  registerRecordedRun(app, dependencies);
}

function registerSeal(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  if (!dependencies.feaProofSealReview) return;
  const review = dependencies.feaProofSealReview;
  app.registerTool(projectFeaProofSealReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? `Resolved ${result.selected.caseId} on current Thread r${result.selected.basis.revision}. Paste next.append.arguments into project_change_append and next.propose.arguments into project_decision_propose; compiled workItemId=${result.selected.workItemId}, decisionId=${result.selected.decisionId}. STEP is ${result.selected.stepArtifactId}. No project or Thread write.`
      : result.status === "unavailable"
      ? "Unavailable: diagnostics name the missing project head, historical basis, or unreadable geometry/STEP source. No paste-ready next hop. Do not invent fea.proof.*."
      : "Unresolved: diagnostics name the catalog, Thread join, conflicting identity, or inconsistent source that failed. No decisionParameters. Do not invent fea.proof.*.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

function registerRecordedRun(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  if (!dependencies.feaRecordedRunReview) return;
  const review = dependencies.feaRecordedRunReview;
  app.registerTool(projectFeaRecordedRunReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? `Resolved verify.run-fea-static-proof@2 on current Thread r${result.selected.basis.revision}. Paste next.append.arguments (proofCase=${result.selected.proofArtifactId}, geometry=${result.selected.stepArtifactId} canonical part STEP), then next.propose.arguments; compiled workItemId=${result.selected.workItemId}, decisionId=${result.selected.decisionId}. No fea.run.* grammar.`
      : result.status === "unavailable"
      ? "Unavailable: diagnostics name the missing project head, historical basis, or unreadable @2 source. No paste-ready next hop. Never bind a cad-model as geometry."
      : "Unresolved: diagnostics name the proof, STEP join, or conflicting identity that failed. No bindings. Never bind a cad-model as geometry.";
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
    "Server-owned mechanical proof-case catalog id. Unknown ids yield unresolved; the caller never supplies a path or JSON.",
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

const projectFeaProofSealReviewTool: MCPTool = {
  name: "project_fea_proof_seal_review",
  description:
    "Compile verify.seal-proof-case@1 MRTR parameters and catalog-owned work/decision identities. Name the project; caseId and basis are optional (unique catalog case, unique current Thread tip — not latest). Only an appendable review against the exact current project head is resolved and carries next.append / next.propose. A historical basis, conflicting identity, or unreadable geometry/STEP source is unavailable or unresolved — never resolved. The caller never supplies material, mesh, loads, hashes or SysON UUIDs. Read-only: no project, Thread, MRTR or solver authority.",
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

const projectFeaRecordedRunReviewTool: MCPTool = {
  name: "project_fea_recorded_run_review",
  description:
    "Compile verify.run-fea-static-proof@2 bindings from a sealed proof document. Name the project; basis and proofArtifactId are optional (current Thread tip, unique seal). geometry is the canonical part STEP, never a cad-model or the isolated @3 authority. The review shares proof/STEP/history admission with the @2 plan resolver, but cannot pre-approve the future run MRTR. Only an appendable review against the exact current project head is resolved and carries next.append / next.propose. Not @1 or @3. Read-only: no MRTR or solver authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      basis: BASIS_SCHEMA,
      proofArtifactId: {
        ...ARTIFACT_ID_SCHEMA,
        description:
          "Exact sealed fea-proof document artifact id on the named basis (kind: document). Omit it when the basis has exactly one.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
