/**
 * Ports for the sibling non-persistent cache-image removal lifecycle.
 *
 * They are not Compose, MCP, Workbench, or project command surfaces. The
 * existing launch-group journal cannot honestly represent `launchGroup: null`.
 */

import type {
  CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  CapabilityRuntimeNonpersistentMaterialRemovalObservation,
  CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  CapabilityRuntimeNonpersistentRemovalBackend,
  CapabilityRuntimeNonpersistentRemovalMaterial,
} from "../../../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";

export interface CapabilityRuntimeNonpersistentMaterialRemovalJournal {
  appendIntent(
    intent: CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  ): Promise<void>;
  appendOutcome(
    outcome: CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  ): Promise<void>;
  listIntents(): Promise<
    readonly CapabilityRuntimeNonpersistentMaterialRemovalIntent[]
  >;
  listOutcomes(): Promise<
    readonly CapabilityRuntimeNonpersistentMaterialRemovalOutcome[]
  >;
}

declare const nonpersistentRemovalMutationBrand: unique symbol;

/** One-shot capability minted only after the exact intent is durable. */
export interface AuthorizedNonpersistentMaterialRemoval {
  readonly intent: CapabilityRuntimeNonpersistentMaterialRemovalIntent;
  readonly [nonpersistentRemovalMutationBrand]: true;
}

export interface CapabilityRuntimeNonpersistentMaterialRemovalHost {
  inspect(input: {
    readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
    readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalObservation>;

  mutate(input: {
    readonly authorization: AuthorizedNonpersistentMaterialRemoval;
    readonly plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan;
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome>;
}
