/**
 * Pure identity binding and completed-replay verification for isolated
 * static FEA `@3`.
 *
 * Projects already-reopened ROP, sealed proof, STEP, evidence and WAL values,
 * then asserts the rematerialized Thread successor and project evidence refs.
 * It has no snapshot store, project revision store, CAS, clock, CalculiX
 * runner, SysON client, or WAL mutation. The adapter still owns those I/O
 * envelopes and the recovery/dispatch choice.
 */

import type { CalculixIsolatedExecutionProfile } from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { EngineeringProjectCommandError } from "../../project/engineering-project-command-service.ts";
import type { CalculixIsolatedExecutionEvidence } from "../../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import type { SealedStaticProofCapture } from "../../../../domain/fea/isolated-v3/sealed-static-proof-capture.ts";
import {
  assertCanonicalStepBytes,
  assertStaticProofAttemptMatches,
  assertStaticProofCrossAttests,
  assertStaticProofEvidenceMatches,
  assertStaticProofProfileBinding,
  type StaticProofPreparedEvidenceIdentity,
} from "../../../../domain/fea/isolated-v3/static-proof-identity.ts";
import {
  assertExactCompletedStaticProofProjectBinding,
  assertExactStaticProofLocalArtifacts,
  exactStaticProofEvidenceRefs,
} from "../../../../domain/fea/isolated-v3/static-proof-thread-evidence.ts";
import type {
  ResolvedCalculixIsolatedStaticStructuralAction,
  ResolvedOperationPlanV2,
} from "../../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";

export type { StaticProofPreparedEvidenceIdentity };

const STATIC_PROOF_LOCAL_TOOL = "verify.run-fea-static-proof@3" as const;
const STATIC_PROOF_SEAL_TOOL = "verify.seal-proof-case@1" as const;

export interface IsolatedStaticProofAttemptBinding {
  readonly projectId: string;
  readonly runId: string;
  readonly planSha256: string;
  readonly executionRunId: string;
  readonly bundleSha256: string;
  readonly profileSha256: string;
}

export interface IsolatedStaticProofCompletedAttemptBinding
  extends IsolatedStaticProofAttemptBinding {
  readonly status: "completed";
  readonly snapshot: EngineeringThreadSnapshotRef;
}

export function isolatedStaticProofLocalOperation(
  runId: string,
): ThreadOperationRef {
  return {
    serverId: "digital-thread",
    tool: STATIC_PROOF_LOCAL_TOOL,
    runId,
  };
}

export function requireIsolatedStaticStructuralAction(
  action: ResolvedOperationPlanV2["action"],
): ResolvedCalculixIsolatedStaticStructuralAction {
  if (action.kind !== "isolated-static-structural-analysis") {
    throw invalidTransition(
      "The resolved plan action is not the isolated local CalculiX action.",
    );
  }
  return action;
}

export function isolatedStaticProofPreparedIdentity(input: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly bundle: {
    readonly fingerprint: ContentFingerprint;
    readonly manifest: { readonly proofFingerprint: ContentFingerprint };
  };
  readonly profileFingerprint: ContentFingerprint;
  readonly planFingerprint: ContentFingerprint;
  readonly requestId: string;
  readonly stepByteCount: number;
  readonly stepSha256: string;
}): StaticProofPreparedEvidenceIdentity {
  return {
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    bundleFingerprint: input.bundle.fingerprint,
    proofFingerprint: input.bundle.manifest.proofFingerprint,
    executionProfileFingerprint: input.profileFingerprint,
    planFingerprint: input.planFingerprint,
    requestId: input.requestId,
    stepByteCount: input.stepByteCount,
    stepSha256: input.stepSha256,
  };
}

export function assertIsolatedStaticProofProfileBinding(
  action: ResolvedCalculixIsolatedStaticStructuralAction,
  profile: CalculixIsolatedExecutionProfile,
): void {
  projectIdentity(() =>
    assertStaticProofProfileBinding({
      actionProfileFingerprint: action.executor.profileFingerprint,
      activeProfileFingerprint: profile.profileFingerprint,
      executorId: action.executor.id,
      expectedExecutorId: "casys-local-microsandbox",
      contractId: action.executor.contract.id,
      expectedContractId: "calculix-static-proof-v1",
      contractVersion: action.executor.contract.version,
      expectedContractVersion: "1.0.0",
      loweringId: action.lowering.id,
      expectedLoweringId: profile.lowering.id,
      loweringVersion: action.lowering.version,
      expectedLoweringVersion: profile.lowering.version,
    })
  );
}

export function assertIsolatedStaticProofCrossAttests(input: {
  readonly projectId: string;
  readonly subjectId: string;
  readonly action: ResolvedCalculixIsolatedStaticStructuralAction;
  readonly proof: SealedStaticProofCapture;
  readonly proofArtifact: ThreadArtifact;
  readonly step: ThreadArtifact;
  readonly geometry: ThreadArtifact;
  readonly requirements: ThreadArtifact;
}): void {
  projectIdentity(() =>
    assertStaticProofCrossAttests({
      projectId: input.projectId,
      subjectId: input.subjectId,
      actionProofCaseId: input.action.input.proofCase.id,
      actionProofCaseFingerprint: input.action.input.proofCase.fingerprint,
      expectedProofProducerServerId: "digital-thread",
      expectedProofProducerTool: STATIC_PROOF_SEAL_TOOL,
    }, {
      projectId: input.proof.case.project.id,
      subjectId: input.proof.case.project.subjectId,
      proofCaseId: input.proof.case.id,
      trustedRunId: input.proof.trustedRunId,
      expectedCadSha256: input.proof.case.expectedCadArtifact.sha256,
      expectedCadBytes: input.proof.case.expectedCadArtifact.bytes,
      geometry: input.proof.geometry,
      requirements: input.proof.requirements,
      step: input.proof.step,
    }, {
      id: input.proofArtifact.id,
      fingerprint: input.proofArtifact.fingerprint,
      producerRunId: input.proofArtifact.producer.runId,
      producerServerId: input.proofArtifact.producer.serverId,
      producerTool: input.proofArtifact.producer.tool,
      inputArtifactIds: input.proofArtifact.inputArtifactIds,
    }, {
      id: input.step.id,
      fingerprint: input.step.fingerprint,
      producerRunId: input.step.producer.runId,
    }, {
      id: input.geometry.id,
      fingerprint: input.geometry.fingerprint,
      producerRunId: input.geometry.producer.runId,
    }, {
      id: input.requirements.id,
      fingerprint: input.requirements.fingerprint,
      producerRunId: input.requirements.producer.runId,
    })
  );
}

export function assertIsolatedCanonicalStepBytes(input: {
  readonly stepByteLength: number;
  readonly sourceByteCount: number;
  readonly proofStepBytes: number;
  readonly stepSha256: string;
  readonly geometryDigest: string;
}): void {
  projectIdentity(() => assertCanonicalStepBytes(input));
}

export function assertIsolatedStaticProofEvidenceMatches(
  evidence: CalculixIsolatedExecutionEvidence,
  prepared: StaticProofPreparedEvidenceIdentity,
): void {
  projectIdentity(() =>
    assertStaticProofEvidenceMatches({
      projectId: evidence.projectId,
      agentRunId: evidence.agentRunId,
      executionRunId: evidence.executionRunId,
      bundleFingerprint: evidence.bundleFingerprint,
      proofFingerprint: evidence.proofFingerprint,
      executionProfileFingerprint: evidence.executionProfileFingerprint,
      planFingerprint: evidence.authority.resolvedOperationPlanFingerprint,
      requestId: evidence.result.requestId,
      receiptRunId: evidence.receipt.runId,
      receiptSourceSha256: evidence.receipt.sourceSha256,
      resultInputByteCount: evidence.result.inputArtifact.byteCount,
      resultInputSha256: evidence.result.inputArtifact.sha256,
    }, prepared)
  );
}

export function assertIsolatedStaticProofAttemptMatches<
  T extends IsolatedStaticProofAttemptBinding,
>(
  attempt: T,
  prepared: StaticProofPreparedEvidenceIdentity,
): void {
  projectIdentity(() =>
    assertStaticProofAttemptMatches({
      projectId: attempt.projectId,
      runId: attempt.runId,
      planSha256: attempt.planSha256,
      executionRunId: attempt.executionRunId,
      bundleSha256: attempt.bundleSha256,
      profileSha256: attempt.profileSha256,
      hasEvidenceSha256: "evidenceSha256" in attempt,
    }, prepared)
  );
}

export function requireCompletedIsolatedStaticProofRunWal<
  T extends IsolatedStaticProofAttemptBinding & { readonly status: string },
>(
  attempt: T | undefined,
): T & IsolatedStaticProofCompletedAttemptBinding {
  if (!attempt || attempt.status !== "completed") {
    throw invalidTransition(
      "The completed isolated CalculiX run has no exact completed product WAL.",
    );
  }
  return attempt as T & IsolatedStaticProofCompletedAttemptBinding;
}

export function requireCompletedIsolatedStaticProofWal<
  T extends IsolatedStaticProofAttemptBinding & { readonly status: string },
>(
  attempt: T,
): T & IsolatedStaticProofCompletedAttemptBinding {
  if (attempt.status !== "completed") {
    throw invalidTransition(
      "The isolated CalculiX product WAL is not complete.",
    );
  }
  return attempt as T & IsolatedStaticProofCompletedAttemptBinding;
}

export function assertCompletedIsolatedStaticProofSnapshot(input: {
  readonly persisted: ThreadSnapshot | undefined;
  readonly rematerialized: ThreadSnapshot;
  readonly attemptSnapshot: EngineeringThreadSnapshotRef;
  readonly runId: string;
}): ThreadSnapshot {
  const persisted = input.persisted;
  if (
    !persisted ||
    input.attemptSnapshot.snapshotId !== input.rematerialized.id ||
    input.attemptSnapshot.revision !== input.rematerialized.revision ||
    input.attemptSnapshot.subjectId !== input.rematerialized.subject.id ||
    deterministicJson(persisted) !== deterministicJson(input.rematerialized)
  ) {
    throw invalidTransition(
      "The completed isolated CalculiX ThreadSnapshot is absent or divergent.",
    );
  }
  projectIdentity(() =>
    assertExactStaticProofLocalArtifacts(
      persisted,
      isolatedStaticProofLocalOperation(input.runId),
    )
  );
  return persisted;
}

export function assertCompletedIsolatedStaticProofProjectReference(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
): void {
  const matches = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      "The completed project does not retain the exact isolated CalculiX snapshot reference.",
    );
  }
}

export function assertCompletedIsolatedStaticProofProjectBinding(
  project: EngineeringProjectSnapshot,
  runId: string,
  snapshot: ThreadSnapshot,
): void {
  const run = project.agentRuns.find((item) => item.id === runId);
  if (!run) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Agent run ${runId} does not exist in project ${project.project.id}.`,
    );
  }
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  projectIdentity(() =>
    assertExactCompletedStaticProofProjectBinding({
      runStatus: run.status,
      resultSnapshot: run.resultSnapshot,
      evidenceRefs: run.evidenceRefs,
      workItemStatus: workItem?.status,
      workItemEvidenceRefs: workItem?.evidenceRefs,
      expectedSnapshot: snapshotRef(snapshot),
      expectedEvidenceRefs: exactIsolatedStaticProofEvidenceRefs(
        snapshot,
        runId,
      ),
    })
  );
}

export function exactIsolatedStaticProofEvidenceRefs(
  snapshot: ThreadSnapshot,
  runId: string,
): readonly EngineeringThreadEntityRef[] {
  return projectIdentity(() =>
    exactStaticProofEvidenceRefs(
      snapshot,
      isolatedStaticProofLocalOperation(runId),
    )
  );
}

function snapshotRef(
  snapshot: ThreadSnapshot,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function projectIdentity<T>(fn: () => T): T {
  try {
    return fn();
  } catch (cause) {
    if (cause instanceof TypeError) {
      throw invalidTransition(cause.message);
    }
    throw cause;
  }
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
