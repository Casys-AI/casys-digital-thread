/**
 * Sensitivity and correction composition.
 *
 * A proof-run evaluation cannot authorize vector correction. Live FEA
 * observations require isolated Build123d plus CalculiX. Base evaluation and
 * edges require SysON. Corrections return through AgentResource plus a
 * successor workspace file revision.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PreviewProjectTechnicalCompilation } from "../../application/use-cases/compile/admission/preview-project-technical-compilation.ts";
import { PrepareProjectSensitivityBaseEvaluationReview } from "../../application/use-cases/sensitivity/base-evaluation/prepare-project-sensitivity-base-evaluation-review.ts";
import { PrepareProjectSensitivityStudySealReview } from "../../application/use-cases/sensitivity/study/prepare-project-sensitivity-study-seal-review.ts";
import { PrepareProjectVectorCorrectionReview } from "../../application/use-cases/sensitivity/vector-correction/prepare-project-vector-correction-review.ts";
import { parseSysonModelSeedCapture } from "../../domain/architecture/seed/syson-model-seed.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { IsolatedStepSolverStager } from "../assets/isolated-step-solver-stager.ts";
import { DockerVolumeAssetStager } from "../assets/container-asset-stager.ts";
import { findArchitectureArtifact } from "../architecture/renderer/model-write-architecture-run-executor.ts";
import type { Build123dExecutionComposition } from "../cad/isolated/build123d-execution-composition.ts";

import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../compile/admission/capture-backed-technical-compilation-admission-reader.ts";
import {
  CORRECTION_PROPOSAL_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SENSITIVITY_BASE_EVALUATION_CAPTURE_DESCRIPTOR,
  SENSITIVITY_EDGES_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import { HttpMcpToolClient } from "../shared/mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import {
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
  VerifyEvaluateSensitivityBaseRunExecutor,
} from "./base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts";

import {
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  ModelWriteSensitivityEdgesRunExecutor,
} from "./edges/model-write-sensitivity-edges-run-executor.ts";
import { FileSensitivityEdgesAttemptStore } from "./edges/file-sensitivity-edges-attempt-store.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  AnalyzeRunFeaSensitivityRunExecutor,
} from "./live-fea/analyze-run-fea-sensitivity-run-executor.ts";
import { FileFeaSensitivityAttemptStore } from "./live-fea/file-fea-sensitivity-attempt-store.ts";
import { McpCalculixSensitivitySolver } from "./live-fea/mcp-calculix-sensitivity-solver.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  AnalyzeSealSensitivityStudyRunExecutor,
} from "./study/analyze-seal-sensitivity-study-run-executor.ts";
import { FileCataloguedSensitivityStudyCaseReader } from "./study/file-catalogued-sensitivity-study-case-reader.ts";
import {
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  DesignApplyVectorCorrectionRunExecutor,
} from "./vector-correction/design-apply-vector-correction-run-executor.ts";
import { FileSensitivityExperienceRepository } from "./experience/file-sensitivity-experience-repository.ts";
import { FileSensitivityExperienceReuseAttemptStore } from "./experience/file-sensitivity-experience-reuse-attempt-store.ts";
import { SensitivityExperienceCoordinator } from "./experience/sensitivity-experience-coordinator.ts";
import type { SensitivityExperienceSolverRuntimeAuthority } from "./experience/sensitivity-experience-coordinator.ts";
import { solverRuntimeIdentityFromImageReference } from "../../domain/sensitivity/experience/sensitivity-experience.ts";

export {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
};

export interface SensitivityCompositionOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly technicalCompilationPreview: PreviewProjectTechnicalCompilation;
  readonly feaProofCaptures: FileCaptureStore<"fea-proof-case">;
  readonly sensitivityCatalogOfferCaptures: FileCaptureStore<
    "sensitivity-catalog-offer"
  >;
  readonly sysonModelSeedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly build123dExecution: Build123dExecutionComposition | undefined;
  readonly calculixMcpUrl?: string;
  readonly calculixRuntimeImage?: string;
  readonly sensitivitySolverRuntimeAuthority?:
    SensitivityExperienceSolverRuntimeAuthority;
  readonly sysonMcpUrl?: string;
  readonly sensitivityStepCacheDirectory: string;
  readonly sensitivityExperienceDirectory?: string;
}

export interface SensitivityComposition {
  readonly vectorCorrectionReview: PrepareProjectVectorCorrectionReview;
  readonly sensitivityBaseEvaluationReview:
    PrepareProjectSensitivityBaseEvaluationReview;
  readonly sensitivityStudySealReview: PrepareProjectSensitivityStudySealReview;
  readonly designApplyVectorCorrection: DesignApplyVectorCorrectionRunExecutor;
  readonly analyzeSealSensitivityStudy: AnalyzeSealSensitivityStudyRunExecutor;
  readonly analyzeRunFeaSensitivity:
    | AnalyzeRunFeaSensitivityRunExecutor
    | undefined;
  readonly verifyEvaluateSensitivityBase:
    | VerifyEvaluateSensitivityBaseRunExecutor
    | undefined;
  readonly modelWriteSensitivityEdges:
    | ModelWriteSensitivityEdgesRunExecutor
    | undefined;
}

export function createSensitivityComposition(
  options: SensitivityCompositionOptions,
): SensitivityComposition {
  const sensitivityCaseCaptures = new FileCaptureStore(
    SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
  );
  const sensitivityStudyCaptures = new FileCaptureStore(
    SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  );
  const sensitivityEdgesCaptures = new FileCaptureStore(
    SENSITIVITY_EDGES_CAPTURE_DESCRIPTOR,
  );
  const sensitivityBaseEvaluationCaptures = new FileCaptureStore(
    SENSITIVITY_BASE_EVALUATION_CAPTURE_DESCRIPTOR,
  );
  const vectorCorrectionCaptures = new FileCaptureStore(
    CORRECTION_PROPOSAL_CAPTURE_DESCRIPTOR,
  );
  const catalogReader = new FileCataloguedSensitivityStudyCaseReader();
  const vectorCorrectionReview = new PrepareProjectVectorCorrectionReview({
    snapshots: options.snapshots,
    studyCaptures: sensitivityStudyCaptures,
  });
  const sensitivityBaseEvaluationReview =
    new PrepareProjectSensitivityBaseEvaluationReview({
      snapshots: options.snapshots,
      studyCaptures: sensitivityStudyCaptures,
    });
  const sensitivityStudySealReview = new PrepareProjectSensitivityStudySealReview(
    {
      snapshots: options.snapshots,
      projects: options.projects,
      catalogReader,
      admissions: options.admissions,
      catalogOffers: options.sensitivityCatalogOfferCaptures,
      proofCaptures: options.feaProofCaptures,
    },
  );
  const designApplyVectorCorrection = new DesignApplyVectorCorrectionRunExecutor(
    {
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      studyCaptures: sensitivityStudyCaptures,
      captures: vectorCorrectionCaptures,
      lease: options.lease,
    },
  );
  const analyzeSealSensitivityStudy = new AnalyzeSealSensitivityStudyRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.snapshots,
    admissions: options.admissions,
    captures: sensitivityCaseCaptures,
    catalogOffers: options.sensitivityCatalogOfferCaptures,
    proofCaptures: options.feaProofCaptures,
    catalog: catalogReader,
    lease: options.lease,
  });
  const feaSensitivityAttempts = new FileFeaSensitivityAttemptStore();
  const experienceRepository = options.calculixRuntimeImage &&
      options.sensitivitySolverRuntimeAuthority
    ? new FileSensitivityExperienceRepository(
      options.sensitivityExperienceDirectory ??
        "state/local/sensitivity-experience",
    )
    : undefined;
  const experienceCoordinator = experienceRepository && options.calculixRuntimeImage &&
      options.sensitivitySolverRuntimeAuthority
    ? new SensitivityExperienceCoordinator({
      repository: experienceRepository,
      projects: options.projects,
      snapshots: options.snapshots,
      caseCaptures: sensitivityCaseCaptures,
      studyCaptures: sensitivityStudyCaptures,
      admissions: options.admissions,
      executionAttempts: feaSensitivityAttempts,
      solverRuntime: solverRuntimeIdentityFromImageReference(
        options.calculixRuntimeImage,
      ),
      solverRuntimeAuthority: options.sensitivitySolverRuntimeAuthority,
    })
    : undefined;
  const analyzeRunFeaSensitivity =
    options.build123dExecution?.execution !== undefined &&
      options.calculixMcpUrl
      ? new AnalyzeRunFeaSensitivityRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.snapshots,
        caseCaptures: sensitivityCaseCaptures,
        studyCaptures: sensitivityStudyCaptures,
        admissions: options.admissions,
        profiles: options.build123dExecution.profiles,
        runner: options.build123dExecution.execution.runner,
        stager: new IsolatedStepSolverStager(
          options.sensitivityStepCacheDirectory,
          new DockerVolumeAssetStager({
            service: "mcp-calculix",
            containerDirectory: "/inputs",
          }),
        ),
        solver: new McpCalculixSensitivitySolver(
          new HttpMcpToolClient({
            mcpUrl: options.calculixMcpUrl,
            timeoutMs: 180_000,
          }),
        ),
        attempts: feaSensitivityAttempts,
        ...(experienceCoordinator && experienceRepository
          ? {
            experience: {
              coordinator: experienceCoordinator,
              attempts: new FileSensitivityExperienceReuseAttemptStore(
                `${
                  options.sensitivityExperienceDirectory ??
                    "state/local/sensitivity-experience"
                }/reuse-attempts`,
              ),
            },
          }
          : {}),
        lease: options.lease,
      })
      : undefined;
  const verifyEvaluateSensitivityBase = options.sysonMcpUrl
    ? new VerifyEvaluateSensitivityBaseRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      studyCaptures: sensitivityStudyCaptures,
      captures: sensitivityBaseEvaluationCaptures,
      syson: new HttpMcpToolClient({
        mcpUrl: options.sysonMcpUrl,
        timeoutMs: 30_000,
      }),
      lease: options.lease,
    })
    : undefined;
  const modelWriteSensitivityEdges = options.sysonMcpUrl
    ? new ModelWriteSensitivityEdgesRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      studyCaptures: sensitivityStudyCaptures,
      edgeCaptures: sensitivityEdgesCaptures,
      syson: new HttpMcpToolClient({
        mcpUrl: options.sysonMcpUrl,
        timeoutMs: 30_000,
      }),
      resolveSysonContext: async (snapshot) => {
        if (!findArchitectureArtifact(snapshot)) {
          throw new Error(
            "No architecture artifact is present on the Thread basis.",
          );
        }
        const seed = snapshot.artifacts.find((artifact) =>
          artifact.kind === "sysml-model" &&
          artifact.uri?.startsWith("casys://syson-model-seed-capture/sha256/") &&
          artifact.producer.tool === "syson_model_create"
        );
        if (!seed) {
          throw new Error(
            "No SysON seed artifact is present on the Thread basis.",
          );
        }
        const text = await options.sysonModelSeedCaptures.read(seed.fingerprint);
        if (!text) {
          throw new Error("The SysON seed capture is not readable.");
        }
        const parsed = parseSysonModelSeedCapture(JSON.parse(text));
        return {
          editingContextId: parsed.normalizedResults.project.editingContextId,
          parentElementId: parsed.normalizedResults.rootPackage.id,
        };
      },
      attempts: new FileSensitivityEdgesAttemptStore(),
      lease: options.lease,
    })
    : undefined;
  return {
    vectorCorrectionReview,
    sensitivityBaseEvaluationReview,
    sensitivityStudySealReview,
    designApplyVectorCorrection,
    analyzeSealSensitivityStudy,
    analyzeRunFeaSensitivity,
    verifyEvaluateSensitivityBase,
    modelWriteSensitivityEdges,
  };
}
