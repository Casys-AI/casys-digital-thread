import { assertEquals, assertStringIncludes } from "@std/assert";
import { FileProjectDiscoveryRevisionStore } from "../src/adapters/project-discovery-store.ts";
import type { CockpitFocusStore } from "../src/adapters/file-cockpit-focus-store.ts";
import type { CockpitFocusSnapshot } from "../src/domain/cockpit-focus.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../src/domain/cockpit-focus.ts";
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

    const active = await handler(
      new Request("http://localhost/api/project-discoveries/active"),
    );
    assertEquals(active.status, 200);
    assertEquals((await active.json()).discoveryId, DISCOVERY_ID);

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

    for (
      const path of [
        `/api/project-discoveries/${DISCOVERY_ID}/commands`,
        `/api/project-discoveries/${DISCOVERY_ID}/handoff`,
      ]
    ) {
      const rejected = await handler(
        new Request(`http://localhost${path}`, { method: "POST" }),
      );
      assertEquals(rejected.status, 404);
    }
  });
});

Deno.test("Discovery Workbench SSE emits the full snapshot when a revision advances", async () => {
  await withDiscovery(async ({ store, service }) => {
    const handler = createDiscoveryWorkbenchHandler({
      discoveries: store,
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

Deno.test("standalone Discovery preview refuses to impersonate a selected project", async () => {
  await withDiscovery(async ({ store }) => {
    const focus = new MutableFocus();
    focus.value = focusSnapshot({ kind: "project", projectId: "drone-project" });
    const handler = createDiscoveryWorkbenchHandler({
      discoveries: store,
      html: "unused",
      focus,
      workspaceId: "primary",
      fallbackDiscoveryId: DISCOVERY_ID,
      pollIntervalMs: 2,
    });
    const read = await handler(
      new Request("http://localhost/api/project-discoveries/active"),
    );
    assertEquals(read.status, 409);
    assertEquals((await read.json()).projectId, "drone-project");
    const stream = await handler(
      new Request(
        "http://localhost/api/project-discoveries/active/events",
      ),
    );
    assertEquals(stream.status, 409);
    assertEquals((await stream.json()).projectId, "drone-project");
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

class MutableFocus implements CockpitFocusStore {
  constructor(public value?: CockpitFocusSnapshot) {}
  get(): Promise<CockpitFocusSnapshot | undefined> {
    return Promise.resolve(this.value);
  }
  select(): Promise<CockpitFocusSnapshot> {
    throw new Error("read-only");
  }
}

function focusSnapshot(
  target: CockpitFocusSnapshot["target"],
  revision = 1,
): CockpitFocusSnapshot {
  return {
    schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
    workspaceId: "primary",
    revision,
    commandId: `focus-${revision}`,
    selectedAt: NOW,
    selectedBy: { kind: "agent", actorId: "mcp:test@1" },
    target,
    ...(revision === 1 ? {} : { previous: { revision: revision - 1 } }),
  };
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
