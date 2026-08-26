/**
 * Durable recovery journal for one admitted SPICE isolated execution.
 *
 * The identity deliberately retains every reviewed authority fact but never
 * the admitted source bytes. A caller may dispatch only in the local
 * continuation of a successful phase transition. Reopening `dispatching`
 * after an ambiguous acknowledgement is recovery-only and never grants a
 * second call to the runner. A known IsolatedCodeExecutionRejectedError is
 * recorded after proven destruction and never publishes Thread evidence.
 * Closing generation one without publication records
 * `retry-generation-closed` with that generation's proven cleanup and never
 * publishes Thread evidence.
 */

import type {
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeExecutionRejectionDiagnostic,
  IsolatedCodeOutputDeclaration,
  IsolatedCodeOutputValidationRejection,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedOutputProducerGenerationAdvance,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { SpiceAdmittedRunAdmission } from "../../../../../domain/electrical/spice/admitted/run-proposal.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type { AdmittedSpiceExecutionProfile } from "./admitted-execution-profile-catalog.ts";

export interface AdmittedSpiceExecutionAttemptIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  /** Exact durable project-run start; prevents transplant across timelines. */
  readonly startedAt: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  /** Fingerprint of the exact Thread snapshot reopened by the executor. */
  readonly basisFingerprint: ContentFingerprint;
  /** Exact server-stamped run input, including operation and approved decision. */
  readonly reviewedRunFingerprint: ContentFingerprint;
  readonly decision: {
    readonly id: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly approval: {
    readonly id: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly admission: SpiceAdmittedRunAdmission;
  readonly executionProfile: AdmittedSpiceExecutionProfile;
  /** Exact byte-free generation-zero request. Source bytes never enter the WAL. */
  readonly isolatedRequest: {
    readonly schemaVersion: "isolated-code-execution-request/1.0";
    readonly runId: string;
    readonly producerGeneration: 0;
    readonly profile: IsolatedCodeProfileRef;
    readonly sourceSha256: string;
    readonly policy: IsolatedCodePolicyRef;
    readonly outputs: readonly IsolatedCodeOutputDeclaration[];
  };
}

export interface AdmittedSpiceExecutionAttemptKey {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ContentFingerprint;
}

export interface AdmittedSpiceExecutionDispatch {
  readonly dispatchCount: 1 | 2;
  readonly producerGeneration: 0 | 1;
  readonly dispatchedAt: string;
}

export interface AdmittedSpiceExecutionGenerationRecovery {
  readonly generationZeroDestruction: Extract<
    IsolatedCodeExecutionReceiptRecord["destruction"],
    { readonly status: "proven" }
  >;
  readonly advance: IsolatedOutputProducerGenerationAdvance;
}

export type AdmittedSpiceProvenDestruction = Extract<
  IsolatedCodeExecutionReceiptRecord["destruction"],
  { readonly status: "proven" }
>;

export interface AdmittedSpiceExecutionThreadArtifactEvidence {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

/** Exact three-artifact documentary successor supplied after durable readback. */
export interface AdmittedSpiceExecutionThreadEvidenceInput {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
  readonly artifacts: {
    readonly capture: AdmittedSpiceExecutionThreadArtifactEvidence;
    readonly evidence: AdmittedSpiceExecutionThreadArtifactEvidence;
    readonly result: AdmittedSpiceExecutionThreadArtifactEvidence;
  };
}

/** WAL-sealed successor, bound to the exact attempt identity and receipt. */
export interface AdmittedSpiceExecutionThreadEvidence
  extends AdmittedSpiceExecutionThreadEvidenceInput {
  readonly fingerprint: ContentFingerprint;
}

interface AttemptBase extends AdmittedSpiceExecutionAttemptKey {
  readonly schemaVersion: "spice-admitted-execution-attempt/1.0";
  readonly identity: AdmittedSpiceExecutionAttemptIdentity;
  readonly preparedAt: string;
}

export type AdmittedSpiceExecutionAttempt =
  | (AttemptBase & { readonly phase: "prepared" })
  | (AttemptBase & {
    readonly phase: "dispatching";
    readonly dispatch: AdmittedSpiceExecutionDispatch;
    readonly generationRecovery:
      | AdmittedSpiceExecutionGenerationRecovery
      | null;
  })
  | (AttemptBase & {
    readonly phase: "generation-zero-cleaned";
    readonly dispatch: AdmittedSpiceExecutionDispatch & {
      readonly dispatchCount: 1;
      readonly producerGeneration: 0;
    };
    readonly generationZeroDestruction: AdmittedSpiceProvenDestruction;
  })
  | (AttemptBase & {
    readonly phase: "output-published";
    readonly dispatch: AdmittedSpiceExecutionDispatch;
    readonly generationRecovery:
      | AdmittedSpiceExecutionGenerationRecovery
      | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  })
  | (AttemptBase & {
    readonly phase: "completed";
    readonly dispatch: AdmittedSpiceExecutionDispatch;
    readonly generationRecovery:
      | AdmittedSpiceExecutionGenerationRecovery
      | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly threadEvidence: AdmittedSpiceExecutionThreadEvidence;
  })
  | (AttemptBase & {
    readonly phase: "execution-rejected";
    readonly dispatch: AdmittedSpiceExecutionDispatch;
    readonly generationRecovery:
      | AdmittedSpiceExecutionGenerationRecovery
      | null;
    readonly rejection: {
      readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;
      readonly destruction: AdmittedSpiceProvenDestruction;
    };
  })
  | (AttemptBase & {
    readonly phase: "output-validation-rejected";
    readonly dispatch: AdmittedSpiceExecutionDispatch;
    readonly generationRecovery:
      | AdmittedSpiceExecutionGenerationRecovery
      | null;
    readonly outputValidationRejection: {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: AdmittedSpiceProvenDestruction;
    };
  })
  | (AttemptBase & {
    readonly phase: "retry-generation-closed";
    readonly dispatch: AdmittedSpiceExecutionDispatch & {
      readonly dispatchCount: 2;
      readonly producerGeneration: 1;
    };
    readonly generationRecovery: AdmittedSpiceExecutionGenerationRecovery;
    readonly closedGeneration: {
      readonly producerGeneration: 1;
      readonly destruction: AdmittedSpiceProvenDestruction;
    };
  });

/**
 * Only `transitioned-now` grants the caller's same local continuation one
 * dispatch. `already-transitioned` is observation/recovery-only.
 */
export interface AdmittedSpiceExecutionDispatchTransition {
  readonly outcome: "transitioned-now" | "already-transitioned";
  readonly attempt: Extract<
    AdmittedSpiceExecutionAttempt,
    { readonly phase: "dispatching" }
  >;
}

export interface AdmittedSpiceExecutionAttemptStore {
  read(
    projectId: string,
    agentRunId: string,
  ): Promise<AdmittedSpiceExecutionAttempt | undefined>;
  prepare(
    identity: AdmittedSpiceExecutionAttemptIdentity,
    preparedAt: string,
  ): Promise<AdmittedSpiceExecutionAttempt>;
  markDispatching(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly dispatchedAt: string;
    },
  ): Promise<AdmittedSpiceExecutionDispatchTransition>;
  markGenerationZeroCleaned(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly destruction: AdmittedSpiceProvenDestruction;
    },
  ): Promise<AdmittedSpiceExecutionAttempt>;
  markRedispatching(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly advance: IsolatedOutputProducerGenerationAdvance;
      readonly dispatchedAt: string;
    },
  ): Promise<AdmittedSpiceExecutionDispatchTransition>;
  markOutputPublished(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<AdmittedSpiceExecutionAttempt>;
  markCompleted(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly threadEvidence: AdmittedSpiceExecutionThreadEvidenceInput;
    },
  ): Promise<AdmittedSpiceExecutionAttempt>;
  markExecutionRejected(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;
      readonly destruction: AdmittedSpiceProvenDestruction;
    },
  ): Promise<AdmittedSpiceExecutionAttempt>;
  markOutputValidationRejected(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: AdmittedSpiceProvenDestruction;
    },
  ): Promise<AdmittedSpiceExecutionAttempt>;
  markRetryGenerationClosed(
    input: AdmittedSpiceExecutionAttemptKey & {
      readonly destruction: AdmittedSpiceProvenDestruction;
    },
  ): Promise<AdmittedSpiceExecutionAttempt>;
}

export async function fingerprintAdmittedSpiceExecutionAttemptIdentity(
  identity: AdmittedSpiceExecutionAttemptIdentity,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: "spice-admitted-execution-attempt-identity/1.0",
    identity,
  });
}
