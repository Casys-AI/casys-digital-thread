import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeExecutionSessionCoordinator,
} from "./capability-runtime-execution-session.ts";
import {
  InMemoryCapabilityRuntimeLeaseStore,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeLease,
  CapabilityRuntimeMaterialIdentity,
  ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";

const AT = "2026-08-29T00:00:00.000Z";
const PROJECT_ID = "project:session";
const FINGERPRINT = { algorithm: "sha256" as const, digest: "f".repeat(64) };

Deno.test("JIT session deduplicates persistent group activation, preserves one lease, and separately attests its microVM", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const alpha = launchGroup("casys-alpha");
  const bravo = launchGroup("casys-bravo");
  const operation = operationFor(alpha, bravo);
  const activation: {
    readonly groupId: string;
    readonly reuseExistingLease: "allow" | "reject";
  }[] = [];
  const released: string[][] = [];
  const cached: string[] = [];
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: {
        readonly group: CapabilityRuntimeLaunchGroupReference;
        readonly lease: CapabilityRuntimeLease;
        readonly reuseExistingLease: "allow" | "reject";
      }) => {
        const claim = await leases.claim(input.lease);
        activation.push({
          groupId: input.group.id,
          reuseExistingLease: input.reuseExistingLease,
        });
        return {
          group: input.group,
          states: new Map([[input.group.id, {
            material: "installed" as const,
            runtime: "active" as const,
          }]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: {
        readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
        readonly leaseId: string;
      }) => {
        released.push(input.groups.map((group) => group.id));
        await leases.release(input.leaseId);
      },
    } as never,
    microsandbox: {
      ensureExactCached: ({ imageReference }) => {
        cached.push(imageReference);
        return Promise.resolve();
      },
    },
    hasRemainingJitDemand: () => Promise.resolve(false),
    now: () => AT,
  });

  const session = await coordinator.begin({
    project: projectFor(),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [{
      material: microMaterial(),
      executionProfileFingerprint: FINGERPRINT,
    }],
    recheck: () => Promise.resolve(operation),
  });

  assertEquals(activation, [
    { groupId: "casys-alpha", reuseExistingLease: "reject" },
    { groupId: "casys-bravo", reuseExistingLease: "allow" },
  ]);
  assertEquals(cached, [`example.test/calculix@sha256:${microMaterial().imageDigest}`]);
  assertEquals((await leases.listActive(AT)).length, 1);

  await session.releaseTerminal();
  assertEquals(released, [["casys-alpha", "casys-bravo"]]);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("JIT session rechecks inside group activation before a revoked capability can claim a lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const alpha = launchGroup("casys-alpha");
  const bravo = launchGroup("casys-bravo");
  const operation = operationFor(alpha, bravo);
  const changed = {
    ...operation,
    authorizationFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  };
  let rechecks = 0;
  let hostMutations = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: {
        readonly lease: CapabilityRuntimeLease;
        readonly guard?: () => Promise<boolean>;
      }) => {
        if (input.guard && !(await input.guard())) {
          throw new Error("activation is no longer authorized");
        }
        hostMutations++;
        const claim = await leases.claim(input.lease);
        return {
          group: alpha,
          states: new Map([[alpha.id, {
            material: "installed" as const,
            runtime: "active" as const,
          }]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: () => Promise.resolve(),
    } as never,
    microsandbox: { ensureExactCached: () => Promise.resolve() },
    now: () => AT,
  });

  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor(),
        runId: "run:session",
        operationalCapability: operation,
        microsandboxExecutionProfiles: [{
          material: microMaterial(),
          executionProfileFingerprint: FINGERPRINT,
        }],
        // The first recheck is the outer cold gate. The revoke happens before
        // H1 invokes the guarded activation callback.
        recheck: () => Promise.resolve(++rechecks === 1 ? operation : changed),
      }),
    Error,
    "authorized",
  );
  assertEquals(hostMutations, 0);
  assertEquals(await leases.listActive(AT), []);
});

function launchGroup(id: string): CapabilityRuntimeLaunchGroupReference {
  return { id, version: "1.0.0", fingerprint: FINGERPRINT };
}

function persistentMaterial(
  unitId: string,
  materialId: string,
  imageDigest: string,
): CapabilityRuntimeMaterialIdentity {
  return { unitId, materialId, imageDigest };
}

function microMaterial(): CapabilityRuntimeMaterialIdentity {
  return persistentMaterial("casys.calculix-worker", "worker", "d".repeat(64));
}

function operationFor(
  alpha: CapabilityRuntimeLaunchGroupReference,
  bravo: CapabilityRuntimeLaunchGroupReference,
): ResolvedCapabilityRuntimeOperation {
  const alphaDb = persistentMaterial("casys.alpha", "db", "a".repeat(64));
  const alphaApp = persistentMaterial("casys.alpha", "app", "b".repeat(64));
  const bravoWorker = persistentMaterial("casys.bravo", "worker", "c".repeat(64));
  const micro = microMaterial();
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT_ID,
    operation: { id: "verify.session", version: "1" },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [
      persistentBinding("alpha-db", alphaDb, alpha),
      persistentBinding("alpha-app", alphaApp, alpha),
      persistentBinding("bravo-worker", bravoWorker, bravo),
      {
        capability: {
          id: "mechanics.static-fea",
          version: "1",
          use: "execution",
          minimumQualification: "qualified",
        },
        binding: { id: "calculix-worker", version: "1" },
        effectiveQualification: "qualified" as const,
        adapter: { id: "calculix-worker", version: "1", source: "server" },
        profile: null,
        materials: [micro],
        runtimeModes: [runtimeMode(micro)],
        hostLifecycles: [{
          material: micro,
          kind: "ephemeral-microsandbox",
          launchGroup: null,
        }],
      },
    ],
  };
}

function persistentBinding(
  id: string,
  material: CapabilityRuntimeMaterialIdentity,
  launchGroup: CapabilityRuntimeLaunchGroupReference,
) {
  return {
    capability: {
      id: `runtime.${id}`,
      version: "1",
      use: "execution" as const,
      minimumQualification: "qualified" as const,
    },
    binding: { id, version: "1" },
    effectiveQualification: "qualified" as const,
    adapter: { id, version: "1", source: "server" },
    profile: null,
    materials: [material],
    runtimeModes: [runtimeMode(material)],
    hostLifecycles: [{ material, kind: "persistent-compose" as const, launchGroup }],
  };
}

function runtimeMode(material: CapabilityRuntimeMaterialIdentity) {
  return {
    material,
    targetPlatform: "linux/arm64" as const,
    mode: "native" as const,
    qualificationAttestationFingerprint: null,
  };
}

function contextFor(): ProjectCapabilityRuntimeContextReader {
  return {
    read: () =>
      Promise.resolve({
        catalog: {
          units: [{
            id: "casys.calculix-worker",
            version: "1",
            manifestFingerprint: FINGERPRINT,
            materials: [{
              id: "worker",
              imageReference:
                `example.test/calculix@sha256:${microMaterial().imageDigest}`,
            }],
          }],
        },
      } as never),
  };
}

function projectFor(): EngineeringProjectSnapshot {
  return {
    id: "snapshot:session",
    project: { id: PROJECT_ID },
    revision: 1,
    agentRuns: [{ id: "run:session", status: "queued" }],
  } as unknown as EngineeringProjectSnapshot;
}
