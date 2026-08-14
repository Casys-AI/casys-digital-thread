import { McpApp } from "@casys/mcp-server";
import {
  INTERACTIVE_PROJECT_APPROVAL_MODE,
  LOCAL_YOLO_PROJECT_APPROVAL_MODE,
  type ProjectApprovalMode,
} from "./src/tools/project-approval-mode.ts";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/docker-observer.ts";
import { HttpMcpProbe, type McpProbe } from "./src/adapters/mcp/http-mcp-probe.ts";
import { HttpMcpToolClient } from "./src/adapters/mcp/http-mcp-tool-client.ts";
import { HttpMcpResourceReader } from "./src/adapters/mcp/http-mcp-resource-reader.ts";
import { loadFleetManifest } from "./src/adapters/manifest.ts";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./src/adapters/loopback-host.ts";
import { FileThreadSnapshotStore } from "./src/adapters/stores/file-thread-snapshot-store.ts";
import {
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
} from "./src/adapters/captures/file-capture-store.ts";
import { PythonCadSourceAnalyzer } from "./src/adapters/analyzers/python-cad-source-analyzer.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "./src/adapters/analyzers/project-brief-source-analyzer.ts";
import { BriefSourceAnalysisCaptureService } from "./src/adapters/captures/brief-source-analysis-capture.ts";
import { CaptureBackedTechnicalCompilationBasisResolver } from "./src/adapters/captures/technical-compilation-basis-resolver.ts";
import { CaptureBackedTechnicalCompilationSourceReader } from "./src/adapters/compilers/capture-backed-technical-compilation-source-reader.ts";
import { CaptureBackedTechnicalCompilationAdmissionReader } from "./src/adapters/compilers/capture-backed-technical-compilation-admission-reader.ts";
import {
  FileBuild123dExecutionCaptureStore,
  FileBuild123dExecutionDraftStore,
} from "./src/adapters/captures/build123d-execution-evidence.ts";
import { FileTechnicalCompilationDraftStore } from "./src/adapters/compilers/file-technical-compilation-draft-store.ts";
import { FixedTechnicalCompilationProfileCatalogProvider } from "./src/adapters/compilers/fixed-technical-compilation-profile-catalog-provider.ts";
import { createInitialTechnicalSourceAnalysisCaptureService } from "./src/adapters/compilers/initial-technical-source-analysis-composition.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "./src/adapters/compilers/architecture-sysml-source-analysis-composition.ts";
import { QualifiedArchitectureSysmlAnalyzer } from "./src/adapters/analyzers/qualified-architecture-sysml-analyzer.ts";
import { PreviewProjectArchitectureSysml } from "./src/application/use-cases/preview-project-architecture-sysml.ts";
import { PrepareProjectBriefArchitectureReview } from "./src/application/use-cases/prepare-project-brief-architecture-review.ts";
import { PrepareProjectBriefRequirementsReview } from "./src/application/use-cases/prepare-project-brief-requirements-review.ts";
import type { ProjectArchitectureSysmlSourceCaptureUseCase } from "./src/application/ports/in/project-architecture-sysml-source-capture.ts";
import {
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  ModelSealArchitectureSysmlRunExecutor,
} from "./src/adapters/executors/model-seal-architecture-sysml-run-executor.ts";
import type { Build123dExecutionServerOptions } from "./src/adapters/execution/build123d-execution-composition.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  DesignSealIsolatedGeometryRunExecutor,
} from "./src/adapters/executors/design-seal-isolated-geometry-run-executor.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./src/adapters/execution/modelica-isolated-execution-composition.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./src/adapters/execution/calculix-isolated-execution-composition.ts";
import { CodeOwnedModelicaQualifiedKitBundleFactory } from "./src/adapters/execution/code-owned-modelica-qualified-kit-bundle-factory.ts";
import {
  FileModelicaMicrosandboxQualificationStore,
  PublicationBackedModelicaMicrosandboxQualificationAuthority,
} from "./src/adapters/captures/modelica-microsandbox-qualification.ts";
import { FileIsolatedOutputCas } from "./src/adapters/captures/file-isolated-output-cas.ts";
import { FileModelicaIsolatedExecutionCaptureStore } from "./src/adapters/captures/modelica-isolated-execution-evidence.ts";
import { ProjectThreadModelicaQualifiedKitReviewBasisAuthority } from "./src/adapters/stores/project-thread-modelica-qualified-kit-review-basis-authority.ts";
import { PreviewProjectTechnicalCompilation } from "./src/application/use-cases/preview-project-technical-compilation.ts";
import { PrepareProjectBuild123dExecutionReview } from "./src/application/use-cases/prepare-project-build123d-execution-review.ts";
import { PrepareProjectIsolatedGeometrySealReview } from "./src/application/use-cases/prepare-project-isolated-geometry-seal-review.ts";
import { PrepareProjectModelicaQualifiedKitRunReview } from "./src/application/use-cases/prepare-project-modelica-qualified-kit-run-review.ts";
import { ExecuteIsolatedModelicaRun } from "./src/application/use-cases/execute-isolated-modelica-run.ts";
import type { ProjectTechnicalSourceCaptureUseCase } from "./src/application/ports/in/project-technical-source-capture.ts";
import { FixedSourceAnalysisFrontendRegistry } from "./src/domain/analysis/source-analysis-frontend-registry.ts";
import { RenderedArchitectureSysmlAnalyzer } from "./src/adapters/analyzers/rendered-architecture-sysml-analyzer.ts";
import { SysmlSourceAnalysisCaptureService } from "./src/adapters/captures/sysml-source-analysis-capture.ts";
import { FileSysonModelSeedAttemptStore } from "./src/adapters/wal/file-syson-model-seed-attempt-store.ts";
import { FileInspectionDroneV4ArchitectureAttemptStore } from "./src/adapters/wal/file-inspection-drone-v4-architecture-attempt-store.ts";
import { FileArchitectureAttemptStore } from "./src/adapters/wal/file-architecture-attempt-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./src/adapters/executors/approved-brief-baseline-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./src/adapters/executors/syson-model-seed-run-executor.ts";
import { InspectionDroneV4ArchitectureRunExecutor } from "./src/adapters/executors/inspection-drone-v4-architecture-run-executor.ts";
import { InspectionDroneV4PartDefinitionsRunExecutor } from "./src/adapters/executors/inspection-drone-v4-part-definitions-run-executor.ts";
import { FileInspectionDroneV4PartDefinitionsPublicationStore } from "./src/adapters/wal/file-inspection-drone-v4-part-definitions-publication-store.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
} from "./src/orchestration/operations/inspection-drone-v4.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  ModelWriteArchitectureRunExecutor,
} from "./src/adapters/executors/model-write-architecture-run-executor.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "./src/domain/engineering/part-definitions-capture.ts";
import { ModelCapturePartDefinitionsRunExecutor } from "./src/adapters/executors/model-capture-part-definitions-run-executor.ts";
import { FilePartDefinitionsPublicationStore } from "./src/adapters/wal/file-part-definitions-publication-store.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  DesignWriteGeometryRunExecutor,
} from "./src/adapters/executors/design-write-geometry-run-executor.ts";
import { CaptureBackedProjectGeometryPreviewAdapter } from "./src/adapters/captures/capture-backed-project-geometry-preview-adapter.ts";
import { AdmissionBackedGeometryExportAdapter } from "./src/adapters/captures/admission-backed-geometry-export-adapter.ts";
import { ExportAdmittedProjectGeometry } from "./src/application/use-cases/export-admitted-project-geometry.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  ModelWriteRequirementsRunExecutor,
} from "./src/adapters/executors/model-write-requirements-run-executor.ts";
import {
  ARCHIVE_LINEAGE_OPERATION,
  ArchiveLineageRunExecutor,
} from "./src/adapters/executors/archive-lineage-run-executor.ts";
import {
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
  ReconcileUncertainWriterRunExecutor,
} from "./src/adapters/executors/reconcile-uncertain-writer-run-executor.ts";
import {
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  VerifySealProofCaseRunExecutor,
} from "./src/adapters/executors/verify-seal-proof-case-run-executor.ts";
import { VerifyRunFeaStaticProofRunExecutor } from "./src/adapters/executors/verify-run-fea-static-proof-run-executor.ts";
import { VERIFY_RUN_FEA_STATIC_PROOF_OPERATION } from "./src/adapters/executors/verify-run-fea-static-proof-run-executor.ts";
import {
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
  SimulateSealSimulationCaseRunExecutor,
} from "./src/adapters/executors/simulate-seal-simulation-case-run-executor.ts";
import {
  SIMULATE_RUN_MODELICA_SCENARIO_OPERATION,
  SimulateRunModelicaScenarioRunExecutor,
} from "./src/adapters/executors/simulate-run-modelica-scenario-run-executor.ts";
import { validateFeaExecutionPolicy } from "./src/domain/analysis/fea-execution-policy.ts";
import { validateSimulationExecutionPolicy } from "./src/domain/analysis/simulation-execution-policy.ts";
import { FileCanonicalAssetReader } from "./src/adapters/assets/canonical-asset-reader.ts";
import { SimulateSealSimulationCaseV2RunExecutor } from "./src/adapters/executors/simulate-seal-simulation-case-v2-run-executor.ts";
import { SimulateRunModelicaScenarioV2RunExecutor } from "./src/adapters/executors/simulate-run-modelica-scenario-v2-run-executor.ts";
import { VerifyRunFeaStaticProofV2RunExecutor } from "./src/adapters/executors/verify-run-fea-static-proof-v2-run-executor.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  CompileSealAdmissionRunExecutor,
} from "./src/adapters/executors/compile-seal-admission-run-executor.ts";
import {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  DesignExecuteBuild123dRunExecutor,
} from "./src/adapters/executors/design-execute-build123d-run-executor.ts";
import {
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  SimulateRunQualifiedModelicaKitRunExecutor,
} from "./src/adapters/executors/simulate-run-qualified-modelica-kit-run-executor.ts";
import { VerifyRunFeaStaticProofV3RunExecutor } from "./src/adapters/executors/verify-run-fea-static-proof-v3-run-executor.ts";
import { DockerVolumeAssetStager } from "./src/adapters/executors/container-asset-stager.ts";
import { FileFeaStaticProofAttemptStore } from "./src/adapters/wal/file-fea-static-proof-attempt-store.ts";
import { FileModelicaScenarioAttemptStore } from "./src/adapters/wal/file-modelica-scenario-attempt-store.ts";
import { FileModelicaQualifiedSealAttemptStore } from "./src/adapters/wal/file-modelica-qualified-seal-attempt-store.ts";
import { FileModelicaRecordedScenarioAttemptStore } from "./src/adapters/wal/file-modelica-recorded-scenario-attempt-store.ts";
import { FileCalculixRecordedStaticAttemptStore } from "./src/adapters/wal/file-calculix-recorded-static-attempt-store.ts";
import { McpModelicaProvider } from "./src/adapters/providers/modelica/mcp-modelica-provider.ts";
import { McpModelicaResumableAdapter } from "./src/adapters/providers/modelica/mcp-modelica-resumable-adapter.ts";
import { McpCalculixStaticStructuralSolver } from "./src/adapters/providers/calculix/mcp-calculix-static-structural-solver.ts";
import { McpCalculixRecordedStaticAdapter } from "./src/adapters/providers/calculix/mcp-calculix-recorded-static-adapter.ts";
import { FileByteStore } from "./src/adapters/captures/file-byte-store.ts";
import { ModelicaQualifiedSourceCaptureService } from "./src/adapters/captures/modelica-qualified-source-capture.ts";
import { ProviderResourceCaptureService } from "./src/adapters/captures/provider-resource-capture-service.ts";
import { RecordedAnalysisCasReader } from "./src/adapters/captures/recorded-analysis-cas-reader.ts";
import {
  CaptureBackedRunPlanSealer,
  RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
} from "./src/adapters/plans/capture-backed-run-plan-sealer.ts";
import { RecordedOperationPlanResolver } from "./src/adapters/plans/recorded-operation-plan-resolver.ts";
import {
  FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  FEA_SOLVER_RESULT_CAPTURE_DESCRIPTOR,
  FEA_VERDICT_CAPTURE_DESCRIPTOR,
  MODELICA_SCENARIO_RECEIPT_CAPTURE_DESCRIPTOR,
  MODELICA_SCENARIO_RUN_CAPTURE_DESCRIPTOR,
  SIMULATION_CASE_CAPTURE_DESCRIPTOR,
} from "./src/adapters/captures/file-capture-store.ts";
import { FileRequirementsAttemptStore } from "./src/adapters/wal/file-requirements-attempt-store.ts";
import { FileBuild123dExecutionAttemptStore } from "./src/adapters/wal/file-build123d-execution-attempt-store.ts";
import { FileModelicaIsolatedExecutionAttemptStore } from "./src/adapters/wal/file-modelica-isolated-execution-attempt-store.ts";
import { FileCalculixIsolatedProductAttemptStore } from "./src/adapters/wal/file-calculix-isolated-product-attempt-store.ts";
import { REQUIREMENTS_CAPTURE_DESCRIPTOR } from "./src/adapters/captures/file-capture-store.ts";
import { RegisteredProjectRunExecutor } from "./src/application/use-cases/registered-project-run-executor.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/stores/live-thread-update-store.ts";
import { FileEngineeringProjectRevisionStore } from "./src/adapters/stores/engineering-project-store.ts";
import {
  FileProjectReviewIntentStore,
  ProjectReviewIntentConflictError,
} from "./src/adapters/stores/file-project-review-intent-store.ts";
import {
  CockpitFocusConflictError,
  FileCockpitFocusStore,
} from "./src/adapters/stores/file-cockpit-focus-store.ts";
import { createEngineeringProjectCommandRuntime } from "./src/adapters/engineering-project-command-runtime.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./src/adapters/stores/engineering-thread-snapshot-resolver.ts";
import { ModelicaRunObserver } from "./src/adapters/historical/modelica-run-observer.ts";
import { loadRunFixtures } from "./src/adapters/run-fixtures.ts";
import { ControlPlane } from "./src/application/control-plane/control-plane.ts";
import { EngineeringProjectCommandError } from "./src/application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "./src/application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./src/orchestration/operations/registry.ts";
import {
  SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./src/orchestration/operations/recorded-analysis.ts";
import type { FleetManifest, RunDetail } from "./src/contracts/console.ts";
import type { ObservedRunCatalog } from "./src/application/control-plane/ports.ts";
import {
  CONSOLE_RESOURCE_URI,
  registerControlPlaneTools,
} from "./src/tools/register.ts";
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
/**
 * Reviewed initial FEA execution policy (fea-execution-policy/1). These bounds
 * are a server-owned gate, not physics: below 0.5 mm target mesh a concept part
 * meshes into memory exhaustion; 10 kN per load and 16 named selections exceed
 * any reviewed concept case; 32 MiB bounds the staged STEP. Raising any bound
 * is a reviewed change to this literal, never a runtime override.
 */
const FEA_EXECUTION_POLICY_INPUT = {
  policyVersion: "fea-execution-policy/1",
  meshTargetSizeMinMm: 0.5,
  forceMagnitudeMaxN: 10_000,
  stepBytesMax: 33_554_432,
  selectionsMax: 16,
} as const;
/**
 * Reviewed initial simulation execution policy. timeoutMaxMs mirrors the
 * provider's own hard bound (120 s); the HTTP client timeout below is strictly
 * larger (150 s) so the provider's timeout verdict always arrives instead of a
 * client-side abort masking it.
 */
const SIMULATION_EXECUTION_POLICY_INPUT = {
  policyVersion: "simulation-execution-policy/1",
  timeoutMaxMs: 120_000,
} as const;
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
  observedRuns?: ObservedRunCatalog;
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
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
  /** Root of the closed CAS/WAL layout used by recorded-analysis @2 operations. */
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
  const modelica = manifest.servers.find((server) => server.id === "modelica");
  const syson = manifest.servers.find((server) => server.id === "syson");
  const build123dSandbox = manifest.servers.find((server) =>
    server.id === "build123d-sandbox"
  );
  const calculix = manifest.servers.find((server) => server.id === "calculix");
  const observedRuns = options.observedRuns ??
    createObservedRunCatalog(modelica?.mcpUrl);
  const controlPlane = new ControlPlane({
    manifest,
    runs,
    observedRuns,
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
      modelica?.mcpUrl,
      build123dSandbox?.mcpUrl,
      calculix?.mcpUrl,
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
  registerConsoleViewer(app);
  return { app, controlPlane };
}

async function createProjectControl(
  options: CreateConsoleServerOptions,
  sysonMcpUrl?: string,
  modelicaMcpUrl?: string,
  build123dSandboxMcpUrl?: string,
  calculixMcpUrl?: string,
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
  const technicalSourceAnalysis = createInitialTechnicalSourceAnalysisCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "technical-source",
      directory: `${technicalCompilationDirectory}/sources`,
      uriNamespace: "technical-source",
      label: "Captured technical source",
    }),
    analysisCaptures: new FileByteStore({
      kind: "technical-source-analysis",
      directory: `${technicalCompilationDirectory}/analyses`,
      uriNamespace: "technical-source-analysis",
      label: "Captured technical source analysis",
    }),
  });
  const technicalCompilationSources = new CaptureBackedTechnicalCompilationSourceReader(
    technicalSourceAnalysis,
  );
  const technicalSourceCapture: ProjectTechnicalSourceCaptureUseCase = {
    capture: async (command) =>
      structuredClone(
        await technicalSourceAnalysis.capture(command),
      ) as unknown as Readonly<Record<string, unknown>>,
  };
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
      "./src/adapters/execution/build123d-execution-composition.ts"
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
      "./src/adapters/execution/modelica-isolated-execution-composition.ts"
    )).createModelicaIsolatedExecutionComposition(
      options.modelicaIsolatedExecution,
      {
        outputCasDirectory:
          `${recordedAnalysisDirectory}/modelica/isolated-execution/outputs`,
      },
    );
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
      "./src/adapters/execution/calculix-isolated-execution-composition.ts"
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
  const recordedSimulationCases = new FileByteStore({
    kind: "simulation-case-v2",
    directory: `${recordedAnalysisDirectory}/modelica/simulation-cases`,
    uriNamespace: "simulation-case-v2",
    label: "Recorded Modelica simulation case",
  });
  const recordedModelicaManifests = new FileByteStore({
    kind: "modelica-qualified-provider-manifest",
    directory: `${recordedAnalysisDirectory}/modelica/provider-manifests`,
    uriNamespace: "modelica-qualified-provider-manifest",
    label: "Recorded qualified Modelica manifest",
  });
  const recordedModelicaSources = new FileByteStore({
    kind: "modelica-qualified-source",
    directory: `${recordedAnalysisDirectory}/modelica/qualified-sources`,
    uriNamespace: "modelica-qualified-source",
    label: "Recorded qualified Modelica source",
  });
  const recordedModelicaSourceCaptures = new FileByteStore({
    kind: "modelica-qualified-source-capture",
    directory: `${recordedAnalysisDirectory}/modelica/qualified-source-captures`,
    uriNamespace: "modelica-qualified-source-capture",
    label: "Recorded qualified Modelica source capture",
  });
  const recordedModelicaQualifications = new FileByteStore({
    kind: "simulation-case-qualification",
    directory: `${recordedAnalysisDirectory}/modelica/qualifications`,
    uriNamespace: "simulation-case-qualification",
    label: "Recorded Modelica simulation-case qualification",
  });
  const recordedModelicaResources = new FileByteStore({
    kind: "modelica-recorded-resource",
    directory: `${recordedAnalysisDirectory}/modelica/run-resources`,
    uriNamespace: "modelica-recorded-resource",
    label: "Recorded Modelica provider resource",
  });
  const recordedModelicaLedgers = new FileByteStore({
    kind: "modelica-recorded-resource-ledger",
    directory: `${recordedAnalysisDirectory}/modelica/run-ledgers`,
    uriNamespace: "modelica-recorded-resource-ledger",
    label: "Recorded Modelica resource ledger",
  });
  const recordedModelicaCaptureManifests = new FileByteStore({
    kind: "modelica-recorded-resource-manifest",
    directory: `${recordedAnalysisDirectory}/modelica/run-manifests`,
    uriNamespace: "modelica-recorded-resource-manifest",
    label: "Recorded Modelica resource capture manifest",
  });
  const recordedCalculixResources = new FileByteStore({
    kind: "calculix-recorded-resource",
    directory: `${recordedAnalysisDirectory}/calculix/run-resources`,
    uriNamespace: "calculix-recorded-resource",
    label: "Recorded CalculiX provider resource",
  });
  const recordedCalculixLedgers = new FileByteStore({
    kind: "calculix-recorded-ledger",
    directory: `${recordedAnalysisDirectory}/calculix/run-ledgers`,
    uriNamespace: "calculix-recorded-ledger",
    label: "Recorded CalculiX resource ledger",
  });
  const recordedCalculixCaptureManifests = new FileByteStore({
    kind: "calculix-recorded-manifest",
    directory: `${recordedAnalysisDirectory}/calculix/run-manifests`,
    uriNamespace: "calculix-recorded-manifest",
    label: "Recorded CalculiX resource capture manifest",
  });
  const recordedCalculixEvaluations = new FileByteStore({
    kind: "calculix-recorded-syson-evaluation",
    directory: `${recordedAnalysisDirectory}/calculix/syson-evaluations`,
    uriNamespace: "calculix-recorded-syson-evaluation",
    label: "Recorded CalculiX SysON evaluation",
  });
  // One historical proof CAS instance is deliberately shared by the @1 seal,
  // @1 run and ROP2 reader. Its descriptor owns the pre-existing on-disk
  // location; moving it beneath the new recorded-analysis root would make
  // already sealed @1 proof artifacts invisible to the trusted @1 executor.
  const feaProofCaptures = new FileCaptureStore(
    FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  );
  // Requirements are likewise a historical shared CAS. Model authoring, both
  // @1 FEA operations and the ROP2 reader must resolve the same immutable
  // bytes, including when a deployment overrides only their storage directory.
  const requirementsCaptures = new FileCaptureStore({
    ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
    directory: options.requirementsCaptureDirectory ??
      DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY,
  });
  const recordedAnalysisCas = new RecordedAnalysisCasReader({
    stores: [
      {
        namespace: "simulation-case-v2",
        storage: "bytes",
        store: recordedSimulationCases,
      },
      {
        namespace: "modelica-qualified-provider-manifest",
        storage: "bytes",
        store: recordedModelicaManifests,
      },
      {
        namespace: "modelica-qualified-source",
        storage: "bytes",
        store: recordedModelicaSources,
      },
      {
        namespace: "modelica-qualified-source-capture",
        storage: "bytes",
        store: recordedModelicaSourceCaptures,
      },
      {
        namespace: "simulation-case-qualification",
        storage: "bytes",
        store: recordedModelicaQualifications,
      },
      {
        namespace: "fea-proof-case-capture",
        storage: "text",
        store: feaProofCaptures,
      },
      {
        namespace: "requirements-capture",
        storage: "text",
        store: requirementsCaptures,
      },
    ],
  });
  const recordedPlanResolver = new RecordedOperationPlanResolver({
    snapshots: threadSnapshots,
    artifacts: recordedAnalysisCas,
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
  const technicalCompilationPreview = new PreviewProjectTechnicalCompilation({
    basisResolver: technicalCompilationBasis,
    sourceReader: technicalCompilationSources,
    profileCatalog: technicalCompilationProfiles,
    draftStore: technicalCompilationDrafts,
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
  const feaExecutionPolicy = validateFeaExecutionPolicy(FEA_EXECUTION_POLICY_INPUT);
  const simulationExecutionPolicy = validateSimulationExecutionPolicy(
    SIMULATION_EXECUTION_POLICY_INPUT,
  );
  /**
   * Weak, timestamped observation of the CalculiX image — recorded in the
   * verdict capture, never treated as exact provenance (the container can be
   * swapped between observation and dispatch). Errors are swallowed by the
   * executor by design.
   */
  const observeCalculixImage = async () => {
    const command = new Deno.Command("docker", {
      args: ["compose", "images", "mcp-calculix", "--format", "json"],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await command.output();
    const parsed = JSON.parse(new TextDecoder().decode(stdout));
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      image: `${row.Repository}:${row.Tag}`,
      digest: String(row.ID ?? ""),
      observedAt: new Date().toISOString(),
    };
  };
  // FEA proof-case seal calls no provider — always available.
  const genericVerifySealProofCase = new VerifySealProofCaseRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    proofCaseCaptures: feaProofCaptures,
    geometryCaptures: new FileCaptureStore(GEOMETRY_CAPTURE_DESCRIPTOR),
    requirementsCaptures,
    seedCaptures: sysonModelSeedCaptures,
    canonicalAssetReader: new FileCanonicalAssetReader({
      directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
    }),
    lease,
  });
  const genericVerifyRunFeaStaticProof = sysonMcpUrl && calculixMcpUrl
    ? new VerifyRunFeaStaticProofRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      proofCaptures: feaProofCaptures,
      requirementsCaptures,
      canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      solverCaptures: new FileCaptureStore(FEA_SOLVER_RESULT_CAPTURE_DESCRIPTOR),
      verdictCaptures: new FileCaptureStore(FEA_VERDICT_CAPTURE_DESCRIPTOR),
      attempts: new FileFeaStaticProofAttemptStore(),
      stager: new DockerVolumeAssetStager({
        service: "mcp-calculix",
        containerDirectory: "/inputs",
      }),
      assetReader: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      solver: new McpCalculixStaticStructuralSolver(
        new HttpMcpToolClient({ mcpUrl: calculixMcpUrl, timeoutMs: 180_000 }),
      ),
      policy: feaExecutionPolicy,
      solverImageObserver: observeCalculixImage,
      lease,
      liveUpdates,
    })
    : undefined;
  // Simulation-case seal calls no provider — always available.
  const genericSimulateSealSimulationCase = new SimulateSealSimulationCaseRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    simulationCaseCaptures: new FileCaptureStore(SIMULATION_CASE_CAPTURE_DESCRIPTOR),
    lease,
  });
  const modelicaProvider = modelicaMcpUrl
    ? new McpModelicaProvider(
      new HttpMcpToolClient({ mcpUrl: modelicaMcpUrl, timeoutMs: 150_000 }),
    )
    : undefined;
  const genericSimulateRunModelicaScenario = modelicaProvider
    ? new SimulateRunModelicaScenarioRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: new FileCaptureStore(SIMULATION_CASE_CAPTURE_DESCRIPTOR),
      recordCaptures: new FileCaptureStore(MODELICA_SCENARIO_RUN_CAPTURE_DESCRIPTOR),
      receiptCaptures: new FileCaptureStore(
        MODELICA_SCENARIO_RECEIPT_CAPTURE_DESCRIPTOR,
      ),
      attempts: new FileModelicaScenarioAttemptStore(),
      methodCatalog: modelicaProvider,
      planResolver: modelicaProvider,
      simulator: modelicaProvider,
      runReader: modelicaProvider,
      policy: simulationExecutionPolicy,
      lease,
      liveUpdates,
    })
    : undefined;
  const recordedModelica = modelicaMcpUrl
    ? new McpModelicaResumableAdapter(
      new HttpMcpToolClient({ mcpUrl: modelicaMcpUrl, timeoutMs: 150_000 }),
    )
    : undefined;
  // The two recorded Modelica operations share one exact resources/read
  // adapter. It has no discovery method and performs no I/O during setup.
  const recordedModelicaProviderResources = modelicaMcpUrl
    ? new HttpMcpResourceReader({ mcpUrl: modelicaMcpUrl, timeoutMs: 150_000 })
    : undefined;
  const recordedModelicaSeal = recordedModelica && recordedModelicaProviderResources
    ? new SimulateSealSimulationCaseV2RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      lease,
      attempts: new FileModelicaQualifiedSealAttemptStore(
        `${recordedAnalysisDirectory}/modelica/seal-attempts`,
      ),
      manifestReader: recordedModelica,
      providerResources: new ModelicaQualifiedSourceCaptureService({
        reader: recordedModelicaProviderResources,
        artifacts: recordedModelicaSources,
        captures: recordedModelicaSourceCaptures,
      }),
      simulationCases: recordedSimulationCases,
      providerManifests: recordedModelicaManifests,
      qualificationCaptures: recordedModelicaQualifications,
    })
    : undefined;
  const recordedModelicaRun = recordedModelica && recordedModelicaProviderResources
    ? new SimulateRunModelicaScenarioV2RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      plans: recordedRunPlans,
      lease,
      attempts: new FileModelicaRecordedScenarioAttemptStore(
        `${recordedAnalysisDirectory}/modelica/run-attempts`,
      ),
      sources: recordedAnalysisCas,
      provider: recordedModelica,
      captures: new ProviderResourceCaptureService({
        reader: recordedModelicaProviderResources,
        artifactStore: recordedModelicaResources,
        ledgerStore: recordedModelicaLedgers,
        manifestStore: recordedModelicaCaptureManifests,
      }),
      capturedResources: recordedModelicaResources,
      captureLedgers: recordedModelicaLedgers,
      captureManifests: recordedModelicaCaptureManifests,
    })
    : undefined;
  const recordedCalculix = calculixMcpUrl
    ? new McpCalculixRecordedStaticAdapter(
      new HttpMcpToolClient({ mcpUrl: calculixMcpUrl, timeoutMs: 180_000 }),
    )
    : undefined;
  // One exact resources/read capability for CalculiX is shared by capture and
  // recovery; no provider read is reachable before executor admission.
  const recordedCalculixProviderResources = calculixMcpUrl
    ? new HttpMcpResourceReader({ mcpUrl: calculixMcpUrl, timeoutMs: 180_000 })
    : undefined;
  const recordedCalculixRun = sysonMcpUrl && recordedCalculix &&
      recordedCalculixProviderResources
    ? new VerifyRunFeaStaticProofV2RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      plans: recordedRunPlans,
      artifacts: recordedAnalysisCas,
      canonicalAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      stager: new DockerVolumeAssetStager({
        service: "mcp-calculix",
        containerDirectory: "/inputs",
      }),
      solver: recordedCalculix,
      runReader: recordedCalculix,
      evidenceVerifier: recordedCalculix,
      providerCaptures: new ProviderResourceCaptureService({
        reader: recordedCalculixProviderResources,
        artifactStore: recordedCalculixResources,
        ledgerStore: recordedCalculixLedgers,
        manifestStore: recordedCalculixCaptureManifests,
      }),
      resourceCaptureStore: recordedCalculixResources,
      ledgerCaptureStore: recordedCalculixLedgers,
      manifestCaptureStore: recordedCalculixCaptureManifests,
      sysonEvaluationCaptureStore: recordedCalculixEvaluations,
      attempts: new FileCalculixRecordedStaticAttemptStore(
        `${recordedAnalysisDirectory}/calculix/run-attempts`,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
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
      build123dExecutionReview,
      isolatedGeometrySealReview,
      modelicaQualifiedKitRunReview,
      reviewIntents: new FileProjectReviewIntentStore(
        options.projectReviewIntentDirectory ??
          DEFAULT_PROJECT_REVIEW_INTENT_DIRECTORY,
      ),
      // WHY THE SANDBOX INSTANCE AND NOT THE TRUSTED ONE — preview executes a
      // geometry program PROPOSED BY AN AGENT. A fingerprint proves byte identity
      // after sealing, never causal provenance: a write reaching the shared
      // evidence volume before its producer hashes it would make the wrong hash
      // the expected one. The sandbox owns a private export volume, so a proposed
      // program can never touch evidence bytes. No sandbox entry in the fleet
      // manifest ⇒ no preview tool at all, never a ghost that fails when called.
      // The admitted-geometry path reuses this same private client after
      // compile.seal-admission@1; it is not gated on --local-execution.
      ...composePrivateBuild123dGeometrySurfaces(
        build123dSandboxMcpUrl,
        geometrySourceAnalysis,
        technicalCompilationAdmissions,
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
            operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
            executor: simulateRunQualifiedModelicaKit,
            unavailableMessage:
              "The server has no complete qualified local Modelica runtime and pinned qualification configured for this run.",
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
            operation: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
            executor: genericVerifyRunFeaStaticProof,
            unavailableMessage:
              "The server has no trusted generic verify.run-fea-static-proof@1 executor " +
              "configured for this run (SysON and CalculiX providers are required).",
          },
          {
            operation: SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
            executor: genericSimulateSealSimulationCase,
          },
          {
            operation: SIMULATE_RUN_MODELICA_SCENARIO_OPERATION,
            executor: genericSimulateRunModelicaScenario,
            unavailableMessage:
              "The server has no trusted generic simulate.run-modelica-scenario@1 executor " +
              "configured for this run (Modelica provider is required).",
          },
          {
            operation: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
            executor: recordedModelicaSeal,
            unavailableMessage:
              "The server has no trusted simulate.seal-simulation-case@2 executor " +
              "configured for this run (Modelica provider is required).",
          },
          {
            operation: SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
            executor: recordedModelicaRun,
            unavailableMessage:
              "The server has no trusted simulate.run-modelica-scenario@2 executor " +
              "configured for this run (Modelica provider is required).",
          },
          {
            operation: VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
            executor: recordedCalculixRun,
            unavailableMessage:
              "The server has no trusted verify.run-fea-static-proof@2 executor " +
              "configured for this run (SysON and CalculiX providers are required).",
          },
          {
            operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
            executor: isolatedCalculixRun,
            unavailableMessage:
              "The server has no complete qualified local CalculiX runtime and SysON oracle configured for this run.",
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
  geometrySourceAnalysis: ConstructorParameters<
    typeof CaptureBackedProjectGeometryPreviewAdapter
  >[0]["sourceAnalysis"],
  admissions: CaptureBackedTechnicalCompilationAdmissionReader,
): Pick<
  ProjectControlToolDependencies,
  "geometryPreview" | "admittedGeometryExport"
> {
  if (!build123dSandboxMcpUrl) {
    return {
      geometryPreview: undefined,
      admittedGeometryExport: undefined,
    };
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
    geometryPreview: new CaptureBackedProjectGeometryPreviewAdapter({
      client,
      draftCaptures,
      sourceAnalysis: geometrySourceAnalysis,
      build123dService: "mcp-build123d-sandbox",
    }),
    admittedGeometryExport: new ExportAdmittedProjectGeometry({
      admissions,
      exporter: new AdmissionBackedGeometryExportAdapter({
        client,
        draftCaptures,
        sourceAnalysis: geometrySourceAnalysis,
        build123dService: "mcp-build123d-sandbox",
      }),
    }),
  };
}

function createObservedRunCatalog(
  modelicaMcpUrl?: string,
): ObservedRunCatalog | undefined {
  if (!modelicaMcpUrl) return undefined;
  return new ModelicaRunObserver({ mcpUrl: modelicaMcpUrl });
}

export function registerConsoleViewer(app: McpApp): boolean {
  const summary = app.registerViewers({
    prefix: "casys-digital-thread",
    viewers: ["console"],
    moduleUrl: import.meta.url,
    exists: fileExists,
    readFile: Deno.readTextFile,
  });
  if (
    summary.registered.length > 0 &&
    !app.hasResource(CONSOLE_RESOURCE_URI)
  ) {
    throw new Error(
      `Console viewer registered under an unexpected URI; expected ${CONSOLE_RESOURCE_URI}`,
    );
  }
  return summary.registered.length === 1;
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
    calculixIsolatedExecution: localExecution
      ? await createLocalCalculixIsolatedExecutionServerOptions()
      : undefined,
  });
  await app.startHttp({
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
          `LOCAL EXECUTION ACTIVE: qualified Build123d, Modelica, and CalculiX runs use ${LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE}, and ${LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE} through the attached local Microsandbox backend; CalculiX publication still requires the SysON oracle.`,
        );
      }
      if (!projectToolsEnabled) {
        console.error(
          "Project mutation tools disabled: non-loopback MCP binding exposes the read-only fleet console only.",
        );
      }
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

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}
