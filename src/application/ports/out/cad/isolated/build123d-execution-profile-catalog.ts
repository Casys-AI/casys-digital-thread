/**
 * Read-only catalogue for the server-owned Build123d execution contract.
 *
 * A command can name only the exact execution profile revision already
 * present in a sealed compilation. It cannot select a backend, policy, image,
 * limits, outputs, or cleanup semantics.
 */

import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type {
  TechnicalCompilationProfile,
  TechnicalCompilationTarget,
} from "../../../../../domain/compile/admission/technical-compilation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { MicrosandboxLocalRuntimeIdentity } from "../../../../../domain/compile/isolation/local-isolation-runtime.ts";

export const BUILD123D_EXECUTION_PROFILE_SCHEMA =
  "build123d-execution-profile/1.0" as const;

export type Build123dMinimumDestructionAssurance =
  | "acknowledged-unattested"
  | "proven";

/** Identity only; the validator capability remains private to composition. */
export interface Build123dOutputValidatorRef {
  readonly id: string;
  readonly version: string;
}

/**
 * Immutable contract consumed by a future Build123d execution use case.
 *
 * `profileFingerprint` is the SHA-256 fingerprint of every other field in
 * this record. Keeping it outside its own preimage avoids a self-hash while
 * still committing the compilation, isolation, runtime, quota, output, and
 * destruction contracts together.
 */
export interface Build123dExecutionProfile {
  readonly schemaVersion: typeof BUILD123D_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly compilationTarget: Extract<
    TechnicalCompilationTarget,
    "build123d-source"
  >;
  readonly compilationProfile: TechnicalCompilationProfile;
  readonly compilationProfileFingerprint: ContentFingerprint;
  readonly isolationPolicy: IsolatedCodePolicyRef;
  /** Human-reviewable code-owned backend identity; never a capability. */
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly outputValidator: Build123dOutputValidatorRef;
  readonly maximumSourceBytes: number;
  readonly minimumDestructionAssurance: Build123dMinimumDestructionAssurance;
  readonly profileFingerprint: ContentFingerprint;
}

/** The exact body committed by `profileFingerprint`. */
export type Build123dExecutionProfileFingerprintBody = Omit<
  Build123dExecutionProfile,
  "profileFingerprint"
>;

/**
 * Closed server-owned profile catalogue. There is deliberately no list,
 * register, latest-version, or caller-supplied fallback operation.
 */
export interface Build123dExecutionProfileCatalog {
  /** The single code-owned initial profile for a newly sealed workflow. */
  initial(): Promise<Build123dExecutionProfile>;

  /** Reopen one exact persisted id/version pair, or fail closed. */
  resolve(
    executionProfile: IsolatedCodeProfileRef,
  ): Promise<Build123dExecutionProfile>;
}
