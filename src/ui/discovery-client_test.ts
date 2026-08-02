import { assertEquals, assertRejects } from "@std/assert";
import type { ProjectDiscoverySnapshot } from "../domain/project-discovery.ts";
import {
  HttpProjectDiscoveryClient,
  ProjectDiscoveryConflictError,
  type ProjectDiscoveryEventSource,
} from "./src/project/discovery-client.ts";
import {
  createProjectDiscoveryCommandRequest,
  PROJECT_DISCOVERY_INTENT_HEADER,
} from "./src/project/discovery-command-contract.ts";

const DIGEST = "a".repeat(64);

function discoverySnapshot(): ProjectDiscoverySnapshot {
  return {
    schemaVersion: "1.0",
    id: "discovery-snapshot-1",
    discoveryId: "drone-concept",
    revision: 1,
    generatedAt: "2026-08-02T12:00:00.000Z",
    status: "discovering",
    intent: {
      statement: "Build a drone with reviewable evidence.",
      capturedAt: "2026-08-02T11:59:00.000Z",
      capturedBy: { id: "local-reviewer", origin: "human" },
    },
    questions: [],
    answers: [],
    commandReceipts: [{
      commandId: "start-drone-discovery",
      type: "discovery.start",
      actor: { id: "guide-agent", origin: "agent" },
      issuedAt: "2026-08-02T11:59:00.000Z",
      appliedAt: "2026-08-02T12:00:00.000Z",
      requestFingerprint: { algorithm: "sha256", digest: DIGEST },
      resultingSnapshot: { snapshotId: "discovery-snapshot-1", revision: 1 },
    }],
  };
}

Deno.test("discovery client loads one strict full snapshot", async () => {
  const requests: Array<{ input: string; method?: string }> = [];
  const client = new HttpProjectDiscoveryClient(
    "/api/project-discoveries/drone-concept",
    "/api/project-discoveries/drone-concept/commands",
    "/api/project-discoveries/drone-concept/events",
    (input, init) => {
      requests.push({ input: String(input), method: init?.method });
      return Promise.resolve(Response.json(discoverySnapshot()));
    },
    undefined,
  );

  const snapshot = await client.load();

  assertEquals(snapshot.discoveryId, "drone-concept");
  assertEquals(requests, [{
    input: "/api/project-discoveries/drone-concept",
    method: "GET",
  }]);
});

Deno.test("discovery client rejects an unsupported HTTP contract", async () => {
  const client = new HttpProjectDiscoveryClient(
    "/discovery",
    "/commands",
    "/events",
    () => Promise.resolve(Response.json({ schemaVersion: "unknown" })),
    undefined,
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("discovery client posts an explicit revision-bound human command", async () => {
  let captured: { input: string; init?: RequestInit } | undefined;
  const client = new HttpProjectDiscoveryClient(
    "/discovery",
    "/commands",
    "/events",
    (input, init) => {
      captured = { input: String(input), init };
      return Promise.resolve(Response.json(discoverySnapshot()));
    },
    undefined,
  );
  const request = createProjectDiscoveryCommandRequest({
    commandId: "answer-command-1",
    discoveryId: "drone-concept",
    expectedRevision: 1,
    issuedAt: "2026-08-02T12:01:00.000Z",
    actorId: "local-reviewer",
    command: {
      type: "answer.record",
      answer: {
        id: "answer-mission-1",
        questionId: "mission",
        kind: "unknown",
      },
    },
  });

  await client.command(request);

  const headers = new Headers(captured?.init?.headers);
  assertEquals(captured?.input, "/commands");
  assertEquals(captured?.init?.method, "POST");
  assertEquals(headers.get(PROJECT_DISCOVERY_INTENT_HEADER), "explicit");
  assertEquals(headers.get("Content-Type"), "application/json");
  assertEquals(JSON.parse(String(captured?.init?.body)), request);
});

Deno.test("discovery command conflicts retain the actual server revision", async () => {
  const client = new HttpProjectDiscoveryClient(
    "/discovery",
    "/commands",
    "/events",
    () =>
      Promise.resolve(Response.json({ actualRevision: 4 }, { status: 409 })),
    undefined,
  );
  const request = createProjectDiscoveryCommandRequest({
    commandId: "approve-command-1",
    discoveryId: "drone-concept",
    expectedRevision: 3,
    issuedAt: "2026-08-02T12:01:00.000Z",
    actorId: "local-reviewer",
    command: {
      type: "brief.approve",
      briefId: "brief-1",
      rationale: "Reviewed and approved.",
      inputFingerprint: { algorithm: "sha256", digest: DIGEST },
    },
  });

  const error = await assertRejects(
    () => client.command(request),
    ProjectDiscoveryConflictError,
  );
  assertEquals(error.actualRevision, 4);
});

Deno.test("discovery SSE consumes named full snapshots and stays calm on reconnect", () => {
  const source = new FakeEventSource();
  const statuses: string[] = [];
  const snapshots: ProjectDiscoverySnapshot[] = [];
  const client = new HttpProjectDiscoveryClient(
    "/discovery",
    "/commands",
    "/events",
    () => Promise.resolve(Response.json(discoverySnapshot())),
    (endpoint) => {
      assertEquals(endpoint, "/events");
      return source;
    },
  );

  const close = client.subscribe(
    (snapshot) => snapshots.push(snapshot),
    (status) => statuses.push(status),
  );
  source.emit("open");
  source.emit(
    "project-discovery-snapshot",
    JSON.stringify(discoverySnapshot()),
  );
  source.emit("project-discovery-snapshot", "not json");
  source.emit("error");
  close();

  assertEquals(snapshots.map((item) => item.id), ["discovery-snapshot-1"]);
  assertEquals(statuses, ["connecting", "live", "live", "reconnecting"]);
  assertEquals(source.closed, true);
});

class FakeEventSource implements ProjectDiscoveryEventSource {
  readonly listeners = new Map<string, Array<(event: Event) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data = ""): void {
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {
    this.closed = true;
  }
}
