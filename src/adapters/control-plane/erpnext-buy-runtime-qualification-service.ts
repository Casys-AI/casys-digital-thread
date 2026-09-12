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
  qualificationAttemptKeyFor,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { fingerprintCapabilityRuntimeObservedHost } from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
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
    const fixture = this.options.fixture;
    if (!fixture) {
      throw unavailable("ERP Buy qualification fixture is absent.");
    }
    const identity = await this.#identity(candidate, review, spec);
    const at = this.#now();
    const lease = qualificationLease(candidate, at);
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
    const started = await this.options.groups.ensureQualificationActive({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      lease,
      at,
      reuseExistingLease: "allow",
      ...(secretSnapshot ? { secretSnapshot } : {}),
      guard: async () => {
        const current = await this.review(candidate.id);
        return fingerprintsEqual(
          current.reviewFingerprint,
          review.reviewFingerprint,
        );
      },
      prepareAfterAuthorization: async () => {
        await this.options.attempts.prepare(identity, { preparedAt: this.#now() });
      },
    });
    if (!started.qualificationStart) {
      throw unavailable("ERP Buy qualification start proof is absent.");
    }
    await this.options.attempts.markActive(identity, {
      runtimeStartFingerprint: started.qualificationStart.fingerprint,
    });
    await this.options.attempts.markCaseSubmitted(identity, {
      caseSha256: spec.caseFingerprint.digest,
      caseUri: `erpnext-buy-qualification-case:sha256:${spec.caseFingerprint.digest}`,
    });
    const claimedAt = this.#now();
    const claim = await this.options.attempts.claimDispatching(identity, {
      claimedAt,
      deadlineAt: new Date(Date.parse(claimedAt) + 5 * 60 * 1000).toISOString(),
    });
    if (!claim.dispatchNow) {
      throw unavailable("ERP Buy qualification dispatch is not available.");
    }
    const storedLease = await this.options.leases.read(lease.id);
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
    await this.options.attempts.markRecorded(identity, {
      receiptSha256: receipt.digest,
      receiptFingerprint: receipt,
    });
    await this.options.attempts.markOutcome(
      identity,
      await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status: "qualified",
        basis: "recorded",
        recordedAt: this.#now(),
        basisFingerprint: receipt,
      }),
    );
    const stopProof = await this.options.groups.releaseQualificationTerminal({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      startProofFingerprint: started.qualificationStart.fingerprint,
      lease: storedLease,
      at: this.#now(),
    });
    const stopped = await this.options.attempts.markStopped(identity, {
      runtimeStopProof: stopProof,
    });
    if (stopped.phase !== "stopped") {
      throw unavailable("ERP Buy qualification stop did not record a host stop proof.");
    }
    const attestation = await createCapabilityRuntimeQualificationAttestation({
      attempt: stoppedQualificationAttemptFrom(stopped),
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
    return await this.options.attempts.markAttested(identity, {
      attestationFingerprint: stored.fingerprint,
    });
  }

  async recover(candidateId: string): Promise<CapabilityRuntimeQualificationAttempt> {
    const candidate = this.#candidate(candidateId);
    const spec = this.#spec(candidate);
    const review = await this.review(candidateId);
    const identity = await this.#identity(candidate, review, spec);
    const attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(identity),
    );
    if (!attempt) {
      throw unavailable("ERP Buy qualification recovery requires a recorded attempt.");
    }
    return attempt;
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
