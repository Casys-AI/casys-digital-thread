import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  createThreadWorkbenchClient,
  HttpThreadWorkbenchClient,
} from "./src/thread/client.ts";
import { COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE } from "./src/project/fixture.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import {
  isEngineeringWorkbenchSnapshot,
  isThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("native Workbench fallback is an explicitly labelled product fixture", async () => {
  const client = createThreadWorkbenchClient();
  const workbench = await client.load();
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

Deno.test("HTTP Workbench client performs one read-only JSON GET", async () => {
  const requests: Array<{ input: string; method?: string }> = [];
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    (input, init) => {
      requests.push({ input: String(input), method: init?.method });
      return Promise.resolve(
        Response.json(COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE),
      );
    },
  );

  const snapshot = await client.load();

  assertEquals(snapshot.thread.id, COFFEE_MACHINE_THREAD_FIXTURE.id);
  assertEquals(
    snapshot.project.project.subjectId,
    COFFEE_MACHINE_THREAD_FIXTURE.subject.id,
  );
  assertEquals(requests, [
    { input: "/api/thread/workbench", method: "GET" },
  ]);
});

Deno.test("HTTP Workbench client rejects an unsupported contract", async () => {
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json({ schemaVersion: "unknown" })),
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
