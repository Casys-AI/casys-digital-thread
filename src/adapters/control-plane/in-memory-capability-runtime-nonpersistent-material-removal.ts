/** In-memory test adapters for the non-persistent material-removal journal. */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import {
  validateCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  validateCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import type { CapabilityRuntimeNonpersistentMaterialRemovalJournal } from "../../application/ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";

export class InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal
  implements CapabilityRuntimeNonpersistentMaterialRemovalJournal {
  #intents: CapabilityRuntimeNonpersistentMaterialRemovalIntent[] = [];
  #outcomes: CapabilityRuntimeNonpersistentMaterialRemovalOutcome[] = [];

  async appendIntent(
    input: CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  ): Promise<void> {
    const intent = await validateCapabilityRuntimeNonpersistentMaterialRemovalIntent(
      input,
    );
    const existing = this.#intents.find((candidate) => candidate.id === intent.id);
    if (existing) {
      if (deterministicJson(existing) !== deterministicJson(intent)) {
        throw new Error(
          "Non-persistent material removal intent already exists with different content.",
        );
      }
      return;
    }
    this.#intents.push(structuredClone(intent));
  }

  async appendOutcome(
    input: CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  ): Promise<void> {
    const outcome = await validateCapabilityRuntimeNonpersistentMaterialRemovalOutcome(
      input,
    );
    const intent = this.#intents.find((candidate) => candidate.id === outcome.intentId);
    if (!intent) {
      throw new Error(
        "Non-persistent material removal outcome has no durable intent.",
      );
    }
    if (
      intent.fingerprint.algorithm !== outcome.intentFingerprint.algorithm ||
      intent.fingerprint.digest !== outcome.intentFingerprint.digest
    ) {
      throw new Error(
        "Non-persistent material removal outcome does not attest its exact intent.",
      );
    }
    if (outcome.recordedAt < intent.plannedAt) {
      throw new Error(
        "Non-persistent material removal outcome predates its durable intent.",
      );
    }
    const existing = this.#outcomes.find((candidate) =>
      candidate.intentId === outcome.intentId
    );
    if (existing) {
      if (deterministicJson(existing) !== deterministicJson(outcome)) {
        throw new Error(
          "Non-persistent material removal outcome already exists with different content.",
        );
      }
      return;
    }
    this.#outcomes.push(structuredClone(outcome));
  }

  listIntents(): Promise<
    readonly CapabilityRuntimeNonpersistentMaterialRemovalIntent[]
  > {
    return Promise.resolve(structuredClone(this.#intents));
  }

  listOutcomes(): Promise<
    readonly CapabilityRuntimeNonpersistentMaterialRemovalOutcome[]
  > {
    return Promise.resolve(structuredClone(this.#outcomes));
  }
}
