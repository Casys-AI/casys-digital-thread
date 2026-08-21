/** Read-only project-control surface for closed cross-domain impact manifest review. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectCrossDomainImpactManifestSealReviewCommand,
  ProjectCrossDomainImpactManifestSealReviewUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-manifest-seal-review.ts";
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
}

/**
 * Register the sole X06 review surface. It has no command, approval, branch,
 * edge, artifact, solver, provider, tool, argument, or Workbench authority.
 */
export function registerProjectCrossDomainImpactReviewTools(
  app: McpApp,
  dependencies: ProjectCrossDomainImpactReviewToolDependencies,
): void {
  const review = dependencies.crossDomainImpactManifestSealReview;
  if (!review) return;
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

function command(value: Record<string, unknown>): ProjectCrossDomainImpactManifestSealReviewCommand {
  const root = exactRecord(value, ["projectId", "manifestRef"], "$projectCrossDomainImpactManifestSealReview");
  const manifestRef = exactRecord(
    root.manifestRef,
    ["fingerprint"],
    "$projectCrossDomainImpactManifestSealReview.manifestRef",
  );
  return {
    projectId: safeId(root.projectId, "$projectCrossDomainImpactManifestSealReview.projectId"),
    manifestRef: {
      fingerprint: validateContentFingerprint(
        manifestRef.fingerprint,
        "$projectCrossDomainImpactManifestSealReview.manifestRef.fingerprint",
      ),
    },
  };
}
