import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeMicrosandboxPreparationSessionCoordinator,
  CapabilityRuntimeMicrosandboxPreparationUnavailableError,
} from "./capability-runtime-microsandbox-preparation-session.ts";
import {
  InMemoryCapabilityRuntimeLeaseStore,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeHostLifecycle,
  ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";

const AT = "2026-08-31T00:00:00.000Z";
const PROJECT = {
  id: "snapshot:microsandbox-preparation",
  project: { id: "project:microsandbox-preparation" },
  revision: 8,
} as unknown as EngineeringProjectSnapshot;
const OPERATION = {
  id: "compile.prepare-admitted-source",
  version: "1",
} as EngineeringOperationRef;
const FINGERPRINT: ContentFingerprint = {
  algorithm: "sha256",
  digest: "a".repeat(64),
};
const MATERIAL = material("worker", "b");
const PROFILE: ContentFingerprint = {
  algorithm: "sha256",
  digest: "c".repeat(64),
};

Deno.test("Microsandbox preparation has no agent run and releases its exact cache lease after success", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const cached: unknown[] = [];
  const coordinator = preparationCoordinator({
    leases,
    cache: (input) => {
      cached.push(input);
      return Promise.resolve();
    },
  });

  const session = await coordinator.begin(beginInput());

  assertEquals("agentRuns" in PROJECT, false);
  assertEquals(cached, [{
    material: MATERIAL,
    imageReference: imageReference(MATERIAL),
    executionProfileFingerprint: PROFILE,
  }]);
  assertEquals((await leases.listActive(AT)).map((lease) => lease.id), [
    session.lease.id,
  ]);

  await session.releaseSuccess();
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("Microsandbox preparation rejects multi-binding and non-ephemeral preparation lifecycles before cache or lease", async () => {
  const cases: readonly {
    readonly name: string;
    readonly resolved: ResolvedCapabilityRuntimeOperation;
    readonly expected: string;
  }[] = [
    {
      name: "multi binding",
      resolved: {
        ...preparation(),
        bindings: [
          preparation().bindings[0]!,
          binding({ id: "other-preparation", material: material("other", "d") }),
        ],
      },
      expected: "exactly one resolved preparation binding",
    },
    {
      name: "mixed lifecycle",
      resolved: preparation({
        materials: [MATERIAL, material("persistent", "d")],
        lifecycles: [
          ephemeral(MATERIAL),
          {
            material: material("persistent", "d"),
            kind: "persistent-compose",
            launchGroup: {
              id: "casys-forbidden",
              version: "1",
              fingerprint: FINGERPRINT,
            },
          },
        ],
      }),
      expected: "only exact ephemeral Microsandbox",
    },
    {
      name: "persistent lifecycle",
      resolved: preparation({
        lifecycles: [{
          material: MATERIAL,
          kind: "persistent-compose",
          launchGroup: {
            id: "casys-forbidden",
            version: "1",
            fingerprint: FINGERPRINT,
          },
        }],
      }),
      expected: "only exact ephemeral Microsandbox",
    },
    {
      name: "cache-only lifecycle",
      resolved: preparation({
        lifecycles: [{
          material: MATERIAL,
          kind: "cache-only",
          launchGroup: null,
        }],
      }),
      expected: "only exact ephemeral Microsandbox",
    },
  ];

  for (const testCase of cases) {
    const leases = new InMemoryCapabilityRuntimeLeaseStore();
    let cacheCalls = 0;
    const coordinator = preparationCoordinator({
      leases,
      resolved: testCase.resolved,
      cache: () => {
        cacheCalls++;
        return Promise.resolve();
      },
    });

    await assertRejects(
      () => coordinator.begin(beginInput()),
      CapabilityRuntimeMicrosandboxPreparationUnavailableError,
      testCase.expected,
      testCase.name,
    );
    assertEquals(cacheCalls, 0, testCase.name);
    assertEquals(await leases.listActive(AT), [], testCase.name);
  }
});

Deno.test("Microsandbox preparation requires the exact fixed profile material attestation", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  let cacheCalls = 0;
  const coordinator = preparationCoordinator({
    leases,
    cache: () => {
      cacheCalls++;
      return Promise.resolve();
    },
  });

  await assertRejects(
    () =>
      coordinator.begin({
        ...beginInput(),
        microsandboxProfileAttestations: [{
          material: { ...MATERIAL, imageDigest: "d".repeat(64) },
          executionProfileFingerprint: PROFILE,
        }],
      }),
    CapabilityRuntimeMicrosandboxPreparationUnavailableError,
    "digest does not match",
  );
  assertEquals(cacheCalls, 0);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("a Microsandbox cache miss creates no preparation lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const coordinator = preparationCoordinator({
    leases,
    cache: () => Promise.reject(new Error("exact image is absent")),
  });

  await assertRejects(
    () => coordinator.begin(beginInput()),
    Error,
    "exact image is absent",
  );
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("Microsandbox preparation rechecks cold authority after cache before it creates a lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const current = preparation();
  const revoked = {
    ...current,
    authorizationFingerprint: {
      algorithm: "sha256" as const,
      digest: "d".repeat(64),
    },
  };
  let resolutions = 0;
  let cacheCalls = 0;
  const coordinator = preparationCoordinator({
    leases,
    resolve: () => Promise.resolve(++resolutions === 1 ? current : revoked),
    cache: () => {
      cacheCalls++;
      return Promise.resolve();
    },
  });

  await assertRejects(
    () => coordinator.begin(beginInput()),
    CapabilityRuntimeMicrosandboxPreparationUnavailableError,
    "Operational capability changed",
  );
  assertEquals(resolutions, 2);
  assertEquals(cacheCalls, 1);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("Microsandbox preparation lease is deterministic for the exact snapshot operation session key and materials", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const coordinator = preparationCoordinator({ leases });

  const first = await coordinator.begin(beginInput());
  await first.releaseSuccess();
  const second = await coordinator.begin(beginInput());

  assertEquals(second.lease.id, first.lease.id);
});

Deno.test("a concurrent live Microsandbox preparation lease is refused instead of reused", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const coordinator = preparationCoordinator({ leases });
  const first = await coordinator.begin(beginInput());

  await assertRejects(
    () => coordinator.begin(beginInput()),
    CapabilityRuntimeMicrosandboxPreparationUnavailableError,
    "live Microsandbox preparation lease",
  );
  assertEquals((await leases.listActive(AT)).map((lease) => lease.id), [
    first.lease.id,
  ]);
});

Deno.test("an expired Microsandbox preparation lease advances through an exact successor without overwriting the old lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  let now = AT;
  const coordinator = preparationCoordinator({ leases, now: () => now });
  const original = await coordinator.begin(beginInput());

  now = "2026-08-31T00:16:00.000Z";
  const successor = await coordinator.begin(beginInput());

  assertEquals(successor.lease.id === original.lease.id, false);
  assertEquals(await leases.read(original.lease.id), original.lease);
  assertEquals((await leases.listActive(now)).map((lease) => lease.id), [
    successor.lease.id,
  ]);
});

Deno.test("retaining a Microsandbox preparation leaves its exact lease for recovery", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const coordinator = preparationCoordinator({ leases });
  const session = await coordinator.begin(beginInput());

  session.retainForRecovery();
  await session.releaseSuccess();

  assertEquals((await leases.read(session.lease.id))?.id, session.lease.id);
});

Deno.test("recorded Microsandbox preparation cleanup uses its historical sealed operation after current authority is revoked", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  let cacheCalls = 0;
  let authorizationReads = 0;
  const historical = preparation();
  const coordinator = preparationCoordinator({
    leases,
    resolve: () => {
      authorizationReads++;
      return authorizationReads <= 2
        ? Promise.resolve(historical)
        : Promise.reject(new Error("preparation authority is revoked"));
    },
    cache: () => {
      cacheCalls++;
      return Promise.resolve();
    },
  });
  const session = await coordinator.begin(beginInput());

  await coordinator.releaseRecorded({
    project: PROJECT,
    operation: OPERATION,
    sessionKey: "server-preparation-1",
    operationalCapability: historical,
  });

  assertEquals(authorizationReads, 2);
  assertEquals(cacheCalls, 1);
  assertEquals(await leases.read(session.lease.id), undefined);
});

Deno.test("recorded historical cleanup does not target a current binding rollover lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const historical = preparation();
  const current = {
    ...historical,
    bindings: [{
      ...historical.bindings[0]!,
      capability: {
        ...historical.bindings[0]!.capability,
        id: "runtime.microsandbox-preparation-rollover",
      },
      binding: { id: "microsandbox-preparation-rollover", version: "1" },
    }],
  };
  const coordinator = preparationCoordinator({
    leases,
    resolved: current,
  });
  const currentSession = await coordinator.begin(beginInput());

  await coordinator.releaseRecorded({
    project: PROJECT,
    operation: OPERATION,
    sessionKey: "server-preparation-1",
    operationalCapability: historical,
  });

  assertEquals(
    (await leases.read(currentSession.lease.id))?.id,
    currentSession.lease.id,
  );
});

Deno.test("recorded cleanup fails closed for a tampered or foreign historical operation", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const historical = preparation();
  const coordinator = preparationCoordinator({ leases, resolved: historical });
  const session = await coordinator.begin(beginInput());
  const tampered = {
    ...historical,
    demandFingerprint: {
      algorithm: "sha256" as const,
      digest: "d".repeat(64),
    },
  };

  await coordinator.releaseRecorded({
    project: PROJECT,
    operation: OPERATION,
    sessionKey: "server-preparation-1",
    operationalCapability: tampered,
  });
  assertEquals((await leases.read(session.lease.id))?.id, session.lease.id);

  await assertRejects(
    () =>
      coordinator.releaseRecorded({
        project: PROJECT,
        operation: OPERATION,
        sessionKey: "server-preparation-1",
        operationalCapability: {
          ...historical,
          projectId: "project:other",
        },
      }),
    CapabilityRuntimeMicrosandboxPreparationUnavailableError,
    "does not match",
  );
  await assertRejects(
    () =>
      coordinator.releaseRecorded({
        project: PROJECT,
        operation: OPERATION,
        sessionKey: "server-preparation-1",
        operationalCapability: {
          ...historical,
          operation: { id: "compile.other-preparation", version: "1" },
        },
      }),
    CapabilityRuntimeMicrosandboxPreparationUnavailableError,
    "does not match",
  );
  assertEquals((await leases.read(session.lease.id))?.id, session.lease.id);
});

function preparationCoordinator(input: {
  readonly leases: InMemoryCapabilityRuntimeLeaseStore;
  readonly resolved?: ResolvedCapabilityRuntimeOperation;
  readonly resolve?: () => Promise<ResolvedCapabilityRuntimeOperation>;
  readonly cache?: (input: {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly imageReference: string;
    readonly executionProfileFingerprint: ContentFingerprint;
  }) => Promise<void>;
  readonly now?: () => string;
}): CapabilityRuntimeMicrosandboxPreparationSessionCoordinator {
  return new CapabilityRuntimeMicrosandboxPreparationSessionCoordinator({
    authorization: {
      requirePreparation: () =>
        input.resolve
          ? input.resolve()
          : Promise.resolve(input.resolved ?? preparation()),
    },
    contexts: {
      read: () =>
        Promise.resolve({
          catalog: {
            units: [{
              id: "casys.microsandbox-worker",
              version: "1",
              manifestFingerprint: FINGERPRINT,
              materials: [{ id: "worker", imageReference: imageReference(MATERIAL) }],
            }],
          },
        } as never),
    },
    leases: input.leases,
    microsandbox: {
      ensureExactCached: input.cache ?? (() => Promise.resolve()),
    },
    now: input.now ?? (() => AT),
  });
}

function beginInput(): {
  readonly project: EngineeringProjectSnapshot;
  readonly operation: EngineeringOperationRef;
  readonly sessionKey: string;
  readonly microsandboxProfileAttestations: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly executionProfileFingerprint: ContentFingerprint;
  }[];
} {
  return {
    project: PROJECT,
    operation: OPERATION,
    sessionKey: "server-preparation-1",
    microsandboxProfileAttestations: [{
      material: MATERIAL,
      executionProfileFingerprint: PROFILE,
    }],
  };
}

function preparation(input: {
  readonly materials?: readonly CapabilityRuntimeMaterialIdentity[];
  readonly lifecycles?: readonly CapabilityRuntimeHostLifecycle[];
} = {}): ResolvedCapabilityRuntimeOperation {
  const materials = input.materials ?? [MATERIAL];
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT.project.id,
    operation: { id: OPERATION.id, version: OPERATION.version },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [binding({
      id: "microsandbox-preparation",
      material: materials[0]!,
      materials,
      lifecycles: input.lifecycles,
    })],
  };
}

function binding(input: {
  readonly id: string;
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly materials?: readonly CapabilityRuntimeMaterialIdentity[];
  readonly lifecycles?: readonly CapabilityRuntimeHostLifecycle[];
}) {
  const materials = input.materials ?? [input.material];
  return {
    capability: {
      id: `runtime.${input.id}`,
      version: "1",
      use: "preparation" as const,
      minimumQualification: "qualified" as const,
    },
    binding: { id: input.id, version: "1" },
    effectiveQualification: "qualified" as const,
    adapter: { id: "server-owned-cache-preparation", version: "1", source: "server" },
    profile: null,
    materials,
    runtimeModes: materials.map((material) => ({
      material,
      targetPlatform: "linux/arm64" as const,
      mode: "native" as const,
      qualificationAttestationFingerprint: null,
    })),
    hostLifecycles: input.lifecycles ?? materials.map(ephemeral),
  };
}

function ephemeral(material: CapabilityRuntimeMaterialIdentity) {
  return {
    material,
    kind: "ephemeral-microsandbox" as const,
    launchGroup: null,
  };
}

function material(
  materialId: string,
  digestCharacter: string,
): CapabilityRuntimeMaterialIdentity {
  return {
    unitId: "casys.microsandbox-worker",
    materialId,
    imageDigest: digestCharacter.repeat(64),
  };
}

function imageReference(material: CapabilityRuntimeMaterialIdentity): string {
  return `example.test/${material.materialId}@sha256:${material.imageDigest}`;
}
