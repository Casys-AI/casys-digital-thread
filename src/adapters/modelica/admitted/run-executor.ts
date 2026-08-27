/**
 * Trusted executor for `simulate.run-admitted-modelica@1`.
 *
 * Reopens one sealed Modelica compilation and runs those exact `.mo` bytes
 * in the server-owned isolated worker. Callers never supply Modelica text.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import {
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
  type IsolatedCodeRunRecovery,
  type IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  AdmittedModelicaExecutionAttempt,
  AdmittedModelicaExecutionAttemptIdentity,
  AdmittedModelicaExecutionAttemptKey,
  AdmittedModelicaExecutionAttemptStore,
  AdmittedModelicaExecutionThreadEvidence,
} from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import { fingerprintAdmittedModelicaExecutionAttemptIdentity } from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  AdmittedModelicaExecutionProfileCatalog,
} from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
import {
  decideAdmittedModelicaAttemptResume,
} from "../../../application/use-cases/modelica/admitted/attempt-resume-policy.ts";
import {
  type AdmittedExecutionRequest,
  assertAdmittedModelicaAdmissionScope,
  assertSameReviewedAdmittedModelicaAuthority,
  reopenAdmittedExecutionRequest,
  requireAdmittedModelicaExecutionShape,
  requireReviewedAdmittedModelicaAuthority,
  type ReviewedAdmittedModelicaAuthority,
} from "../../../application/use-cases/modelica/admitted/reopen-reviewed-execution.ts";
import {
  assertFailedIsolatedOutputValidationReplay,
  isolatedOutputValidationFailedMessage,
} from "../../../application/use-cases/compile/isolation/failed-isolated-output-validation-replay.ts";
import {
  ADMITTED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED,
  assertAdmittedModelicaCommandReceiptExact,
  assertCompletedAdmittedModelicaBinding,
  claimCommand,
  commandStep,
  completionCommand,
  failCommand,
  publishCommand,
  requireAdmittedModelicaCommandReceipt,
  requireAdmittedModelicaCompletedReceipts,
} from "../../../application/use-cases/modelica/admitted/completed-replay-verification.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type ModelicaAdmittedExecutionCapture,
  validateModelicaAdmittedExecutionCapture,
} from "../../../domain/modelica/admitted/execution-evidence.ts";
import {
  assertThreadEvidenceExact as assertDomainThreadEvidenceExact,
  buildDocumentarySuccessor as buildDomainDocumentarySuccessor,
  type DocumentarySuccessor,
  exactAdmissionArtifact as findExactAdmissionArtifact,
  threadEvidenceFor,
} from "../../../domain/modelica/admitted/documentary-thread-evidence.ts";
import { buildAdmittedModelicaPublishedOutputCapture } from "../../../domain/modelica/admitted/published-output-evidence.ts";
import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputValidationRejection,
  validateIsolatedCodeExecutionDestruction,
  validateIsolatedCodeOutputValidationRejection,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { safeId } from "../../../domain/kernel/case-validation.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../../domain/modelica/admitted/run-proposal.ts";

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

export { reopenAdmittedExecutionRequest, SIMULATE_RUN_ADMITTED_MODELICA_OPERATION };

/**
 * Terminal admitted-Modelica conversion of a public isolated output-validation
 * rejection. It carries only the registered role, observed size/digest and
 * proven destruction; no worker diagnostic, bytes, path or handle.
 */
export class IsolatedAdmittedModelicaOutputValidationRejectedError extends Error {
  readonly code = "output_validation_rejected" as const;
  readonly executionRunId: string;
  readonly observation: IsolatedCodeOutputValidationRejection;
  readonly destruction: Extract<
    IsolatedCodeExecutionReceipt["destruction"],
    { readonly status: "proven" }
  >;

  constructor(input: {
    readonly executionRunId: string;
    readonly observation: IsolatedCodeOutputValidationRejection;
    readonly destruction: IsolatedCodeExecutionReceipt["destruction"];
  }) {
    super(
      "A code-owned isolated admitted Modelica output validator rejected the observed bytes; no redispatch occurs.",
    );
    this.name = "IsolatedAdmittedModelicaOutputValidationRejectedError";
    this.executionRunId = safeId(input.executionRunId, "$rejection.executionRunId");
    this.observation = validateIsolatedCodeOutputValidationRejection(
      input.observation,
    );
    const destruction = validateIsolatedCodeExecutionDestruction(
      input.destruction,
      this.executionRunId,
    );
    if (destruction.status !== "proven") {
      throw new TypeError("Output-validation rejection requires proven destruction.");
    }
    this.destruction = destruction;
  }
}

type ReviewedAuthority = ReviewedAdmittedModelicaAuthority;
const requireReviewedAuthority = requireReviewedAdmittedModelicaAuthority;
const assertAdmissionScope = assertAdmittedModelicaAdmissionScope;
const assertSameAuthority = assertSameReviewedAdmittedModelicaAuthority;
const requireExecutionShape = requireAdmittedModelicaExecutionShape;

export interface AdmittedModelicaThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AdmittedModelicaExecutionCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<{ readonly uri: string; readonly fingerprint: ContentFingerprint }>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface SimulateRunAdmittedModelicaRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: AdmittedModelicaThreadSnapshotStore;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedModelicaExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
  readonly attempts: AdmittedModelicaExecutionAttemptStore;
  readonly captures: AdmittedModelicaExecutionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

interface PersistedAdmittedExecutionCapture {
  readonly capture: ModelicaAdmittedExecutionCapture;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export class SimulateRunAdmittedModelicaRunExecutor {
  constructor(
    private readonly d: SimulateRunAdmittedModelicaRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a reviewed admitted Modelica run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    const authority = await requireReviewedAuthority(project, run);
    assertAdmissionScope(project, run, authority.decision, authority.admission);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, authority),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    initial: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    let authority = await requireReviewedAuthority(project, run);
    assertSameAuthority(initial, authority);
    assertAdmissionScope(project, run, authority.decision, authority.admission);
    if (run.status === "completed") {
      return await this.#reopenCompleted(origin, command, authority);
    }
    if (run.status === "failed") {
      return await this.#reopenFailedOutputValidation(origin, command);
    }
    if (
      run.status !== "queued" && run.status !== "running" &&
      run.status !== "publishing"
    ) {
      throw unexpectedStatus(run, "queued or this agent's running/publishing");
    }
    await assertThreadWriteBasisAvailable(project, run);
    const preClaimBasis = requireBasis(run);
    const preClaimSnapshot = await exactBasisSnapshot(
      this.d.snapshots,
      preClaimBasis,
      true,
    );
    await assertThreadSnapshotLineageIntact(preClaimSnapshot, this.d.snapshots);
    exactAdmissionArtifact(
      preClaimSnapshot,
      authority.admission.admissionArtifact.id,
      authority.admission.admissionArtifact.fingerprint,
    );
    await reopenAdmittedExecutionRequest({
      admissions: this.d.admissions,
      profiles: this.d.profiles,
      project,
      run,
      admission: authority.admission,
    });
    const firstClaim = run.status === "queued";
    if (firstClaim) {
      await this.d.commands.claimRun(origin, claimCommand(command));
    } else {
      requireClaimedShape(project, run, origin);
      await this.#replayClaim(origin, command);
    }
    try {
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        return await this.#reopenCompleted(origin, command, authority);
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }
      authority = await requireReviewedAuthority(project, run);
      assertSameAuthority(initial, authority);
      assertAdmissionScope(project, run, authority.decision, authority.admission);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, true);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
      exactAdmissionArtifact(
        basisSnapshot,
        authority.admission.admissionArtifact.id,
        authority.admission.admissionArtifact.fingerprint,
      );
      const context = await reopenAdmittedExecutionRequest({
        admissions: this.d.admissions,
        profiles: this.d.profiles,
        project,
        run,
        admission: authority.admission,
      });
      const identity = await attemptIdentity(
        project,
        run,
        basisSnapshot,
        authority,
        context,
      );
      const attemptFingerprint =
        await fingerprintAdmittedModelicaExecutionAttemptIdentity(identity);
      const key: AdmittedModelicaExecutionAttemptKey = {
        projectId: command.projectId,
        agentRunId: run.id,
        executionRunId: context.request.runId,
        attemptFingerprint,
      };
      let attempt = await this.d.attempts.read(command.projectId, run.id);
      if (firstClaim) {
        if (attempt) {
          throw invalidTransition(
            "A freshly claimed admitted Modelica run already has a durable execution journal.",
          );
        }
        attempt = await this.d.attempts.prepare(identity, requiredStart(run));
      } else if (!attempt) {
        throw invalidTransition(
          "The admitted Modelica run is already active but has no durable execution journal; it is quarantined and will not be dispatched.",
        );
      }
      assertAttemptIdentity(attempt, key, identity);

      if (run.status === "publishing") {
        return await this.#resumePublishingReadOnly(
          origin,
          command,
          project,
          run,
          basisSnapshot,
          context,
          attempt,
          key,
        );
      }

      attempt = await this.#advanceRunningAttempt(
        context,
        attempt,
        key,
        requiredStart(run),
      );
      if (attempt.phase !== "output-published") {
        throw invalidTransition(
          "The admitted Modelica execution did not reach durable output publication.",
        );
      }
      const receipt = await this.#reopenReceipt(attempt.receiptRecord);
      const persistedCapture = await this.#persistCapture(
        project,
        run,
        context,
        receipt,
      );
      const expected = buildDocumentarySuccessor({
        basisSnapshot,
        basis,
        run,
        capture: persistedCapture.capture,
        captureFingerprint: persistedCapture.fingerprint,
        captureUri: persistedCapture.uri,
        receipt,
      });
      await this.#saveAndReopenThread(expected);
      project = await this.#requiredProject(command.projectId);
      await this.#publishExact(origin, project, command);
      project = await this.#requiredProject(command.projectId);
      await this.#completeExact(origin, project, command, expected);
      const completed = await this.#requiredProject(command.projectId);
      await this.#assertCompletedEvidence(
        origin,
        completed,
        command,
        run,
        expected,
        persistedCapture,
        context,
        attempt,
      );
      await this.#completeAttempt(attempt, key, expected);
      return completed;
    } catch (error) {
      if (error instanceof IsolatedAdmittedModelicaOutputValidationRejectedError) {
        return await this.#failOutputValidationRejected(origin, command, error);
      }
      throw invalidTransition(
        "The admitted Modelica execution or documentary Thread publication has a durable or uncertain effect. " +
          "Retry this exact command. " +
          `Cause: ${boundedCause(error)}`,
      );
    }
  }

  async #advanceRunningAttempt(
    context: AdmittedExecutionRequest,
    initial: AdmittedModelicaExecutionAttempt,
    key: AdmittedModelicaExecutionAttemptKey,
    dispatchedAt: string,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    let attempt = initial;
    const decision = decideAdmittedModelicaAttemptResume({
      phase: attempt.phase,
      executionRunId: key.executionRunId,
      producerGeneration: "dispatch" in attempt
        ? attempt.dispatch.producerGeneration
        : undefined,
    });
    if (decision.action === "already-published") return attempt;
    if (decision.action === "already-output-validation-rejected") {
      return throwOutputValidationRejected(attempt);
    }
    if (decision.action === "transition-g0") {
      if (attempt.phase !== "prepared") {
        throw invalidTransition(
          "The admitted Modelica journal phase is not recoverable.",
        );
      }
      const transition = await this.d.attempts.markDispatching({
        ...key,
        dispatchedAt,
      });
      attempt = transition.attempt;
      assertAttemptIdentity(attempt, key, initial.identity);
      if (
        attempt.phase !== "dispatching" ||
        attempt.dispatch.producerGeneration !== 0
      ) {
        throw invalidTransition(
          "The admitted Modelica generation-zero dispatch acknowledgement is not exact.",
        );
      }
      // Only this local transitioned-now may call runner.run.
      return transition.outcome === "transitioned-now"
        ? await this.#dispatchOnceOrRecover(context, attempt, key)
        : await this.#recoverDispatch(context, attempt, key, dispatchedAt);
    }
    if (decision.action === "advance-g1") {
      if (attempt.phase !== "generation-zero-cleaned") {
        throw invalidTransition(
          "The admitted Modelica journal phase is not recoverable.",
        );
      }
      return await this.#redispatchGenerationOne(
        context,
        attempt,
        key,
        dispatchedAt,
      );
    }
    if (decision.action === "read-publication") {
      if (attempt.phase !== "dispatching") {
        throw invalidTransition(
          "The admitted Modelica journal phase is not recoverable.",
        );
      }
      return await this.#recoverDispatch(context, attempt, key, dispatchedAt);
    }
    throw invalidTransition(
      decision.action === "quarantine"
        ? decision.message
        : "The admitted Modelica journal phase is not recoverable.",
    );
  }

  async #dispatchOnceOrRecover(
    context: AdmittedExecutionRequest,
    attempt: Extract<AdmittedModelicaExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedModelicaExecutionAttemptKey,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    try {
      const receipt = await this.d.runner.run(
        requestForGeneration(context.request, attempt.dispatch.producerGeneration),
      );
      return await this.#recordPublishedReceipt(attempt, key, receipt);
    } catch (error) {
      if (error instanceof IsolatedCodeOutputValidationRejectedError) {
        return await this.#recordOutputValidationRejected(attempt, key, error);
      }
      return await this.#recoverDispatch(
        context,
        attempt,
        key,
        attempt.dispatch.dispatchedAt,
      );
    }
  }

  async #recordOutputValidationRejected(
    attempt: Extract<AdmittedModelicaExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedModelicaExecutionAttemptKey,
    error: IsolatedCodeOutputValidationRejectedError,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    if (
      error.destruction.status !== "proven" ||
      error.destruction.runId !== key.executionRunId
    ) {
      throw invalidTransition(
        "Isolated admitted Modelica output-validation cleanup is not proven; no redispatch occurs.",
      );
    }
    const recorded = await this.d.attempts.markOutputValidationRejected({
      ...key,
      observation: error.observation,
      destruction: error.destruction,
    });
    assertAttemptIdentity(recorded, key, attempt.identity);
    return throwOutputValidationRejected(recorded);
  }

  async #recoverDispatch(
    context: AdmittedExecutionRequest,
    attempt: Extract<AdmittedModelicaExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedModelicaExecutionAttemptKey,
    dispatchedAt: string,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    let resolution;
    try {
      resolution = await this.d.publications.resolvePublicationByRunId(
        key.executionRunId,
        attempt.dispatch.producerGeneration,
      );
    } catch {
      throw invalidTransition(
        "The admitted Modelica publication cannot be resolved; no isolated redispatch is authorized.",
      );
    }
    const decision = decideAdmittedModelicaAttemptResume({
      phase: "dispatching",
      executionRunId: key.executionRunId,
      producerGeneration: attempt.dispatch.producerGeneration,
      resolution,
    });
    if (decision.action === "adopt-publication") {
      const receipt = await this.#reopenReceipt(decision.receipt);
      return await this.#recordPublishedReceipt(attempt, key, receipt);
    }
    if (decision.action === "close-g1") {
      await this.#proveGenerationClosed(key.executionRunId, 1);
      throw invalidTransition(decision.message);
    }
    if (decision.action !== "cleanup-g0") {
      throw invalidTransition(
        decision.action === "quarantine"
          ? decision.message
          : "The admitted Modelica journal phase is not recoverable.",
      );
    }
    const destruction = await this.#proveGenerationClosed(key.executionRunId, 0);
    const cleaned = await this.d.attempts.markGenerationZeroCleaned({
      ...key,
      destruction,
    });
    assertAttemptIdentity(cleaned, key, attempt.identity);
    if (cleaned.phase !== "generation-zero-cleaned") {
      throw invalidTransition(
        "The admitted Modelica generation-zero cleanup was not durably acknowledged.",
      );
    }
    return await this.#redispatchGenerationOne(
      context,
      cleaned,
      key,
      dispatchedAt,
    );
  }

  async #redispatchGenerationOne(
    context: AdmittedExecutionRequest,
    attempt: Extract<
      AdmittedModelicaExecutionAttempt,
      { phase: "generation-zero-cleaned" }
    >,
    key: AdmittedModelicaExecutionAttemptKey,
    dispatchedAt: string,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    const advance = await this.d.recovery.advanceProducerGeneration({
      runId: key.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    const transition = await this.d.attempts.markRedispatching({
      ...key,
      advance,
      dispatchedAt,
    });
    const redispatch = transition.attempt;
    assertAttemptIdentity(redispatch, key, attempt.identity);
    if (
      redispatch.phase !== "dispatching" ||
      redispatch.dispatch.dispatchCount !== 2 ||
      redispatch.dispatch.producerGeneration !== 1
    ) {
      throw invalidTransition(
        "The admitted Modelica generation-one dispatch was not durably acknowledged.",
      );
    }
    // This local return from markRedispatching is the sole dispatch capability.
    // A later replay observes dispatching/g1 and can inspect CAS only.
    return transition.outcome === "transitioned-now"
      ? await this.#dispatchOnceOrRecover(context, redispatch, key)
      : await this.#recoverDispatch(context, redispatch, key, dispatchedAt);
  }

  async #proveGenerationClosed(
    executionRunId: string,
    producerGeneration: 0 | 1,
  ): Promise<
    Extract<IsolatedCodeExecutionReceipt["destruction"], { status: "proven" }>
  > {
    let destruction: IsolatedCodeExecutionReceipt["destruction"];
    try {
      destruction = await this.d.recovery.destroyByRunId(
        executionRunId,
        producerGeneration,
      );
    } catch {
      throw invalidTransition(
        `Admitted Modelica generation ${producerGeneration} has no publication and its cleanup could not be proven.`,
      );
    }
    if (destruction.status !== "proven" || destruction.runId !== executionRunId) {
      throw invalidTransition(
        `Admitted Modelica generation ${producerGeneration} requires exact proven cleanup before recovery can continue.`,
      );
    }
    return destruction;
  }

  async #recordPublishedReceipt(
    attempt: Extract<AdmittedModelicaExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedModelicaExecutionAttemptKey,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    if (receipt.producerGeneration !== attempt.dispatch.producerGeneration) {
      throw invalidTransition(
        "The admitted Modelica receipt belongs to another durable producer generation.",
      );
    }
    const recorded = await this.d.attempts.markOutputPublished({
      ...key,
      receiptRecord: isolatedCodeExecutionReceiptRecord(receipt),
    });
    assertAttemptIdentity(recorded, key, attempt.identity);
    if (recorded.phase !== "output-published") {
      throw invalidTransition(
        "The admitted Modelica output publication was not durably recorded.",
      );
    }
    return recorded;
  }

  async #reopenReceipt(
    record: IsolatedCodeExecutionReceiptRecord,
  ): Promise<IsolatedCodeExecutionReceipt> {
    let receipt: IsolatedCodeExecutionReceipt | undefined;
    try {
      receipt = await this.d.publications.readReceipt(record.publication.ref);
    } catch {
      throw invalidTransition(
        "The published admitted Modelica receipt could not be reopened.",
      );
    }
    if (
      !receipt ||
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(record)
    ) {
      throw invalidTransition(
        "The published admitted Modelica receipt differs from its durable journal record.",
      );
    }
    return receipt;
  }

  async #saveAndReopenThread(expected: DocumentarySuccessor): Promise<void> {
    await this.d.snapshots.save(expected.snapshot);
    await this.#assertThreadExact(expected);
  }

  async #assertThreadExact(expected: DocumentarySuccessor): Promise<void> {
    const readback = await this.d.snapshots.getFresh(expected.snapshot.id);
    if (
      !readback ||
      deterministicJson(validateThreadSnapshot(readback)) !==
        deterministicJson(expected.snapshot)
    ) {
      throw invalidTransition(
        "The admitted Modelica documentary Thread successor failed exact durable readback.",
      );
    }
    await assertThreadSnapshotLineageIntact(readback, this.d.snapshots);
  }

  async #persistCapture(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    context: AdmittedExecutionRequest,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<PersistedAdmittedExecutionCapture> {
    const expected = await this.#expectedCapture(project, run, context, receipt);
    const text = deterministicJson(expected.capture);
    const persisted = await this.d.captures.save(expected.fingerprint, text);
    const reopenedText = await this.d.captures.read(persisted.fingerprint);
    if (
      !reopenedText || reopenedText !== text ||
      persisted.uri !== expected.uri ||
      !fingerprintsEqual(persisted.fingerprint, expected.fingerprint)
    ) {
      throw invalidTransition("The admitted Modelica capture failed exact readback.");
    }
    return {
      capture: await validateModelicaAdmittedExecutionCapture(
        JSON.parse(reopenedText),
      ),
      fingerprint: persisted.fingerprint,
      uri: persisted.uri,
    };
  }

  async #reopenPersistedCapture(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    context: AdmittedExecutionRequest,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<PersistedAdmittedExecutionCapture> {
    const expected = await this.#expectedCapture(project, run, context, receipt);
    const reopenedText = await this.d.captures.read(expected.fingerprint);
    if (
      !reopenedText || reopenedText !== deterministicJson(expected.capture) ||
      this.d.captures.uriFor(expected.fingerprint) !== expected.uri
    ) {
      throw invalidTransition(
        "The admitted Modelica capture cannot be reopened exactly without writing.",
      );
    }
    return {
      ...expected,
      capture: await validateModelicaAdmittedExecutionCapture(
        JSON.parse(reopenedText),
      ),
    };
  }

  async #expectedCapture(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    context: AdmittedExecutionRequest,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<PersistedAdmittedExecutionCapture> {
    const capture = await this.#captureFromPublishedEvidence(
      project,
      run,
      context,
      receipt,
    );
    const fingerprint = await sha256Fingerprint(capture);
    return {
      capture,
      fingerprint,
      uri: this.d.captures.uriFor(fingerprint),
    };
  }

  async #captureFromPublishedEvidence(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    context: AdmittedExecutionRequest,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<ModelicaAdmittedExecutionCapture> {
    const record = isolatedCodeExecutionReceiptRecord(receipt);
    const outputs = new Map(record.outputs.map((output) => [output.role, output]));
    const evidenceOutput = outputs.get("evidence");
    const resultOutput = outputs.get("result");
    if (!evidenceOutput || !resultOutput || outputs.size !== 2) {
      throw invalidTransition(
        "The admitted Modelica run must publish evidence.json and result.csv.",
      );
    }
    const evidenceBytes = await this.d.publications.readPublishedObject(
      record.publication.ref,
      evidenceOutput,
    );
    const resultBytes = await this.d.publications.readPublishedObject(
      record.publication.ref,
      resultOutput,
    );
    if (!evidenceBytes || !resultBytes) {
      throw invalidTransition(
        "The admitted Modelica evidence and result bytes could not both be reopened.",
      );
    }
    try {
      return await buildAdmittedModelicaPublishedOutputCapture({
        projectId: project.project.id,
        agentRunId: run.id,
        executionRunId: context.request.runId,
        admission: context.admission,
        sourceBytes: context.request.source.bytes,
        sourceSha256: context.request.source.sha256,
        receipt,
        evidenceBytes,
        resultBytes,
      });
    } catch (error) {
      throw domainTransition(error);
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.d.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #replayClaim(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const project = await this.#requiredProject(command.projectId);
    const receipt = requireAdmittedModelicaCommandReceipt(
      project,
      commandStep(command.commandId, "claim"),
      "agent-run.claim",
      origin,
    );
    const exactClaim = claimCommand(
      command,
      receipt.resultingSnapshot.revision - 1,
      receipt.issuedAt,
    );
    const claimedRun = requireRun(project, command.runId);
    if (
      claimedRun.claimedAt !== receipt.appliedAt ||
      claimedRun.startedAt !== receipt.appliedAt ||
      (claimedRun.status === "running" && claimedRun.summary !== exactClaim.summary)
    ) {
      throw invalidTransition(
        "The admitted Modelica claim receipt does not seal the run's exact claimed/start timeline.",
      );
    }
    await this.#assertReceiptSnapshotExact(project, receipt);
    await assertAdmittedModelicaCommandReceiptExact(
      claimedRun,
      receipt,
      "agent-run.claim",
      origin,
      exactClaim,
      "running",
    );
    await this.d.commands.claimRun(
      origin,
      exactClaim,
    );
  }

  async #publishExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "publishing" || run.status === "completed") {
      const receipt = requireAdmittedModelicaCommandReceipt(
        project,
        commandStep(command.commandId, "publish"),
        "agent-run.publish",
        origin,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
      const exactPublish = publishCommand(command, expectedRevision, issuedAt);
      if (run.status === "publishing" && run.summary !== exactPublish.summary) {
        throw invalidTransition(
          "The publishing admitted Modelica run summary differs from its exact publish transition.",
        );
      }
      await this.#assertReceiptSnapshotExact(project, receipt);
      await assertAdmittedModelicaCommandReceiptExact(
        run,
        receipt,
        "agent-run.publish",
        origin,
        exactPublish,
        "publishing",
      );
    } else if (run.status !== "running") {
      throw unexpectedStatus(run, "running, publishing, or completed");
    }
    await this.d.commands.publishRun(
      origin,
      publishCommand(command, expectedRevision, issuedAt),
    );
  }

  async #completeExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    expected: DocumentarySuccessor,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "completed") {
      const receipt = requireAdmittedModelicaCommandReceipt(
        project,
        commandStep(command.commandId, "complete"),
        "agent-run.complete",
        origin,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
      const exactCompletion = completionCommand(
        command,
        expectedRevision,
        expected,
        issuedAt,
      );
      if (run.summary !== exactCompletion.summary) {
        throw invalidTransition(
          "The completed admitted Modelica run summary differs from its exact completion transition.",
        );
      }
      await this.#assertReceiptSnapshotExact(project, receipt);
      await assertAdmittedModelicaCommandReceiptExact(
        run,
        receipt,
        "agent-run.complete",
        origin,
        exactCompletion,
        "completed",
      );
    } else if (run.status !== "publishing") {
      throw unexpectedStatus(run, "publishing or completed");
    }
    await this.d.commands.completeRun(
      origin,
      completionCommand(command, expectedRevision, expected, issuedAt),
    );
  }

  async #reopenCompleted(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") throw unexpectedStatus(run, "completed");
    requireClaimedShape(project, run, origin);
    const currentAuthority = await requireReviewedAuthority(project, run);
    assertSameAuthority(authority, currentAuthority);
    assertAdmissionScope(
      project,
      run,
      currentAuthority.decision,
      currentAuthority.admission,
    );
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, true);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
    exactAdmissionArtifact(
      basisSnapshot,
      currentAuthority.admission.admissionArtifact.id,
      currentAuthority.admission.admissionArtifact.fingerprint,
    );
    const context = await reopenAdmittedExecutionRequest({
      admissions: this.d.admissions,
      profiles: this.d.profiles,
      project,
      run,
      admission: currentAuthority.admission,
    });
    const identity = await attemptIdentity(
      project,
      run,
      basisSnapshot,
      currentAuthority,
      context,
    );
    const key: AdmittedModelicaExecutionAttemptKey = {
      projectId: project.project.id,
      agentRunId: run.id,
      executionRunId: context.request.runId,
      attemptFingerprint: await fingerprintAdmittedModelicaExecutionAttemptIdentity(
        identity,
      ),
    };
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (!attempt) {
      throw invalidTransition(
        "The completed admitted Modelica project run has no durable execution journal.",
      );
    }
    assertAttemptIdentity(attempt, key, identity);
    if (attempt.phase !== "output-published" && attempt.phase !== "completed") {
      throw invalidTransition(
        "The completed admitted Modelica project run has no durable published-output receipt.",
      );
    }
    const receipt = await this.#reopenReceipt(attempt.receiptRecord);
    const capture = await this.#reopenPersistedCapture(
      project,
      run,
      context,
      receipt,
    );
    const expected = buildDocumentarySuccessor({
      basisSnapshot,
      basis,
      run,
      capture: capture.capture,
      captureFingerprint: capture.fingerprint,
      captureUri: capture.uri,
      receipt,
    });
    await this.#assertCompletedEvidence(
      origin,
      project,
      command,
      run,
      expected,
      capture,
      context,
      attempt,
    );
    if (attempt.phase === "output-published") {
      await this.#completeAttempt(attempt, key, expected);
    } else {
      assertThreadEvidenceExact(attempt.threadEvidence, expected);
    }
    return project;
  }

  async #resumePublishingReadOnly(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    basisSnapshot: ThreadSnapshot,
    context: AdmittedExecutionRequest,
    attempt: AdmittedModelicaExecutionAttempt,
    key: AdmittedModelicaExecutionAttemptKey,
  ): Promise<EngineeringProjectSnapshot> {
    if (attempt.phase !== "output-published") {
      throw invalidTransition(
        "The publishing admitted Modelica project run has no exact output-published journal phase.",
      );
    }
    const receipt = await this.#reopenReceipt(attempt.receiptRecord);
    const capture = await this.#reopenPersistedCapture(
      project,
      run,
      context,
      receipt,
    );
    const expected = buildDocumentarySuccessor({
      basisSnapshot,
      basis: requireBasis(run),
      run,
      capture: capture.capture,
      captureFingerprint: capture.fingerprint,
      captureUri: capture.uri,
      receipt,
    });
    await this.#assertThreadExact(expected);
    await this.#publishExact(origin, project, command);
    project = await this.#requiredProject(command.projectId);
    await this.#completeExact(origin, project, command, expected);
    const completed = await this.#requiredProject(command.projectId);
    await this.#assertCompletedEvidence(
      origin,
      completed,
      command,
      run,
      expected,
      capture,
      context,
      attempt,
    );
    await this.#completeAttempt(attempt, key, expected);
    return completed;
  }

  async #assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    originalRun: EngineeringAgentRun,
    expected: DocumentarySuccessor,
    capture: PersistedAdmittedExecutionCapture,
    context: AdmittedExecutionRequest,
    attempt: Extract<
      AdmittedModelicaExecutionAttempt,
      { phase: "output-published" | "completed" }
    >,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    assertCompletedAdmittedModelicaBinding({
      project,
      command,
      run,
      originalStartedAt: originalRun.startedAt,
      expected,
      capture: capture.capture,
      executionRunId: context.request.runId,
      journalReceipt: attempt.receiptRecord,
    });
    await this.#assertThreadExact(expected);
    const receipts = requireAdmittedModelicaCompletedReceipts({
      project,
      command,
      origin,
      run,
    });
    await Promise.all([
      this.#assertReceiptSnapshotExact(project, receipts.claim),
      this.#assertReceiptSnapshotExact(project, receipts.publish),
      this.#assertReceiptSnapshotExact(project, receipts.complete),
    ]);
    await assertAdmittedModelicaCommandReceiptExact(
      run,
      receipts.claim,
      "agent-run.claim",
      origin,
      claimCommand(
        command,
        receipts.claim.resultingSnapshot.revision - 1,
        receipts.claim.issuedAt,
      ),
      "running",
    );
    await assertAdmittedModelicaCommandReceiptExact(
      run,
      receipts.publish,
      "agent-run.publish",
      origin,
      publishCommand(
        command,
        receipts.publish.resultingSnapshot.revision - 1,
        receipts.publish.issuedAt,
      ),
      "publishing",
    );
    await assertAdmittedModelicaCommandReceiptExact(
      run,
      receipts.complete,
      "agent-run.complete",
      origin,
      completionCommand(
        command,
        receipts.complete.resultingSnapshot.revision - 1,
        expected,
        receipts.complete.issuedAt,
      ),
      "completed",
    );
  }

  async #assertReceiptSnapshotExact(
    project: EngineeringProjectSnapshot,
    receipt: EngineeringProjectCommandReceipt,
  ): Promise<void> {
    const reference = receipt.resultingSnapshot;
    const reopened = await this.d.projects.getRevision(
      project.project.id,
      reference.revision,
    );
    const historicalReceipts =
      reopened?.commandReceipts?.filter((candidate) =>
        candidate.commandId === receipt.commandId && candidate.type === receipt.type
      ) ?? [];
    if (
      !reopened || reopened.id !== reference.snapshotId ||
      reopened.revision !== reference.revision ||
      reopened.generatedAt !== receipt.appliedAt ||
      reopened.project.id !== project.project.id ||
      historicalReceipts.length !== 1 ||
      deterministicJson(historicalReceipts[0]) !== deterministicJson(receipt) ||
      deterministicJson((reopened.commandReceipts ?? []).at(-1)) !==
        deterministicJson(receipt)
    ) {
      throw invalidTransition(
        `The admitted Modelica ${receipt.type} receipt does not reopen its exact immutable project revision.`,
      );
    }
  }

  async #completeAttempt(
    attempt: Extract<
      AdmittedModelicaExecutionAttempt,
      { phase: "output-published" }
    >,
    key: AdmittedModelicaExecutionAttemptKey,
    expected: DocumentarySuccessor,
  ): Promise<void> {
    const completed = await this.d.attempts.markCompleted({
      ...key,
      threadEvidence: threadEvidenceFor(expected),
    });
    assertAttemptIdentity(completed, key, attempt.identity);
    if (completed.phase !== "completed") {
      throw invalidTransition(
        "The admitted Modelica journal did not record completion after project and Thread proof.",
      );
    }
    assertThreadEvidenceExact(completed.threadEvidence, expected);
  }

  async #reopenFailedOutputValidation(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "failed") {
      throw unexpectedStatus(run, "failed");
    }
    const attempt = await this.d.attempts.read(command.projectId, run.id);
    if (attempt?.phase !== "output-validation-rejected") {
      throw unexpectedStatus(run, "queued or this agent's running/publishing");
    }
    await this.#assertFailedOutputValidationReplay(
      origin,
      command,
      project,
      run,
      isolatedOutputValidationFailure(attempt.outputValidationRejection.observation),
    );
    return project;
  }

  async #failOutputValidationRejected(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    error: IsolatedAdmittedModelicaOutputValidationRejectedError,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const failure = isolatedOutputValidationFailure(error.observation);
    if (run.status === "failed") {
      await this.#assertFailedOutputValidationReplay(
        origin,
        command,
        project,
        run,
        failure,
      );
      return project;
    }
    if (run.status !== "running") {
      throw unexpectedStatus(run, "running");
    }
    if (run.resultSnapshot || run.evidenceRefs.length !== 0) {
      throw invalidTransition(
        "The claimed admitted Modelica run already carries Thread evidence and cannot take an evidence-free terminal failure.",
      );
    }
    const startedAt = run.startedAt;
    await this.d.commands.failRun(
      origin,
      failCommand(command, failure, project.revision),
    );
    const failed = await this.#requiredProject(command.projectId);
    await this.#assertFailedOutputValidationReplay(
      origin,
      command,
      failed,
      requireRun(failed, command.runId),
      failure,
      startedAt,
    );
    return failed;
  }

  async #assertFailedOutputValidationReplay(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    failure: {
      readonly summary: string;
      readonly code: string;
      readonly message: string;
    },
    originalStartedAt = run.startedAt,
  ): Promise<void> {
    await assertFailedIsolatedOutputValidationReplay({
      project,
      run,
      origin,
      originalStartedAt,
      failure,
      claimCommandId: commandStep(command.commandId, "claim"),
      failCommandId: commandStep(command.commandId, "fail"),
      buildClaimCommand: (expectedRevision, issuedAt) =>
        claimCommand(command, expectedRevision, issuedAt),
      buildFailCommand: (expectedRevision, issuedAt) =>
        failCommand(command, failure, expectedRevision, issuedAt),
    });
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireExecutionShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw invalidTransition(
      "This executor may continue only the exact admitted Modelica run it claimed.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: AdmittedModelicaThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
  fresh: boolean,
): Promise<ThreadSnapshot> {
  const snapshot = fresh
    ? await snapshots.getFresh(basis.snapshotId)
    : await snapshots.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The admitted Modelica Thread basis could not be reopened.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

async function attemptIdentity(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  basisSnapshot: ThreadSnapshot,
  authority: ReviewedAuthority,
  context: AdmittedExecutionRequest,
): Promise<AdmittedModelicaExecutionAttemptIdentity> {
  const basis = requireBasis(run);
  return {
    projectId: project.project.id,
    agentRunId: run.id,
    executionRunId: context.request.runId,
    startedAt: requiredStart(run),
    basis,
    basisFingerprint: await sha256Fingerprint(basisSnapshot),
    reviewedRunFingerprint: requiredRunFingerprint(run),
    decision: {
      id: authority.decision.id,
      inputFingerprint: authority.decision.inputFingerprint!,
    },
    approval: {
      id: authority.approval.id,
      inputFingerprint: authority.approval.inputFingerprint!,
    },
    admission: context.admission,
    executionProfile: context.executionProfile,
    isolatedRequest: {
      schemaVersion: context.request.schemaVersion,
      runId: context.request.runId,
      producerGeneration: 0,
      profile: context.request.profile,
      sourceSha256: context.request.source.sha256,
      policy: context.request.policy,
      outputs: context.request.outputs,
    },
  };
}

function assertAttemptIdentity(
  attempt: AdmittedModelicaExecutionAttempt,
  key: AdmittedModelicaExecutionAttemptKey,
  identity: AdmittedModelicaExecutionAttemptIdentity,
): void {
  if (
    attempt.projectId !== key.projectId ||
    attempt.agentRunId !== key.agentRunId ||
    attempt.executionRunId !== key.executionRunId ||
    !fingerprintsEqual(attempt.attemptFingerprint, key.attemptFingerprint) ||
    deterministicJson(attempt.identity) !== deterministicJson(identity) ||
    attempt.preparedAt !== identity.startedAt
  ) {
    throw invalidTransition(
      "The admitted Modelica journal differs from the exact reviewed attempt identity and start timeline.",
    );
  }
}

function requestForGeneration(
  request: IsolatedCodeExecutionRequest,
  producerGeneration: 0 | 1,
): IsolatedCodeExecutionRequest {
  return {
    ...request,
    producerGeneration,
    source: {
      bytes: request.source.bytes,
      sha256: request.source.sha256,
    },
  };
}

function requiredRunFingerprint(run: EngineeringAgentRun): ContentFingerprint {
  if (!run.inputFingerprint) {
    throw invalidTransition(
      "The admitted Modelica run has no exact reviewed input fingerprint.",
    );
  }
  return run.inputFingerprint;
}

function buildDocumentarySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: ModelicaAdmittedExecutionCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
}): DocumentarySuccessor {
  try {
    return buildDomainDocumentarySuccessor({
      basisSnapshot: input.basisSnapshot,
      basis: input.basis,
      runId: input.run.id,
      capturedAt: requiredStart(input.run),
      capture: input.capture,
      captureFingerprint: input.captureFingerprint,
      captureUri: input.captureUri,
      receipt: input.receipt,
    });
  } catch (error) {
    throw domainTransition(error);
  }
}

function exactAdmissionArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  try {
    return findExactAdmissionArtifact(snapshot, id, fingerprint);
  } catch (error) {
    throw domainTransition(error);
  }
}

function assertThreadEvidenceExact(
  actual: AdmittedModelicaExecutionThreadEvidence,
  expected: DocumentarySuccessor,
): void {
  try {
    assertDomainThreadEvidenceExact(actual, expected);
  } catch (error) {
    throw domainTransition(error);
  }
}

function boundedCause(error: unknown, maximum = 300): string {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : `non-error throw: ${String(error)}`;
  return message.length <= maximum ? message : `${message.slice(0, maximum)}…`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function isolatedOutputValidationFailure(observation: {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}): {
  readonly summary: string;
  readonly code: string;
  readonly message: string;
} {
  return {
    summary: ADMITTED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED.summary,
    code: ADMITTED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
    message: isolatedOutputValidationFailedMessage(observation),
  };
}

function throwOutputValidationRejected(
  attempt: AdmittedModelicaExecutionAttempt,
): never {
  if (attempt.phase !== "output-validation-rejected") {
    throw invalidTransition(
      "The admitted Modelica output-validation rejection WAL transition was not durable.",
    );
  }
  throw new IsolatedAdmittedModelicaOutputValidationRejectedError({
    executionRunId: attempt.executionRunId,
    observation: attempt.outputValidationRejection.observation,
    destruction: attempt.outputValidationRejection.destruction,
  });
}

function domainTransition(error: unknown): EngineeringProjectCommandError {
  return invalidTransition(
    error instanceof Error ? error.message : String(error),
  );
}
