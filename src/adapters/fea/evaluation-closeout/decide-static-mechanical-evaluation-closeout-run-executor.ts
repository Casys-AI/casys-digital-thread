/**
 * Human-decision, provider-free L5 static-mechanical closeout executor.
 *
 * The human-signed MRTR contains a closed admission. This executor reopens the
 * exact FEA @3 branch, recrosses every identity (including the proof boundary
 * limitations), then writes one documentary Thread successor. A registered
 * agent dispatches the run lifecycle after the exact human MRTR approval;
 * dispatch is not the L5 disposition. It has no CalculiX, SysON, MCP, or
 * correction/CAD dispatch dependency.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
  parseStaticMechanicalEvaluationCloseoutParameters,
  type StaticMechanicalEvaluationCloseoutAdmission,
  type StaticMechanicalEvaluationCloseoutOperation,
} from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
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
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadOperationRef,
  ThreadProvenanceLink,
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
import {
  resolveStaticMechanicalCloseoutEvidence,
  staticMechanicalCloseoutAdmission,
  type StaticMechanicalCloseoutEvidenceResolverDependencies,
  StaticMechanicalCloseoutResolutionError,
} from "./static-mechanical-closeout-evidence-resolver.ts";
import {
  canonicalStaticMechanicalEvaluationCloseoutCaptureText,
  EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
  type StaticMechanicalEvaluationCloseoutCapture,
  validateStaticMechanicalEvaluationCloseoutCapture,
} from "./static-mechanical-evaluation-closeout-capture.ts";

export {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
};

export interface StaticMechanicalCloseoutSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface StaticMechanicalCloseoutCaptureStore {
  save(fingerprint: ContentFingerprint, canonicalText: string): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface DecideStaticMechanicalEvaluationCloseoutRunExecutorDependencies
  extends StaticMechanicalCloseoutEvidenceResolverDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: StaticMechanicalCloseoutSnapshotStore;
  readonly closeoutCaptures: StaticMechanicalCloseoutCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class DecideStaticMechanicalEvaluationCloseoutRunExecutor {
  constructor(
    private readonly dependencies:
      DecideStaticMechanicalEvaluationCloseoutRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only the registered agent dispatcher can execute a static-mechanical closeout run after an exact human-signed MRTR disposition. An L4 pass is not L5.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const operation = requireCloseoutShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters, operation);
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.executeLeased(origin, command, approval.decision, admission),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: StaticMechanicalEvaluationCloseoutAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotPersisted = false;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      const operation = requireCloseoutShape(project, run);
      const completed = await this.completedFor(
        origin,
        command,
        approvedDecision,
        admission,
      );
      if (completed) return completed;
      if (
        run.status !== "queued" && run.status !== "running" &&
        run.status !== "publishing"
      ) {
        throw unexpectedStatus(
          run,
          "queued or this agent dispatcher's running/publishing",
        );
      }
      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(
        this.dependencies.snapshots,
        basis,
      );
      await assertThreadSnapshotLineageIntact(
        basisSnapshot,
        this.dependencies.snapshots,
      );
      await recrossSignedAdmission(
        this.dependencies,
        project,
        basis,
        basisSnapshot,
        admission,
        operation,
      );

      if (run.status === "queued") {
        await this.dependencies.commands.claimRun(
          origin,
          claimCommand(command, operation),
        );
        claimed = true;
      } else {
        requireClaimedByDispatcher(project, run, origin);
        assertPriorClaim(project, command, operation, origin);
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedByDispatcher(project, run, origin);
      if (run.status === "completed") {
        const replayed = await this.completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (replayed) return replayed;
        throw unexpectedStatus(run, "running or publishing");
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The exact human closeout decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(
        currentApproval.proposal.parameters,
        operation,
      );
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The signed static-mechanical closeout admission changed after claim.",
        );
      }
      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.dependencies.snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(
        currentBasisSnapshot,
        this.dependencies.snapshots,
      );
      await recrossSignedAdmission(
        this.dependencies,
        project,
        currentBasis,
        currentBasisSnapshot,
        currentAdmission,
        operation,
      );

      const persisted = run.status === "publishing"
        ? await this.reopenCapture(
          run,
          operation,
          currentApproval.decision.id,
          currentAdmission,
        )
        : await this.persistCapture(
          run,
          operation,
          currentApproval.decision.id,
          currentAdmission,
        );
      const successor = buildSuccessor({
        basisSnapshot: currentBasisSnapshot,
        run,
        operation,
        capture: persisted.capture,
        captureFingerprint: persisted.fingerprint,
        captureUri: this.dependencies.closeoutCaptures.uriFor(persisted.fingerprint),
      });
      if (run.status === "publishing") {
        await assertSavedSnapshot(this.dependencies.snapshots, successor.snapshot);
      } else {
        await this.dependencies.snapshots.save(successor.snapshot);
        await assertSavedSnapshot(this.dependencies.snapshots, successor.snapshot);
      }
      snapshotPersisted = true;

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.dependencies.commands.publishRun(
          origin,
          publishCommand(command, operation, project.revision),
        );
      } else if (run.status === "publishing") {
        assertPriorPublish(project, command, operation, origin);
      } else if (run.status === "completed") {
        const replayed = await this.completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (replayed) return replayed;
        throw unexpectedStatus(run, "publishing or completed");
      } else {
        throw unexpectedStatus(run, "running or publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.dependencies.commands.completeRun(
          origin,
          completionCommand(command, operation, project.revision, successor),
        );
      } else if (run.status === "completed") {
        assertPriorCompletion(project, command, operation, origin, successor);
      } else {
        throw unexpectedStatus(run, "publishing or completed");
      }
      const complete = await this.requiredProject(command.projectId);
      await this.assertCompletedEvidence(
        origin,
        complete,
        command,
        currentApproval.decision,
        currentAdmission,
      );
      return complete;
    } catch (error) {
      if (snapshotPersisted) {
        const completed = await this.completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (completed) return completed;
      }
      if (claimed && !snapshotPersisted) {
        await this.failUnpublishedBestEffort(origin, command, error);
      }
      throw error;
    }
  }

  private async persistCapture(
    run: EngineeringAgentRun,
    operation: StaticMechanicalEvaluationCloseoutOperation,
    decisionId: string,
    admission: StaticMechanicalEvaluationCloseoutAdmission,
  ): Promise<
    {
      readonly capture: StaticMechanicalEvaluationCloseoutCapture;
      readonly fingerprint: ContentFingerprint;
    }
  > {
    const capture = closeoutCapture(run, operation, decisionId, admission);
    const text = canonicalStaticMechanicalEvaluationCloseoutCaptureText(capture);
    const fingerprint = await sha256Fingerprint(capture);
    await this.dependencies.closeoutCaptures.save(fingerprint, text);
    const readback = await this.dependencies.closeoutCaptures.read(fingerprint);
    if (readback !== text) {
      throw invalidTransition(
        "The static-mechanical closeout capture was not durably readable after save.",
      );
    }
    return {
      capture: validateStaticMechanicalEvaluationCloseoutCapture(JSON.parse(readback)),
      fingerprint,
    };
  }

  private async reopenCapture(
    run: EngineeringAgentRun,
    operation: StaticMechanicalEvaluationCloseoutOperation,
    decisionId: string,
    admission: StaticMechanicalEvaluationCloseoutAdmission,
  ): Promise<
    {
      readonly capture: StaticMechanicalEvaluationCloseoutCapture;
      readonly fingerprint: ContentFingerprint;
    }
  > {
    const expected = closeoutCapture(run, operation, decisionId, admission);
    const text = canonicalStaticMechanicalEvaluationCloseoutCaptureText(expected);
    const fingerprint = await sha256Fingerprint(expected);
    const readback = await this.dependencies.closeoutCaptures.read(fingerprint);
    if (readback !== text) {
      throw invalidTransition(
        "The publishing static-mechanical closeout has no exact durable capture to replay.",
      );
    }
    return {
      capture: validateStaticMechanicalEvaluationCloseoutCapture(JSON.parse(readback)),
      fingerprint,
    };
  }

  private async failUnpublishedBestEffort(
    origin: EngineeringProjectCommandOrigin,
    command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
    cause: unknown,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      const operation = requireCloseoutShape(project, run);
      if (run.status !== "running") return;
      await this.dependencies.commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, operation, "fail"),
        expectedRevision: project.revision,
        summary: closeoutSummary(operation, "failed"),
        code: `${operation.id.replaceAll(".", "-")}-thread-write-outcome-unknown`,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {
      // The original integrity failure remains authoritative.
    }
  }

  /**
   * A completed run is never a blind idempotent success. Its immutable claim,
   * publish, and complete receipts are replayed while every persisted closeout
   * fact is reconstructed from the immutable basis and local CAS.
   */
  private async completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: StaticMechanicalEvaluationCloseoutAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    const replayed = await this.requiredProject(command.projectId);
    await this.assertCompletedEvidence(
      origin,
      replayed,
      command,
      approvedDecision,
      admission,
    );
    return replayed;
  }

  private async assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: StaticMechanicalEvaluationCloseoutAdmission,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const operation = requireCloseoutShape(project, run);
    if (run.status !== "completed" || !run.resultSnapshot) {
      throw invalidTransition(
        `Static-mechanical closeout run ${command.runId} did not complete through this exact command.`,
      );
    }
    requireClaimedByDispatcher(project, run, origin);
    // The command service reopens the immutable historical claim receipt and
    // rejects a changed command id, actor, issue time, or expected revision.
    await this.dependencies.commands.claimRun(origin, claimCommand(command, operation));
    const currentApproval = await requireMrtrApproval(project, run);
    if (currentApproval.decision.id !== approvedDecision.id) {
      throw invalidTransition(
        "The completed static-mechanical closeout decision changed after approval.",
      );
    }
    const currentAdmission = parseAdmission(
      currentApproval.proposal.parameters,
      operation,
    );
    if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
      throw invalidTransition(
        "The completed static-mechanical closeout admission changed after approval.",
      );
    }
    const basis = requireBasis(run);
    const result = run.resultSnapshot;
    const snapshot = this.dependencies.snapshots.getFresh === undefined
      ? await this.dependencies.snapshots.get(result.snapshotId)
      : await this.dependencies.snapshots.getFresh(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      result.subjectId !== basis.subjectId ||
      result.revision !== basis.revision + 1 ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed static-mechanical closeout does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    await assertThreadSnapshotLineageIntact(
      validatedSnapshot,
      this.dependencies.snapshots,
    );
    const basisSnapshot = await exactBasisSnapshot(this.dependencies.snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.dependencies.snapshots);
    await recrossSignedAdmission(
      this.dependencies,
      project,
      basis,
      basisSnapshot,
      currentAdmission,
      operation,
    );
    const persisted = await this.reopenCapture(
      run,
      operation,
      currentApproval.decision.id,
      currentAdmission,
    );
    const expected = buildSuccessor({
      basisSnapshot,
      run,
      operation,
      capture: persisted.capture,
      captureFingerprint: persisted.fingerprint,
      captureUri: this.dependencies.closeoutCaptures.uriFor(persisted.fingerprint),
    });
    const evidence = exactCompletedEvidence(project, run, validatedSnapshot);
    if (
      evidence.id !== expected.artifact.id ||
      deterministicJson(validatedSnapshot) !== deterministicJson(expected.snapshot)
    ) {
      throw invalidTransition(
        "The completed static-mechanical closeout successor no longer equals the exact deterministic snapshot reconstructed from its basis and capture.",
      );
    }
    const publishReceipt = exactRunReceipt(
      project,
      commandStep(command.commandId, operation, "publish"),
      "agent-run.publish",
      origin,
    );
    await this.dependencies.commands.publishRun(
      origin,
      publishCommand(
        command,
        operation,
        publishReceipt.resultingSnapshot.revision - 1,
      ),
    );
    const completionReceipt = exactRunReceipt(
      project,
      commandStep(command.commandId, operation, "complete"),
      "agent-run.complete",
      origin,
    );
    await this.dependencies.commands.completeRun(
      origin,
      completionCommand(
        command,
        operation,
        completionReceipt.resultingSnapshot.revision - 1,
        expected,
      ),
    );
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.dependencies.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

async function recrossSignedAdmission(
  dependencies: StaticMechanicalCloseoutEvidenceResolverDependencies,
  project: EngineeringProjectSnapshot,
  basis: ReturnType<typeof requireBasis>,
  snapshot: ThreadSnapshot,
  admission: StaticMechanicalEvaluationCloseoutAdmission,
  operation: StaticMechanicalEvaluationCloseoutOperation,
): Promise<void> {
  if (
    admission.projectId !== project.project.id ||
    admission.subjectId !== basis.subjectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision
  ) {
    throw invalidTransition(
      "The signed closeout project or Thread basis is not the executing run basis.",
    );
  }
  const actualFingerprint = await sha256Fingerprint(snapshot);
  if (!fingerprintsEqual(actualFingerprint, admission.basis.fingerprint)) {
    throw invalidTransition("The signed static-mechanical closeout basis is stale.");
  }
  try {
    const resolved = await resolveStaticMechanicalCloseoutEvidence(dependencies, {
      project,
      basis,
      snapshot,
    });
    const expected = staticMechanicalCloseoutAdmission(
      resolved,
      operation.id === DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id
        ? "accept"
        : "reject",
    );
    if (deterministicJson(expected) !== deterministicJson(admission)) {
      throw invalidTransition(
        "The signed static-mechanical closeout no longer matches the exact STEP/proof/execution/L4 criteria or sealed proof limitations.",
      );
    }
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    if (error instanceof StaticMechanicalCloseoutResolutionError) {
      throw invalidTransition(
        `The signed static-mechanical closeout cannot be recrossed: ${error.message}`,
      );
    }
    throw invalidTransition(error instanceof Error ? error.message : String(error));
  }
}

function closeoutCapture(
  run: EngineeringAgentRun,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  decisionId: string,
  admission: StaticMechanicalEvaluationCloseoutAdmission,
): StaticMechanicalEvaluationCloseoutCapture {
  return validateStaticMechanicalEvaluationCloseoutCapture({
    schemaVersion: EVALUATION_CLOSEOUT_CAPTURE_SCHEMA,
    kind: "static-mechanical-evaluation-closeout",
    operation,
    trustedRunId: run.id,
    decisionId,
    sealedAt: requiredStart(run),
    admission,
    inputs: {
      canonicalStep: admission.canonicalStep,
      sealedProof: admission.sealedProof,
      executionEvidence: admission.executionEvidence,
      evaluationCapture: admission.evaluationCapture,
    },
    proofLimitations: admission.proofLimitations,
    limits: admission.limits,
  });
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly run: EngineeringAgentRun;
  readonly operation: StaticMechanicalEvaluationCloseoutOperation;
  readonly capture: StaticMechanicalEvaluationCloseoutCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const admission = input.capture.admission;
  const operationRef: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: `${input.operation.id}@${input.operation.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: `evaluation-closeout-${input.captureFingerprint.digest}`,
    name: admission.consequence === "accept"
      ? "Accepted static-mechanical evaluation closeout"
      : "Rejected static-mechanical evaluation closeout",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [
      admission.canonicalStep.id,
      admission.sealedProof.id,
      admission.executionEvidence.id,
      admission.evaluationCapture.id,
    ],
    freshness: {
      status: "fresh",
      changedAt: input.capture.sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const inputs = [
    admission.canonicalStep,
    admission.sealedProof,
    admission.executionEvidence,
    admission.evaluationCapture,
  ];
  const consumptions: ThreadArtifactConsumption[] = inputs.map((identity) => ({
    id: `consume-${identity.id}-by-${artifact.id}`,
    artifactId: identity.id,
    consumer: operationRef,
    observedFingerprint: identity.fingerprint,
    verifiedAt: input.capture.sealedAt,
    status: "verified",
  }));
  const provenance: ThreadProvenanceLink[] = [
    ...inputs.map((identity) => ({
      id: `${artifact.id}-derived-from-${identity.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: identity.id },
      rationale:
        "The human closeout document names this exact reopened evidence identity.",
    })),
    ...consumptions.map((consumption) => ({
      id: `${consumption.id}-uses`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumption.id },
      to: { kind: "artifact" as const, id: consumption.artifactId },
      rationale:
        "The closeout executor reread and fingerprint-attested the exact input.",
    })),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `${input.operation.id.replaceAll(".", "-")}-${input.run.id}`,
    name: admission.consequence === "accept"
      ? "Human accept static-mechanical evaluation closeout"
      : "Human reject static-mechanical evaluation closeout",
    subjectId: input.basisSnapshot.subject.id,
    capturedAt: input.capture.sealedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    // A reject records only `none` or `mechanical-review-required` in the
    // capture; it creates no correction/CAD/FEA proposal or execution grant.
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: input.capture.sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "The exact static-mechanical closeout is already present in its own basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

function requireCloseoutShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): StaticMechanicalEvaluationCloseoutOperation {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const operation = closeoutOperationOf(work?.operation);
  if (
    run.basis?.kind !== "thread-snapshot" || !work ||
    !operation || work.operation?.bindings.length !== 1 ||
    work.operation.bindings[0]?.name !== "approvedBrief" ||
    work.operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not a human static-mechanical closeout with the sole approvedBrief binding.`,
    );
  }
  return operation;
}

function closeoutOperationOf(
  operation: { readonly id: string; readonly version: string } | undefined,
): StaticMechanicalEvaluationCloseoutOperation | undefined {
  if (
    operation?.id === DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id &&
    operation.version === DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version
  ) return DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION;
  if (
    operation?.id === DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id &&
    operation.version === DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.version
  ) return DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION;
  return undefined;
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<
  {
    readonly decision: EngineeringDecision;
    readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  }
> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (!work) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<
    {
      decision: EngineeringDecision;
      proposal: NonNullable<EngineeringDecision["proposal"]>;
    }
  > = [];
  for (const decisionId of work.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (
      !decision?.proposal || !decision.inputFingerprint ||
      !sameSnapshotBasis(decision.baseSnapshot, basis)
    ) continue;
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
    if (approvals.length === 1) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved static-mechanical closeout is bound to this run basis."
        : "Exactly one human-approved static-mechanical closeout decision is required.",
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
      "The closeout decision fingerprint does not seal its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = work.decisionIds.map((id) => {
    const decision = project.decisions.find((item) => item.id === id);
    if (!decision?.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: work.id,
    basis,
    operation: {
      id: work.operation?.id,
      version: work.operation?.version,
      bindings: work.operation?.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The closeout run fingerprint does not seal its exact MRTR and basis.",
    );
  }
  return selected;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: ReturnType<typeof requireBasis>,
): boolean {
  return !!value && "snapshotId" in value && value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision && value.subjectId === basis.subjectId;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (item: EngineeringThreadEntityRef) =>
    deterministicJson({
      snapshotId: item.snapshotId,
      snapshotRevision: item.snapshotRevision,
      kind: item.kind,
      id: item.id,
    });
  const a = [...left.map(key)].sort();
  const b = [...right.map(key)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
  operation: StaticMechanicalEvaluationCloseoutOperation,
): StaticMechanicalEvaluationCloseoutAdmission {
  try {
    return parseStaticMechanicalEvaluationCloseoutParameters(parameters, operation);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Static-mechanical closeout parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: StaticMechanicalCloseoutSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = snapshots.getFresh === undefined
    ? await snapshots.get(basis.snapshotId)
    : await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is unavailable for the static-mechanical closeout.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

async function assertSavedSnapshot(
  snapshots: StaticMechanicalCloseoutSnapshotStore,
  expected: ThreadSnapshot,
): Promise<void> {
  const saved = snapshots.getFresh === undefined
    ? await snapshots.get(expected.id)
    : await snapshots.getFresh(expected.id);
  if (!saved || deterministicJson(saved) !== deterministicJson(expected)) {
    throw invalidTransition(
      "The static-mechanical closeout Thread successor was not durably readable.",
    );
  }
}

/**
 * The authenticated agent owns only run lifecycle transitions. The distinct
 * MRTR check above is the authority boundary for the human L5 disposition.
 */
function requireClaimedByDispatcher(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireCloseoutShape(project, run);
  if (
    origin.kind !== "agent" || run.claimedBy?.origin !== "agent" ||
    run.claimedBy.id !== origin.actorId
  ) {
    throw invalidTransition(
      "Only the exact registered agent dispatcher that claimed this static-mechanical closeout may continue its run lifecycle.",
    );
  }
}

function claimCommand(
  command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  operation: StaticMechanicalEvaluationCloseoutOperation,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "claim"),
    summary: closeoutSummary(operation, "started"),
  };
}

function publishCommand(
  command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  expectedRevision: number,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "publish"),
    expectedRevision,
    summary: closeoutSummary(operation, "publishing"),
  };
}

function completionCommand(
  command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  expectedRevision: number,
  successor: { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact },
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "complete"),
    expectedRevision,
    summary: closeoutSummary(operation, "completed"),
    resultSnapshot: snapshotRef(successor.snapshot),
    evidenceRefs: [{
      snapshotId: successor.snapshot.id,
      snapshotRevision: successor.snapshot.revision,
      kind: "artifact",
      id: successor.artifact.id,
    }],
  };
}

function closeoutSummary(
  operation: StaticMechanicalEvaluationCloseoutOperation,
  phase: "started" | "publishing" | "completed" | "failed",
): string {
  const verb = operation.id === DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id
    ? "accept"
    : "reject";
  if (phase === "started") {
    return `Started the human ${verb} static-mechanical L5 closeout.`;
  }
  if (phase === "publishing") {
    return `Publishing the human ${verb} static-mechanical L5 closeout.`;
  }
  if (phase === "completed") {
    return `Recorded the human ${verb} static-mechanical L5 closeout.`;
  }
  return `Static-mechanical ${verb} closeout stopped before Thread publication.`;
}

function commandStep(
  commandId: string,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  step: string,
): string {
  return `${commandId}:${operation.id}@${operation.version}:${step}`;
}

function assertPriorClaim(
  project: EngineeringProjectSnapshot,
  command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  origin: EngineeringProjectCommandOrigin,
): void {
  assertReceipt(
    project,
    commandStep(command.commandId, operation, "claim"),
    "agent-run.claim",
    origin,
  );
}

function assertPriorPublish(
  project: EngineeringProjectSnapshot,
  command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  origin: EngineeringProjectCommandOrigin,
): void {
  assertReceipt(
    project,
    commandStep(command.commandId, operation, "publish"),
    "agent-run.publish",
    origin,
  );
}

function assertPriorCompletion(
  project: EngineeringProjectSnapshot,
  command: DecideStaticMechanicalEvaluationCloseoutRunExecutorCommand,
  operation: StaticMechanicalEvaluationCloseoutOperation,
  origin: EngineeringProjectCommandOrigin,
  successor: { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact },
): void {
  assertReceipt(
    project,
    commandStep(command.commandId, operation, "complete"),
    "agent-run.complete",
    origin,
  );
  const run = requireRun(project, command.runId);
  if (
    deterministicJson(run.resultSnapshot) !==
      deterministicJson(snapshotRef(successor.snapshot)) ||
    deterministicJson(run.evidenceRefs) !== deterministicJson([{
        snapshotId: successor.snapshot.id,
        snapshotRevision: successor.snapshot.revision,
        kind: "artifact",
        id: successor.artifact.id,
      }])
  ) {
    throw invalidTransition(
      "The replayed static-mechanical closeout completion does not bind its exact successor.",
    );
  }
}

/** Exact project/run/work attachment for the one documentary closeout artifact. */
function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const result = run.resultSnapshot;
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id && reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !result || !work || work.status !== "completed" || declared.length !== 1 ||
    result.snapshotId !== snapshot.id || result.revision !== snapshot.revision ||
    result.subjectId !== snapshot.subject.id || run.evidenceRefs.length !== 1 ||
    work.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, work.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed static-mechanical closeout is not attached to exactly one declared snapshot and document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed static-mechanical closeout evidence reference is not its exact document artifact.",
    );
  }
  return evidence;
}

function exactRunReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== type ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId
  ) {
    throw invalidTransition(
      `The static-mechanical closeout has no exact ${type} receipt for replay.`,
    );
  }
  return receipt;
}

function assertReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
): void {
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ?? [];
  if (
    matches.length !== 1 || matches[0]?.type !== type ||
    matches[0].actor.origin !== origin.kind || matches[0].actor.id !== origin.actorId
  ) {
    throw invalidTransition(
      `The static-mechanical closeout has no exact ${type} receipt for replay.`,
    );
  }
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
