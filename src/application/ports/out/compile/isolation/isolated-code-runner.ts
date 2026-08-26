import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRejectionDiagnostic,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputReceiptRecord,
  type IsolatedCodeOutputValidationRejection,
  type IsolatedOutputProducerGeneration,
  type IsolatedOutputProducerGenerationAdvance,
  type IsolatedOutputProducerGenerationAdvanceInput,
  type IsolatedOutputPublicationRef,
  validateIsolatedCodeExecutionDestruction,
  validateIsolatedCodeExecutionRejectionDiagnostic,
  validateIsolatedCodeOutputValidationRejection,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";

/**
 * Public application capability for code execution behind an isolation broker.
 *
 * Neither side can observe a backend lease, filesystem path, container id, or
 * provider handle. A successful return is already closed and content-addressed.
 * A known unsuccessful termination throws IsolatedCodeExecutionRejectedError
 * after destruction is proven, without a receipt or outputs. A code-owned
 * output validator rejection after a successful backend execution throws
 * IsolatedCodeOutputValidationRejectedError after destruction, without a
 * receipt or outputs.
 */
export interface IsolatedCodeRunner {
  run(request: IsolatedCodeExecutionRequest): Promise<IsolatedCodeExecutionReceipt>;
}

/**
 * Distinct public rejection for a known unsuccessful isolated termination.
 * The diagnostic is an immutable validated record: termination plus bounded
 * log observations. Destruction is the already-accepted cleanup proof.
 */
export class IsolatedCodeExecutionRejectedError extends Error {
  readonly code = "execution_rejected" as const;
  readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;
  readonly destruction: IsolatedCodeExecutionReceipt["destruction"];

  constructor(
    diagnostic: IsolatedCodeExecutionRejectionDiagnostic,
    destruction: IsolatedCodeExecutionReceipt["destruction"],
  ) {
    super("The isolated program did not terminate successfully.");
    this.name = "IsolatedCodeExecutionRejectedError";
    this.diagnostic = validateIsolatedCodeExecutionRejectionDiagnostic(diagnostic);
    this.destruction = validateIsolatedCodeExecutionDestruction(
      destruction,
      destructionRunId(destruction),
    );
  }
}

/**
 * Distinct public terminal when a code-owned output validator rejects observed
 * bytes after a successful isolated execution. It is not an unsuccessful
 * program termination and never carries raw bytes, backend paths, handles,
 * validator messages, cause, or a validator stack.
 */
export class IsolatedCodeOutputValidationRejectedError extends Error {
  readonly code = "output_validation_rejected" as const;
  readonly observation: IsolatedCodeOutputValidationRejection;
  readonly destruction: IsolatedCodeExecutionReceipt["destruction"];

  constructor(
    observation: IsolatedCodeOutputValidationRejection,
    destruction: IsolatedCodeExecutionReceipt["destruction"],
  ) {
    super("A code-owned isolated output validator rejected the observed bytes.");
    this.name = "IsolatedCodeOutputValidationRejectedError";
    this.observation = validateIsolatedCodeOutputValidationRejection(observation);
    this.destruction = validateIsolatedCodeExecutionDestruction(
      destruction,
      destructionRunId(destruction),
    );
  }
}

function destructionRunId(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$destruction must be an object.");
  }
  const runId = (value as { runId?: unknown }).runId;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new TypeError("$destruction.runId must be a non-empty string.");
  }
  return runId;
}

/**
 * Run-scoped cleanup seam used only after a durable WAL proves dispatch may
 * have happened but the output marker proves nothing was published.
 *
 * The caller never receives a backend lease or provider handle. Returning an
 * accepted destruction record closes the named producer generation; an error
 * keeps the run quarantined. The initial generation is 0. One retry under the
 * same logical execution run id requires a separate durable advance from 0 to
 * 1 before dispatch; this contract never admits generation 2.
 */
export interface IsolatedCodeRunRecovery {
  destroyByRunId(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<
    IsolatedCodeExecutionReceipt["destruction"]
  >;
  advanceProducerGeneration(
    input: IsolatedOutputProducerGenerationAdvanceInput,
  ): Promise<IsolatedOutputProducerGenerationAdvance>;
}

export interface IsolatedOutputCasObject {
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly role: string;
  readonly basename: string;
  readonly mediaType: string;
  readonly format: string;
  readonly byteCount: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface IsolatedOutputCasWriteReceipt {
  readonly role: string;
  readonly casUri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface StagedIsolatedOutputBatch<Batch> {
  /** Opaque adapter-owned transaction capability; never leaves the use case. */
  readonly batch: Batch;
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly receipts: readonly IsolatedOutputCasWriteReceipt[];
}

export type IsolatedOutputPublicationResolution =
  | {
    readonly status: "published";
    readonly ref: IsolatedOutputPublicationRef;
    readonly receipt: IsolatedCodeExecutionReceiptRecord;
  }
  | {
    readonly status: "not-published";
    readonly ref: IsolatedOutputPublicationRef;
  }
  | {
    readonly status: "outcome-unknown";
    readonly ref: IsolatedOutputPublicationRef;
  };

export type IsolatedOutputRunPublicationResolution =
  | {
    readonly status: "published";
    readonly runId: string;
    readonly producerGeneration: IsolatedOutputProducerGeneration;
    readonly ref: IsolatedOutputPublicationRef;
    readonly receipt: IsolatedCodeExecutionReceiptRecord;
  }
  | {
    readonly status: "not-published" | "outcome-unknown";
    readonly runId: string;
    readonly producerGeneration: IsolatedOutputProducerGeneration;
  };

/**
 * Immutable content store seam; implementations must never expose a path.
 *
 * Staged bytes are not publicly addressable. `commit` publishes the entire
 * manifest atomically or publishes none of it. A rejected `stageBatch` must
 * remain recoverable by the server-issued run id even if its acknowledgement
 * was lost. The byte-free complete receipt is durable before the one logical
 * publication marker. A commit rejection is ambiguous until
 * `resolvePublication` inspects that exact marker; commit is never retried.
 */
export interface IsolatedOutputCasSink<Batch = unknown> {
  stageBatch(
    objects: readonly IsolatedOutputCasObject[],
  ): Promise<StagedIsolatedOutputBatch<Batch>>;
  readStaged(batch: Batch, casUri: string): Promise<Uint8Array>;
  commit(
    batch: Batch,
    receipt: IsolatedCodeExecutionReceiptRecord,
  ): Promise<IsolatedOutputPublicationResolution>;
  resolvePublication(
    ref: IsolatedOutputPublicationRef,
  ): Promise<IsolatedOutputPublicationResolution>;
  abort(batch: Batch): Promise<void>;
  /**
   * Durably close one producer generation, then remove only its unpublished
   * staging. Once this returns (or its durable acknowledgement is lost), that
   * generation can never stage or publish. Published markers remain immutable.
   */
  abortByRunId(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<void>;
  /** Idempotently persist the sole server-owned advance from generation 0 to 1. */
  advanceProducerGeneration(
    input: IsolatedOutputProducerGenerationAdvanceInput,
  ): Promise<IsolatedOutputProducerGenerationAdvance>;
}

/** Publication-gated reader: a bare object digest or URI grants no read. */
export interface IsolatedOutputPublicationReader {
  /** Crash recovery when only the durable server-issued run id remains. */
  resolvePublicationByRunId(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<IsolatedOutputRunPublicationResolution>;
  readReceipt(
    ref: IsolatedOutputPublicationRef,
  ): Promise<IsolatedCodeExecutionReceipt | undefined>;
  readPublishedObject(
    ref: IsolatedOutputPublicationRef,
    member: IsolatedCodeOutputReceiptRecord,
  ): Promise<Uint8Array | undefined>;
}
