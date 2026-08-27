/**
 * Provider-neutral contracts for one isolated execution of agent-authored code.
 *
 * The public request and receipt deliberately contain no filesystem path,
 * sandbox lease, container id, provider operation, or execution handle. Those
 * capabilities stay behind an application port. Bytes cross the boundary only
 * by value and every durable output is content-addressed.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  canonicalResourceUri,
  compareAsciiCodeUnits,
  fingerprintResourceBytes,
  type ImmutableBytes,
  immutableBytes,
  sha256Hex,
} from "../source/provider-resource-reader.ts";

export const ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA =
  "isolated-code-execution-request/1.0" as const;
export const ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA =
  "isolated-code-execution-receipt/1.0" as const;
export const ISOLATED_CODE_EXECUTION_RECEIPT_RECORD_SCHEMA =
  "isolated-code-execution-receipt-record/1.0" as const;
export const ISOLATED_OUTPUT_PUBLICATION_SCHEMA =
  "isolated-output-publication/1.0" as const;
export const ISOLATED_OUTPUT_PRODUCER_GENERATION_ADVANCE_SCHEMA =
  "isolated-output-producer-generation-advance/1.0" as const;
export const ISOLATED_CODE_EXECUTION_REJECTION_DIAGNOSTIC_SCHEMA =
  "isolated-code-execution-rejection-diagnostic/1.0" as const;
export const MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS = 2_048;

export type IsolatedOutputProducerGeneration = 0 | 1;

export interface IsolatedOutputProducerGenerationAdvanceInput {
  readonly runId: string;
  readonly closedGeneration: 0;
  readonly nextGeneration: 1;
}

export interface IsolatedOutputProducerGenerationAdvance
  extends IsolatedOutputProducerGenerationAdvanceInput {
  readonly schemaVersion: typeof ISOLATED_OUTPUT_PRODUCER_GENERATION_ADVANCE_SCHEMA;
  readonly fingerprint: ContentFingerprint;
}

export async function createIsolatedOutputProducerGenerationAdvance(
  value: IsolatedOutputProducerGenerationAdvanceInput,
): Promise<IsolatedOutputProducerGenerationAdvance> {
  const input = exactRecord(
    value,
    ["runId", "closedGeneration", "nextGeneration"],
    "$producerGenerationAdvance",
  );
  literalValue(
    input.closedGeneration,
    0,
    "$producerGenerationAdvance.closedGeneration",
  );
  literalValue(
    input.nextGeneration,
    1,
    "$producerGenerationAdvance.nextGeneration",
  );
  const facts = deepFreeze({
    schemaVersion: ISOLATED_OUTPUT_PRODUCER_GENERATION_ADVANCE_SCHEMA,
    runId: safeId(input.runId, "$producerGenerationAdvance.runId"),
    closedGeneration: 0 as const,
    nextGeneration: 1 as const,
  });
  return deepFreeze({
    ...facts,
    fingerprint: await sha256Fingerprint(facts),
  });
}

export async function validateIsolatedOutputProducerGenerationAdvance(
  value: unknown,
  expectedRunId?: string,
): Promise<IsolatedOutputProducerGenerationAdvance> {
  const record = exactRecord(value, [
    "schemaVersion",
    "runId",
    "closedGeneration",
    "nextGeneration",
    "fingerprint",
  ], "$producerGenerationAdvance");
  literalValue(
    record.schemaVersion,
    ISOLATED_OUTPUT_PRODUCER_GENERATION_ADVANCE_SCHEMA,
    "$producerGenerationAdvance.schemaVersion",
  );
  literalValue(
    record.closedGeneration,
    0,
    "$producerGenerationAdvance.closedGeneration",
  );
  literalValue(
    record.nextGeneration,
    1,
    "$producerGenerationAdvance.nextGeneration",
  );
  const canonical = await createIsolatedOutputProducerGenerationAdvance({
    runId: safeId(record.runId, "$producerGenerationAdvance.runId"),
    closedGeneration: 0,
    nextGeneration: 1,
  });
  if (expectedRunId !== undefined && canonical.runId !== expectedRunId) {
    throw new TypeError("$producerGenerationAdvance.runId is divergent.");
  }
  if (
    !fingerprintsEqual(
      canonical.fingerprint,
      validateContentFingerprint(
        record.fingerprint,
        "$producerGenerationAdvance.fingerprint",
      ),
    )
  ) {
    throw new TypeError("$producerGenerationAdvance.fingerprint is divergent.");
  }
  return canonical;
}

const CANONICAL_MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:; [a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"\r\n]*"))*$/;
const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const INTRINSIC_TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)!.get!;
const INTRINSIC_TYPED_ARRAY_TAG = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)!.get!;

export interface IsolatedCodeProfileRef {
  readonly id: string;
  readonly version: string;
}

export interface IsolatedCodePolicyRef {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

export interface IsolatedCodeOutputDeclaration {
  readonly role: string;
  /** A basename only; it is never interpreted as a host or backend path. */
  readonly basename: string;
  readonly mediaType: string;
  readonly format: string;
}

export interface IsolatedCodeExecutionRequest {
  readonly schemaVersion: typeof ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA;
  /** Server-issued identity. It is never derived from source text. */
  readonly runId: string;
  /** Server-owned dispatch generation; never supplied or advanced by code. */
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly profile: IsolatedCodeProfileRef;
  readonly source: {
    readonly bytes: Uint8Array;
    readonly sha256: string;
  };
  readonly policy: IsolatedCodePolicyRef;
  readonly outputs: readonly IsolatedCodeOutputDeclaration[];
}

/** An integrity-checked request with a defensive copy of the source bytes. */
export interface ValidatedIsolatedCodeExecutionRequest {
  readonly schemaVersion: typeof ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA;
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly profile: IsolatedCodeProfileRef;
  readonly source: {
    readonly bytes: ImmutableBytes;
    readonly sha256: string;
  };
  readonly policy: IsolatedCodePolicyRef;
  /** Sorted by role, with unique roles and case-folded basenames. */
  readonly outputs: readonly IsolatedCodeOutputDeclaration[];
}

/** Resource limits selected by the server-owned isolation policy. */
export interface IsolatedCodeExecutionLimits {
  readonly maxWallTimeMs: number;
  readonly maxCpuTimeMs: number;
  readonly maxMemoryBytes: number;
  readonly maxProcesses: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxOutputFileBytes: number;
  readonly maxOutputTotalBytes: number;
}

export type IsolatedCodeLimitAssurance =
  | "backend-attested"
  | "broker-observed-cap"
  | "unattested";

export interface IsolatedCodeLimitAssuranceMatrix {
  readonly maxWallTimeMs: IsolatedCodeLimitAssurance;
  readonly maxCpuTimeMs: IsolatedCodeLimitAssurance;
  readonly maxMemoryBytes: IsolatedCodeLimitAssurance;
  readonly maxProcesses: IsolatedCodeLimitAssurance;
  readonly maxStdoutBytes: IsolatedCodeLimitAssurance;
  readonly maxStderrBytes: IsolatedCodeLimitAssurance;
  readonly maxOutputFileBytes: IsolatedCodeLimitAssurance;
  readonly maxOutputTotalBytes: IsolatedCodeLimitAssurance;
}

export interface IsolatedCodeRuntimeAttestation {
  readonly isolationClass: string;
  readonly imageDigest: ContentFingerprint;
  /** Server-requested ceilings, not silently promoted to observed facts. */
  readonly requestedLimits: IsolatedCodeExecutionLimits;
  /** How each ceiling was established for this backend/profile binding. */
  readonly limitAssurance: IsolatedCodeLimitAssuranceMatrix;
}

export type IsolatedCodeTermination =
  | {
    readonly kind: "exited";
    readonly exitCode: number;
    readonly signal: null;
  }
  | {
    readonly kind: "signaled";
    readonly exitCode: null;
    readonly signal: string;
  }
  | {
    readonly kind: "timed-out" | "resource-limit";
    readonly exitCode: null;
    readonly signal: null;
  };

export interface IsolatedCodeLogReceipt {
  readonly byteCount: number;
  readonly sha256: string;
  readonly truncated: boolean;
}

/**
 * Bounded observation of one captured log stream after a rejected execution.
 * `byteCount`, `sha256` and `truncated` describe the original captured bytes.
 * `excerpt` is an independently capped, control-stripped readable projection.
 */
export interface IsolatedCodeExecutionLogObservation {
  readonly byteCount: number;
  readonly sha256: string;
  readonly truncated: boolean;
  readonly excerpt: string;
}

/**
 * Immutable diagnostic for a known unsuccessful isolated termination.
 * It carries no lease, path, handle, capability, inventory or output bytes.
 */
export interface IsolatedCodeExecutionRejectionDiagnostic {
  readonly schemaVersion: typeof ISOLATED_CODE_EXECUTION_REJECTION_DIAGNOSTIC_SCHEMA;
  readonly termination: IsolatedCodeTermination;
  readonly logs: {
    readonly stdout: IsolatedCodeExecutionLogObservation;
    readonly stderr: IsolatedCodeExecutionLogObservation;
  };
}

/**
 * Safe public observation when a code-owned isolated output validator rejects
 * bytes after a successful backend execution. It retains only the registered
 * role and the observed size/digest. Raw bytes, paths, handles, validator
 * messages and stacks never enter this record.
 */
export interface IsolatedCodeOutputValidationRejection {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface IsolatedCodeOutputReceipt extends IsolatedCodeOutputDeclaration {
  readonly byteCount: number;
  readonly sha256: string;
  readonly casUri: string;
  /** Defensive bytes observed outside the execution backend. */
  readonly bytes: ImmutableBytes;
  readonly validation: "accepted";
  readonly persistence: "staged-reread-atomic-commit";
}

export interface IsolatedOutputPublicationRef {
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  /** Hash of the exact run/output publication manifest. */
  readonly fingerprint: ContentFingerprint;
  /** Run-keyed logical marker; it is not an object URI supplied by code. */
  readonly manifestUri: string;
}

export type IsolatedCodeOutputReceiptRecord = Omit<
  IsolatedCodeOutputReceipt,
  "bytes"
>;

/**
 * A closed receipt exists only after every output has been re-read from CAS and
 * cleanup has met the server-owned assurance threshold. The receipt preserves
 * whether cleanup was proven or merely acknowledged; it never promotes one to
 * the other.
 */
export interface IsolatedCodeExecutionReceipt {
  readonly schemaVersion: typeof ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA;
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly profile: IsolatedCodeProfileRef;
  readonly sourceSha256: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly termination: IsolatedCodeTermination;
  readonly logs: {
    readonly stdout: IsolatedCodeLogReceipt;
    readonly stderr: IsolatedCodeLogReceipt;
  };
  readonly outputs: readonly IsolatedCodeOutputReceipt[];
  readonly destruction:
    | {
      readonly status: "proven";
      readonly runId: string;
      readonly proofFingerprint: ContentFingerprint;
    }
    | {
      readonly status: "acknowledged-unattested";
      readonly runId: string;
      readonly acknowledgementFingerprint: ContentFingerprint;
    };
  readonly publication: {
    readonly status: "atomic-batch-published";
    readonly ref: IsolatedOutputPublicationRef;
  };
  /** Fingerprint of all receipt metadata and output hashes, excluding bytes. */
  readonly fingerprint: ContentFingerprint;
}

/** Canonical durable receipt metadata. Output bytes remain in the gated CAS. */
export interface IsolatedCodeExecutionReceiptRecord {
  readonly schemaVersion: typeof ISOLATED_CODE_EXECUTION_RECEIPT_RECORD_SCHEMA;
  readonly receiptSchemaVersion: typeof ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA;
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly profile: IsolatedCodeProfileRef;
  readonly sourceSha256: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly termination: IsolatedCodeTermination;
  readonly logs: {
    readonly stdout: IsolatedCodeLogReceipt;
    readonly stderr: IsolatedCodeLogReceipt;
  };
  readonly outputs: readonly IsolatedCodeOutputReceiptRecord[];
  readonly destruction: IsolatedCodeExecutionReceipt["destruction"];
  readonly publication: IsolatedCodeExecutionReceipt["publication"];
  readonly fingerprint: ContentFingerprint;
}

export interface IsolatedCodeExecutionReceiptInput {
  readonly request: ValidatedIsolatedCodeExecutionRequest;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly termination: IsolatedCodeTermination;
  readonly logs: {
    readonly stdout: {
      readonly bytes: Uint8Array;
      readonly truncated: boolean;
    };
    readonly stderr: {
      readonly bytes: Uint8Array;
      readonly truncated: boolean;
    };
  };
  readonly outputs: readonly (IsolatedCodeOutputDeclaration & {
    readonly bytes: Uint8Array;
    readonly byteCount: number;
    readonly sha256: string;
    readonly casUri: string;
  })[];
  readonly destruction:
    | {
      readonly status: "proven";
      readonly runId: string;
      readonly proofFingerprint: ContentFingerprint;
    }
    | {
      readonly status: "acknowledged-unattested";
      readonly runId: string;
      readonly acknowledgementFingerprint: ContentFingerprint;
    };
  readonly publication: IsolatedOutputPublicationRef;
}

export async function validateIsolatedCodeExecutionRequest(
  value: unknown,
  maximumSourceBytes?: number,
): Promise<ValidatedIsolatedCodeExecutionRequest> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "runId",
      "producerGeneration",
      "profile",
      "source",
      "policy",
      "outputs",
    ],
    "$request",
  );
  literalValue(
    root.schemaVersion,
    ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    "$request.schemaVersion",
  );
  const sourceValue = root.source;
  const source = exactRecord(sourceValue, ["bytes", "sha256"], "$request.source");
  const sourceBytesValue = source.bytes;
  const sourceBytes = copyObservedUint8Array(
    sourceBytesValue,
    "$request.source.bytes",
    maximumSourceBytes === undefined
      ? undefined
      : positiveInteger(maximumSourceBytes, "$maximumSourceBytes"),
  );
  const sourceSha256 = sha256Hex(source.sha256, "$request.source.sha256");
  const observedSourceSha256 = await fingerprintResourceBytes(sourceBytes);
  if (observedSourceSha256 !== sourceSha256) {
    throw new TypeError(
      `$request.source.bytes have sha256 ${observedSourceSha256}; expected ${sourceSha256}.`,
    );
  }

  const outputs = validateIsolatedCodeOutputManifest(
    root.outputs,
    "$request.outputs",
  );

  return Object.freeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: safeId(root.runId, "$request.runId"),
    producerGeneration: validateIsolatedOutputProducerGeneration(
      root.producerGeneration,
      "$request.producerGeneration",
    ),
    profile: validateIsolatedCodeProfileRef(root.profile, "$request.profile"),
    source: Object.freeze({
      bytes: immutableBytes(sourceBytes),
      sha256: sourceSha256,
    }),
    policy: validateIsolatedCodePolicyRef(root.policy, "$request.policy"),
    outputs,
  });
}

export function validateIsolatedOutputProducerGeneration(
  value: unknown,
  path = "$producerGeneration",
): IsolatedOutputProducerGeneration {
  if (value !== 0 && value !== 1) {
    throw new TypeError(`${path} must be the server-owned generation 0 or 1.`);
  }
  return value;
}

export function validateIsolatedCodeProfileRef(
  value: unknown,
  path = "$profile",
): IsolatedCodeProfileRef {
  const ref = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(ref.id, `${path}.id`),
    version: safeId(ref.version, `${path}.version`),
  });
}

export function validateIsolatedCodePolicyRef(
  value: unknown,
  path = "$policy",
): IsolatedCodePolicyRef {
  const ref = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(ref.id, `${path}.id`),
    version: safeId(ref.version, `${path}.version`),
    fingerprint: validateContentFingerprint(
      ref.fingerprint,
      `${path}.fingerprint`,
    ),
  });
}

export function validateIsolatedCodeOutputDeclaration(
  value: unknown,
  path = "$output",
): IsolatedCodeOutputDeclaration {
  const output = exactRecord(
    value,
    ["role", "basename", "mediaType", "format"],
    path,
  );
  const basename = validateIsolatedCodeOutputBasename(
    output.basename,
    `${path}.basename`,
  );
  const mediaType = nonEmptyText(output.mediaType, `${path}.mediaType`);
  if (!CANONICAL_MEDIA_TYPE.test(mediaType)) {
    throw new TypeError(`${path}.mediaType must be a canonical media type.`);
  }
  return deepFreeze({
    role: safeId(output.role, `${path}.role`),
    basename,
    mediaType,
    format: safeId(output.format, `${path}.format`),
  });
}

export function validateIsolatedCodeOutputManifest(
  value: unknown,
  path = "$outputs",
): readonly IsolatedCodeOutputDeclaration[] {
  const outputs = nonEmptyArray(value, path)
    .map((item, index) =>
      validateIsolatedCodeOutputDeclaration(item, `${path}[${index}]`)
    )
    .sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(outputs.map((output) => output.role), `${path} roles`);
  rejectCaseFoldedBasenameCollisions(outputs, `${path} basenames`);
  return deepFreeze(outputs);
}

export function isolatedCodeOutputManifestsEqual(
  left: readonly IsolatedCodeOutputDeclaration[],
  right: readonly IsolatedCodeOutputDeclaration[],
): boolean {
  return left.length === right.length &&
    left.every((output, index) => declarationsEqual(output, right[index]!));
}

export function validateIsolatedCodeOutputBasename(
  value: unknown,
  path = "$basename",
): string {
  const basename = nonEmptyText(value, path);
  if (
    !SAFE_BASENAME.test(basename) || basename === "." || basename === ".." ||
    basename.includes("/") || basename.includes("\\") || basename.includes("\0")
  ) {
    throw new TypeError(`${path} must be a safe basename.`);
  }
  return basename;
}

export function validateIsolatedCodeExecutionLimits(
  value: unknown,
  path = "$limits",
): IsolatedCodeExecutionLimits {
  const limits = exactRecord(value, [
    "maxWallTimeMs",
    "maxCpuTimeMs",
    "maxMemoryBytes",
    "maxProcesses",
    "maxStdoutBytes",
    "maxStderrBytes",
    "maxOutputFileBytes",
    "maxOutputTotalBytes",
  ], path);
  const parsed = deepFreeze({
    maxWallTimeMs: positiveInteger(limits.maxWallTimeMs, `${path}.maxWallTimeMs`),
    maxCpuTimeMs: positiveInteger(limits.maxCpuTimeMs, `${path}.maxCpuTimeMs`),
    maxMemoryBytes: positiveInteger(limits.maxMemoryBytes, `${path}.maxMemoryBytes`),
    maxProcesses: positiveInteger(limits.maxProcesses, `${path}.maxProcesses`),
    maxStdoutBytes: positiveInteger(limits.maxStdoutBytes, `${path}.maxStdoutBytes`),
    maxStderrBytes: positiveInteger(limits.maxStderrBytes, `${path}.maxStderrBytes`),
    maxOutputFileBytes: positiveInteger(
      limits.maxOutputFileBytes,
      `${path}.maxOutputFileBytes`,
    ),
    maxOutputTotalBytes: positiveInteger(
      limits.maxOutputTotalBytes,
      `${path}.maxOutputTotalBytes`,
    ),
  });
  if (parsed.maxOutputFileBytes > parsed.maxOutputTotalBytes) {
    throw new TypeError(
      `${path}.maxOutputFileBytes must not exceed maxOutputTotalBytes.`,
    );
  }
  return parsed;
}

export function validateIsolatedCodeRuntimeAttestation(
  value: unknown,
  path = "$runtime",
): IsolatedCodeRuntimeAttestation {
  const runtime = exactRecord(
    value,
    ["isolationClass", "imageDigest", "requestedLimits", "limitAssurance"],
    path,
  );
  return deepFreeze({
    isolationClass: safeId(runtime.isolationClass, `${path}.isolationClass`),
    imageDigest: validateContentFingerprint(
      runtime.imageDigest,
      `${path}.imageDigest`,
    ),
    requestedLimits: validateIsolatedCodeExecutionLimits(
      runtime.requestedLimits,
      `${path}.requestedLimits`,
    ),
    limitAssurance: validateIsolatedCodeLimitAssuranceMatrix(
      runtime.limitAssurance,
      `${path}.limitAssurance`,
    ),
  });
}

export function validateIsolatedCodeLimitAssuranceMatrix(
  value: unknown,
  path = "$limitAssurance",
): IsolatedCodeLimitAssuranceMatrix {
  const keys = [
    "maxWallTimeMs",
    "maxCpuTimeMs",
    "maxMemoryBytes",
    "maxProcesses",
    "maxStdoutBytes",
    "maxStderrBytes",
    "maxOutputFileBytes",
    "maxOutputTotalBytes",
  ] as const;
  const assurance = exactRecord(value, keys, path);
  return deepFreeze(Object.fromEntries(
    keys.map((key) => [
      key,
      limitAssurance(assurance[key], `${path}.${key}`),
    ]),
  ) as unknown as IsolatedCodeLimitAssuranceMatrix);
}

export function validateIsolatedCodeTermination(
  value: unknown,
  path = "$termination",
): IsolatedCodeTermination {
  const termination = exactRecord(value, ["kind", "exitCode", "signal"], path);
  const kind = nonEmptyText(termination.kind, `${path}.kind`);
  if (kind === "exited") {
    if (
      !Number.isSafeInteger(termination.exitCode) || Number(termination.exitCode) < 0
    ) {
      throw new TypeError(`${path}.exitCode must be a non-negative safe integer.`);
    }
    literalValue(termination.signal, null, `${path}.signal`);
    return deepFreeze({
      kind,
      exitCode: Number(termination.exitCode),
      signal: null,
    });
  }
  if (kind === "signaled") {
    literalValue(termination.exitCode, null, `${path}.exitCode`);
    return deepFreeze({
      kind,
      exitCode: null,
      signal: safeId(termination.signal, `${path}.signal`),
    });
  }
  if (kind === "timed-out" || kind === "resource-limit") {
    literalValue(termination.exitCode, null, `${path}.exitCode`);
    literalValue(termination.signal, null, `${path}.signal`);
    return deepFreeze({ kind, exitCode: null, signal: null });
  }
  throw new TypeError(`${path}.kind is unsupported.`);
}

export function isolatedCodeTerminationIsRejected(
  termination: IsolatedCodeTermination,
): boolean {
  return termination.kind !== "exited" || termination.exitCode !== 0;
}

export async function createIsolatedCodeExecutionRejectionDiagnostic(input: {
  readonly termination: IsolatedCodeTermination;
  readonly logs: {
    readonly stdout: { readonly bytes: Uint8Array; readonly truncated: boolean };
    readonly stderr: { readonly bytes: Uint8Array; readonly truncated: boolean };
  };
  readonly maximumLogBytes: {
    readonly stdout: number;
    readonly stderr: number;
  };
}): Promise<IsolatedCodeExecutionRejectionDiagnostic> {
  const termination = validateIsolatedCodeTermination(
    input.termination,
    "$rejection.termination",
  );
  if (!isolatedCodeTerminationIsRejected(termination)) {
    throw new TypeError(
      "$rejection.termination must describe an unsuccessful isolated execution.",
    );
  }
  return deepFreeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_REJECTION_DIAGNOSTIC_SCHEMA,
    termination,
    logs: {
      stdout: await createLogObservation(
        input.logs.stdout,
        "$rejection.logs.stdout",
        positiveInteger(
          input.maximumLogBytes.stdout,
          "$rejection.maximumLogBytes.stdout",
        ),
      ),
      stderr: await createLogObservation(
        input.logs.stderr,
        "$rejection.logs.stderr",
        positiveInteger(
          input.maximumLogBytes.stderr,
          "$rejection.maximumLogBytes.stderr",
        ),
      ),
    },
  });
}

export function createIsolatedCodeOutputValidationRejection(input: {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}): IsolatedCodeOutputValidationRejection {
  return validateIsolatedCodeOutputValidationRejection(
    input,
    "$outputValidationRejection",
  );
}

export function validateIsolatedCodeOutputValidationRejection(
  value: unknown,
  path = "$outputValidationRejection",
): IsolatedCodeOutputValidationRejection {
  const record = exactRecord(value, ["role", "byteCount", "sha256"], path);
  const byteCount = nonNegativeSafeInteger(record.byteCount, `${path}.byteCount`);
  const sha256 = sha256Hex(record.sha256, `${path}.sha256`);
  if (byteCount === 0 && sha256 !== EMPTY_SHA256) {
    throw new TypeError(`${path}.sha256 does not match empty bytes.`);
  }
  return deepFreeze({
    role: safeId(record.role, `${path}.role`),
    byteCount,
    sha256,
  });
}

export function validateIsolatedCodeExecutionRejectionDiagnostic(
  value: unknown,
  path = "$rejection",
): IsolatedCodeExecutionRejectionDiagnostic {
  const record = exactRecord(value, ["schemaVersion", "termination", "logs"], path);
  literalValue(
    record.schemaVersion,
    ISOLATED_CODE_EXECUTION_REJECTION_DIAGNOSTIC_SCHEMA,
    `${path}.schemaVersion`,
  );
  const termination = validateIsolatedCodeTermination(
    record.termination,
    `${path}.termination`,
  );
  if (!isolatedCodeTerminationIsRejected(termination)) {
    throw new TypeError(
      `${path}.termination must describe an unsuccessful isolated execution.`,
    );
  }
  const logs = exactRecord(record.logs, ["stdout", "stderr"], `${path}.logs`);
  return deepFreeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_REJECTION_DIAGNOSTIC_SCHEMA,
    termination,
    logs: {
      stdout: validateLogObservation(logs.stdout, `${path}.logs.stdout`),
      stderr: validateLogObservation(logs.stderr, `${path}.logs.stderr`),
    },
  });
}

export function validateIsolatedCodeExecutionDestruction(
  value: unknown,
  expectedRunId: string,
): IsolatedCodeExecutionReceipt["destruction"] {
  return validateReceiptDestruction(value, expectedRunId);
}

export function validateContentFingerprint(
  value: unknown,
  path = "$fingerprint",
): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  return deepFreeze({
    algorithm: "sha256",
    digest: sha256Hex(fingerprint.digest, `${path}.digest`),
  });
}

export async function createIsolatedCodeExecutionReceipt(
  input: IsolatedCodeExecutionReceiptInput,
): Promise<IsolatedCodeExecutionReceipt> {
  const runtime = validateIsolatedCodeRuntimeAttestation(input.runtime);
  const termination = validateIsolatedCodeTermination(input.termination);
  const destruction = validateReceiptDestruction(
    input.destruction,
    input.request.runId,
  );
  const publication = await validateIsolatedOutputPublicationRef(
    input.publication,
    input.request.runId,
    "$publication",
    input.request.producerGeneration,
  );
  const stdout = await createLogReceipt(
    input.logs.stdout,
    "$logs.stdout",
    runtime.requestedLimits.maxStdoutBytes,
  );
  const stderr = await createLogReceipt(
    input.logs.stderr,
    "$logs.stderr",
    runtime.requestedLimits.maxStderrBytes,
  );

  const expectedByRole = new Map(
    input.request.outputs.map((output) => [output.role, output] as const),
  );
  const suppliedRoles = input.outputs.map((output) => output.role);
  rejectDuplicates(suppliedRoles, "$outputs roles");
  if (
    suppliedRoles.length !== expectedByRole.size ||
    suppliedRoles.some((role) => !expectedByRole.has(role))
  ) {
    throw new TypeError("$outputs must match the declared output roles exactly.");
  }

  let totalOutputBytes = 0;
  const outputs: IsolatedCodeOutputReceipt[] = [];
  for (const supplied of input.outputs) {
    const expected = expectedByRole.get(supplied.role)!;
    const declaration = validateIsolatedCodeOutputDeclaration(
      {
        role: supplied.role,
        basename: supplied.basename,
        mediaType: supplied.mediaType,
        format: supplied.format,
      },
      `$outputs.${supplied.role}`,
    );
    if (!declarationsEqual(expected, declaration)) {
      throw new TypeError(
        `$outputs.${supplied.role} does not match its declared manifest entry.`,
      );
    }
    const byteCount = nonNegativeSafeInteger(
      supplied.byteCount,
      `$outputs.${supplied.role}.byteCount`,
    );
    const bytes = copyObservedUint8Array(
      supplied.bytes,
      `$outputs.${supplied.role}.bytes`,
      runtime.requestedLimits.maxOutputFileBytes,
    );
    if (byteCount !== bytes.byteLength) {
      throw new TypeError(`$outputs.${supplied.role}.byteCount does not match bytes.`);
    }
    if (byteCount > runtime.requestedLimits.maxOutputFileBytes) {
      throw new TypeError(`$outputs.${supplied.role} exceeds the per-file byte cap.`);
    }
    totalOutputBytes += byteCount;
    if (totalOutputBytes > runtime.requestedLimits.maxOutputTotalBytes) {
      throw new TypeError("$outputs exceed the total output byte cap.");
    }
    const sha256 = sha256Hex(supplied.sha256, `$outputs.${supplied.role}.sha256`);
    if (await fingerprintResourceBytes(bytes) !== sha256) {
      throw new TypeError(`$outputs.${supplied.role}.sha256 does not match bytes.`);
    }
    const casUri = validateIsolatedOutputCasUri(
      supplied.casUri,
      sha256,
      `$outputs.${supplied.role}.casUri`,
    );
    outputs.push(Object.freeze({
      ...declaration,
      byteCount,
      sha256,
      casUri,
      bytes: immutableBytes(bytes),
      validation: "accepted" as const,
      persistence: "staged-reread-atomic-commit" as const,
    }));
  }
  outputs.sort((left, right) => compareAsciiCodeUnits(left.role, right.role));

  const metadata = {
    schemaVersion: ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA,
    runId: input.request.runId,
    producerGeneration: input.request.producerGeneration,
    profile: input.request.profile,
    sourceSha256: input.request.source.sha256,
    policy: input.request.policy,
    runtime,
    termination,
    logs: { stdout, stderr },
    outputs: outputs.map(({ bytes: _bytes, ...output }) => output),
    destruction,
    publication: {
      status: "atomic-batch-published" as const,
      ref: publication,
    },
  };
  const fingerprint = await sha256Fingerprint(metadata);
  return deepFreeze({
    ...metadata,
    outputs,
    fingerprint,
  });
}

/**
 * Build the one logical publication reference for a run. The marker identity
 * is keyed only by the server-issued run id, so two divergent publications for
 * one run cannot both become visible.
 */
export async function createIsolatedOutputPublicationRef(
  runIdValue: unknown,
  producerGenerationValue: unknown,
  fingerprintValue: unknown,
): Promise<IsolatedOutputPublicationRef> {
  const runId = safeId(runIdValue, "$publication.runId");
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    producerGenerationValue,
    "$publication.producerGeneration",
  );
  const fingerprint = validateContentFingerprint(
    fingerprintValue,
    "$publication.fingerprint",
  );
  return deepFreeze({
    runId,
    producerGeneration,
    fingerprint,
    manifestUri: await isolatedOutputPublicationManifestUri(
      runId,
      producerGeneration,
    ),
  });
}

/**
 * Fingerprint the canonical, byte-free publication manifest.
 *
 * This is the single preimage definition shared by the broker, durable CAS,
 * and downstream evidence validation. It commits only the observed object
 * tuples available before receipt sealing. The publication marker separately
 * commits the complete receipt record, including validation and persistence.
 */
export async function fingerprintIsolatedOutputPublicationManifest(
  runIdValue: unknown,
  producerGenerationValue: unknown,
  outputsValue: unknown,
): Promise<ContentFingerprint> {
  const runId = safeId(runIdValue, "$publication.runId");
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    producerGenerationValue,
    "$publication.producerGeneration",
  );
  const outputs = nonEmptyArray(outputsValue, "$publication.outputs")
    .map((outputValue, index) => {
      const path = `$publication.outputs[${index}]`;
      const output = exactRecord(outputValue, [
        "role",
        "basename",
        "mediaType",
        "format",
        "byteCount",
        "sha256",
        "casUri",
      ], path);
      const declaration = validateIsolatedCodeOutputDeclaration({
        role: output.role,
        basename: output.basename,
        mediaType: output.mediaType,
        format: output.format,
      }, path);
      const byteCount = nonNegativeSafeInteger(
        output.byteCount,
        `${path}.byteCount`,
      );
      const sha256 = sha256Hex(output.sha256, `${path}.sha256`);
      return deepFreeze({
        ...declaration,
        byteCount,
        sha256,
        casUri: validateIsolatedOutputCasUri(
          output.casUri,
          sha256,
          `${path}.casUri`,
        ),
      });
    })
    .sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(
    outputs.map((output) => output.role),
    "$publication.outputs roles",
  );
  rejectCaseFoldedBasenameCollisions(outputs, "$publication.outputs basenames");
  return await sha256Fingerprint({
    schemaVersion: ISOLATED_OUTPUT_PUBLICATION_SCHEMA,
    runId,
    producerGeneration,
    outputs,
  });
}

export async function isolatedOutputPublicationManifestUri(
  runIdValue: unknown,
  producerGenerationValue: unknown,
): Promise<string> {
  const runId = safeId(runIdValue, "$publication.runId");
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    producerGenerationValue,
    "$publication.producerGeneration",
  );
  const logicalKey = await sha256Fingerprint({
    schemaVersion: "isolated-output-publication-key/1.0",
    runId,
    producerGeneration,
  });
  return `casys://isolated-output-publication/sha256/${logicalKey.digest}`;
}

export async function validateIsolatedOutputPublicationRef(
  value: unknown,
  expectedRunId?: string,
  path = "$publication",
  expectedProducerGeneration?: IsolatedOutputProducerGeneration,
): Promise<IsolatedOutputPublicationRef> {
  const publication = exactRecord(
    value,
    ["runId", "producerGeneration", "fingerprint", "manifestUri"],
    path,
  );
  const canonical = await createIsolatedOutputPublicationRef(
    publication.runId,
    publication.producerGeneration,
    publication.fingerprint,
  );
  if (expectedRunId !== undefined && canonical.runId !== expectedRunId) {
    throw new TypeError(`${path}.runId does not match the execution run.`);
  }
  if (
    expectedProducerGeneration !== undefined &&
    canonical.producerGeneration !== expectedProducerGeneration
  ) {
    throw new TypeError(
      `${path}.producerGeneration does not match the execution dispatch.`,
    );
  }
  const manifestUri = canonicalResourceUri(
    publication.manifestUri,
    `${path}.manifestUri`,
  );
  if (manifestUri !== canonical.manifestUri) {
    throw new TypeError(`${path}.manifestUri is not the run-keyed publication URI.`);
  }
  return canonical;
}

export function isolatedCodeExecutionReceiptRecord(
  receipt: IsolatedCodeExecutionReceipt,
): IsolatedCodeExecutionReceiptRecord {
  return deepFreeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_RECEIPT_RECORD_SCHEMA,
    receiptSchemaVersion: receipt.schemaVersion,
    runId: receipt.runId,
    producerGeneration: receipt.producerGeneration,
    profile: receipt.profile,
    sourceSha256: receipt.sourceSha256,
    policy: receipt.policy,
    runtime: receipt.runtime,
    termination: receipt.termination,
    logs: receipt.logs,
    outputs: receipt.outputs.map(({ bytes: _bytes, ...output }) => output),
    destruction: receipt.destruction,
    publication: receipt.publication,
    fingerprint: receipt.fingerprint,
  });
}

export async function restoreIsolatedCodeExecutionReceipt(
  recordValue: unknown,
  outputValues: readonly { readonly role: string; readonly bytes: Uint8Array }[],
): Promise<IsolatedCodeExecutionReceipt> {
  const record = await validateIsolatedCodeExecutionReceiptRecord(recordValue);
  const supplied = new Map<string, Uint8Array>();
  for (const [index, value] of outputValues.entries()) {
    const item = exactRecord(value, ["role", "bytes"], `$outputBytes[${index}]`);
    const role = safeId(item.role, `$outputBytes[${index}].role`);
    if (supplied.has(role)) {
      throw new TypeError("$outputBytes roles must not contain duplicates.");
    }
    supplied.set(
      role,
      copyObservedUint8Array(
        item.bytes,
        `$outputBytes[${index}].bytes`,
        record.runtime.requestedLimits.maxOutputFileBytes,
      ),
    );
  }
  if (
    supplied.size !== record.outputs.length ||
    record.outputs.some((output) => !supplied.has(output.role))
  ) {
    throw new TypeError("$outputBytes must match the receipt roles exactly.");
  }
  const outputs: IsolatedCodeOutputReceipt[] = [];
  let totalBytes = 0;
  for (const output of record.outputs) {
    const bytes = supplied.get(output.role)!;
    if (
      bytes.byteLength !== output.byteCount ||
      await fingerprintResourceBytes(bytes) !== output.sha256
    ) {
      throw new TypeError(`$outputBytes.${output.role} does not match the receipt.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > record.runtime.requestedLimits.maxOutputTotalBytes) {
      throw new TypeError("$outputBytes exceed the receipt total output cap.");
    }
    outputs.push(deepFreeze({ ...output, bytes: immutableBytes(bytes) }));
  }
  return deepFreeze({
    schemaVersion: record.receiptSchemaVersion,
    runId: record.runId,
    producerGeneration: record.producerGeneration,
    profile: record.profile,
    sourceSha256: record.sourceSha256,
    policy: record.policy,
    runtime: record.runtime,
    termination: record.termination,
    logs: record.logs,
    outputs,
    destruction: record.destruction,
    publication: record.publication,
    fingerprint: record.fingerprint,
  });
}

export async function validateIsolatedCodeExecutionReceiptRecord(
  value: unknown,
): Promise<IsolatedCodeExecutionReceiptRecord> {
  const record = exactRecord(value, [
    "schemaVersion",
    "receiptSchemaVersion",
    "runId",
    "producerGeneration",
    "profile",
    "sourceSha256",
    "policy",
    "runtime",
    "termination",
    "logs",
    "outputs",
    "destruction",
    "publication",
    "fingerprint",
  ], "$receiptRecord");
  literalValue(
    record.schemaVersion,
    ISOLATED_CODE_EXECUTION_RECEIPT_RECORD_SCHEMA,
    "$receiptRecord.schemaVersion",
  );
  literalValue(
    record.receiptSchemaVersion,
    ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA,
    "$receiptRecord.receiptSchemaVersion",
  );
  const runId = safeId(record.runId, "$receiptRecord.runId");
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    record.producerGeneration,
    "$receiptRecord.producerGeneration",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    record.runtime,
    "$receiptRecord.runtime",
  );
  const logsValue = exactRecord(
    record.logs,
    ["stdout", "stderr"],
    "$receiptRecord.logs",
  );
  const logs = deepFreeze({
    stdout: validateStoredLogReceipt(
      logsValue.stdout,
      "$receiptRecord.logs.stdout",
      runtime.requestedLimits.maxStdoutBytes,
    ),
    stderr: validateStoredLogReceipt(
      logsValue.stderr,
      "$receiptRecord.logs.stderr",
      runtime.requestedLimits.maxStderrBytes,
    ),
  });
  const outputs = arrayOf(record.outputs, "$receiptRecord.outputs").map(
    (output, index) =>
      validateIsolatedCodeOutputReceiptRecord(
        output,
        `$receiptRecord.outputs[${index}]`,
        runtime.requestedLimits.maxOutputFileBytes,
      ),
  ).sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(
    outputs.map((output) => output.role),
    "$receiptRecord.outputs roles",
  );
  rejectCaseFoldedBasenameCollisions(outputs, "$receiptRecord.outputs basenames");
  if (outputs.length === 0) {
    throw new TypeError("$receiptRecord.outputs must not be empty.");
  }
  if (
    outputs.reduce((sum, output) => sum + output.byteCount, 0) >
      runtime.requestedLimits.maxOutputTotalBytes
  ) {
    throw new TypeError("$receiptRecord.outputs exceed the total output cap.");
  }
  const publicationValue = exactRecord(
    record.publication,
    ["status", "ref"],
    "$receiptRecord.publication",
  );
  literalValue(
    publicationValue.status,
    "atomic-batch-published",
    "$receiptRecord.publication.status",
  );
  const publication = deepFreeze({
    status: "atomic-batch-published" as const,
    ref: await validateIsolatedOutputPublicationRef(
      publicationValue.ref,
      runId,
      "$receiptRecord.publication.ref",
      producerGeneration,
    ),
  });
  const parsedWithoutFingerprint = {
    schemaVersion: ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA,
    runId,
    producerGeneration,
    profile: validateIsolatedCodeProfileRef(
      record.profile,
      "$receiptRecord.profile",
    ),
    sourceSha256: sha256Hex(
      record.sourceSha256,
      "$receiptRecord.sourceSha256",
    ),
    policy: validateIsolatedCodePolicyRef(
      record.policy,
      "$receiptRecord.policy",
    ),
    runtime,
    termination: validateIsolatedCodeTermination(
      record.termination,
      "$receiptRecord.termination",
    ),
    logs,
    outputs,
    destruction: validateReceiptDestruction(record.destruction, runId),
    publication,
  };
  const fingerprint = validateContentFingerprint(
    record.fingerprint,
    "$receiptRecord.fingerprint",
  );
  if (
    !fingerprintsEqual(await sha256Fingerprint(parsedWithoutFingerprint), fingerprint)
  ) {
    throw new TypeError("$receiptRecord.fingerprint does not match its metadata.");
  }
  return deepFreeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_RECEIPT_RECORD_SCHEMA,
    receiptSchemaVersion: ISOLATED_CODE_EXECUTION_RECEIPT_SCHEMA,
    runId: parsedWithoutFingerprint.runId,
    producerGeneration: parsedWithoutFingerprint.producerGeneration,
    profile: parsedWithoutFingerprint.profile,
    sourceSha256: parsedWithoutFingerprint.sourceSha256,
    policy: parsedWithoutFingerprint.policy,
    runtime: parsedWithoutFingerprint.runtime,
    termination: parsedWithoutFingerprint.termination,
    logs: parsedWithoutFingerprint.logs,
    outputs: parsedWithoutFingerprint.outputs,
    destruction: parsedWithoutFingerprint.destruction,
    publication: parsedWithoutFingerprint.publication,
    fingerprint,
  });
}

export function runtimeAttestationsEqual(
  left: IsolatedCodeRuntimeAttestation,
  right: IsolatedCodeRuntimeAttestation,
): boolean {
  return left.isolationClass === right.isolationClass &&
    fingerprintsEqual(left.imageDigest, right.imageDigest) &&
    Object.keys(left.requestedLimits).every((key) =>
      left.requestedLimits[key as keyof IsolatedCodeExecutionLimits] ===
        right.requestedLimits[key as keyof IsolatedCodeExecutionLimits]
    ) &&
    Object.keys(left.limitAssurance).every((key) =>
      left.limitAssurance[key as keyof IsolatedCodeLimitAssuranceMatrix] ===
        right.limitAssurance[key as keyof IsolatedCodeLimitAssuranceMatrix]
    );
}

export function isolatedCodeRefsEqual(
  left: IsolatedCodeProfileRef | IsolatedCodePolicyRef,
  right: IsolatedCodeProfileRef | IsolatedCodePolicyRef,
): boolean {
  if (left.id !== right.id || left.version !== right.version) return false;
  if ("fingerprint" in left || "fingerprint" in right) {
    return "fingerprint" in left && "fingerprint" in right &&
      fingerprintsEqual(left.fingerprint, right.fingerprint);
  }
  return true;
}

export function validateIsolatedOutputCasUri(
  value: unknown,
  sha256: string,
  path = "$casUri",
): string {
  const digest = sha256Hex(sha256, `${path}.sha256`);
  const uri = canonicalResourceUri(value, path);
  const expected = `casys://isolated-output/sha256/${digest}`;
  if (uri !== expected) {
    throw new TypeError(
      `${path} must equal the isolated-output CAS URI for sha256 ${digest}.`,
    );
  }
  return uri;
}

function validateStoredLogReceipt(
  value: unknown,
  path: string,
  byteCap: number,
): IsolatedCodeLogReceipt {
  const log = exactRecord(value, ["byteCount", "sha256", "truncated"], path);
  const byteCount = nonNegativeSafeInteger(log.byteCount, `${path}.byteCount`);
  if (byteCount > byteCap) throw new TypeError(`${path} exceeds its byte cap.`);
  if (typeof log.truncated !== "boolean") {
    throw new TypeError(`${path}.truncated must be a boolean.`);
  }
  return deepFreeze({
    byteCount,
    sha256: sha256Hex(log.sha256, `${path}.sha256`),
    truncated: log.truncated,
  });
}

export function validateIsolatedCodeOutputReceiptRecord(
  value: unknown,
  path: string,
  byteCap: number,
): IsolatedCodeOutputReceiptRecord {
  const output = exactRecord(value, [
    "role",
    "basename",
    "mediaType",
    "format",
    "byteCount",
    "sha256",
    "casUri",
    "validation",
    "persistence",
  ], path);
  const declaration = validateIsolatedCodeOutputDeclaration({
    role: output.role,
    basename: output.basename,
    mediaType: output.mediaType,
    format: output.format,
  }, path);
  const byteCount = nonNegativeSafeInteger(output.byteCount, `${path}.byteCount`);
  if (byteCount > byteCap) throw new TypeError(`${path} exceeds its byte cap.`);
  const sha256 = sha256Hex(output.sha256, `${path}.sha256`);
  literalValue(output.validation, "accepted", `${path}.validation`);
  literalValue(
    output.persistence,
    "staged-reread-atomic-commit",
    `${path}.persistence`,
  );
  return deepFreeze({
    ...declaration,
    byteCount,
    sha256,
    casUri: validateIsolatedOutputCasUri(output.casUri, sha256, `${path}.casUri`),
    validation: "accepted",
    persistence: "staged-reread-atomic-commit",
  });
}

async function createLogReceipt(
  value: { readonly bytes: Uint8Array; readonly truncated: boolean },
  path: string,
  byteCap: number,
): Promise<IsolatedCodeLogReceipt> {
  if (typeof value.truncated !== "boolean") {
    throw new TypeError(`${path}.truncated must be a boolean.`);
  }
  const bytes = copyObservedUint8Array(value.bytes, `${path}.bytes`, byteCap);
  return deepFreeze({
    byteCount: bytes.byteLength,
    sha256: await fingerprintResourceBytes(bytes),
    truncated: value.truncated,
  });
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function createLogObservation(
  value: { readonly bytes: Uint8Array; readonly truncated: boolean },
  path: string,
  byteCap: number,
): Promise<IsolatedCodeExecutionLogObservation> {
  if (typeof value.truncated !== "boolean") {
    throw new TypeError(`${path}.truncated must be a boolean.`);
  }
  const bytes = copyObservedUint8Array(value.bytes, `${path}.bytes`, byteCap);
  return deepFreeze({
    byteCount: bytes.byteLength,
    sha256: await fingerprintResourceBytes(bytes),
    truncated: value.truncated,
    excerpt: excerptFromLogBytes(bytes),
  });
}

function validateLogObservation(
  value: unknown,
  path: string,
): IsolatedCodeExecutionLogObservation {
  const record = exactRecord(
    value,
    ["byteCount", "sha256", "truncated", "excerpt"],
    path,
  );
  if (typeof record.truncated !== "boolean") {
    throw new TypeError(`${path}.truncated must be a boolean.`);
  }
  const byteCount = nonNegativeSafeInteger(record.byteCount, `${path}.byteCount`);
  const sha256 = sha256Hex(record.sha256, `${path}.sha256`);
  if (byteCount === 0 && sha256 !== EMPTY_SHA256) {
    throw new TypeError(`${path}.sha256 does not match an empty log.`);
  }
  return deepFreeze({
    byteCount,
    sha256,
    truncated: record.truncated,
    excerpt: assertSanitizedExcerpt(record.excerpt, `${path}.excerpt`),
  });
}

function excerptFromLogBytes(bytes: Uint8Array): string {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return capExcerpt(stripTerminalControlSequences(decoded));
}

function assertSanitizedExcerpt(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string.`);
  }
  if (value.length > MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS) {
    throw new TypeError(`${path} exceeds the independent excerpt cap.`);
  }
  if (stripTerminalControlSequences(value) !== value) {
    throw new TypeError(`${path} contains terminal control sequences.`);
  }
  return value;
}

function capExcerpt(value: string): string {
  if (value.length <= MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS) {
    return value;
  }
  let sliced = value.slice(0, MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS);
  if (
    sliced.length > 0 &&
    (sliced.charCodeAt(sliced.length - 1) & 0xfc00) === 0xd800
  ) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

function stripTerminalControlSequences(value: string): string {
  return value
    // deno-lint-ignore no-control-regex -- ANSI CSI escape bytes are intentionally stripped.
    .replaceAll(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // deno-lint-ignore no-control-regex -- OSC escape bytes are intentionally stripped.
    .replaceAll(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replaceAll(/\x9b[0-9;?]*[ -/]*[@-~]/g, "")
    // deno-lint-ignore no-control-regex -- Single-character ESC sequences are intentionally stripped.
    .replaceAll(/\x1b[@-Z\\-_]/g, "")
    // deno-lint-ignore no-control-regex -- Remaining C0 and DEL bytes are intentionally stripped.
    .replaceAll(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/**
 * Read a byte view's real internal length without consulting overridable
 * accessors. Subclasses are accepted; Proxies and non-Uint8 typed arrays are
 * rejected because the intrinsic getters cannot observe the required slots.
 */
export function observedUint8ArrayByteLength(
  value: unknown,
  path: string,
): number {
  try {
    const tag = INTRINSIC_TYPED_ARRAY_TAG.call(value);
    const byteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH.call(value);
    if (tag !== "Uint8Array" || !Number.isSafeInteger(byteLength)) {
      throw new TypeError("invalid Uint8Array internal slots");
    }
    return byteLength;
  } catch {
    throw new TypeError(`${path} must be an intrinsic Uint8Array byte view.`);
  }
}

/**
 * Bound before allocation, then clone through the intrinsic typed-array `set`
 * path. This deliberately ignores subclass iterators and public `byteLength`
 * overrides, either of which could otherwise inflate or hide untrusted bytes.
 */
export function copyObservedUint8Array(
  value: unknown,
  path: string,
  maximumBytes?: number,
): Uint8Array {
  const byteLength = observedUint8ArrayByteLength(value, path);
  if (maximumBytes !== undefined && byteLength > maximumBytes) {
    throw new TypeError(`${path} exceeds the configured byte cap.`);
  }
  const copy = new Uint8Array(byteLength);
  try {
    Uint8Array.prototype.set.call(copy, value as Uint8Array);
  } catch {
    throw new TypeError(`${path} could not be copied as intrinsic bytes.`);
  }
  return copy;
}

function rejectCaseFoldedBasenameCollisions(
  outputs: readonly IsolatedCodeOutputDeclaration[],
  path: string,
): void {
  rejectDuplicates(
    outputs.map((output) => output.basename.toLowerCase()),
    path,
  );
}

function declarationsEqual(
  left: IsolatedCodeOutputDeclaration,
  right: IsolatedCodeOutputDeclaration,
): boolean {
  return left.role === right.role && left.basename === right.basename &&
    left.mediaType === right.mediaType && left.format === right.format;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function limitAssurance(value: unknown, path: string): IsolatedCodeLimitAssurance {
  if (
    value !== "backend-attested" && value !== "broker-observed-cap" &&
    value !== "unattested"
  ) {
    throw new TypeError(`${path} must declare a supported assurance level.`);
  }
  return value;
}

function validateReceiptDestruction(
  value: unknown,
  expectedRunId: string,
): IsolatedCodeExecutionReceipt["destruction"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$destruction must be an object.");
  }
  const status = (value as { status?: unknown }).status;
  if (status === "proven") {
    const record = exactRecord(
      value,
      ["status", "runId", "proofFingerprint"],
      "$destruction",
    );
    const runId = safeId(record.runId, "$destruction.runId");
    if (runId !== expectedRunId) {
      throw new TypeError("$destruction.runId does not match the execution run.");
    }
    return deepFreeze({
      status,
      runId,
      proofFingerprint: validateContentFingerprint(
        record.proofFingerprint,
        "$destruction.proofFingerprint",
      ),
    });
  }
  if (status === "acknowledged-unattested") {
    const record = exactRecord(
      value,
      ["status", "runId", "acknowledgementFingerprint"],
      "$destruction",
    );
    const runId = safeId(record.runId, "$destruction.runId");
    if (runId !== expectedRunId) {
      throw new TypeError("$destruction.runId does not match the execution run.");
    }
    return deepFreeze({
      status,
      runId,
      acknowledgementFingerprint: validateContentFingerprint(
        record.acknowledgementFingerprint,
        "$destruction.acknowledgementFingerprint",
      ),
    });
  }
  throw new TypeError("$destruction.status is unsupported.");
}
