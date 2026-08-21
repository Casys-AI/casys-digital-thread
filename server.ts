import { McpApp } from "@casys/mcp-server";
import {
  INTERACTIVE_PROJECT_APPROVAL_MODE,
  LOCAL_YOLO_PROJECT_APPROVAL_MODE,
  type ProjectApprovalMode,
} from "./src/tools/project-approval-mode.ts";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/shared/docker-observer.ts";
import {
  HttpMcpProbe,
  type McpProbe,
} from "./src/adapters/shared/mcp/http-mcp-probe.ts";
import { HttpMcpToolClient } from "./src/adapters/shared/mcp/http-mcp-tool-client.ts";
import { loadFleetManifest } from "./src/adapters/control-plane/manifest.ts";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./src/adapters/loopback-host.ts";
import { FileThreadSnapshotStore } from "./src/adapters/shared/stores/file-thread-snapshot-store.ts";
import { installGracefulHttpShutdown } from "./src/adapters/shared/graceful-http-shutdown.ts";
import {
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
  ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
  THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
} from "./src/adapters/shared/cas/file-capture-store.ts";
import { parseExactArchitectureCapture } from "./src/adapters/architecture/renderer/architecture-capture.ts";
import { FileCataloguedMechanicalProofCaseReader } from "./src/adapters/fea/seal-case/file-catalogued-mechanical-proof-case-reader.ts";
import { FileCataloguedSensitivityStudyCaseReader } from "./src/adapters/sensitivity/study/file-catalogued-sensitivity-study-case-reader.ts";
import { CaptureBackedFeaProofSealRequirementsReviewer } from "./src/adapters/fea/seal-case/capture-backed-fea-proof-seal-requirements-reviewer.ts";
import { PythonCadSourceAnalyzer } from "./src/adapters/cad/source/python-cad-source-analyzer.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "./src/adapters/compile/source/project-brief-source-analyzer.ts";
import { BriefSourceAnalysisCaptureService } from "./src/adapters/compile/captures/brief-source-analysis-capture.ts";
import { CaptureBackedTechnicalCompilationBasisResolver } from "./src/adapters/compile/captures/technical-compilation-basis-resolver.ts";
import { CaptureBackedTechnicalCompilationSourceReader } from "./src/adapters/compile/admission/capture-backed-technical-compilation-source-reader.ts";
import { CaptureBackedTechnicalCompilationAdmissionReader } from "./src/adapters/compile/admission/capture-backed-technical-compilation-admission-reader.ts";
import {
  FileBuild123dExecutionCaptureStore,
  FileBuild123dExecutionDraftStore,
} from "./src/adapters/cad/isolated/build123d-execution-evidence.ts";
import { FileTechnicalCompilationDraftStore } from "./src/adapters/compile/admission/file-technical-compilation-draft-store.ts";
import { FixedTechnicalCompilationProfileCatalogProvider } from "./src/adapters/compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";
import { createInitialTechnicalSourceAnalysisCaptureService } from "./src/adapters/compile/captures/initial-technical-source-analysis-composition.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "./src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-composition.ts";
import { QualifiedArchitectureSysmlAnalyzer } from "./src/adapters/architecture/agent-seal/qualified-architecture-sysml-analyzer.ts";
import { PreviewProjectArchitectureSysml } from "./src/application/use-cases/architecture/agent-seal/preview-project-architecture-sysml.ts";
import { PrepareProjectBriefArchitectureReview } from "./src/application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts";
import { PrepareProjectBriefRequirementsReview } from "./src/application/use-cases/architecture/requirements/prepare-project-brief-requirements-review.ts";
import type { ProjectArchitectureSysmlSourceCaptureUseCase } from "./src/application/ports/in/architecture/agent-seal/project-architecture-sysml-source-capture.ts";
import {
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  ModelSealArchitectureSysmlRunExecutor,
} from "./src/adapters/architecture/agent-seal/model-seal-architecture-sysml-run-executor.ts";
import type { Build123dExecutionServerOptions } from "./src/adapters/cad/isolated/build123d-execution-composition.ts";
import type { AdmittedModelicaExecutionServerOptions } from "./src/adapters/modelica/admitted/execution-composition.ts";
import { createAdmittedModelicaExecutionComposition } from "./src/adapters/modelica/admitted/execution-composition.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "./src/application/use-cases/modelica/admitted/prepare-run-review.ts";
import { ResolveProjectAdmittedModelicaRunReview } from "./src/application/use-cases/modelica/admitted/resolve-run-review.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  DesignSealIsolatedGeometryRunExecutor,
} from "./src/adapters/cad/sealed-isolated/design-seal-isolated-geometry-run-executor.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./src/adapters/modelica/qualified-kit/execution-composition.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts";
import { CodeOwnedModelicaQualifiedKitBundleFactory } from "./src/adapters/modelica/qualified-kit/bundle-factory.ts";
import {
  FileModelicaMicrosandboxQualificationStore,
  PublicationBackedModelicaMicrosandboxQualificationAuthority,
} from "./src/adapters/modelica/qualified-kit/microsandbox-qualification.ts";
import { FileIsolatedOutputCas } from "./src/adapters/shared/cas/file-isolated-output-cas.ts";
import { FileModelicaIsolatedExecutionCaptureStore } from "./src/adapters/modelica/qualified-kit/isolated-execution-evidence.ts";
import { ProjectThreadModelicaQualifiedKitReviewBasisAuthority } from "./src/adapters/modelica/qualified-kit/review-basis-authority.ts";
import { PreviewProjectTechnicalCompilation } from "./src/application/use-cases/compile/admission/preview-project-technical-compilation.ts";
import { CaptureBackedThermalMethodSheetCompilationJoin } from "./src/adapters/modelica/thermal-method-sheet/capture-backed-thermal-method-sheet-compilation-join.ts";
import { PrepareProjectBuild123dExecutionReview } from "./src/application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts";
import { PrepareProjectIsolatedGeometrySealReview } from "./src/application/use-cases/cad/sealed-isolated/prepare-project-isolated-geometry-seal-review.ts";
import { PrepareProjectThermalMethodSheetSealReview } from "./src/application/use-cases/modelica/thermal-method-sheet/prepare-project-thermal-method-sheet-seal-review.ts";
import { LedDriverSourceCaptureService } from "./src/adapters/electrical/led-driver/led-driver-source-capture.ts";
import { PrepareProjectLedDriverSourceCapture } from "./src/application/use-cases/electrical/led-driver/prepare-project-led-driver-source-capture.ts";
import { PrepareProjectLedDriverSourceReview } from "./src/application/use-cases/electrical/led-driver/prepare-project-led-driver-source-review.ts";
import { PrepareProjectAdmittedModelicaEvaluationReview } from "./src/application/use-cases/modelica/evaluation/prepare-project-admitted-modelica-evaluation-review.ts";
import { FileAdmittedObservationEvidenceReader } from "./src/adapters/modelica/evaluation/file-admitted-observation-evidence-reader.ts";
import { FileAdmittedObservationEvaluationCaptureStore } from "./src/adapters/modelica/evaluation/file-admitted-observation-evaluation-capture-store.ts";
import { FileAdmittedObservationEvaluationAttemptStore } from "./src/adapters/modelica/evaluation/file-admitted-observation-evaluation-attempt-store.ts";
import {
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
  VerifyEvaluateAdmittedModelicaObservationsRunExecutor,
} from "./src/adapters/modelica/evaluation/verify-evaluate-admitted-modelica-observations-run-executor.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DecideAdmittedModelicaEvaluationRunExecutor,
} from "./src/adapters/modelica/evaluation/decide-admitted-modelica-evaluation-run-executor.ts";
import { FileThermalMethodSheetStore } from "./src/adapters/modelica/thermal-method-sheet/file-thermal-method-sheet-store.ts";
import { FileThermalMethodSheetSourceCaptureReader } from "./src/adapters/modelica/thermal-method-sheet/file-thermal-method-sheet-source-capture-reader.ts";
import {
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
  VerifySealModelicaThermalMethodSheetRunExecutor,
} from "./src/adapters/modelica/thermal-method-sheet/verify-seal-modelica-thermal-method-sheet-run-executor.ts";
import { PrepareProjectVectorCorrectionReview } from "./src/application/use-cases/sensitivity/vector-correction/prepare-project-vector-correction-review.ts";
import { PrepareProjectFeaProofSealReview } from "./src/application/use-cases/fea/seal-case/prepare-project-fea-proof-seal-review.ts";
import { PrepareProjectFeaIsolatedRunReview } from "./src/application/use-cases/fea/isolated-v3/prepare-project-fea-isolated-run-review.ts";
import { PrepareProjectSensitivityBaseEvaluationReview } from "./src/application/use-cases/sensitivity/base-evaluation/prepare-project-sensitivity-base-evaluation-review.ts";
import { PrepareProjectSensitivityStudySealReview } from "./src/application/use-cases/sensitivity/study/prepare-project-sensitivity-study-seal-review.ts";
import { PrepareProjectCorrectedAdmissionReview } from "./src/application/use-cases/sensitivity/correction-source/prepare-project-corrected-admission-review.ts";
import {
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  DesignApplyVectorCorrectionRunExecutor,
} from "./src/adapters/sensitivity/vector-correction/design-apply-vector-correction-run-executor.ts";
import {
  COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION,
  CompileCaptureCorrectedSourceRunExecutor,
} from "./src/adapters/sensitivity/correction-source/compile-capture-corrected-source-run-executor.ts";
import { QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE } from "./src/adapters/cad/source/qualified-build123d-source-analyzer.ts";
import { PrepareProjectModelicaQualifiedKitRunReview } from "./src/application/use-cases/modelica/qualified-kit/prepare-run-review.ts";
import { ExecuteIsolatedModelicaRun } from "./src/application/use-cases/modelica/qualified-kit/execute-isolated-run.ts";
import type { ProjectTechnicalSourceCaptureUseCase } from "./src/application/ports/in/compile/admission/project-technical-source-capture.ts";
import { assembleTechnicalSourceCaptureReview } from "./src/domain/compile/admission/technical-source-capture-review.ts";
import { FixedSourceAnalysisFrontendRegistry } from "./src/domain/compile/source/source-analysis-frontend-registry.ts";
import { RenderedArchitectureSysmlAnalyzer } from "./src/adapters/architecture/renderer/rendered-architecture-sysml-analyzer.ts";
import { SysmlSourceAnalysisCaptureService } from "./src/adapters/architecture/renderer/sysml-source-analysis-capture.ts";
import { FileSysonModelSeedAttemptStore } from "./src/adapters/architecture/seed/file-syson-model-seed-attempt-store.ts";
import { FileInspectionDroneV4ArchitectureAttemptStore } from "./src/adapters/inspection-drone/author/file-inspection-drone-v4-architecture-attempt-store.ts";
import { FileArchitectureAttemptStore } from "./src/adapters/architecture/renderer/file-architecture-attempt-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/project/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./src/adapters/project/approved-brief-baseline-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./src/adapters/architecture/seed/syson-model-seed-run-executor.ts";
import { InspectionDroneV4ArchitectureRunExecutor } from "./src/adapters/inspection-drone/author/inspection-drone-v4-architecture-run-executor.ts";
import { InspectionDroneV4PartDefinitionsRunExecutor } from "./src/adapters/inspection-drone/part-definitions/inspection-drone-v4-part-definitions-run-executor.ts";
import { FileInspectionDroneV4PartDefinitionsPublicationStore } from "./src/adapters/inspection-drone/part-definitions/file-inspection-drone-v4-part-definitions-publication-store.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "./src/domain/inspection-drone/author/inspection-drone-v4-architecture.ts";
import { INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION } from "./src/domain/inspection-drone/part-definitions/inspection-drone-v4-part-definitions.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  ModelWriteArchitectureRunExecutor,
} from "./src/adapters/architecture/renderer/model-write-architecture-run-executor.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "./src/domain/architecture/part-definitions/part-definitions-capture.ts";
import { ModelCapturePartDefinitionsRunExecutor } from "./src/adapters/architecture/part-definitions/model-capture-part-definitions-run-executor.ts";
import { FilePartDefinitionsPublicationStore } from "./src/adapters/architecture/part-definitions/file-part-definitions-publication-store.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  DesignWriteGeometryRunExecutor,
} from "./src/adapters/cad/canonical/design-write-geometry-run-executor.ts";
import { AdmissionBackedGeometryExportAdapter } from "./src/adapters/cad/canonical/admission-backed-geometry-export-adapter.ts";
import type { GeometrySourceAnalysisCaptureDependencies } from "./src/adapters/cad/source/geometry-source-analysis-capture.ts";
import { ExportAdmittedProjectGeometry } from "./src/application/use-cases/cad/canonical/export-admitted-project-geometry.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  ModelWriteRequirementsRunExecutor,
} from "./src/adapters/architecture/requirements/model-write-requirements-run-executor.ts";
import {
  ARCHIVE_LINEAGE_OPERATION,
  ArchiveLineageRunExecutor,
} from "./src/adapters/record/archive-lineage-run-executor.ts";
import {
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
  ReconcileUncertainWriterRunExecutor,
} from "./src/adapters/record/reconcile-uncertain-writer-run-executor.ts";
import {
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  VerifySealProofCaseRunExecutor,
} from "./src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts";
import { FileCanonicalAssetReader } from "./src/adapters/assets/canonical-asset-reader.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  CompileSealAdmissionRunExecutor,
} from "./src/adapters/compile/executors/compile-seal-admission-run-executor.ts";
import {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  DesignExecuteBuild123dRunExecutor,
} from "./src/adapters/cad/isolated/design-execute-build123d-run-executor.ts";
import {
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  SimulateRunQualifiedModelicaKitRunExecutor,
} from "./src/adapters/modelica/qualified-kit/run-executor.ts";
import {
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  SimulateRunAdmittedModelicaRunExecutor,
} from "./src/adapters/modelica/admitted/run-executor.ts";
import { VerifyRunFeaStaticProofV3RunExecutor } from "./src/adapters/fea/isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts";
import { DockerVolumeAssetStager } from "./src/adapters/assets/container-asset-stager.ts";
import { McpCalculixSensitivitySolver } from "./src/adapters/sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import { IsolatedStepSolverStager } from "./src/adapters/assets/isolated-step-solver-stager.ts";
import { ExportVolumeGeometryStager } from "./src/adapters/make/printability/export-volume-geometry-stager.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  AnalyzeSealSensitivityStudyRunExecutor,
} from "./src/adapters/sensitivity/study/analyze-seal-sensitivity-study-run-executor.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  AnalyzeRunFeaSensitivityRunExecutor,
} from "./src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts";
import {
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  ModelWriteSensitivityEdgesRunExecutor,
} from "./src/adapters/sensitivity/edges/model-write-sensitivity-edges-run-executor.ts";
import {
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
  VerifyEvaluateSensitivityBaseRunExecutor,
} from "./src/adapters/sensitivity/base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts";
import { FileFeaSensitivityAttemptStore } from "./src/adapters/sensitivity/live-fea/file-fea-sensitivity-attempt-store.ts";
import {
  INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
  IndustrializeSealPrintabilityCaseRunExecutor,
} from "./src/adapters/make/printability/industrialize-seal-printability-case-run-executor.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
  IndustrializeObservePrintabilityRunExecutor,
} from "./src/adapters/make/printability/industrialize-observe-printability-run-executor.ts";
import {
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
  IndustrializeSealPrintEstimateCaseRunExecutor,
} from "./src/adapters/make/print-estimate/industrialize-seal-print-estimate-case-run-executor.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
  IndustrializeObservePrintEstimateRunExecutor,
} from "./src/adapters/make/print-estimate/industrialize-observe-print-estimate-run-executor.ts";
import { FilePrintabilityAttemptStore } from "./src/adapters/make/printability/file-printability-attempt-store.ts";
import { FilePrintEstimateAttemptStore } from "./src/adapters/make/print-estimate/file-print-estimate-attempt-store.ts";
import {
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  IndustrializeSealDfmCaseRunExecutor,
} from "./src/adapters/make/dfm/industrialize-seal-dfm-case-run-executor.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  IndustrializeRunDfmChecksRunExecutor,
} from "./src/adapters/make/dfm/industrialize-run-dfm-checks-run-executor.ts";
import { FileDfmCheckAttemptStore } from "./src/adapters/make/dfm/file-dfm-check-attempt-store.ts";
import { FileSensitivityEdgesAttemptStore } from "./src/adapters/sensitivity/edges/file-sensitivity-edges-attempt-store.ts";
import { parseSysonModelSeedCapture } from "./src/domain/architecture/seed/syson-model-seed.ts";
import { findArchitectureArtifact } from "./src/adapters/architecture/renderer/model-write-architecture-run-executor.ts";
import { FileByteStore } from "./src/adapters/shared/cas/file-byte-store.ts";
import { RecordedAnalysisCasReader } from "./src/adapters/shared/cas/recorded-analysis-cas-reader.ts";
import {
  CaptureBackedRunPlanSealer,
  RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
} from "./src/adapters/compile/plans/capture-backed-run-plan-sealer.ts";
import { ResolvedOperationPlanResolver } from "./src/adapters/compile/plans/resolved-operation-plan-resolver.ts";
import {
  CORRECTED_SOURCE_CAPTURE_DESCRIPTOR,
  CORRECTION_PROPOSAL_CAPTURE_DESCRIPTOR,
  DFM_CASE_CAPTURE_DESCRIPTOR,
  DFM_CHECK_CAPTURE_DESCRIPTOR,
  FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_OBSERVATION_CAPTURE_DESCRIPTOR,
  PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
  PRINTABILITY_OBSERVATION_CAPTURE_DESCRIPTOR,
  SENSITIVITY_BASE_EVALUATION_CAPTURE_DESCRIPTOR,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_DESCRIPTOR,
  SENSITIVITY_EDGES_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
} from "./src/adapters/shared/cas/file-capture-store.ts";
import { FileRequirementsAttemptStore } from "./src/adapters/architecture/requirements/file-requirements-attempt-store.ts";
import { FileBuild123dExecutionAttemptStore } from "./src/adapters/cad/isolated/file-build123d-execution-attempt-store.ts";
import { FileAdmittedModelicaExecutionAttemptStore } from "./src/adapters/modelica/admitted/file-execution-attempt-store.ts";
import { FileModelicaIsolatedExecutionAttemptStore } from "./src/adapters/modelica/qualified-kit/attempt-store.ts";
import { FileCalculixIsolatedProductAttemptStore } from "./src/adapters/fea/isolated-v3/file-calculix-isolated-product-attempt-store.ts";
import { REQUIREMENTS_CAPTURE_DESCRIPTOR } from "./src/adapters/shared/cas/file-capture-store.ts";
import { RegisteredProjectRunExecutor } from "./src/application/use-cases/registered-project-run-executor.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/shared/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/shared/stores/live-thread-update-store.ts";
import { FileEngineeringProjectRevisionStore } from "./src/adapters/shared/stores/engineering-project-store.ts";
import {
  FileProjectReviewIntentStore,
  ProjectReviewIntentConflictError,
} from "./src/adapters/shared/stores/file-project-review-intent-store.ts";
import {
  CockpitFocusConflictError,
  FileCockpitFocusStore,
} from "./src/adapters/project/file-cockpit-focus-store.ts";
import { createEngineeringProjectCommandRuntime } from "./src/adapters/project/engineering-project-command-runtime.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./src/adapters/shared/stores/engineering-thread-snapshot-resolver.ts";
import { loadRunFixtures } from "./src/adapters/control-plane/run-fixtures.ts";
import { ControlPlane } from "./src/application/control-plane/control-plane.ts";
import { EngineeringProjectCommandError } from "./src/application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "./src/application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./src/orchestration/operations/registry.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./src/orchestration/operations/fea-isolated-static-proof.ts";
import type { RunDetail } from "./src/application/control-plane/read-model/engineering-run.ts";
import type { FleetManifest } from "./src/application/control-plane/read-model/fleet-manifest.ts";
import { registerControlPlaneTools } from "./src/tools/control-plane.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./src/tools/project-control.ts";
import {
  type ProjectBriefToolDependencies,
  registerProjectBriefTools,
} from "./src/tools/project-brief.ts";
import {
  type CockpitFocusToolDependencies,
  registerCockpitFocusTools,
} from "./src/tools/cockpit-focus.ts";
import { registerProjectReviewIntentSubscription } from "./src/tools/project-review-intent-subscription.ts";
import { sha256Fingerprint } from "./src/domain/kernel/deterministic-json.ts";

const DEFAULT_PORT = 3020;
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_MANIFEST_PATH = "config/mcp-fleet.json";
const DEFAULT_RUN_FIXTURE_PATH = "state/fixtures/runs/bracket-demo.json";
const DEFAULT_ACTIVE_PROJECT_DIRECTORY = "state/local/engineering-projects";
const DEFAULT_PROJECT_REVIEW_INTENT_DIRECTORY = "state/local/project-review-intents";
const DEFAULT_COCKPIT_FOCUS_DIRECTORY = "state/local/cockpit-focus";
const DEFAULT_THREAD_SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY = "state/local/live-thread-updates";
const DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY = "state/local/approved-brief-captures";
const DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY =
  "state/local/syson-model-seed-captures";
const DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY =
  "state/local/syson-model-seed-attempts";
const DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DIRECTORY =
  "state/local/inspection-drone-v4-architecture-captures";
const DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_ATTEMPT_DIRECTORY =
  "state/local/inspection-drone-v4-architecture-attempts";
const DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DIRECTORY =
  "state/local/inspection-drone-v4-part-definitions-captures";
const DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_PUBLICATION_DIRECTORY =
  "state/local/inspection-drone-v4-part-definitions-publications";
const DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY = "state/local/architecture-captures";
const DEFAULT_ARCHITECTURE_ATTEMPT_DIRECTORY = "state/local/architecture-attempts";
const DEFAULT_PART_DEFINITIONS_CAPTURE_DIRECTORY =
  "state/local/part-definitions-captures";
const DEFAULT_PART_DEFINITIONS_PUBLICATION_DIRECTORY =
  "state/local/part-definitions-publications";
const DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY = "state/local/geometry-draft-captures";
const DEFAULT_GEOMETRY_CAPTURE_DIRECTORY = "state/local/geometry-captures";
const DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY = "state/local/requirements-captures";
const DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY = "state/local/requirements-attempts";
/**
 * Canonical binary asset store shared with design.write-geometry@1 promotion.
 * The FEA path reads sealed STEP bytes from here — never from the draft store:
 * drafts are pre-approval material and must not reach a solver.
 */
const DEFAULT_CANONICAL_ASSET_DIRECTORY = "state/local/thread-assets";
const DEFAULT_SENSITIVITY_STEP_CACHE_DIRECTORY = "state/local/sensitivity-step-cache";
const DEFAULT_PRINTABILITY_CASE_CAPTURE_DIRECTORY =
  "state/local/printability-case-captures";
const DEFAULT_PRINTABILITY_ATTEMPT_DIRECTORY = "state/local/printability-attempts";
const DEFAULT_PRINTABILITY_OBSERVATION_CAPTURE_DIRECTORY =
  "state/local/printability-observation-captures";
const DEFAULT_PRINTABILITY_EXPORT_DIRECTORY = "state/local/printability-exports";
const DEFAULT_DFM_CASE_CAPTURE_DIRECTORY = "state/local/dfm-case-captures";
const DEFAULT_DFM_CHECK_CAPTURE_DIRECTORY = "state/local/dfm-check-captures";
const DEFAULT_DFM_CHECK_ATTEMPT_DIRECTORY = "state/local/dfm-check-attempts";
const DEFAULT_DFM_EXPORT_DIRECTORY = "state/local/dfm-exports";
const DEFAULT_PRINT_ESTIMATE_CASE_CAPTURE_DIRECTORY =
  "state/local/print-estimate-case-captures";
const DEFAULT_PRINT_ESTIMATE_ATTEMPT_DIRECTORY = "state/local/print-estimate-attempts";
const DEFAULT_PRINT_ESTIMATE_OBSERVATION_CAPTURE_DIRECTORY =
  "state/local/print-estimate-observation-captures";
const DEFAULT_PRINT_ESTIMATE_EXPORT_DIRECTORY = "state/local/print-estimate-exports";
const DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY =
  "state/local/engineering-project-run-leases";
const DEFAULT_PROJECT_BASELINE_DIRECTORY = "config/projects/baselines";
/**
 * One closed local root for the recorded-analysis vertical. Every child store
 * has a fixed CAS namespace; this path changes persistence placement only.
 */
const DEFAULT_RECORDED_ANALYSIS_DIRECTORY = "state/local/recorded-analysis";

export const LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE =
  "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8" as const;

export const LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894" as const;
export const LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:d25f220287cd8d1713e9e7d773afb8bb867fc5404a112e5e50ffa2e862fd6fdf" as const;
export const LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE =
  "casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2" as const;
const LOCAL_CALCULIX_WRAPPER_SHA256 =
  "507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2";
const LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT = Object.freeze({
  algorithm: "sha256" as const,
  digest: "d6aee5fe375daa55cec29a32acf27181dd4bb8ea8e5c3f90f848cc718c149428",
});
const LOCAL_MODELICA_QUALIFICATION_ROOT =
  "state/local/modelica-microsandbox-qualification";

const LOCAL_BUILD123D_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 30_000,
  maxCpuTimeMs: 25_000,
  maxMemoryBytes: 1_024 * 1_048_576,
  maxProcesses: 32,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 128 * 1_048_576,
});

const LOCAL_BUILD123D_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "build123d-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  supervisorUser: "0:0",
  untrustedChildUser: "65532:65532",
  limits: LOCAL_BUILD123D_EXECUTION_LIMITS,
});

const LOCAL_MODELICA_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 120_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 16 * 1_048_576,
  maxOutputTotalBytes: 17 * 1_048_576,
});

const LOCAL_MODELICA_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "modelica-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["omc", "perl"],
  limits: LOCAL_MODELICA_EXECUTION_LIMITS,
});

const LOCAL_ADMITTED_MODELICA_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "modelica-admitted-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["omc", "perl"],
  limits: LOCAL_MODELICA_EXECUTION_LIMITS,
});

const LOCAL_CALCULIX_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 180_000,
  maxCpuTimeMs: 160_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 256 * 1_048_576,
});

const LOCAL_CALCULIX_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "calculix-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["gmsh", "ccx"],
  limits: LOCAL_CALCULIX_EXECUTION_LIMITS,
});

export interface CreateConsoleServerOptions {
  manifest?: FleetManifest;
  manifestPath?: string;
  runs?: readonly RunDetail[];
  runFixturePaths?: string[];
  probe?: McpProbe;
  docker?: DockerObserver;
  now?: () => Date;
  monotonicNow?: () => number;
  cacheTtlMs?: number;
  logger?: (message: string) => void;
  /** `false` is reserved for focused fleet-only tests. */
  projectControl?: ProjectControlToolDependencies | false;
  /** Living in-project brief tools; enabled by default with project control. */
  projectBrief?: ProjectBriefToolDependencies | false;
  /** Agent-owned browser focus; omitted with project tools in fleet-only tests. */
  cockpitFocus?: CockpitFocusToolDependencies | false;
  /** Fixed in tests/deployments; local runs otherwise use a process-ephemeral key. */
  mrtrSigningKey?: string;
  /**
   * Internal composition seam for tests and embedders; interactive MRTR
   * remains the default. Any network-facing embedder must resolve this option
   * through `approvalModeForBinding` against its actual bind hostname.
   */
  approvalMode?: ProjectApprovalMode;
  /**
   * Explicit project seed for isolated tests or a controlled deployment.
   * Omit both values in normal operation: the server never seeds a product
   * from a bundled fixture; cockpit focus selects an existing durable project.
   */
  projectId?: string;
  projectPath?: string;
  activeProjectDirectory?: string;
  /** Browser-to-agent review outbox; never an EngineeringProject command store. */
  projectReviewIntentDirectory?: string;
  cockpitFocusDirectory?: string;
  threadSnapshotDirectory?: string;
  liveThreadUpdateDirectory?: string;
  approvedBriefCaptureDirectory?: string;
  /** Exact canonical brief JSON captured before local source analysis. */
  briefSourceCaptureDirectory?: string;
  /** Shared provider-neutral source-analysis CAS (brief, SysML, and CAD). */
  sourceAnalysisCaptureDirectory?: string;
  /** Exact server-rendered SysML source bytes captured before analysis/dispatch. */
  sysmlSourceCaptureDirectory?: string;
  sysonModelSeedCaptureDirectory?: string;
  sysonModelSeedAttemptDirectory?: string;
  /** Generic model.write-architecture@1 capture store directory. */
  architectureCaptureDirectory?: string;
  /** Generic model.write-architecture@1 WAL attempt directory. */
  architectureAttemptDirectory?: string;
  /** Generic model.capture-part-definitions@1 capture store directory. */
  partDefinitionsCaptureDirectory?: string;
  /** Generic model.capture-part-definitions@1 publication WAL directory. */
  partDefinitionsPublicationDirectory?: string;
  /** Generic model.write-requirements@1 capture store directory. */
  requirementsCaptureDirectory?: string;
  /** Generic model.write-requirements@1 WAL attempt directory. */
  requirementsAttemptDirectory?: string;
  inspectionDroneV4ArchitectureCaptureDirectory?: string;
  inspectionDroneV4ArchitectureAttemptDirectory?: string;
  inspectionDroneV4PartDefinitionsCaptureDirectory?: string;
  inspectionDroneV4PartDefinitionsPublicationDirectory?: string;
  printabilityCaseCaptureDirectory?: string;
  printabilityAttemptDirectory?: string;
  printabilityObservationCaptureDirectory?: string;
  printEstimateCaseCaptureDirectory?: string;
  printEstimateAttemptDirectory?: string;
  printEstimateObservationCaptureDirectory?: string;
  dfmCaseCaptureDirectory?: string;
  dfmCheckCaptureDirectory?: string;
  dfmCheckAttemptDirectory?: string;
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
  /** Root of the closed CAS/WAL layout used by isolated-analysis operations. */
  recordedAnalysisDirectory?: string;
  /**
   * Explicit qualified Build123d profile and optional isolated runtime.
   * Omitted means no review tool and no executor. A profile without a runtime
   * exposes provider-free review only; no environment variable enables it.
   */
  build123dExecution?: Build123dExecutionServerOptions;
  /**
   * Explicit qualified Modelica profile and optional isolated runtime.
   * Omitted means no review tool and no executor. Runtime activation still
   * requires the separately persisted, digest-pinned qualification capture.
   */
  modelicaIsolatedExecution?: ModelicaIsolatedExecutionServerOptions;
  /**
   * Admitted Modelica closed-subset profile and optional isolated runtime.
   * Distinct from the pinned kit. Omitted means no review tool and no executor.
   */
  admittedModelicaExecution?: AdmittedModelicaExecutionServerOptions;
  /** Local CalculiX profile; product execution additionally requires SysON. */
  calculixIsolatedExecution?: CalculixIsolatedExecutionServerOptions;
}

export async function createConsoleServer(
  options: CreateConsoleServerOptions = {},
): Promise<{ app: McpApp; controlPlane: ControlPlane }> {
  const manifest = options.manifest ??
    await loadFleetManifest(
      options.manifestPath ?? env("MCP_FLEET_MANIFEST") ??
        DEFAULT_MANIFEST_PATH,
    );
  const runs = options.runs ??
    await loadRunFixtures(
      options.runFixturePaths ??
        [env("MCP_RUN_FIXTURE") ?? DEFAULT_RUN_FIXTURE_PATH],
    );
  const syson = manifest.servers.find((server) => server.id === "syson");
  const build123dSandbox = manifest.servers.find((server) =>
    server.id === "build123d-sandbox"
  );
  const calculix = manifest.servers.find((server) => server.id === "calculix");
  const dfm = manifest.servers.find((server) => server.id === "dfm");
  const prusaslicer = manifest.servers.find((server) => server.id === "prusaslicer");
  const controlPlane = new ControlPlane({
    manifest,
    runs,
    probe: options.probe ?? new HttpMcpProbe(),
    docker: options.docker ?? new DockerComposeObserver(),
    now: options.now,
    monotonicNow: options.monotonicNow,
    cacheTtlMs: options.cacheTtlMs,
  });
  const defaultProjectTools = options.projectControl === undefined &&
      options.projectBrief === undefined
    ? await createProjectControl(
      options,
      syson?.mcpUrl,
      build123dSandbox?.mcpUrl,
      calculix?.mcpUrl,
      dfm?.mcpUrl,
      prusaslicer?.mcpUrl,
    )
    : undefined;
  const projectControl = options.projectControl === false
    ? undefined
    : options.projectControl ?? defaultProjectTools?.control;
  const projectBrief = options.projectBrief === false
    ? undefined
    : options.projectBrief ?? defaultProjectTools?.brief;
  const cockpitFocus = options.cockpitFocus === false || !projectControl
    ? undefined
    : options.cockpitFocus ?? createCockpitFocus(options);
  const approvalMode = options.approvalMode ?? INTERACTIVE_PROJECT_APPROVAL_MODE;
  const baseInstructions = projectControl || projectBrief
    ? "Casys engineering control plane. Fleet tools are read-only. project_start creates the engineering project from the first plain-language intent; framing, guided questions, sourced answers and the living brief remain inside that same project. An agent may revise the brief but cannot self-approve it: project_brief_confirm requires exact confirmation through MCP elicitation presented by the paired host. The signed retry protects request integrity and replay; user authentication remains the host's responsibility. project_snapshot reads the whole durable project. project_plan_publish binds reviewed work to the exact human-approved canonical brief; every work item cites a reviewed server-side operation. The agent may queue and execute only registered operations, with no provider name, arbitrary arguments, result payload, or fabricated evidence supplied by the caller. Consequential engineering decisions use the same host-presented MCP elicitation flow. Sensitivity studies produce data, never verdicts: a published derivative carries its unit, base point, step and declared limitations, and satisfies no requirement by itself. cockpit_focus_set selects an already durable project for the read-only cockpit; it does not change project truth. The cockpit is a read-only projection of framing, activity, lineage and results. Unavailable, demo, unlicensed standards content, legal conclusions, and unverified evidence must stay explicitly labelled."
    : "Casys read-only fleet console. Project tools are disabled on this non-loopback or explicitly fleet-only binding. Unavailable, demo, and unverified evidence must stay explicitly labelled.";
  const instructions = baseInstructions +
    (approvalMode.kind === "local-yolo"
      ? " Explicit local YOLO startup opt-in is active: positive project_brief_confirm and project_decision_approve calls auto-confirm through the canonical human command services with a persisted local-yolo origin and rationale, without fabricating MCP elicitation responses. Rejection, cancellation, supersession and human-only execution still require interactive signed MRTR elicitation."
      : "");
  const app = new McpApp({
    name: "casys-digital-thread-console",
    version: "0.2.0",
    transport: "stateless",
    maxConcurrent: 8,
    backpressureStrategy: "queue",
    validateSchema: true,
    ...(projectControl || projectBrief
      ? {
        mrtr: {
          signingKey: options.mrtrSigningKey ?? env("MCP_MRTR_SIGNING_KEY") ??
            ephemeralMrtrSigningKey(),
        },
      }
      : {}),
    instructions,
    logger: options.logger,
    toolErrorMapper: (error) =>
      error instanceof Error &&
        (error.name === "ControlPlaneNotFoundError" ||
          error instanceof EngineeringProjectCommandError ||
          error instanceof CockpitFocusConflictError ||
          error instanceof ProjectReviewIntentConflictError ||
          error instanceof TypeError)
        ? error.message
        : null,
  });
  if (projectControl || projectBrief) {
    app.use(async (context, next) => {
      if (
        context.request &&
        !requestUsesExplicitLoopbackHost(context.request)
      ) {
        throw new TypeError(
          "The engineering MCP control plane accepts project tool calls only through an explicit loopback hostname.",
        );
      }
      return await next();
    });
  }
  registerControlPlaneTools(app, controlPlane);
  if (projectControl) {
    registerProjectControlTools(app, { ...projectControl, approvalMode });
    if (projectControl.reviewIntents) {
      registerProjectReviewIntentSubscription(app, projectControl.reviewIntents);
    }
  }
  if (projectBrief) {
    registerProjectBriefTools(app, { ...projectBrief, approvalMode });
  }
  if (cockpitFocus) registerCockpitFocusTools(app, cockpitFocus);
  return { app, controlPlane };
}

async function createProjectControl(
  options: CreateConsoleServerOptions,
  sysonMcpUrl?: string,
  build123dSandboxMcpUrl?: string,
  calculixMcpUrl?: string,
  dfmMcpUrl?: string,
  prusaslicerMcpUrl?: string,
): Promise<{
  readonly control: ProjectControlToolDependencies;
  readonly brief: ProjectBriefToolDependencies;
}> {
  const activeThreadSnapshots = new FileThreadSnapshotStore(
    options.threadSnapshotDirectory ?? DEFAULT_THREAD_SNAPSHOT_DIRECTORY,
  );
  const threadSnapshots = new OrderedExactThreadSnapshotReader([
    activeThreadSnapshots,
    new FileExactThreadSnapshotDirectory(
      options.projectBaselineDirectory ?? DEFAULT_PROJECT_BASELINE_DIRECTORY,
    ),
  ]);
  const build123dThreadSnapshots = {
    // Reads and lineage checks may cross into the configured immutable
    // baseline. Writes and fresh ACK-loss rereads remain owned by the active
    // append-only store; the fallback handles an exact read-only basis only.
    get: (snapshotId: string) => threadSnapshots.get(snapshotId),
    latest: (subjectId: string) => activeThreadSnapshots.latest(subjectId),
    save: (snapshot: Parameters<typeof activeThreadSnapshots.save>[0]) =>
      activeThreadSnapshots.save(snapshot),
    getFresh: async (snapshotId: string) =>
      await activeThreadSnapshots.getFresh(snapshotId) ??
        await threadSnapshots.get(snapshotId),
  };
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: options.approvedBriefCaptureDirectory ??
      DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY,
  });
  const briefSourceCaptures = new FileCaptureStore({
    ...BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
    directory: options.briefSourceCaptureDirectory ??
      BRIEF_SOURCE_CAPTURE_DESCRIPTOR.directory,
  });
  const sourceAnalysisCaptures = new FileCaptureStore({
    ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
    directory: options.sourceAnalysisCaptureDirectory ??
      SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR.directory,
  });
  const briefSourceAnalysisFrontends = new FixedSourceAnalysisFrontendRegistry([{
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
    frontend: new ProjectBriefSourceAnalyzer(),
  }]);
  const briefSourceAnalysis = new BriefSourceAnalysisCaptureService({
    sourceCaptures: briefSourceCaptures,
    analysisCaptures: sourceAnalysisCaptures,
    frontends: briefSourceAnalysisFrontends,
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
  });
  const sysmlSourceAnalysis = new SysmlSourceAnalysisCaptureService({
    sourceCaptures: new FileCaptureStore({
      ...SYSML_SOURCE_CAPTURE_DESCRIPTOR,
      directory: options.sysmlSourceCaptureDirectory ??
        SYSML_SOURCE_CAPTURE_DESCRIPTOR.directory,
    }),
    analysisCaptures: sourceAnalysisCaptures,
    frontend: new RenderedArchitectureSysmlAnalyzer(),
  });
  const sysonModelSeedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: options.sysonModelSeedCaptureDirectory ??
      DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY,
  });
  const liveUpdates = new FileLiveThreadUpdateStore(
    options.liveThreadUpdateDirectory ?? DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY,
  );
  const lease = new FileEngineeringProjectRunLease(
    options.engineeringProjectRunLeaseDirectory ??
      DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY,
  );
  // This closed local store family is composed before the command runtime so
  // queueRun can seal a ROP2 reference atomically with its project revision.
  // Constructing MCP clients/readers later is inert: no provider I/O happens
  // until each executor has admitted its exact queued run and source bytes.
  const recordedAnalysisDirectory = options.recordedAnalysisDirectory ??
    DEFAULT_RECORDED_ANALYSIS_DIRECTORY;
  const technicalCompilationDirectory =
    `${recordedAnalysisDirectory}/technical-compilation`;
  const technicalSourceAnalysisCaptures = new FileByteStore({
    kind: "technical-source-analysis",
    directory: `${technicalCompilationDirectory}/analyses`,
    uriNamespace: "technical-source-analysis",
    label: "Captured technical source analysis",
  });
  const technicalSourceAnalysis = createInitialTechnicalSourceAnalysisCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "technical-source",
      directory: `${technicalCompilationDirectory}/sources`,
      uriNamespace: "technical-source",
      label: "Captured technical source",
    }),
    analysisCaptures: technicalSourceAnalysisCaptures,
  });
  const technicalCompilationSources = new CaptureBackedTechnicalCompilationSourceReader(
    technicalSourceAnalysis,
  );
  const technicalSourceCapture: ProjectTechnicalSourceCaptureUseCase = {
    capture: async (command) => {
      const reference = await technicalSourceAnalysis.capture(command);
      const reopened = await technicalSourceAnalysis.reopen(reference);
      return assembleTechnicalSourceCaptureReview(
        reference,
        reopened.sourceText,
        reopened.analysis,
      );
    },
  };
  const ledDriverSourceCaptures = new FileByteStore({
    kind: "led-driver-source",
    directory: `${recordedAnalysisDirectory}/electrical/led-driver-source`,
    uriNamespace: "led-driver-source",
    label: "Captured LED-driver human source",
  });
  const ledDriverSourceStore = new LedDriverSourceCaptureService({
    sourceCaptures: ledDriverSourceCaptures,
  });
  const ledDriverSourceCapture = new PrepareProjectLedDriverSourceCapture({
    captures: ledDriverSourceStore,
  });
  const ledDriverSourceReview = new PrepareProjectLedDriverSourceReview({
    captures: ledDriverSourceStore,
  });
  const architectureSysmlDirectory = `${recordedAnalysisDirectory}/architecture-sysml`;
  const architectureSysmlSourceAnalysis =
    createArchitectureSysmlSourceAnalysisCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "architecture-sysml-source",
        directory: `${architectureSysmlDirectory}/sources`,
        uriNamespace: "architecture-sysml-source",
        label: "Captured architecture SysML source",
      }),
      analysisCaptures: new FileByteStore({
        kind: "architecture-sysml-source-analysis",
        directory: `${architectureSysmlDirectory}/analyses`,
        uriNamespace: "architecture-sysml-source-analysis",
        label: "Captured architecture SysML analysis",
      }),
    });
  const architectureSysmlSourceCapture: ProjectArchitectureSysmlSourceCaptureUseCase = {
    capture: async (command) =>
      structuredClone(
        await architectureSysmlSourceAnalysis.capture(command),
      ) as unknown as Readonly<Record<string, unknown>>,
  };
  const architectureSysmlPreview = new PreviewProjectArchitectureSysml({
    frontend: new QualifiedArchitectureSysmlAnalyzer(),
    captures: architectureSysmlSourceAnalysis,
  });
  const architectureSysmlSealBytes = new FileByteStore({
    kind: "architecture-sysml-seal-capture",
    directory: `${architectureSysmlDirectory}/seals`,
    uriNamespace: "architecture-sysml-seal-capture",
    label: "Sealed architecture SysML analysis",
  });
  const architectureSysmlSeals = {
    save: (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
      canonicalText: string,
    ) =>
      architectureSysmlSealBytes.save(
        fingerprint,
        new TextEncoder().encode(canonicalText),
      ),
    read: async (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    ) => {
      const stored = await architectureSysmlSealBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
  const technicalCompilationDrafts = new FileTechnicalCompilationDraftStore(
    new FileByteStore({
      kind: "technical-compilation-draft",
      directory: `${technicalCompilationDirectory}/drafts`,
      uriNamespace: "technical-compilation-draft",
      label: "Technical compilation review draft",
    }),
  );
  const technicalCompilationProfiles =
    new FixedTechnicalCompilationProfileCatalogProvider();
  const technicalCompilationSealBytes = new FileByteStore({
    kind: "technical-compilation-admission-capture",
    directory: `${technicalCompilationDirectory}/seals`,
    uriNamespace: "technical-compilation-admission-capture",
    label: "Sealed technical compilation admission",
  });
  const technicalCompilationSeals = {
    save: (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
      canonicalText: string,
    ) =>
      technicalCompilationSealBytes.save(
        fingerprint,
        new TextEncoder().encode(canonicalText),
      ),
    read: async (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    ) => {
      const stored = await technicalCompilationSealBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
  const technicalCompilationAdmissions =
    new CaptureBackedTechnicalCompilationAdmissionReader({
      // Review may need to traverse into the immutable configured baseline;
      // the ordered reader has that complete lineage while remaining read-only.
      snapshots: build123dThreadSnapshots,
      captures: technicalCompilationSeals,
    });
  const build123dExecution = options.build123dExecution === undefined
    ? undefined
    : await (await import(
      "./src/adapters/cad/isolated/build123d-execution-composition.ts"
    )).createBuild123dExecutionComposition(options.build123dExecution, {
      outputCasDirectory: `${recordedAnalysisDirectory}/build123d/outputs`,
    });
  const build123dExecutionReview = build123dExecution === undefined
    ? undefined
    : new PrepareProjectBuild123dExecutionReview({
      admissions: technicalCompilationAdmissions,
      profiles: build123dExecution.profiles,
    });
  const build123dExecutionCaptures = new FileBuild123dExecutionCaptureStore(
    `${recordedAnalysisDirectory}/build123d/captures`,
  );
  const isolatedOutputPublications = build123dExecution?.execution?.publications ??
    new FileIsolatedOutputCas(`${recordedAnalysisDirectory}/build123d/outputs`);
  const isolatedGeometrySealBytes = new FileByteStore({
    kind: "isolated-geometry-seal-capture",
    directory: `${recordedAnalysisDirectory}/isolated-geometry-seals`,
    uriNamespace: "isolated-geometry-seal-capture",
    label: "Sealed isolated geometry document",
  });
  const isolatedGeometrySeals = {
    save: (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
      canonicalText: string,
    ) =>
      isolatedGeometrySealBytes.save(
        fingerprint,
        new TextEncoder().encode(canonicalText),
      ),
    read: async (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    ) => {
      const stored = await isolatedGeometrySealBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
  const isolatedGeometrySealReview = new PrepareProjectIsolatedGeometrySealReview({
    snapshots: build123dThreadSnapshots,
    captures: build123dExecutionCaptures,
  });
  const modelicaIsolatedExecution = options.modelicaIsolatedExecution === undefined
    ? undefined
    : await (await import(
      "./src/adapters/modelica/qualified-kit/execution-composition.ts"
    )).createModelicaIsolatedExecutionComposition(
      options.modelicaIsolatedExecution,
      {
        outputCasDirectory:
          `${recordedAnalysisDirectory}/modelica/isolated-execution/outputs`,
      },
    );
  const admittedModelicaExecution = options.admittedModelicaExecution === undefined
    ? undefined
    : await createAdmittedModelicaExecutionComposition(
      options.admittedModelicaExecution,
      {
        outputCasDirectory: `${recordedAnalysisDirectory}/modelica/admitted/outputs`,
      },
    );
  const admittedModelicaCaptureBytes = new FileByteStore({
    kind: "modelica-admitted-execution-capture",
    directory: `${recordedAnalysisDirectory}/modelica/admitted/captures`,
    uriNamespace: "modelica-admitted-execution-capture",
    label: "Admitted Modelica execution capture",
  });
  const admittedModelicaCaptures = {
    save: async (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
      canonicalText: string,
    ) => {
      const stored = await admittedModelicaCaptureBytes.save(
        fingerprint,
        new TextEncoder().encode(canonicalText),
      );
      return { uri: stored.uri, fingerprint: stored.fingerprint };
    },
    read: async (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    ) => {
      const stored = await admittedModelicaCaptureBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
    uriFor: (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    ) => admittedModelicaCaptureBytes.uriFor(fingerprint),
  };
  const modelicaQualificationAuthority = modelicaIsolatedExecution === undefined
    ? undefined
    : new PublicationBackedModelicaMicrosandboxQualificationAuthority({
      store: new FileModelicaMicrosandboxQualificationStore(
        `${LOCAL_MODELICA_QUALIFICATION_ROOT}/captures`,
      ),
      publications: new FileIsolatedOutputCas(
        `${LOCAL_MODELICA_QUALIFICATION_ROOT}/outputs`,
      ),
      pinnedCaptureFingerprint: LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT,
    });
  const modelicaExecutionCaptures = modelicaIsolatedExecution === undefined
    ? undefined
    : new FileModelicaIsolatedExecutionCaptureStore(
      `${recordedAnalysisDirectory}/modelica/isolated-execution/captures`,
    );
  const calculixIsolatedExecution = options.calculixIsolatedExecution === undefined
    ? undefined
    : await (await import(
      "./src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts"
    )).createCalculixIsolatedExecutionComposition(
      options.calculixIsolatedExecution,
      {
        outputCasDirectory:
          `${recordedAnalysisDirectory}/calculix/isolated-execution/outputs`,
        attemptDirectory:
          `${recordedAnalysisDirectory}/calculix/isolated-execution/attempts`,
        evidenceDirectory:
          `${recordedAnalysisDirectory}/calculix/isolated-execution/evidence`,
        leaseDirectory:
          `${recordedAnalysisDirectory}/calculix/isolated-execution/leases`,
        durabilitySyncBoundary: recordedAnalysisDirectory,
      },
    );
  const calculixLocalProfile = calculixIsolatedExecution === undefined
    ? undefined
    : await calculixIsolatedExecution.profiles.initial();
  // One historical proof CAS instance is deliberately shared by the seal,
  // isolated @3 run and ROP2 reader. Its descriptor owns the pre-existing
  // on-disk location; moving it beneath the recorded-analysis root would make
  // already sealed proof artifacts invisible to the isolated executor.
  const feaProofCaptures = new FileCaptureStore(
    FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  );
  // The ROP authority audit reopens this optional sidecar from the same
  // immutable store used by the proof-seal executor. The namespace remains a
  // closed, code-owned member of RecordedAnalysisCasReader.
  const sensitivityCatalogOfferCaptures = new FileCaptureStore(
    SENSITIVITY_CATALOG_OFFER_CAPTURE_DESCRIPTOR,
  );
  // Requirements are likewise a historical shared CAS. Model authoring, the
  // proof-case seal, the isolated @3 run and the ROP2 reader must resolve the
  // same immutable bytes, including when a deployment overrides only their
  // storage directory.
  const requirementsCaptures = new FileCaptureStore({
    ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
    directory: options.requirementsCaptureDirectory ??
      DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY,
  });
  const recordedAnalysisCas = new RecordedAnalysisCasReader({
    stores: [
      {
        namespace: "fea-proof-case-capture",
        storage: "text",
        store: feaProofCaptures,
      },
      {
        namespace: "sensitivity-catalog-offer-capture",
        storage: "text",
        store: sensitivityCatalogOfferCaptures,
      },
      {
        namespace: "requirements-capture",
        storage: "text",
        store: requirementsCaptures,
      },
    ],
  });
  const recordedPlanResolver = new ResolvedOperationPlanResolver({
    snapshots: threadSnapshots,
    artifacts: recordedAnalysisCas,
    admissions: technicalCompilationAdmissions,
    stepAssets: new FileCanonicalAssetReader({
      directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
    }),
    ...(calculixLocalProfile === undefined
      ? {}
      : { calculix: { localProfile: calculixLocalProfile } }),
  });
  const recordedRunPlans = new CaptureBackedRunPlanSealer({
    store: new FileByteStore({
      ...RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
      directory: `${recordedAnalysisDirectory}/resolved-operation-plans`,
    }),
    resolver: recordedPlanResolver,
  });
  const activeProjectDirectory = options.activeProjectDirectory ??
    DEFAULT_ACTIVE_PROJECT_DIRECTORY;
  const runtime = await createEngineeringProjectCommandRuntime({
    projectId: options.projectId,
    trackedManifestPath: options.projectPath,
    activeDirectory: activeProjectDirectory,
    evidenceSnapshots: threadSnapshots,
    planning: {
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
      runPlanSealer: recordedRunPlans,
    },
    initialEvidenceValidator: new ExactInitialBaselineEvidenceValidator(
      activeThreadSnapshots,
      captures,
      {
        sourceCaptures: briefSourceCaptures,
        analysisCaptures: sourceAnalysisCaptures,
        frontends: briefSourceAnalysisFrontends,
      },
    ),
  });
  const briefRequirementsReview = new PrepareProjectBriefRequirementsReview({
    projects: runtime.projects,
  });
  const briefArchitectureReview = new PrepareProjectBriefArchitectureReview({
    projects: runtime.projects,
  });
  const baseline = new ApprovedBriefBaselineRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    captures,
    briefSourceAnalysis,
    briefSourceCaptures,
    sourceAnalysisCaptures,
    briefSourceAnalysisFrontends,
    snapshots: activeThreadSnapshots,
    lease,
    liveUpdates,
  });
  const sysonModelSeed = sysonMcpUrl
    ? new SysonModelSeedRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      captures: sysonModelSeedCaptures,
      attempts: new FileSysonModelSeedAttemptStore(
        options.sysonModelSeedAttemptDirectory ??
          DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  const genericArchitectureCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: options.architectureCaptureDirectory ??
      DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY,
  });
  const technicalCompilationBasis = new CaptureBackedTechnicalCompilationBasisResolver({
    projects: runtime.projects,
    snapshots: activeThreadSnapshots,
    architectureCaptures: genericArchitectureCaptures,
    seedCaptures: sysonModelSeedCaptures,
    requirementsCaptures,
  });
  const thermalMethodSheets = new FileThermalMethodSheetStore(
    new FileCaptureStore({
      ...THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
      directory: `${recordedAnalysisDirectory}/modelica/thermal-method-sheet-captures`,
    }),
  );
  const thermalMethodSheetSealBytes = new FileByteStore({
    kind: "modelica-thermal-method-sheet-seal-capture",
    directory: `${recordedAnalysisDirectory}/modelica/thermal-method-sheet-seals`,
    uriNamespace: "modelica-thermal-method-sheet-seal-capture",
    label: "Sealed Modelica thermal method sheet",
  });
  const thermalMethodSheetSeals = {
    save: (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
      canonicalText: string,
    ) =>
      thermalMethodSheetSealBytes.save(
        fingerprint,
        new TextEncoder().encode(canonicalText),
      ),
    read: async (
      fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    ) => {
      const stored = await thermalMethodSheetSealBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
  const thermalMethodSheetCompilationJoin =
    new CaptureBackedThermalMethodSheetCompilationJoin({
      snapshots: activeThreadSnapshots,
      captures: thermalMethodSheetSeals,
      sheets: thermalMethodSheets,
    });
  const technicalCompilationPreview = new PreviewProjectTechnicalCompilation({
    basisResolver: technicalCompilationBasis,
    sourceReader: technicalCompilationSources,
    profileCatalog: technicalCompilationProfiles,
    draftStore: technicalCompilationDrafts,
    projects: runtime.projects,
    methodSheets: thermalMethodSheetCompilationJoin,
  });
  const compileSealAdmission = new CompileSealAdmissionRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    basisResolver: technicalCompilationBasis,
    drafts: technicalCompilationDrafts,
    sources: technicalCompilationSources,
    profiles: technicalCompilationProfiles,
    captures: technicalCompilationSeals,
    lease,
  });
  const modelSealArchitectureSysml = new ModelSealArchitectureSysmlRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    sources: architectureSysmlSourceAnalysis,
    captures: architectureSysmlSeals,
    lease,
  });
  const thermalMethodSheetSourceCaptures =
    new FileThermalMethodSheetSourceCaptureReader(
      technicalSourceAnalysisCaptures,
    );
  const thermalMethodSheetSealReview = new PrepareProjectThermalMethodSheetSealReview({
    sheets: thermalMethodSheets,
    sourceCaptures: thermalMethodSheetSourceCaptures,
    basisResolver: technicalCompilationBasis,
  });
  const verifySealModelicaThermalMethodSheet =
    new VerifySealModelicaThermalMethodSheetRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      sheets: thermalMethodSheets,
      sourceCaptures: thermalMethodSheetSourceCaptures,
      basisResolver: technicalCompilationBasis,
      captures: thermalMethodSheetSeals,
      lease,
    });
  const admittedObservationEvidence = new FileAdmittedObservationEvidenceReader(
    new FileByteStore({
      kind: "isolated-output",
      directory: `${recordedAnalysisDirectory}/modelica/admitted/outputs`,
      uriNamespace: "isolated-output",
      label: "Admitted Modelica isolated output",
    }),
  );
  const admittedObservationEvaluationCaptures =
    new FileAdmittedObservationEvaluationCaptureStore(
      new FileCaptureStore({
        ...ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
        directory:
          `${recordedAnalysisDirectory}/modelica/admitted-observation-evaluation-captures`,
      }),
    );
  const admittedModelicaEvaluationReview =
    new PrepareProjectAdmittedModelicaEvaluationReview({
      projects: runtime.projects,
      snapshots: activeThreadSnapshots,
      methodSheets: thermalMethodSheetCompilationJoin,
      evidence: admittedObservationEvidence,
    });
  const verifyEvaluateAdmittedModelicaObservations = sysonMcpUrl
    ? new VerifyEvaluateAdmittedModelicaObservationsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      sheets: thermalMethodSheets,
      evidence: admittedObservationEvidence,
      captures: admittedObservationEvaluationCaptures,
      sheetCaptures: thermalMethodSheetSeals,
      attempts: new FileAdmittedObservationEvaluationAttemptStore(
        `${recordedAnalysisDirectory}/modelica/admitted-observation-evaluation-attempts`,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const decideAdmittedModelicaEvaluation =
    new DecideAdmittedModelicaEvaluationRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      sheets: thermalMethodSheets,
      evaluationCaptures: admittedObservationEvaluationCaptures,
      closeoutCaptures: new FileCaptureStore({
        ...ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
        directory:
          `${recordedAnalysisDirectory}/modelica/admitted-observation-evaluation-closeout-captures`,
      }),
      lease,
    });
  const designExecuteBuild123d = build123dExecution?.execution === undefined
    ? undefined
    : new DesignExecuteBuild123dRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: build123dThreadSnapshots,
      admissions: technicalCompilationAdmissions,
      profiles: build123dExecution.profiles,
      runner: build123dExecution.execution.runner,
      recovery: build123dExecution.execution.recovery,
      publications: build123dExecution.execution.publications,
      attempts: new FileBuild123dExecutionAttemptStore(
        `${recordedAnalysisDirectory}/build123d/attempts`,
      ),
      drafts: new FileBuild123dExecutionDraftStore(
        `${recordedAnalysisDirectory}/build123d/drafts`,
      ),
      captures: build123dExecutionCaptures,
      lease,
    });
  const designSealIsolatedGeometry = new DesignSealIsolatedGeometryRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: build123dThreadSnapshots,
    executionCaptures: build123dExecutionCaptures,
    publications: isolatedOutputPublications,
    captures: isolatedGeometrySeals,
    lease,
  });
  const modelicaQualifiedKitRunReview = modelicaIsolatedExecution === undefined ||
      modelicaQualificationAuthority === undefined
    ? undefined
    : new PrepareProjectModelicaQualifiedKitRunReview({
      basisAuthority: new ProjectThreadModelicaQualifiedKitReviewBasisAuthority({
        projects: runtime.projects,
        snapshots: threadSnapshots,
      }),
      profiles: modelicaIsolatedExecution.profiles,
      qualifications: modelicaQualificationAuthority,
      bundleFactory: new CodeOwnedModelicaQualifiedKitBundleFactory(),
    });
  const simulateRunQualifiedModelicaKit =
    modelicaIsolatedExecution?.execution === undefined ||
      modelicaQualificationAuthority === undefined ||
      modelicaExecutionCaptures === undefined ||
      modelicaQualifiedKitRunReview === undefined
      ? undefined
      : new SimulateRunQualifiedModelicaKitRunExecutor({
        projects: runtime.projects,
        commands: runtime.commands,
        snapshots: build123dThreadSnapshots,
        review: modelicaQualifiedKitRunReview,
        execution: new ExecuteIsolatedModelicaRun({
          profiles: modelicaIsolatedExecution.profiles,
          qualifications: modelicaQualificationAuthority,
          lease,
          runner: modelicaIsolatedExecution.execution.runner,
          recovery: modelicaIsolatedExecution.execution.recovery,
          publications: modelicaIsolatedExecution.execution.publications,
          attempts: new FileModelicaIsolatedExecutionAttemptStore(
            `${recordedAnalysisDirectory}/modelica/isolated-execution/attempts`,
          ),
          captures: modelicaExecutionCaptures,
        }),
        captures: modelicaExecutionCaptures,
        lease,
      });
  const exactAdmittedModelicaRunReview = admittedModelicaExecution === undefined
    ? undefined
    : new PrepareProjectAdmittedModelicaRunReview({
      admissions: technicalCompilationAdmissions,
      profiles: admittedModelicaExecution.profiles,
    });
  const admittedModelicaRunReview = exactAdmittedModelicaRunReview === undefined
    ? undefined
    : new ResolveProjectAdmittedModelicaRunReview({
      projects: runtime.projects,
      snapshots: build123dThreadSnapshots,
      exactReview: exactAdmittedModelicaRunReview,
    });
  const simulateRunAdmittedModelica =
    admittedModelicaExecution?.execution === undefined ||
      admittedModelicaRunReview === undefined
      ? undefined
      : new SimulateRunAdmittedModelicaRunExecutor({
        projects: runtime.projects,
        commands: runtime.commands,
        snapshots: build123dThreadSnapshots,
        admissions: technicalCompilationAdmissions,
        profiles: admittedModelicaExecution.profiles,
        runner: admittedModelicaExecution.execution.runner,
        recovery: admittedModelicaExecution.execution.recovery,
        publications: admittedModelicaExecution.execution.publications,
        attempts: new FileAdmittedModelicaExecutionAttemptStore(
          `${recordedAnalysisDirectory}/modelica/admitted/attempts`,
        ),
        captures: admittedModelicaCaptures,
        lease,
      });
  const genericModelWriteArchitecture = sysonMcpUrl
    ? new ModelWriteArchitectureRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
      captures: genericArchitectureCaptures,
      sysmlSourceAnalysis,
      attempts: new FileArchitectureAttemptStore(
        options.architectureAttemptDirectory ?? DEFAULT_ARCHITECTURE_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  const genericModelCapturePartDefinitions = sysonMcpUrl
    ? new ModelCapturePartDefinitionsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: genericArchitectureCaptures,
      seedCaptures: sysonModelSeedCaptures,
      captures: new FileCaptureStore({
        ...PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
        directory: options.partDefinitionsCaptureDirectory ??
          DEFAULT_PART_DEFINITIONS_CAPTURE_DIRECTORY,
      }),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      publications: new FilePartDefinitionsPublicationStore(
        options.partDefinitionsPublicationDirectory ??
          DEFAULT_PART_DEFINITIONS_PUBLICATION_DIRECTORY,
      ),
    })
    : undefined;
  /**
   * The write-geometry executor promotes exact bytes from a human-signed draft
   * into the evidence thread.  It makes no provider calls — the draft and its
   * binary assets must already be present in the draft stores before the run.
   */
  const geometrySourceAnalysis = {
    sourceCaptures: new FileCaptureStore(GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR),
    analysisCaptures: sourceAnalysisCaptures,
    frontend: new PythonCadSourceAnalyzer(),
  } as const;
  const genericDesignWriteGeometry = new DesignWriteGeometryRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    architectureCaptures: genericArchitectureCaptures,
    sysmlSourceAnalysis,
    geometryDraftCaptures: new FileCaptureStore({
      ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
      directory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
    }),
    geometrySourceCaptures: geometrySourceAnalysis.sourceCaptures,
    sourceAnalysisCaptures: geometrySourceAnalysis.analysisCaptures,
    geometryCaptures: new FileCaptureStore({
      ...GEOMETRY_CAPTURE_DESCRIPTOR,
      directory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
    }),
    lease,
    now: () => new Date().toISOString(),
  });
  const genericModelWriteRequirements = sysonMcpUrl
    ? new ModelWriteRequirementsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
      architectureCaptures: genericArchitectureCaptures,
      sysmlSourceAnalysis,
      captures: requirementsCaptures,
      attempts: new FileRequirementsAttemptStore(
        options.requirementsAttemptDirectory ?? DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  const inspectionDroneV4Architecture = sysonMcpUrl
    ? new InspectionDroneV4ArchitectureRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
      captures: new FileCaptureStore({
        ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.inspectionDroneV4ArchitectureCaptureDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      attempts: new FileInspectionDroneV4ArchitectureAttemptStore(
        options.inspectionDroneV4ArchitectureAttemptDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const inspectionDroneV4PartDefinitions = sysonMcpUrl
    ? new InspectionDroneV4PartDefinitionsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: new FileCaptureStore({
        ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.inspectionDroneV4ArchitectureCaptureDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      captures: new FileCaptureStore({
        ...INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
        directory: options.inspectionDroneV4PartDefinitionsCaptureDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DIRECTORY,
      }),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      publications: new FileInspectionDroneV4PartDefinitionsPublicationStore(
        options.inspectionDroneV4PartDefinitionsPublicationDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_PUBLICATION_DIRECTORY,
      ),
    })
    : undefined;
  // Generic archive-lineage requires no provider — always available.
  const genericArchiveLineage = new ArchiveLineageRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
  });
  // Reconcile-uncertain-writer requires no provider — always available.
  // Human-only: the executor gate rejects any non-human origin.
  const genericReconcileUncertainWriter = new ReconcileUncertainWriterRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
  });
  // FEA proof-case seal calls no provider — always available.
  const geometryCaptures = new FileCaptureStore(GEOMETRY_CAPTURE_DESCRIPTOR);
  const proofCaseCatalogReader = new FileCataloguedMechanicalProofCaseReader();
  const sensitivityStudyCaseCatalogReader =
    new FileCataloguedSensitivityStudyCaseReader();
  const proofSealRequirementsReviewer =
    new CaptureBackedFeaProofSealRequirementsReviewer({
      requirementsCaptures,
      seedCaptures: sysonModelSeedCaptures,
    });
  const feaProofStepAssets = new FileCanonicalAssetReader({
    directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
  });
  const feaProofSealReview = new PrepareProjectFeaProofSealReview({
    snapshots: activeThreadSnapshots,
    projects: runtime.projects,
    catalogReader: proofCaseCatalogReader,
    requirementsReviewer: proofSealRequirementsReviewer,
    geometryCaptures,
    stepAssets: feaProofStepAssets,
    admissions: technicalCompilationAdmissions,
  });
  const feaIsolatedRunReview = new PrepareProjectFeaIsolatedRunReview({
    snapshots: activeThreadSnapshots,
    admissionReviewer: recordedPlanResolver,
    projects: runtime.projects,
  });
  const genericVerifySealProofCase = new VerifySealProofCaseRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    proofCaseCaptures: feaProofCaptures,
    sensitivityCatalogOffers: sensitivityCatalogOfferCaptures,
    admissions: technicalCompilationAdmissions,
    geometryCaptures,
    requirementsCaptures,
    seedCaptures: sysonModelSeedCaptures,
    canonicalAssetReader: feaProofStepAssets,
    catalog: proofCaseCatalogReader,
    lease,
  });
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
  const correctedSourceCaptures = new FileCaptureStore(
    CORRECTED_SOURCE_CAPTURE_DESCRIPTOR,
  );
  const vectorCorrectionReview = new PrepareProjectVectorCorrectionReview({
    snapshots: activeThreadSnapshots,
    studyCaptures: sensitivityStudyCaptures,
  });
  const sensitivityBaseEvaluationReview =
    new PrepareProjectSensitivityBaseEvaluationReview({
      snapshots: activeThreadSnapshots,
      studyCaptures: sensitivityStudyCaptures,
    });
  const sensitivityStudySealReview = new PrepareProjectSensitivityStudySealReview({
    snapshots: activeThreadSnapshots,
    projects: runtime.projects,
    catalogReader: sensitivityStudyCaseCatalogReader,
    admissions: technicalCompilationAdmissions,
    catalogOffers: sensitivityCatalogOfferCaptures,
    proofCaptures: feaProofCaptures,
  });
  const correctedAdmissionReview = new PrepareProjectCorrectedAdmissionReview({
    snapshots: activeThreadSnapshots,
    captures: correctedSourceCaptures,
    admissions: technicalCompilationAdmissions,
    preview: technicalCompilationPreview,
  });
  const designApplyVectorCorrection = new DesignApplyVectorCorrectionRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    studyCaptures: sensitivityStudyCaptures,
    captures: vectorCorrectionCaptures,
    lease,
  });
  const compileCaptureCorrectedSource = new CompileCaptureCorrectedSourceRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    corrections: vectorCorrectionCaptures,
    studyCaptures: sensitivityStudyCaptures,
    admissions: technicalCompilationAdmissions,
    sourceCaptures: technicalSourceCapture,
    captures: correctedSourceCaptures,
    lease,
    profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  });
  const analyzeSealSensitivityStudy = new AnalyzeSealSensitivityStudyRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    admissions: technicalCompilationAdmissions,
    captures: sensitivityCaseCaptures,
    catalogOffers: sensitivityCatalogOfferCaptures,
    proofCaptures: feaProofCaptures,
    catalog: sensitivityStudyCaseCatalogReader,
    lease,
  });
  const analyzeRunFeaSensitivity =
    build123dExecution?.execution !== undefined && calculixMcpUrl
      ? new AnalyzeRunFeaSensitivityRunExecutor({
        projects: runtime.projects,
        commands: runtime.commands,
        snapshots: activeThreadSnapshots,
        caseCaptures: sensitivityCaseCaptures,
        studyCaptures: sensitivityStudyCaptures,
        admissions: technicalCompilationAdmissions,
        profiles: build123dExecution.profiles,
        runner: build123dExecution.execution.runner,
        stager: new IsolatedStepSolverStager(
          DEFAULT_SENSITIVITY_STEP_CACHE_DIRECTORY,
          new DockerVolumeAssetStager({
            service: "mcp-calculix",
            containerDirectory: "/inputs",
          }),
        ),
        solver: new McpCalculixSensitivitySolver(
          new HttpMcpToolClient({ mcpUrl: calculixMcpUrl, timeoutMs: 180_000 }),
        ),
        attempts: new FileFeaSensitivityAttemptStore(),
        lease,
      })
      : undefined;
  const printabilityCaseCaptures = new FileCaptureStore({
    ...PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
    directory: options.printabilityCaseCaptureDirectory ??
      DEFAULT_PRINTABILITY_CASE_CAPTURE_DIRECTORY,
  });
  const printabilityObservationCaptures = new FileCaptureStore({
    ...PRINTABILITY_OBSERVATION_CAPTURE_DESCRIPTOR,
    directory: options.printabilityObservationCaptureDirectory ??
      DEFAULT_PRINTABILITY_OBSERVATION_CAPTURE_DIRECTORY,
  });
  const printEstimateCaseCaptures = new FileCaptureStore({
    ...PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
    directory: options.printEstimateCaseCaptureDirectory ??
      DEFAULT_PRINT_ESTIMATE_CASE_CAPTURE_DIRECTORY,
  });
  const printEstimateObservationCaptures = new FileCaptureStore({
    ...PRINT_ESTIMATE_OBSERVATION_CAPTURE_DESCRIPTOR,
    directory: options.printEstimateObservationCaptureDirectory ??
      DEFAULT_PRINT_ESTIMATE_OBSERVATION_CAPTURE_DIRECTORY,
  });
  const industrializeSealPrintabilityCase =
    new IndustrializeSealPrintabilityCaseRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      captures: printabilityCaseCaptures,
      lease,
    });
  const industrializeObservePrintability = dfmMcpUrl
    ? new IndustrializeObservePrintabilityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: printabilityCaseCaptures,
      observationCaptures: printabilityObservationCaptures,
      geometryAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      stager: new ExportVolumeGeometryStager(DEFAULT_PRINTABILITY_EXPORT_DIRECTORY),
      dfm: new HttpMcpToolClient({ mcpUrl: dfmMcpUrl, timeoutMs: 120_000 }),
      attempts: new FilePrintabilityAttemptStore(
        options.printabilityAttemptDirectory ?? DEFAULT_PRINTABILITY_ATTEMPT_DIRECTORY,
      ),
      lease,
    })
    : undefined;
  const industrializeSealPrintEstimateCase =
    new IndustrializeSealPrintEstimateCaseRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      captures: printEstimateCaseCaptures,
      lease,
    });
  const dfmCaseCaptures = new FileCaptureStore({
    ...DFM_CASE_CAPTURE_DESCRIPTOR,
    directory: options.dfmCaseCaptureDirectory ?? DEFAULT_DFM_CASE_CAPTURE_DIRECTORY,
  });
  const dfmCheckCaptures = new FileCaptureStore({
    ...DFM_CHECK_CAPTURE_DESCRIPTOR,
    directory: options.dfmCheckCaptureDirectory ?? DEFAULT_DFM_CHECK_CAPTURE_DIRECTORY,
  });
  const industrializeSealDfmCase = new IndustrializeSealDfmCaseRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    captures: dfmCaseCaptures,
    lease,
  });
  const industrializeRunDfmChecks = dfmMcpUrl
    ? new IndustrializeRunDfmChecksRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: dfmCaseCaptures,
      checkCaptures: dfmCheckCaptures,
      geometryAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      stager: new ExportVolumeGeometryStager(DEFAULT_DFM_EXPORT_DIRECTORY),
      dfm: new HttpMcpToolClient({ mcpUrl: dfmMcpUrl, timeoutMs: 120_000 }),
      attempts: new FileDfmCheckAttemptStore(
        options.dfmCheckAttemptDirectory ?? DEFAULT_DFM_CHECK_ATTEMPT_DIRECTORY,
      ),
      lease,
    })
    : undefined;
  const industrializeObservePrintEstimate = prusaslicerMcpUrl
    ? new IndustrializeObservePrintEstimateRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: printEstimateCaseCaptures,
      observationCaptures: printEstimateObservationCaptures,
      geometryAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
        extension: "stl",
      }),
      stager: new ExportVolumeGeometryStager(DEFAULT_PRINT_ESTIMATE_EXPORT_DIRECTORY),
      prusaslicer: new HttpMcpToolClient({
        mcpUrl: prusaslicerMcpUrl,
        timeoutMs: 180_000,
      }),
      attempts: new FilePrintEstimateAttemptStore(
        options.printEstimateAttemptDirectory ??
          DEFAULT_PRINT_ESTIMATE_ATTEMPT_DIRECTORY,
      ),
      lease,
    })
    : undefined;
  const verifyEvaluateSensitivityBase = sysonMcpUrl
    ? new VerifyEvaluateSensitivityBaseRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      studyCaptures: sensitivityStudyCaptures,
      captures: sensitivityBaseEvaluationCaptures,
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const modelWriteSensitivityEdges = sysonMcpUrl
    ? new ModelWriteSensitivityEdgesRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      studyCaptures: sensitivityStudyCaptures,
      edgeCaptures: sensitivityEdgesCaptures,
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      resolveSysonContext: async (snapshot) => {
        if (!findArchitectureArtifact(snapshot)) {
          throw new Error("No architecture artifact is present on the Thread basis.");
        }
        const seed = snapshot.artifacts.find((artifact) =>
          artifact.kind === "sysml-model" &&
          artifact.uri?.startsWith("casys://syson-model-seed-capture/sha256/") &&
          artifact.producer.tool === "syson_model_create"
        );
        if (!seed) {
          throw new Error("No SysON seed artifact is present on the Thread basis.");
        }
        const text = await sysonModelSeedCaptures.read(seed.fingerprint);
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
      lease,
    })
    : undefined;
  const isolatedCalculixRun = sysonMcpUrl && calculixIsolatedExecution?.execution
    ? new VerifyRunFeaStaticProofV3RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      plans: recordedRunPlans,
      artifacts: recordedAnalysisCas,
      canonicalAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      profiles: calculixIsolatedExecution.profiles,
      executeIsolated: calculixIsolatedExecution.execution.execute,
      executionEvidence: calculixIsolatedExecution.execution.evidence,
      sysonEvaluationCaptureStore: new FileByteStore({
        kind: "calculix-isolated-syson-evaluation",
        directory:
          `${recordedAnalysisDirectory}/calculix/isolated-execution/syson-evaluations`,
        uriNamespace: "calculix-isolated-syson-evaluation",
        label: "Isolated CalculiX SysON evaluation",
      }),
      attempts: new FileCalculixIsolatedProductAttemptStore(
        `${recordedAnalysisDirectory}/calculix/isolated-execution/product-attempts`,
        recordedAnalysisDirectory,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  return {
    brief: {
      projects: runtime.projects,
      commands: new ProjectBriefCommandService(runtime.projects),
    },
    control: {
      projects: runtime.projects,
      commands: runtime.commands,
      threadSnapshots,
      // The same CAS-backed object seals at queue time and reads through the
      // agent-visible plan inspection tool. No alternate plan authority is
      // composed for execution or control-plane reads.
      runPlanReader: recordedRunPlans,
      technicalSourceCapture,
      technicalCompilationPreview,
      architectureSysmlSourceCapture,
      architectureSysmlPreview,
      briefArchitectureReview,
      briefRequirementsReview,
      feaProofSealReview,
      feaIsolatedRunReview,
      sensitivityStudySealReview,
      build123dExecutionReview,
      isolatedGeometrySealReview,
      vectorCorrectionReview,
      sensitivityBaseEvaluationReview,
      correctedAdmissionReview,
      modelicaQualifiedKitRunReview,
      admittedModelicaRunReview,
      admittedModelicaEvaluationReview,
      thermalMethodSheetSealReview,
      ledDriverSourceCapture,
      ledDriverSourceReview,
      reviewIntents: new FileProjectReviewIntentStore(
        options.projectReviewIntentDirectory ??
          DEFAULT_PROJECT_REVIEW_INTENT_DIRECTORY,
      ),
      // WHY THE SANDBOX INSTANCE AND NOT THE TRUSTED ONE — admitted export
      // reopens sealed CAD bytes. A fingerprint proves identity after sealing,
      // never causal provenance. The sandbox owns a private export volume, so
      // those bytes never touch evidence. No sandbox entry ⇒ no admitted-export
      // tool. It is not gated on --local-execution.
      ...composePrivateBuild123dGeometrySurfaces(
        build123dSandboxMcpUrl,
        geometrySourceAnalysis,
        technicalCompilationAdmissions,
        threadSnapshots,
        genericArchitectureCaptures,
      ),
      runExecutor: new RegisteredProjectRunExecutor({
        projects: runtime.projects,
        baseline,
        sysonModelSeed,
        additional: [
          {
            operation: COMPILE_SEAL_ADMISSION_OPERATION,
            executor: compileSealAdmission,
          },
          {
            operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
            executor: modelSealArchitectureSysml,
          },
          {
            operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
            executor: designExecuteBuild123d,
            unavailableMessage:
              "The server has no complete qualified Build123d isolated runtime configured for this run.",
          },
          {
            operation: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
            executor: designSealIsolatedGeometry,
          },
          {
            operation: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
            executor: verifySealModelicaThermalMethodSheet,
          },
          {
            operation: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
            executor: verifyEvaluateAdmittedModelicaObservations,
            unavailableMessage:
              "The server has no trusted verify.evaluate-admitted-modelica-observations@1 executor configured for this run (SysON provider is required).",
          },
          {
            operation: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
            executor: decideAdmittedModelicaEvaluation,
          },
          {
            operation: DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
            executor: decideAdmittedModelicaEvaluation,
          },
          {
            operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
            executor: simulateRunQualifiedModelicaKit,
            unavailableMessage:
              "The server has no complete qualified local Modelica runtime and pinned qualification configured for this run.",
          },
          {
            operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
            executor: simulateRunAdmittedModelica,
            unavailableMessage:
              "The server has no admitted Modelica closed-subset isolated runtime configured for this run.",
          },
          {
            operation: INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
            executor: inspectionDroneV4Architecture,
            unavailableMessage:
              "The server has no trusted inspection-drone V4 SysON architecture executor configured for this run.",
          },
          {
            operation: INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
            executor: inspectionDroneV4PartDefinitions,
            unavailableMessage:
              "The server has no trusted inspection-drone V4 PartDefinitions executor configured for this run.",
          },
          {
            operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
            executor: genericModelWriteArchitecture,
            unavailableMessage:
              "The server has no trusted generic model.write-architecture@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
            executor: genericModelCapturePartDefinitions,
            unavailableMessage:
              "The server has no trusted generic model.capture-part-definitions@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: DESIGN_WRITE_GEOMETRY_OPERATION,
            executor: genericDesignWriteGeometry,
          },
          {
            operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
            executor: genericModelWriteRequirements,
            unavailableMessage:
              "The server has no trusted generic model.write-requirements@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: ARCHIVE_LINEAGE_OPERATION,
            executor: genericArchiveLineage,
          },
          {
            operation: RECONCILE_UNCERTAIN_WRITER_OPERATION,
            executor: genericReconcileUncertainWriter,
          },
          {
            operation: VERIFY_SEAL_PROOF_CASE_OPERATION,
            executor: genericVerifySealProofCase,
          },
          {
            operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
            executor: isolatedCalculixRun,
            unavailableMessage:
              "The server has no complete qualified local CalculiX runtime and SysON oracle configured for this run.",
          },
          {
            operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
            executor: analyzeSealSensitivityStudy,
          },
          {
            operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
            executor: analyzeRunFeaSensitivity,
            unavailableMessage:
              "The server has no trusted analyze.run-fea-sensitivity@1 executor " +
              "configured for this run (isolated Build123d and CalculiX are required).",
          },
          {
            operation: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
            executor: modelWriteSensitivityEdges,
            unavailableMessage:
              "The server has no trusted model.write-sensitivity-edges@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
            executor: verifyEvaluateSensitivityBase,
            unavailableMessage:
              "The server has no trusted verify.evaluate-sensitivity-base@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
            executor: industrializeSealPrintabilityCase,
          },
          {
            operation: INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
            executor: industrializeObservePrintability,
            unavailableMessage:
              "The server has no trusted industrialize.observe-printability@1 executor " +
              "configured for this run (dfm provider is required).",
          },
          {
            operation: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
            executor: industrializeSealPrintEstimateCase,
          },
          {
            operation: INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
            executor: industrializeObservePrintEstimate,
            unavailableMessage:
              "The server has no trusted industrialize.observe-print-estimate@1 executor " +
              "configured for this run (prusaslicer provider is required).",
          },
          {
            operation: INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
            executor: industrializeSealDfmCase,
          },
          {
            operation: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
            executor: industrializeRunDfmChecks,
            unavailableMessage:
              "The server has no trusted industrialize.run-dfm-checks@1 executor " +
              "configured for this run (dfm provider is required).",
          },
          {
            operation: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
            executor: designApplyVectorCorrection,
          },
          {
            operation: COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION,
            executor: compileCaptureCorrectedSource,
          },
        ],
      }),
    },
  };
}

function createCockpitFocus(
  options: CreateConsoleServerOptions,
): CockpitFocusToolDependencies {
  return {
    focus: new FileCockpitFocusStore(
      options.cockpitFocusDirectory ?? DEFAULT_COCKPIT_FOCUS_DIRECTORY,
    ),
    projects: new FileEngineeringProjectRevisionStore(
      options.activeProjectDirectory ?? DEFAULT_ACTIVE_PROJECT_DIRECTORY,
    ),
  };
}

function composePrivateBuild123dGeometrySurfaces(
  build123dSandboxMcpUrl: string | undefined,
  geometrySourceAnalysis: GeometrySourceAnalysisCaptureDependencies,
  admissions: CaptureBackedTechnicalCompilationAdmissionReader,
  snapshots: Pick<FileThreadSnapshotStore, "get">,
  architectureCaptures: FileCaptureStore<"architecture-capture">,
): Pick<ProjectControlToolDependencies, "admittedGeometryExport"> {
  if (!build123dSandboxMcpUrl) {
    return { admittedGeometryExport: undefined };
  }
  const client = new HttpMcpToolClient({
    mcpUrl: build123dSandboxMcpUrl,
    timeoutMs: 120_000,
  });
  const draftCaptures = new FileCaptureStore({
    ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
    directory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
  });
  return {
    admittedGeometryExport: new ExportAdmittedProjectGeometry({
      admissions,
      snapshots,
      architecture: {
        async read(fingerprint) {
          const text = await architectureCaptures.read(fingerprint);
          if (!text) return undefined;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return undefined;
          }
          try {
            const capture = parseExactArchitectureCapture(parsed);
            return {
              partDefinitions: capture.partDefinitions.map((definition) => ({
                id: definition.id,
                label: definition.label,
                usages: definition.usages.map((usage) => ({
                  id: usage.id,
                  label: usage.label,
                  targetId: usage.targetId,
                })),
              })),
            };
          } catch {
            return undefined;
          }
        },
      },
      exporter: new AdmissionBackedGeometryExportAdapter({
        client,
        draftCaptures,
        sourceAnalysis: geometrySourceAnalysis,
        build123dService: "mcp-build123d-sandbox",
      }),
    }),
  };
}

if (import.meta.main) {
  const cli = parseConsoleCli(Deno.args);
  const port = cli.port ?? integerEnv("MCP_PORT") ?? DEFAULT_PORT;
  const hostname = cli.hostname ?? env("MCP_HOSTNAME") ?? DEFAULT_HOSTNAME;
  const projectToolsEnabled = isExplicitLoopbackHostname(hostname);
  const approvalMode = approvalModeForBinding(cli.yolo === true, hostname);
  const localExecution = localExecutionForBinding(
    cli.localExecution === true,
    hostname,
  );
  const { app } = await createConsoleServer({
    projectControl: projectToolsEnabled ? undefined : false,
    projectReviewIntentDirectory: cli.projectReviewIntentDirectory,
    approvalMode,
    build123dExecution: localExecution
      ? await createLocalBuild123dExecutionServerOptions()
      : undefined,
    modelicaIsolatedExecution: localExecution
      ? await createLocalModelicaIsolatedExecutionServerOptions()
      : undefined,
    admittedModelicaExecution: localExecution
      ? await createLocalAdmittedModelicaExecutionServerOptions()
      : undefined,
    calculixIsolatedExecution: localExecution
      ? await createLocalCalculixIsolatedExecutionServerOptions()
      : undefined,
  });
  const http = await app.startHttp({
    port,
    hostname,
    corsOrigins: ["http://127.0.0.1", "http://localhost"],
    onListen: ({ hostname: boundHostname, port: boundPort }) => {
      console.error(
        `Casys digital-thread console: http://${boundHostname}:${boundPort}/mcp`,
      );
      if (approvalMode.kind === "local-yolo") {
        console.error(
          "YOLO ACTIVE: positive brief confirmations and MRTR decision approvals are auto-approved under human/local-yolo:startup-opt-in.",
        );
      }
      if (localExecution) {
        console.error(
          `LOCAL EXECUTION ACTIVE: qualified Build123d, Modelica kit, admitted Modelica, and CalculiX runs use ${LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE}, and ${LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE} through the attached local Microsandbox backend; CalculiX publication still requires the SysON oracle.`,
        );
      }
      if (!projectToolsEnabled) {
        console.error(
          "Project mutation tools disabled: non-loopback MCP binding exposes the read-only fleet console only.",
        );
      }
    },
  });
  installGracefulHttpShutdown(http, {
    onError(error, context) {
      console.error(
        `Casys digital-thread console ${context.phase} failed after ${
          context.signal ?? "listener disposal"
        } signal handling:`,
        error,
      );
    },
  });
}

export interface ConsoleCliOptions {
  port?: number;
  hostname?: string;
  projectReviewIntentDirectory?: string;
  yolo?: true;
  localExecution?: true;
}

export function parseConsoleCli(args: string[]): ConsoleCliOptions {
  const result: ConsoleCliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--stdio") {
      throw new TypeError("--stdio is not supported; use stateless HTTP on /mcp.");
    } else if (argument === "--yolo") {
      result.yolo = true;
    } else if (argument === "--local-execution") {
      result.localExecution = true;
    } else if (argument.startsWith("--port=")) {
      result.port = positiveInteger(argument.slice("--port=".length), "--port");
    } else if (argument === "--port") {
      result.port = positiveInteger(args[++index], "--port");
    } else if (argument.startsWith("--hostname=")) {
      result.hostname = argument.slice("--hostname=".length);
    } else if (argument === "--hostname") {
      const hostname = args[++index];
      if (hostname === undefined) {
        throw new TypeError("--hostname requires a value");
      }
      result.hostname = hostname;
    } else if (argument.startsWith("--review-intent-dir=")) {
      result.projectReviewIntentDirectory = argument.slice(
        "--review-intent-dir=".length,
      );
    } else if (argument === "--review-intent-dir") {
      const directory = args[++index];
      if (directory === undefined) {
        throw new TypeError("--review-intent-dir requires a value");
      }
      result.projectReviewIntentDirectory = directory;
    } else {
      throw new TypeError(`Unknown console argument: ${argument}`);
    }
  }
  if (result.hostname !== undefined && result.hostname.trim() === "") {
    throw new TypeError("--hostname must not be empty");
  }
  if (
    result.projectReviewIntentDirectory !== undefined &&
    result.projectReviewIntentDirectory.trim() === ""
  ) {
    throw new TypeError("--review-intent-dir must not be empty");
  }
  return result;
}

/**
 * Code-owned product binding for the only qualified local Build123d runtime.
 * No environment value or CLI argument can select its image, policy, limits,
 * command, network, lifecycle, or backend.
 */
export async function createLocalBuild123dExecutionServerOptions(): Promise<
  Build123dExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "build123d-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_BUILD123D_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_BUILD123D_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}

/**
 * Code-owned product binding for the only qualified local Modelica runtime.
 * The separately persisted qualification capture is intentionally not part of
 * this option: review and execution reopen it through the pinned authority.
 */
export async function createLocalModelicaIsolatedExecutionServerOptions(): Promise<
  ModelicaIsolatedExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "modelica-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_MODELICA_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_MODELICA_EXECUTION_LIMITS,
      engine: Object.freeze({
        name: "OpenModelica" as const,
        version: "1.27.0",
        mslVersion: "4.1.0",
      }),
    }),
    runtime: Object.freeze({}),
  });
}

/** Code-owned binding for admitted Modelica closed-subset execution. */
export async function createLocalAdmittedModelicaExecutionServerOptions(): Promise<
  AdmittedModelicaExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "modelica-admitted-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_ADMITTED_MODELICA_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_MODELICA_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}

/** Code-owned binding for the qualified local CalculiX microVM profile. */
export async function createLocalCalculixIsolatedExecutionServerOptions(): Promise<
  CalculixIsolatedExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "calculix-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_CALCULIX_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      wrapperSha256: LOCAL_CALCULIX_WRAPPER_SHA256,
      policy,
      limits: LOCAL_CALCULIX_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}

/** Mandatory bind guard for every network-facing composition using local YOLO. */
export function approvalModeForBinding(
  yolo: boolean,
  hostname: string,
): ProjectApprovalMode {
  if (yolo && !isExplicitLoopbackHostname(hostname)) {
    throw new TypeError(
      "--yolo is restricted to an explicit loopback MCP hostname.",
    );
  }
  return yolo ? LOCAL_YOLO_PROJECT_APPROVAL_MODE : INTERACTIVE_PROJECT_APPROVAL_MODE;
}

/** Native local execution is never composed on a remotely reachable bind. */
export function localExecutionForBinding(
  requested: boolean,
  hostname: string,
): boolean {
  if (requested && !isExplicitLoopbackHostname(hostname)) {
    throw new TypeError(
      "--local-execution is restricted to an explicit loopback MCP hostname.",
    );
  }
  return requested;
}

function integerEnv(name: string): number | undefined {
  const value = env(name);
  return value === undefined ? undefined : positiveInteger(value, name);
}

function positiveInteger(
  value: string | undefined,
  name: string,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function ephemeralMrtrSigningKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
