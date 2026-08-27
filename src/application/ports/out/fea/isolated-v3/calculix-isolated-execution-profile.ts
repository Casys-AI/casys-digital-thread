/** Read-only server-owned profile for one isolated CalculiX proof execution. */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { MicrosandboxLocalRuntimeIdentity } from "../../../../../domain/compile/isolation/local-isolation-runtime.ts";

export const CALCULIX_ISOLATED_EXECUTION_PROFILE_SCHEMA =
  "calculix-isolated-execution-profile/1.0" as const;

export interface CalculixIsolatedExecutionProfile {
  readonly schemaVersion: typeof CALCULIX_ISOLATED_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: IsolatedCodeProfileRef;
  /** OCI reference including an explicit `@sha256:<digest>` suffix. */
  readonly imageReference: string;
  readonly wrapper: {
    readonly id: "calculix-static-proof-v1";
    readonly version: "1.0.0";
    readonly sha256: string;
    readonly invocation: "direct-executable-no-shell";
  };
  readonly lowering: {
    readonly id: "calculix.static.abaqus-deck";
    readonly version: "1.0";
    readonly source: "reviewed-proof-case-and-exact-step-bundle";
  };
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly limits: IsolatedCodeExecutionLimits;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly outputValidator: {
    readonly id: "calculix-isolated-output-validator";
    readonly version: "1.0.0";
  };
  readonly maximumBundleBytes: number;
  readonly minimumDestructionAssurance: "proven";
  readonly profileFingerprint: ContentFingerprint;
}

export interface CalculixIsolatedExecutionProfileCatalog {
  initial(): Promise<CalculixIsolatedExecutionProfile>;
  resolve(profile: IsolatedCodeProfileRef): Promise<CalculixIsolatedExecutionProfile>;
}
