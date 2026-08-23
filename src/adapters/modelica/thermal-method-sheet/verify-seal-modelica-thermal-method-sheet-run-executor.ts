/**
 * Provider-free executor for `verify.seal-modelica-thermal-method-sheet@1`.
 *
 * It reopens one reviewed thermal method sheet, recrosses the Modelica source
 * capture and SysML identities, and writes a Thread document. It never
 * executes OMC, never admits source, and never grants an L4 verdict.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { TechnicalCompilationBasisResolver } from "../../../application/ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../application/ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  encodeThermalMethodSheetSealParameters,
  type ModelicaThermalMethodSheetSealAdmission,
  parseThermalMethodSheetSealParameters,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
} from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  recrossThermalMethodSheet,
  type ThermalMethodSheetRecross,
} from "../../../domain/modelica/thermal-method-sheet-recross.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  type ModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
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
import {
  type ThreadArtifact,
  type ThreadSnapshot,
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
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  type ModelicaThermalMethodSheetSealCapture,
  recrossFromCapture,
  thermalMethodSheetUri,
  validateModelicaThermalMethodSheetSealCapture,
} from "./thermal-method-sheet-seal-capture.ts";

export { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION };

export interface ThermalMethodSheetSealCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ThermalMethodSheetThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifySealModelicaThermalMethodSheetRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifySealModelicaThermalMethodSheetRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ThermalMethodSheetThreadSnapshotStore;
  readonly sheets: ThermalMethodSheetStore;
  readonly sourceCaptures: ThermalMethodSheetSourceCaptureReader;
  readonly basisResolver: TechnicalCompilationBasisResolver;
  readonly captures: ThermalMethodSheetSealCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class VerifySealModelicaThermalMethodSheetRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands:
    VerifySealModelicaThermalMethodSheetRunExecutorDependencies["commands"];
  readonly #snapshots: ThermalMethodSheetThreadSnapshotStore;
  readonly #sheets: ThermalMethodSheetStore;
  readonly #sourceCaptures: ThermalMethodSheetSourceCaptureReader;
  readonly #basisResolver: TechnicalCompilationBasisResolver;
  readonly #captures: ThermalMethodSheetSealCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(
    dependencies: VerifySealModelicaThermalMethodSheetRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#sheets = dependencies.sheets;
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#basisResolver = dependencies.basisResolver;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a thermal method-sheet seal.",
      );
    }

    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ModelicaThermalMethodSheetSealAdmission,
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
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free thermal method-sheet seal.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free thermal method-sheet seal.",
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
          "The human-approved thermal method-sheet decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(
        currentApproval.proposal.parameters,
      );
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed thermal method-sheet parameters changed after the run was claimed.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);
      const recrossed = await this.#recrossAdmission(
        command.projectId,
        currentAdmission,
        currentApproval.decision,
        currentBasisSnapshot,
        currentBasis,
      );

      const sealedAt = requiredStart(run);
      const capture: ModelicaThermalMethodSheetSealCapture = {
        schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
        kind: "modelica-thermal-method-sheet-seal",
        operation: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        admission: currentAdmission,
        sheet: {
          id: recrossed.sheet.id,
          fingerprint: currentAdmission.sheetFingerprint,
          uri: thermalMethodSheetUri(currentAdmission.sheetFingerprint),
        },
        recross: recrossFromCapture(recrossed.recross, currentAdmission),
      };
      const validatedCapture = validateModelicaThermalMethodSheetSealCapture(
        capture,
      );
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.#captures.save(captureFingerprint, captureText);
      const captureReadback = await this.#captures.read(captureFingerprint);
      if (captureReadback === undefined) {
        throw new Error(
          "Thermal method-sheet seal capture was not durably readable after save.",
        );
      }
      const reopenedCapture = validateModelicaThermalMethodSheetSealCapture(
        JSON.parse(captureReadback),
      );
      if (
        captureReadback !== captureText ||
        deterministicJson(reopenedCapture) !== captureText
      ) {
        throw new Error(
          "Thermal method-sheet seal capture changed during exact readback.",
        );
      }

      const expectedSuccessor = buildThermalMethodSheetSealSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: reopenedCapture,
        captureFingerprint,
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(expectedSuccessor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(
        expectedSuccessor.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !==
          deterministicJson(expectedSuccessor.snapshot)
      ) {
        throw new Error(
          "Thermal method-sheet seal ThreadSnapshot was not durably readable after save.",
        );
      }
      snapshotReadbackVerified = true;

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed thermal method-sheet document.",
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
          `Thermal method-sheet seal Thread write may have been dispatched${
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
    const project = await this.#projects.get(projectId);
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
    admission: ModelicaThermalMethodSheetSealAdmission,
    decision: EngineeringDecision,
    snapshot: ThreadSnapshot,
    basis: ReturnType<typeof requireBasis>,
  ): Promise<{
    readonly sheet: ModelicaThermalMethodSheet;
    readonly recross: ThermalMethodSheetRecross;
  }> {
    if (admission.projectId !== projectId) {
      throw invalidTransition(
        "The signed thermal method sheet belongs to another project.",
      );
    }
    if (admission.sealDecisionId !== decision.id) {
      throw invalidTransition(
        "The signed thermal method-sheet seal decision is not this run's approved decision.",
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
        "The thermal method-sheet basis is not the exact run Thread revision.",
      );
    }
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    if (!fingerprintsEqual(snapshotFingerprint, admission.basis.fingerprint)) {
      throw invalidTransition(
        "The thermal method-sheet Thread fingerprint no longer matches the signed basis.",
      );
    }

    const sheet = await this.#sheets.read(admission.sheetFingerprint);
    if (!sheet) {
      throw invalidTransition(
        "The exact thermal method sheet is unavailable.",
      );
    }
    const observedFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
    const encoded = await encodeThermalMethodSheetSealParameters(sheet);
    if (
      !fingerprintsEqual(observedFingerprint, admission.sheetFingerprint) ||
      deterministicJson(parseThermalMethodSheetSealParameters(encoded)) !==
        deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The reopened thermal method sheet does not match the signed admission.",
      );
    }

    let source;
    try {
      source = await this.#sourceCaptures.read(
        sheet.model.sourceCaptureFingerprint,
      );
    } catch (error) {
      throw invalidTransition(
        `The reopened source capture is not an exact modelica-model identity. ${
          errorMessage(error)
        }`,
      );
    }
    let compilationBasis;
    try {
      compilationBasis = await this.#basisResolver.resolve({
        projectId,
        basis: {
          kind: "thread-snapshot",
          snapshotId: sheet.basis.snapshotId,
          revision: sheet.basis.revision,
          subjectId: sheet.subject.id,
        },
      });
    } catch (error) {
      throw invalidTransition(
        `The exact Thread/SysML basis could not be recrossed. ${errorMessage(error)}`,
      );
    }
    if (!compilationBasis) {
      throw invalidTransition("The exact Thread/SysML basis is unavailable.");
    }
    try {
      const recross = recrossThermalMethodSheet(
        sheet,
        source,
        compilationBasis.sysmlAnchor.elements,
      );
      return { sheet, recross };
    } catch (error) {
      throw invalidTransition(
        error instanceof Error
          ? error.message
          : "The thermal method sheet failed exact source and SysML recross.",
      );
    }
  }

  async #completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ModelicaThermalMethodSheetSealAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#commands.claimRun(origin, {
      ...command,
      commandId: commandStep(command.commandId, "claim"),
      summary: "Started the provider-free thermal method-sheet seal.",
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
    command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ModelicaThermalMethodSheetSealAdmission,
  ): Promise<void> {
    assertCompleted(project, command);
    const run = requireRun(project, command.runId);
    const basis = requireBasis(run);
    const result = run.resultSnapshot!;
    const snapshot = await this.#snapshots.getFresh(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      result.subjectId !== basis.subjectId || result.revision !== basis.revision + 1 ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed thermal method-sheet seal does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    const resultEvidence = exactCompletedEvidence(project, run, validatedSnapshot);
    const observedArtifact = validatedSnapshot.artifacts.find((item) =>
      item.id === resultEvidence.id
    );
    if (!observedArtifact || observedArtifact.kind !== "document") {
      throw invalidTransition(
        "The completed thermal method-sheet seal evidence is not a Thread document.",
      );
    }
    const captureText = await this.#captures.read(observedArtifact.fingerprint);
    if (captureText === undefined) {
      throw invalidTransition(
        "The completed thermal method-sheet seal capture is no longer content-addressably readable.",
      );
    }
    const capture = validateModelicaThermalMethodSheetSealCapture(
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
        "The completed thermal method-sheet seal capture no longer equals the exact reviewed run and decision.",
      );
    }
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    const expectedSuccessor = buildThermalMethodSheetSealSuccessor({
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
        "The completed thermal method-sheet Thread successor no longer equals the exact deterministic snapshot produced from its reviewed basis and capture.",
      );
    }
    const receipt = exactCompletionReceipt(project, command, origin, run);
    await this.#commands.completeRun(
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
    command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Thermal method-sheet seal stopped before a ThreadSnapshot write was dispatched.",
        code: "verify-seal-modelica-thermal-method-sheet-not-published",
        message:
          "The provider-free thermal method-sheet seal stopped before its document was published.",
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function buildThermalMethodSheetSealSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: ModelicaThermalMethodSheetSealCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId =
    `modelica-thermal-method-sheet-seal-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Modelica thermal method sheet",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${input.captureFingerprint.digest}`,
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
    id: `verify-seal-modelica-thermal-method-sheet-${input.run.id}`,
    name: "Seal the reviewed Modelica thermal method sheet",
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
      "This exact thermal method-sheet seal document is already present in the basis snapshot.",
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
    operation?.id !== VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id ||
    operation.version !==
      VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version} with the sole approvedBrief binding.`,
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
      "This executor may continue only the exact thermal method-sheet seal run it claimed.",
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
        ? "No exact human-approved thermal method-sheet seal decision is bound to this run basis."
        : "Ambiguous thermal method-sheet seal: exactly one human-approved decision is required.",
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
      "The thermal method-sheet decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
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
      "The thermal method-sheet run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  const admission = parseAdmission(selected.proposal.parameters);
  if (admission.sealDecisionId !== selected.decision.id) {
    throw invalidTransition(
      "The signed thermal method-sheet sealDecisionId is not the approved decision.",
    );
  }
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): ModelicaThermalMethodSheetSealAdmission {
  try {
    return parseThermalMethodSheetSealParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Thermal method-sheet seal parameters are invalid: ${errorMessage(error)}`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: ThermalMethodSheetThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the thermal method-sheet seal.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed the exact human-reviewed Modelica thermal method sheet.",
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
  command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
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
      "The completed thermal method-sheet seal has no exact complete-run receipt.",
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
      "The completed thermal method-sheet seal is not attached to exactly one declared snapshot and document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed thermal method-sheet evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-seal-modelica-thermal-method-sheet:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: VerifySealModelicaThermalMethodSheetRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Thermal method-sheet seal run ${command.runId} did not complete through this exact execution command.`,
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
