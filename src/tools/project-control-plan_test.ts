import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { DockerObserver } from "../adapters/docker-observer.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/engineering-project-store.ts";
import { FileProjectDiscoveryRevisionStore } from "../adapters/project-discovery-store.ts";
import type { McpProbe } from "../adapters/http-mcp-probe.ts";
import type { FleetManifest, ObservedContainer, RunDetail } from "../domain/types.ts";
import { ProjectDiscoveryHandoffService } from "../domain/project-discovery-handoff-service.ts";
import { ProjectDiscoveryCommandService } from "../domain/project-discovery-command-service.ts";
import { createConsoleServer } from "../../server.ts";

const DISCOVERY_ID = "plan-contract-discovery";
const PROJECT_ID = "plan-contract-project";
const HUMAN = { kind: "human" as const, actorId: "human:operator" };
const AGENT = { kind: "agent" as const, actorId: "agent:planner" };

Deno.test("project_plan_publish exposes an agent-only bounded plan contract", async () => {
  await withApprovedProjectShell(async ({ directory }) => {
    const { app } = await createConsoleServer({
      manifest: manifestFixture(),
      runs: [runFixture()],
      probe: healthyProbe(),
      docker: unavailableDocker(),
      logger: () => {},
      projectId: PROJECT_ID,
      projectPath: `${directory}/unused-tracked-project.json`,
      activeProjectDirectory: `${directory}/projects`,
      projectDiscoveryDirectory: `${directory}/discoveries`,
      threadSnapshotDirectory: `${directory}/thread-snapshots`,
      projectBaselineDirectory: `${directory}/project-baselines`,
    });

    assertEquals(app.getToolNames().includes("project_plan_publish"), true);

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
      const discovered = await client.invoke("server/discover", {});
      assertResult(discovered);

      const listed = await client.invoke("tools/list", {});
      const listedResult = assertResult(listed);
      const tools = listedResult.tools as Array<Record<string, unknown>>;
      const planTool = tools.find((tool) => tool.name === "project_plan_publish");
      assert(planTool, "project_plan_publish must be listed to the agent");
      assertEquals(planTool.annotations, {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      const schema = planTool.inputSchema as Record<string, unknown>;
      assertEquals(schema.additionalProperties, false);
      const properties = schema.properties as Record<string, unknown>;
      assertEquals(Object.keys(properties).sort(), [
        "commandId",
        "expectedRevision",
        "issuedAt",
        "phases",
        "projectId",
        "requiredDecisions",
        "startingPoint",
        "workItems",
      ]);
      assertEquals(
        JSON.stringify(schema).includes("providerArguments"),
        false,
      );
      assertEquals(JSON.stringify(schema).includes("toolName"), false);
      assertEquals(JSON.stringify(schema).includes("mcpUrl"), false);
      assertEquals(JSON.stringify(schema).includes("decision-parameter"), false);
      assertEquals(JSON.stringify(schema).includes("thread-entity"), false);

      const humanOnlyActions = [
        "project_decision_approve",
        "project_decision_reject",
        "project_agent_run_queue",
      ];
      for (const action of humanOnlyActions) {
        assertEquals(
          tools.some((tool) => tool.name === action),
          false,
          `${action} must remain outside the agent MCP surface`,
        );
      }

      const command = planCommand();
      const published = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: command,
      });
      const publishedResult = assertResult(published);
      const project = publishedResult.structuredContent as Record<string, unknown>;
      assertEquals(project.revision, 2);
      assertEquals(
        (project.plan as Record<string, unknown>).startingPoint,
        "idea-or-spec",
      );
      assertEquals((project.plan as Record<string, unknown>).publishedBy, {
        id: "mcp:test@1",
        origin: "agent",
      });
      const workItems = project.workItems as Array<Record<string, unknown>>;
      assertEquals(workItems.length, 1);
      assertEquals(workItems[0].status, "planned");
      assertEquals(workItems[0].title, "Create the engineering baseline");
      assertEquals(
        workItems[0].description,
        "Create the first reviewable engineering baseline from the approved discovery brief.",
      );
      assertEquals(workItems[0].kind, "define");
      assertEquals(workItems[0].operation, {
        id: "baseline.from-approved-discovery",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      });
      const receipts = project.commandReceipts as Array<Record<string, unknown>>;
      assertEquals(receipts.at(-1)?.type, "project.plan-publish");
      assertEquals(receipts.at(-1)?.actor, {
        id: "mcp:test@1",
        origin: "agent",
      });
      assertEquals(receipts.at(-1)?.issuedAt, "2026-08-01T10:59:00.000Z");

      const replay = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: command,
      });
      assertEquals(
        (assertResult(replay).structuredContent as Record<string, unknown>).id,
        project.id,
      );

      const conflict = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: {
          ...command,
          phases: [{
            ...command.phases[0],
            description: "A different plan must not reuse the command id.",
          }],
        },
      });
      assertToolFailure(conflict, "already used for a different request");

      const stale = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: {
          ...command,
          commandId: "mcp-plan-stale-2",
        },
      });
      assertToolFailure(stale, "current revision is 2");

      const unknownOperation = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: {
          ...command,
          commandId: "mcp-plan-unknown-operation-3",
          expectedRevision: 2,
          workItems: [{
            ...command.workItems[0],
            operation: {
              ...command.workItems[0].operation,
              id: "provider.syson.raw-call",
            },
          }],
        },
      });
      assertToolFailure(unknownOperation, "Unknown registered engineering operation");

      const providerEscape = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: {
          ...command,
          commandId: "mcp-plan-provider-escape-4",
          expectedRevision: 2,
          workItems: [{
            ...command.workItems[0],
            operation: {
              ...command.workItems[0].operation,
              providerArguments: { tool: "syson_model_create" },
            },
          }],
        },
      });
      assertToolFailure(providerEscape);

      const displayEscape = await client.invoke("tools/call", {
        name: "project_plan_publish",
        arguments: {
          ...command,
          commandId: "mcp-plan-display-escape-5",
          expectedRevision: 2,
          workItems: [{
            ...command.workItems[0],
            title: "Run unreviewed FEA immediately",
          }],
        },
      });
      assertToolFailure(displayEscape);

      const afterRejectedCalls = await client.invoke("tools/call", {
        name: "project_snapshot",
        arguments: { projectId: PROJECT_ID },
      });
      assertEquals(
        (assertResult(afterRejectedCalls).structuredContent as Record<string, unknown>)
          .revision,
        2,
      );
    } finally {
      await http.shutdown();
    }
  });
});

function planCommand() {
  return {
    commandId: "mcp-plan-publish-1",
    projectId: PROJECT_ID,
    expectedRevision: 1,
    issuedAt: "2026-08-01T18:59:00+08:00",
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Create the first reviewable engineering baseline.",
    }],
    workItems: [{
      id: "create-baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-discovery",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      },
    }],
    requiredDecisions: [],
  };
}

async function withApprovedProjectShell(
  run: (context: { directory: string }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-plan-tool-" });
  try {
    const discoveries = new FileProjectDiscoveryRevisionStore(
      `${directory}/discoveries`,
    );
    const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
    const discovery = await approvedDiscovery(discoveries);
    await new ProjectDiscoveryHandoffService(
      discoveries,
      projects,
      () => "2026-08-01T12:01:00.000Z",
    ).createEngineeringProject(HUMAN, {
      commandId: "create-project-shell",
      discoveryId: DISCOVERY_ID,
      expectedDiscoveryRevision: discovery.revision,
      issuedAt: "2026-08-01T10:59:30.000Z",
      projectId: PROJECT_ID,
      projectName: "Create a reviewable plan-contract demonstrator.",
    });
    await run({ directory });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function approvedDiscovery(store: FileProjectDiscoveryRevisionStore) {
  let tick = 0;
  const service = new ProjectDiscoveryCommandService(
    store,
    () =>
      new Date(Date.parse("2026-08-01T12:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  let discovery = await service.start(HUMAN, {
    commandId: "start-plan-contract-discovery",
    discoveryId: DISCOVERY_ID,
    issuedAt: "2026-08-01T10:59:00.000Z",
    intent: "Create a reviewable plan-contract demonstrator.",
  });
  discovery = await service.proposeBrief(AGENT, {
    commandId: "propose-plan-contract-brief",
    discoveryId: DISCOVERY_ID,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-01T10:59:10.000Z",
    brief: {
      id: "plan-contract-brief-v1",
      objective: "Create a reviewable plan-contract demonstrator.",
      missionScenarios: ["Review a bounded first engineering operation"],
      successCriteria: ["Keep operation execution under explicit human control"],
      constraints: ["No technical evidence exists during planning"],
      intendedMarkets: ["To be confirmed"],
      manufacturingJurisdictions: ["To be confirmed"],
      operatingJurisdictions: ["To be confirmed"],
      complianceTargets: ["Identify applicable evidence requirements"],
      verificationPlan: ["Review the first baseline before execution"],
      exclusions: ["No provider invocation from a plan"],
      assumptions: ["Discovery is the sole initial planning basis"],
      openQuestions: ["What exact baseline evidence is required?"],
    },
  });
  return await service.approveBrief(HUMAN, {
    commandId: "approve-plan-contract-brief",
    discoveryId: DISCOVERY_ID,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-01T10:59:20.000Z",
    briefId: discovery.brief!.id,
    rationale: "Approved as the constrained planning basis.",
    inputFingerprint: discovery.review!.inputFingerprint,
  });
}

interface McpResponse {
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

class TestMcpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  async invoke(
    method: string,
    params: Record<string, unknown>,
  ): Promise<McpResponse> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(method === "tools/call" && typeof params.name === "string"
          ? { "mcp-name": params.name }
          : {}),
      },
      body: JSON.stringify({
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
      }),
    });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    if (body.error) return { error: JSON.stringify(body.error) };
    return { result: body.result as Record<string, unknown> };
  }
}

function assertResult(response: McpResponse): Record<string, unknown> {
  assert(response.result, response.error ?? "Expected an MCP tool result.");
  assertEquals(response.result.resultType, "complete");
  assertEquals(
    response.result.isError,
    undefined,
    `Expected successful MCP tool result: ${JSON.stringify(response.result)}`,
  );
  return response.result;
}

function assertToolFailure(response: McpResponse, expectedText?: string): void {
  const text = response.error ?? JSON.stringify(response.result);
  assert(
    response.error !== undefined || response.result?.isError === true,
    `Expected rejected MCP tool call, received: ${text}`,
  );
  if (expectedText) assertStringIncludes(text, expectedText);
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
