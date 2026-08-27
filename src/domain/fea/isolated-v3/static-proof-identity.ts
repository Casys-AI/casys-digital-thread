/**
 * Pure projected identity checks for isolated static FEA `@3`.
 *
 * The adapter projects already-reopened ROP, proof, STEP, bundle and evidence
 * values. This module never imports ResolvedRunPlanExecutionAuthorization,
 * orchestration, or adapters.
 */

import {
  deterministicJson,
  fingerprintsEqual,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export interface StaticProofArtifactIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface StaticProofDocumentIdentity extends StaticProofArtifactIdentity {
  readonly producerServerId: string;
  readonly producerTool: string;
  readonly inputArtifactIds: readonly string[];
}

export interface StaticProofCaseIdentity {
  readonly projectId: string;
  readonly subjectId: string;
  readonly proofCaseId: string;
  readonly trustedRunId: string;
  readonly expectedCadSha256: string;
  readonly expectedCadBytes: number;
  readonly geometry: StaticProofArtifactIdentity;
  readonly requirements: StaticProofArtifactIdentity;
  readonly step: StaticProofArtifactIdentity & { readonly bytes: number };
}

export interface StaticProofAuthorityIdentity {
  readonly projectId: string;
  readonly subjectId: string;
  readonly actionProofCaseId: string;
  readonly actionProofCaseFingerprint: ContentFingerprint;
  readonly expectedProofProducerServerId: string;
  readonly expectedProofProducerTool: string;
}

export interface StaticProofProfileIdentity {
  readonly actionProfileFingerprint: ContentFingerprint;
  readonly activeProfileFingerprint: ContentFingerprint;
  readonly executorId: string;
  readonly expectedExecutorId: string;
  readonly contractId: string;
  readonly expectedContractId: string;
  readonly contractVersion: string;
  readonly expectedContractVersion: string;
  readonly loweringId: string;
  readonly expectedLoweringId: string;
  readonly loweringVersion: string;
  readonly expectedLoweringVersion: string;
}

export interface StaticProofStepBytesIdentity {
  readonly stepByteLength: number;
  readonly sourceByteCount: number;
  readonly proofStepBytes: number;
  readonly stepSha256: string;
  readonly geometryDigest: string;
}

export interface StaticProofPreparedEvidenceIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly bundleFingerprint: ContentFingerprint;
  readonly proofFingerprint: ContentFingerprint;
  readonly executionProfileFingerprint: ContentFingerprint;
  readonly planFingerprint: ContentFingerprint;
  readonly requestId: string;
  readonly stepByteCount: number;
  readonly stepSha256: string;
}

export interface StaticProofEvidenceIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly bundleFingerprint: ContentFingerprint;
  readonly proofFingerprint: ContentFingerprint;
  readonly executionProfileFingerprint: ContentFingerprint;
  readonly planFingerprint: ContentFingerprint;
  readonly requestId: string;
  readonly receiptRunId: string;
  readonly receiptSourceSha256: string;
  readonly resultInputByteCount: number;
  readonly resultInputSha256: string;
}

export interface StaticProofAttemptIdentity {
  readonly projectId: string;
  readonly runId: string;
  readonly planSha256: string;
  readonly executionRunId: string;
  readonly bundleSha256: string;
  readonly profileSha256: string;
  readonly hasEvidenceSha256: boolean;
}

export function assertStaticProofCrossAttests(
  authority: StaticProofAuthorityIdentity,
  proof: StaticProofCaseIdentity,
  proofArtifact: StaticProofDocumentIdentity,
  step: StaticProofArtifactIdentity,
  geometry: StaticProofArtifactIdentity,
  requirements: StaticProofArtifactIdentity,
): void {
  const ids = [proof.geometry.id, proof.requirements.id, proof.step.id].sort();
  if (
    proof.projectId !== authority.projectId ||
    proof.subjectId !== authority.subjectId ||
    proof.proofCaseId !== authority.actionProofCaseId ||
    !fingerprintsEqual(
      proofArtifact.fingerprint,
      authority.actionProofCaseFingerprint,
    ) ||
    proof.trustedRunId !== proofArtifact.producerRunId ||
    proofArtifact.producerServerId !== authority.expectedProofProducerServerId ||
    proofArtifact.producerTool !== authority.expectedProofProducerTool ||
    geometry.id !== proof.geometry.id ||
    !fingerprintsEqual(geometry.fingerprint, proof.geometry.fingerprint) ||
    geometry.producerRunId !== proof.geometry.producerRunId ||
    step.id !== proof.step.id ||
    !fingerprintsEqual(step.fingerprint, proof.step.fingerprint) ||
    step.producerRunId !== proof.step.producerRunId ||
    step.fingerprint.digest !== proof.expectedCadSha256 ||
    proof.step.bytes !== proof.expectedCadBytes ||
    requirements.id !== proof.requirements.id ||
    !fingerprintsEqual(requirements.fingerprint, proof.requirements.fingerprint) ||
    requirements.producerRunId !== proof.requirements.producerRunId ||
    deterministicJson([...proofArtifact.inputArtifactIds].sort()) !==
      deterministicJson(ids)
  ) {
    throw new TypeError(
      "The local CalculiX proof, geometry and requirements do not cross-attest.",
    );
  }
}

export function assertStaticProofProfileBinding(
  identity: StaticProofProfileIdentity,
): void {
  if (
    !fingerprintsEqual(
      identity.actionProfileFingerprint,
      identity.activeProfileFingerprint,
    ) ||
    identity.executorId !== identity.expectedExecutorId ||
    identity.contractId !== identity.expectedContractId ||
    identity.contractVersion !== identity.expectedContractVersion ||
    identity.loweringId !== identity.expectedLoweringId ||
    identity.loweringVersion !== identity.expectedLoweringVersion
  ) {
    throw new TypeError(
      "The resolved CalculiX plan does not bind the exact active local profile.",
    );
  }
}

export function assertCanonicalStepBytes(
  identity: StaticProofStepBytesIdentity,
): void {
  if (
    identity.stepByteLength !== identity.sourceByteCount ||
    identity.stepByteLength !== identity.proofStepBytes ||
    identity.stepSha256 !== identity.geometryDigest
  ) {
    throw new TypeError(
      "Canonical STEP bytes do not match the sealed local CalculiX source.",
    );
  }
}

export function assertStaticProofEvidenceMatches(
  evidence: StaticProofEvidenceIdentity,
  prepared: StaticProofPreparedEvidenceIdentity,
): void {
  if (
    evidence.projectId !== prepared.projectId ||
    evidence.agentRunId !== prepared.agentRunId ||
    evidence.executionRunId !== prepared.executionRunId ||
    !fingerprintsEqual(evidence.bundleFingerprint, prepared.bundleFingerprint) ||
    !fingerprintsEqual(evidence.proofFingerprint, prepared.proofFingerprint) ||
    !fingerprintsEqual(
      evidence.executionProfileFingerprint,
      prepared.executionProfileFingerprint,
    ) ||
    !fingerprintsEqual(evidence.planFingerprint, prepared.planFingerprint) ||
    evidence.requestId !== prepared.requestId ||
    evidence.receiptRunId !== prepared.executionRunId ||
    evidence.receiptSourceSha256 !== prepared.bundleFingerprint.digest ||
    evidence.resultInputByteCount !== prepared.stepByteCount ||
    evidence.resultInputSha256 !== prepared.stepSha256
  ) {
    throw new TypeError(
      "The isolated CalculiX evidence does not cross-bind the exact plan, profile, proof, bundle and STEP.",
    );
  }
}

export function assertStaticProofAttemptMatches(
  attempt: StaticProofAttemptIdentity,
  prepared: StaticProofPreparedEvidenceIdentity,
): void {
  if (
    attempt.projectId !== prepared.projectId ||
    attempt.runId !== prepared.agentRunId ||
    attempt.planSha256 !== prepared.planFingerprint.digest ||
    attempt.executionRunId !== prepared.executionRunId ||
    attempt.bundleSha256 !== prepared.bundleFingerprint.digest ||
    attempt.profileSha256 !== prepared.executionProfileFingerprint.digest ||
    !attempt.hasEvidenceSha256
  ) {
    throw new TypeError(
      "The isolated CalculiX product WAL does not bind the exact completed plan, profile and bundle.",
    );
  }
}
