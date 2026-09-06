/** Durable qualification attempt orchestration for the fixed assembler adapter. */

import {
  fingerprintCapabilityRuntimeObservedHost,
  sameCapabilityRuntimeQualificationRevocationScope,
} from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  type CapabilityRuntimeQualificationAttempt,
  type CapabilityRuntimeQualificationAttemptIdentity,
  createCapabilityRuntimeQualificationAttemptOutcome,
  fingerprintCapabilityRuntimeQualificationAttempt,
  qualificationAttemptKeyFor,
} from "../../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { createCapabilityRuntimeQualificationIsolatedDestructionProof } from "../../../domain/capability/runtime/capability-runtime-qualification-stop-proof.ts";
import {
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type { CapabilityRuntimeQualificationAttestationStore } from "../../../application/ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import type { CapabilityRuntimeHostObservation } from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { FixedGeometryModuleAssembler } from "./fixed-geometry-module-assembler.ts";
import { FixedGeometryModuleAssemblyProfileCatalog } from "./fixed-geometry-module-assembly-profile.ts";
import {
  createGeometryModuleAssemblerMicrosandboxQualificationCapture,
  type FileGeometryModuleAssemblerMicrosandboxQualificationStore,
  type GeometryModuleAssemblerMicrosandboxQualificationReference,
} from "./geometry-module-assembly-microsandbox-qualification-capture.ts";
import {
  assertExactGeometryModuleAssemblerQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  type GeometryModuleAssemblerMicrosandboxQualificationCandidate,
} from "./geometry-module-assembly-microsandbox-qualification-candidate.ts";
import {
  assertExactGeometryModuleAssemblerQualificationReceipt,
  assertGeometryModuleAssemblerQualificationSemantics,
  createGeometryModuleAssemblerQualificationOutputValidator,
  createGeometryModuleAssemblerQualificationRevocationScope,
  type GeometryModuleAssemblerQualificationReceiptContext,
  rereadAndValidateGeometryModuleAssemblerQualificationOutputs,
} from "./geometry-module-assembly-microsandbox-qualification-helpers.ts";

/**
 * Private, adapter-owned qualification application service.  It owns no
 * product command; durable attempt state always precedes native dispatch.
 */
export interface GeometryModuleAssemblerQualificationServiceOptions {
  readonly candidate: () => Promise<
    GeometryModuleAssemblerMicrosandboxQualificationCandidate
  >;
  /**
   * Independent server-created expected authority. Omit only for the active
   * catalogue pin; imported-candidate qualification must pass the bound-record
   * factory rather than trust the supplied candidate value.
   */
  readonly expectedCandidate?: () => Promise<
    GeometryModuleAssemblerMicrosandboxQualificationCandidate
  >;
  readonly observedHost: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly profiles: FixedGeometryModuleAssemblyProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly publications: IsolatedOutputPublicationReader;
  readonly recovery: IsolatedCodeRunRecovery;
  /** Must recreate the reader: success is never an in-memory publication claim. */
  readonly restartPublications: () => IsolatedOutputPublicationReader;
  readonly attempts: CapabilityRuntimeQualificationAttemptStore;
  readonly attestations: CapabilityRuntimeQualificationAttestationStore;
  readonly captures: FileGeometryModuleAssemblerMicrosandboxQualificationStore;
  /**
   * Candidate-qualification successor only. The active-pin path never sets
   * this; IsolatedCodeRunner generation stays 0 on the successor run identity.
   */
  readonly executionRunId?: string;
  /** Test-only seam; the durable recheck below remains the authority boundary. */
  readonly beforeDispatchClaim?: () => Promise<void> | void;
  readonly now?: () => string;
}

export interface GeometryModuleAssemblerQualificationResult {
  readonly status: "qualified" | "unavailable" | "pending" | "revoked";
  readonly phase: CapabilityRuntimeQualificationAttempt["phase"];
  readonly runId: string;
  readonly capture: GeometryModuleAssemblerMicrosandboxQualificationReference | null;
  readonly attestationFingerprint: ContentFingerprint | null;
  readonly receiptFingerprint: ContentFingerprint | null;
}

const QUALIFICATION_DISPATCH_DEADLINE_MS = 5 * 60 * 1_000;

interface GeometryModuleAssemblerQualificationContext
  extends GeometryModuleAssemblerQualificationReceiptContext {
  readonly host: CapabilityRuntimeHostObservation;
  readonly profile: Awaited<
    ReturnType<FixedGeometryModuleAssemblyProfileCatalog["initial"]>
  >;
  readonly identity: CapabilityRuntimeQualificationAttemptIdentity;
}

interface GeometryModuleAssemblerQualificationDispatch {
  readonly attempt: CapabilityRuntimeQualificationAttempt;
  readonly revokedAfterClaim: boolean;
}

export class GeometryModuleAssemblerQualificationService {
  readonly #now: () => string;

  constructor(
    private readonly options: GeometryModuleAssemblerQualificationServiceOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async inspect(): Promise<{
    readonly runId: string;
    readonly identity: CapabilityRuntimeQualificationAttemptIdentity;
    readonly attempt: CapabilityRuntimeQualificationAttempt | undefined;
  }> {
    const context = await this.#context();
    return {
      runId: context.runId,
      identity: context.identity,
      attempt: await this.options.attempts.read(
        qualificationAttemptKeyFor(context.identity),
      ),
    };
  }

  async apply(): Promise<GeometryModuleAssemblerQualificationResult> {
    const context = await this.#context();
    let dispatchedNow = false;
    let attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(context.identity),
    );
    if (!attempt) {
      attempt = await this.options.attempts.prepare(context.identity, {
        preparedAt: this.#now(),
      });
    }
    if (attempt.phase === "prepared") {
      attempt = await this.options.attempts.markActive(context.identity, {
        runtimeStartFingerprint: context.profile.profileFingerprint,
      });
    }
    if (attempt.phase === "active") {
      attempt = await this.options.attempts.markCaseSubmitted(context.identity, {
        caseSha256: context.candidate.fixture.bundle.fingerprint.digest,
        caseUri:
          `geometry-module-input-bundle:sha256:${context.candidate.fixture.bundle.fingerprint.digest}`,
      });
    }
    if (attempt.phase === "case-submitted") {
      if (await this.#isRevoked(context)) {
        return resultOf(attempt, context.runId, "revoked");
      }
      const dispatched = await this.#dispatch(context);
      if (dispatched.revokedAfterClaim) {
        const settled = await this.#reconcile(context, dispatched.attempt, true);
        return Object.freeze({ ...settled, status: "revoked" as const });
      }
      attempt = dispatched.attempt;
      dispatchedNow = true;
    }
    return await this.#reconcile(context, attempt, dispatchedNow);
  }

  async recover(): Promise<GeometryModuleAssemblerQualificationResult> {
    const context = await this.#context();
    const attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(context.identity),
    );
    if (!attempt) {
      throw new Error(
        "Geometry-module qualification recovery requires an existing WAL attempt.",
      );
    }
    return await this.#reconcile(context, attempt);
  }

  async #context(): Promise<GeometryModuleAssemblerQualificationContext> {
    const [candidateValue, expectedCandidate, host, profile] = await Promise.all([
      this.options.candidate(),
      this.options.expectedCandidate?.() ??
        createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
      this.options.observedHost.read(),
      this.options.profiles.initial(),
    ]);
    const candidate = await assertExactGeometryModuleAssemblerQualificationCandidate(
      candidateValue,
      expectedCandidate,
    );
    if (host.platform !== "linux/arm64") {
      throw new Error(
        "Geometry-module qualification requires authoritative linux/arm64 host observation.",
      );
    }
    const observedHost = {
      identityFingerprint: host.identityFingerprint,
      platform: host.platform,
      fingerprint: await fingerprintCapabilityRuntimeObservedHost(
        host.platform,
        host.identityFingerprint,
      ),
    } as const;
    const reviewFingerprint = await sha256Fingerprint({
      schemaVersion: "geometry-module-assembler-microsandbox-qualification-review/1.0",
      candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
      observedHost,
      specification: candidate.specification.fingerprint,
      profile: profile.profileFingerprint,
    });
    const runId = this.options.executionRunId ??
      `geometry-module-assembler-qualification-${
        (
          await sha256Fingerprint({
            schemaVersion:
              "geometry-module-assembler-microsandbox-qualification-run/1.0",
            candidate: candidate.fingerprint,
            observedHost: observedHost.fingerprint,
            specification: candidate.specification.fingerprint,
          })
        ).digest
      }`;
    const identity: CapabilityRuntimeQualificationAttemptIdentity = {
      candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
      observedHost,
      reviewFingerprint,
      requestId: runId,
      sourceFingerprint: candidate.fixture.bundle.fingerprint,
      loweringFingerprint: candidate.profile.fingerprint,
      caseFingerprint: candidate.fixture.bundle.fingerprint,
      runRequestFingerprint: await sha256Fingerprint({
        schemaVersion: "geometry-module-assembler-qualification-run-request/1.0",
        runId,
        profile: profile.executionProfile,
        source: candidate.fixture.bundle.fingerprint,
        outputs: profile.outputManifest,
      }),
      qualificationSpecFingerprint: candidate.specification.fingerprint,
    };
    return { candidate, host, observedHost, profile, runId, identity };
  }

  async #isRevoked(
    context: GeometryModuleAssemblerQualificationContext,
  ): Promise<boolean> {
    const scope = await createGeometryModuleAssemblerQualificationRevocationScope(
      context,
      this.#now(),
    );
    return (await this.options.attestations.list()).some((event) =>
      event.state === "revoked" &&
      sameCapabilityRuntimeQualificationRevocationScope(event, scope)
    );
  }

  async #dispatch(
    context: GeometryModuleAssemblerQualificationContext,
  ): Promise<GeometryModuleAssemblerQualificationDispatch> {
    let revokedAfterClaim = false;
    const assembler = new FixedGeometryModuleAssembler({
      profiles: this.options.profiles,
      runner: this.options.runner,
      publications: this.options.publications,
      beforeDispatch: async (request) => {
        if (request.runId !== context.runId || request.producerGeneration !== 0) {
          throw new Error("Geometry-module qualification dispatch request drifted.");
        }
        await this.options.beforeDispatchClaim?.();
        const claimedAt = this.#now();
        const claim = await this.options.attempts.claimDispatching(context.identity, {
          claimedAt,
          deadlineAt: new Date(
            Date.parse(claimedAt) + QUALIFICATION_DISPATCH_DEADLINE_MS,
          ).toISOString(),
        });
        if (!claim.dispatchNow) {
          throw new Error(
            "Geometry-module qualification dispatch claim is already owned.",
          );
        }
        if (await this.#isRevoked(context)) {
          revokedAfterClaim = true;
          throw new Error(
            "Geometry-module qualification was revoked after its dispatch claim.",
          );
        }
      },
    });
    let neutral: Awaited<ReturnType<FixedGeometryModuleAssembler["assemble"]>>;
    try {
      neutral = await assembler.assemble({
        runId: context.runId,
        bundle: context.candidate.fixture.bundle,
      });
    } catch (cause) {
      if (!revokedAfterClaim) throw cause;
      const attempt = await this.options.attempts.read(
        qualificationAttemptKeyFor(context.identity),
      );
      if (!attempt || attempt.phase !== "dispatching") {
        throw new Error(
          "Geometry-module qualification revocation lost its durable dispatch claim.",
          { cause },
        );
      }
      return Object.freeze({ attempt, revokedAfterClaim: true });
    }
    const published = await this.options.publications.resolvePublicationByRunId(
      context.runId,
      0,
    );
    if (published.status !== "published") {
      throw new Error(
        "Geometry-module qualification assembly did not publish a native receipt.",
      );
    }
    const native = await this.options.publications.readReceipt(published.ref);
    if (
      !native || deterministicJson(isolatedCodeExecutionReceiptRecord(native)) !==
        deterministicJson(published.receipt)
    ) {
      throw new Error(
        "Geometry-module qualification native receipt cannot be recrossed.",
      );
    }
    await this.#recrossNeutralReceipt(context, neutral.receipt, native);
    const attempt = await this.options.attempts.read(
      qualificationAttemptKeyFor(context.identity),
    );
    if (!attempt || attempt.phase !== "dispatching") {
      throw new Error("Geometry-module qualification lost its durable dispatch claim.");
    }
    return Object.freeze({ attempt, revokedAfterClaim: false });
  }

  async #recrossNeutralReceipt(
    context: GeometryModuleAssemblerQualificationContext,
    neutral: Awaited<ReturnType<FixedGeometryModuleAssembler["assemble"]>>["receipt"],
    native: IsolatedCodeExecutionReceipt,
  ): Promise<void> {
    const record = isolatedCodeExecutionReceiptRecord(native);
    const step = record.outputs.find((output) => output.role === "assembly.step");
    const glb = record.outputs.find((output) => output.role === "assembly.glb");
    if (
      !step || !glb || neutral.runId !== context.runId ||
      neutral.inputBundle.byteCount !==
        context.candidate.fixture.bundle.bytes.byteLength ||
      !fingerprintsEqual(
        neutral.inputBundle.fingerprint,
        context.candidate.fixture.bundle.fingerprint,
      ) ||
      neutral.assembly.step.byteCount !== step.byteCount ||
      neutral.assembly.step.fingerprint.digest !== step.sha256 ||
      neutral.assembly.glb.byteCount !== glb.byteCount ||
      neutral.assembly.glb.fingerprint.digest !== glb.sha256 ||
      !fingerprintsEqual(
        neutral.implementation.evidenceFingerprint,
        await sha256Fingerprint(record),
      )
    ) {
      throw new Error(
        "Geometry-module qualification neutral receipt diverged from native publication.",
      );
    }
  }

  async #reconcile(
    context: GeometryModuleAssemblerQualificationContext,
    current: CapabilityRuntimeQualificationAttempt,
    allowCurrentDispatchReadback = false,
  ): Promise<GeometryModuleAssemblerQualificationResult> {
    let attempt = current;
    if (
      attempt.phase === "case-submitted" || attempt.phase === "active" ||
      attempt.phase === "prepared"
    ) {
      return resultOf(attempt, context.runId);
    }
    if (attempt.phase === "dispatching" || attempt.phase === "quarantined") {
      if (
        attempt.phase === "dispatching" && !allowCurrentDispatchReadback &&
        this.#now() < attempt.deadlineAt
      ) {
        return resultOf(attempt, context.runId);
      }
      let resolution;
      try {
        resolution = await this.options.publications.resolvePublicationByRunId(
          context.runId,
          0,
        );
      } catch {
        resolution = {
          status: "outcome-unknown" as const,
          runId: context.runId,
          producerGeneration: 0,
        };
      }
      if (resolution.status === "outcome-unknown") {
        if (attempt.phase === "dispatching") {
          attempt = await this.options.attempts.markQuarantined(context.identity, {
            reason: "uncertain",
          });
        }
        return resultOf(attempt, context.runId, "unavailable");
      }
      if (resolution.status === "not-published") {
        if (attempt.phase === "dispatching") {
          attempt = await this.options.attempts.markQuarantined(context.identity, {
            reason: "absent",
          });
        }
        if (attempt.phase !== "quarantined") {
          throw new Error(
            "Geometry-module qualification absence was not durably quarantined.",
          );
        }
        attempt = await this.#recordUnavailableQuarantine(context, attempt);
      } else if (resolution.status === "published") {
        if (
          attempt.phase === "quarantined" &&
          attempt.quarantineReason === "malformed"
        ) {
          attempt = await this.#recordUnavailableQuarantine(context, attempt);
        } else {
          try {
            attempt = await this.#recordPublished(context, resolution);
          } catch (cause) {
            if (attempt.phase !== "dispatching") throw cause;
            const quarantined = await this.options.attempts.markQuarantined(
              context.identity,
              { reason: "malformed" },
            );
            if (quarantined.phase !== "quarantined") {
              throw new Error(
                "Geometry-module qualification malformed publication was not durably quarantined.",
              );
            }
            attempt = await this.#recordUnavailableQuarantine(context, quarantined);
          }
        }
      }
    }
    if (attempt.phase === "recorded") {
      const outcome = await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status: "qualified",
        basis: "recorded",
        recordedAt: this.#now(),
        basisFingerprint: attempt.receiptFingerprint,
      });
      attempt = await this.options.attempts.markOutcome(context.identity, outcome);
    }
    if (attempt.phase === "outcome") {
      if (attempt.outcome.status !== "qualified") {
        if (attempt.outcome.basis === "quarantined") {
          attempt = await this.#stopUnavailableQuarantine(context, attempt);
        }
        return resultOf(attempt, context.runId, "unavailable");
      }
      const receipt = await this.#reopenPublished(context);
      const destruction = receipt.destruction;
      if (destruction.status !== "proven") {
        throw new Error(
          "Geometry-module qualification receipt lacks proven destruction.",
        );
      }
      attempt = await this.options.attempts.markStopped(context.identity, {
        runtimeStopProof:
          await createCapabilityRuntimeQualificationIsolatedDestructionProof({
            runId: context.runId,
            producerGeneration: 0,
            receiptFingerprint: await sha256Fingerprint(
              isolatedCodeExecutionReceiptRecord(receipt),
            ),
            destruction,
          }),
      });
    }
    if (attempt.phase === "stopped" && attempt.outcome.status === "qualified") {
      return await this.#attest(context, attempt);
    }
    if (attempt.phase === "attested") {
      return await this.#attest(context, { ...attempt, phase: "stopped" });
    }
    return resultOf(attempt, context.runId, "unavailable");
  }

  async #recordUnavailableQuarantine(
    context: GeometryModuleAssemblerQualificationContext,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "quarantined" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return await this.options.attempts.markOutcome(
      context.identity,
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

  async #stopUnavailableQuarantine(
    context: GeometryModuleAssemblerQualificationContext,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "outcome" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    if (
      attempt.outcome.status !== "unavailable" ||
      attempt.outcome.basis !== "quarantined"
    ) {
      throw new Error(
        "Geometry-module qualification cleanup requires a quarantined unavailable outcome.",
      );
    }
    let resolution;
    try {
      resolution = await this.options.publications.resolvePublicationByRunId(
        context.runId,
        0,
      );
    } catch (cause) {
      throw new Error(
        "Geometry-module qualification cleanup exact publication reread failed.",
        { cause },
      );
    }
    if (resolution.status === "outcome-unknown") {
      throw new Error(
        "Geometry-module qualification cleanup cannot destroy an outcome-unknown run.",
      );
    }
    if (resolution.status === "published") {
      let receipt: IsolatedCodeExecutionReceipt | undefined;
      try {
        ({ receipt } = await this.#reopenNativePublished(
          context,
          resolution,
        ));
      } catch {
        // The receipt is absent, divergent or structurally malformed. Preserve
        // the existing fail-closed recovery path; the concrete CAS broker is
        // the sole authority which may refuse a published-run abort.
      }
      if (
        receipt && receipt.destruction.status === "proven" &&
        receipt.destruction.runId === context.runId
      ) {
        const destruction = receipt.destruction;
        return await this.options.attempts.markStopped(context.identity, {
          runtimeStopProof:
            await createCapabilityRuntimeQualificationIsolatedDestructionProof({
              runId: context.runId,
              producerGeneration: 0,
              receiptFingerprint: await sha256Fingerprint(
                isolatedCodeExecutionReceiptRecord(receipt),
              ),
              destruction,
            }),
        });
      }
    }
    let destruction;
    try {
      destruction = await this.options.recovery.destroyByRunId(context.runId, 0);
    } catch (cause) {
      throw new Error(
        "Geometry-module qualification cleanup exact destruction failed.",
        {
          cause,
        },
      );
    }
    if (destruction.status !== "proven" || destruction.runId !== context.runId) {
      throw new Error("Geometry-module qualification cleanup is not proven.");
    }
    return await this.options.attempts.markStopped(context.identity, {
      runtimeStopProof:
        await createCapabilityRuntimeQualificationIsolatedDestructionProof({
          runId: context.runId,
          producerGeneration: 0,
          receiptFingerprint: null,
          destruction,
        }),
    });
  }

  async #recordPublished(
    context: GeometryModuleAssemblerQualificationContext,
    resolution: Extract<
      Awaited<ReturnType<IsolatedOutputPublicationReader["resolvePublicationByRunId"]>>,
      { readonly status: "published" }
    >,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const receipt = await this.#reopenPublished(context, resolution);
    const record = isolatedCodeExecutionReceiptRecord(receipt);
    if (deterministicJson(record) !== deterministicJson(resolution.receipt)) {
      throw new Error(
        "Geometry-module qualification native receipt diverged from its publication.",
      );
    }
    const restart = this.options.restartPublications();
    const afterRestart = await restart.resolvePublicationByRunId(context.runId, 0);
    if (
      afterRestart.status !== "published" ||
      deterministicJson(afterRestart.receipt) !== deterministicJson(record)
    ) {
      throw new Error(
        "Geometry-module qualification publication did not survive reader restart.",
      );
    }
    await this.#reopenPublished(context, afterRestart, restart);
    const fingerprint = await sha256Fingerprint(record);
    return await this.options.attempts.markRecorded(context.identity, {
      receiptSha256: fingerprint.digest,
      receiptFingerprint: fingerprint,
    });
  }

  async #reopenPublished(
    context: GeometryModuleAssemblerQualificationContext,
    known?: Extract<
      Awaited<ReturnType<IsolatedOutputPublicationReader["resolvePublicationByRunId"]>>,
      { readonly status: "published" }
    >,
    reader: IsolatedOutputPublicationReader = this.options.publications,
  ) {
    const { receipt, resolution } = await this.#reopenNativePublished(
      context,
      known,
      reader,
    );
    const receiptRecord = isolatedCodeExecutionReceiptRecord(receipt);
    const outputBytes = new Map<string, Uint8Array>();
    for (const output of receiptRecord.outputs) {
      const bytes = await reader.readPublishedObject(resolution.ref, output);
      if (
        !bytes || bytes.byteLength !== output.byteCount ||
        await fingerprintResourceBytes(bytes) !== output.sha256
      ) {
        throw new Error(
          `Geometry-module qualification ${output.role} bytes cannot be recrossed.`,
        );
      }
      outputBytes.set(output.role, bytes);
    }
    await rereadAndValidateGeometryModuleAssemblerQualificationOutputs(
      receiptRecord,
      [...outputBytes].map(([role, bytes]) => ({ role, bytes })),
      createGeometryModuleAssemblerQualificationOutputValidator(),
    );
    await assertGeometryModuleAssemblerQualificationSemantics(
      context.candidate,
      outputBytes,
    );
    if (
      receipt.destruction.status !== "proven" ||
      receipt.destruction.runId !== context.runId
    ) {
      throw new Error("Geometry-module qualification destruction proof is not exact.");
    }
    return receipt;
  }

  /**
   * Reopen only the native receipt contract: run, profile, policy, runtime,
   * output manifest and the durable resolution.  Qualification semantics are
   * intentionally not part of this check, because a semantically rejected
   * yet exact published result may still carry the sole valid destruction
   * proof for an unavailable outcome.
   */
  async #reopenNativePublished(
    context: GeometryModuleAssemblerQualificationContext,
    known?: Extract<
      Awaited<ReturnType<IsolatedOutputPublicationReader["resolvePublicationByRunId"]>>,
      { readonly status: "published" }
    >,
    reader: IsolatedOutputPublicationReader = this.options.publications,
  ): Promise<{
    readonly receipt: IsolatedCodeExecutionReceipt;
    readonly resolution: Extract<
      Awaited<ReturnType<IsolatedOutputPublicationReader["resolvePublicationByRunId"]>>,
      { readonly status: "published" }
    >;
  }> {
    const resolution = known ??
      await reader.resolvePublicationByRunId(context.runId, 0);
    if (resolution.status !== "published") {
      throw new Error(
        "Geometry-module qualification publication is not durably available.",
      );
    }
    const receipt = await reader.readReceipt(resolution.ref);
    if (
      !receipt ||
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(resolution.receipt)
    ) {
      throw new Error("Geometry-module qualification receipt cannot be recrossed.");
    }
    assertExactGeometryModuleAssemblerQualificationReceipt(
      context,
      isolatedCodeExecutionReceiptRecord(receipt),
    );
    for (const output of isolatedCodeExecutionReceiptRecord(receipt).outputs) {
      const bytes = await reader.readPublishedObject(resolution.ref, output);
      if (
        !bytes || bytes.byteLength !== output.byteCount ||
        await fingerprintResourceBytes(bytes) !== output.sha256
      ) {
        throw new Error(
          `Geometry-module qualification ${output.role} bytes cannot be recrossed.`,
        );
      }
    }
    return { receipt, resolution };
  }

  async #attest(
    context: GeometryModuleAssemblerQualificationContext,
    attempt: Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "stopped" }
    >,
  ): Promise<GeometryModuleAssemblerQualificationResult> {
    const receipt = await this.#reopenPublished(context);
    const resolution = await this.options.restartPublications()
      .resolvePublicationByRunId(context.runId, 0);
    if (resolution.status !== "published") {
      throw new Error(
        "Geometry-module qualification restart recross failed before attestation.",
      );
    }
    const outputBytes = await Promise.all(
      isolatedCodeExecutionReceiptRecord(receipt).outputs.map(async (output) => {
        const bytes = await this.options.restartPublications().readPublishedObject(
          resolution.ref,
          output,
        );
        if (!bytes) {
          throw new Error(
            `Geometry-module qualification ${output.role} restart reread is absent.`,
          );
        }
        return { role: output.role, bytes };
      }),
    );
    const capture = await createGeometryModuleAssemblerMicrosandboxQualificationCapture(
      {
        candidate: context.candidate,
        expectedCandidate: this.options.expectedCandidate,
        qualifiedAt: attempt.outcome.recordedAt,
        observedHost: context.host,
        receipt,
        publishedReceipt: resolution.receipt,
        outputBytes,
      },
    );
    const captureReference = await this.options.captures.save(capture);
    const append = await this.options.attestations.appendQualifiedUnlessRevoked(
      capture.attestation,
    );
    const stored = await this.options.attestations.read(
      capture.attestation.fingerprint,
    );
    const events = await this.options.attestations.list();
    const revoked = events.some((event) =>
      event.state === "revoked" &&
      sameCapabilityRuntimeQualificationRevocationScope(event, capture.attestation)
    );
    if (append.status === "revoked" || revoked) {
      return resultOf(attempt, context.runId, "revoked", captureReference);
    }
    if (
      !stored || deterministicJson(stored) !== deterministicJson(capture.attestation)
    ) {
      throw new Error(
        "Geometry-module qualification attestation did not survive durable reread.",
      );
    }
    const attested = await this.options.attempts.markAttested(context.identity, {
      attestationFingerprint: capture.attestation.fingerprint,
    });
    return resultOf(attested, context.runId, "qualified", captureReference);
  }
}

function resultOf(
  attempt: CapabilityRuntimeQualificationAttempt,
  runId: string,
  status: GeometryModuleAssemblerQualificationResult["status"] = "pending",
  capture: GeometryModuleAssemblerMicrosandboxQualificationReference | null = null,
): GeometryModuleAssemblerQualificationResult {
  return Object.freeze({
    status,
    phase: attempt.phase,
    runId,
    capture,
    attestationFingerprint: attempt.phase === "attested"
      ? attempt.attestationFingerprint
      : null,
    receiptFingerprint: status === "qualified" &&
        (attempt.phase === "attested" || attempt.phase === "stopped") &&
        attempt.outcome.status === "qualified" &&
        attempt.outcome.basis === "recorded"
      ? attempt.outcome.basisFingerprint
      : null,
  });
}
