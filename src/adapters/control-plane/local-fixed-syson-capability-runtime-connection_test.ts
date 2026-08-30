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
  createLocalFixedSysonCapabilityRuntimeConnection,
} from "./local-fixed-syson-capability-runtime-connection.ts";

const NOW = "2026-08-30T12:00:00.000Z";
const SYSON_MCP_URL = "http://127.0.0.1:3009/mcp";
const SYSON_BINDING = { id: "syson-author-system", version: "1" } as const;

Deno.test("exact SysON lease, binding and launch group yields a handle", async () => {
  const fixture = await connectionFixture();
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: SYSON_BINDING,
    launchGroup: fixture.launchGroup,
  });
  assertEquals(JSON.stringify(handle), "{}");
  assertEquals("mcpUrl" in handle, false);
  assertEquals("url" in handle, false);
  assertEquals("port" in handle, false);
  const requested: string[] = [];
  const connection = await connectionFixture({
    fetch: (input) => {
      requested.push(String(input));
      return Promise.reject(new Error("probe"));
    },
  });
  const opened = await connection.connection.connect({
    lease: connection.lease,
    binding: SYSON_BINDING,
    launchGroup: connection.launchGroup,
  });
  const client = await connection.connection.open(opened);
  await assertRejects(() => client.callTool({ name: "syson_project_create" }), Error);
  assertEquals(requested.some((url) => url.startsWith(SYSON_MCP_URL)), true);
  assertEquals(requested.some((url) => url.includes("3009")), true);
});

Deno.test("forged, cloned, mismatched and released SysON handles fail closed", async () => {
  const fixture = await connectionFixture();
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: SYSON_BINDING,
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

  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: fixture.lease,
        binding: { id: "syson-inspect-system", version: "1" },
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "exact trusted SysON binding",
  );
  const otherGroup = {
    ...fixture.launchGroup,
    id: "casys-chrono",
  };
  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: fixture.lease,
        binding: SYSON_BINDING,
        launchGroup: otherGroup,
      }),
    CapabilityRuntimeConnectionError,
    "exact trusted SysON binding",
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
        binding: SYSON_BINDING,
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
        binding: SYSON_BINDING,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
});

Deno.test("a reclaimed lease id with fresh timestamps does not revive the previous handle", async () => {
  const fixture = await connectionFixture();
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: SYSON_BINDING,
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
        binding: SYSON_BINDING,
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
    binding: SYSON_BINDING,
    launchGroup: fixture.launchGroup,
  });
  const client = await fixture.connection.open(next);
  assertEquals(typeof client.callTool, "function");
});

Deno.test("fixed SysON publication refuses a non-casys-syson launch group", async () => {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const chrono = groups.find((group) => group.id === "casys-chrono");
  if (!chrono) throw new Error("Chrono launch group is absent.");
  await assertRejects(
    () =>
      createLocalFixedSysonCapabilityRuntimeConnection({
        leases: new InMemoryCapabilityRuntimeLeaseStore(),
        launchGroup: chrono,
      }),
    CapabilityRuntimeConnectionError,
    "binds only the exact casys-syson launch group",
  );
});

Deno.test("fixed SysON publication accepts the exact fleet URL and rejects another loopback port", async () => {
  const fixture = await connectionFixture({ fleetMcpUrl: SYSON_MCP_URL });
  const handle = await fixture.connection.connect({
    lease: fixture.lease,
    binding: SYSON_BINDING,
    launchGroup: fixture.launchGroup,
  });
  const client = await fixture.connection.open(handle);
  assertEquals(typeof client.callTool, "function");

  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const syson = groups.find((group) => group.id === "casys-syson");
  if (!syson) throw new Error("SysON launch group is absent.");
  await assertRejects(
    () =>
      createLocalFixedSysonCapabilityRuntimeConnection({
        leases: fixture.leases,
        launchGroup: syson,
        fleetMcpUrl: "http://127.0.0.1:1/mcp",
      }),
    CapabilityRuntimeConnectionError,
    "does not match the sealed casys-syson loopback host port",
  );
});

Deno.test("an expired SysON lease cannot mint or open a handle", async () => {
  const fixture = await connectionFixture({ now: () => "2026-08-31T00:00:00.000Z" });
  await assertRejects(
    () =>
      fixture.connection.connect({
        lease: fixture.lease,
        binding: SYSON_BINDING,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
});

async function connectionFixture(
  extras: {
    readonly now?: () => string;
    readonly fetch?: typeof fetch;
    readonly fleetMcpUrl?: string;
  } = {},
) {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const syson = groups.find((group) => group.id === "casys-syson");
  if (!syson) throw new Error("SysON launch group is absent.");
  const launchGroup = capabilityRuntimeLaunchGroupReference(syson);
  const lease = await claimedLease(leases, {
    id: "capability-jit-syson-seed",
    projectId: "project-review-demo",
    bindingIds: ["syson-author-system"],
    materialKeys: ["casys.syson-stack\u0000mcp-syson-image"],
    launchGroups: [launchGroup],
    acquiredAt: NOW,
    expiresAt: "2026-08-30T18:00:00.000Z",
  });
  const connection = await createLocalFixedSysonCapabilityRuntimeConnection({
    leases,
    launchGroup: syson,
    now: extras.now ?? (() => NOW),
    ...(extras.fleetMcpUrl ? { fleetMcpUrl: extras.fleetMcpUrl } : {}),
    ...(extras.fetch ? { fetch: extras.fetch } : {}),
  });
  return { connection, lease, leases, launchGroup };
}

async function claimedLease(
  leases: InMemoryCapabilityRuntimeLeaseStore,
  lease: CapabilityRuntimeLease,
): Promise<CapabilityRuntimeLease> {
  const claimed = await leases.claim(lease);
  return claimed.lease;
}
