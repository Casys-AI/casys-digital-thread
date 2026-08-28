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

  assertEquals(activations, ["casys-build123d-sandbox"]);
  assertEquals(session.lease.projectId, PROJECT.project.id);
  assertEquals(session.lease.expiresAt, "2026-08-29T00:15:00.000Z");
  assertEquals((await leases.listActive(AT)).length, 1);
  assertEquals("agentRuns" in PROJECT, false);

  await session.releaseSuccess();
  assertEquals(releases, ["casys-build123d-sandbox"]);
  assertEquals(await leases.listActive(AT), []);
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

function preparation(): ResolvedCapabilityRuntimeOperation {
  return {
    schemaVersion: "resolved-capability-runtime-operation/1.0",
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
      adapter: { id: "build123d-export", version: "1", source: "server" },
      profile: null,
      materials: [{
        unitId: "casys.mcp-build123d-sandbox",
        materialId: "mcp-build123d-sandbox-image",
        imageDigest: "b".repeat(64),
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
