/**
 * Read-only catalogue for the server-owned admitted SPICE execution contract.
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

export const ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA =
  "spice-admitted-execution-profile/1.0" as const;

export type AdmittedSpiceMinimumDestructionAssurance =
  | "acknowledged-unattested"
  | "proven";

export interface AdmittedSpiceOutputValidatorRef {
  readonly id: string;
  readonly version: string;
}

export interface AdmittedSpiceExecutionProfile {
  readonly schemaVersion: typeof ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly compilationTarget: Extract<
    TechnicalCompilationTarget,
    "spice-circuit-source"
  >;
  readonly compilationProfile: TechnicalCompilationProfile;
  readonly compilationProfileFingerprint: ContentFingerprint;
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly outputValidator: AdmittedSpiceOutputValidatorRef;
  readonly maximumSourceBytes: number;
  readonly minimumDestructionAssurance: AdmittedSpiceMinimumDestructionAssurance;
  readonly profileFingerprint: ContentFingerprint;
}

export type AdmittedSpiceExecutionProfileFingerprintBody = Omit<
  AdmittedSpiceExecutionProfile,
  "profileFingerprint"
>;

export interface AdmittedSpiceExecutionProfileCatalog {
  initial(): Promise<AdmittedSpiceExecutionProfile>;
  resolve(
    executionProfile: IsolatedCodeProfileRef,
  ): Promise<AdmittedSpiceExecutionProfile>;
}
