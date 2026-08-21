/**
 * Trusted executor for `verify.evaluate-admitted-modelica-observations@1`.
 *
 * SysON is the comparator. A unit-identity mismatch stays unresolved and is
 * never converted into a local fail. The write-ahead journal records dispatch
 * before the provider call and refuses replay of an unknown outcome.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { AdmittedObservationEvidenceReader } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { OracleRequirement } from "../../../domain/kernel/proof-case.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  type AdmittedObservationSelection,
  deriveAdmittedObservationEvaluationMethod,
  fingerprintAdmittedObservationEvaluationMethod,
  selectAdmittedObservationEvaluations,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import {
  type AdmittedObservationEvaluationAdmission,
  parseAdmittedObservationEvaluationParameters,
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../domain/modelica/thermal-method-sheet.ts";
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
} from "../../../domain/project/engineering-project.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadSnapshot,
  ThreadViolation,
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
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  type AdmittedObservationEvaluationCapture,
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";
import {
  type AdmittedObservationOraclePair,
  callAdmittedObservationConstraintOracle,
  parseAdmittedObservationOracleOutcome,
} from "./admitted-observation-syson-evaluator.ts";
import type { FileAdmittedObservationEvaluationAttemptStore } from "./file-admitted-observation-evaluation-attempt-store.ts";
import type { AdmittedObservationEvaluationCaptureStore } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evaluation-capture-store.ts";

export { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION };

export interface EvaluationThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifyEvaluateAdmittedModelicaObservationsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: EvaluationThreadSnapshotStore;
  readonly sheets: ThermalMethodSheetStore;
  readonly evidence: AdmittedObservationEvidenceReader;
  readonly captures: AdmittedObservationEvaluationCaptureStore;
  readonly attempts: FileAdmittedObservationEvaluationAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
}

export class VerifyEvaluateAdmittedModelicaObservationsRunExecutor {
  constructor(
    private readonly dependencies:
      VerifyEvaluateAdmittedModelicaObservationsRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute an admitted Modelica observation evaluation.",
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
      () => this.#executeLeased(origin, command, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
    admission: AdmittedObservationEvaluationAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
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
          summary: "Started the admitted Modelica observation evaluation.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      const sealedAt = requiredStart(run);
      const dispatch = await this.#evaluate(command, admission, basisSnapshot, run);
      const captureText = canonicalAdmittedObservationEvaluationCaptureText(
        dispatch.capture,
      );
      const captureFingerprint = await sha256Fingerprint(dispatch.capture);
      await this.dependencies.captures.save(captureFingerprint, captureText);
      const readback = await this.dependencies.captures.read(captureFingerprint);
      if (readback === undefined || readback !== captureText) {
        throw new Error(
          "Admitted observation evaluation capture was not durably readable after save.",
        );
      }
      await this.dependencies.attempts.complete({
        projectId: command.projectId,
        runId: command.runId,
        completedAt: sealedAt,
        captureDigest: captureFingerprint.digest,
      });

      const successor = buildSuccessor({
        basisSnapshot,
        basis,
        run,
        capture: dispatch.capture,
        captureFingerprint,
        evaluations: dispatch.evaluations,
        violations: dispatch.violations,
      });
      await this.dependencies.snapshots.save(successor.snapshot);

      project = await this.#requiredProject(command.projectId);
      await this.dependencies.commands.publishRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "publish"),
        expectedRevision: project.revision,
        summary: "Publishing the admitted Modelica observation evaluation.",
      });
      project = await this.#requiredProject(command.projectId);
      await this.dependencies.commands.completeRun(
        origin,
        completionCommand(
          command,
          project.revision,
          successor.snapshot,
          successor.artifact,
        ),
      );
      return await this.#requiredProject(command.projectId);
    } catch (error) {
      if (claimed) {
        try {
          const project = await this.#requiredProject(command.projectId);
          await this.dependencies.commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, "fail"),
            expectedRevision: project.revision,
            summary:
              "Admitted Modelica observation evaluation stopped before Thread publication.",
            code: "verify-evaluate-admitted-modelica-observations-not-published",
            message: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    }
  }

  async #evaluate(
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
    admission: AdmittedObservationEvaluationAdmission,
    snapshot: ThreadSnapshot,
    run: EngineeringAgentRun,
  ): Promise<{
    readonly capture: AdmittedObservationEvaluationCapture;
    readonly evaluations: readonly RequirementEvaluation[];
    readonly violations: readonly ThreadViolation[];
  }> {
    const sheet = await this.dependencies.sheets.read(admission.sheet.fingerprint);
    if (!sheet) {
      throw invalidTransition("The exact thermal method sheet is unavailable.");
    }
    const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
    if (!fingerprintsEqual(sheetFingerprint, admission.sheet.fingerprint)) {
      throw invalidTransition(
        "The reopened thermal method sheet fingerprint does not match the signed admission.",
      );
    }
    const evidence = await this.dependencies.evidence.read(
      admission.evidence.fingerprint,
    );
    if (!evidence) {
      throw invalidTransition("The exact admitted Modelica evidence is unavailable.");
    }
    const unitPolicy = await admittedModelicaUnitIdentityPolicy();
    const method = deriveAdmittedObservationEvaluationMethod(sheet, unitPolicy);
    const methodFingerprint = await fingerprintAdmittedObservationEvaluationMethod(
      method,
    );
    if (!fingerprintsEqual(methodFingerprint, admission.methodFingerprint)) {
      throw invalidTransition(
        "The derived evaluation method is not the signed admission method.",
      );
    }
    selectAdmittedObservationEvaluations(
      method,
      evidence.outputs,
      evidence.metrics.map((metric) => ({
        outputName: metric.outputName,
        statistic: metric.statistic,
        unit: metric.unit,
      })),
    );
    const pairs = method.selections.flatMap((selection) => {
      const pair = oraclePair(selection, evidence.metrics, snapshot);
      return pair === undefined ? [] : [pair];
    });
    const wal = await this.dependencies.attempts.begin({
      projectId: command.projectId,
      runId: command.runId,
      dispatchedAt: requiredStart(run),
    });
    let capture: AdmittedObservationEvaluationCapture;
    if (wal.action === "completed") {
      const stored = await this.dependencies.captures.read({
        algorithm: "sha256",
        digest: wal.captureDigest,
      });
      if (stored === undefined) {
        throw invalidTransition(
          "The completed evaluation capture is unavailable for replay.",
        );
      }
      capture = validateAdmittedObservationEvaluationCapture(JSON.parse(stored));
    } else {
      capture = (await callAdmittedObservationConstraintOracle(
        this.dependencies.syson,
        pairs,
      )).capture;
    }
    const sealedAt = requiredStart(run);
    const evaluations = evaluationsFromCapture(capture, pairs, run, sealedAt);
    const freshness = {
      status: "fresh" as const,
      changedAt: sealedAt,
      invalidatedByChangeIds: [] as const,
    };
    const violations = evaluations.flatMap((evaluation) =>
      evaluation.status === "fail"
        ? [{
          id: `${evaluation.id}-violation`,
          name: `${evaluation.name} violation`,
          requirementId: evaluation.requirementId,
          evaluationId: evaluation.id,
          severity: "error" as const,
          status: "open" as const,
          detectedAt: sealedAt,
          observationIds: evaluation.observationIds,
          evidenceArtifactIds: evaluation.evidenceArtifactIds,
          summary: evaluation.message,
          freshness,
        }]
        : []
    );
    return { capture, evaluations, violations };
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

function oraclePair(
  selection: AdmittedObservationSelection,
  metrics: readonly {
    readonly outputName: string;
    readonly statistic: string;
    readonly unit: string;
    readonly value: number;
  }[],
  snapshot: ThreadSnapshot,
): AdmittedObservationOraclePair | undefined {
  const requirement = snapshot.requirements.find((item) =>
    item.id === selection.requirementElementId ||
    item.trace.elementId === selection.requirementElementId
  );
  const metric = metrics.find((item) =>
    item.outputName === selection.outputSymbolId &&
    item.statistic === selection.role
  );
  if (!requirement || !metric) return undefined;
  const operator = requirement.criterion.operator;
  if (operator !== "<=" && operator !== ">=") return undefined;
  const oracleRequirement: OracleRequirement = {
    id: requirement.id,
    name: requirement.name,
    metric: requirement.criterion.metric,
    operator,
    limit: requirement.criterion.limit,
  };
  return {
    selection,
    requirement: oracleRequirement,
    observation: { value: metric.value, unit: metric.unit },
  };
}

function evaluationsFromCapture(
  capture: AdmittedObservationEvaluationCapture,
  pairs: readonly AdmittedObservationOraclePair[],
  run: EngineeringAgentRun,
  sealedAt: string,
): RequirementEvaluation[] {
  const unresolvedIds = new Set(
    capture.unresolved.map((item) => item.requirementElementId),
  );
  const dispatched = pairs.filter((pair) =>
    !unresolvedIds.has(pair.selection.requirementElementId)
  );
  const outcomes = parseAdmittedObservationOracleOutcome(
    capture.response.structuredContent,
    dispatched,
  );
  const evaluator = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId: run.id,
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: sealedAt,
    invalidatedByChangeIds: [] as const,
  };
  const fromOracle = dispatched.map((pair) => {
    const outcome = outcomes.get(pair.requirement.id);
    const status = outcome?.status ?? "unresolved";
    return {
      id: `${pair.requirement.id}-evaluation`,
      name: `${pair.requirement.name} evaluation`,
      requirementId: pair.requirement.id,
      observationIds: [],
      status,
      evaluatedAt: sealedAt,
      evaluator,
      evidenceArtifactIds: [] as string[],
      message: status === "fail"
        ? "SysON reported the observed value exceeds the reviewed limit."
        : status === "pass"
        ? "SysON reported the observed value is within the reviewed limit."
        : status === "error"
        ? "The oracle returned an error evaluating this limit."
        : "The oracle could not resolve this limit evaluation.",
      freshness,
    };
  });
  const fromPolicy = capture.unresolved.map((item) => ({
    id: `${item.requirementElementId}-evaluation`,
    name: `${item.requirementElementId} evaluation`,
    requirementId: item.requirementElementId,
    observationIds: [],
    status: "unresolved" as const,
    evaluatedAt: sealedAt,
    evaluator,
    evidenceArtifactIds: [] as string[],
    message: "Identity unit policy left this observation unresolved. It is not a fail.",
    freshness,
  }));
  return [...fromOracle, ...fromPolicy];
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: AdmittedObservationEvaluationCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly evaluations: readonly RequirementEvaluation[];
  readonly violations: readonly ThreadViolation[];
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId =
    `modelica-admitted-observation-evaluation-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version}`,
    runId: input.run.id,
  };
  const evaluations = input.evaluations.map((evaluation) => ({
    ...evaluation,
    evidenceArtifactIds: [artifactId],
  }));
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Admitted Modelica observation evaluation",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${input.captureFingerprint.digest}`,
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
    id: `verify-evaluate-admitted-modelica-observations-${input.run.id}`,
    name: "Evaluate admitted Modelica observations",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations,
    violations: [...input.violations],
    provenance: [
      ...evaluations.flatMap((item) => [
        {
          id: `evaluates-${item.id}`,
          relation: "evaluates" as const,
          from: { kind: "evaluation" as const, id: item.id },
          to: { kind: "requirement" as const, id: item.requirementId },
          rationale:
            "The admitted observation evaluation evaluates the named Thread requirement.",
        },
        {
          id: `evidences-${item.id}`,
          relation: "evidences" as const,
          from: { kind: "evaluation" as const, id: item.id },
          to: { kind: "artifact" as const, id: artifact.id },
          rationale: "The evaluation is evidenced by the reread SysON capture.",
        },
      ]),
    ],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact admitted observation evaluation is already present in the basis snapshot.",
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
    project.schemaVersion !== "3.0" || run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id ||
    operation.version !==
      VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version} with the sole approvedBrief binding.`,
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
      approval.decidedByOrigin === "human"
    );
    if (
      approvals.length === 1 &&
      decision.baseSnapshot?.snapshotId === basis.snapshotId
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      "No exact human-approved admitted observation evaluation decision is bound to this run.",
    );
  }
  return candidates[0]!;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): AdmittedObservationEvaluationAdmission {
  try {
    return parseAdmittedObservationEvaluationParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Admitted observation evaluation parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: EvaluationThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the observation evaluation.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Evaluated the exact admitted Modelica observations.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-evaluate-admitted-modelica-observations:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
