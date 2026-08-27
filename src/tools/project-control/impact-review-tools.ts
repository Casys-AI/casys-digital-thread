/** Project-control surface for draft impact-manifest capture and closed review. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import {
  type ProjectCrossDomainImpactManifestCaptureCommand,
  type ProjectCrossDomainImpactManifestCaptureUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-manifest-capture.ts";
import type {
  ProjectCrossDomainImpactManifestSealReviewCommand,
  ProjectCrossDomainImpactManifestSealReviewUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-manifest-seal-review.ts";
import type {
  ProjectCrossDomainImpactDecisionReviewUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-decision-review.ts";
import { captureReviewContent } from "../../domain/impact/cross-domain-impact-manifest-capture-review.ts";
import { validateContentFingerprint } from "../../domain/compile/isolation/isolated-code-execution.ts";
import { exactRecord, safeId } from "../../domain/kernel/case-validation.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import {
  AGENT_RESOURCE_REFERENCE_SCHEMA,
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectCrossDomainImpactReviewToolDependencies {
  readonly crossDomainImpactManifestCapture?:
    ProjectCrossDomainImpactManifestCaptureUseCase;
  readonly crossDomainImpactManifestSealReview?:
    ProjectCrossDomainImpactManifestSealReviewUseCase;
  readonly crossDomainImpactDecisionReview?:
    ProjectCrossDomainImpactDecisionReviewUseCase;
}

/**
 * Register the draft capture and read-only impact review surfaces. They have
 * no command, approval, branch, edge, artifact, solver, provider, tool,
 * argument, runtime, or Workbench authority.
 */
export function registerProjectCrossDomainImpactReviewTools(
  app: McpApp,
  dependencies: ProjectCrossDomainImpactReviewToolDependencies,
): void {
  const capture = dependencies.crossDomainImpactManifestCapture;
  if (capture) {
    app.registerTool(projectCrossDomainImpactManifestCaptureTool, async (args) => {
      const review = await capture.capture(captureCommand(args));
      return {
        content: captureReviewContent(review),
        structuredContent: review as unknown as Record<string, unknown>,
      };
    });
  }
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

const SAFE_ID_SCHEMA = {
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

const CAPTURE_REFERENCE_SCHEMA = {
  type: "object",
  properties: { fingerprint: FINGERPRINT_SCHEMA },
  required: ["fingerprint"],
  additionalProperties: false,
} as const;

const IMPACT_MANIFEST_CAPTURE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "cross-domain-impact-manifest-capture-review/2.0" },
    status: { const: "captured" },
    reference: CAPTURE_REFERENCE_SCHEMA,
    summary: {
      type: "object",
      properties: {
        id: SAFE_ID_SCHEMA,
        revision: { type: "integer", minimum: 1 },
        basis: {
          type: "object",
          properties: {
            projectId: SAFE_ID_SCHEMA,
            subjectId: SAFE_ID_SCHEMA,
            snapshotId: SAFE_ID_SCHEMA,
            revision: { type: "integer", minimum: 1 },
          },
          required: ["projectId", "subjectId", "snapshotId", "revision"],
          additionalProperties: false,
        },
        changeKinds: {
          type: "array",
          minItems: 1,
          items: SAFE_ID_SCHEMA,
        },
      },
      required: ["id", "revision", "basis", "changeKinds"],
      additionalProperties: false,
    },
    grants: { const: "none" },
  },
  required: ["schemaVersion", "status", "reference", "summary", "grants"],
  additionalProperties: false,
} as const;

const projectCrossDomainImpactManifestCaptureTool: MCPTool = {
  name: "project_cross_domain_impact_manifest_capture",
  description:
    "Capture exact agent-authored cross-domain-impact-manifest/2.0 JSON in immutable draft CAS. First call project_resource_capture, then supply that full resourceRef. The JSON body must omit its computed fingerprint field. The server reopens exact UTF-8, validates the closed object, canonicalizes it, and computes the embedded body fingerprint and outer CAS fingerprint. Pass result.reference as manifestRef to project_cross_domain_impact_manifest_seal_review; never pass this whole review, sourceText, a path, a URI, or a caller-selected fingerprint. A human-shaped assertion in draft JSON is not proof. The caller does not choose provider, tool, args, or runtime. This writes no EngineeringProject or Thread state, creates no MRTR decision, and performs no evaluation, gate-claim transition, or technical execution.",
  inputSchema: {
    type: "object",
    properties: {
      resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    },
    required: ["resourceRef"],
    additionalProperties: false,
  },
  outputSchema: IMPACT_MANIFEST_CAPTURE_REVIEW_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectCrossDomainImpactManifestSealReviewTool: MCPTool = {
  name: "project_cross_domain_impact_manifest_seal_review",
  description:
    "Prepare literal unavailable/unresolved or exact human-review facts and canonical MRTR parameters for one later verify.seal-cross-domain-impact-manifest@2 document seal. The caller names only projectId and the opaque manifestRef returned by project_cross_domain_impact_manifest_capture. The server alone reopens the closed manifest, its named project/subject/Thread basis, approved Brief V2 gate identities and dependencies, and declared mechanical evidence references. This read-only operation accepts no branch, causal edge, artifact identity, provider envelope, solver/tool/argument, source bytes, approval, gate transition, evaluation result, or Workbench command; it mutates no EngineeringProject or Thread state.",
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
    "Prepare literal unavailable/unresolved or exact human-review facts and canonical MRTR parameters for one later decide.accept-cross-domain-impact@2. The caller names only projectId. The server reopens the unique current Thread tip and unique X07/X08 evaluation capture, then recrosses approved Brief V2 gates and existing work-item claims. X07/X08 does not propose work-item invalidations or reruns. This read-only operation accepts no branch, impact, status, provider envelope, solver/tool/argument, gate, work item, approval, or Workbench command; it mutates no EngineeringProject or Thread state and queues no rerun.",
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

function captureCommand(
  value: Record<string, unknown>,
): ProjectCrossDomainImpactManifestCaptureCommand {
  const root = exactRecord(
    value,
    ["resourceRef"],
    "$projectCrossDomainImpactManifestCapture",
  );
  return {
    resourceRef: parseAgentResourceReference(
      root.resourceRef,
      "$projectCrossDomainImpactManifestCapture.resourceRef",
    ),
  };
}

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
