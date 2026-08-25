import { assertEquals, assertStringIncludes } from "@std/assert";
import { createConsoleServer } from "../../server.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/shared/stores/engineering-project-store.ts";
import { ProjectBriefCommandService } from "../application/use-cases/project/project-brief-command-service.ts";
import { LOCAL_YOLO_PROJECT_APPROVAL_MODE } from "./project-approval-mode.ts";

Deno.test("project MCP framing uses one project identity from intent through approved brief", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-brief-tools-" });
  const projects = new FileEngineeringProjectRevisionStore(directory);
  let tick = 0;
  const commands = new ProjectBriefCommandService(
    projects,
    () =>
      new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  const { app } = await createConsoleServer({
    manifest: { version: 1, servers: [] },
    runs: [],
    projectControl: false,
    projectBrief: { projects, commands },
    mrtrSigningKey: "b".repeat(64),
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
    const tools = listed.tools as Array<{
      name: string;
      inputSchema?: {
        properties?: Record<string, {
          description?: string;
          pattern?: string;
          not?: { const?: string };
        }>;
      };
    }>;
    const names = tools.map((tool) => tool.name);
    assertEquals(names.includes("project_start"), true);
    assertEquals(names.includes("project_brief_confirm"), true);
    const startSchema = tools.find((tool) => tool.name === "project_start")
      ?.inputSchema?.properties;
    const startIssuedAt = startSchema?.issuedAt?.description ?? "";
    assertStringIncludes(startIssuedAt, "must not be later than the server clock");
    assertStringIncludes(startIssuedAt, "Do not invent a future timestamp");
    assertEquals(
      startSchema?.projectId?.pattern,
      "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$",
    );
    assertEquals(startSchema?.projectId?.not, { const: "latest" });
    const briefSchema = tools.find((tool) => tool.name === "project_brief_propose")
      ?.inputSchema?.properties;
    assertEquals(
      Object.hasOwn(
        (briefSchema?.items as { items?: { properties?: object } })?.items
          ?.properties ?? {},
        "verificationAuthority",
      ),
      true,
    );

    let result = await client.tool("project_start", {
      commandId: "start-project",
      projectId: "project-v3",
      projectName: "Reviewable engineering system",
      issuedAt: "2026-08-03T08:59:00.000Z",
      intent: "Build a reviewable engineering system.",
      intentSource: { kind: "human", reference: "conversation:turn-1" },
    });
    let project = result.structuredContent as Record<string, unknown>;
    assertEquals(project.schemaVersion, "4.0");
    assertEquals(project.revision, 1);

    result = await client.tool("project_brief_propose", {
      ...common("propose-brief", 1),
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Demonstrate a reviewable system safely.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Demonstrate a bounded operating scenario with traceable evidence.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement:
          "Complete the reviewed scenario with a traceable engineering record.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        dependsOnItemIds: [],
      }, {
        id: "verify-assembly",
        kind: "verification-activity",
        statement: "Verify the digital assembly-integrity method.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        dependsOnItemIds: ["success"],
        verificationAuthority: { id: "assembly-integrity", version: "1.0" },
      }],
    });
    project = result.structuredContent as Record<string, unknown>;
    const framing = project.framing as Record<string, unknown>;
    const proposal = framing.proposedBrief as Record<string, unknown>;
    const review = framing.proposalReview as Record<string, unknown>;
    assertEquals(project.revision, 2);
    assertEquals(project.nextTool, "project_brief_confirm");
    assertEquals(project.briefSnapshotId, proposal.id);
    assertEquals(project.briefRevision, proposal.revision);
    assertEquals(project.inputFingerprint, review.inputFingerprint);
    assertEquals(proposal.contractVersion, "2.0");
    assertEquals(
      ((proposal.items as Array<Record<string, unknown>>).find((item) =>
        item.id === "success"
      ))?.dependsOnItemIds,
      [],
    );
    assertEquals(
      ((proposal.items as Array<Record<string, unknown>>).find((item) =>
        item.id === "verify-assembly"
      ))?.verificationAuthority,
      { id: "assembly-integrity", version: "1.0" },
    );
    assertEquals(review.status, "pending");

    const confirmArgs = {
      ...common("confirm-brief", 2),
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      inputFingerprint: review.inputFingerprint,
    };
    const inputRequired = await client.toolInputRequired(
      "project_brief_confirm",
      confirmArgs,
    );
    result = await client.toolRetry(
      "project_brief_confirm",
      confirmArgs,
      inputRequired.requestState as string,
      {
        brief_confirmation: {
          action: "accept",
          content: { confirmed: true },
        },
      },
    );
    project = result.structuredContent as Record<string, unknown>;
    assertEquals(project.revision, 3);
    assertEquals(
      ((project.framing as Record<string, unknown>).currentBriefApproval as Record<
        string,
        unknown
      >).status,
      "approved",
    );
    assertEquals(
      (await projects.get("project-v3"))?.project.objective.statement,
      "Demonstrate a reviewable system safely.",
    );
  } finally {
    await http.shutdown();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test(
  "project_brief_confirm passes operator verbatim rationale to the approval record",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "project-brief-rationale-",
    });
    const projects = new FileEngineeringProjectRevisionStore(directory);
    let tick = 0;
    const commands = new ProjectBriefCommandService(
      projects,
      () =>
        new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
          .toISOString(),
    );
    const { app } = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      projectControl: false,
      projectBrief: { projects, commands },
      mrtrSigningKey: "b".repeat(64),
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

      await client.tool("project_start", {
        commandId: "start-rationale",
        projectId: "project-v3",
        projectName: "Rationale test project",
        issuedAt: "2026-08-03T08:59:00.000Z",
        intent: "Build a reviewable engineering system.",
        intentSource: { kind: "human", reference: "conversation:turn-1" },
      });

      let result = await client.tool("project_brief_propose", {
        ...common("propose-brief", 1),
        items: [
          {
            id: "objective",
            kind: "objective",
            statement: "Demonstrate a reviewable system safely.",
            sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          },
          {
            id: "mission",
            kind: "mission-scenario",
            statement: "Demonstrate a bounded operating scenario.",
            sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          },
          {
            id: "success",
            kind: "success-criterion",
            statement: "Complete the scenario with a traceable record.",
            sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
            dependsOnItemIds: [],
          },
        ],
      });
      const framing = (result.structuredContent as Record<string, unknown>)
        .framing as Record<string, unknown>;
      const proposal = framing.proposedBrief as Record<string, unknown>;
      const review = framing.proposalReview as Record<string, unknown>;

      const confirmArgs = {
        ...common("confirm-brief", 2),
        briefSnapshotId: proposal.id,
        briefRevision: proposal.revision,
        inputFingerprint: review.inputFingerprint,
        rationale: "Operator explicitly confirmed this brief captures the intent.",
      };
      const inputRequired = await client.toolInputRequired(
        "project_brief_confirm",
        confirmArgs,
      );
      result = await client.toolRetry(
        "project_brief_confirm",
        confirmArgs,
        inputRequired.requestState as string,
        {
          brief_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      );

      const approval = (
        (result.structuredContent as Record<string, unknown>)
          .framing as Record<string, unknown>
      ).currentBriefApproval as Record<string, unknown>;
      assertEquals(approval.status, "approved");
      assertEquals(
        approval.rationale,
        "Operator explicitly confirmed this brief captures the intent.",
      );
    } finally {
      await http.shutdown();
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test("local YOLO confirms the exact brief directly with a persisted human startup origin", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-brief-yolo-" });
  const projects = new FileEngineeringProjectRevisionStore(directory);
  let tick = 0;
  const commands = new ProjectBriefCommandService(
    projects,
    () =>
      new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  const { app } = await createConsoleServer({
    manifest: { version: 1, servers: [] },
    runs: [],
    projectControl: false,
    projectBrief: { projects, commands },
    approvalMode: LOCAL_YOLO_PROJECT_APPROVAL_MODE,
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
    await client.tool("project_start", {
      commandId: "start-yolo",
      projectId: "project-v3",
      projectName: "YOLO test project",
      issuedAt: "2026-08-03T08:59:00.000Z",
      intent: "Build a reviewable engineering system.",
      intentSource: { kind: "human", reference: "conversation:turn-1" },
    });
    const proposed = await client.tool("project_brief_propose", {
      ...common("propose-brief-yolo", 1),
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Demonstrate a reviewable system safely.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Demonstrate one bounded operating scenario.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement: "Complete the scenario with a traceable record.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        dependsOnItemIds: [],
      }],
    });
    const proposedContent = proposed.structuredContent as Record<string, unknown>;
    const result = await client.tool("project_brief_confirm", {
      ...common("confirm-brief-yolo", 2),
      briefSnapshotId: proposedContent.briefSnapshotId,
      briefRevision: proposedContent.briefRevision,
      inputFingerprint: proposedContent.inputFingerprint,
      rationale: "Proceed locally.",
    });
    assertEquals(result.resultType, "complete");
    const approval = (
      (result.structuredContent as Record<string, unknown>)
        .framing as Record<string, unknown>
    ).currentBriefApproval as Record<string, unknown>;
    assertEquals(approval.status, "approved");
    assertEquals(approval.decidedBy, {
      id: "local-yolo:startup-opt-in",
      origin: "human",
    });
    assertEquals(
      approval.rationale,
      `YOLO local startup opt-in auto-approved positive confirmation of brief ${proposedContent.briefSnapshotId}@${proposedContent.briefRevision} without MCP elicitation. Caller rationale: Proceed locally.`,
    );
  } finally {
    await http.shutdown();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test(
  "project_brief_confirm uses generic fallback rationale when rationale is absent",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "project-brief-fallback-rationale-",
    });
    const projects = new FileEngineeringProjectRevisionStore(directory);
    let tick = 0;
    const commands = new ProjectBriefCommandService(
      projects,
      () =>
        new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
          .toISOString(),
    );
    const { app } = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      projectControl: false,
      projectBrief: { projects, commands },
      mrtrSigningKey: "b".repeat(64),
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

      await client.tool("project_start", {
        commandId: "start-fallback",
        projectId: "project-v3",
        projectName: "Fallback rationale test project",
        issuedAt: "2026-08-03T08:59:00.000Z",
        intent: "Build a reviewable engineering system.",
        intentSource: { kind: "human", reference: "conversation:turn-1" },
      });

      let result = await client.tool("project_brief_propose", {
        ...common("propose-brief-fallback", 1),
        items: [
          {
            id: "objective",
            kind: "objective",
            statement: "Demonstrate a reviewable system safely.",
            sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          },
          {
            id: "mission",
            kind: "mission-scenario",
            statement: "Demonstrate a bounded operating scenario.",
            sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          },
          {
            id: "success",
            kind: "success-criterion",
            statement: "Complete the scenario with a traceable record.",
            sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
            dependsOnItemIds: [],
          },
        ],
      });
      const framing = (result.structuredContent as Record<string, unknown>)
        .framing as Record<string, unknown>;
      const proposal = framing.proposedBrief as Record<string, unknown>;
      const review = framing.proposalReview as Record<string, unknown>;

      // Confirm WITHOUT a rationale field — the generic fallback must appear in
      // the approval record.
      const confirmArgs = {
        ...common("confirm-brief-fallback", 2),
        briefSnapshotId: proposal.id,
        briefRevision: proposal.revision,
        inputFingerprint: review.inputFingerprint,
      };
      const inputRequired = await client.toolInputRequired(
        "project_brief_confirm",
        confirmArgs,
      );
      result = await client.toolRetry(
        "project_brief_confirm",
        confirmArgs,
        inputRequired.requestState as string,
        {
          brief_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      );

      const approval = (
        (result.structuredContent as Record<string, unknown>)
          .framing as Record<string, unknown>
      ).currentBriefApproval as Record<string, unknown>;
      assertEquals(approval.status, "approved");
      assertEquals(
        approval.rationale,
        "The paired MCP host returned an accepted confirmation response.",
      );
    } finally {
      await http.shutdown();
      await Deno.remove(directory, { recursive: true });
    }
  },
);

function common(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "project-v3",
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}

class TestMcpClient {
  #id = 0;
  constructor(private readonly url: string) {}

  tool(name: string, args: Record<string, unknown>) {
    return this.call("tools/call", { name, arguments: args });
  }

  toolInputRequired(name: string, args: Record<string, unknown>) {
    return this.call(
      "tools/call",
      { name, arguments: args },
      { elicitation: {} },
      "input_required",
    );
  }

  toolRetry(
    name: string,
    args: Record<string, unknown>,
    requestState: string,
    inputResponses: Record<string, unknown>,
  ) {
    return this.call(
      "tools/call",
      { name, arguments: args, requestState, inputResponses },
      { elicitation: {} },
    );
  }

  async call(
    method: string,
    params: Record<string, unknown>,
    capabilities: Record<string, unknown> = {},
    expectedResultType = "complete",
  ): Promise<Record<string, unknown>> {
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
            "io.modelcontextprotocol/clientCapabilities": capabilities,
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          },
        },
      }),
    });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    if (body.error) throw new Error(JSON.stringify(body.error));
    const result = body.result as Record<string, unknown>;
    assertEquals(result.resultType, expectedResultType);
    return result;
  }
}
