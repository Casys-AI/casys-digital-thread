/**
 * Trusted executor for `verify.evaluate-admitted-modelica-observations@1`.
 *
 * SysON is the comparator. A unit-identity mismatch stays unresolved and is
 * never converted into a local fail. The write-ahead journal records dispatch
 * before the provider call and refuses replay of an unknown outcome.
 *
 * Authority follows the FEA seal-case / admitted-run pattern: exact Thread
 * basis including revision and subject, one human approval bound by
 * fingerprint, decision reseal, and run-input fingerprint verification.
 * Completed-WAL recovery is reachable while the project run is still
 * running or publishing. The successor consumes the admitted Modelica run
 * artifacts and method sheet already on the basis. Pass/fail materializes a
 * new Thread observation keyed by the Thread requirement metric; numeric
 * comparison fields come from the parsed SysON oracle result.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { AdmittedObservationEvidenceReader } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../application/ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { OracleRequirement } from "../../../domain/kernel/proof-case.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  type AdmittedObservationSelection,
  deriveAdmittedObservationEvaluationMethod,
  fingerprintAdmittedObservationEvaluationMethod,
  mapAdmittedObservationEvidenceBySourceIdentity,
  selectAdmittedObservationEvaluations,
  selectUniqueThreadRequirementByPair,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import {
  type AdmittedObservationEvaluationAdmission,
  parseAdmittedObservationEvaluationParameters,
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../../domain/modelica/admitted/run-proposal.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../domain/modelica/thermal-method-sheet.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import { requirementEvaluationIdentity } from "../../../domain/thread/requirement-evaluation-identity.ts";
import type {
  ProposedThreadAction,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation,
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
import {
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  type AdmittedObservationEvaluationCapture,
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";
import type { ParsedOracleResult } from "../../shared/syson-constraint-oracle-outcome.ts";
import {
  type AdmittedObservationOraclePair,
  callAdmittedObservationConstraintOracle,
  parseAdmittedObservationOracleOutcome,
} from "./admitted-observation-syson-evaluator.ts";
import type { FileAdmittedObservationEvaluationAttemptStore } from "./file-admitted-observation-evaluation-attempt-store.ts";
import type { AdmittedObservationEvaluationCaptureStore } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evaluation-capture-store.ts";
import {
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  validateModelicaThermalMethodSheetSealCapture,
} from "../thermal-method-sheet/thermal-method-sheet-seal-capture.ts";
import type { ThermalMethodSheetSealCaptureStore } from "../thermal-method-sheet/verify-seal-modelica-thermal-method-sheet-run-executor.ts";

export { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION };

const ADMITTED_RUN_TOOL =
  `${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id}@${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version}` as const;
const METHOD_SHEET_SEAL_TOOL =
  `${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version}` as const;
const EVIDENCE_ARTIFACT_ID_PREFIX = "modelica-admitted-evidence-" as const;
const CAPTURE_ARTIFACT_ID_PREFIX = "modelica-admitted-capture-" as const;
const RESULT_ARTIFACT_ID_PREFIX = "modelica-admitted-result-" as const;
const METHOD_SHEET_ARTIFACT_ID_PREFIX = "modelica-thermal-method-sheet-seal-" as const;
const CLAIM_SUMMARY = "Started the admitted Modelica observation evaluation." as const;
const PUBLISH_SUMMARY =
  "Publishing the admitted Modelica observation evaluation." as const;
const COMPLETE_SUMMARY = "Evaluated the exact admitted Modelica observations." as const;

interface AdmittedEvaluationLineage {
  readonly methodSheet: ThreadArtifact;
  readonly modelicaCapture: ThreadArtifact;
  readonly evidence: ThreadArtifact;
  readonly result: ThreadArtifact;
  readonly observations: readonly ThreadObservation[];
}

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
  readonly sourceCaptures: ThermalMethodSheetSourceCaptureReader;
  readonly captures: AdmittedObservationEvaluationCaptureStore;
  readonly sheetCaptures: ThermalMethodSheetSealCaptureStore;
  readonly attempts: FileAdmittedObservationEvaluationAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  /** Exact runtime envelope for this registered SysON evaluation. */
  readonly capabilityRuntime: CapabilityRuntimeExecutionEligibility;
  /** JIT host lifecycle; it must start before any claim or SysON call. */
  readonly capabilityRuntimeSession: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
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
    let publicationStarted = false;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
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
      await assertAdmissionScope(
        admission,
        command.projectId,
        basis,
        basisSnapshot,
        this.dependencies.sheetCaptures,
      );

      const firstClaim = run.status === "queued";
      if (!firstClaim && (run.status === "running" || run.status === "publishing")) {
        requireClaimedShape(project, run, origin);
      } else if (!firstClaim) {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }
      const operationalCapability = await this.#requireOperationalCapability(
        project,
        run,
      );
      capabilitySession = await this.#beginCapabilitySession({
        project,
        run,
        command,
        origin,
        admission,
        operationalCapability,
      });

      if (firstClaim) {
        await this.dependencies.commands.claimRun(
          origin,
          claimCommand(command),
        );
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#replayClaim(origin, command);
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed admitted observation evaluation parameters changed after the run was claimed.",
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
      await assertAdmissionScope(
        currentAdmission,
        command.projectId,
        currentBasis,
        currentBasisSnapshot,
        this.dependencies.sheetCaptures,
      );
      if (run.status === "publishing") {
        const resumed = await this.#resumePublishing(
          origin,
          command,
          currentAdmission,
          currentBasisSnapshot,
          run,
        );
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return resumed;
      }
      const sealedAt = requiredStart(run);
      const dispatch = await this.#evaluate(
        command,
        currentAdmission,
        currentBasisSnapshot,
        run,
      );
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
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: dispatch.capture,
        captureFingerprint,
        evaluations: dispatch.evaluations,
        observations: dispatch.observations,
        violations: dispatch.violations,
        proposedActions: dispatch.proposedActions,
        lineage: dispatch.lineage,
      });
      await this.dependencies.snapshots.save(successor.snapshot);
      publicationStarted = true;

      project = await this.#requiredProject(command.projectId);
      await this.#publishExact(origin, project, command);
      project = await this.#requiredProject(command.projectId);
      await this.#completeExact(origin, project, command, successor);
      const completed = await this.#requiredProject(command.projectId);
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      return completed;
    } catch (error) {
      if (claimed && !publicationStarted) {
        try {
          const project = await this.#requiredProject(command.projectId);
          const run = requireRun(project, command.runId);
          if (run.status === "running") {
            await this.dependencies.commands.failRun(origin, {
              ...command,
              commandId: commandStep(command.commandId, "fail"),
              expectedRevision: project.revision,
              summary:
                "Admitted Modelica observation evaluation stopped before Thread publication.",
              code: "verify-evaluate-admitted-modelica-observations-not-published",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } catch {
          // Preserve the original failure.
        }
      }
      const currentRun = await this.#currentRun(command.projectId, command.runId);
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: currentRun?.status === "queued"
          ? { kind: "release" }
          : { kind: "release-if-terminal", run: currentRun },
      });
      throw error;
    }
  }

  async #beginCapabilitySession(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly run: EngineeringAgentRun;
    readonly command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand;
    readonly origin: EngineeringProjectCommandOrigin;
    readonly admission: AdmittedObservationEvaluationAdmission;
    readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  }): Promise<CapabilityRuntimeExecutionSession> {
    try {
      return await beginConfiguredCapabilityRuntimeSession({
        session: this.dependencies.capabilityRuntimeSession,
        project: input.project,
        runId: input.run.id,
        operationalCapability: input.operationalCapability,
        recheck: async () => {
          const fresh = await this.#requiredProject(input.command.projectId);
          const freshRun = requireRun(fresh, input.command.runId);
          requireShape(fresh, freshRun);
          if (
            freshRun.status !== "queued" && freshRun.status !== "running" &&
            freshRun.status !== "publishing"
          ) {
            throw unexpectedStatus(
              freshRun,
              "queued or this agent's running/publishing",
            );
          }
          if (freshRun.status !== "queued") {
            requireClaimedShape(fresh, freshRun, input.origin);
          }
          const freshApproval = await requireMrtrApproval(fresh, freshRun);
          const freshAdmission = parseAdmission(freshApproval.proposal.parameters);
          if (
            deterministicJson(freshAdmission) !==
              deterministicJson(input.admission)
          ) {
            throw invalidTransition(
              "The human-reviewed admitted observation evaluation parameters changed before host activation.",
            );
          }
          const freshBasis = requireBasis(freshRun);
          const freshBasisSnapshot = await exactBasisSnapshot(
            this.dependencies.snapshots,
            freshBasis,
          );
          await assertThreadSnapshotLineageIntact(
            freshBasisSnapshot,
            this.dependencies.snapshots,
          );
          await assertAdmissionScope(
            freshAdmission,
            input.command.projectId,
            freshBasis,
            freshBasisSnapshot,
            this.dependencies.sheetCaptures,
          );
          return await this.#requireOperationalCapability(fresh, freshRun);
        },
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw invalidTransition(error.message);
      }
      throw error;
    }
  }

  async #requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ResolvedCapabilityRuntimeOperation> {
    requireShape(project, run);
    const workItem = project.workItems.find((item) => item.id === run.workItemId);
    if (!workItem) {
      throw invalidTransition(
        "The admitted Modelica observation evaluation run has no exact work item.",
      );
    }
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.dependencies.capabilityRuntime,
        session: this.dependencies.capabilityRuntimeSession,
        project,
        run,
        workItem,
        unavailableMessage:
          "Admitted Modelica observation evaluation requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Admitted Modelica observation evaluation requires the sealed syson-evaluate-requirement operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw invalidTransition(error.message);
      }
      throw error;
    }
  }

  async #currentRun(projectId: string, runId: string) {
    try {
      return requireRun(await this.#requiredProject(projectId), runId);
    } catch {
      return undefined;
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
    readonly observations: readonly ThreadObservation[];
    readonly violations: readonly ThreadViolation[];
    readonly proposedActions: readonly ProposedThreadAction[];
    readonly lineage: AdmittedEvaluationLineage;
  }> {
    const sheet = await this.dependencies.sheets.read(admission.sheet.fingerprint);
    if (!sheet) {
      throw invalidTransition("The exact thermal method sheet is unavailable.");
    }
    const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
    if (
      sheet.id !== admission.sheet.id ||
      !fingerprintsEqual(sheetFingerprint, admission.sheet.fingerprint)
    ) {
      throw invalidTransition(
        "The reopened thermal method sheet fingerprint does not match the signed admission.",
      );
    }
    const lineage = await resolveAdmittedEvaluationLineage(
      snapshot,
      admission,
      this.dependencies.sheetCaptures,
    );
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
    let source;
    try {
      source = await this.dependencies.sourceCaptures.read(
        sheet.model.sourceCaptureFingerprint,
      );
    } catch (error) {
      throw invalidTransition(
        `The reopened source capture is not an exact modelica-model identity. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!source) {
      throw invalidTransition("The exact Modelica source capture is unavailable.");
    }
    const mapped = mapAdmittedObservationEvidenceBySourceIdentity(
      method,
      source.symbols,
      evidence.outputs,
      evidence.metrics,
    );
    selectAdmittedObservationEvaluations(
      method,
      mapped.outputs,
      mapped.metrics,
    );
    const pairs = method.selections.flatMap((selection) => {
      const pair = oraclePair(selection, mapped.metrics, snapshot);
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
    const captureFingerprint = await sha256Fingerprint(capture);
    const captureArtifactId = evaluationCaptureArtifactId(
      captureFingerprint.digest,
    );
    const { evaluations, observations } = evaluationsFromCapture(
      capture,
      pairs,
      run,
      sealedAt,
      lineage,
      method.selections,
      captureArtifactId,
      captureFingerprint,
      evaluationOperationRef(run.id),
    );
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
    const proposedActions = violations.map((violation) => ({
      id: `${violation.id}-review`,
      name: `Review admitted observation evaluation violation: ${violation.name}`,
      kind: "review" as const,
      readiness: "ready" as const,
      rationale: "A human review is required for a failed engineering constraint.",
      targets: [{ kind: "artifact" as const, id: captureArtifactId }],
      addressesViolationIds: [violation.id],
      dependsOnActionIds: [] as const,
    }));
    return {
      capture,
      evaluations,
      observations,
      violations,
      proposedActions,
      lineage,
    };
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

  async #resumePublishing(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
    admission: AdmittedObservationEvaluationAdmission,
    basisSnapshot: ThreadSnapshot,
    run: EngineeringAgentRun,
  ): Promise<EngineeringProjectSnapshot> {
    const dispatch = await this.#evaluate(command, admission, basisSnapshot, run);
    const captureText = canonicalAdmittedObservationEvaluationCaptureText(
      dispatch.capture,
    );
    const captureFingerprint = await sha256Fingerprint(dispatch.capture);
    const readback = await this.dependencies.captures.read(captureFingerprint);
    if (readback === undefined || readback !== captureText) {
      throw invalidTransition(
        "The publishing admitted observation evaluation capture is unavailable for successor reconstruction.",
      );
    }
    const successor = buildSuccessor({
      basisSnapshot,
      basis: requireBasis(run),
      run,
      capture: dispatch.capture,
      captureFingerprint,
      evaluations: dispatch.evaluations,
      observations: dispatch.observations,
      violations: dispatch.violations,
      proposedActions: dispatch.proposedActions,
      lineage: dispatch.lineage,
    });
    await this.#assertSavedSuccessor(successor.snapshot);
    let project = await this.#requiredProject(command.projectId);
    await this.#publishExact(origin, project, command);
    project = await this.#requiredProject(command.projectId);
    await this.#completeExact(origin, project, command, successor);
    return await this.#requiredProject(command.projectId);
  }

  async #replayClaim(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
  ): Promise<void> {
    const project = await this.#requiredProject(command.projectId);
    const receipt = exactCommandReceipt(
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
        "The admitted observation evaluation claim receipt does not seal the run's exact claimed/start timeline.",
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
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
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
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
      const exactPublish = publishCommand(command, expectedRevision, issuedAt);
      if (run.status === "publishing" && run.summary !== exactPublish.summary) {
        throw invalidTransition(
          "The publishing admitted observation evaluation summary differs from its exact publish transition.",
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
      publishCommand(command, expectedRevision, issuedAt),
    );
  }

  async #completeExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
    successor: { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact },
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
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
      const exactCompletion = completionCommand(
        command,
        expectedRevision,
        successor.snapshot,
        successor.artifact,
        issuedAt,
      );
      if (run.summary !== exactCompletion.summary) {
        throw invalidTransition(
          "The completed admitted observation evaluation summary differs from its exact completion transition.",
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
        expectedRevision,
        successor.snapshot,
        successor.artifact,
        issuedAt,
      ),
    );
  }

  async #assertSavedSuccessor(expected: ThreadSnapshot): Promise<void> {
    const saved = await this.dependencies.snapshots.getFresh(expected.id);
    if (
      !saved ||
      deterministicJson(validateThreadSnapshot(saved)) !==
        deterministicJson(expected)
    ) {
      throw invalidTransition(
        "The publishing admitted observation evaluation has no exact saved Thread successor.",
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
        `The admitted observation evaluation ${receipt.type} receipt does not reopen its exact immutable project revision.`,
      );
    }
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
  let requirement;
  try {
    requirement = selectUniqueThreadRequirementByPair(
      snapshot.requirements,
      selection,
    );
  } catch (error) {
    throw invalidTransition(
      error instanceof Error ? error.message : String(error),
    );
  }
  const metric = metrics.find((item) =>
    item.outputName === selection.outputSymbolId &&
    item.statistic === selection.role
  );
  if (!metric) return undefined;
  const operator = requirement.criterion.operator;
  if (operator !== "<=" && operator !== ">=") return undefined;
  const oracleRequirement: OracleRequirement = {
    id: selection.requirementElementId,
    name: requirement.name,
    metric: requirement.criterion.metric,
    operator,
    limit: requirement.criterion.limit,
  };
  return {
    selection,
    requirement: oracleRequirement,
    threadRequirementId: requirement.id,
    observation: { value: metric.value, unit: metric.unit },
  };
}

function evaluationsFromCapture(
  capture: AdmittedObservationEvaluationCapture,
  pairs: readonly AdmittedObservationOraclePair[],
  run: EngineeringAgentRun,
  sealedAt: string,
  lineage: AdmittedEvaluationLineage,
  selections: readonly AdmittedObservationSelection[],
  captureArtifactId: string,
  captureFingerprint: ContentFingerprint,
  operation: ThreadOperationRef,
): {
  readonly evaluations: readonly RequirementEvaluation[];
  readonly observations: readonly ThreadObservation[];
} {
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
  const observations: ThreadObservation[] = [];
  const fromOracle: RequirementEvaluation[] = [];
  for (const pair of dispatched) {
    const outcome = outcomes.get(pair.requirement.id);
    if (outcome?.status === "pass" || outcome?.status === "fail") {
      const observation = normalizedThreadObservation({
        pair,
        oracleResult: outcome,
        captureArtifactId,
        operation,
        sealedAt,
        freshness,
      });
      observations.push(observation);
      fromOracle.push(requirementEvaluationFromOracle({
        pair,
        oracleResult: outcome,
        observation,
        captureArtifactId,
        captureFingerprint,
        evaluator,
        sealedAt,
        freshness,
      }));
      continue;
    }
    const status = outcome?.status ?? "unresolved";
    fromOracle.push({
      ...threadRequirementEvaluation(pair, captureFingerprint),
      observationIds: observationIdsFor(pair.selection, lineage),
      status,
      evaluatedAt: sealedAt,
      evaluator,
      evidenceArtifactIds: [captureArtifactId],
      message: status === "error"
        ? "The oracle returned an error evaluating this limit."
        : "The oracle could not resolve this limit evaluation.",
      freshness,
    });
  }
  const fromPolicy = capture.unresolved.map((item) => {
    const pair = uniquePairForSelection(pairs, item.requirementElementId);
    return {
      ...threadRequirementEvaluation(pair, captureFingerprint),
      observationIds: observationIdsFor(
        selections.find((selection) =>
          selection.requirementElementId === item.requirementElementId
        ),
        lineage,
      ),
      status: "unresolved" as const,
      evaluatedAt: sealedAt,
      evaluator,
      evidenceArtifactIds: [captureArtifactId],
      message:
        "Identity unit policy left this observation unresolved. It is not a fail.",
      freshness,
    };
  });
  return {
    evaluations: [...fromOracle, ...fromPolicy],
    observations,
  };
}

function normalizedThreadObservation(input: {
  readonly pair: AdmittedObservationOraclePair;
  readonly oracleResult: Extract<ParsedOracleResult, { status: "pass" | "fail" }>;
  readonly captureArtifactId: string;
  readonly operation: ThreadOperationRef;
  readonly sealedAt: string;
  readonly freshness: ThreadObservation["freshness"];
}): ThreadObservation {
  return {
    id: `${input.captureArtifactId}-${input.pair.threadRequirementId}`,
    name: `${input.pair.requirement.name} evaluated by SysON`,
    metric: input.pair.requirement.metric,
    quantity: {
      value: input.oracleResult.computedValue,
      unit: input.oracleResult.unit,
    },
    source: {
      operation: input.operation,
      artifactIds: [input.captureArtifactId],
      capturedAt: input.sealedAt,
    },
    freshness: input.freshness,
  };
}

function requirementEvaluationFromOracle(input: {
  readonly pair: AdmittedObservationOraclePair;
  readonly oracleResult: Extract<ParsedOracleResult, { status: "pass" | "fail" }>;
  readonly observation: ThreadObservation;
  readonly captureArtifactId: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly evaluator: ThreadOperationRef;
  readonly sealedAt: string;
  readonly freshness: RequirementEvaluation["freshness"];
}): RequirementEvaluation {
  return {
    ...threadRequirementEvaluation(input.pair, input.captureFingerprint),
    observationIds: [input.observation.id],
    status: input.oracleResult.status,
    evaluatedAt: input.sealedAt,
    evaluator: input.evaluator,
    comparison: {
      observationId: input.observation.id,
      actual: {
        value: input.oracleResult.computedValue,
        unit: input.oracleResult.unit,
      },
      operator: input.pair.requirement.operator,
      limit: {
        value: input.oracleResult.threshold,
        unit: input.oracleResult.unit,
      },
      normalizedUnit: input.oracleResult.unit,
      margin: {
        value: input.oracleResult.margin,
        unit: input.oracleResult.unit,
      },
    },
    evidenceArtifactIds: [input.captureArtifactId],
    message: input.oracleResult.status === "fail"
      ? "SysON reported the observed value exceeds the reviewed limit."
      : "SysON reported the observed value is within the reviewed limit.",
    freshness: input.freshness,
  };
}

function uniquePairForSelection(
  pairs: readonly AdmittedObservationOraclePair[],
  requirementElementId: string,
): AdmittedObservationOraclePair {
  const matches = pairs.filter((pair) =>
    pair.selection.requirementElementId === requirementElementId
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      matches.length === 0
        ? `Unresolved capture identity ${requirementElementId} has no Thread requirement pair.`
        : `Unresolved capture identity ${requirementElementId} is ambiguous.`,
    );
  }
  return matches[0]!;
}

function threadRequirementEvaluation(
  pair: AdmittedObservationOraclePair,
  captureFingerprint: ContentFingerprint,
): {
  readonly id: string;
  readonly name: string;
  readonly requirementId: string;
} {
  return {
    id: requirementEvaluationIdentity({
      requirementId: pair.threadRequirementId,
      evidenceFingerprint: captureFingerprint,
    }).id,
    name: `${pair.requirement.name} evaluation`,
    requirementId: pair.threadRequirementId,
  };
}

function evaluationCaptureArtifactId(digest: string): string {
  return `modelica-admitted-observation-evaluation-${digest}`;
}

function evaluationOperationRef(runId: string): ThreadOperationRef {
  return {
    serverId: "digital-thread",
    tool:
      `${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version}`,
    runId,
  };
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: AdmittedObservationEvaluationCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly evaluations: readonly RequirementEvaluation[];
  readonly observations: readonly ThreadObservation[];
  readonly violations: readonly ThreadViolation[];
  readonly proposedActions: readonly ProposedThreadAction[];
  readonly lineage: AdmittedEvaluationLineage;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = evaluationCaptureArtifactId(input.captureFingerprint.digest);
  const operationRef = evaluationOperationRef(input.run.id);
  const sourceArtifacts = [
    input.lineage.methodSheet,
    input.lineage.modelicaCapture,
    input.lineage.evidence,
    input.lineage.result,
  ];
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
    inputArtifactIds: sourceArtifacts.map((item) => item.id),
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumptions = sourceArtifacts.map((source) =>
    consumptionFor(source, artifact, operationRef, sealedAt)
  );
  const provenance: ThreadProvenanceLink[] = [
    ...sourceArtifacts.map((source) => ({
      id: `derived-from-${source.id}-by-${artifact.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: source.id },
      rationale:
        "The admitted observation evaluation reopened this exact fingerprint-attested source artifact.",
    })),
    ...consumptions.map((entry) => ({
      id: `uses-${entry.id}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: entry.id },
      to: { kind: "artifact" as const, id: entry.artifactId },
      rationale: "Exact bytes were reread and fingerprint-attested.",
    })),
    ...input.observations.flatMap((observation) =>
      observation.source.artifactIds.map((sourceArtifactId) => ({
        id: `${observation.id}-from-${sourceArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: sourceArtifactId },
        rationale:
          "The evaluated observation is reported by the exact SysON evaluation capture.",
      }))
    ),
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
      ...item.observationIds.map((observationId) => ({
        id: `${item.id}-uses-${observationId}`,
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "observation" as const, id: observationId },
        rationale: "The evaluation uses this exact observed quantity.",
      })),
    ]),
    ...input.violations.flatMap((item) => [
      {
        id: `caused-by-${item.id}`,
        relation: "caused_by" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "evaluation" as const, id: item.evaluationId },
        rationale:
          "The named violation is caused by the failing admitted observation evaluation.",
      },
      ...item.evidenceArtifactIds.map((evidenceArtifactId) => ({
        id: `evidences-${item.id}-${evidenceArtifactId}`,
        relation: "evidences" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "artifact" as const, id: evidenceArtifactId },
        rationale:
          "The named violation is evidenced by the exact SysON evaluation capture.",
      })),
    ]),
    ...input.proposedActions.flatMap((item) =>
      item.addressesViolationIds.map((violationId) => ({
        id: `addresses-${item.id}`,
        relation: "addresses" as const,
        from: { kind: "action" as const, id: item.id },
        to: { kind: "violation" as const, id: violationId },
        rationale:
          "The proposed review addresses the named admitted observation evaluation violation.",
      }))
    ),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `verify-evaluate-admitted-modelica-observations-${input.run.id}`,
    name: "Evaluate admitted Modelica observations",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions,
    observations: [...input.observations],
    requirements: [],
    evaluations,
    violations: [...input.violations],
    provenance,
    proposedActions: [...input.proposedActions],
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
      "This executor may continue only the exact admitted observation evaluation it claimed.",
    );
  }
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
        ? "No exact human-approved admitted observation evaluation decision is bound to this run basis."
        : "Ambiguous admitted observation evaluation MRTR: exactly one human-approved decision is required.",
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
      "The admitted observation evaluation decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
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
      "The admitted observation evaluation run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return selected;
}

async function assertAdmissionScope(
  admission: AdmittedObservationEvaluationAdmission,
  projectId: string,
  basis: ReturnType<typeof requireBasis>,
  snapshot: ThreadSnapshot,
  sheetCaptures: ThermalMethodSheetSealCaptureStore,
): Promise<void> {
  if (admission.projectId !== projectId) {
    throw invalidTransition(
      "The signed admitted observation evaluation belongs to another project.",
    );
  }
  if (
    admission.subjectId !== basis.subjectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The signed admitted observation evaluation basis is not the exact run Thread revision and subject.",
    );
  }
  const snapshotFingerprint = await sha256Fingerprint(snapshot);
  if (!fingerprintsEqual(snapshotFingerprint, admission.basis.fingerprint)) {
    throw invalidTransition(
      "The Thread basis fingerprint no longer matches the signed admission.",
    );
  }
  await resolveAdmittedEvaluationLineage(snapshot, admission, sheetCaptures);
}

async function resolveAdmittedEvaluationLineage(
  snapshot: ThreadSnapshot,
  admission: AdmittedObservationEvaluationAdmission,
  sheetCaptures: ThermalMethodSheetSealCaptureStore,
): Promise<AdmittedEvaluationLineage> {
  const evidence = exactFreshEvidence(snapshot, admission);
  return {
    methodSheet: await uniqueMethodSheetArtifact(
      snapshot,
      admission,
      sheetCaptures,
    ),
    modelicaCapture: uniqueAdmittedSibling(
      snapshot,
      evidence,
      "document",
      CAPTURE_ARTIFACT_ID_PREFIX,
      "admitted Modelica capture",
    ),
    evidence,
    result: uniqueAdmittedSibling(
      snapshot,
      evidence,
      "solver-result",
      RESULT_ARTIFACT_ID_PREFIX,
      "admitted Modelica result",
    ),
    observations: existingAdmittedObservations(snapshot, evidence),
  };
}

function exactFreshEvidence(
  snapshot: ThreadSnapshot,
  admission: AdmittedObservationEvaluationAdmission,
): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const artifact = snapshot.artifacts.find((item) =>
    item.id === admission.evidence.artifactId
  );
  if (
    !artifact ||
    archived.has(`artifact:${artifact.id}`) ||
    !isCanonicalFreshEvidence(artifact) ||
    !fingerprintsEqual(artifact.fingerprint, admission.evidence.fingerprint)
  ) {
    throw invalidTransition(
      "The signed admitted Modelica evidence is absent, stale, or foreign on the exact Thread basis.",
    );
  }
  return artifact;
}

function isCanonicalFreshEvidence(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.kind === "evidence" &&
    artifact.freshness.status === "fresh" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${EVIDENCE_ARTIFACT_ID_PREFIX}${digest}` &&
    artifact.version === digest &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === ADMITTED_RUN_TOOL;
}

async function uniqueMethodSheetArtifact(
  snapshot: ThreadSnapshot,
  admission: AdmittedObservationEvaluationAdmission,
  sheetCaptures: ThermalMethodSheetSealCaptureStore,
): Promise<ThreadArtifact> {
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "document" &&
    artifact.freshness.status === "fresh" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id ===
      `${METHOD_SHEET_ARTIFACT_ID_PREFIX}${artifact.fingerprint.digest}` &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === METHOD_SHEET_SEAL_TOOL &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      matches.length === 0
        ? "The exact sealed thermal method sheet is absent from the Thread basis."
        : "The Thread basis has an ambiguous thermal method-sheet seal; the server will not choose one.",
    );
  }
  const artifact = matches[0]!;
  const stored = await sheetCaptures.read(artifact.fingerprint);
  if (stored === undefined) {
    throw invalidTransition(
      "The sealed thermal method-sheet capture is unavailable.",
    );
  }
  let capture;
  try {
    capture = validateModelicaThermalMethodSheetSealCapture(JSON.parse(stored));
  } catch (error) {
    throw invalidTransition(
      `The sealed thermal method-sheet capture is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const canonical = deterministicJson(capture);
  const fingerprint = await sha256Fingerprint(capture);
  if (
    stored !== canonical ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint) ||
    artifact.uri !==
      `${MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}`
  ) {
    throw invalidTransition(
      "The sealed thermal method-sheet capture does not rehash to its Thread artifact.",
    );
  }
  if (
    capture.sheet.id !== admission.sheet.id ||
    !fingerprintsEqual(capture.sheet.fingerprint, admission.sheet.fingerprint)
  ) {
    throw invalidTransition(
      "The unique thermal method-sheet seal names a sheet that is not the signed admission.",
    );
  }
  return artifact;
}

function uniqueAdmittedSibling(
  snapshot: ThreadSnapshot,
  evidence: ThreadArtifact,
  kind: ThreadArtifact["kind"],
  idPrefix: string,
  label: string,
): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.kind === kind &&
    artifact.freshness.status === "fresh" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${idPrefix}${artifact.fingerprint.digest}` &&
    artifact.version === artifact.fingerprint.digest &&
    sameOperation(artifact.producer, evidence.producer) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      matches.length === 0
        ? `The exact ${label} produced by the admitted Modelica run is absent from the Thread basis.`
        : `The Thread basis has an ambiguous ${label}; the server will not choose one.`,
    );
  }
  return matches[0]!;
}

function existingAdmittedObservations(
  snapshot: ThreadSnapshot,
  evidence: ThreadArtifact,
): readonly ThreadObservation[] {
  return snapshot.observations.filter((observation) =>
    observation.freshness.status === "fresh" &&
    sameOperation(observation.source.operation, evidence.producer) &&
    observation.source.artifactIds.includes(evidence.id)
  );
}

function observationIdsFor(
  selection: AdmittedObservationSelection | undefined,
  lineage: AdmittedEvaluationLineage,
): readonly string[] {
  if (!selection) return [];
  const metric = `${selection.outputSymbolId}.${selection.role}`;
  const matches = lineage.observations.filter((observation) =>
    observation.metric === metric &&
    observation.source.artifactIds.includes(lineage.result.id)
  );
  if (matches.length > 1) {
    throw invalidTransition(
      `Admitted Modelica observation ${metric} is ambiguous on the Thread basis.`,
    );
  }
  return matches.length === 1 ? [matches[0]!.id] : [];
}

function consumptionFor(
  source: ThreadArtifact,
  consumerArtifact: ThreadArtifact,
  consumer: ThreadOperationRef,
  verifiedAt: string,
): ThreadArtifactConsumption {
  return {
    id: `consume-${source.id}-by-${consumerArtifact.id}`,
    artifactId: source.id,
    consumer,
    observedFingerprint: source.fingerprint,
    verifiedAt,
    status: "verified",
  };
}

function sameOperation(
  left: ThreadOperationRef,
  right: ThreadOperationRef,
): boolean {
  return left.serverId === right.serverId &&
    left.tool === right.tool &&
    left.runId === right.runId;
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

function claimCommand(
  command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    expectedRevision,
    issuedAt,
    summary: CLAIM_SUMMARY,
  };
}

function publishCommand(
  command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
  expectedRevision: number,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "publish"),
    expectedRevision,
    issuedAt,
    summary: PUBLISH_SUMMARY,
  };
}

function completionCommand(
  command: VerifyEvaluateAdmittedModelicaObservationsRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  issuedAt = command.issuedAt,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    issuedAt,
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
      `The admitted observation evaluation run has no unique exact ${type} receipt.`,
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
      `The admitted observation evaluation ${type} receipt does not seal its exact command, revision, issuance, and status transition.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-evaluate-admitted-modelica-observations:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
