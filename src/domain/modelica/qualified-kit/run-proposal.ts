/**
 * Closed MRTR grammar for one local, qualified Modelica conformance run.
 *
 * The admission is intentionally not a generic Modelica runner. It binds one
 * code-owned kit and scenario to one exact Thread basis, one content-addressed
 * input bundle, one qualified local runtime profile and one durable runtime
 * qualification. Source text and runtime capabilities are not representable.
 */

import type {
  IsolatedCodeLimitAssuranceMatrix,
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeRuntimeAttestation,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  isolatedCodeOutputManifestsEqual,
  validateContentFingerprint,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  type MicrosandboxLocalRuntimeIdentity,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../compile/isolation/local-isolation-runtime.ts";
import {
  MODELICA_ISOLATED_EXECUTION_PROFILE,
  MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  MODELICA_LOCAL_LOWERING,
  MODELICA_LOCAL_QUALIFIED_KIT,
  MODELICA_LOCAL_RESULT_NORMALIZER,
  type ModelicaIsolatedInputBundle,
} from "./isolated-execution.ts";
import {
  type ModelicaMicrosandboxQualificationReference,
  validateModelicaMicrosandboxQualificationReference,
} from "./microsandbox-qualification.ts";
import { sha256Hex } from "../../compile/source/provider-resource-reader.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../project/engineering-project.ts";

export const SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION = Object.freeze(
  {
    id: "simulate.run-qualified-modelica-kit",
    version: "1",
  } as const,
);

export const MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA =
  "modelica-qualified-kit-run-admission/1.0" as const;

export const MODELICA_QUALIFIED_KIT_RUN_PURPOSE = "solver-conformance-only" as const;

export const MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA =
  "modelica-isolated-execution-profile/1.0" as const;

/** Digest of the one code-owned solver-conformance case. */
export const MODELICA_QUALIFIED_CONFORMANCE_CASE_SHA256 =
  "a5f2f32c5a291882a06d7d1a60cdae56ec90ebe5f1f3fb3ce41f2979a523fad2";

/** Digest of the source metadata for the one code-owned two-file kit. */
export const MODELICA_QUALIFIED_SOURCE_CAPTURE_SHA256 =
  "6a89e1d60f5475af1f14b8bfc9cf5bec1b4aea01073f4cb98356c723a9496e32";

/** Digest of the manifest for OpenModelica 1.27.0 plus MSL 4.1.0. */
export const MODELICA_QUALIFIED_MANIFEST_SHA256 =
  "64f2a1a185bcc5e3f534a93976c44a906940a6acdd804b90f29588b885f59489";

export const MODELICA_QUALIFIED_BUNDLE_FINGERPRINT = Object.freeze(
  {
    algorithm: "sha256",
    digest: "46ce0948a9724308cb8cdda78d85b76854e46c0bd892d32de4bcb1edaa5957ff",
  } as const,
);
export const MODELICA_QUALIFIED_BUNDLE_BYTE_COUNT = 2_245;
export const MODELICA_QUALIFIED_EXECUTION_PROFILE_FINGERPRINT = Object.freeze(
  {
    algorithm: "sha256",
    digest: "4da0506fa25721a444f7e25f8b982adb9040515a306e4bc0b4e14b5c784e54a7",
  } as const,
);
export const MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT = Object.freeze(
  {
    algorithm: "sha256",
    digest: "d6aee5fe375daa55cec29a32acf27181dd4bb8ea8e5c3f90f848cc718c149428",
  } as const,
);

const QUALIFIED_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894";
const QUALIFIED_WRAPPER_SHA256 =
  "b5336d1615b017900f65aa9d491f3ecae8b3afb377d0bb38bc5678b03028c816";
const QUALIFIED_POLICY = deepFreeze({
  id: "modelica-microsandbox-deny-all-v1",
  version: "1.0.0",
  fingerprint: {
    algorithm: "sha256" as const,
    digest: "a6eeca8fb305b6fecf6a5f226ddcc9dad8010147afe31d7dd4fe35853d239327",
  },
});
const QUALIFIED_LIMITS = deepFreeze({
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 120_000,
  maxMemoryBytes: 3_221_225_472,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 16_777_216,
  maxOutputTotalBytes: 17_825_792,
});
const QUALIFIED_MAXIMUM_BUNDLE_BYTES = 8_388_608;

export interface ModelicaQualifiedKitRunBundleFacts {
  readonly schemaVersion: typeof MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly qualification: ModelicaIsolatedInputBundle["qualification"];
  readonly selection: ModelicaIsolatedInputBundle["selection"];
  readonly invocation: ModelicaIsolatedInputBundle["invocation"];
  readonly method: ModelicaIsolatedInputBundle["method"];
  /** Exact input identities, deliberately without source text. */
  readonly inputs: readonly Omit<
    ModelicaIsolatedInputBundle["inputs"][number],
    "text"
  >[];
}

/** Complete profile identity carried by the review; it is not a capability. */
export interface ModelicaQualifiedKitRunExecutionProfileFacts {
  readonly schemaVersion: typeof MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA;
  readonly executionProfile: typeof MODELICA_ISOLATED_EXECUTION_PROFILE;
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
  readonly profileFingerprint: ContentFingerprint;
}

export interface ModelicaQualifiedKitRunAdmission {
  readonly schemaVersion: typeof MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA;
  readonly operation: typeof SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION;
  readonly project: {
    readonly id: string;
    readonly basis: EngineeringThreadSnapshotBasis;
  };
  readonly intent: {
    readonly purpose: typeof MODELICA_QUALIFIED_KIT_RUN_PURPOSE;
    readonly arbitraryModelica: false;
  };
  readonly bundle: ModelicaQualifiedKitRunBundleFacts;
  readonly execution: {
    readonly profile: ModelicaQualifiedKitRunExecutionProfileFacts;
    readonly runtimeQualification: ModelicaMicrosandboxQualificationReference;
  };
  /** Review readiness is never dispatch authority. */
  readonly status: "ready-for-qualified-modelica-review";
}

type Scalar = EngineeringDecisionProposalParameter["value"];
interface ScalarSpec {
  readonly key: string;
  readonly label: string;
  readonly value: Scalar;
}

const PREFIX = "simulate.modelica.qualifiedKit";
const EXPECTED_LIMIT_ASSURANCE: IsolatedCodeLimitAssuranceMatrix = deepFreeze({
  maxWallTimeMs: "backend-attested",
  maxCpuTimeMs: "unattested",
  maxMemoryBytes: "backend-attested",
  maxProcesses: "unattested",
  maxStdoutBytes: "broker-observed-cap",
  maxStderrBytes: "broker-observed-cap",
  maxOutputFileBytes: "broker-observed-cap",
  maxOutputTotalBytes: "broker-observed-cap",
});

const LIMIT_KEYS = [
  "maxWallTimeMs",
  "maxCpuTimeMs",
  "maxMemoryBytes",
  "maxProcesses",
  "maxStdoutBytes",
  "maxStderrBytes",
  "maxOutputFileBytes",
  "maxOutputTotalBytes",
] as const;

const QUALIFIED_INVOCATION: ModelicaIsolatedInputBundle["invocation"] = deepFreeze({
  modelName: MODELICA_LOCAL_QUALIFIED_KIT.modelName,
  startTimeS: 0,
  stopTimeS: 2,
  numberOfIntervals: 20,
  solver: "dassl",
  timeoutMs: 30_000,
  parameters: [
    {
      id: "heating_rate",
      modelicaName: "heatingRate",
      inputValue: 1,
      inputUnit: "K/s",
      modelicaValue: 1,
      modelicaUnit: "K/s",
    },
    {
      id: "initial_temperature",
      modelicaName: "initialTemperature",
      inputValue: 20,
      inputUnit: "degC",
      modelicaValue: 20,
      modelicaUnit: "degC",
    },
  ],
  metrics: [{ id: "temperature_final", unit: "degC", required: true }],
});

/** Validate the profile facts before they can be shown to a reviewer. */
export function validateModelicaQualifiedKitRunExecutionProfileFacts(
  value: unknown,
  path = "$modelicaQualifiedKitRun.execution.profile",
): ModelicaQualifiedKitRunExecutionProfileFacts {
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
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    root.executionProfile,
    `${path}.executionProfile`,
  );
  if (
    deterministicJson(executionProfile) !==
      deterministicJson(MODELICA_ISOLATED_EXECUTION_PROFILE)
  ) {
    throw new TypeError(`${path}.executionProfile is not the qualified kit profile.`);
  }
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    root.runtimeBackend,
    `${path}.runtimeBackend`,
  );
  const qualifiedContract = exactRecord(
    root.qualifiedContract,
    ["id", "version"],
    `${path}.qualifiedContract`,
  );
  literalValue(
    qualifiedContract.id,
    "modelica-qualified-manifest",
    `${path}.qualifiedContract.id`,
  );
  literalValue(qualifiedContract.version, "1.0", `${path}.qualifiedContract.version`);
  const method = validateMethod(root.method, `${path}.method`);
  const wrapper = exactRecord(
    root.wrapper,
    ["id", "version", "sha256", "invocation"],
    `${path}.wrapper`,
  );
  literalValue(wrapper.id, "modelica-qualified-kit-wrapper", `${path}.wrapper.id`);
  literalValue(wrapper.version, "1.0.0", `${path}.wrapper.version`);
  literalValue(
    wrapper.invocation,
    "direct-executable-no-shell",
    `${path}.wrapper.invocation`,
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    root.runtime,
    `${path}.runtime`,
  );
  if (
    runtimeBackend.imageReference !== QUALIFIED_IMAGE_REFERENCE ||
    runtime.isolationClass !== MICROSANDBOX_LOCAL_ISOLATION_CLASS ||
    !fingerprintsEqual(runtime.imageDigest, runtimeBackend.imageDigest) ||
    deterministicJson(runtime.requestedLimits) !==
      deterministicJson(QUALIFIED_LIMITS) ||
    deterministicJson(runtime.limitAssurance) !==
      deterministicJson(EXPECTED_LIMIT_ASSURANCE)
  ) {
    throw new TypeError(
      `${path}.runtime is not the fixed local Microsandbox contract.`,
    );
  }
  const outputManifest = validateIsolatedCodeOutputManifest(
    root.outputManifest,
    `${path}.outputManifest`,
  );
  if (
    !isolatedCodeOutputManifestsEqual(outputManifest, MODELICA_ISOLATED_OUTPUT_MANIFEST)
  ) {
    throw new TypeError(
      `${path}.outputManifest is not the qualified Modelica output set.`,
    );
  }
  const outputValidator = exactRecord(
    root.outputValidator,
    ["id", "version"],
    `${path}.outputValidator`,
  );
  literalValue(
    outputValidator.id,
    "modelica-isolated-output-validator",
    `${path}.outputValidator.id`,
  );
  literalValue(outputValidator.version, "1.0.0", `${path}.outputValidator.version`);
  literalValue(
    root.minimumDestructionAssurance,
    "proven",
    `${path}.minimumDestructionAssurance`,
  );
  const wrapperSha256 = sha256Hex(wrapper.sha256, `${path}.wrapper.sha256`);
  if (wrapperSha256 !== QUALIFIED_WRAPPER_SHA256) {
    throw new TypeError(`${path}.wrapper.sha256 is not the qualified wrapper.`);
  }
  const isolationPolicy = validateIsolatedCodePolicyRef(
    root.isolationPolicy,
    `${path}.isolationPolicy`,
  );
  if (deterministicJson(isolationPolicy) !== deterministicJson(QUALIFIED_POLICY)) {
    throw new TypeError(`${path}.isolationPolicy is not the qualified policy.`);
  }
  const maximumBundleBytes = positiveInteger(
    root.maximumBundleBytes,
    `${path}.maximumBundleBytes`,
  );
  if (maximumBundleBytes !== QUALIFIED_MAXIMUM_BUNDLE_BYTES) {
    throw new TypeError(`${path}.maximumBundleBytes is not code-owned.`);
  }
  const profileFingerprint = validateContentFingerprint(
    root.profileFingerprint,
    `${path}.profileFingerprint`,
  );
  if (
    !fingerprintsEqual(
      profileFingerprint,
      MODELICA_QUALIFIED_EXECUTION_PROFILE_FINGERPRINT,
    )
  ) throw new TypeError(`${path}.profileFingerprint is not the qualified profile.`);
  return deepFreeze({
    schemaVersion: MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    executionProfile: MODELICA_ISOLATED_EXECUTION_PROFILE,
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
    isolationPolicy,
    runtime,
    outputManifest,
    outputValidator: {
      id: "modelica-isolated-output-validator",
      version: "1.0.0",
    },
    maximumBundleBytes,
    minimumDestructionAssurance: "proven",
    profileFingerprint,
  });
}

export function validateModelicaQualifiedKitRunAdmission(
  value: unknown,
  path = "$modelicaQualifiedKitRunAdmission",
): ModelicaQualifiedKitRunAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "project",
    "intent",
    "bundle",
    "execution",
    "status",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version,
    `${path}.operation.version`,
  );
  const project = exactRecord(root.project, ["id", "basis"], `${path}.project`);
  const projectId = safeId(project.id, `${path}.project.id`);
  const basis = validateThreadBasis(project.basis, `${path}.project.basis`);
  const intent = exactRecord(
    root.intent,
    ["purpose", "arbitraryModelica"],
    `${path}.intent`,
  );
  literalValue(
    intent.purpose,
    MODELICA_QUALIFIED_KIT_RUN_PURPOSE,
    `${path}.intent.purpose`,
  );
  literalValue(intent.arbitraryModelica, false, `${path}.intent.arbitraryModelica`);
  const bundle = validateBundleFacts(root.bundle, `${path}.bundle`);
  const execution = exactRecord(
    root.execution,
    ["profile", "runtimeQualification"],
    `${path}.execution`,
  );
  const profile = validateModelicaQualifiedKitRunExecutionProfileFacts(
    execution.profile,
    `${path}.execution.profile`,
  );
  const runtimeQualification = validateModelicaMicrosandboxQualificationReference(
    execution.runtimeQualification,
    profile.profileFingerprint,
    `${path}.execution.runtimeQualification`,
  );
  if (
    !fingerprintsEqual(
      runtimeQualification.fingerprint,
      MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
    )
  ) {
    throw new TypeError(
      `${path}.execution.runtimeQualification is not the qualified live capture.`,
    );
  }
  if (
    deterministicJson(bundle.method) !== deterministicJson(profile.method) ||
    bundle.byteCount > profile.maximumBundleBytes ||
    bundle.invocation.timeoutMs > profile.runtime.requestedLimits.maxWallTimeMs
  ) {
    throw new TypeError(
      `${path} does not bind the bundle to its exact execution profile.`,
    );
  }
  literalValue(root.status, "ready-for-qualified-modelica-review", `${path}.status`);
  return deepFreeze({
    schemaVersion: MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
    operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
    project: { id: projectId, basis },
    intent: {
      purpose: MODELICA_QUALIFIED_KIT_RUN_PURPOSE,
      arbitraryModelica: false,
    },
    bundle,
    execution: { profile, runtimeQualification },
    status: "ready-for-qualified-modelica-review",
  });
}

/** Encode every review fact as a unique ordered scalar MRTR sequence. */
export function encodeModelicaQualifiedKitRunAdmissionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateModelicaQualifiedKitRunAdmission(value);
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

/** Parse and replay the complete signed scalar sequence, fail-closed. */
export function parseModelicaQualifiedKitRunAdmissionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ModelicaQualifiedKitRunAdmission {
  if (!Array.isArray(parameters)) throw new TypeError("$parameters must be an array.");
  const values = new Map<string, Scalar>();
  const actual: Array<{ key: string; label: string; value: Scalar }> = [];
  for (const [index, raw] of parameters.entries()) {
    const parameter = exactRecord(
      raw,
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    const key = safeId(parameter.key, `$parameters[${index}].key`);
    if (values.has(key)) {
      throw new TypeError(`$parameters contains duplicate key ${key}.`);
    }
    const value = scalar(parameter.value, `$parameters[${index}].value`);
    const label = nonEmptyText(parameter.label, `$parameters[${index}].label`);
    values.set(key, value);
    actual.push({ key, label, value });
  }
  const read = new ParameterReader(values);
  const admission = validateModelicaQualifiedKitRunAdmission({
    schemaVersion: read.literal(
      "admission.schemaVersion",
      MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
    ),
    operation: {
      id: read.literal(
        "operation.id",
        SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id,
      ),
      version: read.literal(
        "operation.version",
        SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version,
      ),
    },
    project: {
      id: read.string("project.id"),
      basis: {
        kind: read.literal("project.basis.kind", "thread-snapshot"),
        snapshotId: read.string("project.basis.snapshotId"),
        revision: read.number("project.basis.revision"),
        subjectId: read.string("project.basis.subjectId"),
      },
    },
    intent: {
      purpose: read.literal("intent.purpose", MODELICA_QUALIFIED_KIT_RUN_PURPOSE),
      arbitraryModelica: read.boolean("intent.arbitraryModelica"),
    },
    bundle: readBundle(read),
    execution: {
      profile: readProfile(read),
      runtimeQualification: readQualification(read),
    },
    status: read.literal("status", "ready-for-qualified-modelica-review"),
  });
  const expected = parameterSpecs(admission);
  if (expected.length !== actual.length) {
    throw new TypeError(`$parameters must contain exactly ${expected.length} entries.`);
  }
  for (const [index, spec] of expected.entries()) {
    const item = actual[index]!;
    if (
      item.key !== spec.key || item.label !== spec.label ||
      !Object.is(item.value, spec.value)
    ) {
      throw new TypeError(
        `$parameters[${index}] is not the canonical ${spec.key} scalar.`,
      );
    }
  }
  return admission;
}

function validateBundleFacts(
  value: unknown,
  path: string,
): ModelicaQualifiedKitRunBundleFacts {
  const root = exactRecord(value, [
    "schemaVersion",
    "fingerprint",
    "byteCount",
    "qualification",
    "selection",
    "invocation",
    "method",
    "inputs",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const qualificationRoot = exactRecord(root.qualification, [
    "caseSha256",
    "manifestSha256",
    "sourceCaptureSha256",
  ], `${path}.qualification`);
  const qualification = deepFreeze({
    caseSha256: sha256Hex(
      qualificationRoot.caseSha256,
      `${path}.qualification.caseSha256`,
    ),
    manifestSha256: sha256Hex(
      qualificationRoot.manifestSha256,
      `${path}.qualification.manifestSha256`,
    ),
    sourceCaptureSha256: sha256Hex(
      qualificationRoot.sourceCaptureSha256,
      `${path}.qualification.sourceCaptureSha256`,
    ),
  });
  if (
    qualification.caseSha256 !== MODELICA_QUALIFIED_CONFORMANCE_CASE_SHA256 ||
    qualification.manifestSha256 !== MODELICA_QUALIFIED_MANIFEST_SHA256 ||
    qualification.sourceCaptureSha256 !== MODELICA_QUALIFIED_SOURCE_CAPTURE_SHA256
  ) {
    throw new TypeError(`${path}.qualification names a foreign Modelica case or kit.`);
  }
  const selectionRoot = exactRecord(root.selection, [
    "modelId",
    "modelVersion",
    "scenarioId",
  ], `${path}.selection`);
  const selection = deepFreeze({
    modelId: safeId(selectionRoot.modelId, `${path}.selection.modelId`),
    modelVersion: safeVersion(
      selectionRoot.modelVersion,
      `${path}.selection.modelVersion`,
    ),
    scenarioId: safeId(selectionRoot.scenarioId, `${path}.selection.scenarioId`),
  });
  if (
    selection.modelId !== MODELICA_LOCAL_QUALIFIED_KIT.modelId ||
    selection.modelVersion !== MODELICA_LOCAL_QUALIFIED_KIT.modelVersion ||
    selection.scenarioId !== MODELICA_LOCAL_QUALIFIED_KIT.scenarioId
  ) throw new TypeError(`${path}.selection is not the code-owned qualified kit.`);
  const invocation = validateInvocation(root.invocation, `${path}.invocation`);
  if (
    !Object.is(invocation.startTimeS, QUALIFIED_INVOCATION.startTimeS) ||
    deterministicJson(invocation) !== deterministicJson(QUALIFIED_INVOCATION)
  ) {
    throw new TypeError(`${path}.invocation is not the fixed solver-conformance case.`);
  }
  const method = validateMethod(root.method, `${path}.method`);
  const inputs = arrayOf(root.inputs, `${path}.inputs`).map((raw, index) => {
    const inputPath = `${path}.inputs[${index}]`;
    const input = exactRecord(raw, [
      "role",
      "basename",
      "mediaType",
      "byteCount",
      "sha256",
    ], inputPath);
    return deepFreeze({
      role: nonEmptyText(input.role, `${inputPath}.role`),
      basename: nonEmptyText(input.basename, `${inputPath}.basename`),
      mediaType: nonEmptyText(input.mediaType, `${inputPath}.mediaType`),
      byteCount: positiveInteger(input.byteCount, `${inputPath}.byteCount`),
      sha256: sha256Hex(input.sha256, `${inputPath}.sha256`),
    });
  });
  const expectedInputs = [
    {
      role: "model",
      basename: "model.mo",
      mediaType: "text/x-modelica",
      byteCount: MODELICA_LOCAL_QUALIFIED_KIT.modelByteCount,
      sha256: MODELICA_LOCAL_QUALIFIED_KIT.modelSha256,
    },
    {
      role: "scenario",
      basename: "scenario.json",
      mediaType: "application/json",
      byteCount: MODELICA_LOCAL_QUALIFIED_KIT.scenarioByteCount,
      sha256: MODELICA_LOCAL_QUALIFIED_KIT.scenarioSha256,
    },
  ];
  if (deterministicJson(inputs) !== deterministicJson(expectedInputs)) {
    throw new TypeError(`${path}.inputs are not the exact code-owned Modelica kit.`);
  }
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const byteCount = positiveInteger(root.byteCount, `${path}.byteCount`);
  if (
    !fingerprintsEqual(fingerprint, MODELICA_QUALIFIED_BUNDLE_FINGERPRINT) ||
    byteCount !== MODELICA_QUALIFIED_BUNDLE_BYTE_COUNT
  ) throw new TypeError(`${path} is not the exact code-owned qualified bundle.`);
  return deepFreeze({
    schemaVersion: MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    fingerprint,
    byteCount,
    qualification,
    selection,
    invocation,
    method,
    inputs: inputs as unknown as ModelicaQualifiedKitRunBundleFacts["inputs"],
  });
}

function validateInvocation(
  value: unknown,
  path: string,
): ModelicaIsolatedInputBundle["invocation"] {
  const root = exactRecord(value, [
    "modelName",
    "startTimeS",
    "stopTimeS",
    "numberOfIntervals",
    "solver",
    "timeoutMs",
    "parameters",
    "metrics",
  ], path);
  const parameters = arrayOf(root.parameters, `${path}.parameters`).map(
    (raw, index) => {
      const itemPath = `${path}.parameters[${index}]`;
      const item = exactRecord(raw, [
        "id",
        "modelicaName",
        "inputValue",
        "inputUnit",
        "modelicaValue",
        "modelicaUnit",
      ], itemPath);
      return deepFreeze({
        id: safeId(item.id, `${itemPath}.id`),
        modelicaName: safeId(item.modelicaName, `${itemPath}.modelicaName`),
        inputValue: finite(item.inputValue, `${itemPath}.inputValue`),
        inputUnit: nonEmptyText(item.inputUnit, `${itemPath}.inputUnit`),
        modelicaValue: finite(item.modelicaValue, `${itemPath}.modelicaValue`),
        modelicaUnit: nonEmptyText(item.modelicaUnit, `${itemPath}.modelicaUnit`),
      });
    },
  );
  const metrics = arrayOf(root.metrics, `${path}.metrics`).map((raw, index) => {
    const itemPath = `${path}.metrics[${index}]`;
    const item = exactRecord(raw, ["id", "unit", "required"], itemPath);
    if (typeof item.required !== "boolean") {
      throw new TypeError(`${itemPath}.required must be boolean.`);
    }
    return deepFreeze({
      id: safeId(item.id, `${itemPath}.id`),
      unit: nonEmptyText(item.unit, `${itemPath}.unit`),
      required: item.required,
    });
  });
  return deepFreeze({
    modelName: safeId(root.modelName, `${path}.modelName`),
    startTimeS: finite(root.startTimeS, `${path}.startTimeS`),
    stopTimeS: finite(root.stopTimeS, `${path}.stopTimeS`),
    numberOfIntervals: positiveInteger(
      root.numberOfIntervals,
      `${path}.numberOfIntervals`,
    ),
    solver: safeId(root.solver, `${path}.solver`),
    timeoutMs: positiveInteger(root.timeoutMs, `${path}.timeoutMs`),
    parameters,
    metrics,
  });
}

function validateMethod(
  value: unknown,
  path: string,
): ModelicaIsolatedInputBundle["method"] {
  const root = exactRecord(value, ["lowering", "resultNormalizer", "engine"], path);
  const lowering = validateIdentity(root.lowering, `${path}.lowering`);
  const resultNormalizer = validateIdentity(
    root.resultNormalizer,
    `${path}.resultNormalizer`,
  );
  if (
    deterministicJson(lowering) !== deterministicJson(MODELICA_LOCAL_LOWERING) ||
    deterministicJson(resultNormalizer) !==
      deterministicJson(MODELICA_LOCAL_RESULT_NORMALIZER)
  ) throw new TypeError(`${path} is not the code-owned Modelica method.`);
  const engineRoot = exactRecord(
    root.engine,
    ["name", "version", "mslVersion"],
    `${path}.engine`,
  );
  literalValue(engineRoot.name, "OpenModelica", `${path}.engine.name`);
  literalValue(engineRoot.version, "1.27.0", `${path}.engine.version`);
  literalValue(engineRoot.mslVersion, "4.1.0", `${path}.engine.mslVersion`);
  return deepFreeze({
    lowering: MODELICA_LOCAL_LOWERING,
    resultNormalizer: MODELICA_LOCAL_RESULT_NORMALIZER,
    engine: {
      name: "OpenModelica",
      version: "1.27.0",
      mslVersion: "4.1.0",
    },
  });
}

function validateIdentity(
  value: unknown,
  path: string,
): { readonly id: string; readonly version: string } {
  const root = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: safeVersion(root.version, `${path}.version`),
  });
}

function validateThreadBasis(
  value: unknown,
  path: string,
): EngineeringThreadSnapshotBasis {
  const root = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId"],
    path,
  );
  literalValue(root.kind, "thread-snapshot", `${path}.kind`);
  const snapshotId = safeId(root.snapshotId, `${path}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path}.snapshotId cannot be latest.`);
  }
  return deepFreeze({
    kind: "thread-snapshot",
    snapshotId,
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
}

function parameterSpecs(
  admission: ModelicaQualifiedKitRunAdmission,
): readonly ScalarSpec[] {
  const specs: ScalarSpec[] = [];
  const add = (suffix: string, value: Scalar): void => {
    specs.push({
      key: `${PREFIX}.${suffix}`,
      label: `Qualified Modelica kit: ${suffix}`,
      value,
    });
  };
  const fp = (suffix: string, value: ContentFingerprint): void => {
    add(`${suffix}.algorithm`, value.algorithm);
    add(`${suffix}.digest`, value.digest);
  };
  const identity = (
    suffix: string,
    value: { readonly id: string; readonly version: string },
  ): void => {
    add(`${suffix}.id`, value.id);
    add(`${suffix}.version`, value.version);
  };
  const method = (
    suffix: string,
    value: ModelicaIsolatedInputBundle["method"],
  ): void => {
    identity(`${suffix}.lowering`, value.lowering);
    identity(`${suffix}.resultNormalizer`, value.resultNormalizer);
    add(`${suffix}.engine.name`, value.engine.name);
    add(`${suffix}.engine.version`, value.engine.version);
    add(`${suffix}.engine.mslVersion`, value.engine.mslVersion);
  };
  add("admission.schemaVersion", admission.schemaVersion);
  identity("operation", admission.operation);
  add("project.id", admission.project.id);
  add("project.basis.kind", admission.project.basis.kind);
  add("project.basis.snapshotId", admission.project.basis.snapshotId);
  add("project.basis.revision", admission.project.basis.revision);
  add("project.basis.subjectId", admission.project.basis.subjectId);
  add("intent.purpose", admission.intent.purpose);
  add("intent.arbitraryModelica", admission.intent.arbitraryModelica);
  add("bundle.schemaVersion", admission.bundle.schemaVersion);
  fp("bundle.fingerprint", admission.bundle.fingerprint);
  add("bundle.byteCount", admission.bundle.byteCount);
  add("bundle.qualification.caseSha256", admission.bundle.qualification.caseSha256);
  add(
    "bundle.qualification.manifestSha256",
    admission.bundle.qualification.manifestSha256,
  );
  add(
    "bundle.qualification.sourceCaptureSha256",
    admission.bundle.qualification.sourceCaptureSha256,
  );
  add("bundle.selection.modelId", admission.bundle.selection.modelId);
  add("bundle.selection.modelVersion", admission.bundle.selection.modelVersion);
  add("bundle.selection.scenarioId", admission.bundle.selection.scenarioId);
  const invocation = admission.bundle.invocation;
  add("bundle.invocation.modelName", invocation.modelName);
  add("bundle.invocation.startTimeS", invocation.startTimeS);
  add("bundle.invocation.stopTimeS", invocation.stopTimeS);
  add("bundle.invocation.numberOfIntervals", invocation.numberOfIntervals);
  add("bundle.invocation.solver", invocation.solver);
  add("bundle.invocation.timeoutMs", invocation.timeoutMs);
  add("bundle.invocation.parameters.count", invocation.parameters.length);
  invocation.parameters.forEach((parameter, index) => {
    const base = `bundle.invocation.parameters.${index}`;
    add(`${base}.id`, parameter.id);
    add(`${base}.modelicaName`, parameter.modelicaName);
    add(`${base}.inputValue`, parameter.inputValue);
    add(`${base}.inputUnit`, parameter.inputUnit);
    add(`${base}.modelicaValue`, parameter.modelicaValue);
    add(`${base}.modelicaUnit`, parameter.modelicaUnit);
  });
  add("bundle.invocation.metrics.count", invocation.metrics.length);
  invocation.metrics.forEach((metric, index) => {
    const base = `bundle.invocation.metrics.${index}`;
    add(`${base}.id`, metric.id);
    add(`${base}.unit`, metric.unit);
    add(`${base}.required`, metric.required);
  });
  method("bundle.method", admission.bundle.method);
  add("bundle.inputs.count", admission.bundle.inputs.length);
  admission.bundle.inputs.forEach((input, index) => {
    const base = `bundle.inputs.${index}`;
    add(`${base}.role`, input.role);
    add(`${base}.basename`, input.basename);
    add(`${base}.mediaType`, input.mediaType);
    add(`${base}.byteCount`, input.byteCount);
    add(`${base}.sha256`, input.sha256);
  });
  const profile = admission.execution.profile;
  add("execution.profile.schemaVersion", profile.schemaVersion);
  identity("execution.profile.executionProfile", profile.executionProfile);
  fp("execution.profile.profileFingerprint", profile.profileFingerprint);
  add("execution.profile.runtimeBackend.id", profile.runtimeBackend.id);
  add("execution.profile.runtimeBackend.version", profile.runtimeBackend.version);
  add("execution.profile.runtimeBackend.lifecycle", profile.runtimeBackend.lifecycle);
  add("execution.profile.runtimeBackend.network", profile.runtimeBackend.network);
  add(
    "execution.profile.runtimeBackend.imageReference",
    profile.runtimeBackend.imageReference,
  );
  fp(
    "execution.profile.runtimeBackend.imageDigest",
    profile.runtimeBackend.imageDigest,
  );
  identity("execution.profile.qualifiedContract", profile.qualifiedContract);
  method("execution.profile.method", profile.method);
  add("execution.profile.wrapper.id", profile.wrapper.id);
  add("execution.profile.wrapper.version", profile.wrapper.version);
  add("execution.profile.wrapper.sha256", profile.wrapper.sha256);
  add("execution.profile.wrapper.invocation", profile.wrapper.invocation);
  identity("execution.profile.isolationPolicy", profile.isolationPolicy);
  fp(
    "execution.profile.isolationPolicy.fingerprint",
    profile.isolationPolicy.fingerprint,
  );
  add("execution.profile.runtime.isolationClass", profile.runtime.isolationClass);
  fp("execution.profile.runtime.imageDigest", profile.runtime.imageDigest);
  for (const key of LIMIT_KEYS) {
    add(
      `execution.profile.runtime.requestedLimits.${key}`,
      profile.runtime.requestedLimits[key],
    );
  }
  for (const key of LIMIT_KEYS) {
    add(
      `execution.profile.runtime.limitAssurance.${key}`,
      profile.runtime.limitAssurance[key],
    );
  }
  add("execution.profile.outputManifest.count", profile.outputManifest.length);
  profile.outputManifest.forEach((output, index) => {
    const base = `execution.profile.outputManifest.${index}`;
    add(`${base}.role`, output.role);
    add(`${base}.basename`, output.basename);
    add(`${base}.mediaType`, output.mediaType);
    add(`${base}.format`, output.format);
  });
  identity("execution.profile.outputValidator", profile.outputValidator);
  add("execution.profile.maximumBundleBytes", profile.maximumBundleBytes);
  add(
    "execution.profile.minimumDestructionAssurance",
    profile.minimumDestructionAssurance,
  );
  const qualification = admission.execution.runtimeQualification;
  add("execution.runtimeQualification.schemaVersion", qualification.schemaVersion);
  add("execution.runtimeQualification.uri", qualification.uri);
  fp("execution.runtimeQualification.fingerprint", qualification.fingerprint);
  fp(
    "execution.runtimeQualification.executionProfileFingerprint",
    qualification.executionProfileFingerprint,
  );
  add("status", admission.status);
  return specs;
}

class ParameterReader {
  constructor(private readonly values: ReadonlyMap<string, Scalar>) {}

  string(suffix: string): string {
    const value = this.get(suffix);
    if (typeof value !== "string") {
      throw new TypeError(`${this.key(suffix)} must be string.`);
    }
    return value;
  }

  number(suffix: string): number {
    const value = this.get(suffix);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${this.key(suffix)} must be finite number.`);
    }
    return value;
  }

  boolean(suffix: string): boolean {
    const value = this.get(suffix);
    if (typeof value !== "boolean") {
      throw new TypeError(`${this.key(suffix)} must be boolean.`);
    }
    return value;
  }

  literal<T extends Scalar>(suffix: string, expected: T): T {
    const value = this.get(suffix);
    if (!Object.is(value, expected)) {
      throw new TypeError(`${this.key(suffix)} has a foreign value.`);
    }
    return expected;
  }

  fingerprint(suffix: string): ContentFingerprint {
    return {
      algorithm: this.literal(`${suffix}.algorithm`, "sha256"),
      digest: this.string(`${suffix}.digest`),
    };
  }

  identity(suffix: string): { readonly id: string; readonly version: string } {
    return {
      id: this.string(`${suffix}.id`),
      version: this.string(`${suffix}.version`),
    };
  }

  method(suffix: string): ModelicaIsolatedInputBundle["method"] {
    return {
      lowering: this.identity(`${suffix}.lowering`),
      resultNormalizer: this.identity(`${suffix}.resultNormalizer`),
      engine: {
        name: this.string(`${suffix}.engine.name`),
        version: this.string(`${suffix}.engine.version`),
        mslVersion: this.string(`${suffix}.engine.mslVersion`),
      },
    };
  }

  private get(suffix: string): Scalar {
    const key = this.key(suffix);
    const value = this.values.get(key);
    if (value === undefined) throw new TypeError(`Missing parameter ${key}.`);
    return value;
  }

  private key(suffix: string): string {
    return `${PREFIX}.${suffix}`;
  }
}

function readBundle(read: ParameterReader): unknown {
  const parameterCount = read.literal("bundle.invocation.parameters.count", 2);
  const metricCount = read.literal("bundle.invocation.metrics.count", 1);
  const inputCount = read.literal("bundle.inputs.count", 2);
  return {
    schemaVersion: read.literal(
      "bundle.schemaVersion",
      MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    ),
    fingerprint: read.fingerprint("bundle.fingerprint"),
    byteCount: read.number("bundle.byteCount"),
    qualification: {
      caseSha256: read.string("bundle.qualification.caseSha256"),
      manifestSha256: read.string("bundle.qualification.manifestSha256"),
      sourceCaptureSha256: read.string("bundle.qualification.sourceCaptureSha256"),
    },
    selection: {
      modelId: read.string("bundle.selection.modelId"),
      modelVersion: read.string("bundle.selection.modelVersion"),
      scenarioId: read.string("bundle.selection.scenarioId"),
    },
    invocation: {
      modelName: read.string("bundle.invocation.modelName"),
      startTimeS: read.number("bundle.invocation.startTimeS"),
      stopTimeS: read.number("bundle.invocation.stopTimeS"),
      numberOfIntervals: read.number("bundle.invocation.numberOfIntervals"),
      solver: read.string("bundle.invocation.solver"),
      timeoutMs: read.number("bundle.invocation.timeoutMs"),
      parameters: Array.from({ length: parameterCount }, (_, index) => ({
        id: read.string(`bundle.invocation.parameters.${index}.id`),
        modelicaName: read.string(`bundle.invocation.parameters.${index}.modelicaName`),
        inputValue: read.number(`bundle.invocation.parameters.${index}.inputValue`),
        inputUnit: read.string(`bundle.invocation.parameters.${index}.inputUnit`),
        modelicaValue: read.number(
          `bundle.invocation.parameters.${index}.modelicaValue`,
        ),
        modelicaUnit: read.string(`bundle.invocation.parameters.${index}.modelicaUnit`),
      })),
      metrics: Array.from({ length: metricCount }, (_, index) => ({
        id: read.string(`bundle.invocation.metrics.${index}.id`),
        unit: read.string(`bundle.invocation.metrics.${index}.unit`),
        required: read.boolean(`bundle.invocation.metrics.${index}.required`),
      })),
    },
    method: read.method("bundle.method"),
    inputs: Array.from({ length: inputCount }, (_, index) => ({
      role: read.string(`bundle.inputs.${index}.role`),
      basename: read.string(`bundle.inputs.${index}.basename`),
      mediaType: read.string(`bundle.inputs.${index}.mediaType`),
      byteCount: read.number(`bundle.inputs.${index}.byteCount`),
      sha256: read.string(`bundle.inputs.${index}.sha256`),
    })),
  };
}

function readProfile(read: ParameterReader): unknown {
  const outputCount = read.literal("execution.profile.outputManifest.count", 2);
  const limits = Object.fromEntries(LIMIT_KEYS.map((key) => [
    key,
    read.number(`execution.profile.runtime.requestedLimits.${key}`),
  ]));
  const assurance = Object.fromEntries(LIMIT_KEYS.map((key) => [
    key,
    read.string(`execution.profile.runtime.limitAssurance.${key}`),
  ]));
  return {
    schemaVersion: read.literal(
      "execution.profile.schemaVersion",
      MODELICA_ISOLATED_EXECUTION_PROFILE_SCHEMA,
    ),
    executionProfile: read.identity("execution.profile.executionProfile"),
    profileFingerprint: read.fingerprint("execution.profile.profileFingerprint"),
    runtimeBackend: {
      id: read.string("execution.profile.runtimeBackend.id"),
      version: read.string("execution.profile.runtimeBackend.version"),
      lifecycle: read.string("execution.profile.runtimeBackend.lifecycle"),
      network: read.string("execution.profile.runtimeBackend.network"),
      imageReference: read.string("execution.profile.runtimeBackend.imageReference"),
      imageDigest: read.fingerprint("execution.profile.runtimeBackend.imageDigest"),
    },
    qualifiedContract: read.identity("execution.profile.qualifiedContract"),
    method: read.method("execution.profile.method"),
    wrapper: {
      id: read.string("execution.profile.wrapper.id"),
      version: read.string("execution.profile.wrapper.version"),
      sha256: read.string("execution.profile.wrapper.sha256"),
      invocation: read.string("execution.profile.wrapper.invocation"),
    },
    isolationPolicy: {
      ...read.identity("execution.profile.isolationPolicy"),
      fingerprint: read.fingerprint("execution.profile.isolationPolicy.fingerprint"),
    },
    runtime: {
      isolationClass: read.string("execution.profile.runtime.isolationClass"),
      imageDigest: read.fingerprint("execution.profile.runtime.imageDigest"),
      requestedLimits: limits,
      limitAssurance: assurance,
    },
    outputManifest: Array.from({ length: outputCount }, (_, index) => ({
      role: read.string(`execution.profile.outputManifest.${index}.role`),
      basename: read.string(`execution.profile.outputManifest.${index}.basename`),
      mediaType: read.string(`execution.profile.outputManifest.${index}.mediaType`),
      format: read.string(`execution.profile.outputManifest.${index}.format`),
    })),
    outputValidator: read.identity("execution.profile.outputValidator"),
    maximumBundleBytes: read.number("execution.profile.maximumBundleBytes"),
    minimumDestructionAssurance: read.string(
      "execution.profile.minimumDestructionAssurance",
    ),
  };
}

function readQualification(read: ParameterReader): unknown {
  return {
    schemaVersion: read.string("execution.runtimeQualification.schemaVersion"),
    uri: read.string("execution.runtimeQualification.uri"),
    fingerprint: read.fingerprint("execution.runtimeQualification.fingerprint"),
    executionProfileFingerprint: read.fingerprint(
      "execution.runtimeQualification.executionProfileFingerprint",
    ),
  };
}

function scalar(value: unknown, path: string): Scalar {
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "boolean"
  ) throw new TypeError(`${path} must be a scalar.`);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${path} must be finite.`);
  }
  return value;
}
