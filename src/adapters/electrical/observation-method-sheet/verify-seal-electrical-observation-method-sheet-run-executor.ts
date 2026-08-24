/**
 * Provider-free executor for `verify.seal-electrical-observation-method-sheet@1`.
 *
 * It reopens one reviewed electrical observation method sheet, recrosses brief
 * gates, and writes a Thread document. It never executes ngspice and never
 * grants an L4 verdict.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { ElectricalObservationMethodSheetBriefGateReader } from "../../../application/ports/out/electrical/observation-method-sheet-brief-gate-reader.ts";
import type { ElectricalObservationMethodSheetStore } from "../../../application/ports/out/electrical/observation-method-sheet-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type ElectricalObservationMethodSheetSealAdmission,
  encodeElectricalObservationMethodSheetSealParameters,
  parseElectricalObservationMethodSheetSealParameters,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
} from "../../../domain/electrical/observation-method-sheet-proposal.ts";
import {
  type ElectricalObservationMethodSheetRecross,
  recrossElectricalObservationMethodSheet,
} from "../../../domain/electrical/observation-method-sheet-recross.ts";
import {
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
} from "../../../domain/electrical/observation-method-sheet.ts";
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
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  type ElectricalObservationMethodSheetSealCapture,
  electricalObservationMethodSheetUri,
  recrossFromCapture,
  validateElectricalObservationMethodSheetSealCapture,
} from "../../../domain/electrical/observation-method-sheet-seal-capture.ts";

export { VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION };

export interface ElectricalObservationMethodSheetSealCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ElectricalObservationMethodSheetThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifySealElectricalObservationMethodSheetRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifySealElectricalObservationMethodSheetRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ElectricalObservationMethodSheetThreadSnapshotStore;
  readonly sheets: ElectricalObservationMethodSheetStore;
  readonly briefGates: ElectricalObservationMethodSheetBriefGateReader;
  readonly captures: ElectricalObservationMethodSheetSealCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class VerifySealElectricalObservationMethodSheetRunExecutor {
  constructor(
    private readonly dependencies:
      VerifySealElectricalObservationMethodSheetRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute an electrical observation method-sheet seal.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters);
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ElectricalObservationMethodSheetSealAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    let snapshotReadbackVerified = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      snapshotSaveMayHaveBeenDispatched = run.status === "running" ||
        run.status === "publishing";
      const completed = await this.#completedFor(
        origin,
        command,
        approvedDecision,
        admission,
      );
      if (completed) return completed;
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
      if (run.status === "queued") {
        await this.dependencies.commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary:
            "Started the provider-free electrical observation method-sheet seal.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.dependencies.commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary:
            "Started the provider-free electrical observation method-sheet seal.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The human-approved electrical observation method-sheet decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(
        currentApproval.proposal.parameters,
      );
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed electrical observation method-sheet parameters changed after the run was claimed.",
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
      const recrossed = await this.#recrossAdmission(
        command.projectId,
        currentAdmission,
        currentApproval.decision,
        currentBasisSnapshot,
        currentBasis,
      );
      const sealedAt = requiredStart(run);
      const capture: ElectricalObservationMethodSheetSealCapture = {
        schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
        kind: "electrical-observation-method-sheet-seal",
        operation: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        admission: currentAdmission,
        sheet: {
          id: recrossed.sheet.id,
          fingerprint: currentAdmission.sheetFingerprint,
          uri: electricalObservationMethodSheetUri(
            currentAdmission.sheetFingerprint,
          ),
        },
        recross: recrossFromCapture(recrossed.recross),
      };
      const validatedCapture = validateElectricalObservationMethodSheetSealCapture(
        capture,
      );
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.dependencies.captures.save(captureFingerprint, captureText);
      const captureReadback = await this.dependencies.captures.read(
        captureFingerprint,
      );
      if (captureReadback === undefined) {
        throw new Error(
          "Electrical observation method-sheet seal capture was not durably readable after save.",
        );
      }
      const reopenedCapture = validateElectricalObservationMethodSheetSealCapture(
        JSON.parse(captureReadback),
      );
      if (
        captureReadback !== captureText ||
        deterministicJson(reopenedCapture) !== captureText
      ) {
        throw new Error(
          "Electrical observation method-sheet seal capture changed during exact readback.",
        );
      }
      const expectedSuccessor = buildElectricalObservationMethodSheetSealSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: reopenedCapture,
        captureFingerprint,
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.dependencies.snapshots.save(expectedSuccessor.snapshot);
      const snapshotReadback = await this.dependencies.snapshots.getFresh(
        expectedSuccessor.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !==
          deterministicJson(expectedSuccessor.snapshot)
      ) {
        throw new Error(
          "Electrical observation method-sheet seal ThreadSnapshot was not durably readable after save.",
        );
      }
      snapshotReadbackVerified = true;
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.dependencies.commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the sealed electrical observation method-sheet document.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.dependencies.commands.completeRun(
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
        admission,
      );
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (completed) return completed;
        throw invalidTransition(
          `Electrical observation method-sheet seal Thread write may have been dispatched${
            snapshotReadbackVerified ? " and exactly read back" : ""
          }, but project attachment did not finish. Retry this exact command; it will reconstruct and reopen the same deterministic successor without creating another revision. Cause: ${
            errorMessage(error)
          }`,
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
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

  async #recrossAdmission(
    projectId: string,
    admission: ElectricalObservationMethodSheetSealAdmission,
    decision: EngineeringDecision,
    snapshot: ThreadSnapshot,
    basis: ReturnType<typeof requireBasis>,
  ): Promise<{
    readonly sheet: ElectricalObservationMethodSheet;
    readonly recross: ElectricalObservationMethodSheetRecross;
  }> {
    if (admission.projectId !== projectId) {
      throw invalidTransition(
        "The signed electrical observation method sheet belongs to another project.",
      );
    }
    if (admission.sealDecisionId !== decision.id) {
      throw invalidTransition(
        "The signed electrical observation method-sheet seal decision is not this run's approved decision.",
      );
    }
    if (
      snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId ||
      snapshot.id !== admission.basis.snapshotId ||
      snapshot.revision !== admission.basis.revision ||
      snapshot.subject.id !== admission.subjectId
    ) {
      throw invalidTransition(
        "The electrical observation method-sheet basis is not the exact run Thread revision.",
      );
    }
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    if (!fingerprintsEqual(snapshotFingerprint, admission.basis.fingerprint)) {
      throw invalidTransition(
        "The electrical observation method-sheet Thread fingerprint no longer matches the signed basis.",
      );
    }
    const sheet = await this.dependencies.sheets.read(admission.sheetFingerprint);
    if (!sheet) {
      throw invalidTransition(
        "The exact electrical observation method sheet is unavailable.",
      );
    }
    const observedFingerprint = await fingerprintElectricalObservationMethodSheet(
      sheet,
    );
    const encoded = await encodeElectricalObservationMethodSheetSealParameters(
      sheet,
    );
    if (
      !fingerprintsEqual(observedFingerprint, admission.sheetFingerprint) ||
      deterministicJson(
          parseElectricalObservationMethodSheetSealParameters(encoded),
        ) !==
        deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The reopened electrical observation method sheet does not match the signed admission.",
      );
    }
    const brief = await this.dependencies.briefGates.read(projectId);
    try {
      const recross = recrossElectricalObservationMethodSheet(sheet, brief?.gates, {
        projectId,
        subjectId: sheet.subject.id,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        fingerprint: snapshotFingerprint,
      });
      return { sheet, recross };
    } catch (error) {
      throw invalidTransition(
        error instanceof Error
          ? error.message
          : "The electrical observation method sheet failed exact brief-gate recross.",
      );
    }
  }

  async #completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ElectricalObservationMethodSheetSealAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.dependencies.commands.claimRun(origin, {
      ...command,
      commandId: commandStep(command.commandId, "claim"),
      summary: "Started the provider-free electrical observation method-sheet seal.",
    });
    const replayed = await this.#requiredProject(command.projectId);
    await this.#assertCompletedEvidence(
      origin,
      replayed,
      command,
      approvedDecision,
      admission,
    );
    return replayed;
  }

  async #assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ElectricalObservationMethodSheetSealAdmission,
  ): Promise<void> {
    assertCompleted(project, command);
    const run = requireRun(project, command.runId);
    const basis = requireBasis(run);
    const result = run.resultSnapshot!;
    const snapshot = await this.dependencies.snapshots.getFresh(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      result.subjectId !== basis.subjectId || result.revision !== basis.revision + 1 ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed electrical observation method-sheet seal does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    const resultEvidence = exactCompletedEvidence(project, run, validatedSnapshot);
    const observedArtifact = validatedSnapshot.artifacts.find((item) =>
      item.id === resultEvidence.id
    );
    if (!observedArtifact || observedArtifact.kind !== "document") {
      throw invalidTransition(
        "The completed electrical observation method-sheet seal evidence is not a Thread document.",
      );
    }
    const captureText = await this.dependencies.captures.read(
      observedArtifact.fingerprint,
    );
    if (captureText === undefined) {
      throw invalidTransition(
        "The completed electrical observation method-sheet seal capture is no longer content-addressably readable.",
      );
    }
    const capture = validateElectricalObservationMethodSheetSealCapture(
      JSON.parse(captureText),
    );
    const observedCaptureFingerprint = await sha256Fingerprint(capture);
    if (
      captureText !== deterministicJson(capture) ||
      !fingerprintsEqual(observedCaptureFingerprint, observedArtifact.fingerprint) ||
      capture.trustedRunId !== run.id ||
      capture.decisionId !== approvedDecision.id ||
      capture.sealedAt !== requiredStart(run) ||
      deterministicJson(capture.admission) !== deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The completed electrical observation method-sheet seal capture no longer equals the exact reviewed run and decision.",
      );
    }
    const basisSnapshot = await exactBasisSnapshot(
      this.dependencies.snapshots,
      basis,
    );
    const expectedSuccessor = buildElectricalObservationMethodSheetSealSuccessor({
      basisSnapshot,
      basis,
      run,
      capture,
      captureFingerprint: observedCaptureFingerprint,
    });
    if (
      resultEvidence.id !== expectedSuccessor.artifact.id ||
      deterministicJson(validatedSnapshot) !==
        deterministicJson(expectedSuccessor.snapshot)
    ) {
      throw invalidTransition(
        "The completed electrical observation method-sheet Thread successor no longer equals the exact deterministic snapshot produced from its reviewed basis and capture.",
      );
    }
    const receipt = exactCompletionReceipt(project, command, origin, run);
    await this.dependencies.commands.completeRun(
      origin,
      completionCommand(
        command,
        receipt.resultingSnapshot.revision - 1,
        expectedSuccessor.snapshot,
        expectedSuccessor.artifact,
      ),
    );
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.dependencies.commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Electrical observation method-sheet seal stopped before a ThreadSnapshot write was dispatched.",
        code: "verify-seal-electrical-observation-method-sheet-not-published",
        message:
          "The provider-free electrical observation method-sheet seal stopped before its document was published.",
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function buildElectricalObservationMethodSheetSealSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: ElectricalObservationMethodSheetSealCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId =
    `electrical-observation-method-sheet-seal-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Electrical observation method sheet",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const extension: ThreadSnapshotExtension = {
    id: `verify-seal-electrical-observation-method-sheet-${input.run.id}`,
    name: "Seal the reviewed electrical observation method sheet",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact electrical observation method-sheet seal document is already present in the basis snapshot.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id ||
    operation.version !==
      VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version} with the sole approvedBrief binding.`,
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
      "This executor may continue only the exact electrical observation method-sheet seal run it claimed.",
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
      approval.decisionId === decision.id && approval.status === "approved" &&
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
        ? "No exact human-approved electrical observation method-sheet seal decision is bound to this run basis."
        : "Ambiguous electrical observation method-sheet seal: exactly one human-approved decision is required.",
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
      "The electrical observation method-sheet decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
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
      "The electrical observation method-sheet run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  const admission = parseAdmission(selected.proposal.parameters);
  if (admission.sealDecisionId !== selected.decision.id) {
    throw invalidTransition(
      "The signed electrical observation method-sheet sealDecisionId is not the approved decision.",
    );
  }
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): ElectricalObservationMethodSheetSealAdmission {
  try {
    return parseElectricalObservationMethodSheetSealParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Electrical observation method-sheet seal parameters are invalid: ${
        errorMessage(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: ElectricalObservationMethodSheetThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the electrical observation method-sheet seal.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed the exact human-reviewed electrical observation method sheet.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [artifactEvidence(snapshot, artifact)],
  };
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

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const completeCommandId = commandStep(command.commandId, "complete");
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === completeCommandId
    ) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.id !== origin.actorId || receipt.actor.origin !== origin.kind ||
    receipt.issuedAt !== command.issuedAt || !run.resultSnapshot
  ) {
    throw invalidTransition(
      "The completed electrical observation method-sheet seal has no exact complete-run receipt.",
    );
  }
  return receipt;
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const result = run.resultSnapshot;
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !result || !workItem || declared.length !== 1 ||
    result.snapshotId !== snapshot.id || result.revision !== snapshot.revision ||
    result.subjectId !== snapshot.subject.id || run.evidenceRefs.length !== 1 ||
    workItem.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed electrical observation method-sheet seal is not attached to exactly one declared snapshot and document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed electrical observation method-sheet evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-seal-electrical-observation-method-sheet:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: VerifySealElectricalObservationMethodSheetRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      "The electrical observation method-sheet seal is not completed with an exact successor.",
    );
  }
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

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
