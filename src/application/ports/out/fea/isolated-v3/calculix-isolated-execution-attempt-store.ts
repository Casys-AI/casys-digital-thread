/** Durable replay boundary for a provider-free isolated CalculiX dispatch. */

import type { CalculixIsolatedExecutionProfile } from "./calculix-isolated-execution-profile.ts";
import type {
  IsolatedCodeExecutionReceipt,
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeExecutionRejectionDiagnostic,
  IsolatedCodeOutputValidationRejection,
  IsolatedOutputProducerGenerationAdvance,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { CalculixIsolatedExecutionEvidence } from "../../../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import { sha256Fingerprint } from "../../../../../domain/kernel/deterministic-json.ts";

export interface CalculixIsolatedExecutionAttemptIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly requestId: string;
  readonly startedAt: string;
  /** Exact ROP2 bytes; it binds the run MRTR and canonical Thread inputs. */
  readonly resolvedOperationPlanFingerprint: ContentFingerprint;
  /** Existing proof-case seal; the local route does not replace its MRTR. */
  readonly proofFingerprint: ContentFingerprint;
  readonly step: {
    readonly byteCount: number;
    readonly sha256: string;
  };
  readonly bundleFingerprint: ContentFingerprint;
  readonly profile: CalculixIsolatedExecutionProfile;
}

export interface CalculixIsolatedExecutionAttemptKey {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ContentFingerprint;
}

interface AttemptBase extends CalculixIsolatedExecutionAttemptKey {
  readonly schemaVersion: "calculix-isolated-execution-attempt/1.0";
  readonly identity: CalculixIsolatedExecutionAttemptIdentity;
  readonly preparedAt: string;
}

export type CalculixIsolatedProvenDestruction = Extract<
  IsolatedCodeExecutionReceipt["destruction"],
  { readonly status: "proven" }
>;

export type CalculixIsolatedExecutionDispatch =
  | {
    readonly dispatchCount: 1;
    readonly producerGeneration: 0;
    readonly dispatchedAt: string;
  }
  | {
    readonly dispatchCount: 2;
    readonly producerGeneration: 1;
    readonly dispatchedAt: string;
    readonly redispatch: {
      readonly status: "authorized" | "consumed";
      readonly previousProducerGeneration: 0;
      readonly generationAdvance: IsolatedOutputProducerGenerationAdvance;
      readonly recoveryDestruction: {
        readonly status: "proven";
        readonly runId: string;
        readonly proofFingerprint: ContentFingerprint;
      };
    };
  };

export type CalculixIsolatedExecutionAttempt =
  | (AttemptBase & { readonly phase: "prepared" })
  | (AttemptBase & {
    readonly phase: "dispatching";
    readonly dispatch: CalculixIsolatedExecutionDispatch;
  })
  | (AttemptBase & {
    readonly phase: "output-published";
    readonly dispatch: CalculixIsolatedExecutionDispatch;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  })
  | (AttemptBase & {
    readonly phase: "evidence-captured";
    readonly dispatch: CalculixIsolatedExecutionDispatch;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly evidence: CalculixIsolatedExecutionEvidence;
  })
  | (AttemptBase & {
    readonly phase: "execution-rejected";
    readonly dispatch: CalculixIsolatedExecutionDispatch;
    readonly rejection: {
      readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;
      readonly destruction: CalculixIsolatedProvenDestruction;
    };
  })
  | (AttemptBase & {
    readonly phase: "output-validation-rejected";
    readonly dispatch: CalculixIsolatedExecutionDispatch;
    readonly outputValidationRejection: {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: CalculixIsolatedProvenDestruction;
    };
  })
  | (AttemptBase & {
    readonly phase: "redispatch-exhausted";
    readonly dispatch: Extract<
      CalculixIsolatedExecutionDispatch,
      { readonly dispatchCount: 2 }
    >;
    readonly exhaustion: {
      readonly producerGeneration: 1;
      readonly destruction: CalculixIsolatedProvenDestruction;
    };
  });

export interface CalculixIsolatedRedispatchConsumption {
  readonly outcome: "consumed-now" | "already-consumed";
  readonly attempt: CalculixIsolatedExecutionAttempt;
}

export interface CalculixIsolatedExecutionAttemptStore {
  read(
    projectId: string,
    agentRunId: string,
  ): Promise<CalculixIsolatedExecutionAttempt | undefined>;
  prepare(
    identity: CalculixIsolatedExecutionAttemptIdentity,
  ): Promise<CalculixIsolatedExecutionAttempt>;
  markDispatching(
    input: CalculixIsolatedExecutionAttemptKey & { readonly dispatchedAt: string },
  ): Promise<CalculixIsolatedExecutionAttempt>;
  authorizeRedispatch(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly recoveryDestruction: {
        readonly status: "proven";
        readonly runId: string;
        readonly proofFingerprint: ContentFingerprint;
      };
      readonly generationAdvance: IsolatedOutputProducerGenerationAdvance;
    },
  ): Promise<CalculixIsolatedExecutionAttempt>;
  consumeRedispatch(
    input: CalculixIsolatedExecutionAttemptKey,
  ): Promise<CalculixIsolatedRedispatchConsumption>;
  markOutputPublished(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<CalculixIsolatedExecutionAttempt>;
  markEvidenceCaptured(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly evidence: CalculixIsolatedExecutionEvidence;
    },
  ): Promise<CalculixIsolatedExecutionAttempt>;
  markExecutionRejected(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;
      readonly destruction: CalculixIsolatedProvenDestruction;
    },
  ): Promise<CalculixIsolatedExecutionAttempt>;
  markOutputValidationRejected(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: CalculixIsolatedProvenDestruction;
    },
  ): Promise<CalculixIsolatedExecutionAttempt>;
  markRedispatchExhausted(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly destruction: CalculixIsolatedProvenDestruction;
    },
  ): Promise<CalculixIsolatedExecutionAttempt>;
}

export async function fingerprintCalculixIsolatedExecutionAttemptIdentity(
  identity: CalculixIsolatedExecutionAttemptIdentity,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: "calculix-isolated-execution-attempt-identity/1.0",
    identity,
  });
}
