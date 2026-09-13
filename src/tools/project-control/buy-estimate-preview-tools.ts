/** Buy documentary-estimate preview writes draft evidence only. No ERP dispatch. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import {
  type BoundedBuyCostEstimatePreview,
  type BoundedBuyCostEstimatePreviewOutcome,
  BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS,
  BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_SAMPLES,
  type ReadBuyCostEstimatePreviewEvidence,
} from "../../application/use-cases/buy/bounded-buy-cost-estimate-preview.ts";
import {
  BUY_BUNDLE_GAP_CODES,
  BUY_COST_CLASSES,
  BUY_COST_DIMENSIONS,
} from "../../domain/buy/buy-cost-bundle.ts";
import { BUY_DECIMAL_SCHEMA } from "../../domain/buy/buy-decimal.ts";
import { BUY_CLOSED_DOCTYPES } from "../../domain/buy/buy-source-capture.ts";
import { BUY_ESTIMATE_GAP_CODES } from "../../domain/buy/buy-production-estimate.ts";
import { BUY_ESTIMATE_TERM_NATURES } from "../../domain/buy/buy-documentary-estimate.ts";
import {
  AGENT_RESOURCE_REFERENCE_SCHEMA,
  FINGERPRINT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
  THREAD_SNAPSHOT_REF_SCHEMA,
} from "./mcp-tool-schemas.ts";

export const BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME =
  "project_buy_cost_estimate_preview" as const;
export const BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME =
  "project_buy_cost_estimate_preview_detail" as const;

export interface ProjectBuyEstimatePreviewToolDependencies {
  readonly costEstimatePreview?: Pick<BoundedBuyCostEstimatePreview, "execute">;
  readonly costEstimatePreviewDetail?: Pick<
    ReadBuyCostEstimatePreviewEvidence,
    "execute"
  >;
}

/** Register the read-only Buy documentary-estimate preview surface. */
export function registerProjectBuyEstimatePreviewTools(
  app: McpApp,
  dependencies: ProjectBuyEstimatePreviewToolDependencies,
): void {
  const preview = dependencies.costEstimatePreview;
  if (preview) {
    app.registerTool(projectBuyCostEstimatePreviewTool, async (args) => {
      const result = await preview.execute(args);
      return {
        content: previewContent(result),
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
  const detail = dependencies.costEstimatePreviewDetail;
  if (!detail) return;
  app.registerTool(projectBuyCostEstimatePreviewDetailTool, async (args) => {
    const result = await detail.execute(args);
    return {
      content: result.section === "full-evidence"
        ? "Explicit full Buy estimate preview evidence for human review. This read-only result executes no seal, approves no spend, and grants no qualification."
        : `Buy estimate preview evidence section ${result.section}; inspect nextCursor when present. This read-only result executes no seal, approves no spend, and grants no qualification.`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

function previewContent(result: BoundedBuyCostEstimatePreviewOutcome): string {
  if (result.status !== "preview") {
    return `The Buy cost estimate preview is ${result.status}: ${result.reason}. No ERP call, MRTR, seal, or dispatch authority was created.`;
  }
  return `Documentary Buy cost estimate preview for ${result.configurationDigest}: coverage ${result.coverage.status}, subtotal ${
    result.totals[0]?.amount
  } ${
    result.totals[0]?.currency
  }. Read pricing, lines, annex terms, source evidence, or assumptions through ${BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME} with the returned evidenceRef. This read-only result executes no registered seal, approves no spend, qualifies nothing, and advertises no operation.`;
}

const SHA256_HEX = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const PREFIXED_SHA256 = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } as const;

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

const BUY_PREVIEW_EVIDENCE_REF_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "buy-cost-estimate-preview-evidence-reference/1.0" },
    projectId: PROJECT_ID,
    fingerprint: FINGERPRINT_SCHEMA,
    byteCount: { type: "integer", minimum: 1 },
  },
  required: ["schemaVersion", "projectId", "fingerprint", "byteCount"],
  additionalProperties: false,
} as const;

const V2_GAP_CODES = [...new Set([...BUY_BUNDLE_GAP_CODES, ...BUY_ESTIMATE_GAP_CODES])];

const V2_GAP_SCHEMA = {
  type: "object",
  properties: {
    code: { type: "string", enum: V2_GAP_CODES },
    message: { type: "string", minLength: 1 },
    lineId: { type: "string", minLength: 1 },
  },
  required: ["code", "message"],
  additionalProperties: false,
} as const;

const V2_DIMENSIONS_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    [...BUY_COST_DIMENSIONS].map((dimension) => [
      dimension,
      { type: "string", enum: ["established", "unknown"] },
    ]),
  ),
  required: [...BUY_COST_DIMENSIONS],
  additionalProperties: false,
} as const;

const V2_COVERAGE_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["complete", "partial", "unresolved"] },
    coveredLineIds: { type: "array", items: { type: "string" } },
    excludedLineIds: { type: "array", items: { type: "string" } },
    quantityBasis: { const: "configuration-occurrences" },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    requiredDimensions: { type: "array", items: { type: "string" } },
    unknownDimensions: { type: "array", items: { type: "string" } },
  },
  required: [
    "status",
    "coveredLineIds",
    "excludedLineIds",
    "quantityBasis",
    "currency",
    "requiredDimensions",
    "unknownDimensions",
  ],
  additionalProperties: false,
} as const;

const V2_TOTAL_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["covered-subtotal", "total-complete"] },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    amount: { type: "string", minLength: 1 },
    includedLineIds: { type: "array", items: { type: "string" } },
    excludedLineIds: { type: "array", items: { type: "string" } },
    includedDimensions: { type: "array", items: { type: "string" } },
    unknownDimensions: { type: "array", items: { type: "string" } },
  },
  required: [
    "kind",
    "currency",
    "amount",
    "includedLineIds",
    "excludedLineIds",
    "includedDimensions",
    "unknownDimensions",
  ],
  additionalProperties: false,
} as const;

const V2_CITATION_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "erp-attested" },
        sourceInstance: {
          type: "object",
          properties: {
            kind: { const: "erpnext-site" },
            siteId: PREFIXED_SHA256,
          },
          required: ["kind", "siteId"],
          additionalProperties: false,
        },
        captureFingerprint: PREFIXED_SHA256,
        document: {
          type: "object",
          properties: {
            doctype: { type: "string", enum: [...BUY_CLOSED_DOCTYPES] },
            name: { type: "string", minLength: 1 },
          },
          required: ["doctype", "name"],
          additionalProperties: false,
        },
        modified: { type: "string", minLength: 1 },
        rowName: { type: "string", minLength: 1 },
        documentFingerprint: PREFIXED_SHA256,
      },
      required: [
        "kind",
        "sourceInstance",
        "captureFingerprint",
        "document",
        "modified",
        "documentFingerprint",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "external-documentary" },
        resourceUri: { type: "string", minLength: 1 },
        fingerprint: PREFIXED_SHA256,
        capturedAt: { type: "string", minLength: 1 },
      },
      required: ["kind", "resourceUri", "fingerprint", "capturedAt"],
      additionalProperties: false,
    },
  ],
} as const;

const V2_LINE_SCHEMA = {
  type: "object",
  properties: {
    configurationLineId: { type: "string", minLength: 1 },
    costClass: { type: "string", enum: [...BUY_COST_CLASSES] },
    citation: V2_CITATION_SCHEMA,
    quantity: { type: "string", minLength: 1 },
    uom: { type: "string", minLength: 1 },
    unitPrice: { type: "string", minLength: 1 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    amount: { type: "string", minLength: 1 },
    capturedAt: { type: "string", minLength: 1 },
    sourceValidity: {
      type: "object",
      properties: {
        from: { type: "string", minLength: 1 },
        to: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    asOf: { type: "string", minLength: 1 },
    provisional: { type: "boolean" },
    annexRef: {
      type: "object",
      properties: {
        annexFingerprint: PREFIXED_SHA256,
        inputFingerprint: PREFIXED_SHA256,
      },
      required: ["annexFingerprint", "inputFingerprint"],
      additionalProperties: false,
    },
    dimensions: V2_DIMENSIONS_SCHEMA,
    gaps: { type: "array", items: V2_GAP_SCHEMA },
  },
  required: [
    "configurationLineId",
    "costClass",
    "quantity",
    "uom",
    "asOf",
    "provisional",
    "dimensions",
    "gaps",
  ],
  additionalProperties: false,
} as const;

const ESTIMATE_SOURCE_REF_SCHEMA = {
  type: "object",
  properties: {
    reference: AGENT_RESOURCE_REFERENCE_SCHEMA,
    anchor: { type: "string", minLength: 1, maxLength: 2000 },
    observedAt: { type: "string", minLength: 1 },
  },
  required: ["reference", "anchor", "observedAt"],
  additionalProperties: false,
} as const;

const ESTIMATE_OPERAND_SCHEMAS = {
  quantity: {
    oneOf: [
      {
        type: "object",
        properties: {
          operand: { const: "sourced" },
          decimal: { type: "string", minLength: 1 },
          uom: { type: "string", minLength: 1 },
          source: ESTIMATE_SOURCE_REF_SCHEMA,
        },
        required: ["operand", "decimal", "uom", "source"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operand: { const: "assumed" },
          decimal: { type: "string", minLength: 1 },
          uom: { type: "string", minLength: 1 },
          justification: {
            type: "object",
            properties: {
              statement: { type: "string", minLength: 1, maxLength: 2000 },
              source: ESTIMATE_SOURCE_REF_SCHEMA,
            },
            required: ["statement", "source"],
            additionalProperties: false,
          },
        },
        required: ["operand", "decimal", "uom", "justification"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { operand: { const: "unknown" } },
        required: ["operand"],
        additionalProperties: false,
      },
    ],
  },
  rate: {
    oneOf: [
      {
        type: "object",
        properties: {
          operand: { const: "sourced" },
          decimal: { type: "string", minLength: 1 },
          perUom: { type: "string", minLength: 1 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          source: ESTIMATE_SOURCE_REF_SCHEMA,
        },
        required: ["operand", "decimal", "perUom", "currency", "source"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operand: { const: "assumed" },
          decimal: { type: "string", minLength: 1 },
          perUom: { type: "string", minLength: 1 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          justification: {
            type: "object",
            properties: {
              statement: { type: "string", minLength: 1, maxLength: 2000 },
              source: ESTIMATE_SOURCE_REF_SCHEMA,
            },
            required: ["statement", "source"],
            additionalProperties: false,
          },
        },
        required: ["operand", "decimal", "perUom", "currency", "justification"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { operand: { const: "unknown" } },
        required: ["operand"],
        additionalProperties: false,
      },
    ],
  },
} as const;

const BUY_ESTIMATE_GAP_SCHEMA = {
  type: "object",
  properties: {
    code: { type: "string", enum: [...BUY_ESTIMATE_GAP_CODES] },
    message: { type: "string", minLength: 1 },
    lineId: { type: "string", minLength: 1 },
  },
  required: ["code", "message"],
  additionalProperties: false,
} as const;

const ANNEX_TERM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    nature: { type: "string", enum: [...BUY_ESTIMATE_TERM_NATURES] },
    consumption: ESTIMATE_OPERAND_SCHEMAS.quantity,
    rate: ESTIMATE_OPERAND_SCHEMAS.rate,
    termAmount: { type: "string", minLength: 1 },
    provisional: { type: "boolean" },
    gaps: {
      type: "array",
      items: BUY_ESTIMATE_GAP_SCHEMA,
    },
  },
  required: ["id", "nature", "consumption", "rate", "provisional", "gaps"],
  additionalProperties: false,
} as const;

const projectBuyCostEstimatePreviewTool: MCPTool = {
  name: BUY_COST_ESTIMATE_PREVIEW_TOOL_NAME,
  description:
    "Preview documentary Buy cost estimates against one exact capture@1 candidate using only server-reopened bytes. Name projectId, exact Thread basis, candidate artifact and fingerprint, and 1..8 captured estimate input refs. The result is a bounded canonical summary plus an opaque immutable evidenceRef. Read pricing, lines, annex term facts, source evidence, assumptions, or explicit full-evidence through project_buy_cost_estimate_preview_detail. This read-only documentary preview executes no registered seal, approves no spend, qualifies nothing, advertises no operation, and performs no ERP refresh or dispatch.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      basis: BUY_BASIS_SCHEMA,
      candidateArtifactId: { type: "string", minLength: 1 },
      candidateFingerprint: FINGERPRINT_SCHEMA,
      estimateRefs: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
        items: AGENT_RESOURCE_REFERENCE_SCHEMA,
      },
    },
    required: [
      "projectId",
      "basis",
      "candidateArtifactId",
      "candidateFingerprint",
      "estimateRefs",
    ],
    additionalProperties: false,
  },
  outputSchema: {
    oneOf: [
      {
        type: "object",
        properties: {
          schemaVersion: { const: "buy-cost-estimate-preview-summary/1.0" },
          nature: { const: "documentary" },
          provisional: { type: "boolean" },
          status: { const: "preview" },
          basis: THREAD_SNAPSHOT_REF_SCHEMA,
          evidenceRef: BUY_PREVIEW_EVIDENCE_REF_SCHEMA,
          evidenceBytes: { type: "integer", minimum: 1 },
          configurationDigest: SHA256_HEX,
          candidateDigest: SHA256_HEX,
          baseBundleDigest: SHA256_HEX,
          pricing: {
            type: "object",
            properties: {
              currency: { type: "string", pattern: "^[A-Z]{3}$" },
              asOf: { type: "string", minLength: 1 },
            },
            required: ["currency", "asOf"],
            additionalProperties: false,
          },
          coverage: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["complete", "partial", "unresolved"] },
              coveredCount: { type: "integer", minimum: 0 },
              excludedCount: { type: "integer", minimum: 0 },
              unknownDimensions: { type: "array", items: { type: "string" } },
            },
            required: ["status", "coveredCount", "excludedCount", "unknownDimensions"],
            additionalProperties: false,
          },
          totals: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["covered-subtotal", "total-complete"] },
                currency: { type: "string", pattern: "^[A-Z]{3}$" },
                amount: { type: "string", minLength: 1 },
              },
              required: ["kind", "currency", "amount"],
              additionalProperties: false,
            },
          },
          counts: {
            type: "object",
            properties: {
              estimates: { type: "integer", minimum: 0 },
              evidence: { type: "integer", minimum: 0 },
              lines: { type: "integer", minimum: 0 },
              terms: { type: "integer", minimum: 0 },
              gaps: { type: "integer", minimum: 0 },
              provisionalLines: { type: "integer", minimum: 0 },
              gapsByCode: {
                type: "object",
                additionalProperties: { type: "integer", minimum: 1 },
              },
            },
            required: [
              "estimates",
              "evidence",
              "lines",
              "terms",
              "gaps",
              "provisionalLines",
              "gapsByCode",
            ],
            additionalProperties: false,
          },
          samples: {
            type: "object",
            properties: {
              gaps: {
                type: "array",
                maxItems: BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_SAMPLES,
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    message: { type: "string", maxLength: 200 },
                    lineId: { type: "string", minLength: 1 },
                    termId: { type: "string", minLength: 1 },
                  },
                  required: ["code", "message"],
                  additionalProperties: false,
                },
              },
              omittedGaps: { type: "integer", minimum: 0 },
            },
            required: ["gaps", "omittedGaps"],
            additionalProperties: false,
          },
        },
        required: [
          "schemaVersion",
          "nature",
          "provisional",
          "status",
          "basis",
          "evidenceRef",
          "evidenceBytes",
          "configurationDigest",
          "candidateDigest",
          "baseBundleDigest",
          "pricing",
          "coverage",
          "totals",
          "counts",
          "samples",
        ],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: { type: "string", enum: ["unresolved", "unavailable"] },
          reason: { type: "string", minLength: 1 },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  annotations: { ...READ_ONLY_ANNOTATIONS, readOnlyHint: false },
};

const PREVIEW_CURSOR_SCHEMA = {
  type: ["string", "null"],
  minLength: 64,
  maxLength: 64,
  pattern: "^[a-f0-9]{64}$",
} as const;

function detailPageSchema(
  section: typeof BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS[number],
  items: Record<string, unknown>,
  maxItems = 20,
) {
  return {
    type: "object",
    properties: {
      section: { const: section },
      items: { type: "array", maxItems, items },
      nextCursor: PREVIEW_CURSOR_SCHEMA,
    },
    required: ["section", "items", "nextCursor"],
    additionalProperties: false,
  } as const;
}

function buyCostEstimatePreviewDetailOutputSchema() {
  return {
    oneOf: [
      detailPageSchema("pricing", {
        type: "object",
        properties: {
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          asOf: { type: "string", minLength: 1 },
          rounding: {
            type: "object",
            properties: {
              schemaVersion: { const: BUY_DECIMAL_SCHEMA },
              scale: { type: "integer", minimum: 0, maximum: 12 },
              mode: { const: "half-up" },
            },
            required: ["schemaVersion", "scale", "mode"],
            additionalProperties: false,
          },
          requiredDimensions: { type: "array", items: { type: "string" } },
          coverage: V2_COVERAGE_SCHEMA,
          totals: { type: "array", items: V2_TOTAL_SCHEMA },
        },
        required: [
          "currency",
          "asOf",
          "rounding",
          "requiredDimensions",
          "coverage",
          "totals",
        ],
        additionalProperties: false,
      }),
      detailPageSchema("lines", V2_LINE_SCHEMA),
      detailPageSchema("annex-terms", {
        type: "object",
        properties: {
          configurationLineId: { type: "string", minLength: 1 },
          annexFingerprint: PREFIXED_SHA256,
          inputCaptureUri: { type: "string", minLength: 1 },
          lineGaps: { type: "array", items: BUY_ESTIMATE_GAP_SCHEMA },
          term: ANNEX_TERM_SCHEMA,
        },
        required: ["configurationLineId", "inputCaptureUri", "lineGaps", "term"],
        additionalProperties: false,
      }),
      detailPageSchema("source-evidence", {
        type: "object",
        properties: {
          uri: { type: "string", minLength: 1 },
          digest: SHA256_HEX,
          byteCount: { type: "integer", minimum: 1 },
          mimeType: { type: "string", minLength: 1 },
          anchors: { type: "array", items: { type: "string" } },
          observedAts: { type: "array", items: { type: "string" } },
        },
        required: ["uri", "digest", "byteCount", "mimeType", "anchors", "observedAts"],
        additionalProperties: false,
      }),
      detailPageSchema("assumptions", {
        type: "object",
        properties: {
          captureUri: { type: "string", minLength: 1 },
          estimateId: { type: "string", minLength: 1 },
          assumption: { type: "string", minLength: 1 },
        },
        required: ["captureUri", "assumption"],
        additionalProperties: false,
      }),
      detailPageSchema("full-evidence", {
        type: "object",
        properties: {
          status: { const: "preview" },
          projectId: PROJECT_ID,
          basis: BUY_BASIS_SCHEMA,
          candidate: {
            type: "object",
            properties: {
              artifactId: { type: "string", minLength: 1 },
              digest: SHA256_HEX,
            },
            required: ["artifactId", "digest"],
            additionalProperties: false,
          },
          configurationDigest: SHA256_HEX,
          pricing: {
            type: "object",
            properties: {
              currency: { type: "string", pattern: "^[A-Z]{3}$" },
              asOf: { type: "string", minLength: 1 },
            },
            required: ["currency", "asOf"],
            additionalProperties: false,
          },
          estimates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                captureUri: { type: "string", minLength: 1 },
                digest: SHA256_HEX,
                estimateId: { type: "string", minLength: 1 },
                lineIds: { type: "array", items: { type: "string" } },
                provisionalLineIds: { type: "array", items: { type: "string" } },
              },
              required: [
                "captureUri",
                "digest",
                "estimateId",
                "lineIds",
                "provisionalLineIds",
              ],
              additionalProperties: false,
            },
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                uri: { type: "string", minLength: 1 },
                digest: SHA256_HEX,
                byteCount: { type: "integer", minimum: 1 },
                mimeType: { type: "string", minLength: 1 },
                anchors: { type: "array", items: { type: "string" } },
                observedAts: { type: "array", items: { type: "string" } },
              },
              required: [
                "uri",
                "digest",
                "byteCount",
                "mimeType",
                "anchors",
                "observedAts",
              ],
              additionalProperties: false,
            },
          },
          annexes: { type: "array" },
          bundle: { type: "object" },
          nature: { const: "documentary" },
          provisional: { type: "boolean" },
          authority: {
            type: "object",
            properties: {
              registeredSeal: { const: "no registered seal executed" },
              spendingApproval: { const: "none" },
              qualification: { const: "none" },
            },
            required: ["registeredSeal", "spendingApproval", "qualification"],
            additionalProperties: false,
          },
          limits: {
            type: "object",
            properties: {
              maxEstimates: { type: "integer", minimum: 1 },
              maxBytesPerSource: { type: "integer", minimum: 1 },
              acceptedMimeTypes: { type: "array", items: { type: "string" } },
            },
            required: ["maxEstimates", "maxBytesPerSource", "acceptedMimeTypes"],
            additionalProperties: false,
          },
        },
        required: [
          "status",
          "projectId",
          "basis",
          "candidate",
          "configurationDigest",
          "pricing",
          "estimates",
          "evidence",
          "annexes",
          "bundle",
          "nature",
          "provisional",
          "authority",
          "limits",
        ],
        additionalProperties: false,
      }, 1),
    ],
  } as const;
}

const projectBuyCostEstimatePreviewDetailTool: MCPTool = {
  name: BUY_COST_ESTIMATE_PREVIEW_DETAIL_TOOL_NAME,
  description:
    "Read one immutable Buy cost estimate preview evidence section. Name only projectId, the opaque evidenceRef returned by project_buy_cost_estimate_preview, section, and an optional opaque cursor. Pages are bounded except full-evidence, which is deliberately complete only when explicitly requested for human review. This read grants no MRTR, seal, approval, qualification, provider, runtime, dispatch, or mutation authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      evidenceRef: BUY_PREVIEW_EVIDENCE_REF_SCHEMA,
      section: { type: "string", enum: [...BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS] },
      cursor: {
        type: "string",
        minLength: 64,
        maxLength: 64,
        pattern: "^[a-f0-9]{64}$",
      },
    },
    required: ["projectId", "evidenceRef", "section"],
    additionalProperties: false,
  },
  outputSchema: buyCostEstimatePreviewDetailOutputSchema(),
  annotations: READ_ONLY_ANNOTATIONS,
};
