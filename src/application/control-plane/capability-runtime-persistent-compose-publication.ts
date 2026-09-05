/**
 * Control-plane rule: one sealed ROP yields exactly one qualified binding and
 * exactly one distinct persistent-Compose launch group.
 *
 * This is not project/Thread state, an agent tool, a provider registry, or a
 * connection locator. Executors reuse it before asking the broker to connect.
 */

import type { CapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { sameCapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { CapabilityRuntimeConnectionError } from "../ports/out/capability/capability-runtime-connection.ts";

export interface QualifiedPersistentComposePublication {
  readonly binding: { readonly id: string; readonly version: string };
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
}

export function requiredQualifiedPersistentComposePublication(
  operationalCapability: ResolvedCapabilityRuntimeOperation,
): QualifiedPersistentComposePublication {
  if (operationalCapability.bindings.length !== 1) {
    throw new CapabilityRuntimeConnectionError(
      "Sealed operational capability requires exactly one qualified binding.",
    );
  }
  const binding = operationalCapability.bindings[0]!;
  if (binding.effectiveQualification !== "qualified") {
    throw new CapabilityRuntimeConnectionError(
      "Sealed operational capability requires exactly one qualified binding.",
    );
  }
  const groups: CapabilityRuntimeLaunchGroupReference[] = [];
  for (const lifecycle of binding.hostLifecycles) {
    if (lifecycle.kind !== "persistent-compose" || lifecycle.launchGroup === null) {
      continue;
    }
    if (
      !groups.some((group) =>
        sameCapabilityRuntimeLaunchGroupReference(group, lifecycle.launchGroup!)
      )
    ) {
      groups.push(lifecycle.launchGroup);
    }
  }
  if (groups.length !== 1) {
    throw new CapabilityRuntimeConnectionError(
      "Sealed operational capability requires exactly one distinct persistent-Compose launch group.",
    );
  }
  return { binding: binding.binding, launchGroup: groups[0]! };
}
