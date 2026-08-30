/**
 * Builds one content-addressed Chrono qualification attestation from a
 * stopped + qualified + recorded WAL attempt. It is not a revoke surface.
 */

import {
  type CapabilityRuntimeBindingQualificationAttestation,
  type CapabilityRuntimeQualificationEvidenceReference,
  capabilityRuntimeQualificationStoppedOutcomeId,
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeQualificationCandidate } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import {
  type CapabilityRuntimeQualificationAttempt,
  fingerprintCapabilityRuntimeQualificationAttempt,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";

export async function createChronoRuntimeQualificationAttestation(input: {
  readonly attempt: Extract<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "stopped" }
  >;
  readonly candidate: CapabilityRuntimeQualificationCandidate;
  readonly spec: CapabilityRuntimeQualificationSpecification;
}): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  const { attempt, candidate, spec } = input;
  if (attempt.phase !== "stopped") {
    throw new TypeError(
      "Chrono qualification attestation requires a stopped recorded attempt.",
    );
  }
  if (attempt.outcome.status !== "qualified" || attempt.outcome.basis !== "recorded") {
    throw new TypeError(
      "Chrono qualification attestation requires a recorded qualified outcome.",
    );
  }
  if (
    attempt.runtimeStopProof.schemaVersion !==
      CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA
  ) {
    throw new TypeError(
      "Chrono qualification attestation requires a host stop proof.",
    );
  }
  if (!fingerprintsEqual(attempt.candidate.fingerprint, candidate.fingerprint)) {
    throw new TypeError(
      "Chrono qualification attestation candidate fingerprint does not match.",
    );
  }
  if (
    attempt.candidate.id !== spec.candidate.id ||
    !fingerprintsEqual(attempt.candidate.fingerprint, spec.candidate.fingerprint) ||
    !fingerprintsEqual(attempt.sourceFingerprint, spec.sourceFingerprint) ||
    !fingerprintsEqual(attempt.loweringFingerprint, spec.loweringFingerprint) ||
    !fingerprintsEqual(attempt.caseFingerprint, spec.caseFingerprint) ||
    !fingerprintsEqual(attempt.qualificationSpecFingerprint, spec.fingerprint)
  ) {
    throw new TypeError(
      "Chrono qualification attestation requires the exact current specification.",
    );
  }
  const body = {
    schemaVersion: "capability-runtime-binding-qualification-attestation/1.1" as const,
    state: "qualified" as const,
    recordedAt: attempt.outcome.recordedAt,
    binding: candidate.binding,
    selector: candidate.selector,
    contract: candidate.contract,
    profile: candidate.profile,
    unit: candidate.unit,
    material: candidate.material,
    targetPlatform: candidate.targetPlatform,
    mode: candidate.mode,
    launchGroup: candidate.launchGroup,
    observedHost: attempt.observedHost,
    fixture: {
      id: candidate.fixture.id,
      fingerprint: candidate.fixture.sourceFingerprint,
    },
    qualificationSpec: {
      id: spec.id,
      fingerprint: spec.fingerprint,
    },
    outcome: await capabilityRuntimeQualificationStoppedOutcomeReference(attempt),
  };
  return await createCapabilityRuntimeBindingQualificationAttestation({
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
      body,
    ),
  });
}

export async function capabilityRuntimeQualificationStoppedOutcomeReference(
  attempt: Extract<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "stopped" | "attested" }
  >,
): Promise<CapabilityRuntimeQualificationEvidenceReference> {
  const stoppedFingerprint = await fingerprintCapabilityRuntimeQualificationAttempt(
    stoppedQualificationAttemptFrom(attempt),
  );
  return {
    id: capabilityRuntimeQualificationStoppedOutcomeId(stoppedFingerprint),
    fingerprint: stoppedFingerprint,
  };
}

export function stoppedQualificationAttemptFrom(
  attempt: Extract<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "stopped" | "attested" }
  >,
): Extract<CapabilityRuntimeQualificationAttempt, { readonly phase: "stopped" }> {
  return {
    schemaVersion: attempt.schemaVersion,
    candidate: attempt.candidate,
    observedHost: attempt.observedHost,
    reviewFingerprint: attempt.reviewFingerprint,
    requestId: attempt.requestId,
    sourceFingerprint: attempt.sourceFingerprint,
    loweringFingerprint: attempt.loweringFingerprint,
    caseFingerprint: attempt.caseFingerprint,
    runRequestFingerprint: attempt.runRequestFingerprint,
    qualificationSpecFingerprint: attempt.qualificationSpecFingerprint,
    preparedAt: attempt.preparedAt,
    runtimeStartFingerprint: attempt.runtimeStartFingerprint,
    caseSha256: attempt.caseSha256,
    caseUri: attempt.caseUri,
    outcome: attempt.outcome,
    runtimeStopProof: attempt.runtimeStopProof,
    phase: "stopped",
  };
}
