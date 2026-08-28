import { assertEquals, assertRejects } from "@std/assert";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "./capability-runtime-launch-group-registry.ts";

Deno.test("launch-group registry resolves only the exact sealed SysON group reference", async () => {
  const [group] = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry([group]);
  const reference = capabilityRuntimeLaunchGroupReference(group!);

  assertEquals((await registry.require(reference)).id, "casys-syson");
  await assertRejects(
    () => registry.require({ ...reference, version: "9.9.9" }),
    TypeError,
    "0 exact matches",
  );
});

Deno.test("Build123d launch groups pin the reviewed image, private loopback ports, retained exports and no shared network", async () => {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const expected = [{
    id: "casys-build123d-sandbox",
    service: "mcp-build123d-sandbox",
    port: "127.0.0.1:3024:3014",
    volume: "build123d-sandbox-exports:/exports",
  }, {
    id: "casys-build123d-observation",
    service: "mcp-build123d",
    port: "127.0.0.1:3014:3014",
    volume: "exports:/exports",
  }];
  for (const requirement of expected) {
    const group = groups.find((candidate) => candidate.id === requirement.id)!;
    const descriptor = JSON.parse(group.compose.content) as {
      services: Record<string, Record<string, unknown>>;
    };
    const service = descriptor.services[requirement.service]!;
    assertEquals(group.version, "1.0.0");
    assertEquals(
      group.materials[0]?.imageReference,
      "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
    );
    assertEquals(service.ports, [requirement.port]);
    assertEquals(service.volumes, [requirement.volume]);
    assertEquals(service.mem_limit, "2g");
    assertEquals(service.cpus, 2);
    assertEquals(service.pids_limit, 128);
    assertEquals(service.security_opt, ["no-new-privileges:true"]);
    assertEquals(service.cap_drop, ["ALL"]);
    assertEquals("healthcheck" in service, false);
    assertEquals("networks" in descriptor, false);
    assertEquals("networks" in service, false);
    assertEquals(group.retention, {
      containers: "stop-only",
      images: "preserve",
      volumes: "preserve",
    });
  }
});
