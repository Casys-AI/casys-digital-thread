import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimePreparationSessionCoordinator,
  CapabilityRuntimePreparationUnavailableError,
} from "./capability-runtime-preparation-session.ts";
import { InMemoryCapabilityRuntimeLeaseStore } from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeLease,
  ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";

const AT = "2026-08-29T00:00:00.000Z";
const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const GROUP: CapabilityRuntimeLaunchGroupReference = {
  id: "casys-build123d-sandbox",
  version: "1.0.0",
  fingerprint: FINGERPRINT,
};
const PROJECT = {
  id: "snapshot:preparation",
  project: { id: "project:preparation" },
  revision: 4,
} as unknown as EngineeringProjectSnapshot;
const OPERATION = { id: "design.write-geometry", version: "1", bindings: [] };

Deno.test("preparation activation leases one exact Build123d group then releases it without fabricating a run", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const releases: string[] = [];
  const coordinator = new CapabilityRuntimePreparationSessionCoordinator({
    authorization: { requirePreparation: () => Promise.resolve(preparation()) },
    leases,
    groups: {
      ensureActive: async (input: {
        readonly group: CapabilityRuntimeLaunchGroupReference;
        readonly lease: CapabilityRuntimeLease;
        readonly reuseExistingLease: "allow" | "reject";
      }) => {
        assertEquals(input.reuseExistingLease, "reject");
        activations.push(input.group.id);
        await leases.claim(input.lease);
        return {
          group: input.group,
          states: new Map([[
            "casys.mcp-build123d-sandbox\u0000mcp-build123d-sandbox-image",
            {
              material: "installed",
              runtime: "active",
              qualification: "qualified",
            },
          ]]),
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: {
        readonly leaseId: string;
        readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
      }) => {
        releases.push(...input.groups.map((group) => group.id));
        await leases.release(input.leaseId);
      },
    } as never,
    now: () => AT,
  });

  const session = await coordinator.begin({ project: PROJECT, operation: OPERATION });
  const [activeLease] = await leases.listActive(AT);

  assertEquals(activations, ["casys-build123d-sandbox"]);
  assertEquals(activeLease?.projectId, PROJECT.project.id);
  assertEquals(activeLease?.expiresAt, "2026-08-29T00:15:00.000Z");
  assertEquals((await leases.listActive(AT)).length, 1);
  assertEquals("agentRuns" in PROJECT, false);

  await session.releaseSuccess();
  assertEquals(releases, ["casys-build123d-sandbox"]);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("preparation cleanup asks the host-wide JIT reader before stopping a shared group", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  let stopped = false;
  let globalReads = 0;
  const coordinator = new CapabilityRuntimePreparationSessionCoordinator({
    authorization: { requirePreparation: () => Promise.resolve(preparation()) },
    leases,
    groups: {
      ensureActive: async (input: { readonly lease: CapabilityRuntimeLease }) => {
        const claim = await leases.claim(input.lease);
        return {
          group: GROUP,
          states: new Map([[
            "casys.mcp-build123d-sandbox\u0000mcp-build123d-sandbox-image",
            { material: "installed" as const, runtime: "active" as const },
          ]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: {
        readonly leaseId: string;
        readonly hasRemainingJitDemand: (
          materialKeys: readonly string[],
        ) => Promise<boolean>;
      }) => {
        stopped = !await input.hasRemainingJitDemand([
          "casys.mcp-build123d-sandbox\u0000mcp-build123d-sandbox-image",
        ]);
        await leases.release(input.leaseId);
      },
    } as never,
    hasAnyRemainingJitDemand: {
      hasAnyRemainingDemand: () => {
        globalReads++;
        return Promise.resolve(true);
      },
    },
    now: () => AT,
  });

  const session = await coordinator.begin({ project: PROJECT, operation: OPERATION });
  await session.releaseSuccess();

  assertEquals(stopped, false);
  assertEquals(globalReads, 1);
});

Deno.test("preparation refuses a non-preparation or mixed resolved operation before host activation", async () => {
  let activations = 0;
  const coordinator = new CapabilityRuntimePreparationSessionCoordinator({
    authorization: {
      requirePreparation: () =>
        Promise.resolve({
          ...preparation(),
          bindings: [{
            ...preparation().bindings[0]!,
            capability: {
              ...preparation().bindings[0]!.capability,
              use: "execution" as const,
            },
          }],
        }),
    },
    leases: new InMemoryCapabilityRuntimeLeaseStore(),
    groups: {
      ensureActive: () => {
        activations++;
        return Promise.reject(new Error());
      },
    } as never,
    now: () => AT,
  });

  await assertRejects(
    () => coordinator.begin({ project: PROJECT, operation: OPERATION }),
    CapabilityRuntimePreparationUnavailableError,
    "exactly one resolved preparation binding",
  );
  assertEquals(activations, 0);
});

Deno.test("an interrupted pre-dispatch preparation reuses its exact live lease or creates a linked successor after expiry", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  let now = AT;
  const reuse: ("allow" | "reject")[] = [];
  const coordinator = preparationCoordinator(leases, () => now, reuse);

  await coordinator.begin({ project: PROJECT, operation: OPERATION });
  const [originalLease] = await leases.listActive(now);
  now = "2026-08-29T00:05:00.000Z";
  await coordinator.begin({ project: PROJECT, operation: OPERATION });
  const [resumedLease] = await leases.listActive(now);
  assertEquals(resumedLease?.id, originalLease?.id);
  assertEquals(reuse, ["reject", "allow"]);

  now = "2026-08-29T00:16:00.000Z";
  const renewed = await coordinator.begin({ project: PROJECT, operation: OPERATION });
  const [renewedLease] = await leases.listActive(now);
  assertEquals(renewedLease?.id === originalLease?.id, false);
  assertEquals(reuse, ["reject", "allow", "reject"]);
  assertEquals(await leases.read(originalLease!.id), originalLease);

  await renewed.releaseSuccess();
  assertEquals(await leases.listActive(now), []);
});

Deno.test("recorded replay cleanup releases only its exact extant lease without a new activation", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const reuse: ("allow" | "reject")[] = [];
  const coordinator = preparationCoordinator(leases, () => AT, reuse);
  await coordinator.begin({ project: PROJECT, operation: OPERATION });
  const [activeLease] = await leases.listActive(AT);

  await coordinator.releaseRecorded({ project: PROJECT, operation: OPERATION });

  assertEquals(reuse, ["reject"]);
  assertEquals(await leases.read(activeLease!.id), undefined);
});

function preparationCoordinator(
  leases: InMemoryCapabilityRuntimeLeaseStore,
  now: () => string,
  reuse: ("allow" | "reject")[],
): CapabilityRuntimePreparationSessionCoordinator {
  return new CapabilityRuntimePreparationSessionCoordinator({
    authorization: { requirePreparation: () => Promise.resolve(preparation()) },
    leases,
    groups: {
      ensureActive: async (input: {
        readonly group: CapabilityRuntimeLaunchGroupReference;
        readonly lease: CapabilityRuntimeLease;
        readonly reuseExistingLease: "allow" | "reject";
      }) => {
        reuse.push(input.reuseExistingLease);
        await leases.claim(input.lease);
        return {
          group: input.group,
          states: new Map([[
            "casys.mcp-build123d-sandbox\u0000mcp-build123d-sandbox-image",
            {
              material: "installed",
              runtime: "active",
              qualification: "qualified",
            },
          ]]),
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: { readonly leaseId: string }) => {
        await leases.release(input.leaseId);
      },
    } as never,
    now,
  });
}

function preparation(): ResolvedCapabilityRuntimeOperation {
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT.project.id,
    operation: { id: OPERATION.id, version: OPERATION.version },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [{
      capability: {
        id: "geometry.export-admitted-source",
        version: "1",
        use: "preparation",
        minimumQualification: "qualified",
      },
      binding: { id: "build123d-export-admitted-source", version: "1" },
      effectiveQualification: "qualified",
      adapter: { id: "build123d-export", version: "1", source: "server" },
      profile: null,
      materials: [{
        unitId: "casys.mcp-build123d-sandbox",
        materialId: "mcp-build123d-sandbox-image",
        imageDigest: "b".repeat(64),
      }],
      runtimeModes: [{
        material: {
          unitId: "casys.mcp-build123d-sandbox",
          materialId: "mcp-build123d-sandbox-image",
          imageDigest: "b".repeat(64),
        },
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material: {
          unitId: "casys.mcp-build123d-sandbox",
          materialId: "mcp-build123d-sandbox-image",
          imageDigest: "b".repeat(64),
        },
        kind: "persistent-compose",
        launchGroup: GROUP,
      }],
    }],
  };
}
