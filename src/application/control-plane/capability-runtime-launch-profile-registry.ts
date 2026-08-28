/** Exact, server-internal registry for immutable capability host profiles. */

import {
  type CapabilityRuntimeLaunchProfile,
  type CapabilityRuntimeLaunchProfileReference,
  capabilityRuntimeLaunchProfileReference,
  sameCapabilityRuntimeLaunchProfileReference,
  validateCapabilityRuntimeLaunchProfile,
  validateCapabilityRuntimeLaunchProfileReference,
} from "../../domain/capability/runtime/capability-runtime-host.ts";
import type {
  CapabilityRuntimeLaunchProfileRegistry,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

/**
 * The registry accepts only code-owned profiles.  It validates on every read
 * boundary so a mutated caller-owned fixture or composition value cannot turn
 * an id/version match into a launch authorization.
 */
export class FixedCapabilityRuntimeLaunchProfileRegistry
  implements CapabilityRuntimeLaunchProfileRegistry {
  constructor(private readonly profiles: readonly unknown[]) {}

  async require(
    reference: CapabilityRuntimeLaunchProfileReference,
  ): Promise<CapabilityRuntimeLaunchProfile> {
    const exactReference = validateCapabilityRuntimeLaunchProfileReference(reference);
    const profiles = await this.#validated();
    const matches = profiles.filter((profile) =>
      sameCapabilityRuntimeLaunchProfileReference(
        capabilityRuntimeLaunchProfileReference(profile),
        exactReference,
      )
    );
    if (matches.length !== 1) {
      throw new TypeError(
        `Capability runtime launch-profile registry has ${matches.length} exact matches for ${exactReference.id}@${exactReference.version}.`,
      );
    }
    return matches[0]!;
  }

  async list(): Promise<readonly CapabilityRuntimeLaunchProfile[]> {
    return await this.#validated();
  }

  async #validated(): Promise<readonly CapabilityRuntimeLaunchProfile[]> {
    const profiles = await Promise.all(
      this.profiles.map((profile) =>
        validateCapabilityRuntimeLaunchProfile(structuredClone(profile))
      ),
    );
    const identities = new Set<string>();
    for (const profile of profiles) {
      const key = `${profile.id}\u0000${profile.version}`;
      if (identities.has(key)) {
        throw new TypeError(
          `Capability runtime launch-profile registry has duplicate ${profile.id}@${profile.version}.`,
        );
      }
      identities.add(key);
    }
    return profiles.toSorted((left, right) =>
      `${left.id}\u0000${left.version}`.localeCompare(
        `${right.id}\u0000${right.version}`,
      )
    );
  }
}
