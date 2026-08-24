/**
 * Provider-free executor for `model.seal-architecture-sysml@1`.
 *
 * It reopens one captured agent-authored architecture SysML analysis and
 * writes a Thread document only. It does not insert into SysON, does not
 * reuse `compile.seal-admission@3`, and does not treat renderer
 * `sysml-source-capture/1.0` envelopes as agent-authored authority.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type ArchitectureSysmlSealAdmission,
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  parseArchitectureSysmlSealParameters,
} from "../../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
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
import type { ArchitectureSysmlSourceAnalysisCaptureService } from "./architecture-sysml-source-analysis-capture.ts";
import {
  ARCHITECTURE_SYSML_SEAL_CAPTURE_SCHEMA,
  ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX,
  type ArchitectureSysmlSealCapture,
  assertAdmissionMatchesCapture,
  validateArchitectureSysmlSealCapture,
} from "./architecture-sysml-seal-capture-schema.ts";
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

export { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION };

export interface ArchitectureSysmlSealCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ArchitectureSysmlThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface ModelSealArchitectureSysmlRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ModelSealArchitectureSysmlRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ArchitectureSysmlThreadSnapshotStore;
  readonly sources: ArchitectureSysmlSourceAnalysisCaptureService;
  readonly captures: ArchitectureSysmlSealCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class ModelSealArchitectureSysmlRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: ModelSealArchitectureSysmlRunExecutorDependencies["commands"];
  readonly #snapshots: ArchitectureSysmlThreadSnapshotStore;
  readonly #sources: ArchitectureSysmlSourceAnalysisCaptureService;
  readonly #captures: ArchitectureSysmlSealCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: ModelSealArchitectureSysmlRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#sources = dependencies.sources;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ModelSealArchitectureSysmlRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute an architecture SysML seal.",
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
    command: ModelSealArchitectureSysmlRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ArchitectureSysmlSealAdmission,
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
          summary: "Started the provider-free architecture SysML seal.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free architecture SysML seal.",
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
          "The human-approved architecture SysML decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed architecture SysML parameters changed after the run was claimed.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);

      const reopened = await this.#sources.reopen({
        schemaVersion: "architecture-sysml-source-analysis-capture/1.0",
        kind: "architecture-sysml-source-analysis",
        profile: admission.profile,
        source: {
          id: admission.sourceId,
          role: "sysml-model",
          language: "sysml-v2",
          sha256: admission.source.sha256,
          byteCount: admission.source.byteCount,
          casUri: admission.source.casUri,
        },
        analysis: {
          analyzer: admission.analysis.analyzer,
          policy: admission.analysis.policy,
          sha256: admission.analysis.sha256,
          byteCount: admission.analysis.byteCount,
          casUri: admission.analysis.casUri,
        },
      });
      assertAdmissionMatchesCapture(admission, reopened.reference);

      const sealedAt = requiredStart(run);
      const capture: ArchitectureSysmlSealCapture = {
        schemaVersion: ARCHITECTURE_SYSML_SEAL_CAPTURE_SCHEMA,
        kind: "architecture-sysml-seal",
        operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        admission,
        sourceCapture: reopened.reference,
        unresolvedConstructs: reopened.analysis.unresolvedConstructs.map((item) => ({
          id: item.id,
          kind: item.kind,
        })),
      };
      const validatedCapture = validateArchitectureSysmlSealCapture(capture);
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.#captures.save(captureFingerprint, captureText);
      const captureReadback = await this.#captures.read(captureFingerprint);
      if (captureReadback === undefined) {
        throw new Error(
          "Architecture SysML seal capture was not durably readable after save.",
        );
      }
      const reopenedCapture = validateArchitectureSysmlSealCapture(
        JSON.parse(captureReadback),
      );
      if (
        captureReadback !== captureText ||
        deterministicJson(reopenedCapture) !== captureText
      ) {
        throw new Error(
          "Architecture SysML seal capture changed during exact readback.",
        );
      }

      const expectedSuccessor = buildArchitectureSysmlSealSuccessor({
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
          "Architecture SysML seal ThreadSnapshot was not durably readable after save.",
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
          summary: "Publishing the sealed architecture SysML analysis document.",
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
          `Architecture SysML seal Thread write may have been dispatched${
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

  async #completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: ModelSealArchitectureSysmlRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ArchitectureSysmlSealAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#commands.claimRun(origin, {
      ...command,
      commandId: commandStep(command.commandId, "claim"),
      summary: "Started the provider-free architecture SysML seal.",
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
    command: ModelSealArchitectureSysmlRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: ArchitectureSysmlSealAdmission,
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
        "The completed architecture SysML seal does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    await assertThreadSnapshotLineageIntact(validatedSnapshot, this.#snapshots);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
    const resultEvidence = exactCompletedEvidence(project, run, validatedSnapshot);
    const observedArtifact = validatedSnapshot.artifacts.find((item) =>
      item.id === resultEvidence.id
    );
    if (!observedArtifact || observedArtifact.kind !== "document") {
      throw invalidTransition(
        "The completed architecture SysML seal evidence is not a Thread document.",
      );
    }
    const captureText = await this.#captures.read(observedArtifact.fingerprint);
    if (captureText === undefined) {
      throw invalidTransition(
        "The completed architecture SysML seal capture is no longer content-addressably readable.",
      );
    }
    const capture = validateArchitectureSysmlSealCapture(JSON.parse(captureText));
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
        "The completed architecture SysML seal capture no longer equals the exact reviewed run and decision.",
      );
    }
    const expectedSuccessor = buildArchitectureSysmlSealSuccessor({
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
        "The completed architecture SysML Thread successor no longer equals the exact deterministic snapshot produced from its reviewed basis and capture.",
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
    command: ModelSealArchitectureSysmlRunExecutorCommand,
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
          "Architecture SysML seal stopped before a ThreadSnapshot write was dispatched.",
        code: "model-seal-architecture-sysml-not-published",
        message:
          "The provider-free architecture SysML seal stopped before its document was published.",
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function buildArchitectureSysmlSealSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: ArchitectureSysmlSealCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = `architecture-sysml-seal-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id}@${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Agent-authored architecture SysML analysis",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX}${input.captureFingerprint.digest}`,
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
    id: `model-seal-architecture-sysml-${input.run.id}`,
    name: "Seal the reviewed architecture SysML analysis",
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
      "This exact architecture SysML seal document is already present in the basis snapshot.",
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
    operation?.id !== MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id ||
    operation.version !== MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version ||
    (operation.bindings?.length ?? 0) !== 0
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id}@${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version} with no SysON binding.`,
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
      "This executor may continue only the exact architecture SysML seal run it claimed.",
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
        ? "No exact human-approved architecture SysML seal decision is bound to this run basis."
        : "Ambiguous architecture SysML seal: exactly one human-approved decision is required.",
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
      "The architecture SysML decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
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
      "The architecture SysML run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): ArchitectureSysmlSealAdmission {
  try {
    return parseArchitectureSysmlSealParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Architecture SysML seal parameters are invalid: ${errorMessage(error)}`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: ArchitectureSysmlThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the architecture SysML seal.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: ModelSealArchitectureSysmlRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed the exact human-reviewed architecture SysML analysis.",
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
  command: ModelSealArchitectureSysmlRunExecutorCommand,
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
      "The completed architecture SysML seal has no exact complete-run receipt.",
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
      "The completed architecture SysML seal is not attached to exactly one declared snapshot and document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed architecture SysML evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:model-seal-architecture-sysml:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: ModelSealArchitectureSysmlRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Architecture SysML seal run ${command.runId} did not complete through this exact execution command.`,
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
