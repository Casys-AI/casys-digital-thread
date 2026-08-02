import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  createThreadWorkbenchClient,
  HttpThreadWorkbenchClient,
  ProjectCommandConflictError,
} from "./src/thread/client.ts";
import { createProjectCommandRequest } from "./src/project/command-contract.ts";
import { COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE } from "./src/project/fixture.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import {
  isEngineeringWorkbenchSnapshot,
  isThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("native Workbench fallback is an explicitly labelled product fixture", async () => {
  const client = createThreadWorkbenchClient();
  const workbench = await client.load();
  assertEquals(workbench.surface, "evidence");
  if (workbench.surface !== "evidence") {
    throw new Error(
      "Expected the labelled fallback to contain technical evidence.",
    );
  }
  const snapshot = workbench.thread;

  assertEquals(client.source, "fixture");
  assertEquals(snapshot.source, "fixture");
  assertEquals(snapshot.sourceLabel.includes("NOT LIVE EVIDENCE"), true);
  assertEquals(snapshot.violations[0]?.id, "VIO-MECH-014");
  assertEquals(
    snapshot.artifacts.find((item) => item.id === "ART-FEA-018")?.dependsOn,
    ["ART-STEP-018"],
  );
  assertEquals(
    snapshot.artifacts.find((item) => item.id === "ART-FEA-018")
      ?.attestation?.status,
    "verified",
  );
  assertEquals(
    snapshot.artifacts.find((item) => item.id === "ART-THERMAL-017")
      ?.attestation?.status,
    "mismatch",
  );
});

Deno.test("injected Workbench projection is preserved without a transport call", async () => {
  const client = createThreadWorkbenchClient({
    projection: COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE,
  });

  assertEquals(client.source, "injected");
  assertStrictEquals(
    await client.load(),
    COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE,
  );
  assertEquals(isEngineeringWorkbenchSnapshot(await client.load()), true);
});

Deno.test("Workbench contract accepts a planning surface only when no technical baseline is declared", () => {
  const planning = structuredClone(
    COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  planning.surface = "planning";
  delete planning.thread;
  delete planning.alignment;
  (planning.project as { threadSnapshots: unknown[] }).threadSnapshots = [];
  planning.planning = {
    technicalBaseline: {
      status: "running",
      message: "The agent is preparing the first documentary baseline.",
    },
    baselineRun: {
      id: "run-first-baseline",
      status: "running",
      workItem: {
        id: "work-define",
        title: "Prepare the first system definition",
        kind: "define",
      },
      queuedAt: "2026-08-02T12:00:00.000Z",
      statusHistory: [{
        status: "queued",
        at: "2026-08-02T12:00:00.000Z",
      }, {
        status: "running",
        at: "2026-08-02T12:00:05.000Z",
      }],
    },
    activity: {
      version: 4,
      milestones: [{
        sequence: 4,
        state: "running",
        recordedAt: "2026-08-02T12:00:06.000Z",
      }],
    },
  };

  assertEquals(isEngineeringWorkbenchSnapshot(planning), true);

  (planning.project as { threadSnapshots: unknown[] }).threadSnapshots = [{
    snapshotId: "thread-r1",
    revision: 1,
    subjectId: "CM-01",
  }];
  assertEquals(isEngineeringWorkbenchSnapshot(planning), false);
});

Deno.test("Workbench contract rejects a planning activity that carries graph or provider payload", () => {
  const planning = structuredClone(
    COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  planning.surface = "planning";
  delete planning.thread;
  delete planning.alignment;
  (planning.project as { threadSnapshots: unknown[] }).threadSnapshots = [];
  planning.planning = {
    technicalBaseline: {
      status: "queued",
      message: "A reviewed first run is queued.",
    },
    activity: {
      version: 1,
      milestones: [{
        sequence: 1,
        state: "running",
        recordedAt: "2026-08-02T12:00:00.000Z",
        graph: { nodes: [], edges: [] },
      }],
    },
  };

  assertEquals(isEngineeringWorkbenchSnapshot(planning), false);
});

Deno.test("Workbench contract keeps a documentary baseline separate from an evidence thread", () => {
  const fixture = structuredClone(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE);
  const documentary = {
    schemaVersion: "engineering-workbench/0.2",
    surface: "documentary",
    project: fixture.project,
    documentary: {
      status: "recorded",
      message: "One durable pre-technical record is available.",
      record: {
        origin: "approved-discovery",
        snapshotId: fixture.project.threadSnapshots[0]!.snapshotId,
        snapshotRevision: fixture.project.threadSnapshots[0]!.revision,
        artifactId: "approved-discovery-document",
        label: "Approved discovery documentary baseline (pre-technical)",
        fingerprint: "sha256:documentary-record",
        recordedAt: "2026-08-02T12:00:00.000Z",
      },
      technicalEvidence: {
        status: "not-recorded",
        message: "No CAD, SysML, simulation or compliance proof is recorded.",
      },
    },
    capabilities: fixture.capabilities,
  };

  assertEquals(isEngineeringWorkbenchSnapshot(documentary), true);
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...documentary,
      thread: fixture.thread,
    }),
    false,
  );
});

Deno.test("the Workbench contract requires explicit flow dependencies", () => {
  const missingDependencies = JSON.parse(
    JSON.stringify(COFFEE_MACHINE_THREAD_FIXTURE),
  ) as typeof COFFEE_MACHINE_THREAD_FIXTURE;
  delete (missingDependencies.flow[0] as { dependsOn?: string[] }).dependsOn;

  assertEquals(isThreadWorkbenchSnapshot(missingDependencies), false);
});

Deno.test("the Workbench contract requires a typed native graph", () => {
  const missingGraph = JSON.parse(
    JSON.stringify(COFFEE_MACHINE_THREAD_FIXTURE),
  ) as Partial<typeof COFFEE_MACHINE_THREAD_FIXTURE>;
  delete missingGraph.graph;
  assertEquals(isThreadWorkbenchSnapshot(missingGraph), false);

  const unsupportedRelation = JSON.parse(
    JSON.stringify(COFFEE_MACHINE_THREAD_FIXTURE),
  ) as typeof COFFEE_MACHINE_THREAD_FIXTURE;
  unsupportedRelation.graph.edges[0].relation = "fuzzy_match" as never;
  assertEquals(isThreadWorkbenchSnapshot(unsupportedRelation), false);
});

Deno.test("the Workbench contract requires evidence-backed component facets", () => {
  const missingComponents = JSON.parse(
    JSON.stringify(COFFEE_MACHINE_THREAD_FIXTURE),
  ) as Partial<typeof COFFEE_MACHINE_THREAD_FIXTURE>;
  delete missingComponents.components;
  assertEquals(isThreadWorkbenchSnapshot(missingComponents), false);

  const fuzzyBinding = JSON.parse(
    JSON.stringify(COFFEE_MACHINE_THREAD_FIXTURE),
  ) as typeof COFFEE_MACHINE_THREAD_FIXTURE;
  fuzzyBinding.components.components[0].bindings[0].status = "fuzzy" as never;
  assertEquals(isThreadWorkbenchSnapshot(fuzzyBinding), false);
});

Deno.test("HTTP Workbench client performs one uncached read-only JSON GET", async () => {
  const requests: Array<{
    input: string;
    method?: string;
    cache?: RequestCache;
  }> = [];
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method,
        cache: init?.cache,
      });
      return Promise.resolve(
        Response.json(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE),
      );
    },
  );

  const snapshot = await client.load();

  assertEquals(snapshot.surface, "evidence");
  if (snapshot.surface !== "evidence") {
    throw new Error("Expected the HTTP fixture to contain technical evidence.");
  }
  assertEquals(snapshot.thread.id, COFFEE_MACHINE_THREAD_FIXTURE.id);
  assertEquals(
    snapshot.project.project.subjectId,
    COFFEE_MACHINE_THREAD_FIXTURE.subject.id,
  );
  assertEquals(requests, [
    { input: "/api/thread/workbench", method: "GET", cache: "no-store" },
  ]);
});

Deno.test("HTTP Workbench client rejects an unsupported contract", async () => {
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json({ schemaVersion: "unknown" })),
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("HTTP Workbench client rejects malformed planning provenance", async () => {
  const malformed = structuredClone(
    COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  malformed.surface = "planning";
  delete malformed.thread;
  delete malformed.alignment;
  (malformed.project as { threadSnapshots: unknown[] }).threadSnapshots = [];
  (malformed.project as Record<string, unknown>).plan = {
    startingPoint: "idea-or-spec",
    basis: null,
    publishedAt: "2026-08-02T12:00:00.000Z",
    publishedBy: { id: "agent:planner", origin: "agent" },
  };
  malformed.planning = {
    technicalBaseline: {
      status: "not-created",
      message: "Technical baseline not created yet.",
    },
    activity: { version: 0, milestones: [] },
  };
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json(malformed)),
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("HTTP Workbench client rejects a naked thread projection", async () => {
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json(COFFEE_MACHINE_THREAD_FIXTURE)),
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("HTTP Workbench client posts one explicit, revision-bound operator command", async () => {
  const enabled = {
    ...structuredClone(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE),
    capabilities: {
      operatorCommands: {
        enabled: true,
        endpoint: "/api/project/commands",
        intents: ["decision.propose"],
        explicitIntentHeader: "X-Casys-Operator-Intent",
        expectedRevision: COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE.project.revision,
      },
    },
  };
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    (input, init) => {
      requests.push({ input: String(input), init });
      return Promise.resolve(Response.json(enabled));
    },
  );
  await client.load();
  const request = createProjectCommandRequest({
    commandId: "command-01",
    projectId: enabled.project.project.id,
    expectedRevision: enabled.project.revision,
    issuedAt: "2026-08-01T12:00:00.000Z",
    actorId: "operator-erwan",
    command: {
      type: "decision.propose",
      decisionId: "decision-mechanical-inputs",
      proposal: {
        summary: "Reviewed reference case",
        parameters: [{ key: "case", label: "Case", value: "reviewed" }],
      },
    },
  });

  await client.command(request);

  assertEquals(requests.length, 2);
  assertEquals(requests[1]?.input, "/api/project/commands");
  assertEquals(requests[1]?.init?.method, "POST");
  assertEquals(
    new Headers(requests[1]?.init?.headers).get("X-Casys-Operator-Intent"),
    "explicit",
  );
  assertEquals(
    JSON.parse(String(requests[1]?.init?.body)),
    request,
  );
});

Deno.test("HTTP Workbench client exposes revision conflicts for a UI refresh", async () => {
  const enabled = {
    ...structuredClone(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE),
    capabilities: {
      operatorCommands: {
        enabled: true,
        endpoint: "/api/project/commands",
        intents: ["agent-run.queue"],
        explicitIntentHeader: "X-Casys-Operator-Intent",
        expectedRevision: COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE.project.revision,
      },
    },
  };
  let reads = 0;
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    (_input, init) => {
      if (init?.method === "POST") {
        return Promise.resolve(Response.json({
          error: "project_revision_conflict",
          expectedRevision: 1,
          actualRevision: 2,
        }, { status: 409 }));
      }
      reads += 1;
      return Promise.resolve(Response.json(enabled));
    },
  );
  await client.load();

  try {
    await client.command(createProjectCommandRequest({
      commandId: "command-conflict",
      projectId: enabled.project.project.id,
      expectedRevision: 1,
      issuedAt: "2026-08-01T12:00:00.000Z",
      actorId: "operator-erwan",
      command: {
        type: "agent-run.queue",
        workItemId: "work-simulate",
        summary: "Run reviewed work",
      },
    }));
    throw new Error("Expected the command to conflict.");
  } catch (error) {
    assertEquals(error instanceof ProjectCommandConflictError, true);
    assertEquals((error as ProjectCommandConflictError).actualRevision, 2);
  }
  assertEquals(reads, 1);
});

Deno.test("native Workbench has no nested document or direct MCP tool call", async () => {
  const main = await Deno.readTextFile(
    new URL("./src/main.ts", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertEquals(main.includes("<iframe"), false);
  assertEquals(workbench.includes("callTool("), false);
  assertEquals(workbench.includes("@modelcontextprotocol"), false);
});
