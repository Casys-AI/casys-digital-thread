/**
 * Private host-local CalculiX HTTP qualification probe.
 *
 * This is deliberately an adapter-owned vertical: its recorded MCP wire
 * protocol, fixed STEP staging and factual result checks do not leak into the
 * Chrono application service. It is not an engineering run or a selector.
 */

import type { CapabilityRuntimeQualificationAttemptStore } from "../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../../application/ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import type { CapabilitySessionSolverInputStagerFactory } from "../../application/ports/out/solver-input-stager.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import {
  type CapabilityRuntimeQualificationAttempt,
  type CapabilityRuntimeQualificationAttemptIdentity,
  type CapabilityRuntimeQualificationAttemptOutcome,
  type CapabilityRuntimeQualificationQuarantineReason,
  type CapabilityRuntimeQualificationQuarantineResourceErrorKind,
  type CapabilityRuntimeQualificationQuarantineResourceFailure,
  type CapabilityRuntimeQualificationQuarantineResourceRole,
  type CapabilityRuntimeQualificationQuarantineStage,
  createCapabilityRuntimeQualificationAttemptOutcome,
  fingerprintCapabilityRuntimeQualificationAttempt,
  qualificationAttemptIdentityOf,
  qualificationAttemptKeyFor,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { fingerprintCapabilityRuntimeObservedHost } from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeQualificationStartAuthority,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import {
  assertRecordedCalculixResourceListBijection,
  CALCULIX_RECORDED_RESOURCE_ORDER,
  lowerRecordedCalculixStaticRequest,
  parseRecordedCalculixCompletedDispatch,
  parseRecordedCalculixCompletedReadback,
  type RecordedCalculixSensitivityProvider,
} from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import {
  assertCalculixHttpQualificationEvidence,
} from "./calculix-http-runtime-qualification-criteria.ts";
import {
  fingerprintCalculixHttpQualificationProtocol,
} from "./calculix-http-runtime-qualification-protocol.ts";
import {
  CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID,
  type CalculixHttpRuntimeQualificationCandidate,
  readCalculixHttpRuntimeQualificationFixtureStepBytes,
  validateCalculixHttpRuntimeQualificationCandidate,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import type { CapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { CapabilityRuntimeLaunchGroupRegistry } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeStateObserver } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { fingerprintCalculixHttpQualificationCriteria } from "./calculix-http-runtime-qualification-criteria.ts";
import {
  createCapabilityRuntimeQualificationAttestation,
  stoppedQualificationAttemptFrom,
} from "../../application/control-plane/capability-runtime-qualification-attestation-factory.ts";
import { matchesCapabilityRuntimeQualificationCandidate } from "../../application/control-plane/evaluate-capability-runtime-qualifications.ts";
import { McpResourceReadError } from "../shared/mcp/http-mcp-resource-reader.ts";

const LEASE_TTL_MS = 6 * 60 * 60 * 1000;
const DEADLINE_MS = 5 * 60 * 1000;

export class CalculixHttpRuntimeQualificationError extends Error {}
class CalculixHttpReadbackQuarantine extends Error {
  constructor(
    readonly reason: CapabilityRuntimeQualificationQuarantineReason,
    readonly stage: CapabilityRuntimeQualificationQuarantineStage,
    readonly resource?: {
      readonly role: CapabilityRuntimeQualificationQuarantineResourceRole;
      readonly failure: CapabilityRuntimeQualificationQuarantineResourceFailure;
      readonly errorKind?: CapabilityRuntimeQualificationQuarantineResourceErrorKind;
    },
  ) {
    super("CalculiX qualification readback requires quarantine.");
  }
}

export interface CalculixHttpRuntimeQualificationReview {
  readonly candidate: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly observedHost: {
    readonly platform: "linux/arm64";
    readonly identityFingerprint: ContentFingerprint;
    readonly fingerprint: ContentFingerprint;
  };
  readonly requestId: string;
  readonly runRequestFingerprint: ContentFingerprint;
  readonly reviewFingerprint: ContentFingerprint;
}

export interface CalculixHttpRuntimeQualificationServiceOptions {
  readonly candidates: readonly CalculixHttpRuntimeQualificationCandidate[];
  readonly specs: readonly CapabilityRuntimeQualificationSpecification[];
  readonly catalog: CapabilityRuntimeCatalog;
  readonly policy: { read(): Promise<CapabilityRuntimeAdminPolicy> };
  readonly lock: { read(): Promise<CapabilityRuntimeAdminLock> };
  readonly launchGroups: CapabilityRuntimeLaunchGroupRegistry;
  readonly states: CapabilityRuntimeStateObserver;
  readonly attempts: CapabilityRuntimeQualificationAttemptStore;
  readonly attestations: CapabilityRuntimeQualificationAttestationStore;
  readonly groups: CapabilityRuntimeLaunchGroupSupervisor;
  readonly host: {
    read(): Promise<
      { readonly platform: string; readonly identityFingerprint: ContentFingerprint }
    >;
  };
  readonly stagers: CapabilitySessionSolverInputStagerFactory;
  readonly provider: RecordedCalculixSensitivityProvider;
  /** Reads a provider resource after its ledger URI/digest has been validated. */
  readonly readResource: (resource: {
    readonly uri: string;
    readonly mediaType: string;
    readonly byteCount: number;
    readonly sha256: string;
  }) => Promise<Uint8Array>;
  readonly now?: () => string;
}

export class CalculixHttpRuntimeQualificationService {
  readonly #now: () => string;
  constructor(
    private readonly options: CalculixHttpRuntimeQualificationServiceOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async review(candidateId: string): Promise<CalculixHttpRuntimeQualificationReview> {
    const candidate = this.#candidate(candidateId);
    await validateCalculixHttpRuntimeQualificationCandidate(candidate);
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
      host.platform !== "linux/arm64" ||
      host.platform !== candidate.observedHostPlatform ||
      hostAgain.platform !== host.platform ||
      !fingerprintsEqual(host.identityFingerprint, hostAgain.identityFingerprint)
    ) {
      throw unavailable("CalculiX qualification requires a linux/arm64 host.");
    }
    if (policy.disabledBindingIds.includes(candidate.binding.id)) {
      throw unavailable("CalculiX qualification binding is administratively disabled.");
    }
    const lockUnit = lock.units.find((unit) => unit.id === candidate.unit.id);
    if (
      lockUnit && (lockUnit.version !== candidate.unit.version ||
        !fingerprintsEqual(
          lockUnit.manifestFingerprint,
          candidate.unit.manifestFingerprint,
        ))
    ) {
      throw unavailable("CalculiX qualification admin lock drifted.");
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
      binding.capability.id !== candidate.selector.capability.id ||
      binding.capability.version !== candidate.selector.capability.version ||
      binding.use !== candidate.selector.use ||
      binding.adapter.id !== candidate.contract.id ||
      binding.adapter.version !== candidate.contract.version ||
      binding.adapter.source !== candidate.contract.source ||
      binding.profile !== null || candidate.profile !== null ||
      binding.unitIds.length !== 1 || binding.unitIds[0] !== candidate.unit.id ||
      unit.version !== candidate.unit.version ||
      !fingerprintsEqual(
        unit.manifestFingerprint,
        candidate.unit.manifestFingerprint,
      ) ||
      digestFromReference(material.imageReference) !==
        candidate.material.imageDigest ||
      material.launchGroup?.id !== candidate.launchGroup.id ||
      material.launchGroup?.version !== candidate.launchGroup.version ||
      !fingerprintsEqual(
        material.launchGroup?.fingerprint,
        candidate.launchGroup.fingerprint,
      ) ||
      group.id !== candidate.launchGroup.id ||
      group.version !== candidate.launchGroup.version ||
      !fingerprintsEqual(group.fingerprint, candidate.launchGroup.fingerprint) ||
      group.security !== "reviewed" || group.secretSlots.length !== 0 ||
      material.effects.security !== "reviewed" || material.effects.privileged ||
      material.effects.dockerSocket || material.effects.devices.length !== 0
    ) {
      throw unavailable("CalculiX qualification authority facts drifted.");
    }
    const observedHost = {
      platform: "linux/arm64" as const,
      identityFingerprint: host.identityFingerprint,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        "linux/arm64",
        host.identityFingerprint,
      ),
    };
    const [protocolFingerprint, criteriaFingerprint] = await Promise.all([
      fingerprintCalculixHttpQualificationProtocol(),
      fingerprintCalculixHttpQualificationCriteria(),
    ]);
    if (
      !fingerprintsEqual(spec.candidate.fingerprint, candidate.fingerprint) ||
      !fingerprintsEqual(spec.sourceFingerprint, candidate.fixture.sourceFingerprint) ||
      !fingerprintsEqual(
        spec.loweringFingerprint,
        candidate.fixture.methodFingerprint,
      ) ||
      !fingerprintsEqual(spec.caseFingerprint, candidate.fixture.case.fingerprint) ||
      !fingerprintsEqual(spec.protocolFingerprint, protocolFingerprint) ||
      !fingerprintsEqual(spec.criteriaFingerprint, criteriaFingerprint)
    ) throw unavailable("CalculiX qualification specification drifted.");
    const qualified = events.filter((event) =>
      event.state === "qualified" &&
      matchesCapabilityRuntimeQualificationCandidate(
        event,
        candidate,
        observedHost,
        spec,
      )
    )
      .map((event) => event.fingerprint).toSorted((a, b) =>
        a.digest.localeCompare(b.digest)
      );
    const revoked = events.filter((event) =>
      event.state === "revoked" &&
      matchesCapabilityRuntimeQualificationCandidate(event, candidate, observedHost)
    )
      .map((event) => event.fingerprint).toSorted((a, b) =>
        a.digest.localeCompare(b.digest)
      );
    if (revoked.length > 0) throw unavailable("CalculiX qualification is revoked.");
    if (qualified.length > 1) {
      throw unavailable("Multiple live CalculiX qualification attestations exist.");
    }
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
      targetPlatform: candidate.targetPlatform,
      mode: candidate.mode,
      fixture: {
        id: candidate.fixture.id,
        fingerprint: candidate.fixture.sourceFingerprint,
      },
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint: candidate.fixture.methodFingerprint,
      caseFingerprint: candidate.fixture.case.fingerprint,
      protocolFingerprint,
      criteriaFingerprint,
      qualificationSpec: {
        id: spec.id,
        version: spec.version,
        fingerprint: spec.fingerprint,
      },
      policy: { calculixBindingDisabled: false as const },
      adminLock: { unit: lockUnit ?? null },
      hostEffects: material.effects,
      secretSlots: [] as const,
      attestations: { qualified, revoked },
    };
    const requestId = `calculix-qual-${(await sha256Fingerprint(core)).digest}`;
    const runRequestFingerprint = await sha256Fingerprint({
      schemaVersion: "calculix-http-qualification-run-request/1.0",
      ...core,
      requestId,
      caseFingerprint: candidate.fixture.case.fingerprint,
    });
    const body = { ...core, requestId, runRequestFingerprint };
    return { ...body, reviewFingerprint: await sha256Fingerprint(body) };
  }

  async apply(
    review: CalculixHttpRuntimeQualificationReview,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const fresh = await this.review(review.candidate.id);
    if (!fingerprintsEqual(fresh.reviewFingerprint, review.reviewFingerprint)) {
      throw unavailable("CalculiX qualification review is stale.");
    }
    return await this.#continue(
      this.#candidate(fresh.candidate.id),
      this.#identity(this.#candidate(fresh.candidate.id), fresh),
      true,
      fresh,
    );
  }

  async recover(candidateId: string): Promise<CapabilityRuntimeQualificationAttempt> {
    // Recovery deliberately reconstructs identity from the WAL.  Re-composing a
    // review here would let a later policy/lock/attestation change strand a
    // started host before its recorded solve can be read back and stopped.
    const candidate = this.#candidate(candidateId);
    await validateCalculixHttpRuntimeQualificationCandidate(candidate);
    const spec = this.#spec(candidate);
    const host = await this.options.host.read();
    if (host.platform !== "linux/arm64") {
      throw unavailable("CalculiX qualification recovery requires a linux/arm64 host.");
    }
    const observedHost = {
      platform: "linux/arm64" as const,
      identityFingerprint: host.identityFingerprint,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        "linux/arm64",
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
      throw unavailable(
        "CalculiX qualification recovery requires an existing WAL attempt.",
      );
    }
    return await this.#continue(
      candidate,
      await qualificationAttemptIdentityOf(current),
      false,
    );
  }

  async #continue(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    allowStart: boolean,
    review?: CalculixHttpRuntimeQualificationReview,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    await this.#assertHostMatchesIdentity(identity);
    let attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(identity),
    );
    let renewedLease: CapabilityRuntimeLease | undefined;
    const revoked = await this.#hasExactRevocation(candidate, identity);
    if (revoked && !attempt) {
      throw unavailable("CalculiX qualification is revoked.");
    }
    if (attempt?.phase === "attested") {
      if (revoked) throw unavailable("CalculiX qualification is revoked.");
      await this.#assertStoredAttestation(candidate, attempt);
      return attempt;
    }
    if (attempt?.phase === "start-failed-cleaned") {
      await this.options.groups.verifyFailedQualificationStartCleanupProof({
        group: candidate.launchGroup,
        expectedMaterials: [candidate.material],
        qualificationStartAuthority: startAuthority(identity),
        proof: attempt.cleanupProof,
      });
      return attempt;
    }
    if (attempt?.phase === "stopped") {
      await this.#verifyStopped(candidate, identity, attempt);
    }
    if (!attempt) {
      if (!allowStart) {
        throw unavailable(
          "CalculiX qualification recovery requires a prepared attempt.",
        );
      }
      const at = this.#now();
      const ensured = await this.options.groups.ensureQualificationActive({
        group: candidate.launchGroup,
        expectedMaterials: [candidate.material],
        qualificationStartAuthority: startAuthority(identity),
        lease: lease(candidate, at),
        at,
        reuseExistingLease: "allow",
        // The group declares no slots; no secret snapshot is minted or passed.
        guard: async () =>
          review !== undefined &&
          (await this.review(candidate.id)).reviewFingerprint.digest ===
            review.reviewFingerprint.digest,
        prepareAfterAuthorization: async () => {
          await this.options.attempts.prepare(identity, { preparedAt: this.#now() });
        },
      });
      if (!ensured.qualificationStart) {
        throw unavailable("CalculiX qualification start proof is absent.");
      }
      attempt = await this.options.attempts.markActive(identity, {
        runtimeStartFingerprint: ensured.qualificationStart.fingerprint,
      });
    }
    if (attempt.phase === "prepared") {
      const recovered = await this.options.groups.readQualificationStartProof({
        group: candidate.launchGroup,
        expectedMaterials: [candidate.material],
        qualificationStartAuthority: startAuthority(identity),
      });
      if (!recovered) {
        const cleanupAt = this.#now();
        const cleanupProof = await this.options.groups.releaseFailedQualificationStart({
          group: candidate.launchGroup,
          expectedMaterials: [candidate.material],
          qualificationStartAuthority: startAuthority(identity),
          lease: lease(candidate, cleanupAt),
          at: cleanupAt,
        });
        if (cleanupProof) {
          await this.options.groups.verifyFailedQualificationStartCleanupProof({
            group: candidate.launchGroup,
            expectedMaterials: [candidate.material],
            qualificationStartAuthority: startAuthority(identity),
            proof: cleanupProof,
          });
          return await this.options.attempts.markStartFailedCleaned(identity, {
            cleanupProof,
          });
        }
        if (revoked) throw unavailable("CalculiX qualification is revoked.");
        return attempt;
      }
      const at = this.#now();
      renewedLease = await this.options.groups.reacquireQualificationLease({
        group: candidate.launchGroup,
        expectedMaterials: [candidate.material],
        lease: lease(candidate, at),
        at,
      });
      attempt = await this.options.attempts.markActive(identity, {
        runtimeStartFingerprint: recovered.fingerprint,
      });
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
      if (!renewedLease) {
        const at = this.#now();
        renewedLease = await this.options.groups.reacquireQualificationLease({
          group: candidate.launchGroup,
          expectedMaterials: [candidate.material],
          lease: lease(candidate, at),
          at,
        });
      }
    }
    if (attempt.phase === "active") {
      if (revoked) {
        attempt = await this.#preDispatchUnavailable(identity, attempt);
      } else {
        const fixture = await readCalculixHttpRuntimeQualificationFixtureStepBytes(
          candidate,
        );
        const stager = await this.options.stagers.forActiveCapabilitySession({
          lease: renewedLease!,
          launchGroup: candidate.launchGroup,
          material: candidate.material,
        });
        const staged = await stager.stage({
          bytes: fixture,
          fingerprint: { algorithm: "sha256", digest: candidate.fixture.step.sha256 },
          byteCount: fixture.byteLength,
        });
        if (
          staged.stagedAsset.location !==
            `/inputs/fea-${candidate.fixture.step.sha256}.step`
        ) throw unavailable("CalculiX qualification staging path drifted.");
        attempt = await this.options.attempts.markCaseSubmitted(identity, {
          caseSha256: candidate.fixture.case.fingerprint.digest,
          caseUri:
            `calculix-http-qualification-case:sha256:${candidate.fixture.case.fingerprint.digest}`,
        });
      }
    }
    let recordedDispatch:
      | {
        readonly raw: unknown;
        readonly parsed: ReturnType<typeof parseRecordedCalculixCompletedDispatch>;
      }
      | undefined;
    if (attempt.phase === "case-submitted") {
      if (revoked) {
        attempt = await this.#preDispatchUnavailable(identity, attempt);
      } else {
        const claimedAt = this.#now();
        const claim = await this.options.attempts.claimDispatching(identity, {
          claimedAt,
          deadlineAt: deadline(claimedAt),
        });
        attempt = claim.attempt;
        if (claim.dispatchNow) {
          const request = lowerRecordedCalculixStaticRequest({
            requestId: identity.requestId,
            stepSha256: candidate.fixture.step.sha256,
            stagedPath: `/inputs/fea-${candidate.fixture.step.sha256}.step`,
            method: candidate.fixture.method,
          });
          let responseReceived = false;
          let response: unknown;
          try {
            response = await this.options.provider.callRecorded(request);
            responseReceived = true;
          } catch { /* recovery is readback-only after claim */ }
          if (responseReceived) {
            try {
              const parsed = parseRecordedCalculixCompletedDispatch(response);
              if (parsed.requestId !== identity.requestId) {
                throw new TypeError(
                  "CalculiX qualification dispatch acknowledged another request id.",
                );
              }
              recordedDispatch = { raw: response, parsed };
            } catch {
              // Dispatch already owns the durable request id, so a malformed
              // acknowledgement is an uncertain response rather than proof
              // that the provider failed. Keep the dispatching WAL and recover
              // exclusively through calculix_run_get below; never redispatch.
            }
          }
        }
      }
    }
    if (
      attempt.phase === "dispatching" ||
      (attempt.phase === "quarantined" &&
        attempt.quarantineReason !== "malformed")
    ) {
      attempt = await this.#readback(
        candidate,
        identity,
        attempt,
        recordedDispatch,
      );
    }
    if (
      attempt.phase === "quarantined" &&
      attempt.quarantineReason === "malformed"
    ) {
      attempt = await this.#unavailableOutcome(identity, attempt);
    }
    if (attempt.phase === "recorded") {
      attempt = await this.#outcomeRecorded(candidate, identity, attempt);
    }
    if (attempt.phase === "dispatching" || attempt.phase === "quarantined") {
      if (this.#now() < attempt.deadlineAt) return attempt;
      attempt = await this.options.attempts.sealDispatchDeadline(identity);
      if (attempt.phase === "quarantined") {
        attempt = await this.#unavailableOutcome(identity, attempt);
      }
    }
    if (attempt.phase === "outcome") {
      attempt = await this.#stop(candidate, identity, attempt);
    }
    if (attempt.phase === "stopped" && attempt.outcome.status === "qualified") {
      attempt = await this.#attest(candidate, identity, attempt);
    }
    return attempt;
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

  async #readback(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "dispatching" | "quarantined" }
    >,
    recordedDispatch?: {
      readonly raw: unknown;
      readonly parsed: ReturnType<typeof parseRecordedCalculixCompletedDispatch>;
    },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    let evidence: {
      readonly receiptFingerprint: ContentFingerprint;
      readonly criteriaError: boolean;
    };
    try {
      evidence = await this.#readCompletedEvidence(
        candidate,
        identity.requestId,
        recordedDispatch,
      );
    } catch (error) {
      if (attempt.phase === "quarantined") return attempt;
      if (error instanceof CalculixHttpReadbackQuarantine) {
        return await this.options.attempts.markQuarantined(identity, {
          reason: error.reason,
          stage: error.stage,
          ...(error.resource === undefined ? {} : {
            resourceRole: error.resource.role,
            resourceFailure: error.resource.failure,
            ...(error.resource.errorKind === undefined ? {} : {
              resourceErrorKind: error.resource.errorKind,
            }),
          }),
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return await this.options.attempts.markQuarantined(identity, {
        reason: /not_found|outcome_unknown/.test(message) ? "absent" : "malformed",
      });
    }
    // Persist only a fully parsed, byte-checked, and criteria-checked
    // readback. Storage failures must escape: swallowing one here could turn a
    // crash after a durable `recorded` transition into a contradictory
    // quarantine attempt instead of allowing recorded-WAL recovery.
    const recorded = await this.options.attempts.markRecorded(identity, {
      receiptSha256: evidence.receiptFingerprint.digest,
      receiptFingerprint: evidence.receiptFingerprint,
    });
    if (recorded.phase !== "recorded") return recorded;
    return await this.#outcomeFromEvidence(identity, recorded, evidence);
  }

  async #outcomeRecorded(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "recorded" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    let evidence: {
      readonly receiptFingerprint: ContentFingerprint;
      readonly criteriaError: boolean;
    };
    try {
      evidence = await this.#readCompletedEvidence(candidate, identity.requestId);
    } catch {
      // A transient reread after the recorded WAL cannot manufacture either a
      // qualified or a failed outcome. Recovery may retry the same read only.
      return attempt;
    }
    return await this.#outcomeFromEvidence(identity, attempt, evidence);
  }

  async #outcomeFromEvidence(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "recorded" }
    >,
    evidence: {
      readonly receiptFingerprint: ContentFingerprint;
      readonly criteriaError: boolean;
    },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const status = evidence.criteriaError ||
        !fingerprintsEqual(
          evidence.receiptFingerprint,
          attempt.receiptFingerprint,
        )
      ? "failed" as const
      : "qualified" as const;
    return await this.options.attempts.markOutcome(
      identity,
      await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status,
        basis: "recorded",
        recordedAt: this.#now(),
        basisFingerprint: attempt.receiptFingerprint,
      }),
    );
  }

  async #readCompletedEvidence(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    requestId: string,
    recordedDispatch?: {
      readonly raw: unknown;
      readonly parsed: ReturnType<typeof parseRecordedCalculixCompletedDispatch>;
    },
  ): Promise<{
    readonly receiptFingerprint: ContentFingerprint;
    readonly criteriaError: boolean;
  }> {
    let readback: unknown;
    try {
      readback = await this.options.provider.getRun(requestId);
    } catch {
      throw new CalculixHttpReadbackQuarantine(
        "uncertain",
        "provider-readback",
      );
    }
    const dispatch = recordedDispatch?.parsed;
    const readbackStatus = calculixIncompleteReadbackStatus(readback);
    if (readbackStatus !== undefined) {
      throw new CalculixHttpReadbackQuarantine(
        readbackStatus === "dispatched" ? "uncertain" : "absent",
        "provider-readback",
      );
    }
    let parsed: ReturnType<typeof parseRecordedCalculixCompletedReadback>;
    try {
      parsed = parseRecordedCalculixCompletedReadback(readback, {
        requestId,
        stepSha256: candidate.fixture.step.sha256,
        stepBytes: candidate.fixture.step.byteCount,
        dispatch,
      });
      if (parsed.artifacts.length !== CALCULIX_RECORDED_RESOURCE_ORDER.length) {
        throw new TypeError("CalculiX qualification ledger length drifted.");
      }
    } catch {
      throw new CalculixHttpReadbackQuarantine(
        "malformed",
        "provider-readback",
      );
    }
    let listed: unknown;
    try {
      listed = await this.options.provider.listResources();
    } catch {
      throw new CalculixHttpReadbackQuarantine(
        "uncertain",
        "provider-resource-list",
      );
    }
    try {
      assertRecordedCalculixResourceListBijection(listed, {
        phase: "base",
        stepSha256: candidate.fixture.step.sha256,
        stepBytes: candidate.fixture.step.byteCount,
        requestId: parsed.requestId,
        runId: parsed.runId,
        requestSha256: parsed.requestSha256,
        resources: parsed.artifacts,
        canonicalText: "",
        fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      });
    } catch {
      throw new CalculixHttpReadbackQuarantine(
        "malformed",
        "provider-resource-list",
      );
    }
    const bytes = new Map<string, Uint8Array>();
    for (const resource of parsed.artifacts) {
      const resourceRole = qualificationResourceRole(resource.role);
      let resourceBytes: Uint8Array;
      try {
        resourceBytes = await this.options.readResource({
          uri: resource.uri,
          mediaType: resource.mediaType,
          byteCount: resource.byteCount,
          sha256: resource.sha256,
        });
      } catch (error) {
        throw new CalculixHttpReadbackQuarantine(
          "malformed",
          "provider-resource-content",
          {
            role: resourceRole,
            failure: "read-error",
            errorKind: qualificationResourceReadErrorKind(error),
          },
        );
      }
      if (
        resourceBytes.byteLength !== resource.byteCount ||
        await fingerprintResourceBytes(resourceBytes) !== resource.sha256
      ) {
        throw new CalculixHttpReadbackQuarantine(
          "malformed",
          "provider-resource-content",
          { role: resourceRole, failure: "byte-or-digest-mismatch" },
        );
      }
      bytes.set(resource.role, resourceBytes);
    }
    const receiptFingerprint = await sha256Fingerprint({
      requestId: parsed.requestId,
      runId: parsed.runId,
      requestSha256: parsed.requestSha256,
      resources: parsed.artifacts,
    });
    let criteriaError = false;
    try {
      await assertCalculixHttpQualificationEvidence(candidate, {
        requestId,
        recordedDispatch: recordedDispatch?.raw,
        recordedReadback: readback,
        requestJsonBytes: bytes.get("request.json")!,
        resultJsonBytes: bytes.get("result.json")!,
      });
    } catch {
      criteriaError = true;
    }
    return { receiptFingerprint, criteriaError };
  }

  async #unavailableOutcome(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return await this.options.attempts.markOutcome(
      identity,
      await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status: "unavailable",
        basis: "quarantined",
        recordedAt: this.#now(),
        basisFingerprint: await fingerprintCapabilityRuntimeQualificationAttempt(
          attempt,
        ),
      }),
    );
  }

  async #stop(
    candidate: CalculixHttpRuntimeQualificationCandidate,
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
      lease: lease(candidate, at),
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
      throw unavailable("CalculiX qualification stop did not persist a stopped WAL.");
    }
    return await this.#verifyStopped(candidate, identity, stopped);
  }

  async #verifyStopped(
    candidate: CalculixHttpRuntimeQualificationCandidate,
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
      throw unavailable("CalculiX qualification requires an H1 host stop proof.");
    }
    await this.options.groups.verifyQualificationStopProof({
      group: candidate.launchGroup,
      expectedMaterials: [candidate.material],
      qualificationStartAuthority: startAuthority(identity),
      proof: attempt.runtimeStopProof,
    });
    const states = await this.options.states.observe([candidate.material]);
    if (
      states.get(capabilityRuntimeMaterialKey(candidate.material))?.runtime !==
        "inactive"
    ) {
      throw unavailable("CalculiX qualification host is still active after stop.");
    }
    return attempt;
  }

  async #attest(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "stopped" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    await this.#verifyStopped(candidate, identity, attempt);
    await this.#assertHostMatchesIdentity(identity);
    if (await this.#hasExactRevocation(candidate, identity)) {
      throw unavailable("CalculiX qualification is revoked.");
    }
    const attestation = await createCapabilityRuntimeQualificationAttestation({
      attempt,
      candidate,
      spec: this.#spec(candidate),
    });
    const appended = await this.options.attestations.appendQualifiedUnlessRevoked(
      attestation,
    );
    if (appended.status === "revoked") {
      throw unavailable("CalculiX qualification is revoked.");
    }
    const stored = await this.options.attestations.read(attestation.fingerprint);
    if (!stored || !fingerprintsEqual(stored.fingerprint, attestation.fingerprint)) {
      throw unavailable("CalculiX qualification attestation was not readable.");
    }
    // The append is not the terminal WAL transition. Re-establish both of its
    // environmental predicates immediately before marking the WAL attested so
    // a concurrent revocation or runtime reactivation cannot be hidden by an
    // otherwise valid stored event.
    if (await this.#hasExactRevocation(candidate, identity)) {
      throw unavailable("CalculiX qualification is revoked.");
    }
    await this.#verifyStopped(candidate, identity, attempt);
    return await this.options.attempts.markAttested(identity, {
      attestationFingerprint: stored.fingerprint,
    });
  }

  async #hasExactRevocation(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<boolean> {
    return (await this.options.attestations.list()).some((event) =>
      event.state === "revoked" && matchesCapabilityRuntimeQualificationCandidate(
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
      throw unavailable("CalculiX qualification host identity drifted.");
    }
  }

  async #assertStoredAttestation(
    candidate: CalculixHttpRuntimeQualificationCandidate,
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
      !stored || !fingerprintsEqual(stored.fingerprint, expected.fingerprint) ||
      !fingerprintsEqual(attempt.attestationFingerprint, expected.fingerprint)
    ) {
      throw unavailable("CalculiX attested WAL does not match the stored event.");
    }
  }

  #candidate(id: string): CalculixHttpRuntimeQualificationCandidate {
    const values = this.options.candidates.filter((value) => value.id === id);
    if (
      id !== CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID ||
      values.length !== 1 || !values[0]
    ) {
      throw unavailable(
        "CalculiX qualification requires the exact code-owned candidate.",
      );
    }
    return values[0];
  }
  #spec(
    candidate: CalculixHttpRuntimeQualificationCandidate,
  ): CapabilityRuntimeQualificationSpecification {
    const values = this.options.specs.filter((value) =>
      value.candidate.id === candidate.id &&
      fingerprintsEqual(value.candidate.fingerprint, candidate.fingerprint)
    );
    if (values.length !== 1 || !values[0]) {
      throw unavailable("CalculiX qualification requires one exact specification.");
    }
    return values[0];
  }
  #identity(
    candidate: CalculixHttpRuntimeQualificationCandidate,
    review: CalculixHttpRuntimeQualificationReview,
  ): CapabilityRuntimeQualificationAttemptIdentity {
    return {
      candidate: {
        id: review.candidate.id,
        fingerprint: review.candidate.fingerprint,
      },
      observedHost: review.observedHost,
      reviewFingerprint: review.reviewFingerprint,
      requestId: review.requestId,
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint: candidate.fixture.methodFingerprint,
      caseFingerprint: candidate.fixture.case.fingerprint,
      runRequestFingerprint: review.runRequestFingerprint,
      qualificationSpecFingerprint: this.#spec(candidate).fingerprint,
    };
  }
}

function calculixIncompleteReadbackStatus(
  value: unknown,
): "dispatched" | "not_found" | "outcome_unknown" | undefined {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== "1.0"
  ) return undefined;
  const status = (value as Record<string, unknown>).status;
  return status === "dispatched" || status === "not_found" ||
      status === "outcome_unknown"
    ? status
    : undefined;
}

function qualificationResourceRole(
  value: string,
): CapabilityRuntimeQualificationQuarantineResourceRole {
  if (
    CALCULIX_RECORDED_RESOURCE_ORDER.includes(
      value as (typeof CALCULIX_RECORDED_RESOURCE_ORDER)[number],
    )
  ) return value as CapabilityRuntimeQualificationQuarantineResourceRole;
  throw new TypeError("CalculiX qualification resource role drifted.");
}

function qualificationResourceReadErrorKind(
  error: unknown,
): CapabilityRuntimeQualificationQuarantineResourceErrorKind {
  return error instanceof McpResourceReadError ? error.kind : "unexpected";
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
function lease(
  candidate: CalculixHttpRuntimeQualificationCandidate,
  at: string,
): CapabilityRuntimeLease {
  return {
    id: "capability-runtime-qualification-calculix-http-arm64-native-v1",
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    bindingIds: [candidate.binding.id],
    materialKeys: [capabilityRuntimeMaterialKey(candidate.material)],
    launchGroups: [candidate.launchGroup],
    acquiredAt: at,
    expiresAt: deadline(at, LEASE_TTL_MS),
  };
}
function deadline(at: string, ms = DEADLINE_MS): string {
  return new Date(Date.parse(at) + ms).toISOString();
}
function digestFromReference(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  return index < 0 ? "" : reference.slice(index + marker.length);
}
function unavailable(message: string): CalculixHttpRuntimeQualificationError {
  return new CalculixHttpRuntimeQualificationError(message);
}
