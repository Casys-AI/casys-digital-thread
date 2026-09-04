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

Deno.test("cache preload is best-effort and leaves the persistent Compose path unchanged", async () => {
  const persistent: unknown[] = [];
  const cache: unknown[] = [];
  const failures: unknown[] = [];
  const scheduler = new CapabilityRuntimePreloadScheduler({
    host: {
      ensureMaterial: (input: unknown) => {
        persistent.push(input);
        return Promise.resolve({} as never);
      },
    } as never,
    cachePreparer: {
      prepare: (input: unknown) => {
        cache.push(input);
        return Promise.reject(new Error("cache preparation unavailable"));
      },
    } as never,
    onCachePreparationError: (input) => failures.push(input),
    now: () => "2026-08-29T00:00:00.000Z",
  });
  const group = { id: "casys-syson", version: "1.0.0", fingerprint: FINGERPRINT };

  scheduler.schedule({
    projectId: "project:preload",
    status: "ready",
    activation: "allowed",
    units: [{
      id: "casys.cache-preload",
      version: "1",
      manifestFingerprint: FINGERPRINT,
      materials: [
        {
          id: "service",
          lifecycle: "persistent",
          launchGroup: group,
          imageReference: `example.test/service@sha256:${"a".repeat(64)}`,
        },
        {
          id: "worker",
          lifecycle: "ephemeral",
          launchGroup: null,
          imageReference: `example.test/worker@sha256:${"b".repeat(64)}`,
        },
        {
          id: "docker-source",
          lifecycle: "cache",
          launchGroup: null,
          imageReference: `example.test/source@sha256:${"c".repeat(64)}`,
        },
      ],
    }],
  } as never, () => Promise.resolve(true));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(persistent.length, 1);
  assertEquals((persistent[0] as { group: unknown }).group, group);
  const request = cache[0] as {
    projectId: string;
    materials: unknown;
    guard: () => Promise<boolean>;
  };
  assertEquals(request.projectId, "project:preload");
  assertEquals(request.materials, [{
    material: {
      unitId: "casys.cache-preload",
      materialId: "worker",
      imageDigest: "b".repeat(64),
    },
    imageReference: `example.test/worker@sha256:${"b".repeat(64)}`,
    lifecycle: "ephemeral",
  }]);
  assertEquals(await request.guard(), true);
  assertEquals(failures.length, 1);
});

Deno.test("cache preload is skipped and reported when no production authorization recheck exists", async () => {
  let cacheCalls = 0;
  const failures: unknown[] = [];
  const scheduler = new CapabilityRuntimePreloadScheduler({
    host: { ensureMaterial: () => Promise.resolve({} as never) } as never,
    cachePreparer: {
      prepare: () => {
        cacheCalls++;
        return Promise.resolve([]);
      },
    } as never,
    onCachePreparationError: (input) => failures.push(input),
  });

  scheduler.schedule({
    projectId: "project:preload",
    status: "ready",
    activation: "allowed",
    units: [{
      id: "casys.cache-preload",
      version: "1",
      manifestFingerprint: FINGERPRINT,
      materials: [{
        id: "worker",
        lifecycle: "ephemeral",
        launchGroup: null,
        imageReference: `example.test/worker@sha256:${"b".repeat(64)}`,
      }],
    }],
  } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(cacheCalls, 0);
  assertEquals(failures.length, 1);
});
