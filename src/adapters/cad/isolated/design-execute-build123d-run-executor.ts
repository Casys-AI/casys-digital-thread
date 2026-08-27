/**
 * Isolated execution executor for `design.execute-build123d@1`.
 *
 * The signed MRTR is an admission to one exact server-owned execution, not a
 * capability supplied by the agent. This adapter therefore reopens the
 * capture-backed compilation admission and the fixed execution profile before
 * it constructs a provider-neutral request. The STEP bytes remain behind the
 * isolated-output publication marker; the Thread receives only the execution
 * capture document.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import {
  type Build123dExecutionAttempt,
  type Build123dExecutionAttemptIdentity,
  type Build123dExecutionAttemptStore,
  fingerprintBuild123dExecutionAttemptIdentity,
} from "../../../application/ports/out/cad/isolated/build123d-execution-attempt-store.ts";
import type {
  Build123dExecutionProfile,
  Build123dExecutionProfileCatalog,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type {
  Build123dExecutionCaptureStore,
  Build123dExecutionDraftStore,
} from "../../../application/ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
  type IsolatedCodeRunRecovery,
  type IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { PrepareProjectBuild123dExecutionReview } from "../../../application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts";
import {
  isolatedRequestFromAdmittedSource,
  ReopenAdmittedCompilationSource,
} from "../../../application/use-cases/compile/admission/reopen-admitted-compilation-source.ts";
import {
  assertFailedIsolatedOutputValidationReplay,
  isolatedOutputValidationFailedMessage,
} from "../../../application/use-cases/compile/isolation/failed-isolated-output-validation-replay.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type Build123dExecutionCapture,
  createBuild123dExecutionCapture,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  type Build123dExecutionAdmission,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  parseBuild123dExecutionAdmissionParameters,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  isolatedCodeOutputManifestsEqual,
  type IsolatedCodeOutputValidationRejection,
  isolatedCodeRefsEqual,
  runtimeAttestationsEqual,
  validateIsolatedCodeExecutionDestruction,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeOutputValidationRejection,
  validateIsolatedOutputProducerGenerationAdvance,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { safeId } from "../../../domain/kernel/case-validation.ts";
import { COMPILATION_ADMISSION_BINDING_NAME } from "../../../domain/compile/admission/compilation-admission-run-operation.ts";
import {
  validateTechnicalCompilationDocument,
} from "../../../domain/compile/admission/technical-compilation.ts";
import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
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
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
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

export { DESIGN_EXECUTE_BUILD123D_OPERATION };

export const BUILD123D_ISOLATED_OUTPUT_VALIDATION_FAILED = {
  summary:
    "Isolated Build123d output validation was rejected before Thread publication.",
  code: "isolated_output_validation_failed",
} as const;

/**
 * Terminal Build123d conversion of a public isolated output-validation
 * rejection. It carries only the registered role, observed size/digest and
 * proven destruction; no worker diagnostic, bytes, path or handle.
 */
export class IsolatedBuild123dOutputValidationRejectedError extends Error {
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
      "A code-owned isolated Build123d output validator rejected the observed bytes; no redispatch occurs.",
    );
    this.name = "IsolatedBuild123dOutputValidationRejectedError";
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

export const BUILD123D_EXECUTION_CAPTURE_ARTIFACT_URI_PREFIX =
  "casys://build123d-execution-capture/sha256/" as const;

/** A result readback must bypass any in-process Thread snapshot cache. */
export interface Build123dExecutionThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface DesignExecuteBuild123dRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: Build123dExecutionThreadSnapshotStore;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: Build123dExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
  readonly attempts: Build123dExecutionAttemptStore;
  readonly drafts: Build123dExecutionDraftStore;
  readonly captures: Build123dExecutionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

interface ReviewedExecutionContext {
  readonly admission: Build123dExecutionAdmission;
  readonly reopened: ReopenedTechnicalCompilationAdmission;
  readonly request: IsolatedCodeExecutionRequest;
  readonly attemptIdentity: Build123dExecutionAttemptIdentity;
  readonly attemptFingerprint: ContentFingerprint;
}

async function reopenReviewedExecutionContext(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: Build123dExecutionProfileCatalog;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly basisSnapshot: ThreadSnapshot;
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly admission: Build123dExecutionAdmission;
  readonly executionRunId: string;
}): Promise<ReviewedExecutionContext> {
  const basis = requireBasis(input.run);
  const reviewRequest = {
    projectId: input.project.project.id,
    basis,
    artifactId: input.admission.admissionArtifact.id,
    artifactFingerprint: input.admission.admissionArtifact.fingerprint,
  };
  let reviewed;
  try {
    reviewed = await new PrepareProjectBuild123dExecutionReview({
      admissions: input.admissions,
      profiles: input.profiles,
    }).execute(reviewRequest);
  } catch {
    throw invalidTransition(
      "The exact compilation admission or server-owned Build123d execution profile could not be replayed.",
    );
  }
  if (
    deterministicJson(reviewed.admission) !== deterministicJson(input.admission) ||
    deterministicJson(reviewed.decisionParameters) !==
      deterministicJson(input.decision.proposal?.parameters)
  ) {
    throw invalidTransition(
      "The current capture-backed compilation or server-owned execution profile differs from the human-reviewed MRTR.",
    );
  }

  let admitted;
  try {
    admitted = await new ReopenAdmittedCompilationSource({
      admissions: input.admissions,
    }).execute({
      ...reviewRequest,
      expectedTarget: "build123d-source",
    });
  } catch {
    throw invalidTransition(
      "The exact technical-compilation admission could not be reopened for execution.",
    );
  }
  const document = admitted.document;
  const documentFingerprint = admitted.documentFingerprint;
  const projection = admitted.projection;
  const source = document.inputManifest.sources[0]!;
  const admittedSource = admitted.reopened.admission.sources[0]!;
  const projectionFingerprint = await sha256Fingerprint(projection);
  const sourceFingerprint = admitted.sourceFingerprint;
  if (
    !fingerprintsEqual(
      documentFingerprint,
      input.admission.compilation.document.fingerprint,
    ) ||
    !fingerprintsEqual(
      projectionFingerprint,
      input.admission.compilation.projection.fingerprint,
    ) || source.analysis.source.id !== input.admission.compilation.source.id ||
    admittedSource.id !== input.admission.compilation.source.id ||
    !fingerprintsEqual(
      sourceFingerprint,
      input.admission.compilation.source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      source.analysisFingerprint,
      input.admission.compilation.source.analysisFingerprint,
    ) ||
    !fingerprintsEqual(
      admittedSource.captureFingerprint,
      input.admission.compilation.source.captureFingerprint,
    ) || projection.profile.id !== input.admission.compilation.profile.id ||
    projection.profile.version !== input.admission.compilation.profile.version ||
    !fingerprintsEqual(
      projection.profileFingerprint,
      input.admission.compilation.profile.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The reopened Build123d projection or source differs from its exact reviewed identity.",
    );
  }

  let profile: Build123dExecutionProfile;
  try {
    profile = await input.profiles.resolve({
      id: input.admission.execution.profile.id,
      version: input.admission.execution.profile.version,
    });
  } catch {
    throw invalidTransition(
      "The exact server-owned Build123d execution profile is unavailable.",
    );
  }
  await assertExecutionProfileExact(profile, input.admission, projection);
  const request = await isolatedRequestFromAdmittedSource({
    runId: input.executionRunId,
    sourceText: admitted.sourceText,
    sourceSha256: sourceFingerprint.digest,
    profile: profile.executionProfile,
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
    maximumSourceBytes: profile.maximumSourceBytes,
  });
  const attemptIdentity: Build123dExecutionAttemptIdentity = {
    projectId: input.project.project.id,
    agentRunId: input.run.id,
    executionRunId: input.executionRunId,
    basis: {
      ...basis,
      fingerprint: await sha256Fingerprint(input.basisSnapshot),
    },
    run: {
      workItemId: input.run.workItemId,
      inputFingerprint: input.run.inputFingerprint!,
      startedAt: requiredStart(input.run),
    },
    decision: {
      id: input.decision.id,
      inputFingerprint: input.decision.inputFingerprint!,
    },
    approval: {
      id: input.approval.id,
      inputFingerprint: input.approval.inputFingerprint!,
      fingerprint: await sha256Fingerprint(input.approval),
    },
    admission: input.admission,
    technicalAdmission: {
      trustedRunId: admitted.reopened.trustedRunId,
      decisionId: admitted.reopened.decisionId,
      sealedAt: admitted.reopened.sealedAt,
      draftReference: admitted.reopened.draftReference,
      documentFingerprint,
      projectionFingerprint,
      sourceFingerprint,
    },
    executionProfile: profile,
    isolatedRequest: {
      schemaVersion: request.schemaVersion,
      runId: request.runId,
      producerGeneration: 0,
      profile: request.profile,
      sourceSha256: request.source.sha256,
      policy: request.policy,
      outputs: request.outputs,
    },
    document: input.admission.compilation.document,
    projection: input.admission.compilation.projection,
    source: input.admission.compilation.source,
    profile: input.admission.execution.profile,
    output: input.admission.execution.output,
  };
  const attemptFingerprint = await fingerprintBuild123dExecutionAttemptIdentity(
    attemptIdentity,
  );
  return {
    admission: reviewed.admission,
    reopened: admitted.reopened,
    request: {
      schemaVersion: request.schemaVersion,
      runId: request.runId,
      producerGeneration: 0,
      profile: request.profile,
      source: {
        bytes: Uint8Array.from(request.source.bytes),
        sha256: request.source.sha256,
      },
      policy: request.policy,
      outputs: request.outputs,
    },
    attemptIdentity,
    attemptFingerprint,
  };
}

async function assertExecutionProfileExact(
  profile: Build123dExecutionProfile,
  admission: Build123dExecutionAdmission,
  projection: Awaited<
    ReturnType<typeof validateTechnicalCompilationDocument>
  >["projections"][number],
): Promise<void> {
  const {
    profileFingerprint,
    ...profileBody
  } = profile;
  const observedProfileFingerprint = await sha256Fingerprint(profileBody);
  if (
    !fingerprintsEqual(profileFingerprint, observedProfileFingerprint) ||
    !fingerprintsEqual(profileFingerprint, admission.execution.profile.fingerprint) ||
    profile.executionProfile.id !== admission.execution.profile.id ||
    profile.executionProfile.version !== admission.execution.profile.version ||
    profile.compilationTarget !== "build123d-source" ||
    deterministicJson(profile.compilationProfile) !==
      deterministicJson(projection.profile) ||
    !fingerprintsEqual(
      profile.compilationProfileFingerprint,
      projection.profileFingerprint,
    ) ||
    !isolatedCodeRefsEqual(
      profile.isolationPolicy,
      admission.execution.isolationPolicy,
    ) ||
    deterministicJson(profile.runtimeBackend) !==
      deterministicJson(admission.execution.runtimeBackend) ||
    !runtimeAttestationsEqual(profile.runtime, {
      imageDigest: admission.execution.runtime.imageDigest,
      isolationClass: admission.execution.runtime.isolationClass,
      requestedLimits: admission.execution.runtime.limits,
      limitAssurance: admission.execution.runtime.limitAssurance,
    }) ||
    !isolatedCodeOutputManifestsEqual(profile.outputManifest, [
      admission.execution.output,
    ]) ||
    profile.outputValidator.id !== admission.execution.outputValidator.id ||
    profile.outputValidator.version !==
      admission.execution.outputValidator.version ||
    profile.minimumDestructionAssurance !==
      admission.execution.minimumDestructionAssurance
  ) {
    throw invalidTransition(
      "The reopened server-owned execution profile differs from the complete reviewed isolation, validator, output, or cleanup contract.",
    );
  }
}

/** Server-owned executor; no caller-selected provider, command or arguments. */
export class DesignExecuteBuild123dRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: DesignExecuteBuild123dRunExecutorDependencies["commands"];
  readonly #snapshots: Build123dExecutionThreadSnapshotStore;
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #profiles: Build123dExecutionProfileCatalog;
  readonly #runner: IsolatedCodeRunner;
  readonly #recovery: IsolatedCodeRunRecovery;
  readonly #publications: IsolatedOutputPublicationReader;
  readonly #attempts: Build123dExecutionAttemptStore;
  readonly #drafts: Build123dExecutionDraftStore;
  readonly #captures: Build123dExecutionCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: DesignExecuteBuild123dRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#admissions = dependencies.admissions;
    this.#profiles = dependencies.profiles;
    this.#runner = dependencies.runner;
    this.#recovery = dependencies.recovery;
    this.#publications = dependencies.publications;
    this.#attempts = dependencies.attempts;
    this.#drafts = dependencies.drafts;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a reviewed Build123d run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseExecutionAdmission(approval.proposal.parameters);
    assertAdmissionScope(project, run, approval.decision, admission);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: Build123dExecutionAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let dispatchMayHaveStarted = false;
    let threadSaveMayHaveStarted = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireExecutionShape(project, run);
      dispatchMayHaveStarted = run.status === "running" ||
        run.status === "publishing";
      const completed = await this.#completedFor(
        origin,
        command,
        approvedDecision,
        admission,
      );
      if (completed) return completed;
      if (run.status === "failed") {
        return await this.#reopenFailedOutputValidation(
          origin,
          command,
          approvedDecision,
          admission,
        );
      }

      await assertThreadWriteBasisAvailable(project, run);
      const preClaimBasis = requireBasis(run);
      const preClaimSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        preClaimBasis,
      );
      await assertThreadSnapshotLineageIntact(preClaimSnapshot, this.#snapshots);
      exactAdmissionArtifact(
        preClaimSnapshot,
        admission.admissionArtifact.id,
        admission.admissionArtifact.fingerprint,
      );

      if (
        run.status === "queued" || run.status === "running" ||
        run.status === "publishing"
      ) {
        if (run.status !== "queued") requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, claimCommand(command));
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        const recovered = await this.#completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (recovered) return recovered;
        throw invalidTransition("The completed Build123d run failed exact replay.");
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }

      const currentApproval = await requireMrtrApproval(project, run);
      const currentAdmission = parseExecutionAdmission(
        currentApproval.proposal.parameters,
      );
      if (
        currentApproval.decision.id !== approvedDecision.id ||
        deterministicJson(currentAdmission) !== deterministicJson(admission)
      ) {
        throw invalidTransition(
          "The exact human-reviewed Build123d decision changed after the run was claimed.",
        );
      }
      assertAdmissionScope(
        project,
        run,
        currentApproval.decision,
        currentAdmission,
      );
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      exactAdmissionArtifact(
        basisSnapshot,
        currentAdmission.admissionArtifact.id,
        currentAdmission.admissionArtifact.fingerprint,
      );
      const executionRunId = await deriveBuild123dExecutionRunId(
        command.projectId,
        run.id,
      );
      const context = await reopenReviewedExecutionContext({
        admissions: this.#admissions,
        profiles: this.#profiles,
        project,
        run,
        basisSnapshot,
        decision: currentApproval.decision,
        approval: currentApproval.approval,
        admission: currentAdmission,
        executionRunId,
      });
      const attemptKey = {
        projectId: command.projectId,
        agentRunId: run.id,
        executionRunId,
        attemptFingerprint: context.attemptFingerprint,
      };
      const startedAt = requiredStart(run);
      let attempt = await this.#attempts.read(command.projectId, run.id);
      if (!attempt) {
        attempt = await this.#attempts.prepare(context.attemptIdentity);
      }
      assertAttemptIdentity(attempt, attemptKey);
      if (attempt.phase === "output-validation-rejected") {
        throwOutputValidationRejected(attempt);
      }

      let receipt: IsolatedCodeExecutionReceipt;
      if (attempt.phase === "prepared") {
        attempt = await this.#attempts.markDispatching({
          ...attemptKey,
          dispatchedAt: startedAt,
        });
        assertAttemptIdentity(attempt, attemptKey);
        dispatchMayHaveStarted = true;
        receipt = await this.#runOrReject(context.request, attemptKey);
      } else {
        dispatchMayHaveStarted = true;
        receipt = await this.#recoverReceiptOrRedispatch(
          context,
          attempt,
          attemptKey,
        );
      }
      const durableDispatchAttempt = await this.#attempts.read(
        command.projectId,
        run.id,
      );
      if (!durableDispatchAttempt) {
        throw invalidTransition(
          "The durable Build123d dispatch journal disappeared before receipt validation.",
        );
      }
      assertAttemptIdentity(durableDispatchAttempt, attemptKey);
      attempt = durableDispatchAttempt;
      const receiptRecord = await assertReceiptExact(
        receipt,
        requestForDurableDispatch(context.request, attempt),
        context.admission,
      );
      attempt = await this.#attempts.markOutputPublished({
        ...attemptKey,
        receiptRecord,
      });
      assertAttemptIdentity(attempt, attemptKey);

      const executionBasis = {
        ...basis,
        fingerprint: await sha256Fingerprint(basisSnapshot),
      };
      const evidenceInput = {
        projectId: command.projectId,
        basis: executionBasis,
        agentRunId: run.id,
        executionRunId,
        decisionId: currentApproval.decision.id,
        executedAt: startedAt,
        admission: context.admission,
        receiptRecord,
      };
      const expectedDraft = await createBuild123dExecutionDraft(evidenceInput);
      const persistedDraft = await this.#drafts.save(expectedDraft);
      const reopenedDraft = await this.#drafts.read(persistedDraft.reference);
      if (
        !reopenedDraft ||
        deterministicJson(reopenedDraft) !== deterministicJson(expectedDraft)
      ) {
        throw new Error(
          "The non-canonical Build123d execution draft failed exact readback.",
        );
      }
      attempt = await this.#attempts.markDraftPersisted({
        ...attemptKey,
        draftReference: persistedDraft.reference,
      });
      assertAttemptIdentity(attempt, attemptKey);

      const capture = await createBuild123dExecutionCapture({
        ...evidenceInput,
        draftReference: persistedDraft.reference,
      });
      const persistedCapture = await this.#captures.save(capture);
      const reopenedCapture = await this.#captures.read(
        persistedCapture.fingerprint,
      );
      if (
        !reopenedCapture ||
        deterministicJson(reopenedCapture) !== deterministicJson(capture) ||
        persistedCapture.uri !==
          this.#captures.uriFor(persistedCapture.fingerprint)
      ) {
        throw new Error(
          "The Build123d execution capture failed exact readback.",
        );
      }

      const expectedSuccessor = buildExecutionSuccessor({
        basisSnapshot,
        basis,
        run,
        capture: reopenedCapture,
        captureFingerprint: persistedCapture.fingerprint,
        captureUri: persistedCapture.uri,
      });
      threadSaveMayHaveStarted = true;
      await this.#snapshots.save(expectedSuccessor.snapshot);
      const savedSnapshot = await this.#snapshots.getFresh(
        expectedSuccessor.snapshot.id,
      );
      if (
        !savedSnapshot || deterministicJson(savedSnapshot) !==
          deterministicJson(expectedSuccessor.snapshot)
      ) {
        throw new Error(
          "The Build123d execution Thread successor failed exact durable readback.",
        );
      }
      attempt = await this.#attempts.markThreadPersisted({
        ...attemptKey,
        threadEvidence: {
          snapshotId: expectedSuccessor.snapshot.id,
          revision: expectedSuccessor.snapshot.revision,
          subjectId: expectedSuccessor.snapshot.subject.id,
          artifactId: expectedSuccessor.artifact.id,
          artifactFingerprint: expectedSuccessor.artifact.fingerprint,
        },
      });
      assertAttemptIdentity(attempt, attemptKey);

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      await this.#publishExact(origin, project, command);

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completionCommand(
            command,
            project.revision,
            expectedSuccessor.snapshot,
            expectedSuccessor.artifact,
          ),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.#requiredProject(command.projectId);
      await this.#assertCompletedEvidence(
        origin,
        complete,
        command,
        currentApproval.decision,
        context.admission,
        true,
      );
      return complete;
    } catch (error) {
      if (error instanceof IsolatedBuild123dOutputValidationRejectedError) {
        return await this.#failOutputValidationRejected(origin, command, error);
      }
      if (dispatchMayHaveStarted || threadSaveMayHaveStarted) {
        const completed = await this.#completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (completed) return completed;
        throw invalidTransition(
          "The Build123d execution or its documentary Thread write has a durable or uncertain effect. " +
            "Retry this exact command; recovery will inspect the run-keyed publication and journal before any further dispatch.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #publishExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    if (run.status === "publishing" || run.status === "completed") {
      const receipt = exactPublishReceipt(project, command, origin);
      expectedRevision = receipt.resultingSnapshot.revision - 1;
    } else if (run.status !== "running") {
      throw unexpectedStatus(run, "running, publishing, or completed");
    }
    await this.#commands.publishRun(
      origin,
      publishCommand(command, expectedRevision),
    );
  }

  async #recoverReceiptOrRedispatch(
    context: ReviewedExecutionContext,
    attempt: Build123dExecutionAttempt,
    key: {
      readonly projectId: string;
      readonly agentRunId: string;
      readonly executionRunId: string;
      readonly attemptFingerprint: ContentFingerprint;
    },
  ): Promise<IsolatedCodeExecutionReceipt> {
    if (attempt.phase === "output-validation-rejected") {
      throwOutputValidationRejected(attempt);
    }
    if ("receiptRecord" in attempt) {
      const receipt = await this.#readReceiptFromRecord(attempt.receiptRecord);
      if (receipt.producerGeneration !== attempt.dispatch.producerGeneration) {
        throw invalidTransition(
          "The durable receipt belongs to another producer generation.",
        );
      }
      return receipt;
    }
    if (attempt.phase === "prepared") {
      throw invalidTransition(
        "The execution journal has no durable dispatch to recover.",
      );
    }
    let resolution;
    try {
      resolution = await this.#publications.resolvePublicationByRunId(
        key.executionRunId,
        attempt.dispatch.producerGeneration,
      );
    } catch {
      throw invalidTransition(
        "The run-keyed isolated-output publication could not be resolved; the execution remains active and will not be redispatched.",
      );
    }
    if (
      resolution.runId !== key.executionRunId ||
      resolution.producerGeneration !== attempt.dispatch.producerGeneration
    ) {
      throw invalidTransition(
        "The run-keyed isolated-output resolution names another producer generation; the execution remains active and will not be redispatched.",
      );
    }
    if (resolution.status === "published") {
      return await this.#readReceiptFromRecord(resolution.receipt);
    }
    if (resolution.status === "outcome-unknown") {
      throw invalidTransition(
        "The isolated-output publication outcome is unknown; the execution remains active and will not be redispatched.",
      );
    }
    if (attempt.phase !== "dispatching") {
      throw invalidTransition(
        "The execution journal is not in its exact dispatch recovery phase.",
      );
    }
    let authorized: Build123dExecutionAttempt = attempt;
    if (attempt.dispatch.dispatchCount === 1) {
      let destruction: IsolatedCodeExecutionReceipt["destruction"];
      try {
        destruction = await this.#recovery.destroyByRunId(
          key.executionRunId,
          0,
        );
      } catch {
        throw invalidTransition(
          "No output publication exists and run-scoped isolated cleanup could not be verified; the execution will not be redispatched.",
        );
      }
      assertDestructionAssurance(
        destruction,
        context.admission,
        key.executionRunId,
      );
      if (destruction.status !== "proven") {
        throw invalidTransition(
          "A second producer generation requires proven cleanup of generation zero.",
        );
      }
      let generationAdvance;
      try {
        generationAdvance = await this.#recovery.advanceProducerGeneration({
          runId: key.executionRunId,
          closedGeneration: 0,
          nextGeneration: 1,
        });
      } catch {
        throw invalidTransition(
          "The first producer generation was cleaned up but its durable CAS advance could not be proven; no redispatch will occur.",
        );
      }
      authorized = await this.#attempts.authorizeRedispatch({
        ...key,
        recoveryDestruction: destruction,
        generationAdvance,
      });
    }
    assertAttemptIdentity(authorized, key);
    if (
      authorized.phase !== "dispatching" ||
      authorized.dispatch.dispatchCount !== 2 ||
      authorized.dispatch.producerGeneration !== 1
    ) {
      throw invalidTransition(
        "The second dispatch may already have started or its authorization is not exact; manual recovery is required and no further isolated execution will be dispatched.",
      );
    }
    try {
      await validateIsolatedOutputProducerGenerationAdvance(
        authorized.dispatch.redispatch.generationAdvance,
        key.executionRunId,
      );
    } catch {
      throw invalidTransition(
        "The durable producer-generation advance proof is not exact; no redispatch will occur.",
      );
    }
    assertDestructionAssurance(
      authorized.dispatch.redispatch.recoveryDestruction,
      context.admission,
      key.executionRunId,
    );
    const consumption = await this.#attempts.consumeRedispatch(key);
    assertAttemptIdentity(consumption.attempt, key);
    if (consumption.outcome === "already-consumed") {
      let terminalDestruction: IsolatedCodeExecutionReceipt["destruction"];
      try {
        terminalDestruction = await this.#recovery.destroyByRunId(
          key.executionRunId,
          1,
        );
      } catch {
        throw invalidTransition(
          "The consumed second producer generation could not be closed with proven cleanup; manual recovery is required.",
        );
      }
      assertDestructionAssurance(
        terminalDestruction,
        context.admission,
        key.executionRunId,
      );
      if (terminalDestruction.status !== "proven") {
        throw invalidTransition(
          "The consumed second producer generation requires proven cleanup before terminal quarantine.",
        );
      }
      throw invalidTransition(
        "The second dispatch authorization was already consumed and generation one was durably closed; no further isolated execution will be dispatched.",
      );
    }
    if (
      consumption.attempt.phase !== "dispatching" ||
      consumption.attempt.dispatch.dispatchCount !== 2 ||
      consumption.attempt.dispatch.producerGeneration !== 1 ||
      consumption.attempt.dispatch.redispatch.status !== "consumed"
    ) {
      throw invalidTransition(
        "The second dispatch authorization was already consumed; manual recovery is required and no further isolated execution will be dispatched.",
      );
    }
    return await this.#runOrReject({
      ...context.request,
      producerGeneration: 1,
    }, key);
  }

  async #runOrReject(
    request: IsolatedCodeExecutionRequest,
    key: {
      readonly projectId: string;
      readonly agentRunId: string;
      readonly executionRunId: string;
      readonly attemptFingerprint: ContentFingerprint;
    },
  ): Promise<IsolatedCodeExecutionReceipt> {
    try {
      return await this.#runner.run(request);
    } catch (error) {
      if (!(error instanceof IsolatedCodeOutputValidationRejectedError)) {
        throw error;
      }
      if (
        error.destruction.status !== "proven" ||
        error.destruction.runId !== key.executionRunId
      ) {
        throw invalidTransition(
          "Isolated Build123d output-validation cleanup is not proven; no redispatch occurs.",
        );
      }
      const rejected = await this.#attempts.markOutputValidationRejected({
        ...key,
        observation: error.observation,
        destruction: error.destruction,
      });
      return throwOutputValidationRejected(rejected);
    }
  }

  async #readReceiptFromRecord(
    recordValue: unknown,
  ): Promise<IsolatedCodeExecutionReceipt> {
    const record = await validateIsolatedCodeExecutionReceiptRecord(recordValue);
    let receipt: IsolatedCodeExecutionReceipt | undefined;
    try {
      receipt = await this.#publications.readReceipt(record.publication.ref);
    } catch {
      throw invalidTransition(
        "The published isolated execution receipt could not be reopened.",
      );
    }
    if (
      !receipt || deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(record)
    ) {
      throw invalidTransition(
        "The published isolated execution receipt differs from its durable journal record.",
      );
    }
    return receipt;
  }

  async #completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    decision: EngineeringDecision,
    admission: Build123dExecutionAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#commands.claimRun(origin, claimCommand(command));
    const replayed = await this.#requiredProject(command.projectId);
    await this.#assertCompletedEvidence(
      origin,
      replayed,
      command,
      decision,
      admission,
    );
    return replayed;
  }

  async #assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    decision: EngineeringDecision,
    admission: Build123dExecutionAdmission,
    publicationAlreadyReplayed = false,
  ): Promise<void> {
    assertCompleted(project, command);
    const run = requireRun(project, command.runId);
    requireClaimedShape(project, run, origin);
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
    const result = run.resultSnapshot!;
    const snapshot = await this.#snapshots.getFresh(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision ||
      snapshot.revision !== basis.revision + 1 ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw invalidTransition(
        "The completed Build123d run does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    await assertThreadSnapshotLineageIntact(validatedSnapshot, this.#snapshots);
    const artifact = exactCompletedEvidence(project, run, validatedSnapshot);
    const capture = await this.#captures.read(artifact.fingerprint);
    if (
      !capture || capture.trustedAgentRunId !== run.id ||
      capture.decisionId !== decision.id ||
      capture.executedAt !== requiredStart(run) ||
      deterministicJson(capture.admission) !== deterministicJson(admission) ||
      !fingerprintsEqual(await sha256Fingerprint(capture), artifact.fingerprint) ||
      this.#captures.uriFor(artifact.fingerprint) !== artifact.uri
    ) {
      throw invalidTransition(
        "The completed Build123d execution capture is absent or differs from the exact reviewed run.",
      );
    }
    const draft = await this.#drafts.read(capture.noncanonicalDraft);
    if (!draft || draft.executionRunId !== capture.executionRunId) {
      throw invalidTransition(
        "The completed Build123d execution no longer reopens its exact non-canonical draft.",
      );
    }
    const executionRunId = await deriveBuild123dExecutionRunId(
      command.projectId,
      run.id,
    );
    const currentApproval = await requireMrtrApproval(project, run);
    if (currentApproval.decision.id !== decision.id) {
      throw invalidTransition(
        "The completed Build123d run no longer has its exact reviewed decision.",
      );
    }
    const context = await reopenReviewedExecutionContext({
      admissions: this.#admissions,
      profiles: this.#profiles,
      project,
      run,
      basisSnapshot,
      decision,
      approval: currentApproval.approval,
      admission,
      executionRunId,
    });
    const attempt = await this.#attempts.read(command.projectId, run.id);
    if (!attempt) {
      throw invalidTransition(
        "The completed Build123d execution has no durable attempt journal.",
      );
    }
    assertAttemptIdentity(attempt, {
      projectId: command.projectId,
      agentRunId: run.id,
      executionRunId,
      attemptFingerprint: context.attemptFingerprint,
    });
    if (attempt.phase !== "thread-persisted" && attempt.phase !== "completed") {
      throw invalidTransition(
        "The completed project run has not durably persisted its exact Thread evidence in the execution journal.",
      );
    }
    if (
      deterministicJson(attempt.receiptRecord) !==
        deterministicJson(capture.receiptRecord) ||
      deterministicJson(attempt.draftReference) !==
        deterministicJson(capture.noncanonicalDraft)
    ) {
      throw invalidTransition(
        "The completed Build123d journal no longer matches its exact captured receipt and non-canonical draft.",
      );
    }
    const receipt = await this.#readReceiptFromRecord(capture.receiptRecord);
    await assertReceiptExact(
      receipt,
      requestForDurableDispatch(context.request, attempt),
      admission,
    );
    const expected = buildExecutionSuccessor({
      basisSnapshot,
      basis,
      run,
      capture,
      captureFingerprint: artifact.fingerprint,
      captureUri: artifact.uri,
    });
    if (deterministicJson(expected.snapshot) !== deterministicJson(snapshot)) {
      throw invalidTransition(
        "The completed Thread successor is not the deterministic documentary execution snapshot.",
      );
    }
    if (
      deterministicJson(attempt.threadEvidence) !== deterministicJson({
        snapshotId: expected.snapshot.id,
        revision: expected.snapshot.revision,
        subjectId: expected.snapshot.subject.id,
        artifactId: expected.artifact.id,
        artifactFingerprint: expected.artifact.fingerprint,
      })
    ) {
      throw invalidTransition(
        "The completed Build123d journal does not name the exact documentary Thread successor.",
      );
    }
    if (!publicationAlreadyReplayed) {
      await this.#publishExact(origin, project, command);
    }
    const completionReceipt = exactCompletionReceipt(project, command, origin, run);
    await this.#commands.completeRun(
      origin,
      completionCommand(
        command,
        completionReceipt.resultingSnapshot.revision - 1,
        expected.snapshot,
        expected.artifact,
      ),
    );
    if (attempt.phase === "thread-persisted") {
      const completedAttempt = await this.#attempts.markCompleted({
        projectId: command.projectId,
        agentRunId: run.id,
        executionRunId,
        attemptFingerprint: context.attemptFingerprint,
      });
      assertAttemptIdentity(completedAttempt, {
        projectId: command.projectId,
        agentRunId: run.id,
        executionRunId,
        attemptFingerprint: context.attemptFingerprint,
      });
      if (completedAttempt.phase !== "completed") {
        throw invalidTransition(
          "The recovered Build123d execution journal did not complete exactly.",
        );
      }
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Build123d execution stopped before an isolated dispatch was durably recorded.",
        code: "design-execute-build123d-not-dispatched",
        message:
          "The reviewed Build123d execution stopped before any isolated execution could be dispatched.",
      });
    } catch {
      // Preserve the original pre-dispatch error.
    }
  }

  async #reopenFailedOutputValidation(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    _approvedDecision: EngineeringDecision,
    _admission: Build123dExecutionAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "failed") {
      throw unexpectedStatus(run, "failed");
    }
    const attempt = await this.#attempts.read(command.projectId, run.id);
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
    error: IsolatedBuild123dOutputValidationRejectedError,
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
        "The claimed Build123d run already carries Thread evidence and cannot take an evidence-free terminal failure.",
      );
    }
    const startedAt = run.startedAt;
    await this.#commands.failRun(
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

function requireExecutionShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem || operation?.id !== DESIGN_EXECUTE_BUILD123D_OPERATION.id ||
    operation.version !== DESIGN_EXECUTE_BUILD123D_OPERATION.version ||
    operation.bindings.length !== 1 ||
    binding?.name !== COMPILATION_ADMISSION_BINDING_NAME ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version} with the sole compilationAdmission Thread artifact binding.`,
    );
  }
  const basis = requireBasis(run);
  if (
    binding.source.reference.snapshotId !== basis.snapshotId ||
    binding.source.reference.snapshotRevision !== basis.revision
  ) {
    throw invalidTransition(
      "The compilationAdmission binding must name an artifact in the run's exact Thread basis revision.",
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
      "This executor may continue only the exact Build123d run it claimed.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      `Basis snapshot ${basis.snapshotId}@${basis.revision} is not exactly available.`,
    );
  }
  return validateThreadSnapshot(snapshot);
}

function exactAdmissionArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === id && artifact.kind === "document" &&
    fingerprintsEqual(artifact.fingerprint, fingerprint) &&
    artifact.freshness.status === "fresh" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === COMPILE_SEAL_ADMISSION_PRODUCER_TOOL
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      `Technical-compilation admission ${id} is absent, stale, ambiguous, or fingerprint-divergent in the exact Thread basis.`,
    );
  }
  return matches[0]!;
}

function assertAttemptIdentity(
  attempt: Build123dExecutionAttempt,
  expected: {
    readonly projectId: string;
    readonly agentRunId: string;
    readonly executionRunId: string;
    readonly attemptFingerprint: ContentFingerprint;
  },
): void {
  if (
    attempt.projectId !== expected.projectId ||
    attempt.agentRunId !== expected.agentRunId ||
    attempt.executionRunId !== expected.executionRunId ||
    !fingerprintsEqual(
      attempt.attemptFingerprint,
      expected.attemptFingerprint,
    )
  ) {
    throw invalidTransition(
      "The Build123d execution journal differs from the exact reviewed attempt identity.",
    );
  }
}

async function assertReceiptExact(
  receipt: IsolatedCodeExecutionReceipt,
  request: IsolatedCodeExecutionRequest,
  admission: Build123dExecutionAdmission,
): Promise<IsolatedCodeExecutionReceiptRecord> {
  const record = await validateIsolatedCodeExecutionReceiptRecord(
    isolatedCodeExecutionReceiptRecord(receipt),
  );
  if (
    record.runId !== request.runId ||
    record.producerGeneration !== request.producerGeneration ||
    !isolatedCodeRefsEqual(record.profile, request.profile) ||
    record.sourceSha256 !== request.source.sha256 ||
    !isolatedCodeRefsEqual(record.policy, request.policy) ||
    !isolatedCodeOutputManifestsEqual(record.outputs, request.outputs) ||
    !runtimeAttestationsEqual(record.runtime, {
      imageDigest: admission.execution.runtime.imageDigest,
      isolationClass: admission.execution.runtime.isolationClass,
      requestedLimits: admission.execution.runtime.limits,
      limitAssurance: admission.execution.runtime.limitAssurance,
    }) || record.termination.kind !== "exited" ||
    record.termination.exitCode !== 0 || record.outputs.length !== 1 ||
    record.publication.ref.runId !== request.runId ||
    record.publication.ref.producerGeneration !== request.producerGeneration
  ) {
    throw invalidTransition(
      "The isolated execution receipt differs from its exact reviewed request, runtime, or output manifest.",
    );
  }
  assertDestructionAssurance(
    record.destruction,
    admission,
    request.runId,
  );
  return record;
}

function requestForDurableDispatch(
  initialRequest: IsolatedCodeExecutionRequest,
  attempt: Build123dExecutionAttempt,
): IsolatedCodeExecutionRequest {
  if (attempt.phase === "prepared") {
    throw invalidTransition(
      "The Build123d receipt cannot be validated before a dispatch generation is durably journaled.",
    );
  }
  return {
    ...initialRequest,
    producerGeneration: attempt.dispatch.producerGeneration,
  };
}

function assertDestructionAssurance(
  destruction: IsolatedCodeExecutionReceipt["destruction"],
  admission: Build123dExecutionAdmission,
  executionRunId: string,
): void {
  if (
    destruction.runId !== executionRunId ||
    (admission.execution.minimumDestructionAssurance === "proven" &&
      destruction.status !== "proven")
  ) {
    throw invalidTransition(
      "Isolated cleanup does not meet the exact reviewed destruction assurance.",
    );
  }
}

function buildExecutionSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: Build123dExecutionCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const executedAt = requiredStart(input.run);
  const admissionArtifact = exactAdmissionArtifact(
    input.basisSnapshot,
    input.capture.admission.admissionArtifact.id,
    input.capture.admission.admissionArtifact.fingerprint,
  );
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: `build123d-execution-capture-${input.captureFingerprint.digest}`,
    name: `Build123d execution capture ${input.capture.executionRunId}`,
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [admissionArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: executedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${admissionArtifact.id}-by-${artifact.id}`,
    artifactId: admissionArtifact.id,
    consumer: operationRef,
    observedFingerprint: admissionArtifact.fingerprint,
    verifiedAt: executedAt,
    status: "verified",
  };
  const extension: ThreadSnapshotExtension = {
    id: `design-execute-build123d-${input.run.id}`,
    name: "Record the reviewed isolated Build123d execution",
    subjectId: input.basis.subjectId,
    capturedAt: executedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-${admissionArtifact.id}-by-${artifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: admissionArtifact.id },
      rationale:
        "The execution capture reopens the exact human-reviewed technical-compilation admission.",
    }, {
      id: `uses-${consumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: admissionArtifact.id },
      rationale:
        "The executor verified the exact admission artifact fingerprint before isolated execution.",
    }],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: executedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact Build123d execution capture is already present in the basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    approval: EngineeringApproval;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((candidate) =>
      candidate.id === decisionId && candidate.status === "approved"
    );
    if (!decision?.proposal || !decision.inputFingerprint) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id && approval.status === "approved" &&
      decision.approvalIds.includes(approval.id) &&
      approval.decidedByOrigin === "human" &&
      typeof approval.decidedBy === "string" &&
      approval.decidedBy.trim().length > 0 &&
      typeof approval.decidedAt === "string" &&
      !Number.isNaN(Date.parse(approval.decidedAt)) &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      evidenceRefsEqual(approval.inputEvidenceRefs, decision.inputEvidenceRefs) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({
        decision,
        approval: approvals[0]!,
        proposal: decision.proposal,
      });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved Build123d execution decision is bound to this run basis."
        : "Ambiguous Build123d execution authority: exactly one human-approved decision is required.",
    );
  }
  const selected = candidates[0]!;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(expectedDecisionFingerprint, selected.decision.inputFingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The Build123d execution decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((candidate) => candidate.id === id);
    if (!decision?.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The Build123d run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return selected;
}

function parseExecutionAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): Build123dExecutionAdmission {
  try {
    return parseBuild123dExecutionAdmissionParameters(parameters);
  } catch (error) {
    void error;
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Build123d execution parameters failed exact closed-schema validation.",
    );
  }
}

function assertAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: Build123dExecutionAdmission,
): void {
  const basis = requireBasis(run);
  const evidence = exactAdmissionEvidenceRef(decision);
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings[0]!;
  if (
    evidence.snapshotId !== basis.snapshotId ||
    evidence.snapshotRevision !== basis.revision ||
    evidence.id !== admission.admissionArtifact.id ||
    binding.source.kind !== "thread-entity" ||
    deterministicJson(binding.source.reference) !== deterministicJson(evidence)
  ) {
    throw invalidTransition(
      "The operation binding, MRTR evidence, and reviewed technical-admission artifact are not the same exact Thread entity.",
    );
  }
}

function exactAdmissionEvidenceRef(
  decision: EngineeringDecision,
): EngineeringThreadEntityRef {
  if (
    decision.inputEvidenceRefs.length !== 1 ||
    decision.inputEvidenceRefs[0]?.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The Build123d execution MRTR must name exactly one technical-admission artifact.",
    );
  }
  return decision.inputEvidenceRefs[0];
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
    summary: "Started the exact reviewed isolated Build123d execution.",
  };
}

function failCommand(
  command: RegisteredProjectRunExecutorCommand,
  failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  },
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): FailRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "fail"),
    expectedRevision,
    issuedAt,
    summary: failure.summary,
    code: failure.code,
    message: failure.message,
  };
}

function publishCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "publish"),
    expectedRevision,
    summary: "Publishing the documentary Build123d execution capture.",
  };
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
    summary: BUILD123D_ISOLATED_OUTPUT_VALIDATION_FAILED.summary,
    code: BUILD123D_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
    message: isolatedOutputValidationFailedMessage(observation),
  };
}

function exactPublishReceipt(
  project: EngineeringProjectSnapshot,
  command: RegisteredProjectRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
): EngineeringProjectCommandReceipt {
  const commandId = commandStep(command.commandId, "publish");
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.publish" ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== new Date(command.issuedAt).toISOString() ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 1
  ) {
    throw invalidTransition(
      `Build123d run ${command.runId} has no unique exact publication receipt for this execution command and actor.`,
    );
  }
  return receipt;
}

function completionCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Recorded the exact reviewed isolated Build123d execution.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [artifactEvidence(snapshot, artifact)],
  };
}

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: RegisteredProjectRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const commandId = commandStep(command.commandId, "complete");
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== new Date(command.issuedAt).toISOString() ||
    receipt.appliedAt !== run.completedAt ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 1
  ) {
    throw invalidTransition(
      `Build123d run ${command.runId} has no unique exact completion receipt for this execution command and actor.`,
    );
  }
  return receipt;
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !run.resultSnapshot || !workItem || declared.length !== 1 ||
    run.resultSnapshot.snapshotId !== snapshot.id ||
    run.resultSnapshot.revision !== snapshot.revision ||
    run.resultSnapshot.subjectId !== snapshot.subject.id ||
    run.evidenceRefs.length !== 1 || workItem.evidenceRefs.length !== 1 ||
    !evidenceRefsEqual(run.evidenceRefs, workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed Build123d run is not attached to exactly one declared snapshot and documentary artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.kind !== "artifact" || evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision
  ) {
    throw invalidTransition(
      "The completed Build123d evidence does not name an artifact in its exact result snapshot.",
    );
  }
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === evidence.id && artifact.kind === "document" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool ===
      `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}` &&
    artifact.producer.runId === run.id && artifact.freshness.status === "fresh"
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      "The completed Build123d result has no unique fresh documentary execution artifact.",
    );
  }
  return matches[0]!;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: RegisteredProjectRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Build123d run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:design-execute-build123d:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function throwOutputValidationRejected(
  attempt: Build123dExecutionAttempt,
): never {
  if (attempt.phase !== "output-validation-rejected") {
    throw invalidTransition(
      "The Build123d output-validation rejection WAL transition was not durable.",
    );
  }
  throw new IsolatedBuild123dOutputValidationRejectedError({
    executionRunId: attempt.executionRunId,
    observation: attempt.outputValidationRejection.observation,
    destruction: attempt.outputValidationRejection.destruction,
  });
}
