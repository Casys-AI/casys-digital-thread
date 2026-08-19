/** Read-only server-owned contract for locally isolated Modelica execution. */

import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { ModelicaIsolatedInputBundle } from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import type { MicrosandboxLocalRuntimeIdentity } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export const MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA =
  "modelica-isolated-execution-profile/1.0" as const;

export interface ModelicaIsolatedExecutionProfile {
  readonly schemaVersion: typeof MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly qualifiedContract: {
    readonly id: "modelica-qualified-manifest";
    readonly version: "1.0";
  };
  readonly method: ModelicaIsolatedInputBundle["method"];
  readonly wrapper: {
    readonly id: "modelica-qualified-kit-wrapper";
    readonly version: "1.0.0";
    readonly sha256: string;
    readonly invocation: "direct-executable-no-shell";
  };
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly outputValidator: {
    readonly id: "modelica-isolated-output-validator";
    readonly version: "1.0.0";
  };
  readonly maximumBundleBytes: number;
  readonly minimumDestructionAssurance: "proven";
  /**
   * Runtime qualification is deliberately not a self-asserted profile field.
   * The execution use case requires a separately reopened, publication-backed
   * qualification capture for this exact profile fingerprint.
   */
  readonly profileFingerprint: ContentFingerprint;
}

export type ModelicaIsolatedExecutionProfileFingerprintBody = Omit<
  ModelicaIsolatedExecutionProfile,
  "profileFingerprint"
>;

export interface ModelicaIsolatedExecutionProfileCatalog {
  initial(): Promise<ModelicaIsolatedExecutionProfile>;
  resolve(
    profile: IsolatedCodeProfileRef,
  ): Promise<ModelicaIsolatedExecutionProfile>;
}
