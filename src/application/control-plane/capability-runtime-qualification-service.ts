/**
 * Private host-local Chrono runtime qualification. Review, apply and recover
 * only. It is not an MCP operation, Workbench command, project authority or
 * generic qualification engine.
 */

import {
  fingerprintCapabilityRuntimeObservedHost,
  isCanonicalCapabilityRuntimeQualificationStoppedOutcome,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeQualificationCandidate } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import {
  type CapabilityRuntimeQualificationAttempt,
  type CapabilityRuntimeQualificationAttemptIdentity,
  type CapabilityRuntimeQualificationAttemptOutcome,
  createCapabilityRuntimeQualificationAttemptOutcome,
  fingerprintCapabilityRuntimeQualificationAttempt,
  qualificationAttemptIdentityOf,
  qualificationAttemptKeyFor,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeQualificationStartAuthority,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import type {
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeSecretSnapshot,
  CapabilityRuntimeSecretSnapshotResolver,
  CapabilityRuntimeStateObserver,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { PrescribedKinematicsCaseLowerer } from "../ports/out/mechanics/prescribed-kinematics-case-lowerer.ts";
import type {
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
} from "../ports/out/mechanics/prescribed-kinematics-observer.ts";
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";
import {
  createChronoRuntimeQualificationAttestation,
  stoppedQualificationAttemptFrom,
} from "./capability-runtime-qualification-attestation-factory.ts";
import { assertChronoArm64EmulationQualificationReceipt } from "./capability-runtime-qualification-criteria.ts";
import { fingerprintChronoArm64EmulationQualificationCriteria } from "../../domain/capability/runtime/capability-runtime-qualification-criteria.ts";
import { matchesCapabilityRuntimeQualificationCandidate } from "./evaluate-capability-runtime-qualifications.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostEffects,
  CapabilityRuntimeHostObservation,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  assertPrescribedKinematicsLoweredCase,
  assertPrescribedKinematicsRecordBoundToIdentity,
  CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS,
  CHRONO_QUALIFICATION_PROTOCOL,
  fingerprintChronoQualificationProtocol,
  fingerprintPrescribedKinematicsCompleteReceipt,
  PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
  readCompletePrescribedKinematicsReceipt,
} from "../use-cases/mechanics/prescribed-kinematics/prescribed-kinematics-receipt-readback.ts";

export const CHRONO_RUNTIME_QUALIFICATION_LEASE_ID =
  "capability-runtime-qualification-chrono-arm64-emulation-v1" as const;

const LEASE_TTL_MS = 6 * 60 * 60 * 1_000;
export class CapabilityRuntimeQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeQualificationError";
  }
}

export interface CapabilityRuntimeQualificationReview {
  readonly kind: "qualify-apply";
  readonly candidate: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly binding: CapabilityRuntimeQualificationCandidate["binding"];
  readonly selector: CapabilityRuntimeQualificationCandidate["selector"];
  readonly contract: CapabilityRuntimeQualificationCandidate["contract"];
  readonly profile: CapabilityRuntimeQualificationCandidate["profile"];
  readonly unit: CapabilityRuntimeQualificationCandidate["unit"];
  readonly material: CapabilityRuntimeQualificationCandidate["material"];
  readonly launchGroup: CapabilityRuntimeQualificationCandidate["launchGroup"];
  readonly observedHost: {
    readonly identityFingerprint: ContentFingerprint;
    readonly platform: "linux/arm64";
    readonly fingerprint: ContentFingerprint;
  };
  readonly targetPlatform: "linux/amd64";
  readonly mode: "emulated";
  readonly fixture: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly sourceFingerprint: ContentFingerprint;
  readonly loweringFingerprint: ContentFingerprint;
  readonly caseFingerprint: ContentFingerprint;
  readonly protocolFingerprint: ContentFingerprint;
  readonly criteriaFingerprint: ContentFingerprint;
  readonly runRequestFingerprint: ContentFingerprint;
  readonly qualificationSpec: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly policy: { readonly chronoBindingDisabled: false };
  readonly adminLock: {
    readonly unit: {
      readonly id: string;
      readonly version: string;
      readonly manifestFingerprint: ContentFingerprint;
      readonly desired: "inactive" | "active";
    } | null;
  };
  readonly hostEffects: CapabilityRuntimeHostEffects;
  readonly secretSlots: readonly {
    readonly slot: string;
    readonly availability: "available" | "unavailable" | "unknown";
  }[];
  readonly attestations: {
    readonly qualified: readonly ContentFingerprint[];
    readonly revoked: readonly ContentFingerprint[];
  };
  readonly requestId: string;
  readonly reviewFingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeQualificationApplyResult {
  readonly kind: "qualify-result";
  readonly status: "qualified" | "failed" | "unavailable";
  readonly phase: CapabilityRuntimeQualificationAttempt["phase"];
  readonly reviewFingerprint: ContentFingerprint;
  readonly outcome: CapabilityRuntimeQualificationAttemptOutcome | null;
  readonly attestationFingerprint: ContentFingerprint | null;
}

export interface CapabilityRuntimeQualificationServiceOptions {
  readonly catalog: CapabilityRuntimeCatalog;
  readonly candidates: readonly CapabilityRuntimeQualificationCandidate[];
  readonly specs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly policy: { read(): Promise<CapabilityRuntimeAdminPolicy> };
  readonly lock: { read(): Promise<CapabilityRuntimeAdminLock> };
  readonly hostObservation: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly attestations: CapabilityRuntimeQualificationAttestationStore;
  readonly attempts: CapabilityRuntimeQualificationAttemptStore;
  readonly launchGroups: CapabilityRuntimeLaunchGroupRegistry;
  readonly groups: CapabilityRuntimeLaunchGroupSupervisor;
  readonly states: CapabilityRuntimeStateObserver;
  readonly secrets: CapabilityRuntimeSecretSnapshotResolver;
  readonly createObserver: (
    snapshot: CapabilityRuntimeSecretSnapshot,
  ) => PrescribedKinematicsObserver;
  readonly lowerer: PrescribedKinematicsCaseLowerer;
  readonly now?: () => string;
}

export class CapabilityRuntimeQualificationService {
  readonly #now: () => string;

  constructor(private readonly options: CapabilityRuntimeQualificationServiceOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async review(candidateId: string): Promise<CapabilityRuntimeQualificationReview> {
    return await this.#composeReview(candidateId);
  }

  async apply(
    candidateId: string,
    expectedReviewFingerprint: ContentFingerprint,
    confirm: boolean,
  ): Promise<CapabilityRuntimeQualificationApplyResult> {
    requireConfirm(confirm);
    const review = await this.#composeReview(candidateId);
    assertExactReview(review.reviewFingerprint, expectedReviewFingerprint);
    const identity = await this.#identityFromReview(review);
    return await this.#continue(review.candidate.id, identity, {
      allowStart: true,
      allowDispatch: true,
      review,
    });
  }

  async recover(
    candidateId: string,
  ): Promise<CapabilityRuntimeQualificationApplyResult> {
    const candidate = this.#candidate(candidateId);
    const observedHost = await this.#observedHost();
    const spec = this.#spec(candidate);
    const current = await this.options.attempts.read({
      candidateId: candidate.id,
      candidateFingerprint: candidate.fingerprint,
      observedHostFingerprint: observedHost.fingerprint,
      qualificationSpecFingerprint: spec.fingerprint,
    });
    if (!current) {
      throw unavailable(
        "Capability runtime qualification recovery requires an existing WAL " +
          "attempt.",
      );
    }
    const identity = await qualificationAttemptIdentityOf(current);
    return await this.#continue(candidate.id, identity, {
      allowStart: false,
      allowDispatch: current.phase === "prepared" || current.phase === "active" ||
        current.phase === "case-submitted",
    });
  }

  async #continue(
    candidateId: string,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    options: {
      readonly allowStart: boolean;
      readonly allowDispatch: boolean;
      readonly review?: CapabilityRuntimeQualificationReview;
    },
  ): Promise<CapabilityRuntimeQualificationApplyResult> {
    const candidate = this.#candidate(candidateId);
    await this.#assertCatalogStillExact(candidate);
    await this.#assertHostMatchesIdentity(identity);
    const reviewFingerprint = options.review?.reviewFingerprint ??
      identity.reviewFingerprint;
    let attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(identity),
    );
    if (await this.#hasExactRevocation(candidate, identity)) {
      return await this.#finishRevoked(candidate, identity, attempt);
    }
    const existingAttestation = await this.#matchingQualifiedAttestation(
      candidate,
      identity,
      attempt,
    );
    if (existingAttestation) {
      if (
        attempt &&
        attempt.phase === "stopped" &&
        attempt.outcome.status === "qualified" &&
        attempt.outcome.basis === "recorded"
      ) {
        // append succeeded, WAL still stopped: continue crash-idempotent attest.
      } else if (attempt && attempt.phase !== "attested") {
        throw unavailable(
          "Capability runtime qualification attestation already exists for " +
            "this host without a matching attested WAL.",
        );
      }
      if (!attempt || attempt.phase === "attested") {
        if (attempt?.phase === "attested") {
          await this.#assertStoredAttestation(candidate, attempt);
        }
        return resultOf(
          reviewFingerprint,
          attempt?.phase ?? "attested",
          attempt && "outcome" in attempt ? attempt.outcome : null,
          existingAttestation.fingerprint,
        );
      }
    }
    if (attempt?.phase === "attested") {
      await this.#assertStoredAttestation(candidate, attempt);
      return resultOf(
        reviewFingerprint,
        attempt.phase,
        attempt.outcome,
        attempt.attestationFingerprint,
      );
    }

    if (!attempt || attempt.phase === "prepared") {
      attempt = await this.#activatePrepared(candidate, identity, options);
    }
    if (attempt.phase === "prepared") {
      return resultOf(reviewFingerprint, attempt.phase, null, null);
    }

    try {
      if (attempt.phase !== "attested" && attempt.phase !== "stopped") {
        await this.#assertMutationTip(candidate, identity, attempt);
        await this.#reacquire(candidate);
      }
      if (attempt.phase === "active") {
        attempt = await this.#submitCase(candidate, identity, attempt);
      }
      if (attempt.phase === "case-submitted") {
        if (!options.allowDispatch) {
          return resultOf(reviewFingerprint, attempt.phase, null, null);
        }
        attempt = await this.#dispatchOnce(candidate, identity);
      }
      if (attempt.phase === "dispatching" || attempt.phase === "quarantined") {
        attempt = await this.#readback(candidate, identity, attempt);
      }
      if (attempt.phase === "recorded") {
        attempt = await this.#outcomeFromRecorded(candidate, identity, attempt);
      }
      if (attempt.phase === "dispatching" || attempt.phase === "quarantined") {
        attempt = await this.#sealIfDeadline(identity, attempt);
      }
    } catch (error) {
      if (error instanceof CapabilityRuntimeQualificationError) throw error;
      throw error;
    }

    if (
      attempt.phase === "outcome" || attempt.phase === "stopped" ||
      attempt.phase === "attested"
    ) {
      if (attempt.phase === "outcome") {
        attempt = await this.#stop(candidate, identity, attempt);
      }
      if (attempt.phase === "stopped") {
        attempt = await this.#verifyStopped(candidate, identity, attempt);
      }
    }
    if (attempt.phase === "stopped" && attempt.outcome.status === "qualified") {
      attempt = await this.#attest(candidate, identity, attempt);
    }
    if (attempt.phase === "attested") {
      await this.#assertStoredAttestation(candidate, attempt);
      return resultOf(
        reviewFingerprint,
        attempt.phase,
        attempt.outcome,
        attempt.attestationFingerprint,
      );
    }
    return resultOf(
      reviewFingerprint,
      attempt.phase,
      "outcome" in attempt ? attempt.outcome : null,
      null,
    );
  }

  async #activatePrepared(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    options: {
      readonly allowStart: boolean;
      readonly review?: CapabilityRuntimeQualificationReview;
    },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const current = await this.options.attempts.read(
      qualificationAttemptKeyFor(identity),
    );
    if (current && current.phase !== "prepared") return current;
    const authority = startAuthority(identity);
    if (!options.allowStart) {
      const proof = await this.options.groups.readQualificationStartProof({
        group: candidate.launchGroup,
        expectedMaterials: [candidate.material],
        qualificationStartAuthority: authority,
      });
      if (!proof) {
        const current = await this.options.attempts.read(
          qualificationAttemptKeyFor(identity),
        );
        if (current) return current;
        throw unavailable(
          "Capability runtime qualification recovery requires an existing WAL " +
            "attempt.",
        );
      }
      await this.#reacquire(candidate);
      return await this.options.attempts.markActive(identity, {
        runtimeStartFingerprint: proof.fingerprint,
      });
    }
    if (!options.review) {
      throw unavailable(
        "Capability runtime qualification start requires the exact confirmed review.",
      );
    }
    const snapshot = await this.#secretSnapshot(candidate);
    const at = this.#now();
    const started = await this.options.groups.ensureQualificationActive({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: authority,
      lease: qualificationLease(candidate, at),
      at,
      reuseExistingLease: "allow",
      guard: async () => {
        const currentReview = await this.#composeReview(candidate.id);
        return fingerprintsEqual(
          currentReview.reviewFingerprint,
          options.review!.reviewFingerprint,
        );
      },
      secretSnapshot: snapshot,
      prepareAfterAuthorization: async () => {
        await this.options.attempts.prepare(identity, {
          preparedAt: this.#now(),
        });
      },
    });
    const proof = started.qualificationStart;
    if (!proof) {
      throw unavailable(
        "Capability runtime qualification start did not return an exact start proof.",
      );
    }
    return await this.options.attempts.markActive(identity, {
      runtimeStartFingerprint: proof.fingerprint,
    });
  }

  async #submitCase(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const observer = await this.#observerFor(candidate);
    if (!observer) {
      return await this.#preDispatchUnavailable(identity, attempt);
    }
    const lowered = await this.#lower(candidate);
    const submitted = await observer.submitCase({
      exactCaseText: lowered.exactRequestText,
      requestFingerprint: lowered.requestFingerprint,
    });
    if (
      submitted.caseSha256 !== identity.caseFingerprint.digest ||
      submitted.caseUri !== `chrono-case:sha256:${identity.caseFingerprint.digest}`
    ) {
      throw unavailable(
        "Capability runtime qualification case submission did not bind " +
          "the exact fixture bytes.",
      );
    }
    return await this.options.attempts.markCaseSubmitted(identity, submitted);
  }

  async #dispatchOnce(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const observer = await this.#observerFor(candidate);
    if (!observer) {
      const current = await this.options.attempts.read(
        qualificationAttemptKeyFor(identity),
      );
      if (!current) {
        throw unavailable(
          "Capability runtime qualification WAL is absent before dispatch.",
        );
      }
      return await this.#preDispatchUnavailable(identity, current);
    }
    const claimedAt = this.#now();
    const claimed = await this.options.attempts.claimDispatching(identity, {
      claimedAt,
      deadlineAt: new Date(
        Date.parse(claimedAt) + CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS,
      ).toISOString(),
    });
    if (!claimed.dispatchNow) {
      return claimed.attempt;
    }
    try {
      const result = await observer.run({
        requestId: identity.requestId,
        caseSha256: identity.caseFingerprint.digest,
        caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
        sampleOffset: 0,
        sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
      });
      if (result.state === "recorded") {
        return await this.#recordReceipt(identity, observer, result.record);
      }
      return await this.#quarantineFromRead(
        identity,
        observer,
        claimed.attempt,
        result.state === "absent"
          ? "absent"
          : result.state === "uncertain"
          ? "uncertain"
          : "malformed",
      );
    } catch {
      return await this.#quarantineFromRead(
        identity,
        observer,
        claimed.attempt,
        "malformed",
      );
    }
  }

  async #readback(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const observer = await this.#observerFor(candidate);
    if (!observer) {
      if (attempt.phase === "quarantined") return attempt;
      return await this.options.attempts.markQuarantined(identity, {
        reason: "uncertain",
      });
    }
    try {
      const result = await observer.readRun({
        requestId: identity.requestId,
        caseSha256: identity.caseFingerprint.digest,
        caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
      }, {
        sampleOffset: 0,
        sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
      });
      if (result.state === "recorded") {
        return await this.#recordReceipt(identity, observer, result.record);
      }
      const reason = result.state === "absent"
        ? "absent"
        : result.state === "uncertain"
        ? "uncertain"
        : "malformed";
      return await this.#keepOrQuarantine(identity, attempt, reason);
    } catch {
      return await this.#keepOrQuarantine(identity, attempt, "malformed");
    }
  }

  async #recordReceipt(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    observer: PrescribedKinematicsObserver,
    record: PrescribedKinematicsObservationRecord,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    try {
      const complete = await readCompletePrescribedKinematicsReceipt(
        observer,
        record.receipt.receiptSha256,
      );
      assertPrescribedKinematicsRecordBoundToIdentity(complete, {
        requestId: identity.requestId,
        caseSha256: identity.caseFingerprint.digest,
      });
      const receiptFingerprint = await fingerprintPrescribedKinematicsCompleteReceipt(
        complete,
      );
      return await this.options.attempts.markRecorded(identity, {
        receiptSha256: complete.receipt.receiptSha256,
        receiptFingerprint,
      });
    } catch {
      return await this.#keepOrQuarantine(
        identity,
        await this.options.attempts.read(qualificationAttemptKeyFor(identity)) ??
          (await this.options.attempts.markQuarantined(identity, {
            reason: "malformed",
          })),
        "malformed",
      );
    }
  }

  async #quarantineFromRead(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    observer: PrescribedKinematicsObserver,
    attempt: CapabilityRuntimeQualificationAttempt,
    fallback: "absent" | "uncertain" | "malformed",
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    try {
      const result = await observer.readRun({
        requestId: identity.requestId,
        caseSha256: identity.caseFingerprint.digest,
        caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
      }, {
        sampleOffset: 0,
        sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
      });
      if (result.state === "recorded") {
        return await this.#recordReceipt(identity, observer, result.record);
      }
      const reason = result.state === "absent"
        ? "absent"
        : result.state === "uncertain"
        ? "uncertain"
        : "malformed";
      return await this.#keepOrQuarantine(identity, attempt, reason);
    } catch {
      return await this.#keepOrQuarantine(identity, attempt, fallback);
    }
  }

  async #keepOrQuarantine(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
    reason: "absent" | "uncertain" | "malformed",
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    if (attempt.phase === "recorded") return attempt;
    if (attempt.phase === "quarantined") return attempt;
    const quarantined = await this.options.attempts.markQuarantined(identity, {
      reason,
    });
    return quarantined;
  }

  async #outcomeFromRecorded(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "recorded" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const observer = await this.#observerFor(candidate);
    if (!observer) return attempt;
    let complete: PrescribedKinematicsObservationRecord;
    try {
      complete = await readCompletePrescribedKinematicsReceipt(
        observer,
        attempt.receiptSha256,
      );
      assertPrescribedKinematicsRecordBoundToIdentity(complete, {
        requestId: identity.requestId,
        caseSha256: identity.caseFingerprint.digest,
      });
      const receiptFingerprint = await fingerprintPrescribedKinematicsCompleteReceipt(
        complete,
      );
      if (!fingerprintsEqual(receiptFingerprint, attempt.receiptFingerprint)) {
        throw new TypeError("Qualification receipt fingerprint drifted.");
      }
    } catch {
      // A transient second read of an already-recorded receipt stays recorded.
      return attempt;
    }
    let status: "qualified" | "failed" = "failed";
    try {
      assertChronoArm64EmulationQualificationReceipt(
        complete,
        candidate.fixture.source,
      );
      status = "qualified";
    } catch {
      status = "failed";
    }
    const outcome = await createCapabilityRuntimeQualificationAttemptOutcome({
      schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
      status,
      basis: "recorded",
      recordedAt: complete.receipt.recordedAt,
      basisFingerprint: attempt.receiptFingerprint,
    });
    return await this.options.attempts.markOutcome(identity, outcome);
  }

  async #sealIfDeadline(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    if (attempt.phase !== "dispatching" && attempt.phase !== "quarantined") {
      return attempt;
    }
    if (this.#now() < attempt.deadlineAt) return attempt;
    return await this.options.attempts.sealDispatchDeadline(identity);
  }

  async #preDispatchUnavailable(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const outcome = await createCapabilityRuntimeQualificationAttemptOutcome({
      schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
      status: "unavailable",
      basis: "pre-dispatch",
      recordedAt: this.#now(),
      basisFingerprint: await fingerprintCapabilityRuntimeQualificationAttempt(
        attempt,
      ),
    });
    return await this.options.attempts.markOutcome(identity, outcome);
  }

  async #stop(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "outcome" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const at = this.#now();
    const lease = qualificationLease(candidate, at);
    const proof = await this.options.groups.releaseQualificationTerminal({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      startProofFingerprint: attempt.runtimeStartFingerprint,
      lease,
      at,
    });
    return await this.options.attempts.markStopped(identity, {
      runtimeStopProof: proof,
    });
  }

  async #verifyStopped(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "stopped" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    if (
      attempt.runtimeStopProof.schemaVersion !==
        CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA
    ) {
      throw unavailable("Chrono qualification requires a host stop proof.");
    }
    await this.options.groups.verifyQualificationStopProof({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      proof: attempt.runtimeStopProof,
    });
    await this.#assertOwnedRuntimeInactive(candidate);
    return attempt;
  }

  async #assertMutationTip(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<void> {
    if (attempt.phase === "prepared") return;
    await this.options.groups.requireQualificationMutationTip({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      kind: attempt.phase === "outcome" ? "stop" : "start",
      startProofFingerprint: "runtimeStartFingerprint" in attempt
        ? attempt.runtimeStartFingerprint
        : undefined,
    });
  }

  async #hasExactRevocation(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<boolean> {
    const revoked = (await this.options.attestations.list()).filter((event) =>
      event.state === "revoked" &&
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        identity.observedHost,
      )
    );
    return revoked.length > 0;
  }

  async #finishRevoked(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt | undefined,
  ): Promise<CapabilityRuntimeQualificationApplyResult> {
    if (!attempt || attempt.phase === "prepared") {
      throw unavailable(
        "Capability runtime qualification is unavailable because an exact " +
          "Chrono revocation is recorded.",
      );
    }
    if (attempt.phase === "attested") {
      await this.#assertStoredAttestation(candidate, attempt);
      throw unavailable(
        "Capability runtime qualification is unavailable because an exact " +
          "Chrono revocation is recorded.",
      );
    }
    if (attempt.phase === "stopped") {
      await this.#verifyStopped(candidate, identity, attempt);
      throw unavailable(
        "Capability runtime qualification is unavailable because an exact " +
          "Chrono revocation is recorded.",
      );
    }
    let current: CapabilityRuntimeQualificationAttempt = attempt;
    try {
      await this.#assertMutationTip(candidate, identity, current);
      await this.#reacquire(candidate);
      if (current.phase === "active" || current.phase === "case-submitted") {
        current = await this.#preDispatchUnavailable(identity, current);
      }
      if (current.phase === "dispatching" || current.phase === "quarantined") {
        current = await this.#readback(candidate, identity, current);
      }
      if (current.phase === "recorded") {
        current = await this.#outcomeFromRecorded(candidate, identity, current);
      }
      if (current.phase === "dispatching" || current.phase === "quarantined") {
        current = await this.#sealIfDeadline(identity, current);
      }
    } catch (error) {
      if (error instanceof CapabilityRuntimeQualificationError) throw error;
      throw error;
    }
    if (current.phase === "outcome") {
      current = await this.#stop(candidate, identity, current);
    }
    if (current.phase === "stopped") {
      await this.#verifyStopped(candidate, identity, current);
    }
    throw unavailable(
      "Capability runtime qualification is unavailable because an exact " +
        "Chrono revocation is recorded.",
    );
  }

  async #attest(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "stopped" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    await this.#verifyStopped(candidate, identity, attempt);
    await this.#assertHostMatchesIdentity(identity);
    await this.#assertOwnedRuntimeInactive(candidate);
    const spec = this.#spec(candidate);
    const attestation = await createChronoRuntimeQualificationAttestation({
      attempt,
      candidate,
      spec,
    });
    const storedExpected = await this.options.attestations.read(
      attestation.fingerprint,
    );
    if (!storedExpected) {
      const others = (await this.options.attestations.list()).filter((event) =>
        event.state === "qualified" &&
        matchesCapabilityRuntimeQualificationCandidate(
          event,
          candidate,
          identity.observedHost,
          spec,
        )
      );
      if (others.length > 0) {
        throw unavailable(
          "Capability runtime qualification found a divergent attestation for this spec.",
        );
      }
    }
    const written = await this.options.attestations.appendQualifiedUnlessRevoked(
      attestation,
    );
    if (written.status === "revoked") {
      throw unavailable(
        "Capability runtime qualification is unavailable because an exact " +
          "Chrono revocation is recorded.",
      );
    }
    const stored = await this.options.attestations.read(attestation.fingerprint);
    if (!stored || !fingerprintsEqual(stored.fingerprint, attestation.fingerprint)) {
      throw unavailable(
        "Capability runtime qualification attestation was not readable after append.",
      );
    }
    if (!fingerprintsEqual(stored.fingerprint, attestation.fingerprint)) {
      throw unavailable(
        "Capability runtime qualification attestation fingerprint drifted after append.",
      );
    }
    return await this.options.attempts.markAttested(identity, {
      attestationFingerprint: stored.fingerprint,
    });
  }

  async #assertStoredAttestation(
    candidate: CapabilityRuntimeQualificationCandidate,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "attested" }
    >,
  ): Promise<void> {
    const spec = this.#spec(candidate);
    const expected = await createChronoRuntimeQualificationAttestation({
      attempt: stoppedQualificationAttemptFrom(attempt),
      candidate,
      spec,
    });
    const stored = await this.options.attestations.read(
      attempt.attestationFingerprint,
    );
    if (
      !stored ||
      !fingerprintsEqual(stored.fingerprint, expected.fingerprint) ||
      !fingerprintsEqual(attempt.attestationFingerprint, expected.fingerprint)
    ) {
      throw unavailable(
        "Capability runtime qualification attested WAL does not match the stored event.",
      );
    }
  }

  async #composeReview(
    candidateId: string,
  ): Promise<CapabilityRuntimeQualificationReview> {
    const candidate = this.#candidate(candidateId);
    await this.#assertCatalogStillExact(candidate);
    const [policy, lock, host, events, protocolFingerprint, criteriaFingerprint] =
      await Promise.all([
        this.options.policy.read(),
        this.options.lock.read(),
        this.options.hostObservation.read(),
        this.options.attestations.list(),
        fingerprintChronoQualificationProtocol(),
        fingerprintChronoArm64EmulationQualificationCriteria(),
      ]);
    if (host.platform !== "linux/arm64") {
      throw unavailable(
        "Capability runtime qualification requires the Docker daemon " +
          "linux/arm64 identity.",
      );
    }
    if (
      host.platform !== candidate.observedHostPlatform ||
      candidate.targetPlatform !== "linux/amd64" ||
      candidate.mode !== "emulated"
    ) {
      throw unavailable(
        "Capability runtime qualification host platform drifted from the " +
          "code-owned candidate.",
      );
    }
    const spec = this.#spec(candidate);
    const lowered = await this.#lower(candidate);
    if (
      !fingerprintsEqual(spec.sourceFingerprint, candidate.fixture.sourceFingerprint) ||
      !fingerprintsEqual(spec.loweringFingerprint, lowered.loweringFingerprint) ||
      !fingerprintsEqual(spec.caseFingerprint, lowered.requestFingerprint) ||
      !fingerprintsEqual(spec.protocolFingerprint, protocolFingerprint) ||
      !fingerprintsEqual(spec.criteriaFingerprint, criteriaFingerprint) ||
      !fingerprintsEqual(spec.candidate.fingerprint, candidate.fingerprint)
    ) {
      throw unavailable(
        "Capability runtime qualification specification drifted from the current probe.",
      );
    }
    const material = this.#catalogMaterial(candidate);
    const group = await this.options.launchGroups.require(candidate.launchGroup);
    const availability = await this.options.secrets.observe(group.secretSlots);
    if (
      group.secretSlots.some((slot) => availability.get(slot) !== "available")
    ) {
      throw unavailable(
        "Capability runtime qualification is unavailable because the Chrono " +
          "local bearer credential is missing.",
      );
    }
    if (policy.disabledBindingIds.includes(candidate.binding.id)) {
      throw unavailable(
        "Capability runtime qualification is unavailable because the Chrono " +
          "binding is administratively disabled.",
      );
    }
    const lockUnit = lock.units.find((unit) => unit.id === candidate.unit.id);
    if (
      lockUnit &&
      (lockUnit.version !== candidate.unit.version ||
        !fingerprintsEqual(
          lockUnit.manifestFingerprint,
          candidate.unit.manifestFingerprint,
        ))
    ) {
      throw unavailable(
        "Capability runtime qualification admin lock does not match the " +
          "exact Chrono unit manifest.",
      );
    }
    const observedHost = {
      identityFingerprint: host.identityFingerprint,
      platform: "linux/arm64" as const,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        "linux/arm64",
        host.identityFingerprint,
      ),
    };
    const matching = events.filter((event) =>
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        observedHost,
      )
    );
    const revoked = matching.filter((event) => event.state === "revoked")
      .map((event) => event.fingerprint)
      .toSorted(compareFingerprint);
    const qualified = matching.filter((event) =>
      event.state === "qualified" &&
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        observedHost,
        spec,
      )
    )
      .map((event) => event.fingerprint)
      .toSorted(compareFingerprint);
    if (revoked.length > 0) {
      throw unavailable(
        "Capability runtime qualification is unavailable because an exact " +
          "Chrono revocation is recorded.",
      );
    }
    if (qualified.length > 1) {
      throw unavailable(
        "Capability runtime qualification is unavailable because multiple " +
          "live Chrono attestations exist.",
      );
    }
    const secretSlots = group.secretSlots.map((slot) => ({
      slot,
      availability: availability.get(slot) ?? "unknown" as const,
    }));
    const core = {
      kind: "qualify-apply" as const,
      candidate: {
        id: candidate.id,
        version: candidate.version,
        fingerprint: candidate.fingerprint,
      },
      binding: candidate.binding,
      selector: candidate.selector,
      contract: candidate.contract,
      profile: candidate.profile,
      unit: candidate.unit,
      material: candidate.material,
      launchGroup: candidate.launchGroup,
      observedHost,
      targetPlatform: "linux/amd64" as const,
      mode: "emulated" as const,
      fixture: {
        id: candidate.fixture.id,
        fingerprint: candidate.fixture.sourceFingerprint,
      },
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint: lowered.loweringFingerprint,
      caseFingerprint: lowered.requestFingerprint,
      protocolFingerprint,
      criteriaFingerprint,
      qualificationSpec: {
        id: spec.id,
        version: spec.version,
        fingerprint: spec.fingerprint,
      },
      policy: { chronoBindingDisabled: false as const },
      adminLock: {
        unit: lockUnit
          ? {
            id: lockUnit.id,
            version: lockUnit.version,
            manifestFingerprint: lockUnit.manifestFingerprint,
            desired: lockUnit.desired,
          }
          : null,
      },
      hostEffects: structuredClone(material.effects),
      secretSlots,
      attestations: { qualified, revoked },
    };
    const reviewCoreFingerprint = await sha256Fingerprint(core);
    const requestId = await qualificationRequestId({
      candidateFingerprint: candidate.fingerprint,
      observedHostFingerprint: observedHost.fingerprint,
      reviewCoreFingerprint,
    });
    const runRequestFingerprint = await sha256Fingerprint({
      schemaVersion: "chrono-qualification-run-request/1.0",
      candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
      observedHost,
      reviewCoreFingerprint,
      requestId,
      caseSha256: lowered.requestFingerprint.digest,
      caseUri: `chrono-case:sha256:${lowered.requestFingerprint.digest}`,
      protocol: CHRONO_QUALIFICATION_PROTOCOL,
    });
    const body = { ...core, requestId, runRequestFingerprint };
    return deepFreeze({
      ...body,
      reviewFingerprint: await sha256Fingerprint(body),
    });
  }

  #identityFromReview(
    review: CapabilityRuntimeQualificationReview,
  ): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
    return Promise.resolve({
      candidate: {
        id: review.candidate.id,
        fingerprint: review.candidate.fingerprint,
      },
      observedHost: review.observedHost,
      reviewFingerprint: review.reviewFingerprint,
      requestId: review.requestId,
      sourceFingerprint: review.sourceFingerprint,
      loweringFingerprint: review.loweringFingerprint,
      caseFingerprint: review.caseFingerprint,
      runRequestFingerprint: review.runRequestFingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
  }

  #candidate(candidateId: string): CapabilityRuntimeQualificationCandidate {
    const matches = this.options.candidates.filter((candidate) =>
      candidate.id === candidateId
    );
    if (matches.length !== 1 || matches[0] === undefined) {
      throw unavailable(
        "Capability runtime qualification requires the exact code-owned " +
          "chrono-arm64-emulation-v1 candidate.",
      );
    }
    return matches[0];
  }

  #spec(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): CapabilityRuntimeQualificationSpecification {
    const matches = this.options.specs.filter((spec) =>
      spec.candidate.id === candidate.id &&
      fingerprintsEqual(spec.candidate.fingerprint, candidate.fingerprint)
    );
    if (matches.length !== 1 || matches[0] === undefined) {
      throw unavailable(
        "Capability runtime qualification requires the exact current Chrono specification.",
      );
    }
    return matches[0];
  }

  #assertCatalogStillExact(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): Promise<void> {
    try {
      this.#assertCatalogStillExactValue(candidate);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #assertCatalogStillExactValue(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): void {
    const binding = this.options.catalog.bindings.find((item) =>
      item.id === candidate.binding.id && item.version === candidate.binding.version
    );
    const unit = this.options.catalog.units.find((item) =>
      item.id === candidate.unit.id
    );
    const material = unit?.materials.find((item) =>
      item.id === candidate.material.materialId
    );
    if (
      !binding || !unit || !material ||
      binding.capability.id !== candidate.selector.capability.id ||
      binding.capability.version !== candidate.selector.capability.version ||
      binding.use !== candidate.selector.use ||
      binding.adapter.id !== candidate.contract.id ||
      binding.adapter.version !== candidate.contract.version ||
      binding.adapter.source !== candidate.contract.source ||
      !sameProfile(binding.profile, candidate.profile) ||
      unit.version !== candidate.unit.version ||
      !fingerprintsEqual(
        unit.manifestFingerprint,
        candidate.unit.manifestFingerprint,
      ) ||
      digestFromReference(material.imageReference) !== candidate.material.imageDigest ||
      material.launchGroup?.id !== candidate.launchGroup.id ||
      material.launchGroup?.version !== candidate.launchGroup.version ||
      !fingerprintsEqual(
        material.launchGroup?.fingerprint,
        candidate.launchGroup.fingerprint,
      )
    ) {
      throw unavailable(
        "Capability runtime qualification candidate drifted from the current " +
          "catalogue.",
      );
    }
    if (
      material.effects.security !== "reviewed" || material.effects.privileged ||
      material.effects.dockerSocket || material.effects.devices.length > 0
    ) {
      throw unavailable(
        "Capability runtime qualification is unavailable because Chrono " +
          "host effects are unknown or unreviewed.",
      );
    }
  }

  #catalogMaterial(candidate: CapabilityRuntimeQualificationCandidate) {
    const unit = this.options.catalog.units.find((item) =>
      item.id === candidate.unit.id
    );
    const material = unit?.materials.find((item) =>
      item.id === candidate.material.materialId
    );
    if (!material) {
      throw unavailable(
        "Capability runtime qualification candidate drifted from the current " +
          "catalogue.",
      );
    }
    return material;
  }

  async #observedHost() {
    const host = await this.options.hostObservation.read();
    if (host.platform !== "linux/arm64") {
      throw unavailable(
        "Capability runtime qualification requires the Docker daemon " +
          "linux/arm64 identity.",
      );
    }
    return {
      identityFingerprint: host.identityFingerprint,
      platform: "linux/arm64" as const,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        "linux/arm64",
        host.identityFingerprint,
      ),
    };
  }

  async #assertHostMatchesIdentity(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<void> {
    const observed = await this.#observedHost();
    if (
      observed.platform !== identity.observedHost.platform ||
      !fingerprintsEqual(
        observed.identityFingerprint,
        identity.observedHost.identityFingerprint,
      ) ||
      !fingerprintsEqual(observed.fingerprint, identity.observedHost.fingerprint)
    ) {
      throw unavailable(
        "Capability runtime qualification host identity or platform drifted.",
      );
    }
  }

  async #matchingQualifiedAttestation(
    candidate: CapabilityRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt | undefined,
  ) {
    if (
      !attempt ||
      (attempt.phase !== "stopped" && attempt.phase !== "attested") ||
      attempt.outcome.status !== "qualified" ||
      attempt.outcome.basis !== "recorded"
    ) {
      return undefined;
    }
    const spec = this.#spec(candidate);
    const expected = await createChronoRuntimeQualificationAttestation({
      attempt: stoppedQualificationAttemptFrom(attempt),
      candidate,
      spec,
    });
    const events = await this.options.attestations.list();
    const matching = events.filter((event) =>
      event.state === "qualified" &&
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        identity.observedHost,
        spec,
      ) &&
      isCanonicalCapabilityRuntimeQualificationStoppedOutcome(event.outcome) &&
      fingerprintsEqual(event.fingerprint, expected.fingerprint) &&
      fingerprintsEqual(event.outcome.fingerprint, expected.outcome.fingerprint)
    );
    if (matching.length > 1) {
      throw unavailable(
        "Capability runtime qualification is unavailable because multiple " +
          "live Chrono attestations exist.",
      );
    }
    return matching[0];
  }

  async #secretSnapshot(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): Promise<CapabilityRuntimeSecretSnapshot> {
    const group = await this.options.launchGroups.require(candidate.launchGroup);
    const availability = await this.options.secrets.observe(group.secretSlots);
    if (
      group.secretSlots.some((slot) => availability.get(slot) !== "available")
    ) {
      throw unavailable(
        "Capability runtime qualification is unavailable because the Chrono " +
          "local bearer credential is missing.",
      );
    }
    try {
      return await this.options.secrets.beginSnapshot({
        group: candidate.launchGroup,
        slots: group.secretSlots,
      });
    } catch (error) {
      throw unavailable(
        compact(
          error,
          "Capability runtime qualification is unavailable because the Chrono " +
            "local bearer credential is missing.",
        ),
      );
    }
  }

  async #observerFor(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): Promise<PrescribedKinematicsObserver | undefined> {
    const group = await this.options.launchGroups.require(candidate.launchGroup);
    const availability = await this.options.secrets.observe(group.secretSlots);
    if (group.secretSlots.some((slot) => availability.get(slot) !== "available")) {
      return undefined;
    }
    // Construction errors stay construction errors. A missing slot is the only
    // path that becomes pre-dispatch-unavailable rather than a thrown failure.
    return this.options.createObserver(
      await this.options.secrets.beginSnapshot({
        group: candidate.launchGroup,
        slots: group.secretSlots,
      }),
    );
  }

  async #lower(candidate: CapabilityRuntimeQualificationCandidate) {
    const lowered = await this.options.lowerer.lower({
      source: candidate.fixture.source,
      sourceFingerprint: candidate.fixture.sourceFingerprint,
    });
    await assertPrescribedKinematicsLoweredCase(
      lowered,
      candidate.fixture.sourceFingerprint,
    );
    return lowered;
  }

  async #reacquire(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): Promise<void> {
    const at = this.#now();
    await this.options.groups.reacquireQualificationLease({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      lease: qualificationLease(candidate, at),
      at,
    });
  }

  async #assertOwnedRuntimeInactive(
    candidate: CapabilityRuntimeQualificationCandidate,
  ): Promise<void> {
    const states = await this.options.states.observe([candidate.material]);
    const state = states.get(capabilityRuntimeMaterialKey(candidate.material));
    if (state?.runtime !== "inactive") {
      throw unavailable(
        "Capability runtime qualification host drifted: owned Chrono " +
          "runtime is not inactive.",
      );
    }
  }
}

function startAuthority(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): CapabilityRuntimeQualificationStartAuthority {
  return {
    candidate: identity.candidate,
    reviewFingerprint: identity.reviewFingerprint,
  };
}

async function qualificationRequestId(input: {
  readonly candidateFingerprint: ContentFingerprint;
  readonly observedHostFingerprint: ContentFingerprint;
  readonly reviewCoreFingerprint: ContentFingerprint;
}): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: "chrono-qualification-request-id/1.0",
    candidateFingerprint: input.candidateFingerprint,
    observedHostFingerprint: input.observedHostFingerprint,
    reviewCoreFingerprint: input.reviewCoreFingerprint,
  });
  return `chrono-qual-${fingerprint.digest}`;
}

function qualificationLease(
  candidate: CapabilityRuntimeQualificationCandidate,
  at: string,
): CapabilityRuntimeLease {
  const expiresAt = new Date(Date.parse(at) + LEASE_TTL_MS).toISOString();
  return {
    id: CHRONO_RUNTIME_QUALIFICATION_LEASE_ID,
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    bindingIds: [candidate.binding.id],
    materialKeys: [capabilityRuntimeMaterialKey(candidate.material)],
    launchGroups: [candidate.launchGroup],
    acquiredAt: at,
    expiresAt,
  };
}

function resultOf(
  reviewFingerprint: ContentFingerprint,
  phase: CapabilityRuntimeQualificationAttempt["phase"],
  outcome: CapabilityRuntimeQualificationAttemptOutcome | null,
  attestationFingerprint: ContentFingerprint | null,
): CapabilityRuntimeQualificationApplyResult {
  const status = outcome?.status ??
    (attestationFingerprint ? "qualified" as const : "unavailable" as const);
  return {
    kind: "qualify-result",
    status,
    phase,
    reviewFingerprint,
    outcome,
    attestationFingerprint,
  };
}

function requireConfirm(confirm: boolean): void {
  if (!confirm) {
    throw new CapabilityRuntimeQualificationError(
      "Capability runtime qualification mutation requires --confirm.",
    );
  }
}

function assertExactReview(
  actual: ContentFingerprint,
  expected: ContentFingerprint,
): void {
  if (!fingerprintsEqual(actual, expected)) {
    throw new CapabilityRuntimeQualificationError(
      "Capability runtime qualification review is stale or does not match " +
        "--review-fingerprint.",
    );
  }
}

function unavailable(message: string): CapabilityRuntimeQualificationError {
  return new CapabilityRuntimeQualificationError(message);
}

function sameProfile(
  left: CapabilityRuntimeQualificationCandidate["profile"] | {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint | null;
  } | null,
  right: CapabilityRuntimeQualificationCandidate["profile"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    ((left.fingerprint === null && right.fingerprint === null) ||
      (left.fingerprint !== null && right.fingerprint !== null &&
        fingerprintsEqual(left.fingerprint, right.fingerprint)));
}

function digestFromReference(reference: string): string {
  const digest = reference.slice(
    reference.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw unavailable(
      "Capability runtime catalogue material lacks one exact image digest.",
    );
  }
  return digest;
}

function compareFingerprint(left: ContentFingerprint, right: ContentFingerprint) {
  return `${left.algorithm}:${left.digest}`.localeCompare(
    `${right.algorithm}:${right.digest}`,
  );
}

function compact(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.trim()
    ? (detail.length > 512 ? `${detail.slice(0, 509)}...` : detail)
    : fallback;
}
