import { assertEquals } from "@std/assert";
import { CapabilityRuntimePreloadScheduler } from "./capability-runtime-preload-scheduler.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("preload deduplicates the approved persistent launch group and never activates it", async () => {
  const calls: unknown[] = [];
  const scheduler = new CapabilityRuntimePreloadScheduler({
    host: {
      ensureMaterial: (input: unknown) => {
        calls.push(input);
        return Promise.resolve({} as never);
      },
    } as never,
    now: () => "2026-08-29T00:00:00.000Z",
  });
  const group = { id: "casys-syson", version: "1.0.0", fingerprint: FINGERPRINT };

  scheduler.schedule({
    projectId: "project:preload",
    status: "ready",
    activation: "allowed",
    units: [{
      id: "casys.syson-stack",
      version: "1",
      manifestFingerprint: FINGERPRINT,
      materials: [
        { id: "db", lifecycle: "persistent", launchGroup: group },
        { id: "app", lifecycle: "persistent", launchGroup: group },
        { id: "mcp", lifecycle: "persistent", launchGroup: group },
        { id: "calculix", lifecycle: "ephemeral", launchGroup: null },
      ],
    }],
  } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(calls, [{
    group,
    projectId: "project:preload",
    at: "2026-08-29T00:00:00.000Z",
  }]);
});

Deno.test("preload does nothing without a durable activatable proposal", async () => {
  let calls = 0;
  const scheduler = new CapabilityRuntimePreloadScheduler({
    host: {
      ensureMaterial: () => {
        calls++;
        return Promise.resolve({} as never);
      },
    } as never,
  });
  scheduler.schedule(
    { status: "unresolved", activation: "blocked", units: [] } as never,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(calls, 0);
});
