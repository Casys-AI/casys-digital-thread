/**
 * Trusted project executor for the one qualified local Modelica kit.
 *
 * The operation is intentionally documentary: it records the exact local
 * execution capture, the normalized evidence document, the retained solver
 * result and the one observed conformance metric. It neither evaluates a
 * requirement nor turns this solver-conformance run into a product verdict.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ModelicaIsolatedExecutionCaptureStore } from "../../../application/ports/out/modelica/isolated-execution-evidence-store.ts";
import {
  type ExecuteIsolatedModelicaRun,
  type ExecuteIsolatedModelicaRunResult,
  IsolatedQualifiedModelicaOutputValidationRejectedError,
} from "../../../application/use-cases/modelica/qualified-kit/execute-isolated-run.ts";
import type {
  PreparedQualifiedModelicaRunReview,
  PrepareProjectModelicaQualifiedKitRunReview,
} from "../../../application/use-cases/modelica/qualified-kit/prepare-run-review.ts";
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
  validateModelicaIsolatedExecutionCapture,
} from "../../../domain/modelica/qualified-kit/isolated-execution-evidence.ts";
import {
  type ModelicaQualifiedKitRunAdmission,
  parseModelicaQualifiedKitRunAdmissionParameters,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
} from "../../../domain/modelica/qualified-kit/run-proposal.ts";
import { isolatedCodeExecutionReceiptRecord } from "../../../domain/compile/isolation/isolated-code-execution.ts";
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
  ThreadObservation,
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

export { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION };

export const QUALIFIED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED = {
  summary:
    "Isolated qualified Modelica output validation was rejected before Thread publication.",
  code: "isolated_output_validation_failed",
} as const;

/** Result readback must bypass any in-process Thread snapshot cache. */
export interface QualifiedModelicaKitThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface SimulateRunQualifiedModelicaKitRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: QualifiedModelicaKitThreadSnapshotStore;
  readonly review: Pick<
    PrepareProjectModelicaQualifiedKitRunReview,
    "prepareForExecution"
  >;
  readonly execution: Pick<
    ExecuteIsolatedModelicaRun,
    "execute" | "reopenCompleted" | "reopenOutputValidationRejection"
  >;
  readonly captures: ModelicaIsolatedExecutionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

interface ReviewedAuthority {
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  readonly admission: ModelicaQualifiedKitRunAdmission;
}

interface DocumentarySuccessor {
  readonly snapshot: ThreadSnapshot;
  readonly artifacts: readonly [ThreadArtifact, ThreadArtifact, ThreadArtifact];
  readonly observation: ThreadObservation;
}

export class SimulateRunQualifiedModelicaKitRunExecutor {
  constructor(
    private readonly d: SimulateRunQualifiedModelicaKitRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed qualified Modelica kit.",
      );
    }

    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    const authority = await requireReviewedAuthority(project, run);
    assertAdmissionScope(project, run, authority.admission);
    // A completed replay acquires the same lease for ordering but bypasses the
    // write-basis guard: its own direct successor is now the declared head.
    if (run.status === "completed") {
      return await this.d.lease.withLease(
        command.projectId,
        threadWriteBasisLeaseScope(run),
        async () => {
          await this.#replayClaim(origin, command);
          return await this.#reopenAndAssertCompleted(
            origin,
            command,
            authority.decision.id,
          );
        },
      );
    }

    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, authority),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    initialAuthority: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, command.runId);
    requireExecutionShape(project, run);

    // Re-read after acquiring the basis lease: another concurrent invocation
    // may have completed while this one was waiting.
    if (run.status === "completed") {
      await this.#replayClaim(origin, command);
      return await this.#reopenAndAssertCompleted(
        origin,
        command,
        initialAuthority.decision.id,
      );
    }
    if (run.status === "failed") {
      try {
        await this.d.execution.reopenOutputValidationRejection({
          projectId: command.projectId,
          agentRunId: run.id,
        });
      } catch (error) {
        if (error instanceof IsolatedQualifiedModelicaOutputValidationRejectedError) {
          await this.#assertFailedOutputValidationReplay(
            origin,
            command,
            project,
            run,
            isolatedOutputValidationFailure(error.observation),
          );
          return project;
        }
        throw error;
      }
      throw unexpectedStatus(run, "queued or this agent's running/publishing");
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
      false,
    );
    await assertThreadSnapshotLineageIntact(preClaimSnapshot, this.d.snapshots);
    await this.#prepareExactReview(project, run, initialAuthority);

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
        return await this.#reopenAndAssertCompleted(
          origin,
          command,
          initialAuthority.decision.id,
        );
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }

      const authority = await requireReviewedAuthority(project, run);
      if (authority.decision.id !== initialAuthority.decision.id) {
        throw invalidTransition(
          "The exact human-approved qualified Modelica decision changed after claim.",
        );
      }
      assertAdmissionScope(project, run, authority.admission);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, true);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
      const prepared = await this.#prepareExactReview(project, run, authority);
      const executionInput = {
        projectId: command.projectId,
        agentRunId: run.id,
        reviewedRunFingerprint: requiredRunFingerprint(run),
        bundle: prepared.bundle,
        preparedAt: requiredStart(run),
      };

      // A queued claim or an already-running exact claim may enter the inner use
      // case: its own durable WAL is the authority which decides between first
      // dispatch and recovery. Publishing is past that boundary and must use the
      // dedicated read-only reopen API.
      const result = run.status === "running"
        ? await this.d.execution.execute(executionInput)
        : await this.d.execution.reopenCompleted(executionInput);
      const reopened = await this.#reopenExactExecution(
        project,
        run,
        prepared,
        result,
      );
      const expected = buildDocumentarySuccessor({
        basisSnapshot,
        basis,
        run,
        result: reopened,
      });

      await this.d.snapshots.save(expected.snapshot);
      const readback = await this.d.snapshots.getFresh(expected.snapshot.id);
      if (
        !readback ||
        deterministicJson(validateThreadSnapshot(readback)) !==
          deterministicJson(expected.snapshot)
      ) {
        throw invalidTransition(
          "The qualified Modelica documentary Thread successor failed exact durable readback.",
        );
      }

      project = await this.#requiredProject(command.projectId);
      await this.#publishExact(origin, project, command);
      project = await this.#requiredProject(command.projectId);
      await this.#completeExact(origin, project, command, expected);

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      await assertCompletedThread(project, run, expected, this.d.snapshots);
      exactCommandReceipt(
        project,
        commandStep(command.commandId, "publish"),
        "agent-run.publish",
        origin,
        command,
      );
      exactCommandReceipt(
        project,
        commandStep(command.commandId, "complete"),
        "agent-run.complete",
        origin,
        command,
      );
      return project;
    } catch (error) {
      if (error instanceof IsolatedQualifiedModelicaOutputValidationRejectedError) {
        return await this.#failOutputValidationRejected(origin, command, error);
      }
      throw invalidTransition(
        "The qualified Modelica execution or documentary Thread publication has a durable or uncertain effect. " +
          "Retry this exact command; recovery will reopen the inner WAL and deterministic successor without blindly redispatching. " +
          `Cause: ${boundedCause(error)}`,
      );
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
    if (project.project.id !== projectId) {
      throw invalidTransition(
        "The project store returned a foreign qualified Modelica project identity.",
      );
    }
    return project;
  }

  async #prepareExactReview(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    authority: ReviewedAuthority,
  ): Promise<PreparedQualifiedModelicaRunReview> {
    const basis = requireBasis(run);
    let prepared: PreparedQualifiedModelicaRunReview;
    try {
      prepared = await this.d.review.prepareForExecution({
        projectId: project.project.id,
        basis,
      });
    } catch {
      throw invalidTransition(
        "The exact qualified Modelica review material could not be reopened.",
      );
    }
    if (
      deterministicJson(prepared.admission) !==
        deterministicJson(authority.admission) ||
      deterministicJson(prepared.decisionParameters) !==
        deterministicJson(authority.proposal.parameters) ||
      !fingerprintsEqual(
        prepared.bundle.fingerprint,
        authority.admission.bundle.fingerprint,
      ) || prepared.bundle.bytes.byteLength !== authority.admission.bundle.byteCount
    ) {
      throw invalidTransition(
        "The reopened kit, profile, qualification or decision parameters differ from the exact human-reviewed Modelica admission.",
      );
    }
    return prepared;
  }

  async #reopenExactExecution(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    prepared: PreparedQualifiedModelicaRunReview,
    result: ExecuteIsolatedModelicaRunResult,
  ): Promise<ExecuteIsolatedModelicaRunResult> {
    const storedCapture = await this.d.captures.read(
      result.captureReference.fingerprint,
    );
    const capture = storedCapture
      ? await validateModelicaIsolatedExecutionCapture(storedCapture)
      : undefined;
    const outputs = new Map(
      result.receipt.outputs.map((output) => [output.role, output]),
    );
    const evidenceOutput = outputs.get("evidence");
    const resultOutput = outputs.get("result");
    const metric = result.evidence.metrics[0];
    const evidenceFingerprint = await sha256Fingerprint(result.evidence);
    if (
      !capture ||
      this.d.captures.uriFor(result.captureReference.fingerprint) !==
        result.captureReference.uri ||
      deterministicJson(capture) !== deterministicJson(result.capture) ||
      !fingerprintsEqual(
        await sha256Fingerprint(capture),
        result.captureReference.fingerprint,
      ) || capture.projectId !== project.project.id ||
      capture.agentRunId !== run.id ||
      !fingerprintsEqual(
        capture.reviewedRunFingerprint,
        requiredRunFingerprint(run),
      ) ||
      !fingerprintsEqual(capture.bundle.fingerprint, prepared.bundle.fingerprint) ||
      result.executionRunId !== capture.executionRunId ||
      result.receipt.runId !== capture.executionRunId ||
      deterministicJson(capture.receipt) !==
        deterministicJson(isolatedCodeExecutionReceiptRecord(result.receipt)) ||
      deterministicJson(capture.evidence) !== deterministicJson(result.evidence) ||
      outputs.size !== 2 || !evidenceOutput || !resultOutput ||
      evidenceOutput.sha256 !== evidenceFingerprint.digest ||
      result.evidence.result.basename !== resultOutput.basename ||
      result.evidence.result.byteCount !== resultOutput.byteCount ||
      result.evidence.result.sha256 !== resultOutput.sha256 ||
      result.evidence.status !== "succeeded" ||
      result.evidence.metrics.length !== 1 ||
      metric?.id !== "temperature_final" || metric.value !== 22 ||
      metric.unit !== "degC"
    ) {
      throw invalidTransition(
        "The completed local Modelica execution does not exactly bind its reviewed run, capture, two retained outputs and 22 degC conformance observation.",
      );
    }
    return Object.freeze({
      ...result,
      capture,
    });
  }

  async #reopenAndAssertCompleted(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    expectedDecisionId: string,
  ): Promise<EngineeringProjectSnapshot> {
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, command.runId);
    if (run.status !== "completed") {
      throw unexpectedStatus(run, "completed");
    }
    requireClaimedShape(project, run, origin);
    const authority = await requireReviewedAuthority(project, run);
    if (authority.decision.id !== expectedDecisionId) {
      throw invalidTransition(
        "The completed qualified Modelica run no longer names its exact reviewed decision.",
      );
    }
    assertAdmissionScope(project, run, authority.admission);
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, false);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
    const prepared = await this.#prepareExactReview(project, run, authority);
    const result = await this.d.execution.reopenCompleted({
      projectId: command.projectId,
      agentRunId: run.id,
      reviewedRunFingerprint: requiredRunFingerprint(run),
      bundle: prepared.bundle,
      preparedAt: requiredStart(run),
    });
    const reopened = await this.#reopenExactExecution(
      project,
      run,
      prepared,
      result,
    );
    const expected = buildDocumentarySuccessor({
      basisSnapshot,
      basis,
      run,
      result: reopened,
    });
    await assertCompletedThread(project, run, expected, this.d.snapshots);

    await this.#publishExact(origin, project, command);
    project = await this.#requiredProject(command.projectId);
    await this.#completeExact(origin, project, command, expected);
    project = await this.#requiredProject(command.projectId);
    run = requireRun(project, command.runId);
    await assertCompletedThread(project, run, expected, this.d.snapshots);
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
      command,
    );
    await this.d.commands.claimRun(
      origin,
      claimCommand(
        command,
        receipt.resultingSnapshot.revision - 1,
        receipt.issuedAt,
      ),
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
        command,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
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
        command,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
    } else if (run.status !== "publishing") {
      throw unexpectedStatus(run, "publishing or completed");
    }
    await this.d.commands.completeRun(
      origin,
      completionCommand(command, expectedRevision, expected, issuedAt),
    );
  }

  async #failOutputValidationRejected(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    error: IsolatedQualifiedModelicaOutputValidationRejectedError,
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
        "The claimed qualified Modelica run already carries Thread evidence and cannot take an evidence-free terminal failure.",
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

function requireExecutionShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.baseSnapshot !== undefined || run.resolvedOperationPlan !== undefined ||
    !workItem || operation?.id !== SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id ||
    operation.version !== SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version ||
    operation.bindings.length !== 0 || workItem.decisionIds.length !== 1
  ) {
    throw invalidTransition(
      `Run ${run.id} is not the exact ${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id}@1 project run with one MRTR decision, no resolved plan and no Thread entity bindings.`,
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
      "This executor may continue only the exact qualified Modelica run it claimed.",
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
      "The qualified Modelica work item must name exactly one decision.",
    );
  }
  const decision = project.decisions.find((item) =>
    item.id === workItem.decisionIds[0]
  );
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !decision.inputFingerprint || decision.inputEvidenceRefs.length !== 0 ||
    decision.approvalIds.length !== 1
  ) {
    throw invalidTransition(
      "The qualified Modelica run requires one exact approved MRTR decision with no evidence inputs.",
    );
  }
  const decisionApprovals = project.approvals.filter((item) =>
    item.decisionId === decision.id
  );
  const approval = decisionApprovals[0];
  const basis = requireBasis(run);
  if (
    decisionApprovals.length !== 1 || !approval ||
    approval.id !== decision.approvalIds[0] || approval.status !== "approved" ||
    approval.decidedByOrigin !== "human" ||
    typeof approval.decidedBy !== "string" || approval.decidedBy.trim() === "" ||
    typeof approval.decidedAt !== "string" ||
    Number.isNaN(Date.parse(approval.decidedAt)) ||
    approval.inputEvidenceRefs.length !== 0 ||
    !sameSnapshotBasis(decision.baseSnapshot, basis) ||
    !sameSnapshotBasis(approval.baseSnapshot, basis) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw invalidTransition(
      "The qualified Modelica decision must have exactly one matching human approval (human-approved authorization) on the run's exact basis and no evidence inputs.",
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
      "The qualified Modelica decision fingerprint no longer seals its exact basis, summary and closed parameters.",
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
      "The qualified Modelica run fingerprint no longer seals its sole MRTR decision, operation and basis.",
    );
  }
  let admission: ModelicaQualifiedKitRunAdmission;
  try {
    admission = parseModelicaQualifiedKitRunAdmissionParameters(
      decision.proposal.parameters,
    );
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Qualified Modelica decision parameters failed exact closed-schema validation.",
    );
  }
  return { decision, approval, proposal: decision.proposal, admission };
}

function assertAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  admission: ModelicaQualifiedKitRunAdmission,
): void {
  const basis = requireBasis(run);
  if (
    admission.project.id !== project.project.id ||
    deterministicJson(admission.project.basis) !== deterministicJson(basis) ||
    admission.operation.id !== SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id ||
    admission.operation.version !==
      SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version
  ) {
    throw invalidTransition(
      "The reviewed qualified Modelica admission does not name this exact project, operation and Thread basis.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: QualifiedModelicaKitThreadSnapshotStore,
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
      `Qualified Modelica basis ${basis.snapshotId}@${basis.revision} is not exactly available.`,
    );
  }
  return validateThreadSnapshot(snapshot);
}

function buildDocumentarySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly result: ExecuteIsolatedModelicaRunResult;
}): DocumentarySuccessor {
  const capturedAt = requiredStart(input.run);
  const operation = {
    serverId: "digital-thread",
    tool:
      `${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id}@${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version}`,
    runId: input.run.id,
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const outputs = new Map(
    input.result.receipt.outputs.map((output) => [output.role, output]),
  );
  const evidenceOutput = outputs.get("evidence");
  const resultOutput = outputs.get("result");
  if (!evidenceOutput || !resultOutput || outputs.size !== 2) {
    throw invalidTransition(
      "The qualified Modelica documentary branch requires exactly evidence and result outputs.",
    );
  }
  const captureArtifact: ThreadArtifact = {
    id:
      `modelica-qualified-capture-${input.result.captureReference.fingerprint.digest}`,
    name: "Qualified local Modelica execution capture",
    kind: "document",
    version: input.result.captureReference.fingerprint.digest,
    fingerprint: input.result.captureReference.fingerprint,
    uri: input.result.captureReference.uri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const evidenceArtifact: ThreadArtifact = {
    id: `modelica-qualified-evidence-${evidenceOutput.sha256}`,
    name: "Qualified local Modelica normalized evidence",
    kind: "evidence",
    version: evidenceOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: evidenceOutput.sha256 },
    uri: evidenceOutput.casUri,
    mediaType: evidenceOutput.mediaType,
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const resultArtifact: ThreadArtifact = {
    id: `modelica-qualified-result-${resultOutput.sha256}`,
    name: "Qualified local OpenModelica result",
    kind: "solver-result",
    version: resultOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: resultOutput.sha256 },
    uri: resultOutput.casUri,
    mediaType: resultOutput.mediaType,
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const observation: ThreadObservation = {
    id: `modelica-qualified-temperature-final-${input.run.id}`,
    name: "Qualified local Modelica final temperature",
    metric: "temperature_final",
    quantity: { value: 22, unit: "degC" },
    source: {
      operation,
      artifactIds: [evidenceArtifact.id, resultArtifact.id],
      capturedAt,
    },
    freshness,
  };
  const extension: ThreadSnapshotExtension = {
    id: `simulate-run-qualified-modelica-kit-${input.run.id}`,
    name: "Record qualified local Modelica solver conformance",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    consumptions: [],
    observations: [observation],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `${observation.id}-from-evidence`,
        relation: "derived_from",
        from: { kind: "observation", id: observation.id },
        to: { kind: "artifact", id: evidenceArtifact.id },
        rationale:
          "The local normalized evidence records this exact solver-conformance metric.",
      },
      {
        id: `${observation.id}-from-result`,
        relation: "derived_from",
        from: { kind: "observation", id: observation.id },
        to: { kind: "artifact", id: resultArtifact.id },
        rationale:
          "The retained local OpenModelica result is the numeric source of this observation.",
      },
    ],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "The exact qualified Modelica documentary branch is already present in its own basis.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    observation,
  };
}

async function assertCompletedThread(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  expected: DocumentarySuccessor,
  snapshots: QualifiedModelicaKitThreadSnapshotStore,
): Promise<void> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const resultRef = run.resultSnapshot;
  if (
    run.status !== "completed" || !resultRef || !workItem ||
    resultRef.snapshotId !== expected.snapshot.id ||
    resultRef.revision !== expected.snapshot.revision ||
    resultRef.subjectId !== expected.snapshot.subject.id ||
    run.evidenceRefs.length !== 3 || workItem.evidenceRefs.length !== 3 ||
    deterministicJson(run.evidenceRefs) !== deterministicJson(workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed qualified Modelica run is not attached to its exact successor and three documentary artifacts.",
    );
  }
  const reopened = await snapshots.getFresh(resultRef.snapshotId);
  if (
    !reopened ||
    deterministicJson(validateThreadSnapshot(reopened)) !==
      deterministicJson(expected.snapshot)
  ) {
    throw invalidTransition(
      "The completed qualified Modelica successor cannot be reopened exactly.",
    );
  }
  const expectedRefs = expected.artifacts.map((artifact) =>
    artifactEvidence(expected.snapshot, artifact)
  );
  if (deterministicJson(run.evidenceRefs) !== deterministicJson(expectedRefs)) {
    throw invalidTransition(
      "The completed qualified Modelica evidence references differ from the exact capture, evidence and result artifacts.",
    );
  }
  const observations = reopened.observations.filter((item) =>
    item.id === expected.observation.id
  );
  if (
    observations.length !== 1 ||
    deterministicJson(observations[0]) !== deterministicJson(expected.observation) ||
    reopened.requirements.length !== expected.snapshot.requirements.length ||
    reopened.evaluations.length !== expected.snapshot.evaluations.length ||
    reopened.violations.length !== expected.snapshot.violations.length ||
    reopened.proposedActions.length !== expected.snapshot.proposedActions.length
  ) {
    throw invalidTransition(
      "The completed qualified Modelica branch does not preserve its sole 22 degC observation and documentary-only authority.",
    );
  }
}

function requiredRunFingerprint(run: EngineeringAgentRun): ContentFingerprint {
  if (!run.inputFingerprint) {
    throw invalidTransition(
      "The qualified Modelica run has no exact reviewed input fingerprint.",
    );
  }
  return run.inputFingerprint;
}

function sameSnapshotBasis(
  candidate: EngineeringDecision["baseSnapshot"],
  expected: EngineeringThreadSnapshotBasis,
): boolean {
  return candidate?.snapshotId === expected.snapshotId &&
    candidate.revision === expected.revision &&
    candidate.subjectId === expected.subjectId;
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
    summary: "Started the exact reviewed qualified local Modelica kit run.",
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
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "publish"),
    expectedRevision,
    issuedAt,
    summary: "Publishing the qualified local Modelica documentary evidence.",
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
    summary: "Recorded the exact qualified local Modelica conformance run.",
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
  command: RegisteredProjectRunExecutorCommand,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== type ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== new Date(command.issuedAt).toISOString() ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 2
  ) {
    throw invalidTransition(
      `The qualified Modelica run has no unique exact ${type} receipt for this command and actor.`,
    );
  }
  return receipt;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:simulate-run-qualified-modelica-kit:${step}`;
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
    summary: QUALIFIED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED.summary,
    code: QUALIFIED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
    message: isolatedOutputValidationFailedMessage(observation),
  };
}
