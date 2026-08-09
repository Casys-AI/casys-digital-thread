import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectReviewIntentStore } from "../adapters/stores/file-project-review-intent-store.ts";
import { deterministicJson } from "../domain/kernel/deterministic-json.ts";
import {
  isApprovalBoundProjectReviewIntent,
  validateProjectReviewIntentProjectId,
} from "../domain/project/project-review-intent.ts";

export const PROJECT_REVIEW_INTENTS_RESOURCE_URI = "casys://engineering/review-intents";

const PROJECT_REVIEW_INTENTS_RESOURCE_SCHEMA =
  "project-review-intents-resource/1.0" as const;

export type ProjectReviewIntentResourceStore = Pick<
  ProjectReviewIntentStore,
  "list" | "listAll"
>;

const signalTool: MCPTool = {
  name: "project_review_intent_signal",
  description:
    "Publish a harmless MCP resource-update signal only after the exact projectId/intentId pair is present in the durable Workbench outbox. This writes no acknowledgement, EngineeringProjectSnapshot, approval, rejection, or decision state. The durable resource remains the recovery source after disconnects.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1, maxLength: 256 },
      intentId: { type: "string", minLength: 1, maxLength: 256 },
    },
    required: ["projectId", "intentId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      intentId: { type: "string" },
      resourceUri: { const: PROJECT_REVIEW_INTENTS_RESOURCE_URI },
      signalled: { const: true },
    },
    required: ["projectId", "intentId", "resourceUri", "signalled"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/**
 * Add the durable review-intent resource and its app-only wake signal.
 * The SSE notification is deliberately lossy; resources/read always rereads the
 * append-only journal and is therefore the recovery path after a reconnect.
 */
export function registerProjectReviewIntentSubscription(
  app: McpApp,
  store: ProjectReviewIntentResourceStore,
): void {
  app.registerResource({
    uri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
    name: "Casys engineering review intents",
    description:
      "Durable exact Workbench review-intent outbox. Records are requests for the paired agent to run the existing signed decision flow; they are never project truth or decision authority.",
    mimeType: "application/json",
  }, async (uri) => ({
    uri: uri.toString(),
    mimeType: "application/json",
    text: deterministicJson({
      schemaVersion: PROJECT_REVIEW_INTENTS_RESOURCE_SCHEMA,
      records: await store.listAll(),
    }),
  }));

  app.registerAppOnlyTool(signalTool, async (args) => {
    const projectId = validateProjectReviewIntentProjectId(args.projectId);
    const intentId = identity(args.intentId, "intentId");
    const record = (await store.list(projectId)).find((candidate) =>
      candidate.intent.intentId === intentId
    );
    if (!record) {
      throw new TypeError(
        `Workbench review intent not found: ${projectId}/${intentId}.`,
      );
    }
    if (!isApprovalBoundProjectReviewIntent(record.intent)) {
      throw new TypeError(
        `Legacy Workbench review intent cannot be signalled: ${projectId}/${intentId}. Submit a new intent from the current approval attempt.`,
      );
    }

    app.sendNotification("notifications/resources/updated", {
      uri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
    });
    return {
      content:
        `Signalled ${PROJECT_REVIEW_INTENTS_RESOURCE_URI} for exact Workbench review intent ${projectId}/${intentId}. No durable record or project decision state changed.`,
      structuredContent: {
        projectId,
        intentId,
        resourceUri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
        signalled: true,
      },
    };
  });
}

function identity(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > 256
  ) {
    throw new TypeError(
      `${path} must be a non-empty identity without edge whitespace (maximum 256 characters).`,
    );
  }
  return value;
}
