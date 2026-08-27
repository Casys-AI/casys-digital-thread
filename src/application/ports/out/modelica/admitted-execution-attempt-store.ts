/**
 * Durable recovery journal for one admitted Modelica isolated execution.
 *
 * The identity deliberately retains every reviewed authority fact but never
 * the admitted source bytes. A caller may dispatch only in the local
 * continuation of a successful phase transition. Reopening `dispatching`
 * after an ambiguous acknowledgement is recovery-only and never grants a
 * second call to the runner.
 */

import type {
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeOutputDeclaration,
  IsolatedCodeOutputValidationRejection,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedOutputProducerGenerationAdvance,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ModelicaAdmittedRunAdmission } from "../../../../domain/modelica/admitted/run-proposal.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { AdmittedModelicaExecutionProfile } from "./admitted-execution-profile-catalog.ts";

export interface AdmittedModelicaExecutionAttemptIdentity {
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
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly executionProfile: AdmittedModelicaExecutionProfile;
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

export interface AdmittedModelicaExecutionAttemptKey {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ContentFingerprint;
}

export interface AdmittedModelicaExecutionDispatch {
  readonly dispatchCount: 1 | 2;
  readonly producerGeneration: 0 | 1;
  readonly dispatchedAt: string;
}

export type AdmittedModelicaProvenDestruction = Extract<
  IsolatedCodeExecutionReceiptRecord["destruction"],
  { readonly status: "proven" }
>;

export interface AdmittedModelicaExecutionGenerationRecovery {
  readonly generationZeroDestruction: AdmittedModelicaProvenDestruction;
  readonly advance: IsolatedOutputProducerGenerationAdvance;
}

export interface AdmittedModelicaExecutionThreadArtifactEvidence {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

/** Exact three-artifact documentary successor supplied after durable readback. */
export interface AdmittedModelicaExecutionThreadEvidenceInput {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
  readonly artifacts: {
    readonly capture: AdmittedModelicaExecutionThreadArtifactEvidence;
    readonly evidence: AdmittedModelicaExecutionThreadArtifactEvidence;
    readonly result: AdmittedModelicaExecutionThreadArtifactEvidence;
  };
}

/** WAL-sealed successor, bound to the exact attempt identity and receipt. */
export interface AdmittedModelicaExecutionThreadEvidence
  extends AdmittedModelicaExecutionThreadEvidenceInput {
  readonly fingerprint: ContentFingerprint;
}

interface AttemptBase extends AdmittedModelicaExecutionAttemptKey {
  readonly schemaVersion: "modelica-admitted-execution-attempt/1.0";
  readonly identity: AdmittedModelicaExecutionAttemptIdentity;
  readonly preparedAt: string;
}

export type AdmittedModelicaExecutionAttempt =
  | (AttemptBase & { readonly phase: "prepared" })
  | (AttemptBase & {
    readonly phase: "dispatching";
    readonly dispatch: AdmittedModelicaExecutionDispatch;
    readonly generationRecovery:
      | AdmittedModelicaExecutionGenerationRecovery
      | null;
  })
  | (AttemptBase & {
    readonly phase: "generation-zero-cleaned";
    readonly dispatch: AdmittedModelicaExecutionDispatch & {
      readonly dispatchCount: 1;
      readonly producerGeneration: 0;
    };
    readonly generationZeroDestruction: AdmittedModelicaProvenDestruction;
  })
  | (AttemptBase & {
    readonly phase: "output-published";
    readonly dispatch: AdmittedModelicaExecutionDispatch;
    readonly generationRecovery:
      | AdmittedModelicaExecutionGenerationRecovery
      | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  })
  | (AttemptBase & {
    readonly phase: "completed";
    readonly dispatch: AdmittedModelicaExecutionDispatch;
    readonly generationRecovery:
      | AdmittedModelicaExecutionGenerationRecovery
      | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly threadEvidence: AdmittedModelicaExecutionThreadEvidence;
  })
  | (AttemptBase & {
    readonly phase: "output-validation-rejected";
    readonly dispatch: AdmittedModelicaExecutionDispatch;
    readonly generationRecovery:
      | AdmittedModelicaExecutionGenerationRecovery
      | null;
    readonly outputValidationRejection: {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: AdmittedModelicaProvenDestruction;
    };
  });

/**
 * Only `transitioned-now` grants the caller's same local continuation one
 * dispatch. `already-transitioned` is observation/recovery-only.
 */
export interface AdmittedModelicaExecutionDispatchTransition {
  readonly outcome: "transitioned-now" | "already-transitioned";
  readonly attempt: Extract<
    AdmittedModelicaExecutionAttempt,
    { readonly phase: "dispatching" }
  >;
}

export interface AdmittedModelicaExecutionAttemptStore {
  read(
    projectId: string,
    agentRunId: string,
  ): Promise<AdmittedModelicaExecutionAttempt | undefined>;
  prepare(
    identity: AdmittedModelicaExecutionAttemptIdentity,
    preparedAt: string,
  ): Promise<AdmittedModelicaExecutionAttempt>;
  markDispatching(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly dispatchedAt: string;
    },
  ): Promise<AdmittedModelicaExecutionDispatchTransition>;
  markGenerationZeroCleaned(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly destruction: AdmittedModelicaProvenDestruction;
    },
  ): Promise<AdmittedModelicaExecutionAttempt>;
  markRedispatching(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly advance: IsolatedOutputProducerGenerationAdvance;
      readonly dispatchedAt: string;
    },
  ): Promise<AdmittedModelicaExecutionDispatchTransition>;
  markOutputPublished(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<AdmittedModelicaExecutionAttempt>;
  markCompleted(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly threadEvidence: AdmittedModelicaExecutionThreadEvidenceInput;
    },
  ): Promise<AdmittedModelicaExecutionAttempt>;
  markOutputValidationRejected(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: AdmittedModelicaProvenDestruction;
    },
  ): Promise<AdmittedModelicaExecutionAttempt>;
}

export async function fingerprintAdmittedModelicaExecutionAttemptIdentity(
  identity: AdmittedModelicaExecutionAttemptIdentity,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: "modelica-admitted-execution-attempt-identity/1.0",
    identity,
  });
}
