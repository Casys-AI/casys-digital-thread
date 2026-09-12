/**
 * Private host-local ERP Buy qualification probe.
 *
 * Review is read-only. Apply uses the existing launch-group qualification
 * lifecycle and the common attestation factory. It is not an engineering run.
 */

import type { CapabilityRuntimeQualificationAttemptStore } from "../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../../application/ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import {
  createCapabilityRuntimeQualificationAttestation,
  stoppedQualificationAttemptFrom,
} from "../../application/control-plane/capability-runtime-qualification-attestation-factory.ts";
import { matchesCapabilityRuntimeQualificationCandidate } from "../../application/control-plane/evaluate-capability-runtime-qualifications.ts";
import { createLocalFixedCapabilityRuntimeConnection } from "./local-fixed-capability-runtime-connection.ts";
import { ErpnextBuyCaptureClient } from "../buy/erpnext-buy-capture-client.ts";
import {
  type CapabilityRuntimeQualificationAttempt,
  type CapabilityRuntimeQualificationAttemptIdentity,
  createCapabilityRuntimeQualificationAttemptOutcome,
  fingerprintCapabilityRuntimeQualificationAttempt,
  qualificationAttemptIdentityOf,
  qualificationAttemptKeyFor,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { fingerprintCapabilityRuntimeObservedHost } from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeQualificationStartAuthority,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { CapabilityRuntimeLaunchGroupRegistry } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLeaseStore } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { assertErpnextBuyQualificationEvidence } from "./erpnext-buy-runtime-qualification-criteria.ts";
import {
  fingerprintErpnextBuyQualificationCriteria,
} from "./erpnext-buy-runtime-qualification-criteria.ts";
import { fingerprintErpnextBuyQualificationProtocol } from "./erpnext-buy-runtime-qualification-protocol.ts";
import {
  ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID,
  type ErpnextBuyRuntimeQualificationCandidate,
  validateErpnextBuyRuntimeQualificationCandidate,
} from "./first-party-erpnext-buy-runtime-qualification-candidates.ts";
import type { LocalErpnextBuyInstallationProfile } from "./local-erpnext-buy-installation-profile.ts";
import type { LocalErpnextBuyQualificationFixture } from "./local-erpnext-buy-qualification-fixture.ts";
import type { LocalErpnextBuyRuntimeSecretResolver } from "./local-erpnext-buy-runtime-secret-resolver.ts";

const LEASE_TTL_MS = 6 * 60 * 60 * 1000;
const DISPATCH_DEADLINE_MS = 5 * 60 * 1000;

export class ErpnextBuyRuntimeQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpnextBuyRuntimeQualificationError";
  }
}

export interface ErpnextBuyRuntimeQualificationReview {
  readonly candidate: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly observedHost: {
    readonly platform: ErpnextBuyRuntimeQualificationCandidate["observedHostPlatform"];
    readonly identityFingerprint: ContentFingerprint;
    readonly fingerprint: ContentFingerprint;
  };
  readonly reviewFingerprint: ContentFingerprint;
}

export interface ErpnextBuyRuntimeQualificationServiceOptions {
  readonly candidates: readonly ErpnextBuyRuntimeQualificationCandidate[];
  readonly specs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly catalog: CapabilityRuntimeCatalog;
  readonly profile: LocalErpnextBuyInstallationProfile;
  readonly fixture: LocalErpnextBuyQualificationFixture | undefined;
  readonly policy: { read(): Promise<CapabilityRuntimeAdminPolicy> };
  readonly lock: { read(): Promise<CapabilityRuntimeAdminLock> };
  readonly launchGroups: CapabilityRuntimeLaunchGroupRegistry;
  readonly attempts: CapabilityRuntimeQualificationAttemptStore;
  readonly attestations: CapabilityRuntimeQualificationAttestationStore;
  readonly groups: CapabilityRuntimeLaunchGroupSupervisor;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly host: {
    read(): Promise<
      { readonly platform: string; readonly identityFingerprint: ContentFingerprint }
    >;
  };
  readonly now?: () => string;
  readonly fetch?: typeof fetch;
  readonly secrets?: LocalErpnextBuyRuntimeSecretResolver;
}

export class ErpnextBuyRuntimeQualificationService {
  readonly #now: () => string;

  constructor(private readonly options: ErpnextBuyRuntimeQualificationServiceOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  owns(candidateId: string): boolean {
    return candidateId === ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID &&
      this.options.candidates.length === 1;
  }

  async review(candidateId: string): Promise<ErpnextBuyRuntimeQualificationReview> {
    const candidate = this.#candidate(candidateId);
    validateErpnextBuyRuntimeQualificationCandidate(candidate, candidate);
    if (!this.options.fixture) {
      throw unavailable(
        "ERP Buy qualification fixture is absent; the installed profile is not a probe envelope.",
      );
    }
    const spec = this.#spec(candidate);
    const [host, hostAgain, policy, lock, group, events] = await Promise.all([
      this.options.host.read(),
      this.options.host.read(),
      this.options.policy.read(),
      this.options.lock.read(),
      this.options.launchGroups.require(candidate.launchGroup),
      this.options.attestations.list(),
    ]);
    if (
      host.platform !== candidate.observedHostPlatform ||
      hostAgain.platform !== host.platform ||
      !fingerprintsEqual(host.identityFingerprint, hostAgain.identityFingerprint)
    ) {
      throw unavailable("ERP Buy qualification requires the candidate host platform.");
    }
    if (policy.disabledBindingIds.includes(candidate.binding.id)) {
      throw unavailable("ERP Buy qualification binding is administratively disabled.");
    }
    const binding = this.options.catalog.bindings.find((value) =>
      value.id === candidate.binding.id
    );
    const unit = this.options.catalog.units.find((value) =>
      value.id === candidate.unit.id
    );
    const material = unit?.materials.find((value) =>
      value.id === candidate.material.materialId
    );
    if (
      !binding || !unit || !material || binding.qualification !== "unqualified" ||
      binding.version !== candidate.binding.version ||
      material.imageReference !== this.options.profile.material.imageReference ||
      group.id !== candidate.launchGroup.id
    ) {
      throw unavailable("ERP Buy qualification authority facts drifted.");
    }
    const lockUnit = lock.units.find((value) => value.id === candidate.unit.id);
    if (
      lockUnit && (lockUnit.version !== candidate.unit.version ||
        !fingerprintsEqual(
          lockUnit.manifestFingerprint,
          candidate.unit.manifestFingerprint,
        ))
    ) {
      throw unavailable("ERP Buy qualification admin lock drifted.");
    }
    const observedHost = {
      platform: candidate.observedHostPlatform,
      identityFingerprint: host.identityFingerprint,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        candidate.observedHostPlatform,
        host.identityFingerprint,
      ),
    };
    const [protocolFingerprint, criteriaFingerprint] = await Promise.all([
      fingerprintErpnextBuyQualificationProtocol(),
      fingerprintErpnextBuyQualificationCriteria(),
    ]);
    if (
      !fingerprintsEqual(spec.candidate.fingerprint, candidate.fingerprint) ||
      !fingerprintsEqual(spec.sourceFingerprint, candidate.fixture.sourceFingerprint) ||
      !fingerprintsEqual(spec.protocolFingerprint, protocolFingerprint) ||
      !fingerprintsEqual(spec.criteriaFingerprint, criteriaFingerprint)
    ) {
      throw unavailable("ERP Buy qualification specification drifted.");
    }
    const revoked = events.filter((event) =>
      event.state === "revoked" &&
      matchesCapabilityRuntimeQualificationCandidate(event, candidate, observedHost)
    );
    if (revoked.length > 0) throw unavailable("ERP Buy qualification is revoked.");
    const body = {
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
      targetPlatform: candidate.targetPlatform,
      mode: candidate.mode,
      fixture: {
        id: candidate.fixture.id,
        fingerprint: candidate.fixture.sourceFingerprint,
      },
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint: spec.loweringFingerprint,
      caseFingerprint: spec.caseFingerprint,
      protocolFingerprint,
      criteriaFingerprint,
      qualificationSpec: {
        id: spec.id,
        version: spec.version,
        fingerprint: spec.fingerprint,
      },
    };
    return {
      candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
      observedHost,
      reviewFingerprint: await sha256Fingerprint(body),
    };
  }

  async apply(
    candidateId: string,
    reviewFingerprint: ContentFingerprint,
    confirm: boolean,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    if (!confirm) {
      throw unavailable("ERP Buy qualification apply requires --confirm.");
    }
    const review = await this.review(candidateId);
    if (!fingerprintsEqual(review.reviewFingerprint, reviewFingerprint)) {
      throw unavailable("ERP Buy qualification review fingerprint is stale.");
    }
    const candidate = this.#candidate(candidateId);
    const spec = this.#spec(candidate);
    return await this.#continue(
      candidate,
      await this.#identity(candidate, review, spec),
      { allowStart: true, allowDispatch: true, review },
    );
  }

  async recover(candidateId: string): Promise<CapabilityRuntimeQualificationAttempt> {
    // Recovery reconstructs identity from the WAL. Re-composing a review here
    // would let a later policy/lock/attestation change strand a started host
    // before recorded evidence can be sealed and the lease released.
    const candidate = this.#candidate(candidateId);
    validateErpnextBuyRuntimeQualificationCandidate(candidate, candidate);
    const spec = this.#spec(candidate);
    const host = await this.options.host.read();
    if (host.platform !== candidate.observedHostPlatform) {
      throw unavailable(
        "ERP Buy qualification recovery requires the candidate host platform.",
      );
    }
    const observedHost = {
      platform: candidate.observedHostPlatform,
      identityFingerprint: host.identityFingerprint,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        candidate.observedHostPlatform,
        host.identityFingerprint,
      ),
    };
    const current = await this.options.attempts.read({
      candidateId: candidate.id,
      candidateFingerprint: candidate.fingerprint,
      observedHostFingerprint: observedHost.fingerprint,
      qualificationSpecFingerprint: spec.fingerprint,
    });
    if (!current) {
      throw unavailable("ERP Buy qualification recovery requires a recorded attempt.");
    }
    return await this.#continue(
      candidate,
      await qualificationAttemptIdentityOf(current),
      {
        allowStart: false,
        allowDispatch: current.phase === "prepared" || current.phase === "active" ||
          current.phase === "case-submitted",
      },
    );
  }

  async #continue(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    options: {
      readonly allowStart: boolean;
      readonly allowDispatch: boolean;
      readonly review?: ErpnextBuyRuntimeQualificationReview;
    },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    await this.#assertHostMatchesIdentity(identity);
    let attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(identity),
    );
    const revoked = await this.#hasExactRevocation(candidate, identity);
    if (revoked && !attempt) {
      throw unavailable("ERP Buy qualification is revoked.");
    }
    const existingAttestation = await this.#matchingQualifiedAttestation(
      candidate,
      identity,
      attempt,
    );
    if (existingAttestation) {
      if (attempt?.phase === "attested") {
        if (revoked) throw unavailable("ERP Buy qualification is revoked.");
        await this.#assertStoredAttestation(candidate, attempt);
        return attempt;
      }
      if (
        !(
          attempt &&
          attempt.phase === "stopped" &&
          attempt.outcome.status === "qualified" &&
          attempt.outcome.basis === "recorded"
        )
      ) {
        throw unavailable(
          "ERP Buy qualification attestation already exists for this host without a matching attested WAL.",
        );
      }
    }
    if (attempt?.phase === "attested") {
      if (revoked) throw unavailable("ERP Buy qualification is revoked.");
      await this.#assertStoredAttestation(candidate, attempt);
      return attempt;
    }
    if (attempt?.phase === "stopped") {
      await this.#verifyStopped(candidate, identity, attempt);
    }
    if (!attempt || attempt.phase === "prepared") {
      attempt = await this.#activatePrepared(candidate, identity, options);
    }
    if (attempt.phase === "prepared") {
      if (revoked) throw unavailable("ERP Buy qualification is revoked.");
      return attempt;
    }
    if (attempt.phase !== "attested" && attempt.phase !== "stopped") {
      await this.options.groups.requireQualificationMutationTip({
        group: candidate.launchGroup,
        expectedMaterials: [candidate.material],
        qualificationStartAuthority: startAuthority(identity),
        kind: attempt.phase === "outcome" ? "stop" : "start",
        startProofFingerprint: "runtimeStartFingerprint" in attempt
          ? attempt.runtimeStartFingerprint
          : undefined,
      });
      await this.#reacquire(candidate);
    }
    if (attempt.phase === "active") {
      if (revoked) {
        attempt = await this.#preDispatchUnavailable(identity, attempt);
      } else {
        attempt = await this.#submitCase(candidate, identity);
      }
    }
    if (attempt.phase === "case-submitted") {
      if (revoked) {
        attempt = await this.#preDispatchUnavailable(identity, attempt);
      } else if (!options.allowDispatch) {
        return attempt;
      } else {
        attempt = await this.#claimAndCapture(candidate, identity);
      }
    }
    if (attempt.phase === "dispatching" || attempt.phase === "quarantined") {
      // Capture is read-only, but a claimed dispatch may still be executing.
      // Never recapture. After the durable deadline, seal unavailable and stop.
      if (this.#now() < attempt.deadlineAt) {
        throw unavailable(
          "ERP Buy qualification recovery refuses an ambiguous active dispatch.",
        );
      }
      attempt = await this.options.attempts.sealDispatchDeadline(identity);
    }
    if (attempt.phase === "recorded") {
      attempt = await this.#outcomeFromRecorded(identity, attempt);
    }
    if (attempt.phase === "outcome") {
      attempt = await this.#stop(candidate, identity, attempt);
    }
    if (attempt.phase === "stopped") {
      await this.#verifyStopped(candidate, identity, attempt);
    }
    if (revoked) {
      throw unavailable("ERP Buy qualification is revoked.");
    }
    if (attempt.phase === "stopped" && attempt.outcome.status === "qualified") {
      attempt = await this.#attest(candidate, identity, attempt);
    }
    return attempt;
  }

  async #activatePrepared(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    options: {
      readonly allowStart: boolean;
      readonly review?: ErpnextBuyRuntimeQualificationReview;
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
        if (current) return current;
        throw unavailable(
          "ERP Buy qualification recovery requires a recorded attempt.",
        );
      }
      await this.#reacquire(candidate);
      return await this.options.attempts.markActive(identity, {
        runtimeStartFingerprint: proof.fingerprint,
      });
    }
    if (!options.review) {
      throw unavailable(
        "ERP Buy qualification start requires the exact confirmed review.",
      );
    }
    const secretSnapshot = candidate.launchGroup &&
        this.options.profile.launchGroup.secretSlots.length > 0
      ? await this.options.secrets?.beginSnapshot({
        group: candidate.launchGroup,
        slots: this.options.profile.launchGroup.secretSlots.map((slot) => slot.id),
      })
      : undefined;
    if (
      this.options.profile.launchGroup.secretSlots.length > 0 &&
      secretSnapshot === undefined
    ) {
      throw unavailable("ERP Buy qualification secret snapshot is unavailable.");
    }
    const at = this.#now();
    const started = await this.options.groups.ensureQualificationActive({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: authority,
      lease: qualificationLease(candidate, at),
      at,
      reuseExistingLease: "allow",
      ...(secretSnapshot ? { secretSnapshot } : {}),
      guard: async () => {
        const currentReview = await this.review(candidate.id);
        return fingerprintsEqual(
          currentReview.reviewFingerprint,
          options.review!.reviewFingerprint,
        );
      },
      prepareAfterAuthorization: async () => {
        await this.options.attempts.prepare(identity, { preparedAt: this.#now() });
      },
    });
    if (!started.qualificationStart) {
      throw unavailable("ERP Buy qualification start proof is absent.");
    }
    return await this.options.attempts.markActive(identity, {
      runtimeStartFingerprint: started.qualificationStart.fingerprint,
    });
  }

  async #submitCase(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const spec = this.#spec(candidate);
    return await this.options.attempts.markCaseSubmitted(identity, {
      caseSha256: spec.caseFingerprint.digest,
      caseUri: `erpnext-buy-qualification-case:sha256:${spec.caseFingerprint.digest}`,
    });
  }

  async #claimAndCapture(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const fixture = this.options.fixture;
    if (!fixture) {
      throw unavailable("ERP Buy qualification fixture is absent.");
    }
    const claimedAt = this.#now();
    const claim = await this.options.attempts.claimDispatching(identity, {
      claimedAt,
      deadlineAt: new Date(Date.parse(claimedAt) + DISPATCH_DEADLINE_MS).toISOString(),
    });
    if (!claim.dispatchNow) {
      return claim.attempt;
    }
    const storedLease = await this.options.leases.read(
      qualificationLease(candidate, claimedAt).id,
    );
    if (!storedLease) {
      throw unavailable("ERP Buy qualification lease is not active.");
    }
    const group = await this.options.launchGroups.require(candidate.launchGroup);
    const connection = await createLocalFixedCapabilityRuntimeConnection({
      leases: this.options.leases,
      binding: candidate.binding,
      launchGroup: group,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      now: this.#now,
    });
    const handle = await connection.connect({
      lease: storedLease,
      binding: candidate.binding,
      launchGroup: candidate.launchGroup,
    });
    const client = await connection.open(handle);
    const envelope = await new ErpnextBuyCaptureClient(client).capture(
      fixture.documents,
    );
    assertErpnextBuyQualificationEvidence({
      candidate,
      profile: this.options.profile,
      envelope,
    });
    const receipt = await sha256Fingerprint(envelope);
    return await this.options.attempts.markRecorded(identity, {
      receiptSha256: receipt.digest,
      receiptFingerprint: receipt,
    });
  }

  async #outcomeFromRecorded(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "recorded" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return await this.options.attempts.markOutcome(
      identity,
      await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status: "qualified",
        basis: "recorded",
        recordedAt: this.#now(),
        basisFingerprint: attempt.receiptFingerprint,
      }),
    );
  }

  async #preDispatchUnavailable(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return await this.options.attempts.markOutcome(
      identity,
      await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status: "unavailable",
        basis: "pre-dispatch",
        recordedAt: this.#now(),
        basisFingerprint: await fingerprintCapabilityRuntimeQualificationAttempt(
          attempt,
        ),
      }),
    );
  }

  async #stop(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "outcome" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const at = this.#now();
    const proof = await this.options.groups.releaseQualificationTerminal({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      startProofFingerprint: attempt.runtimeStartFingerprint,
      lease: qualificationLease(candidate, at),
      at,
    });
    await this.options.groups.verifyQualificationStopProof({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      proof,
    });
    const stopped = await this.options.attempts.markStopped(identity, {
      runtimeStopProof: proof,
    });
    if (stopped.phase !== "stopped") {
      throw unavailable("ERP Buy qualification stop did not record a host stop proof.");
    }
    return stopped;
  }

  async #verifyStopped(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
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
      throw unavailable("ERP Buy qualification requires a host stop proof.");
    }
    await this.options.groups.verifyQualificationStopProof({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      proof: attempt.runtimeStopProof,
    });
    return attempt;
  }

  async #attest(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "stopped" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    await this.#verifyStopped(candidate, identity, attempt);
    await this.#assertHostMatchesIdentity(identity);
    if (await this.#hasExactRevocation(candidate, identity)) {
      throw unavailable("ERP Buy qualification is revoked.");
    }
    const spec = this.#spec(candidate);
    const attestation = await createCapabilityRuntimeQualificationAttestation({
      attempt,
      candidate,
      spec,
    });
    const written = await this.options.attestations.appendQualifiedUnlessRevoked(
      attestation,
    );
    if (written.status === "revoked") {
      throw unavailable("ERP Buy qualification is revoked.");
    }
    const stored = await this.options.attestations.read(attestation.fingerprint);
    if (!stored || !fingerprintsEqual(stored.fingerprint, attestation.fingerprint)) {
      throw unavailable("ERP Buy qualification attestation was not readable.");
    }
    if (await this.#hasExactRevocation(candidate, identity)) {
      throw unavailable("ERP Buy qualification is revoked.");
    }
    await this.#verifyStopped(candidate, identity, attempt);
    return await this.options.attempts.markAttested(identity, {
      attestationFingerprint: stored.fingerprint,
    });
  }

  async #matchingQualifiedAttestation(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
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
    const expected = await createCapabilityRuntimeQualificationAttestation({
      attempt: stoppedQualificationAttemptFrom(attempt),
      candidate,
      spec,
    });
    const matching = (await this.options.attestations.list()).filter((event) =>
      event.state === "qualified" &&
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        identity.observedHost,
        spec,
      ) &&
      fingerprintsEqual(event.fingerprint, expected.fingerprint)
    );
    if (matching.length > 1) {
      throw unavailable("Multiple live ERP Buy qualification attestations exist.");
    }
    return matching[0];
  }

  async #assertStoredAttestation(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "attested" }
    >,
  ): Promise<void> {
    const expected = await createCapabilityRuntimeQualificationAttestation({
      attempt: stoppedQualificationAttemptFrom(attempt),
      candidate,
      spec: this.#spec(candidate),
    });
    const stored = await this.options.attestations.read(attempt.attestationFingerprint);
    if (
      !stored ||
      !fingerprintsEqual(stored.fingerprint, expected.fingerprint) ||
      !fingerprintsEqual(attempt.attestationFingerprint, expected.fingerprint)
    ) {
      throw unavailable("ERP Buy attested WAL does not match the stored event.");
    }
  }

  async #hasExactRevocation(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<boolean> {
    return (await this.options.attestations.list()).some((event) =>
      event.state === "revoked" &&
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        identity.observedHost,
      )
    );
  }

  async #assertHostMatchesIdentity(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<void> {
    const host = await this.options.host.read();
    if (
      host.platform !== identity.observedHost.platform ||
      !fingerprintsEqual(
        host.identityFingerprint,
        identity.observedHost.identityFingerprint,
      )
    ) {
      throw unavailable("ERP Buy qualification host identity drifted.");
    }
  }

  async #reacquire(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
  ): Promise<CapabilityRuntimeLease> {
    const at = this.#now();
    return await this.options.groups.reacquireQualificationLease({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      lease: qualificationLease(candidate, at),
      at,
    });
  }

  #candidate(candidateId: string): ErpnextBuyRuntimeQualificationCandidate {
    const candidate = this.options.candidates.find((value) => value.id === candidateId);
    if (!candidate) {
      throw unavailable("ERP Buy qualification candidate is not registered.");
    }
    return candidate;
  }

  #spec(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
  ): CapabilityRuntimeQualificationSpecification {
    const spec = this.options.specs.find((value) =>
      value.candidate.id === candidate.id &&
      fingerprintsEqual(value.candidate.fingerprint, candidate.fingerprint)
    );
    if (!spec) {
      throw unavailable("ERP Buy qualification specification is not registered.");
    }
    return spec;
  }

  async #identity(
    candidate: ErpnextBuyRuntimeQualificationCandidate,
    review: ErpnextBuyRuntimeQualificationReview,
    spec: CapabilityRuntimeQualificationSpecification,
  ): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
    return {
      candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
      observedHost: review.observedHost,
      reviewFingerprint: review.reviewFingerprint,
      requestId: `erpnext-buy-qual-${review.reviewFingerprint.digest}`,
      sourceFingerprint: spec.sourceFingerprint,
      loweringFingerprint: spec.loweringFingerprint,
      caseFingerprint: spec.caseFingerprint,
      runRequestFingerprint: await sha256Fingerprint({
        schemaVersion: "erpnext-buy-qualification-run-request/1.0",
        review: review.reviewFingerprint,
        spec: spec.fingerprint,
      }),
      qualificationSpecFingerprint: spec.fingerprint,
    };
  }
}

function startAuthority(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): CapabilityRuntimeQualificationStartAuthority {
  return {
    candidate: {
      id: identity.candidate.id,
      fingerprint: identity.candidate.fingerprint,
    },
    reviewFingerprint: identity.reviewFingerprint,
  };
}

function qualificationLease(
  candidate: ErpnextBuyRuntimeQualificationCandidate,
  at: string,
): CapabilityRuntimeLease {
  return {
    id: "capability-runtime-qualification-erpnext-buy-source-v1",
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    bindingIds: [candidate.binding.id],
    materialKeys: [capabilityRuntimeMaterialKey(candidate.material)],
    launchGroups: [candidate.launchGroup],
    acquiredAt: at,
    expiresAt: new Date(Date.parse(at) + LEASE_TTL_MS).toISOString(),
  };
}

function unavailable(message: string): ErpnextBuyRuntimeQualificationError {
  return new ErpnextBuyRuntimeQualificationError(message);
}
