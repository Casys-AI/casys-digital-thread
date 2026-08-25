/** Closed module-assembler-on-Microsandbox profile; no caller can register commands. */

import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE_SCHEMA,
  type GeometryModuleAssemblyExecutionProfile,
  type GeometryModuleAssemblyExecutionProfileCatalog,
} from "../../../application/ports/out/cad/module-assembly/geometry-module-assembly-profile.ts";
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
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_VALIDATOR,
} from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
import { GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
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

export const GEOMETRY_MODULE_MAXIMUM_ISOLATED_BUNDLE_BYTES =
  GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES;

export interface FixedGeometryModuleAssemblyProfileOptions {
  readonly imageReference: string;
  readonly wrapperSha256: string;
  readonly policy: unknown;
  readonly limits: IsolatedCodeExecutionLimits;
}

export class GeometryModuleAssemblyProfileNotRegisteredError extends Error {
  constructor(readonly id: string, readonly version: string) {
    super(`No module-assembly profile is registered for ${id}@${version}.`);
    this.name = "GeometryModuleAssemblyProfileNotRegisteredError";
  }
}

export class FixedGeometryModuleAssemblyProfileCatalog
  implements GeometryModuleAssemblyExecutionProfileCatalog {
  readonly #profile: Promise<GeometryModuleAssemblyExecutionProfile>;

  constructor(options: FixedGeometryModuleAssemblyProfileOptions) {
    const root = exactRecord(
      options,
      ["imageReference", "wrapperSha256", "policy", "limits"],
      "$geometryModuleAssemblyProfile",
    );
    this.#profile = createProfile(root);
  }

  initial(): Promise<GeometryModuleAssemblyExecutionProfile> {
    if (arguments.length !== 0) throw new TypeError("initial accepts no input.");
    return this.#profile;
  }

  async resolve(value: unknown): Promise<GeometryModuleAssemblyExecutionProfile> {
    const profile = validateIsolatedCodeProfileRef(value, "$executionProfile");
    if (
      profile.id !== GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id ||
      profile.version !== GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version
    ) {
      throw new GeometryModuleAssemblyProfileNotRegisteredError(
        profile.id,
        profile.version,
      );
    }
    return await this.#profile;
  }
}

export async function validateGeometryModuleAssemblyExecutionProfile(
  value: unknown,
): Promise<GeometryModuleAssemblyExecutionProfile> {
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
  ], "$geometryModuleAssemblyProfile");
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE_SCHEMA,
    "$geometryModuleAssemblyProfile.schemaVersion",
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    root.executionProfile,
    "$geometryModuleAssemblyProfile.executionProfile",
  );
  assertRegistered(executionProfile, GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE);
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    "$geometryModuleAssemblyProfile.imageReference",
  );
  const imageDigest = imageReference.slice(imageReference.lastIndexOf("@sha256:") + 8);
  const wrapper = exactRecord(
    root.wrapper,
    ["id", "version", "sha256", "invocation"],
    "$geometryModuleAssemblyProfile.wrapper",
  );
  literalValue(
    wrapper.id,
    "build123d-module-assembler-v1",
    "$geometryModuleAssemblyProfile.wrapper.id",
  );
  literalValue(
    wrapper.version,
    "1.0.0",
    "$geometryModuleAssemblyProfile.wrapper.version",
  );
  literalValue(
    wrapper.invocation,
    "direct-executable-no-shell",
    "$geometryModuleAssemblyProfile.wrapper.invocation",
  );
  const lowering = exactRecord(
    root.lowering,
    ["id", "version", "source"],
    "$geometryModuleAssemblyProfile.lowering",
  );
  literalValue(
    lowering.id,
    "geometry.module.immediate-compound",
    "$geometryModuleAssemblyProfile.lowering.id",
  );
  literalValue(
    lowering.version,
    "1.0",
    "$geometryModuleAssemblyProfile.lowering.version",
  );
  literalValue(
    lowering.source,
    "reviewed-child-step-and-placement-bundle",
    "$geometryModuleAssemblyProfile.lowering.source",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    root.runtimeBackend,
    "$geometryModuleAssemblyProfile.runtimeBackend",
  );
  if (
    runtimeBackend.imageReference !== imageReference ||
    runtimeBackend.imageDigest.digest !== imageDigest
  ) {
    throw new TypeError(
      "The module-assembly runtime backend differs from its OCI image reference.",
    );
  }
  const limits = validateIsolatedCodeExecutionLimits(
    root.limits,
    "$geometryModuleAssemblyProfile.limits",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    root.runtime,
    "$geometryModuleAssemblyProfile.runtime",
  );
  const expectedRuntime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits,
  });
  if (deterministicJson(runtime) !== deterministicJson(expectedRuntime)) {
    throw new TypeError(
      "The module-assembly runtime attestation differs from the local Microsandbox contract.",
    );
  }
  const outputManifest = validateIsolatedCodeOutputManifest(
    root.outputManifest,
    "$geometryModuleAssemblyProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(
      outputManifest,
      GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError("The module-assembly output manifest is not registered.");
  }
  const validator = exactRecord(
    root.outputValidator,
    ["id", "version"],
    "$geometryModuleAssemblyProfile.outputValidator",
  );
  assertRegistered(validator, GEOMETRY_MODULE_ASSEMBLY_OUTPUT_VALIDATOR);
  const maximumBundleBytes = positiveInteger(
    root.maximumBundleBytes,
    "$geometryModuleAssemblyProfile.maximumBundleBytes",
  );
  if (maximumBundleBytes !== GEOMETRY_MODULE_MAXIMUM_ISOLATED_BUNDLE_BYTES) {
    throw new TypeError("The module-assembly bundle ceiling is not registered.");
  }
  literalValue(
    root.minimumDestructionAssurance,
    "proven",
    "$geometryModuleAssemblyProfile.minimumDestructionAssurance",
  );
  const body = deepFreeze({
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    imageReference,
    wrapper: {
      id: "build123d-module-assembler-v1" as const,
      version: "1.0.0" as const,
      sha256: sha256Hex(
        wrapper.sha256,
        "$geometryModuleAssemblyProfile.wrapper.sha256",
      ),
      invocation: "direct-executable-no-shell" as const,
    },
    lowering: {
      id: "geometry.module.immediate-compound" as const,
      version: "1.0" as const,
      source: "reviewed-child-step-and-placement-bundle" as const,
    },
    isolationPolicy: validateIsolatedCodePolicyRef(
      root.isolationPolicy,
      "$geometryModuleAssemblyProfile.isolationPolicy",
    ),
    runtimeBackend,
    runtime,
    limits,
    outputManifest,
    outputValidator: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_VALIDATOR,
    maximumBundleBytes,
    minimumDestructionAssurance: "proven" as const,
  });
  const profileFingerprint = validateContentFingerprint(
    root.profileFingerprint,
    "$geometryModuleAssemblyProfile.profileFingerprint",
  );
  if (!fingerprintsEqual(profileFingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("The module-assembly profile fingerprint is stale.");
  }
  return deepFreeze({ ...body, profileFingerprint });
}

async function createProfile(
  root: Record<string, unknown>,
): Promise<GeometryModuleAssemblyExecutionProfile> {
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    "$geometryModuleAssemblyProfile.imageReference",
  );
  const limits = validateIsolatedCodeExecutionLimits(
    root.limits,
    "$geometryModuleAssemblyProfile.limits",
  );
  const runtime = createMicrosandboxRuntimeAttestation({ imageReference, limits });
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity({
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference,
    imageDigest: runtime.imageDigest,
  });
  const body = {
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE_SCHEMA,
    executionProfile: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
    imageReference,
    wrapper: {
      id: "build123d-module-assembler-v1",
      version: "1.0.0",
      sha256: sha256Hex(
        root.wrapperSha256,
        "$geometryModuleAssemblyProfile.wrapperSha256",
      ),
      invocation: "direct-executable-no-shell",
    },
    lowering: {
      id: "geometry.module.immediate-compound",
      version: "1.0",
      source: "reviewed-child-step-and-placement-bundle",
    },
    isolationPolicy: validateIsolatedCodePolicyRef(root.policy),
    runtimeBackend,
    runtime,
    limits,
    outputManifest: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    outputValidator: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_VALIDATOR,
    maximumBundleBytes: GEOMETRY_MODULE_MAXIMUM_ISOLATED_BUNDLE_BYTES,
    minimumDestructionAssurance: "proven",
  };
  return await validateGeometryModuleAssemblyExecutionProfile({
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  });
}

function assertRegistered(actual: unknown, expected: unknown): void {
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError("The module-assembly profile value is not registered.");
  }
}
