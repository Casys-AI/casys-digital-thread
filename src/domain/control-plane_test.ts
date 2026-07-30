import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import type { DockerObserver } from "../adapters/docker-observer.ts";
import type { McpProbe, McpProbeResult } from "../adapters/http-mcp-probe.ts";
import { loadRunFixtures } from "../adapters/run-fixtures.ts";
import { ControlPlane } from "./control-plane.ts";
import type { DesiredServer, FleetManifest, ObservedContainer } from "./types.ts";

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
  assertThrows(
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

function unavailableDocker(): DockerObserver {
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
