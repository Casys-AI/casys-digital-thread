/**
 * Trusted executor for `analyze.run-fea-sensitivity@1`.
 *
 * Two isolated CAD executions (exact admitted source + one numeric step),
 * two recorded `calculix_solve_static_recorded` requests with exact readback,
 * and finite differences from the sealed case step. Publishes observations and
 * a study capture. Never a verdict.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type {
  Build123dExecutionProfile,
  Build123dExecutionProfileCatalog,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeExecutionSession,
  CapabilityRuntimeExecutionSessionCoordinator,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  type SensitivityRecordedSolveCapture,
  SensitivityRecordedSolveOutcomeUnknownError,
  SensitivityRecordedSolveRejectedError,
  type SensitivityStaticStructuralSolver,
} from "../../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import type {
  CapabilitySessionSolverInputStagerFactory,
  SolverInputStager,
} from "../../../application/ports/out/solver-input-stager.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import {
  assertFailedIsolatedOutputValidationReplay,
  isolatedOutputValidationFailedMessage,
} from "../../../application/use-cases/compile/isolation/failed-isolated-output-validation-replay.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { buildSensitivityAnalysisGraph } from "../../../domain/sensitivity/live-fea/sensitivity-analysis-graph.ts";
import {
  liveSolverObservationForMetric,
  SENSITIVITY_LIVE_METRIC_UNITS,
} from "../../../domain/sensitivity/study/sensitivity-live-method.ts";
import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL } from "../../../domain/sensitivity/study/sensitivity-study-seal-bindings.ts";
import { locateModuleLevelNumericBinding } from "../../../domain/sensitivity/study/sensitivity-source-substitution.ts";
import {
  computeSensitivities,
  type SensitivityMetricMeasurement,
} from "../../../domain/sensitivity/study/sensitivity-study.ts";
import { substituteModuleLevelNumericLiteral } from "../../../domain/sensitivity/study/sensitivity-source-substitution.ts";
import type { SensitivityStudyCaseV3 } from "../../../domain/sensitivity/study/sensitivity-study-v3.ts";
import { parseSensitivityCadSourceUri } from "../../../domain/sensitivity/study/sensitivity-study-v3.ts";
import { BUILD123D_EXECUTION_PROFILE } from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeOutputValidationRejection,
  validateIsolatedCodeExecutionDestruction,
  validateIsolatedCodeExecutionRequest,
  validateIsolatedCodeOutputValidationRejection,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { safeId } from "../../../domain/kernel/case-validation.ts";
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
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadObservation,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  validateSensitivityStudyCaseCapture,
} from "../study/sensitivity-study-case-capture.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityCadPublication,
  type SensitivityStudyCapture,
  validateSensitivityStudyCapture,
} from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  makeSensitivityStudyReuseResult,
  SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX,
  validateSensitivityStudyReuseResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import {
  sensitivityExperienceExecutionPlanDigest,
  type SensitivityExperienceRecord,
  type SensitivityExperienceReuseReview,
  type SensitivityExperienceTarget,
} from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  type FeaSensitivityAttempt,
  FeaSensitivityOutcomeUnknownError,
  type FeaSensitivityRuntimeAttestation,
  FileFeaSensitivityAttemptStore,
  type SensitivityPhase,
  type SensitivitySolveSlot,
} from "./file-fea-sensitivity-attempt-store.ts";
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
import type {
  SensitivityExperienceCoordinator,
  SensitivityExperienceLookupResult,
} from "../experience/sensitivity-experience-coordinator.ts";
import type { FileSensitivityExperienceReuseAttemptStore } from "../experience/file-sensitivity-experience-reuse-attempt-store.ts";
import type { SensitivityExperienceReuseAttempt } from "../experience/file-sensitivity-experience-reuse-attempt-store.ts";

export { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION };

type SensitivityRunCommand = {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
};

export const FEA_SENSITIVITY_CAD_ISOLATED_OUTPUT_VALIDATION_FAILED = {
  summary:
    "Isolated FEA sensitivity CAD output validation was rejected before Thread publication.",
  code: "isolated_output_validation_failed",
} as const;

/**
 * Terminal FEA-sensitivity CAD conversion of a public isolated
 * output-validation rejection. It carries only the registered role, observed
 * size/digest and proven destruction; no worker diagnostic, bytes, path or
 * handle.
 */
export class IsolatedFeaSensitivityCadOutputValidationRejectedError extends Error {
  readonly code = "output_validation_rejected" as const;
  readonly executionRunId: string;
  readonly observation: IsolatedCodeOutputValidationRejection;
  readonly destruction: Extract<
    IsolatedCodeExecutionReceipt["destruction"],
    { readonly status: "proven" }
  >;

  constructor(input: {
    readonly executionRunId: string;
    readonly observation: IsolatedCodeOutputValidationRejection;
    readonly destruction: IsolatedCodeExecutionReceipt["destruction"];
  }) {
    super(
      "A code-owned isolated FEA sensitivity CAD output validator rejected the observed bytes; no redispatch occurs.",
    );
    this.name = "IsolatedFeaSensitivityCadOutputValidationRejectedError";
    this.executionRunId = safeId(input.executionRunId, "$rejection.executionRunId");
    this.observation = validateIsolatedCodeOutputValidationRejection(
      input.observation,
    );
    const destruction = validateIsolatedCodeExecutionDestruction(
      input.destruction,
      this.executionRunId,
    );
    if (destruction.status !== "proven") {
      throw new TypeError("Output-validation rejection requires proven destruction.");
    }
    this.destruction = destruction;
  }
}

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
  /** L3-only receipt of the actual server-resolved provider runtime. */
  readonly runtimeProvenanceCaptures: Pick<
    FileCaptureStore<"sensitivity-runtime-provenance">,
    "save" | "read" | "uriFor"
  >;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: Build123dExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  /** Bound after the JIT runtime session has acquired the exact group lease. */
  readonly stagerFactory: CapabilitySessionSolverInputStagerFactory;
  readonly solver: SensitivityStaticStructuralSolver;
  readonly attempts: FileFeaSensitivityAttemptStore;
  /** Cold execution-time authorization, before claim/WAL/provider/CAD. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
  readonly experience?: {
    readonly coordinator: Pick<
      SensitivityExperienceCoordinator,
      | "compileTarget"
      | "review"
      | "reopenReview"
      | "recordUnavailableReview"
      | "createReceipt"
      | "reopenReceipt"
      | "admitFresh"
    >;
    readonly attempts: Pick<
      FileSensitivityExperienceReuseAttemptStore,
      | "read"
      | "readForPlan"
      | "recordReview"
      | "replaceHitWithMiss"
      | "recordReceipt"
      | "complete"
    >;
  };
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
  readonly #runtimeProvenanceCaptures:
    AnalyzeRunFeaSensitivityRunExecutorDependencies["runtimeProvenanceCaptures"];
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #profiles: Build123dExecutionProfileCatalog;
  readonly #runner: IsolatedCodeRunner;
  readonly #stagerFactory: CapabilitySessionSolverInputStagerFactory;
  readonly #solver: SensitivityStaticStructuralSolver;
  readonly #attempts: FileFeaSensitivityAttemptStore;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;
  readonly #experience:
    | AnalyzeRunFeaSensitivityRunExecutorDependencies["experience"]
    | undefined;
  readonly #lease: EngineeringProjectRunLease;

  constructor(deps: AnalyzeRunFeaSensitivityRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#caseCaptures = deps.caseCaptures;
    this.#studyCaptures = deps.studyCaptures;
    this.#runtimeProvenanceCaptures = deps.runtimeProvenanceCaptures;
    this.#admissions = deps.admissions;
    this.#profiles = deps.profiles;
    this.#runner = deps.runner;
    this.#stagerFactory = deps.stagerFactory;
    this.#solver = deps.solver;
    this.#attempts = deps.attempts;
    this.#capabilityRuntime = deps.capabilityRuntime;
    this.#capabilityRuntimeSession = deps.capabilityRuntimeSession;
    this.#experience = deps.experience;
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
    if (preRun.status === "failed") {
      const reconstructed = await this.#reconstructKnownCadOutputValidationRejection(
        command,
      );
      if (reconstructed) {
        await this.#assertFailedOutputValidationReplay(
          origin,
          command,
          preClaim,
          preRun,
          reconstructed,
        );
        return preClaim;
      }
      throw unexpectedStatus(preRun, "queued or this agent's running/publishing");
    }
    await assertThreadWriteBasisAvailable(preClaim, preRun);
    await requireMrtrApproval(preClaim, preRun);
    const { capabilitySession, runtime } = await this.#beginCapabilitySession(
      preClaim,
      preRun,
      command.runId,
    );
    const terminal = async (result: EngineeringProjectSnapshot) => {
      await capabilitySession.releaseTerminal();
      return result;
    };

    try {
      const stager = await this.#stagerFactory.forActiveCapabilitySession({
        lease: capabilitySession.lease,
        launchGroup: runtime.launchGroup,
        material: runtime.material,
      });
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: `${command.commandId}:claim`,
        summary: "Started the FEA sensitivity study run.",
      });
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") return await terminal(project);
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }
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

      const profile = await this.#profiles.resolve(BUILD123D_EXECUTION_PROFILE);
      let experienceTarget: SensitivityExperienceTarget | undefined;
      if (this.#experience) {
        try {
          experienceTarget = await this.#experience.coordinator.compileTarget({
            studyCase,
            admission: reopened,
            build123dProfile: profile,
          });
        } catch {
          // An incomplete compiler/runtime identity disables memoization only.
          // The already authorized registered operation continues normally.
          experienceTarget = undefined;
        }
      }
      if (this.#experience && !experienceTarget) {
        const strandedReuse = await this.#experience.attempts.read(
          command.projectId,
          run.id,
        );
        if (strandedReuse && strandedReuse.status !== "reviewed-miss") {
          throw invalidTransition(
            "Sensitivity reuse identity became unavailable after an exact hit was journalled.",
          );
        }
      }
      let planDigest = experienceTarget
        ? await sensitivityExperienceExecutionPlanDigest({
          caseDigest: caseCapture.caseDigest,
          cadSource: studyCase.cadSource,
          step: studyCase.step,
          scientificKey: experienceTarget.scientificKey,
        })
        : (await sha256Fingerprint({
          caseDigest: caseCapture.caseDigest,
          cadSource: studyCase.cadSource,
          step: studyCase.step,
          executionProfile: BUILD123D_EXECUTION_PROFILE,
        })).digest;
      const existingExecutionAttempt = await this.#attempts.read(
        command.projectId,
        run.id,
      );
      if (
        existingExecutionAttempt?.status === "completed" &&
        existingExecutionAttempt.snapshot
      ) {
        return await terminal(
          await this.#completeFromRecordedSnapshot(
            origin,
            command,
            run.id,
            existingExecutionAttempt,
          ),
        );
      }
      if (existingExecutionAttempt) {
        if (this.#experience) {
          const existingReuseAttempt = await this.#experience.attempts.read(
            command.projectId,
            run.id,
          );
          if (
            existingReuseAttempt && existingReuseAttempt.status !== "reviewed-miss"
          ) {
            throw invalidTransition(
              "Sensitivity reuse is forbidden after a normal execution WAL exists.",
            );
          }
        }
        if (planDigest !== existingExecutionAttempt.planDigest) {
          // Once normal execution has a WAL, it owns recovery. A later
          // compiler/runtime change may disable future admission, but cannot
          // reinterpret or strand already dispatched effects.
          experienceTarget = undefined;
        }
        planDigest = existingExecutionAttempt.planDigest;
      }
      let missReview: SensitivityExperienceLookupResult | undefined;
      if (this.#experience && experienceTarget && !existingExecutionAttempt) {
        let reuseAttempt: SensitivityExperienceReuseAttempt | undefined;
        let memoizationDisabled = false;
        try {
          reuseAttempt = await this.#experience.attempts.readForPlan({
            projectId: command.projectId,
            runId: run.id,
            planDigest,
            scientificKey: experienceTarget.scientificKey,
          });
        } catch (error) {
          const recorded = await this.#experience.attempts.read(
            command.projectId,
            run.id,
          );
          if (recorded?.status !== "reviewed-miss") throw error;
          // A previously journalled miss remains authorization to continue the
          // normal operation. A changed compiler identity only disables reuse
          // and fresh admission for this recovery.
          reuseAttempt = recorded;
          planDigest = recorded.planDigest;
          experienceTarget = undefined;
          memoizationDisabled = true;
        }
        const reuseTarget = experienceTarget;
        if (!memoizationDisabled && !reuseTarget) {
          throw invalidTransition("Sensitivity experience target is unavailable.");
        }
        if (!memoizationDisabled && reuseAttempt?.status === "completed") {
          return await terminal(
            await this.#completeFromRecordedReuseSnapshot(
              origin,
              command,
              run.id,
              reuseAttempt,
            ),
          );
        }
        let lookup: SensitivityExperienceLookupResult | undefined;
        if (!memoizationDisabled && reuseAttempt?.status === "reviewed-miss") {
          missReview = await this.#experience.coordinator.reopenReview({
            fingerprint: reuseAttempt.reviewFingerprint,
            projectId: command.projectId,
            basis,
            basisSnapshot,
            target: reuseTarget!,
          });
        } else if (!memoizationDisabled && reuseAttempt) {
          try {
            lookup = await this.#experience.coordinator.reopenReview({
              fingerprint: reuseAttempt.reviewFingerprint,
              projectId: command.projectId,
              basis,
              basisSnapshot,
              target: reuseTarget!,
            });
          } catch (error) {
            if (reuseAttempt.status !== "reviewed-hit") throw error;
            missReview = await this.#experience.coordinator.recordUnavailableReview({
              projectId: command.projectId,
              basis,
              basisSnapshot,
              target: reuseTarget!,
              reviewedAt: requiredStart(run),
            });
            reuseAttempt = await this.#experience.attempts.replaceHitWithMiss({
              projectId: command.projectId,
              runId: run.id,
              reviewFingerprint: missReview.reviewFingerprint,
            });
          }
        } else if (!memoizationDisabled) {
          lookup = await this.#experience.coordinator.review({
            projectId: command.projectId,
            basis,
            basisSnapshot,
            target: reuseTarget!,
            reviewedAt: requiredStart(run),
          });
          reuseAttempt = await this.#experience.attempts.recordReview({
            projectId: command.projectId,
            runId: run.id,
            planDigest,
            scientificKey: reuseTarget!.scientificKey,
            reviewFingerprint: lookup.reviewFingerprint,
            hit: lookup.review.outcome === "exact",
          });
          if (lookup.review.outcome !== "exact") missReview = lookup;
        }
        if (
          !memoizationDisabled && lookup?.review.outcome === "exact" && reuseAttempt
        ) {
          return await terminal(
            await this.#completeFromExperienceReuse({
              origin,
              command,
              run,
              basis,
              basisSnapshot,
              caseArtifact,
              studyCase,
              target: reuseTarget!,
              lookup,
              attempt: reuseAttempt,
            }),
          );
        }
      }
      const attempt = await this.#attempts.prepare({
        projectId: command.projectId,
        runId: run.id,
        planDigest,
        runtime,
      });
      if (attempt.status === "completed" && attempt.snapshot) {
        return await terminal(
          await this.#completeFromRecordedSnapshot(
            origin,
            command,
            run.id,
            attempt,
          ),
        );
      }

      const baseCad = await this.#executeCad({
        projectId: command.projectId,
        runId: run.id,
        phase: "base",
        executionRunId: `${run.id}:cad-base`,
        sourceText: admitted.sourceText,
        dispatchedAt: requiredStart(run),
        profile,
        stager,
      });
      const steppedCad = await this.#executeCad({
        projectId: command.projectId,
        runId: run.id,
        phase: "stepped",
        executionRunId: `${run.id}:cad-stepped`,
        sourceText: steppedText,
        dispatchedAt: requiredStart(run),
        profile,
        stager,
      });

      const baseSolve = await this.#executeSolve({
        projectId: command.projectId,
        runId: run.id,
        phase: "base",
        studyCase,
        cad: baseCad,
        dispatchedAt: requiredStart(run),
        planDigest,
        stager,
      });
      const steppedSolve = await this.#executeSolve({
        projectId: command.projectId,
        runId: run.id,
        phase: "stepped",
        studyCase,
        cad: steppedCad,
        dispatchedAt: requiredStart(run),
        planDigest,
        stager,
      });
      const baseMetrics = baseSolve.measurements;
      const steppedMetrics = steppedSolve.measurements;

      const runtimeProvenance = recordedRuntimeProvenance({
        trustedRunId: run.id,
        runtime: attempt.runtime,
        solves: [
          { phase: "base", capture: baseSolve.capture },
          { phase: "stepped", capture: steppedSolve.capture },
        ],
      });
      const runtimeProvenanceFingerprint = await sha256Fingerprint(
        runtimeProvenance,
      );
      const runtimeProvenanceText = deterministicJson(runtimeProvenance);
      await this.#runtimeProvenanceCaptures.save(
        runtimeProvenanceFingerprint,
        runtimeProvenanceText,
      );
      if (
        await this.#runtimeProvenanceCaptures.read(runtimeProvenanceFingerprint) !==
          runtimeProvenanceText
      ) {
        throw new Error(
          "Recorded CalculiX runtime provenance was not durably readable after save.",
        );
      }

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
        runtimeProvenance: {
          fingerprint: runtimeProvenanceFingerprint,
          uri: this.#runtimeProvenanceCaptures.uriFor(runtimeProvenanceFingerprint),
        },
        graph,
        ...(missReview
          ? {
            reuseReview: {
              review: missReview.review,
              fingerprint: missReview.reviewFingerprint,
              uri: missReview.reviewUri,
            },
          }
          : {}),
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
      if (this.#experience && experienceTarget) {
        try {
          await this.#experience.coordinator.admitFresh({
            target: experienceTarget,
            capture,
            projectId: command.projectId,
            basis: {
              kind: "thread-snapshot",
              snapshotId: successor.snapshot.id,
              revision: successor.snapshot.revision,
              subjectId: successor.snapshot.subject.id,
            },
            studyArtifact: successor.artifact,
            caseArtifact,
            admissionArtifact,
            trustedRunId: run.id,
            executionPlanDigest: planDigest,
            admittedAt: capturedAt,
          });
        } catch {
          // Experience admission is an optional derived read model. A missing
          // runtime attestation or unavailable private store cannot invalidate
          // the already completed registered sensitivity execution.
        }
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
      return await terminal(await this.#requiredProject(command.projectId));
    } catch (error) {
      if (error instanceof IsolatedFeaSensitivityCadOutputValidationRejectedError) {
        return await terminal(
          await this.#failOutputValidationRejected(origin, command, error),
        );
      }
      const reconstructed = await this.#reconstructKnownCadOutputValidationRejection(
        command,
      );
      if (reconstructed) {
        return await terminal(
          await this.#failOutputValidationRejected(
            origin,
            command,
            reconstructed,
          ),
        );
      }
      if (isUncertainSensitivityExecutionError(error)) {
        capabilitySession.retainForRecovery();
        throw error;
      }
      if (!(error instanceof EngineeringProjectCommandError)) {
        await this.#recordFailure(origin, command, error);
      }
      await capabilitySession.releaseTerminal();
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

  async #completeFromExperienceReuse(input: {
    readonly origin: EngineeringProjectCommandOrigin;
    readonly command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    };
    readonly run: EngineeringAgentRun;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly basisSnapshot: ThreadSnapshot;
    readonly caseArtifact: ThreadArtifact;
    readonly studyCase: SensitivityStudyCaseV3;
    readonly target: SensitivityExperienceTarget;
    readonly lookup: SensitivityExperienceLookupResult;
    readonly attempt: SensitivityExperienceReuseAttempt;
  }): Promise<EngineeringProjectSnapshot> {
    if (!this.#experience || !input.lookup.selected) {
      throw invalidTransition("Exact sensitivity reuse has no selected experience.");
    }
    let attempt = input.attempt;
    const receipt = attempt.status === "receipt-recorded"
      ? await this.#experience.coordinator.reopenReceipt(
        attempt.receiptFingerprint,
      )
      : await this.#experience.coordinator.createReceipt({
        review: input.lookup.review,
        reviewFingerprint: input.lookup.reviewFingerprint,
        issuedAt: requiredStart(input.run),
      });
    if (attempt.status === "reviewed-hit") {
      attempt = await this.#experience.attempts.recordReceipt({
        projectId: input.command.projectId,
        runId: input.run.id,
        receiptFingerprint: receipt.receiptFingerprint,
      });
    }
    if (attempt.status !== "receipt-recorded") {
      throw invalidTransition("Sensitivity reuse receipt WAL is not resumable.");
    }
    const result = await makeSensitivityStudyReuseResult({
      trustedRunId: input.run.id,
      studyCase: input.studyCase,
      record: input.lookup.selected.record,
      reuseReceiptFingerprint: receipt.receiptFingerprint,
      capturedAt: requiredStart(input.run),
    });
    const resultFingerprint = await sha256Fingerprint(result);
    const resultText = deterministicJson(result);
    await this.#studyCaptures.save(resultFingerprint, resultText);
    if (await this.#studyCaptures.read(resultFingerprint) !== resultText) {
      throw new Error(
        "Sensitivity reuse result was not durably readable after save.",
      );
    }
    const successor = buildReuseSuccessor({
      basisSnapshot: input.basisSnapshot,
      basis: input.basis,
      run: input.run,
      caseArtifact: input.caseArtifact,
      studyCase: input.studyCase,
      caseDigest: result.caseDigest,
      record: input.lookup.selected.record,
      review: input.lookup.review,
      reviewFingerprint: input.lookup.reviewFingerprint,
      reviewUri: input.lookup.reviewUri,
      receipt: receipt.receipt,
      receiptFingerprint: receipt.receiptFingerprint,
      receiptUri: receipt.receiptUri,
      resultFingerprint,
      resultUri:
        `${SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX}${resultFingerprint.digest}`,
    });
    await this.#snapshots.save(successor.snapshot);
    const readback = await this.#snapshots.getFresh(successor.snapshot.id);
    if (
      !readback || deterministicJson(readback) !== deterministicJson(successor.snapshot)
    ) {
      throw new Error(
        "Sensitivity reuse ThreadSnapshot was not durably readable after save.",
      );
    }
    await this.#experience.attempts.complete({
      projectId: input.command.projectId,
      runId: input.run.id,
      snapshot: {
        snapshotId: successor.snapshot.id,
        revision: successor.snapshot.revision,
        subjectId: successor.snapshot.subject.id,
      },
    });
    let project = await this.#requiredProject(input.command.projectId);
    let run = requireRun(project, input.run.id);
    if (run.status === "running") {
      await this.#commands.publishRun(input.origin, {
        ...input.command,
        commandId: `${input.command.commandId}:publish`,
        expectedRevision: project.revision,
        summary: "Publishing an exact private sensitivity reuse receipt.",
      });
    }
    project = await this.#requiredProject(input.command.projectId);
    run = requireRun(project, input.run.id);
    if (run.status === "publishing") {
      await this.#commands.completeRun(input.origin, {
        ...input.command,
        commandId: `${input.command.commandId}:complete`,
        expectedRevision: project.revision,
        summary:
          "Published exact reused sensitivity observations without a fresh solve or verdict.",
        resultSnapshot: snapshotRef(successor.snapshot),
        evidenceRefs: [{
          snapshotId: successor.snapshot.id,
          snapshotRevision: successor.snapshot.revision,
          kind: "artifact",
          id: successor.resultArtifact.id,
        }],
      });
    }
    return await this.#requiredProject(input.command.projectId);
  }

  async #completeFromRecordedReuseSnapshot(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
    runId: string,
    attempt: Extract<SensitivityExperienceReuseAttempt, { status: "completed" }>,
  ): Promise<EngineeringProjectSnapshot> {
    if (!this.#experience) {
      throw invalidTransition("Sensitivity experience replay is unavailable.");
    }
    const snapshot = await this.#snapshots.getFresh(attempt.snapshot.snapshotId);
    if (
      !snapshot || snapshot.revision !== attempt.snapshot.revision ||
      snapshot.subject.id !== attempt.snapshot.subjectId
    ) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse snapshot is not durably readable.",
      );
    }
    const receiptArtifact = snapshot.artifacts.find((artifact) =>
      artifact.producer.runId === runId &&
      artifact.producer.tool === "analyze.run-fea-sensitivity@1" &&
      artifact.uri?.startsWith(
        "casys://sensitivity-experience-reuse-receipt/sha256/",
      )
    );
    if (!receiptArtifact) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse snapshot has no target receipt.",
      );
    }
    if (
      !fingerprintsEqual(receiptArtifact.fingerprint, attempt.receiptFingerprint) ||
      receiptArtifact.uri !==
        `casys://sensitivity-experience-reuse-receipt/sha256/${attempt.receiptFingerprint.digest}`
    ) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse receipt identity is divergent.",
      );
    }
    const resultArtifact = snapshot.artifacts.find((artifact) =>
      artifact.producer.runId === runId &&
      artifact.producer.tool === "analyze.run-fea-sensitivity@1" &&
      artifact.uri?.startsWith(SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX)
    );
    if (!resultArtifact) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse snapshot has no target scientific result.",
      );
    }
    if (
      resultArtifact.uri !==
        `${SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX}${resultArtifact.fingerprint.digest}`
    ) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse result identity is divergent.",
      );
    }
    const reopenedReceipt = await this.#experience.coordinator.reopenReceipt(
      attempt.receiptFingerprint,
    );
    if (
      !fingerprintsEqual(
        reopenedReceipt.receiptFingerprint,
        receiptArtifact.fingerprint,
      ) ||
      !fingerprintsEqual(
        reopenedReceipt.receipt.reviewFingerprint,
        attempt.reviewFingerprint,
      ) ||
      !fingerprintsEqual(
        reopenedReceipt.receipt.scientificKey,
        attempt.scientificKey,
      ) || reopenedReceipt.receipt.target.projectId !== command.projectId
    ) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse receipt is divergent.",
      );
    }
    const resultText = await this.#studyCaptures.read(resultArtifact.fingerprint);
    if (!resultText) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse result is not durably readable.",
      );
    }
    let result;
    try {
      result = await validateSensitivityStudyReuseResult(JSON.parse(resultText));
    } catch {
      throw invalidTransition(
        "WAL-completed sensitivity reuse result is invalid.",
      );
    }
    if (
      resultText !== deterministicJson(result) || result.trustedRunId !== runId ||
      !fingerprintsEqual(
        result.reuseReceiptFingerprint,
        attempt.receiptFingerprint,
      )
    ) {
      throw invalidTransition(
        "WAL-completed sensitivity reuse result is divergent.",
      );
    }
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, runId);
    if (run.status === "running") {
      await this.#commands.publishRun(origin, {
        ...command,
        commandId: `${command.commandId}:publish`,
        expectedRevision: project.revision,
        summary: "Publishing an exact private sensitivity reuse receipt.",
      });
    }
    project = await this.#requiredProject(command.projectId);
    run = requireRun(project, runId);
    if (run.status === "publishing") {
      await this.#commands.completeRun(origin, {
        ...command,
        commandId: `${command.commandId}:complete`,
        expectedRevision: project.revision,
        summary:
          "Published exact reused sensitivity observations without a fresh solve or verdict.",
        resultSnapshot: snapshotRef(snapshot),
        evidenceRefs: [{
          snapshotId: snapshot.id,
          snapshotRevision: snapshot.revision,
          kind: "artifact",
          id: resultArtifact.id,
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
      if (await this.#reconstructKnownCadOutputValidationRejection(command)) {
        return;
      }
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

  async #failOutputValidationRejected(
    origin: EngineeringProjectCommandOrigin,
    command: SensitivityRunCommand,
    error: IsolatedFeaSensitivityCadOutputValidationRejectedError,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status === "failed") {
      await this.#assertFailedOutputValidationReplay(
        origin,
        command,
        project,
        run,
        error,
      );
      return project;
    }
    if (run.status !== "running") {
      throw unexpectedStatus(run, "running");
    }
    if (run.resultSnapshot || run.evidenceRefs.length !== 0) {
      throw invalidTransition(
        "The claimed FEA sensitivity run already carries Thread evidence and cannot take an evidence-free terminal failure.",
      );
    }
    const startedAt = run.startedAt;
    await this.#commands.failRun(
      origin,
      failCommand(command, isolatedOutputValidationFailure(error), project.revision),
    );
    const failed = await this.#requiredProject(command.projectId);
    await this.#assertFailedOutputValidationReplay(
      origin,
      command,
      failed,
      requireRun(failed, command.runId),
      error,
      startedAt,
    );
    return failed;
  }

  async #assertFailedOutputValidationReplay(
    origin: EngineeringProjectCommandOrigin,
    command: SensitivityRunCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    error: IsolatedFeaSensitivityCadOutputValidationRejectedError,
    originalStartedAt = run.startedAt,
  ): Promise<void> {
    const failure = isolatedOutputValidationFailure(error);
    await assertFailedIsolatedOutputValidationReplay({
      project,
      run,
      origin,
      originalStartedAt,
      failure,
      claimCommandId: `${command.commandId}:claim`,
      failCommandId: `${command.commandId}:fail`,
      buildClaimCommand: (expectedRevision, issuedAt) =>
        claimCommand(command, expectedRevision, issuedAt),
      buildFailCommand: (expectedRevision, issuedAt) =>
        failCommand(command, failure, expectedRevision, issuedAt),
    });
  }

  async #reconstructKnownCadOutputValidationRejection(command: {
    readonly projectId: string;
    readonly runId: string;
  }): Promise<IsolatedFeaSensitivityCadOutputValidationRejectedError | undefined> {
    const attempt = await this.#attempts.read(command.projectId, command.runId);
    for (const phase of ["base", "stepped"] as const) {
      const slot = attempt?.cad[phase];
      if (slot?.status === "output-validation-rejected") {
        return new IsolatedFeaSensitivityCadOutputValidationRejectedError({
          executionRunId: slot.executionRunId,
          observation: slot.observation,
          destruction: slot.destruction,
        });
      }
    }
    return undefined;
  }

  async #executeCad(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly executionRunId: string;
    readonly sourceText: string;
    readonly dispatchedAt: string;
    readonly profile: Build123dExecutionProfile;
    readonly stager: SolverInputStager;
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
      const bytes = await input.stager.read({
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
    if (slot?.status === "output-validation-rejected") {
      throw new IsolatedFeaSensitivityCadOutputValidationRejectedError({
        executionRunId: slot.executionRunId,
        observation: slot.observation,
        destruction: slot.destruction,
      });
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
    let receipt: IsolatedCodeExecutionReceipt;
    try {
      receipt = await this.#runner.run({
        schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
        runId: input.executionRunId,
        producerGeneration: 0,
        profile: input.profile.executionProfile,
        source: { bytes: sourceBytes, sha256: sourceSha256 },
        policy: input.profile.isolationPolicy,
        outputs: input.profile.outputManifest,
      });
    } catch (error) {
      if (error instanceof IsolatedCodeOutputValidationRejectedError) {
        if (
          error.destruction.status !== "proven" ||
          error.destruction.runId !== input.executionRunId
        ) {
          throw invalidTransition(
            "Isolated FEA sensitivity CAD output-validation cleanup is not proven; no redispatch occurs.",
          );
        }
        try {
          await this.#attempts.markCadOutputValidationRejected({
            projectId: input.projectId,
            runId: input.runId,
            phase: input.phase,
            observation: error.observation,
            destruction: error.destruction,
            registeredRoles: input.profile.outputManifest.map((output) => output.role),
          });
        } catch (markError) {
          const current = await this.#attempts.read(input.projectId, input.runId);
          const slot = current?.cad[input.phase];
          if (
            slot?.status === "output-validation-rejected" &&
            slot.executionRunId === input.executionRunId
          ) {
            throw new IsolatedFeaSensitivityCadOutputValidationRejectedError({
              executionRunId: slot.executionRunId,
              observation: slot.observation,
              destruction: slot.destruction,
            });
          }
          throw markError;
        }
        throw new IsolatedFeaSensitivityCadOutputValidationRejectedError({
          executionRunId: input.executionRunId,
          observation: error.observation,
          destruction: error.destruction,
        });
      }
      throw unknownOutcome(error);
    }
    const step = stepFromReceipt(receipt);
    // Persist the STEP into the private cache BEFORE journalling "published":
    // a published WAL slot must always be re-readable on resume, or the run
    // dead-ends fail-closed with no recovery path.
    await input.stager.stage({
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
    readonly studyCase: SensitivityStudyCaseV3;
    readonly cad: CadPublicationWithBytes;
    readonly dispatchedAt: string;
    readonly planDigest: string;
    readonly stager: SolverInputStager;
  }): Promise<SensitivitySolveExecution> {
    const current = await this.#attempts.read(input.projectId, input.runId);
    const slot = current?.solves[input.phase];
    if (!current || !slot) {
      throw invalidTransition(
        "FEA sensitivity execution WAL is absent before a recorded solve.",
      );
    }
    if (slot.status === "rejected") {
      throw new SensitivityRecordedSolveRejectedError(
        `Recorded CalculiX ${input.phase} solve was terminally rejected: ${slot.reason}`,
      );
    }
    if (slot.status === "captured") {
      assertSolveStep(slot, input.cad, input.phase);
      const capture = await this.#solver.reopenCapture(
        slot.canonicalSolveCaptureText,
      );
      assertRecordedCapture(capture, input);
      if (capture.fingerprint.digest !== slot.captureFp) {
        throw invalidTransition(
          "WAL recorded CalculiX capture fingerprint does not match the reopened capture.",
        );
      }
      return {
        measurements: measurementsFromSolve(input.studyCase, capture.result),
        capture,
      };
    }
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: input.cad.stepSha256,
    };
    const staged = await input.stager.stage({
      bytes: input.cad.bytes,
      fingerprint,
      byteCount: input.cad.stepBytes,
    });
    const plan = await this.#solver.resolve({
      method: input.studyCase.method,
      inputArtifact: {
        fingerprint,
        byteCount: input.cad.stepBytes,
        stagedAsset: staged.stagedAsset,
      },
      execution: {
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        planDigest: input.planDigest,
      },
    });
    if (
      plan.inputArtifact.fingerprint.digest !== input.cad.stepSha256 ||
      plan.inputArtifact.byteCount !== input.cad.stepBytes || plan.phase !== input.phase
    ) {
      throw invalidTransition(
        "Server-owned recorded CalculiX plan does not match the exact CAD STEP.",
      );
    }

    if (slot.status === "idle") {
      try {
        await this.#attempts.markSolvePrepared({
          projectId: input.projectId,
          runId: input.runId,
          phase: input.phase,
          preparedAt: input.dispatchedAt,
          stepSha256: input.cad.stepSha256,
          stepBytes: input.cad.stepBytes,
          requestId: plan.requestId,
        });
      } catch (error) {
        // A durable preparation is the hard no-redispatch boundary. If its
        // write is ambiguous, recovery must inspect the same run/WAL rather
        // than infer that no provider call was possible.
        throw new FeaSensitivityOutcomeUnknownError(
          `Could not durably prepare recorded CalculiX ${input.phase} request ${plan.requestId}: ${
            errorMessage(error)
          }`,
        );
      }
      // This is the only branch allowed to call the recorded solve tool. Once
      // prepared exists, even an acknowledgement loss is recovered through
      // calculix_run_get using the same request id.
      let dispatch;
      try {
        dispatch = await this.#solver.dispatch(plan);
      } catch (error) {
        if (error instanceof SensitivityRecordedSolveRejectedError) {
          await this.#recordKnownSolveRejection(input, error);
        }
        throw error;
      }
      await this.#markSolveDispatched(input, dispatch);
      return await this.#readbackAndCaptureSolve(input, plan, dispatch);
    }

    assertSolveStep(slot, input.cad, input.phase);
    if (slot.requestId !== plan.requestId) {
      throw new FeaSensitivityOutcomeUnknownError(
        `WAL recorded CalculiX ${input.phase} request id differs from the server-derived request id.`,
      );
    }
    if (slot.status === "prepared") {
      // Do not infer that a prior process stopped before dispatch. It may have
      // dispatched and lost the acknowledgement, so readback is the only safe
      // action for this request id.
      const readback = await this.#readback(input, plan);
      await this.#markSolveDispatched(input, readback);
      return await this.#captureReadback(input, readback);
    }
    if (slot.status === "dispatched") {
      return await this.#readbackAndCaptureSolve(input, plan, {
        requestId: slot.requestId,
        runId: slot.providerRunId,
        requestSha256: slot.requestSha256,
      });
    }
    if (slot.status === "readback-recorded") {
      const readback = await this.#solver.reopenReadback(slot.canonicalReadbackText);
      if (readback.fingerprint.digest !== slot.readbackFp) {
        throw invalidTransition(
          "WAL recorded CalculiX readback fingerprint does not match the reopened readback.",
        );
      }
      return await this.#captureReadback(input, readback);
    }
    throw invalidTransition(`Unknown recorded CalculiX ${input.phase} WAL state.`);
  }

  async #readbackAndCaptureSolve(
    input: SensitivitySolveInputForExecutor,
    plan: Awaited<ReturnType<SensitivityStaticStructuralSolver["resolve"]>>,
    expected: {
      readonly requestId: string;
      readonly runId: string;
      readonly requestSha256: string;
    },
  ): Promise<SensitivitySolveExecution> {
    const readback = await this.#readback(input, plan, expected);
    return await this.#captureReadback(input, readback);
  }

  async #readback(
    input: SensitivitySolveInputForExecutor,
    plan: Awaited<ReturnType<SensitivityStaticStructuralSolver["resolve"]>>,
    expected?: {
      readonly requestId: string;
      readonly runId: string;
      readonly requestSha256: string;
    },
  ): Promise<Awaited<ReturnType<SensitivityStaticStructuralSolver["readback"]>>> {
    try {
      return await this.#solver.readback(plan, expected);
    } catch (error) {
      if (error instanceof SensitivityRecordedSolveRejectedError) {
        await this.#recordKnownSolveRejection(input, error);
      }
      throw error;
    }
  }

  async #markSolveDispatched(
    input: SensitivitySolveInputForExecutor,
    dispatch: {
      readonly runId: string;
      readonly requestSha256: string;
    },
  ): Promise<void> {
    try {
      await this.#attempts.markSolveDispatched({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        dispatchedAt: input.dispatchedAt,
        providerRunId: dispatch.runId,
        requestSha256: dispatch.requestSha256,
      });
    } catch (error) {
      throw new FeaSensitivityOutcomeUnknownError(
        `Recorded CalculiX ${input.phase} acknowledgement could not be durably journalled: ${
          errorMessage(error)
        }`,
      );
    }
  }

  async #recordKnownSolveRejection(
    input: SensitivitySolveInputForExecutor,
    rejection: SensitivityRecordedSolveRejectedError,
  ): Promise<void> {
    try {
      await this.#attempts.markSolveRejected({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        rejectedAt: input.dispatchedAt,
        reason: rejection.message,
      });
    } catch (error) {
      throw new FeaSensitivityOutcomeUnknownError(
        `Recorded CalculiX ${input.phase} rejection could not be durably journalled: ${
          errorMessage(error)
        }`,
      );
    }
  }

  async #captureReadback(
    input: SensitivitySolveInputForExecutor,
    readback: Awaited<ReturnType<SensitivityStaticStructuralSolver["readback"]>>,
  ): Promise<SensitivitySolveExecution> {
    assertRecordedReadback(readback, input);
    try {
      await this.#attempts.markSolveReadbackRecorded({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        readbackFp: readback.fingerprint.digest,
        canonicalReadbackText: readback.canonicalText,
      });
    } catch (error) {
      throw new FeaSensitivityOutcomeUnknownError(
        `Recorded CalculiX ${input.phase} completed readback could not be durably journalled: ${
          errorMessage(error)
        }`,
      );
    }
    let capture: SensitivityRecordedSolveCapture;
    try {
      capture = await this.#solver.capture(readback, input.studyCase.method);
    } catch (error) {
      if (error instanceof SensitivityRecordedSolveRejectedError) {
        await this.#recordKnownSolveRejection(input, error);
      }
      throw error;
    }
    assertRecordedCapture(capture, input);
    try {
      await this.#attempts.markSolveCaptured({
        projectId: input.projectId,
        runId: input.runId,
        phase: input.phase,
        captureFp: capture.fingerprint.digest,
        canonicalSolveCaptureText: capture.canonicalText,
      });
    } catch (error) {
      throw new FeaSensitivityOutcomeUnknownError(
        `Recorded CalculiX ${input.phase} CAS capture could not be durably journalled: ${
          errorMessage(error)
        }`,
      );
    }
    return {
      measurements: measurementsFromSolve(input.studyCase, capture.result),
      capture,
    };
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

  /**
   * Resolve and recheck the server-selected runtime before the project run is
   * claimed.  This deliberately has no fallback to endpoint/image options:
   * absent authorization, qualification, host state, or session wiring leaves
   * project, execution WAL, CAD and provider untouched.
   */
  async #beginCapabilitySession(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    runId: string,
  ): Promise<{
    readonly capabilitySession: CapabilityRuntimeExecutionSession;
    readonly runtime: FeaSensitivityRuntimeAttestation;
  }> {
    if (!this.#capabilityRuntime || !this.#capabilityRuntimeSession) {
      throw invalidTransition(
        "Recorded CalculiX sensitivity execution requires the configured JIT capability runtime session before a run can be claimed.",
      );
    }
    const context = requireSensitivityExecutionContext(project, run);
    const operationalCapability = await this.#capabilityRuntime.requireExecution({
      project,
      run,
      workItem: context.workItem,
      operation: context.operation,
    });
    if (!operationalCapability) {
      throw invalidTransition(
        "Recorded CalculiX sensitivity execution has no authorized qualified operational capability binding.",
      );
    }
    const runtime = await sensitivityRuntimeAttestation(operationalCapability);
    const capabilitySession = await this.#capabilityRuntimeSession.begin({
      project,
      runId,
      operationalCapability,
      microsandboxExecutionProfiles: [],
      recheck: async () => {
        const currentProject = await this.#requiredProject(project.project.id);
        const currentRun = requireRun(currentProject, runId);
        requireShape(currentProject, currentRun);
        const current = requireSensitivityExecutionContext(currentProject, currentRun);
        const rechecked = await this.#capabilityRuntime!.requireExecution({
          project: currentProject,
          run: currentRun,
          workItem: current.workItem,
          operation: current.operation,
        });
        if (!rechecked) {
          throw invalidTransition(
            "Recorded CalculiX sensitivity execution lost its required operational capability binding before host activation.",
          );
        }
        return rechecked;
      },
    });
    return { capabilitySession, runtime };
  }
}

interface CadPublicationWithBytes extends SensitivityCadPublication {
  readonly bytes: Uint8Array;
}

interface SensitivitySolveInputForExecutor {
  readonly projectId: string;
  readonly runId: string;
  readonly phase: SensitivityPhase;
  readonly studyCase: SensitivityStudyCaseV3;
  readonly cad: CadPublicationWithBytes;
  readonly dispatchedAt: string;
  readonly planDigest: string;
}

interface SensitivitySolveExecution {
  readonly measurements: Map<string, SensitivityMetricMeasurement>;
  readonly capture: SensitivityRecordedSolveCapture;
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
  studyCase: SensitivityStudyCaseV3,
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
    artifact.producer.tool !== SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL
  ) {
    throw invalidTransition(
      `cadSource is not a ${SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL} admission document.`,
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

function assertSolveStep(
  slot: Exclude<SensitivitySolveSlot, { readonly status: "idle" }>,
  cad: CadPublicationWithBytes,
  phase: SensitivityPhase,
): void {
  if (slot.stepSha256 !== cad.stepSha256 || slot.stepBytes !== cad.stepBytes) {
    throw invalidTransition(
      `WAL recorded CalculiX ${phase} STEP does not match the published CAD STEP.`,
    );
  }
}

function assertRecordedReadback(
  readback: Awaited<ReturnType<SensitivityStaticStructuralSolver["readback"]>>,
  input: SensitivitySolveInputForExecutor,
): void {
  if (
    readback.phase !== input.phase ||
    readback.stepSha256 !== input.cad.stepSha256 ||
    readback.stepBytes !== input.cad.stepBytes
  ) {
    throw invalidTransition(
      "Recorded CalculiX readback does not bind the exact published CAD STEP.",
    );
  }
}

function assertRecordedCapture(
  capture: SensitivityRecordedSolveCapture,
  input: SensitivitySolveInputForExecutor,
): void {
  assertRecordedReadback(capture.readback, input);
  if (capture.canonicalText !== deterministicJson(JSON.parse(capture.canonicalText))) {
    throw invalidTransition("Recorded CalculiX capture is not canonical.");
  }
}

function isUncertainSensitivityExecutionError(error: unknown): boolean {
  return error instanceof FeaSensitivityOutcomeUnknownError ||
    error instanceof SensitivityRecordedSolveOutcomeUnknownError;
}

function requireSensitivityExecutionContext(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  readonly workItem: EngineeringWorkItem;
  readonly operation: EngineeringOperationRef;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem?.operation) {
    throw invalidTransition(
      "FEA sensitivity run has no exact registered work-item operation.",
    );
  }
  if (
    workItem.operation.id !== ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id ||
    workItem.operation.version !== ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version
  ) {
    throw invalidTransition(
      "FEA sensitivity run is bound to another registered operation.",
    );
  }
  return { workItem, operation: workItem.operation };
}

async function sensitivityRuntimeAttestation(
  operationalCapability: ResolvedCapabilityRuntimeOperation,
): Promise<FeaSensitivityRuntimeAttestation> {
  const matches = operationalCapability.bindings.filter((binding) =>
    binding.capability.id ===
      MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY.id &&
    binding.capability.version ===
      MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY.version &&
    binding.capability.use === "execution"
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      "Recorded CalculiX sensitivity runtime must resolve exactly one execution binding.",
    );
  }
  const binding = matches[0]!;
  const lifecycles = binding.hostLifecycles.filter((lifecycle) =>
    lifecycle.kind === "persistent-compose" && lifecycle.launchGroup !== null
  );
  if (lifecycles.length !== 1) {
    throw invalidTransition(
      "Recorded CalculiX sensitivity runtime must resolve exactly one persistent launch group material.",
    );
  }
  const lifecycle = lifecycles[0]!;
  const material = binding.materials.find((candidate) =>
    candidate.unitId === lifecycle.material.unitId &&
    candidate.materialId === lifecycle.material.materialId &&
    candidate.imageDigest === lifecycle.material.imageDigest
  );
  if (!material || binding.materials.length !== 1) {
    throw invalidTransition(
      "Recorded CalculiX sensitivity runtime material is not an exact single binding material.",
    );
  }
  return {
    operationalCapabilityFingerprint:
      await fingerprintResolvedCapabilityRuntimeOperation(
        operationalCapability,
      ),
    binding: { id: binding.binding.id, version: binding.binding.version },
    material: {
      unitId: material.unitId,
      materialId: material.materialId,
      imageDigest: material.imageDigest,
    },
    launchGroup: lifecycle.launchGroup!,
  };
}

function isolatedOutputValidationFailure(
  error: IsolatedFeaSensitivityCadOutputValidationRejectedError,
): {
  readonly summary: string;
  readonly code: string;
  readonly message: string;
} {
  return {
    summary: FEA_SENSITIVITY_CAD_ISOLATED_OUTPUT_VALIDATION_FAILED.summary,
    code: FEA_SENSITIVITY_CAD_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
    message: isolatedOutputValidationFailedMessage(error.observation),
  };
}

function claimCommand(
  command: SensitivityRunCommand,
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: `${command.commandId}:claim`,
    expectedRevision,
    issuedAt,
    summary: "Started the FEA sensitivity study run.",
  };
}

function failCommand(
  command: SensitivityRunCommand,
  failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  },
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): FailRunCommand {
  return {
    ...command,
    commandId: `${command.commandId}:fail`,
    expectedRevision,
    issuedAt,
    summary: failure.summary,
    code: failure.code,
    message: failure.message,
  };
}

function unknownOutcome(error: unknown): EngineeringProjectCommandError {
  if (error instanceof FeaSensitivityOutcomeUnknownError) {
    return new EngineeringProjectCommandError("invalid_transition", error.message);
  }
  if (error instanceof EngineeringProjectCommandError) return error;
  throw error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function measurementsFromSolve(
  studyCase: SensitivityStudyCaseV3,
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
    project.schemaVersion !== "4.0" ||
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

/**
 * L3 provenance only. This records the actual resolved capability attestation
 * already sealed into the execution WAL plus each completed recorded-run
 * identity and ordered resource-capture receipt. It does not claim a solver
 * verdict, provider qualification, or an engineering evaluation.
 */
function recordedRuntimeProvenance(input: {
  readonly trustedRunId: string;
  readonly runtime: FeaSensitivityRuntimeAttestation;
  readonly solves: readonly {
    readonly phase: SensitivityPhase;
    readonly capture: SensitivityRecordedSolveCapture;
  }[];
}) {
  if (
    input.solves.length !== 2 || input.solves[0]?.phase !== "base" ||
    input.solves[1]?.phase !== "stepped"
  ) {
    throw invalidTransition(
      "Recorded CalculiX runtime provenance requires exactly base then stepped captures.",
    );
  }
  return {
    schemaVersion: "sensitivity-runtime-provenance/1.0" as const,
    trustedRunId: safeId(input.trustedRunId, "$runtimeProvenance.trustedRunId"),
    runtime: input.runtime,
    solves: input.solves.map(({ phase, capture }) => ({
      phase,
      requestId: capture.readback.requestId,
      providerRunId: capture.readback.runId,
      requestSha256: capture.readback.requestSha256,
      readbackFingerprint: capture.readback.fingerprint,
      providerManifestFingerprint: capture.providerCapture.manifestFingerprint,
      providerManifestUri: capture.providerCapture.manifestUri,
      orderedResourceSequenceFingerprint:
        capture.providerCapture.artifactSequenceFingerprint,
      requestResourceFingerprint:
        capture.providerCapture.requestBinding.requestResourceFingerprint,
      loweredRequestFingerprint:
        capture.providerCapture.requestBinding.loweredRequestFingerprint,
      executionIdentityFingerprint:
        capture.providerCapture.requestBinding.executionIdentityFingerprint,
      solveCaptureFingerprint: capture.fingerprint,
    })),
  };
}

function buildStudySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly caseArtifact: ThreadArtifact;
  readonly capture: SensitivityStudyCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  /** L3-only provenance of the exact server-resolved runtime and bundle. */
  readonly runtimeProvenance: {
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
  readonly graph: ReturnType<typeof buildSensitivityAnalysisGraph>;
  readonly reuseReview?: {
    readonly review: SensitivityExperienceReuseReview;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
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
    inputArtifactIds: [
      input.caseArtifact.id,
      `sensitivity-runtime-${input.runtimeProvenance.fingerprint.digest}`,
    ],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
  const runtimeArtifact: ThreadArtifact = {
    id: `sensitivity-runtime-${input.runtimeProvenance.fingerprint.digest}`,
    name: "Recorded CalculiX sensitivity runtime provenance",
    kind: "evidence",
    version: input.runtimeProvenance.fingerprint.digest,
    fingerprint: input.runtimeProvenance.fingerprint,
    uri: input.runtimeProvenance.uri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.caseArtifact.id],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
  const reviewArtifact: ThreadArtifact | undefined = input.reuseReview
    ? {
      id: `sensitivity-reuse-review-${input.reuseReview.fingerprint.digest}`,
      name: "Private sensitivity reuse miss review",
      kind: "document",
      version: input.reuseReview.fingerprint.digest,
      fingerprint: input.reuseReview.fingerprint,
      uri: input.reuseReview.uri,
      mediaType: "application/json",
      producer: operationRef,
      inputArtifactIds: [input.caseArtifact.id],
      freshness: {
        status: "fresh",
        changedAt: capturedAt,
        invalidatedByChangeIds: [],
      },
    }
    : undefined;
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
    artifacts: [runtimeArtifact, artifact, ...(reviewArtifact ? [reviewArtifact] : [])],
    consumptions: [{
      id: `consume-${input.caseArtifact.id}-by-${artifactId}`,
      artifactId: input.caseArtifact.id,
      consumer: operationRef,
      observedFingerprint: input.caseArtifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    }, {
      id: `consume-${runtimeArtifact.id}-by-${artifactId}`,
      artifactId: runtimeArtifact.id,
      consumer: operationRef,
      observedFingerprint: runtimeArtifact.fingerprint,
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
        id: `derived-from-${input.caseArtifact.id}-by-${runtimeArtifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: runtimeArtifact.id },
        to: { kind: "artifact", id: input.caseArtifact.id },
        rationale:
          "The runtime provenance records the server-resolved capability used for the sealed study case.",
      },
      {
        id: `derived-from-${runtimeArtifact.id}-by-${artifactId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifactId },
        to: { kind: "artifact", id: runtimeArtifact.id },
        rationale:
          "The factual sensitivity observations retain their recorded runtime and provider-resource provenance.",
      },
      ...(reviewArtifact
        ? [{
          id: `derived-from-${input.caseArtifact.id}-by-${reviewArtifact.id}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: reviewArtifact.id },
          to: { kind: "artifact" as const, id: input.caseArtifact.id },
          rationale:
            "The server recorded a literal exact-reuse miss before normal execution.",
        }]
        : []),
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
      {
        id: `uses-consume-${runtimeArtifact.id}-by-${artifactId}`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `consume-${runtimeArtifact.id}-by-${artifactId}`,
        },
        to: { kind: "artifact", id: runtimeArtifact.id },
        rationale:
          "The factual study capture retains the exact recorded runtime provenance capture.",
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

function buildReuseSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly caseArtifact: ThreadArtifact;
  readonly studyCase: SensitivityStudyCaseV3;
  readonly caseDigest: string;
  readonly record: SensitivityExperienceRecord;
  readonly review: SensitivityExperienceReuseReview;
  readonly reviewFingerprint: ContentFingerprint;
  readonly reviewUri: string;
  readonly receipt: {
    readonly scientificKey: ContentFingerprint;
    readonly reviewFingerprint: ContentFingerprint;
    readonly recordFingerprint: ContentFingerprint;
    readonly originBindingFingerprint: ContentFingerprint;
    readonly target: SensitivityExperienceReuseReview["target"];
  };
  readonly receiptFingerprint: ContentFingerprint;
  readonly receiptUri: string;
  readonly resultFingerprint: ContentFingerprint;
  readonly resultUri: string;
}): {
  readonly snapshot: ThreadSnapshot;
  readonly receiptArtifact: ThreadArtifact;
  readonly resultArtifact: ThreadArtifact;
} {
  if (
    input.review.outcome !== "exact" || !input.review.selection ||
    !fingerprintsEqual(input.reviewFingerprint, input.receipt.reviewFingerprint) ||
    !fingerprintsEqual(input.record.scientificKey, input.receipt.scientificKey) ||
    !fingerprintsEqual(
      input.review.selection.recordFingerprint,
      input.receipt.recordFingerprint,
    ) ||
    !fingerprintsEqual(
      input.review.selection.originBindingFingerprint,
      input.receipt.originBindingFingerprint,
    ) ||
    input.receipt.target.projectId !== input.review.target.projectId ||
    deterministicJson(input.receipt.target.basis) !==
      deterministicJson(input.basis)
  ) {
    throw invalidTransition("Exact sensitivity reuse receipt is divergent.");
  }
  const capturedAt = requiredStart(input.run);
  const operationRef = {
    serverId: "digital-thread",
    tool: "analyze.run-fea-sensitivity@1",
    runId: input.run.id,
  };
  const reviewArtifact: ThreadArtifact = {
    id: `sensitivity-reuse-review-${input.reviewFingerprint.digest}`,
    name: "Exact private sensitivity reuse review",
    kind: "document",
    version: input.reviewFingerprint.digest,
    fingerprint: input.reviewFingerprint,
    uri: input.reviewUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.caseArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
  };
  const receiptArtifact: ThreadArtifact = {
    id: `sensitivity-reuse-receipt-${input.receiptFingerprint.digest}`,
    name: "Exact private sensitivity reuse receipt",
    kind: "evidence",
    version: input.receiptFingerprint.digest,
    fingerprint: input.receiptFingerprint,
    uri: input.receiptUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [reviewArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
  };
  const resultArtifact: ThreadArtifact = {
    id: `sensitivity-study-reuse-result-${input.resultFingerprint.digest}`,
    name: "Exact reused FEA sensitivity result",
    kind: "document",
    version: input.resultFingerprint.digest,
    fingerprint: input.resultFingerprint,
    uri: input.resultUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.caseArtifact.id, receiptArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
  };
  const baseMetrics = new Map(
    input.record.result.measurements.base.map((item) => [
      item.metric,
      { value: item.value, unit: item.unit },
    ]),
  );
  const steppedMetrics = new Map(
    input.record.result.measurements.stepped.map((item) => [
      item.metric,
      { value: item.value, unit: item.unit },
    ]),
  );
  const graph = buildSensitivityAnalysisGraph({
    caseFingerprint: { algorithm: "sha256", digest: input.caseDigest },
    sensitivityCase: input.studyCase,
    baseMetrics,
    steppedMetrics,
    evidence: {
      capture: {
        id: resultArtifact.id,
        fingerprint: resultArtifact.fingerprint,
      },
    },
  });
  const observations: ThreadObservation[] = [
    ...input.record.result.measurements.base.map((item) => ({
      id: `sensitivity-base-${item.metric}-${input.resultFingerprint.digest}`,
      name: `${item.metric} at base (exact reuse)`,
      metric: item.metric,
      quantity: { value: item.value, unit: item.unit },
      source: {
        operation: operationRef,
        artifactIds: [resultArtifact.id],
        capturedAt,
      },
      freshness: {
        status: "fresh" as const,
        changedAt: capturedAt,
        invalidatedByChangeIds: [],
      },
    })),
    ...input.record.result.derivatives.derivatives.map((item) => ({
      id: `sensitivity-d-${item.metric}-${input.resultFingerprint.digest}`,
      name: `d(${item.metric}) (exact reuse)`,
      metric: `d_${item.metric}`,
      quantity: { value: item.value, unit: item.unit },
      source: {
        operation: operationRef,
        artifactIds: [resultArtifact.id],
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
    name: "Reuse one exact private FEA sensitivity experience",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [reviewArtifact, receiptArtifact, resultArtifact],
    consumptions: [
      {
        id: `consume-${input.caseArtifact.id}-by-${input.run.id}`,
        artifactId: input.caseArtifact.id,
        consumer: operationRef,
        observedFingerprint: input.caseArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      },
      {
        id: `consume-${reviewArtifact.id}-by-${input.run.id}`,
        artifactId: reviewArtifact.id,
        consumer: operationRef,
        observedFingerprint: reviewArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      },
      {
        id: `consume-${receiptArtifact.id}-by-${input.run.id}`,
        artifactId: receiptArtifact.id,
        consumer: operationRef,
        observedFingerprint: receiptArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      },
    ],
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `derived-from-${input.caseArtifact.id}-by-${reviewArtifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: reviewArtifact.id },
        to: { kind: "artifact", id: input.caseArtifact.id },
        rationale:
          "The server recomputed exact compatibility on the target study basis.",
      },
      {
        id: `derived-from-${reviewArtifact.id}-by-${receiptArtifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: receiptArtifact.id },
        to: { kind: "artifact", id: reviewArtifact.id },
        rationale:
          "The target receipt records one exact, source-healthy private reuse.",
      },
      {
        id: `derived-from-${receiptArtifact.id}-by-${resultArtifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: resultArtifact.id },
        to: { kind: "artifact", id: receiptArtifact.id },
        rationale: "The target scientific result is bound to its exact reuse receipt.",
      },
      {
        id: `derived-from-${input.caseArtifact.id}-by-${resultArtifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: resultArtifact.id },
        to: { kind: "artifact", id: input.caseArtifact.id },
        rationale:
          "The target scientific result was recalculated for the target study case.",
      },
      {
        id: `uses-${input.caseArtifact.id}-by-${input.run.id}`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `consume-${input.caseArtifact.id}-by-${input.run.id}`,
        },
        to: { kind: "artifact", id: input.caseArtifact.id },
        rationale: "The reuse review re-read the target study-case mandate.",
      },
      {
        id: `uses-${reviewArtifact.id}-by-${input.run.id}`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `consume-${reviewArtifact.id}-by-${input.run.id}`,
        },
        to: { kind: "artifact", id: reviewArtifact.id },
        rationale: "The target receipt consumed its exact review.",
      },
      {
        id: `uses-${receiptArtifact.id}-by-${input.run.id}`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `consume-${receiptArtifact.id}-by-${input.run.id}`,
        },
        to: { kind: "artifact", id: receiptArtifact.id },
        rationale: "The target scientific result consumed its exact receipt.",
      },
      ...observations.map((observation) => ({
        id: `derived-from-${resultArtifact.id}-by-${observation.id}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: resultArtifact.id },
        rationale:
          "The target observation was recalculated from the target-local reuse result.",
      })),
    ],
    proposedActions: [],
    analysisGraph: graph,
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition("This exact sensitivity reuse receipt is already present.");
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, receiptArtifact, resultArtifact };
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
