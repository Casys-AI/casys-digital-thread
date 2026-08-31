/**
 * Trusted executor for `verify.evaluate-assembly-integrity@1`.
 *
 * This is a provider-free deterministic L4 recross.  It accepts only an
 * agent-queued run, verifies the exact human MRTR admission, reopens the
 * unique fresh L3 evidence selected through the work dependency, records a
 * durable custom capture, then appends one evidence artifact.  It never emits
 * a generic SysML RequirementEvaluation or changes a gate claim.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import type { EvaluateAssemblyIntegrityUseCase } from "../../../application/ports/in/cad/assembly-integrity/evaluate-assembly-integrity.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { AssemblyIntegrityEvaluationCaptureStore } from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-evaluation-capture-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type AssemblyIntegrityEvaluationAdmission,
  parseAssemblyIntegrityEvaluationAdmissionParameters,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-admission.ts";
import {
  type AssemblyIntegrityEvaluationCapture,
  assemblyIntegrityEvaluationCaptureUri,
  canonicalAssemblyIntegrityEvaluationCaptureText,
  fingerprintAssemblyIntegrityEvaluationCapture,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  evaluateAssemblyIntegrityWorkItemOperation,
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  assemblyIntegrityEvaluationGateClaimIssue,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-gate-policy.ts";
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
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
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
import { approvedBriefBasisForProject } from "../../../application/use-cases/project/commands/project-planning-transitions.ts";
import {
  FileAssemblyIntegrityEvaluationAttemptStore,
} from "./file-assembly-integrity-evaluation-attempt-store.ts";

const CLAIM_SUMMARY = "Started the provider-free assembly-integrity evaluation.";
const PUBLISH_SUMMARY = "Publishing the assembly-integrity evaluation capture.";
const COMPLETE_SUMMARY = "Captured the provider-free assembly-integrity evaluation.";

export interface AssemblyIntegrityEvaluationThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifyEvaluateAssemblyIntegrityRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: AssemblyIntegrityEvaluationThreadSnapshotStore;
  readonly evaluation: EvaluateAssemblyIntegrityUseCase;
  readonly captures: AssemblyIntegrityEvaluationCaptureStore;
  readonly attempts: FileAssemblyIntegrityEvaluationAttemptStore;
  readonly lease: EngineeringProjectRunLease;
}

export class VerifyEvaluateAssemblyIntegrityRunExecutor {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #commands:
    VerifyEvaluateAssemblyIntegrityRunExecutorDependencies["commands"];
  readonly #snapshots: AssemblyIntegrityEvaluationThreadSnapshotStore;
  readonly #evaluation: EvaluateAssemblyIntegrityUseCase;
  readonly #captures: AssemblyIntegrityEvaluationCaptureStore;
  readonly #attempts: FileAssemblyIntegrityEvaluationAttemptStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: VerifyEvaluateAssemblyIntegrityRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#evaluation = dependencies.evaluation;
    this.#captures = dependencies.captures;
    this.#attempts = dependencies.attempts;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the provider-free assembly-integrity evaluation.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    await requireMrtrApproval(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotWriteMayHaveBeenDispatched = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      const completed = await this.#completedFor(command);
      if (completed) return completed;
      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: CLAIM_SUMMARY,
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: CLAIM_SUMMARY,
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      const completedAfterClaim = await this.#completedFor(command);
      if (completedAfterClaim) return completedAfterClaim;
      requireClaimedShape(project, run, origin);
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }
      const approval = await requireMrtrApproval(project, run);
      const admission = parseAdmission(approval.proposal.parameters);
      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(
        currentBasisSnapshot,
        this.#snapshots,
      );

      const evaluated = await this.#evaluation.execute({
        projectId: command.projectId,
        trustedRunId: run.id,
        basis: currentBasis,
        evaluatedAt: requiredStart(run),
      });
      if (evaluated.status !== "resolved") {
        throw invalidTransition(
          `The provider-free assembly-integrity evaluation is ${evaluated.status}: ` +
            evaluated.diagnostics.map((item) => item.code).join(", "),
        );
      }
      await assertAdmissionScope(
        admission,
        command.projectId,
        currentBasis,
        evaluated.capture,
      );
      const planFingerprint = await sha256Fingerprint({
        runId: run.id,
        workItemId: run.workItemId,
        basis: currentBasis,
        operation: evaluateAssemblyIntegrityWorkItemOperation(),
        admission,
      });
      const canonicalCaptureText =
        await canonicalAssemblyIntegrityEvaluationCaptureText(
          evaluated.capture,
        );
      const captureFingerprint = await fingerprintAssemblyIntegrityEvaluationCapture(
        evaluated.capture,
      );
      const begin = await this.#attempts.begin({
        projectId: command.projectId,
        runId: run.id,
        planDigest: planFingerprint.digest,
        startedAt: requiredStart(run),
      });
      if (begin.action !== "evaluate") {
        if (
          !fingerprintsEqual(begin.captureFingerprint, captureFingerprint) ||
          begin.canonicalCaptureText !== canonicalCaptureText
        ) {
          throw invalidTransition(
            "The durable L4 attempt does not match the exact recrossed evaluation capture.",
          );
        }
      }
      if (run.status === "publishing") {
        return await this.#resumePublishing(
          origin,
          command,
          run,
          currentBasisSnapshot,
          evaluated.capture,
          evaluated.artifactInputs,
          captureFingerprint,
          planFingerprint.digest,
        );
      }

      let capture: AssemblyIntegrityEvaluationCapture;
      let captureUri: string;
      if (begin.action === "evaluate") {
        const receipt = await this.#captures.save(evaluated.capture);
        capture = await requiredCapture(this.#captures, receipt.fingerprint);
        if (
          deterministicJson(capture) !== deterministicJson(evaluated.capture) ||
          !fingerprintsEqual(receipt.fingerprint, captureFingerprint) ||
          receipt.uri !==
            assemblyIntegrityEvaluationCaptureUri(captureFingerprint.digest)
        ) {
          throw new Error(
            "Assembly-integrity evaluation capture changed during exact durable readback.",
          );
        }
        captureUri = receipt.uri;
        await this.#attempts.recordCapture({
          projectId: command.projectId,
          runId: run.id,
          planDigest: planFingerprint.digest,
          recordedAt: requiredStart(run),
          captureFingerprint,
          canonicalCaptureText,
        });
      } else {
        capture = await requiredCapture(this.#captures, captureFingerprint);
        const reopenedText = await canonicalAssemblyIntegrityEvaluationCaptureText(
          capture,
        );
        if (reopenedText !== canonicalCaptureText) {
          throw invalidTransition(
            "The durable L4 capture store does not retain the exact journaled capture bytes.",
          );
        }
        captureUri = assemblyIntegrityEvaluationCaptureUri(captureFingerprint.digest);
      }

      const successor = buildSuccessor({
        basisSnapshot: currentBasisSnapshot,
        run,
        capture,
        artifactInputs: evaluated.artifactInputs,
        captureFingerprint,
        captureUri,
      });
      snapshotWriteMayHaveBeenDispatched = true;
      await this.#snapshots.save(successor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Assembly-integrity evaluation ThreadSnapshot was not exactly readable after save.",
        );
      }
      await this.#attempts.complete({
        projectId: command.projectId,
        runId: run.id,
        planDigest: planFingerprint.digest,
        completedAt: requiredStart(run),
        captureFingerprint,
      });

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: PUBLISH_SUMMARY,
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completionCommand(
            command,
            project.revision,
            successor.snapshot,
            successor.artifact,
          ),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.#requiredProject(command.projectId);
      await this.#assertCompletedEvidence(complete, command);
      return complete;
    } catch (error) {
      if (snapshotWriteMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw invalidTransition(
          "The L4 Thread write may have been dispatched. Retry this exact command to reopen its deterministic custom capture successor.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  async #resumePublishing(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    run: EngineeringAgentRun,
    basisSnapshot: ThreadSnapshot,
    capture: AssemblyIntegrityEvaluationCapture,
    artifactInputs: Parameters<typeof buildSuccessor>[0]["artifactInputs"],
    captureFingerprint: ContentFingerprint,
    planDigest: string,
  ): Promise<EngineeringProjectSnapshot> {
    const successor = buildSuccessor({
      basisSnapshot,
      run,
      capture,
      artifactInputs,
      captureFingerprint,
      captureUri: assemblyIntegrityEvaluationCaptureUri(captureFingerprint.digest),
    });
    const snapshot = await this.#snapshots.getFresh(successor.snapshot.id);
    if (
      !snapshot || deterministicJson(snapshot) !== deterministicJson(successor.snapshot)
    ) {
      throw invalidTransition(
        "A publishing L4 run does not have its exact deterministic Thread successor.",
      );
    }
    await this.#attempts.complete({
      projectId: command.projectId,
      runId: run.id,
      planDigest,
      completedAt: requiredStart(run),
      captureFingerprint,
    });
    const project = await this.#requiredProject(command.projectId);
    const currentRun = requireRun(project, command.runId);
    if (currentRun.status === "publishing") {
      await this.#commands.completeRun(
        origin,
        completionCommand(
          command,
          project.revision,
          successor.snapshot,
          successor.artifact,
        ),
      );
    }
    const complete = await this.#requiredProject(command.projectId);
    await this.#assertCompletedEvidence(complete, command);
    return complete;
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Project ${projectId} was not found.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#assertCompletedEvidence(project, command);
    return project;
  }

  async #assertCompletedEvidence(
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    if (run.status !== "completed" || !run.resultSnapshot) {
      throw invalidTransition(
        "The L4 run did not complete through its exact result snapshot.",
      );
    }
    const basis = requireBasis(run);
    const result = await this.#snapshots.getFresh(run.resultSnapshot.snapshotId);
    if (
      !result || result.id !== run.resultSnapshot.snapshotId ||
      result.revision !== run.resultSnapshot.revision ||
      result.subject.id !== run.resultSnapshot.subjectId ||
      result.revision !== basis.revision + 1 ||
      !result.previous || result.previous.snapshotId !== basis.snapshotId ||
      result.previous.revision !== basis.revision ||
      result.subject.id !== basis.subjectId
    ) {
      throw invalidTransition(
        "The completed L4 run lacks its exact direct Thread successor.",
      );
    }
    const snapshot = validateThreadSnapshot(result);
    const evidence = exactCompletedEvidence(project, run, snapshot);
    const artifact = snapshot.artifacts.find((item) => item.id === evidence.id);
    if (!artifact || artifact.kind !== "evidence") {
      throw invalidTransition(
        "The completed L4 evidence is not the custom evidence artifact.",
      );
    }
    const capture = await requiredCapture(this.#captures, artifact.fingerprint);
    const fingerprint = await fingerprintAssemblyIntegrityEvaluationCapture(capture);
    if (
      !fingerprintsEqual(fingerprint, artifact.fingerprint) ||
      artifact.id !== `assembly-integrity-evaluation-${fingerprint.digest}` ||
      artifact.version !== fingerprint.digest ||
      artifact.uri !== assemblyIntegrityEvaluationCaptureUri(fingerprint.digest) ||
      artifact.producer.runId !== run.id ||
      capture.trustedRunId !== run.id ||
      capture.evaluatedAt !== requiredStart(run) ||
      capture.basis.snapshotId !== basis.snapshotId ||
      capture.basis.revision !== basis.revision ||
      capture.basis.subjectId !== basis.subjectId
    ) {
      throw invalidTransition(
        "The completed custom L4 capture no longer binds its exact run and basis.",
      );
    }
    const admission = parseAdmission(
      (await requireMrtrApproval(project, run)).proposal.parameters,
    );
    await assertAdmissionScope(admission, command.projectId, basis, capture);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    const expected = buildSuccessor({
      basisSnapshot,
      run,
      capture,
      artifactInputs: captureArtifactInputs(capture),
      captureFingerprint: fingerprint,
      captureUri: artifact.uri,
    });
    if (deterministicJson(expected.snapshot) !== deterministicJson(snapshot)) {
      throw invalidTransition(
        "The completed L4 successor is not the exact deterministic custom-capture extension.",
      );
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
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Assembly-integrity evaluation stopped before its custom evidence was published.",
        code: "verify-evaluate-assembly-integrity-not-published",
        message:
          "The provider-free assembly-integrity evaluation stopped before publishing its custom capture.",
      });
    } catch {
      // Preserve the original error.
    }
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const work = project.workItems.filter((item) => item.id === run.workItemId);
  if (
    run.basis?.kind !== "thread-snapshot" || work.length !== 1 ||
    deterministicJson(work[0]!.operation) !==
      deterministicJson(evaluateAssemblyIntegrityWorkItemOperation())
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to the exact zero-binding ${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version} work operation.`,
    );
  }
  const gateIssue = assemblyIntegrityEvaluationGateClaimIssue(project, work[0]!);
  const basis = run.basis;
  const changes = (project.planChanges ?? []).filter((change) =>
    change.workItemIds.includes(work[0]!.id)
  );
  if (
    !basis || changes.length !== 1 ||
    changes[0]!.baseSnapshot.snapshotId !== basis.snapshotId ||
    changes[0]!.baseSnapshot.revision !== basis.revision ||
    changes[0]!.baseSnapshot.subjectId !== basis.subjectId ||
    !changes[0]!.approvedBriefBasis
  ) {
    throw invalidTransition(
      "The L4 work is not anchored on the exact Thread basis with an approved Brief basis.",
    );
  }
  // A completed custom capture is immutable historical evidence.  Its
  // idempotent readback must not become invalid merely because a later Brief
  // revision changed the live gates.  Runs that can still mutate the Thread
  // must instead recross the live tip, current Brief, and L4-only claim role.
  if (run.status === "completed") return;
  if (gateIssue) throw invalidTransition(gateIssue);
  const tip = selectCurrentThreadTip(project.threadSnapshots);
  let currentBriefBasis;
  try {
    currentBriefBasis = approvedBriefBasisForProject(project);
  } catch {
    throw invalidTransition(
      "The L4 work must remain authorized by the exact current human-approved Brief basis.",
    );
  }
  if (
    tip.status !== "ok" ||
    tip.basis.snapshotId !== basis.snapshotId ||
    tip.basis.revision !== basis.revision ||
    tip.basis.subjectId !== basis.subjectId ||
    deterministicJson(changes[0]!.approvedBriefBasis) !==
      deterministicJson(currentBriefBasis)
  ) {
    throw invalidTransition(
      "The L4 work was not appended on the exact current Thread tip under the current approved Brief basis.",
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw invalidTransition(
      "This executor may continue only the exact L4 run it claimed.",
    );
  }
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (!work || work.decisionIds.length !== 1) {
    throw invalidTransition("The L4 work must name exactly one human MRTR decision.");
  }
  const basis = requireBasis(run);
  const decision = project.decisions.find((item) =>
    item.id === work.decisionIds[0] && item.status === "approved"
  );
  if (
    !decision?.proposal || !decision.inputFingerprint ||
    decision.phaseId !== work.phaseId
  ) {
    throw invalidTransition("The exact L4 MRTR decision is not human-approved.");
  }
  const approvals = project.approvals.filter((approval: EngineeringApproval) =>
    approval.decisionId === decision.id && approval.status === "approved" &&
    decision.approvalIds.includes(approval.id) &&
    approval.decidedByOrigin === "human" &&
    typeof approval.decidedBy === "string" && approval.decidedBy.trim().length > 0 &&
    typeof approval.decidedAt === "string" &&
    !Number.isNaN(Date.parse(approval.decidedAt)) &&
    sameSnapshotBasis(approval.baseSnapshot, basis) &&
    sameEvidenceRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  );
  if (approvals.length !== 1 || !sameSnapshotBasis(decision.baseSnapshot, basis)) {
    throw invalidTransition(
      "No exact human-approved L4 MRTR decision is bound to this run basis.",
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
      "The L4 MRTR decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: work.id,
    basis,
    operation: work.operation,
    approvedDecisions: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The L4 run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return { decision, proposal: decision.proposal };
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): AssemblyIntegrityEvaluationAdmission {
  try {
    return parseAssemblyIntegrityEvaluationAdmissionParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Assembly-integrity evaluation MRTR parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertAdmissionScope(
  admission: AssemblyIntegrityEvaluationAdmission,
  projectId: string,
  basis: ReturnType<typeof requireBasis>,
  capture: AssemblyIntegrityEvaluationCapture,
): void {
  if (
    admission.projectId !== projectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision ||
    admission.basis.subjectId !== basis.subjectId ||
    admission.observation.artifactId !== capture.observation.artifactId ||
    !fingerprintsEqual(
      admission.observation.fingerprint,
      capture.observation.fingerprint,
    ) ||
    !fingerprintsEqual(
      admission.observation.observationFingerprint,
      capture.observation.observationFingerprint,
    ) ||
    admission.geometryModule.artifactId !== capture.geometryModule.artifactId ||
    !fingerprintsEqual(
      admission.geometryModule.fingerprint,
      capture.geometryModule.fingerprint,
    ) ||
    admission.assemblyStep.artifactId !== capture.assemblyStep.artifactId ||
    !fingerprintsEqual(
      admission.assemblyStep.fingerprint,
      capture.assemblyStep.fingerprint,
    ) ||
    admission.inputBundle.schemaVersion !== capture.inputBundle.schemaVersion ||
    admission.inputBundle.byteCount !== capture.inputBundle.byteCount ||
    !fingerprintsEqual(
      admission.inputBundle.fingerprint,
      capture.inputBundle.fingerprint,
    ) ||
    admission.method.schemaVersion !== capture.method.schemaVersion ||
    admission.method.id !== capture.method.id ||
    admission.method.version !== capture.method.version ||
    !fingerprintsEqual(admission.method.fingerprint, capture.method.fingerprint)
  ) {
    throw invalidTransition(
      "The signed L4 admission diverges from the exact server-recrossed capture.",
    );
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly run: EngineeringAgentRun;
  readonly capture: AssemblyIntegrityEvaluationCapture;
  readonly artifactInputs: readonly {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  }[];
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const evaluatedAt = requiredStart(input.run);
  if (
    input.capture.trustedRunId !== input.run.id ||
    input.capture.evaluatedAt !== evaluatedAt ||
    input.capture.basis.snapshotId !== input.basisSnapshot.id ||
    input.capture.basis.revision !== input.basisSnapshot.revision ||
    input.capture.basis.subjectId !== input.basisSnapshot.subject.id ||
    input.captureUri !==
      assemblyIntegrityEvaluationCaptureUri(input.captureFingerprint.digest) ||
    deterministicJson(input.artifactInputs) !==
      deterministicJson(captureArtifactInputs(input.capture))
  ) {
    throw invalidTransition(
      "The L4 custom capture does not match its exact trusted run, basis, and artifact inputs.",
    );
  }
  const inputs = exactInputArtifacts(input.basisSnapshot, input.artifactInputs);
  const producer = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version}`,
    runId: input.run.id,
  } as const;
  const artifact: ThreadArtifact = {
    id: `assembly-integrity-evaluation-${input.captureFingerprint.digest}`,
    name: "Assembly integrity evaluation",
    kind: "evidence",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: inputs.map((item) => item.id),
    freshness: { status: "fresh", changedAt: evaluatedAt, invalidatedByChangeIds: [] },
  };
  const consumptions: ThreadArtifactConsumption[] = inputs.map((upstream) => ({
    id: `verify-evaluate-assembly-integrity-${input.run.id}:consume:${upstream.id}`,
    artifactId: upstream.id,
    consumer: producer,
    observedFingerprint: upstream.fingerprint,
    verifiedAt: evaluatedAt,
    status: "verified",
  }));
  const extension: ThreadSnapshotExtension = {
    id: `verify-evaluate-assembly-integrity-${input.run.id}`,
    name: "Capture the provider-free assembly-integrity evaluation",
    subjectId: input.basisSnapshot.subject.id,
    capturedAt: evaluatedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    // Deliberately no generic SysML RequirementEvaluation: the L4 verdict is
    // carried only by the custom capture because a dimensionless `1` is not a
    // qualified requirement quantity.
    evaluations: [],
    violations: [],
    provenance: inputs.flatMap((upstream) => {
      const consumptionId =
        `verify-evaluate-assembly-integrity-${input.run.id}:consume:${upstream.id}`;
      return [{
        id:
          `verify-evaluate-assembly-integrity-${input.run.id}:derived-from:${upstream.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: upstream.id },
        rationale:
          "The custom L4 evaluation reread this exact server-selected input artifact.",
      }, {
        id: `verify-evaluate-assembly-integrity-${input.run.id}:uses:${upstream.id}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: upstream.id },
        rationale: "The provider-free L4 evaluator verified this input fingerprint.",
      }];
    }),
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(input.basisSnapshot, extension, {
    appliedAt: evaluatedAt,
  });
  if (!applied.applied) {
    throw invalidTransition(
      "This exact L4 evaluation artifact is already present on the basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

function captureArtifactInputs(
  capture: AssemblyIntegrityEvaluationCapture,
): readonly { readonly id: string; readonly fingerprint: ContentFingerprint }[] {
  return [
    {
      id: capture.geometryModule.artifactId,
      fingerprint: capture.geometryModule.fingerprint,
    },
    {
      id: capture.assemblyStep.artifactId,
      fingerprint: capture.assemblyStep.fingerprint,
    },
    {
      id: capture.observation.artifactId,
      fingerprint: capture.observation.fingerprint,
    },
  ];
}

function exactInputArtifacts(
  basis: ThreadSnapshot,
  references: readonly {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  }[],
): readonly ThreadArtifact[] {
  if (references.length !== 3) {
    throw invalidTransition(
      "The L4 capture must retain exactly module, STEP, and L3 observation inputs.",
    );
  }
  const used = new Set<string>();
  const archived = archivedRefKeys(basis);
  return references.map((reference) => {
    if (used.has(reference.id)) {
      throw invalidTransition("The L4 capture repeats an input artifact identity.");
    }
    used.add(reference.id);
    const matches = basis.artifacts.filter((artifact) => artifact.id === reference.id);
    if (
      matches.length !== 1 || matches[0]!.freshness.status !== "fresh" ||
      archived.has(`artifact:${reference.id}`) ||
      !fingerprintsEqual(matches[0]!.fingerprint, reference.fingerprint)
    ) {
      throw invalidTransition(
        "The L4 capture names an absent, stale, or inexact artifact input on its basis.",
      );
    }
    return matches[0]!;
  });
}

async function exactBasisSnapshot(
  snapshots: AssemblyIntegrityEvaluationThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition("The exact L4 Thread basis snapshot is unavailable.");
  }
  return validateThreadSnapshot(snapshot);
}

async function requiredCapture(
  captures: AssemblyIntegrityEvaluationCaptureStore,
  fingerprint: ContentFingerprint,
): Promise<AssemblyIntegrityEvaluationCapture> {
  const capture = await captures.read(fingerprint);
  if (!capture) throw invalidTransition("The exact custom L4 capture is unavailable.");
  const parsed = await validateAssemblyIntegrityEvaluationCapture(capture);
  const actual = await fingerprintAssemblyIntegrityEvaluationCapture(parsed);
  if (!fingerprintsEqual(actual, fingerprint)) {
    throw invalidTransition(
      "The exact custom L4 capture fingerprint no longer matches its content.",
    );
  }
  return parsed;
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
    summary: COMPLETE_SUMMARY,
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id && reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !work || declared.length !== 1 || run.evidenceRefs.length !== 1 ||
    work.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, work.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed L4 run is not attached to exactly one declared custom evidence artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed L4 evidence reference is not its custom result artifact.",
    );
  }
  return evidence;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function sameSnapshotBasis(
  value: unknown,
  basis: ReturnType<typeof requireBasis>,
): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    readonly snapshotId?: unknown;
    readonly revision?: unknown;
    readonly subjectId?: unknown;
  };
  return candidate.snapshotId === basis.snapshotId &&
    candidate.revision === basis.revision && candidate.subjectId === basis.subjectId;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-evaluate-assembly-integrity:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
