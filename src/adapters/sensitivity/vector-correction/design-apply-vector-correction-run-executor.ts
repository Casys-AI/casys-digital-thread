/**
 * Provider-free executor for `design.apply-vector-correction@1`.
 *
 * Reopens one failing evaluation and one sensitivity-study capture, rebuilds
 * the unique edge, recomputes z*, and writes a Thread document with
 * `grants: none`. It never calls a provider, SysON, or CAD path.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { assembleVectorCorrectionDecision } from "../../../domain/sensitivity/vector-correction/vector-correction-assembly.ts";
import {
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  parseVectorCorrectionDecisionParameters,
  type VectorCorrectionDecisionParameters,
  verifyVectorCorrectionParametersMatch,
} from "../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import { VECTOR_CORRECTION_UNLINKED_LABEL } from "../../../domain/sensitivity/vector-correction/vector-correction-origin.ts";
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
import type {
  RequirementEvaluation,
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
import {
  CORRECTION_PROPOSAL_CAPTURE_SCHEMA,
  CORRECTION_PROPOSAL_CAPTURE_URI_PREFIX,
  validateVectorCorrectionCapture,
  type VectorCorrectionCapture,
} from "./vector-correction-capture.ts";
import { reconstructSensitivityEdgesFromStudyCapture } from "../../../domain/sensitivity/edges/sensitivity-edge-from-study.ts";
import {
  isSensitivityStudyResultArtifactId,
  type SensitivityStudyResult,
  validateSensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";

export { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION };

export interface VectorCorrectionCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface VectorCorrectionStudyCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface VectorCorrectionThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface DesignApplyVectorCorrectionRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface DesignApplyVectorCorrectionRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: VectorCorrectionThreadSnapshotStore;
  readonly studyCaptures: VectorCorrectionStudyCaptureStore;
  readonly captures: VectorCorrectionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class DesignApplyVectorCorrectionRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: DesignApplyVectorCorrectionRunExecutorDependencies["commands"];
  readonly #snapshots: VectorCorrectionThreadSnapshotStore;
  readonly #studyCaptures: VectorCorrectionStudyCaptureStore;
  readonly #captures: VectorCorrectionCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: DesignApplyVectorCorrectionRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#studyCaptures = dependencies.studyCaptures;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DesignApplyVectorCorrectionRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the design-apply-vector-correction run.",
      );
    }

    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = requireMrtrApproval(project, run);
    const signed = parseSigned(approval.proposal.parameters);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, signed),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DesignApplyVectorCorrectionRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    signed: VectorCorrectionDecisionParameters,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      const preClaimRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preClaimRun);
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;

      await assertThreadWriteBasisAvailable(preClaim, preClaimRun);
      const basis = requireBasis(preClaimRun);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);

      if (
        preClaimRun.status === "queued" ||
        preClaimRun.status === "running" ||
        preClaimRun.status === "publishing"
      ) {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free vector-correction seal.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(
          preClaimRun,
          "queued or this agent's running/publishing",
        );
      }

      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const currentApproval = requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The human-approved vector-correction decision changed after the run was claimed.",
        );
      }
      const currentSigned = parseSigned(currentApproval.proposal.parameters);
      if (deterministicJson(currentSigned) !== deterministicJson(signed)) {
        throw invalidTransition(
          "The human-reviewed vector-correction parameters changed after the run was claimed.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);

      const evaluation = requireBoundEvaluation(
        project,
        run,
        currentBasisSnapshot,
        signed,
      );
      const studyArtifact = requireBoundStudyArtifact(
        project,
        run,
        currentBasisSnapshot,
        signed,
      );
      const studyCapture = await this.#reopenStudyCapture(studyArtifact);
      const observedStudyFingerprint = await sha256Fingerprint(studyCapture);
      if (
        !fingerprintsEqual(observedStudyFingerprint, studyArtifact.fingerprint) ||
        !fingerprintsEqual(observedStudyFingerprint, signed.studyCapture.fingerprint)
      ) {
        throw parameterMismatch(
          "The reopened study-capture digest does not match the signed fingerprint.",
        );
      }

      if (
        !Object.is(
          signed.driver.current.value,
          studyCapture.studyCase.baseValue.value,
        ) ||
        signed.driver.current.unit !== studyCapture.studyCase.baseValue.unit
      ) {
        throw parameterMismatch(
          "The signed current driver is not the study-case baseValue.",
        );
      }

      const assembled = assembleVectorCorrectionDecision({
        evaluation,
        requirement: currentBasisSnapshot.requirements.find((item) =>
          item.id === evaluation.requirementId
        ),
        observations: currentBasisSnapshot.observations,
        study: {
          digest: studyArtifact.fingerprint.digest,
          baseValue: studyCapture.studyCase.baseValue,
          metrics: studyCapture.studyCase.metrics,
          baseMeasurements: studyCapture.measurements.base,
        },
        studyCapture: {
          artifactId: studyArtifact.id,
          fingerprint: studyArtifact.fingerprint,
        },
        edges: reconstructSensitivityEdgesFromStudyCapture(studyCapture),
        caseDigest: studyCapture.caseDigest,
      });
      if (assembled.status !== "proposed") {
        throw unresolvedAtExecution(assembled);
      }
      try {
        verifyVectorCorrectionParametersMatch(signed, assembled.decision);
      } catch (error) {
        throw parameterMismatch(errorMessage(error));
      }

      const sealedAt = requiredStart(run);
      const capture: VectorCorrectionCapture = validateVectorCorrectionCapture({
        schemaVersion: CORRECTION_PROPOSAL_CAPTURE_SCHEMA,
        kind: "correction-proposal",
        grants: "none",
        operation: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        proposal: assembled.decision,
        studyCapture: {
          id: studyArtifact.id,
          fingerprint: studyArtifact.fingerprint,
          uri: studyArtifact.uri,
        },
        evaluation: { id: evaluation.id },
      });
      const captureText = deterministicJson(capture);
      const captureFingerprint = await sha256Fingerprint(capture);
      await this.#captures.save(captureFingerprint, captureText);
      const readBack = await this.#captures.read(captureFingerprint);
      if (readBack !== captureText) {
        throw new Error(
          "Vector-correction capture was not durably readable after save.",
        );
      }

      const successor = buildCorrectionSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture,
        captureFingerprint,
        studyArtifact,
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(successor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Vector-correction ThreadSnapshot was not durably readable after save.",
        );
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed vector-correction document.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Sealed the exact human-reviewed vector-correction document.",
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact",
            id: successor.artifact.id,
          }],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw invalidTransition(
          `Vector-correction Thread write may have been dispatched but project attachment did not finish. Cause: ${
            errorMessage(error)
          }`,
        );
      }
      if (claimed) await this.#recordFailure(origin, command, error);
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
    command: DesignApplyVectorCorrectionRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    assertCompleted(project, command);
    return project;
  }

  async #reopenStudyCapture(
    artifact: ThreadArtifact,
  ): Promise<SensitivityStudyResult> {
    let text: string | undefined;
    try {
      text = await this.#studyCaptures.read(artifact.fingerprint);
    } catch {
      throw invalidTransition(
        "The exact sensitivity-study capture could not be reopened.",
      );
    }
    if (text === undefined) {
      throw invalidTransition(
        "The exact sensitivity-study capture is no longer content-addressably readable.",
      );
    }
    return await validateSensitivityStudyResult(JSON.parse(text));
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: DesignApplyVectorCorrectionRunExecutorCommand,
    error: unknown,
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
          "Vector-correction seal stopped before a ThreadSnapshot write was dispatched.",
        code: failureCode(error),
        message: errorMessage(error),
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function requireBoundEvaluation(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  signed: VectorCorrectionDecisionParameters,
): RequirementEvaluation {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) =>
    item.name === "failingEvaluation"
  );
  if (
    binding?.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "evaluation"
  ) {
    throw invalidTransition("Run is not bound to a Thread evaluation.");
  }
  const reference = binding.source.reference;
  const basis = requireBasis(run);
  if (
    reference.snapshotId !== basis.snapshotId ||
    reference.snapshotRevision !== basis.revision
  ) {
    throw invalidTransition(
      "The failingEvaluation binding must name an evaluation in the run's exact Thread basis revision.",
    );
  }
  const evaluation = snapshot.evaluations.find((item) => item.id === reference.id);
  if (!evaluation || evaluation.freshness.status !== "fresh") {
    throw invalidTransition(
      "Bound failingEvaluation is absent or not fresh on the execution basis.",
    );
  }
  if (evaluation.id !== signed.evaluationId) {
    throw parameterMismatch(
      "The bound evaluation id does not match the signed evaluation.id.",
    );
  }
  return evaluation;
}

function requireBoundStudyArtifact(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  signed: VectorCorrectionDecisionParameters,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) =>
    item.name === "studyCapture"
  );
  if (
    binding?.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition("Run is not bound to a Thread studyCapture artifact.");
  }
  const reference = binding.source.reference;
  const basis = requireBasis(run);
  if (
    reference.snapshotId !== basis.snapshotId ||
    reference.snapshotRevision !== basis.revision
  ) {
    throw invalidTransition(
      "The studyCapture binding must name an artifact in the run's exact Thread basis revision.",
    );
  }
  const artifact = snapshot.artifacts.find((item) => item.id === reference.id);
  if (!artifact || artifact.freshness.status !== "fresh") {
    throw invalidTransition(
      "Bound studyCapture artifact is absent or not fresh on the execution basis.",
    );
  }
  if (artifact.id !== signed.studyCapture.artifactId) {
    throw parameterMismatch(
      "The bound studyCapture id does not match the signed studyCapture.artifactId.",
    );
  }
  if (!isSensitivityStudyResultArtifactId(artifact.id, artifact.fingerprint)) {
    throw invalidTransition(
      "The study capture artifact id must derive from its fingerprint.",
    );
  }
  return artifact;
}

function buildCorrectionSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: VectorCorrectionCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly studyArtifact: ThreadArtifact;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = `correction-proposal-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id}@${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Vector correction proposal",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: `${CORRECTION_PROPOSAL_CAPTURE_URI_PREFIX}${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.studyArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${input.studyArtifact.id}-by-${artifact.id}`,
    artifactId: input.studyArtifact.id,
    consumer: operationRef,
    observedFingerprint: input.studyArtifact.fingerprint,
    verifiedAt: sealedAt,
    status: "verified",
  };
  const extension: ThreadSnapshotExtension = {
    id: `design-apply-vector-correction-${input.run.id}`,
    name: "Seal the reviewed vector-correction document",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-${input.studyArtifact.id}-by-${artifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: input.studyArtifact.id },
      rationale:
        "The vector-correction document reopens the exact sensitivity-study capture.",
    }, {
      id: `uses-${consumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: input.studyArtifact.id },
      rationale:
        "The executor verified the exact study-capture fingerprint before sealing.",
    }],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact vector-correction document is already present in the basis snapshot.",
    );
  }
  const snapshot = validateThreadSnapshot(applied.snapshot);
  assertDocumentOnlySuccessor(snapshot, artifact);
  return { snapshot, artifact };
}

function assertDocumentOnlySuccessor(
  snapshot: ThreadSnapshot,
  sealed: ThreadArtifact,
): void {
  const added = snapshot.artifacts.filter((artifact) => artifact.id === sealed.id);
  if (
    added.length !== 1 || added[0]!.kind !== "document" ||
    added[0]!.mediaType !== "application/json"
  ) {
    throw invalidTransition(
      "The vector-correction successor must add exactly one JSON document.",
    );
  }
  if (
    snapshot.artifacts.some((artifact) =>
      artifact.id === sealed.id &&
      (artifact.kind === "step" || artifact.kind === "cad-model")
    )
  ) {
    throw invalidTransition(
      "The vector-correction seal must not write a step or cad-model Thread artifact.",
    );
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const evaluationBinding = operation?.bindings.find((item) =>
    item.name === "failingEvaluation"
  );
  const studyBinding = operation?.bindings.find((item) => item.name === "studyCapture");
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id ||
    operation.version !== DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version ||
    evaluationBinding?.source.kind !== "thread-entity" ||
    evaluationBinding.source.reference.kind !== "evaluation" ||
    studyBinding?.source.kind !== "thread-entity" ||
    studyBinding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id}@${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version} with failingEvaluation and studyCapture.`,
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
      "This executor may continue only the exact vector-correction run it claimed.",
    );
  }
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
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
        ? "No exact human-approved vector-correction decision is bound to this run basis."
        : "Ambiguous vector-correction: exactly one human-approved decision is required.",
    );
  }
  return candidates[0]!;
}

async function exactBasisSnapshot(
  snapshots: VectorCorrectionThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the vector-correction seal.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function parseSigned(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): VectorCorrectionDecisionParameters {
  try {
    return parseVectorCorrectionDecisionParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Vector-correction decision parameters are invalid: ${errorMessage(error)}`,
    );
  }
}

function unresolvedAtExecution(
  assembled: Exclude<
    ReturnType<typeof assembleVectorCorrectionDecision>,
    { readonly status: "proposed" }
  >,
): EngineeringProjectCommandError {
  const label =
    "label" in assembled && assembled.label === VECTOR_CORRECTION_UNLINKED_LABEL
      ? ` ${VECTOR_CORRECTION_UNLINKED_LABEL}`
      : "";
  return new EngineeringProjectCommandError(
    "invalid_input",
    `Vector-correction recompute is unresolved (${assembled.reason})${label}: ${assembled.detail}`,
  );
}

function parameterMismatch(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_input",
    `parameter_mismatch: ${message}`,
  );
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:design-apply-vector-correction:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: DesignApplyVectorCorrectionRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (run.status !== "completed" || !run.resultSnapshot) {
    throw invalidTransition(
      `Vector-correction run ${command.runId} did not complete through this exact execution command.`,
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

function failureCode(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("parameter_mismatch")) {
    return "design-apply-vector-correction-parameter-mismatch";
  }
  return "design-apply-vector-correction-not-published";
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
