import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  DISCOVERY_OPERATOR_INTENT_HEADER,
  DISCOVERY_OPERATOR_INTENT_VALUE,
} from "../src/adapters/project-discovery-command-http.ts";
import { FileProjectDiscoveryRevisionStore } from "../src/adapters/project-discovery-store.ts";
import { ProjectDiscoveryCommandService } from "../src/domain/project-discovery-command-service.ts";
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
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-discovery-bff-" });
  try {
    const store = new FileProjectDiscoveryRevisionStore(directory);
    const service = new ProjectDiscoveryCommandService(store, () => NOW);
    await service.start(
      { kind: "agent", actorId: "guide" },
      {
        commandId: "start-drone-discovery",
        discoveryId: DISCOVERY_ID,
        issuedAt: NOW,
        intent: "Build a drone.",
      },
    );
    await run({ store, service });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
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
