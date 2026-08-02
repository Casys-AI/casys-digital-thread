import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createConsoleServer } from "../../server.ts";
import { FileProjectDiscoveryRevisionStore } from "../adapters/project-discovery-store.ts";
import { ProjectDiscoveryCommandService } from "../domain/project-discovery-command-service.ts";

Deno.test("project discovery MCP tools support an agent-first pre-project flow without review authority", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "project-discovery-tools-",
  });
  const discoveries = new FileProjectDiscoveryRevisionStore(directory);
  let tick = 0;
  const commands = new ProjectDiscoveryCommandService(
    discoveries,
    () =>
      new Date(Date.parse("2026-08-02T11:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  const { app } = await createConsoleServer({
    manifest: { version: 1, servers: [] },
    runs: [],
    projectControl: false,
    projectDiscovery: { discoveries, commands },
    logger: () => {},
  });
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
    const listed = await client.call("tools/list", {});
    const tools = listed.tools as Array<Record<string, unknown>>;
    const discoveryTools = tools.filter((tool) =>
      String(tool.name).startsWith("project_discovery_")
    );
    assertEquals(discoveryTools.map((tool) => tool.name).sort(), [
      "project_discovery_answer_record",
      "project_discovery_brief_propose",
      "project_discovery_question_propose",
      "project_discovery_snapshot",
      "project_discovery_start",
    ]);
    assertEquals(
      discoveryTools.some((tool) =>
        String(tool.name).includes("approve") ||
        String(tool.name).includes("reject")
      ),
      false,
    );
    for (const tool of discoveryTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.idempotentHint, true);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(
        annotations.readOnlyHint,
        tool.name === "project_discovery_snapshot",
      );
    }

    let result = await client.tool("project_discovery_start", {
      commandId: "mcp-discovery-start",
      discoveryId: "drone-concept-1",
      issuedAt: "2026-08-02T10:59:00.000Z",
      intent: "Develop an inspection drone with a reviewable manufacturing cost.",
    });
    let snapshot = result.structuredContent as Record<string, unknown>;
    assertEquals(snapshot.revision, 1);
    assertEquals(snapshot.status, "discovering");
    assertEquals(
      ((snapshot.intent as Record<string, unknown>).capturedBy as Record<
        string,
        unknown
      >).origin,
      "agent",
    );

    result = await client.tool("project_discovery_question_propose", {
      ...common("mcp-question-mission", 1),
      question: question(),
    });
    snapshot = result.structuredContent as Record<string, unknown>;
    assertEquals(snapshot.revision, 2);

    const invalidUnknown = await assertRejects(
      () =>
        client.tool("project_discovery_answer_record", {
          ...common("mcp-invalid-unknown", 2),
          answer: {
            id: "answer-mission-invalid",
            questionId: "mission",
            kind: "unknown",
            value: "must-not-be-present",
            source: { kind: "human", reference: "conversation:turn-1" },
          },
        }),
      Error,
    );
    assertStringIncludes(invalidUnknown.message, "Invalid arguments");

    result = await client.tool("project_discovery_answer_record", {
      ...common("mcp-answer-mission", 2),
      answer: {
        id: "answer-mission-1",
        questionId: "mission",
        kind: "unknown",
        explanation: "The person wants the agent to recommend a bounded mission.",
        source: { kind: "human", reference: "conversation:turn-1" },
      },
    });
    snapshot = result.structuredContent as Record<string, unknown>;
    assertEquals(snapshot.revision, 3);
    assertEquals(
      ((snapshot.answers as Array<Record<string, unknown>>)[0].recordedBy as Record<
        string,
        unknown
      >).origin,
      "agent",
    );

    result = await client.tool("project_discovery_brief_propose", {
      ...common("mcp-brief-proposal", 3),
      brief: brief(),
    });
    snapshot = result.structuredContent as Record<string, unknown>;
    assertEquals(snapshot.revision, 4);
    assertEquals(snapshot.status, "awaiting-review");
    assertEquals(
      (snapshot.review as Record<string, unknown>).status,
      "pending",
    );

    const read = await client.tool("project_discovery_snapshot", {
      discoveryId: "drone-concept-1",
    });
    assertEquals((read.structuredContent as Record<string, unknown>).id, snapshot.id);
  } finally {
    await http.shutdown();
    await Deno.remove(directory, { recursive: true });
  }
});

function common(commandId: string, expectedRevision: number) {
  return {
    commandId,
    discoveryId: "drone-concept-1",
    expectedRevision,
    issuedAt: "2026-08-02T10:59:30.000Z",
  };
}

function question() {
  return {
    id: "mission",
    prompt: "Which mission should the first demonstrator perform?",
    whyItMatters: "Mission determines architecture, risk and verification scope.",
    recommendation: {
      value: "controlled-inspection",
      rationale: "A controlled mission keeps early decisions reversible.",
      confidence: "medium",
    },
    options: [{
      value: "controlled-inspection",
      label: "Controlled inspection",
      consequences: "Limits environment and safety uncertainty.",
    }],
    allowUnknown: true,
    risk: "material",
    evidenceNeeded: ["Operating-context statement"],
  };
}

function brief() {
  return {
    id: "brief-1",
    objective: "Build a bounded inspection demonstrator.",
    missionScenarios: ["Inspect a target in a controlled environment"],
    successCriteria: ["Complete a measured nominal mission"],
    constraints: ["No production claim during discovery"],
    intendedMarkets: ["Target market unresolved"],
    manufacturingJurisdictions: ["Manufacturing jurisdiction unresolved"],
    operatingJurisdictions: ["Operating jurisdiction unresolved"],
    complianceTargets: [
      "Identify applicable rules using accessible authoritative sources",
    ],
    verificationPlan: ["Bind mission criteria to named analyses and tests"],
    exclusions: ["Legal advice and unverified certification claims"],
    assumptions: ["Initial mission remains provisional"],
    openQuestions: ["Where will the product be sold, built and operated?"],
  };
}

class TestMcpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  tool(name: string, args: Record<string, unknown>) {
    return this.call("tools/call", { name, arguments: args });
  }

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
    };
    if (method === "tools/call" && typeof params.name === "string") {
      headers["mcp-name"] = params.name;
    }
    const response = await fetch(this.url, {
      method: "POST",
      headers,
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
    if (body.error) throw new Error(JSON.stringify(body.error));
    const result = body.result as Record<string, unknown>;
    assertEquals(result.resultType, "complete");
    return result;
  }
}
