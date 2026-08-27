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
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
  BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
  DFM_CASE_CAPTURE_DESCRIPTOR,
  DFM_CHECK_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_OBSERVATION_CAPTURE_DESCRIPTOR,
  PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
  PRINTABILITY_OBSERVATION_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
} from "./src/adapters/shared/cas/file-capture-store.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "./src/adapters/compile/source/project-brief-source-analyzer.ts";
import { BriefSourceAnalysisCaptureService } from "./src/adapters/compile/captures/brief-source-analysis-capture.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "./src/adapters/architecture/agent-seal/model-seal-architecture-sysml-run-executor.ts";
import type { Build123dExecutionServerOptions } from "./src/adapters/cad/isolated/build123d-execution-composition.ts";
import type { AdmittedModelicaExecutionServerOptions } from "./src/adapters/modelica/admitted/execution-composition.ts";
import type { AdmittedSpiceExecutionServerOptions } from "./src/adapters/electrical/spice/admitted/execution-composition.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./src/adapters/electrical/spice/admitted/local-image-references.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "./src/adapters/cad/sealed-isolated/design-seal-isolated-geometry-run-executor.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./src/adapters/modelica/qualified-kit/execution-composition.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "./src/adapters/modelica/evaluation/verify-evaluate-admitted-modelica-observations-run-executor.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
} from "./src/adapters/modelica/evaluation/decide-admitted-modelica-evaluation-run-executor.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "./src/adapters/fea/evaluation-closeout/decide-static-mechanical-evaluation-closeout-run-executor.ts";
import {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
} from "./src/adapters/cad/assembly-integrity/decide-assembly-integrity-evaluation-closeout-run-executor.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "./src/adapters/modelica/thermal-method-sheet/verify-seal-modelica-thermal-method-sheet-run-executor.ts";
import { VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION } from "./src/domain/impact/cross-domain-impact-manifest-proposal.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "./src/domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "./src/domain/impact/cross-domain-impact-decision-proposal.ts";
import { ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION } from "./src/domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION } from "./src/adapters/sensitivity/vector-correction/design-apply-vector-correction-run-executor.ts";
import { FixedSourceAnalysisFrontendRegistry } from "./src/domain/compile/source/source-analysis-frontend-registry.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/project/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./src/adapters/project/approved-brief-baseline-run-executor.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "./src/adapters/architecture/renderer/model-write-architecture-run-executor.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "./src/domain/architecture/part-definitions/part-definitions-capture.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./src/adapters/cad/canonical/design-write-geometry-run-executor.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "./src/adapters/architecture/requirements/model-write-requirements-run-executor.ts";
import {
  ARCHIVE_LINEAGE_OPERATION,
  ArchiveLineageRunExecutor,
} from "./src/adapters/record/archive-lineage-run-executor.ts";
import {
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
  ReconcileUncertainWriterRunExecutor,
} from "./src/adapters/record/reconcile-uncertain-writer-run-executor.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "./src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts";
import { FileCanonicalAssetReader } from "./src/adapters/assets/canonical-asset-reader.ts";
import { ExactAssemblyIntegrityInputReopener } from "./src/adapters/cad/assembly-integrity/exact-assembly-integrity-input-reopener.ts";
import { ExactStaticAssemblyBasisReopener } from "./src/adapters/cad/canonical/exact-static-assembly-basis-reopener.ts";
import { FileAssemblyIntegrityEvaluationAttemptStore } from "./src/adapters/cad/assembly-integrity/file-assembly-integrity-evaluation-attempt-store.ts";
import { FileAssemblyIntegrityEvaluationCaptureStore } from "./src/adapters/cad/assembly-integrity/file-assembly-integrity-evaluation-capture-store.ts";
import { FileAssemblyIntegrityObservationAttemptStore } from "./src/adapters/cad/assembly-integrity/file-assembly-integrity-observation-attempt-store.ts";
import { FileAssemblyIntegrityObservationCaptureStore } from "./src/adapters/cad/assembly-integrity/file-assembly-integrity-observation-capture-store.ts";
import { FixedAssemblyIntegrityObserverProfileCatalog } from "./src/adapters/cad/assembly-integrity/fixed-assembly-integrity-observer-profile-catalog.ts";
import { McpBuild123dAssemblyIntegrityObserver } from "./src/adapters/cad/assembly-integrity/mcp-build123d-assembly-integrity-observer.ts";
import { ProjectAssemblyIntegrityReviewResolver } from "./src/adapters/cad/assembly-integrity/project-assembly-integrity-review-resolver.ts";
import {
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
  VerifyObserveAssemblyIntegrityRunExecutor,
} from "./src/adapters/cad/assembly-integrity/verify-observe-assembly-integrity-run-executor.ts";
import { VerifyEvaluateAssemblyIntegrityRunExecutor } from "./src/adapters/cad/assembly-integrity/verify-evaluate-assembly-integrity-run-executor.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "./src/domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "./src/adapters/compile/executors/compile-seal-admission-run-executor.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "./src/adapters/cad/isolated/design-execute-build123d-run-executor.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "./src/adapters/modelica/qualified-kit/run-executor.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "./src/adapters/modelica/admitted/run-executor.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "./src/adapters/electrical/spice/admitted/run-executor.ts";
import { ExportVolumeGeometryStager } from "./src/adapters/make/printability/export-volume-geometry-stager.ts";
import { ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION } from "./src/adapters/sensitivity/study/analyze-seal-sensitivity-study-run-executor.ts";
import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "./src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "./src/adapters/sensitivity/edges/model-write-sensitivity-edges-run-executor.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "./src/adapters/sensitivity/base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts";
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
import { RegisteredProjectRunExecutor } from "./src/application/use-cases/registered-project-run-executor.ts";
import { PrepareProjectAssemblyIntegrityReview } from "./src/application/use-cases/cad/assembly-integrity/prepare-project-assembly-integrity-review.ts";
import { PrepareAssemblyIntegrityEvaluation } from "./src/application/use-cases/cad/assembly-integrity/prepare-assembly-integrity-evaluation.ts";
import { PrepareProjectAssemblyIntegrityEvaluationReview } from "./src/application/use-cases/cad/assembly-integrity/prepare-project-assembly-integrity-evaluation-review.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/shared/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/shared/stores/live-thread-update-store.ts";
import { FileEngineeringProjectRevisionStore } from "./src/adapters/shared/stores/engineering-project-store.ts";
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
import type {
  DesiredServer,
  FleetManifest,
} from "./src/application/control-plane/read-model/fleet-manifest.ts";
import { registerControlPlaneTools } from "./src/tools/control-plane.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./src/tools/project-control.ts";
import { ProjectProductNavigation } from "./src/application/use-cases/product-navigation/project-product-navigation.ts";
import { CaptureProductStructureTraversal } from "./src/adapters/architecture/renderer/capture-product-structure-traversal.ts";
import { WorkbenchProductNavigationEvidenceAttachmentReader } from "./src/adapters/thread/product-navigation-workbench.ts";
import { ProjectSourceWorkspaceAuthoringAttachmentReader } from "./src/adapters/project-source-workspace/product-navigation-authoring-attachment-reader.ts";
import {
  type ProjectBriefToolDependencies,
  registerProjectBriefTools,
} from "./src/tools/project-brief.ts";
import {
  type CockpitFocusToolDependencies,
  registerCockpitFocusTools,
} from "./src/tools/cockpit-focus.ts";
import { sha256Fingerprint } from "./src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "./src/domain/kernel/primitives.ts";
import { pinnedOciImageReference } from "./src/domain/compile/isolation/local-isolation-runtime.ts";
import {
  createArchitectureFoundation,
  createArchitectureProject,
} from "./src/adapters/architecture/server-composition.ts";
import {
  composePrivateBuild123dGeometrySurfaces,
  createBuild123dCapability,
  createCadProject,
} from "./src/adapters/cad/server-composition.ts";
import { createAssemblyIntegrityCloseoutProject } from "./src/adapters/cad/assembly-integrity/assembly-integrity-closeout-composition.ts";
import { createCadPlacementComposition } from "./src/adapters/cad/placement/server-composition.ts";
import {
  createGeometryModuleAssemblyComposition,
  type GeometryModuleAssemblyServerOptions,
} from "./src/adapters/cad/module-assembly/geometry-module-assembly-composition.ts";
import { createGeometryModuleExportComposition } from "./src/adapters/cad/module-assembly/geometry-module-export-composition.ts";
import { GEOMETRY_DRAFT_ASSETS_DIR } from "./src/adapters/cad/canonical/geometry-draft-capture.ts";
import {
  createTechnicalCompilationFoundation,
  createTechnicalCompilationPreview,
  createTechnicalCompilationProject,
} from "./src/adapters/compile/server-composition.ts";
import { createRecordedOperationPlanComposition } from "./src/adapters/compile/plans/server-composition.ts";
import { createLedDriverSourceComposition } from "./src/adapters/electrical/led-driver/server-composition.ts";
import {
  createAdmittedSpiceCapability,
  createAdmittedSpiceProject,
} from "./src/adapters/electrical/spice/admitted/server-composition.ts";
import {
  createElectricalMethodSheetJoin,
  createElectricalProject,
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
} from "./src/adapters/electrical/server-composition.ts";
import { createAgentResourceIngress } from "./src/adapters/resource/server-composition.ts";
import { FileAgentResourceStore } from "./src/adapters/resource/file-agent-resource-store.ts";
import { ProjectResourceCaptureError } from "./src/application/use-cases/resource/prepare-project-resource-capture.ts";
import {
  AgentResourceReopenError,
  ReopenAgentResource,
} from "./src/application/use-cases/resource/reopen-agent-resource.ts";
import {
  createProjectSourceWorkspaceComposition,
  DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY,
} from "./src/adapters/project-source-workspace/server-composition.ts";
import { FileProjectSourceWorkspaceStore } from "./src/adapters/project-source-workspace/file-project-source-workspace-store.ts";
import { ProjectSourceWorkspaceError } from "./src/domain/project-source-workspace/types.ts";
import { ProjectSourceWorkspaceStoreError } from "./src/application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import { ProjectSourceWorkspaceApplicationError } from "./src/application/use-cases/project-source-workspace/project-source-workspace-use-cases.ts";
import {
  createCalculixCapability,
  createFeaFoundation,
  createFeaProject,
} from "./src/adapters/fea/server-composition.ts";
import {
  createAdmittedModelicaCapability,
  createModelicaProject,
  createModelicaThermalMethodSheetJoin,
  createQualifiedModelicaCapability,
} from "./src/adapters/modelica/server-composition.ts";
import { createSensitivityComposition } from "./src/adapters/sensitivity/server-composition.ts";
import { DockerSensitivitySolverRuntimeAuthority } from "./src/adapters/sensitivity/experience/docker-sensitivity-solver-runtime-authority.ts";
import { createCrossDomainImpactProject } from "./src/adapters/impact/server-composition.ts";

const DEFAULT_PORT = 3020;
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_MANIFEST_PATH = "config/mcp-fleet.json";
const DEFAULT_RUN_FIXTURE_PATH = "state/fixtures/runs/bracket-demo.json";
const DEFAULT_ACTIVE_PROJECT_DIRECTORY = "state/local/engineering-projects";
const DEFAULT_COCKPIT_FOCUS_DIRECTORY = "state/local/cockpit-focus";
const DEFAULT_THREAD_SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY = "state/local/live-thread-updates";
const DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY = "state/local/approved-brief-captures";
const DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY =
  "state/local/syson-model-seed-captures";
const DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY =
  "state/local/syson-model-seed-attempts";
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
const DEFAULT_SENSITIVITY_EXPERIENCE_DIRECTORY = "state/local/sensitivity-experience";
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
const DEFAULT_ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DIRECTORY =
  "state/local/assembly-integrity-observation-captures";
const DEFAULT_ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_DIRECTORY =
  "state/local/assembly-integrity-observation-attempts";
const DEFAULT_ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DIRECTORY =
  "state/local/assembly-integrity-evaluation-captures";
const DEFAULT_ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_DIRECTORY =
  "state/local/assembly-integrity-evaluation-attempts";
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
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE =
  "casys/build123d-module-assembler-worker@sha256:5aa833e19f1956a001013661e726c19c4566677a75f58493a6534456b99b6707" as const;
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256 =
  "609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581" as const;

export const LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894" as const;
export const LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:d25f220287cd8d1713e9e7d773afb8bb867fc5404a112e5e50ffa2e862fd6fdf" as const;
export const LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE =
  "casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2" as const;
export { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE };
const LOCAL_CALCULIX_WRAPPER_SHA256 =
  "507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2";
const LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT = Object.freeze({
  algorithm: "sha256" as const,
  digest: "d6aee5fe375daa55cec29a32acf27181dd4bb8ea8e5c3f90f848cc718c149428",
});
const LOCAL_MODELICA_QUALIFICATION_ROOT =
  "state/local/modelica-microsandbox-qualification";
const DEFAULT_AGENT_RESOURCE_CAPTURE_DIRECTORY = "state/local/agent-resource-captures";

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

const LOCAL_GEOMETRY_MODULE_ASSEMBLY_LIMITS = Object.freeze({
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 90_000,
  maxMemoryBytes: 2 * 1_073_741_824,
  maxProcesses: 32,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 64 * 1_048_576,
  maxOutputTotalBytes: 128 * 1_048_576,
});

const LOCAL_GEOMETRY_MODULE_ASSEMBLY_POLICY_BODY = Object.freeze({
  schemaVersion: "geometry-module-assembler-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutable: "/usr/local/bin/python3",
  limits: LOCAL_GEOMETRY_MODULE_ASSEMBLY_LIMITS,
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

const LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 30_000,
  maxCpuTimeMs: 25_000,
  maxMemoryBytes: 512 * 1_048_576,
  maxProcesses: 16,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 262_144,
  maxOutputTotalBytes: 524_288,
});

const LOCAL_ADMITTED_SPICE_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "spice-admitted-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["ngspice"],
  limits: LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS,
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
  printabilityCaseCaptureDirectory?: string;
  printabilityAttemptDirectory?: string;
  printabilityObservationCaptureDirectory?: string;
  printEstimateCaseCaptureDirectory?: string;
  printEstimateAttemptDirectory?: string;
  printEstimateObservationCaptureDirectory?: string;
  dfmCaseCaptureDirectory?: string;
  dfmCheckCaptureDirectory?: string;
  dfmCheckAttemptDirectory?: string;
  /** Canonical factual L3 assembly-integrity observation CAS. */
  assemblyIntegrityObservationCaptureDirectory?: string;
  /** Durable L3 assembly-integrity observation dispatch journal. */
  assemblyIntegrityObservationAttemptDirectory?: string;
  /** Provider-free L4 assembly-integrity evaluation CAS. */
  assemblyIntegrityEvaluationCaptureDirectory?: string;
  /** Durable L4 assembly-integrity evaluation publication journal. */
  assemblyIntegrityEvaluationAttemptDirectory?: string;
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
  /** Root of the closed CAS/WAL layout used by isolated-analysis operations. */
  recordedAnalysisDirectory?: string;
  /** Draft CAS for agent-authored MCP resource ingress. */
  agentResourceDirectory?: string;
  /** Append-only project source workspace event log. */
  projectSourceWorkspaceDirectory?: string;
  /**
   * Explicit qualified Build123d profile and optional isolated runtime.
   * Omitted means no review tool and no executor. A profile without a runtime
   * exposes provider-free review only; no environment variable enables it.
   */
  build123dExecution?: Build123dExecutionServerOptions;
  /**
   * Digest-pinned module-assembler profile and optional isolated runtime.
   * Omitted means no project_geometry_module_export tool. A profile without
   * a runtime still leaves the tool unregistered: export requires the runner.
   */
  geometryModuleAssembly?: GeometryModuleAssemblyServerOptions;
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
  /**
   * Admitted SPICE closed-subset profile and optional isolated runtime.
   * Distinct from mcp-spice and the LED-driver fiche. Omitted means no review
   * tool and no executor.
   */
  admittedSpiceExecution?: AdmittedSpiceExecutionServerOptions;
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
  const build123d = manifest.servers.find((server) => server.id === "build123d");
  const build123dSandbox = manifest.servers.find((server) =>
    server.id === "build123d-sandbox"
  );
  const calculix = manifest.servers.find((server) => server.id === "calculix");
  const dfm = manifest.servers.find((server) => server.id === "dfm");
  const prusaslicer = manifest.servers.find((server) => server.id === "prusaslicer");
  const docker = options.docker ?? new DockerComposeObserver();
  const controlPlane = new ControlPlane({
    manifest,
    runs,
    probe: options.probe ?? new HttpMcpProbe(),
    docker,
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
      build123d,
      calculix?.mcpUrl,
      calculix?.image,
      calculix,
      docker,
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
      ? " Explicit local YOLO startup opt-in is active: positive project_brief_confirm, project_decision_approve, project_agent_run_cancel, project_work_item_abandon, and human-only project_agent_run_execute calls auto-confirm through the canonical human command services or the same registered runExecutor with a persisted local-yolo origin, without fabricating MCP elicitation responses. Rejection remains interactive; registered operation, review, isolation, and evidence gates remain unchanged."
      : "");
  const app = new McpApp({
    name: "casys-digital-thread-console",
    version: "0.2.0",
    transport: "stateless",
    maxConcurrent: 8,
    backpressureStrategy: "queue",
    validateSchema: true,
    expectResources: projectControl !== undefined,
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
          error instanceof ProjectResourceCaptureError ||
          error instanceof AgentResourceReopenError ||
          error instanceof ProjectSourceWorkspaceError ||
          error instanceof ProjectSourceWorkspaceStoreError ||
          error instanceof ProjectSourceWorkspaceApplicationError ||
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
    const resourceExposure = defaultProjectTools
      ? await defaultProjectTools.bindAgentResources(app)
      : projectControl.resourceExposure;
    registerProjectControlTools(app, {
      ...projectControl,
      ...(resourceExposure ? { resourceExposure } : {}),
      approvalMode,
    });
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
  assemblyIntegrityBuild123dServer?: DesiredServer,
  calculixMcpUrl?: string,
  calculixRuntimeImage?: string,
  calculixServer?: DesiredServer,
  docker?: DockerObserver,
  dfmMcpUrl?: string,
  prusaslicerMcpUrl?: string,
): Promise<{
  readonly control: ProjectControlToolDependencies;
  readonly brief: ProjectBriefToolDependencies;
  readonly bindAgentResources: ReturnType<
    typeof createAgentResourceIngress
  >["bind"];
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
  const agentResourceStore = new FileAgentResourceStore(
    options.agentResourceDirectory ?? DEFAULT_AGENT_RESOURCE_CAPTURE_DIRECTORY,
  );
  const reopenAgentResource = new ReopenAgentResource(agentResourceStore);

  const architectureFoundation = createArchitectureFoundation({
    recordedAnalysisDirectory,
    sourceAnalysisCaptures,
    sysmlSourceCaptureDirectory: options.sysmlSourceCaptureDirectory ??
      SYSML_SOURCE_CAPTURE_DESCRIPTOR.directory,
    sysonModelSeedCaptureDirectory: options.sysonModelSeedCaptureDirectory ??
      DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY,
    architectureCaptureDirectory: options.architectureCaptureDirectory ??
      DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY,
    requirementsCaptureDirectory: options.requirementsCaptureDirectory ??
      DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY,
    resources: reopenAgentResource,
  });
  const sourceWorkspaceStore = new FileProjectSourceWorkspaceStore(
    options.projectSourceWorkspaceDirectory ??
      DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY,
  );
  const compilationFoundation = createTechnicalCompilationFoundation({
    recordedAnalysisDirectory,
    snapshots: build123dThreadSnapshots,
    resources: reopenAgentResource,
    workspace: sourceWorkspaceStore,
  });

  const build123dCapability = await createBuild123dCapability({
    build123dExecution: options.build123dExecution,
    recordedAnalysisDirectory,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    snapshots: build123dThreadSnapshots,
  });
  const qualifiedModelica = await createQualifiedModelicaCapability({
    modelicaIsolatedExecution: options.modelicaIsolatedExecution,
    recordedAnalysisDirectory,
    qualificationRoot: LOCAL_MODELICA_QUALIFICATION_ROOT,
    qualificationCaptureFingerprint: LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT,
  });
  const admittedModelica = await createAdmittedModelicaCapability({
    admittedModelicaExecution: options.admittedModelicaExecution,
    recordedAnalysisDirectory,
  });
  const admittedSpice = await createAdmittedSpiceCapability({
    admittedSpiceExecution: options.admittedSpiceExecution,
    recordedAnalysisDirectory,
  });
  const calculixCapability = await createCalculixCapability({
    calculixIsolatedExecution: options.calculixIsolatedExecution,
    recordedAnalysisDirectory,
  });

  const feaFoundation = createFeaFoundation();
  const recordedPlans = createRecordedOperationPlanComposition({
    snapshots: threadSnapshots,
    feaProofCaptures: feaFoundation.feaProofCaptures,
    sensitivityCatalogOfferCaptures: feaFoundation.sensitivityCatalogOfferCaptures,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    calculixLocalProfile: calculixCapability.localProfile,
    recordedAnalysisDirectory,
    canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
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
      runPlanSealer: recordedPlans.recordedRunPlans,
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

  const architectureProject = createArchitectureProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    liveUpdates,
    sysonMcpUrl,
    foundation: architectureFoundation,
    sysonModelSeedAttemptDirectory: options.sysonModelSeedAttemptDirectory ??
      DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY,
    architectureAttemptDirectory: options.architectureAttemptDirectory ??
      DEFAULT_ARCHITECTURE_ATTEMPT_DIRECTORY,
    partDefinitionsCaptureDirectory: options.partDefinitionsCaptureDirectory ??
      DEFAULT_PART_DEFINITIONS_CAPTURE_DIRECTORY,
    partDefinitionsPublicationDirectory: options.partDefinitionsPublicationDirectory ??
      DEFAULT_PART_DEFINITIONS_PUBLICATION_DIRECTORY,
    requirementsAttemptDirectory: options.requirementsAttemptDirectory ??
      DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY,
  });
  const compilationProject = createTechnicalCompilationProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    foundation: compilationFoundation,
    architectureCaptures: architectureFoundation.genericArchitectureCaptures,
    seedCaptures: architectureFoundation.sysonModelSeedCaptures,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
  });
  const thermalJoin = createModelicaThermalMethodSheetJoin({
    recordedAnalysisDirectory,
    snapshots: activeThreadSnapshots,
  });
  const technicalCompilationPreview = createTechnicalCompilationPreview({
    foundation: compilationFoundation,
    basisResolver: compilationProject.technicalCompilationBasis,
    projects: runtime.projects,
    methodSheets: thermalJoin.thermalMethodSheetCompilationJoin,
  });
  const geometryModuleAssembly = options.geometryModuleAssembly === undefined
    ? undefined
    : await createGeometryModuleAssemblyComposition(
      options.geometryModuleAssembly,
      {
        outputCasDirectory: `${recordedAnalysisDirectory}/geometry-module/outputs`,
      },
    );

  const cadProject = createCadProject({
    projects: runtime.projects,
    commands: runtime.commands,
    executionSnapshots: build123dThreadSnapshots,
    writeSnapshots: activeThreadSnapshots,
    lease,
    capability: build123dCapability,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    recordedAnalysisDirectory,
    sourceAnalysisCaptures,
    architectureCaptures: architectureFoundation.genericArchitectureCaptures,
    sysmlSourceAnalysis: architectureFoundation.sysmlSourceAnalysis,
    geometryDraftCaptureDirectory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
    geometryCaptureDirectory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
    moduleAssembly: geometryModuleAssembly?.execution?.publications,
  });
  const assemblyIntegrityEvaluationCaptures =
    new FileAssemblyIntegrityEvaluationCaptureStore(
      new FileCaptureStore({
        ...ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
        directory: options.assemblyIntegrityEvaluationCaptureDirectory ??
          DEFAULT_ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DIRECTORY,
      }),
    );
  const assemblyIntegrityCloseoutProject = createAssemblyIntegrityCloseoutProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    evaluationCaptures: assemblyIntegrityEvaluationCaptures,
  });
  const modelicaProject = createModelicaProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    executionSnapshots: build123dThreadSnapshots,
    planSnapshots: threadSnapshots,
    lease,
    recordedAnalysisDirectory,
    sysonMcpUrl,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    basisResolver: compilationProject.technicalCompilationBasis,
    technicalSourceAnalysisCaptures:
      compilationFoundation.technicalSourceAnalysisCaptures,
    thermal: thermalJoin,
    qualified: qualifiedModelica,
    admitted: admittedModelica,
  });
  const impactProject = createCrossDomainImpactProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    recordedAnalysisDirectory,
    resources: reopenAgentResource,
  });
  const feaProject = createFeaProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    foundation: feaFoundation,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
    seedCaptures: architectureFoundation.sysonModelSeedCaptures,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    recordedPlanResolver: recordedPlans.recordedPlanResolver,
    recordedRunPlans: recordedPlans.recordedRunPlans,
    recordedAnalysisCas: recordedPlans.recordedAnalysisCas,
    calculix: calculixCapability,
    sysonMcpUrl,
    recordedAnalysisDirectory,
    canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
    resources: reopenAgentResource,
  });
  const sensitivity = createSensitivityComposition({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    technicalCompilationPreview,
    feaProofCaptures: feaFoundation.feaProofCaptures,
    sensitivityCatalogOfferCaptures: feaFoundation.sensitivityCatalogOfferCaptures,
    sysonModelSeedCaptures: architectureFoundation.sysonModelSeedCaptures,
    build123dExecution: build123dCapability.build123dExecution,
    calculixMcpUrl,
    calculixRuntimeImage,
    sensitivitySolverRuntimeAuthority: calculixServer && docker
      ? new DockerSensitivitySolverRuntimeAuthority(docker, calculixServer)
      : undefined,
    sysonMcpUrl,
    sensitivityStepCacheDirectory: DEFAULT_SENSITIVITY_STEP_CACHE_DIRECTORY,
    sensitivityExperienceDirectory: DEFAULT_SENSITIVITY_EXPERIENCE_DIRECTORY,
  });
  const electrical = createLedDriverSourceComposition({
    recordedAnalysisDirectory,
    resources: reopenAgentResource,
  });
  const spiceProject = createAdmittedSpiceProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: build123dThreadSnapshots,
    lease,
    recordedAnalysisDirectory,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    admitted: admittedSpice,
  });
  const electricalMethodSheets = createElectricalMethodSheetJoin({
    recordedAnalysisDirectory,
  });
  const electricalProject = createElectricalProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: build123dThreadSnapshots,
    lease,
    recordedAnalysisDirectory,
    methodSheets: electricalMethodSheets,
    spiceCaptures: admittedSpice.captures,
  });

  const productStructureTraversal = new CaptureProductStructureTraversal(
    architectureFoundation.genericArchitectureCaptures,
    architectureFoundation.sysmlSourceAnalysis,
  );
  const sourceWorkspace = createProjectSourceWorkspaceComposition({
    store: sourceWorkspaceStore,
    projects: runtime.projects,
    resources: reopenAgentResource,
    snapshots: threadSnapshots,
    traversal: productStructureTraversal,
  });
  const cadPlacement = createCadPlacementComposition({
    recordedAnalysisDirectory,
    workspace: sourceWorkspaceStore,
    resources: reopenAgentResource,
    snapshots: threadSnapshots,
    architectureCaptures: architectureFoundation.genericArchitectureCaptures,
    sysmlSourceAnalysis: architectureFoundation.sysmlSourceAnalysis,
  });
  const agentResourceIngress = createAgentResourceIngress({
    store: agentResourceStore,
    thermalSheets: thermalJoin.thermalMethodSheets,
    electricalSheets: electricalMethodSheets.electricalObservationMethodSheets,
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
  const productNavigationGeometryCaptures = new FileCaptureStore({
    ...GEOMETRY_CAPTURE_DESCRIPTOR,
    directory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
  });
  const assemblyIntegrityBuild123d = assemblyIntegrityBuild123dProvider(
    assemblyIntegrityBuild123dServer,
  );
  let assemblyIntegrityReview: PrepareProjectAssemblyIntegrityReview | undefined;
  let verifyObserveAssemblyIntegrity:
    | VerifyObserveAssemblyIntegrityRunExecutor
    | undefined;
  let assemblyIntegrityEvaluationReview:
    | PrepareProjectAssemblyIntegrityEvaluationReview
    | undefined;
  let verifyEvaluateAssemblyIntegrity:
    | VerifyEvaluateAssemblyIntegrityRunExecutor
    | undefined;
  if (assemblyIntegrityBuild123d !== undefined) {
    const profiles = new FixedAssemblyIntegrityObserverProfileCatalog({
      imageDigest: assemblyIntegrityBuild123d.imageDigest,
    });
    const inputs = new ExactAssemblyIntegrityInputReopener({
      basis: new ExactStaticAssemblyBasisReopener({
        geometryCaptures: productNavigationGeometryCaptures,
        stepAssets: new FileCanonicalAssetReader({
          directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
        }),
      }),
      profiles,
    });
    const captures = new FileAssemblyIntegrityObservationCaptureStore(
      new FileCaptureStore({
        ...ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
        directory: options.assemblyIntegrityObservationCaptureDirectory ??
          DEFAULT_ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DIRECTORY,
      }),
    );
    assemblyIntegrityReview = new PrepareProjectAssemblyIntegrityReview({
      resolver: new ProjectAssemblyIntegrityReviewResolver({
        projects: runtime.projects,
        snapshots: build123dThreadSnapshots,
        inputs,
        profiles,
      }),
    });
    verifyObserveAssemblyIntegrity = new VerifyObserveAssemblyIntegrityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: build123dThreadSnapshots,
      inputs,
      observer: new McpBuild123dAssemblyIntegrityObserver({
        client: new HttpMcpToolClient({
          mcpUrl: assemblyIntegrityBuild123d.mcpUrl,
          timeoutMs: 120_000,
        }),
      }),
      captures,
      attempts: new FileAssemblyIntegrityObservationAttemptStore(
        options.assemblyIntegrityObservationAttemptDirectory ??
          DEFAULT_ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_DIRECTORY,
      ),
      lease,
    });
    const evaluation = new PrepareAssemblyIntegrityEvaluation({
      projects: runtime.projects,
      snapshots: build123dThreadSnapshots,
      observations: captures,
      inputs,
    });
    assemblyIntegrityEvaluationReview =
      new PrepareProjectAssemblyIntegrityEvaluationReview({
        projects: runtime.projects,
        snapshots: build123dThreadSnapshots,
        observations: captures,
        inputs,
      });
    verifyEvaluateAssemblyIntegrity = new VerifyEvaluateAssemblyIntegrityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: build123dThreadSnapshots,
      evaluation,
      captures: assemblyIntegrityEvaluationCaptures,
      attempts: new FileAssemblyIntegrityEvaluationAttemptStore(
        options.assemblyIntegrityEvaluationAttemptDirectory ??
          DEFAULT_ASSEMBLY_INTEGRITY_EVALUATION_ATTEMPT_DIRECTORY,
      ),
      lease,
    });
  }
  const partDefinitionsCaptures = new FileCaptureStore({
    ...PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: options.partDefinitionsCaptureDirectory ??
      DEFAULT_PART_DEFINITIONS_CAPTURE_DIRECTORY,
  });
  const geometryModuleExport = geometryModuleAssembly === undefined
    ? undefined
    : createGeometryModuleExportComposition({
      projects: runtime.projects,
      snapshots: threadSnapshots,
      traversal: productStructureTraversal,
      architectureCaptures: architectureFoundation.genericArchitectureCaptures,
      sysmlSourceAnalysis: architectureFoundation.sysmlSourceAnalysis,
      partDefinitionsCaptures,
      geometryCaptures: productNavigationGeometryCaptures,
      recordedAnalysisDirectory,
      canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      geometryDraftCaptureDirectory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
      geometryDraftAssetDirectory: GEOMETRY_DRAFT_ASSETS_DIR,
      profiles: geometryModuleAssembly.profiles,
      runner: geometryModuleAssembly.execution?.runner,
      publications: geometryModuleAssembly.execution?.publications,
    }).geometryModuleExport;
  return {
    brief: {
      projects: runtime.projects,
      commands: new ProjectBriefCommandService(runtime.projects),
    },
    bindAgentResources: (app) => agentResourceIngress.bind(app),
    control: {
      projects: runtime.projects,
      commands: runtime.commands,
      threadSnapshots,
      // The same CAS-backed object seals at queue time and reads through the
      // agent-visible plan inspection tool. No alternate plan authority is
      // composed for execution or control-plane reads.
      runPlanReader: recordedPlans.recordedRunPlans,
      technicalSourceCapture: compilationFoundation.technicalSourceCapture,
      cadPlacementCapture: cadPlacement.cadPlacementCapture,
      geometryModuleExport,
      assemblyIntegrityReview,
      assemblyIntegrityEvaluationReview,
      technicalCompilationPreview,
      architectureSysmlSourceCapture:
        architectureFoundation.architectureSysmlSourceCapture,
      architectureSysmlPreview: architectureFoundation.architectureSysmlPreview,
      briefArchitectureReview: architectureProject.briefArchitectureReview,
      briefRequirementsReview: architectureProject.briefRequirementsReview,
      feaProofCaseCapture: feaProject.feaProofCaseCapture,
      feaProofSealReview: feaProject.feaProofSealReview,
      feaIsolatedRunReview: feaProject.feaIsolatedRunReview,
      evaluationCloseoutReview: feaProject.staticMechanicalEvaluationCloseoutReview,
      assemblyIntegrityEvaluationCloseoutReview:
        assemblyIntegrityCloseoutProject.assemblyIntegrityEvaluationCloseoutReview,
      sensitivityStudySealReview: sensitivity.sensitivityStudySealReview,
      build123dExecutionReview: build123dCapability.build123dExecutionReview,
      isolatedGeometrySealReview: build123dCapability.isolatedGeometrySealReview,
      vectorCorrectionReview: sensitivity.vectorCorrectionReview,
      sensitivityBaseEvaluationReview: sensitivity.sensitivityBaseEvaluationReview,
      modelicaQualifiedKitRunReview: modelicaProject.modelicaQualifiedKitRunReview,
      admittedModelicaRunReview: modelicaProject.admittedModelicaRunReview,
      admittedModelicaEvaluationReview:
        modelicaProject.admittedModelicaEvaluationReview,
      admittedModelicaEvaluationCloseoutReview:
        modelicaProject.admittedModelicaEvaluationCloseoutReview,
      thermalMethodSheetSealReview: modelicaProject.thermalMethodSheetSealReview,
      crossDomainImpactManifestCapture: impactProject.crossDomainImpactManifestCapture,
      crossDomainImpactManifestSealReview:
        impactProject.crossDomainImpactManifestSealReview,
      crossDomainImpactDecisionReview: impactProject.crossDomainImpactDecisionReview,
      ledDriverSourceCapture: electrical.ledDriverSourceCapture,
      ledDriverSourceReview: electrical.ledDriverSourceReview,
      admittedSpiceRunReview: spiceProject.admittedSpiceRunReview,
      resourceCapture: agentResourceIngress.capture,
      sourceWorkspace: sourceWorkspace.sourceWorkspace,
      productNavigation: new ProjectProductNavigation({
        projects: runtime.projects,
        snapshots: threadSnapshots,
        traversal: productStructureTraversal,
        workspace: sourceWorkspaceStore,
        evidenceAttachments: new WorkbenchProductNavigationEvidenceAttachmentReader({
          architectureCaptures: architectureFoundation.genericArchitectureCaptures,
          geometryCaptures: productNavigationGeometryCaptures,
          sysmlSourceAnalysis: architectureFoundation.sysmlSourceAnalysis,
          admissions: compilationFoundation.technicalCompilationSeals,
          workspace: sourceWorkspaceStore,
          requirementsCaptures: architectureFoundation.requirementsCaptures,
          engineeringCases: {
            mechanicalProof: feaFoundation.feaProofCaptures,
            printabilityCheck: printabilityCaseCaptures,
            printEstimate: printEstimateCaseCaptures,
            dfmCheck: dfmCaseCaptures,
          },
        }),
        authoringAttachments: new ProjectSourceWorkspaceAuthoringAttachmentReader(
          sourceWorkspaceStore,
        ),
      }),
      electricalObservationMethodSheetSealReview:
        electricalProject.electricalObservationMethodSheetSealReview,
      admittedSpiceEvaluationReview: electricalProject.admittedSpiceEvaluationReview,
      admittedSpiceEvaluationCloseoutReview:
        electricalProject.admittedSpiceEvaluationCloseoutReview,
      ...composePrivateBuild123dGeometrySurfaces(
        build123dSandboxMcpUrl,
        cadProject.geometrySourceAnalysis,
        compilationFoundation.technicalCompilationAdmissions,
        threadSnapshots,
        architectureFoundation.genericArchitectureCaptures,
        DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
        DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
      ),
      runExecutor: new RegisteredProjectRunExecutor({
        projects: runtime.projects,
        baseline,
        sysonModelSeed: architectureProject.sysonModelSeed,
        additional: [
          {
            operation: COMPILE_SEAL_ADMISSION_OPERATION,
            executor: compilationProject.compileSealAdmission,
          },
          {
            operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
            executor: architectureProject.modelSealArchitectureSysml,
          },
          {
            operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
            executor: cadProject.designExecuteBuild123d,
            unavailableMessage:
              "The server has no complete qualified Build123d isolated runtime configured for this run.",
          },
          {
            operation: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
            executor: cadProject.designSealIsolatedGeometry,
          },
          {
            operation: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
            executor: modelicaProject.verifySealModelicaThermalMethodSheet,
          },
          {
            operation: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
            executor: impactProject.verifySealCrossDomainImpactManifest,
          },
          {
            operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
            executor: impactProject.analyzeEvaluateCrossDomainImpact,
          },
          {
            operation: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
            executor: impactProject.decideAcceptCrossDomainImpact,
          },
          {
            operation: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
            executor: impactProject.analyzeEvaluateMechanicalPreservation,
          },
          {
            operation: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
            executor: modelicaProject.verifyEvaluateAdmittedModelicaObservations,
            unavailableMessage:
              "The server has no trusted verify.evaluate-admitted-modelica-observations@1 executor configured for this run (SysON provider is required).",
          },
          {
            operation: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
            executor: modelicaProject.decideAdmittedModelicaEvaluation,
          },
          {
            operation: DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
            executor: modelicaProject.decideAdmittedModelicaEvaluation,
          },
          {
            operation: DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
            executor: feaProject.decideStaticMechanicalEvaluationCloseout,
          },
          {
            operation: DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
            executor: feaProject.decideStaticMechanicalEvaluationCloseout,
          },
          {
            operation: DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
            executor: assemblyIntegrityCloseoutProject
              .decideAssemblyIntegrityEvaluationCloseout,
          },
          {
            operation: DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
            executor: assemblyIntegrityCloseoutProject
              .decideAssemblyIntegrityEvaluationCloseout,
          },
          {
            operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
            executor: modelicaProject.simulateRunQualifiedModelicaKit,
            unavailableMessage:
              "The server has no complete qualified local Modelica runtime and pinned qualification configured for this run.",
          },
          {
            operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
            executor: modelicaProject.simulateRunAdmittedModelica,
            unavailableMessage:
              "The server has no admitted Modelica closed-subset isolated runtime configured for this run.",
          },
          {
            operation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
            executor: spiceProject.simulateRunAdmittedSpice,
            unavailableMessage:
              "The server has no admitted SPICE closed-subset isolated runtime configured for this run.",
          },
          {
            operation: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
            executor: electricalProject.verifySealElectricalObservationMethodSheet,
          },
          {
            operation: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
            executor: electricalProject.verifyEvaluateAdmittedSpiceObservations,
          },
          {
            operation: DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
            executor: electricalProject.decideAdmittedSpiceEvaluation,
          },
          {
            operation: DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
            executor: electricalProject.decideAdmittedSpiceEvaluation,
          },
          {
            operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
            executor: architectureProject.genericModelWriteArchitecture,
            unavailableMessage:
              "The server has no trusted generic model.write-architecture@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
            executor: architectureProject.genericModelCapturePartDefinitions,
            unavailableMessage:
              "The server has no trusted generic model.capture-part-definitions@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: DESIGN_WRITE_GEOMETRY_OPERATION,
            executor: cadProject.genericDesignWriteGeometry,
          },
          {
            operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
            executor: architectureProject.genericModelWriteRequirements,
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
            executor: feaProject.genericVerifySealProofCase,
          },
          {
            operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
            executor: feaProject.isolatedCalculixRun,
            unavailableMessage:
              "The server has no complete qualified local CalculiX runtime and SysON oracle configured for this run.",
          },
          {
            operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
            executor: sensitivity.analyzeSealSensitivityStudy,
          },
          {
            operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
            executor: sensitivity.analyzeRunFeaSensitivity,
            unavailableMessage:
              "The server has no trusted analyze.run-fea-sensitivity@1 executor " +
              "configured for this run (isolated Build123d and CalculiX are required).",
          },
          {
            operation: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
            executor: sensitivity.modelWriteSensitivityEdges,
            unavailableMessage:
              "The server has no trusted model.write-sensitivity-edges@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
            executor: sensitivity.verifyEvaluateSensitivityBase,
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
            operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
            executor: verifyObserveAssemblyIntegrity,
            unavailableMessage:
              "The server has no trusted verify.observe-assembly-integrity@1 executor " +
              "configured for this run (mcp-build123d provider is required).",
          },
          {
            operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
            executor: verifyEvaluateAssemblyIntegrity,
            unavailableMessage:
              "The server has no trusted verify.evaluate-assembly-integrity@1 executor " +
              "configured for this run (exact L3 observation evidence and its closed recross are required).",
          },
          {
            operation: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
            executor: sensitivity.designApplyVectorCorrection,
          },
        ],
      }),
    },
  };
}

interface AssemblyIntegrityBuild123dProvider {
  readonly mcpUrl: string;
  readonly imageDigest: ContentFingerprint;
}

/**
 * L3 observes only the regular pinned mcp-build123d deployment. The sandbox
 * remains a separate private geometry surface and cannot supply this runtime.
 */
function assemblyIntegrityBuild123dProvider(
  server: DesiredServer | undefined,
): AssemblyIntegrityBuild123dProvider | undefined {
  if (server === undefined) return undefined;
  if (server.id !== "build123d") {
    throw new TypeError(
      "Assembly-integrity observation requires the normal build123d fleet server.",
    );
  }
  const image = pinnedOciImageReference(
    server.image,
    "$assemblyIntegrityBuild123d.image",
  );
  const marker = "@sha256:";
  const digest = image.slice(image.lastIndexOf(marker) + marker.length);
  return Object.freeze({
    mcpUrl: server.mcpUrl,
    imageDigest: Object.freeze({ algorithm: "sha256" as const, digest }),
  });
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
    approvalMode,
    build123dExecution: localExecution
      ? await createLocalBuild123dExecutionServerOptions()
      : undefined,
    geometryModuleAssembly: localExecution
      ? await createLocalGeometryModuleAssemblyServerOptions()
      : undefined,
    modelicaIsolatedExecution: localExecution
      ? await createLocalModelicaIsolatedExecutionServerOptions()
      : undefined,
    admittedModelicaExecution: localExecution
      ? await createLocalAdmittedModelicaExecutionServerOptions()
      : undefined,
    admittedSpiceExecution: localExecution
      ? await createLocalAdmittedSpiceExecutionServerOptions()
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
          "YOLO ACTIVE: documented positive human confirmation gates use human/local-yolo:startup-opt-in; rejection remains interactive.",
        );
      }
      if (localExecution) {
        console.error(
          `LOCAL EXECUTION ACTIVE: qualified Build123d, geometry-module assembly, Modelica kit, admitted Modelica, admitted SPICE, and CalculiX runs use ${LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE}, ${LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE}, and ${LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE} through the attached local Microsandbox backend; CalculiX publication still requires the SysON oracle.`,
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
    } else {
      throw new TypeError(`Unknown console argument: ${argument}`);
    }
  }
  if (result.hostname !== undefined && result.hostname.trim() === "") {
    throw new TypeError("--hostname must not be empty");
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

/** Code-owned binding for deterministic one-level geometry-module assembly. */
export async function createLocalGeometryModuleAssemblyServerOptions(): Promise<
  GeometryModuleAssemblyServerOptions
> {
  const policy = Object.freeze({
    id: "geometry-module-assembler-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_GEOMETRY_MODULE_ASSEMBLY_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
      wrapperSha256: LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256,
      policy,
      limits: LOCAL_GEOMETRY_MODULE_ASSEMBLY_LIMITS,
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

/** Code-owned binding for admitted SPICE closed-subset operating-point execution. */
export async function createLocalAdmittedSpiceExecutionServerOptions(): Promise<
  AdmittedSpiceExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "spice-admitted-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_ADMITTED_SPICE_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS,
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
