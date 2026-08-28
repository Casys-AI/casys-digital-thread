import { assertEquals } from "@std/assert";
import { CapabilityRuntimePreloadScheduler } from "./capability-runtime-preload-scheduler.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("preload only ensures enrolled persistent material and never activates or rolls back a brief", async () => {
  const materialCalls: unknown[] = [];
  const scheduler = new CapabilityRuntimePreloadScheduler({
    host: {
      ensureMaterial: (input: {
        readonly profile: unknown;
        readonly projectId: string | null;
        readonly at: string;
      }) => {
        materialCalls.push(input);
        return Promise.resolve({} as never);
      },
    } as never,
    now: () => "2026-08-29T00:00:00.000Z",
  });

  scheduler.schedule({
    projectId: "project:preload",
    status: "ready",
    activation: "ready",
    units: [{
      id: "casys.syson-stack",
      version: "1",
      manifestFingerprint: FINGERPRINT,
      materials: [{
        id: "syson",
        lifecycle: "persistent",
        launchProfile: { id: "profile:syson", version: "1", fingerprint: FINGERPRINT },
      }, {
        id: "calculix",
        lifecycle: "ephemeral",
        launchProfile: null,
      }, {
        id: "spice-cache",
        lifecycle: "cache",
        launchProfile: null,
      }],
    }],
  } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(materialCalls, [{
    profile: { id: "profile:syson", version: "1", fingerprint: FINGERPRINT },
    projectId: "project:preload",
    at: "2026-08-29T00:00:00.000Z",
  }]);
});

Deno.test("preload does nothing when activation is unavailable and never compensates authorization", async () => {
  let calls = 0;
  const scheduler = new CapabilityRuntimePreloadScheduler({
    host: {
      ensureMaterial: () => {
        calls++;
        return Promise.resolve({} as never);
      },
    } as never,
  });
  scheduler.schedule({ status: "ready", activation: "blocked", units: [] } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(calls, 0);
});
