/** Read-only Buy capture/seal review. No ERP dispatch. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectBuyConfigurationCostCaptureReviewUseCase,
} from "../../application/ports/in/buy/project-buy-configuration-cost-capture-review.ts";
import type {
  ProjectBuyConfigurationCostSealReviewUseCase,
} from "../../application/ports/in/buy/project-buy-configuration-cost-seal-review.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
  THREAD_SNAPSHOT_REF_SCHEMA,
} from "./mcp-tool-schemas.ts";

export interface ProjectBuyReviewToolDependencies {
  readonly buyConfigurationCostCaptureReview?:
    ProjectBuyConfigurationCostCaptureReviewUseCase;
  readonly buyConfigurationCostSealReview?:
    ProjectBuyConfigurationCostSealReviewUseCase;
}

export function registerProjectBuyReviewTools(
  app: McpApp,
  dependencies: ProjectBuyReviewToolDependencies,
): void {
  const capture = dependencies.buyConfigurationCostCaptureReview;
  if (capture) {
    app.registerTool(projectBuyCaptureReviewTool, async (args) => {
      const result = await capture.execute(args);
      return {
        content: result.status === "ready"
          ? "The exact Buy configuration, canonical STEP, ERP document refs, pricing scope and qualified site binding were recrossed into canonical MRTR parameters. This read-only result does not call ERP, approve spend, or dispatch buy.capture-configuration-cost@1."
          : `The Buy configuration-cost capture review is ${result.status}: ${result.reason}. No ERP call, MRTR, or dispatch authority was created.`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
  const seal = dependencies.buyConfigurationCostSealReview;
  if (!seal) return;
  app.registerTool(projectBuySealReviewTool, async (args) => {
    const result = await seal.execute(args);
    return {
      content: result.status === "ready"
        ? "The exact Buy candidate, configuration, STEP and coverage were recrossed into canonical MRTR parameters. This read-only result does not refresh ERP or seal the bundle."
        : `The Buy configuration-cost seal review is ${result.status}: ${result.reason}. No ERP refresh, MRTR, or dispatch authority was created.`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const BUY_BASIS_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "thread-snapshot" },
    snapshotId: THREAD_SNAPSHOT_REF_SCHEMA.properties.snapshotId,
    revision: THREAD_SNAPSHOT_REF_SCHEMA.properties.revision,
    subjectId: THREAD_SNAPSHOT_REF_SCHEMA.properties.subjectId,
  },
  required: ["kind", "snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const projectBuyCaptureReviewTool: MCPTool = {
  name: "project_buy_configuration_cost_capture_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for buy.capture-configuration-cost@1 from a source-backed configuration, canonical STEP, ERP document refs and pricing scope. This read-only tool does not call ERP, create BOM/RFQ/PO documents, or grant dispatch.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      basis: BUY_BASIS_SCHEMA,
      configurationResourceUri: { type: "string", minLength: 1 },
      configurationResourceDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      geometryArtifactId: { type: "string", minLength: 1 },
      geometryArtifactFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            doctype: { type: "string" },
            name: { type: "string" },
            expectedModified: { type: "string" },
          },
          required: ["doctype", "name"],
          additionalProperties: false,
        },
      },
      pricing: { type: "object", additionalProperties: true },
    },
    required: [
      "projectId",
      "basis",
      "configurationResourceUri",
      "configurationResourceDigest",
      "geometryArtifactId",
      "geometryArtifactFingerprint",
      "documents",
      "pricing",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectBuySealReviewTool: MCPTool = {
  name: "project_buy_configuration_cost_seal_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for buy.seal-configuration-cost@1 by reopening a documentary candidate. This read-only tool does not refresh ERP or seal the bundle.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      basis: BUY_BASIS_SCHEMA,
      candidateArtifactId: { type: "string", minLength: 1 },
      candidateFingerprint: FINGERPRINT_SCHEMA,
    },
    required: [
      "projectId",
      "basis",
      "candidateArtifactId",
      "candidateFingerprint",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
