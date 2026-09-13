/**
 * Closed local secret handling for one ERP Buy launch group.
 *
 * Slot names come from the installation profile. Values stay in a process-local
 * WeakMap and are never logged, persisted, or returned to callers.
 */

import type {
  CapabilityRuntimeLaunchSecretInjector,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeSecretSnapshot,
  CapabilityRuntimeSecretSnapshotResolver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeLaunchGroup,
  CapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { sameCapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { LocalErpnextBuyInstallationProfile } from "./local-erpnext-buy-installation-profile.ts";
import type { CapabilityRuntimeLaunchGroup as LaunchGroup } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";

export class LocalErpnextBuyRuntimeSecretResolver
  implements
    CapabilityRuntimeSecretSnapshotResolver,
    CapabilityRuntimeLaunchSecretInjector {
  readonly #values = new WeakMap<object, ReadonlyMap<string, string>>();
  readonly #profile: LocalErpnextBuyInstallationProfile;
  readonly #group: CapabilityRuntimeLaunchGroupReference;
  readonly #readValue: (slotId: string) => string | undefined;

  constructor(options: {
    readonly profile: LocalErpnextBuyInstallationProfile;
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly readValue?: (slotId: string) => string | undefined;
  }) {
    this.#profile = options.profile;
    this.#group = options.group;
    this.#readValue = options.readValue ?? ((slotId) => {
      const slot = options.profile.launchGroup.secretSlots.find((item) =>
        item.id === slotId
      );
      if (!slot) return undefined;
      return Deno.env.get(`CASYS_ERPNEXT_BUY_${slot.composeEnvironmentKey}`);
    });
  }

  observe(
    slots: readonly string[],
  ): Promise<ReadonlyMap<string, "available" | "unavailable" | "unknown">> {
    const owned = new Set(
      this.#profile.launchGroup.secretSlots.map((slot) => slot.id),
    );
    const value = new Map<string, "available" | "unavailable" | "unknown">();
    for (const slot of slots) {
      if (!owned.has(slot)) {
        value.set(slot, "unknown");
        continue;
      }
      const token = this.#readValue(slot);
      value.set(slot, token === undefined ? "unavailable" : "available");
    }
    return Promise.resolve(value);
  }

  beginSnapshot(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly slots: readonly string[];
  }): Promise<CapabilityRuntimeSecretSnapshot> {
    this.#assertGroupReference(input.group);
    const expected = this.#profile.launchGroup.secretSlots.map((slot) => slot.id);
    if (
      input.slots.length !== expected.length ||
      input.slots.some((slot, index) => slot !== expected[index])
    ) {
      throw new TypeError(
        "ERP Buy secret snapshots require the exact installed secret slots.",
      );
    }
    const values = new Map<string, string>();
    for (const slot of this.#profile.launchGroup.secretSlots) {
      const token = this.#readValue(slot.id);
      if (token === undefined || token.length === 0 || token.includes("$")) {
        throw new Error(`ERP Buy secret slot ${slot.id} is unavailable.`);
      }
      values.set(slot.id, token);
    }
    const snapshot = Object.freeze({}) as CapabilityRuntimeSecretSnapshot;
    this.#values.set(snapshot, values);
    return Promise.resolve(snapshot);
  }

  composeOverlay(input: {
    readonly group: CapabilityRuntimeLaunchGroup;
    readonly snapshot: CapabilityRuntimeSecretSnapshot;
  }): Promise<Uint8Array> {
    this.#assertGroup(input.group);
    const secrets = this.#values.get(input.snapshot);
    if (!secrets) {
      throw new Error("ERP Buy runtime secret snapshot is not available.");
    }
    const source = JSON.parse(input.group.compose.content) as Record<string, unknown>;
    const services = object(source.services, "ERP Buy sealed Compose services");
    const serviceName = this.#profile.launchGroup.serviceName;
    const service = object(services[serviceName], "ERP Buy sealed Compose service");
    const environment = service.environment === undefined
      ? {}
      : object(service.environment, "ERP Buy sealed Compose environment");
    const injected: Record<string, string> = {};
    for (const [key, value] of Object.entries(environment)) {
      if (typeof value !== "string") {
        throw new TypeError("ERP Buy sealed Compose environment must be literal.");
      }
      injected[key] = value;
    }
    for (const slot of this.#profile.launchGroup.secretSlots) {
      const token = secrets.get(slot.id);
      if (token === undefined) {
        throw new Error(`ERP Buy secret slot ${slot.id} is unavailable.`);
      }
      if (injected[slot.composeEnvironmentKey] !== undefined) {
        throw new Error(
          "ERP Buy sealed Compose descriptor must not carry a secret environment.",
        );
      }
      injected[slot.composeEnvironmentKey] = token;
    }
    const document = {
      ...source,
      services: {
        ...services,
        [serviceName]: {
          ...service,
          environment: injected,
        },
      },
    };
    return Promise.resolve(
      new TextEncoder().encode(deterministicJson(document)),
    );
  }

  ownsGroup(group: CapabilityRuntimeLaunchGroupReference): boolean {
    return sameCapabilityRuntimeLaunchGroupReference(group, this.#group);
  }

  #assertGroupReference(
    group: CapabilityRuntimeLaunchGroupReference,
  ): void {
    if (!sameCapabilityRuntimeLaunchGroupReference(group, this.#group)) {
      throw new TypeError(
        "ERP Buy secret snapshot is limited to the exact installed launch group.",
      );
    }
  }

  #assertGroup(group: LaunchGroup): void {
    this.#assertGroupReference(group);
    const expected = this.#profile.launchGroup.secretSlots.map((slot) => slot.id);
    if (
      group.secretSlots.length !== expected.length ||
      group.secretSlots.some((slot, index) => slot !== expected[index])
    ) {
      throw new TypeError(
        "ERP Buy launch group secret scope drifted from the installed profile.",
      );
    }
  }
}

export function overlaySecretInjector(
  chrono: CapabilityRuntimeLaunchSecretInjector,
  erp: LocalErpnextBuyRuntimeSecretResolver | undefined,
): CapabilityRuntimeLaunchSecretInjector {
  if (!erp) return chrono;
  return {
    composeOverlay: (input) =>
      erp.ownsGroup(input.group)
        ? erp.composeOverlay(input)
        : chrono.composeOverlay(input),
  };
}

export function overlaySecretObserver(
  primary: CapabilityRuntimeSecretSlotObserver,
  erp: LocalErpnextBuyRuntimeSecretResolver | undefined,
): CapabilityRuntimeSecretSlotObserver {
  if (!erp) return primary;
  return {
    observe: async (slots) => {
      const left = await primary.observe(slots);
      const right = await erp.observe(slots);
      const merged = new Map<string, "available" | "unavailable" | "unknown">();
      for (const slot of slots) {
        const first = left.get(slot) ?? "unknown";
        const second = right.get(slot) ?? "unknown";
        merged.set(
          slot,
          first === "available" || second === "available"
            ? "available"
            : first === "unavailable" || second === "unavailable"
            ? "unavailable"
            : "unknown",
        );
      }
      return merged;
    },
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}
