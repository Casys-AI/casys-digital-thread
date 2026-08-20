/**
 * Trusted executor for `simulate.run-admitted-modelica@1`.
 *
 * Reopens one sealed Modelica compilation and runs those exact `.mo` bytes
 * in the server-owned isolated worker. Callers never supply Modelica text.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  AdmittedModelicaExecutionAttempt,
  AdmittedModelicaExecutionAttemptIdentity,
  AdmittedModelicaExecutionAttemptKey,
  AdmittedModelicaExecutionAttemptStore,
  AdmittedModelicaExecutionThreadEvidence,
  AdmittedModelicaExecutionThreadEvidenceInput,
} from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import { fingerprintAdmittedModelicaExecutionAttemptIdentity } from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  AdmittedModelicaExecutionProfile,
  AdmittedModelicaExecutionProfileCatalog,
} from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "../../../application/use-cases/modelica/admitted/prepare-run-review.ts";
import {
  isolatedRequestFromAdmittedSource,
  ReopenAdmittedCompilationSource,
} from "../../../application/use-cases/compile/admission/reopen-admitted-compilation-source.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  createModelicaAdmittedExecutionCapture,
  deriveAdmittedModelicaExecutionRunId,
  type ModelicaAdmittedExecutionCapture,
  validateModelicaAdmittedExecutionCapture,
} from "../../../domain/modelica/admitted/execution-evidence.ts";
import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  type ModelicaAdmittedRunAdmission,
  parseModelicaAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../../domain/modelica/admitted/run-proposal.ts";

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadObservation,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

export { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION };

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
    "claimRun" | "publishRun" | "completeRun"
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

interface ReviewedAuthority {
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  readonly admission: ModelicaAdmittedRunAdmission;
}

interface DocumentarySuccessor {
  readonly snapshot: ThreadSnapshot;
  readonly artifacts: readonly [ThreadArtifact, ThreadArtifact, ThreadArtifact];
  readonly observation: ThreadObservation;
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
      basisSnapshot: preClaimSnapshot,
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
        basisSnapshot,
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
    if (attempt.phase === "completed") {
      throw invalidTransition(
        "The project run is active but its admitted Modelica journal is already completed.",
      );
    }
    if (attempt.phase === "output-published") return attempt;

    if (attempt.phase === "prepared") {
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
      return transition.outcome === "transitioned-now"
        ? await this.#dispatchOnceOrRecover(context, attempt, key)
        : await this.#recoverDispatch(context, attempt, key, dispatchedAt);
    }

    if (attempt.phase === "generation-zero-cleaned") {
      return await this.#redispatchGenerationOne(
        context,
        attempt,
        key,
        dispatchedAt,
      );
    }

    if (attempt.phase === "dispatching") {
      return await this.#recoverDispatch(context, attempt, key, dispatchedAt);
    }
    throw invalidTransition("The admitted Modelica journal phase is not recoverable.");
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
    } catch {
      return await this.#recoverDispatch(
        context,
        attempt,
        key,
        attempt.dispatch.dispatchedAt,
      );
    }
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
    if (
      resolution.runId !== key.executionRunId ||
      resolution.producerGeneration !== attempt.dispatch.producerGeneration
    ) {
      throw invalidTransition(
        "The admitted Modelica publication resolution names another producer generation.",
      );
    }
    if (resolution.status === "published") {
      if (
        deterministicJson(resolution.ref) !==
          deterministicJson(resolution.receipt.publication.ref)
      ) {
        throw invalidTransition(
          "The admitted Modelica publication resolution reference differs from its receipt record.",
        );
      }
      const receipt = await this.#reopenReceipt(resolution.receipt);
      return await this.#recordPublishedReceipt(attempt, key, receipt);
    }
    if (resolution.status === "outcome-unknown") {
      throw invalidTransition(
        "The admitted Modelica isolated-output outcome remains unknown; no redispatch is authorized.",
      );
    }
    if (attempt.dispatch.producerGeneration === 1) {
      await this.#proveGenerationClosed(key.executionRunId, 1);
      throw invalidTransition(
        "The sole admitted Modelica retry generation produced no publication and was closed; no third dispatch exists.",
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
    const [evidenceSha256, resultSha256] = await Promise.all([
      fingerprintResourceBytes(evidenceBytes),
      fingerprintResourceBytes(resultBytes),
    ]);
    if (
      evidenceSha256 !== evidenceOutput.sha256 ||
      resultSha256 !== resultOutput.sha256
    ) {
      throw invalidTransition(
        "The admitted Modelica published bytes differ from their journaled output hashes.",
      );
    }
    let evidence: {
      readonly metrics?: readonly { readonly id?: string; readonly value?: number }[];
    };
    try {
      evidence = JSON.parse(new TextDecoder().decode(evidenceBytes));
    } catch {
      throw invalidTransition("The admitted Modelica evidence is not JSON.");
    }
    const metrics =
      evidence.metrics?.filter((item) => item.id === "temperature_final") ?? [];
    const metric = metrics[0];
    if (
      metrics.length !== 1 || typeof metric?.value !== "number" ||
      !Number.isFinite(metric.value)
    ) {
      throw invalidTransition(
        "The admitted Modelica evidence lacks one exact temperature_final metric.",
      );
    }
    return await createModelicaAdmittedExecutionCapture({
      projectId: project.project.id,
      agentRunId: run.id,
      executionRunId: context.request.runId,
      admission: context.admission,
      sourceSha256: context.request.source.sha256,
      receipt,
      temperatureFinal: { value: metric.value, unit: "degC" },
    });
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
    const receipt = exactCommandReceipt(
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
    await assertCommandReceiptExact(
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
      const receipt = exactCommandReceipt(
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
      await assertCommandReceiptExact(
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
      const receipt = exactCommandReceipt(
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
      await assertCommandReceiptExact(
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
      basisSnapshot,
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
    const workItem = project.workItems.find((item) => item.id === run.workItemId);
    const phase = workItem &&
      project.phases.find((item) => item.id === workItem.phaseId);
    const expectedRefs = expected.artifacts.map((artifact) =>
      artifactEvidence(expected.snapshot, artifact)
    );
    const projectSnapshotMatches = project.threadSnapshots.filter((reference) =>
      deterministicJson(reference) === deterministicJson(snapshotRef(expected.snapshot))
    );
    const expectedCompletionSummary = completionCommand(
      command,
      project.revision,
      expected,
    ).summary;
    if (
      run.status !== "completed" || !run.resultSnapshot || !workItem || !phase ||
      workItem.status !== "completed" || run.summary !== expectedCompletionSummary ||
      deterministicJson(run.resultSnapshot) !==
        deterministicJson(snapshotRef(expected.snapshot)) ||
      deterministicJson(run.evidenceRefs) !== deterministicJson(expectedRefs) ||
      deterministicJson(workItem.evidenceRefs) !== deterministicJson(expectedRefs) ||
      !expectedRefs.every((expectedRef) =>
        phase.evidenceRefs.filter((actualRef) =>
          deterministicJson(actualRef) === deterministicJson(expectedRef)
        ).length === 1
      ) ||
      projectSnapshotMatches.length !== 1 ||
      run.startedAt !== originalRun.startedAt ||
      deterministicJson(attempt.receiptRecord) !==
        deterministicJson(capture.capture.receipt) ||
      capture.capture.executionRunId !== context.request.runId ||
      capture.capture.agentRunId !== run.id ||
      capture.capture.projectId !== project.project.id
    ) {
      throw invalidTransition(
        "The completed admitted Modelica project state does not exactly bind its journal, capture, Thread successor and three evidence references.",
      );
    }
    await this.#assertThreadExact(expected);
    const claimReceipt = exactCommandReceipt(
      project,
      commandStep(command.commandId, "claim"),
      "agent-run.claim",
      origin,
    );
    const publishReceipt = exactCommandReceipt(
      project,
      commandStep(command.commandId, "publish"),
      "agent-run.publish",
      origin,
    );
    const completeReceipt = exactCommandReceipt(
      project,
      commandStep(command.commandId, "complete"),
      "agent-run.complete",
      origin,
    );
    if (
      run.claimedAt !== claimReceipt.appliedAt ||
      run.startedAt !== claimReceipt.appliedAt ||
      run.completedAt !== completeReceipt.appliedAt
    ) {
      throw invalidTransition(
        "The completed admitted Modelica run timeline differs from its exact claim and completion receipts.",
      );
    }
    await Promise.all([
      this.#assertReceiptSnapshotExact(project, claimReceipt),
      this.#assertReceiptSnapshotExact(project, publishReceipt),
      this.#assertReceiptSnapshotExact(project, completeReceipt),
    ]);
    await assertCommandReceiptExact(
      run,
      claimReceipt,
      "agent-run.claim",
      origin,
      claimCommand(
        command,
        claimReceipt.resultingSnapshot.revision - 1,
        claimReceipt.issuedAt,
      ),
      "running",
    );
    await assertCommandReceiptExact(
      run,
      publishReceipt,
      "agent-run.publish",
      origin,
      publishCommand(
        command,
        publishReceipt.resultingSnapshot.revision - 1,
        publishReceipt.issuedAt,
      ),
      "publishing",
    );
    await assertCommandReceiptExact(
      run,
      completeReceipt,
      "agent-run.complete",
      origin,
      completionCommand(
        command,
        completeReceipt.resultingSnapshot.revision - 1,
        expected,
        completeReceipt.issuedAt,
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
}

interface AdmittedExecutionRequest {
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly executionProfile: AdmittedModelicaExecutionProfile;
  readonly request: IsolatedCodeExecutionRequest;
}

export async function reopenAdmittedExecutionRequest(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedModelicaExecutionProfileCatalog;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly basisSnapshot: ThreadSnapshot;
  readonly admission: ModelicaAdmittedRunAdmission;
}): Promise<AdmittedExecutionRequest> {
  const basis = requireBasis(input.run);
  const review = await new PrepareProjectAdmittedModelicaRunReview({
    admissions: input.admissions,
    profiles: input.profiles,
  }).execute({
    projectId: input.project.project.id,
    basis,
    artifactId: input.admission.admissionArtifact.id,
    artifactFingerprint: input.admission.admissionArtifact.fingerprint,
  });
  if (deterministicJson(review.admission) !== deterministicJson(input.admission)) {
    throw invalidTransition(
      "The reopened admitted Modelica review differs from the signed MRTR.",
    );
  }
  let admitted;
  try {
    admitted = await new ReopenAdmittedCompilationSource({
      admissions: input.admissions,
    }).execute({
      projectId: input.project.project.id,
      basis,
      artifactId: input.admission.admissionArtifact.id,
      artifactFingerprint: input.admission.admissionArtifact.fingerprint,
      expectedTarget: "modelica-source-qualification",
    });
  } catch {
    throw invalidTransition(
      "The reopened admission is not a ready Modelica compilation.",
    );
  }
  if (
    !fingerprintsEqual(
      admitted.sourceFingerprint,
      input.admission.compilation.source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      admitted.documentFingerprint,
      input.admission.compilation.document.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The reopened Modelica source is not the signed admission.",
    );
  }
  const profile = await input.profiles.initial();
  const executionRunId = await deriveAdmittedModelicaExecutionRunId(
    input.project.project.id,
    input.run.id,
  );
  const request = await isolatedRequestFromAdmittedSource({
    runId: executionRunId,
    sourceText: admitted.sourceText,
    sourceSha256: admitted.sourceFingerprint.digest,
    profile: profile.executionProfile,
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
    maximumSourceBytes: profile.maximumSourceBytes,
  });
  return {
    admission: review.admission,
    executionProfile: profile,
    request,
  };
}

function requireExecutionShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    project.schemaVersion !== "3.0" || run.basis?.kind !== "thread-snapshot" ||
    run.baseSnapshot !== undefined || run.resolvedOperationPlan !== undefined ||
    !workItem || operation?.id !== SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id ||
    operation.version !== SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version ||
    workItem.decisionIds.length !== 1 ||
    operation.bindings.length !== 1 || binding?.name !== "compilationAdmission" ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to simulate.run-admitted-modelica@1 with compilationAdmission.`,
    );
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

async function requireReviewedAuthority(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<ReviewedAuthority> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem || workItem.decisionIds.length !== 1) {
    throw invalidTransition(
      "The admitted Modelica work item must name exactly one decision.",
    );
  }
  const decision = project.decisions.find((item) =>
    item.id === workItem.decisionIds[0]
  );
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !decision.inputFingerprint || decision.inputEvidenceRefs.length !== 1 ||
    decision.inputEvidenceRefs[0]?.kind !== "artifact" ||
    decision.approvalIds.length !== 1
  ) {
    throw invalidTransition(
      "The admitted Modelica run requires one exact approved MRTR decision over one admission artifact.",
    );
  }
  const approvals = project.approvals.filter((item) => item.decisionId === decision.id);
  const approval = approvals[0];
  const basis = requireBasis(run);
  if (
    approvals.length !== 1 || !approval ||
    approval.id !== decision.approvalIds[0] ||
    approval.status !== "approved" ||
    approval.decidedByOrigin !== "human" ||
    typeof approval.decidedBy !== "string" || approval.decidedBy.trim() === "" ||
    typeof approval.decidedAt !== "string" ||
    Number.isNaN(Date.parse(approval.decidedAt)) ||
    !approval.inputFingerprint ||
    !sameSnapshotBasis(decision.baseSnapshot, basis) ||
    !sameSnapshotBasis(approval.baseSnapshot, basis) ||
    !evidenceRefsEqual(approval.inputEvidenceRefs, decision.inputEvidenceRefs) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw invalidTransition(
      "The admitted Modelica decision must have one matching human approval on the exact run basis and admission evidence.",
    );
  }
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedDecisionFingerprint, decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted Modelica decision fingerprint no longer seals its exact basis, evidence, summary and parameters.",
    );
  }
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted Modelica run fingerprint no longer seals its sole MRTR decision, operation and basis.",
    );
  }
  let admission: ModelicaAdmittedRunAdmission;
  try {
    admission = parseModelicaAdmittedRunAdmissionParameters(
      decision.proposal.parameters,
    );
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Admitted Modelica decision parameters failed exact closed-schema validation.",
    );
  }
  return { decision, approval, proposal: decision.proposal, admission };
}

function assertAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: ModelicaAdmittedRunAdmission,
): void {
  const basis = requireBasis(run);
  const evidence = decision.inputEvidenceRefs[0];
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings[0]!;
  if (
    decision.inputEvidenceRefs.length !== 1 || evidence?.kind !== "artifact" ||
    evidence.snapshotId !== basis.snapshotId ||
    evidence.snapshotRevision !== basis.revision ||
    evidence.id !== admission.admissionArtifact.id ||
    binding.source.kind !== "thread-entity" ||
    deterministicJson(binding.source.reference) !== deterministicJson(evidence)
  ) {
    throw invalidTransition(
      "The admitted Modelica binding, MRTR evidence, and admission artifact disagree.",
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

function assertSameAuthority(
  expected: ReviewedAuthority,
  actual: ReviewedAuthority,
): void {
  if (deterministicJson(expected) !== deterministicJson(actual)) {
    throw invalidTransition(
      "The exact human-approved admitted Modelica authority changed during execution.",
    );
  }
}

function sameSnapshotBasis(
  candidate: EngineeringDecision["baseSnapshot"],
  expected: EngineeringThreadSnapshotBasis,
): boolean {
  return candidate?.snapshotId === expected.snapshotId &&
    candidate.revision === expected.revision &&
    candidate.subjectId === expected.subjectId;
}

function evidenceRefsEqual(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return deterministicJson(left) === deterministicJson(right);
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
  const capturedAt = requiredStart(input.run);
  const admissionArtifact = exactAdmissionArtifact(
    input.basisSnapshot,
    input.capture.admission.admissionArtifact.id,
    input.capture.admission.admissionArtifact.fingerprint,
  );
  const operation = {
    serverId: "digital-thread",
    tool:
      `${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id}@${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version}`,
    runId: input.run.id,
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const outputs = new Map(
    input.receipt.outputs.map((output) => [output.role, output]),
  );
  const evidenceOutput = outputs.get("evidence")!;
  const resultOutput = outputs.get("result")!;
  const captureArtifact: ThreadArtifact = {
    id: `modelica-admitted-capture-${input.captureFingerprint.digest}`,
    name: "Admitted Modelica execution capture",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [admissionArtifact.id],
    freshness,
  };
  const evidenceArtifact: ThreadArtifact = {
    id: `modelica-admitted-evidence-${evidenceOutput.sha256}`,
    name: "Admitted Modelica normalized evidence",
    kind: "evidence",
    version: evidenceOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: evidenceOutput.sha256 },
    uri: evidenceOutput.casUri,
    mediaType: evidenceOutput.mediaType,
    producer: operation,
    inputArtifactIds: [admissionArtifact.id],
    freshness,
  };
  const resultArtifact: ThreadArtifact = {
    id: `modelica-admitted-result-${resultOutput.sha256}`,
    name: "Admitted OpenModelica result",
    kind: "solver-result",
    version: resultOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: resultOutput.sha256 },
    uri: resultOutput.casUri,
    mediaType: resultOutput.mediaType,
    producer: operation,
    inputArtifactIds: [admissionArtifact.id],
    freshness,
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${admissionArtifact.id}-by-${captureArtifact.id}`,
    artifactId: admissionArtifact.id,
    consumer: operation,
    observedFingerprint: admissionArtifact.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const observation: ThreadObservation = {
    id: `modelica-admitted-temperature-final-${input.run.id}`,
    name: "Admitted Modelica final temperature",
    metric: "temperature_final",
    quantity: input.capture.temperatureFinal,
    source: {
      operation,
      artifactIds: [evidenceArtifact.id, resultArtifact.id],
      capturedAt,
    },
    freshness,
  };
  const provenance: ThreadProvenanceLink[] = [
    ...[captureArtifact, evidenceArtifact, resultArtifact].map((artifact) => ({
      id: `derived-from-${admissionArtifact.id}-by-${artifact.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: admissionArtifact.id },
      rationale:
        "The admitted Modelica executor reopened the exact reviewed technical-compilation admission before isolated execution.",
    })),
    {
      id: `uses-${consumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: admissionArtifact.id },
      rationale:
        "The execution verified the exact admission artifact fingerprint before dispatch.",
    },
    ...observation.source.artifactIds.map((artifactId) => ({
      id: `${observation.id}-from-${artifactId}`,
      relation: "derived_from" as const,
      from: { kind: "observation" as const, id: observation.id },
      to: { kind: "artifact" as const, id: artifactId },
      rationale:
        "The observation is reported by the exact normalized evidence and retained solver result.",
    })),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `simulate-run-admitted-modelica-${input.run.id}`,
    name: "Record admitted Modelica isolated run",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    consumptions: [consumption],
    observations: [observation],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "The admitted Modelica documentary branch is already present.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    observation,
  };
}

function exactAdmissionArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  const digest = fingerprint.digest;
  const matches = snapshot.artifacts.filter((artifact) =>
    id === `technical-compilation-admission-${digest}` &&
    artifact.id === id && artifact.kind === "document" &&
    fingerprintsEqual(artifact.fingerprint, fingerprint) &&
    artifact.version === digest &&
    artifact.uri ===
      `casys://technical-compilation-admission-capture/sha256/${digest}` &&
    artifact.mediaType === "application/json" &&
    artifact.freshness.status === "fresh" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "compile.seal-admission@1" &&
    !archivedRefKeys(snapshot).has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      `Technical-compilation admission ${id} is absent, stale, archived, ambiguous, or has divergent identity, fingerprint, producer, URI, or media type in the exact Thread basis.`,
    );
  }
  return matches[0]!;
}

function artifactEvidence(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringThreadEntityRef {
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function threadEvidenceFor(
  expected: DocumentarySuccessor,
): AdmittedModelicaExecutionThreadEvidenceInput {
  const [capture, evidence, result] = expected.artifacts;
  return {
    snapshotId: expected.snapshot.id,
    revision: expected.snapshot.revision,
    subjectId: expected.snapshot.subject.id,
    artifacts: {
      capture: { id: capture.id, fingerprint: capture.fingerprint },
      evidence: { id: evidence.id, fingerprint: evidence.fingerprint },
      result: { id: result.id, fingerprint: result.fingerprint },
    },
  };
}

function assertThreadEvidenceExact(
  actual: AdmittedModelicaExecutionThreadEvidence,
  expected: DocumentarySuccessor,
): void {
  const { fingerprint: _fingerprint, ...actualEvidence } = actual;
  if (
    deterministicJson(actualEvidence) !==
      deterministicJson(threadEvidenceFor(expected))
  ) {
    throw invalidTransition(
      "The admitted Modelica journal does not name the exact documentary Thread successor.",
    );
  }
}

function claimCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    expectedRevision,
    issuedAt,
    summary: "Started the exact reviewed admitted Modelica run.",
  };
}

function publishCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "publish"),
    expectedRevision,
    issuedAt,
    summary: "Publishing the admitted Modelica documentary evidence.",
  };
}

function completionCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  expected: DocumentarySuccessor,
  issuedAt = command.issuedAt,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    issuedAt,
    summary: "Recorded the exact admitted Modelica isolated run.",
    resultSnapshot: snapshotRef(expected.snapshot),
    evidenceRefs: expected.artifacts.map((artifact) =>
      artifactEvidence(expected.snapshot, artifact)
    ),
  };
}

function exactCommandReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ??
      [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== type ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId
  ) {
    throw invalidTransition(
      `The admitted Modelica run has no unique exact ${type} receipt.`,
    );
  }
  return receipt;
}

async function assertCommandReceiptExact(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
  type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
  command: RunCommand | CompleteRunCommand,
  status: "running" | "publishing" | "completed",
): Promise<void> {
  const expectedFingerprint = await sha256Fingerprint({ type, origin, command });
  const transitions =
    run.statusHistory?.filter((transition) =>
      transition.commandId === receipt.commandId &&
      transition.status === status &&
      transition.at === receipt.appliedAt &&
      transition.actor.origin === origin.kind &&
      transition.actor.id === origin.actorId &&
      transition.summary === command.summary
    ) ?? [];
  if (
    command.commandId !== receipt.commandId ||
    command.issuedAt !== receipt.issuedAt ||
    receipt.resultingSnapshot.revision !== command.expectedRevision + 1 ||
    !fingerprintsEqual(receipt.requestFingerprint, expectedFingerprint) ||
    transitions.length !== 1
  ) {
    throw invalidTransition(
      `The admitted Modelica ${type} receipt does not seal its exact command, revision, issuance, and status transition.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:simulate-run-admitted-modelica:${step}`;
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
