/** One-use host-mutation capability for non-persistent cache-image removal. */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  type CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  type CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  sameNonpersistentRemovalIdentity,
  sameNonpersistentRemovalPlan,
  validateCapabilityRuntimeNonpersistentMaterialRemovalIntent,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import type {
  AuthorizedNonpersistentMaterialRemoval,
  CapabilityRuntimeNonpersistentMaterialRemovalJournal,
} from "../ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";

const granted = new WeakSet<AuthorizedNonpersistentMaterialRemoval>();

/** @internal removal remains tied to the independently reviewed exact plan. */
export async function authorizeDurableNonpersistentMaterialRemoval(
  intent: CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  journal: CapabilityRuntimeNonpersistentMaterialRemovalJournal,
): Promise<AuthorizedNonpersistentMaterialRemoval> {
  if (
    intent.action !== "material-remove" ||
    !sameNonpersistentRemovalIdentity(intent, plan) ||
    !sameNonpersistentRemovalPlan({ fingerprint: intent.planFingerprint }, plan)
  ) {
    throw new Error(
      "Non-persistent material removal requires its exact reviewed removal plan.",
    );
  }
  const matches = (await journal.listIntents()).filter((candidate) =>
    candidate.id === intent.id
  );
  if (
    matches.length !== 1 ||
    deterministicJson(matches[0]) !== deterministicJson(intent)
  ) {
    throw new Error(
      "Non-persistent material removal intent is not the exact durable journal entry.",
    );
  }
  if (
    (await journal.listOutcomes()).some((outcome) => outcome.intentId === intent.id)
  ) {
    throw new Error(
      "Non-persistent material removal intent already has a terminal outcome.",
    );
  }
  const authorization = Object.freeze({
    intent: await validateCapabilityRuntimeNonpersistentMaterialRemovalIntent(intent),
  }) as AuthorizedNonpersistentMaterialRemoval;
  granted.add(authorization);
  return authorization;
}

/** @internal Raw host adapters consume exactly one purpose-specific capability. */
export function consumeAuthorizedNonpersistentMaterialRemoval(
  value: AuthorizedNonpersistentMaterialRemoval,
): CapabilityRuntimeNonpersistentMaterialRemovalIntent | undefined {
  return granted.delete(value) ? value.intent : undefined;
}
