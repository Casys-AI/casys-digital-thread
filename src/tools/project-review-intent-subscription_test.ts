import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  McpApp,
  MCPResource,
  MCPTool,
  ResourceHandler,
  ToolHandler,
} from "@casys/mcp-server";
import type { ProjectReviewIntentRecord } from "../domain/project/project-review-intent.ts";
import {
  PROJECT_REVIEW_INTENTS_RESOURCE_URI,
  type ProjectReviewIntentResourceStore,
  registerProjectReviewIntentSubscription,
} from "./project-review-intent-subscription.ts";

const RECORD: ProjectReviewIntentRecord = {
  intent: {
    intentId: "review-intent-desk-lamp-1",
    projectId: "desk-lamp-dl01",
    expectedRevision: 7,
    decisionId: "decision-desk-lamp-geometry",
    approvalId: "approval:decision-desk-lamp-geometry:review-1",
    inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    action: "validate",
    submittedAt: "2026-08-09T08:00:00.000Z",
  },
};

const LEGACY_RECORD: ProjectReviewIntentRecord = {
  intent: {
    intentId: "review-intent-desk-lamp-legacy",
    projectId: "desk-lamp-dl01",
    expectedRevision: 6,
    decisionId: "decision-desk-lamp-geometry",
    inputFingerprint: { algorithm: "sha256", digest: "A".repeat(64) },
    action: "validate",
    submittedAt: "2026-08-09T07:00:00.000Z",
  },
};

Deno.test("review-intent MCP resource remains the durable recovery source while its app-only signal is harmless", async () => {
  const app = new CapturingApp();
  const store = new MemoryResourceStore([LEGACY_RECORD, RECORD]);
  registerProjectReviewIntentSubscription(app as unknown as McpApp, store);

  const resource = await app.read(PROJECT_REVIEW_INTENTS_RESOURCE_URI);
  assertEquals(resource.mimeType, "application/json");
  assertEquals(JSON.parse(resource.text), {
    schemaVersion: "project-review-intents-resource/1.0",
    records: [LEGACY_RECORD, RECORD],
  });

  const result = await Promise.resolve(
    app.handler("project_review_intent_signal")({
      projectId: RECORD.intent.projectId,
      intentId: RECORD.intent.intentId,
    }),
  ) as Record<string, unknown>;
  assertEquals(result.structuredContent, {
    projectId: RECORD.intent.projectId,
    intentId: RECORD.intent.intentId,
    resourceUri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
    signalled: true,
  });
  assertEquals(app.notifications, [{
    method: "notifications/resources/updated",
    params: { uri: PROJECT_REVIEW_INTENTS_RESOURCE_URI },
  }]);
  assertEquals(await store.listAll(), [LEGACY_RECORD, RECORD]);
  assertEquals(app.tool("project_review_intent_signal").annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});

Deno.test("review-intent MCP resource preserves legacy audit history but never signals it as actionable work", async () => {
  const app = new CapturingApp();
  registerProjectReviewIntentSubscription(
    app as unknown as McpApp,
    new MemoryResourceStore([LEGACY_RECORD]),
  );

  await assertRejects(
    async () =>
      await Promise.resolve(
        app.handler("project_review_intent_signal")({
          projectId: LEGACY_RECORD.intent.projectId,
          intentId: LEGACY_RECORD.intent.intentId,
        }),
      ),
    TypeError,
    "Legacy Workbench review intent cannot be signalled",
  );
  assertEquals(app.notifications, []);
  assertEquals(
    JSON.parse(
      (await app.read(PROJECT_REVIEW_INTENTS_RESOURCE_URI)).text,
    ).records,
    [LEGACY_RECORD],
  );
});

Deno.test("review-intent MCP signal refuses a missing exact project and intent pair", async () => {
  const app = new CapturingApp();
  registerProjectReviewIntentSubscription(
    app as unknown as McpApp,
    new MemoryResourceStore([RECORD]),
  );

  for (
    const args of [
      {
        projectId: RECORD.intent.projectId,
        intentId: "review-intent-missing",
      },
      {
        projectId: "different-project",
        intentId: RECORD.intent.intentId,
      },
    ]
  ) {
    await assertRejects(
      async () =>
        await Promise.resolve(
          app.handler("project_review_intent_signal")(args),
        ),
      TypeError,
      "Workbench review intent not found",
    );
  }
  assertEquals(app.notifications, []);
});

class MemoryResourceStore implements ProjectReviewIntentResourceStore {
  constructor(private readonly records: ProjectReviewIntentRecord[]) {}

  list(projectId: string): Promise<ProjectReviewIntentRecord[]> {
    return Promise.resolve(
      structuredClone(
        this.records.filter((record) => record.intent.projectId === projectId),
      ),
    );
  }

  listAll(): Promise<ProjectReviewIntentRecord[]> {
    return Promise.resolve(structuredClone(this.records));
  }
}

class CapturingApp {
  readonly notifications: Array<{
    method: string;
    params?: Record<string, unknown>;
  }> = [];
  readonly #resources = new Map<string, ResourceHandler>();
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();

  registerResource(resource: MCPResource, handler: ResourceHandler): void {
    this.#resources.set(resource.uri, handler);
  }

  registerAppOnlyTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  sendNotification(method: string, params?: Record<string, unknown>): void {
    this.notifications.push({ method, params });
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler);
    return handler;
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    assert(tool);
    return tool;
  }

  async read(uri: string) {
    const handler = this.#resources.get(uri);
    assert(handler);
    return await handler(new URL(uri));
  }
}
