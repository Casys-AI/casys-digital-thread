import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  DISCOVERY_OPERATOR_INTENT_HEADER,
  DISCOVERY_OPERATOR_INTENT_VALUE,
} from "../src/adapters/project-discovery-command-http.ts";
import { FileEngineeringProjectRevisionStore } from "../src/adapters/engineering-project-store.ts";
import { FileProjectDiscoveryRevisionStore } from "../src/adapters/project-discovery-store.ts";
import { ProjectDiscoveryCommandService } from "../src/domain/project-discovery-command-service.ts";
import { ProjectDiscoveryHandoffService } from "../src/domain/project-discovery-handoff-service.ts";
import { createDiscoveryWorkbenchHandler } from "./serve-discovery-workbench.ts";

const DISCOVERY_ID = "drone-concept";
const NOW = "2026-08-02T06:00:00.000Z";

Deno.test("Discovery Workbench serves an exact immutable snapshot and hardened HTML", async () => {
  await withDiscovery(async ({ store }) => {
    const handler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      html: "<!doctype html><title>Discovery</title>",
    });

    const response = await handler(
      new Request(`http://localhost/api/project-discoveries/${DISCOVERY_ID}`),
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("X-Casys-Data-Source"),
      "immutable-project-discovery-snapshot",
    );
    const snapshot = await response.json();
    assertEquals(snapshot.discoveryId, DISCOVERY_ID);
    assertEquals(snapshot.revision, 1);

    const missing = await handler(
      new Request("http://localhost/api/project-discoveries/absent"),
    );
    assertEquals(missing.status, 404);
    assertEquals(await missing.json(), {
      error: "project_discovery_not_found",
      discoveryId: "absent",
    });

    const unsafe = await handler(
      new Request("http://localhost/api/project-discoveries/-unsafe"),
    );
    assertEquals(unsafe.status, 400);
    assertEquals((await unsafe.json()).error, "invalid_discovery_id");

    const page = await handler(new Request("http://localhost/"));
    assertEquals(page.status, 200);
    assertEquals(page.headers.get("X-Frame-Options"), "DENY");
    assertStringIncludes(
      page.headers.get("Content-Security-Policy") ?? "",
      "frame-ancestors 'none'",
    );
  });
});

Deno.test("Discovery Workbench applies explicit same-origin human commands with CAS", async () => {
  await withDiscovery(async ({ store, service }) => {
    await proposeMissionQuestion(service, 1);
    const handler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      commands: service,
      html: "unused",
    });
    const command = {
      schemaVersion: "project-discovery-command/1.0",
      commandId: "answer-mission-1",
      discoveryId: DISCOVERY_ID,
      expectedRevision: 2,
      issuedAt: NOW,
      actor: { id: "reviewer-erwan" },
      command: {
        type: "answer.record",
        answer: {
          id: "mission-answer-1",
          questionId: "mission",
          kind: "provided",
          value: "inspection",
        },
      },
    };

    const applied = await handler(operatorRequest(command));
    assertEquals(applied.status, 200);
    const snapshot = await applied.json();
    assertEquals(snapshot.revision, 3);
    assertEquals(snapshot.answers[0].source, {
      kind: "human",
      reference: "same-origin Discovery Workbench",
    });

    const stale = await handler(operatorRequest({
      ...command,
      commandId: "answer-mission-stale",
      command: {
        ...command.command,
        answer: { ...command.command.answer, id: "mission-answer-stale" },
      },
    }));
    assertEquals(stale.status, 409);
    assertEquals(await stale.json(), {
      error: "stale_revision",
      message:
        "Project discovery drone-concept expected revision 2, current revision is 3.",
      expectedRevision: 2,
      actualRevision: 3,
    });

    const mismatchedPath = await handler(
      operatorRequest(command, {}, "another-discovery"),
    );
    assertEquals(mismatchedPath.status, 422);
    assertEquals(
      (await mismatchedPath.json()).error,
      "invalid_discovery_command",
    );

    const rebound = await handler(operatorRequest(command, {
      urlOrigin: "http://evil.example:5174",
      requestOrigin: "http://evil.example:5174",
    }));
    assertEquals(rebound.status, 403);
    assertEquals((await rebound.json()).error, "loopback_host_required");

    const readOnlyHandler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      html: "unused",
    });
    const disabled = await readOnlyHandler(operatorRequest(command));
    assertEquals(disabled.status, 404);
    assertEquals((await disabled.json()).error, "operator_commands_disabled");
  });
});

Deno.test("Discovery Workbench hands an approved brief to one empty engineering project shell", async () => {
  await withDiscovery(async ({ store, service, projects, handoff }) => {
    const approved = await approveDroneBrief(service);
    const handler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      handoff,
      html: "unused",
    });
    const command = {
      schemaVersion: "project-discovery-handoff-command/1.0",
      commandId: "create-drone-engineering-project",
      discoveryId: DISCOVERY_ID,
      expectedDiscoveryRevision: approved.revision,
      issuedAt: NOW,
      actor: { id: "reviewer-erwan" },
      command: {
        type: "project.create-from-approved-discovery",
        projectId: DISCOVERY_ID,
        projectName: approved.brief!.objective,
      },
    } as const;

    const created = await handler(handoffRequest(command));
    assertEquals(created.status, 200);
    assertEquals(
      created.headers.get("X-Casys-Data-Source"),
      "immutable-engineering-project-handoff",
    );
    const result = await created.json();
    assertEquals(result, {
      schemaVersion: "project-discovery-handoff-result/1.0",
      scope: "initial-project-shell",
      project: {
        id: DISCOVERY_ID,
        name: approved.brief!.objective.trim(),
        revision: 1,
      },
      message:
        "The initial project shell preserved the approved brief and added no technical state.",
    });

    const project = await projects.get(DISCOVERY_ID);
    assertEquals(project?.project.name, approved.brief!.objective.trim());
    assertEquals(project?.project.subjectId, `project:${DISCOVERY_ID}`);
    assertEquals(project?.discoveryHandoff?.snapshotId, approved.id);
    assertEquals(project?.threadSnapshots, []);
    assertEquals(project?.phases, []);
    assertEquals(project?.workItems, []);
    assertEquals(project?.agentRuns, []);
    assertEquals(project?.decisions, []);
    assertEquals(project?.approvals, []);
    assertEquals(project?.blockers, []);

    const replay = await handler(handoffRequest(command));
    assertEquals(replay.status, 200);
    assertEquals(await replay.json(), result);

    const mismatchedPath = await handler(
      handoffRequest(command, "another-discovery"),
    );
    assertEquals(mismatchedPath.status, 422);
    assertEquals(
      (await mismatchedPath.json()).error,
      "invalid_discovery_handoff",
    );

    const forgedProjectId = await handler(handoffRequest({
      ...command,
      command: { ...command.command, projectId: "another-project" },
    }));
    assertEquals(forgedProjectId.status, 422);
    assertEquals(
      (await forgedProjectId.json()).error,
      "invalid_discovery_handoff",
    );

    const forgedProjectName = await handler(handoffRequest({
      ...command,
      command: { ...command.command, projectName: "Invented project name" },
    }));
    assertEquals(forgedProjectName.status, 422);
    assertEquals(
      (await forgedProjectName.json()).error,
      "invalid_discovery_handoff",
    );

    const readOnlyHandler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      html: "unused",
    });
    const disabled = await readOnlyHandler(handoffRequest(command));
    assertEquals(disabled.status, 404);
    assertEquals((await disabled.json()).error, "project_handoff_disabled");
  });
});

Deno.test("Discovery Workbench SSE emits the full snapshot when a revision advances", async () => {
  await withDiscovery(async ({ store, service }) => {
    const handler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      commands: service,
      html: "unused",
      pollIntervalMs: 2,
    });
    const response = await handler(
      new Request(
        `http://localhost/api/project-discoveries/${DISCOVERY_ID}/events`,
        { headers: { "Last-Event-ID": "1" } },
      ),
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      "text/event-stream; charset=utf-8",
    );
    const reader = response.body!.getReader();
    try {
      await proposeMissionQuestion(service, 1);
      const event = new TextDecoder().decode(await readChunk(reader));
      assertStringIncludes(event, "id: 2\n");
      assertStringIncludes(event, "event: project-discovery-snapshot\n");
      assertStringIncludes(event, `\"discoveryId\":\"${DISCOVERY_ID}\"`);
      assertStringIncludes(event, '"revision":2');
      assertStringIncludes(event, '"questions":[{');
    } finally {
      await reader.cancel();
    }
  });
});

async function withDiscovery(
  run: (context: {
    store: FileProjectDiscoveryRevisionStore;
    service: ProjectDiscoveryCommandService;
    projects: FileEngineeringProjectRevisionStore;
    handoff: ProjectDiscoveryHandoffService;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-discovery-bff-" });
  try {
    const store = new FileProjectDiscoveryRevisionStore(directory);
    const service = new ProjectDiscoveryCommandService(store, () => NOW);
    const projects = new FileEngineeringProjectRevisionStore(
      `${directory}/engineering-projects`,
    );
    const handoff = new ProjectDiscoveryHandoffService(
      store,
      projects,
      () => NOW,
    );
    await service.start(
      { kind: "agent", actorId: "guide" },
      {
        commandId: "start-drone-discovery",
        discoveryId: DISCOVERY_ID,
        issuedAt: NOW,
        intent: "Build a drone.",
      },
    );
    await run({ store, service, projects, handoff });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function approveDroneBrief(service: ProjectDiscoveryCommandService) {
  const proposed = await service.proposeBrief(
    { kind: "agent", actorId: "guide" },
    {
      commandId: "propose-drone-brief",
      discoveryId: DISCOVERY_ID,
      expectedRevision: 1,
      issuedAt: NOW,
      brief: {
        id: "drone-brief-v1",
        objective: "  Deliver a reviewable drone demonstrator.  ",
        missionScenarios: ["Fly a controlled demonstration route"],
        successCriteria: ["Record planned verification evidence"],
        constraints: ["No certification claim from discovery"],
        intendedMarkets: ["Initial market unknown"],
        manufacturingJurisdictions: ["Manufacturing location unknown"],
        operatingJurisdictions: ["Operating jurisdiction unknown"],
        complianceTargets: [
          "Identify applicable rules from authoritative sources",
        ],
        verificationPlan: ["Plan named analysis and test evidence"],
        exclusions: ["Production authorization"],
        assumptions: ["The first flight occurs in a controlled setting"],
        openQuestions: ["Which operating jurisdiction is intended?"],
      },
    },
  );
  return await service.approveBrief(
    { kind: "human", actorId: "reviewer-erwan" },
    {
      commandId: "approve-drone-brief",
      discoveryId: DISCOVERY_ID,
      expectedRevision: proposed.revision,
      issuedAt: NOW,
      briefId: proposed.brief!.id,
      rationale: "Approved as a project planning basis.",
      inputFingerprint: proposed.review!.inputFingerprint,
    },
  );
}

function proposeMissionQuestion(
  service: ProjectDiscoveryCommandService,
  expectedRevision: number,
) {
  return service.proposeQuestion(
    { kind: "agent", actorId: "guide" },
    {
      commandId: "propose-mission-question",
      discoveryId: DISCOVERY_ID,
      expectedRevision,
      issuedAt: NOW,
      question: {
        id: "mission",
        prompt: "What should the drone help you do?",
        whyItMatters: "The mission determines which risks must be designed out.",
        recommendation: {
          value: "inspection",
          rationale: "Inspection is a bounded first mission.",
          confidence: "medium",
        },
        options: [{
          value: "inspection",
          label: "Inspection",
          consequences: "Prioritises stability and observable operation.",
        }],
        allowUnknown: true,
        risk: "reversible",
        evidenceNeeded: [],
      },
    },
  );
}

function operatorRequest(
  body: unknown,
  origins: {
    urlOrigin?: string;
    requestOrigin?: string;
  } = {},
  discoveryId = DISCOVERY_ID,
): Request {
  const urlOrigin = origins.urlOrigin ?? "http://127.0.0.1:5174";
  const requestOrigin = origins.requestOrigin ?? urlOrigin;
  return new Request(
    `${urlOrigin}/api/project-discoveries/${discoveryId}/commands`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        [DISCOVERY_OPERATOR_INTENT_HEADER]: DISCOVERY_OPERATOR_INTENT_VALUE,
      },
      body: JSON.stringify(body),
    },
  );
}

function handoffRequest(body: unknown, discoveryId = DISCOVERY_ID): Request {
  const origin = "http://127.0.0.1:5174";
  return new Request(
    `${origin}/api/project-discoveries/${discoveryId}/handoff`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        [DISCOVERY_OPERATOR_INTENT_HEADER]: DISCOVERY_OPERATOR_INTENT_VALUE,
      },
      body: JSON.stringify(body),
    },
  );
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for discovery SSE.")),
          1_000,
        );
      }),
    ]);
    if (result.done || !result.value) {
      throw new Error("Discovery SSE closed before publishing a snapshot.");
    }
    return result.value;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
