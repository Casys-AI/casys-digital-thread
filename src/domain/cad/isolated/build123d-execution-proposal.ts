/**
 * Closed MRTR grammar for one qualified Build123d execution proposal.
 *
 * This document binds reviewed compilation facts to one code-owned execution
 * and isolation contract. It carries no provider capability, executable
 * command, filesystem location, transport argument, or source bytes. Parsing a
 * proposal never grants execution authority: the exact human decision and all
 * content-addressed facts still have to be reopened by the registered executor.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  type MicrosandboxLocalRuntimeIdentity,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../compile/isolation/local-isolation-runtime.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import { TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA } from "../../compile/admission/technical-compilation-proposal.ts";

/** Human-reviewed operation identity. It is not a runtime capability. */
export const DESIGN_EXECUTE_BUILD123D_OPERATION = Object.freeze(
  {
    id: "design.execute-build123d",
    version: "1",
  } as const,
);

/** Compatibility name for consumers that group contracts by execution type. */
export const BUILD123D_EXECUTION_OPERATION = DESIGN_EXECUTE_BUILD123D_OPERATION;

export const BUILD123D_EXECUTION_ADMISSION_SCHEMA =
  "build123d-execution-admission/2.0" as const;
export const BUILD123D_EXECUTION_COMPILATION_SCHEMA =
  "technical-compilation/2.0" as const;
export const BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA =
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA;

export const BUILD123D_EXECUTION_PROFILE = Object.freeze(
  {
    id: "build123d-closed-subset-v1",
    version: "1.0.0",
  } as const,
);

export const BUILD123D_EXECUTION_OUTPUT = Object.freeze(
  {
    role: "geometry",
    basename: "geometry.step",
    mediaType: "model/step",
    format: "step-ap214",
  } as const,
);

export interface Build123dOutputValidatorRef {
  readonly id: string;
  readonly version: string;
}

export type Build123dMinimumDestructionAssurance =
  | "acknowledged-unattested"
  | "proven";

export interface Build123dExecutionLimits {
  readonly maxWallTimeMs: number;
  readonly maxCpuTimeMs: number;
  readonly maxMemoryBytes: number;
  readonly maxProcesses: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxOutputFileBytes: number;
  readonly maxOutputTotalBytes: number;
}

export type Build123dLimitAssurance =
  | "backend-attested"
  | "broker-observed-cap"
  | "unattested";

export type Build123dLimitAssuranceMatrix = {
  readonly [Key in keyof Build123dExecutionLimits]: Build123dLimitAssurance;
};

/**
 * Complete human-reviewable identity for one future isolated execution.
 *
 * Singular properties are intentional: V1 admits exactly one sealed
 * compilation artifact, one Build123d projection, one source, and one STEP
 * output declaration.
 */
export interface Build123dExecutionAdmission {
  readonly schemaVersion: typeof BUILD123D_EXECUTION_ADMISSION_SCHEMA;
  readonly admissionArtifact: {
    readonly schemaVersion: typeof BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA;
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly compilation: {
    readonly document: {
      readonly schemaVersion: typeof BUILD123D_EXECUTION_COMPILATION_SCHEMA;
      readonly fingerprint: ContentFingerprint;
      readonly status: "ready-for-review";
    };
    readonly projection: {
      readonly target: "build123d-source";
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
      readonly id: string;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
    };
  };
  readonly execution: {
    readonly profile: {
      readonly id: typeof BUILD123D_EXECUTION_PROFILE.id;
      readonly version: typeof BUILD123D_EXECUTION_PROFILE.version;
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
      readonly limits: Build123dExecutionLimits;
      readonly limitAssurance: Build123dLimitAssuranceMatrix;
    };
    readonly outputValidator: Build123dOutputValidatorRef;
    readonly output: typeof BUILD123D_EXECUTION_OUTPUT;
    readonly minimumDestructionAssurance: Build123dMinimumDestructionAssurance;
  };
  /** Review readiness is not approval and grants no dispatch authority. */
  readonly status: "ready-for-execution-review";
}

type ParameterValue = EngineeringDecisionProposalParameter["value"];

interface ParameterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: ParameterValue;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const PARAMETER_PREFIX = "design.build123d.execution";

const LIMIT_KEYS = [
  "maxWallTimeMs",
  "maxCpuTimeMs",
  "maxMemoryBytes",
  "maxProcesses",
  "maxStdoutBytes",
  "maxStderrBytes",
  "maxOutputFileBytes",
  "maxOutputTotalBytes",
] as const satisfies readonly (keyof Build123dExecutionLimits)[];

const FIXED_PARAMETER_COUNT = 56;

/** Encode a typed admission into its unique, stable MRTR parameter order. */
export function encodeBuild123dExecutionAdmissionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateBuild123dExecutionAdmission(value);
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

/**
 * Parse and replay the complete signed MRTR parameter sequence.
 *
 * Keys, labels, order, scalar types, values and derived identities are all
 * checked. In particular `Object.is` prevents signed numeric distinctions from
 * being normalized away during canonical replay.
 */
export function parseBuild123dExecutionAdmissionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): Build123dExecutionAdmission {
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

  const parsed = validateBuild123dExecutionAdmission({
    schemaVersion: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.schemaVersion`,
      BUILD123D_EXECUTION_ADMISSION_SCHEMA,
    ),
    admissionArtifact: {
      schemaVersion: requireLiteral(
        values,
        `${PARAMETER_PREFIX}.admissionArtifact.schemaVersion`,
        BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
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
          BUILD123D_EXECUTION_COMPILATION_SCHEMA,
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
          "build123d-source",
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
        id: requireId(values, `${PARAMETER_PREFIX}.compilation.profile.id`),
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
          BUILD123D_EXECUTION_PROFILE.id,
        ),
        version: requireLiteralVersion(
          values,
          `${PARAMETER_PREFIX}.profile.version`,
          BUILD123D_EXECUTION_PROFILE.version,
        ),
        fingerprint: requireFingerprint(
          values,
          `${PARAMETER_PREFIX}.profile.sha256`,
        ),
      },
      isolationPolicy: {
        id: requireId(
          values,
          `${PARAMETER_PREFIX}.isolationPolicy.id`,
        ),
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
        ])) as unknown as Build123dExecutionLimits,
        limitAssurance: Object.fromEntries(LIMIT_KEYS.map((key) => [
          key,
          requireLimitAssurance(
            values,
            `${PARAMETER_PREFIX}.runtime.limitAssurance.${key}`,
          ),
        ])) as unknown as Build123dLimitAssuranceMatrix,
      },
      outputValidator: {
        id: requireId(
          values,
          `${PARAMETER_PREFIX}.outputValidator.id`,
        ),
        version: requireVersion(
          values,
          `${PARAMETER_PREFIX}.outputValidator.version`,
        ),
      },
      output: {
        role: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.output.role`,
          BUILD123D_EXECUTION_OUTPUT.role,
        ),
        basename: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.output.basename`,
          BUILD123D_EXECUTION_OUTPUT.basename,
        ),
        mediaType: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.output.mediaType`,
          BUILD123D_EXECUTION_OUTPUT.mediaType,
        ),
        format: requireLiteral(
          values,
          `${PARAMETER_PREFIX}.output.format`,
          BUILD123D_EXECUTION_OUTPUT.format,
        ),
      },
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

/** Validate the closed object form and recompute its cross-field invariants. */
export function validateBuild123dExecutionAdmission(
  value: unknown,
  path = "$build123dExecutionAdmission",
): Build123dExecutionAdmission {
  const root = exactRecord(
    value,
    ["schemaVersion", "admissionArtifact", "compilation", "execution", "status"],
    path,
  );
  literalValue(
    root.schemaVersion,
    BUILD123D_EXECUTION_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.status,
    "ready-for-execution-review",
    `${path}.status`,
  );

  const artifact = exactRecord(
    root.admissionArtifact,
    ["schemaVersion", "id", "fingerprint"],
    `${path}.admissionArtifact`,
  );
  literalValue(
    artifact.schemaVersion,
    BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
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
    BUILD123D_EXECUTION_COMPILATION_SCHEMA,
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
    "build123d-source",
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

  const execution = exactRecord(
    root.execution,
    [
      "profile",
      "isolationPolicy",
      "runtimeBackend",
      "runtime",
      "outputValidator",
      "output",
      "minimumDestructionAssurance",
    ],
    `${path}.execution`,
  );
  const executionProfile = exactRecord(
    execution.profile,
    ["id", "version", "fingerprint"],
    `${path}.execution.profile`,
  );
  literalValue(
    executionProfile.id,
    BUILD123D_EXECUTION_PROFILE.id,
    `${path}.execution.profile.id`,
  );
  const executionProfileVersion = safeVersion(
    executionProfile.version,
    `${path}.execution.profile.version`,
  );
  literalValue(
    executionProfileVersion,
    BUILD123D_EXECUTION_PROFILE.version,
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
  const output = exactRecord(
    execution.output,
    ["role", "basename", "mediaType", "format"],
    `${path}.execution.output`,
  );
  for (
    const key of Object.keys(BUILD123D_EXECUTION_OUTPUT) as Array<
      keyof typeof BUILD123D_EXECUTION_OUTPUT
    >
  ) {
    literalValue(
      output[key],
      BUILD123D_EXECUTION_OUTPUT[key],
      `${path}.execution.output.${key}`,
    );
  }

  return deepFreeze({
    schemaVersion: BUILD123D_EXECUTION_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
      id: artifactId,
      fingerprint: artifactFingerprint,
    },
    compilation: {
      document: {
        schemaVersion: BUILD123D_EXECUTION_COMPILATION_SCHEMA,
        fingerprint: parseFingerprint(
          document.fingerprint,
          `${path}.compilation.document.fingerprint`,
        ),
        status: "ready-for-review",
      },
      projection: {
        target: "build123d-source",
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
        id: safeId(compilationProfile.id, `${path}.compilation.profile.id`),
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
        id: BUILD123D_EXECUTION_PROFILE.id,
        version: BUILD123D_EXECUTION_PROFILE.version,
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
        id: safeId(
          outputValidator.id,
          `${path}.execution.outputValidator.id`,
        ),
        version: safeVersion(
          outputValidator.version,
          `${path}.execution.outputValidator.version`,
        ),
      },
      output: BUILD123D_EXECUTION_OUTPUT,
      minimumDestructionAssurance: minimumDestructionAssurance(
        execution.minimumDestructionAssurance,
        `${path}.execution.minimumDestructionAssurance`,
      ),
    },
    status: "ready-for-execution-review",
  });
}

function parameterSpecs(
  admission: Build123dExecutionAdmission,
): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const add = (key: string, label: string, value: ParameterValue) => {
    specs.push({ key, label, value });
  };
  add(
    `${PARAMETER_PREFIX}.schemaVersion`,
    "Build123d execution admission schema",
    admission.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.operation`,
    "Reviewed operation",
    `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`,
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
    "Qualified source ID",
    admission.compilation.source.id,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.sourceSha256`,
    "Qualified source SHA-256",
    admission.compilation.source.sourceFingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.captureSha256`,
    "Qualified source capture SHA-256",
    admission.compilation.source.captureFingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.compilation.source.analysisSha256`,
    "Qualified source analysis SHA-256",
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
    `${PARAMETER_PREFIX}.output.role`,
    "Declared output role",
    admission.execution.output.role,
  );
  add(
    `${PARAMETER_PREFIX}.output.basename`,
    "Declared output basename",
    admission.execution.output.basename,
  );
  add(
    `${PARAMETER_PREFIX}.output.mediaType`,
    "Declared output media type",
    admission.execution.output.mediaType,
  );
  add(
    `${PARAMETER_PREFIX}.output.format`,
    "Declared output format",
    admission.execution.output.format,
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
    throw new TypeError("Build123d execution MRTR grammar is internally inconsistent.");
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

function parseLimits(value: unknown, path: string): Build123dExecutionLimits {
  const record = exactRecord(value, LIMIT_KEYS, path);
  const limits = Object.fromEntries(LIMIT_KEYS.map((key) => [
    key,
    positiveInteger(record[key], `${path}.${key}`),
  ])) as unknown as Build123dExecutionLimits;
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
): Build123dLimitAssuranceMatrix {
  const record = exactRecord(value, LIMIT_KEYS, path);
  return deepFreeze(Object.fromEntries(LIMIT_KEYS.map((key) => [
    key,
    limitAssurance(record[key], `${path}.${key}`),
  ])) as unknown as Build123dLimitAssuranceMatrix);
}

function limitAssurance(
  value: unknown,
  path: string,
): Build123dLimitAssurance {
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
): Build123dMinimumDestructionAssurance {
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
): Build123dLimitAssurance {
  return limitAssurance(requireValue(values, key), `$parameters.${key}`);
}

function literalRuntimeIsolationClass(value: unknown, path: string) {
  literalValue(value, MICROSANDBOX_LOCAL_ISOLATION_CLASS, path);
  return MICROSANDBOX_LOCAL_ISOLATION_CLASS;
}

function requireMinimumDestructionAssurance(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): Build123dMinimumDestructionAssurance {
  return minimumDestructionAssurance(
    requireValue(values, key),
    `$parameters.${key}`,
  );
}
