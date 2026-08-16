/**
 * Trusted executor for `analyze.run-fea-sensitivity@1`.
 *
 * Two isolated CAD executions (exact admitted source + one numeric step),
 * two attested calculix_solve_static solves, finite differences from the
 * sealed case step. Publishes observations and a study capture. Never a verdict.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type {
  Build123dExecutionProfile,
  Build123dExecutionProfileCatalog,
} from "../../application/ports/out/build123d-execution-profile-catalog.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { IsolatedCodeRunner } from "../../application/ports/out/isolated-code-runner.ts";
import type { SensitivityStaticStructuralSolver } from "../../application/ports/out/sensitivity-static-structural-solver.ts";
import type { SolverInputStager } from "../../application/ports/out/solver-input-stager.ts";
import type { TechnicalCompilationAdmissionReader } from "../../application/ports/out/technical-compilation-admission-reader.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { buildSensitivityAnalysisGraph } from "../../domain/analysis/sensitivity-analysis-graph.ts";
import {
  liveSolverObservationForMetric,
  SENSITIVITY_LIVE_METRIC_UNITS,
} from "../../domain/analysis/sensitivity-live-method.ts";
import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "../../domain/analysis/sensitivity-study-proposal.ts";
import { locateModuleLevelNumericBinding } from "../../domain/analysis/sensitivity-source-substitution.ts";
import {
  computeSensitivities,
  type SensitivityMetricMeasurement,
} from "../../domain/analysis/sensitivity-study.ts";
import { substituteModuleLevelNumericLiteral } from "../../domain/analysis/sensitivity-source-substitution.ts";
import type { SensitivityStudyCaseV2 } from "../../domain/analysis/sensitivity-study-v2.ts";
import { parseSensitivityCadSourceUri } from "../../domain/analysis/sensitivity-study-v2.ts";
import { BUILD123D_EXECUTION_PROFILE } from "../../domain/analysis/build123d-execution-proposal.ts";
import { fingerprintResourceBytes } from "../../domain/analysis/provider-resource-reader.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  validateIsolatedCodeExecutionRequest,
} from "../../domain/analysis/isolated-code-execution.ts";
import {
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadObservation,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  validateSensitivityStudyCaseCapture,
} from "../captures/sensitivity-study-case-capture.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityCadPublication,
  type SensitivityStudyCapture,
  validateSensitivityStudyCapture,
} from "../../domain/analysis/sensitivity-study-capture.ts";
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../stores/thread-snapshot-lineage.ts";
import {
  type FeaSensitivityAttempt,
  FeaSensitivityOutcomeUnknownError,
  FileFeaSensitivityAttemptStore,
  type SensitivityPhase,
} from "../wal/file-fea-sensitivity-attempt-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";

export { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION };

export interface SensitivityRunThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AnalyzeRunFeaSensitivityRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: SensitivityRunThreadSnapshotStore;
  readonly caseCaptures: Pick<FileCaptureStore<"sensitivity-study-case">, "read">;
  readonly studyCaptures: Pick<
    FileCaptureStore<"sensitivity-study">,
    "save" | "read" | "uriFor"
  >;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: Build123dExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly stager: SolverInputStager;
  readonly solver: SensitivityStaticStructuralSolver;
  readonly attempts: FileFeaSensitivityAttemptStore;
  readonly lease: EngineeringProjectRunLease;
}

export class AnalyzeRunFeaSensitivityRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: AnalyzeRunFeaSensitivityRunExecutorDependencies["commands"];
  readonly #snapshots: SensitivityRunThreadSnapshotStore;
  readonly #caseCaptures:
    AnalyzeRunFeaSensitivityRunExecutorDependencies["caseCaptures"];
  readonly #studyCaptures:
    AnalyzeRunFeaSensitivityRunExecutorDependencies["studyCaptures"];
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #profiles: Build123dExecutionProfileCatalog;
  readonly #runner: IsolatedCodeRunner;
  readonly #stager: SolverInputStager;
  readonly #solver: SensitivityStaticStructuralSolver;
  readonly #attempts: FileFeaSensitivityAttemptStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(deps: AnalyzeRunFeaSensitivityRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#caseCaptures = deps.caseCaptures;
    this.#studyCaptures = deps.studyCaptures;
    this.#admissions = deps.admissions;
    this.#profiles = deps.profiles;
    this.#runner = deps.runner;
    this.#stager = deps.stager;
    this.#solver = deps.solver;
    this.#attempts = deps.attempts;
    this.#lease = deps.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the analyze-run-fea-sensitivity run.",
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
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    const preClaim = await this.#requiredProject(command.projectId);
    const preRun = requireRun(preClaim, command.runId);
    requireShape(preClaim, preRun);
    if (preRun.status === "completed") return preClaim;
    await assertThreadWriteBasisAvailable(preClaim, preRun);

    await this.#commands.claimRun(origin, {
      ...command,
      commandId: `${command.commandId}:claim`,
      summary: "Started the FEA sensitivity study run.",
    });
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, command.runId);
    if (run.status === "completed") return project;
    if (run.status !== "running" && run.status !== "publishing") {
      throw unexpectedStatus(run, "running");
    }

    try {
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      const caseArtifact = requireBoundArtifact(
        project,
        run,
        basisSnapshot,
        "studyCase",
      );
      const caseText = await this.#caseCaptures.read(caseArtifact.fingerprint);
      if (!caseText) {
        throw invalidTransition(
          "The sealed sensitivity-study case capture is not readable.",
        );
      }
      const caseCapture = await validateSensitivityStudyCaseCapture(
        JSON.parse(caseText),
      );
      const studyCase = caseCapture.studyCase;
      const admissionArtifact = findAdmissionArtifact(
        basisSnapshot,
        studyCase,
        caseCapture.admissionArtifact,
        command.projectId,
      );
      const reopened = await this.#admissions.read({
        projectId: command.projectId,
        basis,
        artifactId: admissionArtifact.id,
        artifactFingerprint: admissionArtifact.fingerprint,
      });
      if (!reopened || reopened.document.inputManifest.sources.length !== 1) {
        throw invalidTransition("The admitted Build123d source could not be reopened.");
      }
      const admitted = reopened.document.inputManifest.sources[0]!;
      const parameter = admitted.analysis.symbols.filter((symbol) =>
        symbol.name === studyCase.target.semanticKey && symbol.kind === "parameter"
      );
      if (parameter.length !== 1 || !parameter[0]!.span) {
        throw invalidTransition("The admitted source has no unique parameter binding.");
      }
      const binding = locateModuleLevelNumericBinding(
        admitted.sourceText,
        parameter[0]!.span,
        studyCase.target.semanticKey,
      );
      if (binding.value !== studyCase.baseValue.value) {
        throw invalidTransition(
          "Admitted parameter does not equal the sealed baseValue.",
        );
      }
      const steppedText = substituteModuleLevelNumericLiteral(
        admitted.sourceText,
        binding.valueSpan,
        studyCase.baseValue.value + studyCase.step.value,
      );
      if (steppedText === admitted.sourceText) {
        throw invalidTransition("The sealed step did not change the admitted source.");
      }

      const planDigest = (await sha256Fingerprint({
        caseDigest: caseCapture.caseDigest,
        cadSource: studyCase.cadSource,
        step: studyCase.step,
        executionProfile: BUILD123D_EXECUTION_PROFILE,
      })).digest;
      const attempt = await this.#attempts.prepare({
        projectId: command.projectId,
        runId: run.id,
        planDigest,
      });
      if (attempt.status === "completed" && attempt.snapshot) {
        return await this.#completeFromRecordedSnapshot(
          origin,
          command,
          run.id,
          attempt,
        );
      }

      const profile = await this.#profiles.resolve(BUILD123D_EXECUTION_PROFILE);
      const baseCad = await this.#executeCad({
        projectId: command.projectId,
        runId: run.id,
        phase: "base",
        executionRunId: `${run.id}:cad-base`,
        sourceText: admitted.sourceText,
        dispatchedAt: requiredStart(run),
        profile,
      });
      const steppedCad = await this.#executeCad({
        projectId: command.projectId,
        runId: run.id,
        phase: "stepped",
        executionRunId: `${run.id}:cad-stepped`,
        sourceText: steppedText,
        dispatchedAt: requiredStart(run),
        profile,
      });

      const baseMetrics = await this.#executeSolve({
        projectId: command.projectId,
        runId: run.id,
        phase: "base",
        studyCase,
        cad: baseCad,
        dispatchedAt: requiredStart(run),
      });
      const steppedMetrics = await this.#executeSolve({
        projectId: command.projectId,
        runId: run.id,
        phase: "stepped",
        studyCase,
        cad: steppedCad,
        dispatchedAt: requiredStart(run),
      });

      const derivatives = computeSensitivities(studyCase, baseMetrics, steppedMetrics);
      const capturedAt = requiredStart(run);
      const capture = await validateSensitivityStudyCapture({
        schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
        operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
        trustedRunId: run.id,
        caseDigest: caseCapture.caseDigest,
        studyCase,
        cad: {
          base: publicationOf(baseCad),
          stepped: publicationOf(steppedCad),
        },
        measurements: {
          base: [...baseMetrics.entries()].map(([metric, item]) => ({
            metric,
            value: item.value,
            unit: item.unit,
          })),
          stepped: [...steppedMetrics.entries()].map(([metric, item]) => ({
            metric,
            value: item.value,
            unit: item.unit,
          })),
        },
        derivatives,
        capturedAt,
      });
      const captureFingerprint = await sha256Fingerprint(capture);
      const captureText = deterministicJson(capture);
      await this.#studyCaptures.save(captureFingerprint, captureText);
      if (await this.#studyCaptures.read(captureFingerprint) !== captureText) {
        throw new Error(
          "Sensitivity study capture was not durably readable after save.",
        );
      }

      const graph = buildSensitivityAnalysisGraph({
        caseFingerprint: { algorithm: "sha256", digest: caseCapture.caseDigest },
        sensitivityCase: studyCase,
        baseMetrics,
        steppedMetrics,
        evidence: {
          capture: {
            id: `sensitivity-study-${captureFingerprint.digest}`,
            fingerprint: captureFingerprint,
          },
        },
      });
      const successor = buildStudySuccessor({
        basisSnapshot,
        basis,
        run,
        caseArtifact,
        capture,
        captureFingerprint,
        captureUri: this.#studyCaptures.uriFor(captureFingerprint),
        graph,
      });
      await this.#snapshots.save(successor.snapshot);
      const readback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !readback ||
        deterministicJson(readback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Sensitivity study ThreadSnapshot was not durably readable after save.",
        );
      }
      await this.#attempts.complete({
        projectId: command.projectId,
        runId: run.id,
        snapshot: {
          snapshotId: successor.snapshot.id,
          revision: successor.snapshot.revision,
          subjectId: basis.subjectId,
        },
      });

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: `${command.commandId}:publish`,
          expectedRevision: project.revision,
          summary: "Publishing the FEA sensitivity observations.",
        });
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: `${command.commandId}:complete`,
          expectedRevision: project.revision,
          summary: "Published FEA sensitivity observations without a verdict.",
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact",
            id: successor.artifact.id,
          }],
        });
      }
      return await this.#requiredProject(command.projectId);
    } catch (error) {
      if (!(error instanceof EngineeringProjectCommandError)) {
        await this.#recordFailure(origin, command, error);
      }
      throw error;
    }
  }

  async #completeFromRecordedSnapshot(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
    runId: string,
    attempt: FeaSensitivityAttempt,
  ): Promise<EngineeringProjectSnapshot> {
    const recorded = attempt.snapshot!;
    const snapshot = await this.#snapshots.getFresh(recorded.snapshotId);
    if (
      !snapshot ||
      snapshot.id !== recorded.snapshotId ||
      snapshot.revision !== recorded.revision ||
      snapshot.subject.id !== recorded.subjectId
    ) {
      throw invalidTransition(
        "WAL-completed sensitivity snapshot is not durably readable.",
      );
    }
    const artifact = snapshot.artifacts.find((item) =>
      item.producer.runId === runId &&
      item.producer.tool ===
        `${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id}@${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version}`
    );
    if (!artifact) {
      throw invalidTransition(
        "WAL-completed sensitivity snapshot does not carry this run's study artifact.",
      );
    }
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, runId);
    if (run.status === "running") {
      await this.#commands.publishRun(origin, {
        ...command,
        commandId: `${command.commandId}:publish`,
        expectedRevision: project.revision,
        summary: "Publishing the FEA sensitivity observations.",
      });
    }
    project = await this.#requiredProject(command.projectId);
    run = requireRun(project, runId);
    if (run.status === "publishing") {
      await this.#commands.completeRun(origin, {
        ...command,
        commandId: `${command.commandId}:complete`,
        expectedRevision: project.revision,
        summary: "Published FEA sensitivity observations without a verdict.",
        resultSnapshot: snapshotRef(snapshot),
        evidenceRefs: [{
          snapshotId: snapshot.id,
          snapshotRevision: snapshot.revision,
          kind: "artifact",
          id: artifact.id,
        }],
      });
    }
    return await this.#requiredProject(command.projectId);
  }

  /**
   * Terminal execution failure: a raw provider or runtime error (a failed
   * CalculiX solve, an isolated-runner fault) is not a recoverable
   * unknown-outcome. Mark the claimed run failed so the project append is
   * released and a successor study can be reconciled; product-level
   * EngineeringProjectCommandError guards keep their resume semantics.
   */
  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: { projectId: string; runId: string; commandId: string; issuedAt: string },
    error: unknown,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        projectId: command.projectId,
        runId: command.runId,
        issuedAt: command.issuedAt,
        commandId: `${command.commandId}:fail`,
        expectedRevision: project.revision,
        summary:
          "FEA sensitivity execution failed on a terminal provider or runtime error.",
        code: "analyze-run-fea-sensitivity-terminal-error",
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Preserve the original execution error.
    }
  }

  async #executeCad(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly executionRunId: string;
    readonly sourceText: string;
    readonly dispatchedAt: string;
    readonly profile: Build123dExecutionProfile;
  }): Promise<CadPublicationWithBytes> {
    const sourceBytes = new TextEncoder().encode(input.sourceText);
    const sourceSha256 = await fingerprintResourceBytes(sourceBytes);
    const current = await this.#attempts.read(input.projectId, input.runId);
    const slot = current?.cad[input.phase];
    if (slot?.status === "published") {
      if (slot.sourceSha256 !== sourceSha256) {
        throw invalidTransition(
          "WAL CAD sourceSha256 does not match the admitted source.",
        );
      }
      const bytes = await this.#stager.read({
        fingerprint: { algorithm: "sha256", digest: slot.stepSha256 },
        byteCount: slot.stepBytes,
      });
      if (!bytes) {
        throw invalidTransition(
          "Published sensitivity STEP is not readable from the private cache.",
        );
      }
      return {
        executionRunId: slot.executionRunId,
        sourceSha256: slot.sourceSha256,
        stepSha256: slot.stepSha256,
        stepBytes: slot.stepBytes,
        bytes,
      };
    }
    if (slot?.status === "dispatched") {
      throw unknownOutcome(
        new FeaSensitivityOutcomeUnknownError(
          `cad.${input.phase} is dispatched without a published STEP`,
        ),
      );
    }
    try {
      await this.#attempts.markCadDispatched({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        executionRunId: input.executionRunId,
        dispatchedAt: input.dispatchedAt,
        sourceSha256,
      });
    } catch (error) {
      throw unknownOutcome(error);
    }
    await validateIsolatedCodeExecutionRequest({
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: input.executionRunId,
      producerGeneration: 0,
      profile: input.profile.executionProfile,
      source: { bytes: sourceBytes, sha256: sourceSha256 },
      policy: input.profile.isolationPolicy,
      outputs: input.profile.outputManifest,
    }, input.profile.maximumSourceBytes);
    const receipt = await this.#runner.run({
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: input.executionRunId,
      producerGeneration: 0,
      profile: input.profile.executionProfile,
      source: { bytes: sourceBytes, sha256: sourceSha256 },
      policy: input.profile.isolationPolicy,
      outputs: input.profile.outputManifest,
    });
    const step = stepFromReceipt(receipt);
    // Persist the STEP into the private cache BEFORE journalling "published":
    // a published WAL slot must always be re-readable on resume, or the run
    // dead-ends fail-closed with no recovery path (observed live on dl05).
    await this.#stager.stage({
      bytes: step.bytes,
      fingerprint: { algorithm: "sha256", digest: step.sha256 },
      byteCount: step.byteCount,
    });
    await this.#attempts.markCadPublished({
      projectId: input.projectId,
      runId: input.runId,
      phase: input.phase,
      stepSha256: step.sha256,
      stepBytes: step.byteCount,
    });
    return {
      executionRunId: input.executionRunId,
      sourceSha256,
      stepSha256: step.sha256,
      stepBytes: step.byteCount,
      bytes: step.bytes,
    };
  }

  async #executeSolve(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly studyCase: SensitivityStudyCaseV2;
    readonly cad: CadPublicationWithBytes;
    readonly dispatchedAt: string;
  }): Promise<Map<string, SensitivityMetricMeasurement>> {
    const current = await this.#attempts.read(input.projectId, input.runId);
    const slot = current?.solves[input.phase];
    if (slot?.status === "solver-recorded") {
      if (slot.stepSha256 !== input.cad.stepSha256) {
        throw invalidTransition(
          "WAL solver stepSha256 does not match the published CAD STEP.",
        );
      }
      return await measurementsFromRecordedSolve(
        slot.canonicalSolverCaptureText,
        slot.captureFp,
        input.phase,
        input.cad.stepSha256,
        input.studyCase,
      );
    }
    if (slot?.status === "dispatched") {
      // The sensitivity solver is a synchronous MCP call: a dispatched slot
      // seen on resume means the previous process died or received a
      // synchronous provider error — no capture will ever arrive. Free the
      // orphan so this resume may re-dispatch.
      await this.#attempts.markSolveFailed({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
      });
    }
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: input.cad.stepSha256,
    };
    const staged = await this.#stager.stage({
      bytes: input.cad.bytes,
      fingerprint,
      byteCount: input.cad.stepBytes,
    });
    try {
      await this.#attempts.markSolveDispatched({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        dispatchedAt: input.dispatchedAt,
        stepSha256: input.cad.stepSha256,
      });
    } catch (error) {
      throw unknownOutcome(error);
    }
    const plan = this.#solver.resolve({
      declaration: input.studyCase.solver,
      inputArtifact: {
        fingerprint,
        byteCount: input.cad.stepBytes,
        stagedAsset: staged.stagedAsset,
      },
    });
    let execution;
    try {
      execution = await this.#solver.solve(plan);
    } catch (error) {
      // Synchronous provider failure: a known terminal outcome, not an
      // unknown one. Free the WAL slot so a later run can re-dispatch.
      await this.#attempts.markSolveFailed({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
      });
      throw error;
    }
    if (execution.result.inputAttestation.fingerprint.digest !== input.cad.stepSha256) {
      throw invalidTransition(
        "CalculiX input attestation does not match the staged STEP sha256.",
      );
    }
    const measurements = measurementsFromSolve(input.studyCase, execution.result);
    const envelope = deterministicJson({
      schemaVersion: SENSITIVITY_SOLVER_RESULT_SCHEMA,
      phase: input.phase,
      stepSha256: input.cad.stepSha256,
      stepBytes: input.cad.stepBytes,
      measurements: [...measurements.entries()].map(([metric, item]) => ({
        metric,
        value: item.value,
        unit: item.unit,
      })),
    });
    const captureFp = (await sha256Fingerprint(JSON.parse(envelope))).digest;
    await this.#attempts.markSolveRecorded({
      projectId: input.projectId,
      runId: input.runId,
      phase: input.phase,
      captureFp,
      canonicalSolverCaptureText: envelope,
    });
    return measurements;
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
}

const SENSITIVITY_SOLVER_RESULT_SCHEMA = "sensitivity-solver-result/1.0" as const;

interface CadPublicationWithBytes extends SensitivityCadPublication {
  readonly bytes: Uint8Array;
}

function publicationOf(cad: CadPublicationWithBytes): SensitivityCadPublication {
  return {
    executionRunId: cad.executionRunId,
    sourceSha256: cad.sourceSha256,
    stepSha256: cad.stepSha256,
    stepBytes: cad.stepBytes,
  };
}

function findAdmissionArtifact(
  snapshot: ThreadSnapshot,
  studyCase: SensitivityStudyCaseV2,
  sealedAdmission: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  },
  projectId: string,
): ThreadArtifact {
  const parsed = parseSensitivityCadSourceUri(studyCase.cadSource.artifactUri);
  if (parsed.projectId !== projectId) {
    throw invalidTransition(
      "cadSource artifact URI project id does not match the current project.",
    );
  }
  const artifact = snapshot.artifacts.find((item) => item.id === parsed.artifactId);
  if (!artifact) {
    throw invalidTransition(
      "cadSource admission is absent from the execution basis.",
    );
  }
  if (artifact.fingerprint.digest !== studyCase.cadSource.sha256) {
    throw invalidTransition(
      "cadSource sha256 does not match the Thread artifact fingerprint.",
    );
  }
  if (
    artifact.kind !== "document" ||
    artifact.producer.tool !== "compile.seal-admission@1"
  ) {
    throw invalidTransition(
      "cadSource is not a compile.seal-admission@1 admission document.",
    );
  }
  if (
    artifact.id !== sealedAdmission.id ||
    !fingerprintsEqual(artifact.fingerprint, sealedAdmission.fingerprint)
  ) {
    throw invalidTransition(
      "cadSource identity does not match the sealed case-capture admission.",
    );
  }
  return artifact;
}

async function measurementsFromRecordedSolve(
  canonicalSolverCaptureText: string,
  captureFp: string,
  phase: SensitivityPhase,
  stepSha256: string,
  studyCase: SensitivityStudyCaseV2,
): Promise<Map<string, SensitivityMetricMeasurement>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalSolverCaptureText);
  } catch {
    throw invalidTransition("WAL solver capture is not valid JSON.");
  }
  const observed = (await sha256Fingerprint(parsed)).digest;
  if (observed !== captureFp) {
    throw invalidTransition(
      "WAL solver capture fingerprint does not match the recorded digest.",
    );
  }
  const root = exactRecord(parsed, [
    "schemaVersion",
    "phase",
    "stepSha256",
    "stepBytes",
    "measurements",
  ], "$sensitivitySolverResult");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_SOLVER_RESULT_SCHEMA,
    "$sensitivitySolverResult.schemaVersion",
  );
  literalValue(root.phase, phase, "$sensitivitySolverResult.phase");
  literalValue(root.stepSha256, stepSha256, "$sensitivitySolverResult.stepSha256");
  if (!Array.isArray(root.measurements)) {
    throw invalidTransition("WAL solver capture measurements must be an array.");
  }
  const map = new Map<string, SensitivityMetricMeasurement>();
  for (const [index, item] of root.measurements.entries()) {
    const row = exactRecord(
      item,
      ["metric", "value", "unit"],
      `$sensitivitySolverResult.measurements[${index}]`,
    );
    map.set(
      safeId(row.metric, `$sensitivitySolverResult.measurements[${index}].metric`),
      {
        value: finite(
          row.value,
          `$sensitivitySolverResult.measurements[${index}].value`,
        ),
        unit: nonEmptyText(
          row.unit,
          `$sensitivitySolverResult.measurements[${index}].unit`,
        ),
      },
    );
  }
  for (const metric of studyCase.metrics) {
    const observedMetric = map.get(metric.id);
    if (!observedMetric || observedMetric.unit !== metric.unit) {
      throw invalidTransition(
        `WAL solver capture is missing sealed metric ${metric.id}.`,
      );
    }
  }
  return map;
}

function unknownOutcome(error: unknown): EngineeringProjectCommandError {
  if (error instanceof FeaSensitivityOutcomeUnknownError) {
    return new EngineeringProjectCommandError("invalid_transition", error.message);
  }
  if (error instanceof EngineeringProjectCommandError) return error;
  throw error;
}

function measurementsFromSolve(
  studyCase: SensitivityStudyCaseV2,
  result: {
    readonly observations: {
      readonly maximumDisplacement: {
        readonly magnitude: { readonly value: number; readonly unit: "mm" };
      };
      readonly maximumVonMisesStress: {
        readonly magnitude: { readonly value: number; readonly unit: "MPa" };
      };
    };
  },
): Map<string, SensitivityMetricMeasurement> {
  const map = new Map<string, SensitivityMetricMeasurement>();
  for (const metric of studyCase.metrics) {
    const expectedUnit = SENSITIVITY_LIVE_METRIC_UNITS.get(metric.id);
    if (expectedUnit === undefined) {
      throw invalidTransition(
        `Unknown metric id ${metric.id} is rejected fail-closed.`,
      );
    }
    const field = liveSolverObservationForMetric(metric.id);
    const observed = field === "maximumDisplacement"
      ? result.observations.maximumDisplacement.magnitude
      : field === "maximumVonMisesStress"
      ? result.observations.maximumVonMisesStress.magnitude
      : undefined;
    if (!observed || observed.unit !== expectedUnit || observed.unit !== metric.unit) {
      throw invalidTransition(
        `Solver measurement for ${metric.id} is missing or mistyped.`,
      );
    }
    map.set(metric.id, { value: observed.value, unit: observed.unit });
  }
  return map;
}

function stepFromReceipt(
  receipt: IsolatedCodeExecutionReceipt,
): { readonly sha256: string; readonly byteCount: number; readonly bytes: Uint8Array } {
  const output = receipt.outputs.find((item) => item.role === "geometry");
  if (!output) {
    throw invalidTransition("Isolated CAD receipt has no geometry STEP output.");
  }
  return {
    sha256: output.sha256,
    byteCount: output.byteCount,
    bytes: output.bytes.copy(),
  };
}

function requireBoundArtifact(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  name: string,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) => item.name === name);
  if (binding?.source.kind !== "thread-entity") {
    throw invalidTransition(`Run is not bound to a Thread ${name} artifact.`);
  }
  const reference = binding.source.reference as EngineeringThreadEntityRef;
  const artifact = snapshot.artifacts.find((item) => item.id === reference.id);
  if (!artifact) {
    throw invalidTransition(
      `Bound ${name} artifact is absent from the execution basis.`,
    );
  }
  return artifact;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings.find((item) => item.name === "studyCase");
  if (
    project.schemaVersion !== "3.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id ||
    operation.version !== ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version ||
    binding?.source.kind !== "thread-entity" ||
    operation.bindings.length !== 1
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to analyze.run-fea-sensitivity@1 with a studyCase artifact.`,
    );
  }
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      "Work item not found.",
    );
  }
  const basis = requireBasis(run);
  const candidates = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human"
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "No exact human-approved sensitivity-run MRTR decision is bound to this run basis.",
    );
  }
  return candidates[0]!;
}

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The queued Thread basis snapshot is not the exact declared snapshot.",
    );
  }
  return snapshot;
}

function buildStudySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly caseArtifact: ThreadArtifact;
  readonly capture: SensitivityStudyCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly graph: ReturnType<typeof buildSensitivityAnalysisGraph>;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const capturedAt = requiredStart(input.run);
  const artifactId = `sensitivity-study-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id}@${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Sensitivity study ${input.capture.studyCase.id}`,
    kind: "evidence",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.caseArtifact.id],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
  const observations: ThreadObservation[] = [
    ...input.capture.measurements.base.map((item) => ({
      id: `sensitivity-base-${item.metric}-${input.captureFingerprint.digest}`,
      name: `${item.metric} at base`,
      metric: item.metric,
      quantity: { value: item.value, unit: item.unit },
      source: {
        operation: operationRef,
        artifactIds: [artifactId],
        capturedAt,
      },
      freshness: {
        status: "fresh" as const,
        changedAt: capturedAt,
        invalidatedByChangeIds: [],
      },
    })),
    ...input.capture.derivatives.derivatives.map((item) => ({
      id: `sensitivity-d-${item.metric}-${input.captureFingerprint.digest}`,
      name: `d(${item.metric})`,
      metric: `d_${item.metric}`,
      quantity: { value: item.value, unit: item.unit },
      source: {
        operation: operationRef,
        artifactIds: [artifactId],
        capturedAt,
      },
      freshness: {
        status: "fresh" as const,
        changedAt: capturedAt,
        invalidatedByChangeIds: [],
      },
    })),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `analyze-run-fea-sensitivity-${input.run.id}`,
    name: "Run the sealed FEA sensitivity study",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [artifact],
    consumptions: [{
      id: `consume-${input.caseArtifact.id}-by-${artifactId}`,
      artifactId: input.caseArtifact.id,
      consumer: operationRef,
      observedFingerprint: input.caseArtifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    }],
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `derived-from-${input.caseArtifact.id}-by-${artifactId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifactId },
        to: { kind: "artifact", id: input.caseArtifact.id },
        rationale: "The sensitivity run consumes the sealed study-case mandate.",
      },
      {
        id: `uses-consume-${input.caseArtifact.id}-by-${artifactId}`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `consume-${input.caseArtifact.id}-by-${artifactId}`,
        },
        to: { kind: "artifact", id: input.caseArtifact.id },
        rationale: "The executor re-read the sealed study-case capture.",
      },
      ...observations.map((observation) => ({
        id: `derived-from-${artifactId}-by-${observation.id}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: artifactId },
        rationale: "The observation is derived from the sensitivity-study capture.",
      })),
    ],
    proposedActions: [],
    analysisGraph: input.graph,
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition("This exact sensitivity-study capture is already present.");
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}

function sameSnapshotBasis(
  left: { readonly snapshotId: string; readonly revision: number } | undefined,
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left?.snapshotId === right.snapshotId && left.revision === right.revision;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
