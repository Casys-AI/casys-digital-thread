/**
 * Pure journal-to-project authority assertion for one admitted SPICE WAL.
 *
 * Compares the sealed WAL identity to persisted project, Thread, and signed
 * MRTR facts. It never asks the current execution-profile catalog to
 * reinterpret a retired runtime and never reopens source bytes.
 */

import type {
  AdmittedSpiceExecutionAttempt,
  AdmittedSpiceExecutionAttemptIdentity,
} from "../../../../ports/out/electrical/spice/admitted-execution-attempt-store.ts";
import { fingerprintAdmittedSpiceExecutionAttemptIdentity } from "../../../../ports/out/electrical/spice/admitted-execution-attempt-store.ts";
import { deriveAdmittedSpiceExecutionRunId } from "../../../../../domain/electrical/spice/admitted/execution-evidence.ts";
import { exactAdmissionArtifact } from "../../../../../domain/electrical/spice/admitted/documentary-thread-evidence.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../../domain/thread/thread-snapshot.ts";
import { EngineeringProjectCommandError } from "../../../project/engineering-project-command-service.ts";
import type { ReviewedAdmittedSpiceAuthority } from "./reopen-reviewed-execution.ts";

export async function assertAdmittedSpiceJournalProjectAuthority(input: {
  readonly attempt: AdmittedSpiceExecutionAttempt;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly authority: ReviewedAdmittedSpiceAuthority;
  readonly basisSnapshot: ThreadSnapshot;
}): Promise<void> {
  const identity = input.attempt.identity;
  const sealedFingerprint = await fingerprintAdmittedSpiceExecutionAttemptIdentity(
    identity,
  );
  if (
    !fingerprintsEqual(input.attempt.attemptFingerprint, sealedFingerprint)
  ) {
    throw mismatch(
      "The admitted SPICE journal fingerprint does not seal its stored identity.",
    );
  }
  if (
    input.attempt.projectId !== identity.projectId ||
    input.attempt.agentRunId !== identity.agentRunId ||
    input.attempt.executionRunId !== identity.executionRunId ||
    input.attempt.preparedAt !== identity.startedAt
  ) {
    throw mismatch(
      "The admitted SPICE journal key differs from its stored identity.",
    );
  }
  const basis = input.run.basis;
  const startedAt = input.run.startedAt;
  const reviewedRunFingerprint = input.run.inputFingerprint;
  const decisionFingerprint = input.authority.decision.inputFingerprint;
  const approvalFingerprint = input.authority.approval.inputFingerprint;
  const derivedExecutionRunId = await deriveAdmittedSpiceExecutionRunId(
    input.project.project.id,
    input.run.id,
  );
  const basisFingerprint = await sha256Fingerprint(input.basisSnapshot);
  if (
    identity.projectId !== input.project.project.id ||
    identity.agentRunId !== input.run.id ||
    identity.executionRunId !== derivedExecutionRunId ||
    !startedAt || identity.startedAt !== startedAt ||
    basis?.kind !== "thread-snapshot" ||
    deterministicJson(identity.basis) !== deterministicJson(basis) ||
    !fingerprintsEqual(identity.basisFingerprint, basisFingerprint) ||
    !reviewedRunFingerprint ||
    !fingerprintsEqual(identity.reviewedRunFingerprint, reviewedRunFingerprint) ||
    identity.decision.id !== input.authority.decision.id ||
    !decisionFingerprint ||
    !fingerprintsEqual(identity.decision.inputFingerprint, decisionFingerprint) ||
    identity.approval.id !== input.authority.approval.id ||
    !approvalFingerprint ||
    !fingerprintsEqual(identity.approval.inputFingerprint, approvalFingerprint) ||
    deterministicJson(identity.admission) !==
      deterministicJson(input.authority.admission)
  ) {
    throw mismatch(
      "The admitted SPICE journal does not seal the exact reviewed project authority.",
    );
  }
  try {
    exactAdmissionArtifact(
      input.basisSnapshot,
      input.authority.admission.admissionArtifact.id,
      input.authority.admission.admissionArtifact.fingerprint,
    );
  } catch (error) {
    throw mismatch(
      error instanceof Error ? error.message : String(error),
    );
  }
  assertStoredIsolatedRequest(identity);
}

function assertStoredIsolatedRequest(
  identity: AdmittedSpiceExecutionAttemptIdentity,
): void {
  const request = identity.isolatedRequest;
  const admission = identity.admission;
  const profile = identity.executionProfile;
  if (
    request.schemaVersion !== ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA ||
    request.producerGeneration !== 0 ||
    request.runId !== identity.executionRunId ||
    request.sourceSha256 !==
      admission.compilation.source.sourceFingerprint.digest ||
    !isolatedCodeRefsEqual(request.profile, profile.executionProfile) ||
    !isolatedCodeRefsEqual(request.policy, profile.isolationPolicy) ||
    !isolatedCodeOutputManifestsEqual(request.outputs, profile.outputManifest)
  ) {
    throw mismatch(
      "The admitted SPICE journal isolated request does not seal its stored run identity.",
    );
  }
  if (
    admission.compilation.profile.id !== profile.compilationProfile.id ||
    admission.compilation.profile.version !== profile.compilationProfile.version ||
    !fingerprintsEqual(
      admission.compilation.profile.fingerprint,
      profile.compilationProfileFingerprint,
    ) ||
    admission.execution.profile.id !== profile.executionProfile.id ||
    admission.execution.profile.version !== profile.executionProfile.version ||
    !fingerprintsEqual(
      admission.execution.profile.fingerprint,
      profile.profileFingerprint,
    ) ||
    !isolatedCodeRefsEqual(
      admission.execution.isolationPolicy,
      profile.isolationPolicy,
    ) ||
    deterministicJson(admission.execution.runtimeBackend) !==
      deterministicJson(profile.runtimeBackend) ||
    !fingerprintsEqual(
      admission.execution.runtime.imageDigest,
      profile.runtime.imageDigest,
    ) ||
    admission.execution.runtime.isolationClass !==
      profile.runtime.isolationClass ||
    deterministicJson(admission.execution.runtime.limits) !==
      deterministicJson(profile.runtime.requestedLimits) ||
    deterministicJson(admission.execution.runtime.limitAssurance) !==
      deterministicJson(profile.runtime.limitAssurance) ||
    deterministicJson(admission.execution.outputValidator) !==
      deterministicJson(profile.outputValidator) ||
    !isolatedCodeOutputManifestsEqual(
      admission.execution.outputs,
      profile.outputManifest,
    ) ||
    admission.execution.minimumDestructionAssurance !==
      profile.minimumDestructionAssurance
  ) {
    throw mismatch(
      "The admitted SPICE journal isolated request does not seal its stored run identity.",
    );
  }
}

function mismatch(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
