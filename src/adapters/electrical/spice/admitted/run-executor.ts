/**
 * Trusted executor for `simulate.run-admitted-spice@1`.
 *
 * Reopens one sealed SPICE compilation and runs those exact `.cir` bytes
 * in the server-owned isolated worker. Callers never supply SPICE text.
 * A claimed run whose WAL is already execution-rejected,
 * output-validation-rejected, retry-generation-closed, or dispatching/g1
 * may terminate from journal facts without reopening the current
 * execution profile.
 */

import type { EngineeringProjectCommandOrigin } from "../../../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../../application/ports/in/project-run-executor.ts";
import {
  isDurableTerminalAgentRunStatus,
  settleCapabilityRuntimeSession,
} from "../../../../application/control-plane/capability-runtime-execution-admission.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../../application/control-plane/capability-runtime-execution-session.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  IsolatedCodeExecutionRejectedError,
  IsolatedCodeOutputValidationRejectedError,
} from "../../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  AdmittedSpiceExecutionAttempt,
  AdmittedSpiceExecutionAttemptIdentity,
  AdmittedSpiceExecutionAttemptKey,
  AdmittedSpiceExecutionAttemptStore,
  AdmittedSpiceExecutionThreadEvidence,
} from "../../../../application/ports/out/electrical/spice/admitted-execution-attempt-store.ts";
import { fingerprintAdmittedSpiceExecutionAttemptIdentity } from "../../../../application/ports/out/electrical/spice/admitted-execution-attempt-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import type { ResolvedRunPlanReader } from "../../../../domain/project/resolved-run-plan-sealer.ts";
import {
  requireRecordedResolvedRunPlanExecution,
  requireResolvedRunPlanExecution,
  type ResolvedRunPlanExecutionAuthorization,
} from "../../../compile/plans/resolved-run-plan-execution-guard.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  AdmittedSpiceExecutionProfile,
  AdmittedSpiceExecutionProfileCatalog,
} from "../../../../application/ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import {
  decideAdmittedSpiceAttemptResume,
  decideAdmittedSpiceTerminalJournalRecovery,
  isAdmittedSpiceTerminalJournalRecoveryEligible,
} from "../../../../application/use-cases/electrical/spice/admitted/attempt-resume-policy.ts";
import { assertAdmittedSpiceJournalProjectAuthority } from "../../../../application/use-cases/electrical/spice/admitted/journal-project-authority.ts";
import {
  type AdmittedExecutionRequest,
  assertAdmittedSpiceAdmissionScope,
  assertResolvedAdmittedSpiceExecutionPlan,
  assertSameReviewedAdmittedSpiceAuthority,
  reopenAdmittedExecutionRequest,
  reopenRecordedAdmittedSpiceExecutionRequest,
  requireAdmittedSpiceExecutionShape,
  requireReviewedAdmittedSpiceAuthority,
  type ReviewedAdmittedSpiceAuthority,
} from "../../../../application/use-cases/electrical/spice/admitted/reopen-reviewed-execution.ts";
import {
  ADMITTED_SPICE_ISOLATED_EXECUTION_REJECTED,
  ADMITTED_SPICE_ISOLATED_OUTPUT_VALIDATION_FAILED,
  ADMITTED_SPICE_RETRY_GENERATION_CLOSED,
  assertAdmittedSpiceCommandReceiptExact,
  assertCompletedAdmittedSpiceBinding,
  assertFailedAdmittedSpiceBinding,
  claimCommand,
  commandStep,
  completionCommand,
  failCommand,
  publishCommand,
  requireAdmittedSpiceCommandReceipt,
  requireAdmittedSpiceCompletedReceipts,
  requireAdmittedSpiceFailedReceipts,
} from "../../../../application/use-cases/electrical/spice/admitted/completed-replay-verification.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deriveAdmittedSpiceExecutionRunId,
  type SpiceAdmittedExecutionCapture,
  validateSpiceAdmittedExecutionCapture,
} from "../../../../domain/electrical/spice/admitted/execution-evidence.ts";
import {
  assertThreadEvidenceExact as assertDomainThreadEvidenceExact,
  buildDocumentarySuccessor as buildDomainDocumentarySuccessor,
  type DocumentarySuccessor,
  exactAdmissionArtifact as findExactAdmissionArtifact,
  threadEvidenceFor,
} from "../../../../domain/electrical/spice/admitted/documentary-thread-evidence.ts";
import { buildAdmittedSpicePublishedOutputCapture } from "../../../../domain/electrical/spice/admitted/published-output-evidence.ts";
import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRejectionDiagnostic,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputValidationRejection,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../../../../domain/electrical/spice/admitted/run-proposal.ts";

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  CapabilityRuntimeHostLifecycle,
  ResolvedCapabilityRuntimeOperation,
} from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  unexpectedStatus,
} from "../../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../../shared/thread-write-basis-guard.ts";

export { reopenAdmittedExecutionRequest, SIMULATE_RUN_ADMITTED_SPICE_OPERATION };

type ReviewedAuthority = ReviewedAdmittedSpiceAuthority;
const requireReviewedAuthority = requireReviewedAdmittedSpiceAuthority;
const assertAdmissionScope = assertAdmittedSpiceAdmissionScope;
const assertSameAuthority = assertSameReviewedAdmittedSpiceAuthority;
const requireExecutionShape = requireAdmittedSpiceExecutionShape;

export interface AdmittedSpiceThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AdmittedSpiceExecutionCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<{ readonly uri: string; readonly fingerprint: ContentFingerprint }>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface SimulateRunAdmittedSpiceRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: AdmittedSpiceThreadSnapshotStore;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedSpiceExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
  readonly attempts: AdmittedSpiceExecutionAttemptStore;
  readonly captures: AdmittedSpiceExecutionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
  readonly plans: ResolvedRunPlanReader;
  readonly capabilityRuntime: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin" | "releaseRecorded"
  >;
}

interface PersistedAdmittedExecutionCapture {
  readonly capture: SpiceAdmittedExecutionCapture;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export class SimulateRunAdmittedSpiceRunExecutor {
  constructor(
    private readonly d: SimulateRunAdmittedSpiceRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a reviewed admitted SPICE run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    const authority = await requireReviewedAuthority(project, run);
    assertAdmissionScope(project, run, authority.decision, authority.admission);
    if (isDurableTerminalAgentRunStatus(run.status)) {
      const authorization = await this.#requireRecordedPlan(project, run);
      const terminal = run.status === "completed"
        ? await this.#reopenCompleted(origin, command, authority, authorization)
        : await this.#reopenTerminalFailure(
          origin,
          command,
          authority,
          authorization,
        );
      await this.#releaseRecordedRuntime(terminal, command.runId, { authorization });
      return terminal;
    }
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (attempt?.phase === "output-published") {
      const authorization = await this.#requireRecordedPlan(project, run);
      const terminal = await this.d.lease.withLease(
        command.projectId,
        threadWriteBasisLeaseScope(run),
        () =>
          this.#replayRecordedPublishedOutput(
            origin,
            command,
            authority,
            authorization,
          ),
      );
      await this.#releaseRecordedRuntime(terminal, command.runId, { authorization });
      return terminal;
    }
    if (
      attempt &&
      isAdmittedSpiceTerminalJournalRecoveryEligible({
        runStatus: run.status,
        phase: attempt.phase,
        producerGeneration: "dispatch" in attempt
          ? attempt.dispatch.producerGeneration
          : undefined,
      })
    ) {
      const authorization = await this.#requireRecordedPlan(project, run);
      await this.#assertRecordedTerminalPlan(
        project,
        run,
        authority,
        authorization,
        attempt,
      );
      const recovered = await this.#recoverTerminalJournalIfPresent(
        origin,
        command,
        authority,
      );
      if (recovered) {
        await this.#releaseRecordedRuntime(recovered, command.runId, {
          authorization,
        });
        return recovered;
      }
    }
    const authorization = await this.#requireResolvedPlan(project, run);
    const recovered = await this.#recoverTerminalJournalIfPresent(
      origin,
      command,
      authority,
    );
    if (recovered) {
      await this.#releaseRecordedRuntime(recovered, command.runId, {
        authorization,
      });
      return recovered;
    }
    const executionRunId = await deriveAdmittedSpiceExecutionRunId(
      project.project.id,
      run.id,
    );
    const requiresJit = await this.#requiresJitBeforeLease(
      project,
      run,
      executionRunId,
    );
    const prepared = await this.#prepareResolvedExecution(
      project,
      run,
      authority,
      authorization,
    );
    if (!requiresJit) {
      const result = await this.d.lease.withLease(
        command.projectId,
        threadWriteBasisLeaseScope(run),
        () => this.#executeLeased(origin, command, authority),
      );
      await this.#releaseRecordedRuntime(result, command.runId, prepared);
      return result;
    }
    const session = await this.#beginCapabilitySession(
      project,
      run,
      prepared,
      command,
      origin,
      authority,
    );
    return await this.#executeWithCapabilitySession(
      session,
      origin,
      command,
      authority,
    );
  }

  async #prepareResolvedExecution(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    authority: ReviewedAuthority,
    authorization?: ResolvedRunPlanExecutionAuthorization,
  ): Promise<{
    readonly authorization: ResolvedRunPlanExecutionAuthorization;
    readonly execution: AdmittedExecutionRequest;
    readonly lifecycles: SpiceCapabilityLifecycles;
  }> {
    const resolved = authorization ?? await this.#requireResolvedPlan(project, run);
    const execution = await reopenAdmittedExecutionRequest({
      admissions: this.d.admissions,
      profiles: this.d.profiles,
      project,
      run,
      admission: authority.admission,
    });
    await assertResolvedAdmittedSpiceExecutionPlan({
      plan: resolved.plan,
      operationalCapability: resolved.capabilityRuntime!,
      project,
      run,
      admission: authority.admission,
      execution,
    });
    return {
      authorization: resolved,
      execution,
      lifecycles: exactAdmittedSpiceCapabilityLifecycles(
        resolved.capabilityRuntime!,
        execution.executionProfile,
      ),
    };
  }

  async #assertRecordedTerminalPlan(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    authority: ReviewedAuthority,
    authorization: ResolvedRunPlanExecutionAuthorization,
    attempt: AdmittedSpiceExecutionAttempt,
  ): Promise<AdmittedExecutionRequest> {
    const execution = await reopenRecordedAdmittedSpiceExecutionRequest({
      admissions: this.d.admissions,
      project,
      run,
      admission: authority.admission,
      executionProfile: attempt.identity.executionProfile,
    });
    await assertResolvedAdmittedSpiceExecutionPlan({
      plan: authorization.plan,
      operationalCapability: authorization.plan.operationalCapability,
      project,
      run,
      admission: authority.admission,
      execution,
    });
    return execution;
  }

  /**
   * A recorded output is reconciled through the sealed ROP and WAL profile,
   * rather than re-admitting a runtime that can no longer dispatch anything.
   */
  async #replayRecordedPublishedOutput(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    initialAuthority: ReviewedAuthority,
    authorization: ResolvedRunPlanExecutionAuthorization,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    requireClaimedShape(project, run, origin);
    if (run.status !== "running" && run.status !== "publishing") {
      throw unexpectedStatus(run, "running or publishing");
    }
    const authority = await requireReviewedAuthority(project, run);
    assertSameAuthority(initialAuthority, authority);
    assertAdmissionScope(project, run, authority.decision, authority.admission);
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (attempt?.phase !== "output-published") {
      throw invalidTransition(
        "The admitted SPICE journal no longer proves a durable output publication.",
      );
    }
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, true);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
    const context = await this.#assertRecordedTerminalPlan(
      project,
      run,
      authority,
      authorization,
      attempt,
    );
    const identity = await attemptIdentity(
      project,
      run,
      basisSnapshot,
      authority,
      context,
    );
    const key: AdmittedSpiceExecutionAttemptKey = {
      projectId: project.project.id,
      agentRunId: run.id,
      executionRunId: context.request.runId,
      attemptFingerprint: await fingerprintAdmittedSpiceExecutionAttemptIdentity(
        identity,
      ),
    };
    assertAttemptIdentity(attempt, key, identity);
    return run.status === "publishing"
      ? await this.#resumePublishingReadOnly(
        origin,
        command,
        project,
        run,
        basisSnapshot,
        context,
        attempt,
        key,
      )
      : await this.#finalizePublishedOutput(
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

  async #requireResolvedPlan(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ResolvedRunPlanExecutionAuthorization> {
    try {
      return await requireResolvedRunPlanExecution({
        project,
        runId: run.id,
        expectedOperation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
        expectedRunStatuses: [run.status],
        projects: this.d.projects,
        snapshots: this.d.snapshots,
        plans: this.d.plans,
        capabilityRuntime: this.d.capabilityRuntime,
      });
    } catch (error) {
      throw invalidTransition(
        error instanceof Error
          ? error.message
          : "The resolved admitted SPICE execution plan could not be reopened.",
      );
    }
  }

  async #requireRecordedPlan(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ResolvedRunPlanExecutionAuthorization> {
    try {
      return await requireRecordedResolvedRunPlanExecution({
        project,
        runId: run.id,
        expectedOperation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
        expectedRunStatuses: [run.status],
        projects: this.d.projects,
        snapshots: this.d.snapshots,
        plans: this.d.plans,
      });
    } catch (error) {
      throw invalidTransition(
        error instanceof Error
          ? error.message
          : "The recorded admitted SPICE execution plan could not be reopened.",
      );
    }
  }

  async #requiresJitBeforeLease(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    executionRunId: string,
  ): Promise<boolean> {
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (run.status === "queued") {
      if (attempt) {
        throw invalidTransition(
          "A queued admitted SPICE run already has a durable execution journal and will not claim a second attempt.",
        );
      }
      return true;
    }
    if (run.status === "publishing") return false;
    if (run.status !== "running") {
      throw unexpectedStatus(run, "queued, running, publishing, completed, or failed");
    }
    if (!attempt) {
      throw invalidTransition(
        "The active admitted SPICE run has no durable execution journal; no JIT lease or worker dispatch is permitted.",
      );
    }
    if (attempt.phase === "prepared" || attempt.phase === "generation-zero-cleaned") {
      return true;
    }
    if (
      attempt.phase === "execution-rejected" ||
      attempt.phase === "output-validation-rejected" ||
      attempt.phase === "retry-generation-closed" ||
      attempt.phase === "output-published" ||
      attempt.phase === "completed"
    ) {
      return false;
    }
    if (attempt.phase !== "dispatching") {
      throw invalidTransition(
        "The admitted SPICE execution journal has no recognized pre-dispatch or replay state.",
      );
    }
    let resolution;
    try {
      resolution = await this.d.publications.resolvePublicationByRunId(
        executionRunId,
        attempt.dispatch.producerGeneration,
      );
    } catch {
      throw invalidTransition(
        "The run-keyed admitted SPICE publication cannot be resolved; the active execution is retained without a JIT retry.",
      );
    }
    if (
      resolution.runId !== executionRunId ||
      resolution.producerGeneration !== attempt.dispatch.producerGeneration
    ) {
      throw invalidTransition(
        "The admitted SPICE publication resolution names another generation; the active execution is retained without a JIT retry.",
      );
    }
    if (resolution.status === "outcome-unknown") {
      throw invalidTransition(
        "The admitted SPICE publication outcome is unknown; the active execution is retained without a JIT retry.",
      );
    }
    return resolution.status === "not-published";
  }

  async #beginCapabilitySession(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    prepared: {
      readonly authorization: ResolvedRunPlanExecutionAuthorization;
      readonly execution: AdmittedExecutionRequest;
      readonly lifecycles: SpiceCapabilityLifecycles;
    },
    command: RegisteredProjectRunExecutorCommand,
    origin: EngineeringProjectCommandOrigin,
    authority: ReviewedAuthority,
  ): Promise<CapabilityRuntimeExecutionSession> {
    const session = this.d.capabilityRuntimeSession;
    if (!session) {
      throw invalidTransition(
        "Admitted SPICE execution requires the configured JIT capability runtime session before a run can be claimed.",
      );
    }
    try {
      return await session.begin({
        project,
        runId: run.id,
        operationalCapability: prepared.authorization.capabilityRuntime!,
        microsandboxExecutionProfiles: [{
          material: prepared.lifecycles.microvm.material,
          executionProfileFingerprint:
            prepared.execution.executionProfile.profileFingerprint,
        }],
        recheck: async () => {
          const fresh = await this.#requiredProject(command.projectId);
          const freshRun = requireRun(fresh, command.runId);
          requireExecutionShape(fresh, freshRun);
          if (freshRun.status !== "queued") {
            requireClaimedShape(fresh, freshRun, origin);
          }
          const freshAuthority = await requireReviewedAuthority(fresh, freshRun);
          assertSameAuthority(authority, freshAuthority);
          assertAdmissionScope(
            fresh,
            freshRun,
            freshAuthority.decision,
            freshAuthority.admission,
          );
          const rechecked = await this.#prepareResolvedExecution(
            fresh,
            freshRun,
            freshAuthority,
          );
          return rechecked.authorization.capabilityRuntime!;
        },
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw invalidTransition(error.message);
      }
      throw error;
    }
  }

  async #executeWithCapabilitySession(
    session: CapabilityRuntimeExecutionSession,
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    try {
      const result = await this.d.lease.withLease(
        command.projectId,
        threadWriteBasisLeaseScope(requireRun(
          await this.#requiredProject(command.projectId),
          command.runId,
        )),
        () => this.#executeLeased(origin, command, authority),
      );
      await settleCapabilityRuntimeSession({
        session,
        policy: {
          kind: "release-if-terminal",
          run: result.agentRuns.find((candidate) => candidate.id === command.runId),
        },
      });
      return result;
    } catch (error) {
      const current = await this.#requiredProject(command.projectId).catch(() =>
        undefined
      );
      const run = current?.agentRuns.find((candidate) =>
        candidate.id === command.runId
      );
      const attempt = current && run
        ? await this.d.attempts.read(current.project.id, run.id).catch(() => undefined)
        : undefined;
      await settleCapabilityRuntimeSession({
        session,
        policy: run?.status === "queued" && !attempt
          ? { kind: "release" }
          : { kind: "release-if-terminal", run },
      });
      throw error;
    }
  }

  async #reopenTerminalFailure(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
    authorization: ResolvedRunPlanExecutionAuthorization,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (!attempt) {
      throw invalidTransition(
        "The failed admitted SPICE project run has no durable execution journal.",
      );
    }
    await this.#assertRecordedTerminalPlan(
      project,
      run,
      authority,
      authorization,
      attempt,
    );
    const recovered = await this.#recoverTerminalJournalIfPresent(
      origin,
      command,
      authority,
    );
    return recovered ?? await this.#reopenFailed(origin, command, authority);
  }

  async #releaseRecordedRuntime(
    project: EngineeringProjectSnapshot,
    runId: string,
    prepared: {
      readonly authorization: ResolvedRunPlanExecutionAuthorization;
    },
  ): Promise<void> {
    const run = requireRun(project, runId);
    if (!isDurableTerminalAgentRunStatus(run.status)) return;
    const session = this.d.capabilityRuntimeSession;
    if (!session?.releaseRecorded) return;
    try {
      await session.releaseRecorded({
        project,
        runId,
        operationalCapability: prepared.authorization.capabilityRuntime!,
      });
    } catch {
      // The project result is already terminal and exact. Retain an
      // unreconstructable historical runtime lease for administrator recovery
      // instead of turning a completed/failed engineering result into an
      // executor error after a catalogue or profile rollover.
    }
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
      const recovered = await this.#recoverTerminalJournalIfPresent(
        origin,
        command,
        authority,
      );
      if (recovered) return recovered;
      return await this.#reopenFailed(origin, command, authority);
    }
    if (
      run.status !== "queued" && run.status !== "running" &&
      run.status !== "publishing"
    ) {
      throw unexpectedStatus(run, "queued or this agent's running/publishing");
    }
    if (run.status === "running") {
      const recovered = await this.#recoverTerminalJournalIfPresent(
        origin,
        command,
        authority,
      );
      if (recovered) return recovered;
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
      if (run.status === "failed") {
        return await this.#reopenFailed(origin, command, authority);
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
      const attemptFingerprint = await fingerprintAdmittedSpiceExecutionAttemptIdentity(
        identity,
      );
      const key: AdmittedSpiceExecutionAttemptKey = {
        projectId: command.projectId,
        agentRunId: run.id,
        executionRunId: context.request.runId,
        attemptFingerprint,
      };
      let attempt = await this.d.attempts.read(command.projectId, run.id);
      if (firstClaim) {
        if (attempt) {
          throw invalidTransition(
            "A freshly claimed admitted SPICE run already has a durable execution journal.",
          );
        }
        attempt = await this.d.attempts.prepare(identity, requiredStart(run));
      } else if (!attempt) {
        throw invalidTransition(
          "The admitted SPICE run is already active but has no durable execution journal; it is quarantined and will not be dispatched.",
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
          "The admitted SPICE execution did not reach durable output publication.",
        );
      }
      return await this.#finalizePublishedOutput(
        origin,
        command,
        project,
        run,
        basisSnapshot,
        context,
        attempt,
        key,
      );
    } catch (error) {
      if (error instanceof AdmittedSpiceTerminalExecutionOutcome) {
        return await this.#failExactClaimedRun(origin, command, authority, error);
      }
      throw invalidTransition(
        "The admitted SPICE execution or documentary Thread publication has a durable or uncertain effect. " +
          "Retry this exact command. " +
          `Cause: ${boundedCause(error)}`,
      );
    }
  }

  async #advanceRunningAttempt(
    context: AdmittedExecutionRequest,
    initial: AdmittedSpiceExecutionAttempt,
    key: AdmittedSpiceExecutionAttemptKey,
    dispatchedAt: string,
  ): Promise<AdmittedSpiceExecutionAttempt> {
    let attempt = initial;
    const decision = decideAdmittedSpiceAttemptResume({
      phase: attempt.phase,
      executionRunId: key.executionRunId,
      producerGeneration: "dispatch" in attempt
        ? attempt.dispatch.producerGeneration
        : undefined,
    });
    if (decision.action === "already-published") return attempt;
    if (decision.action === "already-rejected") {
      if (attempt.phase !== "execution-rejected") {
        throw invalidTransition(
          "The admitted SPICE journal phase is not recoverable.",
        );
      }
      throw AdmittedSpiceTerminalExecutionOutcome.executionRejected(
        attempt.rejection.diagnostic,
      );
    }
    if (decision.action === "already-output-validation-rejected") {
      if (attempt.phase !== "output-validation-rejected") {
        throw invalidTransition(
          "The admitted SPICE journal phase is not recoverable.",
        );
      }
      throw AdmittedSpiceTerminalExecutionOutcome.outputValidationRejected(
        attempt.outputValidationRejection.observation,
      );
    }
    if (decision.action === "already-closed") {
      if (attempt.phase !== "retry-generation-closed") {
        throw invalidTransition(
          "The admitted SPICE journal phase is not recoverable.",
        );
      }
      throw AdmittedSpiceTerminalExecutionOutcome.retryGenerationClosed();
    }
    if (decision.action === "transition-g0") {
      if (attempt.phase !== "prepared") {
        throw invalidTransition(
          "The admitted SPICE journal phase is not recoverable.",
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
          "The admitted SPICE generation-zero dispatch acknowledgement is not exact.",
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
          "The admitted SPICE journal phase is not recoverable.",
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
          "The admitted SPICE journal phase is not recoverable.",
        );
      }
      return await this.#recoverDispatch(context, attempt, key, dispatchedAt);
    }
    throw invalidTransition(
      decision.action === "quarantine"
        ? decision.message
        : "The admitted SPICE journal phase is not recoverable.",
    );
  }

  async #dispatchOnceOrRecover(
    context: AdmittedExecutionRequest,
    attempt: Extract<AdmittedSpiceExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedSpiceExecutionAttemptKey,
  ): Promise<AdmittedSpiceExecutionAttempt> {
    try {
      const receipt = await this.d.runner.run(
        requestForGeneration(context.request, attempt.dispatch.producerGeneration),
      );
      return await this.#recordPublishedReceipt(attempt, key, receipt);
    } catch (error) {
      if (error instanceof IsolatedCodeOutputValidationRejectedError) {
        return await this.#recordOutputValidationRejected(attempt, key, error);
      }
      if (error instanceof IsolatedCodeExecutionRejectedError) {
        return await this.#recordRejectedExecution(attempt, key, error);
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
    attempt: Extract<AdmittedSpiceExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedSpiceExecutionAttemptKey,
    error: IsolatedCodeOutputValidationRejectedError,
  ): Promise<AdmittedSpiceExecutionAttempt> {
    if (
      error.destruction.status !== "proven" ||
      error.destruction.runId !== key.executionRunId
    ) {
      throw invalidTransition(
        "Isolated admitted SPICE output-validation cleanup is not proven; no redispatch occurs.",
      );
    }
    const recorded = await this.d.attempts.markOutputValidationRejected({
      ...key,
      observation: error.observation,
      destruction: error.destruction,
    });
    assertAttemptIdentity(recorded, key, attempt.identity);
    if (recorded.phase !== "output-validation-rejected") {
      throw invalidTransition(
        "The admitted SPICE output-validation rejection was not durably recorded.",
      );
    }
    throw AdmittedSpiceTerminalExecutionOutcome.outputValidationRejected(
      recorded.outputValidationRejection.observation,
    );
  }

  async #recordRejectedExecution(
    attempt: Extract<AdmittedSpiceExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedSpiceExecutionAttemptKey,
    error: IsolatedCodeExecutionRejectedError,
  ): Promise<AdmittedSpiceExecutionAttempt> {
    if (error.destruction.status !== "proven") {
      throw invalidTransition(
        "Admitted SPICE isolated rejection requires proven microVM destruction.",
      );
    }
    const recorded = await this.d.attempts.markExecutionRejected({
      ...key,
      diagnostic: error.diagnostic,
      destruction: error.destruction,
    });
    assertAttemptIdentity(recorded, key, attempt.identity);
    if (recorded.phase !== "execution-rejected") {
      throw invalidTransition(
        "The admitted SPICE execution rejection was not durably recorded.",
      );
    }
    throw AdmittedSpiceTerminalExecutionOutcome.executionRejected(
      recorded.rejection.diagnostic,
    );
  }

  async #recoverDispatch(
    context: AdmittedExecutionRequest,
    attempt: Extract<AdmittedSpiceExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedSpiceExecutionAttemptKey,
    dispatchedAt: string,
  ): Promise<AdmittedSpiceExecutionAttempt> {
    let resolution;
    try {
      resolution = await this.d.publications.resolvePublicationByRunId(
        key.executionRunId,
        attempt.dispatch.producerGeneration,
      );
    } catch {
      throw invalidTransition(
        "The admitted SPICE publication cannot be resolved; no isolated redispatch is authorized.",
      );
    }
    const decision = decideAdmittedSpiceAttemptResume({
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
      const destruction = await this.#proveGenerationClosed(
        key.executionRunId,
        1,
      );
      const recorded = await this.d.attempts.markRetryGenerationClosed({
        ...key,
        destruction,
      });
      assertAttemptIdentity(recorded, key, attempt.identity);
      if (recorded.phase !== "retry-generation-closed") {
        throw invalidTransition(
          "The admitted SPICE retry generation closure was not durably recorded.",
        );
      }
      throw AdmittedSpiceTerminalExecutionOutcome.retryGenerationClosed();
    }
    if (decision.action !== "cleanup-g0") {
      throw invalidTransition(
        decision.action === "quarantine"
          ? decision.message
          : "The admitted SPICE journal phase is not recoverable.",
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
        "The admitted SPICE generation-zero cleanup was not durably acknowledged.",
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
      AdmittedSpiceExecutionAttempt,
      { phase: "generation-zero-cleaned" }
    >,
    key: AdmittedSpiceExecutionAttemptKey,
    dispatchedAt: string,
  ): Promise<AdmittedSpiceExecutionAttempt> {
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
        "The admitted SPICE generation-one dispatch was not durably acknowledged.",
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
        `Admitted SPICE generation ${producerGeneration} has no publication and its cleanup could not be proven.`,
      );
    }
    if (destruction.status !== "proven" || destruction.runId !== executionRunId) {
      throw invalidTransition(
        `Admitted SPICE generation ${producerGeneration} requires exact proven cleanup before recovery can continue.`,
      );
    }
    return destruction;
  }

  async #recordPublishedReceipt(
    attempt: Extract<AdmittedSpiceExecutionAttempt, { phase: "dispatching" }>,
    key: AdmittedSpiceExecutionAttemptKey,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<AdmittedSpiceExecutionAttempt> {
    if (receipt.producerGeneration !== attempt.dispatch.producerGeneration) {
      throw invalidTransition(
        "The admitted SPICE receipt belongs to another durable producer generation.",
      );
    }
    const recorded = await this.d.attempts.markOutputPublished({
      ...key,
      receiptRecord: isolatedCodeExecutionReceiptRecord(receipt),
    });
    assertAttemptIdentity(recorded, key, attempt.identity);
    if (recorded.phase !== "output-published") {
      throw invalidTransition(
        "The admitted SPICE output publication was not durably recorded.",
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
        "The published admitted SPICE receipt could not be reopened.",
      );
    }
    if (
      !receipt ||
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(record)
    ) {
      throw invalidTransition(
        "The published admitted SPICE receipt differs from its durable journal record.",
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
        "The admitted SPICE documentary Thread successor failed exact durable readback.",
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
      throw invalidTransition("The admitted SPICE capture failed exact readback.");
    }
    return {
      capture: await validateSpiceAdmittedExecutionCapture(
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
        "The admitted SPICE capture cannot be reopened exactly without writing.",
      );
    }
    return {
      ...expected,
      capture: await validateSpiceAdmittedExecutionCapture(
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
  ): Promise<SpiceAdmittedExecutionCapture> {
    const record = isolatedCodeExecutionReceiptRecord(receipt);
    const outputs = new Map(record.outputs.map((output) => [output.role, output]));
    const evidenceOutput = outputs.get("evidence");
    const resultOutput = outputs.get("result");
    if (!evidenceOutput || !resultOutput || outputs.size !== 2) {
      throw invalidTransition(
        "The admitted SPICE run must publish evidence.json and result.json.",
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
        "The admitted SPICE evidence and result bytes could not both be reopened.",
      );
    }
    try {
      return await buildAdmittedSpicePublishedOutputCapture({
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
    const receipt = requireAdmittedSpiceCommandReceipt(
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
        "The admitted SPICE claim receipt does not seal the run's exact claimed/start timeline.",
      );
    }
    await this.#assertReceiptSnapshotExact(project, receipt);
    await assertAdmittedSpiceCommandReceiptExact(
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
      const receipt = requireAdmittedSpiceCommandReceipt(
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
          "The publishing admitted SPICE run summary differs from its exact publish transition.",
        );
      }
      await this.#assertReceiptSnapshotExact(project, receipt);
      await assertAdmittedSpiceCommandReceiptExact(
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
      const receipt = requireAdmittedSpiceCommandReceipt(
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
          "The completed admitted SPICE run summary differs from its exact completion transition.",
        );
      }
      await this.#assertReceiptSnapshotExact(project, receipt);
      await assertAdmittedSpiceCommandReceiptExact(
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
    authorization?: ResolvedRunPlanExecutionAuthorization,
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
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (!attempt) {
      throw invalidTransition(
        "The completed admitted SPICE project run has no durable execution journal.",
      );
    }
    if (attempt.phase !== "output-published" && attempt.phase !== "completed") {
      throw invalidTransition(
        "The completed admitted SPICE project run has no durable published-output receipt.",
      );
    }
    const recordedAuthorization = authorization ??
      await this.#requireRecordedPlan(project, run);
    const context = await this.#assertRecordedTerminalPlan(
      project,
      run,
      currentAuthority,
      recordedAuthorization,
      attempt,
    );
    const identity = await attemptIdentity(
      project,
      run,
      basisSnapshot,
      currentAuthority,
      context,
    );
    const key: AdmittedSpiceExecutionAttemptKey = {
      projectId: project.project.id,
      agentRunId: run.id,
      executionRunId: context.request.runId,
      attemptFingerprint: await fingerprintAdmittedSpiceExecutionAttemptIdentity(
        identity,
      ),
    };
    assertAttemptIdentity(attempt, key, identity);
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

  async #recoverTerminalJournalIfPresent(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "running" && run.status !== "failed") return undefined;
    requireClaimedShape(project, run, origin);
    const attempt = await this.d.attempts.read(command.projectId, run.id);
    if (!attempt) return undefined;
    const producerGeneration = "dispatch" in attempt
      ? attempt.dispatch.producerGeneration
      : undefined;
    if (
      !isAdmittedSpiceTerminalJournalRecoveryEligible({
        runStatus: run.status,
        phase: attempt.phase,
        producerGeneration,
      })
    ) {
      return undefined;
    }
    try {
      return await this.#recoverTerminalJournal(
        origin,
        command,
        authority,
        project,
        run,
        attempt,
      );
    } catch (error) {
      if (error instanceof AdmittedSpiceTerminalExecutionOutcome) {
        return await this.#failExactClaimedRun(origin, command, authority, error);
      }
      throw invalidTransition(
        "The admitted SPICE execution or documentary Thread publication has a durable or uncertain effect. " +
          "Retry this exact command. " +
          `Cause: ${boundedCause(error)}`,
      );
    }
  }

  async #recoverTerminalJournal(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    initial: ReviewedAuthority,
    initialProject: EngineeringProjectSnapshot,
    initialRun: EngineeringAgentRun,
    attempt: AdmittedSpiceExecutionAttempt,
  ): Promise<EngineeringProjectSnapshot> {
    let project = initialProject;
    let run = initialRun;
    let authority = initial;
    if (run.resultSnapshot || run.evidenceRefs.length !== 0) {
      throw invalidTransition(
        "The claimed admitted SPICE run already carries Thread evidence and cannot take an evidence-free terminal failure.",
      );
    }
    if (run.status === "running") {
      await this.#replayClaim(origin, command);
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        throw unexpectedStatus(run, "running or failed");
      }
      authority = await requireReviewedAuthority(project, run);
      assertSameAuthority(initial, authority);
      assertAdmissionScope(
        project,
        run,
        authority.decision,
        authority.admission,
      );
    }
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, true);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
    await assertAdmittedSpiceJournalProjectAuthority({
      attempt,
      project,
      run,
      authority,
      basisSnapshot,
    });
    const key = journalAttemptKey(attempt);
    const decision = decideAdmittedSpiceTerminalJournalRecovery({
      phase: attempt.phase,
      executionRunId: attempt.executionRunId,
      producerGeneration: "dispatch" in attempt
        ? attempt.dispatch.producerGeneration
        : undefined,
    });
    if (
      decision.action === "already-rejected" ||
      decision.action === "already-output-validation-rejected" ||
      decision.action === "already-closed"
    ) {
      const outcome = this.#requireTerminalJournal(attempt, key);
      if (run.status === "failed") {
        await this.#assertFailedEvidence(origin, project, command, run, outcome);
        return project;
      }
      throw outcome;
    }
    if (decision.action !== "read-publication") {
      throw invalidTransition(
        decision.action === "quarantine"
          ? decision.message
          : "The admitted SPICE journal phase is not recoverable.",
      );
    }
    if (
      attempt.phase !== "dispatching" ||
      attempt.dispatch.producerGeneration !== 1
    ) {
      throw invalidTransition(
        "The admitted SPICE journal phase is not recoverable.",
      );
    }
    let resolution;
    try {
      resolution = await this.d.publications.resolvePublicationByRunId(
        attempt.executionRunId,
        1,
      );
    } catch {
      throw invalidTransition(
        "The admitted SPICE publication cannot be resolved; no isolated redispatch is authorized.",
      );
    }
    const resolved = decideAdmittedSpiceTerminalJournalRecovery({
      phase: "dispatching",
      executionRunId: attempt.executionRunId,
      producerGeneration: 1,
      resolution,
    });
    if (resolved.action !== "close-g1") {
      throw invalidTransition(
        resolved.action === "quarantine"
          ? resolved.message
          : "The admitted SPICE journal phase is not recoverable.",
      );
    }
    const destruction = await this.#proveGenerationClosed(
      attempt.executionRunId,
      1,
    );
    const recorded = await this.d.attempts.markRetryGenerationClosed({
      ...key,
      destruction,
    });
    assertAttemptIdentity(recorded, key, attempt.identity);
    if (recorded.phase !== "retry-generation-closed") {
      throw invalidTransition(
        "The admitted SPICE retry generation closure was not durably recorded.",
      );
    }
    const outcome = AdmittedSpiceTerminalExecutionOutcome.retryGenerationClosed();
    if (run.status === "failed") {
      await this.#assertFailedEvidence(origin, project, command, run, outcome);
      return project;
    }
    throw outcome;
  }

  async #reopenFailed(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "failed") throw unexpectedStatus(run, "failed");
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
    const key: AdmittedSpiceExecutionAttemptKey = {
      projectId: project.project.id,
      agentRunId: run.id,
      executionRunId: context.request.runId,
      attemptFingerprint: await fingerprintAdmittedSpiceExecutionAttemptIdentity(
        identity,
      ),
    };
    const attempt = await this.d.attempts.read(project.project.id, run.id);
    if (!attempt) {
      throw invalidTransition(
        "The failed admitted SPICE project run has no durable execution journal.",
      );
    }
    assertAttemptIdentity(attempt, key, identity);
    const outcome = this.#requireTerminalJournal(attempt, key);
    await this.#assertFailedEvidence(origin, project, command, run, outcome);
    return project;
  }

  #requireTerminalJournal(
    attempt: AdmittedSpiceExecutionAttempt,
    key: AdmittedSpiceExecutionAttemptKey,
  ): AdmittedSpiceTerminalExecutionOutcome {
    if (attempt.phase === "execution-rejected") {
      return AdmittedSpiceTerminalExecutionOutcome.executionRejected(
        attempt.rejection.diagnostic,
      );
    }
    if (attempt.phase === "output-validation-rejected") {
      return AdmittedSpiceTerminalExecutionOutcome.outputValidationRejected(
        attempt.outputValidationRejection.observation,
      );
    }
    if (attempt.phase !== "retry-generation-closed") {
      throw invalidTransition(
        "The failed admitted SPICE run does not have the exact terminal journal, receipt, and basis.",
      );
    }
    if (
      attempt.dispatch.producerGeneration !== 1 ||
      attempt.closedGeneration.producerGeneration !== 1 ||
      attempt.closedGeneration.destruction.status !== "proven" ||
      attempt.closedGeneration.destruction.runId !== key.executionRunId
    ) {
      throw invalidTransition(
        "The failed admitted SPICE run does not have the exact terminal journal, receipt, and basis.",
      );
    }
    return AdmittedSpiceTerminalExecutionOutcome.retryGenerationClosed();
  }

  async #failExactClaimedRun(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
    outcome: AdmittedSpiceTerminalExecutionOutcome,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireClaimedShape(project, run, origin);
    if (run.status === "failed") {
      const recovered = await this.#recoverTerminalJournalIfPresent(
        origin,
        command,
        authority,
      );
      if (recovered) return recovered;
      return await this.#reopenFailed(origin, command, authority);
    }
    if (run.status !== "running") {
      throw unexpectedStatus(run, "running");
    }
    if (run.resultSnapshot || run.evidenceRefs.length !== 0) {
      throw invalidTransition(
        "The claimed admitted SPICE run already carries Thread evidence and cannot take an evidence-free terminal failure.",
      );
    }
    const startedAt = run.startedAt;
    await this.d.commands.failRun(
      origin,
      failCommand(command, outcome.failure(), project.revision),
    );
    const failed = await this.#requiredProject(command.projectId);
    await this.#assertFailedEvidence(
      origin,
      failed,
      command,
      requireRun(failed, command.runId),
      outcome,
      startedAt,
    );
    return failed;
  }

  async #assertFailedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    run: EngineeringAgentRun,
    outcome: AdmittedSpiceTerminalExecutionOutcome,
    originalStartedAt = run.startedAt,
  ): Promise<void> {
    assertFailedAdmittedSpiceBinding({
      project,
      command,
      run,
      originalStartedAt,
      failure: outcome.failure(),
    });
    const receipts = requireAdmittedSpiceFailedReceipts({
      project,
      command,
      origin,
      run,
    });
    await Promise.all([
      this.#assertReceiptSnapshotExact(project, receipts.claim),
      this.#assertReceiptSnapshotExact(project, receipts.fail),
    ]);
    await assertAdmittedSpiceCommandReceiptExact(
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
    await assertAdmittedSpiceCommandReceiptExact(
      run,
      receipts.fail,
      "agent-run.fail",
      origin,
      failCommand(
        command,
        outcome.failure(),
        receipts.fail.resultingSnapshot.revision - 1,
        receipts.fail.issuedAt,
      ),
      "failed",
    );
  }

  async #resumePublishingReadOnly(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    basisSnapshot: ThreadSnapshot,
    context: AdmittedExecutionRequest,
    attempt: AdmittedSpiceExecutionAttempt,
    key: AdmittedSpiceExecutionAttemptKey,
  ): Promise<EngineeringProjectSnapshot> {
    if (attempt.phase !== "output-published") {
      throw invalidTransition(
        "The publishing admitted SPICE project run has no exact output-published journal phase.",
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

  async #finalizePublishedOutput(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    basisSnapshot: ThreadSnapshot,
    context: AdmittedExecutionRequest,
    attempt: Extract<AdmittedSpiceExecutionAttempt, { phase: "output-published" }>,
    key: AdmittedSpiceExecutionAttemptKey,
  ): Promise<EngineeringProjectSnapshot> {
    const receipt = await this.#reopenReceipt(attempt.receiptRecord);
    const persistedCapture = await this.#persistCapture(
      project,
      run,
      context,
      receipt,
    );
    const expected = buildDocumentarySuccessor({
      basisSnapshot,
      basis: requireBasis(run),
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
      AdmittedSpiceExecutionAttempt,
      { phase: "output-published" | "completed" }
    >,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    assertCompletedAdmittedSpiceBinding({
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
    const receipts = requireAdmittedSpiceCompletedReceipts({
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
    await assertAdmittedSpiceCommandReceiptExact(
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
    await assertAdmittedSpiceCommandReceiptExact(
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
    await assertAdmittedSpiceCommandReceiptExact(
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
        `The admitted SPICE ${receipt.type} receipt does not reopen its exact immutable project revision.`,
      );
    }
  }

  async #completeAttempt(
    attempt: Extract<
      AdmittedSpiceExecutionAttempt,
      { phase: "output-published" }
    >,
    key: AdmittedSpiceExecutionAttemptKey,
    expected: DocumentarySuccessor,
  ): Promise<void> {
    const completed = await this.d.attempts.markCompleted({
      ...key,
      threadEvidence: threadEvidenceFor(expected),
    });
    assertAttemptIdentity(completed, key, attempt.identity);
    if (completed.phase !== "completed") {
      throw invalidTransition(
        "The admitted SPICE journal did not record completion after project and Thread proof.",
      );
    }
    assertThreadEvidenceExact(completed.threadEvidence, expected);
  }
}

interface SpiceCapabilityLifecycles {
  readonly microvm: Extract<
    CapabilityRuntimeHostLifecycle,
    { readonly kind: "ephemeral-microsandbox" }
  >;
}

/**
 * SPICE has one runtime material: the fixed executable microVM. Its Docker
 * source/build image is internal acquisition input for the server-owned
 * bootstrap recipe, never a plan material or JIT prerequisite.
 */
function exactAdmittedSpiceCapabilityLifecycles(
  operationalCapability: ResolvedCapabilityRuntimeOperation,
  profile: AdmittedSpiceExecutionProfile,
): SpiceCapabilityLifecycles {
  const lifecycles = operationalCapability.bindings.flatMap((binding) =>
    binding.hostLifecycles
  );
  if (lifecycles.length !== 1) {
    throw invalidTransition(
      "Admitted SPICE execution requires exactly one ephemeral Microsandbox runtime material.",
    );
  }
  const microvms = lifecycles.filter((lifecycle) =>
    lifecycle.kind === "ephemeral-microsandbox"
  );
  if (microvms.length !== 1) {
    throw invalidTransition(
      "Admitted SPICE execution requires one exact ephemeral Microsandbox runtime material.",
    );
  }
  const microvm = microvms[0]!;
  if (
    microvm.launchGroup !== null ||
    microvm.material.unitId !== "casys.spice-worker" ||
    microvm.material.materialId !== "ngspice-runtime-image" ||
    microvm.material.imageDigest !== profile.runtimeBackend.imageDigest.digest ||
    !profile.runtimeBackend.imageReference.endsWith(
      `@sha256:${microvm.material.imageDigest}`,
    )
  ) {
    throw invalidTransition(
      "Admitted SPICE execution capability does not compose the fixed ngspice Microsandbox runtime profile.",
    );
  }
  return { microvm };
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
      "This executor may continue only the exact admitted SPICE run it claimed.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: AdmittedSpiceThreadSnapshotStore,
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
      "The admitted SPICE Thread basis could not be reopened.",
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
): Promise<AdmittedSpiceExecutionAttemptIdentity> {
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

function journalAttemptKey(
  attempt: AdmittedSpiceExecutionAttempt,
): AdmittedSpiceExecutionAttemptKey {
  return {
    projectId: attempt.projectId,
    agentRunId: attempt.agentRunId,
    executionRunId: attempt.executionRunId,
    attemptFingerprint: attempt.attemptFingerprint,
  };
}

function assertAttemptIdentity(
  attempt: AdmittedSpiceExecutionAttempt,
  key: AdmittedSpiceExecutionAttemptKey,
  identity: AdmittedSpiceExecutionAttemptIdentity,
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
      "The admitted SPICE journal differs from the exact reviewed attempt identity and start timeline.",
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
      "The admitted SPICE run has no exact reviewed input fingerprint.",
    );
  }
  return run.inputFingerprint;
}

function buildDocumentarySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: SpiceAdmittedExecutionCapture;
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
  actual: AdmittedSpiceExecutionThreadEvidence,
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

function isolatedExecutionRejectionMessage(
  diagnostic: IsolatedCodeExecutionRejectionDiagnostic,
): string {
  const termination = diagnostic.termination;
  const outcome = termination.kind === "exited"
    ? `exited ${termination.exitCode}`
    : termination.kind;
  const excerpt = diagnostic.logs.stderr.excerpt.trim() ||
    diagnostic.logs.stdout.excerpt.trim();
  const text = excerpt.length === 0
    ? `Isolated admitted SPICE execution was rejected (${outcome}).`
    : `Isolated admitted SPICE execution was rejected (${outcome}): ${excerpt}`;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function isolatedOutputValidationRejectedMessage(
  observation: IsolatedCodeOutputValidationRejection,
): string {
  const text =
    `Isolated output validation rejected registered role ${observation.role} ` +
    `(${observation.byteCount} bytes, sha256 ${observation.sha256}).`;
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

class AdmittedSpiceTerminalExecutionOutcome extends Error {
  readonly kind:
    | "execution-rejected"
    | "output-validation-rejected"
    | "retry-generation-closed";
  readonly summary: string;
  readonly code: string;

  private constructor(
    kind:
      | "execution-rejected"
      | "output-validation-rejected"
      | "retry-generation-closed",
    summary: string,
    code: string,
    diagnostic: string,
  ) {
    super(diagnostic);
    this.name = "AdmittedSpiceTerminalExecutionOutcome";
    this.kind = kind;
    this.summary = summary;
    this.code = code;
  }

  static executionRejected(
    diagnostic: IsolatedCodeExecutionRejectionDiagnostic,
  ): AdmittedSpiceTerminalExecutionOutcome {
    return new AdmittedSpiceTerminalExecutionOutcome(
      "execution-rejected",
      ADMITTED_SPICE_ISOLATED_EXECUTION_REJECTED.summary,
      ADMITTED_SPICE_ISOLATED_EXECUTION_REJECTED.code,
      isolatedExecutionRejectionMessage(diagnostic),
    );
  }

  static outputValidationRejected(
    observation: IsolatedCodeOutputValidationRejection,
  ): AdmittedSpiceTerminalExecutionOutcome {
    return new AdmittedSpiceTerminalExecutionOutcome(
      "output-validation-rejected",
      ADMITTED_SPICE_ISOLATED_OUTPUT_VALIDATION_FAILED.summary,
      ADMITTED_SPICE_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
      isolatedOutputValidationRejectedMessage(observation),
    );
  }

  static retryGenerationClosed(): AdmittedSpiceTerminalExecutionOutcome {
    return new AdmittedSpiceTerminalExecutionOutcome(
      "retry-generation-closed",
      ADMITTED_SPICE_RETRY_GENERATION_CLOSED.summary,
      ADMITTED_SPICE_RETRY_GENERATION_CLOSED.code,
      ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    );
  }

  failure(): {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  } {
    return {
      summary: this.summary,
      code: this.code,
      message: this.message,
    };
  }
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function domainTransition(error: unknown): EngineeringProjectCommandError {
  return invalidTransition(
    error instanceof Error ? error.message : String(error),
  );
}
