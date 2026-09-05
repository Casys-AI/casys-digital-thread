/** Composes exact, read-only runtime observers without giving either mutation authority. */

import type { CapabilityRuntimeObservedState } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeStateObserver } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";

/** One observer's closed, code-owned material coverage. */
export interface CapabilityRuntimeStateObserverSlice {
  readonly observer: CapabilityRuntimeStateObserver;
  /** Keys, not image references: ownership stays in the trusted composition. */
  readonly materialKeys: readonly string[];
}

/**
 * Each observer owns a disjoint, code-owned material slice (Compose group or
 * exact Microsandbox cache). A slice with no assigned requested material is
 * not invoked. A duplicate coverage declaration, an unexpected response, or a
 * missing response for an owned requested material is an authority/
 * configuration error. Materials outside every slice deliberately remain
 * unobserved; the redacted Workbench projects them as `unavailable`.
 */
export class CompositeCapabilityRuntimeStateObserver
  implements CapabilityRuntimeStateObserver {
  readonly #slices: readonly {
    readonly observer: CapabilityRuntimeStateObserver;
    readonly materialKeys: ReadonlySet<string>;
  }[];

  constructor(slices: readonly CapabilityRuntimeStateObserverSlice[]) {
    const owners = new Set<string>();
    this.#slices = slices.map((slice) => {
      const keys = new Set(slice.materialKeys);
      if (keys.size !== slice.materialKeys.length) {
        throw new TypeError("Capability runtime observer slice repeats a material.");
      }
      for (const key of keys) {
        if (owners.has(key)) {
          throw new TypeError(
            "Capability runtime observer slices overlap on one material.",
          );
        }
        owners.add(key);
      }
      return { observer: slice.observer, materialKeys: keys };
    });
  }

  async observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    const requested = new Map<string, CapabilityRuntimeMaterialIdentity>();
    for (const material of materials) {
      const key = capabilityRuntimeMaterialKey(material);
      const previous = requested.get(key);
      if (previous && previous.imageDigest !== material.imageDigest) {
        throw new Error(
          "Capability runtime observation received conflicting material identities.",
        );
      }
      requested.set(key, material);
    }
    const observations = await Promise.all(this.#slices.map(async (slice) => {
      const assigned = [...requested.entries()]
        .filter(([key]) => slice.materialKeys.has(key))
        .map(([, material]) => material);
      if (assigned.length === 0) {
        return new Map<string, CapabilityRuntimeObservedState>();
      }
      const values = await slice.observer.observe(assigned);
      for (const key of values.keys()) {
        if (!slice.materialKeys.has(key) || !requested.has(key)) {
          throw new Error(
            "Capability runtime observer returned an unrequested material.",
          );
        }
      }
      for (const material of assigned) {
        if (!values.has(capabilityRuntimeMaterialKey(material))) {
          throw new Error(
            "Capability runtime observer did not return its owned requested material.",
          );
        }
      }
      return values;
    }));
    const result = new Map<string, CapabilityRuntimeObservedState>();
    for (const source of observations) {
      for (const [key, state] of source) {
        if (result.has(key)) {
          throw new Error("Capability runtime observers overlap on one material.");
        }
        result.set(key, structuredClone(state));
      }
    }
    return result;
  }
}
