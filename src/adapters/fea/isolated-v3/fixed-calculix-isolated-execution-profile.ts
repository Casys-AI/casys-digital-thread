/** Closed CalculiX-on-Microsandbox profile; no caller can register commands. */

import {
  CALCULIX_ISOLATED_EXECUTION_PROFILE_SCHEMA,
  type CalculixIsolatedExecutionProfile,
  type CalculixIsolatedExecutionProfileCatalog,
} from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  isolatedCodeOutputManifestsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  CALCULIX_ISOLATED_EXECUTION_PROFILE,
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { sha256Hex } from "../../../domain/compile/source/provider-resource-reader.ts";

export const CALCULIX_MAXIMUM_ISOLATED_BUNDLE_BYTES = 256 * 1_048_576;
export const CALCULIX_ISOLATED_OUTPUT_VALIDATOR = Object.freeze({
  id: "calculix-isolated-output-validator" as const,
  version: "1.0.0" as const,
});

export interface FixedCalculixIsolatedExecutionProfileOptions {
  readonly imageReference: string;
  readonly wrapperSha256: string;
  readonly policy: unknown;
  readonly limits: IsolatedCodeExecutionLimits;
}

export class CalculixIsolatedExecutionProfileNotRegisteredError extends Error {
  constructor(readonly id: string, readonly version: string) {
    super(`No isolated CalculiX profile is registered for ${id}@${version}.`);
    this.name = "CalculixIsolatedExecutionProfileNotRegisteredError";
  }
}

export class FixedCalculixIsolatedExecutionProfileCatalog
  implements CalculixIsolatedExecutionProfileCatalog {
  readonly #profile: Promise<CalculixIsolatedExecutionProfile>;

  constructor(options: FixedCalculixIsolatedExecutionProfileOptions) {
    const root = exactRecord(
      options,
      ["imageReference", "wrapperSha256", "policy", "limits"],
      "$calculixExecutionProfile",
    );
    this.#profile = createProfile(root);
  }

  initial(): Promise<CalculixIsolatedExecutionProfile> {
    if (arguments.length !== 0) throw new TypeError("initial accepts no input.");
    return this.#profile;
  }

  async resolve(value: unknown): Promise<CalculixIsolatedExecutionProfile> {
    const profile = validateIsolatedCodeProfileRef(value, "$executionProfile");
    if (
      profile.id !== CALCULIX_ISOLATED_EXECUTION_PROFILE.id ||
      profile.version !== CALCULIX_ISOLATED_EXECUTION_PROFILE.version
    ) {
      throw new CalculixIsolatedExecutionProfileNotRegisteredError(
        profile.id,
        profile.version,
      );
    }
    return await this.#profile;
  }
}

export async function validateCalculixIsolatedExecutionProfile(
  value: unknown,
): Promise<CalculixIsolatedExecutionProfile> {
  const root = exactRecord(value, [
    "schemaVersion",
    "executionProfile",
    "imageReference",
    "wrapper",
    "lowering",
    "isolationPolicy",
    "runtimeBackend",
    "runtime",
    "limits",
    "outputManifest",
    "outputValidator",
    "maximumBundleBytes",
    "minimumDestructionAssurance",
    "profileFingerprint",
  ], "$calculixExecutionProfile");
  literalValue(
    root.schemaVersion,
    CALCULIX_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    "$calculixExecutionProfile.schemaVersion",
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    root.executionProfile,
    "$calculixExecutionProfile.executionProfile",
  );
  assertRegistered(executionProfile, CALCULIX_ISOLATED_EXECUTION_PROFILE);
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    "$calculixExecutionProfile.imageReference",
  );
  const imageDigest = imageReference.slice(imageReference.lastIndexOf("@sha256:") + 8);
  const wrapper = exactRecord(
    root.wrapper,
    ["id", "version", "sha256", "invocation"],
    "$calculixExecutionProfile.wrapper",
  );
  literalValue(
    wrapper.id,
    "calculix-static-proof-v1",
    "$calculixExecutionProfile.wrapper.id",
  );
  literalValue(wrapper.version, "1.0.0", "$calculixExecutionProfile.wrapper.version");
  literalValue(
    wrapper.invocation,
    "direct-executable-no-shell",
    "$calculixExecutionProfile.wrapper.invocation",
  );
  const lowering = exactRecord(
    root.lowering,
    ["id", "version", "source"],
    "$calculixExecutionProfile.lowering",
  );
  literalValue(
    lowering.id,
    "calculix.static.abaqus-deck",
    "$calculixExecutionProfile.lowering.id",
  );
  literalValue(lowering.version, "1.0", "$calculixExecutionProfile.lowering.version");
  literalValue(
    lowering.source,
    "reviewed-proof-case-and-exact-step-bundle",
    "$calculixExecutionProfile.lowering.source",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    root.runtimeBackend,
    "$calculixExecutionProfile.runtimeBackend",
  );
  if (
    runtimeBackend.imageReference !== imageReference ||
    runtimeBackend.imageDigest.digest !== imageDigest
  ) {
    throw new TypeError(
      "The CalculiX runtime backend differs from its OCI image reference.",
    );
  }
  const limits = validateIsolatedCodeExecutionLimits(
    root.limits,
    "$calculixExecutionProfile.limits",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    root.runtime,
    "$calculixExecutionProfile.runtime",
  );
  const expectedRuntime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits,
  });
  if (deterministicJson(runtime) !== deterministicJson(expectedRuntime)) {
    throw new TypeError(
      "The CalculiX runtime attestation differs from the local Microsandbox contract.",
    );
  }
  const outputManifest = validateIsolatedCodeOutputManifest(
    root.outputManifest,
    "$calculixExecutionProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(outputManifest, CALCULIX_ISOLATED_OUTPUT_MANIFEST)
  ) {
    throw new TypeError("The CalculiX output manifest is not registered.");
  }
  const validator = exactRecord(
    root.outputValidator,
    ["id", "version"],
    "$calculixExecutionProfile.outputValidator",
  );
  assertRegistered(validator, CALCULIX_ISOLATED_OUTPUT_VALIDATOR);
  const maximumBundleBytes = positiveInteger(
    root.maximumBundleBytes,
    "$calculixExecutionProfile.maximumBundleBytes",
  );
  if (maximumBundleBytes !== CALCULIX_MAXIMUM_ISOLATED_BUNDLE_BYTES) {
    throw new TypeError("The CalculiX bundle ceiling is not registered.");
  }
  literalValue(
    root.minimumDestructionAssurance,
    "proven",
    "$calculixExecutionProfile.minimumDestructionAssurance",
  );
  const body = deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    imageReference,
    wrapper: {
      id: "calculix-static-proof-v1" as const,
      version: "1.0.0" as const,
      sha256: sha256Hex(wrapper.sha256, "$calculixExecutionProfile.wrapper.sha256"),
      invocation: "direct-executable-no-shell" as const,
    },
    lowering: {
      id: "calculix.static.abaqus-deck" as const,
      version: "1.0" as const,
      source: "reviewed-proof-case-and-exact-step-bundle" as const,
    },
    isolationPolicy: validateIsolatedCodePolicyRef(
      root.isolationPolicy,
      "$calculixExecutionProfile.isolationPolicy",
    ),
    runtimeBackend,
    runtime,
    limits,
    outputManifest,
    outputValidator: CALCULIX_ISOLATED_OUTPUT_VALIDATOR,
    maximumBundleBytes,
    minimumDestructionAssurance: "proven" as const,
  });
  const profileFingerprint = validateContentFingerprint(
    root.profileFingerprint,
    "$calculixExecutionProfile.profileFingerprint",
  );
  if (!fingerprintsEqual(profileFingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("The CalculiX profile fingerprint is stale.");
  }
  return deepFreeze({ ...body, profileFingerprint });
}

async function createProfile(
  root: Record<string, unknown>,
): Promise<CalculixIsolatedExecutionProfile> {
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    "$calculixExecutionProfile.imageReference",
  );
  const limits = validateIsolatedCodeExecutionLimits(
    root.limits,
    "$calculixExecutionProfile.limits",
  );
  const runtime = createMicrosandboxRuntimeAttestation({ imageReference, limits });
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity({
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference,
    imageDigest: runtime.imageDigest,
  });
  const body = {
    schemaVersion: CALCULIX_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    executionProfile: CALCULIX_ISOLATED_EXECUTION_PROFILE,
    imageReference,
    wrapper: {
      id: "calculix-static-proof-v1",
      version: "1.0.0",
      sha256: sha256Hex(root.wrapperSha256, "$calculixExecutionProfile.wrapperSha256"),
      invocation: "direct-executable-no-shell",
    },
    lowering: {
      id: "calculix.static.abaqus-deck",
      version: "1.0",
      source: "reviewed-proof-case-and-exact-step-bundle",
    },
    isolationPolicy: validateIsolatedCodePolicyRef(root.policy),
    runtimeBackend,
    runtime,
    limits,
    outputManifest: CALCULIX_ISOLATED_OUTPUT_MANIFEST,
    outputValidator: CALCULIX_ISOLATED_OUTPUT_VALIDATOR,
    maximumBundleBytes: CALCULIX_MAXIMUM_ISOLATED_BUNDLE_BYTES,
    minimumDestructionAssurance: "proven",
  };
  return await validateCalculixIsolatedExecutionProfile({
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  });
}

function assertRegistered(actual: unknown, expected: unknown): void {
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError("The CalculiX profile value is not registered.");
  }
}
