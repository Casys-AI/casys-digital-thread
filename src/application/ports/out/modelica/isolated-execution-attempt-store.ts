/** Durable recovery journal for one locally isolated Modelica execution. */

import type { ModelicaIsolatedExecutionProfile } from "./isolated-execution-profile.ts";
import type {
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeOutputDeclaration,
  IsolatedCodeOutputValidationRejection,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedOutputProducerGenerationAdvance,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import type {
  ModelicaIsolatedEvidence,
  ModelicaIsolatedInputBundle,
} from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ModelicaMicrosandboxQualificationReference } from "../../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";

export interface ModelicaIsolatedBundleDescriptor
  extends Omit<ModelicaIsolatedInputBundle, "inputs"> {
  readonly byteCount: number;
  readonly fingerprint: ContentFingerprint;
  readonly inputs: readonly Omit<
    ModelicaIsolatedInputBundle["inputs"][number],
    "text"
  >[];
}

export interface ModelicaIsolatedExecutionAttemptIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  /** Exact MRTR-sealed project-run input; this operation has no ROP2 plan. */
  readonly reviewedRunFingerprint: ContentFingerprint;
  readonly bundle: ModelicaIsolatedBundleDescriptor;
  readonly executionProfile: ModelicaIsolatedExecutionProfile;
  readonly runtimeQualification: ModelicaMicrosandboxQualificationReference;
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

export interface ModelicaIsolatedExecutionAttemptKey {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ContentFingerprint;
}

export interface ModelicaIsolatedExecutionCaptureReference {
  readonly schemaVersion: "modelica-qualified-kit-execution-capture-reference/1.0";
  readonly uri: string;
  readonly fingerprint: ContentFingerprint;
}

export interface ModelicaIsolatedExecutionDispatch {
  readonly dispatchCount: 1 | 2;
  readonly producerGeneration: 0 | 1;
  readonly dispatchedAt: string;
}

export type ModelicaIsolatedProvenDestruction = Extract<
  IsolatedCodeExecutionReceiptRecord["destruction"],
  { readonly status: "proven" }
>;

export interface ModelicaIsolatedExecutionGenerationRecovery {
  readonly generationZeroDestruction: ModelicaIsolatedProvenDestruction;
  readonly advance: IsolatedOutputProducerGenerationAdvance;
}

interface AttemptBase extends ModelicaIsolatedExecutionAttemptKey {
  readonly schemaVersion: "modelica-qualified-kit-execution-attempt/1.0";
  readonly identity: ModelicaIsolatedExecutionAttemptIdentity;
  readonly preparedAt: string;
}

export type ModelicaIsolatedExecutionAttempt =
  | (AttemptBase & { readonly phase: "prepared" })
  | (AttemptBase & {
    readonly phase: "dispatching";
    readonly dispatch: ModelicaIsolatedExecutionDispatch;
    readonly generationRecovery: ModelicaIsolatedExecutionGenerationRecovery | null;
  })
  | (AttemptBase & {
    readonly phase: "generation-zero-cleaned";
    readonly dispatch: ModelicaIsolatedExecutionDispatch & {
      readonly dispatchCount: 1;
      readonly producerGeneration: 0;
    };
    readonly generationZeroDestruction: ModelicaIsolatedProvenDestruction;
  })
  | (AttemptBase & {
    readonly phase: "output-published";
    readonly dispatch: ModelicaIsolatedExecutionDispatch;
    readonly generationRecovery: ModelicaIsolatedExecutionGenerationRecovery | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  })
  | (AttemptBase & {
    readonly phase: "evidence-persisted";
    readonly dispatch: ModelicaIsolatedExecutionDispatch;
    readonly generationRecovery: ModelicaIsolatedExecutionGenerationRecovery | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly evidence: ModelicaIsolatedEvidence;
    readonly capture: ModelicaIsolatedExecutionCaptureReference;
  })
  | (AttemptBase & {
    readonly phase: "completed";
    readonly dispatch: ModelicaIsolatedExecutionDispatch;
    readonly generationRecovery: ModelicaIsolatedExecutionGenerationRecovery | null;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    readonly evidence: ModelicaIsolatedEvidence;
    readonly capture: ModelicaIsolatedExecutionCaptureReference;
  })
  | (AttemptBase & {
    readonly phase: "output-validation-rejected";
    readonly dispatch: ModelicaIsolatedExecutionDispatch;
    readonly generationRecovery: ModelicaIsolatedExecutionGenerationRecovery | null;
    readonly outputValidationRejection: {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: ModelicaIsolatedProvenDestruction;
    };
  });

export interface ModelicaIsolatedExecutionAttemptStore {
  read(
    projectId: string,
    agentRunId: string,
  ): Promise<ModelicaIsolatedExecutionAttempt | undefined>;
  prepare(
    identity: ModelicaIsolatedExecutionAttemptIdentity,
    preparedAt: string,
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markDispatching(
    input: ModelicaIsolatedExecutionAttemptKey & { readonly dispatchedAt: string },
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markGenerationZeroCleaned(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly destruction: ModelicaIsolatedProvenDestruction;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markRedispatching(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly advance: IsolatedOutputProducerGenerationAdvance;
      readonly dispatchedAt: string;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markOutputPublished(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markEvidencePersisted(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly evidence: ModelicaIsolatedEvidence;
      readonly capture: ModelicaIsolatedExecutionCaptureReference;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markCompleted(
    input: ModelicaIsolatedExecutionAttemptKey,
  ): Promise<ModelicaIsolatedExecutionAttempt>;
  markOutputValidationRejected(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly observation: IsolatedCodeOutputValidationRejection;
      readonly destruction: ModelicaIsolatedProvenDestruction;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt>;
}

export async function fingerprintModelicaIsolatedAttemptIdentity(
  identity: ModelicaIsolatedExecutionAttemptIdentity,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: "modelica-qualified-kit-execution-attempt-identity/1.0",
    identity,
  });
}
