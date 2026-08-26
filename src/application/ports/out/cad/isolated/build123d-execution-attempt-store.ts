import type {
  Build123dExecutionBasis,
  Build123dExecutionDraftReference,
} from "../../../../../domain/cad/isolated/build123d-execution-evidence.ts";
import type { Build123dExecutionAdmission } from "../../../../../domain/cad/isolated/build123d-execution-proposal.ts";
import type {
  IsolatedCodeExecutionReceipt,
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeOutputDeclaration,
  IsolatedCodeOutputValidationRejection,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedOutputProducerGenerationAdvance,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import { sha256Fingerprint } from "../../../../../domain/kernel/deterministic-json.ts";
import type { Build123dExecutionProfile } from "./build123d-execution-profile-catalog.ts";
import type { TechnicalCompilationDraftReference } from "../../compile/admission/technical-compilation-draft-store.ts";

export type Build123dExecutionAttemptPhase =
  | "prepared"
  | "dispatching"
  | "output-published"
  | "draft-persisted"
  | "thread-persisted"
  | "completed"
  | "output-validation-rejected";

export type Build123dProvenDestruction = Extract<
  IsolatedCodeExecutionReceipt["destruction"],
  { readonly status: "proven" }
>;

/** Exact reviewed facts whose fingerprint grants one isolated dispatch. */
export interface Build123dExecutionAttemptIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly basis: Build123dExecutionBasis;
  readonly run: {
    readonly workItemId: string;
    readonly inputFingerprint: ContentFingerprint;
    readonly startedAt: string;
  };
  readonly decision: {
    readonly id: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly approval: {
    readonly id: string;
    readonly inputFingerprint: ContentFingerprint;
    readonly fingerprint: ContentFingerprint;
  };
  readonly admission: Build123dExecutionAdmission;
  readonly technicalAdmission: {
    readonly trustedRunId: string;
    readonly decisionId: string;
    readonly sealedAt: string;
    readonly draftReference: TechnicalCompilationDraftReference;
    readonly documentFingerprint: ContentFingerprint;
    readonly projectionFingerprint: ContentFingerprint;
    readonly sourceFingerprint: ContentFingerprint;
  };
  readonly executionProfile: Build123dExecutionProfile;
  /** Exact byte-free isolated request. Source bytes never enter the WAL. */
  readonly isolatedRequest: {
    readonly schemaVersion: "isolated-code-execution-request/1.0";
    readonly runId: string;
    readonly producerGeneration: 0;
    readonly profile: IsolatedCodeProfileRef;
    readonly sourceSha256: string;
    readonly policy: IsolatedCodePolicyRef;
    readonly outputs: readonly IsolatedCodeOutputDeclaration[];
  };
  readonly document: Build123dExecutionAdmission["compilation"]["document"];
  readonly projection: Build123dExecutionAdmission["compilation"]["projection"];
  readonly source: Build123dExecutionAdmission["compilation"]["source"];
  readonly profile: Build123dExecutionAdmission["execution"]["profile"];
  readonly output: Build123dExecutionAdmission["execution"]["output"];
}

export interface Build123dExecutionAttemptKey {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ContentFingerprint;
}

export interface Build123dExecutionThreadEvidence {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

/** Durable dispatch facts; a second dispatch is a one-shot authorization. */
export type Build123dExecutionDispatch =
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
      readonly recoveryDestruction: IsolatedCodeExecutionReceipt["destruction"];
    };
  };

interface Build123dExecutionAttemptBase extends Build123dExecutionAttemptKey {
  readonly schemaVersion: "build123d-execution-attempt/1.0";
  readonly identity: Build123dExecutionAttemptIdentity;
  readonly preparedAt: string;
}

export type Build123dExecutionAttempt =
  | (Build123dExecutionAttemptBase & { readonly phase: "prepared" })
  | (Build123dExecutionAttemptBase & {
    readonly phase: "dispatching";
    readonly dispatch: Build123dExecutionDispatch;
  })
  | (Build123dExecutionAttemptBase & {
    readonly phase: "output-published";
    readonly dispatch: Build123dExecutionDispatch;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  })
  | (Build123dExecutionAttemptBase & {
    readonly phase: "draft-persisted";
    readonly dispatch: Build123dExecutionDispatch;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly draftReference: Build123dExecutionDraftReference;
  })
  | (Build123dExecutionAttemptBase & {
    readonly phase: "thread-persisted" | "completed";
    readonly dispatch: Build123dExecutionDispatch;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly draftReference: Build123dExecutionDraftReference;
    readonly threadEvidence: Build123dExecutionThreadEvidence;
  })
  | (Build123dExecutionAttemptBase & {
    readonly phase: "output-validation-rejected";
    readonly dispatch: Build123dExecutionDispatch;
    readonly outputValidationRejection: {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: Build123dProvenDestruction;
    };
  });

/**
 * A caller may execute code only for `consumed-now`. If the durable write was
 * acknowledged ambiguously, replay yields `already-consumed` and must stop.
 */
export interface Build123dExecutionRedispatchConsumption {
  readonly outcome: "consumed-now" | "already-consumed";
  readonly attempt: Build123dExecutionAttempt;
}

/** Durable monotone journal; it owns identity and transition validation. */
export interface Build123dExecutionAttemptStore {
  read(
    projectId: string,
    agentRunId: string,
  ): Promise<Build123dExecutionAttempt | undefined>;
  prepare(
    identity: Build123dExecutionAttemptIdentity,
  ): Promise<Build123dExecutionAttempt>;
  markDispatching(
    input: Build123dExecutionAttemptKey & { readonly dispatchedAt: string },
  ): Promise<Build123dExecutionAttempt>;
  authorizeRedispatch(
    input: Build123dExecutionAttemptKey & {
      readonly recoveryDestruction: IsolatedCodeExecutionReceipt["destruction"];
      readonly generationAdvance: IsolatedOutputProducerGenerationAdvance;
    },
  ): Promise<Build123dExecutionAttempt>;
  consumeRedispatch(
    input: Build123dExecutionAttemptKey,
  ): Promise<Build123dExecutionRedispatchConsumption>;
  markOutputPublished(
    input: Build123dExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<Build123dExecutionAttempt>;
  markDraftPersisted(
    input: Build123dExecutionAttemptKey & {
      readonly draftReference: Build123dExecutionDraftReference;
    },
  ): Promise<Build123dExecutionAttempt>;
  markThreadPersisted(
    input: Build123dExecutionAttemptKey & {
      readonly threadEvidence: Build123dExecutionThreadEvidence;
    },
  ): Promise<Build123dExecutionAttempt>;
  markCompleted(
    input: Build123dExecutionAttemptKey,
  ): Promise<Build123dExecutionAttempt>;
  markOutputValidationRejected(
    input: Build123dExecutionAttemptKey & {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: Build123dProvenDestruction;
    },
  ): Promise<Build123dExecutionAttempt>;
}

/** The single fingerprint preimage shared by executor and durable store. */
export async function fingerprintBuild123dExecutionAttemptIdentity(
  identity: Build123dExecutionAttemptIdentity,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: "build123d-execution-attempt-identity/1.0",
    identity,
  });
}
