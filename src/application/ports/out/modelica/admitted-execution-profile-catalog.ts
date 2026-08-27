/**
 * Read-only catalogue for the server-owned admitted Modelica execution contract.
 */

import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import type {
  TechnicalCompilationProfile,
  TechnicalCompilationTarget,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { MicrosandboxLocalRuntimeIdentity } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";

export const ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA =
  "modelica-admitted-execution-profile/2.0" as const;

export type AdmittedModelicaMinimumDestructionAssurance =
  | "acknowledged-unattested"
  | "proven";

export interface AdmittedModelicaOutputValidatorRef {
  readonly id: string;
  readonly version: string;
}

export interface AdmittedModelicaExecutionProfile {
  readonly schemaVersion: typeof ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly compilationTarget: Extract<
    TechnicalCompilationTarget,
    "modelica-source-qualification"
  >;
  readonly compilationProfile: TechnicalCompilationProfile;
  readonly compilationProfileFingerprint: ContentFingerprint;
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly outputValidator: AdmittedModelicaOutputValidatorRef;
  readonly maximumSourceBytes: number;
  readonly minimumDestructionAssurance: AdmittedModelicaMinimumDestructionAssurance;
  readonly profileFingerprint: ContentFingerprint;
}

export type AdmittedModelicaExecutionProfileFingerprintBody = Omit<
  AdmittedModelicaExecutionProfile,
  "profileFingerprint"
>;

export interface AdmittedModelicaExecutionProfileCatalog {
  initial(): Promise<AdmittedModelicaExecutionProfile>;
  resolve(
    executionProfile: IsolatedCodeProfileRef,
  ): Promise<AdmittedModelicaExecutionProfile>;
}
