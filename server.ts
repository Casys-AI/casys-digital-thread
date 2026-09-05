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
import { createLocalBuild123dExecutionServerOptions } from "./src/adapters/cad/isolated/first-party-build123d-execution.ts";
export { createLocalBuild123dExecutionServerOptions };
import type { AdmittedModelicaExecutionServerOptions } from "./src/adapters/modelica/admitted/execution-composition.ts";
import type { AdmittedSpiceExecutionServerOptions } from "./src/adapters/electrical/spice/admitted/execution-composition.ts";
import { createLocalAdmittedSpiceExecutionServerOptions } from "./src/adapters/electrical/spice/admitted/first-party-spice-execution.ts";
export { createLocalAdmittedSpiceExecutionServerOptions };
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./src/adapters/electrical/spice/admitted/local-image-references.ts";
import {
  createLocalAdmittedModelicaExecutionServerOptions,
  createLocalModelicaIsolatedExecutionServerOptions,
} from "./src/adapters/modelica/first-party-modelica-execution.ts";
export {
  createLocalAdmittedModelicaExecutionServerOptions,
  createLocalModelicaIsolatedExecutionServerOptions,
};
export {
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
} from "./src/adapters/control-plane/first-party-capability-runtime-identities.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "./src/adapters/cad/sealed-isolated/design-seal-isolated-geometry-run-executor.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./src/adapters/modelica/qualified-kit/execution-composition.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts";
import {
  createLocalCalculixIsolatedExecutionServerOptions,
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
} from "./src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts";
export {
  createLocalCalculixIsolatedExecutionServerOptions,
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
};
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
import { ProjectCapabilityAuthorizationService } from "./src/application/control-plane/project-capability-authorization-service.ts";
import { CapabilityRuntimeSupervisor } from "./src/application/control-plane/capability-runtime-supervisor.ts";
import { CapabilityRuntimeExecutionSessionCoordinator } from "./src/application/control-plane/capability-runtime-execution-session.ts";
import { ProjectCapabilityJitDemandReader } from "./src/application/control-plane/project-capability-jit-demand-reader.ts";
import { CapabilityRuntimePreparationSessionCoordinator } from "./src/application/control-plane/capability-runtime-preparation-session.ts";
import {
  FileCapabilityRuntimeHostMutationLock,
  FileCapabilityRuntimeLeaseStore,
} from "./src/adapters/control-plane/file-capability-runtime-host-stores.ts";
import { DEFAULT_PROJECT_CAPABILITY_LEDGER_DIRECTORY } from "./src/adapters/control-plane/file-project-capability-ledger-store.ts";
import { createCapabilityRuntimeHostAdapter } from "./src/adapters/control-plane/compose-capability-runtime-host.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "./src/application/control-plane/capability-runtime-launch-group-supervisor.ts";
import { CapabilityRuntimePreloadScheduler } from "./src/application/control-plane/capability-runtime-preload-scheduler.ts";
import { createLocalCapabilityRuntimeCachePreparationComposition } from "./src/adapters/control-plane/local-capability-runtime-cache-preparation-composition.ts";
import { createLocalCapabilityRuntimeReadComposition } from "./src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "./src/adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "./src/adapters/control-plane/first-party-capability-runtime-qualification-specifications.ts";
import { LocalChronoRuntimeSecretResolver } from "./src/adapters/control-plane/local-chrono-runtime-secret-resolver.ts";
import { createLocalFixedCapabilityRuntimeConnection } from "./src/adapters/control-plane/local-fixed-capability-runtime-connection.ts";
import {
  firstPartyBuild123dObservationLaunchGroupReference,
  firstPartySysonLaunchGroupReference,
} from "./src/adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import type { CapabilityRuntimeLaunchGroup } from "./src/domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  listRegisteredEngineeringOperations,
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  requireRegisteredEngineeringOperation,
} from "./src/orchestration/operations/registry.ts";
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
  type ProjectCapabilityToolDependencies,
  registerProjectCapabilityTools,
} from "./src/tools/project-capabilities.ts";
import {
  type CockpitFocusToolDependencies,
  registerCockpitFocusTools,
} from "./src/tools/cockpit-focus.ts";
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
import { DeclaredAgainstPrescribedKinematicsArchitectureIndex } from "./src/adapters/mechanics/chrono/declared-against-prescribed-kinematics-architecture-index.ts";
import { FilePrescribedKinematicsCaptureStore } from "./src/adapters/mechanics/chrono/file-prescribed-kinematics-capture-store.ts";
import { FilePrescribedKinematicsObservationAttemptStore } from "./src/adapters/mechanics/chrono/file-prescribed-kinematics-observation-attempt-store.ts";
import { ChronoUncertainWriterLifecycleQualifier } from "./src/adapters/mechanics/chrono/chrono-uncertain-writer-lifecycle-qualifier.ts";
import { ChronoPrescribedKinematicsCaseLowerer } from "./src/adapters/mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { ChronoPrescribedKinematicsClient } from "./src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts";
import { PrescribedKinematicsRunExecutor } from "./src/adapters/mechanics/chrono/prescribed-kinematics-run-executor.ts";
import { PrepareProjectPrescribedKinematicsCaseReview } from "./src/adapters/mechanics/prepare-project-prescribed-kinematics-case-review.ts";
import { PrepareProjectPrescribedKinematicsNextHopReview } from "./src/adapters/mechanics/prepare-project-prescribed-kinematics-next-hop-review.ts";
import { CaptureProjectPrescribedKinematicsCase } from "./src/application/use-cases/mechanics/prescribed-kinematics/capture-project-prescribed-kinematics-case.ts";
import { DecidePrescribedKinematicsCloseout } from "./src/application/use-cases/mechanics/prescribed-kinematics/decide-prescribed-kinematics-closeout.ts";
import { EvaluatePrescribedKinematics } from "./src/application/use-cases/mechanics/prescribed-kinematics/evaluate-prescribed-kinematics.ts";
import { SealPrescribedKinematicsMethod } from "./src/application/use-cases/mechanics/prescribed-kinematics/seal-prescribed-kinematics-method.ts";
import { RunPrescribedKinematicsObservation } from "./src/application/use-cases/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
} from "./src/domain/mechanism/prescribed-kinematics/operations.ts";
import {
  createGeometryModuleAssemblyComposition,
  type GeometryModuleAssemblyServerOptions,
} from "./src/adapters/cad/module-assembly/geometry-module-assembly-composition.ts";
import {
  createLocalGeometryModuleAssemblyServerOptions,
} from "./src/adapters/cad/module-assembly/first-party-geometry-module-assembly.ts";
export {
  createLocalGeometryModuleAssemblyServerOptions,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256,
} from "./src/adapters/cad/module-assembly/first-party-geometry-module-assembly.ts";
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
const DEFAULT_CAPABILITY_RUNTIME_LEASE_DIRECTORY =
  "state/local/capability-runtime-host/leases";
const DEFAULT_PROJECT_BASELINE_DIRECTORY = "config/projects/baselines";
/**
 * One closed local root for the recorded-analysis vertical. Every child store
 * has a fixed CAS namespace; this path changes persistence placement only.
 */
const DEFAULT_RECORDED_ANALYSIS_DIRECTORY = "state/local/recorded-analysis";

export { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE };
const LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT = Object.freeze({
  algorithm: "sha256" as const,
  digest: "bf85aa1914dddf6fb20aee1c66ef62f3eca3cdcf13b53759ee0c8710bee188db",
});
const LOCAL_MODELICA_QUALIFICATION_ROOT =
  "state/local/modelica-microsandbox-qualification";
const DEFAULT_AGENT_RESOURCE_CAPTURE_DIRECTORY = "state/local/agent-resource-captures";

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
  /** Immutable prescribed-kinematics L1/L3/L4/L5 capture lanes. */
  prescribedKinematicsCaptureDirectory?: string;
  /** Durable prescribed-kinematics L3 dispatch-intent WAL. */
  prescribedKinematicsObservationAttemptDirectory?: string;
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
  /** Root of the closed CAS/WAL layout used by isolated-analysis operations. */
  recordedAnalysisDirectory?: string;
  /** Draft CAS for agent-authored MCP resource ingress. */
  agentResourceDirectory?: string;
  /** Append-only project source workspace event log. */
  projectSourceWorkspaceDirectory?: string;
  /** Separate local host-operational authorization ledger; never Thread state. */
  projectCapabilityLedgerDirectory?: string;
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
      build123d,
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
  const projectCapabilities = projectBrief === undefined
    ? undefined
    : defaultProjectTools?.capabilities ?? {
      projects: projectBrief.projects,
      authorization: projectBrief.capabilityAuthorization,
    };
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
  if (projectCapabilities) {
    registerProjectCapabilityTools(app, { ...projectCapabilities, approvalMode });
  }
  if (cockpitFocus) registerCockpitFocusTools(app, cockpitFocus);
  return { app, controlPlane };
}

async function createProjectControl(
  options: CreateConsoleServerOptions,
  sysonMcpUrl?: string,
  assemblyIntegrityBuild123dServer?: DesiredServer,
  dfmMcpUrl?: string,
  prusaslicerMcpUrl?: string,
): Promise<{
  readonly control: ProjectControlToolDependencies;
  readonly brief: ProjectBriefToolDependencies;
  readonly capabilities: ProjectCapabilityToolDependencies;
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
  const geometryModuleAssembly = options.geometryModuleAssembly === undefined
    ? undefined
    : await createGeometryModuleAssemblyComposition(
      options.geometryModuleAssembly,
      {
        outputCasDirectory: `${recordedAnalysisDirectory}/geometry-module/outputs`,
      },
    );
  // A profile catalog alone is deliberately not an executable composition.
  // Pass cache-attestation identity only when the fixed local worker exists;
  // otherwise a queued run must remain unavailable before it can claim a JIT
  // lease or reach a provider boundary.
  const qualifiedModelicaExecutionProfile =
    qualifiedModelica.isolatedExecution?.execution === undefined
      ? undefined
      : await qualifiedModelica.isolatedExecution.profiles.initial();
  const admittedModelicaExecutionProfile =
    admittedModelica.execution?.execution === undefined
      ? undefined
      : await admittedModelica.execution.profiles.initial();
  const admittedSpiceExecutionProfile = admittedSpice.execution?.execution === undefined
    ? undefined
    : await admittedSpice.execution.profiles.initial();
  const calculixCapability = await createCalculixCapability({
    calculixIsolatedExecution: options.calculixIsolatedExecution,
    recordedAnalysisDirectory,
  });

  // The immutable mechanism capture lanes are created before ROP composition
  // so queue-time sealing can reopen the exact L1 case bytes. This is inert:
  // it neither starts Chrono nor resolves a secret.
  const prescribedKinematicsExecution = Object.freeze({
    captures: new FilePrescribedKinematicsCaptureStore(
      options.prescribedKinematicsCaptureDirectory ??
        "state/local/mechanics/prescribed-kinematics/captures",
    ),
    observationAttempts: new FilePrescribedKinematicsObservationAttemptStore(
      options.prescribedKinematicsObservationAttemptDirectory ??
        "state/local/mechanics/prescribed-kinematics/observation-attempts",
    ),
    sealMethod: new SealPrescribedKinematicsMethod(reopenAgentResource),
    evaluate: new EvaluatePrescribedKinematics(),
    decideCloseout: new DecidePrescribedKinematicsCloseout(),
  });

  const feaFoundation = createFeaFoundation();
  const recordedPlans = createRecordedOperationPlanComposition({
    snapshots: threadSnapshots,
    feaProofCaptures: feaFoundation.feaProofCaptures,
    sensitivityCatalogOfferCaptures: feaFoundation.sensitivityCatalogOfferCaptures,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
    technicalCompilationAdmissionCaptureBytes:
      compilationFoundation.technicalCompilationSealBytes,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    calculixLocalProfile: calculixCapability.localProfile,
    prescribedKinematicsCaptures: prescribedKinematicsExecution.captures,
    admittedModelicaProfiles: admittedModelica.execution?.execution === undefined
      ? undefined
      : admittedModelica.execution.profiles,
    admittedSpiceProfiles: admittedSpice.execution?.execution === undefined
      ? undefined
      : admittedSpice.execution.profiles,
    recordedAnalysisDirectory,
    canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
  });
  const chronoCaseLowerer = new ChronoPrescribedKinematicsCaseLowerer();
  const uncertainWriterLifecycle = new ChronoUncertainWriterLifecycleQualifier({
    attempts: prescribedKinematicsExecution.observationAttempts,
    plans: recordedPlans.recordedRunPlans,
    captures: prescribedKinematicsExecution.captures,
    lowerer: chronoCaseLowerer,
  });

  const activeProjectDirectory = options.activeProjectDirectory ??
    DEFAULT_ACTIVE_PROJECT_DIRECTORY;
  // The resolver is the only component that may read the host-local Chrono
  // bearer token. It returns opaque snapshots only; neither values nor a
  // generic environment map cross server composition.
  const capabilityRuntimeSecrets = new LocalChronoRuntimeSecretResolver();
  const capabilityRead = await createLocalCapabilityRuntimeReadComposition({
    ledgerDirectory: options.projectCapabilityLedgerDirectory ??
      DEFAULT_PROJECT_CAPABILITY_LEDGER_DIRECTORY,
    secrets: capabilityRuntimeSecrets,
    calculixExecutionProfile: calculixCapability.localProfile === undefined
      ? undefined
      : {
        imageReference: calculixCapability.localProfile.runtimeBackend.imageReference,
        imageDigest: calculixCapability.localProfile.runtimeBackend.imageDigest,
        profileFingerprint: calculixCapability.localProfile.profileFingerprint,
      },
    build123dExecutionProfile: build123dCapability.localProfile === undefined
      ? undefined
      : {
        imageReference: build123dCapability.localProfile.runtimeBackend.imageReference,
        imageDigest: build123dCapability.localProfile.runtimeBackend.imageDigest,
        profileFingerprint: build123dCapability.localProfile.profileFingerprint,
      },
    qualifiedModelicaExecutionProfile: qualifiedModelicaExecutionProfile === undefined
      ? undefined
      : {
        imageReference: qualifiedModelicaExecutionProfile.runtimeBackend
          .imageReference,
        imageDigest: qualifiedModelicaExecutionProfile.runtimeBackend.imageDigest,
        profileFingerprint: qualifiedModelicaExecutionProfile.profileFingerprint,
      },
    admittedModelicaExecutionProfile: admittedModelicaExecutionProfile === undefined
      ? undefined
      : {
        imageReference: admittedModelicaExecutionProfile.runtimeBackend
          .imageReference,
        imageDigest: admittedModelicaExecutionProfile.runtimeBackend.imageDigest,
        profileFingerprint: admittedModelicaExecutionProfile.profileFingerprint,
      },
    admittedSpiceExecutionProfile: admittedSpiceExecutionProfile === undefined
      ? undefined
      : {
        imageReference: admittedSpiceExecutionProfile.runtimeBackend.imageReference,
        imageDigest: admittedSpiceExecutionProfile.runtimeBackend.imageDigest,
        profileFingerprint: admittedSpiceExecutionProfile.profileFingerprint,
      },
  });
  const capabilityRuntimeLeases = new FileCapabilityRuntimeLeaseStore(
    DEFAULT_CAPABILITY_RUNTIME_LEASE_DIRECTORY,
  );
  const capabilityRuntimeMutationLock = new FileCapabilityRuntimeHostMutationLock();
  const capabilityRuntimeCachePreparation =
    await createLocalCapabilityRuntimeCachePreparationComposition({
      catalog: capabilityRead.catalog,
      lock: capabilityRuntimeMutationLock,
    });
  const capabilityRuntimeHost = createCapabilityRuntimeHostAdapter({
    registry: capabilityRead.launchGroups,
    journal: capabilityRead.journal,
    secrets: capabilityRuntimeSecrets,
    secretInjector: capabilityRuntimeSecrets,
  });
  const capabilityRuntimeGroups = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: capabilityRead.launchGroups,
    journal: capabilityRead.journal,
    leases: capabilityRuntimeLeases,
    states: capabilityRead.composeObserver,
    host: capabilityRuntimeHost,
    secrets: capabilityRuntimeSecrets,
    lock: capabilityRuntimeMutationLock,
  });
  const capabilityRuntime = new CapabilityRuntimeSupervisor({
    contexts: capabilityRead.contexts,
    operations: { require: requireRegisteredEngineeringOperation },
  });
  const runtime = await createEngineeringProjectCommandRuntime({
    projectId: options.projectId,
    trackedManifestPath: options.projectPath,
    activeDirectory: activeProjectDirectory,
    evidenceSnapshots: threadSnapshots,
    planning: {
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
      runPlanSealer: recordedPlans.recordedRunPlans,
      queueEligibility: capabilityRuntime,
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
    uncertainWriterLifecycle,
  });
  const capabilityJitDemand = new ProjectCapabilityJitDemandReader({
    projects: runtime.projects,
    contexts: capabilityRead.contexts,
    ledgers: capabilityRead.ledgers,
  });
  const capabilityRuntimePreparation =
    new CapabilityRuntimePreparationSessionCoordinator({
      authorization: capabilityRuntime,
      leases: capabilityRuntimeLeases,
      groups: capabilityRuntimeGroups,
      hasAnyRemainingJitDemand: capabilityJitDemand,
    });
  const capabilityRuntimeSession = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: capabilityRead.contexts,
    leases: capabilityRuntimeLeases,
    groups: capabilityRuntimeGroups,
    // Lazy exact inspection only: no image load, pull, sandbox create or
    // Compose start occurs during server construction or queueing.
    microsandbox: capabilityRead.microsandbox,
    hasAnyRemainingJitDemand: capabilityJitDemand,
  });
  const capabilityAuthorization = new ProjectCapabilityAuthorizationService({
    ledgers: capabilityRead.ledgers,
    registry: { list: listRegisteredEngineeringOperations },
    recordedPlans: recordedPlans.recordedRunPlans,
    catalog: capabilityRead.catalog,
    qualificationSpecs:
      await createFirstPartyCapabilityRuntimeQualificationSpecifications(),
    qualificationCandidates:
      await createFirstPartyCapabilityRuntimeQualificationCandidates(),
    policy: capabilityRead.policy,
    host: capabilityRead.host,
    qualifications: capabilityRead.qualifications,
    qualificationAttempts: capabilityRead.qualificationAttempts,
    lock: capabilityRead.lock,
    lockWriter: capabilityRead.lock,
    hostMutationLock: capabilityRuntimeMutationLock,
    preloadScheduler: new CapabilityRuntimePreloadScheduler({
      host: capabilityRuntimeGroups,
      cachePreparer: capabilityRuntimeCachePreparation.cachePreparer,
      onHostError: ({ projectId, launchGroupId, error }) => {
        options.logger?.(
          `Capability preload for ${projectId}/${launchGroupId} failed: ${
            String(error)
          }`,
        );
      },
      onCachePreparationError: ({ projectId, error }) => {
        options.logger?.(
          `Capability microVM preload for ${projectId} failed: ${String(error)}`,
        );
      },
    }),
  });
  // A restart does not re-authorize anything. It only reconstructs the
  // server-owned desired lock and restarts guarded, best-effort preloads for
  // already-authorized envelopes. Runtime acquisition remains out of JIT's
  // read-only exact-cache prerequisite.
  void capabilityAuthorization.resumeAuthorizedPreloads().catch((error) => {
    options.logger?.(
      `Authorized capability preload resume failed: ${String(error)}`,
    );
  });

  const sysonRuntimeConnection = sysonMcpUrl
    ? (await createLocalFixedCapabilityRuntimeConnection({
      leases: capabilityRuntimeLeases,
      binding: requiredCatalogBinding(
        capabilityRead.catalog,
        "syson-author-system",
      ),
      launchGroup: await capabilityRead.launchGroups.require(
        await firstPartySysonLaunchGroupReference(),
      ),
      fleetMcpUrl: sysonMcpUrl,
    })).boundClient()
    : undefined;
  const architectureProject = createArchitectureProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    liveUpdates,
    sysonMcpUrl,
    sysonRuntimeConnection,
    foundation: architectureFoundation,
    capabilityRuntime,
    capabilityRuntimeSession,
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
    geometryDraftAssetDirectory: GEOMETRY_DRAFT_ASSETS_DIR,
    geometryCaptureDirectory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
    capabilityRuntime,
    capabilityRuntimeSession,
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
    plans: recordedPlans.recordedRunPlans,
    capabilityRuntime,
    capabilityRuntimeSession,
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
    capabilityRuntime,
    capabilityRuntimeSession,
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
    capabilityRuntime,
    capabilityRuntimeSession,
    capabilityRuntimeLaunchGroups: capabilityRead.launchGroups,
    sysonMcpUrl,
    sensitivityStepCacheDirectory: DEFAULT_SENSITIVITY_STEP_CACHE_DIRECTORY,
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
    recordedRunPlans: recordedPlans.recordedRunPlans,
    capabilityRuntime,
    capabilityRuntimeSession,
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
  // Pure L1 recross shared by execution. It owns no project-ledger next hop.
  const prescribedKinematicsCaseCapture = new CaptureProjectPrescribedKinematicsCase({
    workspace: sourceWorkspaceStore,
    resources: reopenAgentResource,
    architecture: new DeclaredAgainstPrescribedKinematicsArchitectureIndex(
      threadSnapshots,
      architectureFoundation.genericArchitectureCaptures,
      architectureFoundation.sysmlSourceAnalysis,
    ),
  });
  // The public L1 review additionally proves its current Thread basis and exact
  // architecture producer dependency before compiling a display-only next hop.
  const prescribedKinematicsCaseReview =
    new PrepareProjectPrescribedKinematicsCaseReview({
      capture: prescribedKinematicsCaseCapture,
      projects: runtime.projects,
      snapshots: build123dThreadSnapshots,
    });
  // Discovery of the already registered method/L4/L5 route is provider-free
  // too: it recrosses only durable project and Thread evidence. In particular,
  // it has no Chrono runtime, secret, or dispatch dependency, so unqualified
  // Chrono remains literally unavailable for any future L3 execution.
  const prescribedKinematicsNextHopReview =
    new PrepareProjectPrescribedKinematicsNextHopReview({
      projects: runtime.projects,
      snapshots: build123dThreadSnapshots,
      captures: prescribedKinematicsExecution.captures,
      resources: reopenAgentResource,
    });
  // L1/L4/L5 remain provider-free. L3 is a fixed internal Chrono binding but
  // its queue/execution path remains fail-closed until the capability catalog
  // carries a live qualified (or compatible) binding; no caller can choose an
  // endpoint, image, tool, argument envelope, or bearer token.
  const prescribedKinematicsRunExecutor = new PrescribedKinematicsRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: build123dThreadSnapshots,
    lease,
    caseReview: prescribedKinematicsCaseCapture,
    captures: prescribedKinematicsExecution.captures,
    plans: recordedPlans.recordedRunPlans,
    capabilityRuntime,
    capabilityRuntimeSession,
    chronoRuntime: {
      secrets: capabilityRuntimeSecrets,
      createObservation: (secretSnapshot) =>
        new RunPrescribedKinematicsObservation({
          attempts: prescribedKinematicsExecution.observationAttempts,
          observer: ChronoPrescribedKinematicsClient.fromTrustedRuntime({
            secretResolver: capabilityRuntimeSecrets,
            secretSnapshot,
          }),
          lowerer: chronoCaseLowerer,
        }),
    },
    uncertainWriterLifecycle,
    sealMethod: prescribedKinematicsExecution.sealMethod,
    evaluate: prescribedKinematicsExecution.evaluate,
    decideCloseout: prescribedKinematicsExecution.decideCloseout,
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
    uncertainWriterLifecycle,
    retainedCapabilityLeaseFinalizer: {
      releaseReconciledUncertainWriterLease: async (input) =>
        await capabilityRuntimeSession.releaseReconciledUncertainWriterLease(input),
    },
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
    const observationLaunchGroup = await capabilityRead.launchGroups.require(
      await firstPartyBuild123dObservationLaunchGroupReference(),
    );
    const observationDigest = requiredBuild123dObservationMaterialDigest(
      observationLaunchGroup,
    );
    if (assemblyIntegrityBuild123d.imageDigest.digest !== observationDigest) {
      throw new TypeError(
        "Assembly-integrity fleet image digest does not match the sealed casys-build123d-observation launch-group material.",
      );
    }
    const profiles = new FixedAssemblyIntegrityObserverProfileCatalog({
      imageDigest: Object.freeze({
        algorithm: "sha256" as const,
        digest: observationDigest,
      }),
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
    const assemblyObservationRuntimeConnection =
      (await createLocalFixedCapabilityRuntimeConnection({
        leases: capabilityRuntimeLeases,
        binding: requiredCatalogBinding(
          capabilityRead.catalog,
          "build123d-observe-assembly-integrity",
        ),
        launchGroup: observationLaunchGroup,
        fleetMcpUrl: assemblyIntegrityBuild123d.mcpUrl,
        timeoutMs: 120_000,
      })).boundClient();
    verifyObserveAssemblyIntegrity = new VerifyObserveAssemblyIntegrityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: build123dThreadSnapshots,
      inputs,
      capabilityRuntimeConnection: assemblyObservationRuntimeConnection,
      openObserver: (client) => new McpBuild123dAssemblyIntegrityObserver({ client }),
      captures,
      attempts: new FileAssemblyIntegrityObservationAttemptStore(
        options.assemblyIntegrityObservationAttemptDirectory ??
          DEFAULT_ASSEMBLY_INTEGRITY_OBSERVATION_ATTEMPT_DIRECTORY,
      ),
      lease,
      capabilityRuntime,
      capabilityRuntimeSession,
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
      assembler: geometryModuleAssembly.assembler,
    }).geometryModuleExport;
  return {
    brief: {
      projects: runtime.projects,
      commands: new ProjectBriefCommandService(runtime.projects),
      capabilityAuthorization,
    },
    capabilities: {
      projects: runtime.projects,
      authorization: capabilityAuthorization,
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
      prescribedKinematicsCaseReview,
      prescribedKinematicsNextHopReview,
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
      ...composePrivateBuild123dGeometrySurfaces({
        projects: runtime.projects,
        preparation: capabilityRuntimePreparation,
        geometrySourceAnalysis: cadProject.geometrySourceAnalysis,
        admissions: compilationFoundation.technicalCompilationAdmissions,
        snapshots: threadSnapshots,
        architectureCaptures: architectureFoundation.genericArchitectureCaptures,
        geometryDraftCaptureDirectory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
        geometryDraftAssetDirectory: GEOMETRY_DRAFT_ASSETS_DIR,
        geometryCaptureDirectory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
      }),
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
          // Provider-free L1/L4/L5 handlers are fully composed below. L3 is
          // the sole conditional registration: it appears only with the
          // explicit server-owned qualified observation runner, never from an
          // agent choice of provider, image, tool, arguments, or runtime.
          {
            operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
            executor: prescribedKinematicsRunExecutor,
          },
          {
            operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
            executor: prescribedKinematicsRunExecutor,
          },
          {
            operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
            executor: prescribedKinematicsRunExecutor,
          },
          {
            operation: VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
            executor: prescribedKinematicsRunExecutor,
          },
          // L5 remains an explicit pair. Do not derive these registrations by
          // iterating the operation family: both require a human origin.
          {
            operation: DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
            executor: prescribedKinematicsRunExecutor,
          },
          {
            operation: DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
            executor: prescribedKinematicsRunExecutor,
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

function requiredBuild123dObservationMaterialDigest(
  group: CapabilityRuntimeLaunchGroup,
): string {
  if (group.id !== "casys-build123d-observation" || group.version !== "1.0.0") {
    throw new TypeError(
      "Assembly-integrity observation requires the exact casys-build123d-observation launch group.",
    );
  }
  if (group.materials.length !== 1) {
    throw new TypeError(
      "Assembly-integrity observation requires exactly one launch-group material.",
    );
  }
  const item = group.materials[0]!;
  const digest = item.material.imageDigest;
  if (!item.imageReference.endsWith(`@sha256:${digest}`)) {
    throw new TypeError(
      "Assembly-integrity observation launch-group material digest does not match its image reference.",
    );
  }
  return digest;
}

function requiredCatalogBinding(
  catalog: {
    readonly bindings: readonly { readonly id: string; readonly version: string }[];
  },
  id: string,
): { readonly id: string; readonly version: string } {
  const matches = catalog.bindings.filter((binding) => binding.id === id);
  if (matches.length !== 1) {
    throw new TypeError(
      `Server composition requires exactly one catalogue binding ${id}.`,
    );
  }
  return { id: matches[0]!.id, version: matches[0]!.version };
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
  const [
    build123dExecution,
    geometryModuleAssembly,
    modelicaIsolatedExecution,
    admittedModelicaExecution,
    admittedSpiceExecution,
    calculixIsolatedExecution,
  ] = await Promise.all([
    createLocalBuild123dExecutionServerOptions(),
    createLocalGeometryModuleAssemblyServerOptions(),
    createLocalModelicaIsolatedExecutionServerOptions(),
    createLocalAdmittedModelicaExecutionServerOptions(),
    createLocalAdmittedSpiceExecutionServerOptions(),
    createLocalCalculixIsolatedExecutionServerOptions(),
  ]);
  const { app } = await createConsoleServer({
    projectControl: projectToolsEnabled ? undefined : false,
    approvalMode,
    build123dExecution,
    geometryModuleAssembly,
    modelicaIsolatedExecution,
    admittedModelicaExecution,
    admittedSpiceExecution,
    calculixIsolatedExecution,
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
}

export function parseConsoleCli(args: string[]): ConsoleCliOptions {
  const result: ConsoleCliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--stdio") {
      throw new TypeError("--stdio is not supported; use stateless HTTP on /mcp.");
    } else if (argument === "--yolo") {
      result.yolo = true;
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
