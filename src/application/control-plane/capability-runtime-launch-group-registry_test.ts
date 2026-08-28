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
