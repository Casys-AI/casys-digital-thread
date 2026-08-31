/**
 * Closed host boundary for one server-owned runtime rollover.
 *
 * The application passes a durable, exact rollover identity. This port never
 * accepts an image, provider, Docker argument, compose fragment, port, volume
 * or service name from an operator or agent. Implementations may only inspect
 * the declared predecessor/successor or run the fixed successor pull/up path.
 */

import type {
  CapabilityRuntimeRolloverIdentity,
} from "../../../../domain/capability/runtime/capability-runtime-rollover-saga.ts";

declare const capabilityRuntimeRolloverHostMutationBrand: unique symbol;

/**
 * Opaque, single-use server capability minted only after the H1 saga has a
 * durable exact intent at its required phase. It is neither an operator
 * payload nor a serializable Docker instruction.
 */
export interface AuthorizedCapabilityRuntimeRolloverHostMutation {
  readonly [capabilityRuntimeRolloverHostMutationBrand]: true;
}

export type CapabilityRuntimeRolloverHostClassification =
  | "predecessor"
  | "successor"
  | "absent"
  | "hybrid"
  | "foreign"
  | "unknown";

/** Operational observation only; it is never an engineering result. */
export interface CapabilityRuntimeRolloverHostGroupObservation {
  readonly materials: "complete" | "incomplete";
  readonly runtime: "active" | "inactive" | "degraded";
}

/**
 * Minimal, redacted host fact captured into the H1 rollover evidence hash.
 * It intentionally carries no Docker IDs, endpoint, secret, logs or argv.
 */
export interface CapabilityRuntimeRolloverHostObservation {
  readonly schemaVersion: "capability-runtime-rollover-host-observation/1.0";
  readonly classification: CapabilityRuntimeRolloverHostClassification;
  readonly predecessor: CapabilityRuntimeRolloverHostGroupObservation;
  readonly successor: CapabilityRuntimeRolloverHostGroupObservation;
}

export interface CapabilityRuntimeRolloverHost {
  observeRollover(input: {
    readonly identity: CapabilityRuntimeRolloverIdentity;
  }): Promise<CapabilityRuntimeRolloverHostObservation>;
  acquireRolloverSuccessorMaterial(input: {
    readonly authorization: AuthorizedCapabilityRuntimeRolloverHostMutation;
  }): Promise<CapabilityRuntimeRolloverHostObservation>;
  activateRolloverSuccessor(input: {
    readonly authorization: AuthorizedCapabilityRuntimeRolloverHostMutation;
  }): Promise<CapabilityRuntimeRolloverHostObservation>;
}
