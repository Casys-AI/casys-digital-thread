/**
 * Closed admitted-Modelica execution profile selected by server composition.
 */

import type {
  AdmittedModelicaExecutionProfile,
  AdmittedModelicaExecutionProfileCatalog,
  AdmittedModelicaExecutionProfileFingerprintBody,
} from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
import {
  ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
} from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
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
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  MODELICA_ADMITTED_OUTPUT_VALIDATOR,
} from "../../../domain/modelica/admitted/run-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  type MicrosandboxLocalRuntimeIdentity,
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
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
import { QUALIFIED_MODELICA_MAX_SOURCE_BYTES } from "../source/source-analysis-composition.ts";
import { INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG } from "../../compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";

export const MODELICA_ADMITTED_OUTPUT_VALIDATOR_REF =
  MODELICA_ADMITTED_OUTPUT_VALIDATOR;

export const MICROSANDBOX_ADMITTED_MODELICA_OUTPUT_MANIFEST =
  validateIsolatedCodeOutputManifest([...MODELICA_ADMITTED_OUTPUT_MANIFEST]);

export interface FixedAdmittedModelicaExecutionProfileCatalogOptions {
  readonly imageReference: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
}

export class AdmittedModelicaExecutionProfileNotRegisteredError extends Error {
  constructor(readonly id: string, readonly version: string) {
    super(
      `No admitted Modelica execution profile is registered for ${id}@${version}.`,
    );
    this.name = "AdmittedModelicaExecutionProfileNotRegisteredError";
  }
}

const EXPECTED_COMPILATION_PROFILE = requireExpectedCompilationProfile();

export class FixedAdmittedModelicaExecutionProfileCatalog
  implements AdmittedModelicaExecutionProfileCatalog {
  readonly #profile: Promise<AdmittedModelicaExecutionProfile>;

  constructor(value: FixedAdmittedModelicaExecutionProfileCatalogOptions) {
    const options = exactRecord(
      value,
      ["imageReference", "policy", "limits"],
      "$admittedModelicaExecutionProfileCatalog",
    );
    const isolationPolicy = validateIsolatedCodePolicyRef(
      options.policy,
      "$admittedModelicaExecutionProfileCatalog.policy",
    );
    const imageReference = pinnedOciImageReference(
      options.imageReference,
      "$admittedModelicaExecutionProfileCatalog.imageReference",
    );
    const limits = validateIsolatedCodeExecutionLimits(
      options.limits,
      "$admittedModelicaExecutionProfileCatalog.limits",
    );
    const runtime = createMicrosandboxRuntimeAttestation({
      imageReference,
      limits,
    });
    const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity({
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference,
      imageDigest: runtime.imageDigest,
    }, "$admittedModelicaExecutionProfileCatalog.runtimeBackend");

    this.#profile = createFixedProfile({
      isolationPolicy,
      runtimeBackend,
      runtime,
    });
  }

  initial(): Promise<AdmittedModelicaExecutionProfile> {
    if (arguments.length !== 0) {
      throw new TypeError("initial does not accept caller input.");
    }
    return this.#profile;
  }

  async resolve(
    value: IsolatedCodeProfileRef,
  ): Promise<AdmittedModelicaExecutionProfile> {
    const executionProfile = validateIsolatedCodeProfileRef(
      value,
      "$executionProfile",
    );
    if (
      executionProfile.id !== MODELICA_ADMITTED_EXECUTION_PROFILE.id ||
      executionProfile.version !== MODELICA_ADMITTED_EXECUTION_PROFILE.version
    ) {
      throw new AdmittedModelicaExecutionProfileNotRegisteredError(
        executionProfile.id,
        executionProfile.version,
      );
    }
    return await this.#profile;
  }
}

export async function validateAdmittedModelicaExecutionProfile(
  value: unknown,
): Promise<AdmittedModelicaExecutionProfile> {
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
  ], "$admittedModelicaExecutionProfile");
  literalValue(
    profile.schemaVersion,
    ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
    "$admittedModelicaExecutionProfile.schemaVersion",
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    profile.executionProfile,
    "$admittedModelicaExecutionProfile.executionProfile",
  );
  if (
    executionProfile.id !== MODELICA_ADMITTED_EXECUTION_PROFILE.id ||
    executionProfile.version !== MODELICA_ADMITTED_EXECUTION_PROFILE.version
  ) {
    throw new TypeError("The execution profile is not admitted Modelica v2.");
  }
  literalValue(
    profile.compilationTarget,
    "modelica-source-qualification",
    "$admittedModelicaExecutionProfile.compilationTarget",
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
      "$admittedModelicaExecutionProfile.compilationProfile is not the catalog Modelica profile.",
    );
  }
  const compilationProfileFingerprint = validateContentFingerprint(
    profile.compilationProfileFingerprint,
    "$admittedModelicaExecutionProfile.compilationProfileFingerprint",
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
    "$admittedModelicaExecutionProfile.isolationPolicy",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    profile.runtimeBackend,
    "$admittedModelicaExecutionProfile.runtimeBackend",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    profile.runtime,
    "$admittedModelicaExecutionProfile.runtime",
  );
  if (runtimeBackend.imageDigest.digest !== runtime.imageDigest.digest) {
    throw new TypeError("The admitted Modelica runtime names two OCI images.");
  }
  const outputManifest = validateIsolatedCodeOutputManifest(
    profile.outputManifest,
    "$admittedModelicaExecutionProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(
      outputManifest,
      MICROSANDBOX_ADMITTED_MODELICA_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError("The admitted Modelica output manifest is not registered.");
  }
  const outputValidatorRecord = exactRecord(
    profile.outputValidator,
    ["id", "version"],
    "$admittedModelicaExecutionProfile.outputValidator",
  );
  const outputValidator = deepFreeze({
    id: safeId(
      outputValidatorRecord.id,
      "$admittedModelicaExecutionProfile.outputValidator.id",
    ),
    version: safeVersion(
      outputValidatorRecord.version,
      "$admittedModelicaExecutionProfile.outputValidator.version",
    ),
  });
  if (
    deterministicJson(outputValidator) !==
      deterministicJson(MODELICA_ADMITTED_OUTPUT_VALIDATOR_REF)
  ) {
    throw new TypeError("The admitted Modelica output validator is not registered.");
  }
  const maximumSourceBytes = positiveInteger(
    profile.maximumSourceBytes,
    "$admittedModelicaExecutionProfile.maximumSourceBytes",
  );
  if (maximumSourceBytes !== QUALIFIED_MODELICA_MAX_SOURCE_BYTES) {
    throw new TypeError("The admitted Modelica source ceiling is not registered.");
  }
  literalValue(
    profile.minimumDestructionAssurance,
    "proven",
    "$admittedModelicaExecutionProfile.minimumDestructionAssurance",
  );
  const body = deepFreeze<AdmittedModelicaExecutionProfileFingerprintBody>({
    schemaVersion: ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    compilationTarget: "modelica-source-qualification",
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
    "$admittedModelicaExecutionProfile.profileFingerprint",
  );
  if (!fingerprintsEqual(profileFingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("The admitted Modelica profile fingerprint is stale.");
  }
  return deepFreeze({ ...body, profileFingerprint });
}

async function createFixedProfile(input: {
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
  readonly runtime: IsolatedCodeRuntimeAttestation;
}): Promise<AdmittedModelicaExecutionProfile> {
  const compilationProfileFingerprint = await sha256Fingerprint(
    EXPECTED_COMPILATION_PROFILE,
  );
  const body = deepFreeze<AdmittedModelicaExecutionProfileFingerprintBody>({
    schemaVersion: ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
    executionProfile: MODELICA_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "modelica-source-qualification",
    compilationProfile: EXPECTED_COMPILATION_PROFILE,
    compilationProfileFingerprint,
    isolationPolicy: input.isolationPolicy,
    runtimeBackend: input.runtimeBackend,
    runtime: input.runtime,
    outputManifest: MICROSANDBOX_ADMITTED_MODELICA_OUTPUT_MANIFEST,
    outputValidator: MODELICA_ADMITTED_OUTPUT_VALIDATOR_REF,
    maximumSourceBytes: QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
    minimumDestructionAssurance: "proven",
  });
  return await validateAdmittedModelicaExecutionProfile({
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  });
}

function requireExpectedCompilationProfile(): TechnicalCompilationProfile {
  const matches = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles.filter(
    (profile) =>
      profile.id === MODELICA_ADMITTED_EXECUTION_PROFILE.id &&
      profile.version === MODELICA_ADMITTED_EXECUTION_PROFILE.version &&
      profile.target === "modelica-source-qualification",
  );
  if (matches.length !== 1) {
    throw new TypeError(
      "The compilation catalogue must contain exactly one Modelica closed-subset profile.",
    );
  }
  return matches[0]!;
}
