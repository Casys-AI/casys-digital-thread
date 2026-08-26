/**
 * Closed MRTR grammar for one admitted SPICE closed-subset execution.
 *
 * The signed proposal names one `compile.seal-admission@3` artifact and one
 * server-owned isolation contract. It carries no SPICE text, provider
 * capability, executable, or caller-selected runtime. Parsing never grants
 * dispatch: the executor must reopen the admission bytes.
 */

import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  type MicrosandboxLocalRuntimeIdentity,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../compile/isolation/local-isolation-runtime.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../../project/engineering-project.ts";
import { TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA } from "../../../compile/admission/technical-compilation-proposal.ts";
import {
  SPICE_ADMITTED_EVIDENCE_OUTPUT,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_RESULT_OUTPUT,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_OPERATING_POINT_EXPORT,
} from "./contract.ts";

export const SIMULATE_RUN_ADMITTED_SPICE_OPERATION = Object.freeze(
  {
    id: "simulate.run-admitted-spice",
    version: "1",
  } as const,
);

export const SPICE_ADMITTED_RUN_ADMISSION_SCHEMA =
  "spice-admitted-run-admission/2.0" as const;
export const SPICE_ADMITTED_COMPILATION_SCHEMA = "technical-compilation/2.0" as const;
export const SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA =
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA;

export const SPICE_ADMITTED_EXECUTION_PROFILE =
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE;

export const SPICE_ADMITTED_COMPILATION_PROFILE_ID =
  "spice-circuit-closed-subset-v1" as const;

export {
  SPICE_ADMITTED_EVIDENCE_OUTPUT,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_RESULT_OUTPUT,
};

export const SPICE_ADMITTED_OUTPUT_VALIDATOR = SPICE_OPERATING_POINT_EXPORT;

export interface SpiceAdmittedOutputValidatorRef {
  readonly id: string;
  readonly version: string;
}

export type SpiceAdmittedMinimumDestructionAssurance =
  | "acknowledged-unattested"
  | "proven";

export interface SpiceAdmittedExecutionLimits {
  readonly maxWallTimeMs: number;
  readonly maxCpuTimeMs: number;
  readonly maxMemoryBytes: number;
  readonly maxProcesses: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxOutputFileBytes: number;
  readonly maxOutputTotalBytes: number;
}

export type SpiceAdmittedLimitAssurance =
  | "backend-attested"
  | "broker-observed-cap"
  | "unattested";

export type SpiceAdmittedLimitAssuranceMatrix = {
  readonly [Key in keyof SpiceAdmittedExecutionLimits]: SpiceAdmittedLimitAssurance;
};

export interface SpiceAdmittedRunAdmission {
  readonly schemaVersion: typeof SPICE_ADMITTED_RUN_ADMISSION_SCHEMA;
  readonly admissionArtifact: {
    readonly schemaVersion: typeof SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA;
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly compilation: {
    readonly document: {
      readonly schemaVersion: typeof SPICE_ADMITTED_COMPILATION_SCHEMA;
      readonly fingerprint: ContentFingerprint;
      readonly status: "ready-for-review";
    };
    readonly projection: {
      readonly target: "spice-circuit-source";
      readonly fingerprint: ContentFingerprint;
      readonly status: "ready-for-review";
    };
    readonly source: {
      readonly id: string;
      readonly sourceFingerprint: ContentFingerprint;
      readonly captureFingerprint: ContentFingerprint;
      readonly analysisFingerprint: ContentFingerprint;
    };
    readonly profile: {
      readonly id: typeof SPICE_ADMITTED_COMPILATION_PROFILE_ID;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
    };
  };
  readonly execution: {
    readonly profile: {
      readonly id: typeof SPICE_ADMITTED_EXECUTION_PROFILE.id;
      readonly version: typeof SPICE_ADMITTED_EXECUTION_PROFILE.version;
      readonly fingerprint: ContentFingerprint;
    };
    readonly isolationPolicy: {
      readonly id: string;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly runtimeBackend: MicrosandboxLocalRuntimeIdentity;
    readonly runtime: {
      readonly imageDigest: ContentFingerprint;
      readonly isolationClass: typeof MICROSANDBOX_LOCAL_ISOLATION_CLASS;
      readonly limits: SpiceAdmittedExecutionLimits;
      readonly limitAssurance: SpiceAdmittedLimitAssuranceMatrix;
    };
    readonly outputValidator: SpiceAdmittedOutputValidatorRef;
    readonly outputs: typeof SPICE_ADMITTED_OUTPUT_MANIFEST;
    readonly minimumDestructionAssurance: SpiceAdmittedMinimumDestructionAssurance;
  };
  readonly status: "ready-for-execution-review";
}

type ParameterValue = EngineeringDecisionProposalParameter["value"];

interface ParameterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: ParameterValue;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const PARAMETER_PREFIX = "simulate.spice.admitted";

const LIMIT_KEYS = [
  "maxWallTimeMs",
  "maxCpuTimeMs",
  "maxMemoryBytes",
  "maxProcesses",
  "maxStdoutBytes",
  "maxStderrBytes",
  "maxOutputFileBytes",
  "maxOutputTotalBytes",
] as const satisfies readonly (keyof SpiceAdmittedExecutionLimits)[];

const FIXED_PARAMETER_COUNT = 60;

export function encodeSpiceAdmittedRunAdmissionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateSpiceAdmittedRunAdmission(value);
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

export function parseSpiceAdmittedRunAdmissionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): SpiceAdmittedRunAdmission {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  if (parameters.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      `$parameters must contain exactly ${FIXED_PARAMETER_COUNT} entries.`,
    );
  }

  const values = new Map<string, ParameterValue>();
  const actualKeys: string[] = [];
  const actualLabels = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    const record = exactRecord(
      parameter,
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    const key = safeId(record.key, `$parameters[${index}].key`);
    if (values.has(key)) {
      throw new TypeError(`$parameters contains duplicate key ${key}.`);
    }
    values.set(
      key,
      requireParameterValue(record.value, `$parameters[${index}].value`),
    );
    actualLabels.set(
      key,
      requireLabel(record.label, `$parameters[${index}].label`),
    );
    actualKeys.push(key);
  }

  const parsed = validateSpiceAdmittedRunAdmission({
    schemaVersion: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.schemaVersion`,
      SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
    ),
    admissionArtifact: {
      schemaVersion: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.admissionArtifact.schemaVersion`,
        SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
      ),
      id: requireId(values, `${PARAMETER_PREFIX}.admissionArtifact.id`),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.admissionArtifact.sha256`,
      ),
    },
    compilation: {
      document: {
        schemaVersion: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.compilation.document.schemaVersion`,
          SPICE_ADMITTED_COMPILATION_SCHEMA,
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.compilation.document.sha256`,
        ),
        status: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.compilation.document.status`,
          "ready-for-review",
        ),
      },
      projection: {
        target: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.compilation.projection.target`,
          "spice-circuit-source",
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.compilation.projection.sha256`,
        ),
        status: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.compilation.projection.status`,
          "ready-for-review",
        ),
      },
      source: {
        id: requireId(values, `${PARAMETER_PREFIX}.compilation.source.id`),
        sourceFingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.compilation.source.sourceSha256`,
        ),
        captureFingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.compilation.source.captureSha256`,
        ),
        analysisFingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.compilation.source.analysisSha256`,
        ),
      },
      profile: {
        id: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.compilation.profile.id`,
          SPICE_ADMITTED_COMPILATION_PROFILE_ID,
        ),
        version: requireVersion(
          values,
          `${PARAMETER_PREFIX}.compilation.profile.version`,
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.compilation.profile.sha256`,
        ),
      },
    },
    execution: {
      profile: {
        id: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.profile.id`,
          SPICE_ADMITTED_EXECUTION_PROFILE.id,
        ),
        version: requireLiteralVersion(
          values,
          `${PARAMETER_PREFIX}.profile.version`,
          SPICE_ADMITTED_EXECUTION_PROFILE.version,
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.profile.sha256`,
        ),
      },
      isolationPolicy: {
        id: requireId(values, `${PARAMETER_PREFIX}.isolationPolicy.id`),
        version: requireVersion(
          values,
          `${PARAMETER_PREFIX}.isolationPolicy.version`,
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.isolationPolicy.sha256`,
        ),
      },
      runtimeBackend: {
        id: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.runtimeBackend.id`,
          MICROSANDBOX_LOCAL_RUNTIME_REF.id,
        ),
        version: requireLiteralVersion(
          values,
          `${PARAMETER_PREFIX}.runtimeBackend.version`,
          MICROSANDBOX_LOCAL_RUNTIME_REF.version,
        ),
        lifecycle: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.runtimeBackend.lifecycle`,
          MICROSANDBOX_LOCAL_RUNTIME_REF.lifecycle,
        ),
        network: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.runtimeBackend.network`,
          MICROSANDBOX_LOCAL_RUNTIME_REF.network,
        ),
        imageReference: requireText(
          values,
          `${PARAMETER_PREFIX}.runtimeBackend.imageReference`,
        ),
        imageDigest: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.runtimeBackend.imageSha256`,
        ),
      },
      runtime: {
        isolationClass: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.runtime.isolationClass`,
          MICROSANDBOX_LOCAL_ISOLATION_CLASS,
        ),
        imageDigest: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.runtime.imageSha256`,
        ),
        limits: Object.fromEntries(LIMIT_KEYS.map((key) => [
          key,
          requirePositiveInteger(
            values,
            `${PARAMETER_PREFIX}.runtime.limits.${key}`,
          ),
        ])) as unknown as SpiceAdmittedExecutionLimits,
        limitAssurance: Object.fromEntries(LIMIT_KEYS.map((key) => [
          key,
          requireLimitAssurance(
            values,
            `${PARAMETER_PREFIX}.runtime.limitAssurance.${key}`,
          ),
        ])) as unknown as SpiceAdmittedLimitAssuranceMatrix,
      },
      outputValidator: {
        id: requireId(values, `${PARAMETER_PREFIX}.outputValidator.id`),
        version: requireVersion(
          values,
          `${PARAMETER_PREFIX}.outputValidator.version`,
        ),
      },
      outputs: [
        {
          role: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.evidence.role`,
            SPICE_ADMITTED_EVIDENCE_OUTPUT.role,
          ),
          basename: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.evidence.basename`,
            SPICE_ADMITTED_EVIDENCE_OUTPUT.basename,
          ),
          mediaType: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.evidence.mediaType`,
            SPICE_ADMITTED_EVIDENCE_OUTPUT.mediaType,
          ),
          format: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.evidence.format`,
            SPICE_ADMITTED_EVIDENCE_OUTPUT.format,
          ),
        },
        {
          role: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.result.role`,
            SPICE_ADMITTED_RESULT_OUTPUT.role,
          ),
          basename: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.result.basename`,
            SPICE_ADMITTED_RESULT_OUTPUT.basename,
          ),
          mediaType: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.result.mediaType`,
            SPICE_ADMITTED_RESULT_OUTPUT.mediaType,
          ),
          format: requireLiteral(
            values,
            `${PARAMETER_PREFIX}.output.result.format`,
            SPICE_ADMITTED_RESULT_OUTPUT.format,
          ),
        },
      ],
      minimumDestructionAssurance: requireMinimumDestructionAssurance(
        values,
        `${PARAMETER_PREFIX}.minimumDestructionAssurance`,
      ),
    },
    status: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.status`,
      "ready-for-execution-review",
    ),
  });

  const expected = parameterSpecs(parsed);
  for (const [index, spec] of expected.entries()) {
    if (actualKeys[index] !== spec.key) {
      throw new TypeError(
        `$parameters[${index}].key must equal ${spec.key}.`,
      );
    }
    if (actualLabels.get(spec.key) !== spec.label) {
      throw new TypeError(
        `$parameters label for ${spec.key} must equal ${JSON.stringify(spec.label)}.`,
      );
    }
    if (!Object.is(values.get(spec.key), spec.value)) {
      throw new TypeError(
        `$parameters value for ${spec.key} is not its exact canonical scalar.`,
      );
    }
  }
  return parsed;
}

export function validateSpiceAdmittedRunAdmission(
  value: unknown,
  path = "$spiceAdmittedRunAdmission",
): SpiceAdmittedRunAdmission {
  const root = exactRecord(
    value,
    ["schemaVersion", "admissionArtifact", "compilation", "execution", "status"],
    path,
  );
  literalValue(
    root.schemaVersion,
    SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.status, "ready-for-execution-review", `${path}.status`);

  const artifact = exactRecord(
    root.admissionArtifact,
    ["schemaVersion", "id", "fingerprint"],
    `${path}.admissionArtifact`,
  );
  literalValue(
    artifact.schemaVersion,
    SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
    `${path}.admissionArtifact.schemaVersion`,
  );
  const artifactFingerprint = parseFingerprint(
    artifact.fingerprint,
    `${path}.admissionArtifact.fingerprint`,
  );
  const artifactId = safeId(artifact.id, `${path}.admissionArtifact.id`);
  const expectedArtifactId =
    `technical-compilation-admission-${artifactFingerprint.digest}`;
  if (artifactId !== expectedArtifactId) {
    throw new TypeError(
      `${path}.admissionArtifact.id must be derived from its exact fingerprint.`,
    );
  }

  const compilation = exactRecord(
    root.compilation,
    ["document", "projection", "source", "profile"],
    `${path}.compilation`,
  );
  const document = exactRecord(
    compilation.document,
    ["schemaVersion", "fingerprint", "status"],
    `${path}.compilation.document`,
  );
  literalValue(
    document.schemaVersion,
    SPICE_ADMITTED_COMPILATION_SCHEMA,
    `${path}.compilation.document.schemaVersion`,
  );
  literalValue(
    document.status,
    "ready-for-review",
    `${path}.compilation.document.status`,
  );
  const projection = exactRecord(
    compilation.projection,
    ["target", "fingerprint", "status"],
    `${path}.compilation.projection`,
  );
  literalValue(
    projection.target,
    "spice-circuit-source",
    `${path}.compilation.projection.target`,
  );
  literalValue(
    projection.status,
    "ready-for-review",
    `${path}.compilation.projection.status`,
  );
  const source = exactRecord(
    compilation.source,
    ["id", "sourceFingerprint", "captureFingerprint", "analysisFingerprint"],
    `${path}.compilation.source`,
  );
  const compilationProfile = exactRecord(
    compilation.profile,
    ["id", "version", "fingerprint"],
    `${path}.compilation.profile`,
  );
  literalValue(
    compilationProfile.id,
    SPICE_ADMITTED_COMPILATION_PROFILE_ID,
    `${path}.compilation.profile.id`,
  );

  const execution = exactRecord(
    root.execution,
    [
      "profile",
      "isolationPolicy",
      "runtimeBackend",
      "runtime",
      "outputValidator",
      "outputs",
      "minimumDestructionAssurance",
    ],
    path + ".execution",
  );
  const executionProfile = exactRecord(
    execution.profile,
    ["id", "version", "fingerprint"],
    `${path}.execution.profile`,
  );
  literalValue(
    executionProfile.id,
    SPICE_ADMITTED_EXECUTION_PROFILE.id,
    `${path}.execution.profile.id`,
  );
  literalValue(
    safeVersion(executionProfile.version, `${path}.execution.profile.version`),
    SPICE_ADMITTED_EXECUTION_PROFILE.version,
    `${path}.execution.profile.version`,
  );

  const isolationPolicy = exactRecord(
    execution.isolationPolicy,
    ["id", "version", "fingerprint"],
    `${path}.execution.isolationPolicy`,
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    execution.runtimeBackend,
    `${path}.execution.runtimeBackend`,
  );
  const runtime = exactRecord(
    execution.runtime,
    ["imageDigest", "isolationClass", "limits", "limitAssurance"],
    `${path}.execution.runtime`,
  );
  const limits = parseLimits(runtime.limits, `${path}.execution.runtime.limits`);
  const limitAssurance = parseLimitAssuranceMatrix(
    runtime.limitAssurance,
    `${path}.execution.runtime.limitAssurance`,
  );
  const runtimeImageDigest = parseFingerprint(
    runtime.imageDigest,
    `${path}.execution.runtime.imageDigest`,
  );
  if (runtimeBackend.imageDigest.digest !== runtimeImageDigest.digest) {
    throw new TypeError(
      `${path}.execution.runtime image digest must equal runtimeBackend.imageDigest.`,
    );
  }
  const outputValidator = exactRecord(
    execution.outputValidator,
    ["id", "version"],
    `${path}.execution.outputValidator`,
  );
  if (
    !Array.isArray(execution.outputs) ||
    execution.outputs.length !== SPICE_ADMITTED_OUTPUT_MANIFEST.length
  ) {
    throw new TypeError(
      `${path}.execution.outputs must declare evidence and result.`,
    );
  }
  for (const [index, expected] of SPICE_ADMITTED_OUTPUT_MANIFEST.entries()) {
    const output = exactRecord(
      execution.outputs[index],
      ["role", "basename", "mediaType", "format"],
      `${path}.execution.outputs[${index}]`,
    );
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      literalValue(
        output[key],
        expected[key],
        `${path}.execution.outputs[${index}].${key}`,
      );
    }
  }

  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
      id: artifactId,
      fingerprint: artifactFingerprint,
    },
    compilation: {
      document: {
        schemaVersion: SPICE_ADMITTED_COMPILATION_SCHEMA,
        fingerprint: parseFingerprint(
          document.fingerprint,
          `${path}.compilation.document.fingerprint`,
        ),
        status: "ready-for-review",
      },
      projection: {
        target: "spice-circuit-source",
        fingerprint: parseFingerprint(
          projection.fingerprint,
          `${path}.compilation.projection.fingerprint`,
        ),
        status: "ready-for-review",
      },
      source: {
        id: safeId(source.id, `${path}.compilation.source.id`),
        sourceFingerprint: parseFingerprint(
          source.sourceFingerprint,
          `${path}.compilation.source.sourceFingerprint`,
        ),
        captureFingerprint: parseFingerprint(
          source.captureFingerprint,
          `${path}.compilation.source.captureFingerprint`,
        ),
        analysisFingerprint: parseFingerprint(
          source.analysisFingerprint,
          `${path}.compilation.source.analysisFingerprint`,
        ),
      },
      profile: {
        id: SPICE_ADMITTED_COMPILATION_PROFILE_ID,
        version: safeVersion(
          compilationProfile.version,
          `${path}.compilation.profile.version`,
        ),
        fingerprint: parseFingerprint(
          compilationProfile.fingerprint,
          `${path}.compilation.profile.fingerprint`,
        ),
      },
    },
    execution: {
      profile: {
        id: SPICE_ADMITTED_EXECUTION_PROFILE.id,
        version: SPICE_ADMITTED_EXECUTION_PROFILE.version,
        fingerprint: parseFingerprint(
          executionProfile.fingerprint,
          `${path}.execution.profile.fingerprint`,
        ),
      },
      isolationPolicy: {
        id: safeId(isolationPolicy.id, `${path}.execution.isolationPolicy.id`),
        version: safeVersion(
          isolationPolicy.version,
          `${path}.execution.isolationPolicy.version`,
        ),
        fingerprint: parseFingerprint(
          isolationPolicy.fingerprint,
          `${path}.execution.isolationPolicy.fingerprint`,
        ),
      },
      runtimeBackend,
      runtime: {
        imageDigest: runtimeImageDigest,
        isolationClass: literalRuntimeIsolationClass(
          runtime.isolationClass,
          `${path}.execution.runtime.isolationClass`,
        ),
        limits,
        limitAssurance,
      },
      outputValidator: {
        id: safeId(outputValidator.id, `${path}.execution.outputValidator.id`),
        version: safeVersion(
          outputValidator.version,
          `${path}.execution.outputValidator.version`,
        ),
      },
      outputs: SPICE_ADMITTED_OUTPUT_MANIFEST,
      minimumDestructionAssurance: minimumDestructionAssurance(
        execution.minimumDestructionAssurance,
        `${path}.execution.minimumDestructionAssurance`,
      ),
    },
    status: "ready-for-execution-review",
  });
}

function parameterSpecs(
  admission: SpiceAdmittedRunAdmission,
): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const add = (key: string, label: string, value: ParameterValue) => {
    specs.push({ key, label, value });
  };
  add(
    `${PARAMETER_PREFIX}.schemaVersion`,
    "Admitted SPICE run admission schema",
    admission.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.operation`,
    "Reviewed operation",
    `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}`,
  );
  add(
    `${PARAMETER_PREFIX}.admissionArtifact.schemaVersion`,
    "Compiled admission artifact schema",
    admission.admissionArtifact.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.admissionArtifact.id`,
    "Compiled admission artifact ID",
    admission.admissionArtifact.id,
  );
  add(
    `${PARAMETER_PREFIX}.admissionArtifact.sha256`,
    "Compiled admission artifact SHA-256",
    admission.admissionArtifact.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.document.schemaVersion`,
    "Compilation document schema",
    admission.compilation.document.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.document.sha256`,
    "Compilation document SHA-256",
    admission.compilation.document.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.document.status`,
    "Compilation document status",
    admission.compilation.document.status,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.projection.target`,
    "Compilation projection target",
    admission.compilation.projection.target,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.projection.sha256`,
    "Compilation projection SHA-256",
    admission.compilation.projection.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.projection.status`,
    "Compilation projection status",
    admission.compilation.projection.status,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.id`,
    "Admitted SPICE source ID",
    admission.compilation.source.id,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.sourceSha256`,
    "Admitted SPICE source SHA-256",
    admission.compilation.source.sourceFingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.captureSha256`,
    "Admitted SPICE source capture SHA-256",
    admission.compilation.source.captureFingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.analysisSha256`,
    "Admitted SPICE source analysis SHA-256",
    admission.compilation.source.analysisFingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.profile.id`,
    "Compilation profile ID",
    admission.compilation.profile.id,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.profile.version`,
    "Compilation profile version",
    admission.compilation.profile.version,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.profile.sha256`,
    "Compilation profile SHA-256",
    admission.compilation.profile.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.profile.id`,
    "Execution profile ID",
    admission.execution.profile.id,
  );
  add(
    `${PARAMETER_PREFIX}.profile.version`,
    "Execution profile version",
    admission.execution.profile.version,
  );
  add(
    `${PARAMETER_PREFIX}.profile.sha256`,
    "Execution profile SHA-256",
    admission.execution.profile.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.isolationPolicy.id`,
    "Isolation policy ID",
    admission.execution.isolationPolicy.id,
  );
  add(
    `${PARAMETER_PREFIX}.isolationPolicy.version`,
    "Isolation policy version",
    admission.execution.isolationPolicy.version,
  );
  add(
    `${PARAMETER_PREFIX}.isolationPolicy.sha256`,
    "Isolation policy SHA-256",
    admission.execution.isolationPolicy.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.runtimeBackend.id`,
    "Local isolation runtime",
    admission.execution.runtimeBackend.id,
  );
  add(
    `${PARAMETER_PREFIX}.runtimeBackend.version`,
    "Local isolation runtime version",
    admission.execution.runtimeBackend.version,
  );
  add(
    `${PARAMETER_PREFIX}.runtimeBackend.lifecycle`,
    "Local isolation lifecycle",
    admission.execution.runtimeBackend.lifecycle,
  );
  add(
    `${PARAMETER_PREFIX}.runtimeBackend.network`,
    "Local isolation network",
    admission.execution.runtimeBackend.network,
  );
  add(
    `${PARAMETER_PREFIX}.runtimeBackend.imageReference`,
    "Digest-pinned OCI image",
    admission.execution.runtimeBackend.imageReference,
  );
  add(
    `${PARAMETER_PREFIX}.runtimeBackend.imageSha256`,
    "OCI image SHA-256",
    admission.execution.runtimeBackend.imageDigest.digest,
  );
  add(
    `${PARAMETER_PREFIX}.runtime.isolationClass`,
    "Runtime isolation class",
    admission.execution.runtime.isolationClass,
  );
  add(
    `${PARAMETER_PREFIX}.runtime.imageSha256`,
    "Runtime image SHA-256",
    admission.execution.runtime.imageDigest.digest,
  );
  for (const key of LIMIT_KEYS) {
    add(
      `${PARAMETER_PREFIX}.runtime.limits.${key}`,
      `Runtime limit ${key}`,
      admission.execution.runtime.limits[key],
    );
  }
  for (const key of LIMIT_KEYS) {
    add(
      `${PARAMETER_PREFIX}.runtime.limitAssurance.${key}`,
      `Runtime assurance ${key}`,
      admission.execution.runtime.limitAssurance[key],
    );
  }
  add(
    `${PARAMETER_PREFIX}.outputValidator.id`,
    "Output validator ID",
    admission.execution.outputValidator.id,
  );
  add(
    `${PARAMETER_PREFIX}.outputValidator.version`,
    "Output validator version",
    admission.execution.outputValidator.version,
  );
  add(
    `${PARAMETER_PREFIX}.output.evidence.role`,
    "Declared evidence role",
    admission.execution.outputs[0].role,
  );
  add(
    `${PARAMETER_PREFIX}.output.evidence.basename`,
    "Declared evidence basename",
    admission.execution.outputs[0].basename,
  );
  add(
    `${PARAMETER_PREFIX}.output.evidence.mediaType`,
    "Declared evidence media type",
    admission.execution.outputs[0].mediaType,
  );
  add(
    `${PARAMETER_PREFIX}.output.evidence.format`,
    "Declared evidence format",
    admission.execution.outputs[0].format,
  );
  add(
    `${PARAMETER_PREFIX}.output.result.role`,
    "Declared result role",
    admission.execution.outputs[1].role,
  );
  add(
    `${PARAMETER_PREFIX}.output.result.basename`,
    "Declared result basename",
    admission.execution.outputs[1].basename,
  );
  add(
    `${PARAMETER_PREFIX}.output.result.mediaType`,
    "Declared result media type",
    admission.execution.outputs[1].mediaType,
  );
  add(
    `${PARAMETER_PREFIX}.output.result.format`,
    "Declared result format",
    admission.execution.outputs[1].format,
  );
  add(
    `${PARAMETER_PREFIX}.minimumDestructionAssurance`,
    "Minimum destruction assurance",
    admission.execution.minimumDestructionAssurance,
  );
  add(
    `${PARAMETER_PREFIX}.status`,
    "Execution proposal status",
    admission.status,
  );
  if (specs.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      "Admitted SPICE execution MRTR grammar is internally inconsistent.",
    );
  }
  return specs;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" ||
    !SHA256_HEX.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: fingerprint.digest });
}

function parseLimits(
  value: unknown,
  path: string,
): SpiceAdmittedExecutionLimits {
  const record = exactRecord(value, LIMIT_KEYS, path);
  const limits = Object.fromEntries(LIMIT_KEYS.map((key) => [
    key,
    positiveInteger(record[key], `${path}.${key}`),
  ])) as unknown as SpiceAdmittedExecutionLimits;
  if (limits.maxOutputFileBytes > limits.maxOutputTotalBytes) {
    throw new TypeError(
      `${path}.maxOutputFileBytes must not exceed maxOutputTotalBytes.`,
    );
  }
  return deepFreeze(limits);
}

function parseLimitAssuranceMatrix(
  value: unknown,
  path: string,
): SpiceAdmittedLimitAssuranceMatrix {
  const record = exactRecord(value, LIMIT_KEYS, path);
  return deepFreeze(Object.fromEntries(LIMIT_KEYS.map((key) => [
    key,
    limitAssurance(record[key], `${path}.${key}`),
  ])) as unknown as SpiceAdmittedLimitAssuranceMatrix);
}

function limitAssurance(
  value: unknown,
  path: string,
): SpiceAdmittedLimitAssurance {
  if (
    value !== "backend-attested" && value !== "broker-observed-cap" &&
    value !== "unattested"
  ) {
    throw new TypeError(`${path} must be an explicit limit assurance.`);
  }
  return value;
}

function minimumDestructionAssurance(
  value: unknown,
  path: string,
): SpiceAdmittedMinimumDestructionAssurance {
  if (value !== "acknowledged-unattested" && value !== "proven") {
    throw new TypeError(`${path} must be acknowledged-unattested or proven.`);
  }
  return value;
}

function requireParameterValue(value: unknown, path: string): ParameterValue {
  if (
    (typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "boolean") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new TypeError(`${path} must be a finite MRTR scalar.`);
  }
  return value;
}

function requireLabel(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > 128
  ) {
    throw new TypeError(
      `${path} must be a non-empty label of at most 128 characters without edge whitespace.`,
    );
  }
  return value;
}

function requireValue(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ParameterValue {
  if (!values.has(key)) throw new TypeError(`$parameters is missing key ${key}.`);
  return values.get(key)!;
}

function requireId(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return safeId(requireValue(values, key), `$parameters.${key}`);
}

function requireVersion(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return safeVersion(requireValue(values, key), `$parameters.${key}`);
}

function requireText(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return nonEmptyText(requireValue(values, key), `$parameters.${key}`);
}

function requireLiteral<const Value extends string>(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  expected: Value,
): Value {
  literalValue(requireValue(values, key), expected, `$parameters.${key}`);
  return expected;
}

function requireLiteralVersion<const Value extends string>(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  expected: Value,
): Value {
  const value = safeVersion(requireValue(values, key), `$parameters.${key}`);
  literalValue(value, expected, `$parameters.${key}`);
  return expected;
}

function requireFingerprint(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ContentFingerprint {
  const value = requireValue(values, key);
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(`$parameters.${key} must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: value });
}

function requirePositiveInteger(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  return positiveInteger(requireValue(values, key), `$parameters.${key}`);
}

function requireLimitAssurance(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): SpiceAdmittedLimitAssurance {
  return limitAssurance(requireValue(values, key), `$parameters.${key}`);
}

function literalRuntimeIsolationClass(value: unknown, path: string) {
  literalValue(value, MICROSANDBOX_LOCAL_ISOLATION_CLASS, path);
  return MICROSANDBOX_LOCAL_ISOLATION_CLASS;
}

function requireMinimumDestructionAssurance(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): SpiceAdmittedMinimumDestructionAssurance {
  return minimumDestructionAssurance(
    requireValue(values, key),
    `$parameters.${key}`,
  );
}
