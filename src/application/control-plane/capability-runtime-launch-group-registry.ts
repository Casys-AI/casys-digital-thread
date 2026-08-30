/** Server-only immutable registry for reviewed Compose launch groups. */

import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts,
  type CapabilityRuntimeLaunchGroupReference,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
  validateCapabilityRuntimeLaunchGroup,
  validateCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  CapabilityRuntimeLaunchGroupRegistry,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

export class FixedCapabilityRuntimeLaunchGroupRegistry
  implements CapabilityRuntimeLaunchGroupRegistry {
  constructor(private readonly groups: readonly unknown[]) {}

  async require(
    reference: CapabilityRuntimeLaunchGroupReference,
  ): Promise<CapabilityRuntimeLaunchGroup> {
    const expected = validateCapabilityRuntimeLaunchGroupReference(reference);
    const groups = await this.list();
    const matches = groups.filter((group) =>
      sameCapabilityRuntimeLaunchGroupReference(
        capabilityRuntimeLaunchGroupReference(group),
        expected,
      )
    );
    if (matches.length !== 1) {
      throw new TypeError(
        `Capability runtime launch-group registry has ${matches.length} exact matches for ${expected.id}@${expected.version}.`,
      );
    }
    return matches[0]!;
  }

  async list(): Promise<readonly CapabilityRuntimeLaunchGroup[]> {
    const groups = await Promise.all(
      this.groups.map((group) =>
        validateCapabilityRuntimeLaunchGroup(structuredClone(group))
      ),
    );
    const ids = groups.map((group) => `${group.id}\u0000${group.version}`);
    rejectDuplicateIds(ids);
    rejectDuplicatePublishedLoopbackHostPorts(groups);
    return groups.toSorted((left, right) =>
      `${left.id}\u0000${left.version}`.localeCompare(
        `${right.id}\u0000${right.version}`,
      )
    );
  }
}

function rejectDuplicateIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(
      "Capability runtime launch-group registry has duplicate group identities.",
    );
  }
}

function rejectDuplicatePublishedLoopbackHostPorts(
  groups: readonly CapabilityRuntimeLaunchGroup[],
): void {
  const owners = new Map<number, string>();
  for (const group of groups) {
    const identity = `${group.id}@${group.version}`;
    for (const port of capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(group)) {
      const owner = owners.get(port);
      if (owner !== undefined && owner !== identity) {
        throw new TypeError(
          `Capability runtime launch-group registry publishes loopback host port ${port} from both ${owner} and ${identity}.`,
        );
      }
      owners.set(port, identity);
    }
  }
}
