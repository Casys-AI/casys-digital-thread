/**
 * Human-only executor for L5 closeout of one L4 admitted SPICE evaluation.
 *
 * It recrosses the same shared L4 evidence resolver as the closeout review,
 * then writes a documentary closeout. It never calls ngspice or SysON. An L4
 * `pass` is never implicit L5. The review result is not authority.
 *
 * Authority follows the hardened L4 / FEA pattern: exact Thread basis
 * including revision and subject, one human approval bound by evidence and
 * fingerprint equality, decision reseal, and run-input fingerprint
 * verification. A provider-free first pass accepts `queued` only. Hard-crash
 * recovery accepts only the same human's `running` / `publishing` state,
 * replays the exact persisted claim/publish receipts, reopens the
 * deterministic closeout capture, and completes without a second publish.
 */

import type { EngineeringProjectCommandOrigin } from "../../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type RunCommand,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  parseSpiceAdmittedObservationEvaluationCloseoutParameters,
  type SpiceAdmittedObservationEvaluationCloseoutAdmission,
  type SpiceAdmittedObservationEvaluationCloseoutOperation,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  admittedSpiceEvaluationCloseoutAdmission,
  type AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
  AdmittedSpiceEvaluationCloseoutResolutionError,
  resolveAdmittedSpiceEvaluationCloseoutEvidence,
} from "./admitted-spice-observation-evaluation-closeout-evidence-resolver.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../../shared/thread-write-basis-guard.ts";
import { SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX } from "./admitted-spice-observation-evaluation-capture.ts";
import {
  canonicalSpiceAdmittedObservationEvaluationCloseoutCaptureText,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
  type SpiceAdmittedObservationEvaluationCloseoutCapture,
  validateSpiceAdmittedObservationEvaluationCloseoutCapture,
} from "./admitted-spice-observation-evaluation-closeout-capture.ts";

export {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
};

export interface CloseoutThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface SpiceAdmittedObservationEvaluationCloseoutCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface DecideAdmittedSpiceEvaluationRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface DecideAdmittedSpiceEvaluationRunExecutorDependencies
  extends AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: CloseoutThreadSnapshotStore;
  readonly closeoutCaptures: SpiceAdmittedObservationEvaluationCloseoutCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class DecideAdmittedSpiceEvaluationRunExecutor {
  constructor(
    private readonly dependencies: DecideAdmittedSpiceEvaluationRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "human") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only a human operator can execute an admitted SPICE evaluation closeout. " +
          "An L4 pass is not L5.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const operation = requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters, operation);
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let publicationStarted = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      const operation = requireShape(project, run);
      publicationStarted = run.status === "publishing";
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
      await recrossAdmission(
        command,
        project,
        admission,
        basis,
        basisSnapshot,
        this.dependencies,
      );

      const firstClaim = run.status === "queued";
      if (firstClaim) {
        await this.dependencies.commands.claimRun(
          origin,
          claimCommand(command, operation, admission.consequence),
        );
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#replayClaim(origin, command, operation, admission);
      } else {
        throw unexpectedStatus(
          run,
          "queued or this human's running/publishing",
        );
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The human-approved admitted SPICE evaluation closeout decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(
        currentApproval.proposal.parameters,
        operation,
      );
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed admitted SPICE evaluation closeout parameters changed after the run was claimed.",
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
      await recrossAdmission(
        command,
        project,
        currentAdmission,
        currentBasis,
        currentBasisSnapshot,
        this.dependencies,
      );
      if (run.status === "publishing") {
        return await this.#resumePublishing(
          origin,
          command,
          operation,
          currentApproval.decision,
          currentAdmission,
          currentBasisSnapshot,
          run,
        );
      }

      const persisted = await this.#persistCloseoutCapture(
        run,
        operation,
        currentApproval.decision.id,
        currentAdmission,
      );
      const successor = buildSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        operation,
        capture: persisted.capture,
        captureFingerprint: persisted.captureFingerprint,
      });
      await this.dependencies.snapshots.save(successor.snapshot);
      publicationStarted = true;

      project = await this.#requiredProject(command.projectId);
      await this.#publishExact(
        origin,
        project,
        command,
        operation,
        currentAdmission,
      );
      project = await this.#requiredProject(command.projectId);
      await this.#completeExact(
        origin,
        project,
        command,
        operation,
        currentAdmission,
        successor,
      );
      return await this.#requiredProject(command.projectId);
    } catch (error) {
      if (claimed && !publicationStarted) {
        try {
          const failed = await this.#requiredProject(command.projectId);
          const failedRun = requireRun(failed, command.runId);
          if (failedRun.status === "running") {
            const failedWork = failed.workItems.find((item) =>
              item.id === failedRun.workItemId
            );
            const failedOperation = closeoutOperationOf(failedWork?.operation) ??
              DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION;
            await this.dependencies.commands.failRun(origin, {
              ...command,
              commandId: commandStep(command.commandId, failedOperation, "fail"),
              expectedRevision: failed.revision,
              summary:
                "Admitted SPICE evaluation closeout stopped before Thread publication.",
              code: `${failedOperation.id.replaceAll(".", "-")}-not-published`,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    }
  }

  async #resumePublishing(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
    operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
    approvedDecision: EngineeringDecision,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
    basisSnapshot: ThreadSnapshot,
    run: EngineeringAgentRun,
  ): Promise<EngineeringProjectSnapshot> {
    const persisted = await this.#reopenCloseoutCapture(
      run,
      operation,
      approvedDecision.id,
      admission,
    );
    const successor = buildSuccessor({
      basisSnapshot,
      basis: requireBasis(run),
      run,
      operation,
      capture: persisted.capture,
      captureFingerprint: persisted.captureFingerprint,
    });
    await this.#assertSavedSuccessor(successor.snapshot);
    let project = await this.#requiredProject(command.projectId);
    await this.#publishExact(origin, project, command, operation, admission);
    project = await this.#requiredProject(command.projectId);
    await this.#completeExact(
      origin,
      project,
      command,
      operation,
      admission,
      successor,
    );
    return await this.#requiredProject(command.projectId);
  }

  async #replayClaim(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
    operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  ): Promise<void> {
    const project = await this.#requiredProject(command.projectId);
    const receipt = exactCommandReceipt(
      project,
      commandStep(command.commandId, operation, "claim"),
      "agent-run.claim",
      origin,
    );
    const exactClaim = claimCommand(
      command,
      operation,
      admission.consequence,
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
        "The admitted SPICE evaluation closeout claim receipt does not seal the run's exact claimed/start timeline.",
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
    await this.dependencies.commands.claimRun(origin, exactClaim);
  }

  async #publishExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
    operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "publishing" || run.status === "completed") {
      const receipt = exactCommandReceipt(
        project,
        commandStep(command.commandId, operation, "publish"),
        "agent-run.publish",
        origin,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
      const exactPublish = publishCommand(
        command,
        operation,
        admission.consequence,
        expectedRevision,
        issuedAt,
      );
      if (run.status === "publishing" && run.summary !== exactPublish.summary) {
        throw invalidTransition(
          "The publishing admitted SPICE evaluation closeout summary differs from its exact publish transition.",
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
    await this.dependencies.commands.publishRun(
      origin,
      publishCommand(
        command,
        operation,
        admission.consequence,
        expectedRevision,
        issuedAt,
      ),
    );
  }

  async #completeExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
    operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
    successor: { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact },
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "completed") {
      const receipt = exactCommandReceipt(
        project,
        commandStep(command.commandId, operation, "complete"),
        "agent-run.complete",
        origin,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
      const exactCompletion = completionCommand(
        command,
        operation,
        expectedRevision,
        successor.snapshot,
        successor.artifact,
        admission.consequence,
        issuedAt,
      );
      if (run.summary !== exactCompletion.summary) {
        throw invalidTransition(
          "The completed admitted SPICE evaluation closeout summary differs from its exact completion transition.",
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
    await this.dependencies.commands.completeRun(
      origin,
      completionCommand(
        command,
        operation,
        expectedRevision,
        successor.snapshot,
        successor.artifact,
        admission.consequence,
        issuedAt,
      ),
    );
  }

  async #persistCloseoutCapture(
    run: EngineeringAgentRun,
    operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
    decisionId: string,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  ): Promise<{
    readonly capture: SpiceAdmittedObservationEvaluationCloseoutCapture;
    readonly captureFingerprint: ContentFingerprint;
  }> {
    const capture = closeoutCapture(run, operation, decisionId, admission);
    const captureText = canonicalSpiceAdmittedObservationEvaluationCloseoutCaptureText(
      capture,
    );
    const captureFingerprint = await sha256Fingerprint(capture);
    await this.dependencies.closeoutCaptures.save(captureFingerprint, captureText);
    const readback = await this.dependencies.closeoutCaptures.read(
      captureFingerprint,
    );
    if (readback === undefined || readback !== captureText) {
      throw new Error(
        "Admitted observation evaluation closeout capture was not durably readable after save.",
      );
    }
    return {
      capture: validateSpiceAdmittedObservationEvaluationCloseoutCapture(
        JSON.parse(readback),
      ),
      captureFingerprint,
    };
  }

  async #reopenCloseoutCapture(
    run: EngineeringAgentRun,
    operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
    decisionId: string,
    admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  ): Promise<{
    readonly capture: SpiceAdmittedObservationEvaluationCloseoutCapture;
    readonly captureFingerprint: ContentFingerprint;
  }> {
    const capture = closeoutCapture(run, operation, decisionId, admission);
    const captureText = canonicalSpiceAdmittedObservationEvaluationCloseoutCaptureText(
      capture,
    );
    const captureFingerprint = await sha256Fingerprint(capture);
    const stored = await this.dependencies.closeoutCaptures.read(
      captureFingerprint,
    );
    if (stored === undefined) {
      throw invalidTransition(
        "The publishing admitted SPICE evaluation closeout capture is unavailable for successor reconstruction.",
      );
    }
    let reopened: SpiceAdmittedObservationEvaluationCloseoutCapture;
    try {
      reopened = validateSpiceAdmittedObservationEvaluationCloseoutCapture(
        JSON.parse(stored),
      );
    } catch {
      throw invalidTransition(
        "The publishing admitted SPICE evaluation closeout capture is not a valid L5 closeout.",
      );
    }
    if (
      stored !== captureText ||
      canonicalSpiceAdmittedObservationEvaluationCloseoutCaptureText(reopened) !==
        captureText
    ) {
      throw invalidTransition(
        "The publishing admitted SPICE evaluation closeout capture does not match its deterministic reconstruction.",
      );
    }
    return { capture: reopened, captureFingerprint };
  }

  async #assertSavedSuccessor(expected: ThreadSnapshot): Promise<void> {
    const saved = await this.dependencies.snapshots.getFresh(expected.id);
    if (
      !saved ||
      deterministicJson(validateThreadSnapshot(saved)) !==
        deterministicJson(expected)
    ) {
      throw invalidTransition(
        "The publishing admitted SPICE evaluation closeout has no exact saved Thread successor.",
      );
    }
  }

  async #assertReceiptSnapshotExact(
    project: EngineeringProjectSnapshot,
    receipt: EngineeringProjectCommandReceipt,
  ): Promise<void> {
    const reference = receipt.resultingSnapshot;
    const reopened = await this.dependencies.projects.getRevision(
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
        `The admitted SPICE evaluation closeout ${receipt.type} receipt does not reopen its exact immutable project revision.`,
      );
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
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

async function recrossAdmission(
  command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
  project: EngineeringProjectSnapshot,
  admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
  basis: ReturnType<typeof requireBasis>,
  basisSnapshot: ThreadSnapshot,
  dependencies: AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
): Promise<void> {
  if (admission.projectId !== command.projectId) {
    throw invalidTransition(
      "The closeout project does not match the signed admission.",
    );
  }
  if (
    admission.subjectId !== basis.subjectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision
  ) {
    throw invalidTransition(
      "The closeout Thread basis does not match the signed admission.",
    );
  }
  try {
    const resolved = await resolveAdmittedSpiceEvaluationCloseoutEvidence(
      dependencies,
      { project, basis, snapshot: basisSnapshot },
    );
    const expected = admittedSpiceEvaluationCloseoutAdmission(
      resolved,
      admission.consequence,
    );
    if (deterministicJson(expected) !== deterministicJson(admission)) {
      throw invalidTransition(
        "The signed admitted SPICE evaluation closeout no longer matches the exact L4 capture, sheet, and Thread basis.",
      );
    }
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    if (error instanceof AdmittedSpiceEvaluationCloseoutResolutionError) {
      throw invalidTransition(
        `The signed admitted SPICE evaluation closeout cannot be recrossed: ${error.message}`,
      );
    }
    throw invalidTransition(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function closeoutCapture(
  run: EngineeringAgentRun,
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
  decisionId: string,
  admission: SpiceAdmittedObservationEvaluationCloseoutAdmission,
): SpiceAdmittedObservationEvaluationCloseoutCapture {
  return validateSpiceAdmittedObservationEvaluationCloseoutCapture({
    schemaVersion: admission.schemaVersion,
    kind: "spice-admitted-observation-evaluation-closeout",
    operation,
    trustedRunId: run.id,
    decisionId,
    sealedAt: requiredStart(run),
    admission,
    evaluationCapture: {
      id: admission.capture.id,
      fingerprint: admission.capture.fingerprint,
      uri:
        `${SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${admission.capture.fingerprint.digest}`,
    },
    sheet: admission.sheet,
    limits: SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
  });
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly operation: SpiceAdmittedObservationEvaluationCloseoutOperation;
  readonly capture: SpiceAdmittedObservationEvaluationCloseoutCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId =
    `spice-admitted-observation-evaluation-closeout-${input.captureFingerprint.digest}`;
  const l4ArtifactId = input.capture.admission.capture.id;
  const operationRef = {
    serverId: "digital-thread",
    tool: `${input.operation.id}@${input.operation.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: input.capture.admission.consequence === "accept"
      ? "Accepted admitted SPICE evaluation closeout"
      : "Rejected admitted SPICE evaluation closeout",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const actionId = `l5-closeout-${input.run.id}`;
  const extension: ThreadSnapshotExtension = {
    id: `${input.operation.id.replaceAll(".", "-")}-${input.run.id}`,
    name: input.capture.admission.consequence === "accept"
      ? "Accept admitted SPICE evaluation"
      : "Reject admitted SPICE evaluation",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `traces-closeout-${artifact.id}`,
      relation: "traces_to",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: l4ArtifactId },
      rationale:
        "The human L5 closeout names the exact L4 evaluation capture. It is not an ngspice replay.",
    }],
    proposedActions: [{
      id: actionId,
      name: extensionName(input.capture.admission.consequence),
      kind: "review",
      readiness: "ready",
      rationale:
        "Human L5 closeout of the exact L4 evaluation capture. No ngspice or SysON call. An L4 pass is not L5.",
      targets: [
        { kind: "artifact", id: l4ArtifactId },
        { kind: "artifact", id: artifact.id },
      ],
      addressesViolationIds: [],
      dependsOnActionIds: [],
    }],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact admitted SPICE evaluation closeout is already present in the basis snapshot.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function extensionName(
  consequence: SpiceAdmittedObservationEvaluationCloseoutAdmission["consequence"],
): string {
  return consequence === "accept"
    ? "Accept admitted SPICE evaluation"
    : "Reject admitted SPICE evaluation";
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw invalidTransition(
      "This executor may continue only the exact admitted SPICE evaluation closeout it claimed.",
    );
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): SpiceAdmittedObservationEvaluationCloseoutOperation {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = closeoutOperationOf(workItem?.operation);
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem || !operation ||
    workItem.operation?.bindings.length !== 1 ||
    workItem.operation.bindings[0]?.name !== "approvedBrief" ||
    workItem.operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to a human L5 admitted SPICE evaluation closeout with the sole approvedBrief binding.`,
    );
  }
  return operation;
}

function closeoutOperationOf(
  operation: { readonly id: string; readonly version: string } | undefined,
): SpiceAdmittedObservationEvaluationCloseoutOperation | undefined {
  if (
    operation?.id === DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.id &&
    operation.version ===
      DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.version
  ) {
    return DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION;
  }
  if (
    operation?.id === DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION.id &&
    operation.version ===
      DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION.version
  ) {
    return DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION;
  }
  return undefined;
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || !decision.inputFingerprint) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      decision.approvalIds.includes(approval.id) &&
      approval.decidedByOrigin === "human" &&
      typeof approval.decidedBy === "string" &&
      approval.decidedBy.trim().length > 0 &&
      typeof approval.decidedAt === "string" &&
      !Number.isNaN(Date.parse(approval.decidedAt)) &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      sameEvidenceRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved admitted SPICE evaluation closeout is bound to this run basis."
        : "Ambiguous admitted SPICE evaluation closeout MRTR: exactly one human-approved decision is required.",
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
    !fingerprintsEqual(
      expectedDecisionFingerprint,
      selected.decision.inputFingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted SPICE evaluation closeout decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((item) => item.id === id);
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
      "The admitted SPICE evaluation closeout run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
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
  return !!value && "snapshotId" in value &&
    value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (reference: EngineeringThreadEntityRef) =>
    deterministicJson({
      snapshotId: reference.snapshotId,
      snapshotRevision: reference.snapshotRevision,
      kind: reference.kind,
      id: reference.id,
    });
  const leftKeys = [...left.map(key)].sort();
  const rightKeys = [...right.map(key)].sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index]);
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
  try {
    return parseSpiceAdmittedObservationEvaluationCloseoutParameters(
      parameters,
      operation,
    );
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Admitted SPICE evaluation closeout parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: CloseoutThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the admitted SPICE evaluation closeout.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function claimCommand(
  command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
  consequence: SpiceAdmittedObservationEvaluationCloseoutAdmission["consequence"],
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "claim"),
    expectedRevision,
    issuedAt,
    summary: closeoutSummary(consequence, "started"),
  };
}

function publishCommand(
  command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
  consequence: SpiceAdmittedObservationEvaluationCloseoutAdmission["consequence"],
  expectedRevision: number,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "publish"),
    expectedRevision,
    issuedAt,
    summary: closeoutSummary(consequence, "publishing"),
  };
}

function completionCommand(
  command: DecideAdmittedSpiceEvaluationRunExecutorCommand,
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  consequence: SpiceAdmittedObservationEvaluationCloseoutAdmission["consequence"],
  issuedAt = command.issuedAt,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "complete"),
    expectedRevision,
    issuedAt,
    summary: closeoutSummary(consequence, "completed"),
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
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
      `The admitted SPICE evaluation closeout run has no unique exact ${type} receipt.`,
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
      `The admitted SPICE evaluation closeout ${type} receipt does not seal its exact command, revision, issuance, and status transition.`,
    );
  }
}

function closeoutSummary(
  consequence: SpiceAdmittedObservationEvaluationCloseoutAdmission["consequence"],
  phase: "started" | "publishing" | "completed",
): string {
  const verb = consequence === "accept" ? "accept" : "reject";
  if (phase === "started") {
    return `Started the human ${verb} closeout of the admitted SPICE evaluation.`;
  }
  if (phase === "publishing") {
    return `Publishing the human ${verb} closeout of the admitted SPICE evaluation.`;
  }
  return `Recorded the human ${verb} closeout of the exact admitted SPICE evaluation.`;
}

function commandStep(
  commandId: string,
  operation: SpiceAdmittedObservationEvaluationCloseoutOperation,
  step: string,
): string {
  return `${commandId}:${operation.id}:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
