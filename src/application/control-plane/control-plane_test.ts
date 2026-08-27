import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { loadRunFixtures } from "../../adapters/control-plane/run-fixtures.ts";
import { ControlPlane } from "./control-plane.ts";
import type { ContainerObserver, McpProbe, McpProbeResult } from "./ports.ts";
import type { RunDetail } from "./read-model/engineering-run.ts";
import type { DesiredServer, FleetManifest } from "./read-model/fleet-manifest.ts";
import type { ObservedContainer } from "./read-model/fleet-observation.ts";

Deno.test("ControlPlane combines honest offline fleet data with labelled demo run", async () => {
  const runs = await loadRunFixtures([
    "state/fixtures/runs/bracket-demo.json",
  ]);
  const controlPlane = new ControlPlane({
    manifest: manifestFixture(),
    runs,
    probe: unavailableProbe(),
    docker: unavailableDocker(),
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    monotonicNow: increasingClock(),
  });
  const snapshot = await controlPlane.snapshot();

  assertEquals(snapshot.mode, "mixed");
  assertEquals(snapshot.generatedAt, "2026-07-30T12:00:00.000Z");
  assertEquals(snapshot.fleet.status, "unavailable");
  assertEquals(snapshot.fleet.servers[0].demo, false);
  assertEquals(snapshot.runs.items[0].id, "bracket-demo-2026-07-30");
  assertEquals(snapshot.runs.items[0].source, "demo");
  assertEquals(snapshot.fleet.servers[0].drift.status, "drift");
  const image = snapshot.fleet.servers[0].drift.fields.find((field) =>
    field.field === "image"
  );
  assertEquals(image?.status, "drift");
  assertStringIncludes(image?.message ?? "", ":latest");
});

Deno.test("ControlPlane caches probes but refresh bypasses the cache", async () => {
  const probe = new CountingProbe();
  const controlPlane = new ControlPlane({
    manifest: manifestFixture(),
    runs: [],
    probe,
    docker: unavailableDocker(),
    monotonicNow: increasingClock(),
    cacheTtlMs: 10_000,
  });

  await controlPlane.snapshot();
  await controlPlane.snapshot();
  assertEquals(probe.calls, 1);
  await controlPlane.snapshot({ refresh: true });
  assertEquals(probe.calls, 2);
});

Deno.test("ControlPlane presents timestamped evidence newest first", async () => {
  const run = (id: string, completedAt?: string): RunDetail => ({
    id,
    name: id,
    subject: "Indexed fixture",
    status: "succeeded",
    verdictStatus: "not_evaluated",
    source: "observed",
    completedAt,
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: id,
    stages: [],
    measurements: [],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [],
  });
  const controlPlane = new ControlPlane({
    manifest: manifestFixture(),
    runs: [
      run("fixture:legacy"),
      run("fixture:older", "2026-07-30T12:00:00.000Z"),
      run("fixture:newer", "2026-07-30T13:00:00.000Z"),
    ],
    probe: unavailableProbe(),
    docker: unavailableDocker(),
  });

  assertEquals((await controlPlane.runList()).map((entry) => entry.id), [
    "fixture:newer",
    "fixture:older",
    "fixture:legacy",
  ]);
});

Deno.test("ControlPlane fails clearly for unknown server and run ids", async () => {
  const controlPlane = new ControlPlane({
    manifest: manifestFixture(),
    runs: [],
    probe: unavailableProbe(),
    docker: unavailableDocker(),
  });
  await assertRejects(
    () => controlPlane.serverDetail("missing"),
    Error,
    "Unknown server id",
  );
  await assertRejects(
    () => controlPlane.runDetail("missing"),
    Error,
    "Unknown run id",
  );
});

class CountingProbe implements McpProbe {
  calls = 0;

  probe(_server: DesiredServer): Promise<McpProbeResult> {
    this.calls++;
    return Promise.resolve({
      checkedAt: "2026-07-30T12:00:00.000Z",
      status: "healthy",
      httpStatus: 200,
      mcp: {
        reachable: true,
        tools: [{ name: "test_read" }],
        resourceUris: [],
        viewerUris: [],
      },
    });
  }
}

function unavailableProbe(): McpProbe {
  return {
    probe: () =>
      Promise.resolve({
        checkedAt: "2026-07-30T12:00:00.000Z",
        status: "unavailable",
        mcp: {
          reachable: false,
          tools: [],
          resourceUris: [],
          viewerUris: [],
          error: "offline",
        },
        error: "Health probe failed: offline",
      }),
  };
}

function unavailableDocker(): ContainerObserver {
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
      image: "example.test/toolchain:latest",
      required: true,
      expectedTools: ["test_read"],
    }],
  };
}

function increasingClock(): () => number {
  let value = 0;
  return () => value++;
}
