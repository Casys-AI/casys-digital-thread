import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectFeaProofSealReviewUseCase } from "../../application/ports/in/fea/seal-case/project-fea-proof-seal-review.ts";
import type { ProjectFeaIsolatedRunReviewUseCase } from "../../application/ports/in/fea/isolated-v3/project-fea-isolated-run-review.ts";
import type { ProjectEvaluationCloseoutReviewUseCase } from "../../application/ports/in/fea/evaluation-closeout/project-evaluation-closeout-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectFeaReviewToolDependencies {
  /** Provider-free compilation of one catalogued case into fea.proof.* parameters. */
  feaProofSealReview?: ProjectFeaProofSealReviewUseCase;
  /** Provider-free compilation of isolated @3 bindings from a sealed proof document. */
  feaIsolatedRunReview?: ProjectFeaIsolatedRunReviewUseCase;
  /** Provider-free human L5 review of the exact current static FEA @3 branch. */
  evaluationCloseoutReview?: ProjectEvaluationCloseoutReviewUseCase;
}

/** Register the provider-free FEA seal and isolated-run review surfaces. */
export function registerProjectFeaReviewTools(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  registerSeal(app, dependencies);
  registerIsolatedRun(app, dependencies);
  registerEvaluationCloseout(app, dependencies);
}

function registerEvaluationCloseout(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  if (!dependencies.evaluationCloseoutReview) return;
  const review = dependencies.evaluationCloseoutReview;
  app.registerTool(projectEvaluationCloseoutReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? result.selected.acceptanceEligibility
        ? "Resolved fresh static-mechanical L5 evidence on the unique current Thread tip. The server derived both human closeout grammars; accept is eligible only because every declared L4 criterion is literal pass. Present the exact consequences to the responsible human. Only after that person chooses and signs one disposition may the corresponding exact parameters enter the normal project change/decision flow. No solver, SysON, CAD, or correction action occurred."
        : "Resolved fresh static-mechanical L5 evidence on the unique current Thread tip. Accept is unavailable because at least one declared L4 criterion is non-pass; the server derived only the bounded human reject closeout. Reject grants no correction, CAD, FEA, or provider action."
      : result.status === "unavailable"
      ? "Unavailable: the unique current static FEA @3 branch or one exact fresh evidence identity cannot be reopened. No human closeout parameters were generated."
      : "Unresolved: current static FEA evidence is ambiguous, noncanonical, or has divergent provenance. No human closeout parameters were generated.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
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

function registerIsolatedRun(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  if (!dependencies.feaIsolatedRunReview) return;
  const review = dependencies.feaIsolatedRunReview;
  app.registerTool(projectFeaIsolatedRunReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? `Resolved verify.run-fea-static-proof@3 on current Thread r${result.selected.basis.revision}. Paste next.append.arguments (proofCase=${result.selected.proofArtifactId}, geometry=${result.selected.stepArtifactId} canonical part STEP), then next.propose.arguments; compiled workItemId=${result.selected.workItemId}, decisionId=${result.selected.decisionId}. No fea.run.* grammar.`
      : result.status === "unavailable"
      ? "Unavailable: diagnostics name the missing project head, historical basis, or unreadable isolated source. No paste-ready next hop. Never bind a cad-model as geometry."
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
    "Compile verify.seal-proof-case@1 MRTR parameters and catalog-owned work/decision identities. Name the project; caseId and basis are optional (unique catalog case, unique current Thread tip — not latest). sensitivityCatalogOptIn is an explicit false-by-default request: true is accepted only when one exact causal admission lever joins the proof CAD definition and target, then the offer digest and admission identity are added to the same MRTR. Only an appendable review against the exact current project head is resolved and carries next.append / next.propose. A historical basis, conflicting identity, or unreadable geometry/STEP source is unavailable or unresolved — never resolved. The caller never supplies material, mesh, loads, hashes or SysON UUIDs. Read-only: no project, Thread, MRTR or solver authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      caseId: CASE_ID_SCHEMA,
      basis: BASIS_SCHEMA,
      sensitivityCatalogOptIn: {
        type: "boolean",
        description:
          "Explicit opt-in to seal the causally joined sensitivity catalog offer with the FEA proof. Omit or send false to seal only the proof.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectFeaIsolatedRunReviewTool: MCPTool = {
  name: "project_fea_isolated_run_review",
  description:
    "Compile verify.run-fea-static-proof@3 bindings from a sealed proof document. Name the project; basis and proofArtifactId are optional (current Thread tip, unique seal). geometry is the canonical part STEP, never a cad-model. The review shares proof/STEP/history admission with the isolated plan resolver, but cannot pre-approve the future run MRTR. Only an appendable review against the exact current project head is resolved and carries next.append / next.propose. Historical MCP FEA runs are not registered. Read-only: no MRTR or solver authority.",
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

const projectEvaluationCloseoutReviewTool: MCPTool = {
  name: "project_evaluation_closeout_review",
  description:
    "Read-only review of the generic static-mechanical human L5 closeout. The caller names only projectId; the server selects the unique current Thread tip and reopens the exact canonical STEP, sealed proof, isolated execution evidence, L4 evaluation capture, criteria, proof limitations, producer runs and freshness. It returns closed accept/reject MRTR parameters only when their exact evidence resolves. Accept appears only when every declared L4 criterion is literal pass. Reject records only none or mechanical-review-required and grants no correction, CAD, FEA, solver, SysON, provider tool, argument, URI, threshold, result, or action. An L4 pass is never L5.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
