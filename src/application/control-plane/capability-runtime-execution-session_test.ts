import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "./capability-runtime-execution-session.ts";
import {
  InMemoryCapabilityRuntimeLeaseStore,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type { ProjectCapabilityRuntimeContextReader } from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../domain/capability/runtime/capability-runtime-supervision.ts";

const DIGEST = "a".repeat(64);
const FINGERPRINT = { algorithm: "sha256" as const, digest: "b".repeat(64) };
const PROJECT_ID = "project:jit";
const AT = "2026-08-29T00:00:00.000Z";

Deno.test("JIT cache-only session keeps the material cached, never active, and releases only terminally", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const cacheCalls: string[] = [];
  const capability = operation("cache-only");
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("cache"),
    leases,
    cache: {
      ensureExactCached: ({ imageReference }) => {
        cacheCalls.push(imageReference);
        return Promise.resolve();
      },
    },
    now: () => AT,
  });

  const session = await coordinator.begin({
    project: projectFor("run:cache", "queued"),
    runId: "run:cache",
    operationalCapability: capability,
    executionProfileFingerprint: FINGERPRINT,
    recheck: () => Promise.resolve(capability),
  });

  assertEquals(cacheCalls, [`example.test/worker@sha256:${DIGEST}`]);
  assertEquals((await leases.listActive(AT)).length, 1);
  await session.releaseTerminal();
  assertEquals((await leases.listActive(AT)).length, 0);
});

Deno.test("JIT observes cache before a direct lease claim and rejects a concurrent queued claimant", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("ephemeral-microsandbox");
  let cacheCalls = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("ephemeral"),
    leases,
    microsandbox: {
      ensureExactCached: () => {
        cacheCalls++;
        return Promise.resolve();
      },
    },
    now: () => AT,
  });
  const input = {
    project: projectFor("run:micro", "queued"),
    runId: "run:micro",
    operationalCapability: capability,
    executionProfileFingerprint: FINGERPRINT,
    recheck: () => Promise.resolve(capability),
  };
  const first = await coordinator.begin(input);
  await assertRejects(
    () => coordinator.begin(input),
    CapabilityRuntimeSessionUnavailableError,
    "queued",
  );
  assertEquals((await leases.listActive(AT)).length, 1);
  assertEquals(cacheCalls, 2);
  await first.releaseTerminal();
  assertEquals((await leases.listActive(AT)).length, 0);
});

Deno.test("JIT cache attestation failure creates no direct lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("ephemeral-microsandbox");
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("ephemeral"),
    leases,
    microsandbox: {
      ensureExactCached: () => Promise.reject(new Error("cache not attested")),
    },
    now: () => AT,
  });

  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor("run:cache-miss", "queued"),
        runId: "run:cache-miss",
        operationalCapability: capability,
        executionProfileFingerprint: FINGERPRINT,
        recheck: () => Promise.resolve(capability),
      }),
    Error,
    "cache not attested",
  );
  assertEquals((await leases.listActive(AT)).length, 0);
});

Deno.test("JIT recheck mismatch blocks before lease, cache observation, WAL or provider seams", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("ephemeral-microsandbox");
  let cacheCalls = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("ephemeral"),
    leases,
    microsandbox: {
      ensureExactCached: () => {
        cacheCalls++;
        return Promise.resolve();
      },
    },
    now: () => AT,
  });

  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor("run:changed", "queued"),
        runId: "run:changed",
        operationalCapability: capability,
        executionProfileFingerprint: FINGERPRINT,
        recheck: () =>
          Promise.resolve({
            ...capability,
            authorizationFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
          }),
      }),
    CapabilityRuntimeSessionUnavailableError,
    "changed",
  );
  assertEquals(cacheCalls, 0);
  assertEquals((await leases.listActive(AT)).length, 0);
});

Deno.test("JIT rejects a sealed lifecycle or digest mismatch before cache observation", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("ephemeral-microsandbox");
  let cacheCalls = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("ephemeral", "b".repeat(64)),
    leases,
    microsandbox: {
      ensureExactCached: () => {
        cacheCalls++;
        return Promise.resolve();
      },
    },
    now: () => AT,
  });
  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor("run:digest", "queued"),
        runId: "run:digest",
        operationalCapability: capability,
        executionProfileFingerprint: FINGERPRINT,
        recheck: () => Promise.resolve(capability),
      }),
    CapabilityRuntimeSessionUnavailableError,
    "sealed digest",
  );
  assertEquals(cacheCalls, 0);
  assertEquals((await leases.listActive(AT)).length, 0);
});

Deno.test("JIT recovery refuses an expired deterministic lease instead of silently replacing it", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("ephemeral-microsandbox");
  let now = AT;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("ephemeral"),
    leases,
    microsandbox: { ensureExactCached: () => Promise.resolve() },
    now: () => now,
  });
  await coordinator.begin({
    project: projectFor("run:expired", "queued"),
    runId: "run:expired",
    operationalCapability: capability,
    executionProfileFingerprint: FINGERPRINT,
    recheck: () => Promise.resolve(capability),
  });
  now = "2026-08-29T07:00:00.000Z";
  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor("run:expired", "running"),
        runId: "run:expired",
        operationalCapability: capability,
        executionProfileFingerprint: FINGERPRINT,
        recheck: () => Promise.resolve(capability),
      }),
    CapabilityRuntimeSessionUnavailableError,
    "expired",
  );
});

Deno.test("JIT Compose delegates the only lease acquire/start to H1 and rejects no active state", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("persistent-compose");
  let activeCalls = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("persistent"),
    leases,
    compose: {
      ensureActive: () => {
        activeCalls++;
        return Promise.resolve({
          profile: { id: "profile:worker", version: "1", fingerprint: FINGERPRINT },
          state: {
            material: "installed",
            runtime: "active",
            qualification: "qualified",
          },
          mutation: undefined,
        });
      },
      releaseLease: () =>
        Promise.resolve({
          remainingLeaseCount: 0,
          deactivation: undefined,
        }),
    } as never,
    now: () => AT,
  });
  const session = await coordinator.begin({
    project: projectFor("run:compose", "queued"),
    runId: "run:compose",
    operationalCapability: capability,
    executionProfileFingerprint: FINGERPRINT,
    recheck: () => Promise.resolve(capability),
  });

  assertEquals(activeCalls, 1);
  // The fake H1 did not acquire. The coordinator itself must not create a
  // duplicate Compose lease; production H1 is the single owner.
  assertEquals((await leases.listActive(AT)).length, 0);
  await session.releaseTerminal();
});

Deno.test("terminal host cleanup is idempotent and keeps reconciliation out of an already persisted result", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const capability = operation("persistent-compose");
  let releases = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor("persistent"),
    leases,
    compose: {
      ensureActive: () =>
        Promise.resolve({
          profile: { id: "profile:worker", version: "1", fingerprint: FINGERPRINT },
          state: {
            material: "installed",
            runtime: "active",
            qualification: "qualified",
          },
          mutation: undefined,
        }),
      releaseLease: () => {
        releases++;
        return Promise.reject(new Error("host cleanup interrupted"));
      },
    } as never,
    now: () => AT,
  });
  const session = await coordinator.begin({
    project: projectFor("run:cleanup", "queued"),
    runId: "run:cleanup",
    operationalCapability: capability,
    executionProfileFingerprint: FINGERPRINT,
    recheck: () => Promise.resolve(capability),
  });

  await session.releaseTerminal();
  await session.releaseTerminal();
  assertEquals(releases, 1);
});

function operation(
  lifecycle: "persistent-compose" | "ephemeral-microsandbox" | "cache-only",
): ResolvedCapabilityRuntimeOperation {
  const material = {
    unitId: "casys.worker",
    materialId: "worker",
    imageDigest: DIGEST,
  };
  return {
    schemaVersion: "resolved-capability-runtime-operation/1.0",
    projectId: PROJECT_ID,
    operation: { id: "verify.worker", version: "1" },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [{
      capability: {
        id: "worker.execute",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "worker", version: "1" },
      adapter: { id: "worker", version: "1", source: "server" },
      profile: null,
      materials: [material],
      hostLifecycles: [hostLifecycle(material, lifecycle)],
    }],
  };
}

function hostLifecycle(
  material: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
  lifecycle: "persistent-compose" | "ephemeral-microsandbox" | "cache-only",
) {
  if (lifecycle === "persistent-compose") {
    return {
      material,
      kind: "persistent-compose" as const,
      launchProfile: { id: "profile:worker", version: "1", fingerprint: FINGERPRINT },
    };
  }
  return { material, kind: lifecycle, launchProfile: null } as const;
}

function contextFor(
  lifecycle: "persistent" | "ephemeral" | "cache",
  imageDigest = DIGEST,
): ProjectCapabilityRuntimeContextReader {
  return {
    read: () =>
      Promise.resolve({
        catalog: {
          units: [{
            id: "casys.worker",
            version: "1",
            manifestFingerprint: FINGERPRINT,
            materials: [{
              id: "worker",
              imageReference: `example.test/worker@sha256:${imageDigest}`,
              lifecycle,
            }],
          }],
          bindings: [{
            id: "worker",
            version: "1",
            qualification: "qualified",
            unitIds: ["casys.worker"],
          }],
        },
      } as never),
  };
}

function projectFor(
  runId: string,
  status: "queued" | "running" | "publishing",
): EngineeringProjectSnapshot {
  return {
    id: "snapshot:jit",
    project: { id: PROJECT_ID },
    revision: 1,
    agentRuns: [{ id: runId, status }],
  } as unknown as EngineeringProjectSnapshot;
}
