import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { DockerObserver } from "../adapters/docker-observer.ts";
import type { McpProbe } from "../adapters/mcp/http-mcp-probe.ts";
import { FileProjectReviewIntentStore } from "../adapters/stores/file-project-review-intent-store.ts";
import type {
  FleetManifest,
  ObservedContainer,
  RunDetail,
} from "../domain/kernel/types.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { ProjectReviewIntent } from "../domain/project/project-review-intent.ts";
import { createConsoleServer, parseConsoleCli } from "../../server.ts";
import { PROJECT_REVIEW_INTENTS_RESOURCE_URI } from "./project-review-intent-subscription.ts";
import { CONSOLE_RESOURCE_URI } from "./register.ts";

const NEUTRAL_PROJECT_ID = "neutral-system-ns01";

Deno.test("console CLI binds its durable review outbox independently of MCP port syntax", () => {
  assertEquals(
    parseConsoleCli([
      "--hostname=localhost",
      "--port",
      "6202",
      "--review-intent-dir=/var/tmp/casys-review-outbox",
    ]),
    {
      hostname: "localhost",
      port: 6202,
      projectReviewIntentDirectory: "/var/tmp/casys-review-outbox",
    },
  );
  assertThrows(
    () => parseConsoleCli(["--review-intent-dir"]),
    TypeError,
    "requires a value",
  );
});

Deno.test("server composes one historical proof and requirements CAS for @1 and ROP2", async () => {
  const source = await Deno.readTextFile("server.ts");
  assertStringIncludes(
    source,
    "const feaProofCaptures = new FileCaptureStore(\n    FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,\n  );",
  );
  assertStringIncludes(source, "store: feaProofCaptures,");
  assertStringIncludes(source, "proofCaseCaptures: feaProofCaptures,");
  assertStringIncludes(source, "proofCaptures: feaProofCaptures,");
  assertStringIncludes(
    source,
    "const requirementsCaptures = new FileCaptureStore({\n    ...REQUIREMENTS_CAPTURE_DESCRIPTOR,\n    directory: options.requirementsCaptureDirectory ??\n      DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY,\n  });",
  );
  assertStringIncludes(source, 'namespace: "requirements-capture",');
  assertStringIncludes(source, "store: requirementsCaptures,");
  assertStringIncludes(source, "captures: requirementsCaptures,");
  assertEquals(source.match(/requirementsCaptures,/g)?.length, 4);
  assertEquals(
    source.includes("${recordedAnalysisDirectory}/calculix/proof-cases"),
    false,
  );
});

Deno.test("server starts project control without seeding any project", async () => {
  const activeProjectDirectory = await Deno.makeTempDir({
    prefix: "casys-project-tools-empty-",
  });
  try {
    await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory,
    });
    const entries = [];
    for await (const entry of Deno.readDir(activeProjectDirectory)) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(activeProjectDirectory, { recursive: true });
  }
});

Deno.test("control-plane MCP tools are namespaced, read-only, and return structured roots", async () => {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "casys-project-tools-",
  });
  const activeProjectDirectory = `${temporaryDirectory}/projects`;
  const projectPath = `${temporaryDirectory}/neutral-project.json`;
  await Deno.writeTextFile(
    projectPath,
    `${JSON.stringify(neutralProjectFixture())}\n`,
  );
  const { app } = await createConsoleServer({
    manifest: manifestFixture(),
    runs: [runFixture()],
    probe: healthyProbe(),
    docker: unavailableDocker(),
    logger: () => {},
    projectId: NEUTRAL_PROJECT_ID,
    projectPath,
    activeProjectDirectory,
    projectReviewIntentDirectory: `${temporaryDirectory}/review-intents`,
  });
  assertEquals(app.getToolNames().sort(), [
    "cockpit_focus_set",
    "cockpit_focus_snapshot",
    "console_refresh",
    "console_run_detail",
    "console_run_list",
    "console_server_detail",
    "console_snapshot",
    "project_agent_run_cancel",
    "project_agent_run_execute",
    "project_agent_run_plan_get",
    "project_agent_run_queue",
    "project_answer_record",
    "project_brief_confirm",
    "project_brief_propose",
    "project_change_append",
    "project_decision_approve",
    "project_decision_propose",
    "project_decision_reject",
    "project_plan_publish",
    "project_question_propose",
    "project_review_intent_acknowledge",
    "project_review_intent_list",
    "project_review_intent_signal",
    "project_snapshot",
    "project_start",
    "project_work_item_reconcile_successor",
    "project_work_item_supersede_unstarted",
  ]);
  try {
    const built = Deno.statSync("src/ui/dist/console/index.html").isFile;
    if (built) {
      assertEquals(app.hasResource(CONSOLE_RESOURCE_URI), true);
      const content = await app.readResourceContent(CONSOLE_RESOURCE_URI);
      assert(content);
      assertEquals(content.uri, CONSOLE_RESOURCE_URI);
      assert(content.text.includes("<html"));
      assertEquals(
        (content as unknown as Record<string, unknown>)._meta,
        undefined,
      );
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await app.startHttp({
    port,
    hostname: "127.0.0.1",
    onListen: () => {},
  });
  try {
    const client = new TestMcpClient(`http://127.0.0.1:${port}/mcp`);
    const projectId = NEUTRAL_PROJECT_ID;
    const discovered = await client.discover();
    assertEquals(discovered.resultType, "complete");
    assertEquals(discovered.serverInfo, {
      name: "casys-digital-thread-console",
      version: "0.2.0",
    });
    const listed = await client.call("tools/list", {});
    const tools = listed.tools as Array<Record<string, unknown>>;
    assertEquals(tools.map((tool) => tool.name).sort(), [
      "cockpit_focus_set",
      "cockpit_focus_snapshot",
      "console_run_detail",
      "console_run_list",
      "console_server_detail",
      "console_snapshot",
      "project_agent_run_cancel",
      "project_agent_run_execute",
      "project_agent_run_plan_get",
      "project_agent_run_queue",
      "project_answer_record",
      "project_brief_confirm",
      "project_brief_propose",
      "project_change_append",
      "project_decision_approve",
      "project_decision_propose",
      "project_decision_reject",
      "project_plan_publish",
      "project_question_propose",
      "project_review_intent_acknowledge",
      "project_review_intent_list",
      "project_snapshot",
      "project_start",
      "project_work_item_reconcile_successor",
      "project_work_item_supersede_unstarted",
    ]);
    const snapshotTool = tools.find((tool) => tool.name === "console_snapshot");
    assert(snapshotTool);
    assertEquals(
      ((snapshotTool._meta as Record<string, unknown>).ui as Record<
        string,
        unknown
      >).resourceUri,
      CONSOLE_RESOURCE_URI,
    );
    assertEquals(snapshotTool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    const executeTool = tools.find((tool) => tool.name === "project_agent_run_execute");
    assert(executeTool);
    assertEquals(
      executeTool.annotations,
      {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    );
    const executeSchema = executeTool.inputSchema as Record<string, unknown>;
    const executeProperties = executeSchema.properties as Record<string, unknown>;
    assertEquals(
      Object.keys(executeProperties).sort(),
      [
        "commandId",
        "expectedRevision",
        "issuedAt",
        "projectId",
        "runId",
      ],
    );
    assertEquals(executeSchema.required, [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      "runId",
    ]);
    assertEquals(executeSchema.additionalProperties, false);
    for (
      const forbiddenProperty of [
        "provider",
        "providerArguments",
        "providerTool",
        "toolName",
        "toolArguments",
        "mcpUrl",
        "resultSnapshot",
        "evidenceRefs",
      ]
    ) {
      assertEquals(forbiddenProperty in executeProperties, false);
    }
    for (
      const retiredToolName of [
        "project_agent_run_start",
        "project_agent_run_progress",
        "project_agent_run_publish",
        "project_agent_run_fail",
      ]
    ) {
      assertEquals(
        tools.some((tool) => tool.name === retiredToolName),
        false,
      );
    }

    const result = await client.call("tools/call", {
      name: "console_snapshot",
      arguments: {},
    });
    const structured = result.structuredContent as Record<string, unknown>;
    assertEquals(structured.schemaVersion, "2.0");
    assertEquals(structured.mode, "mixed");
    assert("fleet" in structured);
    assert("runs" in structured);
    assertEquals("workbench" in structured, false);

    const projectSnapshot = await client.call("tools/call", {
      name: "project_snapshot",
      arguments: { projectId },
    });
    const project = projectSnapshot.structuredContent as Record<string, unknown>;
    assertEquals(project.schemaVersion, "1.0");
    assertEquals(
      (project.project as Record<string, unknown>).id,
      projectId,
    );
    assertEquals(project.revision, 1);
    assertStringIncludes(
      (projectSnapshot.content as Array<Record<string, unknown>>)[0].text as string,
      "0 actionable intents",
    );
    const reviewIntents = await client.call("tools/call", {
      name: "project_review_intent_list",
      arguments: { projectId },
    });
    assertEquals(reviewIntents.structuredContent, {
      projectId,
      projectRevision: 1,
      count: 0,
      records: [],
    });

    const proposalArguments = {
      commandId: "mcp-proposal-material-1",
      projectId,
      expectedRevision: 1,
      issuedAt: "2026-08-01T22:10:00+08:00",
      decisionId: "review-neutral-material-card",
      proposal: {
        summary: "Use the reviewed aluminium material card.",
        parameters: [{
          key: "youngs-modulus",
          label: "Young's modulus",
          value: 69,
          unit: "GPa",
        }],
      },
    };
    const proposal = await client.call("tools/call", {
      name: "project_decision_propose",
      arguments: proposalArguments,
    });
    const proposedProject = proposal.structuredContent as Record<string, unknown>;
    assertEquals(proposedProject.revision, 2);
    assertEquals(
      (proposedProject.commandReceipts as Array<Record<string, unknown>>)[0]
        .issuedAt,
      "2026-08-01T14:10:00.000Z",
    );
    const proposedDecision = (proposedProject.decisions as Array<
      Record<string, unknown>
    >).find((item) => item.id === "review-neutral-material-card")!;
    assertEquals(proposedDecision.status, "proposed");
    assertEquals(
      (proposedDecision.proposal as Record<string, unknown>).proposedBy as Record<
        string,
        unknown
      >,
      { id: "mcp:test@1", origin: "agent" },
    );

    const replay = await client.call("tools/call", {
      name: "project_decision_propose",
      arguments: proposalArguments,
    });
    assertEquals(
      (replay.structuredContent as Record<string, unknown>).revision,
      2,
    );

    const stale = await client.call("tools/call", {
      name: "project_decision_propose",
      arguments: {
        ...proposalArguments,
        commandId: "mcp-stale-proposal-2",
        decisionId: "review-neutral-material-card",
      },
    });
    assertEquals(stale.isError, true);
    assertStringIncludes(
      (stale.content as Array<Record<string, unknown>>)[0].text as string,
      "current revision is 2",
    );

    const projectTools = tools.filter((tool) =>
      String(tool.name).startsWith("project_")
    );
    assertEquals(
      projectTools.some((tool) =>
        [
          "project_decision_approve",
          "project_decision_reject",
          "project_agent_run_cancel",
          "project_work_item_supersede_unstarted",
          "project_agent_run_queue",
        ]
          .includes(String(tool.name))
      ),
      true,
    );
    for (const tool of projectTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.destructiveHint, false);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(
        annotations.readOnlyHint,
        tool.name === "project_snapshot" ||
          tool.name === "project_agent_run_plan_get" ||
          tool.name === "project_review_intent_list",
      );
      assertEquals(
        annotations.idempotentHint,
        tool.name === "project_snapshot" ||
          tool.name === "project_review_intent_list" ||
          tool.name === "project_review_intent_acknowledge" ||
          tool.name === "project_start" ||
          tool.name === "project_question_propose" ||
          tool.name === "project_answer_record" ||
          tool.name === "project_brief_propose" ||
          tool.name === "project_brief_confirm" ||
          tool.name === "project_agent_run_cancel" ||
          tool.name === "project_agent_run_execute" ||
          tool.name === "project_agent_run_plan_get" ||
          tool.name === "project_agent_run_queue" ||
          tool.name === "project_work_item_supersede_unstarted" ||
          tool.name === "project_decision_approve" ||
          tool.name === "project_decision_reject",
      );
    }
    const framingTools = tools.filter((tool) =>
      [
        "project_start",
        "project_question_propose",
        "project_answer_record",
        "project_brief_propose",
        "project_brief_confirm",
      ].includes(String(tool.name))
    );
    assertEquals(framingTools.length, 5);
    for (const tool of framingTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.destructiveHint, false);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(annotations.idempotentHint, true);
      assertEquals(annotations.readOnlyHint, false);
    }
    const focusTools = tools.filter((tool) =>
      String(tool.name).startsWith("cockpit_focus_")
    );
    assertEquals(focusTools.length, 2);
    for (const tool of focusTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.destructiveHint, false);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(annotations.idempotentHint, true);
      assertEquals(
        annotations.readOnlyHint,
        tool.name === "cockpit_focus_snapshot",
      );
    }

    const reviewIntent: ProjectReviewIntent = {
      intentId: "review-intent-mcp-sse-1",
      projectId,
      expectedRevision: 2,
      decisionId: "review-neutral-material-card",
      approvalId: "approval:review-neutral-material-card:mcp-sse-1",
      inputFingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
      },
      action: "validate",
      submittedAt: "2026-08-09T12:00:00.000Z",
    };
    const reviewIntentStore = new FileProjectReviewIntentStore(
      `${temporaryDirectory}/review-intents`,
    );
    await reviewIntentStore.append(reviewIntent);

    const beforeSignal = await client.call("tools/call", {
      name: "project_snapshot",
      arguments: { projectId: reviewIntent.projectId },
    });
    const firstSubscription = await client.listen([
      PROJECT_REVIEW_INTENTS_RESOURCE_URI,
    ]);
    assertEquals(await firstSubscription.next(), {
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: {
        _meta: {
          "io.modelcontextprotocol/subscriptionId": firstSubscription.subscriptionId,
        },
        notifications: {
          resourceSubscriptions: [PROJECT_REVIEW_INTENTS_RESOURCE_URI],
        },
      },
    });

    const signal = await client.call("tools/call", {
      name: "project_review_intent_signal",
      arguments: {
        projectId: reviewIntent.projectId,
        intentId: reviewIntent.intentId,
      },
    });
    assertEquals(signal.structuredContent, {
      projectId: reviewIntent.projectId,
      intentId: reviewIntent.intentId,
      resourceUri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
      signalled: true,
    });
    assertEquals(await firstSubscription.next(), {
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: {
        uri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
        _meta: {
          "io.modelcontextprotocol/subscriptionId": firstSubscription.subscriptionId,
        },
      },
    });
    await firstSubscription.cancel();

    const reconnected = await client.listen([
      PROJECT_REVIEW_INTENTS_RESOURCE_URI,
    ]);
    const reconnectAcknowledgement = await reconnected.next();
    assertEquals(
      reconnectAcknowledgement.method,
      "notifications/subscriptions/acknowledged",
    );
    assertEquals(
      ((reconnectAcknowledgement.params as Record<string, unknown>)._meta as Record<
        string,
        unknown
      >)["io.modelcontextprotocol/subscriptionId"],
      reconnected.subscriptionId,
    );
    const recovered = await client.call("resources/read", {
      uri: PROJECT_REVIEW_INTENTS_RESOURCE_URI,
    });
    const resourceContent = (recovered.contents as Array<Record<string, unknown>>)[0];
    assertEquals(resourceContent.uri, PROJECT_REVIEW_INTENTS_RESOURCE_URI);
    assertEquals(resourceContent.mimeType, "application/json");
    assertEquals(JSON.parse(resourceContent.text as string), {
      schemaVersion: "project-review-intents-resource/1.0",
      records: [{ intent: reviewIntent }],
    });
    await reconnected.cancel();

    const afterSignal = await client.call("tools/call", {
      name: "project_snapshot",
      arguments: { projectId: reviewIntent.projectId },
    });
    assertEquals(afterSignal.structuredContent, beforeSignal.structuredContent);
  } finally {
    await http.shutdown();
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

class TestMcpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  async discover(): Promise<Record<string, unknown>> {
    return await this.call("server/discover", {});
  }

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.#request({
      jsonrpc: "2.0",
      id: ++this.#id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    });
    const body = await parseResponse(response);
    if (body.error) throw new Error(JSON.stringify(body.error));
    const result = body.result as Record<string, unknown>;
    assertEquals(result.resultType, "complete");
    return result;
  }

  async listen(resourceSubscriptions: string[]): Promise<TestSseSubscription> {
    const subscriptionId = ++this.#id;
    const response = await this.#request({
      jsonrpc: "2.0",
      id: subscriptionId,
      method: "subscriptions/listen",
      params: {
        notifications: { resourceSubscriptions },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }, "text/event-stream");
    assertEquals(response.status, 200);
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      "text/event-stream",
    );
    assert(response.body);
    return new TestSseSubscription(subscriptionId, response.body);
  }

  async #request(
    body: Record<string, unknown>,
    accept = "application/json",
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": String(body.method),
    };
    const params = body.params as Record<string, unknown>;
    if (body.method === "tools/call" && typeof params.name === "string") {
      headers["mcp-name"] = params.name;
    }
    if (body.method === "resources/read" && typeof params.uri === "string") {
      headers["mcp-name"] = params.uri;
    }
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assertEquals(response.headers.get("mcp-session-id"), null);
    return response;
  }
}

class TestSseSubscription {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = "";

  constructor(
    readonly subscriptionId: number,
    stream: ReadableStream<Uint8Array>,
  ) {
    this.#reader = stream.getReader();
  }

  async next(): Promise<Record<string, unknown>> {
    while (true) {
      const boundary = this.#buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const event = this.#buffer.slice(0, boundary);
        this.#buffer = this.#buffer.slice(boundary + 2);
        const data = event.split("\n").flatMap((line) =>
          line.startsWith("data: ") ? [line.slice("data: ".length)] : []
        );
        if (data.length > 0) return JSON.parse(data.join("\n"));
        continue;
      }

      const chunk = await withTimeout(this.#reader.read(), 5_000);
      if (chunk.done) throw new Error("SSE subscription closed before next event");
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  async cancel(): Promise<void> {
    await this.#reader.cancel();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  return JSON.parse(text);
}

function neutralProjectFixture(): EngineeringProjectSnapshot {
  const generatedAt = "2026-08-01T14:00:00.000Z";
  const phaseId = "review";
  const workItemId = "review-neutral-material";
  const decisionId = "review-neutral-material-card";
  const blockerId = "missing-neutral-material-review";
  return {
    schemaVersion: "1.0",
    id: `${NEUTRAL_PROJECT_ID}:project:r1`,
    revision: 1,
    generatedAt,
    project: {
      id: NEUTRAL_PROJECT_ID,
      name: "Neutral engineering system",
      subjectId: NEUTRAL_PROJECT_ID,
      objective: {
        title: "Maintain a reviewable engineering record",
        statement:
          "Exercise the project control boundary without a product-specific fixture.",
      },
    },
    threadSnapshots: [{
      snapshotId: `${NEUTRAL_PROJECT_ID}:thread:r1`,
      revision: 1,
      subjectId: NEUTRAL_PROJECT_ID,
    }],
    phases: [{
      id: phaseId,
      name: "Review",
      order: 1,
      description: "Review one bounded material proposal.",
      workItemIds: [workItemId],
      requiredDecisionIds: [decisionId],
      evidenceRefs: [],
    }],
    workItems: [{
      id: workItemId,
      phaseId,
      title: "Review the neutral material card",
      description: "Record a human-reviewable material decision.",
      kind: "review",
      status: "waiting-for-decision",
      owner: "shared",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [decisionId],
      blockerIds: [blockerId],
    }],
    agentRuns: [],
    decisions: [{
      id: decisionId,
      phaseId,
      title: "Review the neutral material card",
      question: "May the neutral material card be used for this bounded test?",
      status: "required",
      requestedAt: generatedAt,
      inputEvidenceRefs: [],
      approvalIds: [],
    }],
    approvals: [],
    blockers: [{
      id: blockerId,
      phaseId,
      title: "Material review is required",
      description: "The test proposal still requires explicit human review.",
      kind: "decision-required",
      status: "open",
      openedAt: generatedAt,
      workItemIds: [workItemId],
      decisionIds: [decisionId],
    }],
  };
}

function manifestFixture(): FleetManifest {
  return {
    version: 1,
    servers: [{
      id: "test",
      displayName: "Test",
      role: "test",
      serviceName: "mcp-test",
      transport: "streamable-http",
      mcpUrl: "http://127.0.0.1:3999/mcp",
      healthUrl: "http://127.0.0.1:3999/health",
      image: "example.test/toolchain:1",
      required: true,
      expectedTools: ["test_read"],
    }],
  };
}

function runFixture(): RunDetail {
  return {
    id: "run-1",
    name: "Run",
    subject: "Part",
    status: "succeeded",
    verdictStatus: "passed",
    source: "demo",
    startedAt: "2026-07-30T00:00:00.000Z",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Test fixture",
    stages: [],
    measurements: [],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [],
  };
}

function healthyProbe(): McpProbe {
  return {
    probe: () =>
      Promise.resolve({
        checkedAt: "2026-07-30T00:00:00.000Z",
        status: "healthy",
        httpStatus: 200,
        mcp: {
          reachable: true,
          tools: [{ name: "test_read" }],
          resourceUris: [],
          viewerUris: [],
        },
      }),
  };
}

function unavailableDocker(): DockerObserver {
  return {
    observe: (servers) =>
      Promise.resolve(
        new Map<string, ObservedContainer>(
          servers.map((server) => [
            server.id,
            {
              runtimeAvailable: false,
              present: false,
              error: "Docker unavailable",
            },
          ]),
        ),
      ),
  };
}
