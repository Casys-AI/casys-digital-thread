/**
 * Closed admitted-SPICE execution profile selected by server composition.
 */

import type {
  AdmittedSpiceExecutionProfile,
  AdmittedSpiceExecutionProfileCatalog,
  AdmittedSpiceExecutionProfileFingerprintBody,
} from "../../../../application/ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import {
  ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
} from "../../../../application/ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
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
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  SPICE_ADMITTED_EXECUTION_PROFILE,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_OUTPUT_VALIDATOR,
} from "../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  type MicrosandboxLocalRuntimeIdentity,
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationProfile,
  validateTechnicalCompilationProfileCatalog,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { SPICE_ADMITTED_MAX_SOURCE_BYTES } from "../../../../domain/electrical/spice/admitted/contract.ts";
import { INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG } from "../../../compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";

export const MICROSANDBOX_ADMITTED_SPICE_OUTPUT_MANIFEST =
  validateIsolatedCodeOutputManifest([...SPICE_ADMITTED_OUTPUT_MANIFEST]);

export interface FixedAdmittedSpiceExecutionProfileCatalogOptions {
  readonly imageReference: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
}

export class AdmittedSpiceExecutionProfileNotRegisteredError extends Error {
  constructor(readonly id: string, readonly version: string) {
    super(
      `No admitted SPICE execution profile is registered for ${id}@${version}.`,
    );
    this.name = "AdmittedSpiceExecutionProfileNotRegisteredError";
  }
}

const EXPECTED_COMPILATION_PROFILE = requireExpectedCompilationProfile();

export class FixedAdmittedSpiceExecutionProfileCatalog
  implements AdmittedSpiceExecutionProfileCatalog {
  readonly #profile: Promise<AdmittedSpiceExecutionProfile>;

  constructor(value: FixedAdmittedSpiceExecutionProfileCatalogOptions) {
    const options = exactRecord(
      value,
      ["imageReference", "policy", "limits"],
      "$admittedSpiceExecutionProfileCatalog",
    );
    const isolationPolicy = validateIsolatedCodePolicyRef(
      options.policy,
      "$admittedSpiceExecutionProfileCatalog.policy",
    );
    const imageReference = pinnedOciImageReference(
      options.imageReference,
      "$admittedSpiceExecutionProfileCatalog.imageReference",
    );
    const limits = validateIsolatedCodeExecutionLimits(
      options.limits,
      "$admittedSpiceExecutionProfileCatalog.limits",
    );
    const runtime = createMicrosandboxRuntimeAttestation({
      imageReference,
      limits,
    });
    const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity({
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference,
      imageDigest: runtime.imageDigest,
    }, "$admittedSpiceExecutionProfileCatalog.runtimeBackend");

    this.#profile = createFixedProfile({
      isolationPolicy,
      runtimeBackend,
      runtime,
    });
  }

  initial(): Promise<AdmittedSpiceExecutionProfile> {
    if (arguments.length !== 0) {
      throw new TypeError("initial does not accept caller input.");
    }
    return this.#profile;
  }

  async resolve(
    value: IsolatedCodeProfileRef,
  ): Promise<AdmittedSpiceExecutionProfile> {
    const executionProfile = validateIsolatedCodeProfileRef(
      value,
      "$executionProfile",
    );
    if (
      executionProfile.id !== SPICE_ADMITTED_EXECUTION_PROFILE.id ||
      executionProfile.version !== SPICE_ADMITTED_EXECUTION_PROFILE.version
    ) {
      throw new AdmittedSpiceExecutionProfileNotRegisteredError(
        executionProfile.id,
        executionProfile.version,
      );
    }
    return await this.#profile;
  }
}

export async function validateAdmittedSpiceExecutionProfile(
  value: unknown,
): Promise<AdmittedSpiceExecutionProfile> {
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
  ], "$admittedSpiceExecutionProfile");
  literalValue(
    profile.schemaVersion,
    ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    "$admittedSpiceExecutionProfile.schemaVersion",
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    profile.executionProfile,
    "$admittedSpiceExecutionProfile.executionProfile",
  );
  if (
    executionProfile.id !== SPICE_ADMITTED_EXECUTION_PROFILE.id ||
    executionProfile.version !== SPICE_ADMITTED_EXECUTION_PROFILE.version
  ) {
    throw new TypeError("The execution profile is not admitted SPICE v2.");
  }
  literalValue(
    profile.compilationTarget,
    "spice-circuit-source",
    "$admittedSpiceExecutionProfile.compilationTarget",
  );
  const compilationProfile = validateTechnicalCompilationProfileCatalog({
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [profile.compilationProfile],
  }).profiles[0]!;
  if (
    deterministicJson(compilationProfile) !==
      deterministicJson(EXPECTED_COMPILATION_PROFILE)
  ) {
    throw new TypeError(
      "$admittedSpiceExecutionProfile.compilationProfile is not the catalog SPICE profile.",
    );
  }
  const compilationProfileFingerprint = validateContentFingerprint(
    profile.compilationProfileFingerprint,
    "$admittedSpiceExecutionProfile.compilationProfileFingerprint",
  );
  if (
    !fingerprintsEqual(
      compilationProfileFingerprint,
      await sha256Fingerprint(compilationProfile),
    )
  ) {
    throw new TypeError("The compilation profile fingerprint is stale.");
  }
  const isolationPolicy = validateIsolatedCodePolicyRef(
    profile.isolationPolicy,
    "$admittedSpiceExecutionProfile.isolationPolicy",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    profile.runtimeBackend,
    "$admittedSpiceExecutionProfile.runtimeBackend",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    profile.runtime,
    "$admittedSpiceExecutionProfile.runtime",
  );
  if (runtimeBackend.imageDigest.digest !== runtime.imageDigest.digest) {
    throw new TypeError("The admitted SPICE runtime names two OCI images.");
  }
  const outputManifest = validateIsolatedCodeOutputManifest(
    profile.outputManifest,
    "$admittedSpiceExecutionProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(
      outputManifest,
      MICROSANDBOX_ADMITTED_SPICE_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError("The admitted SPICE output manifest is not registered.");
  }
  const outputValidatorRecord = exactRecord(
    profile.outputValidator,
    ["id", "version"],
    "$admittedSpiceExecutionProfile.outputValidator",
  );
  const outputValidator = deepFreeze({
    id: safeId(
      outputValidatorRecord.id,
      "$admittedSpiceExecutionProfile.outputValidator.id",
    ),
    version: safeVersion(
      outputValidatorRecord.version,
      "$admittedSpiceExecutionProfile.outputValidator.version",
    ),
  });
  if (
    deterministicJson(outputValidator) !==
      deterministicJson(SPICE_ADMITTED_OUTPUT_VALIDATOR)
  ) {
    throw new TypeError("The admitted SPICE output validator is not registered.");
  }
  const maximumSourceBytes = positiveInteger(
    profile.maximumSourceBytes,
    "$admittedSpiceExecutionProfile.maximumSourceBytes",
  );
  if (maximumSourceBytes !== SPICE_ADMITTED_MAX_SOURCE_BYTES) {
    throw new TypeError("The admitted SPICE source ceiling is not registered.");
  }
  literalValue(
    profile.minimumDestructionAssurance,
    "proven",
    "$admittedSpiceExecutionProfile.minimumDestructionAssurance",
  );
  const body = deepFreeze<AdmittedSpiceExecutionProfileFingerprintBody>({
    schemaVersion: ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    compilationTarget: "spice-circuit-source",
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
    "$admittedSpiceExecutionProfile.profileFingerprint",
  );
  if (!fingerprintsEqual(profileFingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("The admitted SPICE profile fingerprint is stale.");
  }
  return deepFreeze({ ...body, profileFingerprint });
}

async function createFixedProfile(input: {
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
}): Promise<AdmittedSpiceExecutionProfile> {
  const compilationProfileFingerprint = await sha256Fingerprint(
    EXPECTED_COMPILATION_PROFILE,
  );
  const body = deepFreeze<AdmittedSpiceExecutionProfileFingerprintBody>({
    schemaVersion: ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    executionProfile: SPICE_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "spice-circuit-source",
    compilationProfile: EXPECTED_COMPILATION_PROFILE,
    compilationProfileFingerprint,
    isolationPolicy: input.isolationPolicy,
    runtimeBackend: input.runtimeBackend,
    runtime: input.runtime,
    outputManifest: MICROSANDBOX_ADMITTED_SPICE_OUTPUT_MANIFEST,
    outputValidator: SPICE_ADMITTED_OUTPUT_VALIDATOR,
    maximumSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
    minimumDestructionAssurance: "proven",
  });
  return await validateAdmittedSpiceExecutionProfile({
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  });
}

function requireExpectedCompilationProfile(): TechnicalCompilationProfile {
  const matches = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles.filter(
    (profile) =>
      profile.id === SPICE_ADMITTED_EXECUTION_PROFILE.id &&
      profile.version === SPICE_ADMITTED_EXECUTION_PROFILE.version &&
      profile.target === "spice-circuit-source",
  );
  if (matches.length !== 1) {
    throw new TypeError(
      "The compilation catalogue must contain exactly one SPICE closed-subset profile.",
    );
  }
  return matches[0]!;
}
