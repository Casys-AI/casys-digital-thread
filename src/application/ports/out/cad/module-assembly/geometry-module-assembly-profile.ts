/** Read-only server-owned profile for one isolated module-assembly execution. */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { MicrosandboxLocalRuntimeIdentity } from "../../../../../domain/compile/isolation/local-isolation-runtime.ts";

export const GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE_SCHEMA =
  "geometry-module-assembly-execution-profile/1.0" as const;

export interface GeometryModuleAssemblyExecutionProfile {
  readonly schemaVersion: typeof GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly imageReference: string;
  readonly wrapper: {
    readonly id: "build123d-module-assembler-v1";
    readonly version: "1.0.0";
    readonly sha256: string;
    readonly invocation: "direct-executable-no-shell";
  };
  readonly lowering: {
    readonly id: "geometry.module.immediate-compound";
    readonly version: "1.0";
    readonly source: "reviewed-child-step-and-placement-bundle";
  };
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly limits: IsolatedCodeExecutionLimits;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly outputValidator: {
    readonly id: "geometry-module-assembly-output-validator";
    readonly version: "1.0.0";
  };
  readonly maximumBundleBytes: number;
  readonly minimumDestructionAssurance: "proven";
  readonly profileFingerprint: ContentFingerprint;
}

export interface GeometryModuleAssemblyExecutionProfileCatalog {
  initial(): Promise<GeometryModuleAssemblyExecutionProfile>;
  resolve(
    profile: IsolatedCodeProfileRef,
  ): Promise<GeometryModuleAssemblyExecutionProfile>;
}
