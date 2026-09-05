import { assertEquals, assertRejects } from "@std/assert";
import { CapabilityRuntimeConnectionError } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import type { CapabilityRuntimeConnectionHandle } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import type { CapabilityRuntimeLease } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "./first-party-capability-runtime-launch-groups.ts";
import { InMemoryCapabilityRuntimeLeaseStore } from "./in-memory-capability-runtime-supervisor.ts";
import {
  createLocalFixedCapabilityRuntimeConnection,
} from "./local-fixed-capability-runtime-connection.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";

const NOW = "2026-08-30T12:00:00.000Z";
const SYSON_MCP_URL = "http://127.0.0.1:3009/mcp";
const OBSERVATION_MCP_URL = "http://127.0.0.1:3014/mcp";
const SANDBOX_MCP_URL = "http://127.0.0.1:3024/mcp";

Deno.test("exact SysON and Build123d observation routes stay separate and reject cross-use", async () => {
  const routes = await dualRouteFixture();
  const sysonHandle = await routes.syson.connection.connect({
    lease: routes.syson.lease,
    binding: routes.syson.binding,
    launchGroup: routes.syson.launchGroup,
  });
  assertEquals(JSON.stringify(sysonHandle), "{}");
  assertEquals("mcpUrl" in sysonHandle, false);
  assertEquals("url" in sysonHandle, false);
  assertEquals("port" in sysonHandle, false);

  const observationHandle = await routes.observation.connection.connect({
    lease: routes.observation.lease,
    binding: routes.observation.binding,
    launchGroup: routes.observation.launchGroup,
  });
  assertEquals("mcpUrl" in observationHandle, false);

  await assertRejects(
    () =>
      routes.syson.connection.connect({
        lease: routes.observation.lease,
        binding: routes.observation.binding,
        launchGroup: routes.observation.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "exact trusted binding and launch group",
  );
  await assertRejects(
    () =>
      routes.observation.connection.connect({
        lease: routes.syson.lease,
        binding: routes.syson.binding,
        launchGroup: routes.syson.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "exact trusted binding and launch group",
  );
  await assertRejects(
    () =>
      routes.syson.connection.connect({
        lease: routes.syson.lease,
        binding: routes.observation.binding,
        launchGroup: routes.syson.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "exact trusted binding and launch group",
  );
  await assertRejects(
    () =>
      routes.observation.connection.connect({
        lease: routes.observation.lease,
        binding: routes.observation.binding,
        launchGroup: routes.syson.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "exact trusted binding and launch group",
  );

  const sysonRequested: string[] = [];
  const observationRequested: string[] = [];
  const probed = await dualRouteFixture({
    sysonFetch: (input) => {
      sysonRequested.push(String(input));
      return Promise.reject(new Error("probe"));
    },
    observationFetch: (input) => {
      observationRequested.push(String(input));
      return Promise.reject(new Error("probe"));
    },
  });
  const sysonClient = await probed.syson.connection.open(
    await probed.syson.connection.connect({
      lease: probed.syson.lease,
      binding: probed.syson.binding,
      launchGroup: probed.syson.launchGroup,
    }),
  );
  const observationClient = await probed.observation.connection.open(
    await probed.observation.connection.connect({
      lease: probed.observation.lease,
      binding: probed.observation.binding,
      launchGroup: probed.observation.launchGroup,
    }),
  );
  await assertRejects(
    () => sysonClient.callTool({ name: "syson_project_create" }),
    Error,
  );
  await assertRejects(
    () => observationClient.callTool({ name: "build123d_observe_assembly_integrity" }),
    Error,
  );
  assertEquals(sysonRequested.some((url) => url.startsWith(SYSON_MCP_URL)), true);
  assertEquals(
    observationRequested.some((url) => url.startsWith(OBSERVATION_MCP_URL)),
    true,
  );
  assertEquals(sysonRequested.some((url) => url.includes("3014")), false);
  assertEquals(observationRequested.some((url) => url.includes("3009")), false);
  assertEquals(observationRequested.some((url) => url.includes("3024")), false);
});

Deno.test("forged, cloned, mismatched, expired and released handles fail closed", async () => {
  const fixture = await sysonFixture();
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: fixture.binding,
    launchGroup: fixture.launchGroup,
  });

  await assertRejects(
    () => fixture.connection.open({} as CapabilityRuntimeConnectionHandle),
    CapabilityRuntimeConnectionError,
    "unknown",
  );
  await assertRejects(
    () => fixture.connection.open(structuredClone(handle)),
    CapabilityRuntimeConnectionError,
    "unknown",
  );

  const uncovered = await claimedLease(fixture.leases, {
    ...fixture.lease,
    id: "capability-jit-uncovered",
    bindingIds: ["other-binding"],
  });
  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: uncovered,
        binding: fixture.binding,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "covering the requested binding and launch group",
  );

  await fixture.leases.release(fixture.lease.id);
  await assertRejects(
    () => fixture.connection.open(handle),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: fixture.lease,
        binding: fixture.binding,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
});

Deno.test("a reclaimed lease id with fresh timestamps does not revive the previous handle", async () => {
  const fixture = await sysonFixture();
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: fixture.binding,
    launchGroup: fixture.launchGroup,
  });
  await fixture.leases.release(fixture.lease.id);
  const reclaimed = await claimedLease(fixture.leases, {
    ...fixture.lease,
    acquiredAt: "2026-08-30T13:00:00.000Z",
    expiresAt: "2026-08-30T19:00:00.000Z",
  });
  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: fixture.lease,
        binding: fixture.binding,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
  await assertRejects(
    () => fixture.connection.open(handle),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
  const next = await fixture.connection.connect({
    lease: reclaimed,
    binding: fixture.binding,
    launchGroup: fixture.launchGroup,
  });
  const client = await fixture.connection.open(next);
  assertEquals(typeof client.callTool, "function");
});

Deno.test("fixed observation publication accepts the fleet URL and rejects the sandbox port", async () => {
  const fixture = await observationFixture({ fleetMcpUrl: OBSERVATION_MCP_URL });
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: fixture.binding,
    launchGroup: fixture.launchGroup,
  });
  const client = await fixture.connection.open(handle);
  assertEquals(typeof client.callTool, "function");

  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const observation = groups.find((group) =>
    group.id === "casys-build123d-observation"
  );
  if (!observation) throw new Error("Build123d observation launch group is absent.");
  await assertRejects(
    () =>
      createLocalFixedCapabilityRuntimeConnection({
        leases: fixture.leases,
        binding: fixture.binding,
        launchGroup: observation,
        fleetMcpUrl: SANDBOX_MCP_URL,
      }),
    CapabilityRuntimeConnectionError,
    "does not match the sealed launch-group loopback host port",
  );
  await assertRejects(
    () =>
      createLocalFixedCapabilityRuntimeConnection({
        leases: fixture.leases,
        binding: fixture.binding,
        launchGroup: observation,
        fleetMcpUrl: "http://127.0.0.1:1/mcp",
      }),
    CapabilityRuntimeConnectionError,
    "does not match the sealed launch-group loopback host port",
  );
});

Deno.test("an expired lease cannot mint or open a handle", async () => {
  const fixture = await sysonFixture({ now: () => "2026-08-31T00:00:00.000Z" });
  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: fixture.lease,
        binding: fixture.binding,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
});

async function dualRouteFixture(
  extras: {
    readonly sysonFetch?: typeof fetch;
    readonly observationFetch?: typeof fetch;
  } = {},
) {
  const syson = await sysonFixture({ fetch: extras.sysonFetch });
  const observation = await observationFixture({
    leases: syson.leases,
    fetch: extras.observationFetch,
  });
  return { syson, observation };
}

async function sysonFixture(
  extras: {
    readonly now?: () => string;
    readonly fetch?: typeof fetch;
    readonly fleetMcpUrl?: string;
    readonly leases?: InMemoryCapabilityRuntimeLeaseStore;
  } = {},
) {
  return await routeFixture({
    groupId: "casys-syson",
    bindingId: "syson-author-system",
    mcpUrl: SYSON_MCP_URL,
    leaseId: "capability-jit-syson-seed",
    materialKey: "casys.syson-stack\u0000mcp-syson-image",
    extras,
  });
}

async function observationFixture(
  extras: {
    readonly now?: () => string;
    readonly fetch?: typeof fetch;
    readonly fleetMcpUrl?: string;
    readonly leases?: InMemoryCapabilityRuntimeLeaseStore;
  } = {},
) {
  return await routeFixture({
    groupId: "casys-build123d-observation",
    bindingId: "build123d-observe-assembly-integrity",
    mcpUrl: OBSERVATION_MCP_URL,
    leaseId: "capability-jit-assembly-observation",
    materialKey: "casys.mcp-build123d-observation\u0000mcp-build123d-observation-image",
    extras,
  });
}

async function routeFixture(input: {
  readonly groupId: string;
  readonly bindingId: string;
  readonly mcpUrl: string;
  readonly leaseId: string;
  readonly materialKey: string;
  readonly extras: {
    readonly now?: () => string;
    readonly fetch?: typeof fetch;
    readonly fleetMcpUrl?: string;
    readonly leases?: InMemoryCapabilityRuntimeLeaseStore;
  };
}) {
  const leases = input.extras.leases ?? new InMemoryCapabilityRuntimeLeaseStore();
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const group = groups.find((candidate) => candidate.id === input.groupId);
  if (!group) throw new Error(`${input.groupId} launch group is absent.`);
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const catalogBinding = catalog.bindings.find((candidate) =>
    candidate.id === input.bindingId
  );
  if (!catalogBinding) {
    throw new Error(`${input.bindingId} catalogue binding is absent.`);
  }
  const binding = { id: catalogBinding.id, version: catalogBinding.version };
  const launchGroup = capabilityRuntimeLaunchGroupReference(group);
  const lease = await claimedLease(leases, {
    id: input.leaseId,
    projectId: "project-review-demo",
    bindingIds: [binding.id],
    materialKeys: [input.materialKey],
    launchGroups: [launchGroup],
    acquiredAt: NOW,
    expiresAt: "2026-08-30T18:00:00.000Z",
  });
  const connection = await createLocalFixedCapabilityRuntimeConnection({
    leases,
    binding,
    launchGroup: group,
    now: input.extras.now ?? (() => NOW),
    ...(input.extras.fleetMcpUrl ? { fleetMcpUrl: input.extras.fleetMcpUrl } : {}),
    ...(input.extras.fetch ? { fetch: input.extras.fetch } : {}),
  });
  return { connection, lease, leases, launchGroup, binding, mcpUrl: input.mcpUrl };
}

async function claimedLease(
  leases: InMemoryCapabilityRuntimeLeaseStore,
  lease: CapabilityRuntimeLease,
): Promise<CapabilityRuntimeLease> {
  const claimed = await leases.claim(lease);
  return claimed.lease;
}
