/**
 * Provider-neutral factual assembly-integrity capability.
 *
 * The application can ask only for a factual observation over an already
 * reopened exact bundle. It cannot choose a provider, tool, runtime, command,
 * project, review decision, or verdict rule. Server composition owns the
 * concrete adapter and its closed profile catalogue.
 */

import type { AssemblyIntegrityInputBundle } from "../../../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import type { AssemblyIntegrityObservation } from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import type {
  AssemblyIntegrityObserverProfile,
  AssemblyIntegrityObserverProfileRef,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export type {
  AssemblyIntegrityObserverCapability,
  AssemblyIntegrityObserverConfiguredRuntime,
  AssemblyIntegrityObserverProducerContract,
  AssemblyIntegrityObserverProfile,
  AssemblyIntegrityObserverProfileRef,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";

/** Closed server-owned catalogue; there is no caller registration or fallback. */
export interface AssemblyIntegrityObserverProfileCatalog {
  initial(): Promise<AssemblyIntegrityObserverProfile>;
  resolve(
    profile: AssemblyIntegrityObserverProfileRef,
  ): Promise<AssemblyIntegrityObserverProfile>;
}

/** Exact internal profile selection carried from review through dispatch. */
export interface AssemblyIntegrityObserverProfileSelection {
  readonly profile: AssemblyIntegrityObserverProfileRef;
  readonly fingerprint: ContentFingerprint;
}

export interface AssemblyIntegrityObserverRequest {
  readonly inputBundle: AssemblyIntegrityInputBundle;
  /**
   * Exact profile reopened and fingerprint-verified before dispatch. A public
   * tool never accepts it, and an adapter must not replace it with a current
   * catalogue entry.
   */
  readonly profile: AssemblyIntegrityObserverProfile;
}

/**
 * Factual capability over the exact closed input bundle. A later executor may
 * record dispatch/recovery and seal this result; this port itself does neither.
 */
export interface AssemblyIntegrityObserver {
  observe(
    request: AssemblyIntegrityObserverRequest,
  ): Promise<AssemblyIntegrityObserverResult>;
}

/**
 * Opaque provider provenance that has been recrossed against the server-owned
 * profile. It identifies a factual response; it is not a sandbox attestation,
 * a project identity, a review decision, or a verdict.
 */
export interface AssemblyIntegrityObserverExecution {
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly configuredRuntime: AssemblyIntegrityObserverProfile["configuredRuntime"];
  readonly raw: {
    readonly schemaVersion: string;
    readonly producer: {
      readonly service: string;
      readonly packageVersion: string;
      readonly tool: string;
      readonly engine: {
        readonly id: string;
        readonly version: string;
      };
    };
    readonly requestFingerprint: ContentFingerprint;
    readonly responseFingerprint: ContentFingerprint;
  };
}

/** Facts normalized for DT sealing plus the opaque, recrossed call provenance. */
export interface AssemblyIntegrityObserverResult {
  readonly observation: AssemblyIntegrityObservation;
  readonly execution: AssemblyIntegrityObserverExecution;
}
