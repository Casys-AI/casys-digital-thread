import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectFeaProofCaseCaptureUseCase } from "../../application/ports/in/fea/seal-case/project-fea-proof-case-capture.ts";
import type { ProjectFeaProofSealReviewUseCase } from "../../application/ports/in/fea/seal-case/project-fea-proof-seal-review.ts";
import type { ProjectFeaIsolatedRunReviewUseCase } from "../../application/ports/in/fea/isolated-v3/project-fea-isolated-run-review.ts";
import type { ProjectEvaluationCloseoutReviewUseCase } from "../../application/ports/in/fea/evaluation-closeout/project-evaluation-closeout-review.ts";
import { captureReviewContent } from "../../domain/fea/seal-case/fea-proof-case-source-capture.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import {
  AGENT_RESOURCE_REFERENCE_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectFeaReviewToolDependencies {
  /** Provider-free draft-CAS capture of exact mechanical-proof-case-source/1.0 JSON. */
  feaProofCaseCapture?: ProjectFeaProofCaseCaptureUseCase;
  /** Provider-free compilation of one captured source into fea.proof.* parameters. */
  feaProofSealReview?: ProjectFeaProofSealReviewUseCase;
  /** Provider-free compilation of isolated @3 bindings from a sealed proof document. */
  feaIsolatedRunReview?: ProjectFeaIsolatedRunReviewUseCase;
  /** Provider-free human L5 review of the exact current static FEA @3 branch. */
  evaluationCloseoutReview?: ProjectEvaluationCloseoutReviewUseCase;
}

/** Register the provider-free FEA capture, seal and isolated-run surfaces. */
export function registerProjectFeaReviewTools(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  registerCapture(app, dependencies);
  registerSeal(app, dependencies);
  registerIsolatedRun(app, dependencies);
  registerEvaluationCloseout(app, dependencies);
}

function registerCapture(
  app: McpApp,
  dependencies: ProjectFeaReviewToolDependencies,
): void {
  if (!dependencies.feaProofCaseCapture) return;
  const capture = dependencies.feaProofCaseCapture;
  app.registerTool(projectFeaProofCaseCaptureTool, async (args) => {
    const review = await capture.capture({
      resourceRef: parseAgentResourceReference(
        args.resourceRef,
        "$feaProofCaseCapture.resourceRef",
      ),
    });
    return {
      content: captureReviewContent(review),
      structuredContent: review as unknown as Record<string, unknown>,
    };
  });
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
      : "Unresolved: diagnostics name the captured source, Thread join, conflicting identity, or inconsistent CAD lineage that failed. No decisionParameters. Do not invent fea.proof.*.";
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

const SOURCE_CAPTURE_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    fingerprint: {
      type: "string",
      pattern: "^[a-f0-9]{64}$",
    },
  },
  required: ["fingerprint"],
  additionalProperties: false,
} as const;

const ARTIFACT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const DRAFT_CAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const projectFeaProofCaseCaptureTool: MCPTool = {
  name: "project_fea_proof_case_capture",
  description:
    "Capture exact agent-authored mechanical-proof-case-source/1.0 JSON in immutable draft CAS. First call project_resource_capture, then supply that full resourceRef. The server reopens exact UTF-8 JSON, parses, stores canonical bytes, and rereads them. The returned FEA case fingerprint may differ from the raw resource SHA. Pass result.reference, never this whole review, to project_fea_proof_seal_review. Thread tip, CAD provenance, solver, provider, tool, runtime and work/decision identities remain server-owned. This writes no EngineeringProject or Thread state and grants no MRTR or execution authority.",
  inputSchema: {
    type: "object",
    properties: {
      resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    },
    required: ["resourceRef"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      schemaVersion: { const: "fea-proof-case-source-capture-review/1.0" },
      status: { const: "captured" },
      reference: SOURCE_CAPTURE_REFERENCE_SCHEMA,
      id: {
        type: "string",
        minLength: 1,
        maxLength: 256,
      },
      revision: { type: "integer", minimum: 1 },
      project: {
        type: "object",
        properties: {
          id: ARTIFACT_ID_SCHEMA,
          subjectId: ARTIFACT_ID_SCHEMA,
        },
        required: ["id", "subjectId"],
        additionalProperties: false,
      },
      target: {
        type: "object",
        properties: {
          id: ARTIFACT_ID_SCHEMA,
          modelElementId: ARTIFACT_ID_SCHEMA,
        },
        required: ["id", "modelElementId"],
        additionalProperties: false,
      },
      metrics: {
        type: "array",
        items: { type: "string" },
      },
      grants: { const: "none" },
    },
    required: [
      "schemaVersion",
      "status",
      "reference",
      "id",
      "revision",
      "project",
      "target",
      "metrics",
      "grants",
    ],
    additionalProperties: false,
  },
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

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
    "Compile verify.seal-proof-case@1 MRTR parameters from one opaque captured source. Name projectId and caseRef.fingerprint from project_fea_proof_case_capture result.reference. The server selects the unique current Thread tip — not latest — and recrosses unique canonical part STEP, CAD provenance, SysON requirements and derived work/decision identities. sensitivityCatalogOptIn is an explicit false-by-default request: true is accepted only when one exact causal admission lever joins the proof CAD definition and target after those joins. Only an appendable review against the exact current project head is resolved and carries next.append / next.propose. The caller never supplies material, mesh, loads, hashes, provider, tool, runtime, workItemId, decisionId or basis. Read-only: no project, Thread, MRTR or solver authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      caseRef: SOURCE_CAPTURE_REFERENCE_SCHEMA,
      sensitivityCatalogOptIn: {
        type: "boolean",
        description:
          "Explicit opt-in to seal the causally joined sensitivity catalog offer with the FEA proof. Omit or send false to seal only the proof.",
      },
    },
    required: ["projectId", "caseRef"],
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
