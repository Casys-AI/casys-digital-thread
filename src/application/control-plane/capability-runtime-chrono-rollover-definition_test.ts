import { assertEquals, assertThrows } from "@std/assert";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartyChronoRolloverPredecessorUnit,
} from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroupRegistry,
  createFirstPartyChronoRolloverPredecessorLaunchGroup,
  firstPartyChronoLaunchGroupReference,
} from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  assertChronoRolloverIdentityMatchesDefinition,
  assertClosedChronoRolloverDefinition,
  type CapabilityRuntimeChronoRolloverDefinition,
  CapabilityRuntimeChronoRolloverError,
  CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
  chronoRolloverIdentityFor,
} from "./capability-runtime-chrono-rollover-definition.ts";

Deno.test("Chrono rollover definition keeps 0.3.1 history-only and rejects topology drift", async () => {
  const closed = await closedDefinition();
  assertClosedChronoRolloverDefinition(closed);
  assertEquals(
    closed.catalog.units.some((unit) =>
      unit.id === closed.predecessor.unit.id &&
      unit.version === closed.predecessor.unit.version
    ),
    false,
  );
  assertEquals(closed.predecessor.launchGroup.id, "casys-chrono");
  assertEquals(closed.predecessor.launchGroup.version, "1.0.0");
  assertEquals(closed.successor.launchGroup.version, "1.0.0");
  const identity = chronoRolloverIdentityFor(closed, "2026-08-31T12:00:00.000Z");
  assertEquals(identity.transitionId, CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID);
  assertEquals(identity.affectedProjects, []);
  assertEquals(identity.preserved.volumes, [{
    id: "chrono-data",
    action: "preserve",
  }]);
  assertChronoRolloverIdentityMatchesDefinition(identity, closed);
  assertThrows(
    () =>
      assertChronoRolloverIdentityMatchesDefinition({
        ...identity,
        affectedProjects: [{
          projectId: "forged",
          ledgerRevision: 1,
          ledgerFingerprint: identity.predecessor.unit.manifestFingerprint,
          proposalFingerprint: identity.successor.unit.manifestFingerprint,
        }],
      }, closed),
    CapabilityRuntimeChronoRolloverError,
    "host-only",
  );

  assertThrows(
    () =>
      assertClosedChronoRolloverDefinition({
        ...closed,
        catalog: {
          ...closed.catalog,
          units: [...closed.catalog.units, closed.predecessor.unit],
        },
      }),
    CapabilityRuntimeChronoRolloverError,
    "predecessor and successor identities",
  );

  const forgedImage = await withChronoImage(
    closed.successor.launchGroup,
    "ghcr.io/casys-ai/mcp-chrono@sha256:" + "a".repeat(64),
  );
  assertThrows(
    () =>
      assertClosedChronoRolloverDefinition({
        ...closed,
        successor: { ...closed.successor, launchGroup: forgedImage },
      }),
    CapabilityRuntimeChronoRolloverError,
    "image identities",
  );

  const forgedPort = await withChronoCompose(
    closed.successor.launchGroup,
    (compose) => {
      compose.services["mcp-chrono"]!.ports = ["127.0.0.1:3999:3025"];
    },
  );
  assertThrows(
    () =>
      assertClosedChronoRolloverDefinition({
        ...closed,
        successor: { ...closed.successor, launchGroup: forgedPort },
      }),
    CapabilityRuntimeChronoRolloverError,
    "outside mcp-chrono image identity",
  );

  const forgedVolume = await withChronoCompose(
    closed.successor.launchGroup,
    (compose) => {
      compose.services["mcp-chrono"]!.volumes = ["chrono-scratch:/data"];
      compose.volumes = { "chrono-scratch": {} };
    },
  );
  assertThrows(
    () =>
      assertClosedChronoRolloverDefinition({
        ...closed,
        successor: { ...closed.successor, launchGroup: forgedVolume },
      }),
    CapabilityRuntimeChronoRolloverError,
    "outside mcp-chrono image identity",
  );

  const { fingerprint: _secretFingerprint, ...secretBody } = closed.successor
    .launchGroup;
  const forgedSecret = {
    ...secretBody,
    secretSlots: ["forged-chrono-token"],
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup({
      ...secretBody,
      secretSlots: ["forged-chrono-token"],
    }),
  };
  assertThrows(
    () =>
      assertClosedChronoRolloverDefinition({
        ...closed,
        successor: { ...closed.successor, launchGroup: forgedSecret },
      }),
    CapabilityRuntimeChronoRolloverError,
    "outside mcp-chrono image identity",
  );

  const { fingerprint: _groupFingerprint, ...groupBody } = closed.successor.launchGroup;
  const forgedGroup = {
    ...groupBody,
    id: "casys-chrono-forged",
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup({
      ...groupBody,
      id: "casys-chrono-forged",
    }),
  };
  assertThrows(
    () =>
      assertClosedChronoRolloverDefinition({
        ...closed,
        successor: { ...closed.successor, launchGroup: forgedGroup },
      }),
    CapabilityRuntimeChronoRolloverError,
    "predecessor and successor identities",
  );
});

async function closedDefinition(): Promise<CapabilityRuntimeChronoRolloverDefinition> {
  const [catalog, predecessorUnit, predecessorGroup, registry] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartyChronoRolloverPredecessorUnit(),
    createFirstPartyChronoRolloverPredecessorLaunchGroup(),
    createFirstPartyCapabilityRuntimeLaunchGroupRegistry(),
  ]);
  const successorUnit = catalog.units.find((unit) => unit.id === "casys.mcp-chrono");
  if (!successorUnit) throw new Error("missing successor Chrono unit");
  return {
    catalog,
    predecessor: { unit: predecessorUnit, launchGroup: predecessorGroup },
    successor: {
      unit: successorUnit,
      launchGroup: await registry.require(await firstPartyChronoLaunchGroupReference()),
    },
  };
}

async function withChronoCompose(
  group: CapabilityRuntimeLaunchGroup,
  mutate: (compose: {
    services: Record<string, Record<string, unknown>>;
    volumes: Record<string, unknown>;
  }) => void,
): Promise<CapabilityRuntimeLaunchGroup> {
  const parsed = JSON.parse(group.compose.content) as {
    services: Record<string, Record<string, unknown>>;
    volumes: Record<string, unknown>;
  };
  mutate(parsed);
  const content = deterministicJson(parsed);
  const { fingerprint: _fingerprint, compose: _compose, ...rest } = group;
  const body = {
    ...rest,
    compose: {
      schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
      content,
      fingerprint: await fingerprintCapabilityRuntimeComposeContent(content),
    },
  };
  return {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
}

async function withChronoImage(
  group: CapabilityRuntimeLaunchGroup,
  imageReference: string,
): Promise<CapabilityRuntimeLaunchGroup> {
  const digest = imageReference.slice(imageReference.lastIndexOf("@sha256:") + 8);
  const altered = await withChronoCompose(group, (compose) => {
    compose.services["mcp-chrono"]!.image = imageReference;
  });
  const { fingerprint: _fingerprint, ...rest } = altered;
  const body = {
    ...rest,
    materials: rest.materials.map((member) => ({
      ...member,
      imageReference,
      material: { ...member.material, imageDigest: digest },
    })),
  };
  return {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
}
