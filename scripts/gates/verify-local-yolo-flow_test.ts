import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { approvalModeForBinding, createConsoleServer } from "../../server.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/stores/engineering-project-store.ts";
import { EngineeringProjectCommandService } from "../../src/application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../src/application/use-cases/project/project-brief-command-service.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";

const BRIEF_PROJECT_ID = "local-yolo-brief-gate";
const DECISION_PROJECT_ID = "local-yolo-decision-gate";
const DECISION_ID = "review-local-yolo-material";
const YOLO_ACTOR = { id: "local-yolo:startup-opt-in", origin: "human" } as const;

Deno.test("local YOLO approves positive brief and decision through stateless HTTP", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-local-yolo-gate-" });
  const projects = new FileEngineeringProjectRevisionStore(directory);
  const briefCommands = new ProjectBriefCommandService(
    projects,
    clockFrom("2026-08-14T01:00:00.000Z"),
  );
  const projectCommands = new EngineeringProjectCommandService(
    projects,
    undefined,
    clockFrom("2026-08-14T02:00:00.000Z"),
  );

  await projects.createInitial(decisionProjectFixture());

  const { app } = await createConsoleServer({
    manifest: { version: 1, servers: [] },
    runs: [],
    projectControl: { projects, commands: projectCommands },
    projectBrief: { projects, commands: briefCommands },
    cockpitFocus: false,
    mrtrSigningKey: "a".repeat(64),
    approvalMode: approvalModeForBinding(true, "127.0.0.1"),
    logger: () => {},
  });

  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await app.startHttp({
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    const client = new StatelessMcpClient(`http://127.0.0.1:${port}/mcp`);
    await verifyBriefAutoApproval(client, projects, directory);
    await verifyDecisionAutoApproval(client, projects, directory);

    console.log(JSON.stringify({
      status: "passed",
      mode: "local-yolo",
      transport: "stateless-http-loopback",
      persistedProjects: [BRIEF_PROJECT_ID, DECISION_PROJECT_ID],
      actor: YOLO_ACTOR,
      fabricatedElicitationResponses: false,
    }));
  } finally {
    await http.shutdown();
    await Deno.remove(directory, { recursive: true });
  }
});

async function verifyBriefAutoApproval(
  client: StatelessMcpClient,
  store: FileEngineeringProjectRevisionStore,
  directory: string,
): Promise<void> {
  await client.tool("project_start", {
    commandId: "local-yolo-start",
    projectId: BRIEF_PROJECT_ID,
    projectName: "Local YOLO gate project",
    issuedAt: "2026-08-14T00:59:00.000Z",
    intent: "Prove that explicit local YOLO records review authority honestly.",
    intentSource: { kind: "human", reference: "local-yolo-gate" },
  });

  const proposed = await client.tool("project_brief_propose", {
    commandId: "local-yolo-brief-propose",
    projectId: BRIEF_PROJECT_ID,
    expectedRevision: 1,
    issuedAt: "2026-08-14T00:59:10.000Z",
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Demonstrate explicit local review provenance.",
      sourceRefs: [{ kind: "intent", reference: "local-yolo-gate" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Exercise the stateless MCP approval path on loopback.",
      sourceRefs: [{ kind: "intent", reference: "local-yolo-gate" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Persist the canonical brief with the fixed YOLO actor.",
      sourceRefs: [{ kind: "intent", reference: "local-yolo-gate" }],
      dependsOnItemIds: [],
    }],
  });
  const proposedProject = proposed.structuredContent as Record<string, unknown>;
  const framing = proposedProject.framing as Record<string, unknown>;
  const brief = framing.proposedBrief as Record<string, unknown>;
  const review = framing.proposalReview as Record<string, unknown>;

  const approved = await client.tool("project_brief_confirm", {
    commandId: "local-yolo-brief-confirm",
    projectId: BRIEF_PROJECT_ID,
    expectedRevision: 2,
    issuedAt: "2026-08-14T00:59:20.000Z",
    briefSnapshotId: brief.id,
    briefRevision: brief.revision,
    inputFingerprint: review.inputFingerprint,
  });
  const approvedProject = approved.structuredContent as Record<string, unknown>;
  assertEquals(approvedProject.revision, 3);

  const persisted = await requiredProject(store, BRIEF_PROJECT_ID);
  assertEquals(persisted.revision, 3);
  assertEquals(persisted.framing?.currentBriefApproval?.decidedBy, YOLO_ACTOR);
  assertStringIncludes(
    persisted.framing?.currentBriefApproval?.rationale ?? "",
    "YOLO local startup opt-in",
  );
  assertEquals(
    persisted.commandReceipts?.find((receipt) =>
      receipt.type === "project.brief-approve"
    )?.actor,
    YOLO_ACTOR,
  );
  await assertRevisionFile(directory, BRIEF_PROJECT_ID, 3);
}

async function verifyDecisionAutoApproval(
  client: StatelessMcpClient,
  store: FileEngineeringProjectRevisionStore,
  directory: string,
): Promise<void> {
  const proposed = await client.tool("project_decision_propose", {
    commandId: "local-yolo-decision-propose",
    projectId: DECISION_PROJECT_ID,
    expectedRevision: 1,
    issuedAt: "2026-08-14T01:59:00.000Z",
    decisionId: DECISION_ID,
    proposal: {
      summary: "Use the bounded local gate material card.",
      parameters: [{
        key: "youngs-modulus",
        label: "Young's modulus",
        value: 69,
        unit: "GPa",
      }],
    },
  });
  const proposedProject = proposed.structuredContent as Record<string, unknown>;
  const decision = (proposedProject.decisions as Array<Record<string, unknown>>)
    .find((candidate) => candidate.id === DECISION_ID);
  assert(decision);

  const approved = await client.tool("project_decision_approve", {
    commandId: "local-yolo-decision-approve",
    projectId: DECISION_PROJECT_ID,
    expectedRevision: 2,
    issuedAt: "2026-08-14T01:59:10.000Z",
    decisionId: DECISION_ID,
    inputFingerprint: decision.inputFingerprint,
    rationale: "The local operator explicitly enabled YOLO for this gate.",
  });
  const approvedProject = approved.structuredContent as Record<string, unknown>;
  assertEquals(approvedProject.revision, 3);

  const persisted = await requiredProject(store, DECISION_PROJECT_ID);
  const persistedDecision = persisted.decisions.find((item) => item.id === DECISION_ID);
  const persistedApproval = persisted.approvals.find((item) =>
    item.decisionId === DECISION_ID && item.status === "approved"
  );
  assert(persistedDecision?.inputFingerprint);
  assert(persistedApproval);
  assertEquals(persistedDecision.status, "approved");
  assertEquals(persistedApproval.decidedBy, YOLO_ACTOR.id);
  assertEquals(persistedApproval.decidedByOrigin, YOLO_ACTOR.origin);
  assertEquals(
    persistedApproval.inputFingerprint,
    persistedDecision.inputFingerprint,
  );
  assertStringIncludes(
    persistedApproval.rationale ?? "",
    "YOLO local startup opt-in",
  );
  assertEquals(
    persisted.commandReceipts?.find((receipt) => receipt.type === "decision.approve")
      ?.actor,
    YOLO_ACTOR,
  );
  await assertRevisionFile(directory, DECISION_PROJECT_ID, 3);
}

function decisionProjectFixture(): EngineeringProjectSnapshot {
  const generatedAt = "2026-08-14T00:00:00.000Z";
  const workItemId = "review-local-yolo-card";
  return {
    schemaVersion: "1.0",
    id: `${DECISION_PROJECT_ID}:project:r1`,
    revision: 1,
    generatedAt,
    project: {
      id: DECISION_PROJECT_ID,
      name: "Local YOLO decision gate",
      subjectId: DECISION_PROJECT_ID,
      objective: {
        title: "Review one bounded decision",
        statement: "Prove the local YOLO decision provenance path.",
      },
    },
    threadSnapshots: [{
      snapshotId: `${DECISION_PROJECT_ID}:thread:r1`,
      revision: 1,
      subjectId: DECISION_PROJECT_ID,
    }],
    phases: [{
      id: "review",
      name: "Review",
      order: 1,
      description: "Review one bounded material proposal.",
      workItemIds: [workItemId],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: workItemId,
      phaseId: "review",
      title: "Review the local material card",
      description: "Record a human-reviewable material decision.",
      kind: "review",
      status: "waiting-for-decision",
      owner: "shared",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: ["local-yolo-decision-required"],
    }],
    agentRuns: [],
    decisions: [{
      id: DECISION_ID,
      phaseId: "review",
      title: "Review the local material card",
      question: "May this bounded material card be used by the gate?",
      status: "required",
      requestedAt: generatedAt,
      inputEvidenceRefs: [],
      approvalIds: [],
    }],
    approvals: [],
    blockers: [{
      id: "local-yolo-decision-required",
      phaseId: "review",
      title: "Material review is required",
      description: "The bounded proposal requires explicit review authority.",
      kind: "decision-required",
      status: "open",
      openedAt: generatedAt,
      workItemIds: [workItemId],
      decisionIds: [DECISION_ID],
    }],
  };
}

async function requiredProject(
  store: FileEngineeringProjectRevisionStore,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const project = await store.get(projectId);
  assert(project);
  return project;
}

async function assertRevisionFile(
  root: string,
  projectId: string,
  revision: number,
): Promise<void> {
  const filename = `${String(revision).padStart(10, "0")}.json`;
  const path = `${root}/${encodeURIComponent(projectId)}/${filename}`;
  const parsed = JSON.parse(await Deno.readTextFile(path)) as Record<
    string,
    unknown
  >;
  assertEquals(parsed.revision, revision);
  assertEquals((parsed.project as Record<string, unknown>).id, projectId);
}

function clockFrom(start: string): () => string {
  let tick = 0;
  const epoch = Date.parse(start);
  return () => new Date(epoch + ++tick * 1_000).toISOString();
}

class StatelessMcpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  tool(name: string, args: Record<string, unknown>) {
    return this.call("tools/call", { name, arguments: args });
  }

  async call(
    method: string,
    params: Record<string, unknown>,
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
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "local-yolo-gate",
              version: "1",
            },
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
