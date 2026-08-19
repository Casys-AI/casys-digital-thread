import type {
  IsolatedCodeExecutionReceipt,
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeExecutionRequest,
  IsolatedCodeOutputReceiptRecord,
  IsolatedOutputProducerGeneration,
  IsolatedOutputProducerGenerationAdvance,
  IsolatedOutputProducerGenerationAdvanceInput,
  IsolatedOutputPublicationRef,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";

/**
 * Public application capability for code execution behind an isolation broker.
 *
 * Neither side can observe a backend lease, filesystem path, container id, or
 * provider handle. A successful return is already closed and content-addressed.
 */
export interface IsolatedCodeRunner {
  run(request: IsolatedCodeExecutionRequest): Promise<IsolatedCodeExecutionReceipt>;
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
