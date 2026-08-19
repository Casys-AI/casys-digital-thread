/** One closed local Modelica profile; callers cannot register alternatives. */

import {
  MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
  type ModelicaIsolatedExecutionProfile,
  type ModelicaIsolatedExecutionProfileCatalog,
  type ModelicaIsolatedExecutionProfileFingerprintBody,
} from "../../../application/ports/out/modelica/isolated-execution-profile.ts";
import {
  type IsolatedCodeExecutionLimits,
  isolatedCodeOutputManifestsEqual,
  type IsolatedCodePolicyRef,
  type IsolatedCodeProfileRef,
  validateContentFingerprint,
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  MODELICA_ISOLATED_EXECUTION_PROFILE,
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  MODELICA_LOCAL_LOWERING,
  MODELICA_LOCAL_RESULT_NORMALIZER,
} from "../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { sha256Hex } from "../../../domain/compile/source/provider-resource-reader.ts";
import { MODELICA_QUALIFIED_KIT_WRAPPER_SHA256 } from "./kit-v1/qualification-kit.ts";

export { MODELICA_QUALIFIED_KIT_WRAPPER_SHA256 } from "./kit-v1/qualification-kit.ts";

export const MODELICA_MAXIMUM_ISOLATED_BUNDLE_BYTES = 8 * 1_048_576;
export const MODELICA_MICROSANDBOX_WORKER_IMAGE =
  "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894";
export const MODELICA_ISOLATED_OUTPUT_VALIDATOR = Object.freeze({
  id: "modelica-isolated-output-validator" as const,
  version: "1.0.0" as const,
});
export interface FixedModelicaIsolatedExecutionProfileOptions {
  /** Digest-pinned OCI identity consumed by the local Microsandbox adapter. */
  readonly imageReference: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
  readonly engine: {
    readonly name: "OpenModelica";
    readonly version: string;
    readonly mslVersion: string;
  };
}

export class ModelicaIsolatedExecutionProfileNotRegisteredError extends Error {
  constructor(readonly id: string, readonly version: string) {
    super(`No local Modelica profile is registered for ${id}@${version}.`);
    this.name = "ModelicaIsolatedExecutionProfileNotRegisteredError";
  }
}

export class FixedModelicaIsolatedExecutionProfileCatalog
  implements ModelicaIsolatedExecutionProfileCatalog {
  readonly #profile: Promise<ModelicaIsolatedExecutionProfile>;

  constructor(value: FixedModelicaIsolatedExecutionProfileOptions) {
    const root = exactRecord(
      value,
      ["imageReference", "policy", "limits", "engine"],
      "$modelicaExecutionProfile",
    );
    const engine = exactRecord(
      root.engine,
      ["name", "version", "mslVersion"],
      "$modelicaExecutionProfile.engine",
    );
    literalValue(engine.name, "OpenModelica", "$modelicaExecutionProfile.engine.name");
    const imageReference = pinnedOciImageReference(
      root.imageReference,
      "$modelicaExecutionProfile.imageReference",
    );
    const limits = validateIsolatedCodeExecutionLimits(
      root.limits,
      "$modelicaExecutionProfile.limits",
    );
    const runtime = createMicrosandboxRuntimeAttestation({
      imageReference,
      limits,
    }, "$modelicaExecutionProfile.runtime");
    const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity({
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference,
      imageDigest: runtime.imageDigest,
    });
    const body: ModelicaIsolatedExecutionProfileFingerprintBody = deepFreeze({
      schemaVersion: MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
      executionProfile: MODELICA_ISOLATED_EXECUTION_PROFILE,
      runtimeBackend,
      qualifiedContract: {
        id: "modelica-qualified-manifest",
        version: "1.0",
      },
      method: {
        lowering: MODELICA_LOCAL_LOWERING,
        resultNormalizer: MODELICA_LOCAL_RESULT_NORMALIZER,
        engine: {
          name: "OpenModelica",
          version: nonEmptyText(
            engine.version,
            "$modelicaExecutionProfile.engine.version",
          ),
          mslVersion: nonEmptyText(
            engine.mslVersion,
            "$modelicaExecutionProfile.engine.mslVersion",
          ),
        },
      },
      wrapper: {
        id: "modelica-qualified-kit-wrapper",
        version: "1.0.0",
        sha256: sha256Hex(
          MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
          "$modelicaExecutionProfile.wrapper.sha256",
        ),
        invocation: "direct-executable-no-shell",
      },
      isolationPolicy: validateIsolatedCodePolicyRef(
        root.policy,
        "$modelicaExecutionProfile.policy",
      ),
      runtime,
      outputManifest: MODELICA_ISOLATED_OUTPUT_MANIFEST,
      outputValidator: MODELICA_ISOLATED_OUTPUT_VALIDATOR,
      maximumBundleBytes: MODELICA_MAXIMUM_ISOLATED_BUNDLE_BYTES,
      minimumDestructionAssurance: "proven",
    });
    this.#profile = createProfile(body);
  }

  initial(): Promise<ModelicaIsolatedExecutionProfile> {
    if (arguments.length !== 0) throw new TypeError("initial accepts no input.");
    return this.#profile;
  }

  async resolve(
    value: IsolatedCodeProfileRef,
  ): Promise<ModelicaIsolatedExecutionProfile> {
    const profile = validateIsolatedCodeProfileRef(value, "$executionProfile");
    if (
      profile.id !== MODELICA_ISOLATED_EXECUTION_PROFILE.id ||
      profile.version !== MODELICA_ISOLATED_EXECUTION_PROFILE.version
    ) {
      throw new ModelicaIsolatedExecutionProfileNotRegisteredError(
        profile.id,
        profile.version,
      );
    }
    return await this.#profile;
  }
}

export async function validateModelicaIsolatedExecutionProfile(
  value: unknown,
): Promise<ModelicaIsolatedExecutionProfile> {
  const root = exactRecord(value, [
    "schemaVersion",
    "executionProfile",
    "runtimeBackend",
    "qualifiedContract",
    "method",
    "wrapper",
    "isolationPolicy",
    "runtime",
    "outputManifest",
    "outputValidator",
    "maximumBundleBytes",
    "minimumDestructionAssurance",
    "profileFingerprint",
  ], "$modelicaExecutionProfile");
  literalValue(
    root.schemaVersion,
    MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    "$modelicaExecutionProfile.schemaVersion",
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    root.executionProfile,
    "$modelicaExecutionProfile.executionProfile",
  );
  assertEqual(
    executionProfile,
    MODELICA_ISOLATED_EXECUTION_PROFILE,
    "$modelicaExecutionProfile.executionProfile",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    root.runtimeBackend,
    "$modelicaExecutionProfile.runtimeBackend",
  );
  const contract = exactRecord(
    root.qualifiedContract,
    ["id", "version"],
    "$modelicaExecutionProfile.qualifiedContract",
  );
  literalValue(
    contract.id,
    "modelica-qualified-manifest",
    "$modelicaExecutionProfile.qualifiedContract.id",
  );
  literalValue(
    contract.version,
    "1.0",
    "$modelicaExecutionProfile.qualifiedContract.version",
  );
  const method = parseMethod(root.method);
  const wrapper = exactRecord(
    root.wrapper,
    ["id", "version", "sha256", "invocation"],
    "$modelicaExecutionProfile.wrapper",
  );
  literalValue(
    wrapper.id,
    "modelica-qualified-kit-wrapper",
    "$modelicaExecutionProfile.wrapper.id",
  );
  literalValue(wrapper.version, "1.0.0", "$modelicaExecutionProfile.wrapper.version");
  literalValue(
    wrapper.invocation,
    "direct-executable-no-shell",
    "$modelicaExecutionProfile.wrapper.invocation",
  );
  const wrapperSha256 = sha256Hex(
    wrapper.sha256,
    "$modelicaExecutionProfile.wrapper.sha256",
  );
  if (wrapperSha256 !== MODELICA_QUALIFIED_KIT_WRAPPER_SHA256) {
    throw new TypeError(
      "$modelicaExecutionProfile.wrapper.sha256 is not the code-owned wrapper.",
    );
  }
  const runtime = validateIsolatedCodeRuntimeAttestation(
    root.runtime,
    "$modelicaExecutionProfile.runtime",
  );
  if (
    runtime.isolationClass !== MICROSANDBOX_LOCAL_ISOLATION_CLASS ||
    !fingerprintsEqual(runtime.imageDigest, runtimeBackend.imageDigest) ||
    runtime.limitAssurance.maxWallTimeMs !== "backend-attested" ||
    runtime.limitAssurance.maxMemoryBytes !== "backend-attested" ||
    runtime.limitAssurance.maxCpuTimeMs !== "unattested" ||
    runtime.limitAssurance.maxProcesses !== "unattested" ||
    runtime.limitAssurance.maxStdoutBytes !== "broker-observed-cap" ||
    runtime.limitAssurance.maxStderrBytes !== "broker-observed-cap" ||
    runtime.limitAssurance.maxOutputFileBytes !== "broker-observed-cap" ||
    runtime.limitAssurance.maxOutputTotalBytes !== "broker-observed-cap"
  ) throw new TypeError("$modelicaExecutionProfile.runtime is not Microsandbox local.");
  const outputManifest = validateIsolatedCodeOutputManifest(
    root.outputManifest,
    "$modelicaExecutionProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(outputManifest, MODELICA_ISOLATED_OUTPUT_MANIFEST)
  ) {
    throw new TypeError("$modelicaExecutionProfile.outputManifest is not registered.");
  }
  const validator = exactRecord(
    root.outputValidator,
    ["id", "version"],
    "$modelicaExecutionProfile.outputValidator",
  );
  assertEqual(
    validator,
    MODELICA_ISOLATED_OUTPUT_VALIDATOR,
    "$modelicaExecutionProfile.outputValidator",
  );
  const maximumBundleBytes = positiveInteger(
    root.maximumBundleBytes,
    "$modelicaExecutionProfile.maximumBundleBytes",
  );
  if (maximumBundleBytes !== MODELICA_MAXIMUM_ISOLATED_BUNDLE_BYTES) {
    throw new TypeError(
      "$modelicaExecutionProfile.maximumBundleBytes is not registered.",
    );
  }
  literalValue(
    root.minimumDestructionAssurance,
    "proven",
    "$modelicaExecutionProfile.minimumDestructionAssurance",
  );
  const body: ModelicaIsolatedExecutionProfileFingerprintBody = deepFreeze({
    schemaVersion: MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    runtimeBackend,
    qualifiedContract: {
      id: "modelica-qualified-manifest",
      version: "1.0",
    },
    method,
    wrapper: {
      id: "modelica-qualified-kit-wrapper",
      version: "1.0.0",
      sha256: wrapperSha256,
      invocation: "direct-executable-no-shell",
    },
    isolationPolicy: validateIsolatedCodePolicyRef(
      root.isolationPolicy,
      "$modelicaExecutionProfile.isolationPolicy",
    ),
    runtime,
    outputManifest,
    outputValidator: MODELICA_ISOLATED_OUTPUT_VALIDATOR,
    maximumBundleBytes,
    minimumDestructionAssurance: "proven",
  });
  const profileFingerprint = validateContentFingerprint(
    root.profileFingerprint,
    "$modelicaExecutionProfile.profileFingerprint",
  );
  if (!fingerprintsEqual(profileFingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("$modelicaExecutionProfile.profileFingerprint is stale.");
  }
  return deepFreeze({ ...body, profileFingerprint });
}

async function createProfile(
  body: ModelicaIsolatedExecutionProfileFingerprintBody,
): Promise<ModelicaIsolatedExecutionProfile> {
  return await validateModelicaIsolatedExecutionProfile({
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  });
}

function parseMethod(value: unknown): ModelicaIsolatedExecutionProfile["method"] {
  const root = exactRecord(
    value,
    ["lowering", "resultNormalizer", "engine"],
    "$modelicaExecutionProfile.method",
  );
  assertEqual(
    root.lowering,
    MODELICA_LOCAL_LOWERING,
    "$modelicaExecutionProfile.method.lowering",
  );
  assertEqual(
    root.resultNormalizer,
    MODELICA_LOCAL_RESULT_NORMALIZER,
    "$modelicaExecutionProfile.method.resultNormalizer",
  );
  const engine = exactRecord(
    root.engine,
    ["name", "version", "mslVersion"],
    "$modelicaExecutionProfile.method.engine",
  );
  literalValue(
    engine.name,
    "OpenModelica",
    "$modelicaExecutionProfile.method.engine.name",
  );
  return deepFreeze({
    lowering: MODELICA_LOCAL_LOWERING,
    resultNormalizer: MODELICA_LOCAL_RESULT_NORMALIZER,
    engine: {
      name: "OpenModelica",
      version: nonEmptyText(
        engine.version,
        "$modelicaExecutionProfile.method.engine.version",
      ),
      mslVersion: nonEmptyText(
        engine.mslVersion,
        "$modelicaExecutionProfile.method.engine.mslVersion",
      ),
    },
  });
}

function assertEqual(actual: unknown, expected: unknown, path: string): void {
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError(`${path} does not match the code-owned contract.`);
  }
}
