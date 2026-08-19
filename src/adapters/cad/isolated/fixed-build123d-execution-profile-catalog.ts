/**
 * Closed Build123d execution profile selected by server composition.
 *
 * The profile joins the exact qualified compilation frontend to one isolation
 * policy revision, one provisioned image digest, one runtime-attestation
 * contract, one output manifest, and one cleanup threshold. None of those
 * choices crosses the caller boundary.
 */

import type {
  Build123dExecutionProfile,
  Build123dExecutionProfileCatalog,
  Build123dExecutionProfileFingerprintBody,
  Build123dOutputValidatorRef,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import {
  BUILD123D_EXECUTION_PROFILE_SCHEMA,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import {
  type IsolatedCodeExecutionLimits,
  isolatedCodeOutputManifestsEqual,
  type IsolatedCodePolicyRef,
  type IsolatedCodeProfileRef,
  type IsolatedCodeRuntimeAttestation,
  validateContentFingerprint,
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  type MicrosandboxLocalRuntimeIdentity,
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationProfile,
  validateTechnicalCompilationProfileCatalog,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
} from "../../compile/captures/initial-technical-source-analysis-composition.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "../../compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";
import {
  OCCT_STEP_OUTPUT_VALIDATOR_REF,
} from "./occt-step-output-validator-contract.ts";

export const BUILD123D_EXECUTION_ISOLATION_CLASS = MICROSANDBOX_LOCAL_ISOLATION_CLASS;

export const MICROSANDBOX_BUILD123D_OUTPUT_MANIFEST =
  validateIsolatedCodeOutputManifest([BUILD123D_EXECUTION_OUTPUT]);

export interface FixedBuild123dExecutionProfileCatalogOptions {
  /** Reviewed OCI image name pinned by its immutable SHA-256 digest. */
  readonly imageReference: string;
  /** Code-owned isolation policy revision selected by the composition root. */
  readonly policy: IsolatedCodePolicyRef;
  /** Code-owned ceilings selected by the composition root. */
  readonly limits: IsolatedCodeExecutionLimits;
}

export class Build123dExecutionProfileNotRegisteredError extends Error {
  constructor(readonly id: string, readonly version: string) {
    super(`No Build123d execution profile is registered for ${id}@${version}.`);
    this.name = "Build123dExecutionProfileNotRegisteredError";
  }
}

const EXPECTED_COMPILATION_PROFILE = requireExpectedCompilationProfile();

/**
 * In-memory implementation with one exact registration and no mutable
 * registry surface. Construction accepts deployment facts only; callers of
 * the catalogue never do.
 */
export class FixedBuild123dExecutionProfileCatalog
  implements Build123dExecutionProfileCatalog {
  readonly #profile: Promise<Build123dExecutionProfile>;

  constructor(value: FixedBuild123dExecutionProfileCatalogOptions) {
    const options = exactRecord(
      value,
      ["imageReference", "policy", "limits"],
      "$build123dExecutionProfileCatalog",
    );
    const isolationPolicy = validateIsolatedCodePolicyRef(
      options.policy,
      "$build123dExecutionProfileCatalog.policy",
    );
    const imageReference = pinnedOciImageReference(
      options.imageReference,
      "$build123dExecutionProfileCatalog.imageReference",
    );
    const limits = validateIsolatedCodeExecutionLimits(
      options.limits,
      "$build123dExecutionProfileCatalog.limits",
    );
    const runtime = createMicrosandboxRuntimeAttestation({
      imageReference,
      limits,
    });
    const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity({
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference,
      imageDigest: runtime.imageDigest,
    }, "$build123dExecutionProfileCatalog.runtimeBackend");

    this.#profile = createFixedProfile({
      isolationPolicy,
      runtimeBackend,
      runtime,
    });
  }

  initial(): Promise<Build123dExecutionProfile> {
    if (arguments.length !== 0) {
      throw new TypeError("initial does not accept caller input.");
    }
    return this.#profile;
  }

  async resolve(
    value: IsolatedCodeProfileRef,
  ): Promise<Build123dExecutionProfile> {
    const executionProfile = validateIsolatedCodeProfileRef(
      value,
      "$executionProfile",
    );
    if (
      executionProfile.id !== BUILD123D_EXECUTION_PROFILE.id ||
      executionProfile.version !== BUILD123D_EXECUTION_PROFILE.version
    ) {
      throw new Build123dExecutionProfileNotRegisteredError(
        executionProfile.id,
        executionProfile.version,
      );
    }
    return await this.#profile;
  }
}

/**
 * Reopen a persisted profile fail-closed. Every record is closed, all nested
 * isolated-execution contracts are normalized, the compilation expectation is
 * compared with the code-owned qualified profile, and both hashes are
 * recomputed.
 */
export async function validateBuild123dExecutionProfile(
  value: unknown,
): Promise<Build123dExecutionProfile> {
  const profile = exactRecord(value, [
    "schemaVersion",
    "executionProfile",
    "compilationTarget",
    "compilationProfile",
    "compilationProfileFingerprint",
    "isolationPolicy",
    "runtimeBackend",
    "runtime",
    "outputManifest",
    "outputValidator",
    "maximumSourceBytes",
    "minimumDestructionAssurance",
    "profileFingerprint",
  ], "$build123dExecutionProfile");
  literalValue(
    profile.schemaVersion,
    BUILD123D_EXECUTION_PROFILE_SCHEMA,
    "$build123dExecutionProfile.schemaVersion",
  );

  const executionProfile = validateIsolatedCodeProfileRef(
    profile.executionProfile,
    "$build123dExecutionProfile.executionProfile",
  );
  assertExpectedExecutionProfile(executionProfile);
  literalValue(
    profile.compilationTarget,
    "build123d-source",
    "$build123dExecutionProfile.compilationTarget",
  );
  const compilationProfile = parseCompilationProfile(
    profile.compilationProfile,
  );
  assertCanonicalEqual(
    compilationProfile,
    EXPECTED_COMPILATION_PROFILE,
    "$build123dExecutionProfile.compilationProfile",
  );
  const compilationProfileFingerprint = validateContentFingerprint(
    profile.compilationProfileFingerprint,
    "$build123dExecutionProfile.compilationProfileFingerprint",
  );
  const observedCompilationFingerprint = await sha256Fingerprint(
    compilationProfile,
  );
  if (
    !fingerprintsEqual(
      compilationProfileFingerprint,
      observedCompilationFingerprint,
    )
  ) {
    throw new TypeError(
      "$build123dExecutionProfile.compilationProfileFingerprint does not match the exact compilation profile.",
    );
  }

  const isolationPolicy = validateIsolatedCodePolicyRef(
    profile.isolationPolicy,
    "$build123dExecutionProfile.isolationPolicy",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    profile.runtimeBackend,
    "$build123dExecutionProfile.runtimeBackend",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    profile.runtime,
    "$build123dExecutionProfile.runtime",
  );
  assertExpectedRuntimeContract(runtimeBackend, runtime);
  const outputManifest = validateIsolatedCodeOutputManifest(
    profile.outputManifest,
    "$build123dExecutionProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(
      outputManifest,
      MICROSANDBOX_BUILD123D_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError(
      "$build123dExecutionProfile.outputManifest must equal the code-owned Build123d manifest.",
    );
  }
  const outputValidator = validateOutputValidatorRef(
    profile.outputValidator,
    "$build123dExecutionProfile.outputValidator",
  );
  const maximumSourceBytes = positiveInteger(
    profile.maximumSourceBytes,
    "$build123dExecutionProfile.maximumSourceBytes",
  );
  if (maximumSourceBytes !== INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES) {
    throw new TypeError(
      "$build123dExecutionProfile.maximumSourceBytes must equal the qualified source-capture ceiling.",
    );
  }
  literalValue(
    profile.minimumDestructionAssurance,
    "proven",
    "$build123dExecutionProfile.minimumDestructionAssurance",
  );

  const body = deepFreeze<Build123dExecutionProfileFingerprintBody>({
    schemaVersion: BUILD123D_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    compilationTarget: "build123d-source",
    compilationProfile,
    compilationProfileFingerprint,
    isolationPolicy,
    runtimeBackend,
    runtime,
    outputManifest,
    outputValidator,
    maximumSourceBytes,
    minimumDestructionAssurance: "proven",
  });
  const profileFingerprint = validateContentFingerprint(
    profile.profileFingerprint,
    "$build123dExecutionProfile.profileFingerprint",
  );
  const observedProfileFingerprint = await sha256Fingerprint(body);
  if (!fingerprintsEqual(profileFingerprint, observedProfileFingerprint)) {
    throw new TypeError(
      "$build123dExecutionProfile.profileFingerprint does not match the complete profile body.",
    );
  }
  return deepFreeze({ ...body, profileFingerprint });
}

async function createFixedProfile(input: {
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
}): Promise<Build123dExecutionProfile> {
  const compilationProfileFingerprint = await sha256Fingerprint(
    EXPECTED_COMPILATION_PROFILE,
  );
  const body = deepFreeze<Build123dExecutionProfileFingerprintBody>({
    schemaVersion: BUILD123D_EXECUTION_PROFILE_SCHEMA,
    executionProfile: BUILD123D_EXECUTION_PROFILE,
    compilationTarget: "build123d-source",
    compilationProfile: EXPECTED_COMPILATION_PROFILE,
    compilationProfileFingerprint,
    isolationPolicy: input.isolationPolicy,
    runtimeBackend: input.runtimeBackend,
    runtime: input.runtime,
    outputManifest: MICROSANDBOX_BUILD123D_OUTPUT_MANIFEST,
    outputValidator: OCCT_STEP_OUTPUT_VALIDATOR_REF,
    maximumSourceBytes: INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
    minimumDestructionAssurance: "proven",
  });
  return await validateBuild123dExecutionProfile({
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  });
}

function requireExpectedCompilationProfile(): TechnicalCompilationProfile {
  const matches = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles.filter(
    (profile) =>
      profile.id === BUILD123D_EXECUTION_PROFILE.id &&
      profile.version === PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION &&
      profile.target === "build123d-source",
  );
  if (matches.length !== 1) {
    throw new TypeError(
      "The qualified compilation catalogue must contain exactly one profile matching the Build123d execution profile.",
    );
  }
  return matches[0]!;
}

function parseCompilationProfile(value: unknown): TechnicalCompilationProfile {
  return validateTechnicalCompilationProfileCatalog({
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [value],
  }).profiles[0]!;
}

function assertExpectedExecutionProfile(value: IsolatedCodeProfileRef): void {
  if (
    value.id !== BUILD123D_EXECUTION_PROFILE.id ||
    value.version !== BUILD123D_EXECUTION_PROFILE.version
  ) {
    throw new TypeError(
      "$build123dExecutionProfile.executionProfile is not the registered Build123d profile.",
    );
  }
}

function assertExpectedRuntimeContract(
  runtimeBackend: MicrosandboxLocalRuntimeIdentity,
  runtime: ReturnType<typeof validateIsolatedCodeRuntimeAttestation>,
): void {
  if (runtime.isolationClass !== BUILD123D_EXECUTION_ISOLATION_CLASS) {
    throw new TypeError(
      "$build123dExecutionProfile.runtime.isolationClass is not registered.",
    );
  }
  assertCanonicalEqual(
    runtime,
    createMicrosandboxRuntimeAttestation({
      imageReference: runtimeBackend.imageReference,
      limits: runtime.requestedLimits,
    }),
    "$build123dExecutionProfile.runtime",
  );
  if (!fingerprintsEqual(runtimeBackend.imageDigest, runtime.imageDigest)) {
    throw new TypeError(
      "$build123dExecutionProfile.runtimeBackend and runtime name different OCI images.",
    );
  }
}

function validateOutputValidatorRef(
  value: unknown,
  path: string,
): Build123dOutputValidatorRef {
  const ref = exactRecord(value, ["id", "version"], path);
  const normalized = deepFreeze({
    id: safeId(ref.id, `${path}.id`),
    version: safeVersion(ref.version, `${path}.version`),
  });
  assertCanonicalEqual(normalized, OCCT_STEP_OUTPUT_VALIDATOR_REF, path);
  return normalized;
}

function assertCanonicalEqual(
  actual: unknown,
  expected: unknown,
  path: string,
): void {
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError(`${path} does not match the code-owned contract.`);
  }
}
