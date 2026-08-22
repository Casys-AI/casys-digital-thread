/** Read-only project-control surface for closed cross-domain impact manifest review. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectCrossDomainImpactManifestSealReviewCommand,
  ProjectCrossDomainImpactManifestSealReviewUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-manifest-seal-review.ts";
import type {
  ProjectCrossDomainImpactDecisionReviewUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-decision-review.ts";
import { validateContentFingerprint } from "../../domain/compile/isolation/isolated-code-execution.ts";
import { exactRecord, safeId } from "../../domain/kernel/case-validation.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectCrossDomainImpactReviewToolDependencies {
  readonly crossDomainImpactManifestSealReview?:
    ProjectCrossDomainImpactManifestSealReviewUseCase;
  readonly crossDomainImpactDecisionReview?:
    ProjectCrossDomainImpactDecisionReviewUseCase;
}

/**
 * Register the read-only impact review surfaces. They have no command,
 * approval, branch, edge, artifact, solver, provider, tool, argument, or
 * Workbench authority.
 */
export function registerProjectCrossDomainImpactReviewTools(
  app: McpApp,
  dependencies: ProjectCrossDomainImpactReviewToolDependencies,
): void {
  const review = dependencies.crossDomainImpactManifestSealReview;
  if (review) {
    app.registerTool(projectCrossDomainImpactManifestSealReviewTool, async (args) => {
      const result = await review.execute(command(args));
      return {
        content: result.status === "resolved"
          ? "The exact cross-domain impact manifest, Thread lineage, declared mechanical evidence, and approved Brief V2 gates were reread into canonical MRTR review material. This read-only result grants no human approval, provider/solver call, evaluation, gate-claim transition, Thread write, or dispatch authority."
          : `The cross-domain impact-manifest seal review is ${result.status}. No MRTR decision parameters, evaluation, gate transition, Thread write, or dispatch authority were created.`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
  const decisionReview = dependencies.crossDomainImpactDecisionReview;
  if (!decisionReview) return;
  app.registerTool(projectCrossDomainImpactDecisionReviewTool, async (args) => {
    const result = await decisionReview.execute(commandDecision(args));
    return {
      content: result.status === "resolved"
        ? "The unique current Thread tip, exact impact-evaluation capture, Brief V2 gates, and existing work-item claims were reread into canonical MRTR review material. This read-only result grants no human approval, gate-claim transition, rerun, provider/solver call, Thread write, or dispatch authority."
        : `The cross-domain impact-decision review is ${result.status}. No MRTR decision parameters, gate transition, rerun, Thread write, or dispatch authority were created.`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const PROJECT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const projectCrossDomainImpactManifestSealReviewTool: MCPTool = {
  name: "project_cross_domain_impact_manifest_seal_review",
  description:
    "Prepare literal unavailable/unresolved or exact human-review facts and canonical MRTR parameters for one later verify.seal-cross-domain-impact-manifest@1 document seal. The caller names only projectId and an opaque manifest content fingerprint. The server alone reopens the closed manifest, its named project/subject/Thread basis, approved Brief V2 gate identities and dependencies, and declared mechanical evidence references. This read-only operation accepts no branch, causal edge, artifact identity, provider envelope, solver/tool/argument, source bytes, approval, gate transition, evaluation result, or Workbench command; it mutates no EngineeringProject or Thread state.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID_SCHEMA,
      manifestRef: {
        type: "object",
        properties: { fingerprint: FINGERPRINT_SCHEMA },
        required: ["fingerprint"],
        additionalProperties: false,
      },
    },
    required: ["projectId", "manifestRef"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectCrossDomainImpactDecisionReviewTool: MCPTool = {
  name: "project_cross_domain_impact_decision_review",
  description:
    "Prepare literal unavailable/unresolved or exact human-review facts and canonical MRTR parameters for one later decide.accept-cross-domain-impact@1. The caller names only projectId. The server reopens the unique current Thread tip and unique X07/X08 evaluation capture, then recrosses approved Brief V2 gates and existing work-item claims. X07/X08 does not propose work-item invalidations or reruns. This read-only operation accepts no branch, impact, status, provider envelope, solver/tool/argument, gate, work item, approval, or Workbench command; it mutates no EngineeringProject or Thread state and queues no rerun.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

function command(
  value: Record<string, unknown>,
): ProjectCrossDomainImpactManifestSealReviewCommand {
  const root = exactRecord(
    value,
    ["projectId", "manifestRef"],
    "$projectCrossDomainImpactManifestSealReview",
  );
  const manifestRef = exactRecord(
    root.manifestRef,
    ["fingerprint"],
    "$projectCrossDomainImpactManifestSealReview.manifestRef",
  );
  return {
    projectId: safeId(
      root.projectId,
      "$projectCrossDomainImpactManifestSealReview.projectId",
    ),
    manifestRef: {
      fingerprint: validateContentFingerprint(
        manifestRef.fingerprint,
        "$projectCrossDomainImpactManifestSealReview.manifestRef.fingerprint",
      ),
    },
  };
}

function commandDecision(
  value: Record<string, unknown>,
): { readonly projectId: string } {
  const root = exactRecord(
    value,
    ["projectId"],
    "$projectCrossDomainImpactDecisionReview",
  );
  return {
    projectId: safeId(
      root.projectId,
      "$projectCrossDomainImpactDecisionReview.projectId",
    ),
  };
}
